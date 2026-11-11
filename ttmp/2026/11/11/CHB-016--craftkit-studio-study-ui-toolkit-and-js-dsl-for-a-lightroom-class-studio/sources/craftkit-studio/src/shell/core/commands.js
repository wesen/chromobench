// The command table: one place that says what the app can do. Menus, context menus, toolbars, the command palette,
// key maps and the shortcut sheet are all views of it, so a label, a disabled state and its reason are written once.
//
// spec: { label: 'Undo' | s => …τ, keys: 'Mod+Z' | ['Mod+Z', …], scope: 'global', enabled: s => …τ, why: '…' | s => …τ,
//         checked: s => …τ, run: ctx => …ρ | 'other.command', icon, group, palette: true, hidden: false | s => …τ,
//         module: 'develop' | ['develop', 'library'] }

import { site } from './diag.js';
import { suggest } from './util.js';

export class Commands {
  constructor() { this.map = new Map(); this.groups = new Map(); this.recent = []; }
  add(id, spec = {}) {
    const at = spec.at || site();
    if (typeof spec === 'function') spec = { run: spec };
    const prev = this.map.get(id);
    this.map.set(id, Object.assign({ id, at, scope: 'global', palette: true }, prev && spec.extend ? prev : {}, spec, { at }));
    if (spec.group) (this.groups.get(spec.group) || this.groups.set(spec.group, []).get(spec.group)).push(id);
    return this;
  }
  has(id) { return this.map.has(id); }
  get(id) { return this.map.get(id); }
  all() { return [...this.map.values()]; }
  ids() { return [...this.map.keys()]; }
  suggest(id) { return suggest(id, this.ids()); }

  // hidden: the command's own hidden, or module: 'id' | ['id', …] while another module is current
  // (a module's commands live in the shared menus but show only where they apply, as Lightroom's menus change per module)
  hidden(id, state) {
    const c = this.map.get(id); if (!c) return false;
    if (c.module && state && state.view && ![].concat(c.module).includes(state.view.module)) return true;
    try { return typeof c.hidden === 'function' ? !!c.hidden(state) : !!c.hidden; } catch (e) { return false; }
  }

  label(id, state) {
    const c = this.map.get(id); if (!c) return id;
    try { return typeof c.label === 'function' ? c.label(state) : c.label || id; } catch (e) { return c.id; }
  }
  // { ok, why }: enabled reads state (τ) and may name its reason; a disabled item shows why instead of nothing
  status(id, state) {
    const c = this.map.get(id); if (!c) return { ok: false, why: `No command '${id}'` };
    let ok = true;
    try { ok = c.enabled === undefined ? true : typeof c.enabled === 'function' ? !!c.enabled(state) : !!c.enabled; } catch (e) { ok = false; }
    if (ok) return { ok: true };
    let why = '';
    try { why = typeof c.why === 'function' ? c.why(state) : c.why || ''; } catch (e) { why = ''; }
    return { ok: false, why: why || 'Not available right now' };
  }
  checked(id, state) {
    const c = this.map.get(id); if (!c || c.checked === undefined) return undefined;
    try { return typeof c.checked === 'function' ? !!c.checked(state) : !!c.checked; } catch (e) { return false; }
  }
  // run through the app context; a string run is an alias to another command
  run(id, ctx, ...args) {
    const c = this.map.get(id);
    if (!c) throw new Error(`No command '${id}'${this.suggest(id).length ? ` (did you mean ${this.suggest(id).join(', ')}?)` : ''}`);
    const st = this.status(id, ctx.state);
    if (!st.ok) { ctx.toast && ctx.toast(st.why, { kind: 'why', title: this.label(id, ctx.state) }); return false; }
    this.recent = [id].concat(this.recent.filter(x => x !== id)).slice(0, 30);
    if (typeof c.run === 'string') return this.run(c.run, ctx, ...args);
    if (typeof c.run === 'function') return c.run(ctx, ...args);
    return undefined;
  }
}
