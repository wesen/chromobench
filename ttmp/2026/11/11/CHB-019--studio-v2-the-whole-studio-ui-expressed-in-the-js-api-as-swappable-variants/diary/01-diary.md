---
Title: Diary
Ticket: CHB-019
Status: active
Topics:
    - ui
    - product
    - js-api
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T15:10:21.763462301-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-019 Studio v2 on the JS API

## Step 1: Intern guide written

I wrote the implementation guide for CHB-019: `packages/studio-kit` (the `cb` namespace and the `cb.core` kit), the
`apps/studio` host, four variants (`classic`, `darkroom`, `simple`, `lab`) and the migration of CHB-009's React
studio. The guide shows the API as builder calls from one control to whole variants, then the internals: the
EditLog route that serves `recipes.<frameId>` from each frame's EditLog, a global undo made of parts, proposals as
previews, the render bridge over CHB-009's RenderScheduler, and the host's variant loading.

The guide also files 15 staged tasks and relates 8 primary files. It came out at about 7,400 words, slightly
above the brief's range; I stopped trimming when the user asked not to overdo review.

### Prompt Context

**User prompt (verbatim):** "before we move on, now that we have worked out what to do with craftkit, let's create
the tickets and design guides (remember, no need to be overly correct in the guides, they are \"guides for
impementation\" after all, and we'll sort out details as we work) for the proper UI. Allow the UI to be entirely
expressed using the JS API, so that we can create many different versions of it."
**Assistant interpretation:** Write CHB-019's guide (studio-kit core, host, variants, CHB-009 migration) following
the shared UI design brief, with tasks, related files and this diary step; no commit.
**Inferred user intent:** An implementable plan in which every part of the studio is a builder call, so that
variants are cheap to write.
**Commit (code):** none (the orchestrator commits all guides together).

### What I did
- Read the writer brief, the UI design brief, CHB-016 diary Steps 2–4, CraftKit `docs/SHELL.md`, `docs/README.md`,
  `src/shell/index.js`, `core/store.js` and `history.js` (tx, preview, channels), and the app modules `main.js`,
  `catalog.js`, `library.js`, `cull.js`, `develop.js`, `develop-scopes.js`, `export.js` (structure and `install`).
- Read CHB-009's guide §5.1–5.11, diary Steps 14–17 and `tasks.md`, and `apps/studio/src` (`main.tsx`,
  `core/studio.ts`, `frame-session.ts`, `gesture.ts`, `store.ts`, `arrangement.ts`, the heads of `controls.ts`,
  `history.ts`, `tools.ts`, `scheduler.ts`, `keyboard.ts`, `library.ts`, `storage/db.ts`, `ui/App.tsx`), plus
  `e2e/m1-walking-skeleton.spec.ts` and `e2e/studio.spec.ts`.
- Read `packages/contract/src/editlog.ts` in full; `spec.ts` (ArgSpec, UiHints); the print ArgSpecs in
  `catalog/capture-film-print.ts`; the DSL frame handle in `prelude.ts` and `vocab`/`cut`/`ACCESSORS` in
  `packages/dsl/src/host.ts`; `RefEngine` and `GpuEngine` constructors; `tools/scripts/check-boundaries.ts`.
- Wrote `design-doc/01-intern-guide.md`; ran `08-check-guide-markdown.py` (first 8,249 words, then 7,380 words,
  22 code blocks, no problems reported); `docmgr task add` ×15; `docmgr doc relate` with 8 files.

### Why
- The EditLog/shell-history split is the central design question (flagged in CHB-016 Step 2), so the guide spends
  most of its design section on the route and the history adapter.

### What worked
- The checker reported no untagged fences, raw HTML or unbalanced fences. `docmgr doc relate` reported
  "added 8".

### What didn't work
- The first draft was 8,249 words against a 4,000–7,000 target; I removed duplication (CHB-009 module table, the
  classic ASCII layout) and condensed §5–§14 down to 7,380 words, then stopped as the user asked.

### What I learned
- `e2e/m1-walking-skeleton.spec.ts` drives sliders as native range inputs (`el.value`, synthetic `input`/`change`,
  the `min` attribute). CraftKit's slider is a `div role="slider"`, so a straight port would break the M1 spec.
