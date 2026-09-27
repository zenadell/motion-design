import type { z } from 'zod';
import { checkCustom } from '../engine/custom/stage';
import { getTechnique, techniqueIds } from '../engine/techniques';
import { PlanSchema, type Plan } from './schema';

export interface Issue {
  path: string;
  message: string;
}
export type ValidationResult =
  | { ok: true; plan: Plan; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

const pathOf = (p: PropertyKey[]): string =>
  p.reduce<string>((s, k) => (typeof k === 'number' ? `${s}[${k}]` : s ? `${s}.${String(k)}` : String(k)), '');

function issues(err: z.ZodError): Issue[] {
  return err.issues.map(i => ({ path: pathOf(i.path), message: i.message }));
}

function closest(id: string, options: string[]): string | undefined {
  const d = (a: string, b: string) => {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  };
  const best = options.map(o => [o, d(id, o)] as const).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= Math.max(3, id.length / 2) ? best[0] : undefined;
}

/**
 * Validate a plan and fill every default. Error paths/messages are written to
 * be fed straight back to a model so it can repair its own output.
 */
export function validatePlan(input: unknown): ValidationResult {
  const warnings: Issue[] = [];
  const base = PlanSchema.safeParse(input);
  if (!base.success) return { ok: false, errors: issues(base.error), warnings };
  const plan = base.data;
  const errors: Issue[] = [];
  const ids = techniqueIds();
  const sceneIds = new Set((plan.custom?.scenes ?? []).map(c => c.id));
  plan.custom?.scenes.forEach((c, i) => {
    if (plan.custom!.scenes.findIndex(o => o.id === c.id) !== i) errors.push({ path: `custom.scenes[${i}].id`, message: `duplicate scene id "${c.id}"` });
  });
  errors.push(...checkCustom(plan.custom));
  plan.sections.forEach((s, i) => {
    const at = `sections[${i}]`;
    if (s.technique.startsWith('scene:')) {
      const id = s.technique.slice(6);
      if (!sceneIds.has(id)) errors.push({ path: `${at}.technique`, message: `no custom scene "${id}"; defined: ${[...sceneIds].join(', ') || '(none)'}` });
      if (Math.abs(s.beats * 4 - Math.round(s.beats * 4)) > 1e-6) warnings.push({ path: `${at}.beats`, message: 'not on the 16th-note grid; cuts will drift off the beat' });
      return;
    }
    const t = getTechnique(s.technique);
    if (!t) {
      const hint = closest(s.technique, ids);
      errors.push({ path: `${at}.technique`, message: `unknown technique "${s.technique}"${hint ? ` — did you mean "${hint}"?` : ''}. Valid: ${ids.join(', ')}` });
      return;
    }
    const r = t.params.safeParse(s.params);
    if (!r.success) errors.push(...r.error.issues.map(e => ({ path: `${at}.params${e.path.length ? '.' + pathOf(e.path) : ''}`, message: e.message })));
    else s.params = r.data as Record<string, unknown>;
    if (s.beats < t.beats.min || s.beats > t.beats.max)
      errors.push({ path: `${at}.beats`, message: `${t.id} needs ${t.beats.min === t.beats.max ? `exactly ${t.beats.min}` : `${t.beats.min}–${t.beats.max}`} beats (got ${s.beats})` });
    if (Math.abs(s.beats * 4 - Math.round(s.beats * 4)) > 1e-6) warnings.push({ path: `${at}.beats`, message: 'not on the 16th-note grid; cuts will drift off the beat' });
    const tr = typeof s.transition === 'string' ? { type: s.transition, beats: 0.5 } : s.transition;
    if (tr && tr.type !== 'cut') {
      const next = plan.sections[i + 1];
      if (!next) warnings.push({ path: `${at}.transition`, message: 'the last section has nothing to transition into; ignored' });
      else if (tr.beats > s.beats || tr.beats > next.beats) errors.push({ path: `${at}.transition.beats`, message: 'a transition cannot be longer than either section it joins' });
    }
  });
  const total = plan.sections.reduce((a, s) => a + s.beats, 0) * (60 / plan.music.bpm);
  if (total > 90) warnings.push({ path: 'sections', message: `total length ${total.toFixed(1)} s is long for a motion piece` });
  const last = getTechnique(plan.sections[plan.sections.length - 1].technique);
  if (last && last.category !== 'outro' && last.category !== 'custom') warnings.push({ path: `sections[${plan.sections.length - 1}]`, message: 'consider ending on an outro technique (end-card or signature-card)' });
  return errors.length ? { ok: false, errors, warnings } : { ok: true, plan, warnings };
}

export function formatIssues(list: Issue[]): string {
  return list.map(i => `• ${i.path || '(plan)'}: ${i.message}`).join('\n');
}
