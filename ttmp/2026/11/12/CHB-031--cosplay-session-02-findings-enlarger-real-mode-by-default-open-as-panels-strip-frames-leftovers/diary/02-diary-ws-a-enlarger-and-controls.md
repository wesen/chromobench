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

## Step 3: Checkpoint — the app driven by hand; F8 typed entries (a change needs a sign and a unit)

The orchestrator asked for a checkpoint because the session may end. Two things are in this commit. First, the
built app was driven like a user (preview on :4711, `?engine=reference`, synthetic files only), which confirms Step 2
end to end. Second, the F8 leftover is in: a plain number sets a value, and a change needs a sign and a unit. A bare
`−5` on Time or Aperture is refused with a toast that shows both spellings, instead of being read as "5 s less".

App measurements (mean display value over a 9×9 grid of print pixels, `window.chromobench.pixel`), classic,
synthetic DNG photo: opens `real`, 10 s, mean 0.4842. Typing Time 20 gives 0.2306, 5 gives 0.7504, back to 10 gives 0.4842.
"Lighter" (lights pad) gives 7.937 s / 0.5794, then 6.300 s / 0.6696. History: "You Time 10.0 → 7.94 s (−1/3 st)". The
test strip around 6.3 s shows bands "3.97 s, 5.0 s, 6.3 s, 7.94 s, 10.0 s". Tiny, M1 negative: opens `normalised`,
10 s, lights (−0.1175, −0.1442, −0.1691) from the first print, mean 0.6221. Time and Aperture are hidden and the mode
select is visible. "Lighter" moves lights by −1 pt each, mean 0.6343, History "You Printer lights (−5, −6, −7) →
(−6, −7, −8) pt". Selecting "Real enlarger" in the visible select shows Time again. Empty Darkroom panel (classic
Print module and tiny): "Select a photo to print it."

### Prompt Context
**User prompt (verbatim):** see Step 1. Orchestrator relays during the step: "commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)" (from the user), and "Checkpoint NOW: … write a diary step "Checkpoint" … commit … report the commit hash".
**Assistant interpretation:** Commit what is green, with a resume list, then continue.
**Inferred user intent:** No work lost if the session stops.
**Commit (code):** this step's commit ("CHB-031 WS-A: checkpoint — F8 typed entries; diary step 3"); Step 2 was 67a4a57.

### What I did
- `pnpm --filter @chromobench/studio build`; `pnpm --filter @chromobench/studio preview --port 4711 --strictPort` (background).
- Scratch scripts (not committed): `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/wsa/mkdng.ts`
  (writes the synthetic Bayer DNG of `e2e/studio-photo.spec.ts`), `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/wsa/drive.mjs`
  (classic photo, tiny negative, simple negative; screenshots into `various/ws-a/`); log in `…/scratchpad/wsa/drive.log`.
- F8: `packages/studio-kit/src/kit/args.ts` `parseEntry` (sign without unit: the signed value where `isSigned(m)`, i.e.
  `min < 0`, else null) and new `isSigned`; `kit/messages.ts` `entryHint`, `entryPlaceholder`, `isRelativeEntry` (sign
  and unit), `badEntryText` (bare sign on time/aperture: both spellings). Tests: `test/messages.test.ts` (new F8 case),
  `e2e/studio-wording.spec.ts` (`-5 s` for the relative toast; `-5` refused, time unchanged).
- Checks: `pnpm typecheck` clean, `pnpm lint` clean, `npx vitest run packages/studio-kit` → 184 passed. Full `pnpm test`
  and the browser suite were not re-run for this checkpoint.

### Why
- F8 decision, with the persona in mind: Manfred reads "−5" as minus five, not "five less". The values that display
  with a sign (printer lights "+4 pt", the filtration shift "−10 CC") are set by a signed number, as they read.
  Values that cannot be negative refuse a bare sign and say how to write either intent, so the entry is never silently
  turned into 0.1 s by the range clamp.

### What worked
- All app checks listed above. Real mode: the pixel mean follows time monotonically, and 10 s comes back exactly to
  0.4842. Normalised: inert controls are hidden, and the mode switch works from the visible select.

