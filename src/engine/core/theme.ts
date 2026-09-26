import { clamp } from './math';

export interface FontFace {
  family: string;
  /** Lowest / highest weight the (variable) font file supports. */
  min: number;
  max: number;
  italic?: boolean;
}

/**
 * Resolved brand theme. Techniques never hard-code colours or families —
 * they read these roles so one plan can re-skin the whole library.
 */
export interface Theme {
  bg: string;        // page background (usually the darkest brand colour)
  surface: string;   // panels, cards
  text: string;      // main foreground on bg
  muted: string;     // secondary text
  primary: string;   // hero brand colour
  secondary: string; // supporting brand colour
  accent: string;    // a third, contrasting pop colour
  dark: string;      // ink used on light fills
  light: string;     // paper used for light scenes
  display: FontFace;
  mono: FontFace;
  serif: FontFace | null;
}

let current: Theme | null = null;
export const setTheme = (t: Theme): void => {
  current = t;
};
export const theme = (): Theme => {
  if (!current) throw new Error('theme not set');
  return current;
};

export type FontRole = 'display' | 'mono' | 'serif';

/** Set `g.font` for a role, clamping the weight to what the font file supports. */
export function font(g: CanvasRenderingContext2D, size: number, weight = 700, role: FontRole = 'display', italic = false): void {
  const T = theme();
  const f = role === 'mono' ? T.mono : role === 'serif' ? T.serif ?? T.display : T.display;
  const w = Math.round(clamp(weight, f.min, f.max));
  const fallback = role === 'mono' ? 'ui-monospace, monospace' : role === 'serif' && T.serif ? 'Georgia, serif' : 'system-ui, sans-serif';
  const it = italic && (role !== 'serif' || T.serif?.italic) ? 'italic ' : '';
  g.font = `${it}${w} ${size.toFixed(1)}px "${f.family}", ${fallback}`;
}
