---
Title: Diary
Ticket: CHB-048
Status: active
Topics:
    - studio
    - colour
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://e2e/studio-before-the-film.spec.ts
      Note: e2e
    - Path: repo://packages/contract/src/media-presets.ts
      Note: LOOK-6 presets
    - Path: repo://packages/contract/src/pixel.ts
      Note: LAY-2 clipColour
    - Path: repo://packages/contract/src/white-balance.ts
      Note: LAY-1 definition
    - Path: repo://packages/core/src/print/gamut.ts
      Note: knee first exit
    - Path: repo://packages/gpu/kernels/working.wgsl
      Note: wkClipColour
    - Path: repo://packages/studio-kit/src/commands/media.ts
      Note: medium.preset
    - Path: repo://packages/studio-kit/src/commands/scene.ts
      Note: white balance command and tool
ExternalSources: []
Summary: 'CHB-048 implementation diary: white balance before the film (LAY-1), ClipColor for the OkLCh blends and the display knee first exit (LAY-2), film stocks, papers and grades as medium presets (LOOK-6).'
LastUpdated: 2026-11-15T20:25:10.499065-05:00
WhatFor: ""
WhenToUse: ""
---


# Diary

## Goal

What CHB-048 changed, why, what failed on the way (verbatim), the numbers, and how to review it. CHB-048 is the "before
the film" part of Phase 2 of the CHB-044 roadmap: LAY-1 (CHB-037 P9-12 t:ig9q, D2), LOOK-6 (CHB-021 t:xw53, D6), LAY-2
(CHB-037 P10-9 t:dpba). Worktree `<scratchpad>/chb048`, branch `task/chb-048-before-the-film` from main 697e036.

## Step 1: Reading and the shape of the three items

I read the Phase 2 brief, HANDOFF, the CHB-044 roadmap and decisions (D2, D6), CHB-045's spec and diary (the blend
code it just reworked: `BLEND_MODES`, the contrast modes in the display encoding, generated WGSL blend codes) and
CHB-046 as the model of a ticket; then the code. The white balance already existed half-way: the scene medium had
`whiteBalance { mode: daylight | as-shot | custom, temperature_K, tint }`, applied by `source.xyz` (core
`film/camera.ts`: CAT16 from the as-shot neutral or a custom white to D65), with a custom white on the CIE daylight
locus from 4000 K and a Planckian fit below (a jump in y of 0.007 at 4000 K) and an ad-hoc tint scale; the mock had a
gain hack `[1, 1, 6500/T]`; no control in any layout but the lab's "All parameters"; the studio set `as-shot` after
the open (`photoDocument`). Film stocks were already a select of ids (`stocks:film` included the pushed profiles as
stocks of their own); the film-stock and grade looks had been deleted in CHB-037 P7.

### Prompt Context

**User prompt (verbatim):** "You are implementing CHB-048 \"Before the film: white balance in scene light, film stocks and paper grades as medium presets, ClipColor for the OkLCh blend modes\" in chromobench. [...] Items (read each backlog row, its source tasks and the decision): 1. LAY-1 (CHB-037 P9-12 t:ig9q; decision D2): white balance before the film for camera files — temperature and tint applied in scene light, before the film's exposure, as a scene-stage control/layer. Define it once in the contract (the white-point adaptation: say which, e.g. a von Kries/CAT in the camera's or a working space, and why), in core, GPU and mock, with laws (identity at the as-shot white; neutral grey stays neutral through the film at the matching filtration; composition of two adjustments) and parity. As-shot white from the RAW metadata as the default; an eyedropper (click a neutral in the picture) is wanted; Kelvin and tint in his units. Controls in Classic's Develop/Print (where he would look for it; decide and record why) and a \"before the film\" palette in Darkroom first (the palette part of DARK-1 only). Scans (negatives) do not get this control; explain in the UI why if it is visible. 2. LOOK-6 (CHB-021 t:xw53, HANDOFF §9; decision D6): film stocks and paper grades as medium presets on the film and paper stages: choosing a stock sets the medium, from the data pack; they are not looks. A picker in his words (stock names as the data pack gives them), agent commands, undo, e2e. Check which stocks and papers the data pack actually has and list them in the diary. 3. LAY-2 (CHB-037 P10-9 t:dpba): the OkLCh hue/saturation/colour/luminosity blend modes apply W3C ClipColor (luminosity can leave the gamut today). Note: CHB-045 just reworked the blend code [...]. Goldens: LAY-1 must leave every existing golden unchanged at the default (as-shot) white balance — prove it; add goldens for a changed white balance and for one stock preset. Run gpu-parity on Metal under the GPU lock (pixels change). Ticket: CHB-048, created with docmgr. Diary, commits per item, no push, no merge. Report as the brief says." (The full prompt and the shared brief `phase2-brief.md` are in the session.)

