---
Title: Diary WS-D strip frames
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
    - Path: /home/manuel/code/wesen/chromobench/packages/ingest/src/conditioning/strip-frames.ts
      Note: stripFrames, the inter-frame gap search (WS-D step 1)
    - Path: /home/manuel/code/wesen/chromobench/packages/ingest/src/conditioning/planted-frames.ts
      Note: Synthetic multi-frame strips with planted truth
    - Path: /home/manuel/code/wesen/chromobench/packages/ingest/test/strip-frames.test.ts
      Note: Planted strips and the photographer's scans (skipped when absent)
ExternalSources: []
Summary: "WS-D of CHB-027: a scan of a strip of film opens as one frame per frame on the strip (F16)."
LastUpdated: 2026-11-12T15:38:36.451240464-05:00
WhatFor: "The record of WS-D's implementation, failures and measurements."
WhenToUse: "Reviewing or merging task/chb-027-strip-frames."
---

# Diary: WS-D strip frames

Workstream D of CHB-027 (finding F16), on branch `task/chb-027-strip-frames` in its own worktree, after WS-A's
merge (365ce53).

## Step 1: Brief, plan, F16 and WS-A's frame identity

I read the common brief, the plan's WS-D section and ownership table, F16 in the CHB-026 findings and WS-A's diary
(steps 3, 6, 7), then the code the work touches: ingest's `filmLayout`, `conditionScan`, the host's `decodeScan`,
`StudioEngine.openAs`, studio-kit's `Frames` / `Studio` and the open flow in `main.ts`. The decision that shapes the
rest: each strip frame is the same source (the whole strip, one sha) with its own recipe whose `view.frame.crop` is
its box — no contract change, and the strip's base and veil are shared by construction.

### Prompt Context
**User prompt (verbatim):**

> You are implementing CHB-027 workstream **WS-D: strips into frames** (finding F16): a scan holding several frames of film (the real test file `~/Downloads/raw010.dng`: a vertical strip of THREE colour-negative frames, 1672×3695, 16-bit DNG, with film edge/rebate along the sides and gaps between frames) currently opens and prints as ONE image. It should open as several frames.
>
> First read the common brief: /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/chb027-brief-common.md — rules, checks, diary format, final-reply format. Then the plan's "WS-D" section (path in the brief), finding F16 in the CHB-026 findings, and WS-A's diary (`…/CHB-027--…/diary/02-diary-ws-a-open-mode-and-library.md`, step 7 especially) because WS-A (merged into main at 365ce53) just changed frame identity: frames are keyed by (sha, mode) with id `frame_<sha8>`, edit logs keyed by (sha, mode), catalog entries carry `kind` and `thumb`, Frame ▸ Re-open as…, Remove from Library.
>
> Your specifics:
> - Branch: `task/chb-027-strip-frames` (create it in your worktree first; `pnpm install --offline` if node_modules is missing).
> - Diary file (exists): `ttmp/2026/11/12/CHB-027--fix-cosplay-session-01-findings-open-mode-responsiveness-library-wording-strips/diary/05-diary-ws-d-strip-frames.md` — the diary skill's investigation format exactly (read /home/manuel/.claude/skills/diary/SKILL.md and references/investigation-entry.md; every step has all sections; Step 1 quotes this prompt verbatim). Write steps as you go and commit them with the code.
> - Screenshots folder: `…/CHB-027--…/various/ws-d/` (synthetic fixtures only; private-photo screenshots stay out of the repo).
> - Ports: preview 5011; browser tests STUDIO_PORT=5021 STUDIO_KIT_PORT=5022 SHELL_DEMO_PORT=5023 GPU_PARITY_PORT=5024.
> - Add your plan task: `docmgr task check --ticket CHB-027 --id iqvp` when done.
>
> Work:
> 1. Detection in ingest, next to `filmLayout` (packages/ingest/src/conditioning/film-layout.ts finds ONE image area): find inter-frame gaps along the strip's long axis in density (gaps read near base density across the image width; the rebate runs along the edges) and return frame boxes (input pixels) with a confidence. Unit tests on synthetic strips (1, 2, 3, 6 frames; horizontal and vertical; uneven exposure; a dark frame that is nearly base density must not be split), plus a local test on raw010.dng that skips when the file is absent (expect 3 boxes).
> 2. Studio: opening a negative scan whose layout finds ≥2 frames opens one frame per box — same file and sha, identity (sha, mode, index), each frame cropped to its box (contract 0.3 `view.frame.crop` or `scan` crop — read packages/contract to choose; if a contract change is needed write it to CONTRACT-REQUESTS.md and work around it), its own edit log and catalog entry and thumbnail. A single-frame file stays exactly as today (no index suffix in ids, so existing saved logs still resume). The roll base / veil comes from the whole strip and is shared by its frames. Re-open as / Remove act per frame sensibly (removing one frame of a strip keeps the others).
> 3. Check with the real file (local script, headless Playwright, `import { chromium } from '@playwright/test'`): raw010.dng opens as 3 frames, each prints as a sensible positive (auto first print), with the probe showing no main-thread regression. Record numbers in the diary.
>
> Note: WS-B (responsiveness) is still running on its own branch and is moving decode + conditioning into a worker in `apps/studio/src/host/` (`engine-serve.ts`, `engine-worker.ts`); keep your detection a pure ingest function the worker can call and your engines.ts edits small, so the merge is easy.

