// cb.kits.select (CHB-049, MASK-2, decision D3): selections as mask components. A selection is the selected layer's
// mask — there is no other selection state — so every tool and command here is a step on that mask through the one
// algebra: the marquees add a rectangle or an ellipse, the lassos a polygon, the magic wand a wand component (it samples
// what the mask reads); Shift adds, Alt subtracts, Shift+Alt intersects (Photoshop), else the Mask panel's Draw choice.
// Select All, Deselect, Inverse, Grow, Contract and Feather change the mask; Use Selection as Mask copies the mask the
// selection tools last drew onto the selected layer (Editor lab's "selection → mask"). A tool makes one selection and
// goes back to no tool (CHB-046's rule); while a marquee or a lasso is dragged the picture already shows it (MASK-4).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CommandTable, ToolTable } from '@chromobench/shell';
import type { Box, MaskCombine, MaskComponentKind, Params } from '@chromobench/contract';
import { Coll, type Id, type Mutation } from '@chromobench/values';
import { sel } from '../../../src/sel.ts';
import { findEntry } from '../../../src/model/doc.ts';
import { simplify, type Pt3 } from '../../../src/model/tools.ts';
import { commit, disarm, dropPreview, frame, isDrag, previewGesture, select, studioOf, svg, track, view as stackView, words } from '../../stack/src/commands.ts';
import { copyMaskOnto, featherTo, growBy, KIND_WORDS, maskGesture, maskOf, selectable, selectAll, selectInverse, selectNone } from '../../stack/src/model.ts';
import { selectedIn } from '../../stack/src/state.ts';
import { SELECT_STATE, type SelectView } from './state.ts';

export const SELECT_TOOLS = ['select-rect', 'select-ellipse', 'select-lasso', 'select-polygon', 'select-wand'] as const;
export const TOOL_WORDS: Record<(typeof SELECT_TOOLS)[number], string> = {
  'select-rect': 'Rectangle', 'select-ellipse': 'Ellipse', 'select-lasso': 'Lasso', 'select-polygon': 'Polygon', 'select-wand': 'Wand',
};
/** Grow and Contract step, Feather amount: mm on the print */
export const GROW_STEP_MM = 0.5;
export const FEATHER_MM = 1;
/** a polygonal lasso closes on a click this close (screen px) to its first corner */
export const CLOSE_PX = 8;

export const selectView = (s: any): SelectView => ({ ...SELECT_STATE.select, ...(s?.select ?? {}) });
const NEED = 'Select a layer first: a selection is the selected layer\'s mask';

/** the layer a selection goes to: the selected one (not the main exposure), else a toast and null */
function target(ctx: any): { f: string; d: any; id: Id } | null {
  const fr = frame(ctx);
  const id = selectedIn(ctx.state);
  if (!fr || !id || !selectable(fr.d, id)) {
    ctx.toast(NEED, { kind: 'warn' });
    return null;
  }
  return { f: fr.f, d: fr.d, id };
}
const hasTarget = (s: any): boolean => {
  const d = sel.doc(s);
  return !!(d && selectable(d, selectedIn(s)));
};
const hasMask = (s: any): boolean => {
  const d = sel.doc(s);
  const id = selectedIn(s);
  return !!(d && id && maskOf(d, id));
};
const needTarget = { enabled: hasTarget, why: NEED };
const needMask = { enabled: hasMask, why: 'The selected layer has no selection (no mask)' };

/** how a gesture combines: Shift adds, Alt subtracts, Shift+Alt intersects (Photoshop); else the Mask panel's Draw */
export function combineOf(e: { shift?: boolean; alt?: boolean }, s: any): MaskCombine {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  return stackView(s).mask.combine;
}

/** the frame's size in picture px */
function sizeOf(ctx: any, f: string): [number, number] {
  const e = studioOf(ctx).frames.get(f);
  return [e?.info.width ?? 0, e?.info.height ?? 0];
}

