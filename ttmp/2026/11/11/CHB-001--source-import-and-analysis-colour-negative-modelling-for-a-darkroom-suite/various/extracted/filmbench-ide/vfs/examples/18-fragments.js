// 18 · Fragments across the planes
// A fragment is a vertical slice through the planes: parameters, macros (control plane), lenses and tiles
// (workspace), a note for the agent, methods on the bench, and decorations of what other fragments added.
// Read lib/zone.js and lib/pushpull.js for the two the studio uses.

import { zoneSystem } from '../lib/zone.js';
import { pushPull } from '../lib/pushpull.js';

const wb = bench('fragments');
wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ctl, ws } = wb;

ws.probe('skin', [0.30, 0.28, 0.10, 0.12]);
wb.use(zoneSystem, pushPull);
wb.zoneSystem.placeSkin(6);                                  // a method the fragment added to the bench
log('zone.target', wb.params.effective('zone.target'), '· zone.probe', wb.params.effective('zone.probe'));

ws.tile('zones').render('out').lens('zones');                // a lens it contributed, by name
log(String(wb.fragments()));
log(ctl.list().filter((c) => c.from).map(String).join(' · '));   // controls that came from fragments
use(wb);
