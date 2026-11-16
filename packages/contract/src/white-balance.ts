// White balance before the film (contract 1.6, CHB-048, decision D2): the one definition every engine, the studio and
// the agents use.
//
// A camera file's white balance is the white of the light the scene was lit by, as a temperature (K) and a tint, in
// Lightroom's units (Adobe's: Robertson's isotemperature lines in CIE 1960 uv, the tint the offset along the line ×
// −3000, positive towards magenta correction), so a number the photographer knows from Lightroom ("5150 K, +8") is the
// same white here. It is applied in scene light, between the camera's colour matrix and the scene stage (source.xyz),
// so the film is exposed to a white-balanced scene: a white-point adaptation from that white to D65, the scene's
// working white, which capture.expose then adapts to the film's reference white with the same transform.
//
// The adaptation is CAT16 (CIE 248:2022, the CAM16 cone space) with complete adaptation (D = 1) in XYZ:
//   A(W → D65) = M16⁻¹ · diag(M16·D65 / M16·W) · M16
// Why CAT16 in XYZ and not camera-RGB multipliers or Bradford:
//   - one transform for every camera (and for files without a camera matrix): the same temperature and tint is the
//     same correction on any camera, and a picked neutral's white carries from frame to frame;
//   - it is the transform the film's reference adaptation already uses (capture.expose, core film/expose.ts), so the
//     white balance and the film's adaptation are von Kries scalings in one cone space and compose exactly: a grey
//     lit by a light and white-balanced to it exposes the film exactly like a grey under D65 (the "matching
//     filtration" law), and changes of white compose (A(b → a)·A(c → b) = A(c → a));
//   - camera-RGB multipliers depend on the sensor's own sensitivities (exact only for the camera's channels, with no
//     meaning for a TIFF or PNG); Bradford is CAT02's predecessor, CAT16 is the CIE's current recommendation.
//
// "As shot" is the raw's own white (its AsShotNeutral or the camera's as-shot multipliers), written into the document as
// a temperature and a tint when the frame is opened; the conversion is exact both ways (whiteToTemperature is the
// closed-form inverse of temperatureToWhite), so the as-shot temperature and tint reproduce the camera's white to
// 1e-12. "None" is D65 itself: the scene as the camera measured it, which a daylight film sees uncorrected.
import type { CameraColour } from './source.ts';
import type { Vec3 } from './spec.ts';

type Mat3 = [Vec3, Vec3, Vec3];

/** D65 in XYZ (Y = 1): the scene stage's working white (core's colour constant). */
export const D65_XYZ: Readonly<Vec3> = Object.freeze([0.95047, 1, 1.08883]) as Readonly<Vec3>;
/** The CAT16 cone matrix (Li et al. 2017; CIE 248:2022). */
export const CAT16_M: Readonly<Mat3> = Object.freeze([[0.401288, 0.650173, -0.051461], [-0.250268, 1.204414, 0.045854], [-0.002079, 0.048952, 0.953127]]) as Readonly<Mat3>;
/** Linear sRGB / Rec. 709 → XYZ (D65): the camera matrix of a file without one (TIFF, PNG, synthetic sources). */
export const SRGB_TO_XYZ_M: Readonly<Mat3> = Object.freeze([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]]) as Readonly<Mat3>;

// ---- 3 × 3 arithmetic (core's spectral/linalg.ts, operation for operation) -------------------------------------

const mulMV = (A: Readonly<Mat3>, x: ArrayLike<number>): Vec3 => [
  A[0][0] * x[0]! + A[0][1] * x[1]! + A[0][2] * x[2]!,
  A[1][0] * x[0]! + A[1][1] * x[1]! + A[1][2] * x[2]!,
  A[2][0] * x[0]! + A[2][1] * x[1]! + A[2][2] * x[2]!,
];
const mulMM = (A: Readonly<Mat3>, B: Readonly<Mat3>): Mat3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => A[i]![0] * B[0][j]! + A[i]![1] * B[1][j]! + A[i]![2] * B[2][j]!)) as Mat3;
function inv3(A: Readonly<Mat3>): Mat3 {
  const d = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  if (!(Math.abs(d) > 1e-300)) throw new Error('white balance: a singular 3×3 matrix');
  const c = (i: number, j: number): number => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const s = [0, 1, 2].filter((x) => x !== j);
    return A[r[0]!]![s[0]!]! * A[r[1]!]![s[1]!]! - A[r[0]!]![s[1]!]! * A[r[1]!]![s[0]!]!;
  };
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (((i + j) % 2 ? -1 : 1) * c(j, i)) / d)) as Mat3;
}
const CAT16_INV = inv3(CAT16_M);

