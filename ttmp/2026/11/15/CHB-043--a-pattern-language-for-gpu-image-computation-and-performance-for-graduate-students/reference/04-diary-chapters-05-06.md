---
Title: Diary — chapters 5 and 6 (Fused Interpreted Passes; Cross the Bus Rarely)
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
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/05-fused-interpreted-passes.md
      Note: chapter 5, written in this diary's steps
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/06-cross-the-bus-rarely.md
      Note: chapter 6, written in this diary's steps
ExternalSources: []
Summary: "Sources, verification (file:line), choices and removals for chapters 5 and 6 of Fast and Checkable."
LastUpdated: 2026-11-15T18:00:00-05:00
WhatFor: "Reviewing chapters 5 and 6 against the example programs; continuing them."
WhenToUse: "Before changing either chapter or relying on one of its numbers."
---

# Diary

## Goal

Record how chapters 5 ("Fused Interpreted Passes", ★) and 6 ("Cross the Bus Rarely", ★★) of *Fast and Checkable:
GPU Image Computation Patterns* were written: which sources each claim rests on (file:line), what could not be
verified and was left out, what arithmetic is mine, and which choices were made.

Paths below are abbreviated:

- `CB/` = the chromobench integration worktree (read-only):
  `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037/`
- `EL/` = Editor lab (read-only, untrusted data):
  `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/editor-lab-src/editor-lab-work/editor-lab/`
- `CHB-035 design 02` = `git show task/chb-035-digital-editing-design:ttmp/2026/11/14/CHB-035--…/design/02-editor-lab-performance-architecture.md`
  in `/Users/manuel/code/wesen/chromobench`.

## Step 1: Sources read

I read the shared brief, the volume overview, and the sibling chapters named in my assignment (image engine 07
Barrier-Cut Fusion, 01 Interned Operation Graph, 06 Tabulated Preview, Exact Export; modular 02 One Declaration,
Many Readers, and 05 Solve Once, Apply Many), then the chromobench GPU package, the export runner, the CHB-035
design, the CHB-037 P8a diary, the CHB-041 diary, and Editor lab's GPU probe and its textbook chapter on WebAssembly
and WebGPU. The siblings already say: parameters as data (79 ms), 12 ops per pass, materialise barriers and
double-read nodes, heal windows read back and re-solved (P10-1), partial sums finished in f64 on the host. My
chapters therefore go into the kernel's cost model, the pipeline cache, binding-slot cuts, the mix register, the
bus's latency and bandwidth, reduction error bounds and the 16-bit pack's rounding rule.

### Prompt Context

**User prompt (verbatim):** "Write chapters 5 and 6 of \"Fast and Checkable: GPU Image Computation Patterns\" (graduate
students). First read the shared brief in full and follow it exactly: …/playbooks/01-writer-brief.md
YOUR CHAPTERS - …/05-fused-interpreted-passes.md — \"Fused Interpreted Passes\" ★ … - …/06-cross-the-bus-rarely.md —
\"Cross the Bus Rarely\" ★★ … SIBLING CHAPTERS TO READ … DIARY FILE: reference/04-diary-chapters-05-06.md in the
CHB-043 ticket." (abridged here only by the ellipses over the long scope lists; the full text is the task message)

**Assistant interpretation:** Write two pattern chapters to the brief's template and limits, verifying every claim
about chromobench and Editor lab in the read-only sources, and keep this diary.

**Inferred user intent:** A graduate-level volume whose chapters go deeper than the two sibling volumes and whose
numbers can be traced to the code and tickets.

