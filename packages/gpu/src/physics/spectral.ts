// INTERIM f64 physics, ported from Chromogen (05-inline.js: spectrum.js 219–385, stock.js 386–477,
// channels.js 478–569, colour.js 867–933). It exists so the GPU engine can build its tables and be
// checked before @chromobench/core (CHB-003) and the data packs (CHB-004) land.
// TODO(CHB-003): replace with core's spectral maths; TODO(CHB-004): replace stock JSON with packs.

export const GRID = Object.freeze({ start: 380, stop: 780, step: 5, n: 81 });
export const WL = Float64Array.from({ length: GRID.n }, (_, i) => GRID.start + i * GRID.step);
export type Spec = Float64Array;
export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

export function interp(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number, left = 0, right = 0): number {
  if (x < xs[0]!) return left;
  if (x > xs[xs.length - 1]!) return right;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m]! <= x) lo = m;
    else hi = m;
  }
  const t = xs[hi] === xs[lo] ? 0 : (x - xs[lo]!) / (xs[hi]! - xs[lo]!);
  return ys[lo]! + t * (ys[hi]! - ys[lo]!);
}

export const table = (wl: ArrayLike<number>, values: ArrayLike<number>): Spec => Float64Array.from(WL, (w) => interp(wl, values, w));

export function blackbody(T: number): Spec {
  const c1 = 3741771852e-25;
  const c2 = 0.01438776877;
  const p = (w: number) => {
    const l = w * 1e-9;
    return c1 / Math.pow(l, 5) / (Math.exp(c2 / (l * T)) - 1);
  };
  const ref = p(560);
  return Float64Array.from(WL, (w) => p(w) / ref);
}

export function gaussian(mu: number, fwhm: number, peak = 1): Spec {
  const s = fwhm / 2.3548;
  return Float64Array.from(WL, (w) => peak * Math.exp(-0.5 * Math.pow((w - mu) / s, 2)));
}

let CMF: { X: Spec; Y: Spec; Z: Spec } | null = null;
/** Analytic CIE 1931 fit (Chromogen spectrum.js cmf). */
export function cmf(): { X: Spec; Y: Spec; Z: Spec } {
  if (CMF) return CMF;
  const g = (x: number, mu: number, s1: number, s2: number) => Math.exp(-0.5 * Math.pow((x - mu) / (x < mu ? s1 : s2), 2));
  CMF = {
    X: Float64Array.from(WL, (w) => 1.056 * g(w, 599.8, 37.9, 31) + 0.362 * g(w, 442, 16, 26.7) - 0.065 * g(w, 501.1, 20.4, 26.2)),
    Y: Float64Array.from(WL, (w) => 0.821 * g(w, 568.8, 46.9, 40.5) + 0.286 * g(w, 530.9, 16.3, 31.1)),
    Z: Float64Array.from(WL, (w) => 1.217 * g(w, 437, 11.8, 36) + 0.681 * g(w, 459, 26, 13.8)),
  };
  return CMF;
}

export function xyz(refl: Spec, light: Spec): Vec3 {
  const c = cmf();
  let X = 0, Y = 0, Z = 0, k = 0;
  for (let i = 0; i < GRID.n; i++) {
    const s = light[i]!;
    const r = refl[i]!;
    X += s * r * c.X[i]!;
    Y += s * r * c.Y[i]!;
    Z += s * r * c.Z[i]!;
    k += s * c.Y[i]!;
  }
  return [X / k, Y / k, Z / k];
}

// ---- colour.js ----
export const D65: Vec3 = [0.95047, 1, 1.08883];
const BRADFORD: Mat3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
const BRADFORD_INV: Mat3 = [[0.9869929, -0.1470543, 0.1599627], [0.4323053, 0.5183603, 0.0492912], [-85287e-7, 0.0400428, 0.9684867]];
export const XYZ_TO_SRGB: Mat3 = [[3.2404542, -1.5371385, -0.4985314], [-0.969266, 1.8760108, 0.041556], [0.0556434, -0.2040259, 1.0572252]];
export const mv = (M: readonly (readonly number[])[], v: readonly number[]): Vec3 => [
  M[0]![0]! * v[0]! + M[0]![1]! * v[1]! + M[0]![2]! * v[2]!,
  M[1]![0]! * v[0]! + M[1]![1]! * v[1]! + M[1]![2]! * v[2]!,
  M[2]![0]! * v[0]! + M[2]![1]! * v[1]! + M[2]![2]! * v[2]!,
];
export function adapt(X: Vec3, from: Vec3, to: Vec3 = D65): Vec3 {
  const s = mv(BRADFORD, from);
  const d = mv(BRADFORD, to);
  const c = mv(BRADFORD, X);
  return mv(BRADFORD_INV, [(c[0] * d[0]) / s[0], (c[1] * d[1]) / s[1], (c[2] * d[2]) / s[2]]);
}
export const srgbEncode = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

