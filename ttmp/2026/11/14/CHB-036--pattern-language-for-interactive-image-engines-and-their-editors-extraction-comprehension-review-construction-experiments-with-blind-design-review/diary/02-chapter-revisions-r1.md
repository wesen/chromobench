---
Title: Diary — chapter revisions round 1
Ticket: CHB-036
Status: active
Topics:
    - architecture
    - agent
    - patterns
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-14T21:47:43.325465-05:00
WhatFor: ""
WhenToUse: ""
---


# Diary

## Goal

This diary records round 1 of the chapter revisions: chapters 1, 4, 8 and 9 of `docs/patterns/` rewritten from the
evidence of the construction experiment (`docs/patterns/experiments/RESULTS.md` and the blind Opus reviews in
`docs/patterns/experiments/reviews/`). Every change to a chapter is traced here to the review file and the
implementation letter it came from; the chapters themselves carry only a short Validation paragraph. The work happens
on branch `task/pattern-language-rev1` in its own worktree. Times are local (EST).

## Step 1: Reading the evidence, keeping v1

The main agent assigned me the round-1 revisions: revise the four chapters the experiment tested, following the
per-chapter change list in RESULTS.md, with the reviews as evidence. Before editing anything I read the overview's
conventions, the four chapters, RESULTS.md, all four review answers with their keys, and the four task statements,
and I copied the four chapters unchanged to `docs/patterns/versions/v1/` so the text the experiment ran against
stays readable.

The reviews are consistent with RESULTS.md and add a few things it does not list. The two most useful are in the
change-request analyses: in the graph task, every design that used its evictable cache as the scratch store of an
evaluation breaks under an LRU (graph-r1, impl-B "makes it throw 'input evaluated out of order'", and the same
caveat for A, C, D); and in the document task, every design spells its fields out in several places (clone, diff,
reader, default), so a new field is shotgun surgery even where a field schema exists (document-r1, impl-A
"cloneState and diffStates list fields by hand").

### Prompt Context

**User prompt (verbatim):** "do 4 per pattern I think, to validate how robust the pattern usage is. That way you can finetune the pattern definition etc..."

**User prompt (verbatim):** "when assessing the use of the patterns, think like richard gabriel / christopher alexander in your philosophy, potentially like martin fowler. To give you an idea of what we are looking for."

**Assistant interpretation:** These are the owner's original requests for the experiment. The main agent ran it
(four chapter runs and two controls per task, hidden tests, blind reviews) and assigned me the round-1 revisions:
fine-tune chapters 1, 4, 8 and 9 from what the runs and reviews showed, keep the old versions, add a Validation
paragraph per chapter, keep the language portable, and commit per chapter.

**Inferred user intent:** Chapters that teach the right shape the first time an agent reads them: no defects in the
sketch for agents to copy, no implementation notes that cost code without paying back, and the good ideas that
several independent implementations found folded in where they generalise.

### What I did
- Read `docs/patterns/00-overview.md`, chapters 01, 04, 08, 09, `experiments/RESULTS.md`, the four
  `reviews/<task>-r1.answer.json` (summaries, smells, change requests, tests, `cross`) and keys, and the four
  `tasks/<task>/TASK.md`; listed the change requests from `reviews/<task>-r1.prompt.md`.
- `mkdir docs/patterns/versions/v1`, copied the four chapters there, added a one-line README.
- Created this diary with `docmgr doc add --ticket CHB-036 --doc-type diary --title "Diary — chapter revisions
  round 1"` and renamed it from `02-diary-chapter-revisions-round-1.md` to `02-chapter-revisions-r1.md`;
  `docmgr doctor --ticket CHB-036` passes.

### Why
- The chapters must change in place (the artifact builds from `docs/patterns/NN-*.md`), but the experiment's
  conclusions are about v1; v1 must stay readable next to RESULTS.md.

### What worked
- The keys make the letter-to-run mapping unambiguous. Graph: A ch-3, B ch-4, C control-2, D ch-1, E ch-2. Slots,
  tiling and document: A ch-3, B ch-4, C control-2, D ch-1, E control-1, F ch-2.
- `build-artifact.py` globs only `docs/patterns/[01][0-9]-*.md`, so `versions/v1/` does not leak into the page.

### What didn't work
- `docmgr doc add` names the file from the title (`02-diary-chapter-revisions-round-1.md`); renamed by hand, doctor
  still clean.

