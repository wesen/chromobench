// cb.kits.roll (CHB-020 guide §5): the roll workflow as builder calls on top of cb.core — roll records, roll
// analysis, the automatic first print, the contact sheet and cull, "print the roll like this frame" as one
// previewed batch with one card, and roll-level settings. Headless: forms, commands, passes, state; the DOM
// renderers are kits/roll/src/dom.ts (ROLL_RENDERERS, passed to mountStudio).
//
//   const { roll } = cb.kits;      // the product: kit, panels, views, modules, menus, keys, sel, lib, tools, commands, docs
//   cb.studio('X').use(roll.kit).menus(...cb.menus.standard(), roll.menus.roll()).module(roll.modules.roll())
//   ck.module('m').left(roll.panels.library()).center(roll.views.contactSheet()).right(roll.panels.balanceBar())
//
// The physics (ingest's film layout and roll base, core's integrate-to-grey) arrives as the service
// `rollPhysics` (RollPhysics), like the engine: studio-kit imports only the contract and the shell.
//
// CHB-037: the frames' edits are documents in the store's log. A roll batch (first print, match, clear) is committed
// with the values batch builder (`plan`) as one step of the log, together with the roll record it changes (an edit
// of the main document in the same batch): one undo takes the frames and the roll's status back together. The
// current roll is the view tier (a selection, not an edit).
//
// CHB-037 P7 (links): the roll record holds the scan fields its frames share (`media.scan`); each frame's scan medium
// links to it, so a roll setting (the stock, the measured base and veil) is one edit of the roll that every frame
// follows unless it overrides the field; the overrides are the divergence ("overridden on 2 frames").

/* eslint-disable @typescript-eslint/no-explicit-any */
import { canonicalJSON, plan, set, transaction, type Mutation } from '@chromobench/values';
import { edit, followLink, resolveLinks, storedPath, type Diagnostic, type Document, type Vec3 } from '@chromobench/contract';
import type { Ck, NodeData } from '@chromobench/shell';
import { MAIN, slot, strip, type FormSpec } from '@chromobench/shell';
import type { Cb } from '../../../src/cb.ts';
import { sel, type CatalogFrame } from '../../../src/sel.ts';
import { frameRef } from '../../../src/handles.ts';
import { FILTRATION_PATH, LIGHTS_PATH, lightsOf, linksOf, mainExposure, read, TIME_PATH } from '../../../src/model/doc.ts';
import { stockName } from '../../../src/model/names.ts';
import type { Studio } from '../../../src/studio.ts';
import { analyseRoll } from './engine/analyse.ts';
import { plain, previewOf, staleDiagnostics, staleOf, withoutFrames, type MutationBatch } from './engine/batch.ts';
import { ALPHA, ROLL_CONSISTENCY, ROLL_TX, rollField, SHARED_PATHS } from './engine/constants.ts';
import { autoOf, clearMatchBatch, firstPrintBatch, handEdited, matchBatch, splitTotal, totalOf } from './engine/lower.ts';
import { baseOfVeilFree, diverging, flareOfVeil, linkFrame, newRoll, rollValue, sharedOf, withRollValue, type FrameId, type Roll, type RollPhysics } from './engine/model.ts';

export interface RollDoc {
  rolls: Record<string, Roll>;
  order: string[];
  current: string | null;
}
export interface RollView {
  contact: { mode: 'balanced' | 'single' };
  /** the pending batch (match, clear) shown as a preview with one card */
  pending: MutationBatch | null;
  /** frames unticked on the card */
  off: FrameId[];
  stale: { code: string; message: string }[];
  progress: { done: number; total: number; frame: string | null } | null;
  /** the match's colour share (the "roll consistency" slider) */
  alpha: number;
  /** first print: colour share towards the roll's mean */
  consistency: number;
  error: string | null;
}
export const ROLL_STATE: { roll: RollDoc; rollView: RollView } = {
  roll: { rolls: {}, order: [], current: null },
  rollView: { contact: { mode: 'balanced' }, pending: null, off: [], stale: [], progress: null, alpha: 0.45, consistency: ROLL_CONSISTENCY, error: null },
};

