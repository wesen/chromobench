// roll: the Negative Lab Pro replacement (CHB-020 guide §5.1). A Roll module first — the rolls and their setup on
// the left, the contact sheet in the centre (cull keys P X U 0–5, R reference, M match), the balance bar and the
// analysis inspector on the right — then the Print module with the roll's frames in the strip.
// Receives ck and cb (the roll kit is cb.kits.roll); imports nothing.
export default {
  id: 'roll',
  label: 'Roll',
  description: 'Roll setup, first print, contact sheet, print the roll like this frame',
  build: (ck, cb) => {
    const { roll } = cb.kits;
    return (
      cb
        .studio('Chromobench')
        .theme('craftkit')
        .use(roll.kit)
        .menus(...cb.menus.standard(), roll.menus.roll())
        // the same Roll module as the classic layout, here first and on G
        .module(roll.modules.roll().key('G'))
        .module(cb.modules.print())
    );
  },
};
