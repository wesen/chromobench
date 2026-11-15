// The one collection idiom (design §24, Decision D3): an ordered record `{ order, items }`. Every list in a
// document, at any depth, has this shape, so items keep stable ids through reorders and moves, and one set of
// mutations edits all of them. The helpers are pure: they return new (shallow-frozen) collections and never touch
// their input. Items are not copied or frozen by the helpers (the document's mutations freeze what they insert).
import { fail } from './errors.ts';
import { isPlainObject } from './json.ts';

export type Id = string;

/** An ordered collection: `order` lists every key of `items` exactly once. */
export interface Coll<T> {
  readonly order: readonly Id[];
  readonly items: Readonly<Record<Id, T>>;
}

const ID_RE = /^[A-Za-z0-9_-]+$/;

/** Ids are letters, digits, `_` and `-` (never `__proto__`): safe as path segments and as record keys. */
export function isId(v: unknown): v is Id {
  return typeof v === 'string' && ID_RE.test(v) && v !== '__proto__';
}

function make<T>(order: readonly Id[], items: Record<Id, T>): Coll<T> {
  return Object.freeze({ order: Object.freeze(order.slice()), items: Object.freeze(items) });
}

function checkAt(at: number, max: number, what: string): void {
  if (!Number.isInteger(at) || at < 0 || at > max) fail('E_MUTATION', `${what}: position ${at} is outside 0…${max}`);
}

function need<T>(c: Coll<T>, id: Id, what: string): void {
  if (!Object.hasOwn(c.items, id)) fail('E_MUTATION', `${what}: no item "${id}"`, { valid: [...c.order] });
}

export const Coll = {
  empty<T>(): Coll<T> {
    return make<T>([], {});
  },
  /** from `[id, item]` pairs, in order */
  of<T>(entries: Iterable<readonly [Id, T]>): Coll<T> {
    let c = Coll.empty<T>();
    for (const [id, item] of entries) c = Coll.insert(c, id, item);
    return c;
  },
  /** from a list, naming each item */
  from<T>(list: readonly T[], idOf: (item: T, i: number) => Id): Coll<T> {
    return Coll.of(list.map((x, i) => [idOf(x, i), x] as const));
  },
  /** Whether v has the shape of a collection: a plain object with exactly `order` (strings) and `items`. */
  is(v: unknown): v is Coll<unknown> {
    if (!isPlainObject(v)) return false;
    const keys = Object.keys(v);
    return keys.length === 2 && Array.isArray(v['order']) && isPlainObject(v['items']) && (v['order'] as unknown[]).every((x) => typeof x === 'string');
  },
  /** Why v is not a well-formed collection, or null. */
  problem(v: unknown): string | null {
    if (!Coll.is(v)) return 'not { order: Id[], items: {…} }';
    const seen = new Set<string>();
    for (const id of v.order) {
      if (!isId(id)) return `"${id}" is not an id (letters, digits, _ and -)`;
      if (seen.has(id)) return `"${id}" appears twice in order`;
      if (!Object.hasOwn(v.items, id)) return `"${id}" is in order but not in items`;
      seen.add(id);
    }
    for (const k of Object.keys(v.items)) if (!seen.has(k)) return `"${k}" is in items but not in order`;
    return null;
  },
  size<T>(c: Coll<T>): number {
    return c.order.length;
  },
  has<T>(c: Coll<T>, id: Id): boolean {
    return Object.hasOwn(c.items, id);
  },
  get<T>(c: Coll<T>, id: Id): T | undefined {
    return Object.hasOwn(c.items, id) ? c.items[id] : undefined;
  },
  /** the position of id, or −1 */
  indexOf<T>(c: Coll<T>, id: Id): number {
    return Object.hasOwn(c.items, id) ? c.order.indexOf(id) : -1;
  },
  ids<T>(c: Coll<T>): readonly Id[] {
    return c.order;
  },
  values<T>(c: Coll<T>): T[] {
    return c.order.map((id) => c.items[id]!);
  },
  entries<T>(c: Coll<T>): [Id, T][] {
    return c.order.map((id) => [id, c.items[id]!]);
  },
  /** iterate `[id, item]` in order */
  *iter<T>(c: Coll<T>): Generator<[Id, T]> {
    for (const id of c.order) yield [id, c.items[id]!];
  },
  /** add an item at a position (default: the end); the id must be new */
  insert<T>(c: Coll<T>, id: Id, item: T, at: number = c.order.length): Coll<T> {
    if (!isId(id)) fail('E_MUTATION', `"${id}" is not an id (letters, digits, _ and -)`);
    if (Object.hasOwn(c.items, id)) fail('E_MUTATION', `insert: "${id}" already exists`);
    checkAt(at, c.order.length, 'insert');
    const order = c.order.slice();
    order.splice(at, 0, id);
    return make(order, { ...c.items, [id]: item });
  },
  remove<T>(c: Coll<T>, id: Id): Coll<T> {
    need(c, id, 'remove');
    const { [id]: _gone, ...items } = c.items as Record<Id, T>;
    return make(c.order.filter((x) => x !== id), items);
  },
  /** move an item to a position in the order without it (0…size−1) */
  move<T>(c: Coll<T>, id: Id, at: number): Coll<T> {
    need(c, id, 'move');
    checkAt(at, c.order.length - 1, 'move');
    const order = c.order.filter((x) => x !== id);
    order.splice(at, 0, id);
    return make(order, { ...c.items });
  },
  /** replace an existing item */
  replace<T>(c: Coll<T>, id: Id, item: T): Coll<T> {
    need(c, id, 'replace');
    return make(c.order, { ...c.items, [id]: item });
  },
  update<T>(c: Coll<T>, id: Id, f: (item: T) => T): Coll<T> {
    need(c, id, 'update');
    return Coll.replace(c, id, f(c.items[id]!));
  },
  map<T, U>(c: Coll<T>, f: (item: T, id: Id, i: number) => U): Coll<U> {
    const items: Record<Id, U> = {};
    c.order.forEach((id, i) => (items[id] = f(c.items[id]!, id, i)));
    return make(c.order, items);
  },
  filter<T>(c: Coll<T>, keep: (item: T, id: Id, i: number) => boolean): Coll<T> {
    const order: Id[] = [];
    const items: Record<Id, T> = {};
    c.order.forEach((id, i) => {
      if (keep(c.items[id]!, id, i)) {
        order.push(id);
        items[id] = c.items[id]!;
      }
    });
    return make(order, items);
  },
};
