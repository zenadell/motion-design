// Professional building blocks for model-written scenes: the things a motion
// designer reaches for in After Effects, as deterministic functions of time.
// Exposed on the Stage as S.kf, S.type, S.cam, S.fx … (documented in TOOLKIT_DOCS).

import { ICONS, resample, type Poly } from '../assets/icons';
import { logoOutline, type LogoRT } from '../assets/logo';
import { rgba } from '../core/color';
import { makeCam, planeXform, proj, scr, NEAR, orbitCam, type Cam } from '../core/camera';
import { H, W, type G } from '../core/draw';
import { clamp, lerp, rnd, type Vec2 } from '../core/math';
import { font } from '../core/theme';
import { getTechnique } from '../techniques';
import type { Ctx } from '../techniques/types';

type EaseFn = (t: number) => number;
type Eases = Record<string, EaseFn>;
type Val = number | number[];

/** Keyframes: keys = [[time, value, easeName?], …] sorted by time; values are numbers or equal-length arrays. */
export function kf(eases: Eases, t: number, keys: [number, Val, string?][]): Val {
  if (!keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i], [t0, v0] = keys[i - 1];
    if (t <= t1) {
      const p = (eases[e ?? 'inOutCubic'] ?? eases.inOutCubic)(clamp((t - t0) / Math.max(1e-6, t1 - t0)));
      return Array.isArray(v0) ? v0.map((a, k) => lerp(a, (v1 as number[])[k] ?? a, p)) : lerp(v0, v1 as number, p);
    }
  }
  return keys[keys.length - 1][1];
}

/** Damped spring from 0 to 1 (overshoots when bouncy). stiffness ~ 100–400, damping ~ 8–30. */
export function spring(t: number, stiffness = 180, damping = 14, mass = 1): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

export interface TypeOpts {
  t: number;
  size: number;
  weight?: number;
  role?: 'display' | 'mono' | 'serif';
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  tracking?: number;
  color?: string;
  outline?: number;
  per?: 'char' | 'word';
  delay?: number;
  stagger?: number;
  dur?: number;
  ease?: string;
  order?: 'forward' | 'reverse' | 'center' | 'random';
  from?: { x?: number; y?: number; alpha?: number; scale?: number; rot?: number; blur?: number };
  mask?: boolean;
  exit?: { at: number; dur?: number; stagger?: number; ease?: string; to?: { x?: number; y?: number; alpha?: number; scale?: number; rot?: number; blur?: number } };
}

/**
 * An After Effects-style text animator: lays out `text` at (x, baseline y)
 * and animates each character or word in from an offset state with stagger.
 * Offsets x/y are in em. Returns the laid-out width and glyph boxes.
 */
export function typeAnim(eases: Eases, g: G, text: string, x: number, y: number, o: TypeOpts) {
  const role = o.role ?? 'display';
  font(g, o.size, o.weight ?? 800, role, o.italic);
  const track = (o.tracking ?? 0) * o.size;
  const units: { s: string; x: number; w: number }[] = [];
  const parts = o.per === 'word' ? text.split(/(\s+)/) : [...text];
  let cx = 0;
  for (const s of parts) {
    const w = g.measureText(s).width;
    if (!/^\s+$/.test(s)) units.push({ s, x: cx, w });
    cx += w + (o.per === 'word' ? 0 : track);
  }
  const width = Math.max(0, cx - (o.per === 'word' ? 0 : track));
  const x0 = o.align === 'center' ? x - width / 2 : o.align === 'right' ? x - width : x;
  const n = units.length, stg = o.stagger ?? 0.035, dur = o.dur ?? 0.55, ease = eases[o.ease ?? 'outExpo'] ?? eases.outExpo;
  const orderOf = (i: number) => (o.order === 'reverse' ? n - 1 - i : o.order === 'center' ? Math.abs(i - (n - 1) / 2) : o.order === 'random' ? Math.floor(rnd(i, 97) * n) : i);
  const F = { x: 0, y: 0.7, alpha: 0, scale: 1, rot: 0, blur: 0, ...(o.from ?? {}) };
  const X = o.exit ? { x: 0, y: -0.7, alpha: 0, scale: 1, rot: 0, blur: 0, ...(o.exit.to ?? {}) } : null;
  const asc = o.size * 0.95, desc = o.size * 0.3;
  units.forEach((u, i) => {
    const k = orderOf(i);
    const p = ease(clamp((o.t - (o.delay ?? 0) - k * stg) / dur));
    let q = 0;
    if (o.exit && X) q = (eases[o.exit.ease ?? 'inExpo'] ?? eases.inExpo)(clamp((o.t - o.exit.at - k * (o.exit.stagger ?? stg)) / (o.exit.dur ?? dur)));
    const mix = (a: number, b: number, c: number) => lerp(lerp(a, b, p), c, q);
    const dx = mix(F.x, 0, X?.x ?? 0) * o.size, dy = mix(F.y, 0, X?.y ?? 0) * o.size;
    const al = mix(F.alpha, 1, X?.alpha ?? 1), sc = mix(F.scale, 1, X?.scale ?? 1), rot = mix(F.rot, 0, X?.rot ?? 0), bl = mix(F.blur, 0, X?.blur ?? 0);
    if (al <= 0.001) return;
    g.save();
    if (o.mask !== false && (F.y !== 0 || (X?.y ?? 0) !== 0)) {
      g.beginPath();
      g.rect(x0 + u.x - o.size, y - asc, u.w + 2 * o.size, asc + desc);
      g.clip();
    }
    g.translate(x0 + u.x + u.w / 2 + dx, y + dy);
    if (rot) g.rotate(rot);
    if (sc !== 1) g.scale(sc, sc);
    g.globalAlpha *= clamp(al);
    if (bl > 0.3) g.filter = `blur(${bl.toFixed(1)}px)`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    if (o.outline) {
      g.lineWidth = o.outline;
      g.strokeStyle = o.color ?? '#fff';
      g.strokeText(u.s, 0, 0);
    } else {
      g.fillStyle = o.color ?? '#fff';
      g.fillText(u.s, 0, 0);
    }
    g.restore();
  });
  return { width, left: x0, glyphs: units.map(u => ({ text: u.s, x: x0 + u.x, w: u.w })) };
}

