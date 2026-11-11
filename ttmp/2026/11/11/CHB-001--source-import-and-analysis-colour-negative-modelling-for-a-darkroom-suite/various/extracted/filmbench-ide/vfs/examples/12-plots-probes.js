// 12 · Intermediary views: plots, scopes, probes
// Probes are named rectangles (0…1) on the picture. A table tile measures them, a line plot sweeps a macro or
// parameter, a parade shows the channels. Each measurement is a λ over the taps it names.

const wb = bench('probes');
wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ctl, ws } = wb;

ctl.macro('warmth', { range: [-1, 1], step: 0.05 }).drives('enlarger.y_shift', { gain: -24 });
ws.tile('print').render('out');
ws.tile('parade').scope.parade('out');
ws.tile('density').hist('cmy_film', { bins: 128, channels: 'cmy' });
ws.probe('skin',   [0.30, 0.28, 0.10, 0.12]);
ws.probe('shadow', [0.08, 0.70, 0.10, 0.10]);

ws.tile('probes').table({
  rows: ['skin', 'shadow'],
  cols: { 'L*': ({ out }, pr) => out.crop(pr).lab().mean()[0], 'film D(c)': ({ cmy_film }, pr) => cmy_film.crop(pr).mean()[0] },
});
ws.tile('b* vs warmth').plot.line({ x: wb.axis('macro.warmth', [-1, 1, 0.5]), y: ({ out }) => out.lab().mean()[2], taps: ['out'] });

log(JSON.stringify(ws.tableData(ws.tiles.get('probes'))));
log(JSON.stringify(ws.lineData(ws.tiles.get('b* vs warmth')).pts.map((a) => [a[0], +a[1].toFixed(2)])));
use(wb);
