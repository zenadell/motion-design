import { z } from 'zod';
import { impact, keyclick, kick, pad, pop, shing, stab, sub, whoosh } from '../audio/synth';
import { drawLogo, drawTile, logoWidth } from '../assets/logo';
import { mix, rgba } from '../core/color';
import { blade, caption, fillBg, glow, H, rr, W, type G } from '../core/draw';
import { clamp, E, prog, pulse, TAU } from '../core/math';
import { beatPulse } from './_shared';
import { define, type Ctx } from './types';

const DIRS = ['left', 'right', 'top', 'bottom', 'diagonal', 'rotate'] as const;
const Piece = z.object({
  rects: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).min(1).max(4)
    .describe('Clip rectangles [x, y, w, h] as fractions (0..1) of the logo bounds'),
  from: z.enum(DIRS),
});
const Params = z.object({
  pieces: z.array(Piece).min(1).max(5).optional().describe('How the mark is cut up; default is three horizontal bands'),
  tile: z.boolean().optional().describe('Land on the app tile (defaults to brand.tile)'),
  burst: z.boolean().default(true).describe('Light rays on the downbeat'),
});
type P = z.output<typeof Params>;

const DEFAULT_PIECES: z.output<typeof Piece>[] = [
  { rects: [[-0.05, -0.05, 1.1, 0.39]], from: 'left' },
  { rects: [[-0.05, 0.34, 1.1, 0.33]], from: 'diagonal' },
  { rects: [[-0.05, 0.67, 1.1, 0.4]], from: 'rotate' },
];

export const TILE = 760;
export function markHeight(g: G, c: Ctx, S: number): number {
  const aspect = logoWidth(g, c.brand.logo, 100) / 100;
  return Math.min(S * 0.473, (S * 0.62) / Math.max(aspect, 0.01));
}
const pieces = (p: P) => p.pieces ?? DEFAULT_PIECES;
const lockAt = (p: P) => pieces(p).length * 0.5;

