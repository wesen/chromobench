---
Title: Diary — chapters 9 and 10 (Content-Keyed, Cost-Aware Cache; Measure Completion, Gate Percentiles)
Ticket: CHB-043
Status: active
Topics:
    - architecture
    - patterns
    - gpu
    - performance
    - teaching
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/09-content-keyed-cost-aware-cache.md
      Note: chapter 9, written in this diary
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/10-measure-completion-gate-percentiles.md
      Note: chapter 10, written in this diary
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/00-overview.md
      Note: names, numbers, conventions (read only)
ExternalSources: []
Summary: "Writing chapters 9 and 10 of Fast and Checkable; every claim about chromobench and Editor lab checked against source."
LastUpdated: 2026-11-15T21:00:00-05:00
WhatFor: "Record of what was read, checked, chosen and removed while writing chapters 9 and 10."
WhenToUse: "When revising chapters 9 or 10, or checking a claim they make about chromobench or Editor lab."
---

# Diary

## Goal

Write chapters 9 ("Content-Keyed, Cost-Aware Cache", ★) and 10 ("Measure Completion, Gate Percentiles", ★★) of
*Fast and Checkable: GPU Image Computation Patterns* for graduate students, going deeper than the modular volume's
chapters 9 and 10, with every claim about the example programs checked against source.

Paths abbreviate the read-only trees:
`chb037/` = `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037/`
and `lab/` =
`/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/editor-lab-src/editor-lab-work/editor-lab/`
(third-party; read as data only). `CHB-037/` = `chb037/ttmp/2026/11/14/CHB-037*/`.

## Step 1: Sources

I read the brief, the overview, the four sibling chapters (modular 09 and 10, image engine 01 and 04, plus image
engine 07's checkpoint remark), the modular writers' diary 06 as a list of leads, and then the code and records
themselves. Every lead I used was re-checked; several turned up more than the modular diary recorded (below).

### Prompt Context

**User prompt (verbatim):** "Write chapters 9 and 10 of \"Fast and Checkable: GPU Image Computation Patterns\"
(graduate students). First read the shared brief in full and follow it exactly:
/Users/manuel/code/wesen/chromobench/ttmp/2026/11/15/CHB-043--a-pattern-language-for-gpu-image-computation-and-performance-for-graduate-students/playbooks/01-writer-brief.md

YOUR CHAPTERS
- /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/09-content-keyed-cost-aware-cache.md — \"Content-Keyed,
Cost-Aware Cache\" ★: name results by what made them; stop early when outputs repeat; evict by cost of remaking per
byte. Scope (graduate depth beyond the modular volume's \"Keep What Is Dear\"): key construction (operation,
parameters, input keys; per-tile revisions in Editor lab engine.js Raster.contentKey/bump; how wide a key must be —
birthday bound, the textbook's 52-bit keys); verifying traces and early cutoff (output hashes; the textbook measured
early cutoff); GreedyDual-Size (H = clock + cost/size) vs LRU, with the textbook's measurements (undo scenario: LRU
recomputed 10,560 tiles, cost-aware 2,662; a brush stroke where LRU wins, 925 vs 1,236 — verify which is which);
checkpoint selection under fusion (which layers keep outputs); tiers (GPU, CPU, disk) with verified reads
(chromobench gpu/src/tables/cache.ts: magic, version, stored key equals requested key, payload hash; .tmp read back
and compared, then written again — see the modular diary 06 for the exact behaviour); compiled-pipeline cache keyed
by text hash (pipelines.ts); the reference engine's per-node cache and forgetSource (a source id names the file, not
the decode); when LRU is right (CHB-041: cost roughly proportional to size). Known uses: Young's GreedyDual
(Algorithmica 1994); Cao & Irani, \"Cost-Aware WWW Proxy Caching Algorithms\" (USITS 1997); Mokhov, Mitchell & Peyton
Jones (ICFP 2018); Adapton (Hammer et al., PLDI 2014); Salsa / rust-analyzer; Bazel remote cache; Nix; ccache; git
object store; GEGL tile cache.
- /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/10-measure-completion-gate-percentiles.md — \"Measure
Completion, Gate Percentiles\" ★★: time device work to completion, from the user's intended moment, and fail the
build on regressions. Scope (graduate depth beyond the modular volume's chapter 10): asynchronous device timing (a
dispatch returns when queued; submit → onSubmittedWorkDone; timestamp queries and their quantisation; per-pass
stalls give proportions only — gpu/src/timing.ts; GpuTimer.wall unused and GpuTimer.log never read while passes
await timestamp readback: P10-4); open-loop measurement and coordinated omission; percentiles and why a mean of p95s
is not a percentile (Editor lab bench); service vs response time; modelled devices (textbook); measurement bias
(Mytkowicz et al. ASPLOS 2009; Kalibera & Jones ISMM 2013); a gate in CI with a stated requirement and noise
handling (chromobench's bench runs only with BENCH=1 and gates nothing: P10-3; the drag test watched animation-frame
gaps and passed while a render took 4.1–4.3 s; CPU preview 4.2 s → 0.74 s; export 781 → 1,650 ms accepted by hand)
— verify all numbers in chb037 ttmp/2026/11/14/CHB-037*/ and the modular diary 06; what the measurements steer
(slicing, budgets, eviction). Known uses: Gil Tene on coordinated omission, HdrHistogram, wrk2; Dean & Barroso 2013;
Chrome's RAIL model and INP as a Core Web Vital (2024); rustc-perf; Google's SRE book on percentiles; GPU vendor
profilers.

