// Film grain (CHB-012 guide §2.8, §5.4; textbook §2.5; spektrafilm model/grain.py, sublayer path).
// Each channel is split into the stock's three sublayers; each sublayer's dye amount is a scaled
// Poisson count: k ~ Poisson(p·N/s), D̂ = k·D_max·s/N, p = D/D_max, s = 1 − u·p — exactly the
// distribution of spektrafilm's Poisson-then-binomial draw (binomial thinning of a Poisson is
// Poisson). Then each sublayer is blurred by its dye cloud, density_min is removed and the sum is
// blurred by GrainParams.blur pixels of the print-size grid. Random numbers are counter-based
// (rng.ts) on print-grid coordinates, so any region equals the same region of a full render.
import type { Vec3 } from '../spectral/linalg.ts';
import type { Stock } from '../spectral/stock.ts';
import { blurField } from './blur.ts';
import { interpClamp, type FilmCurves, type Layer } from './curves.ts';
import { KeyedUniforms, poisson } from './rng.ts';

export interface GrainSpec {
  particleArea_um2: number;
  channelScale: Vec3;
  /** fast, medium, slow */
  sublayerScale: Vec3;
  uniformity: Vec3;
  densityMin: Vec3;
  /** σ of a dye cloud = dyeCloudBlur · √(od_particle) px (a fixed size in µm). */
  dyeCloudBlur: number;
  /** Final blur, pixels of the print-size grid. */
  finalBlur_px: number;
  /** Fluctuation scale (contract film.grain amount): D + amount·(D̂ − D). */
  amount: number;
  seed: number;
}

/** GrainParams() of spektrafilm runtime/params_schema.py (3bb2c2d). */
export const GRAIN_DEFAULTS: Readonly<GrainSpec> = Object.freeze({
  particleArea_um2: 0.2, channelScale: [1.6, 1.6, 3.2] as Vec3, sublayerScale: [2, 1, 0.5] as Vec3,
  uniformity: [0.97, 0.99, 0.97] as Vec3, densityMin: [0.03, 0.03, 0.03] as Vec3, dyeCloudBlur: 1, finalBlur_px: 0.65, amount: 1, seed: 1,
});

/** Contract film.grain args → spec: size_um scales the crystal area by (size_um / 12)² (12 µm = the stock's own). */
export function grainSpec(o: { amount?: number; size_um?: number; seed?: number } = {}): GrainSpec {
  const sz = (o.size_um ?? 12) / 12;
  return { ...GRAIN_DEFAULTS, particleArea_um2: GRAIN_DEFAULTS.particleArea_um2 * sz * sz, amount: o.amount ?? 1, seed: o.seed ?? 1 };
}

/** Per-stock sublayer data: the curves of the three sublayers against the channel's dye amount. */
export interface Sublayers {
  /** channel k: dye amounts d (x axis, the min-subtracted curve) */
  d: [Float64Array, Float64Array, Float64Array];
  /** channel k, sublayer i: sublayer dye amount at d */
  layer: Float64Array[][];
  /** [sublayer][channel] maxima (+ their share of density_min) */
  dmax: number[][];
  /** [sublayer][channel] shares of the channel maximum */
  frac: number[][];
  /** [sublayer][channel] share of density_min */
  dmin: number[][];
}

/**
 * Sublayer curves of a stock. `layers` is spektrafilm's density_curves_layers flattened
 * [logH][sublayer][channel] (256 × 3 × 3); without them, one sublayer per channel equal to the curve.
 */
export function sublayersOf(curves: FilmCurves, layers: ArrayLike<number> | undefined, s: GrainSpec): Sublayers {
  const n = curves.logH.length;
  const L = layers && layers.length === n * 9
    ? [0, 1, 2].map((ch) => [0, 1, 2].map((sl) => Float64Array.from({ length: n }, (_, i) => { const v = layers[i * 9 + sl * 3 + ch]!; return Number.isFinite(v) ? v : 0; })))
    : [0, 1, 2].map((ch) => [Float64Array.from(curves.f[ch as Layer]), new Float64Array(n), new Float64Array(n)]);
  const dmax = [0, 1, 2].map((sl) => [0, 1, 2].map((ch) => Math.max(...L[ch]![sl]!)));
  const tot = [0, 1, 2].map((ch) => dmax[0]![ch]! + dmax[1]![ch]! + dmax[2]![ch]!);
  const frac = dmax.map((r) => r.map((v, ch) => (tot[ch]! > 0 ? v / tot[ch]! : 0)));
  const dmin = frac.map((r) => r.map((f, ch) => f * s.densityMin[ch]!));
  return { d: [curves.f[0], curves.f[1], curves.f[2]], layer: L, dmax: dmax.map((r, sl) => r.map((v, ch) => v + dmin[sl]![ch]!)), frac, dmin };
}

