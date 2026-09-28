import { z } from 'zod';
import { crash, marimba, riser, whoosh } from '../audio/synth';
import { circ, cubeIcon, ICON_NAMES, ICONS, resample, type Poly } from '../assets/icons';
import { logoOutline } from '../assets/logo';
import { dotGrid, fillBg, fitFont, glow } from '../core/draw';
import { clamp, E, lerp, pad2, prog, rnd, type Vec2 } from '../core/math';
import { font } from '../core/theme';
import { beatPulse, cap, chordTones, GLOBE } from './_shared';
import { frontRect } from './_page';
import { define, type Ctx } from './types';

const CX = 1340, CY = 560;
const Item = z.object({
  label: z.string().min(1).max(12),
  desc: z.string().max(36).optional(),
  icon: z.enum(ICON_NAMES),
});
const Params = z.object({
  items: z.array(Item).min(2).max(8),
  start: z.enum(['auto', 'scatter', 'page']).default('auto').describe('"page" dissolves out of a preceding exploded-ui'),
  exit: z.enum(['auto', 'ring', 'none']).default('auto').describe('"ring" collapses into a circle that becomes a following dot-globe'),
  kicker: z.string().max(40).default('WHAT WE DO BEST'),
  count: z.number().int().min(300).max(2000).default(1100),
});
type P = z.output<typeof Params>;

type Targets = { statics: Array<(Vec2[] & { spacing: number }) | null>; start: Vec2[] & { spacing: number }; ring: Vec2[] & { spacing: number } };
const cache = new WeakMap<object, Targets>();

const useRing = (p: P, c: Ctx) => (p.exit === 'auto' ? c.next?.technique === 'dot-globe' : p.exit === 'ring');
const usePage = (p: P, c: Ctx) => (p.start === 'auto' ? c.prev?.technique === 'exploded-ui' : p.start === 'page');

function targets(p: P, c: Ctx): Targets {
  let t = cache.get(p);
  if (t) return t;
  const n = p.count;
  const statics = p.items.map(it => {
    if (it.icon === 'cube') return null;
    const polys: Poly[] = it.icon === 'brand' ? logoOutline(c.brand.logo).map(l => l.map(([x, y]) => [x * 560, y * 560] as Vec2)) : ICONS[it.icon]();
    return resample(polys, n);
  });
  const r = frontRect();
  const start = [] as unknown as Vec2[] & { spacing: number };
  for (let i = 0; i < n; i++)
    start.push(usePage(p, c)
      ? [r.x + rnd(i, 8) * r.w - CX, r.y + rnd(i, 9) * r.h - CY]
      : [(rnd(i, 8) - 0.5) * 1500 - (CX - 960), (rnd(i, 9) - 0.5) * 900]);
  start.spacing = 999;
  const ring = resample([circ(GLOBE.x - CX, GLOBE.y - CY, GLOBE.r, 160)], n);
  t = { statics, start, ring };
  cache.set(p, t);
  return t;
}

function times(p: P, c: Ctx): number[] {
  const ring = useRing(p, c), slot = (c.beats - (ring ? 1 : 0)) / p.items.length;
  const ts = p.items.map((_, k) => c.bt(k * slot));
  if (ring) ts.push(c.bt(c.beats - 1));
  return ts;
}