- `check-boundaries.ts` forbids `apps/studio/src` from importing `@chromobench/core` and `gpu`, so the host cannot
  construct `RefEngine` or `GpuEngine` without an exception or another injection point.
- `EditLog.preview` holds one mutation, and its `apply` makes every call its own unit; CHB-009 already coalesces
  keyboard bursts before logging for that reason.
- CraftKit's `export.js` is already a kit in shape (`export const state` + `install(shell)`).

### What was tricky to build
- Global undo across shell patches and per-frame EditLog cursors. History-panel jumps move a log's cursor, and a
  later edit truncates its redo tail, so a jump cannot be a reversible global entry. The guide proposes a stack of
  parts whose EditLog parts check that their unit is still the frame's last unit in effect, and are skipped
  (CB-H401) otherwise.

### What warrants a second pair of eyes
- The skip-if-stale undo semantics (§6.3) and the native range slider decision (§5.1).
- The shell interfaces assumed from CHB-018 (store routes, history parts, services, tool `image`/`content` hooks,
  DOM-free build), which are listed in §3 of the guide.

### What should be done in the future
- Agree the route/history-part names with CHB-018; decide the engine-import boundary with CHB-017; move the DSL's
  frame vocabulary (`ACCESSORS`, `PRINT_OPTIONS`, `cut`) to a shared module; contract 0.2 request for
  `EditLog.preview(Mutation[])`.

### Code review instructions
- Read guide §4 (examples), §6 (bridge and adapter), §7 (host) and §9 (migration table) first.
- Check `python3 -I ttmp/2026/11/11/CHB-001--…/scripts/08-check-guide-markdown.py` on the guide.

### Technical details
- Variants export `{ id, label, build(ck, cb, env) }` and import nothing; kits are reached as `cb.kits.*` (a
  refinement of the design brief's sketch, which imported `rollKit`), so a file can be loaded from a Blob URL.
- `cb.studio(name)` is `ck.shell(name).use(cb.core)`; studio-kit diagnostics use the families CB-A1xx, F2xx,
  V3xx, H4xx, K5xx.

## Step 2: packages/studio-kit — the EditLog route, global undo, cb, four variants, the dev host

This step builds the first part of CHB-019 in `packages/studio-kit` without touching `apps/studio` (another agent
is changing it for CHB-023). The headless half has the frames registry (graph + EditLog per frame, logs saved by
SHA-256), the EditLog route (recipes as a projection of the logs, drags, 800 ms bursts, proposals as previews,
partial approval, `E_STALE` / Apply anyway), history parts with skip-if-stale (CB-H401), the render bridge over
`compile(recipe)` + an injected `Engine`, the `cb` namespace and the `cb.core` kit, `defineVariant`/`buildVariant`,
and the variants classic, darkroom, simple, lab (plus tiny), each building in Node with zero errors and an explain
snapshot. The DOM half renders the cb forms, and a dev host (`packages/studio-kit/demo`) mounts any variant on
MockEngine with the M1 fixture TIFF, under a new Playwright project `studio-kit`.

### Prompt Context
**User prompt (verbatim):** the orchestrator's task (not the user's own words): "You implement the first part of
ticket CHB-019 (Studio v2: the whole studio UI expressed in the JS API, as swappable variants) […] Do NOT edit
apps/studio or e2e/ specs that target it. Build: 1. packages/studio-kit (cb) […] 2. The four variants […] 3. A dev
host page inside packages/studio-kit […] Be pragmatic; the user asked not to overdo polish." Mid-task the
orchestrator relayed the user's feedback on the shell demo: the bottom film strip did not show, strip cells were
only text, the Navigator showed a label instead of a picture; the dev host and variants must avoid all three.
**Assistant interpretation:** Stages 0–3 and 5 of the guide inside studio-kit, the variants, a dev host and its
Playwright project; the apps/studio migration later. Thumbnails in every strip/grid cell, a picture in the
Navigator, a visible bottom region on a fresh load.
**Inferred user intent:** Variants that can be tried in a browser now, on the real bridge semantics, so the
apps/studio switch after the demo is mostly wiring.
**Commit (code):** a848e38 — "CHB-019: packages/studio-kit headless — EditLog route, global undo parts, proposals,
cb.arg, handles, render bridge, four variants"; 827b8c4 — "CHB-019: studio-kit DOM half, dev host and Playwright
project"

