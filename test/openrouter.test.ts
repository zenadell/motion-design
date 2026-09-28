import { describe, expect, it } from 'vitest';
import { costOf, summarizeUsage, user, video } from '../src/ai/llm';
import { isOpenRouterId } from '../src/ai/models';
import { OpenRouter, requestBody } from '../src/ai/openrouter';

const reply = (content: string, usage: object = { prompt_tokens: 1000, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 200 }, cost: 0.0123 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage }), { status: 200 });

function fake(...responses: (Response | (() => Response))[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = responses.shift();
    if (!r) throw new Error('no more responses');
    return typeof r === 'function' ? r() : r;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('OpenRouter client', () => {
  it('routes provider-prefixed ids to OpenRouter', () => {
    expect(isOpenRouterId('qwen/qwen3.8-max-0902')).toBe(true);
    expect(isOpenRouterId('gemini-3.8-flash')).toBe(false);
    expect(isOpenRouterId(undefined)).toBe(false);
  });

  it('builds an OpenAI-style request with schema, reasoning and media', () => {
    const b = requestBody('z-ai/glm-5.3-flash', {
      label: 'x', system: 'SYS', schema: { type: 'object' }, effort: 'high',
      turns: [user('hi', video(Buffer.from('abc'), 12))],
    });
    expect(b.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(b.messages[1].content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'video_url', video_url: { url: `data:video/mp4;base64,${Buffer.from('abc').toString('base64')}` } },
    ]);
    expect(b.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'reply', strict: false, schema: { type: 'object' } } });
    expect(b.reasoning).toEqual({ effort: 'high' });
    expect(b.provider).toEqual({ require_parameters: true });
  });

  it('returns text and the exact cost OpenRouter reports', async () => {
    const { f, calls } = fake(reply('{"ok":true}'));
    const m = new OpenRouter({ model: 'openai/gpt-6-luna', apiKey: 'k', fetch: f });
    const r = await m.json({ label: 'step', system: 's', turns: [user('q')] });
    expect(r.text).toBe('{"ok":true}');
    expect(r.usage).toMatchObject({ model: 'openai/gpt-6-luna', input: 1000, output: 300, thinking: 200, usd: 0.0123 });
    expect(costOf(r.usage)).toBe(0.0123);
    expect(summarizeUsage([r.usage, r.usage]).usd).toBe(0.0246);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].body.response_format).toEqual({ type: 'json_object' });
  });

  it('retries a busy host, then succeeds', async () => {
    const { f, calls } = fake(new Response(JSON.stringify({ error: { code: 429, message: 'busy' } }), { status: 429 }), reply('{}'));
    const m = new OpenRouter({ model: 'qwen/qwen3.8-flash', apiKey: 'k', fetch: f, retries: 2 });
    const t0 = Date.now();
    const r = await m.json({ label: 'step', system: 's', turns: [user('q')] });
    expect(r.text).toBe('{}');
    expect(calls.length).toBe(2);
    expect(Date.now() - t0).toBeGreaterThan(1000);
  }, 20_000);

  it('stops with a clear message when credits run out', async () => {
    const { f } = fake(new Response(JSON.stringify({ error: { code: 402, message: 'Insufficient credits' } }), { status: 402 }));
    const m = new OpenRouter({ model: 'qwen/qwen3.8-flash', apiKey: 'k', fetch: f });
    await expect(m.json({ label: 'step', system: 's', turns: [user('q')] })).rejects.toThrow(/out of credits/);
  });

  it('falls back to free-form JSON when a host rejects the schema', async () => {
    const { f, calls } = fake(new Response(JSON.stringify({ error: { code: 400, message: 'Invalid schema for response_format' } }), { status: 400 }), reply('{"a":1}'));
    const m = new OpenRouter({ model: 'x/y', apiKey: 'k', fetch: f });
    const r = await m.json({ label: 'step', system: 's', turns: [user('q')], schema: { type: 'object' } });
    expect(r.text).toBe('{"a":1}');
    expect((calls[0].body.response_format as { type: string }).type).toBe('json_schema');
    expect((calls[1].body.response_format as { type: string }).type).toBe('json_object');
  });
});
