---
Title: Diary WS-D interface (session 03)
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
LastUpdated: 2026-11-12T19:33:34.286458194-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary WS-D: the interface (CHB-031 round 2, session 03 findings)

## Step 1: Read the brief, the findings and the code; plan the seven items

I read the common brief, the plan's round 2 section, the session 03 findings (F24–F37) with the tester's scripts
(`s04f`, `s05c`, `s06b`, `s11`) and screenshots, CHB-032's undo reference, and the code each finding points at. Each
of the seven items has a concrete cause in the code; the layout switch (F24) is the only one that needs a structural
change, the rest are local.

### Prompt Context
**User prompt (verbatim):** "You are implementing CHB-031 round 2, workstream **WS-D: the interface** (session 03 findings F24, F26, F32/F35, F33, F34 (part), F36, and leftover 8iv8).

Read first: the common brief /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/brief-common-v2.md (rules, checks, diary format, final reply; its "Additions" section matters; read "CHB-027" there as CHB-031). Your spec: `ttmp/2026/11/12/CHB-031--cosplay-session-02-findings-enlarger-real-mode-by-default-open-as-panels-strip-frames-leftovers/design-doc/01-plan.md`, section "Round 2", WS-D. The findings with repro: CHB-026 `various/02-findings.md` (section "Session 03", F24–F37) and `sessions/03-sonnet-rerun-session-02/` (experience report, diary, scripts — e.g. `s04f-simple-layout.mjs` for F24, `s05c`/`s06b` for F26, `s11-undo-frame-label.mjs` for F36 — and screenshots). Background: CHB-032's reference docs `ttmp/2026/11/12/CHB-032--…/reference/01-undo-and-history-across-the-layers.md` (undo, history) and `02-which-engine-computes-what.md`; the CHB-031 WS-A/WS-B diaries (`diary/02-…`, `03-…`) for the wording and open-flow changes.

Your specifics:
- You are in a fresh git worktree made from main. First: `git checkout -b task/chb-031-interface`; `pnpm install --offline` if node_modules is missing.
- Diary (exists, write in it): `ttmp/2026/11/12/CHB-031--…/diary/05-diary-ws-d-interface-session-03.md` — the diary skill's investigation format exactly (read /home/manuel/.claude/skills/diary/SKILL.md and references/investigation-entry.md); Step 1 quotes this prompt verbatim; every step has all sections; write as you go and commit with the code.
- Screenshots: `…/CHB-031--…/various/ws-d/` (synthetic fixtures only).
- Ports: preview 4811; browser tests STUDIO_PORT=5321 STUDIO_KIT_PORT=5322 SHELL_DEMO_PORT=5323 GPU_PARITY_PORT=5324.
- Tasks to check off when done (`docmgr task check --ticket CHB-031 --id …`): 6o2t (F24), 58p8 (F26), oc2f (F32/F35), oyf6 (F33), bjc2 (F34 part), kwlw (F36), 8iv8.

Priorities (user-visible first):
1. **F24:** switching View ▸ Layout keeps the open files and frames open (only the interface is rebuilt; the engine keeps its sources). E2e: open a file, switch layout, the frame is still open and renders without "select one to open its file again".
2. **F26:** "Where is …?" closes as answered when its frame becomes open another way (File ▸ Open, drag and drop). E2e with a synthetic file.
3. **F36:** Undo/Redo of a change on another frame selects that frame (so the photographer sees what changed).
4. **F32/F35:** History in words with consistent units ("+⅓ stop", "Rotated left", "Crop set"; no raw JSON or op ids), the tooltip typo "The picture no orange mask…", error codes (`E_EVAL`, `W_NO_*`) only in the "Technical:" line, the status words "refine"/"draft" in plain words.
5. **F33:** the History panel scrolls and its rows never overlap (check with 30+ entries).
6. **F34 (part):** View ▸ Actual Pixels (1:1) with a key, and a zoom readout. The CPU progress display is NOT yours (CHB-029 item 6).
7. **8iv8:** the darkroom layout with no frame shows one empty-state text and no empty Exposures panel.