### What I did
- Branch `task/chb-019-studio-kit`; `pnpm install --frozen-lockfile --offline`.
- Read the CHB-019 guide, CHB-016 §9–10, CHB-018 diary Steps 2–3, `packages/shell/src/{core/store,core/history,
  app/runtime,build/kits,build/fragments,build/ck,dom/mount,dom/dock,dom/viewport}.ts`, the contract's `editlog`,
  `mutations`, `recipe`, `paths`, `spec`, `graph` (`compile`), CHB-009's `src/core/*`, `packages/dsl/src/host.ts`.
- Copied `apps/studio/src/core/{units,controls,arrangement,history,tools}.ts` to `packages/studio-kit/src/model/`
  (a header says the original goes at migration) and `diffRecipes`/`defaultFor`/`PRINT_SETTINGS` into
  `model/recipes.ts`; moved `units-tools.test.ts` and the controls/history cases of `core.test.ts` with them.
- `src/bridge/`: `frames.ts`, `editlog-route.ts`, `render-bridge.ts`, `kv.ts` (KV, `memoryKV`, `localStorageKV`),
  `persistence.ts` (`kvPersistence`); `src/handles.ts` (`frameRef`, `ImageHandle`, copies of `ACCESSORS` and
  `PRINT_OPTIONS`); `src/kit/{args,forms}.ts`; `src/cb.ts` (`createCb(ck)`); `src/studio.ts` (`Studio`:
  services, attach, open, propose, measure); `src/variant.ts`.
- `src/dom/{arg,panels,index}.ts` and `studio-kit.css`; `mountStudio(app, el, studio, extra)`.
- `variants/{classic,darkroom,simple,lab,tiny,index}.js` + `index.d.ts`.
- `demo/{index.html,main.ts,vite.config.ts,env.d.ts}`; root `playwright.config.ts` project `studio-kit` and web
  server on `STUDIO_KIT_PORT` (default 4187).
- `tools/scripts/check-boundaries.ts`: studio-kit/src imports only `@chromobench/contract` and `@chromobench/shell`
  (engines are injected); its headless files never import the DOM half; variants import only `./` siblings (rules
  got an optional `skip` regex for `src/dom/` and `.d.ts`).
- `packages/studio-kit/CONTRACT-REQUESTS.md`: R1 `EditLog.preview(Mutation[])` with the diff; R2 shared frame
  vocabulary.

### Why
- Variants are plain `.js` (import nothing, loadable from a Blob URL later); the registry `variants/index.js` has a
  `.d.ts` so TS tests can import it. They live in `packages/studio-kit/variants/` because `apps/studio` is off-limits
  in this run; the migration moves or re-exports them.
- The route publishes `log.committed` (not `log.state`) as `recipes.<f>`: the store's own gesture overlay already
  shows the preview to readers, and a published preview would land in the document. Its own `apply`/`undo`/`redo`
  run under a `quiet` counter so the log listener does not republish or push twice; log events it did not cause
  (agent auto mode, approve, a History-panel jump) republish and, for units, push a global step.
- Store patches are lifted to recipe fields (`print.enlarger.filtration.y = 10` → `set print.enlarger.filtration
  {c, m, y}`; array indexes under `print.exposures` → exposure ids); a write above field level becomes
  `diffRecipes(committed, new, [prefix])`, which also covers `print.applyToSelection` as one global step with one
  shared tx over several frames. Every frame is validated before any is applied.
- `cb.viewer` lowers to `ck.viewport` (plus a view switch, the proposal ribbon, and a `ck.match` for the
  ring-around), so the shell's viewport, render queue, draft/screen/refine passes, compare split and tools are reused
  as they are. Proposals and inspection views are applied in the viewport's image lambda; the test strip is the
  tool's `image` hook.
