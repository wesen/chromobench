// 20 · A paper shootout study
// Everything together: a pipeline, the darkroom controls and the zone fragment imported from the studio's files,
// a workspace of mosaic + curves + scopes, and a question for the agent. The bench saves to plain data.

import { macros, darkroom } from '../controls.js';
import { zoneSystem } from '../lib/zone.js';

const wb = bench('paper shootout');
const { ctl, ws } = wb;
const { row, col } = ws.dock;

// 1 · pipeline
wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();

// 2 · controls and fragment (the studio's own files, imported)
ws.probe('skin', [0.30, 0.28, 0.10, 0.12]);
wb.use(zoneSystem);
darkroom(wb, macros(wb));
ctl.use('darkroom');

// 3 · workspace
const papers = wb.axis('print', ['kodak_portra_endura', 'kodak_ultra_endura', 'kodak_supra_endura', 'kodak_endura_premier', 'kodak_ektacolor_edge', 'fujifilm_crystal_archive_typeii', 'kodak_2383']);
ws.tile('controls').controls('darkroom');
ws.tile('print').render('out').lens(lens.clip());
ws.tile('parade').scope.parade('out');
ws.tile('shootout').mosaic({
  cols: papers,
  rows: wb.axis('camera.ev', [-1, 0, 1]),
  cell: (c) => c.render('out'),                     // add .lens(lens.diff({ vs: { print: papers.first }, gain: 4 })) to see each paper's distance from Portra instead
  size: 120,
});
ws.tile('H&D').plot.curves('paper');
ws.dock.set(row([0.2, 'controls'], [0.4, col('print', 'parade')], [0.4, col('shootout', 'H&D')]));
ws.link(['print', 'shootout'], 'probe');

// 4 · the agent
wb.agent({ mode: 'ask', brief: 'Compare papers through their curves: toe, shoulder, Dmax. Use the mosaic; do not only quote numbers.' });
wb.ask('Which paper holds the most shadow detail when the negative is a stop under?');   // opens the Agent view with the question ready to send

// 5 · save
// saved λ sources reload with bench.load(saved, { names the λs close over })
log('saved bench:', JSON.stringify(wb.save()).length, 'bytes');
use(wb);
