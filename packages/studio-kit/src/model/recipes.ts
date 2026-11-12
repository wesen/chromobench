// Recipe helpers moved from apps/studio/src/core/frame-session.ts (CHB-009): the default recipe of a new frame,
// snapshots and diffRecipes (snapshot restore, "apply these settings"). The FrameSession class itself dissolves
// into bridge/frames.ts (graph + log per frame) and the render bridge.
import { canonicalJSON, defaultRecipe, getPath, RECIPE_FIELDS, type FrameRecipe, type Mutation } from '@chromobench/contract';

export type ViewMode = 'print' | 'negative' | 'dyes' | 'classes';
export const VIEW_MODES: readonly ViewMode[] = ['print', 'negative', 'dyes', 'classes'];

export interface Snapshot {
  id: string;
  frame: string;
  name: string;
  ts: number;
  stateHash: string;
  recipe: FrameRecipe;
}

/** The neutral first recipe of a file opened as a negative (default) or as a photo. */
export function defaultFor(sha: string, name: string, kind: FrameRecipe['kind'] = 'negative-scan'): FrameRecipe {
  return defaultRecipe(kind, { sha256: sha, name });
}

/**
 * The mutations that turn `from` into `to` (snapshot restore, contact-sheet apply). `only` limits
 * the comparison to paths under these prefixes. Masks are added or replaced (the contract has no
 * mask removal); exposures are removed, added or field-set by id.
 */
export function diffRecipes(from: FrameRecipe, to: FrameRecipe, only?: readonly string[]): Mutation[] {
  const want = (p: string): boolean => !only || only.some((o) => p === o || p.startsWith(`${o}.`));
  const out: Mutation[] = [];
  const same = (a: unknown, b: unknown): boolean => canonicalJSON(a) === canonicalJSON(b);
  for (const pattern of Object.keys(RECIPE_FIELDS)) {
    if (pattern.includes('*') || !want(pattern)) continue;
    const a = getPath(from, pattern);
    const b = getPath(to, pattern);
    if (a === undefined || b === undefined || same(a, b)) continue;
    out.push({ op: 'set', path: pattern, value: b });
  }
  if (want('masks')) {
    for (const [id, spec] of Object.entries(to.masks)) if (!same(from.masks[id], spec)) out.push({ op: 'mask.set', id, mask: spec });
  }
  if (want('print.exposures')) {
    const fromIds = new Map(from.print.exposures.map((e) => [e.id, e]));
    const toIds = new Map(to.print.exposures.map((e) => [e.id, e]));
    for (const e of from.print.exposures) if (!toIds.has(e.id)) out.push({ op: 'exposure.remove', id: e.id });
    for (const e of to.print.exposures) {
      const old = fromIds.get(e.id);
      if (!old) {
        out.push({ op: 'exposure.add', exposure: e });
        continue;
      }
      for (const k of ['kind', 'enabled', 'mask', 'time_s', 'stops', 'filtration', 'through'] as const) {
        if (!same(old[k], e[k])) out.push({ op: 'set', path: `print.exposures.${e.id}.${k}`, value: e[k] });
      }
    }
  }
  if (want('probes')) {
    for (const [id, p] of Object.entries(to.probes)) if (!same(from.probes[id], p)) out.push({ op: 'set', path: `probes.${id}`, value: p });
  }
  return out;
}

/** The print settings "Apply these settings" copies between frames (contact sheet). */
export const PRINT_SETTINGS = ['print.paper', 'print.enlarger', 'print.lights.logH', 'print.grade', 'print.preflash'] as const;
