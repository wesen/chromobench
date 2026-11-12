---
Title: Diary
Ticket: CHB-020
Status: active
Topics:
    - ui
    - darkroom
    - ingest
    - product
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T15:10:21.908139315-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-020 Roll workflow

## Step 1: Intern guide written

I wrote the implementation guide for the roll kit (`cb.roll.*`): roll setup, automatic first print, contact sheet and cull, and "print the roll like this frame" as one mutation batch. The guide reads the Phase-1 conditioning and balance code and maps roll analysis onto it as a pass producing a shared roll fragment plus per-frame deltas. The central finding is that roll balance needs no new colour maths: `integrateToGrey` with the reference frame as the aim is "print like this frame".

I also added 15 staged tasks and related 8 files. The guide is about 7,600 words including code. Nothing was run beyond the markdown checker; all numbers are copied from the CHB-006/003 guides or marked illustrative.

### Prompt Context
**User prompt (verbatim):** "before we move on, now that we have worked out what to do with craftkit, let's create the tickets and design guides (remember, no need to be overly correct in the guides, they are \"guides for impementation\" after all, and we'll sort out details as we work) for the proper UI. Allow the UI to be entirely expressed using the JS API, so that we can create many different versions of it."
**Assistant interpretation:** Write the CHB-020 implementation guide following the UI brief and the writer brief.
**Inferred user intent:** A usable starting point for building the roll workflow as a swappable kit.
**Commit (code):** none (the orchestrator commits all guides).

### What I did
- Read the UI design brief, the writer brief, `packages/ingest/src/conditioning/*`, `packages/core/src/print/balance.ts`, `packages/contract/src/{recipe,paths,mutations,editlog}.ts`, the source-scan-invert and darkroom catalogs, and CraftKit `cull.js`, `library.js`, `develop-model.js`.
- Skimmed CHB-006, CHB-003, CHB-010 and CHB-013 guides for Gold 200 numbers, balance and the sample-roll layout.
- Wrote `design-doc/01-intern-guide.md`, added tasks, related files, ran `08-check-guide-markdown.py` (clean).

### Why
- Copy shared settings into each frame (decision record 1) instead of inheritance, to keep recipes self-contained for sidecars, content addressing and the closed mutation set.

### What worked
- `AutoBalance` already has `roll` and `match` methods, so the contract needs few additions.

### What didn't work
- The CHB-016 guide is still a template, so kit/fragment/pass API shapes follow the brief's section 5 and may need adjusting to it.

### What I learned
- `scan.rebate` is a frame-local box, so a roll-wide base has no home in the recipe (proposed `scan.baseT`).
- Flare is one number in the recipe, but ingest fits it per channel.

### What was tricky to build
- Deciding how a cross-frame batch relates to independent per-frame EditLogs: proposed a `batch` id on `LoggedMutation`.

### What warrants a second pair of eyes
- The mapping from "roll consistency" to alpha and its default (0.5 first print) are guesses.
- The illustrative frame numbers in the traced flow.

### What should be done in the future
- Confirm the proposed contract additions with CHB-002/017 and reconcile API names with the final CHB-016 guide.

### Code review instructions
- Read `design-doc/01-intern-guide.md` sections 4, 6 and 7 first. Check with `python3 -I ttmp/2026/11/11/CHB-001--*/scripts/08-check-guide-markdown.py <guide>`.

### Technical details
- Balance reuse: `integrateToGrey(latd_f, {latd: latd_ref, lights: lights_ref}, alpha)` in `packages/core/src/print/balance.ts`.

## Step 2: Roll base and veil from the pixels, the roll kit, the roll variant

This step builds stages 1–6 of the guide in a first form. The demo's known gaps were the place to start: the
film base came from the brightest 5 % of columns (core's `rebateBox`, also `scan.density`'s rule without a box),
which on a scan with sprocket holes is the light itself, and nothing measured the scanner's flare. ingest now has
`filmLayout`: from the pixels alone it finds the opaque holder (whose reading is the veil: flare plus black-level
residue, per channel), the open gate (sprocket holes), the exposed image area and the rebate on the film edge
beside the frame, never the holes; `rollBase` takes the median over a roll's frames, with the spread and the
mixed frames; `conditionScan` is the host's one call at decode. On top, `packages/studio-kit/kits/roll` holds the
roll kit: analysis through any `Engine`, the first print and "print the roll like this frame" as mutation
batches, and `cb.kits.roll` (state, commands, forms, passes, renderers), used by a new `roll` variant.

