import { STAGE_DOCS } from '../engine/custom/stage';
import { DISPLAY_NAMES, SERIF_NAMES } from '../plan/fonts';
import { TRANSITIONS } from '../plan/schema';
import type { BrandKit } from './brand-kit';

// Prompts for "invent" mode: the model designs a new visual language and
// writes every scene's drawing and sound code itself. These prompts set the
// bar and the rules (originality, facts, the runtime contract); every design
// decision is the model's.

/** What earlier films made with the technique library looked like, so the model can avoid it. */
const SEEN_BEFORE = [
  'a diagonal white-hot light blade opening the film',
  'hard word-by-word cuts in big sans type',
  'an RGB-split glitch word with slice glitches',
  'a variable-weight wave word inside a browser frame',
  'dot-matrix letters',
  'a Swiss-style stacked type block on a brand-colour field',
  'a card-flip word with a camera flying through a letter',
  'a 3D code editor typing code',
  'an exploded website mock-up in 3D layers',
  'particles morphing between service icons',
  'a dotted world globe with arcs between cities',
  'a rapid montage of project names',
  'a rolling number odometer',
  'the logo assembled from sliding pieces onto a rounded app-icon tile',
  'an end card with the logo tile, name, tagline and a pill button',
];

export function directorSystem(): string {
  return `You are the creative director of a world-class motion design studio, the kind whose brand films win awards. You are inventing an ENTIRELY NEW visual language for a short brand film. Afterwards, you (as a creative coder) will write every frame of it in JavaScript on an HTML canvas, so design something you can actually build with procedural 2D drawing: shapes, lines, type, gradients, masks, noise, particles, projection maths for 3D, offscreen buffers. No photos, video or 3D models.

The bar:
- One strong, surprising central idea (a visual metaphor or system) carried through every scene, so the film feels designed, not assembled.
- A considered colour system built on the brand palette (you may add up to 3 extra colours), confident typography, deliberate composition, and a clear rhythm cut to the music.
- The first second is a striking hook. The last scene resolves on the brand: the logo mark (drawn with S.logo), the name and the site, holding still and clean for at least the final 1.5 seconds.
- It must feel NEW. Earlier films for this brand used all of the following; do not reuse any of these ideas or anything close to them: ${SEEN_BEFORE.join('; ')}.

Rules:
- Length: the scenes' beats must add up exactly to the target beats. 4–9 scenes. Beats in multiples of 0.5.
- On-screen text: short, in the brand's own voice, drawn from the brief and the brand facts. Never invent numbers, clients, places or awards. Every number you show must appear in the brief or the facts.
- Fonts: choose display from ${DISPLAY_NAMES.join(', ')}; optional serif from ${SERIF_NAMES.join(', ')}.
- Music: describe an original score (tempo 90–140 BPM, groove, instruments, where it builds and drops) that will be synthesised in code. It must fit the visual idea.
- Engine transitions between scenes are available (${TRANSITIONS.join(', ')}), but a designed transition inside your scenes (a match cut, a shape that becomes the next scene) is usually stronger; then use "cut".`;
}

