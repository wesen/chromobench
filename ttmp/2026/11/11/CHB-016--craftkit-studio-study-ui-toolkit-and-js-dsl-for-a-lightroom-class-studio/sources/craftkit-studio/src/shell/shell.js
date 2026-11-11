// The shell: a fluent builder that records an app (state, commands, menus, keys, tools, panels, modules) as data,
// checks it, and mounts it. Builder methods only record; .build() runs the checks and returns an App with its
// diagnostics, and app.mount(el) starts the runtime: Input → Route → Intent → Change → Propagate → Schedule → Draw.

import { Store } from './core/store.js';
import { History } from './core/history.js';
import { Scheduler, Scope } from './core/cells.js';
import { Commands } from './core/commands.js';
import { Keymap, KeyRouter, chordLabel } from './core/keys.js';
import { Diagnostics, site, where } from './core/diag.js';
import { Engine, exprNode, ALL as ALL_EXPRS } from './core/engine.js';
import { suggest, deepMerge, isObj, pathStr, isMac } from './core/util.js';
import { bindingPath, missingKey } from './core/track.js';
import { node, isNode, walk, MountCtx, FORMS } from './ui/node.js';
import { h, icon } from './ui/dom.js';
import { Chrome } from './ui/chrome.js';
import { Dock } from './ui/dock.js';

export const registry = { panels: new Map(), tools: new Map() };

// ── the builder ────────────────────────────────────────────────────────────
class ModuleBuilder {
  constructor(id, at) { this.m = { id, label: id[0].toUpperCase() + id.slice(1), key: null, regions: {}, keys: [], at, tools: [], icon: null }; }
  label(v) { this.m.label = v; return this; }
  key(v) { this.m.key = v; return this; }
  icon(v) { this.m.icon = v; return this; }
  top(n) { this.m.regions.top = n; return this; }
  left(n) { this.m.regions.left = n; return this; }
  center(n) { this.m.regions.center = n; return this; }
  right(n) { this.m.regions.right = n; return this; }
  bottom(n) { this.m.regions.bottom = n; return this; }
  toolbar(n) { this.m.regions.toolbar = n; return this; }
  tools(ids) { this.m.tools = ids; return this; }
  keys(scope, map) { if (typeof scope === 'object') { map = scope; scope = 'module:' + this.m.id; } this.m.keys.push({ scope, map, at: site() }); return this; }
  txOpts(f) { this.m.txOpts = f; return this; }
  onEnter(f) { this.m.onEnter = f; return this; }
  onEscape(f) { this.m.onEscape = f; return this; }   // Esc tries this first (return false to let the shell continue)
}

class ToolsBuilder {
  constructor(shell) { this.s = shell; }
  tool(id, spec) { this.s.def.tools.set(id, Object.assign({ id, at: site() }, spec)); return this; }
  group(name, ids, opts = {}) { this.s.def.toolGroups.push({ name, ids, opts, at: site() }); return this; }
  spring(chord, tool, opts) { this.s.def.springs.push({ chord, tool, opts: opts || {}, at: site() }); return this; }
}

class CommandsBuilder {
  constructor(shell) { this.s = shell; }
  add(id, spec) { const at = site(); this.s.def.commands.push({ id, spec: Object.assign({}, spec, { at }) }); return this; }
}

class MenusBuilder {
  constructor(shell) { this.s = shell; }
  // a second .menu() with the same label adds to that menu (after a separator), so modules can extend File or Window
  menu(label, items) {
    const prev = this.s.def.menus.find(m => m.label === label);
    if (prev) prev.items = prev.items.concat(['-'], items); else this.s.def.menus.push({ label, items, at: site() });
    return this;
  }
}

export class ShellBuilder {
  constructor(name, opts = {}) {
    this.def = { name, opts, at: site(), init: {}, stateOpts: {}, derived: [], commands: [], menus: [], keys: [], springs: [], tools: new Map(), toolGroups: [], panels: [], modules: [], events: [], contexts: new Map(), palette: { keys: 'Mod+K' }, engine: null, persist: opts.persist !== false };
  }
  state(init, opts = {}) { this.def.init = init; this.def.stateOpts = opts; return this; }
  derive(path, fn) { this.def.derived.push({ path, fn, at: site() }); return this; }
  commands(f) { f(new CommandsBuilder(this)); return this; }
  menus(f) { f(new MenusBuilder(this)); return this; }
  keys(scope, map) { if (typeof scope === 'object') { map = scope; scope = 'global'; } this.def.keys.push({ scope, map, at: site() }); return this; }
  spring(chord, tool, opts) { this.def.springs.push({ chord, tool, opts: opts || {}, at: site() }); return this; }
  tools(f) { f(new ToolsBuilder(this)); return this; }
  panels(...defs) { this.def.panels.push(...defs.flat()); return this; }
  module(id, f) { const b = new ModuleBuilder(id, site()); f(b); this.def.modules.push(b.m); return this; }
  // a small shell gives regions straight to the builder (one implicit module)
  region(side, n) { let m = this.def.modules.find(x => x.id === 'main'); if (!m) { m = new ModuleBuilder('main', site()).m; m.label = this.def.name; this.def.modules.push(m); } m.regions[side] = n; return this; }
  top(n) { return this.region('top', n); }
  left(n) { return this.region('left', n); }
  center(n) { return this.region('center', n); }
  right(n) { return this.region('right', n); }
  bottom(n) { return this.region('bottom', n); }
  toolbar(n) { return this.region('toolbar', n); }
  context(scope, items) { this.def.contexts.set(scope, items); return this; }
  palette(o) { this.def.palette = Object.assign({}, this.def.palette, o); return this; }
  on(event, f) { this.def.events.push({ event, f, at: site() }); return this; }
  engine(o) { this.def.engine = o; return this; }
  build() { return new App(this.def); }
}

