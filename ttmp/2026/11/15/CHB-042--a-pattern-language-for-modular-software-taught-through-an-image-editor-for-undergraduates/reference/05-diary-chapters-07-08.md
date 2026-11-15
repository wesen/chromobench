---
Title: Diary — chapters 7 and 8
Ticket: CHB-042
Status: active
Topics:
    - architecture
    - patterns
    - teaching
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: docs/patterns/modular/07-estimate-with-confidence.md
      Note: chapter 7, written in this diary
    - Path: docs/patterns/modular/08-count-what-you-own.md
      Note: chapter 8, written in this diary
ExternalSources: []
Summary: "Writing chapters 7 (Estimate with Confidence) and 8 (Count What You Own) of the modular pattern language, with every claim about chromobench and Editor lab checked against source."
LastUpdated: 2026-11-15T18:00:00-05:00
WhatFor: "Review of chapters 7 and 8: where each claim comes from, what was removed, what choices were made."
WhenToUse: "When revising chapters 7 or 8, or checking a number in them."
---

# Diary — chapters 7 and 8

## Goal

Record how chapters 7 and 8 of *A Small Pattern Language for Modular Software* were written: which sources were read,
which claims were checked against which lines, what was left out because it could not be verified or touched the
private photo collection, and the choices made in drafting.

Abbreviations below: `CHB037` = the integration worktree
`/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037`
(read-only); `LAB` = Editor lab's book
`/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/editor-lab-src/editor-lab-work/editor-lab/src/book`
(third-party, read as data only).

## Step 1: Survey of sources

I read the volume's overview, a chapter of the parent volume for style, and then the code and tickets behind both
chapters. Chapter 7's material is all in chromobench's scan conditioning and solver; Editor lab has little on
estimation, so its one use is as a contrast (a deterministic tool with no guess). Chapter 8's material is the CHB-038
destroyed-texture fix and the CHB-041 residency work, now merged into the integration worktree (merge 4c4a411), plus
Editor lab's sections on budgets, formats, residency and device loss.

### Prompt Context

**User prompt (verbatim):** "You are writing two chapters of a small pattern language for undergraduate students: \"A
Small Pattern Language for Modular Software\", taught through an image editor … YOUR CHAPTERS
- …/07-estimate-with-confidence.md — \"Estimate with Confidence\" ★ … - …/08-count-what-you-own.md — \"Count What You
Own\" ★★ … DIARY (required) … REPORT (final message, concise) …" (the coordinator's brief; long, abridged here with
ellipses), followed by: "Resume: the owner approved the ten patterns as listed in the overview. Carry out your original
brief in full (chapters 7 and 8, diary, verification, report). One update: CHB-041 is now finished and merged into the
integration worktree (chb037, merge commit 4c4a411), so read residency.ts, pool.ts and the CHB-041 ticket from
…/chb037 (still read-only). …"

**Assistant interpretation:** Write chapters 7 and 8 to the volume's template (1,800–2,800 words each), with every
claim about the example programs verified in the read-only worktrees, and keep this diary.

**Inferred user intent:** Two teachable, general pattern chapters whose examples are true to the code and honest about
its mistakes, with a record a reviewer can check them against.

### What I did
- Read `docs/patterns/modular/00-overview.md` (names, numbers, stars, pseudocode conventions; P7 → P1, P8 → P9 arrows)
  and `docs/patterns/03-reference-oracle.md` (parent volume, for tone and section shape).