/** Crystals per pixel and dye of one crystal, per [sublayer][channel], for a pixel pitch in µm. */
export function crystals(sub: Sublayers, s: GrainSpec, umPerPx: number): { N: number[][]; od: number[][] } {
  const A = umPerPx * umPerPx;
  const N = [0, 1, 2].map((sl) => [0, 1, 2].map((ch) => (A * sub.frac[sl]![ch]!) / (s.particleArea_um2 * s.channelScale[ch]! * s.sublayerScale[sl]!)));
  const od = N.map((r, sl) => r.map((v, ch) => (v > 0 ? sub.dmax[sl]![ch]! / v : 0)));
  return { N, od };
}

/** Sublayer dye amounts (+ their density_min share) of a channel at dye amount d. */
export function sublayerSplit(sub: Sublayers, ch: Layer, d: number): Vec3 {
  return [0, 1, 2].map((sl) => interpClamp(sub.d[ch], sub.layer[ch]![sl]!, d) + sub.dmin[sl]![ch]!) as Vec3;
}

/** One sublayer draw: D̂ = k·od·s with k ~ Poisson(p N / s). */
export function grainDraw(D: number, dmax: number, N: number, u: number, U: { next(): number }): number {
  if (!(N > 0) || !(dmax > 0)) return D;
  const p = Math.min(1 - 1e-6, Math.max(1e-6, D / dmax));
  const sat = 1 - p * u * (1 - 1e-6);
  const k = poisson((p * N) / sat, U);
  return (k * dmax * sat) / N;
}

export interface PrintGrid {
  /** Film µm per print-grid pixel. */
  umPerPx: number;
  /** Print-grid coordinates of pixel (0, 0) of the array (a tile's origin). */
  origin?: { x: number; y: number };
}

/**
 * film.grain on an interleaved 3-channel dye image (w × h) on the print-size grid. A region renders
 * equal to the same region of a full render when it is padded by the blur halo (grainHalo()).
 */
export function grainImage(dyes: Float64Array, w: number, h: number, grid: PrintGrid, sub: Sublayers, s: GrainSpec): Float64Array {
  const n = w * h;
  const { N, od } = crystals(sub, s, grid.umPerPx);
  const ox = grid.origin?.x ?? 0, oy = grid.origin?.y ?? 0;
  const U = new KeyedUniforms();
  // per sublayer: a 3-channel field
  const fields = [0, 1, 2].map(() => new Float64Array(n * 3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    for (let ch = 0; ch < 3; ch++) {
      const D = sublayerSplit(sub, ch as Layer, dyes[i * 3 + ch]!);
      for (let sl = 0; sl < 3; sl++) {
        U.reset(ox + x, oy + y, ch * 4 + sl, s.seed);
        fields[sl]![i * 3 + ch] = grainDraw(D[sl]!, sub.dmax[sl]![ch]!, N[sl]![ch]!, s.uniformity[ch]!, U);
      }
    }
  }
  const sum = new Float64Array(n * 3);
  for (let sl = 0; sl < 3; sl++) {
    const sig = [0, 1, 2].map((ch) => s.dyeCloudBlur * Math.sqrt(od[sl]![ch]!));
    const b = s.dyeCloudBlur > 0 ? blurField(fields[sl]!, w, h, 3, sig) : fields[sl]!;
    for (let i = 0; i < n * 3; i++) sum[i]! += b[i]!;
  }
  for (let i = 0; i < n * 3; i++) sum[i]! -= s.densityMin[i % 3]!;
  const g = s.finalBlur_px > 0 ? blurField(sum, w, h, 3, [s.finalBlur_px, s.finalBlur_px, s.finalBlur_px]) : sum;
  if (s.amount === 1) return g;
  return g.map((v, i) => dyes[i]! + s.amount * (v - dyes[i]!));
}

/** Pixels of halo a tile needs so its interior equals a full render (4σ of the widest blur). */
export function grainHalo(sub: Sublayers, s: GrainSpec, umPerPx: number): number {
  const { od } = crystals(sub, s, umPerPx);
  const cloud = Math.max(...od.flat().map((v) => s.dyeCloudBlur * Math.sqrt(v)));
  return Math.ceil(4 * cloud) + Math.ceil(4 * s.finalBlur_px) + 1;
}

/** Selwyn granularity G = σ²·A (µm²·D²) of channel k at mean dye amount D, closed form (no blur). */
export function selwynG(sub: Sublayers, s: GrainSpec, ch: Layer, D: number): number {
  const Ds = sublayerSplit(sub, ch, D);
  let G = 0;
  for (let sl = 0; sl < 3; sl++) {
    const dm = sub.dmax[sl]![ch]!, f = sub.frac[sl]![ch]!;
    if (!(dm > 0) || !(f > 0)) continue;
    const a = s.particleArea_um2 * s.channelScale[ch]! * s.sublayerScale[sl]!;
    G += Ds[sl]! * dm * (a / f) * (1 - (s.uniformity[ch]! * Ds[sl]!) / dm);
  }
  return G;
}

/** RMS granularity (1000 σ through a 48 µm circular aperture) at mean dye amount D. */
export const rmsGranularity48 = (sub: Sublayers, s: GrainSpec, ch: Layer, D: number): number => 1000 * Math.sqrt(selwynG(sub, s, ch, D) / (Math.PI * 24 * 24));

