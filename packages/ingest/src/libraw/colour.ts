// Camera RGB → XYZ for photo mode (guide §5.4, DR-6), following the DNG specification chapter 6
// ("Mapping Camera Color Space to CIE XYZ Space"): ColorMatrix1/2 interpolated linearly in 1/CCT of the
// white, found by iterating from AsShotNeutral; XYZtoCamera = AnalogBalance · CameraCalibration · CM.
// Without DNG tags, LibRaw's Adobe cam_xyz (XYZ → camera, D65) is inverted.
import type { DngColour } from '../decode/types.ts';

export type M3 = number[][];

export const mul3 = (a: M3, b: M3): M3 => a.map((r) => [0, 1, 2].map((j) => r[0]! * b[0]![j]! + r[1]! * b[1]![j]! + r[2]! * b[2]![j]!));
export const apply3 = (a: M3, v: number[]): number[] => a.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
export const diag3 = (v: number[]): M3 => [[v[0]!, 0, 0], [0, v[1]!, 0], [0, 0, v[2]!]];
export const I3: M3 = diag3([1, 1, 1]);
export const m3 = (flat: number[]): M3 => [flat.slice(0, 3), flat.slice(3, 6), flat.slice(6, 9)];

export function inv3(m: M3): M3 {
  const [a, b, c] = m[0]! as [number, number, number];
  const [d, e, f] = m[1]! as [number, number, number];
  const [g, h, i] = m[2]! as [number, number, number];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-300) throw new Error('singular 3×3 matrix');
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/** EXIF LightSource codes → correlated colour temperature (K), for the DNG interpolation. */
export const ILLUMINANT_CCT: Record<number, number> = {
  1: 5500, 2: 4150, 3: 2856, 4: 5500, 9: 5500, 10: 6500, 11: 7500, 12: 6400, 13: 5000, 14: 4150, 15: 3450,
  17: 2856, 18: 4874, 19: 6774, 20: 5503, 21: 6504, 22: 7504, 23: 5003, 24: 3200,
};

export const xyToXYZ = (x: number, y: number): number[] => [x / y, 1, (1 - x - y) / y];
export const XYZtoxy = (v: number[]): [number, number] => {
  const s = v[0]! + v[1]! + v[2]!;
  return [v[0]! / s, v[1]! / s];
};

/** CCT from xy (McCamy 1992; adequate for the 1/CCT interpolation weight). */
export function cctFromXy(x: number, y: number): number {
  const n = (x - 0.332) / (0.1858 - y);
  return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
}

export interface CameraToXyz { camToXyz: M3; whiteXy: [number, number]; cct: number; from: 'dng' | 'adobe' }

const D50: [number, number] = [0.3457, 0.3585];

/** The DNG chapter 6 mapping for the white given by AsShotNeutral (or AsShotWhiteXY, else D50). */
export function dngCameraToXyz(d: DngColour): CameraToXyz {
  if (!d.colorMatrix1) throw new Error('DNG without ColorMatrix1');
  const cm1 = m3(d.colorMatrix1);
  const cm2 = d.colorMatrix2 ? m3(d.colorMatrix2) : null;
  const cc1 = d.cameraCalibration1 ? m3(d.cameraCalibration1) : I3;
  const cc2 = d.cameraCalibration2 ? m3(d.cameraCalibration2) : I3;
  const ab = d.analogBalance ? diag3(d.analogBalance) : I3;
  const t1 = ILLUMINANT_CCT[d.calibrationIlluminant1 ?? 21] ?? 6504;
  const t2 = ILLUMINANT_CCT[d.calibrationIlluminant2 ?? 21] ?? 6504;
  const at = (cct: number): { cm: M3; cc: M3 } => {
    if (!cm2 || t1 === t2) return { cm: cm1, cc: cc1 };
    const [lo, hi, mlo, mhi, clo, chi] = t1 < t2 ? [t1, t2, cm1, cm2, cc1, cc2] : [t2, t1, cm2, cm1, cc2, cc1];
    const g = cct <= lo ? 1 : cct >= hi ? 0 : (1 / cct - 1 / hi) / (1 / lo - 1 / hi);
    const lerp = (a: M3, b: M3): M3 => a.map((r, i) => r.map((v, j) => g * v + (1 - g) * b[i]![j]!));
    return { cm: lerp(mlo, mhi), cc: lerp(clo, chi) };
  };
  let xy: [number, number] = d.asShotWhiteXY ?? D50;
  let cct = cctFromXy(...xy);
  if (d.asShotNeutral) {
    for (let it = 0; it < 20; it++) {
      const { cm, cc } = at(cct);
      const xyzToCam = mul3(ab, mul3(cc, cm));
      const next = XYZtoxy(apply3(inv3(xyzToCam), d.asShotNeutral));
      const done = Math.hypot(next[0] - xy[0], next[1] - xy[1]) < 1e-9;
      xy = next;
      cct = cctFromXy(...xy);
      if (done) break;
    }
  }
  const { cm, cc } = at(cct);
  let camToXyz = inv3(mul3(ab, mul3(cc, cm)));
  // Scale so the white (camera neutral) maps to Y = 1.
  const neutral = d.asShotNeutral ?? apply3(mul3(ab, mul3(cc, cm)), xyToXYZ(...xy));
  const Y = apply3(camToXyz, neutral)[1]!;
  camToXyz = camToXyz.map((r) => r.map((v) => v / Y));
  return { camToXyz, whiteXy: xy, cct, from: 'dng' };
}

/** LibRaw's cam_xyz (XYZ → camera, rows per camera channel, Adobe's D65 matrix) inverted. */
export function adobeCameraToXyz(camXyz: M3): CameraToXyz {
  const camToXyz = inv3(camXyz.slice(0, 3));
  const white = apply3(camToXyz, [1, 1, 1]);
  return { camToXyz: camToXyz.map((r) => r.map((v) => v / white[1]!)), whiteXy: XYZtoxy(white), cct: cctFromXy(...XYZtoxy(white)), from: 'adobe' };
}

/** Planar camera RGB → planar XYZ (f32, negative values kept). */
export function cameraPlanesToXyz(rgb: Float32Array[], M: M3): Float32Array[] {
  const n = rgb[0]!.length;
  const out = [0, 1, 2].map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const r = rgb[0]![i]!, g = rgb[1]![i]!, b = rgb[2]![i]!;
    for (let k = 0; k < 3; k++) out[k]![i] = M[k]![0]! * r + M[k]![1]! * g + M[k]![2]! * b;
  }
  return out;
}
