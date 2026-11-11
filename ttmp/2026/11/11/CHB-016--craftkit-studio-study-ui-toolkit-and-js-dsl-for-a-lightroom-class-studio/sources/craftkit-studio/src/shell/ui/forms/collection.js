// Collections: list, grid, filmstrip, tree. Virtualised (only visible rows exist), keyed, selectable.
//
// items: τ (s => s.catalog.filtered). row/cell: a per-item template, called with the real item; a row is
// re-mounted only when its item changes identity (state is immutable, so unchanged items keep theirs).
// select: { bind: s => s.ui.selection, mode: 'single' | 'multi' } — the value is { ids, primary, anchor }.
// keys: chords → commands, run while the collection has focus; advance: τ moves on after a key command.

import { defineForm, setDisabled } from '../node.js';
import { h, icon, listen, clear } from '../dom.js';
import { bindingPath } from '../../core/track.js';
import { chordFromEvent, parseChord } from '../../core/keys.js';
import { isMac } from '../../core/util.js';

const SLOTS = { items: 'τ', row: 'θ', cell: 'θ', key: 'θ', select: 'β', activate: 'ρ', keys: 'β', context: 'τ', dnd: 'β', empty: 'τ', size: 'τ', rowHeight: 'β', advance: 'τ', children: 'θ', gap: 'β', aspect: 'β', onSelect: 'ρ', focusOnMount: 'β', caption: 'β', counts: 'β', layout: 'β' };

function makeSelection(m, n, kind) {
  const p = n.props, sel = p.select || {};
  const path = sel.bind ? bindingPath(m.store, sel.bind).path : ['workspace', 'selection', p.id || n.at.file + ':' + n.at.line];
  if (m.store.peek(path) === undefined) m.store.writeDoc([{ path, value: { ids: [], primary: null, anchor: null } }], { tier: 'view', init: true });
  const get = () => m.store.peek(path) || { ids: [], primary: null, anchor: null };
  const set = v => { if (m.store.tierOf(path) === 'view') m.store.set(path, v); else m.store.tx('Select', t => t.$set(path, v)); if (p.onSelect) m.run(p.onSelect, v); };
  return { path, get, set, mode: sel.mode || 'multi', none: sel.mode === 'none' };
}

