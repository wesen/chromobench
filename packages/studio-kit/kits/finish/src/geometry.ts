// The finish kit's geometry (CHB-022 guide §4, §5.3–5.4): PURE — no DOM, no shell, no engine — so the agent's
// DSL can bind it as geom.* and the crop tool and agent code compute the same boxes.
//
// Units and conventions are the contract's (0.3, packages/contract/src/frame.ts):
//   - view.frame.crop is a box in sensor px of the un-oriented frame (W × H); null is the whole frame.
//   - output.frame cuts the box out with its content turned by angle_deg about the box centre, then orients.
//     angle_deg is clockwise as shown (after the orientation); output pixel (i, j) samples the frame at
//     centre + R(θ)(i + ½ − w/2, j + ½ − h/2), θ = −sign(orientation)·angle (sensorAngleSign).
//   - So on the un-straightened frame the region a crop reads is the box turned by θ about its centre; a crop
//     is valid when all four corners of that quadrilateral lie inside the frame (nothing empty is shown).
//   - Spots (retouch.spots, scan.dust.spots) are sensor px of the un-oriented source: a crop never moves them.
import { sensorAngleSign, type Box, type FrameSettings, type Orientation } from '@chromobench/contract';

export interface Pt { x: number; y: number }
export interface Size { w: number; h: number }

const RAD = Math.PI / 180;

/** Orientations whose output swaps width and height. */
export const swapsAxes = (o: Orientation | string): boolean => o === 'cw90' || o === 'ccw90' || o === 'transpose' || o === 'transverse';

/** A continuous point of the un-oriented w × h image → the oriented image (the mock's and host's orient()). */
export function orientPoint(o: Orientation | string, w: number, h: number, x: number, y: number): Pt {
  switch (o) {
    case 'cw90': return { x: h - y, y: x };
    case 'ccw90': return { x: y, y: w - x };
    case 'rot180': return { x: w - x, y: h - y };
    case 'flipH': return { x: w - x, y };
    case 'flipV': return { x, y: h - y };
    case 'transpose': return { x: y, y: x };
    case 'transverse': return { x: h - y, y: w - x };
    default: return { x, y };
  }
}
/** The inverse of orientPoint: a point of the oriented image → the un-oriented w × h image. */
export function unorientPoint(o: Orientation | string, w: number, h: number, X: number, Y: number): Pt {
  switch (o) {
    case 'cw90': return { x: Y, y: h - X };
    case 'ccw90': return { x: w - Y, y: X };
    case 'rot180': return { x: w - X, y: h - Y };
    case 'flipH': return { x: w - X, y: Y };
    case 'flipV': return { x: X, y: h - Y };
    case 'transpose': return { x: Y, y: X };
    case 'transverse': return { x: w - Y, y: h - X };
    default: return { x: X, y: Y };
  }
}

/** Rotates a vector by deg (y down: positive is clockwise on screen). */
export function rotate(p: Pt, deg: number): Pt {
  const t = deg * RAD, c = Math.cos(t), s = Math.sin(t);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** θ (degrees, sensor frame) by which a crop's sampled region is turned: −sign(orientation)·angle. */
export const sensorTurn = (f: Pick<FrameSettings, 'angle_deg' | 'orientation'>): number => -sensorAngleSign(f.orientation) * f.angle_deg;

export const fullBox = (W: number, H: number): Box => ({ x: 0, y: 0, w: W, h: H });
export const cropOf = (f: Pick<FrameSettings, 'crop'>, W: number, H: number): Box => f.crop ?? fullBox(W, H);
export const centreOf = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** The four corners (sensor px) of the region a crop reads: the box turned by θ about its centre. */
export function cropCorners(box: Box, thetaDeg: number): Pt[] {
  const c = centreOf(box);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const v = rotate({ x: (sx! * box.w) / 2, y: (sy! * box.h) / 2 }, thetaDeg);
    return { x: c.x + v.x, y: c.y + v.y };
  });
}

