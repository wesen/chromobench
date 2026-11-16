// cb.kits.stack: the kit's view state (never undone, never saved with a document): the selected entry per frame
// (the params and masks panels follow it), the collapsed groups, the mask tools' options, the HSL editor's property.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MaskCombine } from '@chromobench/contract';
import type { Id } from '@chromobench/values';
import { sel } from '../../../src/sel.ts';
import { findEntry } from '../../../src/model/doc.ts';

export const OVERLAY_MODES = ['tint', 'inverse', 'mask'] as const;
export type OverlayMode = (typeof OVERLAY_MODES)[number];
export const OVERLAY_COLOURS = ['red', 'green', 'white', 'black'] as const;
export type OverlayColour = (typeof OVERLAY_COLOURS)[number];

export interface OverlayView {
  /** shown by the photographer's choice (O) */
  on: boolean;
  mode: OverlayMode;
  colour: OverlayColour;
  /** 0…1 */
  opacity: number;
  /** a gesture previews a mask now (the masks panel sets it while a mask or component parameter is dragged) */
  live: boolean;
}
export const OVERLAY_STATE: OverlayView = { on: false, mode: 'tint', colour: 'red', opacity: 0.5, live: false };

export interface StackView {
  /** the selected entry of each frame (an id of its document) */
  selected: Record<string, Id | null>;
  /** groups shown closed in the panels */
  collapsed: Record<Id, boolean>;
  /**
   * the mask tools: how a drawn component combines with the mask, the brush radius (document px), and the colour
   * range component the eyedropper samples into (null: a click adds a new colour range), and the layer the brush was
   * armed for (frame and entry; CHB-046: a stroke on another layer disarms it instead of painting there)
   */
  mask: { combine: MaskCombine; radius: number; sample: Id | null; armedFor?: { f: string | null; layer: Id | null } | null };
  /** what the HSL editor's sliders change */
  hsl: 'hue_deg' | 'saturation' | 'lightness';
  /** the mask overlay (CHB-039): shown, how, in which colour and opacity */
  overlay: OverlayView;
  /** D5 (CHB-046): how the Enlarger lists the darkroom: his order (the stack's), or by kind */
  darkroomOrder: 'stack' | 'kind';
}
export const STACK_STATE: { stack: StackView } = { stack: { selected: {}, collapsed: {}, mask: { combine: 'add', radius: 12, sample: null }, hsl: 'saturation', overlay: { ...OVERLAY_STATE }, darkroomOrder: 'stack' } };

/** the selected entry of a frame (the current one by default), when it is still in its document */
export function selectedIn(s: any, f: string | null = sel.current(s)): Id | null {
  const id = f ? (s?.stack?.selected?.[f] ?? null) : null;
  const d = f ? sel.doc(s, f) : undefined;
  return id && d && findEntry(d, id) ? id : null;
}
