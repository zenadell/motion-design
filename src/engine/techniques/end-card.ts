import { z } from 'zod';
import { bell, crash, impact, kick, logDrum, marimba, pad, pop, stab, whoosh } from '../audio/synth';
import { drawLogo, drawTile } from '../assets/logo';
import { rgba } from '../core/color';
import { arrow, dotGrid, fillBg, glow, H, kern, rr, W, type G } from '../core/draw';
import { E, lerp, prog, pulse, TAU } from '../core/math';
import { font } from '../core/theme';
import { beatPulse, chordTones } from './_shared';
import { markHeight, TILE } from './logo-build';
import { define, type Ctx } from './types';

const Params = z.object({
  tagline: z.string().max(80).optional().describe('Defaults to brand.tagline'),
  cta: z.string().max(22).default('Let’s Connect').describe('Button label; empty string hides it'),
  footer: z.tuple([z.string().max(32), z.string().max(32), z.string().max(40)]).optional().describe('[left, centre, right] mono footer; defaults to availability, site, email'),
  status: z.boolean().default(true).describe('Pulsing dot before the left footer item'),
  enter: z.enum(['auto', 'tile', 'fade']).default('auto').describe('"tile" slides the big tile from a preceding logo-build into the lockup'),
});
const HIT = 4; // beats: the final chord

function layout(g: G, c: Ctx) {
  let size = 124;
  const name = c.brand.name, suffix = c.brand.suffix ? ' ' + c.brand.suffix : '';
  const measure = () => {
    font(g, size, 800); const wJ = g.measureText(name).width;
    font(g, size, 300); const wI = suffix ? g.measureText(suffix).width : 0;
    return { wJ, wI };
  };
  let m = measure();
  const tile = c.brand.tile ? 230 : 0, gap = c.brand.tile ? 60 : 0;
  while (tile + gap + m.wJ + m.wI > W - 220 && size > 60) { size -= 4; m = measure(); }
  const total = tile + gap + m.wJ + m.wI, x0 = (W - total) / 2, yc = 470;
  return { size, ...m, tile, gap, x0, yc, tx: x0 + tile + gap, base: yc + size * 0.36, suffix };
}

