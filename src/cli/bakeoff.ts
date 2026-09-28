import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBrandKit } from '../ai/brand-kit';
import { invent } from '../ai/invent';
import type { Direction } from '../ai/invent-prompts';
import { summarizeUsage, type LLM } from '../ai/llm';
import { llmFor } from '../ai/models';
import type { Plan } from '../plan/schema';
import { formatIssues, validatePlan } from '../plan/validate';
import { launch, openReel } from './browser';
import { renderClips } from './clip';
import { ffmpegPath } from './render';

// Bake-off: the same scenes of a finished film written from scratch by
// several models, with identical prompts, shared lib and score, and the same
// test → fix loop. Each scene becomes one side-by-side video (the current
// version first) so a person can judge which model writes the best motion.

export interface BakeoffOptions {
  /** A finished invent/refine output dir (plan.json, direction.json, brand.json). */
  src: string;
  scenes: string[];
  models: string[];
  /** Scores every version (the critic that watches clips). */
  critic: LLM;
  feedback?: string;
  /** Watch → rewrite rounds per model (0 = first drafts only). */
  rounds?: number;
  /** Models run in parallel. */
  parallel?: number;
  outDir: string;
  log?: (s: string) => void;
  /** Reuse a model's finished output from an earlier run in the same outDir (default true). */
  reuse?: boolean;
  /** Model factory (tests inject fakes); default: llmFor. */
  llm?: (id: string, log: (s: string) => void) => LLM;
}

export interface Entry {
  model: string;
  dir?: string;
  error?: string;
  scores?: Record<string, number | undefined>;
  codeUsd?: number;
  criticUsd?: number;
  seconds?: number;
}

