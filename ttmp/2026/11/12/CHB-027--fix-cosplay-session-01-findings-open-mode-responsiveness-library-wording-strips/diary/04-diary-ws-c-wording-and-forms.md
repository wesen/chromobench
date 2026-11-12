---
Title: Diary WS-C wording and forms
Ticket: CHB-027
Status: active
Topics:
    - ui
    - product
    - ingest
    - performance
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /home/manuel/code/wesen/chromobench/packages/studio-kit/src/kit/messages.ts
      Note: explainError, typed-value hints, clamp and relative-entry texts, darkroom tooltips (F7 F8 F9)
    - Path: /home/manuel/code/wesen/chromobench/packages/studio-kit/src/model/names.ts
      Note: stock and list ids as names (F9)
    - Path: /home/manuel/code/wesen/chromobench/packages/studio-kit/src/dom/arg.ts
      Note: typed fields clamp, explain and reset; slider range widens; drags land on printer seconds (F8 F13)
    - Path: /home/manuel/code/wesen/chromobench/packages/shell/src/app/runtime.ts
      Note: Runtime.explainError hook and toastError (F7)
    - Path: /home/manuel/code/wesen/chromobench/packages/shell/src/app/builtins.ts
      Note: Edit > Undo/Redo name the frame (F12)
    - Path: /home/manuel/code/wesen/chromobench/packages/shell/src/core/keys.ts
      Note: letter chords follow the keyboard layout (found while chasing F14)
    - Path: /home/manuel/code/wesen/chromobench/apps/studio/src/status-text.ts
      Note: engine and decode-notes summaries for the status line (F9)
    - Path: /home/manuel/code/wesen/chromobench/e2e/studio-wording.spec.ts
      Note: browser spec for the WS-C behaviour
ExternalSources: []
Summary: "WS-C of CHB-027: the studio's errors, typed values, names, status line, undo labels and slider values in the photographer's words; F14 investigated."
LastUpdated: 2026-11-12T14:40:00-05:00
WhatFor: "How WS-C was built and checked, what was not done, and why."
WhenToUse: "Reviewing or merging task/chb-027-wording; continuing F14."
---

# Diary: WS-C wording, forms, messages

## Step 1: Brief, plan and code reading

I read the common brief, the plan's WS-C section and findings F7–F16, then the code each finding points at: the
typed-value grammar (`parseEntry` in `packages/studio-kit/src/kit/args.ts`), the control renderer
(`packages/studio-kit/src/dom/arg.ts`), the shell's refusal toast (`Runtime.refused` in
`packages/shell/src/app/runtime.ts`), the built-in undo labels (`packages/shell/src/app/builtins.ts`), the status
line in `apps/studio/src/main.ts` and the decode notes in `apps/studio/src/host/engines.ts`. The main design
choice: the shell stays generic and gets one hook (`Runtime.explainError`), studio-kit fills it, and the contract's
error objects stay as they are for the DSL and agents.

### Prompt Context
**User prompt (verbatim):** "You are implementing CHB-027 workstream **WS-C: wording, forms, messages** (findings F7, F8, F9, F11 chrome bits, F12, F13, F14).

First read the common brief: /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/chb027-brief-common.md — it has the rules, checks, diary and final-reply format. Then the plan's \"WS-C\" section (path in the brief) and the findings F7–F14 in the CHB-026 findings file.

Your specifics:
- Branch: `task/chb-027-wording` (create it in your worktree first; run `pnpm install --offline` if node_modules is missing).
- Diary file: `ttmp/2026/11/12/CHB-027--fix-cosplay-session-01-findings-open-mode-responsiveness-library-wording-strips/diary/04-diary-ws-c-wording-and-forms.md`
- Screenshots folder: `…/CHB-027--…/various/ws-c/`
- Ports: preview 4911; browser tests STUDIO_PORT=4921 STUDIO_KIT_PORT=4922 SHELL_DEMO_PORT=4923 GPU_PARITY_PORT=4924.
- Plan task id: ik6l.

