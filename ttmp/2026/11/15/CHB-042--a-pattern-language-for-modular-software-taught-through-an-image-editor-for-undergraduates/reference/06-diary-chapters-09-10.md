---
Title: Diary — chapters 9 and 10 (Keep What Is Dear; Measure From the User's Clock)
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
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/modular/09-keep-what-is-dear.md
      Note: chapter 9, written in this diary
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/modular/10-measure-from-the-users-clock.md
      Note: chapter 10, written in this diary
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/modular/00-overview.md
      Note: names, numbers, conventions (read only)
ExternalSources: []
Summary: "Writing chapters 9 and 10 of the modular pattern language; sources surveyed, claims verified against code."
LastUpdated: 2026-11-15T18:00:00-05:00
WhatFor: "Record of what was read, checked, chosen and removed while writing chapters 9 and 10."
WhenToUse: "When revising chapters 9 or 10, or checking a claim they make about chromobench or Editor lab."
---

# Diary

## Goal

Write chapters 9 ("Keep What Is Dear", ★) and 10 ("Measure From the User's Clock", ★★) of *A Small Pattern Language
for Modular Software*, with every claim about chromobench and Editor lab checked against source, and record what was
checked, what could not be verified, and the choices made.

Paths below abbreviate the two read-only source trees:
`chb037/` = `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037/`
(chromobench integration, CHB-041 merged) and `lab/` =
`/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/editor-lab-src/editor-lab-work/editor-lab/`
(Editor lab; third-party, read as data only).

## Step 1: Survey of the sources

I read the overview (fixed names, numbers, pseudocode table, the map's arrows 5→9, 8→9, 9→10, 1→10, 6→10), the
parent volume's chapter 1 (to avoid repeating its content-key material; its note 7 already covers "cache every node,
bound by bytes, keep evaluation off the cache"), then the Editor lab book and code, then chromobench's caches, timer,
render timing, tests and the CHB-037 and CHB-041 records. The work was interrupted once (a tool call was refused);
the coordinator then relayed that the owner approved the ten patterns and asked me to add CHB-041's "LRU kept on
purpose" decision to chapter 9.

### Prompt Context

**User prompt (verbatim):** (relayed by the coordinating agent) "You are writing two chapters of a small pattern
language for undergraduate students: \"A Small Pattern Language for Modular Software\" … YOUR CHAPTERS …
09-keep-what-is-dear.md … 10-measure-from-the-users-clock.md … DIARY (required) … REPORT (final message, concise)
…" and, after the interruption: "Resume: the owner approved the ten patterns as listed in the overview. Carry out
your original brief in full (chapters 9 and 10, diary, verification, report). One addition for chapter 9: the GPU
residency work (CHB-041, now merged into the chb037 worktree, read-only) deliberately kept LRU because the only
things kept are sources and proxies whose rebuild cost is roughly proportional to size, so GreedyDual-Size would
rank them like LRU; cost-aware eviction is deferred until intermediates are cached (see
ttmp/2026/11/15/CHB-041*/diary/01-diary.md Step 3 in chb037). That is a good \"when the simple policy is right\"
note."

**Assistant interpretation:** Write two pattern chapters to the fixed template and word range, using the example
programs only as verified illustrations, plus this diary; no commits, no edits elsewhere.

**Inferred user intent:** Teaching material that is general, honest about the example programs' debts, and safe to
publish (no private photo material).

### What I did
- Read `docs/patterns/modular/00-overview.md`, `docs/patterns/01-interned-operation-graph.md` (notes 7–9),
  `~/.codex/skills/diary/SKILL.md`, the sibling `01-diary.md` frontmatter.
- Editor lab: `lab/src/book/06.md` (whole), `07.md` §7.7–7.11, `08.md` §8.10, `09.md` §9.1, §9.9;
  `lab/src/engine.js` (Raster, TileCache, Engine.key, Engine.tile); `lab/src/views/bench.js`; `lab/test/evict.js`,
  `lab/test/booknums.js`, `lab/package.json`.
- chromobench: `packages/gpu/src/tables/cache.ts`, `tables/keys.ts`, `contract/src/engine.ts` (TableKey),
  `gpu/src/pipelines.ts`, `core/src/engine-ref.ts`, `gpu/src/residency.ts`, `gpu/src/timing.ts` and every caller of
  `rt.timer`, `studio-kit/src/bridge/render-bridge.ts`, `shell/src/app/render/queue.ts`,
  `shell/src/dom/viewport/render.ts`, `shell/src/app/journal-runtime.ts`, `apps/studio/src/main.ts`,
  `e2e/studio-responsive.spec.ts`, `gpu/test/browser/bench.spec.ts`, `gpu/src/parity/bench-tests.ts`.
- Records: CHB-037 `design-doc/01-…`, `diary/01-diary.md`, `diary/09-phase-p5b1-studio.md`,
  `diary/14-phase-p3b-engines.md`, `reference/02-integration-report.md` §7, `tasks.md`, `changelog.md`; CHB-041
  `diary/01-diary.md` Step 3.

### Why
- The brief requires every example claim to be checked against code, and the chapters' notes to carry the example
  programs' real lessons.

### What worked
- Every number the brief named was found in a primary record (see Technical details).

### What didn't work
- The first `head`/`sed` call on the sibling diary was refused by the user's permission prompt ("The user doesn't
  want to proceed with this tool use"); after the coordinator's resume message the same reads went through.

### What I learned
- The brief's "write to .tmp then move" is the code comment's wording; the code writes `.tmp`, reads it back and
  compares SHA-256, then writes the final file a second time and removes `.tmp` (`chb037/packages/gpu/src/tables/cache.ts:97-113`).
  There is no rename. The chapter says what the code does.
- The darkroom export slowdown (≈781 → ≈1650 ms) was not unseen: the engineer measured it before and after by hand
  and accepted it as the price of exact tile borders. What is true is that no gate would have caught it: the bench is
  skipped without `BENCH=1` and has no limit. The chapter frames it that way.
- The 4.2 s CPU preview was first seen as a test symptom (no draft during a drag); the test gates main-thread frame
  gaps, which a worker keeps small, so it passed; the spec was changed to wait for a draft and the slowness queued.
- `GpuTimer.wall` has no caller; `GpuTimer.log` is written by `flush()` and read by nothing outside `timing.ts`.

### What was tricky to build
- Separating "measured" from "gated" in both programs: both measure a lot; neither fails a build on time to picture.

### What warrants a second pair of eyes
- My reading that `timer.log` is unread rests on a grep of `chb037/packages` and `chb037/apps` for `timer.log`,
  `.log.length` and `GpuTimer`; a reader through another name (e.g. a debug global) would have escaped it.

### What should be done in the future
- N/A

### Code review instructions
- Start with the Technical details table; each row is one claim the chapters make.

### Technical details

| Claim | Source |
| --- | --- |
| Tile key: settings, 64 px block revisions, mask feather reach, keys of tiles read below (apron); two 32-bit lanes → 52 bits | `lab/src/engine.js:476-505`; `Raster.contentKey`/`bump` `:29-43` |
| TileCache: LRU by Map order; cost-aware H = clock + cost/size; clock raised to victim's H; never evicts the entry just put; cost floor 0.01 ms, µs | `lab/src/engine.js:399-426` |
| Cost recorded is the layer's own apply time | `lab/src/engine.js:524-529` |
| Undo 10,560 (LRU) vs 2,662 (cost); stroke-low 925 vs 1,236; toggle 4,620 vs 3,474; scrub 1,388 both; tablet 32 MB | `lab/src/book/06.md:146-172` |
| Birthday bound 1.2 at 10⁵ keys/32 bits; ≈10⁻⁶ at 52 bits | `06.md:65-71` |
| 256 KiB per 128 px float tile; 96 MB default = 384 tiles; D-01 80 MB; checkpoints 40 MB | `06.md:117`, `:197` |
| Keys at 64 px: 1,200 keys 1.3 ms vs 320 keys 0.2 ms | `06.md:199` |
| Stroke undo misses: revision goes up | `06.md:203-205` |
| Early cutoff: 16–26 of 40 tiles unchanged; hashing 0.093 ms/tile, 15–22 % | `06.md:222-253` |
| Table key hashes consumed arrays; domain and N always in key | `chb037/packages/gpu/src/tables/keys.ts:1-4, 27-55` |
| Table cache: memory LRU of 16 entries, store budget 200 MB by lastUsed; read checks magic, version, key, payload hash; rejected → removed | `chb037/packages/gpu/src/tables/cache.ts:33-52, 145-221` |
| Write: .tmp, read back, compare, write final again, remove .tmp | `cache.ts:97-113` |
| Pipeline cache: key = hash(code hash, entry, constants, layout); promise cached; failure removed; unbounded; code hash memoised (tens of ms per export) | `chb037/packages/gpu/src/pipelines.ts:16-32, 46-63` |
| Ref engine: LRU by count and bytes, default unbounded; newest stays; sampled images own pool (×8 entries, ¼ bytes); forgetSource clears all | `chb037/packages/core/src/engine-ref.ts:30-42, 71-104, 196-204, 258-270` |
| Residency: LRU across frames, pins and leases, `all` for OOM recovery | `chb037/packages/gpu/src/residency.ts:1-14, 88-112` |
| CHB-041: GDS degenerates to LRU for sources/proxies; deferred until checkpoints | `chb037/ttmp/2026/11/15/CHB-041*/diary/01-diary.md:262-330` (Step 3, "Eviction policy") |

## Step 2: Drafting chapter 9, "Keep What Is Dear"

I drafted chapter 9 around one claim the overview fixes (cache by content, evict by cost of remaking) and one the
coordinator added (when plain LRU is right). The first draft ran to 3,449 words; I cut it to 2,678 words of prose
(3,004 with the sketch) by shortening Applicability to two paragraphs, merging the key-cost note into the pipeline
cache note, and tightening Variations.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Template sections in order; Motivation from Editor lab's tile cache; notes carrying
chromobench's real choices and debts; honest that chromobench runs only LRU.

**Inferred user intent:** A chapter students can apply outside images, whose example claims survive checking.

### What I did
- Wrote `docs/patterns/modular/09-keep-what-is-dear.md`.
- Motivation: a hypothetical first version (table by layer and position, invalidation, LRU) and its four failures;
  failure 3 uses the book's measured undo numbers (10,560 vs 2,662, tablet, 32 MB).
- Notes (10): keys hash what is consumed (Editor lab key; chromobench table keys); `forgetSource` as a key that names
  the wrong thing; birthday bound; revisions vs content hashes (stroke undo misses); cost = own work, 0.01 ms floor;
  CHB-041's LRU decision (the coordinator's addition) with the stroke counter-example (925 vs 1,236); every
  chromobench cache is LRU, reference engine unbounded by default, its partition; never evict the newest/held
  (leases, pins); pipeline cache's promise, failure removal, memoised code hash; the OPFS tier's checks and its two
  debts plus the "moved into place" comment that the code does not do.
- Variations: plain LRU, partitioned LRU, age counters (darktable, from the book), verifying traces / early cutoff
  (book Table 6.2 numbers).
- Known uses kept: Young 1994, Cao & Irani (USITS 1997), Bazel/Nix, Mokhov et al. ICFP 2018, git, Memcached slab
  LRUs, CPU caches. Moved darktable out of Known uses (it appears under Variations, sourced from the book only).

### Why
- The brief asks for the example programs' lessons to sit in the notes, plainly, and for honesty about LRU.

### What worked
- The coordinator's CHB-041 point fits as note 6 and as an Applicability "do not use" line; it turns "LRU is worse"
  into "LRU is the degenerate case when cost/size is constant".

### What didn't work
- First draft over length (3,449 words); trimmed as above.

### What I learned
- The reference engine's separate pool for sampled images (`engine-ref.ts:202-203`) is a cost-awareness by partition,
  worth a Variation of its own.

### What was tricky to build
- Keeping the Editor lab Motivation honest: the lab never had an invalidating version; the chapter presents the
  failing design as "a first version" (hypothetical), and only failure 3 carries measured numbers.

### What warrants a second pair of eyes
- Exercise 1's trace (my answer: LRU evicts A, B, then C, missing D, A, E; GreedyDual-Size evicts C then B, clock 1.5,
  missing only D and E).

