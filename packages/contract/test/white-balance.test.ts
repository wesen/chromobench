// CHB-048 (LAY-1, D2): the white balance before the film, defined once (white-balance.ts). Laws: temperature and tint
// are an exact parameterisation of the white (Lightroom's units), the adaptation is one CAT16 von Kries scaling that
// is the identity at the as-shot white and at "None", changes of white compose, and the eyedropper makes the picked
// point neutral and is idempotent.
import { describe, expect, it } from 'vitest';
import {
  asShotWhite, asShotWhiteBalance, cat16, D65_XYZ, NO_CORRECTION, pickedWhiteBalance, ROBERTSON_LINES, sameWhiteBalance, sceneMatrix,
  temperatureToWhite, whiteBalanceMatrix, whiteBalanceOf, whiteOf, whiteToTemperature, xyOf, xyToXYZ, type CameraColour, type WhiteBalance,
} from '../src/index.ts';

type M3 = number[][];
const mul = (A: M3, B: M3): M3 => A.map((r) => [0, 1, 2].map((j) => r[0]! * B[0]![j]! + r[1]! * B[1]![j]! + r[2]! * B[2]![j]!));
const mv = (A: M3, x: number[]): number[] => A.map((r) => r[0]! * x[0]! + r[1]! * x[1]! + r[2]! * x[2]!);
const inv = (A: M3): M3 => {
  const [a, b, c] = A[0]!, [d, e, f] = A[1]!, [g, h, i] = A[2]!;
  const det = a! * (e! * i! - f! * h!) - b! * (d! * i! - f! * g!) + c! * (d! * h! - e! * g!);
  return [
    [(e! * i! - f! * h!) / det, -(b! * i! - c! * h!) / det, (b! * f! - c! * e!) / det],
    [-(d! * i! - f! * g!) / det, (a! * i! - c! * g!) / det, -(a! * f! - c! * d!) / det],
    [(d! * h! - e! * g!) / det, -(a! * h! - b! * g!) / det, (a! * e! - b! * d!) / det],
  ];
};
const maxDiff = (A: M3, B: M3): number => Math.max(...A.flatMap((r, i) => r.map((v, j) => Math.abs(v - B[i]![j]!))));
const I3: M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** A camera-like matrix (camera RGB → XYZ) and an as-shot neutral under a warm light. */
const CAM: CameraColour = { make: 'Synthetic', model: 'CHB-048', camToXyz: [[0.62, 0.22, 0.11], [0.27, 0.88, -0.15], [0.03, -0.12, 1.18]], asShotNeutral: [1.31, 1, 0.71] };

