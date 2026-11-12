# Tasks

## TODO
- [ ] [stage 1] Runtime theme switch: View ▸ Theme (CraftKit / Chromogen) and View ▸ Interface Gray (auto, 1–4) as shell commands; persisted in prefs; variants default to the CraftKit theme (lightroom.ts), Chromogen kept selectable; fill lightroom.ts grays 1–4 from CraftKit shell.css <!-- t:1syu -->
- [ ] [stage 1] Replace hard-coded colours/fonts/radii in packages/studio-kit/src/dom/studio-kit.css, kit CSS (roll, looks, finish, chat) and apps/studio/src/app.css with shell tokens; a lint/test that fails on new literal colours outside theme files <!-- t:3rz6 -->
- [ ] [stage 2] Port CraftKit Studio's app styling (CHB-016 sources/craftkit-studio/src/app/app.css and the relevant parts of export/prepress css) onto studio-kit components: panel headers and sections, slider rows, film strip and grid cells (selection, badges), loupe/viewer surround, histogram, menus, palette, dialogs, approval cards <!-- t:b2gh -->
- [ ] [stage 3] Visual check: Playwright screenshots of each variant (classic, darkroom, simple, lab, roll, looks, finish) in CraftKit light, CraftKit dark and Chromogen, saved under the ticket's various/ folder; compare with CraftKit Studio's look; fix outliers <!-- t:c8jc -->