- The ring-around is a grid of `ck.view.thumb` cells whose handles are the current recipe with a lights offset, so
  the centre tile is the main print's node (hash-consing) and thumbnails come from the bg lane and cache.
- Partial approval (decided by the user): every change on a card has a checkbox; Approve approves the ticked seqs as
  one unit; unticked ones stay pending until rejected.

### What worked
- `npx vitest run packages/studio-kit`: 7 files, 50 tests (bridge 12, kit 10, model 9, units/tools from CHB-009,
  variants 6). `pnpm test`: 56 files, 2078 tests (baseline 2028). `pnpm typecheck` clean. `pnpm lint`: "import
  boundaries ok (266 file checks)". `pnpm gen:check`: "gen:check ok (18 files)".
- `STUDIO_KIT_PORT=4437 STUDIO_PORT=4431 SHELL_DEMO_PORT=4436 npx playwright test --project studio-kit`: 8 passed
  (9.2 s): thumbnails in strip, grid and navigator; bottom region visible on a fresh load; a 3-step keyboard burst is
  1 unit and Ctrl+Z undoes it; typed `+1/3 st` → 12.599 s and History reads "Time 10.0 → 12.6 s (+1/3 st)";
  propose → Show → nudge G → Approve → `E_STALE` → Apply anyway; every variant mounts and renders;
  `?variant=clasic` → Build Report "Did you mean ?variant=classic?".
- Bridge tests that can fail: after `history.jump(f, 0)`, a `vi.spyOn(log, 'undo')` sees no call on Mod+Z, the flag
  is undone instead, CB-H401 is reported and the state hash equals the initial recipe's; the §6.3 interleaving
  (flag, time, keyword, approved agent change) undoes newest first; the §11 stale flow ends three undos later with
  the print's node id equal to the start's.
- Vocabulary parity: `bridge.lower(frameRef(f, r).print()).named.id === new Host(graph, …).printOf(r).id`
  (`view.adapt`), and `PRINT_OPTIONS` equals the DSL's.
- All five variants: 0 errors, 0 warnings.

### What didn't work
- `pnpm typecheck` (first): `cb.ts(173,114): error TS2538: Type 'null' cannot be used as an index type` (selection
  fallback `[current(s)]`) and `handles.ts(92,63): error TS2339: Property 'vary' does not exist on type '{}'`; fixed
  with a `targets(ctx)` helper and a typed default.
- variants test: darkroom had 4 × `CK-K210 Single-letter key in global scope`; its keys moved to `'module:*'`.
- bridge test: `expect(s.recipes[f]).toBe(log.committed)` failed ("serializes to the same string"): `rt.state` is a
  read-only proxy; identity is checked through `rt.store.peek`.
- Several shell commands (`cat > … <<EOF`, a `for … sed` loop, a multi-command line ending in `docmgr`) were refused
  by the worktree guard ("too complex to verify that it stays inside the worktree"); files were written with the
  editor instead and commands split.
- `pnpm typecheck` with the demo: `demo/main.ts(22,5): error TS2687: All declarations of 'chromobench' must have
  identical modifiers` (apps/studio declares `Window.chromobench`); the hook is assigned through a cast instead.
- Dev host, first look: the Library grid was empty — a `ck.match` inside a column has no flex size (the shell only
  sizes a match directly in the centre region). studio-kit.css sizes `.ck-col > .ck-match` and `.ck-match > *`.
- Darkroom crashed at mount: `TypeError: Cannot read properties of undefined (reading 'toFixed') at formatFstop`
  (the stepper formatted an undefined value before a frame was open); the arg effect now skips undefined values.
- The synthetic roll frames all printed alike: scaling every pixel also scales the rebate, which the inversion
  normalises away; only the image area (x ≥ 8) is scaled now.
- Playwright, first run: 6 failed — I wrote `.ck-viewport[data-rendered]`, the viewport element's class is `ck-vp`;
  then `#pending li` matched 2 elements because the card's change list used `<li>` (the M1 spec addresses
  `#pending li .approve`, so the changes are `div`s now); and `getByRole('button', { name: 'Which looks best?' })`
  timed out because a command button's accessible name is the command's label ("Ring-around").

