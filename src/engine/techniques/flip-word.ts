import { z } from 'zod';
import { clave, riser, stab, swell } from '../audio/synth';
import { fillBg, fitFont, glow, H, kern, W } from '../core/draw';
import { E, lerp, prog } from '../core/math';
import { font } from '../core/theme';
import { beatPulse, cap } from './_shared';
import { define } from './types';

export default define({
  id: 'flip-word',
  title: 'Card-flip word + fly-through',
  category: 'type',
  summary: 'Letters of a big word card-flip one after another on the 32nds, changing colour as they turn; a sub-line slams in underneath; then the camera flies through one letter (e.g. the counter of an "O") into the next scene.',
  guidance: 'Ideal as the last type beat before a scene change (e.g. MOMENTUM / BY DESIGN.). Words containing O, D, Q, A or B make the best fly-through.',
  label: 'TYPE',
  params: z.object({
    word: z.string().min(2).max(12),
    subline: z.string().max(20).optional(),
    zoomChar: z.number().int().min(0).max(11).optional().describe('Index of the letter to fly through (default: first O, else middle)'),
    zoom: z.boolean().default(true),
  }),
  beats: { min: 1.5, max: 4, default: 2 },
  energy: 2,
  example: { word: 'MOMENTUM', subline: 'BY DESIGN.' },
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt;
    fillBg(g, T.bg);
    glow(g, W / 2, H / 2, 900, T.primary, 0.12 + 0.12 * beatPulse(lt, c));
    const word = p.word, size = Math.min(fitFont(g, word, W * 0.82, 800), 460);
    font(g, size, 800);
    const K = kern(g, word, -size * 0.01), capH = g.measureText(word[0]).actualBoundingBoxAscent;
    const x0 = W / 2 - K.total / 2, base = 540 + capH / 2 - (p.subline ? 60 : 0);
    const zi = p.zoomChar ?? (word.toUpperCase().indexOf('O') >= 0 ? word.toUpperCase().indexOf('O') : Math.floor(word.length / 2));
    const m = g.measureText(word[zi] ?? word[0]);
    const ox = x0 + K.xs[zi] + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    const oy = base - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    const zs = c.dur - b(0.56);
    const z = p.zoom ? 1 + E.inExpo(prog(lt, zs, c.dur - 0.005)) * 70 : 1;
    g.save(); g.translate(ox, oy); g.scale(z, z); g.translate(-ox, -oy);
    for (let i = 0; i < word.length; i++) {
      const tf = b(i * 0.125), a = Math.PI * E.inOutCubic(prog(lt, tf, tf + b(0.36)));
      const cx = x0 + K.xs[i] + K.ws[i] / 2;
      g.save(); g.translate(cx, base); g.scale(Math.max(0.02, Math.abs(Math.cos(a))), 1);
      g.fillStyle = a < Math.PI / 2 ? T.text : T.primary;
      g.fillText(word[i], -K.ws[i] / 2, 0);
      g.restore();
    }
    if (p.subline) {
      const bp = E.outExpo(prog(lt, b(1), b(1.44)));
      if (bp > 0) {
        const ss = Math.min(118, fitFont(g, p.subline, W * 0.62, 800));
        font(g, ss, lerp(200, 800, bp)); g.letterSpacing = `${lerp(40, 6, bp)}px`;
        g.fillStyle = T.text; g.textAlign = 'center';
        g.fillText(p.subline, W / 2, base + 190 + (1 - bp) * 60);
        g.textAlign = 'left'; g.letterSpacing = '0px';
      }
    }
    g.restore();
    if (lt < zs) cap(g, c, ['CARD FLIP ON THE 32NDS', p.zoom ? 'THEN THROUGH THE LETTER' : 'COLOUR TURN'], 'bl', T.bg);
  },
  sfx(A, t0, p, c) {
    const b = c.bt;
    for (let i = 0; i < p.word.length; i++) clave(A, t0 + b(i * 0.125), 0.05, (i / Math.max(1, p.word.length - 1)) * 1.4 - 0.7);
    const ch = c.music.chordAt(t0 + b(1));
    if (p.subline) stab(A, t0 + b(1), ch.pad.slice(0, 4), 0.07, 0.25, 3000);
    if (p.zoom) {
      riser(A, t0 + c.dur - b(1), t0 + c.dur - 0.01, 0.2);
      swell(A, t0 + c.dur - b(0.6), t0 + c.dur, 0.2);
    }
  },
  hits: () => [{ at: 0, shake: 8 }],
  fast: (p, c) => (p.zoom ? [[c.dur - c.bt(0.44), c.dur]] : []),
});
