// classic: Lightroom's layout (guide §8.1). Modules across the top (Library G, Print D, Output), panels left and
// right, the film strip of print thumbnails at the bottom. Receives ck and cb; imports only sibling variant parts.
import { finishModule } from './finish-module.js';

/** the darkroom's tools as buttons (each is also a key: I, T, R, \) */
export const toolsPanel = ck =>
  ck.panel.define(
    'tools',
    { title: 'Tools' },
    ck.row(
      { class: 'cb-tools' },
      ck.ui.button({ run: 'tool.probe', text: 'Densitometer', small: true }),
      ck.ui.button({ run: 'tool.test-strip', text: 'Test strip', small: true }),
      ck.ui.button({ run: 'tool.ring-around', text: 'Ring-around', small: true }),
      ck.ui.button({ run: 'view.beforeAfter', text: 'Before / after', small: true }),
    ),
  );

/** the Print module, shared with lab */
export const printModule = (ck, cb, o = {}) =>
  ck
    .module('print', { label: 'Print', key: 'D', txOpts: s => ({ channel: cb.sel.current(s) }) })
    .left(ck.dock.column({ width: 236 }, cb.panel.navigator({ id: 'navigator-print' }), cb.panel.snapshots(), cb.panel.history()))
    .center(
      cb.viewer(s => cb.sel.frame(s)?.print() ?? null, {
        id: 'main',
        views: true,
        compare: true,
        tools: ['probe', 'test-strip', 'ring-around', 'mask-ellipse', 'mask-gradient', 'mask-brush'],
        hud: cb.hud.readout(),
      }),
    )
    .right(ck.dock.column({ width: 300 }, toolsPanel(ck), cb.panel.densitometer(), cb.panel.controls('darkroom'), cb.panel.exposures(), cb.panel.approvals(), ...(o.extraRight ?? [])))
    .bottom(ck.dock.column({ width: 124 }, cb.view.strip({ id: 'strip-print' })))
    .keys({ ...cb.keys.views, ...cb.keys.darkroom });

/** the Library module, shared with lab */
export const libraryModule = (ck, cb) =>
  ck
    .module('library', { label: 'Library', key: 'G' })
    .left(ck.dock.column({ width: 236 }, cb.panel.navigator(), cb.panel.library()))
    .center(ck.column({ grow: 1 }, cb.bar.filter(), cb.views.library()))
    .right(ck.dock.column({ width: 260 }, cb.panel.metadata()))
    .bottom(ck.dock.column({ width: 124 }, cb.view.strip()))
    .keys({ ...cb.keys.cull, ...cb.keys.libraryModes });

/** the Roll module, shared with roll: rolls and their setup left, the contact sheet in the centre, the balance bar and analysis right */
export const rollModule = (ck, cb) => {
  const roll = cb.kits.roll;
  return ck
    .module('roll', { label: 'Roll', key: 'Mod+Alt+R' })
    .left(ck.dock.column({ width: 300 }, roll.library(), roll.setup()))
    .center(roll.contactSheet({ size: 180 }))
    .right(ck.dock.column({ width: 320 }, roll.balanceBar(), roll.inspector(), cb.panel.history({ id: 'history-roll' })))
    .keys(roll.cullKeys);
};

export default {
  id: 'classic',
  label: 'Classic',
  description: 'Lightroom-like modules: Library, Roll, Print, Output',
  build: (ck, cb) =>
    cb
      .studio('Chromobench')
      .theme('craftkit')
      .use(cb.kits.roll.kit)
      .use(cb.kits.finish.kit)
      .menus(...cb.menus.standard(), cb.kits.roll.menus.roll(), cb.kits.finish.menus.finish())
      .module(libraryModule(ck, cb))
      .module(rollModule(ck, cb))
      .module(printModule(ck, cb))
      // CHB-022: crop, straighten, spot removal and finishing tones after the print
      .module(finishModule(ck, cb, { tones: false }))
      .module(cb.kits.chat.module())
      .module(
        ck
          .module('output', { label: 'Output', key: 'Mod+Shift+E' })
          .center(cb.view.grid({ id: 'picks', source: st => cb.sel.visible(st).filter(f => f.flag === 'pick') }))
          .right(ck.dock.column({ width: 260 }, cb.panel.output()))
          .bottom(ck.dock.column({ width: 124 }, cb.view.strip({ id: 'strip-output' }))),
      ),
};
