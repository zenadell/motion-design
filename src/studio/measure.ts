import { spawn } from 'node:child_process';
import { decode, type RGB } from '../ai/inspect';
import { ffmpegPath } from '../cli/render';
import { fitKeys, fitScalar } from './fit';
import { encodePng } from './png';
import type { CompInput, Key } from './schema';

// Measures a reference film and rebuilds it as a studio comp, without a model:
//
//   frames → background model (a smooth colour surface per frame, so gradients
//   and vignettes are background, not content) → elements (connected regions
//   that differ from it) → tracks across frames → per element, how it moves:
//   it slides / scales as a whole ("transform"), or it stays put and is
//   uncovered bit by bit ("reveal": typewriters, wipes, staggered letters)
//   → keyframes with fitted eases → a sprite of each element cut out of the
//   reference at full resolution, its background keyed away.
//
// The result plays straight away (an exact copy of what moves and when) and is
// an editable starting point: a model can swap a sprite for a text layer with
// the brand's words, keeping the measured motion.

const FW = 1920, FH = 1080;

export interface MeasureOptions {
  from?: number;
  to?: number;
  /** Analysis frame rate (default 30). */
  fps?: number;
  /** Analysis width (default 512; height follows 16:9). */
  width?: number;
  maxTracks?: number;
  id?: string;
}

export interface TrackSummary {
  id: string;
  mode: 'transform' | 'reveal';
  from: number;
  to: number;
  box: [number, number, number, number];
  color: string;
  keys: number;
}

export interface Measured {
  comp: CompInput;
  assets: Record<string, string>;
  tracks: TrackSummary[];
  shots: { from: number; to: number }[];
  duration: number;
  report: string;
}

// ── background: a quadratic colour surface fitted robustly per frame ─────────

type Bg = Float64Array; // 3 channels × 6 coefficients

const basis = (u: number, v: number, o: Float64Array) => {
  o[0] = 1; o[1] = u; o[2] = v; o[3] = u * u; o[4] = u * v; o[5] = v * v;
};

function solve6(A: Float64Array, b: Float64Array): Float64Array {
  const n = 6, M = new Float64Array(n * (n + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i * 7 + j] = A[i * 6 + j] + (i === j ? 1e-6 : 0);
    M[i * 7 + 6] = b[i];
  }
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * 7 + c]) > Math.abs(M[p * 7 + c])) p = r;
    if (p !== c) for (let k = 0; k < 7; k++) [M[c * 7 + k], M[p * 7 + k]] = [M[p * 7 + k], M[c * 7 + k]];
    const d = M[c * 7 + c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r * 7 + c] / d;
      for (let k = c; k < 7; k++) M[r * 7 + k] -= f * M[c * 7 + k];
    }
  }
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i * 7 + 6] / (M[i * 7 + i] || 1e-12);
  return x;
}

export function bgAt(m: Bg, u: number, v: number, out: Float64Array, tmp = new Float64Array(6)): Float64Array {
  basis(u, v, tmp);
  for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let k = 0; k < 6; k++) s += m[c * 6 + k] * tmp[k];
    out[c] = s;
  }
  return out;
}

/** Fit the background: start from the frame border, then refit on every pixel that agrees with it. */
export function fitBackground(f: RGB, flat = false): Bg {
  const { w, h, data } = f, step = Math.max(2, Math.round(w / 170)), B = new Float64Array(6);
  let m: Bg = new Float64Array(18);
  const rgbAt = (x: number, y: number, c: number) => data[(y * w + x) * 3 + c];
  for (let it = 0; it < 4; it++) {
    const A = new Float64Array(36), bs = [new Float64Array(6), new Float64Array(6), new Float64Array(6)], cur = new Float64Array(3);
    let n = 0;
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const u = x / w - 0.5, v = y / h - 0.5;
        if (it === 0) {
          const edge = x < 3 * step || x >= w - 3 * step || y < 3 * step || y >= h - 3 * step;
          if (!edge) continue;
        } else {
          bgAt(m, u, v, cur, B);
          let d = 0;
          for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(rgbAt(x, y, c) - cur[c]));
          if (d > (it === 1 ? 40 : 20)) continue;
        }
        basis(u, v, B);
        if (flat) B.fill(0, 1);
        for (let i = 0; i < 6; i++) {
          for (let j = 0; j < 6; j++) A[i * 6 + j] += B[i] * B[j];
          for (let c = 0; c < 3; c++) bs[c][i] += B[i] * rgbAt(x, y, c);
        }
        n++;
      }
    if (n < 12) break;
    const next = new Float64Array(18);
    for (let c = 0; c < 3; c++) next.set(solve6(A, bs[c]), c * 6);
    m = next;
  }
  return m;
}

/** Largest colour difference between two background models (over a grid of points). */
function bgDiff(a: Bg, b: Bg): number {
  const p = new Float64Array(3), q = new Float64Array(3);
  let d = 0;
  for (const u of [-0.5, -0.25, 0, 0.25, 0.5])
    for (const v of [-0.5, 0, 0.5]) {
      bgAt(a, u, v, p);
      bgAt(b, u, v, q);
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(p[c] - q[c]));
    }
  return d;
}

/** How much the background varies across the frame (0 = a flat colour). */
function bgRange(m: Bg): number {
  const o = new Float64Array(3), pts = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0], [0, -0.5], [0, 0.5], [-0.5, 0], [0.5, 0]];
  const lo = [255, 255, 255], hi = [0, 0, 0];
  for (const [u, v] of pts) {
    bgAt(m, u, v, o);
    for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], o[c]); hi[c] = Math.max(hi[c], o[c]); }
  }
  return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}

