// Mounting (the DOM half of CraftKit ui/node.js and App.mount): MountCtx turns τ props into cells and ρ props
// into handlers; Binding writes previews plus one commit during a gesture; mount() starts a runtime and builds the
// menu bar, module picker, dock, chrome layer, key listeners and focus tracking around it.
//
// Renderers are registered per form name by the forms modules; kits may give their forms a `render` and fragments
// may wrap a renderer (`render: next => (n, m) => …`). A form with a spec but no renderer is reported at mount.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Scope, type Cell, type CellOpts } from '../core/cells.ts';
import { browserClock } from '../core/clock.ts';
import { bindingPath } from '../core/track.ts';
import { detectPlatform, isObj, pathStr, type Key } from '../core/util.ts';
import { chordLabel } from '../core/keys.ts';
import type { CallSite } from '../core/diag.ts';
import type { TxOpts } from '../core/store.ts';
import { isNode, walk, type NodeData } from '../ir/node.ts';
import type { BuiltApp } from '../app/built-app.ts';
import type { Runtime, Services } from '../app/runtime.ts';
import { menuBar } from '../app/chrome.ts';
import { h, icon, setIcons, listen } from './h.ts';
import { DomChrome } from './chrome.ts';
import { DomDock } from './dock.ts';
import { themeHandle } from './theme.ts';
import { DEFAULT_THEME, resolveTheme } from '../themes/tokens.ts';

export type Renderer = (n: NodeData, m: MountCtx) => Node | null;
/** built-in renderers, registered by the forms modules when '@chromobench/shell/dom' is imported */
export const RENDERERS = new Map<string, Renderer>();
export function defineRenderer(form: string, r: Renderer): void {
  RENDERERS.set(form, r);
}

/** What the DOM half keeps per mounted app. */
export interface DomApp {
  rt: Runtime<any>;
  root: HTMLElement;
  renderers: Map<string, Renderer>;
  chrome: DomChrome;
  dock: DomDock;
  collections: Set<{ el: HTMLElement; move(d: number, e?: any): void; readonly items: unknown[]; sel: any }>;
  mountCtx: MountCtx;
}

export class MountCtx {
  readonly dom: DomApp;
  readonly scope: Scope;
  readonly env: Record<string, any>;
  constructor(dom: DomApp, scope: Scope, env: Record<string, any> = {}) {
    this.dom = dom;
    this.scope = scope;
    this.env = env;
  }
  get rt(): Runtime<any> {
    return this.dom.rt;
  }
  /** CraftKit's name for the runtime */
  get app(): Runtime<any> {
    return this.dom.rt;
  }
  get store() {
    return this.dom.rt.store;
  }
  child(name: string, env?: Record<string, unknown>): MountCtx {
    return new MountCtx(this.dom, this.scope.child(name), Object.assign({}, this.env, env || {}));
  }
  with(env: Record<string, unknown>): MountCtx {
    return new MountCtx(this.dom, this.scope, Object.assign({}, this.env, env));
  }
  cell<T>(fn: (s: any, arg?: any) => T, effect: ((v: T, prev: T | undefined) => void) | null, opts: CellOpts<T> = {}): Cell<T> {
    return this.rt.cell(fn, effect, { ...opts, scope: this.scope });
  }
  /** a τ prop or a constant: effect(value) now and whenever it changes */
  val<T>(v: T | ((s: any) => T), effect: (v: T) => void, opts?: CellOpts<T>): Cell<T> | null {
    if (typeof v === 'function' && !(v as any).isCommand) return this.cell(v as (s: any) => T, effect, opts);
    effect(v as T);
    return null;
  }
  binding(fn: unknown, at: CallSite | null, opts: { label?: string } = {}): Binding {
    return new Binding(this, fn, at, opts);
  }
  mount(n: unknown): Node | null {
    if (n == null || n === false) return null;
    if (typeof Node !== 'undefined' && n instanceof Node) return n;
    if (typeof n === 'string' || typeof n === 'number') return document.createTextNode(String(n));
    if (!isNode(n)) return document.createTextNode('');
    const r = this.dom.renderers.get(n.$);
    if (!r) return h('span', { class: 'ck-missing', 'data-form': n.$, text: `[${n.$}]` });
    const el = r(n, this);
    if (el && el.nodeType === 1) decorate(el as HTMLElement, n, this);
    return el;
  }
  mountAll(kids: readonly unknown[]): Node[] {
    return kids.map(k => this.mount(k)).filter(Boolean) as Node[];
  }
  run(target: unknown, ...args: unknown[]): unknown {
    return this.rt.runTarget(target as any, args, this.env);
  }
  rctx(extra: Record<string, unknown> = {}): any {
    return this.rt.ctx({ env: this.env, ...extra });
  }
  txOpts(): TxOpts {
    return this.rt.txOptsNow(this.env);
  }
}

