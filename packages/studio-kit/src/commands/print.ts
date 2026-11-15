// cb.core's print commands (CHB-029 item 3: one declarative table per area): history jumps, snapshots, apply print settings to the selection, probe pins, the ring-around choice, exposures, save.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getPath, type Vec3 } from '@chromobench/contract';
import type { CommandTable } from '@chromobench/shell';
import { sel, type CbState } from '../sel.ts';
import { diffRecipes, PRINT_SETTINGS } from '../model/recipes.ts';
import { nextExposureId } from '../model/tools.ts';
import { needFrame, recipeOf, studioOf } from './env.ts';

export const printCommands = (): CommandTable<CbState> => ({
  'history.jump': {
    label: 'Jump in History',
    palette: false,
    run: (ctx, f: string, index: number) => studioOf(ctx).route.jump(f, index),
  },
  'snapshot.new': {
    label: 'New Snapshot',
    ...needFrame,
    run: (ctx, name?: string) => {
      const f = sel.current(ctx.state)!;
      const e = studioOf(ctx).frames.get(f);
      if (!e) return;
      const list = sel.snapshots(ctx.state, f);
      const snap = { id: `s${list.length + 1}`, name: name ?? `Snapshot ${list.length + 1}`, ts: ctx.rt.clock.now(), stateHash: e.log.stateHash, recipe: e.log.committed };
      ctx.tx(`Snapshot "${snap.name}"`, (t: any) => {
        t.$set(['snapshots', f], [...list, snap]);
      });
    },
  },
  'snapshot.restore': {
    label: 'Restore Snapshot',
    palette: false,
    run: (ctx, id: string) => {
      const f = sel.current(ctx.state)!;
      const snap = (sel.snapshots(ctx.state, f)).find((x: any) => x.id === id);
      const e = studioOf(ctx).frames.get(f);
      if (!snap || !e) return;
      const ms = diffRecipes(e.log.committed, snap.recipe);
      if (ms.length) studioOf(ctx).route.applyMutations(f, ms, `Restore "${snap.name}"`);
    },
  },
  'print.applyToSelection': {
    label: 'Apply Print Settings to Selection',
    enabled: (s: any) => sel.selection(s).length > 1,
    why: 'Select the frames to copy the settings to (and the source as primary)',
    run: ctx => {
      const src = recipeOf(ctx, sel.current(ctx.state)!);
      if (!src) return;
      ctx.tx('Apply Print Settings', (t: any) => {
        for (const id of sel.selection(ctx.state)) {
          if (id === sel.current(ctx.state) || !t.recipes[id]) continue;
          for (const p of PRINT_SETTINGS) t.$set(['recipes', id, ...p.split('.')], getPath(src, p));
        }
      });
    },
  },
  'probe.pin': {
    label: 'Pin Probe',
    enabled: (s: any) => !!sel.current(s) && !!s.ui?.probe,
    why: 'Hover the print with the probe tool first',
    run: ctx => {
      const f = sel.current(ctx.state)!;
      const [x, y] = ctx.state.ui.probe!;
      const n = Object.keys(recipeOf(ctx, f)?.probes ?? {}).length + 1;
      ctx.tx(`Pin probe ${n}`, (t: any) => {
        t.$set(['recipes', f, 'probes', `p${n}`], { x, y, r: 2 });
      });
    },
  },
  'ring.apply': {
    label: 'Use This Print',
    palette: false,
    run: (ctx, offset: Vec3, label = 'Ring-around') => {
      const f = sel.current(ctx.state)!;
      const r = recipeOf(ctx, f);
      if (!r) return;
      const l = r.print.lights.logH;
      ctx.tx(label, (t: any) => {
        t.$set(['recipes', f, 'print', 'lights', 'logH'], l.map((x, i) => Number((x + offset[i]!).toFixed(6))));
      });
      ctx.set({ ui: { tool: null } });
    },
  },
  'exposure.add': {
    label: 'Add Exposure',
    ...needFrame,
    run: (ctx, kind: 'dodge' | 'burn' | 'flash' = 'burn') => {
      const f = sel.current(ctx.state)!;
      const r = recipeOf(ctx, f)!;
      const id = nextExposureId(r, kind);
      studioOf(ctx).route.applyMutations(f, [{ op: 'exposure.add', exposure: { id, kind, stops: kind === 'flash' ? null : 0.5, ...(kind === 'flash' ? { time_s: 2 } : {}) } }], `Add ${kind} ${id}`);
    },
  },
  'exposure.remove': {
    label: 'Remove Exposure',
    palette: false,
    run: (ctx, id: string) => studioOf(ctx).route.applyMutations(sel.current(ctx.state)!, [{ op: 'exposure.remove', id }], `Remove exposure ${id}`),
  },
  'output.save': {
    label: 'Save the Print',
    // in menus as File ▸ Export… (file.export, CHB-027), which runs this where the host has no export dialog
    ...needFrame,
    run: ctx => {
      const save = ctx.services['save'] as ((f: string) => unknown) | undefined;
      if (save) return save(sel.current(ctx.state)!);
      ctx.toast('Export with colour management comes with CHB-011', { kind: 'info' });
      return null;
    },
  },
});
