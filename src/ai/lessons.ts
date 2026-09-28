import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from '../cli/html';
import { critiqueScore, type SceneCritique } from './invent-prompts';
import { parseJson, user, type LLM, type Usage } from './llm';

// The platform's memory of its own mistakes. After every run a reviewer reads
// what happened (scores, critiques, failed tests, which rewrites helped) and
// distils the root causes into short, concrete rules. The rules are stored in
// lessons/lessons.json (versioned with the code) and every later run shows the
// relevant ones to the model that made the mistake: the director, the coder,
// the critic or the breakdown writer. A lesson that is shown and still broken
// is counted as repeated and moves to the top, with a louder warning.

export type Role = 'director' | 'coder' | 'critic' | 'breakdown';
export const ROLES: Role[] = ['director', 'coder', 'critic', 'breakdown'];
/** 'exact' lessons apply to exact copies only, 'invent' ones to original films (and brand adaptations), 'any' to both. */
export type LessonMode = 'any' | 'invent' | 'exact';

export interface Lesson {
  id: string;
  /** The rule, imperative and concrete: what to do or never do, and how. */
  rule: string;
  /** The evidence: what went wrong when this was learned. */
  why: string;
  roles: Role[];
  tags: string[];
  mode: LessonMode;
  /** Runs in which the mistake was observed. */
  seen: number;
  /** Runs in which the lesson was shown to the model. */
  shown: number;
  /** Runs in which it was shown and the mistake happened anyway. */
  repeated: number;
  created: string;
  updated: string;
  sources: string[];
}

export const defaultLessonsPath = () => process.env.MOTION_LESSONS || join(ROOT, 'lessons', 'lessons.json');

const WORD = /[a-z][a-z0-9]{3,}/g;
const STOP = new Set(['with', 'that', 'this', 'from', 'into', 'when', 'than', 'then', 'them', 'they', 'their', 'there', 'each', 'every', 'only', 'never', 'always', 'must', 'should', 'scene', 'frame', 'frames', 'draw', 'make', 'keep', 'like', 'what', 'which', 'while', 'over', 'under', 'also', 'more', 'less', 'same', 'your']);
const words = (s: string) => new Set((s.toLowerCase().match(WORD) ?? []).filter(w => !STOP.has(w)));
const jaccard = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.max(1, a.size + b.size - n);
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'lesson';
const clampList = <T>(v: unknown, ok: (x: unknown) => x is T): T[] => (Array.isArray(v) ? v.filter(ok) : []);

/** How much a lesson matters regardless of the task: seen often, and above all repeated despite being shown. */
export const weight = (l: Lesson) => 1 + Math.log2(1 + l.seen) + 1.5 * l.repeated;

export class Lessons {
  lessons: Lesson[] = [];
  /** Ids shown to a model during this process (for the repeated count after the run). */
  readonly shownNow = new Set<string>();

  constructor(readonly file: string = defaultLessonsPath()) {
    this.reload();
  }

