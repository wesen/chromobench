// cb.kits.stack: the kit's view state (never undone, never saved with a document): the selected entry per frame
// (the params and masks panels follow it), the collapsed groups, the mask tools' options, the HSL editor's property.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MaskCombine } from '@chromobench/contract';
import type { Id } from '@chromobench/values';
import { sel } from '../../../src/sel.ts';
import { findEntry } from '../../../src/model/doc.ts';

export interface StackView {
  /** the selected entry of each frame (an id of its document) */
  selected: Record<string, Id | null>;
  /** groups shown closed in the panels */
  collapsed: Record<Id, boolean>;
  /**
   * the mask tools: how a drawn component combines with the mask, the brush radius (document px), and the colour
   * range component the eyedropper samples into (null: a click adds a new colour range)
   */
  mask: { combine: MaskCombine; radius: number; sample: Id | null };
  /** what the HSL editor's sliders change */
  hsl: 'hue_deg' | 'saturation' | 'lightness';
}
export const STACK_STATE: { stack: StackView } = { stack: { selected: {}, collapsed: {}, mask: { combine: 'add', radius: 12, sample: null }, hsl: 'saturation' } };

/** the selected entry of a frame (the current one by default), when it is still in its document */
export function selectedIn(s: any, f: string | null = sel.current(s)): Id | null {
  const id = f ? (s?.stack?.selected?.[f] ?? null) : null;
  const d = f ? sel.doc(s, f) : undefined;
  return id && d && findEntry(d, id) ? id : null;
}
