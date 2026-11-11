// classic: Lightroom's layout (guide §8.1). Modules across the top (Library G, Print D, Output), panels left and
// right, the film strip of print thumbnails at the bottom. Receives ck and cb; imports nothing.

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
    .right(ck.dock.column({ width: 300 }, cb.panel.densitometer(), cb.panel.controls('darkroom'), cb.panel.exposures(), cb.panel.approvals(), ...(o.extraRight ?? [])))
    .bottom(cb.view.strip({ id: 'strip-print' }))
    .keys({ ...cb.keys.views, ...cb.keys.darkroom });

/** the Library module, shared with lab */
export const libraryModule = (ck, cb) => m =>
  m
    .label('Library')
    .key('G')
    .left(ck.dock.column({ width: 236 }, cb.panel.navigator(), cb.panel.library()))
    .center(ck.column({ grow: 1 }, cb.bar.filter(), cb.views.library()))
    .right(ck.dock.column({ width: 260 }, cb.panel.metadata()))
    .bottom(cb.view.strip())
    .keys({ ...cb.keys.cull, ...cb.keys.libraryModes });

export const menus = m =>
  m
    .menu('File', ['output.save', '-', 'app.palette'])
    .menu('Edit', ['edit.undo', 'edit.redo', '-', 'proposal.approveAll'])
    .menu('Frame', ['frame.pick', 'frame.reject', 'frame.unflag', '-', 'frame.next', 'frame.previous', '-', 'snapshot.new', 'probe.pin', 'exposure.add', 'print.applyToSelection'])
    .menu('View', ['view.beforeAfter', 'view.sideBySide', '-', 'view.fit', 'view.zoomIn', 'view.zoomOut', '-', 'app.theme'])
    .menu('Window', ['view.hideSides', 'view.toggleLeft', 'view.toggleRight', 'view.toggleBottom', 'workspace.reset'])
    .menu('Help', ['app.shortcuts', 'app.diagnostics']);

export default {
  id: 'classic',
  label: 'Classic',
  description: 'Lightroom-like modules: Library, Print, Output',
  build: (ck, cb) => {
    const s = cb.studio('Chromobench').theme('chromogen').menus(menus);
    s.module('library', libraryModule(ck, cb));
    s.module('print', printModule(ck, cb));
    s.module('output', m =>
      m
        .label('Output')
        .key('Mod+Shift+E')
        .center(cb.view.grid({ id: 'picks', source: st => cb.visible(st).filter(f => f.flag === 'pick') }))
        .right(ck.dock.column({ width: 260 }, cb.panel.output()))
        .bottom(cb.view.strip({ id: 'strip-output' })),
    );
    return s;
  },
};
