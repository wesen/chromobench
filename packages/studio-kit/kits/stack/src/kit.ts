// cb.kits.stack (CHB-035 design §33): one stack kit for every stage, built from the stage's law and the catalogue.
// Panels: the stack of a stage (rows, groups, drag into and out of groups, enable, amount with the law's unit hint,
// blend where the law allows it, the mask chip, the provenance chip), the selected entry's parameters (from its op's
// ArgSpecs, "Advanced" for arguments the catalogue marks advanced), the selected entry's mask (components, the one
// algebra, what it reads). The "+ Layer" menu lists `opsForStage(stage)`; mask tools draw components; every edit
// is a command and a transaction of the log. Headless: the renderers are in dom.ts.
//
//   const stack = cb.kits.stack;
//   stack.panels.layers('print')                          // the print stage's stack
//   stack.panels.layers('darkroom', { title: 'Enlarger', order: 'kind', row: (r) => r.op === 'expose' ? mainRow(r) : stack.row(r) })
//   stack.panels.layers('print', { filter: stack.sel.ops(['heal', 'clone', 'clarity']) })   // the finish view
//   stack.panels.params(); stack.panels.masks(); stack.menus.layer(); stack.maskTools
//   stack.panels.params({ editors: { ...stack.editors, myOp: stack.editor('my.form', ['a', 'b']) } })   // an op's editor
//
// Specialised views are the same kit with lambdas at the right times: `row` is θ (once per row), `filter` is θ
// (per entry), `order` and `density` are β.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { slot, type Ck, type FormSpec, type NodeData } from '@chromobench/shell';
import type { StageName } from '@chromobench/contract';
import type { Cb } from '../../../src/cb.ts';
import { sel } from '../../../src/sel.ts';
import { printingScript } from '../../../src/model/doc.ts';
import { formatSeconds } from '../../../src/model/units.ts';
import { stackCommands, maskTools, MASK_TOOLS } from './commands.ts';
import { stagePolicy, stagesShown } from './passes.ts';
import { selectedIn, STACK_STATE } from './state.ts';
import * as model from './model.ts';
import { editorOf, EDITOR_FORMS, type Editor, type Editors } from './editors.ts';

const { build: b, traced: t, item: i } = slot;
const spec = (name: string, slots: FormSpec['slots'], doc: string, explain?: (n: NodeData) => string | null): FormSpec => ({ name, slots, doc, kind: 'cb', ...(explain ? { explain } : {}) });

/** what explain adds to a stack view's props: its stage's law and what + Layer offers */
const layersWords = (n: NodeData): string => {
  const stage = n.props['stage'] as StageName;
  const law = model.lawOf(stage);
  const ops = model.addableOps(stage).filter((o) => !Array.isArray(n.props['add']) || (n.props['add'] as string[]).includes(o.name));
  return [law ? `${law.name} law` : 'no law', n.props['add'] === false ? '' : `+ Layer ${ops.length} ops`].filter(Boolean).join(' · ');
};

export const STACK_FORMS: FormSpec[] = [
  spec('stack.layers', {
    stage: b<StageName>('the stage whose stack this is (scan, scene, darkroom, print)'),
    order: b<'stack' | 'kind'>("'stack' (the document's order) or 'kind' (an order-free law: by kind)"),
    density: b<'compact' | 'comfortable'>(),
    row: i<(row: model.StackRow) => unknown>('θ: the node for a row (stack.row(r) is the standard one)'),
    filter: i<(p: unknown) => boolean>('θ: which entries show (a group shows when one of its children does)'),
    add: b<string[] | false>('the ops "+ Layer" offers (default: every op of the stage); false: no button'),
    empty: b<string>(),
    frame: t<string | null>('the frame (default: the selected one)'),
  }, "A stage's stack: one row per layer and group, drag to reorder or into a group, + Layer from the catalogue", layersWords),
  spec('stack.row', { entry: b<string>('the entry id'), stage: b<StageName>(), density: b<'compact' | 'comfortable'>() },
    'The one stack row: on/off, name, what it does, amount (the law\'s unit), blend where the law has one, mask chip, provenance chip'),
  spec('stack.params', {
    frame: t<string | null>(),
    editors: b<Editors | false>('editors by op ({ form, covers }): the op\'s editor, then generic controls for what it does not cover (default stack.editors)'),
  }, "The selected entry's controls: name, amount, blend, mask, provenance, its op's editor and its arguments from the catalogue"),
  ...editorSpecs(),
  spec('stack.masks', { frame: t<string | null>() }, "The selected entry's mask: components with add / subtract / intersect, feather, invert, what it reads"),
];