/** one selection: the component into the selected layer's mask (no feather: a selection's edge is its own), one step */
function selectWith(ctx: any, kind: MaskComponentKind, params: Params, combine: MaskCombine): Id | null {
  const t = target(ctx);
  if (!t) {
    dropPreview(ctx);
    return null;
  }
  const r = maskGesture(t.d, t.id, kind, params, { combine, feather_mm: 0 });
  dropPreview(ctx);
  const name = findEntry(t.d, t.id)?.entry.name ?? t.id;
  if (!commit(ctx, t.f, r.mutations, `Select (${(KIND_WORDS[kind] ?? kind).toLowerCase()}, ${combine}) on ${name}`)) return null;
  select(ctx, t.f, t.id);
  ctx.set({ select: { last: { f: t.f, mask: r.mask } } });
  return r.mask;
}
const live = (ctx: any, kind: MaskComponentKind, params: Params, combine: MaskCombine): void => {
  if (hasTarget(ctx.state)) previewGesture(ctx, kind, params, { combine, feather_mm: 0 });
};
/** a mask step on the selected layer, labelled */
function onMask(ctx: any, f: (d: any, id: Id) => Mutation[], label: (name: string) => string): boolean {
  const t = target(ctx);
  if (!t) return false;
  const ms = f(t.d, t.id);
  if (!ms.length) return false;
  if (!commit(ctx, t.f, ms, label(findEntry(t.d, t.id)?.entry.name ?? t.id))) return false;
  const mk = maskOf(studioOf(ctx).doc(t.f) ?? t.d, t.id);
  if (mk) ctx.set({ select: { last: { f: t.f, mask: mk.id } } });
  return true;
}

const r2 = (x: number): number => Math.round(x * 100) / 100;
export const boxOf = (x0: number, y0: number, x1: number, y1: number): Box => ({ x: r2(Math.min(x0, x1)), y: r2(Math.min(y0, y1)), w: r2(Math.max(1, Math.abs(x1 - x0))), h: r2(Math.max(1, Math.abs(y1 - y0))) });
/** a lasso's outline: simplified (0.5 px), two decimals */
export const outlineOf = (pts: readonly (readonly number[])[]): number[][] => simplify(pts.map((p) => [p[0]!, p[1]!, 1] as Pt3)).map((p) => [r2(p[0]), r2(p[1])]);

export function selectCommands(): CommandTable {
  return {
    'select.all': {
      label: 'Select All', group: 'Select', ...needTarget,
      doc: 'The selected layer acts on the whole picture: its mask becomes one rectangle over the frame (then subtract from it)',
      run: (ctx: any) => {
        const t = target(ctx);
        if (!t) return false;
        const [w, h] = sizeOf(ctx, t.f);
        return onMask(ctx, (d, id) => selectAll(d, id, w, h), (n) => `Select all on ${n}`);
      },
    },
    'select.none': {
      label: 'Deselect', group: 'Select', ...needMask,
      doc: 'No selection is everything (Photoshop): the selected layer\'s mask goes and it acts everywhere again',
      run: (ctx: any) => onMask(ctx, selectNone, (n) => `Deselect on ${n}`),
    },
    'select.invert': {
      label: 'Inverse', group: 'Select', ...needMask,
      doc: 'The selection inverted: the layer acts where it did not',
      run: (ctx: any) => onMask(ctx, selectInverse, (n) => `Inverse selection on ${n}`),
    },
    'select.grow': {
      label: `Grow ${GROW_STEP_MM} mm`, group: 'Select', ...needMask,
      doc: 'Grow the selection outwards by mm on the print (default 0.5)',
      run: (ctx: any, mm: number = GROW_STEP_MM) => onMask(ctx, (d, id) => growBy(d, id, Math.abs(mm)), (n) => `Grow the selection of ${n} by ${Math.abs(mm)} mm`),
    },
    'select.contract': {
      label: `Contract ${GROW_STEP_MM} mm`, group: 'Select', ...needMask,
      doc: 'Contract the selection inwards by mm on the print (default 0.5)',
      run: (ctx: any, mm: number = GROW_STEP_MM) => onMask(ctx, (d, id) => growBy(d, id, -Math.abs(mm)), (n) => `Contract the selection of ${n} by ${Math.abs(mm)} mm`),
    },
    'select.feather': {
      label: `Feather ${FEATHER_MM} mm`, group: 'Select', ...needMask,
      doc: 'Soften the selection\'s edge: the feather in mm on the print (default 1; the Mask panel\'s Feather changes it)',
      run: (ctx: any, mm: number = FEATHER_MM) => onMask(ctx, (d, id) => featherTo(d, id, mm), (n) => `Feather the selection of ${n} ${mm} mm`),
    },
    'select.toLayer': {
      label: 'Use Selection as Mask', group: 'Select',
      enabled: (s: any) => {
        const last = selectView(s).last;
        const d = last ? sel.doc(s, last.f) : undefined;
        const id = selectedIn(s);
        return !!(last && last.f === sel.current(s) && d && id && selectable(d, id) && maskOf(d, id)?.id !== last.mask && Coll.has(d.masks, last.mask));
      },
      why: 'Make a selection on one layer, then select another layer: it gets a copy of that selection as its mask',
      doc: 'The selection last made (on another layer) becomes the selected layer\'s mask, as its own copy',
      run: (ctx: any) => {
        const last = selectView(ctx.state).last;
        const t = target(ctx);
        if (!t || !last || last.f !== t.f) return null;
        try {
          const r = copyMaskOnto(t.d, last.mask, t.id);
          if (commit(ctx, t.f, r.mutations, `Use the selection as the mask of ${findEntry(t.d, t.id)?.entry.name ?? t.id}`)) {
            ctx.set({ select: { last: { f: t.f, mask: r.mask } } });
            return r.mask;
          }
        } catch (e) {
          ctx.toast(words(e), { kind: 'warn' });
        }
        return null;
      },
    },
    // ── the shapes as commands (an agent, a script): the same steps the tools make ──
    'select.rect': {
      label: 'Select Rectangle', palette: false,
      /** (box, { angle_deg, combine }) in picture px */
      run: (ctx: any, box: Box, o: { angle_deg?: number; combine?: MaskCombine } = {}) => selectWith(ctx, 'rect' as MaskComponentKind, { box: { ...box }, angle_deg: o.angle_deg ?? 0 } as Params, o.combine ?? combineOf({}, ctx.state)),
    },
    'select.ellipse': {
      label: 'Select Ellipse', palette: false,
      run: (ctx: any, box: Box, o: { angle_deg?: number; combine?: MaskCombine } = {}) => selectWith(ctx, 'ellipse', { box: { ...box }, angle_deg: o.angle_deg ?? 0 } as Params, o.combine ?? combineOf({}, ctx.state)),
    },
    'select.lasso': {
      label: 'Select Lasso', palette: false,
      /** (points [[x, y], …] in picture px, closed, { combine }) */
      run: (ctx: any, points: number[][], o: { combine?: MaskCombine } = {}) =>
        points?.length >= 3 ? selectWith(ctx, 'polygon' as MaskComponentKind, { points: outlineOf(points) }, o.combine ?? combineOf({}, ctx.state)) : null,
    },
    'select.wand': {
      label: 'Select with the Magic Wand', palette: false,
      /** (x, y, { tolerance, contiguous, softness, combine }): what is like the picture at (x, y) */
      run: (ctx: any, x: number, y: number, o: { tolerance?: number; contiguous?: boolean; softness?: number; combine?: MaskCombine } = {}) => {
        const v = selectView(ctx.state);
        return selectWith(ctx, 'wand' as MaskComponentKind, { seed: { x: r2(x), y: r2(y) }, tolerance: o.tolerance ?? v.tolerance, softness: o.softness ?? 0.02, contiguous: o.contiguous ?? v.contiguous }, o.combine ?? combineOf({}, ctx.state));
      },
    },
    'select.options': {
      label: 'Selection Options', palette: false,
      /** ({ tolerance, contiguous }): the magic wand's for the next clicks */
      run: (ctx: any, o: { tolerance?: number; contiguous?: boolean } = {}) => {
        const patch: Record<string, unknown> = {};
        if (o.tolerance !== undefined && Number.isFinite(o.tolerance)) patch['tolerance'] = Math.min(1, Math.max(0, o.tolerance));
        if (o.contiguous !== undefined) patch['contiguous'] = !!o.contiguous;
        ctx.set({ select: patch });
        const v = selectView(ctx.state);
        return { tolerance: v.tolerance, contiguous: v.contiguous };
      },
    },
  };
}

