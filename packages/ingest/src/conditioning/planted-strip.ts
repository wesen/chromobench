// A synthetic camera scan of one 135 frame in its holder (CHB-020 roll fixtures): the frame, its rebate bands
// with sprocket holes (open gate), slivers of the neighbouring frames beyond the inter-frame gaps, the opaque
// holder above and below the strip, and a scanner veil (flare) added to every pixel. Everything is known, so
// the film-layout search and the roll base can be checked against planted truth.
//
//   y (mm):  0 ─ holder ─ 3 ─ edge, holes 1.0–3.8 ─ rebate ─ 8.5 ─ image (24 mm) ─ 32.5 ─ rebate, holes ─ 38 ─ holder ─ 41
//   x (mm):  0 ─ neighbour ─ 1 ─ gap ─ 3 ─ image (36 mm) ─ 39 ─ gap ─ 41 ─ neighbour ─ 42
import type { Box, Vec3 } from '@chromobench/contract';
import { mulberry } from './dust/planted.ts';

export interface PlantedStripOptions {
  /** Pixels per millimetre (default 8: 336×328 px). */
  pxPerMm?: number;
  seed?: number;
  /** Film base density through the scanner channels (default Gold 200's, CHB-006 §2.3). */
  baseD?: Vec3;
  /** Linear value of the open gate (the light), default [0.92, 0.95, 0.88]. */
  light?: Vec3;
  /** Veil as a fraction of the open-gate signal (default 0.004). */
  flare?: number;
  /** Extra base density of this frame (a mixed roll, uneven development), D. */
  baseOffsetD?: number;
  /** Exposure of the scene: added to its density, D (default 0). */
  exposureD?: number;
  /** Colour of the scene's light: added per channel, D (default 0). */
  castD?: Vec3;
  /** Density noise per channel (default 0.004 D). */
  sigma?: Vec3;
  holes?: boolean;
  holder?: boolean;
  neighbours?: boolean;
  /** Varies the scene. */
  scene?: number;
}

export interface PlantedStrip {
  rgb: Float32Array;
  w: number;
  h: number;
  truth: {
    /** Linear value of the rebate without veil: light · 10^−(base + offset). */
    baseT: Vec3;
    openT: Vec3;
    /** The additive veil in linear units: flare · light. */
    veil: Vec3;
    flare: number;
    crop: Box;
    holes: Box[];
    /** Rebate bands (between the holes' inner edge and the image), px. */
    rebate: Box[];
  };
}

export const GOLD200_BASE_D: Vec3 = [0.282, 0.643, 0.84];

/** Scene density above base (0 … ~2.1 D) at frame coordinates u, v ∈ [0, 1), with a blank shadow patch. */
function scene(u: number, v: number, k: number, seed: number): number {
  if (u > 0.06 && u < 0.24 && v > 0.62 && v < 0.9) return 0; // a shadow: blank film
  const p = seed * 1.7;
  const d = 1.0 + 0.55 * Math.sin(5 * u + k + p) * Math.cos(3 * v - k + p) + 0.45 * (u - 0.5) + 0.3 * Math.sin(11 * v + 2 * u + p) - 0.15 * k * (v - 0.5);
  return Math.max(0.05, Math.min(2.1, d));
}

export function plantedStrip(o: PlantedStripOptions = {}): PlantedStrip {
  const s = o.pxPerMm ?? 8;
  const W = 42, H = 41;
  const w = Math.round(W * s), h = Math.round(H * s);
  const rnd = mulberry(o.seed ?? 7);
  const g = (): number => Math.sqrt(-2 * Math.log(rnd() + 1e-300)) * Math.cos(2 * Math.PI * rnd());
  const baseD = o.baseD ?? GOLD200_BASE_D;
  const light = o.light ?? [0.92, 0.95, 0.88];
  const flare = o.flare ?? 0.004;
  const off = o.baseOffsetD ?? 0;
  const expD = o.exposureD ?? 0;
  const cast = o.castD ?? [0, 0, 0];
  const sigma = o.sigma ?? [0.004, 0.004, 0.004];
  const holes = o.holes ?? true;
  const holder = o.holder ?? true;
  const neighbours = o.neighbours ?? true;
  const sc = o.scene ?? 0;
  const veil = light.map((l) => flare * l) as Vec3;
  const baseT = light.map((l, k) => l * 10 ** -(baseD[k]! + off)) as Vec3;
  const px = (mm: number): number => Math.round(mm * s);
  const filmY0 = holder ? 3 : 0, filmY1 = holder ? 38 : H;
  const crop: Box = { x: px(3), y: px(filmY0 + 5.5), w: px(39) - px(3), h: px(filmY0 + 29.5) - px(filmY0 + 5.5) };
  const holeBoxes: Box[] = [];
  if (holes) {
    for (let c = -2.5; c < W + 4.75; c += 4.75) {
      for (const y0 of [filmY0 + 1.0, filmY1 - 3.79]) {
        const b = { x: px(c), y: px(y0), w: px(c + 1.98) - px(c), h: px(y0 + 2.79) - px(y0) };
        if (b.x + b.w > 0 && b.x < w) holeBoxes.push(b);
      }
    }
  }
  const inHole = (x: number, y: number): boolean => holeBoxes.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xm = (x + 0.5) / s, ym = (y + 0.5) / s;
    const i = (y * w + x) * 3;
    let T: number[];
    if (ym < filmY0 || ym >= filmY1) T = [0, 0, 0]; // the holder
    else if (inHole(x, y)) T = [...light];
    else {
      let D = [0, 0, 0];
      const inFrameY = ym >= filmY0 + 5.5 && ym < filmY0 + 29.5;
      const v = (ym - filmY0 - 5.5) / 24;
      if (inFrameY && xm >= 3 && xm < 39) D = [0, 1, 2].map((k) => scene((xm - 3) / 36, v, k, sc) + expD + cast[k]!);
      else if (inFrameY && neighbours && (xm < 1 || xm >= 41)) D = [0, 1, 2].map((k) => scene(xm < 1 ? 0.97 + xm / 36 : (xm - 41) / 36, v, k, sc + 3));
      T = D.map((d, k) => baseT[k]! * 10 ** -(Math.max(0, d) + sigma[k]! * g()));
    }
    for (let k = 0; k < 3; k++) rgb[i + k] = T[k]! + veil[k]! + (T[k] === 0 ? Math.abs(g()) * 2e-5 : 0);
  }
  const rebate: Box[] = holes
    ? [{ x: crop.x, y: px(filmY0 + 3.79), w: crop.w, h: crop.y - px(filmY0 + 3.79) }, { x: crop.x, y: crop.y + crop.h, w: crop.w, h: px(filmY1 - 3.79) - crop.y - crop.h }]
    : [{ x: crop.x, y: px(filmY0), w: crop.w, h: crop.y - px(filmY0) }];
  return { rgb, w, h, truth: { baseT, openT: [...light] as Vec3, veil, flare, crop, holes: holeBoxes, rebate } };
}
