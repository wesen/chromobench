---
Title: Diary WS-B open strips and library
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
LastUpdated: 2026-11-12T17:10:51.106555626-05:00
WhatFor: ""
WhenToUse: ""
---

## Step 1: The assignment, orientation and a plan of attack

I am WS-B of CHB-031: open, strips and library (F18, F20, F21, F22, and F10 on the CPU engine). I created the branch
`task/chb-031-open-strips` in my worktree, installed dependencies offline (`pnpm install --offline`, exit 0), and
read the common brief, the plan's WS-B section, the session-02 findings and experience report, and the code of the
open flow (`apps/studio/src/main.ts`), the frames (`packages/studio-kit/src/bridge/frames.ts`), the studio service
(`packages/studio-kit/src/studio.ts`), the host engine (`host/engines.ts`, `host/decode.ts`, `host/studio-engine.ts`)
and the commands in `cb.ts`.

The causes are visible in the code already: F21 is `Studio.uncatalogue` moving the selection to the next frame of
the catalog, which may be a "not open" library frame, and `main.ts` relinks whenever the selection lands on one; F18
is `prefs.openAs` (a persisted pref) used for every open, including a file the library already knows; F20's
blockiness is the reference engine's 512 px working image spread over a whole strip; its orientation is the
recipe's `view.frame.orientation`, which exists but has no command.

### Prompt Context
**User prompt (verbatim):** "You are implementing CHB-031 workstream **WS-B: open, strips and library** (findings F18, F20, F21, F22, and F10 on the CPU engine).

Read first: the common brief /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/brief-common-v2.md (rules, checks, diary format, final reply; its "Additions" section matters). Your ticket's plan: `ttmp/2026/11/12/CHB-031--cosplay-session-02-findings-enlarger-real-mode-by-default-open-as-panels-strip-frames-leftovers/design-doc/01-plan.md` (section WS-B). The findings with repro: CHB-026 `various/02-findings.md` (section "Session 02") and `sessions/02-sonnet-rerun-session-01/` (report, screenshots, scripts). Background on strips: CHB-027 diary `05-diary-ws-d-strip-frames.md`; on open mode and the library: CHB-027 `02-diary-ws-a-open-mode-and-library.md`; on the worker: CHB-027 `03-diary-ws-b-responsiveness.md`.

Your specifics:
- Branch: `task/chb-031-open-strips` (create it first in your worktree; `pnpm install --offline` if node_modules is missing).
- Diary (exists, write in it): `ttmp/2026/11/12/CHB-031--…/diary/03-diary-ws-b-open-strips-and-library.md` — the diary skill's investigation format exactly (read /home/manuel/.claude/skills/diary/SKILL.md and references/investigation-entry.md); Step 1 quotes this prompt verbatim; every step has all sections; write as you go and commit with the code.
- Screenshots: `…/CHB-031--…/various/ws-b/` (synthetic fixtures only).
- Ports: preview 4811 (the Mac tunnel maps it, for a real-GPU check of strip-frame sharpness if useful — lock first, per CHB-027 `scripts/mac-README.md`); browser tests STUDIO_PORT=5321 STUDIO_KIT_PORT=5322 SHELL_DEMO_PORT=5323 GPU_PARITY_PORT=5324.
- Plan tasks to check off when done: odem, 6wti, jb0i, 9t2y (and note F10's outcome in the diary).

Priorities: (1) F21 (the "Where is …?" dialog opening by itself) and F18 (Open As applied silently on relink) — small, user-visible; (2) F20: strip frames' orientation (per-frame rotate commands, a sensible default for landscape frames cut from a vertical strip), their sharpness (the working size of a crop: on the CPU a 3-frame strip leaves ~170 px per frame), and frame 1's haze (shared strip base/veil vs per frame); (3) F22: profile the cold first open (~29 s on a fresh profile) and cut what can be cut — the visible progress UI is NOT yours (CHB-029); (4) F10 on the CPU engine: a sharper preview without losing responsiveness (e.g. a larger working size only for the refined visible region, or for strip frames), measured with CHB-027's `scripts/01-measure-responsiveness.mjs`.

Parallel work: WS-A (enlarger defaults, controls panels, `packages/studio-kit/src/kit/args.ts`, `apps/studio/src/host/first-print.ts`, contract catalogue) and CHB-032 (core `engine-ref.ts` imports, gpu `engine-gpu.ts` split, TIFF writers, `packages/dsl/src/host.ts` split, looks/finish kit splits). Keep edits to those files minimal and local; `packages/studio-kit/src/cb.ts` is shared with WS-A — keep edits local there."
**Assistant interpretation:** Fix the open/library/strip findings of session 02 in the studio's open flow, frames
and host decode, with tests, screenshots on synthetic files, a measured F22/F10 investigation, and a diary.
**Inferred user intent:** The photographer's library and strip workflow should stop surprising him (dialogs by
themselves, a stale Open As, sideways and blocky strip frames), and the first open should be faster.
**Commit (code):** N/A (orientation).

### What I did
- Created the branch; `pnpm install --offline` (exit 0).
- Read `main.ts` (`openFiles`, `relink`, the selection listener that calls `relink`), `frames.ts` (`openFile`,
  `build`, `load`), `studio.ts` (`catalogue`, `uncatalogue`, `reopen`, `remove`), `cb.ts` (`file.openAs.*`,
  `frame.*`), `host/decode.ts` (`decodeScan`: working image, `conditionScan`, `stripFrames`),
  `host/engines.ts` (`DEFAULT_REF_LONG = 512`), `host/studio-engine.ts` (`output.frame`: crop then orientation).
- Looked at the tester's `shots/22-strip-frame-3.png`: the fence, sign and graffiti of frame 3 lie on their side;
  the graffiti reads bottom to top, the sky is on the left — a quarter turn clockwise puts it upright.
- `exiftool -Orientation` on the private DNGs: all `1` (no orientation tag; the strips are scanned vertically,
  1608–1672 px wide × 2457–3695 px tall).

### Why
- To find the causes before changing anything, and to keep my edits inside WS-B's files.

### What worked
- The causes of F18 and F21 are in a handful of lines (see the second paragraph).

### What didn't work
- No failures in this step.

### What I learned
- `view.frame.orientation` (contract 0.3, `output.frame`) already exists with `none | cw90 | rot180 | ccw90 | …`
  and `StudioEngine.frame` applies it after the crop: rotate commands need no contract or engine change.
- Negative Lab Pro's conversions beside the scans are landscape for raw000/004/010 and portrait for raw007/013
  (dimensions only, read locally): the photographer turned some frames and not others, so a default can only be a
  guess; the per-frame command matters more than the default.
- The reference engine's spatial film stages (couple, halation, grain) are not sampled (CHB-027 WS-B step 8): a
  bigger working image costs on the first full render, not only on drafts.

### What was tricky to build
- N/A (no code yet).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- N/A.

### Technical details
- Plan of attack, in the prompt's priority order: F21 (the selection never moves onto a not-open frame by itself),
  F18 (Open As resets to Guess at start unless kept; a file the library knows opens in its recorded kind; a pill in
  the status line while Open As is not Guess), F20 (rotate commands, a default turn for landscape frames on a
  vertical strip, a larger working image for strips on the CPU, the haze), F22 (profile), F10 (measure).

