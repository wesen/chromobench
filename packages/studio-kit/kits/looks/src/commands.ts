// cb.kits.looks: the command table (split from kit.ts, CHB-032; CHB-037 P7: looks are links): pick, parameters,
// Amount, apply to the selection, the roll or the library, planned and agent batches, survey, compare, snapshots, the
// frame's looks (Amount, bake, remove), copy / paste / sync (copy values or link one preset), presets.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { canonicalJSON, remove, set, transaction, type Batch, type Log, type Mutation } from '@chromobench/values';
import { bakeLink, insertLink, lookAsPreset, removeLink, setLinkAmount, type Document, type Entry, type Preset } from '@chromobench/contract';
import type { Cb } from '../../../src/cb.ts';
import { read } from '../../../src/model/doc.ts';
import { sel } from '../../../src/sel.ts';
import { presetToFile, readPresetFile } from './engine/files.ts';
import { appliedKey, changing, newBatchId, type LookItem } from './engine/looks.ts';
import { appliedLooks } from './engine/describe.ts';
import type { CommandTable } from '@chromobench/shell';
import { type AgentBatch, type CompareSource, type SyncMode, plain, looksView, agentBatches } from './state.ts';
import type { LooksModel } from './model.ts';

const slug = (n: string): string => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';

/** the looks kit's command table */
export function looksCommands(cb: Cb, M: LooksModel): CommandTable {
  const { studioOf, paramsOf, committed, selection, rollFrameIds, plan, commit, commitFrames, setView, showPending, pickedLook, needLook, lookArg, linksFor, copyValues, copiedLinks, pasteMutations, copyLines, presetFrom, presetsOf } = M;
  const nameOf = (ctx: any, f: string): string => ctx.state.catalog?.frames?.[f]?.name ?? f;
  /** the key of a look on the current frame: given, or the picked look's link there */
  const keyArg = (ctx: any, key?: string | null): string | null => {
    if (key) return key;
    const f = sel.current(ctx.state);
    const d = f ? committed(ctx, f) : undefined;
    const l = pickedLook(ctx.state);
    return d && l ? appliedKey(d, l) : null;
  };
  /** the frame's looks: applied, with one Amount each */
  const hasLooks = { enabled: (s: any) => !!sel.current(s) && appliedLooks((s.docs?.[sel.current(s)!] ?? null) as Document ?? ({ stages: {} } as any)).length > 0, why: 'This frame has no looks' };
  return {
    'looks.pick': {
      label: 'Pick Look',
      palette: false,
      run: (ctx: any, id: string | null) => {
        ctx.rt.store.writeView([{ path: ['looksView', 'picked'], value: looksView(ctx.state).picked === id ? null : id }, { path: ['looksView', 'preview'], value: true }]);
      },
    },
    'looks.param': {
      label: 'Set Look Parameter',
      palette: false,
      run: (ctx: any, name: string, value: unknown) => {
        const l = pickedLook(ctx.state);
        if (!l) return;
        ctx.rt.store.writeView([{ path: ['looksView', 'params', l.id], value: { ...paramsOf(ctx.state, l), [name]: value } }]);
      },
    },
    'looks.amount': { label: 'Look Amount', palette: false, run: (ctx: any, pct: number) => setView(ctx, 'amount', Math.max(0, Math.min(200, Number(pct)))) },
    'looks.preview': {
      label: 'Preview Look',
      checked: (s: any) => looksView(s).preview,
      run: (ctx: any, on?: boolean) => setView(ctx, 'preview', on ?? !looksView(ctx.state).preview),
    },
    'looks.apply': {
      label: 'Apply Look to Selection',
      ...needLook,
      enabled: (s: any) => !!sel.current(s) && !!pickedLook(s),
      run: (ctx: any, id?: string | LookItem, o: { to?: unknown; where?: any; params?: Record<string, unknown>; amount?: number; why?: string } = {}) => {
        const l = lookArg(ctx, id);
        if (!l) return null;
        const p = plan(ctx, l, o);
        commit(ctx, p);
        const bad = p.frames.filter((f) => f.skipped);
        if (bad.length && !changing(p).length) ctx.toast(bad[0]!.skipped!.hint ?? bad[0]!.skipped!.message, { kind: 'error' });
        setView(ctx, 'preview', false);
        return p;
      },
    },
    'looks.applyToSelection': { label: 'Apply Look to Selected Frames', palette: false, ...needLook, run: (ctx: any) => ctx.run('looks.apply', null, { to: 'selection' }) },
    'looks.applyToRoll': {
      label: 'Apply Look to the Roll’s Unedited Frames…',
      enabled: (s: any) => !!pickedLook(s) && rollFrameIds(s).length > 0,
      why: (s: any) => (!pickedLook(s) ? 'Pick a look first' : 'Make a roll first (Roll ▸ New Roll from Open Frames)'),
      run: (ctx: any, where: 'unedited' | 'all' = 'unedited') => {
        const l = pickedLook(ctx.state)!;
        const p = plan(ctx, l, { to: 'roll', ...(where === 'unedited' ? { where: 'unedited' } : {}) });
        showPending(ctx, p);
        return p;
      },
    },
    'looks.applyToLibrary': {
      label: 'Apply Look to the Library…',
      enabled: (s: any) => !!pickedLook(s) && sel.visible(s).length > 0,
      why: 'Pick a look first',
      run: (ctx: any, where?: 'unedited') => {
        const p = plan(ctx, pickedLook(ctx.state)!, { to: 'library', ...(where ? { where } : {}) });
        showPending(ctx, p);
        return p;
      },
    },
    'looks.pending.toggle': {
      label: 'Include Frame',
      palette: false,
      run: (ctx: any, f: string) => {
        const off = looksView(ctx.state).off;
        setView(ctx, 'off', off.includes(f) ? off.filter((x) => x !== f) : [...off, f]);
      },
    },
    'looks.pending.approve': {
      label: 'Apply Planned Look',
      palette: false,
      enabled: (s: any) => !!looksView(s).pending,
      why: 'Nothing planned',
      // a planned look is never stale: each frame's link is placed against its document at approval
      run: (ctx: any) => {
        const p = plain(looksView(ctx.state).pending);
        if (!p) return null;
        commit(ctx, p, { off: looksView(ctx.state).off });
        showPending(ctx, null);
        return true;
      },
    },
    'looks.pending.reject': { label: 'Cancel Planned Look', palette: false, run: (ctx: any) => showPending(ctx, null) },
    // agent batches (approval scope): approve the ticked frames as one global step; stale frames are reported
    'looks.batch.toggle': {
      label: 'Include Frame in Batch',
      palette: false,
      run: (ctx: any, batch: string, f: string) => {
        const off = looksView(ctx.state).batchOff?.[batch] ?? [];
        ctx.rt.store.writeView([{ path: ['looksView', 'batchOff', batch], value: off.includes(f) ? off.filter((x) => x !== f) : [...off, f] }]);
      },
    },
    'looks.batch.approve': {
      label: 'Approve Agent Look Batch',
      palette: false,
      run: (ctx: any, batch: string, force = false) => {
        const b = agentBatches(ctx.state).find((x) => x.batch === batch);
        if (!b) return null;
        const off = new Set(looksView(ctx.state).batchOff?.[batch] ?? []);
        const on = b.frames.filter((f) => !off.has(f.frame)).map((f) => f.frame);
        const known = new Set((looksView(ctx.state).batchStale?.[batch] ?? []).map((x) => x.frame));
        const stale = force ? [] : on.filter((f) => known.has(f) || staleEntry(studioOf(ctx).log, b, f));
        const approve = on.filter((f) => !stale.includes(f));
        const refused = stale.map((f) => ({ frame: f, code: 'E_STALE', message: `${ctx.state.catalog?.frames?.[f]?.name ?? f}: changed since the look was proposed` }));
        if (!approve.length) {
          // nothing to approve: the card stays as it is and says which frames changed
          ctx.rt.store.writeView([{ path: ['looksView', 'batchStale', batch], value: refused }]);
          return { approved: [], refused };
        }
        const kept = regroup(ctx, b, approve, b.frames.map((f) => f.frame).filter((f) => !approve.includes(f)), force);
        if (kept) {
          ctx.rt.store.writeView([
            { path: ['looksView', 'batchStale', kept], value: refused },
            { path: ['looksView', 'batchOff', kept], value: [...off] },
          ]);
        }
        return { approved: approve, refused };
      },
    },
    'looks.batch.reject': {
      label: 'Reject Agent Look Batch',
      palette: false,
      run: (ctx: any, batch: string, onlyStale = false) => {
        const b = agentBatches(ctx.state).find((x) => x.batch === batch);
        if (!b) return;
        const stale = new Set((looksView(ctx.state).batchStale?.[batch] ?? []).map((x) => x.frame));
        // Skip: the stale frames' proposals are rejected; the others stay pending as one card
        const kept = regroup(ctx, b, [], onlyStale ? b.frames.map((f) => f.frame).filter((f) => !stale.has(f)) : [], false);
        if (kept) ctx.rt.store.writeView([{ path: ['looksView', 'batchOff', kept], value: looksView(ctx.state).batchOff?.[batch] ?? [] }]);
      },
    },
    'looks.survey.open': {
      label: 'Survey Looks',
      checked: (s: any) => looksView(s).mode === 'survey',
      run: (ctx: any, mode?: 'set' | 'ring') => {
        const v = looksView(ctx.state);
        const open = v.mode !== 'survey' || (mode && mode !== v.survey);
        ctx.rt.store.writeView([{ path: ['looksView', 'mode'], value: open ? 'survey' : 'print' }, ...(mode ? [{ path: ['looksView', 'survey'], value: mode }] : [])]);
      },
    },
    'looks.survey.toggle': {
      label: 'Add Look to Survey',
      palette: false,
      run: (ctx: any, id: string) => {
        const set = looksView(ctx.state).surveySet;
        setView(ctx, 'surveySet', set.includes(id) ? set.filter((x) => x !== id) : [...set, id]);
      },
    },
    'looks.compare': {
      label: 'Compare With',
      palette: false,
      run: (ctx: any, src: CompareSource) => setView(ctx, 'compare', src),
    },
    'looks.setReference': {
      label: 'Compare With This Frame',
      enabled: (s: any) => !!sel.current(s),
      why: 'Select a frame first',
      run: (ctx: any) => setView(ctx, 'compare', { frame: sel.current(ctx.state)! }),
    },
    'looks.snapshot': { label: 'Snapshot', enabled: (s: any) => !!sel.current(s), why: 'Select a frame first', run: (ctx: any, name?: string) => ctx.run('snapshot.new', name) },
    'looks.restoreSnapshot': { label: 'Restore Snapshot', palette: false, run: (ctx: any, id: string) => ctx.run('snapshot.restore', id) },
    'looks.copy': {
      label: 'Copy Settings',
      enabled: (s: any) => !!sel.current(s),
      why: 'Select a frame first',
      run: (ctx: any) => {
        const f = sel.current(ctx.state)!;
        const r = committed(ctx, f);
        if (!r) return null;
        const groups = looksView(ctx.state).groups;
        const values = copyValues(r, groups, linksFor(ctx, f));
        const links = copiedLinks(r, groups);
        const clip = { from: f, values, links, groups, lines: copyLines(values, links, r) };
        setView(ctx, 'clipboard', clip);
        return clip;
      },
    },
    'looks.paste': {
      label: 'Paste Settings',
      enabled: (s: any) => !!looksView(s).clipboard && !!sel.current(s),
      why: 'Copy the settings of a frame first',
      // copy semantics: the values are set and the looks inserted on each frame, which is on its own afterwards
      run: (ctx: any) => {
        const clip = plain(looksView(ctx.state).clipboard);
        if (!clip) return null;
        const frames = new Map<string, Mutation[]>();
        for (const f of selection(ctx.state).filter((x) => x !== clip.from)) {
          const d = committed(ctx, f);
          if (d) frames.set(f, pasteMutations(d, clip.values, clip.links as any, linksFor(ctx, f)));
        }
        const n = commitFrames(ctx, { id: newBatchId(`paste-${clip.from}`), label: `Paste settings of ${nameOf(ctx, clip.from)}`, source: { kind: 'sync', mode: 'copy', from: clip.from }, frames });
        return { mode: 'copy', frames: n };
      },
    },
    'looks.syncMode': {
      label: 'Sync Mode',
      palette: false,
      checked: (s: any) => looksView(s).syncMode === 'link',
      run: (ctx: any, mode?: SyncMode) => setView(ctx, 'syncMode', mode ?? (looksView(ctx.state).syncMode === 'link' ? 'copy' : 'link')),
    },
    'looks.sync': {
      label: 'Sync Settings to Selection',
      enabled: (s: any) => (s.ui?.selection?.ids?.length ?? 0) > 1,
      why: 'Select the frames to sync to, with the source as primary',
      /**
       * copy: the source's values and looks are copied (each frame on its own afterwards). link: the source's layers of
       * the chosen groups become one preset that the source and every target link (they stay together: re-saving the
       * preset changes all of them); the values (paper, time, lights) are copied. One step either way.
       */
      run: (ctx: any, mode?: SyncMode) => {
        const m = mode ?? looksView(ctx.state).syncMode;
        if (m === 'copy') {
          ctx.run('looks.copy');
          return ctx.run('looks.paste');
        }
        const f = sel.current(ctx.state)!;
        const r = committed(ctx, f);
        if (!r) return null;
        const groups = looksView(ctx.state).groups;
        const n = Object.keys(presetsOf(ctx.state)).filter((k) => k.startsWith(`sync-${slug(nameOf(ctx, f))}`)).length + 1;
        const id = `sync-${slug(nameOf(ctx, f))}-${n}`;
        const p = presetFrom(r, id, `Synced from ${nameOf(ctx, f)}${n > 1 ? ` (${n})` : ''}`, groups, linksFor(ctx, f));
        const values = copyValues(r, groups, linksFor(ctx, f));
        const linked = Object.values(p.stacks).reduce((a, c) => a + (c?.order.length ?? 0), 0);
        const frames = new Map<string, Mutation[]>();
        const key = `${id}-link`;
        if (linked) {
          // the source: its own entries go into the preset, the link takes their place (the print does not change)
          const own = Object.values(p.stacks).flatMap((c) => c?.order ?? []);
          const lessOwn = own.map((x) => remove(x));
          frames.set(f, [...lessOwn, ...insertLink(stripEntries(r, own), { preset: id }, { key, name: p.name, source: { kind: 'preset', sync: true } }, { presets: () => p })]);
        }
        for (const t of selection(ctx.state).filter((x) => x !== f)) {
          const d = committed(ctx, t);
          if (!d) continue;
          const ms = pasteMutations(d, values, [], linksFor(ctx, t));
          frames.set(t, linked ? [...ms, ...insertLink(d, { preset: id }, { key, name: p.name, source: { kind: 'preset', sync: true } }, { presets: () => p })] : ms);
        }
        const label = linked ? `Sync (linked) from ${nameOf(ctx, f)}` : `Sync settings of ${nameOf(ctx, f)}`;
        commitFrames(ctx, { id: newBatchId(`sync-${f}`), label, source: { kind: 'sync', mode: 'link', from: f, preset: id }, frames, ...(linked ? { main: [set(`looks.presets.${id}`, plain(p))] } : {}) });
        ctx.toast(linked ? `Linked ${frames.size} frames to “${p.name}” (${linked} layer${linked === 1 ? '' : 's'}); ${values.length} values copied` : `Nothing to link: ${values.length} values copied`, { kind: 'info' });
        return { mode: 'link', preset: linked ? id : null, frames: frames.size, values: values.length };
      },
    },
    'looks.saveAsPreset': {
      label: 'Save Frame as Preset…',
      enabled: (s: any) => !!sel.current(s),
      why: 'Select a frame first',
      run: (ctx: any, name?: string) => {
        const f = sel.current(ctx.state)!;
        const r = committed(ctx, f);
        if (!r) return null;
        const n = name ?? `${nameOf(ctx, f)} settings`;
        const p = presetFrom(r, `p-${slug(n)}`, n, looksView(ctx.state).groups, linksFor(ctx, f));
        ctx.tx(`Save preset "${n}"`, (t: any) => t.$set(['looks', 'presets', p.id], plain(p)));
        return p;
      },
    },
    'looks.saveLookAsPreset': {
      label: 'Save Look as Preset',
      ...needLook,
      run: (ctx: any) => {
        const l = pickedLook(ctx.state)!;
        const f = sel.current(ctx.state)!;
        if (!('look' in l.ref)) return null;
        const p = lookAsPreset(committed(ctx, f)!, l.ref, { ...paramsOf(ctx.state, l), ...(l.fixed ?? {}) }, { id: `p-${slug(l.id)}-${Object.keys(presetsOf(ctx.state)).length + 1}` }, linksFor(ctx, f));
        ctx.tx(`Save preset "${p.name}"`, (t: any) => t.$set(['looks', 'presets', p.id], plain(p)));
        return p;
      },
    },
    'looks.setAmount': {
      label: 'Look Amount on This Frame',
      palette: false,
      ...hasLooks,
      // one Amount for a look over every stage it touches (each clamped to its law)
      run: (ctx: any, key: string, pct: number) => {
        const f = sel.current(ctx.state)!;
        const d = committed(ctx, f);
        if (!d) return null;
        const ms = setLinkAmount(d, key, Math.max(0, Number(pct)) / 100);
        return ms.length ? studioOf(ctx).commit(f, ms, `${appliedLooks(d).find((x) => x.key === key)?.name ?? key} at ${Math.round(Number(pct))} %`) : null;
      },
    },
    'looks.bake': {
      label: 'Bake Look into Layers',
      ...hasLooks,
      // the link becomes the plain group it expands to (its source recorded): the look's own layers, detached
      run: (ctx: any, key?: string) => {
        const f = sel.current(ctx.state)!;
        const d = committed(ctx, f);
        const k = keyArg(ctx, key);
        if (!d || !k) return null;
        const name = appliedLooks(d).find((x) => x.key === k)?.name ?? k;
        studioOf(ctx).commit(f, bakeLink(d, k, linksFor(ctx, f)), `Bake ${name}`);
        return k;
      },
    },
    'looks.remove': {
      label: 'Remove Look',
      ...hasLooks,
      run: (ctx: any, key?: string) => {
        const f = sel.current(ctx.state)!;
        const d = committed(ctx, f);
        const k = keyArg(ctx, key);
        if (!d || !k) return null;
        const name = appliedLooks(d).find((x) => x.key === k)?.name ?? k;
        studioOf(ctx).commit(f, removeLink(d, k), `Remove ${name}`);
        return k;
      },
    },
    'looks.deletePreset': {
      label: 'Delete Preset',
      palette: false,
      run: (ctx: any, id: string) => {
        // the draft is a proxy; copy the presets from the (JSON-able) state and replace the map
        const rest = { ...plain(ctx.state.looks?.presets ?? {}) } as Record<string, Preset>;
        delete rest[id];
        ctx.tx(`Delete preset "${ctx.state.looks?.presets?.[id]?.name ?? id}"`, (t: any) => t.$set(['looks', 'presets'], rest));
      },
    },
    'looks.importPreset': {
      label: 'Import Preset',
      palette: false,
      run: (ctx: any, text: string) => {
        const r = readPresetFile(text);
        ctx.tx(`Import preset "${r.preset.name}"`, (t: any) => {
          t.$set(['looks', 'presets', r.preset.id], plain(r.preset));
          t.$set(['looks', 'review', r.preset.id], r.status === 'needs-review' ? r.diags.map((d) => d.message) : []);
        });
        return r;
      },
    },
    'looks.exportPreset': {
      label: 'Export Preset',
      palette: false,
      run: (ctx: any, id: string) => {
        const p = ctx.state.looks?.presets?.[id];
        return p ? presetToFile(plain(p)) : null;
      },
    },
    'looks.favourite': {
      label: 'Favourite Look',
      palette: false,
      run: (ctx: any, id?: string) => {
        const l = lookArg(ctx, id);
        if (!l) return;
        const fav: string[] = ctx.state.looks?.favourites ?? [];
        ctx.tx(fav.includes(l.id) ? `Unfavourite ${l.name}` : `Favourite ${l.name}`, (t: any) => t.$set(['looks', 'favourites'], fav.includes(l.id) ? fav.filter((x) => x !== l.id) : [...fav, l.id]));
      },
    },
    'looks.group': { label: 'Look Group', palette: false, run: (ctx: any, g: string | null) => setView(ctx, 'group', g) },
    'looks.syncGroup': {
      label: 'Sync Group',
      palette: false,
      run: (ctx: any, name: string) => {
        const g = looksView(ctx.state).groups;
        setView(ctx, 'groups', g.includes(name) ? g.filter((x) => x !== name) : [...g, name]);
      },
    },
    'looks.virtualCopy': { label: 'Virtual Copy', enabled: () => false, why: 'Virtual copies need a catalog field and a stack display (CHB-019/020)', run: () => null },
    'looks.match': { label: 'Match to Reference', enabled: () => false, why: 'Match measures both frames (measure.stats); not built yet — use Roll ▸ Print the Roll Like the Reference', run: () => null },
  };
}

