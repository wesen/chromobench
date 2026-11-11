// Gamut knee and output compression (§2.7, spektrafilm utils/gamut_compression.py).
// The knee is the LAST colour operation before encoding: a gain after it leaves the cube again.
// Two perceptual knees (guide §5.4): 'oklch' (OkLCh with spektrafilm's knee parameters; the contract
// default) and 'cam16-ucs' (CHB-011: CIECAM16-UCS, Li et al. 2017, with spektrafilm's viewing
// conditions). Both normalise chroma by the largest in-gamut chroma C_max(L, h) of the output space,
// found per pixel by bisection (exact; no table), apply the Reinhard knee and convert back; hue and
// lightness are kept. Lightness: a one-sided knee (print-as-seen, from paper white up to white) or a
// clip at white (scan-of-print, where paper white must stay display white; guide §5.4 "super-whites").
import { inv3, mulMM, mulMV, type Mat3, type Vec3 } from '../spectral/linalg.ts';
import { bradfordMatrix, outputSpace, XYZ_TO_SRGB, type OutputSpaceId } from './colour.ts';

/** Reinhard knee: identity below t, asymptotic to l. d' = t + s·n/(1 + n^p)^(1/p), n = (d − t)/s, s = l − t. */
export function knee(d: number, t: number, l: number, p: number): number {
  if (d <= t) return d;
  const s = l - t;
  const n = (d - t) / s;
  return t + (s * n) / (1 + n ** p) ** (1 / p);
}

// OKLab (Ottosson) from linear sRGB.
const M1: Mat3 = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]];
const M2: Mat3 = [[0.2104542553, 0.793617785, -0.0040720468], [1.9779984951, -2.428592205, 0.4505937099], [0.0259040371, 0.7827717662, -0.808675766]];
const M2I: Mat3 = [[1, 0.3963377774, 0.2158037573], [1, -0.1055613458, -0.0638541728], [1, -0.0894841775, -1.291485548]];
/** The exact inverse of M2 (the published M2⁻¹ above is rounded to 10 digits: round trips drift by 2e-7). */
const M2_INV: Mat3 = inv3(M2);
const M1I: Mat3 = [[4.0767416621, -3.3077115913, 0.2309699292], [-1.2684380046, 2.6097574011, -0.3413193965], [-0.0041960863, -0.7034186147, 1.707614701]];

export function rgbToOklab(rgb: ArrayLike<number>): Vec3 {
  const lms = mulMV(M1, rgb).map(Math.cbrt);
  return mulMV(M2, lms);
}
export function oklabToRgb(lab: ArrayLike<number>): Vec3 {
  const lms = mulMV(M2I, lab).map((v) => v * v * v);
  return mulMV(M1I, lms);
}

const inCube = (rgb: ArrayLike<number>, eps = 1e-9): boolean => rgb[0]! >= -eps && rgb[0]! <= 1 + eps && rgb[1]! >= -eps && rgb[1]! <= 1 + eps && rgb[2]! >= -eps && rgb[2]! <= 1 + eps;

// ---- perceptual models per output space ---------------------------------------------------------

/** A polar perceptual space over one output space's linear RGB. */
export interface Perceptual {
  kind: 'oklch' | 'cam16-ucs';
  /** Linear RGB → (lightness, a, b). */
  fwd(rgb: ArrayLike<number>): Vec3;
  /** (lightness, a, b) → linear RGB. */
  inv(lab: ArrayLike<number>): Vec3;
  /** Lightness of the space's white (1 for OkLab, ≈ 100 for CAM16-UCS J′). */
  white: number;
  /** Initial upper bound for the chroma bisection. */
  cHi: number;
}

/**
 * OkLab over a space's linear RGB: LMS = M1s·rgb with M1s = M1·XYZ_TO_SRGB·toXYZ(space), rows
 * normalised so the space's white is neutral (L = 1, a = b = 0). For sRGB this is Ottosson's M1 to 1e-4.
 */
