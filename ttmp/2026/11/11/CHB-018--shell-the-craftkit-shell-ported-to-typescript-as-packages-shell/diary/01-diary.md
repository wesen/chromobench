---
Title: Diary
Ticket: CHB-018
Status: active
Topics:
    - ui
    - js-api
    - architecture
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T15:10:21.626178027-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-018 Shell port

## Step 1: Intern guide written

This step writes the implementation guide for `packages/shell` (`ck`), the TypeScript port of CraftKit Shell v1 that
every UI ticket builds on. I read the shell sources in CHB-016 (`src/shell/**`, `docs/SHELL.md`, the three Node tests),
the UI design brief, CHB-016 diary Steps 2–4, CHB-009's presenter, RenderScheduler, storage and gesture modules, the
contract's EditLog, and the repo conventions, then wrote a file-by-file port plan plus the new mechanisms.

The guide keeps CraftKit's grammar and runtime nearly whole and adds: per-instance `createCk()` (no globals), headless
form specs separate from DOM renderers, store prefix tiers, named preview layers and routes (recipes routed to an
EditLog adapter, mirrored for reads), a render bridge plus a slot/lane render queue replacing CraftKit's compile-once
engine, fragments with late method resolution, kits, a pass manager over named IRs, `explain`, and typed Presenter,
RenderBridge, HistoryAdapter, PersistenceAdapter and theme token interfaces.

### Prompt Context

**User prompt (verbatim):** "before we move on, now that we have worked out what to do with craftkit, let's create the
tickets and design guides (remember, no need to be overly correct in the guides, they are \"guides for impementation\"
after all, and we'll sort out details as we work) for the proper UI. Allow the UI to be entirely expressed using the
JS API, so that we can create many different versions of it."
**Assistant interpretation:** Write CHB-018's implementation guide (port plan, typing, new mechanisms, stages,
testing), file tasks and related files, and record this step; no code.
**Inferred user intent:** A guide good enough to start implementing the shell, consistent with the shared brief and
the sibling UI guides.
**Commit (code):** none (the orchestrator commits all guides together).

### What I did
- Read `CK/src/shell/{index,shell}.js`, `core/{store,history,track,cells,commands,keys,diag,util,engine}.js`,
  `ui/{node,dom,habits,dock,viewport}.js`, heads of `chrome.js`, `icons.js`, `forms/*.js`, `shell.css`;
  `CK/test/{core,keys,engine}.test.mjs`; the Runtime Inspector in `CK/src/app/main.js`.
- Ran `node test/core.test.mjs && node test/keys.test.mjs && node test/engine.test.mjs` in the CHB-016 sources (Node
  v24.18.0): all passed.
- Read `apps/studio/src/present/presenter.ts`, `presenter-webgpu.ts` (head), `core/scheduler.ts`, `core/store.ts`,
  `core/gesture.ts`, `core/frame-session.ts`, `storage/db.ts`, `studio.css` tokens; CHB-009 guide §5.6;
  `packages/contract/src/{editlog,errors,engine}.ts`; `tsconfig.base.json`, `vitest.config.ts`,
  `playwright.config.ts`, `tools/scripts/check-boundaries.ts`, `packages/engine-mock/package.json`.
- Grepped CHB-020/021/022 guides for their `ck.fragment`/`ck.kit`/`ck.pass` usage and adopted their names.
- Wrote `design-doc/01-intern-guide.md`; 16 tasks with `docmgr task add`; 8 related files with `docmgr doc relate`.

### Why
- Services (bridge, presenter, adapters, persistence) are passed at start/mount rather than recorded, so one variant
  builds headless with fakes and runs in the browser with the real engine.
- Routes with mirrors keep the EditLog the single authority for recipes while tracking and bindings stay unchanged.

### What worked
- CraftKit's shell maps cleanly onto the brief; most files port as-is. The CHB-009 Presenter interface only needs
  shell-local copies of `Box`/`SampleData` to be generic.

### What didn't work
- The first draft was about 9,800 words by the checker; cut to 7,990 (including code blocks) in the second pass.

### What I learned
- CraftKit's headless blockers are few and specific: `instanceof Node` in `isProps`, `Chrome`/`Dock` built in the `App`
  constructor, `document.activeElement` in the scope chain, module-level registries and `isMac`.
