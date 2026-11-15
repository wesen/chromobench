// The net change between two versions of a document, as mutations (design §26: a gesture commits "one transaction
// of the net change"; a store transaction is the net change of what its lambda wrote). `diff(before, after)`
// returns mutations in normal form whose application to `before` gives a document equal to `after`; `diff(d, d)` is
// empty. Items keep their identity: an item whose id is in both versions is moved (never removed and re-inserted)
// when its new collection exists, and its fields are set in place.
//
// The walk descends only where the two versions differ by reference, so the cost follows the size of the change,
// not of the document (copy-on-write versions share every untouched subtree). It runs in three passes over a
// working copy, applying each mutation as it is made (so each is checked, and positions are those of the moment):
//   1. items that changed collection move there, when that collection exists already;
//   2. items that are gone are removed (outermost first);
//   3. top-down over `after`: new items are inserted (without the items they hold that exist already, which then
//      move in), items are reordered (the longest run already in order stays; the others move), object keys are set
//      or deleted, and the rest is set where it differs.
import { Coll, type Id } from './coll.ts';
import { indexOf, resolvePath, type Seg } from './doc.ts';
import { fail, ValueError } from './errors.ts';
import { equal, isPlainObject } from './json.ts';
import { applyMutation, insert, move, remove, set, unset, type Mutation } from './mutations.ts';

/** Where an item sits: the item owning its collection (null: the root) and the physical path from that owner. */
interface Place {
  readonly parent: Id | null;
  readonly rel: readonly Seg[];
}

const samePlace = (a: Place, b: Place): boolean =>
  a.parent === b.parent && a.rel.length === b.rel.length && a.rel.every((s, i) => s === b.rel[i]);
const placePath = (p: Place): string => [...(p.parent === null ? [] : [p.parent]), ...p.rel].join('.');
const isObject = (v: unknown): v is Record<string, unknown> => isPlainObject(v) && !Coll.is(v);

/** Every item under v (v sits at rel below owner), with its place. */
function collectAll(v: unknown, owner: Id | null, rel: readonly Seg[], out: Map<Id, Place>): void {
  if (Coll.is(v)) {
    const place: Place = { parent: owner, rel };
    for (const id of v.order) {
      out.set(id, place);
      collectAll(v.items[id], id, [], out);
    }
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => collectAll(x, owner, [...rel, i], out));
  } else if (isPlainObject(v)) {
    for (const [k, x] of Object.entries(v)) collectAll(x, owner, [...rel, k], out);
  }
}

/** The items in the regions where a and b differ: those of a in `was`, those of b in `now`. */
function changedItems(a: unknown, b: unknown, owner: Id | null, rel: readonly Seg[], was: Map<Id, Place>, now: Map<Id, Place>): void {
  if (a === b) return;
  if (Coll.is(a) && Coll.is(b)) {
    const place: Place = { parent: owner, rel };
    for (const id of a.order) {
      if (!Object.hasOwn(b.items, id)) {
        was.set(id, place);
        collectAll(a.items[id], id, [], was);
      } else changedItems(a.items[id], b.items[id], id, [], was, now);
    }
    for (const id of b.order) {
      if (Object.hasOwn(a.items, id)) continue;
      now.set(id, place);
      collectAll(b.items[id], id, [], now);
    }
  } else if (isObject(a) && isObject(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) changedItems(a[k], b[k], owner, [...rel, k], was, now);
  } else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    a.forEach((x, i) => changedItems(x, b[i], owner, [...rel, i], was, now));
  } else {
    collectAll(a, owner, rel, was);
    collectAll(b, owner, rel, now);
  }
}

/** The positions (indexes into xs) of one longest strictly increasing subsequence. */
function longestIncreasing(xs: readonly number[]): Set<number> {
  const tails: number[] = []; // tails[k]: index in xs of the smallest tail of an increasing run of length k + 1
  const prev: number[] = new Array<number>(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[tails[mid]!]! < xs[i]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const out = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) out.add(i);
  return out;
}

const join = (path: string | null, k: Seg): string => {
  if (typeof k === 'string' && (k === '' || k.includes('.'))) {
    fail('E_PATH', `the key "${k}"${path ? ` in ${path}` : ''} cannot be addressed by a path (it is empty or holds a dot)`);
  }
  return path === null ? String(k) : `${path}.${k}`;
};