The kit runs on MockEngine with planted 135 strips in a holder (sprocket holes, a 0.4 % veil, one frame with a
mixed base) and on the Gold 200 sample. On the planted roll the base comes back within 0.005 D, the veil within
1–2 %, flare 0.40 % against the holes, and exactly the mixed frame is flagged; on Gold 200 the rebate strip is
found inside the picked box within 0.005 D, and with the picked boxes σ and class shares reproduce the CHB-006
goldens at 1090×754. `pnpm test`: 2195 (baseline 2141).

### Prompt Context
**User prompt (verbatim):** the orchestrator's task (not the user's own words): "You implement ticket CHB-020 (roll
workflow: roll setup, first print, roll balance, contact sheet — the Negative-Lab-Pro replacement) […] Known demo
gaps that belong to you: the film base is taken from the brightest 5 % of columns, which is wrong for scans with
sprocket holes; no scanner flare correction. Implement roll-level base/flare measurement properly and make the
first print use it — as core/ingest functions plus the roll kit; do NOT edit apps/studio […] Your guide proposes
scan.baseT, scan.flare number|Vec3, LoggedMutation.batch, FrameRecipe.roll — write them to CONTRACT-REQUESTS.md
and work locally […] Be pragmatic."
**Assistant interpretation:** Stages 1–6 in studio-kit/kits/roll, roll base and veil as ingest functions, the
first print using them, a variant and a Playwright smoke; contract changes as requests; apps/studio untouched.
**Inferred user intent:** A first roll workflow the photographer can try in the dev host, and functions the
apps/studio host can call to fix the demo's base and flare.
**Commit (code):** 1cd443f — "CHB-020: roll analysis (ingest filmLayout, rollBase, planted strips), roll kit
engine and cb.kits.roll"; 1ec500f — "CHB-020: roll variant in the dev host, Playwright smoke, conditionScan for
the host"

### What I did
- Branch `task/chb-020-roll`; `pnpm install --frozen-lockfile --offline` (no node_modules in the worktree).
- Read the guide, the CHB-019 diary Step 2, `apps/studio/src/host/{engines,first-print}.ts`, core's
  `ops.ts` (`rebateBox`, `scan.density`), `print/balance.ts`, ingest's `conditioning/*`, the contract's
  `recipe.ts`, `graph.ts` (`compile`), `editlog.ts`, studio-kit's `cb.ts`, `editlog-route.ts`, `frames.ts`,
  `studio.ts`, the shell's `kits.ts`, `ck.ts`, `runtime.ts` (ctx), `store.ts` (`set`, `setMany`, `writeDoc`).
- Looked at the Gold 200 sample (8-bit preview) and its pixel values: no sprocket holes; the holder reads
  G ≈ 0.0006–0.003 (higher next to the film), the rebate strip G ≈ 0.68.
- ingest: `conditioning/film-layout.ts` (`filmLayout`, `shrinkRGB`, `subtractVeil`), `roll-base.ts`
  (`rollBase`, `frameBaseOf`, `conditionScan`), `planted-strip.ts` (`plantedStrip`, `GOLD200_BASE_D`);
  `test/film-layout.test.ts` (15 tests).
- studio-kit: `kits/roll/src/engine/{constants,model,measure,analyse,batch,lower}.ts`, `kits/roll/src/kit.ts`
  (`createRollKit`, installed as `cb.kits.roll` by `createCb`), `dom.ts` (`ROLL_RENDERERS`), `roll.css`,
  `index.ts`; `EditLogRoute.applyBatch` (one shared tx, one global undo step); `variants/roll.js`;
  `demo/roll-physics.ts` (the `RollPhysics` service from ingest + core), demo `?variant=roll` with six planted
  frames; tests `test/roll/{fixtures,engine,kit}.test.ts` (38) and `test/browser/roll.spec.ts`.
