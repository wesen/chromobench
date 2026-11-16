// classic: Lightroom's layout (guide §8.1; CHB-035 §33 arrangement 1). Modules across the top (Library G, Roll,
// Scene when the catalogue has scene ops, Print D, Edit, Finish F, Assistant, Output), panels left and right, the
// film strip of print thumbnails at the bottom. Print is the darkroom (its Exposures panel is the darkroom stack),
// Edit is the print stage's layers (the digital tools after the print), Scene the camera files' edits before the
// film. Receives ck and cb and imports nothing: every module comes from cb or a kit.
export default {
  id: 'classic',
  label: 'Classic',
  description: 'Lightroom-like modules: Library, Roll, Print, Edit, Finish, Output',
  build: (ck, cb) => {
    const { roll, finish, chat, stack, looks } = cb.kits;
    return cb
      .studio('Chromobench')
      .theme('craftkit')
      .use(roll.kit)
      .use(finish.kit)
      .use(chat.kit)
      // Settings ▸ Copy / Paste / Sync Settings (Lightroom's), from the looks kit
      .use(looks.kit)
      .menus(...cb.menus.standard(), looks.menus.settings(), roll.menus.roll(), finish.menus.finish())
      .module(cb.modules.library())
      .module(roll.modules.roll())
      // arrangement 3: camera files' scene edits, once the catalogue has scene-stage ops (a build-time choice)
      .with(s => (stack.has('scene') ? s.module(stack.modules.scene()) : s))
      .module(cb.modules.print())
      // arrangement 1: the print stage's layers in a module of their own
      .module(stack.modules.edit())
      // CHB-022: crop, straighten and spot removal after the print; the finish view of the print stack
      .module(finish.modules.finish())
      .module(chat.modules.assistant())
      .module(
        ck
          .module('output', { label: 'Output', key: 'Mod+Shift+E' })
          // CHB-047: the open photos; he selects the ones to export (the Output panel exports the selection)
          .center(cb.views.grid({ id: 'export-grid', source: st => cb.sel.visible(st) }))
          .right(ck.dock.column({ width: 260 }, cb.panels.output()))
          .bottom(ck.dock.column({ width: 124 }, cb.views.strip({ id: 'strip-output' }))),
      );
  },
};