### What I learned
- The reviewers' "ideas the yardstick lacks" come as often from controls as from chapter runs (tiling: the
  read-minimising grid from C and E, both controls; document: the immutable source and the shorter-side radius from
  E, a control). The revisions should take ideas on merit, not by who wrote them.

### What was tricky to build
- Separating generalisable ideas from task trivia. Rule used: an idea goes in if it would hold for a different
  image system with the same pattern (another engine, another document), and stays out if it only answers this
  task's API (for example the document task's `spots.<id>` delete-only path, or the graph task's prefix-sum blur).

### What warrants a second pair of eyes
- N/A (no chapter changed yet).

### What should be done in the future
- N/A

### Code review instructions
- `docs/patterns/versions/v1/` should be byte-identical to the chapters at commit e05e59c:
  `git diff e05e59c -- docs/patterns/01-interned-operation-graph.md` against the copy.

### Technical details
- Change requests the reviewers used for piecemeal growth: graph (add `crop`; bound the cache by bytes, LRU), slots
  (a `proof` pass that is never aborted and always presented; at most 2 background renders at once), tiling
  (`sharpen` needing neighbourhood and centre; `downsample2` changing the grid), document (a linear-gradient mask
  with a feather; version 3 renaming `exposure` to `tone.exposure`).

## Step 2: Chapter 1, Interned Operation Graph

Chapter 1's core held up: all five graph runs, the control included, converged on the registry, canonical sorted
arguments, a SHA-256 id over op, args and input ids, one frozen node per id and a cache keyed by id and scale
(graph-r1 `cross.generativity`). What the review found wrong were implementation notes that agents obeyed at a cost,
and three ideas the chapter lacked. The sketch now shows the shape of the best run (B) rather than the shape the v1
sketch implied: a `prepare` that checks everything and changes nothing, shared by `intern` and a two-pass `adopt`;
one iterative post-order walk shared by `closure` and `evaluate`; an evaluation memo beside the evictable cache; one
`OpDecl` per operation carrying its arguments and its `run`.

The chapter is at 2,499 words (v1 2,262); the longer sketch and the new notes had to be paid for by tightening
Motivation, Collaborations, Variations and Known uses. The star stays ★★: every run, the control too, built this
shape, which is what ★★ claims.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Apply RESULTS.md's chapter 1 list (keep, remove or soften, add) with the reviews as
evidence, fix the sketch first, add a Validation paragraph, re-examine the star.

**Inferred user intent:** A chapter 1 that an agent can follow literally without building machinery that pays
nothing back.

**Commit (code):** 6fc524e — "Chapter 1 rev1: checked all-or-nothing import, one declaration per op, explicit-stack
walk, evaluation memo beside a byte-bounded cache; …"

### What I did
- Solution: registry declares arguments and computation together; unknown keys refused; definitions travel with
  their ids; receiver checks all and recomputes all ids before interning any; bounded cache; evaluation holds its
  own results.
- Sketch rewritten (see above); Structure and Collaborations follow it; mermaid diagram gains the import path.
- Notes: v1 notes 1, 3, 9 kept (tightened); 2 (law tests) merged into new 11 with independent references and a real
  second process; 4 extended with one-declaration-per-op; 5 rewritten (cache every node, bound by bytes, evaluation
  memo, copies at the boundary); 6 verify-on-hit limited to short keys; 7 quantisation removed (round at the
  control instead); 8 version tag moved into the hash, export versions only if checked; 10 (early cutoff) moved into
  the "Verifying traces" variation; new 5 (verify before intern) and 6 (explicit-stack walk, written once).
- Validation paragraph before Related chapters; Chapter 3 added to Related chapters.

### Why (evidence per change)
- Checked, all-or-nothing import: graph-r1 `ideas_the_yardstick_lacks` 1, impl-B (chapter-4) `src/index.ts:516-567`
  and its robustness tests (an id that does not match, forward references, zero evaluations after a failed import).
- Explicit-stack walk: graph-r1 ideas 2, impl-B `src/index.ts:434-466`, tested at depth 5000. "Write the walk once":
  graph-r1 smells for impl-A (two traversal styles) and impl-B (the same stack walk written twice).
- One declaration per op: graph-r1 ideas 3, impl-C (control-2) `src/index.ts:152-158`, the most local change
  request 1; and the shotgun-surgery smell (registry plus `execute` switch) in A, B and D.
