import { z } from 'zod';
import { pop } from '../audio/synth';
import { rgba } from '../core/color';
import { caption, dotGrid, fillBg, fitFont, rr, W } from '../core/draw';
import { clamp, E, hop, prog, TAU } from '../core/math';
import { font } from '../core/theme';
import { tone } from './_shared';
import { define } from './types';

export default define({
  id: 'wave-word',
  title: 'Weight-wave word',
  category: 'type',
  summary: 'A single large word whose letters drop in, then breathe through a travelling variable-weight wave. Optionally framed inside a browser window with a URL bar and an accent underline.',
  guidance: 'Great for one keyword per 2 beats (INTERFACES, PRODUCTS, IDEAS). Use frame "browser" when the word is about the web.',
  label: 'TYPE',
  params: z.object({
    word: z.string().min(2).max(12),
    accentFrom: z.number().int().min(0).max(12).optional().describe('Index of the first letter drawn in the brand colour'),
    frame: z.enum(['browser', 'none']).default('browser'),
    url: z.string().max(40).optional(),
    kicker: z.string().max(60).optional().describe('Small mono line above the word'),
    tone: z.enum(['light', 'dark']).default('light'),
  }),
  beats: { min: 1, max: 4, default: 2 },
  energy: 2,
  example: { word: 'INTERFACES', kicker: 'PRODUCT · BRAND · MOTION' },
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt, tn = tone(c, p.tone);
    fillBg(g, tn.bg);
    dotGrid(g, 0.08, 48, tn.fg);
    const word = p.word, size = Math.min(fitFont(g, word, W * 0.78, 800), 480), base = 650;
    const bp = E.outExpo(prog(lt, b(1), b(1.6)));
    if (p.frame === 'browser' && bp > 0) {
      const bx = W / 2 - 880, by = 250, bw = 1760, bh = 520;
      g.save(); g.globalAlpha = bp; g.strokeStyle = tn.fg; g.lineWidth = 3;
      rr(g, bx, by, bw, bh, 28); g.stroke();
      g.beginPath(); g.moveTo(bx, by + 70); g.lineTo(bx + bw * bp, by + 70); g.stroke();
      [T.primary, T.secondary, T.muted].forEach((col, i) => { g.fillStyle = col; g.beginPath(); g.arc(bx + 40 + i * 32, by + 35, 10, 0, TAU); g.fill(); });
      rr(g, W / 2 - 260, by + 16, 520, 38, 19); g.stroke();
      font(g, 18, 500, 'mono'); g.fillStyle = rgba(tn.fg, 0.55); g.textAlign = 'center';
      g.fillText(p.url ?? (c.brand.site ? `https://${c.brand.site}` : 'https://'), W / 2, by + 42); g.textAlign = 'left';
      g.restore();
    }
    const accent = p.accentFrom ?? Math.floor(word.length * 0.4);
    const ws: number[] = [], widths: number[] = [];
    let total = 0;
    for (let i = 0; i < word.length; i++) {
      const w = clamp(520 + 300 * Math.sin(lt * 9 - i * 0.8), 200, 800);
      font(g, size, w); ws.push(w); widths.push(g.measureText(word[i]).width); total += widths[i];
    }
    let x = W / 2 - total / 2;
    for (let i = 0; i < word.length; i++) {
      const q = E.outBack(prog(lt, b(-0.2 + i * 0.06), b(0.4 + i * 0.06)), 1.5);
      const y = base - (1 - q) * 760 - hop(lt, b(1) + i * 0.02, 0.18) * 50 - hop(lt, b(1.5) + i * 0.02, 0.18) * 30;
      font(g, size, ws[i]); g.fillStyle = i >= accent ? T.primary : tn.fg;
      g.fillText(word[i], x, y);
      x += widths[i];
    }
    g.fillStyle = T.primary;
    g.fillRect(W / 2 - total / 2, base + 40, total * E.outExpo(prog(lt, b(0.5), b(1))), 12);
    if (p.kicker) caption(g, [p.kicker], W / 2, 210, rgba(tn.fg, 0.6), 'center');
  },
  sfx(A, t0, p, c) {
    for (let i = 0; i < p.word.length; i++) pop(A, t0 + c.bt(-0.2 + i * 0.06) + 0.18, 72 + i, 0.08, (i / Math.max(1, p.word.length - 1)) * 1.2 - 0.6);
  },
  hits: () => [{ at: 0, shake: 8, punch: 0.02 }],
});
