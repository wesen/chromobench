// cb.core's host commands (CHB-029 items 1 and 3): the host's actions (CHB-027: the top bar folded into File and View)
// as one declarative table. Each requires its capability ('host.openFiles': a function of the StudioHost the host
// passes at mount, services.host); without it the command is hidden and refuses to run, so a host without them (the
// dev host, tests) shows none.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CommandTable, Ctx } from '@chromobench/shell';
import { sel, type CbState } from '../sel.ts';
import type { StudioHost } from '../studio.ts';
import { needFrame } from './env.ts';

/** the host's capabilities in a handler (a command that runs has the ones it requires) */
const host = (ctx: Ctx<CbState>): StudioHost => ctx.host as StudioHost;

export const hostCommands = (): CommandTable<CbState> => ({
  'file.open': { label: 'Open Files…', requires: 'host.openFiles', run: ctx => host(ctx).openFiles!() },
  'file.openFolder': { label: 'Open Folder…', requires: 'host.openFolder', run: ctx => host(ctx).openFolder!() },
  'file.reopenFolder': {
    label: s => `Reopen ${sel.host(s)?.folder ?? 'Last Folder'}`,
    requires: 'host.reopenFolder',
    hidden: s => !sel.host(s)?.folder,
    run: ctx => host(ctx).reopenFolder!(),
  },
  'file.openAs.auto': { label: 'Photo or Negative: Guess', palette: false, requires: 'host.openFiles', checked: s => (sel.prefs(s).openAs ?? 'auto') === 'auto', run: ctx => ctx.set({ prefs: { openAs: 'auto' } }) },
  'file.openAs.photo': { label: 'Open as Photos', palette: false, requires: 'host.openFiles', checked: s => sel.prefs(s).openAs === 'photo', run: ctx => ctx.set({ prefs: { openAs: 'photo' } }) },
  'file.openAs.negative': { label: 'Open as Negatives', palette: false, requires: 'host.openFiles', checked: s => sel.prefs(s).openAs === 'negative', run: ctx => ctx.set({ prefs: { openAs: 'negative' } }) },
  // F18: Photos / Negatives last until the studio restarts (then Guess), unless kept
  'file.openAs.keep': { label: 'Keep This Choice After Restart', palette: false, requires: 'host.openFiles', checked: s => !!sel.prefs(s).openAsKeep, run: ctx => ctx.set({ prefs: { openAsKeep: !sel.prefs(ctx.state).openAsKeep } }) },
  'file.dust': {
    label: 'Heal Dust on Open',
    requires: 'host.dust',
    checked: s => !!sel.prefs(s).dust,
    run: ctx => {
      const on = !sel.prefs(ctx.state).dust;
      ctx.set({ prefs: { dust: on } });
      return host(ctx).dust!(on);
    },
  },
  // Export…: the host's dialog (format, colour space), else output.save (the Output panel's Save)
  'file.export': { label: 'Export…', ...needFrame, run: ctx => (ctx.rt.capable('host.exportPrint') ? host(ctx).exportPrint!() : ctx.run('output.save')) },
  'file.saveRecipe': { label: 'Save Recipe', ...needFrame, requires: 'host.saveRecipe', run: ctx => host(ctx).saveRecipe!() },
  'view.layout': {
    label: 'Layout…',
    requires: 'host.setLayout',
    hidden: s => !(sel.host(s)?.layouts?.length ?? 0),
    run: async (ctx, id?: string) => {
      if (typeof id === 'string') return host(ctx).setLayout!(id);
      const h = sel.host(ctx.state);
      const pick = await ctx.rt.chrome.dialog({
        title: 'Layout of the studio',
        buttons: (h?.layouts ?? []).map(l => ({ label: l.label, value: l.id, primary: l.id === h?.layout })),
      }).result;
      if (typeof pick === 'string' && pick !== h?.layout) return host(ctx).setLayout!(pick);
      return null;
    },
  },
});
