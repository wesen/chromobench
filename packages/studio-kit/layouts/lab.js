// lab: Library and Print plus a Lab module for us (guide §8.4): every document control, views 1–4, the
// densitometer, why, the raw journal, the display closure with evaluation counts, and this studio explained. The
// Playwright specs run against lab, so it holds every element they address. Receives ck and cb; imports nothing.

export default {
  id: 'lab',
  label: 'Lab',
  description: 'Everything, plus inspectors',
  build: (ck, cb) =>
    cb
      .studio('Chromobench')
      .theme('craftkit')
      .use(cb.kits.chat.kit)
      .menus(...cb.menus.standard())
      .module(cb.modules.library())
      .module(cb.modules.print({ extraRight: [cb.panels.why()] }))
      .module(cb.kits.chat.modules.assistant())
      .module(
        ck
          .module('lab', { label: 'Lab', key: 'L' })
          .left(ck.dock.column({ width: 280 }, cb.panels.controls('all', { title: 'All parameters' })))
          .center(cb.viewer(st => cb.sel.frame(st)?.print() ?? null, { id: 'lab', views: true, compare: true, tools: ['probe', 'test-strip', 'ring-around'], hud: cb.hud.readout() }))
          .right(ck.dock.column({ width: 320 }, cb.panels.densitometer({ id: 'densitometer-lab' }), cb.panels.history({ id: 'history-lab' }), cb.panels.approvals({ id: 'approvals-lab' }), cb.panels.journal(), cb.panels.nodes(), cb.panels.explain()))
          .bottom(ck.dock.column({ width: 124 }, cb.views.strip({ id: 'strip-lab' })))
          .keys({ ...cb.keys.views, ...cb.keys.darkroom }),
      ),
};
