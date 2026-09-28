// Crafted 3D set pieces on the kit: a hero logo, 3D type with per-letter
// choreography, and a composition of floating 3D forms. Same contract as the
// 2D set pieces: pure functions of (t, options), options rebuilt every frame.

import type * as THREE_NS from 'three';
import { type Ctx3D, type MaterialKind, createKit } from './kit';

type G = CanvasRenderingContext2D;
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const prog = (t: number, a: number, b: number) => clamp((t - a) / Math.max(1e-6, b - a));
const EASE: Record<string, (x: number) => number> = {
  linear: x => x,
  outExpo: x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: x => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  inOutCubic: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outBack: x => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2),
  outCubic: x => 1 - Math.pow(1 - x, 3),
};
const DEG = Math.PI / 180;

/** Keyframed arrays: [[time, v1, v2, …], …]; missing values carry over. */
function keyed(t: number, keys: number[][] | undefined, dflt: number[], ease = 'outExpo'): number[] {
  if (!Array.isArray(keys) || !keys.length) return dflt;
  const f = EASE[ease] ?? EASE.outExpo;
  const full: number[][] = [];
  let prev = dflt;
  for (const k of keys) { const v = prev.map((d, i) => (typeof k[i + 1] === 'number' && Number.isFinite(k[i + 1]) ? k[i + 1] : d)); full.push(v); prev = v; }
  if (t <= keys[0][0]) return full[0];
  for (let i = 1; i < keys.length; i++) if (t < keys[i][0]) { const p = f(prog(t, keys[i - 1][0], keys[i][0])); return full[i - 1].map((v, j) => lerp(v, full[i][j], p)); }
  return full[full.length - 1];
}
const hash = (o: unknown) => JSON.stringify(o, (_k, v) => (typeof v === 'function' ? undefined : v));

export interface Logo3DOpts {
  material?: MaterialKind; color?: string; side?: MaterialKind; sideColor?: string;
  depth?: number; bevel?: number; size?: number; x?: number; y?: number;
  pose?: number[][]; ease?: string; float?: number; sweep?: number[];
  light?: 'studio' | 'rim' | 'neon'; bloom?: number; bg?: string | null; exposure?: number; scale?: number;
}
export interface Type3DOpts extends Omit<Logo3DOpts, 'side' | 'sideColor'> {
  text?: string; weight?: number; role?: 'display' | 'mono' | 'serif'; tracking?: number;
  stagger?: number; enter?: 'drop' | 'flip' | 'fly' | 'none'; dur?: number;
  side?: MaterialKind; sideColor?: string;
}
export interface Shapes3DOpts {
  shapes?: string[]; count?: number; materials?: MaterialKind[]; colors?: string[];
  spread?: number; spin?: number; drift?: number; pops?: number[];
  light?: 'studio' | 'rim' | 'neon'; bloom?: number; bg?: string | null; exposure?: number; scale?: number; seed?: number;
}

