import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { dataUrlToBuffer, launch, openReel } from '../cli/browser';
import { renderClips } from '../cli/clip';
import { buildHtml } from '../cli/html';
import { autoTimes, renderVideo } from '../cli/render';
import { DISPLAY_NAMES, SERIF_NAMES } from '../plan/fonts';
import type { Plan, PlanInput } from '../plan/schema';
import { validatePlan } from '../plan/validate';
import { factCorpus, type BrandKit } from './brand-kit';
import { inspectScene, referenceStills, type Detail } from './inspect';
import { learn, newEvidence, sceneEvidence, type Lessons, type Role } from './lessons';
import { beatReport, motionReport, type MotionReport } from './metrics';
import { image, parseJson, summarizeUsage, text, user, video, type Effort, type LLM, type Part, type Usage } from './llm';
import {
  coderSystem, conceptsSchema, conceptsUser, critiqueScore, detailCriticSystem, detailSchema, developUser, directionSchema, directorSystem, directorUser, filmCriticSchema, filmCriticSystem, fixUser, libSchema, libUser,
  pairSchema, pairSystem, pickSchema, pickSystem, type Concept,
  rewriteUser, sceneCriticSchema, sceneCriticSystem, sceneCriticUser, sceneSchema, sceneUser,
  type Direction, type FilmCritique, type SceneCritique,
} from './invent-prompts';

// Invent mode: the model designs a new visual language and writes all of the
// drawing and sound code. The pipeline runs what it writes, reports back what
// broke, renders every scene to a clip the model WATCHES and scores against a
// studio rubric, keeps the best of several candidates, and loops
// critique → rewrite while the score improves. Then the whole film (with
// sound) is reviewed and the weakest scenes get another pass.

export interface InventOptions {
  kit: BrandKit;
  brief: string;
  seconds?: number;
  bpm?: number;
  /** Competing versions written per scene; the critic keeps the best. */
  candidates?: number;
  /** Watch → critique → rewrite rounds per scene. */
  rounds?: number;
  /** Whole-film reviews, each followed by a pass on the weakest scenes. */
  filmRounds?: number;
  /** Automated test → fix rounds per piece of code. */
  fixRounds?: number;
  /** Stop optional refinement once model spend passes this many US dollars. */
  budget?: number;
  /** A score (0–10) at which a scene stops being refined. */
  target?: number;
  render?: boolean;
  workers?: number;
  concurrency?: number;
  outDir: string;
  log?: (s: string) => void;
  /** Separate models for writing code and for critiquing (default: the main model). */
  codeLLM?: LLM;
  criticLLM?: LLM;
  /**
   * Refine an existing film: keep its code and rework only the listed scene
   * ids (needs `direction`). `fresh` writes those scenes again from scratch
   * (N candidates, like a new film) instead of starting from their current code.
   */
  resume?: { plan: Plan; only: string[]; fresh?: boolean };
  /** Continue a run that stopped (its partial.json): keep the lib, score and finished scenes, write only the missing ones. */
  partial?: { lib: string; score: string; scenes: SceneCode[] };
  /** Skip the director: use this direction (replicate mode). */
  direction?: Direction;
  /** The client's feedback on earlier versions; the director, the concept judge and the critics must respect it. */
  feedback?: string;
  /** Reference films that define the quality bar: videos (shown to director and critics) and their source code (shown to the coder). */
  bar?: { videos: Buffer[]; code?: string };
  /** Extra context for every scene prompt and critique (replicate mode: the reference breakdown). */
  reference?: {
    note: string; clips?: Buffer[]; exact?: boolean;
    /** The reference video and each scene's window in it: exact copies are inspected against it frame by frame. */
    source?: { file: string; windows: { from: number; to: number }[] };
  };
  /** The platform's memory of past mistakes: relevant lessons go into every prompt, and the run is reviewed afterwards. */
  lessons?: Lessons;
  /** Skip the post-run review (lessons are still applied). */
  noLearn?: boolean;
  /** The model that reviews the run and writes lessons (default: the critic). */
  learnLLM?: LLM;
}

export interface SceneCode {
  draw: string;
  sfx: string;
  hits: { beat: number; shake: number }[];
}

const q2 = (x: number) => Math.max(0.5, Math.round(x * 2) / 2);

/** Rescale scene lengths so they add up to the target, on a half-beat grid. */
export function fitScenes(beats: number[], target: number): number[] {
  const total = beats.reduce((a, b) => a + b, 0) || 1;
  const out = beats.map(b => q2((b * target) / total));
  let diff = Math.round((target - out.reduce((a, b) => a + b, 0)) * 2) / 2;
  const order = out.map((_, i) => i).sort((a, b) => out[b] - out[a]);
  for (let k = 0; diff !== 0 && k < 200; k++) {
    const i = order[k % order.length], step = diff > 0 ? 0.5 : -0.5;
    if (out[i] + step >= 0.5) { out[i] += step; diff -= step; }
  }
  return out;
}

/** Numbers stated inside string literals of scene code that are not in the brief or facts. */
export function unverifiedNumbers(code: string, corpus: string, allowed: string[]): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    // escapes are characters, not numbers: "It’s" does not state 2019
    const lit = m[2].replace(/\\u\{[0-9a-f]+\}|\\u[0-9a-f]{4}|\\x[0-9a-f]{2}/gi, ' ');
    if (!/[a-z]/i.test(lit) && !/[%+]/.test(lit)) continue;
    if (/px|rgba?\(|hsla?\(|#[0-9a-f]{3,8}\b|deg|blur\(|contrast\(|\bms\b|^\s*\d+\s*$/i.test(lit)) continue;
    for (const n of lit.replace(/\$\{[^}]*\}/g, '').match(/\d+(?:[.,]\d+)?/g) ?? []) {
      if (allowed.includes(n)) continue;
      if (!new RegExp(`(^|[^\\d])${n.replace(/[.,]/g, '[.,]')}($|[^\\d])`).test(corpus)) out.add(`"${lit.slice(0, 60)}" states ${n}`);
    }
  }
  return [...out];
}

