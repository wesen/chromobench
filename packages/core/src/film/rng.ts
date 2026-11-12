// Counter-based random numbers for grain (CHB-012 guide §5.4): every draw is a hash of its
// coordinates, so a tile, a region or a GPU workgroup sees the same numbers as a full render.
// pcg4d (Jarzynski & Olano 2020, "Hash Functions for GPU Rendering", JCGT 9(3)) uses only 32-bit
// multiply, add, xor and shift: JavaScript (Math.imul, >>> 0) and WGSL (u32) are bit-identical.
// Uniforms keep 24 bits, exactly representable in f32 and f64.

/** pcg4d in place on four u32 words. */
export function pcg4d(v: Uint32Array): Uint32Array {
  v[0] = (Math.imul(v[0]!, 1664525) + 1013904223) >>> 0;
  v[1] = (Math.imul(v[1]!, 1664525) + 1013904223) >>> 0;
  v[2] = (Math.imul(v[2]!, 1664525) + 1013904223) >>> 0;
  v[3] = (Math.imul(v[3]!, 1664525) + 1013904223) >>> 0;
  v[0] = (v[0]! + Math.imul(v[1]!, v[3]!)) >>> 0;
  v[1] = (v[1]! + Math.imul(v[2]!, v[0]!)) >>> 0;
  v[2] = (v[2]! + Math.imul(v[0]!, v[1]!)) >>> 0;
  v[3] = (v[3]! + Math.imul(v[1]!, v[2]!)) >>> 0;
  for (let i = 0; i < 4; i++) v[i] = (v[i]! ^ (v[i]! >>> 16)) >>> 0;
  v[0] = (v[0]! + Math.imul(v[1]!, v[3]!)) >>> 0;
  v[1] = (v[1]! + Math.imul(v[2]!, v[0]!)) >>> 0;
  v[2] = (v[2]! + Math.imul(v[0]!, v[1]!)) >>> 0;
  v[3] = (v[3]! + Math.imul(v[1]!, v[2]!)) >>> 0;
  return v;
}

/** u32 → [0, 1) with 24 bits. */
export const toUnit = (u: number): number => (u >>> 8) * 5.9604644775390625e-8;

const GOLDEN = 0x9e3779b9;

/**
 * A stream of uniforms keyed by (x, y, z, seed): draw j is word j mod 4 of
 * pcg4d(x, y, z, seed + ⌊j/4⌋·0x9E3779B9). x, y: print-grid pixel; z: channel·4 + sublayer.
 */
export class KeyedUniforms {
  private readonly v = new Uint32Array(4);
  private block = -1;
  private j = 0;
  private x = 0; private y = 0; private z = 0; private seed = 0;
  reset(x: number, y: number, z: number, seed: number): this {
    this.x = x >>> 0; this.y = y >>> 0; this.z = z >>> 0; this.seed = seed >>> 0;
    this.block = -1;
    this.j = 0;
    return this;
  }
  next(): number {
    const b = this.j >> 2;
    if (b !== this.block) {
      this.v[0] = this.x; this.v[1] = this.y; this.v[2] = this.z; this.v[3] = (this.seed + Math.imul(b, GOLDEN)) >>> 0;
      pcg4d(this.v);
      this.block = b;
    }
    return toUnit(this.v[this.j++ & 3]!);
  }
}

/** One uniform of key (x, y, z, seed), draw j. */
export function uniformAt(x: number, y: number, z: number, seed: number, j = 0): number {
  const v = Uint32Array.of(x >>> 0, y >>> 0, z >>> 0, (seed + Math.imul(j >> 2, GOLDEN)) >>> 0);
  return toUnit(pcg4d(v)[j & 3]!);
}

/** Below this mean, inversion; above, PTRS. */
export const POISSON_SWITCH = 30;

const LOG_FACT: number[] = [0];
function logFactorial(k: number): number {
  if (k < 256) {
    for (let i = LOG_FACT.length; i <= k; i++) LOG_FACT[i] = LOG_FACT[i - 1]! + Math.log(i);
    return LOG_FACT[k]!;
  }
  // Stirling with three correction terms (|ε| < 1e-15 for k ≥ 256)
  const x = k + 1;
  return (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) + 1 / (12 * x) - 1 / (360 * x ** 3) + 1 / (1260 * x ** 5);
}

/**
 * Exact Poisson variate from a uniform stream: sequential inversion of the CDF below λ = 30
 * (bounded at 4λ + 40 terms), Hörmann's transformed rejection PTRS (1993) above.
 */
export function poisson(lambda: number, U: { next(): number }): number {
  if (!(lambda > 0)) return 0;
  if (lambda < POISSON_SWITCH) {
    const u = U.next();
    let p = Math.exp(-lambda);
    let F = p;
    let k = 0;
    const kmax = Math.ceil(4 * lambda + 40);
    while (u >= F && k < kmax) {
      k++;
      p *= lambda / k;
      F += p;
    }
    return k;
  }
  const slam = Math.sqrt(lambda);
  const loglam = Math.log(lambda);
  const b = 0.931 + 2.53 * slam;
  const a = -0.059 + 0.02483 * b;
  const invalpha = 1.1239 + 1.1328 / (b - 3.4);
  const vr = 0.9277 - 3.6224 / (b - 2);
  for (let it = 0; it < 1000; it++) {
    const u = U.next() - 0.5;
    const v = U.next();
    const us = 0.5 - Math.abs(u);
    const k = Math.floor(((2 * a) / us + b) * u + lambda + 0.43);
    if (us >= 0.07 && v <= vr) return k;
    if (k < 0 || (us < 0.013 && v > us)) continue;
    const lhs = Math.log(v) + Math.log(invalpha) - Math.log(a / (us * us) + b);
    const rhs = -lambda + k * loglam - logFactorial(k);
    if (lhs <= rhs) return k;
  }
  return Math.round(lambda);
}
