// Browser entry point: window.MotionEngine.boot({ plan, land }).
import { formatIssues, validatePlan } from '../plan/validate';
import { setLand } from './assets/land';
import { startPlayer } from './player';
import { createEngine } from './render';

export interface BootOptions {
  plan: unknown;
  land?: number[];
}

function showErrors(text: string): void {
  const pre = document.createElement('pre');
  pre.textContent = `This plan has problems:\n\n${text}`;
  pre.style.cssText = 'position:fixed;inset:24px;margin:0;padding:24px;overflow:auto;background:#1a0d0b;color:#ffd9d0;font:14px/1.5 ui-monospace,monospace;border-radius:12px;z-index:9';
  document.body.appendChild(pre);
}

async function boot(opts: BootOptions): Promise<void> {
  const res = validatePlan(opts.plan);
  if (!res.ok) {
    const text = formatIssues(res.errors);
    showErrors(text);
    window.__reel = { ready: true, error: text };
    return;
  }
  if (res.warnings.length) console.warn(`[motion] plan warnings:\n${formatIssues(res.warnings)}`);
  setLand(opts.land);
  const f = res.plan.brand.fonts;
  await Promise.all([
    document.fonts.load(`800 100px "${f.display}"`),
    document.fonts.load(`500 20px "${f.mono}"`),
    f.serif ? document.fonts.load(`italic 400 100px "${f.serif}"`) : Promise.resolve(),
    f.serif ? document.fonts.load(`400 100px "${f.serif}"`) : Promise.resolve(),
  ]);
  startPlayer(createEngine(res.plan));
}

(window as unknown as { MotionEngine: { boot: typeof boot } }).MotionEngine = { boot };