export default define({
  id: 'end-card',
  title: 'End card lockup',
  category: 'outro',
  summary: 'The final brand lockup: app tile + name typed letter-by-letter on the 16ths, a lighter suffix, tagline, a call-to-action pill and a mono footer (availability, site, email), landing on a final chord and holding clean.',
  guidance: 'Always the last section, 6–8 beats. After logo-build the tile glides from centre into the lockup. Keep tagline ≤ 60 chars.',
  label: 'END',
  params: Params,
  beats: { min: 5, max: 12, default: 8 },
  energy: 2,
  hud: false,
  example: {},
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt, B = c.brand;
    fillBg(g, T.bg);
    glow(g, W * 0.82, H * 1.02, 1100, T.primary, 0.22 + 0.06 * Math.sin(lt * 2.2) + 0.2 * pulse(lt, b(HIT), 3));
    dotGrid(g, 0.035);
    const L = layout(g, c);
    const fromTile = p.enter === 'auto' ? c.prev?.technique === 'logo-build' : p.enter === 'tile';
    const m = fromTile ? E.inOutExpo(prog(lt, 0, b(0.6))) : 1;
    const fade = fromTile ? 1 : E.outExpo(prog(lt, 0, b(0.8)));
    if (B.tile) {
      const S = lerp(TILE, L.tile, m), tcx = lerp(W / 2, L.x0 + L.tile / 2, m), tcy = lerp(H / 2, L.yc, m), tp = 1 + 0.06 * pulse(lt, b(HIT), 7);
      g.save(); g.globalAlpha = fade; g.translate(tcx, tcy); g.scale(tp, tp); g.translate(-tcx, -tcy);
      drawTile(g, T, tcx, tcy, S, 1); drawLogo(g, B.logo, tcx, tcy, markHeight(g, c, S), T.text);
      g.restore();
    }
    g.save(); g.beginPath(); g.rect(L.tx - 20, L.base - L.size * 1.05, 1600, L.size * 1.35); g.clip();
    font(g, L.size, 800);
    const K = kern(g, B.name, -L.size * 0.02);
    for (let i = 0; i < B.name.length; i++) {
      const q = E.outBack(prog(lt, b(0.5 + i * 0.25), b(0.94 + i * 0.25)), 1.6);
      g.fillStyle = T.text; g.fillText(B.name[i], L.tx + K.xs[i], L.base + (1 - q) * L.size * 1.2);
    }
    if (L.suffix) {
      const ip = E.outExpo(prog(lt, b(2), b(2.6)));
      font(g, L.size, 300); g.fillStyle = rgba(T.muted, ip);
      g.fillText(L.suffix, L.tx + K.total + (1 - ip) * -80, L.base);
    }
    g.restore();
    const tagline = p.tagline ?? B.tagline;
    if (tagline) {
      const tg = E.outExpo(prog(lt, b(2.5), b(3.1)));
      font(g, 38, 500); g.fillStyle = rgba(T.muted, tg); g.fillText(tagline, L.tx + 4, L.base + 84 + (1 - tg) * 20);
    }
    const cp = E.outBack(prog(lt, b(3), b(3.44)), 2);
    if (p.cta && cp > 0) {
      font(g, 26, 700);
      const bx = L.tx + 4, by = L.base + 132, bh = 78, bw = g.measureText(p.cta).width + 120;
      g.save(); g.translate(bx, by + bh / 2); g.scale(cp, cp); g.translate(-bx, -(by + bh / 2));
      g.fillStyle = T.primary; rr(g, bx, by, bw, bh, bh / 2); g.fill();
      g.fillStyle = T.text; g.fillText(p.cta, bx + 34, by + 49);
      g.beginPath(); g.arc(bx + bw - 39, by + bh / 2, 27, 0, TAU); g.fill(); arrow(g, bx + bw - 39, by + bh / 2, 11, T.primary, 3.5);
      g.restore();
    }
    const fp = prog(lt, b(3), b(3.7));
    const [fl, fc, fr] = p.footer ?? ['Available for new projects', B.site, B.email];
    g.fillStyle = rgba(T.text, 0.16); g.fillRect(96, H - 120, (W - 192) * E.inOutCubic(fp), 1);
    font(g, 19, 600, 'mono'); g.letterSpacing = '3px';
    const lx = p.status ? 130 : 96;
    g.fillStyle = rgba(T.muted, fp); g.fillText(fl.toUpperCase(), lx, H - 74);
    if (p.status) { g.fillStyle = rgba(T.primary, fp); g.beginPath(); g.arc(108, H - 81, 7 * (1 + 0.35 * beatPulse(lt, c)), 0, TAU); g.fill(); }
    g.fillStyle = rgba(T.text, fp); g.textAlign = 'center'; g.fillText(fc.toUpperCase(), W / 2, H - 74);
    g.fillStyle = rgba(T.muted, fp); g.textAlign = 'right'; g.fillText(fr.toUpperCase(), W - 96, H - 74);
    g.textAlign = 'left'; g.letterSpacing = '0px';
  },
  sfx(A, t0, p, c) {
    const b = c.bt, ch = c.music.chordAt(t0), hit = t0 + b(HIT);
    if (p.enter !== 'fade') whoosh(A, t0 - 0.05, 0.3, 0.2, 0.3, -0.5, 3000, 600);
    const notes = chordTones(ch.pad, 72, c.brand.name.length);
    for (let i = 0; i < c.brand.name.length; i++) pop(A, t0 + b(0.5 + i * 0.25), notes[i], 0.09, (i / Math.max(1, c.brand.name.length - 1)) - 0.5);
    if (c.brand.suffix) whoosh(A, t0 + b(1.9), 0.3, 0.16, -0.6, 0.4, 700, 3000);
    if (p.cta) { pop(A, t0 + b(3), notes[0], 0.16); bell(A, t0 + b(3), notes[0] + 24, 0.04); }
    const fin = c.music.chordAt(t0);
    kick(A, hit, 1.05); impact(A, hit, 0.9); crash(A, hit, 0.2, 2);
    pad(A, hit, t0 + c.dur - 0.3, [fin.bass, ...fin.pad, fin.pad[0] + 12], 0.034, 2400);
    stab(A, hit, [...fin.pad, fin.pad[0] + 12], 0.08, 0.6, 5000);
    logDrum(A, hit, fin.bass, 0.45, 0.9);
    const top = chordTones(fin.pad, 84, 4);
    bell(A, hit, top[1] ?? 89, 0.12);
    top.forEach((n, i) => marimba(A, hit + b(0.5 * (i + 1)), n, 0.08 - i * 0.01, [-0.4, 0.4, 0, 0][i]));
  },
  hits: (_p, c) => [{ at: c.bt(HIT), shake: 10, punch: 0.015 }],
  bed: (_p, c) => [0, c.bt(HIT)],
});
