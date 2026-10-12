import { LLMError, type JsonReply, type JsonRequest, type LLM } from './llm';
import { adaptTurns, toContent } from './openrouter';

// DeepSeek's own API (OpenAI-compatible): "deepseek-flash" (DeepSeek V4.1 Flash,
// reads text and images) and "deepseek-v4-pro" (text only). Videos become
// evenly spaced still frames for the image model, as on OpenRouter.

export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
export const deepSeekKey = (): string | undefined => process.env.DEEPSEEK_API_KEY || undefined;
export const isDeepSeekId = (id: string | undefined): boolean => !!id && /^deepseek[-:]/.test(id);

const MODALITIES: Record<string, string[]> = { 'deepseek-flash': ['text', 'image'], 'deepseek-v4-pro': ['text'] };

export class DeepSeek implements LLM {
  readonly model: string;
  private key: string;
  private log: (s: string) => void;

  constructor(o: { model: string; apiKey?: string; log?: (s: string) => void }) {
    const key = o.apiKey ?? deepSeekKey();
    if (!key) throw new LLMError('No DeepSeek API key. Set DEEPSEEK_API_KEY (https://platform.deepseek.com/api_keys).');
    this.key = key;
    this.model = o.model.replace(/^deepseek:/, '');
    this.log = o.log ?? (() => {});
  }

  async json(req: JsonRequest): Promise<JsonReply> {
    // 16 frames a clip: enough to see an entrance, a spring and its settle (images are cheap here)
    const turns = await adaptTurns(req.turns, new Set(MODALITIES[this.model] ?? ['text', 'image']), 16);
    // json_object mode: the shape goes in the instructions
    const system = req.schema ? `${req.system}\n\nReply with one JSON object that follows this JSON Schema:\n${JSON.stringify(req.schema).slice(0, 24_000)}` : `${req.system}\n\nReply with JSON only.`;
    const body = {
      model: this.model,
      messages: [{ role: 'system', content: system }, ...turns.map(t => ({ role: t.role === 'model' ? 'assistant' : 'user', content: toContent(t.parts) }))],
      response_format: { type: 'json_object' },
      max_tokens: 64_000,
    };
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      let status = 0, msg = '';
      try {
        const res = await fetch(DEEPSEEK_URL, { method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30 * 60_000) });
        status = res.status;
        if (res.ok) {
          const j = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } };
          const text = j.choices?.[0]?.message?.content ?? '';
          if (!text.trim()) throw new Error(`empty reply (${j.choices?.[0]?.finish_reason ?? 'no reason'})`);
          const u = j.usage ?? {};
          return { text, usage: { label: req.label, model: this.model, input: u.prompt_tokens ?? 0, output: (u.completion_tokens ?? 0) - (u.completion_tokens_details?.reasoning_tokens ?? 0), thinking: u.completion_tokens_details?.reasoning_tokens ?? 0, ms: Date.now() - t0 } };
        }
        msg = (await res.text()).slice(0, 400);
      } catch (e) {
        msg = (e as Error).message;
      }
      const retry = attempt < 4 && (status === 0 || status === 429 || status >= 500 || /empty reply/.test(msg));
      if (!retry) throw new LLMError(`DeepSeek ${status || 'error'}: ${msg}`, status || undefined);
      this.log(`  (deepseek ${status || 'network'}: ${msg.slice(0, 80)} — retrying)`);
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
}
