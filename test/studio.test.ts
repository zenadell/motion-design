import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RGB } from '../src/ai/inspect';
import { E } from '../src/engine/core/math';
import { DEMO_BRAND } from '../src/plan/demo';
import { validatePlan } from '../src/plan/validate';
import { apply, bezier, layerMatrix, spring, valueAt } from '../src/studio/anim';
import { fitKeys, fitScalar } from '../src/studio/fit';
import { analyse, buildComp } from '../src/studio/measure';
import { applyOps, describe as describeComp, type Op } from '../src/studio/ops';
import { encodePng } from '../src/studio/png';
import { adapt, replaceSprite } from '../src/studio/adapt';
import { serveMcp } from '../src/studio/mcp';
import { offGridTimes, rhythmOf, snapComp } from '../src/studio/rhythm';
import { factIssues } from '../src/studio/agent';
import { mapPoint, squareToQuad, warp } from '../src/studio/rectify';
import type { Key } from '../src/studio/schema';

const plan = (comps: unknown[], sections = [{ technique: 'comp:a', beats: 4 }], assets = {}) => ({ brand: DEMO_BRAND, sections, studio: { comps, assets } });

describe('keyframes', () => {
  it('holds before the first key and after the last, and eases between', () => {
    const p: Key<number>[] = [{ t: 1, v: 0 }, { t: 2, v: 100, ease: 'linear' }];
    expect(valueAt(p, 0, -1)).toBe(0);
    expect(valueAt(p, 1.5, -1)).toBeCloseTo(50);
    expect(valueAt(p, 3, -1)).toBe(100);
    expect(valueAt(5, 1, -1)).toBe(5);
    expect(valueAt(undefined, 1, 7)).toBe(7);
  });
  it('applies the ease of the key it arrives at', () => {
    const p: Key<number>[] = [{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'outExpo' }];
    expect(valueAt(p, 0.3, 0)).toBeCloseTo(E.outExpo(0.3));
    expect(valueAt([{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'hold' }], 0.99, 0)).toBe(0);
  });
  it('interpolates vectors, colours and roles', () => {
    expect(valueAt([{ t: 0, v: [0, 10] }, { t: 1, v: [10, 30], ease: 'linear' }], 0.5, [0, 0])).toEqual([5, 20]);
    expect(valueAt([{ t: 0, v: '#000000' }, { t: 1, v: '#ffffff', ease: 'linear' }], 0.5, '')).toBe('#808080');
    const roles = (s: string) => (s === 'primary' ? [255, 0, 0, 1] : [0, 0, 0, 1]) as [number, number, number, number];
    expect(valueAt([{ t: 0, v: 'bg' }, { t: 1, v: 'primary', ease: 'linear' }], 1, '', 1, roles)).toBe('#ff0000');
  });
  it('springs overshoot and settle on real time', () => {
    const p: Key<number>[] = [{ t: 0, v: 0 }, { t: 1, v: 1, ease: { spring: { stiffness: 300, damping: 8 } } }];
    const peak = Math.max(...Array.from({ length: 40 }, (_, i) => valueAt(p, i / 40, 0)));
    expect(peak).toBeGreaterThan(1.1);
    expect(valueAt(p, 3, 0)).toBeCloseTo(1, 2);
  });
  it('solves cubic-beziers like CSS', () => {
    const ease = bezier(0.25, 0.1, 0.25, 1); // CSS "ease"
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(bezier(0, 0, 1, 1)(0.37)).toBeCloseTo(0.37, 4);
  });
  it('builds layer transforms around the anchor', () => {
    const m = layerMatrix([100, 50], [10, 0], 2, 90, 0);
    const [x, y] = apply(m, 10, 0); // the anchor lands on the position
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(50);
  });
});

