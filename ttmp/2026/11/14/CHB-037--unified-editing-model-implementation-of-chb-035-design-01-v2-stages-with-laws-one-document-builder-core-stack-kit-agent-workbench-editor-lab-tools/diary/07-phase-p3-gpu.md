---
Title: Diary — phase P3 gpu
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
    - Path: repo://packages/gpu/kernels/combine.wgsl
      Note: Light-law passes, composite.mix, mask.combine, clarity (commit 384dcb3)
    - Path: repo://packages/gpu/kernels/field.wgsl
      Note: downPad/upsample (commit 384dcb3)
    - Path: repo://packages/gpu/src/engine/dag.ts
      Note: 'isBarrier/readsOf: a texture-free print.combine fuses (commit 384dcb3)'
    - Path: repo://packages/gpu/src/engine/light.ts
      Note: The light law's pass plan and fused form (commit 384dcb3)
    - Path: repo://packages/gpu/src/engine/textures.ts
      Note: 'gaussianBlur: one pass or the padded field (commit 384dcb3)'
    - Path: repo://packages/gpu/src/parity/bench-tests.ts
      Note: Print bench (commit 639d6d9)
    - Path: repo://packages/gpu/src/parity/law-tests.ts
      Note: Law parity against core (commit 384dcb3)
    - Path: repo://packages/gpu/src/parity/reference.ts
      Note: Kernel-isolating reference on core's functions (commit 384dcb3)
    - Path: repo://packages/gpu/src/retouch.ts
      Note: Sequential heal/clone windows (commit 384dcb3)
    - Path: repo://packages/gpu/test/light.test.ts
      Note: Pass plan replayed against lightH (commit 384dcb3)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-14T22:24:28.729379-05:00
WhatFor: ""
WhenToUse: ""
---












# Diary

## Goal

The phase agent's record of phase P3 of CHB-037: the WebGPU engine (`packages/gpu`) on contract 1.0 — the
generalised `print.combine` (terms with per-term amount and mask, density masks, filters, preflash) matching
`lightH`, `composite.mix`, the mask algebra (`mask.linear`, `mask.constant`, `mask.combine`, `mask.invert`,
structured `mask.paint`), coalesced and sequential `heal`/`clone`, `clarity` in mm on the print,
`source.open`'s `umPerPx`, `print.densityMask.gamma`, and the deletion of the GPU code of deleted ops; pointwise
ops fused, barriers as design §29 says, performance kept. Spec: plan `design-doc/01-implementation-plan-and-working-rules.md`
"P3 — the GPU engine on contract 1.0" plus "Amendments after P2a".

## Step 1: Reading the spec, contract 1.0 and today's GPU engine; the plan and the open decisions

The main agent assigned me phase P3. Before writing code I read the working rules (§1–§2), the P3 spec and the
amendments after P0, P1 and P2a, the P2a diary, `CONTRACT-DECISIONS.md` CC-019, the contract's `pixel.ts`,
`stage-laws.ts`, `compile.ts` (the mask fold and the stage chain), `graph.ts` (node slots and the pitches), the
catalogue files, design §22, §23, §29, §36–§37, `docs/HANDOFF.md` §2 and the CHB-034 diary (how the suites run on
this Mac, `REAL_GPU=1`). Then every module of `packages/gpu` that the new ops touch (`engine-gpu.ts`,
`engine/{defs,dag,lower,textures}.ts`, `kernels/{combine,pointwise,retouch,blur,field}.wgsl`, `retouch.ts`,
`spatial.ts`, `physics/core.ts`, the parity page and its tests) and the core functions the GPU imports.

Two facts shaped the plan. First, P2b (core on contract 1.0) has no commits yet, so the reference engine cannot
evaluate any new op: the parity tests must take their f64 reference from the contract's formulas (`lightH`,
`mixPixel`, `maskCombine`) and core's unchanged primitives, and say what remains to check against `RefEngine` once
P2b merges. Second, the spec's "no GPU heal exists today" is not quite right: `retouch.heal` (CHB-022) has a GPU
kernel, but every spot reads the image *before* retouching, while contract 1.0 (P2a decision 7) applies spots in
order, each reading the image as the spots before it left it. The GPU heal must change semantics, not just shape.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all."

