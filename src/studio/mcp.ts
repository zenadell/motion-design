import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import STUDIO_DOCS from '../../docs/studio.md?raw';
import { dataUrlToBuffer, openReel, type Reel } from '../cli/browser';
import { ffmpegPath, renderVideo } from '../cli/render';
import { DEMO_BRAND } from '../plan/demo';
import { formatIssues, validatePlan } from '../plan/validate';
import { measureVideo } from './measure';
import { offGridTimes, rhythmOf } from './rhythm';
import { OP_NAMES, applyOps, describe, type Op } from './ops';

// The studio as an MCP server (JSON-RPC 2.0 over stdio, newline-delimited).
// Any agent — Claude Code, Gemini CLI, Codex, a DeepSeek or Gemini loop — opens
// a plan, edits comps with small operations, looks at rendered frames, compares
// them with a reference film, and renders the MP4.

type Json = Record<string, unknown>;
export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export const TOOLS = [
  { name: 'studio_docs', description: 'The comp format (layers, keyframes, eases, camera, mattes, text animators) and the edit operations. Read it once before editing.', inputSchema: { type: 'object', properties: {} } },
  { name: 'studio_open', description: 'Open a plan file to work on, creating an empty one (demo brand, no sections) if it does not exist.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'studio_describe', description: 'One line per section and per layer of the open plan: types, keyed properties and their time ranges, validation errors.', inputSchema: { type: 'object', properties: { comp: { type: 'string', description: 'Only this comp' } } } },
  {
    name: 'studio_apply',
    description: `Edit the open plan with operations, applied in order, all or nothing; the file is saved and validation issues are returned. Ops: ${OP_NAMES.join(', ')}. Example: [{"op":"add_comp","comp":{"id":"hero","units":"beats"}},{"op":"add_layer","comp":"hero","layer":{"id":"title","type":"text","text":"HELLO"}},{"op":"keyframe","comp":"hero","layer":"title","prop":"scale","t":0,"v":0.6},{"op":"keyframe","comp":"hero","layer":"title","prop":"scale","t":1,"v":1,"ease":"outBack"},{"op":"set_sections","sections":[{"technique":"comp:hero","beats":4}]}]`,
    inputSchema: { type: 'object', properties: { ops: { type: 'array', items: { type: 'object' } } }, required: ['ops'] },
  },
  { name: 'studio_frame', description: 'Render the open plan at time t (seconds from the start of the film) and return the frame.', inputSchema: { type: 'object', properties: { t: { type: 'number' } }, required: ['t'] } },
  { name: 'studio_sheet', description: 'Render the open plan at several times (seconds) and return them as one contact sheet, left to right then top to bottom: the cheapest way to review the whole film.', inputSchema: { type: 'object', properties: { times: { type: 'array', items: { type: 'number' } } }, required: ['times'] } },
  { name: 'studio_rhythm', description: 'Measure whether the picture is on the music: every visual hit (cut, landing, flash) against the beat grid, with how many ms off each one is, plus comp times that are off the 16th-note grid. scope "comps" (default, fast) plays only the comp sections; "all" plays the whole film. Fix what is off (or snap the comp) and measure again.', inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['comps', 'all'] } } } },
  {
    name: 'studio_compare',
    description: 'Compare the open plan at time t with a reference video at ref_t (default: t): SSIM (1 = identical) and a side-by-side image (reference left, plan right).',
    inputSchema: { type: 'object', properties: { reference: { type: 'string' }, t: { type: 'number' }, ref_t: { type: 'number' } }, required: ['reference', 't'] },
  },
  {
    name: 'studio_measure',
    description: 'Measure a reference video (no model): finds every moving element, cuts it out, and keyframes its position, scale, opacity or reveal with fitted eases. Adds the comp to the open plan and plays it as the only section. Start here to copy a film; then replace sprites with text or logo layers to adapt it.',
    inputSchema: { type: 'object', properties: { reference: { type: 'string' }, from: { type: 'number' }, to: { type: 'number' }, comp: { type: 'string', description: 'comp id (default "copy")' } }, required: ['reference'] },
  },
  { name: 'studio_render', description: 'Render the open plan to an MP4 (with its soundtrack). Returns the file path.', inputSchema: { type: 'object', properties: { out: { type: 'string' } } } },
];