describe('fitting keyframes to measured motion', () => {
  const ts = Array.from({ length: 61 }, (_, i) => i / 30);
  it('recovers one eased move as two keys', () => {
    const vs = ts.map(t => [t < 0.5 ? 0 : t > 1.5 ? 400 : 400 * E.outExpo(t - 0.5), 200]);
    const keys = fitKeys(ts, vs, { tol: 1.5 });
    expect(keys.length).toBeLessThanOrEqual(4);
    for (const t of ts) expect(Math.abs((valueAt(keys, t, [0, 0]) as number[])[0] - vs[ts.indexOf(t)][0])).toBeLessThan(1.6);
  });
  it('fits an overshoot with a spring, not a key per frame', () => {
    const vs = ts.map(t => spring(t - 0.2, 300, 10));
    const keys = fitScalar(ts, vs, { tol: 0.01, sec: 1 });
    expect(keys.length).toBeLessThanOrEqual(4);
    for (let i = 0; i < ts.length; i++) expect(Math.abs(valueAt(keys, ts[i], 0) - vs[i])).toBeLessThan(0.011);
  });
  it('keeps a hold as two keys', () => {
    expect(fitScalar(ts, ts.map(() => 3), { tol: 0.1 })).toHaveLength(2);
  });
});

describe('studio validation', () => {
  const ok = { id: 'a', layers: [{ id: 'box', type: 'rect', size: [100, 100] }, { id: 't', type: 'text', text: 'HI', parent: 'box' }] };
  it('accepts a comp played by a section', () => {
    const r = validatePlan(plan([ok]));
    expect(r.ok).toBe(true);
  });
  it('points at the exact field', () => {
    const bad = (layers: unknown[]) => validatePlan(plan([{ id: 'a', layers }]));
    const r1 = bad([{ id: 'x', type: 'text', text: 'A', parent: 'nope' }]);
    expect(!r1.ok && r1.errors[0].path).toBe('studio.comps[0].layers[0].parent');
    const r2 = bad([{ id: 'x', type: 'technique', technique: 'glitch-word', params: { word: 123 } }]);
    expect(!r2.ok && r2.errors[0].path).toMatch(/^studio\.comps\[0\]\.layers\[0\]\.params\.word/);
    const r3 = bad([{ id: 'x', type: 'code', draw: 'g.fillRect(0,,1)' }]);
    expect(!r3.ok && r3.errors[0].path).toBe('studio.comps[0].layers[0].draw');
    const r4 = bad([{ id: 'x', type: 'image', src: 'asset:missing' }]);
    expect(!r4.ok && r4.errors[0].message).toMatch(/no asset "missing"/);
    const r5 = bad([{ id: 'x', type: 'rect', size: [1, 1], fill: 'blue' }]);
    expect(!r5.ok && r5.errors[0].path).toMatch(/studio\.comps\.0\.layers\.0\.fill|studio\.comps\[0\]\.layers\[0\]\.fill/);
    const r6 = bad([{ id: 'x', type: 'text', text: 'A', font: 'Comic Sans' }]);
    expect(!r6.ok && r6.errors[0].message).toMatch(/unknown font/);
  });
  it('rejects sections that name a missing comp', () => {
    const r = validatePlan(plan([ok], [{ technique: 'comp:zzz', beats: 2 }]));
    expect(!r.ok && r.errors[0].message).toMatch(/no studio comp "zzz"/);
  });
  it('sorts keyframes given out of order', () => {
    const r = validatePlan(plan([{ id: 'a', layers: [{ id: 'b', type: 'rect', size: [1, 1], opacity: [{ t: 2, v: 1 }, { t: 0, v: 0 }] }] }]));
    expect(r.ok && (r.plan.studio!.comps[0].layers[0].opacity as Key<number>[]).map(k => k.t)).toEqual([0, 2]);
  });
  it('validates the shipped studio example', () => {
    expect(validatePlan(JSON.parse(readFileSync('examples/studio-demo.plan.json', 'utf8'))).ok).toBe(true);
  });
});

