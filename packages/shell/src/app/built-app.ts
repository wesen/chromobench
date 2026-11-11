// .build(): pure. Install kits (dependencies first), apply pending builder and fragment calls, run the `ui`
// passes, and return a BuiltApp with diagnostics, explain() and the normalised IR. app.start(services) makes a
// headless Runtime; mount() in '@chromobench/shell/dom' starts one in the browser.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Diagnostics, type Diag } from '../core/diag.ts';
import { OTHER, type Platform } from '../core/util.ts';
import { isNode, walk, type NodeData } from '../ir/node.ts';
import type { FormSpec } from '../ir/forms.ts';
import { BUILTIN_PASSES, summaryPass, withDefaults } from '../build/checks.ts';
import { orderKits, installKits } from '../build/kits.ts';
import { builderMethod, type FragmentIndex } from '../build/fragments.ts';
import { runPasses } from '../build/passes.ts';
import { explainApp } from '../build/explain.ts';
import { ModuleBuilder, type ShellDef } from '../build/shell-builder.ts';
import type { Fragment, PassDef, Theme, UiIR } from '../build/types.ts';
import { assemble, type Assembled } from './assemble.ts';
import { builtinCommands } from './builtins.ts';
import { Runtime, type Services } from './runtime.ts';

/** What the build needs from the Ck instance. */
export interface CkCore {
  forms: Map<string, FormSpec>;
  panels: Map<string, NodeData>;
  fragments: Fragment[];
  passes: PassDef[];
  themes: Map<string, Theme>;
  explain(x: unknown, o?: object): string;
}

export class BuiltApp<S = any> {
  readonly ir: UiIR<S>;
  readonly diagnostics: Diagnostics;
  readonly platform: Platform;
  readonly passOrder: string[];
  readonly fragments: FragmentIndex | null;
  private readonly assembled: Assembled;
  constructor(ir: UiIR<S>, D: Diagnostics, platform: Platform, passOrder: string[], fragments: FragmentIndex | null, assembled: Assembled) {
    this.ir = ir;
    this.diagnostics = D;
    this.platform = platform;
    this.passOrder = passOrder;
    this.fragments = fragments;
    this.assembled = assembled;
  }
  get name(): string {
    return this.ir.name;
  }
  get errors(): Diag[] {
    return this.diagnostics.errors;
  }
  get warnings(): Diag[] {
    return this.diagnostics.warnings;
  }
  /** the codes reported, for quick assertions */
  codes(level?: Diag['level']): string[] {
    return this.diagnostics.list.filter(d => !level || d.level === level).map(d => d.code);
  }
  explain(o: { at?: boolean } = {}): string {
    const rows = this.assembled.commands
      .all()
      .filter(c => !c.builtin && !c.id.startsWith('module.') && !c.id.startsWith('tool.'))
      .map(c => ({ id: c.id, label: typeof c.label === 'string' ? c.label : c.label ? 'τ' : c.id, chord: this.assembled.keymap.chordsFor(c.id)[0], source: c.source as string | undefined, menu: c.menu }));
    return explainApp(
      this.ir,
      {
        commands: this.assembled.commands.map.size,
        bindings: this.assembled.keymap.bindings.length,
        scopes: new Set(this.assembled.keymap.bindings.map(b => b.scope)).size,
        passes: this.passOrder.length,
        diagnostics: this.diagnostics,
        commandRows: rows,
        platform: this.platform,
      },
      { ...(o.at ? { at: true } : {}), ...(this.fragments ? { fragments: this.fragments } : {}) },
    );
  }
  /** the headless runtime: no DOM */
  start(services: Services = {}): Runtime<S> {
    return new Runtime<S>(this, services);
  }
  /** load saved state through the persistence adapter first, then start */
  async boot(services: Services = {}): Promise<Runtime<S>> {
    let saved = null;
    if (services.persistence && this.ir.opts.persist !== false) {
      try {
        saved = await services.persistence.load({ app: this.ir.name, version: this.ir.stateOpts.version || 1 });
      } catch {
        saved = null;
      }
    }
    return new Runtime<S>(this, services, saved);
  }
  /** methods fragments add to an extensible kind ('ext:frameHandle'), for libraries that build such objects */
  methodsFor(kind: string): Record<string, (...a: any[]) => any> {
    const out: Record<string, (...a: any[]) => any> = {};
    const t = kind.startsWith('ext:') ? kind : 'ext:' + kind;
    for (const f of this.ir.fragments) if (f.target === t) Object.assign(out, f.spec.methods || {});
    return out;
  }
}

