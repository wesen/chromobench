---
Title: Diary — chapters 5 and 6 (Solve Once, Apply Many; Work in Small Slices)
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
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/modular/05-solve-once-apply-many.md
      Note: chapter 5, written in this diary
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/modular/06-work-in-small-slices.md
      Note: chapter 6, written in this diary
ExternalSources: []
Summary: "Writing chapters 5 and 6 of the modular pattern language: sources surveyed, claims checked against chromobench (chb037 integration tree) and Editor lab, what was removed or reworded."
LastUpdated: 2026-11-15T18:00:00-05:00
WhatFor: "Review trail for chapters 5 and 6: every claim about the example programs with its file:line."
WhenToUse: "When revising chapters 5 or 6, or checking one of their numbers."
---

# Diary

## Goal

Record how chapters 5 ("Solve Once, Apply Many", ★★) and 6 ("Work in Small Slices", ★) of the modular pattern
language were written: the sources read, every claim about chromobench and Editor lab with the file and line it
rests on, what could not be verified and was removed or reworded, and the choices made.

Paths below use two roots:

- `CB` = `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037`
  (chromobench integration code, read only)
- `EL` = `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/editor-lab-src/editor-lab-work/editor-lab`
  (Editor lab, read as data only)

## Step 1: Survey of sources

I read the overview (names, numbers, conventions, audience), the parent volume's chapters 4 (Latest-Wins Render
Slots) and 6 (Tabulated Preview, Exact Export) for style and to avoid duplicating them, then the code and docs
named in the brief. The survey changed two things in the plan: chromobench's four binding times are not the
"per document, per edit, per frame, per pixel" of the brief but build / compile / interaction / pixel, and
chromobench does have time-budgeted idle work and stage-level cancellation, just not a frame-budget slicer for
renders.

### Prompt Context

**User prompt (verbatim):** "Resume: the owner approved the ten patterns as listed in the overview. Carry out your
original brief in full (chapters 5 and 6, diary, verification, report). Nothing changed in the brief." (The
original brief came from the coordinating agent: write chapters 5 and 6 to the template, verify every claim
against chromobench and Editor lab, keep this diary, do not commit.)

**Assistant interpretation:** Write `05-solve-once-apply-many.md` and `06-work-in-small-slices.md` in
`docs/patterns/modular/`, following the overview and the template, with all example-program claims checked, and
document the work here.

**Inferred user intent:** A teaching volume whose two "where the work happens" chapters are general, honest about
the example programs' debts, and checkable.

### What I did

- Read `docs/patterns/modular/00-overview.md` (whole), `docs/patterns/04-latest-wins-render-slots.md` and
  `docs/patterns/06-tabulated-preview-exact-export.md` (whole), `~/.codex/skills/diary/SKILL.md`, and the sibling
  diary's frontmatter.
