// Frame views and cuts (contract 1.0, design §29): a view is a document the eval reads (a frame at the start of the
// eval, a what-if `frame.with(change)`, a receipt's preview); its cut handles are the nodes the one compiler names
// in the session's graph (`frame.print()` is compile(doc).cuts.print, hash-consed, so the viewer, the export and
// the agent name the same node). Every what-if is compile(edit(doc, change).doc): there is no second copy of the
// pipeline in the DSL.
import {
  ChromobenchError, compile, cutDef, cutNode, CUT_NAMES, diag, edit, formatValue, getOp, storedMutations, toDiagnostic,
  type Compiled, type Document, type Node,
} from '@chromobench/contract';
import { freshId, getPath, type Mutation } from '@chromobench/values';
import type { Host } from '../host.ts';
import { cutExpr, rewrite, unmarshal } from './calls.ts';
import type { At, HandleInfo, View } from './types.ts';
import { suggest } from './words.ts';

/** The one-word cuts that are frame methods (`frame.print()`); every cut is `frame.cut(name)`. */
export const CUT_METHODS = CUT_NAMES.filter((c) => /^\w+$/.test(c));

/** compile(doc) into the session's graph, once per document version; its warnings go to the eval that compiled it. */
export function compiled(h: Host, doc: Document, at: At): Compiled {
  const cache = h.compiledDocs();
  let c = cache.get(doc);
  if (c) return c;
  // links resolve first: the contract's looks, the host's rolls and presets (CHB-037 P7)
  c = compile(doc, h.graph, { links: h.links() });
  for (const w of c.warnings) h.warnings.push(at && at.eval === h.evalN ? { ...w, where: { line: at.line } } : w);
  for (const n of h.graph.closure(c.display.id)) h.ops[n.op] = (h.ops[n.op] ?? 0) + 1;
  cache.set(doc, c);
  return c;
}

/** Node ids in closure order (same order as Graph.closure). */
export function closureIds(h: Host, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (nid: string): void => {
    if (seen.has(nid)) return;
    seen.add(nid);
    for (const i of h.node(nid).inputs) visit(i);
    out.push(nid);
  };
  visit(id);
  return out;
}

/** The node of a named cut of a document. */
export function cutOf(h: Host, doc: Document, name: string, at: At): Node {
  return cutNode(compiled(h, doc, at), name);
}

// Where the settings of today's print options live in a new document (only for the fix of a refused option).
const OPTION_PATHS: Readonly<Record<string, string>> = {
  time_s: 'main.params.time_s', fstop: 'main.params.fstop', filtration: 'main.params.filtration', lights: 'lights.params.logH',
  grade: 'stages.darkroom.medium.grade', paper: 'stages.darkroom.medium.paper', illuminant: 'stages.print.medium.illuminant', flare: 'stages.print.medium.flare',
};

/** `view.print()`, `view.cut('darkroom.H')`: a cut handle. Cuts take no options: a what-if is `view.with(change)`. */
export function cut(h: Host, key: string, name: string, raw: unknown, at: At): HandleInfo {
  const v = h.view(key);
  const named = /^\w+$/.test(name) ? `${name}()` : `cut('${name}')`;
  h.vocabulary['frame.cut'] = (h.vocabulary['frame.cut'] ?? 0) + 1;
  if (raw && typeof raw === 'object' && Object.keys(raw).length) {
    const opts = raw as Record<string, unknown>;
    const sets = Object.entries(opts).filter(([k]) => OPTION_PATHS[k] && getPath(v.doc, OPTION_PATHS[k]!) !== undefined).map(([k, x]) => `set('${OPTION_PATHS[k]}', ${formatValue(x)})`);
    throw new ChromobenchError(diag('E_ARG_TYPE', `${v.expr}.${named} takes no options: a cut is a point of the compiled document`, {
      hint: 'a what-if is the document with a change: view.with(change), then its cut',
      ...(sets.length === Object.keys(opts).length ? { fix: `${v.expr}.with(${sets.length > 1 ? `[${sets.join(', ')}]` : sets[0]}).${named}` } : {}),
    }));
  }
  if (!cutDef(name)) {
    const g = suggest(name, CUT_NAMES);
    throw new ChromobenchError(diag('E_CUT', `no cut "${name}"`, { ...(g ? { hint: `did you mean ${g}?`, fix: cutExpr(v.expr, g) } : {}), valid: [...CUT_NAMES] }));
  }
  const n = cutOf(h, v.doc, name, at);
  return h.info(n, v.frame, cutExpr(v.expr, name));
}

