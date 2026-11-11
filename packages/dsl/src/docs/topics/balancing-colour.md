# Balancing colour

## Read the grey

Measure a neutral, then see how each layer responds to light. More light on a layer makes that dye denser.

```js
const at = [48, 32]
const now = await frame.print().measure.densitometer({ at, aperture_px: 15 })
const probe = await frame.print({ lights: [0.05, 0.05, 0.05] }).measure.densitometer({ at, aperture_px: 15 })
mem.slope = now.D.map((d, k) => (probe.D[k] - d) / 0.05)
mem.now = now.D
return { D: now.D, slope: mem.slope }
```

## Compute the correction

Bring each layer to the mean, in half points, as a printer would set them:

```js
const mean = (mem.now[0] + mem.now[1] + mem.now[2]) / 3
const dx = mem.now.map((d, k) => (mean - d) / mem.slope[k])
mem.pts = units.toPt(dx).map((p) => Math.round(p * 2) / 2)
return mem.pts
```

## Check it as a what-if

```js
const lights = units.pt(mem.pts).map((v, k) => v + frame.recipe.print.lights.logH[k])
const after = await frame.print({ lights }).measure.densitometer({ at: [48, 32], aperture_px: 15 })
return after.D
```

## Filtration instead of lights

Adding yellow filtration removes blue light, so the print gets less yellow dye and turns cooler.

```js
const at = [48, 32]
const a = await frame.print().measure.densitometer({ at })
const b = await frame.print({ filtration: { c: 0, m: 0, y: 10 } }).measure.densitometer({ at })
return { blueBefore: a.D[2], blueAfter: b.D[2] }
```

Lights can be expressed as filtration:

```js
return await frame.negative().darkroom.lightsToFiltration({ logH: units.pt([2, 0, -2]) })
```
