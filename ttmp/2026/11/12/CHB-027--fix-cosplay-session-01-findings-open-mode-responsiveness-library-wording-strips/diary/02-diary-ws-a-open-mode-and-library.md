---
Title: Diary WS-A open mode and library
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
    - Path: /home/manuel/code/wesen/chromobench/packages/ingest/src/conditioning/open-mode.ts
      Note: The photo-or-negative classifier (guessOpenMode, openPrior)
    - Path: /home/manuel/code/wesen/chromobench/packages/studio-kit/src/bridge/frames.ts
      Note: Frame kind, logs keyed by (sha, mode), openFile outcomes, reopen, remove
    - Path: /home/manuel/code/wesen/chromobench/apps/studio/src/host/studio-engine.ts
      Note: openAs (auto / photo / negative, ask), forget on re-decode
    - Path: /home/manuel/code/wesen/chromobench/apps/studio/src/main.ts
      Note: Open flow, status line outcome, mode pill and hint, host commands
ExternalSources: []
Summary: "WS-A of CHB-027: per-file open mode guessed by ingest, logs keyed by mode, re-open as photo/negative, remove, persistent library, host top bar folded into the menus."
LastUpdated: 2026-11-12T14:30:00-05:00
WhatFor: "The record of WS-A's implementation, failures and measurements."
WhenToUse: "Reviewing or merging task/chb-027-open-mode; WS-D builds on its frame identity."
---

# Diary: WS-A open mode, frame identity, library

Workstream A of CHB-027 (findings F1, F2, F3, F5, F6, F15, F11 empty state), on branch `task/chb-027-open-mode`
in its own worktree.

## Step 1: Brief, plan and code reading

I read the common brief, the plan's WS-A section, the CHB-026 findings F1–F16 and the code they point at, then
decided where each piece lives so the shared files (`engines.ts`, `main.ts`) get small edits only. The core
problem behind F1–F3 is that "photo or negative" was one global checkbox read inside the decode, and the frame's
identity and its saved log were the file hash alone.

### Prompt Context
**User prompt (verbatim):** "You are implementing CHB-027 workstream **WS-A: open mode, frame identity, library** (findings F1, F2, F3, F5, F6, F15, F11 empty state).

First read the common brief: /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/chb027-brief-common.md — it has the rules, checks, diary and final-reply format. Then the plan's "WS-A" section (path in the brief).

Your specifics:
- Branch: `task/chb-027-open-mode` (create it in your worktree first; run `pnpm install --offline` if node_modules is missing).
- Diary file: `ttmp/2026/11/12/CHB-027--fix-cosplay-session-01-findings-open-mode-responsiveness-library-wording-strips/diary/02-diary-ws-a-open-mode-and-library.md`
- Screenshots folder: `…/CHB-027--…/various/ws-a/`
- Ports: preview 4711; browser tests STUDIO_PORT=4721 STUDIO_KIT_PORT=4722 SHELL_DEMO_PORT=4723 GPU_PARITY_PORT=4724.
- Plan task ids: 9wcz (open mode, classifier, re-open as, logs keyed by mode, already-open, status) and j9hg (library catalog, remove frame, context menu, File menu, empty state).

What matters most, in order: (1) a photographer opening his Nikon NEFs gets photos and opening his negative strip gets a negative, without ticking anything (Auto classification, with an ask-when-unsure fallback); (2) a wrong choice is always fixable on the frame itself ("Re-open as photo / as negative"), and a saved edit log is never resumed into the other mode (the F3 trap: a `digital-raw` recipe rendered on a scan-mode decode); (3) opening an already-open file never leaves a stuck "opening …" status; (4) the library survives a reload; (5) remove frame + a real thumbnail context menu + File menu items.

Note the shared files: `apps/studio/src/host/engines.ts` is also being reworked by WS-B (moving decode into a worker) — keep your engines.ts change to the decode-mode plumbing (`HostServices.decode` takes an explicit mode) and the classifier hook, and put the classifier logic itself in ingest (new file under `packages/ingest/src/conditioning/` or similar, with unit tests on synthetic images) so WS-B can call it from the worker. `apps/studio/src/main.ts` is yours for the open flow, menus and top bar; WS-C will make small wording edits there."

