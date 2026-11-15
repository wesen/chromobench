// cb.kits.stack: the command table and the mask tools. Every edit is one transaction of the frame's document in the
// log (studio.commit: the four mutations; a refusal by the document's rules is a toast, never a half edit). A
// command acts on the selected entry of the current frame unless it is given an id, so the menus, the palette, the
// keys, the panels' buttons and an agent's `run('layer.toggle', 'b1')` are the same action.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CommandTable, ToolTable } from '@chromobench/shell';
import type { Document, EntryBlend, MaskCombine, MaskComponentKind, Params, StageName } from '@chromobench/contract';
import { Coll, set, type Id, type Mutation } from '@chromobench/values';
import { bakeLink, pitches, removeLink, setLinkAmount } from '@chromobench/contract';
import type { Studio } from '../../../src/studio.ts';
import { sel } from '../../../src/sel.ts';
import { findEntry } from '../../../src/model/doc.ts';
import { maskComponent, type MaskShape, type Pt3 } from '../../../src/model/tools.ts';
import {
  addComponent, addLayer, blendChoices, componentKinds, deleteEntries, detachMask, dropOn, duplicateEntry, groupEntries, KIND_WORDS, maskGesture,
  maskOf, newMaskOn, nudgeEntry, opWord, renameEntry, setAmount, setBlend, toggleEntry, ungroup, componentDefaults, formatAmount, linkKey,
} from './model.ts';
import { selectedIn, STACK_STATE, type StackView } from './state.ts';

const studioOf = (ctx: any): Studio => {
  const s = ctx.services?.studio as Studio | undefined;
  if (!s) throw new Error('No studio service: start the app with studio.services()');
  return s;
};
/** the current frame and its committed document */
const frame = (ctx: any): { f: string; d: Document } | null => {
  const f = sel.current(ctx.state);
  const d = f ? studioOf(ctx).doc(f) : undefined;
  return f && d ? { f, d } : null;
};
const view = (s: any): StackView => ({ ...STACK_STATE.stack, ...(s?.stack ?? {}) });
/** the entry a command acts on: the id given, else the selected entry of the current frame */
const target = (ctx: any, id?: Id | null): Id | null => id ?? selectedIn(ctx.state);
const words = (e: unknown): string => String((e as { diag?: { message?: string } })?.diag?.message ?? (e as Error)?.message ?? e);

/** one step on the current frame; a refusal is said, not thrown */
function commit(ctx: any, f: string, ms: readonly Mutation[], label: string): boolean {
  if (!ms.length) return false;
  try {
    studioOf(ctx).commit(f, ms, label, { source: { kind: 'stack' } });
    return true;
  } catch (e) {
    ctx.toast(`${label}: ${words(e)}`, { kind: 'warn' });
    return false;
  }
}
const select = (ctx: any, f: string, id: Id | null): void => ctx.set({ stack: { selected: { [f]: id } } });
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
export const MASK_TOOLS = ['mask-linear', 'mask-radial', 'mask-paint', 'mask-luminance', 'mask-colour'] as const;

function drawn(ctx: any, kind: MaskComponentKind, params: Params): void {
  const studio = studioOf(ctx);
  const fr = frame(ctx);
  const e = fr ? studio.frames.get(fr.f) : undefined;
  if (!fr || !e) return;
  const t = selectedIn(ctx.state);
  const feather_mm = kind === 'luminance' || kind === ('colour' as MaskComponentKind) ? 0 : Number(((8 * pitches(fr.d, e.graph).paper) / 1000).toFixed(4));
  const r = maskGesture(fr.d, t, kind, params, { combine: view(ctx.state).mask.combine, feather_mm });
  if (commit(ctx, fr.f, r.mutations, r.label)) select(ctx, fr.f, r.layer);
}
const shape = (ctx: any, s: MaskShape): void => {
  const [kind, params] = maskComponent(s);
  // the radial component (a soft ellipse) where the catalogue has it; the hard ellipse before
  if (kind === 'ellipse' && hasKind('radial')) return drawn(ctx, 'radial' as MaskComponentKind, { ...params, feather: 0.5 });
  drawn(ctx, kind, params);
};

const svg = (g: any, tag: string, a: Record<string, string | number>): any => {
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
const track = (e: any, _ctx: any, g: any) => {
  g.x1 = e.x;
  g.y1 = e.y;
  return g;
};
const hasKind = (k: string): boolean => (componentKinds() as readonly string[]).includes(k);

export function maskTools(): ToolTable {
  return {
    'mask-linear': {
      label: 'Linear Gradient Mask', icon: 'linear', cursor: 'crosshair', ...needFrame,
      overlay: outline('linear'),
      on: {
        down: (e: any) => ({ x0: e.x, y0: e.y }),
        drag: track,
        up: (e: any, ctx: any, g: any) => shape(ctx, { kind: 'linear', from: [g.x0, g.y0], to: [e.x, e.y] }),
      },
    },
    'mask-radial': {
      label: 'Radial Mask', icon: 'radial', key: 'M', cursor: 'crosshair', ...needFrame,
      overlay: outline('radial'),
      on: {
        down: (e: any) => ({ x0: e.x, y0: e.y }),
        drag: track,
        up: (e: any, ctx: any, g: any) => shape(ctx, { kind: 'ellipse', cx: (g.x0 + e.x) / 2, cy: (g.y0 + e.y) / 2, rx: Math.max(2, Math.abs(e.x - g.x0) / 2), ry: Math.max(2, Math.abs(e.y - g.y0) / 2) }),
      },
    },
    'mask-paint': {
      label: 'Brush Mask', icon: 'brush', key: 'K', cursor: 'crosshair', ...needFrame,
      overlay: outline('paint'),
      on: {
        down: (e: any) => ({ points: [[e.x, e.y, e.pressure || 1]] }),
        drag: (e: any, _ctx: any, g: any) => {
          g.points.push([e.x, e.y, e.pressure || 1]);
          return g;
        },
        up: (_e: any, ctx: any, g: any) => shape(ctx, { kind: 'stroke', points: g.points, radius: view(ctx.state).mask.radius, hardness: 0.5, mode: 'add' }),
      },
    },
    'mask-luminance': {
      label: 'Luminance Range Mask', icon: 'luma', cursor: 'crosshair', ...needFrame,
      // a click adds a luminance range (the highlights by default); its band is set in the masks panel
      on: { down: (_e: any, ctx: any) => void drawn(ctx, 'luminance', { ...componentDefaults('luminance'), above: 0.5, softness: 0.1 }) },
    },
    'mask-colour': {
      label: 'Colour Range Mask', icon: 'colorrange', cursor: 'crosshair',
      enabled: (s: any) => hasKind('colour') && !!sel.doc(s),
      why: 'Colour ranges arrive with the colour mask component (mask.colour)',
      on: { down: (_e: any, ctx: any) => void (hasKind('colour') && drawn(ctx, 'colour' as MaskComponentKind, componentDefaults('colour' as MaskComponentKind))) },
    },
  };
}

export { blendChoices };
