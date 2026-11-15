// The two synthetic sources of the golden pictures (CHB-037 P0): a colour-negative scan (a 16-bit TIFF, the way a
// scanner hands a negative to the studio) and a camera file (linear camera RGB with a camera matrix, the way ingest
// hands a decoded RAW to the engines). Both 96 × 64 px, made from formulas only: no photograph is involved.
// They are written once into packages/conformance/goldens/fixtures/ (render.ts --fixtures) and read from there,
// so the goldens never depend on this generator staying the same.
import { sha256Hex, type Box, type SourceInfo } from '@chromobench/contract';
import { writeTiff16 } from '@chromobench/ingest';
import { inv3, mulMV, SRGB_TO_XYZ, type Mat3 } from '../../packages/core/src/index.ts';

export const W = 96;
export const H = 64;

/** Where the scene's features are, in sensor px (both fixtures share the layout). */
export const LAYOUT = Object.freeze({
  /** The negative's film rebate (unexposed base): the zero of scanner density. */
  rebate: { x: 0, y: 0, w: 6, h: 64 } as Box,
  /** Top band: a neutral ramp from the deepest shadow (left) to the brightest highlight (right). */
  ramp: { x: 6, y: 0, w: 90, h: 20 } as Box,
  /** Middle band: seven patches (neutral, red, green, blue, skin, sky, yellow). */
  patches: { x: 6, y: 20, w: 90, h: 24 } as Box,
  /** Bottom band: fine detail on the left, a soft highlight blob on the right. */
  detail: { x: 6, y: 44, w: 34, h: 20 } as Box,
  blob: { cx: 66, cy: 54, sigma: 7 },
  /** Small defects: dust on the negative (prints white) and sensor dust on the camera file (prints dark). */
  specks: [{ x: 30.5, y: 31.5, r: 1.5 }, { x: 70.5, y: 51.5, r: 1.5 }, { x: 84.5, y: 9.5, r: 1.5 }],
});

const inBox = (x: number, y: number, b: Box): boolean => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
const inSpeck = (x: number, y: number): boolean => LAYOUT.specks.some((s) => Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) <= s.r);

/**
 * Scene log exposure relative to the grey card (log10), per channel (R, G, B as the camera or the film sees it).
 * 0 = grey card; the ramp runs −1.5 … +1.2.
 */
function sceneLogE(x: number, y: number): [number, number, number] {
  const L = LAYOUT;
  if (inBox(x, y, L.ramp)) {
    const v = -1.5 + (2.7 * (x - L.ramp.x)) / (L.ramp.w - 1);
    return [v, v, v];
  }
  if (inBox(x, y, L.patches)) {
    const PATCHES: [number, number, number][] = [
      [0, 0, 0], [0.25, -0.45, -0.45], [-0.45, 0.15, -0.45], [-0.5, -0.35, 0.2], [0.15, -0.05, -0.2], [-0.25, -0.05, 0.25], [0.2, 0.15, -0.6],
    ];
    return PATCHES[Math.min(6, Math.floor(((x - L.patches.x) * 7) / L.patches.w))]!;
  }
  if (inBox(x, y, L.detail)) {
    // a fine grating (4 px period) around −0.3, the scale an unsharp mask and the retouch act on
    const v = -0.3 + 0.15 * Math.sin((2 * Math.PI * x) / 4) * Math.sin((2 * Math.PI * y) / 6);
    return [v, v, v];
  }
  const { cx, cy, sigma } = L.blob;
  const v = -0.8 + 1.6 * Math.exp(-((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / (2 * sigma * sigma));
  return [v + 0.05, v, v - 0.05];
}

/** Base (rebate) transmission of the orange-masked film, as the scanner sees it. */
export const BASE_T = [0.8, 0.5, 0.35] as const;

/** Scanner codes of the negative: base × 10^−d, d = 0.65 + 0.6·logE above a fog of 0.15 (gamma 0.6). */
export function negativeCodes(): Uint16Array {
  const out = new Uint16Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let t: number[];
    if (inBox(x, y, LAYOUT.rebate)) t = [...BASE_T];
    else if (inSpeck(x, y)) t = BASE_T.map((b) => b * 0.004); // dust blocks the light: prints as a white speck
    else {
      const e = sceneLogE(x, y);
      t = BASE_T.map((b, k) => b * 10 ** -Math.max(0.15, 0.65 + 0.6 * e[k]!));
    }
    for (let k = 0; k < 3; k++) out[(y * W + x) * 3 + k] = Math.round(Math.min(1, t[k]!) * 65535);
  }
  return out;
}

export function makeNegativeTiff(): Uint8Array {
  return writeTiff16(W, H, negativeCodes());
}

/** Camera RGB → XYZ of the synthetic camera (white (1, 1, 1) is about D65). */
export const CAM_TO_XYZ: Mat3 = [[0.62, 0.22, 0.11], [0.27, 0.88, -0.15], [0.03, -0.12, 1.18]];

/** The scene light of the camera file, in linear sRGB: warmer than D65, so as-shot and daylight white balance differ. */
export const SCENE_LIGHT = [1.12, 1, 0.8] as const;

/** Linear camera RGB: the scene in linear sRGB (grey card 0.184) under SCENE_LIGHT through the camera matrix; sensor dust darkens. */
export function cameraData(): Float32Array {
  const C = inv3(CAM_TO_XYZ);
  const out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = inBox(x, y, LAYOUT.rebate) ? [-2.2, -2.2, -2.2] : sceneLogE(x, y); // no rebate on a camera file: a dark border
    const rgb = e.map((v, k) => 0.184 * SCENE_LIGHT[k]! * 10 ** v);
    let cam = mulMV(C, mulMV(SRGB_TO_XYZ, rgb));
    if (inSpeck(x, y)) cam = [cam[0] * 0.15, cam[1] * 0.15, cam[2] * 0.15];
    for (let k = 0; k < 3; k++) out[(y * W + x) * 3 + k] = Math.min(1, Math.max(0, cam[k]!));
  }
  return out;
}

/** The camera file's SourceInfo (as ingest reports a decoded DNG), for its pixels' hash. */
export function cameraInfo(data: Float32Array): SourceInfo {
  const neutral = mulMV(inv3(CAM_TO_XYZ), mulMV(SRGB_TO_XYZ, SCENE_LIGHT));
  return {
    sha256: sha256Hex(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)), format: 'raw', width: W, height: H, channels: 3, bits: 16, sample: 'float',
    encoding: { value: 'linear', evidence: 'format' }, levels: { black: [0, 0, 0], white: [1, 1, 1], from: 'default' }, cfa: 'none',
    camera: { make: 'Synthetic', model: 'CHB-037 golden camera', camToXyz: CAM_TO_XYZ, asShotNeutral: [neutral[0]!, neutral[1]!, neutral[2]!], from: 'dng' },
    clippedFraction: 0, notes: [],
  };
}
