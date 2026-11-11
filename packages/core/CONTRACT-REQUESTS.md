# Contract requests from CHB-003 (`@chromobench/core`)

Most CHB-003 proposals are already in contract v0 (CONTRACT-DECISIONS.md, CHB-003 #1–7). These are the
gaps found while implementing the reference engine. Core works around each one locally; nothing here
blocks merging.

## R1. `print.expose.filtration` is a shift on the database neutral pack

**Need.** The catalog gives `filtration` a default of `{c: 0, m: 0, y: 0}` and `min: 0`. A physical
pack of 0/0/0 prints Portra 400 on Portra Endura far off neutral (the database pack is C 0, M 51.57,
Y 52.53). The reference engine therefore reads `filtration` as a **shift added to the database neutral
pack** for the (paper, film) pair, so 0 means neutral.

**Why a change.** With `min: 0` a user cannot remove filtration below the neutral pack, which a shift
needs (−10 Y is a normal correction).

**Proposed diff** (`packages/contract/src/catalog/capture-film-print.ts`, `print.expose`):

```diff
-      filtration: { type: 'cmy', unit: 'CC', min: 0, max: 200, default: { c: 0, m: 0, y: 0 }, doc: 'Dichroic colour-head filtration.', ...
+      filtration: { type: 'cmy', unit: 'CC', min: -100, max: 200, default: { c: 0, m: 0, y: 0 }, doc: 'Dichroic filtration as a shift on the database neutral pack for (paper, film); 0 = neutral. The absolute pack is neutral + shift and must stay ≥ 0.', ...
```

## R2. `print.aim` reaches the engine

**Need.** `print.lights.logH` is relative to the aim (accepted, CHB-003 #5), but no op argument
carries the aim, so an engine cannot know it per node. Core takes it as an engine option
(`new RefEngine({ aim })`, default `'grey-0.184'`).

**Proposed diff:** add an arg to `print.expose` (it is where core applies the aim lights):

```diff
+      aim: { type: 'enum', values: ['grey-0.184', 'midgray-normalised'], default: 'grey-0.184', path: 'print.aim', doc: 'What printer lights 0 mean.' },
```

## R3. The aim's viewing light

**Need.** The `'grey-0.184'` aim solves for lights that print the grey card neutral *under a viewing
light*, which is downstream of `print.expose` (`view.reflect.illuminant`). Core uses the paper's
`meta.viewIlluminant` (D50 for all interim papers). If the recipe's viewing light should define the aim,
`compile()` must pass it to `print.expose`:

```diff
+      aimView: { type: 'string', valuesFrom: 'illuminants', default: 'D50', path: 'view.illuminant', doc: 'Viewing light the aim is neutral under.' },
```

## R4. Noise σ for `invert.classes` / `invert.classify`

**Need.** Classification needs σ per channel in D (§3.5), which `scan.noise` measures (CHB-006) but no
argument carries. Core uses an engine option (default the Gold 200 640-px values 0.0043, 0.0033, 0.0057 D).

**Proposed diff:** add `sigma: { type: 'vec3', unit: 'D', min: 0, max: 0.2, default: [0.0043, 0.0033, 0.0057], doc: 'Scanner noise σ per channel (from scan.noise).' }`
to both `invert.classify` and `invert.classes`, filled by `compile()` from a `scan.noise` measurement.

## R5. `output.display.knee: 'cam16-ucs'`

Core implements OkLCh compression with spektrafilm's knee parameters (guide §5.4 decision) and uses it
for `'cam16-ucs'` until CAM16-UCS exists. Either add `'oklch'` to the enum (and make it the default) or
accept that `'cam16-ucs'` means "the perceptual knee" until CHB-011 adds the real one.

## R6. Engine conventions string

`EngineCaps.conventions` is set to `conventionsKey(conv)`, e.g.
`core-v1:opaque/cie1931-2deg/subtract/model-3cdf/midgray-geomean`. No contract change; recorded so CHB-005
uses the same string in `TableKey.conventions`.