// ── elements in one frame ─────────────────────────────────────────────────────

interface Obs {
  k: number;
  /** Strength-weighted centroid and spread (analysis px). */
  cx: number; cy: number; sx: number; sy: number;
  /** Sum of strength above the threshold, and pixel count. */
  sw: number; n: number;
  box: [number, number, number, number];
  color: [number, number, number];
  /** Unthresholded energy inside the box (for opacity). */
  energy: number;
  /** Principal axis (degrees), elongation (√λ1/λ2) and rotation-free spread √(varx + vary). */
  rot: number; elong: number; sr: number;
  /** Has crisp pixels (not only a glow or haze). */
  crisp: boolean;
}

/** Faint (glow, soft edge) and crisp thresholds: max channel distance from the background model. */
const T = 16, TC = 36;

interface FrameScan { obs: Obs[]; labels: Int32Array; integral: Float64Array; d: Float32Array }

/** Distance to the background per pixel, the elements, and an integral image of the distance (for box sums). */
function scan(f: RGB, m: Bg, k: number, keepLabels: boolean): FrameScan {
  const { w, h, data } = f, n = w * h;
  const d = new Float32Array(n), dv = new Float32Array(n * 3), cur = new Float64Array(3), tmp = new Float64Array(6);
  // the background varies slowly: evaluate it on a coarse grid and interpolate
  const gs = 8, gw = Math.ceil(w / gs) + 1, gh = Math.ceil(h / gs) + 1, grid = new Float64Array(gw * gh * 3);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      bgAt(m, (gx * gs) / w - 0.5, (gy * gs) / h - 0.5, cur, tmp);
      grid.set(cur, (gy * gw + gx) * 3);
    }
  for (let y = 0; y < h; y++) {
    const gy = y / gs, y0 = Math.floor(gy), fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = x / gs, x0 = Math.floor(gx), fx = gx - x0, i = (y * w + x) * 3;
      let dd = 0;
      for (let c = 0; c < 3; c++) {
        const a = grid[(y0 * gw + x0) * 3 + c], b = grid[(y0 * gw + x0 + 1) * 3 + c], cc = grid[((y0 + 1) * gw + x0) * 3 + c], e = grid[((y0 + 1) * gw + x0 + 1) * 3 + c];
        const bgc = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + e * fx) * fy;
        dv[i + c] = data[i + c] - bgc;
        dd = Math.max(dd, Math.abs(data[i + c] - bgc));
      }
      d[y * w + x] = dd;
    }
  }
  // integral of max(0, d - 4)
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += Math.max(0, d[y * w + x] - 4);
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  // Two levels. Crisp pixels (far from the background) make the elements: neighbours
  // join, across small gaps (letters of a word), only when their colours agree, so
  // touching elements of different colours stay apart. Faint pixels (glows, soft
  // edges, motion blur) then join the nearest element; faint regions with no crisp
  // core (soft blobs, haze) become elements of their own.
  const core = new Uint8Array(n), weak = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (d[p] > TC) core[p] = 1;
    else if (d[p] > T) weak[p] = 1;
  }
  const r = Math.max(1, Math.round(w / 170));
  const parent = new Int32Array(n).fill(-1);
  const findRoot = (p: number): number => {
    while (parent[p] !== p) { parent[p] = parent[parent[p]]; p = parent[p]; }
    return p;
  };
  const unite = (a: number, b: number) => {
    const x = findRoot(a), y = findRoot(b);
    if (x !== y) parent[x] = y;
  };
  // same element: the colour leans away from the background in the same direction
  // (an anti-aliased edge is a blend of the element and the background, so it agrees)
  const similar = (a: number, b: number) => {
    const ax = dv[a * 3], ay = dv[a * 3 + 1], az = dv[a * 3 + 2], bx = dv[b * 3], by = dv[b * 3 + 1], bz = dv[b * 3 + 2];
    return ax * bx + ay * by + az * bz > 0.9 * Math.sqrt((ax * ax + ay * ay + az * az) * (bx * bx + by * by + bz * bz));
  };
  const colLast = new Int32Array(w).fill(-1);
  for (let y = 0; y < h; y++) {
    let rowLast = -1;
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!core[p]) continue;
      parent[p] = p;
      if (rowLast >= 0 && x - (rowLast % w) <= r && similar(p, rowLast)) unite(p, rowLast);
      const up = colLast[x];
      if (up >= 0 && y - ((up / w) | 0) <= r && similar(p, up)) unite(p, up);
      rowLast = p;
      colLast[x] = p;
    }
  }
  const labels = new Int32Array(n).fill(-1);
  for (let p = 0; p < n; p++) if (core[p]) labels[p] = findRoot(p);
  // faint pixels join the nearest crisp element (breadth-first, up to a glow's reach)
  const reach = Math.max(2, Math.round(w / 40));
  const dist = new Uint8Array(n);
  let queue = new Int32Array(n), qn = 0;
  for (let p = 0; p < n; p++) if (core[p]) queue[qn++] = p;
  for (let step = 1; step <= reach && qn; step++) {
    const next = new Int32Array(n);
    let nn = 0;
    for (let i = 0; i < qn; i++) {
      const p = queue[i], x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= n || !weak[q] || labels[q] >= 0) continue;
        labels[q] = labels[p];
        dist[q] = step;
        next[nn++] = q;
      }
    }
    queue = next;
    qn = nn;
  }
  // faint regions with no crisp core: their own elements (4-connected)
  for (let p = 0; p < n; p++) {
    if (!weak[p] || labels[p] >= 0) continue;
    parent[p] = p;
    const x = p % w;
    if (x > 0 && weak[p - 1] && labels[p - 1] < 0) unite(p, p - 1);
    if (p >= w && weak[p - w] && labels[p - w] < 0) unite(p, p - w);
  }
  for (let p = 0; p < n; p++) if (weak[p] && labels[p] < 0) labels[p] = findRoot(p);
  const stats = new Map<number, { sw: number; n: number; core: number; sx: number; sy: number; sxx: number; syy: number; sxy: number; x0: number; y0: number; x1: number; y1: number; cr: number; cg: number; cb: number; cn: number }>();
  for (let p = 0; p < n; p++) {
    const root = labels[p];
    if (root < 0) continue;
    const x = p % w, y = (p / w) | 0, wt = d[p] - T * 0.5;
    let s = stats.get(root);
    if (!s) stats.set(root, (s = { sw: 0, n: 0, core: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, x0: x, y0: y, x1: x, y1: y, cr: 0, cg: 0, cb: 0, cn: 0 }));
    s.sw += wt; s.n++; s.sx += wt * x; s.sy += wt * y; s.sxx += wt * x * x; s.syy += wt * y * y; s.sxy += wt * x * y;
    if (core[p]) s.core++;
    if (x < s.x0) s.x0 = x;
    if (x > s.x1) s.x1 = x;
    if (y < s.y0) s.y0 = y;
    if (y > s.y1) s.y1 = y;
    if (core[p] || !s.core) { s.cr += data[p * 3]; s.cg += data[p * 3 + 1]; s.cb += data[p * 3 + 2]; s.cn++; }
  }
  const minCore = 3, minSoft = Math.max(24, Math.round((w * h) / 1200));
  const obs: Obs[] = [];
  const boxSum = (x0: number, y0: number, x1: number, y1: number) => {
    const W1 = w + 1;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w - 1, x1); y1 = Math.min(h - 1, y1);
    return integral[(y1 + 1) * W1 + x1 + 1] - integral[y0 * W1 + x1 + 1] - integral[(y1 + 1) * W1 + x0] + integral[y0 * W1 + x0];
  };
  for (const s of stats.values()) {
    if (s.core ? s.core < minCore : s.n < minSoft) continue;
    const cx = s.sx / s.sw, cy = s.sy / s.sw;
    const vx = Math.max(0.0625, s.sxx / s.sw - cx * cx), vy = Math.max(0.0625, s.syy / s.sw - cy * cy), cv = s.sxy / s.sw - cx * cy;
    const tr = vx + vy, det = Math.sqrt(Math.max(0, ((vx - vy) / 2) ** 2 + cv * cv));
    const l1 = tr / 2 + det, l2 = Math.max(1e-6, tr / 2 - det);
    obs.push({
      k, cx, cy,
      sx: Math.sqrt(vx),
      sy: Math.sqrt(vy),
      rot: (0.5 * Math.atan2(2 * cv, vx - vy) * 180) / Math.PI,
      elong: Math.sqrt(l1 / l2),
      sr: Math.sqrt(tr),
      crisp: s.core > 0,
      sw: s.sw, n: s.n,
      box: [s.x0, s.y0, s.x1 + 1, s.y1 + 1],
      color: s.cn ? [s.cr / s.cn, s.cg / s.cn, s.cb / s.cn] : [255, 255, 255],
      energy: boxSum(s.x0 - 1, s.y0 - 1, s.x1 + 1, s.y1 + 1),
    });
  }
  return { obs, labels: keepLabels ? labels : new Int32Array(0), integral, d };
}