- `basic.js` lets `reset` be a lambda although the slot is β (would trigger B140); the port makes it τ.
- `parseValue` uses `Function()`, which a strict CSP forbids.

### What was tricky to build
- Build-time checks of frame-dependent bindings (`s.recipes[s.ui.frame]…`) against an empty state: proposed a tracker
  probe mode plus route `checkPath` with a wildcard key segment, replacing CraftKit's `lazy: true`.
- Fragment methods called before `.use(kit)`: proposed recording pending calls on nodes and resolving them in the
  `normalize` pass.

### What warrants a second pair of eyes
- DR-5 (routed recipes, compound undo) and the interleaved-undo policy when an EditLog moves outside the global stack.
- Named preview layers for agent proposals versus CraftKit's single gesture layer.
- Whether CHB-009's presenters should move into the shell (DR-6 keeps them in chromobench).

### What should be done in the future
- Verify whether vitest rewrites `Error.stack` (call sites) in stage 1; decide happy-dom vs Playwright for DOM tests;
  settle `kit.state(...)` argument shape with CHB-020.

### Code review instructions
- Start at the guide sections 4.3 (file table), 5.4 (store extensions), 5.9 (interfaces) and 7 (stages).
- `python3 -I ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/scripts/08-check-guide-markdown.py <guide>`

### Technical details
- Guide: `ttmp/2026/11/11/CHB-018--shell-the-craftkit-shell-ported-to-typescript-as-packages-shell/design-doc/01-intern-guide.md`.
- CraftKit shell: 3,893 lines JS + 377 lines CSS; constants kept: coalesce 1.5 s, history limit 500, proxy 384 px,
  thumb cache 400, idle slice 12 ms, autosave debounce 700 ms, slow frame > 24 ms, ten-pass loop limit.

## Step 2: Stage 1 — the headless core, builders, kits, fragments, passes, explain and the render queue

This step creates `packages/shell` and ports CraftKit Shell v1's headless half to TypeScript: util, diag (one
`diag()` producer, library roots for `site()`), store (prefix tiers, named preview layers, routes with adapters and
mirrors), track (probe mode), cells and scheduler (injectable `Clock`, per-store cell ids, the effect loop as a
callback), history (store patches plus parts from other sources, skip-if-stale, `push`), commands and keys
(platform parameter, headless `dispatch`). On top: the node IR with typed slots and chainable Proxy nodes,
`createCk()`, the shell and module builders, kits, fragments with late resolution, the pass manager, CraftKit's
`App.check()` split into `ui` passes, `explain`, the headless `Runtime` (start/boot, ctx, recording chrome, workspace
state, persistence, inspect) and the render queue with the bridge and presenter interfaces. Because the builder,
fragments and passes are intertwined, I built stage 4's mechanisms together with stage 1 instead of after it.

All of CraftKit's `core.test.mjs` and `keys.test.mjs` cases pass in vitest, plus new tests for the extensions; the
mini studio fixture (Library + Develop) builds in Node with zero errors and zero warnings.

### Prompt Context
**User prompt (verbatim):** the orchestrator's task (not the user's own words): "You implement ticket CHB-018
(Shell: the CraftKit Shell ported to TypeScript as packages/shell) in the chromobench monorepo, in your own git
worktree. […] Pragmatic over perfect; the user asked not to overdo polish. Finish the core runtime and forms
solidly; leave clear TODOs and open tasks for the rest."
**Assistant interpretation:** Port the shell file by file following the intern guide, add the new mechanisms,
keep CraftKit's tests, stay in `packages/shell` plus the boundary script, commit at milestones with green checks.
**Inferred user intent:** A shell CHB-019 can build studio-kit and the variants on, testable headless.
**Commit (code):** c915598 — "CHB-018: packages/shell stage 1 — headless core, builders, kits, fragments, passes, explain, render queue"

