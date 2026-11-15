// Renderers for containers and places (port of CraftKit ui/forms/container.js and the dock forms in index.js):
// row, column, grid, cell, spacer, divider, scroll, bar, section, panel, tabs, match, when, toolbar, statusline,
// hud, html, keys, dockcol, panelref, docktabs.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { chordLabel, parseChord } from '../../core/keys.ts';
import { bindingPath } from '../../core/track.ts';
import { walk, makeNode, type NodeData } from '../../ir/node.ts';
import type { Key } from '../../core/util.ts';
import { h, icon, listen } from '../h.ts';
import { context } from '../habits.ts';
import { defineRenderer, type MountCtx } from '../mount.ts';

const P = (n: NodeData): Record<string, any> => n.props as Record<string, any>;
const box =
  (cls: string) =>
  (n: NodeData, m: MountCtx): HTMLElement => {
    const p = P(n);
    const el = h('div', { class: cls });
    el.append(...m.mountAll(n.kids));
    if (p['gap'] != null) el.style.gap = p['gap'] + 'px';
    if (p['align']) el.style.alignItems = p['align'];
    if (p['justify']) el.style.justifyContent = p['justify'];
    if (p['wrap']) el.style.flexWrap = 'wrap';
    return el;
  };
defineRenderer('row', box('ck-row'));
defineRenderer('bar', box('ck-bar'));
defineRenderer('scroll', box('ck-scroll'));
defineRenderer('column', (n, m) => {
  const el = box('ck-col')(n, m);
  if (n.props['pad']) el.style.padding = n.props['pad'] + 'px';
  return el;
});
defineRenderer('grid', (n, m) => {
  const el = box('ck-grid')(n, m);
  const cols = n.props['cols'];
  el.style.gridTemplateColumns = typeof cols === 'string' ? cols : `repeat(${cols || 2}, minmax(0, 1fr))`;
  return el;
});
defineRenderer('cell', (n, m) => {
  const el = h('div', { class: 'ck-cell' });
  el.append(...m.mountAll(n.kids));
  if (n.props['span']) el.style.gridColumn = `span ${n.props['span']}`;
  return el;
});
defineRenderer('spacer', n => {
  const el = h('div', { class: 'ck-spacer' });
  if (n.props['size']) el.style.flex = `0 0 ${n.props['size']}px`;
  return el;
});
defineRenderer('divider', n => h('div', { class: ['ck-divider', n.props['vertical'] && 'is-v'], role: 'separator' }));

// ── reset helpers: the resettable bindings under a node (a section title resets them all) ──
export function resettables(root: NodeData, m: MountCtx): { path: Key[]; reset: unknown }[] {
  const out: { path: Key[]; reset: unknown }[] = [];
  walk(root, n => {
    if ((n.$ === 'slider' || n.$ === 'number') && n.props['bind'] && n.props['reset'] !== undefined) {
      const b = n.props['bind'];
      const path = typeof b === 'string' ? b.split('.') : bindingPath(m.store, b as (s: any) => unknown).path;
      if (path) out.push({ path, reset: n.props['reset'] });
    }
  });
  return out;
}
function resetAll(list: { path: Key[]; reset: unknown }[], label: string, m: MountCtx): void {
  if (!list.length) return;
  const st = m.store.readonly();
  m.store.tx(
    label,
    t => {
      for (const r of list) t.$set(r.path, typeof r.reset === 'function' ? r.reset(st) : r.reset);
    },
    m.txOpts(),
  );
}

// ── section: a titled group inside a panel; double-click the title to reset what is inside ──
defineRenderer('section', (n, m) => {
  const p = P(n);
  const el = h('section', { class: 'ck-section' });
  const head = h('div', { class: 'ck-section-h' });
  const title = h('span', { class: 'ck-section-t' });
  head.append(title);
  m.val(p['title'], v => {
    title.textContent = v ? String(v) : '';
    head.hidden = !v;
  });
  if (p['aside']) {
    const a = m.mount(p['aside']);
    if (a) head.append(a);
  }
  const body = h('div', { class: 'ck-section-b' });
  body.append(...m.mountAll(n.kids));
  el.append(head, body);
  if (p['reset']) {
    title.classList.add('ck-resettable');
    title.dataset['tip'] = 'Double-click to reset this group';
    listen(m.scope, title, 'dblclick', (e: MouseEvent) => {
      e.preventDefault();
      resetAll(resettables(n, m), `Reset ${title.textContent}`, m);
    });
  }
  if (p['collapsible']) {
    head.classList.add('is-toggle');
    let open = p['open'] !== false;
    body.hidden = !open;
    el.classList.toggle('is-closed', !open);
    listen(m.scope, head, 'click', () => {
      open = !open;
      body.hidden = !open;
      el.classList.toggle('is-closed', !open);
    });
  }
  return el;
});