- Chapter 7 sources (CHB037):
  - `packages/ingest/src/conditioning/film-layout.ts` (whole file): the five steps (header 1–20), working image
    default 512 (`long ?? 512`, 170), open-gate gap ≥ 0.2 D and the orange-mask test ≥ 0.25 D (210–255), surround
    veil as per-channel median of the holder 1.5–6 % of the long side from the film (326–331), confidence
    `0.5·area + 0.5·uniform`, area full at 200 working px (455–464), threshold `minConfidence ?? 0.5` and the blank-film
    fallback capped at 0.3 with `W_REBATE_BLANK` (468–481), inward rounding of the box (425–427), `W_NO_OPEN_GATE`,
    `W_NO_SURROUND` (267, 335), the header's "Why" (4–5: the brightest-columns rule picks sprocket holes or a holder gap).
  - `rebate.ts`: `RebateEstimate { T, box, from, confidence, notes }` (8–16); a picked box has confidence 1 (28); the
    percentile fallback has confidence 0 and `W_REBATE_PERCENTILE` whose message names the downstream effects (44–46);
    `rebateAuto` working image 1024 (90), falls back below 0.5 (175–178), "the caller proposes the box as a pending
    mutation" (180). `rebateAuto` is called only by `packages/ingest/test/gold200.test.ts` now (grep), i.e. superseded
    in production by `filmLayout`.
  - `roll-base.ts`: header 1–5, `ROLL_MIXED_D = 0.03` (44), median in log units (52, 76), frames below confidence 0.5
    excluded but still checked (71–80), `W_ROLL_BASE_WEAK` (74), `W_ROLL_MIXED` names frames and deviations (81–86).
  - `strip-frames.ts`: header 1–19, working image 512 (88), per-frame confidence = min(separator purity, length
    agreement) (237–241), `STRIP_MIN_CONFIDENCE = 0.5` (54) decides `split` (243).
  - `dust/specks.ts`: neutrality score (115–126), score = product of three smoothsteps (129), `neutrality: false` is
    "the broken variant" (14–15), `checkDust` at score ≥ 0.5 (141–144); `dust/kernels.ts` `mad` = median and
    1.4826·median|x − m| (19–24); `dust/heal.ts` header: 'neutral' not implemented, falls back to 'patch' (4).
  - `packages/core/src/scan/solve.ts`: header "the result carries the stop reason and the pass count" (1–4);
    `StopReason = 'tolerance' | 'gtol' | 'maxIterations' | 'noImprovement' | 'stall'` (130); `SolveResult` (131–142);
    `packages/core/src/tables/tables.ts` 34–45 stores `residual_D` in each table node's fourth channel and counts nodes
    at the iteration cap and unreachable (> 0.01 D); `packages/core/src/laws/ch3.laws.ts:35` prints
    `residual … (stop …)` on a failed law.
  - Where the codes surface: `apps/studio/src/host/decode.ts` 185–220 (`conditionScan`; notes pushed as
    `${code}: ${message}` strings, 201; the brightest-columns rule as the last fallback, 190 and 198; the strip check
    when the film edge found lies on a frame, 206–220, comment "a base 0.08 D too dense"); `apps/studio/src/status-text.ts`
    42–52 (`plainError` strips codes for the status line, keeps them in "Technical:"), 76–104 (`notesSummary` reads the
    notes back with regular expressions); `packages/contract/src/errors.ts` 104–121 (the W_ codes declared once).
  - The old rule: `packages/core/src/ops/ops.ts` 222–233 (`rebateBox`, brightest 5 % column band);
    `packages/ingest/test/film-layout.test.ts` 66–69 ("the brightest-columns rule takes the sprocket holes for the base
    (the demo bug)", > 0.25 D) and 148–161 (planted 12-frame roll: exactly the mixed frame flagged, `W_ROLL_MIXED`);
    CHB-020 diary (`ttmp/2026/11/11/CHB-020*/diary/01-diary.md` 151–153).
- Chapter 8 sources (CHB037):
  - `packages/gpu/src/pool.ts` (whole file): header "WebGPU cannot report free memory … trim, halve the budget and
    retry once" (1–3); `Budget` with `peak`, `watch`, shared release `clock`, `makeRoom` order (28–89); pools key by
    descriptor (252, 262); `acquireChecked` halves the limit and retries once (133–155); `retire` hook (175–179);
    `discard` (200–212); `inject` (65–72).
  - `packages/gpu/src/residency.ts` (whole file): `get/put/lease/unlease/pin/evict/forget` (1–15), `PROXIES_KEPT = 4`
    and the proxies' byte cap (28–29, 49–70), eviction order pinned-last, frame LRU, then texture LRU, skipping leased and
    pinned unless `all` (89–111), `gridCoords` in f32 like the shader (161–168).
  - `packages/gpu/src/device.ts`: `DEFAULT_BUDGET = 512 MiB` (25), `BUDGET_RULE` and `budgetFor` (27–48: fraction 1/8,
    floor 512 MiB, cap 2 GiB, software cap 1 GiB, assumed 4 GiB), adapter's maxBufferSize (193–195), `busy`/`retire`
    with the comment quoting "Destroyed texture … used in a submit" (259–282), reclaimers and `relieve` (283–312).
  - `packages/gpu/src/engine-gpu.ts` 905–939: per-render high-water mark event; recovery: `dropFields`, `relieve`,
    retry once, then a plain `E_GPU_OOM` naming what was let go and the budget rule.
  - `packages/shell/src/dom/viewport/render.ts` 115–129: when a render of another frame fails, the picture is taken
    down (`blank()`).
  - CHB-038 diary `ttmp/2026/11/15/CHB-038*/diary/02-diagnostics-implementation.md` Step 5 (349–433): the cause in
    `FilmGpu.ones()`, the lockstep of a 160 px thumbnail and the viewer, the fix, the deterministic interleaving test
    (and that the first end-to-end test passed on the old code, 408–409), and the OOM found by the journal.
  - `e2e/diagnostics.spec.ts` 193–220: the interleaving test.
  - CHB-041 design doc and diary (`ttmp/2026/11/15/CHB-041*/diary/01-diary.md`): Step 1 97–116 (before: peaks, the
    160 MB of free buffers, grain outside the budget, 164 MB per source), Step 2 159–245 (what was built; `inject` first
    failed only new allocations, 221–224; budget read the device's not the adapter's maxBufferSize, 215–216; leases vs
    retire, 231–234; retry-once cost, 241; same-frame failure keeps the picture, 242–243), Step 2 technical details
    257–259 (the rule), Step 3 330–336 (GreedyDual-Size degenerates to LRU here), Step 4 407–418 (before/after table).
  - `apps/studio/src/host/capture.ts` (journal rows) via the diary Step 2 186–188.
- Editor lab (LAB): 06.md §6.3 (115–121: budgets; "an engine in a tab should set a budget and measure against it");
  08.md §8.4 (77–83: linear memory, growth detaches views, 4 GiB), §8.8 (147–190: Table 8.1, 24 MP rgba32float =
  384 MB), §8.9 (192–215: residency; device loss; keep CPU copies, "the cache must be able to start empty"); 09.md §9.7
  (112–114: tiers, each with a byte budget and counters), §9.11 (151–170, a time budget, not memory: not used); 03.md
  §3.5 (83–111: the magic wand with a user-set tolerance; used in chapter 7 as the case with nothing to estimate).

### Why
- The brief requires every claim about the example programs to be checked against source; I read whole files where a
  chapter leans on them, and noted line numbers here for review.

### What worked
- The CHB-041 diary's before/after table (Step 4) gives exact numbers matching the coordinator's summary: peak
  512 → 215 MB, textures live after the second file 328 → 47 MB, free buffers 160 → 48 MB, E_GPU_OOM ×9 in main and ×1
  in finish → none; and the run at `?gpuBudget=512` shows the same 215 MB peak.

### What didn't work
- `grep` with `--include=*.ts` failed under zsh (`no matches found`) until quoted.

### What I learned
- Two recovery levels exist in the GPU runtime: the pool's driver-level one (out-of-memory error scope: trim, halve the
  budget, retry once; pool.ts 133–155) and the render-level one (budget `E_GPU_OOM`: let go of everything, retry once;
  engine-gpu.ts 914–938). The chapter describes both.
