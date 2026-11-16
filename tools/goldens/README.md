# Golden pictures (CHB-037 P0, P2b)

The oracle for the CHB-037 hard cut-off: pictures of the recipe-v2 pipeline (P0) rendered on core's f64 reference
engine for a fixed set of synthetic frames and recipes, made before anything was deleted. Since P2b every case is a
format-3 document (contract 1.0), compiled by the one compiler and rendered on the reference engine alone; it
reproduces the P0 pictures except where the plan named a change (below). The documents are the cases now.

## What is stored (`packages/conformance/goldens/`, about 8.6 MB)

```
index.json                    format chromobench-goldens/2: engine, cuts, tolerance, fixtures, cases[]
fixtures/negative-96x64.tif   synthetic colour negative (16-bit TIFF, RefEngine.open)
fixtures/camera-96x64.f32     synthetic camera file: linear camera RGB, float32 LE, 96 × 64 × 3 (RefEngine.openDecoded)
fixtures/camera-96x64.json    its SourceInfo (camera matrix, as-shot neutral); sha256 = SHA-256 of the .f32 bytes
cases/<id>/document.json      the format-3 document the check compiles (translate.ts made it from recipe.json)
cases/<id>/recipe.json        the P0 recipe (version 2) the pictures were first rendered from: provenance only
cases/<id>/print.json         header of the cut `print`   (the view.adapt node, domain print-xyz)
cases/<id>/display.json       header of the cut `display` (the output.frame node, domain display-rgb, sRGB)
cases/<id>/print.f32          pixels (absent when an identical picture is stored elsewhere: follow the header's `file`)
cases/<id>/display.f32
```

A third fixture, the M1 negative, is referenced in place (`fixtures/synthetic/m1-negative-96x64.tif`). Every fixture
entry in `index.json` carries its path and SHA-256; the engine refuses a fixture whose bytes hash differently.

A cut header:

```json
{ "case": "neg-burn-gradient", "cut": "display", "op": "output.frame", "domain": "display-rgb",
  "width": 96, "height": 64, "channels": 3, "dtype": "float32", "endian": "little",
  "layout": "interleaved, row-major, top row first", "file": "cases/neg-burn-gradient/display.f32",
  "sha256": "…", "stats": { "min": [r, g, b], "max": [r, g, b], "mean": [r, g, b] }, "warnings": [] }
```

