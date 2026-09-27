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
  /** Longest acceptable still stretch, in seconds (outside a final hold). */
  maxStill: 0.75,
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
