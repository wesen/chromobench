---
Title: Diary — phase P8a ops
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
    - Path: repo://packages/contract/src/catalog/adjust.ts
      Note: The composite op set and composite.encode (commit 007a30e)
    - Path: repo://packages/contract/src/compile.ts
      Note: encode/encodingOf, colour component input, scene.input (commit 007a30e)
    - Path: repo://packages/contract/src/encodings.ts
      Note: Working encodings as domains (commit 007a30e)
    - Path: repo://packages/contract/src/stage-laws.ts
      Note: Composite law with encodings and blend modes (commit 007a30e)
    - Path: repo://packages/core/src/composite/adjust.ts
      Note: hsl, vibrance, grade, mixer, vignette (commit 3c09973)
    - Path: repo://packages/core/src/composite/blend.ts
      Note: The 16 blend modes (commit 3c09973)
    - Path: repo://packages/core/src/composite/tone.ts
      Note: Monotone curve and levels (commit 3c09973)
    - Path: repo://packages/core/src/composite/working.ts
      Note: f64 working encodings (commit 3c09973)
    - Path: repo://packages/gpu/kernels/working.wgsl
      Note: Blend modes and encodings in WGSL (commit 4299a90)
    - Path: repo://packages/gpu/src/engine/dag.ts
      Note: 'fusedMixTop: the fused composite.mix (commit 4299a90)'
    - Path: repo://packages/gpu/src/engine/lower.ts
      Note: lowerDigital and the SAVE…MIX span (commit 4299a90)
    - Path: repo://packages/gpu/src/parity/digital-tests.ts
      Note: Parity and bench of the digital layers (commit 4299a90)
    - Path: repo://tools/goldens/stacks.ts
      Note: Golden stacks provenance (commit 3c09973)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T00:58:19.263229-05:00
WhatFor: ""
WhenToUse: ""
---



# Diary

## Goal

The phase agent's record of phase P8a of CHB-037: Editor lab's tools in the engine — the composite op set (curve,
levels, exposure, hsl, vibrance, grade, mixer, vignette, sharpen beside clarity), the mask components colour and
radial, the W3C blend modes in the composite law with isolated groups, linear ↔ OkLab encodings inserted by the
compiler and fused on the GPU, the scene stage for camera files; each op with a reference implementation (core, f64),
a GPU implementation with parity, a conformance case and laws; golden stacks. Spec: plan
`design-doc/01-implementation-plan-and-working-rules.md` "P8a — Editor lab's tools in the engine" plus every
"Amendments after …" section; design: CHB-035 design 01 v2 Part I §3–§8, Part II §9–§13, §20–§23, §29, §37.

## Step 1: Reading the spec, the design, the three engines and Editor lab; the decisions the spec leaves open

The main agent assigned me phase P8a. Before writing code I read the working rules (§1–§2), the P8a spec and every
amendment, the design sections it names, the P2a, P2b and P3 diaries, CC-019, and the code the ops touch: the
contract's catalogue (`catalog/layers.ts`, `view-output-mask.ts`), `registry.ts`, `stage-laws.ts`, `compile.ts`,
`document.ts`, `pixel.ts`, `validate.ts`; core's `ops/ops.ts`, `print/{clarity,masks,gamut,colour}.ts`,
`film/camera.ts`; the GPU's `engine-gpu.ts`, `engine/{defs,dag,lower,light,textures}.ts`, `chain/{program,run}.ts`,
`kernels/{pointwise,combine}.wgsl`; conformance's generator; and Editor lab's `src/engine.js` (blend modes 139–184,
layer kinds 212–286, mask components 356–397 and 571–580, `unsharp` 287–297).

The model makes most of the shape: an op is a catalogue entry with stages and an encoding, the composite law
compiles each entry into its op's node plus `composite.mix`, the scene stage already compiles for camera files.
What it leaves open is what "linear" and "OkLab" are as numbers in a graph whose composite stages hold XYZ, where
the coverage mix and the blend happen, how per-channel tools fit one encoding per op, and what each op's parameters
mean. The decisions are under Technical details; the code follows them.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all."

The owner's goal (verbatim): "the target goal is to a have a powerful professional lightroom for my dad, who often
works with film (either scanning, or as film simulation), but have a flexible UI language that allows for many
reconfigurations of the application while looking cohesive and elegant. We also combine high performance webgpu
functionality, and are adding a full layer system photoshop/traditional lightroom capabilities."

**Assistant interpretation:** The main agent split CHB-037 into phases and assigned me P8a: put Editor lab's
digital tools into the engine on contract 1.0 — new layer ops and mask components in the catalogue, the blend modes
in the composite law, encodings inserted by the compiler, the scene stage, each op in core (f64) and on the GPU with
parity, conformance and laws, golden stacks — with no Editor lab defects and with the catalogue's conventions.

**Inferred user intent:** The photographer gets Lightroom/Photoshop's adjustment layers (curves, levels, HSL,
grading, mixer, vignette, sharpening, colour and radial masks, blend modes, groups) on top of the physical chain,
computed in linear light and OkLab rather than on sRGB numbers, fast on the GPU, and exactly the same in the
reference engine, so the studio and the agent can rely on one definition per op.

