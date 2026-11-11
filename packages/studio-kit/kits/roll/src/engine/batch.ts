// The mutation-batch IR (guide §6.3): per-frame mutation lists with one label, one why and one approval scope.
// Roll setup changes, the first print, matching and CHB-021's "apply look to the roll" all have this shape:
// compute per-frame mutations, show one card, commit as one global undo step (EditLogRoute.applyBatch).
import { applyMutation, canonicalJSON, getPath, type Diagnostic, type FrameRecipe, type Mutation } from '@chromobench/contract';
import type { FrameId } from './model.ts';

export interface FrameMutations {
  frame: FrameId;
  mutations: Mutation[];
}

export interface MutationBatch {
  /** also the EditLog tx of every unit it makes (prefixed ROLL_TX) */
  id: string;
  kind: 'first-print' | 'match' | 'clear-match' | 'setup' | 'custom';
  label: string;
  why: string;
  by: 'auto' | 'user';
  frames: FrameMutations[];
  skipped: { frame: FrameId; why: string }[];
  /** what a batch pass may use (reference frame, alpha, …) */
  meta?: Record<string, unknown>;
}

/** A plain deep copy (also of the store's read-only proxies, which structuredClone refuses). */
export const plain = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** `set` mutations carrying the value they replace (DR-7), for the staleness check at approval. */
export function setWithExpect(r: FrameRecipe, path: string, value: unknown): Mutation {
  return { op: 'set', path, value: plain(value), expect: plain(getPath(r, path) ?? null) };
}

/** only the sets whose value differs from the recipe's */
export function changedSets(r: FrameRecipe, values: Record<string, unknown>): Mutation[] {
  const out: Mutation[] = [];
  for (const [p, v] of Object.entries(values)) if (canonicalJSON(getPath(r, p) ?? null) !== canonicalJSON(v ?? null)) out.push(setWithExpect(r, p, v));
  return out;
}

export interface Stale {
  frame: FrameId;
  path: string;
  expected: unknown;
  now: unknown;
}

/** Sets whose `expect` no longer matches the frame's committed value (E_STALE at approval). */
export function staleOf(b: MutationBatch, recipeOf: (f: FrameId) => FrameRecipe | undefined): Stale[] {
  const out: Stale[] = [];
  for (const f of b.frames) {
    const r = recipeOf(f.frame);
    if (!r) continue;
    for (const m of f.mutations) {
      if (m.op !== 'set' || m.expect === undefined) continue;
      const now = getPath(r, m.path) ?? null;
      if (canonicalJSON(now) !== canonicalJSON(m.expect)) out.push({ frame: f.frame, path: m.path, expected: m.expect, now });
    }
  }
  return out;
}

export const staleDiagnostics = (s: Stale[]): Diagnostic[] =>
  s.map((x) => ({ code: 'E_STALE', message: `${x.frame}: ${x.path} changed since the batch was planned: expected ${canonicalJSON(x.expected)}, now ${canonicalJSON(x.now)}` }));

/** The recipe a frame would have with the batch applied (the preview on the contact sheet). */
export function previewOf(b: MutationBatch | null | undefined, frame: FrameId, r: FrameRecipe): FrameRecipe {
  const f = b?.frames.find((x) => x.frame === frame);
  if (!f) return r;
  let out = r;
  for (const m of f.mutations) {
    try {
      out = applyMutation(out, m.op === 'set' ? { op: 'set', path: m.path, value: m.value } : m).recipe;
    } catch {
      return r;
    }
  }
  return out;
}

/** Keep only the frames the photographer left ticked (partial approval). */
export function withoutFrames(b: MutationBatch, off: readonly FrameId[]): MutationBatch {
  return { ...b, frames: b.frames.filter((f) => !off.includes(f.frame)) };
}

/** A generic batch: build(frame, recipe) → mutations, for every frame (CHB-021's "apply look to the roll"). */
export function buildBatch(
  frames: readonly FrameId[],
  recipeOf: (f: FrameId) => FrameRecipe | undefined,
  build: (frame: FrameId, r: FrameRecipe) => Mutation[] | { skip: string },
  o: { id: string; label: string; why?: string; kind?: MutationBatch['kind']; by?: MutationBatch['by'] },
): MutationBatch {
  const out: FrameMutations[] = [];
  const skipped: MutationBatch['skipped'] = [];
  for (const f of frames) {
    const r = recipeOf(f);
    if (!r) continue;
    const ms = build(f, r);
    if (!Array.isArray(ms)) skipped.push({ frame: f, why: ms.skip });
    else if (ms.length) out.push({ frame: f, mutations: ms });
  }
  return { id: o.id, kind: o.kind ?? 'custom', label: o.label, why: o.why ?? o.label, by: o.by ?? 'user', frames: out, skipped };
}
