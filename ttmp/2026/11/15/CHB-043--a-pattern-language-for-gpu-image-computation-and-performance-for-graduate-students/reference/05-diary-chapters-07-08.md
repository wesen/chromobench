---
Title: Diary — chapters 7 and 8 (Budgeted Residency; Retire After the Fence)
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
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/07-budgeted-residency.md
      Note: chapter 7, written in this diary's Step 2
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/08-retire-after-the-fence.md
      Note: chapter 8, written in this diary's Step 3
ExternalSources:
    - https://www.w3.org/TR/webgpu/ (Candidate Recommendation Draft, 15 September 2026)
Summary: "Sources, claims with file:line, choices and removals for GPU-volume chapters 7 and 8."
LastUpdated: 2026-11-15T17:10:00-05:00
WhatFor: "Checking every claim about chromobench and Editor lab in chapters 7 and 8."
WhenToUse: "When revising chapters 7 or 8, or reviewing their facts."
---

# Diary — chapters 7 and 8

## Goal

Write chapters 7 ("Budgeted Residency", ★) and 8 ("Retire After the Fence", ★★) of *Fast and Checkable*, going deeper
than the modular volume's "Count What You Own" and "Keep What Is Dear", with every fact about the example programs
checked against the source. Abbreviations below: `CB` = the read-only chb037 worktree
`/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037`;
`EL` = the Editor lab book `…/scratchpad/editor-lab-src/editor-lab-work/editor-lab/src/book`;
`D41` = `CB/ttmp/2026/11/15/CHB-041*/diary/01-diary.md`; `D38` = `CB/ttmp/2026/11/15/CHB-038*/diary/02-diagnostics-implementation.md`.

## Step 1: Sources

I read the writer brief, the GPU overview, the modular chapters 08 and 09 and the image-engine chapter 04, then the
code and tickets the brief names. Nothing was run in the worktree; no git command was used. Two spec questions
(WebGPU `destroy()` semantics) were settled by downloading the W3C spec into the scratchpad and reading the text.

### Prompt Context

**User prompt (verbatim):** "Write chapters 7 and 8 of \"Fast and Checkable: GPU Image Computation Patterns\" (graduate
students). First read the shared brief in full and follow it exactly: …/playbooks/01-writer-brief.md" (followed by the
scope, sources and known uses of each chapter, the sibling chapters to read and this diary's file name).

**Assistant interpretation:** Write the two chapters to the brief's template and rules, verify every example claim,
record sources and choices here, and report debts and unverifiable claims.

**Inferred user intent:** Two graduate-level chapters that can stand next to the other eight without contradicting
the code or the sibling volumes.

### What I did
- Read `CB/packages/gpu/src/{pool,residency,limits,device,film,engine-gpu,spatial,timing}.ts`,
  `CB/packages/gpu/src/engine/textures.ts`, `CB/packages/gpu/src/chain/run.ts` (submit sites),
  `CB/packages/gpu/kernels/pointwise.wgsl:385`, `CB/e2e/memory.spec.ts`, `CB/e2e/diagnostics.spec.ts`,
  `CB/packages/gpu/test/residency.test.ts`, `CB/apps/studio/src/host/capture.ts`, `CB/tools/scripts/console-capture.ts`,
  `D41` (all), `D38` Step 5, `CB/ttmp/2026/11/14/CHB-037*/tasks.md` (P10 list), `EL/06.md`, `EL/08.md`, `EL/09.md`.
- Downloaded `https://www.w3.org/TR/webgpu/` to `…/scratchpad/webgpu-spec/tr.html` and grepped the text.

### What I learned (claims and where they are)
Chapter 7:
- Units: every chromobench "MB" in the measurements is bytes / 2^20, i.e. MiB: `CB/tools/scripts/console-capture.ts:61`,
  `CB/apps/studio/src/host/capture.ts:30`, `CB/e2e/memory.spec.ts:19`. Exceptions (decimal MB in comments):
  `CB/packages/gpu/src/film.ts:334` "a 4000-px one is 171 MB" (171,904,000 B) and `CB/e2e/memory.spec.ts:30` "61 MB".
  The chapters use MiB throughout.
