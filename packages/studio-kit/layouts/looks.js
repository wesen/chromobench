// looks: the Library plus a Print module built around cb.kits.looks (CHB-021 guide §8.2) — the looks library with
// print thumbnails on the left, the print (with the picked look previewed, compared with a chosen source) or the
// survey of several looks in the centre (N), the look's parameters, Amount with its result in darkroom units, the
// diff, sync groups and the look batches on the right. The roll kit is installed so a look can go to a roll's
// unedited frames. Receives ck and cb; imports nothing.
export default {
  id: 'looks',
  label: 'Looks',
  description: 'Presets and looks: preview, Amount, survey, diff, apply to selection, roll or library',
  build: (ck, cb) => {
    const { roll, looks } = cb.kits;
    return cb
      .studio('Chromobench')
      .theme('craftkit')
      .use(roll.kit)
      .use(looks.kit)
      .menus(...cb.menus.standard(), looks.menus.looks())
      .module(cb.modules.library())
      .module(looks.modules.print());
  },
};
