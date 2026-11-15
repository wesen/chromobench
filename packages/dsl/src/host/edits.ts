// Edits (contract 1.0, design §24, §30–§31): the builders the agent's code calls — layer, group, mask and coll make
// values (plain data with chain methods; the contract's builders make the data, so a layer built here is the layer
// the studio builds), set, insert, remove and move make changes — and frame.propose, which validates a change
// against the frame's draft at once and queues it for the end of the eval (DR-3). No function crosses the sandbox:
// a value is data, and every chain method is a host call that returns new data.
import {
  BLEND_MODES, ChromobenchError, CUT_NAMES, checkParams, diag, documentKind, getOp, group as groupBuilder, GroupValue, hasOp,
  layer as layerBuilder, LayerValue, mask as maskBuilder, MASK_COMBINES, MASK_COMPONENT_KINDS, MaskValue, formatValue,
  type Diagnostic, type Entry, type ErrorCode, type OpDef, type Params,
} from '@chromobench/contract';
import { Coll, insert, isId, move, remove, set, type Mutation } from '@chromobench/values';
import type { Host } from '../host.ts';
import { describeMutation } from '../describe.ts';
import { applyTo, mutationsOf } from './cuts.ts';
import { literal } from './calls.ts';
import type { At, QueuedEdit } from './types.ts';
import { layerOps, suggest } from './words.ts';

