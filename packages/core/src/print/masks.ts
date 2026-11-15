// Mask rasterisation (CHB-010 guide §6.5 "Masks"; contract 1.0 mask components, design §25). A mask is a
// one-channel image in 0..1 in document pixels (DR-3). Masks are vector values (Document.masks, compiled to mask.*
// nodes), rasterised on demand on the evaluation grid, so preview and export agree. The algebra that folds
// components (add = max, subtract = v·(1 − c), intersect = v·c) is the contract's maskCombine (pixel.ts).
//
// The grid: output pixel p of a w × h result covers the frame region `region`; it reads frame pixel
// fp = region.x + ⌊(p + ½)·region.w / w⌋ (the engines' nearest-sample rule) and coordinate-based masks
// are evaluated at that pixel's centre, fp + ½. At full resolution the grid is the frame itself.
// packages/gpu evaluates the same formulas in WGSL (pointwise.wgsl ops 12–15) and uploads paintMask.
import { gridAxis, type Box, type Point } from '@chromobench/contract';

export interface MaskGrid { w: number; h: number; region: Box }

/** The full-resolution grid of a w × h frame. */
export const fullGrid = (w: number, h: number): MaskGrid => ({ w, h, region: { x: 0, y: 0, w, h } });

/** Frame pixel centres of the grid's columns and rows (fp + ½, fp by the contract's grid rule). */
export function gridCentres(g: MaskGrid): { xs: Float64Array; ys: Float64Array } {
  const xs = Float64Array.from(gridAxis(g.region.x, g.region.w, g.w), (v) => v + 0.5);
  const ys = Float64Array.from(gridAxis(g.region.y, g.region.h, g.h), (v) => v + 0.5);
  return { xs, ys };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** mask.linear: 1 at `from`, 0 at `to`, linear between, constant beyond (a graduated burn). */
export function linearAt(X: number, Y: number, from: Point, to: Point): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 1;
  return clamp01(1 - ((X - from.x) * dx + (Y - from.y) * dy) / len2);
}

/**
 * Ellipse inscribed in `box` (source px), rotated by `angle_deg` about the box centre. The edge is
 * antialiased over one pixel: m = clamp(½ − (ρ − 1)/|∇ρ|), ρ the normalised radius, so f32 and f64
 * agree to rounding at the edge (a hard step would flip whole pixels). Wider edges: mask.feather.
 */
export function ellipseAt(X: number, Y: number, box: Box, angle_deg: number): number {
  const t = (angle_deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  const a = Math.max(box.w / 2, 1e-9), b = Math.max(box.h / 2, 1e-9);
  const dx = X - (box.x + box.w / 2), dy = Y - (box.y + box.h / 2);
  const u = (c * dx + s * dy) / a;
  const v = (-s * dx + c * dy) / b;
  const rho = Math.hypot(u, v);
  if (rho < 1e-6) return 1;
  const gx = (u * c / a - v * s / b) / rho;
  const gy = (u * s / a + v * c / b) / rho;
  return clamp01(0.5 - (rho - 1) / Math.max(Math.hypot(gx, gy), 1e-12));
}

/**
 * mask.radial (contract 1.1): 1 inside the ellipse of `box` scaled by 1 − feather, a smoothstep to 0 at the box's
 * ellipse (Editor lab's radial component, src/engine.js:576–579, in document px).
 */
export function radialAt(X: number, Y: number, box: Box, angle_deg: number, feather: number): number {
  const t = (angle_deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  const a = Math.max(box.w / 2, 1e-9), b = Math.max(box.h / 2, 1e-9);
  const dx = X - (box.x + box.w / 2), dy = Y - (box.y + box.h / 2);
  const d = Math.hypot((c * dx + s * dy) / a, (-s * dx + c * dy) / b);
  const inner = 1 - feather;
  if (d <= inner) return 1;
  const u = Math.min(1, (d - inner) / Math.max(1e-4, feather));
  return 1 - u * u * (3 - 2 * u);
}

/** mask.colour (contract 1.1): 1 − smoothstep(tol, tol + soft, ΔE) of an OkLab pixel from the sample (a step at soft 0). */
export function colourAt(lab: ArrayLike<number>, ref: ArrayLike<number>, tolerance: number, softness: number): number {
  const d = Math.hypot(lab[0]! - ref[0]!, lab[1]! - ref[1]!, lab[2]! - ref[2]!);
  if (d <= tolerance) return 1;
  if (!(softness > 0)) return 0;
  const u = Math.min(1, (d - tolerance) / softness);
  return 1 - u * u * (3 - 2 * u);
}

// ---- painted masks (mask.paint.strokes: structured, contract 1.0) ---------------------------------

/** One brush stroke as mask.paint's bound `strokes` items hold it (points [x, y, pressure] in document px). */
export interface Stroke { points: readonly (readonly [number, number, number])[]; radius: number; hardness: number; mode: 'add' | 'erase' }

/** Distance from (X, Y) to the segment a–b. */
function segDist(X: number, Y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((X - ax) * dx + (Y - ay) * dy) / l2)) : 0;
  return Math.hypot(X - ax - t * dx, Y - ay - t * dy);
}

/**
 * The coverage of one round brush at distance d from the stroke's path: 1 inside hardness·radius,
 * smoothstep down to 0 at the radius (the soft edge is at least one pixel wide).
 */