// ── state readers (also used by the DOM half) ──
export const rollOf = (s: any, id?: string | null): Roll | null => {
  const d = s?.roll as RollDoc | undefined;
  if (!d) return null;
  if (id) return d.rolls[id] ?? null;
  if (d.current && d.rolls[d.current]) return d.rolls[d.current]!;
  const f = sel.current(s);
  const byFrame = f ? d.order.map((r) => d.rolls[r]!).find((r) => r?.frames.includes(f)) : null;
  return byFrame ?? (d.order.length ? d.rolls[d.order[0]!] ?? null : null);
};
export const rejectedOf = (s: any): Set<FrameId> => new Set(Object.values((s?.catalog?.frames ?? {}) as Record<string, CatalogFrame>).filter((f) => f.flag === 'reject').map((f) => f.id));
export const rollFrames = (s: any): CatalogFrame[] => {
  const r = rollOf(s);
  const cat = s?.catalog?.frames ?? {};
  return r ? r.frames.map((f) => cat[f]).filter((x: CatalogFrame | undefined): x is CatalogFrame => !!x) : [];
};
/** the document a contact cell shows: the pending batch's preview, or in 'single' mode the reference's time and lights */
export function contactRecipe(s: any, f: FrameId): Document | null {
  // the state's read-only views are unwrapped: a document is edited (previewed) as the plain value it is
  const r0 = strip(s?.docs?.[f]) as Document | undefined;
  if (!r0) return null;
  let r = previewOf(strip(s?.rollView?.pending), f, r0);
  if (s?.rollView?.contact?.mode === 'single') {
    const roll = rollOf(s);
    const ref = roll?.reference ? (strip(s.docs?.[roll.reference]) as Document | undefined) : undefined;
    const time_s = ref ? mainExposure(ref).time_s : 10;
    const logH = ref ? lightsOf(ref) : ([0, 0, 0] as Vec3);
    try {
      r = edit(r, [set(TIME_PATH, time_s), set(LIGHTS_PATH, logH), ...(ref ? [set(FILTRATION_PATH, mainExposure(ref).filtration)] : [])]).doc;
    } catch {
      // a document that does not take the reference's values (another kind): as it is
    }
  }
  return r;
}
/** the badge of a frame in a roll: reference, mixed base, probable under-exposure, diverging settings */
export function rollBadge(s: any, f: FrameId): string {
  const roll = rollOf(s);
  if (!roll || !roll.frames.includes(f)) return '';
  const out: string[] = [];
  if (roll.reference === f) out.push('★ ref');
  const a = roll.analysis;
  if (a?.base.mixed.includes(f)) out.push('base ≠ roll');
  if (a?.frames[f]?.hint === 'under') out.push('under?');
  const r = s?.docs?.[f] as Document | undefined;
  if (r && divergenceOf(roll, f, r)) out.push('diverges');
  if (s?.rollView?.pending?.frames?.some((x: any) => x.frame === f) && !s.rollView.off?.includes(f)) out.push('preview');
  return out.join(' · ');
}
/** the film strip's roll badge: which roll a frame belongs to, ★ for the reference, ≠ when it diverges */
export function rollTag(s: any, f: FrameId): string {
  const d = s?.roll as RollDoc | undefined;
  if (!d?.order?.length) return '';
  const r = s?.docs?.[f] as Document | undefined;
  const id = d.order.find((x) => d.rolls[x]?.frames.includes(f));
  const roll = id ? d.rolls[id] : undefined;
  if (!roll) return '';
  return `roll ${d.order.indexOf(roll.id) + 1}${roll.reference === f ? ' ★' : ''}${r && divergenceOf(roll, f, r) ? ' ≠' : ''}`;
}
const divergenceOf = (roll: Roll, _f: FrameId, r: Document): boolean => diverging(roll, strip(r)).length > 0;

const ROLL_DOCS = `## cb.kits.roll
The roll workflow (CHB-020): a roll record per piece of film (the main document's slice \`roll\`), measured once — base
(median of the frames' rebates), veil read on the holder, σ and class shares at the analysis size, stock ranking —
then an automatic first print of every frame (one \`by: auto\` batch, one undo step), the contact sheet and cull, and
"print the roll like this frame": integrate-to-grey with the reference frame as the aim, previewed on the sheet,
approved on one card, applied as one batch (one undo step across the frames' documents). What the roll shares (the
scan's scanner, stock, format, flat, open gate, veil and base) is held by the roll record; every frame's scan links
to it, so one roll edit reaches every frame that has not overridden the field, and a frame's overrides are its
divergence (Reset to Roll drops one).`;

