---
Title: Diary — phase P2b reference engine
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
    - Path: repo://packages/conformance/src/generate.ts
      Note: Term ops skipped, pitched receivers (commit 97d1cb6)
    - Path: repo://packages/conformance/src/semantics.ts
      Note: Semantic cases for the new catalogue (commit 97d1cb6)
    - Path: repo://packages/contract/src/pixel.ts
      Note: 'lightH, mixPixel, maskCombine: the formulas the engines call'
    - Path: repo://packages/core/src/ops/ops.ts
      Note: print.combine via lightH, heal/clone, clarity, composite.mix, mask algebra, output.frame (commit 97d1cb6)
    - Path: repo://packages/core/src/print/balance.ts
      Note: bakeLights on documents (commit 97d1cb6)
    - Path: repo://packages/core/src/print/clarity.ts
      Note: clarity in mm on the print (commit 97d1cb6)
    - Path: repo://packages/core/src/print/geometry.ts
      Note: output.frame in core (commit 97d1cb6)
    - Path: repo://packages/core/src/print/retouch.ts
      Note: Sequential heal/clone spots, seam encoding linear|log (commit 97d1cb6)
    - Path: repo://packages/engine-mock/src/ops.ts
      Note: Mock op set on contract 1.0 (commit 97d1cb6)
    - Path: repo://tools/goldens/engine.ts
      Note: 'Golden engine: RefEngine alone, compiler cuts (commit 97d1cb6)'
    - Path: repo://tools/goldens/translate.ts
      Note: One-off recipe to document translation (commit 97d1cb6)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-14T22:29:43.66915-05:00
WhatFor: ""
WhenToUse: ""
---













# Diary

## Goal

The phase agent's record of phase P2b of CHB-037: bring the f64 reference engine (`packages/core`), the mock engine
(`packages/engine-mock`) and the conformance suite (`packages/conformance`) to contract 1.0, translate P0's 58 golden
recipes into format-3 documents, render the two cases P0 could not (dust heal, clarity), and make
`node tools/goldens/render.ts --check` pass with the reference engine alone. Spec: plan
`design-doc/01-implementation-plan-and-working-rules.md` §6 "P2b" plus the amendments after P0, P1 and P2a.

## Step 1: Reading the spec, the contract and the oracle; the decisions the spec leaves open

The main agent assigned me phase P2b. I read the working rules, the P2b spec and the three amendments, the P2a diary
and CC-019, the new contract (`document.ts`, `stage-laws.ts`, `compile.ts`, `pixel.ts`, the catalogue in
`catalog/*.ts`, `graph.ts`), the goldens' README, code and stored recipes, the P0 diary, design §8, §20–29 and §37,
and every core, mock and conformance source that the contract change broke. The contract already compiles every
document into the new op set (one `print.combine` with structured terms, `composite.mix`, `heal`/`clone`, `clarity`,
the mask algebra, `output.frame` at the end of the display chain); the engines implement none of it yet.

The spec fixes what to implement; it leaves open how heal behaves on a scan, what clarity computes, what an image
without a pitch means, and how the goldens are stored once the recipe model is gone. The decisions are under
Technical details; the code follows them.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all."

Later direction from the owner (verbatim): "unify all of it, we don't have backwards compatibility needs or wrapping
or so, we can do hard cutoff, now is the time to strive for elegance and consistency and all that. nothing is not
worth it if it creates a more robust and simple core"

**Assistant interpretation:** The main agent split CHB-037 into phases and assigned me P2b: implement every new or
changed op of contract 1.0 in core and the mock, delete what the contract deleted, update the conformance generator,
translate the goldens and prove the reference engine reproduces them (except the changes the plan names), with no
compatibility code.

**Inferred user intent:** A reference engine that is the f64 truth for the one editing model, so the GPU phase (P3)
and the studio phases can be checked against it, and the cut-off is proven not to change the darkroom's pictures.

