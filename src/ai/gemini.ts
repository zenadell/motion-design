import { ApiError, GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';
import { LLMError, type Effort, type JsonReply, type JsonRequest, type LLM } from './llm';

// Gemini 3.8 Flash (released 2026-09-02) is Google's newest Flash model and
// the default. Override per run with --model or MOTION_MODEL.
export const DEFAULT_MODEL = 'gemini-3.8-flash';

const LEVEL: Record<Effort, ThinkingLevel> = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };

export function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

export interface GeminiOptions {
  model?: string;
  apiKey?: string;
  retries?: number;
  log?: (s: string) => void;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class Gemini implements LLM {
  readonly model: string;
  private ai: GoogleGenAI;
  private retries: number;
  private log: (s: string) => void;

  constructor(o: GeminiOptions = {}) {
    const key = o.apiKey ?? apiKey();
    if (!key) throw new LLMError('No Gemini API key. Set GEMINI_API_KEY (get one at https://aistudio.google.com/apikey).');
    this.ai = new GoogleGenAI({ apiKey: key });
    this.model = o.model ?? process.env.MOTION_MODEL ?? DEFAULT_MODEL;
    this.retries = o.retries ?? 4;
    this.log = o.log ?? (() => {});
  }

  async json(req: JsonRequest): Promise<JsonReply> {
    const contents: Content[] = req.turns.map(t => ({
      role: t.role,
      parts: t.parts.map(p => ('text' in p ? { text: p.text } : { inlineData: { mimeType: p.image.mime, data: p.image.data } })),
    }));
    let thinking = !!req.effort;
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      try {
        const res = await this.ai.models.generateContent({
          model: this.model,
          contents,
          config: {
            systemInstruction: req.system,
            responseMimeType: 'application/json',
            ...(req.schema ? { responseJsonSchema: req.schema } : {}),
            ...(thinking && req.effort ? { thinkingConfig: { thinkingLevel: LEVEL[req.effort] } } : {}),
          },
        });
        const text = res.text ?? '';
        if (!text.trim()) {
          const why = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? 'empty reply';
          throw new LLMError(`Gemini returned no text (${why})`);
        }
        const u = res.usageMetadata ?? {};
        return {
          text,
          usage: {
            label: req.label, model: this.model, ms: Date.now() - t0,
            input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0,
          },
        };
      } catch (e) {
        const status = e instanceof ApiError ? e.status : e instanceof LLMError ? e.status : undefined;
        const msg = (e as Error).message ?? String(e);
        if (status === 400 && thinking && /thinking/i.test(msg)) {
          // an older model without thinking levels: retry once without them
          thinking = false;
          this.log(`  ${req.label}: ${this.model} does not take a thinking level; retrying without it`);
          continue;
        }
        if (status === 400 && req.schema && /schema|response_?json_?schema|too (many|complex)|nesting/i.test(msg))
          throw new LLMError(`Gemini rejected the response schema: ${msg}`, status, true);
        const transient = status === undefined ? !(e instanceof LLMError) || /no text/.test(msg) : status === 429 || status >= 500;
        if (!transient || attempt >= this.retries) throw e instanceof LLMError ? e : new LLMError(`Gemini ${status ?? ''} ${msg}`.trim(), status);
        const wait = Math.min(30_000, 1500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
        this.log(`  ${req.label}: ${status ?? 'network'} error, retrying in ${(wait / 1000).toFixed(1)} s`);
        await sleep(wait);
      }
    }
  }

  /** Models this key can call with generateContent (to pick or verify a model id). */
  async models(): Promise<{ id: string; name: string; input?: number; output?: number }[]> {
    const out: { id: string; name: string; input?: number; output?: number }[] = [];
    const pager = await this.ai.models.list({ config: { pageSize: 100 } });
    for await (const m of pager) {
      if (!m.supportedActions?.includes('generateContent')) continue;
      out.push({ id: (m.name ?? '').replace(/^models\//, ''), name: m.displayName ?? '', input: m.inputTokenLimit, output: m.outputTokenLimit });
    }
    return out;
  }
}
