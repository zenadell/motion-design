import { z } from 'zod';
import { blip, clap, crash, pluck, riser, stab } from '../audio/synth';
import { hexToHsl, hslHex, lum, mixHex } from '../core/color';
import { fillBg, H, W, type G } from '../core/draw';
import { clamp, E, lerp, pad2, prog } from '../core/math';
import { font } from '../core/theme';
import { cap, chordTones } from './_shared';
import { define, type Ctx } from './types';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Palette = z.object({ name: z.string().max(16), colors: z.tuple([hex, hex, hex, hex, hex]).describe('[background, square 1, square 2, square 3, centre]') });
const Params = z.object({ palettes: z.array(Palette).min(1).max(4).optional().describe('Defaults are derived from the brand colours') });
type Pal = z.output<typeof Palette>;

const STROBE = [0, 0.25, 0.5, 0.625, 0.75, 0.8125, 0.875, 0.90625, 0.9375].map(x => x + 3);
const ALBERS = (() => {
  const out: Array<{ cx: number; cy: number; s: number }> = [];
  let cy = H / 2, os = H;
  for (const s of [860, 610, 380, 160]) { const m = (os - s) / 2; cy += 0.5 * m; out.push({ cx: W / 2, cy, s }); os = s; }
  return out;
})();

function palettes(c: Ctx, given?: Pal[]): Pal[] {
  if (given?.length) return given;
  const T = c.theme;
  return [
    { name: 'Signature', colors: [T.primary, mixHex(T.primary, T.secondary, 0.5), T.secondary, T.light, T.dark] },
    { name: 'Midnight', colors: [T.bg, T.surface, T.muted, T.text, T.primary] },
    { name: 'Accent', colors: [T.accent, mixHex(T.accent, T.bg, 0.3), mixHex(T.accent, T.bg, 0.62), T.bg, T.primary] },
    { name: 'Paper', colors: [T.light, mixHex(T.light, T.primary, 0.25), T.primary, T.dark, T.secondary] },
  ];
}
function sq(g: G, cx: number, cy: number, s: number, col: string, corner = 0, rot = 0): void {
  g.save(); g.translate(cx, cy); g.rotate(rot); g.fillStyle = col;
  g.beginPath(); g.roundRect(-s / 2, -s / 2, s, s, Math.min(corner, s / 2)); g.fill(); g.restore();
}
function wipe(g: G, x: number, y: number, w: number, h: number, col: string, p: number, dir: number): void {
  g.fillStyle = col;
  if (dir === 1) g.fillRect(x, y, w * p, h);
  else if (dir === 2) g.fillRect(x, y, w, h * p);
  else if (dir === 3) g.fillRect(x + w * (1 - p), y, w * p, h);
  else g.fillRect(x, y + h * (1 - p), w, h * p);
}
function labels(g: G, c: Ctx, cols: string[], name: string, idx: number, tSwap: number, lt: number): void {
  const T = c.theme, fg = lum(cols[0]) > 0.45 ? T.dark : T.light;
  const q = E.outExpo(prog(lt, tSwap, tSwap + c.bt(0.4)));
  font(g, 17, 500, 'mono'); g.letterSpacing = '2px';
  for (let j = 0; j < 5; j++) {
    const y = H / 2 - 96 + j * 48;
    g.fillStyle = cols[j]; g.fillRect(110, y - 17, 22, 22);
    g.strokeStyle = fg; g.lineWidth = 1.5; g.strokeRect(110, y - 17, 22, 22);
    g.fillStyle = fg; g.fillText(cols[j].toUpperCase(), 150, y);
  }
  font(g, 15, 500, 'mono'); g.letterSpacing = '3px'; g.textAlign = 'right';
  g.fillText(`PALETTE ${pad2(idx)}`, W - 110, H / 2 - 74);
  g.save(); g.beginPath(); g.rect(1400, H / 2 - 60, 500, 110); g.clip();
  if (T.serif) font(g, 78, 400, 'serif', true); else font(g, 70, 300);
  g.letterSpacing = '0px'; g.fillText(name, W - 110, H / 2 + 22 + (1 - q) * 96);
  g.restore();
  g.textAlign = 'left'; g.letterSpacing = '0px';
}

