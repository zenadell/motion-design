import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { dataUrlToBuffer, launch, openReel } from '../cli/browser';
import { buildHtml } from '../cli/html';
import { autoTimes, renderVideo } from '../cli/render';
import { DISPLAY_NAMES, SERIF_NAMES } from '../plan/fonts';
import type { Plan, PlanInput } from '../plan/schema';
import { validatePlan } from '../plan/validate';
import { factCorpus, type BrandKit } from './brand-kit';
import { image, parseJson, summarizeUsage, text, user, type Effort, type LLM, type Part, type Usage } from './llm';
import {
  coderSystem, directionSchema, directorSystem, directorUser, fixUser, libSchema, libUser, reviewSchema, reviewSystem, sceneSchema, sceneUser,
  type Direction, type Review,
} from './invent-prompts';

// Invent mode: the model designs a new visual language and writes all of the
// drawing and sound code. The pipeline only runs what it writes and reports
// back what broke (errors, blank or slow frames, unverified numbers), then
// shows it the rendered frames for its own design review.

export interface InventOptions {
  kit: BrandKit;
  brief: string;
  seconds?: number;
  bpm?: number;
  /** Design review → rewrite rounds. */
  qaRounds?: number;
  /** Automated test → fix rounds per step. */
  fixRounds?: number;
  render?: boolean;
  workers?: number;
  concurrency?: number;
  outDir: string;
  log?: (s: string) => void;
}

interface SceneCode {
  draw: string;
  sfx: string;
  hits: { beat: number; shake: number }[];
}