/** XYZ (Y = 1) of a chromaticity. */
export const xyToXYZ = (x: number, y: number): Vec3 => [x / y, 1, (1 - x - y) / y];
/** The chromaticity of an XYZ colour. */
export function xyOf(XYZ: ArrayLike<number>): [number, number] {
  const s = XYZ[0]! + XYZ[1]! + XYZ[2]!;
  return [XYZ[0]! / s, XYZ[1]! / s];
}

/**
 * The CAT16 white-point adaptation (complete, D = 1) from white `from` to white `to` (XYZ): the 3 × 3 matrix that takes
 * a colour seen under `from` to the colour that looks the same under `to`. A von Kries scaling in the CAT16 cone
 * space, so cat16(b, c)·cat16(a, b) = cat16(a, c) and cat16(w, w) = I.
 */
export function cat16(from: ArrayLike<number>, to: ArrayLike<number>): Mat3 {
  const s = mulMV(CAT16_M, from);
  const d = mulMV(CAT16_M, to);
  const D: Mat3 = [[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]];
  return mulMM(CAT16_INV, mulMM(D, CAT16_M));
}

// ---- temperature and tint (Lightroom's units) ---------------------------------------------------------------------

/**
 * Robertson's isotemperature lines (Robertson 1968; Wyszecki & Stiles table 1(3.11)): reciprocal temperature in mired,
 * the Planckian point (u, v) in CIE 1960 UCS, and the slope of the line through it. Two entries known by typos
 * elsewhere are as Robertson and Adobe's DNG SDK have them (20 mired: slope −0.26876; 325 mired: u 0.24792); the table's
 * second differences are smooth (a test checks it).
 */
const ROBERTSON: readonly (readonly [number, number, number, number])[] = [
  [0, 0.18006, 0.26352, -0.24341], [10, 0.18066, 0.26589, -0.25479], [20, 0.18133, 0.26846, -0.26876],
  [30, 0.18208, 0.27119, -0.28539], [40, 0.18293, 0.27407, -0.3047], [50, 0.18388, 0.27709, -0.32675],
  [60, 0.18494, 0.28021, -0.35156], [70, 0.18611, 0.28342, -0.37915], [80, 0.1874, 0.28668, -0.40955],
  [90, 0.1888, 0.28997, -0.44278], [100, 0.19032, 0.29326, -0.47888], [125, 0.19462, 0.30141, -0.58204],
  [150, 0.19962, 0.30921, -0.70471], [175, 0.20525, 0.31647, -0.84901], [200, 0.21142, 0.32312, -1.0182],
  [225, 0.21807, 0.32909, -1.2168], [250, 0.22511, 0.33439, -1.4512], [275, 0.23247, 0.33904, -1.7298],
  [300, 0.2401, 0.34308, -2.0637], [325, 0.24792, 0.34655, -2.4681], [350, 0.25591, 0.34951, -2.9641],
  [375, 0.264, 0.352, -3.5814], [400, 0.27218, 0.35407, -4.3633], [425, 0.28039, 0.35577, -5.3762],
  [450, 0.28863, 0.35714, -6.7262], [475, 0.29685, 0.35823, -8.5955], [500, 0.30505, 0.35907, -11.324],
  [525, 0.3132, 0.35968, -15.628], [550, 0.32129, 0.36011, -23.325], [575, 0.32931, 0.36038, -40.77],
  [600, 0.33724, 0.36051, -116.45],
];
/** The isotemperature lines' table, for tests (mired, u, v, slope). */
export const ROBERTSON_LINES = ROBERTSON;
/** uv offset along an isotemperature line per unit of tint (Adobe's kTintScale: tint = offset × −3000). */
const TINT_SCALE = -3000;

/** The ranges of the white balance controls: Lightroom's for raw files. */
export const TEMPERATURE_RANGE: readonly [number, number] = [2000, 50000];
export const TINT_RANGE: readonly [number, number] = [-150, 150];

/** The unit direction of line i (along +u). */
const dirOf = (i: number): [number, number] => {
  const t = ROBERTSON[i]![3];
  const len = Math.sqrt(1 + t * t);
  return [1 / len, t / len];
};

/** The segment [i, i + 1] of the table holding mired r (the last one beyond the table, as Adobe extrapolates). */
function segmentOf(r: number): number {
  for (let i = 0; i < ROBERTSON.length - 2; i++) if (r < ROBERTSON[i + 1]![0]) return i;
  return ROBERTSON.length - 2;
}

