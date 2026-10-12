import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import STUDIO_DOCS from '../../docs/studio.md?raw';
import { formatIssues, validatePlan } from '../plan/validate';
import type { Brand, Plan } from '../plan/schema';
import { loadBrandKit } from '../ai/brand-kit';
import { summarizeUsage } from '../ai/llm';
import { llmFor } from '../ai/models';
import { ReplayLLM } from '../ai/replay';
import { renderVideo } from './render';
import { adapt } from '../studio/adapt';
import { direct } from '../studio/agent';
import { copyFilm, run as runFfmpeg } from '../studio/copy';
import { ssimOf } from '../ai/inspect';
import { rectifyVideo, type Quad } from '../studio/rectify';
import { serveMcp } from '../studio/mcp';
import { applyOps, describe, type Op } from '../studio/ops';

export const STUDIO_HELP = `Studio (layer-and-keyframe comps; docs/studio.md):
  motion studio docs                             the comp format, for people and models
  motion studio describe <plan.json> [--comp id] one line per section and layer
  motion studio apply <plan.json> <ops.json> [-o out.json]
                                                 edit a plan with studio operations (all or nothing)
  motion studio copy <reference.mp4> [-o dir] [--from s] [--to s] [--fps 30] [--brand brand.json] [--no-render]
                                                 measure a film into an editable comp (no model), render it with the
                                                 reference's soundtrack, score it (SSIM) and write compare.mp4
  motion studio adapt <copy-dir | plan.json> --brand brand.json [--brief "..."] [--model id] [-o dir] [--no-render]
                                                 make the copied film yours: a vision model says what each element is
                                                 (words, logo, shape…); its layers get the brand's content and keep the
                                                 measured motion (Gemini, or any provider/model through OpenRouter)
  motion studio direct --brand brand.json --brief "..." [--seconds 20] [--model deepseek-flash] [--reference ref.mp4] [--plan first.json] [--steps 40] [-o dir]
                                                 a model drives the studio: builds comps, looks at contact sheets of its
                                                 own film, fixes what it sees, renders (DEEPSEEK_API_KEY or OpenRouter);
                                                 with --reference it measures the film first and refines the copy
  motion studio rectify <phone-video.mp4> [-o flat.mp4] [--quad "x,y x,y x,y x,y"] [--no-track]
                                                 a film shot off a screen with a phone: find the screen, follow the
                                                 drift, and flatten it to a clean 16:9 video (copy / direct use that)
  motion studio mcp [plan.json]                  MCP server (stdio): any agent edits, renders and compares comps
`;

type Flags = Record<string, string | true>;

function loadPlanFile(file: string): Plan {
  const r = validatePlan(JSON.parse(readFileSync(file, 'utf8')));
  if (!r.ok) throw new Error(`${file} is not a valid plan:\n${formatIssues(r.errors)}`);
  return r.plan;
}
const num = (v: string | true | undefined): number | undefined => (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);

