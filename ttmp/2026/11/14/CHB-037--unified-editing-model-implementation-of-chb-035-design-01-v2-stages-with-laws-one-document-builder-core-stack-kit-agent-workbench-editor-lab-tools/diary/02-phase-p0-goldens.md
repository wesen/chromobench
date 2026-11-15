---
Title: Diary — phase P0 goldens
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
      Note: output.frame host op used for the display cut
    - Path: repo://packages/conformance/goldens/index.json
      Note: the golden index
    - Path: repo://packages/contract/src/graph.ts
      Note: compile(), the pipeline the goldens record
    - Path: repo://tools/goldens/README.md
      Note: format and how P2 uses the goldens
    - Path: repo://tools/goldens/cases.ts
      Note: the 60 case builders (coverage)
    - Path: repo://tools/goldens/engine.ts
      Note: RefEngine in StudioEngine; compile and the two cuts
    - Path: repo://tools/goldens/fixtures.ts
      Note: synthetic negative and camera fixtures
    - Path: repo://tools/goldens/golden.ts
      Note: storage format and comparison
    - Path: repo://tools/goldens/render.ts
      Note: 'CLI: regenerate goldens and --check'
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-14T21:13:51.780731-05:00
WhatFor: ""
WhenToUse: ""
---


# Diary

## Goal

Phase P0 of CHB-037: golden pictures of today's pipeline (recipe v2, `compile()`) on core's f64 reference engine, at
the cuts `print` (view.adapt) and `display` (output.frame), stored with their recipes, with a re-render/check
script, so that phase P2 can prove its new compiler and light law reproduce the darkroom.

## Step 1: Reading the spec and finding how the repository evaluates a recipe

The main agent assigned me phase P0. Before writing anything I read the plan's working rules and the P0 spec, the
design sections that motivate the goldens (§15 compiler, §22 light law, §23 mapping table, §35–37 cut-off, phases,
testing), and then looked for the existing way to compile a recipe and evaluate it on the reference engine, so the
goldens use it rather than a second evaluator.

The main finding: the reference engine does not implement every op of the compiled chain. `output.frame` (the
display cut itself), `scan.heal` (dust) and `finishing.clarity` are missing from `REFERENCE_OPS`. The studio adds
`output.frame` with its `StudioEngine` wrapper (`apps/studio/src/host/studio-engine.ts`, HOST_OPS); `scan.heal` and
`finishing.clarity` exist only in engine-mock (scan.heal as identity) and in no physics engine (GpuEngine's
`GPU_OPS` lacks them too). So dust heal and clarity cannot be rendered headlessly on the reference engine.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all." (the owner's request to the main agent, which assigned
me phase P0, golden pictures).

**Assistant interpretation:** Render a fixed, synthetic set of frames and recipes through today's compile() on the
f64 reference engine at the print and display cuts, store recipes and pictures (f32 + JSON header) under
packages/conformance/goldens/, and provide tools/goldens/render.ts (regenerate, --check) and a README for P2.

**Inferred user intent:** A safety net for the hard cut-off: once the recipe path is deleted, the new document
format must still print the same pictures.

### What I did
- Read `design-doc/01-implementation-plan-and-working-rules.md` §1, §2, §5 P0, and design 01 §2, §14–15, §22–23, §35–37.
- Read `packages/contract/src/graph.ts` (`compile`), `recipe.ts`, `paths.ts` (`defaultRecipe`), `mutations.ts`.
- Read how tests build engines: `packages/conformance/src/generate.ts` (`makeEnv`), `packages/core/test/chb010.exposures.test.ts`
  (RefEngine + Graph + M1 TIFF, masks as `mask.set` closures), `film.stage5.test.ts` (synthetic RAW via `openDecoded`),
  `apps/studio/test/host.test.ts` (StudioEngine over an engine; `firstPrint` with core's `integrateToGrey`).
- Listed `REFERENCE_OPS` against the catalogue; grepped GpuEngine's `GPU_OPS` and engine-mock for the missing ops.

### Why
- The goldens must come from the exact path the studio uses today, or P2 would be compared with something else.

### What worked
- `StudioEngine(RefEngine, host)` is the studio's own way to get `output.frame` on real physics; with a minimal
  `HostServices` (no decode; fixtures opened directly in the RefEngine) it runs headless in Node.
- The studio's first print (`apps/studio/src/host/first-print.ts`) and mask editor (`studio-kit/src/model/tools.ts`
  `maskSpec`) are importable from tools by relative path (they import only the contract).

