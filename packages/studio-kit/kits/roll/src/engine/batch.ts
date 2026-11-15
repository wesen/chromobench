// The roll's batch plans (guide §6.3; CHB-037): per-frame sets on document paths with one label, one why and one
// approval scope — the first print, matching and its undoing. A plan is shown on one card (previewed on the
// contact sheet), then committed through the values batch builder (`plan`) as one step of the document log. Each
// set records the value it replaces, so a frame changed after planning is stale at approval.
import { canonicalJSON, set, type Mutation } from '@chromobench/values';
import { edit, type Diagnostic, type Document } from '@chromobench/contract';
import { strip } from '@chromobench/shell';
import { read, withoutInert } from '../../../../src/model/doc.ts';
import type { FrameId } from './model.ts';

export interface FrameMutations {
  frame: FrameId;
  mutations: Mutation[];
  /** the value each set replaces (path → value) */
  expect: Record<string, unknown>;
}

export interface MutationBatch {
  /** the batch id: every transaction it commits carries it (prefixed ROLL_TX) */
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

/**
 * The sets that give a document these values (only those that change something), passed through withoutInert (an
 * optics set on a normalised document becomes printer lights), with the values they replace.
 */
export function frameSets(doc: Document, values: Record<string, unknown>, always: readonly string[] = []): Omit<FrameMutations, 'frame'> {
  const ms: Mutation[] = [];
  for (const [p, v] of Object.entries(values)) if (always.includes(p) || canonicalJSON(read(doc, p) ?? null) !== canonicalJSON(v ?? null)) ms.push(set(p, plain(v)));
  const mutations = withoutInert(doc, ms);
  const expect: Record<string, unknown> = {};
  for (const m of mutations) if (m.op === 'set') expect[m.path] = plain(read(doc, m.path) ?? null);
  return { mutations, expect };
}

export interface Stale {
  frame: FrameId;
  path: string;
  expected: unknown;
  now: unknown;
}

/** Sets whose replaced value no longer matches the frame's committed value (E_STALE at approval). */
export function staleOf(b: MutationBatch, docOf: (f: FrameId) => Document | undefined): Stale[] {
  const out: Stale[] = [];
  for (const f of b.frames) {
    const d = docOf(f.frame);
    if (!d) continue;
    for (const [path, expected] of Object.entries(f.expect)) {
      const now = read(d, path) ?? null;
      if (canonicalJSON(now) !== canonicalJSON(expected ?? null)) out.push({ frame: f.frame, path, expected, now });
    }
  }
  return out;
}

export const staleDiagnostics = (s: Stale[]): Diagnostic[] =>
  s.map((x) => ({ code: 'E_STALE', message: `${x.frame}: ${x.path} changed since the batch was planned: expected ${canonicalJSON(x.expected)}, now ${canonicalJSON(x.now)}` }));

/** The document a frame would have with the batch applied (the preview on the contact sheet). The state's
 *  read-only views of the batch and the document are unwrapped: an edit works on the plain values. */
export function previewOf(b: MutationBatch | null | undefined, frame: FrameId, d: Document): Document {
  const f = strip(b)?.frames.find((x) => x.frame === frame);
  if (!f || !f.mutations.length) return d;
  try {
    return edit(strip(d), f.mutations).doc;
  } catch {
    return d;
  }
}

/** Keep only the frames the photographer left ticked (partial approval). */
export function withoutFrames(b: MutationBatch, off: readonly FrameId[]): MutationBatch {
  return { ...b, frames: b.frames.filter((f) => !off.includes(f.frame)) };
}
