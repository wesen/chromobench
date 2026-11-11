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
const CAT16_INV: Mat3 = inv3(CAT16);

function vonKries(M: Mat3, Minv: Mat3, X: ArrayLike<number>, from: ArrayLike<number>, to: ArrayLike<number>): Vec3 {
  const s = mulMV(M, from);
  const d = mulMV(M, to);
  const c = mulMV(M, X);
  return mulMV(Minv, [c[0] * d[0] / s[0], c[1] * d[1] / s[1], c[2] * d[2] / s[2]]);
}
/** Bradford chromatic adaptation; maps `from` exactly onto `to`. */
export const adaptBradford = (X: ArrayLike<number>, from: ArrayLike<number>, to: ArrayLike<number> = D65): Vec3 => vonKries(BRADFORD, BRADFORD_INV, X, from, to);
/** CAT16 (complete adaptation), used by CHB-012. */
export const adaptCAT16 = (X: ArrayLike<number>, from: ArrayLike<number>, to: ArrayLike<number>): Vec3 => vonKries(CAT16, CAT16_INV, X, from, to);
/** The 3×3 matrix of a Bradford adaptation. */
export function bradfordMatrix(from: ArrayLike<number>, to: ArrayLike<number> = D65): Mat3 {
  const s = mulMV(BRADFORD, from);
  const d = mulMV(BRADFORD, to);
  const D: Mat3 = [[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]];
  return mulMM(BRADFORD_INV, mulMM(D, BRADFORD));
}

export const XYZ_TO_SRGB: Mat3 = [[3.2404542, -1.5371385, -0.4985314], [-0.969266, 1.8760108, 0.041556], [0.0556434, -0.2040259, 1.0572252]];
export const SRGB_TO_XYZ: Mat3 = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]];
export const P3_TO_XYZ: Mat3 = [[0.4865709, 0.2656677, 0.1982173], [0.2289746, 0.6917385, 0.0792869], [0, 0.0451134, 1.0439444]];
export const XYZ_TO_P3: Mat3 = inv3(P3_TO_XYZ);
export const REC2020_TO_XYZ: Mat3 = [[0.6369580, 0.1446169, 0.1688810], [0.2627002, 0.6779981, 0.0593017], [0, 0.0280727, 1.0609851]];
export const XYZ_TO_REC2020: Mat3 = inv3(REC2020_TO_XYZ);

export const encodeSRGB = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
export const decodeSRGB = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
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
