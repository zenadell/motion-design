import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import CRAFT from '../../docs/motion-craft.md?raw';
import STUDIO_DOCS from '../../docs/studio.md?raw';
import { factCorpus, type BrandKit } from '../ai/brand-kit';
import { lintPlan } from '../ai/lint';
import { formatIssues, validatePlan } from '../plan/validate';
import type { Plan } from '../plan/schema';
import { catalogMarkdown } from '../cli/catalog';
import { videoDuration } from '../ai/replicate';
import { call, ffmpeg, Session, TOOLS, type Content } from './mcp';
import { applyOps, describe } from './ops';

// `motion studio direct`: a model drives the studio itself. It builds comps
// with the edit operations, renders contact sheets of its own film, looks at
// them, and fixes what it sees, until it calls finish. Any OpenAI-compatible
// chat model with tool calling works; DeepSeek's own API and OpenRouter are built in.
// With a reference film, the studio measures it first and the model refines
// the measured copy against it (studio_compare).

export interface Endpoint { url: string; key: string; model: string; label: string }

/** "deepseek-flash" / "deepseek-v4-pro" → DeepSeek's API; "provider/model" → OpenRouter. */
export function endpointFor(model: string): Endpoint {
  if (model.includes('/')) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('set OPENROUTER_API_KEY for provider/model ids');
    return { url: 'https://openrouter.ai/api/v1/chat/completions', key, model, label: `openrouter:${model}` };
  }
  if (model.startsWith('deepseek')) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error('set DEEPSEEK_API_KEY (https://platform.deepseek.com/api_keys)');
    return { url: 'https://api.deepseek.com/chat/completions', key, model, label: `deepseek:${model}` };
  }
  throw new Error(`no endpoint for model "${model}": use deepseek-flash, deepseek-v4-pro, or a provider/model id (OpenRouter)`);
}

type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: unknown; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string };
interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
interface Usage { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number }

