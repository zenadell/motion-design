import { z } from 'zod';
import { blip, bloop, tom } from '../audio/synth';
import { mix } from '../core/color';
import { caption, fillBg, fitFont, H, kern, W, type G } from '../core/draw';
import { E, lerp, prog, rnd, TAU } from '../core/math';
import { font, theme } from '../core/theme';
import { cap } from './_shared';
import { define, type Ctx } from './types';

const SIZE = 560, BASE = 770;
const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ#%&@$0123456789';
const MATCH = /[OQD0]/;

function guides(g: G, alpha: number, lt: number, c: Ctx, size: number): void {
  if (alpha <= 0.001) return;
  const T = theme(), b = c.bt;
  font(g, size, 900);
  const capH = g.measureText('H').actualBoundingBoxAscent, xH = g.measureText('x').actualBoundingBoxAscent;
  const lines: Array<[number, string, string]> = [[BASE - capH, 'CAP HEIGHT', String(Math.round(capH))], [BASE - xH, 'X-HEIGHT', String(Math.round(xH))], [BASE, 'BASELINE', '0']];
  g.save();
  lines.forEach(([y, label, v], k) => {
    const q = E.outExpo(prog(lt, b(k * 0.1), b(k * 0.1 + 0.9)));
    g.globalAlpha = alpha * (k === 2 ? 0.9 : 0.45);
    g.fillStyle = T.dark; g.fillRect(90, y - 1, (W - 180) * q, 2);
    g.globalAlpha = alpha * q * 0.8;
    font(g, 16, 500, 'mono'); g.letterSpacing = '3px';
    g.fillText(label, 94, y - 12);
    g.textAlign = 'right'; g.fillText(v, W - 94, y - 12); g.textAlign = 'left';
  });
  g.restore();
  g.letterSpacing = '0px';
}
function selection(g: G, x: number, y: number, w: number, h: number, a: number, label: string): void {
  const T = theme();
  g.save(); g.globalAlpha = a; g.strokeStyle = T.primary; g.lineWidth = 3; g.strokeRect(x, y, w, h);
  g.fillStyle = '#FFFFFF'; g.lineWidth = 2.5;
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]]) {
    g.fillRect(cx - 7, cy - 7, 14, 14); g.strokeRect(cx - 7, cy - 7, 14, 14);
  }
  font(g, 16, 600, 'mono'); g.letterSpacing = '1px';
  const tw = g.measureText(label).width;
  g.fillStyle = T.primary; g.fillRect(x + w / 2 - tw / 2 - 10, y + h + 18, tw + 20, 28);
  g.fillStyle = '#FFFFFF'; g.fillText(label, x + w / 2 - tw / 2, y + h + 38);
  g.restore(); g.letterSpacing = '0px';
}

const Params = z.object({
  word: z.string().min(2).max(6),
  morphTo: z.string().min(2).max(6).optional().describe('Scramble into this word after the drop'),
  matchCut: z.boolean().default(true).describe('If morphTo has an O/D/Q/0, it becomes a solid circle for the next scene'),
});
type P = z.output<typeof Params>;
const morphAt = (p: P) => p.word.length * 0.5;

