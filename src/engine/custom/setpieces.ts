// Set pieces: the signature moments of a high-end reel (a 3D particle swarm,
// extruded 3D type, a shatter, a dot globe, a camera flight through portals,
// a type cylinder, volumetric light, screens floating in space), crafted by
// hand and deeply parameterised. A model-written scene directs them (what,
// where, when, which words and colours, on which beats) instead of
// re-deriving 3D projection and lighting from scratch, which is where fast
// models fall short. Exposed on the Stage as S.set.* (SETPIECE_DOCS).
//
// Every set piece is a pure function of (t, options), like everything else
// the Stage runs: options are rebuilt every frame by the scene, so any of
// them can be animated with S.kf.

import { resample } from '../assets/icons';
import { landVectors, unit } from '../assets/land';
import { drawLogo, logoOutline, type LogoRT } from '../assets/logo';
import { makeCam, NEAR, orbitCam, planeXform, proj, scr, seg, type Cam } from '../core/camera';
import { lum, mixHex, rgba } from '../core/color';
import { H, W, type G } from '../core/draw';
import { clamp, DEG, lerp, mod, prog, rnd, TAU, type Vec2, type Vec3 } from '../core/math';
import { font, type FontRole, type Theme } from '../core/theme';
import { iconPoints } from './toolkit';

type Eases = Record<string, (t: number) => number>;
type Layer = (k: string, w?: number, h?: number) => { canvas: HTMLCanvasElement; g: G };

/** Focal length at which world units equal pixels on the z = 0 plane (fov 30°). */
const F30 = H / 2 / Math.tan(15 * DEG);

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const hex = (c: unknown, fallback: string): string => (typeof c === 'string' && HEX.test(c.trim()) ? c.trim() : fallback);

/** Keyframed arrays: keys = [[time, v1, v2, …], …]; missing values carry over from the previous key. */
function keyed(E: Eases, t: number, keys: number[][] | undefined, dflt: number[], ease = 'outExpo'): number[] {
  if (!Array.isArray(keys) || !keys.length) return dflt;
  const f = E[ease] ?? E.outExpo;
  const full: number[][] = [];
  let prev = dflt;
  for (const k of keys) {
    const v = prev.map((d, i) => (typeof k[i + 1] === 'number' && Number.isFinite(k[i + 1]) ? k[i + 1] : d));
    full.push(v);
    prev = v;
  }
  if (t <= keys[0][0]) return full[0];
  for (let i = 1; i < keys.length; i++) {
    if (t < keys[i][0]) {
      const p = f(clamp((t - keys[i - 1][0]) / Math.max(1e-6, keys[i][0] - keys[i - 1][0])));
      return full[i - 1].map((v, j) => lerp(v, full[i][j], p));
    }
  }
  return full[full.length - 1];
}

/** Rotation yaw (about y) → pitch (about x) → roll (about z), degrees. */
function rotor(yawD: number, pitchD: number, rollD = 0) {
  const a = yawD * DEG, b = pitchD * DEG, c = rollD * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return (v: Vec3): Vec3 => {
    // roll
    const x0 = v[0] * cc - v[1] * sc, y0 = v[0] * sc + v[1] * cc, z0 = v[2];
    // pitch
    const y1 = y0 * cb - z0 * sb, z1 = y0 * sb + z0 * cb;
    // yaw
    return [x0 * ca + z1 * sa, y1, -x0 * sa + z1 * ca];
  };
}

/** Spin about the object's own vertical axis first, then tilt towards the camera (degrees). */
function spinTilt(yawD: number, pitchD: number) {
  const a = yawD * DEG, b = pitchD * DEG, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  return (v: Vec3): Vec3 => {
    const x = v[0] * ca + v[2] * sa, z = -v[0] * sa + v[2] * ca;
    return [x, v[1] * cb - z * sb, v[1] * sb + z * cb];
  };
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** Screen position (px) → world point on the z = 0 plane of a F30 camera. */
const world = (x: number, y: number): Vec3 => [x - W / 2, -(y - H / 2), 0];
const frontCam = (): Cam => makeCam(0, 0, -F30, 0, 0, 0, 30);

// persistent (uncleared) canvases for cached rasters
const own = new Map<string, [HTMLCanvasElement, G]>();
function surface(key: string, w: number, h: number): [HTMLCanvasElement, G, boolean] {
  const k = `${key}:${w}x${h}`;
  let e = own.get(k), fresh = false;
  if (!e) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    e = [cv, cv.getContext('2d', { willReadFrequently: true })!];
    own.set(k, e);
    fresh = true;
  }
  return [e[0], e[1], fresh];
}

// ── shape sampling (for the swarm) ──────────────────────────────────────────

interface Cloud { pts: Vec3[]; flat: boolean; links: number; gap?: number; dyn?: 'wave' | 'vortex' }
const clouds = new Map<string, Cloud>();

/** Sample ink pixels of something drawn by `paint` on a 400-px-tall canvas; returns points normalised to height 1. */
function inkPoints(key: string, n: number, paint: (g: G, w: number, h: number) => void, seed: number): Vec2[] {
  const w = 1600, h = 400;
  const [, g] = surface(`__ink:${key}`, w, h);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#fff';
  paint(g, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const ink: Vec2[] = [];
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
    if (d[(y * w + x) * 4 + 3] > 128) {
      ink.push([x, y]);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (!ink.length) return [];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, s = 1 / Math.max(1, y1 - y0);
  // a stable pseudo-random subset, spread evenly
  const order = ink.map((_, i) => i).sort((a, b) => rnd(a, seed) - rnd(b, seed));
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const p = ink[order[k % order.length]];
    const j = k >= order.length ? 1.2 : 0;
    out.push([(p[0] - cx + (rnd(k, 3) - 0.5) * 3 * (1 + j)) * s, (p[1] - cy + (rnd(k, 4) - 0.5) * 3 * (1 + j)) * s]);
  }
  return out;
}

/** Fit 2D points (height 1) into a box of height 1 and width ≤ maxW, as a flat 3D cloud with a little depth. */
function flat2d(p: Vec2[], maxW = 2.6): Vec3[] {
  let x0 = Infinity, x1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); }
  const k = Math.min(1, maxW / Math.max(1e-6, x1 - x0));
  return p.map((q, i) => [q[0] * k, -q[1] * k, (rnd(i, 7) - 0.5) * 0.04]);
}

