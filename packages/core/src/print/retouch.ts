// retouch.heal (CHB-022 guide §7): circular heal and clone spots on the print (print-xyz), the f64 reference.
// The GPU (packages/gpu kernels/retouch.wgsl) runs the same per-pixel formula on f32 and takes the per-spot
// seam coefficients from healCoefficients() below, so both engines share every number that is not per pixel.
//
// Per spot, at full-resolution pixel centres p (sensor px of the un-oriented source):
//   d = p − target, q = source + d                      (the source disc is the target disc moved)
//   alpha = opacity · (1 − smoothstep(r(1 − feather), r, |d|))
//   clone:  patch = S(q)                                (S: bilinear in the receiver, pixel-centre convention)
//   heal:   patch = S(q) · exp(u(d))                    per channel
//   out     = mix(out, patch, alpha)                    spots in id order (natural sort); a later one covers
//
// u is the seam correction: the harmonic function on the disc whose boundary values are the log ratio of the
// target's surroundings to the source's, f(θ) = log T(target + ρ e_θ) − log S(source + ρ e_θ), averaged over
// three rings ρ = r + ½, r + 1½, r + 2½. Instead of an iterative Laplace solve (CHB-006's harmonic() on a
// pixel grid), the disc's exact solution is used: the Poisson integral, i.e. the boundary's Fourier series
// damped by (|d| / R)^n, R = r + 1½, with M harmonics and Lanczos σ-factors against ringing. It is closed
// form, so the result does not depend on tiles, the order of evaluation or the engine; the multiplicative
// (log XYZ) offset keeps the source's texture and matches brightness and colour (guide §7.2). Near paper
// black XYZ stays positive (a print's Y is ≥ ~0.003), and values are floored at EPS before the log.
//
// Every spot reads the receiver (the image before retouching), never another spot's result (guide §6.2).
import type { RetouchSpot } from '@chromobench/contract';

/** Angles on the ring. */
export const HEAL_N = 32;
/** Harmonics of the seam correction (n = 0 … M). */
export const HEAL_M = 8;
/** Ring radii beyond r (sensor px). */
export const HEAL_RINGS: readonly number[] = [0.5, 1.5, 2.5];
/** Radius at which (|d| / R)^n is 1. */
export const HEAL_R_OFFSET = 1.5;
const EPS = 1e-6;
/** Pixels a spot's window extends beyond r (rings, bilinear neighbour, margin). */
export const HEAL_WINDOW_MARGIN = 4;

export interface Spot extends RetouchSpot { id: string }