## Step 2: F21 and F18 — the selection never lands on a not-open frame; Open As resets at start and is shown

F21 came from `Studio.uncatalogue`: when the selected frame leaves the library (Remove, or the frame replaced by a
re-open), the selection moved to "the next frame of the catalog order", and that may be a library frame whose file
is not open in this session. `main.ts` relinks whenever the selection lands on such a frame, so "Where is …?" opened
by itself. Now the selection moves to the next *open* frame (after it, else before it), or to none; a re-open that
replaced the shown frame selects the file's first frame. Relink therefore only follows a selection the photographer
made (a click in the filmstrip, Frame ▸ Next).

F18 had two parts. A file the library knows now opens the way the library had it when the caller says "auto"
(`FramesOptions.known`, fed by `Studio.libraryKind(sha)` from the catalog), so the tester's "open the truck again
the next day" gives the photo, not a new guess. File ▸ Open As ▸ Photos / Negatives resets to Guess at start unless
he ticks the new File ▸ Open As ▸ "Keep This Choice After Restart" (`prefs.openAsKeep`), and while it is not Guess
the status line shows a pill "Opening as negatives" / "Opening as photos" (click: Guess again). An explicit choice
made this session still wins over the library; a toast says so ("… opened as a negative (File ▸ Open As); your
library had it as a photo: Frame ▸ Re-open as Photo brings that back").

### Prompt Context
**User prompt (verbatim):** see Step 1. Coordinator, mid-step (verbatim, from the user): "commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Fix F21 and F18 first (small, visible), with unit tests; commit with the diary.
**Inferred user intent:** No dialog he did not ask for; no stale mode applied without telling him.
**Commit (code):** the checkpoint commit of Step 4 ("CHB-031 WS-B: F21 selection, F18 Open As, F20 strip orientation and working size (checkpoint)")

### What I did
- `packages/studio-kit/src/studio.ts`: `uncatalogue` picks `next` among open frames (`this.frames.get(x)`), and a
  remaining selected id only when it is open; `reopen` remembers the selection before and selects the file's first
  frame when the shown frame was replaced; `libraryKind(sha)`; `Frames` constructed with `known`.
- `packages/studio-kit/src/bridge/frames.ts`: `FramesOptions.known`; `openFile` resolves `'auto'` to the known kind.
- `packages/studio-kit/src/cb.ts` (local additions): `prefs.openAsKeep`, command `file.openAs.keep`.
- `packages/studio-kit/variants/classic.js`: `file.openAs.keep` in File ▸ Open As.
- `apps/studio/src/main.ts` (open flow): `#open-as` pill (`showOpenAs`, click → `file.openAs.auto`), reset of a
  non-kept Open As at start, the library-kind toast in `openFiles`.
- Tests: `packages/studio-kit/test/open-strips-library.test.ts` (F21: Remove skips not-open frames, the last open
  frame leaves no selection, removing a not-open frame selects an open one, a photo re-opened as a strip shows the
  strip's first frame; F18: auto on a library photo opens as a photo without a guess, an explicit Open As wins, Keep
  toggles).

### Why
- Relinking on any selection change is right for his clicks; the bug was the studio choosing a not-open frame for
  him. Fixing the choice keeps the relink trigger simple (no timing heuristics on input events).
- Open As is a per-batch tool; persisting it silently was the trap. Reset-at-start plus an opt-in "keep" and a
  visible pill is what the plan asked for.

### What worked
- First full `pnpm test` after these and the Step 3 changes: 2733 passed, 8 failed — all 8 the variant `explain()`
  snapshots (new commands listed). `npx vitest run packages/studio-kit/test/variants.test.ts -u`; the diff is
  exactly the four new commands per variant and the command counts.
- `npx vitest run packages/studio-kit apps/studio`: 19 files, 211 passed.

### What didn't work
- `rt.commands.enabled(...)` in my test: `TypeError: rt.commands.enabled is not a function`; the registry's API is
  `status(id, state).ok`. Fixed the test.
- Shell heredocs that append to the diary are refused by the harness ("too complex to verify that it stays inside
  the worktree"); the diary is written with the editor tools.

### What I learned
- `prefs` is a persisted view-tier state; a reset at boot through the command (`rt.runCommand('file.openAs.auto')`)
  is enough, and the pill must be painted once at boot (`rt.store.on` fires only on changes).

### What was tricky to build
- `main.ts` ordering: the pill code used `openAsPref` before its `const` declaration and the click handler before
  the element (`TS2448: Block-scoped variable 'openAsEl' used before its declaration`). Moved the block after
  `openAsPref`.

### What warrants a second pair of eyes
- `known` makes 'auto' follow the library for any file the catalog lists; a removed frame is out of the catalog,
  so it is guessed again (intended).

### What should be done in the future
- Drive the pill across a reload in the built app and in an e2e (not done yet).

### Code review instructions
- `studio.ts` `uncatalogue`, `reopen`, `libraryKind`; `frames.ts` `openFile`; `main.ts` `showOpenAs`, `openFiles`.
- `npx vitest run packages/studio-kit/test/open-strips-library.test.ts packages/studio-kit/test/open-mode.test.ts`

### Technical details
- Selection rule: `next = order.slice(i).find(open) ?? order.slice(0, i).reverse().find(open) ?? null`.

## Step 3: F20 — strip frames upright by default, Rotate/Flip per frame, and a working image sized for the frames

Orientation: the recipe already has `view.frame.orientation` (contract 0.3, applied by `output.frame` after the
crop) and the Finish kit has `orient.cw/ccw/flipH` in its own menu; the Frame menu had nothing. I added core commands
Frame ▸ Rotate Left / Rotate Right / Flip Left to Right (`frame.rotateLeft/Right`, `frame.flip`, the two rotates also
in the thumbnail context menu) on the Finish kit's `orientFrame` (keeps a straighten angle's look). For the default I
turned the tester's raw010 screenshots in the scratchpad: a quarter turn clockwise puts frames 1 and 3 upright but
the EXIT sign then reads mirrored ("TIX3"); a transpose (turn + mirror) reads "EXIT" and "Shipping & Receiving"
correctly — the strip was scanned through its base. So frames wider than tall on a strip running top to bottom get
`transpose` (`model/orient.ts` `stripOrientation`); other strips stay as scanned.

Sharpness: the reference engine decodes at 512 px for the *whole* strip, so a frame got ≈ 220 × 150 px. `decodeScan`
now re-samples a detected strip so its largest frame gets ≈ `long` px (`stripScale`: at most 4 × long, never above
the file's size; the boxes and rebate are scaled, base/veil/guess stay). raw010 → strip 540 × 1192, frames
511 × 349–354. On the GPU (4000 px) nothing changes. A saved strip log from another working size has its crop and
rebate scaled once (`rescaleStripLog`, an 'auto' History step "Working size changed"). In the built app frame 3 is
upright, readable and sharp — but the strip's open went from ≈ 2.6 s (session 02) to 15.8 s to the first result,
because the reference engine runs the negative stages (invert.dyes ≈ 17 µs/px in exact mode) over the whole, now
5.4× larger, strip. Not acceptable as is; the next step measures the way out.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Orientation commands and a default; the working size of a strip frame; measure.
**Inferred user intent:** Strip frames that look like his pictures: upright and not mosaics.
**Commit (code):** the checkpoint commit of Step 4.

### What I did
- `packages/studio-kit/src/model/orient.ts` (new): `stripOrientation(boxes)`.
- `frames.ts`: `stripFrameRecipe(r, id, box, orientation?)`; `build` applies the strip's orientation to new strip
  frames; `rescaleStripLog(log, box, W, H)` on resumed strip logs.
- `cb.ts` (local): `frame.rotateLeft`, `frame.rotateRight`, `frame.flip` (enabled with an open frame), `FRAME_CONTEXT`
  lists the two rotates; `classic.js` Frame menu lists the three.
- `apps/studio/src/host/decode.ts`: `scaleBox`, `stripScale`, the re-sample in `decodeScan` with the note
  `strip working image W×H (≈ N px a frame)`.
- `refMode` plumbing for the F10 measurement (default unchanged, `exact`): `HostOptions.refMode`, `InitJob.mode`,
  `engine-serve.ts` passes it to `RefEngine`, `?refMode=exact|tabulated` in `main.ts`, the engine label says
  "tabulated" when on.
- Tests: `open-strips-library.test.ts` (stripOrientation cases; strip frames open as `transpose`; Rotate Right →
  `flipH`, Rotate Left back, Flip → `cw90`, undo; a photo stays `none`; saved logs rescaled at k = 1 → 2 → 2 → 1, a
  crop moved inside its frame follows); `apps/studio/test/strip-working-size.test.ts` (stripScale cases, scaleBox,
  `decodeScan` of a planted 3-frame strip at 256 px: frame long side in (230, 256], boxes and rebate inside; at
  4000 px untouched).
- Built and served (`pnpm --filter @chromobench/studio build`; `pnpm --filter @chromobench/studio preview --port 4811
  --strictPort`, background), opened raw010 with CHB-027's `scripts/wsd-01-strip-open.mjs
  'http://localhost:4811/?nosw&fresh&engine=reference' ~/Downloads/raw010.dng <scratchpad>/wsb/priv after`
  (screenshots of his pictures stay in the scratchpad, not committed).

### Why
- A per-frame command matters more than any default (NLP's conversions beside his scans are landscape for some
  strips and portrait for others), but raw010 shows what his scanner delivers, so it sets the default.
- Sizing the strip for its frames keeps one source per strip (shared base and veil, WS-D's design), no engine change.

### What worked
- raw010 in the build: three frames, crops 511 × 349, 511 × 354, 511 × 354; frame 3 upright and sharp, the sign
  readable; frame 1's EXIT sign reads correctly. First-print times 2.227 / 2.5 / 2.806 s as in session 02.

### What didn't work
- Open time: `"open": { "resultMs": 15789, "wallMs": 18504, "stalls": 2, "worstStallMs": 167 }` (session 02: 2.6 s).
- My first expectation for Rotate Right on `transpose` was `flipV`; the product R·T = [[0,-1],[1,0]]·[[0,1],[1,0]] =
  [[-1,0],[0,1]] is `flipH`. Corrected the test.

### What I learned
- `node ttmp/…/CHB-027…/scripts/02-profile-ref-stages.ts 512 negative-scan` (Node, exact): first render 10.3 s for
  512 × 341, invert.dyes 2918 ms, output.display 3543 ms; print-only change 7.0 s. Same with `tabulated`: first
  6.5 s (invert.dyes 1451 ms), print-only change 1.4 s (print.expose 72 ms, output.display 1014 ms); photo
  tabulated print-only change 0.93 s. The studio runs exact (RefEngine's default). core's one-physics test bounds
  tabulated vs exact at < 5e-3 linear XYZ.
- Recipe coordinates are working-image pixels (pre-existing): any change of working size moves them.

### What was tricky to build
- `rescaleStripLog` must not rescale twice or the wrong way (GPU 3695 px ↔ CPU 1192 px ↔ an old 512 px log).
  Comparing with the log's initial crop alone fails after one rescale (the initial stays at the old scale). The
  estimate is the projection of the crop's centre on the box's centre from the origin (`k = (c·b)/(b·b)`); act only
  when |ln k| > 0.3, and use the exact box ratio when the initial crop agrees.

### What warrants a second pair of eyes
- The default `transpose` assumes his scanning habit (through the base); a strip scanned emulsion up opens turned
  but mirrored, and Flip fixes it per frame.
- The 'auto' History step "Working size changed" appears once on old strip logs.

### What should be done in the future
- Bring the strip open time back (see Step 4's resume list).

### Code review instructions
- `decode.ts` `stripScale`/`scaleBox`/`decodeScan`; `frames.ts` `rescaleStripLog`, `build`; `orient.ts`; `cb.ts`
  `orientCurrent`.
- `npx vitest run apps/studio/test/strip-working-size.test.ts packages/studio-kit/test/open-strips-library.test.ts`

### Technical details
- Orientation matrices (output = M·input, y down): cw90 [0,-1;1,0], transpose [0,1;1,0], flipH [-1,0;0,1].
- raw010 at 512: 232 × 512, boxes ≈ 220 × 150; `stripScale` → 540 × 1192.

## Step 4: Checkpoint

The orchestrator asked for a checkpoint (the session may end). Typecheck, lint and the studio-kit/studio unit tests
pass; the full unit suite passed except the 8 variant snapshots, which I updated. Committed F21, F18, F20 orientation
and the strip working size with the diary. The strip working size works but makes the strip's open on the CPU
engine ≈ 6× slower; that is the open item at this point.

### Prompt Context
**User prompt (verbatim):** see Step 1. Orchestrator (verbatim): "Orchestrator: the user may quit the session soon, which would stop you. Checkpoint NOW: (1) get to a state where the checks you can run quickly pass (or, if mid-change, commit anyway with a clear \"WIP:\" subject and say in the diary what is broken); (2) write a diary step \"Checkpoint\" in the full investigation format, including in \"What should be done in the future\" an exact resume list: what is done, what is half-done (files, symbols), the next 3–5 concrete steps, commands to re-run, and any measurements/decisions not yet recorded; (3) stage named paths only and commit (code + diary); (4) report the commit hash in one line to me via your normal output, then continue working as before."
**Assistant interpretation:** Commit a consistent state now, with a resume list.
**Inferred user intent:** Nothing is lost if the session ends.
**Commit (code):** "CHB-031 WS-B: F21 selection, F18 Open As, F20 strip orientation and working size (checkpoint)" (hash in the next step)

### What I did
- `pnpm typecheck` (clean), `pnpm lint` (boundaries ok, colours ok), `npx vitest run packages/studio-kit apps/studio`
  (211 passed); staged named paths only and committed.

### Why
- A checkpoint the next session can resume from.

### What worked
- All quick checks green.

### What didn't work
- Nothing new; the strip open time (15.8 s) is the known regression of Step 3.

### What I learned
- N/A beyond Steps 2–3.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The strip working size is on by default in this commit; if WS-B stops here, either accept the slower strip open
  on the CPU or cap `stripScale` lower (e.g. `long * 0.6` a frame) in `decode.ts`.

### What should be done in the future
- Done: F21 (studio.ts `uncatalogue`, `reopen`), F18 (frames `known`, `file.openAs.keep`, `#open-as` pill, reset at
  start, toast), F20 orientation (`frame.rotateLeft/Right/flip`, `stripOrientation` default `transpose`), F20 strip
  working size (`stripScale`, `rescaleStripLog`), `?refMode=` plumbing (default exact).
- Half-done: F10/F20 speed. `engines.ts` `DEFAULT_REF_MODE = 'exact'`; switching it to `'tabulated'` is the
  candidate (Node: print-only change 7.0 s → 1.4 s at 512 × 341; invert.dyes 2.9 → 1.45 s).
- Next steps:
  1. Rebuild; measure the CPU engine with CHB-027's `scripts/01-measure-responsiveness.mjs --base
     http://localhost:4811 --engines reference [--query refMode=tabulated]` (NEF open, drag, typed 15, raw010 open)
     for exact vs tabulated; record numbers here.
  2. If tabulated is ≈ 2× or better with no visible difference (compare `chromobench.pixel` on a frame), make it the
     default; consider `refLong` 768 for photos (F10) if the drag stays ≤ CHB-027's numbers.
  3. F20 haze: compare frame 1's base/veil measured on its own box vs the whole strip (ingest `conditionScan` on
     sub-images of raw010, numbers only), and whether a per-frame veil changes its print.
  4. F22: profile a cold first open (fresh profile, no `fresh` flag, with the service worker): data packs, LibRaw
     wasm, worker start, tables; cut what can be cut.
  5. Browser e2e: extend `e2e/studio-strip.spec.ts` (orientation transpose, Rotate Right, frame working size) and
     `e2e/studio-open-mode.spec.ts` (Open As pill + reset after reload, no "Where is" after Remove); synthetic
     screenshots to `various/ws-b/`; then `STUDIO_PORT=5321 STUDIO_KIT_PORT=5322 SHELL_DEMO_PORT=5323
     GPU_PARITY_PORT=5324 CI=1 pnpm test:browser`; check off tasks odem, 6wti, jb0i, 9t2y.