- Root: `tsconfig.json` includes `packages/*/kits/**/*.ts`; `check-boundaries.ts` rules for
  `packages/studio-kit/kits` (contract + shell only; headless never imports `dom.ts`); studio-kit devDependencies
  `@chromobench/core`, `@chromobench/ingest` (tests and the dev host; lockfile +6 lines).
- `packages/studio-kit/CONTRACT-REQUESTS.md` R3–R7: `scan.baseT`, `scan.flare: number | Vec3` plus the op in
  core and GPU, `LoggedMutation.batch`, `FrameRecipe.roll` and a `Roll` record, diagnostic codes.
- `docmgr task check` 3cg2, 5za7, ovf4, t7y5, pdf8, 1r6r, ez8u, g5ku, umlu, 85wk, 21al.

### Why
- The veil is read on the holder, not fitted: a camera scan in a holder shows opaque mask around the strip, and
  every pixel carries the same additive veil (textbook §3.1: T = T_meas − f·T_open). Subtracting the holder's
  median per channel is the flare correction; dividing by the open gate gives f when holes are in view.
- The host subtracts the veil from the pixels at decode (as it heals dust there) instead of writing
  `scan.flare`: only MockEngine implements the `scan.flare` op; core's RefEngine and the GPU engine fail with
  `E_NOT_IMPLEMENTED` (R4).
