// Viewing and colour (§2.7): single-pass reflectance, XYZ with Y(white) = 1, flare, Bradford/CAT16,
// CIELAB, CIEDE2000, sRGB/P3 encoding. Ported from Chromogen colour.js (05-inline.js 866–932).
import { inv3, mulMM, mulMV, type Mat3, type Vec3 } from '../spectral/linalg.ts';
import type { Stock } from '../spectral/stock.ts';
import { NW } from '../spectral/spectrum.ts';

export const D65: Vec3 = [0.95047, 1, 1.08883];
export const D50: Vec3 = [0.96422, 1, 0.82521];

export interface Viewing {
  illuminant: ArrayLike<number>;
  cmf: readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];
  paper: Stock;
}

/** R(λ) = pass·10^−D_p(λ) (single pass; Saunderson's model is CHB-015). */
export function reflectance(v: Viewing, cp: ArrayLike<number>, out = new Float64Array(NW)): Float64Array {
  const D = v.paper.spectral(cp, out);
  for (let i = 0; i < NW; i++) out[i] = v.paper.pass[i] ? 10 ** -D[i]! : 0;
  return out;
}

/** XYZ = Σ E R x̄ / Σ E ȳ: a perfect white has Y = 1. */
export function observe(v: Viewing, R: ArrayLike<number>): Vec3 {
  let X = 0;
  let Y = 0;
  let Z = 0;
  let k = 0;
  const [cx, cy, cz] = v.cmf;
  for (let i = 0; i < NW; i++) {
    const e = v.illuminant[i]!;
    const er = e * R[i]!;
    X += er * cx[i]!;
    Y += er * cy[i]!;
    Z += er * cz[i]!;
    k += e * cy[i]!;
  }
  return [X / k, Y / k, Z / k];
}

export const whiteXYZ = (v: Viewing): Vec3 => observe(v, new Float64Array(NW).fill(1));
export const paperWhiteXYZ = (v: Viewing): Vec3 => observe(v, reflectance(v, [0, 0, 0]));

/** X + f·W (flare as a fraction of a white; G&M App. E). */
export const addFlare = (X: ArrayLike<number>, fraction: number, flareWhite: ArrayLike<number>): Vec3 =>
  [X[0]! + fraction * flareWhite[0]!, X[1]! + fraction * flareWhite[1]!, X[2]! + fraction * flareWhite[2]!];

export const BRADFORD: Mat3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
export const BRADFORD_INV: Mat3 = inv3(BRADFORD);
export const CAT16: Mat3 = [[0.401288, 0.650173, -0.051461], [-0.250268, 1.204414, 0.045854], [-0.002079, 0.048952, 0.953127]];

function vonKries(M: Mat3, Minv: Mat3, X: ArrayLike<number>, from: ArrayLike<number>, to: ArrayLike<number>): Vec3 {
  const s = mulMV(M, from);
  const d = mulMV(M, to);
  const c = mulMV(M, X);
  return mulMV(Minv, [c[0] * d[0] / s[0], c[1] * d[1] / s[1], c[2] * d[2] / s[2]]);
}
/** Bradford chromatic adaptation; maps `from` exactly onto `to`. */
export const adaptBradford = (X: ArrayLike<number>, from: ArrayLike<number>, to: ArrayLike<number> = D65): Vec3 => vonKries(BRADFORD, BRADFORD_INV, X, from, to);
/** The 3×3 matrix of a Bradford adaptation. */
export function bradfordMatrix(from: ArrayLike<number>, to: ArrayLike<number> = D65): Mat3 {
  const s = mulMV(BRADFORD, from);
  const d = mulMV(BRADFORD, to);
  const D: Mat3 = [[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]];
  return mulMM(BRADFORD_INV, mulMM(D, BRADFORD));
}

export const XYZ_TO_SRGB: Mat3 = [[3.2404542, -1.5371385, -0.4985314], [-0.969266, 1.8760108, 0.041556], [0.0556434, -0.2040259, 1.0572252]];
export const SRGB_TO_XYZ: Mat3 = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]];