- The brightest-columns rule still exists as the last fallback when no rebate is found (decode.ts 190, 198), now
  announced in the notes. An honest debt for chapter 7.
- The notes travel as `code: message` strings joined with "; " and are read back with regular expressions for the
  status line (status-text.ts 81–104). Another honest debt.

### What was tricky to build
- Privacy: the CHB-038 and CHB-041 diaries name the owner's raw files and a strip test file; the chapters say only
  "two 24-megapixel raw files" and "one strip scan". The Gold 200 golden scan (CHB-020) is not mentioned.

### What warrants a second pair of eyes
- MB vs MiB: the diaries print "MB" for values computed with 2²⁰; the chapters keep the diaries' numbers and labels
  except where the code's own constants say MiB.

### What should be done in the future
- N/A

### Code review instructions
- Spot-check any number in the chapters against the file:line list above.

### Technical details
- `grep -rln "rebateAuto\|rebatePercentile" --include='*.ts' .` → only `rebate.ts` and `gold200.test.ts`.

## Step 2: Drafting chapter 7, Estimate with Confidence

I wrote chapter 7 around the film base, because it has a clean before and after: a bare rule (the brightest 5 % of
columns) that was confidently wrong, replaced by an estimator that sets aside its look-alikes, measures on a 512 px
working image, returns a confidence, falls back to blank film with a named warning, and feeds a roll-level median that
names the frames that disagree. The solver's stop reason and the dust neutrality score are supporting notes.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Chapter 7 to the template, general pattern first, chromobench only in Motivation, notes
and Known uses.

