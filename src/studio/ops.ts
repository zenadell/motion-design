import { validatePlan, type Issue } from '../plan/validate';
import { isKeys, keyTimes } from './anim';
import { snapComp } from './rhythm';
import type { Ease, Layer } from './schema';

// The studio's editing API. An agent (through MCP, or a model's JSON reply)
// changes a plan with small operations instead of rewriting the whole
// document, and reads the result back as a compact summary.

type Json = Record<string, unknown>;

export type Op =
  | { op: 'add_comp'; comp: Json }
  | { op: 'remove_comp'; comp: string }
  | { op: 'set_comp'; comp: string; set: Json }
  | { op: 'add_layer'; comp: string; layer: Json; index?: number; group?: string }
  | { op: 'update_layer'; comp: string; layer: string; set: Json }
  | { op: 'remove_layer'; comp: string; layer: string }
  | { op: 'move_layer'; comp: string; layer: string; index: number }
  | { op: 'keyframe'; comp: string; layer?: string; prop: string; t: number; v: unknown; ease?: Ease }
  | { op: 'remove_keyframe'; comp: string; layer?: string; prop: string; t: number }
  | { op: 'add_asset'; id: string; data: string }
  | { op: 'set_sections'; sections: Json[] }
  | { op: 'set'; path: string; value: unknown }
  | { op: 'snap'; comp: string; grid?: number };

export const OP_NAMES = ['add_comp', 'remove_comp', 'set_comp', 'add_layer', 'update_layer', 'remove_layer', 'move_layer', 'keyframe', 'remove_keyframe', 'add_asset', 'set_sections', 'set', 'snap'] as const;

export type ApplyResult =
  | { ok: true; plan: Json; done: string[]; issues: Issue[]; warnings: Issue[] }
  | { ok: false; index: number; error: string };

interface Studio { comps: Json[]; assets: Record<string, string> }

function studioOf(plan: Json): Studio {
  const s = (plan.studio ??= { comps: [], assets: {} }) as Studio;
  s.comps ??= [];
  s.assets ??= {};
  return s;
}

function compOf(plan: Json, id: string): Json {
  const c = studioOf(plan).comps.find(c => c.id === id);
  if (!c) throw new Error(`no comp "${id}"; comps: ${studioOf(plan).comps.map(c => c.id).join(', ') || '(none)'}`);
  return c;
}

/** The layer and the list that holds it, searching groups too. */
function find(layers: Json[], id: string): { layer: Json; list: Json[] } | null {
  for (const l of layers) {
    if (l.id === id) return { layer: l, list: layers };
    if (l.type === 'group' && Array.isArray(l.layers)) {
      const r = find(l.layers as Json[], id);
      if (r) return r;
    }
  }
  return null;
}

function layerOf(comp: Json, id: string): { layer: Json; list: Json[] } {
  const r = find((comp.layers ??= []) as Json[], id);
  if (!r) throw new Error(`no layer "${id}" in comp "${comp.id}"`);
  return r;
}

function merge(target: Json, patch: Json): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete target[k];
    else target[k] = v;
  }
}

/** Get the object holding a dotted path's last key, creating objects on the way. */
function holder(root: Json, path: string): [Json, string] {
  const parts = path.split('.');
  let o = root;
  for (const p of parts.slice(0, -1)) {
    if (o[p] === undefined) o[p] = {};
    if (typeof o[p] !== 'object' || o[p] === null || Array.isArray(o[p])) throw new Error(`"${path}": "${p}" is not an object`);
    o = o[p] as Json;
  }
  return [o, parts[parts.length - 1]];
}

function setKey(o: Json, k: string, t: number, v: unknown, ease?: Ease): void {
  const cur = o[k];
  const keys: { t: number; v: unknown; ease?: Ease }[] = isKeys(cur as never) ? (cur as never) : [];
  const at = keys.findIndex(x => Math.abs(x.t - t) < 1e-6);
  const key = ease !== undefined ? { t, v, ease } : { t, v };
  if (at >= 0) keys[at] = key;
  else keys.push(key);
  keys.sort((a, b) => a.t - b.t);
  o[k] = keys;
}