/** common props every element understands */
function decorate(el: HTMLElement, n: NodeData, m: MountCtx): void {
  const p = n.props as Record<string, any>;
  if (p['class']) el.classList.add(...String(p['class']).split(/\s+/).filter(Boolean));
  if (p['id'] && !el.id) el.dataset['ckId'] = String(p['id']);
  if (p['grow']) el.style.flex = String(p['grow'] === true ? 1 : p['grow']);
  if (p['style']) Object.assign(el.style, p['style']);
  if (p['width']) el.style.width = typeof p['width'] === 'number' ? p['width'] + 'px' : p['width'];
  if (p['height']) el.style.height = typeof p['height'] === 'number' ? p['height'] + 'px' : p['height'];
  if (p['hidden'] !== undefined)
    m.val(p['hidden'], v => {
      el.hidden = !!v;
    });
  if (p['tip'] !== undefined && !el.dataset['ownTip'])
    m.val(p['tip'], v => {
      if (v) el.dataset['tip'] = String(v);
      else delete el.dataset['tip'];
    });
  if (p['disabled'] !== undefined && !el.dataset['ownDisabled']) m.val(p['disabled'], v => setDisabled(el, !!v, p['why'], m));
}

export function setDisabled(el: HTMLElement, off: boolean, why: unknown, m: MountCtx): void {
  el.classList.toggle('is-disabled', off);
  el.setAttribute('aria-disabled', off ? 'true' : 'false');
  for (const x of el.querySelectorAll('input,button,select,textarea')) (x as HTMLInputElement).disabled = off;
  if (off && why) {
    if (typeof why === 'function') {
      try {
        el.dataset['why'] = String(why(m.store.readonly()));
      } catch {
        el.dataset['why'] = '';
      }
    } else el.dataset['why'] = String(why);
  } else delete el.dataset['why'];
}

// ── two-way bindings ───────────────────────────────────────────────────────
// A binding names one path. Reading goes through a cell; writing is a preview during a gesture and one
// transaction when it ends, or a transaction per change.
export class Binding {
  readonly m: MountCtx;
  readonly at: CallSite | null;
  readonly fn: (s: any) => unknown;
  readonly fixed: Key[] | null = null;
  label: string;
  gesturePath: Key[] | null = null;
  constructor(m: MountCtx, fn: unknown, at: CallSite | null, opts: { label?: string } = {}) {
    this.m = m;
    this.at = at;
    if (typeof fn === 'string') {
      const fixed = fn.split('.').map(k => (/^\d+$/.test(k) ? +k : k));
      this.fixed = fixed;
      this.fn = s => fixed.reduce((o: any, k) => (o == null ? o : o[k]), s);
    } else this.fn = (fn as (s: any) => unknown) || (() => undefined);
    this.label = opts.label || '';
  }
  /** resolved when used: s => s.dev[s.ui.selection.primary].x follows the selection; within one gesture it does not move */
  get path(): Key[] | null {
    if (this.fixed) return this.fixed;
    if (this.gesturePath) return this.gesturePath;
    return bindingPath(this.m.store, this.fn).path;
  }
  watch(effect: (v: any) => void): Cell<unknown> {
    return this.m.cell(this.fn, effect, { at: this.at, name: 'bind' });
  }
  get(): any {
    const p = this.path;
    return p ? this.m.store.peek(p) : undefined;
  }
  txOpts(extra?: TxOpts): TxOpts {
    return Object.assign({}, this.m.txOpts(), extra || {});
  }
  /** an edit that outlives the selection (a text field being typed in) holds on to the path it started on */
  pin(): void {
    this.gesturePath = null;
    this.gesturePath = this.path;
  }
  unpin(): void {
    this.gesturePath = null;
  }
  preview(v: unknown): void {
    const p = this.gesturePath || (this.gesturePath = this.path);
    if (!p) return;
    this.m.store.preview(p, v);
  }
  commit(label?: string, extra?: TxOpts): unknown {
    const r = this.m.store.commit(label || this.label || 'Change', this.txOpts(extra));
    this.gesturePath = null;
    return r;
  }
  cancel(): void {
    this.m.store.cancel();
    this.gesturePath = null;
  }
  set(v: unknown, label?: string | null, extra?: TxOpts): void {
    const path = this.path;
    if (!path) return;
    const st = this.m.store;
    if (st.tierOf(path) === 'view') {
      st.set(path, v);
      return;
    }
    st.tx(label || this.label || 'Change', t => t.$set(path, v), this.txOpts(extra));
  }
  get name(): string {
    const p = this.path;
    return p ? pathStr(p) : '?';
  }
}