function shapeCloud(shape: string, n: number, L: LogoRT): Cloud {
  const key = `${shape}|${n}`;
  const hit = clouds.get(key);
  if (hit) return hit;
  const s = shape.trim();
  const low = s.toLowerCase();
  let c: Cloud;
  const rand3 = (i: number, k: number) => rnd(i, k) * 2 - 1;
  if (low === 'scatter' || low === 'dust') {
    c = { pts: Array.from({ length: n }, (_, i) => [rand3(i, 11) * 1.55, rand3(i, 12) * 0.9, rand3(i, 13) * 1.1] as Vec3), flat: false, links: 0 };
  } else if (low === 'burst' || low === 'explode') {
    c = { pts: Array.from({ length: n }, (_, i) => { const u = sphereAt(i, n); const r = 1.1 + rnd(i, 14) * 0.9; return [u[0] * r, u[1] * r, u[2] * r] as Vec3; }), flat: false, links: 0 };
  } else if (low === 'sphere' || low === 'planet') {
    c = { pts: Array.from({ length: n }, (_, i) => scale3(sphereAt(i, n), 0.5)), flat: false, links: 0 };
  } else if (low === 'ring' || low === 'circle') {
    c = { pts: Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU; const r = 0.5 + (rnd(i, 15) - 0.5) * 0.025; return [Math.cos(a) * r, Math.sin(a) * r, (rnd(i, 16) - 0.5) * 0.03] as Vec3; }), flat: true, links: n };
  } else if (low === 'torus' || low === 'donut') {
    const ga = Math.PI * (3 - Math.sqrt(5));
    c = { pts: Array.from({ length: n }, (_, i) => { const u = (i / n) * TAU * 1, v = i * ga * 7; const R = 0.36, r = 0.14; return [(R + r * Math.cos(v)) * Math.cos(u * 1), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)] as Vec3; }), flat: false, links: 0 };
  } else if (low === 'helix' || low === 'dna') {
    c = { pts: Array.from({ length: n }, (_, i) => {
      const u = (i % Math.ceil(n / 2)) / Math.ceil(n / 2), strand = i < n / 2 ? 0 : Math.PI, a = u * TAU * 3 + strand, x = (u - 0.5) * 1.9;
      if (i % 9 === 0) { const q = rnd(i, 17) * 2 - 1; return [x, Math.cos(u * TAU * 3) * 0.22 * q, Math.sin(u * TAU * 3) * 0.22 * q] as Vec3; }
      return [x, Math.cos(a) * 0.22, Math.sin(a) * 0.22] as Vec3;
    }), flat: false, links: 0 };
  } else if (low === 'cube' || low === 'box') {
    const V: Vec3[] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) V.push([x * 0.36, y * 0.36, z * 0.36]);
    const E2 = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    c = { pts: Array.from({ length: n }, (_, i) => { const e = E2[i % 12], u = Math.floor(i / 12) / Math.ceil(n / 12); const a = V[e[0]], b = V[e[1]]; return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)] as Vec3; }), flat: false, links: 0 };
  } else if (low === 'plane' || low === 'grid' || low === 'wave') {
    const cols = Math.max(2, Math.round(Math.sqrt(n * 1.8))), rows = Math.max(2, Math.ceil(n / cols));
    c = { pts: Array.from({ length: n }, (_, i) => [((i % cols) / (cols - 1) - 0.5) * 2.2, 0, (Math.floor(i / cols) / (rows - 1) - 0.5) * 1.3] as Vec3), flat: false, links: 0, dyn: low === 'wave' ? 'wave' : undefined };
  } else if (low === 'vortex' || low === 'galaxy' || low === 'spiral') {
    c = { pts: Array.from({ length: n }, (_, i) => { const r = Math.sqrt(rnd(i, 18)) * 0.95, arm = Math.floor(rnd(i, 22) * 3) * (TAU / 3), a = arm + r * 7 + (rnd(i, 19) - 0.5) * 0.5; return [Math.cos(a) * r, (rnd(i, 20) - 0.5) * 0.06 * (1 - r), Math.sin(a) * r] as Vec3; }), flat: false, links: 0, dyn: 'vortex' };
  } else if (low === 'logo' || low === 'mark') {
    const nOut = Math.floor(n * 0.55);
    const outline = [...resample(logoOutline(L), nOut)];
    const fill = inkPoints('logo', n - nOut, (g, w, h) => drawLogo(g, L, w / 2, h / 2, h * 0.8, '#fff'), 5);
    // put both in one frame: the outline is normalised to height 1 already; fill likewise
    c = { pts: flat2d([...outline, ...(fill.length ? fill : outline)].slice(0, n)), flat: true, links: nOut };
  } else if (low.startsWith('icon:')) {
    const pts = iconPoints(s.slice(5).trim(), n);
    c = pts.length ? { pts: flat2d(pts), flat: true, links: n } : shapeCloud('sphere', n, L);
  } else if (low.startsWith('text:')) {
    const text = s.slice(5).trim() || '•';
    const pts = inkPoints(`text:${text}`, n, (g, w, h) => {
      font(g, 300, 900, 'display');
      const tw = g.measureText(text).width, k = Math.min(1, (w - 40) / tw);
      g.setTransform(k, 0, 0, k, w / 2 - (tw * k) / 2, h / 2 + 105 * k);
      g.fillText(text, 0, 0);
    }, 9);
    c = { pts: flat2d(pts.length ? pts : [[0, 0]]), flat: true, links: 0 };
  } else {
    c = shapeCloud('sphere', n, L);
  }
  if (c.pts.length < n) c.pts = Array.from({ length: n }, (_, i) => c.pts[i % Math.max(1, c.pts.length)] ?? [0, 0, 0]);
  if (c.links > 1) {
    // typical spacing along the outline, to tell neighbours from jumps between loops
    const d: number[] = [];
    for (let i = 0; i < c.links - 1; i++) d.push(Math.hypot(c.pts[i + 1][0] - c.pts[i][0], c.pts[i + 1][1] - c.pts[i][1]));
    d.sort((a, b) => a - b);
    c.gap = d[Math.floor(d.length / 2)] ?? 0.01;
  }
  clouds.set(key, c);
  return c;
}

function sphereAt(i: number, n: number): Vec3 {
  const ga = Math.PI * (3 - Math.sqrt(5)), y = 1 - ((i + 0.5) / n) * 2, r = Math.sqrt(1 - y * y);
  return [Math.cos(ga * i) * r, y, Math.sin(ga * i) * r];
}

// ── the factory ─────────────────────────────────────────────────────────────

export interface SetCtx {
  theme: Theme;
  logo: LogoRT;
  eases: Eases;
  layerOf: Layer;
}