Two coordinator messages arrived while I worked (relayed by the orchestrator, recorded in the steps that act on
them): fold the host top bar into the shell's menus, and merge `main` after WS-C's merge.

**Assistant interpretation:** Per-file open mode with a pixel classifier in ingest, re-open as the other mode,
logs keyed by mode, honest status for repeated opens, a persistent library, remove / context menu / File menu.
**Inferred user intent:** Manfred opens his own files and gets the right thing without help, and can fix it when not.

### What I did
- `git checkout -b task/chb-027-open-mode`; `pnpm install --offline` (0.8 s, deps present).
- Read `apps/studio/src/main.ts`, `host/engines.ts`, `host/studio-engine.ts`,
  `packages/studio-kit/src/bridge/{frames,kv,persistence,editlog-route,render-bridge}.ts`, `studio.ts`, `cb.ts`,
  the variants, `packages/shell/src/{core/commands.ts,app/chrome.ts,dom/forms/collection.ts,dom/viewport.ts}`,
  `packages/contract/src/{graph.ts,source.ts,paths.ts}`, `packages/ingest/src/conditioning/film-layout.ts`.

### Why
- To place each change in the package that owns it: classifier in ingest, frame identity in studio-kit, the
  decode switch in the host.

### What worked
- The shell already had what the UI needs: collections take a `context` menu and `keys`; `thumb` takes a `src`
  (data URL) besides a renderable; the catalog was already persisted (document tier) and only filtered out by
  `visibleFrames` when its frame was not open in the session (F5's real cause).

### What didn't work
- N/A (reading only).

### What I learned
- `source.open`'s node id is `hash(op, {source: sha, encoding})`: **the decode mode is not part of it**. Decoding a
  file another way under the same sha would leave every engine with stale cached results and stale node infos (sizes
  differ: a NEF in scan mode is CFA-binned 3016×2016, in photo mode 6032×4032 → 4000 px on the GPU).
- The frame id is `frame_<sha[0..8]>` for both modes, so a re-open keeps the frame's id and catalog entry.

### What was tricky to build
- N/A yet.

### What warrants a second pair of eyes
- See Step 3 on the engine cache invalidation (`forgetSource`).

### What should be done in the future
- Contract: put the decode mode into `source.open`'s args (Step 3).

### Code review instructions
- N/A.

### Technical details
- F3's chain: `frames.ts` resumed `kv.get('logs', sha)` whatever way the file had just been decoded.

## Step 2: The classifier (ingest `guessOpenMode`) and its calibration on the real files

I wrote `packages/ingest/src/conditioning/open-mode.ts`: photo or negative from the pixels of the working image,
with a confidence, plus a file-type prior. I calibrated it on all 33 of the photographer's D750 NEFs and on the
3-frame strip `raw010.dng` (numbers only, nothing copied). The first rule was wrong in an instructive way:
`filmLayout`'s open-gate test fires on most daylight photos.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Auto classification with an ask-when-unsure fallback, logic in ingest.
**Inferred user intent:** NEFs open as photos and the strip as a negative, with no checkbox.
**Commit (code):** see Step 3 (one commit for the open-mode milestone).

### What I did
- `guessOpenMode(rgb, w, h, {format, name, wb, layout})` → `{kind, confident, why, evidence}`; `openPrior(name)`
  (camera RAW / JPEG → photo, TIFF → negative, DNG → none); exported from `@chromobench/ingest`.
- Evidence: an *orange rebate* (filmLayout rebate at the edge, confidence ≥ 0.5, lg R − lg B ≥ 0.25 and
  lg R − lg G ≥ 0.1); the image's median cast (lg R − lg B, lg R − lg G) and its share of orange pixels.
  Strong mask = RB ≥ 0.4, RG ≥ 0.15, share ≥ 0.7; weak mask = RB ≥ 0.25, RG ≥ 0.08, share ≥ 0.6. Camera RAW +
  mask without an orange rebate → "unsure" (asks).
- Calibration script in the scratchpad (`wsa/calibrate.ts`): decode each private file with `LibRawDecoder` in
  Node, linearise, 512 px working image, run the guess. Command: `node …/scratchpad/wsa/calibrate.ts all`.
- `packages/ingest/test/open-mode.test.ts`: 7 synthetic cases (planted 135 strip in a holder; a tight negative
  crop; the same crop from a NEF → asks; a daylight photo as NEF / JPEG / TIFF; a tungsten photo; white-balance
  multipliers; priors) and 2 private-file cases that `skipIf` the files are absent.

### Why
- Colour alone cannot separate a tightly cropped negative from a photo in tungsten light without white balance,
  so a mask without a film edge on a camera RAW is "unsure" and the studio asks, with the guess preselected.

### What worked
- Final rule, all 33 NEFs (photo-mode decode): **photo, sure** (RB −0.28…+0.39, RG −0.36…+0.09, orange share
  ≤ 0.51). raw010.dng: **negative, sure** in both decode modes (rebate confidence 1.00, rebate RB 0.59–0.60,
  RG 0.31, orange share 1.00, holder found).
- `npx vitest run packages/ingest/test/open-mode.test.ts` → 9 passed (≈ 11 s with the private files present).

### What didn't work
- First rule (an open gate counts as a film edge): 8 of 9 sampled NEFs came out "negative", e.g.
  `DSC_8515.NEF photo 512x342 negative UNSURE gate=1 reb= 0.51 rebRB=-0.04 holder=1 RB=-0.17 RG=-0.27 orange= 0.00`.
  filmLayout's open gate (a bright population above a 0.2 D histogram gap) is found in blown skies and highlights.
  Fix: the open gate counts only together with a mask, and a rebate only when it is orange.
- In scan mode with daylight white balance, warm NEFs look masked (`DSC_8541 scan … RB= 0.64 RG= 0.30 orange= 0.99`);
  the same file in photo mode reads RB 0.39, RG −0.04. So camera RAWs are classified on the photo decode (their
  prior), and the RG term (red over *green*) separates the mask from warm light.
- My first synthetic "tight negative" was a positive (density sign flipped) and its flat bands at the border read as
  rebate; fixed the formula (D = 0.6·lg(E/0.01)) and gave the scene texture.

### What I learned
- The orange mask's signature is red > green > blue across every pixel (raw010: share 1.00); a warm photo is red >
  blue but rarely red > green.

### What was tricky to build
- Margins: DSC_8655 (orange share 0.51, RG 0.09) is the closest photo; it stays below the weak-mask thresholds.

### What warrants a second pair of eyes
- A camera *scan* of a negative saved as NEF is "negative, unsure" unless the film edge is in frame: it gets the
  question. Intended, but untested on a real file.

### What should be done in the future
- A real camera-scan NEF of a negative to calibrate on.

### Code review instructions
- `packages/ingest/src/conditioning/open-mode.ts`; `npx vitest run packages/ingest/test/open-mode.test.ts`.

### Technical details
- Calibration samples (photo-mode decode, 512 px): DSC_8559 RB −0.11 RG −0.27 orange 0.03; DSC_8541 RB 0.39
  RG −0.04 orange 0.21; raw010 (scan) RB 0.59 RG 0.31 orange 1.00, rebate at the edge. Decode times in Node:
  NEF photo mode 6–12 s, raw010 0.5–1.4 s.

## Step 3: Open mode per file, logs keyed by mode, re-open, remove, honest status (task 9wcz)

The decode mode is now an explicit argument everywhere, the frame registry knows each frame's kind, logs are
saved under `(sha, mode)`, and opening an open file is an outcome the host reports. Driven on the real files in the
built app (reference engine), every step of the F1–F3 repro now ends right.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Items 1–4 of the plan's WS-A.
**Inferred user intent:** No inverted NEFs, no orange negatives on the Print tab, no stuck status.
**Commit (code):** see the commit "CHB-027 WS-A: open mode per file …" (hash in Step 4).

### What I did
- `apps/studio/src/host/engines.ts` (small): `HostServices.decode(bytes, sha, name, mode)`; the `photo` setting is
  gone; each decode computes `guess` with ingest's classifier (scan mode reuses conditionScan's layout); hooks
  `prior` (ingest `openPrior`) and `forget` (the engine's `forgetSource`). A file decoded as a scan that is
  confidently a photo does not lend its "base" to the roll.
- `host/studio-engine.ts`: `openAs(source, 'auto'|'photo'|'negative', ask?)`: auto decodes in the prior's mode,
  asks when unsure, decodes again when the answer differs; when a sha is registered again in another mode it drops
  its graph and calls `forget`. The contract's `open()` is `openAs(…, 'auto')`.
- `packages/core/src/engine-ref.ts`, `packages/gpu/src/engine-gpu.ts`: `forgetSource(sha)` clears cached results
  (and the GPU's source textures and rebate cache) and replaces the engine graph by one holding the other sources.
- `packages/studio-kit/src/bridge/frames.ts`: `FrameEntry.kind`; `openFile()` → `{entry, outcome}` with
  `opened | resumed | already | conflict`; concurrent opens of one file share one promise; logs saved under
  `logKey(sha, kind)` = `<sha>:photo|negative`; an old plain-sha log is resumed only when its `initial.kind`
  matches; `reopen(id, as)` reads the bytes again (the host's per-file `read`), keeps the id and resumes that
  mode's log; `remove(id)`; `onRemoved`. `defaultFor(sha, name, kind)`.
- `editlog-route.ts`: a removed frame leaves `recipes`/`proposals`; history parts of a replaced or removed log are
  skipped instead of writing the old recipe back.
- `studio.ts`: `opener` option, `openFile`, `reopen`, `remove` (catalog, order and selection cleaned); catalog
  entries carry `kind`; `StudioHost` + `setHost` (ui.host flags), used in Step 5.
- `cb.ts`: commands `frame.reopenAsPhoto`, `frame.reopenAsNegative` (hidden for the mode the frame is in),
  `frame.remove` (Delete/Backspace in strip and grid), and the host ones (`file.open`, `file.openFolder`,
  `file.reopenFolder`, `file.openAs.{auto,photo,negative}` → prefs.openAs, `file.dust`, `file.export`,
  `file.saveRecipe`, `view.layout`), hidden unless `ui.host.actions` lists them; `Mod+O`, `Mod+E`;
  `FRAME_CONTEXT` on filmstrip and grid; `libraryFrames` (with frames not open) next to `visibleFrames`; empty text
  "No photos yet: File ▸ Open Files… (Ctrl+O), or drop them here". `output.save` left the generated File menu
  (File ▸ Export… runs it where the host has no export dialog). Classic's File/Frame/View menus list the new ids.
- `main.ts`: the open flow (one question per batch through `askOpen`; conflict → confirm dialog → re-open; toast
  "already open"; the status line always ends: `opened X · Y was already open · …`); a mode pill `#frame-mode`
  (Photo/Negative, a click re-opens the other way) and a hint `#mode-hint` ("Looks like a negative: re-open as
  negative?", F15); the `photo` checkbox replaced by an `#open-as` select (folded into the menus in Step 5).
- Tests: `packages/studio-kit/test/open-mode.test.ts` (8): opener kinds and log keys; the F3 trap with an old
  plain-sha photo log; already/conflict; concurrent opens; re-open keeps the id, skips the old undo, resumes on the
  way back; remove; offline library entries; host commands hidden and shown. Variant snapshots updated (`-u`:
  context menus, keys, empty text). `e2e/studio-photo.spec.ts` no longer ticks `#photo`: the synthetic camera DNG
  must be *guessed* a photo.

### Why
- Logs keyed by `(sha, mode)` keep both interpretations of a file; switching back resumes the first.

### What worked
- `pnpm typecheck`, `pnpm lint` clean. `pnpm test`: 88 files, 2658 passed, 1 failed under machine load
  (`ch3.golden … 33³ table iterations` timed out at 32.5 s); alone it passes
  (`npx vitest run packages/core/test/ch3.golden.test.ts` → 13/13).
- Driven on the built app (`?nosw&engine=reference`, scratchpad `wsa/drive1.mjs`; screenshots of the private files
  stay in the scratchpad): DSC_8559.NEF → pill **Photo**, `digital-raw`/`photo`; raw010.dng → **Negative**,
  `negative-scan`/`scan`; DSC_8559 again → "DSC_8559.NEF was already open" + toast, no stuck status; raw010 through
  the pill → photo, hint "Looks like a negative: re-open as negative?"; the hint → negative again with the
  automatic first print **2.227 s** (the session's `?fresh` value); `[DSC_8553, DSC_8559]` in one batch →
  "opened DSC_8553.NEF · DSC_8559.NEF was already open". No page errors. Open times under load: NEF 13–30 s,
  raw010 9–19 s on the CPU engine (WS-B's subject).

### What didn't work
- My first drive script clicked the pill while the NEF was selected and re-opened the NEF instead of the strip
  (a script bug); fixed by selecting the strip first.

### What I learned
- After an open the status line is overwritten by "rendered N · screen" as soon as the frame renders; the open
  result stays in the toast. WS-C owns the status wording.

### What was tricky to build
- Source identity: a re-open must invalidate everything derived from `source.open(sha)` in three graphs
  (StudioEngine, the physics engine, the frame) and the engine caches. The frame gets a fresh `Graph` (new
  entry); StudioEngine and the physics engine replace theirs (`forgetSource`), and nodes are adopted again with the
  new source size on the next render (the render bridge adopts the closure on every evaluation).
- Undo across a re-open: the global history holds parts bound to the old log; without the `gone()` guard an undo
  would have mirrored the old recipe (of the other kind) back into `recipes.<id>`.

### What warrants a second pair of eyes
- `forgetSource` clears *all* cached results of the engine, not only the re-opened file's (simple; re-opens are rare).
- WS-B's `WorkerEngine` proxy must forward `forgetSource` (engines.ts calls it optionally, structurally).

### What should be done in the future
- Contract request: `source.open` should carry `mode` (bound from `source.decode.mode`), so node ids differ by
  decode and `forgetSource` is no longer needed (`packages/studio-kit/CONTRACT-REQUESTS.md`).

### Code review instructions
- Start at `packages/studio-kit/src/bridge/frames.ts` (`openFile`, `reopen`, `savedLog`), then
  `apps/studio/src/host/studio-engine.ts` (`openAs`, `forget`), `cb.ts` (`reopenAs`, `frame.remove`).
- `npx vitest run packages/studio-kit/test/open-mode.test.ts packages/ingest/test/open-mode.test.ts`.

### Technical details
- Outcomes: `opened` (new recipe), `resumed` (saved log of that mode), `already`, `conflict` (open in the other
  mode while a specific mode was asked: the host confirms, then `reopen`).

## Step 4: Merge of main (WS-C), and the library across reloads (task j9hg, host part)

I merged `main` early (WS-C's wording branch had landed), before restructuring `main.ts` further, then made the
library survive a reload: each frame's catalog entry keeps a small JPEG of its print, frames not open in the session
are listed with it and a "not open" badge, and selecting one reads its file again through its saved handle or asks
where it is. Drop onto the window opens files, so the empty-state text tells the truth.

### Prompt Context
**User prompt (verbatim):** see Step 1. Coordinator message (relayed): "WS-C (wording) is merged into main (merge
444f153). Before your final commit, please `git merge main` into your branch and resolve conflicts yourself …
please route open-file errors in openFiles through it [Runtime.explainError] …"
**Assistant interpretation:** Merge now; keep WS-C's status line (summary text, technical detail in tooltips) and
use `rt.explainError` for open errors.
**Inferred user intent:** One coherent main.ts after all merges.
**Commit (code):** 87d750b — "CHB-027 WS-A: open mode per file (guessed), logs keyed by mode, re-open as photo/negative, remove frame"; merge 66f9401; this step's commit follows.

### What I did
- `git merge main`: two conflicts in `main.ts` (the studio-kit import line; the store listener where WS-C put
  `notesSummary` and I put `lastEntry`/`showMode`) — kept both. Open errors now read
  `rt.explainError?.(err, {})?.text ?? msgOf(err)`, the technical text goes to the status tooltip (`detail`).
- `main.ts`: `scheduleThumb` (2 s after a non-preview log event, 0.5 s after an open) asks
  `rt.renders.thumb(print, 160, …)` — the filmstrip's own cache key, so usually a cache hit — and writes
  `catalog.frames.<id>.thumb` (JPEG 0.8, ~1.5 kB for the fixture) at document tier, which the shell autosaves.
  `relink(id)`: handle `handles/file:<sha>` → `reconnect` (permission) → `openFiles([…], {as: catalog kind,
  expect})`; otherwise a dialog "Where is NAME?" (Remove from library / Not now / Locate…). Selection restored at
  boot that is not open is cleared, so the first click opens it; a right-click (context menu) does not trigger it.
  Document-level drop with `getAsFileSystemHandle` (handles kept). Ready text: "ready: N frames in the library;
  select one to open its file again" or "ready: open photos or negatives (File ▸ Open Files…, Ctrl+O, or drop them
  here)".
- `storage/fsa.ts`: `PickedFile.handle`; `hasFilePicker`, `pickFiles` (showOpenFilePicker), `fromHandles`;
  `listScans` keeps the handles of a folder's files.
- `studio-kit.css`: a saved thumbnail hides the empty canvas beside it. `app.css`: `#app { z-index: 1 }` so the
  shell's menus paint over the status line (the context menu's last item was hidden under it).
- `e2e/studio-open-mode.spec.ts` (2 tests, reference engine, synthetic files): auto guess for a camera DNG and a
  negative TIFF in one batch; "already open"; re-open as photo by command, the hint back, the negative's edit (14 s)
  resumed; reload with thumbnails, "not open", the "Where is" dialog, the studio's context menu, Delete removes.

### Why
- Thumbnails from the shell's thumbnail cache cost nothing extra on the engine; the catalog was already persisted.

### What worked
- `CI=1 STUDIO_PORT=4721 … npx playwright test e2e/studio-open-mode.spec.ts e2e/studio-photo.spec.ts` → 3 passed.
- Drive on the built app (scratchpad `wsa/drive2.mjs`, synthetic fixture; screenshots in `various/ws-a/`
  01-empty, 02-after-reload, 03-where-is, 04-context-menu): thumbnail saved (1471 chars), after reload "1 frame in
  the library", cell with `data:image/jpeg` and badge "not open", dialog, re-open resumes Time 14 s, context menu
  "Re-open as Photo · Flag as Pick · Reject · Unflag · Remove from Library". No page errors.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (91 files, 2678 passed, 7 skipped) green after the merge.

### What didn't work
- First e2e run: `scene.dng: Cannot perform Construct on a detached ArrayBuffer` — Auto decodes a DNG in scan mode
  first, finds a photo and decodes again, but LibRaw's worker had taken the bytes (transferred). Fix:
  `StudioEngine.openAs` keeps a copy for the second decode when guessing; `Frames`' default reader keeps a copy
  too. The NEF path never re-decodes (prior = photo), which is why the real-file drive in Step 3 did not see it.
- One drive run timed out waiting for the "Where is" dialog after an immediate click; two re-runs and the e2e
  passed. Not reproduced; noted.

### What I learned
- `structuredClone`-able `FileSystemFileHandle`s go straight into the IndexedDB KV; `setInputFiles` gives none, so
  e2e covers the "locate" path and not the handle path.

### What was tricky to build
- Relink needs a user gesture for `requestPermission`; it runs from the store listener of the click's selection
  change (within Chrome's transient activation), never at boot.

### What warrants a second pair of eyes
- The handle path (`reconnect` → re-read) is untested headless; try it by hand in Chrome: open with
  File ▸ Open Files…, reload, click the thumbnail.

### What should be done in the future
- A "missing file" mark and Locate in the Metadata panel, not only the dialog.

### Code review instructions
- `apps/studio/src/main.ts`: `scheduleThumb`, `relink`, `chooseFiles`, the drop handler; `storage/fsa.ts`.
- `CI=1 STUDIO_PORT=4721 STUDIO_KIT_PORT=4722 SHELL_DEMO_PORT=4723 GPU_PARITY_PORT=4724 npx playwright test e2e/studio-open-mode.spec.ts`.

### Technical details
- KV: `handles/file:<sha256>` = FileSystemFileHandle; `logs/<sha>:photo|negative` = EditLogData;
  `workspace/<app>:<ver>:doc` holds the catalog with `kind` and `thumb`.
