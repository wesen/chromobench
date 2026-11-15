// Nodes: the UI IR (port of CraftKit ui/node.js, headless half) as immutable values (CHB-035 design §30, §32).
// ck.ui.slider({ … }), ck.panel.define(…), ck.row(…) never touch the DOM: they return a node { $: form, props, kids,
// at, diags }, recorded with the call site that made it. The build walks the tree (bindings, options, binding times);
// a renderer mounts it later.
//
// A node is frozen. Every chain method is a modifier applied with `with`: `n.tip('x')` ≡ `n.with(ck.mod.tip('x'))`,
// and `n.with({ density: 'compact' })` merges into the props. The methods a node answers are fixed when it is made,
// by the vocabulary of the ck instance that made it: the common ones (with, prop, slot, tip, enabled, hidden), one
// setter per slot of its form, and the fragment methods registered with ck.extend. Any other method name is a build
// error (CK-X120) with "did you mean", thrown where it is called.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { EXPLAIN, explain, identity, modifier, site, toModifier, type CallSite, type Json, type Modifier, type With } from '@chromobench/values';
import { isObj, isPlainObject, suggest } from '../core/util.ts';
import { BuildError, diag, type Diag } from '../core/diag.ts';
import { commonSlots, type SlotTable } from './slots.ts';
import { builtinForms, type FormSpec } from './forms.ts';
import type { Fragment } from '../build/types.ts';

export const NODE = Symbol.for('ck.node');
const VOCAB = Symbol.for('ck.node.vocab');

/** The plain IR record. */
export interface NodeData<F extends string = string> {
  readonly $: F;
  readonly props: Readonly<Record<string, any>>;
  readonly kids: readonly NodeData[];
  readonly at: CallSite | null;
  readonly diags: readonly Diag[];
}

export interface NodePatch {
  props?: Record<string, unknown>;
  kids?: readonly unknown[];
  diags?: readonly Diag[];
}

/** Data fields, the common chain methods, and names generic code probes for: never slot setters or fragment methods. */
const DATA = new Set(['$', 'props', 'kids', 'at', 'diags']);
export const CHAIN = ['with', 'prop', 'slot', 'tip', 'enabled', 'hidden'] as const;
const PROBES = new Set([
  'then', 'catch', 'finally', 'toJSON', 'toString', 'valueOf', 'constructor', 'asymmetricMatch', 'nodeType', 'nodeName', 'tagName', 'inspect',
  'length', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'kind', 'form', 'spec', 'isCommand', 'ownerDocument',
]);
const isMethodName = (k: string): boolean => /^[a-zA-Z][A-Za-z0-9_]*$/.test(k) && !PROBES.has(k) && !DATA.has(k);

export const isNode = (v: unknown): v is NodeData => !!(v && typeof v === 'object' && (v as any)[NODE] === true);

export function flatKids(kids: unknown): NodeData[] {
  const out: any[] = [];
  for (const k of ([] as unknown[]).concat(kids as any)) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) out.push(...flatKids(k));
    else out.push(k);
  }
  return out;
}

// ── modifiers on nodes ────────────────────────────────────────────────────
/** a node, or the plain record of one (a modifier may receive either) */
type NodeLike = NodeData;
/** props merged into a node (a new node), or into a plain record (a new record) */
export function patchProps<N extends NodeLike>(n: N, p: Record<string, unknown>): N {
  if (isNode(n)) return rebuildNode(n, { props: { ...n.props, ...p } });
  const d = n as NodeData;
  return { ...d, props: { ...(d.props || {}), ...p } } as unknown as N;
}
const listOf = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** The node modifiers: what the common chain methods apply (`n.tip(v)` ≡ `n.with(mod.tip(v))`). */
export const nodeMods = {
  /** one prop */
  prop: (key: string, value: unknown): Modifier<NodeLike> => modifier<NodeLike>(key, n => patchProps(n, { [key]: value }), [value]),
  /** several props (the same as `with(patch)`) */
  props: (p: Record<string, unknown>): Modifier<NodeLike> => modifier<NodeLike>('props', n => patchProps(n, p), [p]),
  /** append to a list slot (overlays, badges) */
  slot: (key: string, ...items: unknown[]): Modifier<NodeLike> => modifier<NodeLike>(key, n => patchProps(n, { [key]: listOf(n.props[key]).concat(items) }), items),
  tip: (v: unknown): Modifier<NodeLike> => modifier<NodeLike>('tip', n => patchProps(n, { tip: v }), [v]),
  /** enabled (τ) and, when it is not, why */
  enabled: (v: unknown, why?: unknown): Modifier<NodeLike> => modifier<NodeLike>('enabled', n => patchProps(n, why === undefined ? { enabled: v } : { enabled: v, why }), why === undefined ? [v] : [v, why]),
  hidden: (v: unknown): Modifier<NodeLike> => modifier<NodeLike>('hidden', n => patchProps(n, { hidden: v }), [v]),
  /** a build-time choice: m when cond holds, else nothing (identity) */
  when: <T>(cond: boolean, m: Modifier<T>): Modifier<T> => (cond ? m : identity<T>()),
};

