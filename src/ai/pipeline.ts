import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataUrlToBuffer, launch, openReel } from '../cli/browser';
import { buildHtml } from '../cli/html';
import { autoTimes, renderVideo } from '../cli/render';
import type { Plan } from '../plan/schema';
import type { Issue } from '../plan/validate';
import { extractBrand, logoFromFile } from './brand';
import { loadBrandKit, type BrandKit } from './brand-kit';
import { summarizeUsage, type LLM, type Usage } from './llm';
import { Planner } from './planner';
import { needsRevision, review, revisionMessage, type Critique } from './qa';

// URL (or brand kit) + brief → brand.json, plan.json, contact sheet, HTML
// preview, MP4 and a report of every step and what it cost.

export interface MakeOptions {
  url?: string;
  brandFile?: string;
  logoFile?: string;
  brief: string;
  seconds?: number;
  bpm?: number;
  genre?: 'afro-house' | 'electro';
  /** Review → revise rounds (0 skips visual QA). */
  qaRounds?: number;
  render?: boolean;
  workers?: number;
  outDir: string;
  log?: (s: string) => void;
}

export interface MakeResult {
  plan: Plan;
  kit: BrandKit;
  usage: Usage[];
  reviews: Critique[];
  files: { brand: string; plan: string; sheet: string; html: string; report: string; transcript: string; video?: string };
}

export async function make(llm: LLM, o: MakeOptions): Promise<MakeResult> {
  const log = o.log ?? (() => {});
  const dir = o.outDir;
  mkdirSync(dir, { recursive: true });
  const f = (n: string) => join(dir, n);
  const usage: Usage[] = [];
  const t0 = Date.now();
  // every raw model reply, in order, so a run can be audited afterwards
  const audit: { step: string; model: string; at: string; reply?: string; conversation?: { role: string; text: string }[] }[] = [];
  const browser = await launch();
  try {
    // 1. brand
    let kit: BrandKit;
    if (o.brandFile) {
      kit = loadBrandKit(JSON.parse(readFileSync(o.brandFile, 'utf8')));
      if (o.logoFile) kit.brand.logo = (await logoFromFile(o.logoFile, browser)) ?? kit.brand.logo;
    } else {
      log('1/4 brand');
      const b = await extractBrand(o.url!, llm, { browser, logoFile: o.logoFile, log });
      usage.push(...b.usage);
      audit.push({ step: 'brand', model: llm.model, at: new Date().toISOString(), reply: b.raw });
      kit = b.kit;
      writeFileSync(f('screenshot.jpg'), b.scrape.screenshot);
    }
    writeFileSync(f('brand.json'), JSON.stringify(kit, null, 2));

    // 2. plan
    log('2/4 plan');
    const planner = new Planner(llm, { brief: o.brief, kit, seconds: o.seconds, bpm: o.bpm, genre: o.genre, log });
    let res = await planner.draft();
    let plan = res.plan;
    let warnings: Issue[] = res.warnings;
    const concept = res.concept;
    if (concept) log(`  concept: ${concept}`);
    writeFileSync(f('plan.json'), JSON.stringify(plan, null, 2));

    // 3. visual QA
    const reviews: Critique[] = [];
    for (let r = 0; r < (o.qaRounds ?? 1); r++) {
      log(`3/4 review${o.qaRounds && o.qaRounds > 1 ? ` ${r + 1}` : ''}`);
      const rv = await review(llm, plan, kit, { browser, log });
      usage.push(rv.usage);
      audit.push({ step: `review ${r + 1}`, model: llm.model, at: new Date().toISOString(), reply: rv.raw });
      reviews.push(rv.critique);
      writeFileSync(f(`review-${r + 1}.json`), JSON.stringify(rv.critique, null, 2));
      log(`  ${rv.critique.score}/10 · ${rv.critique.issues.length} issue(s)${rv.critique.summary ? ` · ${rv.critique.summary.slice(0, 140)}` : ''}`);
      if (!needsRevision(rv.critique)) break;
      try {
        res = await planner.revise(revisionMessage(rv.critique));
      } catch (e) {
        // a revision that never validates must not lose the plan we already have
        log(`  revision failed, keeping the previous plan: ${(e as Error).message.split('\n')[0]}`);
        break;
      }
      plan = res.plan;
      warnings = res.warnings;
      writeFileSync(f('plan.json'), JSON.stringify(plan, null, 2));
    }
    usage.push(...planner.usage);
    audit.push({ step: 'planning conversation (system prompt omitted)', model: llm.model, at: new Date().toISOString(), conversation: planner.transcript() });
    writeFileSync(f('transcript.json'), JSON.stringify(audit, null, 2));

    // 4. outputs
    log('4/4 outputs');
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

    const files = { brand: f('brand.json'), plan: f('plan.json'), sheet: f('sheet.png'), html: f('reel.html'), report: f('report.json'), transcript: f('transcript.json'), ...(video ? { video } : {}) };
    const seconds = plan.sections.reduce((a, s) => a + s.beats, 0) * (60 / plan.music.bpm);
    writeFileSync(files.report, JSON.stringify({
      source: o.url ?? o.brandFile, brief: o.brief, model: llm.model, concept,
      brand: { name: kit.brand.name, colors: kit.brand.colors, fonts: kit.brand.fonts, logo: !!kit.brand.logo },
      video: { seconds, bpm: plan.music.bpm, genre: plan.music.genre, sections: plan.sections.map(s => `${s.technique} ${s.beats}`) },
      planning: planner.rounds.map(r => ({ step: r.label, issues: r.issues.length })),
      reviews: reviews.map(r => ({ score: r.score, issues: r.issues.length, summary: r.summary })),
      warnings, usage: summarizeUsage(usage), wallSeconds: Math.round((Date.now() - t0) / 1000), files,
    }, null, 2));
    return { plan, kit, usage, reviews, files };
  } finally {
    await browser.close();
  }
}
