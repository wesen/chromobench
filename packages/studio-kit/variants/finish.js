// finish: the classic Library and Print modules plus Finish — crop and straighten, heal and clone, finishing
// tones (CHB-022). Receives ck and cb (the kit is cb.kits.finish); imports only sibling variant parts.
import { libraryModule, printModule } from './classic.js';
import { finishModule } from './finish-module.js';

export default {
  id: 'finish',
  label: 'Finish',
  description: 'Library, Print and Finish: crop, straighten, spot removal, finishing tones',
  build: (ck, cb) =>
    cb
      .studio('Chromobench')
      .theme('craftkit')
      .use(cb.kits.finish.kit)
      .menus(...cb.menus.standard(), cb.kits.finish.menus.finish())
      .module(libraryModule(ck, cb))
      .module(printModule(ck, cb))
      .module(finishModule(ck, cb)),
};
