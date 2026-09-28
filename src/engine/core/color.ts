import { clamp, lerp } from './math';

type RGB = [number, number, number];
const cache = new Map<string, RGB>();

export function rgb(hex: string): RGB {
  let v = cache.get(hex);
  if (!v) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    cache.set(hex, v);
  }
  return v;
}
export const rgba = (hex: string, a: number): string => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${clamp(a)})`;
};
export const mixRGB = (a: RGB, b: RGB, p: number): RGB => [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)];
export const css = (c: RGB, a = 1): string => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export const mix = (a: string, b: string, p: number): string => css(mixRGB(rgb(a), rgb(b), clamp(p)));
export const toHex = (c: RGB): string =>
  '#' + c.map(x => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
export const mixHex = (a: string, b: string, p: number): string => toHex(mixRGB(rgb(a), rgb(b), clamp(p)));

/** Relative luminance 0..1 (sRGB weights, no gamma — good enough for picking text colour). */
export const lum = (hex: string): number => {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
export const readableOn = (bg: string, light: string, dark: string): string => (lum(bg) > 0.5 ? dark : light);

export function hslHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map(x => x / 255) as RGB;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s * 100, l * 100];
}
