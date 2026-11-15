# Balancing colour

## Read the grey

Measure a neutral, then see how each layer responds to light. More light on a layer makes that dye denser.

```js
const at = [48, 32]
const lights = frame.get('lights.params.logH')
const now = await frame.print().measure.densitometer({ at, aperture_px: 15 })
const probe = await frame.with(set('lights.params.logH', lights.map((v) => v + 0.05))).print().measure.densitometer({ at, aperture_px: 15 })
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

## Check it as a what-if, then propose it

```js
const lights = units.pt(mem.pts).map((v, k) => v + frame.get('lights.params.logH')[k])
const change = set('lights.params.logH', lights)
const after = await frame.with(change).print().measure.densitometer({ at: [48, 32], aperture_px: 15 })
frame.propose(change, { why: 'neutral grey card: ' + mem.pts.join(' / ') + ' pt' })
return after.D
```

## Filtration instead of lights

The main exposure's filtration is subtractive: adding yellow removes blue light, so the print gets less yellow dye and turns cooler.

```js
const at = [48, 32]
const a = await frame.print().measure.densitometer({ at })
const b = await frame.with(set('main.params.filtration', { c: 0, m: 0, y: 10 })).print().measure.densitometer({ at })
return { blueBefore: a.D[2], blueAfter: b.D[2] }
```

Lights can be expressed as filtration:

```js
return await frame.negative().darkroom.lightsToFiltration({ logH: units.pt([2, 0, -2]) })
```