- Evaluation memo beside the cache: graph-r1 change request 2 analyses: impl-B "compute treats the cache as its
  scratch store, so an eviction ... makes it throw" (`src/index.ts:458`), and the same caveat for A, C, D and E.
- Copies at the boundary: graph-r1 ideas 8, impl-E (chapter-2) `src/index.ts:491-492, :539-541`.
- Computations read canonical arguments (the PRNG seed): graph-r1 ideas 5, impl-B, D, E hashing the canonical seed.
- Independent references and a real separate process: graph-r1 ideas 6 and 7, impl-B `test/helpers/reference.js`,
  `test/identity.test.js:188-216`, impl-E `test/transfer.test.ts:179-202`.
- Verify-on-hit limited to short keys: graph-r1 `yardstick_problems` 1, impl-D (chapter-1) `src/index.ts:452-456`.
- Version only if checked: graph-r1 problems 2, impl-A `src/index.ts:527` vs `:534-537`, impl-E `:552`.
- Quantisation removed: graph-r1 problems 3, impl-D `test/03-canonical.test.ts:74-79` (D had to document refusing
  the note).
- Cache every node: graph-r1 problems 4 (checkpoint-only caching breaks shared-work reuse).
- Node "inferred info" made optional: graph-r1 problems 5 (absent from all five, not needed).
- Unknown arguments refused and delimiters named as a failure in note 1: impl-C (control) smells at
  `src/index.ts:100-112` and `:237-242`.

### What worked
- Factoring the checks into `prepare` made `adopt` short and removed the duplicated knowledge between intern and
  import that A and D had (graph-r1 impl-D smell `:431-445 vs :473-484`).

### What didn't work
- First full draft was 3,191 words (sketch 515, notes 870). Cut to 2,499 by compressing the sketch (postorder and
  closure as signatures with comments), merging notes, and trimming prose sections.
- First `evaluate` draft had a bug: `hit ← id → (memo[id] ← cache.get(...)) ≠ none` stored `none` in the memo on a
  miss, and the loop's `if id in memo` then skipped the miss. Rewritten as a helper that stores only real hits.

### What I learned
- A sketch that walks the whole closure and checks the cache per node recomputes an evicted input of a cached node
  for nothing; stopping the walk at cache hits, and pinning each hit in the memo as it is found, is the version
  that is both correct under eviction and minimal.

### What was tricky to build
- The stop-at-hit walk and eviction interact: if the walk only *tested* the cache and read it later, a `put`
  during the same evaluation could evict a node the walk had decided not to descend below. Pinning the hit in the
  memo at the moment of the test closes that window.

### What warrants a second pair of eyes
- The `postorder` signature with `stopAt` is described, not spelled out; check that the comment is enough for an
  agent to implement it iteratively (v1 had no walk at all).
- 2,499 words is at the upper limit by `wc -w`.

### What should be done in the future
- Rerun the graph task with this version against the same hidden tests and review prompt, and see whether the
  chapter runs still copy anything that costs without paying.

### Code review instructions
- `git diff e05e59c -- docs/patterns/01-interned-operation-graph.md`; compare with
  `docs/patterns/versions/v1/01-interned-operation-graph.md` and `docs/patterns/experiments/reviews/graph-r1.answer.json`.

### Technical details
- Word counts by `wc -w` (code and tables included, as for v1): 2,499.

## Step 3: Chapter 4, Latest-Wins Render Slots

Chapter 4 is the case where the chapter shaped the code without improving it: the reviewer told chapter runs from
controls (0.75–0.90 against 0.15–0.30) but ranked a control best (impl-E, control-1, 28/35), and traced the chapter's
harm to its sketch. Five of six runs copied the sketch's "release the old result, then present the new one"; impl-B
(chapter-4) copied the lane on the slot and then misjudged `liveBusy` after a lane change; and the sketch's `close()`
left four questions open, which the runs answered four ways. So the sketch was rewritten first, and the rest of the
chapter follows it: the lane moves to the request and its render; each render has a `fate` (wanted, kept, aborted)
decided at request time; an aborted render holds its slot until it settles; settle presents first and releases
after; `close()` releases the shown result once; `idle()` waits for aborted renders.

