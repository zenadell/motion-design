import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ffmpegPath } from '../src/cli/render';
import { ssimOf } from '../src/ai/inspect';
import { alignToShots, frameLogFor, referenceFrames, sceneWindows } from '../src/ai/replicate';

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

describe('replicate: exact timing', () => {
  const shot = (start: number, end: number) => ({ start, end, what: '', motion: '', text: [] as string[], transition: 'cut' });
  const dir = (beats: number[]) => ({ scenes: beats.map((b, i) => ({ id: `s${i}`, beats: b })) }) as never;
  const bd = (shots: ReturnType<typeof shot>[]) => ({ shots }) as never;

  it("gives each scene its shot's length on the quarter-beat grid, without drift", () => {
    // 110 BPM: 1.25 s = 2.29 beats, 0.75 s = 1.375 beats; the director's rounding (2.5, 2) drifted 2.8 s over the film
    const shots = [shot(0, 1.25), shot(1.25, 2.5), shot(2.5, 3.75), shot(3.75, 4.5), shot(4.5, 5.25), shot(5.25, 6.25)];
    const d = dir([2.5, 2.5, 2.5, 2, 2, 2]);
    const w = alignToShots(bd(shots), d, 6.25, 110);
    expect(w.map(x => x.from)).toEqual([0, 1.25, 2.5, 3.75, 4.5, 5.25]);
    const beats = (d as { scenes: { beats: number }[] }).scenes.map(s => s.beats);
    let t = 0;
    beats.forEach((b, i) => {
      t += (b * 60) / 110;
      expect(Math.abs(t - shots[i].end)).toBeLessThanOrEqual(0.25 * 60 / 110 / 2 + 1e-9);
      expect(b % 0.25).toBe(0);
    });
  });

  it('matches scenes to shots by their words when the director made fewer scenes than shots', () => {
    // the TikTok run: 14 shots, 12 scenes written one per shot and the last two shots cut off.
    // By length alone "card-wall" would swallow the next shot and every later scene would copy the wrong shot.
    const ends = [1.25, 2.5, 3.75, 4.5, 5.25, 6.25, 7.25, 9.75, 10.5, 12, 13, 13.75, 15.25, 16.75];
    const words = [['Welcome'], ['to your'], ['Personalised', 'music space'], ['Personalised', 'music space'], [], ['What do you want to play?', 'DOECHII'], ['Discover new sounds'],
      ['K-pop', 'Chill', 'FRIDAY'], ['and skip through'], ['Sparks', 'Coldplay', 'and collect'], ['Added to', 'Liked', 'Songs'], [], [], ['what you like']];
    const shots = ends.map((e, i) => ({ ...shot(i ? ends[i - 1] : 0, e), text: words[i] }));
    const d = { scenes: [2.5, 2.5, 2.5, 2, 2, 2, 2, 5.5, 2, 3.5, 2, 2].map((b, i) => ({ id: `s${i}`, beats: b, onscreenText: words[i] })) } as never;
    const w = sceneWindows(bd(shots), d, 16.75, true);
    expect(w.map(x => x.from)).toEqual([0, ...ends.slice(0, 11)]);
    expect(w.at(-1)).toEqual({ from: 13, to: 16.75 });
  });

  it('groups merged shots by length when the words do not tell', () => {
    // 3 shots, 2 scenes: a 1 s scene and a 3 s scene over shots of 1, 1.5 and 1.5 s
    const shots = [shot(0, 1), shot(1, 2.5), shot(2.5, 4)];
    const w = sceneWindows(bd(shots), dir([1, 3]), 4, true);
    expect(w).toEqual([{ from: 0, to: 1 }, { from: 1, to: 4 }]);
  });

  it('keeps the old proportional windows when the shots cannot be used', () => {
    const w = sceneWindows(bd([]), dir([2, 2]), 4, true);
    expect(w).toEqual([{ from: 0, to: 2 }, { from: 2, to: 4 }]);
  });
});
