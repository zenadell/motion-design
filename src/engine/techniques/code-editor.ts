import { z } from 'zod';
import { bell, blip, impact, keyclick } from '../audio/synth';
import { orbitCam } from '../core/camera';
import { mixHex } from '../core/color';
import { checkMark, dotGrid, fillBg, glow, H, rr, W, type G } from '../core/draw';
import { E, lerp, prog, TAU } from '../core/math';
import { font, type Theme } from '../core/theme';
import { beatPulse, cap } from './_shared';
import { FRONT, onPage, PH, PW } from './_page';
import { define, type Ctx } from './types';

const KW = new Set('import from export default const let var await async function return new if else for while class extends def print true false null undefined in of type interface yield'.split(' '));
const TOK = /(\/\/.*$|#.*$)|('(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?|`[^`]*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)|(\s+)|([^\w\s])/g;

type Kind = 'cm' | 'str' | 'num' | 'fn' | 'kw' | 'id' | 'ws' | 'p';
function tokenize(line: string): Array<[string, Kind]> {
  const out: Array<[string, Kind]> = [];
  for (const m of line.matchAll(TOK)) {
    const k: Kind = m[1] ? 'cm' : m[2] ? 'str' : m[3] ? 'num' : m[4] ? 'fn' : m[5] ? (KW.has(m[5]) ? 'kw' : 'id') : m[6] ? 'ws' : 'p';
    out.push([m[0], k]);
  }
  return out;
}
function tokColor(T: Theme, k: Kind): string {
  return k === 'kw' ? T.primary : k === 'str' || k === 'num' ? T.secondary : k === 'fn' ? '#FFFFFF' : k === 'cm' ? mixHex(T.text, T.bg, 0.6) : k === 'p' ? T.muted : T.text;
}

interface Sched { typed: number[]; per: number; term: number }
function schedule(lines: string[], beats: number): Sched {
  const idx = lines.map((l, i) => (l.trim() ? i : -1)).filter(i => i >= 0);
  const per = Math.min(0.5, (beats - 1) / Math.max(1, idx.length));
  const typed = lines.map(() => -1);
  idx.forEach((li, k) => (typed[li] = k * per));
  return { typed, per, term: idx.length * per };
}

function drawEditor(g: G, lt: number, p: { filename: string; lines: string[]; command: string; result: string }, c: Ctx, S: Sched): void {
  const T = c.theme, b = c.bt;
  const panel = mixHex(T.bg, '#FFFFFF', 0.05), bar = mixHex(T.bg, '#FFFFFF', 0.025);
  g.save(); rr(g, 0, 0, PW, PH, 24); g.fillStyle = panel; g.fill(); g.clip();
  g.fillStyle = bar; g.fillRect(0, 0, PW, 64);
  [T.primary, T.secondary, T.muted].forEach((col, i) => { g.fillStyle = col; g.beginPath(); g.arc(34 + i * 28, 32, 8, 0, TAU); g.fill(); });
  rr(g, 130, 14, 190, 50, 10); g.fillStyle = panel; g.fill();
  font(g, 17, 500, 'mono'); g.fillStyle = T.text; g.fillText(p.filename, 158, 45);
  g.fillStyle = T.primary; g.fillRect(142, 36, 6, 6);
  g.fillStyle = T.muted; g.textAlign = 'right'; g.fillText(`${c.brand.name.toLowerCase()} — main`, PW - 30, 40); g.textAlign = 'left';
  const lh = 50, top = 118;
  let active = 0;
  S.typed.forEach((at, i) => { if (at >= 0 && lt >= b(at)) active = i; });
  g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(0, top + active * lh - 34, PW, lh);
  font(g, 27, 500, 'mono');
  const cw = g.measureText('M').width;
  p.lines.forEach((ln, i) => {
    const y = top + i * lh;
    font(g, 27, 500, 'mono'); g.fillStyle = mixHex(T.text, T.bg, 0.7); g.textAlign = 'right'; g.fillText(String(i + 1), 62, y); g.textAlign = 'left';
    if (S.typed[i] < 0 || lt < b(S.typed[i])) return;
    let left = Math.floor(prog(lt, b(S.typed[i]), b(S.typed[i] + S.per * 0.72)) * ln.length), x = 92;
    for (const [txt, k] of tokenize(ln)) {
      if (left <= 0) break;
      const part = txt.slice(0, left);
      left -= part.length;
      font(g, 27, k === 'fn' ? 700 : 500, 'mono'); g.fillStyle = tokColor(T, k); g.fillText(part, x, y);
      x += part.length * cw;
    }
    if (i === active && lt < b(S.term) && Math.floor(lt / b(0.25)) % 2 === 0) { g.fillStyle = T.primary; g.fillRect(x + 2, y - 26, 13, 32); }
  });
  const ty = 540;
  g.fillStyle = mixHex(T.bg, '#FFFFFF', 0.02); g.fillRect(0, ty, PW, PH - ty);
  g.fillStyle = mixHex(T.bg, '#FFFFFF', 0.1); g.fillRect(0, ty, PW, 2);
  font(g, 15, 600, 'mono'); g.letterSpacing = '3px'; g.fillStyle = T.muted; g.fillText('TERMINAL', 34, ty + 38); g.letterSpacing = '0px';
  const t0 = b(S.term);
  if (lt >= t0) {
    font(g, 26, 500, 'mono');
    g.fillStyle = T.primary; g.fillText('$', 34, ty + 96);
    g.fillStyle = T.text; g.fillText(p.command.slice(0, Math.floor(prog(lt, t0, t0 + b(0.2)) * p.command.length)), 64, ty + 96);
    const steps = (lt >= t0 + b(0.25) ? 1 : 0) + (lt >= t0 + b(0.5) ? 1 : 0) + (lt >= t0 + b(0.75) ? 1 : 0);
    for (let k = 0; k < 24; k++) { g.fillStyle = k < steps * 8 ? T.primary : mixHex(T.bg, '#FFFFFF', 0.1); g.fillRect(34 + k * 22, ty + 124, 16, 22); }
    font(g, 22, 600, 'mono'); g.fillStyle = T.muted; g.fillText(`${Math.round((steps / 3) * 100)}%`, 34 + 24 * 22 + 12, ty + 143);
    if (lt >= t0 + b(0.75)) {
      checkMark(g, 46, ty + 186, 12, T.primary, 4);
      font(g, 24, 600, 'mono'); g.fillStyle = T.text; g.fillText(p.result, 72, ty + 195);
    }
  }
  g.restore();
  g.save(); g.strokeStyle = 'rgba(241,239,237,.1)'; g.lineWidth = 2; rr(g, 0, 0, PW, PH, 24); g.stroke(); g.restore();
}

export default define({
  id: 'code-editor',
  title: '3D code editor',
  category: 'ui',
  summary: 'A code editor floating in 3D: lines type in on the 8ths with syntax highlighting and a blinking cursor while the camera drifts, then a terminal command runs, a progress bar fills on the 16ths and a success line appears. Ends square to camera.',
  guidance: 'Write 4–8 short code lines (≤ 60 chars) that tell the brand story as code. Blank strings make blank lines. Pairs perfectly with exploded-ui next.',
  label: 'SOFTWARE',
  params: z.object({
    filename: z.string().max(20).default('build.ts'),
    lines: z.array(z.string().max(64)).min(1).max(8),
    command: z.string().max(40).default('deploy --prod'),
    result: z.string().max(48).default('Deployed · live in 1.2s'),
  }),
  beats: { min: 3, max: 8, default: 4 },
  energy: 2,
  example: {
    lines: ["import { sketch, prototype } from '@northwind/kit'", '', 'const idea = sketch({ goal: "clarity" })', 'const app = await prototype(idea, {', "  platforms: ['web', 'ios'],", '})', '', 'app.launch()  // day one'],
  },
  draw(g, lt, p, c) {
    const T = c.theme, b = c.bt;
    fillBg(g, T.bg);
    dotGrid(g, 0.05);
    glow(g, W / 2, H * 0.8, 1100, T.primary, 0.16 + 0.08 * beatPulse(lt, c));
    const end = c.beats - 0.6;
    const yaw = lerp(24, -8, E.inOutCubic(prog(lt, 0, b(end)))), pitch = lerp(14, 5, E.inOutCubic(prog(lt, 0, b(end))));
    let D = lerp(7000, 2800, E.outExpo(prog(lt, 0, b(0.7))));
    D = lerp(D, 2300, E.inOutCubic(prog(lt, b(0.7), b(end))));
    const s = E.outExpo(prog(lt, b(c.beats - 0.5), b(c.beats - 0.04)));
    const cam = orbitCam(lerp(yaw, FRONT[0], s), lerp(pitch, FRONT[1], s), lerp(D, FRONT[2], s));
    const S = schedule(p.lines, c.beats);
    g.save();
    if (onPage(g, cam, 0)) drawEditor(g, lt, p, c, S);
    g.restore();
    cap(g, c, ['CODE → DEPLOY', 'TYPED ON THE BEAT'], 'tl', T.bg);
  },
  sfx(A, t0, p, c) {
    const b = c.bt, S = schedule(p.lines, c.beats);
    impact(A, t0, 0.6);
    for (let t = 0; t < S.term - 0.1; t += 0.25) keyclick(A, t0 + b(t), 0.055, Math.sin(t * 13) * 0.4);
    for (let k = 0; k < 4; k++) keyclick(A, t0 + b(S.term + k * 0.0625), 0.05);
    [0.25, 0.5, 0.75].forEach((o, i) => blip(A, t0 + b(S.term + o), 84 + i * 3, 0.05));
    bell(A, t0 + b(S.term + 0.75), 89, 0.06);
  },
  hits: () => [{ at: 0, shake: 8, punch: 0.02 }],
  fast: (_p, c) => [[c.bt(c.beats - 0.5), c.dur]],
});
