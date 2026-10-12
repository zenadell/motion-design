import type { BrandKit } from '../ai/brand-kit';
import { image, parseJson, user, type LLM, type Usage } from '../ai/llm';
import { validatePlan, formatIssues } from '../plan/validate';
import type { Plan } from '../plan/schema';
import { describe } from './ops';

// "Make this exact video for my business": a measured copy keeps every
// element's motion as keyframes, with the reference's pixels as sprites. A
// vision model looks at each sprite and says what it is and what the brand's
// version is; code swaps the sprite for a text, logo or shape layer and keeps
// the measured keyframes, so the motion stays exact and only the content changes.

export interface Decision {
  id: string;
  kind: 'text' | 'logo' | 'shape' | 'keep' | 'hide';
  text?: string;
  color?: string;
  weight?: number;
  font?: 'display' | 'serif' | 'mono';
}

const SYSTEM = `You adapt a measured copy of a motion design film to a new brand.
Each element of the film was cut out of the reference as an image ("sprite") and keeps its measured motion.
For every element you are shown, decide what the brand's version is:
- "text": the sprite is words. Give the brand's words for that slot (same role: a headline stays a headline, a price stays a price; similar length, so it fits the same box). Use only facts from the brand and brief; never invent numbers or claims.
- "logo": the sprite is the reference's logo or brand mark → the brand's logo.
- "shape": a plain shape, bar, card or button background → a flat shape in a brand colour.
- "keep": decoration that suits any brand (lines, dots, abstract graphics), or a product photo you cannot replace.
- "hide": something that only makes sense for the reference brand and has no counterpart.
Colours are brand roles: bg, surface, text, muted, primary, secondary, accent, dark, light. Keep the reference's contrast: light words on dark stay light-on-dark.
Reply with JSON only: { "background": role, "elements": [ { "id", "kind", "text"?, "color"?, "weight"? (100–900), "font"? ("display" | "serif" | "mono") } ] }.`;

export const ADAPT_SCHEMA = {
  type: 'object',
  properties: {
    background: { type: 'string' },
    elements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['text', 'logo', 'shape', 'keep', 'hide'] },
          text: { type: 'string' },
          color: { type: 'string' },
          weight: { type: 'integer' },
          font: { type: 'string', enum: ['display', 'serif', 'mono'] },
        },
        required: ['id', 'kind'],
      },
    },
  },
  required: ['elements'],
};

const ROLES = new Set(['bg', 'surface', 'text', 'muted', 'primary', 'secondary', 'accent', 'dark', 'light']);
type Json = Record<string, unknown>;

/** Width and height of a PNG data URL. */
export function pngSize(dataUrl: string): [number, number] | null {
  const b = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 1 + 64), 'base64');
  return b.length >= 24 && b.toString('ascii', 1, 4) === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
}