// ── the vocabulary: which methods nodes of each form answer ──────────────
/** What a ck instance's nodes know: the forms (for slot setters) and the fragments registered with ck.extend. */
export class NodeVocab {
  private readonly protos = new Map<string, object>();
  private readonly getForms: () => ReadonlyMap<string, FormSpec>;
  private readonly getFragments: () => readonly Fragment[];
  constructor(forms: () => ReadonlyMap<string, FormSpec>, fragments: () => readonly Fragment[]) {
    this.getForms = forms;
    this.getFragments = fragments;
  }
  /** after ck.extend: nodes made from now on answer the new methods */
  invalidate(): void {
    this.protos.clear();
  }
  slotsOf(form: string): SlotTable {
    const s = this.getForms().get(form);
    const slots: Record<string, unknown> = { ...commonSlots, ...(s?.slots || {}) };
    for (const f of this.getFragments()) if (f.target === form) for (const k of [...Object.keys(f.spec.slots || {}), ...Object.keys(f.spec.props || {})]) slots[k] ??= { time: 'β' };
    return slots as SlotTable;
  }
  /** fragment methods for a target, by name (several when their `when` predicates split the nodes) */
  methodsOf(target: string): Map<string, Fragment[]> {
    const out = new Map<string, Fragment[]>();
    for (const f of this.getFragments()) if (f.target === target) for (const name of Object.keys(f.spec.methods || {})) (out.get(name) || out.set(name, []).get(name)!).push(f);
    return out;
  }
  /** every target that has a method of this name */
  targetsWith(name: string): { target: string; fragment: Fragment }[] {
    return this.getFragments()
      .filter(f => typeof f.spec.methods?.[name] === 'function')
      .map(f => ({ target: f.target, fragment: f }));
  }
  /** make a node of this vocabulary */
  node<F extends string>(form: F, props: Record<string, unknown> = {}, kids: unknown = [], at: CallSite | null = null, diags: readonly Diag[] = []): NodeData<F> {
    const n = Object.create(this.protoOf(form)) as Record<string, unknown>;
    n['$'] = form;
    n['props'] = Object.freeze({ ...(props || {}) });
    n['kids'] = Object.freeze(flatKids(kids));
    n['at'] = at;
    n['diags'] = Object.freeze(diags.slice());
    return Object.freeze(n) as unknown as NodeData<F>;
  }
  private protoOf(form: string): object {
    const cached = this.protos.get(form);
    if (cached) return cached;
    const p = Object.create(this.root()) as object;
    const own = p as Record<string, unknown>;
    for (const k of Object.keys(this.slotsOf(form))) {
      if (DATA.has(k) || (CHAIN as readonly string[]).includes(k) || PROBES.has(k)) continue;
      own[k] = function (this: NodeData, v: unknown) {
        return withNode(this, nodeMods.prop(k, v));
      };
    }
    for (const [name, frags] of this.methodsOf(form)) {
      if (DATA.has(name) || (CHAIN as readonly string[]).includes(name)) continue;
      own[name] = function (this: NodeData, ...args: unknown[]) {
        const f = frags.find(x => !x.spec.when || x.spec.when(this));
        if (!f) throw refused(this, name, frags[0]!);
        return withNode(this, f.spec.methods![name]!(...args) as With<NodeData>);
      };
    }
    Object.freeze(p);
    this.protos.set(form, p);
    return p;
  }
  private rootProto: object | null = null;
  private root(): object {
    if (!this.rootProto) {
      const r = Object.create(NODE_BASE) as Record<symbol, unknown>;
      r[VOCAB] = this;
      this.rootProto = Object.freeze(r);
    }
    return this.rootProto;
  }
  /** the method names a node answers (for "did you mean") */
  offered(n: NodeData): string[] {
    const frag = [...this.methodsOf(n.$).entries()].filter(([, fs]) => fs.some(f => !f.spec.when || f.spec.when(n))).map(([m]) => m);
    const setters = Object.keys(this.slotsOf(n.$)).filter(k => !DATA.has(k) && !PROBES.has(k) && !(CHAIN as readonly string[]).includes(k));
    return [...frag, ...CHAIN, ...setters];
  }
}