- The first print writes each frame's own rebate box (`scan.rebate`): the roll median has no home in the recipe
  (`scan.rebate` is a box in one frame's pixels), so it is evidence and the consistency check until `scan.baseT`
  (R3).
- Exposure bookkeeping as at an enlarger: total = lights + log10(t / 10 s); a total goes back as time on the
  1/6-stop grid plus lights (the demo's first print does the same). The analysis stores each frame's own
  departure λ = −(X̄ − total), so the first print, the match and a clear are pure arithmetic on the analysis, with
  no engine call.
- Roll consistency blends only the colour (mean removed) towards the roll's mean colour; each frame keeps its own
  density correction. Chromogen's `rollConsistency` blends the whole lights, which half-corrects a roll of
  differently exposed frames.
- The match is a user action previewed in the kit's view state (`rollView.pending`), one card, partial approval
  by frame, applied as one batch; agent proposals stay per-frame EditLog proposals until R5.
- The kit reads the physics as the service `rollPhysics` (studio-kit imports only the contract and the shell);
  `demo/roll-physics.ts` is the adapter and what apps/studio's host should build.
- Stock ranking only with an open gate: without one each channel's light level is unknown, so even the shape of
  the base (the guide's `shapeDiffD` fallback) is not measurable; the setup row says so.

### What worked
- Planted strip (ingest test): veil within 1 %, flare 0.40 % ± 0.02 %, base within 0.002 D, image area within
  2 px, the rebate box clear of every hole; without the veil correction the base reads 0.01–0.03 D thin; the
  brightest-columns rule misses the base by > 0.25 D.
- Gold 200: rebate box {x 1179, y 283, w 12, h 285} inside the picked {1174, 100, 20, 680}, T (0.1214, 0.6821,
  0.2157) vs golden (0.1205, 0.6793, 0.2139); holder veil (0.009, 0.08, 0.08) % of the base; `W_NO_OPEN_GATE`.
- Planted 12-frame roll through MockEngine: base within 0.005 D, `W_ROLL_MIXED` on exactly frame 11 (0.04 D),
  Gold 200 then C200 ranked, `W_ROLL_STOCK_AMBIGUOUS`; on core's RefEngine the rebate reads > 0.1 D before the
  first print and < 0.005 D after (the box the first print writes).
- Match law, 20 random trials: α = 1 gives ℓ_ref + Δ, α = 0 gives ℓ_ref + mean(Δ), equal to core's
  `integrateToGrey` to 1e-5.
- The command flow on the booted variant: New roll → analysis → first print (one `auto` unit per frame, one
  global undo step, undo restores every recipe's canonical JSON), reject, reference, match previewed (rejected
  frame skipped), slider replaces the pending batch, a frame unticked, approve, one undo. A frame changed after
  planning: `E_STALE`, nothing applied, Apply anyway applies; a hand-set frame is skipped.
- `pnpm test` 64 files, 2195 tests; `pnpm typecheck` clean; `pnpm lint` "import boundaries ok (288 file
  checks)"; `pnpm gen:check` ok (18 files); `STUDIO_KIT_PORT=4497 npx playwright test --project=studio-kit`
  9 passed (roll.spec 6 runs in a row green after the fix below).

### What didn't work
- `node …/explore/g200.ts`: `ERR_MODULE_NOT_FOUND: Cannot find package 'fflate'` — no node_modules in the
  worktree; `pnpm install --frozen-lockfile --offline` fixed it.
- First planted run: no holder found (`surround: null`) and the crop grew 6 px into the gap. The fixed
  "2.2 D below the thinnest film" threshold fails with a 0.4 % veil (holder only 1.8 D below the base); the
  threshold is now the border's 20th percentile + 1 D (at most 1.2 D below the thinnest film), grown over the
  spill-lit edge at 2.2 D.
- Cropped-scan test: base off by 0.59 D — the blank shadow patch (bright, above a gap) was taken for the open
  gate. The open gate must now lack the orange mask (gain ≥ 0.25 D more in blue or green than in red).
- Several shell commands were refused by the worktree guard ("too complex to verify that it stays inside the
  worktree": a `git checkout -b` chained with reads, heredocs with nested quotes); split or written as files.
- Engine test: `expected [ 'W_ROLL_MIXED' ] to include 'W_ROLL_STOCK_AMBIGUOUS'` — Gold 200 and C200 differ by
  0.020 D, and with a 0.005 D median offset the gap was 0.021; the tolerance is 0.025 D now.
- Kit test: `CK-L340 A handler threw ["#<Object> could not be cloned."]` — `structuredClone` of the store's
  read-only proxies (`fragmentOf`, `setWithExpect`); the kit reads recipes from `log.committed` and copies with
  `plain()` (JSON). In the browser the same error came from the KV saving a log whose mutations were proxies
  from `rollView.pending`; approve and `roll.setShared` unwrap first, and the node fixture now uses `memoryKV()`.
- Playwright: Mod+Z undid "Select roll" (a click on the library hit a roll card, an undoable tx) — `roll.select`
  writes without history now; clicking `.cb-roll-cell` by index was flaky (`Expected "frame_f7e3ba4a" Received
  "frame_bec9f4e2"`) because the grid recycles cells, so DOM order is not the sheet's order — cells are clicked by
  `data-key`.
- The variants snapshots changed (passes 14 → 15: CB-R001 is installed on every ck); updated with `-u`.

### What I learned
- `scan.flare` is implemented only by MockEngine; core's RefEngine has no `scan.flare`, `scan.flatField` or
  `scan.heal` image op, so the host must condition pixels at decode.
- MockEngine's `scan.density` default (no box) is its own rule, not core's brightest columns; only core shows the
  demo's bug.
- `rt.runCommand(id, event, …args)` returns the handler's value (a promise for async commands).

### What was tricky to build
- Separating holder from dense film by brightness alone: a strong veil lifts the holder towards the densest
  highlights. Border statistics plus connectivity to the border, and dropping a "holder" that has no film edge
  beside it (a cropped scan with a dense border), keep both cases right.
- One undo step for a batch across N EditLogs without a contract change: `applyBatch` applies under the route's
  `quiet` counter (so the per-log listener neither republishes nor pushes per frame) and pushes one entry with one
  part per frame.

### What warrants a second pair of eyes
- `filmLayout`'s thresholds (gap 0.2 D, mask gain 0.25 D, border percentile, 1.5–6 % ring for the veil) are
  tuned on planted strips and one real scan; the photographer's rolls (CHB-013) must check them.
- Flare is local: the holder next to the film reads up to 4× the far holder (Gold 200). The ring 1.5–6 % of the
  long side away is a choice; it under-corrects the image centre if flare is mostly local glare.
- `EditLogRoute.applyBatch` is in studio-kit's bridge (CHB-019's file): small and additive, but the migration
  owner should know.
- `createCb` installs the roll kit's CB-R001 pass on every ck (passes 14 → 15 in every explain snapshot).

### What should be done in the future
- apps/studio host: call `conditionScan` in `decodeScan` (see Technical details), drop the brightest-columns base.
- Contract R3–R7; with `scan.baseT`, write the roll median instead of per-frame boxes.
- Open tasks: peek spring and a full-screen cull sweep (mv3s), before/after thumbnails on the batch card (5x10),
  film-strip badge and `frame.roll()` fragments (nzkv), CHB-010 filtration in the first print (wb5j), GPU
  reductions (qvyu) and the GPU dust timing (j972), contact-sheet export via `darkroom.contactSheet`.

### Code review instructions
- Start at `packages/ingest/src/conditioning/film-layout.ts` (`filmLayout`), `roll-base.ts` (`rollBase`,
  `conditionScan`), then `packages/studio-kit/kits/roll/src/engine/lower.ts` (`rollTotals`, `firstPrintBatch`,
  `matchBatch`), `analyse.ts`, `kit.ts` (commands), `src/bridge/editlog-route.ts` (`applyBatch`).
- `npx vitest run packages/ingest/test/film-layout.test.ts packages/studio-kit/test/roll`;
  `pnpm typecheck && pnpm lint && pnpm gen:check && pnpm test`;
  `STUDIO_KIT_PORT=4497 npx playwright test --project=studio-kit`;
  `pnpm --filter @chromobench/studio-kit demo` → `/demo/?variant=roll&fresh`, press "New roll from open frames".

### Technical details
- Host call (apps/studio `host/engines.ts`, after `region(…)` makes the working image `data`):
  `const c = conditionScan(data, w, h, { id: sha256, rollVeil })` subtracts the veil in place; put
  `c.rebate` (working-image px) into the new recipe's `scan.rebate` (replaces `rebateBox`'s brightest columns);
  keep `c.frame` per open file and `rollBase(frames)` for the roll's veil and base (pass `rollBase(...).veil` as
  `rollVeil` to frames without a holder). Notes: `c.notes` (`W_NO_SURROUND`, `W_NO_OPEN_GATE`, `W_REBATE_BLANK`,
  `W_VEIL_FROM_ROLL`). With the box in the recipe, `firstPrint` in `host/first-print.ts` measures on the right base.
