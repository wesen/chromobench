// classic: Lightroom's layout (guide §8.1). Modules across the top (Library G, Roll, Print D, Finish F, Assistant,
// Output), panels left and right, the film strip of print thumbnails at the bottom. Receives ck and cb and imports
// nothing: every module comes from cb or a kit.
export default {
  id: 'classic',
  label: 'Classic',
  description: 'Lightroom-like modules: Library, Roll, Print, Output',
  build: (ck, cb) => {
    const { roll, finish, chat } = cb.kits;
    return cb
      .studio('Chromobench')
      .theme('craftkit')
      .use(roll.kit)
      .use(finish.kit)
      .use(chat.kit)
      .menus(...cb.menus.standard(), roll.menus.roll(), finish.menus.finish())
      .module(cb.modules.library())
      .module(roll.modules.roll())
      .module(cb.modules.print())
      // CHB-022: crop, straighten, spot removal and finishing tones after the print
      .module(finish.modules.finish({ tones: false }))
      .module(chat.modules.assistant())
      .module(
        ck
          .module('output', { label: 'Output', key: 'Mod+Shift+E' })
          .center(cb.views.grid({ id: 'picks', source: st => cb.sel.visible(st).filter(f => f.flag === 'pick') }))
          .right(ck.dock.column({ width: 260 }, cb.panels.output()))
          .bottom(ck.dock.column({ width: 124 }, cb.views.strip({ id: 'strip-output' }))),
      );
  },
};
