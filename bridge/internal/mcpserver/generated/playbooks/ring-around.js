// Ring-around: nine prints around the current one, shifted in printer lights (points), to judge colour by eye and
// by numbers; the centre is the current print.
mem.ringAround = async ({ step_pt = 4 } = {}) => { // nine prints around now, one reading per cell, and a look
  const ring = cb.ringAround(frame, { step_pt })
  ring.look(`ring-around, ${step_pt} points`)
  return (await ring.measure.patches({ cols: 3, rows: 3 })).cells
}
mem.mostNeutral = (cells) => { // the cell whose three densities are closest to equal
  const spread = (D) => Math.max(...D) - Math.min(...D)
  return cells.reduce((b, c) => (spread(c.D) < spread(b.D) ? c : b))
}
return 'ring-around ready: await mem.ringAround({ step_pt }); mem.mostNeutral(cells)'
