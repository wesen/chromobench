// Content keys for tables (guide §5.4, contract TableKey). The id is the SHA-256 of the key's
// canonical JSON. Hash fields hash the arrays the builder actually consumes, so a data-pack update
// changes the key without anyone bumping a version; the domain and N are always in the key
// (the spektrafilm density_min lesson); the scan's sha256 is in it whenever an input is per scan.
import { canonicalJSON, sha256Hex, type Hash, type TableKey } from '@chromobench/contract';
import type { SolveInputs, SpectralInputs } from './inputs.ts';

/** Interim conventions id until CHB-003 publishes PhysicsConventions. */
export const INTERIM_CONVENTIONS = 'chromogen-interim-0';

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
  const conventions = o.conventions ?? INTERIM_CONVENTIONS;
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
  return {
    kind: 'print', schema: 1, paper: hashArrays(...inp.E, inp.B), viewing: hashArrays(...inp.W, ...inp.M),
    adaptTo: [0.95047, 1, 1.08883], domain, builder: o.builder, ...extra, conventions,
  };
}
