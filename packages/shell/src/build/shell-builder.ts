// The shell builder (port of CraftKit shell.js, builder half): a fluent builder that records an app (state,
// commands, menus, keys, tools, panels, modules, kits) as data. Builder methods only record; .build() installs
// kits, applies pending fragment calls, runs the `ui` passes and returns a BuiltApp with its diagnostics.
//
// Shell and module builders are Proxies: a method no builder has is a builder fragment ('shell' / 'module'),
// resolved at once if a kit used so far provides it, else recorded and applied at build.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { site, type CallSite } from '../core/diag.ts';
import type { KeyTarget, Spring } from '../core/keys.ts';
import type { RouteDecl, TxOpts } from '../core/store.ts';
import type { NodeData } from '../ir/node.ts';
import { CommandsBuilder, MenusBuilder, ToolsBuilder } from './recorders.ts';
import { builderMethod } from './fragments.ts';
import { isKit } from './kits.ts';
import type { BuiltApp } from '../app/built-app.ts';
import type { Fragment, Kit, ModuleDef, PassDef, Region, ShellOpts, StateOpts, Theme, CommandDef, MenuDef, KeyDef, SpringDef, ToolSpec, PendingBuilderCall } from './types.ts';

export interface ShellDef {
  name: string;
  opts: ShellOpts;
  at: CallSite | null;
  init: any;
  stateOpts: StateOpts;
  derived: { path: string; fn: (s: any) => unknown; at: CallSite | null }[];
  commands: CommandDef[];
  menus: MenuDef[];
  keys: KeyDef[];
  springs: SpringDef[];
  tools: Map<string, ToolSpec>;
  toolGroups: { name: string; ids: string[]; opts: Record<string, unknown>; at: CallSite | null }[];
  panels: NodeData[];
  modules: ModuleDef[];
  contexts: Map<string, unknown>;
  events: { event: string; f: KeyTarget; at: CallSite | null }[];
  palette: { keys: string };
  uses: { kit: Kit; at: CallSite | null }[];
  fragments: Fragment[];
  passes: PassDef[];
  routes: RouteDecl[];
  theme: string | null;
  themes: Theme[];
  icons: Record<string, string>;
  calls: PendingBuilderCall[];
}

const BUILDER_PROBES = new Set(['then', 'toJSON', 'constructor', 'asymmetricMatch', 'nodeType', 'inspect', 'toString', 'valueOf']);
const usedFragments = (def: ShellDef): Fragment[] => {
  const out: Fragment[] = [...def.fragments];
  const seen = new Set<string>();
  const add = (k: Kit): void => {
    if (seen.has(k.name)) return;
    seen.add(k.name);
    for (const r of k.def.requires) if (typeof r !== 'string') add(r);
    out.push(...k.def.fragments);
  };
  for (const u of def.uses) add(u.kit);
  return out;
};

/** Wrap a builder so unknown methods resolve to builder fragments (now or at build). */
function fragmentProxy<T extends object>(target: T, kind: 'shell' | 'module', frags: () => Fragment[], record: (c: PendingBuilderCall) => void): T {
  const proxy: T = new Proxy(target, {
    get(t: any, k, r) {
      if (typeof k === 'symbol' || k in t || BUILDER_PROBES.has(k)) {
        const v = Reflect.get(t, k, r);
        return typeof v === 'function' ? v.bind(proxy) : v;
      }
      const m = builderMethod(frags(), kind, k);
      if (m) return (...args: unknown[]) => m.apply(proxy, args) ?? proxy;
      return (...args: unknown[]) => {
        record({ name: k, args, at: site() });
        return proxy;
      };
    },
  });
  return proxy;
}

export class ModuleBuilder<S = any> {
  readonly m: ModuleDef<S>;
  constructor(id: string, at: CallSite | null) {
    this.m = { id, label: id ? id[0]!.toUpperCase() + id.slice(1) : id, key: null, icon: null, regions: {}, keys: [], at, tools: [], calls: [] };
  }
  label(v: string): this {
    this.m.label = v;
    return this;
  }
  key(v: string): this {
    this.m.key = v;
    return this;
  }
  icon(v: string): this {
    this.m.icon = v;
    return this;
  }
  region(side: Region, n: NodeData | null): this {
    this.m.regions[side] = n;
    return this;
  }
  top(n: NodeData): this {
    return this.region('top', n);
  }
  left(n: NodeData): this {
    return this.region('left', n);
  }
  center(n: NodeData): this {
    return this.region('center', n);
  }
  right(n: NodeData): this {
    return this.region('right', n);
  }
  bottom(n: NodeData | null): this {
    return this.region('bottom', n);
  }
  toolbar(n: NodeData): this {
    return this.region('toolbar', n);
  }
  tools(ids: string[]): this {
    this.m.tools = ids;
    return this;
  }
  /** module scope by default: only while this module is current */
  keys(scope: string | Record<string, KeyTarget>, map?: Record<string, KeyTarget>): this {
    if (typeof scope === 'object') {
      map = scope;
      scope = 'module:' + this.m.id;
    }
    this.m.keys.push({ scope, map: map || {}, at: site() });
    return this;
  }
  /** transaction options for edits made in this module: ({ channel, snapPath }) files them into a History list */
  txOpts(f: ((s: S) => TxOpts) | TxOpts): this {
    this.m.txOpts = f;
    return this;
  }
  onEnter(f: KeyTarget): this {
    this.m.onEnter = f;
    return this;
  }
  /** Esc tries this first (return false to let the shell continue) */
  onEscape(f: KeyTarget): this {
    this.m.onEscape = f;
    return this;
  }
}

