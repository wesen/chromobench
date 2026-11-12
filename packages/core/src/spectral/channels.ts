// Channels: three normalised responsivities and what they read (§1.3–1.6).
// Ported from Chromogen channels.js (05-inline.js 477–567); `analytical` survives only as `secant`.
import { fail } from '@chromobench/contract';
import { inv3, mulMV, singularValues3, type Mat3, type Vec3 } from './linalg.ts';
import type { Stock } from './stock.ts';
import { GRID, interp, NW, Spectrum } from './spectrum.ts';

const LN10 = Math.LN10;
export type Triple<T> = [T, T, T];

export class Channels {
  readonly name: string;
  /** Normalised weights w_ki (each sums to 1 unless masked). */
  readonly P: Triple<Float64Array>;
  constructor(P: Triple<Spectrum | ArrayLike<number>>, name = 'channels', normalise = true) {
    this.name = name;
    this.P = P.map((s) => {
      const v = Float64Array.from(s instanceof Spectrum ? s.values : s);
      if (v.length !== NW) fail('E_DATA_GRID', `channel responsivity has ${v.length} samples, not ${NW}`);
      if (!normalise) return v;
      let tot = 0;
      for (const x of v) tot += x;
      if (!(tot > 0)) fail('E_EVAL', `channel set ${name} has an empty channel`);
      return v.map((x) => x / tot);
    }) as Triple<Float64Array>;
  }
  /** Channel densities −log10 Σ w 10^−D (a weighted soft minimum). */
  read(D: ArrayLike<number>): Vec3 {
    const out: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const p = this.P[k]!;
      let s = 0;
      for (let i = 0; i < NW; i++) s += p[i]! * 10 ** -D[i]!;
      out[k] = -Math.log10(s);
    }
    return out;
  }
  transmittance(D: ArrayLike<number>): Vec3 {
    return this.read(D).map((d) => 10 ** -d) as Vec3;
  }
  /** P·pass, NOT renormalised: masked light is lost, not redistributed (guide §5.2). */
  masked(pass: ArrayLike<number>): Channels {
    return new Channels(this.P.map((p) => p.map((v, i) => v * pass[i]!)) as Triple<Float64Array>, this.name, false);
  }
  centroids_nm(): Vec3 {
    return this.P.map((p) => {
      let s = 0;
      let w = 0;
      p.forEach((v, i) => { s += v * GRID.wl[i]!; w += v; });
      return s / w;
    }) as Vec3;
  }
}

// Hunt Table 14.1, log10 of the product at 10 nm, peak 5.000 (Chromogen SM).
const SM: Record<'R' | 'G' | 'B', Record<number, number>> = {
  R: { 620: 2.109, 630: 4.479, 640: 5, 650: 4.899, 660: 4.578, 670: 4.252, 680: 3.875, 690: 3.491, 700: 3.099, 710: 2.687, 720: 2.269, 730: 1.859, 740: 1.449, 750: 1.054, 760: 0.654, 770: 0.254 },
  G: { 470: 1.152, 480: 2.207, 490: 3.156, 500: 3.804, 510: 4.272, 520: 4.626, 530: 4.872, 540: 5, 550: 4.995, 560: 4.818, 570: 4.458, 580: 3.915, 590: 3.172, 600: 2.239, 610: 1.07 },
  B: { 410: 2.103, 420: 4.111, 430: 4.632, 440: 4.871, 450: 5, 460: 4.955, 470: 4.743, 480: 4.343, 490: 3.743, 500: 2.99, 510: 1.852 },
};

/** Status M: interpolated in log and exponentiated (Chromogen statusM). */
export function statusM(): Channels {
  const P = (['R', 'G', 'B'] as const).map((k) => {
    const xs = Object.keys(SM[k]).map(Number).sort((a, b) => a - b);
    const ys = xs.map((x) => SM[k][x]!);
    return Array.from(GRID.wl, (w) => (w < xs[0]! || w > xs[xs.length - 1]! ? 0 : 10 ** (interp(xs, ys, w) - 5)));
  }) as Triple<number[]>;
  return new Channels(P, 'status-m');
}

