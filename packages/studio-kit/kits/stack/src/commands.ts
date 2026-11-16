// cb.kits.stack: the command table and the mask tools. Every edit is one transaction of the frame's document in the
// log (studio.commit: the four mutations; a refusal by the document's rules is a toast, never a half edit). A
// command acts on the selected entry of the current frame unless it is given an id, so the menus, the palette, the
// keys, the panels' buttons and an agent's `run('layer.toggle', 'b1')` are the same action.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CommandTable, ToolTable } from '@chromobench/shell';
import type { Document, EntryBlend, MaskCombine, MaskComponentKind, Params, StageName } from '@chromobench/contract';
import { Coll, set, type Id, type Mutation } from '@chromobench/values';
import { bakeLink, edit, pitches, removeLink, setLinkAmount } from '@chromobench/contract';
import type { Studio } from '../../../src/studio.ts';
import { sel } from '../../../src/sel.ts';
import { DOCS, findEntry, storePath } from '../../../src/model/doc.ts';
import { maskComponent, type MaskShape, type Pt3 } from '../../../src/model/tools.ts';
import {
  addComponent, addLayer, blendChoices, componentKinds, deleteEntries, detachMask, dropOn, duplicateEntry, groupEntries, KIND_WORDS, maskGesture,
  maskOf, newMaskOn, nudgeEntry, opWord, renameEntry, setAmount, setBlend, toggleEntry, ungroup, componentDefaults, formatAmount, linkKey,
} from './model.ts';
import { selectedIn, STACK_STATE, type StackView } from './state.ts';
import { mathOf, sampleOklab } from './editors.ts';
import { dragHandle, handlesOf, handleWords, hasHandles, hitHandle, HIT_PX, KNOB_PX, SNAP_PX, type HandleId } from './handles.ts';

export const studioOf = (ctx: any): Studio => {
  const s = ctx.services?.studio as Studio | undefined;
  if (!s) throw new Error('No studio service: start the app with studio.services()');
  return s;
};
/** the current frame and its committed document */
export const frame = (ctx: any): { f: string; d: Document } | null => {
  const f = sel.current(ctx.state);
  const d = f ? studioOf(ctx).doc(f) : undefined;
  return f && d ? { f, d } : null;
};
export const view = (s: any): StackView => ({ ...STACK_STATE.stack, ...(s?.stack ?? {}) });
/** the entry a command acts on: the id given, else the selected entry of the current frame */
const target = (ctx: any, id?: Id | null): Id | null => id ?? selectedIn(ctx.state);
export const words = (e: unknown): string => String((e as { diag?: { message?: string } })?.diag?.message ?? (e as Error)?.message ?? e);

/** one step on the current frame; a refusal is said, not thrown */
export function commit(ctx: any, f: string, ms: readonly Mutation[], label: string): boolean {
  if (!ms.length) return false;
  try {
    studioOf(ctx).commit(f, ms, label, { source: { kind: 'stack' } });
    return true;
  } catch (e) {
    ctx.toast(`${label}: ${words(e)}`, { kind: 'warn' });
    return false;
  }
}
export const select = (ctx: any, f: string, id: Id | null): void => ctx.set({ stack: { selected: { [f]: id } } });
const hasEntry = (s: any): boolean => {
  const f = sel.current(s);
  const id = selectedIn(s);
  return !!(f && id && s.docs?.[f] && findEntry(s.docs[f], id));
};
const needEntry = { enabled: hasEntry, why: 'Select a layer in a stack panel first' };
const needFrame = { enabled: (s: any) => !!sel.doc(s), why: 'Open a frame first' };
const nameOf = (d: Document, id: Id): string => findEntry(d, id)?.entry.name ?? id;

