// Elements as IR (port of CraftKit ui/node.js, headless half). ck.ui.slider(…), ck.panel(…), ck.row(…) do not touch
// the DOM: they return nodes { $: form, props, kids, at } — the structure, recorded with the call site that made
// it. The build walks the tree (checking bindings, options and binding times); a renderer mounts it later.
//
// New in the port: nodes are chainable. Each node is a Proxy over its plain record that answers
//   .prop(key, v) · .slot(key, ...items) · .with(props) · .tip(v) · .disabled(v, why) · .<slot>(v)
// with a *new* node (copy-on-write, so nodes can be reused). Any other method is recorded as a pending call
// { name, args, at } and resolved by the `normalize` pass once every kit is installed, so a fragment method works
// whether its kit was installed before or after the line that calls it.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { isObj, isPlainObject } from '../core/util.ts';
import type { CallSite, Diag } from '../core/diag.ts';
import type { SlotTable } from './slots.ts';

export const NODE = Symbol.for('ck.node');
const REBUILD = Symbol.for('ck.node.rebuild');
const HOST = Symbol.for('ck.node.host');

export interface PendingCall {
  name: string;
  args: unknown[];
  at: CallSite | null;
}

/** The plain IR record. */
export interface NodeData<F extends string = string> {
  readonly $: F;
  readonly props: Readonly<Record<string, any>>;
  readonly kids: readonly NodeData[];
  readonly at: CallSite | null;
  readonly diags: readonly Diag[];
  readonly calls: readonly PendingCall[];
}

/** What the node proxy needs from the Ck instance that made it. */
export interface NodeHost {
  /** the slots a form is known to take (form + common), or null when the form is not known yet */
  slotsOf(form: string): SlotTable | null;
  site(): CallSite | null;
}

export interface NodePatch {
  props?: Record<string, unknown>;
  kids?: readonly NodeData[];
  calls?: readonly PendingCall[];
  diags?: readonly Diag[];
}

/** Data fields and probes that are never fragment methods. */
const DATA = new Set(['$', 'props', 'kids', 'at', 'diags', 'calls']);
const PROBES = new Set([
  'then',
  'catch',
  'finally',
  'toJSON',
  'toString',
  'valueOf',
  'constructor',
  'asymmetricMatch',
  'nodeType',
  'tagName',
  'inspect',
  'length',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
]);
const isMethodName = (k: string): boolean => /^[a-zA-Z][A-Za-z0-9_]*$/.test(k) && !PROBES.has(k) && !DATA.has(k);

export const isNode = (v: unknown): v is NodeData => !!(v && typeof v === 'object' && (v as any)[NODE]);

export function flatKids(kids: unknown): NodeData[] {
  const out: any[] = [];
  for (const k of ([] as unknown[]).concat(kids as any)) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) out.push(...flatKids(k));
    else out.push(k);
  }
  return out;
}

/** Make a node: a Proxy over its record, answering the chain methods and recording fragment calls. */
export function makeNode(host: NodeHost | null, form: string, props: Record<string, unknown>, kids: unknown, at: CallSite | null, calls: readonly PendingCall[] = [], diags: readonly Diag[] = []): any {
  const data: any = { $: form, props: props || {}, kids: flatKids(kids), at, diags, calls };
  Object.defineProperty(data, NODE, { value: true });
  const rebuild = (patch: NodePatch): any =>
    makeNode(host, form, patch.props ?? data.props, patch.kids ?? data.kids, at, patch.calls ?? data.calls, patch.diags ?? data.diags);
  const set = (key: string, value: unknown): any => rebuild({ props: { ...data.props, [key]: value } });
  const chain: Record<string, (...a: any[]) => any> = {
    prop: (key: string, value: unknown) => set(key, value),
    slot: (key: string, ...items: unknown[]) => {
      const cur = data.props[key];
      return set(key, (cur == null ? [] : Array.isArray(cur) ? cur : [cur]).concat(items));
    },
    with: (p: Record<string, unknown>) => rebuild({ props: { ...data.props, ...(p || {}) } }),
    tip: (v: unknown) => set('tip', v),
    disabled: (v: unknown, why?: unknown) => (why === undefined ? set('disabled', v) : rebuild({ props: { ...data.props, disabled: v, why } })),
    hidden: (v: unknown) => set('hidden', v),
  };
  return new Proxy(data, {
    get(t, k, r) {
      if (k === REBUILD) return rebuild;
      if (k === HOST) return host;
      if (typeof k === 'symbol') return Reflect.get(t, k, r);
      if (DATA.has(k)) return t[k];
      if (Object.prototype.hasOwnProperty.call(chain, k)) return chain[k];
      if (!isMethodName(k)) return Reflect.get(t, k, r);
      const slots = host?.slotsOf(form);
      if (slots && Object.prototype.hasOwnProperty.call(slots, k)) return (v: unknown) => set(k, v);
      // not known yet: a fragment method, resolved by the normalize pass
      return (...args: unknown[]) => rebuild({ calls: [...data.calls, { name: k, args, at: host ? host.site() : null }] });
    },
    set() {
      throw new TypeError('Nodes are immutable: use .with({ … }) or .prop(key, value), which return a new node');
    },
  });
}

/** A copy of a node with some fields replaced (keeps the proxy and its host). */
export function rebuildNode<N extends NodeData>(n: N, patch: NodePatch): N {
  const f = (n as any)[REBUILD];
  if (typeof f === 'function') return f(patch);
  return makeNode(null, n.$, patch.props ?? n.props, patch.kids ?? n.kids, n.at, patch.calls ?? n.calls, patch.diags ?? n.diags);
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
