// The shell, its modules and its menus as immutable values (port of CraftKit shell.js, builder half; CHB-035 §30,
// §32). `ck.shell(name)` is a value; every chain method returns a new one; `.build()` installs the kits, runs the `ui`
// passes and returns a BuiltApp with its diagnostics. A layout places what kits declare: it installs kits (.use),
// places modules (.module(ck.module(id, …))) and menus (.menus(ck.menu(label, items))), and binds global keys.
// Commands, tools, panels and passes come from kits only.
//
// Scopes follow where keys are declared: the shell's are global, a module's are module:<id>, a kit's kit:<name>.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { modifier, site, type CallSite, type Modifier } from '@chromobench/values';
import type { KeyTarget, Spring } from '../core/keys.ts';
import type { TxOpts } from '../core/store.ts';
import type { NodeData } from '../ir/node.ts';
import { BuilderKind, type Built, type BuilderWith } from './builder.ts';
import { isKit } from './kits.ts';
import type { BuiltApp } from '../app/built-app.ts';
import type { Fragment, Kit, KeyDef, MenuDef, MenuItem, ModuleDef, Region, ShellOpts, SpringDef, StateOpts, Theme } from './types.ts';

/** The shell's data: what a layout records. */
export interface ShellDef {
  name: string;
  opts: ShellOpts;
  at: CallSite | null;
  init: any;
  stateOpts: StateOpts;
  derived: { path: string; fn: (s: any) => unknown; at: CallSite | null }[];
  menus: MenuDef[];
  keys: KeyDef[];
  springs: SpringDef[];
  modules: ModuleDef[];
  contexts: [string, unknown][];
  events: { event: string; f: KeyTarget; at: CallSite | null }[];
  palette: { keys: string };
  uses: { kit: Kit; at: CallSite | null }[];
  theme: string | null;
  themes: Theme[];
  icons: Record<string, string>;
}

// ── menus ─────────────────────────────────────────────────────────────────
export interface MenuValue extends Built<MenuDef> {
  with(x: BuilderWith<MenuDef, MenuValue>): MenuValue;
}
export const MENUS = new BuilderKind<MenuDef, MenuValue>('menu', { methods: {} });
/** a menu: a label and its items (command ids, '-' separators, submenus { label, items }) */
export const menu = (label: string, items: MenuItem[]): MenuValue => {
  const at = site();
  return MENUS.make({ label, items: items.slice(), at }, at);
};

// ── modules ───────────────────────────────────────────────────────────────
export interface ModuleProps<S = any> {
  label?: string;
  key?: string | null;
  icon?: string | null;
  /** transaction options for edits made in this module: ({ channel, snapPath }) files them into a History list */
  txOpts?: ((s: S) => TxOpts) | TxOpts;
  onEnter?: KeyTarget;
  /** Esc tries this first (return false to let the shell continue) */
  onEscape?: KeyTarget;
}

export interface ModuleValue<S = any> extends Built<ModuleDef<S>> {
  readonly id: string;
  with(x: BuilderWith<ModuleDef<S>, ModuleValue<S>>): ModuleValue<S>;
  label(v: string): ModuleValue<S>;
  key(v: string | null): ModuleValue<S>;
  icon(v: string | null): ModuleValue<S>;
  top(n: NodeData | null): ModuleValue<S>;
  left(n: NodeData | null): ModuleValue<S>;
  center(n: NodeData | null): ModuleValue<S>;
  right(n: NodeData | null): ModuleValue<S>;
  bottom(n: NodeData | null): ModuleValue<S>;
  toolbar(n: NodeData | null): ModuleValue<S>;
  /** keys in scope module:<id>: only while this module is current */
  keys(map: Record<string, KeyTarget>): ModuleValue<S>;
  txOpts(f: ((s: S) => TxOpts) | TxOpts): ModuleValue<S>;
  onEnter(f: KeyTarget): ModuleValue<S>;
  onEscape(f: KeyTarget): ModuleValue<S>;
  [fragment: string]: unknown;
}

