// Kits: what a layout installs with .use(kit): a state slice, routes, forms, fragments, commands, keys, tools,
// passes, IRs, themes, icons and docs. A kit is an immutable value (builder.ts): `ck.kit(name)` is empty and every
// chain method returns a new kit, so a kit can be explained, parameterised by a function and installed into several
// builds. Dependencies install first, each once; a missing one is CK-X130, a cycle CK-X131. The same command, tool,
// route or state key from two kits is CK-X101 naming both. A kit's keys bind in scope kit:<name> (every module).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { modifier, site, type CallSite, type Modifier } from '@chromobench/values';
import type { Diagnostics } from '../core/diag.ts';
import { deepMerge, isPlainObject } from '../core/util.ts';
import type { CommandSpec } from '../core/commands.ts';
import type { RouteDecl } from '../core/store.ts';
import type { KeyTarget, Spring } from '../core/keys.ts';
import type { FormSpec } from '../ir/forms.ts';
import type { Ctx } from '../app/runtime.ts';
import { BuilderKind, type Built, type BuilderWith } from './builder.ts';
import type { CommandDef, Fragment, IrSpec, Kit, KitDef, PassDef, Theme, ToolSpec, UiIR } from './types.ts';

/** A command table: id → spec, in order (CHB-029 item 3: declarative, one per area). */
export type CommandTable<S = any> = Record<string, CommandSpec<S, Ctx<S>>>;
/** A tool table: id → spec, in order. */
export type ToolTable<S = any> = Record<string, Omit<ToolSpec<S>, 'id'>>;

/** A kit value: its data (def), its chain methods, and (for kits that offer one) its product. */
export interface KitValue<St = unknown> extends Kit<St>, Built<KitDef> {
  readonly kind: 'kit';
  with(x: BuilderWith<KitDef, KitValue<St>>): KitValue<St>;
  version(v: string): KitValue<St>;
  requires(...kits: (string | Kit)[]): KitValue<St>;
  /** a state slice: document tier unless listed in view (relative sub-paths, or true for the whole slice) */
  state<K extends string, T>(key: K, o: { init: T; view?: string[] | boolean }): KitValue<St & { [P in K]: T }>;
  derive(path: string, fn: (s: any) => unknown): KitValue<St>;
  route(prefix: string, decl?: Omit<RouteDecl, 'prefix'>): KitValue<St>;
  forms(...specs: FormSpec[]): KitValue<St>;
  fragments(...frags: Fragment[]): KitValue<St>;
  /** a command table (id → spec); type the state the handlers read with .commands<S>({ … }) */
  commands<S = any>(table: CommandTable<S>): KitValue<St>;
  /** keys in scope kit:<name>: active in every module (a module's own key for the same chord wins) */
  keys(map: Record<string, KeyTarget>): KitValue<St>;
  spring(chord: string, tool: Spring['tool'], opts?: Spring['opts']): KitValue<St>;
  tools<S = any>(table: ToolTable<S>): KitValue<St>;
  passes(...p: PassDef[]): KitValue<St>;
  ir(name: string, spec: Omit<IrSpec, 'name'>): KitValue<St>;
  theme(t: Theme): KitValue<St>;
  icons(map: Record<string, string>): KitValue<St>;
  docs(md: string): KitValue<St>;
}

type M = Modifier<KitDef>;
const add = (name: string, key: keyof KitDef, items: (d: KitDef) => unknown[]): M => modifier<KitDef>(name, d => ({ ...d, [key]: [...(d[key] as unknown[]), ...items(d)] }));

