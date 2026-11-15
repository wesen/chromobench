// The studio as the agent's workbench (CHB-035 design §34; CHB-037 P6b): the adapter behind `wb` in the agent's DSL.
// It answers from the mounted runtime and the Studio, as data: the command table (the shell's introspection), a
// command run as the agent (Store.acting: proposals in ask mode, the agent as author in auto mode, document edits
// refused in read-only), a state path written as a bound control writes it, the typed selectors (`cb.sel.*` and the
// kits' `sel`), the screen with live values and what each control writes, and layouts written in the sandbox.
//
// An agent's layout arrives as data: the recording of its build(ck, cb, env) (packages/dsl prelude). `realizeLayout`
// replays it on a fresh ck and cb — names are looked up on the real builders, never evaluated as code; `cb.sel.<name>`
// becomes a selector lambda (calls after it apply to the selector's result, `.not()`, `.eq(v)`, `.or(v)` and
// `.where({ field: v })` are its combinators) and `cb.state.<path>` a path lambda — so the lambdas the program runs are
// the host's own. Building it runs the passes; `use` asks the photographer through the host.
//
// The shape matches @chromobench/dsl's `Workbench` structurally (studio-kit does not import the DSL; a type test
// checks the fit).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChromobenchError, closest, diag, type AgentMode } from '@chromobench/contract';
import type { LogEntry } from '@chromobench/values';
import { controlsOf, createCk, paramNames, Store, type ControlRow, type Runtime } from '@chromobench/shell';
import { createCb, type Cb } from '../../../src/cb.ts';
import { buildLayout, type LayoutDef } from '../../../src/layout.ts';
import { read } from '../../../src/model/doc.ts';
import { sel } from '../../../src/sel.ts';
import type { Studio } from '../../../src/studio.ts';

/** A layout written in the sandbox, as data (the DSL's WbLayoutData). */
export interface AgentLayout {
  kind: 'layout';
  id: string;
  label: string;
  description?: string;
  enlarger?: 'real' | 'normalised';
  tree: unknown;
}

export interface LayoutInfo {
  id: string;
  label: string;
  agent: boolean;
}

/** What the host gives the workbench: the runtime on screen, the layouts, and how a layout is proposed. */
export interface WorkbenchHost {
  /** the runtime of the layout on screen (View ▸ Layout replaces it) */
  rt(): Runtime | null;
  studio: Studio;
  layout(): LayoutInfo;
  available(): { id: string; label: string }[];
  /** asks the photographer to use the layout (a dialog); resolves when asked, not when answered */
  propose?(def: LayoutDef, o: { why?: string; eval: string }): { status: 'proposed' | 'refused'; note: string };
  /** registers an agent-written look where the studio compiles (the host imports the DSL's defineLookSource) */
  defineLook?(src: string): Promise<{ name: string; version: number; label: string }> | { name: string; version: number; label: string };
}

interface Actor {
  eval: string;
  why?: string;
}

const wbFail = (message: string, extra: Record<string, unknown> = {}): never => {
  throw new ChromobenchError(diag('E_WORKBENCH', message, extra as never));
};
const layoutFail = (message: string, extra: Record<string, unknown> = {}): never => {
  throw new ChromobenchError(diag('E_LAYOUT', message, extra as never));
};

/** A value as plain data: functions dropped (a frame handle says what it is), cycles cut, depth and length capped. */
export function toData(v: unknown, depth = 0, seen: object[] = []): unknown {
  if (v === undefined || typeof v === 'function') return undefined;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v !== 'object') return String(v);
  if (depth > 14) return '[too deep]';
  if (seen.includes(v)) return '[circular]';
  const o = v as Record<string, unknown>;
  if (o['$'] === 'cb.frame' || o['$'] === 'cb.image') return { $: o['$'], frame: o['frame'], expr: o['expr'] };
  seen.push(v);
  let out: unknown;
  if (Array.isArray(v)) out = v.slice(0, 500).map((x) => toData(x, depth + 1, seen) ?? null);
  else {
    const r: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      const x = toData(o[k], depth + 1, seen);
      if (x !== undefined) r[k] = x;
    }
    out = r;
  }
  seen.pop();
  return out;
}

