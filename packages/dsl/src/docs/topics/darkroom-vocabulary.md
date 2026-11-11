# Darkroom vocabulary

## The chain

A frame goes scan → negative → print. Each stage is a handle with its own methods:

```js
return [frame.source().domain, frame.scan().domain, frame.negative().domain, frame.print().domain, frame.display().domain]
```

## What-if prints

`neg.print({…})` prints the negative with some settings changed and the rest taken from the recipe. It changes nothing. Options: `paper, time_s, fstop, filtration, lights, grade, preflash, illuminant, flare`.

```js
const neg = frame.negative()
const longer = await neg.print({ time_s: 20 }).measure.densitometer({ at: [48, 32] })
const now = await neg.print().measure.densitometer({ at: [48, 32] })
return { now: now.D, longer: longer.D }
```

`frame.print(opts)` is the same as `frame.negative().print(opts)`.

```js
const a = frame.print({ grade: 3 })
const b = frame.negative().print({ grade: 3 })
return a === b
```

## Printer lights are log H

Lights are stored in log exposure. One printer point is 0.025 log H; use `units.pt`:

```js
const warmer = frame.print({ lights: units.pt([4, 0, 0]) })
return (await warmer.measure.densitometer({ at: [48, 32] })).D
```

Writing points where log H is expected is out of range, and the error carries the converted value:

```js error=E_ARG_RANGE
return frame.print({ lights: [4, 0, 0] })
```

## The generated ops

Every registry op is a method on the handles whose domain it accepts, grouped by area: `h.print.expose`, `h.measure.stats`, `h.mask.gradient`. Unset recipe-backed arguments come from the frame's recipe.

```js
const x = frame.negative().print.expose({ time_s: 12.6 })
return x.domain
```

An op on the wrong kind of handle says which handle to use:

```js error=E_DOMAIN
return frame.scan().print.expose({ time_s: 12 })
```

`cb.explain(h)` shows the chain behind a handle.

```js
return cb.explain(frame.print({ time_s: 12 }))
```
