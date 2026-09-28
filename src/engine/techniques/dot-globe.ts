import { z } from 'zod';
import { bell, crash, impact, riser, tom, whoosh, zip } from '../audio/synth';
import { landVectors, unit } from '../assets/land';
import { mixHex, rgba } from '../core/color';
import { dotGrid, fillBg, glow, typeOn } from '../core/draw';
import { clamp, DEG, E, lerp, mod, pad2, prog, rnd, TAU, type Vec3 } from '../core/math';
import { font } from '../core/theme';
import { beatPulse, cap, GLOBE } from './_shared';
import { define, type Ctx } from './types';

const Place = z.object({ name: z.string().min(1).max(16), lat: z.number().min(-85).max(85), lon: z.number().min(-180).max(180) });
const Params = z.object({
  hq: Place.extend({ label: z.string().max(24).optional() }),
  cities: z.array(Place).min(1).max(10),
  headline: z.tuple([z.string().max(16), z.string().max(16)]).describe('Two lines; the second is set in the brand colour'),
  headline2: z.tuple([z.string().max(16), z.string().max(16)]).optional().describe('Replaces the first headline halfway through'),
  kicker: z.string().max(48).optional(),
  counter: z.string().max(24).default('CITIES CONNECTED'),
  enter: z.enum(['auto', 'ring', 'fade']).default('auto'),
  exit: z.enum(['spin', 'none']).default('spin'),
});
type P = z.output<typeof Params>;

interface View { lam: number; phi: number; R: number; cx: number; cy: number }
function view(lt: number, p: P, c: Ctx): View {
  const b = c.bt, beats = c.beats;
  const dl = p.cities.reduce((s, q) => s + ((((q.lon - p.hq.lon) % 360) + 540) % 360) - 180, 0) / p.cities.length;
  const lam1 = p.hq.lon + 0.6, lam2 = p.hq.lon + clamp(dl * 1.6, -60, 60);
  let lam = lerp(p.hq.lon - 100, lam1, E.outCubic(prog(lt, 0, b(2))));
  lam = lerp(lam, lam2, E.inOutCubic(prog(lt, b(3), b(beats - 1.4))));
  if (p.exit === 'spin') lam += 260 * E.inExpo(prog(lt, b(beats - 1.1), b(beats - 0.06)));
  let phi = lerp(p.hq.lat + 15, p.hq.lat + 3, E.outCubic(prog(lt, 0, b(2))));
  phi = lerp(phi, p.hq.lat + 11, E.inOutCubic(prog(lt, b(3), b(beats - 1.4))));
  let R = lerp(GLOBE.r, 590, E.outExpo(prog(lt, b(2), b(2.8))));
  R = lerp(R, 410, E.inOutCubic(prog(lt, b(3.2), b(5))));
  if (p.exit === 'spin') R *= 1 - E.inExpo(prog(lt, b(beats - 1), b(beats - 0.06))) * 0.985;
  const cx = lerp(GLOBE.x, 1360, E.outExpo(prog(lt, b(2), b(2.8))) * (1 - E.inOutCubic(prog(lt, b(3.2), b(5)))));
  return { lam: lam * DEG, phi: phi * DEG, R, cx, cy: GLOBE.y };
}
function gxf(v: Vec3, V: View): [number, number, number, number, number] {
  const cl = Math.cos(V.lam), sl = Math.sin(V.lam);
  const x1 = v[0] * cl - v[2] * sl, z1 = v[0] * sl + v[2] * cl;
  const cp = Math.cos(V.phi), sp = Math.sin(V.phi);
  const y2 = v[1] * cp - z1 * sp, z2 = v[1] * sp + z1 * cp;
  return [V.cx + V.R * x1, V.cy - V.R * y2, z2, x1, y2];
}
function slerp(a: Vec3, b: Vec3, s: number): Vec3 {
  const d = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1), om = Math.acos(d);
  if (om < 1e-4) return [a[0], a[1], a[2]];
  const k1 = Math.sin((1 - s) * om) / Math.sin(om), k2 = Math.sin(s * om) / Math.sin(om);
  return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
}
const arcTime = (i: number, c: Ctx) => c.bt(2.5 + i * 0.5);