// ---- selectors ---------------------------------------------------------------------------------
type SelFn = (s: unknown, ...a: unknown[]) => unknown;

/** The typed selectors by name: cb.sel's own ('frame'), and the kits' ('roll.frames'). */
export function selectorTable(cb: Cb): Map<string, SelFn> {
  const out = new Map<string, SelFn>();
  for (const [k, f] of Object.entries(cb.sel ?? sel)) if (typeof f === 'function') out.set(k, f as SelFn);
  for (const [kit, p] of Object.entries(cb.kits as Record<string, { sel?: Record<string, unknown> }>)) {
    for (const [k, f] of Object.entries(p.sel ?? {})) if (typeof f === 'function') out.set(`${kit}.${k}`, f as SelFn);
  }
  return out;
}

// ---- layouts: replaying the sandbox's recording on the real builders ----------------------------
type Step = string | { args: unknown[]; line?: number };
interface Expr {
  $x: Step[];
}
const isExpr = (v: unknown): v is Expr => !!v && typeof v === 'object' && Array.isArray((v as Expr).$x);
const NOT_A_NAME = new Set(['__proto__', 'prototype', 'constructor', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'call', 'apply', 'bind', 'caller', 'arguments']);
const COMBINATORS = new Set(['not', 'eq', 'or', 'where']);

const exprText = (steps: readonly Step[]): string => steps.map((s, i) => (typeof s === 'string' ? `${i ? '.' : ''}${s}` : '(…)')).join('');
const lineOf = (steps: readonly Step[]): number | undefined => {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (typeof s !== 'string' && s.line !== undefined) return s.line;
  }
  return undefined;
};
const at = (steps: readonly Step[]): string => {
  const l = lineOf(steps);
  return `${l !== undefined ? `line ${l}: ` : ''}${exprText(steps)}`;
};

function selectorLambda(base: Record<string, unknown>, steps: Step[], from: number): (s: unknown) => unknown {
  const name = steps[from];
  if (typeof name !== 'string') return layoutFail(`${at(steps)}: a selector needs a name (cb.sel.frame)`);
  const fn = base[name];
  if (typeof fn !== 'function') {
    const g = closest(name, Object.keys(base));
    return layoutFail(`${at(steps)}: no selector ${name}`, { ...(g ? { hint: `did you mean ${g}?` } : {}), valid: Object.keys(base) });
  }
  let i = from + 1;
  let selArgs: unknown[] = [];
  const first = steps[i];
  if (first !== undefined && typeof first !== 'string') {
    selArgs = first.args;
    i++;
  }
  const rest: { name: string; args?: unknown[] }[] = [];
  for (; i < steps.length; i++) {
    const s = steps[i]!;
    if (typeof s === 'string') {
      if (NOT_A_NAME.has(s)) layoutFail(`${at(steps)}: ${s} is not a field`);
      rest.push({ name: s });
    } else {
      const last = rest.at(-1);
      if (!last || last.args) layoutFail(`${at(steps)}: a call needs a method name`);
      else last.args = s.args;
    }
  }
  return (st: unknown) => {
    let v: any = (fn as SelFn)(st, ...selArgs);
    for (const r of rest) {
      if (r.args && COMBINATORS.has(r.name)) {
        if (r.name === 'not') v = !v;
        else if (r.name === 'eq') v = v === r.args[0];
        else if (r.name === 'or') v = v ?? r.args[0];
        else if (r.name === 'where' && Array.isArray(v)) {
          const m = (r.args[0] ?? {}) as Record<string, unknown>;
          v = v.filter((x: any) => Object.entries(m).every(([k, want]) => x?.[k] === want));
        }
        continue;
      }
      if (v == null) return null;
      v = r.args ? (typeof v[r.name] === 'function' ? v[r.name](...r.args) : undefined) : v[r.name];
    }
    return v ?? null;
  };
}