/** Every corner of the turned box inside [0, W] × [0, H] (within eps px). */
export function fitsInside(box: Box, thetaDeg: number, W: number, H: number, eps = 1e-6): boolean {
  if (!(box.w > 0 && box.h > 0)) return false;
  return cropCorners(box, thetaDeg).every((p) => p.x >= -eps && p.y >= -eps && p.x <= W + eps && p.y <= H + eps);
}
/** The frame's crop is valid: its turned box lies inside the frame. */
export const frameValid = (f: FrameSettings, W: number, H: number): boolean => fitsInside(cropOf(f, W, H), sensorTurn(f), W, H);

/** The largest h of a box with sensor aspect ρ = w/h, centred at c, turned by θ, inside W × H. */
export function largestHeight(c: Pt, rho: number, thetaDeg: number, W: number, H: number): number {
  const t = Math.abs(thetaDeg) * RAD, cs = Math.cos(t), sn = Math.sin(t);
  const mx = Math.min(c.x, W - c.x), my = Math.min(c.y, H - c.y);
  if (mx <= 0 || my <= 0) return 0;
  // half extents of the turned box: ((w|cos| + h|sin|)/2, (w|sin| + h|cos|)/2) with w = ρh
  return Math.min((2 * mx) / (rho * cs + sn), (2 * my) / (rho * sn + cs));
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** An aspect: a preset name, 'w:h', [w, h] or a number (shown w/h). 'original' is the frame's; 'free' is null. */
export type Aspect = string | number | readonly [number, number] | null;
export const ASPECTS: readonly string[] = ['original', 'free', '1:1', '4:5', '5:7', '2:3', '3:2', '16:9', '8:10', '11:14'];

/** [p, q] integers (shown w:h), or null for free. 'original' is the frame's shown aspect. */
export function parseAspect(a: Aspect, W: number, H: number, o: Orientation | string = 'none'): [number, number] | null {
  if (a === null || a === 'free') return null;
  if (a === 'original') {
    const [w, h] = swapsAxes(o) ? [H, W] : [W, H];
    const g = gcd(w, h) || 1;
    return [w / g, h / g];
  }
  if (typeof a === 'number') return a > 0 ? [a, 1] : null;
  if (Array.isArray(a)) return a[0] > 0 && a[1] > 0 ? [a[0], a[1]] : null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)\s*$/.exec(String(a));
  if (!m) throw new Error(`unknown aspect "${String(a)}"; use one of ${ASPECTS.join(', ')} or 'w:h'`);
  return [Number(m[1]), Number(m[2])];
}

/**
 * An integer box of the shown aspect [p, q] (null: free, keep `prefer`'s ratio), centred at c, turned by θ,
 * the largest that fits; with integer p, q the sides are multiples of them (4:5 → 4k × 5k), so the ratio is
 * exact. Returns null when nothing fits.
 */
export function largestCrop(W: number, H: number, o: { angle_deg?: number; orientation?: Orientation | string; aspect?: [number, number] | null; centre?: Pt; max?: Size } = {}): Box | null {
  const orientation = o.orientation ?? 'none';
  const theta = -sensorAngleSign(orientation) * (o.angle_deg ?? 0);
  const c = o.centre ?? { x: W / 2, y: H / 2 };
  const asp = o.aspect ?? null;
  // sensor-frame [p, q]: a swapped orientation shows h:w
  const pq = asp ? (swapsAxes(orientation) ? [asp[1], asp[0]] : [asp[0], asp[1]]) as [number, number] : null;
  const rho = pq ? pq[0] / pq[1] : o.max ? o.max.w / o.max.h : W / H;
  let hMax = largestHeight(c, rho, theta, W, H);
  if (o.max) hMax = Math.min(hMax, o.max.h, o.max.w / rho);
  const exact = pq && Number.isInteger(pq[0]) && Number.isInteger(pq[1]) && pq[0] <= 64 && pq[1] <= 64;
  for (let shrink = 0; shrink < 64; shrink++) {
    let w: number, h: number;
    if (exact) {
      const k = Math.floor(hMax / pq![1]) - shrink;
      if (k < 1) return null;
      w = k * pq![0];
      h = k * pq![1];
    } else {
      h = Math.floor(hMax) - shrink;
      w = Math.floor(rho * h);
      if (h < 1 || w < 1) return null;
    }
    const b = { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h };
    if (fitsInside(b, theta, W, H)) return b;
  }
  return null;
}