SIBLING CHAPTERS TO READ (go deeper, do not repeat): …/modular/09-keep-what-is-dear.md and
10-measure-from-the-users-clock.md; …/01-interned-operation-graph.md and 04-latest-wins-render-slots.md.

DIARY FILE: reference/06-diary-chapters-09-10.md in the CHB-043 ticket."

**Assistant interpretation:** Two template chapters at graduate depth (cost models, bounds, device semantics), with
the example programs' lessons verified in source, plus this diary; no commits, edits only to the three files.

**Inferred user intent:** Chapters that teach the general pattern rigorously and stay honest about the example
programs, without repeating the undergraduate volume.

### What I did
- Read `playbooks/01-writer-brief.md`, `docs/patterns/gpu/00-overview.md`, `~/.codex/skills/diary/SKILL.md`, the
  sibling chapters named above, `docs/patterns/07-barrier-cut-fusion.md` (checkpoints only), modular 07 (to avoid
  overlap on confidence), and CHB-042's `reference/06-diary-chapters-09-10.md`.
- Editor lab: `lab/src/engine.js` (Raster, layerHash, TileCache, Engine.key, Engine.tile), `lab/src/util.js`
  (hstr, hmix), `lab/src/views/bench.js`, `lab/src/book/06.md` (whole), `07.md` §7.7–7.10, `08.md` §8.10,
  `09.md` §9.1.
- chromobench: `packages/gpu/src/tables/{cache,keys,manager}.ts`, `pipelines.ts`, `engine-gpu.ts`,
  `engine/{results,dag,defs}.ts`, `residency.ts`, `timing.ts` and every `timer.*` caller, `device.ts`, `limits.ts`,
  `chain/run.ts`, `packages/core/src/engine-ref.ts`, `packages/contract/src/graph.ts`,
  `studio-kit/src/bridge/render-bridge.ts`, `shell/src/app/journal-runtime.ts`, `shell/src/app/render/queue.ts`,
  `apps/studio/src/main.ts`, `e2e/studio-responsive.spec.ts`, `packages/gpu/test/browser/bench.spec.ts`,
  `packages/gpu/src/parity/bench-tests.ts`, `playwright.config.ts`, `packages/gpu/playwright.config.ts`.
- Records: `CHB-037/diary/09-phase-p5b1-studio.md`, `diary/14-phase-p3b-engines.md`, `diary/01-diary.md`,
  `reference/02-integration-report.md` §7, `tasks.md`; CHB-041 `diary/01-diary.md` Step 3; CHB-035 design 02 via
  `git show task/chb-035-digital-editing-design:…/design/02-editor-lab-performance-architecture.md` (read-only).

### Why
- The brief requires each example claim to be verified with file:line.

### What worked
- Every number the brief named was found in a primary record or the code (table in Technical details).

### What didn't work
- N/A at this step.

### What I learned
- **Editor lab's 52-bit key is 32 bits wide for settings and pixel revisions.** `layerHash` is `hstr` (32-bit FNV-1a)
  of the settings JSON (`lab/src/engine.js:383-386`, `lab/src/util.js:40-44`); `Raster.contentKey` returns a 32-bit
  `hmix` (`engine.js:29-36`, `util.js:45-49`). Both enter `parts`, which two 32-bit lanes hash into 52 bits
  (`engine.js:483-502`). Two settings with equal `hstr` give equal parts, so equal keys for every tile of the layer.
  The textbook's justification for 52 bits (1.2 expected pairs at 10⁵ keys with 32 bits) therefore still applies to
  settings. Became Motivation 2 and note 1.
