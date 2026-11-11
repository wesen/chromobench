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
