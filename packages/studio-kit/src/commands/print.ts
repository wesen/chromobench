// cb.core's print commands (CHB-029 item 3: one declarative table per area): history jumps, snapshots, apply print
// settings to the selection, probe pins, the ring-around choice, save (darkroom layers: the stack kit's layer.*). Every edit is a transaction
// of the frame's document (several frames: one step).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from '@chromobench/contract';
import type { CommandTable } from '@chromobench/shell';
import { sel, type CbState } from '../sel.ts';
import { DOCS, LIGHTS_PATH, linksOf, MODE_PATH, nextId, storePath, type EnlargerMode } from '../model/doc.ts';
import { modeSwitch, referenceOpticsShift, type DarkroomMath } from '../model/enlarger-mode.ts';
import { copySettings, settingsPlan, type SettingCopy } from '../model/settings.ts';
import { modelAt } from '../kit/args.ts';
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
    label: 'Apply Print Settings to Selection…',
    enabled: (s: any) => sel.selection(s).length > 1,
    why: 'Select the frames to copy the settings to (and the source as primary)',
    /**
     * The print settings of the frame shown (the selection's primary, outlined in the film strip) onto the other
     * selected frames, one undo step. CHB-046 (P9-9): it used to copy at once from whichever frame was clicked last and
     * overwrote a corrected frame; it now says in the page which frame it copies from, what it copies and onto which
     * frames, and copies only when he says so. `{ ask: false }` (an agent, a test) copies without asking.
     */
    run: async (ctx, o: { ask?: boolean } = {}) => {
      const cur = sel.current(ctx.state)!;
      const src = docOf(ctx, cur);
      if (!src) return null;
      const name = (f: string): string => ctx.state.catalog?.frames?.[f]?.name ?? f;
      const targets = sel.selection(ctx.state).filter((id) => id !== cur && !!docOf(ctx, id));
      const plan = settingsPlan(src, targets.map((id) => ({ name: name(id), doc: docOf(ctx, id)! })), (p) => modelAt(p, src));
      if (!plan.length) {
        ctx.toast(`The selected frames already print like ${name(cur)}`, { kind: 'info' });
        return null;
      }
      if (o.ask !== false) {
        const yes = await ctx.rt.chrome.dialog({
          title: `Apply the print settings of ${name(cur)}?`,
          body: (el: HTMLElement) => applyBody(el, name(cur), targets.map(name), plan),
          buttons: [{ label: 'Cancel', value: 'cancel' }, { label: `Apply to ${targets.length} frame${targets.length === 1 ? '' : 's'}`, value: 'apply', primary: true }],
        }).result;
        if (yes !== 'apply') return null;
      }
      // the documents as they are now (the dialog was open a while), one step over every target frame
      const from = docOf(ctx, cur);
      if (!from) return null;
      ctx.tx(`Apply print settings of ${name(cur)}`, (t: any) => {
        for (const id of targets) {
          const to = docOf(ctx, id);
          if (!to) continue;
          for (const m of copySettings(from, to)) if (m.op === 'set') t.$set(storePath(id, to, m.path), m.value);
        }
      });
      return { from: cur, to: targets, copied: plan.map((x) => x.label) };
    },
  },
  'print.enlargerMode': {
    label: 'Enlarger Mode',
    palette: false,
    ...needFrame,
    /**
     * Real or normalised enlarger, the print kept (CHB-046, CHB-028 F44): the mode's shift goes into the printer lights
     * (core's numbers through services.darkroomMath; the optics alone without them), one step.
     */
    run: (ctx, mode: EnlargerMode) => {
      const f = sel.current(ctx.state)!;
      const d = docOf(ctx, f);
      if (!d || (mode !== 'real' && mode !== 'normalised')) return null;
      const math = (ctx.services as { darkroomMath?: DarkroomMath }).darkroomMath;
      const r = modeSwitch(d, mode, (x) => (math ? math.modeShift(x) : referenceOpticsShift(x)), linksOf(ctx.state));
      if (!r.mutations.length) return null;
      ctx.tx(mode === 'real' ? 'Real enlarger (the print kept)' : 'Normalised enlarger (the print kept)', (t: any) => {
        for (const m of r.mutations) if (m.op === 'set') t.$set(storePath(f, d, m.path), m.value);
      }, { source: { kind: 'control', control: MODE_PATH } });
      if (r.lost) ctx.toast(`The printer lights are at their limit: the print is ${Math.abs(r.lost / Math.log10(2)).toFixed(1)} stops ${r.lost > 0 ? 'lighter' : 'darker'} than before`, { kind: 'warn' });
      return { mode, shift: r.shift };
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

/** The confirmation's text: which frame the settings come from, onto which frames, and what is copied (in his units). */
function applyBody(el: HTMLElement, from: string, to: string[], plan: SettingCopy[]): Node {
  const doc = el.ownerDocument;
  const p = (text: string, cls?: string): HTMLElement => {
    const x = doc.createElement('p');
    x.textContent = text;
    if (cls) x.className = cls;
    return x;
  };
  const box = doc.createElement('div');
  box.className = 'cb-apply-settings';
  box.append(p(`From ${from}: the frame shown, outlined in the film strip.`), p(`Onto ${to.length === 1 ? to[0] : `${to.length} frames: ${to.join(', ')}`}.`));
  const ul = doc.createElement('ul');
  for (const c of plan) {
    const li = doc.createElement('li');
    li.dataset['path'] = c.path;
    li.textContent = `${c.label}: ${c.value}${c.changes.length < to.length ? ` (changes ${c.changes.join(', ')})` : ''}`;
    ul.append(li);
  }
  box.append(p('These settings are copied; the frames keep their other edits:'), ul, p('One undo takes it back.', 'cb-dim'));
  return box;
}
