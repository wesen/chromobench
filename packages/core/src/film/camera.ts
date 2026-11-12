// Camera RGB → scene XYZ for digital RAW photos (CHB-012 guide §5.2 "Camera RGB to XYZ"; contract
// source.xyz, args from capture.whiteBalance). Input: CHB-006's photo mode, demosaiced,
// black-subtracted linear camera RGB scaled to the white level, no white balance applied; colour
// metadata in SourceInfo.camera (camToXyz normalised so the as-shot neutral has Y = 1).
//
//   'daylight'  the scene's light as the camera saw it (no adaptation): a real film camera; the film
//               records casts and the print's balance removes most of them (guide decision record).
//   'as-shot'   the as-shot neutral's XYZ is adapted (CAT16) to D65: a white-balanced picture.
//   'custom'    the white of a temperature/tint (CIE daylight locus ≥ 4000 K, Planckian below) → D65.
// Without camToXyz the camera values are taken as linear Rec.709/sRGB (TIFF, PNG, synthetic tests).
import type { CameraColour } from '@chromobench/contract';
import { D65, SRGB_TO_XYZ } from '../print/colour.ts';
import { mulMM, mulMV, type Mat3, type Vec3 } from '../spectral/linalg.ts';
import { cat16Matrix, xyToXYZ } from './expose.ts';

export type WhiteBalance = { mode: 'daylight' | 'as-shot' | 'custom'; temperature_K?: number | undefined; tint?: number | undefined };

/** xy of the CIE daylight locus (4000–25000 K) or the Planckian locus (Kim et al. 2002 cubic fit) below. */
export function whiteOfTemperature(T: number, tint = 0): [number, number] {
  let x: number, y: number;
  if (T >= 4000) {
    const t = Math.min(T, 25000);
    x = t <= 7000
      ? -4.607e9 / t ** 3 + 2.9678e6 / t ** 2 + 0.09911e3 / t + 0.244063
      : -2.0064e9 / t ** 3 + 1.9018e6 / t ** 2 + 0.24748e3 / t + 0.23704;
    y = -3 * x * x + 2.87 * x - 0.275;
  } else {
    const t = Math.max(T, 1667);
    x = -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991;
    y = t <= 2222 ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867;
  }
  if (tint !== 0) {
    // tint: green (−) … magenta (+), 150 units ≈ Δv' 0.02 in CIE 1976 u'v' (an approximation; no standard scale)
    const d = -2 * x + 12 * y + 3;
    const u = (4 * x) / d;
    let v = (9 * y) / d;
    v -= (tint / 150) * 0.02;
    const e = 6 * u - 16 * v + 12;
    x = (9 * u) / e;
    y = (4 * v) / e;
  }
  return [x, y];
}

/** The 3 × 3 matrix from camera-linear RGB to scene XYZ for a white balance. */
export function cameraMatrix(cam: CameraColour | undefined, wb: WhiteBalance): { M: Mat3; white: Vec3 } {
  const base: Mat3 = cam?.camToXyz ? (cam.camToXyz.map((r) => [r[0]!, r[1]!, r[2]!]) as Mat3) : SRGB_TO_XYZ;
  if (wb.mode === 'daylight') return { M: base, white: mulMV(base, cam?.asShotNeutral ?? [1, 1, 1]) };
  let W: Vec3;
  if (wb.mode === 'as-shot') {
    W = mulMV(base, cam?.asShotNeutral ?? [1, 1, 1]);
  } else {
    const [x, y] = whiteOfTemperature(wb.temperature_K ?? 5500, wb.tint ?? 0);
    W = xyToXYZ(x, y);
  }
  W = [W[0] / W[1], 1, W[2] / W[1]];
  return { M: mulMM(cat16Matrix(W, D65), base), white: D65 };
}

