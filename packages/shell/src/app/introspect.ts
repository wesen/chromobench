// Introspection for an agent with only eval (CHB-035 design §34; CHB-037 P6b): the command table as data (what a
// command is called, the arguments it takes, the keys, menus and buttons that run it and with which arguments,
// whether it is enabled and why not), the controls of a built program (what each one writes: a state path through
// its bind, a document path, or a command) with their live values, and every command a key, a menu, a toolbar or a
// button can reach. The workbench (`wb` in the agent's DSL) is a thin adapter over these; the two completeness tests
// use them too, so the agent's surface and the screen cannot drift apart.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Command } from '../core/commands.ts';
import type { KeyTarget } from '../core/keys.ts';
import { bindingPath } from '../core/track.ts';
import { pathStr } from '../core/util.ts';
import type { Store } from '../core/store.ts';
import { walk, type NodeData } from '../ir/node.ts';
import type { MenuItem, UiIR } from '../build/types.ts';
import type { Runtime } from './runtime.ts';

/** One command of the table, as data. */
export interface CommandRow {
  id: string;
  label: string;
  group?: string;
  /** the kit that declares it */
  source?: string;
  doc?: string;
  /** the menu that places it ("File", "Layer ▸ Add") */
  menu?: string;
  /** the keys that run it, with the arguments they pass */
  keys: { chord: string; scope: string; args?: unknown[] }[];
  /** its arguments: declared (`args` in the spec), else the handler's parameter names after ctx */
  args: string[];
  enabled: boolean;
  why?: string;
  hidden: boolean;
  checked?: boolean;
  builtin: boolean;
  requires?: string[];
}

/** One control of a built program: where it is, what it writes, and (live) what it shows. */
export interface ControlRow {
  module: string | null;
  /** the panel it sits in, when it sits in one */
  panel: string | null;
  form: string;
  label?: string;
  /** the state path a bound control writes (`docs.f1.…` for a document, `view.split` for the view tier) */
  bind?: string;
  /** a document path a kit control edits (cb.arg's `path`) */
  path?: string;
  /** the command it runs, and the arguments it passes */
  command?: string;
  args?: unknown[];
  /** a handler lambda: nothing an agent can name (the completeness test refuses these) */
  lambda?: boolean;
  /** with { live }: the value it shows */
  value?: unknown;
}

/** A command a person can reach, and from where. */
export interface Reach {
  id: string;
  args?: unknown[];
  from: 'key' | 'menu' | 'button' | 'toolbar' | 'control';
  where: string;
}

const CONTROL_KINDS = new Set(['field', 'track', 'choice', 'button', 'plane']);
const HANDLERS = ['run', 'set', 'onEnter', 'onClick'] as const;

