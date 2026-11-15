// The headless runtime (CraftKit's App, without the DOM): store (restored through persistence), history,
// scheduler on the given Clock, commands, the key router, a recording chrome, tools, modules, workspaces, the
// render queue and the context handed to every ρ handler. app.start(services) makes one; mount() in
// '@chromobench/shell/dom' starts one and builds the menu bar, dock, chrome layer and key listeners on top.
//
// Services are passed to start, never recorded: one program runs headless with fakes and in the browser with the
// real engine.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Store, TxRefused, type Layer, type RouteAdapter, type TxOpts } from '../core/store.ts';
import { History, type HistoryEntry } from '../core/history.ts';
import { Scheduler, Scope, Cell, type CellOpts } from '../core/cells.ts';
import { browserClock, type Clock } from '../core/clock.ts';
import type { Commands } from '../core/commands.ts';
import { KeyRouter, chordLabel, parseChord, type Keymap, type KeyTarget, type KeyEventLike } from '../core/keys.ts';
import { Diagnostics, where, type Diag } from '../core/diag.ts';
import { bindingPath } from '../core/track.ts';
import { deepMerge, OTHER, parsePath, type Platform } from '../core/util.ts';
import type { NodeData } from '../ir/node.ts';
import { isNode } from '../ir/node.ts';
import type { ModuleDef, ToolSpec } from '../build/types.ts';
import { explainApp } from '../build/explain.ts';
import { withDefaults } from '../build/checks.ts';
import type { BuiltApp } from './built-app.ts';
import { assemble, menuIndex } from './assemble.ts';
import { builtinCommands, GRAYS } from './builtins.ts';
import { DEFAULT_THEME, GRAY_IDS, resolveTheme } from '../themes/tokens.ts';
import { RecordingChrome, type ChromeApi, type DialogSpec, type ToastOpts } from './chrome.ts';
import { Workspace } from './workspace.ts';
import { startAutosave, type PersistenceAdapter, type Saved, type SaveKey } from './persist.ts';
import { RenderQueue } from './render/queue.ts';
import type { Presenter, RenderBridge } from './render/types.ts';

export interface Services {
  clock?: Clock;
  platform?: Platform;
  persistence?: PersistenceAdapter | null;
  /** route adapters by prefix: { recipes: editLogAdapter } */
  adapters?: Record<string, RouteAdapter>;
  bridges?: RenderBridge<any>[];
  presenter?: (canvas: unknown) => Presenter;
  chrome?: ChromeApi;
  /** anything else the program's handlers need (ctx.services.engine, …) */
  [k: string]: unknown;
}

/** What the viewport exposes (the DOM viewport implements it; headless runs have none). */
export interface ViewportApi {
  readonly id: string;
  readonly view: { zoom: 'fit' | 'fill' | number; cx: number; cy: number; [k: string]: unknown };
  setZoom(z: 'fit' | 'fill' | number, at?: [number, number]): void;
  zoomBy(dir: number, at?: [number, number]): void;
  fit(): void;
  redraw(): void;
  toScreen(u: number, v: number): [number, number];
  toImage(sx: number, sy: number): [number, number];
  scale(): number;
  natural(): [number, number];
  setCursor(css: string): void;
  [k: string]: unknown;
}

export type Draft<S> = S & {
  $set(path: string | (string | number)[], v: unknown): void;
  $update(path: string | (string | number)[], f: (v: any) => unknown): void;
  $merge(path: string | (string | number)[], o: object): void;
  $push(path: string | (string | number)[], ...items: unknown[]): void;
  $remove(path: string | (string | number)[], pred: (x: any, i: number) => boolean): void;
  $get(path?: string | (string | number)[]): any;
  readonly $value: any;
};

