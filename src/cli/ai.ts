import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractBrand } from '../ai/brand';
import { loadBrandKit } from '../ai/brand-kit';
import { Gemini, DEFAULT_MODEL, apiKey } from '../ai/gemini';
import { isOpenRouterId, llmFor } from '../ai/models';
import { openRouterKey } from '../ai/openrouter';
import { bakeoff } from './bakeoff';
import { summarizeUsage, type LLM, type Usage } from '../ai/llm';
import { loadBar } from '../ai/bar';
import { invent } from '../ai/invent';
import { defaultLessonsPath, evidenceFromRun, learn, Lessons, weight } from '../ai/lessons';
import { replicate } from '../ai/replicate';
import { make } from '../ai/pipeline';
import { Planner } from '../ai/planner';
import { review } from '../ai/qa';
import { ReplayLLM } from '../ai/replay';
import { scrapeSite } from '../ai/scrape';
import { vectorizeLogo } from '../ai/vectorize';
import { formatIssues, validatePlan } from '../plan/validate';
import { launch } from './browser';

// CLI commands that involve a model (plus `scrape`, which doesn't but feeds one).

type Flags = Record<string, string | true>;
const str = (v: string | true | undefined) => (typeof v === 'string' ? v : undefined);
const num = (v: string | true | undefined) => (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const log = (s: string) => console.error(s);
const svgOf = (d: string, box: number[]) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(' ')}"><path fill="#111" d="${d}"/></svg>\n`;

/** A model by id: "provider/model" ids go through OpenRouter, bare ids to Gemini. */
function modelById(id: string | undefined): LLM {
  if (isOpenRouterId(id)) {
    if (!openRouterKey()) throw new Error('set OPENROUTER_API_KEY first (https://openrouter.ai/keys)');
  } else if (!apiKey()) throw new Error('set GEMINI_API_KEY first (https://aistudio.google.com/apikey)');
  return llmFor(id, log);
}

function gemini(flags: Flags): LLM {
  if (typeof flags.replay === 'string') return new ReplayLLM(flags.replay);
  return modelById(str(flags.model) ?? process.env.MOTION_MODEL);
}

/** --code-model / --critic-model: another model for one role. */
const roleModel = (flags: Flags, flag: string) => (str(flags[flag]) ? modelById(str(flags[flag])) : undefined);

function genreOf(v: string | true | undefined) {
  if (v === undefined) return undefined;
  if (v === 'afro-house' || v === 'electro') return v;
  throw new Error('--genre must be afro-house or electro');
}

function readBrief(flags: Flags): string {
  const b = str(flags.brief) ?? '';
  return b.startsWith('@') ? readFileSync(b.slice(1), 'utf8') : b;
}

/** The lessons store for a run (none with --no-lessons). */
const lessonsOf = (flags: Flags) => (flags['no-lessons'] ? undefined : new Lessons(str(flags.lessons) ?? defaultLessonsPath()));

export function printUsage(list: Usage[]) {
  const u = summarizeUsage(list);
  log(`  ${u.calls} model call${u.calls === 1 ? '' : 's'} · ${u.input.toLocaleString()} in / ${(u.output + u.thinking).toLocaleString()} out tokens · ${u.seconds} s${u.usd !== undefined ? ` · ≈ $${u.usd.toFixed(4)}` : ''}`);
}