- **A disk-tier write failure fails the table build.** `OpfsStore.put` throws on verification failure
  (`cache.ts:104-107`) and on any OPFS error; `TableCache.put` does not catch (`cache.ts:184-192`);
  `TableManager.build` awaits `cache.put` inside the backend loop's try (`manager.ts:96-114`), so a failed write
  counts as a failed builder: it builds again with the next backend and throws `lastErr` at the end. The textures
  acquired by the failed attempts (`build-gpu` result or `uploadTable3D`, `manager.ts:101-108`) are not released.
  The next resolve would hit memory (`remember` ran before the throw, `cache.ts:186`). New debt.
- **The table manager's promise map is unbounded.** `live` (`manager.ts:64`) drops only failures (`:84`); `clear()`
  (`:123`) has no production caller (grep of `packages`, `apps`); the manager is recreated only on device loss
  (`engine-gpu.ts:229`). Every resolved table texture stays referenced. New debt (small: tables are N³ × 16 B,
  33³ × 16 ≈ 575 KB each at the default N = 33, my arithmetic).
- **Preview results are keyed without the table builder.** Result key `${n.id}|${scale}|${region}|${precision}`
  (`engine-gpu.ts:958`); previews pass no builder (`chain/run.ts:83`), so `backendOrder` picks GPU or f64 tables
  (`manager.ts:76-78`), and a fallback changes the builder under the same key. Written as a choice to state.
- **The pipeline cache's layout key is a caller label** (`pipelines.ts:13`, `:31`).
- **`GpuTimer.log` grows without bound** (`timing.ts:16, 54, 64`), one record per timed pass, never read; this
  extends P10-4 (which says "never read").
- **Drafts are adapted to measured speed** in the bridge (`render-bridge.ts:96-115`; `draftTargetMs = 150` when the
  host has settings, `apps/studio/src/main.ts:334`), within the queue's `DRAFT_PIXELS = 500_000` cap
  (`queue.ts:300`). P10-2's "drafts are a fixed 500k px" looks partly stale; reported.
- **CI runs WebGPU on SwiftShader** unless `REAL_GPU=1` (`playwright.config.ts:10-12`,
  `packages/gpu/playwright.config.ts:19`). Became note 8 of chapter 10.
- The textbook says `put` "records the cost in microseconds" (`06.md:138`) but the code multiplies milliseconds by
  10⁶ (`engine.js:408`), i.e. nanoseconds. GreedyDual-Size is invariant to scaling all costs, so the ordering is
  unaffected; the chapter states the invariance instead of the units.

### What was tricky to build
- Telling the coalescing map's (unbounded) and the memory tier's (16 entries) roles apart: both are caches of the
  same tables with different bounds.

### What warrants a second pair of eyes
- The write-failure path: I read it from code, not from a run.

### What should be done in the future
- See the report's debts list.

### Code review instructions
- Start with the claims table below.

### Technical details

