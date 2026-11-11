// Pointwise programs for kernels/pointwise.wgsl: op codes and the uniform layout. The f64 reference of
// a program is core's reference engine on the same graph (parity/chain-tests.ts, CHB-017).
import { defineStruct } from '../layout.ts';
import type { CurveRow } from '../physics/core.ts';
import { A_RANGE, CP_RANGE, C_RANGE, X_RANGE, type Mat3, type SolveInputs, type SpectralInputs } from '../tables/inputs.ts';

export const OP = Object.freeze({
  DENSITY: 1, DYES: 2, EXPOSE: 3, ADD: 4, DEVELOP: 5, REFLECT: 6, FLARE: 7, DISPLAY: 8, GRAIN: 9, DECODE: 10, ADAPT: 11,
  // CHB-010 masks
  MASK_LUM: 12, MASK_GRADIENT: 13, MASK_ELLIPSE: 14, MASK_NOT: 15,
});
export const MAXOPS = 12;
/** Table lookup modes: hardware trilinear (preview), manual tetrahedral (export), manual trilinear, broken (no half-texel). */
export const LOOKUP = Object.freeze({ hw: 0, tetra: 1, trilinear: 2, noHalfTexel: 3 });

export const PROG = defineStruct('Prog', [
  ['ops', { array: 'vec4u', n: MAXOPS }],
  ['params', { array: 'vec4f', n: 2 * MAXOPS }],
  ['Kinv', 'mat3x3f'], ['K', 'mat3x3f'], ['Dbase', 'vec4f'],
  ['rangesA', 'vec4f'], ['rangesB', 'vec4f'], ['outMap', 'vec4f'],
  ['frame', 'vec4u'], ['srcOrigin', 'vec4i'], ['misc', 'vec4u'], ['solver', 'vec4f'], ['disp', 'mat3x3f'],
]);

export interface PwOp {
  code: number;
  flags?: number;
  p0?: number[];
  p1?: number[];
  /** Node id this op computes (for taps and diagnostics). */
  node?: string;
}

/** Everything a segment's ops need besides the image. */
export interface SegmentTables {
  solve?: SolveInputs;
  pd?: SpectralInputs;
  print?: SpectralInputs;
  /** The paper-curve row of print.develop (core's developer sampled on X_RANGE). */
  curves?: CurveRow;
}

/** `disp`: output.display's matrix before the knee (default XYZ_TO_SRGB); one per segment. */
export interface Segment { ops: PwOp[]; tables: SegmentTables; disp?: Mat3 }

export const XYZ_TO_SRGB: Mat3 = [[3.2404542, -1.5371385, -0.4985314], [-0.969266, 1.8760108, 0.041556], [0.0556434, -0.2040259, 1.0572252]];

export interface PackArgs {
  seg: Segment;
  outW: number; outH: number;
  frameW: number; frameH: number;
  region: { x: number; y: number; w: number; h: number };
  srcOrigin: [number, number];
  srcIsPrev: boolean;
  lookup: number;
  exact: boolean;
}

export function packProgram(a: PackArgs): ArrayBuffer {
  const { seg } = a;
  if (seg.ops.length > MAXOPS) throw new Error(`program of ${seg.ops.length} ops exceeds ${MAXOPS}`);
  const ops: number[][] = [];
  const params: number[][] = [];
  for (const o of seg.ops) {
    ops.push([o.code, o.flags ?? 0, 0, 0]);
    params.push(pad4(o.p0), pad4(o.p1));
  }
  const s = seg.tables.solve;
  const I: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return PROG.pack({
    ops, params,
    Kinv: s ? inv(s.K) : I, K: s ? s.K : I, Dbase: s ? [...s.Dbase, 0] : [0, 0, 0, 0],
    rangesA: [A_RANGE[0], A_RANGE[1], C_RANGE[0], C_RANGE[1]], rangesB: [CP_RANGE[0], CP_RANGE[1], X_RANGE[0], X_RANGE[1]],
    outMap: [a.region.x, a.region.y, a.region.w / a.outW, a.region.h / a.outH],
    frame: [a.outW, a.outH, a.frameW, a.frameH],
    srcOrigin: [a.srcOrigin[0], a.srcOrigin[1], a.srcIsPrev ? 1 : 0, 0],
    misc: [seg.ops.length, a.lookup, exactBits(seg, a.exact), spectralSamples(seg)],
    solver: s ? [s.tol, Math.max(s.gtol, 1e-6), s.maxIt, s.hi] : [0, 0, 0, 4],
    disp: seg.disp ?? XYZ_TO_SRGB,
  });
}

