import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath } from '../cli/render';
import { DISPLAY_NAMES, SERIF_NAMES } from '../plan/fonts';
import { TRANSITIONS } from '../plan/schema';
import type { BrandKit } from './brand-kit';
import { invent, type InventOptions } from './invent';
import { directionSchema, type Direction } from './invent-prompts';
import craft from '../../docs/motion-craft.md?raw';
import { image, parseJson, text, user, video, type LLM, type Part, type Usage } from './llm';

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

/**
 * Sharp still frames at a steady rate, with their times: a model reads small
 * words and measures layout from these far better than from a compressed clip.
 */
export async function referenceFrames(file: string, fps: number, width = 1024): Promise<{ t: number; jpg: Buffer }[]> {
  const tmp = mkdtempSync(join(tmpdir(), 'motion-refframes-'));
  try {
    await ff(['-y', '-loglevel', 'error', '-i', file, '-vf', `fps=${fps},scale='min(${width},iw)':-2`, '-q:v', '3', join(tmp, 'f%04d.jpg')]);
    return readdirSync(tmp).filter(f => f.endsWith('.jpg')).sort().map((f, k) => ({ t: k / fps, jpg: readFileSync(join(tmp, f)) }));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The frame log entries inside a window, with times relative to its start. */
export function frameLogFor(log: Breakdown['frameLog'], from: number, to: number): string {
  return (log ?? [])
    .filter(e => e.t >= from - 1e-3 && e.t < to - 1e-3)
    .map(e => `t=${(e.t - from).toFixed(2)} s: ${e.onScreen}`)
    .join('\n');
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
  /** What is on screen at each reference frame, read from the stills. */
  frameLog?: { t: number; onScreen: string }[];
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
    frameLog: {
      type: 'array',
      description: 'one entry per still frame you were shown, in order, written BEFORE the shots',
      items: {
        type: 'object',
        properties: {
          t: { type: 'number', description: 'the frame time in seconds, as labelled' },
          onScreen: { type: 'string', description: 'one compact line (under 60 words): the visible text copied character for character with its colour, size (% of frame height) and centre (% x, % y); shapes and UI parts with their boxes (% of the frame) and colours; glows. When little changed, write "as before, except …"' },
        },
        required: ['t', 'onScreen'],
      },
    },
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
  required: ['summary', 'bpm', 'style', 'palette', 'typography', 'font', 'motion', 'texture', 'sound', 'frameLog', 'shots'],
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
  /** Stop after the breakdown and direction (both written to outDir): a cheap check before the rebuild. */
  planOnly?: boolean;
  /** Rebuild from the breakdown.json and direction.json already in outDir (from a --plan-only run). */
  reusePlan?: boolean;
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

/** The critic watches the reference and writes the frame log and the shot list. */
async function breakdown(critic: LLM, file: string, dur: number, outDir: string): Promise<{ bd: Breakdown; usage: Usage }> {
  const { full } = await referenceClips(file, []);
  // the clip for motion and sound, and sharp timed stills for words and layout
  const fps = Math.min(4, Math.max(0.5, Math.floor((72 / Math.max(1, dur)) * 2) / 2));
  const stills = await referenceFrames(file, fps);
  const stillParts: Part[] = stills.flatMap(f => [text(`t=${f.t.toFixed(2)} s`), image(f.jpg, 'image/jpeg')]);
  const bdRes = await critic.json({
    label: 'breakdown', effort: 'high', schema: breakdownSchema(),
    system: `You are a senior motion designer breaking down a reference film so a team can rebuild it shot for shot. Watch it closely (with sound) and describe everything that makes it work: every shot with its exact start and end time, composition, what moves and how (timing, easing, overshoot, stagger), typography, colour, texture, camera, transitions, and the music. Be precise: numbers, positions, sizes relative to the frame, beat positions.

You also get sharp still frames every ${(1 / fps).toFixed(2)} s, each labelled with its time. Work from them first: fill frameLog with one entry per still (read every word exactly as written, however small; measure sizes and positions against the frame; note colours), then derive the shots from the log: a new shot starts where the composition changes. Words must match the frames character for character; never guess or complete a phrase. Small elements stay small: report the size you measure, not a typical one.

# Craft handbook (vocabulary)
${craft}`,
    turns: [user(video(full, 12), text(`${stills.length} STILL FRAMES (${fps} per second)`), ...stillParts, text('Break this film down: the frame log first, then the shots.'))],
  });
  try {
    return { bd: parseJson<Breakdown>(bdRes.text), usage: bdRes.usage };
  } catch (e) {
    writeFileSync(join(outDir, 'breakdown.raw.txt'), bdRes.text);
    throw e;
  }
}

function loadPlan(dir: string): { breakdown: Breakdown; direction: Direction } | undefined {
  const bf = join(dir, 'breakdown.json'), df = join(dir, 'direction.json');
  if (!existsSync(bf) || !existsSync(df)) return undefined;
  return { breakdown: JSON.parse(readFileSync(bf, 'utf8')) as Breakdown, direction: JSON.parse(readFileSync(df, 'utf8')) as Direction };
}

export async function replicate(llm: LLM, o: ReplicateOptions) {
  const log = o.log ?? (() => {});
  const critic = o.criticLLM ?? llm;
  const dur = await videoDuration(o.videoFile);
  mkdirSync(o.outDir, { recursive: true });
  // a plan saved by an earlier run (--plan-only) skips the breakdown and direction calls
  const saved = o.reusePlan ? loadPlan(o.outDir) : undefined;
  const usageExtra: Usage[] = [];
  let bd: Breakdown;
  if (saved) {
    bd = saved.breakdown;
    log(`1/3 reusing the saved breakdown (${join(o.outDir, 'breakdown.json')})`);
  } else {
    log(`1/3 watching the reference (${dur.toFixed(1)} s)`);
    const r = await breakdown(critic, o.videoFile, dur, o.outDir);
    bd = r.bd;
    usageExtra.push(r.usage);
    writeFileSync(join(o.outDir, 'breakdown.json'), JSON.stringify(bd, null, 2));
  }
  log(`  ${bd.shots.length} shots · ${bd.bpm} BPM · ${bd.style}`);

  const bpm = Math.min(140, Math.max(90, Math.round(bd.bpm || 120)));
  let kit = o.kit;
  if (o.exact) {
    // the reference's look, not the brand's
    const roles = paletteRoles(bd.palette ?? []);
    const font = (DISPLAY_NAMES as readonly string[]).includes(bd.font ?? '') ? bd.font! : kit.brand.fonts.display;
    kit = { ...kit, brand: { ...kit.brand, ...(roles ? { colors: { ...kit.brand.colors, ...roles } } : {}), fonts: { ...kit.brand.fonts, display: font } } } as typeof kit;
  }
  let d: Direction;
  if (saved) d = saved.direction;
  else {
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
    d = (Array.isArray(raw) ? raw[0] : raw) as Direction;
    usageExtra.push(dirRes.usage);
  }
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
  if (o.exact && bd.frameLog?.length && !saved) {
    // the coder gets the measured frames of its own shot verbatim
    d.scenes.forEach((s, i) => {
      const lines = frameLogFor(bd.frameLog, windows[i].from, windows[i].to);
      if (lines) s.idea = `${s.idea}\n\nREFERENCE FRAME LOG FOR THIS SHOT (seconds from the scene start; this is ground truth for words, sizes, positions and colours):\n${lines}`;
    });
  }
  if (o.planOnly) {
    writeFileSync(join(o.outDir, 'direction.json'), JSON.stringify(d, null, 2));
    return { breakdown: bd, direction: d, windows, usageExtra };
  }
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
  return { ...res, breakdown: bd, usageExtra };
}

export type { BrandKit };
