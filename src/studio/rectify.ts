import { spawn } from 'node:child_process';
import { ffmpegPath } from '../cli/render';

// A reference filmed off a screen with a phone (a TikTok of someone's After
// Effects viewer, a promo playing on a monitor) shows the film as a tilted
// quadrilateral inside other things. Rectify finds that quadrilateral, follows
// the phone's movement (by tracking everything around the screen, which moves
// with the monitor while the film on it changes), and flattens every frame into
// a clean 16:9 video that the measurer and the models can work on as if it were
// the original export.

export type Pt = [number, number];
/** Corners in source pixels: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

/** The 3×3 homography (row-major, h22 = 1) that maps the unit square's corners (0,0) (1,0) (1,1) (0,1) onto `q`. */
export function squareToQuad(q: Quad): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

export const mapPoint = (m: number[], u: number, v: number): Pt => {
  const w = m[6] * u + m[7] * v + m[8];
  return [(m[0] * u + m[1] * v + m[2]) / w, (m[3] * u + m[4] * v + m[5]) / w];
};

/** Warp one RGB frame: every output pixel looks up its source position through the quad (bilinear). */
export function warp(src: Uint8Array, sw: number, sh: number, q: Quad, ow: number, oh: number, out = new Uint8Array(ow * oh * 3), inset = 0): Uint8Array {
  const m = squareToQuad(q), span = 1 - 2 * inset;
  for (let y = 0; y < oh; y++) {
    const v = inset + ((y + 0.5) / oh) * span;
    for (let x = 0; x < ow; x++) {
      const [fx, fy] = mapPoint(m, inset + ((x + 0.5) / ow) * span, v);
      const sx = Math.min(sw - 1.001, Math.max(0, fx - 0.5)), sy = Math.min(sh - 1.001, Math.max(0, fy - 0.5));
      const ix = sx | 0, iy = sy | 0, ax = sx - ix, ay = sy - iy, o = (y * ow + x) * 3;
      const i00 = (iy * sw + ix) * 3, i10 = i00 + 3, i01 = i00 + sw * 3, i11 = i01 + 3;
      for (let c = 0; c < 3; c++)
        out[o + c] = (src[i00 + c] * (1 - ax) + src[i10 + c] * ax) * (1 - ay) + (src[i01 + c] * (1 - ax) + src[i11 + c] * ax) * ay + 0.5;
    }
  }
  return out;
}

function probe(file: string): Promise<{ w: number; h: number; fps: number; seconds: number }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => (err += d));
    p.on('close', () => {
      const v = err.match(/Video:.*?(\d{2,5})x(\d{2,5})/), f = err.match(/([\d.]+) fps/), d = err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (!v || !d) return reject(new Error(`could not read ${file}`));
      resolve({ w: +v[1], h: +v[2], fps: f ? +f[1] : 30, seconds: +d[1] * 3600 + +d[2] * 60 + +d[3] });
    });
  });
}

/** Frames as raw RGB, one callback per frame (streamed, never all in memory). */
function frames(file: string, w: number, h: number, fps: number | null, each: (f: Uint8Array, k: number) => void | Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', file, ...(fps ? ['-vf', `fps=${fps}`] : []), '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const n = w * h * 3;
    let buf: Buffer = Buffer.alloc(0), k = 0, chain = Promise.resolve();
    p.stdout.on('data', (d: Buffer) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      while (buf.length >= n) {
        const f = new Uint8Array(buf.subarray(0, n));
        buf = buf.subarray(n);
        const kk = k++;
        chain = chain.then(() => each(f, kk));
      }
    });
    p.on('error', reject);
    p.on('close', code => chain.then(() => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));
  });
}

/** A grey image (0–255 floats). */
export interface Grey { g: Float32Array; w: number; h: number }

/** Grey levels of an RGB frame at 1/s of its size (box average). */
export function greyOf(f: Uint8Array, w: number, h: number, s: number): Grey {
  const ow = Math.floor(w / s), oh = Math.floor(h / s), g = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      let a = 0;
      for (let dy = 0; dy < s; dy++)
        for (let dx = 0; dx < s; dx++) {
          const p = ((y * s + dy) * w + x * s + dx) * 3;
          a += 0.299 * f[p] + 0.587 * f[p + 1] + 0.114 * f[p + 2];
        }
      g[y * ow + x] = a / (s * s);
    }
  return { g, w: ow, h: oh };
}