/** The mutations (normal form) that turn `before` into `after`. Throws ValueError if `after` is not a document. */
export function diff(before: object, after: object): Mutation[] {
  if (before === after) return [];
  if (!isObject(before) || !isObject(after)) fail('E_DOCUMENT', 'a document is a plain object (not a collection)');
  const out: Mutation[] = [];
  let work: object = before;
  const emit = (m: Mutation): void => {
    const a = applyMutation(work, m);
    work = a.doc;
    out.push(a.mutation);
  };

  // 1–2. items that changed place, and items that are gone
  const was = new Map<Id, Place>();
  const now = new Map<Id, Place>();
  changedItems(before, after, null, [], was, now);
  const gone: Id[] = [];
  for (const [id, place] of was) {
    const to = now.get(id);
    if (!to) gone.push(id);
    else if (!samePlace(place, to)) {
      try {
        emit(move(id, { into: placePath(to) }));
      } catch (e) {
        if (!(e instanceof ValueError)) throw e; // its collection is new: it moves in when pass 3 has made it
      }
    }
  }
  const depth = (id: Id): number => indexOf(work).ancestors(id).length;
  for (const id of gone.filter((x) => indexOf(work).has(x)).sort((x, y) => depth(x) - depth(y))) {
    if (indexOf(work).has(id)) emit(remove(id));
  }

  // 3. top-down over after
  /** v without the items (at any depth) that the working copy holds already: they move in afterwards */
  const without = (v: unknown): unknown => {
    if (Coll.is(v)) {
      const idx = indexOf(work);
      let c: Coll<unknown> = v;
      for (const id of v.order) {
        if (idx.has(id)) c = Coll.remove(c, id);
        else {
          const x = without(v.items[id]);
          if (x !== v.items[id]) c = Coll.replace(c, id, x);
        }
      }
      return c;
    }
    if (Array.isArray(v)) {
      const xs = v.map(without);
      return xs.some((x, i) => x !== v[i]) ? xs : v;
    }
    if (isPlainObject(v)) {
      const e = Object.entries(v).map(([k, x]) => [k, without(x)] as const);
      return e.some(([k, x]) => x !== v[k]) ? Object.fromEntries(e) : v;
    }
    return v;
  };
  const syncColl = (path: string, ac: Coll<unknown>): void => {
    const order = (): readonly Id[] => (resolvePath(work, path).value as Coll<unknown>).order;
    const target = new Map(ac.order.map((id, i) => [id, i]));
    // what is here and stays here; an item that belongs elsewhere moves out when its new collection is synced
    const cur = order().filter((id) => target.has(id));
    const keep = longestIncreasing(cur.map((id) => target.get(id)!));
    const stays = new Set(cur.filter((_, i) => keep.has(i)));
    const at = (i: number, id: Id): number => (i === 0 ? 0 : order().filter((x) => x !== id).indexOf(ac.order[i - 1]!) + 1);
    ac.order.forEach((id, i) => {
      if (stays.has(id)) return;
      if (indexOf(work).has(id)) emit(move(id, { into: path, at: at(i, id) }));
      else emit(insert(path, id, without(ac.items[id]), at(i, id)));
    });
    for (const id of ac.order) sync(id, resolvePath(work, id).value, ac.items[id]);
  };
  /** set a value; the items it holds that exist already move in afterwards */
  const put = (path: string, a: unknown): void => {
    const v = without(a);
    emit(set(path, v));
    if (v !== a) sync(path, resolvePath(work, path).value, a);
  };
  const sync = (path: string | null, w: unknown, a: unknown): void => {
    if (w === a) return;
    if (path !== null && Coll.is(w) && Coll.is(a)) return syncColl(path, a);
    if (isObject(w) && isObject(a)) {
      for (const k of Object.keys(w)) if (!Object.hasOwn(a, k)) emit(unset(join(path, k)));
      for (const [k, v] of Object.entries(a)) {
        if (!Object.hasOwn(w, k)) put(join(path, k), v);
        else sync(join(path, k), w[k], v);
      }
      return;
    }
    if (Array.isArray(w) && Array.isArray(a) && w.length === a.length) {
      a.forEach((v, i) => sync(join(path, i), w[i], v));
      return;
    }
    if (path !== null && !equal(w, a)) put(path, a);
  };
  sync(null, work, after);
  return out;
}
