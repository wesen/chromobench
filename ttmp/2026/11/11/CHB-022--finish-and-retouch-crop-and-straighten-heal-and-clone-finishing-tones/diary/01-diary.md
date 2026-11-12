---
Title: Diary
Ticket: CHB-022
Status: active
Topics:
    - ui
    - image-pipeline
    - product
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T15:10:22.182485997-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-022 Finish and retouch

## Step 1: Intern guide written

I read the UI design brief, the CraftKit tools (`develop-tools.js`, `develop-model.js`, the Workbench retouch ops in `vendor/wb/ck-catalog.js`), the contract's output/finishing/mask catalog, `recipe.ts`, `mutations.ts`, the dust heal in `packages/ingest`, and the CHB-006 and CHB-011 guides, then wrote `design-doc/01-intern-guide.md` (about 7,400 words with code). The main findings: the contract has `scan.crop` (axis-aligned box) and `scan.orientation` but no angle and no place for them on digital-RAW frames; `retouch` has no home yet; `finishing.*` ops exist on `print-xyz`.

The guide proposes a `view.frame` contract change, a `retouch.heal` op with spots stored as a record in the recipe, a patch-pass plus pointwise-composite engine design so spots are tile-clean, and the kit as builder calls, fragments, passes and agent counterparts. The Workbench ops are an optional, licence-gated provider.

### Prompt Context
**User prompt (verbatim):** "before we move on, now that we have worked out what to do with craftkit, let's create the tickets and design guides (remember, no need to be overly correct in the guides, they are \"guides for impementation\" after all, and we'll sort out details as we work) for the proper UI. Allow the UI to be entirely expressed using the JS API, so that we can create many different versions of it."
**Assistant interpretation:** Write the CHB-022 implementation guide (finish kit) following the shared UI brief.
**Inferred user intent:** A usable plan for crop, straighten, heal, clone and finishing tones as part of a JS-expressed studio.
**Commit (code):** none (the orchestrator commits all guides together)

### What I did
- Read the writer brief, the UI design brief, `develop-tools.js` (crop 56-150, heal 153-217, masks 225-392), `constrainCrop`, `vendor/wb/ck-catalog.js` retouch lines, `view-output-mask.ts`, `measure-darkroom-finishing.ts`, `recipe.ts`, `mutations.ts`, `dust/heal.ts`, `dust/specks.ts`, `apps/studio/src/core/{gesture,tools}.ts`, `ui/tools/Masks.tsx`, CHB-006/CHB-011 guides (grep).
- Wrote the guide, 17 tasks (`docmgr task add`), 8 related files, ran the markdown checker.
- Computed the worked example with `node`: 1.3 degrees, 4:5 in 3000x2000 gives a 1568x1960 crop at (716, 20); two sample spots map to shown (494, 706) and (1485, 1386).

### Why
- Spots as a record (not an array like dust) so per-spot staleness works; source stored explicitly so the engine never searches; patch pass plus pointwise composite so tiling needs no irregular halo.

### What worked
- The checker passed (7,423 words, 22 code blocks). The contract already has the pieces (masks, finishing ops, EditLog, gesture preview/commit).

### What didn't work
- No failures observed. I did not run any test or the app; everything is read from source.

### What I learned
- `output.frame` has `recipePath: 'scan'`, so digital-RAW frames cannot be cropped today. There is no straighten angle in the contract. CHB-011 already requires finishing before the knee.

### What was tricky to build
- Deciding where heal sits (after `view.adapt`, before `finishing.*`) and which coordinate frame each stored thing uses (spots in un-oriented source px, crop in the rotated canvas).

### What warrants a second pair of eyes
- The `view.frame` contract proposal and its order (orient, rotate, crop); log-XYZ heal offset near black (TODO); whether `set ... null` delete fits `checkSet`.

### What should be done in the future
- Contract requests to CHB-017; CHB-005 review of the patch-pass design; licence answer for `vendor/wb`.

### Code review instructions
- Read `design-doc/01-intern-guide.md` sections 3, 6, 7, 10. Validate with `python3 -I ttmp/2026/11/11/CHB-001--*/scripts/08-check-guide-markdown.py <guide>`.

### Technical details
- Sign convention proposed: `angle_deg` positive is clockwise; rotation about the centre of the oriented source; crop box in canvas px.

## Step 2: retouch.heal in every engine, and the finish kit (crop, straighten, spots, finishing panel)

