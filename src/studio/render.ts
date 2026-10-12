import { z } from 'zod';
import { drawLogo, drawTile } from '../engine/assets/logo';
import type { Audio } from '../engine/audio/synth';
import * as SY from '../engine/audio/synth';
import { compile, baseStage, layerOf, seededMath, type StageBase } from '../engine/custom/stage';
import { fxFactory } from '../engine/custom/toolkit';
import { H, W, resetCtx, rr, type G } from '../engine/core/draw';
import { mod, rnd } from '../engine/core/math';
import { font as roleFont, type FontRole, type Theme } from '../engine/core/theme';
import type { Ctx, Technique } from '../engine/techniques/types';
import { IDENT, applyEase, cssColor, depthScale, layerMatrix, mul, parseColor, rotateM, scaleM, translate, valueAt, type Mat, type RGBA } from './anim';
import type { Comp, Gradient, GroupLayer, Layer, Prop, Studio, TextLayer, UnitState } from './schema';

// Draws studio comps. Runs in the page (bundled into dist/engine.js).

const images = new Map<string, HTMLImageElement>();
const ROLE_SET = new Set(['bg', 'surface', 'text', 'muted', 'primary', 'secondary', 'accent', 'dark', 'light']);
const FONT_ROLES = new Set(['display', 'serif', 'mono']);

export const srcOf = (src: string, studio: Studio): string => (src.startsWith('asset:') ? studio.assets[src.slice(6)] ?? '' : src);

export function* eachLayer(layers: Layer[]): Generator<Layer> {
  for (const l of layers) {
    yield l;
    if (l.type === 'group') yield* eachLayer(l.layers);
  }
}

/** Decode every image and load every font the comps use, before the first frame. */
export async function preloadStudio(studio: Studio | undefined): Promise<void> {
  if (!studio) return;
  const srcs = new Set<string>(), fonts = new Set<string>();
  for (const c of studio.comps)
    for (const l of eachLayer(c.layers)) {
      if (l.type === 'image') srcs.add(srcOf(l.src, studio));
      if (l.type === 'text' && l.font && !FONT_ROLES.has(l.font)) fonts.add(`${l.italic ? 'italic ' : ''}${l.weight ?? 800} 100px "${l.font}"`);
    }
  await Promise.all([
    ...[...srcs].filter(Boolean).map(async s => {
      const im = new Image();
      im.src = s;
      try {
        await im.decode();
        images.set(s, im);
      } catch (e) {
        console.error(`[motion] studio image failed to decode (${s.slice(0, 40)}…):`, e);
      }
    }),
    ...[...fonts].map(f => document.fonts.load(f).catch(() => undefined)),
  ]);
}

// ── per-frame environment ─────────────────────────────────────────────────────

interface Env {
  t: number;
  sec: number;
  c: Ctx;
  studio: Studio;
  color: (s: string) => RGBA;
  depth: number;
}

function resolver(T: Theme): (s: string) => RGBA {
  const cache = new Map<string, RGBA>();
  return (s: string) => {
    let v = cache.get(s);
    if (!v) {
      const hex = ROLE_SET.has(s) ? (T as unknown as Record<string, string>)[s] : s;
      v = /^#[0-9a-fA-F]{6}/.test(hex) ? parseColor(hex) : [255, 0, 255, 1];
      cache.set(s, v);
    }
    return v;
  };
}

const num = (p: Prop<number> | undefined, e: Env, d: number): number => valueAt(p, e.t, d, e.sec, e.color);
const vec = (p: Prop<[number, number]> | undefined, e: Env, d: [number, number]): [number, number] => valueAt(p as Prop<number[]>, e.t, d, e.sec, e.color) as [number, number];
const col = (p: Prop<string> | undefined, e: Env, d: string): RGBA => e.color(valueAt(p, e.t, d, e.sec, e.color));

function paint(g: G, f: Prop<string> | Gradient | undefined, e: Env, d: string): string | CanvasGradient {
  if (f && typeof f === 'object' && !Array.isArray(f)) {
    const gr = f as Gradient;
    const cg = gr.type === 'linear'
      ? g.createLinearGradient(gr.from[0], gr.from[1], gr.to[0], gr.to[1])
      : g.createRadialGradient(gr.from[0], gr.from[1], 0, gr.from[0], gr.from[1], Math.hypot(gr.to[0] - gr.from[0], gr.to[1] - gr.from[1]));
    for (const [o, c] of gr.stops) cg.addColorStop(o, cssColor(e.color(c)));
    return cg;
  }
  return cssColor(col(f as Prop<string> | undefined, e, d));
}

