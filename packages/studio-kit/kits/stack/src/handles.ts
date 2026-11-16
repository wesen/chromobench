// cb.kits.stack: on-picture handles of a mask's geometric parts (CHB-049, MASK-3, CHB-040 t:srjo). Pure geometry in
// document pixels, so the tool (commands.ts `mask-edit`) and the tests share it: which handles a linear gradient, a
// radial gradient, an ellipse or a rectangle has, which one a pointer is on, and what a drag of it makes of the part's
// parameters — move (the middle), the ends of a gradient, the sides and corners of a shape (the opposite side stays),
// the knob to turn it — with snapping to the picture's centre lines, thirds and edges (Alt: no snapping) and Shift for
// 15° steps and for a square or a circle.
import type { Box, MaskComponentKind, Point } from '@chromobench/contract';

/** the parts that have handles */
export const HANDLE_KINDS: readonly MaskComponentKind[] = ['linear', 'radial', 'ellipse', 'rect'];
export const hasHandles = (k: string): boolean => (HANDLE_KINDS as readonly string[]).includes(k);

export type HandleId = 'move' | 'from' | 'to' | 'rotate' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export interface Handle { id: HandleId; x: number; y: number }

/** how far the turning knob sits above the shape's top side, in screen px */
export const KNOB_PX = 26;
/** how close (screen px) a pointer must be to take a handle, and a guide to snap to */
export const HIT_PX = 9;
export const SNAP_PX = 8;

interface Frame { c: Point; u: Point; v: Point; hw: number; hh: number }
const frameOf = (box: Box, angle_deg: number): Frame => {
  const t = (angle_deg * Math.PI) / 180;
  return { c: { x: box.x + box.w / 2, y: box.y + box.h / 2 }, u: { x: Math.cos(t), y: Math.sin(t) }, v: { x: -Math.sin(t), y: Math.cos(t) }, hw: box.w / 2, hh: box.h / 2 };
};
const at = (f: Frame, a: number, b: number): Point => ({ x: f.c.x + a * f.u.x + b * f.v.x, y: f.c.y + a * f.u.y + b * f.v.y });
const r2 = (x: number): number => Math.round(x * 100) / 100;

/** The side and corner signs of the box handles: (sign along u, sign along v); 0 = that axis does not move. */
const SIDES: Record<string, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1] };

/** The handles of a part, in document px; `knob` is the knob's distance above the top side in document px. */
export function handlesOf(kind: string, p: Record<string, unknown>, knob = 20): Handle[] {
  if (kind === 'linear') {
    const a = p['from'] as Point, b = p['to'] as Point;
    return [{ id: 'from', x: a.x, y: a.y }, { id: 'to', x: b.x, y: b.y }, { id: 'move', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }];
  }
  const f = frameOf(p['box'] as Box, (p['angle_deg'] as number | undefined) ?? 0);
  const hs: Handle[] = Object.entries(SIDES).map(([id, [a, b]]) => ({ id: id as HandleId, ...at(f, a * f.hw, b * f.hh) }));
  return [...hs, { id: 'rotate', ...at(f, 0, -f.hh - knob) }, { id: 'move', x: f.c.x, y: f.c.y }];
}

/** Whether a document point lies on the part (inside the shape, or near the gradient's line): a move starts there. */
export function onPart(kind: string, p: Record<string, unknown>, x: number, y: number, tol: number): boolean {
  if (kind === 'linear') {
    const a = p['from'] as Point, b = p['to'] as Point;
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
    return Math.hypot(x - a.x - t * dx, y - a.y - t * dy) <= tol;
  }
  const f = frameOf(p['box'] as Box, (p['angle_deg'] as number | undefined) ?? 0);
  const u = (x - f.c.x) * f.u.x + (y - f.c.y) * f.u.y, v = (x - f.c.x) * f.v.x + (y - f.c.y) * f.v.y;
  if (kind === 'rect') return Math.abs(u) <= f.hw + tol && Math.abs(v) <= f.hh + tol;
  return (u / Math.max(f.hw + tol, 1e-9)) ** 2 + (v / Math.max(f.hh + tol, 1e-9)) ** 2 <= 1;
}

/** The handle under a document point (within `tol` document px), the knob and the ends first; null when none. */
export function hitHandle(kind: string, p: Record<string, unknown>, x: number, y: number, tol: number, knob = 20): HandleId | null {
  const hs = handlesOf(kind, p, knob).filter((h) => h.id !== 'move');
  let best: HandleId | null = null, d = tol;
  for (const h of hs) {
    const e = Math.hypot(h.x - x, h.y - y);
    if (e <= d) {
      d = e;
      best = h.id;
    }
  }
  if (best) return best;
  return onPart(kind, p, x, y, tol) ? 'move' : null;
}

/** The picture's guides: its edges, thirds and centre lines (document px). */
export const guidesOf = (W: number, H: number): { xs: number[]; ys: number[] } => ({ xs: [0, W / 3, W / 2, (2 * W) / 3, W], ys: [0, H / 3, H / 2, (2 * H) / 3, H] });

