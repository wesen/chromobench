// createCk(): the public namespace (port of CraftKit index.js). Every call to createCk() returns a fresh instance
// with its own forms, fragments, passes, themes and panel registry (DR-2: tests build several variants in one
// process and kits must not leak between them). `ck` (index.ts) is a default instance.
//
// Nouns: State · Value · Element · Habit · Command · Chord · Tool · Transaction · Place · Token · Kit · Pass
// Verbs: bind · derive · show · arrange · choose · act · map · handle · change · extend · check · explain

/* eslint-disable @typescript-eslint/no-explicit-any */
import { diag, libraryRoot, site, Diagnostics, type CallSite, type Diag, type DiagExtra } from '../core/diag.ts';
import { chordLabel, parseChord } from '../core/keys.ts';
import { OTHER, type Platform } from '../core/util.ts';
import { MIXED, monotone, parseValue, UNITS } from '../core/math.ts';
import { makeNode, isNode, isProps, type NodeData, type NodeHost } from '../ir/node.ts';
import { builtinForms, type FormSpec, type FormSlotsMap, type BuiltinForm } from '../ir/forms.ts';
import { commonSlots, slot, type PropOf, type PropsOf, type SlotTable, type Traced, type CommandRef } from '../ir/slots.ts';
import { ShellBuilder, type ShellDef } from './shell-builder.ts';
import { fragment, type FragmentTarget } from './fragments.ts';
import { kit, isKit, KitBuilder } from './kits.ts';
import { pass, runPasses, isPass } from './passes.ts';
import { explainNode, explainKit, explainPass, explainFragment, explainDiags } from './explain.ts';
import type { Fragment, FragmentSpec, IrSpec, Kit, PassCtx, PassDef, ShellOpts, Theme } from './types.ts';
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
  with(props: PropsFor<F, S> & Record<string, unknown>): FormNode<F, S>;
  tip(v: Traced<S, string>): FormNode<F, S>;
  disabled(v: Traced<S, boolean>, why?: Traced<S, string>): FormNode<F, S>;
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
  const panels = new Map<string, NodeData>();
  const fragments: Fragment[] = [];
  const passes: PassDef[] = [];
  const themes = new Map<string, Theme>([
    [craftkit.name, craftkit],
    [chromogen.name, chromogen],
  ]);
  const irs = new Map<string, IrSpec>();

  const host: NodeHost = {
    slotsOf(form) {
      const s = forms.get(form);
      return s ? ({ ...commonSlots, ...s.slots } as SlotTable) : null;
    },
    site: () => site(),
  };
  const node = <F extends string>(form: F, props: Record<string, unknown> = {}, kids: unknown = [], at: CallSite | null = site()): FormNode<F, S> => makeNode(host, form, props, kids, at) as FormNode<F, S>;
  const ctor = <F extends string>(form: F, f: (...a: any[]) => any): any => Object.assign(f, { form });
  /** (props?, ...kids) → node */
  const box = <F extends string>(form: F): FormCtor<F, S> =>
    ctor(form, (...args: unknown[]) => {
      const at = site();
      const props = isProps(args[0]) ? (args.shift() as Record<string, unknown>) : {};
      return node(form, props, args, at);
    });
  const withLabel = <F extends string>(form: F, extra: Record<string, unknown> = {}) =>
    ctor(form, (label: unknown, opts?: Record<string, unknown>) => {
      const at = site();
      if (isProps(label)) return node(form, { ...extra, ...label }, [], at);
      return node(form, { ...extra, label, ...(opts || {}) }, [], at);
    }) as ((label: Traced<S, string> | P<F, S>, opts?: P<F, S>) => FormNode<F, S>) & { form: F };
  const valued = <F extends string, V>(form: F, key: string) =>
    ctor(form, (value: V, opts?: Record<string, unknown>) => node(form, { [key]: value, ...(opts || {}) }, [], site())) as ((value: V, opts?: P<F, S>) => FormNode<F, S>) & { form: F };

  const ck = {
    platform,
    forms,
    panels,
    fragments,
    passes,
    themes,
    irs,
    MIXED,

    shell: (name: string, opts: ShellOpts = {}): ShellBuilder<S> => {
      const b = new ShellBuilder<S>(name, opts, (def: ShellDef, o: { platform?: Platform }) => buildApp<S>(def, b.self, ck, { platform: o.platform || platform }));
      return b.self;
    },

    // ── place: panels and containers ──
    /** ck.panel(id) references a panel; ck.panel(id, opts?, ...kids) defines one (placed where it stands) */
    panel(id: string, opts?: P<'panel', S> | Child, ...kids: Child[]): FormNode<'panel', S> {
      const at = site();
      if (opts === undefined && !kids.length) return node('panelref', { id }, [], at) as unknown as FormNode<'panel', S>;
      let props: Record<string, unknown> = {};
      if (isProps(opts)) props = opts as Record<string, unknown>;
      else kids.unshift(opts as Child);
      const n = node('panel', { id, ...props }, kids, at);
      panels.set(id, n);
      return n;
    },
    section(title: Traced<S, string>, opts?: P<'section', S> | Child, ...kids: Child[]): FormNode<'section', S> {
      const at = site();
      let props: Record<string, unknown> = {};
      if (isProps(opts)) props = opts as Record<string, unknown>;
      else if (opts !== undefined) kids.unshift(opts as Child);
      return node('section', { title, ...props }, kids, at);
    },
    row: box('row'),
    column: box('column'),
    stack: box('column'),
    bar: box('bar'),
    scroll: box('scroll'),
    grid: ctor('grid', (opts: P<'grid', S> | number, ...kids: Child[]) => node('grid', isProps(opts) ? (opts as Record<string, unknown>) : { cols: opts }, kids, site())) as ((opts: P<'grid', S> | number, ...kids: Child[]) => FormNode<'grid', S>) & { form: 'grid' },
    cell: box('cell'),
    spacer: (size?: number): FormNode<'spacer', S> => node('spacer', size ? { size } : {}, [], site()),
    divider: (opts?: P<'divider', S>): FormNode<'divider', S> => node('divider', opts || {}, [], site()),
    tabs: (tabs: Record<string, NodeData>, opts?: P<'tabs', S>): FormNode<'tabs', S> => node('tabs', { tabs, ...(opts || {}) }, [], site()),
    toolbar: (items: (string | NodeData)[], opts?: P<'toolbar', S>): FormNode<'toolbar', S> => node('toolbar', { items, ...(opts || {}) }, [], site()),
    statusline: (value: Traced<S, string>, opts?: P<'statusline', S>): FormNode<'statusline', S> => node('statusline', { value, ...(opts || {}) }, [], site()),
    hud: (opts: P<'hud', S>, value: Traced<S, string>): FormNode<'hud', S> => node('hud', { ...opts, value }, [], site()),
    dock: {
      column: ctor('dockcol', (props?: P<'dockcol', S> | Child, ...kids: Child[]) => {
        const at = site();
        if (!isProps(props)) {
          if (props !== undefined) kids.unshift(props as Child);
          props = {};
        }
        return node('dockcol', props as Record<string, unknown>, kids, at);
      }) as ((props?: P<'dockcol', S> | Child, ...kids: Child[]) => FormNode<'dockcol', S>) & { form: 'dockcol' },
      tabs: (ids: string[], opts?: P<'docktabs', S>): FormNode<'docktabs', S> => node('docktabs', { panels: ids, ...(opts || {}) }, [], site()),
    },

    // ── show: text, glyphs, numbers ──
    text: valued<'text', Traced<S, unknown>>('text', 'value'),
    label: valued<'text', Traced<S, unknown>>('text', 'value'),
    icon: valued<'glyph', Traced<S, string>>('glyph', 'name'),
    stat: valued<'stat', Traced<S, unknown>>('stat', 'value'),
    kbd: (chord: string): FormNode<'kbd', S> => node('kbd', { chord }, [], site()),
    keys: (chords: string | string[]): FormNode<'keys', S> => node('keys', { chords }, [], site()),
    html: (make: (m: any) => unknown, opts?: P<'html', S>): FormNode<'html', S> => node('html', { make, ...(opts || {}) }, [], site()),

    // ── choose: τ structure ──
    match: (on: (s: S) => unknown, cases: Record<string, NodeData | ((v: any) => NodeData)>, opts?: { of?: string[] }): FormNode<'match', S> => node('match', { on, cases, ...(opts || {}) }, [], site()),
    when(cond: ((s: S) => boolean) | boolean, a?: NodeData, b?: NodeData): any {
      if (typeof cond === 'function') return node('when', { cond, then: a ?? null, else: b ?? null }, [], site());
      return cond ? (a === undefined ? true : a) : b === undefined ? null : b;
    },
    each: <T>(list: readonly T[] | null | undefined, fn: (x: T, i: number) => Child): Child[] => (list || []).map((x, i) => fn(x, i)),
    pick: <V>(v: ((s: S) => string) | string, map: Record<string, V>): V | ((s: S) => V | undefined) => (typeof v === 'function' ? (s: S) => map[v(s)] : (map[v] as V)),
    eq: (a: unknown, b: unknown) => a === b,
    gt: (a: number, b: number) => a > b,
    lt: (a: number, b: number) => a < b,
    /** '3' → ['photo.rate', 3] */
    digits: (from: number, to: number, cmd: string): Record<string, CommandRef> => {
      const o: Record<string, CommandRef> = {};
      for (let d = from; d <= to; d++) o[String(d)] = [cmd, d];
      return o;
    },

    // ── widgets (forms + habits) ──
    ui: {
      slider: ctor('slider', (min: number, max: number, opts?: Record<string, unknown>) => node('slider', { min, max, ...(opts || {}) }, [], site())) as ((min: number, max: number, opts?: P<'slider', S>) => FormNode<'slider', S>) & { form: 'slider' },
      number: ctor('number', (opts?: Record<string, unknown>) => node('number', opts || {}, [], site())) as ((opts?: P<'number', S>) => FormNode<'number', S>) & { form: 'number' },
      textField: ctor('textField', (opts?: Record<string, unknown>) => node('textField', opts || {}, [], site())) as ((opts?: P<'textField', S>) => FormNode<'textField', S>) & { form: 'textField' },
      search: (opts?: P<'textField', S>): FormNode<'textField', S> => node('textField', { search: true, commit: 'live', ...(opts || {}) }, [], site()),
      segmented: ctor('segmented', (options: unknown[], opts?: Record<string, unknown>) => node('segmented', { options, ...(opts || {}) }, [], site())) as ((options: unknown[], opts?: P<'segmented', S>) => FormNode<'segmented', S>) & { form: 'segmented' },
      select: ctor('select', (options: unknown, opts?: Record<string, unknown>) => node('select', { options, ...(opts || {}) }, [], site())) as ((options: Traced<S, unknown[]>, opts?: P<'select', S>) => FormNode<'select', S>) & { form: 'select' },
      checkbox: withLabel('checkbox'),
      toggle: withLabel('checkbox', { switch: true }),
      stepper: ctor('stepper', (opts?: Record<string, unknown>) => node('stepper', opts || {}, [], site())) as ((opts?: P<'stepper', S>) => FormNode<'stepper', S>) & { form: 'stepper' },
      color: ctor('color', (opts?: Record<string, unknown>) => node('color', opts || {}, [], site())) as ((opts?: P<'color', S>) => FormNode<'color', S>) & { form: 'color' },
      button: ctor('button', (label: unknown, opts?: Record<string, unknown>) => {
        const at = site();
        if (isProps(label)) return node('button', label, [], at);
        return node('button', { label, ...(opts || {}) }, [], at);
      }) as ((label: Traced<S, string> | P<'button', S>, opts?: P<'button', S>) => FormNode<'button', S>) & { form: 'button' },
      /** a command's button: label, tip with its key and disabled-with-why come from the table */
      command: (id: string, opts?: P<'button', S>): FormNode<'button', S> => node('button', { run: id, ...(opts || {}) }, [], site()),
      iconButton: (iconName: string, opts?: P<'button', S>): FormNode<'button', S> => node('button', { icon: iconName, quiet: true, ...(opts || {}) }, [], site()),
      curve: ctor('curve', (opts?: Record<string, unknown>) => node('curve', opts || {}, [], site())) as ((opts?: P<'curve', S>) => FormNode<'curve', S>) & { form: 'curve' },
      wheel: ctor('wheel', (opts?: Record<string, unknown>) => node('wheel', opts || {}, [], site())) as ((opts?: P<'wheel', S>) => FormNode<'wheel', S>) & { form: 'wheel' },
    },
    view: {
      list: (items: Traced<S, unknown[]>, opts?: P<'listview', S>): FormNode<'listview', S> => node('listview', { items, ...(opts || {}) }, [], site()),
      grid: (items: Traced<S, unknown[]>, opts?: P<'gridview', S>): FormNode<'gridview', S> => node('gridview', { items, ...(opts || {}) }, [], site()),
      filmstrip: (items: Traced<S, unknown[]>, opts?: P<'filmstrip', S>): FormNode<'filmstrip', S> => node('filmstrip', { items, ...(opts || {}) }, [], site()),
      tree: (items: Traced<S, unknown[]>, opts?: P<'treeview', S>): FormNode<'treeview', S> => node('treeview', { items, ...(opts || {}) }, [], site()),
      histogram: (data: Traced<S, unknown>, opts?: P<'histogram', S>): FormNode<'histogram', S> => node('histogram', { data, ...(opts || {}) }, [], site()),
      thumb: (opts?: P<'thumb', S>): FormNode<'thumb', S> => node('thumb', opts || {}, [], site()),
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
    /** define a form (CraftKit's ck.define) and get its constructor */
    form<F extends string>(name: F, spec: Omit<FormSpec, 'name'>): FormCtor<F, S> & { spec: FormSpec } {
      const full: FormSpec = { ...spec, name };
      forms.set(name, full);
      const c = box(name) as FormCtor<F, S> & { spec: FormSpec };
      (c as any).spec = full;
      return c;
    },
    node,
    slot,
    fragment: (target: FragmentTarget, spec: FragmentSpec): Fragment => fragment(target, spec),
    /** an extensible kind a library declares for its own objects (frame handles): a fragment target */
    extensible: (kind: string): { extensible: string } => ({ extensible: kind }),
    kit: <St = unknown>(name: string, f: (k: KitBuilder<S & St>, opts?: any) => unknown): Kit<St> => kit<St>(name, f, undefined, site()),
    pass: <I = any>(name: string, o: { on?: string; after?: string | string[]; before?: string | string[]; options?: Record<string, unknown> } | string, run: (ir: I, p: PassCtx) => I | void): PassDef<I> => pass<I>(name, o, run),
    /** install fragments or passes on the instance (every shell built from it gets them) */
    install(...xs: (Fragment | PassDef | Theme)[]): void {
      for (const x of xs) {
        if ((x as Fragment).kind === 'fragment') fragments.push(x as Fragment);
        else if (isPass(x)) passes.push(x);
        else if ((x as Theme).light) themes.set((x as Theme).name, x as Theme);
      }
    },
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
      const r = runPasses(on, ir, [...passes, ...(o.passes || [])], { D, ...(o.options ? { options: o.options } : {}), explain: x => ck.explain(x, { ir: on }) });
      return { ir: r.ir, diagnostics: r.diagnostics, order: r.order };
    },
    theme: (t: Theme): Theme => {
      themes.set(t.name, t);
      return t;
    },

    // ── inspect ──
    explain(x: unknown, o: { at?: boolean; live?: boolean; ir?: string; state?: unknown } = {}): string {
      if (x instanceof BuiltApp) return x.explain(o);
      if (x instanceof Runtime) return x.explain(o);
      if (isNode(x)) return explainNode(x, { forms, panels, ...(o.at ? { at: true } : {}), ...(o.state !== undefined ? { live: o.state } : {}) });
      if (isKit(x)) return explainKit(x);
      if (isPass(x)) return explainPass(x);
      if (x && typeof x === 'object' && (x as Fragment).kind === 'fragment') return explainFragment(x as Fragment);
      if (x instanceof Diagnostics) return explainDiags(x.list, o);
      if (Array.isArray(x) && x.every(d => d && typeof d === 'object' && 'code' in d && 'message' in d)) return explainDiags(x as Diag[], o);
      if (Array.isArray(x) && x.every(isNode)) return x.map(n => explainNode(n, { forms, panels })).join('\n');
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
export type { Kit, Fragment, PassDef, Theme, NodeData };