const setMat = (g: G, m: Mat) => g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

function cameraMat(comp: Comp, e: Env, z: number): Mat {
  const cam = comp.camera;
  if (!cam) return z ? mul(translate(W / 2, H / 2), mul(scaleM(depthScale(z, 0), depthScale(z, 0)), translate(-W / 2, -H / 2))) : IDENT;
  const pos = vec(cam.position, e, [W / 2, H / 2]), zoom = num(cam.zoom, e, 1), rot = num(cam.rotation, e, 0), cz = num(cam.z, e, 0);
  const s = zoom * depthScale(z, cz);
  let m = translate(W / 2, H / 2);
  if (rot) m = mul(m, rotateM(-rot));
  return mul(mul(m, scaleM(s, s)), translate(-pos[0], -pos[1]));
}

// ── drawing a comp ────────────────────────────────────────────────────────────

export function drawComp(g: G, comp: Comp, lt: number, c: Ctx, studio: Studio): void {
  const sec = comp.units === 'beats' ? c.B : 1;
  const e: Env = { t: lt / sec, sec, c, studio, color: resolver(c.theme), depth: 0 };
  const b = g.getTransform();
  const base: Mat = [b.a, b.b, b.c, b.d, b.e, b.f];
  g.save();
  g.fillStyle = cssColor(col(comp.background, e, 'bg'));
  g.fillRect(-200, -200, W + 400, H + 400);
  drawList(g, comp.layers, e, (L, zRoot) => mul(base, L.fixed ? IDENT : cameraMat(comp, e, zRoot)), 1, comp);
  g.restore();
}

/** Paths and lines are drawn in frame coordinates; groups and code layers draw in frame coordinates around a centred pivot. */
function localMat(L: Layer, e: Env): Mat {
  const frame = L.type === 'line' || L.type === 'path';
  const pivot = L.type === 'group' || L.type === 'code';
  return layerMatrix(
    vec(L.position, e, frame ? [0, 0] : [W / 2, H / 2]),
    vec(L.anchor, e, pivot ? [W / 2, H / 2] : [0, 0]),
    valueAt(L.scale as Prop<number | number[]> | undefined, e.t, 1, e.sec),
    num(L.rotation, e, 0),
    num(L.skew, e, 0),
  );
}

function drawList(g: G, layers: Layer[], e: Env, outer: (L: Layer, zRoot: number) => Mat, alpha: number, comp: Comp): void {
  const byId = new Map(layers.map(l => [l.id, l]));
  const world = new Map<string, Mat>();
  const worldOf = (L: Layer, hops = 0): Mat => {
    let m = world.get(L.id);
    if (m) return m;
    const p = L.parent ? byId.get(L.parent) : undefined;
    m = p && hops < 32 ? mul(worldOf(p, hops + 1), localMat(L, e)) : localMat(L, e);
    world.set(L.id, m);
    return m;
  };
  const rootOf = (L: Layer): Layer => {
    let r = L;
    for (let i = 0; i < 32 && r.parent && byId.has(r.parent); i++) r = byId.get(r.parent)!;
    return r;
  };
  const mattes = new Set(layers.flatMap(l => (l.matte ? [l.matte.layer] : [])));
  const full = (L: Layer) => mul(outer(L, num(rootOf(L).z, e, 0)), worldOf(L));
  for (const L of layers) {
    if (mattes.has(L.id) || !visible(L, e)) continue;
    const a = alpha * Math.max(0, Math.min(1, num(L.opacity, e, 1)));
    if (a <= 0.001) continue;
    if (L.matte) {
      const src = byId.get(L.matte.layer);
      const A = layerOf(`studio-a${e.depth}`), B = layerOf(`studio-b${e.depth}`);
      e.depth++;
      drawLayer(A.g, L, e, full(L), a, comp, true);
      if (src && visible(src, e)) drawLayer(B.g, src, e, full(src), Math.max(0, Math.min(1, num(src.opacity, e, 1))), comp, true);
      e.depth--;
      A.g.setTransform(1, 0, 0, 1, 0, 0);
      A.g.globalAlpha = 1;
      A.g.globalCompositeOperation = L.matte.invert ? 'destination-out' : 'destination-in';
      A.g.drawImage(B.canvas, 0, 0);
      A.g.globalCompositeOperation = 'source-over';
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = blendOp(L.blend);
      g.drawImage(A.canvas, 0, 0);
      g.restore();
    } else drawLayer(g, L, e, full(L), a, comp, false);
  }
}