/** the kit modifiers (the chain methods of a kit) */
export const kitMods = {
  version: (v: string): M => modifier<KitDef>('version', d => ({ ...d, version: v }), [v]),
  requires: (...kits: (string | Kit)[]): M => add('requires', 'requires', () => kits),
  state: (key: string, o: { init: unknown; view?: string[] | boolean }): M => {
    const at = site();
    return add('state', 'state', () => [{ key, init: o.init, at, ...(o.view !== undefined ? { view: o.view } : {}) }]);
  },
  derive: (path: string, fn: (s: any) => unknown): M => {
    const at = site();
    return add('derive', 'derived', () => [{ path, fn, at }]);
  },
  route: (prefix: string, decl: Omit<RouteDecl, 'prefix'> = {}): M => add('route', 'routes', d => [{ ...decl, prefix, source: d.name }]),
  forms: (...specs: FormSpec[]): M => add('forms', 'forms', d => specs.map(f => ({ ...f, source: d.name }))),
  fragments: (...frags: Fragment[]): M => add('fragments', 'fragments', d => frags.map(f => (f.source ? f : Object.freeze({ ...f, source: d.name })))),
  commands: (table: CommandTable): M => {
    const at = site();
    return add('commands', 'commands', d =>
      Object.entries(table).map(([id, spec]): CommandDef => ({ id, spec: { ...spec, at, source: d.name }, at, source: d.name })),
    );
  },
  keys: (map: Record<string, KeyTarget>): M => {
    const at = site();
    return add('keys', 'keys', d => [{ scope: 'kit:' + d.name, map, at, source: d.name }]);
  },
  spring: (chord: string, tool: Spring['tool'], opts: Spring['opts'] = {}): M => {
    const at = site();
    return add('spring', 'springs', () => [{ chord, tool, opts, at }]);
  },
  tools: (table: ToolTable): M => {
    const at = site();
    return add('tools', 'tools', d => Object.entries(table).map(([id, spec]): ToolSpec => ({ ...(spec as ToolSpec), id, at, source: d.name })));
  },
  passes: (...p: PassDef[]): M => add('passes', 'passes', d => p.map(x => (x.source ? x : Object.freeze({ ...x, source: d.name })))),
  ir: (name: string, spec: Omit<IrSpec, 'name'>): M => add('ir', 'irs', () => [{ ...spec, name }]),
  theme: (t: Theme): M => add('theme', 'themes', () => [t]),
  icons: (map: Record<string, string>): M => modifier<KitDef>('icons', d => ({ ...d, icons: { ...d.icons, ...map } }), [map]),
  docs: (md: string): M => add('docs', 'docs', () => [md]),
};

export const KITS = new BuilderKind<KitDef, KitValue<any>>('kit', {
  methods: kitMods as unknown as Record<string, (...a: any[]) => M>,
  derived: d => ({ name: d.name, def: d }),
  explain: d => ({ name: d.name, ...(d.version ? { version: d.version } : {}), commands: d.commands.map(c => c.id), tools: d.tools.map(t => t.id), state: d.state.map(s => s.key) }),
});

const emptyDef = (name: string): KitDef => ({
  name,
  requires: [],
  state: [],
  derived: [],
  routes: [],
  forms: [],
  fragments: [],
  commands: [],
  keys: [],
  springs: [],
  tools: [],
  passes: [],
  irs: [],
  themes: [],
  icons: {},
  docs: [],
});

/** an empty kit (ck.kit(name)); chain methods add to it */
export function kit<St = unknown>(name: string, at: CallSite | null = site()): KitValue<St> {
  return KITS.make(emptyDef(name), at) as KitValue<St>;
}
export const isKit = (v: unknown): v is KitValue => KITS.is(v);

/**
 * What a kit offers a layout (CHB-035 §32: one product shape for every kit): the kit to install, its panels and
 * modules (builders a layout places), its menus and key maps (values a layout places), the ids of its tools and
 * commands, its docs; `sel` (typed selectors) and `lib` (helpers) when it has them.
 */
export interface KitProduct<K extends KitValue<any> = KitValue<any>> {
  readonly kit: K;
  readonly panels: Readonly<Record<string, (...a: any[]) => unknown>>;
  readonly modules: Readonly<Record<string, (...a: any[]) => unknown>>;
  readonly menus: Readonly<Record<string, (...a: any[]) => unknown>>;
  readonly keys: Readonly<Record<string, Record<string, KeyTarget>>>;
  readonly tools: readonly string[];
  readonly commands: readonly string[];
  readonly docs: string;
}
export type ProductParts = Partial<Omit<KitProduct, 'kit' | 'tools' | 'commands' | 'docs'>> & Record<string, unknown>;

/** a kit's product: the parts given, plus its tool and command ids and its docs (from the kit) */
export function product<K extends KitValue<any>, P extends ProductParts>(k: K, parts: P): KitProduct<K> & P {
  return Object.freeze({
    panels: {},
    modules: {},
    menus: {},
    keys: {},
    ...parts,
    kit: k,
    tools: Object.freeze(k.def.tools.map(t => t.id)),
    commands: Object.freeze(k.def.commands.map(c => c.id)),
    docs: k.def.docs.join('\n\n'),
  }) as unknown as KitProduct<K> & P;
}

