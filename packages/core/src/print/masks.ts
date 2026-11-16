// Mask rasterisation (CHB-010 guide §6.5 "Masks"; contract 1.0 mask components, design §25). A mask is a
// one-channel image in 0..1 in document pixels (DR-3). Masks are vector values (Document.masks, compiled to mask.*
// nodes), rasterised on demand on the evaluation grid, so preview and export agree. The algebra that folds
// components (add = max, subtract = v·(1 − c), intersect = v·c) is the contract's maskCombine (pixel.ts).
//
// The grid: output pixel p of a w × h result covers the frame region `region`; it reads frame pixel
// fp = region.x + ⌊(p + ½)·region.w / w⌋ (the engines' nearest-sample rule) and coordinate-based masks
// are evaluated at that pixel's centre, fp + ½. At full resolution the grid is the frame itself.
// packages/gpu evaluates the same formulas in WGSL (pointwise.wgsl ops 12–15) and uploads paintMask.
import { gridAxis, maskCombine, type Box, type Point } from '@chromobench/contract';

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
export interface Stroke { points: readonly (readonly [number, number, number])[]; radius: number; hardness: number; mode: 'add' | 'erase'; flow?: number }

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
 * strokes with 0.5). Strokes apply in order with the one mask algebra at the stroke's flow: at flow 1 `add` takes the
 * maximum and `erase` multiplies by 1 − coverage; below 1 a stroke moves the mask that far towards it (strokes build up).
 */
