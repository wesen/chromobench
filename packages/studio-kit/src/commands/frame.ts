// cb.core's frame commands (CHB-029 item 3: one declarative table per area): flag, rate, label and keywords (the
// ratings: the document tier, one undo step each), select and step through the library, re-open as photo or
// negative, remove, rotate and flip.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CommandTable } from '@chromobench/shell';
import { sel, type CatalogFrame, type CbState } from '../sel.ts';
import { flag, needFrame, openFrame, orientCurrent, rate, reopenAs, step, studioOf } from './env.ts';

export const frameCommands = (): CommandTable<CbState> => ({
  'frame.pick': { label: 'Flag as Pick', ...needFrame, run: ctx => flag(ctx, 'pick', 'Flag as Pick') },
  'frame.reject': { label: 'Reject', ...needFrame, run: ctx => flag(ctx, 'reject', 'Reject') },
  'frame.unflag': { label: 'Unflag', ...needFrame, run: ctx => flag(ctx, null, 'Unflag') },
  'frame.rate': {
    label: 'Set Stars',
    palette: false,
    ...needFrame,
    run: (ctx, n: number) => rate(ctx, `${n} Stars`, sel.targets(ctx.state), () => ({ stars: n })),
  },
  'frame.label': {
    label: 'Set Colour Label',
    palette: false,
    ...needFrame,
    run: (ctx, colour: string | null) => rate(ctx, `Label ${colour ?? 'none'}`, [sel.current(ctx.state)!], r => ({ label: r.label === colour ? null : colour })),
  },
  'frame.keywords': {
    label: 'Set Keywords',
    palette: false,
    ...needFrame,
    run: (ctx, keywords: string[]) => rate(ctx, `Keywords ${keywords.join(', ') || 'none'}`, sel.targets(ctx.state), () => ({ keywords: [...keywords] })),
  },
  'frame.select': {
    label: 'Select Frame',
    palette: false,
    run: (ctx, id: string) => {
      ctx.cancel();
      ctx.set({ ui: { selection: { ids: [id], primary: id, anchor: id }, showProposal: null } });
    },
  },
  'frame.reopenAsPhoto': {
    label: 'Re-open as Photo',
    enabled: (s: any) => !!sel.doc(s),
    why: 'Open a frame first',
    hidden: (s: any) => sel.kind(s, sel.current(s)) === 'photo',
    run: (ctx, item?: CatalogFrame) => reopenAs(ctx, item?.id ?? sel.current(ctx.state), 'photo'),
  },
  'frame.reopenAsNegative': {
    label: 'Re-open as Negative',
    enabled: (s: any) => !!sel.doc(s),
    why: 'Open a frame first',
    hidden: (s: any) => sel.kind(s, sel.current(s)) === 'negative',
    run: (ctx, item?: CatalogFrame) => reopenAs(ctx, item?.id ?? sel.current(ctx.state), 'negative'),
  },
  'frame.remove': {
    label: (s: any) => (sel.selection(s).length > 1 ? `Remove ${sel.selection(s).length} Frames from Library` : 'Remove from Library'),
    ...needFrame,
    run: ctx => {
      const ids = sel.targets(ctx.state);
      if (!ids.length) return;
      const names = ids.map(id => ctx.state.catalog?.frames?.[id]?.name ?? id);
      studioOf(ctx).remove(ids);
      ctx.toast(`${names.length === 1 ? `Removed ${names[0]}` : `Removed ${names.length} frames`}: open the file again to get it back, with its edits`, { kind: 'info' });
    },
  },
  // CHB-031 F20: turn or mirror the frame shown (geometry.orientation; a strip's frames may come sideways)
  'frame.rotateLeft': { label: 'Rotate Left', ...openFrame, run: ctx => orientCurrent(ctx, 'ccw90', 'Rotate Left') },
  'frame.rotateRight': { label: 'Rotate Right', ...openFrame, run: ctx => orientCurrent(ctx, 'cw90', 'Rotate Right') },
  'frame.flip': { label: 'Flip Left to Right', ...openFrame, run: ctx => orientCurrent(ctx, 'flipH', 'Flip') },
  'frame.next': { label: 'Next Frame', run: ctx => step(ctx, 1) },
  'frame.previous': { label: 'Previous Frame', run: ctx => step(ctx, -1) },
});
