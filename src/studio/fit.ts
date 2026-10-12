import { E } from '../engine/core/math';
import { bezier, spring } from './anim';
import type { Ease, Key } from './schema';

// Turns a measured curve (one value per frame) into the fewest keyframes, each
// with the ease that reproduces the motion between them: named curves, a grid
// of cubic-beziers, and springs (for overshoot).

interface Candidate { ease: Ease; f: (u: number, secs: number) => number }

const NAMED: Candidate[] = (['linear', 'inCubic', 'outCubic', 'inOutCubic', 'outQuint', 'inExpo', 'outExpo', 'inOutExpo', 'outBack'] as const).map(n => ({
  ease: n,
  f: (u: number) => (E as Record<string, (x: number) => number>)[n](u),
}));

function lut(f: (u: number) => number, n = 64): (u: number) => number {
  const tab = Array.from({ length: n + 1 }, (_, i) => f(i / n));
  return (u: number) => {
    const x = Math.max(0, Math.min(1, u)) * n, i = Math.min(n - 1, Math.floor(x));
    return tab[i] + (tab[i + 1] - tab[i]) * (x - i);
  };
}

const BEZIERS: Candidate[] = [];
for (const x1 of [0.05, 0.2, 0.35, 0.5, 0.7])
  for (const y1 of [0, 0.3, 0.7, 1, 1.4])
    for (const x2 of [0.2, 0.4, 0.6, 0.8, 0.95])
      for (const y2 of [0.6, 0.9, 1, 1.2]) {
        const e: [number, number, number, number] = [x1, y1, x2, y2];
        BEZIERS.push({ ease: e, f: lut(bezier(...e)) });
      }

const SPRINGS: Candidate[] = [];
for (const k of [60, 100, 160, 250, 400, 650, 1000])
  for (const z of [0.15, 0.25, 0.35, 0.5, 0.7]) {
    const d = Math.round(2 * z * Math.sqrt(k) * 10) / 10;
    SPRINGS.push({ ease: { spring: { stiffness: k, damping: d } }, f: (_u, s) => spring(s, k, d) });
  }

export interface FitOptions {
  /** Largest allowed error, in the value's units. */
  tol: number;
  /** Seconds per time unit (springs run on seconds). */
  sec?: number;
  /** Try bezier and spring eases (slower, fewer keys). */
  rich?: boolean;
  /** Round values to this step. */
  round?: number;
}

type V = number[];
const rnd = (x: number, s: number) => Math.round(x / s) * s;

function segmentError(ts: number[], vs: V[], i: number, j: number, c: Candidate, sec: number): { err: number; at: number } {
  const t0 = ts[i], span = ts[j] - t0 || 1e-9, a = vs[i], b = vs[j];
  let err = 0, at = -1;
  for (let k = i + 1; k < j; k++) {
    const p = c.f((ts[k] - t0) / span, (ts[k] - t0) * sec);
    for (let d = 0; d < a.length; d++) {
      const e = Math.abs(vs[k][d] - (a[d] + (b[d] - a[d]) * p));
      if (e > err) {
        err = e;
        at = k;
      }
    }
  }
  return { err, at };
}

