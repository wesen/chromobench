// Pure helpers of the DSL vocabulary (split from host.ts, CHB-032): the ops the DSL exposes, did-you-mean, fix text.
import { allOps, closest, formatValue, type OpDef } from '@chromobench/contract';

export const HANDLE_MEMBERS = ['look', 'explain', 'id', 'domain', 'kind', 'width', 'height'];

/** did-you-mean: the contract's closest(), plus a prefix rule (time → time_s). */
export function suggest(name: string, cands: readonly string[]): string | undefined {
  return closest(name, cands) ?? cands.find((c) => c.startsWith(name) && name.length >= 3) ?? cands.find((c) => name.startsWith(c) && c.length >= 3);
}

export const short = (id: string): string => id.slice(0, 4);

export function isDslOp(o: OpDef): boolean {
  return !o.internal && o.dsl !== false;
}

export function dslOps(): OpDef[] {
  return allOps().filter(isDslOp);
}

/** Formats a fix like `frame.edit({ 'print.enlarger.time_s': 12 })`. */
export function editFix(frameExpr: string, path: string, value: unknown): string {
  return `${frameExpr}.edit({ '${path}': ${formatValue(value)} })`;
}