- Budget rule: `CB/packages/gpu/src/device.ts:25` (512 MiB floor), `:35` (fraction 1/8, cap 2 GiB, software cap 1 GiB,
  assumed 4 GiB), `:38-48` (`budgetFor`), `:192-195` (`budgetBytes` override; adapter's `maxBufferSize`, not the
  device's). Floor beats `maxBufferSize`: `CB/packages/gpu/test/residency.test.ts:213`. `?gpuBudget=MB`:
  `CB/apps/studio/src/main.ts:158-160`, `CB/apps/studio/src/host/engines.ts:57-58`.
- `navigator.deviceMemory` 32 on the test Mac: `D41:89`. Device-vs-adapter `maxBufferSize` bug (1024 instead of 2048):
  `D41:215-216`; the device's cap comes from `CB/packages/gpu/src/limits.ts:7` (`maxBufferSize: 2 ** 30`).
- Before: error text and ×9: `D41:101-103`; live 507 of 512 MiB, textures 328 live + 19 free, buffers 160 free:
  `D41:98-99`; three holders: `D41:108-116`. After: peak 199/215 MiB, textures 47 MiB, free buffers 48 MiB, the same
  under `?gpuBudget=512`: `D41:409-416`. Ten 2400 × 1600 scans: peak 109 MiB, 69 MiB kept, 7 MiB on screen: `D41:205-206`.
- My arithmetic (working size superseded in Step 5: 4000 × 2674): 4000 × 2686 × 16 = 171,904,000 B = 163.9 MiB; 536,870,912 − 525,083,680 = 11,787,232 B = 11.2 MiB;
  14,192,640 B = 13.5 MiB; 160 × 107 = 17,120 px of 10,744,000; 6000 × 4000 × 16 = 384,000,000 B = 366.2 MiB, ten =
  3.58 GiB; 3000 × 2000 × 16 = 96,000,000 B = 91.6 MiB.
- One ledger across pools: `CB/packages/gpu/src/pool.ts:34-89` (`Budget`, `makeRoom` 74-80, `trimFree` 82-88, shared
  clock 63). Staging over 16 MiB not pooled: `CB/packages/gpu/src/engine/textures.ts:23,66,94`.
- Ones textures in the pool and a reclaimer: `CB/packages/gpu/src/film.ts:71-84,347`. Film table buffers still made
  directly: `CB/packages/gpu/src/film.ts:100`.
- Residency: `CB/packages/gpu/src/residency.ts:29` (PROXIES_KEPT = 4), `:13-14` ("a rule, not a measurement"),
  `:54-70` (put, cap), `:72-79` (lease/unlease ignore missing keys), `:94-111` (eviction order: pinned, owner recency,
  item recency; leased skipped unless `all`). Proxy cap = full-size bytes: `CB/packages/gpu/src/engine-gpu.ts:440`.
  Source choice (full kept → proxy → full → crop): `CB/packages/gpu/src/engine-gpu.ts:420-457`.
- Exact proxies: `CB/packages/gpu/src/residency.ts:162-168` (`Math.fround`; comment on exact f64 product);
  `CB/packages/gpu/kernels/pointwise.wgsl:385`; tests `CB/packages/gpu/test/residency.test.ts:170-183`; zero differing
  samples on SwiftShader and Metal: `D41:202`, `D41:396-397`. Origin bug in the comparison path: `D41:211-214`.
- Recovery: `CB/packages/gpu/src/engine-gpu.ts:914-940` (dropFields, `relieve`, retry once, message with budget rule);
  `CB/packages/gpu/src/device.ts:298-312` (`reclaim`, `relieve`). "Fails twice as slowly": `D41:241`.
- `acquireChecked` (error scope, trim, halve, retry): `CB/packages/gpu/src/pool.ts:137-155`; used only in a test: P10-5.
  The halving at `:149` is permanent (my reading: nothing restores `limit`).
- Injection: `CB/packages/gpu/src/pool.ts:66-72,116`; the first version's failure: `D41:221-224`.
- Journal rows: `CB/apps/studio/src/host/capture.ts:32` (32 MiB step), `:78-92`; per-render window `pool.ts:57-61`,
  `engine-gpu.ts:900,911`.
- Half floats: `D41:303-305` (display max |Δ| 0.0134, 3.4 levels; scene 1.6e-4 against 3e-5).
- Eviction decision (GreedyDual-Size ≡ LRU when cost ∝ size; deferred): `D41:330-337`.
- Editor lab textbook: table 8.1 (`EL/08.md:149-157`, 384 MB decimal), requirement "any state · memory · the device
  class's budget, measured" (`EL/09.md:16`), worked (time) budget (`EL/09.md:151-170`), GEGL/Krita/darktable budgets
  (`EL/06.md:121`).

Chapter 8:
- The bug, cause and steps: `D38:351-357`, `D38:371-382`; old code `D38:438`; pass awaits pipeline then submits then
  awaits `onSubmittedWorkDone`: `CB/packages/gpu/src/film.ts:117,137-139`; lockstep explanation `D38:374-378`.
- Fix: `CB/packages/gpu/src/device.ts:259-282` (`busy`, `retire`), `CB/packages/gpu/src/engine-gpu.ts:246` (all engine
  work in `busy`), `CB/packages/gpu/src/film.ts:329-356` (per size, newest four, retired).
- `Pool.release` ignores objects not live: `CB/packages/gpu/src/pool.ts:157-159`; `discard` retires and frees bytes at
  once: `:204-212`; recovery evicts leased textures: `CB/packages/gpu/src/residency.ts:105`; `D41:230-234`.
- "Bounded in practice" for the global counter: `D38:418-421`. Retired bytes leave the ledger at once:
  `CB/packages/gpu/src/pool.ts:195,211`.
- dropFields race (released into pool while an export tile may still read): `D38:424-425`; code
  `CB/packages/gpu/src/engine-gpu.ts:805-809,894`.
- Over-fencing: `onSubmittedWorkDone` after each pass in `CB/packages/gpu/src/film.ts:138` and
  `CB/packages/gpu/src/spatial.ts:104`; release right after submit in `CB/packages/gpu/src/engine/textures.ts:64-65,92-96`.
- Labels and activity: `D38:383-386`; `CB/packages/gpu/src/device.ts:93,144-145`; labelled message `D38:331-332`.
- Tests: deterministic interleaving `CB/e2e/diagnostics.spec.ts:193-228` (five other sizes at 209; retiring checks
  225-227); the first e2e test passed on old code: `D38:408-409`.
- Pool keys: `CB/packages/gpu/src/pool.ts:252` (texture key), `:261-263` (256-byte buckets).
- WebGPU spec (TR, CRD 15 September 2026), text from `…/scratchpad/webgpu-spec/tr.txt`: §6.1.4 note "This allows the
  user agent to reclaim the GPU memory associated with the GPUTexture once all previously submitted operations using it
  are complete" (and §5.1.4 the same for buffers); §19.2 `submit()` validation "t.[[destroyed]] must be false" for
  every texture in a used bind group; §3 timelines: content, device, queue.

### What I could not verify, and removed or softened
- That `navigator.deviceMemory` is capped by browsers at 8: the CHB-041 measurement says 32 on the test Mac, so I
  cite the measurement and say only "rounded by the browser".
- id Tech 5: I name *Rage* (2011) and "MegaTexture" but not a specific talk; Barrett's GDC 2008 "Sparse Virtual
  Textures" kept. GEGL's 512 MB floor (from the textbook) not used in the chapter.
- The cost of `onSubmittedWorkDone` per pass: not measured; stated as unmeasured.
- Unreal's streaming pool prioritising by on-screen size: stated generally; no version-specific claim.

### What should be done in the future
- See Step 4 (debts).

## Step 2: Chapter 7 — Budgeted Residency

The chapter goes past the modular volume by treating the budget as a rule (and why it cannot be a measurement),
adding proxies with an exactness argument, analysing eviction (GreedyDual-Size reduces to LRU when cost ∝ size, but
only with ties broken by age), separating the ledger's refusal from the driver's out-of-memory, and turning the
textbook's worked budget into an exercise.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Chapter 7 to the template, 2,200–3,000 words.

**Inferred user intent:** A graduate reader can derive and defend a device-memory budget and residency policy.

### What I did
- Wrote `docs/patterns/gpu/07-budgeted-residency.md`; trimmed from 3,378 to about 3,000 words of prose.
- Checked Exercise 3 by search (my script, scratchpad, numpy f32): for W = 6000 the smallest n where
  ⌊fl32((p + ½)·fl32(W/n))⌋ differs from the f64 value is n = 19 (p = 9: 2999 against 3000). The disagreement is at
  most one pixel because the f32 error is below W·2⁻²³ ≈ 0.0007 px.

### Why
- Motivation re-derives the 507 MiB rather than listing the modular chapter's four failures in the same words.
- Sketch fixed during review: the per-task window leaked when `sourceFor` threw (window now opened inside `try`); a
  crop for one task is discarded explicitly instead of "released by run" in a comment; `lease`/`unlease` tolerate
  keys evicted by a recovery.

### What was tricky
- GreedyDual-Size with uniform cost per byte gives every item accessed between two evictions the same H; it is LRU
  only with ties broken by recency. CHB-041's diary says "degenerates to LRU" without the tie condition; the chapter
  and Exercise 2 state it.
- Proxies: the per-owner bound is "about twice the full size", since leased proxies are excluded from the cap.

### What warrants a second pair of eyes
- The Structure table and headings count toward the 3,000 words; prose proper is just under.
- The sketch's `put` keeps the newest proxies that fit (greedy, newest first); the code drops beyond four then trims
  oldest until under the cap. Same intent, slightly different order.

## Step 3: Chapter 8 — Retire After the Fence

The chapter separates the host's release from the device's last use, states WebGPU's rule from the spec (destroy is
valid after submission; submit validates "not destroyed"), and makes the central lesson of the bug explicit: the
hazard was on the host's timeline, between taking a handle and recording its use, so a task must declare its use when
it takes the handle. The sketch replaces chromobench's global quiescent counter with per-resource counts of unfinished
batches, parameterised by the platform's finish rule.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Chapter 8 to the template.

