# @chromobench/values — the builder core

A dependency-free leaf package (CHB-035 design 01 v2, §30 builders and modifiers, §24 collections and the four
mutations, §26 transactions). It imports nothing; the contract and the shell import it. It knows nothing about images
or interfaces: it gives every component of the editing model and of the UI the same shape.

| Piece | What it gives |
|---|---|
| `json.ts` | `Json` types, `assertJson`, `deepFreeze`, `isDeepFrozen`, `equal`, `canonicalJSON` (the one implementation; the contract's node ids hash it) |
| `modifier.ts` | `Modifier<T>`: a named, explainable `T → T`; `modifier`, `then` (associative), `named`, `identity`, `compose`, `apply`, `field`, `assign`, `toModifier` |
| `value.ts` | `defineValue`: immutable values with `with(m \| fn \| patch)`, chain methods that are modifiers, provenance, explain |
| `explain.ts`, `site.ts` | the `EXPLAIN` protocol and `explain(x)`; call-site capture (`site`, `libraryRoot`, `where`, `captureSites`) |
| `coll.ts` | `Coll<T> = { order, items }` and its pure helpers |
| `doc.ts` | documents: the id index, id-anchored paths (`resolvePath`, `getPath`, `canonicalPath`), `document`, `freshId` |
| `mutations.ts` | `set`, `insert`, `remove`, `move`; `applyMutation` returns the new version and the exact inverse; a validation hook |
| `transactions.ts` | `Transaction`; `applyTransaction` (atomic), `tryTransaction`, `invertTransaction`, `revertTransaction` |

Errors are `ValueError`s with a `diag` record shaped like the contract's `Diagnostic` (`code`, `message`, `path`,
`hint`, `valid`); codes are listed in `VALUE_ERROR_CODES` (E_PATH, E_MUTATION, E_DOCUMENT, E_ARG_TYPE, E_ARG_RANGE,
E_INTERNAL).

## Immutable values

The values, modifiers, collections, documents and transactions this package builds are frozen (the `Coll` helpers
freeze the containers they make, not the items you put in; the mutations freeze what they insert). `deepFreeze(v)` freezes plain objects and arrays in place, all the way
down; `document(d)` freezes a document and checks it. `equal(a, b)` is JSON equality (key order and undefined keys do
not count; `0` equals `−0`) and holds exactly when `canonicalJSON(a) === canonicalJSON(b)`.

## Modifiers

```ts
import { modifier, field, identity } from '@chromobench/values';

const amount = field('amount');                               // (v) => Modifier<{ amount: V }>
const mask = (id: string | null) => field('mask')(id);   // V is inferred from the argument: type it as the field's type
const ev = (stops: number) =>
  modifier<{ params: { ev?: number } }>('ev', (d) => ({ ...d, params: { ...d.params, ev: stops } }), [stops]);

const soft = amount(0.6).then(mask('sky'));                   // name 'amount · mask'
soft.run(layerData);                                          // any record with amount and mask, same type back
soft.named('soft');                                           // one atom named 'soft' (its steps stay in explain)
```

`Modifier<T>` applies to anything that is at least a `T` and returns the same type (`run<V extends T>(v: V): V`).
A modifier is a sequence of atoms: `then` concatenates them, so `(a.then(b)).then(c)` and `a.then(b.then(c))` have
the same atoms in the same order, and `identity()` is the unit (`a.then(identity()) === a`). A modifier must return a
new value and leave its input alone.

## Values with `with` and chain methods

```ts
import { defineValue, field, explain } from '@chromobench/values';

interface LayerData { op: string; amount: number; mask: string | null; params: { ev?: number } }

// a layer-like value: each chain method is a modifier factory
const Layer = defineValue<LayerData>()('layer', { amount: (k: number) => amount(k), mask, ev }, {
  normalize: (d) => { if (d.amount < 0 || d.amount > 1) throw new RangeError('amount'); return d; },
});

const burn = Layer({ op: 'burn', amount: 1, mask: null, params: {} })   // records this line
  .amount(0.8)                                                          // ≡ .with(amount(0.8))
  .with(soft)                                                           // any modifier
  .with({ op: 'burn' });                                                // or a shallow patch

burn.data;               // deep-frozen LayerData; JSON.stringify(burn) writes the data
explain(burn);           // { kind: 'layer', at: 'file:line:col', data: {…}, built: [{ at, modifier: {…} }, …] }
```

The modifiers act on the data, so the same modifier applies to a built value and to the plain record a document
stores. The mutations take a value wherever they take data (`insert('G1.stack', 'L4', burn)`).

### How a UI node builder uses `with`

A shell or kit node is a value too; its patch merges into its props, and modifiers like `compact` are reusable
across nodes:

```ts
interface NodeData { form: string; props: Record<string, unknown> }
const tip = (t: string) => modifier<NodeData>('tip', (n) => ({ ...n, props: { ...n.props, tip: t } }), [t]);
const Node = defineValue<NodeData>()('node', { tip }, {
  patch: (n, p) => ({ ...n, props: { ...n.props, ...p.props } }),
});
const compact = modifier<NodeData>('compact', (n) => ({ ...n, props: { ...n.props, density: 'compact' } }));

Node({ form: 'panel', props: { title: 'Masks' } }).with(compact).tip('the mask library');
```

