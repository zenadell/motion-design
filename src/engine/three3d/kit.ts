// Real 3D for model-written scenes: Three.js rendered deterministically into
// the 2D frame. One shared WebGL renderer per output size; scenes ("views")
// are built once per key and then posed from t every frame, so frames can
// still be rendered in any order and in parallel pages.
//
// This file is bundled separately (dist/three.js, window.Motion3D) and only
// injected into reels whose code uses S.three or a 3D set piece.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { traceContours } from '../assets/trace';

type G = CanvasRenderingContext2D;
type V2 = [number, number];

/** What the 2D engine hands over (the 3D bundle has its own module copies, so nothing is shared implicitly). */
export interface Ctx3D {
  colors: Record<'bg' | 'text' | 'primary' | 'secondary' | 'accent' | 'surface' | 'muted' | 'light' | 'dark', string>;
  /** Sets g.font for a role (display/mono/serif) at a size and weight. */
  font: (g: G, size: number, weight?: number, role?: 'display' | 'mono' | 'serif', italic?: boolean) => void;
  logo: { d: string | null; box: [number, number, number, number]; monogram: string };
  W: number;
  H: number;
}

export type MaterialKind = 'chrome' | 'gold' | 'glass' | 'gloss' | 'matte' | 'metal' | 'neon' | 'clay';

export interface ViewOptions {
  /** Render scale relative to 1920×1080 (lower = faster); default 1. */
  scale?: number;
  /** Bloom strength (0 = off). Needs an opaque background. */
  bloom?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  /** Opaque background colour; omit for a transparent render composited over the 2D frame. */
  bg?: string | null;
  exposure?: number;
  /** Lighting preset. */
  light?: 'studio' | 'rim' | 'neon' | 'none';
  fov?: number;
}

interface Renderer {
  r: THREE.WebGLRenderer;
  pmrem: THREE.PMREMGenerator;
  env: THREE.Texture;
}
/** A dark photo studio with soft boxes: gives chrome, gold and glass crisp, high-contrast reflections. */
function studioScene(): THREE.Scene {
  const room = new RoomEnvironment();
  // darken the neutral room, then add bright panels around the subject
  room.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && "color" in m && !(m as unknown as THREE.MeshBasicMaterial).isMeshBasicMaterial) m.color?.multiplyScalar(0.18);
  });
  const panel = (w: number, h: number, x: number, y: number, z: number, ry: number, rx: number, k: number, color = '#ffffff') => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    room.add(mesh);
  };
  panel(6, 1.2, 0, 6, 2, 0, Math.PI / 2, 9);        // top strip
  panel(1.6, 7, -7, 1, 1, Math.PI / 2, 0, 7);       // left tall softbox
  panel(1.6, 7, 7, 1, -1, -Math.PI / 2, 0, 5);      // right tall softbox
  panel(8, 0.5, 0, -1.5, -7, 0, 0, 4);              // back rim line
  panel(9, 3.2, 0, 1.6, 8, Math.PI, 0, 2.2);        // big soft front light (what a face-on surface mirrors)
  panel(9, 0.35, 0, -0.9, 8, Math.PI, 0, 6);        // a crisp horizon line across chrome faces
  return room;
}

const renderers = new Map<string, Renderer>();
function rendererFor(w: number, h: number): Renderer {
  const key = `${w}x${h}`;
  let e = renderers.get(key);
  if (!e) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(r);
    const env = pmrem.fromScene(studioScene(), 0.02).texture;
    e = { r, pmrem, env };
    renderers.set(key, e);
  }
  return e;
}

// ── geometry: the brand mark and any text as extruded solids ────────────────

