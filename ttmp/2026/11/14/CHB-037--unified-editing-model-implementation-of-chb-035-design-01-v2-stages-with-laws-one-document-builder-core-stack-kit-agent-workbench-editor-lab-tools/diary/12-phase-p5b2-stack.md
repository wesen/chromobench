---
Title: Diary — phase P5b-2 stack kit
Ticket: CHB-037
Status: active
Topics:
    - architecture
    - ui
    - webgpu
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://packages/shell/src/build/shell.ts
      Note: ModuleProps.stages and the stages modifier
    - Path: repo://packages/studio-kit/kits/stack/src/commands.ts
      Note: layer.* and mask.* commands, mask tools
    - Path: repo://packages/studio-kit/kits/stack/src/dom.ts
      Note: The one row, amount control, mask chip, provenance chip; layers/params/masks renderers
    - Path: repo://packages/studio-kit/kits/stack/src/kit.ts
      Note: 'The stack kit: forms, builders, specialised views, Edit and Scene modules, product'
    - Path: repo://packages/studio-kit/kits/stack/src/model.ts
      Note: Rows, the law in words, structural edits as mutations, masks, provenance
    - Path: repo://packages/studio-kit/kits/stack/src/passes.ts
      Note: The stage policy pass CB-S101/S102 (replaces CB-F101)
    - Path: repo://packages/studio-kit/layouts/classic.js
      Note: 'Arrangement 1 and 3: Edit module, Scene module when scene ops exist'
    - Path: repo://packages/studio-kit/layouts/darkroom.js
      Note: 'Arrangement 2: Enlarger stack view and the digital palette'
    - Path: repo://packages/studio-kit/src/model/history.ts
      Note: jumpCrosses for the History jump confirmation
    - Path: repo://packages/studio-kit/src/sel.ts
      Note: Ratings in the document tier, merged into library entries
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T01:29:46.707965-05:00
WhatFor: ""
WhenToUse: ""
---


# Diary

## Goal

The phase agent's record of phase P5b-2 of CHB-037: one stack kit (`cb.kits.stack`) for every stage, generic over
the catalogue and the stage laws, with its specialised views (the Enlarger, the darkroom's Exposures, the finish
view); the stage policy pass that replaces CB-F101; the arrangements (classic with an Edit module, the darkroom with a
collapsible digital palette, a Scene module that appears when the catalogue has scene ops); and the two behaviour
fixes P5b-1 decided (ratings in the document tier, a History jump that asks before it crosses other frames). Spec:
plan `design-doc/01-implementation-plan-and-working-rules.md` §8 "P5b-2" with every amendment; design: CHB-035
design 01 v2 (opening, Part I §4–§7, §20–§25, §30–§33).

## Step 1: Reading the spec, the design and the code; the decisions before code

The main agent assigned me phase P5b-2. I read the working rules and the P5b-2 spec with the amendments after P0,
P1, P2a, P5a, P3/P4, P6a and P5b-1, the design's opening, Part I §4–§7, §20–§25 and §30–§33, the phase diaries 04
(P5a: forms, products, fragments), 08 (P4 Step 5: the log and store API) and 09 (P5b-1: the studio on documents),
the main diary's Step 9 (the two behaviour fixes), `packages/shell/README.md`, `packages/values` (log, mutations),
the contract's `document.ts`, `stage-laws.ts`, `registry.ts` (`opsForStage`), `catalog/layers.ts` and the mask ops,
and the studio-kit code the stack kit replaces or plugs into (cb.ts, the panels' renderers, `dom/arg.ts`,
`kit/args.ts`, `model/{doc,controls,tools,history}.ts`, the finish kit, the layouts, the demo and its browser specs).

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all."

The owner's goal (verbatim): "the target goal is to a have a powerful professional lightroom for my dad, who often
works with film (either scanning, or as film simulation), but have a flexible UI language that allows for many
reconfigurations of the application while looking cohesive and elegant. We also combine high performance webgpu
functionality, and are adding a full layer system photoshop/traditional lightroom capabilities."

