import { z } from 'zod';
import { impact, kick, riser, swell, tom, whoosh } from '../audio/synth';
import { makeCam, NEAR, planeXform, proj, scr, seg, type Cam } from '../core/camera';
import { rgba } from '../core/color';
import { fillBg, H, W, type G } from '../core/draw';
import { clamp, E, lerp, mod, prog, pulse, rnd, TAU } from '../core/math';
import { font } from '../core/theme';
import { define, type Ctx } from './types';

const FLOOR = -420;
const Params = z.object({
  words: z.tuple([z.string().max(8), z.string().max(8), z.string().max(8)]).default(['DOLLY', 'ROLL', 'WHIP']).describe('Words on the three portals the camera flies through'),
  viewfinder: z.boolean().default(true),
});
type P = z.output<typeof Params>;

const zAt = (u: number) => (u < 3 ? 1200 * u : 3600 + 320 * (1 - Math.pow(1 - prog(u, 3, 3.8), 3)));
const ORBIT = 3.52;
function camAt(lt: number, c: Ctx): Cam {
  const u = lt / c.B;
  const S = [1700, 40, zAt(ORBIT)];
  let x = 0, y = 0, z = zAt(u), yaw = (Math.PI / 2) * E.inOutExpo(prog(u, 3, ORBIT)), pitch = 0, fov = 62;
  const roll = TAU * E.inOutCubic(prog(u, 2, 2.96));
  if (u >= ORBIT) {
    const o = E.inOutCubic(prog(u, ORBIT, 5.5)), th = 1.15 * o, crash = E.inExpo(prog(u, 5.4, 5.95));
    const D = lerp(1700, 1300, o) - 640 * crash, yo = 420 * E.inOutCubic(prog(u, 3.6, 5.4));
    x = S[0] - D * Math.cos(th); z = S[2] + D * Math.sin(th); y = S[1] + yo;
    yaw = Math.PI / 2 + th; pitch = -Math.atan2(yo, D); fov = lerp(62, 4, crash);
  }
  return makeCam(x, y, z, yaw, pitch, roll, fov);
}
const moveName = (u: number) => (u < 2 ? 'DOLLY IN' : u < 3 ? 'BARREL ROLL' : u < ORBIT ? 'WHIP PAN' : u < 5.4 ? 'ORBIT' : 'CRASH ZOOM');

const DUST = Array.from({ length: 240 }, (_, i) => [rnd(i, 1) * 9000 - 4500, FLOOR + rnd(i, 2) * 1500, rnd(i, 3) * 15000 - 1000]);
const FIB = (() => { const n = 440, out: number[][] = [], ga = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < n; i++) { const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y); out.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]); } return out; })();

function grid(g: G, cam: Cam, lt: number, c: Ctx): void {
  const u = lt / c.B, reveal = lerp(16000, -2400, E.outExpo(prog(u, 0, 1)));
  const beat = pulse(lt, Math.floor(lt / c.B) * c.B, 7);
  const buckets = Array.from({ length: 8 }, () => new Path2D());
  const put = (a: [number, number, number], bb: [number, number, number], X: number, Z: number) => {
    const fog = Math.pow(clamp(1 - Math.hypot(X - cam.x, Z - cam.z) / 11000), 1.3);
    if (fog > 0.01) seg(buckets[Math.min(7, Math.floor(fog * 8))], cam, a, bb);
  };
  for (let X = -6400; X <= 6400; X += 400)
    for (let Z = -2400; Z < 16000; Z += 800) {
      if (Z + 800 < reveal) continue;
      const z0 = Math.max(Z, reveal);
      put(proj(cam, X, FLOOR, z0), proj(cam, X, FLOOR, Z + 800), X, (z0 + Z + 800) / 2);
    }
  for (let Z = -2400; Z <= 16000; Z += 400) {
    if (Z < reveal) continue;
    for (let X = -6400; X < 6400; X += 1600) put(proj(cam, X, FLOOR, Z), proj(cam, X + 1600, FLOOR, Z), X + 800, Z);
  }
  g.strokeStyle = c.theme.text; g.lineWidth = 2;
  buckets.forEach((path, i) => { g.globalAlpha = ((i + 0.5) / 8) * (0.42 + 0.3 * beat); g.stroke(path); });
  g.globalAlpha = 1;
  const ha = 1 - prog(u, 0.2, 1.4);
  if (ha > 0) { const path = new Path2D(); seg(path, cam, proj(cam, -60000, FLOOR, 60000), proj(cam, 60000, FLOOR, 60000)); g.strokeStyle = c.theme.text; g.lineWidth = 3; g.globalAlpha = ha; g.stroke(path); g.globalAlpha = 1; }
}

