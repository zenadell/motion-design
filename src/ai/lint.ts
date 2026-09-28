import { getTechnique } from '../engine/techniques';
import type { Issue } from '../plan/validate';
import type { Plan, PlanInput } from '../plan/schema';

// Checks a model can get wrong that the schema can't express: length, arc,
// variety and invented facts. `fitDuration` fixes small length errors itself
// so a repair round isn't spent on arithmetic.

type SectionIn = PlanInput['sections'][number];

const q = (x: number) => Math.round(x * 4) / 4;
export const totalBeats = (sections: { beats: number }[]) => sections.reduce((a, s) => a + s.beats, 0);

/**
 * Stretch or trim flexible sections so the plan lasts `target` beats. Prefers
 * the outro, then the logo, then the longest flexible sections. Gives up (and
 * returns false) when the gap is more than `maxFix` beats: that means the plan
 * needs different sections, not different lengths.
 */
export function fitDuration(sections: SectionIn[], target: number, maxFix = 4): boolean {
  let diff = q(target - totalBeats(sections));
  if (diff === 0) return true;
  if (Math.abs(diff) > maxFix) return false;
  const order = sections
    .map((s, i) => ({ s, i, t: getTechnique(s.technique) }))
    .filter(x => x.t && x.t.beats.max > x.t.beats.min)
    .sort((a, b) => rank(b.t!.category) - rank(a.t!.category) || b.s.beats - a.s.beats);
  for (const { s, t } of order) {
    if (diff === 0) break;
    const next = Math.min(t!.beats.max, Math.max(t!.beats.min, q(s.beats + diff)));
    diff = q(diff - (next - s.beats));
    s.beats = next;
  }
  return diff === 0;
}
const rank = (cat: string) => ({ outro: 5, brand: 4, data: 3, shape: 2, ui: 2, camera: 1 } as Record<string, number>)[cat] ?? 0;

export interface LintContext {
  targetBeats?: number;
  /** Lowercased brief + brand facts; proper nouns and numbers must appear here. */
  corpus?: string;
}

export interface LintIssue extends Issue {
  severity: 'error' | 'warn';
}

const NUM = /\d+(?:[.,]\d+)?/g;

/** Strings in params that state facts: names of places, work, and any number. */
function claims(technique: string, params: Record<string, unknown>): { path: string; text: string; kind: 'name' | 'number' }[] {
  const out: { path: string; text: string; kind: 'name' | 'number' }[] = [];
  const p = params as Record<string, any>;
  if (technique === 'dot-globe') {
    if (p.hq?.name) out.push({ path: 'hq.name', text: p.hq.name, kind: 'name' });
    (p.cities ?? []).forEach((c: any, i: number) => c?.name && out.push({ path: `cities[${i}].name`, text: c.name, kind: 'name' }));
  }
  if (technique === 'montage') (p.items ?? []).forEach((c: any, i: number) => c?.title && out.push({ path: `items[${i}].title`, text: c.title, kind: 'name' }));
  if (technique === 'code-editor' || technique === 'signature-card') return out; // code and credits carry incidental numbers
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') for (const m of v.match(NUM) ?? []) out.push({ path, text: m, kind: 'number' });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'lat' && k !== 'lon') walk(x, path ? `${path}.${k}` : k);
  };
  walk(params, '');
  return out;
}

export function lintPlan(plan: Plan, ctx: LintContext): LintIssue[] {
  const issues: LintIssue[] = [];
  const S = plan.sections;
  if (ctx.targetBeats !== undefined) {
    const total = totalBeats(S);
    if (Math.abs(total - ctx.targetBeats) > 0.5)
      issues.push({ severity: 'error', path: 'sections', message: `the sections add up to ${total} beats but the piece must be ${ctx.targetBeats} beats (${S.map(s => s.beats).join(' + ')}). Add, remove or resize sections.` });
  }
  const first = getTechnique(S[0].technique), last = getTechnique(S[S.length - 1].technique);
  if (first && !['intro', 'type'].includes(first.category))
    issues.push({ severity: 'error', path: 'sections[0]', message: `open with a hook (blade-open, word-cuts, glitch-word or impact-word), not ${first.id}` });
  if (last && last.category !== 'outro')
    issues.push({ severity: 'error', path: `sections[${S.length - 1}]`, message: 'end on end-card or signature-card' });
  S.forEach((s, i) => {
    if (i && S[i - 1].technique === s.technique && s.technique !== 'word-cuts')
      issues.push({ severity: 'error', path: `sections[${i}].technique`, message: `${s.technique} twice in a row; vary the techniques` });
  });
  const seen = new Map<string, number>();
  for (const s of S) seen.set(s.technique, (seen.get(s.technique) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 2) issues.push({ severity: 'warn', path: 'sections', message: `${id} is used ${n} times` });
  if (ctx.corpus) {
    const corpus = ctx.corpus;
    const allowedNums = new Set([String(plan.music.bpm), String(new Date().getFullYear())]);
    S.forEach((s, i) => {
      for (const c of claims(s.technique, s.params)) {
        const needle = c.text.toLowerCase().trim();
        if (!needle || (c.kind === 'number' && allowedNums.has(needle))) continue;
        const found = c.kind === 'number' ? new RegExp(`(^|[^\\d])${needle.replace(/[.,]/g, '[.,]')}($|[^\\d])`).test(corpus) : corpus.includes(needle);
        if (!found)
          issues.push({ severity: 'error', path: `sections[${i}].params.${c.path}`, message: `"${c.text}" is not in the brief or the brand facts. Only state real facts: use one from the facts, or remove this ${c.kind === 'number' ? 'number' : 'name'} (or the section).` });
      }
    });
  }
  return issues;
}