A builder that keeps its own representation (the shell's node proxies) implements `with` with
`toModifier(x, patch).run(node)`: `toModifier` turns a modifier, a function or a patch into a modifier.

## Explain and provenance

A value that can say what it is implements `[EXPLAIN](): Json`. `explain(x)` works on anything: explainable values
explain themselves; plain data is copied; functions and class instances are named. The result is JSON (printable,
no cycles). Call sites: `site()` returns the first stack frame outside the registered library roots (this package
registers its own `src/`). **A package that builds values for others calls `libraryRoot(import.meta.url)` once**, so
the recorded line is its caller's. `captureSites(false)` turns capture off (one stack trace per builder call).

## Collections

```ts
import { Coll } from '@chromobench/values';

let c = Coll.of([['a', 1], ['b', 2]]);    // { order: ['a', 'b'], items: { a: 1, b: 2 } }
c = Coll.insert(c, 'c', 3, 0);             // ['c', 'a', 'b']
c = Coll.move(c, 'c', 2);                  // position in the order without it
Coll.values(c); Coll.get(c, 'a'); Coll.map(c, (x, id, i) => …); Coll.remove(c, 'b');
```

Ids are letters, digits, `_` and `-`. A collection is exactly `{ order, items }` (no other keys); `Coll.problem(v)`
says why a value is not one.

## Documents, paths and the four mutations

A document is a plain JSON object whose lists are collections, at any depth. Every item id is unique in the whole
document and must not equal a root key. The index (`indexOf(doc)`) is built once per document version and derived,
not rebuilt, by the mutations.

A path is dotted. Its first segment is an item id if the document has one (`L3.params.ev`), else a root key
(`stages.darkroom.medium.paper`); after it, segments cross objects by key, arrays by index (`rgb.1`) and collections
by item id (`masks.sky.feather`; `order` and `items` never appear). `canonicalPath` anchors a path at the nearest
item above its target, so it survives moves.

```ts
import { Coll, document, applyMutation, set, insert, remove, move, transaction, applyTransaction, revertTransaction }
  from '@chromobench/values';

const doc = document({
  stages: {
    darkroom: { medium: { paper: 'mg-fb' }, stack: Coll.of([['main', { kind: 'main', amount: 1 }]]) },
    print: { medium: { lamp: 'd50' }, stack: Coll.of([['G1', { kind: 'group', amount: 1, stack: Coll.empty() }]]) },
  },
  masks: Coll.empty(),
});

const a = applyMutation(doc, insert('G1.stack', 'L1', { kind: 'layer', op: 'curve', amount: 1 }));
a.inverse;                                        // { op: 'remove', id: 'L1' }
applyMutation(a.doc, a.inverse).doc;              // equal to doc

const tx = transaction({
  id: 't1', label: 'Sky burn', by: 'agent', source: { kind: 'agent', turn: 3 },
  mutations: [
    insert('masks', 'sky', { components: Coll.empty(), feather: 4 }),
    insert('stages.darkroom.stack', 'b1', { kind: 'layer', op: 'burn', amount: 0.5, mask: 'sky' }),
    set('main.amount', 0.9),
    move('b1', { at: 0 }),
  ],
});
const r = applyTransaction(doc, tx, { validate: contractRules });   // all or nothing
r.tx;                                             // status 'applied', mutations in normal form, inverses filled
revertTransaction(r.doc, r.tx).doc;               // equal to doc
```

| Mutation | Meaning | Inverse |
|---|---|---|
| `set(path, value)` | set a field; `unset(path)` (no value) deletes an object key | `set` with the old value (or `unset`) |
| `insert(coll, id, item, at?)` | add an item to a collection; `at` defaults to the end | `remove(id)` |
| `remove(id)` | delete an item wherever it is | `insert` at its old collection and position |
| `move(id, { into?, at? })` | reorder (no `into`) or move into another collection | `move` back |

`applyMutation(doc, m, { validate })` returns `{ doc, mutation, inverse, warnings }`; `mutation` is the normal form
(canonical paths, explicit `at`, `into` always given), and the inverse's inverse is exactly it. Applying the inverse
restores the document exactly (canonically identical; a key that `unset` deleted comes back at the end of its object).
Structure is checked here (paths, ids, positions, cycles, JSON values); meaning is checked by the hook:
`validate(change)` sees `{ before, after, mutation, inverse, index }` and throws to refuse or returns warnings.
Transactions take a second hook, `validateTransaction({ before, after, tx })`, run once on the final document, for
rules a transaction may break in between ("exactly one main"). `tryTransaction` reports `{ ok: false, error, index }`
instead of throwing.

A transaction is `{ id, label, by: 'user' | 'agent' | 'auto', source, batch?, status, mutations, inverses }`, plain
JSON. `inverses[i]` undoes `mutations[i]`; undo applies them last to first (`invertTransaction` builds that
transaction).