// ── tracking ──────────────────────────────────────────────────────────────────

interface Track {
  obs: Obs[];
  shot: number;
  closed: boolean;
  /** Born from a merge or split of other tracks / ended by one: no fade padding there (the pixels hand over). */
  handIn?: boolean;
  handOut?: boolean;
}

const iou = (a: number[], b: number[]) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const i = ix * iy, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
  return u > 0 ? i / u : 0;
};
const cdist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const inside = (x: number, y: number, b: number[]) => x >= b[0] - 1 && x <= b[2] + 1 && y >= b[1] - 1 && y <= b[3] + 1;

function link(tracks: Track[], obs: Obs[], k: number, shot: number): void {
  const live = tracks.filter(t => !t.closed && t.shot === shot);
  const fresh = (t: Track) => k - t.obs[t.obs.length - 1].k <= 1;
  const reborn = new Set<Obs>();
  // merges: one element now covers two tracked ones (letters landing into a word)
  for (const o of obs) {
    const covered = live.filter(t => {
      const l = t.obs[t.obs.length - 1];
      return fresh(t) && inside(l.box[0], l.box[1], o.box) && inside(l.box[2], l.box[3], o.box);
    });
    // and the pieces add up to it (a ring's box covers the words inside it, but its pixels are not theirs)
    const sum = covered.reduce((a, t) => a + t.obs[t.obs.length - 1].n, 0);
    if (covered.length >= 2 && sum > 0.6 * o.n && sum < 1.6 * o.n) {
      covered.forEach(t => { t.closed = true; t.handOut = true; });
      reborn.add(o);
    }
  }
  // splits: two elements now share what one track was
  for (const t of live) {
    if (t.closed || !fresh(t)) continue;
    const l = t.obs[t.obs.length - 1];
    const parts = obs.filter(o => !reborn.has(o) && inside(o.box[0], o.box[1], l.box) && inside(o.box[2], o.box[3], l.box) && o.n < 0.85 * l.n);
    const sum = parts.reduce((a, o) => a + o.n, 0);
    if (parts.length >= 2 && sum > 0.6 * l.n && sum < 1.6 * l.n) {
      t.closed = true;
      t.handOut = true;
      parts.forEach(o => reborn.add(o));
    }
  }
  for (const o of reborn) tracks.push({ obs: [o], shot, closed: false, handIn: true });
  obs = obs.filter(o => !reborn.has(o));
  const open = live.filter(t => !t.closed);
  const pairs: { t: Track; o: Obs; cost: number }[] = [];
  for (const t of open) {
    const l = t.obs[t.obs.length - 1];
    const size = Math.sqrt((l.box[2] - l.box[0]) * (l.box[3] - l.box[1])) + 2;
    for (const o of obs) {
      const ov = iou(l.box, o.box), dn = Math.hypot(o.cx - l.cx, o.cy - l.cy) / size;
      const sr = Math.abs(Math.log((o.n + 4) / (l.n + 4))), dc = cdist(o.color, l.color);
      if ((ov < 0.05 && dn > 1.5) || dc > 110 || sr > 2.2) continue;
      pairs.push({ t, o, cost: (1 - ov) + 0.6 * dn + dc / 200 + 0.3 * sr });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);
  const usedT = new Set<Track>(), usedO = new Set<Obs>();
  for (const p of pairs) {
    if (usedT.has(p.t) || usedO.has(p.o)) continue;
    usedT.add(p.t);
    usedO.add(p.o);
    p.t.obs.push(p.o);
  }
  for (const t of open) if (!usedT.has(t) && k - t.obs[t.obs.length - 1].k > 3) t.closed = true;
  for (const o of obs) if (!usedO.has(o)) tracks.push({ obs: [o], shot, closed: false });
}

// ── the whole film ────────────────────────────────────────────────────────────

const hex = (c: number[]) => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface Analysis {
  fps: number;
  w: number;
  h: number;
  frames: number;
  shots: { k0: number; k1: number; flat: boolean; bg: Bg; plates: { k0: number; k1: number; bg: Bg }[] }[];
  bgs: Bg[];
  tracks: Track[];
}

/** Find shots, background models and element tracks in decoded frames. */
export function analyse(frames: RGB[], fps: number): Analysis {
  const w = frames[0].w, h = frames[0].h;
  // hard cuts: the picture changes a lot between two frames
  const diffs = frames.map((f, k) => {
    if (!k) return 0;
    const a = frames[k - 1].data, b = f.data;
    let s = 0;
    for (let i = 0; i < a.length; i += 9) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    return s / (a.length / 3);
  });
  const med = [...diffs].sort((a, b) => a - b)[diffs.length >> 1] || 0;
  const cuts = [0];
  diffs.forEach((d, k) => { if (k > 0 && d > Math.max(40, 8 * med) && k - cuts[cuts.length - 1] > 2) cuts.push(k); });
  const shots = cuts.map((k0, i) => ({ k0, k1: (cuts[i + 1] ?? frames.length) - 1, flat: true, bg: new Float64Array(18) as Bg, plates: [] as { k0: number; k1: number; bg: Bg }[] }));
  const bgs: Bg[] = [];
  const tracks: Track[] = [];
  shots.forEach((s, si) => {
    // a flat colour unless the frames really carry a gradient
    let ranges = 0;
    for (let k = s.k0; k <= s.k1; k += Math.max(1, Math.floor((s.k1 - s.k0) / 6))) ranges = Math.max(ranges, bgRange(fitBackground(frames[k])));
    s.flat = ranges < 10;
    for (let k = s.k0; k <= s.k1; k++) {
      const m = fitBackground(frames[k], s.flat);
      bgs[k] = m;
      link(tracks, scan(frames[k], m, k, false).obs, k, si);
    }
    s.bg = bgs[Math.floor((s.k0 + s.k1) / 2)];
    // a gradient that changes inside the shot (a wipe, a slow colour shift) gets a plate per stretch
    if (!s.flat) {
      let a = s.k0;
      for (let k = s.k0 + 1; k <= s.k1 + 1; k++)
        // a new plate for a real change, at least half a second after the last, at most 8 per shot
        if (k > s.k1 || (bgDiff(bgs[k], bgs[a]) > 28 && k - a >= fps / 2 && s.plates.length < 7)) {
          s.plates.push({ k0: a, k1: k - 1, bg: bgs[Math.floor((a + k - 1) / 2)] });
          a = k;
        }
    }
  });
  return { fps, w, h, frames: frames.length, shots, bgs, tracks };
}

interface Built {
  id: string;
  mode: 'transform' | 'reveal';
  hero: Obs;
  span: [number, number];
  /** Per frame: [cx, cy, sx, sy, alpha, x0, y0, x1, y1] in analysis px. */
  rows: { k: number; v: number[] }[];
}

/** Decide how each track moves and extend it into fades the threshold missed. */
function describeTracks(A: Analysis, frames: RGB[], maxTracks: number): Built[] {
  const { w, h } = A;
  const keep = A.tracks
    .filter(t => t.obs.length >= 3 || (t.obs.length >= 2 && (t.handIn || t.handOut)))
    .map(t => ({ t, hero: t.obs.reduce((a, b) => (b.sw > a.sw ? b : a)), total: t.obs.reduce((a, o) => a + o.sw, 0) }))
    // crisp elements first (a glow fragment must never crowd out a word), then by how much
    // they show over their whole life (a thin line on screen for seconds beats a 2-frame fragment)
    .sort((a, b) => (b.hero.crisp ? 1e15 : 0) + b.total - (a.hero.crisp ? 1e15 : 0) - a.total)
    .slice(0, maxTracks);
  const integrals = new Map<number, Float64Array>();
  const energyAt = (k: number, box: number[]) => {
    let I = integrals.get(k);
    if (!I) {
      I = scan(frames[k], A.bgs[k], k, false).integral;
      integrals.set(k, I);
    }
    const W1 = w + 1, x0 = Math.max(0, Math.floor(box[0]) - 1), y0 = Math.max(0, Math.floor(box[1]) - 1), x1 = Math.min(w - 1, Math.ceil(box[2])), y1 = Math.min(h - 1, Math.ceil(box[3]));
    return I[(y1 + 1) * W1 + x1 + 1] - I[y0 * W1 + x1 + 1] - I[(y1 + 1) * W1 + x0] + I[y0 * W1 + x0];
  };
  return keep.map(({ t, hero }, i): Built => {
    const shot = A.shots[t.shot];
    const hb = hero.box, hw = hb[2] - hb[0], hh = hb[3] - hb[1];
    // reveal: the element never leaves its final box, and its visible part changes shape (not a uniform scale)
    // reveal: the element never leaves its final box, its visible part changes shape (not a
    // uniform scale), and one edge stays put while the others move — a wipe or a typewriter
    let inside = 0, reshaped = 0, anchored = 0;
    for (const o of t.obs) {
      const b = o.box, bw = b[2] - b[0], bh = b[3] - b[1];
      if (b[0] >= hb[0] - 2 && b[1] >= hb[1] - 2 && b[2] <= hb[2] + 2 && b[3] <= hb[3] + 2) inside++;
      if (Math.abs(Math.log((bw / bh) / (hw / hh))) > 0.15) {
        reshaped++;
        if ([0, 1, 2, 3].some(e => Math.abs(b[e] - hb[e]) <= 1.5)) anchored++;
      }
    }
    const mode: Built['mode'] = inside >= t.obs.length * 0.9 && reshaped >= 3 && anchored >= reshaped * 0.6 ? 'reveal' : 'transform';
    // rotation, for elements with a clear long axis (a word, a bar), unwrapped frame to frame
    const turns = mode === 'transform' && hero.elong > 1.5 && t.obs.filter(o => o.elong > 1.25).length >= t.obs.length * 0.8;
    let prevRot = 0;
    const rotOf = (o: Obs) => {
      if (!turns) return 0;
      let r = o.rot - hero.rot;
      while (r - prevRot > 90) r -= 180;
      while (r - prevRot < -90) r += 180;
      prevRot = r;
      return r;
    };
    const touches = (b: number[]) => b[0] <= 1 || b[1] <= 1 || b[2] >= w - 1 || b[3] >= h - 1;
    const rows: Built['rows'] = t.obs.map(o => {
      const rot = rotOf(o);
      // a turning element's axis-aligned spread changes with the angle: use the rotation-free spread
      let sx = turns ? o.sr / hero.sr : o.sx / hero.sx, sy = turns ? sx : o.sy / hero.sy, cx = o.cx, cy = o.cy;
      let alpha = mode === 'reveal' ? (o.sw / o.n) / (hero.sw / hero.n) : o.energy / Math.max(1, hero.energy * sx * sy);
      if (mode === 'transform' && touches(o.box)) {
        // partly off screen: the spread and centroid only see the visible part
        const s = touches([0, o.box[1], w, o.box[3]]) ? 1 : sy;
        sx = sy = s;
        if (o.box[0] <= 1) cx = o.box[2] - (hb[2] - hero.cx) * s;
        else if (o.box[2] >= w - 1) cx = o.box[0] + (hero.cx - hb[0]) * s;
        if (o.box[1] <= 1) cy = o.box[3] - (hb[3] - hero.cy) * s;
        else if (o.box[3] >= h - 1) cy = o.box[1] + (hero.cy - hb[1]) * s;
        alpha = 1;
      }
      return { k: o.k, v: [cx, cy, sx, sy, Math.min(1, alpha), ...o.box, rot] };
    });
    // fades the threshold missed: energy in the first/last box, before and after
    const first = rows[0], last = rows[rows.length - 1];
    const heroE = Math.max(1, energyAt(hero.k, hb));
    const pre: Built['rows'] = [];
    for (let k = first.k - 1; !t.handIn && k >= shot.k0 && first.k - k <= A.fps * 1.5; k--) {
      const b = first.v.slice(5, 9) as number[];
      const a = energyAt(k, b) / (heroE * first.v[2] * first.v[3]);
      if (a < 0.04) break;
      pre.unshift({ k, v: [...first.v.slice(0, 4), Math.min(1, a), ...b, first.v[9]] });
    }
    const post: Built['rows'] = [];
    for (let k = last.k + 1; !t.handOut && k <= shot.k1 && k - last.k <= A.fps * 1.5; k++) {
      const b = last.v.slice(5, 9) as number[];
      const a = energyAt(k, b) / (heroE * last.v[2] * last.v[3]);
      if (a < 0.04) break;
      post.push({ k, v: [...last.v.slice(0, 4), Math.min(1, a), ...b, last.v[9]] });
    }
    const all = [...pre, ...rows, ...post];
    // fill single-frame gaps by holding the previous value
    const filled: Built['rows'] = [];
    for (const r of all) {
      const prev = filled[filled.length - 1];
      if (prev) for (let k = prev.k + 1; k < r.k; k++) filled.push({ k, v: prev.v.slice() });
      filled.push(r);
    }
    return { id: `el-${i + 1}`, mode, hero, span: [filled[0].k, filled[filled.length - 1].k], rows: filled };
  });
}

/**
 * Per row: does the sprite, placed with its measured motion and composited on the
 * background model, explain the reference better than the background alone? A
 * mis-tracked element (or one whose content changed) puts structure where there is
 * none; it is left out of those frames.
 */
function helps(A: Analysis, frames: RGB[], b: Built): boolean[] {
  const { w, h } = A, H = frames[b.hero.k], bgH = A.bgs[b.hero.k];
  const pb = new Float64Array(3), ph = new Float64Array(3), tmp = new Float64Array(6);
  return b.rows.map(r => {
    if (r.k === b.hero.k) return true;
    const F = frames[r.k], bgK = A.bgs[r.k];
    const [cx, cy, sx, sy, alpha, x0, y0, x1, y1, rot] = r.v;
    const a = (-rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const X0 = Math.max(0, Math.floor(x0) - 1), X1 = Math.min(w, Math.ceil(x1) + 1), Y0 = Math.max(0, Math.floor(y0) - 1), Y1 = Math.min(h, Math.ceil(y1) + 1);
    const step = Math.max(1, Math.round(Math.sqrt(((X1 - X0) * (Y1 - Y0)) / 600)));
    let eS = 0, eB = 0, n = 0;
    for (let y = Y0; y < Y1; y += step)
      for (let x = X0; x < X1; x += step) {
        let qx = x, qy = y;
        if (b.mode === 'transform') {
          const dx = (x - cx) / sx, dy = (y - cy) / sy;
          qx = b.hero.cx + dx * ca - dy * sa;
          qy = b.hero.cy + dx * sa + dy * ca;
        }
        bgAt(bgK, x / w - 0.5, y / h - 0.5, pb, tmp);
        const qi = Math.round(qx), qj = Math.round(qy), i = (y * w + x) * 3, inH = qi >= 0 && qj >= 0 && qi < w && qj < h;
        if (inH) bgAt(bgH, qi / w - 0.5, qj / h - 0.5, ph, tmp);
        for (let c = 0; c < 3; c++) {
          const fg = inH ? H.data[(qj * w + qi) * 3 + c] - ph[c] : 0;
          eS += Math.abs(pb[c] + alpha * fg - F.data[i + c]);
          eB += Math.abs(pb[c] - F.data[i + c]);
        }
        n++;
      }
    return !n || eS <= 0.85 * eB || eS < 6 * 3 * n;
  });
}

/** Contiguous stretches of rows where the sprite helps (single-frame dips bridged), at least 2 rows long. */
function helpfulRuns(ok: boolean[]): [number, number][] {
  const f = ok.map((v, i) => v || (i > 0 && i < ok.length - 1 && ok[i - 1] && ok[i + 1]));
  const runs: [number, number][] = [];
  for (let i = 0; i < f.length; ) {
    if (!f[i]) { i++; continue; }
    let j = i;
    while (j + 1 < f.length && f[j + 1]) j++;
    if (j > i) runs.push([i, j]);
    i = j + 1;
  }
  return runs;
}

/** Cut an element out of a full-resolution frame, keying away the background model. */
/** Box-filter an RGBA image down by an integer factor. */
function shrink(rgba: Uint8Array, w: number, h: number, f: number): { rgba: Uint8Array; w: number; h: number } {
  const ow = Math.max(1, Math.floor(w / f)), oh = Math.max(1, Math.floor(h / f)), out = new Uint8Array(ow * oh * 4);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      // premultiplied average so transparent pixels do not darken the edges
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * w + x * f + dx) * 4, al = rgba[i + 3];
          r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al;
        }
      const o = (y * ow + x) * 4;
      if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a / (f * f);
    }
  return { rgba: out, w: ow, h: oh };
}