describe('studio operations', () => {
  const base = plan([], [{ technique: 'end-card', beats: 4 }]);
  it('builds a comp step by step and reports validation', () => {
    const ops: Op[] = [
      { op: 'add_comp', comp: { id: 'hero', units: 'beats' } },
      { op: 'add_layer', comp: 'hero', layer: { id: 'title', type: 'text', text: 'HELLO' } },
      { op: 'keyframe', comp: 'hero', layer: 'title', prop: 'scale', t: 1, v: 1, ease: 'outBack' },
      { op: 'keyframe', comp: 'hero', layer: 'title', prop: 'scale', t: 0, v: 0.5 },
      { op: 'keyframe', comp: 'hero', prop: 'camera.zoom', t: 0, v: 1.2 },
      { op: 'set_sections', sections: [{ technique: 'comp:hero', beats: 4 }] },
    ];
    const r = applyOps(base, ops);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.issues).toEqual([]);
    const layer = (r.plan.studio as { comps: { layers: { scale: Key<number>[] }[]; camera: { zoom: unknown } }[] }).comps[0];
    expect(layer.layers[0].scale.map(k => k.t)).toEqual([0, 1]);
    expect(layer.camera.zoom).toEqual([{ t: 0, v: 1.2 }]);
    expect(describeComp(r.plan)).toMatch(/title\s+text\s+"HELLO" · scale 2k 0→1/);
  });
  it('is all or nothing', () => {
    const r = applyOps(base, [{ op: 'add_comp', comp: { id: 'x' } }, { op: 'update_layer', comp: 'x', layer: 'ghost', set: {} }]);
    expect(!r.ok && r.index).toBe(1);
    expect((base.studio as { comps: unknown[] }).comps).toHaveLength(0);
  });
  it('removes fields with null and keyframes by time', () => {
    const r1 = applyOps(base, [
      { op: 'add_comp', comp: { id: 'a', layers: [{ id: 'b', type: 'rect', size: [1, 1], blur: 3, opacity: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }] } },
      { op: 'update_layer', comp: 'a', layer: 'b', set: { blur: null } },
      { op: 'remove_keyframe', comp: 'a', layer: 'b', prop: 'opacity', t: 0 },
    ]);
    expect(r1.ok && (r1.plan.studio as { comps: { layers: Record<string, unknown>[] }[] }).comps[0].layers[0]).toEqual({ id: 'b', type: 'rect', size: [1, 1], opacity: [{ t: 1, v: 1 }] });
  });
});

describe('png encoder', () => {
  it('writes a valid PNG header and IEND', () => {
    const png = encodePng(new Uint8Array(4 * 4 * 4).fill(200), 4, 4);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });
});

// ── the measurer, on synthetic film where the true motion is known ──────────

/** A dark gradient, a white square that fades in and slides with outCubic, and a word revealed left to right. */
function synthetic(k: number, w: number, h: number, cut = false): RGB {
  const s = w / 256, data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3, g = cut ? 0 : Math.round(30 * (x / w));
      data[i] = cut ? 120 : 10 + g; data[i + 1] = cut ? 20 : 12 + g; data[i + 2] = cut ? 30 : 40;
    }
  if (cut) return { w, h, data };
  const u = Math.max(0, Math.min(1, (k - 8) / 15));
  const cx = (40 + 150 * E.outCubic(u)) * s, cy = 50 * s, half = 10 * s;
  const a = Math.max(0, Math.min(1, k / 6));
  const fill = (x0: number, y0: number, x1: number, y1: number, rgb: number[], alpha: number) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) {
        const cover = Math.max(0, Math.min(1, x + 1 - x0, x1 - x)) * Math.max(0, Math.min(1, y + 1 - y0, y1 - y)) * alpha;
        const i = (y * w + x) * 3;
        for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * (1 - cover) + rgb[c] * cover);
      }
  };
  fill(cx - half, cy - half, cx + half, cy + half, [250, 250, 250], a);
  // the "word": a bar revealed from x = 60 to 200 over frames 4..20
  const rev = Math.max(0, Math.min(1, (k - 4) / 16));
  if (rev > 0) fill(60 * s, 100 * s, (60 + 140 * rev) * s, 112 * s, [250, 120, 20], 1);
  return { w, h, data };
}

