// cb.kits.looks (CHB-021 guide §8): presets, parameterised looks, Amount, survey, diff and apply as builder calls on
// top of cb.core. Headless: state, commands, forms, passes and builder calls; the DOM renderers are
// kits/looks/src/dom.ts (LOOKS_RENDERERS, passed to mountStudio).
//
// Modules (CHB-032): state.ts (state shape, readers, agent batches), model.ts (registry, looked recipes, targets,
// plan and commit), commands.ts (the command table), panels.ts (builder calls); this file declares the kit.
//
//   const { looks } = cb.kits;
//   cb.studio('X').use(looks.kit).menus(...cb.menus.standard(), looks.menus.looks()).module(looks.modules.print())
//   ck.module('p').left(looks.panels.library()).center(cb.viewer(looks.sel.print, { compare: { before: looks.sel.before } }))
//     .right(ck.dock.column({}, looks.panels.params(), looks.panels.amount(), looks.panels.diff(), looks.panels.card()))
//
// A look resolves, per frame, to plain `set` mutations on document paths (re-run concretely when a parameter or the
// Amount moves). A user apply commits one batch of the values batch builder (`plan`: one transaction per frame with
// the batch id, one step of the log); an agent apply proposes such a batch, and the card here shows the pending
// entries of a batch as one approval with partial approval by frame, E_STALE, Apply anyway and Skip.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { toDiagnostic, type Diagnostic } from '@chromobench/contract';
import { slot, type Ck, type FormSpec, type NodeData } from '@chromobench/shell';
import type { Cb } from '../../../src/cb.ts';
import { diffDocs, summary } from './engine/diff.ts';
import { add, bake, choice, fromPreset, look, mul, pt, set, slider, type Look } from './engine/look.ts';
import { planLook } from './engine/plan.ts';
import { axis, ring } from './engine/sweep.ts';
import { looksProvider } from './engine/provider.ts';
import { LOOKS_STATE, looksView, agentBatches } from './state.ts';
import { createLooksModel } from './model.ts';
import { looksCommands } from './commands.ts';
import { createLooksPanels } from './panels.ts';

const LOOKS_DOCS = `## cb.kits.looks
Presets (data: path entries set / add / mul) and looks (a JS function with ArgSpec-shaped parameters) resolve per
frame to plain \`set\` mutations; Amount (0–200 %) scales them by a rule chosen from each path's unit — stops for
times and f-numbers, mired for colour temperature, a threshold for enums and stock ids, linear otherwise. Diffs are
in darkroom units. Apply to the selection commits one batch (one undo step); to the roll or the library it is
planned on one card first. Agent applies (cb.looks.apply) arrive as one card per batch with partial approval.`;

