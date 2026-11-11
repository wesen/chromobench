// 09 · Lambda macros, read-back, calibration
// drives() is declarative. apply() takes a function: any number of paths, computed from the macro value and
// the parameters below it. read() runs the other way, so the slider follows when you change the parameters directly.
// calibrate() renders the picture at several slider positions, measures it and stores a correction, so a "warmth"
// slider moves b* evenly instead of whichever way the filtration happens to.

const wb = bench('lambda macros');
wb.pipe('default').scene('chart').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ctl } = wb;

const GRADE = [[0, 0.7], [1, 0.82], [2, 1], [3, 1.2], [4, 1.45], [5, 1.8]];     // paper grade to print gamma

const grade = ctl.macro('paper grade', { range: [0, 5], step: 0.5, value: 2 })
  .apply((g, P) => ({
    'print_render.morph.active': op.set(true),
    'print_render.morph.gamma': op.set(interp(GRADE, g)),
    'enlarger.print_exposure': P.enlarger.normalize ? op.keep : op.stops(0.25 * (g - 2)),   // harder paper needs more light
  }))
  .read((P) => interp.inverse(GRADE, P.print_render.morph.gamma));

wb.params.set('print_render.morph.gamma', 1.2);        // change the parameter directly …
log('the slider followed to grade', grade.value);      // … and the macro read it back

const warmth = ctl.macro('warmth', { range: [-1, 1], step: 0.05 }).drives('enlarger.y_shift', { gain: -24 });
const t0 = performance.now();
const cal = await warmth.calibrate({ measure: ({ out }) => out.lab().mean()[2], scene: 'chart', samples: 5 });
log(String(cal.report()), Math.round(performance.now() - t0) + ' ms');   // b* of the print at each slider position
cal.apply();                                           // from now on the slider is shaped by what was measured
log('stale after calibrating?', warmth.stale);         // turns true as soon as anything the measurement depends on changes

ctl.scheme('lambda', (s) => s.group('Macros').add(ctl.slider(grade).widget('stepper')).add(ctl.slider(warmth)));
ctl.use('lambda');
use(wb);
