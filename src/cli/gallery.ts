import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TECHNIQUES } from '../engine/techniques';
import { validatePlan, formatIssues } from '../plan/validate';
import type { PlanInput } from '../plan/schema';
import { DEMO_BRAND } from '../plan/demo';
import { dataUrlToBuffer, launch, openReel } from './browser';

/** Render a contact sheet per technique from its catalog example. Returns the number of failures. */
export async function gallery(outDir: string, quick: boolean, only?: string[], log: (s: string) => void = console.log): Promise<number> {
  mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  let failures = 0;
  try {
    for (const t of TECHNIQUES) {
      if (only && !only.includes(t.id)) continue;
      const input: PlanInput = {
        meta: { title: 'Gallery', captions: true },
        brand: DEMO_BRAND,
        music: { bpm: 120 },
        sections: [{ technique: t.id, beats: t.beats.default, params: t.example as Record<string, unknown> }],
      };
      const res = validatePlan(input);
      if (!res.ok) {
        failures++;
        log(`✗ ${t.id}: example does not validate\n${formatIssues(res.errors)}`);
        continue;
      }
      const reel = await openReel(res.plan, browser);
      const n = quick ? 3 : 6, d = reel.duration;
      const times = Array.from({ length: n }, (_, k) => Math.round(((k + 0.5) / n) * d * 100) / 100);
      const png = await reel.page.evaluate(([ts]) => window.__reel!.sheet!(ts, 3), [times] as const);
      writeFileSync(join(outDir, `${t.id}.png`), dataUrlToBuffer(png));
      await reel.page.context().close();
      if (reel.errors.length) {
        failures++;
        log(`✗ ${t.id}: ${reel.errors.join(' | ')}`);
      } else log(`✓ ${t.id}`);
    }
  } finally {
    await browser.close();
  }
  return failures;
}