**Assistant interpretation:** The main agent assigned me P5b-2: `cb.kits.stack` (layers, params and masks panels,
the "+ Layer" menu from `opsForStage`, mask tools, a command table, every edit a transaction of the log, provenance
chips from `log.why`), the specialised views, the stage policy pass replacing CB-F101, the arrangements, the two
behaviour fixes, deletion of what the kit replaces, and the checks including the headless browser suite on ports
5571–5574 with new specs.

**Inferred user intent:** The photographer gets one layer system that looks and behaves the same in every stage and
every arrangement, so new ops (P8a's curve, levels, …) and new arrangements cost no new UI code.

### What I did
- Read the documents above; `pnpm install --frozen-lockfile --prefer-offline`; baseline `pnpm typecheck` clean,
  `pnpm exec vitest run packages/studio-kit apps/studio packages/shell` → 38 files, 385 passed, 1 skipped.
- Created this diary (`docmgr doc add --ticket CHB-037 --doc-type diary --title "Diary — phase P5b-2 stack kit"`),
  renamed docmgr's `11-diary-phase-p5b-2-stack-kit.md` to `12-phase-p5b2-stack.md`.

### Why
- The kit sits on four existing APIs (the catalogue and laws, the values mutations and log, the shell's forms and
  products, studio-kit's control renderer); the decisions below are the ones they leave open.

### What worked
- Everything the kit needs exists: `opsForStage(stage)`, `getLaw(STAGES[stage].law)` with `blend`, `groups`,
  `amount`, `amountRange`, `order`; `BLEND_MODES`; `MASK_COMPONENT_KINDS`/`MASK_COMBINES`; `readableCuts(stage,
  kind, 'mask')`; the four mutations; `log.why(f, id)` (a path that is an entry id gives the whole entry; `getPath`
  of an absent id is `undefined`, not an error).

### What didn't work
- N/A (reading).

### What I learned
- The shell's `listview` is virtualised with a fixed row height, so it cannot hold rows of different heights (the
  Enlarger's main exposure row carries its time, aperture and filtration controls). The stack panel has its own
  renderer with keyed rows that update in place (a re-render during an amount drag would destroy the slider).
- Store tiers are path prefixes: anything not under a view prefix is the document tier. Ratings therefore need a
  top-level slice of their own (`ratings`), not fields inside the view-tier `catalog`.
- The roll kit (P7's) reads flags straight from `s.catalog.frames` (`rejectedOf`); moving ratings breaks that read.

### What was tricky to build
- N/A (reading).

### What warrants a second pair of eyes
- The decisions below.

### What should be done in the future
- N/A for this step.

### Code review instructions
- Nothing to review yet.

### Technical details

Decisions the spec does not make (the code follows them):

1. **Where the kit lives**: `packages/studio-kit/kits/stack/src/` (model, kit, commands, tools, passes headless;
   `dom.ts` the renderers; `stack.css`). Every layout's darkroom panel is a stack view, so `cb.studio()` installs the
   stack kit beside cb.core and the stack renderers are part of `CB_RENDERERS`; `cb.kits.stack` is the product.
2. **Selection** is view state of the kit: `stack.selected[frame]` (an entry id), so the params and masks panels
   follow the row the photographer clicked, per frame; group collapse is `stack.collapsed[id]`.
3. **Rows**: one row component (`stack.row`), used by default and composable in a custom `row` lambda (θ, called
   once per row and again only when the row's id, kind, op or depth change). Rows read their entry through a cell
   of their own; the panel re-keys rows only when the structure changes.
4. **"+ Layer"** lists `opsForStage(stage)` minus the ops a law makes unique (`term: 'main'`, the main exposure)
   and the coalescible ops the spot tools make (`coalesce`: heal, clone). New params: the ArgSpec defaults, with
   the darkroom's usual starting values (`newDarkroomLayer`) where an op's validation needs a choice (time or
   stops). An identity layer (a curve at its defaults) is allowed: it compiles to nothing until it is changed.
5. **Blend** shows only when the law allows it and there is more than one choice (today `BLEND_MODES` is
   `['normal']`; P8a's W3C set makes the control appear without a change here). Groups offer `pass` plus the modes
   when the law has isolated groups.
6. **Amount** is one control: the law's range (light: 0–200 % on the track, typed up to the law's 1600 %; composite
   and repair: 0–100 %) with the law's unit hint ("time", "density", "opacity").
7. **Provenance chip**: the author of the last change of the entry (`log.why(f, id)`, folded once per log version
   for all rows of a frame), and in the tooltip who made it (`entry.source`) and the last change's label.
8. **Delete** removes the entry and also its mask when no other entry uses the mask (one step).
9. **Stage policy pass (CB-S101/S102)**: a module declares `stages` (shell `ModuleProps.stages`, `m.stages(…)`);
   the pass collects the stages a module shows from layer controls (`cb.arg('<id>.params.<arg>')`: the op's
   catalogue `stages`) and stack nodes (their `stage`); media controls are a stage's settings and are not counted
   (the darkroom shows the film stock and the viewing light that set up the print). Showing an undeclared stage is
   a warning (CB-S101); declaring an unknown stage an error (CB-S102, with did-you-mean).
10. **Scene module**: built when `opsForStage('scene')` is not empty (a build-time choice in the layout), with the
    finished print in the viewer (the scene cut is not display-referred); on a negative scan the panel says the
    frame has no scene stage.
11. **History jump**: the panel asks inline ("This also undoes N later changes on <frames>" with Jump anyway /
    Cancel) instead of a browser dialog; `history.jump` itself stays a plain command (the agent and the palette).

## Step 2: The stack kit, the stage policy pass, the specialised views, the arrangements

I wrote `cb.kits.stack` in one pass, because its parts share one model: `kits/stack/src/model.ts` (pure: rows, the
law in words, every structural edit as the four mutations, masks, provenance), `commands.ts` (the command table and
the mask tools), `passes.ts` (the stage policy), `state.ts`, `kit.ts` (forms, builders, the specialised views, the
Edit and Scene modules, the product) and `dom.ts` (the renderers). Then I deleted what it replaces, moved the
darkroom's Exposures panel and the finish module onto it, and rewrote the classic and darkroom layouts as the
design's arrangements 1–3. The kit's own tests passed on the first run, which made me read the move arithmetic
twice; it is right because values' `move` counts the target index without the moved item.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Spec items "cb.kits.stack", "specialised views", "the stage policy pass replaces
CB-F101", "arrangements", "hard cut-off".

**Inferred user intent:** One layer system that every arrangement composes, cohesive by construction.

**Commit (code):** ac8781c — "CHB-037 P5b-2: cb.kits.stack (layers, params and masks panels, + Layer from
opsForStage, mask tools, layer.* and mask.* commands through the log, provenance from log.why), the stage policy pass
CB-S101/S102 replacing CB-F101, ModuleProps.stages; …"

### What I did
- Shell (the one change there): `ModuleProps.stages`, `ModuleDef.stages`, the module modifier `.stages(...names)`,
  and `explain` prints `stages a, b` after a module's key.
- The kit: forms `stack.layers` (stage β, order β, density β, row θ, filter θ, add β, empty β, frame τ),
  `stack.row` (entry, stage, density), `stack.params`, `stack.masks`; commands `layer.select/add/duplicate/delete/
  rename/group/ungroup/move/up/down/toggle/amount/blend/collapse`, `mask.new/attach/detach/addComponent/
  removeComponent/set`; tools `mask-linear`, `mask-radial` (M), `mask-paint` (K), `mask-luminance`, `mask-colour`
  (enabled once `MASK_COMPONENT_KINDS` has `colour`); keys Mod+J, Mod+G, Mod+Shift+G; state `stack` (view tier).
- Product: `panels { layers, params, masks, exposures, enlarger, finish }`, `views { layers }`, `modules { edit,
  scene }`, `menus { layer }`, `sel { ops, selected }`, `lib` (the model), `maskTools`, `row`, `has(stage)`.
- cb: `cb.studio()` installs cb.core and the stack kit; `CB_RENDERERS` includes `STACK_RENDERERS`;
  `studio-kit.css` imports `kits/stack/src/stack.css`; the Print module declares `stages: ['darkroom']`, places
  `stack.panels.exposures()`, the Layer and Mask panels, and the mask tools; `cb.menus.standard()` gains Layer.
- Finish kit: CB-F101 and its label pass deleted (CB-F102 stays), the tones panel, `finish.addClarity`,
  `finish.resetTones` and `FINISHING_PATHS` deleted; the module declares `stages: ['scan', 'print']` and shows
  `stack.panels.finish()` (retouch and clarity), the scan stage's Dust rows and the Layer panel; the spot list is
  gone (spots are rows); `spot.select` also selects the row.
- Deleted in cb.core: `cb.exposures` (form, renderer, `cb.panels.exposures`), `exposure.add/remove/toggle`, the
  tools `mask-ellipse`/`mask-gradient`/`mask-brush` and `maskGesture`, `maskedLayer`, `addDarkroomLayer`,
  `featherMm`, `exposureRows`/`ExposureRow`. The printing script names a burn's mask by its library name.
- Layouts: classic (Library, Roll, [Scene when the catalogue has scene ops], Print, Edit, Finish, Assistant,
  Output), darkroom (one module "Darkroom", `stages: ['darkroom', 'print']`: the Enlarger stack view, Paper, the
  collapsed "Digital (after the print)" palette, Layer, Mask, approvals), simple/tiny/lab declare `['darkroom']`.
- Tests: `test/stack/model.test.ts` (catalogue, law words, structural edits, drops, masks, filter), `kit.test.ts`
  (every command one step and one undo, refusals as toasts, provenance after an approved proposal, CB-S101/S102,
  explain), `catalogue.test.ts` (an op registered with stages scene and print reaches + Layer, adds with its
  defaults, and classic grows its Scene module); finish and model-units tests moved to the kit.

### Why
- One row component, one amount control, one mask chip and one provenance chip are drawn by one file, so every
  arrangement looks the same; specialised views are only options and lambdas (`order: 'kind'`, a `row` lambda,
  `filter`).

### What worked
- `pnpm exec vitest run packages/studio-kit apps/studio packages/shell` → 41 files, 405 passed, 1 skipped;
  `pnpm typecheck` clean; `pnpm lint` ok (468 file checks, colours ok); `pnpm gen:check` ok (26 files).
- Headless screenshots (studio-kit demo, `p5b2-shots/`) of classic Print and the darkroom arrangement looked as
  intended: rows with the law's caption, amount tracks at 100 % in the middle of 0–200 % for the light law, the
  mask chip dashed when empty.

### What didn't work
- `TS2339: Property 'enabled' does not exist on type '{}'` at `dom.ts(641,25)`: `Coll.empty()` needed its type.
- First build of every layout: `CK-B170 Unknown icon 'circle'` and `'contrast'` → the shell's `radial`, `linear`,
  `luma`, `colorrange` icons.
- `layouts.test.ts` explain lines read `stack.layers  stage "darkroom"  stage darkroom`: a form's explain function
  is appended to its props, so it must add only what the props do not say (now `light law · + Layer 6 ops`).
- `expected [ …(2) ] to have a length of 6`: the Enlarger's own controls live in its θ row lambda, made at
  interaction time, so the build-time pass sees only the two stack views.

### What I learned
- The stage policy can only see what the build sees: controls inside a θ lambda are not walked. That is the right
  boundary (the row lambda belongs to a view of one stage), but a layout that hides another stage's controls in a
  row lambda escapes the check.

### What was tricky to build
- Keeping a drag alive: a panel that redraws on every state change would destroy the amount slider during its
  preview. The stack panel keys rows on `id|kind|op|depth` and reorders DOM nodes; each row reads its entry through
  a cell of its own and updates in place; the params and masks panels rebuild only when the selected entry's
  identity (frame, id, kind, op) or the mask's component list changes.
- Provenance for every row on every redraw: `log.why(f, id)` folds the log per call, so `provenance(log, f)` folds
  once per log value (a WeakMap on the immutable `Log`) for all ids, comparing entry identity first.

### What warrants a second pair of eyes
- `deleteEntries` also removes a mask no other entry uses; `detachMask` likewise.
- `maskGesture` without a selected entry (or on the main exposure) makes a darkroom burn, as the old tools did.
- `idFor` names new layers after their op (`densityMask1`, not `contrast1`).

### What should be done in the future
- P7: `looks.modules.print` declares no stages (two CB-S101 warnings in the looks layout's reviewed snapshot).
- The catalogue has no `ui` on the mask ops' arguments; the masks panel uses the generic number control for them.

### Code review instructions
- Start at `packages/studio-kit/kits/stack/src/kit.ts`, then `model.ts`, `commands.ts`, `dom.ts`, `passes.ts`.
- `pnpm exec vitest run packages/studio-kit/test/stack packages/studio-kit/test/layouts.test.ts`.

### Technical details
- Explain snapshot changes (all layouts, reviewed): `cb.stack@1 (requires cb.core)` among the kits; modules print
  `stages …`; the Print module's `cb.exposures` became `stack.layers stage "darkroom" light law · + Layer 6 ops`
  plus the printing-script text and the Layer and Mask panels; the viewers' tools list the stack's mask tools;
  `exposure.*`, `finish.addClarity`, `finish.resetTones` left the command list and `layer.*`/`mask.*` joined it;
  classic gained the Edit module; the darkroom module is now "Darkroom" with the Enlarger stack view and the
  digital palette; the finish module lost `finish-spots` and `finish-tones` for `finish-layers`, `finish-dust` and
  `layer-params-finish`; counts of commands, keys, tools and passes grew accordingly; the looks layout has two
  reviewed CB-S101 warnings (P7's module).

## Step 3: The two behaviour fixes; browser specs for the stack panel and the arrangements

The fixes P5b-1 decided but could not implement. Ratings (flag, stars, colour label, keywords) moved out of the
view-tier `catalog` into a document-tier slice `ratings.<frame>` of the program's own document, so each rating is a
step of the log and a mis-rating is one Mod+Z; `sel.library` and `sel.entry` merge both. The History panel's jump
now asks inline before it crosses other frames' later steps, and marks this frame's steps that sit under them.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Spec item "The two behaviour fixes P5b-1 decided" and the acceptance's new specs.

**Inferred user intent:** No surprise in the history: a rating can be taken back, and a jump never silently undoes
another frame's work.

**Commit (code):** 190f4b1 — "CHB-037 P5b-2: ratings in the document tier (…), the History jump asks before it
crosses other frames' later steps (…); browser specs for the stack panel and the arrangements; e2e on the stack
views"

### What I did
- `sel.ts`: `Rating`, `NO_RATING`, `CatalogEntry` (what the catalog stores), `CbState.ratings`; a merged entry is
  cached per stored catalog object and rating (keyed on `strip(…)`, since cells read through tracking proxies).
- cb.core declares `ratings` (document tier); `rate(ctx, label, ids, patch)` in `commands/env.ts`;
  `frame.pick/reject/unflag/rate/label` and a new `frame.keywords` write it; the Studio's catalogue entries carry
  no rating; the metadata and library panels read merged entries.
- `model/history.ts` `jumpCrosses(log, f, to, nameOf)`; the History renderer asks ("This also undoes N later
  changes on <frames>." with Jump anyway / Cancel) and marks crossed steps (`is-crossed`, a ⤒ after the author).
- Browser specs (studio-kit project): `stack.spec.ts` (add, fade, toggle, group, drag into the group, mask from the
  chip, invert, reorder by drag, rename, eleven steps and eleven undos; provenance after an approved proposal; Edit:
  clarity, its controls, a linear mask drawn on the viewer, undo) and `arrangements.spec.ts` (classic's modules and
  stages, darkroom's Enlarger and digital palette, the finish view's spot row and Delete, ratings undo and the
  History confirmation). `e2e/studio-stack.spec.ts` on the real studio with `engine=gpu`.
- e2e: `studio.spec.ts` draws with `mask-radial` and adds the dodge from the Exposures panel's + Layer;
  `studio-interface.spec.ts` expects the `digital` panel where `exposures` was.

### Why
- The store's tiers are path prefixes, so a rating cannot be a document-tier field inside the view-tier catalog.

### What worked
- `test/behaviour-fixes.test.ts` (4 steps, one undo; opening adds no step; `jumpCrosses` back and forward).
- Studio-kit browser project: 19 passed on the first full run plus `roll.spec.ts` alone (below).

### What didn't work
- `expect(sel.entry(s(), f)).toBe(sel.entry(s(), f))` failed (Object.is) until the cache keyed on the stored objects
  (`strip`): every `rt.state` read wraps them in new proxies.
- `roll.spec.ts`: `Test timeout of 60000ms exceeded while running "beforeEach" hook … browser.newContext: Test
  ended.` in the full studio-kit run; alone it passed in 3.3 s (the browser did not start under load).
- `bridge.test.ts › adaptive drafts … a draft is sized to the time budget` failed once in a parallel vitest run and
  passed alone (timing under load).

### What I learned
- The roll kit reads flags from `s.catalog.frames` directly (`rejectedOf`, its contact-sheet caption).

### What was tricky to build
- The jump's crossing: the log has one cursor for all documents, so a jump to `to` undoes `steps[to … cursor)` (or
  redoes `steps[cursor … to)`); a step crosses when `docsOf(step)` names another document — including the main
  document (ratings, snapshots), which the panel calls "the library".

### What warrants a second pair of eyes
- Cross-scope edits, reported: `kits/roll/src/kit.ts` `rejectedOf` reads `s.ratings`, its caption reads
  `cb.sel.entry`; `test/roll/kit.test.ts` and `test/browser/roll.spec.ts` read `ratings`.
- Ratings are saved with the program's document (the workspace's `doc` part); library entries saved before this
  change keep their old rating fields in the catalog, which nothing reads any more.

### What should be done in the future
- P7: read ratings through `cb.sel.entry` / `cb.sel.rating` in the roll and looks kits.

### Code review instructions
- `packages/studio-kit/src/sel.ts` (`merged`), `src/commands/env.ts` (`rate`), `src/model/history.ts`
  (`jumpCrosses`), `src/dom/panels.ts` (history).
- `pnpm exec vitest run packages/studio-kit/test/behaviour-fixes.test.ts`; browser:
  `STUDIO_PORT=5571 STUDIO_KIT_PORT=5572 SHELL_DEMO_PORT=5573 GPU_PARITY_PORT=5574 CI=1 pnpm exec playwright test
  --project=studio-kit`.

### Technical details
- History wording: "This also undoes 1 later change on roll-02.tif." / "This also redoes …".

## Step 4: The whole browser suite, the full checks, what is left

Two full headless runs of the browser suite on SwiftShader (ports 5571–5574), the full repository checks, an e2e
spec of the stack on the real studio's GPU engine, and the notes for the phases after this one. Each failure in the
full runs passed when its spec ran alone; the one real failure was a race in my own spec.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The spec's acceptance: typecheck, lint, gen:check, vitest, the browser suite with
the new specs; a precise report of what remains.

**Inferred user intent:** The phase merges green and the next phases know what they inherit.

**Commit (code):** 0e3b454 — "CHB-037 P5b-2: e2e spec of the stack on the GPU engine (…); the darkroom arrangement
spec waits for the new row; shell README on module stages; CONTRACT-REQUESTS notes …"

### What I did
- `e2e/studio-stack.spec.ts` (chromium-webgpu, `engine=gpu`): a burn through a radial mask drawn on the print (one
  step, the shown node changes), a clarity layer from the Edit module faded to 40 %, three steps, two undos give
  the node after the burn again.
- `packages/shell/README.md`: module `stages`; `CONTRACT-REQUESTS.md`: the finishing-tones notes superseded.
- Runs: `STUDIO_PORT=5571 STUDIO_KIT_PORT=5572 SHELL_DEMO_PORT=5573 GPU_PARITY_PORT=5574 CI=1 pnpm test:browser`.

### Why
- The demo specs run on MockEngine; the stack's ops (burn through a mask, clarity) must also render on WebGPU.

### What worked
- Full checks: `pnpm typecheck` 0 errors; `pnpm lint` ok (468 file checks, colours ok); `pnpm gen:check` ok (26
  files); `pnpm exec vitest run` → 128 files, 2958 passed, 19 skipped.
- Browser run 1: 121 passed, 1 skipped (the BENCH-gated bench), 1 failed (my race, below).
- Browser run 2: 120 passed, 1 skipped, 2 failed — `e2e/output.spec.ts:17` (`browserContext.close: Test timeout
  of 60000ms exceeded`) and `e2e/studio-real.spec.ts:156` offline (`toHaveAttribute … /GPU/ … element(s) not
  found`); both specs alone: 7 passed. Per project: chromium-webgpu 50 (+1 studio-stack), gpu-parity 47 + 1
  skipped, shell-demo 3, studio-kit 20 (+7: stack 3, arrangements 4).

### What didn't work
- Run 1: `arrangements.spec.ts:41` `expect(ids).toEqual(['main', 'burn1', 'lights'])` received `['main',
  'lights']`: the rows were read before the step's redraw; the spec now waits for three rows (passed twice with
  `--repeat-each=2`).

### What I learned
- Under the full suite's load the load-dependent studio specs (`output.spec`, the offline start) time out now and
  then, as P5b-1 saw with `film.spec.ts`; they are not about this phase's code.

### What was tricky to build
- N/A (validation).

### What warrants a second pair of eyes
- The load-dependent timeouts above, if they recur on the integration branch.

### What should be done in the future
- **P8b (UI for P8a's ops)**: new ops appear in "+ Layer" of their stages by `stages` alone; their controls are
  `cb.arg` controls where `ArgSpec.ui` exists and the generic number/enum control otherwise; `ui.advanced: true`
  puts an argument under Advanced; list arguments (a curve's points) get no control: they need an editor per op
  (suggestion: an `editors` option on `stack.panels.params`, or a fragment on `stack.params`); the blend select
  appears when `BLEND_MODES` grows; `mask-radial` draws an `ellipse` component until a `radial` kind exists (switch
  `maskComponent`), and `mask-colour` enables itself once `MASK_COMPONENT_KINDS` has `colour` (its click adds the
  op's defaults: a sampled colour needs a measurement of the cut it reads). The Scene module appears in classic
  once `opsForStage('scene')` is not empty; its viewer shows the finished print.
- **P7**: ratings are `ratings.<frame>` (document tier): read them with `cb.sel.entry`/`cb.sel.rating`; I changed
  `kits/roll/src/kit.ts` `rejectedOf` and the contact-sheet caption, `test/roll/kit.test.ts` and
  `test/browser/roll.spec.ts` (two lines each); `looks.modules.print` should declare `stages: ['darkroom']`.
- **P6b (workbench)**: the stack's actions are commands (`layer.*`, `mask.*`, ids default to the selected entry
  `stack.selected[frame]`); `cb.kits.stack.lib` holds the pure model (rows, addable ops, every edit as mutations,
  `provenance`); a layout an agent writes declares its modules' stages and gets CB-S101 otherwise.
- CHB-029 items 5 (status bar, dialogs) and 6 (jobs) were not done in this phase.

### Code review instructions
- `git log --oneline task/chb-037-unified-model..` on this branch; run the commands above.

### Technical details
- New browser specs: `packages/studio-kit/test/browser/stack.spec.ts`, `arrangements.spec.ts`,
  `e2e/studio-stack.spec.ts`. Changed: `e2e/studio.spec.ts`, `e2e/studio-interface.spec.ts`,
  `packages/studio-kit/test/browser/roll.spec.ts`.
