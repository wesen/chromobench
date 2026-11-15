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
RelatedFiles: []
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