export function setPieces(X: SetCtx) {
  const T = X.theme, E = X.eases, L = X.logo;
  const paintBg = (g: G, bg: unknown) => {
    if (bg === null || bg === false) return;
    g.fillStyle = hex(bg, T.bg);
    g.fillRect(0, 0, W, H);
  };
  const isDark = (bg: unknown) => (bg === null || bg === false ? true : lum(hex(bg, T.bg)) < 0.45);

  // ── 1. swarm ──────────────────────────────────────────────────────────────
  interface SwarmOpts {
    shapes?: [number, string][];
    count?: number; x?: number; y?: number; size?: number;
    colors?: string[]; spin?: number; tilt?: number; morph?: number; stagger?: number; swirl?: number;
    dot?: number; glow?: number; links?: boolean; trails?: boolean; burst?: number[]; bg?: string | null;
  }
  function swarm(g: G, t: number, o: SwarmOpts = {}) {
    const n = Math.round(clamp(o.count ?? 1600, 100, 4000));
    const shapes = Array.isArray(o.shapes) && o.shapes.length ? o.shapes.filter(s => Array.isArray(s) && typeof s[1] === 'string') : [[0, 'scatter'], [0.6, 'sphere']] as [number, string][];
    const cx = o.x ?? W / 2, cy = o.y ?? H / 2, size = o.size ?? 520;
    const cols = (o.colors?.length ? o.colors : [T.primary, T.secondary, T.text]).map(c => hex(c, T.primary));
    const spin = (o.spin ?? 24) * DEG, tilt = (o.tilt ?? 18) * DEG, dur = o.morph ?? 0.55, stag = o.stagger ?? 0.14, swirl = o.swirl ?? 1;
    const dotR = o.dot ?? 2.6, glowK = o.glow ?? 1, trails = o.trails ?? true, links = o.links ?? true;
    const dark = isDark(o.bg);
    paintBg(g, o.bg);
    // current / previous targets
    let k = 0;
    for (let i = 0; i < shapes.length; i++) if (t >= shapes[i][0]) k = i;
    const cur = shapeCloud(shapes[k][1], n, L), prev = k > 0 ? shapeCloud(shapes[k - 1][1], n, L) : cur;
    const t0 = shapes[k][0];
    const pGlobal = k > 0 ? E.outExpo(prog(t, t0, t0 + dur + stag)) : 1;
    const flatW = (cur.flat ? pGlobal : 0) + (prev.flat && k > 0 ? 1 - pGlobal : 0);
    const bursts = (o.burst ?? []).filter(b => typeof b === 'number');
    const D = 2200;
    const pos = (tt: number, out: Float32Array) => {
      const free = mod(spin * tt + Math.PI, TAU) - Math.PI;
      const w = clamp(flatW);
      const yaw = free * (1 - w) + 0.12 * Math.sin(tt * 0.9) * w, pitch = tilt * (1 - w) + 0.05 * Math.sin(tt * 0.7) * w;
      const R = spinTilt(yaw / DEG, pitch / DEG);
      let kick = 0;
      for (const b of bursts) if (tt >= b) { const d = tt - b; kick += d * 16 * Math.exp(-d * 7); }
      for (let i = 0; i < n; i++) {
        const di = rnd(i, 31) * stag;
        const p = k > 0 ? E.outExpo(prog(tt, t0 + di, t0 + di + dur)) : 1;
        let a = prev.pts[i], b = cur.pts[i];
        if (prev.dyn) a = dynamic(prev.dyn, a, tt);
        if (cur.dyn) b = dynamic(cur.dyn, b, tt);
        const sw = Math.sin(Math.PI * p) * swirl * 0.35;
        let v: Vec3 = [
          lerp(a[0], b[0], p) + sw * (rnd(i, 32) - 0.5),
          lerp(a[1], b[1], p) + sw * (rnd(i, 33) - 0.5),
          lerp(a[2], b[2], p) + sw * (rnd(i, 34) - 0.5) * 1.6,
        ];
        if (kick > 0) { const u = sphereAt(i, n); v = add(v, scale3(u, kick * 0.18 * (0.5 + rnd(i, 35)))); }
        v = R(v);
        const zz = v[2] * size, persp = D / (D + zz);
        out[i * 4] = cx + v[0] * size * persp;
        out[i * 4 + 1] = cy - v[1] * size * persp;
        out[i * 4 + 2] = persp;
        out[i * 4 + 3] = p;
      }
    };
    const P = new Float32Array(n * 4);
    pos(t, P);
    let Q: Float32Array | null = null;
    if (trails && (pGlobal < 0.995 || bursts.some(b => t >= b && t - b < 0.6))) { Q = new Float32Array(n * 4); pos(t - 1 / 30, Q); }
    const ink = X.layerOf('__swarm', W, H);
    const draw = (h: G) => {
      h.save();
      if (dark) h.globalCompositeOperation = 'lighter';
      // links along outlines once settled
      const nl = links ? Math.min(cur.links, n) : 0;
      if (nl > 1) {
        const lim = (cur.gap ?? 0.01) * size * 3;
        for (const [lw, a] of [[6, 0.1], [2, 0.75]] as const) {
          h.strokeStyle = cols[0]; h.lineWidth = lw; h.lineCap = 'round'; h.globalAlpha = a;
          h.beginPath();
          for (let i = 0; i < nl - 1; i++) {
            if (P[i * 4 + 3] < 0.9 || P[i * 4 + 7] < 0.9) continue;
            const ax = P[i * 4], ay = P[i * 4 + 1], bx = P[i * 4 + 4], by = P[i * 4 + 5];
            if (Math.hypot(bx - ax, by - ay) > lim) continue;
            h.moveTo(ax, ay); h.lineTo(bx, by);
          }
          h.stroke();
        }
        h.globalAlpha = 1;
      }
      // trails
      if (Q) {
        h.lineCap = 'round';
        for (let c = 0; c < cols.length; c++) {
          h.strokeStyle = cols[c]; h.globalAlpha = 0.4; h.lineWidth = dotR * 0.9;
          h.beginPath();
          for (let i = c; i < n; i += cols.length) {
            const dx = P[i * 4] - Q[i * 4], dy = P[i * 4 + 1] - Q[i * 4 + 1], d = Math.hypot(dx, dy);
            if (d < 3) continue;
            const k = Math.min(1, 46 / d);
            h.moveTo(P[i * 4] - dx * k, P[i * 4 + 1] - dy * k); h.lineTo(P[i * 4], P[i * 4 + 1]);
          }
          h.stroke();
        }
        h.globalAlpha = 1;
      }
      // dots, bucketed by colour and depth
      for (let c = 0; c < cols.length; c++) {
        const bk = [new Path2D(), new Path2D(), new Path2D()];
        for (let i = c; i < n; i += cols.length) {
          const x = P[i * 4], y = P[i * 4 + 1], s = P[i * 4 + 2];
          if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
          const r = dotR * s * (0.75 + 0.5 * rnd(i, 36));
          const d = s > 1.08 ? 2 : s > 0.94 ? 1 : 0;
          bk[d].moveTo(x + r, y); bk[d].arc(x, y, r, 0, TAU);
        }
        h.fillStyle = cols[c];
        bk.forEach((p, d) => { h.globalAlpha = [0.45, 0.8, 1][d]; h.fill(p); });
      }
      h.restore();
    };
    draw(ink.g);
    if (glowK > 0 && dark) {
      // bloom at half resolution
      const half = X.layerOf('__swarm-bloom', W / 2, H / 2);
      half.g.filter = 'blur(7px)';
      half.g.drawImage(ink.canvas, 0, 0, W / 2, H / 2);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(0.9 * glowK, 0, 1);
      g.drawImage(half.canvas, 0, 0, W, H);
      if (glowK > 1) { g.globalAlpha = clamp(0.9 * (glowK - 1), 0, 1); g.drawImage(half.canvas, 0, 0, W, H); }
      g.restore();
    }
    g.drawImage(ink.canvas, 0, 0);
  }
  function dynamic(kind: 'wave' | 'vortex', v: Vec3, t: number): Vec3 {
    if (kind === 'wave') return [v[0], 0.09 * Math.sin(v[0] * 6 + t * 3.2) * Math.cos(v[2] * 5 - t * 2.1), v[2]];
    const r = Math.hypot(v[0], v[2]), a = Math.atan2(v[2], v[0]) + t * (1.4 - r);
    return [Math.cos(a) * r, v[1], Math.sin(a) * r];
  }

  // ── shared: something to draw on a plane (text or the logo), centred on 0,0 ──
  interface Mark { text?: string; logo?: boolean; size?: number; weight?: number; role?: FontRole; italic?: boolean; tracking?: number }
  /** Draws the mark centred at 0,0 with the current fillStyle; returns its width and height. */
  const markMetrics = (g: G, m: Mark) => {
    const size = m.size ?? 320;
    if (m.logo || !m.text) {
      const w = L.path ? (L.box[2] / L.box[3]) * size : size;
      return {
        w, h: size,
        paint: (h: G, stroke = false) => {
          if (!L.path) { if (!stroke) drawLogo(h, L, 0, 0, size, h.fillStyle as unknown as string); return; }
          const k = size / L.box[3];
          h.save();
          h.scale(k, k);
          h.translate(-(L.box[0] + L.box[2] / 2), -(L.box[1] + L.box[3] / 2));
          if (stroke) { h.lineWidth /= k; h.stroke(L.path); } else h.fill(L.path);
          h.restore();
        },
      };
    }
    font(g, size, m.weight ?? 900, m.role ?? 'display', m.italic);
    const tr = (m.tracking ?? -0.02) * size;
    g.letterSpacing = `${tr}px`;
    const mm = g.measureText(m.text);
    g.letterSpacing = '0px';
    const w = mm.width, asc = mm.actualBoundingBoxAscent, desc = mm.actualBoundingBoxDescent, hh = asc + desc;
    return {
      w, h: hh,
      paint: (h: G, stroke = false) => {
        font(h, size, m.weight ?? 900, m.role ?? 'display', m.italic);
        h.letterSpacing = `${tr}px`;
        h.textAlign = 'left'; h.textBaseline = 'alphabetic';
        if (stroke) h.strokeText(m.text!, -w / 2, (asc - desc) / 2);
        else h.fillText(m.text!, -w / 2, (asc - desc) / 2);
        h.letterSpacing = '0px';
      },
    };
  };

  // ── 2. extrude ────────────────────────────────────────────────────────────
  interface ExtrudeOpts extends Mark {
    x?: number; y?: number; depth?: number; layers?: number;
    pose?: number[][]; ease?: string; build?: number;
    face?: string; side?: string; rim?: string; shine?: number[]; float?: number; glow?: number; bg?: string | null;
  }
  function extrude(g: G, t: number, o: ExtrudeOpts = {}) {
    paintBg(g, o.bg);
    const cam = frontCam();
    const [yaw, pitch, roll, zoom] = keyed(E, t, o.pose ?? [[0, -55, 28, -8, 0.55], [0.7, -22, 13, -2, 1]], [0, 0, 0, 1], o.ease ?? 'outExpo');
    const fl = o.float ?? 1;
    const R = rotor(yaw + fl * (5 * Math.sin(t * 0.8) + 3 * t), pitch + fl * 3 * Math.sin(t * 0.63 + 1), roll);
    const sc = Math.max(0.02, zoom);
    const C: Vec3 = [(o.x ?? W / 2) - W / 2, -((o.y ?? H / 2) - H / 2), F30 * (1 / sc - 1)];
    const m = markMetrics(g, o);
    const depth = (o.depth ?? (o.size ?? 320) * 0.42) * E.outExpo(prog(t, 0, o.build ?? 0.5));
    const N = Math.round(clamp(o.layers ?? 30, 4, 60));
    const face = hex(o.face, T.text), side = hex(o.side, mixHex(T.primary, T.bg, 0.35)), rim = hex(o.rim, T.accent);
    const dark = isDark(o.bg);
    if ((o.glow ?? 1) > 0 && dark) {
      const s = scr(cam, proj(cam, C[0], C[1], C[2]));
      const r = Math.max(m.w, m.h) * 0.9 * sc;
      const gr = g.createRadialGradient(s[0], s[1], 0, s[0], s[1], Math.max(1, r));
      gr.addColorStop(0, rgba(T.primary, 0.32 * (o.glow ?? 1))); gr.addColorStop(1, rgba(T.primary, 0));
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    const origin = (z: number): Vec3 => add(C, R([0, 0, z]));
    const UX = R([1, 0, 0]), UY = R([0, -1, 0]);
    const gap = depth / N;
    const slices = Array.from({ length: depth >= 1 ? N + 1 : 1 }, (_, k) => ({ k, d: proj(cam, ...origin((k / N) * depth))[2] })).sort((a, b) => b.d - a.d);
    for (const { k } of slices) {
      g.save();
      if (!planeXform(g, cam, origin((k / N) * depth), UX, UY)) { g.restore(); continue; }
      if (k > 0) {
        const shade = 1 - k / N;
        g.fillStyle = mixHex(mixHex(side, '#000000', 0.55), side, 0.35 + 0.65 * shade);
        g.strokeStyle = g.fillStyle; g.lineWidth = gap * 1.3; g.lineJoin = 'round';
        m.paint(g);
        m.paint(g, true);
      } else {
        // the face, with a moving specular band
        const gr = g.createLinearGradient(-m.w / 2, -m.h / 2, m.w / 2, m.h / 2);
        const base = mixHex(face, side, 0.18);
        gr.addColorStop(0, face);
        let band = -1;
        for (const at of o.shine ?? [0.35]) { const p = prog(t, at, at + 0.7); if (p > 0 && p < 1) band = lerp(-0.2, 1.2, E.inOutCubic(p)); }
        if (band > -0.2 && band < 1.2) {
          const w = 0.09;
          if (band - w > 0 && band - w < 1) gr.addColorStop(band - w, mixHex(face, base, band - w));
          gr.addColorStop(clamp(band), mixHex(face, '#FFFFFF', 0.85));
          if (band + w < 1 && band + w > 0) gr.addColorStop(band + w, mixHex(face, base, band + w));
        }
        gr.addColorStop(1, base);
        g.fillStyle = gr;
        m.paint(g);
        g.strokeStyle = rgba(rim, 0.55); g.lineWidth = Math.max(1.5, (o.size ?? 320) * 0.006);
        m.paint(g, true);
      }
      g.restore();
    }
  }

  // ── 3. shatter ────────────────────────────────────────────────────────────
  interface ShatterOpts extends Mark {
    x?: number; y?: number; color?: string; edge?: string;
    inAt?: number; dur?: number; outAt?: number; outDur?: number; pieces?: number; spread?: number; flash?: boolean; bg?: string | null;
  }
  type Shard = { tri: Vec2[]; c: Vec2; bx: number; by: number; bw: number; bh: number; r: number[] };
  const shardCache = new Map<string, Shard[]>();
  function shatter(g: G, t: number, o: ShatterOpts = {}) {
    paintBg(g, o.bg);
    const x = o.x ?? W / 2, y = o.y ?? H / 2, col = hex(o.color, T.text), edge = hex(o.edge, T.primary);
    const key = JSON.stringify([o.text, o.logo, x, y, o.size, o.weight, o.role, o.italic, o.tracking, col, o.pieces]);
    const [ink, ig, fresh] = surface(`__shatter:${key}`, W, H);
    if (fresh) {
      ig.fillStyle = col;
      ig.translate(x, y);
      const m = markMetrics(ig, o);
      m.paint(ig);
      ig.setTransform(1, 0, 0, 1, 0, 0);
    }
    let shards = shardCache.get(key);
    if (!shards) {
      const m = markMetrics(g, o);
      const bx0 = x - m.w / 2 - 20, by0 = y - m.h / 2 - 20, bw = m.w + 40, bh = m.h + 40;
      const target = clamp(o.pieces ?? 70, 12, 240);
      const cols = Math.max(2, Math.round(Math.sqrt((target / 2) * (bw / bh)))), rows = Math.max(2, Math.round(target / 2 / cols));
      const V: Vec2[][] = [];
      for (let j = 0; j <= rows; j++) {
        V.push([]);
        for (let i = 0; i <= cols; i++) {
          const edgeV = i === 0 || j === 0 || i === cols || j === rows;
          V[j].push([bx0 + (i / cols) * bw + (edgeV ? 0 : (rnd(i, j * 7 + 1) - 0.5) * 0.7 * (bw / cols)), by0 + (j / rows) * bh + (edgeV ? 0 : (rnd(i + 99, j * 7 + 2) - 0.5) * 0.7 * (bh / rows))]);
        }
      }
      const data = ig.getImageData(0, 0, W, H).data;
      const alphaAt = (p: Vec2) => { const xi = Math.round(clamp(p[0], 0, W - 1)), yi = Math.round(clamp(p[1], 0, H - 1)); return data[(yi * W + xi) * 4 + 3]; };
      shards = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = V[j][i], b = V[j][i + 1], c = V[j + 1][i + 1], d = V[j + 1][i];
        const tris = (i + j) % 2 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
        for (const tri of tris) {
          const ctr: Vec2 = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3];
          let hit = false;
          for (let s = 0; s < 10 && !hit; s++) {
            const u = rnd(s, 1), v = rnd(s, 2) * (1 - u);
            hit = alphaAt([tri[0][0] + (tri[1][0] - tri[0][0]) * u + (tri[2][0] - tri[0][0]) * v, tri[0][1] + (tri[1][1] - tri[0][1]) * u + (tri[2][1] - tri[0][1]) * v]) > 20;
          }
          if (!hit) continue;
          const xs = tri.map(p => p[0]), ys = tri.map(p => p[1]);
          const bx = Math.floor(Math.min(...xs)) - 1, by = Math.floor(Math.min(...ys)) - 1;
          const k = shards.length;
          shards.push({ tri, c: ctr, bx, by, bw: Math.ceil(Math.max(...xs)) - bx + 2, bh: Math.ceil(Math.max(...ys)) - by + 2, r: [rnd(k, 41), rnd(k, 42), rnd(k, 43), rnd(k, 44), rnd(k, 45)] });
        }
      }
      shardCache.set(key, shards);
    }
    const inAt = o.inAt ?? 0, dur = o.dur ?? 0.55, outAt = o.outAt, outDur = o.outDur ?? 0.5, spread = o.spread ?? 1;
    const D = 1800;
    const prog1 = (s: Shard) => E.outExpo(prog(t, inAt + s.r[4] * dur * 0.35, inAt + s.r[4] * dur * 0.35 + dur * 0.65));
    const prog2 = (s: Shard) => (outAt === undefined ? 0 : E.inExpo(prog(t, outAt + s.r[4] * outDur * 0.3, outAt + s.r[4] * outDur * 0.3 + outDur * 0.7)));
    const done = shards.every(s => prog1(s) >= 1 && prog2(s) <= 0);
    if (done) g.drawImage(ink, 0, 0);
    else {
      for (const s of shards) {
        const a = prog1(s), b = prog2(s), away = Math.max(1 - a, b);
        if (away >= 0.999 && b > 0) continue;
        const dx = s.c[0] - x, dy = s.c[1] - y, dl = Math.hypot(dx, dy) || 1;
        const dist = spread * (500 + 900 * s.r[0]) * away;
        const ox = (dx / dl + (s.r[1] - 0.5) * 0.8) * dist, oy = (dy / dl + (s.r[2] - 0.5) * 0.8) * dist;
        const z = (s.r[3] - 0.65) * 2600 * away, k = D / Math.max(200, D + z);
        const rot = (s.r[1] - 0.5) * 5 * away, flip = Math.cos(s.r[2] * Math.PI * 1.5 * away);
        g.save();
        g.translate(x + (s.c[0] - x + ox) * k, y + (s.c[1] - y + oy) * k);
        g.rotate(rot); g.scale(k * flip, k); g.translate(-s.c[0], -s.c[1]);
        g.globalAlpha = clamp(1.4 - away * 0.9);
        g.beginPath(); g.moveTo(s.tri[0][0], s.tri[0][1]); g.lineTo(s.tri[1][0], s.tri[1][1]); g.lineTo(s.tri[2][0], s.tri[2][1]); g.closePath();
        g.save(); g.clip();
        g.drawImage(ink, s.bx, s.by, s.bw, s.bh, s.bx, s.by, s.bw, s.bh);
        g.restore();
        if (away > 0.01) { g.strokeStyle = rgba(edge, 0.9 * Math.min(1, away * 3)); g.lineWidth = 1.5 / k; g.stroke(); }
        g.restore();
      }
    }
    if (o.flash ?? true) {
      const land = inAt + dur;
      const f = t >= land - 0.04 ? Math.exp(-(t - land + 0.04) * 9) : 0;
      if (f > 0.01 && isDark(o.bg)) {
        g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = f * 0.9; g.filter = 'blur(10px)'; g.drawImage(ink, 0, 0); g.filter = 'none'; g.globalAlpha = f * 0.6; g.drawImage(ink, 0, 0); g.restore();
      }
    }
  }

  // ── 4. globe ──────────────────────────────────────────────────────────────
  interface GlobeOpts {
    x?: number; y?: number; r?: number; view?: number[][]; spin?: number;
    arcs?: { from: [number, number]; to: [number, number]; at: number; label?: string }[];
    pins?: { at: [number, number]; t?: number; label?: string }[];
    color?: string; accent?: string; reveal?: number; atmosphere?: number; beat?: number; bg?: string | null;
  }
  const slerp = (a: Vec3, b: Vec3, s: number): Vec3 => {
    const d = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1), om = Math.acos(d);
    if (om < 1e-4) return [a[0], a[1], a[2]];
    const k1 = Math.sin((1 - s) * om) / Math.sin(om), k2 = Math.sin(s * om) / Math.sin(om);
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  };
  function globe(g: G, t: number, o: GlobeOpts = {}) {
    paintBg(g, o.bg);
    const col = hex(o.color, T.text), acc = hex(o.accent, T.primary);
    const [lon0, lat0, cx, cy, vr] = keyed(E, t, o.view, [0, 15, o.x ?? W / 2, o.y ?? H / 2, o.r ?? 420], 'inOutCubic');
    const lam = (lon0 + (o.spin ?? 6) * t) * DEG, phi = lat0 * DEG, R = Math.max(1, vr);
    const cl = Math.cos(lam), sl = Math.sin(lam), cp = Math.cos(phi), sp = Math.sin(phi);
    /** → [screen x, screen y, facing (> 0 on the near side), x1, y2] */
    const G2 = (v: Vec3) => {
      const x1 = v[0] * cl - v[2] * sl, z1 = v[0] * sl + v[2] * cl;
      const y2 = v[1] * cp - z1 * sp, z2 = v[1] * sp + z1 * cp;
      return [cx + R * x1, cy - R * y2, z2, x1, y2];
    };
    const beat = o.beat ?? 0;
    const dark = isDark(o.bg);
    // atmosphere
    const atm = o.atmosphere ?? 1;
    if (atm > 0) {
      const gr = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.45);
      gr.addColorStop(0, rgba(acc, 0.28 * atm)); gr.addColorStop(1, rgba(acc, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 1.45, 0, TAU); g.fill();
    }
    const body = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
    const bgc = hex(o.bg, T.bg);
    body.addColorStop(0, mixHex(bgc, dark ? '#FFFFFF' : '#000000', 0.08)); body.addColorStop(1, mixHex(bgc, dark ? '#FFFFFF' : '#000000', 0.02));
    g.fillStyle = body; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
    g.strokeStyle = rgba(acc, 0.45); g.lineWidth = 1.5; g.stroke();
    // graticule
    g.save(); g.strokeStyle = rgba(col, 0.07); g.lineWidth = 1;
    for (let la = -60; la <= 60; la += 30) { g.beginPath(); let pen = false; for (let lo = -180; lo <= 180; lo += 6) { const q = G2(unit(la, lo)); if (q[2] <= 0) { pen = false; continue; } if (pen) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); pen = true; } g.stroke(); }
    for (let lo = -180; lo < 180; lo += 30) { g.beginPath(); let pen = false; for (let la = -90; la <= 90; la += 6) { const q = G2(unit(la, lo)); if (q[2] <= 0) { pen = false; continue; } if (pen) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); pen = true; } g.stroke(); }
    g.restore();
    // land
    const land = landVectors();
    const reveal = o.reveal === undefined ? prog(t, 0, 0.5) : clamp(o.reveal);
    const buckets = Array.from({ length: 5 }, () => new Path2D());
    const ds = Math.max(1, R / 170) * (1 + 0.15 * beat);
    for (let i = 0; i < land.length; i++) {
      if (reveal < 1 && rnd(i, 21) > reveal) continue;
      const q = G2(land[i]);
      if (q[2] <= 0.02) continue;
      buckets[Math.min(4, Math.floor(q[2] * 5))].rect(q[0] - ds, q[1] - ds, ds * 2, ds * 2);
    }
    buckets.forEach((p, i) => { g.fillStyle = rgba(col, 0.14 + i * 0.16); g.fill(p); });
    if (!land.length) {
      // no land data: a fibonacci dot sphere
      const p = new Path2D();
      for (let i = 0; i < 1400; i++) { const q = G2(sphereAt(i, 1400)); if (q[2] > 0) p.rect(q[0] - ds, q[1] - ds, ds * 2, ds * 2); }
      g.fillStyle = rgba(col, 0.5); g.fill(p);
    }
    const vis = (q: number[]) => q[2] > 0 || q[3] * q[3] + q[4] * q[4] > 1;
    g.save();
    if (dark) g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (const a of o.arcs ?? []) {
      if (!Array.isArray(a?.from) || !Array.isArray(a?.to) || t < (a.at ?? 0)) continue;
      const A = unit(a.from[0], a.from[1]), B = unit(a.to[0], a.to[1]);
      const om = Math.acos(clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1)), hgt = 0.08 + 0.3 * (om / Math.PI);
      const head = E.outCubic(prog(t, a.at, a.at + 0.45));
      const at = (s: number) => { const v = slerp(A, B, s), k = 1 + hgt * Math.sin(Math.PI * s); return G2([v[0] * k, v[1] * k, v[2] * k]); };
      for (const [lw, al] of [[9, 0.12], [2.6, 0.95]] as const) {
        g.strokeStyle = acc; g.lineWidth = lw * Math.max(0.5, R / 420); g.globalAlpha = al; g.beginPath();
        let pen = false;
        for (let j = 0; j <= 48; j++) { const q = at((j / 48) * head); if (!vis(q)) { pen = false; continue; } if (pen) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); pen = true; }
        g.stroke();
      }
      g.globalAlpha = 1;
      const hq = at(head);
      if (head < 1 && vis(hq)) { const gr = g.createRadialGradient(hq[0], hq[1], 0, hq[0], hq[1], 28); gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(1, rgba(acc, 0)); g.fillStyle = gr; g.fillRect(hq[0] - 28, hq[1] - 28, 56, 56); }
      if (head >= 1) {
        const e = G2(B);
        if (e[2] > 0) {
          const rp = prog(t, a.at + 0.45, a.at + 1.0);
          g.strokeStyle = acc; g.lineWidth = 2; g.globalAlpha = 1 - rp; g.beginPath(); g.arc(e[0], e[1], 6 + rp * 34, 0, TAU); g.stroke(); g.globalAlpha = 1;
          g.fillStyle = col; g.beginPath(); g.arc(e[0], e[1], 4.5, 0, TAU); g.fill();
          if (a.label) { g.globalCompositeOperation = 'source-over'; font(g, 16, 600, 'mono'); g.letterSpacing = '2px'; g.fillStyle = rgba(col, clamp(e[2] * 2)); g.fillText(a.label.toUpperCase(), e[0] + 12, e[1] - 10); g.letterSpacing = '0px'; if (dark) g.globalCompositeOperation = 'lighter'; }
        }
      }
    }
    g.restore();
    for (const p of o.pins ?? []) {
      if (!Array.isArray(p?.at)) continue;
      const t0 = p.t ?? 0; if (t < t0) continue;
      const q = G2(unit(p.at[0], p.at[1])); if (q[2] <= 0) continue;
      const drop = (E.outBack as (x: number, s?: number) => number)(prog(t, t0, t0 + 0.25), 2);
      for (let k = 0; k < 2; k++) { const rp = mod(t - t0 + k * 0.35, 0.7) / 0.7; g.strokeStyle = acc; g.lineWidth = 2.5; g.globalAlpha = (1 - rp) * drop; g.beginPath(); g.arc(q[0], q[1], 8 + rp * 46, 0, TAU); g.stroke(); }
      g.globalAlpha = 1;
      g.fillStyle = col; g.beginPath(); g.arc(q[0], q[1], 7 * drop, 0, TAU); g.fill();
      if (p.label) { font(g, 18, 700, 'mono'); g.letterSpacing = '3px'; g.fillStyle = rgba(col, drop); g.fillText(p.label.toUpperCase(), q[0] + 18, q[1] + 32); g.letterSpacing = '0px'; }
    }
  }

  // ── 5. flight ─────────────────────────────────────────────────────────────
  interface FlightOpts {
    passes?: number[]; portals?: { word?: string; color?: string; shape?: 'rect' | 'ring' | 'diamond' }[];
    spacing?: number; floor?: 'grid' | 'dots' | 'none'; dust?: number; fov?: number; roll?: number[][];
    sway?: number; line?: string; colors?: string[]; flash?: boolean; bg?: string | null;
  }
  function flight(g: G, t: number, o: FlightOpts = {}) {
    paintBg(g, o.bg);
    const spacing = o.spacing ?? 1500, FLOOR = -520;
    const passes = (o.passes?.length ? o.passes : [0.5, 1, 1.5, 2]).filter(x => typeof x === 'number');
    const portals = passes.map((_, i) => o.portals?.[i] ?? {});
    const cols = (o.colors?.length ? o.colors : [T.primary, T.text, T.secondary]).map(c => hex(c, T.primary));
    const line = hex(o.line, T.text);
    const zAt = (tt: number) => {
      // pass portal k (at z = (k+1)·spacing) at passes[k]; start 0.6 spacing before the first
      const pts: [number, number][] = [[0, spacing * 0.15], ...passes.map((p, k) => [p, (k + 1) * spacing] as [number, number])];
      if (tt <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) if (tt < pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], (tt - pts[i - 1][0]) / Math.max(1e-6, pts[i][0] - pts[i - 1][0]));
      const n = pts.length, v = (pts[n - 1][1] - pts[n - 2][1]) / Math.max(1e-6, pts[n - 1][0] - pts[n - 2][0]);
      return pts[n - 1][1] + v * (tt - pts[n - 1][0]);
    };
    const sway = o.sway ?? 1;
    const camAt = (tt: number) => {
      const [roll] = keyed(E, tt, o.roll, [0], 'inOutCubic');
      return makeCam(90 * sway * Math.sin(tt * 1.1), 40 * sway * Math.sin(tt * 1.7), zAt(tt), 0.04 * sway * Math.sin(tt * 0.9), 0.02 * sway * Math.sin(tt * 1.3), roll * DEG, o.fov ?? 62);
    };
    const cam = camAt(t), camP = camAt(t - 1 / 30);
    // floor
    const floor = o.floor ?? 'grid';
    if (floor !== 'none') {
      const buckets = Array.from({ length: 8 }, () => new Path2D());
      const z0 = Math.floor((cam.z - 400) / 400) * 400;
      const fogAt = (X: number, Z: number) => Math.pow(clamp(1 - Math.hypot(X - cam.x, Z - cam.z) / 9000), 1.3);
      if (floor === 'grid') {
        for (let X = -6400; X <= 6400; X += 400) for (let Z = z0; Z < z0 + 9600; Z += 800) {
          const f = fogAt(X, Z + 400); if (f <= 0.01) continue;
          seg(buckets[Math.min(7, Math.floor(f * 8))], cam, proj(cam, X, FLOOR, Z), proj(cam, X, FLOOR, Z + 800));
        }
        for (let Z = z0; Z <= z0 + 9600; Z += 400) for (let X = -6400; X < 6400; X += 1600) {
          const f = fogAt(X + 800, Z); if (f <= 0.01) continue;
          seg(buckets[Math.min(7, Math.floor(f * 8))], cam, proj(cam, X, FLOOR, Z), proj(cam, X + 1600, FLOOR, Z));
        }
        g.strokeStyle = line; g.lineWidth = 2;
        buckets.forEach((p, i) => { g.globalAlpha = ((i + 0.5) / 8) * 0.5; g.stroke(p); });
      } else {
        for (let X = -6400; X <= 6400; X += 300) for (let Z = z0; Z < z0 + 9600; Z += 300) {
          const f = fogAt(X, Z); if (f <= 0.01) continue;
          const v = proj(cam, X, FLOOR, Z); if (v[2] < NEAR) continue;
          const s = scr(cam, v), r = clamp(1400 / v[2], 0.6, 4);
          buckets[Math.min(7, Math.floor(f * 8))].rect(s[0] - r, s[1] - r, r * 2, r * 2);
        }
        g.fillStyle = line;
        buckets.forEach((p, i) => { g.globalAlpha = ((i + 0.5) / 8) * 0.7; g.fill(p); });
      }
      g.globalAlpha = 1;
    }
    // dust streaks
    const nd = Math.round(o.dust ?? 260);
    g.strokeStyle = line; g.lineCap = 'round';
    for (let i = 0; i < nd; i++) {
      const X = rnd(i, 1) * 9000 - 4500, Y = FLOOR + rnd(i, 2) * 1800, Z = cam.z - 300 + mod(rnd(i, 3) * 12000 - cam.z, 12000);
      const a = proj(cam, X, Y, Z), b = proj(camP, X, Y, Z);
      if (a[2] < NEAR || b[2] < NEAR) continue;
      const A = scr(cam, a), B = scr(camP, b);
      if (A[0] < -50 || A[0] > W + 50 || A[1] < -50 || A[1] > H + 50) continue;
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]), cap = 140;
      if (len > cap) { B[0] = A[0] + ((B[0] - A[0]) * cap) / len; B[1] = A[1] + ((B[1] - A[1]) * cap) / len; }
      g.globalAlpha = clamp(1 - a[2] / 9000) * 0.75;
      g.lineWidth = clamp(2400 / a[2], 1, 6);
      g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0] + 0.01, B[1]); g.stroke();
    }
    g.globalAlpha = 1; g.lineCap = 'butt';
    // portals, far to near
    for (let k = portals.length - 1; k >= 0; k--) {
      const P = portals[k], z = (k + 1) * spacing, col = hex(P.color, cols[k % cols.length]);
      const cz = proj(cam, 0, 0, z)[2];
      if (cz < NEAR || cz > 11000) continue;
      const fade = clamp((11000 - cz) / 3000);
      const shape = P.shape ?? 'rect';
      let pts: Vec3[];
      if (shape === 'ring') pts = Array.from({ length: 64 }, (_, i) => [Math.cos((i / 64) * TAU) * 720, 60 + Math.sin((i / 64) * TAU) * 560, z] as Vec3);
      else if (shape === 'diamond') pts = [[0, 640, z], [820, 60, z], [0, -520, z], [-820, 60, z]];
      else pts = [[-820, FLOOR, z], [820, FLOOR, z], [820, 560, z], [-820, 560, z]];
      const path = new Path2D();
      for (let i = 0; i < pts.length; i++) seg(path, cam, proj(cam, ...pts[i]), proj(cam, ...pts[(i + 1) % pts.length]));
      g.globalAlpha = fade; g.strokeStyle = col; g.lineCap = 'square'; g.lineJoin = 'miter';
      g.lineWidth = clamp((14 * cam.f) / cz, 1.5, 90); g.stroke(path);
      const next = portals.findIndex((_, j) => (j + 1) * spacing > cam.z + 10);
      if (P.word && cz > 300 && k === next) {
        g.save();
        if (planeXform(g, cam, [0, 40, z], [1, 0, 0], [0, -1, 0])) {
          g.globalAlpha = fade * clamp((cz - 300) / 600);
          font(g, 250, 900); g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
          const w = g.measureText(P.word).width; if (w > 1400) font(g, (250 * 1400) / w, 900);
          g.fillText(P.word, 0, 0);
        }
        g.restore();
      }
    }
    g.globalAlpha = 1; g.lineCap = 'butt';
    if (o.flash ?? true) {
      passes.forEach((p, k) => {
        const f = t >= p ? Math.exp(-(t - p) * 22) : 0;
        let c = hex(portals[k].color, cols[k % cols.length]);
        if (lum(c) > 0.7) c = T.primary;
        if (f > 0.01) { g.globalAlpha = f * 0.5; g.fillStyle = c; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
      });
    }
  }

  // ── 6. cylinder ───────────────────────────────────────────────────────────
  interface CylOpts {
    text?: string | string[]; rows?: number; radius?: number; x?: number; y?: number; size?: number; gap?: number;
    weight?: number; role?: FontRole; italic?: boolean; spin?: number; alternate?: boolean; tilt?: number; yaw?: number;
    color?: string; back?: string; accent?: string; style?: 'solid' | 'outline' | 'mix'; sep?: string; enter?: number; bg?: string | null;
  }
  function cylinder(g: G, t: number, o: CylOpts = {}) {
    paintBg(g, o.bg);
    const texts = (Array.isArray(o.text) ? o.text : [o.text ?? T.text]).map(s => String(s || ' ').toUpperCase());
    const rows = Math.round(clamp(o.rows ?? texts.length * (texts.length < 3 ? 3 : 1), 1, 12));
    const size = o.size ?? 150, gap = o.gap ?? size * 1.02, Rr = o.radius ?? 600;
    const cam = frontCam();
    const C = world(o.x ?? W / 2, o.y ?? H / 2);
    const tilt = rotor(o.yaw ?? 0, o.tilt ?? -14, 0);
    const col = hex(o.color, T.text), back = hex(o.back, mixHex(col, hex(o.bg, T.bg), 0.78)), acc = hex(o.accent, T.primary);
    const sep = o.sep ?? '  •  ';
    const spin = (o.spin ?? 28) * DEG, enter = o.enter ?? 0.9;
    const camPos: Vec3 = [cam.x, cam.y, cam.z];
    const glyphs: { k: number; face: number; O: Vec3; UX: Vec3; UY: Vec3; ch: string; c: string; outline: boolean; dep: number }[] = [];
    for (let r = 0; r < rows; r++) {
      const text = texts[r % texts.length];
      font(g, size, o.weight ?? 900, o.role ?? 'display', o.italic);
      const unitStr = text + sep;
      const chars = [...unitStr];
      const ws = chars.map(ch => g.measureText(ch).width);
      const wu = ws.reduce((a, b) => a + b, 0) || 1;
      const reps = Math.max(1, Math.round((TAU * Rr) / wu));
      const kx = (TAU * Rr) / (reps * wu);
      const dir = (o.alternate ?? true) && r % 2 ? -1 : 1;
      const st = r * 0.07;
      const whip = Math.PI * 1.2 * (1 - E.outExpo(prog(t, st, st + enter)));
      const th0 = dir * (spin * t + whip) + r * 0.7;
      const yr = ((rows - 1) / 2 - r) * gap;
      const vis = E.outExpo(prog(t, st, st + enter * 0.5));
      const style = o.style ?? 'mix';
      const outline = style === 'outline' || (style === 'mix' && r % 2 === 1);
      let a = 0;
      for (let rep = 0; rep < reps; rep++) chars.forEach((ch, i) => {
        const w = ws[i] * kx, th = th0 + (a + w / 2) / Rr;
        a += w;
        if (ch === ' ') return;
        const s = Math.sin(th), c = Math.cos(th);
        const Pl: Vec3 = tilt([Rr * s, yr, -Rr * c]);
        const Tl = tilt([c, 0, s]), Ul = tilt([0, 1, 0]), Nl = tilt([s, 0, -c]);
        const P = add(C, Pl);
        const toCam: Vec3 = [camPos[0] - P[0], camPos[1] - P[1], camPos[2] - P[2]];
        const face = (Nl[0] * toCam[0] + Nl[1] * toCam[1] + Nl[2] * toCam[2]) / (Math.hypot(...toCam) || 1);
        const O = add(P, add(scale3(Tl, (-w / 2) / kx), scale3(Ul, 0)));
        glyphs.push({ k: vis, face, O, UX: scale3(Tl, 1), UY: scale3(Ul, -1), ch, c: ch === '•' ? acc : col, outline, dep: proj(cam, ...P)[2] });
      });
    }
    glyphs.sort((a, b) => b.dep - a.dep);
    g.save();
    font(g, size, o.weight ?? 900, o.role ?? 'display', o.italic);
    g.textBaseline = 'middle'; g.textAlign = 'left';
    for (const q of glyphs) {
      if (q.k <= 0) continue;
      g.save();
      if (planeXform(g, cam, q.O, q.UX, q.UY)) {
        const front = q.face > 0;
        g.globalAlpha = q.k * (front ? 0.35 + 0.65 * clamp(q.face * 1.3) : 0.9);
        if (front) {
          if (q.outline) { g.strokeStyle = q.c; g.lineWidth = Math.max(2, size * 0.02); g.strokeText(q.ch, 0, 0); }
          else { g.fillStyle = q.c; g.fillText(q.ch, 0, 0); }
        } else { g.fillStyle = back; g.fillText(q.ch, 0, 0); }
      }
      g.restore();
    }
    g.restore();
  }

  // ── 7. light: rays and flare ──────────────────────────────────────────────
  interface RaysOpts extends Mark {
    x?: number; y?: number; color?: string; ray?: string; intensity?: number; length?: number;
    origin?: [number, number]; burst?: number[]; solid?: boolean; bg?: string | null;
  }
  function rays(g: G, t: number, o: RaysOpts = {}) {
    paintBg(g, o.bg);
    const x = o.x ?? W / 2, y = o.y ?? H / 2, rayC = hex(o.ray, T.primary), col = hex(o.color, T.text);
    const hw = W / 2, hh = H / 2;
    const A = X.layerOf('__rays-a', hw, hh), B = X.layerOf('__rays-b', hw, hh);
    // the source, in the ray colour, at half resolution, broken by slow angular noise
    A.g.save(); A.g.scale(0.5, 0.5); A.g.translate(x, y); A.g.fillStyle = rayC;
    const m = markMetrics(A.g, o); m.paint(A.g); A.g.restore();
    const org = o.origin ?? [x + 140 * Math.sin(t * 0.9), y - 60 + 40 * Math.cos(t * 0.7)];
    const ox = org[0] / 2, oy = org[1] / 2;
    A.g.save(); A.g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 14; k++) {
      const a0 = rnd(k, 51) * TAU + t * 0.25 * (rnd(k, 52) - 0.5), w = 0.03 + rnd(k, 53) * 0.08;
      A.g.fillStyle = `rgba(0,0,0,${(0.35 + 0.5 * rnd(k, 54)).toFixed(2)})`;
      A.g.beginPath(); A.g.moveTo(ox, oy); A.g.arc(ox, oy, W, a0 - w, a0 + w); A.g.closePath(); A.g.fill();
    }
    A.g.restore();
    let I = o.intensity ?? 1;
    for (const b of o.burst ?? []) if (t >= b) I += 1.6 * Math.exp(-(t - b) * 4);
    const len = o.length ?? 0.5;
    // two-pass zoom blur: 12 + 12 taps ≈ 144 effective samples
    const zoom = (src: HTMLCanvasElement, dst: G, reach: number) => {
      dst.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 12; k++) {
        const s = 1 + (reach * k) / 12;
        dst.globalAlpha = (1 - k / 12) * 0.2;
        dst.setTransform(s, 0, 0, s, ox - ox * s, oy - oy * s);
        dst.drawImage(src, 0, 0);
      }
      dst.setTransform(1, 0, 0, 1, 0, 0); dst.globalAlpha = 1; dst.globalCompositeOperation = 'source-over';
    };
    zoom(A.canvas, B.g, len * 0.25);
    A.g.clearRect(0, 0, hw, hh);
    zoom(B.canvas, A.g, len);
    g.save();
    g.globalCompositeOperation = isDark(o.bg) ? 'lighter' : 'multiply';
    g.globalAlpha = clamp(I * 0.85, 0, 2);
    g.filter = 'blur(3px)';
    g.drawImage(A.canvas, 0, 0, W, H);
    g.restore();
    if (o.solid ?? true) { g.save(); g.translate(x, y); g.fillStyle = col; markMetrics(g, o).paint(g); g.restore(); }
  }
  interface FlareOpts { t?: number; color?: string; size?: number; streak?: boolean; ghosts?: boolean; intensity?: number }
  function flare(g: G, x: number, y: number, o: FlareOpts = {}) {
    const c = hex(o.color, T.primary), s = o.size ?? 1, I = clamp(o.intensity ?? 1, 0, 3);
    if (I <= 0) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const core = g.createRadialGradient(x, y, 0, x, y, 220 * s);
    core.addColorStop(0, rgba('#FFFFFF', 0.9 * I)); core.addColorStop(0.08, rgba(c, 0.7 * I)); core.addColorStop(1, rgba(c, 0));
    g.fillStyle = core; g.fillRect(x - 220 * s, y - 220 * s, 440 * s, 440 * s);
    if (o.streak ?? true) {
      g.save(); g.translate(x, y); g.scale(1, 0.018);
      const st = g.createRadialGradient(0, 0, 0, 0, 0, 900 * s);
      st.addColorStop(0, rgba('#FFFFFF', 0.95 * I)); st.addColorStop(0.2, rgba(c, 0.55 * I)); st.addColorStop(1, rgba(c, 0));
      g.fillStyle = st; g.fillRect(-900 * s, -900 * s, 1800 * s, 1800 * s); g.restore();
    }
    if (o.ghosts ?? true) {
      const dx = W / 2 - x, dy = H / 2 - y;
      [[0.5, 60, 0.12], [0.9, 26, 0.2], [1.3, 110, 0.08], [1.7, 40, 0.14]].forEach(([k, r, a]) => {
        const gx = x + dx * k, gy = y + dy * k, gr = g.createRadialGradient(gx, gy, r * s * 0.6, gx, gy, r * s);
        gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.85, rgba(c, a * I)); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(gx, gy, r * s, 0, TAU); g.fill();
      });
    }
    g.restore();
  }

  // ── 8. planes: cards and screens in 3D ────────────────────────────────────
  interface Card { x?: number; y?: number; z?: number; yaw?: number; pitch?: number; roll?: number; w?: number; h?: number; at?: number; color?: string; draw?: (g: G, t: number, card: { w: number; h: number }) => void }
  interface PlanesOpts { cards?: Card[]; cam?: number[][]; ease?: string; fov?: number; panel?: boolean; radius?: number; bg?: string | null }
  function planes(g: G, t: number, o: PlanesOpts = {}) {
    paintBg(g, o.bg);
    const [yaw, pitch, dist, tx, ty] = keyed(E, t, o.cam, [0, 0, 2200, 0, 0], o.ease ?? 'outExpo');
    const cam = orbitCam(yaw, pitch, Math.max(200, dist), o.fov ?? 30);
    cam.x += tx; cam.y += ty;
    const items = (o.cards ?? []).map((c, i) => {
      const w = c.w ?? 1280, h = c.h ?? 760, at = c.at ?? 0;
      const p = E.outExpo(prog(t, at, at + 0.5));
      const R = rotor(c.yaw ?? 0, c.pitch ?? 0, c.roll ?? 0);
      const C: Vec3 = [c.x ?? 0, c.y ?? 0, (c.z ?? 0) + (1 - p) * 900];
      const O = add(C, R([-w / 2, h / 2, 0]));
      return { c, i, w, h, p, at, R, O, dep: proj(cam, ...C)[2] };
    }).filter(q => q.p > 0).sort((a, b) => b.dep - a.dep);
    const surf = T.surface ?? mixHex(T.bg, '#FFFFFF', 0.06);
    for (const q of items) {
      g.save();
      if (planeXform(g, cam, q.O, q.R([1, 0, 0]), q.R([0, -1, 0]))) {
        g.globalAlpha = clamp(q.p * 1.4);
        const r = o.radius ?? 28;
        if (o.panel ?? true) {
          g.beginPath(); g.roundRect(0, 0, q.w, q.h, r);
          g.fillStyle = hex(q.c.color, surf); g.fill();
          g.strokeStyle = rgba(T.text, 0.14); g.lineWidth = 2; g.stroke();
          g.clip();
          const sh = g.createLinearGradient(0, 0, q.w, q.h);
          sh.addColorStop(0, rgba('#FFFFFF', 0.07)); sh.addColorStop(0.5, rgba('#FFFFFF', 0)); g.fillStyle = sh; g.fillRect(0, 0, q.w, q.h);
        }
        if (typeof q.c.draw === 'function') q.c.draw(g, t - q.at, { w: q.w, h: q.h });
      }
      g.restore();
    }
  }

  return { swarm, extrude, shatter, globe, flight, cylinder, rays, flare, planes };
}