// ── the tools ──

const at = (vp: any): ((x: number, y: number) => [number, number]) | null => {
  const [w, h] = vp?.natural?.() ?? [0, 0];
  return w && h ? (x: number, y: number) => vp.toScreen(x / w, y / h) : null;
};
const boxOutline = (round: boolean) => (g: any, vp: any, _s: any, gs: any) => {
  const to = at(vp);
  if (!to || !gs || gs.x1 === undefined) return;
  const [ax, ay] = to(gs.x0, gs.y0), [bx, by] = to(gs.x1, gs.y1);
  if (round) svg(g, 'ellipse', { cx: (ax + bx) / 2, cy: (ay + by) / 2, rx: Math.abs(bx - ax) / 2, ry: Math.abs(by - ay) / 2, class: 'cb-select-gesture' });
  else svg(g, 'rect', { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay), class: 'cb-select-gesture' });
};
const polyOutline = (g: any, vp: any, s: any, gs: any) => {
  const to = at(vp);
  if (!to) return;
  const pts: number[][] = gs?.points ?? selectView(s).poly?.points ?? [];
  const hover = gs?.hover as [number, number] | undefined;
  const all = hover && !gs?.points ? [...pts, hover] : pts;
  if (all.length < 2) return;
  svg(g, 'polyline', { points: all.map((p) => to(p[0]!, p[1]!).join(',')).join(' '), class: 'cb-select-gesture' });
};
/** a marquee: drag a box (Shift held when it starts: add, Alt: subtract, both: intersect) */
function marquee(kind: 'rect' | 'ellipse', label: string, key?: string): ToolTable[string] {
  const comp = (kind === 'rect' ? 'rect' : 'ellipse') as MaskComponentKind;
  const params = (g: any, e: any): Params => ({ box: { ...boxOf(g.x0, g.y0, e.x, e.y) }, angle_deg: 0 }) as Params;
  return {
    label, icon: kind === 'rect' ? 'marquee' : 'ellipse', ...(key ? { key } : {}), cursor: 'crosshair', ...needTarget,
    overlay: boxOutline(kind === 'ellipse'),
    on: {
      down: (e: any, ctx: any) => ({ x0: e.x, y0: e.y, sx0: e.sx, sy0: e.sy, combine: combineOf(e, ctx.state) }),
      drag: (e: any, ctx: any, g: any) => {
        track(e, ctx, g);
        if (isDrag(e, g)) live(ctx, comp, params(g, e), g.combine);
        return g;
      },
      up: (e: any, ctx: any, g: any) => {
        if (!isDrag(e, g)) return dropPreview(ctx);
        if (selectWith(ctx, comp, params(g, e), g.combine)) disarm(ctx);
      },
    },
  };
}