// ── panel: a header (switch, title, menu, disclosure) and a body; collapse, solo, reset ──
defineRenderer('panel', (n, m) => {
  const p = P(n);
  const id = String(p['id']);
  const rt = m.rt;
  const el = h('section', { class: ['ck-panel', p['fixed'] && 'is-fixed', p['scroll'] && 'is-scroll'], 'data-panel': id });
  const head = h('div', { class: 'ck-panel-h', role: 'button', tabindex: '0' });
  const title = h('span', { class: 'ck-panel-t' });
  m.val(p['title'] !== undefined ? p['title'] : id, v => void (title.textContent = v ? String(v) : ''));
  const body = h('div', { class: 'ck-panel-b' });
  if (p['minH']) body.style.minHeight = p['minH'] + 'px';
  const pm = m.child('panel:' + id, { panel: id });
  // the header switch: s => s.path (a boolean) or { value: s => …, toggle: ctx => … }
  if (p['switch']) {
    const sw = h('button', { type: 'button', class: 'ck-panel-sw', 'aria-label': 'Turn this panel on or off', 'data-tip': 'Turn this panel’s settings on or off' });
    const get = typeof p['switch'] === 'function' ? p['switch'] : p['switch'].value;
    pm.cell(get, v => {
      sw.classList.toggle('is-on', v !== false);
      el.classList.toggle('is-off', v === false);
      sw.setAttribute('aria-pressed', v !== false ? 'true' : 'false');
    });
    listen(pm.scope, sw, 'click', (e: MouseEvent) => {
      e.stopPropagation();
      if (typeof p['switch'] === 'function') {
        const path = bindingPath(m.store, p['switch']).path;
        if (!path) return;
        const cur = m.store.peek(path);
        m.store.tx(`${title.textContent}: ${cur === false ? 'On' : 'Off'}`, t => t.$set(path, cur === false), m.txOpts());
      } else m.run(p['switch'].toggle, e);
    });
    head.append(sw);
  }
  if (p['icon']) head.append(icon(p['icon'], 13, 'ck-panel-ico'));
  head.append(title);
  if (p['aside']) {
    const a = pm.mount(p['aside']);
    if (a) head.append(a);
  }
  if (p['menu']) {
    const mb = h('button', { type: 'button', class: 'ck-panel-menu', 'aria-label': `${id} panel menu`, 'data-tip': 'Panel menu' }, icon('menu', 12));
    listen(pm.scope, mb, 'click', (e: MouseEvent) => {
      e.stopPropagation();
      const r = mb.getBoundingClientRect();
      rt.chrome.contextMenu(r.right - 4, r.bottom + 2, typeof p['menu'] === 'function' ? p['menu'](m.store.readonly()) : p['menu']);
    });
    head.append(mb);
  }
  if (!p['fixed']) head.append(h('span', { class: 'ck-panel-tri' }, icon('chevd', 10)));
  body.append(...pm.mountAll(n.kids));
  el.append(head, body);
  // open/closed lives in the workspace (view tier), so it is saved with the layout
  if (!p['fixed']) {
    const path = ['workspace', 'panels', id, 'open'];
    if (!rt.workspace.defaults.has(id)) rt.workspace.defaults.set(id, p['open'] !== false);
    if (m.store.peek(path) === undefined) m.store.writeDoc([{ path, value: p['open'] !== false }], { tier: 'view', init: true });
    pm.cell(
      s => {
        const w = s.workspace?.panels?.[id];
        return !w || w.open !== false;
      },
      open => {
        el.classList.toggle('is-closed', !open);
        body.hidden = !open;
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
      },
    );
    const toggle = (e: MouseEvent | KeyboardEvent): void => {
      // a control placed in the header (the switch, a menu) does its own thing, not this
      const t = e.target as HTMLElement;
      if (t !== head && t.closest('button,input,select,textarea,[role="switch"],[role="button"]:not(.ck-panel-h)')) return;
      const open = m.store.peek(path) !== false;
      if (e.altKey) {
        m.dom.dock.solo(id, el);
        return;
      }
      m.store.set(path, !open);
      if (!open && el.closest('.ck-column.is-solo')) m.dom.dock.solo(id, el);
    };
    listen(pm.scope, head, 'click', toggle);
    listen(pm.scope, head, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle(e);
      }
    });
  }
  if (p['reset']) {
    title.classList.add('ck-resettable');
    title.dataset['tip'] = 'Double-click to reset this panel';
    listen(pm.scope, title, 'dblclick', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      m.store.set(['workspace', 'panels', id, 'open'], true);
      resetAll(resettables(n, pm), `Reset ${title.textContent}`, pm);
    });
  }
  if (p['context']) context(pm.scope, head, pm, p['context']);
  listen(pm.scope, el, 'focusin', () => void (rt.focus.panel = id));
  return el;
});