function visible(L: Layer, e: Env): boolean {
  return !(L.in !== undefined && e.t < L.in) && !(L.out !== undefined && e.t >= L.out);
}

const BLEND_OPS: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over', add: 'lighter', screen: 'screen', multiply: 'multiply', overlay: 'overlay', difference: 'difference', lighten: 'lighten', darken: 'darken',
};
const blendOp = (b?: string): GlobalCompositeOperation => BLEND_OPS[b ?? 'normal'] ?? 'source-over';

function drawLayer(g: G, L: Layer, e: Env, m: Mat, alpha: number, comp: Comp, isolated: boolean): void {
  g.save();
  setMat(g, m);
  g.globalAlpha = alpha;
  if (!isolated) g.globalCompositeOperation = blendOp(L.blend);
  const blur = num(L.blur, e, 0);
  if (blur > 0.05) g.filter = `blur(${blur.toFixed(2)}px)`;
  if (L.glow) {
    g.shadowColor = cssColor(col(L.glow.color, e, 'primary'));
    g.shadowBlur = num(L.glow.radius, e, 24);
  } else if (L.shadow) {
    g.shadowColor = cssColor(col(L.shadow.color, e, '#00000099'));
    g.shadowBlur = num(L.shadow.blur, e, 20);
    g.shadowOffsetX = num(L.shadow.x, e, 0);
    g.shadowOffsetY = num(L.shadow.y, e, 10);
  }
  if (L.clip) {
    const r = valueAt(L.clip as Prop<number[]>, e.t, [0, 0, 0, 0], e.sec);
    g.beginPath();
    g.rect(r[0], r[1], r[2], r[3]);
    g.clip();
  }
  const passes = L.glow ? Math.max(1, Math.min(4, Math.round(num(L.glow.strength, e, 1)))) : 1;
  for (let i = 0; i < passes; i++) drawContent(g, L, e, m, alpha, comp);
  g.restore();
}

function drawContent(g: G, L: Layer, e: Env, m: Mat, alpha: number, comp: Comp): void {
  switch (L.type) {
    case 'rect': {
      const [w, h] = vec(L.size, e, [100, 100]);
      const r = Math.max(0, Math.min(num(L.radius, e, 0), Math.abs(w) / 2, Math.abs(h) / 2));
      g.beginPath();
      if (r > 0) rr(g, -w / 2, -h / 2, w, h, r);
      else g.rect(-w / 2, -h / 2, w, h);
      shape(g, L, e, () => 2 * (Math.abs(w) + Math.abs(h)) - (8 - 2 * Math.PI) * r);
      return;
    }
    case 'ellipse': {
      const [w, h] = vec(L.size, e, [100, 100]);
      g.beginPath();
      g.ellipse(0, 0, Math.abs(w) / 2, Math.abs(h) / 2, 0, -Math.PI / 2, Math.PI * 1.5);
      shape(g, L, e, () => {
        const a = Math.abs(w) / 2, b = Math.abs(h) / 2, q = ((a - b) / (a + b || 1)) ** 2;
        return Math.PI * (a + b) * (1 + (3 * q) / (10 + Math.sqrt(4 - 3 * q)));
      });
      return;
    }
    case 'path': {
      const p = path2d(L.d);
      shape(g, L, e, () => pathLength(L.d), p);
      return;
    }
    case 'line': {
      const a = vec(L.from, e, [0, 0]), b = vec(L.to, e, [100, 0]);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      shape(g, { ...L, stroke: { width: 4, color: 'text', ...L.stroke } }, e, () => Math.hypot(b[0] - a[0], b[1] - a[1]));
      return;
    }
    case 'text':
      drawText(g, L, e);
      return;
    case 'image': {
      const im = images.get(srcOf(L.src, e.studio));
      if (!im) return;
      const [w, h] = vec(L.size, e, [im.naturalWidth, im.naturalHeight]);
      g.drawImage(im, -w / 2, -h / 2, w, h);
      return;
    }
    case 'logo': {
      const h = num(L.size, e, 200);
      if (L.tile) drawTile(g, e.c.theme, 0, 0, h * 1.7, 1);
      drawLogo(g, e.c.brand.logo, 0, 0, h, cssColor(col(L.color, e, 'text')));
      return;
    }
    case 'technique': {
      const start = L.start ?? L.in ?? 0;
      const lt = (e.t - start) * e.sec;
      const off = layerOf(`studio-fx${e.depth}`);
      resetCtx(off.g);
      fxOf(e.c)(L.technique, off.g, lt, L.params ?? {}, L.beats);
      g.drawImage(off.canvas, -W / 2, -H / 2);
      return;
    }
    case 'code': {
      const fn = codeOf(L.id, L.draw);
      try {
        // deterministic Math.random per frame, like code scenes
        fn(g, e.t, stageOf(e.c), seededMath(e.c.index * 7919 + e.t));
      } catch (err) {
        if (!reported.has(L)) {
          reported.add(L);
          console.error(`[motion] studio code layer "${L.id}" failed: ${(err as Error).message}`);
        }
      }
      return;
    }
    case 'group': {
      const G0 = L as GroupLayer;
      const tm = G0.time;
      let t2 = e.t;
      if (tm) {
        t2 = (e.t - (tm.offset ?? 0)) * (tm.speed ?? 1);
        if (tm.loop) t2 = mod(t2, tm.loop);
      }
      const e2: Env = { ...e, t: t2 };
      g.save();
      drawList(g, G0.layers, e2, () => m, alpha, comp);
      g.restore();
      e.depth = e2.depth;
      return;
    }
  }
}

