// Chrome as an interface: toasts, flashes, dialogs, menus, the palette, the shortcut sheet, the build report.
// The runtime talks to this; headless runs use a RecordingChrome that keeps everything as data (so a test can
// assert that a disabled command reported its why); '@chromobench/shell/dom' supplies the DOM one.
//
// Menu resolution (labels, chords, disabled-with-why, checked, hidden per module) is headless logic shared by both.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MenuItem } from '../build/types.ts';
import type { Runtime } from './runtime.ts';

export interface ToastOpts {
  kind?: 'info' | 'ok' | 'why' | 'error' | 'warn' | string;
  title?: string;
  ms?: number;
}
export interface DialogButton {
  label: string;
  primary?: boolean;
  value?: unknown;
  run?: () => unknown;
}
export interface DialogSpec {
  title: string;
  body?: unknown;
  buttons?: DialogButton[];
  wide?: boolean;
  cls?: string;
  onClose?: (r: unknown) => void;
}
export interface DialogHandle {
  close(): void;
  readonly result: Promise<unknown>;
  [k: string]: unknown;
}

export interface ChromeApi {
  toast(text: string, o?: ToastOpts): void;
  flash(target: unknown, text: string, kind?: string): void;
  dialog(spec: DialogSpec): DialogHandle;
  palette(): void;
  shortcuts(): void;
  contextMenu(x: number, y: number, items: MenuItem[], arg?: unknown): void;
  showDiagnostics(): void;
  /** the menus need refreshing (module changed) */
  refresh?(): void;
  dispose?(): void;
}

export interface Recorded {
  kind: 'toast' | 'flash' | 'dialog' | 'palette' | 'shortcuts' | 'context' | 'diagnostics';
  text?: string;
  opts?: unknown;
  spec?: unknown;
}

/** Keeps everything as data. */
export class RecordingChrome implements ChromeApi {
  log: Recorded[] = [];
  toasts: { text: string; kind: string; title: string }[] = [];
  dialogs: { spec: DialogSpec; close: (r?: unknown) => void; open: boolean }[] = [];
  toast(text: string, o: ToastOpts = {}): void {
    if (!text) return;
    this.toasts.push({ text, kind: o.kind ?? 'info', title: o.title ?? '' });
    this.log.push({ kind: 'toast', text, opts: o });
  }
  flash(_target: unknown, text: string, kind = 'info'): void {
    this.log.push({ kind: 'flash', text, opts: { kind } });
  }
  dialog(spec: DialogSpec): DialogHandle {
    let resolve!: (r: unknown) => void;
    const result = new Promise(r => (resolve = r));
    const d = {
      spec,
      open: true,
      close: (r: unknown = null) => {
        if (!d.open) return;
        d.open = false;
        spec.onClose?.(r);
        resolve(r);
      },
    };
    this.dialogs.push(d);
    this.log.push({ kind: 'dialog', text: spec.title, spec });
    return { close: () => d.close(null), result };
  }
  palette(): void {
    this.log.push({ kind: 'palette' });
  }
  shortcuts(): void {
    this.log.push({ kind: 'shortcuts' });
  }
  contextMenu(_x: number, _y: number, items: MenuItem[], arg?: unknown): void {
    this.log.push({ kind: 'context', spec: { items, arg } });
  }
  showDiagnostics(): void {
    this.log.push({ kind: 'diagnostics' });
  }
  /** the last toast's text */
  get lastToast(): string | null {
    return this.toasts[this.toasts.length - 1]?.text ?? null;
  }
}

// ── menu items from command ids ──────────────────────────────────────────
export interface MenuRow {
  sep?: true;
  id?: string;
  label?: string;
  chord?: string | undefined;
  disabled?: boolean;
  why?: string | undefined;
  checked?: boolean | undefined;
  icon?: string | undefined;
  sub?: MenuItem[];
  run?: (e?: unknown) => unknown;
}

export function resolveMenu(rt: Runtime<any>, items: MenuItem[] | undefined, arg?: unknown): MenuRow[] {
  const st = rt.store.readonly();
  const out: MenuRow[] = [];
  const call = (v: unknown): any => (typeof v === 'function' ? (v as (s: unknown) => unknown)(st) : v);
  for (const it of items || []) {
    if (it == null || (it as unknown) === false) continue;
    if (it === '-') {
      if (out.length && out[out.length - 1]!.sep !== true) out.push({ sep: true });
      continue;
    }
    if (typeof it === 'string') {
      if (!rt.commands.has(it)) {
        out.push({ label: it, disabled: true, why: `No command '${it}'` });
        continue;
      }
      const c = rt.commands.get(it)!;
      if (rt.commands.hidden(it, st)) continue;
      const status = rt.commands.status(it, st);
      out.push({
        id: it,
        label: rt.commands.label(it, st),
        chord: rt.keymap.chordsFor(it, rt.liveScopes())[0],
        disabled: !status.ok,
        why: status.why,
        checked: rt.commands.checked(it, st),
        icon: c.icon,
        run: e => rt.runCommand(it, e, ...(arg !== undefined ? [arg] : [])),
      });
      continue;
    }
    if (typeof it === 'function') {
      out.push(...resolveMenu(rt, ([] as MenuItem[]).concat(it(st, arg)), arg));
      continue;
    }
    if (typeof it === 'object' && it.group) {
      out.push(...resolveMenu(rt, rt.commands.groups.get(it.group) || [], arg));
      continue;
    }
    // a submenu whose items are all hidden here leaves the menu with them
    if (typeof it === 'object' && Array.isArray(it.items)) {
      if (!resolveMenu(rt, it.items, arg).some(x => !x.sep)) continue;
      out.push({ label: call(it.label), sub: it.items, icon: it['icon'] as string | undefined });
      continue;
    }
    if (typeof it === 'object') {
      const row: MenuRow = { label: call(it.label), chord: it['keys'] as string | undefined, disabled: !!call(it['disabled']), why: it['why'] as string | undefined, checked: call(it['checked']) };
      if (it.run !== undefined) row.run = e => rt.runTarget(it.run!, [arg, e].filter(x => x !== undefined));
      out.push(row);
    }
  }
  while (out.length && out[out.length - 1]!.sep) out.pop();
  return out;
}