export async function runStudio(pos: string[], flags: Flags): Promise<void> {
  const [sub, ...args] = pos;
  const out = typeof flags.o === 'string' ? flags.o : undefined;
  switch (sub) {
    case 'docs':
      process.stdout.write(STUDIO_DOCS);
      return;
    case 'describe': {
      if (!args[0]) throw new Error('usage: motion studio describe <plan.json> [--comp id]');
      console.log(describe(JSON.parse(readFileSync(args[0], 'utf8')), typeof flags.comp === 'string' ? flags.comp : undefined));
      return;
    }
    case 'apply': {
      if (!args[0] || !args[1]) throw new Error('usage: motion studio apply <plan.json> <ops.json> [-o out.json]');
      const plan = JSON.parse(readFileSync(args[0], 'utf8'));
      const raw = JSON.parse(readFileSync(args[1], 'utf8'));
      const ops = (Array.isArray(raw) ? raw : raw.ops) as Op[];
      const r = applyOps(plan, ops);
      if (!r.ok) {
        console.error(`✗ ${r.error} (nothing changed)`);
        process.exit(2);
      }
      writeFileSync(out ?? args[0], JSON.stringify(r.plan, null, 1));
      console.log(r.done.map(d => `✓ ${d}`).join('\n'));
      if (r.issues.length) console.error(`! the plan does not validate yet:\n${formatIssues(r.issues)}`);
      return;
    }
    case 'copy': {
      if (!args[0]) throw new Error('usage: motion studio copy <reference.mp4> [-o dir] [--from s] [--to s]');
      const dir = out ?? join('out', 'studio-copy');
      const brand = typeof flags.brand === 'string' ? (JSON.parse(readFileSync(flags.brand, 'utf8')) as Brand) : undefined;
      const r = await copyFilm(args[0], {
        out: dir, from: num(flags.from), to: num(flags.to), fps: num(flags.fps), brand, render: !flags['no-render'],
        workers: num(flags.workers), blur: num(flags.blur), log: s => process.stderr.write(s.startsWith('frame') ? `\r${s}   ` : `${s}\n`),
      });
      process.stderr.write('\n');
      console.log(`✓ ${join(dir, 'plan.json')} — ${r.measured.tracks.length} elements, ${r.measured.shots.length} shot(s)`);
      if (r.video) console.log(`✓ ${r.video} · fidelity (SSIM) ${r.ssim?.toFixed(3) ?? 'n/a'} · side by side: ${r.compare}`);
      return;
    }
    case 'adapt': {
      if (!args[0] || typeof flags.brand !== 'string') throw new Error('usage: motion studio adapt <copy-dir | plan.json> --brand brand.json [--brief "..."]');
      const src = args[0].endsWith('.json') ? args[0] : join(args[0], 'plan.json');
      const kit = loadBrandKit(JSON.parse(readFileSync(flags.brand, 'utf8')));
      const brief = typeof flags.brief === 'string' ? (flags.brief.startsWith('@') ? readFileSync(flags.brief.slice(1), 'utf8') : flags.brief) : '';
      const llm = typeof flags.replay === 'string' ? new ReplayLLM(flags.replay) : llmFor(typeof flags.model === 'string' ? flags.model : process.env.MOTION_MODEL, s => console.error(s));
      const r = await adapt(llm, loadPlanFile(src), kit, brief);
      const dir = out ?? (args[0].endsWith('.json') ? 'out/studio-adapt' : join(args[0], 'adapted'));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'plan.json'), JSON.stringify(r.plan, null, 1));
      for (const d of r.decisions) console.log(`  ${d.id.padEnd(7)} ${d.kind.padEnd(5)} ${d.text ? JSON.stringify(d.text) : ''}`);
      const u = summarizeUsage(r.usage);
      console.log(`✓ ${join(dir, 'plan.json')} · ${u.calls} model call · ${u.input.toLocaleString()} in / ${(u.output + u.thinking).toLocaleString()} out tokens${u.usd !== undefined ? ` · ≈ $${u.usd.toFixed(4)}` : ''}`);
      if (!flags['no-render']) {
        const file = join(dir, 'adapted.mp4');
        await renderVideo(r.plan, file, { crf: 18, workers: num(flags.workers) ?? 3, blur: num(flags.blur) ?? 4, log: s => process.stderr.write(`\r${s}   `) });
        process.stderr.write('\n');
        console.log(`✓ ${file}`);
      }
      return;
    }
    case 'direct': {
      if (typeof flags.brand !== 'string') throw new Error('usage: motion studio direct --brand brand.json --brief "..." [--reference ref.mp4]');
      const kit = loadBrandKit(JSON.parse(readFileSync(flags.brand, 'utf8')));
      const brief = typeof flags.brief === 'string' ? (flags.brief.startsWith('@') ? readFileSync(flags.brief.slice(1), 'utf8') : flags.brief) : '';
      const dir = out ?? 'out/studio-direct';
      mkdirSync(dir, { recursive: true });
      const r = await direct({
        model: typeof flags.model === 'string' ? flags.model : 'deepseek-flash', out: dir, kit, brief, seconds: num(flags.seconds),
        reference: typeof flags.reference === 'string' ? flags.reference : undefined, maxSteps: num(flags.steps), log: s => console.error(s),
        plan: typeof flags.plan === 'string' ? JSON.parse(readFileSync(flags.plan, 'utf8')) : undefined, snap: !flags['no-snap'],
      });
      console.log(`✓ ${join(dir, 'plan.json')} · ${r.steps} steps · ${r.usage.calls} model calls · ${r.usage.input.toLocaleString()} in (${r.usage.cached.toLocaleString()} cached) / ${r.usage.output.toLocaleString()} out tokens`);
      if (r.summary) console.log(r.summary);
      if (r.plan && !flags['no-render']) {
        const file = join(dir, 'film.mp4');
        const reference = typeof flags.reference === 'string' ? flags.reference : undefined;
        // a copy plays under the reference's own soundtrack
        const plan = reference ? { ...r.plan, music: { ...r.plan.music, volume: 0 } } : r.plan;
        const silent = reference ? join(dir, 'film.silent.mp4') : file;
        await renderVideo(plan, silent, { crf: 18, workers: num(flags.workers) ?? 3, blur: num(flags.blur) ?? 4, log: s => process.stderr.write(`\r${s}   `) });
        process.stderr.write('\n');
        if (reference) {
          await runFfmpeg(['-y', '-i', silent, '-i', reference, '-map', '0:v', '-map', '1:a?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', file]);
          const dur = plan.sections.reduce((a, s) => a + s.beats, 0) * (60 / plan.music.bpm);
          const ssim = await ssimOf(reference, 0, dur, file);
          const compare = join(dir, 'compare.mp4');
          await runFfmpeg(['-y', '-i', reference, '-i', file, '-filter_complex', '[0:v]scale=960:540,setsar=1,fps=30[a];[1:v]scale=960:540,setsar=1,fps=30[b];[a][b]hstack=inputs=2', '-map', '1:a?', '-c:v', 'libx264', '-crf', '22', '-pix_fmt', 'yuv420p', '-shortest', compare]);
          console.log(`✓ ${file} · fidelity (SSIM) ${ssim?.toFixed(3) ?? 'n/a'} · side by side: ${compare}`);
        } else console.log(`✓ ${file}`);
      }
      return;
    }
    case 'rectify': {
      if (!args[0]) throw new Error('usage: motion studio rectify <video.mp4> [-o flat.mp4] [--quad "x,y x,y x,y x,y"]');
      const quad = typeof flags.quad === 'string' ? (flags.quad.trim().split(/\s+/).map(p => p.split(',').map(Number)) as Quad) : undefined;
      const file = out ?? args[0].replace(/\.[^.]+$/, '') + '.flat.mp4';
      const r = await rectifyVideo(args[0], file, { quad, track: !flags['no-track'], log: s => console.error(s) });
      const dmax = Math.max(0, ...r.drift.map(d => Math.hypot(d.dx, d.dy)));
      console.log(`✓ ${file} — ${r.frames} frames at ${r.width}×${r.height}; phone drift up to ${dmax.toFixed(1)} px followed`);
      return;
    }
    case 'mcp':
      await serveMcp(args[0]);
      return;
    default:
      process.stdout.write(STUDIO_HELP);
      if (sub) process.exit(1);
  }
}