/** Natural order of spot ids (s2 before s10), the order spots are composited in. */
export function spotOrder(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

/** The enabled spots of retouch.heal's `spots` argument (canonical JSON of the record), in composite order. */
export function parseSpots(json: string | undefined | null): Spot[] {
  const rec = JSON.parse(json || '{}') as Record<string, RetouchSpot>;
  return Object.entries(rec)
    .filter(([, s]) => s && s.enabled !== false && s.r > 0 && s.opacity > 0)
    .sort(([a], [b]) => spotOrder(a, b))
    .map(([id, s]) => ({ ...s, id }));
}

/** A sampler of integer pixel coordinates inside the frame (the caller's image, any layout). */
export type PixelAt = (x: number, y: number, k: number) => number;

/** Bilinear sample of channel k at a continuous position (pixel centres at i + ½), clamped to the frame. */
export function bilinearAt(at: PixelAt, W: number, H: number, x: number, y: number, k: number): number {
  const fx = Math.min(W - 0.5, Math.max(0.5, x)) - 0.5, fy = Math.min(H - 0.5, Math.max(0.5, y)) - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  return (1 - ty) * ((1 - tx) * at(x0, y0, k) + tx * at(x1, y0, k)) + ty * ((1 - tx) * at(x0, y1, k) + tx * at(x1, y1, k));
}

/** 1 inside r(1 − feather), 0 from r on, a smoothstep between; times opacity. */
export function spotAlpha(dist: number, r: number, feather: number, opacity: number): number {
  const inner = r * (1 - feather);
  if (dist >= r) return 0;
  if (dist <= inner) return opacity;
  const t = (dist - inner) / (r - inner);
  return opacity * (1 - t * t * (3 - 2 * t));
}

/**
 * The seam correction's coefficients for `channels` channels: for n = 0 … M, a_n then b_n, each a
 * `channels`-vector (b_0 = 0), already multiplied by the Lanczos σ-factor and with a_0 halved.
 * Layout: c[(2n + j) · channels + k], j = 0 (cos) or 1 (sin).
 */
export function healCoefficients(at: PixelAt, W: number, H: number, spot: Pick<RetouchSpot, 'x' | 'y' | 'r' | 'src'>, channels: number): Float64Array {
  const N = HEAL_N, M = HEAL_M;
  const f = new Float64Array(N * channels);
  for (let i = 0; i < N; i++) {
    const th = (2 * Math.PI * i) / N;
    const cx = Math.cos(th), sy = Math.sin(th);
    for (let k = 0; k < channels; k++) {
      let s = 0;
      for (const dr of HEAL_RINGS) {
        const rho = spot.r + dr;
        const t = bilinearAt(at, W, H, spot.x + rho * cx, spot.y + rho * sy, k);
        const q = bilinearAt(at, W, H, spot.src.x + rho * cx, spot.src.y + rho * sy, k);
        s += Math.log(Math.max(t, EPS)) - Math.log(Math.max(q, EPS));
      }
      f[i * channels + k] = s / HEAL_RINGS.length;
    }
  }
  const c = new Float64Array(2 * (M + 1) * channels);
  for (let n = 0; n <= M; n++) {
    // Lanczos σ-factor sinc(n / (M + 1)): the truncated series without Gibbs overshoot at sharp seams
    const sig = n === 0 ? 1 : Math.sin((Math.PI * n) / (M + 1)) / ((Math.PI * n) / (M + 1));
    for (let k = 0; k < channels; k++) {
      let a = 0, b = 0;
      for (let i = 0; i < N; i++) {
        const th = (2 * Math.PI * i * n) / N;
        a += f[i * channels + k]! * Math.cos(th);
        b += f[i * channels + k]! * Math.sin(th);
      }
      c[2 * n * channels + k] = (n === 0 ? 1 / N : (2 / N) * sig) * a;
      c[(2 * n + 1) * channels + k] = n === 0 ? 0 : (2 / N) * sig * b;
    }
  }
  return c;
}

/** u(d) for channel k: Σ_n (|d| / R)^n (a_n cos nφ + b_n sin nφ), by the angle-addition recurrence (as the WGSL). */
export function healOffset(c: ArrayLike<number>, channels: number, k: number, dx: number, dy: number, r: number): number {
  const R = r + HEAL_R_OFFSET;
  const rho = Math.hypot(dx, dy);
  let u = c[k]!;
  if (rho <= 0) return u;
  const t = Math.min(rho / R, 1);
  const c1 = dx / rho, s1 = dy / rho;
  let cn = c1, sn = s1, tn = t;
  for (let n = 1; n <= HEAL_M; n++) {
    u += tn * (c[2 * n * channels + k]! * cn + c[(2 * n + 1) * channels + k]! * sn);
    const cn1 = cn * c1 - sn * s1;
    sn = sn * c1 + cn * s1;
    cn = cn1;
    tn *= t;
  }
  return u;
}

/** The sensor-pixel box a spot changes (its target disc), clamped to the frame; null when outside. */
export function spotBox(s: Pick<RetouchSpot, 'x' | 'y' | 'r'>, W: number, H: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const x0 = Math.max(0, Math.floor(s.x - s.r)), y0 = Math.max(0, Math.floor(s.y - s.r));
  const x1 = Math.min(W, Math.ceil(s.x + s.r)), y1 = Math.min(H, Math.ceil(s.y + s.r));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

/** The window of the receiver a spot reads around a centre (source or target), clamped to the frame. */
export function spotWindow(cx: number, cy: number, r: number, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const m = r + HEAL_WINDOW_MARGIN;
  const x0 = Math.max(0, Math.floor(cx - m)), y0 = Math.max(0, Math.floor(cy - m));
  const x1 = Math.min(W, Math.ceil(cx + m) + 1), y1 = Math.min(H, Math.ceil(cy + m) + 1);
  return { x: Math.min(x0, W - 1), y: Math.min(y0, H - 1), w: Math.max(1, x1 - Math.min(x0, W - 1)), h: Math.max(1, y1 - Math.min(y0, H - 1)) };
}

/**
 * Heals and clones `spots` on an interleaved c-channel image (W × H, the whole frame). Returns a new array;
 * `src` is not modified. Channels beyond the first three are cloned without the seam gain.
 */
export function retouch(src: Float64Array, W: number, H: number, c: number, spots: readonly Spot[]): Float64Array {
  const out = src.slice();
  const at: PixelAt = (x, y, k) => src[(y * W + x) * c + k]!;
  const nc = Math.min(3, c);
  for (const s of spots) {
    const box = spotBox(s, W, H);
    if (!box) continue;
    const coef = s.mode === 'heal' ? healCoefficients(at, W, H, s, nc) : null;
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        const dx = x + 0.5 - s.x, dy = y + 0.5 - s.y;
        const a = spotAlpha(Math.hypot(dx, dy), s.r, s.feather, s.opacity);
        if (a <= 0) continue;
        const qx = s.src.x + dx, qy = s.src.y + dy;
        const o = (y * W + x) * c;
        for (let k = 0; k < c; k++) {
          let p = bilinearAt(at, W, H, qx, qy, k);
          if (coef && k < nc) p *= Math.exp(healOffset(coef, nc, k, dx, dy, s.r));
          out[o + k] = (1 - a) * out[o + k]! + a * p;
        }
      }
    }
  }
  return out;
}
