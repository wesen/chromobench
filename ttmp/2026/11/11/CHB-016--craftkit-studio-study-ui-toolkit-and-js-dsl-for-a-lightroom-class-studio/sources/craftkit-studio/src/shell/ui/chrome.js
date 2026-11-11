// Chrome: the menu bar, popup and context menus, the command palette, the shortcut sheet, dialogs, toasts and
// tooltips. Everything here reads the command table; nothing has its own copy of a label or a key.
import { h, icon, listen, clear } from './dom.js';
import { chordLabel, chordParts } from '../core/keys.js';
import { isMac } from '../core/util.js';

export class Chrome {
  constructor(app) {
    this.app = app;
    this.layer = h('div', { class: 'ck-layer' });
    this.toasts = h('div', { class: 'ck-toasts', role: 'status', 'aria-live': 'polite' });
    this.tip = h('div', { class: 'ck-tip', role: 'tooltip' }); this.tip.hidden = true;
    this.menus = [];
    this.modal = null;
  }
  mount(root) {
    root.append(this.layer, this.toasts, this.tip);
    this.tooltips(root);
  }

  // ── menu items from command ids ─────────────────────────────────────────
  resolve(items, arg) {
    const app = this.app, st = app.store.readonly();
    const out = [];
    for (const it of items || []) {
      if (it == null || it === false) continue;
      if (it === '-') { if (out.length && out[out.length - 1].sep !== true) out.push({ sep: true }); continue; }
      if (typeof it === 'string') {
        if (!app.commands.has(it)) { out.push({ label: it, disabled: true, why: `No command '${it}'` }); continue; }
        const c = app.commands.get(it);
        if (app.commands.hidden(it, st)) continue;
        const status = app.commands.status(it, st);
        out.push({ id: it, label: app.commands.label(it, st), chord: app.keymap.chordsFor(it, app.liveScopes())[0], disabled: !status.ok, why: status.why, checked: app.commands.checked(it, st), icon: c.icon, run: e => app.runCommand(it, e, arg) });
        continue;
      }
      if (it.group) { const ids = app.commands.groups.get(it.group) || []; out.push(...this.resolve(ids, arg)); continue; }
      // a submenu whose items are all hidden here leaves the menu with them
      if (it.items) { if (!this.resolve(it.items, arg).some(x => !x.sep)) continue; out.push({ label: typeof it.label === 'function' ? it.label(st) : it.label, sub: it.items, icon: it.icon }); continue; }
      if (typeof it === 'function') { out.push(...this.resolve([].concat(it(st, arg)), arg)); continue; }
      out.push({ label: typeof it.label === 'function' ? it.label(st) : it.label, chord: it.keys, disabled: typeof it.disabled === 'function' ? it.disabled(st) : it.disabled, why: it.why, checked: typeof it.checked === 'function' ? it.checked(st) : it.checked, run: e => app.runTarget(it.run, [arg, e]) });
    }
    while (out.length && out[out.length - 1].sep) out.pop();
    return out;
  }

