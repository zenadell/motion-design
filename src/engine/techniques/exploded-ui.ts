import { z } from 'zod';
import { impact, pop, tom, whoosh } from '../audio/synth';
import { orbitCam } from '../core/camera';
import { mixHex, rgba } from '../core/color';
import { arrow, dotGrid, fillBg, glow, H, rr, W, type G } from '../core/draw';
import { clamp, E, hop, lerp, mod, prog, TAU } from '../core/math';
import { font } from '../core/theme';
import { drawLogo, drawTile } from '../assets/logo';
import { beatPulse, cap } from './_shared';
import { FRONT, onPage, PH, PW } from './_page';
import { define, type Ctx } from './types';

const Params = z.object({
  navLinks: z.array(z.string().max(12)).max(5).default(['Home', 'About', 'Services', 'Work']),
  eyebrow: z.string().max(40).default('INNOVATIVE SOFTWARE SOLUTIONS'),
  headline: z.array(z.string().max(30)).min(1).max(3),
  cta: z.string().max(18).default('Let’s Connect'),
  rating: z.object({ value: z.string().max(5), label: z.string().max(36) }).optional(),
  chat: z.object({ name: z.string().max(16), message: z.string().max(34) }).optional(),
  labels: z.boolean().default(true).describe('Mono labels next to each layer while exploded'),
});
type P = z.output<typeof Params>;
const LABELS = ['PAGE', 'NAV', 'HERO', 'CTA', 'MEDIA', 'CHAT'];

function layer(g: G, i: number, lt: number, p: P, c: Ctx): void {
  const T = c.theme, B = c.brand;
  if (i === 0) {
    g.save(); rr(g, 0, 0, PW, PH, 26); g.fillStyle = T.bg; g.fill(); g.clip();
    glow(g, PW, PH, 760, T.primary, 0.32); g.restore();
    g.strokeStyle = 'rgba(241,239,237,.12)'; g.lineWidth = 2; rr(g, 0, 0, PW, PH, 26); g.stroke();
  } else if (i === 1) {
    drawLogo(g, B.logo, 72, 72, 36, T.primary);
    font(g, 32, 800); g.fillStyle = T.text; g.fillText(B.name, 104, 84);
    font(g, 19, 500); g.fillStyle = T.muted;
    p.navLinks.forEach((s, k) => g.fillText(s, 470 + k * 118, 80));
    g.strokeStyle = rgba(T.text, 0.35); g.lineWidth = 2; rr(g, 1060, 46, 170, 52, 26); g.stroke();
    font(g, 18, 600); g.fillStyle = T.text; g.textAlign = 'center'; g.fillText('Contact', 1145, 78); g.textAlign = 'left';
  } else if (i === 2) {
    font(g, 15, 600, 'mono'); g.letterSpacing = '3px'; g.fillStyle = T.primary; g.fillText(p.eyebrow.toUpperCase(), 60, 212); g.letterSpacing = '0px';
    const longest = p.headline.reduce((a, s) => (s.length > a.length ? s : a), '');
    font(g, 47, 700);
    const size = Math.min(47, (47 * 640) / Math.max(1, g.measureText(longest).width));
    font(g, size, 700); g.fillStyle = T.text;
    p.headline.forEach((s, k) => g.fillText(s, 60, 290 + k * size * 1.28));
    g.fillStyle = mixHex(T.muted, T.bg, 0.5); rr(g, 60, 468, 540, 12, 6); g.fill(); rr(g, 60, 494, 430, 12, 6); g.fill();
  } else if (i === 3) {
    font(g, 22, 700);
    const bw = Math.max(220, g.measureText(p.cta).width + 110);
    g.fillStyle = T.primary; rr(g, 60, 556, bw, 70, 35); g.fill();
    g.fillStyle = T.text; g.fillText(p.cta, 92, 599);
    g.beginPath(); g.arc(60 + bw - 36, 591, 22, 0, TAU); g.fill(); arrow(g, 60 + bw - 36, 591, 9, T.primary, 3);
    if (p.rating) {
      const ax = 60 + bw + 40;
      [T.muted, mixHex(T.muted, T.bg, 0.4), T.text, T.secondary, T.primary].forEach((col, k) => {
        g.fillStyle = col; g.strokeStyle = T.bg; g.lineWidth = 4; g.beginPath(); g.arc(ax + k * 30, 591, 22, 0, TAU); g.fill(); g.stroke();
      });
      font(g, 26, 800); g.fillStyle = T.text; g.fillText(p.rating.value, ax + 170, 588);
      font(g, 16, 500); g.fillStyle = T.muted; g.fillText(p.rating.label, ax + 170, 612);
    }
  } else if (i === 4) {
    g.save(); rr(g, 760, 170, 460, 470, 30); g.clip(); drawTile(g, T, 990, 405, 640, 1); g.restore();
    drawLogo(g, B.logo, 990, 405, 190, '#FFFFFF');
  } else if (i === 5 && p.chat) {
    g.fillStyle = mixHex(T.bg, '#FFFFFF', 0.05); rr(g, 830, 560, 410, 150, 26); g.fill();
    g.strokeStyle = rgba(T.text, 0.14); g.lineWidth = 2; g.stroke();
    g.fillStyle = T.primary; g.beginPath(); g.arc(874, 604, 22, 0, TAU); g.fill(); drawLogo(g, B.logo, 874, 604, 20, '#FFFFFF');
    font(g, 18, 800); g.fillStyle = T.text; g.fillText(p.chat.name, 908, 610);
    font(g, 20, 500); g.fillText(p.chat.message, 858, 656);
    for (let k = 0; k < 3; k++) {
      g.fillStyle = rgba(T.muted, 0.4 + 0.6 * hop(mod(lt, c.B), k * 0.1, 0.2));
      g.beginPath(); g.arc(868 + k * 18, 686, 5, 0, TAU); g.fill();
    }
  }
}

