// The laws' arithmetic per pixel (contract 1.0, design §22, §25): one definition, which the reference engine calls
// and the GPU engine mirrors in WGSL, as frame.ts's straighten is the one definition of output.frame's sampling.
// The contract still evaluates no image; these are the formulas of print.combine, composite.mix and mask.combine.

/** Lowest paper exposure the light law keeps (x = −8: paper white). */
export const H_FLOOR = 1e-8;

/** One light term at a pixel: its paper log exposure (per layer) and its weight w = amount · mask · ratio. */
export interface LightTermSample {
  role: 'burn' | 'dodge' | 'flash-base' | 'flash-open';
  /** log10 exposure of the term's print.expose at this pixel (a flash: its uniform value). */
  x: ArrayLike<number>;
  w: number;
}

/** Everything print.combine reads at one pixel. Weights already include amount, mask and (normalised mode) t_i / t_main. */
export interface LightSample {
  /** The main exposure's log10 H (the receiver) and its weight. */
  xMain: ArrayLike<number>;
  wMain: number;
  terms: readonly LightTermSample[];
  /** Density-mask densities d (D) with their weights: T_neg = 10^−Σ w·d. */
  densities: readonly { d: number; w: number }[];
  /** Filters: T_all = 10^Σ w·logH per layer. */
  filters: readonly { logH: ArrayLike<number>; w: number }[];
  /** Pre-exposures: + Σ w·φ after the filters. */
  preflash: readonly { fraction: number; w: number }[];
}

/**
 * The light law (design §22) at one pixel, per layer k:
 *   H = T_all · ( T_neg · ( max(E_main − Σ E_dodge, 0) + Σ E_burn ) + Σ E_flash ) + Σ E_pre
 *   E = w·10^x,  T_neg = 10^−Σ w·d,  T_all = 10^Σ w·logH,  E_pre = w·φ;  out = log10 max(H, H_FLOOR).
 * For today's kinds (no filters, no preflash, main weight 1) this is combinePixel. Returns whether a dodge withheld
 * more than the main exposure gave (beyond rounding) in any layer (W_DODGE_EXCEEDS_MAIN).
 */
export function lightH(s: LightSample, out: Float64Array | number[]): boolean {
  let clamped = false;
  let dm = 0;
  for (const d of s.densities) dm += d.w * d.d;
  const tNeg = 10 ** -dm;
  for (let k = 0; k < 3; k++) {
    const main = s.wMain * 10 ** s.xMain[k]!;
    let H = main;
    for (const t of s.terms) if (t.role === 'dodge') H -= t.w * 10 ** t.x[k]!;
    if (H < 0) {
      if (H < -1e-9 * main) clamped = true;
      H = 0;
    }
    for (const t of s.terms) if (t.role === 'burn') H += t.w * 10 ** t.x[k]!;
    H *= tNeg;
    for (const t of s.terms) if (t.role === 'flash-base' || t.role === 'flash-open') H += t.w * 10 ** t.x[k]!;
    let L = 0;
    for (const f of s.filters) L += f.w * f.logH[k]!;
    H *= 10 ** L;
    for (const p of s.preflash) H += p.w * p.fraction;
    out[k] = Math.log10(Math.max(H, H_FLOOR));
  }
  return clamped;
}

/**
 * The composite law per entry (design §4): out = back + k·(B(back, top) − back), k = amount · mask; normal: B = top.
 * k = 1 gives top exactly and k = 0 back exactly (engines keep both exact, so full coverage is the op itself).
 */
export function mixPixel(back: number, top: number, k: number): number {
  return k === 1 ? top : back + k * (top - back);
}

/**
 * The one mask algebra (design §25): v ← v + a·(op(v, c) − v); add = max, subtract = v·(1 − c), intersect = v·c.
 * a = 1 is the op exactly (so intersect commutes and add is idempotent bit for bit); a = 0 leaves v.
 */
export function maskCombine(mode: 'add' | 'subtract' | 'intersect', v: number, c: number, amount = 1): number {
  const r = mode === 'add' ? Math.max(v, c) : mode === 'subtract' ? v * (1 - c) : v * c;
  return amount === 1 ? r : v + amount * (r - v);
}
