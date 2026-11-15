// The smallest complete studio (guide §1): the roll on the left, the selected frame printed, the darkroom
// controls and the frame's history on the right. A variant imports nothing; the host passes ck and cb.
export default {
  id: 'tiny',
  label: 'Tiny',
  // new recipes print normalised: the grey card at the aim, no time or aperture to set (CHB-031)
  enlarger: 'normalised',
  build: (ck, cb) =>
    cb
      .studio('Chromobench')
      .menus(...cb.menus.standard())
      .module(
        ck
          .module('main', { label: 'Chromobench' })
          .left(ck.dock.column({ width: 180 }, cb.view.strip({ vertical: true })))
          .center(cb.viewer(s => cb.sel.frame(s)?.print() ?? null))
          .right(ck.dock.column({ width: 300 }, cb.panel.controls('darkroom'), cb.panel.history())),
      ),
};
