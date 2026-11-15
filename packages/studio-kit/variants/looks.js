// looks: the classic Library plus a Print module built around cb.kits.looks (CHB-021 guide §8.2) — the looks library
// with print thumbnails on the left, the print (with the picked look previewed, compared with a chosen source) or the
// survey of several looks in the centre (N), the look's parameters, Amount with its result in darkroom units, the
// diff, sync groups and the look batches on the right. The roll kit is installed so a look can go to a roll's
// unedited frames. Receives ck and cb; imports only sibling variant parts.
import { libraryModule } from './classic.js';

export default {
  id: 'looks',
  label: 'Looks',
  description: 'Presets and looks: preview, Amount, survey, diff, apply to selection, roll or library',
  build: (ck, cb) => {
    const looks = cb.kits.looks;
    return cb
      .studio('Chromobench')
      .theme('craftkit')
      .use(cb.kits.roll.kit)
      .use(looks.kit)
      .menus(...cb.menus.standard(), looks.menus.looks())
      .module(libraryModule(ck, cb))
      .module(
        ck
          .module('print', { label: 'Print', key: 'D', txOpts: (st) => ({ channel: cb.current(st) }) })
          .left(ck.dock.column({ width: 300 }, looks.library({ size: 96 }), cb.panel.snapshots(), cb.panel.history()))
          .center(
            ck.match(
              (st) => st.looksView.mode,
              {
                print: cb.viewer(looks.print, { id: 'main', views: true, compare: { before: looks.before }, tools: ['probe', 'test-strip', 'ring-around'], hud: cb.hud.readout() }),
                survey: looks.survey({ size: 200 }),
              },
              { of: ['print', 'survey'] },
            ),
          )
          .right(
            ck.dock.column(
              { width: 320 },
              looks.params(),
              looks.amount(),
              looks.diff(),
              looks.compare(),
              looks.card(),
              cb.panel.approvals(),
              ck.panel.define('enlarger', { title: 'Enlarger' }, cb.ifFrame(cb.arg('print.enlarger.time_s'), cb.arg('print.lights.logH').pad(), cb.arg('print.grade'), cb.arg('print.paper'))),
              looks.groups(),
              looks.presets(),
            ),
          )
          .bottom(ck.dock.column({ width: 124 }, cb.view.strip({ id: 'strip-print' })))
          .keys({ ...cb.keys.views, ...cb.keys.darkroom, ...looks.keys }),
      );
  },
};
