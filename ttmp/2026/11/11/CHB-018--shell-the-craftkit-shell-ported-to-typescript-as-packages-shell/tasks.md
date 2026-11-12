# Tasks

## TODO
- [x] [stage 1] Scaffold packages/shell (package.json, src layout, exports . ./dom ./testing) and add the two shell rules to tools/scripts/check-boundaries.ts <!-- t:idk3 -->
- [x] [stage 1] Port core/util, diag (diag() producer, library roots for site()), store (prefix tiers, named preview layers, routes) and track (probe mode) to TS <!-- t:six6 -->
- [x] [stage 1] Port cells and scheduler with an injectable Clock, per-runtime ids and the effect-loop diagnostic; history with entry sources and compound entries <!-- t:v4oy -->
- [x] [stage 1] Port commands and keys (platform parameter, headless dispatch); port core.test.mjs and keys.test.mjs to vitest <!-- t:gxb9 -->
- [x] [stage 1] Node IR, typed slots (PropsOf, binding times), headless form specs for every built-in form; createCk, shell/module builders, CraftKit checks as ui passes <!-- t:96fa -->
- [x] [stage 1] Headless runtime (app.start, ctx, recording chrome, testing helpers) and the mini-studio fixture building with zero errors in Node <!-- t:9ies -->
- [x] [stage 2] DOM half: h, icons, habits (arithmetic parser instead of Function), chrome (menus, palette, shortcut sheet, dialogs, toasts), dock and workspaces, mount <!-- t:38se -->
- [x] [stage 2] Renderers for basic, container, collection and plane forms; shell.css on tokens; lightroom and chromogen theme sets; local-storage and memory persistence <!-- t:xfck -->
- [x] [stage 2] demo/ Vite page with the mini studio, Playwright project and smoke test; happy-dom behaviour tests (drag = one undo step, why on disabled, workspace saved) <!-- t:lbmf -->
- [x] [stage 3] RenderBridge and render queue (slots, epochs, live/bg lanes, latest-wins, abort, monotonic presentation, draft/screen/refine, LRU thumbs); queue tests replace engine.test.mjs <!-- t:ie3e -->
- [x] [stage 3] Presenter interface with Canvas2D default; viewport port (zoom, pan, springs, tools with doc-pixel events, SVG overlays, compare); thumb via bridge bg lane <!-- t:yz8q -->
- [x] [stage 3] HistoryAdapter with routes, mirror writes and compound entries; async PersistenceAdapter restore; spike: CHB-009 WebGPU presenter + MockEngine through a bridge <!-- t:srn8 -->
- [x] [stage 4] ck.fragment (targets, late method resolution, X110/X120) and ck.kit (requires, state slices, routes, conflicts X130/X131, docs) with FormMethods augmentation <!-- t:7lu6 -->
- [x] [stage 4] Pass manager (ck.ir, ck.pass with after/before, X140 cycles, ck.run) and explain (static and live); explain snapshot tests and type tests <!-- t:b6w0 -->
- [x] (rt.inspect done; inspector panel and benches moved to CHB-028) [stage 5] rt.inspect() and ck.inspector() panel; perf benches and targets (cells re-checked per step, frame budget, store tx on 10k catalog, build/mount time) <!-- t:aj14 -->
- [x] (a11y and reach passes done, 0.1.0 in workspace; reference page and wording review moved to CHB-028) [stage 5] a11y and reach passes, diagnostics wording review, generated reference page from form docs; publish 0.1 for CHB-019 <!-- t:3sh4 -->