/** The frame with the largest crop of `aspect` at the current centre (or the frame's centre). */
export function fitCrop(W: number, H: number, o: { angle_deg?: number; orientation?: Orientation; aspect?: Aspect; centre?: Pt } = {}): FrameSettings {
  const orientation = o.orientation ?? 'none';
  const angle_deg = o.angle_deg ?? 0;
  const aspect = parseAspect(o.aspect ?? 'original', W, H, orientation);
  const box = largestCrop(W, H, { angle_deg, orientation, aspect, ...(o.centre ? { centre: o.centre } : {}) }) ?? largestCrop(W, H, { angle_deg, orientation, aspect });
  const whole = !!box && angle_deg === 0 && box.x === 0 && box.y === 0 && box.w === W && box.h === H;
  return { orientation, angle_deg, crop: whole ? null : box };
}

/** Rounds a box to integers, then shrinks it about its centre until it fits (or null). */
export function roundBox(b: Box, thetaDeg: number, W: number, H: number): Box | null {
  const c = centreOf(b);
  for (let s = 0; s < 64; s++) {
    const w = Math.max(1, Math.floor(b.w) - s), h = Math.max(1, Math.round((Math.floor(b.w) - s) * (b.h / b.w)));
    const r = { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h };
    if (fitsInside(r, thetaDeg, W, H)) return r;
    if (w === 1) break;
  }
  return null;
}

/** Scales a box about a point. */
export const scaleAbout = (b: Box, c: Pt, k: number): Box => ({ x: c.x + (b.x - c.x) * k, y: c.y + (b.y - c.y) * k, w: b.w * k, h: b.h * k });

/**
 * Keep-inside (CraftKit's constrainCrop, guide §5.3): a frame whose turned crop leaves the picture is shrunk
 * about the crop's centre (recentred into the frame when the centre left it) by bisection until it fits,
 * then rounded to integer px. A valid frame is returned unchanged.
 */
export function constrain(f: FrameSettings, W: number, H: number): FrameSettings {
  const theta = sensorTurn(f);
  const b0 = cropOf(f, W, H);
  if (fitsInside(b0, theta, W, H) && [b0.x, b0.y, b0.w, b0.h].every(Number.isInteger)) return f;
  let c = centreOf(b0);
  c = { x: Math.min(W - 1, Math.max(1, c.x)), y: Math.min(H - 1, Math.max(1, c.y)) };
  const b = { ...b0, x: c.x - b0.w / 2, y: c.y - b0.h / 2 };
  let lo = 0, hi = 1;
  if (fitsInside(b, theta, W, H)) lo = 1;
  else for (let i = 0; i < 30; i++) {
    const k = (lo + hi) / 2;
    if (fitsInside(scaleAbout(b, c, k), theta, W, H)) lo = k;
    else hi = k;
  }
  // a centre at the very edge leaves almost nothing: then the largest box of the same shape at the frame's centre
  const r = roundBox(scaleAbout(b, c, lo), theta, W, H);
  const ok = r && r.w * r.h >= 0.01 * b0.w * b0.h ? r : largestCrop(W, H, { angle_deg: f.angle_deg, orientation: f.orientation, aspect: swapsAxes(f.orientation) ? [b0.h / b0.w, 1] : [b0.w / b0.h, 1], max: { w: b0.w, h: b0.h } }) ?? r;
  return { ...f, crop: ok };
}

/** The largest t in [0, 1] with lerp(a, b, t) fitting (a must fit): a move sticks at the edge, a resize stops. */
export function towards(a: Box, b: Box, thetaDeg: number, W: number, H: number): Box {
  const at = (t: number): Box => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t });
  if (fitsInside(b, thetaDeg, W, H)) return b;
  let lo = 0, hi = 1;
  for (let i = 0; i < 48; i++) {
    const m = (lo + hi) / 2;
    if (fitsInside(at(m), thetaDeg, W, H)) lo = m;
    else hi = m;
  }
  return at(lo);
}

/** The shown (final) picture's size: the crop's, oriented. */
export function shownSize(f: FrameSettings, W: number, H: number): Size {
  const b = cropOf(f, W, H);
  return swapsAxes(f.orientation) ? { w: b.h, h: b.w } : { w: b.w, h: b.h };
}