/** A point snapped to the nearest guide on each axis within `tol` document px (each axis on its own). */
export function snapPoint(x: number, y: number, W: number, H: number, tol: number): Point {
  const g = guidesOf(W, H);
  const near = (v: number, gs: number[]): number => {
    let best = v, d = tol;
    for (const q of gs) if (Math.abs(q - v) <= d) { d = Math.abs(q - v); best = q; }
    return best;
  };
  return { x: near(x, g.xs), y: near(y, g.ys) };
}

/** An angle (degrees) in the parts' range −90…90 (the shapes look the same turned half way round). */
export const wrapAngle = (deg: number): number => {
  let a = ((((deg + 90) % 180) + 180) % 180) - 90;
  if (a === -90 && deg > 0) a = 90;
  return Math.round(a * 100) / 100;
};

export interface DragMods {
  /** Shift: 15° steps, a square or a circle */
  shift?: boolean;
  /** Alt: no snapping */
  alt?: boolean;
  /** the picture's size (document px) and the snapping distance in document px */
  W: number;
  H: number;
  snap: number;
}

/**
 * The part's parameters after a handle was dragged from `start` (the pointer where the drag began) to `now`, from the
 * parameters `p0` it had then.
 */
export function dragHandle(kind: string, p0: Record<string, unknown>, h: HandleId, start: Point, now: Point, m: DragMods): Record<string, unknown> {
  const snap = (q: Point): Point => (m.alt ? q : snapPoint(q.x, q.y, m.W, m.H, m.snap));
  const dx = now.x - start.x, dy = now.y - start.y;
  if (kind === 'linear') {
    const a = p0['from'] as Point, b = p0['to'] as Point;
    if (h === 'move') {
      // the middle snaps; both ends follow
      const mid = snap({ x: (a.x + b.x) / 2 + dx, y: (a.y + b.y) / 2 + dy });
      const ox = mid.x - (a.x + b.x) / 2, oy = mid.y - (a.y + b.y) / 2;
      return { ...p0, from: { x: r2(a.x + ox), y: r2(a.y + oy) }, to: { x: r2(b.x + ox), y: r2(b.y + oy) } };
    }
    const fixed = h === 'from' ? b : a;
    let q = snap({ x: (h === 'from' ? a : b).x + dx, y: (h === 'from' ? a : b).y + dy });
    if (m.shift) {
      // the line in 15° steps about the other end, its length kept
      const len = Math.hypot(q.x - fixed.x, q.y - fixed.y);
      const t = (Math.round((Math.atan2(q.y - fixed.y, q.x - fixed.x) * 180) / Math.PI / 15) * 15 * Math.PI) / 180;
      q = { x: fixed.x + len * Math.cos(t), y: fixed.y + len * Math.sin(t) };
    }
    return { ...p0, [h]: { x: r2(q.x), y: r2(q.y) } };
  }
  const box = p0['box'] as Box;
  const ang = (p0['angle_deg'] as number | undefined) ?? 0;
  const f = frameOf(box, ang);
  const out = (c: Point, hw: number, hh: number, angle = ang): Record<string, unknown> => ({
    ...p0, box: { x: r2(c.x - hw), y: r2(c.y - hh), w: r2(2 * hw), h: r2(2 * hh) }, angle_deg: angle,
  });
  if (h === 'move') return out(snap({ x: f.c.x + dx, y: f.c.y + dy }), f.hw, f.hh);
  if (h === 'rotate') {
    const t = (Math.atan2(now.x - f.c.x, -(now.y - f.c.y)) * 180) / Math.PI;
    return out(f.c, f.hw, f.hh, wrapAngle(m.shift ? Math.round(t / 15) * 15 : t));
  }
  // a side or a corner: the opposite side (or corner) stays where it is
  const [su, sv] = SIDES[h]!;
  const opp = at(f, -su * f.hw, -sv * f.hh);
  const q = snap({ x: at(f, su * f.hw, sv * f.hh).x + dx, y: at(f, su * f.hw, sv * f.hh).y + dy });
  const pu = (q.x - opp.x) * f.u.x + (q.y - opp.y) * f.u.y, pv = (q.x - opp.x) * f.v.x + (q.y - opp.y) * f.v.y;
  let w = su ? Math.max(2, su * pu) : 2 * f.hw;
  let hgt = sv ? Math.max(2, sv * pv) : 2 * f.hh;
  if (m.shift && su && sv) w = hgt = Math.max(w, hgt);
  const cu = su ? (su * w) / 2 : 0, cv = sv ? (sv * hgt) / 2 : 0;
  // the new centre: the fixed side (or corner) plus half the new size along the axes that move (the fixed point lies
  // on the centre line of an axis that does not move)
  return out({ x: opp.x + cu * f.u.x + cv * f.v.x, y: opp.y + cu * f.u.y + cv * f.v.y }, w / 2, hgt / 2);
}

/** The words of a drag, for the step's label. */
export const handleWords = (h: HandleId): string => (h === 'move' ? 'Move' : h === 'rotate' ? 'Turn' : h === 'from' || h === 'to' ? 'Move the end of' : 'Resize');