/** What every ρ handler receives (last for handlers, first for command runs). */
export interface Ctx<S = any> {
  readonly state: Readonly<S>;
  readonly rt: Runtime<S>;
  readonly services: Services;
  readonly mods: { shift: boolean; alt: boolean; mod: boolean };
  tx(label: string, f: (t: Draft<S>) => void, o?: TxOpts): unknown;
  set(obj: Record<string, unknown>, o?: TxOpts): void;
  preview(target: string | (string | number)[] | ((s: S) => unknown), value: unknown): void;
  commit(label: string, o?: TxOpts): unknown;
  cancel(): void;
  layer(name: string): Layer;
  run(id: string, ...a: unknown[]): unknown;
  emit(e: string, ...a: unknown[]): void;
  toast(text: string, o?: ToastOpts): void;
  flash(text: string, kind?: string): void;
  dialog(spec: DialogSpec): unknown;
  go(id: string): void;
  readonly history: History;
  viewport(id?: string): ViewportApi | null;
  /** the active tool's options (ui.toolOptions[tool]) */
  readonly options: Record<string, unknown>;
  vp?: ViewportApi;
  tool?: ToolSpec<S>;
  env?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Inspect {
  frames: number;
  lastFrameMs: number;
  chromeMs: number;
  slow: number;
  cellsRun: number;
  cellsRerun: number;
  subscribed: number;
  derived: number;
  version: number;
  previewing: boolean;
  layers: number;
  undo: number;
  redo: number;
  renders: number;
  presented: number;
  dropped: number;
  aborted: number;
  thumbs: number;
  commands: number;
  bindings: number;
  loops: number;
}

/** An error in words for the person at the screen; `detail` keeps the technical text (code and message). */
export interface Explained {
  text: string;
  title?: string;
  detail?: string;
}

const isEvent = (a: unknown): boolean => (typeof Event !== 'undefined' && a instanceof Event) || !!(a && typeof a === 'object' && 'key' in (a as object) && 'preventDefault' in (a as object));

export class Runtime<S = any> {
  readonly app: BuiltApp<S>;
  readonly services: Services;
  readonly clock: Clock;
  readonly platform: Platform;
  readonly store: Store;
  readonly history: History;
  readonly scheduler: Scheduler;
  readonly commands: Commands<S>;
  readonly keymap: Keymap;
  readonly keys: KeyRouter;
  readonly diagnostics: Diagnostics;
  readonly tools: Map<string, ToolSpec<S>>;
  readonly modules: Map<string, ModuleDef<S>>;
  readonly panels: Map<string, NodeData>;
  readonly workspace: Workspace;
  readonly renders: RenderQueue;
  readonly scope: Scope;
  chrome: ChromeApi;
  /**
   * Turns an error into words for the person at the screen (CHB-027 F7; explain() is the app's self-description):
   * a kit sets it (studio-kit maps E_ARG_RANGE on a recipe path to "Time must be between 0.1 s and 600 s"). Only
   * the toast changes: the diagnostics keep the original message, and the toast keeps it as its detail (tooltip).
   * null: the error's own message is shown.
   */
  explainError: ((err: unknown, o: { label?: string }) => Explained | null) | null = null;
  readonly viewports = new Map<string, ViewportApi>();
  readonly focus: { panel: string | null; canvas: string | null; dialog: boolean; text: boolean; button: boolean } = { panel: null, canvas: null, dialog: false, text: false, button: false };
  /** the spring held down (a tool id: 'hand', 'zoom', …) */
  spring: string | null = null;
  pointer: unknown = null;
  dragging: unknown = null;
  lastEvent: any = null;
  readonly restored: boolean;
  private listeners = new Map<string, Set<(...a: any[]) => void>>();
  private lambdaErrs = new Set<string>();
  private stops: (() => void)[] = [];
  private autosave: { stop(): void; flush(): Promise<void> } | null = null;

