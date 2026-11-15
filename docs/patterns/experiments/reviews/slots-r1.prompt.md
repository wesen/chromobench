# Role and task

You are a senior software designer doing a design review in the spirit of Christopher Alexander (forces, wholeness,
generativity), Richard Gabriel (habitability, piecemeal growth, worse is better) and Martin Fowler (code smells).

The review directory `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/pattern-review/slots-r1` holds six independent implementations of one task: impl-A, impl-B, impl-C, impl-D, impl-E, impl-F. Each has `src/` and `test/`. `TASK.md` is
the task they were given. `CHAPTER.md` is a design-pattern chapter for this kind of problem: use it as the yardstick
for what forces exist and what a good structure resolves, not as a checklist to tick. `FACTS.md` gives sizes. Some
words were replaced by "[ref]" in the code; ignore that.

Work only inside the review directory, read-only: do not read, list or search anything outside it, and do not change
any file. Read `TASK.md` and `CHAPTER.md` first, then read every implementation's `src/`
completely, and enough of each `test/` to judge it. Cite evidence as `impl-X/path:line`. Judge only what the code shows.

# Rubric (for each implementation)

- **Forces resolved** (Alexander): which of the chapter's forces does the code resolve, which does it leave in
  tension, which does it never notice? The trade-off must be visible in code, not only in comments.
- **Adapted, not copied** (Alexander): is it shaped by this task's context (names and structure from the task's
  domain), or a transcription of a generic sketch, including parts this task does not need?
- **Wholeness** (Alexander): does every part serve the whole? Name dead, unused or ornamental structure.
- **Habitability** (Gabriel): could a newcomer live in this code and change it comfortably? Over-compressed or
  over-abstracted? Look at locality of change, names, size of units, density.
- **Piecemeal growth** (Gabriel): for each change request below, list the places it would touch and say whether the
  change is local.
- **Smells** (Fowler): duplicated knowledge, long functions, primitive obsession (for example ids built by string
  concatenation), shotgun surgery, speculative generality; concrete `file:line` findings.
- **Tests as laws:** do the tests state the forces as properties and negative controls, or only examples?

Score each lens 1 (poor) to 5 (excellent); `smell_free` 5 means no smells.

# Change requests (piecemeal growth)

1. Add a pass `proof` that is never aborted by newer requests and is presented even when stale is otherwise dropped (soft-proof renders the user explicitly asked for).
2. Allow at most 2 background renders to run at once across all slots.

# Across the implementations

- **Generativity:** did similar structure emerge (same seams, same participants), each different in detail? Group
  the implementations into clusters of similar design.
- **Worse is better** (Gabriel): did a simpler, smaller implementation reach the same quality? Then the yardstick may
  ask for too much.
- Rank the implementations, best first. List good ideas in the code that the chapter lacks, and places where
  following the chapter would have hurt this task.
- **Last, after all scores are written:** for each implementation, estimate the probability (0 to 1) that its author
  had read `CHAPTER.md` while working. Some did and some did not.

# Output contract

Your final message must be exactly one fenced ```json block with this shape, one entry per implementation
(A, B, C, D, E, F), every field filled:

```json
{
  "implementations": {
    "A": {
      "summary": "two sentences: the design",
      "seams": [
        "the main internal interfaces, file:line"
      ],
      "participants": {
        "<participant named in CHAPTER.md>": "file:line of its counterpart, or 'absent'"
      },
      "forces": {
        "resolved": [
          "force: how, file:line"
        ],
        "in_tension": [
          "..."
        ],
        "unnoticed": [
          "..."
        ]
      },
      "adapted_not_copied": "is it shaped by this task, or a transcription of a generic sketch? evidence",
      "wholeness": [
        "dead, unused or ornamental structure, file:line"
      ],
      "habitability": "could a newcomer change it comfortably? evidence",
      "change_requests": [
        {
          "change": 1,
          "touches": [
            "file:line"
          ],
          "local": true,
          "notes": "..."
        }
      ],
      "smells": [
        {
          "where": "file:line",
          "smell": "duplicated knowledge | long function | primitive obsession | shotgun surgery | speculative generality | other",
          "note": "..."
        }
      ],
      "tests_as_laws": "do the tests state properties and negative controls, or only examples? evidence",
      "scores_1to5": {
        "forces": 0,
        "adapted": 0,
        "wholeness": 0,
        "habitability": 0,
        "piecemeal_growth": 0,
        "smell_free": 0,
        "tests_as_laws": 0
      }
    }
  },
  "cross": {
    "generativity": "did similar seams and participants emerge across implementations, each different in detail?",
    "clusters": [
      [
        "A",
        "C"
      ],
      [
        "B"
      ]
    ],
    "worse_is_better": "did a smaller implementation reach the same quality with less? which, and why",
    "ranking": [
      "best first"
    ],
    "ideas_the_yardstick_lacks": [
      "good ideas in the code that CHAPTER.md does not describe"
    ],
    "yardstick_problems": [
      "where following CHAPTER.md would have hurt this task"
    ]
  },
  "guess_yardstick_used": {
    "A": 0.0
  },
  "confidence": 0.0
}
```