export function oklabFor(space: OutputSpaceId): { M1s: Mat3; M1sInv: Mat3 } {
  const S = outputSpace(space);
  const raw = mulMM(M1, mulMM(XYZ_TO_SRGB, S.toXYZ));
  const M1s = raw.map((r) => { const s = r[0] + r[1] + r[2]; return [r[0] / s, r[1] / s, r[2] / s]; }) as Mat3;
  return { M1s, M1sInv: inv3(M1s) };
}

// CAM16 (Li et al. 2017) with spektrafilm's fixed viewing conditions (gamut_compression.py
// _CAM16UCS_L_A, _CAM16UCS_Y_B; Average surround). spektrafilm passes XYZ and XYZ_w at Y = 1 to
// colour-science's XYZ_to_CAM16UCS, which scales both by 100 (domain-range "reference"), so the model
// runs with Y_w = 100 and n = Y_b / Y_w = 0.2; perceptual() does the same.
// One deliberate difference: perceptual() discounts the illuminant (D = 1). With spektrafilm's
// D(L_A = 64) = 0.912 the output white sits at a′, b′ = (−1.33, −0.76), off the neutral axis, so the
// chroma knee (never the identity with t = 0) would tint whites and greys, and scan-of-print could not
// keep paper white at display white. A display viewer is adapted to the display white: D = 1.
export const CAM16_VIEWING: { L_A: number; Y_b: number; F: number; c: number; N_c: number; D?: number } = { L_A: 64, Y_b: 20, F: 1, c: 0.69, N_c: 1, D: 1 };
const M16: Mat3 = [[0.401288, 0.650173, -0.051461], [-0.250268, 1.204414, 0.045854], [-0.002079, 0.048952, 0.953127]];
const M16I: Mat3 = inv3(M16);

export interface Cam16 {
  /** XYZ (same scale as the white) → J, M, h (degrees). */
  fwd(XYZ: ArrayLike<number>): Vec3;
  /** J, M, h (degrees) → XYZ. */
  inv(JMh: ArrayLike<number>): Vec3;
}