const halve = (im: Grey): Grey => {
  const w = im.w >> 1, h = im.h >> 1, g = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = 2 * y * im.w + 2 * x;
      g[y * w + x] = (im.g[p] + im.g[p + 1] + im.g[p + im.w] + im.g[p + im.w + 1]) / 4;
    }
  return { g, w, h };
};

const at = (im: Grey, x: number, y: number): number => {
  if (!(x >= 0 && y >= 0 && x <= im.w - 1.001 && y <= im.h - 1.001)) return NaN;
  const ix = x | 0, iy = y | 0, ax = x - ix, ay = y - iy, p = iy * im.w + ix;
  return (im.g[p] * (1 - ax) + im.g[p + 1] * ax) * (1 - ay) + (im.g[p + im.w] * (1 - ax) + im.g[p + im.w + 1] * ax) * ay;
};

const gradients = (im: Grey): [Grey, Grey] => {
  const gx = new Float32Array(im.w * im.h), gy = new Float32Array(im.w * im.h);
  for (let y = 1; y < im.h - 1; y++)
    for (let x = 1; x < im.w - 1; x++) {
      const p = y * im.w + x;
      gx[p] = (im.g[p + 1] - im.g[p - 1]) / 2;
      gy[p] = (im.g[p + im.w] - im.g[p - im.w]) / 2;
    }
  return [{ g: gx, w: im.w, h: im.h }, { g: gy, w: im.w, h: im.h }];
};

/** Solve the n×n system A x = b (Gaussian elimination, partial pivoting); zeros when singular. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return new Array(n).fill(0);
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let v = M[r][n];
    for (let j = r + 1; j < n; j++) v -= M[r][j] * x[j];
    x[r] = v / M[r][r];
  }
  return x;
}

/**
 * Affine motion as [a, b, c, d, e, f]: a point (x, y) of the reference frame
 * is at ((1 + a)x + b·y + c, d·x + (1 + e)y + f) in the other frame.
 */
export type Affine = [number, number, number, number, number, number];
export const IDENTITY: Affine = [0, 0, 0, 0, 0, 0];
export const applyAffine = (p: Affine, [x, y]: Pt): Pt => [(1 + p[0]) * x + p[1] * y + p[2], p[3] * x + (1 + p[4]) * y + p[5]];

/**
 * Where the reference frame `ref` went in `cur`: the affine motion that best
 * maps the reference's `mask` pixels onto `cur`, with a gain and an offset for
 * the camera's exposure. A translation search on the coarsest level, then
 * Gauss-Newton down a 4-level pyramid; residuals past 20 grey levels (a cursor,
 * a moving playhead) count less. Returns the motion and the RMS residual.
 */
