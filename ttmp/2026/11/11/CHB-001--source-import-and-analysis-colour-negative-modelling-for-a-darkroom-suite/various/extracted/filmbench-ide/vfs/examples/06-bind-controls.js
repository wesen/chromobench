// 06 · Bind a control to a path
// ctl.slider(path) reads the range, unit and kind from the parameter table; narrow it, relabel it, format it.
// A control may narrow its path's range but never widen it: the model is only valid inside the table.
// A scheme arranges controls into groups. The last line shows this bench; switch schemes in the Controls view.

const wb = bench('controls');
wb.pipe('default').scene('chart').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ctl } = wb;
const { CC } = units;

ctl.scheme('basics', (s) => {
  s.group('Exposure')
    .add(ctl.slider('camera.ev'))
    .add(ctl.slider('enlarger.print_exposure'));
  s.group('Film')
    .add(ctl.toggle('film_render.grain.active'))
    .add(ctl.select('camera.method'))
    .add(ctl.segmented('output.gamut'));
  s.group('Filtration')
    .add(ctl.slider('enlarger.y_shift').label('Yellow').unit(CC).range(-40, 40).step(1).detents([0])
      .fmt((v) => (v > 0 ? '+' : '') + v + ' CC'));
});

try { ctl.slider('enlarger.y_shift').range(-90, 90); } catch (e) { warn(e.message); }   // wider than the table: refused, with the real range

log(ctl.schemes().join(', '), '·', ctl.scheme('basics').controls().length, 'controls');
ctl.use('basics');
use(wb);
