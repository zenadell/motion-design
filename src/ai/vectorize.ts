import type { Vec2 } from '../engine/core/math';

// Raster logo → SVG path data. Works on any RGBA image: transparent PNGs,
// icons on a solid tile, rasterised SVGs. The mark is everything that differs
// from the background; contours are traced, simplified and wound so the
// engine's nonzero fill draws holes correctly.

export interface Rgba {
  w: number;
  h: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** Otsu's threshold on 0..255 values. */
export function otsu(values: ArrayLike<number>): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < values.length; i++) hist[Math.max(0, Math.min(255, Math.round(values[i])))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/**
 * Foreground mask of a logo image. First separate the logo from its
 * background (transparency, or distance from the border colour). If what's
 * left is an app-icon tile (a solid shape filling its box), the mark is the
 * minority side of a brightness split inside the tile — that handles flat
 * tiles, gradient tiles and light-on-dark or dark-on-light marks alike.
 */
export function logoMask(img: Rgba): Uint8Array {
  const { w, h, data } = img;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const transparent = border.filter(i => data[i * 4 + 3] < 16).length / border.length > 0.6;
  const median = (idx: number[]) => [0, 1, 2].map(c => idx.map(i => data[i * 4 + c]).sort((a, b) => a - b)[idx.length >> 1]);
  const bg = transparent ? null : median(border);
  const region = new Uint8Array(w * h);
  let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4, a = data[o + 3] / 255;
    const on = bg ? Math.hypot(data[o] - bg[0], data[o + 1] - bg[1], data[o + 2] - bg[2]) * a > 64 : a >= 0.5;
    if (!on) continue;
    region[i] = 1;
    n++;
    const x = i % w, y = (i - x) / w;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (n < 64 || n / ((x1 - x0 + 1) * (y1 - y0 + 1)) < 0.8) return region;
  // a tile: split by brightness inside it, erode the tile's anti-aliased rim first
  const inside = (i: number) => region[i] && region[i - 1] && region[i + 1] && region[i - w] && region[i + w];
  const idx: number[] = [], lum: number[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!inside(i)) continue;
    idx.push(i);
    lum.push(Math.round(0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]));
  }
  const t = otsu(lum);
  const hi = lum.filter(v => v > t).length, lo = lum.length - hi;
  const markIsHi = hi <= lo;
  const count = Math.min(hi, lo);
  if (count < lum.length * 0.03 || count > lum.length * 0.6) return region;
  const mark = new Uint8Array(w * h);
  idx.forEach((i, k) => { if (lum[k] > t === markIsHi) mark[i] = 1; });
  return mark;
}

/**
 * A combination mark (icon + wordmark): if the widest column gap splits a
 * square-ish piece off the left from a wide piece, keep just the icon.
 */
export function isolateIcon(mask: Uint8Array, w: number, h: number): Uint8Array {
  const cols = Array.from({ length: w }, (_, x) => {
    for (let y = 0; y < h; y++) if (mask[y * w + x]) return true;
    return false;
  });
  const runs: [number, number][] = [];
  let s = -1;
  cols.forEach((on, x) => {
    if (on && s < 0) s = x;
    if (!on && s >= 0) { runs.push([s, x - 1]); s = -1; }
  });
  if (s >= 0) runs.push([s, w - 1]);
  if (runs.length < 3) return mask;
  const gaps = runs.slice(1).map((r, i) => r[0] - runs[i][1]);
  const big = gaps.indexOf(Math.max(...gaps));
  const rest = gaps.filter((_, i) => i !== big).sort((a, b) => a - b);
  const median = rest[rest.length >> 1] ?? 0;
  if (big !== 0 || gaps[big] < Math.max(4, median * 2)) return mask;
  const x1 = runs[0][1];
  let y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x <= x1; x++) if (mask[y * w + x]) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const iw = x1 - runs[0][0] + 1, ih = y1 - y0 + 1, restW = runs[runs.length - 1][1] - runs[1][0] + 1;
  if (ih <= 0 || iw / ih < 0.5 || iw / ih > 2 || restW < iw * 1.5) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x <= x1; x++) out[y * w + x] = mask[y * w + x];
  return out;
}

/** Ramer–Douglas–Peucker on a closed loop. */
export function simplify(pts: Vec2[], eps: number): Vec2[] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  // split the loop at the point farthest from the start so both halves are open curves
  let far = 0, fd = -1;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > fd) { fd = d; far = i; } });
  keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1, bd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const area = (p: Vec2[]) => p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0) / 2;

