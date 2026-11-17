# Validating the patterns with isolated subagents

Four chapters were reviewed by isolated `pi` subagents running DeepSeek 4.1 flash (`lunaroute/deepseek-4.1-flash`,
thinking high), following the go-go-parc handbook *Running pi coding agents as measured subagents*
(`Research/playbooks/pi-coding-subagents-handbook.md`). The aim was to check that the chapters are understood as
written, and that a reader can apply each pattern in a domain the chapter does not mention, which is the test of a
reusable pattern rather than a project description.

## Method

- **Isolation.** One run per chapter: `pi -p --mode json --no-builtin-tools --no-context-files --no-skills
  --no-prompt-templates`, no MCP tools, the chapter and the task in one saved prompt (`run-review.py`).
- **Controls.** Five comprehension questions per chapter: four whose answers are in the chapter, and one whose answer
  is *not* (the correct answer is "not stated in the chapter"), to detect invented answers.
- **Transfer.** Two contexts per chapter from colour, GPU or generative image editing, outside the chapter's own
  examples; the agent maps the participants, sketches the design, names the most important implementation note and
  says where the pattern fails or needs adapting.
- **Review notes.** Whether the Solution stands alone; what is unclear, wrong, missing or too long; suggested edits.
- **Output contract.** One fenced JSON block, extracted defensively (raw newlines inside strings, and unescaped quotes
  inside prose, both repaired; the second repair was needed for chapter 1).

## Runs

| Chapter | Contexts | Controls correct | "Not stated" trap | Understanding | Usefulness | Portability |
|---|---|---|---|---|---|---|
| 1 Interned Operation Graph | VFX node compositor on a render farm; WebGPU shader-graph variants | 5 / 5 | refused correctly | 0.93 | 5 | 5 |
| 4 Latest-Wins Render Slots | grading scopes during wheel drags; streaming diffusion previews | 5 / 5 | refused correctly | 0.93 | 5 | 5 |
| 9 Vector Edit Document | generative inpainting editor; per-shot video grades with tracked windows | 5 / 5 | answered "no total stated" | 0.82 | 5 | 4 |
| 11 Kits with Policy Passes | AI tool packs with a forensic workspace rule; film-emulation node placement | 5 / 5 | refused correctly | 0.86 | 4 | 5 |

Each run produced 21–34 review items and two worked applications; about 16–18 k tokens per run.

## What the reviews changed

The reviewers found real defects. Every finding below was checked against the code or the chapter before it was
applied; two were rejected or reframed with evidence.

- **Chapter 1.** The sketch broke its own rule (input ids concatenated without length prefixes): fixed by stating they
  are fixed-width. The Solution said node references are replaced by ids but not that they become inputs: fixed. New
  notes on number canonicalisation, versioning of canonicalisation, and collision handling (store canonical bytes,
  compare on hit). Known uses qualified (libvips's cache is in-process; value numbering is "the same idea in compiler
  form"). Thirteen notes merged to ten.
- **Chapter 4.** The reviewer showed that a same-key request would render twice; the code confirmed the originating
  project does exactly that and relies on its result cache. The sketch now adopts the running render, initialises
  slots, handles failures and releases stale results; two new notes record the project's behaviour. Two new
  variations came from the transfer exercises: one generation for dependent views (scopes), and ordered streams
  (diffusion steps). The React known use was hedged.
- **Chapter 9.** The Solution now defines the field schema, the inverse of a mutation and a default for units;
  undo-after-edit and rendering of pending proposals are stated as explicit decisions; a hybrid variation stores
  non-reproducible pixels (generated inpainting) as content-addressed assets. The reviewer called the Editor lab claim
  doubtful; it is true (`src/workspace.js:410` in its archive) and is now cited. The darktable and OpenTimelineIO
  known uses were qualified.
- **Chapter 11.** "Shell" is defined; every example report now carries all its fields, with the originating
  project's real codes (CK-X140, CK-X141, CK-X150, X130, X131); a new note names the project's debt of matching
  module labels by regular expression; notes on testing passes and on negative rules being shell-installed; two
  variations from the transfer exercises (validate on every change; path rules over node graphs).

Lessons applied to the chapters written after the reviews (7–12): gloss each project at first mention, define every
term the Solution uses, state lifecycles and error paths, and hedge known uses.

## Files

- `run-review.py` — one isolated run: prompt assembly, `pi` invocation, defensive extraction.
- `spec-01.json`, `spec-04.json`, `spec-09.json`, `spec-11.json` — chapter, contexts, questions.
- `answers/` — the extracted answers of each run.