### What I learned
- The shell's routes and history parts fit the EditLog bridge with no shell change: `RouteAdapter.apply` returning
  `{ parts, mirror }`, `RouteApi.publish` / `push`, and `History.undo` skipping all-false entries.
- A no-op commit through a route (every value unchanged) must still return a part, or the store records the routed
  patches as its own undoable patches; the route returns a part whose undo/redo return false.
- The user's "bottom strip not shown" did not reproduce in Chromium: the shell demo's bottom region was 96 px and
  visible at 1400×860, 1280×640 and 700×900, with and without `?fresh`. Only Chromium is installed here. A likely
  cause is a persisted `workspace.hide.all` (Shift+Tab) or a hidden bottom (F6) in localStorage, which the demo
  restores without `?fresh`. No shell change was made; the studio-kit Playwright test asserts a visible bottom
  region with six rendered thumbnails, and classic/lab give the strip 124 px so the captions fit.

### What was tricky to build
- Bursts and gestures in one store: the route keeps the open burst (`step`) and commits it when another path is
  stepped, a command runs (`endBurst`) or a pointer goes down on another control; it uses the runtime's clock, so
  tests drive it with `manualClock().advance(800)`.
- Writes from script (the M1 spec sets `input.value` and dispatches `input`) versus drags: the range input commits at
  once unless a pointerdown started a drag; arrow keys are intercepted and go through the burst.

### What warrants a second pair of eyes
- `EditLogRoute.preview` puts only the last written field into `log.preview` (contract R1); readers use the store's
  overlay, so only `log.state` (the agent's view) is partial during a multi-field gesture.
- The catalog entry of a newly opened frame is written with `writeDoc` (no history step); catalog persistence
  relies on autosave's view of the document tier.
- `compare: 'lr'` is still drawn as a split (CHB-018 limitation).

### What should be done in the future
- The apps/studio migration (after CHB-023 merges): host boot with `openIdb()` as the KV, OPFS/LibraryService,
  CHB-009's WebGPU presenter as `services.presenter`, engine choice, Load Variant / hot reload, the M1 spec and
  `e2e/studio.spec.ts` on `lab`, delete the React UI and the copied originals.
- Open in studio-kit: RenderScheduler refine/latency measurement (oizm, cebs), collections/keywords (rvl9), axe and
  live regions (ktgo), a real 2-D colour pad (g4p6: three sliders plus density buttons and typed points for now),
  restoring catalog frames whose bytes are not opened in this session.

### Code review instructions
- Start at `packages/studio-kit/src/bridge/editlog-route.ts` (`apply`, `mutationsFor`, `part`, `onLog`, `step`),
  then `src/cb.ts` (`viewer`, commands, tools), `src/studio.ts`, `test/bridge.test.ts`.
- `npx vitest run packages/studio-kit && pnpm typecheck && pnpm lint && pnpm gen:check`;
  `STUDIO_KIT_PORT=4437 npx playwright test --project studio-kit`;
  `pnpm --filter @chromobench/studio-kit demo` → http://localhost:4187/demo/?variant=classic (also darkroom,
  simple, lab, tiny; `&fresh` for a memory KV).

### Technical details
- New diagnostics: CB-A101 (unknown path, fix `cb.arg('…')`), CB-A102 (no ui hints), CB-A110 (step unit), CB-A120
  (widget), CB-F201 (unknown view), CB-H401 (undo skipped a stale EditLog part), CB-H410 (approval refused),
  CB-K501 (no cb.core), CB-K520 (not a variant).
- State: `catalog`, `snapshots` (document); `recipes`, `proposals` (routes, `keyDepth: 1`); `view`, `ui`, `prefs`
  (view tier). `ui.approvals[tx] = { off: seqs, stale: diags }`, `ui.showProposal`.
- The hook: `window.chromobench = { app, rt, studio, variant, explain(), run(id, …), state(), log(f?), propose(ms,
  why), idle(), chainRuns() }`.

