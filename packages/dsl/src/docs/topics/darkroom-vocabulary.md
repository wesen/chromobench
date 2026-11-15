# Darkroom vocabulary

## The cuts

A frame's document compiles to one graph with named cuts, in pipeline order: `source`, `scan` (negative scans) or `scene` and `film` (camera files), `negative`, `darkroom.H` (paper exposure), `print` (the print under the viewing light), `finished` (after the print stage's layers), `display`.

```js
return [frame.source().domain, frame.scan().domain, frame.negative().domain, frame.cut('darkroom.H').domain, frame.print().domain, frame.finished().domain, frame.display().domain]
```

A cut a frame does not have is an error that lists the ones it has:

```js error=E_CUT
return frame.scene()
```

## What-if prints

`frame.with(change)` is the document with a change, compiled by the same compiler the studio uses. It changes nothing.

```js
const longer = await frame.with(set('main.params.time_s', 20)).print().measure.densitometer({ at: [48, 32] })
const now = await frame.print().measure.densitometer({ at: [48, 32] })
return { now: now.D, longer: longer.D }
```

The same what-if is the same node, and cuts take no options:

```js
return frame.with(set('stages.darkroom.medium.grade', 3)).print() === frame.with(set('stages.darkroom.medium.grade', 3)).print()
```

```js error=E_ARG_TYPE
return frame.print({ time_s: 12 })
```

## Printer lights are log H

The printer lights are the darkroom layer `lights` (a filter), stored in log exposure. One printer point is 0.025 log H; use `units.pt`:

```js
const warmer = frame.with(set('lights.params.logH', units.pt([4, 0, 0]))).print()
return (await warmer.measure.densitometer({ at: [48, 32] })).D
```

Writing points where log H is expected is out of range, and the error carries the converted value:

```js error=E_ARG_RANGE
return frame.with(set('lights.params.logH', [4, 0, 0]))
```

## The darkroom's layers

Every darkroom entry is light on the paper (`expose` — the main exposure `main` — `burn`, `dodge`, `flash`, `preflash`) or a filter in its path (`densityMask`, `filter`). A burn adds light under a mask; its amount scales its time.

```js
const burn = layer('burn', { stops: 1 }).amount(0.5)
const d = await frame.with(insert('stages.darkroom.stack', 'b1', burn)).print().measure.densitometer({ at: [48, 32] })
return d.D
```

## The generated ops

Every node op of the catalogue is a method on the handles whose domain it accepts, grouped by area: `h.print.expose`, `h.measure.stats`, `h.mask.linear`. A handle op reads nothing from the document: it is the raw node with the op's defaults.

```js
const x = frame.negative().print.expose({ time_s: 12.6 })
return x.domain
```

An op on the wrong kind of handle says which cut to use:

```js error=E_DOMAIN
return frame.scan().print.expose({ time_s: 12 })
```

`cb.explain(h)` shows the chain behind a handle.

```js
return cb.explain(frame.with(set('main.params.time_s', 12)).cut('darkroom.H'))
```
