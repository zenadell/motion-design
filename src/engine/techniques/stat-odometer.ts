import { z } from 'zod';
import { blip, clap, riser } from '../audio/synth';
import { blade, caption, fillBg, glow, H, starPath, W } from '../core/draw';
import { E, prog } from '../core/math';
import { font } from '../core/theme';
import { beatPulse } from './_shared';
import { define } from './types';

export default define({
  id: 'stat-odometer',
  title: 'Stat odometer',
  category: 'data',
  summary: 'A big number rolls up digit-by-digit like an odometer, star ratings pop in on the 32nds, with a caption; optionally the brand blade grows across the frame at the end to build tension into the next section.',
  guidance: 'Use real numbers only (rating, clients, years, uptime). `value` like "4.9", "120+", "98%". Put it right before the logo reveal with tension on and energy 3 (the music builds and drops out).',
  label: 'PROOF',
  params: z.object({
    value: z.string().min(1).max(6).regex(/\d/, 'must contain at least one digit'),
    stars: z.number().int().min(0).max(5).default(0),
    label: z.string().max(40),
    tension: z.boolean().default(true),
  }),
  beats: { min: 1, max: 4, default: 2 },
  energy: 1,
  example: { value: '4.9', stars: 5, label: 'Trusted by businesses globally' },
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt;
    fillBg(g, T.bg);
    glow(g, W / 2, H / 2, 900, T.primary, 0.2 + 0.1 * beatPulse(lt, c));
    const ts = p.tension ? c.dur - b(1) : c.dur;
    const out = E.inCubic(prog(lt, ts, c.dur - b(0.12)));
    g.save(); g.globalAlpha = 1 - out; g.translate(W / 2, H / 2); g.scale(1 - out * 0.4, 1 - out * 0.4); g.translate(-W / 2, -H / 2);
    const rp = E.outExpo(prog(lt, 0, b(0.72))), size = p.value.length > 4 ? 280 : 360;
    font(g, size, 800);
    const dw = g.measureText('0').width;
    const widths = [...p.value].map(ch => (/\d/.test(ch) ? dw : g.measureText(ch).width));
    const base = p.stars ? 560 : 600;
    let x = W / 2 - widths.reduce((a, v) => a + v, 0) / 2;
    g.save(); g.beginPath(); g.rect(0, base - size * 0.8, W, size * 0.86); g.clip();
    g.fillStyle = T.primary;
    [...p.value].forEach((ch, i) => {
      if (/\d/.test(ch)) {
        const v = Number(ch) * rp, d0 = Math.floor(v), f = v - d0;
        g.fillText(String(d0 % 10), x, base - f * size * 0.86);
        g.fillText(String((d0 + 1) % 10), x, base + (1 - f) * size * 0.86);
      } else g.fillText(ch, x, base);
      x += widths[i];
    });
    g.restore();
    for (let k = 0; k < p.stars; k++) {
      const sp = E.outBack(prog(lt, b(k * 0.125), b(k * 0.125 + 0.32)), 2.2), cx = W / 2 + (k - (p.stars - 1) / 2) * 82;
      starPath(g, cx, base + 110, 30); g.strokeStyle = T.muted; g.lineWidth = 2; g.stroke();
      if (sp > 0) { g.save(); g.translate(cx, base + 110); g.scale(sp, sp); g.translate(-cx, -(base + 110)); starPath(g, cx, base + 110, 30); g.fillStyle = T.primary; g.fill(); g.restore(); }
    }
    caption(g, [p.label], W / 2, base + (p.stars ? 210 : 110), T.muted, 'center', 20);
    g.restore();
    if (p.tension) {
      const bl = E.inCubic(prog(lt, ts, c.dur - b(0.12)));
      if (bl > 0) blade(g, W / 2, H / 2, 2700 * bl, 0.35 + 0.65 * bl);
      if (lt > c.dur - b(0.12)) fillBg(g, T.bg);
    }
  },
  sfx(A, t0, p, c) {
    const b = c.bt;
    for (let k = 0; k < p.stars; k++) blip(A, t0 + b(k * 0.125), 89 + k * 2, 0.045);
    if (p.tension && c.energy !== 3) {
      const e = t0 + c.dur;
      [1, 0.75, 0.5, 0.375, 0.25, 0.1875].forEach((o, i) => clap(A, e - b(o), 0.12 + i * 0.05));
      riser(A, e - b(1.6), e - b(0.12), 0.26);
    }
  },
  hits: () => [{ at: 0, shake: 8 }],
});
