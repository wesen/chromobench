// Containers: row, column, grid, cell, section, panel, tabs, toolbar, bar, match, when, divider, spacer, hud.
import { defineForm, node, isNode, walk } from '../node.js';
import { h, icon, listen } from '../dom.js';
import { chordLabel } from '../../core/keys.js';
import { bindingPath } from '../../core/track.js';
import { context } from '../habits.js';

const box = cls => (n, m) => { const el = h('div', { class: cls }); el.append(...m.mountAll(n.kids)); if (n.props.gap != null) el.style.gap = n.props.gap + 'px'; if (n.props.align) el.style.alignItems = n.props.align; if (n.props.justify) el.style.justifyContent = n.props.justify; if (n.props.wrap) el.style.flexWrap = 'wrap'; return el; };
defineForm('row', { slots: { gap: 'β', align: 'β', justify: 'β', wrap: 'β' }, mount: box('ck-row') });
defineForm('column', { slots: { gap: 'β', align: 'β', justify: 'β', pad: 'β' }, mount: (n, m) => { const el = box('ck-col')(n, m); if (n.props.pad) el.style.padding = n.props.pad + 'px'; return el; } });
defineForm('grid', {
  slots: { cols: 'β', gap: 'β', align: 'β', justify: 'β', wrap: 'β' },
  mount(n, m) { const el = box('ck-grid')(n, m); el.style.gridTemplateColumns = typeof n.props.cols === 'string' ? n.props.cols : `repeat(${n.props.cols || 2}, minmax(0, 1fr))`; return el; },
});
defineForm('cell', { slots: { span: 'β', rows: 'β' }, mount(n, m) { const el = h('div', { class: 'ck-cell' }); el.append(...m.mountAll(n.kids)); if (n.props.span) el.style.gridColumn = `span ${n.props.span}`; return el; } });
defineForm('spacer', { slots: { size: 'β' }, mount(n) { const el = h('div', { class: 'ck-spacer' }); if (n.props.size) { el.style.flex = `0 0 ${n.props.size}px`; } return el; } });
defineForm('divider', { slots: { vertical: 'β' }, mount: n => h('div', { class: ['ck-divider', n.props.vertical && 'is-v'], role: 'separator' }) });
defineForm('scroll', { slots: {}, mount: box('ck-scroll') });

// ── reset helpers: collect the resettable bindings under a node (a section title resets them all) ──
export function resettables(root, m) {
  const out = [];
  walk(root, n => {
    if ((n.$ === 'slider' || n.$ === 'number') && n.props.bind && n.props.reset !== undefined) {
      const path = typeof n.props.bind === 'string' ? n.props.bind.split('.') : bindingPath(m.store, n.props.bind).path;
      if (path) out.push({ path, reset: n.props.reset });
    }
  });
  return out;
}
function resetAll(list, label, m) {
  if (!list.length) return;
  const st = m.store.readonly();
  m.store.tx(label, t => { for (const r of list) t.$set(r.path, typeof r.reset === 'function' ? r.reset(st) : r.reset); }, typeof m.env.txOpts === 'function' ? m.env.txOpts(st) : m.env.txOpts || {});
}

// ── section: a titled group inside a panel; double-click the title to reset what is inside ──
defineForm('section', {
  slots: { title: 'τ', reset: 'β', collapsible: 'β', open: 'β', picker: 'β', aside: 'β' },
  mount(n, m) {
    const p = n.props;
    const el = h('section', { class: 'ck-section' });
    const head = h('div', { class: 'ck-section-h' });
    const title = h('span', { class: 'ck-section-t' });
    head.append(title);
    m.val(p.title, v => { title.textContent = v || ''; head.hidden = !v; });
    if (p.aside) head.append(m.mount(p.aside));
    const body = h('div', { class: 'ck-section-b' });
    body.append(...m.mountAll(n.kids));
    el.append(head, body);
    if (p.reset) {
      title.classList.add('ck-resettable'); title.dataset.tip = 'Double-click to reset this group';
      listen(m.scope, title, 'dblclick', e => { e.preventDefault(); resetAll(resettables(n, m), `Reset ${title.textContent}`, m); });
    }
    if (p.collapsible) {
      head.classList.add('is-toggle'); let open = p.open !== false; body.hidden = !open; el.classList.toggle('is-closed', !open);
      listen(m.scope, head, 'click', () => { open = !open; body.hidden = !open; el.classList.toggle('is-closed', !open); });
    }
    return el;
  },
});

