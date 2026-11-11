// darkroom: one enlarger-first screen (guide §8.2). The film strip runs down the left, the print fills the centre,
// the enlarger is on the right. No library module: the roll's frames are the only choice that matters here.
export default {
  id: 'darkroom',
  label: 'Darkroom first',
  description: 'One screen: strip, print, enlarger',
  build: (ck, cb) =>
    cb
      .studio('Chromobench')
      .theme('chromogen')
      .left(ck.dock.column({ width: 200 }, cb.view.strip({ vertical: true }), cb.panel.history()))
      .center(
        cb.viewer(s => cb.frame(s)?.print() ?? null, {
          tools: ['probe', 'test-strip', 'ring-around', 'mask-brush', 'mask-gradient'],
          compare: { before: s => cb.frame(s)?.initial().print() ?? null },
          hud: cb.hud.readout(),
        }),
      )
      .right(
        ck.dock.column(
          { width: 300 },
          ck.panel(
            'enlarger',
            { title: 'Enlarger' },
            cb.arg('print.enlarger.time_s').testStrip({ step: '1/3 st' }),
            cb.arg('print.enlarger.fstop'),
            cb.arg('print.enlarger.filtration'),
            cb.arg('print.lights.logH').pad(),
          ),
          ck.panel('paper', { title: 'Paper' }, cb.arg('print.paper'), cb.arg('print.grade')),
          cb.panel.exposures(),
          cb.panel.approvals(),
        ),
      )
      .keys('module:*', { ...cb.keys.darkroom }),
};