export function registerAffine(ref: Grey, cur: Grey, mask: Uint8Array, init: Affine = IDENTITY, levels = 4): { p: Affine; rms: number } {
  const refs: Grey[] = [ref], curs: Grey[] = [cur], masks: Uint8Array[] = [mask];
  for (let l = 1; l < levels && refs[l - 1].w >= 32 && refs[l - 1].h >= 32; l++) {
    refs.push(halve(refs[l - 1]));
    curs.push(halve(curs[l - 1]));
    const pm = masks[l - 1], pw = refs[l - 1].w, w = refs[l].w, h = refs[l].h, m = new Uint8Array(w * h);
    // any of the four: the mask is thin edges, which an "all four" rule would erase within two levels
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = pm[2 * y * pw + 2 * x] | pm[2 * y * pw + 2 * x + 1] | pm[(2 * y + 1) * pw + 2 * x] | pm[(2 * y + 1) * pw + 2 * x + 1];
    masks.push(m);
  }
  const top = refs.length - 1, k0 = 2 ** top;
  const p: number[] = [init[0], init[1], init[2] / k0, init[3], init[4], init[5] / k0];
  let gain = 1, off = 0, rms = Infinity;
  // coarse translation search, so a large drift does not trap Gauss-Newton
  if (masks[top].reduce((a, v) => a + v, 0) >= 50) {
    const T = refs[top], I = curs[top], M = masks[top];
    const pts: number[] = [];
    for (let y = 0; y < T.h; y++) for (let x = 0; x < T.w; x++) if (M[y * T.w + x]) pts.push(x, y);
    let best = Infinity, bx = 0, by = 0;
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        let n = 0, st = 0, si = 0, stt = 0, sii = 0, sti = 0;
        for (let k = 0; k < pts.length; k += 2) {
          const x = pts[k], y = pts[k + 1];
          const v = at(I, (1 + p[0]) * x + p[1] * y + p[2] + dx, p[3] * x + (1 + p[4]) * y + p[5] + dy);
          if (Number.isNaN(v)) continue;
          const t = T.g[y * T.w + x];
          n++; st += t; si += v; stt += t * t; sii += v * v; sti += t * v;
        }
        if (n < Math.max(20, pts.length / 4)) continue;
        // normalised cross-correlation: the exposure may differ
        const e = -(sti - (st * si) / n) / Math.sqrt(Math.max(1e-9, (stt - (st * st) / n) * (sii - (si * si) / n)));
        if (e < best) { best = e; bx = dx; by = dy; }
      }
    p[2] += bx;
    p[5] += by;
  }
  for (let l = top; l >= 0; l--) {
    if (l < top) { p[2] *= 2; p[5] *= 2; }
    const T = refs[l], I = curs[l], M = masks[l], [Gx, Gy] = gradients(I);
    for (let it = 0; it < 40; it++) {
      const H = Array.from({ length: 8 }, () => new Array<number>(8).fill(0)), b = new Array<number>(8).fill(0);
      let n = 0, sr = 0;
      const J = new Array<number>(8);
      for (let y = 0; y < T.h; y++)
        for (let x = 0; x < T.w; x++) {
          if (!M[y * T.w + x]) continue;
          const u = (1 + p[0]) * x + p[1] * y + p[2], v = p[3] * x + (1 + p[4]) * y + p[5];
          const i = at(I, u, v);
          if (Number.isNaN(i)) continue;
          const ix = gain * at(Gx, u, v), iy = gain * at(Gy, u, v);
          const r = gain * i + off - T.g[y * T.w + x];
          const w = Math.abs(r) < 20 ? 1 : 20 / Math.abs(r);
          J[0] = ix * x; J[1] = ix * y; J[2] = ix; J[3] = iy * x; J[4] = iy * y; J[5] = iy; J[6] = i; J[7] = 1;
          for (let a = 0; a < 8; a++) {
            const wa = w * J[a];
            b[a] += wa * r;
            for (let c = a; c < 8; c++) H[a][c] += wa * J[c];
          }
          n++;
          sr += r * r;
        }
      if (n < 12) break;
      for (let a = 0; a < 8; a++) for (let c = 0; c < a; c++) H[a][c] = H[c][a];
      // a little damping keeps the step sane on weak texture
      for (let a = 0; a < 8; a++) H[a][a] *= 1.0001;
      const dp = solve(H, b.map(v => -v));
      for (let k = 0; k < 6; k++) p[k] += dp[k];
      gain += dp[6];
      off += dp[7];
      rms = Math.sqrt(sr / n);
      if (Math.abs(dp[2]) < 0.005 && Math.abs(dp[5]) < 0.005 && Math.abs(dp[0]) + Math.abs(dp[1]) + Math.abs(dp[3]) + Math.abs(dp[4]) < 1e-5) break;
    }
  }
  return { p: p as Affine, rms };
}

/** The reference frame's pixels that move with the monitor: outside the screen's quad (grown by `margin`) and textured. */
export function chromeMask(ref: Grey, quad: Quad, margin: number): Uint8Array {
  const cx = quad.reduce((a, q) => a + q[0], 0) / 4, cy = quad.reduce((a, q) => a + q[1], 0) / 4;
  const big = quad.map(([x, y]) => [cx + (x - cx) * (1 + margin), cy + (y - cy) * (1 + margin)]);
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let k = 0; k < 4; k++) {
      const [x0, y0] = big[k], [x1, y1] = big[(k + 1) % 4];
      const c = Math.sign((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0));
      if (c && sign && c !== sign) return false;
      if (c) sign = c;
    }
    return true;
  };
  const m = new Uint8Array(ref.w * ref.h);
  for (let y = 1; y < ref.h - 1; y++)
    for (let x = 1; x < ref.w - 1; x++) {
      const p = y * ref.w + x;
      const g = Math.abs(ref.g[p + 1] - ref.g[p - 1]) + Math.abs(ref.g[p + ref.w] - ref.g[p - ref.w]);
      if (g > 6 && !inside(x, y)) m[p] = 1;
    }
  return m;
}

