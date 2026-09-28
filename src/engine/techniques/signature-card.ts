import { z } from 'zod';
import { bell, crash, kick, pad, sawBass, stab, sub } from '../audio/synth';
import { rgba } from '../core/color';
import { fillBg, H, kern, typeOn, W } from '../core/draw';
import { E, lerp, prog } from '../core/math';
import { font } from '../core/theme';
import { chordTones } from './_shared';
import { define } from './types';

export default define({
  id: 'signature-card',
  title: 'Signature card',
  category: 'outro',
  summary: 'A minimal editorial end frame for a person or studio: the name rises letter by letter from a mask as its weight grows, a brand-coloured dot flies in to become its full stop, a serif-italic role line fades up and a mono meta row types on. Resolves on a chord and a bell.',
  guidance: 'Personal reels and portfolios. 4 beats. Follows albers-colour perfectly (its final dot becomes the full stop).',
  label: 'END',
  params: z.object({
    name: z.string().min(1).max(18).optional().describe('Defaults to the brand name'),
    role: z.string().max(32).default('Motion Designer'),
    meta: z.tuple([z.string().max(32), z.string().max(48), z.string().max(32)]).optional(),
  }),
  beats: { min: 3, max: 8, default: 4 },
  energy: 0,
  hud: false,
  example: { role: 'Motion Designer', meta: ['SHOWREEL — 2026', 'TYPE · SHAPE · CAMERA · COLOUR', '120 BPM'] },
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt, name = p.name ?? c.brand.name;
    fillBg(g, T.bg);
    let size = 290;
    font(g, size, 760);
    if (g.measureText(name).width > W * 0.72) { size *= (W * 0.72) / g.measureText(name).width; font(g, size, 760); }
    const K = kern(g, name, -size * 0.04), dotR = size * 0.085, gap = size * 0.05;
    const x0 = Math.round(W / 2 - (K.total + gap + dotR * 2) / 2), base = 598;
    g.save(); g.beginPath(); g.rect(0, 0, W, base + size * 0.26); g.clip();
    g.fillStyle = T.text;
    for (let i = 0; i < name.length; i++) {
      const d = b(0.08 + i * 0.09), q = E.outExpo(prog(lt, d, d + b(1.2)));
      font(g, size, lerp(240, 760, E.outCubic(prog(lt, d + b(0.08), d + b(1.5)))));
      g.fillText(name[i], x0 + K.xs[i] + (K.ws[i] - g.measureText(name[i]).width) / 2, base + (1 - q) * size * 1.15);
    }
    g.restore();
    const dx = x0 + K.total + gap + dotR, dy = base - dotR, mp = E.outExpo(prog(lt, 0, b(0.84)));
    const cx = lerp(W / 2, dx, mp), cy = lerp(H / 2, dy, mp) - Math.sin(Math.PI * mp) * 150;
    const land = lt - b(0.84), sq = land > 0 ? 0.28 * Math.exp(-12 * land) * Math.cos(34 * land) : 0;
    const s = lt - b(2), bump = s < 0 ? 0 : s < 0.06 ? s / 0.06 : Math.exp(-9 * (s - 0.06));
    const r = lerp(40, dotR, E.outCubic(prog(lt, 0, b(0.84)))) * (1 + 0.34 * bump);
    g.fillStyle = T.primary; g.beginPath(); g.ellipse(cx, cy + r * sq, r * (1 + sq), r * (1 - sq), 0, 0, Math.PI * 2); g.fill();
    const rp = E.outExpo(prog(lt, b(0.84), b(2)));
    if (T.serif) font(g, 88, 400, 'serif', true); else font(g, 80, 300);
    g.globalAlpha = rp * 0.92; g.fillStyle = T.text; g.letterSpacing = `${lerp(14, 0, rp)}px`;
    g.fillText(p.role, x0 + size * 0.03, base + 122 + (1 - rp) * 26);
    g.letterSpacing = '0px'; g.globalAlpha = 1;
    if (p.meta) {
      const hp = E.inOutCubic(prog(lt, b(1.1), b(2.1)));
      g.fillStyle = rgba(T.text, 0.25); g.fillRect(64, H - 104, (W - 128) * hp, 1);
      font(g, 16, 500, 'mono'); g.letterSpacing = '3px'; g.fillStyle = rgba(T.text, 0.7);
      const tp = prog(lt, b(1.4), b(2.2));
      typeOn(g, p.meta[0].toUpperCase(), 64, H - 66, tp, 'left');
      typeOn(g, p.meta[1].toUpperCase(), W / 2, H - 66, tp, 'center');
      typeOn(g, p.meta[2].toUpperCase(), W - 64, H - 66, tp, 'right');
      g.letterSpacing = '0px';
    }
  },
  sfx(A, t0, _p, c) {
    const ch = c.music.chordAt(t0), hold = Math.max(0.5, c.dur - 0.1);
    kick(A, t0, 1.05); sub(A, t0, 0.9, 1.8); crash(A, t0, 0.3, 2.0);
    pad(A, t0, t0 + Math.min(hold, 1.95), [...ch.pad, ch.pad[0] + 12], 0.045);
    stab(A, t0, [...ch.pad, ch.pad[0] + 12], 0.08, 0.5, 5000);
    sawBass(A, t0, ch.bass - 12, 1.6, 0.35);
    const top = chordTones(ch.pad, 84, 2);
    bell(A, t0 + c.bt(2), top[0], 0.13);
    bell(A, t0 + c.bt(2), top[1] + 12, 0.05);
  },
  hits: () => [{ at: 0, shake: 10, punch: 0.02 }],
  bed: () => [0, 0],
});
