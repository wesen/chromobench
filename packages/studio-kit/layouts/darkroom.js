// darkroom: one enlarger-first screen (guide §8.2; CHB-035 §33 arrangement 2, the one to try first with the
// photographer). The film strip runs down the left, the print fills the centre, the enlarger is on the right: the
// main exposure and the printer lights as rows of the darkroom stack with their controls, every burn, dodge, flash
// and contrast mask a row beside them, ordered by kind. Below it, a collapsed digital palette: the print stage's
// layers, labelled as acting after the print. The module shows the stages and says so. CHB-048: a "Before the film"
// palette for camera files (the white balance in scene light, the film, the scene's layers); a negative says why it has
// none. The paper and its grade are medium presets from the data pack.

/** no open frame selected: the panels that only show a frame's settings are not drawn (CHB-031 8iv8) */
const noFrame = cb => s => !cb.sel.doc(s);

export default {
  id: 'darkroom',
  label: 'Darkroom first',
  description: 'One screen: strip, print, enlarger, and a digital palette after the print',
  build: (ck, cb) => {
    const { stack, looks } = cb.kits;
    return cb
      .studio('Chromobench')
      .theme('craftkit')
      // Settings ▸ Copy / Paste / Sync Settings (Lightroom's), from the looks kit
      .use(looks.kit)
      .menus(...cb.menus.standard(), looks.menus.settings())
      .module(
        ck
          .module('main', { label: 'Darkroom', stages: ['scene', 'darkroom', 'print'] })
          .left(ck.dock.column({ width: 200 }, cb.views.strip({ vertical: true }), cb.panels.history().hidden(noFrame(cb))))
          .center(
            cb.viewer(s => cb.sel.frame(s)?.print() ?? null, {
              tools: ['probe', 'test-strip', 'ring-around', 'white-balance', ...stack.maskTools],
              compare: { before: s => cb.sel.frame(s)?.initial().print() ?? null },
              hud: cb.hud.readout(),
            }),
          )
          .right(
            ck.dock.column(
              { width: 300 },
              // no frame: one empty-state text in the Enlarger panel (it says how to open photos), the panels below
              // it are not drawn (CHB-031 8iv8)
              stack.panels.enlarger(),
              // before the film (CHB-048, D2): a camera file's white balance and its scene layers; a negative: why not
              ck.panel.define(
                'before-film',
                { title: 'Before the film' },
                cb.ifFrame(
                  cb.views.whiteBalance(),
                  // the film the scene is shot on (a medium preset from the data pack, CHB-048 LOOK-6) and the scene's layers
                  ck.when(s => cb.sel.isPhoto(s), ck.column({}, cb.arg('stages.film.medium.stock'), stack.views.layers('scene', { density: 'compact' }))),
                ),
              ).hidden(noFrame(cb)),
              ck.panel.define('paper', { title: 'Paper' }, cb.ifFrame(cb.arg('stages.darkroom.medium.paper'), cb.preset('grade'))).hidden(noFrame(cb)),
              // the digital zone: the print stage, after the darkroom; closed until it is wanted
              ck.panel.define('digital', { title: 'Digital (after the print)', open: false }, stack.views.layers('print', { density: 'compact' })).hidden(noFrame(cb)),
              stack.panels.params().hidden(noFrame(cb)),
              stack.panels.masks().hidden(noFrame(cb)),
              cb.panels.approvals().hidden(noFrame(cb)),
            ),
          )
          .keys({ ...cb.keys.darkroom }),
      );
  },
};