**Assistant interpretation:** Detect frames on a strip in ingest; open one studio frame per detected frame (crop,
own log, catalog entry, thumbnail); keep single-frame files unchanged; check on raw010.dng in the built app.
**Inferred user intent:** The photographer's strip scans become three printable frames instead of one image with
rebate and gaps (F16), without breaking WS-A's identity rules or WS-B's coming worker.
**Commit (code):** N/A (reading).

### What I did
- `git checkout -b task/chb-027-strip-frames`; `pnpm install --offline` (node_modules was missing; done in < 1 s).
- Read `packages/ingest/src/conditioning/film-layout.ts` (one crop: the longest run of exposed rows/columns),
  `roll-base.ts` (`conditionScan`), `apps/studio/src/host/engines.ts` (`decodeScan`), `host/studio-engine.ts`
  (`openAs`, `notes` per sha, `forget`), `host/first-print.ts` (`measureExposure`: the central 80 % of the whole
  source), `packages/studio-kit/src/bridge/frames.ts` (`load`, `logKey`, `remove`, `reopen`), `studio.ts`
  (`catalogue`), `main.ts` (`openFiles`, `scheduleThumb`, `relink`), `packages/contract/src/recipe.ts`
  (`FrameSettings`), `paths.ts` (`defaultRecipe(…, { frame })`).
- Looked at raw010 decoded (scan mode, 232×512 working image, preview in the scratchpad only): a vertical strip of
  three landscape 645 frames, holder black along both long edges, leader at the top, a 2-row sliver of a fourth
  frame at the bottom; frame 1 is a very thin (dark-scene) negative.