export function stackCommands(): CommandTable {
  return {
    'layer.select': {
      label: 'Select Layer', palette: false,
      run: (ctx: any, id: Id | null) => {
        const f = sel.current(ctx.state);
        if (f) select(ctx, f, id);
      },
    },
    'layer.add': {
      label: 'Add Layer', ...needFrame,
      /** (op, stage?): after the selected entry when it is in that stage, else at the end of the stage's stack */
      run: (ctx: any, op: string, stage?: StageName) => {
        const fr = frame(ctx);
        if (!fr || !op) return null;
        const at = selectedIn(ctx.state);
        const st = stage ?? (at ? findEntry(fr.d, at)?.stage : undefined) ?? 'print';
        try {
          const r = addLayer(fr.d, st, op, { after: at });
          if (commit(ctx, fr.f, r.mutations, `Add ${opWord(op).toLowerCase()} ${r.id}`)) select(ctx, fr.f, r.id);
          return r.id;
        } catch (e) {
          ctx.toast(words(e), { kind: 'warn' });
          return null;
        }
      },
    },
    'layer.duplicate': {
      label: 'Duplicate Layer', ...needEntry,
      run: (ctx: any, id?: Id) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        if (!fr || !t) return null;
        try {
          const r = duplicateEntry(fr.d, t);
          if (commit(ctx, fr.f, r.mutations, `Duplicate ${nameOf(fr.d, t)}`)) select(ctx, fr.f, r.id);
          return r.id;
        } catch (e) {
          ctx.toast(words(e), { kind: 'warn' });
          return null;
        }
      },
    },
    'layer.delete': {
      label: 'Delete Layer', ...needEntry,
      run: (ctx: any, id?: Id) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        if (!fr || !t) return;
        // a link goes with its siblings in the other stages it touches (one look, one entry per stage)
        const k = linkKey(fr.d, t);
        const ms = k ? removeLink(fr.d, k) : deleteEntries(fr.d, [t]);
        if (commit(ctx, fr.f, ms, `${k ? 'Remove' : 'Delete'} ${nameOf(fr.d, t)}`) && selectedIn(ctx.state) === t) select(ctx, fr.f, null);
      },
    },
    'layer.rename': {
      label: 'Rename Layer', palette: false,
      run: (ctx: any, id: Id, name: string) => {
        const fr = frame(ctx);
        if (!fr || !id || !name?.trim()) return;
        commit(ctx, fr.f, renameEntry(id, name.trim()), `Rename ${nameOf(fr.d, id)} to ${name.trim()}`);
      },
    },
    'layer.group': {
      label: 'Group Layer', ...needEntry,
      run: (ctx: any, ids?: Id[]) => {
        const fr = frame(ctx);
        const list = ids ?? [selectedIn(ctx.state)].filter((x): x is Id => !!x);
        if (!fr || !list.length) return null;
        try {
          const r = groupEntries(fr.d, list);
          if (commit(ctx, fr.f, r.mutations, `Group ${list.map((x) => nameOf(fr.d, x)).join(', ')}`)) select(ctx, fr.f, r.id);
          return r.id;
        } catch (e) {
          ctx.toast(words(e), { kind: 'warn' });
          return null;
        }
      },
    },
    'layer.ungroup': {
      label: 'Ungroup',
      enabled: (s: any) => {
        const id = selectedIn(s);
        const d = sel.doc(s);
        return !!(id && d && findEntry(d, id)?.entry.kind === 'group');
      },
      why: 'Select a group first',
      run: (ctx: any, id?: Id) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        if (!fr || !t) return;
        const first = findEntry(fr.d, t)?.entry;
        if (commit(ctx, fr.f, ungroup(fr.d, t), `Ungroup ${nameOf(fr.d, t)}`) && first?.kind === 'group') select(ctx, fr.f, Coll.ids(first.stack)[0] ?? null);
      },
    },
    'layer.move': {
      label: 'Move Layer', palette: false,
      /** (id, target, 'before' | 'after' | 'into'): a drop in a stack panel */
      run: (ctx: any, id: Id, onto: Id, where: 'before' | 'after' | 'into') => {
        const fr = frame(ctx);
        if (!fr) return;
        const ms = dropOn(fr.d, id, onto, where);
        commit(ctx, fr.f, ms, where === 'into' ? `Move ${nameOf(fr.d, id)} into ${nameOf(fr.d, onto)}` : `Move ${nameOf(fr.d, id)}`);
      },
    },
    'layer.up': {
      label: 'Move Layer Up', ...needEntry,
      run: (ctx: any, id?: Id) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        if (fr && t) commit(ctx, fr.f, nudgeEntry(fr.d, t, -1), `Move ${nameOf(fr.d, t)} up`);
      },
    },
    'layer.down': {
      label: 'Move Layer Down', ...needEntry,
      run: (ctx: any, id?: Id) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        if (fr && t) commit(ctx, fr.f, nudgeEntry(fr.d, t, 1), `Move ${nameOf(fr.d, t)} down`);
      },
    },
    'layer.toggle': {
      label: 'Turn Layer On or Off', ...needEntry,
      run: (ctx: any, id?: Id) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        const e = fr && t ? findEntry(fr.d, t)?.entry : undefined;
        if (fr && t && e) commit(ctx, fr.f, toggleEntry(fr.d, t), `${e.enabled ? 'Turn off' : 'Turn on'} ${e.name}`);
      },
    },
    'layer.amount': {
      label: 'Layer Amount', palette: false,
      run: (ctx: any, id: Id, a: number) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        if (!fr || !t || !Number.isFinite(a)) return;
        // a link: one Amount over every stage it touches (each held to its law)
        const k = linkKey(fr.d, t);
        commit(ctx, fr.f, k ? setLinkAmount(fr.d, k, a) : setAmount(fr.d, t, a), `${nameOf(fr.d, t)} amount ${formatAmount(a)}`);
      },
    },
    'layer.blend': {
      label: 'Layer Blend Mode', palette: false,
      run: (ctx: any, id: Id, b: EntryBlend) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        if (!fr || !t) return;
        try {
          commit(ctx, fr.f, setBlend(fr.d, t, b), `${nameOf(fr.d, t)} blend ${b}`);
        } catch (e) {
          ctx.toast(words(e), { kind: 'warn' });
        }
      },
    },
    'link.bake': {
      label: 'Bake Link into Layers',
      enabled: (s: any) => {
        const d = sel.doc(s);
        const id = selectedIn(s);
        return !!(d && id && findEntry(d, id)?.entry.kind === 'link');
      },
      why: 'Select a look, a preset or a roll link first',
      /** the link becomes the plain group it expands to (its source recorded), in every stage it touches */
      run: (ctx: any, id?: Id) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        const k = fr && t ? linkKey(fr.d, t) : null;
        if (!fr || !t || !k) return;
        try {
          commit(ctx, fr.f, bakeLink(fr.d, k, studioOf(ctx).links()), `Bake ${nameOf(fr.d, t)}`);
        } catch (e) {
          ctx.toast(words(e), { kind: 'warn' });
        }
      },
    },
    'link.remove': {
      label: 'Remove Link', palette: false,
      run: (ctx: any, id?: Id) => ctx.run('layer.delete', id),
    },
    'layer.collapse': {
      label: 'Collapse Group', palette: false,
      run: (ctx: any, id: Id) => ctx.set({ stack: { collapsed: { [id]: !view(ctx.state).collapsed[id] } } }),
    },
    'stack.byKind': {
      label: 'List the Darkroom by Kind',
      checked: (s: any) => view(s).darkroomOrder === 'kind',
      /** D5 (CHB-046): the Enlarger in his order (default) or by kind; a view only, the print does not change */
      run: (ctx: any, on?: boolean) => ctx.set({ stack: { darkroomOrder: (on ?? view(ctx.state).darkroomOrder !== 'kind') ? 'kind' : 'stack' } }),
    },
    // ── masks ──
    'mask.new': {
      label: 'New Mask', ...needEntry,
      /** (kind, id?): a new mask with one component of `kind` (the op's defaults) on the entry */
      run: (ctx: any, kind: MaskComponentKind = 'luminance', id?: Id) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        if (!fr || !t || !componentKinds().includes(kind)) return null;
        const r = newMaskOn(fr.d, t, kind);
        commit(ctx, fr.f, r.mutations, `Mask ${nameOf(fr.d, t)} (${KIND_WORDS[kind]?.toLowerCase() ?? kind})`);
        return r.mask;
      },
    },
    'mask.attach': {
      label: 'Use Mask', palette: false,
      run: (ctx: any, mid: Id, id?: Id) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        if (fr && t && Coll.has(fr.d.masks, mid)) commit(ctx, fr.f, [set(`${t}.mask`, mid)], `${nameOf(fr.d, t)} through ${Coll.get(fr.d.masks, mid)!.name}`);
      },
    },
    'mask.detach': {
      label: 'Remove Mask', enabled: (s: any) => {
        const d = sel.doc(s);
        const id = selectedIn(s);
        return !!(d && id && findEntry(d, id)?.entry.mask);
      },
      why: 'The selected layer has no mask',
      run: (ctx: any, id?: Id) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        if (fr && t) commit(ctx, fr.f, detachMask(fr.d, t), `Remove the mask of ${nameOf(fr.d, t)}`);
      },
    },
    'mask.addComponent': {
      label: 'Add Mask Component', palette: false,
      run: (ctx: any, kind: MaskComponentKind, combine: MaskCombine = 'add', id?: Id) => {
        const fr = frame(ctx);
        const t = target(ctx, id);
        const m = fr && t ? maskOf(fr.d, t) : null;
        if (!fr || !t) return;
        if (!m) return void ctx.run('mask.new', kind, t);
        commit(ctx, fr.f, addComponent(fr.d, m.id, kind, componentDefaults(kind), combine).mutations, `${KIND_WORDS[kind] ?? kind} on ${m.mask.name}`);
      },
    },
    'mask.removeComponent': {
      label: 'Remove Mask Component', palette: false,
      run: (ctx: any, cid: Id) => {
        const fr = frame(ctx);
        if (!fr) return;
        commit(ctx, fr.f, [{ op: 'remove', id: cid }], 'Remove mask component');
      },
    },
    'mask.brush': {
      label: 'Brush Settings', palette: false,
      /** ({ size, hardness, flow }): the brush's size (radius in picture px), hardness and flow (0…1) for the next strokes */
      run: (ctx: any, o: { size?: number; hardness?: number; flow?: number } = {}) => {
        const cl = (x: number | undefined, lo: number, hi: number): number | undefined => (x === undefined || !Number.isFinite(x) ? undefined : Math.min(hi, Math.max(lo, x)));
        const patch = { radius: cl(o.size, 0.5, 2000), hardness: cl(o.hardness, 0, 1), flow: cl(o.flow, 0.01, 1) };
        ctx.set({ stack: { mask: Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } });
        return { size: view(ctx.state).mask.radius, hardness: view(ctx.state).mask.hardness, flow: view(ctx.state).mask.flow };
      },
    },
    'mask.edit': {
      label: 'Edit Mask on Picture', palette: false,
      /** (component?): show that part's handles on the picture (the Edit Mask tool) */
      run: (ctx: any, cid?: Id | null) => {
        ctx.set({ stack: { mask: { edit: cid ?? null } } });
        if (ctx.state?.ui?.tool !== 'mask-edit') ctx.run('tool.mask-edit');
      },
    },
    'mask.set': {
      label: 'Mask Setting', palette: false,
      /** (path, value, label): one field of a mask or a component (`m1.invert`, `m1c2.combine`, `m1.reads`) */
      run: (ctx: any, path: string, value: unknown, label = 'Mask') => {
        const fr = frame(ctx);
        if (fr) commit(ctx, fr.f, [set(path, value)], label);
      },
    },
  };
}