function applyOne(plan: Json, op: Op): string {
  switch (op.op) {
    case 'add_comp': {
      const s = studioOf(plan);
      const id = String(op.comp.id ?? '');
      if (s.comps.some(c => c.id === id)) throw new Error(`comp "${id}" already exists`);
      s.comps.push({ layers: [], ...op.comp });
      return `added comp "${id}"`;
    }
    case 'remove_comp': {
      const s = studioOf(plan);
      compOf(plan, op.comp);
      s.comps = s.comps.filter(c => c.id !== op.comp);
      return `removed comp "${op.comp}"`;
    }
    case 'set_comp': {
      const c = compOf(plan, op.comp);
      if ('layers' in op.set || 'id' in op.set) throw new Error('set_comp cannot replace id or layers; use the layer operations');
      merge(c, op.set);
      return `updated comp "${op.comp}"`;
    }
    case 'add_layer': {
      const c = compOf(plan, op.comp);
      const id = String(op.layer.id ?? '');
      if (find((c.layers ??= []) as Json[], id)) throw new Error(`layer "${id}" already exists in comp "${op.comp}"`);
      let list = c.layers as Json[];
      if (op.group) {
        const g = layerOf(c, op.group).layer;
        if (g.type !== 'group') throw new Error(`"${op.group}" is a ${g.type} layer, not a group`);
        list = (g.layers ??= []) as Json[];
      }
      const i = op.index === undefined ? list.length : Math.max(0, Math.min(list.length, op.index));
      list.splice(i, 0, op.layer);
      return `added ${op.layer.type} layer "${id}" at index ${i}`;
    }
    case 'update_layer': {
      const { layer } = layerOf(compOf(plan, op.comp), op.layer);
      merge(layer, op.set);
      return `updated layer "${op.layer}"`;
    }
    case 'remove_layer': {
      const { list, layer } = layerOf(compOf(plan, op.comp), op.layer);
      list.splice(list.indexOf(layer), 1);
      return `removed layer "${op.layer}"`;
    }
    case 'move_layer': {
      const { list, layer } = layerOf(compOf(plan, op.comp), op.layer);
      list.splice(list.indexOf(layer), 1);
      const i = Math.max(0, Math.min(list.length, op.index));
      list.splice(i, 0, layer);
      return `moved layer "${op.layer}" to index ${i}`;
    }
    case 'keyframe': {
      const c = compOf(plan, op.comp);
      const [o, k] = holder(op.layer ? layerOf(c, op.layer).layer : c, op.prop);
      setKey(o, k, op.t, op.v, op.ease);
      return `keyframe ${op.layer ?? op.comp}.${op.prop} @ ${op.t}`;
    }
    case 'remove_keyframe': {
      const c = compOf(plan, op.comp);
      const [o, k] = holder(op.layer ? layerOf(c, op.layer).layer : c, op.prop);
      const keys = o[k];
      if (!isKeys(keys as never)) throw new Error(`${op.prop} has no keyframes`);
      const left = (keys as { t: number }[]).filter(x => Math.abs(x.t - op.t) >= 1e-6);
      if (left.length === (keys as unknown[]).length) throw new Error(`${op.prop} has no keyframe at ${op.t}; keys at ${keyTimes(keys).join(', ')}`);
      if (left.length) o[k] = left;
      else delete o[k];
      return `removed keyframe ${op.prop} @ ${op.t}`;
    }
    case 'add_asset': {
      if (!/^data:image\//.test(op.data)) throw new Error('an asset is a data:image/… URL');
      studioOf(plan).assets[op.id] = op.data;
      return `asset "${op.id}" (${Math.round(op.data.length / 1024)} KB)`;
    }
    case 'set_sections': {
      plan.sections = op.sections;
      return `${op.sections.length} sections`;
    }
    case 'set': {
      const [o, k] = holder(plan, op.path);
      if (op.value === null) delete o[k];
      else o[k] = op.value;
      return `set ${op.path}`;
    }
    case 'snap': {
      const bpm = Number(((plan.music as Json | undefined)?.bpm as number | undefined) ?? 120);
      const n = snapComp(compOf(plan, op.comp), op.grid ?? 0.25, 60 / bpm);
      return `snapped ${n} time${n === 1 ? '' : 's'} in comp "${op.comp}" to the ${op.grid ?? 0.25}-beat grid`;
    }
    default:
      throw new Error(`unknown op "${(op as { op: string }).op}"; ops: ${OP_NAMES.join(', ')}`);
  }
}

/**
 * Apply operations in order to a copy of the plan. All or nothing: the first
 * failing operation stops the batch and nothing changes. On success the
 * result carries the validator's issues, so the agent can fix them next.
 */
export function applyOps(plan: unknown, ops: Op[]): ApplyResult {
  const next = structuredClone(plan ?? {}) as Json;
  const done: string[] = [];
  for (let i = 0; i < ops.length; i++) {
    try {
      done.push(applyOne(next, ops[i]));
    } catch (e) {
      return { ok: false, index: i, error: `ops[${i}] (${ops[i]?.op}): ${(e as Error).message}` };
    }
  }
  const v = validatePlan(next);
  return { ok: true, plan: next, done, issues: v.ok ? [] : v.errors, warnings: v.warnings };
}

// ── a compact summary for agents ──────────────────────────────────────────────

const r1 = (n: number) => Math.round(n * 100) / 100;
function brief(v: unknown): string {
  if (isKeys(v as never)) {
    const k = v as { t: number; v: unknown }[];
    return `${k.length}k ${r1(k[0].t)}→${r1(k[k.length - 1].t)} (${brief(k[0].v)}→${brief(k[k.length - 1].v)})`;
  }
  if (Array.isArray(v)) return v.map(x => (typeof x === 'number' ? r1(x) : String(x))).join(',');
  if (typeof v === 'number') return String(r1(v));
  if (v && typeof v === 'object') return (v as Json).type ? String((v as Json).type) : '{…}';
  return String(v);
}

const ANIMATABLE = ['position', 'anchor', 'scale', 'rotation', 'skew', 'opacity', 'z', 'blur', 'size', 'radius', 'fill', 'color', 'tracking', 'from', 'to', 'clip'];

function layerLine(l: Layer, depth: number): string[] {
  const a = l as unknown as Json;
  const bits: string[] = [];
  if (l.type === 'text') bits.push(JSON.stringify(l.text.length > 40 ? l.text.slice(0, 38) + '…' : l.text));
  if (l.type === 'image') bits.push(l.src.startsWith('asset:') ? l.src : 'data-url');
  if (l.type === 'technique') bits.push(l.technique);
  for (const k of ANIMATABLE) if (a[k] !== undefined) bits.push(`${k} ${brief(a[k])}`);
  if (l.in !== undefined || l.out !== undefined) bits.push(`in ${l.in ?? 0}–${l.out ?? '∞'}`);
  if (l.parent) bits.push(`parent ${l.parent}`);
  if (l.matte) bits.push(`matte ${l.matte.invert ? 'not ' : ''}${l.matte.layer}`);
  if (l.blend && l.blend !== 'normal') bits.push(l.blend);
  if (l.type === 'text' && l.animate) bits.push(`animate by ${l.animate.by ?? 'char'} from ${l.animate.start ?? 0}`);
  for (const fx of ['glow', 'shadow', 'stroke', 'trim'] as const) if (a[fx]) bits.push(fx);
  const out = [`${'  '.repeat(depth)}${l.id.padEnd(12)} ${l.type.padEnd(9)} ${bits.join(' · ')}`];
  if (l.type === 'group') for (const c of l.layers) out.push(...layerLine(c, depth + 1));
  return out;
}

/** One line per section and per layer: what an agent needs to decide its next edit. */
export function describe(plan: unknown, compId?: string): string {
  const v = validatePlan(plan);
  const p = (v.ok ? v.plan : plan) as Json & { sections?: Json[]; music?: { bpm?: number }; studio?: { comps?: Json[]; assets?: Record<string, string> } };
  const bpm = p.music?.bpm ?? 120;
  const lines: string[] = [];
  const secs = p.sections ?? [];
  lines.push(`plan: ${secs.length} sections at ${bpm} BPM (1 beat = ${r1(60 / bpm)} s)${v.ok ? '' : ` · ${v.errors.length} errors`}`);
  secs.forEach((s, i) => lines.push(`  #${i} ${s.technique} · ${s.beats} beats${s.transition ? ` → ${typeof s.transition === 'string' ? s.transition : (s.transition as Json).type}` : ''}`));
  const comps = (p.studio?.comps ?? []).filter(c => !compId || c.id === compId) as unknown as { id: string; units?: string; camera?: Json; background?: unknown; layers: Layer[] }[];
  for (const c of comps) {
    const cam = c.camera ? Object.entries(c.camera).map(([k, x]) => `${k} ${brief(x)}`).join(' · ') : 'none';
    lines.push(``, `comp "${c.id}" · units ${c.units ?? 'seconds'} · ${c.layers.length} layers (bottom → top) · camera ${cam}${c.background !== undefined ? ` · background ${brief(c.background)}` : ''}`);
    for (const l of c.layers) lines.push(...layerLine(l, 1));
  }
  const assets = Object.keys(p.studio?.assets ?? {});
  if (assets.length) lines.push('', `assets: ${assets.join(', ')}`);
  if (!v.ok) lines.push('', 'errors:', ...v.errors.slice(0, 20).map(e => `  ${e.path}: ${e.message}`));
  return lines.join('\n');
}