export function brushCoverage(d: number, radius: number, hardness: number): number {
  const w = Math.max((1 - hardness) * radius, 1);
  const t = clamp01((radius - d) / w);
  return t * t * (3 - 2 * t);
}

/**
 * Rasterises strokes on the grid. A stroke is a continuous run of round dabs along its polyline (the
 * distance to the path, so the result does not depend on the dab spacing or on the RDP
 * simplification); pressure is recorded but does not modulate the brush (the studio fills mouse
 * strokes with 0.5). Strokes apply in order: `add` takes the maximum, `erase` multiplies by 1 − coverage.
 */
export function paintMask(strokes: readonly Stroke[], g: MaskGrid): Float64Array {
  const out = new Float64Array(g.w * g.h);
  const { xs, ys } = gridCentres(g);
  const sx = g.region.w / g.w, sy = g.region.h / g.h;
  const cov = new Float64Array(g.w * g.h);
  for (const s of strokes) {
    if (s.points.length === 0) continue;
    cov.fill(0);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const nSeg = Math.max(1, s.points.length - 1);
    for (let i = 0; i < nSeg; i++) {
      const a = s.points[i]!;
      const b = s.points[Math.min(i + 1, s.points.length - 1)]!;
      // output pixels whose centres can lie within the radius of this segment
      const bx0 = Math.min(a[0], b[0]) - s.radius, bx1 = Math.max(a[0], b[0]) + s.radius;
      const by0 = Math.min(a[1], b[1]) - s.radius, by1 = Math.max(a[1], b[1]) + s.radius;
      const p0 = Math.max(0, Math.floor((bx0 - g.region.x) / sx) - 1), p1 = Math.min(g.w - 1, Math.ceil((bx1 - g.region.x) / sx) + 1);
      const q0 = Math.max(0, Math.floor((by0 - g.region.y) / sy) - 1), q1 = Math.min(g.h - 1, Math.ceil((by1 - g.region.y) / sy) + 1);
      for (let q = q0; q <= q1; q++) {
        for (let p = p0; p <= p1; p++) {
          const c = brushCoverage(segDist(xs[p]!, ys[q]!, a[0], a[1], b[0], b[1]), s.radius, s.hardness);
          const k = q * g.w + p;
          if (c > cov[k]!) cov[k] = c;
        }
      }
      x0 = Math.min(x0, p0); x1 = Math.max(x1, p1); y0 = Math.min(y0, q0); y1 = Math.max(y1, q1);
    }
    for (let q = Math.max(0, y0); q <= Math.min(g.h - 1, y1); q++) {
      for (let p = Math.max(0, x0); p <= Math.min(g.w - 1, x1); p++) {
        const k = q * g.w + p;
        out[k] = s.mode === 'add' ? Math.max(out[k]!, cov[k]!) : out[k]! * (1 - cov[k]!);
      }
    }
  }
  return out;
}

// ---- value masks and algebra --------------------------------------------------------------------

/**
 * mask.luminance on one pixel: L = the mean of the first three channels, normalised to the domain's
 * range; selects above ≤ L ≤ below with a linear transition of width `softness`. `above` ≤ 0 means no
 * lower bound and `below` ≥ 1 no upper bound, so values outside the domain's nominal range are kept
 * (compile's "whole frame" mask for an unmasked exposure is above 0, below 1, softness 0).
 */
export function luminanceAt(L: number, above: number, below: number, softness: number): number {
  const s = Math.max(softness, 1e-9);
  const up = above <= 0 ? 1 : clamp01((L - above) / s + 0.5);
  const down = below >= 1 ? 1 : clamp01((below - L) / s + 0.5);
  return Math.min(up, down);
}

/** Gaussian taps truncated at ⌈3σ⌉ and normalised (packages/gpu spatial.ts gaussianWeights, one channel). */
export function gaussianTaps(sigma: number): Float64Array {
  if (!(sigma > 0)) return Float64Array.of(1);
  const R = Math.ceil(3 * sigma);
  const w = new Float64Array(R + 1);
  let sum = 0;
  for (let i = 0; i <= R; i++) {
    w[i] = Math.exp(-0.5 * (i / sigma) ** 2);
    sum += i ? 2 * w[i]! : w[i]!;
  }
  for (let i = 0; i <= R; i++) w[i]! /= sum;
  return w;
}

/** Separable Gaussian blur of a one-channel w × h image, clamp-to-edge (σ in pixels). */
export function gaussianBlur1(src: Float64Array, w: number, h: number, sigma: number): Float64Array {
  const taps = gaussianTaps(sigma);
  const R = taps.length - 1;
  if (R === 0) return Float64Array.from(src);
  const mid = new Float64Array(w * h);
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = src[y * w + x]! * taps[0]!;
      for (let i = 1; i <= R; i++) acc += (src[y * w + Math.min(w - 1, x + i)]! + src[y * w + Math.max(0, x - i)]!) * taps[i]!;
      mid[y * w + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = mid[y * w + x]! * taps[0]!;
      for (let i = 1; i <= R; i++) acc += (mid[Math.min(h - 1, y + i) * w + x]! + mid[Math.max(0, y - i) * w + x]!) * taps[i]!;
      out[y * w + x] = acc;
    }
  }
  return out;
}

/** mask.feather's Gaussian σ in source px: radius_px = 2σ (the 10–90 % edge is 1.28 × radius wide). */
export const featherSigma = (radius_px: number): number => radius_px / 2;