export function ffmpeg(args: string[], input?: Buffer): Promise<{ out: Buffer; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve({ out: Buffer.concat(out), err }) : reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`))));
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

const jpeg = async (png: Buffer, width = 960) => (await ffmpeg(['-loglevel', 'error', '-i', 'pipe:0', '-vf', `scale=${width}:-2`, '-f', 'mjpeg', '-q:v', '4', 'pipe:1'], png)).out;

export class Session {
  path?: string;
  plan: Json | null = null;
  reel: { key: string; reel: Reel } | null = null;

  open(path: string): string {
    this.path = path;
    if (existsSync(path)) this.plan = JSON.parse(readFileSync(path, 'utf8'));
    else {
      this.plan = { version: 1, meta: { title: 'Studio', hud: false, captions: false }, brand: DEMO_BRAND, music: { bpm: 120 }, sections: [], studio: { comps: [], assets: {} } };
      this.save();
    }
    return describe(this.plan);
  }

  need(): Json {
    if (!this.plan) throw new Error('no plan open: call studio_open first');
    return this.plan;
  }

  save(): void {
    if (this.path && this.plan) writeFileSync(this.path, JSON.stringify(this.plan, null, 1));
  }

  async reelFor(): Promise<Reel> {
    const r = validatePlan(this.need());
    if (!r.ok) throw new Error(`the plan does not validate yet:\n${formatIssues(r.errors)}`);
    const key = JSON.stringify(r.plan);
    if (this.reel?.key === key) return this.reel.reel;
    await this.close();
    const reel = await openReel(r.plan);
    this.reel = { key, reel };
    return reel;
  }

  async still(t: number): Promise<Buffer> {
    const reel = await this.reelFor();
    return dataUrlToBuffer(await reel.page.evaluate(([tt]) => window.__reel!.still!(tt, 1), [t] as const));
  }

  async close(): Promise<void> {
    if (this.reel) await this.reel.reel.close().catch(() => undefined);
    this.reel = null;
  }
}

export async function call(S: Session, name: string, a: Json): Promise<Content[]> {
  const text = (s: string): Content[] => [{ type: 'text', text: s }];
  switch (name) {
    case 'studio_docs':
      return text(STUDIO_DOCS);
    case 'studio_open':
      return text(S.open(String(a.path)));
    case 'studio_describe':
      return text(describe(S.need(), typeof a.comp === 'string' ? a.comp : undefined));
    case 'studio_apply': {
      const r = applyOps(S.need(), (a.ops ?? []) as Op[]);
      if (!r.ok) return text(`✗ ${r.error}\nnothing changed`);
      S.plan = r.plan;
      S.save();
      return text([...r.done.map(d => `✓ ${d}`), ...(r.issues.length ? ['', 'the plan does not validate yet:', formatIssues(r.issues)] : ['', 'plan is valid'])].join('\n'));
    }
    case 'studio_frame': {
      const png = await S.still(Number(a.t));
      return [{ type: 'image', data: (await jpeg(png)).toString('base64'), mimeType: 'image/jpeg' }];
    }
    case 'studio_sheet': {
      const times = ((a.times as number[]) ?? []).slice(0, 12);
      if (!times.length) throw new Error('times: give 1–12 times in seconds');
      const dir = mkdtempSync(join(tmpdir(), 'studio-sheet-'));
      try {
        for (let i = 0; i < times.length; i++) writeFileSync(join(dir, `f${String(i).padStart(2, '0')}.png`), await S.still(Number(times[i])));
        const cols = Math.min(3, times.length), rows = Math.ceil(times.length / cols);
        const sheet = (await ffmpeg(['-loglevel', 'error', '-i', join(dir, 'f%02d.png'), '-vf', `scale=560:-2,tile=${cols}x${rows}:padding=6:color=white`, '-frames:v', '1', '-f', 'mjpeg', '-q:v', '5', 'pipe:1'])).out;
        return [{ type: 'text', text: `contact sheet at t = ${times.join(', ')} s (left to right, top to bottom)` }, { type: 'image', data: sheet.toString('base64'), mimeType: 'image/jpeg' }];
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    case 'studio_rhythm': {
      const reel = await S.reelFor();
      const plan = validatePlan(S.need());
      const bpm = plan.ok ? plan.plan.music.bpm : 120;
      // every frame of the chosen sections (one frame before each, for the change into it), across a few pages
      const f = reel.fps, n = Math.round(reel.duration * f);
      const wanted = a.scope === 'all' ? reel.sections : reel.sections.filter(sec => /^(comp|scene):/.test(sec.technique));
      const ranges = (wanted.length ? wanted : reel.sections).map(sec => [Math.max(0, Math.round(sec.start * f) - 1), Math.min(n, Math.round(sec.end * f))] as [number, number]);
      const jobs: [number, number][] = [];
      for (const [x, y] of ranges) for (let c = x; c < y; c += 60) jobs.push([c, Math.min(y, c + 60)]);
      const pages = [reel.page, ...(await Promise.all(Array.from({ length: Math.min(3, jobs.length - 1) }, () => reel.open())))];
      const results: { t: number; coverage: number; motion: number }[][] = [];
      let next = 0;
      await Promise.all(pages.map(async pg => {
        for (let j; (j = next++) < jobs.length; ) {
          const [x, y] = jobs[j];
          results[j] = await pg.evaluate(([xx, yy, ff]) => window.__reel!.metrics!(xx / ff, yy / ff, 1 / ff), [x, y, f] as const);
        }
      }));
      await Promise.all(pages.slice(1).map(pg => pg.context().close()));
      // each job's first frame has no frame before it in that job: drop it (the job before covers it)
      const byFrame = new Map<number, { t: number; coverage: number; motion: number }>();
      jobs.forEach(([x], j) => results[j].forEach((r, i) => { if (i > 0) byFrame.set(x + i, r); }));
      const series = [...byFrame.entries()].sort((p, q) => p[0] - q[0]).map(([, r]) => r);
      const r = rhythmOf(series, bpm, reel.fps, reel.sections.map(s => ({ start: s.start, end: s.end, technique: s.technique })));
      const statics = ((plan.ok ? plan.plan.studio?.comps : []) ?? []).flatMap(c => offGridTimes(c as unknown as Json, 60 / bpm).map(x => `  comp ${c.id}: ${x}`));
      return text([r.text, statics.length ? `comp times off the 16th grid (${statics.length}; the snap op fixes them all):\n${statics.slice(0, 20).join('\n')}` : 'comp times: all on the 16th grid'].join('\n'));
    }
    case 'studio_compare': {
      const ref = String(a.reference), t = Number(a.t), rt = a.ref_t === undefined ? t : Number(a.ref_t);
      const dir = mkdtempSync(join(tmpdir(), 'studio-cmp-'));
      try {
        const mine = join(dir, 'plan.png'), theirs = join(dir, 'ref.png');
        writeFileSync(mine, await S.still(t));
        await ffmpeg(['-loglevel', 'error', '-y', '-ss', rt.toFixed(3), '-i', ref, '-frames:v', '1', '-vf', 'scale=1920:1080', theirs]);
        const { err } = await ffmpeg(['-i', theirs, '-i', mine, '-lavfi', '[0:v]scale=512:288,setsar=1[a];[1:v]scale=512:288,setsar=1[b];[b][a]ssim', '-f', 'null', '-']);
        const ssim = err.match(/All:([\d.]+)/)?.[1];
        const side = (await ffmpeg(['-loglevel', 'error', '-i', theirs, '-i', mine, '-filter_complex', '[0:v]scale=960:540[a];[1:v]scale=960:540[b];[a][b]hstack=inputs=2', '-f', 'mjpeg', '-q:v', '4', 'pipe:1'])).out;
        return [{ type: 'text', text: `SSIM ${ssim ?? 'n/a'} at t=${t} (reference ${rt}); left = reference, right = plan` }, { type: 'image', data: side.toString('base64'), mimeType: 'image/jpeg' }];
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    case 'studio_measure': {
      const m = await measureVideo(String(a.reference), { from: a.from as number | undefined, to: a.to as number | undefined, id: typeof a.comp === 'string' ? a.comp : 'copy' });
      const plan = S.need();
      const ops: Op[] = [
        ...(((plan.studio as Json | undefined)?.comps as Json[] | undefined)?.some(c => c.id === m.comp.id) ? [{ op: 'remove_comp', comp: m.comp.id } as Op] : []),
        { op: 'add_comp', comp: m.comp as unknown as Json },
        ...Object.entries(m.assets).map(([id, data]): Op => ({ op: 'add_asset', id, data })),
        { op: 'set_sections', sections: [{ technique: `comp:${m.comp.id}`, beats: Math.round(m.duration * 2 * 1000) / 1000, energy: 0 }] },
        { op: 'set', path: 'music.bpm', value: 120 },
      ];
      const r = applyOps(plan, ops);
      if (!r.ok) throw new Error(r.error);
      S.plan = r.plan;
      S.save();
      return text(`${m.report}\n\ncomp "${m.comp.id}" added and set as the only section (120 BPM, so 1 s = 2 beats).`);
    }
    case 'studio_render': {
      const r = validatePlan(S.need());
      if (!r.ok) throw new Error(`the plan does not validate yet:\n${formatIssues(r.errors)}`);
      const out = typeof a.out === 'string' ? a.out : (S.path ?? 'studio.json').replace(/(\.plan)?\.json$/, '') + '.mp4';
      const res = await renderVideo(r.plan, out, { crf: 18, workers: 3, blur: 4 });
      return text(`✓ ${out} — ${res.frames} frames in ${res.seconds.toFixed(0)} s`);
    }
  }
  throw Object.assign(new Error(`unknown tool "${name}"`), { code: -32602 });
}

export async function serveMcp(path?: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  // stdout carries the protocol; everything else goes to stderr
  if (output === process.stdout) console.log = (...a: unknown[]) => console.error(...a);
  const S = new Session();
  if (path) S.open(path);
  const send = (m: Json) => output.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: { id?: number | string; method?: string; params?: Json };
    try {
      msg = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    if (msg.id === undefined || msg.id === null) continue; // a notification
    try {
      let result: unknown;
      switch (msg.method) {
        case 'initialize':
          result = {
            protocolVersion: (msg.params?.protocolVersion as string) ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'motion-studio', version: '0.1.0' },
            instructions: 'A motion design studio. Call studio_docs once, studio_open a plan, then edit with studio_apply, look with studio_frame / studio_compare, and finish with studio_render. To copy a film, studio_measure it first.',
          };
          break;
        case 'ping':
          result = {};
          break;
        case 'tools/list':
          result = { tools: TOOLS };
          break;
        case 'tools/call': {
          const p = msg.params ?? {};
          try {
            result = { content: await call(S, String(p.name), (p.arguments ?? {}) as Json) };
          } catch (e) {
            if ((e as { code?: number }).code === -32602) throw e;
            result = { content: [{ type: 'text', text: `✗ ${(e as Error).message}` }], isError: true };
          }
          break;
        }
        default:
          throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
      }
      send({ id: msg.id, result });
    } catch (e) {
      send({ id: msg.id, error: { code: (e as { code?: number }).code ?? -32603, message: (e as Error).message } });
    }
  }
  await S.close();
}
