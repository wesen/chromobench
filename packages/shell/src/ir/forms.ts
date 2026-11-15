// Form specs: the headless half of every built-in form (DR-3). A spec is the form's slots with their binding times,
// a doc string and a kind; renderers are registered by '@chromobench/shell/dom'. Slot tables are typed, so the
// constructors on Ck<S> check options in the editor; the `slots` pass checks them again at build for JS layouts.
//
// Port note: CraftKit's slider and number fields take `reset` as β but CraftKit Studio passes lambdas there; the
// port makes `reset` τ.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { slot, commonSlots, type SlotTable } from './slots.ts';
import type { NodeData } from './node.ts';

export interface FormSpec<Sl extends SlotTable = SlotTable> {
  name: string;
  slots: Sl;
  doc?: string;
  /** text, glyph, button, field, track, choice, container, place, collection, plane, canvas, … */
  kind?: string;
  /** options pass through unchecked */
  open?: boolean;
  /** extra words for explain */
  explain?: (n: NodeData) => string | null;
  /** DOM renderer (ignored headless; see '@chromobench/shell/dom') */
  render?: unknown;
  /** the kit that defined it */
  source?: string;
}

const { build: b, traced: t, bind, item, helper, handler: h } = slot;
type Node = NodeData;
type Ref = string | [string, ...unknown[]];

// ── basic ──
export const textSlots = { value: t<unknown>(), strong: b<boolean>(), dim: b<boolean>(), mono: b<boolean>(), rename: h(), size: b<string>(), wrap: b<boolean>() };
export const glyphSlots = { name: t<string>(), size: b<number>() };
export const statSlots = { value: t<unknown>(), mono: b<boolean>() };
export const kbdSlots = { chord: b<string>() };
export const buttonSlots = {
  run: h('a command id or (…, ctx) => …'),
  args: b<unknown[]>('arguments for a command run'),
  primary: b<boolean>(),
  icon: b<string>(),
  checked: t<boolean>(),
  quiet: b<boolean>(),
  small: b<boolean>(),
  menu: b<unknown[]>(),
  text: b<string>(),
};
export const numberSlots = {
  bind: bind<number>(),
  unit: t<string>(),
  accepts: b<string[]>(),
  expr: b<boolean>(),
  step: b<number | { arrow?: number }>(),
  min: b<number>(),
  max: b<number>(),
  scrub: b<boolean>(),
  commit: b<'end' | 'live'>(),
  decimals: b<number>(),
  mixed: b<string>(),
  reset: t<number>('double-click the label resets to this'),
  format: helper<(v: number) => string>(),
  suffix: b<string>(),
  compact: b<boolean>(),
  historyLabel: b<string>(),
  aside: b<Node>(),
};
export const textFieldSlots = {
  bind: bind<string>(),
  placeholder: b<string>(),
  multiline: b<boolean>(),
  commit: b<'end' | 'live'>(),
  search: b<boolean>(),
  onEnter: h(),
  historyLabel: b<string>(),
  set: h('(value, at, ctx) => …: write somewhere else than bind'),
};
export const sliderSlots = {
  bind: bind<number>(),
  min: b<number>(),
  max: b<number>(),
  step: b<number>(),
  decimals: b<number>(),
  track: b<string | { from: string; to: string; kind?: string }>(),
  bipolar: b<boolean>(),
  reset: t<number>('double-click the label or the knob resets to this'),
  commit: b<'end' | 'live'>(),
  scale: b<'linear' | 'log'>(),
  unit: b<string>(),
  format: helper<(v: number) => string>(),
  altPreview: b<string>(),
  historyLabel: b<string>(),
  labelWidth: b<number>(),
  compact: b<boolean>(),
  readout: t<string>(),
  aside: b<Node>(),
};
type Option = unknown;
export const segmentedSlots = { bind: bind<unknown>(), options: b<Option[]>(), icons: b<boolean>(), small: b<boolean>(), run: h(), set: h(), historyLabel: b<string>() };
export const selectSlots = { bind: bind<unknown>(), options: t<Option[]>(), historyLabel: b<string>(), run: h(), set: h(), compact: b<boolean>() };
export const checkboxSlots = { bind: bind<boolean>(), historyLabel: b<string>(), run: h(), set: h(), switch: b<boolean>() };
export const stepperSlots = { bind: bind<number>(), min: b<number>(), max: b<number>(), step: b<number>(), historyLabel: b<string>() };
export const colorSlots = { bind: bind<string>(), historyLabel: b<string>() };