  constructor(app: BuiltApp<S>, services: Services = {}, restored: Saved | null = null) {
    this.app = app;
    this.services = services;
    this.clock = services.clock || browserClock();
    this.platform = services.platform || app.platform || OTHER;
    const ir = app.ir;
    this.diagnostics = new Diagnostics();
    for (const d of app.diagnostics.list) this.diagnostics.add(d);
    // state: restore what autosave kept, over the initial state
    let init = withDefaults(ir.init);
    if (restored) {
      init = deepMerge(deepMerge(init, restored.view || {}), restored.doc || {});
      if (ir.stateOpts.restore) {
        try {
          init = ir.stateOpts.restore(init);
        } catch (e) {
          this.diagnostics.warn('CK-T441', 'Restoring saved state failed; starting fresh', { runtime: true, facts: [String((e as Error)?.message ?? e)] });
          init = withDefaults(ir.init);
        }
      }
    }
    this.restored = !!restored;
    this.store = new Store(init, { view: ir.view, routes: ir.routes });
    this.history = new History(this.store, { clock: this.clock });
    this.scheduler = new Scheduler(this.store, this.clock);
    this.scheduler.onLoop = cells =>
      this.diagnostics.warn('CK-P510', 'Cells kept writing state for ten passes', {
        runtime: true,
        facts: cells.slice(0, 8).map(c => `${c.name || 'cell'} ${where(c.at)}`),
        fix: 'An effect writes what it (or another cell) reads; derive the value instead, or write it from a handler.',
      });
    this.scheduler.onError = e => this.handlerError(e, null);
    for (const d of ir.derived) this.store.derive(d.path, d.fn);
    for (const [prefix, adapter] of Object.entries(services.adapters || {})) this.stops.push(this.store.route(prefix, adapter));
    for (const r of ir.routes)
      if (!services.adapters?.[r.prefix] && !r.readonly)
        this.diagnostics.info('CK-T432', `No adapter for the route '${r.prefix}'`, { runtime: true, facts: ['Writes under it go to the store as plain state.'], fix: `app.start({ adapters: { ${r.prefix}: adapter } })` });
    this.stops.push(
      this.store.onRefused(e => this.refused(e)),
      this.history.on((kind, e) => {
        if (kind === 'skip')
          this.diagnostics.info('CK-T431', `Undo skipped a step that no longer applies`, { runtime: true, facts: [`${e.entry.label}: ${e.parts.map((p: any) => p.source).join(', ')}`] });
      }),
    );
    const asm = assemble(ir, builtinCommands(() => this, ir.themes.values()), this.platform, id => this.selectTool(id, true));
    this.commands = asm.commands;
    this.keymap = asm.keymap;
    this.keymap.bindings = this.keymap.bindings.filter(b => b.scope !== 'spring');
    this.tools = ir.tools;
    this.modules = new Map(ir.modules.map(m => [m.id, m]));
    this.panels = ir.panels;
    this.chrome = services.chrome || new RecordingChrome();
    this.workspace = new Workspace(this);
    this.renders = new RenderQueue(services.bridges || [], { idle: (f, k) => this.scheduler.idle(f, k), onError: e => this.handlerError(e, null) });
    this.scope = new Scope(null, 'app');
    // the first module, unless one was restored
    const mod = this.store.peek(['view', 'module']);
    if (!mod || !this.modules.has(mod)) this.store.writeDoc([{ path: ['view', 'module'], value: ir.modules[0]?.id ?? null }], { tier: 'view', init: true });
    this.keys = new KeyRouter(this.keymap, {
      moduleIds: () => [...this.modules.keys()],
      chain: () => this.scopeChain(),
      run: (target, e) => this.runTarget(target, e ? [e] : []),
      onSpring: (phase, sp, e, tap) => this.onSpring(phase, sp, e, tap),
      now: () => this.clock.now(),
      focusIsButton: () => this.focus.button,
    });
    for (const e of ir.events) this.on(e.event, (...a: unknown[]) => this.runTarget(e.f, a));
    if (services.persistence && ir.opts.persist !== false) {
      this.autosave = startAutosave(this, services.persistence, this.saveKey);
      this.stops.push(() => this.autosave?.stop());
    }
  }

  get saveKey(): SaveKey {
    return { app: this.app.ir.name, version: this.app.ir.stateOpts.version || 1 };
  }
  get state(): Readonly<S> {
    return this.store.readonly();
  }
  get module(): string {
    return this.store.peek(['view', 'module']);
  }

  // ── events ──
  on(ev: string, f: (...a: any[]) => void): () => void {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev)!.add(f);
    return () => this.listeners.get(ev)?.delete(f);
  }
  emit(ev: string, ...a: unknown[]): void {
    const s = this.listeners.get(ev);
    if (s)
      for (const f of [...s]) {
        try {
          f(...a);
        } catch (e) {
          this.handlerError(e, null);
        }
      }
  }

  // ── cells (for renderers and tests) ──
  cell<T>(fn: (s: any, arg?: any) => T, effect: ((v: T, prev: T | undefined) => void) | null, opts: CellOpts<T> & { scope?: Scope } = {}): Cell<T> {
    const c = new Cell<T>(this.store, fn, effect, { onError: (e, cc) => this.lambdaError(e, cc), ...opts });
    (opts.scope || this.scope).add(c);
    return c;
  }

