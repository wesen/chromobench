// The recorded program: the data of the builder values (shell, modules, kits, menus) and the `ui` IR the build makes
// from them and the passes check. Plain data plus lambdas.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CallSite, Diag } from '../core/diag.ts';
import type { CommandSpec } from '../core/commands.ts';
import type { KeyTarget, Spring } from '../core/keys.ts';
import type { RouteDecl, TxOpts } from '../core/store.ts';
import type { NodeData } from '../ir/node.ts';
import type { FormSpec } from '../ir/forms.ts';
import type { Slot, Time } from '../ir/slots.ts';

export type Region = 'top' | 'left' | 'center' | 'right' | 'bottom' | 'toolbar';

export interface StateOpts<S = any> {
  /** view-tier prefixes (default ui, view, prefs, workspace); the rest is the undoable document tier */
  view?: string[];
  version?: number;
  /** filter the document tier before it is saved */
  persist?: (doc: any) => any;
  /** fix up restored state */
  restore?: (st: any) => any;
  /** view.* keys that are not saved */
  transient?: string[];
  /** ui.* keys that are saved */
  keepUi?: string[];
  /** "Undo Contrast (on Old pier)" */
  channelName?: (channel: string, s: S) => string | null | undefined;
  currentChannel?: (s: S) => string | null | undefined;
}

export interface ShellOpts {
  plate?: string;
  statusbar?: boolean;
  persist?: boolean;
}

export interface CommandDef {
  id: string;
  spec: CommandSpec;
  at: CallSite | null;
  source?: string | undefined;
}
export type MenuItem = string | '-' | { label: unknown; items?: MenuItem[]; group?: string; run?: KeyTarget; [k: string]: unknown } | ((s: any, arg?: unknown) => MenuItem[]);
export interface MenuDef {
  label: string;
  items: MenuItem[];
  at: CallSite | null;
  source?: string | undefined;
}
export interface KeyDef {
  scope: string;
  map: Record<string, KeyTarget>;
  at: CallSite | null;
  source?: string | undefined;
}
export interface SpringDef {
  chord: string;
  tool: Spring['tool'];
  opts: Spring['opts'];
  at: CallSite | null;
}

/** A tool event: CraftKit's u, v (0–1 across the shown image) plus document pixels x, y. */
export interface ToolEvent {
  u: number;
  v: number;
  /** document pixels */
  x: number;
  y: number;
  /** image pixels of the shown render (CraftKit's ix, iy) */
  ix: number;
  iy: number;
  /** screen (CSS px, relative to the viewport) */
  sx: number;
  sy: number;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  pressure: number;
  pen: boolean;
  button: number;
  inside: boolean;
  detail?: number;
  raw?: unknown;
}

export interface ToolSpec<S = any> {
  id: string;
  label?: string;
  icon?: string;
  key?: string;
  cursor?: string | ((s: S, vp: any) => string);
  enabled?: boolean | ((s: S) => boolean);
  why?: string | ((s: S) => string);
  /** the modules whose menus, palette and keys offer it (default: the modules whose viewports list the tool) */
  module?: string | string[];
  on?: {
    enter?: KeyTarget;
    exit?: KeyTarget;
    escape?: KeyTarget;
    hover?: (e: ToolEvent, ctx: any, g: any) => any;
    leave?: (ctx: any) => void;
    down?: (e: ToolEvent, ctx: any) => any;
    drag?: (e: ToolEvent, ctx: any, g: any) => any;
    up?: (e: ToolEvent, ctx: any, g: any) => void;
    cancel?: (ctx: any, g: any) => void;
  };
  overlay?: (g: any, vp: any, s: S, gestureState: any) => void;
  /** while active, replace what the viewport shows: (renderable, state) => renderable */
  image?: (renderable: unknown, s: S) => unknown;
  /** while active, replace the viewport by this node (a ring-around grid) */
  content?: NodeData;
  select?: boolean;
  doc?: string;
  at?: CallSite | null;
  source?: string | undefined;
}

export interface ModuleDef<S = any> {
  id: string;
  label: string;
  key: string | null;
  icon: string | null;
  regions: Partial<Record<Region, NodeData | null>>;
  /** the module's keys (scope module:<id>) */
  keys: KeyDef[];
  at: CallSite | null;
  txOpts?: ((s: S) => TxOpts) | TxOpts;
  onEnter?: KeyTarget;
  onEscape?: KeyTarget;
  source?: string | undefined;
}

export interface Theme {
  name: string;
  /** the name View ▸ Theme shows (default: the name, capitalised) */
  label?: string;
  /** token → CSS value (app, panel, line, text, text2, accent, sel, track, knob, canvas, cell, menu, ok, warn, err, font, fontSize, radius, rule…) */
  light: Record<string, string>;
  dark?: Record<string, string>;
  /** interface greys (prefs.gray 1–4): token overrides */
  grays?: Record<string, Record<string, string>>;
  doc?: string;
}

