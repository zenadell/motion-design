import type { Plan, TransitionType } from '../../plan/schema';
import { getTechnique } from '../techniques';
import type { Technique } from '../techniques/types';

export interface TimedSection {
  index: number;
  technique: Technique;
  params: Record<string, unknown>;
  start: number;
  end: number;
  dur: number;
  beats: number;
  energy: number;
  /** Transition into the next section (null = hard cut). */
  transition: { type: TransitionType; dur: number } | null;
  label: string;
  hud: boolean;
}

export interface Timeline {
  B: number;
  duration: number;
  sections: TimedSection[];
}

/** Lay sections end-to-end on the beat grid. Plan must already be validated. */
export function buildTimeline(plan: Plan): Timeline {
  const B = 60 / plan.music.bpm;
  let t = 0;
  const sections = plan.sections.map((s, index) => {
    const technique = getTechnique(s.technique)!;
    const dur = s.beats * B;
    const tr = typeof s.transition === 'string' ? { type: s.transition, beats: 0.5 } : s.transition;
    const isLast = index === plan.sections.length - 1;
    const out: TimedSection = {
      index, technique, params: s.params, start: t, end: t + dur, dur, beats: s.beats,
      energy: s.energy ?? technique.energy,
      transition: tr && tr.type !== 'cut' && !isLast ? { type: tr.type, dur: tr.beats * B } : null,
      label: s.label ?? technique.label,
      hud: s.hud ?? technique.hud ?? true,
    };
    t += dur;
    return out;
  });
  return { B, duration: t, sections };
}

export function sectionIndexAt(tl: Timeline, t: number): number {
  const s = tl.sections;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
