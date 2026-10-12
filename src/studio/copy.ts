import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ssimOf } from '../ai/inspect';
import { videoDuration } from '../ai/replicate';
import { ffmpegPath, renderVideo } from '../cli/render';
import { formatIssues, validatePlan } from '../plan/validate';
import type { Brand, Plan } from '../plan/schema';
import { measureVideo, type Measured } from './measure';

// `motion studio copy`: measure a reference film into a comp, render it, put
// the reference's own soundtrack under it, and score it against the reference.

export function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`))));
  });
}

const HEX6 = /^#[0-9a-f]{6}$/i;

/** A neutral brand built from the measured colours (the copy keeps the reference's own look). */
export function brandFrom(m: Measured): Brand {
  const bg = typeof m.comp.background === 'string' ? m.comp.background : Array.isArray(m.comp.background) ? String(m.comp.background[0].v) : '#000000';
  const colors = m.tracks.map(t => t.color).filter(c => HEX6.test(c) && c.toLowerCase() !== bg.toLowerCase());
  return {
    name: 'Copy',
    colors: { bg: HEX6.test(bg) ? bg : '#000000', text: colors[0] ?? '#FFFFFF', primary: colors[1] ?? colors[0] ?? '#FFFFFF' },
  } as Brand;
}

export function planFor(m: Measured, brand: Brand, fps = 30): Plan {
  const input = {
    version: 1,
    meta: { title: 'Measured copy', fps, hud: false, captions: false, grain: 0 },
    brand,
    music: { bpm: 120, volume: 0 },
    sections: [{ technique: `comp:${m.comp.id}`, beats: Math.round(m.duration * 2 * 1000) / 1000, energy: 0 }],
    studio: { comps: [m.comp], assets: m.assets },
  };
  const r = validatePlan(input);
  if (!r.ok) throw new Error(`the measured plan does not validate:\n${formatIssues(r.errors)}`);
  return r.plan;
}

export interface CopyOptions {
  out: string;
  from?: number;
  to?: number;
  fps?: number;
  brand?: Brand;
  render?: boolean;
  workers?: number;
  blur?: number;
  log?: (s: string) => void;
}

export interface CopyResult { plan: Plan; measured: Measured; ssim?: number; video?: string; compare?: string }

export async function copyFilm(ref: string, o: CopyOptions): Promise<CopyResult> {
  const log = o.log ?? (() => undefined);
  const total = await videoDuration(ref);
  const from = Math.max(0, o.from ?? 0), to = Math.min(o.to ?? total, total);
  if (!(to > from)) throw new Error(`nothing to copy between ${from} and ${to} s (the film is ${total.toFixed(2)} s)`);
  if (to - from > 32) throw new Error(`a copy covers up to 32 s at a time (asked for ${(to - from).toFixed(1)} s); use --from/--to`);
  mkdirSync(o.out, { recursive: true });
  const t0 = Date.now();
  log(`measuring ${ref} ${from.toFixed(2)}–${to.toFixed(2)} s…`);
  const m = await measureVideo(ref, { from, to, fps: o.fps ?? 30 });
  log(`measured in ${((Date.now() - t0) / 1000).toFixed(1)} s\n${m.report}`);
  const plan = planFor(m, o.brand ?? brandFrom(m), 30);
  writeFileSync(join(o.out, 'plan.json'), JSON.stringify(plan, null, 1));
  writeFileSync(join(o.out, 'measure.txt'), m.report + '\n');
  const res: CopyResult = { plan, measured: m };
  if (o.render === false) return res;
  const silent = join(o.out, 'copy.silent.mp4'), video = join(o.out, 'copy.mp4');
  await renderVideo(plan, silent, { crf: 16, workers: o.workers ?? 3, blur: o.blur ?? 4, log: s => log(s) });
  // the reference's own soundtrack, if it has one
  await run(['-y', '-i', silent, '-ss', from.toFixed(3), '-t', (to - from).toFixed(3), '-i', ref, '-map', '0:v', '-map', '1:a?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', video]).catch(() => renameSync(silent, video));
  res.video = video;
  res.ssim = await ssimOf(ref, from, to - from, video);
  const compare = join(o.out, 'compare.mp4');
  await run(['-y', '-ss', from.toFixed(3), '-t', (to - from).toFixed(3), '-i', ref, '-i', video, '-filter_complex',
    '[0:v]scale=960:540,setsar=1,fps=30[a];[1:v]scale=960:540,setsar=1,fps=30[b];[a][b]hstack=inputs=2', '-c:v', 'libx264', '-crf', '22', '-pix_fmt', 'yuv420p', '-an', compare]);
  res.compare = compare;
  writeFileSync(join(o.out, 'measure.txt'), `${m.report}\nfidelity (SSIM vs reference): ${res.ssim?.toFixed(3) ?? 'n/a'}\n`);
  return res;
}