/** The parameter names of a handler after its first (ctx), from its source text. */
export function paramNames(fn: unknown): string[] {
  if (typeof fn !== 'function') return [];
  let src = '';
  try {
    src = Function.prototype.toString.call(fn);
  } catch {
    return [];
  }
  const m = /^(?:async\s*)?(?:function\b[^(]*)?\(([^)]*)\)/.exec(src.trim()) ?? /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(src.trim()) ?? /^[A-Za-z_$][\w$]*\s*\(([^)]*)\)/.exec(src.trim());
  if (!m) return [];
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of m[1]!) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.slice(1).map((p) => p.trim().replace(/\s*=.*$/s, '').replace(/^\.\.\./, '…')).map((p) => (/^[{[]/.test(p) ? 'options' : p)).filter(Boolean);
}

const targetOf = (t: KeyTarget): { id: string; args?: unknown[] } | null =>
  typeof t === 'string' ? { id: t } : Array.isArray(t) ? { id: String(t[0]), ...(t.length > 1 ? { args: t.slice(1) } : {}) } : null;

function argsOf(rt: Runtime, c: Command, seen = new Set<string>()): string[] {
  const declared = c['args'];
  if (Array.isArray(declared)) return declared.map(String);
  if (typeof c.run === 'string' && !seen.has(c.run)) {
    seen.add(c.run);
    const t = rt.commands.get(c.run);
    return t ? argsOf(rt, t, seen) : [];
  }
  return paramNames(c.run);
}

function menuPaths(items: readonly MenuItem[] | undefined, label: string, out: Map<string, string>, state: unknown): void {
  for (const it of items ?? []) {
    if (typeof it === 'string') {
      if (it !== '-' && !out.has(it)) out.set(it, label);
    } else if (typeof it === 'function') {
      let rows: MenuItem[] = [];
      try {
        rows = (it as (s: unknown) => MenuItem[])(state) ?? [];
      } catch {
        rows = [];
      }
      menuPaths(rows, label, out, state);
    } else if (it && typeof it === 'object') {
      const sub = `${label} ▸ ${typeof it.label === 'string' ? it.label : '…'}`;
      const run = it.run !== undefined ? targetOf(it.run) : null;
      if (run && !out.has(run.id)) out.set(run.id, sub);
      if (Array.isArray(it.items)) menuPaths(it.items, sub, out, state);
    }
  }
}

/** The command table as data, evaluated against the runtime's state (labels, enabled and why, hidden, checked). */
export function commandTable(rt: Runtime): CommandRow[] {
  const st = rt.store.readonly();
  const menus = new Map<string, string>();
  for (const m of rt.app.ir.menus) menuPaths(m.items, m.label, menus, st);
  const keys = new Map<string, CommandRow['keys']>();
  for (const b of rt.keymap.bindings) {
    if (b.bad) continue;
    const t = targetOf(b.target);
    if (!t) continue;
    const list = keys.get(t.id) ?? [];
    list.push({ chord: b.chord, scope: b.scope, ...(t.args ? { args: t.args } : {}) });
    keys.set(t.id, list);
  }
  return rt.commands.all().map((c) => {
    const status = rt.commands.status(c.id, st);
    const checked = rt.commands.checked(c.id, st);
    return {
      id: c.id,
      label: rt.commands.label(c.id, st),
      ...(c.group ? { group: c.group } : {}),
      ...(typeof c.source === 'string' ? { source: c.source } : {}),
      ...(typeof c.doc === 'string' ? { doc: c.doc } : {}),
      ...(menus.has(c.id) ? { menu: menus.get(c.id)! } : {}),
      keys: keys.get(c.id) ?? [],
      args: argsOf(rt, c),
      enabled: status.ok,
      ...(status.why ? { why: status.why } : {}),
      hidden: rt.commands.hidden(c.id, st),
      ...(checked !== undefined ? { checked } : {}),
      builtin: !!c.builtin,
      ...(c.requires ? { requires: ([] as string[]).concat(c.requires) } : {}),
    };
  });
}

function evalLive(v: unknown, state: unknown): unknown {
  try {
    return typeof v === 'function' ? (v as (s: unknown) => unknown)(state) : v;
  } catch (e) {
    return `⚠ ${(e as Error)?.message ?? e}`;
  }
}

/** A control's bind as a state path ('?' when it reads no single path). */
function bindPath(b: unknown, store: Store | undefined): string {
  if (typeof b === 'string') return b;
  if (typeof b !== 'function' || !store) return '?';
  const r = bindingPath(store, b as (s: any) => unknown, { probe: true });
  return r.path ? pathStr(r.path) : '?';
}

/** Every node of the program with the module and panel it sits in (panels referenced by id are followed once). */
function eachNode(ir: UiIR, f: (n: NodeData, module: string | null, panel: string | null) => void, o: { module?: string } = {}): void {
  const visit = (root: unknown, module: string | null, panel0: string | null, seen: Set<string>): void => {
    const panelOf = new Map<NodeData, string | null>();
    walk(root, (n, _d, parent) => {
      let panel = parent ? (panelOf.get(parent) ?? panel0) : panel0;
      if (n.$ === 'panel' && n.props['id'] != null) panel = String(n.props['id']);
      panelOf.set(n, panel);
      if (n.$ === 'panelref') {
        const id = String(n.props['id']);
        const p = ir.panels.get(id);
        if (p && !seen.has(id)) visit(p, module, id, new Set([...seen, id]));
      }
      f(n, module, panel);
    });
  };
  for (const m of ir.modules) {
    if (o.module && m.id !== o.module) continue;
    for (const r of Object.values(m.regions)) if (r) visit(r, m.id, null, new Set());
  }
}

/** The controls of a built program; with { live } their values in that state; { module } one module only. */
export function controlsOf(ir: UiIR, o: { store?: Store; live?: unknown; module?: string } = {}): ControlRow[] {
  const out: ControlRow[] = [];
  eachNode(ir, (n, module, panel) => {
    const kind = ir.forms.get(n.$)?.kind;
    const p = n.props;
    const isKitArg = typeof p['path'] === 'string' && kind === 'cb';
    if (!CONTROL_KINDS.has(kind ?? '') && !isKitArg) return;
    const row: ControlRow = { module, panel, form: n.$ };
    const label = typeof p['label'] === 'string' ? p['label'] : typeof p['text'] === 'string' ? p['text'] : typeof p['title'] === 'string' ? p['title'] : undefined;
    if (label) row.label = label;
    if (p['bind'] !== undefined) row.bind = bindPath(p['bind'], o.store);
    if (isKitArg) row.path = String(p['path']);
    for (const h of HANDLERS) {
      const v = p[h];
      if (v === undefined) continue;
      const t = targetOf(v as KeyTarget);
      if (t) {
        row.command = t.id;
        const args = t.args ?? (Array.isArray(p['args']) ? (p['args'] as unknown[]) : undefined);
        if (args) row.args = args;
      } else if (typeof v === 'function') row.lambda = true;
      break;
    }
    if (o.live !== undefined && p['bind'] !== undefined) row.value = evalLive(p['bind'], o.live);
    out.push(row);
  }, o.module ? { module: o.module } : {});
  return out;
}

/** Every command a key, a menu, a toolbar, a button or another control can run (in the runtime's current state). */
export function reachableCommands(rt: Runtime): Reach[] {
  const out: Reach[] = [];
  const st = rt.store.readonly();
  for (const b of rt.keymap.bindings) {
    if (b.bad) continue;
    const t = targetOf(b.target);
    out.push(t ? { ...t, from: 'key', where: `${b.chord} (${b.scope})` } : { id: '(a key handler lambda)', from: 'key', where: `${b.chord} (${b.scope})` });
  }
  const menus = new Map<string, string>();
  for (const m of rt.app.ir.menus) menuPaths(m.items, m.label, menus, st);
  for (const [id, where] of menus) out.push({ id, from: 'menu', where });
  eachNode(rt.app.ir, (n, module) => {
    const where = `${module ?? '?'}: ${n.$}${n.props['id'] != null ? ` ${String(n.props['id'])}` : ''}`;
    if (n.$ === 'toolbar' && Array.isArray(n.props['items'])) {
      for (const it of n.props['items'] as unknown[]) if (typeof it === 'string' && it !== '-' && it !== '~') out.push({ id: it, from: 'toolbar', where });
      return;
    }
    const kind = rt.app.ir.forms.get(n.$)?.kind;
    if (!CONTROL_KINDS.has(kind ?? '')) return;
    for (const h of HANDLERS) {
      const v = n.props[h];
      if (v === undefined) continue;
      const t = targetOf(v as KeyTarget);
      out.push(t ? { ...t, from: kind === 'button' ? 'button' : 'control', where } : { id: '(a handler lambda)', from: kind === 'button' ? 'button' : 'control', where });
    }
    const menu = n.props['menu'];
    if (Array.isArray(menu)) {
      const m = new Map<string, string>();
      menuPaths(menu as MenuItem[], where, m, st);
      for (const [id, w] of m) out.push({ id, from: 'menu', where: w });
    }
  });
  return out;
}