**Inferred user intent:** As Step 2.

### What I did
- Wrote `docs/patterns/gpu/08-retire-after-the-fence.md` (about 2,940 words of prose).
- Rendered its mermaid sequence diagram with `npx -y @mermaid-js/mermaid-cli@11.4.2 -i x.mmd -o x.svg` in
  `…/scratchpad/mmd-ch08/`: rendered (26 kB SVG). A first attempt combining extraction, `timeout` and npx in one
  command was refused by the permission classifier; the plain command from the brief worked.

### What was tricky
- The "highest batch id" shortcut is unsafe when batches submit out of creation order; the sketch counts per resource
  instead, and Exercise 2b asks for the counterexample. The first draft of the Epochs variation made the same mistake
  (tag with the epoch of the last use); fixed to tag with the retirement epoch and wait for every batch that began at
  or before it.
- "Waiting for the device after every pass" did not prevent the bug; the chapter says so rather than presenting
  waiting as the safe baseline.

### What warrants a second pair of eyes
- Exercise 2c uses the M/M/∞ (indeed M/G/∞) mean busy period (e^ρ − 1)/λ; standard, but check the reader's level.
- Known uses: Metal's retained references, CUDA 11.2 stream-ordered allocator, PyTorch `record_stream`, Musuvathi et
  al. (CHESS, OSDI 2008), Garey–Johnson's dynamic storage allocation (unnamed in text, "NP-complete") are from memory.