export default define({
  id: 'particle-morph',
  title: 'Particle morph',
  category: 'shape',
  summary: 'About a thousand glowing particles re-form into a new line-art icon on every beat (web, mobile, AI network, cube, the brand logo, and 20 more), while the item name swaps beside it. Particles swirl between shapes and settle into connected outlines.',
  guidance: 'One item per beat, 4–7 items (services, features, values). Use icon "brand" for the logo. It dissolves out of exploded-ui and can collapse into a ring for dot-globe.',
  label: 'SERVICES',
  params: Params,
  beats: { min: 2, max: 10, default: 8 },
  energy: 2,
  example: {
    items: [
      { label: 'RESEARCH', desc: 'Interviews · testing', icon: 'search' },
      { label: 'PRODUCT', desc: 'Apps & platforms', icon: 'layers' },
      { label: 'MOTION', desc: 'Brands in movement', icon: 'motion' },
      { label: 'LAUNCH', desc: 'Go-to-market', icon: 'rocket' },
    ],
  },
  draw(g, lt, p, c) {
    const T = c.theme, TG = targets(p, c), ts = times(p, c), ring = useRing(p, c), n = p.count;
    fillBg(g, T.bg);
    dotGrid(g, 0.06);
    glow(g, CX, CY, 820, T.primary, 0.14 + 0.1 * beatPulse(lt, c));
    let k = 0;
    for (let i = 0; i < ts.length; i++) if (lt >= ts[i]) k = i;
    const at = (j: number): Vec2[] & { spacing: number } =>
      j < 0 ? TG.start : j >= p.items.length ? TG.ring : TG.statics[j] ?? resample(cubeIcon(lt), n);
    const cur = at(lt < ts[0] ? -1 : k), prev = at(lt < ts[0] ? -1 : k - 1);
    const P: Vec2[] = new Array(n), settled: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const d = (i / n) * 0.09, q = E.outExpo(prog(lt, ts[k] + d, ts[k] + d + c.bt(0.68)));
      const a = prev[i], b = cur[i];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, sw = Math.sin(Math.PI * q) * 90 * (rnd(i, 4) - 0.5);
      P[i] = [CX + lerp(a[0], b[0], q) - (dy / L) * sw, CY + lerp(a[1], b[1], q) + (dx / L) * sw];
      settled[i] = q;
    }
    g.save(); g.globalCompositeOperation = 'lighter';
    const lim = (cur.spacing || 20) * 2.4;
    for (const [lw, a] of [[7, 0.12], [2.4, 0.9]] as const) {
      g.strokeStyle = T.primary; g.lineWidth = lw; g.lineCap = 'round'; g.globalAlpha = a;
      g.beginPath();
      for (let i = 0; i < n - 1; i++) {
        if (settled[i] < 0.85 || settled[i + 1] < 0.85) continue;
        const A = P[i], B = P[i + 1];
        if (Math.hypot(B[0] - A[0], B[1] - A[1]) > lim) continue;
        g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 7 === 0 ? T.text : i % 3 ? T.primary : T.secondary;
      const r = 2 + (1 - settled[i]) * 1.6;
      g.fillRect(P[i][0] - r, P[i][1] - r, r * 2, r * 2);
    }
    g.restore();
    const ik = clamp(k, 0, p.items.length - 1), it = p.items[ik];
    const q = E.outExpo(prog(lt, ts[ik], ts[ik] + c.bt(0.44)));
    const fade = ring ? 1 - E.inExpo(prog(lt, ts[p.items.length], ts[p.items.length] + c.bt(0.6))) : 1;
    const sizeOf = (s: string) => Math.min(210, fitFont(g, s, 720, 800));
    g.save(); g.globalAlpha = fade; g.beginPath(); g.rect(90, 400, 900, 270); g.clip();
    if (ik > 0 && lt >= ts[0]) { font(g, sizeOf(p.items[ik - 1].label), 800); g.fillStyle = T.text; g.fillText(p.items[ik - 1].label, 110, 610 - q * 300); }
    font(g, sizeOf(it.label), 800); g.fillStyle = T.text; g.fillText(it.label, 110, 610 + (1 - q) * 300);
    g.restore();
    g.save(); g.globalAlpha = fade;
    font(g, 22, 600, 'mono'); g.letterSpacing = '3px'; g.fillStyle = T.primary; g.fillText(`${pad2(ik + 1)} / ${pad2(p.items.length)}`, 114, 330);
    g.fillStyle = T.muted; g.globalAlpha = fade * q; if (it.desc) g.fillText(it.desc.toUpperCase(), 114, 700);
    g.globalAlpha = fade; g.letterSpacing = '0px';
    g.fillStyle = T.primary; g.fillRect(114, 350, 60 + 20 * beatPulse(lt, c), 4);
    g.restore();
    cap(g, c, [p.kicker, `${n} PARTICLES · MORPH ON THE BEAT`], 'tr', T.bg);
  },
  sfx(A, t0, p, c) {
    const ts = times(p, c), ch = c.music.chordAt(t0), notes = chordTones(ch.pad, 72, p.items.length);
    crash(A, t0, 0.14, 1.0);
    p.items.forEach((_, i) => {
      const at = t0 + ts[i];
      marimba(A, at, notes[i], 0.12, (i / Math.max(1, p.items.length - 1)) * 1.2 - 0.6);
      marimba(A, at + c.bt(0.375), notes[i] - 12, 0.06);
      whoosh(A, at - 0.04, 0.2, 0.1, 0, 0, 1500, 6000);
    });
    if (useRing(p, c)) riser(A, t0 + c.dur - c.bt(1.6), t0 + c.dur - 0.01, 0.2);
  },
  hits: (p, c) => times(p, c).map((at, i) => ({ at, shake: i ? 4 : 10, punch: i ? 0 : 0.02 })),
  fast: (p, c) => (useRing(p, c) ? [[c.dur - c.bt(1), c.dur - c.bt(0.3)]] : []),
});
