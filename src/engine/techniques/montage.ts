import { z } from 'zod';
import { marimba } from '../audio/synth';
import { readableOn } from '../core/color';
import { drawCentered, fillBg, fitFont, H, W } from '../core/draw';
import { clamp, E, lerp, pad2, prog } from '../core/math';
import { font } from '../core/theme';
import { cap, chordTones } from './_shared';
import { define, type Ctx } from './types';

interface Style { bg: string; fg: string; w: number; skew?: number; outline?: boolean; track?: number; stack?: boolean }
function styles(c: Ctx): Style[] {
  const T = c.theme;
  return [
    { bg: T.primary, fg: readableOn(T.primary, T.light, T.dark), w: 800 },
    { bg: T.bg, fg: T.text, w: 200 },
    { bg: T.light, fg: T.dark, w: 800, skew: -0.22 },
    { bg: T.secondary, fg: readableOn(T.secondary, T.light, T.dark), w: 800, outline: true },
    { bg: T.surface, fg: T.primary, w: 800 },
    { bg: T.light, fg: T.primary, w: 500, track: 0.14 },
    { bg: T.bg, fg: T.text, w: 800, stack: true },
    { bg: T.primary, fg: T.light, w: 800 },
  ];
}

export default define({
  id: 'montage',
  title: 'Rapid-fire montage',
  category: 'data',
  summary: 'Project or client names flash one per 16th note, each in a different colourway and typographic treatment (thin, italic skew, outline, tracked-out, stacked echo) with index and category labels — a whole portfolio in a second.',
  guidance: '6–10 short names (≤ 14 chars). Default is one name per 0.25 beats; set `every` to 0.5 for a calmer pace.',
  label: 'WORK',
  params: z.object({
    items: z.array(z.object({ title: z.string().min(1).max(16), tag: z.string().max(28).optional() })).min(2).max(12),
    every: z.number().min(0.125).max(1).default(0.25).describe('Beats per item'),
    kicker: z.string().max(24).default('SELECTED WORK'),
  }),
  beats: { min: 1, max: 8, default: 2 },
  energy: 1,
  example: { items: [{ title: 'ATLAS', tag: 'Fintech app' }, { title: 'KESTREL', tag: 'Brand system' }, { title: 'LUMEN', tag: 'AI assistant' }, { title: 'ORBIT', tag: 'E-commerce' }] },
  draw(g, lt, p, c) {
    const n = p.items.length, i = clamp(Math.floor(lt / c.bt(p.every)), 0, n - 1), it = lt - i * c.bt(p.every);
    const st = styles(c)[i % 8], name = p.items[i].title;
    fillBg(g, st.bg);
    const size = Math.min(430, fitFont(g, name, W * (st.track ? 0.7 : 0.84), st.w));
    font(g, size, st.w);
    g.letterSpacing = st.track ? `${size * st.track}px` : '0px';
    const s = lerp(1.08, 1, E.outExpo(prog(it, 0, 0.1)));
    g.save(); g.translate(W / 2, H / 2); g.scale(s, s);
    if (st.skew) g.transform(1, 0, st.skew, 1, 0, 0);
    g.fillStyle = st.fg; g.strokeStyle = st.fg; g.lineWidth = 4;
    if (st.stack) {
      for (let k = -2; k <= 2; k++) { g.globalAlpha = k ? 0.35 : 1; drawCentered(g, name, 0, k * size * 0.78, k !== 0); }
      g.globalAlpha = 1;
    } else drawCentered(g, name, 0, 0, !!st.outline);
    g.restore();
    g.letterSpacing = '0px';
    cap(g, { ...c, captions: true }, [p.kicker], 'tl', st.bg);
    cap(g, { ...c, captions: true }, [`${pad2(i + 1)} / ${pad2(n)}`], 'tr', st.bg);
    if (p.items[i].tag) cap(g, { ...c, captions: true }, [p.items[i].tag!], 'bl', st.bg);
  },
  sfx(A, t0, p, c) {
    const notes = chordTones(c.music.chordAt(t0).pad, 61, p.items.length);
    p.items.forEach((_, i) => marimba(A, t0 + c.bt(i * p.every), notes[i], 0.1, i % 2 ? 0.45 : -0.45));
  },
  hits: () => [{ at: 0, shake: 12, punch: 0.03 }],
});