const who = (f: Fragment): string => `${f.source ? `kit ${f.source}` : 'the program'}${f.at ? ` (${f.at.file}:${f.at.line})` : ''}`;

function unknownMethod(n: NodeData, name: string): BuildError {
  const v = vocabOf(n);
  const offered = v ? v.offered(n) : [...CHAIN];
  const s = suggest(name, offered);
  const elsewhere = v ? v.targetsWith(name).filter(x => x.target !== n.$).map(x => `${x.target} (${who(x.fragment)})`) : [];
  const best = s[0] ? v?.methodsOf(n.$).get(s[0])?.[0] : undefined;
  return new BuildError(
    diag('CK-X120', `No method .${name}() on ${n.$}`, {
      at: site(),
      facts: [
        elsewhere.length ? `.${name}() exists for ${elsewhere.join(', ')}, but this is a ${n.$}.` : `No fragment registered with ck.extend adds .${name}() to ${n.$}.`,
        `${n.$} offers: ${offered.slice(0, 14).join(', ')}`,
      ],
      fix: s.length ? `Did you mean .${s[0]}()${best?.source ? ` (kit ${best.source})` : ''}?` : 'Register the fragment (or the kit that declares it) with ck.extend(…) before building, or remove the call.',
    }),
  );
}

function refused(n: NodeData, name: string, f: Fragment): BuildError {
  return new BuildError(
    diag('CK-X121', `.${name}() does not apply to this ${n.$}`, {
      at: site(),
      facts: [`${who(f)} adds .${name}() to ${n.$} nodes that pass its \`when\`; this one does not.`],
      fix: f.spec.doc || `Remove .${name}() here.`,
      source: f.source ?? 'shell',
    }),
  );
}

/** the last link of every node's prototype chain: unknown method names answer with a function that throws CK-X120 */
const GUARD = new Proxy(Object.create(Object.prototype) as object, {
  get(t, k, r) {
    if (typeof k === 'symbol' || !isMethodName(k) || k in t) return Reflect.get(t, k, r);
    return () => {
      throw unknownMethod(r as NodeData, k);
    };
  },
});

const NODE_BASE: object = Object.freeze(
  Object.assign(Object.create(GUARD), {
    [NODE]: true,
    /** a new node: a modifier, a function of the node, or a props patch */
    with(this: NodeData, x: With<NodeData>) {
      return withNode(this, x);
    },
    prop(this: NodeData, key: string, value: unknown) {
      return withNode(this, nodeMods.prop(key, value));
    },
    slot(this: NodeData, key: string, ...items: unknown[]) {
      return withNode(this, nodeMods.slot(key, ...items));
    },
    tip(this: NodeData, v: unknown) {
      return withNode(this, nodeMods.tip(v));
    },
    enabled(this: NodeData, v: unknown, why?: unknown) {
      return withNode(this, nodeMods.enabled(v, why));
    },
    hidden(this: NodeData, v: unknown) {
      return withNode(this, nodeMods.hidden(v));
    },
    [EXPLAIN](this: NodeData): Json {
      return {
        kind: 'node',
        form: this.$,
        ...(this.at ? { at: `${this.at.file}:${this.at.line}:${this.at.col}` } : {}),
        props: explain(this.props),
        ...(this.kids.length ? { kids: this.kids.map(k => explain(k)) } : {}),
      };
    },
  }),
);

const vocabOf = (n: NodeData): NodeVocab | null => ((n as any)[VOCAB] as NodeVocab | undefined) ?? null;

