// controls.js — three ways to hold the same parameters.
//   engineer   every parameter of the model, generated from the parameter table (ctl.fromSpec)
//   darkroom   what a printer reaches for: exposure in stops, filtration, paper grade, surface
//   colourist  warmth, tint, saturation, contrast, a colour-balance pad, texture
// A scheme only arranges controls; it owns no state. Switch between them in the Controls view
// (or ctl.use('engineer')) and the values stay where they are. Controls can also be docked as tiles.

const { CC, STOPS } = units;
const GRADE = [[0, 0.7], [1, 0.82], [2, 1], [3, 1.2], [4, 1.45], [5, 1.8]];   // paper grade to morph.gamma
const signed = (d, u = '') => (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + u;

// ---- macros: a gesture that drives several parameters ----------------------------------------
// They live in the 'macros' layer, so Layers shows them, Clear removes them, and ctl.why(path) explains them.
export function macros(wb) {
  const { ctl } = wb;
  const stops = ctl.macro('print stops', { range: [-3, 3], step: 1 / 6, unit: STOPS })
    .drives('enlarger.print_exposure', { stops: 1 });                  // +1 stop of light on the paper: a darker print

  const warmth = ctl.macro('warmth', { range: [-1, 1], step: 0.05 })
    .drives('enlarger.y_shift', { gain: -24 })                         // less yellow filtration warms the print
    .drives('enlarger.c_shift', { gain: 8, curve: 'easeIn' });         // a little cyan keeps the shadows from going orange

  const tint = ctl.macro('tint', { range: [-1, 1], step: 0.05 })
    .drives('enlarger.m_shift', { gain: -16 });                        // less magenta filtration: more magenta in the print

  const saturation = ctl.macro('saturation', { range: [-1, 1], step: 0.05 })
    .drives('film_render.dir.amount', { gain: 0.5 })                   // DIR couplers: inter-layer inhibition
    .drives('enlarger.y_shift', { map: [[-1, -0.7], [0, 0], [1, 2.3]] })   // trims that keep the greys neutral
    .drives('enlarger.m_shift', { map: [[-1, -0.4], [0, 0], [1, -0.5]] });

  const contrast = ctl.macro('contrast', { range: [-1, 1], step: 0.05 })
    .drives('film_render.gamma', { gain: 0.2 });                       // the negative's contrast; Paper grade is the print's

  const grade = ctl.macro('paper grade', { range: [0, 5], step: 0.5, value: 2 })
    .apply((g, P) => (g === 2 ? {} : {                                 // grade 2 is the paper as profiled; nothing to say
      'print_render.morph.active': op.set(true),
      'print_render.morph.gamma': op.set(interp(GRADE, g)),
      'enlarger.print_exposure': P.enlarger.normalize ? op.keep : op.stops(0.25 * (g - 2)),   // harder paper needs a little more light
    }))
    .read((P) => (P.print_render.morph.active ? interp.inverse(GRADE, P.print_render.morph.gamma) : 2));   // follows the parameters

  const rolloff = ctl.macro('highlight roll-off', { range: [0, 1], step: 0.05 })
    .apply((r) => (r === 0 ? {} : { 'print_render.morph.active': op.set(true), 'print_render.morph.fast': op.set(interp([[0, 1], [1, 0.6]], r)) }));

  return { stops, warmth, tint, saturation, contrast, grade, rolloff };
}

// ---- 1. engineer ------------------------------------------------------------------------------
export function engineer(wb) {
  wb.ctl.scheme('engineer', wb.ctl.fromSpec());
}

// ---- 2. darkroom ------------------------------------------------------------------------------
export function darkroom(wb, m) {
  const { ctl } = wb;
  const filter = (path, name) => ctl.slider(path).label(name).unit(CC).range(-40, 40).step(1).detents([0]).fmt(signed(0, ' CC'));
  ctl.scheme('darkroom', (s) => {
    s.group('Exposure')
      .add(ctl.slider(m.stops).widget('dial').label('Print exposure'))          // a tick ruler: drag sideways, wheel, arrow keys
      .add(ctl.slider('camera.ev').label('Film exposure').fmt(signed(2, ' EV')));
    s.group('Filtration')
      .add(filter('enlarger.y_shift', 'Yellow'))
      .add(filter('enlarger.m_shift', 'Magenta'))
      .add(filter('enlarger.c_shift', 'Cyan'));
    s.group('Paper')
      .add(ctl.slider(m.grade).widget('stepper').label('Grade'))
      .add(ctl.choice('surface', { gloss: 0.3, lustre: 1.2, matte: 2.4 }).drives('print_render.glare'))
      .add(ctl.slider(m.rolloff).label('Highlight roll-off'));
    s.group('Local')
      .add(ctl.button('dodge and burn').opens('mask editor').requires('mask'));  // needs a graph with a mask node (examples/05)
  });
}

// ---- 3. colourist -----------------------------------------------------------------------------
export function colourist(wb, m) {
  const { ctl } = wb;
  ctl.scheme('colourist', (s) => {
    s.group('Colour')
      .add(ctl.slider(m.warmth).label('Warmth').detents([0]))
      .add(ctl.slider(m.tint).label('Tint').detents([0]))
      .add(ctl.slider(m.saturation).label('Saturation').detents([0]));
    s.group('Tone')
      .add(ctl.slider(m.stops).label('Density').fmt(signed(2, ' stops')))
      .add(ctl.slider(m.contrast).label('Contrast').detents([0]));
    s.group('Balance')
      .add(ctl.wheel('colour balance').apply(([x, y]) => ({           // a square pad: right is warmer, up is more magenta
        'enlarger.y_shift': op.add(-12 * x),
        'enlarger.m_shift': op.add(-10 * y),
      })));
    s.group('Texture')
      .add(ctl.toggle('film_render.grain.active'))
      .add(ctl.slider('film_render.grain.amount').disabledWhen((P) => !P.film_render.grain.active))
      .add(ctl.slider('film_render.grain.size_um').disabledWhen((P) => !P.film_render.grain.active))
      .add(ctl.toggle('film_render.halation.active'))
      .add(ctl.slider('film_render.halation.amount').disabledWhen((P) => !P.film_render.halation.active));
  });
}
