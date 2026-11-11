// The dock: fixed columns around a centre. Left and right columns hold panels (collapsible, solo, resizable);
// the bottom holds a strip (the filmstrip); the top an options bar. Each module has its own arrangement and its
// own saved sizes — a workspace — kept in the view tier (workspace.layout[module]) so it survives a reload and is
// never undone. Tab hides the side columns, Shift+Tab everything; F5–F8 toggle one side each (Lightroom's keys).

import { h, icon, listen, drag } from './dom.js';
import { isNode, node } from './node.js';
import { clamp } from '../core/util.js';

export const SIDES = ['left', 'right', 'bottom', 'top'];

export class Dock {
  constructor(app) { this.app = app; this.el = null; this.cols = {}; this.current = null; this.defaults = new Map(); }
  layoutPath(mod, side) { return ['workspace', 'layout', mod, side]; }
  get(mod, side) { const st = this.app.store.peek(this.layoutPath(mod, side)) || {}; return st; }
  setSide(mod, side, patch) { const path = this.layoutPath(mod, side); this.app.store.set(path, Object.assign({}, this.app.store.peek(path) || {}, patch)); }

  // build the frame for a module: returns the element; the app swaps it when the module changes
  mountModule(mod, m) {
    const el = h('div', { class: 'ck-work', 'data-module': mod.id });
    const L = mod.regions;
    const mk = (side, content) => {
      if (!content) return null;
      const col = h('div', { class: ['ck-side', 'ck-side-' + side] });
      const inner = h('div', { class: 'ck-side-in' });
      const sm = m.child('side:' + side, { side });
      const spec = content.$ === 'dockcol' ? content : null;
      const kids = spec ? spec.kids : [].concat(content);
      if (spec && spec.props.solo !== undefined) {
        const soloPath = ['workspace', 'solo', mod.id + ':' + side];
        if (this.app.store.peek(soloPath) === undefined) this.app.store.writeDoc([{ path: soloPath, value: typeof spec.props.solo === 'boolean' ? spec.props.solo : false }], { tier: 'view', init: true });
        sm.cell(s => s.workspace && s.workspace.solo && s.workspace.solo[mod.id + ':' + side], v => inner.classList.toggle('is-solo', !!v));
        inner.dataset.soloKey = mod.id + ':' + side;
      }
      inner.classList.add('ck-column');
      for (const k of kids) {
        const n = this.app.resolvePanel(k);
        const child = sm.mount(n);
        if (child) inner.append(child);
      }
      col.append(inner);
      const def = spec && spec.props.width || (side === 'bottom' ? 96 : side === 'top' ? 40 : 260);
      // the edge toggle (Lightroom's little triangles at the window edges)
      const edge = h('button', { type: 'button', class: ['ck-edge', 'ck-edge-' + side], 'aria-label': `Show or hide the ${side} panels`, 'data-tip': `${side[0].toUpperCase() + side.slice(1)} panels (${{ left: 'F7', right: 'F8', bottom: 'F6', top: 'F5' }[side]})` }, icon(side === 'left' ? 'left' : side === 'right' ? 'right' : side === 'bottom' ? 'down' : 'up', 9));
      listen(sm.scope, edge, 'click', () => this.toggle(side));
      // splitter
      let split = null;
      if (side === 'left' || side === 'right' || side === 'bottom') {
        split = h('div', { class: ['ck-split', 'ck-split-' + side], role: 'separator', 'aria-orientation': side === 'bottom' ? 'horizontal' : 'vertical', tabindex: '-1' });
        listen(sm.scope, split, 'pointerdown', e => {
          e.preventDefault();
          const cur = this.get(mod.id, side).size || def;
          const x0 = e.clientX, y0 = e.clientY;
          const min = spec && spec.props.min || (side === 'bottom' ? 48 : 180), max = spec && spec.props.max || (side === 'bottom' ? 260 : 520);
          drag(e, {
            cursor: side === 'bottom' ? 'ns-resize' : 'ew-resize',
            move: ev => { const d = side === 'left' ? ev.clientX - x0 : side === 'right' ? x0 - ev.clientX : y0 - ev.clientY; this.setSide(mod.id, side, { size: Math.round(clamp(cur + d, min, max)) }); },
          });
        });
        listen(sm.scope, split, 'dblclick', () => this.setSide(mod.id, side, { size: def }));
      }
      sm.cell(s => { const w = s.workspace && s.workspace.layout && s.workspace.layout[mod.id] && s.workspace.layout[mod.id][side]; const g = s.workspace && s.workspace.hide; return { size: (w && w.size) || def, hidden: !!(w && w.hidden) || !!(g && (g.all || (g.sides && side !== 'top' && side !== 'bottom'))) }; }, v => {
        if (side === 'bottom' || side === 'top') col.style.height = v.size + 'px'; else col.style.width = v.size + 'px';
        col.hidden = v.hidden; if (split) split.hidden = v.hidden;
        edge.classList.toggle('is-closed', v.hidden);
      }, { equals: (a, b) => a && b && a.size === b.size && a.hidden === b.hidden });
      return { col, split, edge };
    };
    const left = mk('left', L.left), right = mk('right', L.right), bottom = mk('bottom', L.bottom), top = mk('top', L.top);
    const center = h('div', { class: 'ck-center' });
    const cm = m.child('center');
    if (L.top && !top) center.append(cm.mount(L.top));
    if (top) center.append(top.col);
    const main = h('div', { class: 'ck-center-main' });
    if (L.center) main.append(cm.mount(L.center));
    center.append(main);
    if (L.toolbar) {
      const tb = h('div', { class: 'ck-center-tb' });
      tb.append(cm.mount(L.toolbar));
      cm.cell(s => !!(s.workspace && s.workspace.hide && s.workspace.hide.toolbar), v => { tb.hidden = v; });
      center.append(tb);
    }
    const row = h('div', { class: 'ck-work-row' });
    if (left) row.append(left.edge, left.col, left.split);
    row.append(center);
    if (right) row.append(right.split, right.col, right.edge);
    el.append(row);
    if (bottom) el.append(bottom.split, bottom.col, bottom.edge);
    this.current = { mod, el, left, right, bottom, top };
    return el;
  }

