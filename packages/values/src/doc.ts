// Documents: a JSON object whose lists are collections (coll.ts), at any depth. Every collection item has an id
// unique in the whole document, found through an index built once per document version (and derived, not rebuilt,
// by the mutations).
//
// Paths are dotted strings. The first segment is an item id when the document has an item of that id
// (`a7f3.params.ev`), otherwise a key of the root (`darkroom.medium.paper`). After it, a segment crosses a plain
// object by key, an array by index (`rgb.1`) and a collection by item id (`masks.sky.feather`): `order` and `items`
// are never written in a path. An item id may therefore never equal a root key. The canonical form of a path starts
// at the nearest item id above its target (`stages.darkroom.stack.a7f3.amount` → `a7f3.amount`), so it survives
// moves.
import { Coll, isId, type Id } from './coll.ts';
import { fail, type ValueErrorCode } from './errors.ts';
import { deepFreeze, isPlainObject, type Frozen } from './json.ts';

/** A physical path segment: an object key or an array index. Through a collection: 'items', then the id. */
export type Seg = string | number;

/** Where an item sits: the item (or the root, null) that owns its collection, and the physical path from it. */
interface Loc {
  readonly parent: Id | null;
  readonly rel: readonly Seg[];
}

export interface Location {
  readonly id: Id;
  /** the item whose subtree holds the collection, or null for a collection reached from the root */
  readonly parent: Id | null;
  /** the canonical path of the collection that holds the item */
  readonly coll: string;
  /** the item's position in that collection */
  readonly at: number;
  /** the physical path from the root to the item */
  readonly path: readonly Seg[];
}

/** The id index of one document version. */
export class DocIndex {
  readonly doc: object;
  readonly #locs: ReadonlyMap<Id, Loc>;

  /** @internal use indexOf(doc) */
  constructor(doc: object, locs: ReadonlyMap<Id, Loc>) {
    this.doc = doc;
    this.#locs = locs;
  }
  /** @internal the map, for deriving the next version's index */
  locs(): ReadonlyMap<Id, Loc> {
    return this.#locs;
  }
  has(id: string): boolean {
    return this.#locs.has(id);
  }
  get size(): number {
    return this.#locs.size;
  }
  /** every id, in no particular order */
  ids(): Id[] {
    return [...this.#locs.keys()];
  }
  parentOf(id: Id): Id | null | undefined {
    return this.#locs.get(id)?.parent;
  }
  /** the items above id, nearest first */
  ancestors(id: Id): Id[] {
    const out: Id[] = [];
    for (let p = this.#locs.get(id)?.parent ?? null; p !== null; p = this.#locs.get(p)!.parent) out.push(p);
    return out;
  }
  /** the physical path from the root to the item */
  physical(id: Id): Seg[] {
    const loc = this.#locs.get(id);
    if (!loc) return fail('E_MUTATION', `no item "${id}"`);
    return [...(loc.parent === null ? [] : this.physical(loc.parent)), ...loc.rel, 'items', id];
  }
  locate(id: Id): Location | undefined {
    const loc = this.#locs.get(id);
    if (!loc) return undefined;
    const collPhys = [...(loc.parent === null ? [] : this.physical(loc.parent)), ...loc.rel];
    const c = getPhys(this.doc, collPhys) as Coll<unknown>;
    return { id, parent: loc.parent, coll: logical(loc.parent, loc.rel), at: c.order.indexOf(id), path: [...collPhys, 'items', id] };
  }
}

const INDEX = new WeakMap<object, DocIndex>();

/** The index of a document version (built on first use, then cached). Throws E_DOCUMENT if it is malformed. */
export function indexOf(doc: object): DocIndex {
  let idx = INDEX.get(doc);
  if (!idx) {
    if (!isPlainObject(doc) || Coll.is(doc)) fail('E_DOCUMENT', 'a document is a plain object (not a collection)');
    const locs = new Map<Id, Loc>();
    collect(doc, null, [], (id, loc) => add(locs, doc, id, loc, 'E_DOCUMENT'), '');
    idx = new DocIndex(doc, locs);
    INDEX.set(doc, idx);
  }
  return idx;
}

/** Freeze a document and check it (well-formed collections, unique ids, no id equal to a root key). */
export function document<D extends object>(d: D): Frozen<D> {
  const f = deepFreeze(d);
  indexOf(f);
  return f;
}

/** The first `<prefix><n>` (n = 1, 2, …) that is neither an item id nor a root key of the document. */
export function freshId(doc: object, prefix = 'e'): Id {
  const idx = indexOf(doc);
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!idx.has(id) && !Object.hasOwn(doc, id)) return id;
  }
}

function add(locs: Map<Id, Loc>, doc: object, id: Id, loc: Loc, code: ValueErrorCode): void {
  if (locs.has(id)) fail(code, `id "${id}" is used twice in the document`);
  if (Object.hasOwn(doc, id)) fail(code, `id "${id}" equals a root key of the document`, { hint: 'paths starting with it would be ambiguous' });
  locs.set(id, loc);
}

/** Visit every collection item under v (v sits at `rel` below `owner`), owners before their nested items. */
function collect(v: unknown, owner: Id | null, rel: readonly Seg[], visit: (id: Id, loc: Loc) => void, at: string): void {
  if (Coll.is(v)) {
    const p = Coll.problem(v);
    if (p) fail('E_DOCUMENT', `${at || 'the document'}: ${p}`, { path: at });
    const loc: Loc = { parent: owner, rel: Object.freeze(rel.slice()) };
    for (const id of v.order) {
      visit(id, loc);
      collect(v.items[id], id, [], visit, id);
    }
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => collect(x, owner, [...rel, i], visit, `${at}.${i}`));
  } else if (isPlainObject(v)) {
    for (const [k, x] of Object.entries(v)) collect(x, owner, [...rel, k], visit, at ? `${at}.${k}` : k);
  }
}