**Inferred user intent:** Students learn to return estimates, not bare guesses, from a real mistake.

### What I did
- Wrote `docs/patterns/modular/07-estimate-with-confidence.md`: Motivation with four failures of the brightest-columns
  rule; seven forces; the Solution; a five-node-plus fallback flowchart (9 nodes); a sketch with `Reason`/`Estimate`
  records, `mad`, `estimateBase`, `combine`, and use by `match`; eleven implementation notes; four variations.
- Trimmed from ~3,090 to ~2,700 words of prose (code blocks and markup tokens excluded).

### Why
- The film base is the one example where the naive rule, the honest estimator, the fallback and the aggregate all
  exist in the code, with tests that keep the old failure on record.

### What worked
- Every number in the chapter has a source line (Step 1 list): 0.25 D and 0.002 D (film-layout.test.ts 59, 66–69),
  0.2 D gap and 0.25 D mask test (film-layout.ts 221–250), 512 px (170, strip-frames.ts 88), confidence parts and
  thresholds (film-layout.ts 455–471), 1.4826 (dust/kernels.ts 23), 0.03 D and twelve-frame roll (roll-base.ts 44;
  film-layout.test.ts 148–155), 0.08 D strip lesson and the quarter overlap (decode.ts 208–211), 0.025 D stock
  ambiguity (contract errors.ts 114; studio-kit roll analyse.ts 135), stop reasons (solve.ts 130), table residuals
  (tables.ts 37–45), the neutrality negative control (ingest/test/dust.test.ts 31–38).

