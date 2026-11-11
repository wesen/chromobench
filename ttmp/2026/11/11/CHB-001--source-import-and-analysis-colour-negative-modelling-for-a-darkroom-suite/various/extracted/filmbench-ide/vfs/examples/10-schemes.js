// 10 · A darkroom scheme, and others over the same state
// The same parameters can be held by different control schemes. A scheme owns no state, so you can switch
// (or show two at once as tiles) and nothing moves. ctl.fromSpec() makes the engineer's scheme from the
// parameter table; this makes a printer's by hand. controls.js in the studio has the full version.

const wb = bench('schemes');
wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ctl, ws } = wb;
const { CC, STOPS } = units;

const stops = ctl.macro('print stops', { range: [-3, 3], step: 1 / 6, unit: STOPS }).drives('enlarger.print_exposure', { stops: 1 });
const grade = ctl.macro('paper grade', { range: [0, 5], step: 0.5, value: 2 })
  .apply((g) => (g === 2 ? {} : { 'print_render.morph.active': op.set(true), 'print_render.morph.gamma': op.set(interp([[0, 0.7], [2, 1], [5, 1.8]], g)) }));

const darkroom = ctl.scheme('darkroom', (s) => {
  s.group('Enlarger')
    .add(ctl.slider(stops).widget('dial').label('Exposure'))
    .add(ctl.slider('enlarger.y_shift').widget('dial').label('Yellow').unit(CC));
  s.group('Paper')
    .add(ctl.slider(grade).widget('stepper'))
    .add(ctl.choice('surface', { gloss: 0.3, lustre: 1.2, matte: 2.4 }).drives('print_render.glare'))    // a named choice sets a number
    .add(ctl.macro('highlight roll-off', { range: [0, 1] }).drives('print_render.morph.fast', { map: [[0, 1], [1, 0.6]] }).slider());
  s.group('Local')
    .add(ctl.button('dodge and burn').opens('mask editor').requires('mask'));    // a capability the plain chain lacks (see example 05)
});
ctl.scheme('engineer', ctl.fromSpec());                  // every parameter, straight from the table

ctl.use('darkroom');
log(String(darkroom.audit()));                           // every mapped value inside its range? every requirement met?
log(ctl.schemes().join(' · '), '·', ctl.scheme('engineer').controls().length, 'controls in engineer');

ws.tile('print').render('out');
ws.tile('darkroom').controls('darkroom');                // a scheme as a tile …
ws.tile('engineer').controls('engineer');                // … and another one next to it: they edit the same state
use(wb);
