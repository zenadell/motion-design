import { z } from 'zod';
import { whoosh } from '../audio/synth';
import { fillBg, H, W } from '../core/draw';
import { clamp, DEG, E, mod, prog } from '../core/math';
import { font } from '../core/theme';
import { cap } from './_shared';
import { define } from './types';

const adv = new Map<string, { a: number[]; w: number }>();
const HL = [0, -2, 3, -1, 1, -3, 2, -4];

export default define({
  id: 'marquee',
  title: 'Weight-wave marquee',
  category: 'type',
  summary: 'The whole frame fills with tilted rows of repeating text scrolling in alternating directions; a variable-weight wave ripples through every letter, rows alternate solid/outline, a highlight band jumps rows on the 8ths, then everything collapses into a line.',
  guidance: 'A texture-rich type moment. `text` is a phrase that repeats, ending with a separator, e.g. "MOTION DESIGN / KINETIC TYPE / ".',
  label: 'TYPE',
  params: z.object({
    text: z.string().min(4).max(48).optional().describe('Repeating phrase; defaults to the brand name'),
    rotate: z.number().min(-20).max(20).default(-9),
    collapse: z.boolean().default(true).describe('Squash into a horizontal line at the end'),
  }),
  beats: { min: 1, max: 4, default: 2 },
  energy: 2,
  example: { text: 'MOTION DESIGN / KINETIC TYPE / ' },
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt;
    fillBg(g, T.bg);
    const text = p.text ?? `${c.brand.name.toUpperCase()} / ${c.brand.suffix ? c.brand.suffix.toUpperCase() + ' / ' : ''}`;
    const size = 104, rowH = 126, key = `${T.display.family}|${text}`;
    let A = adv.get(key);
    if (!A) {
      font(g, size, 900);
      const a = Array.from(text, ch => g.measureText(ch).width * 0.98);
      A = { a, w: a.reduce((s, v) => s + v, 0) };
      adv.set(key, A);
    }
    const collapse = p.collapse ? E.inExpo(prog(lt, c.dur - b(0.44), c.dur)) : 0;
    const hl = HL[clamp(Math.floor(lt / b(0.5)), 0, HL.length - 1)];
    const off = 780 * (lt + b(0.5)) + 1700 * E.outExpo(prog(lt, -b(0.5), b(1.1)));
    g.save();
    g.translate(W / 2, H / 2); g.rotate(p.rotate * DEG);
    g.scale(1 + collapse * 0.25, Math.max(0.003, 1 - collapse));
    g.textAlign = 'center';
    for (let r = -6; r <= 6; r++) {
      const y = r * rowH, dir = r & 1 ? -1 : 1, isHL = r === hl, solid = isHL || (r & 1) === 0;
      if (isHL) { g.fillStyle = T.primary; g.fillRect(-1500, y - rowH / 2, 3000, rowH); }
      let x = -1450 - mod(dir * off + r * 331, A.w), i = 0;
      while (x < 1450) {
        const j = i % text.length, ch = text[j], w = A.a[j];
        i++;
        if (ch !== ' ' && x + w > -1450) {
          font(g, size, Math.round(clamp(520 + 400 * Math.sin((x + w / 2) * 0.0042 - lt * 6.5 + r * 0.8), 100, 900) / 20) * 20);
          if (solid) { g.fillStyle = isHL ? T.dark : T.text; g.fillText(ch, x + w / 2, y + size * 0.36); }
          else { g.strokeStyle = T.text; g.lineWidth = 1.6; g.strokeText(ch, x + w / 2, y + size * 0.36); }
        }
        x += w;
      }
    }
    g.restore();
    g.textAlign = 'left';
    cap(g, c, ['VARIABLE WEIGHT WAVE', 'HIGHLIGHT ON THE 8THS'], 'bl', T.bg);
  },
  sfx(A, t0, p, c) {
    if (p.collapse) whoosh(A, t0 + c.dur - c.bt(0.5), c.bt(0.5), 0.2, -0.4, 0.4, 4000, 400);
  },
  hits: () => [{ at: 0, shake: 8, punch: 0.02 }],
});