// ── mask tools: gestures on the viewer ───────────────────────────────────────────────────────────────────────────

/** the mask tool ids, for a viewer's `tools` (the radial tool draws an ellipse until P8a's radial component exists) */
export const MASK_TOOLS = ['mask-linear', 'mask-radial', 'mask-paint', 'mask-luminance', 'mask-colour', 'mask-edit'] as const;

/** the gesture's component into the selected layer's mask (or a new layer with it); the layer it went to, or null */
function drawn(ctx: any, kind: MaskComponentKind, params: Params): Id | null {
  const studio = studioOf(ctx);
  const fr = frame(ctx);
  const e = fr ? studio.frames.get(fr.f) : undefined;
  if (!fr || !e) return null;
  const t = selectedIn(ctx.state);
  const r = maskGesture(fr.d, t, kind, params, gestureOptions(ctx, fr.d, kind));
  // a live preview of the gesture (MASK-4) is dropped; the step is the gesture's mutations
  dropPreview(ctx);
  if (!commit(ctx, fr.f, r.mutations, r.label)) return null;
  select(ctx, fr.f, r.layer);
  return r.layer;
}

/** How a drawn component joins the mask: the Draw choice (or the one given), and an 8-px feather for a new mask's shapes. */
export function gestureOptions(ctx: any, d: Document, kind: MaskComponentKind, combine?: MaskCombine): { combine: MaskCombine; feather_mm: number } {
  const e = studioOf(ctx).frames.get(sel.current(ctx.state)!);
  const range = kind === 'luminance' || kind === ('colour' as MaskComponentKind) || kind === ('wand' as MaskComponentKind);
  const feather_mm = range || !e ? 0 : Number(((8 * pitches(d, e.graph).paper) / 1000).toFixed(4));
  return { combine: combine ?? view(ctx.state).mask.combine, feather_mm };
}