Later direction from the owner (verbatim): "unify all of it, we don't have backwards compatibility needs or wrapping
or so, we can do hard cutoff, now is the time to strive for elegance and consistency and all that. nothing is not
worth it if it creates a more robust and simple core"

**Assistant interpretation:** The main agent split CHB-037 into phases and assigned me P3: bring `packages/gpu` to
contract 1.0 (the new and changed ops, the deleted ops gone), with parity against the contract's per-pixel formulas
while core is rewritten in parallel by P2b, keeping fusion and performance, green unit tests, typecheck and the
browser parity suites on SwiftShader and on Metal.

**Inferred user intent:** One GPU engine that computes exactly the one model of the document (the same laws as the
reference engine), fast, with no second code path left from the recipe era.

### What I did
- Read the documents and code listed above.
- `pnpm install --frozen-lockfile --prefer-offline` (no package added).
- Added `packages/gpu/tsconfig.json` (like the contract's) and ran
  `pnpm exec tsc -p packages/gpu/tsconfig.json --noEmit`: 68 error lines, of which 35 in `packages/gpu`
  (`retouch.ts` 29: core's `Spot` lost its fields with `RetouchSpot`; `parity/film-tests.ts` 5: `defaultRecipe`,
  `compile` returns `Compiled`; `parity/retouch-tests.ts` 1) and the rest in files the GPU imports: `packages/core`
  (19, P2b) and `packages/ingest` (14: `DustSpot` gone, and `Encoding` now resolves to the catalogue's encoding
  type, see below).
- `npx vitest run packages/gpu`: 5 files, 48 tests passed (unit tests touch none of the changed ops).
- Created this diary with `docmgr doc add --ticket CHB-037 --doc-type diary --title "Diary — phase P3 gpu"`, renamed
  `06-diary-phase-p3-gpu.md` to `07-phase-p3-gpu.md`; `docmgr doctor --ticket CHB-037` clean.
- Started the baseline `gpu-parity` run on SwiftShader (ports 5531–5534) before changing anything (Step 2).

### Why
- The light law's arithmetic must be the contract's (`lightH`) term by term, and the GPU evaluates it as passes on
  textures, so the exact order of operations (dodges, clamp, burns, density, flashes, filters, preflash, one log)
  had to be read from `pixel.ts`, not from the design's summary formula.

### What worked
- The contract's node slots make every image a term reads an input of `print.combine` (`inputs = [main x, …slot
  ids in catalogue order]`), so the GPU's planner (`engine/dag.ts`) keeps its rule "a barrier materialises its
  inputs" unchanged.

### What didn't work
- N/A (reading only).

### What I learned
- `packages/contract/src/index.ts` exports two types named `Encoding`: the catalogue's op encoding
  (`registry.ts`: `'stage' | 'linear' | 'oklab'`) shadows the source transfer encoding (`source.ts`:
  `'linear' | 'srgb' | 'gamma22'`), which breaks `packages/ingest/src/decode/{encoding,registry}.ts` (14 errors).
  Not a GPU matter; reported to the main agent (a contract fix: rename one of them).
- The darkroom's printer lights are now a `filter` layer, so the most common print (main exposure plus lights)
  compiles to a `print.combine` with one unmasked filter. Today `print.lights` is one fused pointwise op; a barrier
  there would cut the source-to-display program in two and cost a materialised texture plus three passes on every
  print. A `print.combine` whose terms need no texture (no term images other than uniform flashes, no density masks,
  no masks at all) is a pointwise function of x and must lower into the pointwise kernel.
- Every new op gets its pitch from `ImageInfo`: `source.open` sets `umPerPx.film`, `print.expose` sets
  `umPerPx.paper = film × magnification`, and every other op copies its receiver's. Masks are built on the source
  cut (`geom`), so they carry the film pitch only; the compiler converts a mask's feather to document px.

### What was tricky to build
- N/A (no code yet). The tricky parts ahead: sequential heal spots on a downscaled grid; a fused light op that is
  exactly `lightH` when it applies; clarity's large σ (10 mm at 48 µm/px is σ ≈ 208 document px).

### What warrants a second pair of eyes
- The decisions below that the spec and the contract leave open (heal in a log domain, the clarity formula) must be
  mirrored by P2b in core, or parity will fail after the merge.

### What should be done in the future
- Contract: rename one of the two exported `Encoding` types (ingest breaks on it).

### Code review instructions
- Nothing to review yet.

### Technical details

Plan (decisions made here; the code follows them):

1. **Op set.** `GPU_OPS` drops `retouch.heal`, `print.lights`, `mask.gradient`, `mask.and`, `mask.or`, `mask.not`
   and gains `heal`, `clone`, `clarity`, `composite.mix`, `mask.linear`, `mask.constant`, `mask.combine`,
   `mask.invert`. Their WGSL and lowering go (combine modes MIN, MAX; pointwise op MASK_NOT becomes MASK_INVERT).
2. **print.combine, barrier form** (`kernels/combine.wgsl`, passes on output-grid textures, per `lightH`):
   `H = w_main·m·10^x`; each dodge `H −= a·m·r·10^x_i`; then (clamped at 0) each burn `H += a·m·r·10^x_i`; each
   density `H ·= 10^(−a·m·d)`; each flash `H += a·m·r·10^x_flash` (uniform, x from core's `flashExposure`); each
   filter `H ·= 10^(a·m·logH)`; each preflash `H += a·m·φ`; `x = log10 max(H, 1e-8)`. r = t_i / t_main in
   normalised mode (the main print.expose is the receiver), else 1.
3. **print.combine, pointwise form.** When no term reads a texture (no burns, dodges or density masks; flashes are
   uniform) and nothing is masked, the node lowers to one pointwise op `LIGHT`:
   `x' = log10 max(T·(w_main·10^x + E_flash) + E_pre, 1e-8)` with per-channel constants, fused with its neighbours.
