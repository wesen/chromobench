// The working encodings of the composite stages (contract encodings.ts, design §22), the f64 definition that
// packages/gpu lowers to the same matrices.
//
//   rgb   = R(W) · XYZ          R(W) = P⁻¹ · Bradford(W → P·1): linear Rec. 2020 (analytic primaries, D65); the
//                               stage's white W (D50 or D65, as view.adapt) lands on (1, 1, 1) exactly
//   oklab = M2 · ∛(M1s · rgb)   M1s = Ottosson's M1 · XYZ→sRGB · P with rows normalised (white: L = 1, a = b = 0),
//                               so a neutral of luminance Y has L = ∛Y: the cube root of a channel is its lightness
//
// Every conversion is one transform out = post · f(pre · v), f ∈ {identity, cube root, cube}: what composite.encode
// computes, and what the GPU's ENCODE op applies.
import { encodingOfDomain, fail, type Domain, type OpEncoding } from '@chromobench/contract';
import { bradfordMatrix, D50, D65, OUTPUT_PRIMARIES, rgbToXYZFromPrimaries, XYZ_TO_SRGB } from '../print/colour.ts';
import { M1, M2, M2_INV } from '../print/gamut.ts';
import { eye3, inv3, mulMM, mulMV, type Mat3, type Vec3 } from '../spectral/linalg.ts';

/** Linear Rec. 2020 → XYZ (analytic, white D65 at Y = 1). */
export const REC2020_TO_XYZ: Mat3 = rgbToXYZFromPrimaries(OUTPUT_PRIMARIES.rec2020);
const P_WHITE = mulMV(REC2020_TO_XYZ, [1, 1, 1]);

/** The stage's XYZ (white W) → working RGB. */
export function xyzToWorking(white: 'D50' | 'D65'): Mat3 {
  return mulMM(inv3(REC2020_TO_XYZ), bradfordMatrix(white === 'D50' ? D50 : D65, P_WHITE));
}

/** Working RGB → LMS of OkLab, rows normalised so (1, 1, 1) → (1, 1, 1). */
export const OK_M1: Mat3 = mulMM(M1, mulMM(XYZ_TO_SRGB, REC2020_TO_XYZ)).map((r) => {
  const s = r[0] + r[1] + r[2];
  return [r[0] / s, r[1] / s, r[2] / s];
}) as Mat3;
export const OK_M1_INV: Mat3 = inv3(OK_M1);
export { M2 as OK_M2, M2_INV as OK_M2_INV };

/** f of the transform: 0 identity, 1 cube root (into OkLab), 2 cube (out of OkLab). */
export type EncodeF = 0 | 1 | 2;
export interface EncodeTransform { pre: Mat3; f: EncodeF; post: Mat3 }

/** The transform between two encodings of one stage whose XYZ white is `white`. */
export function encodeTransform(from: OpEncoding, to: OpEncoding, white: 'D50' | 'D65'): EncodeTransform {
  const I = eye3();
  if (from === to) return { pre: I, f: 0, post: I };
  const R = xyzToWorking(white);
  const toRgb: Mat3 = from === 'stage' ? R : I; // stage or linear → rgb, before going on
  if (to === 'oklab') return { pre: mulMM(OK_M1, toRgb), f: 1, post: M2 };
  if (from === 'oklab') return { pre: M2_INV, f: 2, post: to === 'stage' ? mulMM(inv3(R), OK_M1_INV) : OK_M1_INV };
  return { pre: to === 'linear' ? R : inv3(R), f: 0, post: I };
}

/** The transform of composite.encode from a receiver of domain `from` to the domain `to` (one stage). */
export function encodeTransformOf(from: Domain, to: Domain, white: 'D50' | 'D65'): EncodeTransform {
  const a = encodingOfDomain(from), b = encodingOfDomain(to);
  if (!a || !b || a.stage !== b.stage) fail('E_DOMAIN', `composite.encode converts within one stage's encodings, not ${from} → ${to}`);
  return encodeTransform(a.encoding, b.encoding, white);
}

/** Applies a transform to one pixel (out may alias v). */
export function applyEncode(t: EncodeTransform, v: ArrayLike<number>, out: number[] | Float64Array = [0, 0, 0]): typeof out {
  const p = mulMV(t.pre, v);
  if (t.f === 1) for (let k = 0; k < 3; k++) p[k] = Math.cbrt(p[k]!);
  else if (t.f === 2) for (let k = 0; k < 3; k++) p[k] = p[k]! ** 3;
  const q = mulMV(t.post, p);
  out[0] = q[0]; out[1] = q[1]; out[2] = q[2];
  return out;
}

/** Working RGB → OkLab and back (white-independent: what blend modes and per-channel tools use inside an op). */
export const RGB_TO_OKLAB = encodeTransform('linear', 'oklab', 'D65');
export const OKLAB_TO_RGB = encodeTransform('oklab', 'linear', 'D65');
export const rgbToOklab = (v: ArrayLike<number>): Vec3 => applyEncode(RGB_TO_OKLAB, v) as Vec3;
export const oklabToRgb = (v: ArrayLike<number>): Vec3 => applyEncode(OKLAB_TO_RGB, v) as Vec3;
