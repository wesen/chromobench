// The DOM chrome (port of CraftKit ui/chrome.js): the menu bar, popup and context menus, the command palette, the
// shortcut sheet, dialogs, toasts and tooltips. Everything here reads the command table; nothing has its own copy
// of a label or a key.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { chordLabel, chordParts } from '../core/keys.ts';
import { formatDiag } from '../core/diag.ts';
import { resolveMenu, paletteEntries, searchPalette, type ChromeApi, type DialogSpec, type DialogHandle, type ToastOpts, type PaletteEntry } from '../app/chrome.ts';
import type { MenuItem } from '../build/types.ts';
import { h, icon, clear } from './h.ts';
import type { DomApp } from './mount.ts';

export class DomChrome implements ChromeApi {
  readonly dom: DomApp;
  layer: HTMLElement;
  toasts: HTMLElement;
  tip: HTMLElement;
  menus: HTMLElement[] = [];
  modal: HTMLElement | null = null;
  /** what was shown, for tests and the inspector */
  log: { kind: string; text?: string }[] = [];
  private offPointer: ((e: Event) => void) | null = null;
  private onCloseTop: (() => void) | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  constructor(dom: DomApp) {
    this.dom = dom;
    this.layer = h('div', { class: 'ck-layer' });
    this.toasts = h('div', { class: 'ck-toasts', role: 'status', 'aria-live': 'polite' });
    this.tip = h('div', { class: 'ck-tip', role: 'tooltip' });
    this.tip.hidden = true;
  }
  private get rt() {
    return this.dom.rt;
  }
  private later(f: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      f();
    }, ms);
    this.timers.add(t);
  }
  mount(root: HTMLElement): void {
    root.append(this.layer, this.toasts, this.tip);
    this.tooltips(root);
  }
  dispose(): void {
    this.closeMenus();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // ── popup menus ─────────────────────────────────────────────────────────
  openMenu(items: MenuItem[], x: number, y: number, arg?: unknown, opts: { parent?: HTMLElement; keepFor?: HTMLElement; onClose?: () => void; onPick?: (it: unknown) => void; onSide?: (d: number) => void } = {}): HTMLElement {
    if (!opts.parent) this.closeMenus();
    const list = resolveMenu(this.rt, items, arg);
    const el = h('div', { class: 'ck-menu', role: 'menu' });
    let active = -1;
    const sub: { el: HTMLElement | null } = { el: null };
    const rows = list.map((it, i) => {
      if (it.sep) return h('div', { class: 'ck-menu-sep', role: 'separator' });
      const row = h('div', { class: ['ck-menu-i', it.disabled && 'is-disabled', it.sub && 'has-sub'], role: 'menuitem', tabindex: '-1', 'aria-disabled': it.disabled ? 'true' : 'false', 'data-command': it.id });
      row.append(h('span', { class: 'ck-menu-c' }, it.checked ? icon('check', 11) : ''));
      const lab = h('span', { class: 'ck-menu-l' }, it.label ?? '');
      if (it.disabled && it.why) lab.append(h('span', { class: 'ck-menu-why', text: it.why }));
      row.append(lab);
      row.append(h('span', { class: 'ck-menu-k', text: it.chord ? chordLabel(it.chord, this.rt.platform) : '' }));
      if (it.sub) row.append(icon('chevr', 9, 'ck-menu-sub'));
      row.addEventListener('pointerenter', () => setActive(i, true));
      row.addEventListener('click', e => {
        e.stopPropagation();
        activate(i, e);
      });
      return row;
    });
    el.append(...rows);
    const setActive = (i: number, hover: boolean): void => {
      active = i;
      rows.forEach((r, j) => r.classList.toggle('is-active', j === i));
      if (sub.el) {
        this.closeFrom(sub.el);
        sub.el = null;
      }
      const it = list[i];
      if (it && it.sub && hover !== false) {
        const r = rows[i]!.getBoundingClientRect();
        sub.el = this.openMenu(it.sub, r.right - 2, r.top - 4, arg, { parent: el });
      }
    };
    const activate = (i: number, e: Event): void => {
      const it = list[i];
      if (!it || it.sep) return;
      if (it.disabled) {
        if (it.why) this.toast(it.why, { kind: 'why', title: it.label ?? '' });
        return;
      }
      if (it.sub) {
        setActive(i, true);
        return;
      }
      this.closeMenus();
      opts.onPick?.(it);
      it.run?.(e);
    };
    el.addEventListener('keydown', e => {
      const n = list.length;
      const stepTo = (d: number): void => {
        let i = active;
        for (let k = 0; k < n; k++) {
          i = (i + d + n) % n;
          if (!list[i]!.sep) break;
        }
        setActive(i, false);
        rows[i]!.focus();
      };
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        stepTo(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        stepTo(-1);
      } else if (e.key === 'ArrowRight' && list[active]?.sub) {
        e.preventDefault();
        setActive(active, true);
        (sub.el?.querySelector('.ck-menu-i') as HTMLElement | null)?.focus();
      } else if (e.key === 'ArrowLeft' && opts.parent) {
        e.preventDefault();
        this.closeFrom(el);
        opts.parent.focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (opts.onSide) {
          e.preventDefault();
          opts.onSide(e.key === 'ArrowLeft' ? -1 : 1);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(active, e);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeMenus();
      }
      e.stopPropagation();
    });
    el.tabIndex = -1;
    this.layer.append(el);
    // keep it on screen
    const r = el.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    el.style.left = Math.max(4, Math.min(x, W - r.width - 4)) + 'px';
    el.style.top = Math.max(4, Math.min(y, H - r.height - 4)) + 'px';
    this.menus.push(el);
    if (!opts.parent) {
      this.onCloseTop = opts.onClose || null;
      el.focus();
      const off = (ev: Event): void => {
        if (!this.menus.some(mm => mm.contains(ev.target as Node)) && !opts.keepFor?.contains(ev.target as Node)) this.closeMenus();
      };
      this.later(() => {
        window.addEventListener('pointerdown', off, true);
        this.offPointer = off;
      }, 0);
    }
    this.log.push({ kind: 'menu' });
    return el;
  }
  closeFrom(el: HTMLElement): void {
    const i = this.menus.indexOf(el);
    if (i < 0) return;
    for (const m of this.menus.splice(i)) m.remove();
  }
  closeMenus(): void {
    for (const m of this.menus.splice(0)) m.remove();
    if (this.offPointer) {
      window.removeEventListener('pointerdown', this.offPointer, true);
      this.offPointer = null;
    }
    const cb = this.onCloseTop;
    this.onCloseTop = null;
    cb?.();
  }
  contextMenu(x: number, y: number, items: MenuItem[], arg?: unknown): void {
    this.openMenu(items, x, y, arg);
  }

  // ── the menu bar ────────────────────────────────────────────────────────
  menubar(spec: { label: string; items: MenuItem[] }[]): HTMLElement & { refresh(): void } {
    const bar = h('nav', { class: 'ck-menubar', role: 'menubar' }) as HTMLElement & { refresh(): void };
    let openIdx = -1;
    const titles = spec.map((m, i) => {
      const b = h('button', { type: 'button', class: 'ck-menubar-t', role: 'menuitem', text: m.label });
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        if (openIdx === i) {
          this.closeMenus();
          setOpen(-1);
        } else open(i);
      });
      b.addEventListener('pointerenter', () => {
        if (openIdx >= 0 && openIdx !== i) open(i);
      });
      return b;
    });
    const setOpen = (i: number): void => {
      openIdx = i;
      titles.forEach((t, j) => t.classList.toggle('is-open', j === i));
    };
    const open = (i: number): void => {
      const r = titles[i]!.getBoundingClientRect();
      const side = (d: number): void => {
        let j = i;
        for (let k = 0; k < spec.length; k++) {
          j = (j + d + spec.length) % spec.length;
          if (!titles[j]!.hidden) break;
        }
        open(j);
      };
      this.openMenu(spec[i]!.items, r.left, r.bottom, undefined, { keepFor: bar, onClose: () => setOpen(-1), onPick: () => setOpen(-1), onSide: side });
      setOpen(i);
    };
    bar.append(...titles);
    // a menu whose items are all hidden here (another module's menu) leaves the bar
    bar.refresh = () => titles.forEach((t, i) => void (t.hidden = !resolveMenu(this.rt, spec[i]!.items).length));
    return bar;
  }

  // ── toasts ──────────────────────────────────────────────────────────────
  toast(text: string, { kind = 'info', title = '', ms = 2600 }: ToastOpts = {}): void {
    if (!text) return;
    this.log.push({ kind: 'toast', text });
    const t = h('div', { class: ['ck-toast', 'is-' + kind] });
    if (title) t.append(h('b', { text: title }));
    t.append(h('span', { text }));
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild!.remove();
    this.later(() => {
      t.classList.add('is-out');
      this.later(() => t.remove(), 300);
    }, ms);
  }
  /** a brief badge in the middle of an element (Lightroom's "Flag as Pick" flash) */
  flash(target: unknown, text: string, kind = 'info'): void {
    const f = h('div', { class: ['ck-flash', 'is-' + kind], text });
    const host = (target as any)?.el instanceof HTMLElement ? (target as any).el : target instanceof HTMLElement ? target : this.dom.root;
    host.append(f);
    this.later(() => {
      f.classList.add('is-out');
      this.later(() => f.remove(), 260);
    }, 520);
  }

  // ── dialogs ─────────────────────────────────────────────────────────────
  dialog({ title, body, buttons = [{ label: 'OK', primary: true }], wide = false, onClose, cls = '' }: DialogSpec): DialogHandle {
    this.closeMenus();
    this.log.push({ kind: 'dialog', text: title });
    let resolve!: (r: unknown) => void;
    const result = new Promise<unknown>(r => (resolve = r));
    const back = h('div', { class: 'ck-modal-back' });
    const dlg = h('div', { class: ['ck-dialog', wide && 'is-wide', cls], role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' });
    const head = h('div', { class: 'ck-dialog-h' }, h('span', { text: title }));
    const close = h('button', { type: 'button', class: 'ck-btn is-icon is-quiet', 'aria-label': 'Close' }, icon('close', 12));
    head.append(close);
    const content = h('div', { class: 'ck-dialog-b' });
    if (body) content.append(typeof body === 'function' ? body(content) : (body as Node));
    const foot = h('div', { class: 'ck-dialog-f' });
    let open = true;
    const done = (r: unknown): void => {
      if (!open) return;
      open = false;
      back.remove();
      this.modal = null;
      this.rt.focus.dialog = false;
      onClose?.(r);
      resolve(r);
    };
    const btns = buttons.map(b => {
      const el = h('button', { type: 'button', class: ['ck-btn', b.primary && 'is-primary'], text: b.label });
      el.addEventListener('click', () => {
        if (b.run && b.run() === false) return;
        done(b.value ?? b.label);
      });
      return el;
    });
    foot.append(...btns);
    dlg.append(head, content);
    if (buttons.length) dlg.append(foot);
    back.append(dlg);
    close.addEventListener('click', () => done(null));
    back.addEventListener('pointerdown', e => {
      if (e.target === back) done(null);
    });
    dlg.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        done(null);
      }
      if (e.key === 'Enter' && !(e.target as HTMLElement).matches('textarea,button')) {
        const p = buttons.findIndex(b => b.primary);
        if (p >= 0) {
          e.preventDefault();
          btns[p]!.click();
        }
      }
    });
    this.layer.append(back);
    this.modal = dlg;
    this.rt.focus.dialog = true;
    // focus now, so keys typed right after the shortcut land in the dialog
    const first = (): HTMLElement => (dlg.querySelector('input,select,textarea') as HTMLElement) || dlg;
    first().focus();
    return { el: dlg, content, close: () => done(null), result };
  }

  // ── the command palette ─────────────────────────────────────────────────
  palette(): void {
    const rt = this.rt;
    const entries: PaletteEntry[] = paletteEntries(rt);
    // the controls of this module's panels: "exposure" finds the Exposure slider, opens its panel and focuses it
    const seen = new Set<string>();
    for (const el of this.dom.root.querySelectorAll('.ck-work .ck-panel[data-panel] .ck-slider')) {
      const label = el.querySelector('.ck-slider-l')?.textContent;
      const panel = (el.closest('.ck-panel') as HTMLElement).dataset['panel']!;
      if (!label || seen.has(panel + ':' + label)) continue;
      seen.add(panel + ':' + label);
      entries.push({
        kind: 'control',
        id: 'control:' + panel + ':' + label,
        label,
        group: rt.panelTitle(panel),
        run: () => {
          rt.workspace.reveal(panel);
          (el.querySelector('.ck-slider-t') as HTMLElement | null)?.focus();
        },
      });
    }
    const input = h('input', { class: 'ck-palette-i', placeholder: 'Type a command, a panel or a module…', 'aria-label': 'Command' });
    const listEl = h('div', { class: 'ck-palette-l', role: 'listbox' });
    let shown: PaletteEntry[] = [];
    let active = 0;
    const render = (): void => {
      shown = searchPalette(rt, input.value, entries);
      active = 0;
      listEl.replaceChildren(
        ...shown.map((e, i) => {
          const row = h(
            'div',
            { class: ['ck-palette-r', i === 0 && 'is-active', e.disabled && 'is-disabled'], role: 'option', 'data-id': e.id },
            h('span', { class: 'ck-palette-k', text: e.kind === 'command' ? '' : e.kind === 'module' ? 'Module' : e.kind === 'control' ? 'Control' : 'Panel' }),
            h('span', { class: 'ck-palette-t' }, e.label, e.disabled ? h('em', { text: ' — ' + e.why }) : ''),
            h('span', { class: 'ck-palette-g', text: e.group }),
            h('span', { class: 'ck-menu-k', text: e.chord ? chordLabel(e.chord, rt.platform) : '' }),
          );
          row.addEventListener('pointerenter', () => setActive(i));
          row.addEventListener('click', () => pick(i));
          return row;
        }),
      );
    };
    const setActive = (i: number): void => {
      active = i;
      [...listEl.children].forEach((r, j) => r.classList.toggle('is-active', j === i));
      (listEl.children[i] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
    };
    const pick = (i: number): void => {
      const e = shown[i];
      if (!e) return;
      d.close();
      if (e.run) e.run();
      else rt.runCommand(e.id, null);
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(Math.min(shown.length - 1, active + 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(0, active - 1));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        pick(active);
      }
    });
    const d = this.dialog({ title: 'Commands', body: h('div', { class: 'ck-palette' }, input, listEl), buttons: [], cls: 'is-palette' });
    render();
  }

  // ── the shortcut sheet, generated from the key maps ─────────────────────
  shortcuts(): void {
    const rt = this.rt;
    const st = rt.store.readonly();
    const order = (s: string): number => (s === 'global' ? 0 : s.startsWith('module') ? 1 : s === 'canvas' ? 2 : s.startsWith('panel') ? 3 : s.startsWith('tool') ? 4 : s.startsWith('collection') ? 5 : 6);
    const scopeName = (s: string): string =>
      s.startsWith('collection:')
        ? `In the ${s.slice(11).replace(/[-_]/g, ' ')} (while it has focus)`
        : s === 'global'
          ? 'Everywhere'
          : s === 'module:*'
            ? 'Every module'
            : s.startsWith('module:')
              ? `${rt.modules.get(s.slice(7))?.label ?? s.slice(7)} module`
              : s === 'canvas'
                ? 'Over the photo'
                : s.startsWith('panel:')
                  ? `${rt.panelTitle(s.slice(6))} panel`
                  : s.startsWith('tool:')
                    ? `${s.slice(5)} tool`
                    : s;
    const groups = new Map<string, { chord: string; label: string }[]>();
    for (const b of rt.keymap.bindings) {
      if (b.bad) continue;
      const g = groups.get(b.scope) || groups.set(b.scope, []).get(b.scope)!;
      g.push({ chord: b.chord, label: typeof b.target === 'string' ? rt.commands.label(b.target, st) : Array.isArray(b.target) ? `${rt.commands.label(b.target[0], st)} ${b.target.slice(1).join(' ')}` : b.label || 'Custom action' });
    }
    const springs = rt.keymap.springs.map(s => ({ chord: s.chord, label: `Hold for ${s.opts.label || s.tool}` }));
    const search = h('input', { class: 'ck-field-i ck-sheet-q', placeholder: 'Find a shortcut', 'aria-label': 'Find a shortcut' });
    const body = h('div', { class: 'ck-sheet' });
    const render = (): void => {
      const q = search.value.trim().toLowerCase();
      clear(body);
      const scopes = [...groups.keys()].sort((a, b) => order(a) - order(b));
      const sections: [string, { chord: string; label: string }[]][] = scopes.map(sc => [scopeName(sc), groups.get(sc)!] as [string, { chord: string; label: string }[]]).concat(springs.length ? [['Held keys', springs]] : []);
      for (const [name, rows] of sections) {
        const r = rows.filter(x => !q || x.label.toLowerCase().includes(q) || chordLabel(x.chord, rt.platform).toLowerCase().includes(q));
        if (!r.length) continue;
        body.append(
          h(
            'div',
            { class: 'ck-sheet-s' },
            h('h4', { text: name }),
            ...r.sort((a, b) => a.label.localeCompare(b.label)).map(x => h('div', { class: 'ck-sheet-r' }, h('span', { text: x.label }), h('span', { class: 'ck-keys' }, ...chordParts(x.chord, rt.platform).map(k => h('kbd', { class: 'ck-kbd', text: k }))))),
          ),
        );
      }
    };
    search.addEventListener('input', render);
    render();
    this.dialog({
      title: 'Keyboard Shortcuts',
      wide: true,
      body: h('div', {}, h('p', { class: 'ck-sheet-n', text: `Generated from the command table and the key maps. ${rt.platform.mac ? '⌘ is Command, ⌥ Option, ⇧ Shift.' : 'Ctrl, Alt and Shift as printed.'}` }), search, body),
      buttons: [{ label: 'Done', primary: true }],
    });
  }

  showDiagnostics(): void {
    const D = this.rt.diagnostics;
    const list = h('div', { class: 'ck-diag' });
    const rank = { error: 0, warning: 1, info: 2 } as const;
    for (const d of D.list.slice().sort((a, b) => rank[a.level] - rank[b.level])) list.append(h('pre', { class: 'ck-diag-r is-' + d.level, text: formatDiag(d) }));
    this.dialog({ title: `Build report · ${D.summary()}`, wide: true, body: list, buttons: [{ label: 'Close', primary: true }] });
  }

  // ── tooltips: data-tip, plus data-why on disabled things ───────────────
  tooltips(root: HTMLElement): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let target: HTMLElement | null = null;
    const show = (el: HTMLElement): void => {
      const tip = el.dataset['tip'];
      const why = el.dataset['why'] && el.classList.contains('is-disabled') ? el.dataset['why'] : '';
      if (!tip && !why) return;
      this.tip.replaceChildren(h('span', { text: tip || '' }), why ? h('em', { text: why }) : '');
      this.tip.hidden = false;
      const r = el.getBoundingClientRect();
      const t = this.tip.getBoundingClientRect();
      const x = r.left + r.width / 2 - t.width / 2;
      let y = r.bottom + 6;
      if (y + t.height > window.innerHeight - 4) y = r.top - t.height - 6;
      this.tip.style.left = Math.max(4, Math.min(x, window.innerWidth - t.width - 4)) + 'px';
      this.tip.style.top = y + 'px';
    };
    root.addEventListener('pointerover', e => {
      const el = (e.target as HTMLElement).closest?.('[data-tip],[data-why]') as HTMLElement | null;
      if (el === target) return;
      target = el;
      if (timer) clearTimeout(timer);
      this.tip.hidden = true;
      if (el) timer = setTimeout(() => show(el), 550);
    });
    root.addEventListener(
      'pointerdown',
      () => {
        if (timer) clearTimeout(timer);
        this.tip.hidden = true;
        target = null;
      },
      true,
    );
  }
}