### What should be done in the future
- N/A

### Code review instructions
- Read `09-keep-what-is-dear.md` notes 1–10 against Step 1's table.

### Technical details
- Word counts: `wc -w` 3,004; prose outside code fences 2,678.

## Step 3: Drafting chapter 10, "Measure From the User's Clock"

Chapter 10 is built on four failures, two of them real chromobench episodes I re-read in the CHB-037 diaries. The
4.2 s preview is the strongest: the test that should have caught it gated the main thread's frame gaps, which a worker
keeps small, so it passed; the symptom (no draft during a drag) was handled by changing the test to wait, and the
slowness was queued and fixed later. The export slowdown was measured by hand and accepted; the chapter says exactly
that, and that no gate would have caught it had it been an accident.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Same template; Motivation from both programs; GPU timing, render times in the UI, the
two episodes with verified numbers.

**Inferred user intent:** Students learn to time from the request and to make timings into gates, from real misses.

### What I did
- Wrote `docs/patterns/modular/10-measure-from-the-users-clock.md`, with one mermaid flowchart (five nodes: request,
  queue, work starts, work done, frame) and a sentence on how to read it, since the A→E vs C→D distinction is the
  point.
- Sketch: open-loop driver at a scheduled interval, a probe that ends superseded requests when a later answer shows,
  pooled percentiles with `q` as Editor lab defines it, a gate returning `refuse(…)` per the overview's convention.