// ── the app ────────────────────────────────────────────────────────────────
export class App {
  constructor(def) {
    this.def = def;
    this.name = def.name;
    this.diagnostics = new Diagnostics();
    this.listeners = new Map();
    this.viewports = new Map(); this.collections = new Set();
    this.focus = { panel: null, canvas: null, dialog: false };
    this.spring = null; this.pointer = null; this.dragging = null;
    // state: restore what autosave kept, over the initial state
    const restored = def.persist ? loadSaved(def) : null;
    let init = def.init;
    if (restored) { init = deepMerge(deepMerge(def.init, restored.view || {}), restored.doc || {}); if (def.stateOpts.restore) { try { init = def.stateOpts.restore(init); } catch (e) { console.warn('[ck] restore failed; starting fresh', e); init = def.init; } } }
    this.store = new Store(Object.assign({ view: {}, ui: {}, workspace: {}, prefs: {} }, init), def.stateOpts);
    this.restored = !!restored;
    this.history = new History(this.store);
    this.scheduler = new Scheduler(this.store);
    for (const d of def.derived) this.store.derive(d.path, d.fn);
    this.commands = new Commands();
    this.keymap = new Keymap();
    this.tools = new Map(def.tools);
    this.modules = new Map(def.modules.map(m => [m.id, m]));
    this.panels = new Map();
    this.chrome = new Chrome(this);
    this.dock = new Dock(this);
    this.engine = new Engine(Object.assign({ base: '.', script: 'engine.js' }, def.engine || {}));
    this.builtins();
    for (const c of def.commands) this.commands.add(c.id, c.spec);
    for (const k of def.keys) this.keymap.bindMap(k.scope, k.map, k.at);
    for (const mod of def.modules) {
      for (const k of mod.keys) this.keymap.bindMap(k.scope, k.map, k.at);
      if (mod.key) { this.commands.add('module.' + mod.id, { label: `${mod.label}`, run: () => this.go(mod.id), checked: s => s.view.module === mod.id, menu: 'Window', at: mod.at }); this.keymap.bind('module:*', mod.key, 'module.' + mod.id, mod.at); }
    }
    // which modules offer each tool: the tools their viewports name
    const offered = new Map();
    for (const md of def.modules) for (const r of Object.values(md.regions || {})) if (r) walk(isNode(r) ? r : node('column', {}, [].concat(r), md.at), n => {
      if (n.$ === 'viewport') for (const t of n.props.tools || []) (offered.get(t) || offered.set(t, new Set()).get(t)).add(md.id);
    });
    for (const [id, t] of this.tools) {
      // a tool shows in menus and the palette, and answers its key, only in the modules that offer it
      const where = t.module ? [].concat(t.module) : [...(offered.get(id) || [])];
      if (t.key) { if (t.scope || !where.length) this.keymap.bind(t.scope || 'module:*', t.key, 'tool.' + id, t.at); else for (const mid of where) this.keymap.bind('module:' + mid, t.key, 'tool.' + id, t.at); }
      this.commands.add('tool.' + id, { label: t.label || id, icon: t.icon, run: ctx => this.selectTool(id, true), checked: s => s.ui.tool === id, enabled: t.enabled, why: t.why, at: t.at, menu: 'Tools', module: where.length ? where : undefined });
    }
    for (const s of def.springs) this.keymap.spring(s.chord, s.tool, s.opts, s.at);
    for (const p of def.panels.concat([...registry.panels.values()])) if (isNode(p) && p.$ === 'panel' && !this.panels.has(p.props.id)) this.panels.set(p.props.id, p);
    for (const e of def.events) this.on(e.event, (...a) => this.runTarget(e.f, a));
    this.check();
  }

