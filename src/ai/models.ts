import { DeepSeek, isDeepSeekId } from './deepseek';
import { Gemini } from './gemini';
import type { LLM } from './llm';
import { OpenRouter } from './openrouter';

/**
 * A model by id. Ids with a provider prefix ("qwen/qwen3.8-max-0902",
 * "z-ai/glm-5.3-flash", "openai/gpt-6-luna", "google/gemini-3.8-flash") go
 * through OpenRouter; bare ids ("gemini-3.8-flash") go to Gemini directly.
 */
export function llmFor(id: string | undefined, log?: (s: string) => void): LLM {
  if (isDeepSeekId(id)) return new DeepSeek({ model: id!, log });
  if (id?.includes('/')) return new OpenRouter({ model: id, log });
  return new Gemini({ model: id, log });
}

export const isOpenRouterId = (id: string | undefined) => !!id?.includes('/');
