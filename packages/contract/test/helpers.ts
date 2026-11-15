// Shared test helpers: synthetic sources, documents, entries, and a diagnostic catcher.
import { Coll, type Id, type Mutation, insert } from '@chromobench/values';
import {
  ChromobenchError, Graph, isChromobenchError, layerEntry, newDocument, groupEntry,
  type Diagnostic, type Document, type Entry, type EntryBase, type Mask, type MaskComponent, type Params, type SourceInfo,
} from '@chromobench/contract';

export const SHA = 'ab'.repeat(32);

export function sourceInfo(sha = SHA, width = 12, height = 10): SourceInfo {
  return { sha256: sha, format: 'tiff', width, height, channels: 3, bits: 16, sample: 'uint', encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0], white: [65535], from: 'default' }, clippedFraction: 0, notes: [] };
}

export function graph(): Graph {
  const g = new Graph();
  g.registerSource(sourceInfo());
  return g;
}

export const scanDoc = (): Document => newDocument('negative-scan', { sha256: SHA }, { umPerPx: 6, frame: 'f1' });
export const camDoc = (): Document => newDocument('digital-raw', { sha256: SHA }, { frame: 'c1' });

export const L = (op: string, params: Params = {}, over: Partial<EntryBase> = {}): Entry => layerEntry(op, params, over);
export const G = (name: string, entries: [Id, Entry][], over: Partial<EntryBase> = {}): Entry => groupEntry(name, Coll.of(entries), over);

export const component = (kind: MaskComponent['kind'], params: Params, combine: MaskComponent['combine'] = 'add', amount = 1): MaskComponent =>
  ({ kind, params, combine, amount, enabled: true });

export function maskOf(components: [Id, MaskComponent][], over: Partial<Mask> = {}): Mask {
  return { name: 'm', components: Coll.of(components), feather_mm: 0, invert: false, reads: 'stage-input', ...over };
}

export const linear = (y1 = 0, y2 = 5): MaskComponent => component('linear', { from: { x: 0, y: y1 }, to: { x: 0, y: y2 } });

export const push = (stage: string, id: Id, e: Entry, at?: number): Mutation => insert(`stages.${stage}.stack`, id, e, at);

/** The diagnostic a call throws (contract or builder-core error). */
export function diagOf(f: () => unknown): Diagnostic {
  try {
    f();
  } catch (e) {
    if (isChromobenchError(e)) return e.diag;
    throw e;
  }
  throw new Error('expected an error');
}

export { ChromobenchError };

/** A spot of a heal or clone layer (stored as a Coll item). */
export const spot = (x: number, y: number, r = 2, src = { x: x + 4, y }, opacity = 1, feather = 0.3): Params =>
  ({ x, y, r, src, feather, opacity });

export const spots = (...s: [Id, Params][]): Params => ({ spots: Coll.of(s) as unknown as Params[string] });