/** The layer that replaces a sprite: same id, timing and keyframes; new content. */
export function replaceSprite(layer: Json, d: Decision, size: [number, number]): Json | null {
  if (d.kind === 'keep') return layer;
  if (d.kind === 'hide') return null;
  const motion: Json = {};
  for (const k of ['id', 'name', 'in', 'out', 'position', 'scale', 'rotation', 'opacity', 'clip', 'z', 'parent', 'blend']) if (layer[k] !== undefined) motion[k] = layer[k];
  const [w, h] = [Math.max(8, size[0] - 12), Math.max(8, size[1] - 12)]; // sprites carry 6 px of padding
  const color = d.color && (ROLES.has(d.color) || /^#[0-9a-f]{6}$/i.test(d.color)) ? d.color : 'text';
  if (d.kind === 'logo') return { ...motion, type: 'logo', size: Math.round(h * 0.92), color };
  if (d.kind === 'shape') return { ...motion, type: 'rect', size: [w, h], radius: Math.round(Math.min(w, h) * 0.18), fill: color };
  const text = (d.text ?? '').trim() || 'TEXT';
  const lines = text.split('\n');
  const longest = Math.max(...lines.map(l => l.length));
  const caps = text === text.toUpperCase();
  // fit the measured box: cap height ≈ 0.72 em for capitals, ≈ 0.9 em with ascenders and descenders;
  // an average glyph is ≈ 0.6 em wide in the display faces
  const byHeight = h / lines.length / (caps ? 0.74 : 0.92);
  const byWidth = w / Math.max(1, longest * 0.6);
  return { ...motion, type: 'text', text, font: d.font ?? 'display', weight: d.weight ?? 800, color, size: Math.round(Math.max(10, Math.min(byHeight, byWidth))), lineHeight: 1.05 };
}

export interface AdaptResult { plan: Plan; decisions: Decision[]; usage: Usage[] }

/** Ask the model what each element is for the brand, and rebuild the comp around the measured motion. */
export async function adapt(llm: LLM, copy: Plan, kit: BrandKit, brief = '', maxElements = 30): Promise<AdaptResult> {
  const comp = copy.studio?.comps[0];
  if (!comp) throw new Error('the plan has no studio comp to adapt (make one with motion studio copy)');
  const assets = copy.studio!.assets;
  const sprites = (comp.layers as unknown as Json[]).filter(l => l.type === 'image' && String(l.src).startsWith('asset:') && !String(l.id).startsWith('plate-'));
  const sized = sprites
    .map(l => ({ l, size: pngSize(assets[String(l.src).slice(6)] ?? '') }))
    .filter((x): x is { l: Json; size: [number, number] } => !!x.size)
    .sort((a, b) => b.size[0] * b.size[1] - a.size[0] * a.size[1])
    .slice(0, maxElements);
  const parts = [
    `BRAND\n${JSON.stringify({ ...kit.brand, logo: kit.brand.logo ? '(has a logo)' : '(monogram)' })}\nFACTS\n${JSON.stringify(kit.facts)}\nBRIEF\n${brief || '(none: keep the reference\'s message, in the brand\'s words)'}`,
    `THE FILM (measured)\n${describe(copy)}`,
    ...sized.flatMap(({ l, size }) => [`ELEMENT ${l.id} · ${size[0]}×${size[1]} px · ${l.name ?? ''}`, image(Buffer.from(String(assets[String(l.src).slice(6)]).split(',')[1], 'base64'))]),
  ];
  const reply = await llm.json({ label: 'adapt elements', system: SYSTEM, turns: [user(...parts)], schema: ADAPT_SCHEMA, effort: 'low' });
  const out = parseJson<{ background?: string; elements?: Decision[] }>(reply.text);
  const decisions = (out.elements ?? []).filter(d => sized.some(s => s.l.id === d.id));
  const byId = new Map(decisions.map(d => [d.id, d]));
  const layers = (comp.layers as unknown as Json[]).flatMap(l => {
    const d = byId.get(String(l.id));
    const s = sized.find(x => x.l.id === l.id);
    if (!d || !s) return [l];
    const r = replaceSprite(l, d, s.size);
    return r ? [r] : [];
  });
  const plan = structuredClone(copy) as unknown as Json;
  plan.brand = kit.brand;
  const c0 = (plan.studio as { comps: Json[] }).comps[0];
  c0.layers = layers;
  if (out.background && ROLES.has(out.background)) c0.background = out.background;
  plan.music = { ...(plan.music as Json), volume: 1 };
  (plan.sections as Json[]).forEach(s => (s.energy = 2));
  const used = new Set(layers.map(l => String(l.src ?? '').slice(6)));
  const st = plan.studio as { assets: Record<string, string> };
  st.assets = Object.fromEntries(Object.entries(st.assets).filter(([id]) => used.has(id)));
  const v = validatePlan(plan);
  if (!v.ok) throw new Error(`the adapted plan does not validate:\n${formatIssues(v.errors)}`);
  return { plan: v.plan, decisions, usage: [reply.usage] };
}
