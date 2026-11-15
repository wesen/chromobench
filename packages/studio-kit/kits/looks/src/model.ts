// cb.kits.looks: the look library, looked documents, compare sources, targets, plan and commit, copy / paste / sync
// (split from kit.ts, CHB-032; CHB-037 P7: looks are links). What the commands, the panels and the kit's builder calls
// share; one instance per kit. A user apply is one batch of the values batch builder (`plan`) committed as one step:
// the link entries on every target frame, and, when the apply makes a preset (sync by link), the library's record in
// the same step.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { canonicalJSON, plan as planBatch, set, transaction, type Batch, type Mutation } from '@chromobench/values';
import { documentKind, edit, insertLink, linksOf as linksIn, makePreset, newDocument, resolveLinks, storedMutations, type Document, type LinkContext, type Preset } from '@chromobench/contract';
import { MAIN, strip } from '@chromobench/shell';
import type { Cb } from '../../../src/cb.ts';
import { sel, type CatalogFrame } from '../../../src/sel.ts';
import { frameRef, type ImageHandle } from '../../../src/handles.ts';
import { FILTRATION_PATH, FSTOP_PATH, GRADE_PATH, LIGHTS_PATH, linksOf, PAPER_PATH, read, TIME_PATH } from '../../../src/model/doc.ts';
import type { Studio } from '../../../src/studio.ts';
import { diffDocs, summary, type DiffEntry } from './engine/diff.ts';
import { groupOf, inGroups, SYNC_GROUPS, type SyncGroups } from './engine/groups.ts';
import { changing, freshKey, isLookItem, isUnedited, lookItems, newBatchId, planFrame, planLook, presetItem, withLook, type LookItem, type LookPlan } from './engine/looks.ts';
import { docAt, isLayerPath } from './engine/paths.ts';
import { ring } from './engine/sweep.ts';
import { type CompareSource, type LooksView, plain, looksView, amountOf } from './state.ts';

/** The document of a frame as it was made (the compare source "defaults"): a new document of its kind and pitch. */
export function defaultsOf(doc: Document): Document {
  const scan = (doc.stages.scan?.medium ?? null) as { umPerPx?: number; format?: '135'; overrides?: { umPerPx?: number } } | null;
  const um = scan?.umPerPx ?? scan?.overrides?.umPerPx;
  return newDocument(documentKind(doc), { sha256: doc.source.sha256 }, { frame: doc.frame, ...(um ? { umPerPx: um } : {}), ...(scan?.format ? { format: scan.format } : {}) });
}