export const encodeSRGB = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
export const hex = (rgb: ArrayLike<number>): string => '#' + Array.from(rgb, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

export function lab(X: ArrayLike<number>, white: ArrayLike<number> = D65): Vec3 {
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X[0]! / white[0]!);
  const fy = f(X[1]! / white[1]!);
  const fz = f(X[2]! / white[2]!);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE2000(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const [L1, a1, b1] = [a[0]!, a[1]!, a[2]!];
  const [L2, a2, b2] = [b[0]!, b[1]!, b[2]!];
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hue = (x: number, y: number): number => {
    if (x === 0 && y === 0) return 0;
    const h = Math.atan2(y, x) / rad;
    return h < 0 ? h + 360 : h;
  };
  const hp1 = hue(ap1, b1);
  const hp2 = hue(ap2, b2);
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2;
  const Cpm = (Cp1 + Cp2) / 2;
  let hm = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) hm = Math.abs(hp1 - hp2) <= 180 ? hm / 2 : hm < 360 ? (hm + 360) / 2 : (hm - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTh = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const SC = 1 + 0.045 * Cpm;
  const SH = 1 + 0.015 * Cpm * T;
  const RT = -Math.sin(2 * dTh * rad) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

// ---- Output spaces (CHB-011, guide §2.1 and §5.3) ------------------------------------------------
// "Profiles from files, maths from profiles" (decision D3): the numbers below are the bundled CC0
// Compact ICC v4 profiles' own s15Fixed16 integers (÷ 65536): colorants (rXYZ gXYZ bXYZ, D50-adapted),
// the chromatic adaptation `chad` and the parametric TRC. Encoding with them and embedding the profile
// therefore agree exactly; @chromobench/output parses the files and checks these constants against them
// (and the matrices against the analytic ones from the primaries, within 1e-4).

export type OutputSpaceId = 'srgb' | 'display-p3' | 'rec2020' | 'adobe-rgb' | 'prophoto';
export const OUTPUT_SPACE_IDS: readonly OutputSpaceId[] = ['srgb', 'display-p3', 'rec2020', 'adobe-rgb', 'prophoto'];

/** ICC parametricCurveType (ICC.1 §10.18): encoded X → linear Y. */
export interface ParametricCurve { type: 0 | 1 | 2 | 3 | 4; g: number; a?: number; b?: number; c?: number; d?: number; e?: number; f?: number }

/** Linear Y of an encoded value X (what a CMM computes from the profile's TRC). */
export function decodeCurve(cv: ParametricCurve, X: number): number {
  const { g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0 } = cv;
  const pw = (v: number): number => (v > 0 ? v ** g : 0);
  switch (cv.type) {
    case 0: return pw(X);
    case 1: return X >= -b / a ? pw(a * X + b) : 0;
    case 2: return X >= -b / a ? pw(a * X + b) + c : c;
    case 3: return X >= d ? pw(a * X + b) : c * X;
    case 4: return X >= d ? pw(a * X + b) + e : c * X + f;
  }
}

/**
 * Encoded X of a linear Y: the inverse of decodeCurve. Where the profile's two segments do not meet
 * exactly at d (s15Fixed16 rounding leaves gaps of ~1e-6), values inside the gap map to d.
 */
export function encodeCurve(cv: ParametricCurve, Y: number): number {
  const { g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0 } = cv;
  const root = (v: number): number => (v > 0 ? v ** (1 / g) : 0);
  switch (cv.type) {
    case 0: return root(Y);
    case 1: return (root(Y) - b) / a;
    case 2: return Y <= c ? -b / a : (root(Y - c) - b) / a;
    case 3: return Y < c * d ? Y / c : Math.max(d, (root(Y) - b) / a);
    case 4: return Y < c * d + f ? (Y - f) / c : Math.max(d, (root(Y - e) - b) / a);
  }
}

const S15 = (v: readonly number[]): number[] => v.map((x) => x / 65536);
const m3 = (v: readonly number[]): Mat3 => [[v[0]!, v[1]!, v[2]!], [v[3]!, v[4]!, v[5]!], [v[6]!, v[7]!, v[8]!]];
const cols = (r: readonly number[], g: readonly number[], b: readonly number[]): Mat3 => [[r[0]!, g[0]!, b[0]!], [r[1]!, g[1]!, b[1]!], [r[2]!, g[2]!, b[2]!]];

/** The profiles' raw s15Fixed16 tag values (see the block comment above). `para` is type 3: g a b c d. */
export const ICC_V4_RAW: Record<OutputSpaceId, { rXYZ: number[]; gXYZ: number[]; bXYZ: number[]; chad: number[]; para: number[] }> = {
  'srgb': { rXYZ: [28576, 14578, 911], gXYZ: [25238, 46985, 6362], bXYZ: [9376, 3973, 46788], chad: [68671, 1501, -3290, 1936, 64914, -1119, -606, 988, 49265], para: [157289, 62119, 3417, 5072, 2651] },
  'display-p3': { rXYZ: [33759, 15807, -69], gXYZ: [19135, 45367, 2745], bXYZ: [10296, 4362, 51385], chad: [68674, 1502, -3291, 1939, 64912, -1119, -606, 988, 49262], para: [157289, 62119, 3417, 5072, 2651] },
  'rec2020': { rXYZ: [44137, 18288, -127], gXYZ: [10858, 44259, 1965], bXYZ: [8195, 2989, 52223], chad: [68674, 1502, -3291, 1939, 64912, -1119, -606, 988, 49262], para: [145637, 59616, 5920, 14564, 5309] },
  'adobe-rgb': { rXYZ: [39960, 20389, 1276], gXYZ: [13453, 41004, 3989], bXYZ: [9777, 4143, 48796], chad: [68674, 1502, -3291, 1939, 64912, -1119, -606, 988, 49262], para: [144179, 65536, 0, 2048, 3649] },
  'prophoto': { rXYZ: [52279, 18878, 0], gXYZ: [8858, 46653, 1], bXYZ: [2053, 5, 54060], chad: [65533, -2, -2, -3, 65539, -1, -1, 1, 65519], para: [117965, 65536, 0, 4096, 2048] },
};

/** Primaries and white (x, y) of guide §2.1, for the analytic check. */
export const OUTPUT_PRIMARIES: Record<OutputSpaceId, { rgb: [[number, number], [number, number], [number, number]]; white: [number, number] }> = {
  'srgb': { rgb: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]], white: [0.3127, 0.329] },
  'display-p3': { rgb: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]], white: [0.3127, 0.329] },
  'rec2020': { rgb: [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]], white: [0.3127, 0.329] },
  'adobe-rgb': { rgb: [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]], white: [0.3127, 0.329] },
  'prophoto': { rgb: [[0.7347, 0.2653], [0.1596, 0.8404], [0.0366, 0.0001]], white: [0.3457, 0.3585] },
};

