// 19 · Diagnostics
// Wrong calls get a diagnosis, not a stack trace: a code, what was wrong, the nearest valid names and a fix.
// Each line below is a real failure caught on purpose; read what the API says. Errors you do not catch appear
// in the Console with the file and line, and in the editor's gutter.

const wb = bench('diagnostics');
const rig = wb.pipe('default').scene('chart').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ctl, ws } = wb;
const tryit = (what, f) => { try { f(); warn('(no error)', what); } catch (e) { log('— ' + what + '\n' + e.message + '\n'); } };

tryit('a tap that is a typo',          () => rig.at('cmy_flm'));
tryit('a parameter that is a typo',    () => ctl.slider('enlarger.yshift'));
tryit('a member that does not exist',  () => ws.tiel);
tryit('an axis that is not a path',    () => wb.axis('paper', ['kodak_2383']));
tryit('a stock id that is a typo',     () => wb.axis('print', ['kodak_portra_endra']));
tryit('two macros that both set one value', () => {
  ctl.macro('g2').apply((g) => ({ 'print_render.morph.gamma': op.set(1 + 0.2 * g) }));
  ctl.macro('mood').apply((m) => ({ 'print_render.morph.gamma': op.set(1 - 0.1 * m) }));
});
tryit('a control that needs a capability the chain lacks', () => ctl.button('dodge').requires('mask').bind(rig));
tryit('a tile created inside an eval λ', () => {
  const bad = lens('bad', { eval: (img) => { ws.tile('t'); return img; } });
  ws.tile('zz').render('out').lens(bad);
  ws.renderImg(ws.tiles.get('zz'), { max: 64 });
});
use(wb);