/**
 * MASK-4 (CHB-049): the gesture's component shown before release — the document with it, as the store's gesture draft
 * (the picture, the overlay and the masks panel follow it; Escape drops it). Nothing is logged until the release.
 */
export function previewGesture(ctx: any, kind: MaskComponentKind, params: Params, o: { combine?: MaskCombine; feather_mm?: number } = {}): void {
  const fr = frame(ctx);
  if (!fr) return;
  let after: Document;
  try {
    after = edit(fr.d, maskGesture(fr.d, selectedIn(ctx.state), kind, params, { ...gestureOptions(ctx, fr.d, kind, o.combine), ...(o.feather_mm !== undefined ? { feather_mm: o.feather_mm } : {}) }).mutations).doc;
  } catch {
    return;
  }
  const st = ctx.rt.store;
  for (const k of ['masks', 'stages'] as const) if (after[k] !== fr.d[k]) st.preview([DOCS, fr.f, k], after[k]);
}
/** drops a gesture's preview (before its step is committed, or when it makes nothing) */
export const dropPreview = (ctx: any): void => {
  if (ctx.rt?.store?.previewing) ctx.rt.store.cancel();
};

// CHB-046 (P9-1): a mask tool used to stay armed after its gesture, so a later click anywhere on the picture drew a
// gradient into whatever layer was selected by then. Now a tool makes one mask and goes back to no tool; the gradient
// tools need a drag (a click does nothing); the brush keeps painting the layer it was armed for and disarms when
// another layer (or frame) is selected.