export default define({
  id: 'type-drop',
  title: 'Type drop + scramble',
  category: 'type',
  summary: 'On a paper background with typographic guides (cap height, x-height, baseline), each letter drops in on an 8th with squash-and-stretch, impact lines and a design-tool selection box; then the word glyph-scrambles into a second word and its O match-cuts into a solid circle.',
  guidance: 'Short words only (≤ 6 letters). beats = letters × 0.5 + 2 when using morphTo. The circle ending flows perfectly into mitosis-grid.',
  label: 'TYPE',
  params: Params,
  beats: { min: 1, max: 5, default: 4 },
  energy: 2,
  example: { word: 'TYPE', morphTo: 'FORM' },
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt, ma = b(morphAt(p));
    fillBg(g, T.light);
    const size = Math.min(SIZE, fitFont(g, p.morphTo && p.morphTo.length > p.word.length ? p.morphTo : p.word, W * 0.8, 900));
    guides(g, p.morphTo ? 1 - prog(lt, ma, ma + b(0.7)) : 1, lt, c, size);
    if (lt < ma || !p.morphTo) {
      font(g, size, 900);
      const K = kern(g, p.word, -size * 0.015), x0 = W / 2 - K.total / 2;
      for (let i = 0; i < p.word.length; i++) {
        const td = b(i * 0.5);
        if (lt < td - b(0.26)) continue;
        font(g, size, 900);
        const ch = p.word[i], m = g.measureText(ch), lx = x0 + K.xs[i];
        const cx = lx + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
        let y = BASE, sx = 1, sy = 1;
        const s = lt - td;
        if (s < 0) { const f = prog(lt, td - b(0.26), td); y = BASE - (1 - f * f) * 950; sy = 1 + 0.25 * f; sx = 1 / Math.sqrt(sy); }
        else { const k = 0.3 * Math.exp(-11 * s) * Math.cos(30 * s); sy = 1 - k; sx = 1 + k * 0.6; }
        g.save(); g.translate(cx, y); g.scale(sx, sy); g.fillStyle = T.dark; g.fillText(ch, lx - cx, 0); g.restore();
        if (s >= 0 && s < 0.42) {
          const pad = 16, bx = lx - m.actualBoundingBoxLeft - pad, by = BASE - m.actualBoundingBoxAscent - pad;
          const bw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight + pad * 2, bh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + pad * 2;
          selection(g, bx, by, bw, bh, 1 - prog(s, 0.3, 0.42), `${Math.round(bw)} × ${Math.round(bh)}`);
          if (s < 0.18) {
            const q = prog(s, 0, 0.18);
            g.save(); g.strokeStyle = T.dark; g.lineWidth = 6; g.lineCap = 'round'; g.globalAlpha = 1 - q;
            for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
              const a = (-0.5 + k * 0.45) * side, r0 = bw / 2 + 30 + q * 50, len = 46 * (1 - q) + 4, bx2 = cx + side * r0, by2 = BASE - 20 - k * 38;
              g.beginPath(); g.moveTo(bx2, by2); g.lineTo(bx2 + side * len * Math.cos(a), by2 - len * Math.sin(Math.abs(a)) * (k - 1)); g.stroke();
            }
            g.restore();
          }
        }
      }
      cap(g, c, ['SQUASH & STRETCH', 'DROP ON THE 8THS'], 'tl', T.light);
      return;
    }
    const target = p.morphTo;
    let str = '';
    const wts: number[] = [], cols: string[] = [];
    for (let i = 0; i < target.length; i++) {
      const tr = ma + b(0.12 + i * 0.15);
      if (lt < tr) {
        const k = Math.floor(lt * 30);
        str += GLYPHS[Math.floor(rnd(k, i) * GLYPHS.length)];
        wts.push(200 + Math.floor(rnd(k, i + 9) * 8) * 100); cols.push(T.primary);
      } else { str += target[i]; wts.push(900); cols.push(T.dark); }
    }
    font(g, size, 900);
    const K = kern(g, str, -size * 0.015), x0 = W / 2 - K.total / 2;
    const mi = p.matchCut ? target.search(MATCH) : -1;
    const exitAt = ma + b(1);
    const ex = E.inOutExpo(prog(lt, exitAt, exitAt + b(0.68)));
    for (let i = 0; i < target.length; i++) {
      if (i === mi && lt >= exitAt) continue;
      font(g, size, wts[i]);
      const dx = i === mi ? 0 : (i < mi || mi < 0 ? -1 : 1) * ex * (1300 + i * 160);
      g.globalAlpha = i === mi ? 1 : 1 - ex;
      g.fillStyle = cols[i];
      g.fillText(str[i], x0 + K.xs[i] + (K.ws[i] - g.measureText(str[i]).width) / 2 + dx, BASE);
    }
    g.globalAlpha = 1;
    if (mi >= 0 && lt >= exitAt) {
      font(g, size, 900);
      const m = g.measureText(target[mi]), ox = x0 + K.xs[mi];
      const cx0 = ox + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, cy0 = BASE - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      const rx0 = (m.actualBoundingBoxRight + m.actualBoundingBoxLeft) / 2, ry0 = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 2;
      const mv = E.inOutCubic(prog(lt, exitAt, exitAt + b(0.8))), mm = E.inOutCubic(prog(lt, exitAt + b(0.24), exitAt + b(0.9)));
      const cx = lerp(cx0, W / 2, mv), cy = lerp(cy0, H / 2, mv);
      g.globalAlpha = 1 - mm; g.fillStyle = T.dark; g.fillText(target[mi], ox + (cx - cx0), BASE + (cy - cy0));
      g.globalAlpha = mm; g.fillStyle = mix(T.dark, T.primary, mm);
      g.beginPath(); g.ellipse(cx, cy, lerp(rx0, 200, mm), lerp(ry0, 200, mm), 0, 0, TAU); g.fill();
      g.globalAlpha = 1;
    }
    if (c.captions) caption(g, [`${p.word} → ${target}`, lt < exitAt ? 'GLYPH SCRAMBLE' : mi >= 0 ? 'MATCH CUT → ●' : 'EXIT'], 96, 150, mix(T.dark, T.light, 0.45));
  },
  sfx(A, t0, p, c) {
    const b = c.bt, ch = c.music.chordAt(t0);
    for (let i = 0; i < p.word.length; i++) tom(A, t0 + b(i * 0.5), ch.bass + 16 - i * 2, 0.45);
    if (p.morphTo) {
      const ma = t0 + b(morphAt(p));
      for (let i = 0; i < 8; i++) blip(A, ma + i * b(0.125), 81 + (i * 5) % 15, 0.045, (i % 2 ? 0.5 : -0.5));
      if (p.matchCut && MATCH.test(p.morphTo)) bloop(A, ma + b(1.1), ma + b(1.9), 220, 880, 0.12);
    }
  },
  hits: (p, c) => Array.from({ length: p.word.length }, (_, i) => ({ at: c.bt(i * 0.5), shake: i === p.word.length - 1 ? 16 : 12 })),
});
