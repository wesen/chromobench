// 03 · Fork a pipeline
// A variant is a fork. Unchanged stages are shared and cached, so a comparison costs only what differs.

const wb = bench('forks');
const base  = wb.pipe('portra').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();

const cine  = base.fork('cine print').paper('kodak_2383');                       // replace a stage
const noDir = base.fork('no DIR').set({ 'film_render.dir.active': false });      // overlay parameters
const fuji  = base.fork('Pro 400H').film('fujifilm_pro_400h');                   // replace the film

log(String(base.diff(noDir)));            // what differs, and which stages it reaches

const set = wb.compare({ base, cine, noDir, fuji });
log(String(set.plan()));                  // stage runs shared between the variants

const r = set.eval('out', { w: 192 });    // one render per variant
log('mean ΔE2000 against base:', JSON.stringify(r.table('dE2000', { ref: 'base' })));
show(r);                                  // the pictures, side by side
use(wb);
