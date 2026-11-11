# Editing and approval

## Proposals, not changes

Building nodes never changes anything. To change the recipe, `frame.edit` proposes changes by recipe path. They are submitted together when the eval succeeds, as one unit the photographer can undo. In ask mode they wait for approval; the next context block reports the outcome.

```js
const e = frame.edit({ 'print.enlarger.time_s': 12.6 }, { why: 'the grey card prints too light' })
return { id: e.id, status: e.status, note: e.note }
```

## The receipt's preview

`frame.recipe` and `frame.print()` keep showing the state at the start of the eval. To see an edit's effect, use `receipt.preview`:

```js looks=1
const e = frame.edit({ 'print.lights.logH': units.pt([2, 0, 0]) }, { why: 'a little warmer' })
e.preview.look('proposed')
return (await e.preview.measure.densitometer({ at: [48, 32] })).D
```

## Who set what

```js
return frame.why('print.enlarger.time_s')
```

```js
return frame.pending().length
```

## Exposures and masks

A dodge or burn is an exposure through a mask. A mask handle passed to `frame.edit.exposure.add` is stored with the frame.

```js
const sky = frame.source().mask.gradient({ from: [48, 0], to: [48, 40] }).mask.feather({ radius_px: 8 })
const e = frame.edit.exposure.add({ id: 'sky', kind: 'dodge', mask: sky, stops: 0.5 }, { why: 'hold the sky back' })
return e.mutations.map((m) => m.op)
```

## Mistakes

A wrong path gives the corrected call:

```js error=E_PATH
frame.edit({ 'print.light.logH': [0.1, 0, 0] })
```

Assigning to the recipe or a handle changes nothing and says how to edit instead:

```js error=E_IMMUTABLE
frame.recipe.print.enlarger.time_s = 12
```

If the eval fails, its edits are dropped:

```js error=E_NOT_AWAITED
frame.edit({ 'print.grade': 3 })
const v = frame.print().measure.stats()
return v.mean
```
