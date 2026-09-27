// Objective motion-design checks on rendered frames: how much of the frame is
// used and how much changes over time. They catch the two failures a vision
// critic describes most often ("empty void", "static for a second") with
// exact timestamps the code writer can act on.

export interface Sample {
  t: number;
  coverage: number;
  motion: number;
}

export interface MotionReport {
  coverage: number;
  emptyShare: number;
  motion: number;
  staticRuns: [number, number][];
  flags: string[];
}

export const THRESHOLDS = {
  /** Below this share of changed pixels the frame counts as empty. */
  empty: 0.08,
  /** Mean absolute luminance change per 1/12 s below which nothing is moving. */
  still: 0.0025,
  /** Longest acceptable still stretch, in seconds (outside a final hold). The reference reels stay under 0.5 s. */
  maxStill: 0.5,
  /** Largest acceptable share of empty samples. */
  maxEmptyShare: 0.3,
};

/** Summarise samples of one scene (local times). `holdFrom` = start of an intended final hold (the last scene). */
export function motionReport(samples: Sample[], holdFrom = Infinity): MotionReport {
  const live = samples.filter(s => s.t < holdFrom);
  const n = Math.max(1, live.length);
  const coverage = live.reduce((a, s) => a + s.coverage, 0) / n;
  const emptyShare = live.filter(s => s.coverage < THRESHOLDS.empty).length / n;
  const moving = live.slice(1);
  const motion = moving.reduce((a, s) => a + s.motion, 0) / Math.max(1, moving.length);
  const staticRuns: [number, number][] = [];
  let run: number | null = null;
  for (let i = 1; i < live.length; i++) {
    const still = live[i].motion < THRESHOLDS.still;
    if (still && run === null) run = live[i - 1].t;
    if ((!still || i === live.length - 1) && run !== null) {
      const end = still ? live[i].t : live[i - 1].t;
      if (end - run >= THRESHOLDS.maxStill) staticRuns.push([run, end]);
      run = null;
    }
  }
  const flags: string[] = [];
  if (emptyShare > THRESHOLDS.maxEmptyShare)
    flags.push(`mostly empty: in ${Math.round(emptyShare * 100)}% of sampled frames less than ${THRESHOLDS.empty * 100}% of the frame is used (average coverage ${Math.round(coverage * 100)}%). Fill the composition: bigger type, full-bleed shapes, textures, layered depth.`);
  for (const [a, b] of staticRuns) flags.push(`nothing moves from ${a.toFixed(2)} s to ${b.toFixed(2)} s (${(b - a).toFixed(2)} s static). Add motion on the beats inside this window: secondary animation, camera drift, an accent, or cut sooner.`);
  return { coverage, emptyShare, motion, staticRuns, flags };
}

export interface BeatReport {
  hardChanges: number;
  onGrid: number;
  sync: number;
  offGrid: { t: number; grid: number }[];
  flags: string[];
}

/**
 * Beat precision (the MoVer idea: measurable, time-stamped checks instead of
 * vague critique). From per-frame motion at 60 fps, find hard changes (cuts,
 * slams, colour flips) and check each lands on the 16th-note grid. The
 * reference reels put 77–95 % of their hard changes on the grid.
 */
export function beatReport(frames: Sample[], beat: number, holdFrom = Infinity, target = 0.85): BeatReport {
  const live = frames.filter(s => s.t < holdFrom);
  const m = live.map(s => s.motion);
  const sorted = [...m].sort((a, b) => a - b);
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const thr = Math.max(0.08, p99 * 0.5);
  const grid = beat / 4, tol = 1.6 / 60;
  const changes: number[] = [];
  for (let i = 1; i < live.length; i++) if (m[i] > thr && m[i - 1] <= thr) changes.push(live[i].t);
  const offGrid: { t: number; grid: number }[] = [];
  for (const t of changes) {
    const g = Math.round(t / grid) * grid;
    // a change shows up on the first frame at or after the grid time
    if (Math.abs(t - g) > tol && Math.abs(t - (g + grid)) > tol) offGrid.push({ t, grid: g });
  }
  const sync = changes.length ? (changes.length - offGrid.length) / changes.length : 1;
  const flags: string[] = [];
  if (changes.length && sync < target)
    flags.push(`beat precision ${Math.round(sync * 100)}% (target ≥ ${Math.round(target * 100)}%): hard changes off the 16th-note grid at ${offGrid.slice(0, 6).map(o => `${o.t.toFixed(3)} s (nearest ${o.grid.toFixed(3)} s)`).join(', ')}. Time every cut, slam and colour flip at S.b(n) with n a multiple of 0.25.`);
  return { hardChanges: changes.length, onGrid: changes.length - offGrid.length, sync, offGrid, flags };
}
