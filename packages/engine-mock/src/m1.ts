// The M1 synthetic negative: 96×64, "orange mask" rebate strip, grey patch, horizontal density ramp.
import { writeTiff16 } from '@chromobench/ingest';

export const M1 = Object.freeze({
  width: 96,
  height: 64,
  rebate: { x: 0, y: 0, w: 8, h: 64 },
  rebateT: [0.8, 0.5, 0.35] as const,
  patch: { x: 40, y: 24, w: 16, h: 16 },
  patchT: [0.2, 0.1, 0.05] as const,
  /** Centre pixel of the grey patch, used by the M1 trace. */
  patchCentre: { x: 48, y: 32 },
});

const code = (t: number): number => Math.round(t * 65535);

/** Pixel codes of the fixture, interleaved RGB. */
export function m1Codes(): Uint16Array {
  const { width: w, height: h, rebate, rebateT, patch, patchT } = M1;
  const out = new Uint16Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let t: readonly number[];
      if (x < rebate.x + rebate.w) t = rebateT;
      else if (x >= patch.x && x < patch.x + patch.w && y >= patch.y && y < patch.y + patch.h) t = patchT;
      else {
        const d = 0.1 + (1.5 * (x - rebate.w)) / (w - rebate.w - 1); // 0.1 … 1.6 D above the rebate
        t = rebateT.map((r) => r * 10 ** -d);
      }
      for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = code(t[k]!);
    }
  }
  return out;
}

export function makeM1Tiff(): Uint8Array {
  return writeTiff16(M1.width, M1.height, m1Codes());
}
