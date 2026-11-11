// Collections (port of CraftKit ui/forms/collection.js): list, grid, filmstrip, tree. Virtualised (only visible rows
// exist), keyed, selectable.
//
// items: τ (s => s.catalog.filtered). row/cell: a per-item template called with the real item; a row is re-mounted
// only when its item changes identity (state is immutable, so unchanged items keep theirs).
// select: { bind: s => s.ui.selection, mode: 'single' | 'multi' | 'none' } — the value is { ids, primary, anchor }.
// keys: chords → commands while the collection has focus; advance: τ moves on after a key command.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { bindingPath } from '../../core/track.ts';
import { chordFromEvent, parseChord } from '../../core/keys.ts';
import type { Key } from '../../core/util.ts';
import type { NodeData } from '../../ir/node.ts';
import type { Scope } from '../../core/cells.ts';
import { h, icon, listen } from '../h.ts';
import { defineRenderer, type MountCtx } from '../mount.ts';

export interface Selection {
  ids: unknown[];
  primary: unknown;
  anchor: unknown;
}
const EMPTY: Selection = { ids: [], primary: null, anchor: null };

/** what is being dragged between collections (one drag at a time per page) */
let dragging: Record<string, any> | null = null;
let collSeq = 0;

function makeSelection(m: MountCtx, n: NodeData) {
  const p = n.props as Record<string, any>;
  const sel = p['select'] || {};
  const path: Key[] = (sel.bind ? (typeof sel.bind === 'string' ? sel.bind.split('.') : bindingPath(m.store, sel.bind).path) : null) || ['workspace', 'selection', String(p['id'] || (n.at ? n.at.file + ':' + n.at.line : n.$))];
  if (m.store.peek(path) === undefined) m.store.writeDoc([{ path, value: EMPTY }], { tier: 'view', init: true });
  const get = (): Selection => (m.store.peek(path) as Selection) || EMPTY;
  const set = (v: Selection): void => {
    if (m.store.tierOf(path) === 'view') m.store.set(path, v);
    else m.store.tx('Select', t => t.$set(path, v), m.txOpts());
    if (p['onSelect']) m.run(p['onSelect'], v);
  };
  return { path, get, set, mode: (sel.mode || 'multi') as 'multi' | 'single' | 'none', none: sel.mode === 'none' };
}

type Kind = 'list' | 'grid' | 'filmstrip' | 'tree';
interface Row {
  el: HTMLElement;
  item: unknown;
  scope: Scope;
  i: number;
  i0: number;
}

