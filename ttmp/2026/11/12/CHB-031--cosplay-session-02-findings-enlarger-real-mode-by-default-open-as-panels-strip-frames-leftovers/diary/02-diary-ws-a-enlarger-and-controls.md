---
Title: Diary WS-A enlarger and controls
Ticket: CHB-031
Status: active
Topics:
    - ui
    - product
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-12T17:10:50.69743749-05:00
WhatFor: ""
WhenToUse: ""
---

## Step 1: Verify F17 before changing anything

The orchestrator handed me WS-A. Following the owner's decision (CHB-031 diary step 1), the first job was to verify
and record: does the test strip in seconds really show identical bands in normalised mode, and what does the
automatic first print set in real mode for a photo and for a negative? I wrote a small vitest on core's RefEngine
with two synthetic 60×40 frames (a negative and a photo, the same generator as `packages/core/test/engine-ref-sampled.test.ts`)
and measured the prints.

Result, before any change: in normalised mode a time change leaves the print bit-identical (max difference 0 at
10 s vs 20 s) for both kinds, and the five bands of a ⅓-stop time strip are the same print (one distinct mean). In
real mode one stop more prints visibly darker and the bands grade monotonically; at the calibration optics (10 s,
f/8, 8×) and the neutral pack the two modes agree to < 1e-6. The automatic first print (`firstPrint`) forces
`mode: 'real'` and runs only for negatives; the host gives a photo `photoRecipe` (defaultRecipe, so normalised at
10 s). On the synthetic frames: negative → real, 2.227 s (the grid floor, 10·2^(−13/6)), lights
[−0.034, −0.092, −0.136]; a photo, if it were run, → real, 7.937 s, lights [0.02, 0.008, −0.034].

### Prompt Context
**User prompt (verbatim):** "You are implementing CHB-031 workstream **WS-A: enlarger and controls** (findings F17 — the major one: Time and Aperture are inert in the default enlarger mode — plus F23, F19, and the leftovers F8, F9, F12).