// ── containers and places ──
const flex = { gap: b<number>(), align: b<string>(), justify: b<string>(), wrap: b<boolean>() };
export const rowSlots = flex;
export const columnSlots = { ...flex, pad: b<number>() };
export const gridSlots = { ...flex, cols: b<number | string>() };
export const cellSlots = { span: b<number>(), rows: b<number>() };
export const spacerSlots = { size: b<number>() };
export const dividerSlots = { vertical: b<boolean>() };
export const sectionSlots = { title: t<string>(), reset: b<boolean>(), collapsible: b<boolean>(), open: b<boolean>(), picker: b<unknown>(), aside: b<Node>() };
export const panelSlots = {
  title: t<string>(),
  switch: t<unknown>('s => s.path (a boolean) or { value: s => …, toggle: ctx => … }'),
  menu: t<unknown[]>(),
  reset: b<boolean>(),
  fixed: b<boolean>(),
  open: b<boolean>(),
  tools: b<unknown[]>(),
  minH: b<number>(),
  context: t<unknown[]>(),
  aside: b<Node>(),
  icon: b<string>(),
  scroll: b<boolean>(),
};
export const tabsSlots = { tabs: b<Record<string, Node>>(), bind: bind<string>(), small: b<boolean>() };
export const matchSlots = { on: t<unknown>(), cases: b<Record<string, Node | ((v: any) => Node)>>(), of: b<string[]>() };
export const whenSlots = { cond: t<boolean>(), then: b<Node | null>(), else: b<Node | null>() };
export const toolbarSlots = { items: b<(string | Node)[]>(), small: b<boolean>(), vertical: b<boolean>() };
export const statuslineSlots = { value: t<string>() };
export const hudSlots = { value: t<string>() };
export const htmlSlots = { make: helper<(m: any) => unknown>('escape hatch: (mountCtx) => Element') };
export const keysSlots = { chords: b<string | string[]>() };
export const dockcolSlots = { width: b<number>(), solo: b<boolean>(), min: b<number>(), max: b<number>() };
export const panelrefSlots = { open: b<boolean>() };
export const docktabsSlots = { panels: b<string[]>() };

// ── collections ──
export const collectionSlots = {
  items: t<unknown[]>(),
  row: item<(it: any, i: number) => Node>(),
  cell: item<(it: any, i: number) => Node>(),
  key: item<(it: any) => unknown>(),
  select: b<{ bind?: ((s: any) => unknown) | string; mode?: 'multi' | 'single' | 'none' }>(),
  activate: h(),
  keys: b<Record<string, unknown>>(),
  context: t<unknown[]>(),
  dnd: b<Record<string, unknown>>(),
  empty: t<string>(),
  size: t<number>(),
  rowHeight: b<number>(),
  advance: t<boolean>(),
  children: item<(it: any) => unknown[]>(),
  gap: b<number>(),
  aspect: b<number>(),
  onSelect: h(),
  focusOnMount: b<boolean>(),
  caption: b<boolean>(),
  counts: b<boolean>(),
  layout: b<'vertical' | 'horizontal'>(),
};