The star stays ★★. All six runs, the two controls included, converged on the same seams (slot map, one waiting and
one running record, live-first pump, aborted flag, walls, adoption by key; slots-r1 `cross.generativity`). That is
what ★★ claims: the shape is close to invariant. The chapter's problem was the sketch's details, not the pattern.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Fix chapter 4's defects named in RESULTS.md (lane, present order, close semantics),
add the listed ideas, re-examine the star, add Validation.

**Inferred user intent:** A chapter whose sketch an agent can copy literally and get a correct scheduler.

**Commit (code):** 54d4d98 — "Chapter 4 rev1: lane on the request and its render, a fate per render (wanted, kept,
aborted) decided at request time, …"

### What I did
- Solution rewritten: lane in the request; same-key adoption only for renders not aborted; "decide now: abort or
  keep"; occupancy until settle; present only renders not aborted, present first then release; release every
  result not shown exactly once.
- Forces: "Aborting against wasting" and "Simplicity against starvation" replaced by "Aborting against occupying"
  and "The scheduler against its callers" (the two forces the runs actually struggled with); freshness/progress
  keeps the starvation point.
- Structure: Slot without lane; new Render participant with its fate; thumbnail cache moved into note 10 (no run
  built it, slots-r1 problems 4).
- State diagram now has Kept and Aborted states and shows that aborted renders still hold the slot.
- Sketch rewritten: `request`, `abort`, re-entrant-guarded `pump`, `settle`, `close`, `idle`, `chooseTarget`.
- Notes: v1 1 rewritten (never backwards by structure, the comparison as the law); 2 extended with the fate; new 3
  (lane on the request), 4 (aborted renders keep the slot; close; idle; engine caps), 5 (present first, release once,
  boxed results), 6 (walls, re-entrancy, wake from events; v1 note 4 folded in), 7 (adoption rules; v1 note 8); v1 3
  kept as 8; v1 5 and 7 merged as 9; v1 6 and 10 merged as 10; v1 11 extended with the fuzz laws as 11.
- Variations: "Starvation by count" folded into "Tile-level refinement"; others tightened.

### Why (evidence per change)
- Lane on the request: slots-r1 `yardstick_problems` 1; impl-B (chapter-4) `src/index.ts:69, :118, :274`; A, C, E
  keep it per request (`impl-A/src/index.ts:55`, `impl-F/src/index.ts:64` per render); change request 2 analyses
  for B ("the lane has to move onto RunningJob first").
- Present first, then release: slots-r1 problems 2 and ideas 1; impl-E (control-1) `src/index.ts:236-242`; the copy
  in B `:193-194` and D `:185-187`.
- close/idle semantics: slots-r1 problems 3; occupied-until-settle from impl-D (chapter-1) `:281`, impl-F
  (chapter-2) `test/core.test.ts:406`; the overlap after reopen in impl-A `:320` and impl-C `:326` (smells); release
  shown on close from impl-B `:312-318`, impl-F `:296-299`. "idle waits for aborted renders" is my decision: it is
  the reading under which "idle" means every release has happened, and it is what occupancy implies.