function sprite(full: RGB, bg: Bg, owner: (X: number, Y: number) => boolean, box: number[], sc: number, soft = false, lowRes = false): { png: Buffer; cx: number; cy: number; w: number; h: number; shrunk: boolean } {
  const pad = 6;
  const X0 = Math.max(0, Math.floor(box[0] * sc) - pad), Y0 = Math.max(0, Math.floor(box[1] * sc) - pad);
  const X1 = Math.min(FW, Math.ceil(box[2] * sc) + pad), Y1 = Math.min(FH, Math.ceil(box[3] * sc) + pad);
  const w = X1 - X0, h = Y1 - Y0, rgba = new Uint8Array(w * h * 4), cur = new Float64Array(3), tmp = new Float64Array(6);
  const ds = new Float32Array(w * h), bgs = new Float32Array(w * h * 3), own = new Uint8Array(w * h);
  const strong: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const X = X0 + x, Y = Y0 + y, i = (Y * FW + X) * 3, j = y * w + x;
      bgAt(bg, X / FW - 0.5, Y / FH - 0.5, cur, tmp);
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(full.data[i + c] - cur[c]));
      ds[j] = d;
      bgs.set(cur, j * 3);
      own[j] = owner(X, Y) ? 1 : 0;
      if (own[j] && d > T * 1.5) strong.push(d);
    }
  strong.sort((a, b) => a - b);
  const hi = Math.max(24, strong[Math.floor(strong.length * 0.85)] ?? 60), lo = 4;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = ((Y0 + y) * FW + X0 + x) * 3;
      const a = own[j] ? Math.max(0, Math.min(1, (ds[j] - lo) / (hi - lo))) : 0;
      for (let c = 0; c < 3; c++) {
        const B = bgs[j * 3 + c], P = full.data[i + c];
        rgba[j * 4 + c] = Math.round(Math.max(0, Math.min(255, a > 0.02 ? B + (P - B) / a : P)));
      }
      rgba[j * 4 + 3] = Math.round(a * 255);
    }
  // soft things (glows, haze, light sweeps) need little resolution; big crisp ones some less
  const f = soft ? 4 : lowRes || w * h > 500_000 ? 2 : 1;
  const img = f > 1 ? shrink(rgba, w, h, f) : { rgba, w, h };
  return { png: encodePng(img.rgba, img.w, img.h), cx: X0 + w / 2, cy: Y0 + h / 2, w, h, shrunk: f > 1 };
}

