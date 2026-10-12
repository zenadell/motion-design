import { spawn } from 'node:child_process';
import { ffmpegPath } from '../cli/render';

// A reference filmed off a screen with a phone (a TikTok of someone's After
// Effects viewer, a promo playing on a monitor) shows the film as a tilted
// quadrilateral inside other things. Rectify finds that quadrilateral, follows
// the phone's drift, and flattens every frame into a clean 16:9 video that the
// measurer and the models can work on as if it were the original export.

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
  /** Corners in source pixels (TL, TR, BR, BL). Default: found from the frames where the content fills its screen. */
  quad?: Quad;
  /** Follow the phone's drift (default true). */
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
  // pass 1: where the content is, 6 times a second
  const samples: Sample[] = [];
  await frames(file, w, h, 6, (f, k) => void samples.push({ t: k / 6, ...contentCorners(f, w, h) }));
  const full = Math.max(...samples.map(s => s.n));
  const good = samples.filter(s => s.n >= full * 0.85);
  if (!good.length) throw new Error('could not find the screen; pass --quad "x,y x,y x,y x,y" (top-left, top-right, bottom-right, bottom-left)');
  const med = (k: 'tl' | 'tr' | 'br' | 'bl'): Pt => [median(good.map(s => s[k][0])), median(good.map(s => s[k][1]))];
  const quad: Quad = o.quad ?? [med('tl'), med('tr'), med('br'), med('bl')];
  log(`screen corners: ${quad.map(p => p.map(Math.round).join(',')).join('  ')} (from ${good.length} of ${samples.length} sampled frames)`);
  // drift: how the left edge moves over time (the far corners fade into dark content and are not reliable),
  // with a running median against single-frame misreads
  const anchor = (s: Sample): Pt => [(s.tl[0] + s.bl[0]) / 2, (s.tl[1] + s.bl[1]) / 2];
  const ref: Pt = [median(good.map(s => anchor(s)[0])), median(good.map(s => anchor(s)[1]))];
  const raw = good.map(s => ({ t: s.t, dx: anchor(s)[0] - ref[0], dy: anchor(s)[1] - ref[1] }));
  const drift = o.track === false ? [] : raw.map((d, i) => {
    const win = raw.slice(Math.max(0, i - 3), i + 4);
    return { t: d.t, dx: median(win.map(x => x.dx)), dy: median(win.map(x => x.dy)) };
  });
  const driftAt = (t: number): Pt => {
    if (!drift.length) return [0, 0];
    if (t <= drift[0].t) return [drift[0].dx, drift[0].dy];
    for (let i = 1; i < drift.length; i++)
      if (t <= drift[i].t) {
        const a = drift[i - 1], b = drift[i], p = (t - a.t) / (b.t - a.t || 1);
        return [a.dx + (b.dx - a.dx) * p, a.dy + (b.dy - a.dy) * p];
      }
    const z = drift[drift.length - 1];
    return [z.dx, z.dy];
  };
  // pass 2: flatten every frame
  const ow = o.width ?? 1280, oh = Math.round((ow * 9) / 16 / 2) * 2;
  const enc = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${ow}x${oh}`, '-r', String(fps), '-i', 'pipe:0', '-i', file,
    '-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let encErr = '';
  enc.stderr.on('data', d => (encErr += d));
  const done = new Promise<number>(r => enc.on('close', c => r(c ?? 1)));
  const buf = new Uint8Array(ow * oh * 3);
  let n = 0;
  await frames(file, w, h, null, async (f, k) => {
    const [dx, dy] = driftAt(k / fps);
    warp(f, w, h, quad.map(([x, y]) => [x + dx, y + dy]) as Quad, ow, oh, buf, o.inset ?? 0.015);
    if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
    n++;
  });
  enc.stdin.end();
  if ((await done) !== 0) throw new Error(`ffmpeg: ${encErr.slice(-300)}`);
  return { quad, drift, frames: n, width: ow, height: oh };
}