The user is a photographer with darkroom experience, likely working in German (types \"7,5\"), not a programmer. Concretely: errors like `E_ARG_RANGE: print.enlarger.time_s = 0 is outside the allowed range [0.1, 600] (s).` become \"Time must be between 0.1 s and 600 s\" (keep the code reachable for developers/agents, e.g. toast title or tooltip; the DSL/agent-facing error objects must stay unchanged — only what the UI shows changes); typed values out of range are clamped with a toast; typed-value fields explain themselves and a relative entry (\"-5\") toasts its effect; a bad entry never leaves stale red state on another frame; the status-line engine label and decode notes get a short human summary with the technical text in a tooltip; stock/paper ids shown as proper names everywhere in the UI (the Paper row shows the raw id `kodak_portra_endura` above the select); Edit ▸ Undo/Redo name the frame when it is not the current one; drags land on sensible values (not 20.16 s); the Time slider range covers the auto first print (2.23 s currently sits at the 2 s floor); find and fix why a \"Commands\" dialog showed up in the UI log without being asked for (F14 — likely a key typed in a text field reaching a global shortcut).

Note the shared files: `apps/studio/src/main.ts` belongs to WS-A (open flow, menus, top bar) — keep your main.ts edits small and local (status-line label, empty-state text only if trivial) and put wording functions in their own module (studio-kit for UI text shared by kits; the host for host-only text). `apps/studio/src/host/engines.ts` belongs to WS-A/WS-B: don't restructure it; if decode notes need a human summary, produce it from the existing note strings/diagnostic codes in a separate module. Don't fold the host top bar into the shell (an open user decision)."
**Assistant interpretation:** Make every place where session 01 met developer text speak darkroom language, keep the
technical text one hover away, and find the source of the unexplained "Commands" dialog.
**Inferred user intent:** Manfred should be able to work without outside help; agents and developers keep their codes.

### What I did
- `git checkout -b task/chb-027-wording`; `pnpm install --offline` (node_modules was missing; done in 958 ms).
- Read `chb027-brief-common.md`, `design-doc/01-implementation-plan.md` (WS-C and the ownership table),
  CHB-026 `various/02-findings.md` F7–F16 and `diary/01-diary.md` steps 1–5.
- Read the code listed above, plus `packages/contract/src/spec.ts` (`checkArgValue`, the `E_ARG_RANGE` text),
  `packages/contract/src/errors.ts` (`ChromobenchError.diag`), `packages/shell/src/core/keys.ts` (the router),
  `packages/shell/src/dom/chrome.ts` (toasts, menus, the palette).

### Why
- The shell is CraftKit's port and knows nothing about chromobench; a hook keeps it generic.

### What worked
- Every finding has one clear owner in code: refusal toasts in `Runtime.refused`, typed values in `arg.ts`
  `track()`, select labels in `arg.ts` (`v.replace(/_/g, ' ')`), the readout above the select in the `m.cell` of
  `renderArg`, the undo label in `builtins.ts`, the slider scale in `scaleOf`.

### What didn't work
- No failures in this step.

### What I learned
- The paper id above the select is `model.format(v)` (`String(v)` for strings), and the select itself showed the id
  with underscores as spaces. The data packs carry no display names (`stocks/*.json` has only `id`, `kind`,
  `role`), so names have to be made in studio-kit.
- `Runtime` already has an `explain()` (the app's self-description); my hook is named `explainError`.

### What was tricky to build
- N/A (reading).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Start from the plan's WS-C section.

### Technical details
- The refusal path: `EditLogRoute.apply` → `applyMutation` → `checkSet` → `checkArgValue` throws
  `ChromobenchError({ code: 'E_ARG_RANGE', path: 'print.enlarger.time_s', valid: ['[0.1, 600]'] })` →
  `TxRefused` → `Runtime.refused` → toast `cause.message`.

## Step 2: F14, the "Commands" dialog: replay and a key sweep

I built the studio (`pnpm --filter @chromobench/studio build`), served it with
`pnpm --filter @chromobench/studio preview --port 4911 --strictPort`, and replayed session 01's step 3 actions
one by one, reading the shell's UI log after each (`scripts/wsc-01-f14-repro.mjs`). No action opened the palette.
Then a sweep (`scripts/wsc-02-f14-key-sweep.mjs`) pressed every letter, digit and punctuation key and the F-keys,
alone and with Ctrl, Shift, Alt, Ctrl+Shift and Ctrl+Alt, with the focus in the Time box, on the Time slider, in the
Paper select and on the page. Only Ctrl+K (and Ctrl+/ and Ctrl+? for the shortcut sheet) opens a dialog, from the
page or from a focused slider; the Time box swallows every key. So the hypothesis "a key typed in a field reached a
global shortcut" is refuted for the fields he used; the "Commands" entry needs Ctrl+K or Help ▸ Find a Command….

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Reproduce F14 before fixing anything.
**Inferred user intent:** No dialogs that he did not ask for.

### What I did
- `node scripts/wsc-01-f14-repro.mjs 4911`: open the M1 fixture, `fill`+Enter of `15 0 -5 abc 1000 12s 7,5 ''`,
  Ctrl+A then typing, Ctrl+Z, a synthetic Ctrl+Z from a German layout, Ctrl+K in the field, Escape.
- `node scripts/wsc-02-f14-key-sweep.mjs 4911` (reloads the page whenever a key moved the focus target away).
- Read `KeyRouter.dispatch` and `chordFromEvent`.

### Why
- The session's UI log showed "Commands" before any menu entry (`{kind:'menu'}` is logged when a menu opens), so a
  menu click is unlikely; a key is the remaining path.

### What worked
- Replay output (before my changes): `fill "0": ["toast:E_ARG_RANGE: print.enlarger.time_s = 0 is outside the
  allowed range [0.1, 600] (s)."]`, `Ctrl+Z: ["toast:Undo Time"]`, `Ctrl+K in the field: []`,
  `Ctrl+Z on a German layout (KeyY): []`.
- Sweep, before and after my changes (same result):
  `timeField: no dialogs`, `timeSlider: Control+k → Commands | Control+/ → Keyboard Shortcuts | Control+? → Keyboard Shortcuts`,
  `paperSelect: no dialogs`, `body: Control+k → Commands | Control+/ → … | Control+? → …`.

### What didn't work
- First sweep run: `timeField: (no focus target)` for every modifier, because the page sweep ran first and its
  single letters switched modules. Fixed by sweeping the page last and reloading on a lost focus target.
- `import { chromium } from 'playwright'` → `ERR_MODULE_NOT_FOUND`; the workspace has `@playwright/test`.

### What I learned
- The real keyboard bug the sweep surfaced: chords are built from the **physical** key (`e.code`). On a German
  QWERTZ keyboard the key labelled Z is `KeyY`, so Ctrl+Z gave `mod+y` (nothing) and Ctrl+Y gave undo. For a German
  photographer, Ctrl+Z did not undo. Fixed in Step 3.

### What was tricky to build
- Telling "no dialog" from "the focus target disappeared": a press that switches module removes the Time box; the
  sweep now re-opens the page and counts the reloads.

### What warrants a second pair of eyes
- F14 is not reproduced. The likeliest cause is a Ctrl+K sent by the MCP-driven session itself (e.g. while the
  slider kept the focus after the drag); I found no path that opens the palette without Ctrl+K or the menu.

### What should be done in the future
- In the next cosplay session, log `window.chromobench.rt.chrome.log` after every step, so a stray dialog can be
  tied to an action.

### Code review instructions
- `scripts/wsc-01-f14-repro.mjs`, `scripts/wsc-02-f14-key-sweep.mjs` (both need a served build on the given port).

### Technical details
- Palette triggers: `BUILTIN_KEYS` binds `Mod+K` to `app.palette` (`packages/shell/src/app/assemble.ts`); the
  only other caller is the `app.palette` menu item. `KeyRouter.dispatch` lets `mod+` chords through in text scope;
  the Time box stops propagation of every key itself.

## Step 3: Implementation

One commit implements all of WS-C. The shell gets the hook, a detail on toasts, frame names in Edit ▸ Undo/Redo,
layout-aware letter chords and the name once in its header. Studio-kit gets `kit/messages.ts` and
`model/names.ts`, and the control renderer uses them. The host gets `status-text.ts` and two small edits in
`main.ts`.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Implement F7, F8, F9, F11 (name once), F12, F13 and the keyboard fix from F14.
**Inferred user intent:** see Step 1.
**Commit (code):** a3e1b25 — "CHB-027 WS-C: errors, typed values, names and status line in the photographer's words"

### What I did
- **F7.** `Runtime.explainError` (shell) and `toastError`: refused transactions and failing handlers toast the
  kit's text, with the original `CODE: message` as the toast's `detail` (the toast element's `title` and
  `data-detail`, and in `chrome.log`); error toasts stay 5 s. Diagnostics (`CK-T430` facts) are unchanged.
  `Studio.attach` installs studio-kit's `explainError`: `E_ARG_RANGE` on a recipe path → "Time must be between
  0.1 s and 600 s" (label and units from the control model, per component, f-numbers as f/…), `E_ARG_TYPE`,
  `E_STALE`, `E_PATH`, `E_FORMAT`, GPU errors and a generic sentence for other `E_` codes. The status line's render
  errors and stale refusals use it too (`main.ts`, technical text in the status tooltip).
- **F8.** In `arg.ts`, a typed entry is parsed, then held to the hard range (`clampEntry`) with a toast ("Time can
  be at most 600 s: set to 600 s"); a relative entry toasts its effect ("Time −5 s → 10.0 s"); a bad entry toasts
  why and what to type and stays red only while the box has the focus. Blur, Escape and a frame switch reset the
  box and its red mark (the cell detects the frame change and calls `set(v, force)`). The box has a tooltip and
  placeholder (`entryHint`, `entryPlaceholder`). `parseEntry` reads a decimal comma anywhere (`-2,5` too).
- **F9.** `model/names.ts`: `stockName` (rule plus a table: "Kodak Portra Endura", "Fujifilm C200", "Kodak Vision3
  250D", "Fujifilm Crystal Archive Type II") and `valueName` for illuminants, lamps and scanners.
  `ControlModel.valueLabel` and `valuesFrom`; `format` and `valueText` use names, the select options too, and the
  readout above a select is empty (the select shows the value). History rows read "Paper Kodak Portra Endura →
  Kodak Supra Endura" (`describe` no longer merges a shared last word of names as if it were a unit). The roll
  setup panel and the roll label use names. Darkroom tooltips for the control labels (`controlTip`).
  `apps/studio/src/status-text.ts`: "Fast (graphics card)" / "Compatibility mode: slower (no WebGPU)" and "Nikon D750
  photo, 24 MP" / "Colour negative (DNG), 6.2 MP, film edge found" (plus "it may be a photo, not a negative" when
  edge, gate and surround are all missing); the full text in the tooltip, the engine label also in
  `#engine[data-engine]`.
- **F11.** The shell's menu-bar title (the app name) shows only while the module plate is hidden.
- **F12.** `edit.undo` / `edit.redo` labels append `whereOf(entry)`: "Undo Time (on DSC_8559.NEF)".
- **F13.** `printerSeconds` (whole seconds from 10 s, tenths from 1 s, hundredths below) for slider drags;
  `trackRange` widens the slider to take in the value (0.5 stop margin, on the ⅙-stop grid, inside the hard
  range) whenever it is set outside a drag.
- **Keys.** `chordFromEvent` uses `e.key` for Latin letters, `e.code` otherwise.
- Tests: `packages/studio-kit/test/messages.test.ts` (12), `apps/studio/test/status-text.test.ts` (5), a layout
  test in `packages/shell/test/core/keys.test.ts`, `e2e/studio-wording.spec.ts`; e2e expectations on `#engine`,
  `#notes` and the stale status moved to `data-engine` and `title`.

### Why
- Clamping in the field (not in the route) keeps agents' and the DSL's refusals exact; only typing is forgiving.
- Arrow keys and typed `+1/3 st` keep exact stops (12.599 s, tested in `studio-kit.spec.ts`); only the slider
  rounds, because a drag sets an absolute position and rounding never accumulates there.
- I left the looks kit's diff text (`describeChange`) with ids: it is returned to agents through the DSL
  (`packages/dsl/src/host.ts:693`, `diff: res.diff.map((d) => d.shown)`).

### What worked
- `pnpm typecheck`, `pnpm lint` (`import boundaries ok (333 file checks)`), `pnpm test`:
  `Test Files 89 passed (89)`, `Tests 2661 passed | 7 skipped (2668)`.
- `CI=1 … npx playwright test e2e/studio-wording.spec.ts --project=chromium-webgpu`: `1 passed (10.5s)`.
- `scripts/wsc-03-check.mjs` on the build (shots in `various/ws-c/`): `type "0"` → `Time can't go below 0.1 s: set
  to 0.1 s`; `"1000"` → `Time can be at most 600 s: set to 600 s`; `"-5"` → `Time −5 → 595.0 s` (before the unit
  was added); `"abc"` → hint toast, red; after the frame switch `box "7.07 s", red false`; drag → `time 14 s`;
  Edit menu `"Undo Time (on neg-b.tif)"`; status `Compatibility mode: slower (no WebGPU)` and `Colour negative
  (TIFF), 96×64 px, film edge found`.
- Locally on the private files (screens kept in the scratchpad, not committed): `DSC_8515.NEF | notes: Nikon D750
  photo, 24 MP`; `raw010.dng | notes: Colour negative (DNG), 6.2 MP, film edge found | time 2.227 | range 1.41 …
  60.0 s, thumb at 2.24 s` (was the 2 s floor).

### What didn't work
- `pnpm typecheck` after adding the hook: `packages/shell/src/app/runtime.ts(158,3): error TS2300: Duplicate
  identifier 'explain'.` (the runtime's existing `explain()`); renamed the hook to `explainError`.
- First messages test run: `expected 'Time must be between 0.1 s and 600.0 s' to be 'Time must be between 0.1 s
  and 600 s'` (`formatSeconds` keeps one decimal); limits now use `limitText`.
- The first check run clicked `.ck-thumb` nth(1), the navigator's thumbnail, not the filmstrip's, so "frame
  switch" stayed on one frame; the script now clicks `.ck-side-bottom .ck-thumb`.
- A shell command with a heredoc was refused by the worktree guard ("too complex to verify"); I wrote the files with
  the editor instead.

### What I learned
- `RecordingChrome` (headless) and the DOM chrome both log toasts; adding `detail` to both keeps the headless
  tests able to see the code.

### What was tricky to build
- Frame switch with the focus still in the box: clicking a thumbnail need not blur the field, and `set()` skipped
  the box while it had the focus, so the red mark and the bad text stayed. The cell now compares the frame id
  before and after and forces the reset; frames with no value call `reset()`.
- The slider's `step` snaps to `min + k·step`; widening the range off the ⅙-stop grid would shift every thumb
  position, so `trackRange` widens on the grid.

### What warrants a second pair of eyes
- `chordFromEvent` change is global: any app on the shell now gets layout-aware letters. Positional shortcuts
  (none today) would want `e.code`.
- `explainError` guesses a path from the message when `diag.path` is missing; check it never names the wrong
  control.

### What should be done in the future
- WS-A's top bar: the host brand ("Chromobench Classic") is the remaining duplicate name, and the host Undo/Redo
  buttons' tooltips could name the frame too; open-file errors in `openFiles` could use `explainError`.
- The looks panel shows stock ids in diffs (kept for the agents); a UI-only name there would need a second field.

### Code review instructions
- `packages/studio-kit/src/kit/messages.ts`, `packages/studio-kit/src/dom/arg.ts` (`track()`, the `m.cell`),
  `packages/shell/src/app/runtime.ts` (`toastError`, `refused`), `packages/shell/src/app/builtins.ts`.
- `pnpm test -- packages/studio-kit/test/messages.test.ts apps/studio/test/status-text.test.ts`;
  `npx playwright test e2e/studio-wording.spec.ts`.

### Technical details
- Toast shape: `{ text: 'Time must be between 0.1 s and 600 s', kind: 'error', detail: 'E_ARG_RANGE:
  print.enlarger.time_s = 0 is outside the allowed range [0.1, 600] (s).' }`.
- Slider for the auto first print of raw010 (2.227 s): `min` 0.5 (1.41 s), `max` log2 60.

## Step 4: Full browser suite, task checked off

The full browser suite passes with this workstream's ports, including the new wording spec and the e2e specs whose
expectations moved to `data-engine` and `title`. I checked off the plan task and stopped the preview server.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Validation gate before the final commit.
**Inferred user intent:** A branch the orchestrator can merge without surprises.

### What I did
- `STUDIO_PORT=4921 STUDIO_KIT_PORT=4922 SHELL_DEMO_PORT=4923 GPU_PARITY_PORT=4924 CI=1 pnpm test:browser`.
- `docmgr task check --ticket CHB-027 --id ik6l`.

### Why
- The brief requires the browser suite before the final commit.

### What worked
- `88 passed (2.9m)`, no failures, no flaky tests.

### What didn't work
- No failures in this step.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Merge order A, C, B: `main.ts` conflicts will be in the status line (`engineEl`, `notesEl`, `status()`), and
  `e2e/studio-*.spec.ts` expectations on `#engine` / `#notes` must keep reading `data-engine` / `title`.

### What should be done in the future
- See Step 3. F14 stays open as "not reproduced"; the next cosplay session logs the UI log after every step.

### Code review instructions
- Rerun the command above.

### Technical details
- Findings: F7 fixed; F8 fixed; F9 fixed (status line, notes, tooltips, names; looks diffs keep ids for agents);
  F11 partly (shell name once; host brand and empty state belong to WS-A); F12 fixed; F13 fixed; F14 not
  reproduced, a German-layout Ctrl+Z bug fixed on the way.