interface Audit {
  step: string;
  at: string;
  reply: string;
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
    const lit = m[2];
    if (!/[a-z]/i.test(lit) && !/[%+]/.test(lit)) continue;
    if (/px|rgba?\(|hsla?\(|#[0-9a-f]{3,8}\b|deg|blur\(|\bms\b|^\s*\d+\s*$/i.test(lit)) continue;
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

export async function invent(llm: LLM, o: InventOptions) {
  const log = o.log ?? (() => {});
  const dir = o.outDir;
  mkdirSync(dir, { recursive: true });
  const f = (n: string) => join(dir, n);
  const usage: Usage[] = [];
  const audit: Audit[] = [];
  const t0 = Date.now();
  const fixRounds = o.fixRounds ?? 3;
  const conc = o.concurrency ?? 3;

  const ask = async <T>(label: string, system: string, parts: (Part | string)[], schema: object, effort: Effort): Promise<T> => {
    const r = await llm.json({ label, system, turns: [user(...parts)], schema, effort });
    usage.push(r.usage);
    audit.push({ step: label, at: new Date().toISOString(), reply: r.text });
    writeFileSync(f('transcript.json'), JSON.stringify(audit, null, 2));
    return parseJson<T>(r.text);
  };

  // ── 1. direction ──────────────────────────────────────────────────────────
  const bpm0 = o.bpm;
  const seconds = Math.min(60, Math.max(8, o.seconds ?? 24));
  log('1/5 direction');
  const d = await ask<Direction>('direct', directorSystem(), [directorUser(o.brief, o.kit, Math.round((seconds * (bpm0 ?? 120)) / 60), seconds, bpm0)], directionSchema(), 'high');
  const bpm = Math.min(140, Math.max(90, bpm0 ?? d.sound?.bpm ?? 120));
  const target = Math.round(((seconds * bpm) / 60) * 2) / 2;
  const ids = new Set<string>();
  d.scenes = d.scenes.slice(0, 12).map((s, i) => {
    let id = (s.id || `scene-${i + 1}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 32) || `scene-${i + 1}`;
    while (ids.has(id)) id = `${id.slice(0, 29)}-${i}`;
    ids.add(id);
    return { ...s, id, onscreenText: s.onscreenText ?? [] };
  });
  const fitted = fitScenes(d.scenes.map(s => s.beats), target);
  d.scenes.forEach((s, i) => (s.beats = fitted[i]));
  writeFileSync(f('direction.json'), JSON.stringify(d, null, 2));
  log(`  "${d.title}" — ${d.concept}`);
  log(`  ${d.scenes.length} scenes · ${bpm} BPM · ${d.look.display}${d.look.serif ? ` + ${d.look.serif}` : ''} · ${d.vibe.join(', ')}`);

  // ── 2. lib + score ───────────────────────────────────────────────────────
  log('2/5 code: shared lib + score');
  const libOut = await ask<{ lib: string; score: string }>('code lib', coderSystem(), [libUser(d, o.kit)], libSchema(), 'high');
  let lib = libOut.lib ?? '', score = libOut.score ?? '';

  // ── 3. scenes ────────────────────────────────────────────────────────────
  log(`3/5 code: ${d.scenes.length} scenes`);
  const scenes: SceneCode[] = await pool(d.scenes, conc, async (s, i) => {
    const r = await ask<SceneCode>(`code scene ${s.id}`, coderSystem(), [sceneUser(d, lib, i, bpm)], sceneSchema(), 'high');
    log(`  ✓ ${s.id} (${r.draw?.length ?? 0} chars)`);
    return { draw: r.draw ?? '', sfx: r.sfx ?? '', hits: Array.isArray(r.hits) ? r.hits : [] };
  });

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
  const assemble = (): PlanInput => ({
    meta: { title: d.title.slice(0, 80) || 'Film', hud: false, captions: false, grain: Math.min(0.2, Math.max(0, Number(d.look.grain) || 0.05)) },
    brand: brandIn,
    music: { bpm },
    custom: {
      lib: lib || undefined,
      score: score || undefined,
      scenes: d.scenes.map((s, i) => ({
        id: s.id, title: s.title.slice(0, 60), draw: scenes[i].draw, sfx: scenes[i].sfx || undefined,
        hits: scenes[i].hits.filter(h => Number.isFinite(h.beat) && h.beat >= 0 && h.beat <= s.beats).slice(0, 32).map(h => ({ beat: h.beat, shake: Math.min(40, Math.max(0, h.shake)) })),
      })),
    },
    sections: d.scenes.map((s, i) => ({ technique: `scene:${s.id}`, beats: s.beats, ...(i < d.scenes.length - 1 && s.transition !== 'cut' ? { transition: s.transition as never } : {}) })),
  });

  const browser = await launch();
  try {
    // ── 4. test → fix ─────────────────────────────────────────────────────
    const test = async (): Promise<{ plan?: Plan; problems: Map<string, string[]> }> => {
      const problems = new Map<string, string[]>();
      const add = (k: string, p: string) => problems.set(k, [...(problems.get(k) ?? []), p]);
      const v = validatePlan(assemble());
      if (!v.ok) {
        for (const e of v.errors) {
          const m = e.path.match(/^custom\.scenes\[(\d+)\]/);
          add(m ? `scene:${d.scenes[+m[1]].id}` : e.path.startsWith('custom.score') ? 'score' : e.path.startsWith('custom.lib') ? 'lib' : 'plan', `${e.path}: ${e.message}`);
        }
        return { problems };
      }
      const plan = v.plan;
      d.scenes.forEach((s, i) => {
        for (const n of unverifiedNumbers(scenes[i].draw, corpus, allowed)) add(`scene:${s.id}`, `${n}, which is not in the brief or the brand facts; use only the on-screen text from the direction`);
      });
      const reel = await openReel(plan, browser);
      try {
        const res = await reel.page.evaluate(async secs => {
          const R = window.__reel!;
          const probes = secs.map(s => [0.02, 0.2, 0.4, 0.6, 0.8, 0.98].map(fr => ({ t: s.start + (s.end - s.start) * fr, ...R.probe!(s.start + (s.end - s.start) * fr) })));
          let audio = '';
          try { await R.wav!(); } catch (e) { audio = String(e); }
          return { probes, errors: R.errors ?? [], audio };
        }, reel.sections.map(s => ({ start: s.start, end: s.end })));
        for (const e of res.errors) {
          const k = e.where.startsWith('scene:') ? e.where.split('#')[0] : e.where === 'custom.score' ? 'score' : e.where === 'custom.lib' ? 'lib' : 'plan';
          const at = e.where.match(/draw@([-\d.]+)s/)?.[1];
          add(k, `${e.where.includes(':sound') ? 'sfx' : k === 'score' ? 'score' : k === 'lib' ? 'lib' : 'draw'} threw ${at ? `at t=${at}s ` : ''}"${e.message}"${e.stack ? `\n  ${e.stack.split('\n').filter(l => /scene-|custom-/.test(l)).slice(0, 2).join('\n  ')}` : ''}`);
        }
        res.probes.forEach((ps, i) => {
          const k = `scene:${d.scenes[i].id}`;
          const slow = ps.filter(p => p.ms > 80);
          if (slow.length) add(k, `too slow: ${Math.round(Math.max(...slow.map(p => p.ms)))} ms per frame at t=${slow.map(p => (p.t - reel.sections[i].start).toFixed(2)).join(', ')}s (budget 40 ms)`);
          if (ps.every(p => p.std < 0.012)) add(k, 'every sampled frame is a flat colour: nothing visible is drawn (check that shapes are inside the 1920×1080 frame, alpha > 0, and colours differ from the background)');
        });
        if (res.audio) add('score', `the soundtrack failed to render: ${res.audio}`);
        return { plan, problems };
      } finally {
        await reel.page.context().close();
      }
    };

    const fix = async (problems: Map<string, string[]>, round: number) => {
      const jobs: Promise<void>[] = [];
      if (problems.has('lib') || problems.has('score')) {
        const probs = [...(problems.get('lib') ?? []).map(p => `lib: ${p}`), ...(problems.get('score') ?? []).map(p => `score: ${p}`)];
        jobs.push(ask<{ lib: string; score: string }>(`fix lib · ${round}`, coderSystem(), [fixUser('the shared lib and the score', { lib, score }, probs)], libSchema(), 'medium').then(r => {
          lib = r.lib ?? lib; score = r.score ?? score;
        }));
      }
      const sceneKeys = [...problems.keys()].filter(k => k.startsWith('scene:'));
      jobs.push(pool(sceneKeys, conc, async k => {
        const i = d.scenes.findIndex(s => `scene:${s.id}` === k);
        if (i < 0) return;
        const r = await ask<SceneCode>(`fix scene ${d.scenes[i].id} · ${round}`, coderSystem(), [
          `DIRECTION (scene "${d.scenes[i].id}"): ${d.scenes[i].idea}\nOn-screen text: ${JSON.stringify(d.scenes[i].onscreenText)}\nLength: ${d.scenes[i].beats} beats at ${bpm} BPM.\n\nSHARED LIB (S.lib)\n\`\`\`js\n${lib}\n\`\`\``,
          fixUser(`scene "${d.scenes[i].id}"`, { draw: scenes[i].draw, sfx: scenes[i].sfx, hits: JSON.stringify(scenes[i].hits) }, problems.get(k)!),
        ], sceneSchema(), 'medium');
        scenes[i] = { draw: r.draw ?? scenes[i].draw, sfx: r.sfx ?? scenes[i].sfx, hits: Array.isArray(r.hits) ? r.hits : scenes[i].hits };
      }).then(() => {}));
      await Promise.all(jobs);
    };

    const testAndFix = async (stage: string): Promise<{ plan: Plan; open: string[] }> => {
      let last: Awaited<ReturnType<typeof test>> = { problems: new Map() };
      for (let r = 1; r <= fixRounds + 1; r++) {
        last = await test();
        const n = [...last.problems.values()].reduce((a, p) => a + p.length, 0);
        if (!n && last.plan) {
          log(`  ${stage}: all scenes run cleanly`);
          return { plan: last.plan, open: [] };
        }
        log(`  ${stage}: ${n} problem(s) in ${[...last.problems.keys()].join(', ')}`);
        for (const [k, ps] of last.problems) for (const p of ps) log(`    ${k}: ${p.split('\n')[0].slice(0, 150)}`);
        if (r > fixRounds) break;
        await fix(last.problems, r);
      }
      if (!last.plan) throw new Error('the generated code still does not validate after every fix round');
      return { plan: last.plan, open: [...last.problems].flatMap(([k, ps]) => ps.map(p => `${k}: ${p}`)) };
    };

    log('4/5 test → fix');
    let { plan, open } = await testAndFix('test');
    writeFileSync(f('plan.json'), JSON.stringify(plan, null, 2));

    // ── 5. design review → rewrite ───────────────────────────────────────
    const reviews: Review[] = [];
    for (let r = 1; r <= (o.qaRounds ?? 1); r++) {
      log(`5/5 design review${(o.qaRounds ?? 1) > 1 ? ` ${r}` : ''}`);
      const frames = await sceneFrames(plan, browser);
      const rv = await ask<Review>(`review ${r}`, reviewSystem(), [
        `DIRECTION\n${JSON.stringify(d, null, 1)}`,
        ...frames.flatMap(fr => [text(`FRAME t=${fr.t.toFixed(2)}s · scene "${fr.id}"`), image(fr.jpeg, 'image/jpeg')]),
        'Review the draft.',
      ], reviewSchema(), 'medium');
      reviews.push(rv);
      writeFileSync(f(`review-${r}.json`), JSON.stringify(rv, null, 2));
      log(`  ${rv.score}/10 · ${rv.summary}`);
      const redo = (rv.scenes ?? []).filter(s => s.verdict === 'revise' || s.score < 7);
      for (const s of rv.scenes ?? []) log(`    ${s.id}: ${s.score}/10 ${s.verdict}${s.verdict === 'revise' ? ` — ${s.notes.slice(0, 140)}` : ''}`);
      if (!redo.length) break;
      await pool(redo, conc, async note => {
        const i = d.scenes.findIndex(s => s.id === note.id);
        if (i < 0) return;
        const mine = frames.filter(fr => fr.id === note.id);
        const r2 = await ask<SceneCode>(`revise scene ${note.id} · ${r}`, coderSystem(), [
          sceneUser(d, lib, i, bpm),
          `YOUR CURRENT CODE\n--- draw ---\n${scenes[i].draw}\n--- sfx ---\n${scenes[i].sfx}\n\nHow it renders now:`,
          ...mine.flatMap(fr => [text(`t=${fr.t.toFixed(2)}s`), image(fr.jpeg, 'image/jpeg')]),
          `DESIGN REVIEW (${note.score}/10): ${note.notes}\n\nRewrite the scene to address the review. Return the complete draw, sfx and hits.`,
        ], sceneSchema(), 'high');
        scenes[i] = { draw: r2.draw ?? scenes[i].draw, sfx: r2.sfx ?? scenes[i].sfx, hits: Array.isArray(r2.hits) ? r2.hits : scenes[i].hits };
      });
      ({ plan, open } = await testAndFix('retest'));
      writeFileSync(f('plan.json'), JSON.stringify(plan, null, 2));
    }

    // ── outputs ───────────────────────────────────────────────────────────
    writeFileSync(f('reel.html'), buildHtml(plan));
    const reel = await openReel(plan, browser);
    const sheet = await reel.page.evaluate(([ts]) => window.__reel!.sheet!(ts, 3), [autoTimes(reel)] as const);
    writeFileSync(f('sheet.png'), dataUrlToBuffer(sheet));
    await reel.page.context().close();
    let video: string | undefined;
    if (o.render !== false) {
      video = f('video.mp4');
      const v = await renderVideo(plan, video, { crf: 18, workers: o.workers ?? 3, blur: 6, log: s => process.stderr.write(`\r  ${s}   `) });
      process.stderr.write('\n');
      log(`  rendered ${v.frames} frames in ${v.seconds.toFixed(0)} s`);
    }
    const report = {
      mode: 'invent', model: llm.model, brief: o.brief, title: d.title, concept: d.concept, vibe: d.vibe, influences: d.influences,
      seconds: plan.sections.reduce((a, s) => a + s.beats, 0) * (60 / bpm), bpm, scenes: d.scenes.map(s => `${s.id} ${s.beats}`),
      reviews: reviews.map(r => ({ score: r.score, summary: r.summary })), openProblems: open,
      usage: summarizeUsage(usage), wallSeconds: Math.round((Date.now() - t0) / 1000),
    };
    writeFileSync(f('report.json'), JSON.stringify(report, null, 2));
    return { plan, direction: d, reviews, usage, video, open };
  } finally {
    await browser.close();
  }
}

/** Two frames per scene (40% and 80% through), for the design review. */
async function sceneFrames(plan: Plan, browser: Browser) {
  const reel = await openReel(plan, browser);
  try {
    const out: { id: string; t: number; jpeg: Buffer }[] = [];
    for (const s of reel.sections) {
      for (const fr of [0.4, 0.8]) {
        const t = s.start + (s.end - s.start) * fr;
        const url = await reel.page.evaluate(([x]) => window.__reel!.thumb!(x, 768), [t] as const);
        out.push({ id: s.technique.replace(/^scene:/, ''), t, jpeg: dataUrlToBuffer(url) });
      }
    }
    return out;
  } finally {
    await reel.page.context().close();
  }
}
