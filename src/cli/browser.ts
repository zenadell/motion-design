import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import type { Plan } from '../plan/schema';
import type { SectionInfo } from '../engine/render';
import { buildHtml } from './html';

// window.__reel is typed by the engine's player module (src/engine/player.ts).
export type { SectionInfo };

export interface Reel {
  browser: Browser;
  url: string;
  duration: number;
  fps: number;
  sections: SectionInfo[];
  errors: string[];
  page: Page;
  /** Open another independent page on the same reel (for parallel rendering). */
  open(): Promise<Page>;
  close(): Promise<void>;
}

export async function launch(): Promise<Browser> {
  const executablePath = process.env.MOTION_CHROMIUM_PATH || undefined;
  // SwiftShader gives headless Chromium WebGL 2 (for the 3D bundle) without a GPU
  return chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}

/** Write the plan's HTML to a temp file and open it in headless Chromium, ready to render. */
export async function openReel(plan: Plan, browser?: Browser): Promise<Reel> {
  const dir = mkdtempSync(join(tmpdir(), 'motion-'));
  const file = join(dir, 'reel.html');
  writeFileSync(file, buildHtml(plan));
  const url = pathToFileURL(file).href + '?export=1';
  const b = browser ?? (await launch());
  const errors: string[] = [];
  const open = async (): Promise<Page> => {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    // The reel is fully self-contained; model-written scene code gets no network.
    await ctx.route(/^(https?|wss?):/, r => r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    await page.waitForFunction(() => window.__reel?.ready, null, { timeout: 60_000 });
    const err = await page.evaluate(() => window.__reel?.error);
    if (err) throw new Error(err);
    return page;
  };
  const page = await open();
  const info = await page.evaluate(() => ({ duration: window.__reel!.duration!, fps: window.__reel!.fps!, sections: window.__reel!.sections! }));
  return { browser: b, url, ...info, errors, page, open, close: () => b.close() };
}

export const dataUrlToBuffer = (d: string): Buffer => Buffer.from(d.slice(d.indexOf(',') + 1), 'base64');
