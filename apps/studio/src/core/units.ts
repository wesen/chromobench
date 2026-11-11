// Darkroom units at the edge of the UI (guide §2.1, §5.7). The recipe stores log H, seconds, CC and
// f-numbers; the photographer reads points, stops, seconds in stop steps and CC. Nothing here
// changes what is stored: these are presentations and the arithmetic the tools show.
import { LOG10_2, LOGH_PER_POINT } from '@chromobench/contract';

export const PT = LOGH_PER_POINT; // 0.025 log H
export const STOP = LOG10_2; // 0.30103 log H
export const PT_PER_STOP = STOP / PT; // ≈ 12.04
/** Isolated-band rule (textbook §2.6): v CC on one layer shifts it by −v/100 log H = −0.4 pt per CC. */
export const PT_PER_CC = -0.01 / PT;

const MINUS = '−';

/** Signed number with a real minus sign: +4, −2.5. */
export function signed(x: number, digits = 0): string {
  const v = Number(x.toFixed(digits));
  if (v === 0) return digits ? (0).toFixed(digits) : '0';
  return `${v > 0 ? '+' : MINUS}${Math.abs(v).toFixed(digits)}`;
}

/** Plain number with a real minus sign. */
export function num(x: number, digits: number): string {
  const s = x.toFixed(digits);
  return s.startsWith('-') ? `${MINUS}${s.slice(1)}` : s;
}

// ---- time ----------------------------------------------------------------------------------

/** t · 2^(k·step): a time moved by k steps of `step` stops. */
export const timeAtStops = (t_s: number, stops: number): number => t_s * 2 ** stops;
export const stopsBetween = (t1_s: number, t2_s: number): number => Math.log2(t2_s / t1_s);

/** Seconds with two decimals, trimmed to one when the second is zero: 12.0, 15.12, 7.56. */
export function formatSeconds(t: number): string {
  const s = t.toFixed(2);
  return s.endsWith('0') ? s.slice(0, -1) : s;
}

const FRACTIONS = [1, 2, 3, 4, 6];
/** Stops as a fraction where one fits: +1/3, −1/4, +1, +1 1/2; otherwise two decimals. */
export function formatStops(s: number): string {
  if (Math.abs(s) < 1e-9) return '0';
  const sign = s > 0 ? '+' : MINUS;
  const a = Math.abs(s);
  for (const d of FRACTIONS) {
    const n = Math.round(a * d);
    if (Math.abs(a * d - n) < 1e-3) {
      const whole = Math.floor(n / d);
      const rest = n % d;
      if (rest === 0) return `${sign}${whole}`;
      const g = gcd(rest, d);
      return `${sign}${whole ? `${whole} ` : ''}${rest / g}/${d / g}`;
    }
  }
  return `${sign}${a.toFixed(2)}`;
}
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// ---- aperture ------------------------------------------------------------------------------

/** Nominal third-stop f-numbers; the true value of index k (from f/1) is 2^(k/6). */
export const FSTOPS_THIRD: readonly number[] = [
  1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11,
  13, 14, 16, 18, 20, 22, 25, 29, 32, 36, 40, 45, 51, 57, 64,
];
export const fstopTrue = (index: number): number => 2 ** (index / 6);
/** Index of the nominal f-number closest (in stops) to n. */
export function fstopIndex(n: number): number {
  let best = 0;
  for (let i = 1; i < FSTOPS_THIRD.length; i++) if (Math.abs(Math.log2(FSTOPS_THIRD[i]! / n)) < Math.abs(Math.log2(FSTOPS_THIRD[best]! / n))) best = i;
  return best;
}
/** Exposure change in log H when the lens goes from n1 to n2 (light ∝ 1/N²). */
export const fstopLogH = (n1: number, n2: number): number => 2 * Math.log10(n1 / n2);
export const fstopStops = (n1: number, n2: number): number => fstopLogH(n1, n2) / STOP;
export const formatFstop = (n: number): string => `f/${Number(n.toFixed(1))}`;

// ---- printer lights and filtration ---------------------------------------------------------

export const logHToPoints = (v: number): number => v / PT;
export const pointsToLogH = (p: number): number => p * PT;

const LAYER = { c: 'R', m: 'G', y: 'B' } as const;
/** Aside for a filtration change: ≈ −4.0 pt B for +10 CC yellow (isolated-band rule). */
export function filtrationAside(component: 'c' | 'm' | 'y', deltaCC: number): string {
  return `≈ ${signed(deltaCC * PT_PER_CC, 1)} pt ${LAYER[component]}`;
}

// ---- exposures (dodge, burn) ---------------------------------------------------------------

/** Seconds withheld by a dodge of `stops` (> 0) during a main exposure of t: t(1 − 2^−s). */
export const dodgeSeconds = (t_main: number, stops: number): number => t_main * (1 - 2 ** -stops);
/** Seconds added by a burn of `stops` (> 0) after a main exposure of t: t(2^s − 1). */
export const burnSeconds = (t_main: number, stops: number): number => t_main * (2 ** stops - 1);
