// Base classes from noise alone (guide §2.7, §5.10): Chromogen's classify (05-inline.js 2539–2543)
// without the residual. 'below' beats 'blank'; CHB-003's invert.classify adds 'gamut' for pixels
// classed 'above' whose residual exceeds 0.01 D. Statistics always carry their image size.
import type { Vec3 } from '@chromobench/contract';

export const Z_NOISE = 3;
export type BaseClass = 'below' | 'blank' | 'above';

export function baseClass(T: Vec3, Treb: Vec3, sigma: Vec3, Z = Z_NOISE): { cls: BaseClass; D: Vec3; z: Vec3; layers: number[] } {
  const D = [0, 1, 2].map((k) => -Math.log10(Math.max(T[k]!, 1e-6) / Treb[k]!)) as Vec3;
  const z = D.map((v, k) => v / sigma[k]!) as Vec3;
  const zmin = Math.min(...z);
  const cls: BaseClass = zmin < -Z ? 'below' : zmin <= Z ? 'blank' : 'above';
  return { cls, D, z, layers: [0, 1, 2].filter((k) => (cls === 'below' ? z[k]! < -Z : Math.abs(z[k]!) <= Z)) };
}

export interface ClassStats { blank: number; below: number; above: number; size: [number, number]; sigma: Vec3 }

/** Class codes per pixel of interleaved linear RGB, and the fractions with their image size. */
export function classifyImage(rgb: Float32Array, w: number, h: number, Treb: Vec3, sigma: Vec3, Z = Z_NOISE, stride = 3): { codes: Uint8Array; stats: ClassStats } {
  const N = w * h;
  const codes = new Uint8Array(N);
  let blank = 0;
  let below = 0;
  for (let i = 0; i < N; i++) {
    let zm = Infinity;
    for (let k = 0; k < 3; k++) zm = Math.min(zm, -Math.log10(Math.max(rgb[stride * i + k]!, 1e-6) / Treb[k]!) / sigma[k]!);
    if (zm < -Z) { codes[i] = 2; below++; } else if (zm <= Z) { codes[i] = 1; blank++; }
  }
  return { codes, stats: { blank: blank / N, below: below / N, above: (N - blank - below) / N, size: [w, h], sigma } };
}