export function createLooksKit(ck: Ck, cb: Cb) {
  const M = createLooksModel(cb);
  const { extra, looksOf, lookById, tile, caption, print, before, diffAgainst, syncGroupsOf } = M;

  // ── forms ──
  const { build: bt, traced: tr } = slot;
  const spec = (name: string, slots: FormSpec['slots'], doc: string): FormSpec => ({ name, slots: { model: tr<unknown>('the form’s model, computed by the kit'), ...slots }, doc, kind: 'cb' });
  const FORMS: FormSpec[] = [
    spec('looks.params', { look: tr<string | null>('the look whose parameters to show (default: the picked one)') }, 'Generated sliders of the picked look (ArgSpec: unit, range, step)'),
    spec('looks.amount', { range: bt<[number, number]>('[0, 200]'), showDiff: bt<boolean>(), apply: bt<boolean>() }, 'Amount 0–200 % and the result in darkroom units; Apply to selection / roll / library'),
    spec('looks.diff', { against: bt<string>("'before' · 'defaults' · 'snapshot' · 'reference' (default: the compare source)") }, 'What differs from the compare source, in darkroom units, by sync group'),
    spec('looks.card', {}, 'The planned apply (roll, library) and agent look batches: one card each, partial approval by frame, Apply anyway, Skip'),
    spec('looks.groups', {}, 'Sync groups an apply, copy or paste keeps'),
    spec('looks.presets', {}, 'The library presets: export, delete, needs review; save the current frame as a preset'),
    spec('looks.compare', {}, 'The compare source: before, defaults, a snapshot, the reference frame'),
  ];

  // ── passes ──
  /** CB-L001: looks forms in a layout that did not install the kit (cb.core's pass cb.kits runs it) */
  const missing = (ir: any, p: any): void => {
    if (ir.kits.some((k: any) => k.name === 'cb.looks')) return;
    for (const f of FORMS) {
      const n = (ir.find(f.name) as NodeData[])[0];
      if (n) {
        p.error('CB-L001', `${f.name} is used, but the looks kit is not installed`, { at: n.at, fix: '.use(cb.kits.looks.kit) on the studio' });
        return;
      }
    }
  };
  /** CB-L002: unknown look ids in a choice */
  const checks = ck.pass('cb.looks.checks', { on: 'ui', after: 'slots' }, (ir: any, p) => {
    for (const n of ir.find('button') as NodeData[]) {
      const run = n.props['run'];
      if (!Array.isArray(run) || !String(run[0]).startsWith('looks.') || typeof run[1] !== 'string') continue;
      if (!['looks.pick', 'looks.apply'].includes(String(run[0]))) continue;
      const id = run[1] as string;
      if (!lookById({}, id)) {
        const ids = looksOf({}).map((l) => l.id);
        p.error('CB-L002', `${String(run[0])}: no look '${id}'`, { at: n.at, facts: [`looks: ${ids.join(', ')}`] });
      }
    }
  });

  // ── the kit ──
  const kit = ck
    .kit('cb.looks')
    .version('1')
    .requires('cb.core')
    .state('looks', { init: LOOKS_STATE.looks })
    .state('looksView', { init: LOOKS_STATE.looksView, view: true })
    .forms(...FORMS)
    .passes(checks)
    .commands(looksCommands(cb, M))
    .docs(LOOKS_DOCS);

  const P = createLooksPanels(ck, cb, M);
  const { panel, paramsModel, amountModel, diffModel, compareModel, cardModel, groupsModel, presetsModel, lookCell, library, survey, choiceRow } = P;

  const panels = {
    /** the looks library with print thumbnails */
    library,
    params: panel('looks.params', 'looks-params', 'Look', paramsModel),
    amount: panel('looks.amount', 'looks-amount', 'Amount', amountModel),
    diff: panel('looks.diff', 'looks-diff', 'What changed', diffModel),
    card: panel('looks.card', 'looks-card', 'Look batches', cardModel),
    groups: panel('looks.groups', 'looks-groups', 'Sync groups', groupsModel),
    presets: panel('looks.presets', 'looks-presets', 'Presets', presetsModel),
    compare: panel('looks.compare', 'looks-compare', 'Compare with', compareModel),
  };
  const keys = { looks: { N: 'looks.survey.open', 'Mod+Enter': 'looks.apply', 'Mod+Alt+N': 'looks.snapshot' } as Record<string, any> };
  /** the Print module built around the looks (CHB-021 guide §8.2): the looks library left; the print (the picked look
   *  previewed, compared with a chosen source) or the survey (N) in the centre; parameters, Amount, diff, batches right */
  const printModule = (o: { id?: string } = {}) =>
    ck
      .module(o.id ?? 'print', { label: 'Print', key: 'D' })
      .left(ck.dock.column({ width: 300 }, library({ size: 96 }), cb.panels.snapshots(), cb.panels.history()))
      .center(
        ck.match(
          (st: any) => st.looksView.mode,
          {
            print: cb.viewer(print, { id: 'main', views: true, compare: { before }, tools: ['probe', 'test-strip', 'ring-around'], hud: cb.hud.readout() }),
            survey: survey({ size: 200 }),
          },
          { of: ['print', 'survey'] },
        ),
      )
      .right(
        ck.dock.column(
          { width: 320 },
          panels.params(),
          panels.amount(),
          panels.diff(),
          panels.compare(),
          panels.card(),
          cb.panels.approvals(),
          ck.panel.define('enlarger', { title: 'Enlarger' }, cb.ifFrame(cb.arg('main.params.time_s'), (cb.arg('lights.params.logH') as any).pad(), cb.arg('stages.darkroom.medium.grade'), cb.arg('stages.darkroom.medium.paper'))),
          panels.groups(),
          panels.presets(),
        ),
      )
      .bottom(ck.dock.column({ width: 124 }, cb.views.strip({ id: 'strip-print' })))
      .keys({ ...cb.keys.views, ...cb.keys.darkroom, ...keys.looks });

  return ck.product(kit, {
    panels,
    views: { survey, cell: lookCell, choice: choiceRow },
    modules: { print: printModule },
    menus: {
      looks: () =>
        ck.menu('Looks', [
          'looks.apply', 'looks.applyToRoll', 'looks.applyToLibrary', '-', 'looks.survey.open', 'looks.preview', 'looks.setReference', 'looks.snapshot', '-',
          'looks.copy', 'looks.paste', 'looks.sync', '-', 'looks.saveAsPreset', 'looks.bake', '-', 'looks.virtualCopy', 'looks.match',
        ]),
    },
    keys,
    sel: {
      /** the main viewer's image: the frame's print with the picked look previewed */
      print,
      /** the viewer's compare image: the compare source (before, defaults, snapshot, reference frame, a look) */
      before,
      looks: looksOf,
      byId: lookById,
      view: looksView,
      diffOf: diffAgainst,
      syncGroups: syncGroupsOf,
      batches: agentBatches,
    },
    lib: {
      state: LOOKS_STATE,
      tile,
      caption,
      // authoring
      look,
      slider,
      choiceParam: choice,
      set,
      add,
      mul,
      pt,
      fromPreset,
      bake,
      register: (l: Look) => (extra.set(l.id, l), l),
      sweep: { ring, axis },
      diffDocs,
      summary,
      planLook,
      /** the DSL's LooksProvider (cb.looks.* for the agent), over the same registry */
      provider: (getState: () => any) => looksProvider(() => looksOf(getState())),
      errors: (e: unknown): Diagnostic => toDiagnostic(e),
    },
    whenAbsent: missing,
  });
}

export type LooksKit = ReturnType<typeof createLooksKit>;
