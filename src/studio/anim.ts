import { E, clamp, lerp } from '../engine/core/math';
import type { Ease, Key, Prop } from './schema';

// Keyframe evaluation, shared by the renderer (browser) and the measurer (Node).

/** Damped spring from 0 to 1 at `t` seconds (same as S.spring). */
export function spring(t: number, stiffness: number, damping: number): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness), z = damping / (2 * Math.sqrt(stiffness));
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of progress. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (u: number) => number {
  const bx = (s: number) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3;
  const by = (s: number) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
  const dx = (s: number) => 3 * x1 * (1 - s) ** 2 + 6 * (x2 - x1) * s * (1 - s) + 3 * (1 - x2) * s * s;
  return (u: number) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let s = u;
    for (let i = 0; i < 8; i++) {
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      const next = s - (bx(s) - u) / d;
      if (next < 0 || next > 1) break;
      s = next;
    }
    if (Math.abs(bx(s) - u) > 1e-4) {
      // bisection fallback
      let lo = 0, hi = 1;
      for (let i = 0; i < 30; i++) {
        s = (lo + hi) / 2;
        if (bx(s) < u) lo = s;
        else hi = s;
      }
    }
    return by(s);
  };
}

const bezierCache = new Map<string, (u: number) => number>();

/**
 * Progress 0..1 of a segment with this ease. `u` is linear progress, `secs` the
 * time since the segment started in seconds (springs run on real time).
 */
export function applyEase(ease: Ease | undefined, u: number, secs: number): number {
  if (ease === undefined) return E.inOutCubic(clamp(u));
  if (typeof ease === 'string') {
    if (ease === 'hold') return u >= 1 ? 1 : 0;
    return (E as Record<string, (x: number) => number>)[ease](clamp(u));
  }
  if (Array.isArray(ease)) {
    const k = ease.join(',');
    let f = bezierCache.get(k);
    if (!f) bezierCache.set(k, (f = bezier(ease[0], ease[1], ease[2], ease[3])));
    return f(clamp(u));
  }
  return spring(secs, ease.spring.stiffness, ease.spring.damping);
}

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
export type RGBA = [number, number, number, number];
export function parseColor(hex: string): RGBA {
  const n = parseInt(hex.slice(1, 7), 16);
  const a = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}
export const cssColor = (c: RGBA, alpha = 1): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${+(c[3] * alpha).toFixed(4)})`;
export const hex2 = (c: RGBA): string =>
  '#' + [c[0], c[1], c[2]].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('') + (c[3] < 0.999 ? Math.round(c[3] * 255).toString(16).padStart(2, '0') : '');

type Val = number | number[] | string;

function mixVal(a: Val, b: Val, p: number, color: (s: string) => RGBA): Val {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, p);
  if (typeof a === 'string' || typeof b === 'string') {
    if (typeof a !== 'string' || typeof b !== 'string') return p < 0.5 ? a : b;
    const ca = color(a), cb = color(b);
    return hex2([lerp(ca[0], cb[0], p), lerp(ca[1], cb[1], p), lerp(ca[2], cb[2], p), lerp(ca[3], cb[3], p)]);
  }
  const va = typeof a === 'number' ? [a, a] : a, vb = typeof b === 'number' ? [b, b] : b;
  return va.map((x, i) => lerp(x, vb[i] ?? x, p));
}

export const isKeys = <T>(p: Prop<T> | undefined): p is Key<T>[] =>
  Array.isArray(p) && p.length > 0 && typeof p[0] === 'object' && p[0] !== null && !Array.isArray(p[0]) && 't' in (p[0] as object);

/**
 * Value of a property at time `t` (comp units). `sec` converts comp units to
 * seconds (for springs). `color` resolves role names to colours.
 */
export function valueAt<T extends Val>(p: Prop<T> | undefined, t: number, fallback: T, sec = 1, color: (s: string) => RGBA = parseColor): T {
  if (p === undefined) return fallback;
  if (!isKeys(p)) return p as T;
  const keys = p as Key<T>[];
  if (t <= keys[0].t || keys.length === 1) return resolve(keys[0].v, color);
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i];
    if (t < k1.t || i === keys.length - 1) {
      const k0 = keys[i - 1];
      if (t >= k1.t) {
        // past the last key: a spring may still be settling
        if (k1.ease && typeof k1.ease === 'object' && !Array.isArray(k1.ease)) {
          const q = applyEase(k1.ease, 1, (t - k0.t) * sec);
          return mixVal(resolve(k0.v, color), resolve(k1.v, color), q, color) as T;
        }
        return resolve(k1.v, color);
      }
      const span = Math.max(1e-9, k1.t - k0.t);
      const q = applyEase(k1.ease, (t - k0.t) / span, (t - k0.t) * sec);
      return mixVal(resolve(k0.v, color), resolve(k1.v, color), q, color) as T;
    }
  }
  return resolve(keys[keys.length - 1].v, color);
}

function resolve<T extends Val>(v: T, color: (s: string) => RGBA): T {
  return (typeof v === 'string' && !HEX.test(v) ? hex2(color(v)) : v) as T;
}

/** Times of every keyframe of a property (for summaries and the timeline). */
export const keyTimes = (p: unknown): number[] => (isKeys(p as Prop<number>) ? (p as Key<unknown>[]).map(k => k.t) : []);

// ── 2D affine transforms: [a, b, c, d, e, f] like canvas setTransform ─────────

export type Mat = [number, number, number, number, number, number];
export const IDENT: Mat = [1, 0, 0, 1, 0, 0];
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scaleM = (x: number, y: number): Mat => [x, 0, 0, y, 0, 0];
export const rotateM = (deg: number): Mat => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
};
export const skewM = (deg: number): Mat => [1, 0, Math.tan((deg * Math.PI) / 180), 1, 0, 0];
export const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** position · rotation · skew · scale · (−anchor) */
export function layerMatrix(pos: number[], anchor: number[], scale: number | number[], rot: number, skew: number): Mat {
  const [sx, sy] = typeof scale === 'number' ? [scale, scale] : scale;
  let m = translate(pos[0], pos[1]);
  if (rot) m = mul(m, rotateM(rot));
  if (skew) m = mul(m, skewM(skew));
  m = mul(m, scaleM(sx, sy));
  if (anchor[0] || anchor[1]) m = mul(m, translate(-anchor[0], -anchor[1]));
  return m;
}

/** Perspective scale of a layer at depth z seen by a camera dollied to camZ (focal length 1000 px). */
export const FOCAL = 1000;
export const depthScale = (z: number, camZ: number): number => FOCAL / Math.max(1e-3, FOCAL + z - camZ);
