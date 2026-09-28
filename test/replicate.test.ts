import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ffmpegPath } from '../src/cli/render';
import { ssimOf } from '../src/ai/inspect';
import { frameLogFor, referenceFrames } from '../src/ai/replicate';

describe('replicate: reference stills', () => {
  it('slices the frame log to a shot, with times from the shot start', () => {
    const log = [0, 0.25, 0.5, 0.75, 1, 1.25].map(t => ({ t, onScreen: `f${t}` }));
    expect(frameLogFor(log, 0.5, 1.25)).toBe('t=0.00 s: f0.5\nt=0.25 s: f0.75\nt=0.50 s: f1');
    expect(frameLogFor(undefined, 0, 1)).toBe('');
  });

  it('extracts timed stills at the requested rate, no wider than the source', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'motion-reftest-'));
    try {
      const clip = join(dir, 'clip.mp4');
      const r = spawnSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2', '-pix_fmt', 'yuv420p', clip]);
      expect(r.status).toBe(0);
      const frames = await referenceFrames(clip, 4);
      expect(frames.length).toBeGreaterThanOrEqual(8);
      expect(frames.length).toBeLessThanOrEqual(9);
      expect(frames[1].t).toBeCloseTo(0.25);
      // JPEG, and the 320-px source is not upscaled to 1024
      expect(frames[0].jpg.subarray(0, 2).toString('hex')).toBe('ffd8');
      const sof = frames[0].jpg.indexOf(Buffer.from([0xff, 0xc0]));
      expect(frames[0].jpg.readUInt16BE(sof + 7)).toBe(320);
      // fidelity: a clip against itself is ~identical, against another picture it is not
      const other = join(dir, 'other.mp4');
      spawnSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=2', '-pix_fmt', 'yuv420p', other]);
      expect(await ssimOf(clip, 0, 1, clip)).toBeGreaterThan(0.98);
      expect((await ssimOf(clip, 0, 1, other))!).toBeLessThan(0.8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
