import { describe, expect, it } from 'vitest';
import { BrandKitSchema, loadBrandKit } from '../src/ai/brand-kit';
import { fitDuration, lintPlan, totalBeats } from '../src/ai/lint';
import { LLMError, parseJson, summarizeUsage, type JsonRequest, type JsonReply, type LLM } from '../src/ai/llm';
import { assemble, Planner, targetOf } from '../src/ai/planner';
import { plannerSystem, plannerUser } from '../src/ai/prompts';
import { plannerSchema, toGeminiSchema } from '../src/ai/schema';
import { TECHNIQUES } from '../src/engine/techniques';
import { DEMO_BRAND } from '../src/plan/demo';
import { validatePlan } from '../src/plan/validate';

/** Replays canned replies and records every request. */
class FakeLLM implements LLM {
  readonly model = 'gemini-3.8-flash';
  requests: JsonRequest[] = [];
  constructor(private replies: (string | Error)[]) {}
  async json(req: JsonRequest): Promise<JsonReply> {
    this.requests.push(structuredClone(req));
    const r = this.replies.shift();
    if (r === undefined) throw new Error('FakeLLM: out of replies');
    if (r instanceof Error) throw r;
    return { text: r, usage: { label: req.label, model: this.model, input: 20_000, output: 2_000, thinking: 3_000, ms: 10 } };
  }
}

const KIT = BrandKitSchema.parse({
  brand: DEMO_BRAND,
  facts: {
    headline: 'Design and engineering for ambitious teams',
    services: ['Product design', 'Web apps', 'AI features'],
    work: ['Atlas', 'Beacon'],
    stats: [{ value: '120+', label: 'products shipped' }],
    locations: ['Lisbon', 'Berlin'],
  },
});

const GOOD: { concept: string; title: string; music: { bpm: number; genre: string; progression: string[] }; sections: any[] } = {
  concept: 'A fast type-led opener that lands on the Northwind lockup.',
  title: 'Showreel',
  music: { bpm: 120, genre: 'electro', progression: ['Am', 'F', 'C', 'G'] },
  sections: [
    { technique: 'blade-open', beats: 0.5 },
    { technique: 'word-cuts', beats: 1.5, params: { words: ['WE', 'DESIGN', 'PRODUCTS'] } },
    { technique: 'glitch-word', beats: 2, params: { word: 'SOFTWARE' }, transition: 'blade' },
    { technique: 'montage', beats: 2, params: { items: [{ title: 'ATLAS' }, { title: 'BEACON' }] } },
    { technique: 'stat-odometer', beats: 2, params: { value: '120+', label: 'products shipped' }, energy: 3 },
    { technique: 'logo-build', beats: 4 },
    { technique: 'end-card', beats: 8 },
  ],
};

describe('parseJson', () => {
  it('reads bare, fenced and wrapped JSON', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
    expect(parseJson('Here you go: {"a":"}{"} — enjoy')).toEqual({ a: '}{' });
    expect(() => parseJson('no json here')).toThrow(/not JSON/);
  });
});