/** Is point p inside polygon poly (even-odd)? */
function inside(p: V2, poly: V2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const area = (poly: V2[]) => poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

/** Ramer–Douglas–Peucker simplification of a closed pixel loop (split at the point farthest from the start). */
function simplify(pts: V2[], eps: number): V2[] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  let far = 0, fd = -1;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > fd) { fd = d; far = i; } });
  keep[0] = keep[far] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, far], [far, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (bi >= 0 && best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Closed pixel loops → Shapes with holes (a loop inside an odd number of others is a hole). */
/** Drop the repeated closing point, consecutive duplicates and collinear points (they break triangulation). */
function clean(poly: V2[]): V2[] {
  const out: V2[] = [];
  for (const p of poly) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  const res: V2[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
    if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-6) res.push(b);
  }
  return res;
}

function loopsToShapes(loops: V2[][], scale: number, cx: number, cy: number): THREE.Shape[] {
  const polys = loops.map(l => clean(simplify(l, 0.9))).filter(l => l.length >= 3 && Math.abs(area(l)) > 6);
  const depth = polys.map((p, i) => polys.filter((q, j) => j !== i && Math.abs(area(q)) > Math.abs(area(p)) && inside(p[0], q)).length);
  const toV = (p: V2) => new THREE.Vector2((p[0] - cx) * scale, -(p[1] - cy) * scale);
  const shapes: { shape: THREE.Shape; poly: V2[] }[] = [];
  polys.forEach((p, i) => {
    if (depth[i] % 2) return;
    const pts = p.map(toV);
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    shapes.push({ shape: new THREE.Shape(pts), poly: p });
  });
  polys.forEach((p, i) => {
    if (!(depth[i] % 2)) return;
    // the smallest outer shape containing this hole
    const owner = shapes.filter(s => inside(p[0], s.poly)).sort((a, b) => Math.abs(area(a.poly)) - Math.abs(area(b.poly)))[0];
    if (!owner) return;
    const pts = p.map(toV);
    if (!THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    owner.shape.holes.push(new THREE.Path(pts));
  });
  return shapes.map(s => s.shape);
}

const shapeCache = new Map<string, { shapes: THREE.Shape[]; w: number; h: number }>();

type TextOpts = { weight?: number; role?: 'display' | 'mono' | 'serif'; italic?: boolean; tracking?: number };
const SIZE = 320;
const setFont = (X: Ctx3D, g: G, o: TextOpts) => {
  X.font(g, SIZE, o.weight ?? 900, o.role ?? 'display', o.italic);
  g.letterSpacing = `${(o.tracking ?? 0) * SIZE}px`;
};
let scratch: G | null = null;
const measurer = () => (scratch ??= document.createElement('canvas').getContext('2d')!);

/**
 * Text as shapes, traced from the page's loaded font (any family works).
 * Default: centred on its ink box, height 1 = cap height. `anchor` pins the
 * origin instead (cx px right of the pen, cy px below the baseline, unit px
 * per world unit), so separate letters share one scale and baseline.
 */
export function textShapes(X: Ctx3D, text: string, o: TextOpts = {}, anchor?: { cx: number; cy: number; unit: number }) {
  const key = `t|${text}|${o.weight}|${o.role}|${o.italic}|${o.tracking}|${anchor ? `${anchor.cx.toFixed(2)},${anchor.cy.toFixed(2)},${anchor.unit.toFixed(2)}` : ''}`;
  const hit = shapeCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true })!;
  setFont(X, g, o);
  const m = g.measureText(text);
  const pad = SIZE * 0.2, base = SIZE * 1.15;
  const w = Math.ceil(m.width + SIZE * 0.4), h = Math.ceil(SIZE * 1.6);
  c.width = w;
  c.height = h;
  setFont(X, g, o);
  g.fillStyle = '#fff';
  g.textBaseline = 'alphabetic';
  g.fillText(text, pad, base);
  const data = g.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h);
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] > 127) { mask[i] = 1; const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const unit = anchor?.unit ?? Math.max(1, m.actualBoundingBoxAscent);
  const cx = anchor ? pad + anchor.cx : (x0 + x1) / 2, cy = anchor ? base + anchor.cy : (y0 + y1) / 2;
  const shapes = loopsToShapes(traceContours(mask, w, h, 8) as V2[][], 1 / unit, cx, cy);
  const out = { shapes, w: (x1 - x0) / unit, h: (y1 - y0) / unit };
  shapeCache.set(key, out);
  return out;
}