### What didn't work
- A first probe importing `@chromobench/core` from `tools/` failed: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package
  '@chromobench/core' imported from …/tools/_probe.ts` — the root package.json does not depend on core. I import
  `../../packages/core/src/index.ts` relatively instead (no lockfile change; core's own imports resolve from its
  package, and the symlinked contract is one module instance).

### What I learned
- The `print` cut (view.adapt) is upstream of `retouch.heal` and `finishing.clarity`: retouch shows only at `display`.
- `print.lights.auto` is not compiled; the auto balance is the studio's first print writing time and lights.

### What was tricky to build
- N/A (reading step).

### What warrants a second pair of eyes
- Whether P2 should keep a host op like `output.frame` outside the reference engine, or move it into core: today the
  display cut depends on an app module (`apps/studio/src/host/studio-engine.ts`).

### What should be done in the future
- `scan.heal` and `finishing.clarity` have no physics implementation (reference or GPU): either implement them (P8
  plans clarity in µm) or drop them at the cut-off; until then they have no goldens.

### Code review instructions
- Start at `packages/contract/src/graph.ts` `compile()` and `packages/core/src/engine-ref.ts` `REFERENCE_OPS`.

### Technical details
- Missing on RefEngine among compile()'s ops: `output.frame`, `scan.heal`, `scan.flatField` (only with `scan.flat`
  set, which needs a flat-field source: not exercised), `finishing.clarity`.

## Step 2: The golden set — fixtures, cases, engine, storage, check

I wrote `tools/goldens/` (fixtures.ts, engine.ts, cases.ts, golden.ts, render.ts, goldens.test.ts, README.md) and
generated `packages/conformance/goldens/`: two new synthetic fixtures plus the existing M1 negative, 58 rendered
cases and 2 skipped ones (recipe only), 8.2 MB. `render.ts --check` re-renders every stored recipe and reproduces all
116 cut pictures exactly (max |Δ| = 0; tolerance 1e-5).

The fixtures are formulas only: a 96 × 64 colour negative (rebate strip, neutral ramp, seven colour patches, a fine
grating, a highlight blob, three dust specks) as a 16-bit TIFF, and a camera file (the same scene under a warm light
in linear camera RGB, a camera matrix and an as-shot neutral) as float32 + SourceInfo JSON. They are stored, so the
goldens never depend on the generator; `--fixtures` rewrites them.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Build the case set to the coverage list, store it in the requested format, provide
regenerate and check.

**Inferred user intent:** An oracle P2 can run unchanged except for its compile step.

**Commit (code):** see Step 3.

### What I did
- `engine.ts`: `RefEngine({ data: nodePacksData() })` in a `StudioEngine`; `render(r)` = `compile(r, graph)`, adopt the
  closure, walk the receiver chain up to `view.adapt` and `output.frame`, evaluate each at `{ scale: 'full',
  precision: 'export' }`. `firstPrint(r)` = the studio's first print with core's integrate-to-grey (as host/engines.ts).
- `cases.ts`: 60 case builders from `defaultRecipe` → first print → `applyMutation` (`set`, `exposure.add`, `mask.set`
  with the graph for full checks). Masks via studio-kit `maskSpec` (gradient, ellipse incl. angle, paint add/erase,
  or of shapes, feather, invert) and interned nodes for `mask.and` and `mask.luminance` (on the scan and on the main
  print exposure). Each recipe is checked with `assertRecipe`.
- `golden.ts`: header type, f32 LE read/write, stats, `compareCut`, `checkAll`; identical pictures share one file
  (the header's `file` points to it; 10 of 116 are shared).
- `render.ts`: regenerate (all, `--only`, `--fixtures`) and `--check [--tol] [--only]` with a per-case table.
- `goldens.test.ts`: the check in vitest (about 5 s), plus a coverage sanity test.
- Looked at a contact sheet of all display cuts (a throw-away Python preview in the scratchpad) to see that each
  case shows its feature (dodged ellipse, burned sky, painted strokes, luminance-masked burns, flashes, crops…).

### Why
- Recipes built through the mutation set and the studio's own builders are recipes the studio could hold; P2 maps
  exactly these shapes.
- Most cases start from the first print so their pictures sit mid-scale, where a semantic change shows.

### What worked
- Rendering is fast: all 58 cases in about 3 s; the check is deterministic to the bit.

### What didn't work
- First generation: `neg-flash-base` (1.5 s flash through the base, whole frame) printed nearly black (display mean
  0.19), and the unsharp masks washed the print out (display mean 0.925). Fixed by shorter flashes (0.2–0.5 s) and by
  re-metering the density-mask cases with the first print; one un-metered case (`neg-dm-unmetered`) keeps the effect.
- `cam-wb-as-shot` was identical to `cam-auto`: core's daylight and as-shot balance coincide when the as-shot neutral
  is D65 (`cameraMatrix` in core/film/camera.ts). The camera fixture now has a warm scene light (linear sRGB × [1.12,
  1, 0.8]) and the matching as-shot neutral, so the two differ.
- `pnpm typecheck`: `fixtures.ts(94,24): error TS2322: Type 'number[]' is not assignable to type 'Vec3'` and
  `render.ts(103,41): error TS18048: 'caps.adapter' is possibly 'undefined'` — fixed (explicit tuple; `?? 'unknown'`).

### What I learned
- A positive density mask is zero at the frame's densest area (here the ramp's highlight end, pixel (95, 6)), so it
  adds density everywhere else: γ 0.6 at 25 µm adds 0.46 D on average. I first guessed the dust specks set the zero;
  measuring the `print.densityMask` node showed otherwise.
- The fixtures carry no `umPerPx`, so `radius_um` uses core's `DEFAULT_FILM_UM_PER_PX` = 6.
- The heal spot on the ramp speck near paper white leaves a slightly brighter disc; that is today's behaviour and is
  recorded as such.

### What was tricky to build
- The luminance mask on the print exposure needs the main `print.expose` node id: I compile the base recipe and walk
  up to `print.expose`; the mask closure therefore embeds the scan → dyes → expose chain, which `compile()` re-adopts
  with identical ids (hash-consing).
- Shared files: the print cut of crop, orientation, retouch and knee cases is the base's picture; storing it once
  keeps the total at 8.2 MB instead of ~9 MB, at the cost of one indirection (`file` in the header).

### What warrants a second pair of eyes
- The display cut depends on `StudioEngine` (an app module) for `output.frame`; if P5b/P2 move or delete it, the
  goldens' engine.ts must follow (same sampling: `orientPixels`, `straighten` from the contract).
- Auto-balance numbers are frozen in the recipes; the check does not re-run metering.

### What should be done in the future
- P2: replace the compile step in `engine.ts` with the new compiler's cuts and run `--check` (README "How P2 uses it").
- When `scan.heal` or `finishing.clarity` get a physics implementation, remove the `skip` of `neg-dust-heal` /
  `neg-finishing-clarity` and regenerate those cases (the check reports it).

### Code review instructions
- Start with `tools/goldens/README.md`, then `engine.ts` (how a cut is rendered), `cases.ts` (coverage), `golden.ts`.
- Validate: `node tools/goldens/render.ts --check` (58/58, max |Δ| 0), `npx vitest run tools/goldens`.

### Technical details
- Case ids and what they exercise: `packages/conformance/goldens/index.json` (`cases[].exercises`, `ops`).
- Header: `{case, cut, op, domain, width, height, channels, dtype: 'float32', endian: 'little', layout, file, sha256,
  stats: {min, max, mean}, warnings}`.
