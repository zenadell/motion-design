import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { formatIssues, validatePlan } from '../plan/validate';
import type { Plan } from '../plan/schema';
import { dataUrlToBuffer, openReel } from './browser';
import { catalogJson, catalogMarkdown } from './catalog';
import { runAi } from './ai';
import { gallery } from './gallery';
import { buildHtml } from './html';
import { autoTimes, renderAudio, renderVideo } from './render';

const HELP = `motion — beat-synced motion design from a JSON plan

usage:
  motion validate <plan.json> [--json]          check a plan; --json prints machine-readable issues
  motion html     <plan.json> [-o out.html]      self-contained interactive HTML (fonts + music inlined)
  motion stills   <plan.json> [-o dir] [--at 1.5,3] [--sheet] [--blur 6]
                                                 PNG stills (default: 2 per section) and a labelled contact sheet
  motion render   <plan.json> [-o out.mp4] [--crf 18] [--workers N] [--blur 6] [--from s] [--to s]
                                                 1080p MP4 with soundtrack, motion blur, parallel workers
  motion audio    <plan.json> [-o out.wav]       just the soundtrack
  motion catalog  [--json | --md]                technique catalog (the planner's reference)
  motion gallery  [-o dir] [--quick] [--only id,id]
                                                 contact sheet of every technique (smoke test)

AI director (needs GEMINI_API_KEY; model: gemini-3.8-flash, override with --model or MOTION_MODEL):
  motion make     <url> --brief "..." [--seconds 20] [--genre afro-house|electro] [--bpm 120]
                  [--logo mark.svg] [--brand brand.json] [--qa 1 | --no-qa] [--no-render] [-o dir]
                                                 website → brand kit → plan → visual review → MP4
  motion invent   <url> | --brand brand.json --brief "..." [--seconds 24] [--bpm n] [-o dir]
                  [--candidates 2] [--rounds 2] [--film-rounds 1] [--target 9] [--budget 6]
                  [--code-model id] [--critic-model id] [--no-render]
                  [--bar-video a.mp4,b.mp4] [--bar-code a.html,b.html]   reference films that set the quality bar
                  [--feedback "..." | @file]                           the client's notes on earlier versions
                                                 the model designs a new look, writes every scene's code, watches
                                                 its renders and rewrites until the critic's score stops improving
  motion refine   <invent-dir> --scenes id,id [--rounds 3] [--feedback "..."] [--bar-video …] [-o dir]
                                                 rework only some scenes of a finished film (watch → critique → rewrite)
  motion replicate <reference.mp4> --brand brand.json [--brief "..."] [--keep-colors] [same flags as invent]
                                                 watch a film you like and rebuild it, shot for shot, for the brand
  motion brand    <url> [--logo mark.svg] [-o brand.json]
                                                 extract colours, fonts, facts and the logo mark
  motion plan     --brand brand.json --brief "..." [--seconds 20] [--genre g] [--effort low|medium|high] [-o plan.json]
                                                 write a plan (validated and repaired automatically)
  motion review   <plan.json> [--brand brand.json] [-o dir]
                                                 vision-model critique of rendered frames
  motion models                                  models your key can use
  motion scrape   <url> [--mark #FFFFFF] [-o dir]
                                                 what the brand extractor sees (no model call)

  --brief accepts @file.txt · --replay replies.json plays back recorded model replies (tests, no key)
`;

const VALUE_FLAGS = ['at', 'crf', 'workers', 'blur', 'from', 'to', 'only', 'brand', 'brief', 'seconds', 'bpm', 'genre', 'model', 'logo', 'effort', 'qa', 'mark', 'replay', 'candidates', 'rounds', 'film-rounds', 'budget', 'target', 'code-model', 'critic-model', 'bar-video', 'bar-code', 'feedback', 'scenes'];