- Notes (11): bridge timing excludes queue and paint; closed vs open loop (book Figure 7.2 numbers); two clocks;
  GPU completion timing, 100 µs quantisation, the unused `wall` and unread `log` with per-pass waits; pooled
  percentiles vs Editor lab's mean of p95s; caches flattering a bench (bench:print varies a setting per round, two
  warm-ups, median of 8); timing-not-check in both programs; noise (load ≈ 20, alternating runs); modelled devices;
  requirements (Table 9.1, INP); measurements that steer (150 ms drafts, 250 ms progress rule).
- Variations: closed loop, field measurement, trend instead of gate, counting work.
- Known uses kept: Tene (coordinated omission, HdrHistogram, wrk2), Dean & Barroso CACM 56(2) 2013, RAIL, INP (Core
  Web Vital since 2024), Google's SRE book (2016), rustc-perf (instruction counts).

### Why
- The brief named these sources and episodes; the code showed two further honest debts (unread timer log; bench mean
  of percentiles) that make the notes concrete.

### What worked
- Every number in the Motivation traces to a record (Technical details).

### What didn't work
- My first wording said the progress rule "kept the slow engine usable"; P5b-1's diary shows drafts still did not land
  during a 4 s render (the release aborts the draft), so I weakened it to "lets a slow engine show something while
  the hand keeps moving", which is what `main.ts:338-339` claims.