### What I did
- Branch `task/chb-018-shell`; `pnpm install --frozen-lockfile --offline`; baseline `pnpm test`: 32 files, 1829 tests.
- `pnpm add -D happy-dom --filter @chromobench/shell`, then pinned `"happy-dom": "21.0.4"` (the repo pins exact versions).
- Wrote `packages/shell/src/core/{util,diag,track,store,history,clock,cells,commands,keys,math}.ts`,
  `ir/{slots,node,forms,icons}.ts` (icons generated from CraftKit's `icons.js` with a scratch script),
  `build/{types,passes,fragments,recorders,kits,shell-builder,checks,explain,ck}.ts`,
  `app/{assemble,builtins,chrome,workspace,persist,runtime,built-app}.ts`, `app/render/{types,queue}.ts`,
  `themes/{lightroom,chromogen}.ts`, `testing/index.ts`, `index.ts`.
- Tests: `test/core/{core,keys,store-ext}.test.ts`, `test/build/{build,extend,types}.test.ts`,
  `test/app/{runtime,render-queue}.test.ts`, `test/fixtures/mini-studio.ts`.
- `tools/scripts/check-boundaries.ts`: `packages/shell/src` imports only relative files; `core, ir, build, app, themes,
  testing` and `src/index.ts` never import `dom/`.

### Why
- Kits, fragments and passes shape the builder (`use()`, late method resolution, the normalize pass), so writing
  them after the builder would have meant rewriting it.
- Slot checks moved from node creation (CraftKit's `node()`) to the `slots` pass: a kit's form is not known when a
  node of it is created before `.use(kit)`.
- Commands keep CraftKit's `run(ctx, ...args)` (ctx first); other ρ handlers get ctx last, as in CraftKit.

### What worked
- `npx vitest run packages/shell`: 8 files, 78 tests. `pnpm typecheck` clean, `pnpm lint`: "import boundaries ok
  (197 file checks)", `pnpm test`: 39 files, 1906 tests (before the type test file was added).
- Call sites are exact under vitest: the B110 test asserts `at.line === 38` in `build.test.ts` (the guide's TODO on
  whether vitest rewrites `Error.stack` is answered: the positions are the TS source's).
- The guide's draft/screen numbers come out exactly: `chooseTarget` gives 866 (draft, 0.5 MP of 3:2) and 2432
  (screen, 2352 rounded up to 128) for the 6000 × 4000 scan in a 1176 × 784 pane at dpr 2.

### What didn't work
- First `pnpm typecheck`: 27 × `error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.` —
  constructor parameter properties (`constructor(readonly store: Store)`). Rewrote them as fields.
- A one-shot shell pipeline to generate `icons.ts` was refused by the worktree guard ("this command is too complex
  to verify that it stays inside the worktree"); a node script in the scratchpad did it.
- `B130` suggested `'style'` for the typo `stpe` (Levenshtein 2 for both `style` and `step`); switched `lev` to
  optimal string alignment (a transposition costs 1).
- `X120` suggested `.tip()` for `.testStip()` because CraftKit's `suggest` scores any substring match 0.5; now a
  substring only counts when the shorter name is at least half the longer one.
- `ck.text(s => …)` gave `TS7006 implicitly has an 'any' type`: `Traced<S, unknown>` collapses to `unknown`, which
  loses the contextual function type. `Traced` now keeps `(s: Readonly<S>) => unknown` for unknown value types.

### What I learned
- `unknown | F` is `unknown`, so every τ slot typed `unknown` silently untyped its lambdas.
- In probe mode the binding explain shows its dependency: `bind dev.«ui.selection.primary».light.exposure`, because
  the probe's `Symbol.toPrimitive` renders the path it stands for when used as a key.

### What was tricky to build
- Late fragment resolution: nodes are Proxies whose unknown method names return a recorder; data fields, chain
  methods, probes (`then`, `toJSON`, `asymmetricMatch`, …) and known slot setters are answered directly. The
  normalize pass rebuilds each tree bottom-up (`mapTree`) applying pending calls; a method's own result may record
  further calls, which are applied recursively.
- Probe mode versus B110: in probe mode `s.dev.light.exposur` also returns a probe, so "a probe was used" alone
  cannot downgrade an error to B111. The bindings pass downgrades only when the first missing key is not the last
  path segment (a read went through a missing value before the leaf).
- `rt.flush()` runs frames synchronously while the clock still holds the queued callback; the scheduler now tags
  each request with a ticket so a stale clock callback does nothing.

### What warrants a second pair of eyes
- `Store.commitPatches`: routed patches whose adapter returns no part are undone by the store itself (they are
  added to the entry's patches); with parts, the adapter owns undo. Check this matches CHB-019's EditLog bridge.
- `History.undo` skipping entries whose every part returns `false` (interleaved undo, guide §9.1).
- Fragment methods use `this` as the node (CHB-018/020/021/022 guides); CHB-019 §4.7 sketches `(n, opts) =>`.

### What should be done in the future
- Stage 2 (DOM), the demo page and Playwright smoke; stage 3's viewport and Canvas2D presenter.

### Code review instructions
- Start at `packages/shell/src/build/ck.ts` (the namespace), `app/built-app.ts` (`buildApp`), `build/checks.ts`
  (passes), `core/store.ts` (`commitPatches`, `layer`, `route`), `core/history.ts` (`undo`).
- `npx vitest run packages/shell && pnpm typecheck && pnpm lint`.

### Technical details
- Diagnostic codes added beyond CraftKit: B114 (path not in route), B151/B152 (toolbar/button names a missing
  command), B160 (unknown form), B170 (unknown icon), B180 (unlabelled icon button), I010/I011 (reach), L340 (a
  handler threw), P510 (effect loop), T430 (route refused a tx), T431 (undo skipped a stale part), T432 (route without
  adapter), T440/T441 (autosave/restore failed), X101/X102 (kit conflicts/override), X110 (fragment conflict),
  X120–X123 (fragment calls), X130/X131 (kit deps), X140/X141 (pass order), X150 (a pass threw).

## Step 3: Stages 2–3 — the DOM half, renderers, the viewport on the bridge and presenter, the demo

This step ports CraftKit's DOM half to `packages/shell/src/dom/`: the helpers (`h`, `icon`, `listen`, `drag`), the
habits (scrub, nudge, reset, rename, context menus, focus keys; arithmetic through `parseValue`, no `Function`), the
chrome (menu bar, menus, palette, shortcut sheet, dialogs, toasts, flashes, tooltips), the dock with splitters and
edge toggles, `mount`/`mountRuntime`, themes on tokens, and renderers for every built-in form. The viewport is
rebuilt on the stage-3 interfaces instead of CraftKit's worker engine: it asks `rt.renders` for a draft while its
own picture previews, a screen render otherwise and a refine of the visible region past 1:1, and shows results
through a `Presenter` (`Canvas2DPresenter` by default, `services.presenter` for CHB-009's WebGPU one). Thumbnails go
through the bridge on the background lane and the LRU cache.

A demo page (`packages/shell/demo`, the mini studio with 40 photos on a procedural gradient bridge) runs in
Chromium under a new `shell-demo` Playwright project; 14 happy-dom tests cover the behaviours the guide lists.

### Prompt Context
**User prompt (verbatim):** (same as Step 2 — the orchestrator's CHB-018 brief)
**Assistant interpretation:** Finish stage 2 (DOM, renderers, demo, behaviour tests) and the DOM side of stage 3
(viewport, presenter, thumbnails), keep everything green, commit.
**Inferred user intent:** A shell that mounts and can be driven in a browser, so CHB-019 can put studio-kit on it.
**Commit (code):** cd411e0 — "CHB-018: packages/shell stages 2–3 — DOM half, renderers, viewport on RenderBridge/Presenter, demo"

### What I did
- `src/dom/{h,habits,mount,theme,chrome,dock,viewport,presenter-2d,index}.ts`, `src/dom/forms/{basic,container,collection,plane}.ts`,
  `src/dom/shell.css` (generated from CraftKit's css; radii and font through `--radius`, `--font`, `--fontSize`).
- Slots added to the headless form specs: `keys` on collections, `label` on the viewport (CraftKit had both).
- The mini-studio grid cells now draw bridge thumbnails (`ck.view.thumb({ image: s => pictureOf(s, p.id), max: 160 })`).
- `test/dom/mount.test.ts` (`// @vitest-environment happy-dom`): frame, module switch, slider drag = one undo step,
  Escape cancels, disabled command with why, section reset in one step, Tab/F7 hide sides, collapsed panel survives
  reload, collection keys/selection, filter narrows the grid, thumbnails on the bg lane, viewport bridge → presenter
  with zoom commands, draft then screen during a drag, probe tool gets document pixels.
- `demo/{index.html,main.ts,gradient-bridge.ts,vite.config.ts}`; `test/browser/demo.spec.ts`; root
  `playwright.config.ts` gets the `shell-demo` project and a web server on `SHELL_DEMO_PORT` (default 4186);
  root `tsconfig.json` includes `packages/*/demo/**/*.ts`.

### Why
- The viewport's render path had to move to `rt.renders` + `Presenter` anyway (CraftKit's `app.engine` with
  expressions and `ImageBitmap`s does not exist here), so I wrote it against the interfaces CHB-019 will use.
- happy-dom does no layout: the tests that drag a slider give its track a 200 px `getBoundingClientRect`.

### What worked
- `npx vitest run packages/shell`: 9 files, 92 tests. `pnpm typecheck` clean. `pnpm lint`: "import boundaries ok
  (221 file checks)".
- `STUDIO_PORT=4421 SHELL_DEMO_PORT=4426 CI=1 pnpm test:browser --project shell-demo`: 3 passed (grid + thumbnails +
  keys + Enter to Develop; slider drag = one undo step with a `draft` render then `screen`, Ctrl+Z restores; Mod+K
  palette focus, Tab hides the sides). Screenshots (`SHELL_DEMO_SHOT=<prefix>`) show the Lightroom-like frame with
  procedural thumbnails and the fitted picture.

### What didn't work
- First DOM run, 2 of 13 failed: `expected 5 to be close to 1` — with a zero-size rect the slider's track is 1 px
  wide, the pointerdown counts as "on the knob" and every move saturates. Fixed by giving the track a layout in the
  test. The second (`expected 'screen' to be 'draft'`) had the same cause: no preview happened.
- `pnpm typecheck`: `TS2339: Property 'vp' does not exist on type …view…` in the test; read through `store.peek`.
- `pnpm test` (all packages) reports 1 failure: `packages/ingest/test/dust.test.ts > heal laws … Test timed out in
  5000ms` (one run had 3 such failures). `npx vitest run packages/ingest` alone: 922 passed. A load-dependent
  timeout outside this lane; not touched.
- A `mkdir … && cat > … <<EOF` shell command was refused by the worktree guard; wrote the files with the editor.

### What I learned
- The happy-dom canvas has no 2D context, so `Canvas2DPresenter` and the histogram treat a null context as a no-op;
  the viewport still computes its transform, which is what the tests check (presenter calls through `fakePresenter`).

### What was tricky to build
- The viewport's two coordinate systems: CraftKit's tool events and overlays use `u, v` fractions of the shown
  image; chromobench's tools want document pixels and the presenter wants a `ViewTransform` (document point at the
  canvas centre, CSS px per document px). The viewport keeps CraftKit's `ox, oy, s` and derives both:
  `cx = (W/2 − ox)/s`, `x = u·docW`, `ix = (x − region.x)·image.scale`.
- Draft versus screen: `want.previewing = store.previewing && key !== fullKey` (a preview elsewhere keeps this view
  sharp), and a store listener flips it back when the gesture ends; requests are deduplicated by
  `key|pass|maxSide|region` so a view change that does not change the target asks for nothing.

### What warrants a second pair of eyes
- `compare: 'lr' | 'tb'` (side by side) are drawn as a split at the image centre: the `Presenter` interface has one
  split position and no second pane. Either extend `ViewTransform` or accept the split.
- Thumbnails of a disposed grid keep rendering to completion (the queue has no per-scope cancel for the bg lane).

### What should be done in the future
- Stage 3 spike (task srn8, open): CHB-009's WebGPU presenter + MockEngine through a bridge on the demo page.
- Stage 5 (aj14, 3sh4, open): `ck.inspector()` panel, perf benches, generated reference page, wording review.

### Code review instructions
- Start at `packages/shell/src/dom/mount.ts` (`mountRuntime`, `MountCtx`, `Binding`), `dom/viewport.ts`
  (`request`, the render cell, pointer routing), `dom/forms/collection.ts`, then `test/dom/mount.test.ts`.
- `npx vitest run packages/shell && pnpm typecheck && pnpm lint`;
  `STUDIO_PORT=4421 SHELL_DEMO_PORT=4426 CI=1 pnpm test:browser --project shell-demo`;
  `pnpm --filter @chromobench/shell demo` and open http://localhost:4186/demo/.

### Technical details
- Render slots: `vp:<id>:after`, `vp:<id>:before`, `thumb:<bridge>:<key>|<max>`. The viewport sets
  `data-rendered="<w>x<h>"`, `data-pass`, `data-zoom`, `data-tool` for tests and emits `rendered` with
  `{ viewport, ms, w, h, pass, previewing }`.
- New runtime diagnostics: CK-V320 (a form without a renderer, at mount), CK-T420 (a tool's gesture ended with an
  open preview; it is committed for it).
