// finish: the classic Library and Print modules plus Finish — crop and straighten, heal and clone, finishing
// tones (CHB-022). Receives ck and cb (the kit is cb.kits.finish); imports only sibling variant parts.
import { libraryModule, menus, printModule } from './classic.js';
import { finishMenu, finishModule } from './finish-module.js';

export default {
  id: 'finish',
  label: 'Finish',
  description: 'Library, Print and Finish: crop, straighten, spot removal, finishing tones',
  build: (ck, cb) => {
    const s = cb
      .studio('Chromobench')
      .theme('craftkit')
      .use(cb.kits.finish.kit)
      .menus(m => finishMenu(menus(m)));
    s.module('library', libraryModule(ck, cb));
    s.module('print', printModule(ck, cb));
    s.module('finish', finishModule(ck, cb));
    return s;
  },
};