export class ShellBuilder<S = any> {
  readonly def: ShellDef;
  readonly self: this;
  private readonly finish: (def: ShellDef, opts: any) => any;
  constructor(name: string, opts: ShellOpts, finish: (def: ShellDef, opts: any) => any) {
    this.finish = finish;
    this.def = {
      name,
      opts,
      at: site(),
      init: {},
      stateOpts: {},
      derived: [],
      commands: [],
      menus: [],
      keys: [],
      springs: [],
      tools: new Map(),
      toolGroups: [],
      panels: [],
      modules: [],
      contexts: new Map(),
      events: [],
      palette: { keys: 'Mod+K' },
      uses: [],
      fragments: [],
      passes: [],
      routes: [],
      theme: null,
      themes: [],
      icons: {},
      calls: [],
    };
    this.self = fragmentProxy(this, 'shell', () => usedFragments(this.def), c => this.def.calls.push(c));
  }
  state<S2 extends object>(init: S2, opts: StateOpts<S2> = {}): ShellBuilder<S2> {
    this.def.init = init;
    this.def.stateOpts = opts;
    return this.self as unknown as ShellBuilder<S2>;
  }
  use<K extends Kit>(k: K, opts?: unknown): ShellBuilder<S & NonNullable<K['_state']>> {
    if (!isKit(k)) throw new TypeError('.use(kit): not a kit (make one with ck.kit(name, k => …))');
    this.def.uses.push({ kit: opts !== undefined ? k.with(opts) : k, at: site() });
    return this.self as any;
  }
  derive(path: string, fn: (s: S) => unknown): this {
    this.def.derived.push({ path, fn, at: site() });
    return this.self;
  }
  commands(f: (c: CommandsBuilder<S>) => void): this {
    f(new CommandsBuilder<S>(this.def));
    return this.self;
  }
  menus(f: (m: MenusBuilder) => void): this {
    f(new MenusBuilder(this.def));
    return this.self;
  }
  keys(scope: string | Record<string, KeyTarget>, map?: Record<string, KeyTarget>): this {
    if (typeof scope === 'object') {
      map = scope;
      scope = 'global';
    }
    this.def.keys.push({ scope, map: map || {}, at: site() });
    return this.self;
  }
  spring(chord: string, tool: Spring['tool'], opts: Spring['opts'] = {}): this {
    this.def.springs.push({ chord, tool, opts, at: site() });
    return this.self;
  }
  tools(f: (t: ToolsBuilder<S>) => void): this {
    f(new ToolsBuilder<S>(this.def));
    return this.self;
  }
  panels(...defs: (NodeData | NodeData[])[]): this {
    this.def.panels.push(...defs.flat());
    return this.self;
  }
  module(id: string, f: (m: ModuleBuilder<S>) => unknown): this {
    const b = new ModuleBuilder<S>(id, site());
    const proxy = fragmentProxy(b, 'module', () => usedFragments(this.def), c => b.m.calls.push(c));
    f(proxy);
    this.def.modules.push(b.m);
    return this.self;
  }
  /** a small shell gives regions straight to the builder (one implicit module 'main') */
  region(side: Region, n: NodeData | null): this {
    let m = this.def.modules.find(x => x.id === 'main');
    if (!m) {
      m = new ModuleBuilder('main', site()).m;
      m.label = this.def.name;
      this.def.modules.push(m);
    }
    m.regions[side] = n;
    return this.self;
  }
  top(n: NodeData): this {
    return this.region('top', n);
  }
  left(n: NodeData): this {
    return this.region('left', n);
  }
  center(n: NodeData): this {
    return this.region('center', n);
  }
  right(n: NodeData): this {
    return this.region('right', n);
  }
  bottom(n: NodeData): this {
    return this.region('bottom', n);
  }
  toolbar(n: NodeData): this {
    return this.region('toolbar', n);
  }
  context(scope: string, items: unknown): this {
    this.def.contexts.set(scope, items);
    return this.self;
  }
  palette(o: { keys?: string }): this {
    this.def.palette = Object.assign({}, this.def.palette, o);
    return this.self;
  }
  on(event: string, f: KeyTarget): this {
    this.def.events.push({ event, f, at: site() });
    return this.self;
  }
  fragments(...f: Fragment[]): this {
    this.def.fragments.push(...f);
    return this.self;
  }
  passes(...p: PassDef[]): this {
    this.def.passes.push(...p);
    return this.self;
  }
  /** declare a routed prefix (kits usually do this): writes under it go to the adapter supplied at start */
  route(prefix: string, decl: Omit<RouteDecl, 'prefix'> = {}): this {
    this.def.routes.push({ ...decl, prefix });
    return this.self;
  }
  /** select a theme by name, or define one and select it */
  theme(t: string | Theme): this {
    if (typeof t === 'string') this.def.theme = t;
    else {
      this.def.themes.push(t);
      this.def.theme = t.name;
    }
    return this.self;
  }
  icons(map: Record<string, string>): this {
    Object.assign(this.def.icons, map);
    return this.self;
  }
  build(opts: { platform?: { mac: boolean } } = {}): BuiltApp<S> {
    return this.finish(this.def, opts);
  }
}
