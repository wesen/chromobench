// Kits: a bundle a variant installs with .use(kit) — forms, fragments, commands, menus, keys, tools, panels,
// passes, IRs, a state slice, routes, themes, icons and docs. A kit is a recorded value: it can be explained and
// installed into several builds. Dependencies install first, each once; a missing one is CK-X130, a cycle CK-X131.
// The same command, panel, tool, route or state key from two kits is CK-X101 naming both; a variant that replaces
// a kit's command without `replace: true` gets CK-X102.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { site, type CallSite, type Diagnostics } from '../core/diag.ts';
import { deepMerge, isPlainObject } from '../core/util.ts';
import type { RouteDecl } from '../core/store.ts';
import type { KeyTarget } from '../core/keys.ts';
import type { FormSpec } from '../ir/forms.ts';
import type { NodeData } from '../ir/node.ts';
import { CommandsBuilder, MenusBuilder, ToolsBuilder } from './recorders.ts';
import type { Fragment, IrSpec, Kit, KitDef, PassDef, Theme, UiIR } from './types.ts';

const emptyDef = (name: string): KitDef => ({
  name,
  requires: [],
  state: [],
  derived: [],
  routes: [],
  forms: [],
  fragments: [],
  commands: [],
  menus: [],
  keys: [],
  springs: [],
  tools: [],
  panels: [],
  passes: [],
  irs: [],
  themes: [],
  icons: {},
  docs: [],
});

export class KitBuilder<S = any> {
  readonly def: KitDef;
  constructor(def: KitDef) {
    this.def = def;
  }
  version(v: string): this {
    this.def.version = v;
    return this;
  }
  requires(...kits: (string | Kit)[]): this {
    this.def.requires.push(...kits);
    return this;
  }
  /** a state slice: document tier unless listed in view (relative sub-paths, or true for the whole slice) */
  state(key: string, o: { init: unknown; view?: string[] | boolean }): this {
    const entry: KitDef['state'][number] = { key, init: o.init, at: site() };
    if (o.view !== undefined) entry.view = o.view;
    this.def.state.push(entry);
    return this;
  }
  derive(path: string, fn: (s: S) => unknown): this {
    this.def.derived.push({ path, fn, at: site() });
    return this;
  }
  route(prefix: string, decl: Omit<RouteDecl, 'prefix'> = {}): this {
    this.def.routes.push({ ...decl, prefix, source: this.def.name });
    return this;
  }
  forms(...specs: FormSpec[]): this {
    for (const s of specs) this.def.forms.push({ ...s, source: this.def.name });
    return this;
  }
  fragments(...frags: Fragment[]): this {
    for (const f of frags) {
      f.source = f.source ?? this.def.name;
      this.def.fragments.push(f);
    }
    return this;
  }
  commands(f: (c: CommandsBuilder<S>) => void): this {
    f(new CommandsBuilder<S>(this.def, this.def.name));
    return this;
  }
  menus(f: (m: MenusBuilder) => void): this {
    f(new MenusBuilder(this.def, this.def.name));
    return this;
  }
  keys(scope: string, map: Record<string, KeyTarget>): this {
    this.def.keys.push({ scope, map, at: site(), source: this.def.name });
    return this;
  }
  tools(f: (t: ToolsBuilder<S>) => void): this {
    f(new ToolsBuilder<S>(this.def, this.def.name));
    return this;
  }
  /** panels defined, not placed: the variant places them */
  panels(...nodes: NodeData[]): this {
    this.def.panels.push(...nodes.flat());
    return this;
  }
  passes(...p: PassDef[]): this {
    for (const x of p) {
      x.source = x.source ?? this.def.name;
      this.def.passes.push(x);
    }
    return this;
  }
  ir(name: string, spec: Omit<IrSpec, 'name'>): this {
    this.def.irs.push({ ...spec, name });
    return this;
  }
  theme(t: Theme): this {
    this.def.themes.push(t);
    return this;
  }
  icons(map: Record<string, string>): this {
    Object.assign(this.def.icons, map);
    return this;
  }
  docs(md: string): this {
    this.def.docs.push(md);
    return this;
  }
}

export function kit<St = unknown>(name: string, f: (k: KitBuilder<any>, opts?: any) => unknown, opts?: unknown, at: CallSite | null = site()): Kit<St> {
  const def = emptyDef(name);
  f(new KitBuilder(def), opts);
  return {
    kind: 'kit',
    name,
    version: def.version,
    def,
    at,
    opts,
    with: (o: unknown) => kit<St>(name, f, o, site()),
  };
}
export const isKit = (v: unknown): v is Kit => !!v && typeof v === 'object' && (v as Kit).kind === 'kit';

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
  const kitMenus: typeof ir.menus = [];
  const kitKeys: typeof ir.keys = [];
  const panelOwner = new Map<string, { src: string | undefined; at: CallSite | null }>();
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
    kitMenus.push(...d.menus);
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
    for (const p of d.panels) {
      const id = String(p.props['id']);
      const prev = panelOwner.get(id);
      if (prev && prev.src !== k.name) {
        D.error('CK-X101', `Two kits define the panel '${id}'`, { at: p.at, facts: [`first: ${sourceOf(prev.src)}${loc(prev.at)}`, `again: kit ${k.name}${loc(p.at)}`], source: k.name });
        continue;
      }
      panelOwner.set(id, { src: k.name, at: p.at });
      if (!ir.panels.has(id)) ir.panels.set(id, p);
    }
    ir.passes.push(...d.passes);
    for (const x of d.irs) ir.irs.set(x.name, x);
    for (const t of d.themes) ir.themes.set(t.name, t);
    Object.assign(ir.icons, d.icons);
    for (const md of d.docs) ir.docs.push({ source: k.name, md });
  }
  // the program's own commands come after the kits'; replacing a kit's command needs replace: true
  for (const c of ir.commands) {
    const prev = kitCommands.find(x => x.id === c.id);
    if (prev && !c.spec.replace)
      D.warn('CK-X102', `The program redefines '${c.id}' from kit ${prev.source}`, { at: c.at, facts: [`kit: ${prev.at ? `${prev.at.file}:${prev.at.line}` : prev.source}`], fix: `c.add('${c.id}', { …, replace: true }) if this is on purpose.` });
  }
  ir.commands = [...kitCommands, ...ir.commands];
  // menus with the same label merge
  const menus = [...kitMenus];
  for (const m of ir.menus) {
    const prev = menus.find(x => x.label === m.label);
    if (prev) menus[menus.indexOf(prev)] = { ...prev, items: prev.items.concat(['-'], m.items) };
    else menus.push(m);
  }
  ir.menus = menus;
  ir.keys = [...kitKeys, ...ir.keys];
}
