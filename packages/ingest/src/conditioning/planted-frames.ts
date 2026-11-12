// A synthetic scan of a strip of several frames (CHB-027 WS-D): frames one after another along the strip with
// unexposed gaps between them, rebate along both edges (sprocket holes on 135), the opaque holder around the film
// and a scanner veil. Everything is known, so stripFrames can be checked against planted truth.
//
//   135: film 35 mm across, frames 36 × 24 mm, gaps 2 mm, holes in the rebate;
//   120: film 61 mm across, frames 41.5 × 56 mm (645, along × across), gaps 4 mm, no holes.
import type { Box, Vec3 } from '@chromobench/contract';
import { mulberry } from './dust/planted.ts';
import { GOLD200_BASE_D } from './planted-strip.ts';

export interface PlantedFramesOptions {
  /** Number of frames (default 3). */
  frames?: number;
  /** '135' or '120' (645) film (default '120'). */
  film?: '135' | '120';
  /** The strip's long axis (default 'y': a vertical strip). */
  axis?: 'x' | 'y';
  /** Pixels per millimetre (default 3). */
  pxPerMm?: number;
  seed?: number;
  /** Density added to each frame's scene, D (uneven exposure); default 0 for every frame. */
  exposureD?: number[];
  /** Frames (indices) that are nearly at base: an underexposed scene, 0.08 … 0.2 D above base. */
  dark?: number[];
  /** Dark frames get a band at base right across the frame, in their middle, of this share of the frame (default 0). */
  darkBand?: number;
  /** Leader (unexposed film) before the first frame and after the last, mm (default 3). */
  leaderMm?: number;
  holder?: boolean;
  /** Density noise (default 0.006 D). */
  sigma?: number;
}

export interface PlantedFrames {
  rgb: Float32Array;
  w: number;
  h: number;
  /** The image area of each frame, px, in order along the strip. */
  truth: { frames: Box[]; baseT: Vec3; veil: Vec3 };
}

function sceneD(u: number, v: number, k: number, seed: number): number {
  const p = seed * 1.3;
  const d = 0.95 + 0.5 * Math.sin(6 * u + k + p) * Math.cos(4 * v - k + p) + 0.35 * (u - 0.5) + 0.25 * Math.sin(13 * v + 3 * u + p);
  return Math.max(0.15, Math.min(2.0, d));
}

export function plantedFrames(o: PlantedFramesOptions = {}): PlantedFrames {
  const s = o.pxPerMm ?? 3;
  const n = o.frames ?? 3;
  const is135 = o.film === '135';
  const filmW = is135 ? 35 : 61;
  const frameAlong = is135 ? 36 : 41.5, frameAcross = is135 ? 24 : 56;
  const gap = is135 ? 2 : 4;
  const leader = o.leaderMm ?? 3;
  const holder = o.holder ?? true;
  const hold = holder ? 4 : 0;
  const along = 2 * leader + n * frameAlong + (n - 1) * gap;
  const across = filmW + 2 * hold;
  const vertical = (o.axis ?? 'y') === 'y';
  const w = Math.round((vertical ? across : along) * s), h = Math.round((vertical ? along : across) * s);
  const rnd = mulberry(o.seed ?? 11);
  const g = (): number => Math.sqrt(-2 * Math.log(rnd() + 1e-300)) * Math.cos(2 * Math.PI * rnd());
  const light: Vec3 = [0.92, 0.95, 0.88];
  const veil = light.map((l) => 0.004 * l) as Vec3;
  const baseT = light.map((l, k) => l * 10 ** -GOLD200_BASE_D[k]!) as Vec3;
  const sigma = o.sigma ?? 0.006;
  const imgA0 = hold + (filmW - frameAcross) / 2; // across, mm
  const frameStart = (i: number): number => leader + i * (frameAlong + gap);
  const dark = new Set(o.dark ?? []);
  const band = o.darkBand ?? 0;
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const am = ((vertical ? y : x) + 0.5) / s, cm = ((vertical ? x : y) + 0.5) / s;
    let T: number[];
    if (cm < hold || cm >= hold + filmW) T = [0, 0, 0];
    else {
      const edge = Math.min(cm - hold, hold + filmW - cm);
      const hole = is135 && edge >= 1 && edge < 3.8 && ((am + 2.5) % 4.75) < 1.98;
      if (hole) T = [...light];
      else {
        let D = [0, 0, 0];
        const i = Math.floor((am - leader) / (frameAlong + gap));
        const u = (am - frameStart(i)) / frameAlong, v = (cm - imgA0) / frameAcross;
        if (i >= 0 && i < n && u >= 0 && u < 1 && v >= 0 && v < 1) {
          if (dark.has(i)) D = [0, 1, 2].map((k) => (band > 0 && Math.abs(u - 0.5) < band / 2 ? 0 : 0.08 + 0.12 * (sceneD(u, v, k, i) - 0.15) / 1.85));
          else D = [0, 1, 2].map((k) => sceneD(u, v, k, i) + (o.exposureD?.[i] ?? 0));
        }
        T = D.map((d, k) => baseT[k]! * 10 ** -(Math.max(0, d) + sigma * g()));
      }
    }
    const p = (y * w + x) * 3;
    for (let k = 0; k < 3; k++) rgb[p + k] = T[k]! + veil[k]! + (T[k] === 0 ? Math.abs(g()) * 2e-5 : 0);
  }
  const frames: Box[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = Math.round(frameStart(i) * s), a1 = Math.round((frameStart(i) + frameAlong) * s);
    const c0 = Math.round(imgA0 * s), c1 = Math.round((imgA0 + frameAcross) * s);
    frames.push(vertical ? { x: c0, y: a0, w: c1 - c0, h: a1 - a0 } : { x: a0, y: c0, w: a1 - a0, h: c1 - c0 });
  }
  return { rgb, w, h, truth: { frames, baseT, veil } };
}