/** the built-in editors' forms (stack.curve, stack.levels, …): a layer's editor in the params panel */
function editorSpecs(): FormSpec[] {
  const words: Record<string, string> = {
    'stack.curve': 'Curve editor: channel L/R/G/B, points (click adds, drag moves, drag off removes), the curve core applies, the stage input\'s histogram behind it',
    'stack.levels': 'Levels editor: channel, the stage input\'s histogram, black, midtone and white handles',
    'stack.hsl': 'HSL editor: hue, saturation or lightness per band, band widths',
    'stack.grade': 'Colour grading: shadow, midtone and highlight wheels (hue around, strength out) with a lightness each',
    'stack.mixer': 'Channel mixer: a 3 × 3 grid (type, arrows, drag to scrub), row sums, monochrome from the grey row',
  };
  return Object.values(EDITOR_FORMS).map((e) => spec(e.form, { entry: b<string>('the layer id'), stage: b<StageName>(), frame: t<string | null>() }, words[e.form] ?? e.form));
}

const STACK_DOCS = `## cb.kits.stack
One layer system for every stage. Each stage's stack holds layers (an op of the catalogue with its parameters) and
groups; the stage's law says what an entry's amount, blend and order mean: in the darkroom (light) amount scales a
layer's time or density and the order is free; on the print and the scene (composite) layers apply from the top
down, amount is opacity and layers blend; on the scan (repair) heal and clone spots apply in order. Any entry can
use a mask from the document's library (add = max, subtract = a·(1 − b), intersect = a·b). Click a row to select
it (its parameters and its mask show in their panels); drag a row to reorder it or onto a group to move it in.
Every change is one step of the history (Mod+Z). The layer panel shows an editor for the digital tools: the curve
(click adds a point, drag moves it, drag it off to remove it), levels over the stage input's histogram, the HSL bands,
the colour grading wheels and the channel mixer. A colour range mask takes its colour from the picture: Sample, then
click the picture.`;

/** a stage's panel title */
const TITLES: Record<StageName, string> = { scan: 'Scan (on the negative)', scene: 'Scene (before the film)', film: 'Film', darkroom: 'Darkroom', print: 'Print (after the darkroom)' };

export interface LayersOptions {
  id?: string;
  title?: string;
  /** θ: the node of a row (default stack.row(r)) */
  row?: (r: model.StackRow) => unknown;
  order?: 'stack' | 'kind';
  /** θ: which entries show */
  filter?: (p: any) => boolean;
  density?: 'compact' | 'comfortable';
  /** the ops "+ Layer" offers, or false for none */
  add?: string[] | false;
  empty?: string;
  /** the panel starts closed */
  collapsed?: boolean;
  /** nodes after the rows (the darkroom's printing script) */
  footer?: unknown[];
}