**Assistant interpretation:** Build the three items through every layer (contract, core, GPU, mock, studio, agent
command, e2e), keep the goldens unchanged where asked and prove it, add two goldens, run all checks including Metal
gpu-parity under the lock, and keep the ticket.

**Inferred user intent:** The photographer can set a camera file's white balance before the film as in Lightroom,
choose film and paper by name, and blends never produce impossible colours, with the numbers defined once.

### What I did
- `docmgr ticket create --ticket CHB-048 …`, six tasks, the spec (`design-doc/01-spec-before-the-film.md`).
- Listed the default data pack's stocks with core (`nodePacksData().stockIds()`): see Technical details.

### Why
- The existing white balance decided the design: make it the one definition (contract) instead of adding a second.

### What worked
- The stage model already had the right place: `source.xyz` sits between the camera matrix and the scene stage
  (cut `scene.input`), i.e. in scene light before `capture.expose`.

### What didn't work
- N/A (reading).

### What I learned
- The pack (spektrafilm 0.3.2) carries display names (`info.name`) and each film's print stock; `names.ts` said it did
  not and made names from ids.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- N/A

### Code review instructions
- Start with the spec.

### Technical details
The default data pack's stocks (role | type | use | the pack's print stock | name):

| Kind | Stocks |
|---|---|
| Colour negative film (offered) | Fujifilm C200, Fujifilm Pro 400H, Fujifilm X-Tra 400, Kodak Ektar 100, Kodak Gold 200, Kodak Portra 160, Kodak Portra 400, Kodak Portra 800, Kodak Portra 800 (Push 1), Kodak Portra 800 (Push 2), Kodak Ultramax 400 (print stock: Portra Endura, or Crystal Archive for the Fujifilms) |
| Cinema negative film (offered) | Kodak Verita 200D, Kodak Vision3 200T, 250D, 500T, 50D (print stock: Kodak Vision 2383) |
| Slide film (not offered) | Fujifilm Provia 100F, Fujifilm Velvia 100, Kodak Ektachrome 100, Kodak Kodachrome 64 |
| Colour paper | Fujifilm Crystal Archive Type II, Kodak Ektacolor Edge, Kodak Professional Endura Premier, Kodak Professional Portra Endura, Kodak Professional Supra Endura, Kodak Professional Ultra Endura |
| Cinema print film | Kodak Vision 2383, Kodak Vision Premier 2393 |

## Step 2: LAY-1 — the white balance defined once (contract 3.0, CC-027)

The white balance is now the white of the light the scene was lit by, stored as Temperature and Tint in Lightroom's
units, and applied as one CAT16 adaptation from that white to D65 in `source.xyz`. The conversion temperature/tint ↔
white is Robertson's isotemperature lines in CIE 1960 uv with Adobe's tint scale (offset along the line × −3000), so
"5150 K, +8" means what it means in Lightroom; the inverse is closed form (a quadratic per segment), exact to 3e-14 over
2000–50000 K and ±150. "As shot" is the raw's white written into the document when the frame is opened; "None" (D65)
is the camera's own XYZ. `mode` is gone (hard cut-off). Every golden is reproduced bit for bit.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Item 1, the engine half: contract definition, core, GPU, mock, laws, parity, goldens.