/** a press that moves less than this (screen px) is a click: the linear and radial tools need a drag */
export const MIN_DRAG_PX = 4;
export const isDrag = (e: { sx: number; sy: number }, g: { sx0: number; sy0: number }): boolean => Math.hypot(e.sx - g.sx0, e.sy - g.sy0) >= MIN_DRAG_PX;
/** back to no tool (the default): the next click on the picture is a click again */
export const disarm = (ctx: any): void => {
  if (ctx.state?.ui?.tool) ctx.run('tool.none');
};
/** the frame and layer selected now: what the brush paints on */
const armedHere = (ctx: any): { f: string | null; layer: Id | null } => ({ f: sel.current(ctx.state), layer: selectedIn(ctx.state) });
const armBrush = (ctx: any, at: { f: string | null; layer: Id | null } = armedHere(ctx)): void => ctx.set({ stack: { mask: { armedFor: at } } });
/**
 * The eyedropper: the colour under (x, y) (document px) of the cut the selected layer's mask reads, in OkLab as the
 * colour component measures it (core's encodeTransform through the host's editorMath), written in one step into the
 * armed colour component, else as a new colour range. A colour range needs a layer of a stage whose cuts hold colour
 * (the scene or the print).
 */
export async function eyedropper(ctx: any, x: number, y: number): Promise<boolean> {
  const studio = studioOf(ctx);
  const math = mathOf(ctx.services);
  if (!math) {
    ctx.toast('The eyedropper needs the host\'s colour conversion (services.editorMath)', { kind: 'warn' });
    return false;
  }
  const fr = frame(ctx);
  const t = selectedIn(ctx.state);
  const p = fr && t ? findEntry(fr.d, t) : undefined;
  if (!fr || !t || !p || (p.stage !== 'print' && p.stage !== 'scene')) {
    ctx.toast('Select a layer of the print (or the scene) first: a colour range measures colour, which the darkroom of a negative does not have', { kind: 'warn' });
    return false;
  }
  const m = maskOf(fr.d, t);
  let lab: [number, number, number];
  try {
    lab = await sampleOklab(studio, math, fr.f, fr.d, p.stage, m?.mask.reads, x, y);
  } catch (e) {
    ctx.toast(`Eyedropper: ${words(e)}`, { kind: 'warn' });
    return false;
  }
  const armed = view(ctx.state).mask.sample;
  const d = studio.doc(fr.f) ?? fr.d;
  const now = maskOf(d, t);
  const into = armed && now?.components.find(([cid, c]) => cid === armed && c.kind === ('colour' as MaskComponentKind));
  ctx.set({ stack: { mask: { sample: null } } });
  if (into) {
    // Sample is one shot: the eyedropper goes back to no tool (the tool's own button keeps it for more ranges)
    if (ctx.state?.ui?.tool === 'mask-colour') ctx.run('tool.none');
    return commit(ctx, fr.f, [set(`${armed}.params.colour`, lab)], `Sample the colour of ${now!.mask.name}`);
  }
  const made = drawn(ctx, 'colour' as MaskComponentKind, { ...componentDefaults('colour' as MaskComponentKind), colour: lab });
  if (made) disarm(ctx);
  return !!made;
}