// ── mount ─────────────────────────────────────────────────────────────────
export interface DomServices extends Services {
  /** extra renderers by form name */
  renderers?: Record<string, Renderer>;
  /** where the theme's tokens are written (default: the app root; a host frame passes document.documentElement) */
  themeRoot?: HTMLElement;
}

export interface Mounted<S = any> {
  rt: Runtime<S>;
  dom: DomApp;
  dispose(): void;
}

/** Start the app in the browser: restore through persistence, then build the DOM. */
export async function mount<S>(app: BuiltApp<S>, root: HTMLElement, services: DomServices = {}): Promise<Mounted<S>> {
  const rt = await app.boot({ clock: browserClock(), platform: detectPlatform(), ...services });
  return mountRuntime(rt, root, services);
}

/** Build the DOM for a started runtime (tests start headless runtimes and mount them on happy-dom). */
export function mountRuntime<S>(rt: Runtime<S>, root: HTMLElement, services: DomServices = {}): Mounted<S> {
  const ir = rt.app.ir;
  const renderers = new Map(RENDERERS);
  for (const f of ir.forms.values()) if (typeof f.render === 'function') renderers.set(f.name, f.render as Renderer);
  for (const [k, r] of Object.entries(services.renderers || {})) renderers.set(k, r);
  // fragments may wrap a form's renderer
  for (const f of ir.fragments) {
    const r = renderers.get(f.target);
    if (f.spec.render && r) {
      const wrapped = f.spec.render(r) as Renderer;
      const when = f.spec.when;
      renderers.set(f.target, when ? (n, m) => (when(n) ? wrapped(n, m) : r(n, m)) : wrapped);
    }
  }
  setIcons(ir.icons);
  const dom = { rt, root, renderers, collections: new Set() } as unknown as DomApp;
  const scope = new Scope(null, 'dom');
  const m = new MountCtx(dom, scope, {});
  dom.mountCtx = m;
  dom.chrome = new DomChrome(dom);
  dom.dock = new DomDock(dom);
  rt.chrome = dom.chrome;
  // a form with a spec but no renderer, reported once at mount
  const missing = new Set<string>();
  for (const t of ir.trees()) walk(t.node, n => void (ir.forms.has(n.$) && !renderers.has(n.$) && missing.add(n.$)));
  for (const f of missing) rt.diagnostics.warn('CK-V320', `No renderer for form '${f}'`, { runtime: true, fix: `Give the form a render function, or pass renderers: { '${f}': (n, m) => … } to mount.` });

  root.classList.add('ck-app');
  root.replaceChildren();
  // the theme and interface gray: prefs (View ▸ Theme, View ▸ Interface Gray) over the program's theme (CHB-025)
  const themeTarget = services.themeRoot ?? root;
  const theme = themeHandle(themeTarget, resolveTheme(ir.themes, DEFAULT_THEME));
  m.cell(
    s => `${rt.themeName(s)}|${s.prefs?.gray || 'auto'}`,
    v => {
      const [name, gray] = v.split('|') as [string, string];
      theme.set(resolveTheme(ir.themes, name), gray);
      if (themeTarget !== root) {
        root.dataset['ckTheme'] = name;
        root.dataset['gray'] = gray;
      }
    },
  );
  const offTheme = (): void => theme.dispose();
  // the menu bar (Help stays last)
  const bar = dom.chrome.menubar(menuBar(rt));
  const title = h('div', { class: 'ck-menubar-title' }, h('b', { text: ir.name }));
  const status = h('div', { class: 'ck-menubar-status' });
  m.cell(
    s => s.view?.module,
    () => bar.refresh(),
  );
  const top = h('header', { class: 'ck-top' }, bar, title, status);
  if (ir.opts.statusbar !== false) {
    const saved = h('span', { class: 'ck-status-saved' });
    status.append(saved);
    rt.on('saved', (t: string) => void (saved.textContent = t));
  }
  // the module picker
  const picker = h('div', { class: 'ck-modules', role: 'tablist' });
  if (rt.modules.size > 1)
    for (const mod of rt.modules.values()) {
      const chord = rt.keymap.chordsFor('module.' + mod.id)[0];
      const b = h('button', { type: 'button', class: 'ck-module', role: 'tab', 'data-module': mod.id, 'data-tip': chord ? `${mod.label} (${chordLabel(chord, rt.platform)})` : mod.label }, mod.icon ? icon(mod.icon, 13) : '', h('span', { text: mod.label }));
      listen(scope, b, 'click', () => rt.go(mod.id));
      m.cell(
        s => s.view?.module === mod.id,
        on => {
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        },
      );
      picker.append(b);
    }
  const plate = h('div', { class: 'ck-plate' }, h('span', { class: 'ck-plate-mark' }), h('span', { text: ir.opts.plate || ir.name }));
  const strip = h('div', { class: 'ck-modbar' }, plate, picker);
  m.cell(
    s => !!(s.workspace?.hide && (s.workspace.hide.top || s.workspace.hide.all)),
    v => {
      strip.hidden = v || rt.modules.size < 2;
      // the app's name once (CHB-027 F11): the plate shows it; the menu bar only while the plate is hidden
      title.hidden = !strip.hidden;
    },
  );
  const work = h('main', { class: 'ck-main' });
  root.append(top, strip, work);
  dom.chrome.mount(root);
  // the module frame, rebuilt when the module changes
  let modScope: MountCtx | null = null;
  m.cell(
    s => s.view?.module,
    (id: string) => {
      if (modScope) modScope.scope.dispose();
      const mod = rt.modules.get(id);
      modScope = m.child('module:' + id, { module: id, txOpts: mod?.txOpts });
      work.replaceChildren(mod ? dom.dock.mountModule(mod, modScope) : h('div', { text: 'No module' }));
      root.dataset['module'] = id;
    },
  );
  // keys and focus
  const focusFromDom = (): void => {
    const a = document.activeElement as HTMLElement | null;
    rt.focus.text = !!a?.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select,[contenteditable="true"]');
    rt.focus.button = !!a?.matches?.('button,[role="button"],[role="tab"],[role="menuitem"],a[href],summary');
    const p = a?.closest?.('.ck-panel') as HTMLElement | null;
    rt.focus.panel = p ? p.dataset['panel'] ?? null : null;
    rt.focus.dialog = !!dom.chrome.modal;
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (dom.chrome.menus.length && e.key !== 'Escape') return;
    focusFromDom();
    rt.keys.keydown(e, rt.platform);
  };
  const onKeyUp = (e: KeyboardEvent): void => rt.keys.keyup(e, rt.platform);
  const onBlur = (): void => rt.keys.releaseAll();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  listen(scope, root, 'focusin', (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    const p = t.closest?.('.ck-panel') as HTMLElement | null;
    rt.focus.panel = p ? p.dataset['panel'] ?? null : null;
    const v = t.closest?.('.ck-vp') as HTMLElement | null;
    if (v) rt.focus.canvas = v.dataset['viewport'] ?? null;
  });
  rt.on('reveal', (id: string) => dom.dock.reveal(id));
  rt.scheduler.request();
  const dispose = (): void => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    offTheme();
    scope.dispose();
    rt.dispose();
    root.replaceChildren();
  };
  return { rt, dom, dispose };
}

export const isElement = (v: unknown): v is HTMLElement => isObj(v) && (v as any).nodeType === 1;
