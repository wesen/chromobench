// 08 · Layers: non-destructive control
// Parameters resolve through layers, in order:  base → look → macros → agent → pin.
// Each layer can be switched off, faded (opacity) and cleared; pin wins over everything.
// A look is a preset; macros are the sliders; agent is where the assistant's changes land.

const wb = bench('layers');
wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ctl } = wb;
const eff = (path) => wb.params.effective(path);

log(String(ctl.layers()));
wb.params.set('enlarger.y_shift', 5);                              // writes the base layer

wb.preset('warm portrait', { kind: 'adjust', desc: 'less yellow, a little more light', ops: {
  'enlarger.y_shift': op.add(-4),                                  // relative to what is below
  'enlarger.print_exposure': op.mul(1.15),
} });
ctl.layer('look').use(wb.preset('warm portrait'));

const warmth = ctl.macro('warmth', { range: [-1, 1], step: 0.05 }).drives('enlarger.y_shift', { gain: -24 });
warmth.value = 0.5;
ctl.pin('enlarger.print_exposure', 1.2);                           // a pin wins over every layer

log(String(ctl.why('enlarger.y_shift')));
log(String(ctl.why('enlarger.print_exposure')));

ctl.layer('macros').off();   log('macros off  → y_shift', eff('enlarger.y_shift'));
ctl.layer('macros').on();    log('macros on   → y_shift', eff('enlarger.y_shift'));
ctl.layer('look').opacity(0.5); log('look at 50% → y_shift', eff('enlarger.y_shift'));
ctl.layer('look').opacity(1);

ctl.scheme('layers', (s) => s.group('Look and macros').add(ctl.slider(warmth)).add(ctl.slider('enlarger.print_exposure')));
ctl.use('layers');
use(wb);       // open the Layers view: the mixer shows what you just built
