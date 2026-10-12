import { compile } from '../engine/custom/stage';
import { getTechnique } from '../engine/techniques';
import { fontEntry } from '../plan/fonts';
import type { Layer, Studio } from './schema';

export interface StudioIssue { path: string; message: string }

const FONT_ROLES = new Set(['display', 'serif', 'mono']);

/** Keyframes in time order, wherever they are (the format accepts any order). */
function sortKeys(o: unknown): void {
  if (Array.isArray(o)) {
    if (o.length && o.every(k => k && typeof k === 'object' && !Array.isArray(k) && 't' in k && 'v' in k)) (o as { t: number }[]).sort((a, b) => a.t - b.t);
    else o.forEach(sortKeys);
  } else if (o && typeof o === 'object') for (const v of Object.values(o)) sortKeys(v);
}

/**
 * Checks a studio block beyond its schema: references between layers, layer
 * ids, library techniques and their params, code that compiles, assets and
 * fonts. Paths point at the exact field so a model can repair its own comp.
 */
export function checkStudio(studio: Studio | undefined, at = 'studio'): StudioIssue[] {
  if (!studio) return [];
  const out: StudioIssue[] = [];
  sortKeys(studio.comps);
  const compIds = new Set<string>();
  studio.comps.forEach((comp, ci) => {
    const cp = `${at}.comps[${ci}]`;
    if (compIds.has(comp.id)) out.push({ path: `${cp}.id`, message: `duplicate comp id "${comp.id}"` });
    compIds.add(comp.id);
    const ids = new Set<string>();
    const walk = (layers: Layer[], lp: string) => {
      const here = new Map(layers.map(l => [l.id, l]));
      layers.forEach((l, i) => {
        const p = `${lp}[${i}]`;
        if (ids.has(l.id)) out.push({ path: `${p}.id`, message: `duplicate layer id "${l.id}" in comp "${comp.id}"` });
        ids.add(l.id);
        if (l.parent !== undefined) {
          if (l.parent === l.id) out.push({ path: `${p}.parent`, message: 'a layer cannot be its own parent' });
          else if (!here.has(l.parent)) out.push({ path: `${p}.parent`, message: `no layer "${l.parent}" in the same layer list; siblings: ${[...here.keys()].join(', ')}` });
          else {
            let cur: Layer | undefined = l, hops = 0;
            while (cur?.parent && hops++ < 64) cur = here.get(cur.parent);
            if (hops >= 64) out.push({ path: `${p}.parent`, message: 'parent chain loops back on itself' });
          }
        }
        if (l.matte) {
          if (l.matte.layer === l.id) out.push({ path: `${p}.matte.layer`, message: 'a layer cannot be its own matte' });
          else if (!here.has(l.matte.layer)) out.push({ path: `${p}.matte.layer`, message: `no layer "${l.matte.layer}" in the same layer list` });
        }
        if (l.in !== undefined && l.out !== undefined && l.out <= l.in) out.push({ path: `${p}.out`, message: `out (${l.out}) must be after in (${l.in})` });
        if (l.type === 'text' && l.font && !FONT_ROLES.has(l.font) && !fontEntry(l.font)) out.push({ path: `${p}.font`, message: `unknown font "${l.font}": use display, serif, mono or a registry family` });
        if (l.type === 'image') {
          if (l.src.startsWith('asset:')) {
            if (!studio.assets[l.src.slice(6)]) out.push({ path: `${p}.src`, message: `no asset "${l.src.slice(6)}" in studio.assets` });
          } else if (!l.src.startsWith('data:image/')) out.push({ path: `${p}.src`, message: 'src is "asset:<id>" or a data:image/… URL (no network)' });
        }
        if (l.type === 'technique') {
          const t = getTechnique(l.technique);
          if (!t || l.technique.startsWith('scene:') || l.technique.startsWith('comp:')) out.push({ path: `${p}.technique`, message: `unknown library technique "${l.technique}"` });
          else {
            const r = t.params.safeParse(l.params ?? {});
            if (!r.success) out.push(...r.error.issues.map(e => ({ path: `${p}.params${e.path.length ? '.' + e.path.join('.') : ''}`, message: e.message })));
          }
        }
        if (l.type === 'code') {
          try {
            compile(['g', 't', 'S'], l.draw, `layer-${l.id}`);
          } catch (e) {
            out.push({ path: `${p}.draw`, message: `does not compile: ${(e as Error).message}` });
          }
        }
        if (l.type === 'group') walk(l.layers, `${p}.layers`);
      });
    };
    walk(comp.layers, `${cp}.layers`);
  });
  return out;
}
