# Editing and approval

## Changes

A change is one of four mutations of the document: `set(path, value)`, `insert(coll, id, item, at?)`, `remove(id)`, `move(id, { into, at })`. Several changes are an array, applied in order. Paths start at an item id (`main.params.time_s`) or at a root key (`stages.darkroom.medium.grade`).

```js
return [set('main.params.time_s', 12), remove('b1')]
```

## Proposals, not changes

Building values and what-ifs never changes anything. `frame.propose(change, { why })` checks the change at once and submits it when the eval succeeds, as one unit the photographer can undo. In ask mode it waits for approval; the next context block reports the outcome.

```js
const e = frame.propose(set('main.params.time_s', 12.6), { why: 'the grey card prints too light' })
return { id: e.id, status: e.status, changes: e.changes, note: e.note }
```

## The receipt's preview

`frame` keeps showing the document as the eval started. The receipt's `preview` is a what-if with the eval's proposals so far:

```js shows=1
const e = frame.propose(set('lights.params.logH', units.pt([2, 0, 0])), { why: 'a little warmer' })
e.preview.print().show('proposed')
return (await e.preview.print().measure.densitometer({ at: [48, 32] })).D
```

## Layers, groups and masks

Layers, groups and masks are values: `layer(op, params)`, `group(name, { id: entry })`, `mask(name).add(…)`, each with chain methods that return a new value. A dodge through a feathered gradient is a mask in the library and a layer that uses it:

```js
const sky = mask('Sky').add('g', 'linear', { from: [48, 0], to: [48, 40] }).feather(0.4)
const e = frame.propose([insert('masks', 'sky', sky), insert('stages.darkroom.stack', 'd1', layer('dodge', { stops: 0.5 }).mask('sky'))], { why: 'hold the sky back' })
return e.changes
```

A group fades or masks several entries as one:

```js
const g = group('Edges', { b1: layer('burn', { stops: 0.3 }), b2: layer('burn', { stops: 0.6 }) }).amount(0.5)
return (await frame.with(insert('stages.darkroom.stack', 'edges', g)).print().measure.stats()).mean
```

## Who set what

```js
return frame.why('main.params.time_s')
```

```js
return frame.pending().length
```

## Mistakes

A wrong path gives the corrected call:

```js error=E_PATH
frame.propose(set('main.param.time_s', 12))
```

Ids are unique in the whole document; a taken id is refused with a free one:

```js error=E_MUTATION
frame.propose(insert('stages.darkroom.stack', 'main', layer('burn', { stops: 1 })))
```

Assigning to the document or a handle changes nothing and says how to propose instead:

```js error=E_IMMUTABLE
frame.doc.stages.darkroom.medium.grade = 3
```

If the eval fails, its proposals are dropped:

```js error=E_NOT_AWAITED
frame.propose(set('stages.darkroom.medium.grade', 3))
const v = frame.print().measure.stats()
return v.mean
```