/** A pinhole camera. Angles in degrees. project() returns screen x, y, a scale factor and depth. */
export function camera(o: { x?: number; y?: number; z?: number; yaw?: number; pitch?: number; roll?: number; fov?: number; orbit?: { yaw: number; pitch: number; dist: number } }) {
  const D = Math.PI / 180;
  const cam: Cam = o.orbit ? orbitCam(o.orbit.yaw, o.orbit.pitch, o.orbit.dist, o.fov ?? 35) : makeCam(o.x ?? 0, o.y ?? 0, o.z ?? -1600, (o.yaw ?? 0) * D, (o.pitch ?? 0) * D, (o.roll ?? 0) * D, o.fov ?? 35);
  const project = (X: number, Y: number, Z: number) => {
    const v = proj(cam, X, Y, Z);
    if (v[2] < NEAR) return { x: 0, y: 0, s: 0, depth: v[2], visible: false };
    const [sx, sy] = scr(cam, v);
    return { x: sx, y: sy, s: cam.f / v[2], depth: v[2], visible: true };
  };
  return {
    project,
    /** Stroke a 3D polyline (world units; +y is up). */
    line(g: G, pts: [number, number, number][]) {
      g.beginPath();
      let pen = false;
      for (const p of pts) {
        const q = project(p[0], p[1], p[2]);
        if (!q.visible) { pen = false; continue; }
        if (pen) g.lineTo(q.x, q.y);
        else { g.moveTo(q.x, q.y); pen = true; }
      }
      g.stroke();
    },
    /** Transform g so 2D drawing lands on a 3D card: origin O, unit axes ux, uy (world vectors per 2D pixel). Returns false if behind the camera. */
    card(g: G, O: [number, number, number], ux: [number, number, number], uy: [number, number, number]) {
      return planeXform(g, cam, O, ux, uy);
    },
  };
}

export function glowAt(g: G, x: number, y: number, r: number, col: string, a = 1): void {
  if (a <= 0 || r <= 0) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(col, a));
  gr.addColorStop(0.35, rgba(col, a * 0.4));
  gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
}

/** Additive bloom of a layer onto g (blurred copy composited with 'lighter'). */
export function bloom(g: G, src: CanvasImageSource, radius = 24, strength = 0.8): void {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = clamp(strength, 0, 2);
  g.filter = `blur(${Math.max(1, radius).toFixed(0)}px)`;
  g.drawImage(src, 0, 0, W, H);
  g.restore();
}

/** Stroke the first fraction p (0..1) of a polyline. */
export function drawOn(g: G, pts: Vec2[], p: number, closed = false): void {
  const P = closed && pts.length ? [...pts, pts[0]] : pts;
  if (P.length < 2 || p <= 0) return;
  const lens = [0];
  for (let i = 1; i < P.length; i++) lens.push(lens[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = lens[lens.length - 1] * clamp(p);
  g.beginPath();
  g.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) {
    if (lens[i] <= L) g.lineTo(P[i][0], P[i][1]);
    else {
      const k = (L - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]);
      g.lineTo(lerp(P[i - 1][0], P[i][0], k), lerp(P[i - 1][1], P[i][1], k));
      break;
    }
  }
  g.stroke();
}

const norm = (polys: Poly[]): Poly[] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const s = 1 / Math.max(1e-6, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return polys.map(p => p.map(([x, y]) => [(x - cx) * s, (y - cy) * s] as Vec2));
};

const shapeCache = new Map<string, Vec2[]>();
/** n points evenly spread along an icon's outline, centred, height 1. */
export function iconPoints(name: string, n: number): Vec2[] {
  const k = `${name}:${n}`;
  let v = shapeCache.get(k);
  if (!v) {
    const f = ICONS[name];
    v = f ? [...resample(norm(f()), n)] : [];
    shapeCache.set(k, v);
  }
  return v;
}
/** Icon outlines as polylines (centred, height 1), for drawOn or custom strokes. */
export const iconPolys = (name: string): Vec2[][] => (ICONS[name] ? norm(ICONS[name]()) : []);
export const ICON_LIST = Object.keys(ICONS);