const slug = (s: string) => s.replace(/[^a-z0-9.-]+/gi, '_');

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', d => (err += d));
    ff.on('error', reject);
    ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-400)}`))));
  });
}

export async function bakeoff(o: BakeoffOptions) {
  const log = o.log ?? (() => {});
  const read = (n: string) => JSON.parse(readFileSync(join(o.src, n), 'utf8'));
  const v = validatePlan(read('plan.json'));
  if (!v.ok) throw new Error(`invalid plan in ${o.src}:\n${formatIssues(v.errors)}`);
  const original = v.plan;
  const direction = read('direction.json') as Direction;
  const unknown = o.scenes.filter(id => !direction.scenes.some(s => s.id === id));
  if (unknown.length) throw new Error(`unknown scene id(s): ${unknown.join(', ')}; scenes: ${direction.scenes.map(s => s.id).join(', ')}`);
  const kit = loadBrandKit(read('brand.json'));
  const bpm = original.music.bpm;
  const seconds = original.sections.reduce((a, s) => a + s.beats, 0) * (60 / bpm);
  mkdirSync(o.outDir, { recursive: true });

  // ── 1. every model writes the scenes ─────────────────────────────────────
  const entries: Entry[] = o.models.map(model => ({ model }));
  const plans = new Map<string, Plan>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(o.parallel ?? 2, entries.length) }, async () => {
    while (next < entries.length) {
      const e = entries[next++];
      const tag = e.model.split('/').pop()!;
      const t0 = Date.now();
      e.dir = join(o.outDir, slug(e.model));
      const done = join(e.dir, 'report.json');
      if ((o.reuse ?? true) && existsSync(done) && existsSync(join(e.dir, 'plan.json'))) {
        const rep = JSON.parse(readFileSync(done, 'utf8')) as { scenes: { id: string; score?: number }[]; usage: { byStep: { model: string; usd?: number }[] }; wallSeconds?: number };
        const pv = validatePlan(JSON.parse(readFileSync(join(e.dir, 'plan.json'), 'utf8')));
        if (pv.ok) {
          plans.set(e.model, pv.plan);
          e.scores = Object.fromEntries(rep.scenes.filter(s => o.scenes.includes(s.id)).map(s => [s.id, s.score]));
          const sum = (f: (m: string) => boolean) => rep.usage.byStep.filter(x => f(x.model)).reduce((a, x) => a + (x.usd ?? 0), 0);
          e.codeUsd = sum(m => m === e.model);
          e.criticUsd = sum(m => m !== e.model);
          e.seconds = rep.wallSeconds;
          log(`[${tag}] reusing the finished run in ${e.dir}`);
          continue;
        }
      }
      try {
        const coder = (o.llm ?? llmFor)(e.model, s => log(`[${tag}] ${s}`));
        const res = await invent(o.critic, {
          kit, brief: '', direction: structuredClone(direction), seconds, bpm,
          resume: { plan: original, only: o.scenes, fresh: true },
          candidates: 1, rounds: o.rounds ?? 0, filmRounds: 0, render: false, workers: 1,
          outDir: e.dir, log: s => log(`[${tag}] ${s}`), codeLLM: coder, criticLLM: o.critic, feedback: o.feedback,
        });
        plans.set(e.model, res.plan);
        e.scores = Object.fromEntries(res.direction.scenes.map((s, i) => [s.id, res.scores[i]]).filter(([id]) => o.scenes.includes(id as string)));
        const u = res.usage;
        e.codeUsd = summarizeUsage(u.filter(x => x.model === coder.model)).usd;
        e.criticUsd = summarizeUsage(u.filter(x => x.model !== coder.model)).usd;
      } catch (err) {
        e.error = String((err as Error).message ?? err).slice(0, 300);
        log(`[${tag}] failed: ${e.error}`);
      }
      e.seconds = Math.round((Date.now() - t0) / 1000);
    }
  }));

  // ── 2. side-by-side videos, one per scene ────────────────────────────────
  const contestants = [
    { label: 'current version', plan: original },
    ...entries.filter(e => plans.has(e.model)).map(e => ({ label: e.model, plan: plans.get(e.model)! })),
  ];
  const W = 960, H = 540, LH = 56;
  const browser = await launch();
  const outputs: string[] = [];
  try {
    const labels: string[] = [];
    for (const [k, c] of contestants.entries()) {
      const ctx = await browser.newContext({ viewport: { width: W, height: LH } });
      const page = await ctx.newPage();
      const e = entries.find(x => x.model === c.label);
      const cost = e ? ` · $${((e.codeUsd ?? 0) + (e.criticUsd ?? 0)).toFixed(3)}` : '';
      await page.setContent(`<body style="margin:0;background:#101114;color:#fff;font:600 24px/${LH}px sans-serif;padding:0 18px;white-space:nowrap;overflow:hidden">${k ? `${k}. ` : ''}${c.label.replace(/[<&]/g, '')}<span style="color:#9aa0aa;font-weight:400">${cost}</span></body>`);
      const file = join(o.outDir, `label-${k}.png`);
      await page.screenshot({ path: file });
      await ctx.close();
      labels.push(file);
    }
    for (const id of o.scenes) {
      const clips: string[] = [];
      for (const [k, c] of contestants.entries()) {
        const reel = await openReel(c.plan, browser);
        try {
          const sec = reel.sections.find(s => s.technique === `scene:${id}`)!;
          const [clip] = await renderClips(reel, [{ from: sec.start, to: sec.end }], { width: W, fps: 30, audio: k === 0, crf: 23 });
          const file = join(o.outDir, `${id}-${k}.mp4`);
          writeFileSync(file, clip);
          clips.push(file);
        } finally {
          await reel.page.context().close();
        }
      }
      const n = clips.length, cols = n <= 2 ? n : n <= 4 ? 2 : 3;
      const inputs = clips.flatMap((c, k) => ['-i', c, '-loop', '1', '-i', labels[k]]);
      const cells = clips.map((_, k) => `[${2 * k + 1}:v]scale=${W}:${LH},setsar=1[l${k}];[${2 * k}:v]scale=${W}:${H},setsar=1[c${k}];[l${k}][c${k}]vstack=shortest=1[v${k}]`);
      const layout = clips.map((_, k) => `${(k % cols) * W}_${Math.floor(k / cols) * (H + LH)}`).join('|');
      const graph = `${cells.join(';')};${clips.map((_, k) => `[v${k}]`).join('')}xstack=inputs=${n}:layout=${layout}:fill=black[out]`;
      const file = join(o.outDir, `${id}.mp4`);
      await ffmpeg(['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[out]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
      // a contact sheet of the grid at four moments, for a quick look
      await ffmpeg(['-y', '-loglevel', 'error', '-i', file, '-vf', `fps=4/${Math.max(0.5, (original.sections.find(s => s.technique === `scene:${id}`)?.beats ?? 4) * (60 / bpm)).toFixed(3)},scale=${Math.round((cols * W) / 2)}:-1,tile=1x4`, '-frames:v', '1', join(o.outDir, `${id}.png`)]);
      outputs.push(file);
      log(`  ${id}: ${file}`);
    }
  } finally {
    await browser.close();
  }
  const summary = { src: o.src, scenes: o.scenes, critic: o.critic.model, rounds: o.rounds ?? 0, contestants: contestants.map(c => c.label), entries };
  writeFileSync(join(o.outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  return { entries, videos: outputs };
}
