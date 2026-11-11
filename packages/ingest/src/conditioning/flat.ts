// Flat field (guide §2.4, §5.6): a port of Chromogen's flatGrid/flatAt (05-inline.js 2453–2507) on
// linear values (the cell mean is of light, not of encoded values), keeping the open-gate mean Chromogen
// discards, in sensor coordinates, with a W_FLAT_SHAPE diagnostic instead of a silent null.
import type { Diagnostic, Vec3 } from '@chromobench/contract';
import type { CameraLinear } from '../decode/linear.ts';

export const FLAT_DETAIL = { smooth: 96, fine: 512 } as const;

export interface FlatField {
  sha256: string;
  detail: 'smooth' | 'fine';
  gw: number;
  gh: number;
  /** Normalised illumination (mean 1, floor 0.05), RGB interleaved. */
  grid: Float32Array;
  /** Mean linear value per channel before normalising: the open gate, when exposures match. */
  openGate: Vec3;
  /** log10(max / min) over cells above 0.2: the lit area's range in D. */
  falloffD: Vec3;
  sensor: { width: number; height: number };
  exposure?: { exposure_s?: number; iso?: number; fnumber?: number };
}

export function flatGrid(flat: CameraLinear, detail: 'smooth' | 'fine' = 'smooth', long: number = FLAT_DETAIL[detail]): FlatField {
  const W = flat.width;
  const H = flat.height;
  const gw = W >= H ? long : Math.max(2, Math.round((long * W) / H));
  const gh = W >= H ? Math.max(2, Math.round((long * H) / W)) : long;
  let g = new Float64Array(gw * gh * 3);
  const n = new Float64Array(gw * gh);
  const row = new Float32Array(W);
  const gxOf = new Int32Array(W);
  for (let x = 0; x < W; x++) gxOf[x] = Math.min(gw - 1, Math.floor((x / W) * gw));
  const total = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    const gy = Math.min(gh - 1, Math.floor((y / H) * gh));
    for (let k = 0; k < 3; k++) {
      flat.row(k, y, row);
      for (let x = 0; x < W; x++) {
        const q = gy * gw + gxOf[x]!;
        g[3 * q + k]! += row[x]!;
        total[k]! += row[x]!;
        if (k === 0) n[q]!++;
      }
    }
  }
  for (let q = 0; q < gw * gh; q++) for (let k = 0; k < 3; k++) g[3 * q + k] = g[3 * q + k]! / Math.max(1, n[q]!);
  const passes = long > 200 ? 1 : 2;
  for (let p = 0; p < passes; p++) for (const horiz of [true, false]) {
    const o = new Float64Array(g.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) for (let k = 0; k < 3; k++) {
      let s = 0;
      let wsum = 0;
      for (let d = -1; d <= 1; d++) {
        const xx = horiz ? x + d : x;
        const yy = horiz ? y : y + d;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const wt = d ? 1 : 2;
        s += wt * g[3 * (yy * gw + xx) + k]!;
        wsum += wt;
      }
      o[3 * (y * gw + x) + k] = s / wsum;
    }
    g = o;
  }
  const mean = [0, 1, 2].map((k) => {
    let s = 0;
    for (let q = 0; q < gw * gh; q++) s += g[3 * q + k]!;
    return s / (gw * gh) || 1;
  });
  const lo = [Infinity, Infinity, Infinity];
  const hi = [0, 0, 0];
  const grid = new Float32Array(gw * gh * 3);
  for (let q = 0; q < gw * gh; q++) for (let k = 0; k < 3; k++) {
    const v = Math.max(0.05, g[3 * q + k]! / mean[k]!);
    grid[3 * q + k] = v;
    if (v > 0.2) {
      lo[k] = Math.min(lo[k]!, v);
      hi[k] = Math.max(hi[k]!, v);
    }
  }
  return {
    sha256: flat.sha256, detail, gw, gh, grid,
    openGate: [0, 1, 2].map((k) => total[k]! / (W * H)) as Vec3,
    falloffD: [0, 1, 2].map((k) => Math.log10(hi[k]! / lo[k]!)) as Vec3,
    sensor: { width: W, height: H },
  };
}

/** Bilinear read of the grid at normalised sensor position (u, v) ∈ [0, 1]². */
export function flatAt(G: FlatField, u: number, v: number, out: Float64Array | number[]): Float64Array | number[] {
  const fx = Math.min(G.gw - 1, Math.max(0, u * G.gw - 0.5));
  const fy = Math.min(G.gh - 1, Math.max(0, v * G.gh - 0.5));
  const x0 = Math.min(G.gw - 2, Math.floor(fx));
  const y0 = Math.min(G.gh - 2, Math.floor(fy));
  const ax = fx - x0;
  const ay = fy - y0;
  const d = G.grid;
  for (let k = 0; k < 3; k++) {
    const a = d[3 * (y0 * G.gw + x0) + k]!;
    const b = d[3 * (y0 * G.gw + x0 + 1) + k]!;
    const c = d[3 * ((y0 + 1) * G.gw + x0) + k]!;
    const e = d[3 * ((y0 + 1) * G.gw + x0 + 1) + k]!;
    out[k] = (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + e * ax) * ay;
  }
  return out;
}

/** The flat if its sensor shape matches the scan (aspect within 1 %), else null with W_FLAT_SHAPE. */
export function checkFlat(F: FlatField, scan: { width: number; height: number }): { flat: FlatField | null; notes: Diagnostic[] } {
  const a = F.sensor.width / F.sensor.height;
  const b = scan.width / scan.height;
  if (Math.abs(a - b) > 0.01 * b) {
    return { flat: null, notes: [{ code: 'W_FLAT_SHAPE', message: `The flat field is ${F.sensor.width}×${F.sensor.height}, the scan ${scan.width}×${scan.height}: aspect ratios differ, so the flat is not applied.`, hint: 'Capture the flat with the same camera orientation and crop as the scans.' }] };
  }
  const notes: Diagnostic[] = [];
  if (F.sensor.width !== scan.width) notes.push({ code: 'W_FLAT_SHAPE', message: `The flat field (${F.sensor.width}×${F.sensor.height}) is read at the scan's size (${scan.width}×${scan.height}) by normalised position.` });
  return { flat: F, notes };
}
