// Reachability classes (§3.5): a pure port of Chromogen source.js classify (05-inline.js 2538–2543),
// taking density above the rebate directly (the scanner-density domain already holds it).
import type { Vec3 } from '../spectral/linalg.ts';

export type ScanClass = 'ok' | 'blank' | 'below' | 'gamut';
/** Contract `scan-classes` codes. */
export const CLASS_CODE: Record<ScanClass, number> = { ok: 0, blank: 1, below: 2, gamut: 3 };
export const Z_NOISE = 3;
export const GAMUT_RESIDUAL_D = 0.01;

/** Order matters: below base wins over blank, both over gamut. */
export function classify(Dabove: ArrayLike<number>, sigma: ArrayLike<number>, residual_D: number, Z = Z_NOISE): { cls: ScanClass; z: Vec3; layers: number[] } {
  const z = [0, 1, 2].map((k) => Dabove[k]! / sigma[k]!) as Vec3;
  const zmin = Math.min(z[0], z[1], z[2]);
  const cls: ScanClass = zmin < -Z ? 'below' : zmin <= Z ? 'blank' : residual_D > GAMUT_RESIDUAL_D ? 'gamut' : 'ok';
  return { cls, z, layers: [0, 1, 2].filter((k) => (cls === 'below' ? z[k]! < -Z : Math.abs(z[k]!) <= Z)) };
}