Since CHB-032 merged: shell `store.ts`/`viewport.ts` are now entries over `core/store/` and `dom/viewport/` modules (the viewport parts are created in a fixed order: see the comment at the top of `packages/shell/src/dom/viewport.ts`); `RefEngine` requires `data`; e2e specs that open files use `opened()` from `e2e/support.ts`; specs write screenshots to `test-results/`, never into `ttmp/`.

Parallel work: WS-C (picture) edits `apps/studio/src/host/first-print.ts`, the `initial` hook in `apps/studio/src/main.ts`, strip orientation in `apps/studio/src/host/decode.ts`, the Simple layout's enlarger rows, the looks kit's density look and the DSL time strip. Keep your `main.ts` and `packages/studio-kit/src/cb.ts` edits local. The orchestrator merges WS-C first, then you; merge main before your final checks if WS-C has landed."

**Assistant interpretation:** Fix the seven interface findings of session 03 in my own worktree and branch, user-visible
ones first, with unit tests and e2e specs on synthetic files, screenshots under `various/ws-d/`, the diary in the
investigation format, and the plan tasks checked off; keep the shared files' edits small.

**Inferred user intent:** The photographer's next session (04) should not lose his open pictures when he tries
another layout, should not be blocked by a stale dialog, should see what Undo changed, and should read History,
tooltips and the status line in his own words.

**Commit (code):** none yet (branch `task/chb-031-interface` made from main `2755b03`).

### What I did
- `git checkout -b task/chb-031-interface`; `pnpm install --offline` (node_modules was missing; done in 1 s).
- Read the brief, plan, findings, tester scripts `lib.mjs`, `s04f`, `s05c`, `s06b`, `s11`, the experience report,
  CHB-032's `01-undo-and-history-across-the-layers.md`, and looked at `shots/09-yellow-40.png` (History rows
  squashed) and CHB-031 `various/ws-a/12-darkroom-no-frame.png`.
- Read the code behind each finding (below, under Technical details).

### Why
- The causes decide the size of each fix; F24 decides how much of `main.ts` moves, which matters for the merge with
  WS-C (it edits the `initial` hook in `startEngine`, outside `main()`).

### What worked
- Every finding has a located cause (Technical details).

