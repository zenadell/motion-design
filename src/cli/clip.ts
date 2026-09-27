import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Reel } from './browser';
import { dataUrlToBuffer } from './browser';
import { ffmpegPath } from './render';

// Small preview clips of a reel (e.g. one per scene) for a vision model to
// watch: scaled-down JPEG frames piped into ffmpeg, optionally with the
// matching slice of the soundtrack so the model can judge sync with the music.

export interface ClipOptions {
  width?: number;
  fps?: number;
  /** Include the soundtrack (rendered once per reel). */
  audio?: boolean;
  crf?: number;
}

function run(args: string[], input?: Buffer[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', d => (err += d));
    ff.on('error', reject);
    ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-400)}`))));
    if (input) {
      (async () => {
        for (const b of input) if (!ff.stdin.write(b)) await new Promise(r => ff.stdin.once('drain', r));
        ff.stdin.end();
      })().catch(reject);
    } else ff.stdin.end();
  });
}

/** Render clips for [from, to] windows (seconds). Returns MP4 buffers in the same order. */
export async function renderClips(reel: Reel, windows: { from: number; to: number }[], o: ClipOptions = {}): Promise<Buffer[]> {
  const width = o.width ?? 640, fps = o.fps ?? 24;
  const tmp = mkdtempSync(join(tmpdir(), 'motion-clip-'));
  try {
    let wav: string | undefined;
    if (o.audio) {
      wav = join(tmp, 'track.wav');
      writeFileSync(wav, Buffer.from(await reel.page.evaluate(() => window.__reel!.wav!()), 'base64'));
    }
    const out: Buffer[] = [];
    for (const [k, w] of windows.entries()) {
      const n = Math.max(1, Math.round((w.to - w.from) * fps));
      const frames: Buffer[] = [];
      for (let i = 0; i < n; i++) {
        const t = w.from + i / fps;
        frames.push(dataUrlToBuffer(await reel.page.evaluate(([x, wd]) => window.__reel!.thumb!(x, wd), [t, width] as const)));
      }
      const file = join(tmp, `clip-${k}.mp4`);
      const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
      if (wav) args.push('-ss', w.from.toFixed(3), '-t', (n / fps).toFixed(3), '-i', wav);
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf ?? 28), '-pix_fmt', 'yuv420p');
      if (wav) args.push('-c:a', 'aac', '-b:a', '96k', '-shortest');
      args.push(file);
      await run(args, frames);
      out.push(readFileSync(file));
    }
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
