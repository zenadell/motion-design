import type { z } from 'zod';
import type { Audio } from '../audio/synth';
import type { Chord } from '../audio/chords';
import type { G } from '../core/draw';
import type { Theme } from '../core/theme';
import type { BrandRT } from '../assets/logo';

export type Category = 'intro' | 'type' | 'shape' | 'camera' | 'ui' | 'data' | 'brand' | 'outro' | 'custom';

/** A camera-shake / zoom-punch event, in section-local seconds. */
export interface Hit {
  at: number;
  shake: number;
  punch?: number;
}

export interface MusicRT {
  bpm: number;
  B: number;
  genre: string;
  chordAt(t: number): Chord;
}

export interface NeighbourInfo {
  technique: string;
  params: Record<string, unknown>;
}

/** Everything a technique needs to know about the section it is drawing. */
export interface Ctx {
  /** Seconds per beat. */
  B: number;
  /** Section start (absolute seconds) and length. */
  start: number;
  dur: number;
  beats: number;
  index: number;
  fps: number;
  theme: Theme;
  brand: BrandRT;
  music: MusicRT;
  captions: boolean;
  /** Music energy of this section (plan override or technique default). */
  energy: number;
  prev?: NeighbourInfo;
  next?: NeighbourInfo;
  /** Convert beats → seconds. */
  bt(beats: number): number;
}

export interface Technique<S extends z.ZodType = z.ZodType> {
  id: string;
  title: string;
  category: Category;
  /** One or two sentences a model can use to decide when to pick this. */
  summary: string;
  /** Extra authoring advice (copy length, pairing, pacing). */
  guidance?: string;
  /** Default HUD label. */
  label: string;
  params: S;
  beats: { min: number; max: number; default: number };
  /** Default music energy 0..3 while this section plays. */
  energy: 0 | 1 | 2 | 3;
  /** Whether the HUD overlay is shown (outros hide it). */
  hud?: boolean;
  /** A complete, valid params object used by the gallery and the catalog. */
  example: z.input<S>;
  /** Draw one frame. `lt` = seconds since the section started (may be negative during an incoming transition). */
  draw(g: G, lt: number, p: z.output<S>, c: Ctx): void;
  /** Schedule this section's sound design. `t0` = absolute section start. */
  sfx?(A: Audio, t0: number, p: z.output<S>, c: Ctx): void;
  hits?(p: z.output<S>, c: Ctx): Hit[];
  /** Local windows [from, to] (seconds) that deserve heavier motion blur. */
  fast?(p: z.output<S>, c: Ctx): Array<[number, number]>;
  /** Local [from, to] window (seconds) where the music bed plays; default is the whole section. */
  bed?(p: z.output<S>, c: Ctx): [number, number];
}

export function define<S extends z.ZodType>(t: Technique<S>): Technique<S> {
  return t;
}