### What didn't work
- My first attempt to append Step 1 with a shell heredoc was refused by the harness ("this command is too complex to
  verify that it stays inside the worktree"); I wrote the diary with the file tools instead.

### What I learned
- The layout switch is `location.href = …?variant=v` (`apps/studio/src/main.ts`, `hostActions.setLayout`): a page
  reload. The engine worker, its decoded sources and the EditLogs in memory are gone; only frames with a stored file
  handle can come back, and only after a permission click. Files opened through `<input type=file>` or a drop
  without a handle never can. So "keep the frames open" needs an in-place rebuild of the interface, not a reload.
- The pieces for an in-place rebuild exist: `mount()` returns `dispose()` (removes the DOM and disposes the runtime,
  which stops autosave and detaches the route adapters); `Studio.detach()`; `Frames.onAdded` replays the open frames
  to a new subscriber, so `EditLogRoute.attach` on a new store republishes every `recipes.<f>` and `Studio.attach`
  re-catalogues them. All variants call `cb.studio('Chromobench')`, so they share one save key (one library).
- F33 is CSS: `.cb-hist` is a flex column with `max-height: 260px; overflow-y: auto`, its rows have
  `overflow: hidden` (so their flex min-height is 0) and the default `flex-shrink: 1`: past the max height the rows
  shrink instead of the list scrolling, and their text overlaps.
- F36: `History` emits `'undo'` / `'redo'` with the entry, whose `channel` is the frame id; `Runtime.undo` shows the
  toast after `history.undo()` returns, naming the channel with "(on …)" when it is not the current frame.
- F34: the shell already has `view.actual` ("100% (1:1)", Mod+Alt+0); classic's explicit View menu does not list it.
- F35 typo: ingest's `guessOpenMode` returns noun phrases ("no orange mask and no film edge"); `main.ts` prefixes
  "The picture " to them (twice: the hint pill's tooltip and the "Photo or negative?" dialog).

### What was tricky to build
- Nothing built yet. The tricky part ahead is the order of the layout switch: end the open burst, save the old
  runtime's state, dispose it, detach the studio, mount the new variant, and re-attach every per-runtime listener
  that `main()` registered (status line, mode pill, Open As pill, relink watcher, theme mirror, chat, hook).

### What warrants a second pair of eyes
- N/A for this step.

### What should be done in the future
- N/A for this step.

### Code review instructions
- N/A (no code yet).

### Technical details
- F24: `apps/studio/src/main.ts` `hostActions.setLayout` reloads the page. Per-runtime registrations in `main()`:
  `mirrorTheme(rt)`, `chat.attach(rt)`, `rt.renders.*` settings, `rt.on('rendered'|'renderError')`, three
  `rt.store.on` listeners (notes/mode/approvals, Open As pill, relink-on-select), the saved thumbnails into the
  catalog, `hook()` (`window.chromobench`), the selection clean-up and the "ready" status. Once-only: the engine,
  KV, studio, chat, presenter, bridge, file inputs, drop listeners, `studio.frames.onAdded` (thumbnails), the
  Open As reset at a restart.
- F26: `relink()` awaits `rt.chrome.dialog(…).result`; `DialogHandle` has `close()`.
- F32: `packages/studio-kit/src/model/history.ts` `describe()`: the stops aside uses `formatStops` with a 1e-3
  tolerance, so printer-rounded times (7.94 → 10 s, log2 = 0.3328) print "+0.33 st" while 10 → 12.6 s prints
  "+1/3 st"; `view.frame.orientation` has an enum model ("Orientation transpose → flipH"); `view.frame.crop` (a box,
  no model) falls to `${m.path} ${json} → ${json}`; the panel shows the change texts, not the unit labels.
- F33: `packages/studio-kit/src/dom/studio-kit.css` `.cb-hist`, `.cb-hist-i`.
- F35 status words: `rt.on('rendered')` writes `rendered N · ${e.pass}` with the shell's pass names
  `draft | screen | refine`.
- 8iv8: `packages/studio-kit/variants/darkroom.js`: Enlarger and Paper each wrap `cb.ifFrame` (two "Select a photo to
  print it."), plus Exposures, Agent proposals and History panels that are empty without a frame.

## Step 2: Implement all seven items; check them in the built app and in a new e2e spec

I implemented the seven items in one pass, then built the studio, served it on 4811 and drove it with a script that
uses the menus, the Time box, the cells and the keys (`scripts/wsd-01-interface.mjs`, 13 screenshots in
`various/ws-d/`), and wrote `e2e/studio-interface.spec.ts` (5 tests). Everything passes: typecheck, lint, 2784 unit
tests, the 5 new browser tests and the script's 30 checks.

The layout switch is now an in-place rebuild: the old runtime saves and is disposed, the studio (engine, frames,
EditLogs) is attached to the new runtime, every listener `main()` had put on a runtime is registered again, and the
new runtime takes over the old one's undo history, so Ctrl+Z after three layout switches still undoes the step made
before them. Two things came up on the way: a 500 ms right-click guard in the relink watcher that ate early left
clicks (pre-existing, made F26's check flaky), and the zoom readout's text colour lost to `.ck-app button`.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Implement F24, F26, F36, F32/F35, F33, F34 (part), 8iv8; prove each in the browser.
**Inferred user intent:** Session 04 finds none of these again.
**Commit (code):** see the commit that adds this step ("CHB-031 WS-D: layout switch in place, Where is … answered,
Undo shows its frame, History in words, Actual Pixels and zoom readout, darkroom empty state").

### What I did
- **F24** (`apps/studio/src/main.ts`): `def`, `built`, `mounted`, `rt` are `let`; everything wired to a runtime goes
  through `eachMount(f)` (runs now, kept in `perMount`): theme mirror, chat, render settings, display space, the
  `rendered`/`renderError` status, the store listener for notes/mode/approvals (now the function `onStore`), the
  Open As pill, the relink-on-select watcher, `hook()`. `hostActions.setLayout` calls `switchLayout(v)` after the
  command returns (`setTimeout 0`): build the variant (errors → a toast, nothing changes), close an open "Where
  is …?", `route.endBurst()`, `studio.flush()`, `rt.save()`, keep `rt.history`, `mounted.dispose()`,
  `studio.detach()`, `studio.setEnlarger(def.enlarger)`, update `hostActions.layout/layouts`, `mountStudio`,
  `rt.history.adopt(past)`, rerun `perMount`, the saved thumbnails, drop an offline selection,
  `history.replaceState` with `?variant=`, `body[data-variant]`, status "layout: Three steps · 2 frames open".
- `Studio.setEnlarger(mode)` (`packages/studio-kit/src/studio.ts`): new frames take the new layout's enlarger mode.
- `History.adopt(from)` (`packages/shell/src/core/history.ts`): takes entries, redo stack, channels and the id
  counter. `DomChrome` (`packages/shell/src/dom/chrome.ts`) removes its tooltip listeners from the root at dispose
  (an `AbortController`), since the new app mounts on the same `#app`.
- **F26** (`main.ts` `relink`): the dialog handle is kept; `studio.frames.onAdded` closes it when its frame opens;
  after the dialog, an open frame means "answered" (no "not open" status). `asking` remembers the frame asked for,
  and `openFiles` selects it instead of the file's first frame (raw010 frame 2/3 asked → frame 2 shown). The same for
  the stored-handle path and Locate. `rightAt` starts at `-Infinity` (see What didn't work).
- **F36** (`Studio.attach`): on History `'undo'`/`'redo'` with a channel that is an open frame other than the current
  one, select it in a microtask, after `Runtime.undo` has shown its toast ("Undo Time (on roll-a-07.tif)").
- **F32** (`packages/studio-kit/src/model/history.ts`, `units.ts`): `stopWords()` ("+⅓ stop", "−1 stop",
  "+1⅔ stops", "+0.6 stop"; a change within 0.02 stop of a sixth/quarter/third/half is that fraction);
  `fstopMarkStops()` counts the lens's third-stop marks (f/8 → f/11 is −1 stop, not −0.92); `describe()`: time and
  aperture with "(±… stop)", vec3/cmy by changed component ("Filtration Y 0 → +20 CC", "Printer lights R 0 → +2,
  B 0 → −2 pt", "Printer lights −4 pt (all three)"), `orientationWords()` ("Rotated right/left", "Rotated 180°",
  "Flipped left to right", "Rotated and flipped"), crop "Crop set/changed/removed", other paths by `pathName()`
  with plain values only, probes "placed/moved/removed", exposures by kind ("Added a dodge (−⅓ stop)"), masks
  "drawn/changed"; History rows carry the full text as a tooltip; a rejected proposal reads "Agent · rejected: <the
  change>" instead of its tx id and seq.
- **F35** (`apps/studio/src/status-text.ts`, `main.ts`): `guessWhy()` ("The picture shows no orange mask and no film
  edge."; "too dark" → "is"), used by the hint pill and the "Photo or negative?" dialog; `passWords()` ("quick
  preview", "done", "done, full detail") with the pass name in the status tooltip as "Technical: refine pass";
  `plainError()` strips `E_*`, `W_*` and `XX-A123` codes from every error that reaches the plain status line (engine
  start, render error, open failure, picker error, export failure); their tooltips start with "Technical:".
- **F33** (`studio-kit.css`): `.cb-hist-i { flex: none }`, `.cb-hist { position: relative }`; the panel scrolls the
  cursor row into view after each redraw (the list is rebuilt on every change and used to jump to the top).
- **F34**: `view.actual` is "Actual Pixels (1:1)" (`packages/shell/src/app/builtins.ts`, Mod+Alt+0 as before) and in
  classic's View menu (`variants/classic.js`); a zoom readout button in every non-small viewport
  (`dom/viewport.ts` creates it, `ViewportParts.zoom`, `geometry.ts` `showZoom()` from `transform()`; "Fit · 23 %",
  "100 %"; a click toggles Fit and 1:1; `zoomReadout: false` turns it off).
- **8iv8** (`variants/darkroom.js`): History, Paper, Exposures and Agent proposals panels are `.hidden(s => no open
  frame)`; the Enlarger panel's one empty text says "Select a photo to print it." with photos in the library and
  "No photos yet: File ▸ Open Files… (Ctrl+O), or drop them here." without.
- Tests: `packages/studio-kit/test/history-words.test.ts` (11), F36 in `bridge.test.ts`, `History.adopt` in
  `packages/shell/test/core/core.test.ts`, the readout in `packages/shell/test/dom/mount.test.ts`, `guessWhy`,
  `passWords`, `plainError` in `apps/studio/test/status-text.test.ts`; updated the History texts pinned in
  `model.test.ts`, `bridge.test.ts`, `test/browser/looks.spec.ts`, `test/browser/studio-kit.spec.ts`; the darkroom
  snapshot (`vitest -u` on `variants.test.ts` only: 5 lines, the four `hidden τ` and the text).

### Why
- In-place rebuild rather than reload: a reload can bring back only files with a stored handle, after a permission
  click. Adopting the History keeps "only the interface is rebuilt" true for Ctrl+Z as well.
- Selecting the undone frame after the toast keeps the "(on …)" in the toast, so he reads which frame changed and
  sees it.
- `stopWords` is new rather than a change to `formatStops`: the panels' asides ("+1/3 st") and the typed syntax
  ("+1/3 st") stay as they are; History is a sentence for reading.

### What worked
- `node scripts/wsd-01-interface.mjs` on the build (preview 4811): "all checks passed" (30 checks), e.g.
  "Ctrl+Z after three switches undoes Time 12.6 s (back to 7.937 s)", "a frame opened in Simple prints normalised",
  "after Ctrl+Z: A is shown (toast "Undo Time (on roll-a-07.tif)")", "34 rows … every row keeps its height
  (22.2–22.2 px)", "the list scrolls and shows the newest step (scrollTop 494, 260/754)", "Ctrl+Alt+0: "100 %"",
  "panels shown: enlarger".
- `STUDIO_PORT=5321 … CI=1 npx playwright test e2e/studio-interface.spec.ts --project chromium-webgpu`: 5 passed
  (32 s).
- `pnpm typecheck` clean; `pnpm lint` "import boundaries ok (406 file checks)", "check-colours: … no literal
  colours"; `pnpm test` 102 files, 2784 passed, 7 skipped.

### What didn't work
- My first F24 run clicked `.ck-dialog button` "Three steps": the Layout dialog names only the current layout by its
  label; the others are their capitalised ids ("Simple"). Fixed in the script and spec (button by id).
- My 28 quick "Lighter" clicks made one History row: `EditLogRoute.step` bursts within 800 ms are one unit, as
  designed. The check uses aperture clicks 900 ms apart (script) and 30 `chromobench.set` transactions (spec).
- F26's check failed 2 runs in 4: the cell click selected the frame but no dialog came. Instrumented the selection
  watcher: `DBG sel frame_695011ff frame_695011ff true true 432.09` — `performance.now() - rightAt` was 432 ms. The
  watcher ignores a selection within 500 ms of a right-click, and `rightAt` started at 0 while `performance.now()`
  restarts at 0 with every page load: a left click in the first half second after a reload counted as a right-click.
  Fixed with `rightAt = -Infinity`; 3 + 3 runs pass since. (Pre-existing; a fast tester can hit it.)
- The zoom readout drew dark text on the dark HUD colour (`02-…png` of the first run): `.ck-app button { color:
  inherit }` (0,1,1) beat `.ck-vp-zoom` (0,1,0). The rule is now `.ck-vp .ck-vp-zoom`.
- A shell heredoc that wrote outside the worktree (a debug script in the scratchpad) was refused by the harness;
  I wrote the debug script into the worktree as `dbg-f26.tmp.mjs` and deleted it after.

### What I learned
- The shell's History is per runtime, but its parts close over EditLogs and its patches are plain paths, so a new
  runtime on the same document can take them over unchanged.
- The orientation tokens are compositions: `transpose` then Rotate Right is `flipH` (my first test expectation had
  left and right swapped; `composeOrientation` decides, and matches the tester's "Rotate Right → transpose → flipH").
- Nominal f-numbers are rounded: f/11 is 2^3.5 = 11.31, so 8 → 11 is 0.92 stop by ratio; History counts marks.

### What was tricky to build
- The order in `switchLayout`: the burst must commit into the old store before it is disposed (`endBurst`), the old
  runtime must save before the new one boots (the new runtime restores the library, selection and workspace from
  the KV), and the History must be taken before `dispose()` drops the runtime. The command that asked for the
  switch (the Layout dialog) runs inside the old runtime, so the switch waits for it to return (`setTimeout 0`).
- F36's selection must follow the toast: `History.undo` emits `'undo'` before `Runtime.undo` builds the toast's
  "(on …)" from the current frame; selecting in the event would drop the frame's name from the toast. A microtask
  runs after the toast.
- F26: `openFiles` selects the file's first frame after `studio.openFile` returns, while the dialog closes from
  `onAdded` during it; the frame asked for is kept in `asking` (cleared on "Not now"/"Remove", or when used), not in
  the dialog's lifetime.

### What warrants a second pair of eyes
- `switchLayout` across kits with their own state (roll, looks, finish): I checked Classic, Simple, Darkroom; Lab,
  Tiny, Roll, Finish and Looks were not driven after a switch.
- `History.adopt` moves store patches recorded under another variant's state shape; a patch for a path the new
  variant does not have is written anyway (harmless, but new state).
- The readout appears on every non-small viewport of every shell app (the shell demo too).

### What should be done in the future
- Session 04 should switch layouts with a real file handle (Locate) and with the GPU engine.

### Code review instructions
- Start at `apps/studio/src/main.ts` `switchLayout` and `eachMount`, then `relink` and `openFiles` (`asking`);
  `packages/studio-kit/src/studio.ts` `showChanged`, `setEnlarger`; `packages/shell/src/core/history.ts` `adopt`;
  `packages/studio-kit/src/model/history.ts` `describe`; `packages/shell/src/dom/viewport/geometry.ts` `showZoom`.
- Validate: `pnpm typecheck && pnpm lint && pnpm test`;
  `STUDIO_PORT=5321 STUDIO_KIT_PORT=5322 SHELL_DEMO_PORT=5323 GPU_PARITY_PORT=5324 CI=1 npx playwright test e2e/studio-interface.spec.ts --project chromium-webgpu`;
  the script on a build served at 4811.

### Technical details
- History rows seen in the built app: "You Time 7.94 → 12.6 s (+⅔ stop)", "You Time 12.6 → 10.0 s (−⅓ stop)",
  "You Rotated right", "You Aperture f/8 → f/9 (−⅓ stop)", "You Time 7.94 → 14.0 s (+⅚ stop)".
- Status line after a render: "rendered 2 · done, full detail" (tooltip "Technical: refine pass").
- Screenshots: `various/ws-d/01…04` (F24), `05…06` (F26), `07` (F36), `08…09` (F33/F32), `10…11` (F34),
  `12…13` (8iv8).
