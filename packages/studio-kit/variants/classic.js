// classic: Lightroom's layout (guide §8.1). Modules across the top (Library G, Print D, Output), panels left and
// right, the film strip of print thumbnails at the bottom. Receives ck and cb; imports only sibling variant parts.
import { finishMenu, finishModule } from './finish-module.js';

/** the darkroom's tools as buttons (each is also a key: I, T, R, \) */
export const toolsPanel = ck =>
  ck.panel(
    'tools',
    { title: 'Tools' },
    ck.row(
      { class: 'cb-tools' },
      ck.ui.command('tool.probe', { text: 'Densitometer', small: true }),
      ck.ui.command('tool.test-strip', { text: 'Test strip', small: true }),
      ck.ui.command('tool.ring-around', { text: 'Ring-around', small: true }),
      ck.ui.command('view.beforeAfter', { text: 'Before / after', small: true }),
    ),
  );

/** the Print module, shared with lab */
export const printModule = (ck, cb, o = {}) => m =>
  m
    .label('Print')
    .key('D')
    .txOpts(s => ({ channel: cb.current(s) }))
    .left(ck.dock.column({ width: 236 }, cb.panel.navigator({ id: 'navigator-print' }), cb.panel.snapshots(), cb.panel.history()))
    .center(
      cb.viewer(s => cb.frame(s)?.print() ?? null, {
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
export const libraryModule = (ck, cb) => m =>
  m
    .label('Library')
    .key('G')
    .left(ck.dock.column({ width: 236 }, cb.panel.navigator(), cb.panel.library()))
    .center(ck.column({ grow: 1 }, cb.bar.filter(), cb.views.library()))
    .right(ck.dock.column({ width: 260 }, cb.panel.metadata()))
    .bottom(ck.dock.column({ width: 124 }, cb.view.strip()))
    .keys({ ...cb.keys.cull, ...cb.keys.libraryModes });

/** the Roll module, shared with roll: rolls and their setup left, the contact sheet in the centre, the balance bar and analysis right */
export const rollModule = (ck, cb) => m => {
  const roll = cb.kits.roll;
  return m
    .label('Roll')
    .key('Mod+Alt+R')
    .left(ck.dock.column({ width: 300 }, roll.library(), roll.setup()))
    .center(roll.contactSheet({ size: 180 }))
    .right(ck.dock.column({ width: 320 }, roll.balanceBar(), roll.inspector(), cb.panel.history({ id: 'history-roll' })))
    .keys(roll.cullKeys);
};

/** the Roll menu: new roll, analysis, first print, reference and match */
export const rollMenu = m =>
  m.menu('Roll', ['roll.fromFrames', 'roll.analyse', 'roll.firstPrint', '-', 'roll.setReference', 'roll.matchToReference', 'roll.clearMatch', '-', 'roll.contact.mode', 'roll.cull.sweep', 'roll.exportSheet']);

export const menus = m =>
  m
    .menu('File', [
      // the host's actions (CHB-027); hidden where the host has none (the dev host, tests)
      'file.open', 'file.openFolder', 'file.reopenFolder',
      { label: 'Open As', items: ['file.openAs.auto', 'file.openAs.photo', 'file.openAs.negative', '-', 'file.dust'] },
      '-', 'file.export', 'file.saveRecipe', '-', 'app.palette',
    ])
    .menu('Edit', ['edit.undo', 'edit.redo', '-', 'proposal.approveAll'])
    .menu('Frame', ['frame.pick', 'frame.reject', 'frame.unflag', '-', 'frame.reopenAsPhoto', 'frame.reopenAsNegative', 'frame.remove', '-', 'frame.next', 'frame.previous', '-', 'snapshot.new', 'probe.pin', 'exposure.add', 'print.applyToSelection'])
    .menu('View', ['view.beforeAfter', 'view.sideBySide', '-', 'view.fit', 'view.zoomIn', 'view.zoomOut', '-', 'view.layout', 'app.theme'])
    .menu('Window', ['view.hideSides', 'view.toggleLeft', 'view.toggleRight', 'view.toggleBottom', 'workspace.reset'])
    .menu('Help', ['app.shortcuts', 'app.diagnostics']);

export default {
  id: 'classic',
  label: 'Classic',
  description: 'Lightroom-like modules: Library, Roll, Print, Output',
  build: (ck, cb) => {
    const s = cb.studio('Chromobench').theme('craftkit').use(cb.kits.roll.kit).use(cb.kits.finish.kit).menus(m => finishMenu(rollMenu(menus(m))));
    s.module('library', libraryModule(ck, cb));
    s.module('roll', rollModule(ck, cb));
    s.module('print', printModule(ck, cb));
    // CHB-022: crop, straighten, spot removal and finishing tones after the print
    s.module('finish', finishModule(ck, cb, { tones: false }));
    s.module('assistant', cb.kits.chat.module());
    s.module('output', m =>
      m
        .label('Output')
        .key('Mod+Shift+E')
        .center(cb.view.grid({ id: 'picks', source: st => cb.visible(st).filter(f => f.flag === 'pick') }))
        .right(ck.dock.column({ width: 260 }, cb.panel.output()))
        .bottom(ck.dock.column({ width: 124 }, cb.view.strip({ id: 'strip-output' }))),
    );
    return s;
  },
};
