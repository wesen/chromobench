// Recording sub-builders shared by the shell and kits: commands, menus, tools. They only record (with call sites).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { site } from '../core/diag.ts';
import type { CommandSpec } from '../core/commands.ts';
import type { Ctx } from '../app/runtime.ts';
import type { CommandDef, MenuDef, MenuItem, SpringDef, ToolSpec } from './types.ts';

export interface Recorded {
  commands: CommandDef[];
  menus: MenuDef[];
  tools: Map<string, ToolSpec> | ToolSpec[];
  toolGroups?: { name: string; ids: string[]; opts: Record<string, unknown>; at: ReturnType<typeof site> }[];
  springs: SpringDef[];
}

export class CommandsBuilder<S = any> {
  private readonly into: { commands: CommandDef[] };
  private readonly source: string | undefined;
  constructor(into: { commands: CommandDef[] }, source?: string) {
    this.into = into;
    this.source = source;
  }
  add(id: string, spec: CommandSpec<S, Ctx<S>> | ((ctx: Ctx<S>, ...a: any[]) => unknown) = {}): this {
    const at = site();
    const s: CommandSpec<S, Ctx<S>> = typeof spec === 'function' ? { run: spec } : { ...spec };
    s.at = at;
    if (this.source) s.source = this.source;
    this.into.commands.push({ id, spec: s, at, source: this.source });
    return this;
  }
}

export class MenusBuilder {
  private readonly into: { menus: MenuDef[] };
  private readonly source: string | undefined;
  constructor(into: { menus: MenuDef[] }, source?: string) {
    this.into = into;
    this.source = source;
  }
  /** a second .menu() with the same label adds to that menu (after a separator), so modules can extend File or Window */
  menu(label: string, items: MenuItem[]): this {
    const prev = this.into.menus.find(m => m.label === label);
    if (prev) prev.items = prev.items.concat(['-'], items);
    else this.into.menus.push({ label, items: items.slice(), at: site(), source: this.source });
    return this;
  }
}

export class ToolsBuilder<S = any> {
  private readonly into: { tools: ToolSpec[] | Map<string, ToolSpec>; springs: SpringDef[]; toolGroups?: Recorded['toolGroups'] };
  private readonly source: string | undefined;
  constructor(into: { tools: ToolSpec[] | Map<string, ToolSpec>; springs: SpringDef[]; toolGroups?: Recorded['toolGroups'] }, source?: string) {
    this.into = into;
    this.source = source;
  }
  tool(id: string, spec: Omit<ToolSpec<S>, 'id'> = {}): this {
    const t: ToolSpec = { ...(spec as ToolSpec), id, at: site(), source: this.source };
    if (this.into.tools instanceof Map) this.into.tools.set(id, t);
    else this.into.tools.push(t);
    return this;
  }
  group(name: string, ids: string[], opts: Record<string, unknown> = {}): this {
    (this.into.toolGroups ||= []).push({ name, ids, opts, at: site() });
    return this;
  }
  spring(chord: string, tool: SpringDef['tool'], opts: SpringDef['opts'] = {}): this {
    this.into.springs.push({ chord, tool, opts, at: site() });
    return this;
  }
}
