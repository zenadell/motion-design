import type { Brand } from '../../plan/schema';
import { mixHex, rgba } from '../core/color';
import { makeLayer, rr, type G } from '../core/draw';
import type { Vec2 } from '../core/math';
import { font, type Theme } from '../core/theme';
import { traceContours } from './trace';

export interface LogoRT {
  path: Path2D | null;
  d: string | null;
  /** Tight bounds of the mark in its own coordinates: x, y, w, h. */
  box: [number, number, number, number];
  monogram: string;
}

export interface BrandRT {
  name: string;
  suffix: string;
  tagline: string;
  site: string;
  email: string;
  tile: boolean;
  logo: LogoRT;
}

function measurePath(d: string): [number, number, number, number] | null {
  try {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
    document.body.appendChild(svg);
    const b = p.getBBox();
    svg.remove();
    return b.width > 0 && b.height > 0 ? [b.x, b.y, b.width, b.height] : null;
  } catch {
    return null;
  }
}

export function makeBrand(b: Brand): BrandRT {
  let path: Path2D | null = null;
  let box: [number, number, number, number] = [0, 0, 100, 100];
  if (b.logo) {
    path = new Path2D(b.logo.d);
    box = measurePath(b.logo.d) ?? (b.logo.viewBox as [number, number, number, number] | undefined) ?? box;
  }
  return {
    name: b.name, suffix: b.suffix, tagline: b.tagline, site: b.site, email: b.email, tile: b.tile,
    logo: { path, d: b.logo?.d ?? null, box, monogram: b.name.trim()[0]?.toUpperCase() ?? '•' },
  };
}

/** Width of the mark when drawn `h` pixels tall. */
export function logoWidth(g: G, L: LogoRT, h: number): number {
  if (L.path) return (L.box[2] / L.box[3]) * h;
  font(g, h * 1.35, 800);
  const m = g.measureText(L.monogram);
  return m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
}

/** Transform so the mark's box is `h` tall and centred on (cx, cy). */
export function logoXform(g: G, L: LogoRT, cx: number, cy: number, h: number): void {
  const s = h / L.box[3];
  g.translate(cx, cy);
  g.scale(s, s);
  g.translate(-(L.box[0] + L.box[2] / 2), -(L.box[1] + L.box[3] / 2));
}

export function drawLogo(g: G, L: LogoRT, cx: number, cy: number, h: number, col: string): void {
  g.save();
  g.fillStyle = col;
  if (L.path) {
    logoXform(g, L, cx, cy, h);
    g.fill(L.path);
  } else {
    font(g, h * 1.35, 800);
    const m = g.measureText(L.monogram);
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, hh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const s = h / hh;
    g.translate(cx, cy);
    g.scale(s, s);
    g.fillText(L.monogram, -w / 2 + m.actualBoundingBoxLeft, hh / 2 - m.actualBoundingBoxDescent);
  }
  g.restore();
}

/** Rounded app-icon tile: dark base with a brand-coloured glow in one corner. */
export function drawTile(g: G, T: Theme, cx: number, cy: number, S: number, glowAmt = 1): void {
  const base = mixHex(T.bg, '#FFFFFF', 0.035);
  g.save();
  rr(g, cx - S / 2, cy - S / 2, S, S, S * 0.225);
  g.fillStyle = base;
  g.fill();
  g.clip();
  const warm = mixHex(T.primary, T.secondary, 0.35);
  const gr = g.createRadialGradient(cx + S * 0.42, cy + S * 0.5, 0, cx + S * 0.42, cy + S * 0.5, S * 1.05);
  gr.addColorStop(0, rgba(warm, 0.95 * glowAmt));
  gr.addColorStop(0.42, rgba(mixHex(T.primary, T.bg, 0.45), 0.5 * glowAmt));
  gr.addColorStop(1, rgba(base, 0));
  g.fillStyle = gr;
  g.fillRect(cx - S / 2, cy - S / 2, S, S);
  g.restore();
  g.save();
  g.strokeStyle = 'rgba(255,255,255,.07)';
  g.lineWidth = Math.max(1, S / 300);
  rr(g, cx - S / 2, cy - S / 2, S, S, S * 0.225);
  g.stroke();
  g.restore();
}

/**
 * The mark as ordered polylines, normalised to height 1 and centred on 0,0.
 * Rasterises the mark and traces its contours, which works identically for
 * SVG logos and monogram fallbacks.
 */
const outlineCache = new WeakMap<LogoRT, Vec2[][]>();
export function logoOutline(L: LogoRT): Vec2[][] {
  const hit = outlineCache.get(L);
  if (hit) return hit;
  const N = 220;
  const [, g] = makeLayer(N, N);
  const aspect = L.path ? L.box[2] / L.box[3] : 1;
  drawLogo(g, L, N / 2, N / 2, N * 0.84 * Math.min(1, 1 / aspect), '#fff');
  const data = g.getImageData(0, 0, N, N).data, mask = new Uint8Array(N * N);
  let minY = N, maxY = 0;
  for (let i = 0; i < N * N; i++) if (data[i * 4 + 3] > 110) { mask[i] = 1; const y = Math.floor(i / N); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const hh = Math.max(1, maxY - minY);
  const loops = traceContours(mask, N, N).map(loop => {
    const pts = loop.filter((_, i) => i % 2 === 0 || i === loop.length - 1);
    return pts.map(([x, y]) => [(x - N / 2) / hh, (y - (minY + maxY) / 2) / hh] as Vec2);
  });
  outlineCache.set(L, loops);
  return loops;
}
