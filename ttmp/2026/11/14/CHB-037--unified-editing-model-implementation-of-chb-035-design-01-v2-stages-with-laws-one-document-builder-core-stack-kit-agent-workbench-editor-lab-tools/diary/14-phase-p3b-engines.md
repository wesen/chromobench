---
Title: Diary — phase P3b engines
Ticket: CHB-037
Status: active
Topics:
    - architecture
    - ui
    - webgpu
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://apps/studio/src/host/studio-engine.ts
      Note: host output.frame removed (with leave)
    - Path: repo://packages/core/src/engine-ref.ts
      Note: Sampled output.frame, staged grid plan
    - Path: repo://packages/engine-mock/src/ops.ts
      Note: digital ops in the mock
    - Path: repo://packages/gpu/kernels/field.wgsl
      Note: downPadAt, upsampleAt
    - Path: repo://packages/gpu/src/chain/wgsl-link.ts
      Note: explicit WGSL includes
    - Path: repo://packages/gpu/src/engine-gpu.ts
      Note: GPU output.frame, renderRegion halos, whole-frame fields and extremes
    - Path: repo://packages/gpu/src/frame.ts
      Note: output.frame on the GPU
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T02:18:18.098599-05:00
WhatFor: ""
WhenToUse: ""
---



# Diary

## Goal

The phase agent's record of phase P3b of CHB-037: engine fixes and performance in `packages/core`, `packages/gpu`,
`packages/engine-mock` and `packages/output` (export path) — the gaps queued while other phases owned these packages:
tiled export at tile borders, the GPU's `output.frame`, the CPU preview's speed, the mock's pass-throughs for P8a's
ops, the load-dependent tests, and (optional) masked layers fused into the pointwise kernel. Spec: plan
`design-doc/01-implementation-plan-and-working-rules.md` "P3b — engine fixes and performance (queued gaps)" and the
amendments after P2a, P3, P5b-1 and P8a.

## Step 1: Reading the spec and the diaries; the baseline

The main agent assigned me phase P3b. I read the working rules (§1–§2), the P3b spec and the amendments, the P3 diary
(07: the planner, barriers, the blur field, the notes on tiles and `output.frame`), P5b-1's (09: the 4.2 s screen
render, the host `output.frame` in StudioEngine), P8a's (11: fusion, composite ops, timings), design §29 and the
performance companion (tiles and reach, fields), `docs/HANDOFF.md` §2, and the code: `core/src/engine-ref.ts`,
`gpu/src/engine-gpu.ts`, `engine/{dag,defs,textures}.ts`, `tiles.ts`, `kernels/field.wgsl`, `film.ts`,
`output/src/export/run.ts`, `apps/studio/src/host/{studio-engine,engine-serve}.ts` (read only: P5b-2 owns them).

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all."

**Assistant interpretation:** The main agent assigned me P3b: close the engine gaps the earlier phases queued (six
items), with timings before and after, without touching the packages other agents own now (studio-kit, apps/studio,
e2e; the contract's links, kits/looks, kits/roll, dsl).

**Inferred user intent:** The engines are correct everywhere (tiles, the display cut) and fast on both paths, so the
Lightroom-like studio feels immediate on the CPU fallback too and exports exactly what the preview promises.

### What I did
- `pnpm install --frozen-lockfile --prefer-offline` in the worktree (no package added).
- Baseline: `npx vitest run packages/core packages/gpu packages/engine-mock packages/output` → 37 files, 1450 passed,
  7 skipped; `node tools/goldens/render.ts --check` → 66/66 (every case max |Δ| 0).
- Created this diary with `docmgr doc add --ticket CHB-037 --doc-type diary --title "Diary — phase P3b engines"`
  (docmgr named it `12-diary-phase-p3b-engines.md`; renamed to `14-phase-p3b-engines.md` as the main agent asked);
  `docmgr doctor --ticket CHB-037` clean.

### Why
- The spec's items touch the planner (tiles), the engines' cut coverage (`output.frame`) and the reference engine's
  preview path; each needs the current code's facts, not the design's summary.

### What worked
- The reading located the CPU slowness before any measurement (Step 2): `GRID_OPS` lacks `output.frame`, and the
  test `engine-ref-sampled.test.ts` even says "output.frame (geometric: it runs at full resolution, so it is left out
  here)".

### What didn't work
- N/A (reading).

