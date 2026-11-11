// INTERIM: builds table inputs and chain constants from stock JSON, after Chromogen model.js
// (solveInputs 1699–1716, printingChannels/pdOf 1717–1733, printSetup 1763–1787, curves 1748–1762).
// TODO(CHB-003/CHB-004): core and the data packs provide these; the GPU engine only consumes the arrays.
import { A_RANGE, CP_RANGE, C_RANGE, N3, X_RANGE, type Mat3, type SolveInputs, type SpectralInputs, type Vec3 } from '../tables/inputs.ts';
import {
  adapt, analytical, blackbody, cmf, D65, GRID, printerClear, printingChannels, readDensity, scannerChannels, WL, xyz,
  type CameraJson, type Channels, type Stock,
} from './spectral.ts';

export const SOLVE_OPTS = Object.freeze({ lo: 0, hi: 4, tol: 1e-12, gtol: 1e-9, maxIt: 50, activeSet: true });

export function solveInputs(ch: Channels, film: Stock, N = N3): SolveInputs {
  return {
    kind: 'solve', P: ch.P, E: film.dyes, B: film.base, K: analytical(ch, film.dyes), Dbase: readDensity(ch, film.base),
    ...SOLVE_OPTS, range: A_RANGE, N,
  };
}

export function pdInputs(film: Stock, paper: Stock, lampK = 3200, N = N3): SpectralInputs {
  const PCh = printingChannels(paper, lampK);
  return { kind: 'pd', mode: 'log', E: film.dyes, B: film.base, W: PCh.P, M: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], range: C_RANGE, N };
}

const STAIN = Float64Array.from(WL, (w) => Math.exp(-0.5 * ((w - 410) / 38) ** 2) + 0.35 * Math.exp(-0.5 * ((w - 470) / 30) ** 2));

/** Print table inputs: reflectance under the viewing light, XYZ adapted to D65 by M. */
export function printInputs(paper: Stock, { viewingK = 5000, fade = 0, N = N3 } = {}): SpectralInputs {
  const V = blackbody(viewingK);
  const c = cmf();
  const B = Float64Array.from(paper.base, (b, i) => b + fade * 0.14 * STAIN[i]!);
  let kY = 0;
  for (let i = 0; i < GRID.n; i++) kY += V[i]! * c.Y[i]!;
  const W: [Float64Array, Float64Array, Float64Array] = [
    Float64Array.from(V, (v, i) => (v * c.X[i]!) / kY),
    Float64Array.from(V, (v, i) => (v * c.Y[i]!) / kY),
    Float64Array.from(V, (v, i) => (v * c.Z[i]!) / kY),
  ];
  const white = xyz(new Float64Array(GRID.n).fill(1), V);
  const cols = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((e) => adapt(e, white, D65));
  const M = [0, 1, 2].map((r) => [cols[0]![r]!, cols[1]![r]!, cols[2]![r]!]) as Mat3;
  return { kind: 'print', mode: 'lin', E: paper.dyes, B, W, M, range: CP_RANGE, N };
}

/** 1-D curve tables (N1 = 512 samples, rgba32float rows): row 0 film forward, 1 film inverse, 2 paper. */
export const N1 = 512;
export function curveRows(film: Stock, paper: Stock): { data: Float32Array; ranges: { x: [number, number]; c: [number, number] } } {
  const data = new Float32Array(3 * N1 * 4);
  const row = (r: number, lo: number, hi: number, f: (x: number) => number[]) => {
    for (let i = 0; i < N1; i++) {
      const v = f(lo + ((hi - lo) * i) / (N1 - 1));
      data.set([v[0]!, v[1]!, v[2]!, 1], 4 * (r * N1 + i));
    }
  };
  row(0, X_RANGE[0], X_RANGE[1], (x) => film.curves.map((c) => c.at(x)));
  row(1, C_RANGE[0], C_RANGE[1], (c) => film.curves.map((cv) => cv.inverse(c)));
  row(2, X_RANGE[0], X_RANGE[1], (x) => paper.curves.map((c) => Math.max(0, c.at(x))));
  return { data, ranges: { x: X_RANGE, c: C_RANGE } };
}

export interface ChainConstants {
  /** Scanner rebate transmittance (fraction); D = −log₁₀(T / Treb). */
  Kinv: Mat3;
  /** Paper exposure of clear light, log₁₀ per layer (print.js makePrinter clear). */
  clear: Vec3;
}

export function chainConstants(si: SolveInputs, paper: Stock, lampK = 3200): ChainConstants {
  const K = si.K;
  const det = K[0][0] * (K[1][1] * K[2][2] - K[1][2] * K[2][1]) - K[0][1] * (K[1][0] * K[2][2] - K[1][2] * K[2][0]) + K[0][2] * (K[1][0] * K[2][1] - K[1][1] * K[2][0]);
  const c = (i: number, j: number) => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const s = [0, 1, 2].filter((x) => x !== j);
    return K[r[0]!]![s[0]!]! * K[r[1]!]![s[1]!]! - K[r[0]!]![s[1]!]! * K[r[1]!]![s[0]!]!;
  };
  const Kinv = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (((i + j) % 2 ? -1 : 1) * c(j, i)) / det)) as Mat3;
  return { Kinv, clear: printerClear(paper, lampK) };
}

/**
 * INTERIM aim ('normalised' print.expose): log-exposure offsets L so the film's grey card
 * (film.develop(0)) prints at paper density 0.75 in every layer. TODO(CHB-003/CHB-010): the real aim
 * is printer.greyPatch(0.184) in core.
 */
export function interimAim(film: Stock, paper: Stock, pd: SpectralInputs, clear: Vec3, pdAt: (c: Vec3) => Vec3): Vec3 {
  void pd;
  const cGrey = film.curves.map((cv) => cv.at(0)) as Vec3;
  const pdGrey = pdAt(cGrey);
  const xAim = paper.curves.map((cv) => cv.inverse(0.75));
  return [0, 1, 2].map((k) => xAim[k]! - (clear[k]! - pdGrey[k]!)) as Vec3;
}

export { scannerChannels, type CameraJson };
