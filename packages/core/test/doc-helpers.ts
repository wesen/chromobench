// Documents for the reference engine's tests (contract 1.0): the M1 negative opened in a RefEngine, a format-3
// document of it (film pitch 6 µm/px, as the goldens), and short forms for layers, masks and spots.
import { Coll, insert, set, type Id, type Mutation } from '@chromobench/values';
import {
  compile, edit, groupEntry, layerEntry, newDocument, type Compiled, type Document, type Entry, type EntryBase, type Mask, type MaskComponent,
  type Node, type Params, type SourceInfo, type StageName,
} from '@chromobench/contract';
import { makeM1Tiff } from '@chromobench/engine-mock';
import { nodePacksData, RefEngine } from '../src/index.ts';

export { insert, set };

export async function m1Engine(o: { sampled?: boolean } = {}): Promise<{ e: RefEngine; info: SourceInfo; doc: Document }> {
  const e = new RefEngine({ data: nodePacksData(), ...o });
  const info = await e.open({ kind: 'file', sha256: '', bytes: makeM1Tiff() });
  return { e, info, doc: newDocument('negative-scan', { sha256: info.sha256, name: 'm1' }, { umPerPx: 6, frame: 'm1' }) };
}

export const L = (op: string, params: Params = {}, over: Partial<EntryBase> = {}): Entry => layerEntry(op, params, over);
export const G = (name: string, entries: [Id, Entry][], over: Partial<EntryBase> = {}): Entry => groupEntry(name, Coll.of(entries), over);
export const push = (stage: StageName, id: Id, e: Entry, at?: number): Mutation => insert(`stages.${stage}.stack`, id, e, at);
export const withEdits = (doc: Document, ...ms: Mutation[]): Document => edit(doc, ms).doc;

export const component = (kind: MaskComponent['kind'], params: Params, combine: MaskComponent['combine'] = 'add', amount = 1): MaskComponent =>
  ({ kind, params, combine, amount, enabled: true });
export const maskOf = (components: [Id, MaskComponent][], over: Partial<Mask> = {}): Mask =>
  ({ name: 'm', components: Coll.of(components), feather_mm: 0, invert: false, reads: 'stage-input', ...over });

/** A heal or clone spot (document px). */
export const spot = (x: number, y: number, r: number, src: { x: number; y: number }, o: { feather?: number; opacity?: number } = {}): Params =>
  ({ x, y, r, src, feather: o.feather ?? 0.3, opacity: o.opacity ?? 1 });
export const spots = (...s: [Id, Params][]): Params => ({ spots: Coll.of(s) as unknown as Params[string] });

/** Compiles into the engine's graph. */
export const compiled = (e: RefEngine, doc: Document): Compiled => compile(doc, e.graph);

export async function pixels(e: RefEngine, n: Node): Promise<Float64Array> {
  return Float64Array.from(await (await e.evaluate(n, { scale: 'full', precision: 'export' })).read());
}

export const opsOf = (e: RefEngine, c: Compiled): string[] => e.graph.closure(c.display.id).map((d) => d.op);
