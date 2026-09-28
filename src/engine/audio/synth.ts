// Web Audio instruments. Everything is scheduled up-front on an
// OfflineAudioContext, so the soundtrack is rendered once and is sample-exact
// against the visual timeline.

import { mod, rnd, clamp } from '../core/math';
import { midi } from './chords';

export interface Audio {
  ac: BaseAudioContext;
  master: GainNode;
  duck: GainNode;
  out: GainNode;
  rev: ConvolverNode;
  dly: DelayNode;
  noise: AudioBuffer;
  soft: Float32Array<ArrayBuffer>;
  kicks: number[];
}

export function makeAudio(ac: BaseAudioContext, volume = 1): Audio {
  let s = 13579;
  const noise = ac.createBuffer(1, ac.sampleRate * 2.5, ac.sampleRate), nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    nd[i] = s / 2147483648 - 1;
  }
  const soft = new Float32Array(1024).map((_, i) => Math.tanh(((i / 1023) * 2 - 1) * 2.4));
  const out = ac.createGain();
  out.gain.value = 0.9 * volume;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.14;
  const lim = ac.createDynamicsCompressor();
  lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06;
  const master = ac.createGain();
  master.connect(comp); comp.connect(lim); lim.connect(out); out.connect(ac.destination);
  const ir = ac.createBuffer(2, ac.sampleRate * 2.4, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      d[i] = (s / 2147483648 - 1) * Math.pow(1 - i / d.length, 3.2);
    }
  }
  const rev = ac.createConvolver();
  rev.buffer = ir;
  const ro = ac.createGain(); ro.gain.value = 0.3; rev.connect(ro); ro.connect(master);
  const dly = ac.createDelay(1);
  dly.delayTime.value = 0.375;
  const fb = ac.createGain(); fb.gain.value = 0.34;
  const dlp = ac.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 3000;
  dly.connect(dlp); dlp.connect(fb); fb.connect(dly);
  const dOut = ac.createGain(); dOut.gain.value = 0.38; dlp.connect(dOut); dOut.connect(master);
  const duck = ac.createGain();
  duck.connect(master);
  return { ac, master, duck, out, rev, dly, noise, soft, kicks: [] };
}

// ── building blocks ────────────────────────────────────────────────────────
const gainOf = (A: Audio, v: number) => { const g = A.ac.createGain(); g.gain.value = v; return g; };
function envG(A: Audio, at: number, peak: number, atk: number, dec: number): GainNode {
  const g = A.ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, at + atk + dec);
  return g;
}
function osc(A: Audio, type: OscillatorType, f: number, at: number, dur: number): OscillatorNode {
  const o = A.ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, at);
  o.start(at);
  o.stop(at + dur);
  return o;
}
function noiseAt(A: Audio, at: number, dur: number): AudioBufferSourceNode {
  const n = A.ac.createBufferSource();
  n.buffer = A.noise;
  n.loop = true;
  n.start(at, mod(at * 0.61803, 2));
  n.stop(at + dur);
  return n;
}
function filt(A: Audio, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
  const b = A.ac.createBiquadFilter();
  b.type = type; b.frequency.value = f; b.Q.value = q;
  return b;
}
function panner(A: Audio, p: number): StereoPannerNode {
  const s = A.ac.createStereoPanner();
  s.pan.value = clamp(p, -1, 1);
  return s;
}
function send(A: Audio, node: AudioNode, bus: AudioNode, v: number): void {
  const g = gainOf(A, v);
  node.connect(g);
  g.connect(bus);
}
const ok = (at: number) => at >= 0;