## Step 3: apps/studio migrated onto studio-kit, on the real engines (and CHB-011 merged)

The app the photographer opens is now the shell-based studio: `apps/studio/src/main.ts` builds a variant
(`?variant=`, default `classic`), mounts it with studio-kit's services plus CHB-023's host engines, ingest decoding and
first print, CHB-009's WebGPU presenter and CHB-011's export, and keeps a thin host frame (files, export, layout menu on
top; engine, conditioning notes and status at the bottom). The React UI and the CHB-009 core copies are deleted. The
ported specs passed in the browser: the real-engine, decoder and offline specs on `classic`, the M1 and studio specs on
`lab`, on the dev server and on the production build.

### Prompt Context
**User prompt (verbatim):** the orchestrator's task (not the user's own words): "You do the second part of ticket
CHB-019 […] migrate apps/studio from React onto packages/studio-kit (the shell-based studio), keeping the CHB-023 demo's
real-engine wiring, so the app the photographer sees becomes the JS-API studio with selectable variants. […] Feature
parity with the demo is the acceptance bar […] Delete the React UI and the copies studio-kit already took over […] Port
the M1 spec and studio specs to the new app […] The user is showing the current demo to his father right now, so the
result must be at least as usable." Mid-task: "CHB-011 has landed on branch task/chb-011-output (8b7700b, 4463f31).
Merge it into your branch […] and use @chromobench/output for export instead of the demo's 8-bit canvas PNG".
**Assistant interpretation:** Host boot on studio-kit with the demo's engines, decoding, first print, presenter and
export; parity with the demo's feature list; delete React; port specs; merge CHB-011 and export through it.
**Inferred user intent:** One studio codebase (variants in the JS API) that is already good enough for the photographer.
**Commit (code):** 277bf68 — "Merge task/chb-011-output into task/chb-019-migrate"; 82db912 — "CHB-019: apps/studio on
studio-kit — the shell-based studio with variants, on the real engines"

### What I did
- Branch `task/chb-019-migrate`. Merged `task/chb-011-output`: conflicts in `packages/core/src/index.ts`,
  `core/src/ops/ops.ts`, `gpu/src/physics/core.ts` (import lists: the union, minus `displayGain`, `bradfordMatrix`,
  `mulMM`, `XYZ_TO_SRGB`, `DEFAULT_COMPRESS`, `displayEncode`, which CHB-011 removed or left unused) and
  `gpu/src/engine-gpu.ts` (`evaluate()` on CHB-011's `render()`; CHB-023's `cacheLimit` moved into `cacheResult`);
  lockfile regenerated with `pnpm install --offline`.