/** a mask tool's shape as a component: the radial tool draws the radial component (a soft ellipse) */
const shapeOf = (s: MaskShape): [MaskComponentKind, Params] => {
  const [kind, params] = maskComponent(s);
  return kind === 'ellipse' && hasKind('radial') ? ['radial' as MaskComponentKind, { ...params, feather: 0.5 }] : [kind, params];
};
const shape = (ctx: any, s: MaskShape): Id | null => drawn(ctx, ...shapeOf(s));
const linearShape = (g: any, e: { x: number; y: number }): MaskShape => ({ kind: 'linear', from: [g.x0, g.y0], to: [e.x, e.y] });
const radialShape = (g: any, e: { x: number; y: number }): MaskShape => ({ kind: 'ellipse', cx: (g.x0 + e.x) / 2, cy: (g.y0 + e.y) / 2, rx: Math.max(2, Math.abs(e.x - g.x0) / 2), ry: Math.max(2, Math.abs(e.y - g.y0) / 2) });
const brushShape = (ctx: any, points: Pt3[]): MaskShape & { flow: number } => {
  const b = view(ctx.state).mask;
  return { kind: 'stroke', points, radius: b.radius, hardness: b.hardness ?? 0.5, mode: 'add', flow: b.flow ?? 1 };
};
/** a drag tool's move: the outline follows, and once it is a drag the picture shows the component (MASK-4) */
const liveDrag = (make: (g: any, e: any) => MaskShape) => (e: any, ctx: any, g: any) => {
  track(e, ctx, g);
  if (isDrag(e, g)) previewGesture(ctx, ...shapeOf(make(g, e)));
  return g;
};

export const svg = (g: any, tag: string, a: Record<string, string | number>): any => {
  const x = (g.ownerDocument as Document & globalThis.Document).createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(a)) x.setAttribute(k, String(v));
  g.append(x);
  return x;
};
/** the gesture's outline over the print, in screen coordinates (document px → vp.toScreen of fractions) */
const outline = (kind: 'linear' | 'radial' | 'paint') => (g: any, vp: any, _s: any, gs: any) => {
  if (!gs || !vp?.natural) return;
  const [w, h] = vp.natural();
  if (!w || !h) return;
  const at = (x: number, y: number): [number, number] => vp.toScreen(x / w, y / h);
  if (kind === 'paint') {
    const pts = (gs.points as Pt3[]).map(([x, y]) => at(x, y).join(',')).join(' ');
    svg(g, 'polyline', { points: pts, class: 'cb-stack-gesture' });
    return;
  }
  if (gs.x1 === undefined) return;
  const [ax, ay] = at(gs.x0, gs.y0);
  const [bx, by] = at(gs.x1, gs.y1);
  if (kind === 'linear') svg(g, 'line', { x1: ax, y1: ay, x2: bx, y2: by, class: 'cb-stack-gesture' });
  else svg(g, 'ellipse', { cx: (ax + bx) / 2, cy: (ay + by) / 2, rx: Math.abs(bx - ax) / 2, ry: Math.abs(by - ay) / 2, class: 'cb-stack-gesture' });
};
export const track = (e: any, _ctx: any, g: any) => {
  g.x1 = e.x;
  g.y1 = e.y;
  return g;
};
const hasKind = (k: string): boolean => (componentKinds() as readonly string[]).includes(k);

// ── the Edit Mask tool: handles of the selected layer's gradients and shapes (CHB-049, MASK-3) ──

