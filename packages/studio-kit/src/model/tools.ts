// Darkroom tool arithmetic (guide §5.9; contract 1.0): the test strip and the ring-around vary the main exposure
// and the printer lights of the document; a mask tool's shape becomes a mask component (the stack kit's mask tools
// put it into the selected entry's mask). Each tool turns a click into one transaction of the document log.
import { Coll, set } from '@chromobench/values';
import type { Document, MaskComponentKind, Params, Vec3 } from '@chromobench/contract';
import {
  exposureStep, FILTRATION_PATH, isNormalised, LIGHTS_PATH, lightsOf, mainExposure, shiftLights, TIME_PATH,
} from './doc.ts';
import { formatSeconds, formatStops, PT, signed, stopsBetween, timeAtStops } from './units.ts';

// ---- test strip ----------------------------------------------------------------------------

export type StripVary = 'time' | 'filtration.y' | 'filtration.m' | 'filtration.c';

/** Band offsets centred on the current value: k = −(n−1)/2 … (n−1)/2. */
export const bandOffsets = (count: number): number[] => Array.from({ length: count }, (_, i) => i - (count - 1) / 2);

/** Lowest filtration shift (the main exposure's filtration is a shift on the database neutral pack). */
export const FILTRATION_MIN_CC = -100;

/** The value a strip varies, as the document has it: the main time or one component of its filtration. */
export function stripBase(vary: StripVary, d: Document): number {
  const e = mainExposure(d);
  return vary === 'time' ? e.time_s : e.filtration[vary.slice(-1) as 'c' | 'm' | 'y'];
}

/** The value of each band: t·2^(k·step) for time, base + k·step CC for the filtration shift (clamped at its minimum). */
export function stripValues(vary: StripVary, base: number, step: number, count: number): number[] {
  return bandOffsets(count).map((k) => (vary === 'time' ? timeAtStops(base, k * step) : Math.max(FILTRATION_MIN_CC, base + k * step)));
}

/**
 * A band's label: seconds for a time strip, or, when `d` prints in normalised mode (where the time does nothing and
 * the strip moves the printer lights instead, CHB-031), the band's stops from the current exposure.
 */
export function stripLabel(vary: StripVary, v: number, d?: Document): string {
  if (vary === 'time' && d && isNormalised(d)) return `${formatStops(stopsBetween(mainExposure(d).time_s, v))} st`;
  return vary === 'time' ? `${formatSeconds(v)} s` : `${signed(Number(v.toFixed(1)), Number.isInteger(Number(v.toFixed(1))) ? 0 : 1)} CC`;
}

/** the log H a time band moves the printer lights by in normalised mode (log10 of its time over the current one) */
const bandLogH = (d: Document, v: number): number => Math.log10(v / mainExposure(d).time_s);

/** The one set a band click writes (normalised mode: a time band is written as printer lights, CHB-031). */
export function stripMutation(vary: StripVary, d: Document, v: number): { path: string; value: unknown } {
  if (vary === 'time' && isNormalised(d)) return { path: LIGHTS_PATH, value: shiftLights(lightsOf(d), bandLogH(d, v)) };
  if (vary === 'time') return { path: TIME_PATH, value: Number(v.toFixed(4)) };
  const k = vary.slice(-1) as 'c' | 'm' | 'y';
  return { path: FILTRATION_PATH, value: { ...mainExposure(d).filtration, [k]: Number(v.toFixed(2)) } };
}

/** Band boxes across a frame of width w: vertical strips, left to right (the order of stripValues; CHB-023). */
export function bandBoxes(count: number, w: number, h: number): { x: number; y: number; w: number; h: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const x0 = Math.floor((i * w) / count), x1 = Math.floor(((i + 1) * w) / count);
    return { x: x0, y: 0, w: Math.max(1, x1 - x0), h };
  });
}

// ---- ring-around ---------------------------------------------------------------------------

export interface RingTile {
  id: string;
  /** The colour the print moves towards, and the complementary it moves away from. */
  label: string;
  /** Offset in log H added to the printer lights. */
  offset: Vec3;
  row: number;
  col: number;
}

/**
 * Light vectors per print direction (Chromogen renderRing, 05-inline.js 4332): more light of a
 * colour makes more of the complementary dye, so a greener print gets LESS green light.
 * Offset = (v − mean v) · 1.5 · step: the dominant component equals the step.
 */
