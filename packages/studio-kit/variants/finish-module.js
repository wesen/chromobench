// The Finish module (CHB-022 guide §9.1): crop and straighten (R), spot heal and clone (Q), the finishing tones,
// on the finished print. A variant part: classic and finish use it; it needs .use(cb.kits.finish.kit).
// o.tones: false leaves out the finishing tones (their ops run on the mock engine only until CHB-015 lands them).
export const finishModule = (ck, cb, o = {}) => {
  const fin = cb.kits.finish;
  return ck
    .module('finish', { label: 'Finish', key: 'F', txOpts: s => ({ channel: cb.sel.current(s) }) })
    .left(ck.dock.column({ width: 236 }, cb.panel.navigator({ id: 'navigator-finish' }), cb.panel.history({ id: 'history-finish' })))
    .center(fin.viewer({ hud: cb.hud.readout() }))
    .right(ck.dock.column({ width: 300 }, fin.cropPanel(), fin.retouchPanel(), ...(o.tones === false ? [] : [fin.tonesPanel()]), ...(o.extraRight ?? [])))
    .bottom(ck.dock.column({ width: 124 }, cb.view.strip({ id: 'strip-finish' })))
    .keys(fin.keys);
};