type MM = Modifier<ModuleDef>;
const region = (side: Region) => (n: NodeData | null): MM => modifier<ModuleDef>(side, d => ({ ...d, regions: { ...d.regions, [side]: n } }), [n]);
const field = <K extends keyof ModuleDef>(k: K) => (v: ModuleDef[K]): MM => modifier<ModuleDef>(k, d => ({ ...d, [k]: v }), [v]);

/** the module modifiers (the chain methods of a module) */
export const moduleMods = {
  label: field('label'),
  key: field('key'),
  icon: field('icon'),
  top: region('top'),
  left: region('left'),
  center: region('center'),
  right: region('right'),
  bottom: region('bottom'),
  toolbar: region('toolbar'),
  keys: (map: Record<string, KeyTarget>): MM => {
    const at = site();
    return modifier<ModuleDef>('keys', d => ({ ...d, keys: [...d.keys, { scope: 'module:' + d.id, map, at }] }), [map]);
  },
  txOpts: field('txOpts'),
  onEnter: field('onEnter'),
  onEscape: field('onEscape'),
};

export function moduleKind(fragments: () => readonly Fragment[]): BuilderKind<ModuleDef, ModuleValue> {
  return new BuilderKind<ModuleDef, ModuleValue>('module', {
    methods: moduleMods as unknown as Record<string, (...a: any[]) => MM>,
    target: 'module',
    fragments,
    derived: d => ({ id: d.id }),
  });
}
const defaultLabel = (id: string): string => (id ? id[0]!.toUpperCase() + id.slice(1) : id);
export const moduleData = (id: string, props: ModuleProps, at: CallSite | null): ModuleDef => ({
  id,
  label: props.label ?? defaultLabel(id),
  key: props.key ?? null,
  icon: props.icon ?? null,
  regions: {},
  keys: [],
  at,
  ...(props.txOpts !== undefined ? { txOpts: props.txOpts } : {}),
  ...(props.onEnter !== undefined ? { onEnter: props.onEnter } : {}),
  ...(props.onEscape !== undefined ? { onEscape: props.onEscape } : {}),
});

// ── the shell ─────────────────────────────────────────────────────────────
export interface ShellValue<S = any> extends Built<ShellDef> {
  with(x: BuilderWith<ShellDef, ShellValue<S>>): ShellValue<S>;
  /** the program's own state (kits add their slices) and the state options */
  state<S2 extends object>(init: S2, opts?: StateOpts<S2>): ShellValue<S2>;
  use<K extends Kit>(k: K): ShellValue<S & NonNullable<K['_state']>>;
  derive(path: string, fn: (s: S) => unknown): ShellValue<S>;
  /** place menus (a second menu with the same label adds to that menu, after a separator) */
  menus(...menus: MenuValue[]): ShellValue<S>;
  /** keys in scope global (no single letters: CK-K210) */
  keys(map: Record<string, KeyTarget>): ShellValue<S>;
  spring(chord: string, tool: Spring['tool'], opts?: Spring['opts']): ShellValue<S>;
  module(m: ModuleValue<any>): ShellValue<S>;
  context(scope: string, items: unknown): ShellValue<S>;
  palette(o: { keys?: string }): ShellValue<S>;
  on(event: string, f: KeyTarget): ShellValue<S>;
  /** select a theme by name, or define one and select it */
  theme(t: string | Theme): ShellValue<S>;
  icons(map: Record<string, string>): ShellValue<S>;
  build(opts?: { platform?: { mac: boolean } }): BuiltApp<S>;
  [fragment: string]: unknown;
}

type SM = Modifier<ShellDef>;
const append = (name: string, key: keyof ShellDef, item: (d: ShellDef) => unknown, args: unknown[] = []): SM =>
  modifier<ShellDef>(name, d => ({ ...d, [key]: [...(d[key] as unknown[]), item(d)] }), args);