const DIRS: { id: string; label: string; v: Vec3; row: number; col: number }[] = [
  { id: 'Y', label: '+Y (−B)', v: [0, 0, 1], row: 0, col: 0 },
  { id: 'R', label: '+R (−C)', v: [0, 1, 1], row: 0, col: 1 },
  { id: 'M', label: '+M (−G)', v: [0, 1, 0], row: 0, col: 2 },
  { id: 'G', label: '+G (−M)', v: [1, 0, 1], row: 1, col: 0 },
  { id: 'B', label: '+B (−Y)', v: [1, 1, 0], row: 1, col: 2 },
  { id: 'C', label: '+C (−R)', v: [1, 0, 0], row: 2, col: 1 },
];

export function ringTiles(stepPt: number): RingTile[] {
  const step = stepPt * PT;
  const round = (x: number): number => Number(x.toFixed(6));
  const tiles: RingTile[] = DIRS.map((d) => {
    const mean = (d.v[0] + d.v[1] + d.v[2]) / 3;
    return { id: d.id, label: d.label, row: d.row, col: d.col, offset: d.v.map((x) => round((x - mean) * 1.5 * step)) as Vec3 };
  });
  tiles.push({ id: 'current', label: 'current', offset: [0, 0, 0], row: 1, col: 1 });
  for (const k of [-2, -1, 1, 2]) {
    // density: more light on all three layers prints darker
    tiles.push({ id: `D${k > 0 ? '+' : ''}${k}`, label: `${k > 0 ? '+' : '−'}${Math.abs(k)} step`, offset: [round(k * step), round(k * step), round(k * step)], row: 3, col: k + 2 });
  }
  return tiles;
}

/** The printer lights a ring tile chooses (the document's, moved by the tile's offset, held to ±1.5 log H). */
export function ringLights(d: Document, offset: Vec3): Vec3 {
  return lightsOf(d).map((x, i) => Number(Math.min(1.5, Math.max(-1.5, x + offset[i]!)).toFixed(6))) as Vec3;
}

export { exposureStep };

// ---- masks ---------------------------------------------------------------------------------

export type Pt3 = [number, number, number];
/** What a mask tool drew, in document pixels. */
export type MaskShape =
  | { kind: 'stroke'; points: Pt3[]; radius: number; hardness: number; mode: 'add' | 'erase' }
  | { kind: 'linear'; from: [number, number]; to: [number, number] }
  /** angle: rotation about the centre in degrees (mask.ellipse.angle_deg). */
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; angle?: number };

/** Ramer–Douglas–Peucker simplification of a stroke (x, y, pressure) at `eps` document pixels. */
export function simplify(points: readonly Pt3[], eps = 0.5): Pt3[] {
  if (points.length <= 2) return [...points];
  const [a, b] = [points[0]!, points[points.length - 1]!];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  let worst = -1, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const d = len === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > worst) {
      worst = d;
      idx = i;
    }
  }
  if (worst <= eps) return [a, b];
  return [...simplify(points.slice(0, idx + 1), eps).slice(0, -1), ...simplify(points.slice(idx), eps)];
}

/** A mask component's kind and params for a shape (document px; a stroke is a paint component with one stroke). */
export function maskComponent(shape: MaskShape, strokeId = 's1'): [MaskComponentKind, Params] {
  if (shape.kind === 'ellipse') {
    const box = { x: Math.round(shape.cx - shape.rx), y: Math.round(shape.cy - shape.ry), w: Math.max(1, Math.round(2 * shape.rx)), h: Math.max(1, Math.round(2 * shape.ry)) };
    return ['ellipse', { box, ...(shape.angle ? { angle_deg: shape.angle } : {}) }];
  }
  if (shape.kind === 'linear') return ['linear', { from: { x: shape.from[0], y: shape.from[1] }, to: { x: shape.to[0], y: shape.to[1] } }];
  const stroke = { points: simplify(shape.points).map((p) => [Number(p[0].toFixed(2)), Number(p[1].toFixed(2)), Number(p[2].toFixed(3))]), radius: shape.radius, hardness: shape.hardness, mode: shape.mode };
  return ['paint', { strokes: Coll.of([[strokeId, stroke]]) as unknown as Params[string] }];
}

export { set };