### What I did
- Read the documents and code listed above; `pnpm install --frozen-lockfile --prefer-offline` (no package added).
- Baseline: `npx vitest run packages/contract packages/core packages/gpu packages/conformance packages/engine-mock
  tools/goldens` → 39 files, 1224 passed, 7 skipped. Per-package typecheck: contract and conformance clean; core and
  gpu report only `packages/ingest` (`DustSpot`, P5b-1's).
- Created this diary (`docmgr doc add --ticket CHB-037 --doc-type diary --title "Diary — phase P8a ops"`), renamed
  `11-diary-phase-p8a-ops.md` to `11-phase-p8a-ops.md`.

### Why
- Every new op needs the same definition in three places (catalogue, core, WGSL); the numbers it computes on had to
  be fixed before the first line, or the GPU would mirror a moving target.

### What worked
- The composite law already compiles an entry as "op node on the backdrop, then `composite.mix`", and the scene
  stage's stack is already compiled between `source.xyz` and `capture.expose`; both extend without new structure.

### What didn't work
- N/A (reading only).

### What I learned
- Editor lab's tools are all display-referred: exposure and temperature convert sRGB to linear and back
  (`engine.js:231`), levels and its "curves" act on sRGB numbers (`:234`, `:237`), vibrance and black-and-white use
  sRGB averages (`:250`, `:255`), unsharp clamps to [0, 1] (`:287–297`). Only the structure and the formulas'
  shapes transfer; every parameter scale is re-defined below.
- Its curve (`curveLut`, `:202–211`) is the defect of design §13 (negative contrast adds contrast): the new `curve`
  is a point curve, not a parametric one.
- A neutral grey has OkLab L = ∛Y exactly when the LMS matrix's rows are normalised (core `oklabFor`) and M2's first
  row sums to 1: so "the cube root of a linear RGB channel" is the per-channel lightness that equals OkLab L on
  neutrals. That is what lets per-channel curves and levels share the L curve's meaning.

### What was tricky to build
- N/A (decisions only). The sharp edge ahead: the fused `composite.mix` on the GPU needs a second register in the
  pointwise kernel and a segment boundary that never falls between saving the backdrop and mixing.

### What warrants a second pair of eyes
- Decisions 2–4 below (what the encodings are as numbers, where mixing and blending happen): every later op and
  both engines depend on them.

### What should be done in the future
- N/A for this step.

### Code review instructions
- Nothing to review yet; the decisions are listed below.

### Technical details

Decisions the spec and design leave open (made here; the code follows them):

1. **Encodings are domains.** A composite stage holds XYZ (`scene-xyz`, `print-xyz`: the op encoding `stage`). The
   two working encodings are new domains per stage: `scene-rgb` / `print-rgb` (linear Rec. 2020 under D65, white =
   (1, 1, 1)·Y_white, for "linear" ops) and `scene-oklab` / `print-oklab` (OkLab over that RGB, core's
   `oklabFor('rec2020')`: white L = 1, a = b = 0). One node op `composite.encode { to, white }` converts between them
   (`domainFromArg: 'to'`); `white` is the XYZ white of the stage (print: `output.white`, after `view.adapt`; scene:
   D65, the white `source.xyz` balances to) and enters the XYZ ↔ RGB matrix through a Bradford adaptation.
2. **The compiler inserts the conversions.** Each layer's input is converted to its op's encoding (`ctx.encode`),
   adjacent ops in one encoding need none, a conversion of a conversion is folded into one from the original node
   (so a round trip never appears), and the stack's result returns to the stage's XYZ for the next stage.
3. **Where an entry mixes.** `out = back + k·(B(back, top) − back)` is computed in the encoding of the entry's
   result (the op's encoding for a layer, whatever its last child left for a group), as design §22 writes the law.
   A blend other than normal needs a working encoding: a result in the stage's XYZ is converted to linear first.
4. **Blend modes.** The 16 W3C modes in kebab case with British spelling, as the catalogue spells colour: normal,
   multiply, screen, overlay, darken, lighten, colour-dodge, colour-burn, hard-light, soft-light, difference,
   exclusion, hue, saturation, colour, luminosity. Separable modes are the W3C formulas in linear RGB (white = 1),
   evaluated on whatever encoding the entry mixes in (an OkLab entry's values are converted to RGB for B and back);
   the non-separable modes are defined in OkLCh: hue = (L_b, C_b, h_s), saturation = (L_b, C_s, h_b), colour =
   (L_b, a_s, b_s), luminosity = (L_s, a_b, b_b) — luminance defined once, in the working space (design §5, §22),
   no SetLum/ClipColor (the output knee handles gamut). Editor lab's `add`/`subtract` are not in the W3C set and
   not added.
5. **Isolated groups** keep P2a's semantics (no source layers exist: the children act on the backdrop, the group's
   result is blended as one layer with its mode); with modes other than normal they now differ from pass groups.
6. **Per-channel tools.** An op's encoding may depend on its params (`OpDef.encoding` a function): `curve` and
   `levels` take `channel: 'L' | 'R' | 'G' | 'B'`; L acts on OkLab L (encoding `oklab`), a colour channel on the
   cube root of that linear RGB channel (encoding `linear`), so R, G and B layers fuse with each other and with
   exposure or the mixer without conversions, and a neutral's R = G = B curve is its L curve.
7. **curve**: a monotone cubic (Fritsch–Carlson PCHIP) through 2–16 points `{x, y}` in [0, 1] (in a document a Coll),
   linear beyond the end points with the end tangents. The GPU evaluates the same Hermite segments from the op data
   rather than a sampled LUT (exact parity; a 16-point loop per channel costs nothing measurable — measured in the
   timing step).
8. **levels**: `black`, `white`, `gamma`, `outBlack`, `outWhite` on the channel's lightness:
   `out = outBlack + (outWhite − outBlack)·clamp((x − black)/(white − black), 0, 1)^(1/gamma)` (clips like Levels).
9. **exposure**: `stops` (EV) and `offset` (fraction of white) in linear RGB: `rgb·2^stops + offset`.
10. **hsl**: a list of hue bands `{hue_deg (centre), width_deg, hue (shift, deg), saturation, lightness}` (default the
    eight Lightroom bands, zero shifts); band weight `smoothstep(cos width, 1, cos(h − centre))` (no per-pixel trig),
    normalised by max(1, Σw), faded by chroma `smoothstep(0, 0.04, C)`; `h += Σw·hue`, `C ·= max(0, 1 + Σw·sat)`,
    `L += 0.25·Σw·lightness`. Hue shifts are limited to ±60°, so the GPU rotates with a polynomial sin/cos accurate to
    1e-7 instead of WGSL's sin/cos (2^−11 on SwiftShader, P3).
11. **vibrance**: `C ·= (1 + v·(1 − C/0.3)²)` below C = 0.3 (monotone for |v| ≤ 1), then `C ·= 1 + saturation`.
12. **grade**: shadow, midtone and highlight wheels (hue_deg, chroma, lightness each) and `balance`; weights the
    Bernstein basis (1 − t)², 2t(1 − t), t² of t = clamp(L, 0, 1)^(2^−balance); `a, b += L·Σ w·c·(cos h, sin h)`
    (black stays black), `L += 0.25·Σ w·lightness`.
13. **mixer**: rows `red`, `green`, `blue` (vec3, output channel from R, G, B) or `monochrome` with `grey` weights
    (default Rec. 2020 luminance): one 3 × 3 matrix in linear RGB either way.
14. **vignette**: `stops` at the corners, `size` (where the falloff starts, a fraction of the centre-to-corner
    distance on the frame's ellipse), `feather`; `rgb·2^(stops·smoothstep(size, size + feather·(1 − size), ρ))`,
    centred on the frame (document px, not the crop).
15. **sharpen**: print only (mm on the print), stage encoding like clarity, the same lightness detail without the
    midtone weight: `L′ = max(0, L + s·(L − L̄))`, `out = XYZ·(L′/L)³`. clarity's encoding is `stage` (it computes on
    the print's XYZ; declaring `linear` would have inserted two needless conversions).
16. **Masks**: `mask.radial { box, angle_deg, feather }` (1 inside the ellipse scaled by 1 − feather, smoothstep to 0
    at its edge: Editor lab's radial, `engine.js:576–579`, in document px) and `mask.colour { colour (OkLab), tolerance,
    softness }` (`1 − smoothstep(tol, tol + soft, ΔE_OK)`), whose receiver the compiler encodes to OkLab (so it is
    shared with the layers' conversion of the same image).
17. **The scene stage's masks** read a new cut `scene.input` (the white-balanced scene XYZ, before the scene stack);
    `scene` stays the scene after its stack. Cut orders are renumbered so a scene mask cannot read its own output.
18. **Fusion on the GPU**: `composite.mix` without a mask whose top is a chain of pointwise ops on its backdrop
    lowers into the pointwise kernel (SAVE the backdrop, the top's ops, MIX), so an unmasked layer at any amount or
    blend costs no barrier; a masked mix stays one combine pass. The kernel gains an op-data storage buffer
    (matrices, curve segments, bands) addressed by each op.
19. **UI fields for the "+ Layer" menu** (P5b-2): `OpDef.ui = { label, menu, order }` on every layer op and
    `UiHints.advanced` on secondary arguments.

## Step 2: The contract — the op set, blend modes, encodings as domains, the scene stage's input

I built the contract side first because both engines read it: the catalogue entries with their ArgSpecs, units,
encodings and identities, the blend modes, the working encodings as domains with one conversion op, the composite
law that inserts conversions and mixes in the entry's encoding, the colour and radial mask components, and the cut
`scene.input`. The law test came out right on the first run except for my own fixture (the same point ids twice in
one document, which values refuses as it should).

The rule "a conversion of a conversion converts the original node" is what keeps fusion honest: a curve, an HSL and
a vibrance layer compile to one conversion in, three ops, one conversion out (`→oklab curve hsl vibrance →xyz`), and a
stack whose layers are all identities compiles to the same node as no stack at all.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Implement decisions 1–19 of Step 1 in `packages/contract`, keep its tests, typecheck
and generated docs green.

**Inferred user intent:** One definition of every new tool in the catalogue, from which the DSL, the UI and the
engines take it.

**Commit (code):** 007a30e — "CHB-037 P8a: contract - the composite op set, W3C blend modes, working encodings and the
scene stage's input"

### What I did
- `domains.ts`: `scene-rgb`, `scene-oklab`, `print-rgb`, `print-oklab`. New `encodings.ts` (`ENCODED_DOMAINS`,
  `encodingOfDomain`, `domainsOf`, `WORKING_DOMAINS`).
- `document.ts`: `BLEND_MODES` (16), `NON_SEPARABLE_BLENDS`; mask kinds `radial`, `colour` (+ `RANGE_COMPONENTS`);
  cut `scene.input` (orders renumbered 0–9); `STAGES.scene.input = 'scene.input'`.
- `registry.ts`: `EncodingSpec` (fixed, or `{ arg, values }`), `opEncoding(op, params)`, `OpUi { label, menu, order }`,
  `LAYER_MENUS`; registerOp checks that a composite layer op takes exactly the domains of its encodings and that scan
  ops stay in the stage encoding. `spec.ts`: `UiHints.advanced`.
- `catalog/adjust.ts` (new): exposure, curve, levels, hsl (+ `DEFAULT_HSL_BANDS`), vibrance, grade, mixer, vignette,
  sharpen, composite.encode. `catalog/layers.ts`: ui fields on the darkroom and retouch ops, clarity's encoding
  `stage`, composite.mix on every working domain with the 16 modes. `view-output-mask.ts`: `mask.radial`,
  `mask.colour`, ui fields on the component ops.
- `graph.ts`: `checkEncoding` (a channel curve on OkLab, or composite.encode across stages, is E_DOMAIN with a fix).
- `stage-laws.ts`: `LawContext.encode/encodingOf`; a layer's input converted to its op's encoding; `mix` in the
  result's encoding (a blend on a stage-encoded result: linear); the stack's result back in the stage encoding.
- `compile.ts`: `encode` (folds conversion chains), `encodingOf`, the stage white (print: `output.white`, scene: D65),
  `colourInput` (a colour component's cut in OkLab; E_CUT on a cut without colour), `setCut('scene.input')`.
- Tests: `composite-law.test.ts` (12 tests) and updates to `document.test.ts`, `registry-graph.test.ts`.
- `tools/gen-docs`: the op page prints an argument-dependent encoding and the `ui` line; the snapshot keeps `ui`
  (two small edits outside my packages, needed for the generated docs). `node tools/gen-docs/main.ts --contract-only`.

### Why
- Encodings as domains make every graph self-describing (an engine knows from a node's domain what its numbers
  are, and the registry refuses a curve on the wrong encoding), and they need nothing new in the planner or the
  hash: `composite.encode` is an ordinary pointwise op.

### What worked
- `npx vitest run packages/contract` → 8 files, 74 passed; `pnpm exec tsc -p packages/contract/tsconfig.json
  --noEmit` clean; `node tools/gen-docs/main.ts --contract-only --check` → `gen:check ok (15 files)`; `pnpm lint` ok.
- In-scope suites unchanged otherwise: `npx vitest run packages/contract packages/core packages/gpu
  packages/conformance packages/engine-mock tools/goldens` → 40 files, 1260 passed.

### What didn't work
- `document.test.ts`: `expected 'E_UNKNOWN_OPTION' to be 'E_DOCUMENT'` — the test used `radial` as its example of an
  unknown component kind; now `conic`.
- My law test: `ValueError: E_MUTATION: id "p0" is used twice in the document` (one point Coll reused in two
  layers; ids are unique document-wide). Fixed with a generator of fresh point ids.
- Typecheck of the test: `Type 'Coll<unknown>' is not assignable to type 'Json'` — a Coll as a stored param needs a
  cast (`helpers.ts` does the same for spots).

### What I learned
- `domainFromArg` already existed for `source.pattern`; it makes `composite.encode` a one-op conversion whose output
  domain is its argument.

### What was tricky to build
- Where the mix happens for groups: a group's backdrop and its children's result may be in different encodings. The
  rule "the entry mixes in its result's encoding" covers layers (whose input was converted to the op's encoding) and
  groups alike, and `mix` converts the backdrop to it; the conversion fold means the backdrop's conversion is shared
  with the first child's.
- The scene stage's masks had read `source` (camera-linear) as their stage input; a cut before the stack was missing.
  With `scene.input` at order 1 and `scene` at 2, `readableCuts('scene', …, 'mask')` is `['source', 'scene.input']`.

### What warrants a second pair of eyes
- `compile.ts` `encode`: it folds a conversion of a conversion; if any other op ever produced a working-domain node
  that is not `composite.encode`, the fold still holds (it only looks at `composite.encode` nodes).
- Mixing in OkLab for normal blends of OkLab ops (design §22's formula) vs "mixing by coverage in linear light" (the
  same section's list): I followed the law's formula; a masked curve's soft edge is therefore a blend in OkLab.

### What should be done in the future
- A colour mask in the darkroom works only for camera files (reading `scene.input` or `scene`): a scan has no cut in
  XYZ before the print. If the photographer wants colour-range burns on scans, the darkroom needs a colour cut of the
  negative (for example the main exposure's print preview).

### Code review instructions
- Start at `packages/contract/src/encodings.ts`, `catalog/adjust.ts`, then `stage-laws.ts` (`mix`, `compileOrdered`,
  `compileStack`) and `compile.ts` (`encode`, `colourInput`).
- `npx vitest run packages/contract`; `pnpm exec tsc -p packages/contract/tsconfig.json --noEmit`.

### Technical details
- A print stack curve → hsl → vibrance compiles to `composite.encode(print-oklab) · curve · hsl · vibrance ·
  composite.encode(print-xyz)`; exposure → curve R → mixer → curve L to `→rgb exposure curve mixer →oklab curve →xyz`.

## Step 3: The reference engine, conformance semantics and six golden stacks

Core is the definition every GPU kernel mirrors, so its new code is organised as per-pixel functions with prepared
parameters (`composite/working.ts`, `tone.ts`, `adjust.ts`, `blend.ts`), and the op adapters in `ops/ops.ts` are thin.
The GPU lowering will call the same preparation functions (`encodeTransform`, `toneCurve`, `hslBands`,
`gradeWheels`, `mixerMatrix`) so the uniforms are core's numbers.

Then conformance semantics from closed forms (no engine), and six golden stacks. The 60 existing goldens are
bit-identical; the stacks render on the reference engine and are stored like every case.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Each new op gets an f64 reference implementation, laws, a conformance case; golden
stacks for a few combined documents; the old goldens unchanged.

**Inferred user intent:** The f64 truth for the new tools, so the GPU can be proven against it.

**Commit (code):** 3c09973 — "CHB-037 P8a: reference engine - the composite op set, blend modes and encodings in f64;
conformance semantics; six golden stacks"

### What I did
- `core/src/composite/working.ts`: `REC2020_TO_XYZ` (analytic primaries), `xyzToWorking(white)` (Bradford to the
  primaries' white, so the stage white is exactly (1, 1, 1)), `OK_M1` (rows normalised), `encodeTransform`,
  `encodeTransformOf`, `applyEncode`, `rgbToOklab`/`oklabToRgb`. `print/gamut.ts` now exports `M1`, `M2`, `M2_INV`
  (one OkLab in the codebase).
- `composite/tone.ts` (PCHIP with scipy's end tangents, `evalCurve`, `evalLevels`, `toneAt`), `composite/adjust.ts`
  (hsl, vibrance, grade, mixer matrix, vignette gain), `composite/blend.ts` (`blendChannel`, `blendOklab`,
  `blendPixel`). `print/clarity.ts`: `clarityGain(…, midtones)`, `clarity(…, midtones)` for sharpen.
  `print/masks.ts`: `radialAt`, `colourAt`.
- `ops/ops.ts`: the twelve new ops and composite.mix with blends (E_DOMAIN for a blend on stage-encoded values);
  `engine-ref.ts` `GRID_OPS` gains the pointwise ones (not the positional vignette and radial).
- `core/test/composite.test.ts` (18 tests). `conformance/src/semantics.ts`: identity at identity params for every
  digital op (10 cases), composite.encode round trips, closed forms of exposure, curve, levels, mixer, vignette, the
  blend identities, luminosity and colour, radial and colour masks.
- `tools/goldens/stacks.ts` (new, the stacks' provenance), `golden.ts` (`recipe` optional), `goldens.test.ts` (60
  translated + the stacks), README; `node tools/goldens/stacks.ts`, `node tools/goldens/render.ts --only
  stack-print-tone,stack-print-colour,stack-print-masked,stack-print-blends,stack-print-mono,stack-scene`.

### Why
- The OkLab of the output knee and of the working encoding must be one definition, so the matrices are exported from
  `gamut.ts` rather than copied.

### What worked
- `npx vitest run packages/core packages/engine-mock packages/conformance` → 1309 passed (the RefEngine conformance
  run includes every new semantic case); `node tools/goldens/render.ts --check` → `66/66 cases within max |Δ| ≤
  0.00001`, every case 0 (the 60 old ones untouched: `git diff --stat` of index.json is 255 insertions, 0 deletions).
- A contact sheet of the stacks (scratchpad `stacks.png`) looks as the layers say: crushed-then-lifted tone, deeper
  blues, a vignette, split-toned monochrome, a cooler-highlight scene.

### What didn't work
- `working encodings › the stage white is … OkLab (1, 0, 0)`: white came out `[0.9999999935, -1.7e-16, 3.73e-8]` —
  Ottosson's published M2 rows sum to 1, 0, 0 only within 4e-8. I kept the one published M2 (the knee uses it) and
  test the white to 5e-8.
- `oklab → stage → oklab: expected false to be true`: my round trip drew random OkLab values up to 0.9 in a and b,
  far outside any gamut, where the cube is ill-conditioned; the test now starts from print colours.
- `grade: … expected 229.68 to be close to 230`: a dark grey also gets 2 % of the highlight wheel (t² at t = 0.15),
  correct; the test checks each wheel alone exactly and the mix within 1°.
- `node tools/goldens/stacks.ts`: `E_MUTATION: id "c1" is used twice in the document` (a curve's point ids and a
  mask component's), then `"s.p0" is not an id (letters, digits, _ and -)`; point ids are now `<layer>-p<i>`.

### What I learned
- Multiply in linear light is strong: a curve at 0.5 in multiply over the print darkens it like squaring; the blends
  stack is the darkest picture of the set (display mean 0.25 against 0.58 for the tone stack). That is the physics
  the design chose (multiply as a filter); a photographer used to Photoshop's multiply on sRGB numbers will find it
  heavier.

### What was tricky to build
- Making the stage white land on exactly (1, 1, 1): the ICC rec2020 profile's matrix (`outputSpace('rec2020')`) has
  s15Fixed16 rounding and core's D65 constant differs from the primaries' white in the fifth digit; the working
  matrix is therefore built from the analytic primaries with a Bradford from the stage white to the primaries' own
  white, which is exact.

### What warrants a second pair of eyes
- `tone.ts` `endTangent` (scipy's three-point end tangent) and the curve's linear continuation beyond its points.
- The non-separable blends in OkLCh (decision 4): no W3C ClipColor, so `luminosity` can leave the gamut; the output
  knee compresses it.

### What should be done in the future
- The engine-mock (not mine) implements none of the new ops; its conformance run reports them as not implemented,
  correctly. If the mock should stand in for the studio's digital stack, it needs pass-throughs.

### Code review instructions
- `packages/core/src/composite/*.ts`, then `ops/ops.ts` (the adapters after `composite.mix`).
- `npx vitest run packages/core/test/composite.test.ts`; `node tools/goldens/render.ts --check`.

### Technical details
- Golden stacks (display cut means): tone 0.583 0.594 0.555; colour 0.498 0.521 0.515; masked 0.454 0.470 0.475;
  blends 0.249 0.261 0.267; mono 0.575 0.567 0.557; scene 0.525 0.430 0.353 (print 0.223 0.220 0.181).

## Step 4: The GPU — digital ops in the pointwise kernel, the fused mix, blends in both kernels; parity on SwiftShader

Every digital op is one op of the pointwise kernel, with its parameters prepared by core's functions (the encoding
transform, the curve's Hermite segments, the hue bands, the grading wheels, the mixer matrix) and carried in a new
op-data storage buffer (binding 9) that each op addresses by offset. The blend modes and the working encodings are one
WGSL file (`kernels/working.wgsl`) prepended to both the pointwise and the combine kernel, with core's matrices written
in as constants, so there is one OkLab and one blend definition on the GPU too.

The fused mix is the structural change: a `composite.mix` without a mask whose top is a short pointwise chain on its
own backdrop lowers to `SAVE · top ops · MIX` inside the program (a second register in the kernel), so a layer at 70 %
or in luminosity mode costs no texture and no pass. A masked mix stays one combine pass, now with the 16 modes. Every
shader compiled on the first run; the only parity misses were my own test inputs (imaginary colours).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Each op a GPU implementation with parity against core (SwiftShader, then Metal), the
encodings fused, composite.mix and pointwise layers fused where possible.

**Inferred user intent:** The photographer's digital layers at GPU speed with exactly the reference's pictures.

**Commit (code):** 4299a90 — "CHB-037 P8a: GPU - the digital layers in the pointwise kernel, a fused composite.mix, the
16 blend modes in both kernels; contract 1.1 (CC-020)"

### What I did
- `kernels/working.wgsl` (new): `wkRgbToOk`/`wkOkToRgb`, `wkSmooth` (core's smoothstep; WGSL's builtin is undefined
  for e0 ≥ e1), `wkBlendCh` (separable), `wkBlendOk` (non-separable), `wkBlend`, `wkMix` (exact at k = 0 and 1).
  `src/chain/working.ts` prepends `WK_M1`, `WK_M1I`, `OK_M2`, `OK_M2I` from core (`OK_M1`, `OK_M2`…);
  `pointwise.wgsl` loses its hand-copied M2 (one OkLab).
- `kernels/pointwise.wgsl`: ops 18–30 (ENCODE, EXPOSURE, MIXER, CURVE, LEVELS, HSL, VIBRANCE, GRADE, VIGNETTE,
  MASK_COLOUR, MASK_RADIAL, SAVE, MIX), binding 9 `opd`, the backdrop register `bk`; `curveAt` (core's Hermite and
  end tangents), `levelsAt`, `hslAt` with `sinCosSmall` (Taylor to x¹¹/x¹², error < 1e-8 for |x| ≤ π/3),
  `toneCh` (L, or ∛ of one channel). `kernels/combine.wgsl`: MIX = `wkMix(a, b, k, blend, encoding)`; CLARITY's
  midtone weight behind `w.z` (sharpen = 0).
- `src/chain/program.ts`: OP codes, `PwOp.data`/`aux`, op.z = data offset, `packOpData`; `chain/run.ts` binds it.
- `src/engine/dag.ts`: `fusedMixTop(g, n)`, `isBarrier(n, g?)`, `readsOf(n, g?)` (a fused mix reads its backdrop
  alone); `engine/lower.ts`: `lowerDigital` and the fused mix as one span (`pushSpan`: SAVE…MIX never straddle two
  programs); `engine/defs.ts`: GPU_OPS + 12, `sharpen` a barrier, `mask.radial` a generator, `FUSIBLE_TOP_OPS`.
- `engine-gpu.ts`: composite.mix passes blend and encoding (E_DOMAIN for a blend on a stage-encoded mix), sharpen
  shares clarity's passes.
- Tests: `test/digital.test.ts` (node: fusion rules, lowering, op-data offsets, the WGSL constants);
  `src/parity/digital-tests.ts` + `test/browser/digital.spec.ts` (`law:digital`, `law:blend`, `law:digital-doc`,
  BENCH-gated `bench:composite`); `film:scene` in `film-tests.ts` (a camera file's scene stack).

### Why
- A fused mix is what keeps the design §29 promise for the digital stack: Lightroom-style layers are mostly unmasked
  and at partial opacity, and each would otherwise cost a materialised texture and a combine pass.

### What worked
- `npx vitest run packages/gpu` → 7 files, 62 passed; typecheck clean (ingest's `DustSpot` lines only).
- `digital.spec.ts` on SwiftShader (`STUDIO_PORT=5581 STUDIO_KIT_PORT=5582 SHELL_DEMO_PORT=5583 GPU_PARITY_PORT=5584
  CI=1 pnpm exec playwright test --project=gpu-parity digital.spec.ts`): every op and encoding within 9.1e-6 of
  RefEngine (most below 2e-6); the blend modes fused and masked within 5.3e-6 in linear RGB and for the
  non-separable modes, ≤ 1.1e-4 for separable modes in OkLab; all 32 unmasked mixes fused; documents at display
  within 1 8-bit level, `finished` within 1.2e-4; the camera file's scene cut within 7.5e-6.
- Full `gpu-parity` on SwiftShader (`STUDIO_PORT=5581 STUDIO_KIT_PORT=5582 SHELL_DEMO_PORT=5583 GPU_PARITY_PORT=5584
  CI=1 pnpm test:browser --project gpu-parity`): **51 passed, 2 skipped** (the two BENCH-gated timings), 3.9 min;
  conformance on the GPU **516/516** (the new ops' cases included).
- `CONTRACT_VERSION` 1.1.0 and CC-020 in `CONTRACT-DECISIONS.md`; `pnpm gen` (the full generator works again): the
  DSL reference and the bridge reference gain the new layer ops and the cut `scene.input`; `gen:check ok (26 files)`.
  `npx vitest run packages/dsl packages/agent packages/values` → 24 files, 208 passed (no consumer broke).

### What didn't work
- `law:blend`, first run: `Error: oklab overlay fused … Expected: <= 0.00005 Received: 0.00006127…` (and exclusion
  2.3e-4): the backdrop was a random print-xyz pattern, mostly imaginary colours whose negative LMS the cube root and
  the cube amplify through the two conversions around a separable blend in OkLab. With non-negative working RGB
  (print colours) the worst is exclusion at 1.1e-4 (its result's LMS nears 0); the spec bounds separable modes in
  OkLab at 3e-4 and everything else at 2e-5.
- The first full run: 5 tests failed with `Error: page.evaluate: Execution context was destroyed, most likely because
  of a navigation.` — I ran `node tools/gen-docs/main.ts` during the run, which rewrote
  `packages/contract/src/generated/op-args.ts` and the parity page's Vite server reloaded the page. Rerun untouched.

### What I learned
- Vite's dev server behind the parity page reloads on any change to a module it serves: never write sources (or run
  the generators) while a browser suite runs.

### What was tricky to build
- A fused mix in a register machine: the backdrop must survive the top's ops, so the kernel needs a second register,
  and a segment split between SAVE and MIX would lose it; `pushSpan` starts a new program when the span does not
  fit, and `fusedMixTop` refuses tops longer than MAXOPS − 2. A group's mix whose top does not start at its backdrop
  (an isolated group: the children ran on the unconverted backdrop) stays a combine pass.
- `b` and `s` as WGSL parameter names would shadow combine.wgsl's module-scope `b` texture; the blend functions use
  `bd`/`sr`.

### What warrants a second pair of eyes
- `engine/dag.ts` `fusedMixTop` and `readsOf`: a fused mix's top nodes are never visited by the planner; if one of
  them is also read elsewhere it is computed twice (correct, a little extra work).
- `kernels/pointwise.wgsl` case 26 (vignette) reads the frame size from `U.frame.zw`: right for nodes before
  output.frame (the composite stages), which is where vignette lives.

### What should be done in the future
- Tiled export with spatial ops (P3's known gap) now also covers `sharpen`: each tile blurs its own region and clamps
  at the tile's edge. The tile planner has halos and global fields (`tiles.ts`), but `planFor` declares no kernels
  and `evaluateU16` renders the tile's core alone; an apron per spatial op (render the read box, crop the core) or the
  fields would fix it. Not in this phase's spec; reported.

### Code review instructions
- `packages/gpu/kernels/working.wgsl`, `src/engine/dag.ts` (`fusedMixTop`), `src/engine/lower.ts` (`lowerDigital`,
  the `composite.mix` case), `kernels/pointwise.wgsl` cases 18–30.
- `npx vitest run packages/gpu`; the gpu-parity command above.

### Technical details
- Program of a fused luminosity mix of hsl → curve on an OkLab backdrop: `[18 ENCODE, 29 SAVE, 23 HSL, 21 CURVE,
  30 MIX]`.

## Step 5: Metal under the GPU lock, timings of six composite layers, a regression found and fixed

On the M1 Max's own GPU (`REAL_GPU=1`, GPU lock `<scratchpad>/gpu.lock`, owner `P8a`, removed after every batch)
the whole `gpu-parity` project passes as on SwiftShader. The timings asked for (a stack of about six composite layers
at 4000 px) come from a new BENCH-gated test, `bench:composite`. To know what the phase costs a print *without*
digital layers, I ran P3's `bench:print` on this tree and on a detached worktree of 3c09973 (the last commit before the
GPU change), alternating: the print had become 3–6 % slower in export.

The cause was not the kernels: an experiment that compiled the digital ops and the blend code out of programs that
do not use them (pipeline-overridable constants `DIGITAL` and `BLENDS`) changed nothing measurable. It was the
pipeline lookup: `kernelKey` hashes the WGSL text on every `pipelines.get`, the kernels grew by a third, and the
runner now asked per program; a tiled export makes dozens of lookups. Memoising the hash by the string fixed it; the
darkroom export is now 4 % faster than before the phase.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Acceptance on the real GPU, and GPU timings for a stack of ~6 composite layers at
4000 px, preview and export, recorded here.

**Inferred user intent:** The digital layers are as fast on the photographer's Mac as the design promises (fused, not a
pass per layer), and nothing else got slower.

**Commit (code):** 1d18948 — "CHB-037 P8a: GPU - memoise the kernel code hash (pipeline lookups hashed 30 kB of WGSL
per program and per pass)"

### What I did
- `REAL_GPU=1 STUDIO_PORT=5581 STUDIO_KIT_PORT=5582 SHELL_DEMO_PORT=5583 GPU_PARITY_PORT=5584 CI=1 pnpm test:browser
  --project gpu-parity` under the lock (script `<scratchpad>/p8a-metal.sh`, logs `p8a-metal-1.log`).
- `BENCH=1 REAL_GPU=1 … pnpm exec playwright test --project=gpu-parity digital.spec.ts -g bench` and `bench.spec.ts`,
  twice each; then `git worktree add --detach ../p8a-before 3c09973` and the same `bench.spec.ts` alternating between
  the two trees (`p8a-bench-ab.sh`), twice; the worktree removed afterwards (`git worktree remove --force`).
- Experiment (not kept, patch in `<scratchpad>/p8a-override-experiment.patch`): `override DIGITAL` (the digital ops
  moved into `digitalOp`, called under it) and `override BLENDS` (in `wkMix`), pipelines chosen per program and per
  combine pass. Parity green on Metal (22 tests), timings unchanged; reverted for simplicity.
- `src/pipelines.ts`: `codeHash` memoised by the WGSL string inside `kernelKey`.

### Why
- "Performance kept by construction" (design §29) needs a before/after on the same machine, not P3's numbers from
  another session (P3's plain export was 234–235 ms, this session's before-tree 236–245 ms).

### What worked
- Metal: **51 passed, 2 skipped**, 20.2 s (after the memo, the final run: 51 passed, 2 skipped, 1.1 min); conformance
  516/516. Parity on Metal: every op and encoding within 5.8e-6
  of RefEngine; blend modes in linear RGB and the non-separable modes within 3.0e-6, separable modes in OkLab within
  2.1e-4; all 32 unmasked mixes fused; documents at display within 1 8-bit level; the camera file's scene cut 2.9e-6.
- Timings (M1 Max, Metal, synthetic Gold 200 scan 4000 × 2674; median of 8 rounds after 2 warm-ups, each round a new
  graph; preview at scale 0.4 = 1600 × 1070 with f32 read-back; export = 16-bit codes, tile by tile):

  | Print stage | preview | export |
  |---|---|---|
  | one exposure layer (`plain` of bench:composite) | 22.9, 22.3 ms | 256.2, 262.7 ms |
  | six layers: exposure, S-curve, HSL, vibrance, grade, vignette at 0.8 (one OkLab run, one fused mix) | 23.1, 23.7 ms | 275.9, 274.4 ms |
  | the six + a curve under a radial mask at 0.7 (a combine pass) | 52.2, 48.9 ms | 391.0, 369.3 ms |

- A print without digital layers, before (3c09973) and after (1d18948), alternating:

  | Print (bench:print) | before preview | after preview | before export | after export |
  |---|---|---|---|---|
  | plain (main + lights) | 21.3, 22.4 ms | 21.3, 22.8 ms | 239.3, 243.8 ms | 242.9, 249.7 ms |
  | darkroom (burn, dodge, contrast mask) | 106.1, 103.4 ms | 105.3, 106.5 ms | 785.9, 778.9 ms | 748.0, 749.4 ms |

### What didn't work
- Before the memo, after-tree: plain export 246.0/248.7 ms against 238.1/242.3, darkroom export 821.8/823.4 against
  772.6/791.8 (a 3–6 % regression). The override experiment: plain export 261.1/254.0 against 236.0/245.0, darkroom
  826.6/822.4 against 776.7/775.3 — no better.
- `sha256Hex` of 36 kB of text in Node: 0.305 ms (a probe script, deleted); the pointwise kernel is ~36 kB with the
  working WGSL, and every program and every combine pass asked for its pipeline by hashing it.

### What I learned
- Six unmasked digital layers cost about 1 ms in preview and 15–20 ms in an export: they are a few more ops of the
  fused program. One masked layer costs 30 ms in preview and 120 ms in export: three materialised textures (the
  backdrop, the top, the mask) and a combine pass, per tile in an export.

### What was tricky to build
- Attributing a 4 % difference on a GPU shared with a desktop: only alternating runs of both trees in one session
  are comparable (this session's before-tree differs from P3's numbers by as much as the effect).

### What warrants a second pair of eyes
- `bench:composite`'s `masked` row: if masked layers are common in the photographer's work, the next optimisation is
  to fuse a mask that is pointwise in position (linear, radial, ellipse, constant and their algebra without feather)
  into the program as a third register, so a masked layer fuses too.

### What should be done in the future
- Fused masked mixes (above). Tiled export with spatial ops (Step 4).

### Code review instructions
- `packages/gpu/src/pipelines.ts` (`codeHash`); `src/parity/digital-tests.ts` (`bench:composite`).
- `BENCH=1 REAL_GPU=1 STUDIO_PORT=5581 STUDIO_KIT_PORT=5582 SHELL_DEMO_PORT=5583 GPU_PARITY_PORT=5584 CI=1 pnpm exec
  playwright test --project=gpu-parity digital.spec.ts -g bench` (take the GPU lock first).

### Technical details
- Logs (scratchpad, not kept): `p8a-metal-1.log`, `p8a-bench-composite-{1,2}.log`, `p8a-bench-print-{1,2}.log`,
  `p8a-ab-*`, `p8a-ab2-*` (override experiment), `p8a-ab3-*` (memo), `p8a-final-sw.log`, `p8a-final-metal.log`.

## Step 6: Final checks, what is left, what P5b-2 needs

I ran every check the spec names on the last commit, the whole vitest suite against the phase's base commit (to be
sure every remaining failure was there before), and wrote down what the stack kit's panels and the "+ Layer" menu
(P5b-2) can take from the catalogue without reading the code.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Close the phase: acceptance checks, the breakage list, the handoff.

**Inferred user intent:** The main agent can merge P8a and brief P5b-2 from this diary.

**Commit (code):** 1d18948 (the last code commit; this step's diary commit follows it)

### What I did
- `npx vitest run packages/contract packages/core packages/gpu packages/conformance packages/engine-mock packages/values
  packages/dsl packages/agent tools/goldens` → 66 files, 1656 passed, 7 skipped.
- `pnpm exec tsc -p packages/{contract,core,gpu,conformance}/tsconfig.json --noEmit`: no error in these packages (core
  and gpu still print packages/ingest's two `DustSpot` lines, P5b-1's).
- `node tools/goldens/render.ts --check` → `66/66 cases within max |Δ| ≤ 0.00001`; `pnpm lint` ok;
  `node tools/gen-docs/main.ts --check` → `gen:check ok (26 files)`.
- gpu-parity on SwiftShader (ports 5581–5584) → 51 passed, 2 skipped (BENCH), 4.8 min, conformance 516/516; on Metal
  (`REAL_GPU=1`, GPU lock) → 51 passed, 2 skipped, 1.1 min, conformance 516/516.
- `npx vitest run` (everything): 24 failed files, 22 failed tests, 2905 passed — and on the base commit 35acb04 (a
  temporary worktree, removed): 24 failed files, 22 failed tests, 2681 passed. The same failures, all in
  apps/studio, packages/studio-kit and packages/output (P5b-1 is rewriting them); P8a adds 3 files and 224 tests.

### Why
- The spec's acceptance list, and a merge that the main agent can make without re-running the phase's reasoning.

### What worked
- Every check above.

### What didn't work
- N/A (no new failure).

### What I learned
- N/A beyond the earlier steps.

### What was tricky to build
- N/A (checks only).

### What warrants a second pair of eyes
- The decisions the spec did not make (Step 1, items 1–19), above all: mixing in the entry's encoding (OkLab for a
  masked curve), non-separable blends in OkLCh without ClipColor, separable blends in linear light (multiply and
  overlay are much stronger than on sRGB numbers), levels continued beyond its points instead of clipping, the curve
  evaluated exactly on the GPU instead of through a LUT.

### What should be done in the future
- Tiled export with spatial ops (P3's gap, now with `sharpen`): an apron per spatial op or the tile planner's fields.
- Fused masked mixes for masks that are pointwise in position (Step 5).
- A colour cut for the darkroom of a scan, if colour-range burns on scans are wanted (Step 2).
- engine-mock: pass-throughs for the new ops if the mock is to stand in for a studio with digital layers.

### Code review instructions
- The commits in order: 007a30e (contract), 3c09973 (core, conformance, goldens), 4299a90 (GPU, CC-020, generated
  docs), 1d18948 (pipeline key memo).
- Validate with the commands under "What I did".

### Technical details

What P5b-2 (the stack kit's panels and the "+ Layer" menu) can read from the catalogue:

- **The menu**: `opsForStage(stage)` lists the layer ops a stage accepts; each has `ui = { label, menu, order }`
  (`OpDef.ui`, `OpUi`), `menu` one of `LAYER_MENUS` = light, retouch, tone, colour, detail, effect, mask. Scene and
  print: tone (Exposure 10, Curve 20, Levels 30), colour (HSL 10, Vibrance 20, Colour grading 30, Channel mixer 40),
  detail (Clarity 10, Sharpen 20 — print only), effect (Vignette 10), retouch (Heal 10, Clone 20 — print). Darkroom:
  light (Main exposure 0, Burn 10, Dodge 20, Flash 30, Preflash 40, Density mask 50, Filter 60). Mask components:
  menu `mask` on the ops `mask.<kind>` (Linear gradient 10, Radial gradient 20, Ellipse 30, Brush 40, Luminance range
  50, Colour range 60).
- **The panel**: every argument's `ArgSpec` (type, unit, min/max, usual, default, doc) and `ui` (widget: slider,
  segmented for `channel`, wheel for the grade's hue and strength, toggle for `monochrome`; label; group: the grade's
  Shadows/Midtones/Highlights; step; detents; `advanced: true` on secondary controls — exposure offset, levels output
  black/white, hsl band widths, grade balance — to show behind "More").
- **Lists** are Colls in a document: `curve.points` (2–16 `{x, y}`, strictly increasing x), `hsl.bands` (≤ 16,
  default `DEFAULT_HSL_BANDS`, the eight Lightroom bands). Ids are unique in the whole document (prefix point ids with
  the layer id).
- **Defaults**: tone and colour tools default to their identity (the layer produces no node until changed);
  `vibrance` 0.25, `vignette` −0.5 stop, `sharpen` 0.5, `clarity` 0.25 are visible at once.
- **Blend**: `BLEND_MODES` (16, kebab case, British: `colour-dodge`, `colour-burn`, `colour`), `NON_SEPARABLE_BLENDS`;
  allowed where `getLaw(STAGES[stage].law).blend` (scene and print). Groups: `pass` or a mode (isolated).
- **Encodings**: `opEncoding(op, params)` says what a layer computes in (a panel may show it: "linear" / "OkLab");
  `curve`/`levels` follow `channel` (L in OkLab, R/G/B in linear RGB).
- **Colour masks**: `mask.colour.colour` is OkLab (L, a, b) of the image the mask reads; an eyedropper samples that
  cut and converts with core's `encodeTransform('stage', 'oklab', white)` (white = `output.white` for the print,
  D65 for the scene). A colour component on a cut without colour (a scan's darkroom) is E_CUT at compile.
- **The scene stage** (camera files): its masks read `scene.input` by default.
