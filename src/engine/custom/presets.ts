// Crafted building blocks with good defaults, for model-written scenes:
// hero titles that are big and well-timed by default, rich animated
// backgrounds, and a liquid (metaball) effect. They encode the craft a
// fast model tends to under-deliver (scale, easing, layering, light), while
// the model decides the concept, composition and timing.

import { rgba } from '../core/color';
import { H, W, type G } from '../core/draw';
import { clamp, lerp, rnd } from '../core/math';
import { font } from '../core/theme';
import { spring } from './toolkit';

type Eases = Record<string, (t: number) => number>;
type Role = 'display' | 'mono' | 'serif';

export interface TitleOpts {
  t: number;
  preset?: 'slam' | 'rise' | 'split' | 'stretch' | 'scramble' | 'outline-fill' | 'stack';
  size?: number;
  maxWidth?: number;
  weight?: number;
  role?: Role;
  italic?: boolean;
  color?: string;
  accent?: string;
  align?: 'left' | 'center' | 'right';
  tracking?: number;
  dur?: number;
  /** Seconds after which the title leaves (upward, with blur). */
  outAt?: number;
  outDur?: number;
}

const measure = (g: G, text: string, size: number, weight: number, role: Role, italic?: boolean, tracking = 0) => {
  font(g, size, weight, role, italic);
  return g.measureText(text).width + tracking * size * Math.max(0, text.length - 1);
};

/**
 * A hero title at baseline y. Auto-sizes to fit maxWidth (default: the frame
 * inside the safe margins) and to `size` at most (default 300 px). Returns
 * the box it occupies so other elements can be placed around it.
 */
export function title(eases: Eases, layerOf: (k: string) => { canvas: HTMLCanvasElement; g: G }, g: G, text: string, x: number, y: number, o: TitleOpts) {
  const role = o.role ?? 'display', weight = o.weight ?? 800, trk = o.tracking ?? -0.02;
  const maxW = o.maxWidth ?? W - 180;
  let size = o.size ?? 300;
  const w0 = measure(g, text, size, weight, role, o.italic, trk);
  if (w0 > maxW) size *= maxW / w0;
  const width = measure(g, text, size, weight, role, o.italic, trk);
  const left = o.align === 'left' ? x : o.align === 'right' ? x - width : x - width / 2;
  const col = o.color ?? '#fff', acc = o.accent ?? col;
  const dur = o.dur ?? 0.6, t = o.t;
  const out = o.outAt !== undefined ? eases.inExpo(clamp((t - o.outAt) / (o.outDur ?? 0.25))) : 0;
  const box = { x: left, y: y - size * 0.78, w: width, h: size * 0.98, size };
  if (t < 0 || out >= 1) return box;
  const chars = [...text];
  const xs: number[] = [];
  font(g, size, weight, role, o.italic);
  let cx = 0;
  for (const ch of chars) { xs.push(cx); cx += g.measureText(ch).width + trk * size; }
  const glyph = (ch: string, i: number, dx = 0, dy = 0) => g.fillText(ch, left + xs[i] + dx, y + dy);
  g.save();
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.globalAlpha *= 1 - out;
  if (out > 0) { g.translate(0, -out * size * 0.6); g.filter = `blur(${(out * 14).toFixed(1)}px)`; }
  font(g, size, weight, role, o.italic);
  const preset = o.preset ?? 'rise';
  if (preset === 'slam') {
    const p = clamp(t / (dur * 0.5));
    const s = lerp(1.9, 1, eases.outExpo(p)) + 0.06 * (1 - spring(t - dur * 0.25, 320, 18));
    const cxm = left + width / 2, cym = y - size * 0.35;
    g.translate(cxm, cym); g.scale(s, s); g.translate(-cxm, -cym);
    g.globalAlpha *= clamp(t / 0.06);
    if (p < 1) for (let k = 3; k >= 1; k--) {
      // speed echoes behind the slam
      g.save(); g.globalAlpha *= 0.12 * (1 - p); const es = 1 + k * 0.08 * (1 - p);
      g.translate(cxm, cym); g.scale(es, es); g.translate(-cxm, -cym);
      g.fillStyle = acc; chars.forEach((ch, i) => glyph(ch, i)); g.restore();
    }
    g.fillStyle = col; chars.forEach((ch, i) => glyph(ch, i));
    const flash = clamp(1 - (t - dur * 0.5) / 0.25) * (t > dur * 0.45 ? 1 : 0);
    if (flash > 0) { g.globalCompositeOperation = 'lighter'; g.fillStyle = rgba(acc, 0.5 * flash); chars.forEach((ch, i) => glyph(ch, i)); }
  } else if (preset === 'rise') {
    g.save(); g.beginPath(); g.rect(left - size, y - size * 1.05, width + 2 * size, size * 1.35); g.clip();
    chars.forEach((ch, i) => {
      const p = eases.outExpo(clamp((t - i * 0.03) / dur));
      if (p <= 0) return;
      g.fillStyle = col; glyph(ch, i, 0, (1 - p) * size * 1.1);
    });
    g.restore();
  } else if (preset === 'split') {
    const mid = (chars.length - 1) / 2;
    chars.forEach((ch, i) => {
      const k = Math.abs(i - mid);
      const p = eases.outExpo(clamp((t - k * 0.035) / dur));
      if (p <= 0) return;
      g.save(); g.globalAlpha *= p; if (p < 0.9) g.filter = `blur(${((1 - p) * 18).toFixed(1)}px)`;
      g.fillStyle = col; glyph(ch, i, (i - mid) * (1 - p) * size * 0.5, 0); g.restore();
    });
  } else if (preset === 'stretch') {
    const p = eases.outExpo(clamp(t / dur));
    const sx = lerp(2.4, 1, p) - 0.05 * Math.sin(clamp((t - dur) / 0.3) * Math.PI), sy = lerp(0.35, 1, p);
    const cxm = left + width / 2;
    g.translate(cxm, y); g.scale(sx, sy); g.translate(-cxm, -y);
    g.globalAlpha *= clamp(t / 0.08);
    g.fillStyle = col; chars.forEach((ch, i) => glyph(ch, i));
  } else if (preset === 'scramble') {
    const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&/+';
    chars.forEach((ch, i) => {
      const lock = i * 0.045 + dur * 0.5;
      if (t < i * 0.02) return;
      const settled = t >= lock || ch === ' ';
      const c = settled ? ch : pool[Math.floor(rnd(i, Math.floor(t * 24)) * pool.length)];
      g.fillStyle = settled ? col : acc; glyph(c, i);
    });
  } else if (preset === 'outline-fill') {
    const p = clamp(t / dur), q = eases.inOutCubic(clamp((t - dur * 0.6) / (dur * 0.6)));
    g.lineWidth = Math.max(1.5, size * 0.012); g.strokeStyle = col;
    g.save(); g.beginPath(); g.rect(left - 10, y - size, (width + 20) * eases.outExpo(p), size * 1.3); g.clip();
    chars.forEach((ch, i) => g.strokeText(ch, left + xs[i], y)); g.restore();
    if (q > 0) { g.save(); g.beginPath(); g.rect(left - 10, y - size, (width + 20) * q, size * 1.3); g.clip(); g.fillStyle = col; chars.forEach((ch, i) => glyph(ch, i)); g.restore(); }
  } else if (preset === 'stack') {
    const n = 6, p = eases.outExpo(clamp(t / dur));
    for (let k = n; k >= 1; k--) {
      const off = k * size * 0.22 * (1 - p);
      g.lineWidth = 2; g.strokeStyle = rgba(acc, 0.5 * (1 - k / (n + 1)));
      chars.forEach((ch, i) => g.strokeText(ch, left + xs[i], y + off));
      chars.forEach((ch, i) => g.strokeText(ch, left + xs[i], y - off));
    }
    g.fillStyle = col; g.globalAlpha *= clamp(p * 1.4); chars.forEach((ch, i) => glyph(ch, i));
  }
  g.restore();
  void layerOf;
  return box;
}