export function paintMask(strokes: readonly Stroke[], g: MaskGrid): Float64Array {
  const out = new Float64Array(g.w * g.h);
  const { xs, ys } = gridCentres(g);
  const sx = g.region.w / g.w, sy = g.region.h / g.h;
  const cov = new Float64Array(g.w * g.h);
  for (const s of strokes) {
    if (s.points.length === 0) continue;
    const flow = s.flow ?? 1;
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
        // the one algebra at the stroke's flow (contract 1.6): at 1, add is the maximum and erase v·(1 − c)
        out[k] = maskCombine(s.mode === 'add' ? 'add' : 'subtract', out[k]!, cov[k]!, flow);
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

// ---- selections (contract 1.6, CHB-049; decision D3: selections are mask components) ------------------------------

/**
 * mask.rect: the rectangular marquee. 1 inside the box rotated by `angle_deg` about its centre, 0 outside, the edge
 * antialiased over one pixel as the ellipse's: clamp(½ − d), d = max(|u| − w/2, |v| − h/2) in document px.
 */
export function rectAt(X: number, Y: number, box: Box, angle_deg: number): number {
  const t = (angle_deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  const dx = X - (box.x + box.w / 2), dy = Y - (box.y + box.h / 2);
  const u = c * dx + s * dy;
  const v = -s * dx + c * dy;
  return clamp01(0.5 - Math.max(Math.abs(u) - box.w / 2, Math.abs(v) - box.h / 2));
}

/**
 * mask.polygon: the lassos. A pixel centre is inside by the even-odd rule (crossings of the row through it); within
 * half a document pixel of the outline the coverage is ½ ± the distance to it (+ inside), so the edge is antialiased
 * over one pixel. Rasterised on the grid (rows filled between crossings, then the edge pixels of each segment), as
 * paintMask; the GPU uploads this result.
 */
export function polygonMask(points: readonly (readonly number[])[], g: MaskGrid): Float64Array {
  const out = new Float64Array(g.w * g.h);
  const n = points.length;
  if (n < 3) return out;
  const { xs, ys } = gridCentres(g);
  const inside = new Uint8Array(g.w * g.h);
  const cross: number[] = [];
  for (let q = 0; q < g.h; q++) {
    const Y = ys[q]!;
    cross.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = points[i]![0]!, yi = points[i]![1]!, xj = points[j]![0]!, yj = points[j]![1]!;
      if ((yi > Y) !== (yj > Y)) cross.push(xi + ((Y - yi) * (xj - xi)) / (yj - yi));
    }
    if (cross.length < 2) continue;
    cross.sort((a, b) => a - b);
    // inside ⇔ an odd number of crossings at or left of X ⇔ X in [c₂ₖ, c₂ₖ₊₁)
    let k = 0;
    for (let p = 0; p < g.w; p++) {
      const X = xs[p]!;
      while (k < cross.length && cross[k]! <= X) k++;
      if (k % 2 === 1) {
        inside[q * g.w + p] = 1;
        out[q * g.w + p] = 1;
      }
    }
  }
  // the edge: the distance to the nearest segment for pixel centres within ½ px of the outline
  const sx = g.region.w / g.w, sy = g.region.h / g.h;
  const near = new Map<number, number>();
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = points[j]![0]!, ay = points[j]![1]!, bx = points[i]![0]!, by = points[i]![1]!;
    const p0 = Math.max(0, Math.floor((Math.min(ax, bx) - 0.5 - g.region.x) / sx) - 1), p1 = Math.min(g.w - 1, Math.ceil((Math.max(ax, bx) + 0.5 - g.region.x) / sx) + 1);
    const q0 = Math.max(0, Math.floor((Math.min(ay, by) - 0.5 - g.region.y) / sy) - 1), q1 = Math.min(g.h - 1, Math.ceil((Math.max(ay, by) + 0.5 - g.region.y) / sy) + 1);
    for (let q = q0; q <= q1; q++) {
      for (let p = p0; p <= p1; p++) {
        const d = segDist(xs[p]!, ys[q]!, ax, ay, bx, by);
        if (d >= 0.5) continue;
        const k = q * g.w + p;
        const was = near.get(k);
        if (was === undefined || d < was) near.set(k, d);
      }
    }
  }
  for (const [k, d] of near) out[k] = clamp01(0.5 + (inside[k] ? d : -d));
  return out;
}

/** The magic wand's settings (mask.wand), with the receiver's domain range [lo, hi]. */
export interface WandSettings { tolerance: number; softness: number; contiguous: boolean; lo: number; hi: number }

/**
 * The wand's coverage of one pixel: 1 − smoothstep(tolerance, tolerance + softness, d), d the largest difference over
 * the first three channels from the seed's value, as a fraction of the domain's range (a step at softness 0).
 */
export function wandAt(v: ArrayLike<number>, at: number, c: number, seed: ArrayLike<number>, w: WandSettings): number {
  const span = w.hi - w.lo || 1;
  let d = 0;
  for (let k = 0; k < Math.min(3, c); k++) d = Math.max(d, Math.abs(v[at + k]! - seed[k]!));
  d /= span;
  if (d <= w.tolerance) return 1;
  if (!(w.softness > 0)) return 0;
  const u = Math.min(1, (d - w.tolerance) / w.softness);
  return 1 - u * u * (3 - 2 * u);
}

/**
 * Contiguous: keeps the coverage only where a pixel is 4-connected to the seed's pixel through pixels with coverage
 * above 0, sets it to 0 elsewhere (in place). The seed's own pixel always has coverage 1.
 */
export function wandFlood(cov: Float64Array | Float32Array, w: number, h: number, seed: number): void {
  const keep = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  if (seed < 0 || seed >= w * h || !(cov[seed]! > 0)) {
    cov.fill(0);
    return;
  }
  keep[seed] = 1;
  stack[top++] = seed;
  while (top) {
    const i = stack[--top]!;
    const x = i % w;
    const visit = (j: number): void => {
      if (!keep[j] && cov[j]! > 0) {
        keep[j] = 1;
        stack[top++] = j;
      }
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < w * (h - 1)) visit(i + w);
  }
  for (let i = 0; i < w * h; i++) if (!keep[i]) cov[i] = 0;
}

/** The grid pixel (column or row) whose cell holds document coordinate x on an n-pixel grid over (origin, span). */
export const wandSeedPixel = (x: number, origin: number, span: number, n: number): number => Math.min(n - 1, Math.max(0, Math.floor(((x - origin) * n) / span)));

/** mask.wand on an image of c channels (w × h), the seed at grid pixel (px, py). */
export function wandMask(data: ArrayLike<number>, w: number, h: number, c: number, px: number, py: number, s: WandSettings): Float64Array {
  const at = (py * w + px) * c;
  const seed = [0, 1, 2].map((k) => data[at + Math.min(k, c - 1)]!);
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = wandAt(data, i * c, c, seed, s);
  if (s.contiguous) wandFlood(out, w, h, py * w + px);
  return out;
}

/**
 * mask.grow's structuring element for radius r (px): the regular octagon closest to the disc, a square of half-side
 * s = round(|r|(√2 − 1)) and two diagonal segments of half-length a = round(|r|(1 − √2/2)); grow takes the maximum,
 * contract (r < 0) the minimum. Its reach along an axis is s + 2a.
 */
export function growPlan(r: number): { s: number; a: number; grow: boolean; reach: number } {
  const R = Math.abs(r);
  const s = Math.round(R * (Math.SQRT2 - 1)), a = Math.round(R * (1 - Math.SQRT1_2));
  return { s, a, grow: r >= 0, reach: s + 2 * a };
}

/** The four one-dimensional passes of mask.grow (rows, columns, the diagonal, the anti-diagonal) and their half-lengths. */
export const growPasses = (r: number): [number, number, number][] => {
  const { s, a } = growPlan(r);
  return ([[1, 0, s], [0, 1, s], [1, 1, a], [1, -1, a]] as [number, number, number][]).filter((x) => x[2] > 0);
};

/** mask.grow on a one-channel w × h image: max (grow) or min (contract) over the octagon; pixels outside are left out. */
export function growMask(src: Float64Array, w: number, h: number, radius: number): Float64Array {
  const grow = radius >= 0;
  let cur = src;
  for (const [dx, dy, L] of growPasses(radius)) {
    const out = new Float64Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = cur[y * w + x]!;
        for (let i = -L; i <= L; i++) {
          const X = x + i * dx, Y = y + i * dy;
          if (X < 0 || X >= w || Y < 0 || Y >= h) continue;
          const u = cur[Y * w + X]!;
          v = grow ? (u > v ? u : v) : (u < v ? u : v);
        }
        out[y * w + x] = v;
      }
    }
    cur = out;
  }
  return cur === src ? Float64Array.from(src) : cur;
}
