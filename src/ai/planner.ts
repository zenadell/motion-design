import { CHORD_RE } from '../engine/audio/chords';
import type { Plan, PlanInput } from '../plan/schema';
import { validatePlan, type Issue } from '../plan/validate';
import { factCorpus, type BrandKit } from './brand-kit';
import { fitDuration, lintPlan } from './lint';
import { LLMError, model, parseJson, user, type Effort, type LLM, type Turn, type Usage } from './llm';
import { plannerSystem, plannerUser, repairMessage, type PlanTarget } from './prompts';
import { plannerSchema, type PlannerReply } from './schema';

export interface PlanOptions {
  brief: string;
  kit: BrandKit;
  seconds?: number;
  bpm?: number;
  genre?: 'afro-house' | 'electro';
  effort?: Effort;
  /** Repair rounds after the first draft (validation + lint feedback). */
  maxRepairs?: number;
  /** Use the per-technique response schema (falls back to free-form JSON if the API rejects it). */
  strict?: boolean;
  log?: (s: string) => void;
}

export interface Round {
  label: string;
  issues: Issue[];
}

export interface PlanResult {
  plan: Plan;
  concept: string;
  /** Validator and lint warnings on the final plan, plus lint errors left after the last repair. */
  warnings: Issue[];
  rounds: Round[];
  usage: Usage[];
}

export function targetOf(o: Pick<PlanOptions, 'seconds' | 'bpm' | 'genre'>): PlanTarget {
  const bpm = Math.min(140, Math.max(90, o.bpm ?? 120));
  const seconds = Math.min(90, Math.max(6, o.seconds ?? 20));
  return { seconds, bpm, beats: Math.round(((seconds * bpm) / 60) * 4) / 4, genre: o.genre };
}

/** Turn the model's reply into plan input: inject the brand, pin the tempo, drop bad chords, fit the length. */
export function assemble(reply: PlannerReply, kit: BrandKit, target: PlanTarget): PlanInput {
  const genre = target.genre ?? (reply.music?.genre === 'electro' ? 'electro' : 'afro-house');
  const chords = (reply.music?.progression ?? []).filter(c => typeof c === 'string' && CHORD_RE.test(c));
  const sections = (Array.isArray(reply.sections) ? reply.sections : []) as PlanInput['sections'];
  const clean = sections.filter(s => s && typeof s === 'object' && typeof s.technique === 'string' && typeof s.beats === 'number');
  if (clean.length === sections.length) fitDuration(clean, target.beats);
  return {
    meta: { title: (reply.title ?? '').slice(0, 80) || 'Showreel' },
    brand: kit.brand,
    music: { bpm: target.bpm, genre, ...(chords.length ? { progression: chords.slice(0, 8) } : {}) },
    sections,
  };
}

/**
 * A planning conversation. `draft()` writes the first plan; `revise()` sends
 * feedback (e.g. from visual QA) and gets a corrected plan. Both run the same
 * loop: parse → assemble → validate → lint → send issues back → repeat.
 */
export class Planner {
  readonly usage: Usage[] = [];
  readonly rounds: Round[] = [];
  private turns: Turn[] = [];
  private schema: object | undefined;
  private target: PlanTarget;
  private corpus: string;
  private log: (s: string) => void;

  constructor(private llm: LLM, private o: PlanOptions) {
    this.target = targetOf(o);
    this.corpus = factCorpus(o.kit, o.brief);
    this.schema = o.strict === false ? undefined : plannerSchema();
    this.log = o.log ?? (() => {});
  }

  draft(): Promise<PlanResult> {
    this.turns = [user(plannerUser(this.o.brief, this.o.kit, this.target))];
    return this.loop('plan');
  }

  revise(feedback: string): Promise<PlanResult> {
    if (!this.turns.length) throw new Error('draft() first');
    this.turns.push(user(feedback));
    return this.loop('revise');
  }

  private async ask(label: string) {
    for (;;) {
      try {
        const r = await this.llm.json({ label, system: plannerSystem(), turns: this.turns, schema: this.schema, effort: this.o.effort ?? 'medium' });
        this.usage.push(r.usage);
        return r.text;
      } catch (e) {
        if (!(e instanceof LLMError && e.schemaRejected && this.schema)) throw e;
        this.schema = undefined;
        this.log(`  schema rejected (${e.message.slice(0, 120)}); continuing with free-form JSON`);
      }
    }
  }

  private async loop(kind: 'plan' | 'revise'): Promise<PlanResult> {
    const max = this.o.maxRepairs ?? 3;
    let best: { plan: Plan; concept: string; warnings: Issue[]; open: Issue[] } | undefined;
    for (let r = 0; r <= max; r++) {
      const label = r ? `${kind} · repair ${r}` : kind;
      this.log(`  ${label}…`);
      const text = await this.ask(label);
      let issues: Issue[];
      let reply: PlannerReply = {};
      try {
        reply = parseJson<PlannerReply>(text);
        const v = validatePlan(assemble(reply, this.o.kit, this.target));
        if (!v.ok) issues = v.errors;
        else {
          const lint = lintPlan(v.plan, { targetBeats: this.target.beats, corpus: this.corpus });
          issues = lint.filter(i => i.severity === 'error');
          const warnings = [...v.warnings, ...lint.filter(i => i.severity === 'warn')];
          best = { plan: v.plan, concept: reply.concept ?? '', warnings, open: issues };
        }
      } catch (e) {
        issues = [{ path: '', message: `reply is not valid JSON (${(e as Error).message.slice(0, 160)})` }];
      }
      this.rounds.push({ label, issues });
      this.turns.push(model(text));
      if (!issues.length && best) return { plan: best.plan, concept: best.concept, warnings: best.warnings, rounds: this.rounds, usage: this.usage };
      this.log(`  ${issues.length} issue${issues.length === 1 ? '' : 's'}: ${issues.slice(0, 3).map(i => `${i.path} ${i.message}`.slice(0, 90)).join(' | ')}`);
      if (r < max) this.turns.push(user(repairMessage(issues)));
    }
    if (best) {
      // Valid but still failing lint after every repair: ship it with the open issues as warnings.
      return { plan: best.plan, concept: best.concept, warnings: [...best.warnings, ...best.open], rounds: this.rounds, usage: this.usage };
    }
    throw new Error(`no valid plan after ${max + 1} attempts:\n${this.rounds[this.rounds.length - 1].issues.map(i => `• ${i.path}: ${i.message}`).join('\n')}`);
  }
}

export async function planVideo(llm: LLM, o: PlanOptions): Promise<PlanResult> {
  return new Planner(llm, o).draft();
}