export default define({
  id: 'albers-colour',
  title: 'Albers colour study',
  category: 'shape',
  summary: 'Josef Albers’ “Homage to the Square”: nested squares re-colour on every 8th with cascading wipes (palette swatches and hex codes beside them), then morph into circles through a spinning hue sweep, then strobe and collapse into a single brand-coloured dot.',
  guidance: 'Exactly 4 beats — the colour moment of a reel. Palettes default to variations of the brand colours. Ends on a centred dot that signature-card picks up.',
  label: 'COLOUR',
  params: Params,
  beats: { min: 4, max: 4, default: 4 },
  energy: 2,
  example: {},
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt, PAL = palettes(c, p.palettes);
    if (lt < b(2)) {
      const k = clamp(Math.floor(lt / b(0.5) + 1e-6), 0, 3), ts = b(k * 0.5);
      const cur = PAL[k % PAL.length].colors, prev = k ? PAL[(k - 1) % PAL.length].colors : null;
      if (!prev) fillBg(g, cur[0]);
      else { fillBg(g, prev[0]); wipe(g, -300, -300, W + 600, H + 600, cur[0], E.outExpo(prog(lt, ts, ts + b(0.32))), k); }
      ALBERS.forEach((q, j) => {
        const x = q.cx - q.s / 2, y = q.cy - q.s / 2;
        if (!prev) {
          const s = E.outBack(prog(lt, b(0.08 + j * 0.09), b(0.52 + j * 0.09)), 1.8);
          if (s > 0) sq(g, q.cx, q.cy, q.s * s, cur[j + 1], 0, (1 - s) * 0.5);
        } else {
          g.fillStyle = prev[j + 1]; g.fillRect(x, y, q.s, q.s);
          wipe(g, x, y, q.s, q.s, cur[j + 1], E.outExpo(prog(lt, ts + b((j + 1) * 0.06), ts + b((j + 1) * 0.06 + 0.32))), k);
        }
      });
      labels(g, c, cur, PAL[k % PAL.length].name, (k % PAL.length) + 1, ts, lt);
      cap(g, c, ['HOMAGE TO THE SQUARE', 'SWAP ON EVERY 8TH'], 'tl', cur[0]);
    } else if (lt < b(3)) {
      const u = lt - b(2), h0 = hexToHsl(T.primary)[0] + u * 640;
      const cols = [0, 1, 2, 3, 4].map(j => hslHex((h0 + j * 36) % 360, 92 - j * 4, 56 + (j % 2 ? 8 : -4)));
      fillBg(g, cols[0]);
      const m = E.inOutCubic(prog(lt, b(2), b(2.64)));
      ALBERS.forEach((q, j) => sq(g, q.cx, q.cy, q.s, cols[j + 1], (q.s / 2) * m, (j % 2 ? 1 : -1) * u * 2.4));
      labels(g, c, cols, 'Spectrum', 9, b(2), lt);
      cap(g, c, ['HUE ROTATION', `${Math.round(h0 % 360)}°`], 'tl', cols[0]);
    } else {
      let k = 0;
      for (let i = 0; i < STROBE.length; i++) if (lt >= b(STROBE[i])) k = i;
      const last = k === STROBE.length - 1, pi = (k + 1) % PAL.length;
      const cols = last ? [T.bg, T.bg, T.bg, T.bg, T.primary] : PAL[pi].colors;
      fillBg(g, cols[0]);
      const cc = E.inExpo(prog(lt, b(3), b(3.97)));
      ALBERS.forEach((q, j) => { const s = lerp(q.s, 80, cc); sq(g, lerp(q.cx, W / 2, cc), lerp(q.cy, H / 2, cc), s, cols[j + 1], s / 2); });
      if (!last) labels(g, c, cols, PAL[pi].name, pi + 1, b(STROBE[k]), lt);
    }
  },
  sfx(A, t0, _p, c) {
    const b = c.bt;
    crash(A, t0, 0.2, 1.4);
    for (let k = 0; k < 4; k++) {
      const ch = c.music.chordAt(t0 + b(k * 0.5));
      stab(A, t0 + b(k * 0.5), [...ch.pad, ch.pad[1] + 12], 0.075, 0.24, 4200);
    }
    const tones = chordTones(c.music.chordAt(t0 + b(2)).pad, 65, 8);
    tones.forEach((n, i) => pluck(A, t0 + b(2 + i * 0.125), n, 0.05, i % 2 ? 0.4 : -0.4, 1500 + i * 700));
    STROBE.forEach((o, i) => { clap(A, t0 + b(o), 0.16 + i * 0.03); blip(A, t0 + b(o), 84 + i * 2, 0.04, i % 2 ? 0.5 : -0.5); });
    riser(A, t0 + b(2.7), t0 + b(3.97), 0.24);
  },
  hits: (_p, c) => [{ at: 0, shake: 18, punch: 0.04 }],
});