- Row profile (scratchpad `wsd/profile.mjs`: per row, the share of the middle 60 % within 0.06 D of the rebate):
  gaps at rows 162–178, 330–344, 496–508 read 1.00 at −0.03 D (thinner than the layout's rebate box); leader 0–12;
  **inside frame 1, rows 153–156 read 0.94–0.96** (a false gap in the dark frame).

### Why
- `view.frame.crop` (contract 0.3, `output.frame`, applied last) needs no contract change, keeps one source per
  file (the engines register sources by sha; WS-A's `forgetSource` assumes one decode per sha), and the strip's
  conditioning (base `scan.baseT`, veil `scan.flare`, rebate box) is measured once on the whole strip and copied
  into every frame's recipe by `withMeasured`: shared by construction. A per-frame sub-source would need new source
  identities (`sha#n`) the contract does not have.

### What worked
- The profile shows the gaps cleanly; the false gap in frame 1 is short and less clean, so a length rule can reject it.

### What didn't work
- My first `git checkout -b … && …` compound command was refused by the worktree guard; plain separate commands work.

### What I learned
- `firstPrint` measures the central 80 % of the *source*, not of the crop: a strip frame would be printed for the
  whole strip's average unless `measureExposure` reads the recipe's crop.
- `Frames.remove` drops the file's reader (`readers.delete(sha)`): with several frames per sha that must wait for
  the last frame.

### What was tricky to build
- N/A (reading).

### What warrants a second pair of eyes
- Recipe coordinates (crop, rebate) are working-image pixels, which differ between the GPU (4000 px) and the
  reference engine (512 px). That is true of every saved coordinate today; the strip crop inherits it.

### What should be done in the future
- N/A.

### Code review instructions
- N/A (reading).

### Technical details
- raw010 at 512: frames rows 13–161, 179–329, 345–495; across, the holder takes ~4–6 px each side.

## Step 2: `stripFrames` in ingest, synthetic strips, and the photographer's other scans

`packages/ingest/src/conditioning/strip-frames.ts` finds the frames on a strip: base from the layout's rebate,
the film across (not holder), the share of the middle 60 % of the film near the gaps' level per position along,
separator runs (≥ 0.9), and then the subset of separators whose segments make the most frames of one length (an
inner segment shorter than 0.45 × the film's width is impossible; end slivers are dropped). It returns boxes in
input pixels with a confidence and a `split` flag (≥ 2 frames, confidence ≥ 0.5). 34 tests pass: planted strips of
1/2/3/6 frames of 120 and 135 film, both axes, uneven exposure, dark frames with and without a base band, noise, no
holder, CHB-020's single planted frame, and the photographer's nine scans (the coordinator's message below).

### Prompt Context
**User prompt (verbatim):** see Step 1. Coordinator message (verbatim): "Orchestrator: more real scans are available locally for WS-D (private: read-only, tests skip when absent, never commit pixels or copies). In /home/manuel/code/wesen/chromobench/.playwright-mcp/scans/ (absolute path; your worktree doesn't have it): all Epson Perfection V600 via VueScan, "Linear Raw" 16-bit DNGs — - 2025-08-09_raw000.dng 1608×3638, _raw004.dng 1664×3643, _raw013.dng 1672×3635 (strips like raw010, likely 3 frames), _raw007.dng 1672×2457 (likely 2 frames); - 2025-10-07_roll-102_raw000.dng 3632×2773, _raw001.dng 3656×2893 (landscape; layout unknown — maybe a 35 mm strip horizontally or medium format); - 2024-12-07_raw0001.dng 3112×4986 (layout unknown); - reference conversions by Negative Lab Pro v3.0.2 (ProPhoto RGB, 16-bit): 2025-08-09_raw000/004/007/010/013-positive.tif — each is ONE frame (~1470×1050 or ~1060×1480), so they show which frame of the strip the photographer converted and its orientation. Useful to check your frame boxes (aspect ratio and position) — and, later, our colour against NLP's. - 2024-10-05_2024-10-05-0001.tif is an 8-bit greyscale scan (likely black-and-white film; out of scope — B&W is parked — but your detection must not crash on it). Please add a local (skipping) test over these and report the detected frame counts per file in your diary."
**Assistant interpretation:** Item 1 of the work, plus a skipping test over the extra scans with counts recorded.
**Inferred user intent:** A detector that holds on the photographer's real strips, not only on raw010.
**Commit (code):** see the commit after this step ("CHB-027 WS-D: stripFrames …"; hash in Step 3).

### What I did
- `strip-frames.ts`: `stripFrames(rgb, w, h, { layout?, long?, stride?, nearD? })` → `{ axis, frames: {box,
  confidence}[], confidence, split, notes }`; `STRIP_MIN_CONFIDENCE = 0.5`. Pure, on a ≤ 512 px working copy;
  takes `conditionScan`'s layout so the host does not measure twice (WS-B's worker can call it as is).
- `planted-frames.ts`: `plantedFrames({ frames, film: '120'|'135', axis, exposureD, dark, darkBand, leaderMm,
  holder, sigma })` with truth boxes (exported, for tests and an e2e fixture).
- `packages/ingest/test/strip-frames.test.ts` (34 tests); exports in `packages/ingest/src/index.ts`.
- Scratchpad scripts (not committed): `wsd/dump.mjs`, `wsd/profile.mjs`, `wsd/detect.mjs` (detection with box
  previews; the previews of private scans stay in the scratchpad).

### Why
- Gaps near base across the middle of the film, because the rebate (also at base) runs along the edges and the
  holder is black: the middle 60 % of the film's width is inside the image on 135 (frame 24 of 35 mm) and 120.
- A global choice of separators instead of thresholds alone: a dark frame has rows at base right across (raw010's
  frame 1, rows 153–156); only the frame-length structure tells them from gaps.

### What worked
- `npx vitest run packages/ingest/test/strip-frames.test.ts` → 34 passed (16.9 s, most of it decoding the scans).
- Detected on the photographer's scans (`LONG=4000 node …/wsd/detect.mjs …`, the GPU engine's working size):

| File | Size | Frames | Confidence | Boxes (px) | Aspect | Layout / strip ms |
|---|---|---|---|---|---|---|
| raw010.dng | 1672×3695 | **3** | 1 | 1565×1075 at y 94, 1300, 2498 | 1.45–1.46 | 171 / 62 |
| 2025-08-09_raw000.dng | 1608×3638 | **3** | 1 | 1569×1086 at y 93, 1287, 2480 | 1.44 | 169 / 59 |
| 2025-08-09_raw004.dng | 1664×3643 | **3** | 1 | 1557×1080–1088 | 1.43–1.44 | 239 / 67 |
| 2025-08-09_raw013.dng | 1672×3635 | **3** | 1 | 1547×1086 | 1.42–1.43 | 239 / 67 |
| 2025-08-09_raw007.dng | 1672×2457 | **2** | 1 | 1582×1083, 1582×1079 | 1.46–1.47 | 274 / 75 |
| 2025-10-07_roll-102_raw000.dng | 3632×2773 | 0 (one frame, not split) | 0 | — | — | 323 / 78 |
| 2025-10-07_roll-102_raw001.dng | 3656×2893 | 0 (one frame, not split) | 0 | — | — | 581 / 106 |
| 2024-12-07_raw0001.dng | 3112×4986 | 2 found, **not split** (confidence 0.26 < 0.5) | 0.26 | — | — | 482 / 75 |
| 2024-10-05_…-0001.tif (8-bit grey) | 7136×7024 | 0, no error | 0 | — | — | 419 / 105 |

  Negative Lab Pro's conversions are ≈ 1470×1050 = 1.40 : 1; our boxes are 1.42–1.47 : 1 (NLP crops a little
  tighter across). The roll-102 scans are single medium-format frames (black-and-white negatives, holder around
  them): no separators at all. 2024-12-07 is a very thin, washed-out frame with no film structure visible; two
  weak separators give 0.26 confidence, so it stays one frame.

### What didn't work
- First merge rule (greedy: merge the shortest inner segment across its weaker separator, strength = purity −
  0.02·length): raw010 frame 1 was cut at the false gap (box 141 rows) and frame 2 swallowed the real gap (174
  rows). Strength must grow with length; with `purity·(1 + 0.05·min(10, len))` raw010 was right, but the planted
  "dark frame with a base band in its middle" merged all three frames (the band, 25 rows, tied the real gap) and the
  135 dark first frame lost a frame. Replaced by scoring every subset of ≤ 14 candidates (frames − 3·length
  deviation + 0.01·Σ purity): all cases right.
- Across band, first version (columns where ≥ 15 % of frame pixels are > 0.12 D in every channel, filmLayout's
  rule): raw004's thin left part fell out (box 154 wide instead of ~220). Now: columns where ≥ 10 % of frame
  pixels are off the gaps' level (`dmax ≥ level + nearD`).
- Planted single frames: their "long axis" is across the film (69 × 47.5 mm for 645), so axis and box are
  meaningless there; the test asks only that a single frame is not split.
- A `python3` heredoc and compound `cd …; git …` commands were refused by the worktree guard; Edit and plain
  commands work.

### What I learned
- VueScan's linear DNGs of 120 strips: gaps read 0.03 D thinner than the layout's rebate box; the level is taken
  from the thinnest 5 % of row medians, not from the rebate, so either sign works.

### What was tricky to build
- Telling a gap from a dark frame's base band: both are clean base right across. The answer is structural (frames
  of one length, nothing shorter than a frame between two gaps), so the separator choice is global.