// ── tabs: a tab strip and one visible body; the active tab is view state ──
defineRenderer('tabs', (n, m) => {
  const p = P(n);
  const names = Object.keys(p['tabs'] || {});
  const el = h('div', { class: 'ck-tabs' });
  const strip = h('div', { class: ['ck-tabs-s', p['small'] && 'is-small'], role: 'tablist' });
  const body = h('div', { class: 'ck-tabs-b' });
  el.append(strip, body);
  const statePath: Key[] = (p['bind'] ? bindingPath(m.store, p['bind']).path : null) || ['workspace', 'tabs', String(p['id'] || names.join('|'))];
  if (m.store.peek(statePath) === undefined) m.store.writeDoc([{ path: statePath, value: names[0] }], { tier: 'view', init: true });
  const btns = names.map(name => {
    const b = h('button', { type: 'button', role: 'tab', class: 'ck-tab', text: name });
    listen(m.scope, b, 'click', () => m.store.set(statePath, name));
    return b;
  });
  strip.append(...btns);
  let sub: MountCtx | null = null;
  m.cell(
    s => statePath.reduce((o: any, k) => (o == null ? o : o[k]), s),
    cur => {
      const name = names.includes(cur) ? cur : names[0]!;
      btns.forEach((b, i) => {
        b.classList.toggle('is-on', names[i] === name);
        b.setAttribute('aria-selected', names[i] === name ? 'true' : 'false');
      });
      if (sub) sub.scope.dispose();
      sub = m.child('tab:' + name);
      const x = sub.mount(p['tabs'][name]);
      body.replaceChildren(...(x ? [x] : []));
    },
  );
  return el;
});

// ── match: swap the layout on a τ value; the state underneath is untouched ──
defineRenderer('match', (n, m) => {
  const p = P(n);
  const el = h('div', { class: 'ck-match' });
  let sub: MountCtx | null = null;
  let curKey: string | undefined;
  m.cell(p['on'], v => {
    const key = String(v);
    const c = Object.prototype.hasOwnProperty.call(p['cases'], key) ? key : 'default';
    if (c === curKey && sub) return;
    curKey = c;
    if (sub) sub.scope.dispose();
    sub = m.child('case:' + c);
    const target = p['cases'][c];
    const x = target ? sub.mount(typeof target === 'function' ? target(v) : target) : h('div', { class: 'ck-empty' });
    el.replaceChildren(...(x ? [x] : []));
    el.dataset['case'] = c;
  });
  return el;
});
defineRenderer('when', (n, m) => {
  const p = P(n);
  const el = h('div', { class: 'ck-when' });
  el.style.display = 'contents';
  let sub: MountCtx | null = null;
  let cur: boolean | undefined;
  m.cell(
    s => !!p['cond'](s),
    v => {
      if (v === cur) return;
      cur = v;
      if (sub) sub.scope.dispose();
      sub = m.child('when');
      const t = v ? p['then'] : p['else'];
      const x = t ? sub.mount(t) : null;
      el.replaceChildren(...(x ? [x] : []));
    },
  );
  return el;
});