  // ── the context handed to every ρ lambda ──
  txOptsNow(env?: Record<string, unknown>): TxOpts {
    const st = this.store.readonly();
    const f = (env && env['txOpts']) ?? this.modules.get(this.module)?.txOpts;
    if (!f) return {};
    try {
      return (typeof f === 'function' ? (f as (s: unknown) => TxOpts)(st) : (f as TxOpts)) || {};
    } catch (e) {
      this.lambdaError(e, { at: null, name: 'txOpts' });
      return {};
    }
  }
  ctx(extra: Partial<Ctx<S>> & Record<string, unknown> = {}): Ctx<S> {
    const rt = this;
    const st = this.store;
    const ev = this.lastEvent;
    const env = extra.env as Record<string, unknown> | undefined;
    const mac = this.platform.mac;
    const c: Ctx<S> = {
      rt,
      services: this.services,
      get state() {
        return st.readonly();
      },
      mods: { shift: !!ev?.shiftKey, alt: !!ev?.altKey, mod: !!(ev && (mac ? ev.metaKey : ev.ctrlKey)) },
      tx: (label, f, o) => st.tx(label, f as (t: any) => unknown, Object.assign({}, rt.txOptsNow(env), o || {})),
      set: (obj, o) => st.setMany(obj, o),
      preview: (target, value) => {
        const path = typeof target === 'function' ? bindingPath(st, target as (s: any) => unknown).path : parsePath(target as string);
        if (path) st.preview(path, value);
      },
      commit: (label, o) => st.commit(label, Object.assign({}, rt.txOptsNow(env), o || {})),
      cancel: () => st.cancel(),
      layer: name => st.layer(name),
      run: (id, ...a) => rt.runCommand(id, null, ...a),
      emit: (e, ...a) => rt.emit(e, ...a),
      toast: (t, o) => rt.chrome.toast(t, o),
      flash: (t, k) => rt.chrome.flash(rt.viewport(), t, k),
      dialog: spec => rt.chrome.dialog(spec),
      go: id => rt.go(id),
      history: this.history,
      viewport: id => rt.viewport(id),
      get options() {
        const t = st.peek(['ui', 'tool']);
        return t ? st.peek(['ui', 'toolOptions', t]) || {} : {};
      },
    };
    return Object.assign(c, extra);
  }
  /** a handler is a command id, a command with arguments, or a ρ lambda (…args, ctx) */
  runTarget(target: KeyTarget | null | undefined, args: unknown[] = [], env?: Record<string, unknown>): unknown {
    if (target == null) return undefined;
    const ev = args.filter(isEvent).pop();
    if (ev) this.lastEvent = ev;
    const sem = args.filter(a => !isEvent(a));
    if (typeof target === 'string') return this.runCommand(target, ev ?? null, ...sem);
    if (Array.isArray(target)) return this.runCommand(target[0], ev ?? null, ...target.slice(1), ...sem);
    if (typeof target === 'function') {
      const ctx = this.ctx(env ? { env } : {});
      try {
        return target(...sem, ctx);
      } catch (err) {
        this.handlerError(err, { at: (env?.['at'] as any) ?? null });
      }
    }
    return undefined;
  }
  runCommand(id: string, e: unknown, ...args: unknown[]): unknown {
    if (e) this.lastEvent = e;
    const ctx = this.ctx();
    try {
      return this.commands.run(id, ctx, ...args);
    } catch (err) {
      this.handlerError(err, this.commands.get(id) ?? null);
      return undefined;
    }
  }
  /** run a command by id (the headless entry point) */
  run(id: string, ...args: unknown[]): unknown {
    return this.runCommand(id, null, ...args);
  }
  handlerError(err: unknown, owner: { at?: any } | null): void {
    const e = err as { code?: string; message?: string };
    if (e && e.code === 'CK-T410') {
      this.diagnostics.error('CK-T410', 'Handler writes state outside a transaction', { at: owner?.at ?? null, runtime: true, facts: [String(e.message)], fix: "ctx.tx('Label', t => { … }) — one undo step with that name." });
      this.chrome.toast(String(e.message), { kind: 'error' });
      return;
    }
    if (err instanceof TxRefused) return this.refused(err);
    this.diagnostics.error('CK-L340', 'A handler threw', { at: owner?.at ?? null, runtime: true, facts: [String(e?.message ?? err)] });
    this.toastError(err, String(e?.message ?? err));
  }
  /** an error toast in the kit's words (explainError), with the technical text as its detail */
  toastError(err: unknown, raw: string, label?: string): void {
    let x: Explained | null = null;
    try {
      x = this.explainError ? this.explainError(err, label !== undefined ? { label } : {}) : null;
    } catch {
      x = null;
    }
    if (!x) return this.chrome.toast(raw, { kind: 'error', ...(label ? { title: label } : {}) });
    const title = x.title ?? label;
    this.chrome.toast(x.text, { kind: 'error', ms: 5000, ...(title ? { title } : {}), detail: x.detail ?? raw });
  }
  private refused(e: TxRefused): void {
    const cause = e.cause2 as { code?: string; message?: string; diagnostic?: Diag };
    this.diagnostics.warn('CK-T430', `A transaction was refused: ${e.label}`, {
      runtime: true,
      facts: [`${e.route}: ${cause?.message ?? String(cause)}`, ...(cause?.code ? [`code ${cause.code}`] : [])],
      fix: 'The document is unchanged; the preview was dropped.',
    });
    this.toastError(cause, cause?.message ?? String(cause), e.label);
    this.emit('refused', e);
  }
  lambdaError(err: unknown, cell: { at: any; name?: string }): void {
    const msg = String((err as Error)?.message ?? err);
    const k = (cell.at ? where(cell.at) : '') + msg;
    if (this.lambdaErrs.has(k)) return;
    this.lambdaErrs.add(k);
    this.diagnostics.warn('CK-L330', 'A traced lambda threw', { at: cell.at, runtime: true, facts: [msg], fix: 'Guard reads that can be empty: s.selection?.layer?.name ?? ""' });
  }

