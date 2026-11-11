// CraftKit Shell v1 — the public namespace. Apps import { ck } from './shell/index.js'.
//
// Nouns: State · Value · Engine node · Element · Habit · Command · Chord · Tool · Transaction · Place · Token
// Verbs: bind · derive · show · arrange · choose · act · map · handle · change · extend
// Binding times: β build (once) · τ traced (re-runs on what it read) · ρ runtime (handlers, with ctx)
// (v1 implements θ templates as τ per row: a row function is called with the real item.)

import { ShellBuilder, registry, clearSaved } from './shell.js';
import { node, isNode, defineForm, MountCtx, FORMS } from './ui/node.js';
import { engineSource, isExpr } from './core/engine.js';
import { overlay } from './ui/viewport.js';
import { column } from './ui/dock.js';
import { MIXED, parseValue, scrub, nudge, reset, rename, context, focusKeys } from './ui/habits.js';
import { monotone } from './ui/forms/plane.js';
import { h, icon } from './ui/dom.js';
import { site } from './core/diag.js';
import { chordLabel, parseChord } from './core/keys.js';
import './ui/forms/basic.js';
import './ui/forms/container.js';
import './ui/forms/collection.js';
import './ui/forms/plane.js';
import './ui/viewport.js';
import './ui/forms/thumb.js';

const isProps = v => v && typeof v === 'object' && !Array.isArray(v) && !isNode(v) && !(v instanceof Node) && !isExpr(v);
// (props?, ...kids) → node
const box = form => (...args) => { const at = site(); const props = isProps(args[0]) ? args.shift() : {}; return node(form, props, args, at); };
const withLabel = (form, extra) => (label, opts) => { const at = site(); if (isProps(label)) return node(form, Object.assign({}, extra, label), [], at); return node(form, Object.assign({}, extra, { label }, opts || {}), [], at); };

defineForm('dockcol', { slots: { width: 'β', solo: 'β', min: 'β', max: 'β' }, mount(n, m) { const el = h('div', { class: 'ck-col ck-column' }); el.append(...m.mountAll(n.kids.map(k => m.app.resolvePanel(k)))); return el; } });
defineForm('panelref', { slots: { open: 'β' }, mount(n, m) { return m.mount(m.app.resolvePanel(n)); } });
// a tab group of panels in a dock column: one strip of titles, one body at a time (the choice is workspace state)
defineForm('docktabs', {
  slots: { panels: 'β', grow: 'β' },
  mount(n, m) {
    const ids = n.props.panels, path = ['workspace', 'tabs', 'dock:' + ids.join('|')];
    if (m.store.peek(path) === undefined) m.store.writeDoc([{ path, value: ids[0] }], { tier: 'view', init: true });
    const el = h('section', { class: 'ck-docktabs' });
    const strip = h('div', { class: 'ck-docktabs-s', role: 'tablist' });
    const body = h('div', { class: 'ck-docktabs-b' });
    el.append(strip, body);
    const btns = ids.map(id => { const b = h('button', { type: 'button', role: 'tab', class: 'ck-docktab', text: m.app.panelTitle(id) }); b.addEventListener('click', () => m.store.set(path, id)); return b; });
    strip.append(...btns);
    let sub = null;
    m.cell(s => path.reduce((o, k) => (o == null ? o : o[k]), s), cur => {
      const id = ids.includes(cur) ? cur : ids[0];
      btns.forEach((b, i) => { b.classList.toggle('is-on', ids[i] === id); b.setAttribute('aria-selected', ids[i] === id ? 'true' : 'false'); });
      if (sub) sub.scope.dispose();
      sub = m.child('tab:' + id);
      const panel = m.app.resolvePanel(node('panelref', { id }, [], n.at));
      body.replaceChildren(sub.mount(panel));
    });
    return el;
  },
});

