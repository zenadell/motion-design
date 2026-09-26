import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_BRAND } from '../src/plan/demo';
import { validatePlan } from '../src/plan/validate';

const load = (f: string) => JSON.parse(readFileSync(new URL(`../examples/${f}`, import.meta.url), 'utf8'));
const plan = (sections: unknown[], extra: Record<string, unknown> = {}) => ({ brand: DEMO_BRAND, sections, ...extra });

describe('validatePlan', () => {
  it.each(['jomiez.plan.json', 'resume-reel.plan.json'])('accepts the %s example', f => {
    const r = validatePlan(load(f));
    expect(r.ok, r.ok ? '' : JSON.stringify(r.errors)).toBe(true);
  });

  it('fills defaults for meta, music, fonts and technique params', () => {
    const r = validatePlan(plan([{ technique: 'wave-word', beats: 2, params: { word: 'HELLO' } }]));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.plan.meta.fps).toBe(60);
    expect(r.plan.music.bpm).toBe(120);
    expect(r.plan.music.genre).toBe('afro-house');
    expect(r.plan.brand.fonts.mono).toBe('JetBrains Mono');
    expect(r.plan.sections[0].params).toMatchObject({ word: 'HELLO', frame: 'browser', tone: 'light' });
  });

  it('suggests the closest technique id for typos', () => {
    const r = validatePlan(plan([{ technique: 'glitch-wrod', beats: 2 }]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0].path).toBe('sections[0].technique');
      expect(r.errors[0].message).toContain('did you mean "glitch-word"');
    }
  });

  it('reports param errors with a precise path', () => {
    const r = validatePlan(plan([{ technique: 'word-cuts', beats: 2, params: { words: [] } }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map(e => e.path)).toContain('sections[0].params.words');
  });

  it('enforces per-technique beat ranges', () => {
    const r = validatePlan(plan([{ technique: 'mitosis-grid', beats: 4 }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toContain('exactly 6');
  });

  it('rejects transitions longer than the sections they join', () => {
    const r = validatePlan(plan([
      { technique: 'blade-open', beats: 0.5, transition: { type: 'fade', beats: 1 } },
      { technique: 'glitch-word', beats: 2, params: { word: 'HI' } },
    ]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].path).toBe('sections[0].transition.beats');
  });

  it('rejects malformed colours and chords', () => {
    const bad = validatePlan({ brand: { ...DEMO_BRAND, colors: { bg: 'black', text: '#fff', primary: '#F63C0C' } }, sections: [{ technique: 'blade-open', beats: 0.5 }], music: { progression: ['H7'] } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const paths = bad.errors.map(e => e.path);
      expect(paths).toContain('brand.colors.bg');
      expect(paths).toContain('brand.colors.text');
      expect(paths).toContain('music.progression[0]');
    }
  });

  it('warns (but passes) when the plan does not end on an outro', () => {
    const r = validatePlan(plan([{ technique: 'blade-open', beats: 0.5 }]));
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => w.message.includes('outro'))).toBe(true);
  });
});
