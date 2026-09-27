import type { Browser } from 'playwright';
import { dataUrlToBuffer, openReel, type SectionInfo } from '../cli/browser';
import type { Plan } from '../plan/schema';
import type { BrandKit } from './brand-kit';
import { image, parseJson, text, user, type LLM, type Part } from './llm';
import { criticSystem, paramsDigest } from './prompts';

// Visual QA: render settled frames of every section, show them to a vision
// model with the plan, get back concrete problems phrased as plan edits.

export interface CritiqueIssue {
  section: number;
  severity: 'high' | 'medium' | 'low';
  problem: string;
  fix: string;
}

export interface Critique {
  score: number;
  summary: string;
  issues: CritiqueIssue[];
}

export const critiqueSchema = () => ({
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 1, maximum: 10 },
    summary: { type: 'string', description: 'One or two sentences on the draft as a whole' },
    issues: {
      type: 'array',
      description: 'at most 12, most important first',
      items: {
        type: 'object',
        properties: {
          section: { type: 'integer', description: 'section index as labelled on the frame' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          problem: { type: 'string' },
          fix: { type: 'string', description: 'the concrete plan change' },
        },
        required: ['section', 'severity', 'problem', 'fix'],
      },
    },
  },
  required: ['score', 'summary', 'issues'],
});

/** One settled frame per section (two for long ones), away from transitions. */
export function reviewTimes(sections: SectionInfo[]): { t: number; index: number }[] {
  const out: { t: number; index: number }[] = [];
  for (const s of sections) {
    const d = s.end - s.start;
    const at = d >= 3 ? [0.45, 0.85] : [0.72];
    for (const f of at) out.push({ t: Math.round((s.start + d * f) * 100) / 100, index: s.index });
  }
  return out;
}

export function reviewPrompt(plan: Plan, kit: BrandKit, frames: { t: number; index: number; technique: string; jpeg: Buffer }[]): Part[] {
  const slim = { ...plan, brand: { ...plan.brand, logo: plan.brand.logo ? '(vector mark)' : undefined } };
  const parts: Part[] = [
    text(`PLAN\n${JSON.stringify(slim)}`),
    text(`BRAND FACTS\n${JSON.stringify(kit.facts)}`),
    text(`TECHNIQUE PARAMS\n${paramsDigest(plan.sections.map(s => s.technique))}`),
  ];
  for (const f of frames) parts.push(text(`FRAME t=${f.t.toFixed(2)}s · section ${f.index} (${f.technique})`), image(f.jpeg, 'image/jpeg'));
  parts.push(text('Review the draft.'));
  return parts;
}

export function needsRevision(c: Critique): boolean {
  return c.score < 8 || c.issues.some(i => i.severity === 'high');
}

export function revisionMessage(c: Critique): string {
  const list = c.issues.filter(i => i.severity !== 'low');
  return `A senior designer reviewed frames rendered from your plan: ${c.score}/10. ${c.summary}

Revise the plan to fix these problems. Keep what works, keep the total length, and return the complete plan.
${list.map(i => `- section ${i.section} [${i.severity}]: ${i.problem} → ${i.fix}`).join('\n')}`;
}

export async function review(llm: LLM, plan: Plan, kit: BrandKit, o: { browser?: Browser; log?: (s: string) => void; width?: number } = {}) {
  const reel = await openReel(plan, o.browser);
  try {
    const times = reviewTimes(reel.sections);
    const frames = [];
    for (const { t, index } of times) {
      const url = await reel.page.evaluate(([x, w]) => window.__reel!.thumb!(x, w), [t, o.width ?? 768] as const);
      frames.push({ t, index, technique: reel.sections[index].technique, jpeg: dataUrlToBuffer(url) });
    }
    o.log?.(`  reviewing ${frames.length} frames…`);
    const reply = await llm.json({ label: 'review', system: criticSystem(), turns: [user(...reviewPrompt(plan, kit, frames))], schema: critiqueSchema(), effort: 'low' });
    const c = parseJson<Critique>(reply.text);
    const critique: Critique = {
      score: Math.max(1, Math.min(10, Math.round(Number(c.score) || 1))),
      summary: String(c.summary ?? ''),
      issues: (Array.isArray(c.issues) ? c.issues : []).filter(i => i && typeof i.problem === 'string'),
    };
    return { critique, usage: reply.usage, frames: frames.length, errors: reel.errors, raw: reply.text };
  } finally {
    if (o.browser) await reel.page.context().close();
    else await reel.close();
  }
}
