import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath } from '../cli/render';

// The detail inspector for exact copies. A critic watching a small clip sees
// the overall impression but not an 8-px gutter, a glow that is five times too
// big, or a pop-in that should bounce. This module measures those things on
// matched frames of the reference and the render (content size, gaps between
// elements, the area of coloured glow and haze, spring overshoot, timing
// offset) and builds full-resolution side-by-side stills and zoomed crops of
// the moments that differ most, for the critic and the coder to look at.

export interface RGB { w: number; h: number; data: Uint8Array }
/** A box in fractions of the frame. */
export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Overshoot { t: number; pct: number; settle: number }

function ffmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`))));
  });
}

/** Frames of a video (or one image) as raw RGB at a fixed rate and size. */
export async function decode(file: string, o: { from?: number; dur?: number; fps?: number; w: number; h: number }): Promise<RGB[]> {
  const raw = await ffmpeg([
    ...(o.from ? ['-ss', o.from.toFixed(3)] : []), ...(o.dur ? ['-t', o.dur.toFixed(3)] : []), '-i', file,
    '-vf', `${o.fps ? `fps=${o.fps},` : ''}scale=${o.w}:${o.h}:flags=area`, ...(o.fps ? [] : ['-frames:v', '1']),
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ]);
  const n = o.w * o.h * 3, out: RGB[] = [];
  for (let i = 0; i + n <= raw.length; i += n) out.push({ w: o.w, h: o.h, data: raw.subarray(i, i + n) });
  return out;
}

// ── one frame ─────────────────────────────────────────────────────────────────

/** Background colour: the per-channel median of the frame's border. */
export function background(f: RGB): [number, number, number] {
  const ch: number[][] = [[], [], []];
  const push = (x: number, y: number) => { const i = (y * f.w + x) * 3; for (let c = 0; c < 3; c++) ch[c].push(f.data[i + c]); };
  for (let x = 0; x < f.w; x++) { push(x, 0); push(x, 1); push(x, f.h - 1); push(x, f.h - 2); }
  for (let y = 0; y < f.h; y++) { push(0, y); push(1, y); push(f.w - 1, y); push(f.w - 2, y); }
  return ch.map(v => v.sort((a, b) => a - b)[v.length >> 1]) as [number, number, number];
}

/**
 * Pixel classes against the background: `content` is anything solid (neutral
 * shapes and text, or strongly saturated colour); `tint` is pale or muted
 * colour (glows, haze, tinted shadows and motion-blur fringes).
 */
export function classify(f: RGB, bg = background(f)) {
  const n = f.w * f.h, content = new Uint8Array(n), tint = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const r = f.data[p * 3], g = f.data[p * 3 + 1], b = f.data[p * 3 + 2];
    const d = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (sat > 12 && sat <= 70 && d > 8) tint[p] = 1;
    else if (d > 18) content[p] = 1;
  }
  return { content, tint };
}

/** The box around a mask, ignoring rows and columns with fewer than `min` pixels. */
export function boxOf(mask: Uint8Array, w: number, h: number, min = 2): Box | null {
  const cols = new Uint32Array(w), rows = new Uint32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { cols[x]++; rows[y]++; }
  let x0 = -1, x1 = -1, y0 = -1, y1 = -1;
  for (let x = 0; x < w; x++) if (cols[x] >= min) { if (x0 < 0) x0 = x; x1 = x; }
  for (let y = 0; y < h; y++) if (rows[y] >= min) { if (y0 < 0) y0 = y; y1 = y; }
  return x0 < 0 || y0 < 0 ? null : { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
}

/**
 * Gaps between elements: runs of background with content on both sides that
 * line up over at least `minLen` of the frame (a gutter between cards, not the
 * space between two letters of small text). Widths in px at 1920×1080.
 */
export function gaps(mask: Uint8Array, w: number, h: number, dir: 'vertical' | 'horizontal', minLen = 0.12): { at: number; px: number; len: number }[] {
  const W = dir === 'vertical' ? w : h, H = dir === 'vertical' ? h : w;
  const get = (a: number, b: number) => (dir === 'vertical' ? mask[b * w + a] : mask[a * w + b]);
  const hits = new Uint32Array(W);
  const maxRun = Math.max(2, Math.round(W * 0.04));
  for (let b = 0; b < H; b++) {
    let last = -1;
    for (let a = 0; a < W; a++) {
      if (!get(a, b)) continue;
      if (last >= 0 && a - last - 1 >= 1 && a - last - 1 <= maxRun) for (let k = last + 1; k < a; k++) hits[k]++;
      last = a;
    }
  }
  const out: { at: number; px: number; len: number }[] = [];
  const need = minLen * H, scale = (dir === 'vertical' ? 1920 : 1080) / W;
  for (let a = 0; a < W; a++) {
    if (hits[a] < need) continue;
    let e = a, most = hits[a];
    while (e + 1 < W && hits[e + 1] >= need) most = Math.max(most, hits[++e]);
    const px = Math.round((e - a + 1) * scale);
    // a gutter is at least a few px wide; thinner runs are anti-aliasing or letter spacing
    if (px >= 4) out.push({ at: (a + e + 1) / 2 / W, px, len: most / H });
    a = e;
  }
  // the longest few: the gutters that structure the layout
  return out.sort((x, y) => y.len - x.len).slice(0, 3).sort((x, y) => x.at - y.at);
}

/** The region (fractions) around the cell where two same-size frames differ most. */
export function hottest(a: RGB, b: RGB, grid = 12, size = 0.4): Box {
  const cw = Math.floor(a.w / grid), ch = Math.floor(a.h / grid);
  let best = { d: -1, gx: 0, gy: 0 };
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
    let s = 0;
    for (let y = gy * ch; y < (gy + 1) * ch; y++) for (let x = gx * cw; x < (gx + 1) * cw; x++) { const p = y * a.w + x; s += Math.abs(lum(a, p) - lum(b, p)); }
    if (s > best.d) best = { d: s, gx, gy };
  }
  const cx = (best.gx + 0.5) / grid, cy = (best.gy + 0.5) / grid, hw = size / 2;
  const x0 = Math.min(1 - size, Math.max(0, cx - hw)), y0 = Math.min(1 - size, Math.max(0, cy - hw));
  return { x0, y0, x1: x0 + size, y1: y0 + size };
}

const hex = (c: number[]) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

type Gap = { at: number; px: number; len: number };
export interface FrameStats { bg: string; box: Box | null; fill: number; tint: number; tintColour: string; tintBox: Box | null; vGaps: Gap[]; hGaps: Gap[] }

export function frameStats(f: RGB): FrameStats {
  const bg = background(f);
  const { content, tint } = classify(f, bg);
  let nc = 0, nt = 0;
  const sum = [0, 0, 0];
  for (let p = 0; p < content.length; p++) {
    nc += content[p];
    if (tint[p]) { nt++; for (let c = 0; c < 3; c++) sum[c] += f.data[p * 3 + c]; }
  }
  const n = f.w * f.h;
  return {
    bg: hex(bg), box: boxOf(content, f.w, f.h), fill: nc / n, tint: nt / n, tintColour: nt ? hex(sum.map(s => s / nt)) : '-',
    tintBox: boxOf(tint, f.w, f.h, 3), vGaps: gaps(content, f.w, f.h, 'vertical'), hGaps: gaps(content, f.w, f.h, 'horizontal'),
  };
}

// ── motion ────────────────────────────────────────────────────────────────────

const lum = (f: RGB, p: number) => 0.2126 * f.data[p * 3] + 0.7152 * f.data[p * 3 + 1] + 0.0722 * f.data[p * 3 + 2];

/** Mean absolute luminance difference between two frames of the same size (0–255). */
export function frameDiff(a: RGB, b: RGB): number {
  let s = 0;
  const n = a.w * a.h;
  for (let p = 0; p < n; p++) s += Math.abs(lum(a, p) - lum(b, p));
  return s / n;
}

/** How much each frame changes from the one before. */
export const energy = (fr: RGB[]) => fr.map((f, k) => (k ? frameDiff(fr[k - 1], f) : 0));

/** The shift (frames) of `b` against `a` with the best correlation: positive means b happens later. */
export function lagOf(a: number[], b: number[], maxShift: number): { shift: number; corr: number } {
  const norm = (v: number[]) => { const m = v.reduce((x, y) => x + y, 0) / Math.max(1, v.length); const d = Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0)) || 1; return v.map(x => (x - m) / d); };
  const A = norm(a), B = norm(b);
  let best = { shift: 0, corr: -Infinity };
  for (let s = -maxShift; s <= maxShift; s++) {
    let c = 0;
    for (let i = 0; i < A.length; i++) { const j = i + s; if (j >= 0 && j < B.length) c += A[i] * B[j]; }
    if (c > best.corr) best = { shift: s, corr: c };
  }
  return best;
}

/**
 * Pop-ins that overshoot and settle (a spring), found in a size series (the
 * content box's width or height per frame): a peak above the level it then
 * settles at, reached from well below it.
 */
export function overshoots(s: number[], fps: number, minPct = 0.02): Overshoot[] {
  const out: Overshoot[] = [];
  const look = Math.round(0.7 * fps), back = Math.round(0.6 * fps);
  for (let k = 1; k < s.length - 3; k++) {
    if (!(s[k] >= s[k - 1] && s[k] > s[k + 1] && s[k] > 0.02)) continue;
    let j = k + 1, plateau = -1;
    for (; j < Math.min(s.length - 2, k + look); j++) {
      const w = [s[j], s[j + 1], s[j + 2]];
      if (Math.max(...w) - Math.min(...w) <= 0.004 * Math.max(...w)) { plateau = (w[0] + w[1] + w[2]) / 3; break; }
    }
    if (plateau <= 0) continue;
    const pct = (s[k] - plateau) / plateau;
    if (pct < minPct || pct > 0.4) continue;
    let start = -1;
    for (let r = k - 1; r >= Math.max(0, k - back); r--) if (s[r] <= plateau * 0.9) { start = r; break; }
    if (start < 0) continue;
    if (out.length && k / fps - out[out.length - 1].t < 0.25) continue;
    out.push({ t: k / fps, pct, settle: (j - start) / fps });
  }
  return out;
}

/** S.spring(t, stiffness, damping) settings with this overshoot and settling time (2% band). */
export function springFor(pct: number, settle: number): { stiffness: number; damping: number } {
  const L = Math.log(Math.max(0.005, Math.min(0.5, pct)));
  const z = -L / Math.sqrt(Math.PI ** 2 + L * L);
  const w = 4 / (z * Math.max(0.12, settle));
  return { stiffness: Math.round(w * w), damping: Math.round(2 * z * w) };
}

// ── images ────────────────────────────────────────────────────────────────────

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);

/** Reference frame (from the source video at `at` seconds) | render still (PNG file), optionally cropped to a region. */
async function pairImage(refFile: string, at: number, copyPng: string, region?: Box): Promise<Buffer> {
  const crop = region
    ? `,crop=${even((region.x1 - region.x0) * 1920)}:${even((region.y1 - region.y0) * 1080)}:${even(region.x0 * 1920)}:${even(region.y0 * 1080)},scale=800:-2`
    : ',scale=960:540';
  return ffmpeg([
    '-ss', at.toFixed(3), '-i', refFile, '-i', copyPng,
    '-filter_complex', `[0:v]scale=1920:1080${crop},setsar=1,pad=iw+12:ih:0:0:color=black[a];[1:v]scale=1920:1080${crop},setsar=1[b];[a][b]hstack=inputs=2`,
    '-frames:v', '1', '-f', 'mjpeg', '-q:v', '3', 'pipe:1',
  ]);
}

const union = (a: Box | null, b: Box | null): Box | null => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const pad = (b: Box, p: number): Box => ({ x0: Math.max(0, b.x0 - p), y0: Math.max(0, b.y0 - p * 1.78), x1: Math.min(1, b.x1 + p), y1: Math.min(1, b.y1 + p * 1.78) });

// ── the report ────────────────────────────────────────────────────────────────

export interface Detail {
  /** Measurements in words, for the critic and the coder. */
  report: string;
  images: { label: string; jpg: Buffer }[];
  /** Seconds from the scene start of the inspected moments. */
  times: number[];
  lag?: number;
  bounce: { ref: Overshoot[]; copy: Overshoot[] };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const boxText = (b: Box | null) => (b ? `x ${pct(b.x0)}–${pct(b.x1)}, y ${pct(b.y0)}–${pct(b.y1)} (${Math.round((b.x1 - b.x0) * 1920)}×${Math.round((b.y1 - b.y0) * 1080)} px)` : 'nothing');
const gapText = (g: Gap[]) => (g.length ? g.map(x => `${x.px} px at ${pct(x.at)}`).join(', ') : 'none');

/**
 * Compare a rendered scene with its reference segment: measurements plus
 * side-by-side stills of the moments that differ most.
 */
export async function inspectScene(o: { refFile: string; from: number; to: number; clip: Buffer; stillAt: (t: number) => Promise<Buffer>; maxMoments?: number }): Promise<Detail> {
  const dir = mkdtempSync(join(tmpdir(), 'motion-inspect-'));
  try {
    const clipFile = join(dir, 'clip.mp4');
    writeFileSync(clipFile, o.clip);
    const fps = 24, dur = Math.max(0.3, o.to - o.from);
    const [refM, copyM] = await Promise.all([
      decode(o.refFile, { from: o.from, dur, fps, w: 320, h: 180 }),
      decode(clipFile, { fps, w: 320, h: 180 }),
    ]);
    const n = Math.min(refM.length, copyM.length);
    if (n < 4) return { report: '', images: [], times: [], bounce: { ref: [], copy: [] } };
    const eRef = energy(refM.slice(0, n)), eCopy = energy(copyM.slice(0, n));

    // timing: how far the render's motion is shifted against the reference
    const lag = lagOf(eRef, eCopy, Math.round(0.75 * fps));
    const lagS = lag.corr > 0.3 && Math.abs(lag.shift) >= 2 ? lag.shift / fps : undefined;

    // bounce: overshoot in the size of the content box
    const series = (fr: RGB[]) => {
      const bs = fr.slice(0, n).map(f => boxOf(classify(f).content, f.w, f.h));
      return { w: bs.map(b => (b ? b.x1 - b.x0 : 0)), h: bs.map(b => (b ? b.y1 - b.y0 : 0)) };
    };
    const sRef = series(refM), sCopy = series(copyM);
    const bounceOf = (s: { w: number[]; h: number[] }) => [...overshoots(s.w, fps), ...overshoots(s.h, fps)].sort((a, b) => a.t - b.t).filter((x, i, a) => !i || x.t - a[i - 1].t >= 0.25);
    const bounce = { ref: bounceOf(sRef), copy: bounceOf(sCopy) };

    // the moments to inspect: where the reference holds still (details are readable) and the two differ most
    const cand: { k: number; d: number; e: number }[] = [];
    for (let k = 2; k < n; k += Math.round(fps / 4)) {
      const e = eRef.slice(Math.max(1, k - 2), k + 3).reduce((a, b) => a + b, 0) / 5;
      cand.push({ k, d: frameDiff(refM[k], copyM[k]), e });
    }
    const medE = [...cand].sort((a, b) => a.e - b.e)[cand.length >> 1]?.e ?? 0;
    const picked: number[] = [];
    const take = (list: typeof cand) => { for (const c of list) if (picked.length < (o.maxMoments ?? 3) && picked.every(k => Math.abs(k - c.k) >= fps * 0.4)) picked.push(c.k); };
    take(cand.filter(c => c.e <= medE).sort((a, b) => b.d - a.d).slice(0, 2));
    take([...cand].sort((a, b) => b.d - a.d));
    picked.sort((a, b) => a - b);

    const lines: string[] = [];
    const images: Detail['images'] = [];
    for (const [idx, k] of picked.entries()) {
      const t = k / fps;
      const png = join(dir, `copy-${k}.png`);
      writeFileSync(png, await o.stillAt(t));
      const [refHi] = await decode(o.refFile, { from: o.from + t, dur: 0.1, fps, w: 960, h: 540 });
      const [copyHi] = await decode(png, { w: 960, h: 540 });
      if (!refHi || !copyHi) continue;
      const a = frameStats(refHi), b = frameStats(copyHi);
      const ratio = (x: Box | null, y: Box | null, dim: 'w' | 'h') => {
        if (!x || !y) return '';
        const f = dim === 'w' ? (y.x1 - y.x0) / Math.max(1e-3, x.x1 - x.x0) : (y.y1 - y.y0) / Math.max(1e-3, x.y1 - x.y0);
        return Math.abs(f - 1) < 0.06 ? '' : `${f.toFixed(2)}× ${dim === 'w' ? 'as wide' : 'as tall'}`;
      };
      const size = [ratio(a.box, b.box, 'w'), ratio(a.box, b.box, 'h')].filter(Boolean).join(', ');
      const tintF = a.tint > 0.002 ? b.tint / a.tint : b.tint > 0.01 ? Infinity : 1;
      lines.push(`At t=${t.toFixed(2)} s (image ${idx + 1}):`,
        `  content: reference ${boxText(a.box)}; yours ${boxText(b.box)}${size ? ` → yours is ${size}` : ''}`,
        `  glow/haze (pale coloured pixels): reference ${(a.tint * 100).toFixed(1)}% of the frame (${a.tintColour}, ${boxText(a.tintBox)}); yours ${(b.tint * 100).toFixed(1)}% (${b.tintColour}, ${boxText(b.tintBox)})${tintF > 1.8 ? ` → yours is ${tintF === Infinity ? 'far' : `${tintF.toFixed(1)}×`} larger: tighten it` : tintF < 0.55 ? ' → yours is much weaker' : ''}`,
        `  longest gutters between elements (rough; light cards on a light background can hide theirs): reference vertical ${gapText(a.vGaps)} · horizontal ${gapText(a.hGaps)}; yours vertical ${gapText(b.vGaps)} · horizontal ${gapText(b.hGaps)}`,
        `  background: reference ${a.bg}, yours ${b.bg}`);
      images.push({ label: `IMAGE ${idx + 1}: t=${t.toFixed(2)} s, REFERENCE (left) | YOUR RENDER (right)`, jpg: await pairImage(o.refFile, o.from + t, png) });
      if (idx < 2) {
        // zoom: on the content when it is compact, else on where the two frames differ most
        const u = union(a.box, b.box);
        const small = u && (u.x1 - u.x0) * (u.y1 - u.y0) < 0.4;
        const region = small ? pad(u!, 0.03) : hottest(refHi, copyHi);
        images.push({ label: `IMAGE ${idx + 1} ZOOMED on ${small ? 'the content' : 'the area that differs most'}: REFERENCE (left) | YOUR RENDER (right)`, jpg: await pairImage(o.refFile, o.from + t, png, region) });
      }
    }
    const bl = (b: Overshoot[]) => b.map(x => `${Math.round(x.pct * 100)}% at ${x.t.toFixed(2)} s, settles in ${x.settle.toFixed(2)} s`).join('; ');
    const avg = (b: Overshoot[], f: (x: Overshoot) => number) => b.reduce((s, x) => s + f(x), 0) / Math.max(1, b.length);
    if (bounce.ref.length || bounce.copy.length) {
      const sp = bounce.ref.length ? springFor(avg(bounce.ref, x => x.pct), avg(bounce.ref, x => x.settle)) : undefined;
      lines.push(`Bounce (overshoot of the content's size): reference ${bounce.ref.length ? bl(bounce.ref) : 'none'}; yours ${bounce.copy.length ? bl(bounce.copy) : 'none'}${sp && bounce.copy.length < bounce.ref.length ? ` → pop elements in with a spring like the reference: S.spring(t, ${sp.stiffness}, ${sp.damping})` : ''}`);
    }
    if (lagS !== undefined) lines.push(`Timing: your motion runs ${Math.abs(lagS).toFixed(2)} s ${lagS < 0 ? 'EARLY' : 'LATE'} against the reference → move your keyframes ${Math.abs(lagS).toFixed(2)} s ${lagS < 0 ? 'later' : 'earlier'}`);
    const report = lines.length
      ? `DETAIL MEASUREMENTS (reference vs your render, measured on matched frames; sizes in px at 1920×1080; approximate)\n${lines.join('\n')}`
      : '';
    return { report, images, times: picked.map(k => k / fps), lag: lagS, bounce };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Sharp stills of a reference segment at its stillest moments, for the coder before it writes. */
export async function referenceStills(refFile: string, from: number, to: number, count = 3): Promise<{ t: number; jpg: Buffer }[]> {
  const fps = 12, dur = Math.max(0.3, to - from);
  const fr = await decode(refFile, { from, dur, fps, w: 192, h: 108 });
  if (!fr.length) return [];
  const e = energy(fr);
  const score = fr.map((_, k) => e.slice(Math.max(1, k - 1), k + 2).reduce((a, b) => a + b, 0));
  const picked: number[] = [];
  // spread over the segment: the stillest frame in each of `count` equal parts
  for (let p = 0; p < count; p++) {
    const a = Math.floor((p * fr.length) / count), b = Math.max(a + 1, Math.floor(((p + 1) * fr.length) / count));
    let best = a;
    for (let k = a; k < b; k++) if (score[k] < score[best]) best = k;
    picked.push(best);
  }
  return Promise.all(picked.map(async k => ({
    t: k / fps,
    jpg: await ffmpeg(['-ss', (from + k / fps).toFixed(3), '-i', refFile, '-vf', 'scale=1280:-2', '-frames:v', '1', '-f', 'mjpeg', '-q:v', '3', 'pipe:1']),
  })));
}
