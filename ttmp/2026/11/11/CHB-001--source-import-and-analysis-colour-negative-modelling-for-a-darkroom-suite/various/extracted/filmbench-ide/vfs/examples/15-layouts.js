// 15 · Layouts and links as data
// A layout is a function that arranges tiles, so it can create the ones it needs. Links tie tiles together:
// a shared ROI, or a shared probe. Both serialise to plain data (ws.layout.json()), so they save, diff and travel.

const wb = bench('layouts');
wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ws } = wb;
const { row, col } = ws.dock;

ws.probe('skin', [0.30, 0.28, 0.10, 0.12]);
ws.tile('print').render('out');
ws.tile('grain zoom').render('out').zoom(4, { at: 'skin' });         // 4x on a probe: grain wants pixels
ws.tile('paper curves').plot.curves('paper');
ws.tile('histogram').hist('out', { bins: 64 });

ws.layout('overview', () => ws.dock.set(row([0.6, 'print'], [0.4, col('paper curves', 'histogram')])));
ws.layout('grain',    () => ws.dock.set(row([0.55, 'print'], [0.45, col('grain zoom', 'histogram')])));
log(ws.layout.list().join(', '));

ws.layout.use('grain');
log(String(ws.describe()));
log(JSON.stringify(ws.layout.json()).slice(0, 300));                  // the layout as data

ws.link(['print', 'grain zoom'], 'roi');                              // drag a region on one, the other follows
ws.link('*', 'probe');                                                // every tile shares the probes
log(JSON.stringify(ws.link.list()));
use(wb);       // Layout ▾ in the Workspace toolbar switches between overview and grain