// ── planes ──
export const curveSlots = {
  bind: bind<unknown>(),
  channels: b<Record<string, string>>(),
  backdrop: t<unknown>(),
  parametric: b<Node>(),
  readout: b<boolean>(),
  size: b<number>(),
  regions: t<unknown>(),
  historyLabel: b<string>(),
  mode: bind<string>(),
};
export const wheelSlots = { bind: bind<{ hue: number; sat: number; lum?: number }>(), lum: b<boolean>(), readout: helper<(v: any) => string>(), reset: b<unknown>(), size: b<number>(), historyLabel: b<string>() };
export const histogramSlots = { data: t<unknown>(), clip: bind<unknown>(), regions: b<unknown[]>(), info: t<string>(), height: b<number>() };

// ── canvas ──
export const viewportSlots = {
  image: t<unknown>('a renderable the render bridge accepts'),
  label: t<string>(),
  before: t<unknown>(),
  arg: t<unknown>(),
  dims: t<[number, number] | null>('the source size, for 1:1 and proxies'),
  tools: b<string[]>(),
  overlays: b<unknown[]>(undefined, true),
  click: b<'toggle-1:1' | 'none'>(),
  drop: h(),
  lock: b<boolean>(),
  checker: b<boolean>(),
  compare: b<boolean>(),
  hud: b<Node>(),
  fit: b<'fit' | 'fill' | number>(),
  background: b<string>(),
  maxSide: b<number>(),
  proxy: b<number>(),
  onRender: h(),
  cursor: t<string>(),
  viewId: b<string>(),
  small: b<boolean>(),
  context: t<unknown[]>(),
};
export const thumbSlots = { src: t<string>(), image: t<unknown>('a renderable (θ cells: a lambda of the item)'), arg: t<unknown>(), engine: t<boolean>(), max: b<number>(), fit: b<'contain' | 'cover'>(), badge: t<string>() };

/** Every built-in form's slots, by name (for typing nodes and their setters). */
export interface FormSlotsMap {
  text: typeof textSlots;
  glyph: typeof glyphSlots;
  stat: typeof statSlots;
  kbd: typeof kbdSlots;
  button: typeof buttonSlots;
  number: typeof numberSlots;
  textField: typeof textFieldSlots;
  slider: typeof sliderSlots;
  segmented: typeof segmentedSlots;
  select: typeof selectSlots;
  checkbox: typeof checkboxSlots;
  stepper: typeof stepperSlots;
  color: typeof colorSlots;
  row: typeof rowSlots;
  column: typeof columnSlots;
  grid: typeof gridSlots;
  cell: typeof cellSlots;
  spacer: typeof spacerSlots;
  divider: typeof dividerSlots;
  scroll: Record<never, never>;
  bar: typeof rowSlots;
  section: typeof sectionSlots;
  panel: typeof panelSlots;
  tabs: typeof tabsSlots;
  match: typeof matchSlots;
  when: typeof whenSlots;
  toolbar: typeof toolbarSlots;
  statusline: typeof statuslineSlots;
  hud: typeof hudSlots;
  html: typeof htmlSlots;
  keys: typeof keysSlots;
  dockcol: typeof dockcolSlots;
  panelref: typeof panelrefSlots;
  docktabs: typeof docktabsSlots;
  listview: typeof collectionSlots;
  gridview: typeof collectionSlots;
  filmstrip: typeof collectionSlots;
  treeview: typeof collectionSlots;
  curve: typeof curveSlots;
  wheel: typeof wheelSlots;
  histogram: typeof histogramSlots;
  viewport: typeof viewportSlots;
  thumb: typeof thumbSlots;
}
export type BuiltinForm = keyof FormSlotsMap;

const spec = <Sl extends SlotTable>(name: string, slots: Sl, kind: string, doc: string, extra: Partial<Omit<FormSpec, 'slots'>> = {}): FormSpec => ({ name, slots, kind, doc, ...extra });

