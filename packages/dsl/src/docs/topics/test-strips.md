# Test strips and ring-arounds

## A time strip

`cb.testStrip(frame, { vary, steps, step })` prints bands across the frame. `vary: 'time'` steps in stops around the current time.

```js looks=1
const strip = cb.testStrip(frame, { vary: 'time', steps: 7, step: 1 / 3 })
strip.look('time test strip')
return (await strip.measure.patches({ cols: 7 })).cells
```

Its look carries one reading per band, so you do not need to measure it yourself.

## Other strips

```js
return (await cb.testStrip(frame, { vary: 'grade', steps: 5, step: 1 }).measure.patches({ cols: 5 })).cells
```

```js
const s = cb.testStrip(frame, { vary: 'lights.r', steps: 5, step: 4, direction: 'horizontal' })
return (await s.measure.patches({ rows: 5 })).cells
```

A step outside the strip's range is refused:

```js error=E_ARG_RANGE
return cb.testStrip(frame, { vary: 'time', steps: 7, step: 5 })
```

## A ring-around

```js looks=1
const ring = cb.ringAround(frame, { step_pt: 4 })
ring.look('ring-around, 4 points')
return 'nine prints; see the look numbers'
```

## Side by side

`cb.compare([a, b], label)` makes one look with both halves; each half carries its own numbers.

```js looks=1
cb.compare([frame.print(), frame.print({ time_s: 12.6 })], 'now vs +1/3 stop')
return 'compare'
```
