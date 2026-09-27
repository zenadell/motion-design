import { z } from 'zod';
import { blip, impact, kick, shaker, stab } from '../audio/synth';
import { rgba } from '../core/color';
import { drawCentered, fillBg, fitFont, glow, H, W } from '../core/draw';
import { rnd, pulse } from '../core/math';
import { font } from '../core/theme';
import { beatPulse, cap, scratchLayer } from './_shared';
import { define } from './types';

export default define({
  id: 'glitch-word',
  title: 'Glitch impact word',
  category: 'type',
  summary: 'One huge word slams in with RGB split and horizontal slice-glitches that re-shuffle on every 16th note, over scanlines and a glow. Reads as "digital / software / tech".',
  guidance: 'Use for the payoff word of a hook (e.g. SIGNAL, DIGITAL, LIVE). 2 beats. A "blade" transition out of it looks great.',
  label: 'INTRO',
  params: z.object({
    word: z.string().min(1).max(12),
    tag: z.string().max(28).optional().describe('Small code-style tag above the word, e.g. "<Software />"'),
  }),
  beats: { min: 1, max: 4, default: 2 },
  energy: 0,
  example: { word: 'SIGNAL', tag: '<Signal />' },
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt;
    fillBg(g, T.bg);
    glow(g, W / 2, H / 2 + 60, 1000, T.primary, 0.2 + 0.25 * pulse(lt, 0, 4) + 0.15 * beatPulse(lt, c));
    const size = fitFont(g, p.word, W * Math.min(0.88, 0.14 + 0.095 * p.word.length), 800);
    const wgt = lt >= b(1) && lt < b(1.24) ? 260 : 800;
    const [L, gl] = scratchLayer();
    gl.setTransform(1, 0, 0, 1, 0, 0);
    gl.clearRect(0, 0, W, H);
    font(gl, size, wgt);
    const lp = Math.max(0, lt);
    const split = 30 * Math.exp(-lp * 6) + 22 * pulse(lt, b(1), 10) + 10 * pulse(lt, b(0.5), 12);
    gl.globalCompositeOperation = 'lighter';
    gl.fillStyle = rgba(T.secondary, 0.9); drawCentered(gl, p.word, W / 2 - split, H / 2);
    gl.fillStyle = rgba('#5AA0FF', 0.55); drawCentered(gl, p.word, W / 2 + split, H / 2);
    gl.globalCompositeOperation = 'source-over';
    gl.fillStyle = T.primary; drawCentered(gl, p.word, W / 2, H / 2);
    const sc = 1 + 0.16 * Math.exp(-9 * lp) * Math.cos(Math.PI * 4.8 * lp) + 0.05 * pulse(lt, b(1), 10);
    const k16 = Math.floor(lt / b(0.25)) + 1;
    const amt = Math.exp(-lp * 5) + 0.8 * pulse(lt, b(0.5), 9) + 0.9 * pulse(lt, b(1), 8) + 0.5 * pulse(lt, b(1.25), 10);
    const n = 22, sh = H / n;
    g.save(); g.translate(W / 2, H / 2); g.scale(sc, sc); g.translate(-W / 2, -H / 2);
    for (let j = 0; j < n; j++) {
      const big = rnd(k16, j + 50) > 0.62 ? 1 : 0.12;
      g.drawImage(L, 0, j * sh, W, sh + 1, (rnd(k16, j) - 0.5) * 260 * amt * big, j * sh, W, sh + 1);
    }
    g.restore();
    g.fillStyle = 'rgba(0,0,0,.18)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    if (p.tag) {
      font(g, 26, 500, 'mono'); g.fillStyle = T.muted; g.letterSpacing = '2px';
      g.fillText(p.tag, 110, 250);
      if (Math.floor(lt / b(0.25)) % 2) g.fillRect(110 + g.measureText(p.tag).width + 8, 228, 14, 26);
      g.letterSpacing = '0px';
    }
    cap(g, c, ['RGB SPLIT · SLICE GLITCH', 'ON THE 16THS'], 'bl', T.bg);
  },
  sfx(A, t0, _p, c) {
    const b = c.bt, ch = c.music.chordAt(t0);
    kick(A, t0, 1);
    impact(A, t0, 0.9);
    stab(A, t0, [ch.bass, ch.bass + 12, ...ch.pad], 0.1, 0.9, 2400);
    for (let i = 0; i < 8; i++) blip(A, t0 + b(0.125) * (i + 0.5), 84 + Math.floor(Math.abs(Math.sin(i * 7.1)) * 12), 0.035, (i % 2 ? 0.6 : -0.6));
    kick(A, t0 + b(0.5), 0.55);
    kick(A, t0 + b(1), 0.8);
    stab(A, t0 + b(1), ch.pad.slice(0, 4), 0.07, 0.18, 3000);
    for (let k = 0; k < 4; k++) shaker(A, t0 + b(1) + b(0.25) * k, 0.04 + k * 0.02);
  },
  hits: (_p, c) => [{ at: 0, shake: 30, punch: 0.06 }, { at: c.bt(1), shake: 12, punch: 0.05 }],
});