// ── drums ──────────────────────────────────────────────────────────────────
export function kick(A: Audio, at: number, v = 1): void {
  if (!ok(at)) return;
  const o = osc(A, 'sine', 165, at, 0.6);
  o.frequency.exponentialRampToValueAtTime(56, at + 0.055);
  o.frequency.exponentialRampToValueAtTime(42, at + 0.38);
  const g = envG(A, at, v, 0.002, 0.42); o.connect(g); g.connect(A.master);
  const n = noiseAt(A, at, 0.03), hp = filt(A, 'highpass', 2600), ng = envG(A, at, v * 0.16, 0.001, 0.018);
  n.connect(hp); hp.connect(ng); ng.connect(A.master);
  A.kicks.push(at);
}
export function sub(A: Audio, at: number, v = 0.8, dur = 1.3): void {
  if (!ok(at)) return;
  const o = osc(A, 'sine', 88, at, dur + 0.1);
  o.frequency.exponentialRampToValueAtTime(33, at + dur * 0.8);
  const g = envG(A, at, v, 0.004, dur); o.connect(g); g.connect(A.master);
}
export function clap(A: Audio, at: number, v = 0.45, p = 0): void {
  if (!ok(at)) return;
  const n = noiseAt(A, at, 0.3), bp = filt(A, 'bandpass', 1350, 0.8), g = A.ac.createGain(), pn = panner(A, p);
  g.gain.setValueAtTime(0.0001, at);
  for (let k = 0; k < 3; k++) {
    const t0 = at + k * 0.011;
    g.gain.setValueAtTime(v, t0);
    g.gain.exponentialRampToValueAtTime(v * 0.15, t0 + 0.009);
  }
  g.gain.setValueAtTime(v, at + 0.033);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
  n.connect(bp); bp.connect(g); g.connect(pn); pn.connect(A.master); send(A, pn, A.rev, 0.4);
}
export function hat(A: Audio, at: number, v = 0.1, open = false, p = 0.15): void {
  if (!ok(at)) return;
  const n = noiseAt(A, at, open ? 0.3 : 0.08), hp = filt(A, 'highpass', 7200), g = envG(A, at, v, 0.001, open ? 0.2 : 0.035), pn = panner(A, p);
  n.connect(hp); hp.connect(g); g.connect(pn); pn.connect(A.master);
}
export function shaker(A: Audio, at: number, v = 0.06, p = 0.2): void {
  if (!ok(at)) return;
  const n = noiseAt(A, at, 0.07), bp = filt(A, 'bandpass', 8200, 1.1), g = envG(A, at, v, 0.005, 0.045), pn = panner(A, p);
  n.connect(bp); bp.connect(g); g.connect(pn); pn.connect(A.master);
}
export function conga(A: Audio, at: number, m: number, v = 0.28, p = 0): void {
  if (!ok(at)) return;
  const f = midi(m), o = osc(A, 'sine', f * 1.4, at, 0.3);
  o.frequency.exponentialRampToValueAtTime(f, at + 0.03);
  const g = envG(A, at, v, 0.002, 0.2), pn = panner(A, p);
  o.connect(g); g.connect(pn);
  const n = noiseAt(A, at, 0.03), bp = filt(A, 'bandpass', f * 4, 2), ng = envG(A, at, v * 0.3, 0.001, 0.02);
  n.connect(bp); bp.connect(ng); ng.connect(pn);
  pn.connect(A.master); send(A, pn, A.rev, 0.12);
}
export function clave(A: Audio, at: number, v = 0.08, p = 0.35): void {
  if (!ok(at)) return;
  const o = osc(A, 'sine', 1750, at, 0.08);
  o.frequency.exponentialRampToValueAtTime(1500, at + 0.04);
  const g = envG(A, at, v, 0.001, 0.05), pn = panner(A, p);
  o.connect(g); g.connect(pn); pn.connect(A.master); send(A, pn, A.rev, 0.2);
}
export function tom(A: Audio, at: number, m: number, v = 0.45): void {
  if (!ok(at)) return;
  const f = midi(m), o = osc(A, 'sine', f * 1.9, at, 0.5);
  o.frequency.exponentialRampToValueAtTime(f, at + 0.1);
  const g = envG(A, at, v, 0.002, 0.35); o.connect(g); g.connect(A.master);
}