  // ── built-in commands every shell has (an app can replace any of them by id) ──
  builtins() {
    const c = this.commands, at = this.def.at;
    const add = (id, spec) => c.add(id, Object.assign({ at, builtin: true }, spec));
    add('edit.undo', { label: s => this.history.last ? `Undo ${this.history.last}` : 'Undo', menu: 'Edit', enabled: () => this.history.canUndo, why: 'Nothing to undo yet', run: () => { const e = this.history.undo(); if (e) this.chrome.toast(`Undo ${e.label}${this.whereOf(e)}`, { kind: 'info', ms: 1400 }); } });
    add('edit.redo', { label: s => this.history.next ? `Redo ${this.history.next}` : 'Redo', menu: 'Edit', enabled: () => this.history.canRedo, why: 'Nothing to redo', run: () => { const e = this.history.redo(); if (e) this.chrome.toast(`Redo ${e.label}${this.whereOf(e)}`, { kind: 'info', ms: 1400 }); } });
    add('app.palette', { label: 'Find a Command…', menu: 'Help', run: () => this.chrome.palette(), palette: false });
    add('app.shortcuts', { label: 'Keyboard Shortcuts', menu: 'Help', run: () => this.chrome.shortcuts() });
    add('app.diagnostics', { label: 'Build Report', menu: 'Help', run: () => this.showDiagnostics() });
    add('view.hideSides', { label: 'Hide Side Panels', menu: 'Window', run: () => this.dock.hideSides(), checked: s => !!(s.workspace.hide && s.workspace.hide.sides) });
    add('view.hideAll', { label: 'Hide All Panels', menu: 'Window', run: () => this.dock.hideAll(), checked: s => !!(s.workspace.hide && s.workspace.hide.all) });
    add('view.toggleLeft', { label: 'Left Panels', menu: 'Window', run: () => this.dock.toggle('left'), checked: s => !this.sideHidden(s, 'left') });
    add('view.toggleRight', { label: 'Right Panels', menu: 'Window', run: () => this.dock.toggle('right'), checked: s => !this.sideHidden(s, 'right') });
    add('view.toggleBottom', { label: 'Filmstrip', menu: 'Window', run: () => this.dock.toggle('bottom'), checked: s => !this.sideHidden(s, 'bottom') });
    add('view.toggleTop', { label: 'Module Picker', menu: 'Window', run: () => this.store.set(['workspace', 'hide', 'top'], !(this.store.peek(['workspace', 'hide', 'top']))), checked: s => !(s.workspace.hide && s.workspace.hide.top) });
    add('view.toggleToolbar', { label: 'Toolbar', menu: 'View', run: () => this.dock.toggleToolbar(), checked: s => !(s.workspace.hide && s.workspace.hide.toolbar) });
    add('view.soloLeft', { label: 'Solo Mode (Left)', menu: 'Window', run: () => this.dock.toggleSolo('left'), checked: s => !!(s.workspace.solo && s.workspace.solo[s.view.module + ':left']) });
    add('view.soloRight', { label: 'Solo Mode (Right)', menu: 'Window', run: () => this.dock.toggleSolo('right'), checked: s => !!(s.workspace.solo && s.workspace.solo[s.view.module + ':right']) });
    add('workspace.reset', { label: 'Reset Workspace', menu: 'Window', run: () => this.dock.reset(this.store.peek(['view', 'module'])) });
    add('view.zoomIn', { label: 'Zoom In', menu: 'View', run: () => this.viewport() && this.viewport().zoomBy(1), enabled: () => !!this.viewport(), why: 'No photo is shown' });
    add('view.zoomOut', { label: 'Zoom Out', menu: 'View', run: () => this.viewport() && this.viewport().zoomBy(-1), enabled: () => !!this.viewport(), why: 'No photo is shown' });
    add('view.fit', { label: 'Fit in Window', menu: 'View', run: () => this.viewport() && this.viewport().setZoom('fit'), enabled: () => !!this.viewport(), why: 'No photo is shown' });
    add('view.actual', { label: '100% (1:1)', menu: 'View', run: () => this.viewport() && this.viewport().setZoom(1), enabled: () => !!this.viewport(), why: 'No photo is shown' });
    add('view.toggle-1:1', { label: 'Toggle Zoom View', menu: 'View', run: () => { const v = this.viewport(); if (v) v.setZoom(v.view.zoom === 'fit' ? 1 : 'fit'); }, enabled: () => !!this.viewport(), why: 'No photo is shown' });
    add('tool.none', { label: 'No Tool', run: () => this.selectTool(null), palette: false });
    add('app.escape', { label: 'Cancel', palette: false, run: () => { if (this.store.previewing) { this.store.cancel(); return; } { const mod = this.modules.get(this.store.peek(['view', 'module'])); if (mod && mod.onEscape && this.runTarget(mod.onEscape, []) !== false) return; } if (this.store.peek(['ui', 'tool'])) { const t = this.tools.get(this.store.peek(['ui', 'tool'])); if (t && t.on && t.on.escape) { this.runTarget(t.on.escape, []); return; } this.selectTool(null); return; } const g = this.store.peek(['workspace', 'hide']); if (g && (g.all || g.sides)) this.store.set(['workspace', 'hide'], {}); } });
    add('app.theme', { label: s => `Interface Gray: ${GRAYS[s.prefs && s.prefs.gray] || 'Auto'}`, menu: 'View', run: () => this.cycleGray() });
    this.keymap.bindMap('global', { 'Mod+Z': 'edit.undo', 'Mod+Shift+Z': 'edit.redo', [this.def.palette.keys || 'Mod+K']: 'app.palette', 'Mod+/': 'app.shortcuts', 'Tab': 'view.hideSides', 'Shift+Tab': 'view.hideAll', F5: 'view.toggleTop', F6: 'view.toggleBottom', F7: 'view.toggleLeft', F8: 'view.toggleRight', 'Mod+=': 'view.zoomIn', 'Mod+-': 'view.zoomOut', 'Mod+0': 'view.fit', 'Mod+Alt+0': 'view.actual', Escape: 'app.escape' }, this.def.at);
  }
  sideHidden(s, side) { const L = s.workspace.layout && s.workspace.layout[s.view.module]; const g = s.workspace.hide || {}; return !!(L && L[side] && L[side].hidden) || !!g.all || (!!g.sides && (side === 'left' || side === 'right')); }