interface Sample { t: number; n: number; tl: Pt; tr: Pt; br: Pt; bl: Pt }

/** The largest region of saturated colour (the film's content) and its four extreme corners. */
function contentCorners(f: Uint8Array, w: number, h: number): Omit<Sample, 't'> {
  const m = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const r = f[p * 3], g = f[p * 3 + 1], b = f[p * 3 + 2];
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    m[p] = hi > 70 && hi - lo > 40 ? 1 : 0;
  }
  const lab = new Int32Array(w * h).fill(-1);
  let best = -1, bestN = 0, id = 0;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s] >= 0) continue;
    let cnt = 0;
    stack.push(s);
    lab[s] = id;
    while (stack.length) {
      const q = stack.pop()!, x = q % w;
      cnt++;
      for (const nq of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w])
        if (nq >= 0 && nq < w * h && m[nq] && lab[nq] < 0) {
          lab[nq] = id;
          stack.push(nq);
        }
    }
    if (cnt > bestN) {
      bestN = cnt;
      best = id;
    }
    id++;
  }
  let tl: Pt = [0, 0], tr: Pt = [0, 0], br: Pt = [0, 0], bl: Pt = [0, 0];
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (let p = 0; p < w * h; p++) {
    if (lab[p] !== best) continue;
    const x = p % w, y = (p / w) | 0;
    if (x + y < a) { a = x + y; tl = [x, y]; }
    if (x - y > b) { b = x - y; tr = [x, y]; }
    if (x + y > d) { d = x + y; br = [x, y]; }
    if (x - y < c) { c = x - y; bl = [x, y]; }
  }
  return { n: bestN, tl, tr, br, bl };
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];

export interface RectifyOptions {
  /** Corners in source pixels (TL, TR, BR, BL) in the first frame. Default: found from the frame where the content fills its screen best. */
  quad?: Quad;
  /** Follow the phone's movement (default true). */
  track?: boolean;
  width?: number;
  /** Crop this fraction inside the screen's edges (default 0.015: keeps the frame's border and the UI next to it out). */
  inset?: number;
  log?: (s: string) => void;
}

export interface Rectified { quad: Quad; drift: { t: number; dx: number; dy: number }[]; frames: number; width: number; height: number }