- Or the kit: `mountStudio(app, el, studio, { rollPhysics, renderers: ROLL_RENDERERS })` with `rollPhysics` as in
  `packages/studio-kit/demo/roll-physics.ts` (pass `fwd = scannerForward(data, scanner)` and the film stock ids
  for the ranking), a variant that `.use(cb.kits.roll.kit)`, and the `roll.fromFrames` command.
- New codes: ingest `W_NO_SURROUND`, `W_SURROUND_BRIGHT`, `W_REBATE_BLANK`, `W_NO_REBATE`, `W_NO_FILM`,
  `W_VEIL_FROM_ROLL`, `W_ROLL_MIXED`, `W_ROLL_BASE_WEAK`; kit `W_ROLL_STOCK_AMBIGUOUS`, `CB-R001` (roll forms
  without the kit), `CB-R002` (balance bar without sheet or library, warning), `CB-R003` (rollScope on a path the
  roll does not share), `CB-R110` (base from blank film), `CB-R111` (probable under-exposure).
- State: `roll` (document: `rolls`, `order`, `current`), `rollView` (view: `contact.mode`, `pending`, `off`,
  `stale`, `progress`, `alpha` = 0.45, `consistency` = 0.5). Roll batches' tx ids start with `roll:`.

## Step 3: Host wiring: conditionScan at decode, measured rebate in the first print, parity port

Step 2's hand-off said the studio's file opening should call `conditionScan`. This step does that in `apps/studio/src/host/engines.ts` and routes the measured rebate box into the new recipe's `scan.rebate`, so `firstPrint` measures on the film edge instead of the brightest columns (sprocket holes on a strip scan). Separately, the gpu-parity Playwright server port became configurable.

