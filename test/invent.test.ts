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

import { motionReport } from '../src/ai/metrics';
import { critiqueScore } from '../src/ai/invent-prompts';
import { kf, spring } from '../src/engine/custom/toolkit';

describe('refinement signals', () => {
  it('finds still stretches and empty frames, ignoring the final hold', () => {
    const s = Array.from({ length: 49 }, (_, i) => ({ t: i / 12, coverage: i < 12 ? 0.02 : 0.4, motion: i >= 20 && i <= 34 ? 0 : 0.02 }));
    const r = motionReport(s);
    expect(r.staticRuns).toHaveLength(1);
    expect(r.staticRuns[0][0]).toBeCloseTo(19 / 12, 5);
    expect(r.flags.join(' ')).toMatch(/nothing moves from 1\.58 s/);
    expect(motionReport(s, 20 / 12).staticRuns).toHaveLength(0);
    expect(motionReport(s.map(x => ({ ...x, coverage: 0.01 }))).flags[0]).toMatch(/mostly empty/);
  });
  it('weights the worst rubric dimension', () => {
    const all8 = { idea: 8, composition: 8, typography: 8, motion: 8, rhythm: 8, light_colour: 8, polish: 8, wow: 8 };
    expect(critiqueScore({ scores: all8, observed: '', fixes: [] })).toBe(8);
    expect(critiqueScore({ scores: { ...all8, polish: 2 }, observed: '', fixes: [] })).toBeLessThan(7);
  });
  it('keyframes and springs', () => {
    const E = { inOutCubic: (t: number) => t, outExpo: (t: number) => t };
    expect(kf(E, 0.5, [[0, 0], [1, 100]])).toBe(50);
    expect(kf(E, 2, [[0, [0, 0]], [1, [10, 20], 'outExpo']])).toEqual([10, 20]);
    expect(spring(0)).toBe(0);
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => spring(i / 100, 200, 10)));
    expect(peak).toBeGreaterThan(1);
    expect(spring(3, 200, 10)).toBeCloseTo(1, 2);
  });
});

describe('toolkit fixtures', () => {
  it('validates the toolkit and preset showcase plans', () => {
    for (const f of ['test/fixtures/toolkit.plan.json', 'test/fixtures/presets.plan.json']) expect(validatePlan(JSON.parse(readFileSync(f, 'utf8'))).ok, f).toBe(true);
  });
});

import { beatReport } from '../src/ai/metrics';
describe('beat precision', () => {
  it('flags hard changes off the 16th-note grid', () => {
    // 60 fps, 120 BPM (16th = 0.125 s): cuts at 0.5 s (on grid) and 0.8 s (off grid)
    const frames = Array.from({ length: 121 }, (_, i) => ({ t: i / 60, coverage: 0.5, motion: i === 30 || i === 48 ? 0.3 : 0.005 }));
    const r = beatReport(frames, 0.5);
    expect(r.hardChanges).toBe(2);
    expect(r.onGrid).toBe(1);
    expect(r.flags[0]).toContain('0.800 s (nearest 0.750 s)');
    expect(beatReport(frames.map(f => (f.t === 0.8 ? { ...f, motion: 0.005 } : f)), 0.5).flags).toEqual([]);
  });
});
