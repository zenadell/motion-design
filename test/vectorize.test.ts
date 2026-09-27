import { describe, expect, it } from 'vitest';
import { isolateIcon, logoMask, maskToPath, singlePathD, simplify, vectorizeLogo } from '../src/ai/vectorize';

const W = 120, H = 80;
function draw(fn: (x: number, y: number) => boolean, w = W, h = H): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = fn(x, y) ? 1 : 0;
  return m;
}
const ring = (x: number, y: number) => { const r = Math.hypot(x - 40, y - 40); return r < 30 && r > 15; };
const signedArea = (sub: string) => {
  const p = sub.replace(/^M|Z$/g, '').split('L').map(s => s.split(' ').map(Number));
  return p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0) / 2;
};

describe('vectorize', () => {
  it('traces a ring as an outer loop and an opposite-wound hole', () => {
    const v = maskToPath(draw(ring), W, H)!;
    expect(v.contours).toBe(2);
    const subs = v.d.split(/(?=M)/);
    const areas = subs.map(signedArea).sort((a, b) => Math.abs(b) - Math.abs(a));
    expect(Math.sign(areas[0])).toBe(-Math.sign(areas[1]));
    expect(v.box[2]).toBeGreaterThan(55);
    expect(v.box[2]).toBeLessThan(62);
    expect(v.d.length).toBeLessThan(2000); // simplified, not one vertex per pixel
  });

  it('simplify keeps corners of a square', () => {
    const sq: [number, number][] = [];
    for (let i = 0; i < 10; i++) sq.push([i, 0]);
    for (let i = 0; i < 10; i++) sq.push([10, i]);
    for (let i = 10; i > 0; i--) sq.push([i, 10]);
    for (let i = 10; i > 0; i--) sq.push([0, i]);
    expect(simplify(sq, 0.5)).toHaveLength(5);
  });

  it('drops the wordmark from a combination mark', () => {
    // a 30×30 icon, a wide gap, then six "letters" with narrow gaps
    const m = draw((x, y) => (x >= 4 && x < 34 && y >= 20 && y < 50) || (x >= 50 && x < 116 && y >= 28 && y < 44 && (x - 50) % 11 < 8));
    const icon = isolateIcon(m, W, H);
    const v = maskToPath(icon, W, H)!;
    expect(v.contours).toBe(1);
    expect(v.box[0] + v.box[2]).toBeLessThan(40);
    // a plain wordmark (even gaps) is left alone
    const word = draw((x, y) => x >= 10 && x < 110 && y >= 28 && y < 44 && (x - 10) % 11 < 8);
    expect(isolateIcon(word, W, H)).toBe(word);
  });

  it('separates a mark from a solid tile and from transparency', () => {
    const rgba = (bg: number[], fg: number[]) => {
      const d = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.set(ring(x, y) ? fg : bg, (y * W + x) * 4);
      return { w: W, h: H, data: d };
    };
    const onTile = logoMask(rgba([246, 60, 12, 255], [255, 255, 255, 255]));
    const onAlpha = logoMask(rgba([0, 0, 0, 0], [246, 60, 12, 255]));
    expect(onTile).toEqual(draw(ring));
    expect(onAlpha).toEqual(draw(ring));
    expect(vectorizeLogo(rgba([0, 0, 0, 0], [0, 0, 0, 255]))!.contours).toBe(2);
    // an app-icon tile on transparency: the mark is the white ring, not the tile
    const d = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x > 2 && x < 78 && y > 2 && y < 78) d.set(ring(x, y) ? [255, 255, 255, 255] : [108, 92, 231, 255], (y * W + x) * 4);
    expect(logoMask({ w: W, h: H, data: d })).toEqual(draw(ring));
  });

  it('uses a single-path SVG as-is', () => {
    expect(singlePathD('<svg viewBox="0 0 10 10"><path fill="#000" d="M0 0L10 0L10 10Z"/></svg>')).toBe('M0 0L10 0L10 10Z');
    expect(singlePathD('<svg><g transform="scale(2)"><path d="M0 0L1 1Z"/></g></svg>')).toBeNull();
    expect(singlePathD('<svg><path d="M0 0Z"/><path d="M1 1Z"/></svg>')).toBeNull();
  });
});
