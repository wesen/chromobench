---
Title: Diary
Ticket: CHB-046
Status: active
Topics:
    - studio
    - ux
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://apps/studio/src/host/first-print.ts
      Note: SCAN-5 studio first print through firstPrintLights
    - Path: repo://apps/studio/src/main.ts
      Note: NEW-1 intoPrint; D8 host firstPrint and neutraliseNow
    - Path: repo://apps/studio/test/enlarger-mode.test.ts
      Note: F44 numeric test
    - Path: repo://e2e/studio-editing-blockers.spec.ts
      Note: e2e for D1, P9-1, P9-9, F44, P9-6, D5
    - Path: repo://packages/core/src/print/enlarger-mode.ts
      Note: DARK-3 modeShiftLogH (core)
    - Path: repo://packages/core/test/darkroom-order.test.ts
      Note: D5 reordering does not change pixels
    - Path: repo://packages/studio-kit/kits/looks/src/commands.ts
      Note: NEW-2 askSync and the sync dialog
    - Path: repo://packages/studio-kit/kits/roll/src/engine/analyse.ts
      Note: SCAN-5 roll analysis through firstPrintLights, withNeutralise
    - Path: repo://packages/studio-kit/kits/stack/src/commands.ts
      Note: MASK-1 mask tools disarm, gradients need a drag; D5 stack.byKind
    - Path: repo://packages/studio-kit/kits/stack/src/dom.ts
      Note: NEW-3 order choice, summary, kind badges
    - Path: repo://packages/studio-kit/src/commands/print.ts
      Note: DARK-2 Apply Print Settings asks; DARK-3 print.enlargerMode
    - Path: repo://packages/studio-kit/src/dom/arg.ts
      Note: DARK-5 relative drag and key steps; DARK-3 mode control
    - Path: repo://packages/studio-kit/src/kit/args.ts
      Note: DARK-5 feelOf, dragTo, keyStepOf
    - Path: repo://packages/studio-kit/src/model/aim.ts
      Note: SCAN-5 one first-print aim
    - Path: repo://packages/studio-kit/src/model/enlarger-mode.ts
      Note: DARK-3 modeSwitch and the optics fallback
    - Path: repo://packages/studio-kit/src/model/settings.ts
      Note: DARK-2 settingsPlan
    - Path: repo://packages/studio-kit/test/control-feel.test.ts
      Note: P9-6 control mapping tests
    - Path: repo://packages/studio-kit/test/editing-blockers.test.ts
      Note: P9-9, F44, D5, D8 headless tests
ExternalSources: []
Summary: 'CHB-046 implementation diary: mask tool disarms, Apply Print Settings asks, Real/Normalised keeps density, finer sliders, open into Print, sync copies, stack in his order, one first-print aim.'
LastUpdated: 2026-11-15T18:55:06.173276-05:00
WhatFor: ""
WhenToUse: ""
---



















# Diary

## Goal

What CHB-046 changed, why, what failed on the way (verbatim), the numbers before and after, and how to review it. CHB-046
is Phase 1 of the CHB-044 roadmap: the editing blockers of the CHB-037 P9 persona session (P9-1, P9-9, P9-6) and
CHB-028 F44, plus the work the owner's delegated decisions D1, D4, D5 and D8 create. Worktree
`<scratchpad>/chb046`, branch `task/chb-046-editing-blockers` from the integration branch at 9be785b.

## Step 1: Reading the sources and planning the eight items

I read the handoff guide, CHB-037's working rules, the CHB-044 roadmap and decisions, the CHB-037 tasks P9-1/P9-9/P9-6,
CHB-028's F44 and t:5wjl, and the P9 persona session's diary and experience report (how each bug was found: the armed
Linear tool drawing a gradient on a Curve layer, frame 3's 31.75 s overwritten with 7.07 s by Apply, 60 px of Time = 2
stops, 40 px of Y = −43 CC, Classic opening on the Library after a layout switch). Then I located each behaviour in the
code before changing anything, created the ticket with docmgr and its ten tasks.

### Prompt Context

**User prompt (verbatim):** "You are implementing ticket CHB-046 in chromobench, a browser darkroom (PWA, TypeScript monorepo with pnpm; studio kit in packages/studio-kit, shell in packages/shell, app in apps/studio, contract in packages/contract, reference engine in packages/core, WebGPU engine in packages/gpu) that the owner builds for his father, a photographer coming from Lightroom + Negative Lab Pro + Dehancer. It is Phase 1 of the roadmap in the consolidated backlog: the editing blockers the walkthrough found, plus the work the owner's (delegated) decisions create.

WORKTREE: /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb046 (branch task/chb-046-editing-blockers, from the integration branch task/chb-037-unified-model at 9be785b). Work only there. Run `pnpm install` first if node_modules is missing.

