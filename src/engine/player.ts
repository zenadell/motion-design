// Interactive playback + the automation API used by the CLI renderer.
import { clamp, pad2 } from './core/math';
import { H, W } from './core/draw';
import type { Engine } from './render';

export interface ReelAPI {
  ready: boolean;
  error?: string;
  duration: number;
  fps: number;
  sections: Engine['sections'];
  frame(i: number, sub?: number): string;
  still(t: number, sub?: number): string;
  /** A scaled-down JPEG of the frame at `t` (for vision-model review). */
  thumb(t: number, width?: number, sub?: number): string;
  render(t: number, sub?: number): void;
  sheet(times: number[], cols?: number, sub?: number): string;
  wav(): Promise<string>;
  now(): number;
}

declare global {
  interface Window {
    __reel?: Partial<ReelAPI>;
  }
}

function wavBytes(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length;
  const dv = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, len * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++)
    for (let c = 0; c < ch; c++) {
      const s = clamp(data[c][i], -1, 1);
      dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return new Uint8Array(dv.buffer);
}
function b64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + 0x8000)));
  return btoa(s);
}

export function startPlayer(engine: Engine): void {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const body = document.body, btn = document.getElementById('play'), label = document.getElementById('playLabel');
  const params = new URLSearchParams(location.search);
  const D = engine.duration;
  const soundPromise = engine.renderSoundtrack().catch(e => {
    console.warn('[motion] audio render failed', e);
    return null;
  });
  let soundBuf: AudioBuffer | null = null;
  let actx: AudioContext | null = null, gainN: GainNode | null = null, srcN: AudioBufferSourceNode | null = null;
  let muted = false, playing = false, playhead = 0, startClock = 0;
  void soundPromise.then(b => (soundBuf = b));

  const clockNow = (): number => {
    if (actx) {
      const ts = actx.getOutputTimestamp?.();
      if (ts && ts.contextTime && ts.performanceTime) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      return actx.currentTime;
    }
    return performance.now() / 1000;
  };
  const curT = () => (playing ? clamp(playhead + clockNow() - startClock, 0, D) : playhead);
  const setState = (s: 'idle' | 'playing' | 'paused' | 'ended') => {
    body.classList.remove('idle', 'playing', 'paused', 'ended');
    body.classList.add(s);
    if (label) label.textContent = s === 'ended' ? 'Replay' : s === 'paused' ? 'Resume' : 'Play';
  };
  const stopSrc = () => {
    if (srcN) {
      try { srcN.stop(); } catch { /* already stopped */ }
      srcN.disconnect();
      srcN = null;
    }
  };
  async function play(): Promise<void> {
    if (playhead >= D - 1e-3) playhead = 0;
    if (!soundBuf && label) label.textContent = 'Loading…';
    try {
      if (!actx) {
        actx = new AudioContext();
        gainN = actx.createGain();
        gainN.connect(actx.destination);
      }
      const wait = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<undefined>(r => setTimeout(r, ms))]);
      if (actx.state !== 'running') await wait(actx.resume(), 800);
      if (actx.state !== 'running') throw new Error('audio output unavailable — playing silently');
      gainN!.gain.value = muted ? 0 : 1;
      if (!soundBuf) soundBuf = (await wait(soundPromise, 8000)) ?? null;
    } catch (e) {
      console.info((e as Error).message ?? e);
      void actx?.close().catch(() => undefined);
      actx = null;
    }
    if (actx && soundBuf) {
      srcN = actx.createBufferSource();
      srcN.buffer = soundBuf;
      srcN.connect(gainN!);
      startClock = actx.currentTime + 0.05;
      srcN.start(startClock, playhead);
    } else startClock = clockNow();
    playing = true;
    setState('playing');
    requestAnimationFrame(tick);
  }
  function pause(): void {
    if (!playing) return;
    playhead = curT();
    playing = false;
    stopSrc();
    setState('paused');
    engine.renderFrame(g, playhead);
  }
  function tick(): void {
    if (!playing) return;
    const t = curT();
    engine.renderFrame(g, t);
    if (t >= D) {
      playing = false;
      playhead = D;
      stopSrc();
      setState('ended');
      return;
    }
    requestAnimationFrame(tick);
  }
  function seek(t: number): void {
    const was = playing;
    if (was) { playing = false; stopSrc(); }
    playhead = clamp(t, 0, D);
    engine.renderFrame(g, playhead);
    if (was) void play();
    else setState(playhead >= D ? 'ended' : 'paused');
  }
  const toggle = () => (playing ? pause() : void play());

  btn?.addEventListener('click', e => { e.stopPropagation(); void play(); });
  canvas.addEventListener('click', toggle);
  window.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'r' || e.key === 'R') seek(0);
    else if (e.key === 'm' || e.key === 'M') { muted = !muted; if (gainN) gainN.gain.value = muted ? 0 : 1; }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (playing) pause();
      seek(playhead + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / engine.fps));
    }
  });

  const api: ReelAPI = {
    ready: false,
    duration: D,
    fps: engine.fps,
    sections: engine.sections,
    frame(i, sub = 6) { engine.renderFrame(g, i / engine.fps, sub); return canvas.toDataURL('image/png'); },
    still(t, sub = 1) { engine.renderFrame(g, t, sub); return canvas.toDataURL('image/png'); },
    thumb(t, width = 960, sub = 1) {
      engine.renderFrame(g, t, sub);
      const c = document.createElement('canvas');
      c.width = width; c.height = Math.round((width * H) / W);
      c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.85);
    },
    render(t, sub = 1) { engine.renderFrame(g, t, sub); },
    sheet(times, cols = 3, sub = 1) {
      const cw = 640, ch = 360, lab = 30, rows = Math.ceil(times.length / cols);
      const sc = document.createElement('canvas');
      sc.width = cols * cw; sc.height = rows * (ch + lab);
      const sg = sc.getContext('2d')!;
      sg.fillStyle = '#1b1b1f'; sg.fillRect(0, 0, sc.width, sc.height);
      times.forEach((t, k) => {
        engine.renderFrame(g, t, sub);
        const x = (k % cols) * cw, y = Math.floor(k / cols) * (ch + lab);
        sg.drawImage(canvas, x, y + lab, cw - 2, ch - 2);
        const sec = engine.sections.find(s => t >= s.start && t < s.end) ?? engine.sections[engine.sections.length - 1];
        sg.fillStyle = '#e8e6e1'; sg.font = '600 15px ui-monospace, monospace';
        sg.fillText(`${t.toFixed(2)}s · #${pad2(sec.index)} ${sec.technique}`, x + 10, y + 21);
      });
      return sc.toDataURL('image/png');
    },
    async wav() {
      const buf = await soundPromise;
      if (!buf) throw new Error('audio render failed');
      return b64(wavBytes(buf));
    },
    now: () => curT(),
  };
  window.__reel = api;

  if (params.has('export')) body.classList.add('export');
  if (params.has('t')) {
    playhead = clamp(parseFloat(params.get('t')!) || 0, 0, D);
    engine.renderFrame(g, playhead, 6);
    setState('paused');
  } else {
    engine.renderFrame(g, Math.max(0, D - 0.1));
    setState('idle');
  }
  api.ready = true;
}