/** A point of the shown (cropped, straightened, oriented) picture → sensor px of the un-oriented source. */
export function toSource(f: FrameSettings, W: number, H: number, X: number, Y: number): Pt {
  const b = cropOf(f, W, H);
  const p = unorientPoint(f.orientation, b.w, b.h, X, Y);
  const v = rotate({ x: p.x - b.w / 2, y: p.y - b.h / 2 }, sensorTurn(f));
  const c = centreOf(b);
  return { x: c.x + v.x, y: c.y + v.y };
}
/** The inverse of toSource: sensor px → the shown picture (may lie outside it when cropped away). */
export function toShown(f: FrameSettings, W: number, H: number, x: number, y: number): Pt {
  const b = cropOf(f, W, H);
  const c = centreOf(b);
  const v = rotate({ x: x - c.x, y: y - c.y }, -sensorTurn(f));
  return orientPoint(f.orientation, b.w, b.h, v.x + b.w / 2, v.y + b.h / 2);
}
/** Whether a sensor point is inside the shown picture. */
export function shownContains(f: FrameSettings, W: number, H: number, x: number, y: number): boolean {
  const s = shownSize(f, W, H);
  const p = toShown(f, W, H, x, y);
  return p.x >= 0 && p.y >= 0 && p.x <= s.w && p.y <= s.h;
}

/** The crop tool's canvas: the whole frame, oriented, not straightened. Canvas px ↔ sensor px. */
export const canvasToSource = (f: Pick<FrameSettings, 'orientation'>, W: number, H: number, X: number, Y: number): Pt => unorientPoint(f.orientation, W, H, X, Y);
export const sourceToCanvas = (f: Pick<FrameSettings, 'orientation'>, W: number, H: number, x: number, y: number): Pt => orientPoint(f.orientation, W, H, x, y);

/** The straighten angle (degrees, view.frame.angle_deg) that levels the shown line a → b (horizontal or vertical, whichever is nearer). */
export function angleOf(a: Pt, b: Pt): number {
  let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  while (deg > 45) deg -= 90;
  while (deg < -45) deg += 90;
  // the line is tilted clockwise by deg as shown; turning the content by −deg levels it
  return -deg;
}

/** Composes orientations: `next` applied after `o` (the orient.* commands). */
export function composeOrientation(o: Orientation, next: 'cw90' | 'ccw90' | 'flipH' | 'flipV'): Orientation {
  // as matrices on (x, y) about the centre: [a b; c d], none = I
  const M: Record<Orientation, [number, number, number, number]> = {
    none: [1, 0, 0, 1], cw90: [0, -1, 1, 0], rot180: [-1, 0, 0, -1], ccw90: [0, 1, -1, 0],
    flipH: [-1, 0, 0, 1], flipV: [1, 0, 0, -1], transpose: [0, 1, 1, 0], transverse: [0, -1, -1, 0],
  };
  const [a, b, c, d] = M[o], [e, f, g, h] = M[next];
  const r: [number, number, number, number] = [e * a + f * c, e * b + f * d, g * a + h * c, g * b + h * d];
  return (Object.keys(M) as Orientation[]).find((k) => M[k].every((v, i) => v === r[i]))!;
}

/** The frame after one orientation step: the crop box stays (sensor px); the shown angle keeps its look. */
export function orientFrame(f: FrameSettings, step: 'cw90' | 'ccw90' | 'flipH' | 'flipV'): FrameSettings {
  const orientation = composeOrientation(f.orientation, step);
  // the region read is turned by θ = −sign·angle in sensor terms; keep θ, so angle′ = −θ / sign′
  const theta = sensorTurn(f);
  const angle_deg = theta === 0 ? 0 : -theta / sensorAngleSign(orientation);
  return { orientation, angle_deg: angle_deg === 0 ? 0 : angle_deg, crop: f.crop };
}

/** Swaps a crop's shown aspect (portrait ↔ landscape) about its centre, as large as fits. */
export function swapAspect(f: FrameSettings, W: number, H: number): FrameSettings {
  const b = cropOf(f, W, H);
  const c = centreOf(b);
  const box = largestCrop(W, H, { angle_deg: f.angle_deg, orientation: f.orientation, aspect: swapsAxes(f.orientation) ? [b.w, b.h] : [b.h, b.w], centre: c, max: { w: b.h, h: b.w } });
  return box ? { ...f, crop: box } : f;
}
