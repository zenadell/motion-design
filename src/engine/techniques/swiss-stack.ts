import { z } from 'zod';
import { whoosh } from '../audio/synth';
import { fillBg, fitFont, W } from '../core/draw';
import { E, prog } from '../core/math';
import { font } from '../core/theme';
import { cap, tone } from './_shared';
import { define } from './types';

export default define({
  id: 'swiss-stack',
  title: 'Swiss stack',
  category: 'type',
  summary: 'Two to four big lines stack in on the 8ths from alternating sides, each with a numbered rule, Swiss-poster style; then one line gets a solid highlight bar.',
  guidance: 'Good for a phrase like "SOLUTIONS / THAT / TRANSFORM". Keep each line ≤ 12 characters. On brand tone it is a strong colour moment.',
  label: 'TYPE',
  params: z.object({
    lines: z.array(z.string().min(1).max(14)).min(2).max(4),
    highlight: z.number().int().min(0).max(3).optional().describe('Line index to highlight (default: last)'),
    tone: z.enum(['brand', 'light', 'dark']).default('brand'),
  }),
  beats: { min: 1.5, max: 4, default: 2 },
  energy: 2,
  example: { lines: ['SOLUTIONS', 'THAT', 'TRANSFORM'] },
  draw(g, lt, p, c) {
    const b = c.bt, tn = tone(c, p.tone), n = p.lines.length;
    fillBg(g, tn.bg);
    const gap = n === 4 ? 205 : 230;
    const longest = p.lines.reduce((a, s) => (s.length > a.length ? s : a), '');
    const size = Math.min(n === 4 ? 180 : 205, fitFont(g, longest, W - 360, 800));
    const top = 540 - ((n - 1) * gap) / 2 + size * 0.36;
    const hi = p.highlight ?? n - 1;
    for (let i = 0; i < n; i++) {
      const q = E.outExpo(prog(lt, b(i * 0.5), b(i * 0.5 + 0.48)));
      if (q <= 0) continue;
      const y = top + i * gap, dx = (1 - q) * (i % 2 ? 1 : -1) * 1500;
      font(g, size, 800); g.fillStyle = tn.fg; g.fillText(p.lines[i], 110 + dx, y);
      g.fillRect(110, y + 48, (W - 220) * q, 3);
      font(g, 22, 600, 'mono'); g.textAlign = 'right'; g.fillText(`0${i + 1}`, W - 110, y - size * 0.62); g.textAlign = 'left';
      if (i === hi) {
        const hp = E.outExpo(prog(lt, b(1.5), b(1.9)));
        if (hp > 0) {
          font(g, size, 800);
          const tw = g.measureText(p.lines[i]).width;
          g.save(); g.beginPath(); g.rect(90, y - size * 0.82, (tw + 60) * hp, size * 0.98); g.clip();
          g.fillStyle = tn.fg; g.fillRect(90, y - size * 0.82, tw + 60, size * 0.98);
          g.fillStyle = tn.bg; g.fillText(p.lines[i], 110, y);
          g.restore();
        }
      }
    }
    cap(g, c, ['SWISS STACK', 'ALTERNATING ENTRIES'], 'tr', tn.bg);
  },
  sfx(A, t0, p, c) {
    p.lines.forEach((_, i) => whoosh(A, t0 + c.bt(i * 0.5) - 0.06, 0.24, 0.18, i % 2 ? 0.8 : -0.8, 0, 900, 3500));
  },
  hits: (p, c) => p.lines.map((_, i) => ({ at: c.bt(i * 0.5), shake: i ? 4 : 8 })),
});