/** the document without some entries (the sync's source, whose layers move into the preset it then links) */
function stripEntries(d: Document, ids: readonly string[]): Document {
  const stages: Record<string, unknown> = {};
  for (const [k, st] of Object.entries(d.stages) as [string, { medium: unknown; stack: { order: readonly string[]; items: Readonly<Record<string, Entry>> } } | undefined][]) {
    if (!st) continue;
    const order = st.stack.order.filter((x: string) => !ids.includes(x));
    stages[k] = { ...st, stack: { order, items: Object.fromEntries(order.map((x) => [x, st.stack.items[x]])) } };
  }
  return { ...d, stages: stages as unknown as Document['stages'] };
}

/** A frame of an agent batch whose proposal is stale: a value it would undo is no longer the one it saw. */
function staleEntry(log: Log, b: AgentBatch, frame: string): boolean {
  const f = b.frames.find((x) => x.frame === frame);
  const e = f ? log.entry(f.seq) : undefined;
  if (!e || !log.has(frame)) return false;
  const d = log.doc<Document>(frame);
  return e.tx.mutations.some((m, i) => {
    const inv = e.tx.inverses[i];
    return m.op === 'set' && inv?.op === 'set' && canonicalJSON(read(d, inv.path) ?? null) !== canonicalJSON(inv.value ?? null);
  });
}

