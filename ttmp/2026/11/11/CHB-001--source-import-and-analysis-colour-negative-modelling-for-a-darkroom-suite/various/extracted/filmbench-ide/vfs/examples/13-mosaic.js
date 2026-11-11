// 13 · A mosaic of papers
// A mosaic tile runs a cell λ over two axes. Cells share every stage the axes do not touch, so seven papers by two
// scenes cost seven paper runs, not fourteen full pipelines. .match('midgray') evens out exposure so you compare
// the paper, not the brightness. A second tile puts a diff lens on the same grid to show how far each paper is from the first.

const wb = bench('papers');
wb.pipe('default').scene('chart').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ws } = wb;

const papers = wb.axis('print', ['kodak_portra_endura', 'kodak_ultra_endura', 'kodak_supra_endura', 'kodak_endura_premier', 'kodak_ektacolor_edge', 'fujifilm_crystal_archive_typeii', 'kodak_2383']);

const grid = {
  cols: papers,
  rows: wb.axis('scene', ['chart', 'still']),
  cell: (c) => c.render('out').match('midgray'),
  size: 150,
};
const sh = ws.tile('paper shootout').mosaic(grid);
log(String(sh.plan()));                                  // what is shared and what is recomputed

// the same grid again, as difference from Portra Endura (ΔE2000, four times the gain); the cells are shared, so this costs almost nothing
ws.tile('paper difference').mosaic(grid).lens(lens.diff({ vs: { print: papers.first }, metric: 'dE2000', gain: 4 }));
ws.tile('paper curves').plot.curves('paper');
ws.dock.set(ws.dock.row([0.5, ws.dock.col('paper shootout', 'paper difference')], [0.5, 'paper curves']));
use(wb);       // the Workspace now shows the mosaic. Click a cell to read it; the chip on a tile switches its lens off.
