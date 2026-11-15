---
Title: Diary — phase P2a contract
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
    - Path: repo://packages/contract/CONTRACT-DECISIONS.md
      Note: Contract 1.0 section and CC-019 (commit 1dade2e)
    - Path: repo://packages/contract/src/catalog/layers.ts
      Note: Darkroom terms, heal/clone, clarity, composite.mix (commit 1dade2e)
    - Path: repo://packages/contract/src/compile.ts
      Note: The one compiler with named cuts, links, bindings, masks (commit 1dade2e)
    - Path: repo://packages/contract/src/document.ts
      Note: Document format 3, stage and cut tables, newDocument (commit 1dade2e)
    - Path: repo://packages/contract/src/pixel.ts
      Note: 'lightH, mixPixel, maskCombine: the laws'' arithmetic (commit 1dade2e)'
    - Path: repo://packages/contract/src/stage-laws.ts
      Note: defineLaw; light, composite, repair; coalescing (commit 1dade2e)
    - Path: repo://packages/contract/src/validate.ts
      Note: Validation through the values hooks (commit 1dade2e)
    - Path: repo://packages/contract/test/light-law.test.ts
      Note: Light law equals combinePixel (property) (commit 1dade2e)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-14T21:38:33.544697-05:00
WhatFor: ""
WhenToUse: ""
---



# Diary

## Goal

The phase agent's record of phase P2a of CHB-037: contract 1.0 in `packages/contract` — document format 3 on
`Coll`, the catalogue with `stages` and `encoding`, the darkroom entry ops and one generalised light-law combine
node, heal/clone with structured spots, clarity in mm on the print, one mask algebra, `defineLaw` (light,
composite, repair) with coalescing, one compiler with named cuts and the upstream-only binding rule, link and
binding registries, validation through the values hooks, the cut vocabulary, a minimal transaction edit log, one
error class, and the CC change note; the old recipe model deleted (hard cut-off). Spec: plan
`design-doc/01-implementation-plan-and-working-rules.md` §6 P2a plus "Amendments after P0" and "after P1"; design:
CHB-035 design 01 v2 (Part I §2–8, Part III §14–19, Part IV §20–29, §31, §35–37).

## Step 1: Reading the spec, the design and today's contract; the decisions the design leaves open

The main agent assigned me phase P2a. Before writing code I read the working rules and the P2a spec with both
amendments, the design sections the spec names, `packages/values/README.md` and its sources (the API I build on),
`tools/goldens/README.md` (P2b translates the 58 goldens into my format, so the format must make that exact), and
the whole contract package plus the reference engine's darkroom code (`core/src/print/exposures.ts`
`combinePixel`, `core/src/ops/ops.ts` for `print.lights`, `print.preflash`, `print.combine`, `print.densityMask`,
masks and retouch) to know exactly what the light law must reproduce.

The design fixes the shape (five components, a law per stage, Coll everywhere, four mutations, one compiler with
cuts); it leaves the concrete argument shapes, units and several physics questions open. The decisions below are
the ones I made before coding, with the physics reason for each; they are repeated in the final report.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all."

Later direction from the owner (verbatim): "unify all of it, we don't have backwards compatibility needs or wrapping
or so, we can do hard cutoff, now is the time to strive for elegance and consistency and all that. nothing is not
worth it if it creates a more robust and simple core"

**Assistant interpretation:** The main agent split CHB-037 into phases and assigned me P2a: build contract 1.0 in
`packages/contract` (document format 3, catalogue with stages and encodings, laws, masks, compiler with cuts, links
and bindings, validation, one error class), delete the recipe model with no compatibility code, keep the contract's
tests, typecheck and generated docs green, and list what breaks in every other package.

**Inferred user intent:** One small, robust core for the editing model, so that every later phase (reference
engine and goldens, GPU, history, stack kit, agent workbench, links) builds on one document, one law per stage and
one compiler instead of today's six list shapes and three copies of the exposure semantics.