## Step 4: Verification and debts

Checked line widths (≤ 120 outside tables), privacy (no file names, persons or camera brand; "two 24-megapixel raw
files" only), terms (a "frame" in chapter 8 is a displayed image, defined once; chapter 7 avoids the code's "frame"
for an open image and says "owner"), and word counts with a script that strips fenced code.

### New chromobench debts (not in P10-1…P10-9)
1. **Retired memory is uncounted and unbounded.** `retire` defers destruction until `busy`'s count is zero
   (`device.ts:279-282`); retired bytes leave the ledger at once (`pool.ts:195,211`). Under continuously overlapping
   renders nothing bounds the retired list, and the device holds memory the budget does not count. Fix: per-resource
   batch counts or epochs; or count retired bytes as "pending" in the ledger.
2. **Pool reuse before the last reader's submit.** `dropFields` releases an exact export's field textures into the pool
   when a preview starts (`engine-gpu.ts:805-809,894`); an export tile that took one and has not submitted can read
   another render's writes (noted in `D38:424-425`, not fixed, not in the task list).
3. **Over-fencing.** `film.ts:138` and `spatial.ts:104` await `onSubmittedWorkDone` after every pass before releasing a
   uniform buffer; `engine/textures.ts` releases right after submit, which queue order makes safe. Cost unmeasured.
