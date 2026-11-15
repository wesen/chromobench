// Moved from apps/studio/src/core/units.ts (CHB-009) for CHB-019 (the original was deleted in the apps/studio migration).
// Darkroom units at the edge of the UI (guide §2.1, §5.7). The document stores log H, seconds, CC and
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

/**
 * A time as a printer sets it on the timer (CHB-027 F13): whole seconds from 10 s, tenths from 1 s, hundredths
 * below. A slider drag lands on 20 s, not 20.16 s. Each rounding is under 10 % of the time, so ⅙-stop steps
 * (12 %) never collapse onto the same value.
 */
export function printerSeconds(t: number): number {
  if (!(t > 0)) return t;
  if (t >= 10) return Math.round(t);
  if (t >= 1) return Math.round(t * 10) / 10;
  return Math.max(0.01, Math.round(t * 100) / 100);
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

const GLYPHS: Record<string, string> = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/6': '⅙', '5/6': '⅚' };
/** Within this many stops a change reads as a fraction: the printer's rounded seconds and the nominal f-numbers. */
export const STOP_TOLERANCE = 0.02;

/**
 * A change in stops as History writes it (CHB-031 F32): "+⅓ stop", "−1 stop", "+1⅔ stops", "+0.6 stop". The timer's
 * rounded seconds (7.94 → 10.0 s is 0.333 stop) and nominal f-numbers (f/8 → f/7.1) are thirds of a stop, so a
 * change within 0.02 stop of a half, third, quarter or sixth reads as that fraction; others with one decimal.
 */
export function stopWords(s: number): string {
  if (!Number.isFinite(s)) return '';
  const a = Math.abs(s);
  if (a < 0.005) return '0 stops';
  const sign = s > 0 ? '+' : MINUS;
  for (const d of FRACTIONS) {
    const n = Math.round(a * d);
    if (n > 0 && Math.abs(a - n / d) < STOP_TOLERANCE) {
      const whole = Math.floor(n / d);
      const rest = n % d;
      const g = gcd(rest, d);
      const frac = rest ? GLYPHS[`${rest / g}/${d / g}`] ?? `${rest / g}/${d / g}` : '';
      const many = whole > 1 || (whole === 1 && rest > 0);
      return `${sign}${whole || !frac ? whole : ''}${frac} stop${many ? 's' : ''}`;
    }
  }
  const t = a < 0.1 ? a.toFixed(2) : a.toFixed(1);
  return `${sign}${t} stop${a > 1 && t !== '1.0' ? 's' : ''}`;
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
/**
 * The change of light from n1 to n2 in stops, counting the lens's third-stop marks when both are marked f-numbers
 * (f/8 → f/11 is −1 stop, though 8/11 is −0.92: f/11 is 2^3.5 = 11.3 rounded). Other values as fstopStops.
 */
export function fstopMarkStops(n1: number, n2: number): number {
  const i1 = fstopIndex(n1);
  const i2 = fstopIndex(n2);
  const marked = (n: number, i: number): boolean => Math.abs(FSTOPS_THIRD[i]! - n) < 1e-6;
  return marked(n1, i1) && marked(n2, i2) ? (i1 - i2) / 3 : fstopStops(n1, n2);
}
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