// ---- stock.js ----
export class Curve {
  readonly logH: Float64Array;
  readonly D: Float64Array;
  constructor(logH: ArrayLike<number>, D: ArrayLike<number>) {
    const d = Float64Array.from(D);
    for (let i = 1; i < d.length; i++) if (d[i]! <= d[i - 1]!) d[i] = d[i - 1]! + 1e-9;
    this.logH = Float64Array.from(logH);
    this.D = d;
  }
  at(x: number): number { return interp(this.logH, this.D, x, this.D[0]!, this.D[this.D.length - 1]!); }
  inverse(y: number): number { return interp(this.D, this.logH, y, this.logH[0]!, this.logH[this.logH.length - 1]!); }
}

export interface Stock {
  name: string;
  sensitivity: [Spec, Spec, Spec];
  dyes: [Spec, Spec, Spec];
  base: Spec;
  curves: [Curve, Curve, Curve];
}

/** spektrafilm-format stock JSON (as shipped in Chromogen's st-data/cg/stocks). */
export interface StockJson {
  info: { stock: string; name?: string };
  data: { wavelengths: number[]; log_sensitivity: (number | null)[][]; channel_density: (number | null)[][]; base_density: (number | null)[]; log_exposure: number[]; density_curves: (number | null)[][] };
}

export function loadStock(j: StockJson): Stock {
  const d = j.data;
  if (d.wavelengths.length !== GRID.n || d.wavelengths[0] !== GRID.start) throw new Error(`stock ${j.info.stock} is not on the 380–780 nm, 5 nm grid`);
  const col = (rows: (number | null)[][], i: number) => rows.map((r) => (r[i] == null ? NaN : r[i]!));
  const three = <T>(f: (i: number) => T): [T, T, T] => [f(0), f(1), f(2)];
  return {
    name: j.info.stock,
    sensitivity: three((i) => Float64Array.from(col(d.log_sensitivity, i), (v) => (Number.isFinite(v) ? Math.pow(10, v) : 0))),
    dyes: three((i) => Float64Array.from(col(d.channel_density, i), (v) => (Number.isFinite(v) ? v : 0))),
    base: Float64Array.from(d.base_density, (v) => v || 0),
    curves: three((i) => new Curve(d.log_exposure, col(d.density_curves, i))),
  };
}

// ---- channels.js ----
/** Normalised channel responsivities P̂_k (each sums to 1). */
export interface Channels { P: [Spec, Spec, Spec] }

export function channels(R: Spec, G: Spec, B: Spec): Channels {
  const norm = (s: Spec) => {
    let t = 0;
    for (const v of s) t += v;
    return Float64Array.from(s, (v) => v / t);
  };
  return { P: [norm(R), norm(G), norm(B)] };
}

export function readDensity(ch: Channels, D: Spec): Vec3 {
  const out: number[] = [];
  for (const p of ch.P) {
    let s = 0;
    for (let i = 0; i < GRID.n; i++) s += p[i]! * Math.pow(10, -D[i]!);
    out.push(-Math.log10(s));
  }
  return out as Vec3;
}

/** K_kj: density channel k reads from one unit of dye j alone. */
export function analytical(ch: Channels, dyes: readonly Spec[]): Mat3 {
  return [0, 1, 2].map((k) => dyes.map((e) => readDensity(ch, e)[k]!)) as Mat3;
}

export interface CameraJson { wl: number[]; R: number[]; G: number[]; B: number[] }

/** Chromogen makeScanner (model.js 1645–1658). */
export function scannerChannels(id: string, camera: CameraJson): Channels {
  const cam = { R: table(camera.wl, camera.R), G: table(camera.wl, camera.G), B: table(camera.wl, camera.B) };
  const led = (r: number, g: number, b: number, w = 20, wg = w) => ({ R: gaussian(r, w), G: gaussian(g, wg), B: gaussian(b, w) });
  let L;
  if (id === 'xt5-fitted' || id === 'xt5-rgb-led') L = led(678, 532, 472);
  else if (id === 'rgb-led-book') L = led(660, 530, 450, 20, 25);
  else throw new Error(`unknown scanner ${id}`);
  const mul = (a: Spec, b: Spec) => Float64Array.from(a, (v, i) => v * b[i]!);
  return channels(mul(L.R, cam.R), mul(L.G, cam.G), mul(L.B, cam.B));
}

export function printingChannels(paper: Stock, lampK = 3200): Channels {
  const lamp = blackbody(lampK);
  const mul = (s: Spec) => Float64Array.from(s, (v, i) => v * lamp[i]!);
  return channels(mul(paper.sensitivity[0]), mul(paper.sensitivity[1]), mul(paper.sensitivity[2]));
}

/** Paper exposure of clear light per layer, log₁₀ (print.js makePrinter clear). */
export function printerClear(paper: Stock, lampK = 3200): Vec3 {
  const L = blackbody(lampK);
  return paper.sensitivity.map((s) => Math.log10(s.reduce((t, v, i) => t + L[i]! * v, 0))) as Vec3;
}