/** A point of the uv plane at mired r, offset o along the interpolated isotemperature line (Adobe's Get_xy_coord). */
function uvAt(r: number, o: number): [number, number] {
  const i = segmentOf(r);
  const a = ROBERTSON[i]!, b = ROBERTSON[i + 1]!;
  const f = (b[0] - r) / (b[0] - a[0]);
  const [du1, dv1] = dirOf(i), [du2, dv2] = dirOf(i + 1);
  let du = du1 * f + du2 * (1 - f), dv = dv1 * f + dv2 * (1 - f);
  const len = Math.sqrt(du * du + dv * dv);
  du /= len;
  dv /= len;
  return [a[1] * f + b[1] * (1 - f) + du * o, a[2] * f + b[2] * (1 - f) + dv * o];
}

/** The chromaticity (x, y) of the white of a temperature (K) and a tint, in Lightroom's units. */
export function temperatureToWhite(temperature_K: number, tint: number): [number, number] {
  const [u, v] = uvAt(1e6 / temperature_K, tint / TINT_SCALE);
  const d = u - 4 * v + 2;
  return [(1.5 * u) / d, v / d];
}

/**
 * The temperature (K) and tint of a chromaticity: the exact inverse of temperatureToWhite. On a segment between two
 * isotemperature lines the Planckian point and the line's direction are linear in s (s = 0 at line i, 1 at line i + 1),
 * so the point lies on the interpolated line where cross(P − bb(s), d(s)) = 0, a quadratic in s; the offset along the
 * line is then the projection. Not clamped (whiteBalanceOf clamps to the controls' ranges).
 */
export function whiteToTemperature(x: number, y: number): { temperature_K: number; tint: number } {
  const den = 1.5 - x + 6 * y;
  const P: [number, number] = [(2 * x) / den, (3 * y) / den];
  const cross = (a: readonly number[], b: readonly number[]): number => a[0]! * b[1]! - a[1]! * b[0]!;
  let best: { r: number; o: number; miss: number } | null = null;
  for (let i = 0; i < ROBERTSON.length - 1; i++) {
    const a = ROBERTSON[i]!, b = ROBERTSON[i + 1]!;
    const n0 = dirOf(i), n1 = dirOf(i + 1);
    const A = [P[0] - a[1], P[1] - a[2]];
    const db = [b[1] - a[1], b[2] - a[2]];
    const dn = [n1[0] - n0[0], n1[1] - n0[1]];
    // g(s) = A×n0 + s·(A×dn − db×n0) − s²·(db×dn)
    const c0 = cross(A, n0), c1 = cross(A, dn) - cross(db, n0), c2 = -cross(db, dn);
    const roots: number[] = [];
    if (Math.abs(c2) < 1e-14 * (Math.abs(c1) + Math.abs(c0) + 1e-300)) {
      if (c1 !== 0) roots.push(-c0 / c1);
    } else {
      const disc = c1 * c1 - 4 * c2 * c0;
      if (disc >= 0) {
        const q = -0.5 * (c1 + (c1 < 0 ? -1 : 1) * Math.sqrt(disc));
        if (q !== 0) roots.push(q / c2, c0 / q);
        else roots.push(0);
      }
    }
    const last = i === ROBERTSON.length - 2;
    for (const s of roots) {
      if (!Number.isFinite(s)) continue;
      // inside the segment (the first one also below 0 mired, the last one beyond 600 mired, as Adobe extrapolates)
      const miss = s < 0 ? (i === 0 ? 0 : -s) : s > 1 ? (last ? 0 : s - 1) : 0;
      // the offset along the interpolated line at s (uvAt's direction, f = 1 − s), by projection
      const f = 1 - s;
      let du = n0[0] * f + n1[0] * (1 - f), dv = n0[1] * f + n1[1] * (1 - f);
      const len = Math.sqrt(du * du + dv * dv);
      du /= len;
      dv /= len;
      const o = (P[0] - (a[1] * f + b[1] * (1 - f))) * du + (P[1] - (a[2] * f + b[2] * (1 - f))) * dv;
      // the root on the segment, nearest the Planckian locus (two lines meet far from it)
      if (!best || miss < best.miss || (miss === best.miss && Math.abs(o) < Math.abs(best.o))) best = { r: a[0] + s * (b[0] - a[0]), o, miss };
    }
  }
  if (!best) throw new Error(`white balance: no isotemperature line through (${x}, ${y})`);
  return { temperature_K: 1e6 / best.r, tint: best.o * TINT_SCALE };
}

// ---- the white balance of a document ------------------------------------------------------------------------------

/** A camera file's white balance (the scene medium's `whiteBalance`): the white of the scene light. */
export interface WhiteBalance {
  readonly temperature_K: number;
  readonly tint: number;
}

const clampTo = (v: number, r: readonly [number, number]): number => Math.min(r[1], Math.max(r[0], v));

