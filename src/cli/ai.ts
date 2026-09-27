import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractBrand } from '../ai/brand';
import { loadBrandKit } from '../ai/brand-kit';
import { Gemini, DEFAULT_MODEL, apiKey } from '../ai/gemini';
import { summarizeUsage, type LLM, type Usage } from '../ai/llm';
import { invent } from '../ai/invent';
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

function gemini(flags: Flags): LLM {
  if (typeof flags.replay === 'string') return new ReplayLLM(flags.replay);
  if (!apiKey()) throw new Error('set GEMINI_API_KEY first (https://aistudio.google.com/apikey)');
  return new Gemini({ model: str(flags.model), log });
}

function genreOf(v: string | true | undefined) {
  if (v === undefined) return undefined;
  if (v === 'afro-house' || v === 'electro') return v;
  throw new Error('--genre must be afro-house or electro');
}

function readBrief(flags: Flags): string {
  const b = str(flags.brief) ?? '';
  return b.startsWith('@') ? readFileSync(b.slice(1), 'utf8') : b;
}

export function printUsage(list: Usage[]) {
  const u = summarizeUsage(list);
  log(`  ${u.calls} model call${u.calls === 1 ? '' : 's'} · ${u.input.toLocaleString()} in / ${(u.output + u.thinking).toLocaleString()} out tokens · ${u.seconds} s${u.usd !== undefined ? ` · ≈ $${u.usd.toFixed(4)}` : ''}`);
}

export async function runAi(cmd: string, pos: string[], flags: Flags): Promise<boolean> {
  const out = str(flags.o);
  switch (cmd) {
    case 'models': {
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
      const sub = (flag: string) => (str(flags[flag]) ? new Gemini({ model: str(flags[flag]), log }) : undefined);
      const res = await invent(llm, {
        kit, brief: readBrief(flags), seconds: num(flags.seconds), bpm: num(flags.bpm),
        candidates: num(flags.candidates), rounds: num(flags.rounds), filmRounds: flags['no-qa'] ? 0 : num(flags['film-rounds']),
        budget: num(flags.budget), target: num(flags.target), render: !flags['no-render'], workers: num(flags.workers) ?? 3, outDir: dir, log,
        codeLLM: sub('code-model'), criticLLM: sub('critic-model'),
      });
      printUsage(res.usage);
      log(`  scene scores: ${res.scores.join(' · ')}${res.films.length ? ` · film ${res.films.map(f => f.score).join(' → ')}/10` : ''}`);
      console.log(`✓ ${res.video ?? join(dir, 'plan.json')} — "${res.direction.title}"`);
      return true;
    }
    case 'replicate': {
      if (!pos[0]) throw new Error('missing <reference.mp4>');
      if (!str(flags.brand)) throw new Error('missing --brand brand.json');
      const dir = out ?? 'out/replicate';
      const llm = gemini(flags);
      const kit = loadBrandKit(JSON.parse(readFileSync(str(flags.brand)!, 'utf8')));
      const sub = (flag: string) => (str(flags[flag]) ? new Gemini({ model: str(flags[flag]), log }) : undefined);
      const res = await replicate(llm, {
        videoFile: pos[0], kit, brief: readBrief(flags), keepColors: !!flags['keep-colors'],
        candidates: num(flags.candidates), rounds: num(flags.rounds), filmRounds: flags['no-qa'] ? 0 : num(flags['film-rounds']),
        budget: num(flags.budget), target: num(flags.target), render: !flags['no-render'], workers: num(flags.workers) ?? 3, outDir: dir, log,
        codeLLM: sub('code-model'), criticLLM: sub('critic-model'),
      });
      writeFileSync(join(dir, 'breakdown.json'), JSON.stringify(res.breakdown, null, 2));
      printUsage([...res.usageExtra, ...res.usage]);
      log(`  scene scores: ${res.scores.join(' · ')}${res.films.length ? ` · film ${res.films.map(f => f.score).join(' → ')}/10` : ''}`);
      console.log(`✓ ${res.video ?? join(dir, 'plan.json')} — "${res.direction.title}"`);
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