export function directorUser(brief: string, kit: BrandKit, beats: number, seconds: number, bpm?: number): string {
  const b = kit.brand;
  const facts = Object.fromEntries(Object.entries(kit.facts).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
  return `BRIEF
${brief.trim() || `A brand film for ${b.name}.`}

TARGET
${seconds} seconds = ${beats} beats${bpm ? ` at ${bpm} BPM (use this tempo)` : ' (pick the tempo; the beat count stays fixed)'}.

BRAND
- Name: ${b.name}${b.suffix ? ` (full: ${b.name} ${b.suffix})` : ''}
- Tagline: ${b.tagline || '(none)'} · Site: ${b.site || '(none)'} · Email: ${b.email || '(none)'}
- Palette: ${Object.entries(b.colors).map(([k, v]) => `${k} ${v}`).join(', ')}
- Current display font: ${b.fonts.display}
- Logo: ${b.logo ? 'a single-colour vector mark is available (S.logo draws it, S.logoPath gives the path)' : `none; S.logo draws a monogram "${b.name[0]?.toUpperCase()}"`}

BRAND FACTS (the only facts you may state)
${JSON.stringify(facts, null, 2)}

Design the film.`;
}

export function directionSchema() {
  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      concept: { type: 'string', description: 'The central idea and how the film unfolds, 3–5 sentences' },
      vibe: { type: 'array', items: { type: 'string' }, description: '4–8 words' },
      influences: { type: 'array', items: { type: 'string' }, description: 'art, design, film or music references this draws on (not other brands)' },
      look: {
        type: 'object',
        properties: {
          palette: { type: 'string', description: 'how the colours are used, by role' },
          extraColors: { type: 'array', items: { type: 'string' }, description: '0–3 extra #RRGGBB colours' },
          display: { type: 'string', enum: [...DISPLAY_NAMES] },
          serif: { type: 'string', enum: [...SERIF_NAMES] },
          typography: { type: 'string', description: 'type treatment: sizes, weights, tracking, case, how it moves' },
          composition: { type: 'string' },
          texture: { type: 'string' },
          grain: { type: 'number', minimum: 0, maximum: 0.2 },
        },
        required: ['palette', 'display', 'typography', 'composition', 'texture', 'grain'],
      },
      motion: { type: 'string', description: 'motion principles: easing, timing, how things enter, exit and react to the beat' },
      sound: {
        type: 'object',
        properties: { bpm: { type: 'number', minimum: 90, maximum: 140 }, key: { type: 'string' }, description: { type: 'string' } },
        required: ['bpm', 'description'],
      },
      scenes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'lowercase-with-dashes' },
            title: { type: 'string' },
            beats: { type: 'number' },
            idea: { type: 'string', description: 'what happens on screen, precisely, moment by moment, and how it lands on the beat' },
            onscreenText: { type: 'array', items: { type: 'string' } },
            transition: { type: 'string', enum: [...TRANSITIONS], description: 'into the next scene' },
          },
          required: ['id', 'title', 'beats', 'idea', 'onscreenText', 'transition'],
        },
      },
    },
    required: ['title', 'concept', 'vibe', 'look', 'motion', 'sound', 'scenes'],
  };
}

export interface Direction {
  title: string;
  concept: string;
  vibe: string[];
  influences?: string[];
  look: { palette: string; extraColors?: string[]; display: string; serif?: string; typography: string; composition: string; texture: string; grain: number };
  motion: string;
  sound: { bpm: number; key?: string; description: string };
  scenes: { id: string; title: string; beats: number; idea: string; onscreenText: string[]; transition: string }[];
}

export function coderSystem(): string {
  return `You are a world-class creative coder turning a motion design direction into code. You write JavaScript function bodies that draw every frame of a 1920×1080 60 fps brand film on an HTML canvas, and that synthesise its sound. The result must look like a premium studio piece, faithful to the direction.

Craft:
- Motion: ease everything (S.ease), anticipate and overshoot, stagger elements, layer foreground/background for depth, and land the big moves on beats (S.b(n)). Use S.beatPhase(t) for things that pulse with the music.
- Readability: text is large, well kerned, inside a 90 px safe margin, and fully readable for at least 0.6 s. Strong contrast against what is behind it.
- Continuity: the first frame of a scene should connect to where the previous scene ended; designed transitions beat engine transitions.
- Texture and light: gradients, soft glows (radial gradients are cheap; avoid huge shadowBlur), grain, noise-driven organic movement.
- Only show the on-screen text given in the direction (it has been checked against the brand facts). Never add numbers or claims of your own.

Code rules (the engine enforces them; violations come back to you as errors):
- Each draw body paints the ENTIRE frame from scratch at time t, as a pure function of t. Clamp progress values; t may be slightly outside 0..S.dur during transitions.
- g.save()/g.restore() around transforms, clips and alpha changes.
- Keep it fast: under ~40 ms per frame.
- Plain modern JavaScript. No imports, no DOM, no timers, no Date. Return nothing from draw.

${STAGE_DOCS}`;
}