function parse(argv: string[]) {
  const pos: string[] = [], flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') flags.o = argv[++i];
    else if (a.startsWith('--')) {
      const k = a.slice(2), v = argv[i + 1];
      if (v !== undefined && !v.startsWith('-') && VALUE_FLAGS.includes(k)) { flags[k] = v; i++; }
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

function loadPlan(file: string | undefined, json = false): Plan {
  if (!file) throw new Error('missing <plan.json>');
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`could not read ${file}: ${(e as Error).message}`);
  }
  const r = validatePlan(input);
  if (!r.ok) {
    if (json) console.log(JSON.stringify({ ok: false, errors: r.errors, warnings: r.warnings }, null, 2));
    else console.error(`✗ ${file} is not a valid plan:\n${formatIssues(r.errors)}`);
    process.exit(2);
  }
  if (r.warnings.length && !json) console.error(`! warnings:\n${formatIssues(r.warnings)}`);
  return r.plan;
}
const stem = (f: string) => basename(f, extname(f)).replace(/\.plan$/, '');
const num = (v: string | true | undefined, d: number) => (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parse(rest);
  const out = typeof flags.o === 'string' ? flags.o : undefined;
  switch (cmd) {
    case 'validate': {
      const plan = loadPlan(pos[0], !!flags.json);
      const secs = plan.sections.reduce((a, s) => a + s.beats, 0) * (60 / plan.music.bpm);
      if (flags.json) console.log(JSON.stringify({ ok: true, errors: [], duration: secs }, null, 2));
      else console.log(`✓ valid — ${plan.sections.length} sections, ${secs.toFixed(2)} s at ${plan.music.bpm} BPM`);
      return;
    }
    case 'html': {
      const plan = loadPlan(pos[0]);
      const file = out ?? `${stem(pos[0])}.html`;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, buildHtml(plan));
      console.log(`✓ wrote ${file}`);
      return;
    }
    case 'stills': {
      const plan = loadPlan(pos[0]);
      const dir = out ?? `out/${stem(pos[0])}-stills`;
      mkdirSync(dir, { recursive: true });
      const reel = await openReel(plan);
      try {
        const times = typeof flags.at === 'string' ? flags.at.split(',').map(Number).filter(x => !Number.isNaN(x)) : autoTimes(reel);
        const blur = num(flags.blur, 1);
        if (flags.sheet || typeof flags.at !== 'string') {
          const png = await reel.page.evaluate(([ts, b]) => window.__reel!.sheet!(ts, 3, b), [times, blur] as const);
          writeFileSync(join(dir, 'sheet.png'), dataUrlToBuffer(png));
        }
        for (const t of times) {
          const png = await reel.page.evaluate(([x, b]) => window.__reel!.still!(x, b), [t, blur] as const);
          writeFileSync(join(dir, `t${t.toFixed(2)}.png`), dataUrlToBuffer(png));
        }
        if (reel.errors.length) console.error(`page errors:\n${reel.errors.join('\n')}`);
        console.log(`✓ ${times.length} stills in ${dir}`);
      } finally {
        await reel.close();
      }
      return;
    }
    case 'render': {
      const plan = loadPlan(pos[0]);
      const file = out ?? `out/${stem(pos[0])}.mp4`;
      const r = await renderVideo(plan, file, {
        crf: num(flags.crf, 18), workers: num(flags.workers, 3), blur: num(flags.blur, 6),
        from: typeof flags.from === 'string' ? Number(flags.from) : undefined, to: typeof flags.to === 'string' ? Number(flags.to) : undefined,
        log: s => process.stderr.write(`\r${s}   `),
      });
      process.stderr.write('\n');
      console.log(`✓ wrote ${file} — ${r.frames} frames in ${r.seconds.toFixed(0)} s`);
      return;
    }
    case 'audio': {
      const plan = loadPlan(pos[0]);
      const file = out ?? `out/${stem(pos[0])}.wav`;
      const reel = await openReel(plan);
      try {
        await renderAudio(reel, file);
      } finally {
        await reel.close();
      }
      console.log(`✓ wrote ${file}`);
      return;
    }
    case 'catalog': {
      if (flags.md) process.stdout.write(catalogMarkdown() + '\n');
      else console.log(JSON.stringify(catalogJson(), null, 2));
      return;
    }
    case 'gallery': {
      const only = typeof flags.only === 'string' ? flags.only.split(',') : undefined;
      const failures = await gallery(out ?? 'out/gallery', !!flags.quick, only);
      if (failures) {
        console.error(`✗ ${failures} technique(s) failed`);
        process.exit(1);
      }
      return;
    }
    default:
      if (cmd && (await runAi(cmd, pos, flags))) return;
      process.stdout.write(HELP);
      if (cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h') process.exit(1);
  }
}

main().catch(e => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