/** Find the screen in a phone-filmed reference and write it out flat (16:9, with the original sound). */
export async function rectifyVideo(file: string, out: string, o: RectifyOptions = {}): Promise<Rectified> {
  const log = o.log ?? (() => undefined);
  const { w, h, fps } = await probe(file);
  // pass 1, 10 times a second: where the content is, and a small grey copy of the frame for tracking
  const rate = 10, s = Math.max(1, Math.round(w / 320));
  const samples: Sample[] = [], greys: { g: Uint8Array; w: number; h: number }[] = [];
  await frames(file, w, h, rate, (f, k) => {
    samples.push({ t: k / rate, ...contentCorners(f, w, h) });
    const g = greyOf(f, w, h, s);
    greys.push({ g: Uint8Array.from(g.g, v => Math.round(v)), w: g.w, h: g.h });
  });
  const full = Math.max(...samples.map(x => x.n));
  const good = samples.map((x, i) => ({ x, i })).filter(({ x }) => x.n >= full * 0.85);
  if (!good.length) throw new Error('could not find the screen; pass --quad "x,y x,y x,y x,y" (top-left, top-right, bottom-right, bottom-left)');
  // the reference frame: the screen whole in the picture (no corner cut off by the frame's edge), its content brightest
  const interior = (x: Sample) => [x.tl, x.tr, x.br, x.bl].every(([px, py]) => px > 2 && py > 2 && px < w - 3 && py < h - 3);
  const pick = o.quad ? { x: samples[0], i: 0 } : (good.filter(g => interior(g.x)).sort((a, b) => b.x.n - a.x.n)[0] ?? undefined);
  const med = (k: 'tl' | 'tr' | 'br' | 'bl'): Pt => [median(good.map(g => g.x[k][0])), median(good.map(g => g.x[k][1]))];
  const r = pick?.i ?? good[good.length >> 1].i;
  const quad: Quad = o.quad ?? (pick ? [pick.x.tl, pick.x.tr, pick.x.br, pick.x.bl] : [med('tl'), med('tr'), med('br'), med('bl')]);
  log(`screen corners: ${quad.map(p => p.map(Math.round).join(',')).join('  ')} at ${samples[r].t.toFixed(1)} s`);
  // tracking: everything around the screen (the editor's panels, the bezel, the desk) moves with the monitor;
  // register each frame against the reference frame on those pixels (the screen's own content changes, so it is left out)
  const grey = (k: number): Grey => ({ g: Float32Array.from(greys[k].g), w: greys[k].w, h: greys[k].h });
  const motion: Affine[] = samples.map(() => IDENTITY);
  if (o.track !== false) {
    const ref = grey(r), mask = chromeMask(ref, quad.map(([x, y]) => [x / s, y / s]) as Quad, 0.08);
    let used = 0;
    for (let k = 0; k < mask.length; k++) used += mask[k];
    if (used < 200) log('too little around the screen to track the phone; the screen is taken as still');
    else {
      const bad: number[] = [];
      const one = (k: number, init: Affine) => {
        const { p, rms } = registerAffine(ref, grey(k), mask, init);
        const sane = Math.abs(p[0]) < 0.3 && Math.abs(p[4]) < 0.3 && Math.abs(p[1]) < 0.2 && Math.abs(p[3]) < 0.2 && rms < 40;
        if (!sane) bad.push(k);
        motion[k] = sane ? p : init;
      };
      for (let k = r + 1; k < samples.length; k++) one(k, motion[k - 1]);
      for (let k = r - 1; k >= 0; k--) one(k, motion[k + 1]);
      if (bad.length) log(`  ${bad.length} of ${samples.length} frames could not be tracked; they keep their neighbour's position`);
    }
  }
  // a median of 3 against single-frame misreads; translations back to source pixels
  const smooth: Affine[] = motion.map((_, k) => {
    const win = motion.slice(Math.max(0, k - 1), k + 2);
    return [0, 1, 2, 3, 4, 5].map(j => median(win.map(m => m[j])) * (j === 2 || j === 5 ? s : 1)) as Affine;
  });
  const quadAt = (t: number): Quad => {
    const x = Math.min(samples.length - 1, Math.max(0, t * rate)), k = Math.min(samples.length - 2, Math.floor(x)), f = x - Math.max(0, k);
    const a = smooth[Math.max(0, k)], b = smooth[Math.min(samples.length - 1, k + 1)];
    const p = a.map((v, j) => v + (b[j] - v) * f) as Affine;
    return quad.map(q => applyAffine(p, q)) as Quad;
  };
  const cx = quad.reduce((a, q) => a + q[0], 0) / 4, cy = quad.reduce((a, q) => a + q[1], 0) / 4;
  const drift = samples.map(x => {
    const [px, py] = applyAffine(smooth[Math.round(x.t * rate)] ?? IDENTITY, [cx, cy]);
    return { t: x.t, dx: px - cx, dy: py - cy };
  });
  // pass 2: flatten every frame
  const ow = o.width ?? 1280, oh = Math.round((ow * 9) / 16 / 2) * 2;
  const enc = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${ow}x${oh}`, '-r', String(fps), '-i', 'pipe:0', '-i', file,
    '-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let encErr = '';
  enc.stderr.on('data', d => (encErr += d));
  const done = new Promise<number>(res => enc.on('close', c => res(c ?? 1)));
  const buf = new Uint8Array(ow * oh * 3);
  let n = 0;
  await frames(file, w, h, null, async (f, k) => {
    warp(f, w, h, quadAt(k / fps), ow, oh, buf, o.inset ?? 0.015);
    if (!enc.stdin.write(buf)) await new Promise(res => enc.stdin.once('drain', res));
    n++;
  });
  enc.stdin.end();
  if ((await done) !== 0) throw new Error(`ffmpeg: ${encErr.slice(-300)}`);
  return { quad, drift, frames: n, width: ow, height: oh };
}
