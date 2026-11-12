// cb.kits.looks: the command table (split from kit.ts, CHB-032): pick, parameters, Amount, apply to the selection,
// the roll or the library, planned and agent batches, survey, compare, snapshots, copy / paste / sync, presets.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type Cb, visibleFrames } from '../../../src/cb.ts';
import { presetToFile, readPresetFile } from './engine/files.ts';
import { bake, fromPreset, lookFrame, type AmountBase, type Look, type Preset } from './engine/look.ts';
import { changing, newBatchId } from './engine/plan.ts';
import type { KitBuilder } from '@chromobench/shell';
import { type CompareSource, plain, looksView, agentBatches } from './state.ts';
import type { LooksModel } from './model.ts';

export function addLooksCommands(c: Parameters<Parameters<KitBuilder['commands']>[0]>[0], cb: Cb, M: LooksModel): void {
  const { studioOf, paramsOf, committed, selection, rollFrameIds, plan, commit, setView, showPending, pickedLook, needLook, lookArg, copyEntries, presetFrom } = M;
  c.add('looks.pick', {
    label: 'Pick Look',
    palette: false,
    run: (ctx: any, id: string | null) => {
      ctx.rt.store.writeDoc([{ path: ['looksView', 'picked'], value: looksView(ctx.state).picked === id ? null : id }, { path: ['looksView', 'preview'], value: true }], { tier: 'view' });
    },
  })
    .add('looks.param', {
      label: 'Set Look Parameter',
      palette: false,
      run: (ctx: any, name: string, value: unknown) => {
        const l = pickedLook(ctx.state);
        if (!l) return;
        ctx.rt.store.writeDoc([{ path: ['looksView', 'params', l.id], value: { ...paramsOf(ctx.state, l), [name]: value } }], { tier: 'view' });
      },
    })
    .add('looks.amount', { label: 'Look Amount', palette: false, run: (ctx: any, pct: number) => setView(ctx, 'amount', Math.max(0, Math.min(200, Number(pct)))) })
    .add('looks.from', { label: 'Amount From', palette: false, run: (ctx: any, from: AmountBase | null) => setView(ctx, 'from', from) })
    .add('looks.preview', {
      label: 'Preview Look',
      menu: 'Looks',
      checked: (s: any) => looksView(s).preview,
      run: (ctx: any, on?: boolean) => setView(ctx, 'preview', on ?? !looksView(ctx.state).preview),
    })
    .add('looks.apply', {
      label: 'Apply Look to Selection',
      menu: 'Looks',
      ...needLook,
      enabled: (s: any) => !!cb.current(s) && !!pickedLook(s),
      run: (ctx: any, id?: string | Look, o: { to?: unknown; where?: any; params?: Record<string, unknown>; amount?: number; why?: string } = {}) => {
        const l = lookArg(ctx, id);
        if (!l) return null;
        const p = plan(ctx, l, o);
        const res = commit(ctx, p);
        const bad = p.frames.filter((f) => f.skipped);
        if (bad.length && !changing(p).length) ctx.toast(bad[0]!.skipped!.hint ?? bad[0]!.skipped!.message, { kind: 'error' });
        setView(ctx, 'preview', false);
        return res === true ? p : res;
      },
    })
    .add('looks.applyToSelection', { label: 'Apply Look to Selected Frames', palette: false, ...needLook, run: (ctx: any) => ctx.run('looks.apply', null, { to: 'selection' }) })
    .add('looks.applyToRoll', {
      label: 'Apply Look to the Roll’s Unedited Frames…',
      menu: 'Looks',
      enabled: (s: any) => !!pickedLook(s) && rollFrameIds(s).length > 0,
      why: (s: any) => (!pickedLook(s) ? 'Pick a look first' : 'Make a roll first (Roll ▸ New Roll from Open Frames)'),
      run: (ctx: any, where: 'unedited' | 'all' = 'unedited') => {
        const l = pickedLook(ctx.state)!;
        const p = plan(ctx, l, { to: 'roll', ...(where === 'unedited' ? { where: 'unedited' } : {}) });
        showPending(ctx, p);
        return p;
      },
    })
    .add('looks.applyToLibrary', {
      label: 'Apply Look to the Library…',
      menu: 'Looks',
      enabled: (s: any) => !!pickedLook(s) && visibleFrames(s).length > 0,
      why: 'Pick a look first',
      run: (ctx: any, where?: 'unedited') => {
        const p = plan(ctx, pickedLook(ctx.state)!, { to: 'library', ...(where ? { where } : {}) });
        showPending(ctx, p);
        return p;
      },
    })
    .add('looks.pending.toggle', {
      label: 'Include Frame',
      palette: false,
      run: (ctx: any, f: string) => {
        const off = looksView(ctx.state).off;
        setView(ctx, 'off', off.includes(f) ? off.filter((x) => x !== f) : [...off, f]);
      },
    })
    .add('looks.pending.approve', {
      label: 'Apply Planned Look',
      palette: false,
      enabled: (s: any) => !!looksView(s).pending,
      why: 'Nothing planned',
      run: (ctx: any, force = false) => {
        const p = plain(looksView(ctx.state).pending);
        if (!p) return null;
        const res = commit(ctx, p, { force: !!force, off: looksView(ctx.state).off });
        if (res !== true) {
          setView(ctx, 'stale', res);
          return res;
        }
        showPending(ctx, null);
        return true;
      },
    })
    .add('looks.pending.reject', { label: 'Cancel Planned Look', palette: false, run: (ctx: any) => showPending(ctx, null) })
    // agent batches (approval scope): approve the ticked frames as one global step; stale frames are reported
    .add('looks.batch.toggle', {
      label: 'Include Frame in Batch',
      palette: false,
      run: (ctx: any, batch: string, f: string) => {
        const off = looksView(ctx.state).batchOff?.[batch] ?? [];
        ctx.rt.store.writeDoc([{ path: ['looksView', 'batchOff', batch], value: off.includes(f) ? off.filter((x) => x !== f) : [...off, f] }], { tier: 'view' });
      },
    })
    .add('looks.batch.approve', {
      label: 'Approve Agent Look Batch',
      palette: false,
      run: (ctx: any, batch: string, force = false) => {
        const b = agentBatches(ctx.state).find((x) => x.batch === batch);
        if (!b) return null;
        const off = new Set(looksView(ctx.state).batchOff?.[batch] ?? []);
        const items = b.frames.filter((f) => !off.has(f.frame)).map((f) => ({ frame: f.frame, seqs: f.seqs }));
        const res = studioOf(ctx).route.approveBatch(items, `Approve ${b.why}`, { force: !!force });
        const stale = res.refused.flatMap((x) => x.diags.map((d) => ({ frame: x.frame, code: d.code, message: `${ctx.state.catalog?.frames?.[x.frame]?.name ?? x.frame}: ${d.message}` })));
        ctx.rt.store.writeDoc([{ path: ['looksView', 'batchStale', batch], value: stale }], { tier: 'view' });
        return res;
      },
    })
    .add('looks.batch.reject', {
      label: 'Reject Agent Look Batch',
      palette: false,
      run: (ctx: any, batch: string, onlyStale = false) => {
        const b = agentBatches(ctx.state).find((x) => x.batch === batch);
        if (!b) return;
        const stale = new Set((looksView(ctx.state).batchStale?.[batch] ?? []).map((x) => x.frame));
        for (const f of b.frames) if (!onlyStale || stale.has(f.frame)) studioOf(ctx).route.reject(f.frame, f.seqs);
        ctx.rt.store.writeDoc([{ path: ['looksView', 'batchStale', batch], value: [] }], { tier: 'view' });
      },
    })
    .add('looks.survey.open', {
      label: 'Survey Looks',
      menu: 'Looks',
      checked: (s: any) => looksView(s).mode === 'survey',
      run: (ctx: any, mode?: 'set' | 'ring') => {
        const v = looksView(ctx.state);
        const open = v.mode !== 'survey' || (mode && mode !== v.survey);
        ctx.rt.store.writeDoc([{ path: ['looksView', 'mode'], value: open ? 'survey' : 'print' }, ...(mode ? [{ path: ['looksView', 'survey'], value: mode }] : [])], { tier: 'view' });
      },
    })
    .add('looks.survey.toggle', {
      label: 'Add Look to Survey',
      palette: false,
      run: (ctx: any, id: string) => {
        const set = looksView(ctx.state).surveySet;
        setView(ctx, 'surveySet', set.includes(id) ? set.filter((x) => x !== id) : [...set, id]);
      },
    })
    .add('looks.compare', {
      label: 'Compare With',
      palette: false,
      run: (ctx: any, src: CompareSource) => setView(ctx, 'compare', src),
    })
    .add('looks.setReference', {
      label: 'Compare With This Frame',
      menu: 'Looks',
      enabled: (s: any) => !!cb.current(s),
      why: 'Select a frame first',
      run: (ctx: any) => setView(ctx, 'compare', { frame: cb.current(ctx.state)! }),
    })
    .add('looks.snapshot', { label: 'Snapshot', menu: 'Looks', enabled: (s: any) => !!cb.current(s), why: 'Select a frame first', run: (ctx: any, name?: string) => ctx.run('snapshot.new', name) })
    .add('looks.restoreSnapshot', { label: 'Restore Snapshot', palette: false, run: (ctx: any, id: string) => ctx.run('snapshot.restore', id) })
    .add('looks.copy', {
      label: 'Copy Settings',
      menu: 'Looks',
      enabled: (s: any) => !!cb.current(s),
      why: 'Select a frame first',
      run: (ctx: any) => {
        const f = cb.current(ctx.state)!;
        const r = committed(ctx, f);
        if (!r) return null;
        const groups = looksView(ctx.state).groups;
        const clip = { from: f, entries: copyEntries(r, groups), groups };
        setView(ctx, 'clipboard', clip);
        return clip;
      },
    })
    .add('looks.paste', {
      label: 'Paste Settings',
      menu: 'Looks',
      enabled: (s: any) => !!looksView(s).clipboard && !!cb.current(s),
      why: 'Copy the settings of a frame first',
      run: (ctx: any) => {
        const clip = looksView(ctx.state).clipboard;
        if (!clip) return null;
        const name = ctx.state.catalog?.frames?.[clip.from]?.name ?? clip.from;
        const l = fromPreset(presetFrom(`paste-${clip.from}`, `settings of ${name}`, plain(clip.entries)));
        const p = plan(ctx, l, { to: selection(ctx.state).filter((f) => f !== clip.from), amount: 1, id: newBatchId('paste') });
        const res = commit(ctx, { ...p, label: `Paste settings of ${name}` });
        return res === true ? p : res;
      },
    })
    .add('looks.sync', {
      label: 'Sync Settings to Selection',
      menu: 'Looks',
      enabled: (s: any) => (s.ui?.selection?.ids?.length ?? 0) > 1,
      why: 'Select the frames to sync to, with the source as primary',
      run: (ctx: any) => {
        ctx.run('looks.copy');
        return ctx.run('looks.paste');
      },
    })
    .add('looks.saveAsPreset', {
      label: 'Save Frame as Preset…',
      menu: 'Looks',
      enabled: (s: any) => !!cb.current(s),
      why: 'Select a frame first',
      run: (ctx: any, name?: string) => {
        const f = cb.current(ctx.state)!;
        const r = committed(ctx, f);
        if (!r) return null;
        const n = name ?? `${ctx.state.catalog?.frames?.[f]?.name ?? f} settings`;
        const id = `p-${n.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/, '');
        const p = presetFrom(id, n, copyEntries(r, looksView(ctx.state).groups));
        ctx.tx(`Save preset "${n}"`, (t: any) => t.$set(['looks', 'presets', id], p));
        return p;
      },
    })
    .add('looks.bake', {
      label: 'Save Look as Preset',
      menu: 'Looks',
      ...needLook,
      run: (ctx: any) => {
        const l = pickedLook(ctx.state)!;
        const f = cb.current(ctx.state)!;
        const p = bake(l, lookFrame(f, committed(ctx, f)!), paramsOf(ctx.state, l));
        ctx.tx(`Save preset "${p.name}"`, (t: any) => t.$set(['looks', 'presets', p.id], p));
        return p;
      },
    })
    .add('looks.deletePreset', {
      label: 'Delete Preset',
      palette: false,
      run: (ctx: any, id: string) => {
        // the draft is a proxy; copy the presets from the (JSON-able) state and replace the map
        const rest = { ...plain(ctx.state.looks?.presets ?? {}) } as Record<string, Preset>;
        delete rest[id];
        ctx.tx(`Delete preset "${ctx.state.looks?.presets?.[id]?.name ?? id}"`, (t: any) => t.$set(['looks', 'presets'], rest));
      },
    })
    .add('looks.importPreset', {
      label: 'Import Preset',
      palette: false,
      run: (ctx: any, text: string) => {
        const r = readPresetFile(text);
        ctx.tx(`Import preset "${r.preset.name}"`, (t: any) => {
          t.$set(['looks', 'presets', r.preset.id], r.preset);
          t.$set(['looks', 'review', r.preset.id], r.status === 'needs-review' ? r.diags.map((d) => d.message) : []);
        });
        return r;
      },
    })
    .add('looks.exportPreset', {
      label: 'Export Preset',
      palette: false,
      run: (ctx: any, id: string) => {
        const p = ctx.state.looks?.presets?.[id];
        return p ? presetToFile(plain(p)) : null;
      },
    })
    .add('looks.favourite', {
      label: 'Favourite Look',
      palette: false,
      run: (ctx: any, id?: string) => {
        const l = lookArg(ctx, id);
        if (!l) return;
        const fav: string[] = ctx.state.looks?.favourites ?? [];
        ctx.tx(fav.includes(l.id) ? `Unfavourite ${l.name}` : `Favourite ${l.name}`, (t: any) => t.$set(['looks', 'favourites'], fav.includes(l.id) ? fav.filter((x) => x !== l.id) : [...fav, l.id]));
      },
    })
    .add('looks.group', { label: 'Look Group', palette: false, run: (ctx: any, g: string | null) => setView(ctx, 'group', g) })
    .add('looks.syncGroup', {
      label: 'Sync Group',
      palette: false,
      run: (ctx: any, name: string) => {
        const g = looksView(ctx.state).groups;
        setView(ctx, 'groups', g.includes(name) ? g.filter((x) => x !== name) : [...g, name]);
      },
    })
    .add('looks.virtualCopy', { label: 'Virtual Copy', menu: 'Looks', enabled: () => false, why: 'Virtual copies need a catalog field and a stack display (CHB-019/020)', run: () => null })
    .add('looks.match', { label: 'Match to Reference', menu: 'Looks', enabled: () => false, why: 'Match measures both frames (measure.stats); not built yet — use Roll ▸ Print the Roll Like the Reference', run: () => null });
}
