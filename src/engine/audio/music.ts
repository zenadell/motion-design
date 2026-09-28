// The music bed: a genre groove generated from the timeline so it always
// matches the cut. Each section's `energy` picks how much of the kit plays;
// techniques add their own accents on top via `sfx`.

import type { Music } from '../../plan/schema';
import type { Timeline } from '../core/timeline';
import type { MusicRT } from '../techniques/types';
import { DEFAULT_PROGRESSIONS, parseChord, type Chord } from './chords';
import * as S from './synth';
import type { Audio } from './synth';

export function makeMusic(m: Music, B: number): MusicRT {
  const chords: Chord[] = (m.progression ?? DEFAULT_PROGRESSIONS[m.genre]).map(parseChord);
  return {
    bpm: m.bpm,
    B,
    genre: m.genre,
    chordAt: (t: number) => chords[Math.floor(Math.max(0, t + 1e-6) / (4 * B)) % chords.length],
  };
}

type Groove = (A: Audio, from: number, to: number, level: number, M: MusicRT) => void;

/** Afro-house: four-on-the-floor, swung shakers, congas, clave and log drums. */
const afroHouse: Groove = (A, from, to, level, M) => {
  const s16 = M.B / 4;
  const buildEnd = level === 3 ? to - M.B : Infinity;
  for (let i = Math.ceil(from / s16 - 1e-6); i * s16 < to - 1e-6; i++) {
    const t = i * s16, st = i % 16, sw = st % 2 ? 0.012 * (M.B / 0.5) : 0;
    if (st % 4 === 0 && t < buildEnd) S.kick(A, t, 0.92);
    if (st === 4 || st === 12) S.clap(A, t, 0.4, 0.05);
    S.shaker(A, t + sw, [0.05, 0.028, 0.075, 0.032][st % 4], st % 2 ? 0.28 : 0.12);
    if (st % 4 === 2) S.hat(A, t, 0.045, true, -0.15);
    if (level >= 2) {
      const cg = ({ 2: 62, 5: 55, 7: 60, 10: 62, 13: 55, 15: 60 } as Record<number, number>)[st];
      if (cg) S.conga(A, t + sw, cg, 0.22, st % 3 ? 0.35 : -0.35);
      if ([0, 3, 6, 10, 12].includes(st)) S.clave(A, t, 0.06);
    }
    const ld = ({ 0: 0, 3: 0, 6: 12, 10: 0, 11: 7, 14: 12 } as Record<number, number>)[st];
    if (ld !== undefined && t < buildEnd) S.logDrum(A, t, M.chordAt(t).bass + ld, 0.4, st === 6 || st === 14 ? 0.24 : 0.32);
  }
};

/** Electro / house: kick, clap, off-beat hats and a pumping saw bass. */
const electro: Groove = (A, from, to, level, M) => {
  const s16 = M.B / 4;
  const buildEnd = level === 3 ? to - M.B : Infinity;
  for (let i = Math.ceil(from / s16 - 1e-6); i * s16 < to - 1e-6; i++) {
    const t = i * s16, st = i % 16;
    if (st % 4 === 0 && t < buildEnd) S.kick(A, t, 0.9);
    if (st === 4 || st === 12) S.clap(A, t, 0.42, 0.05);
    if (st % 4 === 2) S.hat(A, t, 0.11, false, 0.18);
    else if (level >= 2 && st % 2 === 1) S.hat(A, t, 0.04, false, -0.22);
    if (st % 2 === 0 && t < buildEnd) S.sawBass(A, t, M.chordAt(t).bass + [0, 0, 12, 0, 0, 12, 0, 12][(st / 2) % 8], M.B * 0.38, 0.3);
    if (level >= 2 && st % 8 === 6) S.hat(A, t, 0.05, true, 0.2);
  }
};

const GROOVES: Record<string, Groove> = { 'afro-house': afroHouse, electro };

export function scoreBed(A: Audio, tl: Timeline, M: MusicRT, beds: Array<[number, number]>): void {
  const groove = GROOVES[M.genre] ?? afroHouse;
  let prevEnergy = 0;
  tl.sections.forEach((s, i) => {
    const e = s.energy, from = s.start + Math.max(0, beds[i][0]), end = Math.min(s.end, s.start + beds[i][1]);
    if (e > 0 && end > from) {
      groove(A, from, end, e, M);
      for (let t = from; t < end - 1e-6; ) {
        const segEnd = Math.min(end, (Math.floor(t / (M.B * 4) + 1e-6) + 1) * M.B * 4, t + M.B * 2);
        S.pad(A, t, segEnd, M.chordAt(t).pad, M.genre === 'electro' ? 0.018 : 0.026);
        t = segEnd;
      }
      if (e > prevEnergy && from === s.start) S.crash(A, s.start, 0.14 + 0.04 * (e - prevEnergy), 1.2);
      if (e === 3) {
        S.riser(A, Math.max(from, s.end - M.B * 2), s.end - 0.01, 0.22);
        [1, 0.75, 0.5, 0.375, 0.25, 0.1875, 0.125].forEach((o, k) => S.clap(A, s.end - o * M.B, 0.14 + k * 0.045));
      }
    }
    prevEnergy = e;
  });
}

/** Duck the bass/pad bus on every kick — the pumping "sidechain" feel. */
export function sidechain(A: Audio): void {
  const dg = A.duck.gain;
  dg.setValueAtTime(1, 0);
  let last = -1;
  for (const k of [...new Set(A.kicks)].sort((a, b) => a - b)) {
    if (k - last < 0.12) continue;
    dg.setValueAtTime(1, k);
    dg.linearRampToValueAtTime(0.35, k + 0.005);
    dg.linearRampToValueAtTime(1, k + 0.18);
    last = k;
  }
}
