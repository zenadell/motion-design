import { readFileSync } from 'node:fs';
import type { JsonReply, JsonRequest, LLM } from './llm';

/**
 * Plays back recorded replies instead of calling a model, so the whole
 * pipeline (scrape → plan → review → render) runs in tests and CI without an
 * API key. The file maps a step (the first word of the request label:
 * brand, plan, review, revise) to the replies to give, in order.
 */
export class ReplayLLM implements LLM {
  readonly model = 'replay';
  private queues: Record<string, unknown[]>;
  constructor(file: string) {
    this.queues = JSON.parse(readFileSync(file, 'utf8'));
  }
  async json(req: JsonRequest): Promise<JsonReply> {
    const step = req.label.split(/\s/)[0];
    const q = this.queues[step];
    if (!q?.length) throw new Error(`replay: no reply left for "${req.label}"`);
    const r = q.length > 1 ? q.shift() : q[0];
    return { text: typeof r === 'string' ? r : JSON.stringify(r), usage: { label: req.label, model: this.model, input: 0, output: 0, thinking: 0, ms: 0 } };
  }
}
