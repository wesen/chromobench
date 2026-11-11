// 04 · A custom stage with lambdas
// A new stage between two taps. Three lambdas, three phases:
//   build  once, when its parameters change (bakes tables)
//   eval   per pixel, pure
//   run    once per evaluation; may talk to the outside (notes, measurements)

const wb = bench('bypass');
const rig = wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

const bypass = wb.stage('bleachBypass', {
  from: 'Density', to: 'Density',                       // typed ports: legal wherever a Density flows
  params: {
    amount: p.slider({ min: 0, max: 1,   step: 0.01, value: 0.4, path: 'bypass.amount' }),
    toe:    p.slider({ min: 1, max: 2.2, step: 0.01, value: 1.6, path: 'bypass.toe' }),
  },
  build: (P) => ({ silver: curve1D(256, (d) => 2 * (d / 2) ** P.toe) }),
  eval:  (d, P, B) => { const s = B.silver(mean(d)); return d.map((x) => x + P.amount * (s - x)); },   // retained silver adds equal density to all three dyes
  run:   (ctx) => ctx.note('silver kept: ' + Math.round(100 * ctx.P.amount) + ' %'),
});

rig.insert(bypass, { after: 'cmy_film' });              // insertion points are taps
log('taps  ', rig.taps.join(' · '));
log('film engine:', rig.explain().film.why);            // the stage reads cmy_film, so film runs staged

try { rig.insert(bypass, { after: 'log_e_film' }); } catch (e) { warn(e.message); }   // the type check says no

const ev = rig.eval('out', { w: 320 });
log('notes', ev.notes);
show(ev);
wb.ctl.slider('bypass.amount');                         // the stage's parameters are ordinary paths now
use(wb);
