// Fonts the platform can embed. Each maps to a @fontsource package that ships
// a variable (or static) latin woff2. Weight ranges are what the file supports;
// the engine clamps requested weights into this range.

export interface FontEntry {
  pkg: string;
  file: string;
  min: number;
  max: number;
  italicFile?: string;
}

export const DISPLAY_FONTS = {
  'Plus Jakarta Sans': { pkg: '@fontsource-variable/plus-jakarta-sans', file: 'plus-jakarta-sans-latin-wght-normal.woff2', min: 200, max: 800 },
  'Inter Tight': { pkg: '@fontsource-variable/inter-tight', file: 'inter-tight-latin-wght-normal.woff2', min: 100, max: 900 },
  'Space Grotesk': { pkg: '@fontsource-variable/space-grotesk', file: 'space-grotesk-latin-wght-normal.woff2', min: 300, max: 700 },
  Manrope: { pkg: '@fontsource-variable/manrope', file: 'manrope-latin-wght-normal.woff2', min: 200, max: 800 },
  Sora: { pkg: '@fontsource-variable/sora', file: 'sora-latin-wght-normal.woff2', min: 100, max: 800 },
  Unbounded: { pkg: '@fontsource-variable/unbounded', file: 'unbounded-latin-wght-normal.woff2', min: 200, max: 900 },
  'Bricolage Grotesque': { pkg: '@fontsource-variable/bricolage-grotesque', file: 'bricolage-grotesque-latin-wght-normal.woff2', min: 200, max: 800 },
  'DM Sans': { pkg: '@fontsource-variable/dm-sans', file: 'dm-sans-latin-wght-normal.woff2', min: 100, max: 1000 },
} as const satisfies Record<string, FontEntry>;

export const SERIF_FONTS = {
  'Instrument Serif': { pkg: '@fontsource/instrument-serif', file: 'instrument-serif-latin-400-normal.woff2', italicFile: 'instrument-serif-latin-400-italic.woff2', min: 400, max: 400 },
  Fraunces: { pkg: '@fontsource-variable/fraunces', file: 'fraunces-latin-wght-normal.woff2', min: 100, max: 900 },
} as const satisfies Record<string, FontEntry>;

export const MONO_FONTS = {
  'JetBrains Mono': { pkg: '@fontsource-variable/jetbrains-mono', file: 'jetbrains-mono-latin-wght-normal.woff2', min: 100, max: 800 },
} as const satisfies Record<string, FontEntry>;

export type DisplayFont = keyof typeof DISPLAY_FONTS;
export type SerifFont = keyof typeof SERIF_FONTS;
export type MonoFont = keyof typeof MONO_FONTS;

export const DISPLAY_NAMES = Object.keys(DISPLAY_FONTS) as [DisplayFont, ...DisplayFont[]];
export const SERIF_NAMES = Object.keys(SERIF_FONTS) as [SerifFont, ...SerifFont[]];
export const MONO_NAMES = Object.keys(MONO_FONTS) as [MonoFont, ...MonoFont[]];

export function fontEntry(family: string): FontEntry | undefined {
  return (DISPLAY_FONTS as Record<string, FontEntry>)[family] ?? (SERIF_FONTS as Record<string, FontEntry>)[family] ?? (MONO_FONTS as Record<string, FontEntry>)[family];
}
