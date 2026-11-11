// The conditioning map (guide §2.7, §5.10; textbook §3.2): σ₃, the smallest singular value of the
// forward model's Jacobian, tabulated 17³ over the dye cube [0, 2.6]³ per scanner × stock, read
// trilinearly at each pixel's solved dyes, stored as a one-channel gain 1/σ₃ (scalar-field domain).
import type { Diagnostic, ScannerForward } from '@chromobench/contract';

export interface SigmaTable { n: number; max: number; data: Float64Array; scanner: string; stock: string }

export function sigmaTable(fwd: ScannerForward, stock: string, n = 17, max = 2.6): SigmaTable {
  const data = new Float64Array(n * n * n);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) {
    data[(a * n + b) * n + c] = fwd.sigmaMin(stock, [(a * max) / (n - 1), (b * max) / (n - 1), (c * max) / (n - 1)]);
  }
  return { n, max, data, scanner: fwd.scanner, stock };
}

/** Trilinear read of σ₃ at dye amounts (c, m, y), clamped to the cube. */
export function sigmaAt(t: SigmaTable, c0: number, c1: number, c2: number): number {
  const { n, max, data } = t;
  const f = (v: number): [number, number] => {
    const x = Math.min(n - 1, Math.max(0, (v / max) * (n - 1)));
    const i = Math.min(n - 2, Math.floor(x));
    return [i, x - i];
  };
  const [i, a] = f(c0);
  const [j, b] = f(c1);
  const [k, c] = f(c2);
  const at = (p: number, q: number, r: number): number => data[((i + p) * n + j + q) * n + k + r]!;
  let s = 0;
  for (let p = 0; p < 2; p++) for (let q = 0; q < 2; q++) for (let r = 0; r < 2; r++) {
    s += (p ? a : 1 - a) * (q ? b : 1 - b) * (r ? c : 1 - c) * at(p, q, r);
  }
  return s;
}

export interface ConditioningSummary {
  /** Share of pixels with σ₃ below 0.05 (program.js's warning threshold). */
  illConditioned: number;
  medianGain: number;
  size: [number, number];
  notes: Diagnostic[];
}

/** Per-pixel gain 1/σ₃ from interleaved dyes (stride 3 or 4), plus the frame summary. */
export function conditioningMap(t: SigmaTable, dyes: Float32Array | Float64Array, w: number, h: number, stride = 3, threshold = 0.05): { gain: Float32Array; summary: ConditioningSummary } {
  const N = w * h;
  const gain = new Float32Array(N);
  let bad = 0;
  for (let i = 0; i < N; i++) {
    const s = sigmaAt(t, dyes[i * stride]!, dyes[i * stride + 1]!, dyes[i * stride + 2]!);
    if (s < threshold) bad++;
    gain[i] = 1 / Math.max(s, 1e-6);
  }
  const sorted = Float32Array.from(gain).sort();
  const illConditioned = bad / N;
  const notes: Diagnostic[] = bad
    ? [{ code: 'W_ILL_CONDITIONED', message: `${(illConditioned * 100).toFixed(2)} % of pixels have σ₃ < ${threshold}: density noise is amplified more than ${(1 / threshold).toFixed(0)}× into dye noise there (${t.scanner}, ${t.stock}).` }]
    : [];
  return { gain, summary: { illConditioned, medianGain: sorted[N >> 1]!, size: [w, h], notes } };
}
