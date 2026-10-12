// Is the picture on the music? Visual hits (frames where the picture changes
// sharply: a cut, an entrance landing, a flash) are found in the rendered film
// and measured against the beat grid. The music's own hits are on the grid by
// construction, so a hit off the grid is a hit off the music.

export interface Onset { t: number; strength: number; beat: number; off: number; grid: 'beat' | '8th' | '16th' | 'off'; section: string }

export interface RhythmReport {
  /** Share of strong visual hits that land on the 16th-note grid (within a frame). */
  score: number;
  onsets: Onset[];
  text: string;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
};

/**
 * `series`: picture change per frame (0..1) at `fps`. `sections`: where each
 * section starts and ends (for naming hits). Times are film seconds.
 */
export function rhythmOf(series: { t: number; motion: number }[], bpm: number, fps: number, sections: { start: number; end: number; technique: string }[]): RhythmReport {
  const B = 60 / bpm, q = B / 4, m = series.map(s => s.motion);
  const peaks: { k: number; s: number }[] = [];
  for (let k = 1; k < m.length; k++) {
    const win = m.slice(Math.max(0, k - 15), k + 16);
    const base = median(win);
    if (m[k] >= (m[k - 1] ?? 0) && m[k] >= (m[k + 1] ?? 0) && m[k] > Math.max(0.012, base * 2.5)) peaks.push({ k, s: m[k] - base });
  }
  const top = Math.max(0, ...peaks.map(p => p.s));
  const strong = peaks.filter(p => p.s >= top * 0.06);
  const onsets: Onset[] = strong.map(p => {
    // the first frame that shows an event scheduled at T is the first frame at or after T
    const t = series[p.k].t, beat = t / B, g = Math.round((t - 0.5 / fps) / q) * q, off = t - g;
    const onGrid = off >= -0.6 / fps && off <= 1.6 / fps;
    const gb = Math.round(g / q);
    const grid: Onset['grid'] = !onGrid ? 'off' : gb % 4 === 0 ? 'beat' : gb % 2 === 0 ? '8th' : '16th';
    const sec = sections.find(s => t >= s.start && t < s.end) ?? sections[sections.length - 1];
    return { t, strength: p.s, beat, off, grid, section: sec?.technique ?? '' };
  });
  const score = onsets.length ? onsets.filter(o => o.grid !== 'off').length / onsets.length : 1;
  const off = onsets.filter(o => o.grid === 'off').sort((a, b) => b.strength - a.strength);
  const count = (g: Onset['grid']) => onsets.filter(o => o.grid === g).length;
  const text = [
    `rhythm: ${Math.round(score * 100)}% of ${onsets.length} visual hits land on the grid (${count('beat')} on beats, ${count('8th')} on 8ths, ${count('16th')} on 16ths, ${off.length} off) at ${bpm} BPM`,
    ...off.slice(0, 15).map(o => {
      const target = Math.round(o.beat * 4) / 4;
      return `  off: ${o.t.toFixed(3)} s in ${o.section} · beat ${o.beat.toFixed(2)} · ${Math.round((o.t - target * B) * 1000)} ms from beat ${target} (strength ${o.strength.toFixed(3)})`;
    }),
  ].join('\n');
  return { score, onsets, text };
}

type Json = Record<string, unknown>;

const isKeys = (v: unknown): v is { t: number }[] => Array.isArray(v) && v.length > 0 && v.every(k => k && typeof k === 'object' && !Array.isArray(k) && 't' in k && 'v' in k);

/**
 * Quantise a comp's timing to the music like a DAW does: keyframe times,
 * text animator starts, layer in/out, sounds and hits snap to the grid
 * (`grid` in beats). Keys keep their order: two keys never land on the same
 * time. Returns how many times moved.
 */
export function snapComp(comp: Json, grid: number, secondsPerBeat: number): number {
  const step = comp.units === 'seconds' ? grid * secondsPerBeat : grid;
  const snap = (t: number) => Math.round(Math.round(t / step) * step * 1e6) / 1e6;
  let moved = 0;
  const one = (o: Json, k: string) => {
    if (typeof o[k] !== 'number') return;
    const v = snap(o[k] as number);
    if (Math.abs(v - (o[k] as number)) > 1e-9) moved++;
    o[k] = v;
  };
  const walk = (o: unknown) => {
    if (Array.isArray(o)) {
      if (isKeys(o)) {
        let prev = -Infinity;
        for (const key of o) {
          let v = snap(key.t);
          if (v <= prev) v = Math.round((prev + step) * 1e6) / 1e6;
          if (Math.abs(v - key.t) > 1e-9) moved++;
          key.t = v;
          prev = v;
        }
      } else o.forEach(walk);
      return;
    }
    if (!o || typeof o !== 'object') return;
    const j = o as Json;
    for (const k of ['in', 'out', 'start']) one(j, k);
    for (const [k, v] of Object.entries(j)) if (k !== 'time') walk(v);
  };
  for (const h of (comp.hits as Json[] | undefined) ?? []) one(h, 't');
  for (const s of (comp.sounds as Json[] | undefined) ?? []) one(s, 't');
  walk(comp.layers);
  walk(comp.camera);
  walk(comp.background);
  return moved;
}

/** Times in a comp that are off the 16th-note grid (a static check, no rendering). */
export function offGridTimes(comp: Json, secondsPerBeat: number): string[] {
  const step = comp.units === 'seconds' ? 0.25 * secondsPerBeat : 0.25;
  const out: string[] = [];
  const check = (t: unknown, where: string) => {
    if (typeof t === 'number' && Math.abs(t / step - Math.round(t / step)) > 1e-3) out.push(`${where} @ ${t}`);
  };
  for (const h of (comp.hits as Json[] | undefined) ?? []) check(h.t, 'hit');
  for (const s of (comp.sounds as Json[] | undefined) ?? []) check(s.t, `sound ${s.sound}`);
  const walk = (layers: Json[]) => {
    for (const l of layers) {
      check(l.in, `${l.id}.in`);
      check(l.out, `${l.id}.out`);
      const a = l.animate as Json | undefined;
      if (a) {
        check(a.start, `${l.id}.animate.start`);
        check((a.exit as Json | undefined)?.start, `${l.id}.animate.exit.start`);
      }
      for (const [k, v] of Object.entries(l)) if (isKeys(v)) v.forEach(key => check(key.t, `${l.id}.${k}`));
      if (Array.isArray(l.layers)) walk(l.layers as Json[]);
    }
  };
  walk((comp.layers as Json[]) ?? []);
  return out;
}