export function logoPoints(L: LogoRT, n: number): Vec2[] {
  return [...resample(logoOutline(L), n)];
}

/** Point-wise blend of two point lists (lengths are matched by wrapping). */
export function morph(a: Vec2[], b: Vec2[], p: number): Vec2[] {
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => {
    const u = a[i % a.length] ?? [0, 0], v = b[i % b.length] ?? [0, 0];
    return [lerp(u[0], v[0], p), lerp(u[1], v[1], p)] as Vec2;
  });
}

export function linear(g: G, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [p, c] of stops) gr.addColorStop(clamp(p), c);
  return gr;
}
export function radial(g: G, x: number, y: number, r: number, stops: [number, string][], r0 = 0): CanvasGradient {
  const gr = g.createRadialGradient(x, y, r0, x, y, r);
  for (const [p, c] of stops) gr.addColorStop(clamp(p), c);
  return gr;
}

/** Library techniques as components: draw technique `id` at its local time t with params. */
export function fxFactory(c: Ctx) {
  const parsed = new Map<string, unknown>();
  return (id: string, g: G, t: number, params: Record<string, unknown> = {}, beats?: number) => {
    const tech = getTechnique(id);
    if (!tech || id.startsWith('scene:')) throw new Error(`S.fx: unknown technique "${id}"`);
    const key = `${id}:${JSON.stringify(params)}`;
    let p = parsed.get(key);
    if (p === undefined) {
      const r = tech.params.safeParse(params);
      if (!r.success) throw new Error(`S.fx("${id}") params: ${r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      p = r.data;
      parsed.set(key, p);
    }
    const b = beats ?? tech.beats.default;
    const ctx: Ctx = { ...c, dur: b * c.B, beats: b, captions: false, prev: undefined, next: undefined };
    g.save();
    tech.draw(g, t, p as never, ctx);
    g.restore();
  };
}

export const TOOLKIT_DOCS = `## Pro toolkit (also on S)
- S.kf(t, [[time, value, ease?], …]) → keyframed number or array (ease names from S.ease; default inOutCubic). Example: S.kf(t, [[0, -300], [S.b(1), 0, 'outExpo'], [S.b(3), 0], [S.b(3.5), 800, 'inExpo']])
- S.spring(t, stiffness = 180, damping = 14) → 0→1 with physical overshoot (t in seconds since the move started)
- S.type(g, text, x, y, opts) → an After Effects text animator. Draws text at baseline y and animates each char (or word) in, with stagger. opts: { t (seconds since the text starts), size, weight = 800, role, italic, align = 'left'|'center'|'right', tracking (em), color, outline (stroke width instead of fill), per = 'char'|'word', delay, stagger = 0.035 s, dur = 0.55 s, ease = 'outExpo', order = 'forward'|'reverse'|'center'|'random', from: { x, y (em, default 0.7), alpha = 0, scale = 1, rot (radians), blur (px) }, mask = true (clip each unit to its line so it rises out of a baseline), exit: { at (seconds), dur, stagger, ease, to: { … } } }. Returns { width, left, glyphs: [{ text, x, w }] }.
- S.cam({ x, y, z = -1600, yaw, pitch, roll, fov = 35 }) or S.cam({ orbit: { yaw, pitch, dist }, fov }) → { project(x, y, z) → { x, y, s (scale), depth, visible }, line(g, [[x, y, z], …]) strokes a 3D polyline, card(g, origin, ux, uy) transforms g so 2D drawing lands on a 3D plane (wrap in save/restore) }. World units ≈ pixels at depth 1600 with fov 35; +y is up.
- S.glow(g, x, y, radius, color, alpha = 1) → soft radial light (cheap)
- S.bloom(g, canvas, radius = 24, strength = 0.8) → additive blurred glow of an offscreen layer onto g (moderately expensive; one or two per frame)
- S.drawOn(g, points, p, closed = false) → strokes the first fraction p of a polyline (line-drawing reveals)
- S.icons (list of icon names), S.iconPoints(name, n) → n points along an icon outline (centred, height 1); S.iconPolys(name) → its polylines; S.logoPoints(n) → n points along the brand mark's outline (centred, height 1). Scale and translate them yourself.
- S.morph(pointsA, pointsB, p) → blended point list (shape morphs, particles flowing between shapes)
- S.linear(g, x0, y0, x1, y1, [[stop, color], …]) and S.radial(g, x, y, r, [[stop, color], …]) → gradients
- S.fx(id, g, t, params, beats?) → draws one of the engine's finished techniques (below) as a full-frame component at its local time t. Use it inside S.layer() and composite it (masks, transforms, blend modes), or as a background plate. Technique ids and params are in the TECHNIQUES list.
`;
