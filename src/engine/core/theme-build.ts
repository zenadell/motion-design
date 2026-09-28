import { DISPLAY_FONTS, MONO_FONTS, SERIF_FONTS } from '../../plan/fonts';
import type { Brand } from '../../plan/schema';
import { hexToHsl, hslHex, lum, mixHex } from './color';
import { clamp } from './math';
import type { Theme } from './theme';

/** Resolve a full theme from the brand block, deriving any colour left out. */
export function makeTheme(b: Brand): Theme {
  const c = b.colors;
  const [h, s, l] = hexToHsl(c.primary);
  const display = DISPLAY_FONTS[b.fonts.display], mono = MONO_FONTS[b.fonts.mono];
  const serif = b.fonts.serif ? SERIF_FONTS[b.fonts.serif] : null;
  return {
    bg: c.bg,
    text: c.text,
    primary: c.primary,
    secondary: c.secondary ?? hslHex((h + 22) % 360, clamp(s, 40, 100), clamp(l + 10, 35, 72)),
    accent: c.accent ?? hslHex((h + 75) % 360, 90, 60),
    surface: c.surface ?? mixHex(c.bg, c.text, 0.06),
    muted: c.muted ?? mixHex(c.text, c.bg, 0.35),
    light: c.light ?? (lum(c.text) > 0.6 ? c.text : '#F2EEE6'),
    dark: c.dark ?? (lum(c.bg) < 0.4 ? c.bg : '#0A0A0B'),
    display: { family: b.fonts.display, min: display.min, max: display.max },
    mono: { family: b.fonts.mono, min: mono.min, max: mono.max },
    serif: serif && b.fonts.serif ? { family: b.fonts.serif, min: serif.min, max: serif.max, italic: 'italicFile' in serif } : null,
  };
}