`retouch.heal` now heals and clones in core (f64), on the GPU (a new WGSL kernel) and in the mock. The GPU matches
core to within 8e-6 (relative) on a pattern and 8e-7 on a real print, and tiles equal one pass exactly. The finish
kit (`packages/studio-kit/kits/finish`, `cb.kits.finish`) has a pure geometry module, a crop tool, a spot tool,
commands, panels and passes. A Finish module (key F) is in the `classic` variant (the app's default) and in a new
`finish` variant.

### Prompt Context
**User prompt (verbatim):** (via the orchestrator) "You implement ticket CHB-022 (finish and retouch: crop and
straighten, heal and clone, finishing tones) in the chromobench monorepo, in your own git worktree (based on main).
[…] contract 0.3 gives you `view.frame {orientation, angle_deg, crop}` […] a `retouch.heal` node […] currently a
pass-through in every engine: you implement the heal in core (f64) and gpu (WGSL) with parity, and the crop-validity
check […] Lane: packages/studio-kit/kits/finish […], packages/core and packages/gpu for `retouch.heal` and framing
only […] The CraftKit Workbench ops (vendor/wb) are NOT to be used […] Be pragmatic."
**Assistant interpretation:** Implement retouch.heal in core, the GPU and the mock with conformance and parity. Build the finish kit's tools and panels on studio-kit. Check crop validity in the kit, and write contract requests for what is still missing.
**Inferred user intent:** The photographer can level, crop and spot a print in the studio, on the real engines.
**Commit (code):** 16b5b14 — "CHB-022: retouch.heal in core (f64), GPU (WGSL) and mock; conformance cases; GPU
parity"; f051a4c — "CHB-022: finish kit — crop and straighten, spot heal/clone, finishing panel; Finish module in
classic and finish variants"

### What I did
- Branch `task/chb-022-finish`; `pnpm install --offline --frozen-lockfile`.
- core `src/print/retouch.ts`: `parseSpots` (enabled, natural id order), `bilinearAt`, `spotAlpha`,
  `healCoefficients`, `healOffset`, `spotWindow`, `retouch()`; `ops.ts` `retouch.heal` uses it; exported from the
  index. Test `test/retouch.test.ts` (7).
