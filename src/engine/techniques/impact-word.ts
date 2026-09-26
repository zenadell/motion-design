import { z } from 'zod';
import { crash, kick, pluck, stab, sub, swell, tom } from '../audio/synth';
import { drawCentered, fillBg, fitFont, H, kern, W } from '../core/draw';
import { E, hop, lerp, prog, pulse, rnd, TAU } from '../core/math';
import { font } from '../core/theme';
import { cap } from './_shared';
import { define } from './types';

export default define({
  id: 'impact-word',
  title: 'Impact word',
  category: 'type',
  summary: 'An anticipation squeeze on dark, then the word explodes onto the accent colour with shockwave rings, flying debris, RGB-multiply split, a letter bounce and a variable-weight flip.',
  guidance: 'The loudest moment of a hook (e.g. MOVE, GO, LAUNCH). 2–3 beats. Short words (≤ 6 letters) look best.',
  label: 'INTRO',
  params: z.object({
    word: z.string().min(1).max(10),
    anticipate: z.boolean().default(true).describe('Start with a 0.5-beat squeeze on a dark frame'),
  }),
  beats: { min: 1.5, max: 4, default: 2.5 },
  energy: 0,
  example: { word: 'MOVE' },
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt;
    const ta = p.anticipate ? b(0.5) : 0;
    if (lt < ta) {
      fillBg(g, T.bg);
      const size = Math.min(fitFont(g, p.word, W * 0.6, 800), 520);
      const q = E.inCubic(prog(lt, 0, ta));
      g.save(); g.translate(W / 2 + Math.sin(lt * 190) * q * 7, H / 2 + Math.cos(lt * 160) * q * 7);
      const s = lerp(1, 0.8, q); g.scale(s, s);
      font(g, size, lerp(800, 360, q)); g.letterSpacing = `${lerp(0, size * 0.08, q)}px`;
      g.fillStyle = T.text; drawCentered(g, p.word, 0, 0);
      g.restore(); g.letterSpacing = '0px';
      cap(g, c, ['ANTICIPATION', `WGHT ${Math.round(lerp(800, 360, q))}`], 'bl', T.bg);
      return;
    }
    const it = lt - ta;
    fillBg(g, T.accent);
    g.strokeStyle = T.dark;
    for (let k = 0; k < 3; k++) {
      const q = prog(it, k * 0.07, k * 0.07 + 0.75);
      if (q <= 0 || q >= 1) continue;
      g.globalAlpha = 1 - q; g.lineWidth = lerp(52, 0.5, E.outCubic(q));
      g.beginPath(); g.arc(W / 2, H / 2, E.outExpo(q) * 1500, 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;
    const dp = E.outExpo(prog(it, 0, 0.9)), da = 1 - prog(it, 0.35, 0.9);
    if (da > 0)
      for (let i = 0; i < 30; i++) {
        const a = rnd(i, 3) * TAU, d = 140 + dp * (500 + rnd(i, 5) * 1300), sz = lerp(26, 6, dp) * (0.5 + rnd(i, 7));
        g.globalAlpha = da; g.fillStyle = [T.dark, T.primary, T.secondary][i % 3];
        g.save(); g.translate(W / 2 + Math.cos(a) * d, H / 2 + Math.sin(a) * d * 0.8); g.rotate(a + it * 8 * (rnd(i, 2) - 0.5));
        g.beginPath();
        if (i % 3 === 0) g.rect(-sz / 2, -sz / 2, sz, sz);
        else if (i % 3 === 1) g.arc(0, 0, sz / 2, 0, TAU);
        else { g.moveTo(0, -sz * 0.6); g.lineTo(sz * 0.55, sz * 0.4); g.lineTo(-sz * 0.55, sz * 0.4); g.closePath(); }
        g.fill(); g.restore();
      }
    g.globalAlpha = 1;
    const size = Math.min(fitFont(g, p.word, W * 0.86, 800), 640);
    const flipAt = b(1), wgt = it >= flipAt ? lerp(140, 800, E.outCubic(prog(it, flipAt, flipAt + b(0.48)))) : 800;
    const sc = 1 + 0.24 * Math.exp(-9 * it) * Math.cos(TAU * 2.6 * it) + 0.07 * pulse(it, flipAt, 10);
    const split = 46 * Math.exp(-7 * it) + 26 * pulse(it, flipAt, 9) + 12 * pulse(it, b(0.5), 12);
    font(g, size, wgt);
    const K = kern(g, p.word, -size * 0.015), capH = g.measureText(p.word[0]).actualBoundingBoxAscent;
    g.save(); g.translate(W / 2, H / 2); g.scale(sc, sc);
    const x0 = -K.total / 2, base = capH / 2;
    const word = (col: string, dx: number) => {
      g.fillStyle = col;
      for (let i = 0; i < p.word.length; i++) g.fillText(p.word[i], x0 + K.xs[i] + dx, base - hop(it, b(0.5) + i * 0.035, 0.2) * 95);
    };
    g.globalCompositeOperation = 'multiply';
    word(T.primary, -split); word(T.secondary, split);
    g.globalCompositeOperation = 'source-over';
    word(T.dark, 0);
    g.restore();
    cap(g, c, ['IMPACT FRAME', 'SQUASH · SPLIT · SHOCKWAVE'], 'bl', T.accent);
  },
  sfx(A, t0, p, c) {
    const b = c.bt, ch = c.music.chordAt(t0), ta = t0 + (p.anticipate ? b(0.5) : 0);
    if (p.anticipate) { tom(A, t0, ch.bass + 12, 0.45); swell(A, t0 + b(0.1), ta, 0.22); }
    kick(A, ta, 1); sub(A, ta, 0.85, 1.2); crash(A, ta, 0.3, 2.2);
    stab(A, ta, [ch.bass, ch.bass + 12, ...ch.pad], 0.11, 0.9, 2400);
    pluck(A, ta + b(0.5), ch.pad[ch.pad.length - 1] + 12, 0.07, -0.3);
    pluck(A, ta + b(0.75), ch.pad[ch.pad.length - 1] + 15, 0.06, 0.3);
    kick(A, ta + b(1), 0.75);
    pluck(A, ta + b(1), ch.pad[ch.pad.length - 1] + 17, 0.07, 0);
  },
  hits: (p, c) => {
    const ta = p.anticipate ? c.bt(0.5) : 0;
    return [{ at: ta, shake: 34, punch: 0.06 }, { at: ta + c.bt(1), shake: 10 }];
  },
  fast: (p, c) => (p.anticipate ? [[c.bt(0.5) - 0.02, c.bt(0.5) + 0.12]] : [[0, 0.12]]),
});