export async function runAi(cmd: string, pos: string[], flags: Flags): Promise<boolean> {
  const out = str(flags.o);
  switch (cmd) {
    case 'models': {
      if (flags.openrouter) {
        // OpenRouter's catalogue is public: no key needed
        const res = await fetch('https://openrouter.ai/api/v1/models');
        if (!res.ok) throw new Error(`OpenRouter model list: ${res.status} ${(await res.text()).slice(0, 200)}`);
        const { data } = (await res.json()) as { data: { id: string; pricing?: Record<string, string>; architecture?: { input_modalities?: string[] }; top_provider?: { max_completion_tokens?: number } }[] };
        const filter = str(flags.filter)?.toLowerCase();
        const per = (v?: string) => (v ? `$${(Number(v) * 1e6).toFixed(3)}` : '?');
        for (const m of data.filter(m => !filter || m.id.toLowerCase().includes(filter)).sort((a, b) => a.id.localeCompare(b.id)))
          console.log(`${m.id.padEnd(42)} in ${per(m.pricing?.prompt).padStart(8)} out ${per(m.pricing?.completion).padStart(8)} per 1M · ${(m.architecture?.input_modalities ?? []).join(',')}`);
        return true;
      }
      if (!apiKey()) throw new Error('set GEMINI_API_KEY first (https://aistudio.google.com/apikey)');
      const g = new Gemini({ model: str(flags.model), log });
      const list = await g.models();
      for (const m of list.filter(m => /gemini/.test(m.id))) console.log(`${m.id.padEnd(36)} ${m.name}${m.id === DEFAULT_MODEL ? '   ← default' : ''}`);
      if (!list.some(m => m.id === DEFAULT_MODEL)) log(`! the default model ${DEFAULT_MODEL} is not listed for this key; pass --model or set MOTION_MODEL`);
      return true;
    }
    case 'scrape': {
      if (!pos[0]) throw new Error('missing <url>');
      const dir = out ?? 'out/scrape';
      mkdirSync(dir, { recursive: true });
      const s = await scrapeSite(pos[0]);
      const markColor = str(flags.mark);
      writeFileSync(join(dir, 'site.json'), JSON.stringify(s.site, null, 2));
      writeFileSync(join(dir, 'screenshot.jpg'), s.screenshot);
      s.logos.forEach((l, i) => {
        writeFileSync(join(dir, `logo-${i}.png`), l.preview);
        for (const iconOnly of [false, true]) {
          const v = vectorizeLogo(l.rgba, { iconOnly, markColor });
          if (v) writeFileSync(join(dir, `logo-${i}${iconOnly ? '-icon' : ''}.svg`), svgOf(v.d, v.box));
        }
      });
      console.log(`✓ ${s.site.title || s.site.finalUrl} · ${s.logos.length} logo candidate(s) → ${dir}`);
      return true;
    }
    case 'brand': {
      if (!pos[0]) throw new Error('missing <url>');
      const file = out ?? 'out/brand.json';
      const r = await extractBrand(pos[0], gemini(flags), { logoFile: str(flags.logo), log });
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, JSON.stringify(r.kit, null, 2));
      printUsage(r.usage);
      console.log(`✓ wrote ${file}`);
      return true;
    }
    case 'plan': {
      const brandFile = str(flags.brand);
      if (!brandFile) throw new Error('missing --brand <brand.json>');
      const kit = loadBrandKit(JSON.parse(readFileSync(brandFile, 'utf8')));
      const file = out ?? 'out/plan.json';
      const planner = new Planner(gemini(flags), {
        brief: readBrief(flags), kit, seconds: num(flags.seconds), bpm: num(flags.bpm), genre: genreOf(flags.genre),
        effort: (str(flags.effort) as 'low' | 'medium' | 'high' | undefined) ?? 'medium', strict: !flags.loose, log,
      });
      const res = await planner.draft();
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, JSON.stringify(res.plan, null, 2));
      if (res.concept) log(`  concept: ${res.concept}`);
      if (res.warnings.length) log(`! warnings:\n${formatIssues(res.warnings)}`);
      printUsage(res.usage);
      console.log(`✓ wrote ${file} — ${res.plan.sections.length} sections after ${res.rounds.length} round(s)`);
      return true;
    }
    case 'review': {
      if (!pos[0]) throw new Error('missing <plan.json>');
      const v = validatePlan(JSON.parse(readFileSync(pos[0], 'utf8')));
      if (!v.ok) throw new Error(`invalid plan:\n${formatIssues(v.errors)}`);
      const kit = str(flags.brand) ? loadBrandKit(JSON.parse(readFileSync(str(flags.brand)!, 'utf8'))) : loadBrandKit({ brand: v.plan.brand });
      const browser = await launch();
      try {
        const r = await review(gemini(flags), v.plan, kit, { browser, log });
        if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'review.json'), JSON.stringify(r.critique, null, 2)); }
        console.log(JSON.stringify(r.critique, null, 2));
        printUsage([r.usage]);
      } finally {
        await browser.close();
      }
      return true;
    }
    case 'invent': {
      const dir = out ?? 'out/invent';
      const llm = gemini(flags);
      let kit;
      if (str(flags.brand)) kit = loadBrandKit(JSON.parse(readFileSync(str(flags.brand)!, 'utf8')));
      else if (pos[0]) {
        const b = await extractBrand(pos[0], llm, { logoFile: str(flags.logo), log });
        kit = b.kit;
        printUsage(b.usage);
      } else throw new Error('missing <url> or --brand brand.json');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'brand.json'), JSON.stringify(kit, null, 2));
      const sub = (flag: string) => roleModel(flags, flag);
      const list = (flag: string) => (str(flags[flag]) ?? '').split(',').map(x => x.trim()).filter(Boolean);
      const bar = list('bar-video').length || list('bar-code').length ? await loadBar(list('bar-video'), list('bar-code')) : undefined;
      if (bar) log(`  quality bar: ${bar.videos.length} film(s), ${Math.round((bar.code?.length ?? 0) / 1000)}k chars of reference code`);
      const res = await invent(llm, {
        bar, feedback: str(flags.feedback)?.startsWith('@') ? readFileSync(str(flags.feedback)!.slice(1), 'utf8') : str(flags.feedback),
        kit, brief: readBrief(flags), seconds: num(flags.seconds), bpm: num(flags.bpm),
        candidates: num(flags.candidates), rounds: num(flags.rounds), filmRounds: flags['no-qa'] ? 0 : num(flags['film-rounds']),
        budget: num(flags.budget), target: num(flags.target), render: !flags['no-render'], workers: num(flags.workers) ?? 3, outDir: dir, log,
        codeLLM: sub('code-model'), criticLLM: sub('critic-model'), lessons: lessonsOf(flags), noLearn: !!flags['no-learn'],
      });
      printUsage(res.usage);
      log(`  scene scores: ${res.scores.join(' · ')}${res.films.length ? ` · film ${res.films.map(f => f.score).join(' → ')}/10` : ''}`);
      console.log(`✓ ${res.video ?? join(dir, 'plan.json')} — "${res.direction.title}"`);
      return true;
    }
    case 'refine': {
      const src = pos[0];
      if (!src) throw new Error('missing <invent output dir>');
      const only = (str(flags.scenes) ?? '').split(',').map(x => x.trim()).filter(Boolean);
      if (!only.length) throw new Error('missing --scenes id1,id2');
      const read = (n: string) => JSON.parse(readFileSync(join(src, n), 'utf8'));
      const v = validatePlan(read('plan.json'));
      if (!v.ok) throw new Error(`invalid plan in ${src}:\n${formatIssues(v.errors)}`);
      const direction = read('direction.json');
      const unknown = only.filter(id => !direction.scenes.some((s: { id: string }) => s.id === id));
      if (unknown.length) throw new Error(`unknown scene id(s): ${unknown.join(', ')}; scenes: ${direction.scenes.map((s: { id: string }) => s.id).join(', ')}`);
      const dir = out ?? `${src.replace(/\/$/, '')}-refined`;
      const llm = gemini(flags);
      const list = (flag: string) => (str(flags[flag]) ?? '').split(',').map(x => x.trim()).filter(Boolean);
      const bar = list('bar-video').length || list('bar-code').length ? await loadBar(list('bar-video'), list('bar-code')) : undefined;
      const seconds = v.plan.sections.reduce((a, x) => a + x.beats, 0) * (60 / v.plan.music.bpm);
      const res = await invent(llm, {
        kit: loadBrandKit(read('brand.json')), brief: readBrief(flags), direction, resume: { plan: v.plan, only, fresh: !!flags.fresh }, seconds, bpm: v.plan.music.bpm,
        bar, feedback: str(flags.feedback)?.startsWith('@') ? readFileSync(str(flags.feedback)!.slice(1), 'utf8') : str(flags.feedback),
        candidates: num(flags.candidates) ?? 1, rounds: num(flags.rounds) ?? 3, filmRounds: num(flags['film-rounds']) ?? 0, budget: num(flags.budget), target: num(flags.target),
        render: !flags['no-render'], workers: num(flags.workers) ?? 3, outDir: dir, log,
        codeLLM: roleModel(flags, 'code-model'), criticLLM: roleModel(flags, 'critic-model'), lessons: lessonsOf(flags), noLearn: !!flags['no-learn'],
      });
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'brand.json'), readFileSync(join(src, 'brand.json')));
      printUsage(res.usage);
      console.log(`✓ ${res.video ?? join(dir, 'plan.json')} — refined ${only.join(', ')}`);
      return true;
    }
    case 'bakeoff': {
      const src = pos[0];
      if (!src) throw new Error('missing <invent output dir>');
      const listOf = (flag: string) => (str(flags[flag]) ?? '').split(',').map(x => x.trim()).filter(Boolean);
      const scenes = listOf('scenes'), models = listOf('models');
      if (!scenes.length) throw new Error('missing --scenes id1,id2');
      if (!models.length) throw new Error('missing --models provider/model,… (e.g. qwen/qwen3.8-max-0902,z-ai/glm-5.3-flash)');
      const critic = modelById(str(flags['critic-model']) ?? (apiKey() ? DEFAULT_MODEL : `google/${DEFAULT_MODEL}`));
      const dir = out ?? 'out/bakeoff';
      const res = await bakeoff({
        src, scenes, models, critic, rounds: num(flags.rounds) ?? 0, parallel: num(flags.parallel) ?? 2, outDir: dir, log,
        feedback: str(flags.feedback)?.startsWith('@') ? readFileSync(str(flags.feedback)!.slice(1), 'utf8') : str(flags.feedback),
      });
      log('');
      log(`  ${'model'.padEnd(34)} ${scenes.map(s => s.slice(0, 14).padStart(15)).join('')}   code $   critic $   time`);
      for (const e of res.entries) {
        if (e.error) { log(`  ${e.model.padEnd(34)} failed: ${e.error.slice(0, 120)}`); continue; }
        log(`  ${e.model.padEnd(34)} ${scenes.map(s => String(e.scores?.[s] ?? '–').padStart(15)).join('')}   ${(e.codeUsd ?? 0).toFixed(3).padStart(6)}   ${(e.criticUsd ?? 0).toFixed(3).padStart(8)}   ${e.seconds}s`);
      }
      console.log(`✓ ${res.videos.join(', ')}`);
      return true;
    }
    case 'replicate': {
      if (!pos[0]) throw new Error('missing <reference.mp4>');
      const exact = !!flags.exact;
      if (!str(flags.brand) && !exact) throw new Error('missing --brand brand.json (or use --exact for a straight copy)');
      const dir = out ?? 'out/replicate';
      const llm = gemini(flags);
      // an exact copy takes its colours and words from the reference; the kit is only a placeholder then
      const kit = loadBrandKit(str(flags.brand) ? JSON.parse(readFileSync(str(flags.brand)!, 'utf8')) : { brand: { name: 'Reference', colors: { bg: '#0B0B0D', text: '#FFFFFF', primary: '#FF4D2E', secondary: '#FFFFFF' } } });
      const sub = (flag: string) => roleModel(flags, flag);
      const res = await replicate(llm, {
        videoFile: pos[0], kit, brief: readBrief(flags), keepColors: !!flags['keep-colors'], exact, planOnly: !!flags['plan-only'], reusePlan: !!flags['reuse-plan'],
        candidates: num(flags.candidates), rounds: num(flags.rounds), filmRounds: flags['no-qa'] ? 0 : num(flags['film-rounds']),
        budget: num(flags.budget), target: num(flags.target), render: !flags['no-render'], workers: num(flags.workers) ?? 3, outDir: dir, log,
        codeLLM: sub('code-model'), criticLLM: sub('critic-model'), lessons: lessonsOf(flags), noLearn: !!flags['no-learn'],
      });
      if (!('scores' in res)) {
        printUsage(res.usageExtra);
        console.log(`✓ ${join(dir, 'breakdown.json')} and ${join(dir, 'direction.json')} — "${res.direction.title}"`);
        return true;
      }
      printUsage([...res.usageExtra, ...res.usage]);
      log(`  scene scores: ${res.scores.join(' · ')}${res.films.length ? ` · film ${res.films.map(f => f.score).join(' → ')}/10` : ''}`);
      console.log(`✓ ${res.video ?? join(dir, 'plan.json')} — "${res.direction.title}"`);
      return true;
    }
    case 'lessons': {
      const store = new Lessons(str(flags.lessons) ?? defaultLessonsPath());
      const drop = (str(flags.remove) ?? '').split(',').map(x => x.trim()).filter(Boolean);
      if (drop.length) {
        const before = store.lessons.length;
        store.lessons = store.lessons.filter(l => !drop.includes(l.id));
        store.save();
        log(`  removed ${before - store.lessons.length} lesson(s)`);
      }
      const list = [...store.lessons].sort((a, b) => weight(b) - weight(a));
      console.log(`${list.length} lesson(s) in ${store.file}\n`);
      for (const l of list) console.log(`${l.id}  [${l.roles.join(', ')}${l.mode !== 'any' ? ` · ${l.mode} only` : ''}]  seen ${l.seen}× · shown ${l.shown}× · repeated ${l.repeated}×\n  ${l.rule}\n`);
      return true;
    }
    case 'learn': {
      if (!pos.length) throw new Error('missing <run-dir> (an invent, refine or replicate output folder)');
      const store = new Lessons(str(flags.lessons) ?? defaultLessonsPath());
      const m = roleModel(flags, 'critic-model') ?? gemini(flags);
      const usage: Usage[] = [];
      for (const dir of pos) {
        const ev = evidenceFromRun(dir);
        if (!ev.scenes.some(s => s.versions.length || s.tests.length)) {
          log(`  ${dir}: no critiques or test results found, skipped`);
          continue;
        }
        const r = await learn(m, store, ev, dir);
        usage.push(r.usage);
        log(`  ${dir}: ${r.added.length} new lesson(s)${r.added.length ? ` (${r.added.join(', ')})` : ''}, ${r.reinforced.length} reinforced`);
      }
      printUsage(usage);
      console.log(`✓ ${store.lessons.length} lesson(s) in ${store.file} (motion lessons to read them)`);
      return true;
    }
    case 'make': {
      if (!pos[0] && !flags.brand) throw new Error('missing <url> (or --brand brand.json)');
      const dir = out ?? 'out/make';
      const res = await make(gemini(flags), {
        url: pos[0], brandFile: str(flags.brand), logoFile: str(flags.logo), brief: readBrief(flags),
        seconds: num(flags.seconds), bpm: num(flags.bpm), genre: genreOf(flags.genre),
        qaRounds: flags['no-qa'] ? 0 : num(flags.qa) ?? 1, render: !flags['no-render'], workers: num(flags.workers) ?? 3,
        outDir: dir, log,
      });
      printUsage(res.usage);
      console.log(`✓ ${res.files.video ?? res.files.plan} (report: ${res.files.report})`);
      return true;
    }
  }
  return false;
}
