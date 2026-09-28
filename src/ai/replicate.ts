import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath } from '../cli/render';
import { DISPLAY_NAMES, SERIF_NAMES } from '../plan/fonts';
import { TRANSITIONS } from '../plan/schema';
import type { BrandKit } from './brand-kit';
import { invent, type InventOptions } from './invent';
import { directionSchema, type Direction } from './invent-prompts';
import craft from '../../docs/motion-craft.md?raw';
import { parseJson, text, user, video, type LLM } from './llm';

// Replicate mode: a user brings a video they love. The model watches it,
// breaks it down shot by shot (timing, motion, type, colour, sound), adapts
// that breakdown to the brand, and the invent pipeline rebuilds it; every
// scene's critique compares the render with the matching reference segment.

function ff(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg ${code}: ${err.slice(-400)}`))));
  });
}

export async function videoDuration(file: string): Promise<number> {
  const out = await new Promise<string>(resolve => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => (err += d));
    p.on('close', () => resolve(err));
  });
  const m = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error(`could not read the duration of ${file}`);
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

/** A small 640-px copy (with audio) for the model, and per-window segments. */
export async function referenceClips(file: string, windows: { from: number; to: number }[]): Promise<{ full: Buffer; parts: Buffer[] }> {
  const tmp = mkdtempSync(join(tmpdir(), 'motion-ref-'));
  try {
    const full = join(tmp, 'full.mp4');
    await ff(['-y', '-loglevel', 'error', '-i', file, '-vf', 'scale=640:-2', '-r', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '96k', '-f', 'mp4', full]);
    const parts: Buffer[] = [];
    for (const [k, w] of windows.entries()) {
      const out = join(tmp, `part-${k}.mp4`);
      await ff(['-y', '-loglevel', 'error', '-ss', w.from.toFixed(3), '-t', Math.max(0.3, w.to - w.from).toFixed(3), '-i', full, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-an', '-f', 'mp4', out]);
      parts.push(readFileSync(out));
    }
    return { full: readFileSync(full), parts };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface Breakdown {
  summary: string;
  bpm: number;
  style: string;
  palette: string[];
  typography: string;
  motion: string;
  texture: string;
  sound: string;
  font?: string;
  shots: { start: number; end: number; what: string; motion: string; background?: string; text: string[]; transition: string }[];
}

const breakdownSchema = () => ({
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'what the film is and why it works, 3–4 sentences' },
    bpm: { type: 'number', description: 'tempo of the music (estimate from the cuts if there is no music)' },
    style: { type: 'string' },
    palette: { type: 'array', items: { type: 'string' }, description: '#RRGGBB colours in order of use' },
    typography: { type: 'string', description: 'families (describe), weights, sizes, case, tracking, how type moves' },
    font: { type: 'string', enum: [...DISPLAY_NAMES], description: 'the closest of these display fonts to the main typeface' },
    motion: { type: 'string', description: 'easing, speed, rhythm, camera, transitions, signature moves' },
    texture: { type: 'string' },
    sound: { type: 'string', description: 'genre, instruments, structure, how sound effects sit on the picture' },
    shots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number' }, end: { type: 'number' },
          what: { type: 'string', description: 'exactly what is on screen and how it is composed: every element, its position and size as % of the frame, colours as #RRGGBB, layering' },
          motion: { type: 'string', description: 'exactly how everything moves, keyframe by keyframe with timestamps (seconds from the film start), easing, overshoot and stagger' },
          background: { type: 'string', description: 'the background: colour(s) as #RRGGBB, gradients, texture, anything moving in it' },
          text: { type: 'array', items: { type: 'string' } },
          transition: { type: 'string', description: 'how it hands over to the next shot' },
        },
        required: ['start', 'end', 'what', 'motion', 'text', 'transition'],
      },
    },
  },
  required: ['summary', 'bpm', 'style', 'palette', 'typography', 'font', 'motion', 'texture', 'sound', 'shots'],
});

export interface ReplicateOptions extends Omit<InventOptions, 'direction' | 'reference' | 'seconds'> {
  videoFile: string;
  /** Keep the reference's colours instead of the brand palette. */
  keepColors?: boolean;
  /**
   * Copy the reference as exactly as possible: its own words, colours, fonts,
   * layout and shot timing (no brand adaptation), one scene per shot, and its
   * own soundtrack on the final video.
   */
  exact?: boolean;
}

/** In exact mode the palette comes from the reference: darkest → bg, lightest → text, the most saturated → primary. */
function paletteRoles(hexes: string[]) {
  const ok = hexes.filter(h => /^#[0-9a-f]{6}$/i.test(h));
  if (ok.length < 2) return undefined;
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = (h: string) => { const [r, g, b] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const sat = (h: string) => { const [r, g, b] = rgb(h); return Math.max(r, g, b) - Math.min(r, g, b); };
  const byLum = [...ok].sort((a, b) => lum(a) - lum(b));
  const bySat = [...ok].sort((a, b) => sat(b) - sat(a));
  const bg = ok[0], text = lum(bg) < 0.5 ? byLum[byLum.length - 1] : byLum[0];
  const primary = bySat.find(h => h !== bg && h !== text) ?? text;
  const secondary = bySat.find(h => h !== bg && h !== text && h !== primary) ?? primary;
  return { bg, text, primary, secondary };
}

export async function replicate(llm: LLM, o: ReplicateOptions) {
  const log = o.log ?? (() => {});
  const critic = o.criticLLM ?? llm;
  const dur = await videoDuration(o.videoFile);
  log(`1/3 watching the reference (${dur.toFixed(1)} s)`);
  const { full } = await referenceClips(o.videoFile, []);
  const bdRes = await critic.json({
    label: 'breakdown', effort: 'high', schema: breakdownSchema(),
    system: `You are a senior motion designer breaking down a reference film so a team can rebuild it shot for shot. Watch it closely (with sound) and describe everything that makes it work: every shot with its exact start and end time, composition, what moves and how (timing, easing, overshoot, stagger), typography, colour, texture, camera, transitions, and the music. Be precise: numbers, positions, sizes relative to the frame, beat positions.\n\n# Craft handbook (vocabulary)\n${craft}`,
    turns: [user(video(full, 12), text('Break this film down.'))],
  });
  const bd = parseJson<Breakdown>(bdRes.text);
  log(`  ${bd.shots.length} shots · ${bd.bpm} BPM · ${bd.style}`);

  const bpm = Math.min(140, Math.max(90, Math.round(bd.bpm || 120)));
  let kit = o.kit;
  if (o.exact) {
    // the reference's look, not the brand's
    const roles = paletteRoles(bd.palette ?? []);
    const font = (DISPLAY_NAMES as readonly string[]).includes(bd.font ?? '') ? bd.font! : kit.brand.fonts.display;
    kit = { ...kit, brand: { ...kit.brand, ...(roles ? { colors: { ...kit.brand.colors, ...roles } } : {}), fonts: { ...kit.brand.fonts, display: font } } } as typeof kit;
  }
  log(o.exact ? '2/3 turning the breakdown into a shot-for-shot direction' : '2/3 adapting it to the brand');
  const dirRes = await llm.json({
    label: 'adapt', effort: 'high', schema: directionSchema(),
    system: o.exact
      ? `You turn a reference motion design film's breakdown into a production direction for an EXACT, shot-for-shot copy. Keep everything: the same shots with the same timing, the same on-screen words (character for character), colours (#RRGGBB), layout and sizes, typography treatment, motion, easing, transitions and energy. Do not adapt it to a brand and do not add a logo or end card the reference does not have. One scene per reference shot, in order; scene beats = shot duration × ${bpm} / 60 (multiples of 0.25). In each scene idea, write every element, its position and size (% of the frame), colour, and every keyframe with its time inside the scene. Name the set piece a shot needs when one of the crafted set pieces matches it (3D logo or type, particles, globe, cylinder…), otherwise none. Fonts: display from ${DISPLAY_NAMES.join(', ')}; serif from ${SERIF_NAMES.join(', ')}. Transitions: ${TRANSITIONS.join(', ')} (prefer "cut" with the reference's transition built into the scenes).`
      : `You adapt a reference motion design film to a new brand, keeping its craft: the same structure, pacing, shot types, motion language, typography treatment and energy, so a viewer would recognise the style. Replace its copy with the brand's own words (from the brief and facts only; never invent numbers or claims), ${o.keepColors ? "keep the reference's colours" : "use the brand palette in the reference's colour roles"}, and end on the brand (logo, name, site) held still for the final 1.5 s. One scene per reference shot (merge very short shots if needed); scene beats = shot duration × ${bpm} / 60, in multiples of 0.5. Fonts: display from ${DISPLAY_NAMES.join(', ')}; serif from ${SERIF_NAMES.join(', ')}. Transitions: ${TRANSITIONS.join(', ')} (prefer "cut" with the reference's transition built into the scenes).`,
    turns: [user(
      text(`REFERENCE BREAKDOWN\n${JSON.stringify(bd, null, 1)}`),
      o.exact ? text(`PALETTE ROLES FOR THIS COPY (S.colors)\n${JSON.stringify(kit.brand.colors)}`) : text(`BRAND\n${JSON.stringify({ ...o.kit.brand, logo: o.kit.brand.logo ? '(vector mark)' : '(monogram)' })}\nFACTS\n${JSON.stringify(o.kit.facts)}\nBRIEF\n${o.brief}`),
      text(`Write the direction (music: ${bpm} BPM).`),
    )],
  });
  const raw = parseJson<Direction | Direction[]>(dirRes.text);
  const d = (Array.isArray(raw) ? raw[0] : raw) as Direction;
  d.sound = { ...(d.sound ?? { description: bd.sound }), bpm };
  if (o.exact) d.exact = true;
  // reference segment per scene: the shot times in exact mode, else in proportion to the beats
  const total = d.scenes.reduce((a, s) => a + s.beats, 0) || 1;
  let acc = 0;
  const shots = bd.shots ?? [];
  const windows = d.scenes.map((s, i) => {
    if (o.exact && shots.length === d.scenes.length && Number.isFinite(shots[i]?.start) && shots[i].end > shots[i].start) return { from: shots[i].start, to: Math.min(dur, shots[i].end) };
    const from = (acc / total) * dur;
    acc += s.beats;
    return { from, to: (acc / total) * dur };
  });
  const { parts } = await referenceClips(o.videoFile, windows);
  log(`3/3 rebuilding ${d.scenes.length} scenes`);
  // in exact mode the reference's own words are allowed on screen
  const words = shots.flatMap(s => s.text ?? []).join('\n');
  const res = await invent(llm, {
    ...o, kit, brief: o.exact ? `${o.brief}\n${words}` : o.brief, direction: d, bpm, seconds: Math.round(dur * 2) / 2,
    reference: { note: JSON.stringify({ summary: bd.summary, style: bd.style, typography: bd.typography, motion: bd.motion, texture: bd.texture, sound: bd.sound }), clips: parts, exact: o.exact },
  });
  if (res.video) {
    // the reference's own soundtrack (exact mode) and a side-by-side comparison
    const synth = res.video.replace(/\.mp4$/, '-synth.mp4');
    if (o.exact) {
      await ff(['-y', '-loglevel', 'error', '-i', res.video, '-c', 'copy', synth]);
      await ff(['-y', '-loglevel', 'error', '-i', synth, '-i', o.videoFile, '-map', '0:v', '-map', '1:a?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', res.video]);
    }
    const compare = res.video.replace(/\.mp4$/, '-compare.mp4');
    await ff(['-y', '-loglevel', 'error', '-i', o.videoFile, '-i', res.video,
      '-filter_complex', '[0:v]scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[a];[1:v]scale=960:540,setsar=1,fps=30[b];[a][b]hstack=inputs=2[v]',
      '-map', '[v]', '-map', o.exact ? '0:a?' : '1:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', compare]);
    log(`  side by side (reference | copy): ${compare}`);
  }
  return { ...res, breakdown: bd, usageExtra: [bdRes.usage, dirRes.usage] };
}

export type { BrandKit };
