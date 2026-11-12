// cb.kits.roll (CHB-020 guide §5): the roll workflow as builder calls on top of cb.core — roll records, roll
// analysis, the automatic first print, the contact sheet and cull, "print the roll like this frame" as one
// previewed batch with one card, and roll-level settings. Headless: forms, commands, passes, state; the DOM
// renderers are kits/roll/src/dom.ts (ROLL_RENDERERS, passed to mountStudio).
//
//   const roll = cb.kits.roll;
//   cb.studio('X').use(roll.kit)
//     .module('roll', m => m.left(roll.library()).center(roll.contactSheet()).right(roll.setup(), roll.balanceBar()))
//
// The physics (ingest's film layout and roll base, core's integrate-to-grey) arrives as the service
// `rollPhysics` (RollPhysics), like the engine: studio-kit imports only the contract and the shell.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { getPath, type Diagnostic, type FrameRecipe, type Mutation, type Vec3 } from '@chromobench/contract';
import type { Ck, NodeData } from '@chromobench/shell';
import { slot, type FormSpec } from '@chromobench/shell';
import type { Cb, CatalogFrame } from '../../../src/cb.ts';
import { frameRef } from '../../../src/handles.ts';
import type { Studio } from '../../../src/studio.ts';
import { analyseRoll } from './engine/analyse.ts';
import { buildBatch, plain, setWithExpect, previewOf, staleDiagnostics, staleOf, withoutFrames, type MutationBatch } from './engine/batch.ts';
import { ALPHA, ROLL_CONSISTENCY, ROLL_TX, SHARED_PATHS } from './engine/constants.ts';
import { clearMatchBatch, firstPrintBatch, handEdited, matchBatch, splitTotal, totalOf } from './engine/lower.ts';
import { baseOfVeilFree, divergence, flareOfVeil, fragmentOf, newRoll, type FrameId, type Roll, type RollPhysics } from './engine/model.ts';

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
  const f = s?.ui?.selection?.primary;
  const byFrame = f ? d.order.map((r) => d.rolls[r]!).find((r) => r?.frames.includes(f)) : null;
  return byFrame ?? (d.order.length ? d.rolls[d.order[0]!] ?? null : null);
};
export const rejectedOf = (s: any): Set<FrameId> => new Set(Object.values((s?.catalog?.frames ?? {}) as Record<string, CatalogFrame>).filter((f) => f.flag === 'reject').map((f) => f.id));
export const rollFrames = (s: any): CatalogFrame[] => {
  const r = rollOf(s);
  const cat = s?.catalog?.frames ?? {};
  return r ? r.frames.map((f) => cat[f]).filter((x: CatalogFrame | undefined): x is CatalogFrame => !!x) : [];
};
/** the recipe a contact cell shows: the pending batch's preview, or in 'single' mode the reference's time and lights */
export function contactRecipe(s: any, f: FrameId): FrameRecipe | null {
  const r0 = s?.recipes?.[f] as FrameRecipe | undefined;
  if (!r0) return null;
  let r = previewOf(s?.rollView?.pending, f, r0);
  if (s?.rollView?.contact?.mode === 'single') {
    const roll = rollOf(s);
    const ref = roll?.reference ? (s.recipes?.[roll.reference] as FrameRecipe | undefined) : undefined;
    const time_s = ref?.print.enlarger.time_s ?? 10;
    const logH = ref?.print.lights.logH ?? ([0, 0, 0] as Vec3);
    r = { ...r, print: { ...r.print, enlarger: { ...r.print.enlarger, time_s, ...(ref ? { filtration: ref.print.enlarger.filtration } : {}) }, lights: { ...r.print.lights, logH } } };
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
  const r = s?.recipes?.[f];
  if (r && divergenceOf(roll, r)) out.push('diverges');
  if (s?.rollView?.pending?.frames?.some((x: any) => x.frame === f) && !s.rollView.off?.includes(f)) out.push('preview');
  return out.join(' · ');
}
/** the film strip's roll badge: which roll a frame belongs to (FrameRecipe.roll), ★ for the reference, ≠ when it diverges */
export function rollTag(s: any, f: FrameId): string {
  const d = s?.roll as RollDoc | undefined;
  if (!d?.order?.length) return '';
  const r = s?.recipes?.[f] as FrameRecipe | undefined;
  const id = r?.roll?.id ?? d.order.find((x) => d.rolls[x]?.frames.includes(f));
  const roll = id ? d.rolls[id] : undefined;
  if (!roll) return '';
  return `roll ${d.order.indexOf(roll.id) + 1}${roll.reference === f ? ' ★' : ''}${r && divergenceOf(roll, r) ? ' ≠' : ''}`;
}
const divergenceOf = (roll: Roll, r: FrameRecipe): boolean => Object.keys(divergence({ fragment: roll.fragment, frames: [r.frame] }, () => r)).length > 0;

const ROLL_DOCS = `## cb.kits.roll
The roll workflow (CHB-020): a roll record per piece of film (document slice \`roll\`), measured once — base
(median of the frames' rebates), veil read on the holder, σ and class shares at the analysis size, stock ranking —
then an automatic first print of every frame (one \`by: auto\` batch, one undo step), the contact sheet and cull, and
"print the roll like this frame": integrate-to-grey with the reference frame as the aim, previewed on the sheet,
approved on one card, applied as one undo step across the frames' EditLogs. Settings shared by the roll are copied
into every recipe; a frame diverges when its value differs (computed, never stored).`;

export function createRollKit(ck: Ck, cb: Cb) {
  const node = (form: string, props: Record<string, unknown> = {}): any => ck.node(form, props, []);
  const studioOf = (ctx: any): Studio => {
    const s = ctx.services?.studio as Studio | undefined;
    if (!s) throw new Error('No studio service: start the app with studio.services()');
    return s;
  };
  const physicsOf = (ctx: any): RollPhysics | null => (ctx.services?.rollPhysics as RollPhysics | undefined) ?? null;
  // the log's committed recipe (plain objects; the store hands out read-only proxies of the same value)
  const recipeOf = (ctx: any) => (f: FrameId): FrameRecipe | undefined => studioOf(ctx).frames.get(f)?.log.committed ?? ctx.state.recipes?.[f];
  const writeRoll = (ctx: any, roll: Roll): void => ctx.rt.store.writeDoc([{ path: ['roll', 'rolls', roll.id], value: roll }], { tier: 'document' });
  const setView = (ctx: any, k: keyof RollView, v: unknown): void => ctx.rt.store.set(['rollView', k], v);
  const isHandEdited = (ctx: any) => (f: FrameId): boolean => handEdited(studioOf(ctx).frames.get(f)?.log.inEffect() ?? []);
  const hasRoll = { enabled: (s: any) => !!rollOf(s), why: 'Make a roll first (Roll ▸ New Roll from Open Frames)' };

  /** apply a batch: staleness first (E_STALE unless forced), then one shared tx and one global undo step */
  function applyBatch(ctx: any, b: MutationBatch, o: { force?: boolean } = {}): Diagnostic[] | true {
    const stale = staleOf(b, recipeOf(ctx));
    if (stale.length && !o.force) return staleDiagnostics(stale);
    const entries = plain(b.frames).map((f) => ({ frame: f.frame, mutations: o.force ? f.mutations.map((m): Mutation => (m.op === 'set' ? { op: 'set', path: m.path, value: m.value } : m)) : f.mutations }));
    studioOf(ctx).route.applyBatch(entries, b.label, { by: b.by, tx: b.id.startsWith(ROLL_TX) ? b.id : `${ROLL_TX}${b.id}`, detail: b.why });
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
      .map((e) => ({ id: e.id, sha256: e.sha, graph: e.graph, recipe: e.log.committed }));
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
      const next: Roll = { ...rollOf(ctx.state, roll.id)!, analysis, status: 'analysed' };
      if (top && !next.fragment['scan.stock']) next.fragment = { ...next.fragment, 'scan.stock': top };
      // the measured base and veil are recipe settings (contract 0.3), not pixel edits: scan.baseT and per-channel scan.flare
      const bs = analysis.base;
      if (bs.T) next.fragment = { ...next.fragment, 'scan.baseT': baseOfVeilFree(bs.T, bs.veil) };
      if (bs.veil) next.fragment = { ...next.fragment, 'scan.flare': flareOfVeil(bs.veil) };
      writeRoll(ctx, next);
      for (const d of analysis.diagnostics) ctx.rt.diagnostics.info(d.code, d.message, { runtime: true });
      if (o.firstPrint) firstPrint(ctx);
      return rollOf(ctx.state, roll.id);
    } catch (e) {
      setView(ctx, 'error', String((e as Error)?.message ?? e));
      throw e;
    } finally {
      setView(ctx, 'progress', null);
    }
  }

  /** the roll's own bookkeeping once its first print is in: a real enlarger for the roll, status first-printed */
  function firstPrinted(ctx: any, rollId: string): void {
    const cur = rollOf(ctx.state, rollId);
    if (cur) writeRoll(ctx, { ...cur, fragment: { ...cur.fragment, 'print.enlarger.mode': 'real' }, status: 'first-printed' });
  }
  /** the frames that have no first print yet (the automatic one on a new roll), or `only` */
  function planFirstPrint(ctx: any, only?: FrameId[]): MutationBatch | null {
    const roll = rollOf(ctx.state);
    if (!roll?.analysis) return null;
    const pending = only ?? roll.frames.filter((f) => !['roll', 'match'].includes(recipeOf(ctx)(f)?.print.lights.auto.method ?? ''));
    if (!pending.length) return null;
    return firstPrintBatch(roll, recipeOf(ctx), { rejected: rejectedOf(ctx.state), consistency: ctx.state.rollView?.consistency ?? ROLL_CONSISTENCY, only: pending });
  }
  /** the automatic first print of a new roll: applied at once, by 'auto', one undo step */
  function firstPrint(ctx: any, only?: FrameId[]): MutationBatch | null {
    const b = planFirstPrint(ctx, only);
    if (!b) return null;
    applyBatch(ctx, b, { force: true });
    firstPrinted(ctx, rollOf(ctx.state)!.id);
    return b;
  }
  /** frames of the roll that do not name it yet (FrameRecipe.roll): one 'auto' batch */
  function membersBatch(ctx: any, roll: Roll): MutationBatch {
    const frames = roll.frames.flatMap((f) => {
      const r = recipeOf(ctx)(f);
      return r && r.roll?.id !== roll.id ? [{ frame: f, mutations: [setWithExpect(r, 'roll', { id: roll.id })] }] : [];
    });
    return { id: `${ROLL_TX}members-${roll.id}`, kind: 'setup', by: 'auto', frames, skipped: [], label: 'Add to roll', why: `${frames.length} frame${frames.length === 1 ? '' : 's'} name roll ${roll.id}` };
  }

  function planMatch(ctx: any): MutationBatch | null {
    const roll = rollOf(ctx.state);
    const physics = physicsOf(ctx);
    if (!roll?.reference || !roll.analysis || !physics) return null;
    return matchBatch(roll, roll.reference, recipeOf(ctx), physics, { alpha: ctx.state.rollView?.alpha ?? 0.45, rejected: rejectedOf(ctx.state), handEdited: isHandEdited(ctx) });
  }
  function showPending(ctx: any, b: MutationBatch | null): void {
    // coalescing: a new plan replaces the pending one (moving the slider does not stack batches)
    ctx.rt.store.writeDoc([{ path: ['rollView', 'pending'], value: b }, { path: ['rollView', 'off'], value: [] }, { path: ['rollView', 'stale'], value: [] }], { tier: 'view' });
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
    methods: {
      rollScope(this: any, mode: 'frame' | 'roll' | 'ask' = 'ask') {
        return this.prop('rollScope', mode);
      },
    },
    props: { rollScope: { default: 'frame', doc: "'frame' | 'roll' | 'ask': this control edits the frame, or the whole roll (one batch)" } },
    doc: 'rollScope(): the control edits this frame or the roll (cb.kits.roll)',
  });

  // ── passes (guide §5.5) ──
  const checks = ck.pass('cb.roll.checks', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    const bars = ir.find('roll.balanceBar') as NodeData[];
    const sheets = [...(ir.find('roll.library') as NodeData[]), ...(ir.find('gridview') as NodeData[]).filter((n) => n.props['id'] === 'contact')];
    if (bars.length && !sheets.length)
      p.warn('CB-R002', 'cb.kits.roll.balanceBar() has no contact sheet or roll library to choose a reference from', { at: bars[0]!.at, fix: 'add cb.kits.roll.contactSheet() to the centre, or cb.kits.roll.library() to the left dock' });
    for (const n of ir.find('cb.arg') as NodeData[]) {
      const mode = n.props['rollScope'];
      if (!mode || mode === 'frame') continue;
      const path = String(n.props['path']);
      if (!(SHARED_PATHS as readonly string[]).includes(path))
        p.error('CB-R003', `cb.arg('${path}').rollScope('${mode}'): ${path} is not shared by the roll`, { at: n.at, facts: [`roll-shared paths: ${SHARED_PATHS.join(', ')}`], fix: `cb.arg('${path}') (frame scope), or a shared path such as cb.arg('scan.stock').rollScope('${mode}')` });
    }
  });
  /** CB-R001: roll forms in a variant that did not install the kit (installed on the ck instance) */
  const missing = ck.pass('cb.roll.installed', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    if (ir.kits.some((k: any) => k.name === 'cb.roll')) return;
    for (const f of FORMS) {
      const n = (ir.find(f.name) as NodeData[])[0];
      if (n) {
        p.error('CB-R001', `${f.name} is used, but the roll kit is not installed`, { at: n.at, fix: '.use(cb.kits.roll.kit) on the studio' });
        return;
      }
    }
  });
  ck.install(missing);

  // ── the kit ──
  const kit = ck.kit<typeof ROLL_STATE>('cb.roll', (k) => {
    k.version('1')
      .requires('cb.core')
      .state('roll', { init: ROLL_STATE.roll })
      .state('rollView', { init: ROLL_STATE.rollView, view: true })
      .forms(...FORMS)
      .fragments(rollScope)
      .passes(checks)
      .commands((c) => {
        c.add('roll.fromFrames', {
          label: 'New Roll from Open Frames',
          menu: 'Roll',
          enabled: (s: any) => (s.catalog?.order?.length ?? 0) > 0,
          why: 'Open the scans of a roll first',
          run: (ctx: any, o: { analyse?: boolean; label?: string } = {}) => {
            const sel: string[] = ctx.state.ui?.selection?.ids ?? [];
            const frames: string[] = sel.length > 1 ? sel : [...(ctx.state.catalog?.order ?? [])];
            const first = recipeOf(ctx)(frames[0]!);
            if (!first) return null;
            const n = Object.keys(ctx.state.roll?.rolls ?? {}).length + 1;
            const id = `roll-${n}`;
            const fragment = fragmentOf(first);
            const label = o.label ?? `${String(getPath(first, 'scan.stock') ?? 'Roll')} · ${frames.length} frames`;
            ctx.tx(`New roll "${label}"`, (t: any) => {
              t.$set(['roll', 'rolls', id], newRoll(id, label, frames, fragment));
              t.$set(['roll', 'order'], [...(t.roll.order ?? []), id]);
              t.$set(['roll', 'current'], id);
            });
            const join = (): string => {
              const m = membersBatch(ctx, rollOf(ctx.state, id)!);
              if (m.frames.length) applyBatch(ctx, m, { force: true });
              return id;
            };
            return o.analyse === false ? join() : analyse(ctx, { firstPrint: true }).then(join);
          },
        })
          .add('roll.select', {
            label: 'Select Roll',
            palette: false,
            // a selection, not an edit: no undo step
            run: (ctx: any, id: string) => {
              if (ctx.state.roll?.current !== id) ctx.rt.store.writeDoc([{ path: ['roll', 'current'], value: id }], { tier: 'document' });
            },
          })
          .add('roll.analyse', {
            label: 'Analyse Roll',
            menu: 'Roll',
            enabled: (s: any) => !!rollOf(s) && !s.rollView?.progress,
            why: 'Make a roll first, or wait for the running analysis',
            run: (ctx: any) => (physicsOf(ctx) ? analyse(ctx) : (ctx.toast('The host provides no roll physics (services.rollPhysics)', { kind: 'error' }), null)),
          })
          .add('roll.firstPrint', {
            label: 'First Print of the Roll',
            menu: 'Roll',
            enabled: (s: any) => !!rollOf(s)?.analysis,
            why: 'Analyse the roll first',
            // one card: the first print of the roll as a batch to approve or reject (the automatic one on a new roll is applied at once)
            run: (ctx: any, all = false) => {
              const b = planFirstPrint(ctx, all ? rollOf(ctx.state)!.frames : undefined);
              showPending(ctx, b);
              return b;
            },
          })
          .add('roll.setReference', {
            label: 'Set as Roll Reference',
            menu: 'Roll',
            enabled: (s: any) => !!rollOf(s) && !!s.ui?.selection?.primary && rollOf(s)!.frames.includes(s.ui.selection.primary),
            why: 'Select a frame of the roll',
            run: (ctx: any) => {
              const roll = rollOf(ctx.state)!;
              const f = ctx.state.ui.selection.primary as string;
              ctx.tx(`Reference: ${ctx.state.catalog?.frames?.[f]?.name ?? f}`, (t: any) => t.$set(['roll', 'rolls', roll.id, 'reference'], f));
            },
          })
          .add('roll.matchToReference', {
            label: 'Print the Roll Like the Reference',
            menu: 'Roll',
            enabled: (s: any) => !!rollOf(s)?.reference && !!rollOf(s)?.analysis,
            why: (s: any) => (!rollOf(s)?.analysis ? 'Analyse the roll first' : 'Choose a reference frame first'),
            run: (ctx: any) => {
              const b = planMatch(ctx);
              showPending(ctx, b);
              return b;
            },
          })
          .add('roll.alpha', {
            label: 'Roll Consistency',
            palette: false,
            run: (ctx: any, a: number) => {
              setView(ctx, 'alpha', Math.max(0, Math.min(1, Number(a))));
              if (ctx.state.rollView?.pending?.kind === 'match') showPending(ctx, planMatch(ctx));
            },
          })
          .add('roll.pending.toggle', {
            label: 'Include Frame',
            palette: false,
            run: (ctx: any, f: string) => {
              const off: string[] = ctx.state.rollView?.off ?? [];
              setView(ctx, 'off', off.includes(f) ? off.filter((x) => x !== f) : [...off, f]);
            },
          })
          .add('roll.pending.approve', {
            label: 'Approve Roll Batch',
            palette: false,
            enabled: (s: any) => !!s.rollView?.pending,
            why: 'Nothing pending',
            run: (ctx: any, force = false) => {
              // plain copies: the state hands out read-only proxies, which the logs (and their KV) cannot clone
              const b = plain(ctx.state.rollView?.pending as MutationBatch | null);
              if (!b) return null;
              const res = applyBatch(ctx, withoutFrames(b, plain(ctx.state.rollView.off ?? [])), { force: !!force });
              if (res !== true) {
                setView(ctx, 'stale', res.map((d) => ({ code: d.code, message: d.message })));
                return res;
              }
              const roll = rollOf(ctx.state);
              if (roll && b.kind === 'match') writeRoll(ctx, { ...roll, match: { alpha: Number(b.meta?.['alpha'] ?? 0), appliedAt: ctx.rt.clock?.now?.() ?? Date.now(), batch: b.id }, status: 'balanced' });
              if (roll && b.kind === 'clear-match') writeRoll(ctx, { ...roll, match: null, status: 'first-printed' });
              if (roll && b.kind === 'first-print') firstPrinted(ctx, roll.id);
              showPending(ctx, null);
              return true;
            },
          })
          .add('roll.pending.reject', { label: 'Reject Roll Batch', palette: false, run: (ctx: any) => showPending(ctx, null) })
          .add('roll.clearMatch', {
            label: 'Clear Roll Match',
            menu: 'Roll',
            enabled: (s: any) => !!rollOf(s)?.match,
            why: 'Nothing matched',
            run: (ctx: any) => {
              const roll = rollOf(ctx.state)!;
              const b = clearMatchBatch(roll, recipeOf(ctx), { consistency: ctx.state.rollView?.consistency ?? ROLL_CONSISTENCY, rejected: rejectedOf(ctx.state) });
              showPending(ctx, b);
              return b;
            },
          })
          .add('roll.setShared', {
            label: 'Set on the Roll',
            palette: false,
            ...hasRoll,
            run: (ctx: any, path: string, v: unknown) => {
              const roll = rollOf(ctx.state)!;
              const value = plain(v);
              // the roll's value and every frame's copy in one transaction: one undo step
              ctx.tx(`Roll: ${path}`, (t: any) => {
                t.$set(['roll', 'rolls', roll.id, 'fragment', path], value);
                for (const f of roll.frames) if (t.recipes?.[f]) t.$set(['recipes', f, ...path.split('.')], value);
              });
            },
          })
          .add('roll.applyToRoll', {
            label: 'Apply This Setting to the Roll',
            palette: false,
            ...hasRoll,
            run: (ctx: any, path: string) => {
              const f = ctx.state.ui?.selection?.primary;
              const r = f ? recipeOf(ctx)(f) : undefined;
              if (r) ctx.run('roll.setShared', path, getPath(r, path));
            },
          })
          .add('roll.contact.mode', {
            label: 'Contact Sheet: One Time and Pack',
            menu: 'Roll',
            checked: (s: any) => s.rollView?.contact?.mode === 'single',
            run: (ctx: any, mode?: 'balanced' | 'single') => setView(ctx, 'contact', { mode: mode ?? (ctx.state.rollView?.contact?.mode === 'single' ? 'balanced' : 'single') }),
          })
          .add('roll.cull.sweep', {
            label: 'Cull the Roll',
            menu: 'Roll',
            ...hasRoll,
            run: (ctx: any) => {
              const first = rollOf(ctx.state)!.frames[0];
              if (first) ctx.run('frame.select', first);
              ctx.set({ view: { mode: 'loupe' } });
            },
          })
          .add('roll.exportSheet', {
            label: 'Export Contact Sheet…',
            menu: 'Roll',
            ...hasRoll,
            run: (ctx: any) => ctx.toast('Contact sheet export (darkroom.contactSheet) comes with CHB-011', { kind: 'info' }),
          });
      })
      .docs(ROLL_DOCS);
  });

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
        ck.ui.segmented([{ value: 'balanced', label: 'Each frame balanced' }, { value: 'single', label: 'One time and pack' }], { bind: (s: any) => s.rollView.contact.mode, label: 'Contact sheet', small: true } as any),
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
    return ck.panel(pid ?? id, { title: t ?? title }, node(form, rest));
  };

  return {
    kit,
    state: ROLL_STATE,
    library: panel('roll.library', 'roll-library', 'Rolls'),
    setup: panel('roll.setup', 'roll-setup', 'Roll setup'),
    balanceBar: panel('roll.balanceBar', 'roll-balance', 'Print the roll like…'),
    inspector: panel('roll.inspector', 'roll-inspector', 'Roll analysis'),
    contactSheet,
    contactCell,
    /** the cull keys plus M (match) and R (reference); scope them to the module that shows the sheet */
    cullKeys: { ...cb.keys.cull, M: 'roll.matchToReference', R: 'roll.setReference' } as Record<string, any>,
    badge: rollBadge,
    tag: rollTag,
    of: rollOf,
    frames: rollFrames,
    /** CHB-021's "apply look to the roll": per-frame mutations as one batch */
    batch: (frames: readonly FrameId[], recipe: (f: FrameId) => FrameRecipe | undefined, build: (f: FrameId, r: FrameRecipe) => Mutation[] | { skip: string }, o: { id: string; label: string; why?: string }) => buildBatch(frames, recipe, build, o),
    applyBatch,
    /** exposure bookkeeping, for variants that show it */
    exposure: { totalOf, splitTotal },
  };
}

export type RollKit = ReturnType<typeof createRollKit>;

const caption = (f: CatalogFrame): string => `${f.flag === 'pick' ? '⚑ ' : f.flag === 'reject' ? '✕ ' : ''}${f.name}${f.stars ? ' ' + '★'.repeat(f.stars) : ''}`;
