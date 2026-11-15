// cb.core's print commands (CHB-029 item 3: one declarative table per area): history jumps, snapshots, apply print
// settings to the selection, probe pins, the ring-around choice, save (darkroom layers: the stack kit's layer.*). Every edit is a transaction
// of the frame's document (several frames: one step).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from '@chromobench/contract';
import type { CommandTable } from '@chromobench/shell';
import { sel, type CbState } from '../sel.ts';
import { DOCS, LIGHTS_PATH, nextId, storePath } from '../model/doc.ts';
import { copySettings } from '../model/settings.ts';
import { ringLights } from '../model/tools.ts';
import { docOf, needFrame, setDoc, studioOf } from './env.ts';


export const printCommands = (): CommandTable<CbState> => ({
  'history.jump': {
    label: 'Jump in History',
    palette: false,
    run: (ctx, cursor: number) => studioOf(ctx).jump(cursor),
  },
  'snapshot.new': {
    label: 'New Snapshot',
    ...needFrame,
    run: (ctx, name?: string) => {
      const f = sel.current(ctx.state)!;
      const d = studioOf(ctx).doc(f);
      if (!d) return;
      const list = sel.snapshots(ctx.state, f);
      const snap = { id: `s${list.length + 1}`, name: name ?? `Snapshot ${list.length + 1}`, ts: ctx.rt.clock.now(), doc: d };
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
      const snap = sel.snapshots(ctx.state, f).find(x => x.id === id);
      if (!snap || !docOf(ctx, f)) return;
      // the whole document written back: its net change (diff) is the step
      ctx.tx(`Restore "${snap.name}"`, (t: any) => t.$set([DOCS, f], snap.doc));
    },
  },
  'print.applyToSelection': {
    label: 'Apply Print Settings to Selection',
    enabled: (s: any) => sel.selection(s).length > 1,
    why: 'Select the frames to copy the settings to (and the source as primary)',
    run: ctx => {
      const cur = sel.current(ctx.state)!;
      const src = docOf(ctx, cur);
      if (!src) return;
      ctx.tx('Apply Print Settings', (t: any) => {
        for (const id of sel.selection(ctx.state)) {
          const to = docOf(ctx, id);
          if (id === cur || !to) continue;
          for (const m of copySettings(src, to)) if (m.op === 'set') t.$set(storePath(id, to, m.path), m.value);
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
      const d = docOf(ctx, f);
      if (!d) return;
      const [x, y] = ctx.state.ui.probe!;
      const id = nextId(d, 'p');
      studioOf(ctx).commit(f, [{ op: 'insert', coll: 'probes', id, item: { x, y, r: 2 } }], `Pin probe ${id.slice(1)}`);
    },
  },
  'ring.apply': {
    label: 'Use This Print',
    palette: false,
    run: (ctx, offset: Vec3, label = 'Ring-around') => {
      const f = sel.current(ctx.state)!;
      const d = docOf(ctx, f);
      if (!d) return;
      setDoc(ctx, f, LIGHTS_PATH, ringLights(d, offset), label);
      ctx.set({ ui: { tool: null } });
    },
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
