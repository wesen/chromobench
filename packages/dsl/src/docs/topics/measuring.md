# Measuring

## Densitometer

`h.measure.densitometer({ at, aperture_px })` reads densities at a point in source pixels. On a print it also gives the visual density.

```js
const d = await frame.print().measure.densitometer({ at: [48, 32], aperture_px: 15 })
return d
```

## Statistics

`h.measure.stats({ box?, mask? })` gives mean, 1st and 99th percentiles and clipped fractions in the domain's unit.

```js
return await frame.print().measure.stats({ box: [40, 24, 16, 16] })
```

```js
return await frame.scan().measure.stats()
```

## Patches and histograms

```js
return (await frame.print().measure.patches({ cols: 4, rows: 2 })).cells
```

```js
const h = await frame.print().measure.histogram({ channel: 'L', bins: 8 })
return h.counts
```

## Many measurements at once

Measurements run concurrently under `Promise.all`.

```js
const at = [48, 32]
const [a, b] = await Promise.all([frame.print({ time_s: 8 }).measure.densitometer({ at }), frame.print({ time_s: 16 }).measure.densitometer({ at })])
return { t8: a.visual, t16: b.visual }
```

## Helpers on mem

A function on `mem` survives between evals. A comment that opens its body becomes its doc line in the context block.

```js
mem.greyD = async (h, at = [48, 32]) => { // print densities at a point, 15 px aperture
  return (await h.measure.densitometer({ at, aperture_px: 15 })).D
}
return await mem.greyD(frame.print())
```

```js
return await mem.greyD(frame.print({ filtration: { c: 0, m: 0, y: 10 } }))
```