/** The white balance of a white (any XYZ or chromaticity), clamped to the controls' ranges. */
export function whiteBalanceOf(XYZ: ArrayLike<number>): WhiteBalance {
  const [x, y] = xyOf(XYZ);
  const t = whiteToTemperature(x, y);
  return { temperature_K: clampTo(t.temperature_K, TEMPERATURE_RANGE), tint: clampTo(t.tint, TINT_RANGE) };
}

/** No correction: the white balance whose white is D65 (the scene as the camera measured it; a daylight film's view). */
export const NO_CORRECTION: Readonly<WhiteBalance> = Object.freeze(whiteBalanceOf(D65_XYZ));

/** The white (XYZ, Y = 1) of a white balance. */
export function whiteOf(wb: WhiteBalance): Vec3 {
  const [x, y] = temperatureToWhite(wb.temperature_K, wb.tint);
  return xyToXYZ(x, y);
}

/** The camera's matrix: camera-linear RGB → XYZ (linear sRGB for a source without one). */
export function cameraToXyz(cam: CameraColour | undefined): Mat3 {
  return cam?.camToXyz ? (cam.camToXyz.map((r) => [r[0]!, r[1]!, r[2]!]) as Mat3) : (SRGB_TO_XYZ_M.map((r) => [...r]) as Mat3);
}

/** The camera's as-shot white (XYZ, Y = 1), or null when the file records none. */
export function asShotWhite(cam: CameraColour | undefined): Vec3 | null {
  if (!cam?.asShotNeutral) return null;
  const W = mulMV(cameraToXyz(cam), cam.asShotNeutral);
  return [W[0] / W[1], 1, W[2] / W[1]];
}

/** "As shot": the raw's white as a temperature and a tint (null when the file records none). */
export function asShotWhiteBalance(cam: CameraColour | undefined): WhiteBalance | null {
  const W = asShotWhite(cam);
  return W ? whiteBalanceOf(W) : null;
}

/** The white-balance adaptation of the scene: CAT16 from the white balance's white to D65. */
export function whiteBalanceMatrix(wb: WhiteBalance): Mat3 {
  return cat16(whiteOf(wb), D65_XYZ);
}

/** source.xyz: camera-linear RGB → white-balanced scene XYZ (D65): the adaptation after the camera's matrix. */
export function sceneMatrix(cam: CameraColour | undefined, wb: WhiteBalance): Mat3 {
  return mulMM(whiteBalanceMatrix(wb), cameraToXyz(cam));
}

/**
 * The eyedropper: the white balance that makes a picked colour neutral. `sample` is the colour of the scene at the
 * point, white-balanced with `current` (the cut scene.input, XYZ under D65); the colour before any white balance is
 * cat16(D65 → white(current))·sample, and a von Kries adaptation from that colour to D65 makes it D65-neutral, so it is
 * the new white. Picking the same point again changes nothing (up to the controls' ranges, which clamp).
 */
export function pickedWhiteBalance(sample: ArrayLike<number>, current: WhiteBalance): WhiteBalance {
  const raw = mulMV(cat16(D65_XYZ, whiteOf(current)), sample);
  if (!(raw[0] > 0 && raw[1] > 0 && raw[2] > 0)) throw new Error('the picked point has no colour to balance (black or out of range)');
  return whiteBalanceOf(raw);
}

/**
 * Lightroom's white balance presets for raw files (temperature K, tint), and the two of chromobench: "As shot" (the
 * raw's white, per frame) and "None" (D65: no correction). The presets are labels for values; a white balance that is
 * none of them is "Custom".
 */
export const WHITE_BALANCE_PRESETS: readonly { id: string; label: string; wb: WhiteBalance | null }[] = [
  { id: 'as-shot', label: 'As shot', wb: null },
  { id: 'daylight', label: 'Daylight', wb: { temperature_K: 5500, tint: 10 } },
  { id: 'cloudy', label: 'Cloudy', wb: { temperature_K: 6500, tint: 10 } },
  { id: 'shade', label: 'Shade', wb: { temperature_K: 7500, tint: 10 } },
  { id: 'tungsten', label: 'Tungsten', wb: { temperature_K: 2850, tint: 0 } },
  { id: 'fluorescent', label: 'Fluorescent', wb: { temperature_K: 3800, tint: 21 } },
  { id: 'flash', label: 'Flash', wb: { temperature_K: 5500, tint: 0 } },
  { id: 'none', label: 'None (the film sees the light as it was)', wb: NO_CORRECTION },
];

/** Whether two white balances are the same as the controls show them (0.5 K, 0.05 tint). */
export function sameWhiteBalance(a: WhiteBalance, b: WhiteBalance): boolean {
  return Math.abs(a.temperature_K - b.temperature_K) < 0.5 && Math.abs(a.tint - b.tint) < 0.05;
}
