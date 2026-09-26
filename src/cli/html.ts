import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontEntry } from '../plan/fonts';
import type { Plan } from '../plan/schema';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
/** Package root (dist/cli.js → ..). */
export const ROOT = join(here, '..');

function fontFile(pkg: string, file: string): string {
  const dir = dirname(require.resolve(`${pkg}/package.json`));
  return readFileSync(join(dir, 'files', file)).toString('base64');
}

function fontFaces(plan: Plan): string {
  const f = plan.brand.fonts, out: string[] = [];
  for (const family of [f.display, f.mono, f.serif].filter(Boolean) as string[]) {
    const e = fontEntry(family);
    if (!e) continue;
    const w = e.min === e.max ? `${e.min}` : `${e.min} ${e.max}`;
    out.push(`@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${fontFile(e.pkg, e.file)}) format("woff2");font-weight:${w};font-style:normal;font-display:block}`);
    if (e.italicFile) out.push(`@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${fontFile(e.pkg, e.italicFile)}) format("woff2");font-weight:${w};font-style:italic;font-display:block}`);
  }
  return out.join('\n');
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A single self-contained HTML file: fonts, engine, plan and (if needed) map data inlined. */
export function buildHtml(plan: Plan): string {
  const engine = readFileSync(join(ROOT, 'dist', 'engine.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const needsLand = plan.sections.some(s => s.technique === 'dot-globe');
  const land = needsLand ? readFileSync(join(ROOT, 'assets', 'land-dots.json'), 'utf8') : '[]';
  const c = plan.brand.colors;
  const data = JSON.stringify(plan).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(plan.brand.name)} — ${esc(plan.meta.title)}</title>
<style>
${fontFaces(plan)}
:root{color-scheme:dark;--bg:${c.bg};--text:${c.text};--primary:${c.primary}}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#050506;color:var(--text);overflow:hidden}
body{display:grid;place-items:center;font-family:"${plan.brand.fonts.display}",system-ui,sans-serif}
#stage{position:relative;width:min(100vw,calc(100vh*16/9));aspect-ratio:16/9}
canvas{position:absolute;inset:0;width:100%;height:100%;display:block;background:var(--bg);cursor:pointer;transition:filter .4s ease}
body.idle canvas{filter:brightness(.4) saturate(.85)}
#play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:14px;padding:18px 30px 18px 22px;font:700 15px/1 "${plan.brand.fonts.display}",system-ui,sans-serif;letter-spacing:.02em;color:var(--text);background:var(--primary);border:0;border-radius:999px;cursor:pointer;box-shadow:0 10px 40px color-mix(in srgb,var(--primary) 45%,transparent);transition:opacity .25s,transform .25s}
#play:hover{transform:translate(-50%,-50%) scale(1.04)}
#play i{width:30px;height:30px;border-radius:50%;background:var(--text);display:grid;place-items:center}
#play i::before{content:"";margin-left:3px;border-left:10px solid var(--primary);border-top:6px solid transparent;border-bottom:6px solid transparent}
#play small{font-weight:500;opacity:.8}
body.ended #play,body.paused #play{top:auto;bottom:6%;transform:translateX(-50%)}
body.ended #play:hover,body.paused #play:hover{transform:translateX(-50%) scale(1.04)}
#hint{position:fixed;bottom:12px;left:0;right:0;text-align:center;font:500 10px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;opacity:.4;pointer-events:none}
body.playing #play,body.playing #hint{opacity:0;pointer-events:none}
body.export #play,body.export #hint{display:none}
</style>
</head>
<body class="idle">
<div id="stage">
<canvas id="c" aria-label="${esc(plan.brand.name)} motion piece"></canvas>
<button id="play" type="button"><i></i><span id="playLabel">Play</span><small>sound on</small></button>
</div>
<div id="hint">space play / pause · r restart · ← → step frame · m mute</div>
<script>${engine}</script>
<script>MotionEngine.boot({plan:${data},land:${land}});</script>
</body>
</html>
`;
}