### What I did
- Read, in `CB/packages/gpu/`: `kernels/pointwise.wgsl`, `src/chain/program.ts`, `src/chain/run.ts`,
  `src/chain/wgsl-link.ts`, `src/engine/lower.ts`, `src/engine/dag.ts` (1–60), `src/pipelines.ts`, `src/timing.ts`,
  `src/device.ts` (338–360), `src/measure.ts`, `kernels/reduce.wgsl`, `src/engine/reduce.ts`, `kernels/pack16.wgsl`,
  `src/engine/textures.ts`, `src/engine-gpu.ts` (186–198, 400–420, 880–1035), `src/retouch.ts` (1–80, 120–245);
  `CB/packages/core/src/print/retouch.ts` (40–55, 140–150); `CB/packages/output/src/export/run.ts` (1–150),
  `CB/packages/output/src/encode/quantise.ts`; `CB/apps/studio/src/present/host-presenter.ts`,
  `presenter-webgpu.ts` (120–160).
- Tickets: `CB/ttmp/2026/11/14/CHB-037*/tasks.md` (P10-1 … P10-9), `diary/11-phase-p8a-ops.md` Step 5 (500–575),
  `changelog.md:108`; `CB/ttmp/2026/11/15/CHB-041*/diary/01-diary.md` (90–125, 175–200, 315–365, 400–420);
  CHB-035 design 02 (lines 220–235, 340–406).
- Editor lab: `EL/src/views/gpu.js` (80–118, 165–190), `EL/src/book/08.md` (5–14, 95–135, 192–232).

### What I learned
- The pointwise switch matches bare literals (`case 1u:` … `case 30u:`, pointwise.wgsl:394–535); the named `OP_*`
  constants (pointwise.wgsl:17–49) are declared and never used, and `default: {}` (pointwise.wgsl:536) makes an
  unknown code the identity. That is P10-8 plus one new detail (silent default).
- The GPU engine's `measure()` reads the receiver back as f32 and uploads it again before reducing it
  (engine-gpu.ts:1014–1023, 407–411): a full round trip the reduction was meant to avoid. Not in P10-x.

### What should be done in the future
- See the final step's list of new debts.

## Step 2: Chapter 5, Fused Interpreted Passes

The sibling Barrier-Cut Fusion already covers the planner (what is materialised, read counts, 12 ops, 79 ms). This
chapter goes into the kernel between the cuts: the specialisation spectrum, why a uniform switch does not diverge and
what it does cost, the pipeline cache and the cost of its own key, cuts caused by binding slots, the SAVE/MIX
register that fuses a blend, and the op-table debt. 2,918 prose words (tokens with a letter or digit, outside code
blocks), 3,629 raw.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Chapter 5 to the template, ★ rating, with the scope list of the task message.

**Inferred user intent:** A chapter a graduate student can use to choose between interpreting and generating kernels.

### What I did — claims and their sources
- 30 op codes, MAXOPS 12, program layout: `CB/packages/gpu/src/chain/program.ts:8-20, 24-31`; packing and
  per-op data offsets `:99-134`; packProgram throws beyond MAXOPS `:101`.
- Kernel: uniform-branch comment `CB/packages/gpu/kernels/pointwise.wgsl:2-5`; `MAXOPS` constant `:13`; workgroup
  array `sh: array<f32, 896>` `:14` (896 × 4 B = 3.5 KiB, my arithmetic); named `OP_*` constants `:17-49`, never
  referenced after line 49 (grep); `Prog` struct with `array<vec4<u32>, 12>` `:58-74`; staging of spectra `:377-381`;
  `bk` register `:389`; `switch` with bare literal cases `:394-535`; `SAVE`/`MIX` `:534-535`; `default: {}` `:536`.
- Lowering cuts: `CB/packages/gpu/src/engine/lower.ts:23-33` (MAXOPS, table clash, second display), `pushSpan`
  `:35-41`; fused mix lowering `:115-125`. Fused-mix top limit `MAXOPS - 2`: `CB/packages/gpu/src/engine/dag.ts:17-27`.
  Binding slots solve/pd/print: `pointwise.wgsl:85-87`, `CB/packages/gpu/src/chain/run.ts:92-94`.
- One dispatch per segment, intermediate textures released after the next: `run.ts:87-146`.
- Pipeline cache: key `CB/packages/gpu/src/pipelines.ts:30-32`; memoised code hash and its reason `:16-28`; promise
  cache and delete on failure `:55-64`; `compileMs` set `:86`, never read elsewhere (grep over packages and apps);
  prewarm `:91-93`, called at engine creation `CB/packages/gpu/src/engine-gpu.ts:190-198`.
