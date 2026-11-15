// cb.core's view commands (CHB-029 item 3: one declarative table per area): the library mode, the view (print, negative, dyes, classes), before / after and side by side, the step of a stepped layout.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CommandTable } from '@chromobench/shell';
import type { CbState } from '../sel.ts';
import { type ViewMode } from '../model/recipes.ts';
import { needFrame, step } from './env.ts';

export const viewCommands = (): CommandTable<CbState> => ({
  'view.mode': { label: 'Library View', palette: false, run: (ctx, mode: string) => ctx.set({ view: { mode } }) },
  'view.show': { label: 'Show View', palette: false, run: (ctx, v: ViewMode) => ctx.set({ view: { view: v } }) },
  'view.beforeAfter': {
    label: 'Before / After',
    ...needFrame,
    checked: (s: any) => s.view?.compare !== 'off',
    run: ctx => ctx.set({ view: { compare: ({ off: 'split', split: 'before', before: 'off' } as Record<string, string>)[ctx.state.view.compare] ?? 'off' } }),
  },
  'view.sideBySide': { label: 'Side by Side', ...needFrame, run: ctx => ctx.set({ view: { compare: ctx.state.view.compare === 'lr' ? 'off' : 'lr' } }) },
  'step.go': { label: 'Go to Step', palette: false, run: (ctx, id: string) => ctx.set({ view: { step: id } }) },
});
