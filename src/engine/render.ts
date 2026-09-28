import type { Plan } from '../plan/schema';
import { makeBrand } from './assets/logo';
import { makeMusic, scoreBed, sidechain } from './audio/music';
import * as S from './audio/synth';
import { blade, fillBg, grain, H, halfPlane, makeLayer, NORM, W, type G } from './core/draw';
import { clamp, E, lerp, pad2, prog, pulse } from './core/math';
import { font, setTheme } from './core/theme';
import { makeTheme } from './core/theme-build';
import { buildTimeline, sectionIndexAt } from './core/timeline';
import { installCustom } from './custom/stage';
import { setCustomTechniques } from './techniques';
import type { Ctx } from './techniques/types';

export interface SectionInfo {
  index: number;
  technique: string;
  label: string;
  start: number;
  end: number;
  beats: number;
}

export interface Engine {
  duration: number;
  fps: number;
  bpm: number;
  sections: SectionInfo[];
  /** Draw frame at time t into `g` (the 1920×1080 output). sub > 1 = motion blur samples. */
  renderFrame(g: G, t: number, sub?: number): void;
  renderSoundtrack(sampleRate?: number): Promise<AudioBuffer>;
  /** Errors thrown by section code (first per section and phase), for automated repair. */
  errors: { where: string; message: string; stack?: string }[];
}

/** Reset drawing state but keep the current transform (screen shake). */
function resetState(g: G): void {
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.filter = 'none';
  g.letterSpacing = '0px';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  g.setLineDash([]);
}