describe('measuring a film', () => {
  const fps = 30, n = 30;
  const frames = Array.from({ length: n }, (_, k) => synthetic(k, 256, 144, k >= 26));
  const A = analyse(frames, fps);
  it('finds the hard cut and a gradient background', () => {
    expect(A.shots.map(s => [s.k0, s.k1])).toEqual([[0, 25], [26, 29]]);
    expect(A.shots[0].flat).toBe(false);
    expect(A.shots[1].flat).toBe(true);
  });
  it('rebuilds the slide, the fade and the reveal as keyframes', async () => {
    const m = await buildComp(A, frames, async k => synthetic(k, 1920, 1080, k >= 26));
    const layers = m.comp.layers as unknown as Record<string, unknown>[];
    const square = layers.find(l => String(l.name).startsWith('transform') && String(l.name).includes('#fafafa'))!;
    const bar = layers.find(l => String(l.name).startsWith('reveal'))!;
    expect(square).toBeTruthy();
    expect(bar).toBeTruthy();
    // position follows the true path within ~1 analysis px (7.5 px at 1080p)
    const pos = square.position as Key<number[]>[];
    for (const k of [10, 14, 18, 24]) {
      const truth = (40 + 150 * E.outCubic(Math.min(1, (k - 8) / 15))) * 7.5;
      expect(Math.abs((valueAt(pos, k / fps, [0, 0]) as number[])[0] - truth)).toBeLessThan(8);
    }
    expect(pos.length).toBeLessThan(8);
    // the fade-in is found even where the square is too faint for the threshold
    const op = square.opacity as Key<number>[];
    expect(valueAt(op, 0.5 / fps, 1)).toBeLessThan(0.35);
    expect(valueAt(op, 7 / fps, 0)).toBeGreaterThan(0.9);
    // the bar stays put and its clip grows to the right
    const clip = bar.clip as Key<number[]>[];
    const w10 = (valueAt(clip, 10 / fps, [0, 0, 0, 0]) as number[])[2], w18 = (valueAt(clip, 18 / fps, [0, 0, 0, 0]) as number[])[2];
    expect(w18).toBeGreaterThan(w10 * 1.5);
    // a flat background in shot 2 and a gradient plate for shot 1
    expect(layers.some(l => String(l.id).startsWith('plate-1'))).toBe(true);
    expect(Object.keys(m.assets).length).toBeGreaterThanOrEqual(3);
    // and it is a valid plan
    const r = validatePlan({ brand: DEMO_BRAND, sections: [{ technique: 'comp:copy', beats: 2 }], studio: { comps: [m.comp], assets: m.assets } });
    expect(r.ok).toBe(true);
  });
});

describe('adapting a copy to a brand', () => {
  it('swaps sprites for the brand\'s words and logo and keeps the measured motion', async () => {
    const frames = Array.from({ length: 30 }, (_, k) => synthetic(k, 256, 144, k >= 26));
    const m = await buildComp(analyse(frames, 30), frames, async k => synthetic(k, 1920, 1080, k >= 26));
    const copy = validatePlan({ brand: DEMO_BRAND, music: { volume: 0 }, sections: [{ technique: 'comp:copy', beats: 2 }], studio: { comps: [m.comp], assets: m.assets } });
    if (!copy.ok) throw new Error('copy does not validate');
    const sprites = (m.comp.layers as unknown as Record<string, unknown>[]).filter(l => !String(l.id).startsWith('plate'));
    const square = sprites.find(l => String(l.name).startsWith('transform'))!, bar = sprites.find(l => String(l.name).startsWith('reveal'))!;
    const seen: string[] = [];
    const llm = {
      model: 'fake',
      async json(req: { turns: { parts: { text?: string }[] }[] }) {
        seen.push(...req.turns[0].parts.flatMap(p => (p.text?.startsWith('ELEMENT') ? [p.text.split(' ')[1]] : [])));
        return { text: JSON.stringify({ background: 'bg', elements: [{ id: square.id, kind: 'logo', color: 'primary' }, { id: bar.id, kind: 'text', text: 'SHIP FASTER', color: 'accent' }] }), usage: { label: 'adapt', model: 'fake', input: 0, output: 0, thinking: 0, ms: 0 } };
      },
    };
    const r = await adapt(llm as never, copy.plan, { brand: { ...DEMO_BRAND, name: 'Kora' }, facts: {}, source: '' } as never, 'launch');
    expect(seen).toContain(String(square.id));
    const layers = r.plan.studio!.comps[0].layers as unknown as Record<string, unknown>[];
    const logo = layers.find(l => l.id === square.id)!, text = layers.find(l => l.id === bar.id)!;
    expect(logo.type).toBe('logo');
    expect(logo.position).toEqual(square.position);
    expect(text).toMatchObject({ type: 'text', text: 'SHIP FASTER', color: 'accent', clip: bar.clip, in: bar.in });
    expect(r.plan.brand.name).toBe('Kora');
    expect(r.plan.studio!.comps[0].background).toBe('bg');
    // the replaced sprites' images are gone from the plan
    expect(Object.keys(r.plan.studio!.assets)).not.toContain(String(square.id));
  });
  it('sizes text to the measured box', () => {
    const l = replaceSprite({ id: 'a', type: 'image', src: 'asset:a', position: [960, 540] }, { id: 'a', kind: 'text', text: 'HELLO' }, [412, 112]);
    expect(l).toMatchObject({ type: 'text', position: [960, 540] });
    expect((l as { size: number }).size).toBeGreaterThan(100);
    expect((l as { size: number }).size).toBeLessThanOrEqual(135);
    expect(replaceSprite({ id: 'b' }, { id: 'b', kind: 'hide' }, [10, 10])).toBeNull();
  });
});