/** CAM16 for an adapting white; `vc.D` overrides the degree of adaptation (default: from F and L_A). */
export function cam16(XYZ_w: ArrayLike<number>, vc: { L_A: number; Y_b: number; F: number; c: number; N_c: number; D?: number } = CAM16_VIEWING): Cam16 {
  const { L_A, Y_b, F, c, N_c } = vc;
  const Y_w = XYZ_w[1]!;
  const k = 1 / (5 * L_A + 1);
  const k4 = k ** 4;
  const F_L = 0.2 * k4 * (5 * L_A) + 0.1 * (1 - k4) ** 2 * Math.cbrt(5 * L_A);
  const n = Y_b / Y_w;
  const z = 1.48 + Math.sqrt(n);
  const N_bb = 0.725 * (1 / n) ** 0.2;
  const N_cb = N_bb;
  const D = vc.D ?? Math.min(1, Math.max(0, F * (1 - (1 / 3.6) * Math.exp((-L_A - 42) / 92))));
  const RGB_w = mulMV(M16, XYZ_w);
  const D_RGB = RGB_w.map((v) => (D * Y_w) / v + 1 - D) as Vec3;
  const post = (x: number): number => {
    const y = (F_L * Math.abs(x) / 100) ** 0.42;
    return (400 * Math.sign(x) * y) / (27.13 + y) + 0.1;
  };
  const postInv = (x: number): number => {
    const a = Math.abs(x - 0.1);
    return Math.sign(x - 0.1) * (100 / F_L) * ((27.13 * a) / (400 - a)) ** (1 / 0.42);
  };
  const Ra_w = RGB_w.map((v, i) => post(D_RGB[i]! * v));
  const A_w = (2 * Ra_w[0]! + Ra_w[1]! + 0.05 * Ra_w[2]! - 0.305) * N_bb;
  const cz = c * z;
  const tk = (1.64 - 0.29 ** n) ** 0.73;
  return {
    fwd(XYZ) {
      const RGB = mulMV(M16, XYZ);
      const Ra = RGB.map((v, i) => post(D_RGB[i]! * v));
      const a = Ra[0]! - (12 * Ra[1]!) / 11 + Ra[2]! / 11;
      const b = (Ra[0]! + Ra[1]! - 2 * Ra[2]!) / 9;
      let h = (Math.atan2(b, a) * 180) / Math.PI;
      if (h < 0) h += 360;
      const et = 0.25 * (Math.cos((h * Math.PI) / 180 + 2) + 3.8);
      const A = (2 * Ra[0]! + Ra[1]! + 0.05 * Ra[2]! - 0.305) * N_bb;
      const J = 100 * Math.sign(A) * Math.abs(A / A_w) ** cz;
      const t = ((50000 / 13) * N_c * N_cb * et * Math.hypot(a, b)) / (Ra[0]! + Ra[1]! + (21 / 20) * Ra[2]!);
      const C = Math.abs(t) ** 0.9 * Math.sqrt(Math.abs(J) / 100) * tk;
      return [J, C * F_L ** 0.25, h];
    },
    inv(JMh) {
      const [J, M, h] = [JMh[0]!, JMh[1]!, JMh[2]!];
      const C = M / F_L ** 0.25;
      const hr = (h * Math.PI) / 180;
      const t = J === 0 ? 0 : (C / (Math.sqrt(Math.abs(J) / 100) * tk)) ** (1 / 0.9);
      const et = 0.25 * (Math.cos(hr + 2) + 3.8);
      const A = A_w * Math.abs(J / 100) ** (1 / cz);
      const p2 = A / N_bb + 0.305;
      const p3 = 21 / 20;
      let a = 0;
      let b = 0;
      if (t !== 0) {
        const p1 = ((50000 / 13) * N_c * N_cb * et) / t;
        const sh = Math.sin(hr);
        const ch = Math.cos(hr);
        if (Math.abs(sh) >= Math.abs(ch)) {
          b = (p2 * (2 + p3) * (460 / 1403)) / (p1 / sh + (2 + p3) * (220 / 1403) * (ch / sh) - 27 / 1403 + p3 * (6300 / 1403));
          a = (b * ch) / sh;
        } else {
          a = (p2 * (2 + p3) * (460 / 1403)) / (p1 / ch + (2 + p3) * (220 / 1403) - (27 / 1403 - p3 * (6300 / 1403)) * (sh / ch));
          b = (a * sh) / ch;
        }
      }
      const Ra = [(460 * p2 + 451 * a + 288 * b) / 1403, (460 * p2 - 891 * a - 261 * b) / 1403, (460 * p2 - 220 * a - 6300 * b) / 1403];
      const RGB = Ra.map((v, i) => postInv(v) / D_RGB[i]!);
      return mulMV(M16I, RGB);
    },
  };
}