  // a popup menu at (x, y); arrows, Enter, Escape; submenus open to the right
  openMenu(items, x, y, arg, opts = {}) {
    if (!opts.parent) this.closeMenus();
    const list = this.resolve(items, arg);
    const el = h('div', { class: 'ck-menu', role: 'menu' });
    let active = -1;
    const rows = list.map((it, i) => {
      if (it.sep) return h('div', { class: 'ck-menu-sep', role: 'separator' });
      const row = h('div', { class: ['ck-menu-i', it.disabled && 'is-disabled', it.sub && 'has-sub'], role: 'menuitem', tabindex: '-1', 'aria-disabled': it.disabled ? 'true' : 'false' });
      row.append(h('span', { class: 'ck-menu-c' }, it.checked ? icon('check', 11) : ''));
      const lab = h('span', { class: 'ck-menu-l' }, it.label);
      if (it.disabled && it.why) lab.append(h('span', { class: 'ck-menu-why', text: it.why }));
      row.append(lab);
      row.append(h('span', { class: 'ck-menu-k', text: it.chord ? chordLabel(it.chord) : '' }));
      if (it.sub) row.append(icon('chevr', 9, 'ck-menu-sub'));
      row.addEventListener('pointerenter', () => setActive(i, true));
      row.addEventListener('click', e => { e.stopPropagation(); activate(i, e); });
      return row;
    });
    el.append(...rows);
    const sub = { el: null };
    const setActive = (i, hover) => {
      active = i;
      rows.forEach((r, j) => r.classList.toggle('is-active', j === i));
      if (sub.el) { this.closeFrom(sub.el); sub.el = null; }
      const it = list[i];
      if (it && it.sub && hover !== false) { const r = rows[i].getBoundingClientRect(); sub.el = this.openMenu(it.sub, r.right - 2, r.top - 4, arg, { parent: el }); }
    };
    const activate = (i, e) => {
      const it = list[i]; if (!it || it.sep) return;
      if (it.disabled) { if (it.why) this.toast(it.why, { kind: 'why', title: it.label }); return; }
      if (it.sub) { setActive(i, true); return; }
      this.closeMenus();
      if (opts.onPick) opts.onPick(it);
      it.run && it.run(e);
    };
    el.addEventListener('keydown', e => {
      const n = list.length;
      const stepTo = d => { let i = active; for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (!list[i].sep) break; } setActive(i, false); rows[i].focus(); };
      if (e.key === 'ArrowDown') { e.preventDefault(); stepTo(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); stepTo(-1); }
      else if (e.key === 'ArrowRight' && list[active] && list[active].sub) { e.preventDefault(); setActive(active, true); const f = sub.el && sub.el.querySelector('.ck-menu-i'); f && f.focus(); }
      else if (e.key === 'ArrowLeft' && opts.parent) { e.preventDefault(); this.closeFrom(el); opts.parent.focus(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { if (opts.onSide) { e.preventDefault(); opts.onSide(e.key === 'ArrowLeft' ? -1 : 1); } }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(active, e); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeMenus(); }
      e.stopPropagation();
    });
    el.tabIndex = -1;
    this.layer.append(el);
    // keep it on screen
    const r = el.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
    el.style.left = Math.max(4, Math.min(x, W - r.width - 4)) + 'px';
    el.style.top = Math.max(4, Math.min(y, H - r.height - 4)) + 'px';
    this.menus.push(el);
    if (!opts.parent) {
      this._onCloseTop = opts.onClose || null;   // however the menu closes (Escape in a submenu, a click away), its title lets go
      el.focus();
      const off = ev => { if (!this.menus.some(mm => mm.contains(ev.target)) && !(opts.keepFor && opts.keepFor.contains(ev.target))) this.closeMenus(); };
      setTimeout(() => { window.addEventListener('pointerdown', off, true); this._off = off; }, 0);
    }
    return el;
  }
  closeFrom(el) { const i = this.menus.indexOf(el); if (i < 0) return; for (const m of this.menus.splice(i)) m.remove(); }
  closeMenus() { for (const m of this.menus.splice(0)) m.remove(); if (this._off) { window.removeEventListener('pointerdown', this._off, true); this._off = null; } const cb = this._onCloseTop; this._onCloseTop = null; if (cb) cb(); }
  contextMenu(x, y, items, arg) { return this.openMenu(items, x, y, arg); }

