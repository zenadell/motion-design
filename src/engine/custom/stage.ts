// The Stage: what model-written scene code runs against. A scene is the body
// of `function (g, t, S)` that draws one full 1920×1080 frame at scene-local
// time t; its sound is the body of `function (A, t0, S)`; a custom score is
// the body of `function (A, M)`. Everything here is deterministic, so frames
// can be rendered in any order, in parallel, with motion blur.
//
// The documentation a model reads is STAGE_DOCS below; keep the two in sync.

import { z } from 'zod';
import type { Custom, SceneCode } from '../../plan/schema';
import { parseChord, midi } from '../audio/chords';
import * as SY from '../audio/synth';
import type { Audio } from '../audio/synth';
import { drawLogo, logoWidth } from '../assets/logo';
import { hexToHsl, hslHex, mixHex, rgba } from '../core/color';
import { fitFont, H, resetCtx, W, type G } from '../core/draw';
import { clamp, E, lerp, mod, prog, pulse, rnd, TAU } from '../core/math';
import { font } from '../core/theme';
import type { Ctx, Technique } from '../techniques/types';
import { background, fluid, PRESET_DOCS, title } from './presets';
import { bloom, camera, drawOn, fxFactory, glowAt, ICON_LIST, iconPoints, iconPolys, kf, linear, logoPoints, morph, radial, spring, TOOLKIT_DOCS, typeAnim } from './toolkit';

// ── sandbox ─────────────────────────────────────────────────────────────────
// Scene code sees no DOM, network, timers or clocks (they would break
// determinism or reach outside the page), and Math.random is seeded per frame.
const SHADOW = 'window,document,globalThis,self,top,parent,frames,fetch,XMLHttpRequest,WebSocket,EventSource,navigator,location,localStorage,sessionStorage,indexedDB,Date,performance,setTimeout,setInterval,requestAnimationFrame,queueMicrotask,importScripts,Worker';
const PRELUDE = `"use strict"; const Math = __M; const ${SHADOW.split(',').map(n => `${n} = undefined`).join(', ')};\n`;

/** Compile a code body into a function. Throws SyntaxError with the label in the message. */
export function compile(params: string[], body: string, label: string): (...a: unknown[]) => unknown {
  try {
    return new Function(...params, '__M', `${PRELUDE}${body}\n//# sourceURL=${label}.js`) as (...a: unknown[]) => unknown;
  } catch (e) {
    throw new SyntaxError(`${label}: ${(e as Error).message}`);
  }
}

/** Syntax-check every code body in a plan's custom block (safe: nothing is executed). */
export function checkCustom(c: Custom | undefined): { path: string; message: string }[] {
  if (!c) return [];
  const out: { path: string; message: string }[] = [];
  const tryC = (path: string, params: string[], body: string | undefined) => {
    if (!body) return;
    try {
      compile(params, body, path);
    } catch (e) {
      out.push({ path, message: (e as Error).message });
    }
  };
  tryC('custom.lib', ['S'], c.lib);
  tryC('custom.score', ['A', 'M'], c.score);
  c.scenes.forEach((s, i) => {
    tryC(`custom.scenes[${i}].draw`, ['g', 't', 'S'], s.draw);
    tryC(`custom.scenes[${i}].sfx`, ['A', 't0', 'S'], s.sfx);
  });
  return out;
}

function seededMath(seed: number): Math {
  const M = Object.create(Math) as Math & { random: () => number };
  let s = (Math.floor(seed * 1000) ^ 0x9e3779b9) >>> 0;
  M.random = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return M;
}