  // ── undo (toasts say where it happened) ──
  undo(): HistoryEntry | null {
    const e = this.history.undo();
    if (e) this.chrome.toast(`Undo ${e.label}${this.whereOf(e)}`, { kind: 'info', ms: 1400 });
    return e;
  }
  redo(): HistoryEntry | null {
    const e = this.history.redo();
    if (e) this.chrome.toast(`Redo ${e.label}${this.whereOf(e)}`, { kind: 'info', ms: 1400 });
    return e;
  }
  /** an undo on something other than what is on screen says where: .state(init, { channelName }) */
  whereOf(e: HistoryEntry | null): string {
    const so = this.app.ir.stateOpts;
    const ch = e?.channel;
    if (!ch || !so.channelName) return '';
    const st = this.store.readonly();
    const now = so.currentChannel ? so.currentChannel(st) : this.txOptsNow().channel;
    if (ch === now) return '';
    try {
      const n = so.channelName(ch, st);
      return n ? ` (on ${n})` : '';
    } catch {
      return '';
    }
  }

  // ── tools and springs ──
  selectTool(id: string | null, toggle = false): void {
    const cur = this.store.peek(['ui', 'tool']);
    const next = toggle && cur === id ? null : id;
    if (cur && cur !== next) {
      const t = this.tools.get(cur);
      if (t?.on?.exit) this.runTarget(t.on.exit, []);
    }
    this.store.set(['ui', 'tool'], next);
    if (next) {
      const t = this.tools.get(next);
      if (t?.on?.enter) this.runTarget(t.on.enter, []);
    }
  }
  /** the tool that answers the pointer now: a held spring, else the selected one */
  activeTool(allowed?: string[]): ToolSpec<S> | null {
    if (this.spring) return this.tools.get(this.spring) ?? null;
    const id = this.store.peek(['ui', 'tool']);
    if (!id || (allowed && !allowed.includes(id))) return null;
    return this.tools.get(id) ?? null;
  }
  private onSpring(phase: 'down' | 'up', sp: { tool: any; opts: any }, _e: KeyEventLike | null, tap?: boolean): void {
    // a spring is a tool held for as long as the key is down, or a pair of handlers { down, up }
    if (sp.tool && typeof sp.tool === 'object') {
      const f = phase === 'down' ? sp.tool.down : sp.tool.up;
      if (f) this.runTarget(f, []);
      if (phase === 'up' && tap && sp.opts.tap) this.runTarget(sp.opts.tap, []);
      return;
    }
    if (phase === 'down') {
      this.spring = sp.tool;
      this.emit('spring', sp.tool);
    } else {
      this.spring = null;
      this.emit('spring', null);
      if (tap && sp.opts.tap) this.runTarget(sp.opts.tap, []);
    }
  }
  viewport(id?: string): ViewportApi | null {
    if (id) return this.viewports.get(id) ?? null;
    if (this.focus.canvas && this.viewports.has(this.focus.canvas)) return this.viewports.get(this.focus.canvas)!;
    for (const v of this.viewports.values()) if ((v as any).visible !== false) return v;
    return null;
  }

