---
Title: Diary — chapters 3 and 4 (One Grid Rule; Wide Kernels at Constant Cost)
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
    - Path: docs/patterns/gpu/03-one-grid-rule.md
      Note: chapter 3, written in this diary
    - Path: docs/patterns/gpu/04-wide-kernels-at-constant-cost.md
      Note: chapter 4, written in this diary
ExternalSources: []
Summary: "Writing chapters 3 and 4 of Fast and Checkable: sources verified, choices, numbers computed, claims removed."
LastUpdated: 2026-11-15T20:00:00-05:00
WhatFor: "Trace every claim in chapters 3 and 4 to a file:line or to a computation, and record what was cut."
WhenToUse: "Reviewing or revising chapters 3 and 4; checking a number before quoting it elsewhere."
---

# Diary

## Goal

Write chapter 3 (One Grid Rule, ★★) and chapter 4 (Wide Kernels at Constant Cost, ★) of the GPU volume, following
the shared writer brief, with every claim about chromobench and Editor lab traced to a source line, and every number
I computed myself marked as mine.

Paths below: `chb037/` is the read-only integration worktree
`/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037/`;
`lab/` is the read-only Editor lab tree `…/scratchpad/editor-lab-src/editor-lab-work/editor-lab/`; `scratch/` is
`…/scratchpad/chb043-ch34/` (my scripts, not kept in the repo).

## Step 1: Sources

I read the brief, the overview, the four sibling chapters (image engine 08 Reach-Declared Tiling, 06 Tabulated
Preview, 03 Reference Oracle; modular 06 Work in Small Slices), then the code and ticket records the brief named.
Two of the brief's leads did not hold as stated (below); one reading turned up a latent bug the chapter now uses.

### Prompt Context

**User prompt (verbatim):** "Write chapters 3 and 4 of "Fast and Checkable: GPU Image Computation Patterns"
(graduate students). First read the shared brief in full and follow it exactly: …/playbooks/01-writer-brief.md
YOUR CHAPTERS - …/03-one-grid-rule.md — "One Grid Rule" ★★ … - …/04-wide-kernels-at-constant-cost.md — "Wide
Kernels at Constant Cost" ★ … SIBLING CHAPTERS TO READ … DIARY FILE: reference/03-diary-chapters-03-04.md in the
CHB-043 ticket." (the full scope lists are in the coordinator's message; abbreviated here with ellipses only where
they repeat file paths)

**Assistant interpretation:** Two pattern chapters in the brief's template, deeper than the image-engine siblings
(error bounds, cost models, device semantics), with a diary of sources.

**Inferred user intent:** A graduate-level chapter pair the coordinator can merge without re-verifying facts.

### What I did — sources and what each supports

Grid rule (chapter 3):
- `chb037/packages/core/src/print/masks.ts:6-9` — the rule fp = region.x + ⌊(p + ½)·region.w / w⌋, coordinate masks
  at fp + ½; `:18-24` `gridCentres`.
- `chb037/packages/core/src/engine-ref.ts:2-3` — "a region is bit-identical to the crop of the full result";
  `:43-48` sampled previews ("nearest sampling commutes with pointwise ops"); `:114-118` `gridOf` (f64,
  multiply then divide, with a defensive min(region.w − 1, …)); `:135-158` `frameGrid` (un-straightened
  `output.frame` as a permutation; straightened → null).
- `chb037/packages/engine-mock/src/engine-mock.ts:141-143` — the mock's identical f64 rule.
- `chb037/packages/gpu/kernels/pointwise.wgsl:385` and `kernels/retouch.wgsl:76-77` — GPU fp =
  outMap.xy + floor((p + 0.5)·outMap.zw) in f32, retouch at fp + 0.5; `gpu/src/chain/program.ts:116` and
  `gpu/src/retouch.ts:86` — outMap.zw = region.w / outW computed in f64, stored as f32 (so z = f32(w/n)).