function collection(kind) {
  return (n, m) => {
    const p = n.props, app = m.app;
    const keyOf = p.key || (it => (it && it.id != null ? it.id : it));
    const sel = makeSelection(m, n, kind);
    const collId = 'coll' + Math.random().toString(36).slice(2, 8);
    const isGrid = kind === 'grid' || kind === 'filmstrip';
    const horizontal = kind === 'filmstrip' || p.layout === 'horizontal';
    const el = h('div', { class: ['ck-coll', 'ck-' + { list: 'listview', grid: 'gridview', tree: 'treeview', filmstrip: 'filmstrip' }[kind]], tabindex: '0', role: isGrid ? 'grid' : kind === 'tree' ? 'tree' : 'listbox', 'aria-multiselectable': sel.mode === 'multi' ? 'true' : 'false' });
    const inner = h('div', { class: 'ck-coll-in' });
    const empty = h('div', { class: 'ck-coll-empty' });
    el.append(inner, empty);
    let items = [], ids = [], index = new Map();
    let size = 140, rowH = p.rowHeight || 24, gap = p.gap != null ? p.gap : isGrid ? 6 : 0;
    const rows = new Map();           // key → { el, item, scope }
    let open = new Set();             // tree: open node keys
    let flat = [];                    // tree: [{ item, depth, hasKids }]

    const layout = () => {
      const W = el.clientWidth || 300, H = el.clientHeight || 300;
      if (kind === 'filmstrip') { const s = Math.max(30, (H || 80) - 10); return { cols: Infinity, cw: s * (p.aspect || 1.35), ch: s, W, H }; }
      if (isGrid) { const cw = size, ch = size * (p.aspect ? 1 / p.aspect : 1) + (p.caption ? 18 : 0); const cols = Math.max(1, Math.floor((W - gap) / (cw + gap))); return { cols, cw: (W - gap) / cols - gap, ch: ((W - gap) / cols - gap) * (ch / cw), W, H }; }
      return { cols: 1, cw: W, ch: rowH, W, H };
    };
    const list = () => (kind === 'tree' ? flat.map(f => f.item) : items);

    function rebuildTree() {
      flat = [];
      const walkT = (arr, d) => { for (const it of arr || []) { const kids = p.children ? p.children(it) : null; flat.push({ item: it, depth: d, hasKids: !!(kids && kids.length) }); if (kids && kids.length && open.has(keyOf(it))) walkT(kids, d + 1); } };
      walkT(items, 0);
    }
    function setItems(v) {
      items = Array.isArray(v) ? v : [];
      if (kind === 'tree') rebuildTree();
      const L = list();
      ids = L.map(keyOf); index = new Map(ids.map((k, i) => [k, i]));
      empty.hidden = L.length > 0;
      draw(true);
    }
    let drawQueued = false;
    function draw(force) {
      const L = list();
      const lay = layout();
      const n = L.length;
      let total, first, last;
      if (horizontal) {
        total = n * (lay.cw + gap) + gap; inner.style.width = total + 'px'; inner.style.height = '100%';
        const x0 = el.scrollLeft, x1 = x0 + lay.W;
        first = Math.max(0, Math.floor(x0 / (lay.cw + gap)) - 3); last = Math.min(n - 1, Math.ceil(x1 / (lay.cw + gap)) + 3);
      } else {
        const nrows = Math.ceil(n / lay.cols);
        total = nrows * (lay.ch + gap) + gap; inner.style.height = total + 'px'; inner.style.width = '';
        const y0 = el.scrollTop, y1 = y0 + lay.H;
        const r0 = Math.max(0, Math.floor(y0 / (lay.ch + gap)) - 2), r1 = Math.ceil(y1 / (lay.ch + gap)) + 2;
        first = r0 * lay.cols; last = Math.min(n - 1, r1 * lay.cols + lay.cols - 1);
      }
      const keep = new Set();
      for (let i = first; i <= last; i++) {
        const it = L[i], k = keyOf(it); keep.add(k);
        let r = rows.get(k);
        // a row is redrawn when its item changes identity or its position does (templates may show the index)
        if (r && (r.item !== it || r.i0 !== i || force === 'all')) { r.scope.dispose(); r.el.remove(); rows.delete(k); r = null; }
        if (!r) { r = mountRow(it, i, k); r.i0 = i; rows.set(k, r); inner.appendChild(r.el); }
        r.i = i;
        const x = horizontal ? gap + i * (lay.cw + gap) : isGrid ? gap + (i % lay.cols) * (lay.cw + gap) : 0;
        const y = horizontal ? 5 : gap + Math.floor(i / lay.cols) * (lay.ch + gap);
        r.el.style.transform = `translate(${x}px, ${y}px)`;
        r.el.style.width = (isGrid ? lay.cw : lay.W) + 'px'; r.el.style.height = lay.ch + 'px';
        if (kind === 'tree') r.el.style.paddingLeft = (6 + flat[i].depth * 14) + 'px';
      }
      for (const [k, r] of rows) if (!keep.has(k)) { r.scope.dispose(); r.el.remove(); rows.delete(k); }
      paintSelection();
    }
    const queueDraw = () => { if (drawQueued) return; drawQueued = true; requestAnimationFrame(() => { drawQueued = false; draw(false); }); };

    function mountRow(it, i, k) {
      const rm = m.child('row', { item: it });
      const rel = h('div', { class: isGrid ? 'ck-coll-cell' : 'ck-coll-row', role: isGrid ? 'gridcell' : kind === 'tree' ? 'treeitem' : 'option', 'data-key': String(k) });
      if (kind === 'tree') {
        const f = flat[i];
        const tw = h('span', { class: 'ck-tree-tw' }, f && f.hasKids ? icon(open.has(k) ? 'chevd' : 'chevr', 9) : '');
        listen(rm.scope, tw, 'click', e => { e.stopPropagation(); if (open.has(k)) open.delete(k); else open.add(k); rebuildTree(); ids = flat.map(x => keyOf(x.item)); index = new Map(ids.map((kk, ii) => [kk, ii])); draw(); });
        rel.append(tw);
      }
      const tpl = p.row || p.cell;
      const content = tpl ? rm.mount(tpl(it, i)) : h('span', { text: String(it && (it.name || it.label || it.id) || it) });
      rel.append(content);
      // drag and drop: a source makes rows draggable; reorder moves them within this collection (a line shows
      // where they land); drop takes things dragged in from elsewhere onto a row
      if (p.dnd && (p.dnd.source || p.dnd.reorder)) {
        rel.draggable = true;
        listen(rm.scope, rel, 'dragstart', e => {
          const s = sel.get();
          const keys = s.ids.includes(k) ? s.ids : [k];
          const src = p.dnd.source ? (typeof p.dnd.source === 'function' ? p.dnd.source(it) : { kind: p.dnd.source, id: k }) : { kind: 'item', id: k };
          const payload = Object.assign({}, src, { ids: keys, from: collId });
          e.dataTransfer.setData('application/x-ck', JSON.stringify(payload));
          e.dataTransfer.effectAllowed = 'copyMove';
          app.dragging = payload;
          el.classList.add('is-dragging');
        });
        listen(rm.scope, rel, 'dragend', () => { app.dragging = null; el.classList.remove('is-dragging'); });
      }
      if (p.dnd && (p.dnd.drop || p.dnd.reorder)) {
        const side = e => { const r = rel.getBoundingClientRect(); return horizontal || isGrid ? (e.clientX < r.left + r.width / 2 ? 'before' : 'after') : (e.clientY < r.top + r.height / 2 ? 'before' : 'after'); };
        const clear = () => rel.classList.remove('is-drop', 'is-drop-before', 'is-drop-after');
        listen(rm.scope, rel, 'dragover', e => {
          const d = app.dragging; if (!d) return;
          if (p.dnd.reorder && d.from === collId) { e.preventDefault(); clear(); rel.classList.add('is-drop-' + side(e)); return; }
          if (!p.dnd.drop || (p.dnd.accepts && !(typeof p.dnd.accepts === 'function' ? p.dnd.accepts(d, it) : [].concat(p.dnd.accepts).includes(d.kind)))) return;
          e.preventDefault(); clear(); rel.classList.add('is-drop');
        });
        listen(rm.scope, rel, 'dragleave', clear);
        listen(rm.scope, rel, 'drop', e => {
          clear();
          const d = app.dragging; if (!d) return;
          e.preventDefault();
          if (p.dnd.reorder && d.from === collId) { const i0 = index.get(k); const to = side(e) === 'after' ? i0 + 1 : i0; m.run(p.dnd.reorder, d.ids, to, e); return; }
          m.run(p.dnd.drop, d, it, e);
        });
      }
      return { el: rel, item: it, scope: rm.scope, i };
    }

    function paintSelection() {
      const s = sel.get(); const on = new Set(s.ids);
      for (const [k, r] of rows) {
        const isOn = on.has(k);
        r.el.classList.toggle('is-sel', isOn);
        r.el.classList.toggle('is-primary', s.primary === k);
        r.el.setAttribute('aria-selected', isOn ? 'true' : 'false');
      }
    }
    function scrollTo(i) {
      const lay = layout();
      if (horizontal) { const x = gap + i * (lay.cw + gap); if (x < el.scrollLeft) el.scrollLeft = x - gap; else if (x + lay.cw > el.scrollLeft + lay.W) el.scrollLeft = x + lay.cw - lay.W + gap; return; }
      const y = gap + Math.floor(i / lay.cols) * (lay.ch + gap);
      if (y < el.scrollTop) el.scrollTop = y - gap; else if (y + lay.ch > el.scrollTop + lay.H) el.scrollTop = y + lay.ch - lay.H + gap;
    }

    // clicks: plain selects one, Shift extends from the anchor, Mod toggles
    function choose(k, e) {
      if (sel.none) return;
      const s = sel.get();
      const mod = e && (isMac ? e.metaKey : e.ctrlKey);
      if (sel.mode === 'multi' && e && e.shiftKey && s.anchor != null && index.has(s.anchor)) {
        const a = index.get(s.anchor), b = index.get(k);
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
        sel.set({ ids: mod ? [...new Set(s.ids.concat(range))] : range, primary: k, anchor: s.anchor });
      } else if (sel.mode === 'multi' && mod) {
        const has = s.ids.includes(k);
        const nextIds = has ? s.ids.filter(x => x !== k) : s.ids.concat([k]);
        sel.set({ ids: nextIds, primary: has ? (nextIds[0] ?? null) : k, anchor: k });
      } else if (s.ids.length > 1 && s.ids.includes(k) && e && e.type === 'pointerdown') {
        sel.set({ ids: s.ids, primary: k, anchor: k });   // clicking inside a multi-selection makes it the primary
      } else sel.set({ ids: [k], primary: k, anchor: k });
    }
    listen(m.scope, inner, 'pointerdown', e => {
      const rel = e.target.closest('.ck-coll-row,.ck-coll-cell'); if (!rel || e.button === 2 && sel.get().ids.includes(keyFromEl(rel))) return;
      if (e.target.closest('input,button,select,textarea,.ck-no-select')) return;
      const k = keyFromEl(rel);
      // in a list without selection a click is the action (a source list in a panel)
      if (sel.none && p.activate && e.button === 0) { m.run(p.activate, list()[index.get(k)], e); return; }
      // a tree row with children opens and closes on a click (a folder of presets)
      if (kind === 'tree' && !e.target.closest('.ck-tree-tw')) { const f = flat[index.get(k)]; if (f && f.hasKids) { if (open.has(k)) open.delete(k); else open.add(k); rebuildTree(); ids = flat.map(x => keyOf(x.item)); index = new Map(ids.map((kk, ii) => [kk, ii])); draw(); return; } }
      choose(k, e);
    });
    const keyFromEl = rel => { const k = rel.dataset.key; const i = ids.findIndex(x => String(x) === k); return i >= 0 ? ids[i] : k; };
    listen(m.scope, inner, 'dblclick', e => {
      const rel = e.target.closest('.ck-coll-row,.ck-coll-cell'); if (!rel || !p.activate) return;
      if (e.target.closest('input,button,select,textarea')) return;
      const k = keyFromEl(rel); m.run(p.activate, list()[index.get(k)], e);
    });
    if (p.context) listen(m.scope, inner, 'contextmenu', e => {
      const rel = e.target.closest('.ck-coll-row,.ck-coll-cell'); if (!rel) return;
      e.preventDefault();
      const k = keyFromEl(rel); if (!sel.get().ids.includes(k)) choose(k, null);
      const it = list()[index.get(k)];
      const items2 = typeof p.context === 'function' ? p.context(m.store.readonly(), it) : p.context;
      app.chrome.contextMenu(e.clientX, e.clientY, items2, it, m);
    });

    // keyboard: arrows move (Shift extends), Mod+A, Home/End, Enter activates; the keys map runs commands
    const table = new Map();
    for (const [ch, t] of Object.entries(p.keys || {})) { try { table.set(parseChord(ch), t); } catch (e) { /* reported by the build */ } }
    const move = (delta, e) => {
      const s = sel.get(); const L = list(); if (!L.length) return;
      const cur = s.primary != null && index.has(s.primary) ? index.get(s.primary) : -1;
      const i = Math.max(0, Math.min(L.length - 1, cur < 0 ? 0 : cur + delta));
      const k = ids[i];
      if (e && e.shiftKey && sel.mode === 'multi') { const a = index.has(s.anchor) ? index.get(s.anchor) : i; sel.set({ ids: ids.slice(Math.min(a, i), Math.max(a, i) + 1), primary: k, anchor: s.anchor ?? k }); }
      else sel.set({ ids: [k], primary: k, anchor: k });
      scrollTo(i);
    };
    m.app.collections.add({ el, move, get items() { return list(); }, sel });
    m.scope.onDispose(() => { for (const c of m.app.collections) if (c.el === el) m.app.collections.delete(c); });
    listen(m.scope, el, 'keydown', e => {
      if (e.target !== el && e.target.matches && e.target.matches('input,textarea,select')) return;
      const ch = chordFromEvent(e); const lay = layout();
      const t = ch && table.get(ch);
      if (t) {
        e.preventDefault(); e.stopPropagation();
        const before = sel.get().primary;
        m.run(t, e);
        if (p.advance && (typeof p.advance === 'function' ? p.advance(m.store.readonly()) : p.advance) && sel.get().primary === before) move(1);
        return;
      }
      const step = { ArrowRight: horizontal || isGrid ? 1 : 0, ArrowLeft: horizontal || isGrid ? -1 : 0, ArrowDown: horizontal ? 0 : lay.cols, ArrowUp: horizontal ? 0 : -lay.cols }[e.key];
      if (step && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); move(step, e); return; }
      if (kind === 'tree' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const k = sel.get().primary; if (k == null) return; e.preventDefault();
        if (e.key === 'ArrowRight') open.add(k); else open.delete(k);
        rebuildTree(); ids = flat.map(x => keyOf(x.item)); index = new Map(ids.map((kk, ii) => [kk, ii])); draw();
        return;
      }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); move(e.key === 'Home' ? -1e9 : 1e9, e); return; }
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'a' && sel.mode === 'multi') { e.preventDefault(); e.stopPropagation(); sel.set({ ids: ids.slice(), primary: sel.get().primary ?? ids[0], anchor: sel.get().anchor }); return; }
      if (e.key === 'Enter' && p.activate && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); const k = sel.get().primary; if (k != null) m.run(p.activate, list()[index.get(k)], e); }
    });

    listen(m.scope, el, 'scroll', queueDraw, { passive: true });
    if (horizontal) listen(m.scope, el, 'wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    const ro = new ResizeObserver(() => queueDraw()); ro.observe(el); m.scope.onDispose(() => ro.disconnect());

    if (p.size !== undefined) m.val(p.size, v => { size = Math.max(40, +v || 140); draw(); });
    m.val(p.empty !== undefined ? p.empty : 'Nothing here', v => { empty.textContent = v || ''; });
    m.cell(p.items, setItems, { equals: (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])) });
    m.cell(s => sel.path.reduce((o, k) => (o == null ? o : o[k]), s), v => {
      paintSelection();
      if (v && v.primary != null && index.has(v.primary)) requestAnimationFrame(() => scrollTo(index.get(v.primary)));
    });
    return el;
  };
}

defineForm('listview', { slots: SLOTS, mount: collection('list') });
defineForm('gridview', { slots: SLOTS, mount: collection('grid') });
defineForm('filmstrip', { slots: SLOTS, mount: collection('filmstrip') });
defineForm('treeview', { slots: SLOTS, mount: collection('tree') });