function poses(c: Ctx): Array<[number, number, number, number]> {
  return [[0, -34, 22, 3500], [1, 32, 16, 3500], [2, -12, 42, 3700], [Math.max(2.5, c.beats - 1), FRONT[0], FRONT[1], FRONT[2]]];
}

export default define({
  id: 'exploded-ui',
  title: 'Exploded UI layers',
  category: 'ui',
  summary: 'The brand’s own website hero (nav, headline, CTA, rating, media tile, AI chat bubble) separates into six floating 3D layers like a design-tool exploded view; the camera cuts to a new angle on each beat, then the layers snap back together, square to camera.',
  guidance: 'Use the real site headline (≤ 3 lines of ≤ 30 chars). Follow code-editor for a seamless "code becomes product" moment, and precede particle-morph (start "page").',
  label: 'SOFTWARE',
  params: Params,
  beats: { min: 3, max: 6, default: 4 },
  energy: 2,
  example: {
    headline: ['We Build Powerful Software,', 'Websites & AI-Driven', 'Solutions.'],
    rating: { value: '4.9', label: 'Trusted by businesses globally' },
    chat: { name: 'Assistant', message: 'What are we building today?' },
  },
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt;
    fillBg(g, T.bg);
    dotGrid(g, 0.05);
    glow(g, W / 2, H * 0.8, 1100, T.primary, 0.16 + 0.08 * beatPulse(lt, c));
    let pose: [number, number, number] = [FRONT[0], FRONT[1], FRONT[2]];
    for (const [t0, y, pt, D] of poses(c)) {
      if (lt < b(t0)) break;
      const k = E.outExpo(prog(lt, b(t0), b(t0 + 0.8)));
      pose = [lerp(pose[0], y, k), lerp(pose[1], pt, k), lerp(pose[2], D, k)];
    }
    const cam = orbitCam(pose[0], pose[1], pose[2]);
    const last = Math.max(2.5, c.beats - 1);
    const sep = E.outBack(prog(lt, 0, b(0.8)), 1.6) * (1 + 0.35 * E.outExpo(prog(lt, b(2), b(2.6)))) * (1 - E.inOutCubic(prog(lt, b(last), b(last + 0.6))));
    const n = p.chat ? 6 : 5;
    for (let i = 0; i < n; i++) {
      g.save();
      if (onPage(g, cam, -i * 175 * sep)) {
        if (i > 0 && sep > 0.02) {
          g.save(); g.globalAlpha = clamp(sep); g.strokeStyle = 'rgba(241,239,237,.22)'; g.lineWidth = 2; g.setLineDash([14, 12]);
          rr(g, 0, 0, PW, PH, 26); g.stroke(); g.restore();
          if (p.labels) {
            g.save(); g.globalAlpha = clamp(sep); font(g, 30, 700, 'mono'); g.letterSpacing = '4px'; g.fillStyle = T.secondary; g.textAlign = 'right';
            g.fillText(LABELS[i], -34, 44 + i * 34); g.restore();
          }
        }
        layer(g, i, lt, p, c);
      }
      g.restore();
    }
    cap(g, c, ['EXPLODED VIEW', ['6 LAYERS', 'CAMERA CUTS ON THE BEAT', 'ORBIT', 'ASSEMBLE'][clamp(Math.floor(lt / c.B), 0, 3)]], 'tl', T.bg);
  },
  sfx(A, t0, _p, c) {
    const b = c.bt;
    impact(A, t0, 0.7);
    for (let i = 0; i < 6; i++) pop(A, t0 + i * 0.035, 67 + i * 2, 0.12, (i / 5) * 1.2 - 0.6);
    [1, 2].forEach(k => whoosh(A, t0 + b(k) - 0.05, 0.3, 0.22, -0.7, 0.7, 600, 3000));
    const last = Math.max(2.5, c.beats - 1);
    whoosh(A, t0 + b(last) - 0.05, 0.35, 0.22, 0.7, -0.7, 4000, 500);
    tom(A, t0 + b(last + 0.5), c.music.chordAt(t0).bass + 12, 0.4);
  },
  hits: () => [{ at: 0, shake: 16, punch: 0.03 }],
  fast: (_p, c) => [[0, c.bt(0.6)], [c.bt(1), c.bt(1.5)], [c.bt(2), c.bt(2.6)], [c.bt(Math.max(2.5, c.beats - 1)), c.bt(Math.max(2.5, c.beats - 1) + 0.5)]],
});