| Claim | Source |
| --- | --- |
| Tile key parts: settings hash, level, tile, size, raster content key, mask feather reach, keys below (apron); two 32-bit lanes → 52 bits | `lab/src/engine.js:478-505` |
| `contentKey`/`bump`: revision per 64 px block, 32-bit `hmix` | `engine.js:20-43`; `util.js:45-49` |
| `layerHash` = 32-bit FNV-1a of settings JSON | `engine.js:383-386`; `util.js:40-44` |
| TileCache: LRU by Map order; GDS H = clock + cost/size; clock = victim's H; linear scan; never evicts the entry just put; cost floor 0.01 ms | `engine.js:399-426` |
| Cost = the layer's own apply time | `engine.js:524-529` |
| Birthday bound; 1.2 at 10⁵/32 bits; ≈10⁻⁶ at 52; JS number reason | `lab/src/book/06.md:65-73` |
| Undo 10,560 vs 2,662; stroke 925 (LRU) vs 1,236 (cost); toggle 4,620 vs 3,474; scrub 1,388 both; tablet 32 MB; previews on; one run | `06.md:140-172` (Figure 6.3 and text) |
| Table 6.1 layer costs (sum 259.5 ms, my arithmetic); Sharpen 87.1; checkpoints 40 MB vs 80 MB | `06.md:184-197` |
| Key cost 1.3 ms (1,200 keys, 64 px) vs 0.2 ms (320, 128 px) | `06.md:199` |
| Early cutoff 16 and 26 of 40 unchanged; 33 %, 52 %; hashing 0.093 ms / 256 KiB; 15–22 %; tolerance warning | `06.md:224-257` |
| Table cache header, read checks (magic, version, key, payload SHA-256), reject → remove | `chb037/packages/gpu/src/tables/cache.ts:1-7, 34-52, 157-182` |
| Write: .tmp, read back, compare SHA-256, write final again, remove .tmp; comment "moved into place" | `cache.ts:6, 97-113` |
| Memory tier 16 entries; store 200 MB by lastUsed | `cache.ts:203-221` |
| Table key: hashes of consumed arrays, domain and N, builder, conventions; id = SHA-256 of canonical JSON | `chb037/packages/gpu/src/tables/keys.ts:1-4, 13-55` |
| Manager: promise coalescing, failure removed, builder fallback loop, no texture release on failure | `chb037/packages/gpu/src/tables/manager.ts:64, 75-117` |
| Pipeline cache: key = SHA-256(canonical{code hash, entry, constants, layout label}); promise; failure removed; memoised code hash "tens of ms" | `chb037/packages/gpu/src/pipelines.ts:13, 16-32, 55-64` |
| Node ids SHA-256 over length-prefixed fields | `chb037/packages/contract/src/graph.ts:29-47` |
| Ref engine: LRU by count and bytes, default unbounded, newest stays; grid pool ×8 entries, ¼ bytes; source id = SHA-256 of bytes; forgetSource clears all and rebuilds graph; counts stages and pixels | `chb037/packages/core/src/engine-ref.ts:31-42, 71-109, 196, 198-205, 219-222, 258-274` |
| GPU result cache: LRU by count and 256 MiB; key with precision | `chb037/packages/gpu/src/engine/results.ts:1-18`; `engine/defs.ts:63`; `engine-gpu.ts:956-981` |
| Planner's materialised set | `chb037/packages/gpu/src/engine/dag.ts:1-4` |
| Residency LRU, leases, pins | `chb037/packages/gpu/src/residency.ts:1-14` |
| CHB-041: GDS degenerates to LRU for sources/proxies; deferred to checkpoints | `chb037/ttmp/2026/11/15/CHB-041*/diary/01-diary.md:330-336` |
| CHB-035 P3: checkpoints (film dyes, paper exposure, print before digital); GDS for checkpoints, LRU for finals; proposed | branch `task/chb-035-digital-editing-design`, `design/02-…md:431-447` |

## Step 2: Chapter 9, "Content-Keyed, Cost-Aware Cache"

The modular chapter already teaches keys, the birthday bound, GreedyDual-Size and a verified disk tier. I went
deeper on five points: the width of a key is set by its narrowest link and its whole population (with a lookup-based
bound for bounded caches); traces and blobs as two stores (Bazel's action cache and CAS), giving early cutoff with
output hashes computed on the device; GreedyDual-Size's invariants (competitive ratio, scale invariance, clock
monotonicity broken by holds, heap with lazy deletion); a cost model for checkpoints under fusion; and failures of
lower tiers as misses, with chromobench's write-failure path as the counter-example.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The template, at graduate depth, with the example programs' lessons in the notes.

**Inferred user intent:** A chapter a graduate student can apply to a training framework or a build system.

### What I did
- Wrote `docs/patterns/gpu/09-content-keyed-cost-aware-cache.md`.
- Motivation: three textbook-measured failures (early cutoff lost; 32-bit link inside a 52-bit key; LRU vs cost on
  undo and on a stroke), other domains: activation checkpointing in training, incremental compilers.
- Sketch: key with precision and grid; traces (key → output hash) and blobs (output hash → value, GDS with holds,
  heap with lazy deletion, `max` on the clock); determinism assertion on recomputation; disk tier verified by the
  content name itself; failed writes counted. The disk tier is wired into `value` (promote with the read time as
  cost) and `run` (write after store).
- Notes (9): key width; precision/grid in the key (table key vs result key); names standing for content
  (forgetSource, layout label); output hash as a device reduction; GDS details; measured policies and CHB-041's LRU;
  checkpoints under fusion; verified tier and the write-failure debt; coalescing map unbounded.
- Cut for length: the revision-vs-content-hash note (the modular chapter has it), the memoised code-hash lesson
  (modular), a sixth force (fast vs trusted tiers), the "+" on tier failures.

### Why
- The brief asks for depth beyond the sibling and for real lessons, named plainly.

### What worked
- Framing traces and blobs as Bazel's action cache and CAS made early cutoff and the verified disk tier one design.

### What didn't work
- First draft was 3,159 prose words; trimmed to 2,978 (see counts).

### What I learned
- With holds, a GreedyDual-Size victim's H can be below the clock (an entry held during an earlier eviction). Even
  Editor lab's version, which skips only the entry just put (`engine.js:414-421`), can lower its clock: if that
  entry is cheap, the victim's H exceeds it, and a later eviction of it sets `clock = victim.H` below the current
  clock. Harmless for ordering in practice, but it breaks the invariant; my sketch uses `max`.

