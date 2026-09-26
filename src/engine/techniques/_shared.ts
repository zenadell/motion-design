import { rgba, readableOn } from '../core/color';
import { caption, H, makeLayer, W, type G } from '../core/draw';
import { pulse } from '../core/math';
import type { Ctx } from './types';

export type Pos = 'tl' | 'tr' | 'bl' | 'br';

/** Designer margin note. Colour adapts to the background it sits on. */
export function cap(g: G, c: Ctx, lines: string[], pos: Pos, bg: string): void {
  if (!c.captions || !lines.length) return;
  const col = rgba(readableOn(bg, c.theme.text, c.theme.dark), 0.55);
  const x = pos === 'tl' || pos === 'bl' ? 96 : W - 96;
  const y = pos === 'tl' || pos === 'tr' ? 150 : H - 170;
  caption(g, lines, x, y, col, pos === 'tr' || pos === 'br' ? 'right' : 'left');
}

/** Pulse on every beat of the section (sections start on beats). */
export const beatPulse = (lt: number, c: Ctx, k = 7): number => pulse(lt, Math.floor(lt / c.B) * c.B, k);

let scratch: [HTMLCanvasElement, G] | null = null;
/** A full-frame offscreen layer techniques may draw into (not re-entrant). */
export function scratchLayer(): [HTMLCanvasElement, G] {
  if (!scratch) scratch = makeLayer();
  return scratch;
}

/** Where the globe sits — particle-morph's "ring" exit lands exactly on it. */
export const GLOBE = { x: 1300, y: 560, r: 390 };

/** Ascending chord tones from MIDI `from` upward — handy for melodic SFX. */
export function chordTones(pad: number[], from: number, count: number): number[] {
  const pcs = [...new Set(pad.map(n => n % 12))].sort((a, b) => a - b);
  const out: number[] = [];
  for (let n = from; out.length < count && n < from + 60; n++) if (pcs.includes(n % 12)) out.push(n);
  return out;
}

/** Tone pairs used by type techniques. */
export type Tone = 'dark' | 'light' | 'brand';
export function tone(c: Ctx, t: Tone): { bg: string; fg: string } {
  const T = c.theme;
  if (t === 'light') return { bg: T.light, fg: T.dark };
  if (t === 'brand') return { bg: T.primary, fg: readableOn(T.primary, T.light, T.dark) };
  return { bg: T.bg, fg: T.text };
}