interface ShapeLike {
  type: string;
  fill?: Prop<string> | Gradient;
  stroke?: { color?: Prop<string>; width?: Prop<number>; cap?: CanvasLineCap; join?: CanvasLineJoin; dash?: number[] };
  trim?: { start?: Prop<number>; end?: Prop<number>; offset?: Prop<number> };
}

function shape(g: G, L: ShapeLike, e: Env, length: () => number, p?: Path2D): void {
  const hasFill = L.fill !== undefined;
  const fillDefault = !L.stroke && L.type !== 'line';
  if (hasFill || fillDefault) {
    g.fillStyle = paint(g, L.fill, e, 'primary');
    if (p) g.fill(p);
    else g.fill();
    // shadows/glow only once (on the fill) when there is a stroke too
    if (L.stroke) g.shadowColor = 'transparent';
  }
  if (!L.stroke) return;
  const s = L.stroke;
  g.strokeStyle = cssColor(col(s.color, e, 'text'));
  g.lineWidth = num(s.width, e, 4);
  g.lineCap = s.cap ?? 'butt';
  g.lineJoin = s.join ?? 'miter';
  if (L.trim) {
    const a = num(L.trim.start, e, 0), b = num(L.trim.end, e, 1), o = num(L.trim.offset, e, 0);
    const len = length();
    if (b - a <= 0.0005) return;
    g.setLineDash([Math.max(0.01, (b - a) * len), len * 2]);
    g.lineDashOffset = -(a + o) * len;
  } else if (s.dash) g.setLineDash(s.dash);
  if (p) g.stroke(p);
  else g.stroke();
}

const paths = new Map<string, Path2D>();
function path2d(d: string): Path2D {
  let p = paths.get(d);
  if (!p) paths.set(d, (p = new Path2D(d)));
  return p;
}
const lengths = new Map<string, number>();
function pathLength(d: string): number {
  let n = lengths.get(d);
  if (n === undefined) {
    try {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('d', d);
      n = el.getTotalLength();
    } catch {
      n = 1000;
    }
    lengths.set(d, n);
  }
  return n;
}

const codes = new Map<string, (...a: unknown[]) => unknown>();
const reported = new WeakSet<Layer>();
function codeOf(id: string, body: string) {
  const k = `${id}\u0000${body}`;
  let f = codes.get(k);
  if (!f) codes.set(k, (f = compile(['g', 't', 'S'], body, `layer-${id}`)));
  return f;
}
const stages = new WeakMap<Ctx, StageBase>();
function stageOf(c: Ctx): StageBase {
  let s = stages.get(c);
  if (!s) stages.set(c, (s = baseStage(c)));
  return s;
}
const fxs = new WeakMap<Ctx, ReturnType<typeof fxFactory>>();
function fxOf(c: Ctx) {
  let f = fxs.get(c);
  if (!f) fxs.set(c, (f = fxFactory({ ...c, captions: false })));
  return f;
}

