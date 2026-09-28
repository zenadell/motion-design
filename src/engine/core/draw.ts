import { rgba } from './color';
import { clamp, rnd, TAU } from './math';
import { font, theme } from './theme';

export const W = 1920;
export const H = 1080;
export type G = CanvasRenderingContext2D;

export function makeLayer(w = W, h = H): [HTMLCanvasElement, G] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function resetCtx(g: G): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.filter = 'none';
  g.letterSpacing = '0px';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  g.setLineDash([]);
}

/** Fill well past the frame so screen-shake never exposes an edge. */
export function fillBg(g: G, col: string): void {
  g.fillStyle = col;
  g.fillRect(-300, -300, W + 600, H + 600);
}

/** Font size that makes `text` exactly `targetW` wide at `weight`. */
export function fitFont(g: G, text: string, targetW: number, weight: number, role: 'display' | 'mono' | 'serif' = 'display', italic = false): number {
  font(g, 100, weight, role, italic);
  const w = g.measureText(text).width || 1;
  return (100 * targetW) / w;
}

/** Kerned per-letter layout: x of each glyph = width of the prefix before it. */
export function kern(g: G, text: string, track = 0): { xs: number[]; ws: number[]; total: number } {
  const xs: number[] = [], ws: number[] = [];
  for (let i = 0; i < text.length; i++) {
    xs.push(g.measureText(text.slice(0, i)).width + i * track);
    ws.push(g.measureText(text[i]).width);
  }
  return { xs, ws, total: g.measureText(text).width + Math.max(0, text.length - 1) * track };
}

/** Draw text centred on its actual ink bounds (not the em box). */
export function drawCentered(g: G, text: string, x: number, y: number, stroke = false): { w: number; h: number } {
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const m = g.measureText(text);
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const dx = x - w / 2 + m.actualBoundingBoxLeft, dy = y + h / 2 - m.actualBoundingBoxDescent;
  if (stroke) g.strokeText(text, dx, dy);
  else g.fillText(text, dx, dy);
  return { w, h };
}

/** Small mono "spec" annotation — the designer's margin notes. */
export function caption(g: G, lines: string[], x: number, y: number, col: string, align: CanvasTextAlign = 'left', size = 17): void {
  font(g, size, 500, 'mono');
  g.letterSpacing = '3px';
  g.fillStyle = col;
  g.textAlign = align;
  lines.forEach((s, i) => g.fillText(s.toUpperCase(), x, y + i * (size + 9)));
  g.letterSpacing = '0px';
  g.textAlign = 'left';
}

export function typeOn(g: G, s: string, x: number, y: number, p: number, align: 'left' | 'center' | 'right' = 'left'): void {
  const full = g.measureText(s).width;
  const lx = align === 'center' ? x - full / 2 : align === 'right' ? x - full : x;
  g.textAlign = 'left';
  g.fillText(s.slice(0, Math.floor(clamp(p) * s.length)), lx, y);
}

export function rr(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

export function glow(g: G, x: number, y: number, r: number, col: string, a = 1): void {
  if (a <= 0 || r <= 0) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(col, a));
  gr.addColorStop(0.5, rgba(col, a * 0.35));
  gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
}

export function arrow(g: G, x: number, y: number, s: number, col: string, lw = 3): void {
  g.save();
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x - s, y);
  g.lineTo(x + s, y);
  g.moveTo(x + s * 0.35, y - s * 0.62);
  g.lineTo(x + s, y);
  g.lineTo(x + s * 0.35, y + s * 0.62);
  g.stroke();
  g.restore();
}

export function checkMark(g: G, x: number, y: number, s: number, col: string, lw = 4): void {
  g.save();
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x - s, y);
  g.lineTo(x - s * 0.3, y + s * 0.7);
  g.lineTo(x + s, y - s * 0.7);
  g.stroke();
  g.restore();
}

export function starPath(g: G, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr0 = i % 2 ? r * 0.46 : r;
    const x = cx + Math.cos(a) * rr0, y = cy + Math.sin(a) * rr0;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

export function dotGrid(g: G, a: number, step = 48, col?: string): void {
  g.fillStyle = rgba(col ?? theme().text, a);
  for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) g.fillRect(x - 1, y - 1, 2, 2);
}

// ── The blade: a hot light-sabre stroke, the house transition motif ─────────
export const DIAG: [number, number] = [Math.SQRT1_2, -Math.SQRT1_2];
export const NORM: [number, number] = [Math.SQRT1_2, Math.SQRT1_2];

export function blade(g: G, x: number, y: number, len: number, k = 1, ang = -Math.PI / 4, hot?: string, warm?: string): void {
  if (len <= 0 || k <= 0) return;
  const T = theme();
  const c1 = hot ?? T.primary, c2 = warm ?? T.secondary;
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.globalCompositeOperation = 'lighter';
  for (const [w, a, col] of [[260, 0.16, c1], [90, 0.3, c1], [30, 0.7, c2], [7, 1, '#FFFFFF']] as const) {
    const gr = g.createLinearGradient(0, -w / 2, 0, w / 2);
    gr.addColorStop(0, rgba(col, 0));
    gr.addColorStop(0.5, rgba(col, a * k));
    gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr;
    g.fillRect(-len / 2, -w / 2, len, w);
  }
  g.restore();
}

/** Path for one half of the frame split along the '/' diagonal; sign −1 = upper-left. */
export function halfPlane(g: G, sign: number, off: number): void {
  const cx = W / 2 + NORM[0] * off * sign, cy = H / 2 + NORM[1] * off * sign, L = 4000;
  g.beginPath();
  g.moveTo(cx - DIAG[0] * L, cy - DIAG[1] * L);
  g.lineTo(cx + DIAG[0] * L, cy + DIAG[1] * L);
  g.lineTo(cx + DIAG[0] * L + NORM[0] * L * sign, cy + DIAG[1] * L + NORM[1] * L * sign);
  g.lineTo(cx - DIAG[0] * L + NORM[0] * L * sign, cy - DIAG[1] * L + NORM[1] * L * sign);
  g.closePath();
}

// ── Film grain ───────────────────────────────────────────────────────────────
let grainTile: HTMLCanvasElement | null = null;
const grainPats = new WeakMap<G, CanvasPattern>();
export function grain(g: G, t: number, fps: number, amount: number): void {
  if (amount <= 0) return;
  if (!grainTile) {
    const [c, gg] = makeLayer(256, 256);
    const img = gg.createImageData(256, 256);
    let s = 424242;
    for (let i = 0; i < img.data.length; i += 4) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const v = s >>> 24;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    gg.putImageData(img, 0, 0);
    grainTile = c;
  }
  let pat = grainPats.get(g);
  if (!pat) {
    pat = g.createPattern(grainTile, 'repeat')!;
    grainPats.set(g, pat);
  }
  const f = Math.floor(t * fps);
  g.save();
  g.globalAlpha = amount;
  g.globalCompositeOperation = 'overlay';
  g.translate(-Math.floor(rnd(f, 1) * 256), -Math.floor(rnd(f, 2) * 256));
  g.fillStyle = pat;
  g.fillRect(0, 0, W + 256, H + 256);
  g.restore();
}

export { TAU };