/** The mutations of a marshalled change: a mutation value (`set(…)`) or an array of them, in order. */
export function mutationsOf(h: Host, raw: unknown, where: string): Mutation[] {
  if (Array.isArray(raw)) {
    if (!raw.length) throw new ChromobenchError(diag('E_ARG_TYPE', `${where} got an empty list of changes`, { fix: `${where}(set('main.params.time_s', 12))` }));
    return raw.flatMap((x) => mutationsOf(h, x, where));
  }
  const r = raw as { __value?: string; data?: { mutations?: unknown } } | null;
  if (r && r.__value === 'change' && Array.isArray(r.data?.mutations)) return r.data.mutations as Mutation[];
  const kind = r?.__value;
  if (kind === 'layer' || kind === 'group') {
    throw new ChromobenchError(diag('E_ARG_TYPE', `${where} takes a change; a ${kind} goes into a stack with insert`, {
      hint: 'a change is set, insert, remove or move, or an array of them', fix: `insert('stages.darkroom.stack', 'L1', ${kind}(…))`,
    }));
  }
  if (kind === 'mask') throw new ChromobenchError(diag('E_ARG_TYPE', `${where} takes a change; a mask goes into the library with insert`, { fix: "insert('masks', 'sky', mask(…))" }));
  throw new ChromobenchError(diag('E_ARG_TYPE', `${where} takes a change: set(path, value), insert(coll, id, item), remove(id) or move(id, { into, at })`, {
    hint: 'several changes are an array: [set(a, 1), remove(b)]', fix: `${where}(set('main.params.time_s', 12))`,
  }));
}

/** Applies mutations to a view's document under the contract's rules; errors re-targeted at the agent's call. */
export function applyTo(h: Host, v: View, ms: readonly Mutation[], where: string): { doc: Document; mutations: Mutation[]; inverses: Mutation[] } {
  try {
    // a medium field of a frame on a roll is the frame's override of the roll
    const r = edit(v.doc, storedMutations(v.doc, ms));
    return { doc: r.doc, mutations: [...r.tx.mutations], inverses: [...r.tx.inverses] };
  } catch (e) {
    throw editError(h, v, e, ms, where);
  }
}

/** A did-you-mean for the document rules' errors: a misspelt path or option, an id that is taken. */
function editError(h: Host, v: View, e: unknown, ms: readonly Mutation[], where: string): unknown {
  const base = toDiagnostic(e);
  const d = { ...base };
  const m = ms.find((x) => (x.op === 'set' && d.path?.startsWith(x.path.split('.')[0]!)) || ('id' in x && d.message.includes(`"${x.id}"`))) ?? ms[0];
  if (d.code === 'E_PATH' && d.path && d.valid?.length && m?.op === 'set') {
    const segs = d.path.split('.');
    const bad = /no "([^"]+)"/.exec(d.message)?.[1];
    const i = bad ? segs.indexOf(bad) : -1;
    const g = bad ? suggest(bad, d.valid) : undefined;
    if (i >= 0 && g) {
      segs[i] = g;
      d.hint = `did you mean ${g}?`;
      d.fix = `${where}(set('${segs.join('.')}', ${formatValue(m.value)}))`;
    }
  } else if (d.code === 'E_UNKNOWN_OPTION' && d.path && m?.op === 'set' && suggest(d.path.split('.').pop()!, d.valid ?? [])) {
    const segs = d.path.split('.');
    const g = suggest(segs.at(-1)!, d.valid!)!;
    segs[segs.length - 1] = g;
    d.hint ??= `did you mean ${g}?`;
    d.fix = `${where}(set('${segs.join('.')}', ${formatValue(m.value)}))`;
  } else if (d.code === 'E_MUTATION' && /is already used/.test(d.message) && m && m.op === 'insert') {
    const id = freshId(v.doc, m.id.replace(/\d+$/, '') || 'e');
    d.hint = `ids are unique in the whole document; ${id} is free`;
    d.fix = `insert('${m.coll}', '${id}', …)`;
  } else if (d.code === 'E_ARG_RANGE' && d.fix && m?.op === 'set' && d.path === m.path) {
    d.fix = `${where}(set('${m.path}', ${d.fix}))`;
  }
  void h;
  return new ChromobenchError(d);
}

/** `view.with(change)`: a what-if view of the document with the change applied. */
export function withChange(h: Host, key: string, raw: unknown, at: At): { key: string; expr: string } {
  const v = h.view(key);
  h.vocabulary['frame.with'] = (h.vocabulary['frame.with'] ?? 0) + 1;
  const ms = mutationsOf(h, raw, `${v.expr}.with`);
  const r = applyTo(h, v, ms, `${v.expr}.with`);
  compiled(h, r.doc, at); // compile now: an unresolvable document fails at the line of the what-if
  return h.addView({ frame: v.frame, doc: r.doc, expr: `${v.expr}.with(…)` });
}

/** cb.testStrip(frame, opts) / cb.ringAround(frame, opts): darkroom ops on the frame's negative. */
export function strip(h: Host, name: 'testStrip' | 'ringAround', frame: string, raw: unknown, at: At): HandleInfo {
  h.vocabulary[`cb.${name}`] = (h.vocabulary[`cb.${name}`] ?? 0) + 1;
  const v = h.view(`@${frame}`);
  const op = getOp(`darkroom.${name}`);
  const neg = h.info(cutOf(h, v.doc, 'negative', at), frame, `${v.expr}.negative()`);
  const args = unmarshal(h, op, raw, neg.expr);
  try {
    return h.info(h.intern(op.name, [neg.id], args, at), frame, `cb.${name}(${v.expr}${Object.keys(args).length ? `, ${formatValue(args)}` : ''})`);
  } catch (e) {
    throw rewrite(h, e, op, neg, raw as Record<string, unknown>);
  }
}
