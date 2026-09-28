import { describe, expect, it } from 'vitest';
import { spring } from '../src/engine/custom/toolkit';
import { background, boxOf, classify, frameStats, gaps, hottest, lagOf, overshoots, springFor, type RGB } from '../src/ai/inspect';

/** A white frame with filled rectangles (fractions) in the given colours. */
function frame(w: number, h: number, rects: { x0: number; y0: number; x1: number; y1: number; c: [number, number, number] }[], bg: [number, number, number] = [255, 255, 255]): RGB {
  const data = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h; p++) data.set(bg, p * 3);
  for (const r of rects)
    for (let y = Math.round(r.y0 * h); y < Math.round(r.y1 * h); y++)
      for (let x = Math.round(r.x0 * w); x < Math.round(r.x1 * w); x++) data.set(r.c, (y * w + x) * 3);
  return { w, h, data };
}

describe('detail inspector: measurements on one frame', () => {
  const grey: [number, number, number] = [200, 200, 200];
  // two cards side by side with a gutter of 0.02 of the width (38 px at 1920), and a pale pink haze
  const f = frame(480, 270, [
    { x0: 0.3, y0: 0.3, x1: 0.49, y1: 0.8, c: grey },
    { x0: 0.51, y0: 0.3, x1: 0.7, y1: 0.8, c: grey },
    { x0: 0.1, y0: 0.05, x1: 0.2, y1: 0.15, c: [255, 225, 232] },
  ]);

  it('finds the background, the content box and the pale tint separately', () => {
    expect(background(f)).toEqual([255, 255, 255]);
    const { content, tint } = classify(f);
    const box = boxOf(content, f.w, f.h)!;
    expect(box.x0).toBeCloseTo(0.3, 2);
    expect(box.x1).toBeCloseTo(0.7, 2);
    expect(box.y0).toBeCloseTo(0.3, 2);
    expect(tint.reduce((a, b) => a + b, 0) / (f.w * f.h)).toBeCloseTo(0.01, 2);
  });

  it('measures the gutter between the cards in px at 1920 wide', () => {
    const { content } = classify(f);
    const g = gaps(content, f.w, f.h, 'vertical');
    expect(g).toHaveLength(1);
    expect(g[0].at).toBeCloseTo(0.5, 2);
    expect(g[0].px).toBeGreaterThanOrEqual(36);
    expect(g[0].px).toBeLessThanOrEqual(40);
    // the same cards touching: no gutter
    const touching = frame(480, 270, [{ x0: 0.3, y0: 0.3, x1: 0.5, y1: 0.8, c: grey }, { x0: 0.5, y0: 0.3, x1: 0.7, y1: 0.8, c: grey }]);
    expect(gaps(classify(touching).content, 480, 270, 'vertical')).toEqual([]);
    expect(frameStats(touching).vGaps).toEqual([]);
  });

  it('zooms on the area where two frames differ', () => {
    const a = frame(240, 135, [{ x0: 0.7, y0: 0.7, x1: 0.8, y1: 0.8, c: [0, 0, 0] }]);
    const b = frame(240, 135, []);
    const z = hottest(a, b);
    expect(z.x0).toBeLessThanOrEqual(0.75);
    expect(z.x1).toBeGreaterThanOrEqual(0.75);
    expect(z.y0).toBeLessThanOrEqual(0.75);
    expect(z.y1).toBeGreaterThanOrEqual(0.75);
  });
});

describe('detail inspector: motion', () => {
  it('detects a spring pop-in and recovers matching S.spring settings', () => {
    const fps = 60;
    const size = (t: number) => 0.2 * spring(t - 0.2, 290, 23);
    const s = Array.from({ length: 90 }, (_, k) => size(k / fps));
    const found = overshoots(s, fps);
    expect(found).toHaveLength(1);
    expect(found[0].pct).toBeGreaterThan(0.04);
    expect(found[0].pct).toBeLessThan(0.09);
    const sp = springFor(found[0].pct, found[0].settle);
    // same character: similar overshoot when replayed
    const peak = Math.max(...Array.from({ length: 120 }, (_, k) => spring(k / 120, sp.stiffness, sp.damping)));
    expect(peak - 1).toBeGreaterThan(0.03);
    expect(peak - 1).toBeLessThan(0.1);
    // an ease-out without overshoot is not a bounce
    const smooth = Array.from({ length: 90 }, (_, k) => 0.2 * (1 - Math.pow(1 - Math.min(1, Math.max(0, (k / fps - 0.2) / 0.4)), 3)));
    expect(overshoots(smooth, fps)).toEqual([]);
  });

  it('finds how far one motion signal is shifted against another', () => {
    const a = Array.from({ length: 60 }, (_, k) => (k === 20 || k === 40 ? 1 : 0));
    const late = Array.from({ length: 60 }, (_, k) => (k === 24 || k === 44 ? 1 : 0));
    expect(lagOf(a, late, 10).shift).toBe(4);
    expect(lagOf(late, a, 10).shift).toBe(-4);
  });
});