  // ── the menu bar ────────────────────────────────────────────────────────
  menubar(spec) {
    const bar = h('nav', { class: 'ck-menubar', role: 'menubar' });
    const titles = spec.map((m, i) => {
      const b = h('button', { type: 'button', class: 'ck-menubar-t', role: 'menuitem', text: m.label });
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (openIdx === i) { this.closeMenus(); setOpen(-1); } else open(i); });
      b.addEventListener('pointerenter', () => { if (openIdx >= 0 && openIdx !== i) open(i); });
      return b;
    });
    let openIdx = -1;
    const setOpen = i => { openIdx = i; titles.forEach((t, j) => t.classList.toggle('is-open', j === i)); };
    const open = i => {
      const r = titles[i].getBoundingClientRect();
      // ← → move to the next menu that has something in it
      const side = d => { let j = i; for (let k = 0; k < spec.length; k++) { j = (j + d + spec.length) % spec.length; if (!titles[j].hidden) break; } open(j); };
      this.openMenu(spec[i].items, r.left, r.bottom, undefined, { keepFor: bar, onClose: () => setOpen(-1), onPick: () => setOpen(-1), onSide: side });
      setOpen(i);   // after: opening closes the previous menu, whose close lets its title go
    };
    bar.append(...titles);
    this.menubarOpen = open;
    // a menu whose items are all hidden here (another module's menu) leaves the bar
    bar.refresh = () => titles.forEach((t, i) => { t.hidden = !this.resolve(spec[i].items).length; });
    return bar;
  }

  // ── toasts ──────────────────────────────────────────────────────────────
  toast(text, { kind = 'info', title = '', ms = 2600 } = {}) {
    if (!text) return;
    const t = h('div', { class: ['ck-toast', 'is-' + kind] });
    if (title) t.append(h('b', { text: title }));
    t.append(h('span', { text }));
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 300); }, ms);
  }
  // a brief badge in the middle of an element (Lightroom's "Flag as Pick" flash)
  flash(target, text, kind = 'info') {
    const f = h('div', { class: ['ck-flash', 'is-' + kind], text });
    (target || this.app.root || document.body).append(f);
    setTimeout(() => { f.classList.add('is-out'); setTimeout(() => f.remove(), 260); }, 520);
  }

  // ── dialogs ─────────────────────────────────────────────────────────────
  dialog({ title, body, buttons = [{ label: 'OK', primary: true }], wide = false, onClose, cls = '' }) {
    this.closeMenus();
    const back = h('div', { class: 'ck-modal-back' });
    const dlg = h('div', { class: ['ck-dialog', wide && 'is-wide', cls], role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' });
    const head = h('div', { class: 'ck-dialog-h' }, h('span', { text: title }));
    const close = h('button', { type: 'button', class: 'ck-btn is-icon is-quiet', 'aria-label': 'Close' }, icon('close', 12));
    head.append(close);
    const content = h('div', { class: 'ck-dialog-b' });
    if (body) content.append(typeof body === 'function' ? body(content) : body);
    const foot = h('div', { class: 'ck-dialog-f' });
    const done = r => { back.remove(); this.modal = null; this.app.focus.dialog = false; onClose && onClose(r); };
    const btns = buttons.map(b => { const el = h('button', { type: 'button', class: ['ck-btn', b.primary && 'is-primary'], text: b.label }); el.addEventListener('click', () => { if (b.run && b.run() === false) return; done(b.value ?? b.label); }); return el; });
    foot.append(...btns);
    dlg.append(head, content);
    if (buttons.length) dlg.append(foot);
    back.append(dlg);
    close.addEventListener('click', () => done(null));
    back.addEventListener('pointerdown', e => { if (e.target === back) done(null); });
    dlg.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      if (e.key === 'Enter' && !e.target.matches('textarea,button')) { const p = buttons.findIndex(b => b.primary); if (p >= 0) { e.preventDefault(); btns[p].click(); } }
    });
    this.layer.append(back);
    this.modal = dlg; this.app.focus.dialog = true;
    // focus now, so keys typed right after the shortcut land in the dialog (a frame later they would be lost)
    const first = () => dlg.querySelector('input,select,textarea') || dlg;
    first().focus();
    requestAnimationFrame(() => { if (!dlg.contains(document.activeElement)) first().focus(); });
    return { el: dlg, close: () => done(null), content };
  }

  // ── the command palette ─────────────────────────────────────────────────
  palette() {
    const app = this.app;
    const st = app.store.readonly();
    const entries = [];
    for (const c of app.commands.all()) {
      if (c.palette === false) continue;
      if (app.commands.hidden(c.id, st)) continue;
      entries.push({ kind: 'command', id: c.id, label: app.commands.label(c.id, st), group: c.menu || c.group || '', chord: app.keymap.chordsFor(c.id, app.liveScopes())[0] });
    }
    for (const mod of app.modules.values()) entries.push({ kind: 'module', id: 'module:' + mod.id, label: `Go to ${mod.label}`, group: 'Modules', chord: mod.key ? (() => { try { return app.keymap.bindings.find(b => b.target === 'module.' + mod.id)?.chord; } catch (e) { return null; } })() : null, run: () => app.go(mod.id) });
    for (const id of app.panelIds()) entries.push({ kind: 'panel', id: 'panel:' + id, label: `Show ${app.panelTitle(id)} panel`, group: 'Panels', run: () => app.dock.reveal(id) });
    // the controls of this module's panels: "exposure" finds the Exposure slider, opens its panel and focuses it
    const seen = new Set();
    for (const el of app.root.querySelectorAll('.ck-work .ck-panel[data-panel] .ck-slider')) {
      const label = (el.querySelector('.ck-slider-l') || {}).textContent, panel = el.closest('.ck-panel').dataset.panel;
      if (!label || seen.has(panel + ':' + label)) continue; seen.add(panel + ':' + label);
      entries.push({ kind: 'control', id: 'control:' + panel + ':' + label, label, group: app.panelTitle(panel), run: () => { app.dock.reveal(panel); requestAnimationFrame(() => { const t = el.querySelector('.ck-slider-t'); if (t) { t.focus(); el.scrollIntoView({ block: 'nearest' }); } }); } });
    }
    const recent = app.commands.recent;
    const input = h('input', { class: 'ck-palette-i', placeholder: 'Type a command, a panel or a module…', 'aria-label': 'Command' });
    const listEl = h('div', { class: 'ck-palette-l', role: 'listbox' });
    let shown = [], active = 0;
    // matching: the label first (a word that starts with the query beats one that contains it), then the group;
    // scattered letters count only when they start words ("nc" → New Collection), never one by one across a label
    const words = t => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const score = (q, label, group) => {
      if (!q) return 1;
      const a = q.toLowerCase(), b = label.toLowerCase();
      if (b.startsWith(a)) return 200;
      if (words(b).some(w => w.startsWith(a))) return 160;
      if (b.includes(a)) return 120 - b.indexOf(a);
      const g = (group || '').toLowerCase();
      if (g && words(g).some(w => w.startsWith(a))) return 60;
      const ini = words(b).map(w => w[0]).join('');
      if (a.length >= 2 && ini.startsWith(a)) return 110;
      // every query word starts a word of the label ("exp bri" → Export Brightness)
      const qw = words(a); if (qw.length > 1 && qw.every(x => words(b).some(w => w.startsWith(x)))) return 100;
      return 0;
    };
    const render = () => {
      const q = input.value.trim();
      shown = entries.map(e => { const sc = score(q, e.label, e.group); return { e, s: sc ? sc + (recent.includes(e.id) ? 30 - recent.indexOf(e.id) : 0) + (e.kind === 'command' && !app.commands.status(e.id, st).ok ? -25 : 0) + (e.kind === 'control' ? 20 : 0) : 0 }; })
        .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 40).map(x => x.e);
      active = 0;
      listEl.replaceChildren(...shown.map((e, i) => {
        const status = e.kind === 'command' ? app.commands.status(e.id, st) : { ok: true };
        const row = h('div', { class: ['ck-palette-r', i === 0 && 'is-active', !status.ok && 'is-disabled'], role: 'option' },
          h('span', { class: 'ck-palette-k', text: e.kind === 'command' ? '' : e.kind === 'module' ? 'Module' : e.kind === 'control' ? 'Control' : 'Panel' }),
          h('span', { class: 'ck-palette-t' }, e.label, !status.ok ? h('em', { text: ' — ' + status.why }) : ''),
          h('span', { class: 'ck-palette-g', text: e.group }),
          h('span', { class: 'ck-menu-k', text: e.chord ? chordLabel(e.chord) : '' }));
        row.addEventListener('pointerenter', () => setActive(i));
        row.addEventListener('click', () => pick(i));
        return row;
      }));
    };
    const setActive = i => { active = i; [...listEl.children].forEach((r, j) => r.classList.toggle('is-active', j === i)); const r = listEl.children[i]; r && r.scrollIntoView({ block: 'nearest' }); };
    const pick = i => {
      const e = shown[i]; if (!e) return;
      d.close();
      if (e.run) e.run(); else app.runCommand(e.id);
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(shown.length - 1, active + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(active); }
    });
    const d = this.dialog({ title: 'Commands', body: h('div', { class: 'ck-palette' }, input, listEl), buttons: [], cls: 'is-palette' });
    render();
  }

  // ── the shortcut sheet, generated from the key maps ─────────────────────
  shortcuts() {
    const app = this.app, st = app.store.readonly();
    const order = s => (s === 'global' ? 0 : s.startsWith('module') ? 1 : s === 'canvas' ? 2 : s.startsWith('panel') ? 3 : s.startsWith('tool') ? 4 : s.startsWith('collection') ? 5 : 6);
    const scopeName = s => s.startsWith('collection:') ? `In the ${s.slice(11).replace(/[-_]/g, ' ')} (while it has focus)` : s === 'global' ? 'Everywhere' : s === 'module:*' ? 'Every module' : s.startsWith('module:') ? `${(app.modules.get(s.slice(7)) || { label: s.slice(7) }).label} module` : s === 'canvas' ? 'Over the photo' : s.startsWith('panel:') ? `${app.panelTitle(s.slice(6))} panel` : s.startsWith('tool:') ? `${s.slice(5)} tool` : s;
    const groups = new Map();
    for (const b of app.keymap.bindings) {
      if (b.bad) continue;
      const g = groups.get(b.scope) || groups.set(b.scope, []).get(b.scope);
      g.push({ chord: b.chord, label: typeof b.target === 'string' ? app.commands.label(b.target, st) : Array.isArray(b.target) ? `${app.commands.label(b.target[0], st)} ${b.target.slice(1).join(' ')}` : (b.label || 'Custom action') });
    }
    const springs = app.keymap.springs.map(s => ({ chord: s.chord, label: `Hold for ${s.opts.label || s.tool}` }));
    const search = h('input', { class: 'ck-field-i ck-sheet-q', placeholder: 'Find a shortcut', 'aria-label': 'Find a shortcut' });
    const body = h('div', { class: 'ck-sheet' });
    const render = () => {
      const q = search.value.trim().toLowerCase();
      clear(body);
      const scopes = [...groups.keys()].sort((a, b) => order(a) - order(b));
      const sections = scopes.map(sc => [scopeName(sc), groups.get(sc)]).concat(springs.length ? [['Held keys', springs]] : []);
      for (const [name, rows] of sections) {
        const r = rows.filter(x => !q || x.label.toLowerCase().includes(q) || chordLabel(x.chord).toLowerCase().includes(q));
        if (!r.length) continue;
        body.append(h('div', { class: 'ck-sheet-s' }, h('h4', { text: name }), ...r.sort((a, b) => a.label.localeCompare(b.label)).map(x => h('div', { class: 'ck-sheet-r' }, h('span', { text: x.label }), h('span', { class: 'ck-keys' }, ...chordParts(x.chord).map(k => h('kbd', { class: 'ck-kbd', text: k })))))));
      }
    };
    search.addEventListener('input', render);
    render();
    this.dialog({ title: 'Keyboard Shortcuts', wide: true, body: h('div', {}, h('p', { class: 'ck-sheet-n', text: `Generated from the command table and the key maps. ${isMac ? '⌘ is Command, ⌥ Option, ⇧ Shift.' : 'Ctrl, Alt and Shift as printed.'}` }), search, body), buttons: [{ label: 'Done', primary: true }] });
  }

  // ── tooltips: data-tip, plus data-why on disabled things ───────────────
  tooltips(root) {
    let timer = 0, target = null;
    const show = el => {
      const tip = el.dataset.tip, why = el.dataset.why && el.classList.contains('is-disabled') ? el.dataset.why : '';
      if (!tip && !why) return;
      this.tip.replaceChildren(h('span', { text: tip || '' }), why ? h('em', { text: why }) : '');
      this.tip.hidden = false;
      const r = el.getBoundingClientRect(), t = this.tip.getBoundingClientRect();
      let x = r.left + r.width / 2 - t.width / 2, y = r.bottom + 6;
      if (y + t.height > window.innerHeight - 4) y = r.top - t.height - 6;
      this.tip.style.left = Math.max(4, Math.min(x, window.innerWidth - t.width - 4)) + 'px'; this.tip.style.top = y + 'px';
    };
    root.addEventListener('pointerover', e => {
      const el = e.target.closest && e.target.closest('[data-tip],[data-why]');
      if (el === target) return;
      target = el; clearTimeout(timer); this.tip.hidden = true;
      if (el) timer = setTimeout(() => show(el), 550);
    });
    root.addEventListener('pointerdown', () => { clearTimeout(timer); this.tip.hidden = true; target = null; }, true);
  }
}
