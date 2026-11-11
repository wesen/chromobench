// 02 · Slots and engines
// A slot holds engines of different fidelity. Tap demand decides which one runs: the fast fused film engine
// when nobody reads a tap in the middle of the pipeline, the staged one the moment a tile or a stage does.

const wb = bench('engines');
const rig = wb.pipe('default').scene('chart').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();

log(String(rig.slots));                       // what each slot offers

rig.swap('paper', engines.paper.measured);    // by value …
rig.engine('scan', 'spectral');               // … or by name. (spectral is a 65³ lattice stand-in for the per-pixel spectral scan)
rig.engine('film', 'auto');                   // the default: decided by demand
log(String(rig.explain()));

wb.ws.tile('neg').render('cmy_film');         // a tile that needs a tap in the middle
log('with a tile on cmy_film:', rig.explain().film.engine, '·', rig.explain().film.why);

wb.ws.tile('neg').remove();
log('tile removed:           ', rig.explain().film.engine, '·', rig.explain().film.why);   // demand is recomputed on every change

rig.engine('paper', 'cdf'); rig.engine('scan', 'lut33');
use(wb);
