// createCk(): the public namespace (port of CraftKit index.js). Every call to createCk() returns a fresh instance
// with its own vocabulary (the fragments and kits registered with ck.extend), so tests build several layouts in one
// process and kits never leak between them (DR-2). `ck` (index.ts) is a default instance. Everything a ck instance
// builds is an immutable value: nodes, modules, menus, kits and the shell (CHB-035 §30, §32).
//
// Nouns: State · Value · Element · Habit · Command · Chord · Tool · Transaction · Place · Token · Kit · Pass
// Verbs: bind · derive · show · arrange · choose · act · map · handle · change · extend · check · explain

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Modifier } from '@chromobench/values';
import { BuildError, diag, libraryRoot, site, Diagnostics, type CallSite, type Diag, type DiagExtra } from '../core/diag.ts';
import { chordLabel, parseChord } from '../core/keys.ts';
import { OTHER, type Platform } from '../core/util.ts';
import { MIXED, monotone, parseValue, UNITS } from '../core/math.ts';
import { isNode, isProps, nodeMods, NodeVocab, type NodeData } from '../ir/node.ts';
import { builtinForms, type FormSpec, type FormSlotsMap, type BuiltinForm } from '../ir/forms.ts';
import { commonSlots, slot, type PropOf, type PropsOf, type Traced, type CommandRef } from '../ir/slots.ts';
import { menu, moduleData, moduleKind, shellData, shellKind, type ModuleProps, type ModuleValue, type ShellValue } from './shell.ts';
import { fragment, type FragmentTarget } from './fragments.ts';
import { kit, isKit, product, type KitValue, type ProductParts } from './kits.ts';
import { pass, runPasses, isPass } from './passes.ts';
import { explainNode, explainKit, explainPass, explainFragment, explainDiags } from './explain.ts';
import type { Fragment, FragmentSpec, IrSpec, Kit, PassCtx, PassDef, ShellOpts, Theme } from './types.ts';
import type { ShellDef } from './shell.ts';
import { BuiltApp, buildApp } from '../app/built-app.ts';
import { Runtime } from '../app/runtime.ts';
import { craftkit } from '../themes/craftkit.ts';
import { chromogen } from '../themes/chromogen.ts';

// ── node types ─────────────────────────────────────────────────────────────
/** Kits add methods per form through module augmentation:
 *  declare module '@chromobench/shell' { interface FormMethods<S> { slider: { stepped(n: number): FormNode<'slider', S> } } } */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface FormMethods<S> {}

type Common = typeof commonSlots;
type SlotsFor<F extends string> = F extends BuiltinForm ? FormSlotsMap[F] & Common : Common;
export type PropsFor<F extends string, S> = PropsOf<SlotsFor<F>, S>;

export interface Chain<F extends string, S> {
  /** one prop, slot-checked at build */
  prop(key: string, value: unknown): FormNode<F, S>;
  /** append to a list slot (overlays, badges) */
  slot(key: string, ...items: unknown[]): FormNode<F, S>;
  /** a modifier, a function of the node, or a props patch */
  with(x: Modifier<NodeData> | ((n: FormNode<F, S>) => NodeData) | (PropsFor<F, S> & Record<string, unknown>)): FormNode<F, S>;
  tip(v: Traced<S, string>): FormNode<F, S>;
  enabled(v: Traced<S, boolean>, why?: Traced<S, string>): FormNode<F, S>;
  hidden(v: Traced<S, boolean>): FormNode<F, S>;
}
type Reserved = keyof NodeData | keyof Chain<string, unknown>;
type Setters<F extends string, S> = { [K in Exclude<keyof SlotsFor<F>, Reserved>]: (v: PropOf<SlotsFor<F>[K], S>) => FormNode<F, S> };
type Methods<F extends string, S> = F extends keyof FormMethods<S> ? FormMethods<S>[F] : unknown;
export type FormNode<F extends string = string, S = any> = NodeData<F> & Chain<F, S> & Setters<F, S> & Methods<F, S>;