  reload() {
    this.lessons = existsSync(this.file) ? ((JSON.parse(readFileSync(this.file, 'utf8')) as { lessons?: Lesson[] }).lessons ?? []) : [];
  }

  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const sorted = [...this.lessons].sort((a, b) => weight(b) - weight(a) || a.id.localeCompare(b.id));
    writeFileSync(this.file, `${JSON.stringify({ version: 1, lessons: sorted }, null, 2)}\n`);
  }

  /** The lessons for one role, most relevant to the task first. */
  pick(role: Role, ctx: { mode: 'invent' | 'exact'; text?: string }, max = 10): Lesson[] {
    const task = words(ctx.text ?? '');
    return this.lessons
      .filter(l => l.roles.includes(role) && (l.mode === 'any' || l.mode === ctx.mode))
      .map(l => {
        const own = words(`${l.tags.join(' ')} ${l.rule}`);
        let hit = 0;
        for (const w of own) if (task.has(w)) hit++;
        return { l, s: weight(l) * (1 + Math.min(6, hit) * 0.35) };
      })
      .sort((a, b) => b.s - a.s)
      .slice(0, max)
      .map(x => x.l);
  }

  /** The prompt block for a role (empty when there is nothing to say). Marks the lessons as shown. */
  block(role: Role, ctx: { mode: 'invent' | 'exact'; text?: string }, max = 10): string {
    const list = this.pick(role, ctx, max);
    if (!list.length) return '';
    list.forEach(l => this.shownNow.add(l.id));
    const head = role === 'critic'
      ? 'KNOWN FAILURE MODES (this pipeline has made these mistakes before; check the render for each one and put any you see first in your fixes)'
      : 'LESSONS FROM EARLIER RUNS (mistakes this pipeline has made before; do not repeat them)';
    const note = ctx.mode === 'exact' ? '\n(Where a lesson conflicts with the reference, the reference wins.)' : '';
    return `\n\n${head}${note}\n${list.map(l => `- ${l.repeated ? `[REPEATED ${l.repeated}×, get this right] ` : ''}${l.rule}`).join('\n')}`;
  }

  /**
   * Fold a reviewer's findings into the store: known mistakes are reinforced
   * (same id, or a near-identical rule), new ones added, and lessons that were
   * shown this run but broken again are counted as repeated.
   */
  merge(found: Partial<Lesson>[], repeatedIds: string[], source: string, now = new Date().toISOString()) {
    const added: string[] = [], reinforced: string[] = [];
    for (const f of found) {
      const rule = typeof f.rule === 'string' ? f.rule.trim() : '';
      if (rule.length < 12) continue;
      const roles = clampList<Role>(f.roles, (x): x is Role => ROLES.includes(x as Role));
      const tags = clampList<string>(f.tags, (x): x is string => typeof x === 'string').map(t => t.toLowerCase().trim()).filter(Boolean).slice(0, 8);
      const mode: LessonMode = f.mode === 'exact' || f.mode === 'invent' ? f.mode : 'any';
      const own = words(rule);
      const same = this.lessons.find(l => l.id === f.id) ?? this.lessons.find(l => jaccard(words(l.rule), own) >= 0.5);
      if (same) {
        same.seen++;
        same.rule = rule;
        if (typeof f.why === 'string' && f.why.trim()) same.why = f.why.trim();
        same.roles = [...new Set([...same.roles, ...roles])];
        same.tags = [...new Set([...same.tags, ...tags])].slice(0, 10);
        same.sources = [...new Set([...same.sources, source])].slice(-8);
        same.updated = now;
        reinforced.push(same.id);
        continue;
      }
      let id = slug(typeof f.id === 'string' && f.id ? f.id : rule.split(/\s+/).slice(0, 6).join(' '));
      while (this.lessons.some(l => l.id === id)) id = `${id.slice(0, 44)}-${Math.floor(Math.random() * 900 + 100)}`;
      this.lessons.push({
        id, rule, why: typeof f.why === 'string' ? f.why.trim() : '', roles: roles.length ? roles : ['coder'], tags, mode,
        seen: 1, shown: 0, repeated: 0, created: now, updated: now, sources: [source],
      });
      added.push(id);
    }
    for (const id of this.shownNow) {
      const l = this.lessons.find(x => x.id === id);
      if (l) l.shown++;
    }
    const repeated = repeatedIds.filter(id => this.shownNow.has(id));
    for (const id of repeated) {
      const l = this.lessons.find(x => x.id === id);
      if (l) { l.repeated++; l.updated = now; }
    }
    // a bounded memory: the least important lessons make room for new ones
    if (this.lessons.length > 150) this.lessons = [...this.lessons].sort((a, b) => weight(b) - weight(a)).slice(0, 150);
    return { added, reinforced, repeated };
  }
}

// ── evidence: what happened in a run, in the reviewer's terms ────────────────