function makeIR(def: ShellDef, ck: CkCore): UiIR {
  const ir: UiIR = {
    name: def.name,
    opts: def.opts,
    at: def.at,
    init: withDefaults(def.init),
    stateOpts: def.stateOpts,
    view: (def.stateOpts.view || ['ui', 'view', 'prefs', 'workspace']).slice(),
    derived: def.derived.slice(),
    commands: def.commands.slice(),
    menus: def.menus.map(m => ({ ...m, items: m.items.slice() })),
    keys: def.keys.slice(),
    springs: def.springs.slice(),
    tools: new Map(def.tools),
    toolGroups: def.toolGroups.slice(),
    panels: new Map(),
    modules: def.modules.map(m => ({ ...m, regions: { ...m.regions } })),
    contexts: new Map(def.contexts),
    events: def.events.slice(),
    palette: { ...def.palette },
    routes: def.routes.slice(),
    kits: [],
    fragments: [...ck.fragments, ...def.fragments],
    forms: new Map(ck.forms),
    passes: [...BUILTIN_PASSES, ...ck.passes, ...def.passes],
    irs: new Map(),
    theme: def.theme,
    themes: new Map([...ck.themes, ...def.themes.map(t => [t.name, t] as const)]),
    icons: { ...def.icons },
    docs: [],
    trees() {
      const out: { where: string; node: NodeData; module?: string }[] = [];
      for (const [id, p] of this.panels) out.push({ where: `panel '${id}'`, node: p });
      for (const m of this.modules) for (const [side, r] of Object.entries(m.regions)) if (r && isNode(r)) out.push({ where: `module '${m.id}' ${side}`, node: r, module: m.id });
      for (const t of this.tools.values()) if (t.content && isNode(t.content)) out.push({ where: `tool '${t.id}'`, node: t.content });
      return out;
    },
    find(form: string) {
      const out: NodeData[] = [];
      const seen = new Set<NodeData>();
      for (const t of this.trees())
        walk(t.node, n => {
          if (seen.has(n)) return false;
          seen.add(n);
          if (n.$ === form) out.push(n);
          return undefined;
        });
      return out;
    },
    hasCommand: () => false,
  };
  for (const p of def.panels) if (isNode(p) && p.props['id'] != null && !ir.panels.has(String(p.props['id']))) ir.panels.set(String(p.props['id']), p);
  return ir;
}

/** The build. `self` is the builder proxy (pending builder-fragment calls are applied to it). */
export function buildApp<S>(def: ShellDef, self: any, ck: CkCore, opts: { platform?: Platform } = {}): BuiltApp<S> {
  const D = new Diagnostics();
  const platform = opts.platform || OTHER;
  // pending builder-fragment calls first: they may add modules, commands, kits
  const frags = (): Fragment[] => {
    const out: Fragment[] = [...ck.fragments, ...def.fragments];
    const seen = new Set<string>();
    const add = (k: any): void => {
      if (seen.has(k.name)) return;
      seen.add(k.name);
      for (const r of k.def.requires) if (typeof r !== 'string') add(r);
      out.push(...k.def.fragments);
    };
    for (const u of def.uses) add(u.kit);
    return out;
  };
  const applyBuilderCalls = (target: 'shell' | 'module', calls: { name: string; args: unknown[]; at: any }[], receiver: any): void => {
    for (const c of calls.splice(0)) {
      const m = builderMethod(frags(), target, c.name);
      if (m) {
        try {
          m.apply(receiver, c.args);
        } catch (e) {
          D.error('CK-X123', `.${c.name}() threw on the ${target} builder`, { at: c.at, facts: [String((e as Error)?.message ?? e)] });
        }
      } else
        D.error('CK-X120', `No method .${c.name}() on the ${target} builder`, {
          at: c.at,
          facts: [`No installed kit adds .${c.name}() to ${target === 'shell' ? 'ck.shell(…)' : '.module(id, m => …)'}.`],
          fix: 'Install the kit that defines it with .use(kit), or remove the call.',
        });
    }
  };
  applyBuilderCalls('shell', def.calls, self);
  for (const m of def.modules) {
    if (!m.calls.length) continue;
    const b = new ModuleBuilder(m.id, m.at);
    (b as { m: unknown }).m = m;
    applyBuilderCalls('module', m.calls, b);
  }
  const ir = makeIR(def, ck);
  const kits = orderKits(def.uses, D);
  installKits(ir, kits, D, def.init || {});
  // CraftKit compatibility: panels defined anywhere through this ck instance
  const extra = { D, platform, builtins: builtinCommands(() => null), registry: ck.panels };
  const res = runPasses('ui', ir, ir.passes, { D, extra, explain: x => ck.explain(x) });
  const asm = (res.facts.get('assembled') as Assembled | undefined) ?? assemble(ir, builtinCommands(() => null), platform);
  res.facts.set('assembled', asm);
  runPasses('ui', ir, [summaryPass], { D, extra, explain: x => ck.explain(x), facts: res.facts });
  const fidx = (res.facts.get('fragments') as FragmentIndex | undefined) ?? null;
  return new BuiltApp<S>(ir as UiIR<S>, D, platform, [...res.order, 'summary'], fidx, asm);
}