export function createEngine(plan: Plan): Engine {
  const theme = makeTheme(plan.brand);
  setTheme(theme);
  const brand = makeBrand(plan.brand);
  const B0 = 60 / plan.music.bpm;
  const music = makeMusic(plan.music, B0);
  // Model-written scenes must be registered before the timeline resolves technique ids.
  const custom = plan.custom
    ? installCustom(plan.custom, { B: B0, start: 0, dur: 0, beats: 0, index: -1, fps: plan.meta.fps, theme, brand, music, captions: plan.meta.captions, energy: 0, bt: b => b * B0 })
    : undefined;
  setCustomTechniques(custom?.techniques ?? []);
  const errors: Engine['errors'] = [...(custom?.errors ?? [])];
  const report = (where: string, e: unknown) => {
    if (!errors.some(x => x.where === where)) errors.push({ where, message: String((e as Error)?.message ?? e), stack: (e as Error)?.stack?.split('\n').slice(0, 4).join('\n') });
  };
  const tl = buildTimeline(plan);
  const fps = plan.meta.fps, D = tl.duration, secs = tl.sections;

  const ctxs: Ctx[] = secs.map((s, i) => ({
    B: tl.B, start: s.start, dur: s.dur, beats: s.beats, index: i, fps, theme, brand, music,
    captions: plan.meta.captions,
    energy: s.energy,
    prev: i > 0 ? { technique: secs[i - 1].technique.id, params: secs[i - 1].params } : undefined,
    next: i + 1 < secs.length ? { technique: secs[i + 1].technique.id, params: secs[i + 1].params } : undefined,
    bt: (b: number) => b * tl.B,
  }));
  const call = <T,>(i: number, f: () => T, fallback: T): T => {
    try {
      return f();
    } catch (e) {
      console.error(`[motion] ${secs[i].technique.id} (section ${i}) failed:`, e);
      report(`${secs[i].technique.id}#${i}:sound`, e);
      return fallback;
    }
  };

  // Camera shake / zoom punches and heavy-motion-blur windows, in absolute time.
  const hits: Array<[number, number, number]> = [];
  const fast: Array<[number, number]> = [];
  secs.forEach((s, i) => {
    for (const h of call(i, () => s.technique.hits?.(s.params as never, ctxs[i]) ?? [], [])) hits.push([s.start + h.at, h.shake, h.punch ?? 0]);
    for (const [a, b] of call(i, () => s.technique.fast?.(s.params as never, ctxs[i]) ?? [], [])) fast.push([s.start + a, s.start + b]);
    if (s.transition) {
      fast.push([s.end - s.transition.dur, s.end + 0.02]);
      if (s.transition.type === 'flash' || s.transition.type === 'blade') hits.push([s.end, 14, 0.03]);
    }
  });
  // Hard cuts: motion-blur samples must never straddle these.
  const cuts = secs.slice(1).filter(s => !secs[s.index - 1].transition).map(s => s.start);

  const [L1, g1] = makeLayer(), [L2, g2] = makeLayer(), [SUB, gSub] = makeLayer();
  const erred = new Set<number>();
  // HUD chapters: consecutive sections that share a label share a number.
  const chapter: number[] = [], chapterStart: number[] = [];
  secs.forEach((s, i) => {
    const same = i > 0 && secs[i - 1].label === s.label;
    chapter.push(same ? chapter[i - 1] : i ? chapter[i - 1] + 1 : 0);
    chapterStart.push(same ? chapterStart[i - 1] : s.start);
  });

  function drawSection(g: G, i: number, t: number): void {
    const s = secs[i];
    g.save();
    resetState(g);
    try {
      s.technique.draw(g, t - s.start, s.params as never, ctxs[i]);
    } catch (e) {
      if (!erred.has(i)) {
        erred.add(i);
        console.error(`[motion] ${s.technique.id} (section ${i}) failed to draw:`, e);
        report(`${s.technique.id}#${i}:draw@${(t - s.start).toFixed(2)}s`, e);
      }
      fillBg(g, theme.bg);
    }
    g.restore();
  }

  function transition(g: G, i: number, t: number): void {
    const s = secs[i], tr = s.transition!, p = clamp((t - (s.end - tr.dur)) / tr.dur);
    g1.setTransform(1, 0, 0, 1, 0, 0);
    g2.setTransform(1, 0, 0, 1, 0, 0);
    drawSection(g1, i + 1, t);
    drawSection(g2, i, t);
    if (tr.type === 'blade') {
      const off = E.inExpo(p) * 1500;
      g.drawImage(L1, 0, 0);
      for (const sg of [-1, 1]) {
        g.save(); halfPlane(g, sg, off); g.clip(); g.drawImage(L2, NORM[0] * off * sg, NORM[1] * off * sg); g.restore();
      }
      const k = 1 - prog(p, 0.6, 1);
      blade(g, W / 2 - NORM[0] * off, H / 2 - NORM[1] * off, 3000, k);
      blade(g, W / 2 + NORM[0] * off, H / 2 + NORM[1] * off, 3000, k);
      blade(g, W / 2, H / 2, 3000 * E.outExpo(prog(p, 0, 0.2)), 1 - prog(p, 0.2, 0.8));
    } else if (tr.type === 'slice') {
      g.drawImage(L1, 0, 0);
      const n = 10, sh = H / n;
      for (let k = 0; k < n; k++) {
        const q = E.inExpo(clamp((p - k * 0.048) / (1 - k * 0.048)));
        g.drawImage(L2, 0, k * sh, W, sh + 1, (k % 2 ? 1 : -1) * q * (W + 120), k * sh, W, sh + 1);
      }
    } else if (tr.type === 'fade') {
      g.drawImage(L2, 0, 0);
      g.globalAlpha = E.inOutCubic(p); g.drawImage(L1, 0, 0); g.globalAlpha = 1;
    } else if (tr.type === 'slide') {
      const q = E.inOutExpo(p);
      g.drawImage(L2, 0, -H * q); g.drawImage(L1, 0, H * (1 - q));
    } else if (tr.type === 'zoom') {
      const q = E.inExpo(p);
      g.save(); g.translate(W / 2, H / 2); g.scale(lerp(0.9, 1, q), lerp(0.9, 1, q)); g.translate(-W / 2, -H / 2); g.drawImage(L1, 0, 0); g.restore();
      g.save(); g.globalAlpha = 1 - q; g.translate(W / 2, H / 2); g.scale(1 + 1.8 * q, 1 + 1.8 * q); g.translate(-W / 2, -H / 2); g.drawImage(L2, 0, 0); g.restore();
    } else if (tr.type === 'wipe') {
      const q = E.inOutCubic(p), first = q < 0.5;
      g.drawImage(first ? L2 : L1, 0, 0);
      const xa = first ? -700 : lerp(-700, W + 700, (q - 0.5) * 2), xb = first ? lerp(-700, W + 700, q * 2) : W + 700;
      g.fillStyle = theme.primary;
      g.beginPath(); g.moveTo(xa - 320, H + 60); g.lineTo(xa + 320, -60); g.lineTo(xb + 320, -60); g.lineTo(xb - 320, H + 60); g.closePath(); g.fill();
    } else {
      // flash: out plays through, then a white-hot flash across the cut
      g.drawImage(L2, 0, 0);
      g.globalAlpha = 0.9 * E.inExpo(p); fillBg(g, theme.text); g.globalAlpha = 1;
    }
  }

  function drawScene(g: G, t: number): void {
    g.setTransform(1, 0, 0, 1, 0, 0);
    resetState(g);
    let sx = 0, sy = 0, zp = 1;
    for (const [ht, amp, punch] of hits) {
      if (t < ht || t > ht + 0.5) continue;
      const e = amp * Math.exp(-(t - ht) * 13);
      sx += e * Math.sin((t - ht) * 91 + ht * 7);
      sy += e * Math.cos((t - ht) * 77 + ht * 3);
      zp += punch * pulse(t, ht, 9);
    }
    g.save();
    g.translate(W / 2 + sx, H / 2 + sy); g.scale(zp, zp); g.translate(-W / 2, -H / 2);
    const i = sectionIndexAt(tl, t), s = secs[i];
    if (s.transition && i + 1 < secs.length && t >= s.end - s.transition.dur) transition(g, i, t);
    else {
      drawSection(g, i, t);
      const prev = secs[i - 1];
      if (prev?.transition?.type === 'flash') {
        const f = 1 - prog(t, s.start, s.start + prev.transition.dur * 1.2);
        if (f > 0) { g.globalAlpha = 0.9 * f * f; fillBg(g, theme.text); g.globalAlpha = 1; }
      }
    }
    g.restore();
  }

  function hud(g: G, t: number): void {
    if (!plan.meta.hud) return;
    const i = sectionIndexAt(tl, t), s = secs[i], next = secs[i + 1];
    let a = s.hud ? 1 : 0;
    if (s.hud && next && !next.hud) a *= 1 - prog(t, s.end - 0.12, s.end);
    if (a <= 0.001) return;
    g.save();
    g.globalAlpha = a; g.globalCompositeOperation = 'difference'; g.fillStyle = '#FFFFFF';
    font(g, 18, 600, 'mono'); g.letterSpacing = '3px';
    const sp = E.outExpo(prog(t, chapterStart[i], chapterStart[i] + 0.3));
    g.save(); g.beginPath(); g.rect(60, 46, 700, 34); g.clip();
    g.fillText(`${pad2(chapter[i])}  ${s.label.toUpperCase()}`, 64, 72 + (1 - sp) * 32); g.restore();
    const tc = `${pad2(Math.floor(t))}:${pad2(Math.min(fps - 1, Math.floor((t % 1) * fps)))} / ${pad2(Math.floor(D))}:${pad2(Math.round((D % 1) * fps))}`;
    g.textAlign = 'right'; g.fillText(tc, W - 64, 72);
    const tcw = g.measureText(tc).width; g.textAlign = 'left';
    const bi = Math.floor(t / tl.B) % 4;
    for (let k = 0; k < 4; k++) {
      const x = W - 64 - tcw - 34 - (3 - k) * 20;
      if (k === bi) g.fillRect(x, 58, 11, 11); else g.fillRect(x + 4, 62, 3, 3);
    }
    const y = H - 50;
    g.globalAlpha = a * 0.35; g.fillRect(64, y, W - 128, 1);
    g.globalAlpha = a; g.fillRect(64, y - 1, (W - 128) * clamp(t / D), 3);
    secs.forEach((x, k) => { if (k && chapter[k] !== chapter[k - 1]) g.fillRect(64 + ((W - 128) * x.start) / D, y - 6, 1, 13); });
    font(g, 14, 600, 'mono'); g.letterSpacing = '3px';
    g.fillText(`${brand.name}${brand.suffix ? ' ' + brand.suffix : ''} — ${plan.meta.title}`.toUpperCase(), 64, y - 18);
    g.textAlign = 'right';
    g.fillText(`${plan.music.bpm} BPM${brand.site ? ' · ' + brand.site.toUpperCase() : ''}`, W - 64, y - 18);
    g.restore();
  }

  function renderFrame(g: G, t: number, sub = 1): void {
    t = clamp(t, 0, D - 1e-4);
    let shutter = 0.5 / fps;
    if (fast.some(([a, b]) => t >= a && t < b)) {
      sub = sub > 1 ? Math.max(sub, 8) : 3;
      shutter = 1 / fps;
    }
    if (sub <= 1) drawScene(g, t);
    else {
      g.setTransform(1, 0, 0, 1, 0, 0);
      let n = 0;
      const w = window as unknown as { __motion3d?: number };
      for (let k = 0; k < sub; k++) {
        const ts = Math.min(t + (shutter * k) / sub, D - 1e-4);
        if (cuts.some(c => t < c && ts >= c)) continue;
        const before = w.__motion3d ?? 0;
        drawScene(gSub, ts);
        // software WebGL is costly: frames that draw real 3D take two blur samples, not six
        if (k === 0 && (w.__motion3d ?? 0) !== before && sub > 2) { sub = 2; }
        g.globalAlpha = 1 / ++n;
        g.drawImage(SUB, 0, 0);
      }
      g.globalAlpha = 1;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    resetState(g);
    hud(g, t);
    grain(g, t, fps, plan.meta.grain);
  }

  async function renderSoundtrack(sampleRate = 44100): Promise<AudioBuffer> {
    const ac = new OfflineAudioContext(2, Math.ceil(sampleRate * D), sampleRate);
    const A = S.makeAudio(ac, plan.music.volume);
    secs.forEach((s, i) => call(i, () => s.technique.sfx?.(A, s.start, s.params as never, ctxs[i]), undefined));
    for (const s of secs) {
      const tr = s.transition;
      if (!tr) continue;
      const a = s.end - tr.dur;
      if (tr.type === 'blade') { S.whoosh(A, a - 0.07, tr.dur + 0.07, 0.3, -0.7, 0.7, 700, 6000); S.shing(A, a, 0.2); }
      else if (tr.type === 'slice') S.whoosh(A, a - 0.07, tr.dur + 0.07, 0.32, -0.7, 0.7, 700, 6000);
      else if (tr.type === 'fade') S.whoosh(A, a, tr.dur, 0.12, -0.3, 0.3, 400, 1800);
      else if (tr.type === 'slide') S.whoosh(A, a, tr.dur, 0.22, 0, 0, 3000, 500);
      else if (tr.type === 'zoom') { S.riser(A, Math.max(0, s.end - tr.dur * 2), s.end - 0.01, 0.2); S.swell(A, a, s.end, 0.2); }
      else if (tr.type === 'wipe') S.whoosh(A, a, tr.dur, 0.28, -0.9, 0.9, 600, 5000);
      else if (tr.type === 'flash') { S.swell(A, a, s.end, 0.22); S.crash(A, s.end, 0.22, 1.4); S.sub(A, s.end, 0.6, 0.8); }
    }
    if (custom?.score) {
      const M = { bpm: plan.music.bpm, beat: tl.B, duration: D, sections: secs.map(s => ({ id: s.technique.id.replace(/^scene:/, ''), start: s.start, end: s.end, beats: s.beats, energy: s.energy })) };
      try {
        custom.score(A, M);
      } catch (e) {
        console.error('[motion] custom score failed:', e);
        report('custom.score', e);
      }
    } else {
      const beds = secs.map((s, i) => call<[number, number]>(i, () => s.technique.bed?.(s.params as never, ctxs[i]) ?? [0, s.dur], [0, s.dur]));
      scoreBed(A, tl, music, beds);
    }
    sidechain(A);
    const v = 0.9 * plan.music.volume;
    A.out.gain.setValueAtTime(v, Math.max(0, D - 0.7));
    A.out.gain.linearRampToValueAtTime(0, Math.max(0.01, D - 0.02));
    return ac.startRendering();
  }

  return {
    duration: D,
    fps,
    bpm: plan.music.bpm,
    sections: secs.map(s => ({ index: s.index, technique: s.technique.id, label: s.label, start: s.start, end: s.end, beats: s.beats })),
    renderFrame,
    renderSoundtrack,
    errors,
  };
}