async function pool<T, R>(items: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i], i);
    }
  }));
  return out;
}

const cleanScene = (r: Partial<SceneCode> | undefined, prev?: SceneCode): SceneCode => ({
  draw: typeof r?.draw === 'string' && r.draw.trim() ? r.draw : prev?.draw ?? '',
  sfx: typeof r?.sfx === 'string' ? r.sfx : prev?.sfx ?? '',
  hits: Array.isArray(r?.hits) ? r!.hits! : prev?.hits ?? [],
});

/** What is missing from a direction for the pipeline to build it (empty = usable). */
export function directionProblems(d: Partial<Direction> | undefined): string[] {
  const out: string[] = [];
  if (!d || typeof d !== 'object') return ['no direction'];
  const scenes = Array.isArray(d.scenes) ? d.scenes : [];
  if (scenes.length < 3) out.push(`${scenes.length} scenes (need 6–10)`);
  const bad = scenes.filter(s => !s || typeof s.idea !== 'string' || !s.idea.trim() || !(Number(s.beats) > 0)).length;
  if (bad) out.push(`${bad} scene(s) without an idea or beats`);
  if (!d.look || typeof d.look !== 'object') out.push('no look');
  if (!d.title) out.push('no title');
  return out;
}

export async function invent(llm: LLM, o: InventOptions) {
  const log = o.log ?? (() => {});
  const codeLLM = o.codeLLM ?? llm, criticLLM = o.criticLLM ?? llm;
  const dir = o.outDir;
  mkdirSync(dir, { recursive: true });
  const f = (n: string) => join(dir, n);
  const usage: Usage[] = [];
  const audit: { step: string; model: string; at: string; reply: string }[] = [];
  const t0 = Date.now();
  const fixRounds = o.fixRounds ?? 3, conc = o.concurrency ?? 3, budget = o.budget ?? 6, target = o.target ?? 9;
  const spent = () => summarizeUsage(usage).usd ?? 0;
  const coder = () => coderSystem(o.bar?.code);
  const feedbackNote = o.feedback ? `\n\nCLIENT FEEDBACK ON EARLIER VERSIONS (must be respected):\n${o.feedback}` : '';
  /** The reference films, first in the prompt so Gemini's implicit cache can reuse them across calls. */
  const barParts = (fps: number): Part[] =>
    o.bar?.videos.length
      ? [text('REFERENCE BAR: films by a top motion designer (9/10 craft). Watch them closely: this is the level of energy, rhythm, density and polish to reach and surpass. Your film must be as good and completely different in idea and look.'), ...o.bar.videos.map(v => video(v, fps))]
      : [];
  const overBudget = () => spent() > budget;

  const ask = async <T>(m: LLM, label: string, system: string, parts: (Part | string)[], schema: object, effort: Effort): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const r = await m.json({ label, system, turns: [user(...parts)], schema, effort });
      usage.push(r.usage);
      audit.push({ step: label, model: m.model, at: new Date().toISOString(), reply: r.text });
      writeFileSync(f('transcript.json'), JSON.stringify(audit, null, 2));
      let v: unknown;
      try {
        v = parseJson<unknown>(r.text);
      } catch (e) {
        // a reply cut off mid-stream (or otherwise broken) is asked for again, not fatal
        if (attempt < 2) {
          log(`  ${label}: the reply is not valid JSON (${r.text.length} chars, probably cut off) → asking again`);
          continue;
        }
        throw e;
      }
      // some models wrap the requested object in a one-element array
      if (Array.isArray(v) && v.length === 1 && v[0] && typeof v[0] === 'object' && (schema as { type?: string }).type === 'object') return v[0] as T;
      return v as T;
    }
  };
  /** A scene-level step that may fail (a model error, a broken reply) without stopping the film. */
  const attempt = async <T>(what: string, f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f();
    } catch (e) {
      log(`    ${what} failed, skipped: ${String((e as Error).message ?? e).slice(0, 160)}`);
      return null;
    }
  };

  // ── 1. direction ──────────────────────────────────────────────────────────
  const seconds = Math.min(60, Math.max(8, o.seconds ?? 24));
  let d: Direction;
  if (o.direction) d = o.direction;
  else {
    log('1/6 direction: concept tournament');
    const base = directorUser(o.brief, o.kit, Math.round((seconds * (o.bpm ?? 120)) / 60), seconds, o.bpm) + feedbackNote
      + (o.lessons?.block('director', { mode: o.reference?.exact ? 'exact' : 'invent', text: o.brief }) ?? '');
    const { concepts } = await ask<{ concepts: Concept[] }>(llm, 'concepts', directorSystem(), [...barParts(3), conceptsUser(base, 3)], conceptsSchema(), 'high');
    concepts.forEach((c, k) => log(`  ${k + 1}. "${c.title}" — ${c.idea.slice(0, 160)}`));
    const pick = await ask<{ ranking: number[]; reasons: string }>(criticLLM, 'pick concept', pickSystem(), [...barParts(2), `BRIEF AND BRAND\n${base}`, `CONCEPTS\n${JSON.stringify(concepts.map((c, k) => ({ index: k, ...c })), null, 1)}`], pickSchema(), 'medium');
    const chosen = concepts[pick.ranking?.find(k => concepts[k]) ?? 0] ?? concepts[0];
    log(`  picked "${chosen.title}": ${pick.reasons.slice(0, 200)}`);
    d = await ask<Direction>(llm, 'direct', directorSystem(), [...barParts(3), developUser(base, chosen)], directionSchema(), 'high');
    // some models return a thin direction (no scenes, missing fields); ask again with the problem named
    for (let r = 1; r <= 2 && directionProblems(d).length; r++) {
      const why = directionProblems(d);
      log(`  direction incomplete (${why.join('; ')}) → ask again ${r}`);
      d = await ask<Direction>(llm, `direct · retry ${r}`, directorSystem(), [...barParts(3), developUser(base, chosen), `YOUR PREVIOUS ANSWER WAS INCOMPLETE: ${why.join('; ')}. Return the complete direction: every field, and 6–10 fully described scenes whose beats add up to the target.`], directionSchema(), 'high');
    }
    if (directionProblems(d).length) throw new Error(`the director returned an incomplete direction: ${directionProblems(d).join('; ')}`);
  }
  const bpm = Math.min(140, Math.max(90, o.bpm ?? d.sound?.bpm ?? 120));
  const targetBeats = Math.round(((seconds * bpm) / 60) * 2) / 2;
  const ids = new Set<string>();
  d.scenes = d.scenes.slice(0, 12).map((s, i) => {
    let id = (s.id || `scene-${i + 1}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 32) || `scene-${i + 1}`;
    while (ids.has(id)) id = `${id.slice(0, 29)}-${i}`;
    ids.add(id);
    return { ...s, id, onscreenText: s.onscreenText ?? [] };
  });
  const fitted = fitScenes(d.scenes.map(s => s.beats), targetBeats);
  d.scenes.forEach((s, i) => (s.beats = fitted[i]));
  writeFileSync(f('direction.json'), JSON.stringify(d, null, 2));
  log(`  "${d.title}" — ${d.concept}`);
  log(`  ${d.scenes.length} scenes · ${bpm} BPM · ${d.look.display}${d.look.serif ? ` + ${d.look.serif}` : ''} · ${d.vibe.join(', ')}`);
  const exact = !!o.reference?.exact;
  const ev = newEvidence(exact ? 'exact' : o.reference ? 'adapt' : 'invent', { code: codeLLM.model, critic: criticLLM.model, direction: o.direction ? undefined : llm.model }, target);
  ev.title = d.title;
  const lessonMode = exact ? 'exact' : 'invent';
  /** The lessons one role should see for this task (empty without a store). */
  const L = (role: Role, task: string) => o.lessons?.block(role, { mode: lessonMode, text: task }) ?? '';
  const sceneTask = (i: number) => `${d.scenes[i].title} ${d.scenes[i].idea} ${d.scenes[i].setpiece ?? ''}`;
  const refNote = (o.reference ? `\n\nREFERENCE FILM BREAKDOWN (match its craft, pacing and style)\n${o.reference.note}` : '') + feedbackNote
    + (exact ? `\n\nEXACT COPY MODE: the reference is the specification. Reproduce it faithfully: the same layout, element sizes (even small ones), colours, words, timing and motion, including its still moments and white space. Where the craft handbook's style rules (hero type sizes, constant motion, filling the frame) disagree with the reference, the reference wins. Critics: score each dimension by how faithfully the render reproduces the reference segment; any difference from the reference is a flaw, even one that looks "better".` : '');

  const corpus = factCorpus(o.kit, o.brief);
  const allowed = [String(bpm), String(new Date().getFullYear())];
  const brandIn = {
    ...o.kit.brand,
    fonts: {
      ...o.kit.brand.fonts,
      display: (DISPLAY_NAMES as readonly string[]).includes(d.look.display) ? d.look.display : o.kit.brand.fonts.display,
      ...((SERIF_NAMES as readonly string[]).includes(d.look.serif ?? '') ? { serif: d.look.serif } : {}),
    },
  } as PlanInput['brand'];
  let lib = '', score = '';
  const scenes: SceneCode[] = d.scenes.map(() => ({ draw: '', sfx: '', hits: [] }));
  const meta = { title: d.title.slice(0, 80) || 'Film', hud: false, captions: false, grain: Math.min(0.2, Math.max(0, Number(d.look.grain) || 0.05)) };
  const hitsOf = (c: SceneCode, beats: number) => c.hits.filter(h => Number.isFinite(h?.beat) && h.beat >= 0 && h.beat <= beats).slice(0, 32).map(h => ({ beat: h.beat, shake: Math.min(40, Math.max(0, Number(h.shake) || 0)) }));
  const scenePlan = (i: number, c: SceneCode, withScore = false): PlanInput => ({
    meta, brand: brandIn, music: { bpm },
    custom: { lib: lib || undefined, score: withScore ? score || undefined : undefined, scenes: [{ id: d.scenes[i].id, title: d.scenes[i].title.slice(0, 60), draw: c.draw, sfx: c.sfx || undefined, hits: hitsOf(c, d.scenes[i].beats) }] },
    sections: [{ technique: `scene:${d.scenes[i].id}`, beats: d.scenes[i].beats }],
  });
  const filmPlan = (): PlanInput => ({
    meta, brand: brandIn, music: { bpm },
    custom: {
      lib: lib || undefined, score: score || undefined,
      scenes: d.scenes.map((s, i) => ({ id: s.id, title: s.title.slice(0, 60), draw: scenes[i].draw, sfx: scenes[i].sfx || undefined, hits: hitsOf(scenes[i], s.beats) })),
    },
    sections: d.scenes.map((s, i) => ({ technique: `scene:${s.id}`, beats: s.beats, ...(i < d.scenes.length - 1 && s.transition !== 'cut' ? { transition: s.transition as never } : {}) })),
  });

  /** Review the run and store what it teaches (never fails the run). */
  const review = async (failure?: string) => {
    const evidence = failure ? { ...ev, notes: [...(ev.notes ?? []), `the run failed: ${failure}`] } : ev;
    writeFileSync(f('evidence.json'), JSON.stringify(evidence, null, 2));
    if (!o.lessons || o.noLearn) return;
    const m = o.learnLLM ?? criticLLM;
    try {
      const r = await learn(m, o.lessons, evidence, dir);
      usage.push(r.usage);
      audit.push({ step: 'learn', model: m.model, at: new Date().toISOString(), reply: r.reply });
      writeFileSync(f('transcript.json'), JSON.stringify(audit, null, 2));
      log(`  learned: ${r.added.length} new lesson(s)${r.added.length ? ` (${r.added.join(', ')})` : ''}, ${r.reinforced.length} reinforced, ${r.repeated.length} repeated despite being shown → ${o.lessons.file}`);
    } catch (e) {
      log(`  could not review the run for lessons: ${String((e as Error).message ?? e).slice(0, 200)}`);
    }
  };

  const browser = await launch();
  try {
    const res = await body();
    await review();
    return res;
  } catch (e) {
    // keep everything made so far (direction, code, scores) so a run can be resumed or inspected
    writeFileSync(f('partial.json'), JSON.stringify({ error: String((e as Error).message ?? e), direction: d, lib, score, scenes, usage: summarizeUsage(usage) }, null, 2));
    log(`  saved partial results to ${f('partial.json')}`);
    await review(String((e as Error).message ?? e).slice(0, 400));
    throw e;
  } finally {
    await browser.close();
  }

  async function body() {
    // ── automated test of a (mini) plan: syntax, exceptions, blank/slow frames, audio, facts ──
    const run = async (input: PlanInput, codeForFacts: string[]): Promise<{ plan?: Plan; problems: string[] }> => {
      const problems: string[] = [];
      const v = validatePlan(input);
      if (!v.ok) return { problems: v.errors.map(e => `${e.path}: ${e.message}`) };
      for (const c of codeForFacts) for (const n of unverifiedNumbers(c, corpus, allowed)) problems.push(`${n}, which is not in the brief or the brand facts; show only the on-screen text from the direction`);
      const reel = await openReel(v.plan, browser);
      try {
        const res = await reel.page.evaluate(async secs => {
          const R = window.__reel!;
          const probes = secs.map(s => [0.02, 0.2, 0.4, 0.6, 0.8, 0.98].map(fr => ({ t: (s.end - s.start) * fr, ...R.probe!(s.start + (s.end - s.start) * fr) })));
          let audio = '';
          try { await R.wav!(); } catch (e) { audio = String(e); }
          return { probes, errors: R.errors ?? [], audio };
        }, reel.sections.map(s => ({ start: s.start, end: s.end })));
        for (const e of res.errors) {
          const at = e.where.match(/draw@([-\d.]+)s/)?.[1];
          const part = e.where === 'custom.lib' ? 'lib' : e.where === 'custom.score' ? 'score' : e.where.includes(':sound') ? `${e.where.split('#')[0]} sfx` : `${e.where.split('#')[0]} draw`;
          problems.push(`${part} threw ${at ? `at t=${at}s ` : ''}"${e.message}"${e.stack ? ` (${e.stack.split('\n').filter(l => /scene-|custom-/.test(l)).slice(0, 2).map(l => l.trim()).join(' / ')})` : ''}`);
        }
        const uses3d = /S\.three\b|\b(logo3d|type3d|shapes3d)\b/.test(JSON.stringify(input.custom ?? ''));
        res.probes.forEach((ps, k) => {
          // software WebGL is slower; 3D scenes get a larger frame budget
          const slow = ps.filter(p => p.ms > (uses3d ? 250 : 80));
          if (slow.length) problems.push(`${reel.sections[k].technique}: too slow, ${Math.round(Math.max(...slow.map(p => p.ms)))} ms per frame at t=${slow.map(p => p.t.toFixed(2)).join(', ')}s (budget 40 ms)`);
          if (ps.every(p => p.std < 0.012)) problems.push(`${reel.sections[k].technique}: every sampled frame is a flat colour; nothing visible is drawn`);
        });
        if (res.audio) problems.push(`the soundtrack failed to render: ${res.audio}`);
        return { plan: v.plan, problems };
      } finally {
        await reel.page.context().close();
      }
    };

    // ── 2. lib + score, tested on a probe scene ────────────────────────────
    const probe: SceneCode = { draw: 'g.fillStyle = S.colors.bg; g.fillRect(0, 0, S.W, S.H); g.fillStyle = S.colors.text; g.fillRect(900, 500, 120, 80);', sfx: '', hits: [] };
    if (o.resume) {
      const c = o.resume.plan.custom;
      lib = c?.lib ?? '';
      score = c?.score ?? '';
      d.scenes.forEach((s, i) => {
        const code = c?.scenes.find(x => x.id === s.id);
        if (code) scenes[i] = { draw: code.draw, sfx: code.sfx ?? '', hits: code.hits };
      });
      log(`2/6 refining ${o.resume.only.join(', ')}; keeping everything else`);
    } else if (o.partial?.lib) {
      // a run that stopped: its tested lib, score and finished scenes are kept
      lib = o.partial.lib;
      score = o.partial.score;
      o.partial.scenes.forEach((c, i) => { if (i < scenes.length && c?.draw?.trim()) scenes[i] = cleanScene(c); });
      log(`2/6 continuing a stopped run: keeping its lib, score and ${scenes.filter(c => c.draw.trim()).length} finished scene(s)`);
    } else {
      log('2/6 code: shared lib + score');
      ({ lib, score } = await ask<{ lib: string; score: string }>(codeLLM, 'code lib', coder(), [libUser(d, o.kit) + refNote + L('coder', `${d.concept} shared lib score sound ${JSON.stringify(d.look)}`)], libSchema(), 'high'));
    }
    for (let r = 1; r <= (o.resume || o.partial?.lib ? 0 : fixRounds); r++) {
      const res = await run(scenePlan(0, probe, true), []);
      const libProblems = res.problems.filter(p => /^custom\.(lib|score)|^lib |^score |soundtrack/.test(p));
      if (!libProblems.length) {
        ev.lib.tests.forEach(t => (t.resolved = true));
        break;
      }
      ev.lib.tests.push({ tag: `fix ${r}`, problems: libProblems.slice(0, 4).map(p => p.slice(0, 240)), resolved: false });
      log(`  lib/score: ${libProblems.length} problem(s) → fix ${r}`);
      ({ lib, score } = await ask<{ lib: string; score: string }>(codeLLM, `fix lib · ${r}`, coder(), [fixUser('the shared lib and the score', { lib, score }, libProblems)], libSchema(), 'medium'));
    }

    // ── per-scene: write → test/fix → watch → score, best of N, then rewrite rounds ──
    const lastProblems: Record<string, string[]> = {};
    const testFix = async (i: number, c: SceneCode, tag: string): Promise<SceneCode | null> => {
      const se = sceneEvidence(ev, d.scenes[i].id, d.scenes[i].idea);
      let failing: { tag: string; problems: string[]; resolved: boolean } | undefined;
      for (let r = 0; r <= fixRounds; r++) {
        const res = await run(scenePlan(i, c), [c.draw]);
        if (!res.problems.length) {
          if (failing) failing.resolved = true;
          return c;
        }
        if (!failing) se.tests.push((failing = { tag, problems: [], resolved: false }));
        failing.problems = [...new Set([...failing.problems, ...res.problems.map(p => p.slice(0, 240))])].slice(0, 6);
        if (r === fixRounds) {
          lastProblems[d.scenes[i].id] = res.problems;
          log(`    ${d.scenes[i].id} ${tag}: still ${res.problems.length} problem(s), discarded: ${res.problems.slice(0, 2).join(' | ').slice(0, 240)}`);
          return null;
        }
        const fixed = await ask<SceneCode>(codeLLM, `fix scene ${d.scenes[i].id} ${tag} · ${r + 1}`, coder(), [
          `SCENE "${d.scenes[i].id}": ${d.scenes[i].idea}\nOn-screen text: ${JSON.stringify(d.scenes[i].onscreenText)}\nLength: ${d.scenes[i].beats} beats at ${bpm} BPM.\n\nSHARED LIB (S.lib)\n\`\`\`js\n${lib}\n\`\`\``,
          fixUser(`scene "${d.scenes[i].id}"`, { draw: c.draw, sfx: c.sfx, hits: JSON.stringify(c.hits) }, res.problems) + L('coder', `code error exception crash guard ${res.problems.join(' ')}`),
        ], sceneSchema(), 'medium');
        c = cleanScene(fixed, c);
      }
      return null;
    };
    /** Render a scene's clip (what the critic watches) and measure coverage and motion on the same frames. */
    const clipOf = async (i: number, input: PlanInput): Promise<{ clip: Buffer; m: MotionReport; beat: ReturnType<typeof beatReport>; detail?: Detail }> => {
      const v = validatePlan(input);
      if (!v.ok) throw new Error('clip of an invalid plan');
      const reel = await openReel(v.plan, browser);
      try {
        const clip = (await renderClips(reel, [{ from: 0, to: reel.duration }], { width: 640, fps: 24 }))[0];
        const samples = await reel.page.evaluate(([a, b]) => window.__reel!.metrics!(a, b, 1 / 12), [0, reel.duration] as const);
        const perFrame = await reel.page.evaluate(([a, b]) => window.__reel!.metrics!(a, b, 1 / 60), [0, reel.duration] as const);
        const last = i === d.scenes.length - 1;
        const hold = last ? reel.duration - 1.5 : Infinity;
        const m = motionReport(samples, hold);
        const br = beatReport(perFrame, 60 / bpm, hold);
        // exact copy: measure the render against the reference on matched frames
        let detail: Detail | undefined;
        const src = o.reference?.source, win = src?.windows[i];
        if (exact && src && win) {
          try {
            detail = await inspectScene({
              refFile: src.file, from: win.from, to: win.to, clip,
              stillAt: async t => dataUrlToBuffer(await reel.page.evaluate(x => window.__reel!.still!(x, 1), Math.min(t, reel.duration - 1e-3))),
            });
          } catch (e) {
            log(`    ${d.scenes[i].id}: detail inspection failed (${String((e as Error).message ?? e).slice(0, 120)})`);
          }
        }
        return { clip, m: { ...m, flags: [...m.flags, ...br.flags] }, beat: br, detail };
      } finally {
        await reel.page.context().close();
      }
    };
    /** Replicate mode: the reference segment this scene must match, shown to the coder. */
    const stillsCache = new Map<number, Promise<{ t: number; jpg: Buffer }[]>>();
    const refTarget = async (i: number): Promise<Part[]> => {
      const clip = o.reference?.clips?.[i];
      if (!clip) return [];
      const parts: Part[] = [text(o.reference?.exact
        ? 'THE TARGET: the reference segment this scene must reproduce EXACTLY (same composition, sizes, positions, colours, words, timing and motion). Match it frame for frame:'
        : 'THE REFERENCE SEGMENT this scene is modelled on (match its craft, composition and motion):'), video(clip, 12)];
      // exact copy: sharp stills too, where small things (gaps, radii, glow edges, text size) are readable
      const src = o.reference?.source, win = src?.windows[i];
      if (exact && src && win) {
        if (!stillsCache.has(i)) stillsCache.set(i, referenceStills(src.file, win.from, win.to).catch(() => []));
        const stills = await stillsCache.get(i)!;
        if (stills.length) parts.push(text('SHARP STILLS OF THE TARGET (match every small detail: gaps between elements, corner radii, glow size and softness, shadows, text size, weight and spacing):'), ...stills.flatMap(s => [text(`t=${s.t.toFixed(2)} s from the scene start`), image(s.jpg, 'image/jpeg')]));
      }
      return parts;
    };
    /** Exact copy: a pixel-level review of the measured, matched frames; its findings lead the fixes. */
    const detailReview = async (i: number, detail: Detail, tag: string): Promise<string[]> => {
      if (!detail.report && !detail.images.length) return [];
      try {
        const r = await ask<{ differences?: { element: string; reference: string; copy: string; fix: string; severity?: string }[] }>(criticLLM, `detail ${d.scenes[i].id} ${tag}`, detailCriticSystem(), [
          `SCENE "${d.scenes[i].id}": ${d.scenes[i].title}\n${detail.report}`,
          ...detail.images.flatMap(im => [text(im.label), image(im.jpg, 'image/jpeg')]),
          L('critic', `${sceneTask(i)} detail spacing glow size bounce`) || 'List the differences.',
        ], detailSchema(), 'medium');
        const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
        return (r.differences ?? [])
          .sort((a, b) => (rank[a.severity ?? 'medium'] ?? 1) - (rank[b.severity ?? 'medium'] ?? 1))
          .slice(0, 8)
          .map(x => `(detail) ${x.element}: reference ${x.reference}; yours ${x.copy} → ${x.fix}`);
      } catch (e) {
        log(`    ${d.scenes[i].id}: detail review failed (${String((e as Error).message ?? e).slice(0, 120)})`);
        return [];
      }
    };
    const measured = (m: MotionReport, b?: ReturnType<typeof beatReport>) =>
      `MEASURED ON THE RENDER (objective): average frame coverage ${Math.round(m.coverage * 100)}%, empty frames ${Math.round(m.emptyShare * 100)}%, mean motion ${(m.motion * 1000).toFixed(1)}‰ per 1/12 s${b ? `, beat precision ${Math.round(b.sync * 100)}% of ${b.hardChanges} hard changes on the 16th grid` : ''}${m.flags.length ? `\nProblems: ${m.flags.join(' ')}` : ' (no measured problems)'}`;
    const critique = async (i: number, cm: { clip: Buffer; m: MotionReport; beat?: ReturnType<typeof beatReport>; detail?: Detail }, tag: string) => {
      const refClip = o.reference?.clips?.[i];
      const [c, details] = await Promise.all([
        ask<SceneCritique>(criticLLM, `critique ${d.scenes[i].id} ${tag}`, sceneCriticSystem(), [
          ...barParts(3),
          sceneCriticUser(d, i) + refNote + L('critic', sceneTask(i)),
          ...(refClip ? [text('REFERENCE SEGMENT (the target to match):'), video(refClip, 12)] : []),
          text('RENDERED SCENE:'), video(cm.clip, 12),
          text(measured(cm.m, cm.beat) + (cm.detail?.report ? `\n\n${cm.detail.report}` : '')),
        ], sceneCriticSchema(), 'medium'),
        cm.detail ? detailReview(i, cm.detail, tag) : Promise.resolve([] as string[]),
      ]);
      // measured problems always reach the rewrite, even if the critic did not list them (not for an exact copy: the reference decides);
      // in an exact copy the measured detail differences come first
      c.fixes = [...details, ...(Array.isArray(c.fixes) ? c.fixes : []), ...(exact ? [] : cm.m.flags.map(f => `(measured) ${f}`))];
      const s = critiqueScore(c);
      sceneEvidence(ev, d.scenes[i].id, d.scenes[i].idea).versions.push({ step: tag, score: s, scores: c.scores, observed: String(c.observed ?? '').slice(0, 600), fixes: c.fixes.slice(0, 6).map(x => String(x).slice(0, 300)) });
      return { c, s, clip: cm.clip, detail: cm.detail };
    };

    /**
     * Head-to-head: is `next` better than `cur`? Judged twice with the order
     * swapped (position bias is 10–15 points in frontier judges); only a win
     * in both orders counts. Returns 'next', 'cur' or 'tie'.
     */
    const pairwise = async (i: number, curClip: Buffer, nextClip: Buffer, tag: string): Promise<'next' | 'cur' | 'tie'> => {
      const ask1 = (a: Buffer, b: Buffer, k: string) =>
        ask<{ winner: 'A' | 'B' | 'tie'; reason: string }>(criticLLM, `pair ${d.scenes[i].id} ${tag} ${k}`, pairSystem(), [
          `SCENE "${d.scenes[i].id}": ${d.scenes[i].idea}${feedbackNote}`,
          ...(exact && o.reference?.clips?.[i] ? [text('THE REFERENCE (the target):'), video(o.reference.clips[i], 12)] : []),
          text('VERSION A:'), video(a, 12), text('VERSION B:'), video(b, 12), exact ? 'Which version is closer to the reference?' : 'Which is better?',
        ], pairSchema(), 'low');
      const [x, y] = await Promise.all([ask1(curClip, nextClip, 'ab'), ask1(nextClip, curClip, 'ba')]);
      const nextWins = (x.winner === 'B' ? 1 : 0) + (y.winner === 'A' ? 1 : 0);
      const curWins = (x.winner === 'A' ? 1 : 0) + (y.winner === 'B' ? 1 : 0);
      return nextWins === 2 ? 'next' : curWins === 2 ? 'cur' : nextWins > curWins ? 'next' : curWins > nextWins ? 'cur' : 'tie';
    };
    /** Accept `next` over `cur`: a head-to-head win, or a tie with a clearly higher rubric score. */
    const better = async (i: number, cur: { score: number; clip: Buffer }, next: { score: number; clip: Buffer }, tag: string) => {
      const v = await pairwise(i, cur.clip, next.clip, tag);
      return v === 'next' || (v === 'tie' && next.score >= cur.score + 0.5);
    };

    const history: Record<string, { step: string; score: number }[]> = {};
    const best: { code: SceneCode; score: number; critique: SceneCritique; clip: Buffer; detail?: Detail }[] = new Array(d.scenes.length);
    /** Exact copy: the measured comparison of the current version, shown to the coder with the review. */
    const detailParts = (dt?: Detail): Part[] => (dt && (dt.report || dt.images.length)
      ? [text(`DETAIL COMPARISON OF YOUR CURRENT VERSION WITH THE REFERENCE (fix every difference you see here, however small)\n${dt.report}`), ...dt.images.flatMap(im => [text(im.label), image(im.jpg, 'image/jpeg')])]
      : []);
    const fromCurrent = !!o.resume && !o.resume.fresh;
    log(`3/6 scenes: ${fromCurrent ? 'the current version' : `${o.candidates ?? 2} candidates`} each, then up to ${o.rounds ?? 2} watch → rewrite rounds`);
    const todo = o.resume ? d.scenes.filter(s => o.resume!.only.includes(s.id)) : o.partial ? d.scenes.filter((_, i) => !scenes[i].draw.trim()) : d.scenes;
    await pool(todo, conc, async s => {
      const i = d.scenes.indexOf(s);
      history[s.id] = [];
      const cands = fromCurrent
        ? [await (async () => {
            const cr = await critique(i, await clipOf(i, scenePlan(i, scenes[i])), 'current');
            history[s.id].push({ step: 'current', score: cr.s });
            return { code: scenes[i], score: cr.s, critique: cr.c, clip: cr.clip, detail: cr.detail };
          })()]
        : await Promise.all(Array.from({ length: o.candidates ?? 2 }, (_, k) => attempt(`${s.id} candidate ${k + 1}`, async () => {
        const r = await ask<SceneCode>(codeLLM, `code ${s.id} #${k + 1}`, coder(), [sceneUser(d, lib, i, bpm) + refNote + L('coder', sceneTask(i)) + (k ?`\n\n(Candidate ${k + 1}: take a clearly different creative approach to the same brief.)` : ''), ...(await refTarget(i))], sceneSchema(), 'high');
        const ok = await testFix(i, cleanScene(r), `#${k + 1}`);
        if (!ok) return null;
        const cr = await critique(i, await clipOf(i, scenePlan(i, ok)), `#${k + 1}`);
        history[s.id].push({ step: `candidate ${k + 1}`, score: cr.s });
        return { code: ok, score: cr.s, critique: cr.c, clip: cr.clip, detail: cr.detail };
      })));
      let good = cands.filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.score - a.score);
      // every candidate failed its tests: write fresh ones (a different, simpler approach) before giving up on the film
      for (let k = 1; k <= 2 && !good.length; k++) {
        log(`  ${s.id}: no working version yet → fresh attempt ${k}`);
        const got = await attempt(`${s.id} fresh attempt ${k}`, async () => {
          const r = await ask<SceneCode>(codeLLM, `code ${s.id} retry ${k}`, coder(), [sceneUser(d, lib, i, bpm) + refNote + L('coder', `${sceneTask(i)} code error guard`) + `\n\n(Earlier versions of this scene kept failing the engine's tests: ${(lastProblems[s.id] ?? []).slice(0, 4).join(' | ') || 'errors'}. Write it again from scratch, robustly: guard every value that can go negative or undefined, clamp times, keep it within the frame budget.)`, ...(await refTarget(i))], sceneSchema(), 'high');
          const ok = await testFix(i, cleanScene(r), `retry${k}`);
          if (!ok) return null;
          const cr = await critique(i, await clipOf(i, scenePlan(i, ok)), `retry${k}`);
          history[s.id].push({ step: `retry ${k}`, score: cr.s });
          return { code: ok, score: cr.s, critique: cr.c, clip: cr.clip, detail: cr.detail };
        });
        if (got) good = [got];
      }
      if (!good.length) throw new Error(`no working version of scene "${s.id}": ${(lastProblems[s.id] ?? []).slice(0, 3).join(' | ')}`);
      let cur = good[0];
      // the rubric score only orders the field; the head-to-head decides between the top two
      if (good.length > 1 && (await attempt(`${s.id} head-to-head`, () => better(i, cur, good[1], 'cands')))) cur = good[1];
      log(`  ${s.id}: candidates ${good.map(g => g.score).join(' / ')} → kept ${cur.score}`);
      for (const v of sceneEvidence(ev, s.id, s.idea).versions) if (v.kept === undefined) v.kept = v.score === cur.score;
      for (let r = 1; r <= (o.rounds ?? 2) && cur.score < target && !overBudget(); r++) {
        const done = await attempt(`${s.id} rewrite ${r}`, async () => {
          const rw = await ask<SceneCode>(codeLLM, `rewrite ${s.id} · ${r}`, coder(), [
            rewriteUser(d, lib, i, bpm, cur.code, cur.critique, cur.score) + refNote + L('coder', `${sceneTask(i)} ${cur.critique.fixes.join(' ')}`),
            ...(await refTarget(i)),
            text('THE CLIP THE REVIEW IS ABOUT (your current version):'), video(cur.clip, 12),
            ...detailParts(cur.detail),
          ], sceneSchema(), 'high');
          const ok = await testFix(i, cleanScene(rw, cur.code), `r${r}`);
          if (!ok) return null;
          return { ok, cr: await critique(i, await clipOf(i, scenePlan(i, ok)), `r${r}`) };
        });
        if (!done) continue;
        const { ok, cr } = done;
        history[s.id].push({ step: `rewrite ${r}`, score: cr.s });
        const win = (await attempt(`${s.id} head-to-head`, () => better(i, cur, { score: cr.s, clip: cr.clip }, `r${r}`))) ?? false;
        log(`  ${s.id}: rewrite ${r} → ${cr.s}${win ? ' (wins head-to-head, kept)' : ` (does not beat ${cur.score} head-to-head, discarded)`}`);
        const rv = sceneEvidence(ev, s.id, s.idea).versions.at(-1);
        if (rv) rv.kept = win;
        if (win) cur = { code: ok, score: cr.s, critique: cr.c, clip: cr.clip, detail: cr.detail };
      }
      best[i] = cur;
      scenes[i] = cur.code;
    });
    writeFileSync(f('scores.json'), JSON.stringify(history, null, 2));

    // ── 4. the whole film: test, then review with sound, then fix the weakest scenes ──
    log('4/6 whole film: test');
    const whole = async () => {
      for (let r = 0; r <= fixRounds; r++) {
        const res = await run(filmPlan(), []);
        // speed is enforced per scene; in the whole film a transition frame draws two scenes at once
        res.problems = res.problems.filter(p => !p.includes('too slow'));
        if (!res.problems.length && res.plan) return res.plan;
        log(`  film: ${res.problems.length} problem(s): ${res.problems.slice(0, 2).join(' | ').slice(0, 200)}`);
        if (r === fixRounds) break;
        const libP = res.problems.filter(p => /lib|score|soundtrack/.test(p));
        if (libP.length) ({ lib, score } = await ask<{ lib: string; score: string }>(codeLLM, `fix lib (film) · ${r + 1}`, coder(), [fixUser('the shared lib and the score', { lib, score }, libP)], libSchema(), 'medium'));
        for (const [i, s] of d.scenes.entries()) {
          const mine = res.problems.filter(p => p.includes(`scene:${s.id}`));
          if (mine.length) scenes[i] = (await testFix(i, scenes[i], 'film')) ?? scenes[i];
        }
      }
      const v = validatePlan(filmPlan());
      if (!v.ok) throw new Error('the film does not validate');
      return v.plan;
    };
    let plan = await whole();
    const films: FilmCritique[] = [];
    for (let r = 1; r <= (o.filmRounds ?? 1) && !overBudget(); r++) {
      log(`5/6 film review ${r} (video with sound)`);
      const reel = await openReel(plan, browser);
      const [filmClip] = await renderClips(reel, [{ from: 0, to: reel.duration }], { width: 640, fps: 24, audio: true });
      await reel.page.context().close();
      writeFileSync(f(`review-${r}.mp4`), filmClip);
      const fc = await ask<FilmCritique>(criticLLM, `film review ${r}`, filmCriticSystem(), [
        ...barParts(3),
        `DIRECTION\n${JSON.stringify(d, null, 1)}${refNote}${L('critic', `${d.concept} film rhythm sound`)}`,
        text('THE FILM:'), video(filmClip, 8), 'Review it.',
      ], filmCriticSchema(), 'medium');
      films.push(fc);
      ev.film.push({ score: fc.score, summary: String(fc.summary ?? '').slice(0, 600), scenes: (fc.scenes ?? []).map(x => ({ id: x.id, score: x.score, fix: String(x.fix ?? '').slice(0, 300) })) });
      writeFileSync(f(`review-${r}.json`), JSON.stringify(fc, null, 2));
      log(`  ${fc.score}/10 · ${fc.summary}`);
      const weak = (fc.scenes ?? []).filter(x => x.score < 8).sort((a, b) => a.score - b.score).slice(0, 3);
      for (const w of fc.scenes ?? []) log(`    ${w.id}: ${w.score}/10${w.score < 9 ? ` — ${w.fix.slice(0, 120)}` : ''}`);
      if (!weak.length) break;
      await pool(weak, conc, async w => {
        const i = d.scenes.findIndex(s => s.id === w.id);
        if (i < 0 || !best[i]) return;
        const cur = best[i];
        const crit: SceneCritique = { ...cur.critique, fixes: [`(from the whole-film review) ${w.fix}`, ...cur.critique.fixes].slice(0, 4) };
        const rw = await ask<SceneCode>(codeLLM, `film fix ${w.id} · ${r}`, coder(), [
          rewriteUser(d, lib, i, bpm, cur.code, crit, cur.score) + refNote + L('coder', `${sceneTask(i)} ${w.fix}`),
          text('THE CLIP THE REVIEW IS ABOUT:'), video(cur.clip, 12),
          ...detailParts(cur.detail),
        ], sceneSchema(), 'high');
        const ok = await testFix(i, cleanScene(rw, cur.code), `film${r}`);
        if (!ok) return;
        const cr = await critique(i, await clipOf(i, scenePlan(i, ok)), `film${r}`);
        history[w.id].push({ step: `film fix ${r}`, score: cr.s });
        const win = await better(i, cur, { score: cr.s, clip: cr.clip }, `film${r}`);
        log(`  ${w.id}: film fix → ${cr.s}${win ? ' (wins head-to-head, kept)' : ' (does not win head-to-head, discarded)'}`);
        const fv = sceneEvidence(ev, w.id, d.scenes[i].idea).versions.at(-1);
        if (fv) fv.kept = win;
        if (win) { best[i] = { code: ok, score: cr.s, critique: cr.c, clip: cr.clip, detail: cr.detail }; scenes[i] = ok; }
      });
      plan = await whole();
    }
    writeFileSync(f('scores.json'), JSON.stringify(history, null, 2));
    writeFileSync(f('plan.json'), JSON.stringify(plan, null, 2));

    // ── 6. outputs ──────────────────────────────────────────────────────────
    log('6/6 outputs');
    writeFileSync(f('reel.html'), buildHtml(plan));
    const reel = await openReel(plan, browser);
    const sheet = await reel.page.evaluate(([ts]) => window.__reel!.sheet!(ts, 3), [autoTimes(reel)] as const);
    writeFileSync(f('sheet.png'), dataUrlToBuffer(sheet));
    await reel.page.context().close();
    let videoFile: string | undefined;
    if (o.render !== false) {
      videoFile = f('video.mp4');
      const v = await renderVideo(plan, videoFile, { crf: 18, workers: o.workers ?? 3, blur: 6, log: s => process.stderr.write(`\r  ${s}   `) });
      process.stderr.write('\n');
      log(`  rendered ${v.frames} frames in ${v.seconds.toFixed(0)} s`);
    }
    const report = {
      mode: o.reference ? 'replicate' : 'invent', models: { direction: llm.model, code: codeLLM.model, critic: criticLLM.model }, brief: o.brief,
      title: d.title, concept: d.concept, vibe: d.vibe, influences: d.influences, bpm,
      seconds: plan.sections.reduce((a, s) => a + s.beats, 0) * (60 / bpm), scenes: d.scenes.map((s, i) => ({ id: s.id, beats: s.beats, score: best[i]?.score, history: history[s.id] })),
      filmReviews: films.map(r => ({ score: r.score, summary: r.summary })), usage: summarizeUsage(usage), wallSeconds: Math.round((Date.now() - t0) / 1000),
    };
    writeFileSync(f('report.json'), JSON.stringify(report, null, 2));
    return { plan, direction: d, films, usage, video: videoFile, scores: best.map(b => b?.score) };
  }
}

export type { Browser };