### What was tricky to build
- The sketch's `evaluate`: names computed bottom-up may run a checkpoint (no trace yet), so `value` must check
  `vals` again after naming; holds must be counted once per `held` append (`put` of an existing entry calls `get`).

### What warrants a second pair of eyes
- Note 5's claim (Young: GreedyDual k-competitive for weighted caching; Cao and Irani extend to sizes) is from memory.
- Exercise 2(b) answer (my arithmetic): 10⁶ × 10⁶ × 400 / 2^b < 10⁻³ ⇒ 2^b > 4 × 10¹⁷ ⇒ b ≥ 59; 52 not enough, 64 is.

### What should be done in the future
- N/A

### Code review instructions
- Read notes 1–9 against Step 1's table.

### Technical details
- Counts: `wc -w` 3,626 raw; 2,978 prose outside code fences.

## Step 3: Chapter 10, "Measure Completion, Gate Percentiles"

The modular chapter has open loops, the probe, pooled percentiles and a simple gate. I went deeper on device timing
(what submit-to-fence includes, timestamp quantisation, reading stamps once per batch, the cost of per-pass waits),
merging histograms, a distribution-free order-statistics bound that says how many samples a percentile gate needs,
interleaved baseline/candidate runs with the noise taken from the baseline against itself, CI machines without the
device (SwiftShader), service time for steering vs response time for gating, and tail compounding (Dean and Barroso)
vs sums.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Same template; the four Motivation failures each one bug with numbers.

**Inferred user intent:** Students learn to time asynchronous devices correctly and to build gates that survive noise.

### What I did
- Wrote `docs/patterns/gpu/10-measure-completion-gate-percentiles.md`, with one mermaid sequence diagram (four
  participants, eight messages) because the point is the shape of the timeline: where the call returns, where the
  fence signals, where the person's wait ends.
- Motivation: dispatch returns before work (100 µs quantisation); the drag test on frame gaps (4.1–4.3 s;
  4.2 → 0.74 s); noise (4,211 vs 9,238 ms in one build) beside the 781 → 1,650 ms export measured by hand; mean of
  p95s (28 vs 17 ms in two runs).
- Sketch: `timeBatch` (stamps per pass, one fence, read after it); log-bucketed histogram with exact merge;
  `upper` from the binomial; open-loop driver with presentation times; interleaved gate with A/A noise and a
  minimum effect; in-use requirement.
- Notes (10) as in the chapter; Variations: closed loop, field telemetry, counts, device profilers.

### Why
- The brief's scope list; each note carries a verified example lesson or a bound.

### What worked
- The order-statistic bound gives a concrete sample count (59 for p95, 299 for p99), which turns "enough samples"
  into a number students can check.