// ── helpers exposed on S ────────────────────────────────────────────────────
const ease = {
  ...E,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  inBack: (t: number, s = 1.70158) => (s + 1) * t * t * t - s * t * t,
  outElastic: (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};

/** Smooth value noise in [0, 1], deterministic. */
export function noise(x: number, y = 0, z = 0): number {
  const fl = Math.floor, xi = fl(x), yi = fl(y), zi = fl(z);
  const f = (v: number) => v * v * (3 - 2 * v);
  const u = f(x - xi), v = f(y - yi), w = f(z - zi);
  const h = (a: number, b: number, c: number) => rnd(a * 73856093 + b * 19349663, c * 83492791 + 7);
  const l = (a: number, b: number, p: number) => a + (b - a) * p;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

export interface StageBase {
  W: number;
  H: number;
  TAU: number;
  bpm: number;
  beat: number;
  b(n: number): number;
  colors: Record<'bg' | 'text' | 'primary' | 'secondary' | 'accent' | 'surface' | 'muted' | 'light' | 'dark', string>;
  fonts: { display: string; mono: string; serif: string };
  brand: { name: string; suffix: string; tagline: string; site: string; email: string };
  [k: string]: unknown;
}

const layers = new Map<string, [HTMLCanvasElement, G]>();
/** A cleared offscreen canvas, reused per key and size. */
function layerOf(key: string, w = W, h = H): { canvas: HTMLCanvasElement; g: G } {
  const k = `${key}:${w}x${h}`;
  let e = layers.get(k);
  if (!e) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    e = [cv, cv.getContext('2d')!];
    layers.set(k, e);
  }
  resetCtx(e[1]);
  e[1].clearRect(0, 0, w, h);
  return { canvas: e[0], g: e[1] };
}

function baseStage(c: Ctx): StageBase {
  const T = c.theme, L = c.brand.logo;
  return {
    W, H, TAU,
    bpm: 60 / c.B,
    beat: c.B,
    b: (n: number) => n * c.B,
    colors: { bg: T.bg, text: T.text, primary: T.primary, secondary: T.secondary, accent: T.accent, surface: T.surface, muted: T.muted, light: T.light, dark: T.dark },
    fonts: { display: T.display.family, mono: T.mono.family, serif: (T.serif ?? T.display).family },
    brand: { name: c.brand.name, suffix: c.brand.suffix, tagline: c.brand.tagline, site: c.brand.site, email: c.brand.email },
    // drawing
    font: (g: G, size: number, weight = 700, role: 'display' | 'mono' | 'serif' = 'display', italic = false) => font(g, size, weight, role, italic),
    fit: (g: G, text: string, maxWidth: number, weight = 700, role: 'display' | 'mono' | 'serif' = 'display') => fitFont(g, text, maxWidth, weight, role),
    logo: (g: G, cx: number, cy: number, h: number, color: string) => drawLogo(g, L, cx, cy, h, color),
    logoWidth: (g: G, h: number) => logoWidth(g, L, h),
    logoPath: L.path,
    logoBox: L.box,
    layer: layerOf,
    // maths
    ease, lerp, clamp: (x: number, a = 0, b = 1) => clamp(x, a, b), prog, mod, pulse, rnd, noise,
    // pro toolkit (toolkit.ts)
    safe: 90,
    kf: (t: number, keys: [number, number | number[], string?][]) => kf(ease, t, keys),
    spring,
    type: (g: G, text: string, x: number, y: number, o: Parameters<typeof typeAnim>[5]) => typeAnim(ease, g, text, x, y, o),
    cam: camera,
    glow: glowAt,
    bloom,
    drawOn,
    icons: ICON_LIST,
    iconPoints,
    iconPolys,
    logoPoints: (n: number) => logoPoints(L, n),
    morph,
    linear,
    radial,
    fx: fxFactory(c),
    // crafted presets (presets.ts)
    title: (g: G, text: string, x: number, y: number, o: Parameters<typeof title>[6]) => title(ease, layerOf, g, text, x, y, o),
    bg: (g: G, o: Parameters<typeof background>[2]) => background(noise, g, o),
    fluid: (o: Parameters<typeof fluid>[1]) => fluid(layerOf, o),
    // colour
    mix: (a: string, b: string, p: number) => mixHex(a, b, p),
    rgba: (hex: string, a: number) => rgba(hex, a),
    hsl: (h: number, s: number, l: number) => hslHex(mod(h, 360), clamp(s, 0, 100), clamp(l, 0, 100)),
    toHsl: (hex: string) => hexToHsl(hex),
  };
}

// ── audio API ───────────────────────────────────────────────────────────────
type Fn = (...a: never[]) => void;
const INSTRUMENTS: Record<string, Fn> = {
  kick: SY.kick, sub: SY.sub, clap: SY.clap, hat: SY.hat, shaker: SY.shaker, conga: SY.conga, clave: SY.clave, tom: SY.tom,
  logDrum: SY.logDrum, bass: SY.sawBass, pad: SY.pad, stab: SY.stab, marimba: SY.marimba, pluck: SY.pluck, bell: SY.bell,
  crash: SY.crash, impact: SY.impact, riser: SY.riser, whoosh: SY.whoosh, swell: SY.swell, shing: SY.shing, blip: SY.blip,
  pop: SY.pop, keyclick: SY.keyclick, zip: SY.zip, bloop: SY.bloop,
} as unknown as Record<string, Fn>;

export function audioApi(A: Audio) {
  const api: Record<string, unknown> = {
    ac: A.ac,
    /** Connect custom nodes here (it is ducked by kicks, then compressed). */
    out: A.duck,
    /** Dry bus without ducking. */
    master: A.master,
    reverb: A.rev,
    delay: A.dly,
    noiseBuffer: A.noise,
    chord: (name: string) => parseChord(name),
    hz: (m: number) => midi(m),
  };
  for (const [k, f] of Object.entries(INSTRUMENTS)) api[k] = (...a: unknown[]) => (f as (...x: unknown[]) => void)(A, ...a);
  return api;
}

// ── custom scenes → techniques ──────────────────────────────────────────────

export interface RuntimeError {
  where: string;
  message: string;
  stack?: string;
}

export interface Installed {
  techniques: Technique[];
  errors: RuntimeError[];
  /** The compiled custom score, if any. */
  score?: (A: Audio, M: Record<string, unknown>) => void;
  lib: unknown;
}

const NoParams = z.object({}).passthrough();

/**
 * Compile a plan's custom block into techniques the engine can play. `ctx0`
 * (any section's context) provides the theme and brand for the shared lib.
 */
export function installCustom(custom: Custom, ctx0: Ctx): Installed {
  const errors: RuntimeError[] = [];
  let lib: unknown = {};
  if (custom.lib) {
    const f = compile(['S'], custom.lib, 'custom-lib');
    try {
      lib = f(baseStage(ctx0), seededMath(1)) ?? {};
    } catch (e) {
      errors.push({ where: 'custom.lib', message: String((e as Error).message ?? e), stack: (e as Error).stack });
      console.error('[motion] custom lib failed:', e);
    }
  }
  const stages = new WeakMap<Ctx, StageBase>();
  const stageOf = (c: Ctx, s: SceneCode): StageBase => {
    let st = stages.get(c);
    if (!st) {
      st = {
        ...baseStage(c),
        lib,
        id: s.id,
        dur: c.dur,
        beats: c.beats,
        start: c.start,
        index: c.index,
        prev: c.prev?.technique ?? null,
        next: c.next?.technique ?? null,
        /** 0..1 position inside the current beat of the music (aligned to the soundtrack). */
        beatPhase: (t: number) => mod((c.start + t) / c.B, 1),
        beatIndex: (t: number) => Math.floor((c.start + t) / c.B + 1e-6),
      };
      stages.set(c, st);
    }
    return st;
  };
  const techniques = custom.scenes.map((s): Technique => {
    const draw = compile(['g', 't', 'S'], s.draw, `scene-${s.id}`);
    const sfx = s.sfx ? compile(['A', 't0', 'S'], s.sfx, `scene-${s.id}-sfx`) : undefined;
    return {
      id: `scene:${s.id}`,
      title: s.title || s.id,
      category: 'custom',
      summary: '',
      label: (s.title || s.id).toUpperCase().slice(0, 24),
      params: NoParams,
      beats: { min: 0.25, max: 64, default: 4 },
      energy: 2,
      hud: false,
      example: {},
      draw: (g, lt, _p, c) => draw(g, lt, stageOf(c, s), seededMath(c.index * 7919 + lt)),
      sfx: sfx ? (A, t0, _p, c) => sfx(audioApi(A), t0, stageOf(c, s), seededMath(c.index * 104729)) : undefined,
      hits: (_p, c) => s.hits.map(h => ({ at: h.beat * c.B, shake: h.shake, punch: h.punch })),
      bed: custom.score ? () => [0, 0] : undefined,
    } as Technique;
  });
  const score = custom.score ? compile(['A', 'M'], custom.score, 'custom-score') : undefined;
  return {
    techniques,
    errors,
    lib,
    score: score ? (A, M) => score(audioApi(A), M, seededMath(2)) : undefined,
  };
}

// ── what the model reads ────────────────────────────────────────────────────
export const STAGE_DOCS = `# Stage API

You write plain JavaScript function BODIES (no function keyword, no imports, no exports). The engine calls them.

## Scene draw: body of function (g, t, S)
Draws ONE complete frame of a 1920×1080 video at scene-local time t (seconds; 0 = scene start, S.dur = scene end; during a transition t can be slightly below 0 or above S.dur, so clamp where it matters).
- g is a CanvasRenderingContext2D, already reset (identity transform, alpha 1, source-over). Paint the whole frame every time, background first.
- Must be a PURE FUNCTION OF t: no state between calls, frames are rendered out of order and in parallel. Math.random is allowed (it is seeded per frame, so it flickers between frames; use S.rnd(i, j) or S.noise(x, y, z) for stable randomness).
- No DOM, network, timers or clocks (window, document, fetch, Date, performance, setTimeout are undefined). Use S.layer() for offscreen canvases.
- Budget: a frame should draw in under ~40 ms. Thousands of arcs are fine; avoid per-pixel loops over the full frame and huge shadowBlur values.
- Everything visible must be drawn by you; the engine adds only optional film grain and transitions.

## Scene sound: body of function (A, t0, S)
Schedules this scene's sound accents once, before playback. t0 = the scene's absolute start time in seconds. Use A.* instruments at absolute times (t0 + S.b(beats)).

## Score (optional): body of function (A, M)
Schedules the WHOLE soundtrack once (replaces the built-in genre groove). M = { bpm, beat, duration, sections: [{ id, start, end, beats, energy }] }. Build the groove bar by bar with A.* instruments. Keep it musical: a consistent tempo, a chord progression, drops and builds that follow the sections.

## Lib (optional): body of function (S)
Runs once at load; return an object of shared helpers (drawing functions, palettes, precomputed geometry). Scenes get it as S.lib. Keep precomputation deterministic (S.rnd, not Math.random).

## S (stage)
- S.W = 1920, S.H = 1080, S.TAU = 2π
- S.dur (scene seconds), S.beats, S.start (absolute start), S.index, S.id, S.prev / S.next (neighbour technique ids, e.g. "scene:intro")
- S.bpm, S.beat (seconds per beat), S.b(n) → seconds for n beats
- S.beatPhase(t) → 0..1 inside the current music beat (aligned with the kicks); S.beatIndex(t) → integer beat count from the start of the video
- S.colors: { bg, text, primary, secondary, accent, surface, muted, light, dark } (#RRGGBB brand palette)
- S.fonts: { display, mono, serif } family names (loaded and ready)
- S.font(g, size, weight = 700, role = 'display' | 'mono' | 'serif', italic = false) → sets g.font (weights are clamped to what the font supports)
- S.fit(g, text, maxWidth, weight, role) → the font size at which text is exactly maxWidth wide
- S.brand: { name, suffix, tagline, site, email }
- S.logo(g, cx, cy, height, color) → draws the brand mark centred at (cx, cy); S.logoWidth(g, height); S.logoPath (Path2D or null) and S.logoBox [x, y, w, h] for custom treatments (clip, stroke, fill with gradients: translate/scale so logoBox maps where you want)
- S.layer(key, w = 1920, h = 1080) → { canvas, g }: a cleared offscreen canvas (reused per key), for masks, trails, glows, displacement
- S.ease: linear, inQuad, outQuad, inOutQuad, inCubic, outCubic, inOutCubic, outQuint, inExpo, outExpo, inOutExpo, inBack, outBack, inOutSine, outElastic (all t in 0..1)
- S.lerp(a, b, p), S.clamp(x, a = 0, b = 1), S.prog(t, a, b) → 0..1 as t goes a → b (clamped), S.mod(a, n), S.pulse(t, at, k = 12) → 1 at time at, decaying exponentially
- S.rnd(i, j = 0) → deterministic 0..1 hash; S.noise(x, y, z) → smooth deterministic value noise 0..1
- S.mix(hexA, hexB, p) → hex, S.rgba(hex, alpha) → css string, S.hsl(h, s, l) → hex (s, l in 0..100), S.toHsl(hex) → [h, s, l]
- S.lib → whatever your lib returned
- S.safe = 90 (px margin to keep text inside)

${TOOLKIT_DOCS}
${PRESET_DOCS}

## A (audio, for sfx and score)
Instruments (times are absolute seconds, m = MIDI note number, v = volume, p = pan -1..1):
- drums: A.kick(at, v = 1), A.sub(at, v = 0.8, dur = 1.3), A.clap(at, v = 0.45, p), A.hat(at, v = 0.1, open = false, p), A.shaker(at, v = 0.06, p), A.conga(at, m, v, p), A.clave(at, v, p), A.tom(at, m, v), A.logDrum(at, m, v, dur)
- tonal: A.bass(at, m, dur = 0.2, v = 0.3) (saw bass), A.pad(from, to, [m…], v = 0.03, cutoff = 1500), A.stab(at, [m…], v = 0.08, dur = 0.3, cutoff), A.marimba(at, m, v, p), A.pluck(at, m, v, p, cutoff), A.bell(at, m, v)
- fx: A.crash(at, v, dur), A.impact(at, v), A.riser(from, to, v), A.whoosh(at, dur, v, panFrom, panTo, freqFrom, freqTo), A.swell(from, to, v), A.shing(at, v), A.blip(at, m, v, p), A.pop(at, m, v, p), A.keyclick(at, v, p), A.zip(at, p, v), A.bloop(from, to, freqFrom, freqTo, v)
- A.chord("Fm9") → { root, bass, pad: [midi…], minor } (symbols: root A–G with # or b, then m, 7, 9, maj7, maj9, m7, m9, m6, 6, 6/9, add9, madd9, sus2, sus4, dim, aug)
- A.hz(midi) → frequency
- Raw Web Audio for your own sounds: A.ac (the BaseAudioContext), A.out (bus ducked by kicks → compressor → limiter), A.master (same without ducking), A.reverb and A.delay (send buses: connect a gain node into them), A.noiseBuffer (2.5 s of white noise). Every A.kick also ducks A.out like a sidechain.
`;
