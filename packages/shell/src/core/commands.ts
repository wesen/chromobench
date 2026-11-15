// The command table (port of CraftKit core/commands.js): one place that says what the app can do. Menus, context
// menus, toolbars, the command palette, key maps and the shortcut sheet are all views of it, so a label, a
// disabled state and its reason are written once.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { suggest } from './util.ts';
import type { CallSite } from './diag.ts';

/** a value, or a lambda of state (τ); with an untyped state (any) the lambda may type its own parameter */
export type Traced<S, T> = T | (0 extends 1 & S ? (s: any) => T : (s: Readonly<S>) => T);

/** S: the state type; C: the context handlers receive (the runtime's Ctx<S>) */
export interface CommandSpec<S = any, C = any> {
  label?: Traced<S, string>;
  icon?: string;
  enabled?: Traced<S, boolean>;
  why?: Traced<S, string>;
  checked?: Traced<S, boolean>;
  hidden?: Traced<S, boolean>;
  /** a handler (ctx, ...args) or the id of another command (an alias) */
  run?: string | ((ctx: C, ...args: any[]) => unknown);
  palette?: boolean;
  /** a set of commands (a submenu { label, group } lists them; the palette groups by it when no menu places one) */
  group?: string;
  /**
   * capabilities the command needs, as '<service>.<member>' ('host.openFiles': a function the host passes at mount,
   * services.host): without them it is hidden and refuses to run (CHB-029 item 1)
   */
  requires?: string | string[];
  /** shown in menus and the palette only while one of these modules is current */
  module?: string | string[] | undefined;
  /** replace a command of the same id on purpose (a kit replacing another kit's command) */
  replace?: boolean;
  /** extend a previous definition instead of replacing it */
  extend?: boolean;
  builtin?: boolean;
  doc?: string;
  at?: CallSite | null;
  /** the kit that defined it */
  source?: string;
  [k: string]: unknown;
}
export interface Command<S = any> extends CommandSpec<S> {
  id: string;
  at: CallSite | null;
}

export interface RunCtx {
  state: any;
  toast?: (text: string, o?: { kind?: string; title?: string; ms?: number }) => void;
}

const call = <T>(v: Traced<any, T> | undefined, st: unknown): T | undefined => (typeof v === 'function' ? (v as (s: unknown) => T)(st) : v);

export class Commands<S = any> {
  map = new Map<string, Command<S>>();
  groups = new Map<string, string[]>();
  recent: string[] = [];
  /** whether a capability is there (the runtime answers from its services; the build assumes yes) */
  capable: (req: string) => boolean = () => true;
  /** the command's required capabilities are all there */
  supplied(id: string): boolean {
    const c = this.map.get(id);
    return !c?.requires || ([] as string[]).concat(c.requires).every(r => this.capable(r));
  }
  add(id: string, spec: CommandSpec<S> | ((...a: any[]) => unknown) = {}): this {
    if (typeof spec === 'function') spec = { run: spec };
    const at = spec.at ?? null;
    const prev = this.map.get(id);
    this.map.set(id, Object.assign({ id, at, palette: true }, prev && spec.extend ? prev : {}, spec, { id, at }) as Command<S>);
    if (spec.group) {
      const g = this.groups.get(spec.group) || this.groups.set(spec.group, []).get(spec.group)!;
      if (!g.includes(id)) g.push(id);
    }
    return this;
  }
  has(id: string): boolean {
    return this.map.has(id);
  }
  get(id: string): Command<S> | undefined {
    return this.map.get(id);
  }
  all(): Command<S>[] {
    return [...this.map.values()];
  }
  ids(): string[] {
    return [...this.map.keys()];
  }
  suggest(id: string): string[] {
    return suggest(id, this.ids());
  }

  /** hidden: the command's own hidden, or module: 'id' | ['id', …] while another module is current */
  hidden(id: string, state: any): boolean {
    const c = this.map.get(id);
    if (!c) return false;
    if (!this.supplied(id)) return true;
    if (c.module && state && state.view && !([] as string[]).concat(c.module).includes(state.view.module)) return true;
    try {
      return !!call(c.hidden, state);
    } catch {
      return false;
    }
  }
  label(id: string, state: any): string {
    const c = this.map.get(id);
    if (!c) return id;
    try {
      return call(c.label, state) || id;
    } catch {
      return c.id;
    }
  }
  /** { ok, why }: enabled reads state (τ) and may name its reason; a disabled item shows why instead of nothing */
  status(id: string, state: any): { ok: boolean; why?: string } {
    const c = this.map.get(id);
    if (!c) return { ok: false, why: `No command '${id}'` };
    if (!this.supplied(id)) return { ok: false, why: 'Not available in this window' };
    let ok = true;
    try {
      ok = c.enabled === undefined ? true : !!call(c.enabled, state);
    } catch {
      ok = false;
    }
    if (ok) return { ok: true };
    let why = '';
    try {
      why = call(c.why, state) || '';
    } catch {
      why = '';
    }
    return { ok: false, why: why || 'Not available right now' };
  }
  checked(id: string, state: any): boolean | undefined {
    const c = this.map.get(id);
    if (!c || c.checked === undefined) return undefined;
    try {
      return !!call(c.checked, state);
    } catch {
      return false;
    }
  }
  /** run through the app context; a string run is an alias to another command */
  run(id: string, ctx: RunCtx, ...args: unknown[]): unknown {
    const c = this.map.get(id);
    if (!c) {
      const s = this.suggest(id);
      throw new Error(`No command '${id}'${s.length ? ` (did you mean ${s.join(', ')}?)` : ''}`);
    }
    const st = this.status(id, ctx.state);
    if (!st.ok) {
      if (ctx.toast) ctx.toast(st.why || '', { kind: 'why', title: this.label(id, ctx.state) });
      return false;
    }
    this.recent = [id].concat(this.recent.filter(x => x !== id)).slice(0, 30);
    if (typeof c.run === 'string') return this.run(c.run, ctx, ...args);
    // commands take ctx first (CraftKit): run: (ctx, n) => …; other ρ handlers take it last
    if (typeof c.run === 'function') return c.run(ctx, ...args);
    return undefined;
  }
}