export function createLooksModel(cb: Cb) {
  const studioOf = (ctx: any): Studio => {
    const s = ctx.services?.studio as Studio | undefined;
    if (!s) throw new Error('No studio service: start the app with studio.services()');
    return s;
  };
  /** looks a layout registers (items of registered look functions, sweeps) */
  const extra = new Map<string, LookItem>();
  let syncGroups: SyncGroups = SYNC_GROUPS;

  // ── the library: registered looks, the layout's, the presets ──
  const presetsOf = (s: any): Record<string, Preset> => (strip(s?.looks?.presets) ?? {}) as Record<string, Preset>;
  const looksOf = (s: any): LookItem[] => {
    const seen = new Set<string>();
    return [...lookItems(), ...extra.values(), ...Object.values(presetsOf(s)).map(presetItem)].filter((l) => !seen.has(l.id) && (seen.add(l.id), true));
  };
  const ringLooks = ring();
  const lookById = (s: any, id: string | null | undefined): LookItem | null => (id ? looksOf(s).find((l) => l.id === id || l.name === id) ?? ringLooks.find((l) => l.id === id) ?? null : null);
  const paramsOf = (s: any, l: LookItem): Record<string, unknown> => plain(looksView(s).params?.[l.id] ?? {});
  const rollFrameIds = (s: any): string[] => (cb.kits['roll']?.sel?.roll?.(s)?.frames as string[] | undefined) ?? [];

  /** the document of `f` with look `l` applied at the current Amount (null when it does not apply) */
  const looked = (s: any, f: string, l: LookItem, o: { amount?: number; params?: Record<string, unknown> } = {}): Document | null => {
    const d = docAt(s, f);
    return d ? withLook(d, l, o.params ?? paramsOf(s, l), o.amount ?? amountOf(s), linksOf(s)) : null;
  };
  /** a tile's print: the selected frame through the look at the current Amount */
  const tile = (s: any, l: LookItem): ImageHandle | null => {
    const f = sel.current(s);
    if (!f) return null;
    const r = looked(s, f, l);
    return r ? frameRef(f, r, `frame.look('${l.name}')`).print() : null;
  };
  /** the caption under a tile: what the look does here, or why it does not apply */
  const caption = (s: any, l: LookItem): string => {
    const f = sel.current(s);
    const d = f ? docAt(s, f) : undefined;
    if (!f || !d) return '';
    const pf = planFrame(l, paramsOf(s, l), f, d, { amount: amountOf(s), links: linksOf(s) });
    return pf.skipped ? (pf.skipped.hint ?? pf.skipped.message) : pf.diff.length ? pf.diff.slice(0, 2).join(', ') : 'no change';
  };
  /** the main viewer's print: the picked look previewed (uncommitted) when preview is on */
  const print = (s: any): ImageHandle | null => {
    const f = cb.sel.frame(s);
    if (!f) return null;
    const v = looksView(s);
    const l = v.preview && v.picked ? lookById(s, v.picked) : null;
    const r = l ? looked(s, f.frame, l) : null;
    return r ? frameRef(f.frame, r, `frame.look('${l!.name}')`).print() : f.print();
  };
  /** the compare source as a document (guide §5.1) */
  const compareRecipe = (s: any, src: CompareSource = looksView(s).compare): { frame: string; doc: Document | 'initial' } | null => {
    const f = sel.current(s);
    const r = f ? docAt(s, f) : undefined;
    if (!f || !r) return null;
    if (src === 'before') return { frame: f, doc: 'initial' };
    if (src === 'defaults') return { frame: f, doc: defaultsOf(r) };
    if ('snapshot' in src) {
      const snap = (s.snapshots?.[f] ?? []).find((x: any) => x.id === src.snapshot);
      return snap ? { frame: f, doc: snap.doc } : null;
    }
    if ('frame' in src) {
      const o = docAt(s, src.frame);
      return o ? { frame: src.frame, doc: o } : null;
    }
    if ('look' in src) {
      const l = lookById(s, src.look);
      const x = l ? looked(s, f, l, { ...(src.amount !== undefined ? { amount: src.amount } : {}), ...(src.params ? { params: src.params } : {}) }) : null;
      return x ? { frame: f, doc: x } : null;
    }
    return { frame: f, doc: src.doc };
  };
  const before = (s: any): ImageHandle | null => {
    const c = compareRecipe(s);
    return c ? frameRef(c.frame, c.doc, 'compare').print() : null;
  };
  /** what the diff panel compares: the compare source → the current document (or the previewed look) */
  const diffAgainst = (s: any, against?: CompareSource, initial?: (f: string) => Document | undefined): DiffEntry[] => {
    const f = sel.current(s);
    if (!f) return [];
    const cur = docAt(s, f);
    if (!cur) return [];
    const v = looksView(s);
    const picked = v.preview && v.picked ? lookById(s, v.picked) : null;
    const now = (picked && looked(s, f, picked)) || cur;
    const c = compareRecipe(s, against ?? v.compare);
    const from = c ? (c.doc === 'initial' ? initial?.(c.frame) ?? null : c.doc) : null;
    return from ? diffDocs(from, now, { groups: syncGroups }) : [];
  };

  // ── targets (guide §6.2) ──
  const committed = (ctx: any, f: string): Document | undefined => studioOf(ctx).doc(f);
  /** what links resolve against for a frame in a command: the state's rolls and presets, and the frame's image size */
  const linksFor = (ctx: any, f: string): LinkContext => {
    const e = ctx.services?.studio?.frames?.get?.(f);
    const info = e?.graph?.source?.(e.sha);
    return { ...linksOf(ctx.state), ...(info ? { size: [info.width, info.height] as const } : {}) };
  };
  const selection = (s: any): string[] => {
    const ids: string[] = s?.ui?.selection?.ids ?? [];
    return ids.length ? ids : [sel.current(s)].filter((x): x is string => !!x);
  };
  function targets(ctx: any, to: unknown, where?: 'unedited' | ((f: { id: string; doc: Document; unedited: boolean }) => boolean)): string[] {
    const s = ctx.state;
    let ids: string[];
    if (to === undefined || to === 'selection') ids = selection(s);
    else if (to === 'frame') ids = [sel.current(s)].filter((x): x is string => !!x);
    else if (to === 'roll') ids = rollFrameIds(s);
    else if (to === 'library') ids = sel.visible(s).map((x: CatalogFrame) => x.id);
    else if (typeof to === 'string') ids = [to];
    else if (Array.isArray(to)) ids = to.map(String);
    else if (to && typeof to === 'object' && 'roll' in (to as any)) ids = (cb.kits['roll']?.sel?.roll?.(s, (to as any).roll)?.frames as string[] | undefined) ?? [];
    else ids = selection(s);
    const studio = studioOf(ctx);
    return ids.filter((f) => {
      const d = studio.doc(f);
      if (!d) return false;
      if (!where) return true;
      const unedited = isUnedited(studio.log, f);
      return where === 'unedited' ? unedited : where({ id: f, doc: d, unedited });
    });
  }
  function plan(ctx: any, l: LookItem, o: { to?: unknown; where?: any; params?: Record<string, unknown>; amount?: number; why?: string; id?: string } = {}): LookPlan {
    const s = ctx.state;
    const frames = targets(ctx, o.to, o.where).map((f) => ({ frame: f, doc: committed(ctx, f)!, links: linksFor(ctx, f) }));
    return planLook(l, o.params ?? paramsOf(s, l), frames, { amount: o.amount ?? amountOf(s), ...(o.why ? { why: o.why } : {}), ...(o.id ? { id: o.id } : {}) });
  }
  /**
   * Commit a plan: one batch of the values batch builder over its frames (each transaction carries the plan's id), one
   * step of the log. A frame that changed since planning is planned again against its current document (a link
   * insert or adjustment is never stale: it does not overwrite a value the photographer set). `main`: edits of the
   * main document (the library) in the same step.
   */
  function commit(ctx: any, p: LookPlan, o: { off?: readonly string[]; main?: Mutation[]; label?: string } = {}): true {
    const off = new Set(o.off ?? []);
    const frames = new Map(changing(p).filter((f) => !off.has(f.frame)).map((f) => [f.frame, f]));
    const studio = studioOf(ctx);
    const item = lookById(ctx.state, p.look.id);
    const label = o.label ?? p.label;
    const batch = planBatch(studio.log.targets<Document>([...frames.keys()].filter((f) => studio.log.has(f))), (d, id) => {
      const f = frames.get(id)!;
      if (!item) return plain(f.mutations);
      // against the frame's current document: the key or the link it adjusts are the ones it has now
      return planFrame(item, p.look.params, id, d, { amount: p.look.amount, links: linksFor(ctx, id), noDiff: true }).mutations;
    }, { id: p.id, label, by: 'user', source: { kind: 'look', look: p.look.id, name: p.look.name, amount: p.look.amount, why: p.why } });
    const main = o.main?.length ? [{ doc: MAIN, tx: transaction({ id: `${p.id}:${MAIN}`, label, by: 'user', source: { kind: 'look' }, batch: p.id, mutations: o.main }) }] : [];
    if (batch.edits.length || main.length) studio.change((log) => log.commit({ ...batch, edits: [...batch.edits, ...main] } as Batch), label);
    return true;
  }
  /** Edits of several frames (and of the main document) as one batch, one step of the log. */
  function commitFrames(ctx: any, o: { id: string; label: string; source: Record<string, unknown>; frames: ReadonlyMap<string, Mutation[]>; main?: Mutation[] }): number {
    const studio = studioOf(ctx);
    const batch = planBatch(studio.log.targets<Document>([...o.frames.keys()].filter((f) => studio.log.has(f))), (_d, f) => o.frames.get(f) ?? null, { id: o.id, label: o.label, by: 'user', source: o.source as any });
    const main = o.main?.length ? [{ doc: MAIN, tx: transaction({ id: `${o.id}:${MAIN}`, label: o.label, by: 'user', source: o.source as any, batch: o.id, mutations: o.main }) }] : [];
    if (batch.edits.length || main.length) studio.change((log) => log.commit({ ...batch, edits: [...batch.edits, ...main] } as Batch), o.label);
    return batch.edits.length;
  }
  const setView = (ctx: any, k: keyof LooksView, v: unknown): void => ctx.rt.store.writeView([{ path: ['looksView', k], value: plain(v) }]);
  const showPending = (ctx: any, p: LookPlan | null): void =>
    ctx.rt.store.writeView([{ path: ['looksView', 'pending'], value: plain(p) }, { path: ['looksView', 'off'], value: [] }, { path: ['looksView', 'stale'], value: [] }]);
  const pickedLook = (s: any): LookItem | null => lookById(s, looksView(s).picked);
  const needLook = { enabled: (s: any) => !!sel.current(s) && !!pickedLook(s), why: (s: any) => (!sel.current(s) ? 'Select a frame first' : 'Pick a look first') };
  const lookArg = (ctx: any, id?: string | LookItem | null): LookItem | null => (isLookItem(id) ? id : lookById(ctx.state, id ?? looksView(ctx.state).picked));

  // ── copy, paste, sync ──
  /** the plain values a copy carries: the chosen groups' medium fields and the main exposure's and the lights' params */
  function copyValues(r: Document, groups: readonly string[], links: LinkContext): { path: string; value: unknown }[] {
    const out: { path: string; value: unknown }[] = [];
    for (const e of diffDocs(defaultsOf(r), r, { groups: syncGroups })) {
      if (!inGroups(e.path, groups, syncGroups, r) || e.path.startsWith('masks.') || e.b === undefined) continue;
      if (isLayerPath(e.path) && !/^(main|lights)\.params\./.test(e.path)) continue;
      out.push({ path: e.path, value: plain(read(r, e.path, links) ?? e.b) });
    }
    // paths equal to the defaults are copied too, so a paste resets them
    for (const p of [PAPER_PATH, GRADE_PATH, LIGHTS_PATH, TIME_PATH, FILTRATION_PATH, FSTOP_PATH])
      if (inGroups(p, groups, syncGroups, r) && !out.some((e) => e.path === p) && read(r, p) !== undefined) out.push({ path: p, value: plain(read(r, p)) });
    return out;
  }
  /** the source's looks (link entries) in the chosen groups: the same links on the targets */
  const copiedLinks = (r: Document, groups: readonly string[]) => (groups.includes('Looks') ? linkCopies(r) : []);
  function linkCopies(r: Document): { ref: any; params: any; amount: number; name: string; key: string }[] {
    const seen = new Set<string>();
    const out: { ref: any; params: any; amount: number; name: string; key: string }[] = [];
    for (const st of ['scan', 'scene', 'darkroom', 'print'] as const) {
      const stack = r.stages[st]?.stack;
      if (!stack) continue;
      for (const id of stack.order) {
        const e = stack.items[id]!;
        if (e.kind !== 'link' || 'roll' in e.ref) continue;
        const key = typeof e.source['link'] === 'string' ? (e.source['link'] as string) : id;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ref: e.ref, params: e.params, amount: e.amount, name: e.name, key });
      }
    }
    return out;
  }
  /** a paste on one frame: the copied values as sets, the copied looks as links (each frame on its own afterwards) */
  function pasteMutations(d: Document, values: readonly { path: string; value: unknown }[], links: ReturnType<typeof linkCopies>, ctx: LinkContext): Mutation[] {
    const ms: Mutation[] = [];
    for (const v of values) if (read(d, v.path) !== undefined || read(d, v.path, ctx) !== undefined) ms.push(set(v.path, plain(v.value)));
    let cur = ms.length ? edit(d, storedMutations(d, ms)).doc : d;
    const out = storedMutations(d, ms);
    for (const l of links) {
      if (linksIn(cur).some((x) => canonicalJSON(x.entry.ref) === canonicalJSON(l.ref))) continue;
      const key = freshKey(cur, { ref: l.ref } as LookItem);
      const ins = insertLink(cur, l.ref, { key, params: l.params, amount: l.amount, name: l.name, source: { kind: 'look', copied: true } }, ctx);
      cur = edit(cur, ins).doc;
      out.push(...ins);
    }
    return out;
  }
  /** the lines a copy shows ("time 10.0 s, Warm print") */
  const copyLines = (values: readonly { path: string }[], links: ReturnType<typeof linkCopies>, r: Document): string[] =>
    [...values.map((v) => `${v.path.split('.').pop()} (${groupOf(v.path, syncGroups, r) ?? 'other'})`), ...links.map((l) => l.name)];

  /** the frame's own layers in the chosen groups as a preset (Save Frame as Preset, sync by link) */
  /** the frame's own entries of the chosen groups as a preset (Save Frame as Preset, sync by link); its looks (when
   *  the Looks group is chosen) baked into their groups, so the preset stands on its own */
  function presetFrom(r: Document, id: string, name: string, groups: readonly string[], ctx: LinkContext): Preset {
    const resolved = resolveLinks(r, ctx);
    const stacks: Record<string, any> = {};
    for (const st of ['darkroom', 'print'] as const) {
      const stack = r.stages[st]?.stack;
      if (!stack) continue;
      const order = stack.order.filter((x) => x !== 'main' && x !== 'lights' && inGroups(x, groups, syncGroups, r));
      if (order.length) stacks[st] = { order, items: Object.fromEntries(order.map((x) => [x, plain(resolved.stages[st]!.stack.items[x])])) };
    }
    return makePreset(id, name, stacks, plain(resolved.masks));
  }

  return {
    studioOf, extra, looksOf, presetsOf, ringLooks, lookById, paramsOf, tile, caption, print, before, diffAgainst, committed, selection, rollFrameIds, plan, commit, setView,
    showPending, pickedLook, needLook, lookArg, linksFor, commitFrames, copyValues, copiedLinks, linkCopies, pasteMutations, copyLines, presetFrom, newBatchId, summary,
    syncGroupsOf: (g?: SyncGroups): SyncGroups => (g ? (syncGroups = g) : syncGroups),
  };
}
export type LooksModel = ReturnType<typeof createLooksModel>;
