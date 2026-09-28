// Chord symbols → MIDI voicings. Deliberately small: enough vocabulary for
// pop / house / afro progressions, and strict enough to validate model output.

const PC: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  '9': [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
  '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '6/9': [0, 4, 7, 9, 14], sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6], aug: [0, 4, 8],
};

export const CHORD_RE = /^([A-G](?:#|b)?)(maj7|maj9|madd9|m7|m9|m6|m|7|9|add9|6\/9|6|sus2|sus4|dim|aug)?$/;

export interface Chord {
  name: string;
  root: number;      // pitch class 0..11
  bass: number;      // MIDI note for the bass / log drum (E1..D#2 region)
  pad: number[];     // MIDI notes for pads & stabs, voiced around C3..C5
  minor: boolean;
}

export function parseChord(name: string): Chord {
  const m = CHORD_RE.exec(name.trim());
  if (!m) throw new Error(`Unknown chord "${name}"`);
  const root = PC[m[1]];
  const q = m[2] ?? '';
  const iv = QUALITY[q];
  let base = 48 + root;
  if (base > 55) base -= 12;
  const pad = iv.map(i => base + i).map(n => (n > 74 ? n - 12 : n)).sort((a, b) => a - b);
  let bass = 24 + root;
  if (bass < 28) bass += 12;
  return { name, root, bass, pad, minor: q.startsWith('m') && !q.startsWith('maj') };
}

export const DEFAULT_PROGRESSIONS: Record<string, string[]> = {
  'afro-house': ['Fm9', 'Dbmaj9', 'Eb6/9', 'Cm7'],
  electro: ['Am', 'F', 'C', 'G'],
};

export const midi = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