### What I did
- Read the plan (§1–2, §6 P2a, both amendments), the design (opening, §2–8, §14–19, §20–29, §31, §35–37),
  `packages/values` (README, `coll.ts`, `doc.ts`, `mutations.ts`, `transactions.ts`, `value.ts`, `site.ts`,
  `errors.ts`), `tools/goldens/README.md` and `cases.ts`, and every file of `packages/contract/src` and `test/`.
- Read the reference engine's darkroom: `combinePixel`, `print.lights` (x + L), `print.preflash`
  (x' = log10(10^x + φ)), `print.combine` (flash terms through base/open, density masks, ratio in normalised mode),
  `print.densityMask`, the mask rasterisers and `retouch.ts`.
- Baseline in the worktree: `npx vitest run packages/contract packages/values` → 10 files, 103 tests passed.
- Created this diary (`docmgr doc add --ticket CHB-037 --doc-type diary --title "Diary — phase P2a contract"`),
  renamed `04-diary-phase-p2a-contract.md` to `05-phase-p2a-contract.md`; `docmgr doctor --ticket CHB-037` clean.

### Why
- The light law must equal today's darkroom for today's kinds (the goldens are the oracle), so I needed the exact
  order of operations in core, not the design's summary formula.

### What worked
- Today's chain is already law-shaped: everything after `print.expose` and before `print.develop` is additions and
  multiplications in linear H, which is what lets one combine node hold the whole darkroom.

### What didn't work
- N/A (reading only).

### What I learned
- **Preflash is added light, but after the printer lights.** Core computes `x' = log10(10^(x + L) + φ)`: a uniform
  addition in linear H (so it is a darkroom layer, not a medium setting, as the design hoped), but φ is a fraction
  of the *grey-card* exposure and is added after the lights, so the filters do not act on it. The light law
  therefore gets a term outside T_all: `H = T_all·(T_neg·(max(E_main − ΣE_dodge, 0) + ΣE_burn) + ΣE_flash) + ΣE_pre`.
- **The grade is not light.** `print.grade` is a gamma about the aim grey inside `print.develop`, not a
  transmission in H, so it cannot be a `filter` layer without changing every picture; it stays in the darkroom
  medium (the design's table, which lists it as a filter, assumed multigrade filtration; colour paper has no grades).
- **`split` is a burn with its own pack.** Today `split` and `burn` compile identically (mode 'add', own
  filtration allowed, the same seconds rule); `split` is folded into `burn` (a burn with `filtration`).
- **No µm per pixel exists anywhere today**: `source.open` gives `umPerPx: {}` and every engine falls back to a
  default (core 6 µm/px for density masks, 36 mm long edge for film ops). Nothing in the graph sets it.
- CC-018 is taken on the unmerged branch `task/chb-028-full-res-export-impl` (`rescaleRecipe`), so the change note
  is **CC-019**.

### What was tricky to build
- Deciding where physical units meet the pixel grid. Layer params are op arguments (validated by the op's
  ArgSpecs), so an op such as `clarity` takes its radius in mm and the engine converts with `ImageInfo.umPerPx`,
  as film ops already do with µm. Masks are not ops but document values the compiler lowers to `mask.*` nodes, so
  their physical feather (mm on the print) is converted to document pixels by the compiler. Both rules keep one
  unit per stored value and need explicit pitches: see the decisions below.

### What warrants a second pair of eyes
- The preflash finding and the grade decision (above): both are physics claims that P2b's goldens will confirm.
- The sequential semantics of heal/clone runs (decision 7 below) differs from today's `retouch.heal` ("every source
  read from the image before retouching") when a spot's source overlaps an earlier spot's target.

### What should be done in the future
- N/A for this step (the decisions are implemented in the next steps).

### Code review instructions
- Nothing to review yet; the decisions are listed under Technical details.

### Technical details

Decisions the design leaves open (made here; the code follows them):

1. **Document root**: `{ format: 3, frame, source, data, stages, masks, probes, geometry, output }`; stages
   `scan?`, `scene?`, `film?`, `darkroom`, `print`; a negative scan has `scan`, a camera file `scene` and `film`
   (no `kind` field: the stages say it). Root keys are reserved and can never be ids.
2. **Media** hold exactly today's fixed settings that compile reads. Scan: scanner, stock, format, **umPerPx**
   (explicit, P0 amendment), rebate, baseT, flat, openGate, flare. Scene: white balance. Film: stock, exposureEV,
   format.longEdge_mm (the film pitch is long edge / long side of the source), push, dir, halation, grain.
   Darkroom: paper, aim, mode, lamp, **magnification** (now always a number; 8 = the calibration), grade. Print:
   illuminant, flare. Never-compiled fields are gone (`capture.adapt`, `capture.autoExposure`, finishing,
   `scan.dust.method/marginPx`, `roll`).
3. **Pitches**: `source.open` takes `umPerPx` (film µm per source pixel) and the graph sets
   `ImageInfo.umPerPx.film`; `print.expose` sets `umPerPx.paper = film × magnification`. Physical sizes: density
   mask radius in µm on the film, clarity radius and mask feather in mm on the print.
4. **Darkroom entry ops** (`stages: ['darkroom']`, returns `Term`, never evaluated by an engine): `expose` (the main,
   exactly one, id `main`: time_s, fstop, filtration), `burn` and `dodge` and `flash` (exactly one of time_s or
   stops; burn and flash may carry filtration; flash `through` base|open), `preflash` (fraction of the grey-card
   exposure), `densityMask` (gamma, radius_um, polarity; the photographer's "contrast"/"unsharp" is the entry name),
   `filter` (logH per channel: the printer lights and any colour correction in H). The light law lowers all of them
   to `print.expose` nodes, `print.densityMask` nodes and **one `print.combine`** whose structured args hold every
   term with its amount and mask; `print.lights` and `print.preflash` disappear into it.
5. **Amount**: light: scales a contribution's light and a modulator's density, [0, 16]; composite and repair:
   opacity, [0, 1]. Group amounts multiply; group masks multiply (intersect).
6. **Composite**: a layer is its op's node on the backdrop, then `composite.mix(back, { top, amount, mask, blend })`
   unless amount 1, no mask, normal; blend modes in P2a: `normal` only. An isolated group (blend = a mode) evaluates
   its children on the backdrop (there are no source layers) and blends their result with its mode, so isolated
   `normal` ≡ pass (the §37 property).
7. **Heal and clone** are two layer-and-node ops (`stages: ['scan', 'print']`) with a structured `spots` list
   (x, y, r, src, feather, opacity in document px). Spots apply **in order, each reading the image as the spots
   before it left it**, so a run of single-spot layers and the coalesced node are the same pixels by definition.
   Coalescing folds a layer's amount into its spots' opacity (exact for one spot, or amount 1).
8. **Masks**: components linear | ellipse | paint | luminance (radial and colour come with their ops in P8); fold
   from the empty mask (0) with `v ← v + a·(op(v, c) − v)`, op add = max, subtract = v(1 − c), intersect = v·c; then
   feather (mm on the print → px by the compiler), then invert. Node ops: `mask.linear` (was gradient),
   `mask.ellipse`, `mask.paint` (structured strokes), `mask.luminance`, `mask.constant`, `mask.combine`,
   `mask.feather`, `mask.invert` (was not); `mask.and`/`mask.or` deleted.
9. **Cuts**: `source`, `scan`, `scene`, `film`, `negative` (the darkroom's input, both kinds), `darkroom.main` (the
   main exposure alone, which today's luminance-of-the-print masks read), `darkroom.H`, `print`, `finished`,
   `display`. A mask may read any cut at or before its stage's input (and `darkroom.main` in the darkroom); a
   binding only cuts at or before its stage's input.
10. **Errors**: `ChromobenchError` extends values' `ValueError`; `E_RECIPE` becomes `E_DOCUMENT`; new `E_LINK`,
    `E_BINDING`, `E_CUT`.

## Step 2: Contract 1.0 built, the recipe model deleted, laws tested

I implemented the decisions of Step 1 in one coherent pass, because the pieces depend on each other (the registry
needs the stage names, the laws need the document, validation needs the laws and the schema, the compiler needs all
of them) and nothing in between would typecheck. The old model went first (`git rm` of `recipe.ts`, `paths.ts`,
`mutations.ts`, `vocab.ts` and the two tests that exercised them), then the new modules, then the tests. Typecheck
of the contract alone came back clean on the second run; the first light-law property run passed on the first try,
which made me tighten the test (below) rather than trust it.

The contract now has one document, one law per stage and one compiler. Everything outside the contract that
consumed the recipe breaks, as the spec expects; the list per package is under Technical details.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Build and test contract 1.0 as specified; keep the contract's tests, its typecheck and
its generated docs green; list the consumer breakage.

**Inferred user intent:** A robust, simple core that later phases build on without second implementations.

**Commit (code):** 1dade2e — "CHB-037 P2a: contract 1.0 — document format 3, stage laws, one light-law node, one mask
algebra, one compiler with cuts"

### What I did
- New modules in `packages/contract/src`: `document.ts` (format 3 types, stage and cut tables, `newDocument`),
  `stage-laws.ts` (`defineLaw`; light, composite, repair; coalescing), `compile.ts` (`compile`, `cut`, `cutNode`,
  `pitches`, `compileMeasured`), `validate.ts` (`validateDocument`, `DOCUMENT_RULES`, `edit`), `schema.ts` (media,
  geometry and output schemas from the consuming ops' ArgSpecs; `checkParams`), `links.ts` (resolver registry, roll
  resolver, `resolveLinks`, `bakeLink`), `bindings.ts` (`defineBinding`, cached `callBinding`), `builders.ts`
  (values kinds for layers, groups, masks; `libraryRoot(import.meta.url)`), `pixel.ts` (`lightH`, `mixPixel`,
  `maskCombine`), `catalog/layers.ts` (darkroom terms, heal, clone, clarity, composite.mix).
- Rewrote the catalogue files (no recipe paths; print.combine structured; masks as the one algebra),
  `registry.ts` (layer ops, `Term`, `stages`/`encoding`/`term`/`coalesce`/`identity`, `nodeSlots` for node ids
  inside list items, a non-JSON guard in `bindArgs`), `graph.ts` (structured node inputs, the pitches, `Term` ops
  refused, compile moved out), `errors.ts` (one class), `editlog.ts` (transactions), `roll.ts` (media and stacks),
  `eval.ts`, `frame.ts`, `spec.ts` (`list`, `polyline`, `checkFields`), `units.ts` (`mm`).
- Added `packages/contract/tsconfig.json` so the package typechecks alone:
  `npx tsc -p packages/contract/tsconfig.json --noEmit`.
- Tests (`packages/contract/test`): `light-law.test.ts`, `compile.test.ts`, `document.test.ts`,
  `links-bindings.test.ts`, `registry-graph.test.ts` (rewritten), `editlog-builders.test.ts`, plus the kept
  `units-laws.test.ts`; shared `helpers.ts`.
- `tools/gen-docs`: `snapshot.ts` dumps stages, cuts, laws, media fields instead of `RECIPE_FIELDS`; `main.ts` gains
  `--contract-only` (the DSL and agent targets import packages that break until P6); `contract-check.ts` compares
  document fields and reports the recipe schema as replaced. Regenerated with
  `node tools/gen-docs/main.ts --contract-only`; deleted the stale `docs/reference/ops/finishing.md`; added
  `docs/reference/ops/composite.md`. Kept `baselines/catalog-0.4.0.json` (from HEAD).
- `CONTRACT-DECISIONS.md`: a "Contract 1.0" section and CC-019 (class breaking).

### Why
- `print.lights` and `print.preflash` as separate nodes would leave two places where darkroom light is combined;
  folding them into the one combine node is what "one copy of every law" means, and lets a filter or a preflash
  take a mask like any other entry.
- Node ids inside list items (a term's image and mask) must become node inputs in a fixed order, or `adopt` in
  another realm would not reproduce the id; `nodeSlots` defines that order once (arguments in catalogue order,
  items in order, fields in schema order).

### What worked
- `npx vitest run packages/contract` → 7 files, 61 tests passed; values unchanged (its 51 tests pass).
- `npx tsc -p packages/contract/tsconfig.json --noEmit` → no errors.
- `node tools/gen-docs/main.ts --contract-only --check` → `gen:check ok (15 files)`.
- `pnpm lint` → `import boundaries ok (429 file checks)`; check-colours ok.
- `node tools/gen-docs/contract-check.ts` → `0.4.0 (main) → 1.0.0`, 105 changes, 75 breaking (exit 0: major bump).
- The light-law property (n = 300, seed 7): compiling random darkroom stacks and evaluating `print.combine` with
  `lightH` equals an independent implementation of today's `combinePixel` → `print.lights` → `print.preflash` to
  1e-12, in every compared case.

### What didn't work
- First typecheck: `packages/contract/src/catalog/layers.ts(27,8): error TS2345: ... Property 'class' is missing`
  (the `term()` helper's parameter type kept `class` required) and
  `packages/contract/src/compile.ts(88,15): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is
  enabled.` (constructor parameter properties). Fixed by omitting `class` from the helper's type and assigning the
  fields in the constructor body.
- Export clashes found while writing the index: `layer`/`group` existed both as plain constructors
  (`document.ts`) and as builders; `Provenance` both as the entry's source and as the edit log's why-row. Renamed
  the constructors `layerEntry`/`groupEntry` and the row `WhyEntry`.
- `node tools/gen-docs/main.ts --check` failed on import: `SyntaxError: The requested module
  '@chromobench/contract' does not provide an export named 'MUTATION_OPS'` (snapshot.ts), and after fixing that
  the DSL and agent generators fail with `does not provide an export named 'settablePaths'`. Hence
  `--contract-only`; the full `pnpm gen` works again when P6 brings packages/dsl and packages/agent to contract 1.0.
- `contract-check.ts` crashed: `TypeError: Cannot read properties of undefined (reading 'capture.adapt')` (it read
  `cur.recipeFields`); now guarded and extended to document fields.
- Tests: two id clashes in my own fixtures (`E_MUTATION: insert: id "card" is already used (at masks)`; a component
  and an entry both `c1`) — the values rule that ids are unique in the whole document, working as designed.
- `maskCombine('intersect', a, b)` was not bit-commutative (`expected 0.0075 to be 0.007500000000000007`) because
  `v + 1·(r − v)` rounds; amount 1 now returns the op's result exactly, and `mixPixel` returns `top` at k = 1.
- `EditLog.why()` returned `undefined` for the initial value: I had read the path by splitting on dots; it now uses
  values' `getPath` (id-anchored).

### What I learned
- The property test initially compared only 206 of 300 cases: random dodge exposures independent of the main often
  exceeded it, and I skip cases where the dodge clamp engages (today floors before the lights, the law floors last;
  both print paper white there). Drawing a term's exposure below the main's (`x_main + U(−2.5, −0.4)`) brings it to
  nearly all cases; the test now asserts more than 250 comparisons so a generator change cannot hollow it out.
- A burn of 1 stop on a 10 s main is a 10 s exposure with the main's pack, so it is *the same node* as the main
  exposure (hash-consing); the law test had to give one sample per node, not per entry.

### What was tricky to build
- **Where bindings may read.** The print medium's illuminant is the darkroom's aim view, so the print medium is used
  before `darkroom.H`; its bindings may only read up to `negative` (`STAGES.print.mediumAfter`). The film pitch
  enters `source.open`, so the pitch fields (`stages.scan.medium.umPerPx`, `stages.film.medium.format.longEdge_mm`,
  `stages.darkroom.medium.magnification`) cannot be bound at all (`PITCH_FIELDS`). Each medium is bound just
  before its stage, so a binding's cut always exists when it runs.
- **Validation in two places.** A transaction may break rules midway (remove the main, insert a new one), so the
  per-mutation hook checks only the unit a mutation touched (found by walking the id index up to the nearest entry,
  mask or probe) and the per-transaction hook validates the whole document, including the global rules.
- **Coalescing without changing a pixel.** Folding a layer's amount into its spots' opacity is exact only for one
  spot (or amount 1); a multi-spot layer at amount < 1 compiles to its own heal node plus `composite.mix`, which ends
  the run. A toy 1-D evaluator in the test checks that the coalesced node and the layers kept apart give the same
  values.

### What warrants a second pair of eyes
- `stage-laws.ts` light law: the term roles, the seconds rule (`termSeconds`), the 0.1 s floor, the dodge's pack
  (the main's), and that main's amount and mask enter as `mainAmount`/`mainMask`.
- The floor placement in `lightH` (last, not before the lights): different from today only where H < 1e-8.
- `validate.ts` `unitOf`: the classification of a collection path (`stages.S.stack`, `<group>.stack`, `masks`,
  `probes`) decides which unit a mutation re-validates.
- Coalesced spots apply sequentially (decision 7 of Step 1): P2b's core implementation must define heal/clone that
  way, or the coalescing property does not hold.

### What should be done in the future
- P2b: implement the changed and new ops in core and the mock; translate the goldens (see the P2b notes in the final
  report); expect `neg-burn-and` to change (min → product, Decision D4).
- P6: bring packages/dsl and packages/agent to contract 1.0, then drop `--contract-only` from routine use.

### Code review instructions
- Start at `packages/contract/src/document.ts`, then `stage-laws.ts` (the three laws), `compile.ts`, `validate.ts`.
- Validate: `npx vitest run packages/contract`; `npx tsc -p packages/contract/tsconfig.json --noEmit`;
  `node tools/gen-docs/main.ts --contract-only --check`; `pnpm lint`; `node tools/gen-docs/contract-check.ts`.

### Technical details

Consumer breakage (repository typecheck: 850 error lines; vitest: 48 of 117 files fail, 186 tests), and why:

| Package | tsc errors | failing test files | Why (what it used) | Phase |
|---|---|---|---|---|
| packages/core | 68 | 7 | `FrameRecipe`, `defaultRecipe`, `Exposure`, `RetouchSpot`, `applyMutation`, `setPath` (compileExposures, bakeRecipe, balance); ops `print.lights`, `print.preflash`, old `print.combine` args, `mask.and/or/not/gradient`, `retouch.heal` | P2b |
| packages/engine-mock | 21 | 3 | `FrameRecipe`, `defaultRecipe`; pass-throughs for removed and new ops | P2b |
| packages/conformance, tools/goldens | 21 (goldens) | 1 | recipes, `MaskSpec`, `ExposureInput`, `assertRecipe`; the golden engine compiles recipes | P2b |
| packages/gpu | 35 | (browser suites) | `RetouchSpot`, `defaultRecipe`; lowering of `print.lights`, `print.preflash`, old combine, mask ops | P3 |
| packages/output | 18 | 1 | `FrameRecipe`, `defaultRecipe` (export reads the recipe) | P4/P5b |
| packages/ingest | 16 | 0 | `DustSpot` (dust detection output type) | P5b (dust heal layers) |
| packages/studio-kit | 326 | 16 | `FrameRecipe`, `Mutation`, `getPath`, `fieldPattern`, `fieldSpec`, `FrameSettings`, `applyMutation`, `defaultRecipe`, the EditLog shape | P4, P5b |
| apps/studio | 72 | 6 | `FrameRecipe`, `defaultRecipe`, `LoggedMutation`, `applyMutation` (host, first print) | P4, P5b |
| packages/dsl | 94 | 8 | `FrameRecipe`, `settablePaths`, `PRINT_OPTIONS`, `cut`/`accessorNode`, `getPath`, `applyMutation` | P6 |
| packages/agent | 45 | 6 | `Mutation`, `LoggedMutation`, `defaultRecipe`; `EvalResult.mutations` → `transactions` | P6 |
| tools/scripts | 6 | 0 | `defaultRecipe` (m1-headless) | P2b/P6 |
| tools/gen-docs (dsl/agent targets) | — | — | generated from packages/dsl and packages/agent | P6 |

## Step 3: Review pass — the laws read params with their defaults; final checks

Reading my own light law again against the validation rules, I found a gap between them: validation accepts a
stored layer that omits an argument with a default (the main exposure stored as `params: {}` is valid), but the law
read `time_s` straight from the stored params, so a burn given in stops would have computed `t_main·(2^s − 1)` from
`undefined`. The same gap hit coalescing, which multiplies each spot's `opacity` (defaulted to 1 in the schema). The
law context's `args` now binds the params through `bindArgs` (list Colls to arrays, defaults filled, checked), so
the laws always see complete arguments; a test stores the main as `{}` and spots without opacity or feather.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Finish P2a: review, fix, run the checks, report.

**Inferred user intent:** A contract the next phases can rely on without surprises.

**Commit (code):** b7a973f — "CHB-037 P2a: the laws read layer params with their defaults (a stored layer may omit a
defaulted argument); stale recipe comments"

### What I did
- `compile.ts`: `LawContext.args` = `bindArgs(op, paramsToArgs(op, params))` (warnings collected in
  `Compiled.warnings`); `cut(doc, g, name)` added for readers (commit 9ac785e).
- New test "stored params may omit defaulted arguments" in `compile.test.ts`.
- Fixed three stale comments that still said "recipe" (`source.ts`, `spec.ts`, `graph-types.ts`).

### Why
- One rule for what a stored value means: what validation accepts, the compiler must compile identically.

### What worked
- `npx vitest run packages/contract` → 7 files, 62 tests passed; `npx vitest run packages/values` → 51 passed.
- `pnpm exec tsc -p packages/contract/tsconfig.json --noEmit` → clean.
- `node tools/gen-docs/main.ts --contract-only --check` → `gen:check ok (15 files)`; `pnpm lint` → ok.
- `docmgr doctor --ticket CHB-037` → all checks passed.

### What didn't work
- N/A (the gap was found by reading, before a test failed).

### What I learned
- Binding the params once, at the law boundary, also normalises shapes (boxes, points, polylines) the same way the
  graph does, so the coalescing key (`canonicalJSON` of the non-list args) compares like with like.

### What was tricky to build
- Nothing new; the fix is one function. The subtlety is that validation and compilation read the same stored value
  through different code (schema.ts's `checkParams` vs the law), so both must apply the op's defaults.

### What warrants a second pair of eyes
- That every law reads params only through `ctx.args` (light: `expose` and each term; composite/repair: each layer).

### What should be done in the future
- P2b: a conformance case per new or changed op; the "mask at scale s equals the full-scale mask resampled" law of
  design §37 belongs to the engines (core and gpu), not to the contract.

### Code review instructions
- `packages/contract/src/compile.ts` (`Compiler.stack`, the `args` of the law context).
- `npx vitest run packages/contract/test/compile.test.ts`.

### Technical details
- Contract tests per file: light-law 4, compile 18, document 11, links-bindings 5, registry-graph 9,
  editlog-builders 5, units-laws (kept) 10.