**Inferred user intent:** One white balance everybody computes the same way, in the photographer's numbers.

**Commit (code):** 16fae66 — "CHB-048: LAY-1 (D2) white balance before the film defined once in the contract: the light's white as temperature and tint in Lightroom's units, CAT16 to D65; as-shot default from the raw"

### What I did
- `packages/contract/src/white-balance.ts`: Robertson's table, `temperatureToWhite`, `whiteToTemperature`, `cat16`
  (moved from core's `cat16Matrix`), `sceneMatrix`, `asShotWhiteBalance`, `NO_CORRECTION`, `pickedWhiteBalance`,
  `WHITE_BALANCE_PRESETS`. `SceneMedium.whiteBalance: { temperature_K, tint }`; `source.xyz` takes them (defaults: None);
  `NewDocumentOptions.whiteBalance`.
- Core: `ops/film.ts sceneMatrixAt` calls `sceneMatrix`; `film/camera.ts` deleted; `expose.ts` uses `cat16`; colour
  constants (D65, CAT16, sRGB→XYZ) are the contract's. GPU binds core's matrix (no change). Mock: `whiteBalanceMatrix`
  after its sRGB camera.
- Studio: `defaultDocument` takes the camera's as-shot white; `photoDocument` deleted (main.ts, tests).
- Goldens: `translate.ts` translates P0's modes (daylight → None, as-shot → the fixture's as-shot white 5391.6 K +12.69,
  P0's custom 4000 K +10 on its own scale → 4022.7 K +5.97 via a copy of P0's custom white kept only there); fixed its
  `main` to keep the stack cases (it crashed on `stack-print-tone/recipe.json`); new case `cam-wb-tungsten` via `stacks.ts`.
- Tests: contract `white-balance.test.ts` (9), core `white-balance.test.ts`, mock `white-balance.test.ts`, GPU
  `film.spec.ts` (a changed white balance against core).

### Why
- CAT16 in XYZ: camera-independent, the same transform as the film's reference adaptation (they compose exactly), the
  CIE's current recommendation; camera-RGB multipliers mean nothing for a file without a raw camera.
- Lightroom's units: the photographer reads Lightroom's numbers; the old daylight-locus scale jumped at 4000 K.

