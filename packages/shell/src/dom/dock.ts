// The DOM dock (port of CraftKit ui/dock.js): fixed columns around a centre. The state (sizes, hidden sides, open
// panels, solo) lives in the view tier through rt.workspace; this renders it and handles splitters and edges.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { clamp } from '../core/util.ts';
import { isNode, type NodeData } from '../ir/node.ts';
import type { ModuleDef } from '../build/types.ts';
import { h, icon, listen, drag } from './h.ts';
import type { DomApp, MountCtx } from './mount.ts';

export class DomDock {
  readonly dom: DomApp;
  current: { mod: ModuleDef; el: HTMLElement } | null = null;
  constructor(dom: DomApp) {
    this.dom = dom;
  }
  private get rt() {
    return this.dom.rt;
  }
  /** build the frame for a module; the app swaps it when the module changes */
  mountModule(mod: ModuleDef, m: MountCtx): HTMLElement {
    const rt = this.rt;
    const ws = rt.workspace;
    const el = h('div', { class: 'ck-work', 'data-module': mod.id });
    const L = mod.regions;
    const mk = (side: 'left' | 'right' | 'bottom' | 'top', content: NodeData | null | undefined) => {
      if (!content) return null;
      const col = h('div', { class: ['ck-side', 'ck-side-' + side], 'data-side': side });
      const inner = h('div', { class: 'ck-side-in' });
      const sm = m.child('side:' + side, { side });
      const spec = content.$ === 'dockcol' ? content : null;
      const kids = spec ? spec.kids : [content];
      if (spec && spec.props['solo'] !== undefined) {
        const key = mod.id + ':' + side;
        const soloPath = ['workspace', 'solo', key];
        if (rt.store.peek(soloPath) === undefined) rt.store.writeView([{ path: soloPath, value: typeof spec.props['solo'] === 'boolean' ? spec.props['solo'] : false }], { init: true });
        sm.cell(
          s => s.workspace?.solo?.[key],
          v => void inner.classList.toggle('is-solo', !!v),
        );
        inner.dataset['soloKey'] = key;
      }
      inner.classList.add('ck-column');
      for (const k of kids) {
        const child = sm.mount(isNode(k) ? rt.resolvePanel(k) : k);
        if (child) inner.append(child);
      }
      col.append(inner);
      const def = (spec?.props['width'] as number) || (side === 'bottom' ? 96 : side === 'top' ? 40 : 260);
      // the edge toggle (Lightroom's little triangles at the window edges)
      const keyName = { left: 'F7', right: 'F8', bottom: 'F6', top: 'F5' }[side];
      const edge = h('button', { type: 'button', class: ['ck-edge', 'ck-edge-' + side], 'aria-label': `Show or hide the ${side} panels`, 'data-tip': `${side[0]!.toUpperCase() + side.slice(1)} panels (${keyName})` }, icon(side === 'left' ? 'left' : side === 'right' ? 'right' : side === 'bottom' ? 'down' : 'up', 9));
      listen(sm.scope, edge, 'click', () => ws.toggle(side));
      let split: HTMLElement | null = null;
      if (side === 'left' || side === 'right' || side === 'bottom') {
        const sp = h('div', { class: ['ck-split', 'ck-split-' + side], role: 'separator', 'aria-orientation': side === 'bottom' ? 'horizontal' : 'vertical', tabindex: '-1' });
        split = sp;
        listen(sm.scope, sp, 'pointerdown', (e: PointerEvent) => {
          e.preventDefault();
          const cur = ws.get(mod.id, side).size || def;
          const x0 = e.clientX;
          const y0 = e.clientY;
          const min = (spec?.props['min'] as number) || (side === 'bottom' ? 48 : 180);
          const max = (spec?.props['max'] as number) || (side === 'bottom' ? 260 : 520);
          drag(e, {
            cursor: side === 'bottom' ? 'ns-resize' : 'ew-resize',
            move: ev => {
              const d = side === 'left' ? ev.clientX - x0 : side === 'right' ? x0 - ev.clientX : y0 - ev.clientY;
              ws.setSide(mod.id, side, { size: Math.round(clamp(cur + d, min, max)) });
            },
          });
        });
        listen(sm.scope, sp, 'dblclick', () => ws.setSide(mod.id, side, { size: def }));
      }
      sm.cell(
        s => {
          const w = s.workspace?.layout?.[mod.id]?.[side];
          const g = s.workspace?.hide;
          return { size: w?.size || def, hidden: !!w?.hidden || !!(g && (g.all || (g.sides && side !== 'top' && side !== 'bottom'))) };
        },
        v => {
          if (side === 'bottom' || side === 'top') col.style.height = v.size + 'px';
          else col.style.width = v.size + 'px';
          col.hidden = v.hidden;
          if (split) split.hidden = v.hidden;
          edge.classList.toggle('is-closed', v.hidden);
        },
        { equals: (a, b) => !!a && a.size === b.size && a.hidden === b.hidden },
      );
      return { col, split, edge };
    };
    const left = mk('left', L.left);
    const right = mk('right', L.right);
    const bottom = mk('bottom', L.bottom);
    const top = mk('top', L.top && L.top.$ === 'dockcol' ? L.top : null);
    const center = h('div', { class: 'ck-center' });
    const cm = m.child('center');
    if (L.top && !top) {
      const t = cm.mount(L.top);
      if (t) center.append(t);
    }
    if (top) center.append(top.col);
    const main = h('div', { class: 'ck-center-main' });
    if (L.center) {
      const c = cm.mount(L.center);
      if (c) main.append(c);
    }
    center.append(main);
    if (L.toolbar) {
      const tb = h('div', { class: 'ck-center-tb' });
      const t = cm.mount(L.toolbar);
      if (t) tb.append(t);
      cm.cell(
        s => !!s.workspace?.hide?.toolbar,
        v => void (tb.hidden = v),
      );
      center.append(tb);
    }
    const row = h('div', { class: 'ck-work-row' });
    if (left) row.append(left.edge, left.col, ...(left.split ? [left.split] : []));
    row.append(center);
    if (right) row.append(...(right.split ? [right.split] : []), right.col, right.edge);
    el.append(row);
    if (bottom) el.append(...(bottom.split ? [bottom.split] : []), bottom.col, bottom.edge);
    this.current = { mod, el };
    return el;
  }
  /** solo: open this panel, close the others in its column */
  solo(id: string, el: HTMLElement): void {
    const col = el.closest('.ck-column');
    if (!col) return;
    const ids = [...col.querySelectorAll(':scope > .ck-panel:not(.is-fixed)')].map(p => (p as HTMLElement).dataset['panel']!);
    this.rt.workspace.solo(id, ids);
  }
  /** the state half ran (rt.workspace.reveal); scroll to the panel and focus it */
  reveal(id: string): void {
    const el = this.dom.root.querySelector(`.ck-panel[data-panel="${id.replace(/"/g, '\\"')}"]`) as HTMLElement | null;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView?.({ block: 'nearest' });
      (el.querySelector('[tabindex="0"],input,button') as HTMLElement | null)?.focus();
      el.classList.add('is-flash');
      setTimeout(() => el.classList.remove('is-flash'), 700);
    });
  }
}
