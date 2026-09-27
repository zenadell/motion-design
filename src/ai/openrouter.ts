import { LLMError, type JsonReply, type JsonRequest, type LLM, type Part } from './llm';

// OpenRouter: one key, hundreds of models (Qwen, GLM, DeepSeek, GPT, Kimi,
// MiniMax, Gemini …) behind an OpenAI-compatible API. Model ids have a
// provider prefix, e.g. "qwen/qwen3.8-max-0902" or "z-ai/glm-5.3-flash";
// that slash is how the CLI tells them from Gemini ids.
//
// OpenRouter passes provider prices through and reports the exact cost of
// every call, so the usage report is exact rather than estimated.

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export function openRouterKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || undefined;
}

export interface OpenRouterOptions {
  model: string;
  apiKey?: string;
  retries?: number;
  /** Seconds before a request is abandoned (long code replies can take minutes). */
  timeout?: number;
  log?: (s: string) => void;
  /** For tests. */
  fetch?: typeof fetch;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Content = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } | { type: 'video_url'; video_url: { url: string } };

/** Our parts → OpenAI-style content blocks. Videos go as data URLs, which OpenRouter forwards to models that take video. */
export function toContent(parts: Part[]): Content[] {
  return parts.map(p =>
    'text' in p ? { type: 'text', text: p.text }
    : 'image' in p ? { type: 'image_url', image_url: { url: `data:${p.image.mime};base64,${p.image.data}` } }
    : { type: 'video_url', video_url: { url: `data:${p.video.mime};base64,${p.video.data}` } },
  );
}

/** The request body for one call (exported for tests). */
export function requestBody(model: string, req: JsonRequest) {
  return {
    model,
    messages: [
      { role: 'system', content: req.system },
      ...req.turns.map(t => ({ role: t.role === 'model' ? 'assistant' : 'user', content: toContent(t.parts) })),
    ],
    response_format: req.schema
      ? { type: 'json_schema', json_schema: { name: 'reply', strict: false, schema: req.schema } }
      : { type: 'json_object' },
    ...(req.effort ? { reasoning: { effort: req.effort } } : {}),
    // only route to hosts that honour the response format
    provider: { require_parameters: true },
    usage: { include: true },
  };
}

interface Completion {
  choices?: { message?: { content?: string | null }; finish_reason?: string; error?: { message?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; cost?: number };
  error?: { message?: string; code?: number | string; metadata?: unknown };
}

export class OpenRouter implements LLM {
  readonly model: string;
  private key: string;
  private retries: number;
  private timeout: number;
  private log: (s: string) => void;
  private doFetch: typeof fetch;

  constructor(o: OpenRouterOptions) {
    const key = o.apiKey ?? openRouterKey();
    if (!key) throw new LLMError('No OpenRouter API key. Set OPENROUTER_API_KEY (create one at https://openrouter.ai/keys).');
    this.key = key;
    this.model = o.model;
    this.retries = o.retries ?? 4;
    this.timeout = (o.timeout ?? 600) * 1000;
    this.log = o.log ?? (() => {});
    this.doFetch = o.fetch ?? fetch;
  }

  async json(req: JsonRequest): Promise<JsonReply> {
    let schema = req.schema;
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      let status: number | undefined;
      let msg = '';
      try {
        const res = await this.doFetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.key}`,
            'content-type': 'application/json',
            'x-title': 'motion-design',
          },
          body: JSON.stringify(requestBody(this.model, { ...req, schema })),
          signal: AbortSignal.timeout(this.timeout),
        });
        status = res.status;
        const raw = await res.text();
        let body: Completion = {};
        try {
          body = JSON.parse(raw) as Completion;
        } catch {
          msg = raw.slice(0, 300);
        }
        if (!res.ok || body.error) {
          status = Number(body.error?.code) || res.status;
          msg = body.error?.message ?? (msg || res.statusText);
          throw new LLMError(`OpenRouter ${status}: ${msg}`, status);
        }
        const choice = body.choices?.[0];
        const text = choice?.message?.content ?? '';
        if (!text.trim()) throw new LLMError(`OpenRouter returned no text (${choice?.error?.message ?? choice?.finish_reason ?? 'empty reply'})`);
        const u = body.usage ?? {};
        const thinking = u.completion_tokens_details?.reasoning_tokens ?? 0;
        return {
          text,
          usage: {
            label: req.label, model: this.model, ms: Date.now() - t0,
            input: u.prompt_tokens ?? 0, output: Math.max(0, (u.completion_tokens ?? 0) - thinking), thinking,
            ...(typeof u.cost === 'number' ? { usd: u.cost } : {}),
          },
        };
      } catch (e) {
        msg ||= (e as Error).message ?? String(e);
        if (status === 402) throw new LLMError('OpenRouter: the account is out of credits (or the key hit its spending limit). Top up at https://openrouter.ai/credits, then run again.', status);
        if (status === 401 || status === 403) throw new LLMError(`OpenRouter rejected the key (${status}): ${msg}`, status);
        // a host that cannot follow the JSON schema: fall back to free-form JSON once
        if (status === 400 && schema && /schema|response_format|structured/i.test(msg)) {
          this.log(`  ${req.label}: ${this.model} rejected the response schema; retrying with free-form JSON`);
          schema = undefined;
          continue;
        }
        const transient = status === undefined || status === 408 || status === 429 || status >= 500 || /no text/.test(msg);
        if (!transient || attempt >= this.retries) throw e instanceof LLMError ? e : new LLMError(`OpenRouter ${status ?? ''} ${msg}`.trim(), status);
        const wait = Math.min(30_000, 2000 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
        this.log(`  ${req.label}: ${status ?? 'network'} error${msg ? ` (${msg.slice(0, 80)})` : ''}, retrying in ${(wait / 1000).toFixed(1)} s`);
        await sleep(wait);
      }
    }
  }
}