describe('Gemini schema', () => {
  const bad = new Set(['$schema', 'pattern', 'default', 'maxLength', 'minLength', 'propertyNames', 'additionalProperties', 'const', '$ref', '$defs']);
  const keys = (o: unknown, acc = new Set<string>()): Set<string> => {
    if (Array.isArray(o)) o.forEach(x => keys(x, acc));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k !== 'properties') acc.add(k); keys(v, acc); }
    return acc;
  };
  it('keeps only the supported subset and moves limits into descriptions', () => {
    const s = toGeminiSchema({ type: 'object', properties: { w: { type: 'string', maxLength: 12, default: 'HI' } }, required: ['w'], additionalProperties: false, $schema: 'x' });
    expect(s).toEqual({ type: 'object', properties: { w: { type: 'string', description: '(at most 12 characters; default "HI")' } } });
  });
  it('has one branch per technique with typed params', () => {
    const s = plannerSchema(true) as any;
    const branches = s.properties.sections.items.anyOf;
    expect(branches).toHaveLength(TECHNIQUES.length);
    expect(branches.map((b: any) => b.properties.technique.enum[0])).toEqual(TECHNIQUES.map(t => t.id));
    for (const k of keys(s)) expect(bad.has(k), `unsupported keyword ${k}`).toBe(false);
    const pm = branches.find((b: any) => b.properties.technique.enum[0] === 'particle-morph');
    expect(pm.required).toContain('params');
    expect(pm.properties.params.properties.items.items.properties.icon.enum).toContain('rocket');
    expect(JSON.stringify(s)).not.toContain('"items":false');
  });
  it('has a loose fallback', () => {
    const s = plannerSchema(false) as any;
    expect(s.properties.sections.items.properties.technique.enum).toHaveLength(TECHNIQUES.length);
  });
});

describe('prompts', () => {
  it('carries the guide, the catalog and the reference plan', () => {
    const p = plannerSystem();
    expect(p).toContain('Continuity pairs');
    expect(p).toContain('### `particle-morph`');
    expect(p).toContain('Reference plan');
    expect(p.length).toBeLessThan(80_000);
  });
  it('states the target and only non-empty facts', () => {
    const u = plannerUser('Launch video for our new app', KIT, targetOf({ seconds: 20, bpm: 120 }));
    expect(u).toContain('exactly 40 beats');
    expect(u).toContain('"work"');
    expect(u).not.toContain('"audience"');
    expect(u).toContain('monogram "N"');
  });
});