### What I learned
- `GpuEngine.planFor` declares no kernels, and every texture of one evaluation shares the target's grid (P3's design):
  a tile is rendered as if it were the frame, so every spatial op clamps at the tile's edge, and the density mask
  takes its reference minimum per tile.
- The GPU's field blur aligns its s × s blocks to the *grid's* origin and clamps at the grid's edge; only a grid that
  covers the frame gives the frame's field.

### What was tricky to build
- N/A (no code).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A for this step.

### Code review instructions
- Nothing to review.

### Technical details
- Logs (scratchpad `p3b/`, not kept): `baseline-vitest.log`, `baseline-goldens.log`.

## Step 2: The CPU preview — the display cut was computed at full resolution

The 4.2 s was not the tables: the tabulated mode is intact (`invert.dyes`, `print.expose`, `view.reflect` read core's
33³ tables). It was the display cut. Since P2b the reference engine implements `output.frame`, so StudioEngine's
`native()` sends the whole display cut to the worker's RefEngine; `output.frame` is not in `GRID_OPS`, so a sampled
preview computed every print stage on the grid (the staged loop), then `computeAt(output.frame)` fell to
`compute()`, which recomputed the whole chain at full resolution and sampled the result: twice the work, most of it at
full size. Before P2b the studio host did `output.frame` itself and asked the engine for `output.display` on the grid.

The fix keeps the reference exact: an un-straightened `output.frame` (crop and the eight orientations) is a pixel
permutation, so the output's sample grid maps to a sample grid of the receiver (each receiver axis reads one output
axis, transposed for the swapping orientations); the staged evaluation now plans each stage with its grid. A
straightened frame (bilinear) keeps the full-resolution path. Then the profile showed `output.display` at 70 % of
what was left: the OkLCh knee's chroma bisection (≈ 48 inverse transforms per pixel, three arrays each). An
allocation-free `inGamut` with inv's arithmetic in inv's order, and an allocation-free `look3`, halved the rest. The
goldens are bit-identical (every case max |Δ| 0).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Spec item 3: find why the reference engine's screen render takes ~4.2 s in the worker,
restore the fast path, measure before and after.

**Inferred user intent:** Without WebGPU the studio still answers a slider within a second.

**Commit (code):** d4fecb4 — "CHB-037 P3b: the reference engine's display cut on the sample grid (output.frame),
allocation-free gamut bisection and look3"

