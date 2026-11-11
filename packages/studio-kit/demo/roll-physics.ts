// The roll kit's physics (RollPhysics) from packages/ingest and packages/core: what a host passes as the
// service `rollPhysics`. The dev host and the tests use this file; apps/studio's host file (engines.ts) builds the
// same object (with its data packs' ScannerForward for the stock ranking).
import type { Box, ScannerForward, Vec3 } from '@chromobench/contract';
import { integrateToGrey, Lights } from '@chromobench/core';
import { classifyImage, filmLayout, rankStocks, rollBase, sigmaD } from '@chromobench/ingest';
import type { RollPhysics } from '../kits/roll/src/index.ts';

function sub(rgb: Float32Array, w: number, b: Box): Float32Array {
  const out = new Float32Array(b.w * b.h * 3);
  for (let y = 0; y < b.h; y++) out.set(rgb.subarray(((b.y + y) * w + b.x) * 3, ((b.y + y) * w + b.x + b.w) * 3), y * b.w * 3);
  return out;
}

export function rollPhysics(o: { fwd?: ScannerForward | null; stocks?: string[] } = {}): RollPhysics {
  return {
    layout: (rgb, w, h) => filmLayout(rgb, w, h),
    rollBase: (frames) => rollBase(frames),
    integrateToGrey: (latd, aim, alpha) => [...integrateToGrey(latd, { latd: aim.latd, lights: Lights.fromLogH(aim.lights) }, alpha).logH] as Vec3,
    // σ on the rebate box at this size (ingest's noiseAtScale with the image already at the scale), else thin film
    noise: (rgb, w, h, T, box) => {
      if (box && box.w >= 2 && box.h >= 2) {
        const s = sigmaD(sub(rgb, w, box), box.w, box.h, T);
        if (s) return s;
      }
      const thin = (i: number): boolean => [0, 1, 2].every((k) => -Math.log10(Math.max(rgb[3 * i + k]!, 1e-6) / T[k]!) <= 0.08);
      return sigmaD(rgb, w, h, T, thin);
    },
    classes: (rgb, w, h, T, sigma) => {
      const s = classifyImage(rgb, w, h, T, sigma).stats;
      return { blank: s.blank, below: s.below, above: s.above };
    },
    // Absolute base density needs an open gate: without one the light's colour (per channel) is unknown and no
    // stock can be named, not even by shape.
    rank: (base, stocks) => (o.fwd && base.absD ? rankStocks(base.absD, stocks ?? o.stocks ?? [], o.fwd) : null),
  };
}