/** screen px per document px of the viewer (the shown image's px; the mask tools' convention) */
const pxPerDoc = (vp: any): number => {
  const [w, h] = vp?.natural?.() ?? [0, 0];
  if (!w || !h) return 1;
  return Math.abs(vp.toScreen(1 / w, 0)[0] - vp.toScreen(0, 0)[0]) || 1;
};
/** the parts with handles of the selected layer's mask, the active one first */
function editable(s: any, d: Document | undefined): [Id, { kind: string; params: Params }][] {
  const t = selectedIn(s);
  const mk = d && t ? maskOf(d, t) : null;
  if (!mk) return [];
  const parts = mk.components.filter(([, c]) => c.enabled && hasHandles(c.kind)) as [Id, { kind: string; params: Params }][];
  const active = view(s).mask.edit;
  return [...parts.filter(([id]) => id === active), ...parts.filter(([id]) => id !== active)];
}
const shapeSvg = (g: any, kind: string, p: Params, at: (x: number, y: number) => [number, number], cls: string): void => {
  if (kind === 'linear') {
    const a = p['from'] as { x: number; y: number }, b = p['to'] as { x: number; y: number };
    const [ax, ay] = at(a.x, a.y), [bx, by] = at(b.x, b.y);
    svg(g, 'line', { x1: ax, y1: ay, x2: bx, y2: by, class: cls });
    return;
  }
  const box = p['box'] as { x: number; y: number; w: number; h: number };
  const t = ((((p['angle_deg'] as number | undefined) ?? 0)) * Math.PI) / 180;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const pt = (u: number, v: number): string => at(cx + u * Math.cos(t) - v * Math.sin(t), cy + u * Math.sin(t) + v * Math.cos(t)).join(',');
  const n = kind === 'rect' ? 4 : 48;
  const pts = Array.from({ length: n }, (_, i) => {
    if (kind === 'rect') return pt(([-1, 1, 1, -1][i]! * box.w) / 2, ([-1, -1, 1, 1][i]! * box.h) / 2);
    const a = (2 * Math.PI * i) / n;
    return pt((Math.cos(a) * box.w) / 2, (Math.sin(a) * box.h) / 2);
  });
  svg(g, 'polygon', { points: pts.join(' '), class: cls });
};
const editOverlay = (g: any, vp: any, s: any) => {
  if (!vp?.natural) return;
  const [w, h] = vp.natural();
  if (!w || !h) return;
  const at = (x: number, y: number): [number, number] => vp.toScreen(x / w, y / h);
  const parts = editable(s, sel.doc(s));
  const knob = KNOB_PX / pxPerDoc(vp);
  parts.forEach(([, c], i) => {
    shapeSvg(g, c.kind, c.params, at, i === 0 ? 'cb-stack-part is-active' : 'cb-stack-part');
    if (i !== 0) return;
    const hs = handlesOf(c.kind, c.params as Record<string, unknown>, knob);
    const rot = hs.find((x) => x.id === 'rotate');
    if (rot) {
      const top = hs.find((x) => x.id === 'n')!;
      const [ax, ay] = at(top.x, top.y), [bx, by] = at(rot.x, rot.y);
      svg(g, 'line', { x1: ax, y1: ay, x2: bx, y2: by, class: 'cb-stack-part' });
    }
    for (const x of hs) {
      const [sx, sy] = at(x.x, x.y);
      if (x.id === 'rotate' || x.id === 'move') svg(g, 'circle', { cx: sx, cy: sy, r: x.id === 'move' ? 5 : 4.5, class: `cb-stack-handle is-${x.id}`, 'data-handle': x.id });
      else svg(g, 'rect', { x: sx - 4, y: sy - 4, width: 8, height: 8, class: `cb-stack-handle is-${x.id}`, 'data-handle': x.id });
    }
  });
};
interface EditDrag { cid: Id; kind: string; p0: Record<string, unknown>; h: HandleId; start: { x: number; y: number }; path: (string | number)[]; W: number; H: number; snap: number }
function editTool(): ToolTable[string] {
  return {
    label: 'Edit Mask on Picture', icon: 'move', key: 'V', cursor: 'default',
    enabled: (s: any) => editable(s, sel.doc(s)).length > 0,
    why: 'The selected layer\'s mask has no gradient or shape to move',
    overlay: editOverlay,
    on: {
      escape: 'tool.none',
      // a handle of the active part first, then any part's handles, then a part's inside (a move)
      down: (e: any, ctx: any): EditDrag | false => {
        const fr = frame(ctx);
        if (!fr) return false;
        const k = pxPerDoc(ctx.vp);
        const [W, H] = ctx.vp?.natural?.() ?? [0, 0];
        for (const [cid, c] of editable(ctx.state, fr.d)) {
          const h = hitHandle(c.kind, c.params as Record<string, unknown>, e.x, e.y, HIT_PX / k, KNOB_PX / k);
          if (!h) continue;
          if (view(ctx.state).mask.edit !== cid) ctx.set({ stack: { mask: { edit: cid } } });
          return { cid, kind: c.kind, p0: c.params as Record<string, unknown>, h, start: { x: e.x, y: e.y }, path: storePath(fr.f, fr.d, `${cid}.params`), W, H, snap: SNAP_PX / k };
        }
        return false;
      },
      drag: (e: any, ctx: any, g: EditDrag) => {
        ctx.rt.store.preview(g.path, dragHandle(g.kind, g.p0, g.h, g.start, { x: e.x, y: e.y }, { shift: e.shift, alt: e.alt, W: g.W, H: g.H, snap: g.snap }));
        return g;
      },
      up: (_e: any, ctx: any, g: EditDrag) => {
        if (ctx.rt.store.previewing) ctx.commit(`${handleWords(g.h)} the ${(KIND_WORDS[g.kind] ?? g.kind).toLowerCase()}`);
      },
    },
  };
}

