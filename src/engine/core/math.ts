// Scalar helpers shared by every technique. All animation in the engine is a
// pure function of time, so these stay side-effect free and deterministic.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Normalised progress of `t` through the window [a, b], clamped to 0..1. */
export const prog = (t: number, a: number, b: number): number => clamp((t - a) / (b - a));
export const mod = (a: number, n: number): number => ((a % n) + n) % n;
export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Deterministic hash noise in 0..1 — same inputs always give the same frame. */
export const rnd = (i: number, j = 0): number => {
  const x = Math.sin(i * 127.1 + j * 311.7 + 74.7) * 43758.5453123;
  return x - Math.floor(x);
};

/** Exponential decay that starts at 1 when `t` reaches `at`. */
export const pulse = (t: number, at: number, k = 12): number => (t < at ? 0 : Math.exp(-k * (t - at)));

/** A single parabolic bounce 0 → 1 → 0 over `d` seconds, starting at `t0`. */
export const hop = (t: number, t0: number, d = 0.2): number => {
  const x = (t - t0) / d;
  return x > 0 && x < 1 ? 4 * x * (1 - x) : 0;
};

export const E = {
  linear: (t: number) => t,
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  inExpo: (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t: number) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  outBack: (t: number, s = 1.70158) => (t <= 0 ? 0 : 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)),
};

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