describe('the studio over MCP', () => {
  it('lists its tools and edits a plan through them', async () => {
    const { PassThrough } = await import('node:stream');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const input = new PassThrough(), output = new PassThrough();
    const replies: Record<string, unknown>[] = [];
    output.on('data', d => String(d).split('\n').filter(Boolean).forEach(l => replies.push(JSON.parse(l))));
    const file = join(mkdtempSync(join(tmpdir(), 'mcp-')), 'p.json');
    const done = serveMcp(undefined, input, output);
    const send = (id: number, method: string, params?: unknown) => input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    send(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    send(2, 'tools/list');
    send(3, 'tools/call', { name: 'studio_open', arguments: { path: file } });
    send(4, 'tools/call', { name: 'studio_apply', arguments: { ops: [
      { op: 'add_comp', comp: { id: 'hero' } },
      { op: 'add_layer', comp: 'hero', layer: { id: 'title', type: 'text', text: 'HI' } },
      { op: 'set_sections', sections: [{ technique: 'comp:hero', beats: 4 }] },
    ] } });
    send(5, 'tools/call', { name: 'studio_apply', arguments: { ops: [{ op: 'remove_layer', comp: 'hero', layer: 'nope' }] } });
    send(6, 'nope/method');
    input.end();
    await done;
    const by = (id: number) => replies.find(r => r.id === id) as { result?: Record<string, unknown>; error?: { code: number } };
    expect((by(1).result!.serverInfo as { name: string }).name).toBe('motion-studio');
    expect((by(2).result!.tools as { name: string }[]).map(t => t.name)).toEqual(expect.arrayContaining(['studio_apply', 'studio_measure', 'studio_compare', 'studio_frame']));
    const text = (id: number) => ((by(id).result!.content as { text: string }[])[0].text);
    expect(text(4)).toMatch(/added text layer "title"[\s\S]*plan is valid/);
    expect(text(5)).toMatch(/no layer "nope"[\s\S]*nothing changed/);
    expect(by(6).error!.code).toBe(-32601);
    expect(JSON.parse(readFileSync(file, 'utf8')).studio.comps[0].layers[0].id).toBe('title');
  });
});

describe('rhythm', () => {
  it('snaps comp timing to the grid without collapsing keys', () => {
    const comp = {
      id: 'a', units: 'beats',
      sounds: [{ t: 1.2, sound: 'pop' }],
      layers: [{ id: 't', type: 'text', text: 'HI', in: 0.1, animate: { start: 0.35 }, opacity: [{ t: 0.1, v: 0 }, { t: 0.2, v: 1 }, { t: 1.6, v: 1 }] }],
    };
    expect(offGridTimes(comp, 0.5)).toHaveLength(6);
    expect(snapComp(comp, 0.25, 0.5)).toBe(6);
    expect(comp.sounds[0].t).toBe(1.25);
    expect(comp.layers[0].animate.start).toBe(0.25);
    expect(comp.layers[0].opacity.map(k => k.t)).toEqual([0, 0.25, 1.5]);
    expect(offGridTimes(comp, 0.5)).toEqual([]);
  });
  it('snaps seconds-based comps on the beat grid in seconds', () => {
    const comp = { id: 'a', units: 'seconds', layers: [{ id: 'r', type: 'rect', size: [1, 1], opacity: [{ t: 0.2, v: 0 }, { t: 0.4, v: 1 }] }] };
    snapComp(comp, 0.25, 0.5); // a 16th = 0.125 s at 120 BPM
    expect(comp.layers[0].opacity.map(k => k.t)).toEqual([0.25, 0.375]);
  });
  it('finds visual hits and measures them against the beat grid', () => {
    const fps = 30, motion = Array.from({ length: 90 }, (_, k) => ({ t: k / fps, motion: 0.002 }));
    motion[15].motion = 0.3; // 0.5 s: on beat 1
    motion[38].motion = 0.2; // 1.267 s: 17 ms after the 8th at 1.25 → on the grid
    motion[55].motion = 0.25; // 1.833 s: 42 ms before the 16th at 1.875 → off
    const r = rhythmOf(motion, 120, fps, [{ start: 0, end: 3, technique: 'comp:a' }]);
    expect(r.onsets.map(o => o.grid)).toEqual(['beat', '8th', 'off']);
    expect(r.score).toBeCloseTo(2 / 3);
    expect(r.text).toMatch(/off: 1\.833 s in comp:a/);
  });
});

describe('messages a model can act on', () => {
  it('names the valid transitions and sets fields inside lists', () => {
    const r = validatePlan({ brand: DEMO_BRAND, sections: [{ technique: 'end-card', beats: 4, transition: { technique: 'flash' } }, { technique: 'end-card', beats: 4 }] });
    expect(!r.ok && r.errors[0].message).toMatch(/one of cut, blade/);
    const a = applyOps({ brand: DEMO_BRAND, sections: [{ technique: 'end-card', beats: 4 }, { technique: 'end-card', beats: 4 }] }, [{ op: 'set', path: 'sections.0.transition', value: 'flash' }]);
    expect(a.ok && (a.plan.sections as { transition?: string }[])[0].transition).toBe('flash');
    expect(applyOps({ sections: [] }, [{ op: 'set', path: 'sections.5.beats', value: 2 }]).ok).toBe(false);
  });
});

describe('the agent fact gate', () => {
  it('flags places, names and numbers the facts do not state', () => {
    const kit = { brand: DEMO_BRAND, facts: { locations: ['Nigeria (HQ)', 'London'], work: [], stats: [{ value: '4.9', label: 'rating' }] }, source: '' } as never;
    const plan = {
      brand: DEMO_BRAND,
      sections: [
        { technique: 'dot-globe', beats: 8, params: { hq: { name: 'LAGOS', lat: 6.5, lon: 3.4 }, cities: [{ name: 'London', lat: 51.5, lon: -0.1 }], headline: ['Based in', 'Nigeria.'] } },
        { technique: 'comp:c', beats: 4 },
        { technique: 'end-card', beats: 6 },
      ],
      studio: { comps: [{ id: 'c', layers: [{ id: 't', type: 'text', text: 'RATED 4.9 BY 500 CLIENTS' }] }] },
    };
    const issues = factIssues(plan, kit, '');
    expect(issues.some(i => /must|expected|needs/.test(i))).toBe(false); // the plan itself is valid
    expect(issues.some(i => /LAGOS/.test(i))).toBe(true);
    expect(issues.some(i => /"500"/.test(i))).toBe(true);
    expect(issues.some(i => /"4\.9"/.test(i))).toBe(false);
    expect(issues.some(i => /London/.test(i))).toBe(false);
  });
});

describe('rectify', () => {
  it('maps the unit square onto a tilted screen and flattens it back', () => {
    const q: [number, number][] = [[12, 363], [471, 382], [527, 628], [40, 681]];
    const m = squareToQuad(q as never);
    for (const [u, v, k] of [[0, 0, 0], [1, 0, 1], [1, 1, 2], [0, 1, 3]] as const) {
      const [x, y] = mapPoint(m, u, v);
      expect(x).toBeCloseTo(q[k][0], 6);
      expect(y).toBeCloseTo(q[k][1], 6);
    }
    // a 4×4 checker drawn into the quad comes back as a checker
    const sw = 600, sh = 800, src = new Uint8Array(sw * sh * 3);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) src.fill(((x >> 5) + (y >> 5)) % 2 ? 255 : 0, (y * sw + x) * 3, (y * sw + x) * 3 + 3);
    const flat = warp(src, sw, sh, [[100, 100], [500, 100], [500, 700], [100, 700]], 64, 64);
    // output pixel (8, 8) samples the source at (153.1, 179.7): inside one checker square, away from its edges
    expect(flat[(8 * 64 + 8) * 3]).toBe(src[(179 * sw + 153) * 3]);
    expect(flat[(8 * 64 + 8) * 3]).toBe(255);
  });
});