- `chb037/packages/gpu/kernels/frame.wgsl:50-51` — straighten computes floor((g + 0.5)·reg.z / outW) in f32 (divide).
- `chb037/packages/gpu/src/parity/reference.ts:42-47` — the parity reference samples with the f64 rule.
- `chb037/packages/gpu/src/residency.ts:153-167` — `gridCoords` with `Math.fround`, "computed in f32 as
  kernels/pointwise.wgsl does"; `sampleSource`.
- `chb037/packages/core/src/print/retouch.ts:6-12` (spots at full-resolution pixel centres, bilinear S),
  `:59-66` `bilinearAt` (clamp to [½, W − ½], subtract ½), `:170-171` (x + 0.5 − s.x).
- `chb037/packages/gpu/src/frame.ts:1-5, 31-36` — permutation vs bilinear straighten.
- `chb037/packages/gpu/src/film.ts:215-217` (um() = film pitch / scale), `:299-301` (grain keyed on frame pixels at
  scale 1, preview grid pixels below); CHB-005 guide
  `chb037/ttmp/2026/11/11/CHB-005*/design-doc/01-intern-guide-webgpu-engine.md:657` (Selwyn's law preview grain).
- `chb037/packages/core/src/print/clarity.ts:18-21` (σ = radius_mm·1000 / µm per paper pixel);
  `core/src/print/densityMask.ts:67-70` (σ = radius_um / µm per film pixel).
- CHB-037 P3b diary `chb037/ttmp/2026/11/14/CHB-037*/diary/14-phase-p3b-engines.md:113-121, 145-169` — 4.2 s step,
  the display cut off the grid, permutation fix, "step 4.2 s → 1.37 s (grid) → 0.74 s"; goldens 66/66 max |Δ| 0.
  `:383-413` — GPU `output.frame`; `law:frame` 0 differing values.
- CHB-041 diary `chb037/ttmp/2026/11/15/CHB-041*/diary/01-diary.md:140` (proxies), `:166` (gridCoords formula),
  `:202` and `:397` (0 samples differ, SwiftShader and Metal), `:210-214` (first parity run 32,302 of 32,886,
  max 0.64, origin bug), `:227-228` (fround reasoning), `:326-328` (proxy = nearest level; P2 area-averaged levels
  proposed), `:407-416` (textures live 328 MB → 47 MB; peaks 444/512 → 199/215 MB).
- Editor lab `lab/src/engine.js:45-58` (`level`: 2 × 2 alpha-weighted average), `:263-270` (σ / 2ᴸ),
  `:558-575` (`compValues`: (x + 0.5)·s, block centres); book `lab/src/book/05.md:216-275` (downsampling,
  binomial gains, premultiplied and sRGB averaging), `:277-298` (level-invariance table: blur σ 6 largest 8;
  threshold 223 and 6.4 %; grain 56.9 %).

Wide kernels (chapter 4):
- `lab/src/engine.js:74-79` `boxSizes`, `:81` `blurReach`, `:82-95` `boxH`, `:96-120` `boxH4`, `:121-123`
  `transpose`, `:126-136` `gaussBlur`; book `lab/src/book/04.md:7` (1,089 vs 66 at r = 16), `:39-52` (variance
  formula; σ 6 → 11, 11, 13; σ 24 → 47, 47, 49), `:58-84` (reach 16 and 70 px); `05.md:85-150` (Halide overlap;
  "three fused σ 6 px blurs at 128 px tiles read … 3.06"), `:300-330` (σ = 100: 601 taps, 1,202 reads; [1,3,3,1]/8
  variance 0.75; v(n) = 0.25(4ⁿ − 1); six decimations and 11 taps; the "Careful" on upsampling blur and aprons);
  `08.md:132-145` (staged blur, 1 + 2r/256, 384 entries, 6 KiB of 16 KiB; SwiftShader timing meaningless).
- `chb037/packages/gpu/src/spatial.ts:1-3` (sizes in µm), `:12` `MAX_RADIUS = 96`, `:18-37` taps at ⌈3σ⌉,
  `:48-79` two-dispatch separable blur; `gpu/kernels/blur.wgsl` (direct loop to R, clamp).
- `chb037/packages/gpu/src/engine/textures.ts:125` `fieldSigma`, `:127-151` `gaussianBlur` (s = ⌈σ / 32⌉, padded
  field, explicit bilinear) and its comment at `:132` (28 % at σ = 94 px).
- CHB-037 P3 diary `…/diary/07-phase-p3-gpu.md:257-262` — clarity 3 mm, σ = 94 px on 96 × 64: 28 % off near the edge;
  feather and density mask affected above σ = 32; field path 0.75 %; `textureSampleLevel` replaced by an explicit
  `upsample` because Metal's filter has 8-bit weights.
- `chb037/packages/gpu/src/tiles.ts:65-75` (reach in px from µm), `:88-92` (chains sum, max across; halo + 1 for
  bilinear, aligned to 8), `:111` (σ_field formula), `:115-123` (tile from budget / 2 and bytes per pixel).
- `chb037/packages/gpu/src/engine-gpu.ts:331-337` (`planFor`, `bytesPerPixel: 320`, "12 ran out of memory"),
  `:708-728` (`haloOf`: own + max of inputs; local reach ⌈3σ⌉ ≤ 96 only for σ ≤ 32), `:735-750` (`renderRegion`),
  `:765-800` (`blurAt`, `fieldOf`, field cache within a quarter of the budget).
- `chb037/packages/gpu/kernels/field.wgsl:120-135` (`upsampleAt`: (x + origin + 0.5)/s − 0.5 + pad, f32 weights).
- `chb037/packages/gpu/src/film.ts:19-20` (`MAX_PASS_SIGMA = 32`), `:148-160` (`gauss`: ⌈(σ/32)²⌉ passes of
  σ/√p), `:182-205` (`reach`: p·min(96, ⌈3σ/√p⌉)).
- `chb037/packages/core/src/film/couple.ts:22, 31, 87-90` (diffusion tail 200 µm, off unless `diffusion_um` set);
  `core/src/film/blur.ts:8-10` (EXP_GAUSSIANS, largest ratio 2.7684), `:13-22` (taps at ⌈4σ⌉), `:25-32` (scipy
  reflect); `core/src/film/halation.ts:20` (65 µm still, 50 µm cine).
- `chb037/packages/core/src/print/masks.ts:162-197` (core Gaussian ⌈3σ⌉, clamp-to-edge).
- `chb037/packages/ingest/src/conditioning/dust/kernels.ts:26-37` (dust Gaussian ⌈3σ⌉), `:40-46` (reflect101),
  `:96-112` (`squareMinMax`: separable, direct, O(r)), `:118-137` (`boxMean`: f64 integral image);
  `dust/specks.ts:38-55` (callers; r is a speck radius).
- CHB-037 P3b diary `…/14-phase-p3b-engines.md:480-483` (10 mm clarity σ ≈ 200 px, ~700 px aprons, 256-px tiles
  reading 1650²), `:529-536` (two OOMs; 20 textures per pixel), `:565` (darkroom export 781.1/782.2 ms "tiles wrong
  at borders" → 1647.5/1653.9 ms, 48 tiles of 512, halo 64); CHB-037 `diary/01-diary.md:850-851` (~781 → ~1650 ms)
  and `:854` ("no test compared tiled and whole"); `tasks.md:26` (open task: plan from the DAG's live-texture peak,
  one-pass fields).

### What didn't work (leads that did not hold)

- The brief lists `ingest/src/conditioning/dust/kernels.ts squareMinMax` as a van Herk–Gil-Werman use. It is not:
  it is a separable *direct* min/max, 2r + 1 comparisons per pixel per pass (`kernels.ts:96-112`). Chapter 4 says so
  (note 10) and names van Herk–Gil-Werman as what it could be.
- Paths in the brief omit `packages/`; the files are under `chb037/packages/…`.
- The brief's ~781 → ~1,650 ms is confirmed (sources above); the CHB-037 diary also has 244.8 ms for the plain
  print export, which I did not need.

### What I learned

- The engines do not share the grid rule's *arithmetic*. Reference and mock: f64 multiply-then-divide. GPU pointwise
  and retouch: f32 multiply by f32(w/n). GPU straighten: f32 divide. CHB-041's proxies copy the GPU's arithmetic
  (fround), so they are bit-exact with the GPU, not with the reference.

## Step 2: Chapter 3, One Grid Rule

Wrote `docs/patterns/gpu/03-one-grid-rule.md`. The chapter's spine is the sample-consistency law
out_G(p) = F(fp_G(p)), which is what "a region is bit-identical to a crop" generalises to at every scale, plus the
argument for computing fp in integers.

### What I did

- Measured the tie mismatch (my computation, `scratch/grid.mjs`, `ex.mjs`, `parity.mjs`; Node, emulating f32 with
  `Math.fround` after each operation, as `residency.ts:165-166` argues is exact):
  - w = 6,000: of the 5,901 output widths n = 100 … 6,000, 791 have ≥ 1 column where ⌊f32((p + ½)·f32(w/n))⌋ ≠
    ⌊(p + ½)·w/n⌋ (2,433 columns in all); f32 divide: 157 widths (157 columns). w = 6,048: 842 / 184. w = 4,000:
    554 / 0.
  - Example: w = 6,000, n = 135, p = 22: exact 1,000, f32 z = 44.444443, product 999.99994 → 999.
  - First f32-divide mismatch for w = 6,000 at n = 4,109; the sufficient bound 2n·w < 2²⁴ fails from n = 1,399
    (2²⁴ / 12,000 = 1,398.1). The true threshold is n < 4,096 because gcd(w, 2n) ≥ 2 for even w (distance ≥ 1/n).
  - Parity scales 0.5, 0.4, 0.375, 0.25 on widths 224 … 6,000: 0 mismatches. At 0.375, ties exist (750 in a
    6,000-px row) but f32(8/3) = 2.6666667461 rounds up, so the product never falls below the integer.
- Integer bound: (2p + 1)·w ≤ (2n − 1)·w < 2n·w < 2³² ⇔ n·w < 2³¹ (my arithmetic).
- Power-of-two variation: ⌊(p + ½)·2ᴸ⌋ = p·2ᴸ + 2ᴸ⁻¹ for L ≥ 1 (my arithmetic).
- Editor lab's mask point (x + ½)·2ᴸ vs chromobench's fp + ½ with fp = p·2ᴸ + 2ᴸ⁻¹: differ by ½ full-resolution
  pixel (my arithmetic).

### Choices

- Motivation uses three failures (display cut 4.2 s; origin 32,302 / 32,886; ties), not the metering story, which
  sibling `../06-tabulated-preview-exact-export.md` note 8 already tells.
- Avoided "frame" (chromobench's word for the film frame) except where unavoidable; the chapter says "the
  full-resolution image" and "image coordinates", so "frame" cannot be confused with a display frame.
- No mermaid diagram: the shape is a formula, not a flow.
- Known uses kept only what I am sure of. Removed: a claim that Halide has a pixel-centre convention (it indexes
  integers; I kept only the crop-by-construction property); a version number for PyTorch's `nearest-exact` and for
  OpenCV's `INTER_NEAREST_EXACT` (not sure of the exact releases); TensorFlow's `half_pixel_centers` (true, but not
  needed); Vulkan's `subTexelPrecisionBits` (true, cut for length).
- Cut for length (first draft 3,593 words of prose, final 2,846 by a letters-only count): a medical-imaging domain
  paragraph (ITK kept in Known uses), parts of notes 2, 5, 8.

### What warrants a second pair of eyes

- Note 1 and the Motivation call the f32 tie mismatch "chromobench's open debt". It is a latent parity difference,
  not an observed failure: no test fails today. A reviewer may prefer "latent".
- Note 5 says the GPU preview's neighbourhood stages differ "in every case but healing", from P3b's `law:tiles`
  (preview path on the tile grid). That test compared tile-grid previews, not screen previews; the claim is about
  the reduced-grid approximation in general.

## Step 3: Chapter 4, Wide Kernels at Constant Cost

Wrote `docs/patterns/gpu/04-wide-kernels-at-constant-cost.md`. Graduate depth: the box-width quantisation bound,
the three-box shape and frequency error, accumulator precision with numbers, the GPU parallelism argument, reach
inflation under repeated passes (√p), variance bookkeeping for decimation.

### What I did (my computations, `scratch/boxes.mjs`, `runsum.mjs`, `halo.mjs`)

- `boxSizes` copied from `engine.js:74-79`, convolved exactly in f64:
  σ = 1 → 1,1,3 (σ 0.816); 2 → 3,3,5 (1.826); 3 → 5,5,7 (2.828); 6 → 11,11,13 (5.831); 12 → 23,23,25 (11.832);
  24 → 47,47,49 (23.833); 50 → 99,99,101 (49.833); 100 → 199,199,201 (99.833). Shape: max |box³ − Gaussian of the
  same variance| / Gaussian peak = 6.0–6.2 % for σ ≥ 6 (8.5 % at σ = 2); largest stopband |H| ≈ 0.0102 (−40 dB).
- Why σ − 1/6 for integer σ: wl = 2σ − 1, and m = (12σ² − 3(2σ − 1)² − 12(2σ − 1) − 9)/(−8σ) = 1.5 exactly; JS
  `Math.round(1.5) = 2`, so variance = σ² − σ/3, σ_actual ≈ σ − 1/6. Variance step per box changed: (wl + 1)/3.
- Gaussian tail mass (two-sided, 1-D): beyond 3σ 0.0027, beyond 4σ 6.3 × 10⁻⁵.
- f32 running sum, 6,000-px row of uniform [0, 1) values, r = 2, 20, 200: max error of the mean 2.9, 1.8,
  2.8 × 10⁻⁶ (≤ 0.19 of a 16-bit level).
- f32 summed-area table, 6,000 × 4,000 uniform values, 5 × 5 mean: at (5990, 3990) 0.5200 vs f64 0.4776 (corner
  sum 1.197 × 10⁷); at (3000, 2000) 0.5200 vs 0.5318; at (100, 100) equal.
- Export plans: 1,024 px tiles, no halo → 12 tiles, read/core 1.000; 512 + 64 → 48 tiles, 1.517; (1,024 + 128)² ×
  320 B = 405 MiB, (512 + 128)² × 320 B = 125 MiB; budget 512 MiB at the time (`14-phase-p3b-engines.md:531`
  "536870912"), half = 256 MiB. 1,650 / 781 = 2.11.
- Couple diffusion (only if enabled): 200 µm × 2.7684 = 553.7 µm; at 6 µm/px σ = 92.3 px; p = ⌈(92.3/32)²⌉ = 9;
  per-pass ⌈3·92.3/3⌉ = 93; declared reach 9 × 93 = 837 px; 3σ = 277 px. Halation 65 µm / 6 = 10.8 px; third bounce
  65·√3 / 6 = 18.8 px.
- In-use line of the sketch: clarity 10 mm at 48 µm/px → σ = 208 px → field scale ⌈208/32⌉ = 7; sharpen 0.1 mm →
  σ = 2.08 → reach ⌈6.25⌉ = 7.
- 10 mm clarity apron: 1,650² / 256² = 41.5.

### Choices

- Rating ★ (as the overview): running sums suit CPUs, direct separable + fields suit chromobench's GPU, IIR and FFT
  are real alternatives.
- The 28 % edge failure is told as "an early version"; the P3 diary does not give that version's pass count, so the
  ⌈(σ/32)²⌉ cost is attributed only to `film.ts`, where I read it.
- The sibling Reach-Declared Tiling already covers halos, paths-add/branches-max, read-minimising grids and border
  fields; chapter 4 keeps only one note on combining reaches and adds what is new: reach per formulation and
  tolerance, √p inflation, fusion multiplying aprons, and the cost breakdown of exactness.
- Known uses: removed GEGL's IIR option and OpenCV's box filter internals (believed true, not verified); kept Wells,
  Kovesi, Crow, Viola–Jones, Hensley et al., van Herk, Gil–Werman, Deriche, Young–van Vliet, Burt–Adelson, Halide,
  Podlozhnyuk, Jimenez's bloom.

### What warrants a second pair of eyes

- Note 7 contrasts three Gaussians: GPU 3σ clamp, f64 film reference 4σ reflect, dust 3σ reflect101. The GPU's film
  blurs are therefore compared with a reference using a different truncation and border; I did not read the film
  parity tolerances to see how much of the budget this uses.
- Note 4's "bounds the work at 2 × 193 taps per pixel" counts per channel-vector tap, per pass pair.

## Step 4: Verification

### What I did

- Word counts (`scratch/wc.py`; prose = outside code blocks): chapter 3 raw 3,451, prose 3,021 (2,846 counting only
  tokens with a letter or digit); chapter 4 raw 3,523, prose 3,011 (2,839). Headings, table rules and the rating
  line make up the difference.
- Lines ≤ 120 characters outside tables in both chapters (checked with Python).
- Template order and sections checked against the brief; Solution paragraphs 5 and 4 sentences.
- Sketches re-read for holes: `maxRows` pads r values of −∞ on each side and to a multiple of k, so the window
  a[x … x + 2r] spans at most two blocks; `boxRows` updates after writing and reads clamped indices past the end;
  `gaussWide` states its precondition σ > s/2 (true for s = ⌈σ/32⌉, σ > 32).
- Privacy: no photo, file name, person or roll is named; "two 24-megapixel raw files" only.
- No git commands, no edits outside the two chapters and this diary, nothing run in the worktrees.

### What should be done in the future

- chromobench: compute fp in integers in `pointwise.wgsl`, `retouch.wgsl`, `frame.wgsl` and `residency.ts`
  `gridCoords`, and add a parity law that sweeps output widths with ties (a width whose f32 ratio rounds down,
  e.g. 6,000 → 135).
- chromobench: route `film.ts` `gauss` through the single-blur field path (`engine/textures.ts` `gaussianBlur`) and
  derive `reach` from it.
- Overview: no change needed.

## Step 5: Revision after review

The coordinator relayed general lessons from a reviewer's reading of chapters 2 and 6 (recompute every number and
watch for degenerate inputs; separate a-priori bounds from measured maxima; precise WebGPU/WGSL semantics; MiB;
the 4,000-px working image; Solution = invariant only; no task IDs; sketch guards; glossed terms; exercises with
parameters; one transfer sentence). Recomputing my own numbers found two real errors in chapter 3, both now fixed.

### Prompt Context

**User prompt (verbatim):** (coordinator's revision message, not a user prompt; see Step 1 for the user prompt)

**Assistant interpretation:** Apply the lessons to chapters 3 and 4 and record the changes here.

**Inferred user intent:** Chapters a numerics-trained first-year PhD student can check line by line.

### What didn't work (errors found in my first draft)

- **"Mismatches happen at ties" was incomplete.** Separating ties from non-ties (`scratch/grid3.mjs`): for
  w = 4,000, 1,419 mismatching columns are ties where the f32 product falls below the integer (548 widths), and 6
  are near-ties where it rounds *up* across one (6 widths, all n ≥ 3,513). For w = 6,000: 2,177 tie columns
  (554 widths) and 256 near-tie columns (237 widths, n ≥ 2,497); 791 widths in all, as before. Chapter 3 note 1
  now gives both conditions: at ties no size is safe; off ties the reciprocal form is exact while n·w ≲ 2²²
  (1,048 for w = 4,000; 699 for 6,000; sufficient, not necessary).
- **The test-suite explanation was based on a degenerate input.** I had said the parity scales "cannot show it" and
  cited 750 ties at 0.375 on a 6,000-px row, but the suites do not use 6,000-px rows. Checking the actual fixture
  widths (`scratch/fixtures.mjs`; `chb037/packages/gpu/src/parity/residency-tests.ts:26` SCALES = 0.04, 0.125,
  0.29, 0.5, 0.731; images 403 × 271, 517 × 347, 301 × 203; regions 251 × 173, 300 × 200): odd widths have no ties at
  all ((2p + 1)·w / 2n is never an integer for odd w); the even widths I checked (200, 300, 320, 352) have ties but
  0 mismatches at every scale used. f32(8/3) = 2.6666667461 > 8/3 re-derived (it does round up). Chapter 3 now
  states this, and note 10 says tie tests need even widths.
- **Working size.** The GPU engine decodes raws to a 4,000-px working image (`chb037/apps/studio/src/host/
  engines.ts:34,112`, default 4000). The coordinator confirmed 4,000 × 2,674 (CHB-034 diary `01-diary.md:303`,
  `:452`; the CHB-041 diary's 2,686 is a slip). Chapter 3 now uses the 4,000 width throughout: 554 of 3,901
  widths mismatch; example n = 106, p = 26: exact 26.5 · 4,000 / 106 = 1,000, GPU 999.99994 → 999 (first draft's
  "column 22" was the 6,000-px example; corrected). Thumbnail height round(2,674 · 106 / 4,000) = 71 (unchanged
  from 2,686); rows of that grid: 1 tie, 0 mismatches. One rgba32float working texture: 4,000 × 2,674 × 16 =
  171,136,000 B = 163.2 MiB, so "163 MiB"; 328 → 47 MiB (the CHB-041 journal's MB are bytes/2²⁰).

### What I did

Chapter 3:
- Motivation: 4,000-px working image; glossed parity tests, texture, texel, tiles; tie numbers for w = 4,000; the
  odd-width explanation; one sentence for deep-learning readers (`align_corners`).
- Note 1 rewritten as a derivation: q = (2p + 1)w/2n is an integer or ≥ 1/2n from one (more precisely a multiple
  of gcd(w, 2n)/2n); correctly rounded division exact if 2n·w < 2ᵗ (f32: n·w < 8,388,608); WGSL (and Vulkan) round
  f32 + and × correctly but allow 2.5 ulp for f32 division, giving 10·n·w < 2²⁴ (derivation: 2.5 ulp(q) ≤
  2.5 · 2¹⁻ᵗ q < 5w·2⁻ᵗ ≤ 1/2n); CUDA division correctly rounded unless fast math; reciprocal form two roundings,
  ≈ 2⁻²³ relative, exact off ties while n·w ≲ 2²²; u32 multiplication wraps in WGSL, so n·w < 2³¹ is checked.
  The f32-divide count (157 widths at w = 6,000; 0 at 4,000) assumed correctly rounded division; it is now only
  in this diary.
- Note 2: software adapter glossed; 163 MiB; MiB for 328 → 47.
- Sketch: `grid(…)` constructor refusing empty grids, regions outside the image, and n·w ≥ 2³¹; degenerate
  gradient (a = b → 1, as `masks.ts:32` `linearAt`); in-use line on 4,000 × 2,674 at 106 × 71; plan-step names
  defined.
- Exercises: 1 now separates ties from near-ties and states that the emulated division is correctly rounded;
  2(a) asks for the three sufficient conditions and the gcd argument (why no f32-divide mismatch below n = 4,096
  for w = 6,000), so it no longer resembles chapter 6's rounding exercise. Exercise 3 checked for degeneracy:
  align_corners x = 63p/255 vs half-pixel x = (p + ½)/4 − ½ differ by 3/8 − 3p/1,020, largest 0.375 px at both ends.
- Cut for length: Direct3D 9 sentence in note 3 (kept in Known uses), the GeoTIFF Known-use line (in Motivation),
  one Applicability bullet, parts of notes 4, 6, 9.

Chapter 4:
- Motivation: glossed tile and halo; transfer sentence (dilated convolutions; the fast multipole method).
- Solution: dropped the path/branch combination and field reading (the image-engine volume's Reach-Declared
  Tiling); now the invariant only, four sentences.
- Note 1: per-pixel cost of a running-sum pass (1 add, 1 subtract, 1 multiply per channel) against 2(2r + 1)
  multiply-adds; arithmetic favours boxes from r ≈ 2 (4(2r + 1) > 18 flops at r = 2; my arithmetic).
- Note 2: a-priori bound |k∗x − g∗x| ≤ ‖k − g‖₁ max|x| with ‖k − g‖₁ against the *requested* σ (`scratch/
  boxes2.mjs`): σ = 2: 0.0651; 6: 0.0414; 24: 0.0501; 100: 0.0532; 2-D ≤ 2‖k − g‖₁ (k⊗k − g⊗g = (k − g)⊗k +
  g⊗(k − g), both factors of mass 1). Measured maximum on a step edge: 1.63 %, 0.58 %, 0.84 %, 0.95 %. (Against the
  requested σ the peak difference is 3.4 % at σ = 6, 5.8 % at σ = 100; the earlier "6 %" was against a Gaussian of
  the same variance; removed from the chapter to avoid two numbers for one thing.)
- Note 3: "random input" stated for the f32 running-sum and summed-area numbers (non-degenerate: uniform [0, 1)).
- Note 4: bandwidth/compute estimate, parameters stated (400 GB/s, 10 TFLOP/s, 16 B per pixel): six streamed box
  passes 192 B/px → 0.48 ns/px; direct separable 64 B/px and 16(2r + 1) flop/px (2 passes × (2r + 1) taps × 4
  channels × 2 flops) → equal at 2r + 1 = 300, r ≈ 150. Labelled a linearised roofline estimate. Limits: WebGPU
  defaults 16 KiB workgroup storage, 256 invocations; Vulkan required minimums 16 KiB, 128; CUDA 48 KiB static
  shared memory per block.
- Note 6: aliasing estimate derived (`scratch/decim.mjs`): a component at 1/s − δ passes the s-box with gain
  ≈ πδ/sin(π/s), folds to δ, is kept by exp(−2π²σ²δ²); the maximum over δ (at δ = 1/2πσ) is
  e^(−1/2)/(2σ sin(π/s)). Values: s = 2, σ = 33: 9.2 × 10⁻³ (measured 8.96 × 10⁻³); s = 2, σ = 64: 4.7 × 10⁻³
  (4.63); s = 4, σ = 66: 6.5 × 10⁻³ (6.63); s = 4, σ = 128: 3.35 × 10⁻³ (2.78); s = 8, σ = 132: 6.0 × 10⁻³ (5.91).
  The simulation: 1-D, periodic, unit cosines at ~300 frequencies and two phases, the chromobench path (s-box,
  σlow Gaussian truncated at 3σ, bilinear up at centres) against a direct Gaussian. My first estimate used
  sin(π/s) ≈ π/s and undershot at s = 2 by π/2; corrected before writing. The chapter states "0.6–1.0 % at
  σ/s = 16 and 0.3–0.5 % at 32, the higher values at s = 2" (large s: e^(−1/2)/(2π·16) = 0.60 %; s = 2, σ/s = 16:
  0.6065/64 = 0.95 %; s = 2, σ/s = 32: 0.47 %) and "measured 0.28 % to 0.90 %, never more than 2 % above the
  estimate" (6.63 vs 6.50 × 10⁻³ at s = 4, σ = 66 is the worst).
- Note 8: the halo read factor ((t + 2m)/t)² made explicit; note 9 shows 1.56 inside vs 1.52 with clipped edges.
- Note 9: "20 textures per pixel" reworded to 20 rgba32float textures alive, 320 bytes per pixel
  (`engine-gpu.ts:336` bytesPerPixel 320).
- Sketch: `boxWidths(σ ≤ 0)` → identity; `plan` with px ≤ 0 → identity; `gaussWide` refuses when the prefilter
  and upsampling variances already exceed σ²; `low` and `mid` released; `bilinearUp` takes the output size;
  every helper defined in the header comment.
- Exercises: 1 no longer asks for f32 running sums (chapter 2 has the summation exercise), keeps the f32
  summed-area table; 2(b) gives bandwidth, compute rate, image size and workgroup limits and asks which terms are
  linearised.
- Cut for length: Known uses compressed (titles shortened), Collaborations to four steps, one Consequence, the
  exact-shape bullet of Applicability shortened.

### Word counts after revision

- Chapter 3: raw 3,717; prose outside code 3,181; letters-only 3,002.
- Chapter 4: raw 3,836; prose outside code 3,206; letters-only 3,009.

### What warrants a second pair of eyes

- WGSL and Vulkan accuracy statements (f32 +, × correctly rounded; ÷ within 2.5 ulp for |y| in [2⁻¹²⁶, 2¹²⁶]) are from
  my knowledge of the specifications, not re-read for this revision.
- The roofline device (400 GB/s, 10 TFLOP/s) is a stated example, not a measured chromobench device.
