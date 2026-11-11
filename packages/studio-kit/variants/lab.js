// lab: classic plus a Lab module for us (guide §8.4): every recipe-backed control, views 1–4, the densitometer,
// why, the raw journal, the display closure with evaluation counts, and this studio explained. The Playwright
// specs run against lab, so it holds every element they address.
import { libraryModule, menus, printModule } from './classic.js';

export default {
  id: 'lab',
  label: 'Lab',
  description: 'Everything, plus inspectors',
  build: (ck, cb) => {
    const s = cb.studio('Chromobench').theme('chromogen').menus(menus);
    s.module('library', libraryModule(ck, cb));
    s.module('print', printModule(ck, cb, { extraRight: [cb.panel.why()] }));
    s.module('lab', m =>
      m
        .label('Lab')
        .key('L')
        .txOpts(st => ({ channel: cb.current(st) }))
        .left(ck.dock.column({ width: 280 }, cb.panel.controls('all', { title: 'All parameters' })))
        .center(cb.viewer(st => cb.frame(st)?.print() ?? null, { id: 'lab', views: true, compare: true, tools: ['probe', 'test-strip', 'ring-around'], hud: cb.hud.readout() }))
        .right(ck.dock.column({ width: 320 }, cb.panel.densitometer({ id: 'densitometer-lab' }), cb.panel.history({ id: 'history-lab' }), cb.panel.approvals({ id: 'approvals-lab' }), cb.panel.journal(), cb.panel.nodes(), cb.panel.explain()))
        .bottom(ck.dock.column({ width: 124 }, cb.view.strip({ id: 'strip-lab' })))
        .keys({ ...cb.keys.views, ...cb.keys.darkroom }),
    );
    return s;
  },
};
