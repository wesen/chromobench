// Tone functions of curve and levels (contract catalog/adjust.ts), the f64 definition the GPU mirrors.
//
// curve: the monotone cubic Hermite interpolant through the points (Fritsch–Carlson, in the form of Fritsch and
// Butland's weighted harmonic mean, as scipy's PchipInterpolator): never overshoots, so monotone points give a monotone
// curve; beyond the end points it continues along the end tangents. Not Editor lab's parametric curve (`curveLut`,
// src/engine.js:202–211), whose negative contrast added contrast (design §13).
// levels: t = (x − black)/(white − black), g(t) = t^(1/γ) on [0, 1], continued with slope 1 beyond (nothing clipped).
// A channel: L acts on OkLab L of an OkLab pixel; R, G, B on the cube root of that channel of a linear RGB pixel.

/** A point curve: x, y and the Hermite tangent m at every point. */
export interface ToneCurve { readonly x: Float64Array; readonly y: Float64Array; readonly m: Float64Array }

/** The monotone cubic through `points` (x strictly increasing; at least two). */
export function toneCurve(points: readonly { x: number; y: number }[]): ToneCurve {
  const n = points.length;
  const x = Float64Array.from(points, (p) => p.x), y = Float64Array.from(points, (p) => p.y);
  const m = new Float64Array(n);
  const h = new Float64Array(n - 1), d = new Float64Array(n - 1);
  for (let k = 0; k < n - 1; k++) {
    h[k] = x[k + 1]! - x[k]!;
    d[k] = (y[k + 1]! - y[k]!) / h[k]!;
  }
  if (n === 2) {
    m[0] = m[1] = d[0]!;
    return { x, y, m };
  }
  for (let k = 1; k < n - 1; k++) {
    const a = d[k - 1]!, b = d[k]!;
    if (a * b <= 0) m[k] = 0;
    else {
      const w1 = 2 * h[k]! + h[k - 1]!, w2 = h[k]! + 2 * h[k - 1]!;
      m[k] = (w1 + w2) / (w1 / a + w2 / b);
    }
  }
  m[0] = endTangent(h[0]!, h[1]!, d[0]!, d[1]!);
  m[n - 1] = endTangent(h[n - 2]!, h[n - 3]!, d[n - 2]!, d[n - 3]!);
  return { x, y, m };
}

/** The three-point end tangent, kept monotone (scipy _edge_case). */
function endTangent(h0: number, h1: number, d0: number, d1: number): number {
  const t = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(t) !== Math.sign(d0)) return 0;
  if (Math.sign(d0) !== Math.sign(d1) && Math.abs(t) > Math.abs(3 * d0)) return 3 * d0;
  return t;
}

/** The curve at v (linear beyond the ends, along the end tangents). */
export function evalCurve(c: ToneCurve, v: number): number {
  const { x, y, m } = c;
  const n = x.length;
  if (v <= x[0]!) return y[0]! + m[0]! * (v - x[0]!);
  if (v >= x[n - 1]!) return y[n - 1]! + m[n - 1]! * (v - x[n - 1]!);
  let k = 0;
  while (k < n - 2 && v > x[k + 1]!) k++;
  const h = x[k + 1]! - x[k]!;
  const t = (v - x[k]!) / h;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y[k]! + (t3 - 2 * t2 + t) * h * m[k]! + (-2 * t3 + 3 * t2) * y[k + 1]! + (t3 - t2) * h * m[k + 1]!;
}

export interface Levels { black: number; white: number; gamma: number; outBlack: number; outWhite: number }

/** Levels at v. */
export function evalLevels(l: Levels, v: number): number {
  const t = (v - l.black) / (l.white - l.black);
  const g = t <= 0 ? t : t >= 1 ? t : t ** (1 / l.gamma);
  return l.outBlack + (l.outWhite - l.outBlack) * g;
}

/** The channel a tone layer acts on: 0 = L of OkLab, 1–3 = R, G, B of linear RGB (on their cube roots). */
export const channelIndex = (ch: unknown): number => ['L', 'R', 'G', 'B'].indexOf(ch as string);

/** Applies a tone function to one pixel (in place): L on OkLab, a channel's lightness ∛c on linear RGB. */
export function toneAt(px: Float64Array | number[], channel: number, f: (v: number) => number): void {
  if (channel === 0) px[0] = f(px[0]!);
  else {
    const k = channel - 1;
    px[k] = f(Math.cbrt(px[k]!)) ** 3;
  }
}
