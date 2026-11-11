// 14 · Lenses
// A lens is a λ over a tile's picture: it recolours, marks or measures it, and may add a legend. Built-in:
// clip (clipped highlights/shadows), zones (L* in Zone System steps), diff, split, falseDensity. Your own take
// parameters, and those become ordinary paths (so they get sliders).

const wb = bench('lenses');
wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
const { ctl, ws } = wb;

ws.tile('p1').render('out').lens(lens.clip());
log('clip:', ws.renderImg(ws.tiles.get('p1'), { max: 320 }).overlays.map((o) => o.legend).join(' | '));

const magenta = lens('magentaCast', {
  params: { floor: p.slider({ min: 0, max: 20, value: 6, unit: 'ΔE' }) },
  eval: (img, P) => img.lab().map(([L, a, b]) => (a > P.floor && Math.abs(b) < a / 2 ? [L, 3 * a, b] : [L, 0, 0])).toRGB(),   // keep only the magenta-ish pixels, exaggerated
  overlay: (img, P) => ({ legend: `a* above ${P.floor}` }),
});

ws.tile('p2').render('out').lens(magenta).lens(lens.zones());          // lenses chain
log('chain:', ws.renderImg(ws.tiles.get('p2'), { max: 200 }).overlays.map((o) => o.legend).join(' | '));
ctl.scheme('lens', (s) => s.group('magentaCast').add(ctl.slider('lens.magentaCast.floor')));   // the lens parameter is a path now
ctl.use('lens');
ws.tile('p2').lens('magentaCast').off();                               // lenses switch off without being removed
ws.dock.set(ws.dock.row([0.5, 'p1'], [0.5, 'p2']));
use(wb);