4. **composite.mix** (barrier, one pass): `out = k = 1 ? top : back + k·(top − back)`, k = amount·m, exact at 0 and
   1. Normal blend only (the contract has no other); a pointwise top could fuse later (P8).
5. **Masks.** `mask.linear`, `mask.ellipse`, `mask.constant` generators and `mask.luminance`, `mask.invert` stay
   pointwise; `mask.combine` is one combine pass (`maskCombine`); `mask.paint` rasterises the structured strokes
   with core's `paintMask` (no JSON); `mask.feather` unchanged.
6. **heal / clone** (sequential): spot i's patch reads the image after spots 0…i−1. The output-grid composite already
   applies spots in order, so only each spot's *source windows* (and, for heal, the target's ring) must be the
   image after the earlier spots: a window is the receiver at full resolution over the box, with every earlier spot
   whose target meets the box composited onto it (recursively, memoised). Independent spots (the dust case) cost
   what they cost today.
7. **Heal in a log domain.** The seam correction is harmonic in the domain's log encoding: in print-xyz the log of
   the values (today's multiplicative gain), in scanner-density the values themselves (density is a log already:
   an additive density offset, the transmittance gain ingest's dust heal applies). P2b must do the same in core.
8. **clarity**: on the print (print-xyz, linear), σ = radius_mm·1000 / umPerPx.paper document px (the radius is the
   Gaussian σ, as for the density mask). With Y_b the low-pass of Y, t = clamp(∛Y_b, 0, 1) and w = 4t(1 − t):
   `out = XYZ · (max(Y, ε) / max(Y_b, ε))^(s·w)`. Local contrast in log luminance, midtone-weighted, hue kept.
   Exactly the identity at s = 0 (which compiles to no node). P2b must implement this formula in core.

## Step 2: The baseline does not load; the engine on contract 1.0 (light law, mix, masks, heal, clarity)

The baseline `gpu-parity` run (before any change) could not measure anything: the parity page did not load, because
`src/parity/film-tests.ts` imports `defaultRecipe`, which contract 1.0 deleted, so every test timed out in its
`beforeEach` after 180 s. I stopped it after five timeouts. A "before" picture of the suite therefore exists only for
the pre-contract-1.0 tree (CHB-034: green on SwiftShader and on Metal); timings before are taken on that tree (Step 4).

Then the engine, in one pass because the pieces share the planner: the op set of Step 1, the light law as a pass plan
in a new pure module (`src/engine/light.ts`, unit-testable without a device), the planner made node-aware
(`isBarrier`, `readsOf` in `engine/dag.ts`), the new combine modes, the fused `LIGHT` op, heal/clone with sequential
windows, clarity, and blurs of any σ as one Gaussian.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Implement P3 on the GPU per the Step 1 plan.

**Inferred user intent:** The GPU engine computes the document's laws exactly as the reference does, and stays fast.

**Commit (code):** 384dcb3 (committed with Step 3, after the merge of P2b)

### What I did
- `src/engine/defs.ts`: the new `GPU_OPS`, `BARRIER_OPS`, `GENERATOR_OPS` (`mask.linear`, `mask.ellipse`,
  `mask.paint`, `mask.constant`); the old `COMBINE` mode table and the pitch default `DEFAULT_UM_PER_PX` removed.
- `src/engine/light.ts` (new): `combineArgs`, `combineIsPointwise`, `lightPointwise` (gain and offset per channel, or
  the exact additive form `x + Σ a·logH + log10 w_main` when there is no flash or preflash), `lightPasses` (the pass
  plan in lightH's order), `replayPasses` (the plan in f64, for the unit test), `MODE`, `FLAG`.
- `kernels/combine.wgsl` rewritten: modes MAIN, TERM, LOG, HOLD, UNIFORM, FILTER (light law), TRANSMITTANCE, DENSITY
  (density mask), COPY, MIX (composite.mix, exact at k = 0 and 1), MASK (mask.combine), CLARITY; flags CLAMP and MASK.
  mask.and/or (MIN/MAX) and the contract-0.3 modes are gone.
- `kernels/pointwise.wgsl` and `src/chain/program.ts`: op 4 is `LIGHT` (was `ADD`, print.lights), 13 `MASK_LINEAR`,
  15 `MASK_INVERT`, new 17 `MASK_CONSTANT`. `src/engine/lower.ts` lowers them; `lightContext` gives the plan the
  seconds ratio and a flash's x (core's `flashExposure`).
- `src/engine/dag.ts`: `isBarrier(n)` (print.combine is a barrier only when a term reads a texture), `readsOf(n)`
  (generators read nothing; print.combine never reads its flash terms' images, which are uniform).
- `src/engine-gpu.ts` `execute`: print.combine runs the pass plan; composite.mix, mask.combine, clarity, heal, clone
  added; print.densityMask reads `gamma`; mask.paint rasterises the structured strokes with core's `paintMask`.
- `src/retouch.ts` rewritten (`Retouch`, `SpotRun`, `priorSpots`): spot i's source and ring windows are the image
  after spots 0…i−1 (memoised, at most two per spot), the grid composite applies the spots in order;
  `kernels/retouch.wgsl` adds the additive seam for the density domain.
- `src/engine/textures.ts` `gaussianBlur`: one pass up to σ = 32 px, beyond that on a field downsampled by
  s = ⌈σ/32⌉ (box average, one compensated blur pass, read back bilinearly); `kernels/field.wgsl` gains `upsample`
  (bilinear with `textureLoad`, so no `float32-filterable` and no 8-bit filter weights on real GPUs).
- Parity page: `src/parity/law-tests.ts` (new: `law:combine`, `law:combine-fused`, `law:composite`, `law:masks`,
  `law:heal`, `law:clarity`, `law:core`), `src/parity/reference.ts` (new), `test/browser/law.spec.ts` (new, 8 tests);
  `retouch-tests.ts` / `retouch.spec.ts` deleted (replaced by `law:heal`); `chain:masks` moved into `law:combine`; the
  chain tests' graphs lose `print.lights`; `film:recipe` compiles a format-3 document; `engine:taps` taps a fused
  print.combine instead of print.lights.

### Why
- The common print (main exposure plus printer lights) compiles to a print.combine with one unmasked filter; as a
  barrier it would cut the fused source-to-display program in two on every print (Step 1). Fused, it costs one
  pointwise op, as print.lights did.
- Sequential spots cannot be computed from one window of the receiver per spot; but only the *windows* need the
  earlier spots, because the grid composite already applies spots in order. Memoising "the image over box B after
  spots 0…k−1" keeps the recursion linear (spot k always asks for its own windows at k).

### What worked
- First law-spec run on SwiftShader (package config, port 5534): paper log H of a print.combine with every darkroom
  kind within 3.0e-7 of lightH evaluated on the same inputs; masks within 2.7e-6; composite.mix bit-exact at
  coverage 0 and 1 (all four cases 0 differing values); the coalesced heal run identical (max 0) to the layers kept
  apart; tiles equal to one pass (0); the scan heal in density within 2.9e-7.

### What didn't work
- `law:combine` preview against core *exact*: 7.3e-3 (bound 2e-3). Wrong reference: the preview reads the 33³ pd table,
  so it is compared with RefEngine *tabulated* (as `chain:masks` did); then 3.7e-7.
- `law:heal` and `law:clarity` against an end-to-end reference: max rel 1.5e-4 (bound 1e-4). That is the print chain's
  own f32 error (6e-5 absolute), not the kernel's: the kernel is now also compared on the GPU's own inputs
  (`kernel`: 5.4e-7 for heal, 3.7e-7 for clarity), the chain keeps a 5e-4 bound.
- `law:masks` `invertTwice` came back `NaN`: my diff read the mask readback with 4 channels (a mask has 1).
- Clarity at radius 3 mm (σ = 94 px on a 96 × 64 frame) through the GPU's existing multi-pass blur: **28 %** off the
  f64 Gaussian near the edge (`worst: x 6, y 25`). Several Gaussians with clamp-to-edge are not one Gaussian with
  clamp-to-edge: every pass re-extends the edge. This also affected `mask.feather` and `print.densityMask` above
  σ = 32 px (a contrast mask of 300 µm at 6 µm/px is σ = 50 px: two passes). The field path (one blur) is 0.75 %
  off on that extreme frame (σ larger than the frame; the edge rules differ by one block) and is now the only path
  above 32 px.
- With `textureSampleLevel` (the existing `sampleField`) the read-back needed `float32-filterable` and would get
  8-bit weights on Metal; replaced by `upsample` with `textureLoad` (same error on SwiftShader, 0.75 %).

### What I learned
- The density mask's and the feather's large-σ results changed with the blur fix: they are now closer to core.

### What was tricky to build
- Exactness of composite.mix at both ends: `back + k·(top − back)` is not `top` at k = 1 in f32, and the mask's own
  value can be exactly 1; the kernel selects `top` at k = 1 and `back` at k = 0 (mixPixel's rule), which the spec
  checks bit for bit.
- The fused form's floor: lightH floors H at 1e-8 *after* everything, so even the additive form must clamp x at −8
  (print.lights did not).

### What warrants a second pair of eyes
- `src/retouch.ts` `SpotRun.after`: a window that no earlier spot touches is the receiver's render itself and is
  memoised and released at the end of the call; one that is touched is a composite of the earlier spots onto it.
- `readsOf` for print.combine: a texture the plan reads but `readsOf` omits would be released or never computed.

### What should be done in the future
- Export tiling with spatial ops: `GpuEngine.planFor` declares no kernels, so a tiled export of a print with a density
  mask, a feather or clarity computes them per tile (the density mask's reference minimum per tile too). Pre-existing
  for the density mask; clarity's σ ≈ 200 px makes it visible. Needs halos or global fields (tiles.ts has both).

### Code review instructions
- `src/engine/light.ts`, then `kernels/combine.wgsl`, `src/engine/dag.ts`, `src/engine-gpu.ts` `execute`,
  `src/retouch.ts`, `src/engine/textures.ts` `gaussianBlur`.

### Technical details
- Pass count of the barrier print.combine: 2 + dodges + burns + density masks + flashes + filters + preflashes.

## Step 3: P2b merged; the GPU follows core's definitions; parity against core end to end

While the law spec ran, the main agent reported that P2b (core, mock, conformance on contract 1.0) is merged into the
integration branch at 1c8eafe, with notes: mirror lightH; spots and strokes are structured; `healCoefficients(…,
encoding)` takes `'log'` for scanner density and spots apply in order; `filmUmPerPx(info)` and `densityMaskSigma`
throw without a pitch; clarity is in core `print/clarity.ts` with a different formula from mine; `gradientAt` is
`linearAt`; the contract's op encoding type is `OpEncoding`. I merged (`git stash -u`, `git merge
task/chb-037-unified-model` → cf258b5, `git stash pop`, no conflicts) and moved the GPU onto core's definitions:
where Step 1 had to decide for core, core has now decided, and the reference engine is the definition.

Two of my Step 1 decisions survive unchanged in core (sequential spots; the additive seam in density). Clarity does
not: core's is `L = (Y/Y_w)^⅓`, weight `1 − (2L − 1)²` on the pixel's own lightness, `L′ = max(0, L + s·w·(L − L̄))`,
`out = XYZ·(L′/L)³`. The WGSL now computes exactly that, with `Y_w` from core's `whiteAt` on the node's chain.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The coordinator's mid-task message: merge the integration branch, run parity against
core on contract 1.0, record the merge.

**Inferred user intent:** One definition of every op (core's), the GPU proven against it, not against a GPU-side copy.

**Commit (code):** 384dcb3 — "CHB-037 P3: the GPU engine on contract 1.0" (merge cf258b5)

### What I did
- Merge as above; `pnpm install --frozen-lockfile --prefer-offline`; gpu typecheck: 4 errors, 2 in gpu
  (`film.ts` `filmUmPerPx(info, w, h)` now takes one argument; `reference.ts` `gradientAt`), 2 in ingest (`DustSpot`, P5b).
- No pitch defaults anywhere in the GPU: `DEFAULT_UM_PER_PX` and my interim `PATTERN_UM_PER_PX` are gone; the density
  mask uses core's `densityMaskSigma`, clarity core's `claritySigma` (both throw without a pitch, as core does),
  grain `filmUmPerPx` of the grain node (`fillGrain` takes frame px per output px), and `film.ts` asks for the pitch
  only in the ops with a physical size (couple, halation, grain): conformance's pointwise film ops on pitchless
  patterns failed with `E_EVAL: film ops need the film pitch (ImageInfo.umPerPx.film)` (9 cases: capture.expose,
  film.develop, source.xyz × shape, region, determinism) until then.
- The seconds ratio is core's `combineRatio` (my `termRatio` deleted), the heal coefficients `healCoefficients(…, 3,
  'log' | 'linear')` (my exp-wrapping sampler deleted), the feather σ core's `featherSigma`.
- `src/parity/reference.ts` rewritten on core's functions (`retouch`, `clarity`, `linearAt`, `maskDensityPolar`, …):
  `EngineReference` (every node from an engine: RefEngine exact, or tabulated for the preview) and `LawReference`
  (the law ops in f64 on the GPU's own inputs: the kernels alone). `law:core` compares whole documents at display
  with RefEngine; it no longer waits for P2b.
- Parity sources carry their pitch (`source.open` `umPerPx` is required): 6 µm/px for scans, 36 mm over the long side
  for camera files (the old film-op default, now explicit).
- Blur at the field's edge (below); a `law:blur` test; a BENCH-gated timing spec (Step 4).

### Why
- A GPU-side copy of a definition is exactly what the design removes ("one copy of every law").

### What worked
- `law:core` (RefEngine exact, display, 8-bit): every-kind darkroom max8bit 1 (maxAbs 3.2e-5), fused lights 1
  (3.1e-5), heal + clarity at 0.7 on the print 1 (1.4e-4).
- Root config, SwiftShader: `STUDIO_PORT=5531 STUDIO_KIT_PORT=5532 SHELL_DEMO_PORT=5533 GPU_PARITY_PORT=5534 CI=1 pnpm
  test:browser --project gpu-parity` → **47 passed, 1 skipped** (the BENCH-gated timing), 3.6 min; conformance
  **340/340** (P2b's generator).
- `npx vitest run packages/gpu` → 6 files, 56 tests (new `test/light.test.ts`: the pass plan replayed in f64 equals
  lightH on 400 random stacks to 1e-12; the fused form equals lightH; the planner's barrier and read rules; the field
  compensation; `priorSpots`). Typecheck of `packages/gpu/tsconfig.json`: no errors in packages/gpu (2 remain in
  packages/ingest: `DustSpot`, P5b). `pnpm lint` ok; `node tools/gen-docs/main.ts --contract-only --check` ok.

### What didn't work
- With core's clarity the field path was 3.4 % off on the small frame and **3.7 % on a 480 × 320 frame** (σ 100):
  `law:blur` (a feathered ellipse mask) located it at the frame edge (y = 0): the field clamped at the field's edge
  (the mean of the first s rows), core at the frame's (row 0). Fix: `field.wgsl` `downPad` builds the field over the
  image *extended by clamping*, padded by the blur's reach (⌈3σ_f⌉ + 1 cells), so the field's blur has core's edge
  rule; `upsample` reads it back with the offset. After: blur within 2.1e-4 (σ 40) and 1.0e-4 (σ 100) of
  `gaussianBlur1`, clarity 1.3e-4 (small frame) and 7.0e-4 (large frame, the cube of L′/L triples the low-pass's
  error).
- First full run after the merge: `2 failed, 44 passed (7.3m)` — the clarity bound and the 9 conformance cases above.

### What I learned
- The repair semantics needed no negotiation: P2a's decision 7 and the ingest dust heal's density offset determine
  them; clarity was the only open formula, and core's is in lightness, not log luminance.

### What was tricky to build
- Clamp-to-edge for a downsampled blur: the box average of the clamp-extended image (every block counts s² pixels,
  read with clamped coordinates) is what makes "blur the field" equal "blur the image" at the edge too; padding
  must cover the blur's taps so the field's own edge never matters.

### What warrants a second pair of eyes
- `kernels/field.wgsl` `downPad` / `upsample` offsets and `engine/textures.ts` `gaussianBlur`'s pad.
- The density mask and the feather above σ = 32 px changed from several clamped passes to the field path: closer to
  core, but a different code path for every print with a wide contrast mask.

### What should be done in the future
- `output.frame` has no GPU implementation (not in the P3 spec): the GPU engine cannot evaluate the `display` cut,
  only `output.display` under it. Core implements it (`print/geometry.ts`). On the GPU it is a geometric barrier whose
  input grid is the crop's footprint, a planner change (today every texture shares the target's grid). P5b must keep
  a host wrapper or a later phase must add it.

### Code review instructions
- `git diff cf258b5 384dcb3 -- packages/gpu`; start at `src/engine/light.ts`, `kernels/combine.wgsl`, `src/retouch.ts`,
  `src/engine/textures.ts`, `kernels/field.wgsl`; tests `src/parity/law-tests.ts`, `test/browser/law.spec.ts`,
  `test/light.test.ts`.
- `npx vitest run packages/gpu`; the root-config command above.

### Technical details
- Law spec numbers (SwiftShader): combine export 3.0e-7, preview vs tabulated 3.7e-7, kernel 2.9e-7, masks ≤ 2.7e-6,
  density mask 1.0e-7 (max 0.47 D), half scale 1.7e-2 (spatial ops on the half grid); fused 2.7e-7 / 6.9e-7 (general /
  additive), fused vs barrier 1.8e-7; composite between 1.3e-6, document kernel rel 2.6e-7; heal kernel rel 5.4e-7,
  coalesced vs apart 0, old (parallel) semantics 3.3e-2 off, tiles 0, half rel 3.9e-7, scan heal 2.9e-7; clarity
  kernels 8.6e-7 (σ 3), 7.2e-7 (σ 6, softening), 1.3e-4 (σ 94), 7.0e-4 (σ 100, 480 × 320).

## Step 4: Metal (REAL_GPU=1), timings before and after, the studio-level suite

On the M1 Max's own GPU the whole `gpu-parity` project passes as on SwiftShader. Timings of a representative print
come from a new BENCH-gated parity test (`bench:print`), run on this tree and, in contract 0.4's graph form, on a
temporary detached worktree of the integration branch before contract 1.0 (4f22a4a, the first parent of the P2a
merge; removed afterwards). The plain print costs what it cost; the darkroom print's export is 15 % faster, because
the 300 µm contrast mask (σ = 50 px) now blurs on a field instead of in three full-resolution passes.

The `[chromium-webgpu]` project (the studio's e2e specs) cannot show anything yet: the studio does not load on
contract 1.0 (`packages/studio-kit/src/model/controls.ts` imports `argPath`, which contract 1.0 deleted), so 42 of 51
fail at load; the 9 that pass are the WGSL check and studio-independent pages. That is P4/P5b's breakage, not P3's.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Acceptance: the browser projects on SwiftShader and once on the real GPU under the GPU
lock; before/after timings.

**Inferred user intent:** Proof that the GPU engine is right on the hardware the photographer uses, and no slower.

**Commit (code):** 639d6d9 — "CHB-037 P3: the print bench exports tile by tile (the engine's plan), as the export
runner does"

### What I did
- GPU lock: `mkdir <scratchpad>/gpu.lock` (retried until it succeeded), `P3` in `owner`, `rm -rf` after each batch.
- `REAL_GPU=1 STUDIO_PORT=5531 STUDIO_KIT_PORT=5532 SHELL_DEMO_PORT=5533 GPU_PARITY_PORT=5534 CI=1 pnpm test:browser
  --project gpu-parity` on 384dcb3.
- `BENCH=1 REAL_GPU=1 … pnpm exec playwright test --project=gpu-parity bench.spec.ts` on this tree and on the
  before worktree (`git worktree add --detach ../p3-before 130e104^1`, the same bench written in contract 0.4's form:
  `print.lights`, the old `print.combine` with `exposures/masks/modes/densityMasks`, `mask.gradient`, density mask
  `amount`; uncommitted there; `git worktree remove --force ../p3-before` afterwards). Twice each, alternating.
- `STUDIO_PORT=5531 … CI=1 pnpm test:browser --project chromium-webgpu` on SwiftShader.

### Why
- Timings must compare the same print through both engines' code, so the before bench builds the old graph of the
  same document (same terms, same masks, the same feather in pixels: 2 mm at 48 µm/px = 41.7 px).

### What worked
- Metal: **47 passed, 1 skipped** (BENCH), 17.8 s; conformance 340/340; every law test within its SwiftShader bound.
- Timings (M1 Max, Metal; synthetic Gold 200 scan 4000 × 2674; median of 8 rounds after 2 warm-up, each round a new
  graph (the lights change), two runs per tree):

  | Print | Path | before (contract 0.4) | after (contract 1.0) |
  |---|---|---|---|
  | plain (main + lights) | preview, scale 0.4 (1600 × 1070, f32 read back) | 21.2, 20.5 ms | 21.9, 22.5 ms |
  | plain | export, 16-bit, tile by tile | 239.0, 245.4 ms | 234.8, 233.5 ms |
  | darkroom (+ burn under a 2 mm feathered gradient, dodge under an ellipse, contrast mask 300 µm) | preview | 109.3, 105.5 ms | 103.8, 105.1 ms |
  | darkroom | export | 904.7, 917.6 ms | 777.6, 762.3 ms |

### What didn't work
- The first bench runs: `Error: Project(s) "packages/gpu/test/browser/bench.spec.ts" not found` (`--project
  gpu-parity bench.spec.ts` takes the file as a second project name; `--project=gpu-parity` fixes it).
- Then on both trees: `E_GPU_OOM: pack16.out: 85568000 bytes do not fit the budget (457598736 of 536870912 live)` —
  one whole-frame `evaluateU16` at 4000 × 2674; the bench now exports through `planFor`'s tiles, as the export runner.

### What I learned
- The plain preview is within noise of before (+1 ms of 21): the fused `LIGHT` op replaced `print.lights`'s add in the
  same dispatch, as intended; nothing else in that chain changed.

### What was tricky to build
- A fair "before": contract 1.0's Graph refuses the old ops and arguments, so the old graph can only be built on the
  old tree; the bench file was written for both trees with the same document semantics.

### What warrants a second pair of eyes
- The darkroom export gain comes from a changed blur path (Step 3), not from the law: check it against your own
  expectations of the contrast mask's look on a real negative (it is closer to core by construction).

### What should be done in the future
- `[chromium-webgpu]` after P4/P5b: the studio specs that print on the GPU engine (`studio-decoders`, `studio-photo`,
  `studio-real` gpu, `studio.spec` "WebGPU presenter pipeline") are the first end-to-end use of the new ops; they need
  the display cut, i.e. `output.frame` (no GPU implementation, Step 3) through a host wrapper or the engine.

### Code review instructions
- `packages/gpu/src/parity/bench-tests.ts`, `packages/gpu/test/browser/bench.spec.ts` (skipped without `BENCH=1`).

### Technical details
- Logs (scratchpad, not kept): `p3-metal-1.log`, `p3-bench-chb037-p3.log`, `p3-bench-p3-before.log`, `p3-webgpu-1.log`.