export interface BgOpts {
  t: number;
  preset?: 'mesh' | 'grid' | 'flow' | 'dots' | 'rays' | 'stripes';
  colors?: string[];
  base?: string;
  intensity?: number;
  speed?: number;
  seed?: number;
}

/** A full-frame animated background. Paints the whole frame. */
export function background(noise: (x: number, y?: number, z?: number) => number, g: G, o: BgOpts) {
  const base = o.base ?? '#0B0C0F', cols = o.colors?.length ? o.colors : ['#FFFFFF'], I = o.intensity ?? 1, t = o.t * (o.speed ?? 1), sd = o.seed ?? 1;
  g.save();
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const preset = o.preset ?? 'mesh';
  if (preset === 'mesh') {
    g.globalCompositeOperation = 'lighter';
    cols.forEach((c, k) => {
      for (let j = 0; j < 2; j++) {
        const x = W * noise(t * 0.15 + k * 3.1 + j, sd), y = H * noise(t * 0.12 + k * 5.7 + j * 2, sd + 9);
        const r = 700 + 400 * noise(t * 0.2 + k + j * 4, sd + 17);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgba(c, 0.32 * I)); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
    });
  } else if (preset === 'grid') {
    const step = 80, off = (t * 60) % step;
    g.strokeStyle = rgba(cols[0], 0.12 * I); g.lineWidth = 1;
    g.beginPath();
    for (let x = -step + off; x < W + step; x += step) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let y = -step + off * 0.5; y < H + step; y += step) { g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();
    const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);
    gr.addColorStop(0, rgba(cols[1] ?? cols[0], 0.18 * I)); gr.addColorStop(1, rgba(base, 0));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  } else if (preset === 'flow') {
    g.lineWidth = 1.4; g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 260; k++) {
      let x = rnd(k, sd) * W, y = rnd(k, sd + 1) * H;
      g.strokeStyle = rgba(cols[k % cols.length], 0.16 * I);
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 24; s++) {
        const a = noise(x * 0.0016, y * 0.0016, t * 0.25 + sd) * Math.PI * 4;
        x += Math.cos(a) * 14; y += Math.sin(a) * 14;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  } else if (preset === 'dots') {
    const step = 30;
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
      const v = noise(x * 0.004, y * 0.004, t * 0.4 + sd);
      const r = 1 + 9 * Math.pow(v, 2.2) * I;
      g.fillStyle = rgba(cols[Math.floor(v * cols.length) % cols.length], 0.55);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  } else if (preset === 'rays') {
    g.globalCompositeOperation = 'lighter';
    const n = 24;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + t * 0.15 + noise(k, sd) * 0.3, w = 0.035 + 0.05 * noise(k * 3.3, t * 0.5);
      const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W);
      gr.addColorStop(0, rgba(cols[k % cols.length], 0.28 * I)); gr.addColorStop(1, rgba(cols[k % cols.length], 0));
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(W / 2, H / 2); g.arc(W / 2, H / 2, W * 1.2, a - w, a + w); g.closePath(); g.fill();
    }
  } else if (preset === 'stripes') {
    const bw = 140, off = (t * 220) % (bw * 2);
    g.save(); g.translate(W / 2, H / 2); g.rotate(-0.35); g.translate(-W, -H);
    for (let x = -bw * 2 + off; x < W * 2; x += bw * 2) { g.fillStyle = rgba(cols[0], 0.08 * I); g.fillRect(x, 0, bw, H * 2); }
    g.restore();
  }
  // vignette
  g.globalCompositeOperation = 'source-over';
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  g.restore();
}

