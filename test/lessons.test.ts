import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evidenceFromRun, learn, Lessons, newEvidence, sceneEvidence, weight, type Lesson } from '../src/ai/lessons';
import type { JsonRequest, LLM } from '../src/ai/llm';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'motion-lessons-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));

const found = (o: Partial<Lesson>): Partial<Lesson> => ({ roles: ['coder'], tags: [], mode: 'any', why: 'seen in a run', ...o });

describe('lessons store', () => {
  it('adds new lessons, reinforces known ones by id or by near-identical wording, and saves', () => {
    const file = join(tmp(), 'lessons.json');
    const s = new Lessons(file);
    const r1 = s.merge([
      found({ id: 'timed-word-states', rule: 'When the reference swaps words every 0.25 s, drive the text from a keyed array of timed states and draw only the current one.', tags: ['kinetic-type', 'timing'], mode: 'exact' }),
      found({ id: 'guard-radius', rule: 'Clamp every arc and ellipse radius with Math.max(0, r) before drawing.', tags: ['code-error'] }),
      found({ rule: 'too short' }),
    ], [], 'out/run1');
    expect(r1.added).toEqual(['timed-word-states', 'guard-radius']);
    const r2 = s.merge([
      found({ id: 'guard-radius', rule: 'Clamp every arc, ellipse and roundRect radius with Math.max(0, r) before drawing.' }),
      found({ id: 'other-id', rule: 'When the reference swaps words every 0.25 s, drive the text from a keyed array of timed states and draw only the current state.' }),
    ], [], 'out/run2');
    expect(r2.added).toEqual([]);
    expect(r2.reinforced.sort()).toEqual(['guard-radius', 'timed-word-states']);
    s.save();
    const again = new Lessons(file);
    const g = again.lessons.find(l => l.id === 'guard-radius')!;
    expect(g.seen).toBe(2);
    expect(g.rule).toContain('roundRect');
    expect(g.sources).toEqual(['out/run1', 'out/run2']);
  });

  it('shows each role its own lessons, filtered by mode and ranked by relevance and weight', () => {
    const s = new Lessons(join(tmp(), 'lessons.json'));
    s.merge([
      found({ id: 'a', rule: 'Draw the search bar glow as a tight rim light, not a wide blur behind it.', tags: ['ui', 'glow'], mode: 'exact' }),
      found({ id: 'b', rule: 'Open every original film with a bold hero word inside the first beat.', tags: ['typography'], mode: 'invent' }),
      found({ id: 'c', rule: 'Check that every word the reference shows appears in the render, in the same order.', roles: ['critic'], tags: ['typography'] }),
      found({ id: 'd', rule: 'Guard every division by a duration that can be zero.', tags: ['code-error'] }),
    ], [], 'x');
    const exactCoder = s.pick('coder', { mode: 'exact', text: 'a pinterest search bar with a blue glow along its rim' }).map(l => l.id);
    expect(exactCoder).toEqual(['a', 'd']);
    expect(s.pick('coder', { mode: 'invent', text: '' }).map(l => l.id).sort()).toEqual(['b', 'd']);
    expect(s.pick('critic', { mode: 'exact' }).map(l => l.id)).toEqual(['c']);
    const block = s.block('critic', { mode: 'exact' });
    expect(block).toContain('KNOWN FAILURE MODES');
    expect(block).toContain('every word the reference shows');
    expect([...s.shownNow]).toEqual(['c']);
    expect(s.block('director', { mode: 'exact' })).toBe('');
  });

  it('counts a lesson as repeated only when it was shown and broken again, and ranks it higher', () => {
    const s = new Lessons(join(tmp(), 'lessons.json'));
    s.merge([found({ id: 'x', rule: 'Step through timed word states; never lay out the whole phrase.' }), found({ id: 'y', rule: 'Keep small UI text small: use the measured size.' })], [], 'r1');
    s.block('coder', { mode: 'invent' }, 1);
    const shown = [...s.shownNow];
    const r = s.merge([], ['x', 'y'], 'r2');
    expect(r.repeated).toEqual(shown);
    const l = s.lessons.find(z => z.id === shown[0])!;
    expect(l.repeated).toBe(1);
    expect(l.shown).toBe(1);
    expect(s.block('coder', { mode: 'invent' })).toContain('[REPEATED 1×');
    expect(weight(l)).toBeGreaterThan(weight(s.lessons.find(z => z.id !== shown[0])!));
  });
});

describe('learning from a run', () => {
  it('rebuilds evidence from an older run folder (critiques in the transcript)', () => {
    const d = tmp();
    writeFileSync(join(d, 'direction.json'), JSON.stringify({ title: 'T', exact: true, scenes: [{ id: 'scene-1', idea: 'words swap' }] }));
    writeFileSync(join(d, 'transcript.json'), JSON.stringify([
      { step: 'code scene-1 #1', model: 'deepseek/x', reply: '{}' },
      { step: 'critique scene-1 #1', model: 'google/y', reply: JSON.stringify({ scores: { idea: 6, composition: 6, typography: 6, motion: 4, rhythm: 6, light_colour: 6, polish: 6, wow: 6 }, observed: 'the phrase is drawn at once', fixes: ['step through the words'] }) },
    ]));
    const ev = evidenceFromRun(d);
    expect(ev.mode).toBe('exact');
    expect(ev.models.code).toBe('deepseek/x');
    expect(ev.scenes[0].versions[0]).toMatchObject({ step: '#1', score: 5.2, observed: 'the phrase is drawn at once' });
  });

  it('asks the reviewer with the evidence and the known lessons, and stores what it finds', async () => {
    const file = join(tmp(), 'lessons.json');
    const s = new Lessons(file);
    s.merge([found({ id: 'old', rule: 'Guard every division by a duration that can be zero.' })], [], 'r0');
    s.save();
    s.block('coder', { mode: 'invent' });
    const ev = newEvidence('invent', { code: 'c', critic: 'k' }, 9);
    sceneEvidence(ev, 'scene-1', 'an idea').versions.push({ step: '#1', score: 3.2, observed: 'blank for a second' });
    let seen: JsonRequest | undefined;
    const llm: LLM = {
      model: 'fake',
      async json(req) {
        seen = req;
        return {
          text: JSON.stringify({ lessons: [{ id: 'first-frame', rule: 'Put visible content on screen from the very first frame of every scene.', why: 'scene-1 was blank for a second', roles: ['coder'], tags: ['timing'], mode: 'any' }], repeated: ['old'] }),
          usage: { label: 'learn', model: 'fake', input: 1, output: 1, thinking: 0, ms: 1 },
        };
      },
    };
    const r = await learn(llm, s, ev, 'out/run');
    const prompt = JSON.stringify(seen!.turns);
    expect(prompt).toContain('blank for a second');
    expect(prompt).toContain('Guard every division');
    expect(r.added).toEqual(['first-frame']);
    expect(r.repeated).toEqual(['old']);
    const saved = new Lessons(file);
    expect(saved.lessons.map(l => l.id).sort()).toEqual(['first-frame', 'old']);
    expect(saved.lessons.find(l => l.id === 'old')!.repeated).toBe(1);
  });
});