// ── panel: a header (switch, title, menu, disclosure) and a body; collapse, solo, reset ──
// switch: s => s.path (a boolean) or { value: s => …, toggle: (ctx) => … }
defineForm('panel', {
  slots: { title: 'τ', switch: 'τ', menu: 'τ', reset: 'β', fixed: 'β', open: 'β', tools: 'β', minH: 'β', grow: 'β', context: 'τ', aside: 'β', icon: 'β', scroll: 'β' },
  mount(n, m) {
    const p = n.props, id = p.id, app = m.app;
    const el = h('section', { class: ['ck-panel', p.fixed && 'is-fixed', p.scroll && 'is-scroll'], 'data-panel': id });
    const head = h('div', { class: 'ck-panel-h', role: 'button', tabindex: '0' });
    const title = h('span', { class: 'ck-panel-t' });
    m.val(p.title !== undefined ? p.title : id, v => { title.textContent = v || ''; });
    const body = h('div', { class: 'ck-panel-b' });
    if (p.minH) body.style.minHeight = p.minH + 'px';
    const pm = m.child('panel:' + id, { panel: id });
    // header switch
    if (p.switch) {
      const sw = h('button', { type: 'button', class: 'ck-panel-sw', 'aria-label': 'Turn this panel on or off', 'data-tip': 'Turn this panel’s settings on or off (the image updates)' });
      const get = typeof p.switch === 'function' ? p.switch : p.switch.value;
      pm.cell(get, v => { sw.classList.toggle('is-on', v !== false); el.classList.toggle('is-off', v === false); sw.setAttribute('aria-pressed', v !== false ? 'true' : 'false'); });
      listen(pm.scope, sw, 'click', e => {
        e.stopPropagation();
        if (typeof p.switch === 'function') { const path = bindingPath(m.store, p.switch).path; const cur = m.store.peek(path); m.store.tx(`${title.textContent}: ${cur === false ? 'On' : 'Off'}`, t => t.$set(path, cur === false), typeof m.env.txOpts === 'function' ? m.env.txOpts(m.store.readonly()) : {}); }
        else m.run(p.switch.toggle, e);
      });
      head.append(sw);
    }
    if (p.icon) head.append(icon(p.icon, 13, 'ck-panel-ico'));
    head.append(title);
    if (p.aside) head.append(pm.mount(p.aside));
    if (p.menu) {
      const mb = h('button', { type: 'button', class: 'ck-panel-menu', 'aria-label': `${id} panel menu`, 'data-tip': 'Panel menu' }, icon('menu', 12));
      listen(pm.scope, mb, 'click', e => { e.stopPropagation(); const r = mb.getBoundingClientRect(); app.chrome.contextMenu(r.right - 4, r.bottom + 2, typeof p.menu === 'function' ? p.menu(m.store.readonly()) : p.menu, undefined, pm); });
      head.append(mb);
    }
    const tri = h('span', { class: 'ck-panel-tri' }, icon('chevd', 10));
    if (!p.fixed) head.append(tri);
    body.append(...pm.mountAll(n.kids));
    el.append(head, body);
    // open/closed lives in the workspace (view tier), so it is saved with the layout
    if (!p.fixed) {
      const path = ['workspace', 'panels', id, 'open'];
      app.dock.defaults.set(id, p.open !== false);   // Reset Workspace goes back to these
      if (m.store.peek(path) === undefined) m.store.writeDoc([{ path, value: p.open !== false }], { tier: 'view', init: true });
      pm.cell(s => { const w = s.workspace && s.workspace.panels && s.workspace.panels[id]; return !w || w.open !== false; }, open => { el.classList.toggle('is-closed', !open); body.hidden = !open; head.setAttribute('aria-expanded', open ? 'true' : 'false'); });
      const toggle = e => {
        // a control placed in the header (the switch, a menu, a header tool) does its own thing, not this
        if (e.target !== head && e.target.closest('button,input,select,textarea,[role="switch"],[role="button"]:not(.ck-panel-h),.ck-panel-tools')) return;
        const open = m.store.peek(path) !== false;
        if (e.altKey) { app.dock.solo(id, el); return; }
        m.store.set(path, !open);
        if (!open && el.closest('.ck-column.is-solo')) app.dock.solo(id, el);
      };
      listen(pm.scope, head, 'click', toggle);
      listen(pm.scope, head, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
    }
    if (p.reset) {
      title.classList.add('ck-resettable'); title.dataset.tip = 'Double-click to reset this panel';
      listen(pm.scope, title, 'dblclick', e => { e.preventDefault(); e.stopPropagation(); m.store.set(['workspace', 'panels', id, 'open'], true); resetAll(resettables(n, pm), `Reset ${title.textContent}`, pm); });
    }
    if (p.context) context(pm.scope, head, pm, p.context);
    // the panel's own slider ring: , . move between sliders, = - nudge (Lightroom's Develop keys)
    listen(pm.scope, el, 'focusin', () => app.focus.panel = id);
    return el;
  },
});

// ── tabs: a tab strip and one visible body; the active tab is view state ──
defineForm('tabs', {
  slots: { tabs: 'β', bind: 'bind', small: 'β' },
  mount(n, m) {
    const p = n.props, names = Object.keys(p.tabs);
    const el = h('div', { class: 'ck-tabs' });
    const strip = h('div', { class: ['ck-tabs-s', p.small && 'is-small'], role: 'tablist' });
    const body = h('div', { class: 'ck-tabs-b' });
    el.append(strip, body);
    const statePath = p.bind ? bindingPath(m.store, p.bind).path : ['workspace', 'tabs', p.id || names.join('|')];
    if (m.store.peek(statePath) === undefined) m.store.writeDoc([{ path: statePath, value: names[0] }], { tier: 'view', init: true });
    const btns = names.map(name => { const b = h('button', { type: 'button', role: 'tab', class: 'ck-tab', text: name }); listen(m.scope, b, 'click', () => m.store.set(statePath, name)); return b; });
    strip.append(...btns);
    let sub = null;
    m.cell(s => statePath.reduce((o, k) => (o == null ? o : o[k]), s), cur => {
      const name = names.includes(cur) ? cur : names[0];
      btns.forEach((b, i) => { b.classList.toggle('is-on', names[i] === name); b.setAttribute('aria-selected', names[i] === name ? 'true' : 'false'); });
      if (sub) sub.scope.dispose();
      sub = m.child('tab:' + name);
      body.replaceChildren(sub.mount(p.tabs[name]));
    });
    return el;
  },
});

// ── match: swap the layout on a τ value; the state underneath is untouched ──
defineForm('match', {
  slots: { on: 'τ', cases: 'β', of: 'β' },
  mount(n, m) {
    const p = n.props;
    const el = h('div', { class: 'ck-match' });
    let sub = null, curKey;
    m.cell(p.on, v => {
      const key = String(v);
      const c = Object.prototype.hasOwnProperty.call(p.cases, key) ? key : 'default';
      if (c === curKey && sub) return;
      curKey = c;
      if (sub) sub.scope.dispose();
      sub = m.child('case:' + c);
      const target = p.cases[c];
      el.replaceChildren(target ? sub.mount(typeof target === 'function' ? target(v) : target) : h('div', { class: 'ck-empty', text: '' }));
      el.dataset.case = c;
    });
    return el;
  },
});
defineForm('when', {
  slots: { cond: 'τ', then: 'β', else: 'β' },
  mount(n, m) {
    const p = n.props;
    const el = h('div', { class: 'ck-when' }); el.style.display = 'contents';
    let sub = null, cur;
    m.cell(s => !!p.cond(s), v => {
      if (v === cur) return; cur = v;
      if (sub) sub.scope.dispose();
      sub = m.child('when');
      const t = v ? p.then : p.else;
      el.replaceChildren(t ? sub.mount(t) : '');
    });
    return el;
  },
});

// ── toolbar: command ids (icons and keys from the table), nodes, '-' separators ──
defineForm('toolbar', {
  slots: { items: 'β', small: 'β', vertical: 'β' },
  mount(n, m) {
    const el = h('div', { class: ['ck-toolbar', n.props.vertical && 'is-v'], role: 'toolbar' });
    for (const it of n.props.items || []) {
      if (it === '-') { el.append(h('span', { class: 'ck-toolbar-sep' })); continue; }
      if (it === '~') { el.append(h('span', { class: 'ck-spacer' })); continue; }
      if (typeof it === 'string') {
        const c = m.app.commands.get(it);
        el.append(m.mount(node('button', { run: it, icon: c && c.icon, small: n.props.small, quiet: true, label: c && c.icon ? undefined : undefined }, [], n.at)));
        continue;
      }
      el.append(m.mount(it));
    }
    return el;
  },
});
defineForm('bar', { slots: { gap: 'β', align: 'β', justify: 'β', wrap: 'β' }, mount: box('ck-bar') });
defineForm('statusline', {
  slots: { value: 'τ' },
  mount(n, m) { const el = h('div', { class: 'ck-statusline' }); m.val(n.props.value, v => { el.textContent = v || ''; }); return el; },
});
defineForm('hud', {
  slots: { value: 'τ', at: 'β' },
  mount(n, m) { const el = h('div', { class: ['ck-hud', 'at-' + (n.props.at || 'top-right')] }); m.val(n.props.value, v => { el.textContent = v || ''; el.hidden = !v; }); return el; },
});
defineForm('html', { slots: { make: 'ƒ' }, mount(n, m) { return n.props.make(m); } });
defineForm('keys', {
  slots: { chords: 'β' },
  mount(n) { return h('span', { class: 'ck-keys' }, ...[].concat(n.props.chords).map(c => h('kbd', { class: 'ck-kbd', text: chordLabel(c) }))); },
});

export { isNode };
