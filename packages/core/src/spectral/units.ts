// Scalar quantities with units (§1.1). The conversion rules are the contract's (`convert`), which
// refuses D ↔ logH with Hunt 14.17; this adds unit-checked arithmetic on top.
import { convert, fail, HUNT_MESSAGE, LOG10_2, LOGH_PER_POINT, unitFamily, type Unit } from '@chromobench/contract';

export { LOG10_2, LOGH_PER_POINT };

export interface Quantity {
  readonly value: number;
  readonly unit: Unit;
}

export const q = (value: number, unit: Unit): Quantity => Object.freeze({ value, unit });

/** a + b in a's unit. Refuses mixing families (D + logH is a type error, Hunt 14.17). */
export function addQ(a: Quantity, b: Quantity): Quantity {
  if (unitFamily(a.unit) !== unitFamily(b.unit)) {
    const dl = new Set([unitFamily(a.unit), unitFamily(b.unit)]);
    if (dl.has('density') && dl.has('exposure')) fail('E_UNIT', `cannot add ${b.unit} to ${a.unit}: ${HUNT_MESSAGE}`);
    fail('E_UNIT', `cannot add ${b.unit} to ${a.unit}`);
  }
  return q(a.value + convert(b.value, b.unit, a.unit), a.unit);
}

export const toLogH = (x: Quantity): number => convert(x.value, x.unit, 'logH');
export const points = (n: number): Quantity => q(n, 'point');
