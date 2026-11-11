// Area resampling on linear values (guide §5.5): a port of Chromogen's Source.region (05-inline.js
// 2559–2593) with the linearise-first fix (values come from CameraLinear.row, already linear), in sensor
// coordinates (DR-7; orientation is applied last, by output.frame). After the footprint mean: the flat
// at the footprint's centre, then the open-gate normalisation and flare removal.
import type { Box, Orientation, Vec3 } from '@chromobench/contract';
import type { CameraLinear } from '../decode/linear.ts';
import { flatAt, type FlatField } from './flat.ts';

export interface RegionOptions {
  flat?: FlatField | null | undefined;
  /** Linear value of the open gate per channel: T′ = value / openGate. */
  openGate?: Vec3 | null | undefined;
  /** Flare as a fraction of the open-gate signal (needs openGate): T = T′(1 + f) − f. */
  flare?: Vec3 | number | null | undefined;
  /** Channels to return (default: all of the source's). */
  channels?: 3 | 4;
}

/** Linear values of the sensor box `box`, area-averaged to tw×th, interleaved. */
export function region(src: CameraLinear, box: Box, tw: number, th: number, o: RegionOptions = {}): Float32Array {
  const nc = o.channels ?? src.channels;
  const out = new Float32Array(tw * th * nc);
  const { x: x0, y: y0, w, h } = box;
  const sx = w / tw;
  const sy = h / th;
  const SW = src.width;
  const SH = src.height;
  const xa0 = new Int32Array(tw);
  const xb0 = new Int32Array(tw);
  for (let tx = 0; tx < tw; tx++) {
    const xa = x0 + tx * sx;
    xa0[tx] = Math.max(0, Math.floor(xa));
    xb0[tx] = Math.min(SW, Math.ceil(xa + sx));
  }
  const rows = Array.from({ length: nc }, () => new Float32Array(SW));
  const acc = new Float64Array(tw * nc);
  const F = new Float64Array(4);
  const fl = o.flare;
  const flare = fl == null ? null : typeof fl === 'number' ? [fl, fl, fl, 0] : [...fl, 0];
  const gate = o.openGate ?? null;
  for (let ty = 0; ty < th; ty++) {
    const ya = y0 + ty * sy;
    const yb = ya + sy;
    acc.fill(0);
    let ny = 0;
    for (let y = Math.max(0, Math.floor(ya)); y < Math.min(SH, Math.ceil(yb)); y++) {
      ny++;
      for (let c = 0; c < nc; c++) src.row(c, y, rows[c]!);
      for (let tx = 0; tx < tw; tx++) for (let c = 0; c < nc; c++) {
        const r = rows[c]!;
        let s = 0;
        for (let x = xa0[tx]!; x < xb0[tx]!; x++) s += r[x]!;
        acc[tx * nc + c]! += s;
      }
    }
    for (let tx = 0; tx < tw; tx++) {
      const n = Math.max(1, ny * (xb0[tx]! - xa0[tx]!));
      const o0 = (ty * tw + tx) * nc;
      for (let c = 0; c < nc; c++) out[o0 + c] = acc[tx * nc + c]! / n;
      if (o.flat) {
        const xa = x0 + tx * sx;
        const cx = Math.min(SW - 1, Math.max(0, Math.floor(xa + sx / 2)));
        const cy = Math.min(SH - 1, Math.max(0, Math.floor(ya + sy / 2)));
        flatAt(o.flat, (cx + 0.5) / SW, (cy + 0.5) / SH, F);
        for (let c = 0; c < Math.min(nc, 3); c++) out[o0 + c] = out[o0 + c]! / F[c]!;
      }
      if (gate) for (let c = 0; c < Math.min(nc, 3); c++) out[o0 + c] = out[o0 + c]! / gate[c]!;
      if (flare && gate) for (let c = 0; c < Math.min(nc, 3); c++) out[o0 + c] = removeFlareValue(out[o0 + c]!, flare[c]!);
    }
  }
  return out;
}

/** T = T′(1 + f) − f, floored at 1e-6 (guide §5.7). */
export function removeFlareValue(Tprime: number, f: number): number {
  return Math.max(1e-6, Tprime * (1 + f) - f);
}

/** Size of the oriented image. */
export function orientedSize(o: Orientation, sw: number, sh: number): [number, number] {
  return ['cw90', 'ccw90', 'transpose', 'transverse'].includes(o) ? [sh, sw] : [sw, sh];
}

/** Continuous sensor point → oriented point. */
export function orientPoint(o: Orientation, u: number, v: number, sw: number, sh: number): [number, number] {
  switch (o) {
    case 'none': return [u, v];
    case 'flipH': return [sw - u, v];
    case 'flipV': return [u, sh - v];
    case 'rot180': return [sw - u, sh - v];
    case 'cw90': return [sh - v, u];
    case 'ccw90': return [v, sw - u];
    case 'transpose': return [v, u];
    case 'transverse': return [sh - v, sw - u];
  }
}

/** Continuous oriented point → sensor point. */
export function unorientPoint(o: Orientation, x: number, y: number, sw: number, sh: number): [number, number] {
  switch (o) {
    case 'none': return [x, y];
    case 'flipH': return [sw - x, y];
    case 'flipV': return [x, sh - y];
    case 'rot180': return [sw - x, sh - y];
    case 'cw90': return [y, sh - x];
    case 'ccw90': return [sw - y, x];
    case 'transpose': return [y, x];
    case 'transverse': return [sw - y, sh - x];
  }
}

const boxFrom = (a: [number, number], b: [number, number]): Box => ({
  x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]),
});

/** A sensor box seen in oriented coordinates (for display). */
export function sensorToOrientedBox(o: Orientation, b: Box, sw: number, sh: number): Box {
  return boxFrom(orientPoint(o, b.x, b.y, sw, sh), orientPoint(o, b.x + b.w, b.y + b.h, sw, sh));
}

/** An oriented box (e.g. Chromogen's sample metadata) in sensor coordinates (DR-7). */
export function orientedToSensorBox(o: Orientation, b: Box, sw: number, sh: number): Box {
  return boxFrom(unorientPoint(o, b.x, b.y, sw, sh), unorientPoint(o, b.x + b.w, b.y + b.h, sw, sh));
}