let regroupSeq = 0;
/**
 * The log approves and rejects a batch as a whole (selecting one entry selects the batch), so a card's partial
 * decision is made in one change of the log: the batch is rejected, the frames to approve are proposed again as a
 * batch of their own and approved (one step), and the frames to keep are proposed again as a new pending batch
 * (returned: its id). With every frame approved, the batch is approved as it is.
 */
function regroup(ctx: any, b: AgentBatch, approve: readonly string[], keep: readonly string[], force: boolean): string | null {
  const studio = ctx.services.studio;
  const base = b.batch.replace(/~\d+$/, '');
  const keepId = keep.length ? `${base}~${++regroupSeq}` : null;
  studio.change((log: Log) => {
    if (!keep.length && approve.length === b.frames.length) return log.approve(b.frames[0]!.seq, { by: 'user', ...(force ? { force: true } : {}) });
    const entries = b.frames.map((f) => ({ f, e: log.entry(f.seq)! })).filter((x) => x.e);
    if (!entries.length) return log;
    const first = entries[0]!.e;
    const make = (frames: readonly string[], id: string): Batch => ({
      id, label: first.tx.label, by: first.tx.by, source: first.tx.source, skipped: [],
      edits: entries.filter((x) => frames.includes(x.f.frame)).map((x) => ({ doc: x.f.frame, tx: transaction({ id: `${id}:${x.f.frame}`, label: x.e.tx.label, by: x.e.tx.by, source: x.e.tx.source, batch: id, mutations: x.e.tx.mutations }) })),
    });
    const why = first.why !== undefined ? { why: first.why } : {};
    let next = log.reject(first.seq);
    if (approve.length) {
      const id = `${base}~${++regroupSeq}`;
      next = next.propose(make(approve, id), why).approve({ batch: id }, { by: 'user' });
    }
    if (keepId) next = next.propose(make(keep, keepId), why);
    return next;
  }, `Approve ${b.why}`);
  return keepId;
}
