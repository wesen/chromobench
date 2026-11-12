// Grey balance: printer lights that make a neutral patch neutral, solved per layer in log exposure (half points).
// Load with one eval of this file; then: await mem.greyBalance([x, y]) proposes the lights (ask mode: a card).
mem.greyBalance = async (at, { aperture_px = 15, propose = true } = {}) => { // lights that neutralise the patch at `at`; proposes them unless propose: false
  const now = await frame.print().measure.densitometer({ at, aperture_px })
  const probe = await frame.print({ lights: [0.05, 0.05, 0.05] }).measure.densitometer({ at, aperture_px })
  const slope = now.D.map((d, k) => (probe.D[k] - d) / 0.05)
  const mean = (now.D[0] + now.D[1] + now.D[2]) / 3
  const points = units.toPt(now.D.map((d, k) => (mean - d) / slope[k])).map((p) => Math.round(p * 2) / 2)
  const lights = units.pt(points).map((v, k) => v + frame.recipe.print.lights.logH[k])
  if (!propose) return { before: now.D, points, lights }
  const e = frame.edit({ 'print.lights.logH': lights }, { why: `neutral at [${at}]: ${points.join(' / ')} pt` })
  const after = await e.preview.measure.densitometer({ at, aperture_px })
  return { before: now.D, points, after: after.D }
}
return 'grey-balance ready: await mem.greyBalance([x, y], { aperture_px, propose })'