export function createRollKit(ck: Ck, cb: Cb) {
  const node = (form: string, props: Record<string, unknown> = {}): any => ck.node(form, props, []);
  const studioOf = (ctx: any): Studio => {
    const s = ctx.services?.studio as Studio | undefined;
    if (!s) throw new Error('No studio service: start the app with studio.services()');
    return s;
  };
  const physicsOf = (ctx: any): RollPhysics | null => (ctx.services?.rollPhysics as RollPhysics | undefined) ?? null;
  // the log's committed document of a frame
  const recipeOf = (ctx: any) => (f: FrameId): Document | undefined => studioOf(ctx).doc(f) ?? ctx.state.docs?.[f];
  /** a roll record written on its own (an analysis): one step */
  const writeRoll = (ctx: any, roll: Roll, label: string): void => void ctx.tx(label, (t: any) => t.$set(['roll', 'rolls', roll.id], plain(roll)), { by: 'auto' });
  const setView = (ctx: any, k: keyof RollView, v: unknown): void => ctx.rt.store.writeView([{ path: ['rollView', k], value: plain(v) }]);
  const isHandEdited = (ctx: any) => (f: FrameId): boolean => handEdited(studioOf(ctx).rt?.store.log.has(f) ? studioOf(ctx).log.inEffect(f) : []);
  const hasRoll = { enabled: (s: any) => !!rollOf(s), why: 'Make a roll first (Roll ▸ New Roll from Open Frames)' };

  /**
   * apply a batch: staleness first (E_STALE unless forced), then the values batch builder over the frames (every
   * transaction carries the batch's id) and one commit: one step of the log
   */
  function applyBatch(ctx: any, b: MutationBatch, o: { force?: boolean; roll?: Roll; main?: Mutation[] } = {}): Diagnostic[] | true {
    const stale = staleOf(b, recipeOf(ctx));
    if (stale.length && !o.force) return staleDiagnostics(stale);
    const studio = studioOf(ctx);
    const by = new Map(plain(b.frames).map((f) => [f.frame, f.mutations]));
    const id = b.id.startsWith(ROLL_TX) ? b.id : `${ROLL_TX}${b.id}`;
    const source = { kind: 'roll', batch: b.kind, why: b.why };
    const batch = plan(studio.log.targets<Document>([...by.keys()].filter((f) => studio.log.has(f))), (_d, f) => by.get(f) ?? null, { id, label: b.label, by: b.by, source });
    // the roll record the batch changes (status, match) goes into the same step
    const main = [...(o.roll ? [set(`roll.rolls.${o.roll.id}`, plain(o.roll))] : []), ...(o.main ?? [])];
    const rollEdit = main.length ? [{ doc: MAIN, tx: transaction({ id: `${id}:${MAIN}`, label: b.label, by: b.by, source, batch: id, mutations: main }) }] : [];
    if (batch.edits.length || rollEdit.length) studio.change((log) => log.commit({ ...batch, edits: [...batch.edits, ...rollEdit] }), b.label);
    return true;
  }

  async function analyse(ctx: any, o: { firstPrint?: boolean } = {}): Promise<Roll | null> {
    const roll = rollOf(ctx.state);
    const physics = physicsOf(ctx);
    if (!roll || !physics) return null;
    const studio = studioOf(ctx);
    const entries = roll.frames
      .map((f) => studio.frames.get(f))
      .filter((e): e is NonNullable<typeof e> => !!e)
      .filter((e) => !!studio.doc(e.id))
      // the analysis reads each frame as the compiler sees it: its scan through the roll's link
      .map((e) => ({ id: e.id, sha256: e.sha, graph: e.graph, doc: resolveLinks(studio.doc(e.id)!, linksOf(ctx.state)) }));
    setView(ctx, 'progress', { done: 0, total: entries.length, frame: null });
    setView(ctx, 'error', null);
    try {
      const analysis = await analyseRoll(studio.engine, entries, physics, {
        alpha: ALPHA,
        rejected: rejectedOf(ctx.state),
        onProgress: (done, total, frame) => setView(ctx, 'progress', { done, total, frame }),
        now: () => ctx.rt.clock?.now?.() ?? Date.now(),
      });
      const top = analysis.ranking?.[0]?.stock;
      let next: Roll = { ...rollOf(ctx.state, roll.id)!, analysis, status: 'analysed' };
      if (top && !rollValue(next, 'stock')) next = withRollValue(next, 'stock', top);
      // the measured base and veil are the roll's scan settings, not pixel edits: baseT and per-channel flare; every
      // frame linked to the roll follows them (a frame that overrides one keeps its own)
      const bs = analysis.base;
      if (bs.T) next = withRollValue(next, 'baseT', baseOfVeilFree(bs.T, bs.veil));
      if (bs.veil) next = withRollValue(next, 'flare', flareOfVeil(bs.veil));
      for (const d of analysis.diagnostics) ctx.rt.diagnostics.info(d.code, d.message, { runtime: true });
      // the analysis is a step of its own (by auto), so undoing the first print keeps what was measured
      writeRoll(ctx, next, `Analyse ${next.label}`);
      if (o.firstPrint) firstPrint(ctx);
      return rollOf(ctx.state, roll.id);
    } catch (e) {
      setView(ctx, 'error', String((e as Error)?.message ?? e));
      throw e;
    } finally {
      setView(ctx, 'progress', null);
    }
  }

  /** the roll's own bookkeeping once its first print is in */
  const firstPrinted = (cur: Roll): Roll => ({ ...cur, status: 'first-printed' });
  /** the frames that have no first print yet (the automatic one on a new roll), or `only` */
  function planFirstPrint(ctx: any, only?: FrameId[], of?: Roll): MutationBatch | null {
    const roll = of ?? rollOf(ctx.state);
    if (!roll?.analysis) return null;
    const pending = only ?? roll.frames.filter((f) => { const d = recipeOf(ctx)(f); return !d || !['roll', 'match'].includes(String(autoOf(d)['method'] ?? '')); });
    if (!pending.length) return null;
    return firstPrintBatch(roll, recipeOf(ctx), { rejected: rejectedOf(ctx.state), consistency: ctx.state.rollView?.consistency ?? ROLL_CONSISTENCY, only: pending });
  }
  /** the automatic first print of a new roll: applied at once, by 'auto', one undo step */
  function firstPrint(ctx: any, only?: FrameId[], of?: Roll): MutationBatch | null {
    const roll = of ?? rollOf(ctx.state);
    const b = roll ? planFirstPrint(ctx, only, roll) : null;
    if (!b || !roll) return null;
    applyBatch(ctx, b, { force: true, roll: firstPrinted(roll) });
    return b;
  }
  function planMatch(ctx: any): MutationBatch | null {
    const roll = rollOf(ctx.state);
    const physics = physicsOf(ctx);
    if (!roll?.reference || !roll.analysis || !physics) return null;
    return matchBatch(roll, roll.reference, recipeOf(ctx), physics, { alpha: ctx.state.rollView?.alpha ?? 0.45, rejected: rejectedOf(ctx.state), handEdited: isHandEdited(ctx) });
  }
  function showPending(ctx: any, b: MutationBatch | null): void {
    // coalescing: a new plan replaces the pending one (moving the slider does not stack batches)
    ctx.rt.store.writeView([{ path: ['rollView', 'pending'], value: plain(b) }, { path: ['rollView', 'off'], value: [] }, { path: ['rollView', 'stale'], value: [] }]);
  }

  // ── forms ──
  const { build: bt, traced: tr } = slot;
  const spec = (name: string, slots: FormSpec['slots'], doc: string): FormSpec => ({ name, slots, doc, kind: 'cb' });
  const FORMS: FormSpec[] = [
    spec('roll.library', { compact: bt<boolean>() }, 'The rolls: label, frames, status; New roll from the open frames; Analyse; First print'),
    spec('roll.setup', { sections: bt<string[]>('stock · scanner · base · veil · noise · frames'), evidence: bt<boolean>() }, 'Roll setup: each roll-shared setting with the evidence behind it and "overridden on N frames"'),
    spec('roll.balanceBar', { compact: bt<boolean>() }, 'Reference frame, roll consistency (α), Match to reference, Clear; the pending batch as one card'),
    spec('roll.inspector', { frame: tr<string | null>() }, 'Per frame: rebate, base deviation, σ, class shares, LATD, auto lights'),
    spec('roll.progress', {}, 'Roll analysis progress'),
  ];

  // ── fragments ──
  const rollScope = ck.fragment('cb.arg', {
    methods: { rollScope: (mode: 'frame' | 'roll' | 'ask' = 'ask') => ({ rollScope: mode }) },
    props: { rollScope: { default: 'frame', doc: "'frame' | 'roll' | 'ask': this control edits the frame, or the whole roll (one batch)" } },
    doc: 'rollScope(): the control edits this frame or the roll (cb.kits.roll)',
  });

  // ── passes (guide §5.5) ──
  const checks = ck.pass('cb.roll.checks', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    const bars = ir.find('roll.balanceBar') as NodeData[];
    const sheets = [...(ir.find('roll.library') as NodeData[]), ...(ir.find('gridview') as NodeData[]).filter((n) => n.props['id'] === 'contact')];
    if (bars.length && !sheets.length)
      p.warn('CB-R002', 'cb.kits.roll.panels.balanceBar() has no contact sheet or roll library to choose a reference from', { at: bars[0]!.at, fix: 'add cb.kits.roll.views.contactSheet() to the centre, or cb.kits.roll.panels.library() to the left dock' });
    for (const n of ir.find('cb.arg') as NodeData[]) {
      const mode = n.props['rollScope'];
      if (!mode || mode === 'frame') continue;
      const path = String(n.props['path']);
      if (!(SHARED_PATHS as readonly string[]).includes(path))
        p.error('CB-R003', `cb.arg('${path}').rollScope('${mode}'): ${path} is not shared by the roll`, { at: n.at, facts: [`roll-shared paths: ${SHARED_PATHS.join(', ')}`], fix: `cb.arg('${path}') (frame scope), or a shared path such as cb.arg('stages.scan.medium.stock').rollScope('${mode}')` });
    }
  });
  /** CB-R001: roll forms in a layout that did not install the kit (cb.core's pass cb.kits runs it) */
  const missing = (ir: any, p: any): void => {
    if (ir.kits.some((k: any) => k.name === 'cb.roll')) return;
    for (const f of FORMS) {
      const n = (ir.find(f.name) as NodeData[])[0];
      if (n) {
        p.error('CB-R001', `${f.name} is used, but the roll kit is not installed`, { at: n.at, fix: '.use(cb.kits.roll.kit) on the studio' });
        return;
      }
    }
  };

  // ── the kit ──
  const kit = ck
    .kit('cb.roll')
    .version('1')
    .requires('cb.core')
    .state('roll', { init: ROLL_STATE.roll, view: ['current'] })
    .state('rollView', { init: ROLL_STATE.rollView, view: true })
    .forms(...FORMS)
    .fragments(rollScope)
    .passes(checks)
    .commands({
      'roll.fromFrames': {
        label: 'New Roll from Open Frames',
        enabled: (s: any) => (s.catalog?.order?.length ?? 0) > 0,
        why: 'Open the scans of a roll first',
        run: (ctx: any, o: { analyse?: boolean; label?: string } = {}) => {
          const sel: string[] = ctx.state.ui?.selection?.ids ?? [];
          const frames: string[] = sel.length > 1 ? sel : [...(ctx.state.catalog?.order ?? [])];
          const first = recipeOf(ctx)(frames[0]!);
          if (!first) return null;
          const n = Object.keys(ctx.state.roll?.rolls ?? {}).length + 1;
          const id = `roll-${n}`;
          const links = linksOf(ctx.state);
          const shared = sharedOf(first, links);
          const stock = shared['stock'];
          const label = o.label ?? `${typeof stock === 'string' ? stockName(stock) : 'Roll'} · ${frames.length} frames`;
          const roll = newRoll(id, label, frames, shared);
          // the roll and every frame's link to it: one step (the frames keep their own fields as overrides). By 'auto':
          // linking changes no print, so a frame stays "unedited" for the looks and the agent
          const b: MutationBatch = {
            id: `${ROLL_TX}new-${id}`, kind: 'setup', label: `New roll "${label}"`, why: `${frames.length} frames share ${Object.keys(shared).join(', ') || 'nothing yet'}`, by: 'auto', skipped: [],
            frames: frames.map((f) => ({ f, d: recipeOf(ctx)(f) })).map(({ f, d }) => ({ frame: f, mutations: d ? [linkFrame(roll, strip(d), links)].filter((m): m is Mutation => !!m) : [], expect: {} })),
          };
          applyBatch(ctx, b, { force: true, roll, main: [set('roll.order', [...plain(ctx.state.roll?.order ?? []), id])] });
          ctx.rt.store.writeView([{ path: ['roll', 'current'], value: id }]);
          return o.analyse === false ? id : analyse(ctx, { firstPrint: true }).then(() => id);
        },
      },
      'roll.select': {
        label: 'Select Roll',
        palette: false,
        // a selection, not an edit: no undo step
        run: (ctx: any, id: string) => {
          if (ctx.state.roll?.current !== id) ctx.rt.store.writeView([{ path: ['roll', 'current'], value: id }]);
        },
      },
      'roll.analyse': {
        label: 'Analyse Roll',
        enabled: (s: any) => !!rollOf(s) && !s.rollView?.progress,
        why: 'Make a roll first, or wait for the running analysis',
        run: (ctx: any) => (physicsOf(ctx) ? analyse(ctx) : (ctx.toast('The host provides no roll physics (services.rollPhysics)', { kind: 'error' }), null)),
      },
      'roll.firstPrint': {
        label: 'First Print of the Roll',
        enabled: (s: any) => !!rollOf(s)?.analysis,
        why: 'Analyse the roll first',
        // one card: the first print of the roll as a batch to approve or reject (the automatic one on a new roll is applied at once)
        run: (ctx: any, all = false) => {
          const b = planFirstPrint(ctx, all ? rollOf(ctx.state)!.frames : undefined);
          showPending(ctx, b);
          return b;
        },
      },
      'roll.setReference': {
        label: 'Set as Roll Reference',
        enabled: (s: any) => !!rollOf(s) && !!sel.current(s) && rollOf(s)!.frames.includes(sel.current(s)!),
        why: 'Select a frame of the roll',
        run: (ctx: any) => {
          const roll = rollOf(ctx.state)!;
          const f = sel.current(ctx.state)!;
          ctx.tx(`Reference: ${ctx.state.catalog?.frames?.[f]?.name ?? f}`, (t: any) => t.$set(['roll', 'rolls', roll.id, 'reference'], f));
        },
      },
      'roll.matchToReference': {
        label: 'Print the Roll Like the Reference',
        enabled: (s: any) => !!rollOf(s)?.reference && !!rollOf(s)?.analysis,
        why: (s: any) => (!rollOf(s)?.analysis ? 'Analyse the roll first' : 'Choose a reference frame first'),
        run: (ctx: any) => {
          const b = planMatch(ctx);
          showPending(ctx, b);
          return b;
        },
      },
      'roll.alpha': {
        label: 'Roll Consistency',
        palette: false,
        run: (ctx: any, a: number) => {
          setView(ctx, 'alpha', Math.max(0, Math.min(1, Number(a))));
          if (ctx.state.rollView?.pending?.kind === 'match') showPending(ctx, planMatch(ctx));
        },
      },
      'roll.pending.toggle': {
        label: 'Include Frame',
        palette: false,
        run: (ctx: any, f: string) => {
          const off: string[] = ctx.state.rollView?.off ?? [];
          setView(ctx, 'off', off.includes(f) ? off.filter((x) => x !== f) : [...off, f]);
        },
      },
      'roll.pending.approve': {
        label: 'Approve Roll Batch',
        palette: false,
        enabled: (s: any) => !!s.rollView?.pending,
        why: 'Nothing pending',
        run: (ctx: any, force = false) => {
          // plain copies: the state hands out read-only proxies, which the logs (and their KV) cannot clone
          const b = plain(ctx.state.rollView?.pending as MutationBatch | null);
          if (!b) return null;
          const cur = rollOf(ctx.state);
          // the roll's record after the batch, committed with it
          const roll = !cur ? undefined
            : b.kind === 'match' ? { ...cur, match: { alpha: Number(b.meta?.['alpha'] ?? 0), appliedAt: ctx.rt.clock?.now?.() ?? Date.now(), batch: b.id }, status: 'balanced' as const }
              : b.kind === 'clear-match' ? { ...cur, match: null, status: 'first-printed' as const }
                : b.kind === 'first-print' ? firstPrinted(cur) : undefined;
          const res = applyBatch(ctx, withoutFrames(b, plain(ctx.state.rollView.off ?? [])), { force: !!force, ...(roll ? { roll } : {}) });
          if (res !== true) {
            setView(ctx, 'stale', res.map((d) => ({ code: d.code, message: d.message })));
            return res;
          }
          showPending(ctx, null);
          return true;
        },
      },
      'roll.pending.reject': { label: 'Reject Roll Batch', palette: false, run: (ctx: any) => showPending(ctx, null) },
      'roll.clearMatch': {
        label: 'Clear Roll Match',
        enabled: (s: any) => !!rollOf(s)?.match,
        why: 'Nothing matched',
        run: (ctx: any) => {
          const roll = rollOf(ctx.state)!;
          const b = clearMatchBatch(roll, recipeOf(ctx), { consistency: ctx.state.rollView?.consistency ?? ROLL_CONSISTENCY, rejected: rejectedOf(ctx.state) });
          showPending(ctx, b);
          return b;
        },
      },
      'roll.setShared': {
        label: 'Set on the Roll',
        palette: false,
        ...hasRoll,
        run: (ctx: any, path: string, v: unknown) => {
          const roll = rollOf(ctx.state)!;
          const value = plain(v);
          const field = rollField(path);
          const docs = roll.frames.map((f) => ({ f, d: recipeOf(ctx)(f) })).filter((x): x is { f: string; d: Document } => !!x.d).map((x) => ({ ...x, d: strip(x.d) }));
          // a roll field: the roll's value, and every frame follows it again (its override goes); any other setting:
          // copied to every frame of the roll (a sync by copy). One step either way.
          const frames = docs.map(({ f, d }) => {
            if (field) return { frame: f, mutations: [followLink(d, 'scan', field)].filter((m): m is Mutation => !!m), expect: {} };
            return read(d, path) !== undefined && canonicalJSON(read(d, path)) !== canonicalJSON(value)
              ? { frame: f, mutations: [set(storedPath(d, path), value)], expect: {} } : { frame: f, mutations: [], expect: {} };
          });
          const b: MutationBatch = { id: `${ROLL_TX}set-${roll.id}-${Date.now().toString(36)}`, kind: 'custom', label: `Roll: ${path}`, why: field ? `the roll's ${field}, followed by every frame` : `${path} copied to the roll's frames`, by: 'user', frames, skipped: [] };
          applyBatch(ctx, b, { force: true, ...(field ? { roll: withRollValue(roll, field, value) } : {}) });
        },
      },
      'roll.applyToRoll': {
        label: 'Apply This Setting to the Roll',
        palette: false,
        ...hasRoll,
        run: (ctx: any, path: string) => {
          const f = sel.current(ctx.state);
          const r = f ? recipeOf(ctx)(f) : undefined;
          if (r) ctx.run('roll.setShared', path, read(r, path, linksOf(ctx.state)));
        },
      },
      'roll.followRoll': {
        label: 'Reset to the Roll',
        palette: false,
        ...hasRoll,
        // the selected frame drops its own value of a roll field and follows the roll again (its divergence goes)
        run: (ctx: any, path: string) => {
          const f = sel.current(ctx.state);
          const r = f ? recipeOf(ctx)(f) : undefined;
          const field = rollField(path);
          const m = r && field ? followLink(strip(r), 'scan', field) : null;
          if (!f || !m) return null;
          return applyBatch(ctx, { id: `${ROLL_TX}follow-${f}-${Date.now().toString(36)}`, kind: 'custom', label: `Reset ${field} to the roll`, why: `${f} follows the roll's ${field} again`, by: 'user', frames: [{ frame: f, mutations: [m], expect: {} }], skipped: [] }, { force: true });
        },
      },
      'roll.contact.mode': {
        label: 'Contact Sheet: One Time and Pack',
        checked: (s: any) => s.rollView?.contact?.mode === 'single',
        run: (ctx: any, mode?: 'balanced' | 'single') => setView(ctx, 'contact', { mode: mode ?? (ctx.state.rollView?.contact?.mode === 'single' ? 'balanced' : 'single') }),
      },
      'roll.cull.sweep': {
        label: 'Cull the Roll',
        ...hasRoll,
        run: (ctx: any) => {
          const first = rollOf(ctx.state)!.frames[0];
          if (first) ctx.run('frame.select', first);
          ctx.set({ view: { mode: 'loupe' } });
        },
      },
      'roll.exportSheet': {
        label: 'Export Contact Sheet…',
        ...hasRoll,
        run: (ctx: any) => ctx.toast('Contact sheet export (darkroom.contactSheet) comes with CHB-011', { kind: 'info' }),
      },
    })
    .docs(ROLL_DOCS);

  // ── builder calls ──
  const contactCell = (o: { size?: number } = {}) => (item: CatalogFrame) =>
    ck.column(
      { class: 'cb-cell cb-roll-cell' },
      ck.view.thumb({ image: (s: any) => (contactRecipe(s, item.id) ? frameRef(item.id, contactRecipe(s, item.id)!).print() : null), max: o.size ?? 200, badge: (s: any) => rollBadge(s, item.id) } as any),
      ck.text((s: any) => caption(s.catalog?.frames?.[item.id] ?? item), { dim: true }),
    );
  const contactSheet = (o: { size?: number; keys?: Record<string, unknown>; columns?: number } = {}) =>
    ck.column(
      { grow: 1, class: 'cb-roll-sheet' },
      ck.row(
        { class: 'cb-roll-sheet-bar' },
        ck.ui.segmented({ options: [{ value: 'balanced', label: 'Each frame balanced' }, { value: 'single', label: 'One time and pack' }], bind: (s: any) => s.rollView.contact.mode, label: 'Contact sheet', small: true } as any),
        node('roll.progress', {}),
      ),
      ck.view.grid((s: any) => rollFrames(s), {
        id: 'contact',
        cell: contactCell(o),
        key: (x: CatalogFrame) => x.id,
        size: () => o.size ?? 180,
        select: { bind: (s: any) => s.ui.selection, mode: 'multi' },
        ...(o.keys ? { keys: o.keys } : {}),
        empty: 'No roll yet: open the scans, then Roll ▸ New Roll from Open Frames',
      } as any),
    );
  const panel = (form: string, id: string, title: string) => (o: Record<string, unknown> = {}) => {
    const { id: pid, title: t, ...rest } = o as { id?: string; title?: string };
    return ck.panel.define(pid ?? id, { title: t ?? title }, node(form, rest));
  };

  /** the Roll module: rolls and their setup left, the contact sheet in the centre, the balance bar and analysis right */
  const rollModule = (o: { id?: string } = {}) =>
    ck
      .module(o.id ?? 'roll', { label: 'Roll', key: 'Mod+Alt+R' })
      .left(ck.dock.column({ width: 300 }, panels.library(), panels.setup()))
      .center(contactSheet({ size: 180 }))
      .right(ck.dock.column({ width: 320 }, panels.balanceBar(), panels.inspector(), cb.panels.history({ id: 'history-roll' })))
      .keys(keys.cull);
  const panels = {
    library: panel('roll.library', 'roll-library', 'Rolls'),
    setup: panel('roll.setup', 'roll-setup', 'Roll setup'),
    balanceBar: panel('roll.balanceBar', 'roll-balance', 'Print the roll like…'),
    inspector: panel('roll.inspector', 'roll-inspector', 'Roll analysis'),
  };
  const keys = {
    /** the cull keys plus M (match) and R (reference); scope them to the module that shows the sheet */
    cull: { ...cb.keys.cull, M: 'roll.matchToReference', R: 'roll.setReference' } as Record<string, any>,
  };

  return ck.product(kit, {
    panels,
    views: { contactSheet, contactCell },
    modules: { roll: rollModule },
    menus: {
      /** the Roll menu: new roll, analysis, first print, reference and match */
      roll: () => ck.menu('Roll', ['roll.fromFrames', 'roll.analyse', 'roll.firstPrint', '-', 'roll.setReference', 'roll.matchToReference', 'roll.clearMatch', '-', 'roll.contact.mode', 'roll.cull.sweep', 'roll.exportSheet']),
    },
    keys,
    sel: { roll: rollOf, frames: rollFrames, badge: rollBadge, tag: rollTag, contact: contactRecipe },
    lib: {
      state: ROLL_STATE,
      applyBatch,
      /** exposure bookkeeping, for layouts that show it */
      exposure: { totalOf, splitTotal },
    },
    whenAbsent: missing,
  });
}

export type RollKit = ReturnType<typeof createRollKit>;

const caption = (f: CatalogFrame): string => `${f.flag === 'pick' ? '⚑ ' : f.flag === 'reject' ? '✕ ' : ''}${f.name}${f.stars ? ' ' + '★'.repeat(f.stars) : ''}`;