// ── bass & harmony ─────────────────────────────────────────────────────────
export function logDrum(A: Audio, at: number, m: number, v = 0.42, dur = 0.3): void {
  if (!ok(at)) return;
  const f = midi(m);
  const o = osc(A, 'sine', f * 1.9, at, dur + 0.1); o.frequency.exponentialRampToValueAtTime(f, at + 0.05);
  const o2 = osc(A, 'triangle', f * 3.8, at, dur + 0.1); o2.frequency.exponentialRampToValueAtTime(f * 2, at + 0.05);
  const pre = gainOf(A, 2.2), g2 = gainOf(A, 0.22), sh = A.ac.createWaveShaper();
  sh.curve = A.soft;
  const lp = filt(A, 'lowpass', 1100, 1.4), g = envG(A, at, v, 0.003, dur);
  o.connect(pre); o2.connect(g2); g2.connect(pre); pre.connect(sh); sh.connect(lp); lp.connect(g); g.connect(A.duck);
}
export function sawBass(A: Audio, at: number, m: number, dur = 0.2, v = 0.3): void {
  if (!ok(at)) return;
  const f = midi(m);
  const o1 = osc(A, 'sawtooth', f, at, dur + 0.05), o2 = osc(A, 'sawtooth', f * 1.007, at, dur + 0.05), sn = osc(A, 'sine', f, at, dur + 0.05);
  const lp = filt(A, 'lowpass', 150, 7);
  lp.frequency.setValueAtTime(150, at); lp.frequency.exponentialRampToValueAtTime(1300, at + 0.015); lp.frequency.exponentialRampToValueAtTime(220, at + dur);
  const g = envG(A, at, v, 0.004, dur), gs = envG(A, at, v * 1.2, 0.004, dur);
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(A.duck); sn.connect(gs); gs.connect(A.duck);
}
export function pad(A: Audio, from: number, to: number, notes: number[], v = 0.03, cut = 1500): void {
  if (to <= from || from < 0) return;
  const lp = filt(A, 'lowpass', cut, 0.7), g = A.ac.createGain();
  g.gain.setValueAtTime(0.0001, from);
  g.gain.exponentialRampToValueAtTime(v, from + Math.min(0.06, (to - from) / 3));
  g.gain.setValueAtTime(v, Math.max(from + 0.07, to - 0.08));
  g.gain.exponentialRampToValueAtTime(0.0001, to + 0.12);
  for (const m of notes) for (const d of [-10, 0, 10]) osc(A, 'sawtooth', midi(m) * Math.pow(2, d / 1200), from, to - from + 0.2).connect(lp);
  lp.connect(g); g.connect(A.duck); send(A, g, A.rev, 0.5);
}
export function stab(A: Audio, at: number, notes: number[], v = 0.08, dur = 0.3, cut = 3200): void {
  if (!ok(at)) return;
  const lp = filt(A, 'lowpass', cut, 2);
  lp.frequency.setValueAtTime(cut, at); lp.frequency.exponentialRampToValueAtTime(cut * 0.2, at + dur);
  const g = envG(A, at, v, 0.003, dur);
  for (const m of notes) for (const d of [-9, 9]) osc(A, 'sawtooth', midi(m) * Math.pow(2, d / 1200), at, dur + 0.05).connect(lp);
  lp.connect(g); g.connect(A.master); send(A, g, A.rev, 0.5);
}
export function marimba(A: Audio, at: number, m: number, v = 0.11, p = 0): void {
  if (!ok(at)) return;
  const f = midi(m), pn = panner(A, p);
  for (const [r, a, d] of [[1, 1, 0.42], [4, 0.26, 0.1], [10, 0.07, 0.04]]) {
    const o = osc(A, 'sine', f * r, at, d + 0.05), g = envG(A, at, v * a, 0.002, d);
    o.connect(g); g.connect(pn);
  }
  pn.connect(A.master); send(A, pn, A.dly, 0.35); send(A, pn, A.rev, 0.2);
}
export function pluck(A: Audio, at: number, m: number, v = 0.08, p = 0, cut = 4200): void {
  if (!ok(at)) return;
  const o = osc(A, 'square', midi(m), at, 0.3), o2 = osc(A, 'triangle', midi(m) * 2, at, 0.3);
  const lp = filt(A, 'lowpass', cut, 3);
  lp.frequency.setValueAtTime(cut, at); lp.frequency.exponentialRampToValueAtTime(400, at + 0.18);
  const g = envG(A, at, v, 0.002, 0.22), pn = panner(A, p);
  o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(pn); pn.connect(A.master); send(A, pn, A.dly, 0.6);
}
export function bell(A: Audio, at: number, m: number, v = 0.14): void {
  if (!ok(at)) return;
  const f = midi(m);
  for (const [r, a, d] of [[1, 1, 2.2], [2, 0.4, 1.4], [3.01, 0.2, 0.8], [4.16, 0.1, 0.5]]) {
    const o = osc(A, 'sine', f * r, at, d + 0.05), g = envG(A, at, v * a, 0.002, d);
    o.connect(g); g.connect(A.master); send(A, g, A.rev, 0.7);
  }
}