- Commands: `pnpm typecheck && pnpm lint && pnpm test`; `pnpm --filter @chromobench/studio build && pnpm --filter
  @chromobench/studio preview --port 4811 --strictPort`.

### Code review instructions
- `git show --stat HEAD`; start with `packages/studio-kit/src/studio.ts` and `apps/studio/src/host/decode.ts`.

### Technical details
- Snapshot file `packages/studio-kit/test/__snapshots__/variants.test.ts.snap` will conflict with WS-A's at merge:
  re-run `npx vitest run packages/studio-kit/test/variants.test.ts -u` after merging.

## Step 5: Resume after the session restart

The session restarted and a new agent (me) continues WS-B from the Step 4 checkpoint (commit `db1c5f7`, "CHB-031
WS-B: F21 selection, F18 Open As, F20 strip orientation and working size (checkpoint)"). I re-read the common brief,
the plan's WS-B section and Steps 1–4 here, and took stock of the worktree: clean except for two untracked
measurement files under `various/ws-b/` from the interrupted step 1 of the resume list. `f10-reference-exact.json` is
a complete run of CHB-027's responsiveness script on this branch (exact mode, numbers only, no pixels) and is kept;
`f10-reference-tabulated.json` only holds the error of the run the restart killed ("Target page, context or browser
has been closed") and is deleted and re-run.

Remaining work, from Step 4's list: measure exact vs tabulated on the CPU engine and decide the default; F20's frame-1
haze; F22's cold first open; F10 (a sharper CPU preview without losing responsiveness); browser e2e for the
user-visible changes; the full checks; tasks odem 6wti jb0i 9t2y.

### Prompt Context
**User prompt (verbatim):** "You continue an interrupted implementation: CHB-031 workstream **WS-B: open, strips and library** in the chromobench monorepo. The previous agent was stopped when the session restarted; its work is committed up to a checkpoint.

**Work ONLY inside this existing git worktree** (do not create a new one): `/home/manuel/code/wesen/chromobench/.claude/worktrees/agent-a54ed889dc45cb3f8` on branch `task/chb-031-open-strips` (last commit db1c5f7). Start every shell command with `cd /home/manuel/code/wesen/chromobench/.claude/worktrees/agent-a54ed889dc45cb3f8 && …` and use absolute paths inside it for file edits. Do not touch the main checkout or other worktrees.

Read first:
1. The common brief: /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/brief-common-v2.md (rules, checks, diary format, final reply; its \"Additions\" section matters).
2. The plan: `ttmp/2026/11/12/CHB-031--cosplay-session-02-findings-enlarger-real-mode-by-default-open-as-panels-strip-frames-leftovers/design-doc/01-plan.md` (section WS-B).
3. Your diary, which you continue: `ttmp/2026/11/12/CHB-031--…/diary/03-diary-ws-b-open-strips-and-library.md` — read all steps; Step 4 is the checkpoint with the resume list.
4. `git status` in the worktree: only untracked screenshots under the ticket's `various/` (synthetic fixtures — commit them if they belong to the diary, else delete).

Then finish WS-B from the resume list: frame-1 haze on strips (shared strip base/veil vs per frame), F22 (profile the ~29 s cold first open on a fresh profile and cut what can be cut; the visible progress UI is not yours — CHB-029), F10 on the CPU engine (a sharper preview without losing responsiveness; measure with CHB-027's `scripts/01-measure-responsiveness.mjs`), full checks (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `STUDIO_PORT=5321 STUDIO_KIT_PORT=5322 SHELL_DEMO_PORT=5323 GPU_PARITY_PORT=5324 CI=1 pnpm test:browser`), check off plan tasks odem 6wti jb0i 9t2y that are done, final report per the brief.

The user's instruction (verbatim): \"commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)\". Continue the same diary file with the next step number: investigation format from /home/manuel/.claude/skills/diary/references/investigation-entry.md, every section in every step; the first new step records the resume and quotes this prompt verbatim. Stage named paths only. Preview port 4811 if you run the app. Private test files: `~/Downloads/raw010.dng`, the NEFs in `~/Downloads/2026-11-11 - manfred test bilder/`, `/home/manuel/code/wesen/chromobench/.playwright-mcp/scans/` (read-only, tests skip when absent, never commit derived pixels). The owner's Mac is closed: do NOT use it; record GPU checks as pending. Parallel agents continue CHB-031 WS-A (enlarger defaults, controls, status-text, args.ts, first-print, contract) and CHB-032 (housekeeping); `cb.ts` is shared with WS-A — keep edits local."
**Assistant interpretation:** Pick up WS-B where the checkpoint left it, keep the same diary, finish the open items
(haze, F22, F10, e2e, checks) and report.
**Inferred user intent:** No work lost to the restart; the WS-B branch ends merge-ready with an honest record.
**Commit (code):** N/A (resume; the next commits record the hashes).

### What I did
- `git status` (only `various/ws-b/` untracked), `git log --oneline -8` (HEAD `db1c5f7`).
- Read the brief (incl. Additions), the plan, Steps 1–4, the diary skill and the investigation-entry format.
- Inspected `various/ws-b/f10-reference-exact.json` (complete) and `f10-reference-tabulated.json` (an error only);
  deleted the latter.
- `pnpm --filter @chromobench/studio build` (7.7 s; `dist` 7.7 MB: assets 3.5 MB, packs 4.2 MB, libraw.wasm 853 kB)
  and `pnpm --filter @chromobench/studio preview --port 4811 --strictPort` in the background.

### Why
- The resume list's first item is the exact-vs-tabulated measurement, which the restart interrupted.

### What worked
- The checkpoint is intact; the build and preview start.

### What didn't work
- The interrupted measurement: `f10-reference-tabulated.json` holds `"error": "page.waitForFunction: Target page,
  context or browser has been closed …"` (the restart killed the browser), no numbers.

### What I learned
- The exact run on this branch (`f10-reference-exact.json`, before the restart): open NEF 15.7 s to the result,
  drag Time (photo) 4.26 s to the final render (draft at 587 ms), typed 15 → 3.19 s; open raw010 13.9 s, drag
  (negative) 3.6 s, typed 15 → 3.66 s. CHB-027's after-numbers (`CHB-027 diary 03`, table "after"): open DNG 4.7 s,
  typed 15 (negative) 1.67 s — the strip frames are 5.4× more pixels now (Step 3), which shows in every negative
  step, not only the open.

### What was tricky to build
- N/A (resume).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- See Step 4's resume list; carried out in the next steps.

### Code review instructions
- N/A (no code in this step).

### Technical details
- Measurement output files go to `various/ws-b/` (numbers only; the private files are read in place).

## Step 6: F10 — the CPU engine previews through tables, exports stay exact

The resume list's first item: is the reference engine's `tabulated` mode (core's f64 N³ tables through the GPU's
trilinear lookup, CHB-005's parity reference) fast enough and close enough to become the default? Measured in the
built app with CHB-027's responsiveness script, it halves the photo steps and cuts the strip open five-fold: open
raw010 18.2 s → 3.6 s, typed 15 on the NEF 2.4 → 1.4 s. The picture: the NEF is identical to 0.5 of an 8-bit level
(max), a strip frame differs by 0.85 levels on average, 4.2 at most. That also removes Step 3's regression (the
strip working size had made the strip's open 15–18 s on the exact engine).

The GPU engine computes previews through tables and exports exactly (`packages/gpu/src/chain/run.ts`: `exact =
precision === 'export'`), so the CPU engine now does the same: `TabulatedPreviews` (in `host/engine-serve.ts`) holds
two RefEngines on the same sources, routes `precision: 'preview'` to the tabulated one and `'export'` to the exact one
(small cache). `?refMode=exact` keeps the old all-exact engine. Bigger working sizes for photos do not pay on the CPU
(see What I learned): 512 px stays for photos; the strip frames got their ≈ 512 px in Step 3.

### Prompt Context
**User prompt (verbatim):** see Step 5.
**Assistant interpretation:** F10 on the CPU engine: a sharper preview without losing responsiveness, measured.
**Inferred user intent:** The CPU fallback should feel no slower while strip frames stop looking like mosaics.
**Commit (code):** in the commit of this step and Step 7 ("CHB-031 WS-B: CPU previews through tables (exports exact); a strip's base from its frame gaps (F20 haze)")

### What I did
- Measured (`node ttmp/…/CHB-027…/scripts/01-measure-responsiveness.mjs --base http://localhost:4811 --engines
  reference [--query refMode=tabulated[&refLong=N]] --out various/ws-b/<name>.json`), files
  `f10-reference-tabulated.json`, `f10-reference-exact-run2.json` (back to back), `f10-reference-tabulated-768.json`,
  `f10-reference-tabulated-1024.json`.
- New `scripts/wsb-01-ref-mode-compare.mjs`: opens the NEF and raw010 in each mode, copies the first mode's print
  settings into the other's frames, compares the presented images pixel by pixel → `various/ws-b/f10-mode-compare.json`.
- `apps/studio/src/host/engine-serve.ts`: `TabulatedPreviews`, `referenceEngine(o)`, `RefLike`; the worker builds
  its engine with `referenceEngine` (`InitJob.mode` default `exact`, so CHB-027's worker test is unchanged).
- `apps/studio/src/host/engines.ts`: `DEFAULT_REF_MODE = 'tabulated'`, the main-thread fallback through
  `referenceEngine`, label `reference · CPU f64 (tabulated previews, exact export) (worker) · 512 px`.
- `apps/studio/test/ref-tabulated.test.ts` (4 tests): previews = a tabulated RefEngine's pixels, exports = an exact
  one's (and they differ, by < 0.05); measurements by precision; `forgetSource` on both; through the worker.

### Why
- Tabulated is what a GPU user sees in a preview, so the CPU preview now matches it; exports keep the exact physics,
  as on the GPU. A single all-tabulated engine would have made the CPU export differ from the GPU's.

### What worked
- Back-to-back runs (load average 1–4), result ms: | step | exact | tabulated |
  open NEF 16596 | 8250; drag Time (photo, to final) 3368 | 2011; typed 15 (photo) 2443 | 1429; open raw010 18210 |
  3643; drag (negative) 3121 | 2607; typed 15 (negative) 2609 | 1650. No stall over 100 ms in any drag; first draft
  219–366 ms.
- Picture: `{"file":"nef","samePrint":{"meanAbs8":0.053,"p99Abs8":0.25,"maxAbs8":0.5}}`,
  `{"file":"dng","samePrint":{"meanAbs8":0.854,"p99Abs8":3.67,"maxAbs8":4.17,"over2":0.2162}}`; first prints equal
  (time 10 s / 2.227 s; printer lights differ by ≤ 0.002 logH).
- `npx vitest run apps/studio/test/ref-tabulated.test.ts apps/studio/test/worker-engine.test.ts`: 8 passed.

### What didn't work
- A third back-to-back set (new default at 512, 640, exact) ran while other agents' browser suites loaded the machine
  (load average 12.7 → 20): open NEF 27 s on the *faster* engine. Stopped and discarded (`pkill -f
  01-measure-responsiveness.mjs` also killed the loop's shell: exit 144); timings only from quiet runs.
- First `forgetSource` test expected an evaluation to fail with E_NO_SOURCE; `adopt` already throws it (the graph has
  no source after forgetting). The test now checks both graphs and the throw.

### What I learned
- Larger working sizes on the CPU cost on every change, not only on open: sampled previews compute the shown pixels,
  so a print-only change scales with min(working px, screen px). Tabulated at 768 px: open NEF 19.5 s, typed 15 4.3 s,
  drag final 3.7 s (vs exact at 512: 16.6 / 2.4 / 3.4 s); at 1024 (screen 896 × 599): typed 15 7.6 s. So 768+ loses
  responsiveness against the old baseline; the photo stays at 512. Strip frames got their larger size (Step 3) and
  now open faster than session 02's blocky ones took (3.6 s vs 2.6 s at a fifth of the pixels).
- The photo's open is mostly fixed costs (LibRaw, forward path spatial stages: couple, halation, grain, not tabulated).

### What was tricky to build
- Two engines on one source: `openDecoded` copies the pixels into each (≈ 2× 4 MB at 512 px; 2× 15 MB for a strip)
  and `adopt`/`forgetSource` must reach both, or an export after a re-open would read a forgotten source. The exact
  engine gets `cacheLimit: 8` and ≤ 256 MB: an export runs at full resolution once.

### What warrants a second pair of eyes
- An export on the CPU no longer reuses the preview's cached negative stages (they were exact before); the export
  recomputes them exactly (≈ the old first render: 10–15 s for a strip frame). Exports show progress; acceptable?
- The engine label changed (WS-A owns the wording around it; `engineSummary` only reads `^reference`).

### What should be done in the future
- A refine pass at a larger working size for the shown region (CHB-026 F10's 1:1 focus check) needs a second decode
  at full size; not in this workstream.
- GPU checks pending (the owner's Mac is closed): the GPU engine is unchanged, so nothing GPU-specific changed here.

### Code review instructions
- `apps/studio/src/host/engine-serve.ts` `TabulatedPreviews`, `referenceEngine`; `engines.ts` `DEFAULT_REF_MODE`.
- `npx vitest run apps/studio/test/ref-tabulated.test.ts`; in the built app `?engine=reference` vs
  `?engine=reference&refMode=exact`.

### Technical details
- Contract: `EvalTarget.precision` ('preview' | 'export'), `MeasureSpec.precision`; the export runner
  (`packages/output/src/export/run.ts`) asks 'export'; first print, renders and the densitometer ask 'preview'.

## Step 7: F20 haze — raw010's "film edge" lay on its thin first frame; a strip's base from its frame gaps

Frame 1 of raw010 (a dim hallway, an EXIT sign, a figure against a window) prints flat and bluish. I measured the
strip in Node (numbers only, scratchpad scripts): frame 1 is an underexposed negative — p99 density above base
0.38/0.39/0.17 D (R/G/B) against 0.52–0.64 for frames 2–3, its blue range only 0.20 D. That is the haze: the
negative's. But two numbers were wrong: 1 % of frame 1's pixels read *thinner than the base* (−0.068 D red), and the
rebate box the layout found (`x 196, y 22, 18 × 150` at 232 × 512) lies inside frame 1's box (`x 8, y 16, 209 ×
143`). Column profiles show why: the film's gaps between frames read T ≈ 0.90 (red) right across, there is no edge
rebate on this strip (the frames span the film; holder from x ≈ 220), and the "rebate" was the thin right wall of
frame 1 (T 0.75). Every frame of the strip shared that base: 0.076/0.069/0.032 D too dense.

The same happens on a synthetic strip: ingest's `plantedFrames({ dark: [0] })` (an underexposed first frame) puts
the layout's rebate box at `x 125, y 20, 59 × 29`, inside frame 1, T 0.387 vs the planted 0.481. So `decodeScan`
now reads a split strip's base on the gaps between its frames (`gapBase`: the unexposed film between neighbouring
frames, across the frames' band, inset; per-channel median) when the film edge found lies on a frame (> 25 % of its
box) or none was found; `scan.rebate` becomes the largest gap and the roll's entry gets the corrected base. raw010's
frame 1 then prints with printer lights +3/0/−6 pt instead of 0/−2/−7 (a little less blue); it stays flat because
the negative is: the remedy is the photographer's (a harder print or a lighter scan), not a shared-vs-per-frame base.
A per-frame veil does not matter either: the veil is 0.3 % of frame 1's signal (local 2.1e-3 vs strip 1.3e-3 red).

### Prompt Context
**User prompt (verbatim):** see Step 5.
**Assistant interpretation:** Find out why frame 1 is hazy and bluish; fix what is a defect.
**Inferred user intent:** Strip frames print like the frames they are.
**Commit (code):** with Step 6 (same commit).

### What I did
- Scratchpad scripts (private numbers, not committed): `haze-numbers.ts` (decode as `decodeScan`, condition the
  whole strip, per frame: density percentiles and the base/veil `filmLayout` reads around it), `cols.ts` (mean red T
  per column for each frame's rows and the gaps), `dump-strip.ts` (the strip as a picture, scratchpad only),
  `plant-test.ts` (where the layout's rebate lands on planted strips with a dense film edge or a thin first frame).
- `apps/studio/src/host/decode.ts`: `gapBase(rgb, w, boxes, axis)`, `overlap`, the gap base in `decodeScan` with
  the note `base … D from the gaps between frames (N px): the film edge found lay on a frame (base … D there)`.
- `apps/studio/test/strip-working-size.test.ts`: gapBase on planted strips (both axes: the planted base within
  0.01 D, the box on no frame, null without a gap); decodeScan of a strip with a thin first frame (base from the
  gaps, within 0.01 D of the planted one; `scan.rebate` on no frame; the roll's base); a normal strip unchanged.
- Rebuilt and opened raw010 in the app (`wsd-01-strip-open.mjs … gap`, screenshots in the scratchpad only).

### Why
- The gaps are unexposed film beside every frame of the strip, found by `stripFrames` as the strip's thinnest
  across-the-band rows: the most direct base on a strip. Only used when the edge is suspect, so strips whose film
  edge was read correctly keep WS-D's behaviour.

### What worked
- raw010 numbers: rebate near frame 1 T 0.7548/0.3846/0.1936; gaps T ≈ 0.90/0.45/0.21 (rebate read around frames 2
  and 3: 0.9145/0.4509/0.2082). In the app: frame times 2.227/2.806/3.15 s (were 2.227/2.5/2.806), frame 1's lights
  +3/0/−6 pt (were 0/−2/−7); frames 2 and 3 look as before, slightly less cool.
- `npx vitest run apps/studio/test/strip-working-size.test.ts`: 5 passed; `pnpm typecheck` clean; `pnpm lint` ok;
  `npx vitest run apps/studio packages/studio-kit`: 20 files, 217 passed.

### What didn't work
- My first idea, NLP's conversion `2025-08-09_raw010-positive.tif` as a reference for frame 1: it is another picture
  (a car by a fence, 1483 × 1073): the `raw010.dng` in Downloads is not the scans folder's raw010.

### What I learned
- The haze is the negative (underexposed, thin, low blue range), not the strip's shared base or veil.
- `filmLayout` takes a thin frame's flat area for the rebate when a strip has no edge rebate in view; this affects
  single frames too (no gaps to fall back on there) — an ingest question for later.

### What was tricky to build
- The base as the recipe wants it: `scan.baseT` is the *scanned* base (`conditionScan`'s `scanBaseT = T / (1 −
  veil)`, `T = Traw − veil`); the gaps are read veil-in (`data` is not veil-subtracted, `subtract: false`), so the
  same two steps apply. The gap base is read before the strip is re-sampled (Step 3), and `rebate` (now a gap box)
  scales with the boxes.

### What warrants a second pair of eyes
- The 25 % overlap threshold and "no rebate found → gaps": strips with a real edge rebate keep it.
- The status line still says "film edge found" for raw010 (status-text reads the first base note); WS-A's file.

### What should be done in the future
- Single frames with a thin image at the edge can get the same wrong base (no gaps): ingest's `filmLayout` could
  reject a rebate candidate whose texture or position says image. A per-frame base along a strip (scanner light
  falloff) was not needed on raw010 (gaps all ≈ 0.90).

### Code review instructions
- `apps/studio/src/host/decode.ts` `gapBase` and the block after `stripFrames` in `decodeScan`.
- `npx vitest run apps/studio/test/strip-working-size.test.ts`

### Technical details
- raw010 at 232 × 512: frames `{x 8, y 16, 209 × 143}`, `{8, 182, 209 × 145}`, `{8, 348, 209 × 145}`; density
  percentiles vs the old base — frame 1 p1 −0.068/−0.061/−0.026, p50 0.088/0.081/0.022, p99 0.381/0.385/0.170;
  frame 2 p99 0.517/0.640/0.413; frame 3 p99 0.420/0.527/0.586.

## Step 8: Merge of main (WS-A: real enlarger mode by default)

The orchestrator merged WS-A into main (`e7df8a0`: real enlarger mode by default, contract 0.4.0, normalised as a
layout option) and asked me to merge main before my final commit. I committed Steps 6–7 first (`04c0eb7`), then
merged. One conflict: the `Studio` constructor, where WS-A wraps `o.initial` in `initialInMode` and I pass `known`
to `Frames`; both kept. The variant snapshots auto-merged; `-u` changed nothing, and the diff against main is exactly
my four commands and their counts. `pnpm gen` changed nothing.

### Prompt Context
**User prompt (verbatim):** see Step 5. Orchestrator (verbatim): "Orchestrator: CHB-031 WS-A is merged into main (e7df8a0): real enlarger mode by default (contract 0.4.0, decision CC-017), normalised as a layout option (simple, tiny) with Time/Aperture hidden, Lighter/Darker = ⅓ stop of time in real mode, F19/F23/F8/F9 changes, view tabs renamed (\"No mask\", \"Clipping\"), new e2e/studio-enlarger.spec.ts. Before your final commit, `git merge main` into task/chb-031-open-strips (in your worktree) and resolve: expected conflicts in packages/studio-kit/test/__snapshots__/variants.test.ts.snap — regenerate with `npx vitest run packages/studio-kit/test/variants.test.ts -u` and read the diff instead of hand-merging; generated docs — regenerate with `pnpm gen`; cb.ts hunks should not overlap. Note: in real mode the first print sets the time, so strip-frame first prints now set Time per frame (check your strip tests still hold). Then run the full checks including the browser suite on your ports."
**Assistant interpretation:** Merge main now, resolve by regenerating, re-run the checks.
**Inferred user intent:** WS-B lands on top of WS-A without surprises.
**Commit (code):** `4baace6` — "Merge main (CHB-031 WS-A) into task/chb-031-open-strips"

### What I did
- `git merge main --no-edit` → `CONFLICT (content): Merge conflict in packages/studio-kit/src/studio.ts`; resolved
  to `this.initial = o.enlarger ? initialInMode(o.initial, o.enlarger) : o.initial;` and `new Frames(…, known: sha =>
  this.libraryKind(sha))`.
- `npx vitest run packages/studio-kit/test/variants.test.ts -u` (9 passed, no file change); `git diff main --
  …variants.test.ts.snap`: `+ frame.rotateRight`, `+ frame.rotateLeft`, `+ frame.flip`, `+ file.openAs.keep` in
  each of 8 variants, command counts +4. `pnpm gen`: no change.
- `pnpm typecheck` clean, `pnpm lint` ok, `pnpm test`: 100 files, 2767 passed, 7 skipped.

### Why
- The orchestrator merges A then B; merging main here moves the conflicts to the branch that knows both sides.

### What worked
- The whole unit suite after the merge (strip tests included: their first prints now set Time per frame).

### What didn't work
- No failures beyond the expected conflict.

### What I learned
- `cb.ts` merged without overlap, as planned.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- `studio.ts` constructor: both changes on one line each.

### What should be done in the future
- N/A.

### Code review instructions
- `git show 4baace6 -- packages/studio-kit/src/studio.ts`

### Technical details
- Merge base `9d10010`; main at `e2af842`.

## Step 9: F22 — the cold first open: an idle-callback spin, and a full-size demosaic for a 640 px picture

I profiled the tester's path (`scripts/wsb-02-cold-open.mjs`: a fresh persistent profile, service worker on, no
WebGPU flags, the NEF set on `#file` as soon as the studio is ready; then a warm second start of the same profile;
optional Chrome trace summarised by event name). Two things stood out; the classic suspects did not. The data packs
(4.2 MB) load in ≈ 0.2 s, twice (page and worker) in parallel before "ready"; libraw.wasm is fetched in 13–35 ms and
its instantiation takes ≈ 13 ms; the service worker's precache costs nothing visible; cold and warm differ by < 1 s
now.

First, the render queue spun the main thread. In the trace of one open: `CrRendererMain | FireIdleCallback` 118 589
calls (2.9 s) and `AsyncTask Run` 119 113 (3.3 s). A background render (navigator, thumbnails) waiting for live work
re-queued itself from an idle callback; while the engine worker computed, the main thread was idle, so it ran
≈ 10 000 times a second — a core spinning against the worker for the length of every live render (on a two-core
laptop, half the machine). The queue already lets waiting background slots go when live work ends (`after()`), so the
polling is gone (`packages/shell/src/app/render/queue.ts`; `cancel()` releases them too). After: `AsyncTask Run` 548
calls, no `FireIdleCallback` among the top 40. Second, a photo for the CPU engine's working image was read through
LibRaw's AHD demosaic at full size (24 MP) and then area-averaged to 512–640 px: in Node 5.0 s decode + 0.4 s
linearise/resample; read binned (2 × 2 Bayer photosites a pixel, raw camera colour, as scan mode reads negatives)
2.1 s + 0.1 s with channel means within 0.04 %. `decodePhoto` now reads camera RAW binned for working sizes up to 1024
px (falls back to the demosaic when the bins are smaller than the working size; the GPU's 4000 px reads the demosaic).

### Prompt Context
**User prompt (verbatim):** see Step 5.
**Assistant interpretation:** Profile the ~29 s cold first open and cut what can be cut (not the progress UI).
**Inferred user intent:** The first picture comes quickly, also on a fresh browser.
**Commit (code):** with Step 10 ("CHB-031 WS-B: F22 render queue spin, binned RAW photos for the CPU engine; F10 640 px")

### What I did
- `ttmp/…/CHB-031…/scripts/wsb-02-cold-open.mjs` (cold/warm runs, status timeline on the page clock, resource
  timings of page and engine worker, optional trace summary); results in `various/ws-b/f22/`.
- `packages/shell/src/app/render/queue.ts`: `pump()` returns for a background slot while live work is busy (no idle
  re-queue); the one idle deferral kept for `preemptBackground` when nothing is live; `releaseBackground()` from
  `after()` and from `cancel()` when nothing was in flight. Test `render-queue.test.ts` "a background render waiting
  for live work does not poll idle callbacks" (0 idle calls; it goes when live work resolves or is cancelled).
- `apps/studio/src/host/decode.ts`: `BINNED_PHOTO_MAX_LONG = 1024`, `decodePhoto` reads `{ mode: 'scan', bin:
  'cfa-half' }` for camera RAW at small working sizes; the note names the sensor size first ("photo mode,
  6032×4032, read binned 3016×2016 (2 × 2 photosites a pixel)"), so the status line still says 24 MP; `full` is the
  sensor size. Test `apps/studio/test/photo-binned.test.ts` (synthetic CFA DNG: channel means of the working image
  within 1 % of the AHD path, mean relative pixel difference < 3 %; demosaic when the bins are too small or for long 0).
- Scratchpad (private, not committed): `libraw-time.ts`, `photo-half.ts` (Node timings on the D750 NEF).

### Why
- The spin is pure waste and scales with render time, so it was worst exactly on the slow CPU path the tester used.
- The demosaic computes 24 MP of interpolation that the 640 px working image averages away.

### What worked
- Cold open of the NEF, open → first screen render (page clock): before the fixes (tabulated, 512 px, load average
  ≈ 14) 11.1 s cold / 27.7 s warm — the load made the warm run meaningless; queue fix (load ≈ 2) 11.5 s cold / 8.2 s
  warm; final (queue fix, binned, 640 px tabulated; load ≈ 2) 7.9 and 8.6 s cold / 7.9 and 7.5 s warm, frame present
  after 3.7–4.5 s (was 7.8 s). Session 02's tester: 29 s cold, 10–12 s warm (main `3703d0a`, exact, 512 px).
- `npx vitest run apps/studio packages/shell packages/studio-kit`: 33 files, 341 passed.

### What didn't work
- `chromium.launchPersistentContext` + `browser.startTracing` wrote 335–388 MB traces per run; summarised and deleted.
- An exact-512 cold run (one sample, `?refMode=exact&refLong=512`) reached the first render in 6.2 s, faster than
  the 640 px default's 7.9–8.6 s: the first render of a photo at 640 px pays the larger forward-path stages (capture,
  halation, grain are not tabulated) and the first table builds. One sample on a shared machine; recorded as is.

### What I learned
- Cold vs warm is no longer the story (< 1 s apart); the first open is decode + first print + first render.
- The machine is shared with other agents' browser suites: load averages of 12–20 made timings swing 2–3× within
  minutes. Only runs at load ≈ 1.5–2.5 are used, and several samples where it matters (Step 10).

### What was tricky to build
- The queue's deferral had two jobs: wait for live work (now `after()`/`cancel()`), and let a live request of the same
  frame reach the engine first under `preemptBackground` (kept: one idle deferral when nothing is live, which
  `later = true` ends). A slot cancelled while only waiting has nothing in flight, so no `after()` follows: `cancel()`
  releases background slots itself.
- Binning factor for the note: Bayer 2, X-Trans `cfa-half` 3 (`scanMode`), from `raw.meta.cfa`.

### What warrants a second pair of eyes
- `packages/shell/src/app/render/queue.ts` is shared runtime code outside the plan's WS-B list (small, local, tested).
- Binned photos: AHD vs 2 × 2 bins differ at edges (sub-pixel channel offset), invisible at 640 px; colour and level
  identical by construction (same raw camera RGB, unit multipliers). The GPU path is unchanged (4000 px > 1024).

### What should be done in the future
- The visible progress during the open is CHB-029's (item 6).
- The packs are parsed twice (page and worker, ≈ 0.2 s each, before "ready"); not on the open path, left as is.
- GPU checks pending (the owner's Mac is closed); the GPU engine path is unchanged except the queue fix.

### Code review instructions
- `packages/shell/src/app/render/queue.ts` `pump`, `after`, `releaseBackground`, `cancel`;
  `apps/studio/src/host/decode.ts` `decodePhoto`.
- `npx vitest run packages/shell/test/app/render-queue.test.ts apps/studio/test/photo-binned.test.ts`;
  `node ttmp/…/scripts/wsb-02-cold-open.mjs --profile <scratch dir> [--trace <dir>]` against a preview on 4811.

### Technical details
- Trace summary rows (cold, before → after the queue fix): `CrRendererMain | FireIdleCallback` 2913 ms / 118 589
  → absent; `CrRendererMain | AsyncTask Run` 3349 ms / 119 113 → 117 ms / 548; `DedicatedWorker thread |
  MessagePort::Accept` 4218 → 3650 ms.
- Node, D750 NEF 6032 × 4032: photo (AHD) decode 5019 ms, linearise + region 421 ms; binned 3016 × 2016: 2090 ms, 99
  ms; channel mean ratios 0.9999 / 1.0004 / 0.9997.

## Step 10: F10 settled — 640 px on the CPU engine, measured against the old exact 512 px

With previews through tables (Step 6), the queue spin gone and photos read binned (Step 9), the CPU engine had
headroom. The plan asks for a sharper preview without losing responsiveness, so the yardstick is the engine as it
was (exact, 512 px). I ran CHB-027's responsiveness script in a quiet window, interleaved: the new default at 640 px
(7 samples), tabulated at 512 px (2 + 2 earlier) and exact at 512 px (4). Medians: 640 px tabulated is faster than
exact 512 px on every step and 25 % sharper; tabulated 512 px is faster still, but the photographer asked for focus.
`DEFAULT_REF_LONG` is now 640 (strip frames follow: ≈ 432 × 639 each).

### Prompt Context
**User prompt (verbatim):** see Step 5.
**Assistant interpretation:** Choose the CPU working size from measurements, not by guess.
**Inferred user intent:** A sharper picture that answers no slower than before.
**Commit (code):** with Step 9 (same commit).

### What I did
- `apps/studio/src/host/engines.ts`: `DEFAULT_REF_LONG = 640` and its doc; `main.ts` URL-options comment;
  `apps/studio/DEMO.md` (640 px, strip frames about as much).
- Measurements in `various/ws-b/`: `f10-final-*.json`, `f10-ab/*.json` (file names say the configuration: the
  `default640-b*`/`-c*` runs were meant as 512/exact but zsh passed `${q:+--query $q}` as one word, so they are more
  samples of the default; the `tabulated512-*`/`exact512-*` runs pass `--query "$q"` correctly).

### Why
- Medians over several samples, because single runs on this machine swing 2×.

### What worked
- Medians (result ms; 640 tabulated n = 7 | tabulated 512 n = 2–4 | exact 512 n = 4):
  open NEF 7700 | 5400–9700 | ≈ 9500; drag Time (photo, to final) 2580 | 1850–5280 | ≈ 3600; typed 15 (photo) 1460 |
  850–1190 | 1700; open raw010 4500 | 2700–4100 | ≈ 12 500; drag (negative) 3060 | 2000–2050 | ≈ 3400; typed 15
  (negative) 1470 | 950–2490 | ≈ 2000. First drafts 120–780 ms; no stall over 100 ms in any drag.

### What didn't work
- See "What I learned" in Step 9 about load; and the zsh quoting slip above (caught by the sizes in the table:
  640 × 428 where 512 × 342 was meant).

### What I learned
- A print-only change costs ∝ the shown pixels (sampled previews), so 640 px is ≈ 1.6× tabulated 512 px; the tables'
  2× buy that back against the old exact engine.

### What was tricky to build
- N/A (a constant), but choosing it needed the interleaved runs.

### What warrants a second pair of eyes
- On a much slower laptop all of this scales; `?refLong=512` remains for speed, `?refLong=1024` for focus.

### What should be done in the future
- A true 1:1 focus check on the CPU needs a full-size decode of the shown region (CHB-026 F10's suggestion): open.

### Code review instructions
- `engines.ts` `DEFAULT_REF_LONG`; numbers in `various/ws-b/f10-ab/`.

### Technical details
- Sizes: photo 640 × 428 (draft 160 × 107); strip frame 432 × 639 (draft 108 × 160).
