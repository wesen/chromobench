# Golden pictures (CHB-037 P0)

The oracle for the CHB-037 hard cut-off: pictures of **today's** pipeline (recipe v2, `compile()` in
`packages/contract/src/graph.ts`) rendered on core's f64 reference engine for a fixed set of synthetic frames and
recipes, made before anything is deleted. Phase P2 (contract 1.0, document format 3, the light law) must reproduce
them from equivalent documents (design CHB-035 §35–37).

## What is stored (`packages/conformance/goldens/`, about 8 MB)

```
index.json                    format, engine, cuts, tolerance, fixtures, cases[], skipped[]
fixtures/negative-96x64.tif   synthetic colour negative (16-bit TIFF, RefEngine.open)
fixtures/camera-96x64.f32     synthetic camera file: linear camera RGB, float32 LE, 96 × 64 × 3 (RefEngine.openDecoded)
fixtures/camera-96x64.json    its SourceInfo (camera matrix, as-shot neutral); sha256 = SHA-256 of the .f32 bytes
cases/<id>/recipe.json        the FrameRecipe (version 2) that was rendered
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
what it `exercises` and the compiled chain's `ops` (closure of the display node, inputs first).

## The cases

58 cases, named by what they exercise (`index.json` has the titles):

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

**Skipped** (recipe stored, no pictures; listed under `skipped` with the missing ops): `neg-dust-heal`
(`scan.heal`) and `neg-finishing-clarity` (`finishing.clarity`). No physics engine implements these two ops today
(only engine-mock does, `scan.heal` as identity), so the studio cannot show them on real physics either. The check
reports when one starts rendering: then remove its `skip` in `cases.ts` and re-render.

Recipes are built the way the studio builds them (`cases.ts`): `defaultRecipe`, the studio's first print
(`apps/studio/src/host/first-print.ts` with core's integrate-to-grey, as `host/engines.ts` injects it), then the
closed mutation set (`set`, `exposure.add`, `mask.set`). Masks come from the studio's mask editor (`maskSpec` in
`packages/studio-kit/src/model/tools.ts`: shapes or-ed, feather, invert) or, for `mask.and` and `mask.luminance`,
from interned `mask.*` nodes as the agent DSL makes them. Coordinate masks hang off the `source.open` node.

## The engine

`engine.ts`: `RefEngine` (exact mode, `nodePacksData()`) wrapped in the studio's `StudioEngine`, which computes
`output.frame` (crop, straighten, orientation) as the studio does on real physics. The recipe is compiled with
`compile()` into the wrapper's graph; the cut nodes are found by walking the receiver chain up from the display
node. Everything is evaluated at `{ scale: 'full', precision: 'export' }`. No evaluation code of its own.

## Commands

```sh
node tools/goldens/render.ts --check               # re-render the stored recipes, compare, print per-case max/mean |Δ|
node tools/goldens/render.ts --check --tol 1e-4    # another tolerance
node tools/goldens/render.ts --check --only neg-split,cam-auto
node tools/goldens/render.ts                       # regenerate every case from cases.ts (rewrites the data directory)
node tools/goldens/render.ts --only neg-split      # regenerate some cases (index entries of the others are kept)
node tools/goldens/render.ts --fixtures            # also rewrite the fixtures first (changes every golden)
```

The check passes when, for every case and both cuts, the shape and domain match and the largest absolute difference
of any float32 sample is ≤ the tolerance (default `1e-5`, `TOLERANCE` in `golden.ts`). Today it reproduces every
file exactly (max |Δ| = 0): the reference engine is deterministic (grain is seeded) and no case depends on timing,
caching or the machine. `goldens.test.ts` runs the same check in vitest (about 5 s).

## How P2 uses it

1. Translate each `recipe.json` into a format-3 document (by hand or with a one-off script in P2), using the mapping
   of design §23: `print.enlarger` → light layer `expose` id `main`; `print.exposures` → `dodge` / `burn` / `flash`
   (with `through`) / `split` layers with the same masks; `print.densityMasks` → `densityMask` modulators;
   `print.lights`, `print.grade` → `filter` layers; `retouch.spots` → print-stage `heal` / `clone`; `view.frame` →
   document geometry; `masks` (node closures) → the document's `Coll<Mask>`. Scan, capture, paper and view
   settings become the media. Skipped cases need no translation until their op exists.
2. Replace the compile step in `engine.ts` (`compile(r, g)` and the walk to `view.adapt` / `output.frame`) with
   the new compiler's cuts `print` and `display`, keep the comparison (`golden.ts` `compareCut`, `checkAll`), and
   run `--check`. The pictures and headers stay as they are: they are the oracle.
3. Expected tolerance: the light law is today's `combinePixel` for today's kinds, so a faithful translation
   should reproduce the files to float32 rounding; a summation-order change in f64 stays far below `1e-5`. A
   larger difference is a semantic change to explain, not a tolerance to widen.

Things to know:

- **Auto balance is frozen.** The first print ran when the goldens were made; its result is in each recipe
  (`print.enlarger.time_s`, `print.lights.logH`, `print.lights.auto`). The check re-renders those numbers; it does
  not re-run the metering.
- **Masks reference node ids.** Mask closures in `recipe.json` contain `source.open` with the fixture's sha256 and
  (for `neg-dodge-luminance-print`) the main `print.expose` chain; a luminance mask normalises to its receiver's
  domain range (`camera-linear` 0…1, `paper-logH` −4…3).
- **`print` is before retouch**: `view.adapt` precedes `retouch.heal`, so retouch cases differ from their base
  only in the `display` cut.
- **Density masks lighten the print.** A positive mask is 0 at the densest area (here the ramp's highlight end,
  pixel (95, 6)) and adds density everywhere else (γ 0.6 at 25 µm: mean 0.46 D), so the print gets much lighter;
  `neg-dm-unmetered` keeps that, the other density-mask cases are re-metered with the first print.
- **No µm per pixel.** The fixtures' nodes carry `umPerPx: {}`, so `radius_um` of the density masks is converted
  with the engine's default pitch (`DEFAULT_FILM_UM_PER_PX` = 6 in core: 300 µm and 25 µm are σ = 50 px and 4.2 px here); a document format that records the film's pitch must keep that default to match.
