// Elements as IR. ck.ui.slider(…), ck.panel(…), ck.row(…) do not touch the DOM: they return plain nodes
// { $: form, props, kids, at } — the structure, recorded with the call site that made it. The shell walks the tree
// at build (checking bindings, options and binding times), and mounts it later. Mounting turns τ props into cells
// and ρ props into handlers; β props were consumed when the node was made.
//
// Every form declares its slots and their binding times:
//   β  read once while the program builds (min, max, label text, a list of sections)
//   τ  a traced lambda of state, re-evaluated when what it read changes (disabled, label, a readout)
//   ρ  a runtime handler: (…, ctx) => …, may change state only through ctx.tx / ctx.preview → ctx.commit
//   bind  a τ lambda naming one state path (s => s.develop.light.exposure); two-way
//   θ  a per-item function, called with the real item when its row is drawn (row, cell, key, children)
//   ƒ  a pure helper of the form's own value (format: v => v.toFixed(1)) or a mount function
// Passing a lambda to a β slot is an error (CK-B140): it would run once and never again.

import { site } from '../core/diag.js';
import { Cell } from '../core/cells.js';
import { bindingPath } from '../core/track.js';
import { suggest, pathStr, isObj } from '../core/util.js';
import { isExpr } from '../core/engine.js';

const NODE = Symbol('ck.node');
export const isNode = v => !!(v && v[NODE]);
export const FORMS = new Map();

const COMMON = { id: 'β', class: 'β', tip: 'τ', hidden: 'τ', disabled: 'τ', why: 'τ', keys: 'β', grow: 'β', style: 'β', label: 'τ', key: 'β', at: 'β', width: 'β', height: 'β', help: 'β', data: 'β', lazy: 'β' };

// define a form: name, { slots, mount(node, mctx) → Element }
export function defineForm(name, def) { FORMS.set(name, Object.assign({ name, slots: {} }, def)); return name; }

export function node(form, props = {}, kids = [], at = null) {
  const n = { [NODE]: true, $: form, props: props || {}, kids: flatKids(kids), at: at || site(), diags: [] };
  const def = FORMS.get(form);
  if (def) checkSlots(n, def);
  return n;
}
export function flatKids(kids) {
  const out = [];
  for (const k of [].concat(kids)) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) out.push(...flatKids(k));
    else out.push(k);
  }
  return out;
}

function checkSlots(n, def) {
  const slots = Object.assign({}, COMMON, def.slots);
  for (const [k, v] of Object.entries(n.props)) {
    const t = slots[k];
    if (!t) {
      if (def.open) continue;   // forms that pass options through (engine views)
      const s = suggest(k, Object.keys(slots));
      n.diags.push({ level: 'warning', code: 'B130', title: `Unknown option '${k}' for ${def.name}`, at: n.at, lines: [`${def.name} takes: ${Object.keys(def.slots).join(', ')}`], fix: s.length ? `Did you mean '${s[0]}'?` : 'Remove it, or check the form’s options in the reference.' });
      continue;
    }
    if (t === 'β' && typeof v === 'function' && !v.isCommand && !isExpr(v)) {
      n.diags.push({ level: 'error', code: 'B140', title: `A lambda in a build-time option: ${def.name}.${k}`, at: n.at, lines: [`'${k}' is read once while the program builds (β); a lambda here would run once and never again.`], fix: `Pass a value. If it should follow state, the form needs a τ slot for it; ${Object.entries(slots).filter(([, b]) => b === 'τ').map(([x]) => x).slice(0, 6).join(', ')} are τ.` });
    }
    if (t === 'bind' && v != null && typeof v !== 'function' && typeof v !== 'string') {
      n.diags.push({ level: 'error', code: 'B141', title: `${def.name}.bind needs a lambda naming a path`, at: n.at, lines: [`got ${typeof v}`], fix: 'bind: s => s.develop.light.exposure' });
    }
  }
}

// ── walking a tree (the build does this) ───────────────────────────────────
export function walk(n, f, depth = 0) {
  if (!isNode(n) || depth > 200) return;
  f(n, depth);
  for (const k of n.kids) walk(k, f, depth + 1);
  // nodes inside props (ck.match cases, a viewport's overlays…)
  for (const v of Object.values(n.props)) {
    if (isNode(v)) walk(v, f, depth + 1);
    else if (Array.isArray(v)) v.forEach(x => isNode(x) && walk(x, f, depth + 1));
    else if (isObj(v) && !v.$ && Object.getPrototypeOf(v) === Object.prototype) for (const x of Object.values(v)) if (isNode(x)) walk(x, f, depth + 1);
  }
}