export default define({
  id: 'dot-globe',
  title: 'Dot globe — HQ to the world',
  category: 'data',
  summary: 'A 3D dotted-world globe spins in, the camera pushes in on the HQ pin, then glowing arcs launch to each client city on the 8ths with data packets pulsing out on every beat, while a two-line headline swaps. Ends by spinning away into a point.',
  guidance: 'Give real coordinates. 5–8 cities read best in 8 beats. headline e.g. ["Made in", "Lisbon."] then headline2 ["Shipped", "everywhere."].',
  label: 'GLOBAL',
  params: Params,
  beats: { min: 6, max: 12, default: 8 },
  energy: 2,
  example: {
    hq: { name: 'LISBON', lat: 38.72, lon: -9.14 },
    cities: [{ name: 'BERLIN', lat: 52.52, lon: 13.4 }, { name: 'TORONTO', lat: 43.65, lon: -79.38 }, { name: 'TOKYO', lat: 35.68, lon: 139.69 }, { name: 'SYDNEY', lat: -33.87, lon: 151.21 }],
    headline: ['Made in', 'Lisbon.'],
    headline2: ['Shipped', 'everywhere.'],
  },
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt, V = view(lt, p, c);
    fillBg(g, T.bg);
    dotGrid(g, 0.04);
    glow(g, V.cx, V.cy, V.R * 1.6, T.primary, 0.16 + 0.06 * beatPulse(lt, c));
    const body = g.createRadialGradient(V.cx - V.R * 0.3, V.cy - V.R * 0.35, Math.max(0, V.R * 0.1), V.cx, V.cy, Math.max(1, V.R));
    body.addColorStop(0, mixHex(T.bg, '#FFFFFF', 0.06)); body.addColorStop(1, mixHex(T.bg, '#FFFFFF', 0.015));
    g.fillStyle = body; g.beginPath(); g.arc(V.cx, V.cy, Math.max(0, V.R), 0, TAU); g.fill();
    g.strokeStyle = rgba(T.primary, 0.35); g.lineWidth = 1.5; g.stroke();
    const ringIn = p.enter === 'auto' ? c.prev?.technique === 'particle-morph' : p.enter === 'ring';
    const rim = ringIn ? 1 - prog(lt, 0, b(0.6)) : 0;
    if (rim > 0) { g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = rgba(T.secondary, rim); g.lineWidth = 3 + 6 * rim; g.stroke(); g.restore(); }
    const HQV = unit(p.hq.lat, p.hq.lon);
    const buckets = Array.from({ length: 5 }, () => new Path2D()), hot = new Path2D();
    const ds = Math.max(1, V.R / 175) * (1 + 0.15 * beatPulse(lt, c));
    const reveal = prog(lt, 0, b(0.7)), land = landVectors();
    for (let i = 0; i < land.length; i++) {
      const v = land[i];
      if (reveal < 1 && rnd(i, 21) > reveal) continue;
      const q = gxf(v, V);
      if (q[2] <= 0.02) continue;
      const near = v[0] * HQV[0] + v[1] * HQV[1] + v[2] * HQV[2] > 0.985;
      (near ? hot : buckets[Math.min(4, Math.floor(q[2] * 5))]).rect(q[0] - ds, q[1] - ds, ds * 2, ds * 2);
    }
    buckets.forEach((path, i) => { g.fillStyle = rgba(T.text, 0.12 + i * 0.13); g.fill(path); });
    g.fillStyle = T.primary; g.fill(hot);
    const vis = (q: number[]) => q[2] > 0 || q[3] * q[3] + q[4] * q[4] > 1;
    p.cities.forEach((city, ci) => {
      const ta = arcTime(ci, c);
      if (lt < ta) return;
      const B = unit(city.lat, city.lon), om = Math.acos(clamp(HQV[0] * B[0] + HQV[1] * B[1] + HQV[2] * B[2], -1, 1));
      const h = 0.1 + 0.32 * (om / Math.PI), head = E.outCubic(prog(lt, ta, ta + b(0.84)));
      const at = (s: number) => { const v = slerp(HQV, B, s), k = 1 + h * Math.sin(Math.PI * s); return gxf([v[0] * k, v[1] * k, v[2] * k], V); };
      g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
      for (const [lw, a] of [[8, 0.12], [2.6, 0.95]] as const) {
        g.strokeStyle = T.primary; g.lineWidth = lw * Math.max(0.4, V.R / GLOBE.r); g.globalAlpha = a; g.beginPath();
        let pen = false;
        for (let j = 0; j <= 48; j++) {
          const q = at((j / 48) * head);
          if (!vis(q)) { pen = false; continue; }
          if (pen) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]);
          pen = true;
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      if (head < 1) {
        const q = at(head);
        if (vis(q)) glow(g, q[0], q[1], 26, T.secondary, 1);
      } else {
        const q = at(E.inOutCubic(mod(lt, c.B) / c.B));
        if (vis(q)) { g.fillStyle = T.text; g.beginPath(); g.arc(q[0], q[1], 3.4, 0, TAU); g.fill(); }
        const e = gxf(B, V);
        if (e[2] > 0) {
          const rp = prog(lt, ta + b(0.84), ta + b(1.8));
          g.strokeStyle = T.secondary; g.lineWidth = 2; g.globalAlpha = 1 - rp; g.beginPath(); g.arc(e[0], e[1], 6 + rp * 30, 0, TAU); g.stroke(); g.globalAlpha = 1;
          g.fillStyle = T.text; g.beginPath(); g.arc(e[0], e[1], 4.5, 0, TAU); g.fill();
          font(g, 14, 600, 'mono'); g.letterSpacing = '2px'; g.fillStyle = rgba(T.text, clamp(e[2] * 2) * prog(V.R, 160, 300));
          g.fillText(city.name.toUpperCase(), e[0] + 12, e[1] - 10); g.letterSpacing = '0px';
        }
      }
      g.restore();
    });
    const hq = gxf(HQV, V);
    if (hq[2] > 0 && lt >= b(2)) {
      const drop = E.outBack(prog(lt, b(2), b(2.4)), 2);
      for (let k = 0; k < 2; k++) {
        const rp = mod(lt - b(2) + k * b(0.5), c.B) / c.B;
        g.strokeStyle = T.primary; g.lineWidth = 2.5; g.globalAlpha = (1 - rp) * drop; g.beginPath(); g.arc(hq[0], hq[1], 8 + rp * 46, 0, TAU); g.stroke();
      }
      g.globalAlpha = 1; glow(g, hq[0], hq[1], 40, T.primary, 0.9 * drop);
      g.fillStyle = T.text; g.beginPath(); g.arc(hq[0], hq[1], 7 * drop, 0, TAU); g.fill();
      font(g, 16, 700, 'mono'); g.letterSpacing = '3px'; g.fillStyle = rgba(T.text, drop);
      g.fillText((p.hq.label ?? `${p.hq.name} · HQ`).toUpperCase(), hq[0] + 18, hq[1] + 30); g.letterSpacing = '0px';
    }
    const fade = p.exit === 'spin' ? 1 - prog(lt, b(c.beats - 1.2), b(c.beats - 0.6)) : 1;
    g.save(); g.globalAlpha = fade;
    font(g, 17, 600, 'mono'); g.letterSpacing = '3px'; g.fillStyle = T.primary;
    typeOn(g, (p.kicker ?? `HQ — ${p.hq.name} · CLIENTS WORLDWIDE`).toUpperCase(), 112, 330, prog(lt, b(0.5), b(1.2)));
    g.letterSpacing = '0px';
    const swapAt = b(Math.min(4, c.beats - 3)), swap = p.headline2 ? E.outExpo(prog(lt, swapAt, swapAt + b(0.5))) : 0;
    g.save(); g.beginPath(); g.rect(90, 350, 900, 300); g.clip();
    font(g, 104, 800);
    p.headline.forEach((s, i) => {
      const q = E.outExpo(prog(lt, b(1 + i * 0.5), b(1.48 + i * 0.5)));
      g.fillStyle = i ? T.primary : T.text; g.fillText(s, 110, 470 + i * 120 + (1 - q) * 320 - swap * 320);
    });
    p.headline2?.forEach((s, i) => {
      const q = E.outExpo(prog(lt, swapAt + b(i * 0.5), swapAt + b(i * 0.5 + 0.48)));
      if (q > 0) { g.fillStyle = i ? T.primary : T.text; g.fillText(s, 110, 470 + i * 120 + (1 - q) * 300); }
    });
    g.restore();
    const landed = p.cities.filter((_, i) => lt >= arcTime(i, c) + b(0.84)).length;
    font(g, 17, 600, 'mono'); g.letterSpacing = '3px'; g.fillStyle = rgba(T.muted, prog(lt, b(2), b(2.4)));
    g.fillText(`${p.counter.toUpperCase()}  ${pad2(landed)}`, 112, 720); g.letterSpacing = '0px';
    g.restore();
    if (fade > 0.02) cap(g, c, ['ORTHOGRAPHIC DOT GLOBE', 'ARCS LAUNCH ON THE 8THS'], 'tr', T.bg);
  },
  sfx(A, t0, p, c) {
    const b = c.bt, ch = c.music.chordAt(t0);
    impact(A, t0, 0.75);
    tom(A, t0 + b(2), ch.bass, 0.5);
    bell(A, t0 + b(2), 84, 0.07);
    p.cities.forEach((q, i) => zip(A, t0 + arcTime(i, c), clamp(((((q.lon - p.hq.lon) % 360) + 540) % 360 - 180) / 120, -0.9, 0.9), 0.07));
    if (p.headline2) crash(A, t0 + b(Math.min(4, c.beats - 3)), 0.12, 1.0);
    if (p.exit === 'spin') {
      whoosh(A, t0 + c.dur - b(1.1), b(1.04), 0.42, -0.9, 0.9, 400, 7000);
      riser(A, t0 + c.dur - b(1.2), t0 + c.dur - 0.01, 0.22);
    }
  },
  hits: (_p, c) => [{ at: 0, shake: 12, punch: 0.03 }, { at: c.bt(2), shake: 10 }],
  fast: (p, c) => [[0, c.bt(1.1)], ...(p.exit === 'spin' ? [[c.dur - c.bt(1.1), c.dur] as [number, number]] : [])],
});