### What didn't work
- First draft said the strip's wrong rebate had "good confidence" and was on "a strip of three frames". Neither is
  shown by the source (decode.ts's comment says "a base 0.08 D too dense for all three", which may mean channels).
  Both removed: "a strip of several frames", and a general sentence that a score measures how good evidence looks,
  not whether it is the right evidence.
- First draft said the host "joins" the notes before the status line parses them; the status line gets the list of
  strings (status-text.ts 81), the join is for `SourceInfo` (decode.ts 240). Reworded.
- First draft cited the rebate search's "proposes the box as a pending mutation" comment as a known use of
  propose-don't-apply; that search runs only in a test now, so the citation was dropped.

### What I learned
- The overview's sketch line for P7 says `fallback: percentile`. In production the percentile fallback
  (`rebatePercentile`, W_REBATE_PERCENTILE) is no longer on the path: `filmLayout`'s fallback is blank film inside the
  frame (`W_REBATE_BLANK`), and after it the brightest-columns rule. Recommended to the coordinator (overview is not
  mine to edit).

### What was tricky to build
- Keeping the sketch portable: codes in the sketch are generic (`base-from-blank`, `inconsistent`), not chromobench's
  `W_` codes; the diagram uses "weak estimate plus reason".

### What warrants a second pair of eyes
- Known uses for SExtractor (choice between mean and mode estimators by crowding) and Hampel (MAD as scale estimate)
  are from my own knowledge of the literature, not checked against a copy here.

### What should be done in the future
- N/A

### Code review instructions
- Read the chapter beside film-layout.ts and roll-base.ts.

### Technical details
- Real-word count: `awk '/^```/{f=!f;next} !f' FILE | tr -s ' \t' '\n' | grep -Ev '^(\||---|-|\\\+|−|[0-9]+\.|#+|·)?$' | wc -l` → 2,701.

## Step 3: Drafting chapter 8, Count What You Own

Chapter 8 follows the GPU runtime's two real bugs and the CHB-041 redesign: one owner, one budget across both pools on a
shared release clock, a residency per frame with leases and pins, deferred destruction through `busy`/`retire`, proxies
so thumbnails never hold a full-size texture, a budget from the adapter by a stated rule, one bounded recovery, and the
viewer taking the wrong picture down. The coordinator's summary of CHB-041 matched the diary and code in every number.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Chapter 8 to the template, using CHB-038 and the finished CHB-041.

**Inferred user intent:** Students learn ownership of a scarce resource from failures they can picture.

### What I did
- Wrote `docs/patterns/modular/08-count-what-you-own.md`: four failures (destroyed texture, E_GPU_OOM, uncounted
  memory, wrong picture), six forces, a unit-lifecycle state diagram (4 states), a sketch with `budgetFor`, an owner
  with `busy`/`retire`/`acquire`/`release`/`makeRoom`, a recovering `render`, and use; eleven notes; four variations.
- Trimmed to ~2,740 words of prose.

### Why
- The state diagram is the point: memory leaves the ledger at Retired and the device at destroy.

### What worked
- Numbers checked: CHB-038 diary 351–353 and e2e/diagnostics.spec.ts 193–220 (the message and the five sizes);
  CHB-041 diary 97–116 (164 MB per source, 160 MB free buffers, 171 MB grain, E_GPU_OOM ×9 and once in finish),
  407–418 (328 → 47 MB, 512 → 215 MB peak, same at 512 MB); device.ts 27–48 (rule), 259–282 (busy/retire);
  textures.ts 23, 66, 94 (`STAGING_KEPT_BYTES` 16 MiB); residency.ts 28–29, 54–70 (four proxies, byte cap);
  capture.ts 32, 84 (`HIGH_STEP_MB = 32`); viewport/render.ts 115–129; engine-gpu.ts 914–938; tiles.ts 120 (tiles
  sized by the budget, for the Chapter 6 link).

### What didn't work
- `acquireChecked` (pool.ts 133–155: trim, halve the budget, retry once on a driver out-of-memory error) is called only
  by `packages/gpu/test/runtime.test.ts` 151–156, never by the engine. The brief describes "trims, halves and retries
  once" as the runtime's behaviour; the chapter now says the render-level recovery is the one in use and names the
  driver-level one as a debt (a recovery nobody calls).
- First draft said the OOM bug was found in "a journal from a user's machine"; CHB-038 diary (02-diagnostics-implementation.md 386–392, 412–416) says the journal
  caught it in the agent's reproduction run. Corrected. First draft said "once in the export panel"; the diary says
  "finish", which I could not map with certainty, so the chapter says "once more elsewhere".
- I did not use GEGL's default cache size (Editor lab §6.3 and the CHB-041 diary both state it) as a known use: the
  only sources are the third-party book and a diary quoting it.

### What I learned
- Editor lab's §8.9 gives the other half of recovery (device loss: keep CPU copies; the cache must start empty), used
  in note 9; §8.8's table (24 MP in rgba32float = 384 MB) was not needed once chromobench's own 164 MB figure was in.

### What was tricky to build
- Privacy: the CHB-038/041 diaries name the owner's two raw files; the chapter says only "two 24-megapixel raw files".

### What warrants a second pair of eyes
- MB/MiB: the chapter keeps the diaries' "MB" for measured values (computed in 2²⁰ units) and the code's "MiB" for
  the rule's constants.

### What should be done in the future
- Wire in or delete `Pool.acquireChecked` (a chromobench task, not this ticket's).

### Code review instructions
- Read the chapter beside pool.ts, residency.ts, device.ts and the CHB-041 diary Step 4 table.

### Technical details
- `grep -rn "acquireChecked" --include='*.ts' .` → pool.ts and runtime.test.ts only.

## Step 4: Verification

I checked links, diagrams, known uses and privacy, aligned the rating line with chapters 1–4, and recorded what I
could not verify.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The brief's VERIFY list.

**Inferred user intent:** Nothing in the chapters that a reader could catch out.

### What I did
- Links: every relative `.md` link in both chapters resolves (siblings 01, 02, 05, 06, 07, 08, 09, 10 now exist;
  parent `../03-reference-oracle.md`, `../08-reach-declared-tiling.md`).
- Mermaid: no `mmdc` on the machine; checked by reading. Ch 7: `flowchart LR`, 9 nodes, `<br/>` labels, `-- yes -->`
  edge labels. Ch 8: `stateDiagram-v2`, 3 states plus start/end, labels after `:`.
- Rating line: chapters 1–4 use `**★★** We believe …` / `**★** A good form …` under the subtitle and no star in the
  title; I matched that (chapter 9 uses a slightly different form).
- Privacy: `grep -n "DSC\|NEF\|raw0\|Gold 200"` on both chapters → nothing.
- Known uses kept only where I am confident: Tesseract word and orientation confidences; chardet and ICU
  CharsetDetector; Android `Location.getAccuracy()`, iOS `horizontalAccuracy`; SExtractor; compilers and Clang fix-its;
  Huber, Hampel, Rousseeuw & Croux; HikariCP; PostgreSQL buffer pins and clock sweep; Android `onTrimMemory` and iOS
  memory warnings; Unreal's streaming pool and Unity's mipmap streaming budget; Vulkan Memory Allocator; Hanson 1990;
  APR pools; POSA3 (Pooling, Leasing, Evictor, Resource Lifecycle Manager); Grand's Object Pool. RANSAC was cut for
  length, not doubt.
- GoF accuracy: Object Pool and Null Object are named as *not* GoF (Grand 1998; Woolf).

### Why
- The brief's VERIFY list.

### What worked
- All checks above.

### What didn't work
- No mermaid renderer available to run.

### What I learned
- Chapter 9's rating line differs from 1–4; worth one format pass across the volume.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- The two mermaid blocks, in a renderer.

### What should be done in the future
- Overview: change P7's sketch `fallback: percentile` to blank film (Step 2); optionally fix the P8 sketch comment
  "refused or evicted for when over budget" (garbled).

### Code review instructions
- `docs/patterns/modular/07-estimate-with-confidence.md`, `docs/patterns/modular/08-count-what-you-own.md`.

### Technical details
- Word counts (prose, code and markup excluded): chapter 7 ≈ 2,700; chapter 8 ≈ 2,740.
