// Pure helpers of the DSL vocabulary (CHB-032 split; contract 1.0): the ops the DSL exposes on handles and as layers,
// did-you-mean, fix text.
import { allOps, closest, formatValue, type OpDef } from '@chromobench/contract';

export const HANDLE_MEMBERS = ['show', 'explain', 'id', 'domain', 'kind', 'width', 'height'];

/** did-you-mean: the contract's closest(), plus a prefix rule (time → time_s). */
export function suggest(name: string, cands: readonly string[]): string | undefined {
  return closest(name, cands) ?? cands.find((c) => c.startsWith(name) && name.length >= 3) ?? cands.find((c) => name.startsWith(c) && c.length >= 3);
}

export const short = (id: string): string => id.slice(0, 4);

/** A node op the DSL offers on handles (`h.measure.stats`): dotted, not internal, not kept out of the DSL. */
export function isDslOp(o: OpDef): boolean {
  return !o.internal && o.dsl !== false && o.name.includes('.');
}

export function dslOps(): OpDef[] {
  return allOps().filter(isDslOp);
}

/** The ops a layer can have (`layer('burn', …)`): those that live in a stage's stack. */
export function layerOps(): OpDef[] {
  return allOps().filter((o) => !o.internal && o.stages?.length);
}

/** `frame.propose(set('main.params.time_s', 12))` */
export function proposeFix(frameExpr: string, path: string, value: unknown): string {
  return `${frameExpr}.propose(set('${path}', ${formatValue(value)}))`;
}