  // ── the build checks ──
  check() {
    const D = this.diagnostics, st = this.store;
    const moduleIds = [...this.modules.keys()];
    // panels and module regions
    const seenNodes = new Set();
    const checkTree = (root, where) => walk(root, n => {
      if (seenNodes.has(n)) return; seenNodes.add(n);
      for (const d of n.diags) D.add(d);
      if (n.$ === 'docktabs') for (const id of n.props.panels) if (!this.panels.has(id)) { const s2 = suggest(id, [...this.panels.keys()]); D.error({ code: 'D302', title: `No panel '${id}'`, at: n.at, lines: [`in a tab group in ${where}`], fix: s2.length ? `Did you mean '${s2[0]}'?` : `Define it with ck.panel('${id}', …) first.` }); }
      if (n.$ === 'panelref' && !this.panels.has(n.props.id)) {
        const s = suggest(n.props.id, [...this.panels.keys()]);
        D.error({ code: 'D302', title: `No panel '${n.props.id}'`, at: n.at, lines: [`placed in ${where}`, `panels: ${[...this.panels.keys()].join(', ') || 'none defined'}`], fix: s.length ? `Did you mean '${s[0]}'?` : `Define it with ck.panel('${n.props.id}', { title }, …) first.` });
      }
      const bind = n.props.bind;
      if (bind && (typeof bind === 'function' || typeof bind === 'string') && !n.props.lazy) {
        let path;
        if (typeof bind === 'string') path = bind.split('.');
        else { const r = bindingPath(st, bind); if (r.error) { D.error({ code: 'B112', title: `A binding failed on the initial state`, at: n.at, lines: [String(r.error.message || r.error)], fix: 'Bindings run against the initial state at build; give every path an initial value.' }); return; } path = r.path; }
        if (!path) { D.error({ code: 'B113', title: 'A binding that reads no state', at: n.at, lines: [`${n.$}.bind = ${String(bind).slice(0, 60)}`], fix: 'bind: s => s.some.path' }); return; }
        const miss = missingKey(st.current, path);
        if (miss && !st.derivedAt(path)) {
          if (miss.parentMissing) D.warn({ code: 'B111', title: 'Binding path not in the initial state', at: n.at, lines: [`s.${pathStr(path)}: s.${pathStr(miss.parent) || '(root)'} is ${miss.parent.length ? 'not an object yet' : 'missing'}.`], fix: `Give s.${pathStr(miss.parent)} an initial value in .state(…), so the build can check the rest of the path.` });
          else { const s = suggest(String(miss.key), miss.has); D.error({ code: 'B110', title: 'Binding path not in state', at: n.at, lines: [`s.${pathStr(path)} does not exist.`, `${pathStr(miss.parent) || 'the state'} has: ${miss.has.slice(0, 12).join(', ')}${miss.has.length > 12 ? ', …' : ''}`], fix: s.length ? `Did you mean s.${pathStr(miss.parent.concat([s[0]]))}?` : `Add ${miss.key} to the initial state.` }); }
        }
      }
      // a collection's own keys join the key map under collection:<id>, so they are checked and listed in the
      // shortcut sheet (the collection still handles them itself while it has focus)
      if (['listview', 'gridview', 'filmstrip', 'treeview'].includes(n.$) && n.props.keys) this.keymap.bindMap('collection:' + (n.props.id || n.$), n.props.keys, n.at);
      if (n.$ === 'match' && n.props.of) {
        const missing = n.props.of.filter(k => !(k in n.props.cases));
        if (missing.length && !('default' in n.props.cases)) D.error({ code: 'M201', title: 'ck.match does not cover every case', at: n.at, lines: [`missing: ${missing.join(', ')}`], fix: `Add ${missing.map(k => `${k}: …`).join(', ')}, or a default case.` });
      }
      if (n.$ === 'viewport') for (const t of n.props.tools || []) if (!this.tools.has(t)) { const s = suggest(t, [...this.tools.keys()]); D.error({ code: 'V302', title: `Viewport names a tool that does not exist: '${t}'`, at: n.at, lines: [`tools: ${[...this.tools.keys()].join(', ')}`], fix: s.length ? `Did you mean '${s[0]}'?` : `Add it with .tools(t => t.tool('${t}', { … }))` }); }
    });
    for (const p of this.panels.values()) checkTree(p, `panel '${p.props.id}'`);
    for (const mod of this.modules.values()) {
      const placed = new Map();
      for (const [side, r] of Object.entries(mod.regions)) {
        if (!r) continue;
        checkTree(isNode(r) ? r : node('column', {}, [].concat(r), mod.at), `module '${mod.id}' ${side}`);
        walk(isNode(r) ? r : node('column', {}, [].concat(r), mod.at), n => {
          for (const id of n.$ === 'docktabs' ? n.props.panels : (n.$ === 'panelref' || n.$ === 'panel') ? [n.props.id] : []) {
            if (placed.has(id)) D.error({ code: 'D301', title: `Panel '${id}' placed twice in module '${mod.id}'`, at: n.at, lines: [`first: ${placed.get(id)}`, `again: ${side}`], fix: 'A panel lives in one place per module; use ck.dock.tabs to group it with others.' });
            else placed.set(id, side);
          }
        });
      }
      if (!mod.regions.center) D.warn({ code: 'D303', title: `Module '${mod.id}' has no centre`, at: mod.at, lines: ['Nothing fills the middle of the window.'], fix: `.module('${mod.id}', m => m.center(ck.viewport(…)))` });
    }
    // menus name commands
    const checkItems = (items, menu) => { for (const it of items || []) { if (typeof it === 'string' && it !== '-' && !this.commands.has(it)) { const s = this.commands.suggest(it); D.error({ code: 'B150', title: `Menu '${menu.label}' names a command that does not exist`, at: menu.at, lines: [`'${it}'`], fix: s.length ? `Did you mean '${s[0]}'?` : 'Add the command first.' }); } if (it && it.items) checkItems(it.items, menu); } };
    for (const m of this.def.menus) checkItems(m.items, m);
    for (const [, t] of this.tools) if (t.on && !t.on.down && !t.select) D.warn({ code: 'T401', title: `Tool '${t.id}' has no on.down`, at: t.at, lines: ['It can be selected but does nothing on the canvas.'], fix: 'Give it on: { down, drag, up }.' });
    for (const s of this.def.springs) if (typeof s.tool === 'string' && !this.tools.has(s.tool) && !['hand', 'zoom'].includes(s.tool)) D.error({ code: 'K221', title: `Spring to a tool that does not exist: '${s.tool}'`, at: s.at, lines: [], fix: `tools: ${[...this.tools.keys()].join(', ')}` });
    this.keymap.check(D, this.commands, moduleIds);
    D.info({ code: 'I001', title: 'Build summary', at: this.def.at, lines: [`${this.modules.size} modules · ${this.panels.size} panels · ${this.commands.map.size} commands · ${this.keymap.bindings.length} key bindings · ${this.tools.size} tools`, D.summary()] });
  }

