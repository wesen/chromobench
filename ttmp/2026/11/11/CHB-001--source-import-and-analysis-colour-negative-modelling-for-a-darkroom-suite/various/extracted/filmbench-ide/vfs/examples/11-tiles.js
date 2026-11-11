// 11 · Attach tiles to taps, dock them
// A tile reads a tap (or is a plot, a table, text or a scheme of controls). Tiles arrange into a dock tree
// of rows, columns and tabs. The Workspace view draws that tree; dragging a tab edits it (one mutation each).

const wb = bench('tiles');
wb.pipe('default').scene('chart').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ctl, ws } = wb;
const { row, col, tabs } = ws.dock;

ctl.scheme('darkroom', (s) => s.group('Print').add(ctl.slider('enlarger.print_exposure')).add(ctl.slider('enlarger.y_shift')));
ws.tile('print').render('out');
ws.tile('neg').render('cmy_film');                       // a density map of the negative (the staged film engine turns on)
ws.tile('curves').plot.curves('paper');
ws.tile('notes').text('Compare the toe of the curves with the shadows of the print.');
ws.tile('controls').controls('darkroom');

ws.dock.set(row([0.2, 'controls'], [0.5, 'print'], [0.3, col('neg', tabs('curves', 'notes'))]));
log(String(ws.describe()));
log(String(wb.pipe('default').explain().film.why));
use(wb);
