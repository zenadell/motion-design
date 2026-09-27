import craft from '../../docs/motion-craft.md?raw';
import exemplar from './exemplars/kinetic-hook.js?raw';
import { catalogJson } from '../cli/catalog';
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

export const SETPIECES = ['none', 'swarm', 'extrude', 'shatter', 'globe', 'flight', 'cylinder', 'rays', 'planes'] as const;

export function directorSystem(): string {
  return `You are the creative director of the best motion design studio in the world. Your films go viral on YouTube, TikTok and Instagram and win awards; clients pay six figures for them. You are designing a new brand film. Afterwards you (as a creative coder) will build every frame in JavaScript on an HTML canvas with a professional toolkit (kinetic type animator, 3D camera, particles, morphs, glows, masks, the engine's finished effects as components), so design something you can build with procedural 2D drawing: no photos, video or 3D models.

THE BAR: bold, dense, surprising, meticulously cut to the music. Unless the brief asks for calm, the energy is HIGH: the kind of edit people rewatch and share. Austere minimalism, voids, thin lines on black and "restraint" are not what is wanted. Every frame a poster. A single strong idea carried through every scene. Energy that builds to a peak and resolves on the brand. Read the craft handbook below: it is the standard you will be judged by, and its anti-patterns are automatic fails (above all: empty dark frames with thin lines, tiny text, slow openings, uniform timing).

NEW: earlier films for this brand used the following; the film you design must look and feel clearly different (you may still use techniques like kinetic type or colour punches, and the set-piece library below, as long as the overall idea, staging and look are new): ${SEEN_BEFORE.join('; ')}.

Rules:
- Length: the scenes' beats must add up exactly to the target beats. 6–10 scenes; beats in multiples of 0.5. Most scenes 2–6 beats (short scenes stay dynamic; long ones go static), at most one scene longer than 8 beats. The first second is the most striking frame of the film.
- THE SET-PIECE LIBRARY: your studio has hand-built, film-grade 3D set pieces that you direct (you choose the shapes, words, colours, camera moves and the beats things happen on): swarm (thousands of glowing 3D particles flying between shapes on the beat: sphere, torus, helix, vortex, wave, the logo, any short word, icons; bursts on kicks), extrude (solid extruded 3D type or logo swinging in with lit sides and a specular light sweep), shatter (a word or the logo assembling from glass shards flying in from 3D space, or exploding into them), globe (a dotted world globe with flying arcs, pins and labels), flight (the camera flies over an endless floor through giant portal frames carrying words, flashing as it crosses each one on the beat, with barrel rolls), cylinder (rows of huge type wrapped around a rotating 3D cylinder, counter-rotating, whipping in), rays (volumetric light streaming out of a word or the logo, light surges on hits, anamorphic flares), planes (cards or screens floating in 3D space with camera cuts between poses). Build the film around 3–5 DIFFERENT set pieces (name each scene's set piece in its setpiece field), staged in the film's own look: your backgrounds, colours, overlays and type around them. Kinetic-type scenes between them keep the rhythm. A set piece serves the concept; it is not the concept.
- The last scene resolves on the brand: the logo mark (S.logo / S.logoPath / S.logoPoints), the name and the site, holding still and clean for the final 1.5 seconds.
- On-screen text: short, punchy, in the brand's own voice, from the brief and the brand facts. Never invent numbers, clients, places or awards.
- Fonts: display from ${DISPLAY_NAMES.join(', ')}; optional serif from ${SERIF_NAMES.join(', ')}.
- Music: an original score (90–140 BPM) that drives the picture: groove, builds, drops, a breath before the logo, a final chord that rings.
- For each scene write the idea as a precise shot description: what is on screen, how it moves, beat by beat, and how it connects to the next scene (designed transitions beat engine transitions: prefer "cut" with a match cut built into the scenes).

# Craft handbook
${craft}`;
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
            setpiece: { type: 'string', enum: [...SETPIECES], description: 'the crafted set piece (S.set.*) this scene is built on, or none for a kinetic-type or graphic scene' },
            transition: { type: 'string', enum: [...TRANSITIONS], description: 'into the next scene' },
          },
          required: ['id', 'title', 'beats', 'idea', 'onscreenText', 'setpiece', 'transition'],
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
  scenes: { id: string; title: string; beats: number; idea: string; onscreenText: string[]; setpiece?: string; transition: string }[];
}