  // ── events ──
  on(ev, f) { if (!this.listeners.has(ev)) this.listeners.set(ev, new Set()); this.listeners.get(ev).add(f); return () => this.listeners.get(ev).delete(f); }
  emit(ev, ...a) { const s = this.listeners.get(ev); if (s) for (const f of [...s]) { try { f(...a); } catch (e) { console.error(e); } } }

  // ── the runtime context handed to every ρ lambda ──
  ctx(extra = {}) {
    const app = this, st = this.store;
    const ev = this.lastEvent;
    const c = {
      app, engine: this.engine,
      get state() { return st.readonly(); },
      mods: { shift: !!(ev && ev.shiftKey), alt: !!(ev && ev.altKey), mod: !!(ev && (isMac ? ev.metaKey : ev.ctrlKey)) },
      tx: (label, f, o) => st.tx(label, f, Object.assign({}, c.txOpts ? c.txOpts() : {}, o || {})),
      set: (obj, o) => st.setMany(obj, o),
      preview: (target, value) => { const path = typeof target === 'function' ? bindingPath(st, target).path : Array.isArray(target) ? target : String(target).split('.'); st.preview(path, value); },
      commit: (label, o) => st.commit(label, Object.assign({}, c.txOpts ? c.txOpts() : {}, o || {})),
      cancel: () => st.cancel(),
      run: (id, ...a) => app.runCommand(id, null, ...a),
      emit: (e, ...a) => app.emit(e, ...a),
      toast: (t, o) => app.chrome.toast(t, o),
      flash: (t, k) => { const v = app.viewport(); app.chrome.flash(v ? v.el : app.root.querySelector('.ck-center-main') || app.root, t, k); },
      dialog: spec => app.chrome.dialog(spec),
      go: id => app.go(id),
      history: app.history,
      save: (file) => app.save(file),
      viewport: id => app.viewport(id),
      options: (() => { const t = st.peek(['ui', 'tool']); return t ? (st.peek(['ui', 'toolOptions', t]) || {}) : {}; })(),
    };
    if (extra.env && extra.env.txOpts) c.txOpts = () => (typeof extra.env.txOpts === 'function' ? extra.env.txOpts(st.readonly()) : extra.env.txOpts);
    else { const mod = this.modules.get(st.peek(['view', 'module'])); if (mod && mod.txOpts) c.txOpts = () => mod.txOpts(st.readonly()); }
    return Object.assign(c, extra);
  }
  // a handler is a command id or a ρ lambda
  runTarget(target, args = [], m) {
    if (target == null) return;
    const ev = args.filter(a => typeof Event !== 'undefined' && a instanceof Event).pop();
    if (ev) this.lastEvent = ev;
    const sem = args.filter(a => !(typeof Event !== 'undefined' && a instanceof Event));
    if (typeof target === 'string') return this.runCommand(target, ev || null, ...sem);
    if (Array.isArray(target)) return this.runCommand(target[0], ev || null, ...target.slice(1), ...sem);   // ['photo.rate', 3]
    if (typeof target === 'function') {
      const ctx = this.ctx(m ? { env: m.env } : {});
      try { return target(...sem, ctx); }
      catch (err) { this.handlerError(err, { at: m && m.env && m.env.at }); }
    }
  }
  runCommand(id, e, ...args) {
    if (e) this.lastEvent = e;
    const ctx = this.ctx();
    try { return this.commands.run(id, ctx, ...args); }
    catch (err) { this.handlerError(err, this.commands.get(id)); }
  }
  handlerError(err, owner) {
    if (err && err.code === 'CK-T410') { this.diagnostics.error({ code: 'T410', title: 'Handler writes state outside a transaction', at: owner && owner.at, runtime: true, lines: [err.message], fix: "ctx.tx('Label', t => { … }) — one undo step with that name." }); this.chrome.toast(err.message, { kind: 'error' }); return; }
    console.error(err);
    this.chrome.toast(String(err && err.message || err), { kind: 'error' });
  }
  lambdaError(err, cell) { if (!this._lambdaErrs) this._lambdaErrs = new Set(); const k = cell.at ? where(cell.at) + err.message : err.message; if (this._lambdaErrs.has(k)) return; this._lambdaErrs.add(k); this.diagnostics.warn({ code: 'L330', title: 'A traced lambda threw', at: cell.at, runtime: true, lines: [String(err && err.message || err)], fix: 'Guard reads that can be empty: s.selection?.layer?.name ?? ""' }); console.warn(err); }