4. **Ledger bypass and an avoidable allocation.** Film table buffers made with `device.createBuffer` outside the budget
   (`film.ts:100`); the texture of ones (full size: 164 MiB) supplies a constant a uniform could.
5. **Stale header comment.** `pool.ts:1-3` still describes "halve the budget and retry once" as the policy (belongs with
   P10-5).

### Overview change recommended
- None required. Optional: the overview's one-line sketch for 7 (`budget = clamp(deviceMemory / 8, 512 MiB, 2 GiB)`)
  omits the `maxBufferSize` cap and the software-adapter cap; it is a fair summary.

## Step 5: Revision after review

The coordinator relayed a fresh reviewer's lessons from chapters 2 and 6 (recompute numbers; bounds versus
measurements; derived models; precise device semantics; MiB; Solution as the invariant only; no internal IDs; sketch
hygiene; glosses; no duplicate exercises; cut material duplicated with the modular volume). I applied them to both
chapters. No mermaid-cli run in this step (the coordinator renders diagrams).

### Prompt Context

**User prompt (verbatim):** (see Step 1); relayed by the coordinator: "Revision round. A fresh reviewer (first-year
PhD reader) reviewed chapters 2 and 6 and found errors that generalise. Apply these lessons to your chapters 7 and 8.
…"

**Assistant interpretation:** Revise chapters 7 and 8 against the general lessons, prose ≤ 2,900 words each, and
record the changes here.

**Inferred user intent:** Chapters a first-year PhD reader can check line by line.

### What I did
- **Working size corrected.** The camera files' working image is 4000 × 2674, not 4000 × 2686: CHB-034's diary
  (`CB/ttmp/2026/11/14/CHB-034*/diary/01-diary.md:303`, "Portraits come out 2674 × 4000 (GPU)") and the 4000-px
  default (`CB/apps/studio/src/host/engines.ts:112`). CHB-041's diary used 2686. My arithmetic: 4000 × 2674 × 16 =
  171,136,000 B = 163.2 MiB per texture (two: 326.4 MiB; the measured 328 MiB of live textures includes small ones);
  10,696,000 px; the f32 RGB staging buffer 4000 × 2674 × 3 × 4 = 128,352,000 B = 122.4 MiB
  (`CB/packages/gpu/src/engine/textures.ts:77-84`, `bytes = w·h·c·4`). Chapter 7 now says the raw files are decoded
  to a 4000-px working image and uses 163 MiB.