const fail = (code: ErrorCode, message: string, extra: Omit<Diagnostic, 'code' | 'message'> = {}): never => {
  throw new ChromobenchError(diag(code, message, extra));
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A marshalled value or plain data → data (values are `{ __value, data }` on the way out of the guest). */
const dataOf = (h: Host, where: string, v: unknown): unknown => literal(h, where, 'value', v);

function layerOp(name: unknown): OpDef {
  if (typeof name !== 'string') return fail('E_ARG_TYPE', 'layer(op, params) takes an op name first', { fix: "layer('burn', { stops: 0.5 })" });
  const ops = layerOps();
  if (!hasOp(name) || !getOp(name).stages?.length) {
    const g = suggest(name, ops.map((o) => o.name));
    const node = hasOp(name) ? ' (a handle op: it is not a layer)' : '';
    return fail('E_UNKNOWN_OP', `no layer op "${name}"${node}`, { ...(g ? { hint: `did you mean ${g}?`, fix: `layer('${g}', …)` } : {}), valid: ops.map((o) => `${o.name} (${o.stages!.join(', ')})`) });
  }
  return getOp(name);
}

function checkLayerParams(h: Host, op: OpDef, params: Params): void {
  const out: Diagnostic[] = [];
  const kind = h.bound ? documentKind(h.state(h.bound).base) : 'negative-scan';
  checkParams(op, params, `layer('${op.name}')`, { kind, stage: op.stages![0]!, use: 'binding' }, out);
  const d = out[0];
  if (!d) return;
  if (d.code === 'E_UNKNOWN_OPTION' && d.path) {
    const k = d.path.split('.').pop()!;
    const g = suggest(k, Object.keys(op.args));
    if (g) d.fix = `layer('${op.name}', ${formatValue(Object.fromEntries(Object.entries(params).map(([a, b]) => [a === k ? g : a, b])))})`;
  }
  throw new ChromobenchError(d);
}

const agentSource = (h: Host): { kind: string; eval: string } => ({ kind: 'agent', eval: h.evalId });

/** The constructors: layer, group, mask, coll and the four mutations. Returns the new value's data. */
export function build(h: Host, a: Record<string, unknown>): unknown {
  const what = String(a['what']);
  const word = what === 'set' || what === 'insert' || what === 'remove' || what === 'move' ? 'changes' : what;
  h.vocabulary[word] = (h.vocabulary[word] ?? 0) + 1;
  switch (what) {
    case 'layer': {
      const op = layerOp(a['op']);
      const params = (a['params'] === undefined ? {} : literal(h, `layer('${op.name}')`, 'params', a['params'])) as Params;
      if (!isObj(params)) fail('E_ARG_TYPE', `layer('${op.name}', params): params is an object of ${op.name}'s arguments`, { valid: Object.keys(op.args) });
      checkLayerParams(h, op, params);
      return layerBuilder(op.name, params, { source: agentSource(h) }).data;
    }
    case 'group': {
      const name = a['name'];
      if (typeof name !== 'string') fail('E_ARG_TYPE', 'group(name, entries) takes a name first', { fix: "group('Sky', { b1: layer('burn', { stops: 0.5 }) })" });
      const entries = a['entries'] === undefined ? {} : a['entries'];
      if (!isObj(entries)) fail('E_ARG_TYPE', 'group(name, entries): entries is an object of id → layer or group', { fix: `group('${String(name)}', { b1: layer('burn', { stops: 0.5 }) })` });
      const pairs = Object.entries(entries as Record<string, unknown>).map(([id, e]): [string, Entry] => {
        if (!isId(id) || /^\d+$/.test(id)) fail('E_ARG_TYPE', `group: "${id}" is not an entry id (letters, digits, _ and -, not only digits)`, { fix: `group('${String(name)}', { L1: … })` });
        const d = dataOf(h, 'group', e);
        if (!isObj(d) || !['layer', 'group', 'link'].includes(String(d['kind']))) fail('E_ARG_TYPE', `group: entry ${id} is not a layer or a group`, { fix: `{ ${id}: layer('burn', { stops: 0.5 }) }` });
        return [id, d as unknown as Entry];
      });
      const g = groupBuilder(name as string, ...pairs);
      return g.with({ source: agentSource(h) }).data;
    }
    case 'mask': {
      const name = a['name'];
      if (typeof name !== 'string') fail('E_ARG_TYPE', 'mask(name) takes a name', { fix: "mask('sky').add('c1', 'linear', { from: [48, 0], to: [48, 40] })" });
      return maskBuilder(name as string).data;
    }
    case 'coll': {
      const items = a['items'];
      if (!isObj(items)) fail('E_ARG_TYPE', 'coll(items) takes an object of id → item (its keys give the order)', { fix: "coll({ s1: { … }, s2: { … } })" });
      const pairs = Object.entries(items as Record<string, unknown>).map(([id, x]): [string, unknown] => {
        if (!isId(id) || /^\d+$/.test(id)) fail('E_ARG_TYPE', `coll: "${id}" is not an item id (letters, digits, _ and -, not only digits)`, { fix: 'coll({ s1: … })' });
        return [id, dataOf(h, 'coll', x)];
      });
      return Coll.of(pairs);
    }
    case 'set': {
      if (typeof a['path'] !== 'string') fail('E_ARG_TYPE', 'set(path, value) takes a document path', { fix: "set('main.params.time_s', 12)" });
      if (a['value'] === undefined) fail('E_ARG_TYPE', `set('${String(a['path'])}', value) needs a value`, { fix: `set('${String(a['path'])}', …)` });
      return { mutations: [set(a['path'] as string, dataOf(h, 'set', a['value']))] };
    }
    case 'insert': {
      const [coll, id] = [a['coll'], a['id']];
      if (typeof coll !== 'string' || typeof id !== 'string') fail('E_ARG_TYPE', 'insert(coll, id, item, at?) takes a collection path and an id', { fix: "insert('stages.darkroom.stack', 'b1', layer('burn', { stops: 0.5 }))" });
      if (a['item'] === undefined) fail('E_ARG_TYPE', `insert('${String(coll)}', '${String(id)}', item) needs the item`);
      const pos = a['pos'];
      if (pos !== undefined && !(typeof pos === 'number' && Number.isInteger(pos) && pos >= 0)) fail('E_ARG_TYPE', 'insert(coll, id, item, at): at is a position (0 = first)');
      return { mutations: [insert(coll as string, id as string, dataOf(h, 'insert', a['item']), pos as number | undefined)] };
    }
    case 'remove': {
      if (typeof a['id'] !== 'string') fail('E_ARG_TYPE', 'remove(id) takes the id of an item (an entry, a mask, a spot…)', { fix: "remove('b1')" });
      return { mutations: [remove(a['id'] as string)] };
    }
    case 'move': {
      if (typeof a['id'] !== 'string') fail('E_ARG_TYPE', 'move(id, { into, at }) takes the id of an item', { fix: "move('b1', { into: 'g1.stack', at: 0 })" });
      const to = (a['to'] ?? {}) as Record<string, unknown>;
      if (!isObj(to) || Object.keys(to).some((k) => k !== 'into' && k !== 'at')) fail('E_ARG_TYPE', 'move(id, { into, at }): into is a collection path, at a position', { fix: `move('${String(a['id'])}', { at: 0 })` });
      return { mutations: [move(a['id'] as string, { ...(to['into'] !== undefined ? { into: String(to['into']) } : {}), ...(to['at'] !== undefined ? { at: Number(to['at']) } : {}) })] };
    }
    default:
      return fail('E_INTERNAL', `unknown builder ${what}`);
  }
}

const ENTRY_METHODS = ['amount', 'mask', 'blend', 'name', 'enabled'];
const METHODS: Record<string, string[]> = { layer: [...ENTRY_METHODS, 'params'], group: ENTRY_METHODS, mask: ['add', 'feather', 'invert', 'reads', 'name'] };

function checkEntryArg(method: string, x: unknown): void {
  const ok = method === 'amount' ? typeof x === 'number' && Number.isFinite(x) && x >= 0
    : method === 'mask' ? x === null || (typeof x === 'string' && isId(x))
      : method === 'blend' ? x === 'pass' || (BLEND_MODES as readonly unknown[]).includes(x)
        : method === 'name' ? typeof x === 'string'
          : method === 'enabled' ? typeof x === 'boolean' : true;
  if (ok) return;
  const want: Record<string, string> = { amount: 'a number ≥ 0 (the stage law gives its range)', mask: 'a mask id or null', blend: `'pass' or ${BLEND_MODES.join(', ')}`, name: 'a string', enabled: 'true or false' };
  fail('E_ARG_TYPE', `.${method}(${formatValue(x)}): ${method} is ${want[method] ?? 'something else'}`);
}

/** A chain method of a value (`layer(…).amount(0.5)`): the contract's modifier on the value's data. */
export function valueMethod(h: Host, a: Record<string, unknown>): unknown {
  const kind = String(a['kind']);
  const method = String(a['method']);
  const args = ((a['args'] ?? []) as unknown[]).map((x) => literal(h, `.${method}`, 'argument', x));
  const ms = METHODS[kind] ?? [];
  if (!ms.includes(method)) {
    const g = suggest(method, ms);
    fail('E_UNKNOWN_METHOD', `a ${kind} has no method "${method}"`, { ...(g ? { hint: `Did you mean "${g}"?` } : {}), valid: ms });
  }
  const data = a['data'] as never;
  if (kind === 'layer') {
    if (method === 'params') {
      if (!isObj(args[0])) fail('E_ARG_TYPE', '.params(p) takes an object of the op\'s arguments');
      const next = LayerValue(data).params(args[0] as Params).data as unknown as { op: string; params: Params };
      checkLayerParams(h, getOp(next.op), next.params);
      return next;
    }
    checkEntryArg(method, args[0]);
    return (LayerValue(data) as unknown as Record<string, (x: unknown) => { data: unknown }>)[method]!(args[0]).data;
  }
  if (kind === 'group') {
    checkEntryArg(method, args[0]);
    return (GroupValue(data) as unknown as Record<string, (x: unknown) => { data: unknown }>)[method]!(args[0]).data;
  }
  // mask
  const m = MaskValue(data);
  switch (method) {
    case 'add': {
      const [id, ck, params, combine = 'add', amount = 1] = args as [unknown, unknown, unknown, unknown, unknown];
      if (typeof id !== 'string' || !isId(id)) fail('E_ARG_TYPE', '.add(id, kind, params, combine?, amount?) takes a component id first', { fix: ".add('c1', 'linear', { from: [48, 0], to: [48, 40] })" });
      if (!(MASK_COMPONENT_KINDS as readonly unknown[]).includes(ck)) {
        const g = typeof ck === 'string' ? suggest(ck, MASK_COMPONENT_KINDS) : undefined;
        fail('E_ARG_TYPE', `.add: no mask component "${String(ck)}"`, { ...(g ? { hint: `did you mean ${g}?` } : {}), valid: [...MASK_COMPONENT_KINDS] });
      }
      if (!(MASK_COMBINES as readonly unknown[]).includes(combine)) fail('E_ARG_TYPE', `.add: combine is ${MASK_COMBINES.join(', ')}`, { valid: [...MASK_COMBINES] });
      if (typeof amount !== 'number' || !(amount >= 0 && amount <= 1)) fail('E_ARG_RANGE', '.add: amount is in [0, 1]');
      const p = (params ?? {}) as Params;
      const op = getOp(`mask.${String(ck)}`);
      const out: Diagnostic[] = [];
      checkParams(op, p, `mask component ${String(id)}`, { kind: 'negative-scan', use: 'binding' }, out);
      if (out[0]) throw new ChromobenchError(out[0]);
      return m.add(id as string, ck as never, p, combine as never, amount as number).data;
    }
    case 'feather': {
      const mm = args[0];
      if (typeof mm !== 'number' || !(mm >= 0)) fail('E_ARG_TYPE', '.feather(mm): the feather radius in mm on the print (≥ 0)');
      return m.feather(mm as number).data;
    }
    case 'invert': return m.invert(args[0] === undefined ? true : Boolean(args[0])).data;
    case 'reads': {
      const c = args[0];
      if (c !== 'stage-input' && !(CUT_NAMES as readonly unknown[]).includes(c)) fail('E_ARG_TYPE', `.reads(cut): 'stage-input' or a cut`, { valid: ['stage-input', ...CUT_NAMES] });
      return m.reads(c as never).data;
    }
    default: {
      if (typeof args[0] !== 'string') fail('E_ARG_TYPE', '.name(text) takes a string');
      return m.name(args[0] as string).data;
    }
  }
}

/** Validates mutations against a frame's draft and queues them for the end of the eval (DR-3). */
export function queue(h: Host, frame: string, ms: readonly Mutation[], o: { why?: string; label?: string; look?: string; where: string }, at: At): QueuedEdit {
  const s = h.state(frame);
  const r = applyTo(h, { frame, doc: s.draft, expr: h.frameExpr(frame) }, ms, o.where);
  s.draft = r.doc;
  h.editCounter += 1;
  const q: QueuedEdit = {
    id: `e${h.editCounter}`, frame, mutations: r.mutations, inverses: r.inverses,
    ...(o.why !== undefined ? { why: o.why } : {}), ...(o.label !== undefined ? { label: o.label } : {}), ...(o.look !== undefined ? { look: o.look } : {}),
    ...(at && at.eval === h.evalN ? { line: at.line } : {}),
  };
  h.edits.push(q);
  return q;
}

/** frame.propose(change, { why, label }): validated now, submitted when the eval succeeds. */
export function propose(h: Host, a: Record<string, unknown>): unknown {
  const frame = String(a['frame']);
  const fx = h.frameExpr(frame);
  h.vocabulary['frame.propose'] = (h.vocabulary['frame.propose'] ?? 0) + 1;
  const mode = h.history.mode();
  if (mode === 'read-only') {
    fail('E_READONLY', 'the agent is read-only: frame.propose cannot change anything', { hint: 'describe the change instead; the photographer can switch the mode' });
  }
  const ms = mutationsOf(h, a['change'], `${fx}.propose`);
  const why = typeof a['why'] === 'string' ? (a['why'] as string) : undefined;
  const label = typeof a['label'] === 'string' ? (a['label'] as string) : undefined;
  const q = queue(h, frame, ms, { ...(why !== undefined ? { why } : {}), ...(label !== undefined ? { label } : {}), where: `${fx}.propose` }, a['at'] as At);
  const preview = h.addView({ frame, doc: h.state(frame).draft, expr: `${fx}.with(…)` });
  return {
    id: q.id, status: 'queued', changes: q.mutations.map((m, i) => describeMutation(m, q.inverses[i])), preview,
    note: mode === 'ask' ? 'submitted when this eval ends; ask mode: it waits for the photographer' : 'submitted when this eval ends; auto mode: applied at once (undoable)',
  };
}