### Prompt Context
**User prompt (verbatim):** see the task brief (CHB-020 host wiring: wire roll analysis into decodeScan; make GPU_PARITY_PORT configurable).
**Assistant interpretation:** Integrate Step 2's `conditionScan` and `rollBase` in the host; leave `scan.flare` at 0; add a test with `plantedStrip`; env port for the parity page.
**Inferred user intent:** Roll analysis reaching real file opens; parallel runs not colliding on port 4185.
**Commit (code):** on branch task/chb-020-host-wiring.

### What I did
- `engines.ts` `decodeScan`: after `region(…)`, `rollBase(frames opened so far).veil` as `rollVeil`, then `conditionScan(data, w, h, { id: sha256, rollVeil })` (veil subtracted in place). `c.frame` is kept per sha256 in a `Map<string, FrameBase>` created in `createHostEngine`. `c.rebate` goes on `Decoded.rebate` (new optional field in `studio-engine.ts`); `c.notes`, the base, the veil and its origin go in the decode notes. The old `rebateBox` band stays only as the dust-healing base when no rebate is found.
- `first-print.ts`: `withRebate(recipe, box)` sets `scan.rebate`; `main.ts` `initial` applies it from the decoded record (`se.notes`, keyed by the recipe's file sha256) before `firstPrint`. `scan.flare` untouched (0).
- `playwright.config.ts`: `GPU_PARITY_PORT` (default 4185) for the project's baseURL, the web server command and port. `packages/gpu/playwright.config.ts` and `parity-page/vite.config.ts` already read the same env var.
- Test in `apps/studio/test/host.test.ts`: `plantedStrip()` through `conditionScan`, loaded into RefEngine with `openDecoded`; the first print's total paper exposure with the measured box is within 0.1 D of the print with the true rebate band, and the print with a box on a sprocket hole is more than 0.3 D off.

### What worked
- The test passed first time; the unit suite went from 2350 to 2351. `STUDIO_PORT=4511 STUDIO_KIT_PORT=4512 SHELL_DEMO_PORT=4513 GPU_PARITY_PORT=4514 CI=1 pnpm test:browser`: 69 passed.

### What didn't work
- `npx vitest run apps/studio/test/host.test.ts` first failed with `Cannot find package '@chromobench/core'`: the new worktree had no node_modules links. `pnpm install --offline --frozen-lockfile` fixed it.
- `pnpm typecheck`: `first-print.ts(98,32): TS2322` (spreading `recipe.scan`, which is optional on `digital-raw`); `withRebate` now leaves recipes without `scan` unchanged.

### What I learned
- The decoded record is keyed by the same sha256 the new recipe carries, so no new plumbing was needed between decode and `initial`.

### What warrants a second pair of eyes
- The roll veil comes from frames opened earlier only; an early frame with no holder gets no veil, and earlier frames are not re-conditioned.
- Frames stay in the host's map for the session (never removed on close).

### Code review instructions
- `apps/studio/src/host/engines.ts` (`decodeScan`), `first-print.ts` (`withRebate`), `main.ts` (`initial`), `apps/studio/test/host.test.ts` (last describe), `playwright.config.ts`.
- `pnpm typecheck && pnpm lint && pnpm test`; `STUDIO_PORT=4511 STUDIO_KIT_PORT=4512 SHELL_DEMO_PORT=4513 GPU_PARITY_PORT=4514 CI=1 pnpm test:browser`.

## Step 4: Contract 0.3 in the roll workflow: flare and base in the recipe, batch ids, the Roll module in the classic app

Contract 0.3 (CHB-024) gave recipes `scan.baseT`, per-channel `scan.flare`, `FrameRecipe.roll` and `LoggedMutation.batch`. This step moves the roll workflow onto them. The studio host no longer subtracts the holder's veil from the decoded pixels: the veil goes into the recipe as `scan.flare` and the measured base as `scan.baseT`, so the preview, the export and the roll analysis all run the same chain. The roll first print writes the roll's base and veil to every frame and names the roll. The main app also mounts the roll renderers and the host's roll physics, which it did not do before, and the default `classic` variant has a Roll module.

### Prompt Context
**User prompt (verbatim):** "Follow-up on ticket CHB-020 (roll workflow) ... Roll kit and app host: write the measured base into `scan.baseT` and the measured veil/flare into `scan.flare` in the recipe instead of subtracting the veil from pixels at decode ...; set `FrameRecipe.roll`; use the contract's batch fields for 'print the roll like this frame' and the roll first print (one card, batch approve/reject). Remaining CHB-020 open tasks that are cheap: film-strip roll badge / `frame.roll()` fragment, before/after thumbnails on the batch card, CHB-010 filtration in the first print where it makes sense. ... Make the roll first print and roll balance reachable from the main app's default `classic` variant."
**Assistant interpretation:** Replace pixel subtraction by recipe settings, carry the roll through recipes and log entries, finish the cheap stage 6/7/8 items, expose the roll workflow in the default variant.
**Inferred user intent:** The roll workflow uses the contract as designed and is usable from the app people actually open.
**Commit (code):** ed71115 — "veil and base as scan.flare / scan.baseT in the recipe, FrameRecipe.roll, batch ids in the log, first-print card"; 34402ae — "Roll module in the classic variant, host roll physics, before/after thumbnails, roll badge and frame.roll(), opt-in filtration bake"

### What I did
- ingest `conditionScan` (`roll-base.ts`): option `subtract: false` leaves the pixels alone; the result has `flare` (percent per channel, `veilToFlare`: f = 100 L / (1 - L), clamped to the catalog's 20) and `scanBaseT` ((T - L) / (1 - L)). Test in `film-layout.test.ts`.
- `apps/studio/src/host/engines.ts` `decodeScan`: `conditionScan(..., { subtract: false })`; `Decoded` (`studio-engine.ts`) carries `flare` and `baseT`; the dust healer reads the base as scanned (`layout.rebate.Traw`). `first-print.ts` `withMeasured` writes `scan.rebate`, `scan.flare` (only when non-zero) and `scan.baseT`; `main.ts` calls it.
- Roll kit: `SHARED_PATHS` gains `scan.baseT`; `analyse` writes the roll median base (`baseOfVeilFree`) and veil (`flareOfVeil`) into the fragment; `firstPrintBatch` sets `roll: {id}` and drops `scan.baseT` for frames the analysis flags as mixed; `roll.fromFrames` adds a `roll:members-*` 'auto' batch only for frames the first print did not name; `roll.firstPrint` (command and the library button) now plans a pending `first-print` card (approve/reject, `E_STALE` checked); the automatic first print on a new roll is still applied at once.
- `EditLogRoute.applyBatch` passes `batch: tx` to `log.apply`, so every entry of a roll batch carries `LoggedMutation.batch`.
- Card: `dom.ts` shows before/after print thumbnails per frame (the shell's `thumb` form via `makeNode` and `m.mount`, `frameRef(...).print()`, first 12 frames).
- `rollTag` badge on the film strip and grid cells (`cb.ts` `badgeOf`), `FrameRef.roll()` in `handles.ts`.
- `first-print.ts` option `bake` (core `bakeRecipe` through `HostEngine.bake`), switched by `?filtration=1` in `main.ts`.
- `engines.ts` builds the roll kit's physics (`buildRollPhysics`, with `scannerForward` for the stock ranking); `main.ts` passes it as `rollPhysics` with `ROLL_RENDERERS` and imports `roll.css`.
- `variants/classic.js`: `rollModule`, `rollMenu`; classic `.use(roll.kit)` and has a Roll module (Mod+Alt+R); `roll.js` reuses both. Snapshot updated.
- Tests: host (flare+baseT print equals the subtracted print within 0.05; bake within 0.05), ingest, roll kit (recipes carry baseT/flare/roll, batch ids, first-print card reject/approve), browser: roll spec thumbnails on the card, `e2e/studio-real.spec.ts` Roll module in classic on the reference engine.

### Why
- Subtraction at decode hid the veil from every engine path but the one that decoded; with the recipe path the veil is data a photographer or agent can see and edit. The exact relation is a holder reading f/(1+f), so f = L/(1 - L), and T'(1+f) - f = (T' - L)/(1 - L); `scan.density` divides by the base on the same scale, so the density is unchanged.
- The roll first print stays in lights because a roll's analysis measures under the frame's own filtration and `print.enlarger.filtration` is a roll-shared setting; baking per frame would double count (see below).

### What worked
- `pnpm test`: 2418 passed (baseline 2413 plus 5 new). `pnpm typecheck`, `pnpm lint` clean. `STUDIO_PORT=4561 STUDIO_KIT_PORT=4562 SHELL_DEMO_PORT=4563 GPU_PARITY_PORT=4564 CI=1 pnpm test:browser`: 70 passed.
- No existing roll test needed changing; the roll analysis already handled raw (veil-carrying) pixels through `physics.layout`.

### What didn't work
- First e2e run: `Locator: locator('.ck-thumb-badge').filter({ hasText: 'roll 1' })` not found, because the Roll module has no film strip; the test now goes to the Library module for the badge.
- Second run: `#roll-pending` never appeared. The library button called `roll.firstPrint` with no argument, which plans only frames without a first print (none after a new roll). The button now passes `true` (all frames) and is labelled "First print…".
- Several multi-line shell heredocs were refused by the harness ("too complex to verify that it stays inside the worktree"); I wrote scripts with the file tools instead.

### What I learned
- The main app mounted no roll renderers and no `rollPhysics` service: the `roll` variant worked only in the studio-kit demo. Wiring it in `main.ts` was needed for any variant.
- `conditionScan` returned the veil-corrected `baseT` on the pixel scale; the recipe's `scan.baseT` is on the flare-corrected scale (divided by 1 - L). The two are not interchangeable.

### What was tricky to build
- Keeping the baked first print consistent: the roll analysis measures X under each frame's recipe and treats `total = lights + time`. A baked filtration changes X without being in `total`, so a roll first print on top of baked frames would double count the filtration. For that reason the bake is opt-in (`?filtration=1`), single-frame, and the roll batch keeps lights. Roll integration of filtration (neutral-pack measurement, baking the roll batch) stays open.

### What warrants a second pair of eyes
- Mixed-base frames keep their own `scan.baseT` while taking the roll's `scan.flare`.
- Flare is clamped to the catalog maximum of 20 percent; a stronger veil is silently capped (the decode note still prints the measured veil).
- "Batch approve/reject" is the kit's pending card (`rollView.pending`) applying through `applyBatch`; the log entries carry `batch`, but the card is not a set of pending `EditLog` proposals (`log.propose` / `approve({batch})`), so the Approvals panel does not list it.
- Undoing the roll creation does not undo `FrameRecipe.roll` (the first print batch names it, and it undoes with the first print).

### What should be done in the future
- Roll first print with filtration (CHB-010) and CHB-013's measured per-channel flare from wedge fits instead of the holder's veil.
- Cull keys with peek spring (`mv3s`), GPU reductions (`qvyu`) and the 40 MP dust timing (`j972`) remain open.
- A roll card as real `EditLog` proposals if the agent chat (CHB-008) wants to show it in Approvals.

### Code review instructions
- `packages/ingest/src/conditioning/roll-base.ts` (`conditionScan`, `veilToFlare`); `apps/studio/src/host/engines.ts` (`decodeScan`, `buildRollPhysics`), `first-print.ts` (`withMeasured`, `bake`), `main.ts`; `packages/studio-kit/kits/roll/src/kit.ts` (`analyse`, `planFirstPrint`, `membersBatch`, `rollTag`), `dom.ts` (card thumbnails); `variants/classic.js`.
- `pnpm typecheck && pnpm lint && pnpm test`; `STUDIO_PORT=4561 STUDIO_KIT_PORT=4562 SHELL_DEMO_PORT=4563 GPU_PARITY_PORT=4564 CI=1 pnpm test:browser`.

### Technical details
- Veil as recipe settings: pixel P = (T + f) / (1 + f); holder L = f / (1 + f); `scan.flare` = 100 f per channel; `scan.baseT` = (T_rebate - L) / (1 - L).