### What I did
- Read the plan (§1–2, §6 P2b, the three amendments), `diary/05-phase-p2a-contract.md`, CC-019 in
  `packages/contract/CONTRACT-DECISIONS.md`, the contract sources named above, `tools/goldens/*`, the P0 diary, design
  §8, §20–29, §37, and core's `engine-ref.ts`, `ops/ops.ts`, `ops/film.ts`, `print/{exposures,retouch,masks,
  densityMask,balance}.ts`, the engine-mock and conformance sources.
- Dumped every golden recipe's masks (node closures), exposures, density masks, retouch and dust spots, finishing
  values (a throw-away Python one-liner) to know exactly what the translation must cover.
- Read Editor lab's clarity (`editor-lab/src/engine.js` `unsharp(…, midtones)`, from the CHB-035 archive, unzipped in
  the scratchpad) for the algorithm the design names.
- `pnpm install --frozen-lockfile --prefer-offline`; added `tsconfig.json` to core, engine-mock and conformance (as
  the contract's) so each typechecks alone.

### Why
- The light law must equal today's darkroom and the goldens are the proof, so I needed both the old chain's order of
  operations and the exact shape of every stored recipe before writing the translation.

### What worked
- The compiler already emits `output.frame` as the display cut's node, so moving it into core is an op
  implementation, not a compiler change.

### What didn't work
- `pnpm exec tsc -p packages/core/tsconfig.json --noEmit` also reports errors in `packages/ingest` (imported by core
  for `readTiffCodes`): `packages/ingest/src/decode/encoding.ts(10,10): error TS2367: This comparison appears to be
  unintentional because the types 'Encoding' and '"srgb"' have no overlap.` and `Module '"@chromobench/contract"' has
  no exported member 'DustSpot'`. Cause: the contract's index re-exports `type Encoding` from `registry.ts` (the op
  encoding 'stage' | 'linear' | 'oklab') by name, which shadows `source.ts`'s transfer `Encoding` ('linear' | 'srgb'
  | 'gamma22') that `export *` would have exported. That is a contract (P2a) defect and ingest is not mine; recorded
  under Future.

### What I learned
- Camera files had two film pitches in P0: the film ops used 36 mm over the long side (375 µm/px) while density masks
  used `DEFAULT_FILM_UM_PER_PX` = 6 µm/px. Contract 1.0 has one pitch per document, so `cam-dm-unsharp` cannot keep its
  picture with its recorded 30 µm radius (Step 3).

### What was tricky to build
- N/A (reading and deciding).

### What warrants a second pair of eyes
- Decisions 1–4 below are physics choices the design states only in one line ("the stage's encoding", "linear
  low-pass, OkLab L detail", "nothing has a hidden default").

### What should be done in the future
- P2a/main agent: rename the contract's op `Encoding` (registry.ts) to `OpEncoding` (or stop re-exporting it under the
  source type's name), so `@chromobench/contract`'s `Encoding` is the transfer encoding again; packages/ingest
  typechecks then except its `DustSpot` import (P5b).

### Code review instructions
- Nothing to review yet; the decisions are listed below.

### Technical details

Decisions (made here; Steps 2–5 implement them):

1. **Heal's seam follows the stage's encoding.** On the print (print-xyz, linear light) the seam correction is
   multiplicative, as CHB-022 made it (`patch = S·exp(u)`, boundary values `log T − log S`). On the scan the image is
   scanner density, already a log (`d = −log10 T`), so the same seam is additive there (`patch = S + u`, boundary
   values `T − S`): the multiplicative heal of the transmittance, written in density. `retouch(…, mode, encoding)`
   takes `'linear' | 'log'`; the op picks `'log'` for a scanner-density receiver.
2. **Spots apply in order, each reading the image as the spots before it left it** (CC-019): per spot, every read
   (the seam rings and the source disc) is computed from the current image into a patch buffer, then written. For
   non-overlapping spots this is bit-identical to P0's "every source read from the receiver" (the retouch goldens
   confirm it: max |Δ| 0).
3. **clarity** (radius in mm on the print, σ = radius): `Ȳ = G_σ * Y` (linear low-pass of the luminance),
   `L = (Y/Y_w)^⅓` (the OkLab L of a neutral of that luminance), midtone weight `w = max(0, 1 − (2L − 1)²)` (Editor
   lab's), `L′ = max(0, L + s·w·(L − L̄))`, `out = XYZ·(L′/L)³` (chromaticity kept), `σ_px = radius_mm·1000 /
   umPerPx.paper`. Y_w is the white of print-xyz at that point (`whiteAt`: the view.adapt target).
4. **No default pitch.** `filmUmPerPx(info)`, `densityMaskSigma` and `claritySigma` fail with `E_EVAL` when the
   image lacks `ImageInfo.umPerPx.film` / `.paper` (core and the mock alike); `DEFAULT_FILM_UM_PER_PX` and
   `DEFAULT_FORMAT_MM` are deleted. A density mask of gamma 0 and a clarity of strength 0 read no pitch.
5. **output.frame in core**: `print/geometry.ts` (`orientPixels`, `cropPixels`, `frameImage`), the contract's
   `straighten` for an angle; full resolution like every geometric op.
6. **Bake works on documents**: `bakeLights(doc, data, conv, lightsId = 'lights')` returns the fit and three values
   mutations (`main.params.filtration`, `main.params.time_s` in real mode, `lights.params.logH`); `chainOptionsOf(doc)`
   reads the media and the main exposure (links must be resolved). `bakeRecipe` is deleted.
7. **Goldens**: each case keeps P0's `recipe.json` (provenance of the pictures) and gains `document.json`, written by
   the one-off `tools/goldens/translate.ts`; `cases.ts` (builders on the deleted recipe model and the studio's mask
   editor and first print) is deleted; `index.json` becomes format `chromobench-goldens/2` (cases list `document`,
   `recipe`, `cuts`, `ops`; no `skipped`). `render.ts --only id` renders a case from its document.
8. **Retouch and dust become groups of one-spot layers** (design §23: "in a group"): print group `retouch` with one
   heal or clone layer per spot (natural id order, as P0 composited them; a disabled spot is a disabled layer), scan
   group `dust` with one heal layer per speck. Adjacent heals coalesce into one node, so this also exercises grouping
   and coalescing.
9. **Dust sources**: the recipe's `scan.dust.spots` had none (P0's `scan.heal` was never implemented); the
   translation uses the retouch case's sources beside each speck (24.5, 31.5), (61.5, 56.5), (84.5, 15.5), r 2.5.
10. **Dependencies**: core now imports `@chromobench/values` (Coll, Mutation) and declares it; the lockfile gains the
    three lines of that workspace link (`pnpm install --no-frozen-lockfile`).

## Step 2: The reference engine, the mock and the conformance suite on contract 1.0

I implemented the new op set in core first, because the goldens (Step 3) need a working reference engine and core's
tests are the fastest feedback, then mirrored it in the mock and rewrote the conformance generator's assumptions. The
contract does all the compiling; the engines only evaluate nodes, so the work was op implementations, deletions,
and the tests that built recipes.

`print.combine` is now one call of the contract's `lightH` per pixel, with the sample's weights filled from the
node's structured args (amount × mask × the normalised-mode seconds ratio), so the formula exists once and the GPU
mirrors the same function. Everything the contract deleted is gone from core with no shim.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Implement every new or changed op in core and the mock, delete what the contract
deleted, update the conformance generator for the new catalogue, keep the three packages' typecheck and tests green.

**Inferred user intent:** One f64 truth per op, with the mock and conformance testing the same catalogue.

**Commit (code):** 97d1cb6 — "CHB-037 P2b: reference engine, mock and conformance on contract 1.0; goldens as format-3
documents"; bde2495 — "CHB-037 P2b: core tests for clarity, output.frame, print-stage layers through compile,
pitches, sampled previews of masked documents"

### What I did
- `packages/core/src/ops/ops.ts`: new `print.combine` (`printCombine`: `lightH` per pixel, flashes from
  `flashExposure`, `combineRatio` for normalised mode, `W_DODGE_EXCEEDS_MAIN` from lightH's clamp flag),
  `print.densityMask` reads `gamma` (gamma 0: zeros, no pitch read), `heal`/`clone` (`repairOp`), `clarity`,
  `composite.mix` (`mixPixel`; a blend other than normal is `E_NOT_IMPLEMENTED`, phase 8), `mask.linear`,
  `mask.constant`, `mask.combine` (`maskCombine`), `mask.invert`, structured `mask.paint`, `output.frame`; removed
  `print.lights`, `print.preflash`, `retouch.heal`, `mask.gradient`, `mask.and`, `mask.or`, `mask.not`.
  `ExposeSettings.magnification` is a number (contract 1.0 always gives it).
- New modules: `print/combine.ts` (`combineRatio`, what is left of `exposures.ts`), `print/clarity.ts`
  (`clarity`, `clarityGain`, `claritySigma`), `print/geometry.ts` (`orientPixels`, `cropPixels`, `frameImage`).
  `print/retouch.ts`: local `Spot` type, `retouch(src, W, H, c, spots, mode, encoding)` sequential, seam encoding
  `'linear' | 'log'`; `parseSpots`/`spotOrder` deleted. `print/masks.ts`: `linearAt` (was `gradientAt`),
  structured `Stroke`, `parseStrokes` deleted. `print/densityMask.ts`: no default pitch, gamma names.
  `ops/film.ts`: `filmUmPerPx(info)` strict, `DEFAULT_FORMAT_MM` deleted. `print/balance.ts`: `chainOptionsOf(doc)`,
  `bakeMutations(fit, mode, lightsId)`, `bakeLights(doc, …)`; `bakeRecipe` deleted. `print/exposures.ts` deleted
  (`compileExposures`, `exposureSeconds`, `combinePixel`, `MAX_PACKS`, `CompiledExposure`): `termSeconds` and
  `lightH` in the contract replace them. `laws/chb010.laws.ts` checks the light law through `lightH`.
- `engine-ref.ts`: node-typed inputs found with the contract's `nodeSlots` (list items' image and mask fields
  included), `GRID_OPS` updated (`composite.mix`, `mask.combine`, `mask.invert` in; the deleted ops out).
- `packages/engine-mock`: the same op set (lightH, mixPixel, maskCombine; naive sequential heal/clone; box-blur
  clarity and density mask in physical units over the pitch); `output.encode` reports `documentSha256`; the
  engine's ctx gains `image(id)` and finds node inputs with `nodeSlots`.
- `packages/conformance`: Term ops are skipped (never nodes); required arguments without defaults are synthesised
  for numbers and enums (`source.open.umPerPx` = `PITCH_UM` 6); `needsPitch(op)` (spatial and no size in px) builds
  the receiver through a fixed chain from `source.open` (`env.pitched(domain)`); semantics rewritten for the light
  law, composite.mix, clone/heal order, the mask algebra, output.frame (scan.flare and scan.density kept); the
  mutants' region and determinism cases moved from `print.lights` to `view.flare`.
- Tests rewritten on documents (`test/doc-helpers.ts`: the M1 engine, `newDocument` with umPerPx 6, `push`,
  `spots`): `retouch.test.ts` (sequential order, additive seam on density, coalesced run = layers apart, scan-stage
  heal), `chb010.exposures.test.ts` (light law per pixel with filters, preflash, amounts, the main mask; flashes;
  mask algebra; a document through compile), `chb010.balance.test.ts` (bake on a document), the sampled-preview,
  film stage 5, one-physics and engine-ref tests; new `layers.test.ts` (clarity, output.frame, composite.mix of a
  masked clarity layer, pitches refused, sampled previews of a masked document). Mock tests on documents.
- `tools/scripts/m1-headless.ts` on a document (it uses only the contract and the mock).
- `node tools/gen-docs/main.ts --contract-only`: three op pages changed (`Implementation: stub` → `mock` for the new
  ops the mock now implements).

### Why
- `lightH` from the contract, not a copy: the light law then has one definition that both engines call or mirror.
- Pitched receivers in conformance instead of a fallback pitch in the engines: an image without a pitch is a graph
  built outside the compiler (only `source.pattern` makes one), and the design removes every hidden default.

### What worked
- `npx vitest run packages/core` → 21 files, 639 passed, 7 skipped; `npx vitest run packages/engine-mock` → 4 files,
  464 passed (conformance included); the contract (62) and values (51) tests unchanged.
- `pnpm exec tsc -p packages/{core,engine-mock,conformance}/tsconfig.json --noEmit`: no error in these packages.
- `pnpm lint`: `import boundaries ok (429 file checks)`; check-colours ok.

### What didn't work
- First core run of the retouch test: `AssertionError: expected 0.0000014269739292416261 to be less than 1e-12`
  (healing d additively vs T multiplicatively). The two seams are not bit-equal: the rings are sampled bilinearly in
  each encoding, and interpolating d is not interpolating T. The test now bounds the difference inside the hard core
  of the spot at 1e-5 D.
- `film.stage5` failed with `ChromobenchError: E_ARG_TYPE: source.open needs argument "umPerPx"` (a test interning
  `source.open` by hand); it now passes the camera file's 375 µm/px.
- Mock conformance: `film.grain shape: data length 480 ≠ w·h·c` — my first pitched film-dyes path went through
  `invert.dyes` (four channels: the residual) while `film.grain` declares three; the pitched film-dyes receiver is
  now the camera chain (`source.xyz → capture.expose → film.develop`). `output.encode measure-fields: field
  documentSha256 missing` — the mock still returned `recipeSha256`.
- A first Python edit script for the mock's ops failed half way (`ValueError: substring not found`: the old
  `print.combine` block had already been cut with `print.lights`); nothing was written, I reran a corrected script.
- `clarity` of a flat image is not bit-identical (`expected [ 0.17999999999999988, …`): the Gaussian's taps sum to 1
  only to rounding. The test bounds it at 1e-14.

### What I learned
- The reference engine's ctx found node inputs only among top-level args (`nodeArgs`); list items' image and mask
  fields (print.combine's terms) need `nodeSlots`, which the contract already exports for the graph.

### What was tricky to build
- Sequential spots without a copy of the frame per spot: each spot computes its seam coefficients and its patch from
  the current image into a small buffer (the target box), then writes; that keeps "each spot reads the image as the
  spots before it left it" exact even when a spot's source overlaps its own target.
- `print.combine` per pixel without allocation: one `LightSample` is built per node and refilled per pixel (its
  arrays are mutable objects typed `satisfies LightSample`).

### What warrants a second pair of eyes
- `clarity`'s formula (decision 3) and the heal seam's encoding rule (decision 1): physics choices that P3 must mirror.
- `needsPitch` in conformance: "spatial and no size in px" is a rule over the catalogue; a future spatial op with a
  physical size and a px size at once would be misclassified.

### What should be done in the future
- P5b/studio: `apps/studio`'s `StudioEngine` still implements `output.frame` as a host op with a region-mapping fast
  path for previews; core's `output.frame` is geometric, so a RefEngine preview of the display cut computes the frame's
  input at full resolution (exact, slower). Either keep the host fast path or add the region mapping to RefEngine.

### Code review instructions
- Start at `packages/core/src/ops/ops.ts` (`printCombine`, `repairOp`, the new mask ops, `output.frame`), then
  `print/retouch.ts` (`retouch`), `print/clarity.ts`, `print/geometry.ts`, `print/balance.ts` (`bakeLights`).
- `packages/conformance/src/generate.ts` (`needsPitch`, `PITCHED_PATH`, `requiredArgs`), `semantics.ts`.
- Validate: `npx vitest run packages/core packages/engine-mock`; `pnpm exec tsc -p packages/core/tsconfig.json --noEmit`.

### Technical details
- Ops the reference engine implements now (besides the unchanged ones): `print.combine`, `print.densityMask`,
  `heal`, `clone`, `clarity`, `composite.mix`, `mask.linear`, `mask.ellipse`, `mask.paint`, `mask.luminance`,
  `mask.constant`, `mask.combine`, `mask.feather`, `mask.invert`, `output.frame`. Catalogue ops it still lacks (as
  before contract 1.0): `darkroom.contactSheet`, `darkroom.ringAround`, `darkroom.testStrip`, `output.encode`,
  `scan.baseClass`, `scan.checkDust`, `scan.conditioning`, `scan.flatField`, `scan.noise`, `scan.rankStocks`,
  `scan.rebate`, `scan.specks`, `source.info`, `view.inspect`.

## Step 3: The goldens as format-3 documents; 56 of 58 bit for bit, two deliberate changes, two new cases

With the reference engine in place I wrote the translation (`tools/goldens/translate.ts`) and switched the golden
engine to compile documents on the reference engine alone. The first check reproduced 56 of the 58 P0 cases exactly
(max |Δ| = 0 at both cuts, not just within the tolerance): the light law, the masks, the pitches and output.frame
agree with P0's chain to the bit. Two cases differed, each for a reason I could pin to one change.

`neg-burn-and` is the change the plan names (the one mask algebra: intersect is a product, P0's `mask.and` was a
minimum). `cam-dm-unsharp` is not on the plan's list, but its cause is the same principle as the umPerPx amendment:
P0 had two film pitches for a camera file. I confirmed it by translating its 30 µm radius to 1875 µm (30 × 375 / 6):
the picture then matched exactly. I kept the recorded 30 µm and re-rendered the case.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Translate the 58 golden recipes with a script, compile documents with the reference
engine alone, make `--check` pass; regenerate only the legitimate changes, record before/after error; render the two
skipped cases as new goldens.

**Inferred user intent:** Proof that the cut-off did not change the darkroom's pictures, and an oracle that now speaks
the new format.

**Commit (code):** 97d1cb6 — "CHB-037 P2b: reference engine, mock and conformance on contract 1.0; goldens as format-3
documents"

### What I did
- `translate.ts`: recipe (read as plain JSON; none of the deleted types imported) → document by the rules in Step 1
  and the plan; mask closures are rebuilt by recomputing each def's `nodeId` and walking from the root
  (`mask.or` → add components, `mask.and` → an intersect component, `mask.not` → invert, `mask.feather` → feather_mm,
  luminance on `source.open` → `reads: 'source'`, on `print.expose` → `reads: 'darkroom.main'`); every document passes
  `assertDocument`. It writes `cases/<id>/document.json` for all 60 recipes and `index.json` in format
  `chromobench-goldens/2` (each case: `document`, `recipe`, `cuts` or null, `ops` of the compiled chain).
- `engine.ts`: `RefEngine` alone; `render(doc)` = `compile(doc, engine.graph)`, the cuts `print` and `display` by
  `cutNode`, evaluated at full resolution. `golden.ts`: format 2 types, `checkAll` reads documents (a case without
  pictures fails with "render.ts --only id"); `missingOps`/`skipped` deleted. `render.ts`: renders cases from their
  documents (`--only`), shares identical pictures with the cases not re-rendered, refuses to overwrite a picture file
  another case points to. `cases.ts` deleted. `goldens.test.ts`: every case rendered; every document equals
  `translate(recipe)`; the check.
- `node tools/goldens/translate.ts`, then `node tools/goldens/render.ts --check`, then
  `node tools/goldens/render.ts --only neg-burn-and,cam-dm-unsharp,neg-dust-heal,neg-finishing-clarity`, then the
  check again; `node tools/goldens/render.ts` (all cases) to confirm a full re-render leaves every picture file
  byte-identical.
- Looked at the dust-heal pixels: the three white specks of the print (display 1.0, 1.0, 1.0) heal to their
  surroundings (e.g. speck 3 on the ramp: 0.974, 0.986, 0.993 against 0.977, 0.987, 0.993 beside it); clarity changes
  the display by up to 0.12 and shares the print cut's file with `neg-auto-lights`.
- README rewritten for the document era (what is stored, the engine, commands, the translation, what changed).

### Why
- Translating with a script, kept beside the data, makes the documents reproducible from P0's recipes and the test
  proves it; keeping `recipe.json` keeps the provenance of the pictures.

### What worked
- `node tools/goldens/render.ts --check` → `60/60 cases within max |Δ| ≤ 0.00001`, every case at max |Δ| 0.
- `npx vitest run tools/goldens` → 3 tests passed (about 9 s).

### What didn't work
- First check (before re-rendering): `neg-burn-and 1.03e-1 5.59e-4 9.23e-2 7.37e-4 FAIL`,
  `cam-dm-unsharp 3.75e-1 3.24e-2 2.65e-1 3.05e-2 FAIL` (print max, mean; display max, mean), and the two new cases
  `Error: neg-dust-heal has no pictures yet: render.ts --only neg-dust-heal`.

### What I learned
- The H < 1e-8 floor change (after the lights instead of before) touches no stored pixel: no golden reaches it.
- 56 cases are bit-identical, not merely close: lightH's summation order equals P0's combinePixel → lights → preflash
  chain for every pixel the goldens hold (the log of a product and the sum of logs round alike here).

### What was tricky to build
- Mask closures store their defs without ids; the inputs name ids. The translation recomputes each def's id with
  the contract's `nodeId` (the hash did not change at the cut-off), which is what lets it find `other` operands and
  the luminance mask's receiver (the main `print.expose` chain).
- Shared picture files: re-rendering only some cases must not overwrite a file another case's header points to; the
  renderer now seeds its sha → file map with the untouched cases and refuses such an overwrite.

### What warrants a second pair of eyes
- `cam-dm-unsharp`'s re-render is a judgement call: the spec lists only `neg-burn-and` and the H floor. The
  alternative (translate the radius to 1875 µm so the old picture stays) keeps the pixels but records a physically
  odd mask; I chose the recorded intent with one pitch per document. The main agent can flip it in one line of
  `translate.ts`.
- The dust sources are my choice (the recipe had none).

### What should be done in the future
- N/A

### Code review instructions
- `tools/goldens/translate.ts` (`translate`, `maskParts`), `engine.ts`, `render.ts`, `golden.ts`.
- Validate: `node tools/goldens/render.ts --check`; `npx vitest run tools/goldens`;
  `node tools/goldens/render.ts && git status --short packages/conformance/goldens` (clean).

### Technical details

Deliberate oracle changes (before = P0 picture, after = P2b render; max / mean |Δ| per float32 sample):

| Case | print cut | display cut | Physics reason |
|---|---|---|---|
| `neg-burn-and` | 1.03e-1 / 5.59e-4 | 9.23e-2 / 7.37e-4 | min(gradient, ellipse) → gradient · ellipse (design D4, the one mask algebra) |
| `cam-dm-unsharp` | 3.75e-1 / 3.24e-2 | 2.65e-1 / 3.05e-2 | the camera file's one film pitch, 375 µm/px, instead of P0's hidden 6 µm/px for density masks: σ = 30/375 = 0.08 px, not 5 px |

New goldens: `neg-dust-heal` (scan group `dust`: heal layers d1–d3, r 2.5, sources (24.5, 31.5), (61.5, 56.5),
(84.5, 15.5), coalesced into one `heal` node on scanner density) and `neg-finishing-clarity` (print layer `clarity`,
strength 0.4, radius 0.576 mm). Data directory: 8.58 MB.

## Step 4: Final checks, what is still broken elsewhere, what P3 and P5b need to know

I ran every check the spec names and the whole vitest suite once, to list the breakage outside my packages and to be
sure none of it is new from P2b. Then I recorded what the GPU phase (P3, in parallel) and the studio phase (P5b) need
from core, since both import it.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Close the phase: checks green for the owned packages, the breakage list, the handoff.

**Inferred user intent:** The main agent can merge P2b and plan P3/P5b without reading the code.

**Commit (code):** bde2495 — "CHB-037 P2b: core tests for clarity, output.frame, print-stage layers through compile,
pitches, sampled previews of masked documents" (the last code commit; this step's diary commit follows it)

### What I did
- `pnpm exec tsc -p packages/{core,engine-mock,conformance}/tsconfig.json --noEmit`; the repository-wide
  `pnpm exec tsc -p tsconfig.json --noEmit` filtered to `tools/` (my scripts and goldens: clean).
- `npx vitest run packages/contract packages/values packages/core packages/engine-mock tools/goldens tools/scripts`.
- `node tools/goldens/render.ts --check`; `pnpm lint`; `node tools/gen-docs/main.ts --contract-only --check`.
- `npx vitest run` (everything) to list the failing files by package.
- `docmgr doctor --ticket CHB-037`: two warnings for files P2b deleted, related from the P0 and P2a diaries
  (`tools/goldens/cases.ts`, `packages/core/src/print/exposures.ts`); removed those relations
  (`docmgr doc relate --remove-files`); doctor clean.

### Why
- The spec's acceptance: per-package typecheck, vitest of the owned packages and the goldens, the goldens check, lint,
  and a diary that lists every remaining breakage.

### What worked
- Typecheck: no error in core, engine-mock or conformance (core and the mock report packages/ingest's errors, see
  below; ingest is not P2b's).
- vitest (owned + contract + values): 41 files, 1222 passed, 7 skipped.
- Goldens: `60/60 cases within max |Δ| ≤ 0.00001` (every case max |Δ| 0).
- `pnpm lint` ok; `gen:check ok (15 files)` after regenerating the three op pages.
- Whole suite: 118 files, 37 failed (105 tests), 81 passed; P2a's list was 48 of 117. Every failing file is in a
  later phase's package: packages/studio-kit 16, packages/dsl 8, apps/studio 6, packages/agent 6, packages/output 1.

### What didn't work
- N/A (no new failure).

### What I learned
- The whole-suite count dropped by 11 failing files: core's 7 and the mock's 3 test files, plus the goldens test.

### What was tricky to build
- N/A (checks only).

### What warrants a second pair of eyes
- The contract's `Encoding` re-export (Step 1) makes packages/ingest fail to typecheck, which shows up in every
  package that imports ingest (core, the mock): a one-line contract fix.

### What should be done in the future
- **Main agent / P2a follow-up**: `packages/contract/src/index.ts` re-exports `type Encoding` from `registry.ts` by
  name, shadowing `source.ts`'s transfer `Encoding`; rename the op one (`OpEncoding`).
- **Main agent / contract**: `source.pattern` (conformance only) has no pitch, so conformance builds pitched receivers
  through a chain from `source.open`; a `umPerPx` argument on `source.pattern` would let it keep seeded inputs for
  physical-size ops too.
- **P3 (gpu)** must follow core's API changes (it imports core): `combinePixel` is gone — mirror the contract's
  `lightH` (terms with roles burn/dodge/flash-base/flash-open and weights amount · mask · `combineRatio`, densities,
  filters, preflash, the main amount and mask; one log at the end, floor 1e-8 after the filters and preflash);
  `parseSpots`/`parseStrokes` are gone (spots and strokes arrive bound as arrays: spot `{x, y, r, src: {x, y},
  feather, opacity}`, stroke `{points: [[x, y, p]…], radius, hardness, mode}`); `Spot` has no `id`, `mode` or
  `enabled`; `retouch(src, W, H, c, spots, mode, encoding)` applies spots in order, each reading the image as the
  spots before it left it, and `healCoefficients(at, W, H, spot, channels, encoding)` takes `'log'` for a
  scanner-density receiver (the seam is additive there: `patch = S + u`, boundary values `T − S`); `filmUmPerPx(info)`
  takes only the info and throws without `umPerPx.film`; `densityMaskSigma` throws without the film pitch;
  `DEFAULT_FILM_UM_PER_PX` is deleted; clarity is `print/clarity.ts` (`clarityGain`, `claritySigma`: σ = radius_mm ·
  1000 / umPerPx.paper, the low-pass on Y only, gain (L′/L)³ with L = (Y / Y_w)^⅓, Y_w = the view.adapt white's Y);
  output.frame's sampling is `print/geometry.ts` (`frameImage`: crop or the contract's `straighten`, then
  `orientPixels`); `ExposeSettings.magnification` is a number; `gradientAt` is `linearAt`.
- **P5b (studio)**: `bakeRecipe` → `bakeLights(doc, data, conv, lightsId = 'lights')` (mutations
  `main.params.filtration`, `main.params.time_s` in real mode, `lights.params.logH`), `chainOptionsOf(doc)` needs a
  link-resolved document (`compile(doc).doc`); the studio's first print (`apps/studio/src/host/first-print.ts`) and
  `StudioEngine`'s host `output.frame` (now also in core; the host's version has a preview fast path that core lacks)
  are theirs to bring over; the goldens no longer import any app module. A dust heal is a scan-stage heal layer per
  speck with an explicit `src` (ingest's `DustSpot` has none: the dust tool must choose it).

### Code review instructions
- Validate: `pnpm exec tsc -p packages/core/tsconfig.json --noEmit` (only packages/ingest lines);
  `npx vitest run packages/core packages/engine-mock tools/goldens`; `node tools/goldens/render.ts --check`;
  `pnpm lint`; `node tools/gen-docs/main.ts --contract-only --check`.

### Technical details

Remaining breakage (whole vitest suite after P2b; typecheck by package as in P2a's table):

| Package | failing test files | Why | Phase |
|---|---|---|---|
| packages/studio-kit | 16 | `defaultRecipe`, `FrameRecipe`, the EditLog shape (cb.ts builds a dummy recipe at import) | P4, P5b |
| packages/dsl | 8 | `defaultRecipe` in its helpers, `settablePaths`, the vocab | P6 |
| apps/studio | 6 | studio-kit at import; `first-print.ts` uses `bakeRecipe`; `StudioEngine` | P4, P5b |
| packages/agent | 6 | `Mutation`/`LoggedMutation`, `EvalResult.mutations` | P6 |
| packages/output | 1 | `FrameRecipe`, `defaultRecipe` | P4/P5b |
| packages/ingest | 0 (typecheck only) | `DustSpot`; the contract's `Encoding` name clash | P5b / contract fix |
| packages/gpu | browser suites | core API changes above; the new op set | P3 |