export function libUser(d: Direction, kit: BrandKit): string {
  return `DIRECTION
${JSON.stringify(d, null, 1)}

BRAND: ${kit.brand.name}${kit.brand.suffix ? ` ${kit.brand.suffix}` : ''} · palette ${JSON.stringify(kit.brand.colors)} · logo ${kit.brand.logo ? 'vector mark' : 'monogram'}

Write two things:
1. "lib": the body of function (S) that returns an object of shared helpers every scene will use to stay visually consistent: the palette (including the extra colours), texture/grain/background painters, type-setting helpers, easing/rhythm helpers, and any precomputed geometry the concept needs (deterministic). Document each helper with a one-line comment.
2. "score": the body of function (A, M) that synthesises the complete original soundtrack described in the direction for the whole duration, following M.sections for builds, drops and the ending. The final section should resolve musically and let the last chord ring out.`;
}

export const libSchema = () => ({
  type: 'object',
  properties: {
    lib: { type: 'string' },
    score: { type: 'string' },
  },
  required: ['lib', 'score'],
});

const hitsSchema = {
  type: 'array',
  description: 'camera shake / zoom punches on big impacts (beat offsets from the scene start); often empty',
  items: { type: 'object', properties: { beat: { type: 'number' }, shake: { type: 'number', minimum: 0, maximum: 40 } }, required: ['beat', 'shake'] },
};

export const sceneSchema = () => ({
  type: 'object',
  properties: {
    draw: { type: 'string', description: 'body of function (g, t, S)' },
    sfx: { type: 'string', description: 'body of function (A, t0, S): sound accents for this scene (may be empty)' },
    hits: hitsSchema,
  },
  required: ['draw', 'sfx', 'hits'],
});

export function sceneUser(d: Direction, lib: string, i: number, bpm: number): string {
  const s = d.scenes[i], prev = d.scenes[i - 1], next = d.scenes[i + 1];
  const B = 60 / bpm;
  return `DIRECTION
${JSON.stringify({ ...d, scenes: d.scenes.map(x => ({ id: x.id, title: x.title, beats: x.beats, idea: x.idea })) }, null, 1)}

SHARED LIB (available as S.lib)
\`\`\`js
${lib}
\`\`\`

WRITE SCENE ${i + 1} of ${d.scenes.length}: "${s.id}" — ${s.title}
- Length: ${s.beats} beats = ${(s.beats * B).toFixed(3)} s at ${bpm} BPM (one beat = ${B.toFixed(3)} s)
- Idea: ${s.idea}
- On-screen text (exactly these strings): ${JSON.stringify(s.onscreenText)}
- Comes after: ${prev ? `"${prev.id}" — ${prev.idea}` : 'nothing: this is the first frame of the film, it must hook instantly'}
- Leads into: ${next ? `"${next.id}" — ${next.idea} (transition: ${s.transition})` : 'nothing: this is the final scene; resolve on the logo, name and site and hold the last 1.5 s still'}

Return the draw body, the sfx body (accents that sit on top of the score; can be empty) and any hits.`;
}

export function fixUser(what: string, code: Record<string, string>, problems: string[]): string {
  return `The engine ran your code for ${what} and found problems. Fix every one and return the complete corrected code (same JSON shape). Keep the design; change only what is needed.

PROBLEMS
${problems.map(p => `- ${p}`).join('\n')}

CURRENT CODE
${Object.entries(code).map(([k, v]) => `--- ${k} ---\n${v}`).join('\n\n')}`;
}

export function reviewSystem(): string {
  return `You are the design director reviewing a draft brand film against its direction. You get the direction and frames rendered from each scene (labelled with time and scene id).

Judge like a top studio would: Is the central idea clear and carried through? Does each scene look finished and premium? Is text readable and well set? Is anything broken, empty, clipped, cluttered, off-palette or generic? Does the last scene land cleanly on the brand?

Mid-animation frames can be in motion; judge what the viewer sees. For each scene give a score 1–10 and a verdict: "keep" (7+) or "revise", with concrete, buildable notes (what to draw differently, sizes, positions, timing, colours).`;
}

export const reviewSchema = () => ({
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 1, maximum: 10 },
    summary: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          score: { type: 'integer', minimum: 1, maximum: 10 },
          verdict: { type: 'string', enum: ['keep', 'revise'] },
          notes: { type: 'string' },
        },
        required: ['id', 'score', 'verdict', 'notes'],
      },
    },
  },
  required: ['score', 'summary', 'scenes'],
});

export interface Review {
  score: number;
  summary: string;
  scenes: { id: string; score: number; verdict: 'keep' | 'revise'; notes: string }[];
}