/** apply a modifier (or function, or props patch) to a node; a plain record that comes back is made a node again */
function withNode(n: NodeData, x: With<NodeData>): any {
  const r = toModifier<NodeData>(x, (v, p) => patchProps(v, p as Record<string, unknown>)).run(n);
  if (isNode(r)) return r;
  if (!r || typeof r !== 'object' || typeof (r as NodeData).$ !== 'string') throw new TypeError(`.with(): a node modifier returned ${r === null ? 'null' : typeof r}, not a node`);
  const d = r as NodeData;
  return (vocabOf(n) ?? DEFAULT_VOCAB).node(d.$, d.props ?? n.props, d.kids ?? n.kids, d.at ?? n.at, d.diags ?? n.diags);
}

const BUILTIN = new Map(builtinForms().map(f => [f.name, f]));
/** the vocabulary of nodes made outside a ck instance (the DOM half's own buttons and panel references) */
const DEFAULT_VOCAB = new NodeVocab(() => BUILTIN, () => []);

/** A node outside any ck instance (built-in forms' setters, no fragments). */
export function makeNode(form: string, props: Record<string, unknown> = {}, kids: unknown = [], at: CallSite | null = null): any {
  return DEFAULT_VOCAB.node(form, props, kids, at);
}

/** A copy of a node with some fields replaced (same vocabulary, same call site). */
export function rebuildNode<N extends NodeData>(n: N, patch: NodePatch): N {
  return (vocabOf(n) ?? DEFAULT_VOCAB).node(n.$, patch.props ?? n.props, patch.kids ?? n.kids, n.at, patch.diags ?? n.diags) as unknown as N;
}

// ── walking a tree (the build does this) ───────────────────────────────────
/** Visit every node: kids, and nodes inside props (ck.match cases, tabs, a viewport's hud, overlays…). */
export function walk(n: unknown, f: (n: NodeData, depth: number, parent: NodeData | null) => void | false, depth = 0, parent: NodeData | null = null): void {
  if (!isNode(n) || depth > 200) return;
  if (f(n, depth, parent) === false) return;
  for (const k of n.kids) walk(k, f, depth + 1, n);
  for (const v of Object.values(n.props)) {
    if (isNode(v)) walk(v, f, depth + 1, n);
    else if (Array.isArray(v)) {
      for (const x of v) if (isNode(x)) walk(x, f, depth + 1, n);
    } else if (isPlainObject(v)) for (const x of Object.values(v)) if (isNode(x)) walk(x, f, depth + 1, n);
  }
}

/** Rebuild a tree bottom-up: f sees each node after its children were mapped; returns the same node when nothing changed. */
export function mapTree(n: NodeData, f: (n: NodeData) => NodeData, depth = 0): NodeData {
  if (depth > 200) return n;
  let changed = false;
  const kids = n.kids.map(k => {
    const y = isNode(k) ? mapTree(k, f, depth + 1) : k;
    if (y !== k) changed = true;
    return y;
  });
  let props: Record<string, unknown> | null = null;
  for (const [key, v] of Object.entries(n.props)) {
    let y: unknown = v;
    if (isNode(v)) y = mapTree(v, f, depth + 1);
    else if (Array.isArray(v) && v.some(isNode)) {
      const arr = v.map(x => (isNode(x) ? mapTree(x, f, depth + 1) : x));
      if (arr.some((x, i) => x !== v[i])) y = arr;
    } else if (isPlainObject(v) && Object.values(v).some(isNode)) {
      const o: Record<string, unknown> = {};
      let ch = false;
      for (const [kk, x] of Object.entries(v)) {
        o[kk] = isNode(x) ? mapTree(x, f, depth + 1) : x;
        if (o[kk] !== x) ch = true;
      }
      if (ch) y = o;
    }
    if (y !== v) {
      props = props || { ...n.props };
      props[key] = y;
    }
  }
  const base = changed || props ? rebuildNode(n, { ...(changed ? { kids } : {}), ...(props ? { props } : {}) }) : n;
  return f(base);
}

/** Every node of a form under a root. */
export function findAll(root: unknown, form: string | ((n: NodeData) => boolean)): NodeData[] {
  const out: NodeData[] = [];
  const pred = typeof form === 'string' ? (n: NodeData) => n.$ === form : form;
  walk(root, n => {
    if (pred(n)) out.push(n);
  });
  return out;
}

/** props that are plain objects but not nodes (an options bag passed first to ck.row(props?, ...kids)) */
export const isProps = (v: unknown): v is Record<string, unknown> =>
  isObj(v) && !Array.isArray(v) && !isNode(v) && isPlainObject(v) && !(typeof (v as any).nodeType === 'number');
