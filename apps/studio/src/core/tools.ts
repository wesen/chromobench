// Darkroom tool arithmetic and adapters (guide §5.9). Each tool turns a click into one transaction;
// the op argument shapes are CHB-010's to finalise, so they are kept in this one file.
import type { Exposure, FrameRecipe, Graph, MaskSpec, Mutation, Vec3 } from '@chromobench/contract';
import { burnSeconds, dodgeSeconds, formatSeconds, formatStops, PT, timeAtStops } from './units.ts';

// ---- test strip ----------------------------------------------------------------------------

export type StripVary = 'time' | 'filtration.y' | 'filtration.m' | 'filtration.c';

/** Band offsets centred on the current value: k = −(n−1)/2 … (n−1)/2. */
export const bandOffsets = (count: number): number[] => Array.from({ length: count }, (_, i) => i - (count - 1) / 2);

/** The value of each band: t·2^(k·step) for time, base + k·step CC for filtration (clamped at 0). */
export function stripValues(vary: StripVary, base: number, step: number, count: number): number[] {
  return bandOffsets(count).map((k) => (vary === 'time' ? timeAtStops(base, k * step) : Math.max(0, base + k * step)));
}

export function stripLabel(vary: StripVary, v: number): string {
  return vary === 'time' ? `${formatSeconds(v)} s` : `${Number(v.toFixed(1))} CC`;
}

/** The single mutation a band click writes. */
export function stripMutation(vary: StripVary, r: FrameRecipe, v: number): Mutation {
  if (vary === 'time') return { op: 'set', path: 'print.enlarger.time_s', value: Number(v.toFixed(4)) };
  const k = vary.slice(-1) as 'c' | 'm' | 'y';
  return { op: 'set', path: 'print.enlarger.filtration', value: { ...r.print.enlarger.filtration, [k]: Number(v.toFixed(2)) } };
}

/** Arguments of the mock/CHB-010 darkroom.testStrip op (step in the varied quantity's display unit). */
export function testStripArgs(vary: StripVary, step: number, count: number): Record<string, unknown> {
  return { vary, steps: count, step, direction: 'vertical' };
}

// ---- ring-around ---------------------------------------------------------------------------