export default define({
  id: 'logo-build',
  title: 'Logo build',
  category: 'brand',
  summary: 'The logomark assembles from pieces that fly in on the 8ths (slide, diagonal slash with the light blade, spin-in), locks with a flash, lands on the brand app-tile on the downbeat with a light-ray burst, then floats with a specular sweep.',
  guidance: 'The hero reveal before the end card. 4 beats. Define `pieces` with fractions of the logo bounds that follow the mark’s real strokes for the best effect.',
  label: 'IDENTITY',
  params: Params,
  beats: { min: 3, max: 8, default: 4 },
  energy: 1,
  hud: false,
  example: {},
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt, L = c.brand.logo;
    fillBg(g, T.bg);
    const cx = W / 2, cy = H / 2, S = TILE, h = markHeight(g, c, S), lw = logoWidth(g, L, h);
    const lock = b(lockAt(p)), burstAt = lock + b(0.5), useTile = p.tile ?? c.brand.tile;
    const ts = E.outBack(prog(lt, lock, lock + b(0.6)), 1.35), burst = p.burst ? pulse(lt, burstAt, 3.2) : 0;
    glow(g, cx, cy, 1300, T.primary, 0.12 + 0.35 * burst + (lt >= burstAt ? 0.08 * beatPulse(lt, c) : 0));
    if (p.burst && lt >= burstAt) {
      g.save(); g.globalCompositeOperation = 'lighter'; g.translate(cx, cy); g.rotate(lt * 0.15);
      for (let i = 0; i < 16; i++) {
        g.rotate(TAU / 16);
        const gr = g.createLinearGradient(0, 0, 1400, 0);
        gr.addColorStop(0, rgba(T.primary, 0.16 * burst)); gr.addColorStop(1, rgba(T.primary, 0));
        g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.lineTo(1400, -60); g.lineTo(1400, 60); g.closePath(); g.fill();
      }
      g.restore();
    }
    const fl = prog(lt, burstAt, burstAt + b(1.2));
    const tiltX = Math.sin((lt - burstAt) * 2.4) * 0.05 * fl, tiltY = Math.cos((lt - burstAt) * 2.0) * 0.04 * fl;
    g.save(); g.translate(cx, cy); g.transform(1, tiltY, tiltX, 1, 0, 0);
    const punch = 1 + 0.06 * pulse(lt, lock, 12) + 0.05 * pulse(lt, burstAt, 8);
    g.scale(punch, punch); g.translate(-cx, -cy);
    if (useTile && ts > 0) { g.save(); g.translate(cx, cy); g.scale(ts, ts); g.translate(-cx, -cy); drawTile(g, T, cx, cy, S, 0.4 + 0.6 * prog(lt, lock + b(0.1), burstAt)); g.restore(); }
    if (lt < lock) {
      pieces(p).forEach((pc, k) => {
        const q = E.outExpo(prog(lt, b(k * 0.5), b(k * 0.5 + 0.44)));
        if (q <= 0) return;
        g.save();
        const r = 1 - q;
        if (pc.from === 'left') g.translate(-1500 * r, 0);
        else if (pc.from === 'right') g.translate(1500 * r, 0);
        else if (pc.from === 'top') g.translate(0, -1100 * r);
        else if (pc.from === 'bottom') g.translate(0, 1100 * r);
        else if (pc.from === 'diagonal') g.translate(1100 * r, -1100 * r);
        else { g.translate(cx - lw * 0.25, cy + h * 0.25); g.rotate(-1.6 * r); g.translate(-(cx - lw * 0.25), -(cy + h * 0.25)); g.translate(-500 * r, 500 * r); }
        g.beginPath();
        for (const [fx, fy, fw, fh] of pc.rects) g.rect(cx - lw / 2 + fx * lw, cy - h / 2 + fy * h, fw * lw, fh * h);
        g.clip();
        drawLogo(g, L, cx, cy, h, T.text);
        g.restore();
        if (pc.from === 'diagonal') {
          const bk = pulse(lt, b(k * 0.5), 7);
          if (bk > 0.01) blade(g, cx, cy, 2600, bk);
        }
      });
    } else drawLogo(g, L, cx, cy, h, mix('#FFFFFF', T.text, prog(lt, lock, lock + b(0.9))));
    const sw = prog(lt, burstAt + b(0.4), burstAt + b(1.3));
    if (useTile && sw > 0 && sw < 1) {
      g.save(); rr(g, cx - S / 2, cy - S / 2, S, S, S * 0.225); g.clip();
      g.translate(cx + (sw * 2.2 - 1.1) * S, cy); g.rotate(-Math.PI / 4);
      const gr = g.createLinearGradient(-90, 0, 90, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(-90, -S, 180, S * 2); g.restore();
    }
    g.restore();
    g.globalAlpha = 0.7 * pulse(lt, lock, 18); fillBg(g, T.text); g.globalAlpha = 1;
    if (c.captions && lt < lock) {
      const k = clamp(Math.floor(lt / b(0.5)), 0, pieces(p).length - 1);
      caption(g, [`PIECE ${k + 1} / ${pieces(p).length}`, pieces(p)[k].from], 96, 150, rgba(T.text, 0.5));
    }
  },
  sfx(A, t0, p, c) {
    const b = c.bt, ch = c.music.chordAt(t0);
    pieces(p).forEach((pc, k) => {
      const at = t0 + b(k * 0.5);
      if (k === 0) { kick(A, at, 1); stab(A, at, [ch.bass + 12, ...ch.pad.slice(0, 2)], 0.09, 0.3, 1800); sub(A, at, 0.5, 0.4); }
      else if (pc.from === 'diagonal') { shing(A, at, 0.28); whoosh(A, at - 0.05, 0.25, 0.3, 0.8, -0.2, 6000, 1500); }
      else { kick(A, at, 0.9); whoosh(A, at - 0.05, 0.28, 0.26, -0.8, 0, 300, 2500); }
    });
    const lock = t0 + b(lockAt(p)), burst = lock + b(0.5);
    keyclick(A, lock, 0.14); pop(A, lock, 60, 0.18);
    kick(A, burst, 1.05); impact(A, burst, 0.95);
    stab(A, burst, [ch.bass + 12, ...ch.pad, ch.pad[0] + 24], 0.1, 0.9, 3000);
    pad(A, burst, t0 + c.dur, ch.pad, 0.03, 2200);
  },
  hits: (p, c) => {
    const k = pieces(p).map((pc, i) => ({ at: c.bt(i * 0.5), shake: pc.from === 'diagonal' ? 16 : 12 }));
    return [...k, { at: c.bt(lockAt(p)), shake: 8 }, { at: c.bt(lockAt(p) + 0.5), shake: 26, punch: 0.05 }];
  },
  fast: (p, c) => [[0, c.bt(lockAt(p) + 0.1)]],
  bed: (p, c) => [c.bt(lockAt(p) + 0.5), c.dur],
});