export interface SceneEvidence {
  id: string;
  idea: string;
  versions: { step: string; score: number; scores?: Record<string, number>; observed?: string; fixes?: string[]; kept?: boolean }[];
  tests: { tag: string; problems: string[]; resolved: boolean }[];
}
export interface RunEvidence {
  mode: 'invent' | 'exact' | 'adapt';
  models: { code: string; critic: string; direction?: string };
  title?: string;
  target: number;
  lib: { tests: { tag: string; problems: string[]; resolved: boolean }[] };
  scenes: SceneEvidence[];
  film: { score: number; summary: string; scenes: { id: string; score: number; fix: string }[] }[];
  /** Notes from outside the scene loop (e.g. replicate: the breakdown). */
  notes?: string[];
}

export function newEvidence(mode: RunEvidence['mode'], models: RunEvidence['models'], target: number): RunEvidence {
  return { mode, models, target, lib: { tests: [] }, scenes: [], film: [] };
}

export function sceneEvidence(ev: RunEvidence, id: string, idea: string): SceneEvidence {
  let s = ev.scenes.find(x => x.id === id);
  if (!s) ev.scenes.push((s = { id, idea: idea.slice(0, 700), versions: [], tests: [] }));
  return s;
}

/**
 * Evidence rebuilt from a finished run's files (for runs made before the
 * evidence file existed): critiques from the transcript, ideas from the direction.
 */
export function evidenceFromRun(dir: string): RunEvidence {
  const read = <T>(n: string): T | undefined => (existsSync(join(dir, n)) ? (JSON.parse(readFileSync(join(dir, n), 'utf8')) as T) : undefined);
  const saved = read<RunEvidence>('evidence.json');
  if (saved) return saved;
  const direction = read<{ title?: string; exact?: boolean; scenes?: { id: string; idea: string }[] }>('direction.json');
  const audit = read<{ step: string; model: string; reply: string }[]>('transcript.json') ?? [];
  const report = read<{ mode?: string; models?: { code?: string; critic?: string; direction?: string }; filmReviews?: { score: number; summary: string }[] }>('report.json');
  const ev = newEvidence(direction?.exact ? 'exact' : report?.mode === 'replicate' ? 'adapt' : 'invent', {
    code: report?.models?.code ?? audit.find(a => a.step.startsWith('code'))?.model ?? '?',
    critic: report?.models?.critic ?? audit.find(a => a.step.startsWith('critique'))?.model ?? '?',
    direction: report?.models?.direction,
  }, 9);
  ev.title = direction?.title;
  for (const s of direction?.scenes ?? []) sceneEvidence(ev, s.id, s.idea ?? '');
  for (const a of audit) {
    const m = a.step.match(/^critique (\S+) (.+)$/);
    if (!m) continue;
    try {
      const c = parseJson<SceneCritique>(a.reply);
      sceneEvidence(ev, m[1], '').versions.push({ step: m[2], score: critiqueScore(c), scores: c.scores, observed: c.observed, fixes: (c.fixes ?? []).slice(0, 4) });
    } catch {
      /* not a critique reply */
    }
  }
  for (const r of report?.filmReviews ?? []) ev.film.push({ score: r.score, summary: r.summary, scenes: [] });
  return ev;
}

// ── the reviewer ─────────────────────────────────────────────────────────────

export const reflectSchema = () => ({
  type: 'object',
  properties: {
    lessons: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'an existing lesson id when this is the same mistake again, else a new short kebab-case id' },
          rule: { type: 'string', description: 'the rule: imperative, concrete, checkable, 1–2 sentences (name the technique, API, number or pattern)' },
          why: { type: 'string', description: 'what went wrong in this run, with the evidence (scene, score, what the critic saw)' },
          roles: { type: 'array', items: { type: 'string', enum: ROLES } },
          tags: { type: 'array', items: { type: 'string' }, description: '2–5 topic tags, e.g. kinetic-type, ui, logo, glow, timing, layout, camera, 3d, code-error, performance, sound' },
          mode: { type: 'string', enum: ['any', 'invent', 'exact'] },
        },
        required: ['id', 'rule', 'why', 'roles', 'tags', 'mode'],
      },
    },
    repeated: { type: 'array', items: { type: 'string' }, description: 'ids of the lessons SHOWN this run whose mistake happened again anyway' },
  },
  required: ['lessons', 'repeated'],
});