function stateLambda(steps: Step[]): (s: unknown) => unknown {
  const path = steps.slice(2);
  if (!path.length || !path.every((p): p is string => typeof p === 'string' && !NOT_A_NAME.has(p))) return layoutFail(`${at(steps)}: a state path is names only (cb.state.view.step)`);
  return (st: unknown) => path.reduce<any>((o, k) => (o == null ? undefined : o[k]), st) ?? null;
}

/** Replays a recorded value on the real ck and cb. */
export function realize(v: unknown, roots: { ck: unknown; cb: unknown }): unknown {
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const x of v) {
      if (x && typeof x === 'object' && '$spread' in x && isExpr((x as { $spread: unknown }).$spread)) {
        const r = realizeExpr((x as { $spread: Expr }).$spread, roots);
        if (!r || typeof (r as Iterable<unknown>)[Symbol.iterator] !== 'function') layoutFail(`${at((x as { $spread: Expr }).$spread.$x)} is not a list: it cannot be spread with ...`);
        out.push(...(r as Iterable<unknown>));
      } else out.push(realize(x, roots));
    }
    return out;
  }
  if (isExpr(v)) return realizeExpr(v, roots);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k.startsWith('$spread')) {
        const r = isExpr(x) ? realizeExpr(x, roots) : null;
        if (!r || typeof r !== 'object') layoutFail(`${isExpr(x) ? at(x.$x) : k} is not an object: it cannot be spread with ...`);
        Object.assign(o, r);
      } else o[k] = realize(x, roots);
    }
    return o;
  }
  return v;
}

function realizeExpr(x: Expr, roots: { ck: unknown; cb: unknown }): unknown {
  const steps = x.$x;
  const root = steps[0];
  if (root !== 'ck' && root !== 'cb') return layoutFail(`a layout starts from ck or cb, not ${String(root)}`);
  if (root === 'cb' && steps[1] === 'state') return stateLambda(steps);
  const cb = roots.cb as Record<string, any>;
  if (root === 'cb' && steps[1] === 'sel') return selectorLambda(cb['sel'], steps, 2);
  if (root === 'cb' && steps[1] === 'kits' && typeof steps[2] === 'string' && steps[3] === 'sel') return selectorLambda(cb['kits']?.[steps[2]]?.sel ?? {}, steps, 4);
  let cur: any = roots[root];
  let self: unknown;
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i]!;
    if (typeof s === 'string') {
      if (NOT_A_NAME.has(s) || s.startsWith('_')) layoutFail(`${at(steps.slice(0, i + 1))}: ${s} is not a builder name`);
      if (cur == null) layoutFail(`${at(steps.slice(0, i))} is empty: it has no ${s}`);
      const next = cur[s];
      if (next === undefined) {
        const names = Object.keys(cur).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(cur) ?? {})).filter((n) => !n.startsWith('_') && n !== 'constructor');
        const g = closest(s, names);
        layoutFail(`${at(steps.slice(0, i + 1))}: ${exprText(steps.slice(0, i))} has no ${s}`, { ...(g ? { hint: `did you mean ${g}?`, fix: `${exprText(steps.slice(0, i))}.${g}` } : {}) });
      }
      self = cur;
      cur = next;
    } else {
      if (typeof cur !== 'function') layoutFail(`${at(steps.slice(0, i + 1))}: ${exprText(steps.slice(0, i))} is not a function`);
      const args = realize(s.args, roots) as unknown[];
      try {
        cur = cur.apply(self, args);
      } catch (e) {
        const err = e as { code?: string; message?: string; diag?: { message?: string; fix?: string } };
        if (err instanceof ChromobenchError && err.code === 'E_LAYOUT') throw e;
        layoutFail(`${at(steps.slice(0, i + 1))}: ${err?.diag?.message ?? err?.message ?? String(e)}`, err?.diag?.fix ? { fix: err.diag.fix } : {});
      }
      self = undefined;
    }
  }
  return cur;
}