/** The built-in form specs (a fresh Map per Ck instance is made from this list). */
export function builtinForms(): FormSpec[] {
  return [
    spec('text', textSlots, 'text', 'Text: a value (τ), dim, strong, mono; rename: double-click edits it'),
    spec('glyph', glyphSlots, 'glyph', 'An icon by name'),
    spec('stat', statSlots, 'text', 'A labelled value'),
    spec('kbd', kbdSlots, 'text', 'A chord as the platform writes it'),
    spec('button', buttonSlots, 'button', 'A button; a command id brings its label, tip with key, and disabled-with-why'),
    spec('number', numberSlots, 'field', 'Number field: units and arithmetic (3p6, 12mm+3pt, *2, 50%), scrub the label, arrows nudge, reset'),
    spec('textField', textFieldSlots, 'field', 'Text field: commits to the path it was opened on'),
    spec('slider', sliderSlots, 'track', "Lightroom's slider: drag, click to jump, scrub or type the value, double-click to reset"),
    spec('segmented', segmentedSlots, 'choice', 'One of a few options, as buttons'),
    spec('select', selectSlots, 'choice', 'One of many options (τ)'),
    spec('checkbox', checkboxSlots, 'choice', 'A checkbox or a switch'),
    spec('stepper', stepperSlots, 'choice', 'A number with − and + buttons'),
    spec('color', colorSlots, 'choice', 'A colour well'),
    spec('row', rowSlots, 'container', 'Children side by side'),
    spec('column', columnSlots, 'container', 'Children stacked'),
    spec('grid', gridSlots, 'container', 'Children in a grid of cols'),
    spec('cell', cellSlots, 'container', 'A grid cell spanning columns'),
    spec('spacer', spacerSlots, 'container', 'Flexible (or fixed) space'),
    spec('divider', dividerSlots, 'container', 'A rule'),
    spec('scroll', {}, 'container', 'A scrolling column'),
    spec('bar', rowSlots, 'container', 'A bar of controls'),
    spec('section', sectionSlots, 'container', 'A titled group in a panel; double-click the title to reset what is inside'),
    spec('panel', panelSlots, 'place', 'A panel: header (switch, title, menu, disclosure) and body; collapse, solo, reset'),
    spec('tabs', tabsSlots, 'container', 'A tab strip and one body; the active tab is view state'),
    spec('match', matchSlots, 'container', 'Swap the layout on a τ value (CK-M201 when a case is missing)'),
    spec('when', whenSlots, 'container', 'Show a node while a τ condition holds'),
    spec('toolbar', toolbarSlots, 'container', "Command ids (icons and keys from the table), nodes, '-' separators, '~' spacers"),
    spec('statusline', statuslineSlots, 'text', 'A status line (τ)'),
    spec('hud', hudSlots, 'text', 'A heads-up text over the canvas'),
    spec('html', htmlSlots, 'escape', 'Escape hatch: (mountCtx) => Element', { open: false }),
    spec('keys', keysSlots, 'text', 'Chords as keycaps'),
    spec('dockcol', dockcolSlots, 'place', 'A dock column of panels: width, solo, min, max'),
    spec('panelref', panelrefSlots, 'place', 'A reference to a panel defined elsewhere'),
    spec('docktabs', docktabsSlots, 'place', 'A tab group of panels in a dock column'),
    spec('listview', collectionSlots, 'collection', 'Virtualised list; selection { ids, primary, anchor }'),
    spec('gridview', collectionSlots, 'collection', 'Virtualised grid of cells (θ)'),
    spec('filmstrip', collectionSlots, 'collection', 'Horizontal strip of cells (θ)'),
    spec('treeview', collectionSlots, 'collection', 'Tree with children (θ)'),
    spec('curve', curveSlots, 'plane', 'Tone curve: points {x,y}; click adds, drag off removes, double-click resets'),
    spec('wheel', wheelSlots, 'plane', 'Colour wheel { hue, sat, lum }'),
    spec('histogram', histogramSlots, 'plane', 'Histogram (τ {r,g,b,l}); drag inside to move a region'),
    spec('viewport', viewportSlots, 'canvas', 'The canvas: a τ renderable through the render bridge; zoom, pan, tools, overlays, compare'),
    spec('thumb', thumbSlots, 'canvas', 'A small picture: src at once, a renderable on the background lane'),
  ];
}

export { commonSlots };
export type { Ref };