export function selectTools(): ToolTable {
  return {
    'select-rect': marquee('rect', 'Rectangular Marquee', 'Shift+M'),
    'select-ellipse': marquee('ellipse', 'Elliptical Marquee'),
    'select-lasso': {
      label: 'Lasso', icon: 'lasso', key: 'L', cursor: 'crosshair', ...needTarget,
      overlay: polyOutline,
      on: {
        down: (e: any, ctx: any) => ({ points: [[e.x, e.y]], sx0: e.sx, sy0: e.sy, combine: combineOf(e, ctx.state) }),
        drag: (e: any, ctx: any, g: any) => {
          g.points.push([e.x, e.y]);
          if (g.points.length >= 3) live(ctx, 'polygon' as MaskComponentKind, { points: outlineOf(g.points) }, g.combine);
          return g;
        },
        up: (e: any, ctx: any, g: any) => {
          const pts = outlineOf(g.points);
          if (pts.length < 3 || !isDrag(e, g)) return dropPreview(ctx);
          if (selectWith(ctx, 'polygon' as MaskComponentKind, { points: pts }, g.combine)) disarm(ctx);
        },
      },
    },
    'select-polygon': {
      label: 'Polygonal Lasso', icon: 'lasso', key: 'Shift+L', cursor: 'crosshair', ...needTarget,
      overlay: polyOutline,
      on: {
        exit: (ctx: any) => ctx.set({ select: { poly: null } }),
        escape: (ctx: any) => {
          ctx.set({ select: { poly: null } });
          ctx.run('tool.none');
        },
        hover: (e: any, _ctx: any, g: any) => ({ ...(g ?? {}), hover: [e.x, e.y] }),
        // a click adds a corner; a click on the first corner (or a double click) closes it: one selection
        down: (e: any, ctx: any) => {
          const p = selectView(ctx.state).poly;
          const f = sel.current(ctx.state);
          const pts: number[][] = p && p.f === f ? [...p.points] : [];
          const to = at(ctx.vp);
          const first = pts[0];
          const nearFirst = !!(first && to && Math.hypot(to(first[0]!, first[1]!)[0] - e.sx, to(first[0]!, first[1]!)[1] - e.sy) <= CLOSE_PX);
          if (pts.length >= 3 && (nearFirst || e.detail >= 2)) {
            ctx.set({ select: { poly: null } });
            if (selectWith(ctx, 'polygon' as MaskComponentKind, { points: outlineOf(pts) }, p?.combine ?? combineOf(e, ctx.state))) disarm(ctx);
            return false;
          }
          if (!hasTarget(ctx.state)) {
            ctx.toast(NEED, { kind: 'warn' });
            return false;
          }
          pts.push([e.x, e.y]);
          // (no live preview between clicks: a draft left open there would ride along with the next step)
          ctx.set({ select: { poly: { f, points: pts, combine: p?.combine ?? combineOf(e, ctx.state) } } });
          return false;
        },
      },
    },
    'select-wand': {
      label: 'Magic Wand', icon: 'wand', key: 'Shift+W', cursor: 'crosshair', ...needTarget,
      // a click selects what is like the picture there (the image the layer's mask reads), one selection
      on: {
        down: (e: any, ctx: any) => {
          const v = selectView(ctx.state);
          if (selectWith(ctx, 'wand' as MaskComponentKind, { seed: { x: r2(e.x), y: r2(e.y) }, tolerance: v.tolerance, softness: 0.02, contiguous: v.contiguous }, combineOf(e, ctx.state))) disarm(ctx);
          return false;
        },
      },
    },
  };
}