- studio-kit: `Frames.open` / `Studio.open` accept an `InitialRecipe` function (`StudioOptions.initial`), run only when
  no log is saved for the hash. Render bridge: `testStrip` lowers to bands of ordinary print nodes (`stripRecipe`,
  `bandBoxes` moved from CHB-023's core/tools.ts; `evaluateBands` from its scheduler), keyed by the band nodes. The
  test-strip tool draws labelled bands (`.cb-band[data-value]`). Also: `setKnownValues` (CHB-023) in
  `model/controls.ts`; visual density in the densitometer panel and readout; view labels (Base & gamut);
  `visibleFrames` hides catalogued frames whose bytes are not open this session; DARKROOM gets a "Film and viewing"
  group (`scan.stock`, `scan.scanner`, `view.illuminant`); the classic/lab Print module gets a Tools panel
  (`tool.probe`, `tool.test-strip`, `tool.ring-around`, `view.beforeAfter`); package export `./variants`.
- apps/studio: `src/main.ts` (boot, host bar, status line, folder open through File System Access with the handle kept
  in the KV, `window.chromobench`), `src/app.css`, `index.html` (bar / `#app` / status bar);
  `present/host-presenter.ts` (one shared `GPUDevice`, `WebGpuPresenter.onDevice` on `configureCanvas`, swap to the
  shell's `Canvas2DPresenter` on a fresh canvas when the device is lost); `presenter-webgpu.ts` (`onDevice`, a shared
  device is not destroyed on dispose); `host/export.ts` rewritten on `exportNode` / `exportFrame` with `pickerSink`, or
  `MemorySink` plus a download; `storage/db.ts` on studio-kit's `KV` / `KV_STORES` (DB version 2 adds `workspace`);
  `engines.ts` drops `nativeSpaces: ['srgb']` (the GPU encodes every space since CHB-011).
- Deleted: `src/ui/**`, `src/main.tsx`, `src/core/**`, `present/presenter-2d.ts`, `storage/opfs.ts`, both CSS files,
  `test/core.test.ts` (+ snapshot), `test/units-tools.test.ts`; react, react-dom and their types; `esbuild.jsx`.
- Specs: `e2e/m1-walking-skeleton.spec.ts` and `e2e/studio.spec.ts` on `?variant=lab&engine=mock`;
  `e2e/studio-real.spec.ts` and `e2e/studio-decoders.spec.ts` on the default variant. A standalone Playwright config in
  the scratchpad (`chb019m/pw.config.mts`: the chromium-webgpu and studio-kit projects only, project testDirs absolute)
  avoids the gpu-parity server on 4185.
- `apps/studio/DEMO.md` updated (variants, Open folder, export formats, the Tools panel, what is missing).

### Why
- Default variant `classic`: the demo had history/snapshots on the left, the viewer with view bar and film strip in the
  middle, the enlarger controls on the right, and file and export actions on top; classic's Print module is that
  layout. Opening a file switches to Print. `lab` (classic plus why, journal, nodes, all parameters) carries every
  element the M1 and studio specs address.
- The host bar and status line stay outside the shell mount: they belong to the host (files, export settings, engine),
  are the same for every variant, and keep the `#file`, `#undo`, `#status`, `#engine`, `#notes`, `#offline-state` hooks.
- The test strip is built from bands of print nodes, not `darkroom.testStrip`: CHB-023 found that op takes only the
  dyes and cannot know the enlarger settings, and neither real engine implements it.
- One presenter device for all viewports, because the shell asks for a presenter synchronously per viewport canvas.

### What worked
- After the merge, before migrating: `pnpm test` 65 files, 2219 passed; old app in the browser 24 passed, studio-kit 8.
- After the migration: `pnpm typecheck` clean; `pnpm lint` "import boundaries ok (248 file checks)"; `pnpm gen:check`
  "gen:check ok (18 files)"; `pnpm test` 63 files, 2184 passed (35 fewer: CHB-009 core tests deleted together with
  their subjects: gesture, scheduler, library, frame-session, store).
- Browser on the dev server (`STUDIO_PORT=4493 STUDIO_KIT_PORT=4494 CI=1 npx playwright test -c …/chb019m/pw.config.mts`):
  32 passed (chromium-webgpu: M1 2, studio 7, studio-real 3, decoders 3, output, ingest, wgsl; studio-kit 8).
- Production build (`pnpm --filter @chromobench/studio build`, `vite preview --port 4495`): M1, studio-real (gpu,
  reference, offline) and decoders (tiff, png, dng): 8 passed.
- bench on the dev server: GPU (SwiftShader) draft median 192 ms, screen 24 ms, export 5 ms; reference draft 325 ms,
  screen 91 ms, export 25 ms (96×64 fixture). `idle()` now waits for three runtime settles, so the drafts include that.

### What didn't work
- `cd apps/studio && git rm …`, and a multi-line `python3 - <<EOF` editing JSON followed by `pnpm install` in one call,
  were refused by the worktree guard ("too complex to verify that it stays inside the worktree"). I split them into
  plain commands.
- The first run of the scratchpad Playwright config found 0 studio-kit tests: a project's relative `testDir` resolves
  against the config file's directory. Fixed by making it absolute.
- `pnpm typecheck` after the first main.ts: `Property 'env' does not exist on type 'ImportMeta'` (the dev flag is now
  `?dev`), and the e2e specs' old hook (`studio.session`, `gesture`, `setTool`, `probeAt`, `s`, `last`), rewritten.
- studio.spec, first run, 2 of 7 failed: `Expected: 12 Received: 12.59921` after Ctrl+Z. Clicking `#history` to move
  focus clicked an entry and jumped the frame's history; the spec now clicks the viewer. Also
  `Expected value: "mask.ellipse" Received array: ["mask.feather"]`: the mask's last node is the feather, so the spec
  checks all its nodes.
- A screenshot run without `?canvas2d` showed "WebGPU device lost (Device was destroyed.); presenting with Canvas2D". A
  `GPUDevice.prototype.destroy` trace showed no call from our code. It is SwiftShader's headless presentation loss, and
  the fallback took over as designed.

### What I learned
- studio-kit's range slider commits a script-set value at once unless a `pointerdown` started a drag. The M1 spec now
  dispatches `pointerdown` first; with that, its preview/commit/undo/approve numbers held exactly on the shell.
- MockEngine's run counts stay at 1 for the upper chain nodes, even with the navigator and strip thumbnails rendering
  the same print (same node, full scale on a 96×64 frame).
- Since CHB-011 the GPU encodes Display P3 itself, so the StudioEngine's sRGB→P3 re-encode is no longer used there.

### What was tricky to build
- The WebGPU presenter fallback. The shell's viewport owns its canvas and lays it out, and a canvas keeps its first
  context. So the host presenter puts a fresh canvas element in its place for Canvas2D and copies the laid-out canvas's
  size and style on every draw.
- First-print ordering. `Frames.open` computes the initial recipe after `engine.open` (the StudioEngine decodes there)
  and before `EditLog.create`, and checks the frame map again afterwards in case the same file was opened twice
  meanwhile.

### What warrants a second pair of eyes
- `visibleFrames` now hides catalogued frames that have no recipe in this session. Their flags and stars are kept, but
  stay invisible until the file is opened again.
- Export runs through the StudioEngine without `evaluateU16` (output.frame is a host op), so the 16-bit path reads
  floats and quantises them in JS. That is fine at working size and slow at `?long=0` on big scans.
- The status line's sticky refusal clears when the frame's recipe object changes.

### What should be done in the future
- Controls for the test-strip options (vary, step, count) and the ring-around step; the Base view's class fractions.
- Dev hot reload and Load Variant (task xupn); a per-variant smoke test with axe (qv62); the chat slot (7bs1).
- Restore catalogued frames from their folder on boot instead of hiding them; a full-resolution export path.
- On a real GPU (CHB-023 task 4h85): check that the shared-device WebGPU presenter holds, then run `chromobench.bench()`.

### Code review instructions
- Start at `apps/studio/src/main.ts` (`main`, `openFiles`, `exportFrame`, `makeHook`), then
  `apps/studio/src/present/host-presenter.ts` and `apps/studio/src/host/export.ts`. Then the studio-kit changes:
  `src/bridge/render-bridge.ts` (`evaluateBands`, the `testStrip` lowering), `src/bridge/frames.ts`, and `src/cb.ts`
  (the test-strip overlay).
- `pnpm typecheck && pnpm lint && pnpm test && pnpm gen:check`;
  `STUDIO_PORT=4493 STUDIO_KIT_PORT=4494 CI=1 npx playwright test -c <scratchpad>/chb019m/pw.config.mts`.
- Run: `pnpm --filter @chromobench/studio dev` → http://localhost:4173/ (`?variant=lab`, `?engine=reference`, …).

### Technical details
- Hook: `window.chromobench = { app, rt, studio, variant, engine, engineLabel, log (getter), size(), explain(), run(),
  state(), idle(), set(path, value, label), tool(id|null), printNode(), pixel(x, y), canvasPixel(x, y), presenter(),
  chainRuns(), measure(x, y), exportPng(space, format), bench(steps), propose(edits | mutations, why) }`.
- KV: IndexedDB `chromobench-studio` version 2 (stores `KV_STORES`, adds `workspace`); the last folder handle is
  stored under `handles/last-folder`.
- Export file names: `<scan>-print[-<space>].tif|png`. Formats `tiff16`, `png16`, `png8`; spaces sRGB, Display P3,
  Adobe RGB, ProPhoto RGB; the ICC profile is embedded unless the recipe's export signal is `none`.
