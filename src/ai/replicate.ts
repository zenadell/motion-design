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
  shots: { start: number; end: number; what: string; motion: string; text: string[]; transition: string }[];
}

const breakdownSchema = () => ({
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'what the film is and why it works, 3–4 sentences' },
    bpm: { type: 'number', description: 'tempo of the music (estimate from the cuts if there is no music)' },
    style: { type: 'string' },
    palette: { type: 'array', items: { type: 'string' }, description: '#RRGGBB colours in order of use' },
    typography: { type: 'string', description: 'families (describe), weights, sizes, case, tracking, how type moves' },
    motion: { type: 'string', description: 'easing, speed, rhythm, camera, transitions, signature moves' },
    texture: { type: 'string' },
    sound: { type: 'string', description: 'genre, instruments, structure, how sound effects sit on the picture' },
    shots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number' }, end: { type: 'number' },
          what: { type: 'string', description: 'exactly what is on screen and how it is composed' },
          motion: { type: 'string', description: 'exactly how everything moves, with timing and easing' },
          text: { type: 'array', items: { type: 'string' } },
          transition: { type: 'string', description: 'how it hands over to the next shot' },
        },
        required: ['start', 'end', 'what', 'motion', 'text', 'transition'],
      },
    },
  },
  required: ['summary', 'bpm', 'style', 'palette', 'typography', 'motion', 'texture', 'sound', 'shots'],
});

export interface ReplicateOptions extends Omit<InventOptions, 'direction' | 'reference' | 'seconds'> {
  videoFile: string;
  /** Keep the reference's colours instead of the brand palette. */
  keepColors?: boolean;
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

  log('2/3 adapting it to the brand');
  const bpm = Math.min(140, Math.max(90, Math.round(bd.bpm || 120)));
  const dirRes = await llm.json({
    label: 'adapt', effort: 'high', schema: directionSchema(),
    system: `You adapt a reference motion design film to a new brand, keeping its craft: the same structure, pacing, shot types, motion language, typography treatment and energy, so a viewer would recognise the style. Replace its copy with the brand's own words (from the brief and facts only; never invent numbers or claims), ${o.keepColors ? "keep the reference's colours" : "use the brand palette in the reference's colour roles"}, and end on the brand (logo, name, site) held still for the final 1.5 s. One scene per reference shot (merge very short shots if needed); scene beats = shot duration × ${bpm} / 60, in multiples of 0.5. Fonts: display from ${DISPLAY_NAMES.join(', ')}; serif from ${SERIF_NAMES.join(', ')}. Transitions: ${TRANSITIONS.join(', ')} (prefer "cut" with the reference's transition built into the scenes).`,
    turns: [user(text(`REFERENCE BREAKDOWN\n${JSON.stringify(bd, null, 1)}`), text(`BRAND\n${JSON.stringify({ ...o.kit.brand, logo: o.kit.brand.logo ? '(vector mark)' : '(monogram)' })}\nFACTS\n${JSON.stringify(o.kit.facts)}\nBRIEF\n${o.brief}`), text(`Write the direction (music: ${bpm} BPM).`))],
  });
  const d = parseJson<Direction>(dirRes.text);
  d.sound = { ...(d.sound ?? { description: bd.sound }), bpm };
  // reference segment per scene, in the reference's own timing
  const total = d.scenes.reduce((a, s) => a + s.beats, 0) || 1;
  let acc = 0;
  const windows = d.scenes.map(s => {
    const from = (acc / total) * dur;
    acc += s.beats;
    return { from, to: (acc / total) * dur };
  });
  const { parts } = await referenceClips(o.videoFile, windows);
  log(`3/3 rebuilding ${d.scenes.length} scenes`);
  const res = await invent(llm, {
    ...o, direction: d, bpm, seconds: Math.round(dur * 2) / 2,
    reference: { note: JSON.stringify({ summary: bd.summary, style: bd.style, typography: bd.typography, motion: bd.motion, texture: bd.texture, sound: bd.sound }), clips: parts },
  });
  return { ...res, breakdown: bd, usageExtra: [bdRes.usage, dirRes.usage] };
}

export type { BrandKit };
