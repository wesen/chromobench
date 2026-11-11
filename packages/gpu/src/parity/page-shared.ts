// Shared state of the parity page: one runtime (recreated after device loss), the Gold 200 set-up,
// and the f64 reference tables built with the current oracle.
import { GpuRuntime } from '../device.ts';
import { buildTableF64, coreOracle, type F64Oracle } from '../physics/oracle.ts';
import type { Table } from '../tables/inputs.ts';
import { setup, type Setup } from './fixtures.ts';

/** The f64 oracle the harness compares against: core's (CHB-017). setOracle swaps it for experiments. */
let oracle: F64Oracle = coreOracle;
export function setOracle(o: F64Oracle): void {
  oracle = o;
  refs.clear();
}
export const currentOracle = (): F64Oracle => oracle;

let rtP: Promise<GpuRuntime> | null = null;
export function runtime(): Promise<GpuRuntime> {
  if (!rtP) rtP = GpuRuntime.create();
  return rtP.then((rt) => {
    if (rt.lost) {
      rtP = null;
      return runtime();
    }
    return rt;
  });
}

let S: Setup | null = null;
export const gold = (): Setup => (S ??= setup());
const refs = new Map<string, Table>();
export function ref(kind: 'solve' | 'pd' | 'print'): Table {
  let t = refs.get(kind);
  if (!t) {
    const s = gold();
    t = buildTableF64(oracle, kind === 'solve' ? s.solve : kind === 'pd' ? s.pd : s.print);
    refs.set(kind, t);
  }
  return t;
}