### What warrants a second pair of eyes
- `minLen = 0.45 × film width` admits half-frame 135 (18 mm on 35 mm film = 0.51) but would reject a strip of
  frames shorter than that (none known).
- The subset search is 2^14 × segments at worst (a noisy, thin scan with many base rows), bounded only by the
  14-candidate cap; strip detection measured 59–106 ms per scan at 4000 px (most of it the shrink).

### What should be done in the future
- N/A for this step.

### Code review instructions
- `packages/ingest/src/conditioning/strip-frames.ts` (steps 1–6 in the header), then the test.
- `npx vitest run packages/ingest/test/strip-frames.test.ts`.

### Technical details
- Separators: runs of positions with share ≥ 0.9, single misses bridged; runs touching either end are leader.
- Frame confidence: min(separator purity (0.9 → 0, 0.98 → 1), length agreement with the median (±10 % free, 0 at
  ±40 %)).

## Step 3: The studio opens one frame per box

The host's `decodeScan` calls `stripFrames` on the working image with `conditionScan`'s layout and hands the boxes
up through `StudioEngine.openAs`; studio-kit's `Frames` makes one frame per box: id `frame_<sha8>-<n>`, log key
`<sha>:negative:<n>`, recipe with `view.frame.crop` = the box, its own graph, log, catalog entry ("raw010.dng · 2/3")
and thumbnail (the existing per-frame thumbnail path). A whole file keeps `frame_<sha8>` and `<sha>:<mode>`. The
first print measures the central 80 % of the crop. 5 new studio-kit tests and 1 host test pass; the full unit suite
is green (93 files, 2718 passed, 7 skipped).

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Item 2 of the work: strip frames in the studio, single files unchanged, remove and
re-open per frame.
**Inferred user intent:** Three printable frames from raw010, each with its own recipe and history.
**Commit (code):** see the commit after this step ("CHB-027 WS-D: a strip opens as one frame per box …").