- The fate (must-present flag): slots-r1 ideas 2 and problems 5; impl-E `presentAnyway` `src/index.ts:67, :124,
  :303`; change request 1 (a proof pass) maps onto it (impl-E change-request analysis "Most of the mechanism exists
  already").
- Walls around callbacks: ideas 5, impl-A `:119-125`, impl-B `:93-99`. Re-entrancy guard: ideas 6, impl-B
  `:229-244`, impl-A `test/scheduler.test.ts:659`. Synchronous throw is a failure: ideas 7, impl-A `:179-182`.
- Boxed results: ideas 8, impl-B `:75`, impl-E `:79`. Never adopt an aborted render: ideas 9, impl-B `:282`,
  impl-C `test/scheduler.test.ts:772`. Aborted live render does not block background work: ideas 10, impl-F
  `:151-152`.
- Engine caps count aborted renders: change request 2 analyses (A and C undercount detached renders; D, E, F count
  correctly because aborted renders stay in the slot).
- Adoption reports the newer generation: impl-C smell `:297-305` and impl-E smell `:57, :63, :235` (present info
  disagrees with what `request` returned).
- Fuzz liveness law: ideas 11, impl-E `test/fuzz.test.ts:172-179`; per-slot concurrency across closes from the
  weakened law in impl-C `test/invariants.test.ts:46` and the hidden overlap in impl-A.

### What worked
- Replacing the two booleans (`aborted`, `mustPresent`) of the first draft by one `fate` field: the present rule
  became "fate ≠ aborted", the state diagram got one state per fate, and change request 1 became one assignment.

### What didn't work
- First draft: 2,902 words. Cut to 2,499 by merging notes and shortening Variations, Motivation and Known uses.
- First draft of `request` kept a `mustPresent` flag that `settle` never read (the present rule was already "not
  aborted"), which would have taught a dead field; replaced by `fate`.
- The v1 sketch's adoption returned without clearing `s.waiting`; with a kept render and a different waiting key, a
  later request for the running key would leave the older waiting request to run and be shown after the newest
  one. The new sketch drops the waiting request on adoption. (My own finding while rewriting; no reviewer named it.)
- `starved` in the v1 sketch had no "progressMs > 0" guard, so 0 meant "always starved" instead of "disabled".

### What I learned
- With strict occupancy, the generation comparison never decides anything; the decisions are made at request time.
  The chapter now says so, and keeps the comparison as the law to assert and as the rule for designs that let two
  renders of one slot be in flight.

### What was tricky to build
- Keeping three rules consistent: an aborted render holds its slot (for per-slot concurrency and engine caps), but
  it does not make its lane busy (so background work is not blocked by something nobody wants), and `idle()` still
  waits for it. The sketch expresses all three in `settle` (only place that frees the slot), `liveBusy` (comment:
  live work not aborted) and `idle`.

### What warrants a second pair of eyes
- `idle()` waiting for aborted renders is a choice the task left open; an engine that never settles aborted work
  would then never be idle. The note says "the engine is quiet", which is the intended meaning.
- 2,499 words by `wc -w`.

### What should be done in the future
- Rerun the slots task with this version; the review should now show whether the chapter runs stop copying the
  release order and the slot lane.

### Code review instructions
- `git diff c2e07f5 54d4d98 -- docs/patterns/04-latest-wins-render-slots.md`; check the sketch against
  `docs/patterns/experiments/tasks/slots/TASK.md` requirements 1–8 and the state diagram.

### Technical details
- Present rule after the change: `fate ≠ aborted` → assert `gen > shownGen`, present, then release the old shown
  result; `fate = aborted` → release; failure → report unless aborted.

## Step 4: Chapter 8, Reach-Declared Tiling

Chapter 8 is the one chapter whose runs were measurably better (9/9 against 6/9 and 7/9 on the hidden tests), and
also the one whose text was most GPU-shaped. The rewrite keeps the heart (declared reach in physical units, paths
add, branches take the maximum, smooth wide kernels as reduced-resolution fields with variance bookkeeping) and
changes the planner's order of preference: exact routes first (whole frame if it fits, haloed tiles on the grid that
minimises total reads, streaming of separable passes through small row buffers), approximation only for what none of
them can carry, and then by splitting a wide kernel into a local part plus a field rather than moving all of it.
Fields become inputs of tiles instead of replacements of the image, so an operation needing its neighbourhood and its
own centre (the reviewers' sharpen) can be expressed. The planner completes and reports; it refuses only when no
route exists.

The star stays ★. The six runs fell into three clusters (B/D/F per-kernel fields, A/E exact streaming tiers, C one
global switch; tiling-r1 `cross.clusters`) and the reviewer called C's single switch a partial worse-is-better
result. That is a good form among several, which is what ★ claims; the Variations now name the other forms (GPU
tiling, demand-driven regions, one reduced image for the whole chain).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Fix chapter 8's defects (refuse vs complete, GPU habits, neighbourhood plus centre, one
frame) and add the listed ideas (read-minimising grid, exact streaming, border handling, local plus residual split,
pre-blur, cost model, chunked fields, whole-frame route), keeping the chapter portable.

**Inferred user intent:** The chapter that already worked should also stop teaching the GPU's habits to CPU code and
should not refuse where the contract says "complete".

**Commit (code):** b6df001 — "Chapter 8 rev1: exact routes first (whole frame, read-minimising tiles, streaming), …"

### What I did
- Tagline, Intent, Problem and Solution rewritten around route choice: exact routes first, approximation last,
  report instead of refuse; fields as tile inputs.
- Forces: "Exact wide kernels against fields" became "Exact against bounded"; "Device limits against generality"
  became "Device habits against portability".
- Applicability: a third "do not use it when" for grid-changing operations, pointing to demand-driven regions.
- Structure: Kernel declaration now includes region evaluation; Budget replaces Device caps; Field has pre-blur and
  border ring.
- Sketch rewritten: `plan` (whole → tiled → streamed → fields loop with local/residual split), `minReads`, `run`
  (fields in dependency order from full-resolution inputs), a sharpen line showing a tile reading its centre and a
  field.
- Notes: v1 1 kept; new 2 (neighbourhood in the declaration); v1 2 extended to graphs (3); new 4 (exact routes);
  new 5 (read-minimising grid; v1 9 on workload-dependent tile size folded in); new 6 (field as input, computed
  from full-resolution input); v1 4 + 5 merged with the local/residual split and the pre-blur (7); new 8 (borders);
  new 9 (integer scales, chunked fields); v1 7 rewritten (10: complete, report, cost model, refuse only when nothing
  fits); new 11 (independent reference, laws, a negative control). v1 3 (+1 px, align to 8) moved into the "GPU
  tiling" variation; v1 6 (statistical fields) and v1 8 (pyramid vs apron) moved into Variations.
- Variations: new "GPU tiling", "One reduced image for the whole chain", "Statistical fields"; "Mipmap fields"
  absorbs the pyramid note; "Two tile grids" dropped (no run or review touched it, and the word budget was needed).
- Validation paragraph; Chapter 3 added to Related chapters.

### Why (evidence per change)
- Refuse vs complete: tiling-r1 `yardstick_problems` 1 ("no implementation refuses"; impl-D, chapter-1, reuses the
  T/4 rule as a classification threshold, `src/index.ts:615-618`).
- GPU habits moved: problems 2 (halo +1 and multiple of 8 would raise reads against the 3× limit), 3 (half the
  budget, power-of-two tiles), 4 (power-of-two downsample; impl-E `:338-349`, impl-C `:461`, impl-F `:344`).
- Field as input: problems 5 and every change request 1 analysis ("A wide sharpen cannot be a field, because the
  field replaces the source", impl-A, B, C, F).
- One frame: problems 6 and change request 2 analyses (W/H global in A, B, D, E; A's backward ROI propagation the
  closest seam).
- Read-minimising grid: tiling-r1 `ideas_the_yardstick_lacks` 1, impl-C (control-2) `:259`, impl-E (control-1)
  `:856`, impl-F (chapter-2) `:249`.
- Exact streaming: ideas 2, impl-A (chapter-3) `:716`, impl-E `:725`, impl-F `:589`.
- Borders: ideas 3, edge corrections in impl-A `:583-693`, impl-D `:309-336`, impl-E `:292-310`; padded ring in
  impl-B `:510`, impl-C `:448-457`, impl-F `:103-109`.
- Local plus residual split: ideas 4, impl-A `:877-886`.
- Pre-blur in the variance budget: ideas 5, impl-C `:463-466`, impl-F `:318-321`.
- Cost model: ideas 6, impl-B `:378-398`, impl-D `:559-584`. Chunked fields: ideas 7, impl-B `:179-199`.
  Whole-frame route: ideas 8, impl-F `:703-711`, impl-B `:320-328`.
- Neighbourhood in the declaration: change request 1 analyses (shotgun surgery: "blur" kind checks across planner,
  streaming tier and compiler in A; the predicate repeated across five helpers in B).
- Field computed from full-resolution input: my reading of change request 1 together with C's weakness ("in a mixed
  chain the narrow blurs and interior gammas are also approximated", `cross.worse_is_better`).
- Tests: per-implementation `tests_as_laws` (independent references in B, C, D, E; the constant-image invariant in
  B and D; "no negative controls" in all six).

### What worked
- Writing the sketch as a preference order made the Solution and Collaborations short: each is the same list.

### What didn't work
- First draft 2,771 words; cut to 2,500 by compressing Motivation (GPU limits), Intent, Variations and notes.
- First draft contradicted itself on the decimation scale: the sketch said "coarsest integer scale with σf / s ≥ 2"
  (v1's rule) while note 9 said "finest affordable". The reviewers' runs (E's binary search for the finest scale,
  F trying 1..64) support "finest affordable"; the sketch now says `s ← finest affordable integer scale, s ≤ σf / 2`.
- The first rewrite of note 5 said Editor lab's two workloads were "about four times faster" at their best size; the
  v1 numbers are 5.8× and 3.5×, so it now says "several times faster".

### What I learned
- The local/residual split makes the field loop terminate naturally: each step either fits the halo with a smaller
  local σ or moves one kernel wholly into a field, so the loop runs at most once per wide kernel.

### What was tricky to build
- Saying where a field's input comes from without a long passage: a field of `gamma(v)` must be decimated from
  full-resolution `gamma(v)`, not computed by running gamma on decimated `v`. The sketch's `run` says "input
  evaluated piecewise at full size", note 6 says why.

### What warrants a second pair of eyes
- The sketch abstracts `tileFits`, `streamable`, `bound(fields)` and "the largest local σ the halo can carry"; check
  that these are concepts an agent can implement and not hidden difficulty.
- The "one reduced image" variation is presented as a legitimate simpler form; the reviewers judged it "the most
  habitable" but weaker on mixed chains.

### What should be done in the future
- Rerun the tiling task with this version, and add the reviewers' change requests (sharpen, downsample2) as hidden
  tests in a second tiling task, since this chapter now claims to handle the first.

### Code review instructions
- `git diff a98d31c b6df001 -- docs/patterns/08-reach-declared-tiling.md`; check the sketch's route order against
  `docs/patterns/experiments/tasks/tiling/TASK.md` requirements 1–4.

### Technical details
- Variance terms in the sketch: `var(decimate, s)` (box of s: (s² − 1)/12 per axis), `var(upsample, s)` (bilinear),
  `var(preblur)`; residual in reduced pixels `/ s`. Constraint `s ≤ σf / 2` keeps the reduced kernel at least two
  reduced pixels wide.

## Step 5: Chapter 9, Vector Edit Document

Chapter 9's core was the most generative of the four: all six document runs stored crop and spot centres as frame
fractions converted once at the tool boundary, validated in one dispatch, made batches atomic by working on a copy,
and kept an append-only journal beside a separate undo structure (document-r1 `cross.generativity`). The review's
complaints were about the machinery the chapter prescribed on top: inverse-recording transactions where replay
(impl-B, chapter-4; impl-E, control-1) or snapshots (impl-C, control-2) were simpler and as correct; per-field paths
(`spots.s7.r`) and unit tags with nothing to attach to; and "migrate, then validate" with the edit schema, which made
impl-A (chapter-3) refuse old documents. So the Solution now says: strict edits, lenient reads; undo as a cursor over
applied units with the state rebuilt by replay or snapshots; inverses only where they pay. The migration chain stays
and is stressed: impl-A was the only design in which version 3 composes.

The star stays ★★ for the same reason as chapters 1 and 4: the core shape was built by every run, the controls
included. The undo mechanism, which did vary, is now a choice inside the pattern, not part of its definition.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Apply RESULTS.md's chapter 9 list (soften inverses, per-field addressing and unit tags;
split strict edits from lenient reads; keep and stress the migration table; add the six listed ideas).

**Inferred user intent:** A document chapter that asks for the machinery a document needs and no more, and that
never refuses an edit the editor once saved.

**Commit (code):** 33233a6 — "Chapter 9 rev1: strict edits and lenient reads, undo by replay or snapshots with
inverses only where they pay, …"

### What I did
- Solution: lengths in one stated unit with a rule for anisotropic renderings; ids never reused; source reference
  beside the document; strict mutation validation and lenient reading; all-or-nothing units, append-only journal,
  undo cursor; replay or snapshots unless the document is too large; migrations as a chain.
- Forces: "Free-form against validated" replaced by "Strict edits against faithful loads".
- Structure: Transaction participant removed; Source reference added; Field schema becomes "the one list of
  fields" with rule, reader, default and unit.
- Collaborations: proposals validated at propose and at approve; compile-and-cache (v1 note 9) moved here.
- Sketch rewritten: `apply` (strict, on a copy), `state` (replay), `edit`, `propose`, `approve`, `reject`, `push`,
  `undo`/`redo`, `preview`/`commitPreview` (net diff), the spot tool with `freshRecordId`, `load` with a migration
  chain and a lenient reader.
- Notes: v1 1 and 3 kept (tightened); v1 2 rewritten (lengths need a rule; unit tags only with a catalogue); v1 4
  rewritten (whole-record addressing, ids never reused, object-machinery ids refused); new 5 (strict edits, lenient
  reads); v1 7 + 8 merged (6: chain, defaults belong to the version); v1 5 extended (7: proposals checked twice);
  new 8 (replay, snapshots or inverses, and history laws); v1 10 extended (9: net diff); v1 6 extended (10: source
  outside the mutable state); new 11 (schema as the one list of fields).
- Variations: "Normalised coordinates" and "Snapshot history" removed (both now in the Solution); "Inverse-recording
  transactions" added.
- GoF line: Command (mutations), Memento (snapshots).
- The Editor lab file reference (`src/workspace.js:410` in its archive) dropped from Motivation: it points into a
  private archive and does not help a reader of a portable chapter.

### Why (evidence per change)
- Inverses softened: document-r1 `yardstick_problems` 4 and `cross.worse_is_better` (B 600 lines and E 642 reach
  A's 945-line quality "with replay-based undo ... no inverses, MISSING sentinel, recordPathOf or diffStates").
- Per-field addressing: problems 3, impl-A `src/index.ts:371-403`, impl-D (chapter-1) `:292-307`; smells
  "speculative generality" in A and D, and impl-F's crop field paths `:226-238`.
- Unit tags without a catalogue: problems 2, impl-A `:322` ("ornamental strings").
- Strict edits, lenient reads: problems 1 and ideas 3; impl-A rejects v1 spots outside the frame
  (`:750-752`); split readers in impl-B `:172-175`, impl-D `:372-376`, impl-F `:296`.
- Migration chain stressed: `cross.worse_is_better` and every change request 2 analysis (only A composes v1 → v2 →
  v3; B, C, D, E, F "no chain").
- Net diff on commit: ideas 1, impl-A `:483-507, :631`.
- Ids never reused: ideas 2, impl-C `:569-594`, impl-D `:478-494`.
- Proposals checked twice: ideas 4, impl-E `:464-465`, impl-A `:561-563`; impl-E's edge-case test "approving a
  proposal against a deleted spot".
- Source outside the mutable state: ideas 5, impl-E `:95-100, :379`.
- Length rule: ideas 6 and problems 5, impl-E `:594` (shorter side), impl-F `:670, :687` (√(sx·sy)).
- `__proto__` ids: ideas 7, impl-B `:204-212`, impl-E `:156-158`.
- History laws: ideas 9, impl-A `test/fuzz.test.ts:25-117`.
- Schema as the one list of fields: every change request 1 analysis ("spelled out in about seven/eight places" in
  A–F; impl-A "cloneState and diffStates list fields by hand, in parallel with the schema").
- Not taken: "snap derived pixels to 1e-6" (ideas 8) is a numerical detail of the task's one-pixel tolerance, not a
  property of edit documents. The "Compiler out of scope" problem (6) is task-specific: the chapter is about
  documents that compile into Chapter 1's graph, so the Compiler stays.

### What worked
- Writing undo as a cursor over a list of unit ids separate from the journal made approve after undo, redo
  discarding and "undone entries stay in the journal" fall out of one `push`.

### What didn't work
- First draft 2,694 words; cut to 2,500 by compressing the notes and the Motivation.
- First sketch said "the same document at three resolutions" above two lines; fixed. `approve` first read
  `s.journal[id]` without saying the entry must be pending; now `pending entry id`.

### What I learned
- The reviewers' "mixed units force an anisotropic rule" (problems 5) is right that a rule is needed, but not that
  mixed units are the problem: a fraction of the width needs the same rule as soon as a rendering's aspect differs.
  The chapter now asks for a stated rule whatever the unit.

### What was tricky to build
- Replay revalidates each unit's mutations against the state it replays onto. That is deterministic (same base,
  same units) and keeps one validator, but it means a stored base read leniently must never be re-checked as a whole
  by the strict schema; `apply` checks only the mutated paths, which is why the sketch validates mutation values,
  not whole documents.

### What warrants a second pair of eyes
- Note 8's claim of when inverses pay (large documents, long histories, undo against a state others changed) is
  argued, not measured in the experiment.
- 2,500 words by `wc -w`, at the limit.

### What should be done in the future
- Rerun the document task with this version and both change requests (gradient mask, version 3) as hidden tests,
  since piecemeal growth was where all six designs were weakest.

### Code review instructions
- `git diff c957e8f 33233a6 -- docs/patterns/09-vector-edit-document.md`; check the sketch against
  `docs/patterns/experiments/tasks/document/TASK.md` requirements 4–7.

### Technical details
- Undo model: `journal` (every entry, append-only), `units` (ids of applied entries in undo order), `cursor`;
  `push` truncates `units` at the cursor, so redo is discarded while the entries stay in the journal.
