import { z } from 'zod';
import { clap, kick, stab, swell, tom, whoosh } from '../audio/synth';
import { blade, DIAG, drawCentered, fillBg, fitFont, glow, H, halfPlane, kern, W } from '../core/draw';
import { clamp, E, lerp, prog } from '../core/math';
import { font } from '../core/theme';
import { cap, tone, type Tone } from './_shared';
import { define } from './types';

const STYLES = ['split', 'diagonal', 'weight', 'serif', 'rise', 'stack', 'anticipate', 'solid'] as const;
type Style = (typeof STYLES)[number];
const CYCLE: Style[] = ['split', 'diagonal', 'weight', 'rise', 'stack', 'serif', 'solid'];
const DEFAULT_TONE: Record<Style, Tone> = {
  split: 'brand', diagonal: 'dark', weight: 'light', serif: 'dark', rise: 'light', stack: 'brand', anticipate: 'dark', solid: 'dark',
};

export default define({
  id: 'word-cuts',
  title: 'Word cuts',
  category: 'intro',
  summary: 'A short statement delivered one word per slot, hard-cutting on the beat. Every word gets a different typographic treatment (blade split, diagonal slide, weight grow, serif italic, mask rise, outline stack, anticipation squeeze).',
  guidance: 'Best as the hook right after blade-open: 3–5 punchy words, 0.5 beats per word (8th notes). Use "anticipate" on a word right before a big impact section.',
  label: 'INTRO',
  params: z.object({
    words: z.array(z.string().min(1).max(14)).min(1).max(8),
    styles: z.array(z.enum(STYLES)).optional().describe('Per-word style; defaults cycle through the list'),
    tones: z.array(z.enum(['dark', 'light', 'brand'])).optional().describe('Per-word background tone'),
  }),
  beats: { min: 0.5, max: 8, default: 1.5 },
  energy: 0,
  example: { words: ['WE', 'BUILD', 'POWERFUL'], styles: ['split', 'diagonal', 'weight'] },
  draw(g, lt, p, c) {
    const T = c.theme;
    const n = p.words.length, slot = c.dur / n;
    const i = clamp(Math.floor(lt / slot), 0, n - 1);
    const u = clamp((lt - i * slot) / slot, 0, 1);
    const style = p.styles?.[i] ?? CYCLE[i % CYCLE.length];
    const tn = tone(c, p.tones?.[i] ?? DEFAULT_TONE[style]);
    const word = p.words[i];
    const target = W * Math.min(0.88, 0.22 + 0.085 * word.length);
    const size = Math.min(fitFont(g, word, target, 800), 620);
    const fam = T.display.family.toUpperCase();
    fillBg(g, tn.bg);

    if (style === 'split') {
      font(g, size, 800);
      g.fillStyle = tn.fg;
      const s = lerp(1.18, 1, E.outExpo(prog(u, 0, 0.8)));
      g.save(); g.translate(W / 2, H / 2); g.scale(s, s); drawCentered(g, word, 0, 0); g.restore();
      const off = E.outExpo(prog(u, 0, 0.84)) * 1500;
      if (off < 1450)
        for (const sg of [-1, 1]) {
          g.save(); halfPlane(g, sg, off); g.fillStyle = T.bg; g.fill(); g.restore();
          blade(g, W / 2 + Math.SQRT1_2 * off * sg, H / 2 + Math.SQRT1_2 * off * sg, 3000, 0.9 * (1 - prog(u, 0, 0.8)));
        }
      cap(g, c, [fam, 'WEIGHT 800'], 'bl', tn.bg);
    } else if (style === 'diagonal') {
      glow(g, W * 0.7, H * 0.8, 900, T.primary, 0.18);
      font(g, size, 800);
      const K = kern(g, word, -size * 0.02), capH = g.measureText(word[0]).actualBoundingBoxAscent;
      const x0 = W / 2 - K.total / 2, base = H / 2 + capH / 2;
      g.fillStyle = tn.fg;
      for (let k = 0; k < word.length; k++) {
        const q = E.outExpo(prog(u, k * 0.08, k * 0.08 + 0.64)), d = (1 - q) * 700;
        g.fillText(word[k], x0 + K.xs[k] - DIAG[0] * d, base - DIAG[1] * d);
      }
      cap(g, c, ['ALONG THE DIAGONAL', '45° ENTRY'], 'bl', tn.bg);
    } else if (style === 'weight') {
      const q = E.outExpo(prog(u, 0, 0.8)), w = lerp(200, 800, q);
      font(g, size, w);
      g.letterSpacing = `${lerp(size * 0.14, -size * 0.02, q)}px`;
      g.fillStyle = tn.fg;
      g.save(); g.translate(W / 2, H / 2); const s = lerp(0.9, 1, q); g.scale(s, s); drawCentered(g, word, 0, 0); g.restore();
      g.letterSpacing = '0px';
      cap(g, c, ['VARIABLE WEIGHT', `WGHT ${Math.round(w)}`], 'bl', tn.bg);
    } else if (style === 'serif') {
      const q = E.outExpo(prog(u, 0, 0.88));
      const role = T.serif ? 'serif' : 'display';
      const ss = Math.min(fitFont(g, word, target, role === 'serif' ? 400 : 200, role, true), 900);
      g.save(); g.translate(W / 2, H / 2 + 10); const s = lerp(1.28, 1, q); g.scale(s, s); g.rotate(lerp(-0.12, 0, q));
      font(g, ss, role === 'serif' ? 400 : 200, role, true); g.fillStyle = tn.fg; drawCentered(g, word, 0, 0);
      g.restore();
      cap(g, c, [(T.serif ?? T.display).family.toUpperCase(), 'ITALIC'], 'bl', tn.bg);
    } else if (style === 'rise') {
      font(g, size, 800);
      const K = kern(g, word, -size * 0.02), capH = g.measureText(word[0]).actualBoundingBoxAscent;
      const base = H / 2 + capH / 2, x0 = W / 2 - K.total / 2;
      g.save(); g.beginPath(); g.rect(0, base - capH - 24, W, capH + 48); g.clip();
      g.fillStyle = tn.fg;
      for (let k = 0; k < word.length; k++) {
        const q = E.outExpo(prog(u, k * 0.088, k * 0.088 + 0.68));
        g.fillText(word[k], x0 + K.xs[k], base + (1 - q) * capH * 1.25);
      }
      g.restore();
      cap(g, c, [fam, 'MASK RISE'], 'bl', tn.bg);
    } else if (style === 'stack') {
      const ss = Math.min(fitFont(g, word, W * 0.94, 800), 520);
      font(g, ss, 800);
      g.letterSpacing = `${-ss * 0.02}px`;
      const capH = g.measureText(word).actualBoundingBoxAscent, rowH = capH * 1.1;
      const scroll = (1 - E.outExpo(prog(u, 0, 0.96))) * rowH * 2.6, skew = -0.38 * (1 - E.outExpo(prog(u, 0, 0.8)));
      g.save(); g.translate(W / 2, H / 2); g.transform(1, 0, skew, 1, 0, 0);
      g.strokeStyle = tn.fg; g.fillStyle = tn.fg; g.lineWidth = 4; g.lineJoin = 'round';
      for (let k = -3; k <= 3; k++) drawCentered(g, word, 0, k * rowH + scroll, k !== 0);
      g.restore(); g.letterSpacing = '0px';
      cap(g, c, ['OUTLINE STACK', 'SKEW −21°'], 'bl', tn.bg);
    } else if (style === 'anticipate') {
      const ss = Math.min(fitFont(g, word, W * 0.6, 800), 520);
      const q = E.inCubic(u), w = lerp(800, 360, q);
      g.save(); g.translate(W / 2 + Math.sin(lt * 190) * q * 7, H / 2 + Math.cos(lt * 160) * q * 7);
      const s = lerp(1, 0.8, q); g.scale(s, s);
      font(g, ss, w); g.letterSpacing = `${lerp(0, ss * 0.08, q)}px`; g.fillStyle = tn.fg; drawCentered(g, word, 0, 0);
      g.restore(); g.letterSpacing = '0px';
      cap(g, c, ['ANTICIPATION', `WGHT ${Math.round(w)}`], 'bl', tn.bg);
    } else {
      const q = E.outExpo(prog(u, 0, 0.6));
      font(g, size, 800); g.fillStyle = tn.fg;
      g.save(); g.translate(W / 2, H / 2); const s = lerp(1.3, 1, q); g.scale(s, s); drawCentered(g, word, 0, 0); g.restore();
      cap(g, c, [fam, 'SLAM'], 'bl', tn.bg);
    }
  },
  sfx(A, t0, p, c) {
    const n = p.words.length, slot = c.dur / n;
    for (let i = 0; i < n; i++) {
      const at = t0 + i * slot, ch = c.music.chordAt(at);
      const style = p.styles?.[i] ?? CYCLE[i % CYCLE.length];
      const top = (ch.pad[3] ?? ch.pad[0] + 12) + [0, 2, 4, 5, 7, 9, 11, 12][i % 8];
      if (style === 'anticipate') {
        tom(A, at, ch.bass + 12, 0.45);
        swell(A, at + slot * 0.2, at + slot, 0.22);
      } else {
        kick(A, at, i === 0 ? 0.9 : 0.8);
        clap(A, at, 0.2 + 0.06 * i);
      }
      stab(A, at, [...ch.pad.slice(0, 3), top], 0.085, Math.min(0.25, slot * 0.9), 3400);
      if (style === 'split') whoosh(A, at, slot * 0.9, 0.2, -0.6, 0.6, 1200, 4000);
    }
  },
  hits: (p, c) => p.words.map((_, i) => ({ at: (i * c.dur) / p.words.length, shake: i ? 10 : 12 })),
});