/** The layout definition an agent's layout data stands for (its build replays the recording). */
export function realizeLayout(l: AgentLayout): LayoutDef {
  if (!l || l.kind !== 'layout' || typeof l.id !== 'string' || !isExpr(l.tree)) layoutFail('not a layout from wb.layouts.build (kind, id, label, tree)');
  return {
    id: l.id,
    label: l.label,
    ...(l.description !== undefined ? { description: l.description } : {}),
    ...(l.enlarger !== undefined ? { enlarger: l.enlarger } : {}),
    build: (ck, cb) => realize(l.tree, { ck, cb }),
  };
}

// ---- the workbench -----------------------------------------------------------------------------

/** A control in the agent's words: a document path (with its frame), a state path, or a command. */
function controlView(c: ControlRow, studio: Studio): Record<string, unknown> {
  const f = studio.current;
  const out: Record<string, unknown> = { module: c.module, panel: c.panel, form: c.form, ...(c.label ? { label: c.label } : {}) };
  if (c.path) {
    out['path'] = c.path;
    if (f) {
      out['frame'] = f;
      const v = read(studio.doc(f) ?? null, c.path, studio.links());
      if (v !== undefined) out['value'] = toData(v);
    }
  }
  if (c.bind && c.bind !== '?') {
    out['state'] = c.bind;
    if (c.value !== undefined) out['value'] = toData(c.value);
  }
  if (c.command) {
    out['command'] = c.command;
    if (c.args) out['args'] = toData(c.args);
  }
  return out;
}

export interface StudioWorkbench {
  commands(): unknown[];
  run(id: string, args: readonly unknown[], o: Actor): Promise<unknown>;
  set(path: string, value: unknown, o: Actor): unknown;
  selectors(): { name: string; args: string[] }[];
  state(name: string, args: readonly unknown[]): unknown;
  screen(o: { module?: string }): unknown;
  layouts(): { current: LayoutInfo; available: { id: string; label: string }[] };
  build(l: AgentLayout): unknown;
  use(l: AgentLayout, o: Actor): unknown;
  defineLook(src: string): unknown;
}