/** misc.z: which tables the export path replaces by exact integrals (1 solve, 2 pd, 4 print). */
export function exactBits(seg: Segment, exact: boolean): number {
  if (!exact) return 0;
  const t = seg.tables;
  return (t.solve ? 1 : 0) | (t.pd ? 2 : 0) | (t.print ? 4 : 0);
}

/** Samples per spectrum (the spectra of one segment share the grid). */
export function spectralSamples(seg: Segment): number {
  const t = seg.tables;
  return (t.solve ?? t.pd ?? t.print)?.B.length ?? 0;
}

/** The exact path's spectra buffer (layout in kernels/pointwise.wgsl at binding 8). */
export function packSpectra(seg: Segment): Float32Array<ArrayBuffer> {
  const n = spectralSamples(seg);
  const out = new Float32Array(21 * n + 9);
  const put = (at: number, arrays: readonly ArrayLike<number>[]) => arrays.forEach((a, j) => { for (let q = 0; q < n; q++) out[at + j * n + q] = a[q]!; });
  const t = seg.tables;
  if (t.solve) put(0, [...t.solve.P, ...t.solve.E, t.solve.B]);
  if (t.pd) put(7 * n, [...t.pd.W, ...t.pd.E, t.pd.B]);
  if (t.print) {
    put(14 * n, [...t.print.W, ...t.print.E, t.print.B]);
    out.set(t.print.M.flat(), 21 * n);
  }
  return out;
}

function pad4(v?: number[]): number[] {
  const o = [0, 0, 0, 0];
  (v ?? []).forEach((x, i) => (o[i] = x));
  return o;
}

export function inv(K: Mat3): Mat3 {
  const det = K[0][0] * (K[1][1] * K[2][2] - K[1][2] * K[2][1]) - K[0][1] * (K[1][0] * K[2][2] - K[1][2] * K[2][0]) + K[0][2] * (K[1][0] * K[2][1] - K[1][1] * K[2][0]);
  const c = (i: number, j: number) => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const s = [0, 1, 2].filter((x) => x !== j);
    return K[r[0]!]![s[0]!]! * K[r[1]!]![s[1]!]! - K[r[0]!]![s[1]!]! * K[r[1]!]![s[0]!]!;
  };
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (((i + j) % 2 ? -1 : 1) * c(j, i)) / det)) as Mat3;
}

// ---- grain RNG on the CPU (tests and the spatial parity) ----

/** pcg4d in JS (u32 arithmetic with Math.imul), bit-identical to the WGSL version. */
export function pcg4d(a: number, b: number, c: number, d: number): [number, number, number, number] {
  let x = (Math.imul(a, 1664525) + 1013904223) >>> 0;
  let y = (Math.imul(b, 1664525) + 1013904223) >>> 0;
  let z = (Math.imul(c, 1664525) + 1013904223) >>> 0;
  let w = (Math.imul(d, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, w)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0; w = (w + Math.imul(y, z)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0; z = (z ^ (z >>> 16)) >>> 0; w = (w ^ (w >>> 16)) >>> 0;
  x = (x + Math.imul(y, w)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0; w = (w + Math.imul(y, z)) >>> 0;
  return [x, y, z, w];
}
export function normal1(px: number, py: number, k: number, seed: number): number {
  const r = pcg4d(px, py, k, seed);
  const u1 = ((r[0] >>> 8) + 0.5) / 16777216;
  const u2 = (r[1] >>> 8) / 16777216;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
