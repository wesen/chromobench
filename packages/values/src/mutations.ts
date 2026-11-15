// The four mutations (design §24): set, insert, remove, move. applyMutation returns the new document version and
// the exact inverse: applying the inverse to the new version gives back the old one (equal, and canonically
// identical; a key deleted and restored by `set` moves to the end of its object, which JSON equality ignores).
// Every mutation is checked structurally here (paths, ids, positions, cycles, JSON values); the meaning of the
// document is checked by a validation hook the caller supplies (the contract's laws, ArgSpecs and stage rules).
import { Coll, isId, type Id } from './coll.ts';
import { type DocIndex, indexOf, internal, resolvePath, getPhys, type Loc, type Resolved, type Seg } from './doc.ts';
import { fail } from './errors.ts';
import { assertJson, deepFreeze } from './json.ts';
import { dataOf } from './value.ts';

export type Mutation =
  /** set a field; without `value`, delete the key (only object keys; items are removed with `remove`) */
  | { readonly op: 'set'; readonly path: string; readonly value?: unknown }
  /** add an item to a collection, at a position (default: the end) */
  | { readonly op: 'insert'; readonly coll: string; readonly id: Id; readonly item: unknown; readonly at?: number }
  /** delete an item, wherever it is */
  | { readonly op: 'remove'; readonly id: Id }
  /** reorder an item (no `into`), or move it into another collection; `at` defaults to the end */
  | { readonly op: 'move'; readonly id: Id; readonly into?: string; readonly at?: number };

export const MUTATION_OPS = ['set', 'insert', 'remove', 'move'] as const;

/** set(path, value). A Value is stored as its data. */
export function set(path: string, value: unknown): Mutation {
  return Object.freeze({ op: 'set' as const, path, value: dataOf(value) });
}
/** set without a value: delete an object key. */
export function unset(path: string): Mutation {
  return Object.freeze({ op: 'set' as const, path });
}
export function insert(coll: string, id: Id, item: unknown, at?: number): Mutation {
  return Object.freeze({ op: 'insert' as const, coll, id, item: dataOf(item), ...(at === undefined ? {} : { at }) });
}
export function remove(id: Id): Mutation {
  return Object.freeze({ op: 'remove' as const, id });
}
export function move(id: Id, to: { into?: string; at?: number } = {}): Mutation {
  return Object.freeze({ op: 'move' as const, id, ...(to.into === undefined ? {} : { into: to.into }), ...(to.at === undefined ? {} : { at: to.at }) });
}

/** What the validation hook sees: one mutation, applied. */
export interface Change<D extends object = object> {
  readonly before: D;
  readonly after: D;
  /** the mutation in normal form: canonical paths, explicit positions, `into` always given for move */
  readonly mutation: Mutation;
  readonly inverse: Mutation;
  /** the index of `after` */
  readonly index: DocIndex;
}

/** Check a change; throw to refuse it, return warnings to accept it with remarks. */
export type Validator<W = unknown, D extends object = object> = (c: Change<D>) => readonly W[] | void;

export interface ApplyOptions<W = unknown, D extends object = object> {
  validate?: Validator<W, D>;
}

export interface Applied<D extends object, W = unknown> {
  readonly doc: D;
  /** the mutation in normal form */
  readonly mutation: Mutation;
  readonly inverse: Mutation;
  readonly warnings: readonly W[];
}

interface Step {
  doc: object;
  mutation: Mutation;
  inverse: Mutation;
  locs: ReadonlyMap<Id, Loc>;
}

/** Apply one mutation. Throws ValueError (E_PATH, E_MUTATION, E_ARG_TYPE, E_ARG_RANGE) or whatever the hook throws. */
export function applyMutation<D extends object, W = unknown>(doc: D, m: Mutation, opts: ApplyOptions<W, D> = {}): Applied<D, W> {
  const idx = indexOf(doc);
  let step: Step;
  switch (m?.op) {
    case 'set': step = applySet(doc, idx, m); break;
    case 'insert': step = applyInsert(doc, idx, m); break;
    case 'remove': step = applyRemove(doc, idx, m); break;
    case 'move': step = applyMove(doc, idx, m); break;
    default:
      return fail('E_MUTATION', `unknown mutation op "${String((m as { op?: unknown })?.op)}"`, { valid: [...MUTATION_OPS] });
  }
  const index = internal.remember(step.doc, step.locs);
  const after = step.doc as D;
  const warnings = opts.validate?.({ before: doc, after, mutation: step.mutation, inverse: step.inverse, index }) ?? [];
  return { doc: after, mutation: step.mutation, inverse: step.inverse, warnings };
}

function frozenJson(v: unknown, at: string): unknown {
  const d = dataOf(v);
  assertJson(d, at);
  return deepFreeze<unknown>(d);
}

/** The ids under a subtree, registered at (owner, rel) into a copy of locs; refused when one is taken. */
function addIds(locs: Map<Id, Loc>, doc: object, v: unknown, owner: Id | null, rel: readonly Seg[]): void {
  internal.collect(v, owner, rel, (id, loc) => {
    if (!isId(id)) fail('E_MUTATION', `"${id}" is not an id (letters, digits, _ and -)`);
    internal.add(locs, doc, id, loc, 'E_MUTATION');
  }, '');
}