export interface FluidOpts {
  t: number;
  blobs: { x: number; y: number; r: number }[];
  colors?: string[];
  softness?: number;
}

/**
 * Liquid metaballs: circles that merge like molten metal or ink. Returns a
 * full-frame canvas (coloured liquid on black) to composite with
 * 'lighter' or 'screen', or to draw as a scene of its own.
 */
export function fluid(layerOf: (k: string, w?: number, h?: number) => { canvas: HTMLCanvasElement; g: G }, o: FluidOpts): HTMLCanvasElement {
  const s = 0.5, w = W * s, h = H * s;
  const A = layerOf('__fluid-a', w, h), Bm = layerOf('__fluid-b', w, h), C = layerOf('__fluid-c', W, H);
  A.g.fillStyle = '#000'; A.g.fillRect(0, 0, w, h);
  A.g.fillStyle = '#fff';
  for (const b of o.blobs) { A.g.beginPath(); A.g.arc(b.x * s, b.y * s, Math.max(0, b.r * s), 0, Math.PI * 2); A.g.fill(); }
  Bm.g.fillStyle = '#000'; Bm.g.fillRect(0, 0, w, h);
  Bm.g.filter = `blur(${(o.softness ?? 14).toFixed(0)}px) contrast(28)`;
  Bm.g.drawImage(A.canvas, 0, 0);
  Bm.g.filter = 'none';
  const cols = o.colors?.length ? o.colors : ['#FFFFFF'];
  const gr = C.g.createLinearGradient(0, 0, W, H);
  cols.forEach((c, k) => gr.addColorStop(cols.length === 1 ? 0 : k / (cols.length - 1), c));
  C.g.fillStyle = gr; C.g.fillRect(0, 0, W, H);
  C.g.globalCompositeOperation = 'multiply';
  C.g.drawImage(Bm.canvas, 0, 0, W, H);
  C.g.globalCompositeOperation = 'source-over';
  return C.canvas;
}

export const PRESET_DOCS = `## Crafted presets (big, well-timed defaults; use them for hero moments, restyle freely)
- S.title(g, text, x, y, { t, preset, size = 300, maxWidth = 1740, weight = 800, role, italic, color, accent, align = 'center', tracking = -0.02, dur = 0.6, outAt, outDur }) → { x, y, w, h, size }. A hero title at baseline y that auto-fits the width. Presets: 'slam' (scales down from 1.9× with speed echoes and an accent flash), 'rise' (letters rise out of a mask), 'split' (letters fly in from the centre with blur), 'stretch' (squashed and stretched, then snaps), 'scramble' (random characters resolve left to right), 'outline-fill' (outline draws on, fill wipes in), 'stack' (echo outlines collapse into the solid word). outAt: seconds after which it leaves upward with blur. t = seconds since the title starts.
- S.bg(g, { t, preset, colors, base, intensity = 1, speed = 1, seed }) paints the whole frame: 'mesh' (drifting glowing colour fields), 'grid' (scrolling grid with a centre glow), 'flow' (noise flow lines), 'dots' (breathing halftone field), 'rays' (rotating light rays), 'stripes' (moving diagonal bands). Always ends with a vignette.
- S.fluid({ t, blobs: [{ x, y, r }, …], colors, softness = 14 }) → a full-frame canvas of liquid metaballs (blobs merge like molten metal or ink) coloured by a gradient, on black: composite with g.globalCompositeOperation = 'lighter' or 'screen', or draw it as the scene. Animate the blobs yourself (noise, springs, keyframes). About 10–60 blobs.
`;