// ── mounting ───────────────────────────────────────────────────────────────
export class MountCtx {
  constructor(app, scope, env = {}) { this.app = app; this.scope = scope; this.env = env; }
  get store() { return this.app.store; }
  child(name, env) { return new MountCtx(this.app, this.scope.child(name), Object.assign({}, this.env, env || {})); }
  with(env) { return new MountCtx(this.app, this.scope, Object.assign({}, this.env, env)); }
  cell(fn, effect, opts = {}) { return this.scope.add(new Cell(this.store, fn, effect, Object.assign({ onError: (e, c) => this.app.lambdaError(e, c) }, opts))); }
  // a τ prop or a constant: effect(value) now and whenever it changes
  val(v, effect, opts) {
    if (typeof v === 'function' && !v.isCommand) return this.cell(v, effect, opts);
    effect(v); return null;
  }
  binding(fn, at, opts = {}) { return new Binding(this, fn, at, opts); }
  mount(n) {
    if (n == null || n === false) return null;
    if (n instanceof Node) return n;
    if (typeof n === 'string' || typeof n === 'number') return document.createTextNode(String(n));
    if (!isNode(n)) { console.warn('[ck] not an element:', n); return document.createTextNode(''); }
    const def = FORMS.get(n.$);
    if (!def) { console.warn('[ck] no form', n.$); return document.createTextNode(''); }
    const el = def.mount(n, this);
    if (el && el.nodeType === 1) decorate(el, n, this);
    return el;
  }
  mountAll(kids) { return kids.map(k => this.mount(k)).filter(Boolean); }
  run(target, ...args) { return this.app.runTarget(target, args, this); }
  rctx(extra) { return this.app.ctx(Object.assign({ env: this.env }, extra)); }
}

// common props every element understands
function decorate(el, n, m) {
  const p = n.props;
  if (p.class) el.classList.add(...String(p.class).split(/\s+/).filter(Boolean));
  if (p.id && !el.id) el.dataset.ckId = p.id;
  if (p.grow) el.style.flex = String(p.grow === true ? 1 : p.grow);
  if (p.style) Object.assign(el.style, p.style);
  if (p.width) el.style.width = typeof p.width === 'number' ? p.width + 'px' : p.width;
  if (p.height) el.style.height = typeof p.height === 'number' ? p.height + 'px' : p.height;
  if (p.hidden !== undefined) m.val(p.hidden, v => { el.hidden = !!v; });
  if (p.tip !== undefined && !el.dataset.ownTip) m.val(p.tip, v => { if (v) el.dataset.tip = v; else delete el.dataset.tip; });
  if (p.disabled !== undefined && !el.dataset.ownDisabled) m.val(p.disabled, v => setDisabled(el, !!v, p.why, m));
}
export function setDisabled(el, off, why, m) {
  el.classList.toggle('is-disabled', off);
  el.setAttribute('aria-disabled', off ? 'true' : 'false');
  for (const x of el.querySelectorAll('input,button,select,textarea')) x.disabled = off;
  if (off && why) {
    if (typeof why === 'function') { try { el.dataset.why = why(m.store.readonly()); } catch (e) { el.dataset.why = ''; } } else el.dataset.why = why;
  } else delete el.dataset.why;
}

// ── two-way bindings ───────────────────────────────────────────────────────
// A binding names one path. Reading goes through a cell; writing is a preview during a gesture and one
// transaction when it ends (commit: 'end'), or a transaction per change (commit: 'live').
export class Binding {
  constructor(m, fn, at, opts) {
    this.m = m; this.at = at; this.opts = opts;
    if (typeof fn === 'string') { const fixed = fn.split('.').map(k => (/^\d+$/.test(k) ? +k : k)); this.fixed = fixed; this.fn = s => fixed.reduce((o, k) => (o == null ? o : o[k]), s); }
    else this.fn = fn;
    this.label = opts.label || '';
  }
  // the path is resolved when it is used: a binding like s => s.dev[s.ui.selection.primary].light.exposure
  // follows the selection; within one gesture it does not move
  get path() { if (this.fixed) return this.fixed; if (this.gesturePath) return this.gesturePath; return bindingPath(this.m.store, this.fn).path; }
  watch(effect) { return this.m.cell(this.fn, effect, { at: this.at, name: 'bind' }); }
  get() { const p = this.path; return p ? this.m.store.peek(p) : undefined; }
  txOpts(extra) {
    const env = this.m.env, st = this.m.store.readonly();
    const base = typeof env.txOpts === 'function' ? env.txOpts(st, this.path) : env.txOpts || {};
    return Object.assign({}, base, extra || {});
  }
  // an edit that outlives the selection (a text field being typed in) holds on to the path it started on
  pin() { this.gesturePath = null; this.gesturePath = this.path; }
  unpin() { this.gesturePath = null; }
  preview(v) { const p = this.gesturePath || (this.gesturePath = this.path); if (!p) return; this.m.store.preview(p, v); }
  commit(label, extra) { const r = this.m.store.commit(label || this.label || 'Change', this.txOpts(extra)); this.gesturePath = null; return r; }
  cancel() { this.m.store.cancel(); this.gesturePath = null; }
  set(v, label, extra) {
    const path = this.path;
    if (!path) return;
    const st = this.m.store;
    if (st.tierOf(path) === 'view') { st.set(path, v); return; }
    st.tx(label || this.label || 'Change', t => t.$set(path, v), this.txOpts(extra));
  }
  get name() { const p = this.path; return p ? pathStr(p) : '?'; }
}