/** Nudge a bezier or spring ease's parameters to lower the segment's error (coordinate descent). */
function refine(ts: number[], vs: V[], i: number, j: number, c: Candidate, sec: number): { c: Candidate; err: number; at: number } {
  const make = (p: number[]): Candidate | null => {
    if (Array.isArray(c.ease)) {
      if (p[0] < 0 || p[0] > 1 || p[2] < 0 || p[2] > 1 || p[1] < -1 || p[1] > 2.5 || p[3] < -1 || p[3] > 2.5) return null;
      const e: [number, number, number, number] = [+p[0].toFixed(3), +p[1].toFixed(3), +p[2].toFixed(3), +p[3].toFixed(3)];
      return { ease: e, f: lut(bezier(...e), 96) };
    }
    if (p[0] < 5 || p[0] > 4000 || p[1] < 0.2 || p[1] > 400) return null;
    const k = Math.round(p[0] * 10) / 10, d = Math.round(p[1] * 10) / 10;
    return { ease: { spring: { stiffness: k, damping: d } }, f: (_u, s) => spring(s, k, d) };
  };
  let p = Array.isArray(c.ease) ? [...c.ease] : typeof c.ease === 'object' ? [c.ease.spring.stiffness, c.ease.spring.damping] : null;
  if (!p) return { c, ...segmentError(ts, vs, i, j, c, sec) };
  let best = { c, ...segmentError(ts, vs, i, j, c, sec) };
  let step = Array.isArray(c.ease) ? [0.1, 0.2, 0.1, 0.2] : [p[0] * 0.25, p[1] * 0.25];
  for (let it = 0; it < 30; it++) {
    let improved = false;
    for (let d = 0; d < p.length; d++)
      for (const sgn of [1, -1]) {
        const q = p.slice();
        q[d] += sgn * step[d];
        const cand = make(q);
        if (!cand) continue;
        const r = segmentError(ts, vs, i, j, cand, sec);
        if (r.err < best.err - 1e-9) {
          best = { c: cand, ...r };
          p = q;
          improved = true;
        }
      }
    if (!improved) step = step.map(x => x / 2);
  }
  return best;
}

