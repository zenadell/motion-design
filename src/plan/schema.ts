import { z } from 'zod';
import { CHORD_RE } from '../engine/audio/chords';
import { DISPLAY_NAMES, MONO_NAMES, SERIF_NAMES } from './fonts';

// ─────────────────────────────────────────────────────────────────────────────
//  The Plan: the single JSON document a human or a model writes. It says WHAT
//  happens (sections, copy, colours, music); the engine decides HOW it looks.
// ─────────────────────────────────────────────────────────────────────────────

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a colour like #F63C0C');

export const BrandSchema = z.object({
  name: z.string().min(1).max(40).describe('Brand or person name, as it should appear in the lockup'),
  suffix: z.string().max(40).default('').describe('Optional second word shown lighter after the name, e.g. "Innovation"'),
  tagline: z.string().max(120).default(''),
  site: z.string().max(60).default(''),
  email: z.string().max(80).default(''),
  colors: z.object({
    bg: hex.describe('Main background — usually the darkest brand colour'),
    text: hex.describe('Main text colour on bg'),
    primary: hex.describe('Hero brand colour'),
    secondary: hex.optional(),
    accent: hex.optional().describe('A contrasting pop colour; derived if omitted'),
    surface: hex.optional(),
    muted: hex.optional(),
    light: hex.optional().describe('Paper colour for light scenes'),
    dark: hex.optional().describe('Ink colour on light scenes'),
  }),
  fonts: z
    .object({
      display: z.enum(DISPLAY_NAMES).default('Plus Jakarta Sans'),
      mono: z.enum(MONO_NAMES).default('JetBrains Mono'),
      serif: z.enum(SERIF_NAMES).optional(),
    })
    .prefault({}),
  logo: z
    .object({
      d: z.string().min(4).describe('SVG path data of the logomark (single colour)'),
      viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    })
    .optional()
    .describe('Omit to use a monogram of the first letter of the name'),
  tile: z.boolean().default(true).describe('Present the mark on a rounded app-icon tile'),
});

export const MusicSchema = z.object({
  bpm: z.number().min(90).max(140).default(120),
  genre: z.enum(['afro-house', 'electro']).default('afro-house'),
  progression: z
    .array(z.string().regex(CHORD_RE, 'chord like "Fm9", "Dbmaj9", "Am", "G"'))
    .min(1)
    .max(8)
    .optional()
    .describe('One chord per bar, looped. Defaults per genre.'),
  volume: z.number().min(0).max(1.5).default(1),
});

export const TRANSITIONS = ['cut', 'blade', 'slice', 'flash', 'fade', 'slide', 'zoom', 'wipe'] as const;
export const TransitionSchema = z.union([
  z.enum(TRANSITIONS),
  z.object({ type: z.enum(TRANSITIONS), beats: z.number().min(0.25).max(2).default(0.5) }),
]);

export const SectionSchema = z.object({
  id: z.string().max(40).optional(),
  technique: z.string().describe('A technique id from the catalog'),
  beats: z.number().min(0.25).max(64).describe('Length in beats (0.5 s each at 120 BPM)'),
  params: z.record(z.string(), z.unknown()).default({}),
  energy: z.number().int().min(0).max(3).optional().describe('0 hits only · 1 light groove · 2 full groove · 3 build-up'),
  transition: TransitionSchema.optional().describe('How this section hands over to the next one'),
  label: z.string().max(24).optional().describe('HUD section label'),
  hud: z.boolean().optional(),
});

export const MetaSchema = z.object({
  title: z.string().max(80).default('Untitled'),
  fps: z.number().int().min(24).max(60).default(60),
  hud: z.boolean().default(true).describe('Show the timecode / section HUD'),
  captions: z.boolean().default(true).describe('Show small mono technique annotations'),
  grain: z.number().min(0).max(0.2).default(0.07),
});

// Code-defined scenes ("invent" mode): a model writes the drawing and sound
// code itself instead of choosing from the technique library. A section uses
// one with technique "scene:<id>". The code runs in the page, against the
// Stage API documented in docs/stage-api.md.
export const SceneCodeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'lowercase id like "light-leak"'),
  title: z.string().max(60).default(''),
  /** Body of function (g, t, S): draw one full frame at scene-local time t. */
  draw: z.string().min(10).max(60_000),
  /** Body of function (A, t0, S): schedule this scene's sound accents at absolute time t0. */
  sfx: z.string().max(30_000).optional(),
  /** Camera shake / zoom punch events, in beats from the scene start. */
  hits: z.array(z.object({ beat: z.number().min(0).max(64), shake: z.number().min(0).max(40).default(10), punch: z.number().min(0).max(0.2).optional() })).max(32).default([]),
});

export const CustomSchema = z.object({
  /** Body of function (S): runs once at load and returns an object of shared helpers, available as S.lib. */
  lib: z.string().max(60_000).optional(),
  scenes: z.array(SceneCodeSchema).max(24).default([]),
  /** Body of function (A, M): schedules the whole soundtrack. Replaces the genre music bed. */
  score: z.string().max(60_000).optional(),
});

export const PlanSchema = z.object({
  version: z.literal(1).default(1),
  meta: MetaSchema.prefault({}),
  brand: BrandSchema,
  music: MusicSchema.prefault({}),
  sections: z.array(SectionSchema).min(1).max(40),
  custom: CustomSchema.optional(),
});

export type PlanInput = z.input<typeof PlanSchema>;
export type Plan = z.output<typeof PlanSchema>;
export type Section = Plan['sections'][number];
export type Brand = Plan['brand'];
export type Music = Plan['music'];
export type TransitionType = (typeof TRANSITIONS)[number];
export type Custom = z.output<typeof CustomSchema>;
export type SceneCode = z.output<typeof SceneCodeSchema>;
