// 07 · One slider, several paths
// A macro is a gesture that drives parameters at once. It lives in the 'macros' layer, so the base values
// underneath stay untouched, Layers shows it, Clear removes it, and ctl.why(path) explains every contribution.

const wb = bench('macros');
wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ctl } = wb;
const { STOPS } = units;

const warmth = ctl.macro('warmth', { range: [-1, 1], step: 0.05, value: 0 })
  .drives('enlarger.y_shift', { gain: -24 })                       // a plain gain
  .drives('enlarger.c_shift', { gain: 8, curve: 'easeIn' })        // shaped: small near zero, full at the ends
  .drives('enlarger.m_shift', { map: [[-1, 6], [0, 0], [1, -3]] }); // a piecewise-linear map

const stops = ctl.macro('print stops', { range: [-3, 3], step: 1 / 6, unit: STOPS })
  .drives('enlarger.print_exposure', { stops: 1 });                // one unit is one stop of light

warmth.value = 0.5;
log(String(ctl.why('enlarger.y_shift')));                          // base, then each layer's contribution
log(String(ctl.why('enlarger.c_shift')));
log(String(ctl.why('enlarger.m_shift')));

ctl.scheme('macros', (s) => s.group('Print').add(ctl.slider(warmth)).add(ctl.slider(stops).widget('dial')));
ctl.use('macros');
use(wb);