export function reflectSystem(): string {
  return `You are the post-mortem reviewer of an AI motion design pipeline. A director model writes a direction, a coder model writes canvas/Web Audio code for each scene, a critic model watches each rendered scene and scores it 1–10 (in exact-copy mode: how faithfully it reproduces the reference), and the coder rewrites from the critique. You read what happened in one run and write the lessons the pipeline must remember so it never makes the same mistakes again.

How to work:
- Go through every scene that ended below the target score, every version that scored low, every rewrite that failed to improve, and every failed engine test. For each, find the ROOT CAUSE: what the coder, director, critic or breakdown did wrong (e.g. drew the whole phrase at once instead of stepping through the timed word states; ignored the measured sizes; wrote code that divides by a value that can be 0; a critic that asked for something the reference does not have).
- Also learn from what worked: when a rewrite jumped the score, capture the move that did it.
- Write each lesson as a rule for the role that must change: imperative, concrete and checkable, naming the technique, API, number or pattern. General enough to apply to other films (never this film's words or brand), specific enough that following it clearly prevents the mistake. Bad: "make the typography better". Good: "When the reference changes the on-screen words every 0.25 s, drive the text from a keyed array of states [{t, words, colour}] and draw only the state for the current time; never lay the whole phrase out at once."
- If an existing lesson already covers the mistake, return it with the SAME id (sharpen its rule if the evidence shows it was too vague). List in "repeated" the ids of lessons that were SHOWN this run and were broken anyway.
- Set the mode carefully. An exact copy follows its reference, whatever the reference does: small text, pill buttons, still holds, wide glows. So style and taste rules (type sizes, density, energy, which tropes to avoid, how bold or busy a frame is) are mode "invent" (original films only). Lessons about faithfully reproducing a reference are "exact". Use "any" only for technical and execution lessons that hold for every film (code errors and guards, clip padding, layering, timing precision, drawing a described effect correctly).
- At most 8 lessons. Quality over quantity: skip one-off accidents that cannot recur, and never write a lesson that contradicts the evidence.`;
}

export function reflectUser(ev: RunEvidence, existing: Lesson[], shown: string[]): string {
  const brief = existing.map(l => ({ id: l.id, roles: l.roles, mode: l.mode, rule: l.rule, seen: l.seen, repeated: l.repeated }));
  return `EXISTING LESSONS (${existing.length})
${JSON.stringify(brief, null, 1)}

SHOWN TO THE MODELS THIS RUN: ${shown.length ? shown.join(', ') : '(none)'}

WHAT HAPPENED IN THIS RUN
${JSON.stringify(ev, null, 1)}

Write the lessons.`;
}

/** Review a run and fold what it teaches into the store (saved). */
export async function learn(llm: LLM, store: Lessons, ev: RunEvidence, source: string) {
  store.reload();
  const shown = [...store.shownNow];
  const r = await llm.json({ label: 'learn', effort: 'high', schema: reflectSchema(), system: reflectSystem(), turns: [user(reflectUser(ev, store.lessons, shown))] });
  const out = parseJson<{ lessons?: Partial<Lesson>[]; repeated?: string[] }>(r.text);
  const res = store.merge(Array.isArray(out.lessons) ? out.lessons : [], Array.isArray(out.repeated) ? out.repeated : [], source);
  store.save();
  return { ...res, usage: r.usage as Usage, reply: r.text };
}