`file` is relative to the data directory; identical pictures (the print cut of a crop or a retouch case equals its
base's) share one file. Pixels are the engine's f64 results rounded to float32. Each case in `index.json` also lists
what it `exercises` (P0's recipe fields) and the compiled chain's `ops` (closure of the display node, inputs first).

## The cases

67 cases, named by what they exercise (`index.json` has the titles): the 60 translated from P0's recipes, six
golden stacks of the digital layers (P8a), built as documents by `stacks.ts` on the balanced cases `neg-auto-lights`
and `cam-auto`, and the changed-media cases of CHB-048 on `cam-auto` (no recipe: `stacks.ts` is their provenance; `node tools/goldens/stacks.ts` rewrites their documents,
then `render.ts --only <ids>` their pictures). The stacks change only the cut `display` of a negative (the print
stage comes after `print`) and both cuts of the camera file (its scene stage comes before the film).

| Group | Cases |
|---|---|
| sources, plain print | `neg-plain` (as opened: 10 s, no lights), `neg-m1-plain`, `cam-plain` |
| lights, auto balance | `neg-auto-lights` (the studio's first print: integrate to grey), `neg-auto-filtration` (first print baked into filtration), `neg-lights-manual`, `cam-auto`, `neg-normalised` |
| enlarger | `neg-time-half`, `neg-time-double`, `neg-fstop`, `neg-filtration-magenta`, `neg-filtration-cyan-yellow` |
| grade, preflash | `neg-grade-soft`, `neg-grade-hard`, `neg-preflash`, `neg-preflash-strong` |
| exposures × masks | `neg-dodge-ellipse`, `neg-dodge-ellipse-feather` (rotated), `neg-burn-gradient`, `neg-burn-gradient-not`, `neg-burn-paint` (add and erase), `neg-dodge-or`, `neg-burn-and`, `neg-burn-luminance-scan` (luminance of the scan), `neg-dodge-luminance-print` (luminance of the main exposure, feathered), `neg-flash-base`, `neg-flash-base-gradient`, `neg-flash-open-ellipse`, `neg-split`, `neg-split-masked`, `neg-exposures-mixed` (dodge + burn with filtration + flash + a disabled burn), `cam-exposures` |
| density masks | `neg-dm-contrast-positive`, `neg-dm-contrast-same`, `neg-dm-unsharp-positive`, `neg-dm-unsharp-same` (each re-metered with the first print), `neg-dm-unmetered`, `neg-dm-two-with-burn-flash` (two masks and a disabled one, a burn and a base flash), `cam-dm-unsharp` |
| retouch | `neg-retouch-heal` (three spots and a disabled one), `neg-retouch-clone`, `cam-retouch` |
| crop, orientation | `neg-crop`, `neg-orient-cw90-crop`, `neg-orient-flipH`, `neg-orient-transverse`, `neg-straighten` (4° in a crop, rot180), `cam-crop-ccw90` |
| scan, view, capture | `neg-scan-flare`, `neg-scan-baseT`, `neg-view-print-as-seen`, `neg-knee-clip`, `cam-exposure-plus1`, `cam-wb-as-shot`, `cam-wb-custom`, `cam-development`, `cam-grade-lights` |
| changed media (CHB-048) | `cam-wb-tungsten` (white balance 3200 K, +10 on the balanced camera file: the print goes blue, the light was about 5400 K) |
| stacks (P8a) | `stack-print-tone` (exposure, an S-curve on L, levels on blue, vibrance), `stack-print-colour` (HSL bands, colour grading, a mixer at 0.7), `stack-print-masked` (a curve under a radial mask, exposure under a colour range ∩ gradient, vignette, sharpen), `stack-print-blends` (multiply, screen, soft light, luminosity and colour layers; an isolated luminosity group under a mask; a pass group at 0.6), `stack-print-mono` (monochrome mixer, levels, split toning), `stack-scene` (a camera file's scene stage: exposure under a luminance mask reading `scene.input`, a curve on R, HSL; a print vignette) |
| new in P2b | `neg-dust-heal` (a scan-stage group `dust` of three one-spot heal layers, coalesced into one `heal` node on scanner density), `neg-finishing-clarity` (a print-stage `clarity` layer, strength 0.4, radius 0.576 mm = P0's 12 px × 48 µm) |

P0 built the recipes the way the studio built them then (`defaultRecipe`, the studio's first print with core's
integrate-to-grey, the closed mutation set, the studio's mask editor); the auto balance is frozen in the numbers.
P2b translated each recipe once into a document (`translate.ts`, below); `cases.ts` (the P0 builders, on the deleted
recipe model) is gone.

## The engine

`engine.ts`: `RefEngine` (exact mode, `nodePacksData()`) alone. A case's document is compiled with `compile()` into the
engine's graph; the cuts are the compiler's named cuts `print` (view.adapt) and `display` (output.frame, which core
implements since contract 1.0). Everything is evaluated at `{ scale: 'full', precision: 'export' }`. No evaluation code
of its own.

## Commands

```sh
node tools/goldens/render.ts --check               # re-render the stored documents, compare, print per-case max/mean |Δ|
node tools/goldens/render.ts --check --tol 1e-4    # another tolerance
node tools/goldens/render.ts --check --only neg-split,cam-auto
node tools/goldens/render.ts --only neg-split      # re-render some cases' pictures (a deliberate oracle change: say why)
node tools/goldens/render.ts                       # re-render every case's pictures
node tools/goldens/render.ts --fixtures            # also rewrite the fixtures first (changes every golden)
node tools/goldens/translate.ts                    # the one-off P2b translation: recipe.json → document.json, index format 2
```

The check passes when, for every case and both cuts, the shape and domain match and the largest absolute difference
of any float32 sample is ≤ the tolerance (default `1e-5`, `TOLERANCE` in `golden.ts`). It reproduces every file
exactly (max |Δ| = 0): the reference engine is deterministic (grain is seeded) and no case depends on timing, caching
or the machine. `goldens.test.ts` runs the same check in vitest, and checks that every document is the translation
of its recipe (about 9 s).

## The P2b translation (`translate.ts`) and what changed

Each `recipe.json` was translated into a format-3 document by design §23's mapping and the plan's rules (design-doc
01, "Amendments after P2a"); the stored pictures stayed the oracle and only the compile step changed:

- media: scan `umPerPx` 6 (the fixtures had none; P0's density masks used `DEFAULT_FILM_UM_PER_PX` = 6), darkroom
  `magnification` 8 (P0's null was the calibration's 8), a camera file's film format from `capture.format`;
- darkroom: `main` (expose: time, f-stop, filtration), `lights` (filter: logH; the AutoBalance record in its
  `source`), exposures as `dodge` / `burn` (split = a burn with its pack) / `flash` (with `through`; one without time
  or stops gets the main time), density masks as `densityMask` (amount → gamma), preflash as a `preflash` layer;
- masks (P0's node closures) as mask values: gradient → `linear`, or-ed shapes → `add` components, `mask.and` →
  an `intersect` component, not → `invert`, feather px → `feather_mm` = px × the print's µm/px / 1000 (48 for the
  scans, 3000 for the camera file), luminance of the scan → `reads: 'source'`, of the main exposure →
  `reads: 'darkroom.main'`;
- retouch spots → a print-stage group `retouch` of one heal or clone layer per spot (natural id order; a disabled
  spot is a disabled layer); P0's unrendered `scan.dust.spots` → a scan-stage group `dust` of heal layers (sources
  chosen beside each speck); finishing clarity (preview px) → a `clarity` layer in mm;
- `view.frame` → `geometry`, `view.output` → `output`.

56 of P0's 58 pictures are reproduced bit for bit (max |Δ| = 0, both cuts). Two were re-rendered deliberately
(`render.ts --only`), with the physics reason (P2b diary, Step 3):

| Case | P0 → P2b max / mean \|Δ\| (print; display) | Why |
|---|---|---|
| `neg-burn-and` | 1.03e-1 / 5.59e-4; 9.23e-2 / 7.37e-4 | The one mask algebra (design D4): intersect is the product, P0's `mask.and` the minimum |
| `cam-dm-unsharp` | 3.75e-1 / 3.24e-2; 2.65e-1 / 3.05e-2 | One film pitch per document: P0 blurred a camera file's density mask at 6 µm/px (the hidden default) while its film ops used 375 µm/px (36 mm over 96 px); the 30 µm mask is now σ = 0.08 px |

The H < 1e-8 floor (now after the lights, P0 before them) changed no stored pixel.

Later deliberate re-renders:

| Case | Before → after max / mean \|Δ\| (print; display) | Why |
|---|---|---|
| `stack-print-blends` | 0 / 0; 1.22e-1 / 5.05e-2 (display mean RGB 0.249 0.261 0.267 → 0.299 0.314 0.316) | D7 (CHB-045, contract 1.5): soft light, like every contrast mode, is evaluated in the display encoding and switches at display mid-grey; its top (a curve of 0.1…0.9) is above display mid-grey more often than above linear ½, so the layer lightens more |

CHB-048 (contract 1.6) replaced the camera file's white balance mode (daylight / as-shot / custom) by the white of the
light as a temperature and a tint in Lightroom's units, applied as CAT16 to D65. The documents were re-translated
(`translate.ts`: P0's daylight → `NO_CORRECTION`, D65's white; as-shot → the camera fixture's as-shot white, 5391.6 K
+12.69; P0's custom 4000 K +10 on its own daylight-locus scale → 4022.7 K +5.97) and `stacks.ts` re-ran; **every stored
picture is reproduced bit for bit** (`render.ts --check`: 66/66 cases, max |Δ| = 0 at both cuts), so the as-shot
white, no correction and the old custom white are the same pictures as before. New case: `cam-wb-tungsten` (3200 K,
+10 on `cam-auto`; built by `stacks.ts`).

CHB-045's integer grid rule and the density mask's log floor changed no stored pixel (the reference already divided in
f64, and no golden's mask exposure is below 1e-8).

Things to know:

- **Auto balance is frozen.** The first print ran when the goldens were made; its result is in each document (main
  time, the lights' logH, the AutoBalance record). The check re-renders those numbers; it does not re-run metering.
- **`print` is before the print stage**: `view.adapt` precedes heal, clone and clarity, so retouch and clarity cases
  differ from their base only in the `display` cut.
- **Density masks lighten the print.** A positive mask is 0 at the densest area (here the ramp's highlight end,
  pixel (95, 6)) and adds density everywhere else (γ 0.6 at 25 µm: mean 0.46 D), so the print gets much lighter;
  `neg-dm-unmetered` keeps that, the other density-mask cases are re-metered with the first print.