export function setPieces3D(X: Ctx3D) {
  const kit = createKit(X);
  const viewOpts = (o: { light?: 'studio' | 'rim' | 'neon'; bloom?: number; bg?: string | null; exposure?: number; scale?: number }) => {
    const bloom = o.bloom ?? 0;
    // bloom needs an opaque background; default to the brand background
    const bg = o.bg === null && !bloom ? null : (o.bg ?? X.colors.bg);
    return { light: o.light ?? 'studio', bloom, bg, exposure: o.exposure ?? 1.05, scale: o.scale ?? 1 };
  };
  /** World position (z = 0 plane) of a screen point, for the default camera. */
  const toWorld = (px: number, py: number) => {
    const hH = Math.tan(15 * DEG) * 8; // half height of the view at distance 8
    return [((px - X.W / 2) / (X.H / 2)) * hH, (-(py - X.H / 2) / (X.H / 2)) * hH];
  };
  /** Size in world units for a height in pixels. */
  const px2w = (px: number) => (px / X.H) * 2 * Math.tan(15 * DEG) * 8;

  // a light that sweeps across the face on cue
  const sweepLight = (THREE: typeof THREE_NS, scene: THREE_NS.Scene) => {
    const l = new THREE.PointLight('#ffffff', 0, 12, 1.2);
    scene.add(l);
    return l;
  };
  const sweepAt = (t: number, cues: number[] | undefined) => {
    for (const c of cues ?? [0.4]) { const p = prog(t, c, c + 0.8); if (p > 0 && p < 1) return EASE.inOutCubic(p); }
    return -1;
  };

  function logo3d(g: G, t: number, o: Logo3DOpts = {}) {
    const vo = viewOpts(o);
    const v = kit.view(`logo3d:${hash([o.material, o.color, o.side, o.sideColor, o.depth, o.bevel, vo])}`, (THREE, k) => {
      const mesh = k.logo({ material: o.material ?? 'chrome', color: o.color, side: o.side, sideColor: o.sideColor, depth: o.depth ?? 0.28, bevel: o.bevel ?? 0.03 });
      const group = new THREE.Group();
      group.add(mesh);
      k.scene.add(group);
      return { group, sweep: sweepLight(THREE, k.scene) };
    }, vo);
    const [yaw, pitch, roll, zoom] = keyed(t, o.pose ?? [[0, -70, 20, -10, 0.35], [0.8, -18, 8, 0, 1]], [0, 0, 0, 1], o.ease);
    const fl = o.float ?? 1;
    const size = px2w(o.size ?? 440);
    const [wx, wy] = toWorld(o.x ?? X.W / 2, o.y ?? X.H / 2);
    const { group, sweep } = v.handles;
    group.position.set(wx, wy + fl * 0.06 * Math.sin(t * 1.3), 0);
    group.rotation.set((pitch + fl * 3 * Math.sin(t * 0.7)) * DEG, (yaw + fl * (6 * Math.sin(t * 0.9) + 4 * t)) * DEG, roll * DEG, 'YXZ');
    group.scale.setScalar(size * Math.max(0.01, zoom));
    const s = sweepAt(t, o.sweep);
    sweep.intensity = s < 0 ? 0 : 60 * Math.sin(Math.PI * s);
    sweep.position.set(wx + lerp(-3, 3, Math.max(0, s)), wy + 0.8, 2.2);
    v.render(g);
  }

  function type3d(g: G, t: number, o: Type3DOpts = {}) {
    const text = (o.text ?? 'MOTION').slice(0, 24);
    const vo = viewOpts(o);
    const v = kit.view(`type3d:${hash([text, o.material, o.color, o.side, o.sideColor, o.depth, o.bevel, o.weight, o.role, o.tracking, vo])}`, (THREE, k) => {
      const letters = k.letters(text, { material: o.material ?? 'gloss', color: o.color, side: o.side ?? 'matte', sideColor: o.sideColor ?? X.colors.dark, depth: o.depth ?? 0.35, bevel: o.bevel ?? 0.02, weight: o.weight, role: o.role, tracking: o.tracking });
      const group = new THREE.Group();
      group.add(letters);
      k.scene.add(group);
      return { group, letters, sweep: sweepLight(THREE, k.scene) };
    }, vo);
    const { group, letters, sweep } = v.handles;
    const [yaw, pitch, roll, zoom] = keyed(t, o.pose ?? [[0, -24, 12, -4, 0.9], [1.2, -10, 6, 0, 1]], [0, 0, 0, 1], o.ease);
    const size = px2w(o.size ?? 300);
    const [wx, wy] = toWorld(o.x ?? X.W / 2, o.y ?? X.H / 2);
    const fl = o.float ?? 1;
    group.position.set(wx, wy + fl * 0.04 * Math.sin(t * 1.2), 0);
    group.rotation.set((pitch + fl * 2 * Math.sin(t * 0.7)) * DEG, (yaw + fl * 3 * Math.sin(t * 0.8)) * DEG, roll * DEG, 'YXZ');
    group.scale.setScalar(size * Math.max(0.01, zoom));
    const n = letters.children.length, st = o.stagger ?? 0.06, dur = o.dur ?? 0.7, enter = o.enter ?? 'drop';
    letters.children.forEach((m, i) => {
      const p = EASE.outExpo(prog(t, i * st, i * st + dur));
      const q = 1 - p;
      const x0 = m.userData.x as number;
      if (enter === 'drop') { m.position.set(x0, q * 2.2, q * 1.5); m.rotation.set(-q * 100 * DEG, 0, q * (i % 2 ? 12 : -12) * DEG); }
      else if (enter === 'flip') { m.position.set(x0, 0, 0); m.rotation.set(0, q * 180 * DEG, 0); }
      else if (enter === 'fly') { m.position.set(x0 + q * (i - n / 2) * 0.8, q * (i % 2 ? 1 : -1) * 1.2, -q * 12); m.rotation.set(q * 60 * DEG, q * 90 * DEG, 0); }
      else { m.position.set(x0, 0, 0); m.rotation.set(0, 0, 0); }
      m.visible = t >= i * st - 0.001 || enter === 'none';
    });
    const s = sweepAt(t, o.sweep);
    sweep.intensity = s < 0 ? 0 : 60 * Math.sin(Math.PI * s);
    sweep.position.set(wx + lerp(-4, 4, Math.max(0, s)), wy + 0.6, 2.2);
    v.render(g);
  }

  function shapes3d(g: G, t: number, o: Shapes3DOpts = {}) {
    const kinds = o.shapes?.length ? o.shapes : ['torus', 'sphere', 'cube', 'capsule', 'cone', 'knot'];
    const n = Math.round(clamp(o.count ?? 9, 1, 40));
    const mats = (o.materials?.length ? o.materials : ['gloss', 'chrome', 'glass', 'matte']) as MaterialKind[];
    const cols = o.colors?.length ? o.colors : [X.colors.primary, X.colors.secondary, X.colors.accent, X.colors.light];
    const vo = viewOpts(o);
    const rand = (i: number, j: number) => { const x = Math.sin((i + (o.seed ?? 1) * 97) * 127.1 + j * 311.7) * 43758.5453; return x - Math.floor(x); };
    const v = kit.view(`shapes3d:${hash([kinds, n, mats, cols, o.seed, vo])}`, (THREE, k) => {
      const items = Array.from({ length: n }, (_, i) => {
        const m = k.shape(kinds[i % kinds.length] as 'sphere', { material: mats[i % mats.length], color: cols[i % cols.length] });
        k.scene.add(m);
        return m;
      });
      return { items };
    }, vo);
    const spread = o.spread ?? 1, spin = o.spin ?? 1, drift = o.drift ?? 1;
    v.handles.items.forEach((m, i) => {
      const a = rand(i, 1) * Math.PI * 2, r = (1.2 + rand(i, 2) * 2.6) * spread;
      const pop = (o.pops ?? []).reduce((acc, c) => acc + (t >= c ? Math.exp(-(t - c) * 6) * Math.sin((t - c) * 18) * 0.25 : 0), 0);
      const inP = EASE.outBack(clamp(prog(t, rand(i, 3) * 0.4, rand(i, 3) * 0.4 + 0.7)));
      m.position.set(Math.cos(a + t * 0.15 * drift) * r * 1.4, Math.sin(a * 1.3 + t * 0.2 * drift) * r * 0.55, (rand(i, 4) - 0.5) * 3);
      m.rotation.set(t * spin * (0.3 + rand(i, 5)), t * spin * (0.4 + rand(i, 6)), 0);
      m.scale.setScalar((0.6 + rand(i, 7) * 0.9) * Math.max(0.001, inP) * (1 + pop));
    });
    v.render(g);
  }

  return { THREE: kit.THREE, view: kit.view, logo3d, type3d, shapes3d };
}
