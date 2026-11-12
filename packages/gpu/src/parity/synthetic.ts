// Synthetic frames with known dye amounts (stand-ins for CHB-004's synthetic fixtures): smooth dye
// gradients pushed through core's scanner forward model, so the scan's transmittance is exact. The
// left REBATE_W columns hold unexposed film (c = 0), so T there is the rebate transmittance.
import { writeTiff16 } from '@chromobench/ingest';
import type { SolveInputs, Vec3 } from '../tables/inputs.ts';
import type { Segment } from '../chain/program.ts';
import { lowerDisplay, OP } from '../chain/program.ts';
import type { Setup } from './fixtures.ts';

export const TREB: Vec3 = [0.8, 0.75, 0.7];
export const REBATE_W = 6;

/** Scanner density relative to the base for dye amounts c (d − Dbase), core's forward arrays. */
export function forwardD(s: SolveInputs, c: readonly number[]): Vec3 {
  const out: number[] = [];
  for (let k = 0; k < 3; k++) {
    let t = 0;
    for (let i = 0; i < s.B.length; i++) t += s.P[k]![i]! * 10 ** -(s.B[i]! + c[0]! * s.E[0][i]! + c[1]! * s.E[1][i]! + c[2]! * s.E[2][i]!);
    out.push(-Math.log10(t) - s.Dbase[k]!);
  }
  return out as Vec3;
}

/**
 * A w × h camera-linear scan (3 channels) of smooth dye gradients, plus the true dyes. T is quantised
 * to 16 bits, so the float frame and its TIFF (both engines open the TIFF) hold the same values.
 */
export function syntheticScan(s: SolveInputs, w: number, h: number): { T: Float32Array; dyes: Float64Array; tiff: Uint8Array } {
  const T = new Float32Array(w * h * 3);
  const dyes = new Float64Array(w * h * 3);
  const u16 = new Uint16Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / Math.max(1, w - 1);
    const v = y / Math.max(1, h - 1);
    const c = x < REBATE_W ? [0, 0, 0] : [0.15 + 1.6 * u, 0.2 + 1.4 * v, 0.3 + 1.2 * (0.5 + 0.5 * Math.sin(3 * u + 2 * v))];
    const D = forwardD(s, c);
    const i = y * w + x;
    for (let k = 0; k < 3; k++) {
      const q = Math.round(TREB[k]! * 10 ** -D[k]! * 65535);
      u16[3 * i + k] = q;
      T[3 * i + k] = q / 65535;
      dyes[3 * i + k] = c[k]!;
    }
  }
  return { T, dyes, tiff: writeTiff16(w, h, u16) };
}

/** The rebate transmittance as the engines measure it (mean of the quantised strip). */
export function rebateT(T: Float32Array, w: number, h: number): Vec3 {
  const m = [0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < REBATE_W; x++) for (let k = 0; k < 3; k++) m[k]! += T[3 * (y * w + x) + k]! / (REBATE_W * h);
  return m as Vec3;
}

/**
 * The negative-scan chain as one segment, every parameter from core: density → dyes → expose → develop
 * → reflect → flare → adapt (D65) → display (print-as-seen, clip). The engine-level parity tests check
 * that GpuEngine lowers the same graph to the same ops.
 */
export function scanChain(S: Setup, upTo: 'dyes' | 'paper-logH' | 'print-xyz' | 'display' = 'display', flarePercent = 0.48, treb: Vec3 = TREB): Segment {
  const P = S.physics;
  const chain = [
    { op: 'invert.dyes', args: { stock: S.film, scanner: S.scanner }, id: 'dyes', inputs: [] },
    { op: 'print.develop', args: { paper: S.paper, grade: 2 }, id: 'develop', inputs: [] },
    { op: 'view.reflect', args: { illuminant: 'D50' }, id: 'reflect', inputs: [] },
    { op: 'view.adapt', args: { to: 'D65' }, id: 'adapt', inputs: [] },
  ];
  const ctxAt = (i: number) => P.ctx(chain, i);
  const ops: Segment['ops'] = [{ code: OP.DENSITY, p0: [...treb] }, { code: OP.DYES }];
  let disp: Segment['disp'];
  let ok: Segment['ok'];
  if (upTo !== 'dyes') {
    ops.push({ code: OP.EXPOSE, p0: [...S.offset] });
    if (upTo !== 'paper-logH') {
      ops.push({ code: OP.DEVELOP }, { code: OP.REFLECT }, { code: OP.FLARE, p0: P.flare(ctxAt(3), flarePercent), p1: [1] });
      if (upTo === 'display') {
        const d = lowerDisplay(P.display(ctxAt(4), { rendering: 'print-as-seen', knee: 'clip', space: 'srgb' }));
        ops.push({ code: OP.ADAPT, p0: P.adaptGains(ctxAt(3), 'D65') }, d.op);
        disp = d.disp;
        ok = d.ok;
      }
    }
  }
  return { ops, tables: { solve: S.solve, pd: S.pd, print: S.print, curves: S.develop }, ...(disp ? { disp } : {}), ...(ok ? { ok } : {}) };
}