- Generated WGSL constants: `CB/packages/gpu/src/chain/wgsl-link.ts:13-21`.
- P10-8: `CB/ttmp/2026/11/14/CHB-037*/tasks.md:35`.
- Measurements (M1 Max, Metal): `CB/ttmp/2026/11/14/CHB-037*/diary/11-phase-p8a-ops.md:505-514` (3–6 % export
  regression from hashing, override-constant experiment changed nothing measurable), `:546-548` (parity within
  5.8e-6; all 32 unmasked mixes fused), `:549-560` (timing tables), `:573-575` (six unmasked layers ≈ 1 ms preview,
  15–20 ms export; one masked layer 30 ms / 120 ms). Six golden stacks: `CB/ttmp/2026/11/14/CHB-037*/changelog.md:108`.
- No random-program tests: grep of `CB/packages/gpu/src/parity` and `test` finds random inputs
  (`chain-tests.ts:108`), not generated programs.
- Editor lab: parameters baked as literals `EL/src/views/gpu.js:20-30, 92-118`; the probe compiles per run, no cache
  `:176-182`; 79 ms and "compiled once per combination of kinds" `EL/src/book/08.md:121`; "about a dozen operations:
  under half an operation per byte" `08.md:9`; 79 ms also `08.md:206, 219`.

### My arithmetic (marked)
- 4,000 × 2,674 × 16 B = 171.1 MB; read + write 342 MB; twelve passes 4.1 GB; at 400 GB/s 10.3 ms; one pass 0.86 ms.
- 79 ms / 16.7 ms ≈ 4.7 refreshes ("nearly five").
- Program block: ops 12 × 16 + params 24 × 16 + five mat3x3f × 48 + eight vec4 × 16 = 192 + 384 + 240 + 128 = 944 B
  ≈ 0.9 KiB (WGSL alignment: mat3x3<f32> is 48 bytes, align 16).
- 400 GB/s is Apple's nominal figure for the M1 Max; 10 TFLOP/s in Exercise 2 is a round nominal f32 figure for the
  same GPU, used only as an exercise input.