function collection(kind: Kind) {
  return (n: NodeData, m: MountCtx): HTMLElement => {
    const p = n.props as Record<string, any>;
    const rt = m.rt;
    const keyOf: (it: any) => unknown = p['key'] || ((it: any) => (it && it.id != null ? it.id : it));
    const sel = makeSelection(m, n);
    const collId = 'coll' + ++collSeq;
    const isGrid = kind === 'grid' || kind === 'filmstrip';
    const horizontal = kind === 'filmstrip' || p['layout'] === 'horizontal';
    const formName = { list: 'listview', grid: 'gridview', tree: 'treeview', filmstrip: 'filmstrip' }[kind];
    const el = h('div', { class: ['ck-coll', 'ck-' + formName], tabindex: '0', role: isGrid ? 'grid' : kind === 'tree' ? 'tree' : 'listbox', 'aria-multiselectable': sel.mode === 'multi' ? 'true' : 'false' });
    const inner = h('div', { class: 'ck-coll-in' });
    const empty = h('div', { class: 'ck-coll-empty' });
    el.append(inner, empty);
    let items: unknown[] = [];
    let ids: unknown[] = [];
    let index = new Map<unknown, number>();
    let size = 140;
    const rowH: number = p['rowHeight'] || 24;
    const gap: number = p['gap'] != null ? p['gap'] : isGrid ? 6 : 0;
    const rows = new Map<unknown, Row>();
    const open = new Set<unknown>();
    let flat: { item: unknown; depth: number; hasKids: boolean }[] = [];

    const layout = () => {
      const W = el.clientWidth || 300;
      const H = el.clientHeight || 300;
      if (kind === 'filmstrip') {
        const s = Math.max(30, (H || 80) - 10);
        return { cols: Infinity, cw: s * (p['aspect'] || 1.35), ch: s, W, H };
      }
      if (isGrid) {
        const cw0 = size;
        const ch0 = size * (p['aspect'] ? 1 / p['aspect'] : 1) + (p['caption'] ? 18 : 0);
        const cols = Math.max(1, Math.floor((W - gap) / (cw0 + gap)));
        const cw = (W - gap) / cols - gap;
        return { cols, cw, ch: cw * (ch0 / cw0), W, H };
      }
      return { cols: 1, cw: W, ch: rowH, W, H };
    };
    const list = (): unknown[] => (kind === 'tree' ? flat.map(f => f.item) : items);
    const reindex = (): void => {
      ids = list().map(keyOf);
      index = new Map(ids.map((k, i) => [k, i]));
    };
    function rebuildTree(): void {
      flat = [];
      const walkT = (arr: unknown[], d: number): void => {
        for (const it of arr || []) {
          const kids = p['children'] ? p['children'](it) : null;
          flat.push({ item: it, depth: d, hasKids: !!(kids && kids.length) });
          if (kids && kids.length && open.has(keyOf(it))) walkT(kids, d + 1);
        }
      };
      walkT(items, 0);
    }
    const toggleOpen = (k: unknown, to?: boolean): void => {
      const now = to ?? !open.has(k);
      if (now) open.add(k);
      else open.delete(k);
      rebuildTree();
      reindex();
      draw();
    };
    function setItems(v: unknown): void {
      items = Array.isArray(v) ? v : [];
      if (kind === 'tree') rebuildTree();
      reindex();
      empty.hidden = list().length > 0;
      draw(true);
    }
    let drawQueued = false;
    function draw(force?: boolean | 'all'): void {
      const L = list();
      const lay = layout();
      const count = L.length;
      let first: number;
      let last: number;
      if (horizontal) {
        inner.style.width = count * (lay.cw + gap) + gap + 'px';
        inner.style.height = '100%';
        const x0 = el.scrollLeft;
        first = Math.max(0, Math.floor(x0 / (lay.cw + gap)) - 3);
        last = Math.min(count - 1, Math.ceil((x0 + lay.W) / (lay.cw + gap)) + 3);
      } else {
        const nrows = Math.ceil(count / lay.cols);
        inner.style.height = nrows * (lay.ch + gap) + gap + 'px';
        inner.style.width = '';
        const y0 = el.scrollTop;
        const r0 = Math.max(0, Math.floor(y0 / (lay.ch + gap)) - 2);
        const r1 = Math.ceil((y0 + lay.H) / (lay.ch + gap)) + 2;
        first = r0 * lay.cols;
        last = Math.min(count - 1, r1 * lay.cols + lay.cols - 1);
      }
      const keep = new Set<unknown>();
      for (let i = first; i <= last; i++) {
        const it = L[i];
        const k = keyOf(it);
        keep.add(k);
        let r = rows.get(k);
        // a row is redrawn when its item changes identity or its position does (templates may show the index)
        if (r && (r.item !== it || r.i0 !== i || force === 'all')) {
          r.scope.dispose();
          r.el.remove();
          rows.delete(k);
          r = undefined;
        }
        if (!r) {
          r = mountRow(it, i, k);
          rows.set(k, r);
          inner.appendChild(r.el);
        }
        r.i = i;
        const x = horizontal ? gap + i * (lay.cw + gap) : isGrid ? gap + (i % lay.cols) * (lay.cw + gap) : 0;
        const y = horizontal ? 5 : gap + Math.floor(i / lay.cols) * (lay.ch + gap);
        r.el.style.transform = `translate(${x}px, ${y}px)`;
        r.el.style.width = (isGrid ? lay.cw : lay.W) + 'px';
        r.el.style.height = lay.ch + 'px';
        if (kind === 'tree') r.el.style.paddingLeft = 6 + flat[i]!.depth * 14 + 'px';
      }
      for (const [k, r] of rows)
        if (!keep.has(k)) {
          r.scope.dispose();
          r.el.remove();
          rows.delete(k);
        }
      paintSelection();
    }
    const queueDraw = (): void => {
      if (drawQueued) return;
      drawQueued = true;
      requestAnimationFrame(() => {
        drawQueued = false;
        draw(false);
      });
    };

    function mountRow(it: unknown, i: number, k: unknown): Row {
      const rm = m.child('row', { item: it });
      const rel = h('div', { class: isGrid ? 'ck-coll-cell' : 'ck-coll-row', role: isGrid ? 'gridcell' : kind === 'tree' ? 'treeitem' : 'option', 'data-key': String(k) });
      if (kind === 'tree') {
        const f = flat[i];
        const tw = h('span', { class: 'ck-tree-tw' }, f && f.hasKids ? icon(open.has(k) ? 'chevd' : 'chevr', 9) : '');
        listen(rm.scope, tw, 'click', (e: MouseEvent) => {
          e.stopPropagation();
          toggleOpen(k);
        });
        rel.append(tw);
      }
      const tpl = p['row'] || p['cell'];
      const content = tpl ? rm.mount(tpl(it, i)) : h('span', { text: String((it && ((it as any).name || (it as any).label || (it as any).id)) || it) });
      if (content) rel.append(content);
      const dnd = p['dnd'];
      // drag and drop: a source makes rows draggable; reorder moves them within this collection; drop takes things
      // dragged in from elsewhere onto a row
      if (dnd && (dnd.source || dnd.reorder)) {
        rel.draggable = true;
        listen(rm.scope, rel, 'dragstart', (e: DragEvent) => {
          const s = sel.get();
          const keys = s.ids.includes(k) ? s.ids : [k];
          const src = dnd.source ? (typeof dnd.source === 'function' ? dnd.source(it) : { kind: dnd.source, id: k }) : { kind: 'item', id: k };
          const payload = { ...src, ids: keys, from: collId };
          e.dataTransfer?.setData('application/x-ck', JSON.stringify(payload));
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
          dragging = payload;
          el.classList.add('is-dragging');
        });
        listen(rm.scope, rel, 'dragend', () => {
          dragging = null;
          el.classList.remove('is-dragging');
        });
      }
      if (dnd && (dnd.drop || dnd.reorder)) {
        const side = (e: DragEvent): 'before' | 'after' => {
          const r = rel.getBoundingClientRect();
          return horizontal || isGrid ? (e.clientX < r.left + r.width / 2 ? 'before' : 'after') : e.clientY < r.top + r.height / 2 ? 'before' : 'after';
        };
        const unmark = (): void => rel.classList.remove('is-drop', 'is-drop-before', 'is-drop-after');
        listen(rm.scope, rel, 'dragover', (e: DragEvent) => {
          const d = dragging;
          if (!d) return;
          if (dnd.reorder && d['from'] === collId) {
            e.preventDefault();
            unmark();
            rel.classList.add('is-drop-' + side(e));
            return;
          }
          if (!dnd.drop || (dnd.accepts && !(typeof dnd.accepts === 'function' ? dnd.accepts(d, it) : ([] as unknown[]).concat(dnd.accepts).includes(d['kind'])))) return;
          e.preventDefault();
          unmark();
          rel.classList.add('is-drop');
        });
        listen(rm.scope, rel, 'dragleave', unmark);
        listen(rm.scope, rel, 'drop', (e: DragEvent) => {
          unmark();
          const d = dragging;
          if (!d) return;
          e.preventDefault();
          if (dnd.reorder && d['from'] === collId) {
            const i0 = index.get(k)!;
            m.run(dnd.reorder, d['ids'], side(e) === 'after' ? i0 + 1 : i0, e);
            return;
          }
          m.run(dnd.drop, d, it, e);
        });
      }
      return { el: rel, item: it, scope: rm.scope, i, i0: i };
    }

    function paintSelection(): void {
      const s = sel.get();
      const on = new Set(s.ids);
      for (const [k, r] of rows) {
        const isOn = on.has(k);
        r.el.classList.toggle('is-sel', isOn);
        r.el.classList.toggle('is-primary', s.primary === k);
        r.el.setAttribute('aria-selected', isOn ? 'true' : 'false');
      }
    }
    function scrollTo(i: number): void {
      const lay = layout();
      if (horizontal) {
        const x = gap + i * (lay.cw + gap);
        if (x < el.scrollLeft) el.scrollLeft = x - gap;
        else if (x + lay.cw > el.scrollLeft + lay.W) el.scrollLeft = x + lay.cw - lay.W + gap;
        return;
      }
      const y = gap + Math.floor(i / lay.cols) * (lay.ch + gap);
      if (y < el.scrollTop) el.scrollTop = y - gap;
      else if (y + lay.ch > el.scrollTop + lay.H) el.scrollTop = y + lay.ch - lay.H + gap;
    }
    const modKey = (e: { metaKey: boolean; ctrlKey: boolean } | null): boolean => !!e && (rt.platform.mac ? e.metaKey : e.ctrlKey);

    // clicks: plain selects one, Shift extends from the anchor, Mod toggles
    function choose(k: unknown, e: (MouseEvent & { type: string }) | null): void {
      if (sel.none) return;
      const s = sel.get();
      const mod = modKey(e);
      if (sel.mode === 'multi' && e?.shiftKey && s.anchor != null && index.has(s.anchor)) {
        const a = index.get(s.anchor)!;
        const b = index.get(k)!;
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
        sel.set({ ids: mod ? [...new Set(s.ids.concat(range))] : range, primary: k, anchor: s.anchor });
      } else if (sel.mode === 'multi' && mod) {
        const has = s.ids.includes(k);
        const next = has ? s.ids.filter(x => x !== k) : s.ids.concat([k]);
        sel.set({ ids: next, primary: has ? (next[0] ?? null) : k, anchor: k });
      } else if (s.ids.length > 1 && s.ids.includes(k) && e && e.type === 'pointerdown') {
        sel.set({ ids: s.ids, primary: k, anchor: k }); // clicking inside a multi-selection makes it the primary
      } else sel.set({ ids: [k], primary: k, anchor: k });
    }
    const keyFromEl = (rel: HTMLElement): unknown => {
      const k = rel.dataset['key'];
      const i = ids.findIndex(x => String(x) === k);
      return i >= 0 ? ids[i] : k;
    };
    const rowOf = (t: EventTarget | null): HTMLElement | null => (t as HTMLElement | null)?.closest?.('.ck-coll-row,.ck-coll-cell') ?? null;
    listen(m.scope, inner, 'pointerdown', (e: PointerEvent) => {
      const rel = rowOf(e.target);
      if (!rel || (e.button === 2 && sel.get().ids.includes(keyFromEl(rel)))) return;
      if ((e.target as HTMLElement).closest('input,button,select,textarea,.ck-no-select')) return;
      const k = keyFromEl(rel);
      // in a list without selection a click is the action (a source list in a panel)
      if (sel.none && p['activate'] && e.button === 0) {
        m.run(p['activate'], list()[index.get(k)!], e);
        return;
      }
      // a tree row with children opens and closes on a click (a folder of presets)
      if (kind === 'tree' && !(e.target as HTMLElement).closest('.ck-tree-tw')) {
        const f = flat[index.get(k)!];
        if (f && f.hasKids) {
          toggleOpen(k);
          return;
        }
      }
      choose(k, e);
    });
    listen(m.scope, inner, 'dblclick', (e: MouseEvent) => {
      const rel = rowOf(e.target);
      if (!rel || !p['activate']) return;
      if ((e.target as HTMLElement).closest('input,button,select,textarea')) return;
      m.run(p['activate'], list()[index.get(keyFromEl(rel))!], e);
    });
    if (p['context'])
      listen(m.scope, inner, 'contextmenu', (e: MouseEvent) => {
        const rel = rowOf(e.target);
        if (!rel) return;
        e.preventDefault();
        const k = keyFromEl(rel);
        if (!sel.get().ids.includes(k)) choose(k, null);
        const it = list()[index.get(k)!];
        const menu = typeof p['context'] === 'function' ? p['context'](m.store.readonly(), it) : p['context'];
        rt.chrome.contextMenu(e.clientX, e.clientY, menu, it);
      });

    // keyboard: arrows move (Shift extends), Mod+A, Home/End, Enter activates; the keys map runs commands
    const table = new Map<string, unknown>();
    for (const [ch, t] of Object.entries((p['keys'] as Record<string, unknown>) || {})) {
      try {
        table.set(parseChord(ch, rt.platform), t);
      } catch {
        /* reported by the build */
      }
    }
    const move = (delta: number, e?: { shiftKey?: boolean } | null): void => {
      const s = sel.get();
      const L = list();
      if (!L.length) return;
      const cur = s.primary != null && index.has(s.primary) ? index.get(s.primary)! : -1;
      const i = Math.max(0, Math.min(L.length - 1, cur < 0 ? 0 : cur + delta));
      const k = ids[i];
      if (e?.shiftKey && sel.mode === 'multi') {
        const a = index.has(s.anchor) ? index.get(s.anchor)! : i;
        sel.set({ ids: ids.slice(Math.min(a, i), Math.max(a, i) + 1), primary: k, anchor: s.anchor ?? k });
      } else sel.set({ ids: [k], primary: k, anchor: k });
      scrollTo(i);
    };
    const handle = { el, move, sel, get items() { return list(); } };
    m.dom.collections.add(handle);
    m.scope.onDispose(() => m.dom.collections.delete(handle));
    listen(m.scope, el, 'keydown', (e: KeyboardEvent) => {
      if (e.target !== el && (e.target as HTMLElement).matches?.('input,textarea,select')) return;
      const ch = chordFromEvent(e, rt.platform);
      const t = ch ? table.get(ch) : undefined;
      if (t) {
        e.preventDefault();
        e.stopPropagation();
        const before = sel.get().primary;
        m.run(t, e);
        const adv = p['advance'];
        if (adv && (typeof adv === 'function' ? adv(m.store.readonly()) : adv) && sel.get().primary === before) move(1);
        return;
      }
      const lay = layout();
      const step = ({ ArrowRight: horizontal || isGrid ? 1 : 0, ArrowLeft: horizontal || isGrid ? -1 : 0, ArrowDown: horizontal ? 0 : lay.cols, ArrowUp: horizontal ? 0 : -lay.cols } as Record<string, number>)[e.key];
      if (step && kind !== 'tree' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        move(step, e);
        return;
      }
      if (kind === 'tree' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        e.stopPropagation();
        move(e.key === 'ArrowDown' ? 1 : -1, e);
        return;
      }
      if (kind === 'tree' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const k = sel.get().primary;
        if (k == null) return;
        e.preventDefault();
        e.stopPropagation();
        toggleOpen(k, e.key === 'ArrowRight');
        return;
      }
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        move(e.key === 'Home' ? -1e9 : 1e9, e);
        return;
      }
      if (modKey(e) && e.key.toLowerCase() === 'a' && sel.mode === 'multi') {
        e.preventDefault();
        e.stopPropagation();
        const s = sel.get();
        sel.set({ ids: ids.slice(), primary: s.primary ?? ids[0], anchor: s.anchor });
        return;
      }
      if (e.key === 'Enter' && p['activate'] && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const k = sel.get().primary;
        if (k != null) m.run(p['activate'], list()[index.get(k)!], e);
      }
    });

    listen(m.scope, el, 'scroll', queueDraw, { passive: true });
    if (horizontal)
      listen(
        m.scope,
        el,
        'wheel',
        (e: WheelEvent) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            el.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        },
        { passive: false },
      );
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => queueDraw());
      ro.observe(el);
      m.scope.onDispose(() => ro.disconnect());
    }
    if (p['size'] !== undefined)
      m.val(p['size'], v => {
        size = Math.max(40, +v || 140);
        draw();
      });
    m.val(p['empty'] !== undefined ? p['empty'] : 'Nothing here', v => void (empty.textContent = v ? String(v) : ''));
    m.cell(p['items'], setItems, { equals: (a: any, b: any) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])) });
    m.cell(
      s => sel.path.reduce((o: any, k) => (o == null ? o : o[k]), s),
      (v: any) => {
        paintSelection();
        if (v && v.primary != null && index.has(v.primary)) requestAnimationFrame(() => scrollTo(index.get(v.primary)!));
      },
    );
    if (p['focusOnMount']) requestAnimationFrame(() => el.focus());
    return el;
  };
}

defineRenderer('listview', collection('list'));
defineRenderer('gridview', collection('grid'));
defineRenderer('filmstrip', collection('filmstrip'));
defineRenderer('treeview', collection('tree'));