export interface IrSpec {
  name: string;
  explain?: (ir: any) => string;
  validate?: (ir: any) => Diag[] | void;
}

// ── fragments ──
export interface FragmentSpec {
  name?: string;
  /** only some nodes */
  when?: (node: NodeData) => boolean;
  /** chain methods as modifier factories: each returns a modifier, a function of the receiver, or a props patch */
  methods?: Record<string, (...a: any[]) => unknown>;
  /** new props, checked like the form's own */
  props?: Record<string, { default?: unknown; doc?: string; time?: Time }>;
  /** new slots; an array declares or extends a list slot */
  slots?: Record<string, Slot<unknown, Time> | unknown[]>;
  /** DOM half only: wrap the form's renderer */
  render?: (next: any) => any;
  check?: (node: NodeData, p: any) => void;
  explain?: (node: NodeData) => string | null;
  doc?: string;
}
export interface Fragment {
  readonly kind: 'fragment';
  /** a form name, 'shell', 'module', or 'ext:<kind>' */
  readonly target: string;
  readonly spec: FragmentSpec;
  readonly at: CallSite | null;
  source?: string | undefined;
}

// ── passes ──
export interface PassCtx {
  /** report; level defaults to error (pass { level: 'warning' | 'info' }) */
  diag(code: string, message: string, extra?: Partial<Diag>): Diag;
  error(code: string, message: string, extra?: Partial<Diag>): Diag;
  warn(code: string, message: string, extra?: Partial<Diag>): Diag;
  info(code: string, message: string, extra?: Partial<Diag>): Diag;
  readonly options: Readonly<Record<string, unknown>>;
  /** shared between passes of one run */
  readonly facts: Map<string, unknown>;
  explain(x: unknown): string;
  /** the pass being run */
  readonly pass: string;
  [k: string]: unknown;
}
export interface PassDef<I = any> {
  readonly kind: 'pass';
  readonly name: string;
  readonly on: string;
  readonly after: string[];
  readonly before: string[];
  run(ir: I, p: PassCtx): I | void;
  readonly at: CallSite | null;
  source?: string | undefined;
  options?: Record<string, unknown>;
}

// ── kits ──
export interface KitState {
  key: string;
  init: unknown;
  /** view-tier sub-paths of the slice (relative), or true for the whole slice */
  view?: string[] | boolean;
  at: CallSite | null;
}
/** A kit's data: what it declares. Its keys bind in scope kit:<name> (every module). */
export interface KitDef {
  name: string;
  version?: string;
  requires: (string | Kit)[];
  state: KitState[];
  derived: { path: string; fn: (s: any) => unknown; at: CallSite | null }[];
  routes: RouteDecl[];
  forms: FormSpec[];
  fragments: Fragment[];
  commands: CommandDef[];
  keys: KeyDef[];
  springs: SpringDef[];
  tools: ToolSpec[];
  passes: PassDef[];
  irs: IrSpec[];
  themes: Theme[];
  icons: Record<string, string>;
  docs: string[];
}
/** What a kit value has besides its chain methods (kits.ts). */
export interface Kit<St = unknown> {
  readonly kind: 'kit';
  readonly name: string;
  /** the kit's data (its declarations) */
  readonly def: KitDef;
  readonly data: KitDef;
  readonly at: CallSite | null;
  /** phantom: the state slice the kit adds */
  readonly _state?: St;
}

/** The ui IR: the recorded program. */
export interface UiIR<S = any> {
  name: string;
  opts: ShellOpts;
  at: CallSite | null;
  init: any;
  stateOpts: StateOpts<S>;
  /** view-tier prefixes (default + kit slices) */
  view: string[];
  derived: { path: string; fn: (s: any) => unknown; at: CallSite | null }[];
  commands: CommandDef[];
  menus: MenuDef[];
  keys: KeyDef[];
  springs: SpringDef[];
  tools: Map<string, ToolSpec<S>>;
  panels: Map<string, NodeData>;
  modules: ModuleDef<S>[];
  contexts: Map<string, unknown>;
  events: { event: string; f: KeyTarget; at: CallSite | null }[];
  palette: { keys: string };
  routes: RouteDecl[];
  kits: { name: string; version: string | undefined; requires: string[]; at: CallSite | null; docs: string[] }[];
  fragments: Fragment[];
  forms: Map<string, FormSpec>;
  passes: PassDef[];
  irs: Map<string, IrSpec>;
  theme: string | null;
  themes: Map<string, Theme>;
  icons: Record<string, string>;
  docs: { source: string; md: string }[];
  /** every node tree (panels and module regions) */
  trees(): { where: string; node: NodeData; module?: string }[];
  /** every node of a form */
  find(form: string): NodeData[];
  hasCommand(id: string): boolean;
}