/**
 * Exact pixel-edge ("crack") contours. Every boundary edge of every filled
 * pixel is directed so the filled side is on the right; chaining them gives
 * closed loops where outlines and holes are wound oppositely by construction.
 */
export function traceCracks(mask: Uint8Array, w: number, h: number): Vec2[][] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const W1 = w + 1;
  const out = new Map<number, number[]>(); // vertex → outgoing edge targets
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = y0 * W1 + x0;
    const list = out.get(k);
    if (list) list.push(y1 * W1 + x1);
    else out.set(k, [y1 * W1 + x1]);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) add(x, y, x + 1, y);
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!on(x - 1, y)) add(x, y + 1, x, y);
    }
  const loops: Vec2[][] = [];
  for (const [startKey] of out) {
    while (out.get(startKey)?.length) {
      const loop: Vec2[] = [];
      let cur = startKey, prevDx = 0, prevDy = 0;
      for (let guard = 0; guard < 4 * w * h + 8; guard++) {
        const cx = cur % W1, cy = (cur - cx) / W1;
        loop.push([cx, cy]);
        const list = out.get(cur);
        if (!list?.length) break;
        // at a pinch vertex (two diagonal pixels) turn right, keeping diagonal islands separate
        let pick = 0;
        if (list.length > 1) {
          const turn = (t: number) => { const tx = t % W1, dx = tx - cx, dy = (t - tx) / W1 - cy; return prevDx * dy - prevDy * dx; };
          pick = list.map((t, i) => [turn(t), i]).sort((a, b) => b[0] - a[0])[0][1];
        }
        const next = list.splice(pick, 1)[0];
        const nx = next % W1;
        prevDx = nx - cx; prevDy = (next - nx) / W1 - cy;
        cur = next;
        if (cur === startKey) break;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

export interface Vectorized {
  d: string;
  /** Bounds of the mark in path units. */
  box: [number, number, number, number];
  contours: number;
}

/**
 * Trace a mask to path data: exact pixel-edge loops, simplified, with specks
 * dropped. Outlines and holes wind oppositely, so nonzero and evenodd fills agree.
 */
export function maskToPath(mask: Uint8Array, w: number, h: number, eps = 1.4): Vectorized | null {
  const loops = traceCracks(mask, w, h).map(l => simplify(l, eps)).filter(l => l.length >= 3);
  if (!loops.length) return null;
  const areas = loops.map(l => Math.abs(area(l)));
  const maxA = Math.max(...areas);
  const kept = loops.filter((_, i) => areas[i] >= maxA * 0.002);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const parts = kept.map(pts => {
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return 'M' + pts.map(([x, y]) => `${x} ${y}`).join('L') + 'Z';
  });
  return { d: parts.join(''), box: [x0, y0, x1 - x0, y1 - y0], contours: kept.length };
}

/** Pixels close to one colour (the mark's, as named by a vision model). */
export function colourMask(img: Rgba, hex: string, tolerance = 90): Uint8Array {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const m = new Uint8Array(img.w * img.h);
  for (let i = 0; i < m.length; i++) {
    const o = i * 4;
    m[i] = img.data[o + 3] >= 128 && Math.hypot(img.data[o] - c[0], img.data[o + 1] - c[1], img.data[o + 2] - c[2]) < tolerance ? 1 : 0;
  }
  return m;
}

export function vectorizeLogo(img: Rgba, { iconOnly = true, markColor }: { iconOnly?: boolean; markColor?: string } = {}): Vectorized | null {
  let mask = markColor && /^#[0-9a-f]{6}$/i.test(markColor) ? colourMask(img, markColor) : logoMask(img);
  if (iconOnly) mask = isolateIcon(mask, img.w, img.h);
  return maskToPath(mask, img.w, img.h);
}

/** A standalone SVG whose only drawable is one filled path without transforms: its d is usable as-is. */
export function singlePathD(svg: string): string | null {
  if (/<(rect|circle|ellipse|polygon|polyline|line|text|image|use)\b/i.test(svg) || /transform=/i.test(svg)) return null;
  const paths = [...svg.matchAll(/<path\b[^>]*?\sd="([^"]+)"/gi)];
  return paths.length === 1 ? paths[0][1] : null;
}
