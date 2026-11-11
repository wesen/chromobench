// Pointwise programs for kernels/pointwise.wgsl: op codes, the uniform layout, and a CPU f64
// evaluator of the same program (the interim chain reference; CHB-003's engine replaces it).
import { defineStruct } from '../layout.ts';
import { chromogenOracle, type F64Oracle } from '../physics/oracle.ts';
import type { Curve } from '../physics/spectral.ts';
import { A_RANGE, CP_RANGE, C_RANGE, X_RANGE, type Mat3, type SolveInputs, type SpectralInputs, type Vec3 } from '../tables/inputs.ts';

export const OP = Object.freeze({ DENSITY: 1, DYES: 2, EXPOSE: 3, ADD: 4, DEVELOP: 5, REFLECT: 6, FLARE: 7, DISPLAY: 8, GRAIN: 9, DECODE: 10 });
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
  /** Paper curves (develop): film forward/inverse and paper curves in rows 0..2. */
  curves?: { film: { curves: Curve[] }; paper: { curves: Curve[] } };
}

export interface Segment { ops: PwOp[]; tables: SegmentTables }

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
    misc: [seg.ops.length, a.lookup, a.exact && s ? 1 : 0, s ? s.B.length : 0],
    solver: s ? [s.tol, Math.max(s.gtol, 1e-6), s.maxIt, s.hi] : [0, 0, 0, 4],
    disp: XYZ_TO_SRGB,
  });
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

// ---- CPU f64 reference of a program: exact solve and exact spectral integrals, no tables ----

const srgbEnc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const srgbDec = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const clampV = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

/** Evaluates a segment on one pixel in f64 (fp = full-res frame position, for grain). */
export function evalPixelF64(seg: Segment, v0: number[], fp: [number, number], oracle: F64Oracle = chromogenOracle): number[] {
  let v = [v0[0] ?? 0, v0[1] ?? 0, v0[2] ?? 0, v0[3] ?? 0];
  const t = seg.tables;
  for (const o of seg.ops) {
    const p0 = o.p0 ?? [];
    const p1 = o.p1 ?? [];
    switch (o.code) {
      case OP.DECODE:
        if (p0[0] === 1) v = [srgbDec(v[0]!), srgbDec(v[1]!), srgbDec(v[2]!), v[3]!];
        else if (p0[0] === 2) v = [Math.max(v[0]!, 0) ** 2.2, Math.max(v[1]!, 0) ** 2.2, Math.max(v[2]!, 0) ** 2.2, v[3]!];
        break;
      case OP.DENSITY:
        v = [0, 1, 2].map((k) => -Math.log10(Math.max(v[k]!, 1e-8) / p0[k]!)).concat(v[3]!);
        break;
      case OP.DYES: {
        const s = t.solve!;
        const D = v.slice(0, 3) as Vec3;
        const r = oracle.solve(s, [D[0] + s.Dbase[0], D[1] + s.Dbase[1], D[2] + s.Dbase[2]]);
        v = [...r.c, r.residual];
        break;
      }
      case OP.EXPOSE: {
        const pd = oracle.spectral(t.pd!, v.slice(0, 3).map((x) => clampV(x, C_RANGE[0], C_RANGE[1])) as Vec3);
        v = [p0[0]! - pd[0], p0[1]! - pd[1], p0[2]! - pd[2], 0];
        break;
      }
      case OP.ADD:
        v = [v[0]! + p0[0]!, v[1]! + p0[1]!, v[2]! + p0[2]!, v[3]!];
        break;
      case OP.DEVELOP: {
        const cv = t.curves!.paper.curves;
        v = [0, 1, 2].map((k) => Math.max(0, cv[k]!.at(clampV(v[k]!, X_RANGE[0], X_RANGE[1])))).concat(0);
        break;
      }
      case OP.REFLECT:
        v = [...oracle.spectral(t.print!, v.slice(0, 3).map((x) => clampV(x, CP_RANGE[0], CP_RANGE[1])) as Vec3), 0];
        break;
      case OP.FLARE:
        v = [(v[0]! + p0[0]!) * p1[0]!, (v[1]! + p0[1]!) * p1[0]!, (v[2]! + p0[2]!) * p1[0]!, v[3]!];
        break;
      case OP.DISPLAY: {
        const M = XYZ_TO_SRGB;
        let rgb = [0, 1, 2].map((r) => M[r]![0] * v[0]! + M[r]![1] * v[1]! + M[r]![2] * v[2]!);
        if (o.flags === 1) rgb = rgb.map((x) => Math.tanh(Math.max(x, 0) * 1.2) / Math.tanh(1.2));
        v = [...rgb.map((x) => srgbEnc(clampV(x, 0, 1))), 0];
        break;
      }
      case OP.GRAIN: {
        const seed = o.flags ?? 0;
        v = [0, 1, 2].map((k) => Math.max(v[k]! + p0[0]! * p0[1]! * Math.sqrt(Math.max(v[k]!, 0) + 0.05) * normal1(fp[0], fp[1], k, seed), 0)).concat(v[3]!);
        break;
      }
      default:
        throw new Error(`unknown op ${o.code}`);
    }
  }
  return v;
}