- gpu: `kernels/retouch.wgsl` (one pass, per-spot records in a storage buffer, source windows in an atlas),
  `src/retouch.ts` (`Retouch.apply`: windows rendered at full resolution through `renderGraph`, heal windows read
  back for core's `healCoefficients`, chunking by atlas height). In `engine-gpu.ts`: `retouch.heal` is now in
  `BARRIER_OPS`, the stub lowering is removed, and there is one `execute` case and a lazy `retouchK` field. Parity
  `src/parity/retouch-tests.ts` + `test/browser/retouch.spec.ts`.
- mock: a naive heal (one gain per channel from ring means) and an exact clone. conformance `semantics.ts`: two
  `retouch.heal` cases (clone copies the disc, region = crop, opacity 0; heal from the target itself is the
  identity, s10 covers s2).
- studio-kit: `kits/finish/src/{geometry,suggest,kit,index}.ts`; `cb.kits.finish`; package export
  `./kits/finish`. Variants: `finish-module.js` (module + menu), `finish.js`; classic `.use(cb.kits.finish.kit)` +
  Finish module with `tones: false`. `render-bridge.ts` `naturalSize`/`render` now use the shown node's size.
- Tests: `test/finish/geometry.test.ts` (9), `test/finish/kit.test.ts` (10), `test/browser/finish.spec.ts` (finish
  and classic). Variant snapshots updated (`-u`): new kit, pass count +1 in every variant.
- `packages/studio-kit/CONTRACT-REQUESTS.md` F1–F3 (+ notes); tasks checked with docmgr.

### Why
- The seam correction is the disc's closed-form harmonic solution: the Poisson integral, as the boundary's Fourier
  series damped by (ρ/R)^n, M = 8 with Lanczos σ-factors. CHB-006's SOR on a pixel grid would give different numbers
  on the GPU and per tile. The closed form is the same everywhere, and only the 18 coefficient vectors per spot are
  computed on the CPU. Both engines get them from core.
- The GPU computes each grid pixel at the full-resolution pixel centre it samples (`outMap`, as in pointwise.wgsl), with
  the source windows always at full resolution. Drafts, screen renders and every export tile therefore show the same spot,
  and the result equals the reference's nearest sampling at any scale.
- Contract 0.3 put the crop in sensor px of the un-oriented frame (not the guide's rotated canvas), so the geometry
  works in sensor px. The crop tool shows the whole frame, oriented and not straightened, with the region it will
  read drawn as a turned rectangle. The picture itself does not turn during the gesture, so the tool does not
  re-render while it drags.
- The panels are built from ck.ui and cb.arg only, so every host (the dev host and apps/studio) renders them without
  registering renderers. The angle uses ±1°/±0.1°/0° buttons and the rotate gesture. A slider bound to
  `view.frame.angle_deg` would skip keep-inside.
- Dust mode is offered only where the engine lists `scan.heal` (core and the GPU do not have it). Clarity is left
  out of classic's Finish module because core and the GPU do not implement `finishing.clarity`.

### What worked
- `npx vitest run packages/engine-mock packages/conformance packages/core/test/engine-ref.test.ts`: 782 passed (778 + 4).
- GPU parity: `{"changed":963,"pattern":{"maxAbs":2.9e-6,"maxRel":7.9e-6},"tileDiff":0,"half":{"maxRel":7.9e-6},
  "print":{"maxAbs":1.7e-7,"maxRel":7.7e-7}}`; with the broken variant (source 1 px off): pattern maxAbs 0.66.
- Heal on a planted speck: inside the disc within 1 % of the truth. The error map of a smooth level is under 0.05 %.
- At f051a4c: `pnpm test` 71 files, 2444 passed (baseline 2413); `pnpm typecheck` clean; `pnpm lint` "import
  boundaries ok (282 file checks)"; `pnpm gen:check` "ok (19 files)"; `pnpm contract:check` "50 change(s), 7
  breaking" (unchanged); `STUDIO_PORT=4531 STUDIO_KIT_PORT=4532 SHELL_DEMO_PORT=4533 GPU_PARITY_PORT=4534 CI=1 pnpm
  test:browser` 73 passed (4.5m), GPU conformance 276/276.
- Screenshots of the dev host: a turned crop frame with thirds and handles, then a healed spot with its dashed source
  circle.

### What didn't work
- First parity run: `{"error":{"code":"E_INTERNAL","message":"process is not defined"}}`. `new RefEngine()` loads Node
  data in the browser. Fixed with `new RefEngine({ data: defaultPhysicsData() })`.
- Then `E_KERNEL_COMPILE … 'patch' is a reserved keyword`, because WGSL reserves `patch`. Renamed it to `pv`.
- `npx playwright test --project gpu-parity <file>`: `Project(s) "packages/gpu/test/browser/retouch.spec.ts" not
  found`. The flag needs `--project=gpu-parity`.
- First core heal test: max error 3.4 %. The test's level `0.05·sin(y/9)` curves so much over the disc that it is
  not log-harmonic, and the source's curvature bowl cannot be matched. `sin(y/30)` gives under 0.05 %.
- The clone test failed by 1 ulp (`out + a·(p − out)`); `(1 − a)·out + a·p` is exact at a = 1 (the WGSL `mix` is the
  same).
- `parseSpots` let a spot's own `id` field override the key; it now spreads first, then sets `id`.
- `constrain` returned a null crop for random crops whose centre was at the frame edge. It now falls back to the
  largest box of the same shape. Bisection was raised to 48 steps.
- Several multi-command shell lines were refused by the worktree guard ("too complex to verify"), so I split them
  up and wrote files with the editor.
- The first browser smoke timed out on focus-moving clicks I had added before Ctrl+Z. They were not needed.

### What I learned
- The shell's viewport takes its natural size from `RenderBridge.naturalSize`/`Rendered.srcW`. studio-kit returned
  the source size, so a cropped or turned frame would have been stretched. Nothing had set a crop from the UI
  before.
- `set retouch.spots.<id> null` works through `EditLogRoute.applyMutations`, and undo restores the spot.

### What was tricky to build
- Crop gestures in a turned box. A pointer becomes sensor px, then box-local coordinates (rotate by −θ). Edges move
  in local terms and the centre returns through R(θ). Keep-inside lerps from the last valid box, so moves stick and
  resizes stop at the edge with the aspect intact. Exact aspects snap to k·p × k·q.
- Mirrored orientations reverse the turn (`sensorAngleSign`). The rotate gesture uses angle′ = angle₀ − Δφ in canvas
  terms, which is right for all eight orientations because the region drawn on the canvas is turned by −angle.

### What warrants a second pair of eyes
- `engine-gpu.ts` changes: `BARRIER_OPS` + the `retouch.heal` execute case (CHB-012 edits the same file).
- The render-bridge size change affects every variant's viewer when a crop or quarter-turn is set.
- Spot composite order = natural id order (canonicalJSON loses insertion order); contract request F1 documents it.

### What should be done in the future
- Contract F2 (crop validity at compile) and F3 (`finishing.tone`, `finishing.saturation`). After that, the engines
  and a longer tones panel.
- An output.frame GPU kernel (Lanczos in export) (task z8nq). `finish/spots-bounds` and `finish/order` passes. Local
  tones (7llb). `geom.*` in the DSL prelude (w2q3). `scan.heal` in core/GPU for Dust mode (CHB-006).

### Code review instructions
- `packages/core/src/print/retouch.ts`, `packages/gpu/src/retouch.ts` + `kernels/retouch.wgsl`, the
  `retouch.heal` case in `engine-gpu.ts`; `packages/studio-kit/kits/finish/src/{geometry,kit}.ts`.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm gen:check`; `CI=1 GPU_PARITY_PORT=4534 STUDIO_KIT_PORT=4532 npx
  playwright test --project=gpu-parity retouch` and `--project=studio-kit finish`.
- Try it: `pnpm --filter @chromobench/studio-kit demo` → `?variant=finish&fresh`, press F, then R (crop) or Q (spots).

### Technical details
- Spot record on the GPU: 22 vec4 (target x, y, r, inner; source x, y, opacity, heal; window; atlas x, y, R, nc;
  a_n, b_n for n = 0…8). Rings at r + ½, 1½, 2½; R = r + 1½; 32 angles; EPS 1e-6 before the log.
- New diagnostics: CB-F101 (finishing control in a Print/Darkroom module, warning), CB-F102 (finish tools without
  the kit, error), CB-F110 (crop leaves the picture; `cropProblem` + `crop.fix`).