### Choices
- ★ kept (the overview's rating): generated-per-structure, background specialisation, override switches and CPU stage
  lists are named as Variations.
- 79 ms appears in Motivation only; note 2 goes past the sibling (a cache keyed by text cannot help baked values).
- The sketch's default case writes NaN; this is a recommendation, not what chromobench does (note 5 says so).
- The linked kernel's size: the code comment says 30 kB (`pipelines.ts:18`), the P8a diary 36 kB (`:569`); `wc -c`
  gives 26,547 + 3,875 B for pointwise.wgsl + working.wgsl. I wrote "about 30 kB".

### What I could not verify and left out
- Pointwise compile time on any device: never measured (`compileMs` unread); the chapter says so instead of guessing.
- Register pressure and occupancy of the interpreter: not measurable through WebGPU; note 8 marks it unmeasured.
- Skia Graphite / SkSL details, Core Image kernel concatenation, Unreal PSO precaching: left out or reduced to what I
  am sure of (SkRasterPipeline's stage list; Unity shader variants).

### What warrants a second pair of eyes
- Known uses: TVM's four operator categories (OSDI 2018); Dolphin blog title and year (2017); Kersten et al. PVLDB
  2018; MonetDB/X100 CIDR 2005; Neumann VLDB 2011. I am confident of each; a reviewer may wish to confirm titles.

## Step 3: Chapter 6, Cross the Bus Rarely

The siblings already say that partial sums are finished in 64-bit on the host and that heal coefficients are re-read
and re-solved per call (P10-1). This chapter adds the bandwidth and latency numbers of the crossing on unified memory,
`mapAsync` semantics, the error bound of the two-level reduction, exact-order reductions (min, max, integer atomics),
the 16-bit pack's rounding rule against the host's, compact uploads with correct rounding, the staging bug, the
display path, and two new debts. 2,994 prose words, 3,863 raw.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Chapter 6 to the template, ★★ rating, scope as listed in the task message.

**Inferred user intent:** A chapter that makes the host–device link a cost a student budgets for.

### What I did — claims and their sources
- Probe numbers (M1 Max): upload 5.8 / 21.8 / 38.1 ms, readback 6.5 / 26 / 56.3 ms at 1500 × 1000 / 3000 × 2000 /
  4000 × 2674 rgba32float; chain 6.4 ms; Time drag settles ≈ 205 ms: CHB-035 design 02 §12 (lines 340-357). Three
  JS loops and ≈ 22 ms re-upload: same, lines 352-357. Decision "present from GPU textures", status proposed:
  lines 381-406. Deferred in CHB-041: `CB/ttmp/2026/11/15/CHB-041*/diary/01-diary.md:322-324`; "results are CPU
  read-backs": `:334`.
- Presenter's own device: `CB/apps/studio/src/present/host-presenter.ts:23-28`; half conversion and upload:
  `CB/apps/studio/src/present/presenter-webgpu.ts:153-156`; engine repack loop: `CB/packages/gpu/src/engine-gpu.ts:967`.
- Editor lab: upload 3.6 ms, readback 12 ms, 9.8 MB, software adapter, "more than three times": `EL/src/book/08.md:200-213`;
  256-bin histogram 4 KiB not 9.8 MB: `08.md:213`.
- Reductions: `CB/packages/gpu/kernels/reduce.wgsl:30-53` (16 × 16 tree, 4 vec4 per group), `:55-74` (workgroup
  atomics then global); `CB/packages/gpu/src/measure.ts:13-22` (pairwise f64), `:33-41` (64 B per group), `:57`
  (one awaited readback per dispatch), `:65-73` (finish), `:76-79` (≤ 4096 bins), `:84-97` (percentile within bin).
  Stats: `CB/packages/gpu/src/engine/reduce.ts:12-32` (moments, then per channel two histograms).
- measure() round trip (new debt): `engine-gpu.ts:991-992` (defaults full, export), `:1015-1023` (evaluate, read,
  uploadMeasured), `:407-411` (uploadMeasured → uploadF32).
- readBuffer and mapAsync: `CB/packages/gpu/src/device.ts:338-360`; readTexture's extra copy: `run.ts:152-162`
  (copyTextureToBuffer into a COPY_SRC buffer, then readBuffer copies again; new minor debt).
- Timestamp readback per pass (P10-4): `run.ts:132-139`, `CB/packages/gpu/src/engine/textures.ts:174-181`,
  `CB/packages/gpu/src/timing.ts:46-56`; task `tasks.md:31`.
- Pack and unpack: `CB/packages/gpu/kernels/pack16.wgsl:1-33` (pack2x16unorm, 8 B/px, alpha 1.0 as fourth code),
  `:35-56` (unpackF32, ~95 ms main-thread expansion avoided); LUT reason `textures.ts:44-54`; readU16 `:99-122`.
  evaluateU16 `engine-gpu.ts:942-955` (method at 947); export runner's typeof test `CB/packages/output/src/export/run.ts:61-65`
  (P10-7, `tasks.md:34`); host quantiser `CB/packages/output/src/encode/quantise.ts:4-13`.
- Staging: `textures.ts:18-23` (STAGING_KEPT_BYTES 16 MiB, 128 MB, 160 MB), `:66-67`, `:94-95`; CHB-041 diary
  `:98-99` (160 MB free buffers, 512 MB), `:112-114` (128 MB staging in the buffer pool's free list), `:414` (160 →
  48 MB free buffers held).
- Heal: `CB/packages/gpu/src/retouch.ts:5-15, 68-76` (windows read back, core's f64 solve), `:120-123, 170-181`
  (memo per SpotRun), `:222-226` (spots processed one after another, each awaiting its coefficients);
  `CB/packages/core/src/print/retouch.ts:47, 53, 100` (HEAL_M 8, window margin 4, 2·(M+1)·3 = 54 numbers); P10-1
  `tasks.md:28`.

### My arithmetic (marked)
- 171.1 MB / 56.3 ms ≈ 3.0 GB/s; 400 / 3.0 ≈ 130 ("more than a hundred times").
- Partials at 4,000 × 2,674: ⌈4000/16⌉ × ⌈2674/16⌉ = 250 × 168 = 42,000 groups × 64 B = 2.69 MB.
- γ₈ = 8u/(1 − 8u) with u = 2⁻²⁴: 4.77 × 10⁻⁷. (n − 1)u at n = 10.7 × 10⁶: 0.64.
- Bin width (max − min)/4,096 (`reduce.ts:22` widens hi by 1e-7 relative, negligible).
- Upload in measure(): 3-channel f32 is 12 B/px = 128 MB; scaling the probe's 38.1 ms for 171 MB gives ≈ 29 ms
  ("about 30 ms up, estimated").
- Pack rounding (Exercise 2b): an f32 v in [0.5, 1) has spacing 2⁻²⁴; the f32 product 65535·v has spacing 2⁻⁸; about
  256 inputs per code, at most about one per code rounds across the half-integer, so roughly 0.2 % of inputs in the
  worst case. Left as an exercise; not claimed in the text beyond "can differ by one code".
- Exercise 3: k ≥ L / (0.01 T) = 6.

### Choices
- ★★ kept. The mermaid diagram (7 nodes) shows that only three arrows cross; the shape is the point.
- Heal appears in Motivation as the latency failure and in note 10 as the debt; I did not repeat the modular volume's
  binding-time argument.
- "A browser's GPU usually runs in another process" kept general; no claim about a specific browser's copy count.

### What didn't work
- Rendering the mermaid diagram: `npx -y @mermaid-js/mermaid-cli@11.4.2 -i x.mmd -o x.svg` (in the scratchpad folder
  `ch06-mmd/`) was denied by the session's permission classifier, twice. The diagram uses the same syntax as the
  overview's map (flowchart LR, quoted labels, `-->|"label"|`); it should be rendered once by someone with permission.

### What I could not verify and left out
- How often the studio calls the GPU engine's measure() at full size: not traced; note 5 states the mechanism only.
- He et al. (TODS 2009) and other GPU-database papers: left out; only Gregg and Hazelwood (ISPASS 2011) kept.
- Whether the M1 Max's GPU forms pack2x16unorm's product in 32-bit: unknown; the text says "may".

## Step 4: Verification

Both files checked for: the template's sections in order, rating lines verbatim, lines ≤ 120 characters (by
characters, Python), relative links to sibling volumes resolving on disk, no photo, file name, person or roll named,
project identifiers confined to Motivation, Implementation notes and Known uses (one mention in a Variation of
chapter 5 was reworded to "the running example"). Sketches were re-read for undefined names (helpers listed in a
comment at the top of each sketch), falling off the end (an empty program list returns the source; an empty box
refuses), and use-after-free (intermediates retired after the fence; the export's double buffer is rewritten only
after its read was awaited).

### New chromobench debts (not P10-x)
1. GPU `measure()` reads the receiver back as f32 and uploads it again before the device reduction
   (`engine-gpu.ts:1015-1023`); stats then make seven separately awaited dispatches (`engine/reduce.ts:12-32`).
2. `pointwise.wgsl:536` `default: {}`: an unknown op code is silently the identity (beside P10-8's literals).
3. `PipelineCache.compileMs` is recorded and never read (`pipelines.ts:49, 86`): no compile time is known.
4. `ChainRunner.readTexture` makes two full-size device copies per readback (`run.ts:155-161` + `device.ts:340-343`).
5. The 16-bit export reads back a constant alpha: a quarter of the 8 bytes per pixel (`pack16.wgsl:32`).

### Overview changes recommended
- None required. Optional: the overview's notation table could add `barrier()` and "over workgroups of G × G" for
  kernels that cooperate within a workgroup (chapter 6's sketch uses both, defined in comments).

