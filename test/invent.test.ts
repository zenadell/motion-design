import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fitScenes, unverifiedNumbers } from '../src/ai/invent';
import { checkCustom, compile, noise } from '../src/engine/custom/stage';
import { validatePlan } from '../src/plan/validate';

const fixture = () => JSON.parse(readFileSync('test/fixtures/custom.plan.json', 'utf8'));

describe('custom scenes', () => {
  it('validates a plan with model-written scenes', () => {
    const r = validatePlan(fixture());
    expect(r.ok).toBe(true);
  });
  it('reports syntax errors by path without running anything', () => {
    const p = fixture();
    p.custom.scenes[1].draw = 'g.fillRect(0, 0,, 10);';
    const r = validatePlan(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].path).toBe('custom.scenes[1].draw');
  });
  it('rejects sections that name a missing scene', () => {
    const p = fixture();
    p.sections[1].technique = 'scene:nope';
    const r = validatePlan(p);
    expect(!r.ok && r.errors[0].message).toMatch(/no custom scene "nope"/);
  });
  it('sandboxes scene code: no DOM, clock or network; seeded Math.random', () => {
    const f = compile(['x'], 'return [typeof document, typeof fetch, typeof Date, Math.random(), Math.sin(0)];', 't');
    const seeded = Object.create(Math);
    seeded.random = () => 0.25;
    expect(f(1, seeded)).toEqual(['undefined', 'undefined', 'undefined', 0.25, 0]);
    expect(checkCustom({ scenes: [], lib: 'return {' })[0].path).toBe('custom.lib');
  });
  it('has smooth deterministic noise', () => {
    expect(noise(1.5, 2.25, 3)).toBe(noise(1.5, 2.25, 3));
    expect(Math.abs(noise(1.5, 2, 0) - noise(1.51, 2, 0))).toBeLessThan(0.05);
    for (let i = 0; i < 50; i++) { const v = noise(i * 0.37, i * 0.11, i); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});

describe('invent helpers', () => {
  it('fits scene lengths to the target on a half-beat grid', () => {
    const out = fitScenes([4, 6, 8, 3], 48);
    expect(out.reduce((a, b) => a + b, 0)).toBe(48);
    for (const b of out) expect(b * 2).toBe(Math.round(b * 2));
  });
  it('flags numbers in on-screen strings that are not facts', () => {
    const code = `S.font(g, 120, 800); g.fillText('40+ LAUNCHES', 100, 200); g.fillText("SINCE 2019", 0, 0); g.fillStyle = 'rgba(255, 0, 0, 0.5)'; g.font = '800 120px Inter'; const x = '#FF0000';`;
    const r = unverifiedNumbers(code, 'we have 40+ launches', ['120']);
    expect(r).toEqual(['"SINCE 2019" states 2019']);
  });
});