export type Child = NodeData | string | number | null | undefined | false | Child[];
type P<F extends string, S> = PropsFor<F, S>;

export interface Overlay<S = any> {
  kind: string;
  read?: ((s: S) => unknown) | undefined;
  paint(g: any, vp: any, value: unknown, state: S): void;
}

export interface CkOptions {
  platform?: Platform;
}

/** A form constructor: (props?, ...kids) → node; carries .form for fragment targets. */
export interface FormCtor<F extends string, S> {
  (props?: P<F, S> & Record<string, unknown>, ...kids: Child[]): FormNode<F, S>;
  readonly form: F;
}

const svgIn = (g: any, tag: string, attrs: Record<string, unknown>): any => {
  const el = g.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  g.appendChild(el);
  return el;
};

export function createCk<S = any>(options: CkOptions = {}) {
  const platform = options.platform || OTHER;
  const forms = new Map<string, FormSpec>(builtinForms().map(f => [f.name, f]));
  const themes = new Map<string, Theme>([
    [craftkit.name, craftkit],
    [chromogen.name, chromogen],
  ]);
  const irs = new Map<string, IrSpec>();

  // ck.extend: fragments whose methods this instance's nodes answer (and which join every build), and kits whose
  // fragments and forms give the nodes methods and setters (the kit puts them into the builds that use it)
  const extensions: Fragment[] = [];
  const kitFragments: Fragment[] = [];
  const vocabForms = new Map<string, FormSpec>(forms);
  const vocab = new NodeVocab(() => vocabForms, () => [...extensions, ...kitFragments]);
  const builderFragments = (): Fragment[] => [...extensions, ...kitFragments];
  const shells = shellKind(builderFragments, (def: ShellDef, o: { platform?: Platform }) => buildApp<S>(def, ck, { platform: o.platform || platform }));
  const modules = moduleKind(builderFragments);
  const node = <F extends string>(form: F, props: Record<string, unknown> = {}, kids: unknown = [], at: CallSite | null = site()): FormNode<F, S> => vocab.node(form, props, kids, at) as FormNode<F, S>;
  const ctor = <F extends string>(form: F, f: (...a: any[]) => any): any => Object.assign(f, { form });
  /** (props?, ...kids) → node */
  const box = <F extends string>(form: F): FormCtor<F, S> =>
    ctor(form, (...args: unknown[]) => {
      const at = site();
      const props = isProps(args[0]) ? (args.shift() as Record<string, unknown>) : {};
      return node(form, props, args, at);
    });
  /** a leaf: (value, props?) → node, the value under `key` */
  const leaf = <F extends string, V>(form: F, key: string) =>
    ctor(form, (value: V, props?: Record<string, unknown>) => node(form, { [key]: value, ...(props || {}) }, [], site())) as ((value: V, props?: P<F, S>) => FormNode<F, S>) & { form: F };
  /** a control: (props) → node, one props object */
  const control = <F extends string>(form: F) => ctor(form, (props?: Record<string, unknown>) => node(form, props || {}, [], site())) as ((props?: P<F, S>) => FormNode<F, S>) & { form: F };

  const ck = {
    platform,
    forms,
    fragments: extensions,
    themes,
    irs,
    MIXED,

    // ── the program: a shell, its modules and menus; kits ──
    /** the shell: an immutable value; .use(kit), .module(m), .menus(...), .keys(map), .build() */
    shell: (name: string, opts: ShellOpts = {}): ShellValue<S> => shells.make(shellData(name, opts, site())) as ShellValue<S>,
    /** a module: ck.module('print', { label: 'Print', key: 'D' }).left(…).center(…).keys(…) */
    module: (id: string, props: ModuleProps<S> = {}): ModuleValue<S> => {
      const at = site();
      return modules.make(moduleData(id, props, at), at) as ModuleValue<S>;
    },
    /** a menu the shell places with .menus(…): command ids, '-' separators, submenus { label, items } */
    menu,
    /** a kit: ck.kit('ratings').version('1').state(…).commands({ id: spec }).tools({ id: spec }).keys(…) */
    kit: <St = unknown>(name: string): KitValue<St> => kit<St>(name, site()),
    /** what a kit offers a layout: { kit, panels, modules, menus, keys, tools, commands, docs } */
    product: <K extends KitValue<any>, P extends ProductParts>(k: K, parts: P) => product(k, parts),

    // ── place: panels and containers ──
    /** ck.panel(id) references a panel defined elsewhere in the program; ck.panel.define(id, props?, ...kids) defines one where it stands */
    panel: Object.assign((id: string): FormNode<'panelref', S> => node('panelref', { id }, [], site()), {
      define(id: string, props?: P<'panel', S> | Child, ...kids: Child[]): FormNode<'panel', S> {
        const at = site();
        let p: Record<string, unknown> = {};
        if (isProps(props)) p = props as Record<string, unknown>;
        else if (props !== undefined) kids.unshift(props as Child);
        return node('panel', { id, ...p }, kids, at);
      },
    }),
    // containers: (props?, ...children)
    section: box('section'),
    row: box('row'),
    column: box('column'),
    bar: box('bar'),
    scroll: box('scroll'),
    grid: box('grid'),
    cell: box('cell'),
    dock: {
      column: box('dockcol'),
      tabs: leaf<'docktabs', string[]>('docktabs', 'panels'),
    },
    // leaves: (value, props?)
    spacer: (size?: number, props?: P<'spacer', S>): FormNode<'spacer', S> => node('spacer', { ...(size ? { size } : {}), ...(props || {}) }, [], site()),
    divider: (props?: P<'divider', S>): FormNode<'divider', S> => node('divider', props || {}, [], site()),
    tabs: leaf<'tabs', Record<string, NodeData>>('tabs', 'tabs'),
    toolbar: leaf<'toolbar', (string | NodeData)[]>('toolbar', 'items'),
    statusline: leaf<'statusline', Traced<S, string>>('statusline', 'value'),
    hud: leaf<'hud', Traced<S, string>>('hud', 'value'),

    // ── show: text, glyphs, numbers ──
    text: leaf<'text', Traced<S, unknown>>('text', 'value'),
    icon: leaf<'glyph', Traced<S, string>>('glyph', 'name'),
    stat: leaf<'stat', Traced<S, unknown>>('stat', 'value'),
    kbd: leaf<'kbd', string>('kbd', 'chord'),
    keys: leaf<'keys', string | string[]>('keys', 'chords'),
    html: leaf<'html', (m: any) => unknown>('html', 'make'),

    // ── choose: τ structure ──
    match: (on: (s: S) => unknown, cases: Record<string, NodeData | ((v: any) => NodeData)>, props?: { of?: string[] }): FormNode<'match', S> => node('match', { on, cases, ...(props || {}) }, [], site()),
    /** an interaction node: a while cond(state) holds, else b (a build-time choice is plain JS, or .with(ck.mod.when(bool, m))) */
    when(cond: (s: S) => boolean, a?: NodeData, b?: NodeData): FormNode<'when', S> {
      const at = site();
      if (typeof cond !== 'function')
        throw new BuildError(diag('CK-L120', 'ck.when takes a lambda of state', { at, facts: [`got ${typeof cond}: ck.when is an interaction node, re-evaluated as the state changes`], fix: 'Choose at build time with plain JavaScript (cond ? a : b), or .with(ck.mod.when(cond, modifier)); ck.when(s => …, a, b) follows the state.' }));
      return node('when', { cond, then: a ?? null, else: b ?? null }, [], at);
    },
    each: <T>(list: readonly T[] | null | undefined, fn: (x: T, i: number) => Child): Child[] => (list || []).map((x, i) => fn(x, i)),
    /** a selector: s => map[key(s)] */
    pick: <V>(key: (s: S) => string, map: Record<string, V>): ((s: S) => V | undefined) => {
      if (typeof key !== 'function') throw new BuildError(diag('CK-L121', 'ck.pick takes a lambda of state', { at: site(), facts: [`got ${typeof key}`], fix: 'ck.pick(s => s.view.mode, { … }) is a selector; at build time index the map yourself: map[key].' }));
      return (s: S) => map[key(s)];
    },
    eq: (a: unknown, b: unknown) => a === b,
    gt: (a: number, b: number) => a > b,
    lt: (a: number, b: number) => a < b,
    /** '3' → ['photo.rate', 3] */
    digits: (from: number, to: number, cmd: string): Record<string, CommandRef> => {
      const o: Record<string, CommandRef> = {};
      for (let d = from; d <= to; d++) o[String(d)] = [cmd, d];
      return o;
    },

    // ── controls: one props object (forms + habits) ──
    ui: {
      slider: control('slider'),
      number: control('number'),
      textField: control('textField'),
      segmented: control('segmented'),
      select: control('select'),
      checkbox: control('checkbox'),
      stepper: control('stepper'),
      color: control('color'),
      /** a button; with run: 'command.id' its label, tip with its key and enabled-with-why come from the command */
      button: control('button'),
      curve: control('curve'),
      wheel: control('wheel'),
    },
    view: {
      list: (items: Traced<S, unknown[]>, opts?: P<'listview', S>): FormNode<'listview', S> => node('listview', { items, ...(opts || {}) }, [], site()),
      grid: (items: Traced<S, unknown[]>, opts?: P<'gridview', S>): FormNode<'gridview', S> => node('gridview', { items, ...(opts || {}) }, [], site()),
      filmstrip: (items: Traced<S, unknown[]>, opts?: P<'filmstrip', S>): FormNode<'filmstrip', S> => node('filmstrip', { items, ...(opts || {}) }, [], site()),
      tree: (items: Traced<S, unknown[]>, opts?: P<'treeview', S>): FormNode<'treeview', S> => node('treeview', { items, ...(opts || {}) }, [], site()),
      histogram: (data: Traced<S, unknown>, opts?: P<'histogram', S>): FormNode<'histogram', S> => node('histogram', { data, ...(opts || {}) }, [], site()),
      thumb: control('thumb'),
    },
    /** the canvas: a τ lambda returning a renderable the host's render bridge accepts */
    viewport: ctor('viewport', (image: unknown, opts?: Record<string, unknown>) => node('viewport', { image, ...(opts || {}) }, [], site())) as ((image: Traced<S, unknown>, opts?: P<'viewport', S>) => FormNode<'viewport', S>) & { form: 'viewport' },
    overlay: {
      /** rule of thirds / a grid over the shown image */
      grid: ({ when, divisions = 3 }: { when?: (s: S) => unknown; divisions?: number } = {}): Overlay<S> => ({
        kind: 'grid',
        read: when,
        paint(g, vp, on) {
          if (when && !on) return;
          const [x0, y0] = vp.toScreen(0, 0);
          const [x1, y1] = vp.toScreen(1, 1);
          for (let i = 1; i < divisions; i++) {
            const x = x0 + ((x1 - x0) * i) / divisions;
            const y = y0 + ((y1 - y0) * i) / divisions;
            svgIn(g, 'path', { d: `M${x} ${y0}V${y1}M${x0} ${y}H${x1}`, class: 'ck-ov-line' });
          }
        },
      }),
      custom: (kind: string, read: ((s: S) => unknown) | undefined, paint: Overlay<S>['paint']): Overlay<S> => ({ kind, read, paint }),
    },

    // ── extend ──
    /**
     * Register fragments (their methods on this instance's nodes and builders; their props, slots and checks in every
     * build) or kits (the methods and setters of their fragments and forms; the kit installs the rest where it is
     * used). Nodes made afterwards answer the new methods.
     */
    extend(...xs: (Fragment | Kit)[]): void {
      for (const x of xs) {
        if (isKit(x)) {
          kitFragments.push(...x.def.fragments.filter(f => !kitFragments.includes(f)));
          for (const f of x.def.forms) vocabForms.set(f.name, f);
        } else if (x && (x as Fragment).kind === 'fragment') {
          if (!extensions.includes(x as Fragment)) extensions.push(x as Fragment);
        } else throw new TypeError('ck.extend(…): fragments (ck.fragment) or kits (ck.kit)');
      }
      vocab.invalidate();
      shells.invalidate();
      modules.invalidate();
    },
    /** the node modifiers: n.tip(v) ≡ n.with(ck.mod.tip(v)); ck.mod.when(bool, m) is a build-time choice */
    mod: nodeMods,
    node,
    slot,
    fragment: (target: FragmentTarget, spec: FragmentSpec): Fragment => fragment(target, spec),
    /** an extensible kind a library declares for its own objects (frame handles): a fragment target */
    extensible: (kind: string): { extensible: string } => ({ extensible: kind }),
    pass: <I = any>(name: string, o: { on?: string; after?: string | string[]; before?: string | string[]; options?: Record<string, unknown> } | string, run: (ir: I, p: PassCtx) => I | void): PassDef<I> => pass<I>(name, o, run),
    ir: (name: string, spec: Omit<IrSpec, 'name'>): IrSpec => {
      const s = { ...spec, name };
      irs.set(name, s);
      return s;
    },
    /** run the passes of one IR kind (studio-kit's recipe, op-dag, mutation-batch) */
    run<I>(on: string, ir: I, o: { passes?: PassDef[]; options?: Record<string, unknown> } = {}): { ir: I; diagnostics: Diagnostics; order: string[] } {
      const spec = irs.get(on);
      const D = new Diagnostics();
      if (spec?.validate) for (const d of spec.validate(ir) || []) D.add(d);
      const r = runPasses(on, ir, o.passes || [], { D, ...(o.options ? { options: o.options } : {}), explain: x => ck.explain(x, { ir: on }) });
      return { ir: r.ir, diagnostics: r.diagnostics, order: r.order };
    },
    // ── inspect ──
    explain(x: unknown, o: { at?: boolean; live?: boolean; ir?: string; state?: unknown } = {}): string {
      if (x instanceof BuiltApp) return x.explain(o);
      if (x instanceof Runtime) return x.explain(o);
      if (isNode(x)) return explainNode(x, { forms: vocabForms, ...(o.at ? { at: true } : {}), ...(o.state !== undefined ? { live: o.state } : {}) });
      if (isKit(x)) return explainKit(x);
      if (isPass(x)) return explainPass(x);
      if (x && typeof x === 'object' && (x as Fragment).kind === 'fragment') return explainFragment(x as Fragment);
      if (x instanceof Diagnostics) return explainDiags(x.list, o);
      if (Array.isArray(x) && x.every(d => d && typeof d === 'object' && 'code' in d && 'message' in d)) return explainDiags(x as Diag[], o);
      if (Array.isArray(x) && x.every(isNode)) return x.map(n => explainNode(n, { forms: vocabForms })).join('\n');
      if (o.ir && irs.get(o.ir)?.explain) return irs.get(o.ir)!.explain!(x);
      try {
        return JSON.stringify(x, null, 1) ?? String(x);
      } catch {
        return String(x);
      }
    },
    diag: (code: string, message: string, extra?: DiagExtra): Diag => diag(code, message, extra),
    /** frames under this URL's directory are skipped when looking for the program's line */
    libraryRoot: (url: string): void => libraryRoot(url),
    site,
    /** a chord as this platform writes it: ck.keyLabel('Mod+Shift+C') → ⇧⌘C on a Mac, Ctrl+Shift+C elsewhere */
    keyLabel: (chord: string, p: Platform = platform): string => chordLabel(parseChord(chord, p), p),
    parseValue,
    UNITS,
    monotone,
    isNode,
  };
  return ck;
}

export type Ck<S = any> = ReturnType<typeof createCk<S>>;
export type { Kit, Fragment, PassDef, Theme, NodeData, KitValue, ModuleValue, ShellValue };
