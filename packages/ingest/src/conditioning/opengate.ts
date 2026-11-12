// The open gate (guide §2.3, §5.7): the light with no film (T = 1). From the capture itself (sprocket
// holes, a holder gap), else from a flat field at matching exposure, else none (W_NO_OPEN_GATE: flare
// correction, the base check and stock ranking are off).
import type { Box, Diagnostic, Vec3 } from '@chromobench/contract';
import type { CameraLinear } from '../decode/linear.ts';
import type { FlatField } from './flat.ts';
import { region, type RegionOptions } from './resample.ts';

export interface OpenGate {
  T: Vec3 | null;
  from: 'capture' | 'box' | 'flat' | null;
  /** Bounding box of the accepted pixels, sensor coordinates. */
  box: Box | null;
  notes: Diagnostic[];
}

const NONE = (why: string): OpenGate => ({
  T: null, from: null, box: null,
  notes: [{ code: 'W_NO_OPEN_GATE', message: `No open-gate reference: ${why}. Flare correction, the base check and stock ranking are off.`, hint: 'Include sprocket holes or a holder gap in the capture, or a flat field at the scan exposure.' }],
});

/**
 * Detects open-gate pixels: the brightest 0.2 % of the scan (at ≤ 512 px), accepted only if their
 * channel ratios match the light's (the flat's open-gate colour) within 0.05 D, the orange mask's do not.
 * Without a detection, uses the flat's open-gate mean when `flatExposureMatches`.
 */
export function detectOpenGate(src: CameraLinear, o: { flat?: FlatField | null; flatExposureMatches?: boolean; lightRatio?: Vec3; cond?: RegionOptions } = {}): OpenGate {
  const light = o.lightRatio ?? o.flat?.openGate;
  if (light) {
    const sc = Math.min(1, 512 / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * sc));
    const h = Math.max(1, Math.round(src.height * sc));
    const img = region(src, { x: 0, y: 0, w: src.width, h: src.height }, w, h, { ...o.cond, channels: 3, openGate: null, flare: null });
    const N = w * h;
    const sum = new Float64Array(N);
    for (let i = 0; i < N; i++) sum[i] = img[3 * i]! + img[3 * i + 1]! + img[3 * i + 2]!;
    const thr = Float64Array.from(sum).sort()[Math.floor(N * 0.998)]!;
    const lr = light.map((v) => Math.log10(v / light[1]!));
    const acc = [0, 0, 0];
    let n = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < N; i++) {
      if (sum[i]! < thr) continue;
      const g = img[3 * i + 1]!;
      if (!(g > 0)) continue;
      const ok = [0, 2].every((k) => Math.abs(Math.log10(Math.max(img[3 * i + k]!, 1e-9) / g) - lr[k]!) < 0.05);
      if (!ok) continue;
      for (let k = 0; k < 3; k++) acc[k]! += img[3 * i + k]!;
      n++;
      const x = i % w, y = Math.floor(i / w);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    // Need at least half of the brightest pixels to have the light's colour.
    if (n >= Math.max(4, 0.5 * N * 0.002)) {
      return {
        T: acc.map((v) => v / n) as Vec3, from: 'capture',
        box: { x: Math.floor(x0 / sc), y: Math.floor(y0 / sc), w: Math.ceil((x1 - x0 + 1) / sc), h: Math.ceil((y1 - y0 + 1) / sc) },
        notes: [],
      };
    }
  }
  if (o.flat && o.flatExposureMatches) return { T: o.flat.openGate, from: 'flat', box: null, notes: [] };
  return NONE(light ? 'no pixels with the light\'s colour among the brightest, and no flat at matching exposure' : 'no flat field or light colour to recognise it by');
}