  // ── tools and springs ──
  selectTool(id, toggle) {
    const cur = this.store.peek(['ui', 'tool']);
    const next = toggle && cur === id ? null : id;
    if (cur && cur !== next) { const t = this.tools.get(cur); if (t && t.on && t.on.exit) this.runTarget(t.on.exit, []); }
    this.store.set(['ui', 'tool'], next);
    if (next) { const t = this.tools.get(next); if (t && t.on && t.on.enter) this.runTarget(t.on.enter, []); }
  }
  viewport(id) { if (id) return this.viewports.get(id); const f = this.focus.canvas && this.viewports.get(this.focus.canvas); if (f && document.body.contains(f.el)) return f; for (const v of this.viewports.values()) if (document.body.contains(v.el) && v.el.offsetParent !== null) return v; return null; }

  // ── modules ──
  go(id) {
    if (!this.modules.has(id)) { this.chrome.toast(`No module '${id}'`, { kind: 'error' }); return; }
    if (this.store.peek(['view', 'module']) === id) return;
    this.store.cancel();
    const t = this.store.peek(['ui', 'tool']); if (t) this.selectTool(null);
    this.store.set(['view', 'module'], id);
  }
  panelIds() { return [...this.panels.keys()]; }
  panelTitle(id) { const p = this.panels.get(id); const t = p && p.props.title; return typeof t === 'string' ? t : id; }
  resolvePanel(n) {
    if (isNode(n) && n.$ === 'panelref') { const p = this.panels.get(n.props.id); return p ? (Object.keys(n.props).length > 1 ? Object.assign({}, p, { props: Object.assign({}, p.props, n.props) }) : p) : node('text', { value: `missing panel ${n.props.id}` }, [], n.at); }
    return n;
  }

