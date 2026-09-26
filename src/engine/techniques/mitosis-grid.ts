import { z } from 'zod';
import { crash, pluck, pop } from '../audio/synth';
import { css, rgb } from '../core/color';
import { fillBg, H, W } from '../core/draw';
import { E, lerp, prog, pulse, TAU, clamp } from '../core/math';
import { cap, chordTones } from './_shared';
import { define } from './types';

const LV = [
  { c: 1, r: 1, rad: 200, sp: 0 },
  { c: 2, r: 1, rad: 160, sp: 420 },
  { c: 4, r: 2, rad: 108, sp: 270 },
  { c: 8, r: 4, rad: 62, sp: 165 },
  { c: 16, r: 9, rad: 46, sp: 120 },
];
const LT = [0, 0.5, 1, 1.5, 2]; // beats
const lvPos = (L: number, c: number, r: number): [number, number] => {
  const v = LV[L];
  return [W / 2 + (c - (v.c - 1) / 2) * v.sp, H / 2 + (r - (v.r - 1) / 2) * v.sp];
};

export default define({
  id: 'mitosis-grid',
  title: 'Mitosis grid',
  category: 'shape',
  summary: 'A single brand-coloured circle divides like a cell on every 8th (1 → 2 → 8 → 32 → 144) into a 16×9 grid, which then ripples and morphs in waves (circle → square → diamond) with a radial colour wipe, collapses into one horizontal line, and vibrates like a plucked string.',
  guidance: 'Exactly 6 beats. Flows out of type-drop’s circle and into portal-dolly (the string becomes its horizon).',
  label: 'SHAPE',
  params: z.object({}),
  beats: { min: 6, max: 6, default: 6 },
  energy: 3,
  example: {},
  draw(g, lt, _p, c) {
    const T = c.theme, b = c.bt;
    const P = rgb(T.primary), S = rgb(T.secondary), A = rgb(T.accent), X = rgb(T.text);
    if (lt < b(2.5)) {
      fillBg(g, T.light);
      let L = 0;
      for (let k = 0; k < LT.length; k++) if (lt >= b(LT[k])) L = k;
      const v = LV[L], q = L === 0 ? 1 : prog(lt, b(LT[L]), b(LT[L] + 0.44));
      const pp = E.outBack(q, 2), pr = E.outCubic(q), s = Math.max(0, lt - b(LT[L])), sq = 0.16 * Math.exp(-10 * s) * Math.cos(28 * s);
      g.fillStyle = T.primary; g.strokeStyle = T.primary; g.lineCap = 'round';
      for (let r = 0; r < v.r; r++) for (let cc = 0; cc < v.c; cc++) {
        const [tx, ty] = lvPos(L, cc, r);
        let x = tx, y = ty, rad = v.rad;
        if (L > 0) {
          const pv = LV[L - 1], [px, py] = lvPos(L - 1, Math.floor((cc * pv.c) / v.c), Math.floor((r * pv.r) / v.r));
          x = lerp(px, tx, pp); y = lerp(py, ty, pp); rad = lerp(pv.rad, v.rad, pr);
          const neck = L <= 3 ? Math.pow(1 - q, 2.2) : 0;
          if (neck > 0.02) { g.lineWidth = rad * 1.5 * neck; g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke(); }
        }
        g.beginPath(); g.ellipse(x, y, rad * (1 + sq), rad * (1 - sq), 0, 0, TAU); g.fill();
      }
      cap(g, c, ['MITOSIS', `${v.c * v.r} × ●`], 'tl', T.light);
      return;
    }
    if (lt < b(5.04)) {
      fillBg(g, T.light);
      const rb = lt < b(4) ? prog(lt, b(3), b(3.49)) * 1250 : 2000;
      if (rb > 0) { g.fillStyle = T.bg; g.beginPath(); g.arc(W / 2, H / 2, rb, 0, TAU); g.fill(); }
      const tl = Math.min(lt, b(4) - 0.001);
      for (let r = 0; r < 9; r++) for (let cc = 0; cc < 16; cc++) {
        const [x0, y0] = lvPos(4, cc, r);
        const dg = (cc + r) / 23, dc = Math.hypot(cc - 7.5, r - 4) / 8.5;
        const pA = E.inOutCubic(prog(tl, b(2.5 + dg * 0.5), b(2.82 + dg * 0.5)));
        const pB = prog(tl, b(3 + dc * 0.4), b(3.4 + dc * 0.4)), pBe = E.outBack(pB, 2.4);
        const pC = E.inOutCubic(prog(tl, b(3.5 + (1 - dc) * 0.32), b(3.86 + (1 - dc) * 0.32)));
        const env = prog(tl, b(2.5), b(2.84)) * (1 - prog(tl, b(3.6), b(4)));
        const size = 92 * (1 + 0.22 * env * Math.sin(dc * 11 - (tl - b(2.5)) * 18)) * (1 - 0.26 * pBe) * (1 - 0.22 * pC);
        const col = pC > 0.5 ? X : pB > 0.3 ? A : pA > 0.5 ? S : P;
        let y = y0, w = size, h = size, corner = lerp(size / 2, size * 0.1, pA), rot = (Math.PI / 4) * (pBe - pC);
        if (lt >= b(4)) {
          const rd = Math.abs(r - 4) / 4, q = E.inOutExpo(prog(lt, b(4 + rd * 0.32), b(4.68 + rd * 0.32)));
          y = lerp(y, H / 2, q); w = lerp(w, 121, q); h = lerp(h, 5, q); corner = lerp(corner, 0, q); rot = lerp(rot, 0, q);
        }
        g.save(); g.translate(x0, y); g.rotate(rot); g.fillStyle = css(col);
        g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, Math.min(corner, w / 2, h / 2)); g.fill(); g.restore();
      }
      const lbl = lt < b(3) ? 'MORPH ● → ■' : lt < b(3.5) ? 'RADIAL WAVE ◆' : lt < b(4) ? 'SETTLE' : 'COLLAPSE → LINE';
      cap(g, c, ['GRID 16 × 9', lbl], 'tl', rb > 900 ? T.bg : T.light);
      return;
    }
    fillBg(g, T.bg);
    const q = prog(lt, b(5.04), b(5.94)), Am = 48 * E.inCubic(q) * (lt < b(5.94) ? 1 : 0), k = 0.012 + 0.035 * q;
    g.strokeStyle = T.text; g.lineWidth = lerp(5, 3, q) + 4 * pulse(lt, b(5.94), 20); g.lineJoin = 'round';
    g.beginPath();
    for (let x = -20; x <= W + 20; x += 6) {
      const y = H / 2 + Am * Math.sin(Math.PI * clamp(x / W)) * Math.sin(x * k - lt * 70);
      if (x === -20) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    cap(g, c, ['TENSION', `${Math.round(Am)} PX AMPLITUDE`], 'tl', T.bg);
  },
  sfx(A, t0, _p, c) {
    const b = c.bt, ch = c.music.chordAt(t0), tones = chordTones(ch.pad, 72, 12);
    crash(A, t0, 0.14, 1.0);
    [1, 2, 4, 6, 8].forEach((cnt, L) => {
      for (let k = 0; k < cnt; k++) pop(A, t0 + b(L * 0.5) + k * 0.018, tones[Math.min(tones.length - 1, L + (k % 3))], (0.16 / Math.sqrt(cnt)) * 1.4, cnt > 1 ? (k / (cnt - 1)) * 1.2 - 0.6 : 0);
    });
    for (let i = 0; i < 12; i++) pluck(A, t0 + b(2.5 + i * 0.25), tones[[0, 1, 2, 3, 2, 1][i % 6] + 2], 0.055, Math.sin(i) * 0.5);
  },
  hits: (_p, c) => [0, 0.5, 1, 1.5, 2].map((x, i) => ({ at: c.bt(x), shake: i ? 4 : 8, punch: i ? 0 : 0.03 })),
});