### What I did
- `apps/studio/src/host/engines.ts` (5 lines, in `decodeScan` only): `stripFrames(data, w, h, { layout: c.layout })`
  when the guess is a negative (or unsure); `Decoded.frames` = the boxes when `split`; a note "strip of 3 frames…".
- `host/studio-engine.ts`: `Decoded.frames`; `openAs` returns `frames`.
- `host/first-print.ts` `measureExposure`: the central 80 % of `view.frame.crop` when set (else of the source, as
  before).
- `packages/studio-kit/src/bridge/frames.ts`: `Opened` (opener result with `frames?`), `OpenResult` (+ `entries`),
  `FrameEntry.strip = { index, of, box }`, `logKey(sha, kind, index?)`, `stripFrameId`, `stripFrameRecipe`;
  `load` decodes once and `build` makes/keeps/replaces the file's frames; `decoded` per sha remembers the boxes;
  `openFile` on a strip with a frame removed brings the missing frames back (`resumed`); `remove` keeps the reader
  while other frames of the file are open; `reopen` of any frame re-opens the whole file.
- `studio.ts`: `frameName` ("raw010.dng · 2/3") for the catalog, `CatalogFrame.file` (the file's name);
  `reopen` selects the file's first frame when the shown frame was replaced. `cb.ts`: `CatalogFrame.file`.
- `apps/studio/src/main.ts` (2 small edits): status "opened raw010.dng (3 frames)"; the relink dialog names the
  file (`c.file ?? c.name`).
- Tests: `packages/studio-kit/test/strip-frames.test.ts` (5: ids, keys, crops, catalog; own logs resumed in a new
  session; a single frame unchanged; remove one, open again; re-open as photo and back), `apps/studio/test/
  host.test.ts` "a frame of a strip … is printed for its own crop".

### Why
- Re-open acts on the file because the engines hold one decode per sha (WS-A's `forgetSource`): frames 1 and 3 as
  negatives and frame 2 as a photo cannot coexist. The file is what was misread; re-opening it is the honest unit.
- Strip logs are keyed with the index, so an old whole-strip log (`<sha>:negative`, from before this branch) is not
  put onto frame 1; the strip simply starts fresh as three frames.

### What worked
- `npx vitest run packages/studio-kit/test/strip-frames.test.ts` → 5 passed at the first run;
  `apps/studio/test/host.test.ts -t strip` passed (dense frame time > 1.5 × the others, each frame's exposure
  |x| < 0.05 after its first print; without the crop change all three would get one time).
- `pnpm typecheck`, `pnpm lint` clean; `pnpm test` → 93 files, 2718 passed, 7 skipped.

### What didn't work
- `pnpm typecheck` after the first edit: `apps/studio/test/host.test.ts(186,37): error TS2345: Argument of type
  'string' is not assignable to parameter of type 'FrameRecipe'` — my new export `stripRecipe` shadowed the test
  strips' `stripRecipe` in `@chromobench/studio-kit`. Renamed mine `stripFrameRecipe`.

### What I learned
- The roll kit's analysis already crops to `view.frame.crop` (`analysePixels`' `pickedCrop`), so roll analysis of
  strip frames measures each frame, while the base and veil come from the shared source.

### What was tricky to build
- `build()` covers four transitions with one plan: fresh open (create all), open again with a frame removed (keep
  the open ones, create the missing), re-open in the other mode single→single (same id, replaced in place, as WS-A
  did), and strip↔single (ids change: frames without a place in the new decode are dropped first, then the new
  ones added, so the catalog and selection follow).

### What warrants a second pair of eyes
- A strip re-opened as a photo and back drops and re-creates the catalog entries: flags, stars and keywords of
  strip frames are lost on that round trip (the logs and recipes are kept).
- After a reload, relinking one library frame of a strip opens the whole file, so a frame removed in an earlier
  session comes back. Removing is not remembered per frame (as for a whole file: opening it again brings it back).

### What should be done in the future
- Remember removed strip frames per (sha, mode) if the photographer finds them coming back annoying.

### Code review instructions
- `packages/studio-kit/src/bridge/frames.ts` `load` / `build` / `remove`, then `studio.ts` `catalogue` / `reopen`,
  `apps/studio/src/host/engines.ts` `decodeScan`, `first-print.ts` `measureExposure`.
- `npx vitest run packages/studio-kit/test/strip-frames.test.ts packages/studio-kit/test/open-mode.test.ts apps/studio/test/host.test.ts`.

### Technical details
- Identity: whole file `frame_<sha8>`, `<sha>:negative|photo`; strip frame n `frame_<sha8>-<n>`, `<sha>:negative:<n>`.
- Boxes are working-image pixels (the GPU's 4000 px long side keeps raw010 at full size; the reference engine's
  512 px makes them ~7× smaller), like every other recipe coordinate.