function bgPlate(bg: Bg): Buffer {
  const w = 320, h = 180, rgba = new Uint8Array(w * h * 4), cur = new Float64Array(3), tmp = new Float64Array(6);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      bgAt(bg, (x + 0.5) / w - 0.5, (y + 0.5) / h - 0.5, cur, tmp);
      const j = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) rgba[j + c] = Math.round(Math.max(0, Math.min(255, cur[c])));
      rgba[j + 3] = 255;
    }
  return encodePng(rgba, w, h);
}

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

/**
 * Build a comp from an analysis. `fullFrame(k)` returns frame k at 1920×1080
 * (the sprites are cut from it). Times are seconds from the window start.
 */
export async function buildComp(A: Analysis, frames: RGB[], fullFrame: (k: number) => Promise<RGB>, o: { id?: string; maxTracks?: number; sourceWidth?: number } = {}): Promise<Measured> {
  const sc = FW / A.w, t = (k: number) => +(k / A.fps).toFixed(4);
  const built = describeTracks(A, frames, o.maxTracks ?? 150);
  const assets: Record<string, string> = {};
  const layers: Record<string, unknown>[] = [];
  // background: a flat colour per shot (keyed through colour changes), or a gradient plate
  const bgRows: number[][] = [], bgTs: number[] = [];
  const cur = new Float64Array(3);
  for (let k = 0; k < A.frames; k++) {
    bgAt(A.bgs[k], 0, 0, cur);
    bgRows.push([...cur]);
    bgTs.push(t(k));
  }
  const bgKeys = fitKeys(bgTs, bgRows, { tol: 3, rich: false, round: 1 });
  const background = bgKeys.length === 1 || bgKeys.every(k => k.v.every((x, c) => Math.abs(x - bgKeys[0].v[c]) < 2))
    ? hex(bgKeys[0].v)
    : bgKeys.map(k => ({ t: k.t, v: hex(k.v), ...(k.ease ? { ease: k.ease } : {}) }));
  A.shots.forEach((s, i) =>
    s.plates.forEach((pl, j) => {
      const id = `plate-${i + 1}${s.plates.length > 1 ? `-${j + 1}` : ''}`;
      assets[id] = dataUrl(bgPlate(pl.bg));
      layers.push({ id, type: 'image', src: `asset:${id}`, size: [FW, FH], in: t(pl.k0), out: t(pl.k1 + 1) });
    }),
  );
  // hero frames at full resolution, decoded once each
  const fulls = new Map<number, RGB>();
  const scans = new Map<number, FrameScan>();
  const order = [...built].sort((a, b) => (b.hero.box[2] - b.hero.box[0]) * (b.hero.box[3] - b.hero.box[1]) - (a.hero.box[2] - a.hero.box[0]) * (a.hero.box[3] - a.hero.box[1]));
  const summaries: TrackSummary[] = [];
  for (const b of order) {
    const k = b.hero.k;
    let full = fulls.get(k);
    if (!full) fulls.set(k, (full = await fullFrame(k)));
    // the pixels that belong to this element in its hero frame (its connected region)
    let sc0 = scans.get(k);
    if (!sc0) scans.set(k, (sc0 = scan(frames[k], A.bgs[k], k, true)));
    // the label that covers most of the hero box's crisp pixels
    const counts = new Map<number, number>();
    const hb = b.hero.box;
    for (let y = hb[1]; y < hb[3]; y++)
      for (let x = hb[0]; x < hb[2]; x++) {
        const l = sc0.labels[y * A.w + x];
        if (l >= 0) counts.set(l, (counts.get(l) ?? 0) + (sc0.d[y * A.w + x] > TC ? 4 : 1));
      }
    let label = -1, most = 0;
    for (const [l, c] of counts) if (c > most) { most = c; label = l; }
    const owner = (X: number, Y: number) => {
      const x = Math.min(A.w - 1, Math.floor(X / sc)), y = Math.min(A.h - 1, Math.floor(Y / sc));
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < A.w && yy < A.h && sc0.labels[yy * A.w + xx] === label) return true;
        }
      return false;
    };
    const sp = sprite(full, A.bgs[k], owner, hb, sc, !b.hero.crisp, (o.sourceWidth ?? FW) < 1600);
    assets[b.id] = dataUrl(sp.png);
    // the sprite is centred on its crop; the measured centre is the weighted centroid
    const offX = b.hero.cx * sc - sp.cx, offY = b.hero.cy * sc - sp.cy;
    const runs = helpfulRuns(helps(A, frames, b));
    let keys = 0;
    runs.forEach(([i0, i1], ri) => {
      const rows = b.rows.slice(i0, i1 + 1);
      const ts = rows.map(r => t(r.k));
      const layer: Record<string, unknown> = {
        id: ri ? `${b.id}-${ri + 1}` : b.id,
        name: `${b.mode} · ${hex(b.hero.color)} · ${Math.round((hb[2] - hb[0]) * sc)}×${Math.round((hb[3] - hb[1]) * sc)}`,
        type: 'image',
        src: `asset:${b.id}`,
        ...(sp.shrunk ? { size: [sp.w, sp.h] } : {}),
        in: t(rows[0].k),
        out: t(rows[rows.length - 1].k + 1),
      };
      const put = (name: string, k: Key<number[]>[] | Key<number>[], constant: unknown, isConst: boolean) => {
        layer[name] = isConst ? constant : k;
        keys += isConst ? 0 : k.length;
      };
      if (b.mode === 'transform') {
        // the sprite centre = the centroid minus the (rotated, scaled) centroid offset
        const pos = fitKeys(ts, rows.map(r => {
          const a = (r.v[9] * Math.PI) / 180, ox = offX * r.v[2], oy = offY * r.v[3];
          return [r.v[0] * sc - (ox * Math.cos(a) - oy * Math.sin(a)), r.v[1] * sc - (ox * Math.sin(a) + oy * Math.cos(a))];
        }), { tol: Math.max(1.5, 0.5 * sc), round: 0.1 });
        put('position', pos, pos[0].v, pos.length === 1);
        const uniform = rows.every(r => Math.abs(r.v[2] - r.v[3]) < 0.04);
        const sc2 = fitKeys(ts, rows.map(r => (uniform ? [(r.v[2] + r.v[3]) / 2] : [r.v[2], r.v[3]])), { tol: 0.012, round: 0.001 });
        const one = sc2.every(k => k.v.every(x => Math.abs(x - 1) < 0.015));
        if (!one) put('scale', uniform ? sc2.map(k => ({ ...k, v: k.v[0] })) : sc2, uniform ? sc2[0].v[0] : sc2[0].v, sc2.length === 1);
        if (rows.some(r => Math.abs(r.v[9]) > 1.5)) {
          const rot = fitScalar(ts, rows.map(r => r.v[9]), { tol: 1, round: 0.1 });
          put('rotation', rot, rot[0].v, rot.length === 1);
        }
      } else {
        layer.position = [r2(sp.cx), r2(sp.cy)];
        const clip = fitKeys(ts, rows.map(r => [r.v[5] * sc - sp.cx - 2, r.v[6] * sc - sp.cy - 2, (r.v[7] - r.v[5]) * sc + 4, (r.v[8] - r.v[6]) * sc + 4]), { tol: Math.max(2.5, 0.6 * sc), round: 0.5 });
        put('clip', clip, clip[0].v, clip.length === 1);
      }
      const op = fitScalar(ts, rows.map(r => Math.max(0, Math.min(1, r.v[4]))), { tol: 0.04, round: 0.001 });
      if (!op.every(k => k.v > 0.96)) put('opacity', op, op[0].v, op.length === 1);
      layers.push(layer);
    });
    if (!runs.length) {
      delete assets[b.id];
      continue;
    }
    summaries.push({ id: b.id, mode: b.mode, from: t(b.span[0]), to: t(b.span[1] + 1), box: [Math.round(hb[0] * sc), Math.round(hb[1] * sc), Math.round(hb[2] * sc), Math.round(hb[3] * sc)], color: hex(b.hero.color), keys });
  }
  const duration = A.frames / A.fps;
  const comp: CompInput = { id: o.id ?? 'copy', title: 'Measured copy', units: 'seconds', background: background as CompInput['background'], layers: layers as CompInput['layers'] };
  const shots = A.shots.map(s => ({ from: t(s.k0), to: t(s.k1 + 1) }));
  const report = [
    `measured ${A.frames} frames at ${A.fps} fps (${duration.toFixed(2)} s), ${shots.length} shot${shots.length === 1 ? '' : 's'}, ${summaries.length} elements`,
    ...shots.map((s, i) => `  shot ${i + 1}: ${s.from.toFixed(2)}–${s.to.toFixed(2)} s · background ${A.shots[i].flat ? 'flat ' + hex([...bgAt(A.shots[i].bg, 0, 0, cur)]) : 'gradient plate'}`),
    ...summaries.map(s => `  ${s.id.padEnd(6)} ${s.mode.padEnd(9)} ${s.from.toFixed(2)}–${s.to.toFixed(2)} s · box ${s.box.join(',')} · ${s.color} · ${s.keys} keys`),
  ].join('\n');
  return { comp, assets, tracks: summaries, shots, duration, report };
}

function probeWidth(file: string): Promise<number | undefined> {
  return new Promise(resolve => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => (err += d));
    p.on('close', () => resolve(Number(err.match(/Video:.*?(\d{2,5})x\d{2,5}/)?.[1]) || undefined));
    p.on('error', () => resolve(undefined));
  });
}

/** Measure a reference video file (16:9) into a comp. */
export async function measureVideo(file: string, o: MeasureOptions = {}): Promise<Measured> {
  const fps = o.fps ?? 30, w = o.width ?? 512, h = Math.round((w * 9) / 16 / 2) * 2;
  const from = o.from ?? 0;
  const frames = await decode(file, { from, dur: o.to !== undefined ? o.to - from : undefined, fps, w, h });
  if (frames.length < 2) throw new Error(`could not read frames from ${file}`);
  const A = analyse(frames, fps);
  // a low-resolution source (a phone video of a screen) gets sprites at about its own resolution
  const sourceWidth = await probeWidth(file);
  // input seeking keeps frames at or after the time: aim a hair early to land on frame k
  return buildComp(A, frames, async k => (await decode(file, { from: Math.max(0, from + k / fps - 0.002), w: FW, h: FH }))[0], { ...o, sourceWidth });
}
