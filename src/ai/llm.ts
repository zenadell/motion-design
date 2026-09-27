// The one interface the pipeline talks to. Gemini is the default provider,
// OpenRouter reaches most other models (see models.ts); anything that can
// return JSON (another API, a local model, a test fake) can implement it.

export type Part = { text: string } | { image: { mime: string; data: string } } | { video: { mime: string; data: string; fps?: number } };

export interface Turn {
  role: 'user' | 'model';
  parts: Part[];
}

export type Effort = 'low' | 'medium' | 'high';

export interface JsonRequest {
  /** What the call is for; shows up in logs and the usage report. */
  label: string;
  system: string;
  turns: Turn[];
  /** JSON Schema (Gemini subset) the reply must follow. Omit for free-form JSON. */
  schema?: object;
  effort?: Effort;
}

export interface Usage {
  label: string;
  model: string;
  input: number;
  output: number;
  thinking: number;
  ms: number;
  /** Exact cost when the provider reports it (OpenRouter does); otherwise estimated from PRICES. */
  usd?: number;
}

export interface JsonReply {
  text: string;
  usage: Usage;
}

export interface LLM {
  readonly model: string;
  json(req: JsonRequest): Promise<JsonReply>;
}

export class LLMError extends Error {
  constructor(message: string, readonly status?: number, readonly schemaRejected = false) {
    super(message);
  }
}

export const text = (t: string): Part => ({ text: t });
export const image = (data: Buffer, mime = 'image/png'): Part => ({ image: { mime, data: data.toString('base64') } });
/** A short video clip; `fps` is how many frames per second the model samples (default 1, max 24). */
export const video = (data: Buffer, fps = 10, mime = 'video/mp4'): Part => ({ video: { mime, data: data.toString('base64'), fps } });
export const user = (...parts: (Part | string)[]): Turn => ({ role: 'user', parts: parts.map(p => (typeof p === 'string' ? text(p) : p)) });
export const model = (t: string): Turn => ({ role: 'model', parts: [text(t)] });

/**
 * Pull the first JSON value out of a reply. Structured output returns bare
 * JSON, but a fallback call (or another provider) may wrap it in a fence or
 * add a sentence around it.
 */
export function parseJson<T = unknown>(raw: string): T {
  const s = raw.trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    /* fall through */
  }
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]) as T;
    } catch {
      /* fall through */
    }
  }
  const start = s.search(/[[{]/);
  if (start >= 0) {
    const open = s[start], close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) return JSON.parse(s.slice(start, i + 1)) as T;
    }
  }
  throw new Error(`reply is not JSON: ${s.slice(0, 200)}${s.length > 200 ? '…' : ''}`);
}

// ── Cost ────────────────────────────────────────────────────────────────────
// USD per 1M tokens (input, output; thinking bills as output). Used only for
// the report; unknown models report tokens without a price.
export const PRICES: Record<string, { input: number; output: number; note?: string }> = {
  'gemini-3.8-flash': { input: 0.75, output: 3.75, note: 'introductory price until 2026-12-31, then $1.50 / $7.50' },
  'gemini-3.7-flash': { input: 0.75, output: 3.75, note: 'introductory price until 2026-12-31, then $1.50 / $7.50' },
  'gemini-3.6-flash': { input: 0.75, output: 3.75, note: 'introductory price until 2026-12-31, then $1.50 / $7.50' },
  'gemini-3.5-flash': { input: 1.5, output: 9 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.1-pro': { input: 2, output: 12, note: 'up to 200k-token prompts' },
};

export function priceOf(modelId: string) {
  const id = modelId.replace(/^models\//, '');
  return PRICES[id] ?? PRICES[Object.keys(PRICES).find(k => id.startsWith(k)) ?? ''];
}

export function costOf(u: Usage): number | undefined {
  if (typeof u.usd === 'number') return u.usd;
  const p = priceOf(u.model);
  return p ? (u.input * p.input + (u.output + u.thinking) * p.output) / 1e6 : undefined;
}

export function summarizeUsage(list: Usage[]) {
  const sum = (k: 'input' | 'output' | 'thinking' | 'ms') => list.reduce((a, u) => a + u[k], 0);
  const costs = list.map(costOf);
  const known = costs.every(c => c !== undefined);
  return {
    calls: list.length,
    input: sum('input'),
    output: sum('output'),
    thinking: sum('thinking'),
    seconds: Math.round(sum('ms') / 100) / 10,
    usd: known ? Math.round(costs.reduce((a, c) => a! + c!, 0)! * 10000) / 10000 : undefined,
    byStep: list.map(u => ({ step: u.label, model: u.model, input: u.input, output: u.output + u.thinking, usd: costOf(u) })),
  };
}
