// Flare (guide §2.5, §5.7; textbook §3.1, §3.7): scattered light adds a fraction f of the open-gate
// signal, D′ = −log10((10^(−d) + f)/(1 + f)) on a neutral wedge. fitFlare recovers f per channel by
// Levenberg–Marquardt, optionally with a shared density scale q for the wedge's calibration.
import type { Diagnostic, Vec3 } from '@chromobench/contract';
export { removeFlareValue as removeFlare } from './resample.ts';

/** Reading of a wedge step d through flare f and scale q, relative to a step at d0. */
export function wedgeReading(d: number, f: number, q = 1, d0 = 0): number {
  const D = (x: number): number => -Math.log10((10 ** (-q * x) + f) / (1 + f));
  return D(d) - D(d0);
}

export interface WedgeReading { nominalD: number; Dmeas: Vec3 }
export interface FlareFit { f: Vec3; q: number; rmsD: Vec3; steps: number; notes: Diagnostic[] }

/** Minimises Σ r² over params with LM and a forward-difference Jacobian. */
function lm(params: number[], resid: (p: number[]) => number[], iters = 200): number[] {
  let p = [...params];
  let r = resid(p);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-3;
  for (let it = 0; it < iters; it++) {
    const J = p.map((_, j) => {
      const h = 1e-7 * Math.max(1, Math.abs(p[j]!));
      const q = [...p];
      q[j]! += h;
      const r2 = resid(q);
      return r2.map((v, i) => (v - r[i]!) / h);
    });
    const n = p.length;
    const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J[a]!.reduce((s, v, i) => s + v * J[b]![i]!, 0)));
    const g = Array.from({ length: n }, (_, a) => J[a]!.reduce((s, v, i) => s + v * r[i]!, 0));
    let improved = false;
    for (let tries = 0; tries < 20 && !improved; tries++) {
      const M = A.map((row, a) => row.map((v, b) => v + (a === b ? lambda * (A[a]![a]! || 1) : 0)));
      const step = solve(M, g.map((v) => -v));
      const q = p.map((v, j) => v + step[j]!);
      const r2 = resid(q);
      const c2 = r2.reduce((s, v) => s + v * v, 0);
      if (c2 < cost) {
        improved = true;
        const done = cost - c2 < 1e-18 * Math.max(1, cost);
        p = q; r = r2; cost = c2; lambda = Math.max(1e-12, lambda / 10);
        if (done) return p;
      } else lambda *= 10;
    }
    if (!improved) break;
  }
  return p;
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    const d = M[c]![c]! || 1e-300;
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = M[r]![c]! / d;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / (r[i]! || 1e-300));
}

/** Fits f for one channel (q fixed), the textbook's §3.7 fit. */
export function fitFlareChannel(nominal: number[], measured: number[], q = 1): number {
  const d0 = nominal[0]!;
  const [f] = lm([0.001], ([f]) => nominal.map((d, i) => wedgeReading(d, f!, q, d0) - measured[i]!));
  return f!;
}

/** Per-channel f and, if `fitScale`, one shared density scale q. Readings are relative to the first step. */
export function fitFlare(readings: WedgeReading[], o: { fitScale?: boolean } = {}): FlareFit {
  const d0 = readings[0]!.nominalD;
  const fitScale = o.fitScale ?? false;
  const resid = (p: number[]): number[] => {
    const q = fitScale ? p[3]! : 1;
    const r: number[] = [];
    for (const s of readings) for (let k = 0; k < 3; k++) r.push(wedgeReading(s.nominalD, p[k]!, q, d0) - s.Dmeas[k]!);
    return r;
  };
  const p = lm(fitScale ? [0.001, 0.001, 0.001, 1] : [0.001, 0.001, 0.001], resid);
  const q = fitScale ? p[3]! : 1;
  const f = [p[0]!, p[1]!, p[2]!] as Vec3;
  const r = resid(p);
  const rmsD = [0, 1, 2].map((k) => Math.sqrt(readings.reduce((s, _, i) => s + r[i * 3 + k]! ** 2, 0) / readings.length)) as Vec3;
  const notes: Diagnostic[] = [];
  if (f.some((v) => v < 0)) notes.push({ code: 'RANGE', message: `Negative flare fitted (${f.map((v) => v.toFixed(4)).join(', ')}): the black level was probably over-subtracted. Not clamped.` });
  return { f, q, rmsD, steps: readings.length, notes };
}