/** the shell modifiers (the chain methods of a shell) */
export const shellMods = {
  state: (init: object, opts: StateOpts = {}): SM => modifier<ShellDef>('state', d => ({ ...d, init, stateOpts: opts }), [init]),
  use: (k: Kit): SM => {
    if (!isKit(k)) throw new TypeError('.use(kit): not a kit (make one with ck.kit(name))');
    const at = site();
    return append('use', 'uses', () => ({ kit: k, at }), [k.name]);
  },
  derive: (path: string, fn: (s: any) => unknown): SM => {
    const at = site();
    return append('derive', 'derived', () => ({ path, fn, at }), [path]);
  },
  menus: (...menus: MenuValue[]): SM => {
    for (const m of menus) if (!MENUS.is(m)) throw new TypeError('.menus(...menus): menus are ck.menu(label, items)');
    return modifier<ShellDef>(
      'menus',
      d => {
        const out = d.menus.slice();
        for (const m of menus) {
          const i = out.findIndex(x => x.label === m.data.label);
          if (i >= 0) out[i] = { ...out[i]!, items: [...out[i]!.items, '-', ...m.data.items] };
          else out.push(m.data);
        }
        return { ...d, menus: out };
      },
      menus.map(m => m.data.label),
    );
  },
  keys: (map: Record<string, KeyTarget>): SM => {
    const at = site();
    return append('keys', 'keys', () => ({ scope: 'global', map, at }), [map]);
  },
  spring: (chord: string, tool: Spring['tool'], opts: Spring['opts'] = {}): SM => {
    const at = site();
    return append('spring', 'springs', () => ({ chord, tool, opts, at }), [chord]);
  },
  module: (m: ModuleValue): SM => {
    if (!m || typeof m !== 'object' || m.kind !== 'module') throw new TypeError('.module(m): a module is ck.module(id, { label, key, … })');
    return append('module', 'modules', () => m.data, [m.data.id]);
  },
  context: (scope: string, items: unknown): SM => append('context', 'contexts', () => [scope, items], [scope]),
  palette: (o: { keys?: string }): SM => modifier<ShellDef>('palette', d => ({ ...d, palette: { ...d.palette, ...o } }), [o]),
  on: (event: string, f: KeyTarget): SM => {
    const at = site();
    return append('on', 'events', () => ({ event, f, at }), [event]);
  },
  theme: (t: string | Theme): SM =>
    modifier<ShellDef>('theme', d => (typeof t === 'string' ? { ...d, theme: t } : { ...d, themes: [...d.themes, t], theme: t.name }), [typeof t === 'string' ? t : t.name]),
  icons: (map: Record<string, string>): SM => modifier<ShellDef>('icons', d => ({ ...d, icons: { ...d.icons, ...map } }), [map]),
};

export function shellKind(fragments: () => readonly Fragment[], build: (def: ShellDef, opts: { platform?: { mac: boolean } }) => BuiltApp): BuilderKind<ShellDef, ShellValue> {
  return new BuilderKind<ShellDef, ShellValue>('shell', {
    methods: shellMods as unknown as Record<string, (...a: any[]) => SM>,
    target: 'shell',
    fragments,
    extra: {
      build(this: ShellValue, opts: { platform?: { mac: boolean } } = {}) {
        return build(this.data, opts);
      },
    },
    explain: d => ({ name: d.name, modules: d.modules.map(m => m.id), kits: d.uses.map(u => u.kit.name), menus: d.menus.map(m => m.label) }),
  });
}

export const shellData = (name: string, opts: ShellOpts, at: CallSite | null): ShellDef => ({
  name,
  opts,
  at,
  init: {},
  stateOpts: {},
  derived: [],
  menus: [],
  keys: [],
  springs: [],
  modules: [],
  contexts: [],
  events: [],
  palette: { keys: 'Mod+K' },
  uses: [],
  theme: null,
  themes: [],
  icons: {},
});
