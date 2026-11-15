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
