// finish: the Library and Print modules plus Finish — crop and straighten, heal and clone, finishing tones
// (CHB-022). Receives ck and cb (the kit is cb.kits.finish); imports nothing.
export default {
  id: 'finish',
  label: 'Finish',
  description: 'Library, Print and Finish: crop, straighten, spot removal, finishing tones',
  build: (ck, cb) => {
    const { finish } = cb.kits;
    return cb
      .studio('Chromobench')
      .theme('craftkit')
      .use(finish.kit)
      .menus(...cb.menus.standard(), finish.menus.finish())
      .module(cb.modules.library())
      .module(cb.modules.print())
      .module(finish.modules.finish());
  },
};
