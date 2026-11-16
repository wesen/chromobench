// The laws' arithmetic per pixel (contract 1.0, design §22, §25): one definition, which the reference engine calls
// and the GPU engine mirrors in WGSL, as frame.ts's straighten is the one definition of output.frame's sampling.
// The contract still evaluates no image; these are the formulas of print.combine, composite.mix and mask.combine,
// the grid rule every engine samples by, and the blend modes' channel formulas.
import { CONTRAST_BLENDS, type BlendMode } from './document.ts';
import { fail } from './errors.ts';

// ---- the grid rule (CHB-045, docs/patterns/gpu/03 "One grid rule") ------------------------------------------------

/**
 * A grid of n output pixels over [origin, origin + span) of the full-resolution image cannot be computed in u32 when
 * (2p + 1)·span may reach 2³²: n·span < GRID_LIMIT keeps it below (the GPU's kernels compute the rule in u32).
 */
export const GRID_LIMIT = 2 ** 31;

/** Refuses a grid whose rule would wrap in u32 (n·span ≥ 2³¹; 4000 px on 4000 px is 2²³·1.9). */
export function gridCheck(span: number, n: number): void {
  if (!(n * span < GRID_LIMIT)) fail('E_ARG_RANGE', `a grid of ${n} pixels over ${span} image pixels exceeds the grid rule's range (n·span < 2³¹)`);
}

/**
 * The grid rule: output pixel p of an n-pixel grid over [origin, origin + span) reads image pixel
 * origin + ⌊(2p + 1)·span / 2n⌋ — its centre (p + ½)·span/n, floored — in integers, so every engine picks the same pixel,
 * ties ((2p + 1)·span divisible by 2n) included. In f64 the product and the quotient's floor are exact below 2⁵³.
 */
export function gridSample(origin: number, span: number, n: number, p: number): number {
  return origin + Math.floor(((2 * p + 1) * span) / (2 * n));
}

/** The image pixels of every output pixel 0…n−1 along one axis (gridSample). */
export function gridAxis(origin: number, span: number, n: number): Int32Array {
  gridCheck(span, n);
  const out = new Int32Array(n);
  for (let p = 0; p < n; p++) out[p] = gridSample(origin, span, n, p);
  return out;
}

/** Lowest paper exposure the light law keeps (x = −8: paper white). */
export const H_FLOOR = 1e-8;

/**
 * Lowest blurred transmittance a density mask takes the log of (CHB-045, GPUC-3): density 8, denser than any negative.
 * The mask film's exposure underflows to 0 in f64 below 10⁻³²⁴ and in f32 below 10⁻⁴⁵ (and a GPU may flush subnormals
 * below 10⁻³⁸): an unfloored log is −∞, and the mask density with it.
 */
export const MASK_T_FLOOR = 1e-8;

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

// ---- the blend modes' channel formulas (contract 1.1; 1.5: D7) ------------------------------------------------------
// core's blendPixel and the mock call these; kernels/working.wgsl mirrors them branch for branch.

/**
 * The display encoding (D7): the sRGB transfer curve (IEC 61966-2-1) on a linear channel, extended oddly below 0 (above
 * 1 the formula continues). The contrast modes are evaluated in it; it is not the viewer's display space.
 */
export function displayEncode(v: number): number {
  const a = Math.abs(v);
  const e = a <= 0.0031308 ? 12.92 * a : 1.055 * a ** (1 / 2.4) - 0.055;
  return v < 0 ? -e : e;
}

/** The inverse of displayEncode. */
export function displayDecode(e: number): number {
  const a = Math.abs(e);
  const v = a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4;
  return e < 0 ? -v : v;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const dodge = (b: number, s: number): number => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));
const burn = (b: number, s: number): number => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));

/**
 * The separable blend B(b, s) of one channel, as written: the W3C formulas, and Photoshop's vivid light (burn by 2s
 * below ½, dodge by 2s − 1 above), linear light (b + 2s − 1, clamped to [0, 1]), pin light (min(b, 2s) below ½,
 * max(b, 2s − 1) above) and hard mix (1 where b + s ≥ 1, else 0). Values need not lie in [0, 1].
 */
export function blendChannel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'normal': return s;
    case 'multiply': return b * s;
    case 'screen': return b + s - b * s;
    case 'overlay': return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 'darken': return Math.min(b, s);
    case 'lighten': return Math.max(b, s);
    case 'colour-dodge': return dodge(b, s);
    case 'colour-burn': return burn(b, s);
    case 'hard-light': return s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 'soft-light': {
      if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
      return b + (2 * s - 1) * (d - b);
    }
    case 'vivid-light': return s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * s - 1);
    case 'linear-light': return clamp01(b + 2 * s - 1);
    case 'pin-light': return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
    case 'hard-mix': return b + s >= 1 ? 1 : 0;
    case 'difference': return Math.abs(b - s);
    case 'exclusion': return b + s - 2 * b * s;
    default: return s;
  }
}

/** Whether a mode is evaluated in the display encoding (D7). */
export const isContrastBlend = (mode: BlendMode): boolean => CONTRAST_BLENDS.includes(mode);

/**
 * A separable mode on linear channels (the composite law's B for an RGB entry): a contrast mode encodes both channels
 * for display, blends and decodes (it switches at display mid-grey); every other mode blends the linear values.
 */
export function blendSeparable(mode: BlendMode, b: number, s: number): number {
  if (!isContrastBlend(mode)) return blendChannel(mode, b, s);
  return displayDecode(blendChannel(mode, displayEncode(b), displayEncode(s)));
}