### What didn't work
- `drive.mjs` first run: `locator.click: Timeout 30000ms exceeded … waiting for locator('.cb-strip-b')`. Classic has no
  Strip button (only darkroom's `.testStrip()` has one). Second run: `getByRole('button', { name: 'Test strip', exact: true })`
  timed out too (the button's accessible name is not exactly that). Third run: `.cb-tools` + `hasText` worked.
- The simple-layout part of `drive.mjs` had not finished when this step was written (no "simple:" lines in the log yet).

### What I learned
- The classic Darkroom shows Time and Aperture for a photo in real mode, the capture film (not the scan film) and no
  scanner (F23). A photo's first print is still the defaults (10 s), which is the same picture as before.

### What was tricky to build
- `isRelativeEntry` must agree with `parseEntry`: a bare `−5` on lights is now absolute, so its toast must not say
  "−5 → …" as if relative. The regex requires a unit after the number.

### What warrants a second pair of eyes
- F8 changes behaviour that CHB-027 introduced (`-5` relative with a hint). Anyone with muscle memory for `+2` on
  points now sets +2 instead of adding 2.

### What should be done in the future
- **Resume list.** Done: Step 1 verification; Step 2 (67a4a57) real default, contract 0.4, layout option, hidden inert
  controls, Lighter/Darker, time strip in normalised mode, first print by mode, F19 empty state, F23 film controls by
  kind; F8 (this commit). Half-done: none in code. Not started: F9 leftovers (engine tooltip: `apps/studio/src/main.ts`
  line ~183 `engineEl.title` and `apps/studio/src/status-text.ts`; the LibRaw/camera-matrix note: `notesEl.title`
  ~line 262; the view tabs "Dyes" / "Base & gamut": `packages/studio-kit/src/cb.ts` `VIEW_LABELS`), F12 (Edit ▸ Undo
  label names the frame when it is not the current one: find the `edit.undo` command label in `cb.ts`/shell).
- Next steps: (1) F9 wording; (2) F12 label; (3) e2e spec `e2e/studio-enlarger.spec.ts` (classic photo: typed Time
  changes pixels; tiny: Time hidden, mode select, Lighter moves the lights; empty state); (4) `pnpm test`, then
  `STUDIO_PORT=5221 STUDIO_KIT_PORT=5222 SHELL_DEMO_PORT=5223 GPU_PARITY_PORT=5224 CI=1 pnpm test:browser`;
  (5) look at the screenshots in `various/ws-a/`, check off tasks x86v 0xav 5ywv 9i1n 3z8z l1ny with
  `docmgr task check --ticket CHB-031 --id …`, final diary step.
- Not yet recorded: the simple-layout nudge measurements (re-run `node …/scratchpad/wsa/drive.mjs <ws-a dir>` with the
  preview on :4711).

### Code review instructions
- `packages/studio-kit/src/kit/args.ts` `parseEntry`/`isSigned`, `kit/messages.ts` F8 block; `npx vitest run packages/studio-kit/test/messages.test.ts`.

### Technical details
- `isRelativeEntry`: `/^\s*[+−-][^A-Za-z]*\s*(st|stops?|s|sec|pt|pts|points?|CC|cc)\s*$/`.
- Bad-entry text for `-5` on Time: `Time: “-5” — to change the time, add a unit (−5 s or −1/3 st); to set it, type 5`.

## Step 4: Resume after the restart — the uncommitted F9 work finished, F12 checked, darkroom's empty state, an e2e spec

The session restarted after the Step 3 checkpoint (548abf9). The worktree held about 56 uncommitted lines in 8
files and an untracked `various/` folder: the previous agent had started the F9 leftovers after the checkpoint. I
reviewed the diff and kept all of it. It gives the engine and decode tooltips a plain sentence first and the
technical text second (`engineTip`, `notesTip` in `status-text.ts`, with unit tests). It renames the view tabs
"Dyes" → "No mask" and "Base & gamut" → "Clipping", with a tooltip that also gives the old technical name
(`VIEW_TIPS`; a one-line change in the shell's `segmented` renderer, so a text option can carry a tip). It moves
the Darkroom group notes below the group's controls and lets them wrap: `ck.text` ignores `class`, so the old
`cb-group-note` and `cb-empty` classes never reached the DOM, and the notes were cut off at the panel's edge
(`various/ws-a/06-tiny-negative-normalised.png`). What was missing: the updated snapshots, a DEMO.md line that
had been half-edited, and the doc comment of `Arrangement.note`. The screenshots in `various/ws-a/` (01–08) are
from Step 3's run and use synthetic files only (the M1 fixture and the synthetic DNG of `e2e/studio-photo.spec.ts`).

F12 needed no code. CHB-027 already made Edit ▸ Undo/Redo name the frame (`builtins.ts` `edit.undo` label →
`whereOf`, tested in `e2e/studio-wording.spec.ts` and `packages/studio-kit/test/messages.test.ts`). Session 02's
verdict "menu label still 'Undo Time'" came from `s11-undo.mjs`, where the undo was on the frame on screen, and
the label then correctly names no frame. Its own `shots/23-undo-menu-other-frame.png` shows "Redo Time (on
raw010.dng · 3/3)". I then closed two gaps of F19/F17 in the darkroom layout and wrote the e2e spec from the resume
list. The darkroom layout places its controls outside `cb.panel.controls`, so without a frame its Enlarger and
Paper panels were empty boxes. And a frame saved in normalised mode, which is every frame opened before contract
0.4, lost its Time and Aperture there with no way back.

### Prompt Context
**User prompt (verbatim):** "You continue an interrupted implementation: CHB-031 workstream **WS-A: enlarger and controls** in the chromobench monorepo. The previous agent was stopped when the session restarted; its work is committed up to a checkpoint, plus some uncommitted edits.

**Work ONLY inside this existing git worktree** (do not create a new one): `/home/manuel/code/wesen/chromobench/.claude/worktrees/agent-a6d56059a7d1976ca` on branch `task/chb-031-enlarger` (last commit 548abf9). Start every shell command with `cd /home/manuel/code/wesen/chromobench/.claude/worktrees/agent-a6d56059a7d1976ca && …` and use absolute paths inside it for file edits. Do not touch the main checkout at /home/manuel/code/wesen/chromobench or other worktrees.

Read first:
1. The common brief: /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/brief-common-v2.md (rules, checks, diary format, final reply; its \"Additions\" section matters).
2. The plan: `ttmp/2026/11/12/CHB-031--cosplay-session-02-findings-enlarger-real-mode-by-default-open-as-panels-strip-frames-leftovers/design-doc/01-plan.md` (section WS-A) and that ticket's `diary/01-diary.md` (owner decisions).
3. Your diary, which you continue: `ttmp/2026/11/12/CHB-031--…/diary/02-diary-ws-a-enlarger-and-controls.md` — read all steps; Step 3 is the checkpoint with the resume list.
4. `git status` / `git diff` in the worktree: 8 modified files (apps/studio DEMO.md, main.ts, status-text.ts and its test, e2e/studio-real.spec.ts, e2e/studio.spec.ts, packages/shell/src/dom/forms/basic.ts, packages/studio-kit/src/cb.ts; ~56 lines) plus untracked screenshots under the ticket's `various/` — work the previous agent did after its checkpoint (likely the F9/F12 leftovers). Review it: finish it or revert deliberately.

Then finish WS-A: the remaining items of the resume list (F9 and F12 leftovers and anything else open), full checks (`pnpm typecheck`, `pnpm lint`, `pnpm test`, and `STUDIO_PORT=5221 STUDIO_KIT_PORT=5222 SHELL_DEMO_PORT=5223 GPU_PARITY_PORT=5224 CI=1 pnpm test:browser`), check off plan tasks x86v 0xav 5ywv 9i1n 3z8z l1ny that are done (`docmgr task check --ticket CHB-031 --id …`), final report per the brief.

The user's instruction (verbatim): \"commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)\". Continue the same diary file with the next step number: the investigation format from /home/manuel/.claude/skills/diary/references/investigation-entry.md, every section in every step; the first new step records the resume (what you found uncommitted and what you did with it) and quotes this prompt verbatim in its Prompt Context. Stage named paths only. Preview port 4711 if you run the app. The owner's Mac is closed: do NOT use the Mac/real-GPU path; record any GPU check as pending. Parallel agents are continuing CHB-031 WS-B (open flow, frames.ts, decode.ts) and CHB-032 (housekeeping) in their own worktrees; `cb.ts` is shared with WS-B — keep edits local."
**Assistant interpretation:** Review the uncommitted F9 work and keep or revert it, then finish what is open (F9, F12, the e2e spec, the checks, the task check-offs) and report.
**Inferred user intent:** No work lost across the restart. Each finding is either fixed or explained with evidence.
**Commit (code):** b90d7ef — "CHB-031 WS-A: F9 wording (tooltips, view tabs), wrapped group notes, darkroom empty state and mode select, e2e studio-enlarger spec; diary step 4"

### What I did
- Read the brief, the plan (WS-A), the CHB-031 diary, this diary (Steps 1–3), `git diff` (8 files) and the
  scratch scripts `…/scratchpad/wsa/{drive.mjs,simple.mjs,mkdng.ts,drive.log}`. The log ends in Step 3's simple-layout
  timeout (`locator.waitFor: Timeout 120000ms exceeded … locator('#status').filter({ hasText: 'rendered' })`).
- Kept the uncommitted diff:
  - `apps/studio/src/status-text.ts`: `engineTip`, `notesTip`. `main.ts` uses them for `engineEl.title` and `notesEl.title`, two local lines.
  - `packages/studio-kit/src/cb.ts`: `VIEW_LABELS` and `VIEW_TIPS`. `controls()` puts the note after the paths with
    `{ dim, wrap }`. `ifFrame`'s empty text gets `wrap`.
  - `packages/shell/src/dom/forms/basic.ts`: `segmented` sets `data-tip` from `o.tip` for text options.
  - `e2e/studio.spec.ts` and `e2e/studio-real.spec.ts`: the new tab names.
- Finished it: rewrote the DEMO.md views line, the Enlarger-mode paragraph and the typed-entry rule (F8) in
  `apps/studio/DEMO.md`. Changed the `Arrangement.note` doc comment in `model/arrangement.ts`. Ran
  `npx vitest run packages/studio-kit -u`; the 6 snapshot diffs were exactly `class "cb-empty"` → `wrap` and the
  note moving below the controls.
- F12: no change. I read `packages/shell/src/app/builtins.ts` (`edit.undo` and `edit.redo` labels → `whereOf`), the
  session-02 scripts `s11-undo.mjs` (one frame) and `s13-strip-frames.mjs`, and `shots/23-undo-menu-other-frame.png`.
- `packages/studio-kit/variants/darkroom.js`: Enlarger and Paper panels wrapped in `cb.ifFrame(…)`.
  `cb.arg('print.enlarger.mode')` added first in the Enlarger panel. `variants/looks.js`: its Enlarger panel wrapped in `cb.ifFrame`.
- New `e2e/studio-enlarger.spec.ts` (5 tests, reference engine, synthetic files): classic negative, classic photo,
  tiny, simple, darkroom (including a frame saved in normalised mode in tiny and opened again in darkroom, without `&fresh`).
- App run: `pnpm --filter @chromobench/studio build`, `preview --port 4711 --strictPort` (background, stopped
  afterwards). `node …/scratchpad/wsa/drive2.mjs <various/ws-a>` saved screenshots 08–13; log in `…/scratchpad/wsa/drive2.log`.
- Checks: `pnpm typecheck` clean; `pnpm lint` clean ("import boundaries ok (338 file checks)"; check-colours clean);
  `pnpm test` → 97 files, 2749 passed, 7 skipped (85 s). Spec: `STUDIO_PORT=5221 STUDIO_KIT_PORT=5222
  SHELL_DEMO_PORT=5223 GPU_PARITY_PORT=5224 CI=1 npx playwright test e2e/studio-enlarger.spec.ts --project=chromium-webgpu` → 5 passed (1.2 min).

### Why
- I kept the F9 diff because it is what the plan asks for: human wording first, technical text second. The
  technical text stays in the tooltips, so nothing is lost for a developer. "Clipping" is the word Lightroom uses
  for "this part of the picture holds nothing". "No mask" says what the view shows.
- I put the mode select in darkroom's Enlarger panel and did not add a migration, because saved recipes keep their
  mode (owner decision). The photographer then needs to see the mode and be able to change it in every layout
  that shows Time. Classic, lab and tiny have it in the Darkroom group. Darkroom had no way to show it.
- The e2e spec uses the reference engine because the mock engine has no optics. A pixel check is only evidence on
  the film and paper model.

### What worked
- Pixel evidence in the browser (classic, M1 negative, reference engine): 20 s prints darker than 10 s, 5 s lighter
  (each by more than 0.02 of the display mean). Typing 10 again gives the 10 s picture back to 6 decimals. The pad's
  Lighter moves Time from 10 to 7.94 s and leaves the lights unchanged. The strip bands read "6.3 s, 7.94 s, 10.0 s,
  12.6 s, 15.87 s".
- The app on :4711 (`drive2.log`):
  - Views `["Print"…],["No mask","The negative without its orange mask: … (the dyes view)"],["Clipping","Where the
    negative holds no picture … (the base and gamut view)"]`.
  - Engine tip "The prints are computed on the processor, which is slower. Pictures are previewed smaller.\nTechnical:
    reference · CPU f64 (worker) · 512 px".
  - Decode tip "Synth Camera photo, 1 MP. Developed from the camera RAW with its own colour.\nTechnical: photo: camera
    RAW (Synth Camera) via LibRaw, photo mode, 1200×800, camera matrix from dng · working image 512×341".
- Darkroom with no frame: "Enlarger\nSelect a photo to print it." With the M1 negative: real, 7.071 s, lights
  (0.033, 0.0063, −0.0186), mean 0.6221. Tiny, the same file: normalised, 10 s, lights (−0.1175, −0.1442, −0.1691),
  mean 0.6221. The first print gives the same picture in both modes, with the density in the time or in the lights.
- Simple (the measurements missing from Step 3): normalised, mean 0.6221. Lighter moves the lights to (−0.2179,
  −0.2445, −0.2695), which is −0.1003 log H (⅓ stop) each, mean 0.6719. Lighter again gives mean 0.7232. Darker goes back to
  0.6719. The time stays at 10 s. The History paths are only `print.lights.logH`.
- The same classic test on the GPU engine: a throwaway copy of the spec with `engine=gpu` and the other tests
  skipped (`e2e/zz-tmp-gpu-enlarger.spec.ts`, deleted after the run) passed on `GPU · google swiftshader (software) ·
  4000 px` (the label asserted), 1 passed in 15.7 s. So Time changes the print on the GPU engine too (software WebGPU, not a real GPU).
- Screenshots 09–13 look right: the Clipping tooltip, both notes wrapped in full, darkroom's empty panels, and
  darkroom's mode select above Time.

### What didn't work
- First run of the new spec: 3 of 4 failed. Classic: `Expected: 7.937005259840998 Received: 10`. Tiny: `Expected:
  -0.142525 Received: -0.117525`. Simple: `Expected: -0.21786833188799373 Received: -0.117525`. The Lighter/Darker
  clicks go through `route.step` (a burst, like the arrow keys), and the burst reaches the EditLog only when it
  ends. `chromobench.idle()` returned before that. Fixed with `expect.poll` on the log's value after each click.
- `toHaveText([... '12.6 s', '15.9 s'])` failed: received `"15.87 s"`. The strip labels keep two decimals below
  100 s and drop a trailing zero. Expectation corrected.
- `pnpm typecheck`: `e2e/studio-enlarger.spec.ts(57,96): error TS2339: Property 'path' does not exist on type
  'LoggedMutation'`. The path is at `e.m.path`. The two "History never records Time" assertions had passed
  vacuously (every path read `undefined`). Fixed the helper, and each of those assertions now also checks that
  `print.lights.logH` *is* recorded.

### What I learned
- `ck.text` renders only `strong`, `dim`, `mono`, `size` and `wrap`. A `class` prop is silently dropped. Use `wrap` for a sentence in a panel.
- The F12 "partly" verdict of session 02 was a misreading: the label names the frame only when the undo acts on
  another one, and in `s11` it did not.
- A pad or nudge click is not synchronous with the log. Tests that read `log.committed` after a click must wait for the burst to end.

### What was tricky to build
- The "History never records an inert control" assertion: written against the wrong field, it passed without
  testing anything. A negative assertion needs a positive control next to it. Here that control is "the lights
  *are* recorded".
- The saved-mode case in the browser: `&fresh` keeps the library in memory, so the test boots without it (a new
  Playwright context starts with an empty IndexedDB). It opens the file in tiny, navigates to darkroom and opens the
  same bytes again. The frame resumes its saved log by hash.

### What warrants a second pair of eyes
- The view renames are user-visible text that other places may quote (keys 1–4 have no label of their own; the help
  and the DSL docs do not name the tabs; `apps/studio/src/host/studio-engine.ts` has a comment "Negative / Dyes / Base").
- `packages/shell/src/dom/forms/basic.ts` is a shared package (one line). A segmented option with `tip` and no icon
  now gets a tooltip where it had none.
- The darkroom layout now always shows the mode select, also in real mode. That is one more line in a layout that
  wanted to be lean. The alternative would be to show it only while the frame is normalised.

### What should be done in the future
- Darkroom's empty-state text appears twice (Enlarger and Paper). Its Exposures panel is empty without a frame (it was before too).
- Real-GPU check pending (the owner's Mac is closed). The GPU engine itself was checked on SwiftShader (below,
  "What worked"); on the M1 Max, repeat the classic test of `e2e/studio-enlarger.spec.ts` with `engine=gpu`.

### Code review instructions
- `git show` this commit. Start with `e2e/studio-enlarger.spec.ts`, then `packages/studio-kit/variants/darkroom.js`,
  `packages/studio-kit/src/cb.ts` (`controls()`, `ifFrame`, `VIEW_LABELS`/`VIEW_TIPS`) and `apps/studio/src/status-text.ts`.
- `npx vitest run apps/studio/test/status-text.test.ts packages/studio-kit`;
  `STUDIO_PORT=5221 STUDIO_KIT_PORT=5222 SHELL_DEMO_PORT=5223 GPU_PARITY_PORT=5224 CI=1 npx playwright test e2e/studio-enlarger.spec.ts --project=chromium-webgpu`.

### Technical details
- The spec's helpers: `enlarger(page)` reads `log.committed.print`, and `mean(page)` averages a 9×9 grid of
  `chromobench.pixel`. `paths(page)` returns `log.entries.map(e => e.m.path ?? e.m.op)`.
- `engineTip`: `mock…` → "A preview without the film and paper model."; `GPU…(software)` → emulated graphics card;
  `GPU…` → "on the graphics card"; `reference…` → "on the processor, which is slower[: this browser offers no
  graphics card to compute on]. Pictures are previewed smaller."; then `\nTechnical: <label>`.
- `notesTip`: the summary, then ". Developed from the camera RAW with its own colour." for `photo: … via LibRaw`, or
  ". Read from the camera RAW without developing it, as a scan." for other LibRaw decodes, then `\nTechnical: <notes · joined>`.

## Step 5: Full browser suite green; tasks checked; WS-A handed over

Last step of the workstream: the full browser suite on this workstream's ports, then the plan tasks. All 98
browser tests passed, the new `studio-enlarger` spec among them. I checked off the five tasks that are WS-A's
alone (x86v, 0xav, 5ywv, 9i1n, 3z8z). I left l1ny open. Its F8, F9 and F12 parts are done (Step 3, Step 4, and
F12 verified as already fixed). The same task also lists F10 on the CPU engine, which the plan gives to WS-B, so
checking it here would mark F10 done without anyone having done it.

### Prompt Context
**User prompt (verbatim):** see Step 4.
**Assistant interpretation:** Run the last checks, check off the finished tasks and report.
**Inferred user intent:** A branch the orchestrator can merge without re-running anything blind.
**Commit (code):** this step's commit ("CHB-031 WS-A: tasks checked (x86v 0xav 5ywv 9i1n 3z8z); diary step 5")

### What I did
- `STUDIO_PORT=5221 STUDIO_KIT_PORT=5222 SHELL_DEMO_PORT=5223 GPU_PARITY_PORT=5224 CI=1 pnpm test:browser` (background;
  output in `…/scratchpad/wsa/browser-step5.txt`).
- `docmgr task check --ticket CHB-031 --id x86v` and the same for 0xav, 5ywv, 9i1n and 3z8z.
- `git checkout --` on `ttmp/…/CHB-027--…/various/ws-d/01-synthetic-strip-frame2.png`: the browser suite rewrites
  that screenshot (`e2e/studio-strip.spec.ts:51`), and the change is not this workstream's.

### Why
- l1ny stays open for the reason given above. The orchestrator can check it once WS-B's F10 is in.

### What worked
- Browser suite: `98 passed (3.8m)`, exit 0, with no failures and no flaky tests. That covers chromium-webgpu
  (including `studio-enlarger` 5/5, `studio`, `studio-real` with the renamed tabs, `studio-wording` with F8),
  gpu-parity, shell-demo and studio-kit (the darkroom, simple, lab and tiny variants mount and render).
- Unit suite (Step 4): 97 files, 2749 passed, 7 skipped. `pnpm typecheck` and `pnpm lint` are clean.

### What didn't work
- No failures. The one side effect is the CHB-027 screenshot that `studio-strip.spec.ts` writes into `ttmp/` on
  every run (restored, not committed).

### What I learned
- An e2e spec writes into a ticket's `various/` folder on every run. Any agent that stages broadly would commit it.

### What was tricky to build
- N/A for this step (checks and bookkeeping).

### What warrants a second pair of eyes
- The merge with WS-B: both change `packages/studio-kit/src/cb.ts` (no overlapping hunks: WS-A at the
  `views`/`controls()`/`ifFrame`/`VIEW_LABELS` lines, WS-B elsewhere) and `test/__snapshots__/variants.test.ts.snap`
  (regenerate with `npx vitest run packages/studio-kit/test/variants.test.ts -u` after the merge and read the diff).
  Contract 0.4 regenerated docs (`pnpm gen`) may conflict with CHB-032's; regenerate rather than hand-merge.

### What should be done in the future
- Session 03 (task b50a): the darkroom flow in real mode (test strip in seconds, time, filtration), and the old
  library's normalised frames, which keep their mode, show the mode select, and switch with one click.
- Real-GPU check on the M1 Max: pending (Mac closed).
- Not changed in this workstream: the looks kit's "density" look writes `print.enlarger.time_s`, which does nothing
  on a normalised recipe. Agent proposals can also set Time on a normalised recipe, because the inert rule is enforced in
  `cb.arg`, not in the EditLog. The DSL's `cb.testStrip(frame, {vary:'time'})` is not checked in normalised mode.
- CHB-032: `e2e/studio-strip.spec.ts` should write its screenshot to `test-results/`, not into a ticket folder.

### Code review instructions
- `git log --oneline 9d10010..task/chb-031-enlarger`; review in commit order (67a4a57, 548abf9, b90d7ef, this one).
- Re-run: `pnpm typecheck && pnpm lint && pnpm test`; `STUDIO_PORT=5221 STUDIO_KIT_PORT=5222 SHELL_DEMO_PORT=5223 GPU_PARITY_PORT=5224 CI=1 pnpm test:browser`.

### Technical details
- Findings status for WS-A: F17 fixed (real default via contract 0.4; normalised as the default of simple and tiny,
  with Time, Aperture and magnification hidden and refused; pixel tests on the RefEngine, on the CPU worker in the
  browser, and on SwiftShader WebGPU). F19 fixed (controls panels, darkroom, looks). F23 fixed (film and scanner by
  kind; viewing light explained). F8 fixed (a change needs a sign and a unit). F9 fixed (tooltips and tab names).
  F12 already fixed by CHB-027 (verified, no change).
- Shared files touched: `apps/studio/src/main.ts` (Step 2: `createStudio({ enlarger })`; Step 4: two tooltip lines),
  `packages/studio-kit/src/cb.ts` (local hunks), `packages/shell/src/dom/forms/basic.ts` (one line), and the
  contract (0.4.0, CC-017).
