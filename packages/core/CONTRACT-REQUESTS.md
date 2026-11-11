# Contract requests from CHB-003 (`@chromobench/core`)

> **Status (CHB-017, contract 0.2.0):** decided. Applied, adapted, deferred or noted item by item in
> `packages/contract/CONTRACT-DECISIONS.md`, section "Contract 0.2". Kept here as the record of the request.

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

---

# Contract requests from CHB-010 M2 (darkroom printing, stages 1–2)

Status: open. Core works around each one locally; nothing here blocks merging. Numbers refer to the
CHB-010 intern guide (`ttmp/2026/11/11/CHB-010--*/design-doc/01-intern-guide-darkroom-printing.md`).

## C1. `darkroom.lightsToFiltration` needs the print settings

**Need.** The op runs on a `film-dyes` receiver with `logH` only, so it cannot see the paper, lamp,
pack, mode or time that the answer depends on. The reference engine uses `print.expose`'s defaults
(Portra Endura, TH-KG3, the database neutral pack, real mode, 10 s at f/8) and reads the arguments
below when present, so the diff takes effect without an engine change. The answer also has a time and
a uniform remainder that the fields cannot carry.

**Proposed diff** (`packages/contract/src/catalog/measure-darkroom-finishing.ts`):

```diff
   defineOp({
     name: 'darkroom.lightsToFiltration', area: 'darkroom', owner: 'CHB-010', on: 'Image', returns: 'Value', domainIn: 'film-dyes',
     class: 'measure', binding: 'setting',
-    args: { logH: { type: 'vec3', unit: 'logH', min: -1.5, max: 1.5, default: [0, 0, 0], doc: 'Printer lights to express as filtration.' } },
+    args: {
+      logH: { type: 'vec3', unit: 'logH', min: -1.5, max: 1.5, default: [0, 0, 0], path: 'print.lights.logH', doc: 'Printer lights to express as filtration and time.' },
+      paper: { type: 'stockId', valuesFrom: 'stocks:print', default: 'kodak_portra_endura', path: 'print.paper', doc: 'Colour paper.' },
+      mode: { type: 'enum', values: ['real', 'normalised'], default: 'real', path: 'print.enlarger.mode', doc: 'real: filtration and time; normalised: filtration, the density part stays as lights.' },
+      lamp: { type: 'string', valuesFrom: 'lamps', default: 'TH-KG3', path: 'print.enlarger.lamp', doc: 'Enlarger lamp.' },
+      filtration: { type: 'cmy', unit: 'CC', min: -100, max: 200, default: { c: 0, m: 0, y: 0 }, path: 'print.enlarger.filtration', doc: 'Current shift on the neutral pack.' },
+      time_s: { type: 'number', unit: 's', min: 0.1, max: 600, default: 10, path: 'print.enlarger.time_s', doc: 'Current exposure time.' },
+      fstop: { type: 'number', unit: 'fstop', min: 2.8, max: 45, default: 8, path: 'print.enlarger.fstop', doc: 'Lens aperture.' },
+      aim: { type: 'enum', values: ['grey-0.184', 'midgray-normalised'], default: 'grey-0.184', path: 'print.aim', doc: 'The aim.' },
+      aimView: { type: 'string', valuesFrom: 'illuminants', default: 'D50', path: 'view.illuminant', doc: 'Viewing light of the aim.' },
+    },
     fields: [
-      { name: 'filtration', type: 'object', unit: 'CC', doc: '{c, m, y} equivalent filtration' },
-      { name: 'residual', type: 'number', unit: 'logH', doc: 'what filtration cannot reproduce' },
+      { name: 'filtration', type: 'object', unit: 'CC', doc: '{c, m, y}: the new shift on the neutral pack (what print.enlarger.filtration becomes)' },
+      { name: 'time_s', type: 'number', unit: 's', doc: 'the new exposure time (real mode; unchanged in normalised mode)' },
+      { name: 'stops', type: 'number', unit: 'stop', doc: 'the time change in stops' },
+      { name: 'lights', type: 'vec3', unit: 'logH', doc: 'what stays in the printer lights (the density part in normalised mode)' },
+      { name: 'residual', type: 'number', unit: 'logH', doc: 'largest per-layer error at the grey card after rounding the dials (0.1 CC, 0.01 s)' },
     ],
```

The reference engine already returns `time_s`, `stops`, `lights` and `residual_pt` as extra fields.
Bake itself needs no op: `bakeRecipe` (core) returns the mutations, applied as one `EditLog.apply`.

## C2. `print.develop.grade` documents its meaning

Doc only. The grade is now a contrast factor about the aim grey (guide §6.8), not a placeholder:

```diff
-      grade: { type: 'number', unit: 'none', min: 0, max: 5, usual: [1, 4], default: 2, path: 'print.grade', doc: 'Contrast grade.', ...
+      grade: { type: 'number', unit: 'none', min: 0, max: 5, usual: [1, 4], default: 2, path: 'print.grade', doc: 'Contrast grade: a gamma about the aim grey, so the grey card stays (0 → 0.7, 1 → 0.82, 2 → 1 the paper as made, 3 → 1.2, 4 → 1.45, 5 → 1.8). Colour papers have no grades; this is a contrast control.', ...
```

## C3. `print.expose.magnification` and the calibration reference

Doc only, plus a note for CHB-004. "Absent = the calibration's reference" is now concrete: core's
`REFERENCE_OPTICS` = 10 s, f/8, magnification 8, at the database neutral pack; real and normalised mode
print identically there.

```diff
-      magnification: { type: 'number', unit: 'none', min: 0.5, max: 20, optional: true, doc: "Enlarger magnification; absent = the calibration's reference (CHB-010)." },
+      magnification: { type: 'number', unit: 'none', min: 0.5, max: 20, optional: true, doc: "Enlarger magnification (light ∝ 1/(m + 1)²); absent = the calibration's reference, 8×. Real mode only." },
```

The guide (§11.1) wants the calibration versioned in the data pack (`{ time_s, fstop, magnification,
pack }`) so old recipes keep their density if it ever changes; that is CHB-004's to carry.

## C4. Real mode as the default **(review: photographer's call)**

The guide's decision record 1 makes real mode the default. The contract default is `'normalised'`.
`defaultRecipe` writes the mode into every new frame, so existing recipes keep theirs; only new frames
and DSL calls without `mode` would change. Proposed when the photographer confirms:

```diff
-      mode: { type: 'enum', values: ['real', 'normalised'], default: 'normalised', ...
+      mode: { type: 'enum', values: ['real', 'normalised'], default: 'real', ...
```
(and `defaultRecipe`'s `print.enlarger.mode: 'real'`).

---

# Contract requests from CHB-010 stages 3–4 (multi-exposure printing, masks, density masks)

Status: open. Core and the GPU engine implement `print.combine`, every `mask.*` op and
`print.densityMask` as contract 0.2 defines them; nothing here blocks merging. Guide sections refer to
`ttmp/2026/11/11/CHB-010--*/design-doc/01-intern-guide-darkroom-printing.md`.

## C5. Density masks reach the print: `print.densityMasks`, and a neutral mask as a print.expose input

**Need.** `print.densityMask` maps `printing-density → printing-density`, but no op produces or consumes
`printing-density`, and the recipe has no field for it (CONTRACT-DECISIONS CHB-010 #6 "deferred: it will
come with CHB-010's compile rule"). So the op works on a pattern but cannot reach a print. The guide's
mask is neutral silver, so it is exactly a per-pixel printer light −d_m on every exposure *through the
negative* (and not on a flash through the base, §6.5): the clean place for it is `print.expose`.

**Proposed diff.**

```diff
 // catalog/capture-film-print.ts
   defineOp({
-    name: 'print.densityMask', … domainIn: 'printing-density', domainOut: 'printing-density',
+    name: 'print.densityMask', … domainIn: 'film-dyes', domainOut: 'scalar-field',
     class: 'spatial', binding: 'scan',
     args: {
-      amount: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0, doc: 'Strength of the unsharp density mask.' },
-      radius_um: { type: 'number', unit: 'um', min: 0, max: 5000, default: 500, doc: 'Blur radius on the film.' },
+      kind: { type: 'enum', values: ['contrast', 'unsharp', 'highlight'], default: 'contrast', doc: 'Contrast (wide blur), unsharp (thin spacer) or highlight (threshold) mask.' },
+      polarity: { type: 'enum', values: ['positive', 'same'], default: 'positive', doc: 'positive lowers large-area contrast; same raises it (a two-step mask).' },
+      amount: { type: 'number', unit: 'fraction', min: 0, max: 1, default: 0, doc: 'Mask gamma γ_m (Chromogen 100 % = 0.6: large-area contrast falls to 40 %).' },
+      radius_um: { type: 'number', unit: 'um', min: 0, max: 5000, default: 500, doc: 'Gaussian σ of the blur on the film (spacer and diffuser).' },
+      threshold: { type: 'number', unit: 'logH', min: -4, max: 0, optional: true, doc: 'Highlight masks: the mask film log H where density starts.' },
+      paper: { type: 'stockId', valuesFrom: 'stocks:print', default: 'kodak_portra_endura', path: 'print.paper', doc: 'Paper whose sensitivities weight the printing density the mask is made from.' },
     },
-    doc: 'Contrast-reducing density mask (unsharp mask in printing density).',
+    doc: 'The density d_m ≥ 0 of a neutral silver mask made from the negative (blur of its transmittance). print.expose subtracts it from every layer.',
   }),
 // print.expose args
+      densityMask: { type: 'Image', optional: true, doc: 'A print.densityMask d_m (scalar-field): x_k −= d_m (neutral, exact).' },
 // recipe.ts FrameRecipe.print
+    densityMasks: { id: string; kind: 'contrast' | 'unsharp' | 'highlight'; polarity: 'positive' | 'same'; amount: number; radius_um: number; threshold: number | null; enabled: boolean }[];
 // graph.ts compile(): one mask node (the masks multiply: densities add), passed to the main and every
 // extra print.expose except flashes
+  const dm = enabledMasks.length ? enabledMasks.reduce(…, I('print.densityMask', [dyes], {...first})) : null;
+  const exposeArgs = (…) => ({ …, ...(dm ? { densityMask: dm } : {}) });
```

Core already has the pieces (`maskExposure`, `maskDensity`, `applyDensityMask` in
`packages/core/src/print/densityMask.ts`), the GPU the passes (transmittance, blur, min reduction,
density); the change moves the PD computation to the main pack's table (core `chain.enlarger.printingDensity`).

## C6. A flash goes through the film base

**Need.** `compile()` builds every extra exposure as `print.expose` on the negative's dyes, a flash
included, so a flash exposes the image instead of fogging uniformly. Guide §6.5 finding 3: a flash must go
through the film **base** (through an empty gate the neutral pack fogs the print orange-red by
(−8.6, +1.5, +7.0) points). `Exposure.through` exists but nothing reads it. Core's `compileExposures`
reports `W_PREVIEW_APPROX` for a base flash meanwhile.

**Proposed diff** (`print.combine` and `compile()`):

```diff
-      modes: { type: 'string[]', default: [], doc: "Per exposure: 'add' (burn, flash, split) or 'subtract' (dodge)." },
+      modes: { type: 'string[]', default: [], doc: "Per exposure: 'add' (burn, split), 'subtract' (dodge), 'flash-base' or 'flash-open' (the exposure's print.expose settings, uniform: through the film base with no image, or through an empty gate)." },
 …
-      return modes.every((m) => m === 'add' || m === 'subtract') ? null : "modes must be 'add' or 'subtract'";
+      return modes.every((m) => ['add', 'subtract', 'flash-base', 'flash-open'].includes(m)) ? null : "modes must be 'add', 'subtract', 'flash-base' or 'flash-open'";
 // graph.ts compile()
-      modes.push(ex.kind === 'dodge' ? 'subtract' : 'add');
+      modes.push(ex.kind === 'dodge' ? 'subtract' : ex.kind === 'flash' ? (ex.through === 'open' ? 'flash-open' : 'flash-base') : 'add');
```

Engines then evaluate the flash's chain at dye amounts 0 (base) or with no film (open gate): one
constant per layer, H += r·m·10^x_flash. Contract law to add: an unmasked base flash adds the same H to
every pixel.

## C7. `print.combine` in normalised mode weights by seconds (doc)

Doc only. In normalised mode `print.expose` ignores time (the grey card prints at the aim whatever the
time), so `compile()`'s burn of t_main·(2^s − 1) seconds would otherwise weigh as much as the main
exposure. Core and the GPU weight each extra exposure that is a normalised `print.expose` by
t_i / t_main (core `combineRatio`); in real mode the time is already in x.

```diff
-    doc: 'Sums several exposures in linear H (dodge, burn, flash, split; CHB-010).',
+    doc: 'Sums several exposures in linear H (dodge, burn, flash, split; CHB-010): H = max(10^x − Σ_dodge m·10^x_i, 0) + Σ_add m·10^x_i, one log at the end. In normalised mode each print.expose term is weighted by its seconds over the main time.',
```

## C8. Mask op docs: what the numbers mean (doc)

Doc only; the engines implement this.

```diff
 mask.luminance.above: 'Select values above this (normalised to the domain range).'
+  + ' 0 means no lower bound (values below the domain range stay selected).'
 mask.luminance.below: 'Select values below this.'
+  + ' 1 means no upper bound.'
 mask.ellipse doc: 'Elliptical mask.'
+  + ' The edge is antialiased over one pixel; use mask.feather for a soft edge.'
 mask.feather.radius_px: 'Feather radius.'
+  → 'Feather radius in source px: a Gaussian of σ = radius/2 (the 10–90 % edge is 1.28 × radius wide).'
 mask.paint doc
+  + ' Pressure is recorded but does not modulate the brush; add takes the maximum, erase multiplies by 1 − coverage.'
```