/** Scanner density: light × camera (G&M Eq. B.4); one light per channel for sequential capture. */
export function scannerChannels(light: ArrayLike<number> | Triple<ArrayLike<number>>, camera: Triple<ArrayLike<number>>, name = 'scanner'): Channels {
  const lights = (Array.isArray(light) && light.length === 3 && typeof light[0] !== 'number' ? light : [light, light, light]) as Triple<ArrayLike<number>>;
  const P = camera.map((cam, k) => Float64Array.from({ length: NW }, (_, i) => cam[i]! * lights[k]![i]!)) as Triple<Float64Array>;
  return new Channels(P, name);
}

// ---- derivatives and K (§1.3–1.6) ---------------------------------------------------------------

/** Effective weights through a stock: P_k·pass. */
const eff = (ch: Channels, stock: Stock): Triple<Float64Array> => ch.P.map((p) => p.map((v, i) => v * stock.pass[i]!)) as Triple<Float64Array>;

/** Absolute channel densities of the stock at dye amounts c (base included). */
export function readStock(ch: Channels, stock: Stock, c: ArrayLike<number>): Vec3 {
  return ch.masked(stock.pass).read(stock.spectral(c));
}

/** J_kj = Σ w̃_ki ε_j(λ_i): the mean unit dye under the transmitted-light weight (§1.3, §3.2). */
export function jacobian(ch: Channels, stock: Stock, c: ArrayLike<number>): Mat3 {
  const P = eff(ch, stock);
  const D = stock.spectral(c);
  return P.map((p) => {
    let s = 0;
    const m = [0, 0, 0];
    for (let i = 0; i < NW; i++) {
      const w = p[i]! * 10 ** -D[i]!;
      s += w;
      for (let j = 0; j < 3; j++) m[j]! += w * stock.dyes[j]![i]!;
    }
    return m.map((v) => v / s);
  }) as Mat3;
}

/** ∂²D_k/∂c∂c = −ln10 · Cov_w̃(ε): negative semidefinite, so D_k is concave (§1.3). */
export function hessian(ch: Channels, stock: Stock, c: ArrayLike<number>, k: 0 | 1 | 2): Mat3 {
  const p = eff(ch, stock)[k];
  const D = stock.spectral(c);
  let s = 0;
  const m = [0, 0, 0];
  const mm = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < NW; i++) {
    const w = p[i]! * 10 ** -D[i]!;
    s += w;
    for (let j = 0; j < 3; j++) {
      const ej = stock.dyes[j]![i]!;
      m[j]! += w * ej;
      for (let l = 0; l < 3; l++) mm[j]![l]! += w * ej * stock.dyes[l]![i]!;
    }
  }
  return [0, 1, 2].map((j) => [0, 1, 2].map((l) => -LN10 * (mm[j]![l]! / s - (m[j]! / s) * (m[l]! / s)))) as Mat3;
}

/** Hunt's analytical densities: each unit dye alone, no base (Chromogen `analytical`). Comparison only. */
export function secant(ch: Channels, stock: Stock): Mat3 {
  const m = ch.masked(stock.pass);
  const cols = stock.dyes.map((e) => m.read(e.map((v, i) => (stock.pass[i] ? v : 0))));
  return [0, 1, 2].map((k) => [cols[0]![k]!, cols[1]![k]!, cols[2]![k]!]) as Mat3;
}

/** Jacobian at zero dye, no base: the tangent at the origin (§1.4). */
export function tangentAtZero(ch: Channels, stock: Stock): Mat3 {
  return jacobian(ch, { ...stock, spectral: (_c, out = new Float64Array(NW)) => out.fill(0) }, [0, 0, 0]);
}

/** Jacobian at zero dye through the base-weighted responsivity (= jacobian at c = 0 with the base). */
export function baseWeightedK(ch: Channels, stock: Stock): Mat3 {
  return jacobian(ch, stock, [0, 0, 0]);
}

/** P·10^−b, renormalised: subtracting a base reading is reading through this channel (§1.6). */
export function relativeTo(ch: Channels, base: ArrayLike<number>): Channels {
  return new Channels(ch.P.map((p) => p.map((v, i) => v * 10 ** -base[i]!)) as Triple<Float64Array>, `${ch.name}/rel`);
}

/** c = K⁻¹d with the conditioning of K. */
export function solveLinear(K: Mat3, d: ArrayLike<number>): { c: Vec3; cond: number; sigma: Vec3; sigmaMin: number } {
  const sigma = singularValues3(K);
  return { c: mulMV(inv3(K), d), cond: sigma[0] / sigma[2], sigma, sigmaMin: sigma[2] };
}