// ── toolbar: command ids (icons and keys from the table), nodes, '-' separators, '~' spacers ──
defineRenderer('toolbar', (n, m) => {
  const el = h('div', { class: ['ck-toolbar', n.props['vertical'] && 'is-v'], role: 'toolbar' });
  for (const it of (n.props['items'] as unknown[]) || []) {
    if (it === '-') {
      el.append(h('span', { class: 'ck-toolbar-sep' }));
      continue;
    }
    if (it === '~') {
      el.append(h('span', { class: 'ck-spacer' }));
      continue;
    }
    if (typeof it === 'string') {
      const c = m.rt.commands.get(it);
      const x = m.mount(makeNode('button', { run: it, icon: c?.icon, small: n.props['small'], quiet: true }, [], n.at));
      if (x) el.append(x);
      continue;
    }
    const x = m.mount(it);
    if (x) el.append(x);
  }
  return el;
});
defineRenderer('statusline', (n, m) => {
  const el = h('div', { class: 'ck-statusline' });
  m.val(n.props['value'], v => void (el.textContent = v ? String(v) : ''));
  return el;
});
defineRenderer('hud', (n, m) => {
  const el = h('div', { class: ['ck-hud', 'at-' + (n.props['at'] || 'top-right')] });
  m.val(n.props['value'], v => {
    el.textContent = v ? String(v) : '';
    el.hidden = !v;
  });
  return el;
});
defineRenderer('html', (n, m) => (n.props['make'] as (m: MountCtx) => Node)(m));
defineRenderer('keys', (n, m) =>
  h(
    'span',
    { class: 'ck-keys' },
    ...([] as string[]).concat(n.props['chords'] as string | string[]).map(c => {
      let t = c;
      try {
        t = chordLabel(parseChord(c, m.rt.platform), m.rt.platform);
      } catch {
        /* shown as written */
      }
      return h('kbd', { class: 'ck-kbd', text: t });
    }),
  ),
);

// ── dock forms ──
defineRenderer('dockcol', (n, m) => {
  const el = h('div', { class: 'ck-col ck-column' });
  el.append(...m.mountAll(n.kids.map(k => m.rt.resolvePanel(k))));
  return el;
});
defineRenderer('panelref', (n, m) => {
  const p = m.rt.resolvePanel(n);
  if (p === n) return h('div', { class: 'ck-empty', text: `missing panel ${String(n.props['id'])}` });
  return m.mount(p);
});
/** a tab group of panels in a dock column: one strip of titles, one body at a time (the choice is workspace state) */
defineRenderer('docktabs', (n, m) => {
  const ids = (n.props['panels'] as string[]) || [];
  const path = ['workspace', 'tabs', 'dock:' + ids.join('|')];
  if (m.store.peek(path) === undefined) m.store.writeDoc([{ path, value: ids[0] }], { tier: 'view', init: true });
  const el = h('section', { class: 'ck-docktabs' });
  const strip = h('div', { class: 'ck-docktabs-s', role: 'tablist' });
  const body = h('div', { class: 'ck-docktabs-b' });
  el.append(strip, body);
  const btns = ids.map(id => {
    const b = h('button', { type: 'button', role: 'tab', class: 'ck-docktab', text: m.rt.panelTitle(id) });
    listen(m.scope, b, 'click', () => m.store.set(path, id));
    return b;
  });
  strip.append(...btns);
  let sub: MountCtx | null = null;
  m.cell(
    s => path.reduce((o: any, k) => (o == null ? o : o[k]), s),
    cur => {
      const id = ids.includes(cur) ? cur : ids[0]!;
      btns.forEach((b, i) => {
        b.classList.toggle('is-on', ids[i] === id);
        b.setAttribute('aria-selected', ids[i] === id ? 'true' : 'false');
      });
      if (sub) sub.scope.dispose();
      sub = m.child('tab:' + id);
      const x = sub.mount(m.rt.resolvePanel(makeNode('panelref', { id }, [], n.at)));
      body.replaceChildren(...(x ? [x] : []));
    },
  );
  return el;
});