  // ── modules ──
  go(id: string): void {
    if (!this.modules.has(id)) {
      this.chrome.toast(`No module '${id}'`, { kind: 'error' });
      return;
    }
    if (this.module === id) return;
    this.store.cancel();
    if (this.store.peek(['ui', 'tool'])) this.selectTool(null);
    this.store.set(['view', 'module'], id);
    const mod = this.modules.get(id)!;
    if (mod.onEnter) this.runTarget(mod.onEnter, []);
  }
  panelTitle(id: string): string {
    const p = this.panels.get(id);
    const t = p?.props['title'];
    return typeof t === 'string' ? t : id;
  }
  /** a panel reference resolves to its definition (its own props override) */
  resolvePanel(n: NodeData): NodeData {
    if (isNode(n) && n.$ === 'panelref') {
      const p = this.panels.get(String(n.props['id']));
      if (!p) return n;
      const extra = Object.keys(n.props).filter(k => k !== 'id');
      return extra.length ? ((p as any).with ? (p as any).with(Object.fromEntries(extra.map(k => [k, n.props[k]]))) : p) : p;
    }
    return n;
  }
  escape(): void {
    if (this.store.previewing) {
      this.store.cancel();
      return;
    }
    const mod = this.modules.get(this.module);
    if (mod?.onEscape && this.runTarget(mod.onEscape, []) !== false) return;
    const tool = this.store.peek(['ui', 'tool']);
    if (tool) {
      const t = this.tools.get(tool);
      if (t?.on?.escape) {
        this.runTarget(t.on.escape, []);
        return;
      }
      this.selectTool(null);
      return;
    }
    const g = this.store.peek(['workspace', 'hide']);
    if (g && (g.all || g.sides)) this.store.set(['workspace', 'hide'], {});
  }
  /** interface gray: auto (follows the system), or 1 (darkest) … 4 (lightest) */
  cycleGray(): void {
    const order: readonly string[] = GRAY_IDS;
    const cur = String(this.store.peek(['prefs', 'gray']) || 'auto');
    this.setGray(order[(order.indexOf(cur) + 1) % order.length]!);
  }
  /** set the interface gray ('auto', '1'…'4'); saved in prefs (view tier) */
  setGray(g: string): void {
    const next = (GRAY_IDS as readonly string[]).includes(String(g)) ? String(g) : 'auto';
    this.store.set(['prefs', 'gray'], next);
    this.chrome.toast(`Interface gray: ${next === 'auto' ? 'Auto (follows the system)' : GRAYS[next]}`, { kind: 'info' });
  }
  /** the theme shown: prefs.theme when it names a registered theme, else the program's, else CraftKit (CHB-025) */
  themeName(s: any = this.store.peek([])): string {
    const ir = this.app.ir;
    return (resolveTheme(ir.themes, s?.prefs?.theme) ?? resolveTheme(ir.themes, ir.theme) ?? resolveTheme(ir.themes, DEFAULT_THEME))?.name ?? DEFAULT_THEME;
  }
  /** show another registered theme; saved in prefs (view tier) */
  setTheme(name: string): void {
    const t = resolveTheme(this.app.ir.themes, name);
    if (!t) {
      this.chrome.toast(`No theme '${name}'`, { kind: 'error' });
      return;
    }
    this.store.set(['prefs', 'theme'], t.name);
  }