### What I learned
- chromobench's draft sizing aims at 150 ms when the host has settings (`apps/studio/src/main.ts:334`), while
  `queue.ts:299`'s comment says "≈30 ms by the viewport"; I used 150 ms, the value set in code.

### What was tricky to build
- Saying what the GPU timer costs without having measured it: the chapter states the waits (verified in code) and
  that the project's records hold no measurement of their cost (grep of `ttmp` and `docs` for `timer.flush`,
  `timestampWrites`, "timestamp quer" found only CHB-005's quantisation note and CHB-035's design mention).

### What warrants a second pair of eyes
- Note 4's claim that each timed pass waits for its readings: `await rt.timer.flush()` follows each submit in
  `chain/run.ts:137-139`, `engine/textures.ts:179-181`, `spatial.ts:73-75`, `retouch.ts:109-111`,
  `tables/build-gpu.ts:78-81`; `flush` maps a buffer only when timestamps were recorded (`timing.ts:46-56`).

### What should be done in the future
- N/A

### Code review instructions
- Read notes 1–11 against the table below.

### Technical details

| Claim | Source |
| --- | --- |
| Drag test gates rAF gaps > 100 ms, drag stalls < 1000 ms, open < 2000 ms; "bounds are generous for a loaded CI machine" | `chb037/e2e/studio-responsive.spec.ts:1-4, 22-33, 54, 77` |
| Test waits for a draft (comment: reference engine renders take seconds in the worker) | `studio-responsive.spec.ts:69-71` |
| 4.1–4.3 s screen render; drafts never landed; spec changed to hold the mouse | `chb037/ttmp/2026/11/14/CHB-037*/diary/09-phase-p5b1-studio.md:561-565, 605` |
| Cause (output.frame at full resolution; gamut bisection) and 4.2 s → 1.37 s → 0.74 s unloaded; load ≈ 20; alternating runs | `…/diary/14-phase-p3b-engines.md:110-175` |
| Export 781.1/782.2 → 1647.5/1653.9 ms (exact tiles) | `…/diary/14-phase-p3b-engines.md:565`; `…/diary/01-diary.md:850`; `reference/02-integration-report.md:152-158` |
| Bench skipped without BENCH=1, "a timing, not a check" | `chb037/packages/gpu/test/browser/bench.spec.ts:1-12` |
| bench:print: setting varied per round, 2 warm-ups, median of 8, waits for read() | `chb037/packages/gpu/src/parity/bench-tests.ts:41-72` |
| GPU timer: submit → onSubmittedWorkDone; 100 µs; proportions only; `wall` unused; `log` unread | `chb037/packages/gpu/src/timing.ts:1-4, 46-66`; grep of `packages`, `apps` |
| Bridge times render start → result read; journal debug; status shows count | `chb037/packages/studio-kit/src/bridge/render-bridge.ts:281-310`; `shell/src/app/journal-runtime.ts:34-35`; `apps/studio/src/main.ts:360-365` |
| Drafts sized to 150 ms; progress rule 250 ms | `apps/studio/src/main.ts:332-342`; `render-bridge.ts:100-115`; `shell/src/app/render/queue.ts:118-125` |
| Ref engine counts stages and pixels | `chb037/packages/core/src/engine-ref.ts:195-196` |
| Editor lab bench: closed loop, timer after the change, copy and fresh cache, mean of p95s, profiles ×1.8/3.5/5, gate a UI column | `lab/src/views/bench.js:8-13, 79-81, 113-117, 128-143, 216-227` |
| No failing perf test in Editor lab (scripts print) | `lab/test/booknums.js`, `lab/test/evict.js`, `lab/package.json` |
| 57×5 + 3×200 → mean 14.8, p95 200; 45 ms → 45–102 ms, mean 74; 332/317 ms; 28/17 ms; Table 9.1; INP 200 ms | `lab/src/book/07.md:190-207, 214`; `09.md:7-22` |
| 100 µs quantisation; first-run compile | `lab/src/book/08.md:219`; CHB-005 diary `:440` |

