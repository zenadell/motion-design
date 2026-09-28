import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath } from '../cli/render';

// Still frames from a video clip, for models that read images but not video:
// the critique and rewrite prompts still show them what the render looks like.

function ffmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', d => (err += d));
    ff.on('error', reject);
    ff.on('close', () => resolve(err));
  });
}

/** Up to `n` evenly spaced JPEG frames (width px) and the clip's duration in seconds. */
export async function videoFrames(video: Buffer, n = 8, width = 640): Promise<{ frames: Buffer[]; seconds: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'motion-frames-'));
  try {
    const src = join(dir, 'clip.mp4');
    writeFileSync(src, video);
    const info = await ffmpeg(['-hide_banner', '-i', src]);
    const m = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
    const seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 4;
    await ffmpeg(['-y', '-loglevel', 'error', '-i', src, '-vf', `fps=${(n / Math.max(0.1, seconds)).toFixed(4)},scale=${width}:-2`, '-frames:v', String(n), '-q:v', '4', join(dir, 'f%02d.jpg')]);
    const frames = readdirSync(dir).filter(f => f.endsWith('.jpg')).sort().map(f => readFileSync(join(dir, f)));
    return { frames, seconds };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