/** Dependencies first, each once (by name). X130 missing, X131 cycle. */
export function orderKits(uses: { kit: Kit; at: CallSite | null }[], D: Diagnostics): Kit[] {
  const known = new Map<string, Kit>();
  const collect = (k: Kit): void => {
    if (known.has(k.name)) return;
    known.set(k.name, k);
    for (const r of k.def.requires) if (typeof r !== 'string') collect(r);
  };
  for (const u of uses) collect(u.kit);
  const out: Kit[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (k: Kit, chain: string[], at: CallSite | null): void => {
    const s = state.get(k.name);
    if (s === 'done') return;
    if (s === 'visiting') {
      D.error('CK-X131', `Kits require each other in a cycle: ${[...chain, k.name].join(' → ')}`, { at: k.at ?? at, fix: 'Move what both need into a third kit that neither requires back.' });
      return;
    }
    state.set(k.name, 'visiting');
    for (const r of k.def.requires) {
      const name = typeof r === 'string' ? r : r.name;
      const dep = known.get(name);
      if (!dep) {
        D.error('CK-X130', `Kit '${k.name}' requires '${name}', which is not installed`, { at: at ?? k.at, facts: [`installed: ${[...known.keys()].join(', ') || 'none'}`], fix: `.use(${name}) before .use(${k.name})` });
        continue;
      }
      visit(dep, [...chain, k.name], at);
    }
    state.set(k.name, 'done');
    out.push(k);
  };
  for (const u of uses) visit(u.kit, [], u.at);
  return out;
}

const sourceOf = (s: string | undefined): string => (s ? `kit ${s}` : 'the program');
const loc = (at: CallSite | null | undefined): string => (at ? ` (${at.file}:${at.line})` : '');

/** Merge installed kits into the IR, in dependency order. Kit items come before the program's own. */
export function installKits(ir: UiIR, kits: Kit[], D: Diagnostics, programInit: Record<string, unknown>): void {
  const stateOwner = new Map<string, Kit>();
  const routeOwner = new Map<string, string>();
  const kitCommands: typeof ir.commands = [];
  const kitKeys: typeof ir.keys = [];
  for (const k of kits) {
    const d = k.def;
    ir.kits.push({ name: k.name, version: d.version, requires: d.requires.map(r => (typeof r === 'string' ? r : r.name)), at: k.at, docs: d.docs });
    for (const s of d.state) {
      const prev = stateOwner.get(s.key);
      if (prev) {
        D.error('CK-X101', `Two kits define the state slice '${s.key}'`, { at: s.at, facts: [`first: kit ${prev.name}${loc(prev.at)}`, `again: kit ${k.name}${loc(s.at)}`], fix: 'Give one slice another key.', source: k.name });
        continue;
      }
      stateOwner.set(s.key, k);
      const mine = programInit[s.key];
      ir.init = { ...ir.init, [s.key]: mine !== undefined && isPlainObject(mine) && isPlainObject(s.init) ? deepMerge(s.init, mine) : mine !== undefined ? mine : s.init };
      if (s.view === true) ir.view.push(s.key);
      else if (Array.isArray(s.view)) for (const v of s.view) ir.view.push(`${s.key}.${v}`);
    }
    ir.derived.push(...d.derived);
    for (const r of d.routes) {
      const prev = routeOwner.get(r.prefix);
      if (prev) {
        D.error('CK-X101', `Two kits route '${r.prefix}'`, { facts: [`first: kit ${prev}`, `again: kit ${k.name}`], source: k.name });
        continue;
      }
      routeOwner.set(r.prefix, k.name);
      ir.routes.push(r);
    }
    for (const f of d.forms) {
      const prev = ir.forms.get(f.name);
      if (prev && prev.source && prev.source !== k.name) D.error('CK-X101', `Two kits define the form '${f.name}'`, { facts: [`first: kit ${prev.source}`, `again: kit ${k.name}`], source: k.name });
      ir.forms.set(f.name, f);
    }
    ir.fragments.push(...d.fragments);
    for (const c of d.commands) {
      const prev = kitCommands.find(x => x.id === c.id);
      if (prev && prev.source !== k.name && !c.spec.replace) {
        D.error('CK-X101', `Two kits define the command '${c.id}'`, { at: c.at, facts: [`first: ${sourceOf(prev.source)}${loc(prev.at)}`, `again: kit ${k.name}${loc(c.at)}`], fix: `Give one another id, or add replace: true to the one that should win.`, source: k.name });
        continue;
      }
      kitCommands.push(c);
    }
    kitKeys.push(...d.keys);
    ir.springs.push(...d.springs);
    for (const t of d.tools) {
      const prev = ir.tools.get(t.id);
      if (prev && prev.source && prev.source !== k.name) {
        D.error('CK-X101', `Two kits define the tool '${t.id}'`, { at: t.at ?? null, facts: [`first: kit ${prev.source}${loc(prev.at)}`, `again: kit ${k.name}${loc(t.at)}`], source: k.name });
        continue;
      }
      ir.tools.set(t.id, t);
    }
    ir.passes.push(...d.passes);
    for (const x of d.irs) ir.irs.set(x.name, x);
    for (const t of d.themes) ir.themes.set(t.name, t);
    Object.assign(ir.icons, d.icons);
    for (const md of d.docs) ir.docs.push({ source: k.name, md });
  }
  ir.commands = kitCommands;
  ir.keys = [...kitKeys, ...ir.keys];
}
