// roll: the Negative Lab Pro replacement (CHB-020 guide §5.1). A Roll module first — the rolls and their setup on
// the left, the contact sheet in the centre (cull keys P X U 0–5, R reference, M match), the balance bar and the
// analysis inspector on the right — then the classic Print module with the roll's frames in the strip.
// Receives ck and cb (the roll kit is cb.kits.roll); imports only sibling variant parts.
import { printModule, rollModule } from './classic.js';

export default {
  id: 'roll',
  label: 'Roll',
  description: 'Roll setup, first print, contact sheet, print the roll like this frame',
  build: (ck, cb) =>
    cb
      .studio('Chromobench')
      .theme('craftkit')
      .use(cb.kits.roll.kit)
      .menus(...cb.menus.standard(), cb.kits.roll.menus.roll())
      // the same Roll module as the classic variant, here first and on G
      .module(rollModule(ck, cb).key('G'))
      .module(printModule(ck, cb)),
};
