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

## A frame is a document

A frame's edit is a document: its stages (a scan or a scene and a film, the darkroom, the print), each a medium (the settings of the physical process) and a stack of layers; a library of masks; the geometry. `frame.explain()` summarises it; `frame.get(path)` reads one value; `frame.doc` is the whole document, read-only, as it was when the eval started.

```js
return frame.explain()
```

```js
return { paper: frame.get('stages.darkroom.medium.paper'), time_s: frame.get('main.params.time_s'), lights_pt: units.toPt(frame.get('lights.params.logH')) }
```

## Cuts are lazy nodes, then data

`frame.print()` is the print cut of the compiled document: a handle, nothing computed yet. `await` on a measurement computes it and gives plain numbers.

```js
const print = frame.print()
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

## Images come with numbers

`h.show(label)` sends you an image, at most four per eval. Each carries the numbers it shows: read those, not the picture.

```js shows=1
frame.print().show('current print')
return 'see image 1'
```