export function createStackKit(ck: Ck, cb: Cb) {
  const node = (form: string, props: Record<string, unknown> = {}, kids: unknown[] = []): any => ck.node(form, props, kids);

  const kit = ck
    .kit('cb.stack')
    .version('1')
    .requires('cb.core')
    .state('stack', { init: STACK_STATE.stack, view: true })
    .forms(...STACK_FORMS)
    .passes(stagePolicy(ck))
    .commands(stackCommands())
    .tools(maskTools())
    .keys({ 'Mod+J': 'layer.duplicate', 'Mod+G': 'layer.group', 'Mod+Shift+G': 'layer.ungroup' })
    .docs(STACK_DOCS);

  // ── builder calls ──
  /** the stack of a stage without a panel frame (place it in a panel of your own) */
  const layersView = (stage: StageName, o: Omit<LayersOptions, 'id' | 'title' | 'collapsed' | 'footer'> = {}): any => node('stack.layers', { stage, ...o });
  /** a stage's stack as a panel */
  const layers = (stage: StageName, o: LayersOptions = {}): any => {
    const { id, title, collapsed, footer, ...rest } = o;
    return ck.panel.define(id ?? `layers-${stage}`, { title: title ?? TITLES[stage], ...(collapsed ? { open: false } : {}) }, layersView(stage, rest), ...((footer ?? []) as any[]));
  };
  /** the one row component (θ: inside a custom row lambda) */
  const row = (r: Pick<model.StackRow, 'id' | 'stage'>, o: { density?: 'compact' | 'comfortable' } = {}): any => node('stack.row', { entry: r.id, stage: r.stage, ...o });
  /** an editor for an op's layers: a form whose node gets `entry` and `stage`, and the arguments it covers */
  const editor = (form: string, covers: readonly string[]): Editor => editorOf(form, covers);
  /** the built-in editors: curve, levels, hsl, grade, mixer */
  const editors: Editors = EDITOR_FORMS;
  /**
   * The selected entry's panel. `editors` maps an op to its editor (default `stack.editors`; false: only the generic
   * controls): `stack.panels.params({ editors: { ...stack.editors, myOp: stack.editor('my.form', ['a', 'b']) } })`.
   */
  const params = (o: { id?: string; title?: string; editors?: Editors | false } = {}): any =>
    ck.panel.define(o.id ?? 'layer-params', { title: o.title ?? 'Layer' }, node('stack.params', { editors: o.editors ?? editors }));
  const masks = (o: { id?: string; title?: string } = {}): any => ck.panel.define(o.id ?? 'layer-masks', { title: o.title ?? 'Mask' }, node('stack.masks', {}));

  /** the "+ Layer" items of a stage: the catalogue's ops of the stage (`ops` narrows them) */
  const addItems = (stage: StageName, ops?: readonly string[]) => model.addMenu(stage, ops);

  // ── specialised views (design §33) ──
  /** the darkroom's Exposures panel: the darkroom stack and the printing script */
  const exposures = (o: Omit<LayersOptions, 'footer'> = {}): any =>
    layers('darkroom', {
      id: 'exposures', title: 'Exposures', ...o,
      footer: [ck.text((s: any) => { const d = sel.doc(s); return d ? printingScript(d, { seconds: formatSeconds }) : ''; }, { dim: true, wrap: true, class: 'cb-script' } as any)],
    });
  /**
   * The Enlarger: the main exposure's controls in its row and the printer lights' pad in theirs, every other
   * darkroom entry a standard row; ordered by kind (the light law is order-free).
   */
  const enlarger = (o: Omit<LayersOptions, 'row' | 'order'> = {}): any =>
    layers('darkroom', {
      id: 'enlarger', title: 'Enlarger', order: 'kind', ...o,
      row: (r: model.StackRow) =>
        r.op === 'expose'
          ? ck.column({ class: 'cb-stack-main' }, row(r), cb.arg('stages.darkroom.medium.mode'), cb.arg('main.params.time_s').testStrip({ step: '1/3 st' }), cb.arg('main.params.fstop'), cb.arg('main.params.filtration'))
          : r.id === 'lights'
            ? ck.column({ class: 'cb-stack-main' }, row(r), cb.arg('lights.params.logH').pad())
            : row(r),
    });
  /** the finish view: retouch and clarity on the print stack */
  const finish = (o: LayersOptions = {}): any => layers('print', { id: 'finish-layers', title: 'Retouch and clarity', filter: model.byOps(['heal', 'clone', 'clarity']), add: ['clarity'], ...o });

  // ── modules ──
  const viewer = (id: string, tools: string[] = [...MASK_TOOLS]) => cb.viewer((s: any) => sel.frame(s)?.print() ?? null, { id, compare: true, tools, hud: cb.hud.readout() });
  /** Edit (E): the print stage's stack, history left; the finished print with the mask tools; the layer and its mask right */
  const editModule = (o: { id?: string; key?: string } = {}) =>
    ck
      .module(o.id ?? 'edit', { label: 'Edit', key: o.key ?? 'Mod+Alt+E', stages: ['print'] })
      .left(ck.dock.column({ width: 260 }, layers('print', { id: 'layers-edit', title: 'Print layers' }), cb.panels.history({ id: 'history-edit' })))
      .center(viewer('edit'))
      .right(ck.dock.column({ width: 300 }, params({ id: 'layer-params-edit' }), masks({ id: 'layer-masks-edit' })))
      .bottom(ck.dock.column({ width: 124 }, cb.views.strip({ id: 'strip-edit' })));
  /** Scene: camera files' edits before the film (the scene stage), when the catalogue has scene ops */
  const sceneModule = (o: { id?: string; key?: string } = {}) =>
    ck
      .module(o.id ?? 'scene', { label: 'Scene', key: o.key ?? 'Mod+Alt+S', stages: ['scene'] })
      .center(viewer('scene'))
      .right(ck.dock.column({ width: 300 }, layers('scene', { id: 'layers-scene', empty: 'A negative scan has no scene stage: its edits start on the negative and in the darkroom.' }), params({ id: 'layer-params-scene' }), masks({ id: 'layer-masks-scene' })))
      .bottom(ck.dock.column({ width: 124 }, cb.views.strip({ id: 'strip-scene' })));

  return ck.product(kit, {
    panels: { layers, params, masks, exposures, enlarger, finish },
    views: { layers: layersView },
    modules: { edit: editModule, scene: sceneModule },
    menus: {
      /** Layer: add (per stage, from the catalogue), duplicate, delete, group, order, on/off, masks */
      layer: (stages: StageName[] = ['darkroom', 'print']) =>
        ck.menu('Layer', [
          ...stages.filter((s) => model.addableOps(s).length).map((s) => ({ label: `Add to ${TITLES[s].split(' (')[0]}`, items: addItems(s) })),
          '-', 'layer.duplicate', 'layer.delete', 'link.bake', '-', 'layer.group', 'layer.ungroup', 'layer.up', 'layer.down', 'layer.toggle', '-',
          { label: 'New Mask', items: model.componentKinds().map((k) => ({ label: model.KIND_WORDS[k] ?? k, run: ['mask.new', k] })) },
          'mask.detach',
        ] as any),
    },
    keys: {},
    sel: {
      /** a filter by op (θ): the finish view's `ops(['heal', 'clone', 'clarity'])` */
      ops: model.byOps,
      /** the selected entry's id on the current frame (or null) */
      selected: (s: any) => selectedIn(s),
    },
    lib: { ...model, addItems, stagesShown, STACK_STATE, MASK_TOOLS },
    /** the built-in editors of the params panel (curve, levels, hsl, grade, mixer), by op */
    editors,
    /** an editor of a form for an op's layers: `stack.editor('my.form', ['covered', 'args'])` */
    editor,
    /** the mask tools for a viewer's `tools` */
    maskTools: [...MASK_TOOLS],
    /** a stack row (θ) */
    row,
    /** whether a stage has ops to add (the Scene module is placed only then) */
    has: model.hasAddableOps,
  });
}

export type StackKit = ReturnType<typeof createStackKit>;