/** CAM16-UCS (Li et al. 2017, c1 = 0.007, c2 = 0.0228): J, M, h ↔ J′, a′, b′. */
export function jmhToUcs(jmh: ArrayLike<number>): Vec3 {
  const [J, M, h] = [jmh[0]!, jmh[1]!, jmh[2]!];
  const Jp = (1.7 * J) / (1 + 0.007 * J);
  const Mp = Math.log(1 + 0.0228 * M) / 0.0228;
  const hr = (h * Math.PI) / 180;
  return [Jp, Mp * Math.cos(hr), Mp * Math.sin(hr)];
}
export function ucsToJmh(ucs: ArrayLike<number>): Vec3 {
  const Jp = ucs[0]!;
  const J = Jp / (1.7 - 0.007 * Jp);
  const Mp = Math.hypot(ucs[1]!, ucs[2]!);
  const M = (Math.exp(0.0228 * Mp) - 1) / 0.0228;
  let h = (Math.atan2(ucs[2]!, ucs[1]!) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [J, M, h];
}

const PERCEPTUAL = new Map<string, Perceptual>();
/** The perceptual model of `kind` over `space`'s linear RGB (memoised). */
export function perceptual(kind: 'oklch' | 'cam16-ucs', space: OutputSpaceId = 'srgb'): Perceptual {
  const key = `${kind}:${space}`;
  let p = PERCEPTUAL.get(key);
  if (p) return p;
  if (kind === 'oklch') {
    const { M1s, M1sInv } = oklabFor(space);
    p = {
      kind, white: 1, cHi: 0.5,
      fwd: (rgb) => mulMV(M2, mulMV(M1s, rgb).map(Math.cbrt)),
      inv: (lab) => mulMV(M1sInv, mulMV(M2_INV, lab).map((v) => v * v * v)),
    };
  } else {
    const S = outputSpace(space);
    const cam = cam16(S.white.map((v) => 100 * v));
    const toXYZ100 = mulMM([[100, 0, 0], [0, 100, 0], [0, 0, 100]], S.toXYZ);
    const fromXYZ100 = inv3(toXYZ100);
    const toUcs = (rgb: ArrayLike<number>): Vec3 => jmhToUcs(cam.fwd(mulMV(toXYZ100, rgb)));
    p = {
      kind, white: toUcs([1, 1, 1])[0], cHi: 150,
      fwd: toUcs,
      inv: (ucs) => mulMV(fromXYZ100, cam.inv(ucsToJmh(ucs))),
    };
  }
  PERCEPTUAL.set(key, p);
  return p;
}

/** Largest in-gamut chroma at lightness L and hue angle h (radians) of a perceptual model, by bisection. */
export function maxChromaOf(P: Perceptual, L: number, h: number, iterations = 40): number {
  const ca = Math.cos(h);
  const sa = Math.sin(h);
  const ok = (C: number): boolean => { const rgb = P.inv([L, C * ca, C * sa]); return Number.isFinite(rgb[0]) && Number.isFinite(rgb[1]) && Number.isFinite(rgb[2]) && inCube(rgb); };
  let lo = 0;
  let hi = P.cHi;
  for (let i = 0; i < 8 && ok(hi); i++) { lo = hi; hi *= 2; }
  for (let i = 0; i < iterations; i++) {
    const m = (lo + hi) / 2;
    if (ok(m)) lo = m;
    else hi = m;
  }
  return lo;
}

export interface CompressSpec {
  algorithm: 'oklch' | 'cam16-ucs' | 'clip' | 'tanh-shoulder';
  /** Chroma knee (t, ℓ, p) on C / C_max. */
  chroma: [number, number, number];
  /**
   * One-sided lightness knee (t, ℓ, p), normalised to the space's white lightness; null clips
   * lightness at white (scan-of-print: paper white is display white and must stay it).
   */
  lightness: [number, number, number] | null;
  /** Output space whose linear RGB is compressed (default sRGB). */
  space?: OutputSpaceId;
  /** tanh shoulder start (default 0.82, Chromogen's). */
  shoulder?: number;
}
export const DEFAULT_COMPRESS: CompressSpec = { algorithm: 'oklch', chroma: [0, 1, 6], lightness: [0.7, 1, 2.2] };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Chromogen's per-channel shoulder above s (shifts hue; kept for comparison with the Studio). */
export const tanhShoulder = (v: number, s = 0.82): number => clamp01(v <= s ? v : s + (1 - s) * Math.tanh((v - s) / (1 - s)));

/** Linear RGB of `spec.space` → linear RGB inside [0, 1]³. */
export function compressOutput(rgbLin: ArrayLike<number>, spec: CompressSpec = DEFAULT_COMPRESS): Vec3 {
  const rgb: Vec3 = [rgbLin[0]!, rgbLin[1]!, rgbLin[2]!];
  if (spec.algorithm === 'clip') return rgb.map(clamp01) as Vec3;
  if (spec.algorithm === 'tanh-shoulder') return rgb.map((v) => tanhShoulder(v, spec.shoulder)) as Vec3;
  const P = perceptual(spec.algorithm, spec.space ?? 'srgb');
  const [L0, a, b] = P.fwd(rgb);
  if (!Number.isFinite(L0) || L0 <= 0) return [0, 0, 0];
  const Lw = P.white;
  const L = spec.lightness ? Math.min(Lw * knee(L0 / Lw, spec.lightness[0], spec.lightness[1], spec.lightness[2]), Lw) : Math.min(L0, Lw);
  if (L >= Lw) return [1, 1, 1];
  const C = Math.hypot(a, b);
  const h = Math.atan2(b, a);
  const Cmax = maxChromaOf(P, L, h);
  const Cn = Cmax > 0 ? Cmax * knee(C / Cmax, spec.chroma[0], spec.chroma[1], spec.chroma[2]) : 0;
  const out = P.inv([L, Cn * Math.cos(h), Cn * Math.sin(h)]);
  // Bisection leaves |overshoot| ≤ 1e-9; the clamp only removes round-off, it is not a gain.
  return out.map(clamp01) as Vec3;
}

// ---- output.display (CHB-011, guide §5.2): rendering → space → knee → encode ---------------------

export type Rendering = 'print-as-seen' | 'scan-of-print';
export type KneeName = 'oklch' | 'cam16-ucs' | 'tanh-shoulder' | 'clip';

/** Everything output.display needs per pixel; built once per node. */
export interface DisplaySetup {
  space: OutputSpaceId;
  /** fromXYZ(space) · Bradford(source white → space white): print XYZ → linear RGB before the knee. */
  M: Mat3;
  compress: CompressSpec;
  /** The source white of the rendering's Bradford adaptation. */
  sourceWhite: Vec3;
}

/** spektrafilm's one-sided lightness knee shape (threshold set per rendering, limit white, p 2.2). */
export const LIGHTNESS_POWER = 2.2;

/**
 * The two renderings (guide §2.5) as one Bradford adaptation with different source whites:
 * print-as-seen adapts from the white of print-xyz (a perfect diffuser → display white; paper white
 * keeps its level and tint) and compresses lightness above the paper white; scan-of-print adapts from
 * the paper white (→ exactly display white, brightened and neutralised) and clips at white.
 * `white` is the white print-xyz is relative to; `paperWhite` the paper's white in the same frame
 * (no flare).
 */
export function displaySetup(o: { rendering: Rendering; white: ArrayLike<number>; paperWhite: ArrayLike<number>; space: OutputSpaceId; knee: KneeName; chroma?: [number, number, number] }): DisplaySetup {
  const S = outputSpace(o.space);
  const src: Vec3 = o.rendering === 'scan-of-print' ? [o.paperWhite[0]!, o.paperWhite[1]!, o.paperWhite[2]!] : [o.white[0]!, o.white[1]!, o.white[2]!];
  const M = mulMM(S.fromXYZ, bradfordMatrix(src, S.white));
  let lightness: [number, number, number] | null = null;
  if (o.rendering === 'print-as-seen' && (o.knee === 'oklch' || o.knee === 'cam16-ucs')) {
    const P = perceptual(o.knee, o.space);
    const t = P.fwd(mulMV(M, o.paperWhite))[0] / P.white;
    lightness = [Math.min(Math.max(t, 0), 1), 1, LIGHTNESS_POWER];
  }
  return { space: o.space, M, sourceWhite: src, compress: { algorithm: o.knee, chroma: o.chroma ?? [0, 1, 6], lightness, space: o.space } };
}

/** Linear output RGB of a print XYZ, after the knee (in [0, 1]³). */
export const displayLinear = (XYZ: ArrayLike<number>, s: DisplaySetup): Vec3 => compressOutput(mulMV(s.M, XYZ), s.compress);

/** Encoded output RGB of a print XYZ: the knee is the last colour step, only the TRC follows. */
export function displayPixel(XYZ: ArrayLike<number>, s: DisplaySetup): Vec3 {
  const S = outputSpace(s.space);
  return displayLinear(XYZ, s).map((v) => S.encode(v)) as Vec3;
}