// ── text ──────────────────────────────────────────────────────────────────────

function setFont(g: G, size: number, weight: number, name: string | undefined, italic: boolean): void {
  if (!name || FONT_ROLES.has(name)) roleFont(g, size, weight, (name ?? 'display') as FontRole, italic);
  else g.font = `${italic ? 'italic ' : ''}${weight} ${size.toFixed(1)}px "${name}", system-ui, sans-serif`;
}

interface Unit { text: string; x: number; w: number; line: number }

const IDENTITY: Required<UnitState> = { opacity: 1, x: 0, y: 0, scale: 1, rotation: 0, blur: 0 };

function orderOf(n: number, order: string | undefined, seed: number): number[] {
  const idx = [...Array(n).keys()];
  if (order === 'reverse') return idx.map(i => n - 1 - i);
  if (order === 'center') return idx.map(i => Math.abs(i - (n - 1) / 2));
  if (order === 'random') {
    const perm = idx.slice().sort((a, b) => rnd(a, seed) - rnd(b, seed));
    const rank = new Array<number>(n);
    perm.forEach((u, r) => (rank[u] = r));
    return rank;
  }
  return idx;
}

function drawText(g: G, L: TextLayer, e: Env): void {
  const size = num(L.size, e, 120), weight = L.weight ?? 800;
  setFont(g, size, weight, L.font, !!L.italic);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const track = num(L.tracking, e, 0) * size;
  (g as G & { letterSpacing: string }).letterSpacing = `${track.toFixed(2)}px`;
  const lines = L.text.split('\n');
  const lh = size * (L.lineHeight ?? 1.1);
  const fill = paint(g, L.color, e, 'text');
  const stroke = L.stroke ? { color: cssColor(col(L.stroke.color, e, 'text')), width: num(L.stroke.width, e, 2) } : null;
  const align = L.align ?? 'center';
  const A = L.animate;
  const by = A?.by ?? 'char';
  // layout
  const units: Unit[] = [];
  const widths: number[] = [];
  lines.forEach((line, li) => {
    const pieces = !A || by === 'line' ? [line] : by === 'word' ? line.split(/(\s+)/).filter(s => s.length) : [...line];
    let x = 0;
    const lineUnits: Unit[] = [];
    for (const p of pieces) {
      const w = g.measureText(p).width;
      lineUnits.push({ text: p, x, w, line: li });
      x += w;
    }
    const total = x - track; // no spacing after the last letter
    widths.push(total);
    const x0 = align === 'center' ? -total / 2 : align === 'right' ? -total : 0;
    for (const u of lineUnits) units.push({ ...u, x: u.x + x0 });
  });
  const y0 = -((lines.length - 1) * lh) / 2;
  const draw = (u: Unit) => {
    if (/^\s+$/.test(u.text)) return;
    if (stroke) {
      g.strokeStyle = stroke.color;
      g.lineWidth = stroke.width;
      g.lineJoin = 'round';
      g.strokeText(u.text, 0, 0);
    }
    if (!stroke || L.color !== undefined) {
      g.fillStyle = fill;
      g.fillText(u.text, 0, 0);
    }
  };
  if (!A) {
    for (const u of units) {
      g.save();
      g.translate(u.x, y0 + u.line * lh);
      draw(u);
      g.restore();
    }
    return;
  }
  const visibleUnits = units.filter(u => !/^\s+$/.test(u.text));
  const n = visibleUnits.length;
  const ordIn = orderOf(n, A.order, 7);
  const ordOut = orderOf(n, A.exit?.order ?? A.order, 11);
  const from: Required<UnitState> = { ...IDENTITY, ...(A.from ?? { opacity: 0, y: size * 0.6 }) };
  const to: Required<UnitState> = { ...IDENTITY, ...(A.exit?.to ?? { opacity: 0, y: -size * 0.6 }) };
  const dur = A.duration ?? 0.5, stag = A.stagger ?? 0.04, start = A.start ?? 0;
  const baseAlpha = g.globalAlpha, baseFilter = g.filter;
  visibleUnits.forEach((u, i) => {
    const ti = e.t - (start + ordIn[i] * stag);
    let p = dur > 0 ? applyEase(A.ease ?? 'outExpo', Math.max(0, Math.min(1, ti / dur)), Math.max(0, ti) * e.sec) : ti >= 0 ? 1 : 0;
    if (ti < 0) p = 0;
    let s = mixState(from, IDENTITY, p);
    if (A.exit) {
      const X = A.exit, d2 = X.duration ?? dur, to2 = e.t - (X.start + ordOut[i] * (X.stagger ?? stag));
      const q = to2 <= 0 ? 0 : d2 > 0 ? applyEase(X.ease ?? 'inExpo', Math.min(1, to2 / d2), to2 * e.sec) : 1;
      s = mixState(s, to, q);
    }
    if (s.opacity <= 0.002) return;
    g.save();
    const ly = y0 + u.line * lh;
    if (A.mask) {
      g.beginPath();
      g.rect(u.x - size, ly - lh / 2, u.w + 2 * size, lh);
      g.clip();
    }
    g.translate(u.x + u.w / 2 + s.x, ly + s.y);
    if (s.rotation) g.rotate((s.rotation * Math.PI) / 180);
    if (s.scale !== 1) g.scale(s.scale, s.scale);
    g.globalAlpha = baseAlpha * s.opacity;
    if (s.blur > 0.05) g.filter = `${baseFilter === 'none' ? '' : baseFilter + ' '}blur(${s.blur.toFixed(2)}px)`;
    g.translate(-u.w / 2, 0);
    draw(u);
    g.restore();
  });
}