describe('temperature and tint: an exact parameterisation of the white (Lightroom\'s units)', () => {
  it('Robertson\'s table is smooth: the slope accelerates, u and v change gradually, the two known typos are absent', () => {
    for (let i = 1; i + 1 < ROBERTSON_LINES.length; i++) {
      const [r0, r1, r2] = [ROBERTSON_LINES[i - 1]!, ROBERTSON_LINES[i]!, ROBERTSON_LINES[i + 1]!];
      if (r1[0] - r0[0] !== r2[0] - r1[0]) continue; // the step changes at 100 mired
      // the slope column is convex (each step steeper than the last): a copy with −0.27119 at 20 mired is not
      expect((r2[3] - r1[3]) / (r1[3] - r0[3]), `slope at ${r1[0]} mired`).toBeGreaterThan(1);
      for (const k of [1, 2] as const) {
        const q = (r2[k] - r1[k]) / (r1[k] - r0[k]);
        expect(q, `column ${k} at ${r1[0]} mired`).toBeGreaterThan(0.4);
        expect(q, `column ${k} at ${r1[0]} mired`).toBeLessThan(1.25);
      }
    }
    // u at 325 mired sits between its neighbours (a copy with 0.24702 is 1e-3 off)
    const u = (r: number): number => ROBERTSON_LINES.find((l) => l[0] === r)![1];
    expect(Math.abs(u(325) - (u(300) + u(350)) / 2)).toBeLessThan(3e-4);
  });

  it('round trip: temperature, tint → white → temperature, tint is exact (1e-9 K, 1e-9 tint) over the controls\' ranges', () => {
    let worst = 0;
    for (let T = 2000; T <= 50000; T *= 1.07) {
      for (let tint = -150; tint <= 150; tint += 12.5) {
        const [x, y] = temperatureToWhite(T, tint);
        const b = whiteToTemperature(x, y);
        worst = Math.max(worst, Math.abs(b.temperature_K - T) / T, Math.abs(b.tint - tint) / 150);
        const [x2, y2] = temperatureToWhite(b.temperature_K, b.tint);
        expect(Math.abs(x2 - x) + Math.abs(y2 - y)).toBeLessThan(1e-13);
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('anchors: D55 is Lightroom\'s Daylight (5500 K, +10), illuminant A its Tungsten (2856 K, 0); + tint is a greener light', () => {
    const d55 = whiteToTemperature(0.33242, 0.34743);
    expect(Math.abs(d55.temperature_K - 5500)).toBeLessThan(5);
    expect(Math.abs(d55.tint - 10)).toBeLessThan(0.2);
    const a = whiteToTemperature(0.44757, 0.40745);
    expect(Math.abs(a.temperature_K - 2856)).toBeLessThan(2);
    expect(Math.abs(a.tint)).toBeLessThan(0.1);
    // more tint: the light's white is greener (y up), so the picture is corrected towards magenta
    expect(temperatureToWhite(5000, 20)[1]).toBeGreaterThan(temperatureToWhite(5000, 0)[1]);
    // "None" is D65 itself
    const [x, y] = xyOf(whiteOf(NO_CORRECTION));
    const [x0, y0] = xyOf(D65_XYZ);
    expect(Math.abs(x - x0) + Math.abs(y - y0)).toBeLessThan(1e-14);
  });
});

describe('the adaptation: CAT16 from the white of the light to D65, in scene light', () => {
  it('cat16 maps its white onto the target, is the identity on one white, and composes (von Kries)', () => {
    const a = xyToXYZ(...temperatureToWhite(3200, 5)), b = xyToXYZ(...temperatureToWhite(5000, -8)), c = xyToXYZ(...temperatureToWhite(9000, 20));
    const w = mv(cat16(a, b), a);
    for (let k = 0; k < 3; k++) expect(Math.abs(w[k]! - b[k]!)).toBeLessThan(1e-14);
    expect(maxDiff(cat16(a, a), I3)).toBeLessThan(1e-15);
    expect(maxDiff(mul(cat16(b, c), cat16(a, b)), cat16(a, c))).toBeLessThan(1e-14);
  });

  it('identity at the as-shot white: the as-shot temperature and tint reproduce the camera\'s white balance (the pre-1.6 evaluation)', () => {
    const wb = asShotWhiteBalance(CAM)!;
    // before contract 1.6, 'as-shot' was cat16(as-shot neutral's XYZ → D65) after the camera matrix
    const before = mul(cat16(asShotWhite(CAM)!, D65_XYZ), CAM.camToXyz!);
    expect(maxDiff(sceneMatrix(CAM, wb), before)).toBeLessThan(1e-13);
    // the as-shot neutral itself comes out D65-neutral
    const n = mv(sceneMatrix(CAM, wb), CAM.asShotNeutral!);
    const [x, y] = xyOf(n), [x0, y0] = xyOf(D65_XYZ);
    expect(Math.abs(x - x0) + Math.abs(y - y0)).toBeLessThan(1e-13);
    // "None": the camera's own XYZ, untouched (pre-1.6 'daylight'); a file without a camera reads as linear sRGB
    expect(maxDiff(sceneMatrix(CAM, NO_CORRECTION), CAM.camToXyz!)).toBeLessThan(1e-13);
    expect(maxDiff(whiteBalanceMatrix(NO_CORRECTION), I3)).toBeLessThan(1e-13);
    expect(asShotWhiteBalance({ make: 'x', model: 'y' })).toBeNull();
  });

  it('composition of two adjustments: a change of white is one CAT16 adaptation, and two changes are one', () => {
    const a: WhiteBalance = { temperature_K: 3100, tint: -4 }, b: WhiteBalance = { temperature_K: 5200, tint: 12 }, c: WhiteBalance = { temperature_K: 7400, tint: 3 };
    const change = (from: WhiteBalance, to: WhiteBalance): M3 => mul(whiteBalanceMatrix(to), inv(whiteBalanceMatrix(from)));
    // moving the white from a to b re-adapts the scene from b's white to a's: one von Kries scaling
    expect(maxDiff(change(a, b), cat16(whiteOf(b), whiteOf(a)))).toBeLessThan(1e-13);
    // two moves (a → b → c) are the one move a → c, whatever the path
    expect(maxDiff(mul(change(b, c), change(a, b)), change(a, c))).toBeLessThan(1e-13);
    expect(maxDiff(mul(change(b, c), mul(change(a, b), sceneMatrix(CAM, a))), sceneMatrix(CAM, c))).toBeLessThan(1e-13);
  });

  it('a higher temperature makes the picture warmer, a higher tint more magenta (Lightroom\'s directions)', () => {
    const grey = mv(inv(CAM.camToXyz!), xyToXYZ(...temperatureToWhite(5000, 0)));
    const at = (wb: WhiteBalance) => xyOf(mv(sceneMatrix(CAM, wb), grey));
    expect(at({ temperature_K: 6500, tint: 0 })[0]).toBeGreaterThan(at({ temperature_K: 5000, tint: 0 })[0] + 0.005);
    expect(at({ temperature_K: 4000, tint: 0 })[0]).toBeLessThan(at({ temperature_K: 5000, tint: 0 })[0] - 0.005);
    // magenta: less green, y falls
    expect(at({ temperature_K: 5000, tint: 30 })[1]).toBeLessThan(at({ temperature_K: 5000, tint: 0 })[1] - 0.005);
  });
});

describe('the eyedropper: the white balance that makes a picked point neutral', () => {
  it('a grey under any light becomes D65-neutral; picking it again changes nothing', () => {
    for (const light of [{ temperature_K: 2900, tint: 3 }, { temperature_K: 4300, tint: 18 }, { temperature_K: 8800, tint: -9 }]) {
      // a 30 % grey under the light, as the camera recorded it
      const rgb = mv(inv(CAM.camToXyz!), whiteOf(light).map((v) => 0.3 * v));
      for (const current of [asShotWhiteBalance(CAM)!, NO_CORRECTION, { temperature_K: 6100, tint: -20 }]) {
        const sample = mv(sceneMatrix(CAM, current), rgb);
        const picked = pickedWhiteBalance(sample, current);
        expect(Math.abs(picked.temperature_K - light.temperature_K)).toBeLessThan(1e-6);
        expect(Math.abs(picked.tint - light.tint)).toBeLessThan(1e-8);
        const [x, y] = xyOf(mv(sceneMatrix(CAM, picked), rgb)), [x0, y0] = xyOf(D65_XYZ);
        expect(Math.abs(x - x0) + Math.abs(y - y0)).toBeLessThan(1e-12);
        // idempotent: the picked point is neutral now, so picking it again keeps the white balance
        const again = pickedWhiteBalance(mv(sceneMatrix(CAM, picked), rgb), picked);
        expect(sameWhiteBalance(again, picked)).toBe(true);
        expect(Math.abs(again.temperature_K - picked.temperature_K)).toBeLessThan(1e-6);
      }
    }
  });

  it('clamps to the controls\' ranges and refuses black', () => {
    const green = whiteBalanceOf([0.3, 0.6, 0.2]);
    expect(green.tint).toBe(150);
    expect(() => pickedWhiteBalance([0, 0, 0], NO_CORRECTION)).toThrow(/no colour/);
  });
});
