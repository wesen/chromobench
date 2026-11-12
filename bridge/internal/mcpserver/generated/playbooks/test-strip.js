// Test strips around the current print: time in stops (equal ratios) or one filter in CC, one reading per band;
// then pick the band whose visual density is nearest an aim (the grey card prints at 0.755 on Portra/Endura).
mem.testStrip = async ({ vary = 'time', steps = 5, step = 1 / 3 } = {}) => { // a strip around now: one row per band, and a look
  const strip = cb.testStrip(frame, { vary, steps, step })
  strip.look(`test strip: ${vary}, ${steps} steps of ${step}`)
  return (await strip.measure.patches({ cols: steps })).cells
}
mem.bestStep = (cells, aimD = 0.755) => { // the band whose visual density is nearest the aim
  return cells.reduce((b, c) => (Math.abs(c.visual - aimD) < Math.abs(b.visual - aimD) ? c : b))
}
mem.stripTimes = (time_s, steps = 5, step = 1 / 3) => { // the band times of a time strip: equal ratios around time_s
  return Array.from({ length: steps }, (_, i) => +(time_s * 2 ** ((i - (steps - 1) / 2) * step)).toFixed(2))
}
return 'test-strip ready: await mem.testStrip({ vary, steps, step }); mem.bestStep(cells, aimD)'
