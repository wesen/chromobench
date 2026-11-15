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
