import { z } from 'zod';
import { impact, kick, shing, stab } from '../audio/synth';
import { blade, DIAG, fillBg, glow, H, NORM, W } from '../core/draw';
import { E, prog, pulse, rnd } from '../core/math';
import { define } from './types';

export default define({
  id: 'blade-open',
  title: 'Blade open',
  category: 'intro',
  summary: 'A white-hot diagonal light blade strikes across a dark frame with sparks and a brand-colour flash. The strongest possible first frame.',
  guidance: 'Use as the very first section (0.5 beats). Follow it with word-cuts whose first style is "split" so the blade splits the screen open.',
  label: 'INTRO',
  params: z.object({
    sparks: z.number().int().min(0).max(120).default(44),
  }),
  beats: { min: 0.5, max: 2, default: 0.5 },
  energy: 0,
  example: {},
  draw(g, lt, p, c) {
    const T = c.theme;
    fillBg(g, T.bg);
    const k = E.outExpo(prog(lt, 0, c.bt(0.24)));
    glow(g, W / 2, H / 2, 900, T.primary, 0.35 * pulse(lt, 0, 5));
    blade(g, W / 2, H / 2, 2700 * k, 1);
    g.save();
    g.globalCompositeOperation = 'lighter';
    const sp = E.outExpo(prog(lt, 0, c.bt(0.6)));
    for (let i = 0; i < p.sparks; i++) {
      const s = i % 2 ? 1 : -1, along = (rnd(i, 1) - 0.5) * 1600, d = sp * (200 + rnd(i, 2) * 900);
      g.globalAlpha = 1 - prog(lt, c.bt(0.1), c.bt(0.5));
      g.fillStyle = i % 3 ? T.secondary : '#FFFFFF';
      g.fillRect(W / 2 + DIAG[0] * along + NORM[0] * d * s - 2, H / 2 + DIAG[1] * along + NORM[1] * d * s - 2, 4, 4);
    }
    g.restore();
    g.globalAlpha = 0.45 * pulse(lt, 0, 16);
    fillBg(g, T.primary);
    g.globalAlpha = 1;
  },
  sfx(A, t0, _p, c) {
    const ch = c.music.chordAt(t0);
    kick(A, t0, 1);
    impact(A, t0, 0.95);
    shing(A, t0, 0.26);
    stab(A, t0, [ch.bass + 12, ...ch.pad.slice(0, 4)], 0.1, 0.5, 2600);
  },
  hits: () => [{ at: 0, shake: 28, punch: 0.04 }],
  fast: (_p, c) => [[0, c.bt(0.2)]],
});
