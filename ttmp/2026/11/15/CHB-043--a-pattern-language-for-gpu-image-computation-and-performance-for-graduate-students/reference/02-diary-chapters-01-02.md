---
Title: Diary — chapters 1 and 2 (Encode Where the Operator Is Linear; Precision Ladder)
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
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/01-encode-where-the-operator-is-linear.md
      Note: chapter 1, written in this diary's Step 2
    - Path: /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/02-precision-ladder.md
      Note: chapter 2, written in this diary's Step 3
ExternalSources: []
Summary: "Review trail for GPU-volume chapters 1 and 2: every claim about the example programs with its file:line."
LastUpdated: 2026-11-15T18:00:00-05:00
WhatFor: "Checking the chapters' claims against the sources; continuing or revising the chapters."
WhenToUse: "When reviewing chapters 1 or 2, or when a cited source changes."
---

# Diary

## Goal

Record how chapters 1 ("Encode Where the Operator Is Linear") and 2 ("Precision Ladder") of *Fast and Checkable* were
written: the sources read, each claim about chromobench and Editor lab with its file:line, my own arithmetic and
measurements (marked), what I could not verify and removed, and the choices made.

Abbreviations used below:

- `CB` = `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037`
  (chromobench integration worktree, read only)
- `EL` = `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/editor-lab-src/editor-lab-work/editor-lab`
  (Editor lab, third-party, read as data only)
- `D035` = CHB-035 design `01-digital-editing-in-chromobench.md` on branch `task/chb-035-digital-editing-design`,
  read with `git show` (line numbers as printed by `git show … | grep -n`)
- `T037` = `CB/ttmp/2026/11/14/CHB-037--unified-editing-model-…`; `T041` = `CB/ttmp/2026/11/15/CHB-041--gpu-memory-…`

## Step 1: Sources

I read the shared brief, the volume overview, the five sibling chapters named in my brief, and the CHB-042 diaries as
leads; then I verified every fact I meant to use in the chromobench and Editor lab sources. The sibling chapters
already cover the binding-time split (modular ch. 5), the slot's input form and premultiplied `over` (modular ch. 4),
domains (image ch. 5), tables (image ch. 6) and tolerances with negative controls (image ch. 3). My chapters had to go
deeper: conditioning of conversions, error bounds of reductions, error budgets split into shares, storage precision
measured at the output.

### Prompt Context

**User prompt (verbatim):** "Write chapters 1 and 2 of "Fast and Checkable: GPU Image Computation Patterns" (graduate
students). First read the shared brief in full and follow it exactly:
/Users/manuel/code/wesen/chromobench/ttmp/2026/11/15/CHB-043--a-pattern-language-for-gpu-image-computation-and-performance-for-graduate-students/playbooks/01-writer-brief.md