Read first: the common brief /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/brief-common-v2.md (rules, checks, diary format, final reply; its \"Additions\" section matters). Your ticket's plan: `ttmp/2026/11/12/CHB-031--cosplay-session-02-findings-enlarger-real-mode-by-default-open-as-panels-strip-frames-leftovers/design-doc/01-plan.md` (section WS-A) and the CHB-031 diary step 1 (the owner's decision on the enlarger default). The findings with repro: CHB-026 `various/02-findings.md` (section \"Session 02\") and `sessions/02-sonnet-rerun-session-01/` (report, screenshots, scripts — `scripts/s10-does-time-matter.mjs` measures whether Time changes the picture).

Your specifics:
- Branch: `task/chb-031-enlarger` (create it first in your worktree; `pnpm install --offline` if node_modules is missing).
- Diary (exists, write in it): `ttmp/2026/11/12/CHB-031--…/diary/02-diary-ws-a-enlarger-and-controls.md` — the diary skill's investigation format exactly (read /home/manuel/.claude/skills/diary/SKILL.md and references/investigation-entry.md); Step 1 quotes this prompt verbatim; every step has all sections; write as you go and commit with the code.
- Screenshots: `…/CHB-031--…/various/ws-a/` (synthetic fixtures only).
- Ports: preview 4711 (the Mac tunnel maps it, for a real-GPU check if useful); browser tests STUDIO_PORT=5221 STUDIO_KIT_PORT=5222 SHELL_DEMO_PORT=5223 GPU_PARITY_PORT=5224.
- Plan tasks to check off when done: x86v, 0xav, 5ywv, 9i1n, 3z8z, l1ny.

Priorities: (1) verify and record (test strip in seconds under normalised mode; what the automatic first print sets in real mode for a photo and a negative); (2) real mode by default for the darkroom-style layouts, with the first print setting the time and Lighter/Darker changing time by ⅓ stop in real mode — a pixel-level test proves a time change changes the print; (3) normalised stays as an option and the default of simple/tiny, and while it is on Time/Aperture/magnification are hidden and never recorded; saved recipes keep their stored mode; (4) F23, F19, F8, F9, F12 leftovers.

Parallel work: WS-B (open, strips, library) edits `apps/studio/src/main.ts`, `packages/studio-kit/src/bridge/frames.ts`, `apps/studio/src/host/decode.ts`; CHB-032 (housekeeping) edits core's `engine-ref.ts` imports, gpu `engine-gpu.ts` (a split), ingest/output TIFF writers, `packages/dsl/src/host.ts` (a split) and the looks/finish kits (a split). Keep your edits to those files minimal and local; `packages/studio-kit/src/cb.ts` is shared with WS-B — keep edits local there too. If you change the contract (the enlarger default is catalogue metadata), bump the contract version per `packages/contract/CONTRACT-DECISIONS.md` conventions and record the decision there."
**Assistant interpretation:** Implement WS-A of the CHB-031 plan on `task/chb-031-enlarger`: verify F17 first, then real mode by default with normalised as a layout option (simple, tiny) whose inert controls are hidden, then F23, F19 and the F8/F9/F12 leftovers, with tests and this diary.
**Inferred user intent:** The darkroom controls must do what they say; the photographer must never move a control that does nothing.
**Commit (code):** see Step 2 (the verification test is committed with the change, rewritten to the after-state).

### What I did
- `git checkout -b task/chb-031-enlarger`; `pnpm install --offline` (node_modules was missing; exit 0).
- Read the plan (WS-A), CHB-031 diary step 1, findings F17–F23 and F8/F9/F12, `s10-does-time-matter.mjs`,
  `packages/core/src/print/enlarger.ts`, `apps/studio/src/host/first-print.ts`, `apps/studio/src/main.ts` (`photoRecipe`,
  `startEngine().initial`), `packages/studio-kit/src/{cb.ts,dom/arg.ts,kit/args.ts,model/*}`, the variants.
- Wrote `apps/studio/test/enlarger-mode.test.ts` (RefEngine, synthetic frames): time 10 vs 20 s in both modes,
  5-band ⅓-stop strip in both modes, `firstPrint` on both kinds; `npx vitest run apps/studio/test/enlarger-mode.test.ts`.
- Baseline: `pnpm test` → 96 files, 2738 passed, 7 skipped (72 s).

### Why
- The owner asked for verification before the default changes; a pixel measurement on the real chain is the
  evidence session 01 lacked (its "the picture is lighter" was never measured).

### What worked
- All five checks pass and print the numbers above (`first print {"negative-scan":{"mode":"real","time_s":2.227,…},"digital-raw":{"mode":"real","time_s":7.937,…}}`).

### What didn't work
- First run: `ChromobenchError: E_NOT_IMPLEMENTED: output.frame is not implemented by the reference engine` (4 of 5
  tests). The top of the compiled chain is the studio host's `output.frame`; fixed by evaluating the node below it,
  as `engine-ref-sampled.test.ts` does.

### What I learned
- F17 is real and total in normalised mode: not "weak", bit-identical. The test strip in seconds is useless there.
- Photos never get the automatic first print; their first recipe is the default, which at 10 s prints identically in
  both modes. So switching the default to real changes no photo's first picture.
- The negative's first print sits at the time grid's floor (2.227 s) on this synthetic frame: the remainder goes to
  the lights (session 01's F16 note "auto time at the slider's 2 s floor" is the same clamp).

### What was tricky to build
- Nothing beyond the `output.frame` cut.

### What warrants a second pair of eyes
- That 10 s / f/8 / magnification null really is the calibration everywhere (core `REFERENCE_OPTICS`; the GPU engine
  takes the same `exposeSettings`). The test checks it for the RefEngine only.

### What should be done in the future
- N/A for this step.

### Code review instructions
- `apps/studio/test/enlarger-mode.test.ts`; run `npx vitest run apps/studio/test/enlarger-mode.test.ts`.

### Technical details
- Core: `makeEnlarger` real mode: κ at the calibration pack plus `opticsLogH`; normalised: κ at the current pack, optics 0.
- Time strip: `stripValues('time', 10, 1/3, 5)` → 10·2^(k/3), k = −2…2; `stripRecipe` sets `print.enlarger.time_s`.

## Step 2: Real enlarger by default (contract 0.4), normalised as a layout option with its inert controls hidden

The default moved to the contract: `print.expose.mode`, `darkroom.lightsToFiltration.mode` and `defaultRecipe`'s
`print.enlarger.mode` are `'real'` (contract 0.4.0, CC-017, core request C4 accepted). That was the smallest
change that gives every darkroom-style layout real mode without each of them saying so, and it prints every
default recipe exactly as before (the calibration optics). A layout picks normalised with one field,
`VariantDef.enlarger: 'normalised'` (simple, tiny); `main.ts` passes it to `createStudio({ enlarger })`, and the
Studio wraps the host's first recipe (`initialInMode`) so the first print is made in that mode. Saved recipes keep
the mode they store (frames resume their saved log; the wrapper only touches new recipes).

In normalised mode the studio now never offers a control that does nothing: `cb.arg` hides Time, Aperture (and
magnification, which has no control yet) while the frame's recipe is normalised, and refuses to write them; the
Exposure group shows a one-line note why; a time nudge (simple's Lighter/Darker) moves all three printer lights by
the same ⅓ stop in log H; the lights pad's Lighter/Darker changes the time by ⅓ stop in real mode and the lights by
its points in normalised mode; the test strip in seconds moves the lights by each band's stops in normalised mode
and labels the bands in stops. The first print puts the density into the time in real mode and into the lights in
normalised mode.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Priorities (2) and (3): real by default with a working first print and Lighter/Darker; normalised as the simple/tiny default with no inert control shown or recorded.
**Inferred user intent:** Time and Aperture work wherever they are shown.
**Commit (code):** (this step's commit; hash in Step 3)

### What I did
- Contract: `packages/contract/src/catalog/capture-film-print.ts` (mode default `'real'`, doc says what normalised
  ignores), `catalog/measure-darkroom-finishing.ts` (lightsToFiltration mode), `src/paths.ts` (defaultRecipe),
  `CONTRACT_VERSION` and package version `0.4.0`, `baselines/catalog-0.3.0.json`; `pnpm gen`; `pnpm contract:check`
  → `0.3.0 (main) → 0.4.0`, 2 changes, 2 "breaking" (recipe-backed defaults), exit 0 under 0.x. Note in
  `CONTRACT-DECISIONS.md` ("Contract 0.4", CC-017) and status line in `packages/core/CONTRACT-REQUESTS.md` C4.
- Tests that meant normalised by default: `packages/contract/test/registry-graph.test.ts` (hashcons law: the explicit
  default is now `'real'`), `packages/core/test/engine-ref.test.ts` (the 0.2 filtration case passes `mode: 'normalised'`
  to match `makePrintChain`'s default), `packages/dsl/test/representative.result` (node id `#878c` → `#284f`).
- New `packages/studio-kit/src/model/enlarger.ts`: `OPTICS_PATHS`, `isNormalised`, `isInert`, `withEnlargerMode`,
  `initialInMode`, `exposureStep`, `shiftLights`; exported from the index.
- `studio.ts`: `StudioOptions.enlarger`; `variant.ts`: `VariantDef.enlarger`; `variants/simple.js`, `tiny.js`:
  `enlarger: 'normalised'`; `apps/studio/src/main.ts` (one line at `createStudio`).
- `apps/studio/src/host/first-print.ts`: no longer forces real; real → time, normalised → lights.
- `dom/arg.ts`: `read` adds `inert` and `na`; the control is hidden when there is no frame, the path is absent for
  the frame's kind, or it is inert (a nudge stays); `commitSet`/`burst` refuse inert writes; `exposeBy` for the pad
  and the time nudge.
- `model/tools.ts`: `stripLabel(vary, v, r?)`, `stripMutation` and `stripRecipe` write lights for a time strip in
  normalised mode; `cb.ts` overlay passes the recipe.
- `model/arrangement.ts`: Exposure group gets `print.enlarger.mode` first and a note; `cb.ts` `controls()` renders
  group notes. Enlarger mode values read "Real enlarger (time and aperture)" / "Normalised (grey card at the aim)"
  (`names.ts` `ENUM_NAMES`, used by `controls.ts`); tooltip in `messages.ts`.
- Same commit, because they are the same `cb.arg`/`controls()` change: F19 — `controls()` wraps its sections in
  `cb.ifFrame(...)` (`ck.when`): no frame → the text "Select a photo to print it." (`NO_FRAME`); F23 — the
  "Film and viewing" group lists `capture.stock` and `scan.stock` (each hidden where the kind has no such path, so a
  photo shows the film it is "shot on" and no scanner, a negative its film and scanner) with a one-line note per kind.
- Tests: `apps/studio/test/enlarger-mode.test.ts` rewritten to the after-state; `packages/studio-kit/test/enlarger-mode.test.ts` (8 tests);
  snapshots updated (`kit.test.ts.snap`, `variants.test.ts.snap`) after reading the diff.

### Why
- Contract default vs a studio-only default: the plan named the default "catalogue metadata" and core C4 was waiting
  for exactly this decision; changing it in one place keeps the DSL, the agent and the studio agreeing on what a
  new recipe is. A studio-only override would have left `defaultRecipe` normalised and every other consumer inert.
- Hiding instead of disabling (plan item 3): a disabled slider still reads as "something to set".
- The time nudge and the strip convert to lights instead of disappearing in normalised mode, because simple's
  Lighter/Darker is its main exposure control: hiding it would have broken simple.

### What worked
- `pnpm typecheck`, `pnpm lint` clean; `pnpm test` → 97 files, 2746 passed, 7 skipped.
- RefEngine: a normalised time strip now grades, and its bands equal the real-mode bands to < 1e-6 at the neutral
  pack (a stop of lights is a stop of time there). The normalised first print leaves 10 s and its lights' mean equals
  the real first print's lights mean + log10(t/10) to 2 decimals; both measure ≈ 0 against the aim.

### What didn't work
- `pnpm test` after the default change: 3 failures, all tests that relied on the old default (listed above), e.g.
  `packages/dsl/test/examples.test.ts … reproduces the trace`: `- path: '[value #878c measure.densitometer] → ✗ D'` /
  `+ path: '[value #284f measure.densitometer] → ✗ D'`.
- `stripLabel('time', 10, r)` gives `'10.0 s'`, not `'10 s'` (my test's expectation was wrong).
- A Python heredoc edit left a stray `}` at the end of `enlarger.ts`; removed before typechecking.

### What I learned
- `contract:check` classifies any recipe-backed default change as breaking and exits 0 under 0.x; a migration is
  only needed when stored documents could lack the field, and every recipe stores the mode.
- The pad's Lighter/Darker were printer lights (1 pt); the plan wants ⅓ stop of time in real mode, so the same
  buttons now do two different-sized things depending on the mode (⅓ st vs 1 pt). Simple's nudge is ⅓ st in both.

### What was tricky to build
- Ordering in the first print: the mode must be on the recipe *before* `firstPrint` measures (it decides where the
  density goes), and the photo path rebuilds the recipe from `defaultRecipe` (now real). `initialInMode` therefore
  sets the mode on the defaults it passes in and again on what comes back.
- A time nudge reads the time path but in normalised mode writes `print.lights.logH`; it must not be hidden by the
  inert rule, and its History label is "Printer lights", not "Time".

### What warrants a second pair of eyes
- The contract default change (0.4.0) is visible to the DSL and agents: `frame.print({ time_s })` now matters for any
  recipe made from `defaultRecipe`. Agent playbooks/fixtures that assumed normalised were not found failing, but
  CHB-032 and other branches regenerate docs too (`pnpm gen` output may conflict at merge; regenerate).
- `el.hidden` on a `cb.arg` with no frame: variants that place `cb.arg` outside `controls()` (darkroom's Enlarger
  panel) show empty panels before a frame is selected; `controls()` itself has the empty state (below).

### What should be done in the future
- The looks kit's "density" look writes `print.enlarger.time_s`: inert on a normalised recipe. Not changed (CHB-032
  is splitting the kit).
- The DSL's `cb.testStrip(frame, {vary:'time'})` uses core's `darkroom.testStrip` op; not checked in normalised mode.

### Code review instructions
- Start at `packages/studio-kit/src/model/enlarger.ts`, then `dom/arg.ts` (`read`, `exposeBy`, the `m.cell` effect),
  `model/tools.ts` (strip), `studio.ts` (constructor), `apps/studio/src/host/first-print.ts`.
- `npx vitest run apps/studio/test/enlarger-mode.test.ts packages/studio-kit/test/enlarger-mode.test.ts`; `pnpm contract:check`.

### Technical details
- 1 stop = log10 2 = 0.30103 log H ≈ 12.04 points; ⅓ stop = 0.100343 log H.
- `exposureStep(r, ±1/3)`: real → `time_s · 2^(±1/3)` clamped 0.1…600; normalised → lights ± 0.100343 (or ± points·0.025 with `lightsPoints`), clamped ±1.5.
