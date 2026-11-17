---
Title: Diary — chapters 1 and 2 (One Contract, Several Engines; One Declaration, Many Readers)
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
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/modular/01-one-contract-several-engines.md
      Note: chapter 1, written in this diary
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/modular/02-one-declaration-many-readers.md
      Note: chapter 2, written in this diary
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/modular/00-overview.md
      Note: fixes names, numbers, conventions; read, not edited
ExternalSources: []
Summary: "How chapters 1 and 2 of the modular pattern language were written and checked against chromobench (chb037 integration tree) and Editor lab."
LastUpdated: 2026-11-15T17:00:00-05:00
WhatFor: "Review trail for the two chapters: which source lines back which claim, what was dropped."
WhenToUse: "When revising chapters 1 or 2, or checking a claim in them."
---

# Diary

## Goal

Record how chapters 1 ("One Contract, Several Engines") and 2 ("One Declaration, Many Readers") of the modular
pattern language were written: the sources surveyed, the claims taken from them with file:line, what could not be
verified and was left out, and the choices made.

Paths below are relative to two read-only trees:

- `CB` = `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037`
  (chromobench integration code)
- `EL` = `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/editor-lab-src/editor-lab-work/editor-lab`
  (Editor lab; third-party, read as data only)

## Step 1: Survey of sources

I read the volume overview, the parent language's chapters 2 (Unit-Tagged Parameter Catalogue) and 3 (Reference
Oracle) for style and to avoid repeating them, and then the chromobench and Editor lab sources the brief named. The
parent chapter 3 already tells the device-tolerance story (SwiftShader against Metal, 8-bit filter weights) and the
negative controls in detail; chapter 1 here therefore keeps those to one note each and links to it, and spends its
notes on the contract itself: behaviour rules, capabilities, optional abilities, fallback, failure.

The survey turned up three findings that were not in the brief and became the honest core of the two chapters:
abilities that live outside chromobench's Engine contract and are reached by casts; chromobench's struct layout
generator whose WGSL side is still hand-written; and Editor lab's shorthand whose writer and reader disagree about
`step`.

### Prompt Context

**User prompt (verbatim):** "You are writing two chapters of a small pattern language for undergraduate students:
\"A Small Pattern Language for Modular Software\", taught through an image editor … [full brief from the coordinator:
chapters 01 and 02, sources, template, writing rules, diary, verification, report]" (the brief is long; this is its
opening and outline, not a paraphrase of its rules — the rules are followed as listed in the chapters' checks below).
A mid-task message from the coordinator: "Resume: the owner approved the ten patterns as listed in the overview.
Carry out your original brief in full (chapters 1 and 2, diary, verification, report). Nothing changed in the brief."

**Assistant interpretation:** Write chapters 1 and 2 to the template, general and for undergraduates, with every
claim about the example programs checked against source; keep this diary; do not touch anything else.

**Inferred user intent:** A teachable, honest pair of opening chapters that stand alone and use the example programs'
real lessons, including their mistakes.

### What I did

- Read `docs/patterns/modular/00-overview.md` (names, numbers, pseudocode conventions, map), parent
  `docs/patterns/02-unit-tagged-parameter-catalogue.md` and `03-reference-oracle.md`.