  toggle(side) {
    const mod = this.app.store.peek(['view', 'module']);
    const g = this.app.store.peek(['workspace', 'hide']) || {};
    if (g.all || g.sides) {
      // everything was hidden (Tab, or a phone): show only the side asked for
      this.app.store.set(['workspace', 'hide'], {});
      for (const s of ['left', 'right'].concat(g.all ? ['bottom'] : [])) this.setSide(mod, s, { hidden: s !== side });
      if (side === 'bottom' || side === 'top') this.setSide(mod, side, { hidden: false });
      return;
    }
    const cur = this.get(mod, side);
    this.setSide(mod, side, { hidden: !cur.hidden });
  }
  // Tab: the side columns; Shift+Tab: everything but the centre
  hideSides() { const g = this.app.store.peek(['workspace', 'hide']) || {}; this.app.store.set(['workspace', 'hide'], g.sides ? {} : { sides: true }); }
  hideAll() { const g = this.app.store.peek(['workspace', 'hide']) || {}; this.app.store.set(['workspace', 'hide'], g.all ? {} : { all: true, toolbar: true }); }
  toggleToolbar() { const g = this.app.store.peek(['workspace', 'hide']) || {}; this.app.store.set(['workspace', 'hide'], Object.assign({}, g, { toolbar: !g.toolbar })); }

  // solo: open this panel, close the others in its column
  solo(id, el) {
    const col = el && el.closest('.ck-column'); if (!col) return;
    const ids = [...col.querySelectorAll(':scope > .ck-panel:not(.is-fixed)')].map(p => p.dataset.panel);
    const st = this.app.store;
    const key = col.dataset.soloKey;
    const panels = Object.assign({}, st.peek(['workspace', 'panels']) || {});
    for (const pid of ids) panels[pid] = Object.assign({}, panels[pid] || {}, { open: pid === id });
    st.set(['workspace', 'panels'], panels);
    if (key && !col.classList.contains('is-solo') && el && el.dataset) { /* an Alt-click opens solo once without turning the mode on */ }
  }
  toggleSolo(side) {
    const mod = this.app.store.peek(['view', 'module']);
    const key = mod + ':' + side;
    this.app.store.set(['workspace', 'solo', key], !this.app.store.peek(['workspace', 'solo', key]));
  }
  reveal(id) {
    const el = this.app.root.querySelector(`.ck-panel[data-panel="${CSS.escape(id)}"]`);
    if (!el) { this.app.chrome.toast(`The ${this.app.panelTitle(id)} panel is not in this module`, { kind: 'info' }); return; }
    const side = el.closest('.ck-side');
    const mod = this.app.store.peek(['view', 'module']);
    if (side) for (const s of SIDES) if (side.classList.contains('ck-side-' + s)) this.setSide(mod, s, { hidden: false });
    this.app.store.set(['workspace', 'hide'], {});
    this.app.store.set(['workspace', 'panels', id, 'open'], true);
    requestAnimationFrame(() => { el.scrollIntoView({ block: 'nearest' }); const f = el.querySelector('[tabindex="0"],input,button'); f && f.focus(); el.classList.add('is-flash'); setTimeout(() => el.classList.remove('is-flash'), 700); });
  }
  reset(modId) {
    const st = this.app.store;
    const layout = Object.assign({}, st.peek(['workspace', 'layout']) || {}); delete layout[modId];
    st.set(['workspace', 'layout'], layout);
    st.set(['workspace', 'hide'], {});
    const panels = Object.assign({}, st.peek(['workspace', 'panels']) || {});
    for (const el of this.app.root.querySelectorAll('.ck-panel[data-panel]')) { const id = el.dataset.panel; panels[id] = { open: this.defaults.has(id) ? this.defaults.get(id) : true }; }
    st.set(['workspace', 'panels'], panels);
    this.app.chrome.toast('Workspace reset', { kind: 'info' });
  }
}

// a column of panels: ck.dock.column({ width, solo, min, max }, …panels)
export const column = (props, ...kids) => node('dockcol', props || {}, kids);
