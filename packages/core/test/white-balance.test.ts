// CHB-048 (LAY-1, D2): the white balance before the film through the reference engine. A grey card lit by a tungsten
// light and white-balanced to it is, at the scene cut, the same grey as one under D65 with no correction, so it goes
// through the film and the darkroom exactly like the daylight grey: neutral at the darkroom's settings that print
// daylight neutral. Without the white balance the film records the light's colour (as a daylight film would).
import { compile, cutNode, newDocument, NO_CORRECTION, sha256Hex, whiteOf, type Document, type SourceInfo, type WhiteBalance } from '@chromobench/contract';
import { describe, expect, it } from 'vitest';
import { inv3, mulMV, nodePacksData, RefEngine, type Mat3 } from './film-helpers.ts';

const CAM_TO_XYZ: Mat3 = [[0.62, 0.22, 0.11], [0.27, 0.88, -0.15], [0.03, -0.12, 1.18]];
/** Grey cards (reflectance) across the frame. */
const GREYS = [0.05, 0.1, 0.184, 0.36, 0.7];

/** A camera file of grey cards lit by a light of white `light` (XYZ, Y = 1), as the camera recorded them. */
function greyCards(light: readonly number[], w = 40, h = 8): { info: SourceInfo; data: Float64Array } {
  const C = inv3(CAM_TO_XYZ);
  const data = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const rho = GREYS[Math.floor((x * GREYS.length) / w)]!;
    data.set(mulMV(C, light.map((v) => rho * v)), (y * w + x) * 3);
  }
  const sha = sha256Hex(new Uint8Array(data.buffer.slice(0)));
  const info: SourceInfo = {
    sha256: sha, format: 'raw', width: w, height: h, channels: 3, bits: 16, sample: 'float',
    encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' }, cfa: 'none',
    camera: { make: 'Synthetic', model: 'CHB-048', camToXyz: CAM_TO_XYZ, from: 'dng' }, clippedFraction: 0, notes: [],
  };
  return { info, data };
}

async function cut(e: RefEngine, d: Document, name: 'scene' | 'print'): Promise<Float64Array> {
  const r = await e.evaluate(cutNode(compile(d, e.graph), name), { scale: 'full', precision: 'export' });
  return (await r.read()) as Float64Array;
}
const maxAbs = (a: Float64Array, b: Float64Array): number => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i]!)), 0);
/** The print's middle grey card (XYZ under the viewing light): its chromaticity's distance from the paper's white. */
const card = (px: Float64Array, w = 40, h = 8): number[] => {
  const x = Math.floor(2.5 * (w / GREYS.length)), y = Math.floor(h / 2), i = (y * w + x) * 3;
  return [px[i]!, px[i + 1]!, px[i + 2]!];
};
const xy = (v: number[]): [number, number] => [v[0]! / (v[0]! + v[1]! + v[2]!), v[1]! / (v[0]! + v[1]! + v[2]!)];

describe('white balance before the film (reference engine)', () => {
  const tungsten: WhiteBalance = { temperature_K: 3200, tint: 0 };

  it('a tungsten-lit grey white-balanced to its light is the daylight grey: the same scene, film and print (≤ 1e-9)', async () => {
    const e = new RefEngine({ data: nodePacksData() });
    const day = greyCards(whiteOf(NO_CORRECTION));
    const tung = greyCards(whiteOf(tungsten));
    e.openDecoded(day.info, day.data);
    e.openDecoded(tung.info, tung.data);
    const dDay = newDocument('digital-raw', { sha256: day.info.sha256, width: 40, height: 8 }, { whiteBalance: NO_CORRECTION });
    const dTung = newDocument('digital-raw', { sha256: tung.info.sha256, width: 40, height: 8 }, { whiteBalance: tungsten });
    const sceneDay = await cut(e, dDay, 'scene'), sceneTung = await cut(e, dTung, 'scene');
    expect(maxAbs(sceneDay, sceneTung)).toBeLessThan(1e-12);
    const printDay = await cut(e, dDay, 'print'), printTung = await cut(e, dTung, 'print');
    expect(maxAbs(printDay, printTung)).toBeLessThan(1e-9);

    // without the white balance the film sees the tungsten light: the same darkroom prints the grey card warm
    const dRaw = newDocument('digital-raw', { sha256: tung.info.sha256, width: 40, height: 8 }, { whiteBalance: NO_CORRECTION });
    const printRaw = await cut(e, dRaw, 'print');
    const [xd, yd] = xy(card(printDay)), [xr, yr] = xy(card(printRaw));
    // the daylight grey prints near the viewing white; the uncorrected tungsten grey far from it, towards red-yellow
    expect(Math.hypot(xr - xd, yr - yd)).toBeGreaterThan(0.03);
    expect(xr).toBeGreaterThan(xd);
  }, 60_000);
});
