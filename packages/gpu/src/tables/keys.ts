// Content keys for tables (guide §5.4, contract TableKey). The id is the SHA-256 of the key's
// canonical JSON. Hash fields hash the arrays the builder actually consumes, so a data-pack update
// changes the key without anyone bumping a version; the domain and N are always in the key
// (the spektrafilm density_min lesson); the scan's sha256 is in it whenever an input is per scan.
import { canonicalJSON, sha256Hex, type Hash, type TableKey } from '@chromobench/contract';
import { conventionsKey, DEFAULT_CONVENTIONS } from '@chromobench/core';
import type { SolveInputs, SpectralInputs } from './inputs.ts';

/** core's conventions id (one for every engine, CHB-017): the default TableKey.conventions. */
export const CORE_CONVENTIONS = conventionsKey(DEFAULT_CONVENTIONS);

/** SHA-256 over the f64 little-endian bytes of the arrays, with their lengths. */
export function hashArrays(...arrays: ArrayLike<number>[]): Hash {
  let total = 0;
  for (const a of arrays) total += 4 + 8 * a.length;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  let o = 0;
  for (const a of arrays) {
    dv.setUint32(o, a.length, true);
    o += 4;
    for (let i = 0; i < a.length; i++, o += 8) dv.setFloat64(o, a[i]!, true);
  }
  return sha256Hex(new Uint8Array(buf));
}

export function tableId(key: TableKey): string {
  return sha256Hex(canonicalJSON(key));
}

export interface KeyOptions { builder: 'f64' | 'gpu-f32'; kernel?: Hash; scan?: string; conventions?: string }

/** The key of a table built from `inp`. */
export function keyFor(inp: SolveInputs | SpectralInputs, o: KeyOptions): TableKey {
  const domain = { lo: inp.range[0], hi: inp.range[1], N: inp.N };
  const conventions = o.conventions ?? CORE_CONVENTIONS;
  const extra = { ...(o.kernel ? { kernel: o.kernel } : {}) };
  if (inp.kind === 'solve') {
    return {
      kind: 'solve', schema: 1, channels: hashArrays(...inp.P), film: hashArrays(...inp.E, inp.B), domain,
      solver: { lo: inp.lo, hi: inp.hi, tol: inp.tol, gtol: inp.gtol, maxIt: inp.maxIt, activeSet: inp.activeSet },
      ...(o.scan ? { scan: o.scan } : {}), builder: o.builder, ...extra, conventions,
    };
  }
  if (inp.kind === 'pd') {
    return { kind: 'pd', schema: 1, film: hashArrays(...inp.E, inp.B), printing: hashArrays(...inp.W), domain, builder: o.builder, ...extra, conventions };
  }
  // core's print table is XYZ under the viewing light (M = I): adaptTo is that white, Σ W = (X, Y, Z) of a perfect reflector
  const sum = (w: ArrayLike<number>): number => { let t = 0; for (let i = 0; i < w.length; i++) t += w[i]!; return t; };
  const white = [0, 1, 2].map((r) => inp.M[r]![0]! * sum(inp.W[0]) + inp.M[r]![1]! * sum(inp.W[1]) + inp.M[r]![2]! * sum(inp.W[2])) as [number, number, number];
  return {
    kind: 'print', schema: 1, paper: hashArrays(...inp.E, inp.B), viewing: hashArrays(...inp.W, ...inp.M),
    adaptTo: white, domain, builder: o.builder, ...extra, conventions,
  };
}
