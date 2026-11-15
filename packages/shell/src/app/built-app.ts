// .build(): pure. Install kits (dependencies first), run the `ui` passes, and return a BuiltApp with diagnostics,
// explain() and the normalised IR. app.start(services) makes a
// headless Runtime; mount() in '@chromobench/shell/dom' starts one in the browser.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Diagnostics, type Diag } from '../core/diag.ts';
import { OTHER, type Platform } from '../core/util.ts';
import { isNode, walk, type NodeData } from '../ir/node.ts';
import type { FormSpec } from '../ir/forms.ts';
import { BUILTIN_PASSES, summaryPass, withDefaults } from '../build/checks.ts';
import { orderKits, installKits } from '../build/kits.ts';
import type { FragmentIndex } from '../build/fragments.ts';
import { runPasses } from '../build/passes.ts';
import { explainApp } from '../build/explain.ts';
import type { ShellDef } from '../build/shell.ts';
import type { Fragment, Theme, UiIR } from '../build/types.ts';
import { assemble, menuIndex, type Assembled } from './assemble.ts';
import { builtinCommands } from './builtins.ts';
import { Runtime, type Services } from './runtime.ts';

/** What the build needs from the Ck instance. */
export interface CkCore {
  forms: Map<string, FormSpec>;
  /** fragments registered with ck.extend (directly, not through a kit): in every build */
  fragments: Fragment[];
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
    const menus = menuIndex(this.ir.menus);
    const rows = this.assembled.commands
      .all()
      .filter(c => !c.builtin && !c.id.startsWith('module.') && !c.id.startsWith('tool.'))
      .map(c => ({ id: c.id, label: typeof c.label === 'string' ? c.label : c.label ? 'τ' : c.id, chord: this.assembled.keymap.chordsFor(c.id)[0], source: c.source as string | undefined, menu: menus.get(c.id) }));
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
    commands: [],
    menus: def.menus.map(m => ({ ...m, items: m.items.slice() })),
    keys: def.keys.slice(),
    springs: def.springs.slice(),
    tools: new Map(),
    panels: new Map(),
    modules: def.modules.map(m => ({ ...m, regions: { ...m.regions } })),
    contexts: new Map(def.contexts),
    events: def.events.slice(),
    palette: { ...def.palette },
    mounts: [],
    kits: [],
    fragments: [...ck.fragments],
    forms: new Map(ck.forms),
    passes: [...BUILTIN_PASSES],
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
  return ir;
}

/** The build of a shell's data. */
export function buildApp<S>(def: ShellDef, ck: CkCore, opts: { platform?: Platform } = {}): BuiltApp<S> {
  const D = new Diagnostics();
  const platform = opts.platform || OTHER;
  const ir = makeIR(def, ck);
  const kits = orderKits(def.uses, D);
  installKits(ir, kits, D, def.init || {});
  const extra = { D, platform, builtins: builtinCommands(() => null, ir.themes.values()) };
  const res = runPasses('ui', ir, ir.passes, { D, extra, explain: x => ck.explain(x) });
  const asm = (res.facts.get('assembled') as Assembled | undefined) ?? assemble(ir, builtinCommands(() => null, ir.themes.values()), platform);
  res.facts.set('assembled', asm);
  runPasses('ui', ir, [summaryPass], { D, extra, explain: x => ck.explain(x), facts: res.facts });
  const fidx = (res.facts.get('fragments') as FragmentIndex | undefined) ?? null;
  return new BuiltApp<S>(ir as UiIR<S>, D, platform, [...res.order, 'summary'], fidx, asm);
}
