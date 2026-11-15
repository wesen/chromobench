# Construction experiments: results

Four tasks, one per pattern chapter; per task four runs with the chapter and two controls without it (DeepSeek 4.1
flash via pi); hidden acceptance tests; go-minitrace transcript analysis; one blind design review per task by an Opus
subagent with the Alexander / Gabriel / Fowler rubric (playbook §6). Graph and document ran under harness v1, tiling
and slots under harness v2 (README "Harness v2"); within a task all runs share one harness.

Files: `results-v1.json`, `results-v2.json` (scores), `reviews/<task>-r1.{prompt.md,answer.json,key.json}` (the blind
reviews and their keys), `unblind.py`, `extract.py`.

## Hidden tests

| Task (chapter) | Chapter runs | Controls | Discriminates? |
|---|---|---|---|
| graph (1, Interned Operation Graph) | 19/19 ×4 | 19/19 ×1 (one control lost to the provider) | no |
| slots (4, Latest-Wins Render Slots) | 17/17 ×4 | 17/17 ×2 | no |
| tiling (8, Reach-Declared Tiling) | 9/9 ×4 | 6/9, 7/9 | **yes**: both controls fail the wide-blur tests |
| document (9, Vector Edit Document) | 16/16 ×4 | 16/16 ×2 | no |

## Blind design reviews

Each reviewer saw the chapter as the yardstick and the implementations as impl-A…F, without knowing which had the
chapter. Scores are the sum of seven lenses (forces, adapted, wholeness, habitability, piecemeal growth, smell-free,
tests as laws), 1–5 each, maximum 35. "Guess" is the reviewer's probability that the author had read the chapter,
asked after scoring.

| Task | Ranking, best first (run: score) | Guess: chapter runs / controls |
|---|---|---|
| graph | ch-4 27, ch-3 28, ch-2 25, ch-1 22, **control 22** | 0.85–0.90 / 0.10 |
| tiling | ch-4 22, ch-2 24, ch-1 21, ch-3 21, **ctl-2 22, ctl-1 18** | 0.85–0.95 / 0.10–0.15 |
| document | ch-3 24, ch-1 23, ch-4 24, **ctl-1 23, ctl-2 21**, ch-2 17 | 0.85–0.97 / 0.15 |
| slots | ch-4 26, ch-2 27, **ctl-1 28**, ch-1 24, ch-3 23, **ctl-2 25** | 0.75–0.90 / 0.15–0.30 |

**The chapters visibly shape the code in every task**: the reviewers separated chapter runs from controls perfectly
(every chapter run above 0.5, every control below). **Whether the shape is better depends on the chapter**: graph and
tiling rank all chapter runs above the controls (tiling also in the hidden tests); document and slots are mixed, and
in slots the best-scoring design is a control.

## What each chapter should change (from the reviews, with the evidence in `reviews/`)

### Chapter 1 — Interned Operation Graph

- Keep: registry, canonicaliser, length-prefixed full hash, flat inputs-first closure, cache keyed by id and target.
- Remove or soften: verify-on-hit for a 256-bit hash (adds a stored field for no practical safety); format versions
  that nobody checks (say: check on import, or do not write one); the quantisation note (conflicts with "different
  computations, different ids"); "cache only chosen checkpoints" (wrong where every node must be reusable).
- Add: an import that recomputes every id and refuses mismatches in a validation pass before any interning
  (all-or-nothing); explicit-stack walks for long chains; an op's normalisation and execution kept together so a new
  op is one edit; independent reference implementations in tests; a separate-process test.

### Chapter 4 — Latest-Wins Render Slots

- Fix: the lane belongs to the render (the request), not to the slot; the sketch's present step releases the old
  result before presenting the new one: present first, then release; specify `close()`: an aborted render keeps
  occupying its slot until it settles (so a reopen cannot run two renders), the shown result is released once, and
  whether `idle()` waits for aborted renders.
- Add: a per-render "must present" flag set by the progress rule and revoked by abort (simpler than relying on the
  generation comparison alone); walls around user callbacks; a re-entrancy guard on the pump; a synchronous throw from
  `render` is a failure; results held in a box so `undefined` results are tracked; never adopt an aborted render; an
  aborted live render does not block background work; the fuzz liveness law (the last request of an open slot ends on
  screen).

### Chapter 8 — Reach-Declared Tiling

- Fix: "refuse with a diagnostic" contradicts a contract that must complete; power-of-two tiles in half the budget
  and halos rounded to multiples of 8 are GPU habits that add reads on a CPU (move them to a GPU variation); a field
  that replaces the source cannot express an op that needs its neighbourhood and its own centre (sharpen): say so,
  and give the shape that keeps both; the chapter assumes one frame (a grid-changing op needs region mapping).
- Add: choose the tile grid by minimising total reads; an exact streaming path (ring buffers, full-width strips)
  before any approximation; clamped borders dominate field error for wide kernels (edge corrections or a padded ring);
  split a wide Gaussian into a truncated local part plus a residual field (variances add); an anti-alias pre-blur
  counted in the variance budget; a cost model; chunked fields; a whole-frame route when the image fits.

### Chapter 9 — Vector Edit Document

- Soften: inverse-recording transactions are more than a small document needs (replay or snapshots are simpler and
  correct; say when inverses pay); per-field record addressing (`spots.s7.r`) and unit tags without a catalogue to
  attach to are speculative here; "migrate, then validate with the edit schema" refuses documents the editor once
  accepted: read stored values leniently, validate edits strictly.
- Keep and stress: the migration table (the only design where a version 3 composes).
- Add: commit a drag as the net diff between committed and preview state; never reuse an id named anywhere in the
  journal; revalidate a proposal at approve time; keep the source reference outside the mutable state; an explicit
  rule for lengths under anisotropic renderings; refuse ids like `__proto__`.

## Harness findings (for the playbook)

- v1 lost 8 of 24 runs to the harness (a prescribed test command that fails on Node 24, no timeout on commands, a
  runner that orphaned test processes, 5-minute 429 stalls with 26 agents on one account). v2 (`supervise.py`, a
  prompt that states time and the watchdog, retried provider failures, 4 in parallel) finished 12 of 12, diaries from
  turn 4–5 instead of 21–34, no stalls.