let techList: string | undefined;
/** The engine's finished techniques, usable as components via S.fx(id, g, t, params, beats). */
function techniquesForFx(): string {
  return (techList ??= catalogJson()
    .techniques.map(t => {
      const props = Object.keys((t.params as { properties?: Record<string, unknown> }).properties ?? {});
      return `- ${t.id} (${t.beats.default} beats): ${t.summary.split('. ')[0]}. params: ${props.join(', ') || 'none'}. example: ${JSON.stringify(t.example)}`;
    })
    .join('\n'));
}

/** Script code of reference films, trimmed of bulky data, for the coder to learn craft from. */
export function barCodeSection(code: string | undefined): string {
  if (!code) return '';
  return `

# THE BAR: source code of reference films (9/10 craft)
These films were hand-coded by a top motion designer on a canvas like yours (their helpers differ from the Stage API; map the ideas across). Study HOW they are built: beat-locked timelines, layered depth, easing choices, overshoot and settle, per-letter and per-word staggers, light and glow, micro-details, and sound design married to every move. Your film must reach this level of craft. Do NOT reuse their scenes, ideas, layouts or copy: your film has its own concept.

${code}`;
}

export function coderSystem(barCode?: string): string {
  return `You are the best creative coder in motion design. You turn a direction into JavaScript function bodies that draw every frame of a 1920×1080 60 fps brand film on an HTML canvas, and synthesise its sound. The result must look like a six-figure studio piece, faithful to the direction, and pass the craft handbook with no anti-patterns.

How you work:
- Plan each scene as a beat-by-beat timeline first (in comments at the top of the draw body), then build it in layers: background (never an empty flat field: light, gradient, texture), midground, foreground hero, overlay details.
- For hero words in kinetic-type scenes use S.title (big, crafted presets: slam, rise, split, stretch, scramble, outline-fill, stack) and for rich backgrounds S.bg (mesh, grid, flow, dots, rays, stripes); S.fluid gives liquid/molten metaballs. Customise and combine them; replace them only with something better.
- Use the pro toolkit: S.type for kinetic type, S.kf / S.spring for motion curves, S.cam for 3D, S.glow / S.bloom for light, S.morph / S.iconPoints / S.logoPoints for particles, S.layer for masks and composites, S.fx for the engine's finished effects when they serve the idea.
- Hero type 160–400 px. Every key word fully readable for at least 0.6 s. Something happens on every beat during energy sections; nothing stays still for more than 0.5 s before the final hold.
- Beat precision is measured: every hard change (cut, slam, colour flip, swap) must land exactly on the 16th-note grid. Compute its time as S.b(n) with n a multiple of 0.25, never a free number of seconds.
- A scene whose direction names a set piece is built on S.set.<name>: it is the crafted 3D, particle and light core of the shot, better than anything rebuilt by hand, so never rebuild it. Direct it precisely: every option (shapes, words, colours, pose and camera keys, bursts, passes) timed with S.b(n) to the direction's beats. Then stage it so it belongs to this film: your own background under it (pass bg: null) when the look calls for one, and type, labels, overlays and light on top. One set piece per frame (two at most, e.g. S.set.flare over S.set.rays).
- Only show the on-screen text given in the direction. Never add numbers or claims of your own.

Code rules (the engine enforces them; violations come back to you as errors):
- Each draw body paints the ENTIRE frame from scratch at time t, as a pure function of t. Clamp progress values; t may be slightly outside 0..S.dur during transitions.
- g.save()/g.restore() around transforms, clips, filters and alpha changes.
- Keep it fast: under ~40 ms per frame at 1920×1080.
- Plain modern JavaScript. No imports, no DOM, no timers, no Date. Return nothing from draw.

${STAGE_DOCS}

## Engine techniques available through S.fx
${techniquesForFx()}

# Craft handbook
${craft}

# Exemplar (a craft reference for code quality, layering and timing; do NOT copy its idea, copy or layout)
\`\`\`js
${exemplar}
\`\`\`${barCodeSection(barCode)}`;
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
${JSON.stringify({ ...d, scenes: d.scenes.map(x => ({ id: x.id, title: x.title, beats: x.beats, idea: x.idea, setpiece: x.setpiece ?? 'none' })) }, null, 1)}

SHARED LIB (available as S.lib)
\`\`\`js
${lib}
\`\`\`

WRITE SCENE ${i + 1} of ${d.scenes.length}: "${s.id}" — ${s.title}
- Length: ${s.beats} beats = ${(s.beats * B).toFixed(3)} s at ${bpm} BPM (one beat = ${B.toFixed(3)} s)
- Idea: ${s.idea}
- Set piece: ${s.setpiece && s.setpiece !== 'none' ? `S.set.${s.setpiece} (build the shot on it; see its options in the Stage API)` : 'none (a kinetic-type or graphic scene)'}
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

// ── Video critique (v2) ─────────────────────────────────────────────────────

export const RUBRIC = ['idea', 'composition', 'typography', 'motion', 'rhythm', 'light_colour', 'polish', 'wow'] as const;

export function sceneCriticSystem(): string {
  return `You are the toughest design director in motion design, reviewing a scene from a brand film against its direction and the craft handbook. You WATCH the rendered clip (video) and judge what a viewer experiences: motion, timing, composition, typography, light, polish.

Score each dimension 1–10 against a six-figure studio standard (10 = world-class, 8 = ship it, 6 = competent but forgettable, 4 = amateur). If REFERENCE BAR films are provided, they are the 9/10 calibration: judge craft, energy and polish relative to them (not their style).

- idea: the scene clearly expresses the direction's concept, not a generic stand-in
- composition: every frame is a poster; frame filled deliberately; clear focal point; no dead or empty frames
- typography: size, weight, spacing, readability (≥ 0.6 s fully legible), no clipping or overlaps
- motion: easing, anticipation, overshoot, follow-through, secondary motion; nothing linear or uniform
- rhythm: changes land on beats; energy matches the scene's role; holds where messages need them
- light_colour: palette discipline, contrast, light and depth (not murky or flat)
- polish: no bugs, flicker, jitter, broken frames, stray elements or text outside the safe area
- wow: would a motion designer stop scrolling for this?

Then give the three most important fixes as concrete, buildable instructions (what to draw, where, how big, when, with which easing), most impactful first. Be specific and harsh; praise nothing that is not excellent.
${'\n'}# Craft handbook
${craft}`;
}

export const sceneCriticSchema = () => ({
  type: 'object',
  properties: {
    scores: { type: 'object', properties: Object.fromEntries(RUBRIC.map(k => [k, { type: 'integer', minimum: 1, maximum: 10 }])), required: [...RUBRIC] },
    observed: { type: 'string', description: 'what actually happens in the clip, beat by beat, in 2–4 sentences' },
    fixes: { type: 'array', items: { type: 'string' }, description: 'the three most important fixes, most impactful first' },
  },
  required: ['scores', 'observed', 'fixes'],
});

export interface SceneCritique {
  scores: Record<(typeof RUBRIC)[number], number>;
  observed: string;
  fixes: string[];
}

/** One number per critique: the mean, pulled down by the weakest dimension (one broken aspect sinks a scene). */
export function critiqueScore(c: SceneCritique): number {
  const v = RUBRIC.map(k => Math.max(1, Math.min(10, Number(c.scores?.[k]) || 1)));
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.round((0.7 * mean + 0.3 * Math.min(...v)) * 10) / 10;
}

export function sceneCriticUser(d: Direction, i: number): string {
  const s = d.scenes[i];
  return `DIRECTION (film)
${JSON.stringify({ title: d.title, concept: d.concept, vibe: d.vibe, look: d.look, motion: d.motion }, null, 1)}

THIS SCENE (${i + 1}/${d.scenes.length}): "${s.id}" — ${s.title}, ${s.beats} beats
Idea: ${s.idea}${s.setpiece && s.setpiece !== 'none' ? `
Set piece: ${s.setpiece}` : ''}
On-screen text: ${JSON.stringify(s.onscreenText)}

Watch the clip and review it.`;
}

export function rewriteUser(d: Direction, lib: string, i: number, bpm: number, code: { draw: string; sfx: string }, c: SceneCritique, score: number): string {
  return `${sceneUser(d, lib, i, bpm)}

YOUR CURRENT CODE
--- draw ---
${code.draw}
--- sfx ---
${code.sfx}

REVIEW OF THE CLIP ABOVE (${score}/10; ${RUBRIC.map(k => `${k} ${c.scores?.[k] ?? '?'}`).join(', ')})
What the reviewer saw: ${c.observed}
Fixes, most important first:
${c.fixes.map((f, k) => `${k + 1}. ${f}`).join('\n')}

Rewrite the scene to fix these and raise every weak dimension. You may restructure it completely if that is what it takes. Return the complete draw, sfx and hits.`;
}

export function filmCriticSystem(): string {
  return `You are the toughest design director in motion design, reviewing a complete brand film (video with sound) against its direction and the craft handbook. Judge the whole: the idea, the arc and energy curve, continuity between scenes, sync of picture to music, and the ending on the brand. Then score every scene in context (1–10) with the single most important fix for each scene below 9.
${'\n'}# Craft handbook
${craft}`;
}

export const filmCriticSchema = () => ({
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 1, maximum: 10 },
    summary: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, score: { type: 'integer', minimum: 1, maximum: 10 }, fix: { type: 'string' } },
        required: ['id', 'score', 'fix'],
      },
    },
  },
  required: ['score', 'summary', 'scenes'],
});

export interface FilmCritique {
  score: number;
  summary: string;
  scenes: { id: string; score: number; fix: string }[];
}

// ── Concept tournament ──────────────────────────────────────────────────────

export const conceptsSchema = () => ({
  type: 'object',
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          idea: { type: 'string', description: 'the central idea and the look, 2–3 sentences' },
          hook: { type: 'string', description: 'the first 2 seconds, precisely' },
          signature: { type: 'string', description: 'the one moment people will remember and share' },
          build: { type: 'string', description: 'how it is built with the toolkit (which techniques, why it is feasible on a 2D canvas)' },
        },
        required: ['title', 'idea', 'hook', 'signature', 'build'],
      },
    },
  },
  required: ['concepts'],
});

export interface Concept {
  title: string;
  idea: string;
  hook: string;
  signature: string;
  build: string;
}

export function conceptsUser(base: string, n: number): string {
  return `${base}

First, pitch ${n} radically different concepts (different ideas, looks and energies, not variations of one). Each must be buildable in code with the toolkit and must be high-energy and dense.`;
}

export const pickSchema = () => ({
  type: 'object',
  properties: {
    ranking: { type: 'array', items: { type: 'integer' }, description: 'concept indexes, best first' },
    reasons: { type: 'string' },
  },
  required: ['ranking', 'reasons'],
});

export function pickSystem(): string {
  return `You are the executive creative director deciding which concept the studio will make. Rank the concepts by: (1) wow: would it stop the scroll and get shared, (2) buildability: can it be executed to a premium standard with procedural 2D canvas code and the toolkit (kinetic type, particles, 3D wireframes/cards, glows, masks, morphs; no photos or 3D models), (3) fit: does it express this brand and brief, (4) energy: dense and rhythmic, not austere. Be decisive.`;
}

export function developUser(base: string, c: Concept): string {
  return `${base}

DEVELOP THIS CONCEPT into the full direction (keep its idea, hook and signature moment):
${JSON.stringify(c, null, 1)}`;
}

// ── Pairwise judging (more reliable than absolute scores; run in both orders) ──

export function pairSystem(): string {
  return `You are the toughest design director in motion design. You watch two versions (A and B) of the same scene of a brand film and decide which one is better motion design: the more captivating, premium, rhythmic and polished piece that better realises the scene's idea. Ignore which one came first. If they are genuinely equal, say "tie". Be decisive.`;
}

export const pairSchema = () => ({
  type: 'object',
  properties: {
    winner: { type: 'string', enum: ['A', 'B', 'tie'] },
    reason: { type: 'string', description: 'one or two sentences' },
  },
  required: ['winner', 'reason'],
});
