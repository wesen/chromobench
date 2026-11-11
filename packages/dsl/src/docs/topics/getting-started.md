# Getting started

## The eval contract

Your code is the body of an async function: `await` and `return` work at the top level. End with `return …`; the returned value comes back as YAML. Top-level `const` and `let` disappear when the eval ends: keep anything you need later on `mem`.

```js
return { frame: frame.id, kind: frame.kind, mode: cb.mode }
```

```js
mem.at = [48, 32]
return mem.at
```

## Lazy nodes, then data

Calls such as `frame.print()` build nodes and compute nothing. `await` on a measurement computes it and gives plain numbers.

```js
const print = frame.print()                       // a handle: nothing computed yet
const grey = await print.measure.densitometer({ at: mem.at, aperture_px: 15 })
return grey.D
```

Awaiting an image gives a short summary, never pixels.

```js
return await frame.print()
```

Forgetting `await` is an error whose `fix` is the corrected code:

```js error=E_NOT_AWAITED
const g = frame.print().measure.densitometer({ at: mem.at })
return g.D
```

## Looks come with numbers

`h.look(label)` queues an image for you, at most four per eval. Each look carries the numbers it shows: read those, not the picture.

```js looks=1
frame.print().look('current print')
return 'see look 1'
```

## The recipe

`frame.recipe` is a read-only snapshot of the frame's settings at the start of the eval.

```js
const r = frame.recipe
return { paper: r.print.paper, time_s: r.print.enlarger.time_s, lights_pt: units.toPt(r.print.lights.logH) }
```
