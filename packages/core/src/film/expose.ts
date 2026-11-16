// Exposure of film to scene light (CHB-012 guide §2.4, §5.2; textbook §2.1; spektrafilm
// runtime/stages/filming.py, utils/autoexposure.py). The forward path's first stage:
// scene XYZ → (CAT16 to the film's reference white) → b, (u, v) → raw = b · table(u, v) · 2^EV. The CAT16 adaptation
// is the contract's (white-balance.ts cat16): the white balance before the film uses the same one, so the two compose.
import { cat16 } from '@chromobench/contract';
import { mulMV, type Mat3 } from '../spectral/linalg.ts';
import { lookupBilinear, lookupCubic, tri2quad, type FilmTable } from './upsample.ts';

export type AdaptMode = 'to-film-reference' | 'none';

/** XYZ and xy of an SPD through the CMFs (k = 1/Σȳ, so Y of the SPD itself is normalised away by xy). */
export function spdXY(spd: ArrayLike<number>, cmf: readonly ArrayLike<number>[]): [number, number] {
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < spd.length; i++) {
    X += spd[i]! * cmf[0]![i]!;
    Y += spd[i]! * cmf[1]![i]!;
    Z += spd[i]! * cmf[2]![i]!;
  }
  const s = X + Y + Z;
  return [X / s, Y / s];
}

export interface ExposeOptions {
  adapt: AdaptMode;
  /** White of the scene-xyz data (D65 for display-referred input and white-balanced RAW). */
  sourceWhite: ArrayLike<number>;
  /** The film's reference white XYZ (Y = 1). */
  refWhite: ArrayLike<number>;
  /** Exposure shift in stops (exposure compensation + auto exposure: shifts compose by addition). */
  ev: number;
  interp: 'cubic' | 'bilinear';
}

/** The per-pixel exposure, pre-bound: scene XYZ → linear raw (layer exposures; grey card ≈ 1). */
export interface Exposer {
  /** Combined matrix applied to scene XYZ before the chromaticity (adaptation or identity). */
  M: Mat3;
  scale: number;
  raw(xyz: ArrayLike<number>, out?: Float64Array): Float64Array;
}

export function makeExposer(table: FilmTable, o: ExposeOptions): Exposer {
  const M: Mat3 = o.adapt === 'to-film-reference' ? cat16(o.sourceWhite, o.refWhite) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const scale = 2 ** o.ev;
  const look = o.interp === 'cubic' ? lookupCubic : lookupBilinear;
  return {
    M, scale,
    raw(xyz, out = new Float64Array(3)) {
      const X = mulMV(M, xyz);
      const b = X[0] + X[1] + X[2];
      if (!(b > 0)) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
      const [u, v] = tri2quad(X[0] / b, X[1] / b);
      look(table, u, v, 3, out);
      for (let k = 0; k < 3; k++) out[k] = out[k]! * b * scale;
      return out;
    },
  };
}

/** The film-logH value of a linear raw exposure (filming.py: log10(max(raw, 0) + 1e-10)). */
export const logRaw = (r: number): number => Math.log10(Math.max(r, 0) + 1e-10);

// ---- auto exposure (spektrafilm utils/autoexposure.measure_autoexposure_ev) ---------------------

export const AUTO_EXPOSURE_METHODS = ['center_weighted', 'average', 'median', 'partial', 'matrix', 'multi_zone', 'highlight_weighted'] as const;
export type AutoExposureMethod = (typeof AUTO_EXPOSURE_METHODS)[number];

/**
 * Stops to add so the metered luminance lands on 0.184: −log₂(Ȳ / 0.184). Y is row-major w × h.
 * Coordinates are normalised so the long edge spans [−0.5, 0.5], sampled at x/w − 0.5 as upstream.
 */
export function autoExposureEV(Y: ArrayLike<number>, w: number, h: number, method: AutoExposureMethod = 'center_weighted'): number {
  const L = Math.max(w, h);
  const xs = Float64Array.from({ length: w }, (_, i) => (i / w - 0.5) * (w / L));
  const ys = Float64Array.from({ length: h }, (_, j) => (j / h - 0.5) * (h / L));
  const n = w * h;
  let m: number;
  const mean = (pred: (x: number, y: number) => boolean): number => {
    let s = 0, c = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (pred(xs[i]!, ys[j]!)) { s += Y[j * w + i]!; c++; }
    return c ? s / c : NaN;
  };
  switch (method) {
    case 'average': m = mean(() => true); break;
    case 'median': {
      const s = Float64Array.from(Y).sort();
      m = n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
      break;
    }
    case 'center_weighted': {
      let s = 0, ws = 0;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const wt = Math.exp(-(xs[i]! ** 2 + ys[j]! ** 2) / (2 * 0.2 ** 2));
        s += wt * Y[j * w + i]!;
        ws += wt;
      }
      m = s / ws;
      break;
    }
    case 'partial': {
      const p = mean((x, y) => Math.sqrt(x * x + y * y) < 0.15);
      m = Number.isNaN(p) ? mean(() => true) : p;
      break;
    }
    case 'matrix': {
      const ch = Math.floor(h / 5), cw = Math.floor(w / 5);
      let s = 0, ws = 0;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
        if (ch === 0 || cw === 0) continue;
        let a = 0;
        for (let j = r * ch; j < (r + 1) * ch; j++) for (let i = c * cw; i < (c + 1) * cw; i++) a += Y[j * w + i]!;
        const dist = Math.hypot((c - 2) / 2, (r - 2) / 2) / Math.SQRT2;
        const wt = 0.5 * (1 + Math.cos(Math.PI * dist));
        s += wt * (a / (ch * cw));
        ws += wt;
      }
      m = ws > 0 ? s / ws : mean(() => true);
      break;
    }
    case 'multi_zone': {
      const rings: [number, number, number][] = [[0, 0.05, 0.5], [0.05, 0.25, 0.3], [0.25, 0.5, 0.2]];
      let s = 0, ws = 0;
      for (const [lo, hi, wt] of rings) {
        const v = mean((x, y) => { const r = Math.sqrt(x * x + y * y); return r >= lo && r < hi; });
        if (Number.isNaN(v)) continue;
        s += wt * v;
        ws += wt;
      }
      m = ws > 0 ? s / ws : mean(() => true);
      break;
    }
    case 'highlight_weighted': {
      let s = 0, ws = 0;
      for (let i = 0; i < n; i++) { const y = Y[i]!; s += y * y * y; ws += y * y; }
      m = ws < 1e-12 ? mean(() => true) : s / ws;
      break;
    }
  }
  const ev = -Math.log2(m / 0.184);
  return Number.isFinite(ev) ? ev : 0;
}