async function chat(ep: Endpoint, messages: Msg[], tools: unknown[], log: (s: string) => void): Promise<{ message: Msg; usage?: Usage }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ep.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ep.model, messages, tools, tool_choice: 'auto', max_tokens: 32000 }),
      signal: AbortSignal.timeout(15 * 60_000),
    }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
    if (res.ok) {
      const j = (await res.json()) as { choices: { message: Msg }[]; usage?: Usage };
      return { message: j.choices[0].message, usage: j.usage };
    }
    const body = await res.text();
    if (attempt < 3 && (res.status === 0 || res.status === 429 || res.status >= 500)) {
      log(`  (${ep.label} ${res.status || 'network'}: retrying)`);
      await new Promise(r => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${ep.label} ${res.status}: ${body.slice(0, 400)}`);
  }
}

const SYSTEM = (reference: boolean) => `You are a world-class motion designer at the controls of a motion design studio. You never write a plan by hand: you operate the studio through tools, look at what you made, and fix it.

How you work:
1. Decide the film: one strong idea, an energy curve (hook → build → peak → breath → logo), the beats of every shot. Say it in a few lines first. Use the brand's facts: each kind of fact has a set piece that shows it best: locations → dot-globe (hq = the home country, cities = the places served), work (projects, clients) → montage, stats → stat-odometer, services → particle-morph or word-cuts, the website → exploded-ui. Use the real names and numbers from the facts.
2. Build it with studio_apply (comps, layers, keyframes, eases, camera, sounds, and the plan's sections). Prefer several short comps (2–4 s each, units "beats") joined by transitions, plus library techniques where they are the best tool.
3. Look: studio_sheet at the key moments of every shot (entrances mid-way, settled holds, exits). Judge it like a creative director: composition, hierarchy, legibility, contrast, empty or dead frames, things off screen or overlapping, timing.
4. Fix what you saw with studio_apply, and look again. Repeat until it is genuinely excellent.
5. Rhythm: the picture must be on the music. Put every time in a comp on the 16th-note grid (multiples of 0.25 beats): keyframes, animator start, exit start, sounds, hits, in/out. Entrances start on a beat or an 8th, impacts land on beats, and every impact has a sound and a hit. Then run the snap op on every comp and studio_rhythm, and fix anything it reports as off. Aim for 100 %.
6. Call finish with a short summary.

Rules: only use facts from the brand and brief. Text stays inside the 90-px safe area and is never cut off. Use brand colour roles (bg, text, primary, accent…) and font roles. Every frame is a poster. Batch many operations per studio_apply call.${reference ? `

This job is a copy: a reference film was measured into the comp "copy" (sprites cut from the reference, with measured motion). Compare the copy with the reference at many moments (studio_compare), and fix what differs: missing or wrong elements (replace sprites with text, shape, logo, technique or code layers), timing, positions, colours. The goal is a frame-accurate copy.` : ''}

${STUDIO_DOCS}

# Library techniques (usable as sections, or as "technique" layers inside comps)
${catalogMarkdown().slice(0, 30_000)}

${CRAFT}`;

export interface DirectOptions {
  model: string;
  out: string;
  kit: BrandKit;
  brief: string;
  seconds?: number;
  reference?: string;
  /** An existing plan to improve instead of starting empty. */
  plan?: unknown;
  maxSteps?: number;
  /** Quantise every comp to the 16th-note grid before finishing (default true). */
  snap?: boolean;
  log?: (s: string) => void;
}

export interface DirectResult { plan?: Plan; steps: number; usage: { input: number; output: number; cached: number; calls: number }; summary: string }

/**
 * The fact gate: names and numbers the film states that are not in the brand's
 * facts or the brief (the planner's fact check, plus numbers in comp text).
 */
export function factIssues(plan: unknown, kit: BrandKit, brief: string): string[] {
  const v = validatePlan(plan);
  if (!v.ok) return v.errors.map(e => `${e.path}: ${e.message}`);
  const corpus = factCorpus(kit, brief);
  const out = lintPlan(v.plan, { corpus }).filter(i => i.severity === 'error' && /not in the brief or the brand facts/.test(i.message)).map(i => `${i.path}: ${i.message}`);
  const allowed = new Set([String(v.plan.music.bpm), String(new Date().getFullYear())]);
  const walk = (layers: { type: string; id: string; text?: string; layers?: unknown[] }[], at: string) =>
    layers.forEach((l, i) => {
      if (l.type === 'text' && l.text)
        for (const m of l.text.match(/\d+(?:[.,]\d+)*/g) ?? []) {
          const found = new RegExp(`(^|[^\\d])${m.replace(/[.,]/g, '[.,]')}($|[^\\d])`).test(corpus);
          if (!found && !allowed.has(m)) out.push(`${at}[${i}].text: "${m}" in "${l.text}" is not in the brief or the brand facts`);
        }
      if (l.layers) walk(l.layers as never, `${at}[${i}].layers`);
    });
  (v.plan.studio?.comps ?? []).forEach((c, ci) => walk(c.layers as never, `studio.comps[${ci}].layers`));
  return out;
}

const AGENT_TOOLS = ['studio_describe', 'studio_apply', 'studio_frame', 'studio_sheet', 'studio_rhythm', 'studio_compare', 'studio_measure'];

export async function direct(o: DirectOptions): Promise<DirectResult> {
  const log = o.log ?? (() => undefined);
  const ep = endpointFor(o.model);
  const S = new Session();
  const file = join(o.out, 'plan.json');
  S.open(file);
  const first = o.plan
    ? applyOps(o.plan, [{ op: 'set', path: 'brand', value: o.kit.brand }])
    : applyOps(S.need(), [{ op: 'set', path: 'brand', value: o.kit.brand }, { op: 'set', path: 'meta', value: { title: 'Studio film', fps: 30, hud: false, captions: false, grain: 0.05 } }]);
  if (!first.ok) throw new Error(first.error);
  S.plan = first.plan;
  S.save();
  const tools = [
    ...TOOLS.filter(t => AGENT_TOOLS.includes(t.name) && (o.reference || !['studio_compare', 'studio_measure'].includes(t.name))).map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
    { type: 'function', function: { name: 'finish', description: 'The film is done and excellent. Give a short summary.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } } },
  ];
  const messages: Msg[] = [{ role: 'system', content: SYSTEM(!!o.reference) }];
  let intro = `BRAND\n${JSON.stringify(o.kit.brand)}\nFACTS\n${JSON.stringify(o.kit.facts)}\n\nBRIEF\n${o.brief}\n\nLength: about ${o.seconds ?? 20} s at ${120} BPM (1 beat = 0.5 s). ${o.plan ? `A first version of this film is open. Review it like a demanding creative director (studio_describe, studio_sheet over the whole film, studio_rhythm with scope "all"), then make it excellent: fix every weak frame, every off-beat moment, and anything the brand's facts deserve that the film is missing.\n\n${describe(S.need())}` : 'The plan is open and empty; build it.'}`;
  const pics: Content[] = [];
  if (o.reference) {
    const m = await call(S, 'studio_measure', { reference: o.reference, comp: 'copy' });
    intro = `BRAND (only if the brief asks to adapt)\n${JSON.stringify(o.kit.brand)}\n\nBRIEF\n${o.brief || 'Copy the reference film as exactly as possible.'}\n\nReference: ${o.reference}\n${(m[0] as { text: string }).text}\n\nThe measured copy is open as the plan. Below: the reference itself at evenly spaced moments.`;
    // the reference at a glance: 12 evenly spaced frames (a model that reads images sees the film)
    const dur = await videoDuration(o.reference);
    const sheet = (await ffmpeg(['-loglevel', 'error', '-i', o.reference, '-vf', `fps=${(12 / dur).toFixed(4)},scale=560:-2,tile=3x4:padding=6:color=white`, '-frames:v', '1', '-f', 'mjpeg', '-q:v', '5', 'pipe:1'])).out;
    intro += `\n(12 frames, every ${(dur / 12).toFixed(2)} s from ${(dur / 24).toFixed(2)} s, left to right, top to bottom)`;
    pics.push({ type: 'image', data: sheet.toString('base64'), mimeType: 'image/jpeg' });
  }
  messages.push({ role: 'user', content: [{ type: 'text', text: intro }, ...pics.filter(p => p.type === 'image').map(p => ({ type: 'image_url', image_url: { url: `data:${(p as { mimeType: string }).mimeType};base64,${(p as { data: string }).data}` } }))] });
  const usage = { input: 0, output: 0, cached: 0, calls: 0 };
  let summary = '', steps = 0, nudges = 0, gates = 0;
  const transcript: unknown[] = [];
  for (; steps < (o.maxSteps ?? 40); steps++) {
    const { message, usage: u } = await chat(ep, messages, tools, log);
    usage.calls++;
    usage.input += u?.prompt_tokens ?? 0;
    usage.output += u?.completion_tokens ?? 0;
    usage.cached += u?.prompt_cache_hit_tokens ?? 0;
    const said = typeof message.content === 'string' ? message.content.trim() : '';
    if (said) log(`\n${said.slice(0, 1200)}`);
    messages.push({ role: 'assistant', content: message.content ?? '', ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}), ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}) });
    transcript.push({ step: steps, said, calls: message.tool_calls?.map(c => ({ name: c.function.name, args: c.function.arguments.slice(0, 4000) })) });
    if (!message.tool_calls?.length) {
      if (++nudges > 2) break;
      messages.push({ role: 'user', content: 'Keep going with the tools. Call finish only when the film is excellent.' });
      continue;
    }
    const images: Content[] = [];
    let done = false;
    for (const tc of message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: '✗ the arguments are not valid JSON' });
        continue;
      }
      if (tc.function.name === 'finish') {
        const facts = o.reference ? [] : factIssues(S.need(), o.kit, o.brief);
        if (facts.length && gates++ < 2) {
          log(`  · finish → refused: ${facts.length} fact issue(s)`);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: `✗ not finished: the fact check found things the brand's facts and the brief do not say. Fix them (use only stated facts; drop or replace the rest), then call finish again:\n${facts.slice(0, 15).join('\n')}` });
          continue;
        }
        summary = String(args.summary ?? '');
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'ok' });
        done = true;
        continue;
      }
      let out: Content[];
      try {
        out = await call(S, tc.function.name, args);
      } catch (e) {
        out = [{ type: 'text', text: `✗ ${(e as Error).message}` }];
      }
      const text = out.filter(c => c.type === 'text').map(c => (c as { text: string }).text).join('\n');
      const img = out.filter(c => c.type === 'image');
      images.push(...img);
      log(`  · ${tc.function.name} → ${(text.split('\n')[0] + (text.includes('\n') ? ' … ' + text.split('\n').filter(Boolean).slice(-1)[0] : '')).slice(0, 220)}`);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: (text || 'ok') + (img.length ? `\n(${img.length} image${img.length > 1 ? 's' : ''} in the next message)` : '') });
    }
    if (images.length) {
      // keep the context lean: earlier images become a note, only the newest ones stay
      for (const m of messages) if (m.role === 'user' && Array.isArray(m.content) && m !== messages[1]) m.content = (m.content as { type: string }[]).map(p => (p.type === 'image_url' ? { type: 'text', text: '(an earlier image, omitted)' } : p));
      messages.push({ role: 'user', content: [{ type: 'text', text: 'Images from the tools above:' }, ...images.map(c => ({ type: 'image_url', image_url: { url: `data:${(c as { mimeType: string }).mimeType};base64,${(c as { data: string }).data}` } }))] });
    }
    writeFileSync(join(o.out, 'agent-log.json'), JSON.stringify({ model: ep.label, usage, transcript }, null, 1));
    if (done) break;
  }
  if (o.snap !== false) {
    // the safety net: every comp on the 16th-note grid, whatever the model left
    const comps = ((S.need().studio as { comps?: { id: string }[] } | undefined)?.comps ?? []).map(c => c.id);
    const r = applyOps(S.need(), comps.map(id => ({ op: 'snap' as const, comp: id })));
    if (r.ok) {
      S.plan = r.plan;
      S.save();
      log(`  · snap → ${r.done.join(' | ')}`);
    }
  }
  await S.close();
  const v = validatePlan(S.need());
  if (!v.ok) log(`! the final plan does not validate:\n${formatIssues(v.errors)}`);
  writeFileSync(join(o.out, 'agent-log.json'), JSON.stringify({ model: ep.label, usage, summary, final: describe(S.need()), transcript }, null, 1));
  return { plan: v.ok ? v.plan : undefined, steps, usage, summary };
}