YOUR CHAPTERS
- /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/01-encode-where-the-operator-is-linear.md — "Encode Where the
Operator Is Linear" ★★: run each operation in the representation where its mathematics is simple. Scope: linear light
for blending and exposure (a gain is a multiply); log/density encodings for film and scans where gains become offsets
and a seam correction is additive (chromobench heal: harmonic in the log encoding — gain in print-xyz, offset in
scanner density); perceptual spaces (OkLab/OkLCh) for chroma and hue operations and the gamut knee as the last colour
operation; premultiplied alpha for compositing (over is linear in premultiplied colour); the cost of conversions and
where to place them (convert once at boundaries; domain-typed values). Lessons to look for: linear-light multiply
making the blend stack darker; OkLCh modes skipping W3C ClipColor (P10-9); the Editor lab's sRGB lookup tables; gamut
knee "last colour op: a gain after it leaves the cube again". Known uses to consider: Porter & Duff 1984; homomorphic
filtering (Oppenheim, Schafer & Stockham 1968); log-sum-exp; Ottosson's OkLab (2020 blog post — say so); linear
workflows in renderers; ACES/OpenColorIO; density in film scanning.
- /Users/manuel/code/wesen/chromobench/docs/patterns/gpu/02-precision-ladder.md — "Precision Ladder" ★★: solve rarely
in wide precision, apply often in narrow precision, store narrower only within a measured budget. Scope (merge of
four ideas): binding times (compute each value at the coarsest point its inputs change — CHB-035 §31 binding times,
stated as the design states them); f64 solve on the host (heal seam coefficients: core healCoefficients, shared by
both engines; film bindings via core *At helpers), f32 apply on the device; reductions finished in wide precision
(gpu measure.ts partials summed pairwise in f64; reduce.wgsl); tabulation as a precision decision with an error budget
(core film/upsample.ts per-film table; reference engine 'tabulated' mode; tables/); f16 storage only within parity
tolerance (CHB-041 measured half-float camMatrix: scene cut moved up to 1.6e-4 vs tolerance 3e-5; display up to
~0.013, ~3 eight-bit levels vs 2e-4 — verify in chb037 ttmp/2026/11/15/CHB-041*/diary/01-diary.md Step 3); parity
tolerances in packages/gpu/src/parity/*.ts. Known uses: Goldberg 1991; Higham 2002; Kahan summation; pairwise
summation (NumPy); mixed-precision training (Micikevicius et al., ICLR 2018); LAPACK mixed-precision iterative
refinement (dsgesv; Langou et al. 2006); GPU texture formats.

SIBLING CHAPTERS TO READ (go deeper, do not repeat):
/Users/manuel/code/wesen/chromobench/docs/patterns/05-domain-typed-pipeline.md, 06-tabulated-preview-exact-export.md,
03-reference-oracle.md; /Users/manuel/code/wesen/chromobench/docs/patterns/modular/04-a-slot-in-the-formula.md and
05-solve-once-apply-many.md.

DIARY FILE: reference/02-diary-chapters-01-02.md in the CHB-043 ticket."

**Assistant interpretation:** Write the two chapters to the brief's template and rules, verify every example-program
claim at file:line, keep this diary, and report.

**Inferred user intent:** Two graduate-level chapters that teach the encoding and precision decisions behind a fast,
checkable GPU pipeline, honest about the example programs' mistakes, with a review trail.

### What I did

- Read `playbooks/01-writer-brief.md`, `docs/patterns/gpu/00-overview.md`, image-volume chapters 03, 05, 06, modular
  chapters 04, 05, and CHB-042 diaries 03 and 04 (leads only).
- Read `~/.codex/skills/diary/SKILL.md`.
- Verified sources (all read only), listed below by chapter.

### Sources for chapter 1 (claim → file:line)

- Heal formula: gain `exp(u)` in a linear encoding, offset in density; harmonic (Poisson integral, Fourier series,
  Lanczos σ) → `CB/packages/core/src/print/retouch.ts:6-21`, `SeamEncoding` :41-42, `healCoefficients` :83-116
  (log of values for 'linear', difference for 'log' at :95).
- GPU heal one kernel with a flag → `CB/packages/gpu/kernels/retouch.wgsl:6, 91`; `CB/packages/gpu/src/retouch.ts:10-13`
  ("harmonic in the domain's log encoding … print-xyz: a gain … scanner-density … an additive offset").
- Ingest dust heal quote "a harmonic density offset (a multiplicative transmittance gain)" →
  `CB/packages/ingest/src/conditioning/dust/heal.ts:1-4`.
- Flat field "the cell mean is of light, not of encoded values" → `CB/packages/ingest/src/conditioning/flat.ts:1-3`.
- Light law (exposures add in H; densities and filters in the exponent; log10 H floored at 1e-8) →
  `CB/packages/contract/src/pixel.ts:5-6, 30-60`; time an exact log offset → `CB/packages/core/src/print/combine.ts:5-8`.
- Film table folded over chromaticity, `raw = b · table(u, v)`, `b = X + Y + Z` → `CB/packages/core/src/film/upsample.ts:4-7`;
  81 samples per spectrum :29.
- Blends: separable per channel in linear RGB, OkLab entries converted to RGB and back; non-separable in OkLCh, no
  Lum/SetLum/ClipColor, "gamut is the output knee's job" → `CB/packages/core/src/composite/blend.ts:1-10, 56-70`;
  overlay threshold 0.5 → :20.
- Knee rule "The knee is the LAST colour operation before encoding: a gain after it leaves the cube again" →
  `CB/packages/core/src/print/gamut.ts:2`; C_max by bisection, hue and lightness kept :3-8.
- Ottosson M2 inverse "rounded to 10 digits: round trips drift by 2e-7" → `gamut.ts:23-24`; white within 4e-8, test
  to 5e-8 → `T037/diary/11-phase-p8a-ops.md:357-359`; random OkLab round trip far outside gamut "ill-conditioned"
  → :360-361.
- Rows of M1s normalised (white → equal cone responses); M2 inverse computed → `CB/packages/core/src/composite/working.ts:4-9, 25-31`;
  `gamut.ts:24`.
- Conversion form `post · f(pre · v)`, f ∈ {identity, cube root, cube} → `working.ts:9-10, 33-46`; GPU opcode
  `OP_ENCODE: u32 = 18u` → `CB/packages/gpu/kernels/pointwise.wgsl:37`.
- Compiler inserts conversions, "A conversion of a conversion converts the original node instead" →
  `CB/packages/contract/src/compile.ts:160-176`; encodings and domains → `CB/packages/contract/src/encodings.ts:1-9`.
- Per-channel curves on the cube root of a linear channel, fuse with exposure and mixer without conversions →
  `T037/diary/11-phase-p8a-ops.md:166-169`.
- Separable blend in OkLab: 1.1e-4 (a third of an 8-bit level), elsewhere 1e-5; bound 3e-4 vs 2e-5 →
  `CB/packages/gpu/test/browser/digital.spec.ts:30-37`; first failure and cause → `T037/diary/11-phase-p8a-ops.md:460-464`.
- Blend stack darkest, display mean 0.25 vs 0.58 → `T037/diary/11-phase-p8a-ops.md:368-370`; no ClipColor, luminosity
  can leave gamut → :381-382; task P10-9 → `T037/tasks.md:36`.
- Knee cost on the CPU reference: ≈ 48 inverse transforms per pixel, 70 % of what was left; allocation-free halved it
  → `T037/diary/14-phase-p3b-engines.md:122-126` (not used in the final text after cuts).
- Design: two working encodings, compiler inserts conversions, Editor lab presets "do not transfer and are re-tuned"
  → `D035:752-758`.
- Editor lab: colour straight inside an operation, premultiplied between → `EL/src/engine.js:3`; sRGB as two
  `Float32Array(4097)` tables, nearest entry → `EL/src/engine.js:7-15`; exposure through them → :233; GPU path uses
  `pow` → `EL/src/views/gpu.js:11-12`.
- Editor lab textbook: "costs more than the rest of the adjustment", sRGB 0.5 = linear 0.214 → `EL/src/book/01.md:9`;
  pyramid averages sRGB, linear pyramid "needs either more bits per channel or the decoding cost on every read" →
  `EL/src/book/05.md:275`; exposure +1 EV: up to 22 steps, 0.5 % of pixels → `EL/src/book/05.md:280-296` (Table 5.3).
  Olive-fringe example of premultiplied filtering → `EL/src/book/01.md:50` (used only as background; the modular
  volume teaches it).

### Sources for chapter 2 (claim → file:line)

- Binding times: four times build, compile, interaction, pixel; "There are no per-pixel lambdas. Every per-pixel
  computation is a catalogue op with a reference (f64) and a GPU implementation, checked for parity."; Decision D6,
  status proposed → `D035:1040-1076`.
- `healCoefficients` f64 in core, GPU calls it on read-back windows → `CB/packages/core/src/print/retouch.ts:1-4, 83`;
  `CB/packages/gpu/src/retouch.ts:10-13, 17, 75`; window margin r + 4 → `retouch.ts (core):53-54`; 22 vec4 per spot
  `CB/packages/gpu/src/retouch.ts:23`; coefficients in an f32 record → `retouch.ts (gpu):89, 219`; 54 numbers =
  2·(M+1)·3 with M = 8 (`retouch.ts (core):47, 100`) — my arithmetic.
- P10-1 (coefficients cached per GPU call only) → `T037/tasks.md:28`.
- Film bindings from core `*At` helpers in both engines → `CB/packages/gpu/src/film.ts:1-5`;
  `CB/packages/core/src/ops/film.ts:1-4, 31-90`.
- Reductions: 16 × 16 workgroups, tree in f32, one 64-byte partial (sum, min, max, count), host sums pairwise in f64,
  "so the f32 error stays near log2(n) roundings" → `CB/packages/gpu/kernels/reduce.wgsl:1-3, 12, 30-53`;
  `CB/packages/gpu/src/measure.ts:1-2, 13-22, 33-41, 64-73`; histogram `atomic<u32>` bins → `reduce.wgsl:13, 19`.
- Knee bisection in f32 on the GPU: SwiftShader 99.85 % within 2e-6, rest to 1.3e-5; Metal 0.34 % beyond 2e-6,
  3.0e-5 at most, 4 codes in 16 bits; bounds 1.5× → `CB/packages/gpu/test/browser/output.spec.ts:16-31`.
- C_max table over (L, h) recorded as future work for the CPU engine's tabulated mode →
  `T037/diary/14-phase-p3b-engines.md:193-196`.
- GPU solve: bounded Levenberg–Marquardt per node → `CB/packages/gpu/kernels/solve.wgsl:1`; "f32 cannot reach the CPU
  gtol of 1e-9; the Studio raises it to at least 1e-6" → `CB/packages/gpu/src/tables/build-gpu.ts:14-15`; 35,937 nodes
  at N = 33 → :1-2.
- Solve table vs f64: 2.38e-6 Metal, 2.62e-6 SwiftShader on the Mac; bound 3e-6; broken variant gtol 1e-5 at
  1.38–1.45e-5 → `CB/packages/gpu/src/parity/page.ts:51-53, 104-105`.
- Preview vs core tabulated within 0.05 level (bound 0.1); vs exact up to 1.6 levels, the tables' interpolation →
  `CB/packages/gpu/test/browser/chain.spec.ts:22-34`; builders agree to a hundredth of a level → :58-62; tetrahedral
  more accurate → :73-82; reference engine 'tabulated' mode → `CB/packages/core/src/engine-ref.ts:4, 24-30`.
- Builder in the key; previews may take either, exports name 'f64' → `CB/packages/gpu/src/tables/manager.ts:1-2, 74-93`;
  keys hash consumed arrays → `CB/packages/gpu/src/tables/keys.ts:1-4`.
- Half floats: source relative error 4.8e-4; scene max 1.6e-4 (tolerance 3e-5); display 0.0134 = 3.4 levels
  (tolerance 2e-4); Metal display 0.0116; kept f32; presenter rgba16float → `T041/diary/01-diary.md:304-305, 339-342,
  398`; measurement rounds the source, a stand-in for camMatrix's output → :357-358; test → `CB/packages/gpu/src/parity/residency-tests.ts:41-72`;
  tolerances `film:scene` scene 3e-5, display 2e-4 → `CB/packages/gpu/test/browser/digital.spec.ts:51-58`.
- Presenter canvas rgba16float with display values → `CB/apps/studio/src/present/presenter-webgpu.ts:2, 125-155`;
  `CB/packages/output/src/display/canvas.ts:2, 41`.
- Full-size intermediates rgba32float → e.g. `CB/packages/gpu/src/chain/run.ts:112`, `engine-gpu.ts:403-459`.
- Spectra table shipped as F16 bits, widened to f64 → `CB/packages/core/src/film/upsample.ts:35-51`.
- Editor lab textbook: half floats "keep about three decimal digits, enough for any intermediate that will be shown in
  8 bits" → `EL/src/book/06.md:271`.
- Transcendental probe: 10^x via exp2 within 1e-5 relative, log10 via log2 within 1e-6 absolute →
  `CB/packages/gpu/test/browser/tables.spec.ts:98-105`, `CB/packages/gpu/src/parity/page.ts:185-199`; LOG2_10 = 3.32
  negative control → `page.ts:107`.
- Parity ledger: export film-dyes 5e-6 → `chain.spec.ts:15-19`; scene 3e-5, display 2e-4 → `digital.spec.ts:57-58`;
  OkLab separable blends 3e-4 → `digital.spec.ts:35`.

### What worked

- Every number the brief suggested was confirmed in its source, except one nuance (Step 4, "What I learned").

### What didn't work

- N/A at this step.

### What I learned

- The light law (`pixel.ts`) is the best single example for chapter 1: one formula that sums light in linear H and
  densities in the exponent.
- Linearity in brightness is what lets the film table be two-dimensional (`upsample.ts:4-7`).
- The 3e-4 vs 2e-5 blend bound is a precision cost of a conversion, measured: the strongest number for "conversions
  are not free".

### What was tricky to build

- Not repeating siblings: modular ch. 5 already quotes the binding times, `healCoefficients` and the pairwise sum.
  Chapter 2 cites them in one note each and spends its space on budgets, shares, conditioning and the half-float
  measurement.

### What warrants a second pair of eyes

- N/A (reading only).

### What should be done in the future

- N/A

### Code review instructions

- Start from the claim lists above; every entry opens at its file:line.

### Technical details

- N/A

## Step 2: Chapter 1 — Encode Where the Operator Is Linear

I wrote the chapter around three failures with numbers: averaging encoded values (Editor lab's pyramid, 22 levels on
0.5 % of pixels), a seam correction in the wrong encoding (a worked example), and conversions in inner loops (Editor
lab's tables; chromobench's 15× looser bound for separable blends on OkLab layers). The Sketch is a planner that lowers
each operation with conversions in and out and then merges adjacent conversions, plus a terminal-order check and the
heal kernel in both encodings.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Draft chapter 1 to the template, within 2,200–3,000 prose words.

**Inferred user intent:** (see Step 1)

### What I did

- Wrote `docs/patterns/gpu/01-encode-where-the-operator-is-linear.md`.
- Cut from about 3,200 to 2,903 prose words (final) (counting tokens with a letter or digit outside code blocks; 3,007 with
  table pipes and list markers); raw file 3,423 words.

### Why

- Premultiplied colour is taught in the modular volume's chapter 4; here it appears in the Solution, the Sketch, an
  exercise (prove `over` affine, filtering commutes) and Known uses, not as a lesson of chromobench, which has no alpha
  channel in its pipeline (coverage enters as mix weights; CHB-042 diary 03:47-49, re-checked against `blend.ts`).

### What worked

- My own arithmetic (marked here, stated in the chapter as a worked example or a computation):
  - Heal example: target ring 0.02, source ring 0.20, texture ±0.05. Additive −0.18 → −0.03…0.07. Relative texture
    at the target: 0.05 / 0.02 = 250 % against 25 % in the source: ten times too strong. Gain 0.1 → 0.015…0.025
    (±25 %). In density the gain is an offset of −log10(0.1) = 1.0 (not in the final text).
  - Overlay pivot: linear 0.5 encoded by sRGB: 1.055 · 0.5^(1/2.4) − 0.055 = 0.7354.
  - Editor lab's nearest-entry table error when encoding near black: half a step 1/8,192 times slope 12.92 =
    0.00158 = 0.40 of an 8-bit level (×255).
  - Blend bound ratio: 3e-4 / 2e-5 = 15.
- Sketch trace checked by hand: `lower` of [exposure, curve, hueShift, multiplyBlend, gamutKnee] with home linear
  gives six non-identity conversions; `simplify` keeps four (→perceptual, →linear, →perceptual, →linear); the
  perc→lin, lin→perc pair between curve and hueShift vanishes.

### What didn't work

- My first planner sketch inserted a conversion lazily and tried to cancel "the previous conversion"; on a hand trace
  the cancellation branch could never run (the previous step was always an operation). Replaced by `lower` +
  `simplify`, where cancellation is real.
- First draft said chromobench normalises the OkLab rows "so white is exactly neutral". Wrong: it keeps Ottosson's
  published M2, and white comes out `[0.9999999935, -1.7e-16, 3.73e-8]`, tested to 5e-8
  (`T037/diary/11-phase-p8a-ops.md:357-359`). Rewritten.
- First draft called the additive texture "five times too strong"; recomputed: ten.
- First draft attributed "do not transfer and are re-tuned" to Editor lab; it is chromobench's design (`D035:758`).

### What I learned

- The cube root is well-conditioned in relative terms (κ = 1/3) and badly conditioned in absolute terms near zero;
  the measured 1.1e-4 needs an absolute error in the argument, which exclusion's cancellation provides. Exercise 2 was
  rewritten to ask exactly that, and why a plain round trip does not show it.

### What was tricky to build

- The Solution had to name four encodings without domain words outside parentheses; the examples went into one
  parenthesised sentence.

### What warrants a second pair of eyes

- Known uses: Blinn 1994 ("Compositing, Part 1: Theory", IEEE CG&A) and Kodak Cineon's 0.002 density per code value
  are from my knowledge, not from a source in this tree. I am confident of both; remove if a reviewer is not.
- "GPUs can decode sRGB textures in hardware when sampling" and the `EXT_texture_sRGB` / `rgba8unorm-srgb` names are
  from my knowledge of the APIs.

### What should be done in the future

- N/A

### Code review instructions

- Read the chapter against the Step 1 claim list for chapter 1.

### Technical details

- Removed after cuts: the knee's cost on the CPU reference (≈ 48 inverse transforms per pixel, 70 % of the rest,
  `T037/diary/14-phase-p3b-engines.md:122-126`); a Forces bullet on conditioning (folded into "Exact conversions
  against cheap ones").

## Step 3: Chapter 2 — Precision Ladder

I wrote the chapter around four failures: a long f32 sum (my CPU measurement), a per-pixel f32 bisection that misses
where ill-conditioned (chromobench's knee on Metal), an iterative solve whose stopping test is below f32's reach
(chromobench's GPU dye solve), and the Editor lab textbook's half-float rule of thumb measured false by CHB-041. The
Sketch shows the three rungs (prepare in f64 and round once; apply in f32; accept tables and narrower storage within a
share of a budget), the two-level reduction, and the reachable stopping test.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Draft chapter 2 to the template, within 2,200–3,000 prose words.

**Inferred user intent:** (see Step 1)

### What I did

- Wrote `docs/patterns/gpu/02-precision-ladder.md` (2,854 prose words by the Step 2 count, final; raw 3,563).
- Measured the summation numbers with NumPy on this Mac (a CPU model, not chromobench code), in the scratchpad:

```text
n = 4000*2674
const 0.18, sequential f32 (np.cumsum dtype float32): mean 0.157324…, relative −0.12598
uniform [0, 0.36], sequential f32: relative −1.59e-3
uniform, 256-value f32 trees then f64 sum of 41,782 partials: relative −2.31e-10
```

- My own arithmetic (marked): partial count for a 4,000 × 2,674 image with 16 × 16 workgroups: 250 × 168 = 42,000;
  readback 42,000 × 64 B = 2,688,000 B = 2.56 MiB; the image as RGBA f32: 4,000 × 2,674 × 16 B = 171,136,000 B =
  163.2 MiB; ratio ≈ 64. Tree depth for 256 values: log2 256 = 8. Knee bound 4.5e-5 = 1.5 × 3.0e-5. Display error
  0.0134 × 255 = 3.4 levels; scene 1.6e-4 / 3e-5 ≈ 5.3. Table error vs arithmetic in the preview: 1.6 / 0.05 = 32
  (stated in the chapter only as "all of it table error").

### Why

- The brief's half-float figure "~3 levels" is 3.4 on SwiftShader (0.0134) and 3.0 on Metal (0.0116); the chapter
  gives 0.0134 and 3.4 levels, and the Metal figure separately.
- The brief says "half-float camMatrix"; CHB-041 actually rounded the *source* as a stand-in for `film.camMatrix`'s
  output (`T041/diary/01-diary.md:357-358`). The chapter says "rounded a camera file's source to half floats".

### What worked

- Binding times are stated as the design states them (four times, no per-pixel user code, a proposal), in one note,
  because modular ch. 5 already teaches them.

### What didn't work

- Rendering the mermaid diagram with `npx -y @mermaid-js/mermaid-cli@11.4.2 -i ladder.mmd -o ladder.svg` (in the
  scratchpad folder `ch02-mmd/`) was refused twice by the session's permission classifier ("Undermining Oversight").
  I did not retry. The diagram uses only constructs the overview's map already uses (`flowchart`, `subgraph id["…"]`,
  `<br/>`, quoted edge labels); 7 nodes. It is **not render-checked**.

### What I learned

- Minimum and maximum never round and histogram counts are integers, so only the sum of a reduction needs the wide
  finish — a sharper statement than "reduce in wide precision".

### What was tricky to build

- The sketch's `mean` needed the overview's GPU notation in full (dispatch, submit, await, readback) and a guard for an
  empty box (count 0), which `measure.ts:72` also has.
- `chooseStorage` must not fall off the end: f32 always qualifies, so the loop always returns.

### What warrants a second pair of eyes

- Known uses from my knowledge, which I am confident of but did not check against a copy here: Kahan, CACM 8(1), 1965;
  Blanchard, Higham & Mary, SIAM J. Sci. Comput. 42(3), 2020; Carson & Higham, SIAM J. Sci. Comput. 40(2), 2018;
  Langou et al., SC 2006 (full author list as in the chapter); NumPy's pairwise `sum`; renderers' 11/11/10-bit float
  render targets.
- Removed as not certain: a specific WGSL ulp figure for `exp2` (I wrote "states the accuracy … in ulps and absolute
  error" instead); a specific f64:f32 throughput ratio for consumer GPUs ("a small fraction … or not at all").

### What should be done in the future

- Render-check the chapter 2 mermaid diagram when mermaid-cli may run.

### Code review instructions

- Read the chapter against the Step 1 claim list for chapter 2; rerun the NumPy measurement (Technical details).

### Technical details

```python
import numpy as np
n = 4000 * 2674
x = (0.18 * np.ones(n)).astype(np.float32)
seq = np.cumsum(x, dtype=np.float32)[-1]          # sequential f32 accumulation
```

## Step 4: Verification

I re-read both chapters against the template, the writing rules and the claim lists, checked line lengths (≤ 120
characters, counted in characters) and word counts, and traced both sketches by hand.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Check the chapters against the brief before reporting.

**Inferred user intent:** (see Step 1)

### What I did

- Template: both chapters have the sixteen `##` sections in order, the rating line verbatim, a bold one-sentence
  Problem, a bold Solution starting "Therefore:" with the memorable core first and at most six sentences, four to six
  Forces, Applicability with "do not use it when", Structure with a non-image line, nine (ch. 2) and ten (ch. 1)
  implementation notes, four Variations, three or four ± Consequences each, four Exercises each (implement and measure
  on a laptop, analyse, another domain, reading or proof).
- Privacy: no photo, file name, person or roll is named; the only image size mentioned is 4,000 × 2,674 (a synthetic
  grey in my measurement) and "a camera file".
- Project identifiers (chromobench, Editor lab, P10-x, file names) appear only in Motivation, Implementation notes and
  Known uses. A draft of chapter 2's first Variation named chromobench's GPU table builder; I made it generic and
  moved the example to Known uses.

### What worked

- Line lengths: max 120 characters in both files.
- Removed the ticket id "CHB-041" from chapter 2 note 7 (project history) and the project name from exercise 2(b).
- Word counts (prose outside code blocks, tokens with a letter or digit): ch. 1 2,903; ch. 2 2,854.

### What didn't work

- `awk 'length>120'` on macOS counts bytes, so it flagged lines with multi-byte characters (⁻, ×, →); I switched to a
  Python character count.

### What I learned

- N/A

### What was tricky to build

- N/A

### What warrants a second pair of eyes

- The chapter 2 mermaid diagram (not render-checked, Step 3).

### What should be done in the future

- New debts found while reading (not P10-x), for the ticket owner to consider:
  - chromobench: separable blend modes that branch at 0.5 (overlay, hard light, soft light) now branch at linear
    0.5 = display 0.735; nothing user-facing says so (design §22 only says presets are re-tuned).
  - chromobench: `Reducer.moments` reads back 64 B per 16 × 16 workgroup (2.6 MiB for a 4,000 × 2,674 box) and builds
    JavaScript arrays per channel from it; a second device pass would shrink the readback to bytes (chapter 6's
    territory).
  - Editor lab: its CPU engine converts sRGB through nearest-entry tables (`engine.js:14-15`) while its GPU path calls
    `pow` (`views/gpu.js:11-12`), so its two engines differ by construction (up to 0.4 of a level by my arithmetic).

### Code review instructions

- `python3` snippet in Step 3 to recheck the summation numbers; open each Step 1 citation.

### Technical details

- N/A