/** Linear RGB → XYZ matrix from primaries and white chromaticities (Y of white = 1). */
export function rgbToXYZFromPrimaries(p: { rgb: [[number, number], [number, number], [number, number]]; white: [number, number] }): Mat3 {
  const xyz = ([x, y]: [number, number]): Vec3 => [x / y, 1, (1 - x - y) / y];
  const P = cols(xyz(p.rgb[0]), xyz(p.rgb[1]), xyz(p.rgb[2]));
  const S = mulMV(inv3(P), xyz(p.white));
  return P.map((row) => [row[0] * S[0], row[1] * S[1], row[2] * S[2]]) as Mat3;
}

export interface OutputSpaceDef {
  id: OutputSpaceId;
  /** Linear RGB → XYZ relative to `white` (colorants un-adapted with chad⁻¹). */
  toXYZ: Mat3;
  fromXYZ: Mat3;
  /** The space's white: toXYZ · (1, 1, 1). */
  white: Vec3;
  curve: ParametricCurve;
  /** Encoded value of a linear one, and back (the profile's TRC). */
  encode(v: number): number;
  decode(v: number): number;
}

function makeSpace(id: OutputSpaceId): OutputSpaceDef {
  const r = ICC_V4_RAW[id];
  const chadInv = inv3(m3(S15(r.chad)));
  const toXYZ = mulMM(chadInv, cols(S15(r.rXYZ), S15(r.gXYZ), S15(r.bXYZ)));
  const [g, a, b, c, d] = S15(r.para) as [number, number, number, number, number];
  const curve: ParametricCurve = { type: 3, g, a, b, c, d };
  return {
    id, toXYZ, fromXYZ: inv3(toXYZ), white: mulMV(toXYZ, [1, 1, 1]), curve,
    encode: (v) => encodeCurve(curve, v), decode: (v) => decodeCurve(curve, v),
  };
}

const SPACES = new Map<OutputSpaceId, OutputSpaceDef>();
/** One of the five output spaces (memoised). Unknown ids fall back to sRGB. */
export function outputSpace(id: string): OutputSpaceDef {
  const k = (OUTPUT_SPACE_IDS as readonly string[]).includes(id) ? (id as OutputSpaceId) : 'srgb';
  let s = SPACES.get(k);
  if (!s) SPACES.set(k, (s = makeSpace(k)));
  return s;
}