export function maskTools(): ToolTable {
  return {
    'mask-linear': {
      label: 'Linear Gradient Mask', icon: 'linear', cursor: 'crosshair', ...needFrame,
      overlay: outline('linear'),
      on: {
        down: (e: any) => ({ x0: e.x, y0: e.y, sx0: e.sx, sy0: e.sy }),
        drag: liveDrag(linearShape),
        // a click is not a gradient: nothing happens and the tool stays for the drag
        up: (e: any, ctx: any, g: any) => {
          if (!isDrag(e, g)) return dropPreview(ctx);
          if (shape(ctx, linearShape(g, e))) disarm(ctx);
        },
      },
    },
    'mask-radial': {
      label: 'Radial Mask', icon: 'radial', key: 'M', cursor: 'crosshair', ...needFrame,
      overlay: outline('radial'),
      on: {
        down: (e: any) => ({ x0: e.x, y0: e.y, sx0: e.sx, sy0: e.sy }),
        drag: liveDrag(radialShape),
        up: (e: any, ctx: any, g: any) => {
          if (!isDrag(e, g)) return dropPreview(ctx);
          if (shape(ctx, radialShape(g, e))) disarm(ctx);
        },
      },
    },
    'mask-paint': {
      label: 'Brush Mask', icon: 'brush', key: 'K', cursor: 'crosshair', ...needFrame,
      overlay: outline('paint'),
      on: {
        enter: (ctx: any) => armBrush(ctx),
        exit: (ctx: any) => ctx.set({ stack: { mask: { armedFor: null } } }),
        // strokes go to the layer the brush was armed for; another layer selected since: the brush goes, nothing is painted
        down: (e: any, ctx: any) => {
          const a = view(ctx.state).mask.armedFor;
          const now = armedHere(ctx);
          if (a && (a.f !== now.f || a.layer !== now.layer)) {
            disarm(ctx);
            return false;
          }
          return { points: [[e.x, e.y, e.pressure || 1]] };
        },
        drag: (e: any, ctx: any, g: any) => {
          g.points.push([e.x, e.y, e.pressure || 1]);
          previewGesture(ctx, ...shapeOf(brushShape(ctx, g.points)));
          return g;
        },
        up: (_e: any, ctx: any, g: any) => {
          const layer = shape(ctx, brushShape(ctx, g.points));
          // the first stroke with no layer selected made one: the brush now paints that one
          if (layer) armBrush(ctx, { f: sel.current(ctx.state), layer });
        },
      },
    },
    'mask-luminance': {
      label: 'Luminance Range Mask', icon: 'luma', cursor: 'crosshair', ...needFrame,
      // a click adds a luminance range (the highlights by default); its band is set in the masks panel
      on: {
        down: (_e: any, ctx: any) => {
          if (drawn(ctx, 'luminance', { ...componentDefaults('luminance'), above: 0.5, softness: 0.1 })) disarm(ctx);
          return false;
        },
      },
    },
    'mask-edit': editTool(),
    'mask-colour': {
      label: 'Colour Range Mask (eyedropper)', icon: 'colorrange', cursor: 'crosshair',
      enabled: (s: any) => hasKind('colour') && !!sel.doc(s),
      why: 'Colour ranges arrive with the colour mask component (mask.colour)',
      // a click samples the colour under it from the image the mask reads: into the armed component (Sample in the
      // masks panel), else a new colour range on the selected layer's mask; one sample, then no tool
      on: { down: (e: any, ctx: any) => void (hasKind('colour') && eyedropper(ctx, e.x, e.y)) },
    },
  };
}

export { blendChoices };
