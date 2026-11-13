// darkroom: one enlarger-first screen (guide §8.2). The film strip runs down the left, the print fills the centre,
// the enlarger is on the right. No library module: the roll's frames are the only choice that matters here.

/** no open frame selected: the panels that only show a frame's settings are not drawn (CHB-031 8iv8) */
const noFrame = cb => s => !cb.recipe(s);

export default {
  id: 'darkroom',
  label: 'Darkroom first',
  description: 'One screen: strip, print, enlarger',
  build: (ck, cb) =>
    cb
      .studio('Chromobench')
      .theme('craftkit')
      .left(ck.dock.column({ width: 200 }, cb.view.strip({ vertical: true }), cb.panel.history().hidden(noFrame(cb))))
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
          // no frame: one empty-state text in the Enlarger panel, and the panels below it are not drawn (CHB-031
          // 8iv8: the text twice and an empty Exposures panel); with photos it asks for one, without any it says how
          // to open them. The mode select shows a frame saved in normalised mode (before CHB-031) why its Time and
          // Aperture are missing, and switches it (CHB-031 F17, F19).
          ck.panel(
            'enlarger',
            { title: 'Enlarger' },
            ck.when(
              s => !!cb.recipe(s),
              ck.column(
                {},
                cb.arg('print.enlarger.mode'),
                cb.arg('print.enlarger.time_s').testStrip({ step: '1/3 st' }),
                cb.arg('print.enlarger.fstop'),
                cb.arg('print.enlarger.filtration'),
                cb.arg('print.lights.logH').pad(),
              ),
              ck.text(s => (cb.library(s).length ? 'Select a photo to print it.' : 'No photos yet: File ▸ Open Files… (Ctrl+O), or drop them here.'), { dim: true, wrap: true }),
            ),
          ),
          ck.panel('paper', { title: 'Paper' }, cb.ifFrame(cb.arg('print.paper'), cb.arg('print.grade'))).hidden(noFrame(cb)),
          cb.panel.exposures().hidden(noFrame(cb)),
          cb.panel.approvals().hidden(noFrame(cb)),
        ),
      )
      .keys('module:*', { ...cb.keys.darkroom }),
};
