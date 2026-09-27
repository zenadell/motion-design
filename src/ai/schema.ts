import { z } from 'zod';
import { TECHNIQUES } from '../engine/techniques';
import { TRANSITIONS } from '../plan/schema';

// Gemini's structured output accepts a subset of JSON Schema. These helpers
// turn our zod schemas into that subset: unsupported keywords are dropped and
// the limits a model should still respect (lengths, defaults, patterns) move
// into the description, where the model reads them. The validator enforces
// the real limits afterwards.

type S = Record<string, unknown>;

const KEEP = new Set(['type', 'properties', 'required', 'items', 'prefixItems', 'minItems', 'maxItems', 'enum', 'anyOf', 'description', 'minimum', 'maximum', 'title', 'nullable']);

export function toGeminiSchema(input: unknown): S {
  if (Array.isArray(input)) return input.map(toGeminiSchema) as unknown as S;
  if (!input || typeof input !== 'object') return input as S;
  const s = input as S;
  const out: S = {};
  const notes: string[] = [];
  for (const [k, v] of Object.entries(s)) {
    if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v as S).map(([p, sub]) => [p, toGeminiSchema(sub)]));
    else if (k === 'items' || k === 'anyOf' || k === 'prefixItems') {
      if (v && typeof v === 'object') out[k] = toGeminiSchema(v);
    }
    else if (k === 'const') out.enum = [v];
    else if (KEEP.has(k)) out[k] = v;
    else if (k === 'maxLength') notes.push(`at most ${v} characters`);
    else if (k === 'minLength' && (v as number) > 1) notes.push(`at least ${v} characters`);
    else if (k === 'default' && v !== undefined && !(typeof v === 'object' && v && !Object.keys(v).length)) notes.push(`default ${JSON.stringify(v)}`);
    else if (k === 'pattern' && s.description === undefined) notes.push(`pattern ${v}`);
  }
  // Integer bounds zod emits for .int() without limits are noise.
  if (typeof out.minimum === 'number' && out.minimum <= -Number.MAX_SAFE_INTEGER) delete out.minimum;
  if (typeof out.maximum === 'number' && out.maximum >= Number.MAX_SAFE_INTEGER) delete out.maximum;
  if (notes.length) out.description = [out.description, `(${notes.join('; ')})`].filter(Boolean).join(' ');
  // A property with a default is optional for the model.
  if (Array.isArray(out.required) && s.properties) {
    const raw = s.properties as Record<string, S>;
    out.required = (out.required as string[]).filter(r => raw[r] && raw[r].default === undefined);
    if (!(out.required as string[]).length) delete out.required;
  }
  return out;
}

const js = (t: z.ZodType) => z.toJSONSchema(t, { io: 'input', unrepresentable: 'any' });

/** One schema branch per technique, so params are typed by the technique the model picks. */
function sectionBranch(t: (typeof TECHNIQUES)[number]): S {
  const params = toGeminiSchema(js(t.params));
  const hasParams = params.properties && Object.keys(params.properties as S).length > 0;
  const props: S = {
    technique: { type: 'string', enum: [t.id] },
    beats: { type: 'number', minimum: t.beats.min, maximum: t.beats.max, description: t.beats.min === t.beats.max ? `exactly ${t.beats.min}` : `default ${t.beats.default}` },
  };
  if (hasParams) props.params = params;
  props.energy = { type: 'integer', minimum: 0, maximum: 3, description: `optional; default ${t.energy}` };
  props.transition = { type: 'string', enum: [...TRANSITIONS], description: 'optional; how this section hands over to the next' };
  props.label = { type: 'string', description: 'optional HUD chapter label, 1–2 words, uppercase' };
  const required = ['technique', 'beats'];
  if (hasParams && Array.isArray(params.required)) required.push('params');
  return { type: 'object', properties: props, required };
}

/**
 * The shape the planner model returns. The brand is not part of it: the
 * pipeline injects the extracted brand, so the model can't alter colours or
 * the logo, and doesn't spend tokens repeating them.
 */
export function plannerSchema(strict = true): S {
  const section: S = strict
    ? { anyOf: TECHNIQUES.map(sectionBranch) }
    : {
        type: 'object',
        properties: {
          technique: { type: 'string', enum: TECHNIQUES.map(t => t.id) },
          beats: { type: 'number' },
          params: { type: 'object', description: 'technique params exactly as in the catalog' },
          energy: { type: 'integer', minimum: 0, maximum: 3 },
          transition: { type: 'string', enum: [...TRANSITIONS] },
          label: { type: 'string' },
        },
        required: ['technique', 'beats'],
      };
  return {
    type: 'object',
    properties: {
      concept: { type: 'string', description: 'One or two sentences: the idea and the arc of this piece' },
      title: { type: 'string', description: 'Short title for the HUD footer, e.g. "Showreel" or "Launch"' },
      music: {
        type: 'object',
        properties: {
          bpm: { type: 'number', minimum: 90, maximum: 140 },
          genre: { type: 'string', enum: ['afro-house', 'electro'] },
          progression: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8, description: 'optional chord symbols, one per bar' },
        },
        required: ['bpm', 'genre'],
      },
      sections: { type: 'array', items: section, minItems: 3, maxItems: 30 },
    },
    required: ['concept', 'title', 'music', 'sections'],
  };
}

/** The planner's reply, before the brand is merged in. */
export interface PlannerReply {
  concept?: string;
  title?: string;
  music?: { bpm?: number; genre?: string; progression?: string[] };
  sections?: unknown[];
}