export const ck = {
  shell: (name, opts) => new ShellBuilder(name, opts),
  clearSaved,
  MIXED,

  // ── place: panels and containers ──
  panel(id, opts, ...kids) {
    const at = site();
    if (opts === undefined && !kids.length) return node('panelref', { id }, [], at);
    if (!isProps(opts)) { kids.unshift(opts); opts = {}; }
    const n = node('panel', Object.assign({ id }, opts), kids, at);
    registry.panels.set(id, n);
    return n;
  },
  section(title, opts, ...kids) { const at = site(); if (!isProps(opts)) { if (opts !== undefined) kids.unshift(opts); opts = {}; } return node('section', Object.assign({ title }, opts), kids, at); },
  row: box('row'), column: box('column'), stack: box('column'), bar: box('bar'), scroll: box('scroll'),
  grid: (opts, ...kids) => { const at = site(); return node('grid', isProps(opts) ? opts : { cols: opts }, kids, at); },
  cell: box('cell'),
  spacer: size => node('spacer', size ? { size } : {}, [], site()),
  divider: opts => node('divider', opts || {}, [], site()),
  tabs: (tabs, opts) => node('tabs', Object.assign({ tabs }, opts || {}), [], site()),
  toolbar: (items, opts) => node('toolbar', Object.assign({ items }, opts || {}), [], site()),
  statusline: (value, opts) => node('statusline', Object.assign({ value }, opts || {}), [], site()),
  hud: (opts, value) => node('hud', Object.assign({}, opts, { value }), [], site()),
  dock: { column: (props, ...kids) => { const n = column(props, ...kids); n.at = site(); return n; }, tabs: (panels, opts) => node('docktabs', Object.assign({ panels }, opts || {}), [], site()) },

  // ── show: text, glyphs, numbers ──
  text: (value, opts) => node('text', Object.assign({ value }, opts || {}), [], site()),
  label: (value, opts) => node('text', Object.assign({ value }, opts || {}), [], site()),
  icon: (name, opts) => node('glyph', Object.assign({ name }, opts || {}), [], site()),
  stat: (value, opts) => node('stat', Object.assign({ value }, opts || {}), [], site()),
  kbd: chord => node('kbd', { chord }, [], site()),
  keys: chords => node('keys', { chords }, [], site()),
  html: (make, opts) => node('html', Object.assign({ make }, opts || {}), [], site()),

  // ── choose: τ structure ──
  match: (on, cases, opts) => node('match', Object.assign({ on, cases }, opts || {}), [], site()),
  when: (cond, a, b) => (typeof cond === 'function' ? node('when', { cond, then: a, else: b }, [], site()) : cond ? (a === undefined ? true : a) : (b === undefined ? null : b)),
  each: (list, fn) => (list || []).map((x, i) => fn(x, i)),
  pick: (v, map) => (typeof v === 'function' ? s => map[v(s)] : map[v]),
  eq: (a, b) => a === b, gt: (a, b) => a > b, lt: (a, b) => a < b,
  digits: (from, to, cmd) => { const o = {}; for (let d = from; d <= to; d++) o[String(d)] = [cmd, d]; return o; },   // '3' → ['photo.rate', 3]

  // ── widgets (forms + habits) ──
  ui: {
    slider: (min, max, opts) => node('slider', Object.assign({ min, max }, opts || {}), [], site()),
    number: opts => node('number', opts || {}, [], site()),
    textField: opts => node('textField', opts || {}, [], site()),
    search: opts => node('textField', Object.assign({ search: true, commit: 'live' }, opts || {}), [], site()),
    segmented: (options, opts) => node('segmented', Object.assign({ options }, opts || {}), [], site()),
    select: (options, opts) => node('select', Object.assign({ options }, opts || {}), [], site()),
    checkbox: withLabel('checkbox'),
    toggle: withLabel('checkbox', { switch: true }),
    stepper: opts => node('stepper', opts || {}, [], site()),
    color: opts => node('color', opts || {}, [], site()),
    button: (label, opts) => { const at = site(); if (isProps(label)) return node('button', label, [], at); return node('button', Object.assign({ label }, opts || {}), [], at); },
    command: (id, opts) => node('button', Object.assign({ run: id }, opts || {}), [], site()),
    iconButton: (iconName, opts) => node('button', Object.assign({ icon: iconName, quiet: true }, opts || {}), [], site()),
    curve: opts => node('curve', opts || {}, [], site()),
    wheel: opts => node('wheel', opts || {}, [], site()),
  },
  view: {
    list: (items, opts) => node('listview', Object.assign({ items }, opts || {}), [], site()),
    grid: (items, opts) => node('gridview', Object.assign({ items }, opts || {}), [], site()),
    filmstrip: (items, opts) => node('filmstrip', Object.assign({ items }, opts || {}), [], site()),
    tree: (items, opts) => node('treeview', Object.assign({ items }, opts || {}), [], site()),
    histogram: (data, opts) => node('histogram', Object.assign({ data }, opts || {}), [], site()),
    thumb: opts => node('thumb', opts || {}, [], site()),
  },
  viewport: (image, opts) => node('viewport', Object.assign({ image }, opts || {}), [], site()),
  overlay,

  // ── engine values: recorded chains, compiled once ──
  image: (src, opts) => engineSource('image', opts === undefined ? [src] : [src, opts]),
  solid: (color, size) => engineSource('solid', size ? [color, size] : [color]),
  gradient: (stops, opts) => engineSource('gradient', opts ? [stops, opts] : [stops]),
  source: (op, ...args) => engineSource(op, args),
  isEngine: isExpr,

  // ── extend: define forms and habits ──
  define: defineForm,
  node,
  habit: { scrub, nudge, reset, rename, context, focusKeys, parseValue },
  util: { monotone, h, icon },
  // a chord as this platform writes it: ck.keyLabel('Mod+Shift+C') → ⇧⌘C on a Mac, Ctrl+Shift+C elsewhere
  keyLabel: chord => chordLabel(parseChord(chord)),
  FORMS,
};
export default ck;