/** Per-letter layout of a line: each letter's shapes, centred on its advance, and its x offset (world units, line centred). */
export function letterLayout(X: Ctx3D, text: string, o: TextOpts = {}) {
  const g = measurer();
  setFont(X, g, o);
  const full = g.measureText(text);
  const unit = Math.max(1, full.actualBoundingBoxAscent);
  const cy = (full.actualBoundingBoxDescent - full.actualBoundingBoxAscent) / 2;
  const chars = [...text];
  return chars.map((ch, i) => {
    setFont(X, g, o);
    const left = g.measureText(chars.slice(0, i).join('')).width;
    const adv = g.measureText(ch).width;
    return { ch, x: (left + adv / 2 - full.width / 2) / unit, src: ch.trim() ? textShapes(X, ch, o, { cx: adv / 2, cy, unit }) : null };
  });
}

/** The brand mark as shapes (height 1): from its SVG path, or traced from the monogram. */
export function logoShapes(X: Ctx3D) {
  const key = `logo|${X.logo.d ?? X.logo.monogram}`;
  const hit = shapeCache.get(key);
  if (hit) return hit;
  let out: { shapes: THREE.Shape[]; w: number; h: number };
  if (X.logo.d) {
    const svg = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${X.logo.d.replace(/"/g, '')}"/></svg>`);
    const [bx, by, bw, bh] = X.logo.box;
    const s = 1 / Math.max(1e-6, bh);
    const shapes: THREE.Shape[] = [];
    for (const p of svg.paths) for (const sh of SVGLoader.createShapes(p)) {
      // SVG y points down: flip, centre, scale to height 1
      const flip = (v: THREE.Vector2) => new THREE.Vector2((v.x - bx - bw / 2) * s, -(v.y - by - bh / 2) * s);
      const outer = new THREE.Shape(sh.getPoints(12).map(flip));
      outer.holes = sh.holes.map(hole => new THREE.Path(hole.getPoints(12).map(flip)));
      shapes.push(outer);
    }
    out = { shapes, w: bw * s, h: 1 };
  } else out = textShapes(X, X.logo.monogram, { weight: 900 });
  shapeCache.set(key, out);
  return out;
}

export function material(X: Ctx3D, kind: MaterialKind = 'gloss', color?: string): THREE.Material {
  const c = new THREE.Color(color ?? X.colors.primary);
  switch (kind) {
    case 'chrome': return new THREE.MeshPhysicalMaterial({ color: color ? c : new THREE.Color('#ffffff'), metalness: 1, roughness: 0.12, envMapIntensity: 1.4 });
    case 'gold': return new THREE.MeshPhysicalMaterial({ color: color ? c : new THREE.Color('#ffc86b'), metalness: 1, roughness: 0.22, envMapIntensity: 1.3 });
    case 'metal': return new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.9, roughness: 0.35 });
    case 'glass': return new THREE.MeshPhysicalMaterial({ color: color ? c : new THREE.Color('#ffffff'), metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.6, ior: 1.45, iridescence: 0.25, envMapIntensity: 1.2, transparent: true });
    case 'matte': return new THREE.MeshStandardMaterial({ color: c, metalness: 0, roughness: 0.85 });
    case 'clay': return new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.6, sheen: 0.4 });
    case 'neon': return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.3, roughness: 0.4 });
    default: return new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.1, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 });
  }
}

export interface SolidOptions {
  depth?: number;
  bevel?: number;
  material?: MaterialKind;
  color?: string;
  /** Material for the sides (defaults to the face material). */
  side?: MaterialKind;
  sideColor?: string;
  /** Height in world units (default 1). */
  size?: number;
}

function solid(X: Ctx3D, src: { shapes: THREE.Shape[]; w: number; h: number }, o: SolidOptions): THREE.Mesh {
  const depth = o.depth ?? 0.3, bevel = o.bevel ?? 0.025;
  const geo = new THREE.ExtrudeGeometry(src.shapes, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 4, curveSegments: 10 });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  const face = material(X, o.material, o.color);
  const side = o.side || o.sideColor ? material(X, o.side ?? o.material, o.sideColor ?? o.color) : face;
  const mesh = new THREE.Mesh(geo, [face, side]);
  const s = o.size ?? 1;
  mesh.scale.setScalar(s);
  return mesh;
}

/** One 3D scene, built once (setup) and posed every frame. */
export interface View<H> {
  THREE: typeof THREE;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  handles: H;
  /** Render and draw into g (whole frame by default). */
  render(g: G, rect?: { x?: number; y?: number; w?: number; h?: number; alpha?: number }): void;
}

export interface Kit {
  THREE: typeof THREE;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  logo(o?: SolidOptions): THREE.Mesh;
  text(text: string, o?: SolidOptions & { weight?: number; role?: 'display' | 'mono' | 'serif'; italic?: boolean; tracking?: number }): THREE.Mesh;
  /** One mesh per character (for per-letter animation); each is centred on its own position. */
  letters(text: string, o?: SolidOptions & { weight?: number; role?: 'display' | 'mono' | 'serif'; tracking?: number }): THREE.Group;
  material(kind?: MaterialKind, color?: string): THREE.Material;
  shape(kind: 'sphere' | 'torus' | 'cube' | 'capsule' | 'cone' | 'cylinder' | 'knot' | 'ring' | 'icosa', o?: { size?: number; material?: MaterialKind; color?: string }): THREE.Mesh;
  /** Deterministic point field (stars, dust, sparks). */
  particles(n: number, o?: { spread?: [number, number, number]; size?: number; color?: string; seed?: number }): THREE.Points;
  light(kind: 'point' | 'spot' | 'dir', o?: { color?: string; intensity?: number; at?: [number, number, number] }): THREE.Light;
}

const rnd = (i: number, j = 0) => { const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return x - Math.floor(x); };

export function createKit(X: Ctx3D) {
  const views = new Map<string, { view: View<unknown>; composer?: EffectComposer; bloom?: UnrealBloomPass; opts: ViewOptions; w: number; h: number }>();

  function lights(scene: THREE.Scene, kind: ViewOptions['light']) {
    if (kind === 'none') return;
    const key = new THREE.DirectionalLight('#ffffff', kind === 'rim' ? 1.2 : 2.2);
    key.position.set(3, 4, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(new THREE.Color(X.colors.secondary), kind === 'neon' ? 2.5 : 0.8);
    fill.position.set(-5, 1, 3);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(new THREE.Color(X.colors.primary), kind === 'rim' ? 5 : kind === 'neon' ? 4 : 2);
    rim.position.set(0, 3, -6);
    scene.add(rim);
    scene.add(new THREE.AmbientLight('#ffffff', kind === 'rim' ? 0.05 : 0.25));
  }

  function view<H>(key: string, setup: (THREE_: typeof THREE, k: Kit) => H, opts: ViewOptions = {}): View<H> {
    const hit = views.get(key);
    if (hit) return hit.view as View<H>;
    const sc = Math.min(1, Math.max(0.25, opts.scale ?? 1));
    const w = Math.round(X.W * sc), h = Math.round(X.H * sc);
    const R = rendererFor(w, h);
    const scene = new THREE.Scene();
    scene.environment = R.env;
    if (opts.bg) scene.background = new THREE.Color(opts.bg);
    const camera = new THREE.PerspectiveCamera(opts.fov ?? 30, X.W / X.H, 0.05, 500);
    camera.position.set(0, 0, 8);
    lights(scene, opts.light ?? 'studio');
    const kit: Kit = {
      THREE, scene, camera,
      logo: o => solid(X, logoShapes(X), o ?? {}),
      text: (t, o) => solid(X, textShapes(X, t, o), o ?? {}),
      letters: (t, o = {}) => {
        const group = new THREE.Group();
        for (const l of letterLayout(X, t, o)) {
          if (!l.src) continue;
          const m = solid(X, l.src, o);
          m.position.x = l.x * (o.size ?? 1);
          m.userData.char = l.ch;
          m.userData.x = m.position.x;
          group.add(m);
        }
        return group;
      },
      material: (k, c) => material(X, k, c),
      shape: (kind, o = {}) => {
        const s = o.size ?? 1;
        const geo =
          kind === 'sphere' ? new THREE.SphereGeometry(0.5, 64, 32)
          : kind === 'torus' ? new THREE.TorusGeometry(0.4, 0.14, 48, 128)
          : kind === 'cube' ? new THREE.BoxGeometry(0.8, 0.8, 0.8, 4, 4, 4)
          : kind === 'capsule' ? new THREE.CapsuleGeometry(0.25, 0.5, 16, 32)
          : kind === 'cone' ? new THREE.ConeGeometry(0.45, 0.9, 64)
          : kind === 'cylinder' ? new THREE.CylinderGeometry(0.4, 0.4, 0.8, 64)
          : kind === 'knot' ? new THREE.TorusKnotGeometry(0.32, 0.1, 200, 24)
          : kind === 'ring' ? new THREE.TorusGeometry(0.5, 0.04, 16, 128)
          : new THREE.IcosahedronGeometry(0.5, 0);
        const m = new THREE.Mesh(geo, material(X, o.material, o.color));
        m.scale.setScalar(s);
        return m;
      },
      particles: (n, o = {}) => {
        const [sx, sy, sz] = o.spread ?? [12, 7, 10];
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { pos[i * 3] = (rnd(i, o.seed ?? 1) - 0.5) * sx; pos[i * 3 + 1] = (rnd(i, (o.seed ?? 1) + 7) - 0.5) * sy; pos[i * 3 + 2] = (rnd(i, (o.seed ?? 1) + 13) - 0.5) * sz; }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        return new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(o.color ?? X.colors.text), size: o.size ?? 0.03, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false }));
      },
      light: (kind, o = {}) => {
        const c = new THREE.Color(o.color ?? '#ffffff');
        const l = kind === 'spot' ? new THREE.SpotLight(c, o.intensity ?? 40, 30, 0.5, 0.6) : kind === 'dir' ? new THREE.DirectionalLight(c, o.intensity ?? 2) : new THREE.PointLight(c, o.intensity ?? 20, 30);
        const [x, y, z] = o.at ?? [0, 2, 4];
        l.position.set(x, y, z);
        scene.add(l);
        return l;
      },
    };
    const handles = setup(THREE, kit);
    let composer: EffectComposer | undefined, bloom: UnrealBloomPass | undefined;
    if ((opts.bloom ?? 0) > 0) {
      composer = new EffectComposer(R.r, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }));
      composer.setPixelRatio(1);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(w, h), (opts.bloom ?? 0.8) * 0.6, opts.bloomRadius ?? 0.35, opts.bloomThreshold ?? 0.82);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    }
    const v: View<H> = {
      THREE, scene, camera, handles,
      render(g, rect = {}) {
        R.r.toneMappingExposure = opts.exposure ?? 1;
        R.r.setClearColor(0x000000, opts.bg ? 1 : 0);
        camera.aspect = (rect.w ?? X.W) / (rect.h ?? X.H);
        camera.updateProjectionMatrix();
        if (composer) composer.render();
        else R.r.render(scene, camera);
        const win = window as unknown as { __motion3d?: number };
        win.__motion3d = (win.__motion3d ?? 0) + 1;
        g.save();
        g.globalAlpha *= rect.alpha ?? 1;
        g.drawImage(R.r.domElement, 0, 0, w, h, rect.x ?? 0, rect.y ?? 0, rect.w ?? X.W, rect.h ?? X.H);
        g.restore();
      },
    };
    views.set(key, { view: v as View<unknown>, composer, bloom, opts, w, h });
    return v;
  }

  return { THREE, view };
}