export const SETPIECE_DOCS = `## Set pieces: S.set.* (crafted 3D moments; build every film around them)
Hand-built, film-grade signature shots. Each draws a full frame (background first) at local time t (seconds since the set piece starts; pass t - S.b(n) to start it later). Every option is optional and every value can be animated per frame (S.kf). bg: a colour, or null to draw over what is already there (compose: your own background, then a set piece with bg: null, then your type on top). Colours default to the brand palette. Times inside options are seconds in the same local t: use S.b(n).
- S.set.swarm(g, t, { shapes: [[time, shape], …], count = 1600, x, y, size = 520, colors = [primary, accent, text], spin = 24 (°/s), tilt = 18 (°), morph = 0.55 s, stagger = 0.14 s, swirl = 1, dot = 2.6, glow = 1, links = true, trails = true, burst: [times], bg }) → thousands of glowing 3D particles that fly between shapes on the beat with depth, motion trails and bloom. Shapes: 'scatter', 'burst', 'sphere', 'ring', 'torus', 'helix', 'cube', 'plane', 'wave', 'vortex', 'logo' (the brand mark), 'text:WORD' (any short word, rendered in particles), 'icon:NAME' (S.icons). 3D shapes rotate; flat ones (logo, text, icon, ring) turn to face the camera. burst: particles blast outward and resettle (put it on a kick).
- S.set.extrude(g, t, { text | logo: true, x, y, size = 320, weight = 900, role, italic, tracking, depth = 0.42 × size, layers = 30, pose: [[time, yaw°, pitch°, roll°, zoom], …] (default swings in from [-55, 28, -8, 0.55] to a three-quarter rest [-22, 13, -2, 1] by 0.7 s, then drifts; key it front-on [t, 0, 0, 0, 1] only for a final lock-up), ease = 'outExpo', build = 0.5 s (extrusion grows), face, side, rim, shine: [times] (a specular light band sweeps the face), float = 1, glow = 1, bg }) → solid 3D extruded type or logo with lit sides, perspective, a camera-like swing and a specular sweep. The hero logo reveal.
- S.set.shatter(g, t, { text | logo: true, x, y, size, weight, role, color, edge, inAt = 0, dur = 0.55, outAt, outDur = 0.5, pieces = 70, spread = 1, flash = true, bg }) → the word or logo assembles from glass-like shards flying in from 3D space (lands at inAt + dur with a flash), and explodes into shards at outAt.
- S.set.globe(g, t, { x, y, r = 420, view: [[time, lon, lat, x?, y?, r?], …], spin = 6 (°/s), arcs: [{ from: [lat, lon], to: [lat, lon], at, label }], pins: [{ at: [lat, lon], t, label }], color, accent, reveal, atmosphere = 1, beat (0..1 pulse), bg }) → a dotted world globe with atmosphere, graticule, flying arcs with glowing heads, landing ripples, pins and labels. Use real coordinates.
- S.set.flight(g, t, { passes: [times], portals: [{ word, color, shape: 'rect' | 'ring' | 'diamond' }, …], spacing = 1500, floor = 'grid' | 'dots' | 'none', dust = 260, fov = 62, roll: [[time, degrees], …], sway = 1, line, colors, flash = true, bg }) → the camera flies forward over an infinite floor through a series of giant portal frames (one per pass time; words written on them), with speed-streak dust and a colour flash as it crosses each one. Put passes on the beats.
- S.set.cylinder(g, t, { text: 'WORD' | ['A', 'B', …], rows, radius = 600, x, y, size = 150, gap, weight, role, spin = 28 (°/s), alternate = true (rows counter-rotate), tilt = -14 (°), yaw, color, back, accent, style = 'mix' | 'solid' | 'outline', sep = '  •  ', enter = 0.9 s (rows whip in), bg }) → rows of huge type wrapped around a rotating 3D cylinder, back side seen through in a dim tint. The kinetic-typography showpiece.
- S.set.rays(g, t, { text | logo: true, x, y, size, weight, role, color, ray, intensity = 1, length = 0.5, origin: [x, y] (light source, default drifting behind the mark), burst: [times], solid = true, bg }) → volumetric god rays streaming out of the word or logo (light behind the letters), which sits solid on top. burst: a surge of light (put it on a hit).
- S.set.flare(g, x, y, { color, size = 1, streak = true, ghosts = true, intensity = 1 }) → an anamorphic lens flare (hot core, horizontal streak, ghosts). Draws over the frame; animate x, y and intensity.
- S.set.planes(g, t, { cards: [{ x, y, z, yaw°, pitch°, roll°, w = 1280, h = 760, at, color, draw(g, t, { w, h }) }], cam: [[time, yaw°, pitch°, dist = 2200, targetX, targetY], …], ease = 'outExpo', fov = 30, panel = true, radius = 28, bg }) → cards or screens floating in 3D space, drawn by your draw() in their own 0..w × 0..h coordinates (UI, type, images, stats), depth-sorted, flying in at their at time; the camera cuts or glides between the keyed poses (outExpo = a punchy move per key).
`;
