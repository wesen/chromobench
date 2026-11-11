// roll: the Negative Lab Pro replacement (CHB-020 guide §5.1). A Roll module first — the rolls and their setup on
// the left, the contact sheet in the centre (cull keys P X U 0–5, R reference, M match), the balance bar and the
// analysis inspector on the right — then the classic Print module with the roll's frames in the strip.
// Receives ck and cb (the roll kit is cb.kits.roll); imports only sibling variant parts.
import { menus, printModule } from './classic.js';

export default {
  id: 'roll',
  label: 'Roll',
  description: 'Roll setup, first print, contact sheet, print the roll like this frame',
  build: (ck, cb) => {
    const roll = cb.kits.roll;
    const s = cb
      .studio('Chromobench')
      .theme('chromogen')
      .use(roll.kit)
      .menus(m => menus(m).menu('Roll', ['roll.fromFrames', 'roll.analyse', 'roll.firstPrint', '-', 'roll.setReference', 'roll.matchToReference', 'roll.clearMatch', '-', 'roll.contact.mode', 'roll.cull.sweep', 'roll.exportSheet']));
    s.module('roll', m =>
      m
        .label('Roll')
        .key('G')
        .left(ck.dock.column({ width: 300 }, roll.library(), roll.setup()))
        .center(roll.contactSheet({ size: 180 }))
        .right(ck.dock.column({ width: 320 }, roll.balanceBar(), roll.inspector(), cb.panel.history({ id: 'history-roll' })))
        .keys(roll.cullKeys),
    );
    s.module('print', printModule(ck, cb));
    return s;
  },
};