/** The menu bar: the program's menus (kits' merged in) or menus generated from the commands' `menu` field. Help stays last. */
export function menuBar(rt: Runtime<any>): { label: string; items: MenuItem[] }[] {
  const ir = rt.app.ir;
  let menus: { label: string; items: MenuItem[] }[];
  if (ir.menus.length) menus = ir.menus.map(m => ({ label: m.label, items: m.items }));
  else {
    const byMenu = new Map<string, string[]>();
    for (const c of rt.commands.all()) {
      if (!c.menu) continue;
      if (!byMenu.has(c.menu)) byMenu.set(c.menu, []);
      byMenu.get(c.menu)!.push(c.id);
    }
    menus = [...byMenu.entries()].map(([label, items]) => ({ label, items }));
  }
  const order = ['File', 'Edit'];
  return menus.slice().sort((a, b) => {
    const ra = a.label === 'Help' ? 99 : order.includes(a.label) ? order.indexOf(a.label) - 10 : 0;
    const rb = b.label === 'Help' ? 99 : order.includes(b.label) ? order.indexOf(b.label) - 10 : 0;
    return ra - rb;
  });
}

export interface PaletteEntry {
  kind: 'command' | 'module' | 'panel' | 'control';
  id: string;
  label: string;
  group: string;
  chord?: string | null | undefined;
  disabled?: boolean;
  why?: string | undefined;
  run?: () => void;
}
/** Palette entries from the table: commands (not hidden here), modules, panels. The DOM adds controls. */
export function paletteEntries(rt: Runtime<any>): PaletteEntry[] {
  const st = rt.store.readonly();
  const out: PaletteEntry[] = [];
  for (const c of rt.commands.all()) {
    if (c.palette === false) continue;
    if (rt.commands.hidden(c.id, st)) continue;
    const s = rt.commands.status(c.id, st);
    out.push({ kind: 'command', id: c.id, label: rt.commands.label(c.id, st), group: c.menu || c.group || '', chord: rt.keymap.chordsFor(c.id, rt.liveScopes())[0], disabled: !s.ok, why: s.why });
  }
  for (const mod of rt.modules.values()) out.push({ kind: 'module', id: 'module:' + mod.id, label: `Go to ${mod.label}`, group: 'Modules', chord: rt.keymap.chordsFor('module.' + mod.id)[0] ?? null, run: () => rt.go(mod.id) });
  for (const id of rt.panels.keys()) out.push({ kind: 'panel', id: 'panel:' + id, label: `Show ${rt.panelTitle(id)} panel`, group: 'Panels', run: () => rt.workspace.reveal(id) });
  return out;
}

/** Palette matching: the label first (a word that starts with the query beats one that contains it), then the group. */
export function paletteScore(q: string, label: string, group: string): number {
  if (!q) return 1;
  const words = (t: string): string[] => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const a = q.toLowerCase();
  const b = label.toLowerCase();
  if (b.startsWith(a)) return 200;
  if (words(b).some(w => w.startsWith(a))) return 160;
  if (b.includes(a)) return 120 - b.indexOf(a);
  const g = (group || '').toLowerCase();
  if (g && words(g).some(w => w.startsWith(a))) return 60;
  const ini = words(b)
    .map(w => w[0])
    .join('');
  if (a.length >= 2 && ini.startsWith(a)) return 110;
  const qw = words(a);
  if (qw.length > 1 && qw.every(x => words(b).some(w => w.startsWith(x)))) return 100;
  return 0;
}
export function searchPalette(rt: Runtime<any>, q: string, entries: PaletteEntry[] = paletteEntries(rt)): PaletteEntry[] {
  const recent = rt.commands.recent;
  return entries
    .map(e => {
      const sc = paletteScore(q.trim(), e.label, e.group);
      return { e, s: sc ? sc + (recent.includes(e.id) ? 30 - recent.indexOf(e.id) : 0) + (e.disabled ? -25 : 0) + (e.kind === 'control' ? 20 : 0) : 0 };
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 40)
    .map(x => x.e);
}
