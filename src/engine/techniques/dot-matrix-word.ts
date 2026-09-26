import { z } from 'zod';
import { blip, whoosh } from '../audio/synth';
import { fillBg, glow, makeLayer, W } from '../core/draw';
import { E, prog, pulse, rnd, TAU } from '../core/math';
import { font } from '../core/theme';
import { beatPulse, cap } from './_shared';
import { define } from './types';

const cache = new Map<string, { pts: [number, number][]; w: number; h: number }>();
function dots(word: string, family: string): { pts: [number, number][]; w: number; h: number } {
  const key = `${family}|${word}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [, g] = makeLayer(1300, 820);
  font(g, 760, 800);
  g.fillStyle = '#fff';
  g.fillText(word, 10, 760);
  const d = g.getImageData(0, 0, 1300, 820).data, pts: [number, number][] = [];
  let maxX = 0, maxY = 0;
  for (let y = 0; y < 820; y += 15)
    for (let x = 0; x < 1300; x += 15)
      if (d[(y * 1300 + x) * 4 + 3] > 128) { pts.push([x, y]); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const v = { pts, w: maxX, h: maxY };
  cache.set(key, v);
  return v;
}

export default define({
  id: 'dot-matrix-word',
  title: 'Dot-matrix word',
  category: 'type',
  summary: 'A very short word (1–3 letters, e.g. "AI") built from hundreds of glowing dots that scan in, ripple on every 8th note and flicker with neural-network links, plus an optional prefix and a suffix that slides in.',
  guidance: 'Made for AI / data / tech keywords. Keep `word` to 1–3 characters; put the rest in `suffix` (e.g. word "AI", suffix "-DRIVEN").',
  label: 'TYPE',
  params: z.object({
    word: z.string().min(1).max(3),
    prefix: z.string().max(2).optional(),
    suffix: z.string().max(12).optional(),
  }),
  beats: { min: 1, max: 4, default: 2 },
  energy: 2,
  example: { word: 'AI', prefix: '&', suffix: '-DRIVEN' },
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt;
    fillBg(g, T.bg);
    glow(g, 620, 560, 900, T.primary, 0.2 + 0.1 * beatPulse(lt, c));
    const D = dots(p.word, T.display.family);
    const ox = 150, oy = 120, e8 = Math.floor(lt / b(0.5)) * b(0.5);
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < D.pts.length; i++) {
      const [x, y] = D.pts[i];
      const ta = (x / D.w) * b(0.32) + rnd(i, 3) * 0.04;
      if (lt < ta) continue;
      const ripple = pulse(lt, e8 + (x / D.w) * 0.12, 9);
      g.fillStyle = rnd(i, Math.floor(lt * 16)) > 0.93 ? T.text : i % 5 ? T.primary : T.secondary;
      g.globalAlpha = 0.55 + 0.45 * ripple;
      g.beginPath(); g.arc(ox + x, oy + y, 4.2 + 2.2 * ripple + 3 * pulse(lt, ta, 20), 0, TAU); g.fill();
    }
    g.strokeStyle = T.secondary; g.lineWidth = 1.2;
    const k = Math.floor(lt / b(0.25));
    for (let j = 0; j < 40; j++) {
      const a = D.pts[Math.floor(rnd(k, j) * D.pts.length)], q = D.pts[Math.floor(rnd(k, j + 99) * D.pts.length)];
      if (!a || !q || Math.hypot(a[0] - q[0], a[1] - q[1]) > 260) continue;
      g.globalAlpha = 0.45 * prog(lt, b(0.2), b(0.4));
      g.beginPath(); g.moveTo(ox + a[0], oy + a[1]); g.lineTo(ox + q[0], oy + q[1]); g.stroke();
    }
    g.restore();
    if (p.prefix) {
      const ap = E.outExpo(prog(lt, 0, b(0.4)));
      font(g, 170, 200); g.fillStyle = T.secondary; g.globalAlpha = ap;
      g.fillText(p.prefix, 110, 230 - (1 - ap) * 40); g.globalAlpha = 1;
    }
    if (p.suffix) {
      const dp = E.outExpo(prog(lt, b(1), b(1.44)));
      if (dp > 0) {
        font(g, Math.min(210, (W - (ox + D.w + 110)) / Math.max(1, p.suffix.length) * 1.6), 300); g.fillStyle = T.text;
        g.fillText(p.suffix, ox + D.w + 70 + (1 - dp) * 900, oy + 760);
      }
    }
    cap(g, c, ['DOT-MATRIX TYPE', 'RIPPLE ON THE 8THS'], 'tr', T.bg);
  },
  sfx(A, t0, p, c) {
    const notes = [77, 80, 84, 87, 89, 92, 96, 99];
    for (let i = 0; i < 8; i++) blip(A, t0 + c.bt(0.125) * i, notes[i], 0.03, i % 2 ? 0.5 : -0.5);
    if (p.suffix) whoosh(A, t0 + c.bt(0.84), 0.3, 0.22, 0.9, 0, 800, 4000);
  },
  hits: () => [{ at: 0, shake: 10 }],
});
