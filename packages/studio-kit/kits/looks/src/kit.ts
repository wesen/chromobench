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
// CHB-037 P7: a look is a link. The library is the contract's registered look functions (pure, versioned: they return
// groups of ordinary layers — filters, preflash, density masks, burns in the darkroom; clarity on the print) and the
// photographer's presets (stored groups and masks). Applying one inserts its link entries on every target frame (one
// per stage it touches, one key, one Amount: the stage law's amount), or adjusts the frame's link of it; the compiler
// expands the link, so the look stays one removable, fadeable, bakeable unit. A user apply commits one batch of the
// values batch builder (`plan`: one transaction per frame with the batch id, one step of the log); an agent apply
// proposes such a batch, and the card here shows the pending entries of a batch as one approval with partial
// approval by frame, E_STALE, Apply anyway and Skip. A sync copies values (each frame on its own afterwards) or links
// one preset made from the source's layers (they stay together): the photographer chooses, the panel says which.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { toDiagnostic, type Diagnostic } from '@chromobench/contract';
import { slot, type Ck, type FormSpec, type NodeData } from '@chromobench/shell';
import type { Cb } from '../../../src/cb.ts';
import { defineLook, type ArgSpec, type LookDef } from '@chromobench/contract';
import { diffDocs, summary } from './engine/diff.ts';
import { lookItem, planLook, type LookItem } from './engine/looks.ts';
import { lookLines } from './engine/describe.ts';
import { along, ring } from './engine/sweep.ts';
import { LOOKS_STATE, looksView, agentBatches } from './state.ts';
import { createLooksModel } from './model.ts';
import { looksCommands } from './commands.ts';
import { createLooksPanels } from './panels.ts';

const LOOKS_DOCS = `## cb.kits.looks
Looks are links (CHB-037): registered look functions (pure, versioned, with ArgSpec parameters) and presets (stored
groups and masks) that a frame links. A look's link expands at compile into ordinary layers — light in the darkroom
(filters, preflash, density masks, burns), print layers on the print — and its Amount is the stage's own fade: time
and density in the darkroom (0–200 %), opacity on the print (up to 100 %). Apply to the selection commits one batch
(one undo step); to the roll or the library it is planned on one card first; re-applying adjusts the frame's link.
Bake turns a link into its plain layers. Sync copies values or links one shared preset. Agent applies
(cb.looks.apply) arrive as one card per batch with partial approval.`;

const UNITS: Record<string, ArgSpec['unit']> = { pt: 'point', point: 'point', st: 'stop', stop: 'stop', s: 's', K: 'K', CC: 'CC', D: 'D', none: 'none', fraction: 'fraction', '%': 'percent', mm: 'mm' };
/** A number parameter of a look: an ArgSpec (its control is generated from it). */
export function slider(min: number, max: number, o: { unit?: string; default?: number; step?: number; label?: string; doc?: string } = {}): ArgSpec {
  const unit = o.unit ? UNITS[o.unit] : undefined;
  return Object.freeze({ type: 'number' as const, ...(unit ? { unit } : {}), min, max, default: o.default ?? Math.min(max, Math.max(min, 0)), ui: { widget: 'slider' as const, ...(o.step !== undefined ? { step: o.step } : {}), ...(o.label ? { label: o.label } : {}) }, doc: o.doc ?? o.label ?? '' });
}
/** An enum parameter of a look. */
export function choice(values: string[], o: { default?: string; label?: string } = {}): ArgSpec {
  return Object.freeze({ type: 'enum' as const, values: [...values], default: o.default ?? values[0], ui: { widget: 'segmented' as const, ...(o.label ? { label: o.label } : {}) }, doc: o.label ?? '' });
}

export function createLooksKit(ck: Ck, cb: Cb) {
  const M = createLooksModel(cb);
  const { extra, looksOf, lookById, tile, caption, print, before, diffAgainst, syncGroupsOf } = M;

  // ── forms ──
  const { build: bt, traced: tr } = slot;
  const spec = (name: string, slots: FormSpec['slots'], doc: string): FormSpec => ({ name, slots: { model: tr<unknown>('the form’s model, computed by the kit'), ...slots }, doc, kind: 'cb' });
  const FORMS: FormSpec[] = [
    spec('looks.params', { look: tr<string | null>('the look whose parameters to show (default: the picked one)') }, 'Generated sliders of the picked look (ArgSpec: unit, range, step)'),
    spec('looks.amount', { range: bt<[number, number]>('[0, 200]'), showDiff: bt<boolean>(), apply: bt<boolean>() }, 'Amount 0–200 % and what the look does in darkroom units; Apply to selection / roll / library; the frame’s looks with one Amount each, Bake, Remove'),
    spec('looks.diff', { against: bt<string>("'before' · 'defaults' · 'snapshot' · 'reference' (default: the compare source)") }, 'What differs from the compare source, in darkroom units, by sync group'),
    spec('looks.card', {}, 'The planned apply (roll, library) and agent look batches: one card each, partial approval by frame, Apply anyway, Skip'),
    spec('looks.groups', {}, 'Sync groups a copy keeps; sync by copy (values) or by link (one shared preset)'),
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
    // Lightroom's Settings shortcuts: copy, paste, sync (CHB-037 P9: in every layout that installs the kit)
    .keys({ 'Mod+Shift+C': 'looks.copy', 'Mod+Shift+V': 'looks.paste', 'Mod+Shift+S': 'looks.sync' })
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
      /** Lightroom's Settings menu: copy, paste and sync a frame's settings (the everyday layouts' way to sync) */
      settings: () => ck.menu('Settings', ['looks.copy', 'looks.paste', 'looks.sync', 'looks.syncMode']),
      looks: () =>
        ck.menu('Looks', [
          'looks.apply', 'looks.applyToRoll', 'looks.applyToLibrary', '-', 'looks.survey.open', 'looks.preview', 'looks.setReference', 'looks.snapshot', '-',
          'looks.bake', 'looks.remove', '-', 'looks.copy', 'looks.paste', 'looks.sync', 'looks.syncMode', '-', 'looks.saveAsPreset', 'looks.saveLookAsPreset', '-', 'looks.virtualCopy', 'looks.match',
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
      // authoring: a look function (registered in the contract, so every compile site expands it) and its library item
      defineLook: (def: LookDef): LookItem => (defineLook(def), lookItem(def.name)),
      slider,
      choiceParam: choice,
      register: (l: LookItem) => (extra.set(l.id, l), l),
      item: lookItem,
      sweep: { ring, along },
      diffDocs,
      summary,
      planLook,
      lookLines,
      errors: (e: unknown): Diagnostic => toDiagnostic(e),
    },
    whenAbsent: missing,
  });
}

export type LooksKit = ReturnType<typeof createLooksKit>;