// ── FX ─────────────────────────────────────────────────────────────────────
export function crash(A: Audio, at: number, v = 0.24, dur = 1.8): void {
  if (!ok(at)) return;
  const n = noiseAt(A, at, dur + 0.1), hp = filt(A, 'highpass', 4800), g = envG(A, at, v, 0.002, dur);
  n.connect(hp); hp.connect(g); g.connect(A.master); send(A, g, A.rev, 0.6);
}
export function impact(A: Audio, at: number, v = 0.8): void {
  sub(A, at, v, 1.1);
  crash(A, at, 0.24, 1.8);
}
export function riser(A: Audio, from: number, to: number, v = 0.2): void {
  if (to - from < 0.05 || from < 0) return;
  const n = noiseAt(A, from, to - from), bp = filt(A, 'bandpass', 300, 2.5), g = A.ac.createGain();
  bp.frequency.setValueAtTime(300, from); bp.frequency.exponentialRampToValueAtTime(9000, to);
  g.gain.setValueAtTime(0.0001, from); g.gain.exponentialRampToValueAtTime(v, to - 0.01); g.gain.linearRampToValueAtTime(0, to);
  n.connect(bp); bp.connect(g); g.connect(A.master); send(A, g, A.rev, 0.5);
  const o = osc(A, 'sawtooth', 110, from, to - from), olp = filt(A, 'lowpass', 900), og = A.ac.createGain();
  o.frequency.exponentialRampToValueAtTime(880, to);
  og.gain.setValueAtTime(0.0001, from); og.gain.exponentialRampToValueAtTime(v * 0.22, to - 0.01); og.gain.linearRampToValueAtTime(0, to);
  o.connect(olp); olp.connect(og); og.connect(A.master);
}
export function whoosh(A: Audio, at: number, dur: number, v = 0.3, p0 = -0.8, p1 = 0.8, f0 = 500, f1 = 5000): void {
  if (!ok(at)) return;
  const n = noiseAt(A, at, dur + 0.05), bp = filt(A, 'bandpass', f0, 1.4), g = A.ac.createGain(), pn = panner(A, p0);
  bp.frequency.setValueAtTime(f0, at); bp.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(v, at + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  pn.pan.setValueAtTime(clamp(p0, -1, 1), at); pn.pan.linearRampToValueAtTime(clamp(p1, -1, 1), at + dur);
  n.connect(bp); bp.connect(g); g.connect(pn); pn.connect(A.master); send(A, pn, A.rev, 0.4);
}
export function swell(A: Audio, from: number, to: number, v = 0.22): void {
  if (to - from < 0.03 || from < 0) return;
  const n = noiseAt(A, from, to - from), hp = filt(A, 'highpass', 3000), g = A.ac.createGain();
  g.gain.setValueAtTime(0.0001, from); g.gain.exponentialRampToValueAtTime(v, to - 0.005); g.gain.linearRampToValueAtTime(0, to);
  n.connect(hp); hp.connect(g); g.connect(A.master);
}
export function shing(A: Audio, at: number, v = 0.22): void {
  if (!ok(at)) return;
  const n = noiseAt(A, at, 0.6), bp = filt(A, 'bandpass', 2500, 7), g = envG(A, at, v, 0.004, 0.5);
  bp.frequency.setValueAtTime(2500, at); bp.frequency.exponentialRampToValueAtTime(9500, at + 0.25);
  n.connect(bp); bp.connect(g); g.connect(A.master); send(A, g, A.rev, 0.6);
  for (const f of [2350, 3470, 5210]) {
    const o = osc(A, 'sine', f, at, 0.7), og = envG(A, at, v * 0.1, 0.002, 0.6);
    o.connect(og); og.connect(A.master); send(A, og, A.rev, 0.5);
  }
}
export function blip(A: Audio, at: number, m: number, v = 0.04, p = 0): void {
  if (!ok(at)) return;
  const o = osc(A, 'square', midi(m), at, 0.05), g = envG(A, at, v, 0.001, 0.035), pn = panner(A, p);
  o.connect(g); g.connect(pn); pn.connect(A.master);
}
export function pop(A: Audio, at: number, m: number, v = 0.16, p = 0): void {
  if (!ok(at)) return;
  const f = midi(m), o = osc(A, 'sine', f * 2.4, at, 0.18);
  o.frequency.exponentialRampToValueAtTime(f, at + 0.045);
  const g = envG(A, at, v, 0.002, 0.12), pn = panner(A, p);
  o.connect(g); g.connect(pn); pn.connect(A.master); send(A, pn, A.rev, 0.2);
}
export function keyclick(A: Audio, at: number, v = 0.06, p = 0): void {
  if (!ok(at)) return;
  const n = noiseAt(A, at, 0.03), bp = filt(A, 'bandpass', 3000 + rnd(at * 97, 1) * 2500, 1.8), g = envG(A, at, v, 0.001, 0.018), pn = panner(A, p);
  n.connect(bp); bp.connect(g); g.connect(pn); pn.connect(A.master);
}
export function zip(A: Audio, at: number, p = 0, v = 0.07): void {
  if (!ok(at)) return;
  const o = osc(A, 'sine', 420, at, 0.36);
  o.frequency.exponentialRampToValueAtTime(1900, at + 0.3);
  const g = A.ac.createGain();
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(v, at + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.33);
  const pn = panner(A, p);
  o.connect(g); g.connect(pn); pn.connect(A.master); send(A, pn, A.dly, 0.3);
}
export function bloop(A: Audio, from: number, to: number, f0: number, f1: number, v = 0.12): void {
  if (to <= from || from < 0) return;
  const o = osc(A, 'sine', f0, from, to - from + 0.06);
  o.frequency.exponentialRampToValueAtTime(f1, to);
  const g = A.ac.createGain();
  g.gain.setValueAtTime(0.0001, from); g.gain.exponentialRampToValueAtTime(v, from + (to - from) * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, to + 0.05);
  o.connect(g); g.connect(A.master); send(A, g, A.dly, 0.4);
}