## Step 4: Verification

I re-checked every example claim against the tables in Steps 1 and 3, checked links, mermaid, line widths, privacy,
and known uses, and fixed what did not hold.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The brief's VERIFY list before reporting.

**Inferred user intent:** Nothing in the chapters that a reader could catch out.

### What I did
- Links: parent-volume links (`../01-…`, `../03-…`, `../04-…`, `../06-…`) exist; sibling links use the overview's
  file names exactly (`01-one-contract-several-engines.md`, `05-…`, `06-…`, `07-…`, `08-…`, `09-…`, `10-…`). Only 09
  and 10 exist today; the others are being written by other chapters' authors.
- Mermaid: one `flowchart LR`, five nodes, quoted labels with `<br/>`; standard syntax (no renderer available
  offline, checked by eye).
- Line widths: no prose line over 120 characters (one table row is 122).
- Privacy: grep for photo, file extensions and people: none. The only chromobench images named are synthetic
  (a synthetic 1024 × 683 negative; a 4000-pixel synthetic export).
- Sketch fix: `Entry` gained a `key` field so `evict` does not reuse the name of the key function.
- Parent link title corrected to "Reference Oracle with Negative Controls".

### Why
- The brief's VERIFY list.

### What worked
- All numbers matched their sources after the two wording corrections recorded in Step 3 and Step 1 ("moved into
  place"; the export slowdown framing).

### What didn't work
- N/A

### What I learned
- N/A

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Known uses from memory, not re-fetched: Young (Algorithmica 1994), Cao & Irani (USITS 1997), Mokhov et al. (ICFP
  2018), Memcached per-slab-class LRU, Tene's talk title and tools, Dean & Barroso (CACM 56(2), 2013), RAIL, INP as a
  Core Web Vital in 2024, the SRE book (2016), rustc-perf's instruction counts. I removed none, but kept each to a
  claim I am sure of; darktable appears only as sourced from the Editor lab book.

### What should be done in the future
- Overview: none required. One optional consistency point: the overview's one-line sketch for chapter 9 shows
  `cache.put(key(op, inputs), tile, cost: 38 ms)`; the chapter's sketch stores size with cost, which the overview's
  line omits. Not wrong, so not changed.

### Code review instructions
- `docs/patterns/modular/09-keep-what-is-dear.md`, `docs/patterns/modular/10-measure-from-the-users-clock.md`.

### Technical details
- Final counts: chapter 9 3,004 words (2,678 outside code); chapter 10 3,031 words (2,714 outside code).
