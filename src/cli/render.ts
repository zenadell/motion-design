import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Page } from 'playwright';
import type { Plan } from '../plan/schema';
import { dataUrlToBuffer, openReel, type Reel } from './browser';

const require = createRequire(import.meta.url);
export const ffmpegPath = (): string => process.env.MOTION_FFMPEG_PATH || (require('ffmpeg-static') as string);

export async function renderAudio(reel: Reel, out: string): Promise<void> {
  mkdirSync(dirname(out), { recursive: true });
  const b64 = await reel.page.evaluate(() => window.__reel!.wav!());
  writeFileSync(out, Buffer.from(b64, 'base64'));
}

export interface VideoOptions {
  crf: number;
  workers: number;
  blur: number;
  from?: number;
  to?: number;
  log?: (s: string) => void;
}

/** Render frames in parallel pages, stream them in order into ffmpeg with the soundtrack. */
export async function renderVideo(plan: Plan, out: string, o: VideoOptions): Promise<{ frames: number; seconds: number }> {
  const log = o.log ?? (() => undefined);
  const reel = await openReel(plan);
  const t0 = Date.now();
  try {
    mkdirSync(dirname(out), { recursive: true });
    const tmp = mkdtempSync(join(tmpdir(), 'motion-audio-'));
    const wav = join(tmp, 'soundtrack.wav');
    await renderAudio(reel, wav);
    const first = Math.max(0, Math.round((o.from ?? 0) * reel.fps));
    const last = Math.min(Math.round(reel.duration * reel.fps), o.to !== undefined ? Math.round(o.to * reel.fps) : Infinity);
    const n = last - first;
    const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(reel.fps), '-c:v', 'png', '-i', '-',
      '-ss', String(first / reel.fps), '-i', wav, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(o.crf), '-pix_fmt', 'yuv420p',
      '-profile:v', 'high', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out];
    const ff = spawn(ffmpegPath(), args, { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise<number>(r => ff.on('close', code => r(code ?? 1)));
    const pages: Page[] = [reel.page];
    for (let k = 1; k < Math.max(1, o.workers); k++) pages.push(await reel.open());
    const ready = new Map<number, Buffer>();
    let next = 0, written = 0;
    const waiters: Array<() => void> = [];
    const flush = async () => {
      while (ready.has(written)) {
        const buf = ready.get(written)!;
        ready.delete(written);
        written++;
        if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
        if (written % 60 === 0 || written === n) {
          const el = (Date.now() - t0) / 1000;
          log(`frame ${written}/${n}  ${el.toFixed(0)}s elapsed  ~${((el / written) * (n - written)).toFixed(0)}s left`);
        }
      }
      waiters.splice(0).forEach(r => r());
    };
    let flushing = Promise.resolve();
    await Promise.all(pages.map(async page => {
      for (;;) {
        const i = next++;
        if (i >= n) return;
        while (i - written > pages.length * 4) await new Promise<void>(r => waiters.push(r));
        const d = await page.evaluate(([f, s]) => window.__reel!.frame!(f, s), [first + i, o.blur] as const);
        ready.set(i, dataUrlToBuffer(d));
        flushing = flushing.then(flush);
      }
    }));
    await flushing;
    ff.stdin.end();
    const code = await done;
    rmSync(tmp, { recursive: true, force: true });
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    if (reel.errors.length) log(`page errors:\n${reel.errors.join('\n')}`);
    return { frames: n, seconds: (Date.now() - t0) / 1000 };
  } finally {
    await reel.close();
  }
}

/** Good default still times: one near each section start, one mid-section, one at each transition. */
export function autoTimes(reel: Reel): number[] {
  const ts: number[] = [];
  for (const s of reel.sections) {
    const d = s.end - s.start;
    ts.push(s.start + Math.min(0.12, d * 0.1), s.start + d * 0.55);
  }
  return ts.map(t => Math.min(reel.duration - 0.02, Math.round(t * 100) / 100));
}