  // ── mounting ──
  mount(root) {
    this.root = root;
    root.classList.add('ck-app');
    const scope = new Scope(null, 'app');
    this.scope = scope;
    const m = new MountCtx(this, scope, {});
    this.rootMount = m;
    this.applyGray();
    if (!this.store.peek(['view', 'module']) || !this.modules.has(this.store.peek(['view', 'module']))) this.store.writeDoc([{ path: ['view', 'module'], value: this.def.modules[0] && this.def.modules[0].id }], { tier: 'view', init: true });
    // menu bar
    // Help stays last, wherever a module added its own menu
    const menus = (this.def.menus.length ? this.def.menus : this.defaultMenus()).slice().sort((a, b) => (a.label === 'Help') - (b.label === 'Help'));
    const bar = this.chrome.menubar(menus.map(x => ({ label: x.label, items: x.items })));
    const title = h('div', { class: 'ck-menubar-title' }, h('b', { text: this.name }));
    const status = h('div', { class: 'ck-menubar-status' });
    m.cell(s => s.view.module, () => bar.refresh());
    const top = h('header', { class: 'ck-top' }, bar, title, status);
    if (this.def.opts.statusbar !== false) this.statusbar(status, m);
    // module picker
    const picker = h('div', { class: 'ck-modules', role: 'tablist' });
    if (this.modules.size > 1) {
      for (const mod of this.modules.values()) {
        const b = h('button', { type: 'button', class: 'ck-module', role: 'tab', 'data-tip': mod.key ? `${mod.label} (${chordLabel(this.keymap.bindings.find(x => x.target === 'module.' + mod.id)?.chord || mod.key)})` : mod.label }, mod.icon ? icon(mod.icon, 13) : '', h('span', { text: mod.label }));
        b.addEventListener('click', () => this.go(mod.id));
        m.cell(s => s.view.module === mod.id, on => { b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
        picker.append(b);
      }
    }
    const plate = h('div', { class: 'ck-plate' }, h('span', { class: 'ck-plate-mark' }), h('span', { text: this.def.opts.plate || this.name }));
    const strip = h('div', { class: 'ck-modbar' }, plate, picker);
    m.cell(s => !!(s.workspace.hide && (s.workspace.hide.top || s.workspace.hide.all)), v => { strip.hidden = v || this.modules.size < 2; });
    const work = h('main', { class: 'ck-main' });
    root.append(top, strip, work);
    this.chrome.mount(root);
    // the module frame, rebuilt when the module changes
    let modScope = null;
    m.cell(s => s.view.module, id => {
      if (modScope) modScope.scope.dispose();
      modScope = m.child('module:' + id, { module: id, txOpts: this.modules.get(id) && this.modules.get(id).txOpts });
      const mod = this.modules.get(id);
      work.replaceChildren(mod ? this.dock.mountModule(mod, modScope) : h('div', { text: 'No module' }));
      if (mod && mod.onEnter) this.runTarget(mod.onEnter, []);
      root.dataset.module = id;
    });
    // keys
    this.keyRouter = new KeyRouter(this.keymap, {
      moduleIds: () => [...this.modules.keys()],
      chain: e => this.scopeChain(e),
      run: (target, e, b) => { this.lastEvent = e; if (typeof target === 'string') this.runCommand(target, e); else this.runTarget(target, [e]); },
      onSpring: (phase, sp, e, tap) => {
        // a spring is a tool held for as long as the key is down, or a pair of handlers { down, up }
        if (sp.tool && typeof sp.tool === 'object') { const f = phase === 'down' ? sp.tool.down : sp.tool.up; if (f) this.runTarget(f, []); if (phase === 'up' && tap && sp.opts.tap) this.runTarget(sp.opts.tap, []); return; }
        if (phase === 'down') { this.springPrev = this.spring; this.spring = sp.tool; this.emit('spring', sp.tool); }
        else { this.spring = null; this.emit('spring', null); if (tap && sp.opts.tap) this.runTarget(sp.opts.tap, []); }
      },
    });
    window.addEventListener('keydown', e => { if (this.chrome.menus.length && e.key !== 'Escape') return; this.keyRouter.keydown(e); });
    window.addEventListener('keyup', e => this.keyRouter.keyup(e));
    window.addEventListener('blur', () => this.keyRouter.releaseAll());
    root.addEventListener('focusin', e => { const p = e.target.closest && e.target.closest('.ck-panel'); this.focus.panel = p ? p.dataset.panel : null; const v = e.target.closest && e.target.closest('.ck-vp'); if (v) this.focus.canvas = v.dataset.viewport; });
    // persistence
    if (this.def.persist) startAutosave(this);
    // the engine compiles the whole graph once, now that every expression has been recorded
    this.engineReady = ALL_EXPRS.size ? this.engine.compile().then(r => { if (!r.ok) for (const e of r.errors || []) this.diagnostics.error({ code: 'V310', title: 'The engine graph did not compile', at: this.def.at, lines: [e], fix: 'Check the op names in the ck.image(…) chains; the message lists the closest real names.' }); return r; }) : Promise.resolve(null);
    this.scheduler.request();
    return this;
  }
  // an undo on something other than what is on screen says where it happened: .state(init, { channelName: id => … })
  whereOf(e) {
    const name = this.def.stateOpts.channelName, ch = e && e.channel;
    if (!ch || !name) return '';
    const st = this.store.readonly(), cur = this.modules.get(this.store.peek(['view', 'module']));
    const now = this.def.stateOpts.currentChannel ? this.def.stateOpts.currentChannel(st) : cur && cur.txOpts ? (cur.txOpts(st) || {}).channel : null;
    if (ch === now) return '';
    try { const n = name(ch, this.store.readonly()); return n ? ` (on ${n})` : ''; } catch (x) { return ''; }
  }
  // the scopes a menu's shortcut may come from: those that answer in this module without a focused field or panel
  liveScopes() { const tool = this.store.peek(['ui', 'tool']); return ['global', 'module:*', 'module:' + this.store.peek(['view', 'module']), 'canvas'].concat(tool ? ['tool:' + tool] : []); }
  scopeChain(e) {
    const a = document.activeElement;
    const chain = [];
    if (a && a.matches && a.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select,[contenteditable="true"]')) chain.push('text');
    if (this.focus.dialog) { chain.push('dialog'); return chain; }
    const tool = this.store.peek(['ui', 'tool']);
    if (tool) chain.push('tool:' + tool);
    const inPanel = a && a.closest && a.closest('.ck-panel');
    if (inPanel) chain.push('panel:' + inPanel.dataset.panel);
    chain.push('canvas');
    chain.push('module:' + this.store.peek(['view', 'module']));
    chain.push('global');
    return chain;
  }
  defaultMenus() {
    const byMenu = new Map();
    for (const c of this.commands.all()) { const k = c.menu || 'Edit'; if (!byMenu.has(k)) byMenu.set(k, []); byMenu.get(k).push(c.id); }
    return [...byMenu.entries()].map(([label, items]) => ({ label, items }));
  }
  statusbar(el, m) {
    const saved = h('span', { class: 'ck-status-saved' });
    const perf = h('span', { class: 'ck-status-perf', 'data-tip': 'How long the engine took to draw the last picture' });
    el.append(perf, saved);
    this.engine.on((k, d) => { if (k === 'rendered') perf.textContent = `render ${d.ms} ms`; });
    this.on('saved', t => { saved.textContent = t; });
  }
  showDiagnostics() {
    const list = h('div', { class: 'ck-diag' });
    const rows = this.diagnostics.list.slice().sort((a, b) => ({ error: 0, warning: 1, info: 2 }[a.level] - { error: 0, warning: 1, info: 2 }[b.level]));
    for (const d of rows) list.append(h('pre', { class: 'ck-diag-r is-' + d.level, text: d.format() }));
    this.chrome.dialog({ title: `Build report · ${this.diagnostics.summary()}`, wide: true, body: list, buttons: [{ label: 'Close', primary: true }] });
  }
  async save(file) {
    // file: { filename, data: Blob | ArrayBuffer | string }
    try {
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (dl) { await dl.save(file); this.chrome.toast(`Saved ${file.filename}`, { kind: 'ok' }); return true; }
    } catch (e) {
      if (e && e.code === 'declined') { this.chrome.toast('Not saved', { kind: 'info' }); return false; }
    }
    try {
      const blob = file.data instanceof Blob ? file.data : new Blob([file.data]);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      this.chrome.toast(`Saved ${file.filename}`, { kind: 'ok' });
      return true;
    } catch (e) { this.chrome.toast(`Could not save ${file.filename} here`, { kind: 'error' }); return false; }
  }
  // interface gray: auto (follows the system), or 1 (darkest) … 4 (lightest), like Photoshop's four
  applyGray() {
    const apply = v => { const g = v || 'auto'; this.root.dataset.gray = g; };
    if (this.rootMount) this.rootMount.cell(s => s.prefs.gray, apply); else apply(this.store.peek(['prefs', 'gray']));
  }
  cycleGray() { const order = ['auto', '1', '2', '3', '4']; const cur = String(this.store.peek(['prefs', 'gray']) || 'auto'); const next = order[(order.indexOf(cur) + 1) % order.length]; this.store.set(['prefs', 'gray'], next); this.chrome.toast(`Interface gray: ${next === 'auto' ? 'Auto (follows the system)' : GRAYS[next]}`, { kind: 'info' }); }
}

const GRAYS = { auto: 'Auto', 1: 'Darkest', 2: 'Dark', 3: 'Medium Gray', 4: 'Light' };

// ── persistence: the document tier and the workspace, per viewer, in this browser ──
function storageKey(def, part) { return `ck:${def.name}:${def.stateOpts.version || 1}:${part}`; }
function loadSaved(def) {
  try {
    const doc = localStorage.getItem(storageKey(def, 'doc')), view = localStorage.getItem(storageKey(def, 'view'));
    if (!doc && !view) return null;
    return { doc: doc ? JSON.parse(doc) : null, view: view ? JSON.parse(view) : null };
  } catch (e) { return null; }
}
function startAutosave(app) {
  let timer = 0, dirtyDoc = false, dirtyView = false;
  const transient = app.def.stateOpts.transient || [], keepUi = app.def.stateOpts.keepUi || [];
  const flush = () => {
    timer = 0;
    try {
      if (dirtyDoc) { const doc = app.store.snapshot('document'); const filter = app.def.stateOpts.persist; localStorage.setItem(storageKey(app.def, 'doc'), JSON.stringify(filter ? filter(doc) : doc)); }
      if (dirtyView) {
        // the workspace, prefs and the view (module, filters, modes), less what the app calls transient
        const v = app.store.snapshot('view'), view = Object.assign({}, v.view);
        for (const k of transient) delete view[k];
        const ui = {}; for (const k of keepUi) if (v.ui && v.ui[k] !== undefined) ui[k] = v.ui[k];
        localStorage.setItem(storageKey(app.def, 'view'), JSON.stringify({ workspace: v.workspace, prefs: v.prefs, view, ui }));
      }
      if (dirtyDoc) app.emit('saved', 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (e) { app.emit('saved', 'Not saved (storage is off)'); }
    dirtyDoc = dirtyView = false;
  };
  app.store.on((paths, info) => {
    if (info && (info.preview || info.init)) return;
    for (const p of paths) { if (app.store.tierOf(p) === 'document') dirtyDoc = true; else if (p[0] === 'workspace' || p[0] === 'prefs' || (p[0] === 'view' && !transient.includes(p[1])) || (p[0] === 'ui' && keepUi.includes(p[1]))) dirtyView = true; }
    if ((dirtyDoc || dirtyView) && !timer) timer = setTimeout(() => app.scheduler.idle(flush, 'autosave'), 700);
  });
  window.addEventListener('pagehide', flush);
}
export function clearSaved(name, version = 1) { try { for (const k of ['doc', 'view']) localStorage.removeItem(`ck:${name}:${version}:${k}`); } catch (e) { /* storage off */ } }