### What didn't work
- `npx -y @mermaid-js/mermaid-cli@11.4.2 -i ch10.mmd -o ch10.svg` (in the scratchpad `mmd-ch10/`) was refused twice
  by the permission classifier ("Permission for this action was denied by the Claude Code auto mode classifier.
  Reason: [Undermining Oversight]"). I did not work around it. The diagram uses only standard `sequenceDiagram`
  syntax (participants with aliases, `->>`, `-->>`, a self-message, one `Note over`), but it is not rendered.

### What I learned
- The drag test now polls up to 120 s for a draft (`studio-responsive.spec.ts:72`): it still has no requirement on
  time to picture.

### What was tricky to build
- Keeping Motivation to one bug per item: the timer's per-pass waits moved to note 2.

### What warrants a second pair of eyes
- Known uses from memory: Tene's talk title, HdrHistogram, wrk2; Dean and Barroso CACM 56(2) 2013; RAIL; INP a Core
  Web Vital in 2024 with 200 ms "good"; SRE book 2016; rustc-perf judging against historical noise (least sure of
  this phrasing); Mytkowicz et al. ASPLOS 2009 (no numbers quoted); Kalibera and Jones ISMM 2013; Georges, Buytaert
  and Eeckhout OOPSLA 2007; CUDA events, Vulkan timestamp queries; Nsight Systems, Radeon GPU Profiler, Xcode's
  Metal tools.
- My arithmetic: 0.95⁵⁹ = 0.0485 < 0.05, 0.95⁵⁸ = 0.0510; 0.99²⁹⁹ ≈ 0.0495, 0.99²⁹⁸ ≈ 0.0500 (just above);
  1 − 0.99¹⁰⁰ ≈ 0.634.

### What should be done in the future
- Render the mermaid diagram once permission allows.

### Code review instructions
- Read notes 1–10 against the table below.

### Technical details

| Claim | Source |
| --- | --- |
| Timer: submit → onSubmittedWorkDone; 100 µs; per-pass stalls give proportions only; `log`; `flush` maps after submit; `wall` | `chb037/packages/gpu/src/timing.ts:1-4, 16, 30-35, 46-66` |
| `flush` awaited after submit in five places | `chain/run.ts:137-139`; `engine/textures.ts:181`; `spatial.ts:73-75`; `retouch.ts:111`; `tables/build-gpu.ts:81` |
| `wall` no caller; `log` not read | grep of `chb037/packages`, `chb037/apps` for `timer` (only `pass`, `resolve`, `flush`, construction, destroy) |
| timestamp-query requested when offered | `chb037/packages/gpu/src/limits.ts:12`; `device.ts:184-207` |
| Drag test: rAF gaps > 100 ms recorded; open < 2,000 ms; drag stalls < 1,000 ms; waits up to 120 s for a draft | `chb037/e2e/studio-responsive.spec.ts:22-33, 54, 72, 77` |
| 4.1–4.3 s screen render in the worker; spec changed to hold the mouse | `CHB-037/diary/09-phase-p5b1-studio.md:561-565, 605` |
| Cause and fix; 4.2 → 1.37 → 0.74 s unloaded; loaded 4,642 / 9,238 / 4,211 ms before; load ≈ 20; only alternating runs comparable | `CHB-037/diary/14-phase-p3b-engines.md:110-175` |
| Export 781.1 / 782.2 → 1,647.5 / 1,653.9 ms; exact tiles (48 of 512, halo 64) | `CHB-037/diary/14-phase-p3b-engines.md:565-571`; `diary/01-diary.md:850-851` |
| Export accepted: "1.65 s is acceptable for the persona" | `CHB-037/reference/02-integration-report.md:152-158` |
| Bench only with BENCH=1, "a timing, not a check" | `chb037/packages/gpu/test/browser/bench.spec.ts:1-12` |
| bench:print: setting varied per round, 2 warm-ups, 8 rounds, median, tiles sequential | `chb037/packages/gpu/src/parity/bench-tests.ts:39-73` |
| P10-2, P10-3, P10-4 | `CHB-037/tasks.md:29-31` |
| Bridge times render start → read; EMA 0.6/0.4, ignores < 20 ms; draft scale to target | `chb037/packages/studio-kit/src/bridge/render-bridge.ts:96-115, 281-311` |
| Drafts ≈150 ms, progress rule 250 ms (with host settings) | `chb037/apps/studio/src/main.ts:334-342` |
| Render times only to the debug journal | `chb037/packages/shell/src/app/journal-runtime.ts:34-35` |
| SwiftShader unless REAL_GPU=1 | `chb037/playwright.config.ts:10-12`; `chb037/packages/gpu/playwright.config.ts:19` |
| Ref engine counts stages and pixels | `chb037/packages/core/src/engine-ref.ts:196` |
| Editor lab bench: profiles ×1.8/3.5/5 with real budgets; gate 16.7 ms; closed loop, timer after the change; mean of repeats' p95 | `lab/src/views/bench.js:1-14, 79, 113-117, 128-146` |
| 57×5 + 3×200 ms; 332/317 ms; INP; closed loop; Figure 7.2 (45 → 45–102 ms, 74 mean); modelled devices | `lab/src/book/07.md:190-196, 198-258` |
| 100 µs quantisation; 79 ms first-run compile | `lab/src/book/08.md:219` |
| Requirements table; scrub p95 28 and 17 ms in two runs | `lab/src/book/09.md:7-22` |

## Step 4: Verification

I checked links, line widths, privacy, project identifiers outside the allowed sections, the sketches for holes, and
word counts.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The brief's checks before reporting.

**Inferred user intent:** Nothing a reader could catch out.

### What I did
- Links: every relative link in both chapters resolves (file-existence loop; chapters 02–08 of this volume now exist).
- Line widths: no line over 120 characters (checked with Python, by characters).
- Privacy: no photo, file name, person or roll; grep for `D-01`, `DSC`, `§`, `CHB-`, `P10-`, `.ts`, `.js` in both
  chapters: none.
- Project identifiers: removed chromobench from chapter 9's Variations (now generic); Structure, Solution and
  Sketches name no project identifier.
- Sketch fixes during review: chapter 9's `refuse` inside a nested function replaced by an `assert` (no propagation
  path); the disk tier wired in; `value` re-checks `vals` after naming; chapter 10's `stampBuf`, `segmentPasses` and
  `shownAt` defined.
- Corrected "every chromobench cache is LRU" to "every chromobench cache that evicts" (the pipeline cache never
  evicts).

### Why
- The brief's writing rules and Do-not list.