export interface RingTile {
  id: string;
  /** The colour the print moves towards, and the complementary it moves away from. */
  label: string;
  /** Offset in log H added to print.lights.logH. */
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
  { id: 'Y', label: '+Y (−B)', v: [1, 1, 0], row: 0, col: 0 },
  { id: 'R', label: '+R (−C)', v: [0, 1, 1], row: 0, col: 1 },
  { id: 'M', label: '+M (−G)', v: [0, 1, 0], row: 0, col: 2 },
  { id: 'G', label: '+G (−M)', v: [1, 0, 1], row: 1, col: 0 },
  { id: 'B', label: '+B (−Y)', v: [0, 0, 1], row: 1, col: 2 },
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

export const addLights = (a: Vec3, b: Vec3): Vec3 => a.map((x, i) => Number((x + b[i]!).toFixed(6))) as Vec3;

// ---- exposures -----------------------------------------------------------------------------

export interface ExposureRow {
  id: string;
  kind: 'main' | Exposure['kind'];
  enabled: boolean;
  mask: string | null;
  change: string;
  seconds: string;
  /** Seconds a printer counts for this row (withheld for a dodge). */
  t: number;
  filtration: string;
  note: string;
}

const fmtCmy = (f: { c: number; m: number; y: number }): string => `${Number(f.c.toFixed(1))} / ${Number(f.m.toFixed(1))} / ${Number(f.y.toFixed(1))}`;

/** Seconds an exposure gives: dodge withheld t(1 − 2^−s), burn added t(2^s − 1), or its own time. */
export function exposureSeconds(e: Exposure, tMain: number): number {
  if (e.time_s !== null) return e.time_s;
  if (e.stops === null) return tMain;
  return e.kind === 'dodge' ? dodgeSeconds(tMain, e.stops) : burnSeconds(tMain, e.stops);
}

export function exposureRows(r: FrameRecipe): ExposureRow[] {
  const en = r.print.enlarger;
  const rows: ExposureRow[] = [{ id: 'main', kind: 'main', enabled: true, mask: null, change: '—', seconds: `${formatSeconds(en.time_s)} s`, t: en.time_s, filtration: fmtCmy(en.filtration), note: '' }];
  for (const e of r.print.exposures) {
    const t = exposureSeconds(e, en.time_s);
    const change = e.stops === null ? '—' : `${formatStops(e.kind === 'dodge' ? -e.stops : e.stops)} st`;
    const seconds = e.kind === 'dodge' ? `−${formatSeconds(t)} s` : e.kind === 'burn' ? `+${formatSeconds(t)} s` : `${formatSeconds(t)} s`;
    const filtration = e.kind === 'dodge' ? "(main's)" : e.filtration ? fmtCmy(e.filtration) : e.kind === 'flash' ? fmtCmy(en.filtration) : "(main's)";
    const note = e.kind === 'dodge' ? 'held back during main' : e.kind === 'burn' ? 'after main' : e.kind === 'flash' ? 'no negative' : 'own filtration';
    rows.push({ id: e.id, kind: e.kind, enabled: e.enabled, mask: e.mask, change, seconds, t, filtration, note });
  }
  return rows;
}

/** "Expose 12.0 s, hold back face for 1.91 s; burn sky 4.97 s; flash 2.0 s." */
export function printingScript(r: FrameRecipe): string {
  const parts: string[] = [];
  const main: string[] = [`expose ${formatSeconds(r.print.enlarger.time_s)} s`];
  for (const e of r.print.exposures) {
    if (!e.enabled) continue;
    const t = formatSeconds(exposureSeconds(e, r.print.enlarger.time_s));
    const where = e.mask ?? 'the sheet';
    if (e.kind === 'dodge') main.push(`hold back ${where} for ${t} s`);
    else if (e.kind === 'burn') parts.push(`burn ${where} ${t} s`);
    else if (e.kind === 'flash') parts.push(`flash ${t} s`);
    else parts.push(`split ${t} s at ${e.filtration ? fmtCmy(e.filtration) : "main's filtration"}`);
  }
  const s = [main.join(', '), ...parts].join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export function nextExposureId(r: FrameRecipe, kind: string): string {
  let n = 1;
  const ids = new Set(r.print.exposures.map((e) => e.id));
  while (ids.has(`${kind}${n}`)) n++;
  return `${kind}${n}`;
}

// ---- masks ---------------------------------------------------------------------------------

export type Pt3 = [number, number, number];
export type MaskShape =
  | { kind: 'stroke'; points: Pt3[]; radius: number; hardness: number; mode: 'add' | 'erase' }
  | { kind: 'gradient'; from: [number, number]; to: [number, number] }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number };

/** The editor's description of a mask; stored in the recipe as a MaskSpec (mask.* node closure). */
export interface MaskDoc {
  shapes: MaskShape[];
  feather: number;
  invert: boolean;
}

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

/**
 * Builds the MaskSpec for a MaskDoc on `receiver` (the frame's source node, which fixes the size).
 * Strokes go into mask.paint's `strokes` argument as canonical JSON (CONTRACT-REQUESTS.md #1), so
 * the recipe stays a small vector document.
 */
export function maskSpec(graph: Graph, receiver: string, doc: MaskDoc): MaskSpec {
  const I = (op: string, inputs: string[], args: Record<string, unknown>): string => graph.intern(op, inputs, args).node.id;
  let root: string | null = null;
  const strokes = doc.shapes.filter((s) => s.kind === 'stroke');
  const parts: string[] = [];
  for (const s of doc.shapes) {
    if (s.kind === 'ellipse') parts.push(I('mask.ellipse', [receiver], { box: { x: Math.round(s.cx - s.rx), y: Math.round(s.cy - s.ry), w: Math.max(1, Math.round(2 * s.rx)), h: Math.max(1, Math.round(2 * s.ry)) } }));
    else if (s.kind === 'gradient') parts.push(I('mask.gradient', [receiver], { from: { x: s.from[0], y: s.from[1] }, to: { x: s.to[0], y: s.to[1] } }));
  }
  if (strokes.length) parts.push(I('mask.paint', [receiver], { strokes: JSON.stringify(strokes) }));
  if (parts.length === 0) parts.push(I('mask.paint', [receiver], { strokes: '[]' }));
  for (const p of parts) root = root === null ? p : I('mask.or', [root], { other: p });
  if (doc.feather > 0) root = I('mask.feather', [root!], { radius_px: doc.feather });
  if (doc.invert) root = I('mask.not', [root!], {});
  return { version: 1, nodes: graph.closure(root!) };
}

/** Reads a MaskDoc back from a MaskSpec built by maskSpec(). */
export function parseMask(spec: MaskSpec): MaskDoc {
  const doc: MaskDoc = { shapes: [], feather: 0, invert: false };
  for (const n of spec.nodes) {
    const a = n.args as Record<string, unknown>;
    if (n.op === 'mask.ellipse') {
      const b = a['box'] as { x: number; y: number; w: number; h: number };
      doc.shapes.push({ kind: 'ellipse', cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2 });
    } else if (n.op === 'mask.gradient') {
      const f = a['from'] as { x: number; y: number };
      const t = a['to'] as { x: number; y: number };
      doc.shapes.push({ kind: 'gradient', from: [f.x, f.y], to: [t.x, t.y] });
    } else if (n.op === 'mask.paint') {
      try {
        const s = JSON.parse(String(a['strokes'])) as MaskShape[];
        if (Array.isArray(s)) doc.shapes.push(...s);
      } catch {
        // a paint node from elsewhere (id of a stroke set): nothing to edit
      }
    } else if (n.op === 'mask.feather') doc.feather = a['radius_px'] as number;
    else if (n.op === 'mask.not') doc.invert = true;
  }
  return doc;
}