describe('lint', () => {
  it('fits small length errors on flexible sections', () => {
    const s = structuredClone(GOOD.sections);
    expect(totalBeats(s)).toBe(20);
    expect(fitDuration(s, 22)).toBe(true);
    expect(totalBeats(s)).toBe(22);
    expect(s[6].beats).toBe(10); // the end card absorbed it
    expect(fitDuration(structuredClone(GOOD.sections), 40)).toBe(false); // too far: needs new sections
  });
  it('flags invented facts, a weak opening and a missing outro', () => {
    const r = validatePlan({
      brand: DEMO_BRAND,
      sections: [
        { technique: 'logo-build', beats: 4 },
        { technique: 'stat-odometer', beats: 2, params: { value: '98%', label: 'client retention' } },
        { technique: 'dot-globe', beats: 8, params: { hq: { name: 'LISBON', lat: 38.7, lon: -9.1 }, cities: [{ name: 'TOKYO', lat: 35.7, lon: 139.7 }], headline: ['Based in', 'Lisbon.'] } },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const issues = lintPlan(r.plan, { targetBeats: 14, corpus: 'lisbon berlin 120+ products shipped' });
    const msgs = issues.map(i => `${i.path}: ${i.message}`).join('\n');
    expect(msgs).toContain('sections[0]: open with a hook');
    expect(msgs).toContain('end on end-card');
    expect(msgs).toContain('"98" is not in the brief');
    expect(msgs).toContain('cities[0].name: "TOKYO"');
    expect(msgs).not.toContain('LISBON');
  });
});

describe('planner', () => {
  it('injects the brand, pins the tempo and drops bad chords', () => {
    const input = assemble({ ...GOOD, music: { bpm: 90, genre: 'electro', progression: ['Am', 'H#7'] } }, KIT, targetOf({ seconds: 10, bpm: 120 }));
    expect(input.brand.name).toBe('Northwind');
    expect(input.music).toEqual({ bpm: 120, genre: 'electro', progression: ['Am'] });
  });

  it('repairs its own plan from validator feedback', async () => {
    const broken = structuredClone(GOOD) as any;
    broken.sections[2].technique = 'glitch-wrd';
    const llm = new FakeLLM([JSON.stringify(broken), JSON.stringify(GOOD)]);
    const res = await new Planner(llm, { brief: 'A showreel', kit: KIT, seconds: 10 }).draft();
    expect(res.rounds.map(r => r.issues.length)).toEqual([1, 0]);
    expect(res.plan.sections[2].technique).toBe('glitch-word');
    expect(res.concept).toMatch(/type-led/);
    const repair = llm.requests[1].turns.at(-1)!.parts[0] as { text: string };
    expect(repair.text).toContain('did you mean "glitch-word"');
    expect(llm.requests[1].turns.map(t => t.role)).toEqual(['user', 'model', 'user']);
    expect(summarizeUsage(res.usage).usd).toBeCloseTo(2 * (20_000 * 0.75 + 5_000 * 3.75) / 1e6, 6);
  });

  it('sends invented facts back for repair', async () => {
    const liar = structuredClone(GOOD) as any;
    liar.sections[4].params.value = '500';
    const llm = new FakeLLM([JSON.stringify(liar), JSON.stringify(GOOD)]);
    const res = await new Planner(llm, { brief: '', kit: KIT, seconds: 10 }).draft();
    expect(res.rounds[0].issues[0].message).toContain('"500" is not in the brief');
    expect(res.plan.sections[4].params.value).toBe('120+');
  });

  it('falls back to a simpler schema when the API rejects it', async () => {
    const llm = new FakeLLM([new LLMError('schema too complex', 400, true), JSON.stringify(GOOD)]);
    const res = await new Planner(llm, { brief: '', kit: KIT, seconds: 10 }).draft();
    expect(res.plan.sections).toHaveLength(7);
    expect((llm.requests[0].schema as any).properties.sections.items.anyOf).toBeDefined();
    expect((llm.requests[1].schema as any).properties.sections.items.anyOf).toBeUndefined();
  });

  it('revises with visual feedback in the same conversation', async () => {
    const better = structuredClone(GOOD);
    better.sections[2].params = { word: 'PRODUCT' };
    const llm = new FakeLLM([JSON.stringify(GOOD), JSON.stringify(better)]);
    const p = new Planner(llm, { brief: '', kit: KIT, seconds: 10 });
    await p.draft();
    const res = await p.revise('Section 2: the word is clipped. Use a shorter word.');
    expect(res.plan.sections[2].params.word).toBe('PRODUCT');
    expect(llm.requests[1].turns).toHaveLength(3);
  });

  it('gives up with the last issues when nothing validates', async () => {
    const llm = new FakeLLM(['{"sections": []}', '{"sections": []}']);
    await expect(new Planner(llm, { brief: '', kit: KIT, maxRepairs: 1 }).draft()).rejects.toThrow(/no valid plan after 2 attempts/);
  });
});

describe('brand kit', () => {
  it('accepts a kit, a bare brand or a whole plan', () => {
    expect(loadBrandKit({ brand: DEMO_BRAND }).brand.name).toBe('Northwind');
    expect(loadBrandKit(DEMO_BRAND).facts.services).toEqual([]);
    expect(loadBrandKit({ brand: DEMO_BRAND, sections: [{ technique: 'end-card', beats: 8 }] }).brand.name).toBe('Northwind');
    expect(() => loadBrandKit({ nope: 1 })).toThrow(/not a brand kit/);
  });
});

import { contrast, finalizeKit, fixColors, normHex } from '../src/ai/brand';
import { needsRevision, reviewTimes, revisionMessage } from '../src/ai/qa';
import { ReplayLLM } from '../src/ai/replay';

describe('brand rules', () => {
  it('normalises hex colours', () => {
    expect(normHex('#abc')).toBe('#AABBCC');
    expect(normHex(' #f63c0c ')).toBe('#F63C0C');
    expect(normHex('orange')).toBeUndefined();
  });
  it('keeps a good dark palette as is', () => {
    expect(fixColors({ bg: '#0B0C0F', text: '#F1EFED', primary: '#F63C0C' })).toEqual({ bg: '#0B0C0F', text: '#F1EFED', primary: '#F63C0C' });
  });
  it('gives a light site a dark tinted background and keeps its paper colour', () => {
    const c = fixColors({ bg: '#FFFFFF', text: '#111111', primary: '#0A7CFF' });
    expect(c.light).toBe('#FFFFFF');
    expect(contrast(c.bg, '#000000')).toBeLessThan(1.6);
    expect(contrast(c.text, c.bg)).toBeGreaterThanOrEqual(7);
    expect(c.primary).toBe('#0A7CFF');
  });
  it('lifts a primary that vanishes into the background', () => {
    const c = fixColors({ bg: '#0B0C0F', text: '#FFFFFF', primary: '#1A1030' });
    expect(contrast(c.primary, c.bg)).toBeGreaterThanOrEqual(2.6);
  });
  it('finalises a kit from a sloppy reply', () => {
    const kit = finalizeKit(
      { name: 'Kora Labs Ltd and a name that is far too long for any lockup', tagline: 'We design and build AI products, web platforms and agents for ambitious teams everywhere in the world today', site: 'https://www.kora.test/', colors: { bg: '#0E0F13', text: '#F2F0EC', primary: '#6c5ce7' }, fonts: { display: 'Comic Sans' }, facts: { services: ['AI agents'], bogus: 1 } },
      { host: 'kora.test', emails: ['hello@kora.test'], source: 'https://kora.test' },
    );
    expect(kit.brand.name.length).toBeLessThanOrEqual(40);
    expect(kit.brand.tagline.length).toBeLessThanOrEqual(90);
    expect(kit.brand.site).toBe('kora.test');
    expect(kit.brand.email).toBe('hello@kora.test');
    expect(kit.brand.fonts.display).toBe('Plus Jakarta Sans');
    expect(kit.brand.colors.primary).toBe('#6C5CE7');
    expect(kit.facts.services).toEqual(['AI agents']);
  });
});

describe('visual QA', () => {
  it('samples settled frames, two for long sections', () => {
    const t = reviewTimes([
      { index: 0, technique: 'word-cuts', label: '', start: 0, end: 1, beats: 2 },
      { index: 1, technique: 'dot-globe', label: '', start: 1, end: 5, beats: 8 },
    ]);
    expect(t).toEqual([{ t: 0.72, index: 0 }, { t: 2.8, index: 1 }, { t: 4.4, index: 1 }]);
  });
  it('revises below 8 or on any high issue, and leaves low ones out of the brief', () => {
    const c = { score: 8, summary: 'Good.', issues: [{ section: 2, severity: 'high' as const, problem: 'clipped', fix: 'shorter word' }, { section: 3, severity: 'low' as const, problem: 'meh', fix: 'maybe' }] };
    expect(needsRevision(c)).toBe(true);
    expect(needsRevision({ score: 9, summary: '', issues: [c.issues[1]] })).toBe(false);
    const m = revisionMessage(c);
    expect(m).toContain('section 2 [high]: clipped → shorter word');
    expect(m).not.toContain('meh');
  });
});

describe('replay', () => {
  it('plays the recorded Kora run through the planner', async () => {
    const llm = new ReplayLLM('test/fixtures/replay-kora.json');
    const brandReply = parseJson<any>((await llm.json({ label: 'brand', system: '', turns: [] })).text);
    const kit = finalizeKit(brandReply, { source: 'fixture' });
    const res = await new Planner(llm, { brief: 'Launch reel', kit, seconds: 16 }).draft();
    expect(res.rounds.map(r => r.issues.length)).toEqual([1, 0]);
    expect(res.plan.sections.reduce((a, s) => a + s.beats, 0)).toBe(32);
    expect(res.plan.brand.name).toBe('Kora');
  });
});