export function studioWorkbench(host: WorkbenchHost): StudioWorkbench {
  const studio = host.studio;
  const cb = createCb(createCk());
  const selectors = selectorTable(cb);
  const rtNow = (): Runtime => host.rt() ?? wbFail('the studio has no layout mounted');
  const actorOf = (mode: AgentMode, id: string, o: Actor) => ({
    by: 'agent' as const,
    source: { kind: 'agent', eval: o.eval, command: id },
    ...(o.why !== undefined ? { why: o.why } : {}),
    ...(mode === 'ask' ? { propose: true } : {}),
    ...(mode === 'read-only' ? { refuse: 'the agent is read-only: the command\'s change to the document was refused' } : {}),
  });
  /** runs fn as the agent; what it did to the log, and whether a refusal came */
  const asAgent = async (id: string, o: Actor, fn: (rt: Runtime) => unknown) => {
    const rt = rtNow();
    const before = rt.store.log.entries.at(-1)?.seq ?? 0;
    let refused: string | null = null;
    const off = rt.on('refused', (e: { cause2?: { code?: string; message?: string } }) => void (refused = e.cause2?.message ?? 'refused'));
    let result: unknown;
    try {
      result = rt.store.acting(actorOf(studio.mode, id, o), () => fn(rt));
      if (result && typeof (result as Promise<unknown>).then === 'function') result = await result;
    } finally {
      off();
    }
    const entries: LogEntry[] = rt.store.log.entries.filter((e) => e.seq > before);
    const how = refused ? 'refused' : entries.some((e) => e.tx.status === 'pending') ? 'proposed' : entries.length ? 'committed' : 'none';
    return {
      ok: !refused, ...(refused ? { why: refused } : {}), ...(result !== undefined && result !== false ? { result: toData(result) } : {}),
      entries: entries.map((e) => toData(e) as LogEntry), how, module: rt.module ?? null, frame: studio.current,
    };
  };
  const build = (l: AgentLayout) => {
    let built: ReturnType<typeof buildLayout>;
    try {
      built = buildLayout(realizeLayout(l));
    } catch (e) {
      const d = e instanceof ChromobenchError ? e.diag : { code: 'E_LAYOUT', message: String((e as Error)?.message ?? e) };
      return { ok: false, layout: l, errors: [{ level: 'error' as const, code: d.code, message: d.message, ...(d.fix ? { fix: d.fix } : {}) }], warnings: [], explain: '', controls: [], def: null };
    }
    const list = built.app.diagnostics.list.map((d) => ({ level: d.level as 'error' | 'warning' | 'info', code: d.code, message: d.message, ...(d.fix ? { fix: d.fix } : {}) }));
    const errors = list.filter((d) => d.level === 'error');
    const controls = controlsOf(built.app.ir, { store: new Store({}) }).map((c) => controlView(c, studio));
    return { ok: errors.length === 0, layout: l, errors, warnings: list.filter((d) => d.level === 'warning'), explain: built.app.explain(), controls, def: built.def };
  };
  return {
    commands: () => rtNow().commandTable().map(({ requires: _r, ...c }) => c),
    async run(id, args, o) {
      const rt = rtNow();
      if (!rt.commands.has(id)) {
        const g = rt.commands.suggest(id);
        wbFail(`no command ${id}`, { ...(g.length ? { hint: `did you mean ${g.join(', ')}?`, fix: `wb.run('${g[0]}')` } : { hint: 'wb.commands() lists them' }) });
      }
      const status = rt.commands.status(id, rt.store.readonly());
      if (!status.ok) return { ok: false, why: status.why ?? 'not available', entries: [], how: 'none', module: rt.module ?? null, frame: studio.current };
      return asAgent(id, o, (r) => r.runCommand(id, null, ...args));
    },
    set: (path, value, o) => asAgent(`set ${path}`, o, (r) => r.store.set(path, value, { label: `Agent: ${path}` })),
    selectors: () => [...selectors].map(([name, f]) => ({ name, args: paramNames(f) })),
    state(name, args) {
      const f = selectors.get(name);
      if (!f) {
        const g = closest(name, [...selectors.keys()]);
        return wbFail(`no selector ${name}`, { ...(g ? { hint: `did you mean ${g}?`, fix: `wb.state('${g}')` } : {}), valid: [...selectors.keys()] });
      }
      return toData(f(rtNow().store.readonly(), ...args)) ?? null;
    },
    screen(o) {
      const rt = rtNow();
      const module = o.module ?? rt.module ?? undefined;
      if (module && !rt.modules.has(module)) wbFail(`no module ${module}`, { valid: [...rt.modules.keys()] });
      return {
        layout: host.layout(),
        module: module ?? null,
        modules: rt.app.ir.modules.map((m) => ({ id: m.id, label: String(m.label ?? m.id) })),
        frame: studio.current,
        tool: (rt.store.peek(['ui', 'tool']) as string | null | undefined) ?? null,
        text: rt.explain({ live: true, ...(module ? { module } : {}) }),
        controls: rt.controls(module ? { module } : {}).map((c) => controlView(c, studio)),
      };
    },
    layouts: () => ({ current: host.layout(), available: host.available() }),
    build: (l) => {
      const { def: _d, ...r } = build(l);
      return r;
    },
    use(l, o) {
      const b = build(l);
      if (!b.ok || !b.def) return { status: 'refused', id: l.id, label: l.label, note: `the layout does not build: ${b.errors.map((e) => `${e.code} ${e.message}`).join('; ')}` };
      if (!host.propose) return { status: 'refused', id: l.id, label: l.label, note: 'this studio cannot switch layouts' };
      const r = host.propose(b.def, { eval: o.eval, ...(o.why !== undefined ? { why: o.why } : {}) });
      return { status: r.status, id: l.id, label: l.label, note: r.note };
    },
    async defineLook(src) {
      if (!host.defineLook) return wbFail('this studio cannot register looks written by the agent');
      return host.defineLook(src);
    },
  };
}