  // ── keys ──
  /** the scopes a menu's shortcut may come from: those that answer in this module without a focused field */
  liveScopes(): string[] {
    const tool = this.store.peek(['ui', 'tool']);
    return ['global', 'module:*', ...this.app.ir.kits.map(k => 'kit:' + k.name), 'module:' + this.module, 'canvas'].concat(tool ? ['tool:' + tool] : []);
  }
  /** the chain, innermost first: text · dialog · tool · panel · canvas · module · global (focus from the DOM half) */
  scopeChain(): string[] {
    const chain: string[] = [];
    if (this.focus.text) chain.push('text');
    if (this.focus.dialog) {
      chain.push('dialog');
      return chain;
    }
    const tool = this.store.peek(['ui', 'tool']);
    if (tool) chain.push('tool:' + tool);
    if (this.focus.panel) chain.push('panel:' + this.focus.panel);
    chain.push('canvas', 'module:' + this.module, 'global');
    return chain;
  }
  /** press a chord headless: 'Mod+Z', with the chain the DOM would compute (default: the current one) */
  press(chord: string, chain?: string[]): boolean {
    return this.keys.dispatch(parseChord(chord, this.platform), chain);
  }
  keyLabel(chord: string): string {
    return chordLabel(parseChord(chord, this.platform), this.platform);
  }

  // ── frames ──
  /** run queued frames now (feedback, chrome cells, render lane), until quiet */
  flush(max = 20): this {
    for (let i = 0; i < max && (this.scheduler.queued || this.store.pending.size); i++) this.scheduler.frame();
    return this;
  }
  /** flush, and wait for renders in flight, until nothing is left */
  async settle(rounds = 50): Promise<this> {
    for (let i = 0; i < rounds; i++) {
      this.flush();
      if (!this.renders.busy() && !this.scheduler.queued) {
        await Promise.resolve();
        if (!this.renders.busy() && !this.scheduler.queued && !this.store.pending.size) break;
      }
      await Promise.race([this.renders.idle(), new Promise(r => setTimeout(r, 0))]);
      if (this.scheduler.idleQ.length) this.scheduler.runIdle({ timeRemaining: () => 50, didTimeout: true });
    }
    return this;
  }
  /** save now (autosave would after 700 ms) */
  async save(): Promise<void> {
    await this.autosave?.flush();
  }

  inspect(): Inspect {
    const s = this.scheduler.stats;
    const q = this.renders.stats;
    return {
      frames: s.frames,
      lastFrameMs: s.lastFrameMs,
      chromeMs: s.chromeMs,
      slow: s.slow,
      cellsRun: s.cellsRun,
      cellsRerun: s.cellsRerun,
      subscribed: this.store.index.count,
      derived: this.store.derived.size,
      version: this.store.version,
      previewing: this.store.previewing,
      layers: this.store.layers.size,
      undo: this.history.entries.length,
      redo: this.history.redoStack.length,
      renders: q.renders,
      presented: q.presented,
      dropped: q.dropped,
      aborted: q.aborted,
      thumbs: this.renders.thumbs.size,
      commands: this.commands.map.size,
      bindings: this.keymap.bindings.length,
      loops: s.loops,
    };
  }

  /** the app as text; { live: true } evaluates τ props and command labels against the current state */
  explain(o: { live?: boolean; at?: boolean } = {}): string {
    const st = this.store.readonly();
    const menus = menuIndex(this.app.ir.menus);
    const rows = this.programCommands().map(c => {
      const status = this.commands.status(c.id, st);
      return {
        id: c.id,
        label: this.commands.label(c.id, st) + (o.live && !status.ok ? ` — disabled, why: ${status.why}` : ''),
        chord: this.keymap.chordsFor(c.id)[0],
        source: c.source as string | undefined,
        menu: menus.get(c.id),
      };
    });
    return explainApp(
      this.app.ir,
      { commands: this.commands.map.size, bindings: this.keymap.bindings.length, scopes: new Set(this.keymap.bindings.map(b => b.scope)).size, passes: this.app.passOrder.length, diagnostics: this.diagnostics, commandRows: rows, platform: this.platform },
      { ...(o.live ? { live: st } : {}), ...(o.at ? { at: true } : {}), store: this.store },
    );
  }
  /** commands the program and its kits define (not the built-ins) */
  programCommands(): ReturnType<Commands<S>['all']> {
    return this.commands.all().filter(c => !c.builtin && !c.id.startsWith('module.') && !c.id.startsWith('tool.'));
  }

  dispose(): void {
    for (const f of this.stops.splice(0)) f();
    this.scope.dispose();
    this.renders.dispose();
    this.chrome.dispose?.();
  }
}

export { RecordingChrome };
export type { Saved };