- **Chapter 7.** Rewrote the whole file. Motivation now carries the staging story (chapter 6 points here). Solution
  cut to five sentences of invariant. A new note models the peak as max(R + W + F), with the measured split: at rest
  after the second file R = 328, F = 179 (160 buffers + 19 textures), 5 MiB free, and the texture pool could trim only
  its own 19 MiB, so any render needing more than 24 MiB failed (my arithmetic from `D41:98-99`). After the fix,
  215 − 47 − 48 ≈ 120 MiB of working set (my subtraction, labelled as such). The same note covers why a byte count is
  not placeable memory (alignment, retired-but-pending units, fragmentation). The budget note now derives each term,
  with worked machines (32 GiB → 2 GiB, 8 GiB → 1 GiB). Bound (≈ 2× full size per owner) and measurement (109 MiB
  peak in 512 MiB) are separated. The task ID and the CHB names are gone. Leases, pins, proxies, staging buffers, the
  software adapter, the journal and error scopes are glossed. Recovery and leases now link to the modular chapter
  instead of repeating it. The PostgreSQL and Android/iOS known uses were dropped (the modular chapter has them).
- **Chapter 7 sketch.** Guards added: a non-positive or missing `memory`, `override` or `maxBuffer`; an empty
  render; an allocation larger than the whole budget (refused as "too-large" and not retried, since no eviction can
  help). `run` is now defined and releases its output. `upload` is defined, and its staging buffer is discarded after
  the copy. `Ledger.release` ignores a unit retired meanwhile. `ledger.rule` replaces a free variable, and `unlease`
  cannot go negative.
- **Chapter 7 exercises.** The old Exercise 3 (f32 grid exactness) duplicated chapter 3's exercises 1–2, and the old
  2(b) overlapped chapter 9's exercise 1. They are replaced by fragmentation (first fit, a counterexample, Robson's
  bounds, *JACM* 1971, cited from memory) and owner-level against unit-level eviction (proxy sizes 0.26 MiB =
  160 × 107 × 16 B and 22.9 MiB = 1500 × 1000 × 16 B). Exercise 1 keeps the textbook's worked budget, with the
  parameters given.
- **Chapter 8.** WebGPU's guarantees are stated against what implementations decide: `submit` validation (§19.2),
  the `destroy()` note (§6.1.4, a non-normative note), and `writeBuffer` and `submit` both issuing steps on the queue
  timeline (§19.2). That the queue timeline runs in call order is my reading of the spec's timeline model; I found no
  single sentence that says it. One line each was added for Vulkan (commands must complete before destroy; fences,
  deletion queues), Direct3D 12 (fence values) and CUDA (`cudaFreeAsync` stream order; events or PyTorch
  `record_stream` across streams). New notes give the happens-before chain for destroy and reuse, and explain why
  per-resource counts are needed: batches are numbered at begin and submitted after awaits, and several queues
  complete out of order. "CHB-038 diary" became "the fix's own notes". The never-resurrect and forced-interleaving
  notes were merged and link to the modular chapter. The journal and lease are glossed. "Label every resource" moved
  out of the Solution, which is now the invariant only. The Simplicity force was merged into Precise tracking.
- **Chapter 8 sketch.** `record` is defined in a comment line, and `release` guards against a double release.
- **Chapter 8 exercises.** Exercise 1 extends chapter 10's fake device instead of duplicating it, with parameters
  (2 ms completion, Poisson arrivals, 5 ms mean tasks, four 16 MiB resources, ρ from 0.2 to 3). Exercise 2(a), which
  the new note 3 now answers, became the two-queue extension.

### Word counts (script strips fenced code; headings, tables and list markers counted)
- `07-budgeted-residency.md`: raw 3,950; prose 2,896.
- `08-retire-after-the-fence.md`: raw 3,451; prose 2,885.

### What warrants a second pair of eyes
- Chapter 7's peak split (R, F, W) mixes a measurement at rest with an error message taken mid-render (500.8 MiB
  live then, 507 MiB at rest). The note uses the at-rest numbers and says so.
- Chapter 8, note 2's "call order" claim for the queue timeline (see above).
- The diagram text in chapter 8 is unchanged since it was rendered in Step 3.
