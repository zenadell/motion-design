import { describe, expect, it } from 'vitest';
import { catalogJson, catalogMarkdown } from '../src/cli/catalog';
import { TECHNIQUES } from '../src/engine/techniques';
import { DEMO_BRAND } from '../src/plan/demo';
import { validatePlan } from '../src/plan/validate';

describe('technique registry', () => {
  it('has unique ids', () => {
    const ids = TECHNIQUES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(TECHNIQUES.map(t => [t.id, t] as const))('%s is fully described and its example validates', (_, t) => {
    expect(t.title.length).toBeGreaterThan(2);
    expect(t.summary.length).toBeGreaterThan(40);
    expect(t.label.length).toBeGreaterThan(0);
    expect(t.beats.min).toBeLessThanOrEqual(t.beats.default);
    expect(t.beats.default).toBeLessThanOrEqual(t.beats.max);
    const r = validatePlan({ brand: DEMO_BRAND, sections: [{ technique: t.id, beats: t.beats.default, params: t.example }] });
    expect(r.ok, r.ok ? '' : JSON.stringify(r.errors)).toBe(true);
  });
});

describe('catalog', () => {
  it('exports a JSON schema for every technique and the plan', () => {
    const c = catalogJson();
    expect(c.techniques).toHaveLength(TECHNIQUES.length);
    expect(c.planSchema.type).toBe('object');
    for (const t of c.techniques) expect(t.params.type).toBe('object');
    expect(JSON.parse(JSON.stringify(c))).toBeTruthy();
  });

  it('documents every technique in markdown', () => {
    const md = catalogMarkdown();
    for (const t of TECHNIQUES) expect(md).toContain(`\`${t.id}\``);
  });
});
