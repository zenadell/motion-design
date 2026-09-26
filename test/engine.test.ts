import { describe, expect, it } from 'vitest';
import { cubeIcon, ICON_NAMES, ICONS, resample } from '../src/engine/assets/icons';
import { DEFAULT_PROGRESSIONS, parseChord } from '../src/engine/audio/chords';
import { buildTimeline, sectionIndexAt } from '../src/engine/core/timeline';
import { hexToHsl, hslHex, mixHex } from '../src/engine/core/color';
import { DEMO_BRAND } from '../src/plan/demo';
import { validatePlan } from '../src/plan/validate';

describe('chords', () => {
  it('voices minor ninths like the Jomiez track', () => {
    expect(parseChord('Fm9').pad).toEqual([53, 56, 60, 63, 67]);
    expect(parseChord('Dbmaj9').pad).toEqual([49, 53, 56, 60, 63]);
    expect(parseChord('Am').bass).toBe(33);
  });
  it('rejects unknown symbols', () => {
    expect(() => parseChord('H7')).toThrow();
  });
  it('has default progressions that parse', () => {
    for (const p of Object.values(DEFAULT_PROGRESSIONS)) p.forEach(c => expect(() => parseChord(c)).not.toThrow());
  });
});

describe('timeline', () => {
  const r = validatePlan({
    brand: DEMO_BRAND,
    music: { bpm: 100 },
    sections: [
      { technique: 'blade-open', beats: 0.5 },
      { technique: 'glitch-word', beats: 2, params: { word: 'HI' }, transition: 'blade' },
      { technique: 'end-card', beats: 6, transition: 'fade' },
    ],
  });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const tl = buildTimeline(r.plan);

  it('lays sections end to end on the beat grid', () => {
    expect(tl.B).toBeCloseTo(0.6);
    expect(tl.sections.map(s => s.start)).toEqual([0, 0.3, expect.closeTo(1.5, 6)]);
    expect(tl.duration).toBeCloseTo(5.1);
  });
  it('drops the transition on the last section', () => {
    expect(tl.sections[1].transition).toEqual({ type: 'blade', dur: expect.closeTo(0.3, 6) });
    expect(tl.sections[2].transition).toBeNull();
  });
  it('finds the section at any time', () => {
    expect(sectionIndexAt(tl, 0)).toBe(0);
    expect(sectionIndexAt(tl, 0.31)).toBe(1);
    expect(sectionIndexAt(tl, 99)).toBe(2);
  });
  it('takes energy and HUD defaults from the technique', () => {
    expect(tl.sections[0].energy).toBe(0);
    expect(tl.sections[2].hud).toBe(false);
  });
});

describe('icons', () => {
  it.each(ICON_NAMES.filter(n => n in ICONS))('%s stays inside its box', n => {
    for (const poly of ICONS[n]()) for (const [x, y] of poly) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(Math.abs(x)).toBeLessThan(420);
      expect(Math.abs(y)).toBeLessThan(420);
    }
  });
  it('resamples evenly', () => {
    const pts = resample(cubeIcon(1), 500);
    expect(pts).toHaveLength(500);
    expect(pts.spacing).toBeGreaterThan(0);
  });
});

describe('colour', () => {
  it('round-trips hsl', () => {
    const [h, s, l] = hexToHsl('#F63C0C');
    expect(hslHex(h, s, l)).toBe('#F63C0C');
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});