- chromobench, chapter 5 sources:
  - `CB/packages/core/src/print/retouch.ts:1-25` header (f64 reference; GPU takes per-spot coefficients from
    `healCoefficients()`; "both engines share every number that is not per pixel", line 3-4; closed-form Poisson
    solution, Lanczos σ-factors, lines 14-21); constants `HEAL_N = 32` (:45), `HEAL_M = 8` (:47),
    `HEAL_RINGS = [0.5, 1.5, 2.5]` (:49), `HEAL_WINDOW_MARGIN = 4` (:54); `healCoefficients` (:83-116, layout
    `2(M+1)·channels` = 54 numbers for 3 channels); per-pixel `healOffset` (:119-135); `exp(u)` in the linear
    encoding (:181).
  - `CB/packages/gpu/src/retouch.ts:1-15` (split explained), `STRIDE = 22` vec4s per spot (:23), `coefficients()`
    calls core's `healCoefficients` on read-back windows (:69-76), `SpotRun` memoises windows and coefficients for
    one `apply()` call only (:120-123, :172-183, :241-245), record packing 16 floats + 18 vec4 (:231-232).
  - `CB/packages/gpu/src/engine-gpu.ts:673-679`: a new `apply()` per evaluation of the heal node; no cache of
    coefficients outside it. `renderRegion` (:735-750) has no region-level result cache for this node.
  - `CB/packages/gpu/src/film.ts:1-5` ("Every binding … comes from @chromobench/core's *At(ctx, args) helpers, the
    same ones the reference engine's adapters use"); `packUniforms` 128-byte block (:36-47); pipelines keyed by
    entry point (:116); film table and curve buffers keyed by `table:${key}` / `curves:${key}` (:226, :232).
  - `CB/packages/core/src/ops/film.ts:1-4, 31-95`: the `*At` helpers.
  - `CB/packages/core/src/film/upsample.ts:4-7` (inner products folded into a per-film table; per pixel
    `raw = b · table(u, v)`), `buildFilmTable` (:202-219, gamut compression baked in); `NW = 81`
    (`CB/packages/core/src/spectral/spectrum.ts:20`); `makeFilmModel` (`CB/packages/core/src/film/forward.ts:46-55`),
    cached per film id (`CB/packages/core/src/ops/ops.ts:81-82`).
  - `CB/packages/gpu/src/measure.ts:1-2, 13-22, 33-34, 64-73` (16 × 16 workgroups, partials summed pairwise in f64)
    and `CB/packages/gpu/kernels/reduce.wgsl:1-3` ("so the f32 error stays near log2(n) roundings"), :30-53.
    Note: the kernel is at `packages/gpu/kernels/reduce.wgsl`, not `packages/gpu/src/kernels/` as the brief said.
  - `CB/packages/gpu/src/tables/keys.ts:1-4` ("a data-pack update changes the key without anyone bumping a
    version"; domain and N always in the key); `manager.ts:1-2`, `cache.ts:2` (memory → OPFS → build).
  - Binding times: `git -C /Users/manuel/code/wesen/chromobench show task/chb-035-digital-editing-design:ttmp/2026/11/14/CHB-035--…/design/01-digital-editing-in-chromobench.md`,
    lines 114-116 and §31 lines 1040-1077 (build β, compile κ per frame, interaction τ θ ƒ ρ, pixel none;
    decision D6, status "proposed"; "Editor lab stored per-pixel code").
- chromobench, chapter 6 sources:
  - `CB/packages/output/src/export/run.ts:1-8` (plan → tiles → bands → encoder; cancellation before every tile; no
    partial file), :136-165 (band loop, signal check :143), :178-183 (sink aborted, "cancelled after k of n
    tiles").
  - `CB/packages/output/src/encode/sinks.ts:1-3` (no export holds the whole file), :13-14 (`abort()` "Deletes what
    was written").
  - `CB/packages/gpu/src/tiles.ts:117-125`: tile halved while `(T + 2·halo)² · bpp > budgetBytes / 2`.
  - `CB/packages/shell/src/app/render/queue.ts:1-10` (slots, generation, live/bg lanes), :65-76 (`progressMs`,
    `preemptBackground`), :130-170 (preempt; the CHB-031 F22 comment: an idle-callback re-queue "ran ≈ 10 000
    times a second"), :299-322 (`DRAFT_PIXELS = 500_000`, comment "adapted towards ≈30 ms by the viewport",
    `chooseTarget`).
  - `CB/packages/shell/src/dom/viewport/render.ts:50`: `chooseTarget` is called without `draftPixels`; a grep for
    `draftPixels|DRAFT_PIXELS` over `packages` and `apps` finds only `queue.ts` and the index re-export. So the
    draft size is never adapted.
  - `CB/apps/studio/src/main.ts:338-343`: `progressMs = 250`, `preemptBackground = true` (comment also claims
    drafts "sized to ≈150 ms", not implemented either).
  - `CB/packages/shell/src/core/cells.ts:188-213` (`runIdle`: at most 12 ms unless the deadline timed out; only
    tasks queued before the run); `CB/packages/shell/src/core/clock.ts:1-40` (rAF / rIC with timer fallbacks).
  - `CB/packages/core/src/engine-ref.ts:51-54` (yield between stages), :410-425 (`staged`: signal checked after
    each stage; "Finished stages stay cached; nothing partial is kept"); `CB/packages/gpu/src/engine-gpu.ts:964`
    ("nothing partial enters the cache"); `CB/apps/studio/src/host/worker-engine.ts:1-5` and
    `engine-serve.ts:8, 29-31` (reference engine in a worker, MessageChannel macrotask yield).
  - CHB-037 numbers (`CB/ttmp/2026/11/14/CHB-037--…/`): `diary/14-phase-p3b-engines.md:113-121` (cause of the
    4.2 s: `output.frame` not on the grid; fix), :155 (`output.display` ≈ 1.5 s at full size), :168-169 ("step
    4.2 s → 1.37 s (grid) → 0.74 s (bisection, look3)"), and the test "with no print stage at full resolution"
    (same step, What I did); `diary/01-diary.md:850` ("~781 ms to ~1650 ms (48 haloed 512 px tiles … instead of
    12 tiles of 1024 px)"); `reference/02-integration-report.md:152-158` (plain print preview 21.4 ms, export
    244.8 ms, 12 tiles of 1024; darkroom preview 107.3 ms, export 1650 ms, 48 tiles of 512 with a 64 px halo;
    Metal, 4000 × 2674).
- Editor lab:
  - `EL/src/engine.js:7-15` (sRGB transfer as two `Float32Array(4097)` tables, nearest entry), :197-209
    (`curveLut`, 1,024 entries; `lutAt`), :238 (curves `prep: curveLut`), :231-233 (exposure: `Math.pow(v, g)` per
    pixel when gamma ≠ 1), :468 (`prep()` cached per layer in a WeakMap, rebuilt when the layer hash changes),
    :635 (`ctx.prep`), :325 (code layers carry user `fn`/`prep`).
  - `EL/src/app.js:57-118` (the `Render` object: `sliceMs: 8`, 220 ms interactive window, coarse level 2 with the
    12 ms / 2.5 ms adaptation between levels 1 and 3, `estFullMs < 12` runs all, `order()` visible-centre first,
    queue replaced on a new pass), :248-250 (header pill "refining", tiles to go).
  - `EL/src/book/07.md` whole (frame budget 16.7 ms, 280 ms cold render, tile costs 2.2 / 7.1 / 24 ms; §7.2 preview
    numbers 259 → 12.7 ms median, 287 → 28 ms p95, settle 287 ms; §7.3 GIMP rule and the 266 ms overshoot; §7.4
    priorities and `scheduler.yield` support; §7.5 cancellation, darktable's half-average rule, Chromium;
    §7.8 the 45 ms / 45–102 ms / 74 ms case; "Toward a reusable API").
  - `EL/src/book/05.md` §5.2 (22 % slower at 64 px than 256 px for the scrub; 150 vs 12 tiles), §5.5 (the lab
    renders level 0 at every zoom); `08.md` §8.6 (parameters baked into WGSL; 79 ms compile per parameter change;
    uniforms as the production fix); `09.md` §9.5–9.8, §9.11.

### Why

- Each chapter's Motivation and notes had to rest on numbers that exist in the code or the project's own reports,
  not on the brief's summary of them.

### What worked

- Every number the brief named was found: 4.2 s → 0.74 s and ~780 → 1650 ms (as ~781 → ~1650 ms).

### What didn't work

- `ls $C/ttmp/2026/11/14/CHB-037*` failed under zsh globbing from a non-matching path; listing the parent
  directory and grepping worked. `grep --include=*.ts` failed with "no matches found" (zsh expands the glob); I
  used plain `grep -rn` with a path filter instead.
- One early Bash call (reading the ticket dir with a glob) was rejected by the user; work resumed after the
  coordinator's "Resume" message.

### What I learned

- chromobench's "four binding times" (CHB-035 §31) are build, compile (per frame), interaction, pixel, and the
  design is still "proposed". The chapter names those four and uses the brief's per-document/per-edit/per-frame/
  per-element scale only as the general sketch.
- The heal coefficients are memoised only inside one `apply()` call: a real binding-time debt (chapter 5, note 7).
- The draft size comment ("adapted towards ≈30 ms") describes code that does not exist (chapter 6, note 9).

### What was tricky to build

- Deciding what "chromobench has no frame-budget slicer" means precisely. It has a 12 ms idle-task budget
  (`cells.ts:205`), stage-level cancellation with a yield in its worker, and a progress rule; what it lacks is
  slicing *one render* into budgeted steps with progressive display. The chapter says exactly that.

### What warrants a second pair of eyes

- Chapter 5, note 7 (coefficients re-solved per call and per export tile). I traced `engine-gpu.ts:673-679` and
  `renderRegion` and found no cache that would avoid it, but did not run an export to count solves.
- Chapter 6, note 8's "roughly 34 ms per tile" is my division (1,650 ms / 48 tiles); the 1,650 ms also contains a
  field pass and encoding.

### What should be done in the future

- N/A for this step.

### Code review instructions

- Compare each cited line above with the chapter text.

### Technical details

- Arithmetic used in chapter 5: 32 angles × 3 rings × 2 images × 3 channels = 576 bilinear samples per solve;
  π · 40² ≈ 5,027 pixels; 3 × 81 = 243 multiply-adds per pixel for the unfolded film exposure; 2 · (8 + 1) · 3 =
  54 coefficients; 4 + 18 = 22 vec4 per GPU spot record.

## Step 2: Drafting chapter 5, Solve Once, Apply Many

I wrote the chapter around the heal tool because it shows every part of the pattern at once: a rare solve (per
spot), a shared careful solver (core, f64), a per-pixel formula written twice (TS and WGSL), and a prepared value
with a fixed layout. Folding (the film table), passing values as data (uniforms vs. Editor lab's baked shader
constants), and the reverse direction (device partials, host pairwise sum) are notes.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Draft chapter 5 to the template, 1,800–2,800 words.

**Inferred user intent:** A ★★ chapter that a student can apply to non-image code.

### What I did

- Wrote `docs/patterns/modular/05-solve-once-apply-many.md`: Motivation with four failures (repeated solve,
  engines disagreeing, hard code in the shader, Editor lab's binding-too-early shader compile), prepared statements
  and skinning as other domains; six forces; a solution naming binding times; a 7-node mermaid flowchart; a generic
  sketch (binding-time comment block, `solve`, `apply`, `reduce`, `pairwiseSum`, then heal in use); ten notes;
  four variations; known uses.
- Trimmed from about 3,000 to about 2,800 words of prose (outside code blocks): merged the "count the crossing"
  note into the memoisation note, shortened the oracle note, cut a consequence bullet.

### Why

- The binding-time list in the sketch (data, document, edit, frame, element) is the general form; chromobench's
  four named times are reported as they are in note 1, with the design's status.

### What worked

- Every per-pixel/per-spot split in the example code is stated in its own header comments, so the quotes are
  exact.

### What didn't work

- N/A

### What I learned

- Editor lab's exposure layer still evaluates `Math.pow` per pixel when gamma ≠ 1 (`engine.js:233`); used as a
  small, honest example of a missed per-edit table.

### What was tricky to build

- Keeping the sketch portable: it uses `stage.solve` / `stage.formula` and only names the seam in the "in use"
  lines, as the overview's sketch does.

### What warrants a second pair of eyes

- Exercise 3's slope "about 12.9" near black is the linear segment of the sRGB curve (12.92); the expected answer
  (half of 1/4096 × 12.92 × 255 ≈ 0.4 of an 8-bit level) is my arithmetic, not a measurement in either program.

### What should be done in the future

- N/A

### Code review instructions

- Start at Implementation notes 2, 7 and 8; check against `retouch.ts` (both packages) and `measure.ts`.

### Technical details

- Known uses kept: GCC/LLVM loop-invariant code motion; Futamura (1971); Jones, Gomard, Sestoft (1993); MetaML;
  SQL prepared statements; FFTW plan/execute; skeletal animation per-bone matrices; `re.compile`; NumPy pairwise
  summation. Considered and left out: batch-norm folding in inference engines (true, but I did not want to name a
  specific product without checking), OpenColorIO LUT baking (already in the parent volume).

## Step 3: Drafting chapter 6, Work in Small Slices

I built the chapter on Editor lab's renderer and textbook chapter 7 (coarse first, 8 ms slices, visible-centre
order, cancellation between tiles, GIMP's adaptive chunks), and on chromobench's tiled export (bands, cancel before
every tile, sink abort). chromobench's missing interactive slicer gets its own note with the cost stated.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Draft chapter 6 to the template; be honest about chromobench's missing frame-budget
slicer.

**Inferred user intent:** Students should see a working slicer, a batch slicer, and what happens without one.

### What I did

- Wrote `docs/patterns/modular/06-work-in-small-slices.md`: Motivation from the 280 ms render (four failures),
  with spell-checking, map tiles and incremental GC as other domains; six forces; solution; a 10-node mermaid
  flowchart of one slice; a sketch with request, slice, adaptive size and the batch export loop; ten notes;
  four variations (offload, adaptive chunks, darktable's age rule, progressive formats).
- Note 3 uses the CHB-037 CPU preview fix as "coarse must really be coarse": the reduced render secretly ran a
  stage at full resolution.
- Note 9 states what chromobench lacks and what it costs on each engine.
- Trimmed to about 2,800 words of prose.

### Why

- The CPU preview fix belongs here rather than in chapter 5: it is a failure of the coarse-first half of the
  pattern, caught by a test that checks no stage of a reduced render runs at full resolution.

### What worked

- The export's code comments match the pattern's language almost word for word ("one band of tiles at a time",
  "the signal is checked before every tile", "no partial file").

### What didn't work

- N/A

### What I learned

- Editor lab has no explicit generation counter. Its "cancellation by generation" is queue replacement; it is safe
  because the queue holds positions and every step reads the current document. The chapter says so.
- chromobench's export tile size is set by memory (`tiles.ts:120`), so its cancel latency is a side effect of the
  memory budget.

### What was tricky to build

- The GPU engine's print previews (21.4 ms plain, 107.3 ms darkroom at 4000 × 2674) come from the bench in the
  integration report; they are not draft renders. The chapter calls them "print preview" and does not claim a
  draft time.

### What warrants a second pair of eyes

- Known use "React's concurrent rendering … yields to the browser between units of work": stated without the
  yield interval, which I am not certain of for the current version.

### What should be done in the future

- chromobench: either implement draft adaptation or fix the comments at `queue.ts:299` and
  `apps/studio/src/main.ts:338` (not done: read-only tree, and outside this ticket).

### Code review instructions

- Start at Implementation notes 3, 8 and 9.

### Technical details

- Known uses kept: GIMP `gimpchunkiterator.c`; React concurrent rendering; `requestIdleCallback` (W3C Cooperative
  Scheduling of Background Tasks); progressive JPEG; browser incremental rendering and Chromium's tile priorities;
  darktable preview pipe and between-module cancellation; V8 incremental marking.

## Step 4: Verification

I checked the template's section order, the word counts, the links, the mermaid syntax by reading, and re-checked
each number in the chapters against the lines listed in Step 1.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Verify before reporting.

**Inferred user intent:** Nothing in the chapters should be unsupported.

### What I did

- Section order: `grep -n "^## "` on both files gives Intent … Exercises in the template's order.
- Word counts (`wc -w`; prose outside code blocks in brackets): chapter 5 3,079 [2,812]; chapter 6 3,114 [2,820]. Siblings for comparison: chapter 1 [2,669], chapter 7 [2,827], chapter 9 [2,667].
- Links: on the first check `02-one-declaration-many-readers.md`, `08-count-what-you-own.md` and
  `10-measure-from-the-users-clock.md` did not exist yet (other writers' chapters); on the final check all
  relative links in both chapters resolve, including the parent volume's `../04`, `../06`, `../07` and `../08`.
- Mermaid: no CLI is installed (`mmdc` not found) and running one would start a headless browser, so I checked by
  reading: chapter 5 `flowchart LR`, 7 nodes, quoted labels; chapter 6 `flowchart TD`, 10 nodes, `-- yes -->` edge
  labels, `{"…"}` decisions.
- Privacy: neither chapter mentions any photo, file name or person; "the photographer" from my first draft was
  changed to "a user"; the 1024 × 683 image in chapter 6 is the synthetic test negative of the CHB-037 bench.

### Why

- The brief asks for file:line evidence for every example-program claim and real known uses.

### What worked

- All numbers matched their sources.

### What didn't work

- Removed or reworded during verification: "a 3,000 × 2,000 readback takes 26 ms" (in the parent volume, not
  re-verified here, dropped); "halves the tile until it fits" made precise from `tiles.ts:120`; "rotation" replaced
  by "orientation" (a straightened frame keeps the full-resolution path, so rotation by an angle is not what moved
  onto the grid); a direct quote of the reduce kernel's comment was restored to its exact words ("near log2(n)
  roundings").

### What I learned

- N/A

### What was tricky to build

- N/A

### What warrants a second pair of eyes

- The overview needs no change. One optional addition: its "same language in other systems" table could gain a
  column for chapter 6 (a compiler's incremental compilation, a web service's streaming responses), but nothing is
  wrong as it stands.

### What should be done in the future

- N/A (links re-checked after chapters 2, 8 and 10 appeared).

### Code review instructions

- `awk '/^```/{c=!c; next} !c' FILE | wc -w` for prose word counts.

### Technical details

- N/A