function mixState(a: Required<UnitState>, b: Required<UnitState>, p: number): Required<UnitState> {
  const l = (x: number, y: number) => x + (y - x) * p;
  return { opacity: Math.max(0, Math.min(1, l(a.opacity, b.opacity))), x: l(a.x, b.x), y: l(a.y, b.y), scale: l(a.scale, b.scale), rotation: l(a.rotation, b.rotation), blur: Math.max(0, l(a.blur, b.blur)) };
}

// ── sound ─────────────────────────────────────────────────────────────────────

type SoundFn = (A: Audio, at: number, gain: number, dur: number) => void;
const SOUND: Record<string, SoundFn> = {
  whoosh: (A, at, v, d) => SY.whoosh(A, at, d, 0.3 * v),
  impact: (A, at, v) => SY.impact(A, at, 0.8 * v),
  pop: (A, at, v) => SY.pop(A, at, 72, 0.16 * v),
  click: (A, at, v) => SY.keyclick(A, at, 0.06 * v),
  shing: (A, at, v) => SY.shing(A, at, 0.22 * v),
  riser: (A, at, v, d) => SY.riser(A, at, at + d, 0.2 * v),
  blip: (A, at, v) => SY.blip(A, at, 84, 0.04 * v),
  crash: (A, at, v) => SY.crash(A, at, 0.24 * v),
  clap: (A, at, v) => SY.clap(A, at, 0.45 * v),
  kick: (A, at, v) => SY.kick(A, at, v),
  zip: (A, at, v) => SY.zip(A, at, 0, 0.07 * v),
  swell: (A, at, v, d) => SY.swell(A, at, at + d, 0.22 * v),
};

// ── as techniques ─────────────────────────────────────────────────────────────

const NoParams = z.object({}).passthrough();

/** Every comp as a technique "comp:<id>" the engine can play in a section. */
export function installStudio(studio: Studio): Technique[] {
  return studio.comps.map((comp): Technique => {
    const sec = (c: Ctx) => (comp.units === 'beats' ? c.B : 1);
    return {
      id: `comp:${comp.id}`,
      title: comp.title || comp.id,
      category: 'custom',
      summary: '',
      label: (comp.title || comp.id).toUpperCase().slice(0, 24),
      params: NoParams,
      beats: { min: 0.25, max: 64, default: 4 },
      energy: 2,
      hud: false,
      example: {},
      draw: (g, lt, _p, c) => drawComp(g, comp, lt, c, studio),
      sfx: comp.sounds.length
        ? (A, t0, _p, c) => comp.sounds.forEach(s => SOUND[s.sound]?.(A, t0 + s.t * sec(c), s.gain ?? 1, (s.duration ?? 0.5) * sec(c)))
        : undefined,
      hits: (_p, c) => comp.hits.map(h => ({ at: h.t * sec(c), shake: h.shake, punch: h.punch })),
    } as Technique;
  });
}