function applySet(doc: object, idx: DocIndex, m: Extract<Mutation, { op: 'set' }>): Step {
  const r = resolvePath(doc, m.path, idx);
  const deleting = !Object.hasOwn(m, 'value') || m.value === undefined;
  if (deleting && r.holder !== 'object') {
    fail('E_PATH', `${m.path}: only an object key can be deleted${r.holder === 'coll' ? ' (remove the item instead)' : ''}`, { path: m.path });
  }
  const value = deleting ? undefined : frozenJson(m.value, m.path);
  const old = r.exists ? r.value : undefined;
  const next = internal.updateIn(doc, r.phys, 0, () => value) as object;
  // the target is an item itself (holder coll): its nested ids sit under it; otherwise under the owner at rel
  const [owner, rel] = r.holder === 'coll' ? [r.owner, []] : [r.owner, r.rel];
  const gone = internal.idsUnder(old, owner, rel);
  let locs = idx.locs();
  const touchesColls = gone.length > 0 || internal.idsUnder(value, owner, rel).length > 0;
  if (touchesColls) {
    const copy = new Map(locs);
    for (const id of gone) copy.delete(id);
    addIds(copy, next, value, owner, rel);
    locs = copy;
  }
  const mutation: Mutation = deleting ? { op: 'set', path: r.canonical } : { op: 'set', path: r.canonical, value };
  const inverse: Mutation = r.exists ? { op: 'set', path: r.canonical, value: old } : { op: 'set', path: r.canonical };
  return { doc: next, mutation: Object.freeze(mutation), inverse: Object.freeze(inverse), locs };
}

function collAt(doc: object, path: string, idx: DocIndex): Resolved {
  const r = resolvePath(doc, path, idx);
  if (!r.exists || !Coll.is(r.value)) fail('E_PATH', `${path} is not a collection`, { path });
  return r;
}

/** The (owner, rel) location of a collection's items: an item that is itself a collection owns its items. */
const ownerOf = (r: Resolved): [Id | null, readonly Seg[]] => (r.holder === 'coll' ? [r.owner, []] : [r.owner, r.rel]);

function applyInsert(doc: object, idx: DocIndex, m: Extract<Mutation, { op: 'insert' }>): Step {
  if (!isId(m.id)) fail('E_MUTATION', `insert: "${String(m.id)}" is not an id (letters, digits, _ and -)`);
  if (idx.has(m.id)) fail('E_MUTATION', `insert: id "${m.id}" is already used (at ${idx.locate(m.id)!.coll})`);
  const r = collAt(doc, m.coll, idx);
  const c = r.value as Coll<unknown>;
  const at = m.at ?? c.order.length;
  const item = frozenJson(m.item, `${m.coll}.${m.id}`);
  const next = internal.updateIn(doc, r.phys, 0, (x) => Coll.insert(x as Coll<unknown>, m.id, item, at)) as object;
  const [owner, rel] = ownerOf(r);
  const locs = new Map(idx.locs());
  internal.add(locs, next, m.id, { parent: owner, rel: Object.freeze(rel.slice()) }, 'E_MUTATION');
  addIds(locs, next, item, m.id, []);
  return {
    doc: next,
    mutation: Object.freeze({ op: 'insert', coll: r.canonical, id: m.id, item, at }),
    inverse: Object.freeze({ op: 'remove', id: m.id }),
    locs,
  };
}

function applyRemove(doc: object, idx: DocIndex, m: Extract<Mutation, { op: 'remove' }>): Step {
  const loc = idx.locate(m.id);
  if (!loc) fail('E_MUTATION', `remove: no item "${m.id}"`);
  const collPhys = loc.path.slice(0, -2);
  const item = (getPhys(doc, collPhys) as Coll<unknown>).items[m.id];
  const next = internal.updateIn(doc, collPhys, 0, (x) => Coll.remove(x as Coll<unknown>, m.id)) as object;
  const locs = new Map(idx.locs());
  locs.delete(m.id);
  for (const id of internal.idsUnder(item, m.id, [])) locs.delete(id);
  return {
    doc: next,
    mutation: Object.freeze({ op: 'remove', id: m.id }),
    inverse: Object.freeze({ op: 'insert', coll: loc.coll, id: m.id, item, at: loc.at }),
    locs,
  };
}

function applyMove(doc: object, idx: DocIndex, m: Extract<Mutation, { op: 'move' }>): Step {
  const loc = idx.locate(m.id);
  if (!loc) fail('E_MUTATION', `move: no item "${m.id}"`);
  const srcPhys = loc.path.slice(0, -2);
  const r = collAt(doc, m.into ?? loc.coll, idx);
  const [owner, rel] = ownerOf(r);
  if (owner === m.id || (owner !== null && idx.ancestors(owner).includes(m.id))) {
    fail('E_MUTATION', `move: ${r.canonical} is inside "${m.id}"; an item cannot move into itself`);
  }
  const same = samePath(r.phys, srcPhys);
  const target = r.value as Coll<unknown>;
  let next: object;
  let at: number;
  let locs = idx.locs();
  if (same) {
    at = m.at ?? target.order.length - 1;
    next = internal.updateIn(doc, srcPhys, 0, (x) => Coll.move(x as Coll<unknown>, m.id, at)) as object;
  } else {
    at = m.at ?? target.order.length;
    const item = (getPhys(doc, srcPhys) as Coll<unknown>).items[m.id];
    // the target's physical path stays valid after the removal: collections are keyed by id, never by position
    const without = internal.updateIn(doc, srcPhys, 0, (x) => Coll.remove(x as Coll<unknown>, m.id));
    next = internal.updateIn(without, r.phys, 0, (x) => Coll.insert(x as Coll<unknown>, m.id, item, at)) as object;
    const copy = new Map(locs);
    copy.set(m.id, { parent: owner, rel: Object.freeze(rel.slice()) });
    locs = copy;
  }
  return {
    doc: next,
    mutation: Object.freeze({ op: 'move', id: m.id, into: r.canonical, at }),
    inverse: Object.freeze({ op: 'move', id: m.id, into: loc.coll, at: loc.at }),
    locs,
  };
}

const samePath = (a: readonly Seg[], b: readonly Seg[]): boolean => a.length === b.length && a.every((s, i) => s === b[i]);
