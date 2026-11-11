// Metameric blacks (§1.8) and spectral film exposure (§2.1).
import { inv3, mulMV, type Mat3, type Vec3 } from './linalg.ts';
import type { Stock } from './stock.ts';
import { NW } from './spectrum.ts';

/** p − A(AᵀA)⁻¹Aᵀp, with A the 81×3 matrix given as three columns (light × CMF). */
export function metamericBlack(A: readonly ArrayLike<number>[], p: ArrayLike<number>): Float64Array {
  const AtA = [0, 1, 2].map((i) => [0, 1, 2].map((j) => {
    let s = 0;
    for (let l = 0; l < NW; l++) s += A[i]![l]! * A[j]![l]!;
    return s;
  })) as Mat3;
  const Atp: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) for (let l = 0; l < NW; l++) Atp[i] = Atp[i]! + A[i]![l]! * p[l]!;
  const y = mulMV(inv3(AtA), Atp);
  return Float64Array.from({ length: NW }, (_, l) => p[l]! - (A[0]![l]! * y[0] + A[1]![l]! * y[1] + A[2]![l]! * y[2]));
}

/** Film log exposure u_k = log10 Σ radiance·s_k + κ_k, κ so that a flat `grey` under `illuminant` gives 0 (§2.1). */
export function exposeSpectral(stock: Stock, radiance: ArrayLike<number>, ref: { illuminant: ArrayLike<number>; grey: number }): Vec3 {
  return stock.sens.map((s) => {
    let a = 0;
    let g = 0;
    for (let i = 0; i < NW; i++) {
      a += radiance[i]! * s[i]!;
      g += ref.grey * ref.illuminant[i]! * s[i]!;
    }
    return Math.log10(a) - Math.log10(g);
  }) as Vec3;
}