function idsUnder(v: unknown, owner: Id | null, rel: readonly Seg[]): Id[] {
  const out: Id[] = [];
  collect(v, owner, rel, (id) => out.push(id), '');
  return out;
}

const logical = (owner: Id | null, rel: readonly Seg[]): string => [...(owner === null ? [] : [owner]), ...rel].join('.');

export function getPhys(doc: unknown, phys: readonly Seg[]): unknown {
  let cur: unknown = doc;
  for (const s of phys) cur = (cur as Record<Seg, unknown>)[s];
  return cur;
}

/** Copy-on-write update at a physical path; f(undefined) is the absent value, and f returning undefined deletes the key. */
function updateIn(node: unknown, phys: readonly Seg[], i: number, f: (old: unknown) => unknown): unknown {
  if (i === phys.length) return f(node);
  const k = phys[i]!;
  if (Array.isArray(node)) {
    const copy = node.slice();
    copy[k as number] = updateIn(node[k as number], phys, i + 1, f);
    return Object.freeze(copy);
  }
  const o = node as Record<string, unknown>;
  const child = updateIn(Object.hasOwn(o, k) ? o[k] : undefined, phys, i + 1, f);
  if (child === undefined) {
    const { [k]: _gone, ...rest } = o;
    return Object.freeze(rest);
  }
  return Object.freeze({ ...o, [k]: child });
}

/** A path resolved against a document. */
export interface Resolved {
  readonly phys: readonly Seg[];
  /** the nearest item at or above the target (null: none) and the physical path from it */
  readonly owner: Id | null;
  readonly rel: readonly Seg[];
  /** what holds the target */
  readonly holder: 'object' | 'array' | 'coll';
  readonly exists: boolean;
  readonly value: unknown;
  /** the canonical (id-anchored) path */
  readonly canonical: string;
}

/** Resolve a path. A missing key is allowed in the last segment only (exists: false). Throws E_PATH. */
export function resolvePath(doc: object, path: string, idx: DocIndex = indexOf(doc)): Resolved {
  if (typeof path !== 'string') fail('E_PATH', `${String(path)} is not a path`);
  const segs = path.split('.');
  if (segs.some((s) => s === '')) fail('E_PATH', `"${path}" is not a path`, { path });
  let cur: unknown = doc;
  let phys: Seg[] = [];
  let owner: Id | null = null;
  let rel: Seg[] = [];
  let holder: Resolved['holder'] = 'object';
  let i = 0;
  if (idx.has(segs[0]!)) {
    owner = segs[0]!;
    phys = idx.physical(owner);
    cur = getPhys(doc, phys);
    holder = 'coll';
    i = 1;
  }
  for (; i < segs.length; i++) {
    const seg = segs[i]!;
    const last = i === segs.length - 1;
    const here = segs.slice(0, i).join('.') || 'the root';
    if (Coll.is(cur)) {
      if (!Object.hasOwn(cur.items, seg)) fail('E_PATH', `${path}: no item "${seg}" in ${here}`, { path, valid: [...cur.order] });
      phys.push('items', seg);
      cur = cur.items[seg];
      owner = seg;
      rel = [];
      holder = 'coll';
    } else if (Array.isArray(cur)) {
      const n = /^\d+$/.test(seg) ? Number(seg) : -1;
      if (n < 0 || n >= cur.length) fail('E_PATH', `${path}: ${here} is a list of ${cur.length}; "${seg}" is not an index in it`, { path });
      phys.push(n);
      rel.push(n);
      cur = cur[n];
      holder = 'array';
    } else if (isPlainObject(cur)) {
      phys.push(seg);
      rel.push(seg);
      holder = 'object';
      if (!Object.hasOwn(cur, seg)) {
        if (last) return { phys, owner, rel, holder, exists: false, value: undefined, canonical: logical(owner, rel) };
        fail('E_PATH', `${path}: no "${seg}" in ${here}`, { path, valid: Object.keys(cur) });
      }
      cur = cur[seg];
    } else {
      fail('E_PATH', `${path}: ${here} is ${cur === null ? 'null' : typeof cur}, not an object, list or collection`, { path });
    }
  }
  return { phys, owner, rel, holder, exists: true, value: cur, canonical: logical(owner, rel) };
}

/** The value at a path, or undefined when it does not resolve. */
export function getPath(doc: object, path: string): unknown {
  try {
    return resolvePath(doc, path).value;
  } catch {
    return undefined;
  }
}

/** The canonical form of a path: anchored at the nearest item id above its target. */
export function canonicalPath(doc: object, path: string): string {
  return resolvePath(doc, path).canonical;
}

// ── internals for mutations.ts ──────────────────────────────────────────────

/** @internal */
export const internal = {
  collect,
  idsUnder,
  logical,
  updateIn,
  add,
  /** register a derived index for a new document version */
  remember(doc: object, locs: ReadonlyMap<Id, Loc>): DocIndex {
    const idx = new DocIndex(doc, locs);
    INDEX.set(doc, idx);
    return idx;
  },
  isId,
};
export type { Loc };