/** Keyframes that follow (ts, vs) within `tol`. Values are numbers or vectors. */
export function fitKeys(ts: number[], vs: V[], o: FitOptions): Key<number[]>[] {
  const n = ts.length;
  if (!n) return [];
  const sec = o.sec ?? 1, step = o.round ?? 0;
  const out = new Map<number, Ease | undefined>();
  out.set(0, undefined);
  const rich = o.rich !== false;
  const cands = rich ? [...NAMED, ...BEZIERS, ...SPRINGS] : NAMED;
  const fit = (i: number, j: number, depth: number) => {
    if (j <= i) return;
    if (j === i + 1) {
      out.set(j, 'linear');
      return;
    }
    // a hold: nothing moves inside
    let still = true;
    for (let k = i + 1; k <= j && still; k++) for (let d = 0; d < vs[i].length; d++) if (Math.abs(vs[k][d] - vs[i][d]) > o.tol) still = false;
    if (still) {
      out.set(j, 'linear');
      return;
    }
    type R = { c: Candidate; err: number; at: number };
    let best: R | null = null, bestBez: R | null = null, bestSpring: R | null = null;
    for (const c of cands) {
      const r: R = { c, ...segmentError(ts, vs, i, j, c, sec) };
      if (!best || r.err < best.err - 1e-9) best = r;
      if (Array.isArray(c.ease) && (!bestBez || r.err < bestBez.err)) bestBez = r;
      if (typeof c.ease === 'object' && !Array.isArray(c.ease) && (!bestSpring || r.err < bestSpring.err)) bestSpring = r;
    }
    if (best!.err > o.tol && rich)
      for (const b of [bestBez, bestSpring]) {
        if (!b) continue;
        const r = refine(ts, vs, i, j, b.c, sec);
        if (r.err < best!.err) best = r;
      }
    if (best!.err <= o.tol || depth > 24) {
      out.set(j, best!.c.ease);
      return;
    }
    // split at the worst point of the straight line (a natural key: a turn or a stop)
    const lin = segmentError(ts, vs, i, j, NAMED[0], sec);
    const at = lin.at > i && lin.at < j ? lin.at : best!.at > i && best!.at < j ? best!.at : Math.floor((i + j) / 2);
    fit(i, at, depth + 1);
    fit(at, j, depth + 1);
  };
  // keys where the value starts and stops moving: motion design is hold → move → hold
  const rest = vs.map((v, k) => {
    for (const q of [k - 1, k + 1]) if (q >= 0 && q < n) for (let d = 0; d < v.length; d++) if (Math.abs(vs[q][d] - v[d]) > o.tol * 0.25) return false;
    return true;
  });
  // a short wobble that never leaves the tolerance is still rest (slow eases flicker near the end)
  for (let k = 0; k < n; ) {
    if (rest[k]) { k++; continue; }
    let e = k;
    while (e + 1 < n && !rest[e + 1]) e++;
    const a = Math.max(0, k - 1), b = Math.min(n - 1, e + 1);
    let small = true;
    for (let d = 0; d < vs[0].length && small; d++) {
      let lo = Infinity, hi = -Infinity;
      for (let q = a; q <= b; q++) { lo = Math.min(lo, vs[q][d]); hi = Math.max(hi, vs[q][d]); }
      if (hi - lo > o.tol) small = false;
    }
    if (small) for (let q = k; q <= e; q++) rest[q] = true;
    k = e + 1;
  }
  const bounds = [0];
  for (let k = 1; k < n - 1; k++) if (rest[k] !== rest[k - 1] || rest[k] !== rest[k + 1]) if (rest[k]) bounds.push(k);
  bounds.push(n - 1);
  const uniq = [...new Set(bounds)].sort((a, b) => a - b);
  // Eases like expo settle so gently that "at rest" is detected early (or late, at the start):
  // slide each move's ends into the neighbouring holds to where one ease fits best.
  const scout = rich ? [...NAMED, ...BEZIERS.filter((_, k) => k % 6 === 0), ...SPRINGS] : NAMED;
  const quick = (i: number, j: number) => {
    let e = Infinity;
    for (const c of scout) e = Math.min(e, segmentError(ts, vs, i, j, c, sec).err);
    return e;
  };
  const isMove = (i: number, j: number) => {
    for (let k = i + 1; k <= j; k++) for (let d = 0; d < vs[i].length; d++) if (Math.abs(vs[k][d] - vs[i][d]) > o.tol) return true;
    return false;
  };
  const cuts = uniq.slice();
  for (let b = 1; b < cuts.length; b++) {
    const i = cuts[b - 1], j = cuts[b];
    if (!isMove(i, j)) continue;
    const nextEnd = b + 1 < cuts.length && !isMove(j, cuts[b + 1]) ? cuts[b + 1] : j;
    const prevStart = b >= 2 && !isMove(cuts[b - 2], i) ? cuts[b - 2] : i;
    let bestI = i, bestJ = j, bestE = quick(i, j);
    for (let ii = Math.max(prevStart, i - 8); ii <= Math.min(j - 2, i + 3); ii++)
      for (let jj = Math.max(ii + 2, j - 3); jj <= Math.min(nextEnd, j + 10); jj++) {
        if (ii === i && jj === j) continue;
        const e = quick(ii, jj);
        if (e < bestE - 1e-9) { bestE = e; bestI = ii; bestJ = jj; }
      }
    cuts[b - 1] = bestI;
    cuts[b] = bestJ;
  }
  // drop cuts that collapsed onto their neighbours
  for (let b = cuts.length - 2; b > 0; b--) if (cuts[b] <= cuts[b - 1] || cuts[b] >= cuts[b + 1]) cuts.splice(b, 1);
  for (let b = 1; b < cuts.length; b++) fit(cuts[b - 1], cuts[b], 0);
  const idx = [...out.keys()].sort((a, b) => a - b);
  const keys: Key<number[]>[] = idx.map(k => {
    const ease = out.get(k);
    const v = step ? vs[k].map(x => +rnd(x, step).toFixed(6)) : vs[k];
    return ease === undefined ? { t: ts[k], v } : { t: ts[k], v, ease };
  });
  // a straight run of holds collapses into its two ends
  return keys.filter((k, i) => {
    if (i === 0 || i === keys.length - 1) return true;
    const a = keys[i - 1], b = keys[i + 1];
    const same = (x: number[], y: number[]) => x.every((u, d) => Math.abs(u - y[d]) <= o.tol);
    return !(same(a.v, k.v) && same(k.v, b.v));
  });
}

/** Scalar convenience. */
export function fitScalar(ts: number[], vs: number[], o: FitOptions): Key<number>[] {
  return fitKeys(ts, vs.map(v => [v]), o).map(k => ({ ...k, v: k.v[0] }));
}