### What worked
- All numbers matched their sources.

### What didn't work
- Mermaid rendering (Step 3).

### What I learned
- N/A

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Chapter 9 is at 2,978 prose words, near the 3,000 ceiling.

### What should be done in the future
- N/A

### Code review instructions
- `docs/patterns/gpu/09-content-keyed-cost-aware-cache.md`, `docs/patterns/gpu/10-measure-completion-gate-percentiles.md`.

### Technical details
- Final counts: chapter 9 3,626 raw, 2,978 prose; chapter 10 3,505 raw, 2,816 prose (prose = outside code and
  mermaid fences).

## Step 5: Revision after review

The coordinator relayed lessons from a fresh reviewer's reading of chapters 2 and 6 and asked me to apply them to
chapters 9 and 10: recompute every number, separate a-priori bounds from measurements, give derivations, make device
semantics precise, consistent units, a Solution that states only the invariant, no task IDs, sketches with every
name defined and guards for degenerate cases, glosses, and exercises that do not duplicate the modular volume's.

### Prompt Context

**User prompt (verbatim):** (relayed by the coordinating agent) "Revision round. A fresh reviewer (first-year PhD
reader) reviewed chapters 2 and 6 and found errors that generalise. Apply these lessons to your chapters 9 and 10.
Edit only your two chapters and your diary (add a \"Revision after review\" step). Do not commit; do not run
mermaid-cli (I render diagrams). Report changes and word counts. GENERAL LESSONS … (recompute numbers; a-priori vs
measured; derivations; device semantics; units; Solution invariant only; no task IDs; sketch guards; glosses;
exercises without duplicates, with parameters, linearised estimates marked)."

**Assistant interpretation:** Same chapters and facts, made exact: derivations in the notes, guards in the
sketches, units in ms and MiB, Solutions trimmed to the invariant, new exercises.

**Inferred user intent:** Chapters a graduate reader can check line by line.

### What I did
- Recomputed (my arithmetic):
  - Birthday bound: C(N,2)/2^b ≈ N²/2^(b+1); N = 10⁵: 10¹⁰/2³³ = 1.164 at 32 bits; 10¹⁰/2⁵³ = 1.11 × 10⁻⁶ at 52.
    Union bound for P(any collision); the bounded-cache figure L · C / 2^b is also a union (linearised) bound.
  - Exercise 9.2(b): 10⁶ · 10⁶ · 400 / 2^b < 10⁻³ ⇒ b > log₂(4 × 10¹⁷) = 58.47 ⇒ b ≥ 59; at 52 bits 0.089, at 64
    2.2 × 10⁻⁵.
  - Textbook figures: Table 6.1 sums to 259.5 ms; cheapest layers 16.8/40 = 0.42 to 24.0/40 = 0.60 ms a tile;
    0.093/0.60 = 15.5 %, 0.093/0.42 = 22.1 %; four checkpoints × 40 tiles × 256 KiB = 40 MiB, eight layers 80 MiB.
    Editor lab's budgets are ×1,048,576 (`engine.js:401`), so the textbook's "MB" are MiB; the chapter now says MiB.
  - Order statistics: P(X₍ᵣ₎ ≥ q_p) = P(Bin(n, p) ≤ r − 1); r = n gives 1 − pⁿ; n ≥ ln 0.05 / ln p: 58.40 → 59
    (p = 0.95), 298.07 → 299 (p = 0.99). Assumes independent samples from a continuous distribution; noted as
    optimistic for correlated samples within a drag.
  - Exercise 10.2(a): n = 100, p = 0.95: F = 100 − B ~ Bin(100, 0.05); P(F ≤ 1) = 0.0371, P(F ≤ 2) = 0.1183, so
    P(F ≥ 2) = 0.963 ≥ 0.95 and r = 99 (the second largest).
  - Mean of p95s example (nearest rank): twenty at 10 ms → 10; eighteen at 10 and two at 100 → 100; mean 55, pooled
    (rank 38 of 40) 10 ms. Exercise 10.2(b) example: 19×10 + 1×100 (p95 10) and 19×20 + 1×100 (p95 20), mean 15,
    pooled rank 38 of 40 = 20 ms.
  - Fan-out: 1 − 0.99¹⁰⁰ = 1 − e^(−1.005) = 0.634 (independence assumed; Dean and Barroso's own example).
  - Exercise 10.2(c): exact q ≤ 1 − 0.95^(1/16) = 0.003201; linearised 0.05/16 = 0.003125.
  - Coordinated omission: a stall of S with user interval Δ gives ≈ S/Δ missing samples S, S − Δ, …, mean ≈ S/2.
- Chapter 9:
  - Solution rewritten to the invariant (five sentences): names, output-hash checkpoints, keep where saving per
    byte is largest, GDS with the clock rule and its LRU special case, verified tiers.
  - Note 1: derivation of the birthday bound and the bounded-cache bound, labelled a-priori for an ideal hash.
  - Note 5: Young's k-competitiveness stated with its definition (equal sizes, k entries); Cao and Irani only as
    extending the algorithm (I am not sure enough of their bound to state it). GDS = LRU when cost/size is constant
    only with a recency tie rule, because the clock moves only at evictions and entries touched between evictions
    tie. Editor lab breaks ties by first insertion (`engine.js:418`: strict `<` over Map order; the cost policy does
    not reorder on `get`, `:404`).
  - Note 6: the cost-aware counts depend on measured costs and can move between runs; LRU counts repeat.
  - Sketch: heap ordered by (H, seq) with a use counter for the tie rule; entries carry their key; cost floor
    `MIN_MS` and byte floor; the nondeterminism check now records `bad`, releases every hold, and refuses (no
    assert that would leak holds).
  - Glosses added: kernel, reduction, fence, OPFS, texture, fused segment.
  - Exercises: 1 now measures the tie rule and early cutoff with given parameters (eight layers, 0.5 / 2.2 ms,
    32 MiB = 128 tiles, 20 identity tiles); 2(b) marks the union bound as linearised; 3 gives costs and sizes.
    None repeats the modular chapter's (proxy trace, own forces, spreadsheet cutoff, build-it with a held entry).
- Chapter 10:
  - Solution rewritten to the invariant (five sentences); count gates and steering moved to notes.
  - Motivation: units in ms (4,100–4,300, 4,200 → 740, 0.1 ms); animation frame and pass glossed.
  - Notes: 1 states what `onSubmittedWorkDone` covers (all work submitted before the call, other code's included);
    2 states WebGPU timestamp semantics (optional feature, pass boundaries, 64-bit ns, may be quantised, not
    promised monotonic) and one line each for CUDA events (elapsed ms between two stream points) and Vulkan
    (`timestampPeriod` ns per tick); 6 gives the order-statistic derivation, the mean-of-p95s counterexample and the
    fan-out figure; 7 (new) treats coordinated omission as a sampling bias with HdrHistogram's
    expected-interval correction; the old "proportions vs sums" note merged into 2 and the fan-out note into 6.
  - Sketch: stamps per pass via `runPass`; ns → ms with non-positive differences mapped to `none`; `record` guards
    x ≤ lo; `quantile` returns none on an empty histogram; `gate` refuses an empty scenario or fewer than two rounds
    (no noise estimate from one baseline run); `conf` is part of the requirement; `dragExposure` and
    `segmentPasses` defined; `app.stop()` added.
  - Exercises: 1 no longer ends with an open-loop stall (the modular chapter's exercise 2); 2 asks for r at
    n = 100, a mean below the pooled value, and exact vs linearised q; 3 gives arrival rate, batch window, batch
    time and size cap.
- No task IDs or decision numbers in either chapter (grep for `P10`, `CHB`); no line over 120 characters.

### Why
- The reviewer's lessons, applied as listed.

### What worked
- The tie rule turned "GDS degenerates to LRU" from a slogan into a checkable statement and a one-field change in
  the sketch.

### What didn't work
- First pass at chapter 9 reached 3,194 prose words; trimmed Intent, Applicability, notes 3, 4, 7–9, Variations and
  Related chapters to 2,995.

### What I learned
- WebGPU's `onSubmittedWorkDone` covers everything submitted before the call, so a submit-to-signal time on a busy
  queue includes other code's work.

### What was tricky to build
- Releasing holds on the nondeterminism path without exceptions: the sketch records `bad`, finishes, releases, then
  refuses.

### What warrants a second pair of eyes
- From memory, not re-fetched: Young's k-competitiveness for weighted caching; the WebGPU specification's notes that
  timestamps may be quantised and may not increase monotonically; HdrHistogram's expected-interval correction;
  CUDA `cudaEventElapsedTime` in ms; Vulkan `timestampPeriod`.

### What should be done in the future
- The coordinator renders the mermaid diagram.

### Code review instructions
- Read both chapters' Solutions, notes (9: 1, 5, 6; 10: 1, 2, 6, 7) and sketches against this step's list.

### Technical details
- Counts after revision (`wc -w`; prose = outside code and mermaid fences): chapter 9 3,717 raw, 2,995 prose
  (before: 3,626 / 2,978); chapter 10 3,767 raw, 2,985 prose (before: 3,505 / 2,816).