### What worked
- `node tools/goldens/render.ts --check`: 66/66 cases, max |Δ| = 0 at both cuts after the re-translation, the proof
  that the as-shot white (and None, and P0's custom white) are the same pictures. Robertson anchors: D55 → 5501.5 K
  +10.0 (Lightroom's Daylight 5500 +10), illuminant A → 2855.8 K +0.008 (Tungsten 2850 0), D65 → 6502.1 K +9.77.
- Laws: the as-shot matrix equals the pre-3.0 one to 1e-13; a change of white is one CAT16 (1e-13) and two changes
  are one; the eyedropper finds the light of a grey to 1e-6 K and is idempotent; a tungsten grey white-balanced to
  3200 K is the daylight grey at the scene cut (1e-12) and through the film to the print (1e-9), while uncorrected it
  prints far towards red-yellow.

### What didn't work
- The first smoothness test of Robertson's table (ratio of consecutive differences within 1.6) failed on v at 575 mired
  (`expected 0.4814814814815652 to be greater than 0.625`): v flattens there. Replaced by the slope's convexity and
  u/v ratios in [0.4, 1.25] plus an explicit check of u at 325 mired (the two typos other copies of the table carry).
- `node tools/goldens/translate.ts` crashed after writing the documents: `ENOENT … cases/stack-print-tone/recipe.json`
  (the stacks have no recipe); fixed in its `main`.

### What I learned
- The golden stack documents depend on `cam-auto`'s document, so `stacks.ts` must re-run after `translate.ts`.

### What was tricky to build
- The exact inverse: Adobe's own Set_xy_coord interpolates between two lines' distances, which is not the inverse of
  its Get_xy_coord; the point lies on the interpolated line where cross(P − bb(s), d(s)) = 0, a quadratic in s per
  segment; two lines meet far from the locus, so the root nearest the locus is taken.

### What warrants a second pair of eyes
- Removing `mode` (documents) and the stored as-shot white as numbers; the ranges 2000–50000 K and ±150 clamp an
  unusual camera neutral (then As shot is approximate).

### What should be done in the future
- N/A

### Code review instructions
- `packages/contract/src/white-balance.ts`, `test/white-balance.test.ts`; core `ops/film.ts`, `test/white-balance.test.ts`;
  `tools/goldens/translate.ts translateWhiteBalance`.
- `npx vitest run packages/contract/test/white-balance.test.ts packages/core/test/white-balance.test.ts`;
  `node tools/goldens/render.ts --check`.

### Technical details
- Tint sign: + is a greener light (y up), so the picture is corrected towards magenta, as Lightroom's slider.

## Step 3: LAY-1 — the controls, the eyedropper, the palettes

Classic's Print module has a "White balance (before the film)" panel first after the tools: Lightroom's white balance
is the first control of Develop's Basic panel and Classic's Print is Develop (key D). The Scene module has it on top.
Darkroom first gets a "Before the film" palette under the Enlarger. The panel: a preset picker (As shot with this
frame's numbers, Lightroom's Daylight, Cloudy, Shade, Tungsten, Fluorescent, Flash, None, or Custom), Temperature and
Tint (the generated controls), "Pick a neutral" (the eyedropper tool, W), a line saying what it does. A negative shows
why it has none ("its colours were fixed when the film was exposed…").

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Item 1, the UI and agent half.

**Inferred user intent:** He finds the white balance where Lightroom has it and uses it the same way.

**Commit (code):** b225e76 — "CHB-048: LAY-1 in the studio: the White balance panel (presets, Temperature, Tint, Pick a neutral) in Classic's Print and Scene, a Before the film palette in Darkroom first, scene.whiteBalance and the eyedropper tool"

### What I did
- `src/commands/scene.ts`: `scene.whiteBalance` ({ temperature_K, tint } | { preset } | { at: [x, y] }; one step;
  refuses a negative with the panel's words) and the tool `white-balance` (one click, then no tool). The eyedropper
  samples `scene.input` (stack kit `sampleCut`) and calls the contract's `pickedWhiteBalance`.
- `src/model/white-balance.ts`, `src/model/presets.ts`, form `cb.preset` and its renderer; the frame's catalog entry
  keeps the raw's as-shot white (`asShot`) so the picker can name it; `cb.panels.whiteBalance`, `cb.views.whiteBalance`,
  `cb.sel.isPhoto`; the stack kit's Scene module and `layouts/darkroom.js` (module stages now scene, darkroom, print).
- e2e `studio-before-the-film.spec.ts` (Classic; Darkroom first); layout snapshots.

### Why
- A medium value, not a layer: one light per frame (as Lightroom), one undo step per change, the scene's layers stay
  for local edits (LAY-6 will add a temperature/tint layer for masks).

### What worked
- The generated Temperature and Tint controls work unchanged on the new fields (drag, typed values, undo); the history
  says "Temperature 3394 → 2850 K; Tint −58 → 0".

### What didn't work
- First e2e run: both tests timed out in `opened()` — the uniform warm card raised the "Photo or negative?" dialog
  ("the picture shows orange throughout, but no film edge"); the test now answers "Photos from a camera".
- `locator.click: Test timeout … getByRole('button', { name: 'Pick a neutral' })`: a button with `run` takes the
  command's label as its accessible name ("White Balance (click a neutral)"); located by text.
- I committed once with a type error in the e2e (`window.chromobench.doc` possibly null) because `pnpm typecheck | tail`
  hid the exit code; amended.

### What I learned
- `wb.run` in the default ask mode proposes; the e2e switches `agent.mode` to auto.

### What was tricky to build
- The picker's "As shot" needs the raw's white, which the document does not keep apart from its values: the catalog
  entry (view tier) holds it from `SourceInfo.camera` when the frame is catalogued.

### What warrants a second pair of eyes
- Double-click reset on Temperature goes to the ArgSpec default (None, 6502 K), not to As shot; the picker's As shot is
  the way back.

### What should be done in the future
- DARK-1's other palettes (Finish, ring-around, test strip) are not this ticket's.

### Code review instructions
- `packages/studio-kit/src/commands/scene.ts`, `src/model/presets.ts`, `src/dom/panels.ts` (`preset`), `src/cb.ts`
  (`whiteBalanceView`), `layouts/darkroom.js`, `e2e/studio-before-the-film.spec.ts`.

### Technical details
- The synthetic DNG's as-shot neutral [0.75, 1, 0.62] reads 3394 K −58; Tungsten makes the card bluer by > 0.05; a pick on
  the card lowers its channel spread; a second pick at the same document point moves < 15 K and < 1 tint.

## Step 4: LAY-2 — ClipColor in OkLCh, and a discontinuity in the display knee

The four OkLCh modes now keep the gamut: a result whose linear RGB leaves [0, top] (top: the brighter of white and the
inputs' brightest channel, so W3C's cube for inputs in [0, 1]) keeps its OkLab L and hue and takes the chroma of the
first exit from grey. One definition in the contract (`blendOkLch`, `clipColour`), core, WGSL and mock call it.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Item 3 on top of CHB-045's blend code.

**Inferred user intent:** No impossible colours from luminosity and the other OkLCh modes.

**Commit (code):** 43dc1d6 — "CHB-048: LAY-2 the OkLCh blend modes keep the gamut (W3C ClipColor in OkLCh, the first exit from grey); the display knee's chroma search finds the first exit too"

### What I did
- Contract `pixel.ts`: `blendOkLch` (moved from core), `gamutTop`, `clipColour`, `CLIP_MARCH` 32, `CLIP_STEPS` 24,
  `CLIP_EPS` 1e-6. Core `blendPixel`; GPU `working.wgsl wkClipColour` (constants generated into `blend-codes`); mock.
- Tests: contract `clip-colour.test.ts`; core `composite.test.ts` and conformance semantics updated (lightness exact,
  the chroma never raised, the hue kept); core `knee-first-exit.test.ts`.
- Golden `stack-print-blends` re-rendered (record in `tools/goldens/README.md`).
- `law:digital-doc` now reports the worst display pixel's values in both engines at display and at finished.

### Why
- W3C ClipColor moves towards the grey of the same luminance; here luminance is OkLab L, so the move is along the
  chroma axis at constant L and hue.

### What worked
- Golden before → after (display, max/mean |Δ|): 8.17e-2 / 1.41e-3; mean RGB 0.2993 0.3141 0.3164 → 0.2991 0.3144 0.3201;
  903 of 6144 pixels change, 591 by more than one 8-bit level. GPU `law:blend` and `law:digital-doc` pass (blends
  display ≤ 1 level, max 1.0e-3).

### What didn't work
- GPU parity after the first version: `documents with print stacks … Error: blends Expected: <= 1 Received: 6` (display
  max 0.0259 at pixel 141) while the finished cut agreed to 1e-5 at that pixel. A gamut tolerance did not change it.
  A debug parity run of the display op alone on the two engines' finished values showed GPU = core for each input:
  core's own knee gave linear blue 0.4434 and 0.4810 for XYZ 1e-5 apart. Along the ray of constant OkLab L and hue the
  sRGB gamut of that deep blue is `#####…####....##....` (out, in, out), and `maxChromaOf`'s bisection over [0, 0.5]
  landed on either exit. Pre-existing in output.display (core and GPU alike); LAY-2 put colours onto the working gamut's
  edge where the parity document met it.
- The first core continuity bound (1e-4) was too tight: the knee is steep there (8.6e-4 over the segment, smooth).

### What I learned
- The gamut along a constant-L, constant-hue ray is not always an interval, so "the largest chroma that fits" must be
  the first exit, both for ClipColor and for the knee.

### What was tricky to build
- Making both searches agree across f32 and f64: a march out from grey (32 / 64 steps) then a bisection of the step;
  `CLIP_EPS` so an edge colour blended again is inside in both engines.

### What warrants a second pair of eyes
- The knee change touches output.display (the Output agent's area): `maxChromaOf` and `okMaxChroma` march first; no
  golden changed; the GPU output parity passes. A gap narrower than a march step can still be skipped.
- The top of the gamut (`gamutTop`) for scene-linear highlights.

### What should be done in the future
- A backlog item for the integrator: output.display's knee had a discontinuity for deep blues near the sRGB edge
  (fixed here); check it on the photographer's pictures.

### Code review instructions
- `packages/contract/src/pixel.ts` (end), `packages/gpu/kernels/working.wgsl` (`wkClipColour`), `pointwise.wgsl`
  (`okMaxChroma`), core `print/gamut.ts maxChromaOf`, the tests named above.
- `… playwright test packages/gpu/test/browser/digital.spec.ts packages/gpu/test/browser/output.spec.ts --project gpu-parity`.

### Technical details
- The worst parity pixel before the knee fix: GPU display (0.00877, 0.1542, 0.6968), core (0.00194, 0.1309, 0.7227);
  finished XYZ (0.081495, 0.035263, 0.420265) vs (0.081500, 0.035264, 0.420275).

## Step 5: LOOK-6 — film stocks, papers and grades as medium presets

Choosing a film, a paper or a grade sets the medium from the data pack, named as the pack names it; a pushed profile
("Kodak Portra 800 (Push 1)") is the base stock developed one stop pushed; slide films are not offered; grades 0 … 5 in
halves. The stock selects of the generated controls are the pickers (groups, Custom when the medium is none of them);
the grade is a picker of named grades. Agents: `medium.preset { kind, preset }` and `medium.presets`.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Item 2.

**Inferred user intent:** He picks his film and paper by their names, as in Dehancer.

**Commit (code):** 0588159 — "CHB-048: LOOK-6 (D6) film stocks, papers and paper grades as medium presets from the data pack, by the pack's names; medium.preset, the pickers, a golden"

### What I did
- Contract `media-presets.ts` (CC-029); the host's `stockFactsOf` and `setMediumStocks` / `setStockNames`
  (`apps/studio/src/host/engines.ts`, `main.ts`); studio-kit `commands/media.ts`, `model/presets.ts`, the preset branch
  of `dom/arg.ts`, the grade picker in `cb.controls` and Darkroom first's Paper panel, the film in Before the film.
- Golden `cam-film-portra-800-push1` (from `filmPresets` over the pack); core `media-presets.test.ts`; e2e LOOK-6.

### Why
- D6: a stock is the medium itself, not an edit; the old film looks also changed grain and halation, which are the
  photographer's adjustments relative to the stock and now stay.

### What worked
- e2e: Portra 800 (Push 1) sets stock and push and changes the print; undo; Supra Endura; Grade 3 (hard); the agent's
  Gold 200.

### What didn't work
- `studio-wording.spec.ts` (mock engine, no data pack) still reads the id-derived name "Kodak Portra Endura"; I had
  changed it to the pack's name and reverted.

### What I learned
- Grain, halation and DIR in the film medium are multipliers of the stock's own (the pack keys them by stock), so
  switching the stock already switches their data.

### What was tricky to build
- The picker's state is the medium (stock and push), not the control's one path: the arg control's preset branch
  watches the medium.

### What warrants a second pair of eyes
- The grade slider is replaced by the named-grade picker in Classic's Darkroom controls and Darkroom first (the slider
  stays in All parameters); a grade between halves shows as Custom.

### What should be done in the future
- The scan's film (the negative's stock) is still a plain select of ids with pack names; a preset there would need the
  roll's linked medium.

### Code review instructions
- `packages/contract/src/media-presets.ts`, `packages/studio-kit/src/commands/media.ts`, `src/model/presets.ts`,
  `src/dom/arg.ts` (preset branch), `tools/goldens/stacks.ts filmPreset`.

### Technical details
- Golden `cam-film-portra-800-push1`: display mean 0.479 0.427 0.340 (cam-auto 0.512 0.468 0.379).

## Step 6: Checks, Metal, the contract number

Every check passes: typecheck, lint, gen:check, contract:check, vitest, the 68 goldens, the SwiftShader browser suite
and gpu-parity on Metal under the lock. The integrator then asked for the contract number after CHB-049's 1.6.0 /
CC-025 and CHB-047's 2.0.0 / CC-026: CHB-048 removes a document field, so it is 3.0.0 with CC-027 (white balance),
CC-028 (ClipColor), CC-029 (medium presets); STORAGE_FORMAT 5 (CHB-047 took 4) clears saved edits of the old format.

### Prompt Context

**User prompt (verbatim):** (see Step 1) and the coordinator's note: "Contract numbering note from the integrator: CHB-049 and CHB-047 are merged into task/chb-037-unified-model (790453a). They took contract 1.6.0 / CC-025 (CHB-049: selections) and 2.0.0 / CC-026 (CHB-047: output.export.scale removed, breaking). If your work changes the contract, number it 2.1.0 and CC-027 (or 3.0.0 if breaking). Run `pnpm contract:check` too (it must pass). Don't merge or rebase; I resolve conflicts at merge. STORAGE_FORMAT is already 4 on the integration branch (CHB-047); if you need a bump, use 5."

**Assistant interpretation:** Run every check; renumber the contract and the storage format as the integrator says.

**Inferred user intent:** A branch the integrator can merge without numbering collisions.

**Commit (code):** 94094bd — "CHB-048: contract 3.0.0 (CC-027 white balance, CC-028 ClipColor, CC-029 medium presets) after CHB-049's 1.6.0 and CHB-047's 2.0.0; STORAGE_FORMAT 5"

### What I did
- `pnpm typecheck` (0 errors), `pnpm lint` (518 file checks), `pnpm gen:check` (26 files), `pnpm contract:check`
  (1.5.0 on main → 3.0.0: 7 changes, 4 breaking, exit 0), `npx vitest run` (153 files, 3479 passed, 19 skipped),
  `node tools/goldens/render.ts --check` (68/68 within 1e-5).
- `STUDIO_PORT=5581 GPU_PARITY_PORT=5582 STUDIO_KIT_PORT=5583 SHELL_DEMO_PORT=5584 CI=1 pnpm test:browser`: 170 passed, 2
  skipped, 16.2 min (conformance 525/525).
- `REAL_GPU=1 CI=1 … zsh <scratchpad>/chb041-lock.sh npx playwright test --project gpu-parity`: 62 passed, 2 skipped,
  57 s, adapter apple metal-3; the white balance parity at 3200 K +15 within 5.9e-7 (scene XYZ); the blends document's
  display within one 8-bit level (max 1.05e-3).

### Why
- The brief's checks; the integrator's numbering.

### What worked
- Everything above, after the fixes recorded in Steps 2–5.

### What didn't work
- One full `npx vitest run` while other agents loaded the machine failed two unrelated slow tests on time
  (`packages/ingest/test/gold200.test.ts` "f32 summed-area tables lose σ on a 4096² frame" 138 s, `apps/studio/test/host.test.ts`
  "measures the base on the film edge" 62 s); alone they pass (26/26), and the final full run passed.

### What I learned
- `contract:check` compares with main's snapshot; a major bump accepts breaking changes.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- The merge of `CONTRACT-DECISIONS.md` (my 3.0 section after the integrator's 1.6 and 2.0), `STORAGE_FORMAT`, the
  layout snapshots and `docs/HANDOFF.md` §9.

### What should be done in the future
- The open tasks in `tasks.md`: reset to As shot, the scan's film as a preset, the knee on real pictures.

### Code review instructions
- `git log main..task/chb-048-before-the-film`; the checks above.

### Technical details
- Commits: 16fae66 (LAY-1 engine), b225e76 (LAY-1 UI), 43dc1d6 (LAY-2 and the knee), 0588159 (LOOK-6), 94094bd (numbering).
