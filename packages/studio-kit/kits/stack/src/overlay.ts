// cb.kits.stack: the mask overlay (CHB-039). The selected entry's mask shown over the picture, as Photoshop's quick
// mask and Lightroom's overlay show it: a colour where the mask acts (`tint`), where it does not (`inverse`), or the
// mask alone as grey (`mask`, white = the full effect). What is shown is the coverage the entry acts through,
// evaluated by the active engine from the compiled document (frame.mask(entry): contract Compiled.coverage under the
// display cut's geometry), at the viewer's resolution and pass; the colour and the opacity are painted on the client.
//
// It shows when the photographer turns it on (O, the masks panel, the mask chip), and by itself while a mask tool is
// the active tool or a gesture previews a mask (a component's or the mask's parameter dragged). View state
// (`stack.overlay`): never undone, never saved with a document; the agent reads it with wb.state and sets it with
// wb.run('mask.overlay.*').
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CommandTable } from '@chromobench/shell';
import type { Document, Entry } from '@chromobench/contract';
import { Coll, type Id } from '@chromobench/values';
import type { ImageHandle } from '../../../src/handles.ts';
import { frameRef } from '../../../src/handles.ts';
import { sel } from '../../../src/sel.ts';
import { OVERLAY_COLOURS, OVERLAY_MODES, OVERLAY_STATE, selectedIn, type OverlayColour, type OverlayMode, type OverlayView } from './state.ts';

export { OVERLAY_COLOURS, OVERLAY_MODES, OVERLAY_STATE, type OverlayColour, type OverlayMode, type OverlayView };

/** the overlay colours as sRGB 0…1 (red as Photoshop's quick mask) */
export const OVERLAY_RGB: Record<OverlayColour, [number, number, number]> = { red: [1, 0, 0], green: [0, 0.8, 0.2], white: [1, 1, 1], black: [0, 0, 0] };
export const MODE_WORDS: Record<OverlayMode, string> = { tint: 'Where it acts', inverse: 'Where it does not act', mask: 'Mask only' };
export const COLOUR_WORDS: Record<OverlayColour, string> = { red: 'Red', green: 'Green', white: 'White', black: 'Black' };

/** the mask tools whose activity shows the overlay by itself */
const TOOLS = new Set(['mask-linear', 'mask-radial', 'mask-paint', 'mask-luminance', 'mask-colour', 'mask-edit', 'select-rect', 'select-ellipse', 'select-lasso', 'select-polygon', 'select-wand']);

export const overlayOf = (s: any): OverlayView => ({ ...OVERLAY_STATE, ...(s?.stack?.overlay ?? {}) });