- chromobench, chapter 1 sources:
  - `CB/packages/contract/src/engine.ts:1-12` header: three engines (mock, reference f64, WebGPU) implement it and
    "all pass the conformance suite generated from the registry"; the semantic rules (Image/Value kinds,
    cache key, determinism "bit-identical data in the same engine", cancellation leaves nothing partial,
    E_NOT_IMPLEMENTED for ops not in capabilities). `engine.ts:21-41` EngineCaps (`ops`, `available`, `why`,
    `adapter.fallback`, limits). `engine.ts:130-142` interface; `plan?()` optional at :140.
  - `CB/packages/engine-mock/src/engine-mock.ts:1-3` "trivial, deterministic f64 maths"; 182 + 792 lines (ops.ts).
  - `CB/packages/core/src/engine-ref.ts:1-4` "Slow but exact"; modes 'exact' and 'tabulated' (:24-28, "the reference
    the GPU preview path is compared with").
  - `CB/packages/gpu/src/engine-gpu.ts:203-210` capabilities from the device; :213-238 device loss: drop GPU state,
    recreate on next call; :240-251 `E_DEVICE_LOST` "retry: the engine recreates the device". `device.ts:321` same
    code at the runtime. 1,061 lines.
  - `CB/packages/gpu/src/engine/defs.ts:9-22` GPU_OPS; `engine-gpu.ts:363` E_NOT_IMPLEMENTED with `valid` list.
  - `CB/packages/conformance/src/generate.ts:1-2` "a new op is tested the moment it is registered"; :12-16 fifteen
    case kinds; `run.ts` runCases/runConformance; `mutants.ts:1-2` "Each must fail the listed case kind; otherwise
    the suite cannot catch that class of bug", five mutants (:37-75).
  - `CB/packages/engine-mock/test/conformance.test.ts:6,17-25` mock conformance; each mutant test first requires the
    clean engine to pass the same filtered cases, then requires a failure. `CB/packages/core/test/engine-ref.test.ts:11`
    reference conformance. `CB/packages/gpu/test/browser/spatial.spec.ts:90-95` GPU conformance, `total > 100`,
    via `parity/page.ts:213-235` (fresh engine per case, shared device).
  - `CB/packages/gpu/test/browser/chain.spec.ts:22-35`: preview within 0.1 level of core tabulated; against exact up
    to 1.6 levels, which is table error; :58-61 broken variant without half-texel mapping must exceed 1 level.
  - `CB/packages/gpu/test/browser/output.spec.ts:15-30`: per-device bounds (software adapter vs hardware; M1 Max
    Metal measured 3.0e-5 at most, "Bounds 1.5× that"; written reason).
  - `CB/packages/output/src/export/run.ts:1-4, 61-65, 74-75`: export is engine-agnostic, uses `plan()` when present
    and duck-types `evaluateU16` (not in the contract).
  - `CB/apps/studio/src/host/engines.ts:1-10, 112-113, 205-245`: GPU when WebGPU works, else the reference engine in
    a worker, else on the main thread; working image 4000 px (GPU) against 640 px (reference); :256 and :259 casts
    for `forgetSource` and `openDecoded` (not in the contract).
  - `CB/apps/studio/src/host/studio-engine.ts:56-62`: ANALYSIS_LONG = 640; the metered exposure depended on image
    resolution, so every engine now meters an image of the same size. (The comment names a test photo; the chapter
    does not.)
  - `CB/apps/studio/src/host/engine-serve.ts:40-98`: TabulatedPreviews, an Engine that routes previews to a tabulated
    RefEngine and exports to an exact one.
  - `CB/packages/studio-kit/demo/main.ts:101`: studio-kit demo runs on MockEngine; `tools/gen-docs/main.ts:125-128`
    gen-docs uses MockEngine.
- chromobench, chapter 2 sources:
  - `CB/packages/gpu/src/layout.ts:1-4` (one struct description → offsets, packer, WGSL declaration; "the Studio
    packed its 112-byte SOLVE uniform by hand"), :21-43 alignment rules, :59 missing fields are zero, :64-100
    defineStruct, :91 unknown field refused, :116 and :133 overlong arrays refused.
  - `CB/packages/gpu/test/runtime.test.ts:40-72`: SPECTRAL 80 bytes; struct S offsets v 16, b 28, w 32, s 80, size
    112; `wgsl()` only asserted here (`grep -rn "\.wgsl()"` finds no other caller); rowMajor deliberate bug.
  - `CB/packages/gpu/src/tables/build-gpu.ts:17-21` SOLVE_PARAMS (48+16+16+16+16 = 112 bytes, computed by hand from
    the rules above).
  - `CB/packages/gpu/kernels/solve.wgsl:19-28`, `spectral.wgsl:15-22`, `pointwise.wgsl:58-` hand-written `struct`
    declarations duplicating the TypeScript descriptions; `pointwise.wgsl:59` literal `12` for MAXOPS
    (`program.ts:20`); `pointwise.wgsl:395-535` op codes as literal `case 1u:` … `case 30u:` mirroring
    `program.ts:8-19`.
  - `CB/packages/gpu/src/chain/wgsl-link.ts:13-21` GENERATED_WGSL: core's matrices as WGSL constants, "one definition
    for both engines"; `tools/wgsl-check/check.spec.ts:1-8` compiles every kernel as the engine links it, but does not
    compare struct declarations with layout.ts.
  - `CB/packages/gpu/src/pipelines.ts:16-32`: pipeline cache keyed by hash of code, entry point, constants, layout.
    (Not used in the chapter: it is a cache key, chapter 9's subject.)
  - `CB/packages/contract/src/registry.ts:164-238` registerOp validates the declaration: numeric argument needs a unit
    (:208), unknown unit (:209), min > max (:210), usual outside [min, max] (:211-213), default violating its own spec
    (:215-221), examples that do not parse (:233-236).
  - `CB/packages/contract/src/spec.ts:43-73` ArgSpec with a separate `ui` block; `catalog/adjust.ts:40-50` exposure
    declaration (stops −6..6, usual −3..3, ui step 1/30, detents [0]).
  - `CB/tools/gen-docs/main.ts:1-5, 116-150`: generates op-args.ts, catalog.snapshot.json, 13 area docs, plus DSL (4
    files, `dsl.ts`) and agent/bridge texts (7 files, `agent.ts`): 26 files; `--check` reports "out of date" and exits
    1; :125-128 the docs' implementation list is filled from MockEngine only. `docs/reference/ops/capture.md:12` shows
    "Implementation: mock".
  - `CB/packages/contract/src/generated/op-args.ts:1-2` "GENERATED … Do not edit; run `pnpm gen`"; 72 Args interfaces;
    snapshot has 72 ops, contract 1.4.0.
  - `CB/package.json:15-17` gen, gen:check, contract:check; `CB/.github/workflows/ci.yml:18-20` runs both.
  - `CB/tools/gen-docs/contract-check.ts:1-4` classifies snapshot differences as breaking or not.
  - `CB/tools/gen-docs/agent.ts:1-2` texts the Go bridge embeds (go:embed cannot reach outside the Go module).
  - `CB/packages/studio-kit/src/model/controls.ts:1-5` ControlModel per path from ArgSpec `ui`.
  - `CB/playwright.config.ts:10-12` REAL_GPU drops the SwiftShader flags; `CB/packages/gpu/playwright.config.ts:3,19`
    the GPU package's own config still hard-codes SwiftShader with no REAL_GPU switch (a second copy of the fact).
- Editor lab (read as data only):
  - `EL/src/engine.js:186-190` P, PCT, COLOR, CHOICE spec makers (step derived from range when not given);
    `:212-296` KINDS; `:298` defaults; `:306-313` specFrom; `:309` reads an array setting as `[min, max, value, label, unit]` (no step);
    `:338` specsOf.
  - `EL/src/views/code.js:77` documents `[min, max, value, label?, unit?, step?]`; `:93-100` paramLit writes the step
    as a sixth element. Writer and reader disagree: step is lost on a round trip.
  - `EL/src/controls.js:62-63` slider from spec min/max/step; `EL/src/views/agent.js:24` `kinds()` reads KINDS.
  - `EL/src/views/gpu.js:21-46` WGSL_KIND: a second, hand-written copy of each pointwise kind's maths; `:87` plan
    gives each skipped layer a reason ('masked', 'reads neighbours', 'no WGSL yet', …); `:184` the probe's uniform
    packed by hand with two writes; `:199-201` 8-bit comparison.
  - `EL/test/gpu.js:9-16` prints the probe report and checks that every WGSL kind compiles; it asserts no tolerance.
  - `EL/src/book/08.md:75` WebAssembly within 0.0004 of a step; `:121` 79 ms compile per parameter change; `:221`
    fused probe 0.33 of a step, "a test fails when the GPU differs … by more than a stated tolerance"; `:234-250`
    Table 8.3 ("The reference for every kernel | JavaScript"); `:258-269` "Toward a reusable API" (executor.kinds,
    parity, lost). `EL/src/book/09.md:106-110` §9.6 executors; `:17` Table 9.1 tolerance 0.5 of an 8-bit step.

### Why

- The brief asks for real lessons named plainly; the survey had to find them in code, not in the parent chapters.

### What worked

- Grepping for callers settled two claims quickly: `wgsl()` has no caller outside a test; `runConformance` is called
  for mock and reference, and the GPU runs the same generator in the browser.

### What didn't work

- `grep … --include=*.ts` without quotes failed in zsh: `(eval):1: no matches found: --include=*.ts`. Quoted the
  glob (`--include='*.ts'`).

### What I learned

- chromobench's reference engine is not only a test oracle: the studio ships it as the fallback when WebGPU is
  missing. That changes what "slow" may mean (it must still be usable), and it is why its working image is 640 px.

### What was tricky to build

- Not duplicating parent chapter 3. Its device-tolerance and negative-control material is the best-known lesson of
  the project; chapter 1 cites it in one note each and links.

### What warrants a second pair of eyes

- The 112-byte hand-packed uniform of "the Studio" is taken from the comment at `CB/packages/gpu/src/layout.ts:3-4`;
  the earlier program's `gpu.js` is not in the trees I was given, so I could not read lines 3584–3595 myself. The
  current SOLVE_PARAMS is 112 bytes by the alignment rules, which is consistent.

### What should be done in the future

- N/A for this step.

### Code review instructions

- Spot-check any `file:line` above against `CB` and `EL`.

### Technical details

- Struct S of `runtime.test.ts:48` under uniform rules: a f32 @0; v vec3f align 16 @16 size 12; b f32 @28; w
  array<vec4f,3> @32 stride 16 → 80; s array<f32,2> element align rounded to 16, stride 16 @80 → 112; struct align 16
  → size 112.

## Step 2: Drafting chapter 1 (One Contract, Several Engines)

I wrote the chapter to the template with a generic motivation (the editor renders on the GPU; four failures: a wrong
answer that looks right, the fast path disappearing, engines agreeing on numbers and not behaviour, callers learning
engine identity) and three other domains (in-memory fake of a database, reference and tuned matrix multiply,
interpreter and compiler). The notes carry chromobench's and Editor lab's real lessons. The first draft was 3,104
words; I cut it to 2,797 (2,565 outside code blocks) by tightening notes, forces, exercises and dropping one
variation (the proxied/remote engine survives as a GoF Proxy mention).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Chapter 1 to the template, 1,800–2,800 words, portable, honest about debts.

**Inferred user intent:** A chapter students can apply to any program with a fast and a simple implementation.

### What I did

- Wrote `/Users/manuel/code/wesen/chromobench/docs/patterns/modular/01-one-contract-several-engines.md`.
- Claims in the notes and their sources:
  - note 1 behaviour rules: `CB/packages/contract/src/engine.ts:5-12`; error codes declared in the contract:
    `CB/packages/contract/src/errors.ts:50,53,63`.
  - note 2 generated suite, fifteen kinds, three engines: `CB/packages/conformance/src/generate.ts:1-2,12-16`;
    `CB/packages/engine-mock/test/conformance.test.ts:6`; `CB/packages/core/test/engine-ref.test.ts:11`;
    `CB/packages/gpu/test/browser/spatial.spec.ts:90-95`.
  - note 3 "slow but exact": `CB/packages/core/src/engine-ref.ts:1-2`; "The reference for every kernel |
    JavaScript": `EL/src/book/08.md` Table 8.3 (lines 234-250).
  - note 4 1.6 levels against exact, < 0.1 against tabulated: `CB/packages/gpu/test/browser/chain.spec.ts:22-35`.
  - note 5 five mutants, clean-first protocol: `CB/packages/conformance/src/mutants.ts:37-75`;
    `CB/packages/engine-mock/test/conformance.test.ts:17-25`. Editor lab prints, does not assert:
    `EL/test/gpu.js:9-16`; 0.33 of a step: `EL/src/book/08.md:221`.
  - note 6 capabilities and reasons: `CB/packages/contract/src/engine.ts:21-41`; `EL/src/views/gpu.js:87`.
  - note 7 optional abilities outside the contract: `engine.ts:140` (`plan?`), `CB/packages/output/src/export/run.ts:61-65,75`,
    `CB/apps/studio/src/host/engines.ts:256,259`.
  - note 8 fallback on 640 px vs 4,000 px and same-size metering: `engines.ts:1-5,112-113,205-245`;
    `CB/apps/studio/src/host/studio-engine.ts:56-62`.
  - note 9 device loss: `CB/packages/gpu/src/engine-gpu.ts:213-251`.
  - note 10 mock engine: `CB/packages/engine-mock/src/engine-mock.ts:1`; demo `CB/packages/studio-kit/demo/main.ts:101`;
    mutants wrap MockEngine (conformance.test.ts:23).
  - Variation "router engine": `CB/apps/studio/src/host/engine-serve.ts:40-98` (TabulatedPreviews), described
    generically because Variations must be portable.

### Why

- Parent chapter 3 already covers per-device tolerances and negative controls; this chapter is about the contract,
  so its distinctive notes are 1, 6, 7, 8 and 9.

### What worked

- The studio host (`engines.ts`) gave the strongest new lesson: the reference is also the shipped fallback, and that
  forced "same inputs" into the contract (note 8).

### What didn't work

- First draft over length (3,104 words); cut by about 300.

### What I learned

- The determinism rule in chromobench's contract is explicitly "in the same engine"; across engines only tolerance
  applies. Stating both halves became note 1.

### What was tricky to build

- Portability: Variations first named chromobench's router engine; rewritten generically. Project names now appear
  only in Motivation, Implementation notes and Known uses (checked by an awk scan per section).
- Privacy: `studio-engine.ts:58` names a test photo in a comment; the chapter gives neither the name nor the
  measured difference, only that metering depended on image size.

### What warrants a second pair of eyes

- Known uses I am confident of but did not re-read today: PEP 399 (pure-Python and C modules pass the same tests),
  Netlib reference BLAS, TensorFlow Lite reference kernels, the WebAssembly reference interpreter, sqllogictest,
  SwiftShader and llvmpipe, Csmith ("hundreds of bugs", Yang et al., PLDI 2011). I removed one claim during drafting:
  that OpenBLAS and MKL are "tested against" the reference BLAS (true for some test suites, not something I can
  state for both).

### What should be done in the future

- N/A

### Code review instructions

- Read the chapter's notes beside the sources listed above.

### Technical details

- Word count: `wc -w` 2,797; outside code fences 2,565.

## Step 3: Drafting chapter 2 (One Declaration, Many Readers)

The motivation uses the exposure parameter (`stops`, −6 to 6, default 0: `CB/packages/contract/src/catalog/adjust.ts:45`)
and its seven readers, then four failures, each real: a hand-packed uniform (chromobench's predecessor, per the
comment in `layout.ts`), Editor lab's step lost on a round trip, chromobench's two Playwright configurations where
only one learned `REAL_GPU`, and the operation numbers written in two languages. The sketch declares a small struct
whose offsets (0, 4, 16, 28, 32; size 80) show the three-vector tail rule, and an operation with meaning and `ui`
apart.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Chapter 2 to the template; generic pattern; the example programs' lessons in notes.

**Inferred user intent:** Students learn to spot a fact written twice and to make one copy the declaration.

### What I did

- Wrote `/Users/manuel/code/wesen/chromobench/docs/patterns/modular/02-one-declaration-many-readers.md`.
- Claims and sources:
  - Motivation 1: `CB/packages/gpu/src/layout.ts:1-4`. Motivation 2: `EL/src/views/code.js:77,93-100` (writer emits
    step as a sixth element), `EL/src/engine.js:309` (reader destructures five). Motivation 3:
    `CB/playwright.config.ts:10-12` against `CB/packages/gpu/playwright.config.ts:19`. Motivation 4:
    `CB/packages/gpu/src/chain/program.ts:8-19` (`EXPOSURE: 19`) and `CB/packages/gpu/kernels/pointwise.wgsl:483`
    (`case 19u:`).
  - note 1: `layout.ts:21-43,64-100`; `CB/packages/gpu/test/runtime.test.ts:47-57`.
  - note 2: hand-written structs `solve.wgsl:19`, `spectral.wgsl:15`, `pointwise.wgsl:58`; `wgsl()` only in
    `runtime.test.ts:56`; MAXOPS `program.ts:20` vs `pointwise.wgsl:59`; generated constants
    `CB/packages/gpu/src/chain/wgsl-link.ts:13-21`.
  - note 3: `layout.ts:59,91,116,133`.
  - note 4: `CB/packages/contract/src/registry.ts:206-236`.
  - note 5: `CB/packages/contract/src/generated/op-args.ts:1`; `CB/tools/gen-docs/main.ts:116-150`, `dsl.ts`,
    `agent.ts` (26 files = 2 + 13 + 4 + 7); 72 operations (snapshot `ops` has 72 keys; 72 `…Args` interfaces);
    `CB/.github/workflows/ci.yml:3-4,18-19`.
  - note 6: as Motivation 2.
  - note 7: `main.ts:125-128`; `CB/docs/reference/ops/capture.md:12` "Implementation: mock" while `capture.expose`
    is in GPU_OPS (`CB/packages/gpu/src/engine/defs.ts:21`).
  - note 8: `CB/packages/contract/src/spec.ts:43-73`; `adjust.ts:45-46`; `CB/packages/studio-kit/src/model/controls.ts:1-5`.
  - note 9: `CB/tools/gen-docs/snapshot.ts:1-2`; `contract-check.ts:1-4`; CI `ci.yml:20`.
  - note 10: `EL/src/engine.js:212-286` (KINDS with `fn`), `EL/src/views/gpu.js:20-41` (WGSL_KIND), `:87`;
    `EL/test/gpu.js:13-16` (compile-only check of every template).
  - Variation "interpret at run time": Editor lab's `defaults` (`engine.js:298`), controls (`controls.js:62-63`),
    `kinds()` (`agent.js:24`); written generically.

### Why

- Note 2 is the most useful lesson for students: the tool to stop drift existed and was only half used.

### What worked

- The test struct in `runtime.test.ts:48` doubles as exercise 3, with the answer pinned by real tests.

### What didn't work

- The first sketch reused chromobench's `SolveParams` (field names K, Dbase); too project-specific for a portable
  sketch, and its usage line passed `stops` to a packer whose struct had no such field. Replaced with a generic
  `ExposureParams` and `{ gain: 2 ^ args.stops }`.

### What I learned

- Editor lab's spec maker derives the slider step from the range when none is given (`engine.js:187`): a
  presentation choice computed from meaning. Fine at its size; not used in the chapter beyond note 8's principle.

### What was tricky to build

- "Know where to stop" (note 10): the pattern's limit had to be stated with a real case. Editor lab's two copies of
  each kind's maths are the case: generating GPU code from a description of maths is a compiler, and the guard there
  is Chapter 1's parity test.

### What warrants a second pair of eyes

- Known uses: Protocol Buffers, OpenAPI Generator, LLVM TableGen, SPIRV-Reflect and SPIRV-Cross reflection, Django
  models (migrations, admin, model forms), C X macros, CORBA IDL and MIDL. I left out Figma's GLSL-to-WGSL
  translation (it appears in Editor lab's book, a third-party source, and I could not check it).

### What should be done in the future

- N/A

### Code review instructions

- Read note 2 beside `layout.ts` and `pointwise.wgsl:58-75` to see the duplicated struct.

### Technical details

- Sketch struct under uniform rules: gain f32 @0; offset f32 @4; tint vec3 align 16 @16 (12 bytes); mode u32 @28;
  matrix mat3 align 16 @32 (48 bytes) → 80; struct align 16 → 80.
- Word count: `wc -w` 2,772; outside code fences 2,504.

## Step 4: Verification

I checked every chromobench and Editor lab claim against source (Steps 1–3 list file:line), the links, the mermaid
syntax, portability, privacy and length.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Verify before reporting.

**Inferred user intent:** No claim in the chapters that a reader could disprove from the code.

### What I did

- Links: every relative link in both chapters resolves (`../03-reference-oracle.md`,
  `../02-unit-tagged-parameter-catalogue.md`, and siblings 01–05, 07, 08, 10, which other authors had written by
  then). Checked with a shell loop over `](…md)` targets.
- Sibling consistency: chapters 3, 4, 5, 7, 9 and 10 link to chapters 1 and 2 with descriptions that match what these
  chapters say (grep of `01-one-contract`/`02-one-declaration`).
- Mermaid: checked by eye (flowchart LR; `{{…}}` hexagon, `{…}` rhombus, `---` and `-->` links; 9 nodes in each). I
  did not run mermaid-cli: it was not installed or cached, and it downloads and runs a headless browser, which the
  brief rules out.
- Portability: an awk scan prints the section of every line naming chromobench, Editor lab, WebGPU, WGSL, SwiftShader
  or Metal; all are in Motivation, Implementation notes or Known uses.
- Privacy: no photo, file name of a photo or person is mentioned (grep for DSC, photo, family: none).
- Arithmetic: struct offsets in chapter 2's sketch, note 1 and exercise 3 recomputed by hand from `layout.ts:21-43`.

### Why

- The brief requires it, and the chapters make several precise numerical claims.

### What worked

- All source claims held; three line citations in the diary were wrong on first writing (Editor lab `specFrom`,
  the probe's uniform write, the 8-bit comparison) and were corrected.

### What didn't work

- `npx -y @mermaid-js/mermaid-cli` not attempted (see above).

### What I learned

- N/A

### What was tricky to build

- N/A

### What warrants a second pair of eyes

- The 112-byte hand-packed uniform of "the Studio" (chapter 2, Motivation 1) rests on the comment in
  `CB/packages/gpu/src/layout.ts:3-4`; the earlier program is not in the trees I had.

### What should be done in the future

- Overview: no change needed. Optional: its "All of them in one sketch" says the GPU uniform layout is "generated
  from" the exposure declaration; in chromobench the uniform layout is a separate struct declaration, not derived
  from the operation registry. As a sketch of the pattern it is fine.

### Code review instructions

- `wc -w docs/patterns/modular/0[12]-*.md`; follow any file:line in Steps 1–3.

### Technical details

- Final counts: chapter 1 2,797 words (2,565 outside code); chapter 2 2,772 (2,504 outside code).

## Step 5: Revision after review

A fresh reader, playing a second-year student with no image or GPU background, reviewed chapters 3 and 8. The
coordinator passed on its general lessons, and I applied them to chapters 1 and 2. Every lesson from the earlier draft
is kept, but there is less project history, every image or GPU term is glossed or cut, each sketch defines the
names it uses, and each chapter has an exercise that makes the student write the check the pattern relies on.

### Prompt Context

**User prompt (verbatim):** "Revision round. A fresh reader (playing a second-year CS student with no image/GPU
knowledge) reviewed chapters 3 and 8 of this volume. Its findings generalise; apply the lessons below to your
chapters 1 and 2. Edit only your two chapters and your diary (add a \"Revision after review\" step). Do not commit.
Report what changed and word counts before/after." (followed by the list of general lessons: cut project history,
gloss terms, consistent units, general Solution, sketch completeness, precise mathematical vocabulary, a non-image
mapping of participants, concrete exercises including a check-writing one)

**Assistant interpretation:** Revise both chapters against that checklist without losing lessons or verified facts.

**Inferred user intent:** Chapters a student outside graphics can read and use.

### What I did

- Word counts (`wc -w`, whole file): chapter 1 2,797 → 2,806; chapter 2 2,772 → 2,800. Outside code blocks:
  chapter 1 2,565 → about 2,380; chapter 2 2,504 → about 2,450. Implementation notes, with the closing habitability
  paragraph: chapter 1 694 → 584 (−16 %); chapter 2 682 → 574 (−16 %).
- Chapter 1:
  - Motivation: WebGPU glossed; second bug in item 3 (ignored region) removed; "export code" glossed.
  - Forces: GPU-specific wording made general ("split a large job into pieces"; "a fast engine can fail
    mid-session").
  - Solution: "names its unit and device" → "names its unit and the machine it was measured on".
  - Applicability: "properties: identities, symmetries" replaced by a correct example ("sorting twice changes
    nothing"), avoiding a loose use of "identity".
  - Structure: added a line naming the participants in a web service.
  - Sketch rewritten: `Request`, `Result`, `Caps` defined; rules written as named rules, each a conformance case;
    `caseFor`, `delegate`, `Mutant` defined; mutant concretely built (ignores region); parity compares `.pixels` and
    passes `cancel: never`; `chooseEngine` disposes an unavailable engine and refuses when none can run (hole: the old
    version leaked the engine and fell off the end); `parity(...)` called with a stated tolerance in levels.
  - Notes: merged the generated-suite note into note 1; removed adapter/software-fallback detail, the five-mutant
    inventory, the "worker" and the error hint; glossed level, preview, "masked", WGSL; every number now says why it
    matters (1.6 levels accepted for speed vs < 0.1 below visibility; 1e-12 invisible but breaks bit-identity; 640 vs
    4,000 px keeps the slow engine responsive).
  - Exercises: new exercise 1 (exact `math.fsum` reference vs left-to-right sum, parity test with a justified
    tolerance, a broken engine that drops the last element and must fail); the key-value exercise made concrete
    (sorted list vs hash map); the exercise that needed chromobench (the leaking ability) dropped.
  - Trimmed to stay near 2,800: dropped BLAS from Known uses, the Chapter 5 related line, the router detail.
- Chapter 2:
  - Motivation: glossed stops, uniform; cut project history (the predecessor's 112-byte hand-packed uniform) and the
    second-project bug about two Playwright configurations (platform trivia); replaced it with the scenario's own
    failure (documentation describing last month's range). Item 4 glosses operation numbers instead of "opcodes".
  - Structure: added the web-service mapping.
  - Sketch: types glossed (f32, u32, vec3); struct shrunk to four fields (offsets 0, 4, 16, 28; size 32, recomputed
    by hand from `layout.ts:21-43`); `ops` and `artifacts` defined; `detents` glossed; the checker's range test written
    out; packer refuses missing fields (closing the zero-fill hole the old sketch fell into, since it packed only
    `gain`); validation result matched before use; `parseGpuStruct` and `agreement` defined; `show`/`upload` named.
  - Notes: removed file inventories and the Go-embedding detail; glossed GPU terms; note 2 says "the most operations
    one GPU pass may run (12)" instead of MAXOPS; note 9 says "a baseline", which is what `contract-check.ts:1-4`
    compares against (main's snapshot or the newest released one), not "the last release".
  - Exercises: exercise 1 now has the student write the freshness check and break it by hand-editing a generated
    file; exercise 3 gives the answer and asks for the agreement test, with no project names (Exercises must be
    portable).

### Why

- The reviewer's lessons apply directly: both chapters had project history and unglossed GPU terms, and both
  sketches used undefined names. The chapter 2 sketch also had a real hole.

### What worked

- A section-replacement helper in the scratchpad (`rev/secrep.py`) made whole-section rewrites safe (it asserts that
  every old string is present).

### What didn't work

- The first revision of chapter 1 grew to 3,063 words because the fuller sketch and the new exercise added text. I
  cut Known uses, Related chapters, Variations and Consequences to get back to 2,806.

### What I learned

- The old chapter 2 sketch demonstrated the very trap its note 3 warns about (packing a struct with missing fields).

### What was tricky to build

- Keeping every lesson while cutting 16 % of note prose: merged notes 1 and 2 of chapter 1, and pointed chapter 2's
  note 6 back to the Motivation instead of repeating the Editor lab detail.

### What warrants a second pair of eyes

- Both files are at about 2,800 words counted with code blocks and tables. Without the code they are about 2,400.

### What should be done in the future

- N/A

### Code review instructions

- Compare each chapter's Sketch with the definitions above; check the offsets 0, 4, 16, 28 / 32 by the rules in
  `CB/packages/gpu/src/layout.ts:21-43`.

### Technical details

- Links unchanged except that chapter 1 no longer links chapter 5; all remaining relative links resolve. Mermaid
  diagrams unchanged. A scan confirms project names now appear only in Motivation and Implementation notes.
