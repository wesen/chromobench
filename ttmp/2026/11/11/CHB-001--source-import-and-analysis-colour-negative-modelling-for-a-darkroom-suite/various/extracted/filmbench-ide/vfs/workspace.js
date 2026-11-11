// workspace.js — the pictures and plots of the Workspace, and named arrangements of them.
// A tile reads a tap of the pipeline (or is a plot, a table, some text or a set of controls). Tiles are cheap:
// the film engine only runs in its slow, staged form while some tile reads a tap in the middle of the pipeline.
// A layout is a function that arranges tiles, so it can also create the ones it needs.
// Probes are named rectangles in picture coordinates (0…1) that tiles, tables and macros can point at.

export function probes(wb) {
  const { ws } = wb;
  ws.probe('skin',   [0.30, 0.28, 0.10, 0.12]);
  ws.probe('shadow', [0.08, 0.70, 0.10, 0.10]);
  ws.probe('sky',    [0.62, 0.06, 0.12, 0.10]);
}

export function tiles(wb) {
  const { ws } = wb;
  ws.tile('print').render('out');                                       // what the scanner sees
  ws.tile('paper curves').plot.curves('paper');                         // characteristic curves, one set per dye
  ws.tile('histogram').hist('out', { channel: 'L*', bins: 64, bands: 'zones' });
  ws.tile('notes').text('Move a slider and watch the curves and the histogram follow.\n\nWorkspace layouts live in workspace.js. Drag a tab to rearrange tiles, or use Layout above.');
  ws.tile('controls').controls('colourist');                            // a scheme of controls, as a tile
}

export function layouts(wb) {
  const { ws } = wb;
  const { row, col, tabs } = ws.dock;

  ws.layout('Study', () => ws.dock.set(row([0.64, 'print'], [0.36, col([0.5, tabs('paper curves', 'notes')], [0.5, 'histogram'])])));

  ws.layout('Darkroom', () => ws.dock.set(row([0.6, 'print'], [0.4, col([0.55, 'controls'], [0.45, 'histogram'])])));

  // a mosaic of the same frame through every paper: the question "what does the paper do?" at a glance
  ws.layout('Papers', () => {
    const papers = wb.axis('print', ['kodak_portra_endura', 'kodak_ultra_endura', 'kodak_supra_endura', 'kodak_endura_premier', 'kodak_ektacolor_edge', 'fujifilm_crystal_archive_typeii', 'kodak_2383']);
    ws.tile('paper shootout').mosaic({ cols: papers, rows: wb.axis('scene', ['chart', 'still']), cell: (c) => c.render('out').match('midgray'), size: 150 });
    ws.dock.set(row([0.74, 'paper shootout'], [0.26, col([0.5, 'controls'], [0.5, 'histogram'])]));
  });

  // every stock through the same paper
  ws.layout('Films', () => {
    const films = wb.axis('film', ['kodak_portra_400', 'kodak_portra_160', 'kodak_ektar_100', 'kodak_gold_200', 'fujifilm_pro_400h', 'fujifilm_c200', 'kodak_vision3_250d', 'kodak_vision3_500t']);
    ws.tile('film shootout').mosaic({ cols: films, rows: wb.axis('scene', ['still']), cell: (c) => c.render('out'), size: 180 });
    ws.dock.set(row([0.78, 'film shootout'], [0.22, col([0.5, 'controls'], [0.5, 'print'])]));
  });

  // the picture next to what the film made of it: the staged film engine runs while these tiles exist
  ws.layout('Negative', () => {
    ws.tile('negative').render('cmy_film');
    ws.tile('print density').render('cmy_print');
    ws.dock.set(row([0.34, 'negative'], [0.33, 'print density'], [0.33, col([0.6, 'print'], [0.4, 'paper curves'])]));
  });

  // grain and halation want pixels, not a thumbnail
  ws.layout('Grain', () => {
    ws.tile('grain zoom').render('out').zoom(4, { at: 'skin' });
    ws.tile('halation zoom').render('out').zoom(4, { at: 'sky' });
    ws.dock.set(row([0.4, 'print'], [0.3, 'grain zoom'], [0.3, col([0.5, 'halation zoom'], [0.5, 'controls'])]));
  });
}