### What I did
- A Node bench (scratchpad `p3b/cpu-bench.ts`): a 1024 × 683 synthetic negative (the e2e's formula), `RefEngine({
  sampled: true, mode: 'tabulated' })` as the worker builds it, `newDocument`'s display cut at scale 0.7 (717 × 478,
  a screen pass), a cold render, three `time_s` steps, a draft. Reproduced: 4.2–4.3 s per step, "stages full 7".
- Profiled by wrapping `IMAGE_OPS` (temporary script): per step `output.display` ≈ 1.5 s at full size.
- `core/src/engine-ref.ts`: `frameGrid` / `transposeImg`, `computeAt`'s `output.frame` case, `stages()` (each stage
  with its grid: pointwise stages pass theirs, `output.frame` its receiver grid, other stages run at full resolution),
  `staged` and `warningsOf` on that plan.
- `core/src/print/gamut.ts`: `Perceptual.inGamut(L, a, b)` (OkLab: inv's sums and cubes inline; CAM16: inv),
  `maxChromaOf` uses it. `core/src/tables/tables.ts`: `look3` without arrays (same weights and summation order).
- Tests: `engine-ref-sampled.test.ts` — the display cut with a crop and each of the eight orientations, at scale 0.37
  and a region at 0.5, bit for bit the full path, with no print stage at full resolution; a straightened frame equals
  the full path.
- Timings alternating with a detached worktree of the base (`git worktree add --detach ../p3b-before 887fe95`),
  script `p3b/cpu-ab.sh`, three rounds (the machine's load average was ~20: other agents' suites).

### Why
- Exactness first: the sampled path must equal the full path bit for bit (CHB-027's rule), so only a geometry that is
  a permutation of pixels may move onto the grid.

### What worked
- Timings (M1 Max, Node 24, load average ≈ 20; ms per render):

  | Render | before (887fe95) | after (d4fecb4) |
  |---|---|---|
  | screen 717 × 478, cold | 7785, 7088, 6536 | 1765, 1610, 4695 |
  | screen, one `time_s` step | 4642, 9238, 4211 | 1292, 788, 739 |
  | draft 612 × 408, one step | 6956, 5949, 4142 | 775, 531, 448 |

  Unloaded (first runs): step 4.2 s → 1.37 s (grid) → 0.74 s (bisection, look3).
- `npx vitest run packages/core` 22 files, 833 passed; goldens 66/66, all max |Δ| 0; `pnpm typecheck`, `pnpm lint`.

### What didn't work
- A profile right after the look3 change read *slower* (`screen, time step 1 1275 ms`, untouched ops slower too):
  the machine's load (`uptime`: load averages 20.14 18.21 21.23). Only alternating runs are comparable.

### What I learned
- The worker's draft cost is now ~0.5 s for 0.25 MP: `output.display` (≈ 45 %), `print.develop` (the paper's
  three-CDF curve, ≈ 17 %), the tables (≈ 25 %).

### What was tricky to build
- The orientation inverse per axis: from `orientPixels` (output (x′, y′) reads input (x, y)), x depends on y′ for the
  swapping orientations and runs backwards for flipH, rot180, ccw90 and transverse; y runs backwards for flipV,
  rot180, cw90 and transverse. The receiver's grid has the output's rows as its columns when the axes swap, and the
  result is the transpose. The test covers all eight against `frameImage`.
- The stage plan must carry grids, not only node ids: a node can be needed on two grids (e.g. below and above a
  frame), and `warningsOf` must look each image up under the grid it was computed on.

### What warrants a second pair of eyes
- `engine-ref.ts` `stages()`: a stage that is neither pointwise nor an un-straightened frame passes `null` to its
  inputs (full resolution), which is what `computeAt` then does via `compute()`; if a new op is added to `GRID_OPS`
  that reads neighbours, previews would silently differ from exports.

### What should be done in the future
- If the CPU fallback must get faster still: `print.develop` through a 1-D table per channel in tabulated mode, and
  `output.display`'s knee through a (L, h) table of C_max (both change values slightly: they belong to the tabulated
  mode only, with parity bounds).

### Code review instructions
- `packages/core/src/engine-ref.ts` (`frameGrid`, `computeAt`, `stages`, `staged`), `print/gamut.ts` (`inGamut`),
  `tables/tables.ts` (`look3`); tests `packages/core/test/engine-ref-sampled.test.ts`.
- `npx vitest run packages/core`; `node tools/goldens/render.ts --check`; the bench: copy `p3b/cpu-bench.ts` into
  `packages/core/` and `node packages/core/cpu-bench.tmp.ts tabulated 0.7`.

### Technical details
- Display chain of the bench: source.open → scan.density → invert.dyes → print.expose → print.develop → view.reflect
  → view.flare → view.adapt → output.display → output.frame (the default lights filter at 0 compiles to no node).
- Logs: `p3b/cpu-ab-1.log`.

## Step 3: The load-dependent tests, without timing assumptions

Both vitest cases are deterministic and compute-bound (ch3's two 33³ solve tables per scanner, ~2–3 s alone; output's
quarter-size 16-bit export of a 512 × 256 frame through the exact f64 chain, ~2 s alone) and failed only on their 30 s
timeouts while other agents' suites loaded the machine. They now run without a timeout (`0`, which vitest treats as
none): a wrong value fails them, slowness does not; nothing they check changed. The parity page's first load is the
other case: every test opens it fresh, and a cold Vite server answering several workers at once on a loaded machine
spent film.spec's whole 180 s budget in the first `beforeEach`. Each worker now opens the page once in an auto worker
fixture with its own budget (10 min) before its first test (the transforms are then warm), and the parity Vite
server warms the page's module graph when it starts.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Spec item 5: make `film.spec.ts`'s pcg4d `beforeEach` timeout, `ch3.golden.test.ts` and
`export.test.ts`'s 16-bit distinct values robust without weakening them.

**Inferred user intent:** A red check means a bug, never a busy machine.

**Commit (code):** 3878da4 — "CHB-037 P3b: load-dependent tests without timing assumptions"

### What I did
- `core/test/ch3.golden.test.ts`, `output/test/export.test.ts`: per-test timeout `0` with the reason.
- `gpu/test/browser/parity.ts` (new): `openParity(page)` and `test` with the auto worker fixture `warmParity`; the seven
  parity specs' identical `beforeEach` blocks now call `openParity`. `gpu/parity-page/vite.config.ts`:
  `server.warmup.clientFiles`.

### Why
- Timeouts on compute-bound deterministic tests measure the machine, not the code.

### What worked
- `film.spec.ts` alone: 5 passed; the two vitest files 22/22.

### What didn't work
- First full parity run with the fixture: every test failed with `page.goto: Protocol error (Page.navigate): Cannot
  navigate to invalid URL` — a worker fixture's `browser.newPage()` has no `baseURL` (a test-scoped option). Fixed with
  `info.project.use.baseURL`; then `TS2379 … exactOptionalPropertyTypes` on `{ baseURL: string | undefined }`, fixed
  by passing it only when set.

### What I learned
- vitest 4: `withTimeout` returns the function unwrapped when `timeout <= 0`.

### What was tricky to build
- Keeping each test's page fresh (tests rely on a clean runtime: device loss, OPFS) while still warming the server
  once: the worker fixture opens and closes its own page.

### What warrants a second pair of eyes
- The worker fixture's 10-minute budget is the only bound left on a hung parity page's first load.

### What should be done in the future
- `playwright.config.ts` (root) could give the browser launch its own timeout (P5b-1 saw `browserType.launch: Timeout
  180000ms exceeded` with vitest running in parallel); not in my scope.

### Code review instructions
- `packages/gpu/test/browser/parity.ts`; `git show 3878da4`.

### Technical details
- N/A.

## Step 4: engine-mock implements P8a's ops

The mock listed every catalogue op it has an implementation for, so P8a's twelve ops were "not implemented" in its
conformance run. Pure pass-throughs would fail the semantic cases the suite runs for any engine that claims an op
(exposure's closed form, a straight curve, levels, the mixer matrix, the vignette's gain, the blend identities,
luminosity and colour in OkLab, radial and colour masks). So the mock got its own trivial closed forms: its working
encodings (its stage XYZ, linear RGB, OkLab over that RGB with Ottosson's matrices), straight-segment curves, levels,
vibrance's chroma gain, mixer, vignette, sharpen as its box-blur clarity, the W3C separable blends and the four
non-separable ones on OkLab, radial and colour masks. hsl and grade are pass-throughs (exact at their identity params,
the only semantics the suite asks of them).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Spec item 4: complete the mock's conformance run for P8a's ops.

**Inferred user intent:** The mock stands in for the studio's digital stack in UI tests.

**Commit (code):** 4a563cd — "CHB-037 P3b: engine-mock implements P8a's digital ops …"; the generated op reference
(`docs/reference/ops/{composite,mask}.md`: "Implementation: mock") is in 94cbf09.

### What I did
- `packages/engine-mock/src/ops.ts`: the ops above; `composite.mix` with blend modes (E_DOMAIN for a non-normal
  blend in a stage encoding, as core).

### Why
- "Complete" means every catalogue op passes its semantic cases, not only shape and determinism.

### What worked
- `npx vitest run packages/engine-mock packages/studio-kit apps/studio`: 32 files, 917 passed, 1 skipped; the
  semantic cases for every new op pass.

### What didn't work
- `pnpm gen:check` then reported `out of date: docs/reference/ops/mask.md`, `…/composite.md` (the op reference names
  the implementing engines); regenerated with `pnpm gen`.

### What I learned
- The conformance suite runs a semantic case whenever the engine's capabilities list the op: a stub cannot claim it.

### What was tricky to build
- The mock's luminosity/colour blends must be in the encoding the entry mixes in: on OkLab directly, through OkLab
  from linear RGB otherwise.

### What warrants a second pair of eyes
- The mock's curve is straight segments (core's is a monotone cubic): equal on the suite's two-point curves only.

### What should be done in the future
- N/A.

### Code review instructions
- `packages/engine-mock/src/ops.ts` (the "digital layers" block); `npx vitest run packages/engine-mock`.

### Technical details
- N/A.

## Step 5: The WGSL check (the coordinator's added item): explicit includes

The coordinator added an item: `tools/wgsl-check` failed since P8a because it compiled every kernel file alone, while
`combine.wgsl` and `pointwise.wgsl` call `wkMix` from `working.wgsl`, which the engine prepended in TypeScript (with
core's matrices as generated constants). The dependency is now explicit in the kernels: `//! include working.wgsl`
in both, `//! include working-constants` in `working.wgsl` (a generated module: core's OkLab matrices).
`chain/wgsl-link.ts` (no `?raw` import, so Node loads it) links a kernel by prepending its includes depth first, once
each; the engine's pipelines (`linkKernel`) and the check use that one linker, and the check asserts the includes.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The main agent's message: fix `tools/wgsl-check` so it stays meaningful (compile each
kernel as the engine does, or make the dependency explicit), add it to the acceptance, merge the integration branch
before finishing, and edit `apps/studio/src/host/studio-engine.ts` if the GPU `output.frame` needs it.

**Inferred user intent:** The WGSL check guards what the engine really compiles.

**Commit (code):** 5c306de — "CHB-037 P3b: explicit WGSL includes; the WGSL check links kernels as the engine does"

### What I did
- `packages/gpu/src/chain/wgsl-link.ts` (new: `wgslMat3`, `GENERATED_WGSL`, `includesOf`, `linkWgsl`);
  `chain/working.ts` (`linkKernel`, `WORKING_WGSL` = linked `working.wgsl`); `chain/run.ts`, `engine/defs.ts`
  (`POINTWISE_WGSL`, `COMBINE_WGSL` linked); the three kernels' include lines; `tools/wgsl-check/check.spec.ts`.
- Merged the integration branch (P7, P5b-2) at 8ef7767: `git merge task/chb-037-unified-model` → 42db697, no conflict.

### Why
- One linker for both: the check compiles exactly the engine's text, and a missing include fails there.

### What worked
- `CI=1 … pnpm exec playwright test --project=chromium-webgpu tools/wgsl-check` → 5 passed (incl. the new includes
  case); gpu vitest 62 passed (`digital.test.ts` still finds `WK_M1` and `wkMix` in `WORKING_WGSL`).

### What didn't work
- `TS2304: Cannot find name 'Mat3'` in `working.ts` after moving the imports; restored the type import.

### What I learned
- N/A.

### What was tricky to build
- `working.wgsl` itself needs core's matrices, which have no file: a generated module name keeps the include list
  the single description of what a kernel needs.

### What warrants a second pair of eyes
- `tools/wgsl-check` imports `packages/gpu/src/chain/wgsl-link.ts`, hence `@chromobench/core` (pure TS).

### What should be done in the future
- N/A.

### Code review instructions
- `packages/gpu/src/chain/wgsl-link.ts`, `tools/wgsl-check/check.spec.ts`.

### Technical details
- Directive grammar: a line `//! include <name>` (regex `^\/\/! include (\S+)\s*$`, multiline).

## Step 6: output.frame on the GPU; the studio host's output.frame removed

The GPU now covers the display cut. An un-straightened frame is a pixel permutation, so the receiver renders on the
grid the output grid maps to (the crop offset, the un-oriented region, the size swapped for cw90/ccw90/transpose/
transverse) and one pass of `kernels/frame.wgsl` (`orient`) reorients it; a straightened frame renders the receiver
over the crop's footprint at full resolution and `straighten` samples it bilinearly at the output grid's nearest
full-resolution pixels (contract `straighten`, the same rule core applies). With both engines implementing
`output.frame`, StudioEngine's own `output.frame` was dead code: with the main agent's leave (P5b-2 finished) I removed
it from `apps/studio/src/host/studio-engine.ts` (`HOST_OPS`, `frame`, `straightened`, `unorientBox`) and replaced the
three `host.test.ts` cases that tested it with one asserting that the host neither lists nor computes it.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Spec item 2, and the coordinator's leave to edit studio-engine.ts.

**Inferred user intent:** The GPU renders what the studio shows, one engine path per cut.

**Commit (code):** 94cbf09 — "CHB-037 P3b: output.frame on the GPU; the studio host's output.frame removed"

### What I did
- `packages/gpu/kernels/frame.wgsl` (`orient`, `straighten`; later `crop`), `src/frame.ts` (`unorientBox`,
  `frameSource`, `framePass`), `engine-gpu.ts` `renderGraph` (the frame path; the DAG is `renderDag`),
  `output.frame` in `GPU_OPS` and `BARRIER_OPS` (a frame read by another node fails clearly).
- Parity `law:frame` (law.spec): crop and the eight orientations against the GPU's own `output.display` permuted by
  core's `frameImage` at full size, at half scale (preview) and over a region; a straightened crop against
  `frameImage` on the GPU's receiver and against core end to end.
- `apps/studio/src/host/studio-engine.ts`, `apps/studio/test/host.test.ts` (with leave; recorded here).

### Why
- The host wrapper's frame read back the GPU's result and reoriented it on the CPU; the GPU's display cut now stays on
  the GPU (and the reference engine's on its sample grid, Step 2).

### What worked
- `law:frame` (SwiftShader): every orientation 0 differing values at full, half and region; straightened maxAbs
  6.6e-8 against `frameImage` on the GPU's receiver, 1 8-bit level against core.

### What didn't work
- `E_KERNEL_COMPILE: WGSL frame.orient: line 15:23: redeclaration of 'U'` — the struct and the uniform shared the name
  `U` (other kernels name the struct differently); renamed the struct `FrameU`.

### What I learned
- Nearest sampling commutes with mirroring and transposition: a reoriented grid of the receiver is exactly the
  reoriented frame's grid (the half-scale case is bit for bit).

### What was tricky to build
- `unorientBox`: along each un-oriented axis, which oriented axis it reads and whether it runs backwards, written once
  for the box and once (per pixel) in the kernel, both from `orientPixels`.

### What warrants a second pair of eyes
- A straightened preview renders the footprint at full resolution (as core and the old host did): at 24 MP that is a
  large texture; the studio's GPU working size (4000 px) fits the budget.

### What should be done in the future
- N/A.

### Code review instructions
- `packages/gpu/src/frame.ts`, `kernels/frame.wgsl`, `engine-gpu.ts` `renderGraph`; `law:frame` in
  `src/parity/law-tests.ts`.

### Technical details
- Orientation codes: 0 none, 1 flipH, 2 flipV, 3 rot180, 4 cw90, 5 ccw90, 6 transpose, 7 transverse (≥ 4 swaps).

## Step 7: Exact tiled exports for every spatial op

A GPU export at full resolution is now exact for any region. Three mechanisms, chosen per op by its reach: a node
renders over its region grown by its halo — the reach of its one-pass blurs (⌈3σ⌉ ≤ 96 px) and the film ops' blurs
along the deepest path, clipped to the frame where every op clamps exactly as on the whole frame — and the region is
cut out (`renderRegion`, `frame.wgsl crop`); a blur wider than one pass (σ > 32 px, the field path) reads the whole
frame's padded field, built once per export from frame boxes whose sides are multiples of the block, each box
writing the cells whose clamp-extended block lies in it (`field.wgsl downPadAt` sums the block in `downPad`'s order,
so the field is bit for bit the whole frame's) and read at the tile's frame position (`upsampleAt`); a density mask
takes its reference extreme from the whole frame (from the field, or box by box with the halo for a narrow blur). Heal
and clone needed nothing: their windows are their own (now haloed) renders. Previews keep every texture on the preview
grid (unchanged cost); "exact" is export precision at scale 1.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Spec item 1: tiles with halos and the planner's fields, and a test that tiled equals
whole for every spatial op.

**Inferred user intent:** The exported file is the picture the photographer edited, with no seams at tile borders.

**Commit (code):** 2ca1f97 — "CHB-037 P3b: exact tiled exports for every spatial op (halos, whole-frame fields and
extremes)"

### What I did
- `engine/defs.ts` `GridTarget.exact`; `engine-gpu.ts`: `whole`, `texOf`, `haloOf`, `renderRegion`, `boxes`,
  `blurAt`, `fieldOf` (a small cache of fields by node, purpose and σ; dropped with the source, on dispose and device
  loss), `extremesOf`, `extremes1`; feather, density mask, clarity and sharpen blur through `blurAt`; heal windows and
  the frame's receiver through `renderRegion`; option `exactBox` (box side, tests). `spatial.ts`: `fieldTexture`,
  `fieldDownAt`, `upsampleAt`. `film.ts`: `FilmGpu.reach` (couple's inhibitor mixture; halation's scatter plus
  bounces; passes as `gauss()` runs them).
- Parity: `law:tiles` (law.spec; 352 × 232 frame, 64-px tiles, fields from 96-px boxes): density mask narrow (40 µm)
  and wide (300 µm), feather narrow (0.12 mm) and wide (0.6 mm), clarity (2 mm, wide), sharpen (0.1 mm), heal with
  spots across tile borders, a stack of all; `film:tiles` (film.spec; a camera file 320 × 224, grain off and on).

### Why
- Halos alone would need ~700 px aprons for a 10 mm clarity (σ ≈ 200 px): tiles of 256 px reading 1650² — the field
  is what the planner's design (tiles.ts) and pattern chapter 8 prescribe for wide kernels.

### What worked
- First run: every case 0 differing 16-bit codes tiled against whole; the preview path on the tile grid differs in
  every case but heal (density ~245 k values, feather wide 58 k, sharpen 79 k), so the check can fail. Film: 0 codes,
  grain off and on (preview path: 1008 and 16 966 values differ).

### What didn't work
- N/A on the first run.

### What I learned
- Grain is tile-exact already (hashed by frame position).

### What was tricky to build
- A field built from parts equals the whole frame's only if no block straddles two parts and every pad cell has a
  home: boxes are multiples of s from the frame's origin; a cell's home box is the one holding its clamped block (pad
  cells before the frame belong to the first box, after it to the last).
- The density mask's reference is a whole-frame statistic: per tile it was each tile's own minimum.

### What warrants a second pair of eyes
- `haloOf`: a wide blur adds no halo but its inputs are still read on the grid (the final pixelwise passes), so their
  reach still counts; heal adds none (windows).
- `GpuEngine.planFor` still declares no kernels: the halo grows a 1024-px tile by at most a few hundred px; the budget
  check does not see it.

### What should be done in the future
- Refine previews at zoom ≥ 1 (scale 1, preview precision) stay approximate at their region's edge; making them exact
  would cost a whole-frame field per change.

### Code review instructions
- `packages/gpu/src/engine-gpu.ts` (the "exact exports" block), `src/spatial.ts`, `kernels/field.wgsl` (`downPadAt`,
  `upsampleAt`), `src/film.ts` `reach`; tests `law:tiles`, `film:tiles`.

### Technical details
- Field: s = ⌈σ/32⌉, pad = ⌈3·fieldSigma(σ, s)⌉ + 1, size ⌈W/s⌉ + 2·pad; box side s·⌊exactBox/s⌋.

## Step 8: Metal, the budget at 4000 px, timings, the final checks

On Metal (`REAL_GPU=1`, GPU lock `<scratchpad>/gpu.lock`, owner `P3b`, removed by a trap after every batch) the first
full parity run passed 53 of 54 runnable tests; the failure was my Step 3 fixture: `Fixture "warmParity" timeout of
600000ms exceeded during setup … browser.newPage: Test ended` — one worker's `browser.newPage()` never returned on
Metal. The fixture now warms the Vite server from Node (fetches the page and its entry) and never touches the browser;
digital.spec and film.spec then passed on Metal (10 passed). A SwiftShader run before that failed the conformance
case `capture.expose region` (and `film.develop`, `source.xyz`): `E_EVAL: film ops need the film pitch` — an exact
export of a region asked `FilmGpu.reach` for the pitch of pitchless patterns; only couple and halation ask now
(commit bd3ea50 "film reach asks for the pitch only for couple and halation"), conformance 524/524.

The darkroom bench (4000 × 2674) then ran out of memory in the exact export: `E_GPU_OOM: blur.v: 51269248 bytes do not
fit the budget (499113376 of 536870912 live)`, and after a first fix `… 27392000 bytes … (535749312 … live)` in the
next round's preview. Two causes: haloed tiles planned for five textures per pixel (the darkroom DAG holds about
twenty at once), and whole-frame fields (~40 MB each at s = 2) cached across rounds next to the 171 MB source texture.
The plan now declares the export node's halo as a local kernel and plans haloed tiles with 20 textures per pixel
(12 still ran out of memory), fields stay within a quarter of the budget, and the next non-exact render frees them.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Acceptance on the real GPU, GPU timings before and after (darkroom print, composite
stack), the final merge of the integration branch and the full checks.

**Inferred user intent:** The changes hold on the photographer's Mac, and the cost of exactness is known.

**Commit (code):** 1b81bf7 — "CHB-037 P3b: exact exports fit the budget at 4000 px; a browser-free parity warm
fixture"; merges 42db697 (P7, P5b-2) and 0c2233f (P6b; the ticket changelog conflicted, both sides kept).

### What I did
- Scripts (scratchpad `p3b/`): `metal.sh`, `metal2.sh`, `metal3.sh` (parity under the lock), `bench3.sh`; before
  benches on the detached worktree `../p3b-before` (887fe95, removed afterwards).
- `engine-gpu.ts` `planFor(info, node?)` (the halo as a kernel; `bytesPerPixel: 320` when haloed), the field cache
  bound, `dropFields` on non-exact renders; `bench-tests.ts` reports the plan; `digital-tests.ts` plans with the node.

### Why
- An exact export that runs out of memory is no export; the planner owns the budget, so it must see the halo.

### What worked
- GPU timings (M1 Max, Metal, synthetic Gold 200 scan 4000 × 2674; median of 8 rounds after warm-ups; preview at
  scale 0.4 with f32 read-back, export = 16-bit codes over the engine's tile plan):

  | Print | before preview | after preview | before export | after export |
  |---|---|---|---|---|
  | plain (main + lights) | 24.5, 25.0 ms | 22.5, 22.8 ms | 243.3, 236.2 ms | 245.0, 226.9 ms |
  | darkroom (burn under a 2 mm feather, dodge, contrast mask 300 µm) | 120.9, 128.9 ms | 106.6, 109.4 ms | 781.1, 782.2 ms (tiles wrong at borders) | 1647.5, 1653.9 ms (exact: 48 tiles of 512, halo 64) |
  | composite: one exposure layer | 24.2, 22.2 ms | 23.5, 21.5 ms | 245.6, 243.4 ms | 246.1, 242.4 ms |
  | composite: six fused layers | 22.8, 24.6 ms | 24.9, 22.7 ms | 269.3, 277.4 ms | 288.7, 257.1 ms |
  | composite: six + a masked curve | 54.8, 63.7 ms | 60.2, 49.9 ms | 377.2, 388.4 ms | 435.3, 349.1 ms |

  Previews and prints without spatial ops are unchanged (within this machine's noise); the darkroom export doubles —
  the price of being right at tile borders (smaller haloed tiles, the field's whole-frame pass).
- CPU timings: Step 2.

### What didn't work
- See the prose above (fixture on Metal, pitchless reach, two OOMs).

### What I learned
- The planner's default of five live textures per pixel holds for pointwise chains, not for a darkroom DAG.

### What was tricky to build
- Telling a leak from a budget: the second OOM's identical live bytes across code changes pointed at cached state
  (fields), not at a texture lost in a pass.

### What warrants a second pair of eyes
- `bytesPerPixel: 320` is measured on one bench, not derived from the DAG; a document with more live textures per
  tile could still exceed the budget (the pool then reports E_GPU_OOM, as before this phase for whole frames).

### What should be done in the future
- Exact export speed: plan from the DAG's real peak of live textures (planGraph knows the reads), so haloed tiles can
  stay at 1024; build all of an export's fields in one pass over the frame; reuse the haloed renders of neighbours.
- Optional item 6 (masked layers whose mask is pointwise in position fused into the kernel) was not done.

### Code review instructions
- `packages/gpu/src/engine-gpu.ts` `planFor`, `fieldOf` (the bound), `render` (`dropFields`).
- Benches: `BENCH=1 REAL_GPU=1 STUDIO_PORT=5521 STUDIO_KIT_PORT=5522 SHELL_DEMO_PORT=5523 GPU_PARITY_PORT=5524 CI=1
  pnpm exec playwright test --project=gpu-parity bench.spec.ts digital.spec.ts -g bench` (take the GPU lock).

### Technical details
- Logs (scratchpad `p3b/`, not kept): `sw-1..3.log`, `metal-1..3.log`, `bench-*.log`, `bench3-after.log`.
- Final checks on 0c2233f (after merging the integration branch at 2ff1a19): `pnpm typecheck` 0 errors, `pnpm lint`,
  `pnpm gen:check` (26); vitest 137 files, 3379 passed, 19 skipped; goldens 66/66 (every case max |Δ| 0);
  `[gpu-parity]` SwiftShader 54 passed, 2 skipped (BENCH), 6.1 min; Metal 54 passed, 2 skipped, 27.7 s; conformance
  524/524; `tools/wgsl-check` 5 passed.