export default define({
  id: 'portal-dolly',
  title: 'Portal dolly — camera moves',
  category: 'camera',
  summary: 'A full 3D camera showcase: a horizon line becomes a perspective grid, the camera dollies through three glowing portals (one per beat, with words on them), does a barrel roll, whip-pans to an orbiting dot-sphere ringed with cards, and crash-zooms into its core — all inside a live camera viewfinder HUD.',
  guidance: 'Exactly 6 beats. Pair after mitosis-grid (its string is the horizon). The crash zoom fills the frame with the brand colour, which albers-colour picks up.',
  label: 'CAMERA',
  params: Params,
  beats: { min: 6, max: 6, default: 6 },
  energy: 2,
  example: {},
  draw(g, lt, p, c) {
    const T = c.theme, u = lt / c.B, cam = camAt(lt, c), camPrev = camAt(lt - 0.035, c);
    const COLS = [T.primary, T.text, T.accent, T.secondary, T.primary];
    fillBg(g, T.bg);
    grid(g, cam, lt, c);
    g.strokeStyle = T.text; g.lineCap = 'round';
    for (const [X, Y, Z] of DUST) {
      const a = proj(cam, X, Y, Z), bb = proj(camPrev, X, Y, Z);
      if (a[2] < NEAR || bb[2] < NEAR) continue;
      const A = scr(cam, a), B = scr(camPrev, bb), len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (len > 110) { B[0] = A[0] + ((B[0] - A[0]) * 110) / len; B[1] = A[1] + ((B[1] - A[1]) * 110) / len; }
      if (A[0] < -50 || A[0] > W + 50 || A[1] < -50 || A[1] > H + 50) continue;
      g.globalAlpha = clamp(1 - a[2] / 9000) * 0.7; g.lineWidth = clamp(2200 / a[2], 1, 5);
      g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0] + 0.01, B[1]); g.stroke();
    }
    g.globalAlpha = 1; g.lineCap = 'butt';
    const fadeAll = 1 - prog(u, 3.24, 3.7);
    const portalZ = [1200, 2400, 3600, 4800, 6000];
    if (fadeAll > 0)
      for (let k = portalZ.length - 1; k >= 0; k--) {
        const Z = portalZ[k], a = prog(u, k * 0.1, 0.4 + k * 0.1) * fadeAll, cz = proj(cam, 0, 30, Z)[2];
        if (cz < NEAR || a <= 0) continue;
        const cs = [[-780, FLOOR], [780, FLOOR], [780, 480], [-780, 480]].map(([x, y]) => proj(cam, x, y, Z));
        const path = new Path2D();
        for (let i = 0; i < 4; i++) seg(path, cam, cs[i], cs[(i + 1) % 4]);
        g.globalAlpha = a; g.strokeStyle = COLS[k]; g.lineCap = 'square'; g.lineWidth = clamp((12 * cam.f) / cz, 1.5, 70); g.stroke(path);
        const word = p.words[k];
        const next = portalZ.findIndex(z => z > cam.z + 10);
        const wa = k === next && k < 3 ? prog(u, k, k + 0.24) : 0;
        if (word && cz > 260 && wa > 0 && u < 3) {
          g.save();
          if (planeXform(g, cam, [0, 30, Z], [1, 0, 0], [0, -1, 0])) {
            g.globalAlpha = a * wa * clamp((cz - 260) / 500);
            font(g, 250, 900); g.fillStyle = COLS[k]; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(word, 0, 0);
          }
          g.restore();
        }
      }
    g.globalAlpha = 1; g.lineCap = 'butt'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const app = E.outBack(prog(u, 3.2, 3.9), 1.6);
    if (app > 0) {
      const S = [1700, 40, zAt(ORBIT)], R = 460 * app, rot = lt * 0.9, cr = Math.cos(rot), sr = Math.sin(rot);
      const core = proj(cam, S[0], S[1], S[2]);
      const items: Array<{ z: number; k: number; v?: number[]; cs?: number[][]; col?: string }> = [];
      for (const [ux, uy, uz] of FIB) {
        const x = ux * cr - uz * sr, z = ux * sr + uz * cr, v = proj(cam, S[0] + x * R, S[1] + uy * R, S[2] + z * R);
        if (v[2] > NEAR) items.push({ z: v[2], k: 0, v });
      }
      const tilt = 0.36, ct = Math.cos(tilt), st = Math.sin(tilt), rx = (x: number, y: number, z: number) => [x, y * ct - z * st, y * st + z * ct];
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * TAU + lt * 0.75, Rr = 860 * app;
        const Pp = rx(Math.cos(a) * Rr, 0, Math.sin(a) * Rr), Tt = rx(-Math.sin(a), 0, Math.cos(a)), U = rx(0, 1, 0), cw = 125 * app, ch = 78 * app;
        const cs = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([i, j]) => proj(cam, S[0] + Pp[0] + Tt[0] * cw * i + U[0] * ch * j, S[1] + Pp[1] + Tt[1] * cw * i + U[1] * ch * j, S[2] + Pp[2] + Tt[2] * cw * i + U[2] * ch * j));
        if (cs.some(v => v[2] < NEAR)) continue;
        items.push({ z: cs.reduce((s, v) => s + v[2], 0) / 4, k: 1, cs, col: COLS[k % COLS.length] });
      }
      if (core[2] > NEAR) items.push({ z: core[2], k: 2, v: core });
      items.sort((a, bb) => bb.z - a.z);
      for (const it of items) {
        if (it.k === 0) {
          const [sx, sy] = scr(cam, it.v as [number, number, number]);
          g.fillStyle = it.z > core[2] ? T.secondary : T.text; g.beginPath(); g.arc(sx, sy, Math.max(1.3, (9 * cam.f) / it.z), 0, TAU); g.fill();
        } else if (it.k === 1) {
          const pts = it.cs!.map(v => scr(cam, v as [number, number, number]));
          g.fillStyle = it.col!; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
          const mx = pts.reduce((s, q) => s + q[0], 0) / 4, my = pts.reduce((s, q) => s + q[1], 0) / 4;
          g.fillStyle = rgba(T.bg, 0.82); g.beginPath(); pts.forEach(([x, y], i) => { const ix = lerp(mx, x, 0.8), iy = lerp(my, y, 0.72); if (i) g.lineTo(ix, iy); else g.moveTo(ix, iy); }); g.closePath(); g.fill();
          g.fillStyle = it.col!; g.beginPath(); g.arc(mx, my, Math.max(1, (26 * cam.f) / it.z), 0, TAU); g.fill();
        } else {
          const [sx, sy] = scr(cam, it.v as [number, number, number]);
          g.fillStyle = T.primary; g.beginPath(); g.arc(sx, sy, (170 * app * cam.f) / it.z, 0, TAU); g.fill();
        }
      }
    }
    [1, 2, 3].forEach((tp, k) => { const fl = pulse(u, tp, 8); if (fl > 0.01) { g.globalAlpha = fl * 0.5; fillBg(g, COLS[k]); g.globalAlpha = 1; } });
    const cz = prog(u, 5.4, 5.96);
    if (cz > 0) {
      g.strokeStyle = T.text; g.lineWidth = 2;
      for (let i = 0; i < 56; i++) {
        const a = rnd(i, 11) * TAU, r = mod(lt * 4200 + rnd(i, 12) * 1400, 1400) + 220, len = 60 + 260 * cz;
        g.globalAlpha = cz * 0.65 * clamp((r - 220) / 200);
        g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r); g.lineTo(W / 2 + Math.cos(a) * (r + len), H / 2 + Math.sin(a) * (r + len)); g.stroke();
      }
      g.globalAlpha = prog(u, 5.9, 5.97); fillBg(g, T.primary); g.globalAlpha = 1;
    }
    if (p.viewfinder) {
      const a = prog(u, 0, 0.3) * (1 - prog(u, 5.86, 5.98));
      if (a > 0) {
        g.save(); g.globalAlpha = a; g.globalCompositeOperation = 'difference'; g.strokeStyle = '#FFFFFF'; g.fillStyle = '#FFFFFF'; g.lineWidth = 3;
        const m = 118, L = 64;
        for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
          g.beginPath(); g.moveTo(x, y + dy * L); g.lineTo(x, y); g.lineTo(x + dx * L, y); g.stroke();
        }
        g.lineWidth = 2; g.beginPath();
        g.moveTo(W / 2 - 22, H / 2); g.lineTo(W / 2 - 8, H / 2); g.moveTo(W / 2 + 8, H / 2); g.lineTo(W / 2 + 22, H / 2);
        g.moveTo(W / 2, H / 2 - 22); g.lineTo(W / 2, H / 2 - 8); g.moveTo(W / 2, H / 2 + 8); g.lineTo(W / 2, H / 2 + 22); g.stroke();
        font(g, 18, 600, 'mono'); g.letterSpacing = '3px';
        g.fillText(`CAM ▸ ${moveName(u)}`, m + 44, H - m - 20);
        g.textAlign = 'right'; g.fillText(`${Math.round(12 / Math.tan(cam.fov / 2))}MM  ·  ƒ/1.4  ·  4K`, W - m - 20, H - m - 20); g.textAlign = 'left';
        g.restore();
        g.save(); g.globalAlpha = a * (Math.floor(u) % 2 === 0 ? 1 : 0.35); g.fillStyle = T.primary; g.beginPath(); g.arc(m + 24, H - m - 26, 8, 0, TAU); g.fill(); g.restore();
        g.letterSpacing = '0px';
      }
    }
  },
  sfx(A, t0, _p, c) {
    const b = c.bt, ch = c.music.chordAt(t0);
    impact(A, t0, 0.8);
    [1, 2].forEach(k => whoosh(A, t0 + b(k) - 0.22, 0.26, 0.22, 0, 0, 400, 3500));
    whoosh(A, t0 + b(2), b(0.96), 0.2, -0.9, 0.9, 900, 2400);
    whoosh(A, t0 + b(2.9), 0.34, 0.5, -0.95, 0.95, 5500, 350);
    kick(A, t0 + b(3.5), 0.85); tom(A, t0 + b(3.5), ch.bass, 0.4);
    riser(A, t0 + b(4.9), t0 + b(5.96), 0.26); swell(A, t0 + b(5.4), t0 + b(6), 0.25);
  },
  hits: (_p, c) => [{ at: 0, shake: 20, punch: 0.04 }, { at: c.bt(3.5), shake: 12 }],
  fast: (_p, c) => [[c.bt(2.92), c.bt(3.6)], [c.bt(5.44), c.bt(6)]],
});

export type { P as PortalParams };