READ FIRST
- docs/HANDOFF.md (how the repo works, checks, privacy, the studio's layouts Classic / Darkroom first).
- ttmp/2026/11/14/CHB-037*/design-doc/01-implementation-plan-and-working-rules.md (working rules).
- ttmp/2026/11/15/CHB-044*/reference/01-consolidated-backlog.md ("Roadmap", items below) and reference/03-decisions-d1-d13.md (D1, D4, D5, D8).
- The source tasks: CHB-037 tasks.md P9-1, P9-9, P9-6; CHB-028 tasks.md (F44 Real↔Normalised, t:5wjl first-print aim); the CHB-037 walkthrough/persona material under ttmp/2026/11/14/CHB-037*/reference/ and diaries for how each was found.

SCOPE
1. MASK-1 / P9-1: a mask tool stays armed after a gesture; a later click on the picture adds a gradient mask to whatever layer is selected. Disarm after one mask (return to the default tool), and require a drag for gradient tools (a click alone does nothing). e2e test.
2. DARK-2 / P9-9: Frame ▸ Apply Print Settings to Selection copies from the last-clicked frame (the primary) and silently overwrites a corrected frame. Show the source frame and what is copied before applying (a confirmation in the page, not a browser dialog), make the primary visible in the strip, and make it undoable as one step. Test.
3. DARK-3 / CHB-028 F44: switching a print between Real and Normalised mode darkens it (luma 105 → 52 in the session). Carry the exposure (the time's density) into the lights on a mode switch and back so the print keeps its density. Test with a numeric check.
4. DARK-5 / P9-6: sliders are coarse (60 px of Time = 2 stops, 40 px of Filtration Y = −43 CC). Finer drag ranges per control kind and a fine-drag modifier (Shift = ×0.1 or similar; Alt if Shift is taken — check the shell's existing conventions), keyboard steps in photographer's units (⅓ stop, 5 CC). Tests on the control mapping.
5. NEW-1 / D1: Classic stays the default arrangement; opening a file goes to Print, not Library.
6. NEW-2 / D4: the sync dialog says it copies values; "Link" is an explicit option there (and Auto Sync while held, if that exists); no model change.
7. NEW-3 / D5: the darkroom stack lists layers in the photographer's order (the order he made them), each with a kind badge; the Enlarger panel keeps a by-kind summary as a view. No change to the print (the light law is order-independent; add a test that reordering the list does not change pixels).
8. SCAN-5 / D8: one first-print aim for roll and studio: neutralise 75 % (keep a quarter of each frame's cast), shown as a "Neutralise" amount the photographer can change, used by both the Roll module's first prints (today ALPHA 0.75) and the studio's first print (today alpha 1). One function, both callers. Update goldens/tests that change; record before/after in the diary.

CHECKS before you report: pnpm typecheck, pnpm lint, pnpm gen:check, pnpm test, goldens, the SwiftShader browser suite (headless; STUDIO_PORT/GPU_PARITY_PORT/STUDIO_KIT_PORT/SHELL_DEMO_PORT set to ports in 5581–5589 — never 4173, which is the owner's dev server). If you need the real GPU, use the lock: `zsh /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb041-lock.sh <command>`. Do not edit files while a browser suite is running against them. Walk the changed flows once in a headless browser (Playwright script) and note what you saw.

RULES
- Browsers headless only (headed windows steal the owner's focus).
- Privacy: test material includes the photographer's private family photos (.playwright-mcp/photos, scans; git-ignored). You may use them locally, never commit them or quote file names, people or content ("a 24-megapixel raw file").
- No backwards-compatibility shims (hard cut-off). Words in the UI in the photographer's terms (stops, CC, seconds), no developer text.
- Ticket: create CHB-046 with docmgr in the worktree (`docmgr ticket create --ticket CHB-046 --title "Editing blockers and decision work: mask tool disarms, Apply Print Settings shows its source, Real/Normalised keeps density, finer sliders, open into Print, sync copies, stack in his order, one first-print aim" --topics studio,ux`), tasks for the eight items, a short spec under design-doc/.
- DIARY (required): keep a detailed diary in the ticket following ~/.codex/skills/diary/SKILL.md exactly (read it first): one step per meaningful unit of work, with Prompt Context, What I did, Why, What worked, What didn't work (verbatim errors and commands), What I learned, What was tricky, What warrants a second pair of eyes, Future, Code review instructions, Technical details. Relate files, update the changelog.
- COMMIT at appropriate intervals (per item or two, then checks, then diary), messages starting "CHB-046:" and ending with the line
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Do not push. Do not merge into the integration branch (the coordinator merges).
- Another agent works in parallel in the sibling worktree chb045 (GPU correctness: pool/fields, grid rule in kernels and core, density-mask floor, retired memory, blend modes in the display encoding); avoid editing packages/gpu and the blend implementations; coordinate through the coordinator if you must.
- At the end, update the CHB-037 tasks for P9-1, P9-9, P9-6 and CHB-028's F44 and t:5wjl with " — done in CHB-046 (<commit>)" and check them.

REPORT (concise): per item what changed and the evidence (tests, before/after numbers, what the headless walk showed); checks with counts; goldens changed and why; commit hashes; anything left open."

**Assistant interpretation:** Implement the eight Phase 1 studio items in the CHB-046 worktree, each with tests (unit and e2e where asked), keep a docmgr ticket with spec, tasks and a strict diary, run every check including the SwiftShader browser suite on ports 5581–5589, walk the flows headless, commit without pushing, and mark the source tasks done.

**Inferred user intent:** Make the studio safe to edit in (no stray masks, no silent overwrites, no darkening switch, sliders a photographer can use) and carry out the delegated decisions, so the integration branch can merge into main at the end of Phase 1 (D13).

### What I did
- `pnpm install --frozen-lockfile` (node_modules was missing); baseline `pnpm test`: 142 files, 3425 passed, 19 skipped.
- Located: the mask tools (`packages/studio-kit/kits/stack/src/commands.ts` `maskTools`, up handlers commit on any click), the shell's pointer dispatch (`packages/shell/src/dom/viewport/pointer.ts`: `down` returning `false` ends a gesture), Apply Print Settings (`src/commands/print.ts`, `copySettings` in `src/model/settings.ts`), the strip's primary (`.ck-coll-cell.is-primary .cb-cell { background: var(--cellhi) }`: in the chromogen dark theme `--cellhi` #2a2a2a is darker than `--cellsel` #3a3a3a, so the primary was nearly invisible), the enlarger modes in core (`packages/core/src/print/enlarger.ts`: `offset = κ + optics`, real κ at the calibration pack), the arg control (`src/dom/arg.ts`, a native `<input type=range>` over the usual range), the open flow (`apps/studio/src/main.ts`: an opened file already went to Print; a layout switch did not), Sync (`kits/looks/src/commands.ts`: runs at once with the panel's mode), the Enlarger's `order: 'kind'` (`kits/stack/src/kit.ts`), the roll's `ALPHA = 0.75` and the studio's `FIRST_PRINT_AIM` alpha 1.
- `docmgr ticket create …`, ten `docmgr task add …`.

### Why
- Each item touches a different kit; reading first showed which items share files (print.ts, arg.ts, main.ts), which decided the commit grouping.

### What worked
- The shell's tool contract already had what MASK-1 needs: screen coordinates on every tool event, `down` → `false` to refuse a gesture, `enter`/`exit` handlers, and the builtin `tool.none`.
- Core's enlarger documents the exact shift between the modes, so F44 could be solved analytically instead of by measuring the picture.

### What didn't work
- N/A (reading only).

### What I learned
- Shell conventions: `modStep` is Shift ×10 and Alt ×0.1 (scrub, nudge); the arg control used Shift ×3 and Alt ×⅓ for its keys. Shift is taken, so the fine-drag modifier is Alt.
- "Classic opened on a Library grid" in the session was after View ▸ Layout with frames open, not after an open.

### What was tricky to build
- N/A (planning).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Start with the spec: `design-doc/01-spec-editing-blockers-and-decision-work.md` (one table, item → behaviour → files → evidence).

### Technical details
- Session evidence: CHB-037 `sessions/p9-01-manfred-arrangements/02-experience-report.md` (P9-1 shots/25, P9-9 shots/55–57, P9-6 shots/05–08).

## Step 2: MASK-1 — a mask tool makes one mask and disarms; gradients need a drag

The linear and radial tools now record the screen point of the press and do nothing on release when the pointer moved
less than 4 px (`MIN_DRAG_PX`); after a gesture that made a mask they run `tool.none`. The luminance tool and a new
colour range disarm after their one click (the colour range's "Sample" into an armed component was one-shot already).
The brush is the exception I chose: it keeps painting the layer it was armed for (`stack.mask.armedFor`, set on
`enter`), and a stroke after another layer or frame was selected disarms it and paints nothing.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Fix P9-1: one mask per arming, gradients need a drag, e2e test.

**Inferred user intent:** No more silent masks on whatever layer happens to be selected.

**Commit (code):** 5a9350c — "CHB-046: editing blockers and the decision work (P9-1, P9-9, F44, P9-6, D1, D4, D5, D8)"

### What I did
- `kits/stack/src/commands.ts`: `drawn()` returns the layer it drew into (or null); `MIN_DRAG_PX`, `isDrag`, `disarm`, `armBrush`; the five tools rewritten; the luminance tool's `down` returns `false` (no gesture state).
- `kits/stack/src/state.ts`: `mask.armedFor`.
- e2e `e2e/studio-editing-blockers.spec.ts` "D1 and P9-1": a click → no mask, tool still `mask-linear`; a drag → one mask, tool null; a Curve added, then a click and a drag on the picture → the curve has no mask and the clarity's mask still has one component; the radial tool → one ellipse, then no tool.

### Why
- The session's hazard was the armed tool plus a later click; disarming after one mask removes it, and requiring a drag removes the accidental zero-length gradient.

### What worked
- The e2e passes on SwiftShader (20.9 s).

### What didn't work
- N/A.

### What I learned
- `pointer.ts` calls `up` even for a click, with the last event; the tools must decide what a click means.

### What was tricky to build
- The brush: "disarm after one mask" read literally makes a brush mask one dab long. Tracking the armed layer instead keeps painting usable and still kills the hazard. The first stroke with no layer selected creates a burn and its mask; `armBrush` then moves `armedFor` to that new layer so the second stroke goes to the same mask.

### What warrants a second pair of eyes
- The brush policy (stays armed for its layer) is a reading of the spec, not the spec's literal words.
- `disarm` runs only when the commit succeeded; a refused gesture (a toast) leaves the tool armed.

### What should be done in the future
- MASK-4 (live preview of the gesture) and on-picture handles (MASK-3) will want the same "one gesture, one component" rule.

### Code review instructions
- `packages/studio-kit/kits/stack/src/commands.ts` from `drawn` to the end of `maskTools`.
- `CI=1 STUDIO_PORT=5581 … npx playwright test e2e/studio-editing-blockers.spec.ts -g "P9-1"`.

### Technical details
- Tool contract: `ToolSpec.on.{down,drag,up,cancel,enter,exit}`; `down` returning `false` ends the gesture before it starts (`packages/shell/src/dom/viewport/pointer.ts` 141–150).

## Step 3: DARK-2 — Apply Print Settings asks in the page and names its source

`print.applyToSelection` (now labelled "Apply Print Settings to Selection…") builds a plan first (`settingsPlan`: every
print setting that differs on at least one target, with the source's value as its control formats it and the frames it
changes). With nothing to copy it says "The selected frames already print like <name>" and asks nothing. Otherwise it
opens a dialog in the page: "Apply the print settings of roll-1.tif?", "From roll-1.tif: the frame shown, outlined in the
film strip.", "Onto …", the list ("Time: 31.75 s", "Printer lights: (+2, 0, −2) pt"), "One undo takes it back.", Cancel /
"Apply to N frames". Only Apply copies, as one transaction over all targets ("Apply print settings of roll-1.tif").
`{ ask: false }` copies at once for an agent or a script. The primary cell in the film strip and grid has an inset
accent outline (`box-shadow: inset 0 0 0 2px var(--selline)`).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Make Apply Print Settings show source and contents before it acts, make the primary visible, keep one undo step.

**Inferred user intent:** A corrected frame must never be overwritten silently by a roll-wide copy.

**Commit (code):** 5a9350c

### What I did
- `src/model/settings.ts`: `SettingCopy`, `settingsPlan(from, targets, describe)`.
- `src/commands/print.ts`: the async command, `applyBody` (DOM built from the dialog's content element, so the command stays headless-safe).
- `src/dom/studio-kit.css`: the primary's outline.
- Tests: `packages/studio-kit/test/editing-blockers.test.ts` (RecordingChrome: the dialog's title and buttons, Cancel changes nothing and adds no step, Apply copies Time and lights onto both targets, one undo restores both, the plan's words), e2e "P9-9" (strip outline computed style, dialog text, nothing copied while asking, one undo).
- `e2e/studio.spec.ts`: its apply now passes `{ ask: false }`.

### Why
- The session's frame 3 went from 31.75 s to 7.07 s because the last-clicked frame was the source; naming the source and the values makes the mistake visible before it happens.

### What worked
- Headless vitest and the e2e pass.

### What didn't work
- `pnpm typecheck`: `packages/studio-kit/src/commands/print.ts(69,27): error TS2571: Object is of type 'unknown'.` — `ctx.dialog` is not on the command table's `Ctx` type; I used `ctx.rt.chrome.dialog(...)` as `view.layout` does.

### What I learned
- `RecordingChrome.dialog` records the spec and returns a promise its test can resolve with `dialogs.at(-1).close('apply')`.

### What was tricky to build
- The documents may change while the dialog is open, so the copy re-reads the source and the targets after the answer.

### What warrants a second pair of eyes
- The command is async now: anything that ran it and expected the copy synchronously must pass `{ ask: false }` (I found one: `e2e/studio.spec.ts`).

### What should be done in the future
- A per-setting choice in the dialog (copy the time but not the colour) would be Lightroom's Synchronize dialog; not asked for.

### Code review instructions
- `src/commands/print.ts` `'print.applyToSelection'` and `applyBody`; `src/model/settings.ts` `settingsPlan`.

### Technical details
- Dialog text seen in the headless walk (Step 10).

## Step 4: DARK-3 — Real ↔ Normalised keeps the print's density

Core's enlarger says the two modes differ by one scalar log exposure for the same settings: real mode fixes κ at the
calibration pack and adds the optics, normalised mode takes κ at the current pack and ignores the optics. I added
`modeShiftLogH(env, settings) = offset(real) − offset(normalised)` to core (`print/enlarger-mode.ts`, through
`PhysicsEnv.chain`, so the camera-file mid-grey is the engine's), the host injects it as `services.darkroomMath`, and
studio-kit's `modeSwitch(doc, mode, shift)` writes the mode plus the lights moved by the shift (up into normalised,
back down into real). The mode control runs the new command `print.enlargerMode`; one step ("Normalised enlarger (the
print kept)"). Without the host's physics the optics alone carry the shift (exact at the neutral pack).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Make the mode switch carry the time's density into the lights and back, with a numeric test.

**Inferred user intent:** Switching the enlarger's way of working must not change the picture.

**Commit (code):** 5a9350c

### What I did
- `packages/core/src/print/enlarger-mode.ts` (new, exported from core's index), `apps/studio/src/host/engines.ts` (`buildDarkroomMath`), `apps/studio/src/main.ts` (passes it to mount), `src/model/enlarger-mode.ts` (new: `ExposureSettings`, `exposureSettingsOf`, `referenceOpticsShift`, `modeSwitch`), `src/commands/print.ts` (`print.enlargerMode`), `src/dom/arg.ts` (the mode's `commitSet` runs the command).
- Tests: `apps/studio/test/enlarger-mode.test.ts` (RefEngine, both kinds of frame, a print at 31.75 s, f/11, M 5 Y 15, lights off zero: the bare mode change vs the carried shift, there and back, the optics fallback, the lights' limit), `editing-blockers.test.ts` (command, one step, fallback), e2e "F44" (GPU).

### Why
- Measuring the picture would be async, engine-dependent and noisy; the shift is exactly known.

### What worked
- Numbers (RefEngine, print-display mean luma on 0–255; shift 0.152 log H for 31.75 s at f/11 with M 5 Y 15):

| frame | real | normalised, mode alone (the bug) | normalised, shift carried |
|---|---|---|---|
| negative scan | 16.53 | 20.44 | 16.53 |
| camera file | 61.72 | 99.78 | 61.72 |

  Max pixel difference with the shift carried < 1e-4 (f32 preview); there and back restores time and lights to 1e-6.
- GPU e2e (SwiftShader, 31 s, Y 15): mean 36.40 in both modes, max difference 0.000/255 on the 9×9 grid.

### What didn't work
- First run: `AssertionError: expected 31.750034 to be 31.75` — the lights are rounded to 1e-6 in `shiftLights`, and my "what the clamp kept out" was computed from the rounded lights, so a rounding remainder of ~1e-7 went into the time. Fixed by computing the overflow from the unrounded clamp.
- First run: `AssertionError: expected 3.916559908034344 to be greater than 5` — my guess at the size of the bug on the synthetic negative was too large (it is 3.9 luma levels there, 38 on the camera file); the threshold is 2.

### What I learned
- The session's luma 105 → 52 was a print whose time was far from 10 s; the size of the jump is log10(t/10) − 2 log10(N/8) plus the filter's cost.

### What was tricky to build
- The shift has to be computed for the document's own settings (film, paper, lamp, pack, optics, aim, viewing light, capture), read through links (a roll's medium), so `exposureSettingsOf` reads every field with `read(doc, path, links)`.

### What warrants a second pair of eyes
- A flash or split burn with its own filtration: its κ moves differently between the modes; the shift is the main exposure's (spec, "Decisions").
- The preflash term sits outside T_all (the lights do not multiply it); a print with a preflash keeps everything but the preflash's share exactly.

### What should be done in the future
- The agent's DSL can still set `stages.darkroom.medium.mode` directly (no carry); it could run `print.enlargerMode` instead.

### Code review instructions
- `packages/core/src/print/enlarger-mode.ts`, `packages/studio-kit/src/model/enlarger-mode.ts`, `'print.enlargerMode'` in `src/commands/print.ts`.
- `npx vitest run apps/studio/test/enlarger-mode.test.ts`.

### Technical details
- `shift = κ(calibration pack) − κ(current pack) + log10(t/10) − 2 log10(N/8) − 2 log10((m+1)/9)` (core `opticsLogH`, `REFERENCE_OPTICS` 10 s, f/8, ×8).

## Step 5: DARK-5 — finer drags, a fine modifier, keys in his units

The arg control's track takes over the pointer: a press records the value and the x position, a move sets the value
relative to the start by the control's feel per pixel (`feelOf`), snapped to whole slider steps from the start
(`dragTo`), Alt ten times finer; a press without a move still jumps to the clicked point. Keys step by the feel's key,
Shift bigger, Alt smaller; a layout's own `step` stays the plain arrow's.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Per-kind drag gain, a fine modifier following the shell's conventions, photographer's key steps, mapping tests.

**Inferred user intent:** Small, controllable moves of time and filtration.

**Commit (code):** 5a9350c

### What I did
- `src/kit/args.ts`: `FINE_DRAG`, `Feel`, `feelOf`, `keyStepOf`, `dragTo`.
- `src/dom/arg.ts`: pointerdown/move/up/cancel on the range (pointer capture, `preventDefault` so the native thumb does not jump), the keydown step.
- `packages/studio-kit/test/control-feel.test.ts` (mapping), e2e "P9-6".

### Why
- The native range maps the whole usual range (2–60 s, −50–100 CC) onto ~180 px; a relative drag with a per-kind gain fixes the resolution without a wider panel.

### What worked
- Mapping: 60 px of Time = ½ stop (was 2), Alt 0.05 stop; 40 px of Y = 10 CC (was 43), Alt 1 CC; 40 px of lights = 4 pt. Keys: 10 s → 12.6 s (⅓ st), Shift → 20 s, Alt → 11.22 s; Y 0 → 5 CC, Shift 20, Alt 1.
- e2e on the real control: 60 px of Time from 10 s → 14 s (0.485 st); with Alt → 10 s (0.05 st, rounded by the printer's whole seconds); ArrowRight → 12.6 s.

### What didn't work
- `AssertionError: expected 0.5114052381126379 to be close to 0.5` — `dragTo` first snapped the absolute value to multiples of the 1/6-stop step (a grid based on 1 s, not on the start value). Snapping the increment instead (whole steps from where the drag started) fixed it.

### What I learned
- Above 10 s a dragged time lands on whole seconds (`printerSeconds`), so a fine drag there moves in 1 s steps.

### What was tricky to build
- `preventDefault` on `pointerdown` suppresses the compatibility `mousedown`, so the range no longer takes the focus by itself; the handler focuses it so the arrow keys still work after a drag.

### What warrants a second pair of eyes
- The click-to-jump path computes the value from the input's box and its current min/max (the track widens around out-of-range values, `trackRange`).

### What should be done in the future
- The stack kit's own number tracks (amounts, mask settings) still use the native absolute track.

### Code review instructions
- `src/kit/args.ts` "how a slider answers the hand"; `src/dom/arg.ts` `track()`.
- `npx vitest run packages/studio-kit/test/control-feel.test.ts`.

### Technical details
- Feel table: Time 1/120 st/px, keys ⅓ / 1 / ⅙ st; CC 0.25 CC/px, keys 5 / 20 / 1; points 0.1 pt/px, keys 1 / 4 / ½; other: usual range / 300 px, keys step / 3·step / step/3.

## Step 6: NEW-1 and NEW-2 — open into Print; Sync says it copies

D1: Classic was already the default and an opened file already went to Print; the Library the session saw came after
a layout switch with frames open. `intoPrint()` in `main.ts` now covers both: after an open always, after a layout
switch when the new layout would start on its first module. D4: Settings ▸ Sync Settings to Selection… asks in the page:
"Sync copies the values of <source> onto <frames>: <groups>.", what is copied, and a radio "Copy values — Each frame is on
its own afterwards (as in Lightroom)." (checked) / "Link — The frames share one preset made from this frame’s layers: a
later change to it reaches all of them.", Cancel / "Sync N frames". The menu's "Sync Mode" toggle is gone (Link is chosen
in the dialog); the Looks layout's panel keeps its explicit radio and passes it. No model change.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Opening goes to Print in Classic; the sync dialog labels copy as the default and Link as an explicit choice.

**Inferred user intent:** Lightroom habits: open and print; Sync copies unless he chooses otherwise.

**Commit (code):** 5a9350c

### What I did
- `apps/studio/src/main.ts`: `intoPrint(always)`, used by the open flow and `switchLayout`.
- `kits/looks/src/commands.ts`: `looks.sync` without a mode → `askSync` → `syncBody`; `kits/looks/src/dom.ts` passes `v.mode`; `kits/looks/src/kit.ts` Settings menu without `looks.syncMode`.
- Tests: `looks/kit.test.ts` (existing sync tests pass the mode; a new D4 test: Cancel changes nothing; the default Sync copies values, makes no preset, one step), `e2e/walkthrough.spec.ts` (the dialog's radios, then "Sync 2 frames"), e2e "D1" (module after open and after Darkroom → Classic).

### Why
- D4: a link silently changes other frames later; it must be chosen, not inherited from a remembered mode.

### What worked
- All of the above pass.

### What didn't work
- N/A.

### What I learned
- Auto Sync does not exist in chromobench; nothing to label.

### What was tricky to build
- Keeping the agent's path dialog-free: a mode argument (`'copy'`/`'link'`) runs at once.

### What warrants a second pair of eyes
- `looks.sync` without a mode now returns a promise; scripts that ran it bare must pass the mode.

### What should be done in the future
- Lightroom's Synchronize dialog also lets him untick settings; the sync groups exist in the Looks layout only.

### Code review instructions
- `kits/looks/src/commands.ts` `askSync`, `syncBody`; `apps/studio/src/main.ts` `intoPrint`.

### Technical details
- N/A.

## Step 7: NEW-3 — the darkroom in his order, kind badges, a by-kind view

The Enlarger (Darkroom first) used `order: 'kind'`. It now uses `order: 'choice'`: his order (the stack's order, i.e.
the order he made the layers in or dragged them to) unless he presses "By kind" (`stack.byKind`, view state
`stack.darkroomOrder`). Above the rows a one-line summary by kind ("Main exposure · Burn · Dodge · Printer lights ·
Density mask"); each darkroom row has a kind badge after its name, hidden when the name is the kind. A core test prints
one darkroom (two burns with masks and their own filtration, a dodge, a flash, a density mask) in several orders and
in a group, and the prints agree to 1e-12.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** His order in the list, badges, a by-kind summary as a view, a pixel test that order does not matter.

**Inferred user intent:** Read the stack the way he built it, as in Photoshop and Lightroom.

**Commit (code):** 5a9350c

### What I did
- `kits/stack/src/model.ts` (`kindBadge`, `kindSummary`), `dom.ts` (`orderOf`, the summary and the By kind button, the badge in `drawRow`), `kit.ts` (`'choice'`), `commands.ts` (`stack.byKind`), `state.ts` (`darkroomOrder`), `stack.css`.
- Tests: `packages/core/test/darkroom-order.test.ts`, `editing-blockers.test.ts` (rows in both orders, the summary, the view is not a step), e2e "D5" (rows, badge after a rename to "Sky", summary, By kind, a layer moved to the top: GPU grid within 1/255).

### Why
- D5: the law is order-free, so the list can follow intent.

### What worked
- Core: reversed, rotated, the old by-kind order, a `move` mutation and a group of the two burns all give max |Δ| < 1e-12 at `darkroom.H` and the display.

### What didn't work
- The e2e first failed: `expect(received).toBeLessThan(expected) Expected: < 2 Received: 3` right after clicking By kind. A debug print showed the state was already `"kind"` but the rows still in his order; a second later they were by kind (`[ 'main', 'burn1', 'dodge1', 'lights', 'densityMask1' ]`, aria-pressed `true`). Cells flush on the runtime's scheduler, not synchronously; the test now polls (`expect.poll`).
- A headless vitest attempt to watch the cell (`s.rt.cell(...)` then `runCommand`) saw no update at all on a manual clock, for my key and for the existing `stack.hsl` alike: not conclusive, and not needed once the browser showed the update.

### What I learned
- `opWord('densityMask')` is "Density mask" (the catalogue's ui label), not "Contrast mask" (the default layer name).

### What was tricky to build
- Keeping the Enlarger's custom rows (main exposure with its controls, lights with the pad) in either order: they are keyed by id and only moved, so their state survives the reorder.

### What warrants a second pair of eyes
- The badge hides when name == kind; D5 says "each with a kind badge". A renamed layer always shows it.

### What should be done in the future
- The Exposures panel (Classic) already listed his order; it has no By kind view (not asked).

### Code review instructions
- `kits/stack/src/dom.ts` (search `D5`), `model.ts` `kindSummary`.
- `npx vitest run packages/core/test/darkroom-order.test.ts`.

### Technical details
- Kind order: `KIND_RANK` main 0, contribution 1, modulator 2 (`kits/stack/src/model.ts`).

## Step 8: SCAN-5 — one first-print aim, Neutralise 75 %

`studio-kit/src/model/aim.ts` holds the one aim: `NEUTRALISE = 0.75`, `neutraliseOf(state)` (prefs.neutralise, percent,
default 75), and `firstPrintLights(integrate, latd, neutralise)` — the function both first prints call. The roll's
`analyseFrame` and the host's `firstPrint` call it; the roll's `ALPHA` constant is gone; the host's `FIRST_PRINT_AIM` for
a negative is `alpha: NEUTRALISE`, and `firstPrintAim(kind, param, neutralise)` takes his amount (a photo keeps alpha 0).
The amount is a "Neutralise" slider (0–100 %, step 5, double-click 75) in a "First print" panel in Classic's Print
module and the Roll module, with an explanation in his words and "First print again" (`print.firstPrint`, host
capability `firstPrint`: the current negative printed anew with the amount now, one step "First print (neutralise 75 %)").
The Roll module's first print re-derives each frame's lights from its LATD with the amount now (`withNeutralise`), so a
new amount needs no new analysis.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** One aim function and amount for roll and studio first prints, visible and changeable, tests and before/after numbers.

**Inferred user intent:** The same frame prints the same from the roll and from the studio, with a darkroom printer's warmth kept.

**Commit (code):** 5a9350c

### What I did
- New `src/model/aim.ts`; `CbPrefs.neutralise`; `cb.panels.firstPrint`; Classic Print and Roll modules show it; `print.firstPrint` in `src/commands/host.ts`, `StudioHost.firstPrint`; host `reprint` and `firstPrint` in `apps/studio/src/main.ts` (`neutraliseNow` reads the mounted runtime's prefs).
- Roll: `engine/analyse.ts` (`firstPrintLights`, `withNeutralise`), `engine/lower.ts` and `kit.ts` (the amount from his prefs), `engine/constants.ts` (ALPHA removed).
- Tests updated: `apps/studio/test/host.test.ts` (75 %: mean at the aim, a quarter of the cast kept; 100 % to grey), `first-print-aim.test.ts` (the aim, his amount, a photo stays 0), roll `engine.test.ts` (D8 test: autos = `firstPrintLights` at 75 %, `withNeutralise`).

### Why
- D8: one aim; the roll already used 0.75 (unchanged numbers there); the studio's single-frame first print changes from 1 to 0.75.

### What worked
- Before/after, studio first print on the reference engine (frame departure from the aim, then time, lights and the measured exposure after the print; log H):

| frame | departure | alpha 1 (before) | alpha 0.75 (after) |
|---|---|---|---|
| M1 negative fixture | 0.2059, 0.2334, 0.2596 | 5.612 s; lights 0.0450, 0.0175, −0.0087; after 0, 0, 0 | 5.612 s; lights 0.0383, 0.0176, −0.0020; after −0.0068, 0.0001, 0.0067 |
| e2e scenes negativeScan 240×160 | 0.5611, 0.6143, 0.5762 | 2.5 s; lights 0.0409, −0.0123, 0.0258; after 0, 0, 0 | 2.5 s; lights 0.0352, −0.0047, 0.0239; after −0.0057, 0.0076, −0.0019 |

  The time (density) is unchanged; a quarter of each channel's departure from the frame's mean stays.
- The Roll module's first prints: unchanged (they were 0.75 already); the roll engine tests pass as before plus the new D8 test.
- Goldens: `node tools/goldens/render.ts --check` 66/66 unchanged (the goldens are fixed recipes, not first prints); the conformance goldens are unchanged.

### What didn't work
- `apps/studio/test/host.test.ts` failed as expected (`"alpha": 1` → `0.75`) and `first-print-aim.test.ts` (the old aim); both updated to the new aim with stronger checks.

### What I learned
- The roll stores each frame's LATD, so its first-print lights for another amount are a pure function of the analysis.

### What was tricky to build
- The host's automatic first print runs in `startEngine`'s `initial`, before any runtime exists: `neutraliseNow` is a module variable the first mount points at the runtime's prefs.

### What warrants a second pair of eyes
- "First print again" re-meters the current document with its layers (burns and dodges count in the metering), as the automatic first print would on that document.
- The amount lives in prefs (view tier, not undoable, persisted with the workspace), like Open As.

### What should be done in the future
- Darkroom first has no "First print" panel yet (its palettes are DARK-1, Phase 2).

### Code review instructions
- `packages/studio-kit/src/model/aim.ts`; its callers: `rg -n "firstPrintLights|neutraliseOf|NEUTRALISE"`.

### Technical details
- core `integrateToGrey`: ℓ = ℓ_aim + m + α(Δ − m) with Δ the frame's LATD from the aim, m its mean.

## Step 9: The code commit and the e2e spec

All eight items went into one code commit with their unit tests, because three files carry several items each
(`src/commands/print.ts`: P9-9 and F44; `src/dom/arg.ts`: F44 and P9-6; `apps/studio/src/main.ts`: F44, D1 and D8) and
splitting hunks without interactive staging was not worth the risk. The e2e spec `e2e/studio-editing-blockers.spec.ts`
(four tests: D1 + P9-1, P9-9, F44 + P9-6, D5) and the walkthrough/studio spec updates follow in the checks commit.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Commit, then the browser tests.

**Inferred user intent:** Reviewable history.

**Commit (code):** 5a9350c

### What I did
- `git commit` (message lists each item); `pnpm typecheck`, `pnpm lint` (506 file checks, 201 css files), `pnpm gen:check` (26 files), `pnpm test` (145 files, 3443 passed, 19 skipped) green before it; `npx vitest run packages/studio-kit/test/layouts.test.ts -u` for the layouts' explain snapshots (new commands, the "…" labels, the First print panels, `order "choice"`), read before committing.

### Why
- The snapshots list every command and panel per layout; their diff is the review of the UI surface.

### What worked
- Snapshot diff: +`print.enlargerMode`, +`print.firstPrint`, +`stack.byKind`, `print.applyToSelection` "…", `looks.sync` "…", `looks.syncMode` out of the Settings menu, `panel first-print` in six layouts and `first-print-roll` in the roll layouts, the Enlarger `order "choice"`.

### What didn't work
- See Step 7 (the By kind poll).

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- `git show 5a9350c --stat`.

### Technical details
- e2e run: `STUDIO_PORT=5581 GPU_PARITY_PORT=5582 STUDIO_KIT_PORT=5583 SHELL_DEMO_PORT=5584 CI=1 npx playwright test e2e/studio-editing-blockers.spec.ts --project=chromium-webgpu`.

## Step 10: The checks, three specs that followed the change, and the headless walk

The full SwiftShader browser suite ran once on ports 5581–5584 (10.6 min): 159 passed, 2 skipped, 3 failed, and all
three failures were the intended behaviour changes, not regressions. I updated those specs, reran them, and walked the
changed flows in a headless Playwright script on synthetic negatives. The walk found one piece of developer text in the
new Sync dialog (document path leaves such as `time_s`, `logH`), which I replaced by the controls' labels.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Run every check, fix what the change broke, walk the flows headless and note what I saw.

**Inferred user intent:** Evidence that Phase 1's studio half is mergeable.

**Commit (code):** d494096 — "CHB-046: e2e for the editing blockers; specs follow the new key steps and his order; sync dialog in his words"

### What I did
- `STUDIO_PORT=5581 GPU_PARITY_PORT=5582 STUDIO_KIT_PORT=5583 SHELL_DEMO_PORT=5584 CI=1 pnpm test:browser` (log in the scratchpad, `chb046-browser-1.log`).
- Updated `e2e/studio.spec.ts` (Filtration Y keys: 3 presses = +15 CC), `packages/studio-kit/test/browser/studio-kit.spec.ts` (3 Time presses = 1 stop: 20 s), `packages/studio-kit/test/browser/arrangements.spec.ts` (the Enlarger in his order `['main', 'lights', 'burn1']`, By kind `['main', 'burn1', 'lights']`); reran them: 19 passed. Reran walkthrough + CHB-046 + looks browser specs after the dialog wording change: 12 passed.
- `scripts/01-walk-changed-flows.mjs` against a dev server on 5585 with `node e2e/make-scenes.ts` files; log and eight screenshots in `various/walk/`.
- Final: `pnpm typecheck` clean, `pnpm lint` (506 file checks; 201 css files, no literal colours), `pnpm gen:check` (26 files), `pnpm test` 145 files / 3443 passed / 19 skipped (baseline 142 / 3425 / 19), goldens 66/66 unchanged, GPU conformance 524/524 (in the browser suite).

### Why
- The suite is the merge gate (D13); the walk is the check a photographer would do.

### What worked
- The walk (`various/walk/walk-log.txt`):
  - D1: boot on the Library; after opening two roll frames: module `print`; Darkroom first → Classic: `print`.
  - F44: luma 23.17 (real, 31 s) → 23.17 (normalised) → 23.17 (real); History: "Enlarger mode Real enlarger (time and aperture) → Normalised (grey card at the aim); Printer lights +20 pt (all three)" and back "−20 pt".
  - P9-6: 60 px of Time from 10 s → 14 s.
  - P9-9: "Apply the print settings of roll-12-frame-1.tif? | From roll-12-frame-1.tif: the frame shown, outlined in the film strip. | Onto roll-12-frame-2.tif. | … | Time: 31.75 s | Printer lights: (+1, −1, +2) pt | One undo takes it back. | Cancel | Apply to 1 frame"; then frame 2 at 31.75 s. Screenshot 03 shows the primary outlined in blue in the strip.
  - D4: "Sync copies the values of … : Film simulation, Paper, Exposure, … | Copied: Time, Printer lights, Paper, Grade, Filtration, Aperture. | Copy values — Each frame is on its own afterwards (as in Lightroom). Link — …", Cancel / Sync 1 frame.
  - P9-1: a click: tool still armed, 0 masks; a drag: tool off, 1 mask; a later drag on the picture: still 1 mask.
  - D5: rows "Main exposure, Printer lights, Contrast mask [Density mask], Burn, Dodge"; summary "Main exposure · Burn · Dodge · Printer lights · Density mask"; By kind `main, burn1, dodge1, lights, densityMask1`.
  - D8: after open, lights source alpha 0.75, prefs 75 %; the "First print" panel: Neutralise, the explanation, "First print again".
  - Page errors: none.

### What didn't work
- Browser suite, first run: `3 failed / 2 skipped / 159 passed (10.6m)`:
  - `e2e/studio.spec.ts:54 › a reload keeps the edit by hash…` — `expect(locator).toHaveAttribute(expected) failed` (aria-valuetext `Y 15 CC`, the spec expected `Y 3 CC`).
  - `arrangements.spec.ts:42 › darkroom: the Enlarger is the darkroom stack…` — expected by kind `['main', 'burn1', 'lights']`.
  - `studio-kit.spec.ts:36 › classic print: a run of key presses is one step…` — expected 14.142 s (three ⅙-stop presses).
- The first walk showed `Copied: time_s (Exposure), logH (Colour balance), paper (Paper), …` in the Sync dialog (the looks kit's clipboard words); fixed with `modelAt(path).label`.
- A `docmgr doc relate` loop failed for every file with `(eval):19: command not found: head`: I had named the loop variable `path`, which in zsh is tied to `PATH`. Renamed it.

### What I learned
- In zsh, `path` is the array form of `PATH`; never use it as a variable name in a script.

### What was tricky to build
- N/A beyond the above.

### What warrants a second pair of eyes
- The suite was not rerun in full after the three spec updates and the dialog wording; the affected specs were rerun (19 + 12 passed). The wording change touches only the dialog's text.
- No REAL_GPU (Metal) run here; D13's exit wants one on the merge.

### What should be done in the future
- A Metal run of the suite on the integration branch after the merge of CHB-045 and CHB-046.

### Code review instructions
- Screenshots: `various/walk/0*.png` (synthetic negatives only).
- Rerun: see the commands in "What I did".

### Technical details
- Walk: `node ttmp/…/CHB-046…/scripts/01-walk-changed-flows.mjs http://localhost:5585 <scenes> <shots>`.

## Step 11: Bookkeeping

Tasks checked in CHB-046; CHB-037 P9-1 (t:hqwh), P9-9 (t:crj2), P9-6 (t:eo25) and CHB-028 F44 (t:8nfh), F37 (t:czh4),
t:5wjl marked "— done in CHB-046 (5a9350c)" and checked; the handoff's first-print decision now says D8.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Close the loop in the tickets.

**Inferred user intent:** The backlog shows what is done.

**Commit (code):** N/A (docs commit after this step)

### What I did
- `docmgr task check --ticket CHB-046 --id …` for all ten tasks; edited the CHB-037 and CHB-028 task lines; `docmgr changelog update`.

### Why
- The coordinator merges from these records.

### What worked
- N/A.

### What didn't work
- N/A.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- CHB-028 t:czh4 (F37, 20 CC first filtration step) is closed with DARK-5's 5 CC keys and 10 CC per 40 px drag.

### What should be done in the future
- CHB-044's backlog rows MASK-1, DARK-2, DARK-3, DARK-5, NEW-1…3, SCAN-5 can be marked done when the coordinator merges.

### Code review instructions
- `git log --oneline task/chb-037-unified-model..task/chb-046-editing-blockers`.

### Technical details
- N/A.