/** The masks an entry acts through, outermost group first (its groups' and its own): empty when none. */
export function coverageMasks(doc: Document, id: Id): Id[] {
  const find = (stack: Coll<Entry>, masks: Id[]): Id[] | null => {
    for (const [eid, e] of Coll.entries(stack)) {
      const ms = e.mask && Coll.has(doc.masks, e.mask) ? [...masks, e.mask] : masks;
      if (eid === id) return ms;
      if (e.kind === 'group') {
        const hit = find(e.stack, ms);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const st of Object.values(doc.stages)) {
    const hit = st ? find(st.stack, []) : null;
    if (hit) return hit;
  }
  return [];
}

/** why the overlay is shown now: 'on' (his choice), 'tool' (a mask tool), 'drag' (a mask previewed), or null */
export function overlayReason(s: any): 'on' | 'tool' | 'drag' | null {
  const o = overlayOf(s);
  if (o.on) return 'on';
  if (o.live) return 'drag';
  if (TOOLS.has(s?.ui?.tool)) return 'tool';
  return null;
}

/**
 * The viewer's cover for a shown handle: the selected entry's coverage on the frame and document the viewer shows
 * (a drag's preview, a proposal shown), when it shows the print and the overlay is wanted; null otherwise.
 */
export function maskCover(s: any, h: ImageHandle | null): { image: ImageHandle; mode: OverlayMode; colour: [number, number, number]; opacity: number } | null {
  if (!h || h.what !== 'print' || !overlayReason(s)) return null;
  const id = selectedIn(s, h.frame);
  const d = h.doc === 'initial' || h.doc === 'committed' ? sel.doc(s, h.frame) : h.doc;
  if (!id || !d || !coverageMasks(d as Document, id).length) return null;
  const o = overlayOf(s);
  return { image: frameRef(h.frame, h.doc).mask(id), mode: o.mode, colour: OVERLAY_RGB[o.colour] ?? OVERLAY_RGB.red, opacity: o.opacity };
}

const next = <T>(xs: readonly T[], x: T): T => xs[(xs.indexOf(x) + 1) % xs.length]!;
const setOverlay = (ctx: any, patch: Partial<OverlayView>): void => ctx.set({ stack: { overlay: patch } });
/** a hint when the overlay is turned on with nothing to show */
function hint(ctx: any): void {
  const s = ctx.state;
  const id = selectedIn(s);
  const d = sel.doc(s);
  if (!id) ctx.toast('Mask overlay on: select a layer with a mask to see where it acts', { kind: 'info' });
  else if (d && !coverageMasks(d, id).length) ctx.toast('Mask overlay on: the selected layer has no mask (it acts everywhere)', { kind: 'info' });
}

export function overlayCommands(): CommandTable {
  return {
    'mask.overlay.toggle': {
      label: 'Show Mask Overlay',
      checked: (s: any) => overlayOf(s).on,
      /** (on?): turn it on or off (no argument: the other way) */
      run: (ctx: any, on?: boolean) => {
        const v = typeof on === 'boolean' ? on : !overlayOf(ctx.state).on;
        setOverlay(ctx, { on: v });
        if (v) hint(ctx);
        return v;
      },
    },
    'mask.overlay.mode': {
      label: 'Mask Overlay Mode',
      /** ('tint' | 'inverse' | 'mask'): how it shows, and it shows; no argument: the next mode */
      run: (ctx: any, mode?: OverlayMode) => {
        const o = overlayOf(ctx.state);
        if (mode !== undefined && !OVERLAY_MODES.includes(mode)) {
          ctx.toast(`Mask overlay: "${String(mode)}" is not a mode (${OVERLAY_MODES.join(', ')})`, { kind: 'warn' });
          return o.mode;
        }
        const m = mode ?? next(OVERLAY_MODES, o.mode);
        setOverlay(ctx, { mode: m, on: true });
        return m;
      },
    },
    'mask.overlay.colour': {
      label: 'Mask Overlay Colour',
      /** ('red' | 'green' | 'white' | 'black'): the tint's colour; no argument: the next colour (Shift+O) */
      run: (ctx: any, colour?: OverlayColour) => {
        const o = overlayOf(ctx.state);
        if (colour !== undefined && !OVERLAY_COLOURS.includes(colour)) {
          ctx.toast(`Mask overlay: "${String(colour)}" is not a colour (${OVERLAY_COLOURS.join(', ')})`, { kind: 'warn' });
          return o.colour;
        }
        const c = colour ?? next(OVERLAY_COLOURS, o.colour);
        setOverlay(ctx, { colour: c });
        return c;
      },
    },
    'mask.overlay.opacity': {
      label: 'Mask Overlay Opacity', palette: false,
      /** (0…1, or a percentage above 1): the tint's opacity, held to 5 %…100 % */
      run: (ctx: any, x: number) => {
        const v = Number(x);
        if (!Number.isFinite(v)) return overlayOf(ctx.state).opacity;
        const f = Number(Math.min(1, Math.max(0.05, v > 1 ? v / 100 : v)).toFixed(3));
        setOverlay(ctx, { opacity: f });
        return f;
      },
    },
  };
}
