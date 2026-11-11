// Synthetic frames with known dye amounts (stand-ins for CHB-004's synthetic fixtures): smooth dye
// gradients pushed through the scanner forward model, so the scan's transmittance is exact.
import type { SolveInputs, Vec3 } from '../tables/inputs.ts';
import type { Segment } from '../chain/program.ts';
import { OP } from '../chain/program.ts';
import { chromogenOracle } from '../physics/oracle.ts';
import { chainConstants, type Setup } from './fixtures.ts';

export const TREB: Vec3 = [0.8, 0.75, 0.7];

/** Scanner density relative to the base for dye amounts c (d − Dbase). */
export function forwardD(s: SolveInputs, c: readonly number[]): Vec3 {
  const out: number[] = [];
  for (let k = 0; k < 3; k++) {
    let t = 0;
    for (let i = 0; i < s.B.length; i++) t += s.P[k]![i]! * 10 ** -(s.B[i]! + c[0]! * s.E[0][i]! + c[1]! * s.E[1][i]! + c[2]! * s.E[2][i]!);
    out.push(-Math.log10(t) - s.Dbase[k]!);
  }
  return out as Vec3;
}

/** A w × h camera-linear scan (3 channels) of smooth dye gradients, plus the true dyes. */
export function syntheticScan(s: SolveInputs, w: number, h: number): { T: Float32Array; dyes: Float64Array } {
  const T = new Float32Array(w * h * 3);
  const dyes = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / Math.max(1, w - 1);
    const v = y / Math.max(1, h - 1);
    const c = [0.15 + 1.6 * u, 0.2 + 1.4 * v, 0.3 + 1.2 * (0.5 + 0.5 * Math.sin(3 * u + 2 * v))];
    const D = forwardD(s, c);
    const i = y * w + x;
    for (let k = 0; k < 3; k++) {
      T[3 * i + k] = TREB[k]! * 10 ** -D[k]!;
      dyes[3 * i + k] = c[k]!;
    }
  }
  return { T, dyes };
}

/** The negative-scan chain as one segment: density → dyes → expose → develop → reflect → flare → display. */
export function scanChain(S: Setup, upTo: 'dyes' | 'paper-logH' | 'print-xyz' | 'display' = 'display', flare = 0.0048): Segment {
  const cc = chainConstants(S.solve, S.paper);
  // interim aim: the grey card (film.develop(0)) prints at paper density ≈ 0.75 in every layer
  const cGrey = S.film.curves.map((cv) => cv.at(0));
  const pdGrey = chromogenOracle.spectral(S.pd, cGrey as Vec3);
  const xAim = S.paper.curves.map((cv) => cv.inverse(0.75));
  const L = [0, 1, 2].map((k) => xAim[k]! - (cc.clear[k]! - pdGrey[k]!));
  const white = chromogenOracle.spectral(S.print, [0, 0, 0]);
  const ops: Segment['ops'] = [{ code: OP.DENSITY, p0: [...TREB] }, { code: OP.DYES }];
  if (upTo !== 'dyes') {
    ops.push({ code: OP.EXPOSE, p0: [0, 1, 2].map((k) => cc.clear[k]! + L[k]!) });
    if (upTo !== 'paper-logH') {
      ops.push({ code: OP.DEVELOP }, { code: OP.REFLECT }, { code: OP.FLARE, p0: white.map((w) => w * flare), p1: [1 / (1 + flare)] });
      if (upTo === 'display') ops.push({ code: OP.DISPLAY });
    }
  }
  return { ops, tables: { solve: S.solve, pd: S.pd, print: S.print, curves: { film: S.film, paper: S.paper } } };
}
