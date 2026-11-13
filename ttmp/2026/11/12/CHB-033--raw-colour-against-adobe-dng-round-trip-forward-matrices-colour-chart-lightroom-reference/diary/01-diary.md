---
Title: Diary
Ticket: CHB-033
Status: active
Topics:
    - ingest
    - testing
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-12T23:47:08.528912233-05:00
WhatFor: ""
WhenToUse: ""
---

## Step 1: The question, the tools, and a first comparison against Adobe's DNG

The owner asked how to make sure chromobench's RAW import matches Lightroom. chromobench renders through a film and
paper model on purpose, so the final picture is not meant to equal Lightroom's. What must match is the **scene
colour before the film**: white balance, the camera RGB → XYZ matrix, and exposure. The cheapest objective
reference without a chart is Adobe's own DNG of the same photo. Adobe DNG Converter writes Adobe's colour data for
the camera into it: two ColorMatrix and two ForwardMatrix tags (one per calibration illuminant), the camera's
AsShotNeutral, BaselineExposure, and the "Adobe Standard" camera profile.

Converting four of the photographer's D750 NEFs and decoding NEF and DNG side by side showed two things. The white
balance (fixed hours earlier in CHB-031 to read the NEF's as-shot multipliers) is identical to Adobe's. Our NEF
colour matches Adobe's colour matrices to well below visibility. Against Adobe's forward matrices, which are what
Adobe's engine actually uses, the difference was large: median ΔE2000 2.5–6.9.

### Prompt Context
**User prompt (verbatim):** "how coud we compare / make sure the raw import is matching say, lightroom itself?"; then "ok, mac is back. also it said webgpu was disabled when i just tested in chrome, what gives?"; then "install it" (Adobe DNG Converter on the Mac); then "how do i install it?"
**Assistant interpretation:** Define what "matching Lightroom" can mean for chromobench, and measure our RAW decode against Adobe's numbers for the same files.
**Inferred user intent:** Confidence that the photographer's photos enter chromobench with the right colour before the film model changes them.
**Commit (code):** 0f94c88 — "CHB-033: RAW colour against Adobe — DNG round trip (Adobe DNG Converter 19 on the Mac), NEF vs Adobe colour matrices (ΔE2000 median ≤ 0.5, neutrals identical) and forward matrices (median 2.5–6.9); plan"

### What I did
- Read the code paths. `packages/ingest/src/libraw/colour.ts`: `dngCameraToXyz` interpolates ColorMatrix1/2 in
  1/CCT at the as-shot white, iterating the white from AsShotNeutral as the DNG SDK does. `adobeCameraToXyz`
  inverts LibRaw's single `cam_xyz` (Adobe's D65 ColorMatrix from LibRaw's table) for non-DNG raws.
  `packages/core/src/film/camera.ts` `cameraMatrix(cam, { mode: 'as-shot' })` adapts the as-shot white to D65 with
  CAT16. `grep -rn "forwardMatrix\|baselineExposure"` outside `decode/tiff.ts` and `types.ts`: no hits, so both are
  read and never applied.
- Mac (`mimimi-2.local`, macOS 15.7.7): Lightroom Classic, Lightroom CC, Photoshop 2024/2025, Dehancer plugin; no
  DNG Converter. `brew install --cask adobe-dng-converter` failed:
  `sudo: a terminal is required to read the password; either use the -S option to read from standard input or configure an askpass helper`.
  Unpacked it instead, without root: `brew fetch --cask adobe-dng-converter` → `~/Library/Caches/Homebrew/Cask/adobe-dng-converter--19.0.dmg`;
  `hdiutil attach -nobrowse -readonly`; `pkgutil --expand-full DNGConverter_19_0.pkg ~/chromobench-tools/dngc`.
  The user later installed it properly; the binary is now `/Applications/Adobe DNG Converter.app/Contents/MacOS/Adobe DNG Converter`.
- Converted from the Mac's Dropbox copy (`~/Dropbox/Photos/2026-11-11 - manfred test bilder/`):
  `"…/Adobe DNG Converter" -c -p0 -d ~/chromobench-tools/dng-out DSC_8559.NEF DSC_8541.NEF DSC_8536.NEF DSC_8655.NEF`
  (lossless compressed, no preview), giving four DNGs of 25–27 MB. Copied them with `scp` to the git-ignored
  `.playwright-mcp/dng/`.
- `scripts/01-nef-vs-adobe-dng.ts`: decodes the NEF (our path) and the DNG (our DNG path) with
  `decodePhoto(…, { long: 256 })`, applies core's `cameraMatrix` (as-shot), converts to Lab(D65), and matches
  exposure on mean Y. It reports ΔE2000 (own implementation, Sharma et al. 2005) over pixels with 0.005 < Y < 0.9.
  It also computes Adobe's forward-matrix path, XYZ(D50) = FM(cct) · diag(1/neutral) · camera RGB, against a D50 white.
- Checked the DNG data: both ForwardMatrices' rows sum to D50 (0.9643 / 1.0000 / 0.8251); CameraCalibration1 and
  AnalogBalance are identity; CalibrationIlluminant1/2 are 17 (Standard A) and 21 (D65); BaselineExposure is +0.1.
- Created ticket CHB-033 with a plan and five tasks; moved the script into its `scripts/`.

### Why
- A DNG from Adobe's converter carries Adobe's own numbers for this camera, the ones Lightroom starts from, so it
  is a reference that needs no chart and no Lightroom scripting.

### What worked
- Neutrals NEF vs Adobe DNG, identical to three decimals:

  | Photo | Light | AsShotNeutral (R, G, B) |
  |---|---|---|
  | DSC_8559 | daylight truck | 0.522, 1.000, 0.740 |
  | DSC_8541 | tungsten interior | 0.617, 1.000, 0.569 |
  | DSC_8536 | evening street | 0.601, 1.000, 0.600 |
  | DSC_8655 | night, fire truck | 0.602, 1.000, 0.655 |

- ΔE2000 NEF path vs DNG colour-matrix path (median / p90 / p99): 0.13 / 0.47 / 0.66; 0.34 / 0.62 / 0.95;
  0.36 / 1.26 / 1.32; 0.51 / 0.70 / 1.23. Exposure NEF/DNG on mean Y: 0.824, 0.897, 0.886, 0.874.

### What didn't work
- `brew install --cask adobe-dng-converter` over SSH (sudo needs a terminal), as above.
- The first unpack attempt looked for a `.pkg` in the Homebrew cache: `zsh:1: no matches found: /Users/manuel/Library/Caches/Homebrew/downloads/*DNGConverter*.pkg`.
  The cask downloads a `.dmg` that contains the `.pkg`.
- `"Adobe DNG Converter" -h` over SSH printed nothing and hung for 120 s; it was stopped. The flags used (`-c`,
  `-p0`, `-d`) are the documented ones and worked.

### What I learned
- LibRaw's single matrix and Adobe's dual colour matrices agree for this camera to ΔE2000 below 1.3 at p99, even
  under tungsten, so the NEF path needs no dual-illuminant data for colour-matrix colorimetry.
- Our "as-shot" white balance for a NEF is Adobe's, exactly.

### What was tricky to build
- Comparing two colour paths needs the same white, adaptation and exposure, or the differences are artefacts of
  the comparison. Step 1's forward-matrix comparison used different whites (D65 Lab vs D50 Lab); step 2 fixes that.

### What warrants a second pair of eyes
- The forward-matrix numbers in this step are not yet trustworthy (see step 2).

### What should be done in the future
- Step 2: the same adaptation for both paths.

### Code review instructions
- `node ttmp/2026/11/12/CHB-033--…/scripts/01-nef-vs-adobe-dng.ts` (needs the NEFs in ~/Downloads and the DNGs in `.playwright-mcp/dng/`).

### Technical details
- DNG profile tags (`exiftool -s -G1`): ProfileName "Adobe Standard"; ProfileHueSatMapDims 90 30 1;
  ProfileLookTableDims 36 8 16; ProfileEmbedPolicy "Allow Copying"; DNGVersion 1.4.0.0; UniqueCameraModel
  "Nikon D750". No ProfileToneCurve tag was reported.

## Step 2: Colour matrix vs forward matrix with the same adaptation: a saturation factor of 0.55

The question for this step: is step 1's large gap the matrices, or my comparison? Both paths now go to XYZ(D50) as
the DNG 1.4 spec defines them. The colour-matrix path is CA_Bradford(white → D50) · inverse(CM(cct)), with
AnalogBalance and CameraCalibration identity. The forward-matrix path is FM(cct) · diag(1 / AsShotNeutral). Both
are interpolated in 1/CCT at the same as-shot white, both use the same exposure factor, and both are compared in
Lab(D50). The gap stays: median ΔE2000 2.6 (daylight) to 6.9 (tungsten). It is almost entirely a **chroma scale**:
the forward-matrix colours have 0.52–0.55× the chroma of the colour-matrix colours on all four photos, while hue
moves only 0.5–2.5°.

That factor is too uniform to be a random profile difference. It points at Adobe's design: Adobe Standard puts
much of its saturation into the HueSatMap and LookTable that follow the forward matrix. If that is right, neither
"FM alone" nor our path is Lightroom's colour, and only a full Adobe rendering can decide (step 3).

### Prompt Context
**User prompt (verbatim):** "ok installed, continue, take screenshots and keep a detailed diary (see skill for the format), so that we can write a detailed report once done investigating the raw decoding and color transformations. I want to be able to folow everything exactly."
**Assistant interpretation:** Continue the RAW colour investigation with screenshots and an investigation-format diary detailed enough to reproduce every result and write a report from it.
**Inferred user intent:** A traceable account of how chromobench's RAW colour relates to Adobe's, as the basis for a report and for decisions.
**Commit (code):** see the commit that adds this step

### What I did
- Wrote `scripts/02-cm-vs-fm-same-adaptation.ts`:
  - Reads ColorMatrix1/2, ForwardMatrix1/2, AsShotNeutral and the illuminants with `readDngColour`.
  - Finds the as-shot white with the spec's iteration: camera neutral → XYZ through CM at the white's CCT, 30
    iterations, CCT by McCamy.
  - Weight of illuminant 1 = (1/cct − 1/t2) / (1/t1 − 1/t2), clamped, with t1 = 2856 K and t2 = 6504 K.
  - Builds both XYZ(D50) matrices and applies them to the camera RGB working image from
    `decodePhoto(…, { long: 384 })`.
  - Reports ΔE2000 overall, by chroma (C*ab < 8, 8–25, > 25) and by 30° hue bins, plus mean C*ab per path and the
    mean |hue difference|.
  - Writes renders: colour-matrix path | forward-matrix path | ΔE map, with 0 black and ≥ 10 white; pixels outside
    0.005 < Y < 0.9 in dark blue. Each is shown as sRGB with D50 → D65 Bradford and mean Y set to 0.18.
- First run: exposure normalised per path. Second run: one exposure factor for both, because both map the neutral
  to Y = 1. The numbers barely changed (DSC_8559 median 2.58 → 2.59).
- Looked at the tungsten render, `various/shots/02-DSC_8541-cm-fm-de.png`: the colour-matrix brick is a saturated
  orange, the forward-matrix brick a calmer, pinker red, and the ΔE map is brightest on the brick.

### Why
- Same white, same adaptation (the spec's Bradford) and same exposure leave only the matrices to differ.

### What worked
- Both paths map the neutral to D50: (0.9642, 1, 0.8252) and (0.9644, 1, 0.8251), so whites agree.

  | Photo | As-shot white xy, CCT | StdA share | ΔE2000 median / p90 / p99 | By chroma <8 / 8–25 / >25 | Mean C* CM → FM (ratio) | Mean hue diff |
  |---|---|---|---|---|---|---|
  | DSC_8559 daylight | 0.3399, 0.3501; 5201 K | 0.196 | 2.59 / 5.59 / 10.34 | 1.55 / 5.20 / 9.56 | 10.11 → 5.55 (0.549) | 0.46° |
  | DSC_8541 tungsten | 0.3888, 0.3922; 3900 K | 0.523 | 6.92 / 9.26 / 10.50 | 3.43 / 7.60 / 9.84 | 26.54 → 13.73 (0.517) | 2.54° |
  | DSC_8536 evening | 0.3802, 0.3850; 4068 K | 0.469 | 4.90 / 7.09 / 10.73 | 3.12 / 6.52 / 10.15 | 18.55 → 10.24 (0.552) | 0.98° |
  | DSC_8655 night | 0.3717, 0.3708; 4214 K | 0.425 | 6.64 / 8.36 / 11.80 | 4.11 / 6.81 / 9.21 | 27.34 → 15.03 (0.550) | 2.05° |

- Screenshots (private pixels, this ticket only): `various/shots/02-DSC_8559-cm-fm-de.png`, `02-DSC_8541-…`,
  `02-DSC_8536-…`, `02-DSC_8655-…`.

### What didn't work
- No failures in this step.

### What I learned
- The step-1 gap is not adaptation: with the spec's Bradford on both sides it is unchanged.
- Adobe's forward matrices, on their own, render this camera at about half the chroma of its colour matrices.

### What was tricky to build
- The DNG spec's colour-matrix path needs the white before the matrix and the matrix before the white (the
  interpolation weight depends on the white's CCT, and the white comes from the neutral through the interpolated
  matrix). It is solved by fixed-point iteration, as in `dngCameraToXyz`. Thirty iterations from 5000 K converge
  well below 1 K here.

### What warrants a second pair of eyes
- The 0.55 chroma factor, so uniform across illuminants, could still be a misreading of ForwardMatrix. Checks done:
  the rows sum to D50, so the orientation is right and the neutral maps to D50 exactly. The decisive check is
  Adobe's own render (step 3).

### What should be done in the future
- Step 3: render the same DNGs with Adobe's engine (Camera Raw in Photoshop on the Mac) with every adjustment
  zeroed, and reproduce it from FM → HueSatMap → LookTable → tone curve. That locates each stage's contribution
  and tells which of our numbers Lightroom's colour corresponds to.

### Code review instructions
- `node ttmp/2026/11/12/CHB-033--…/scripts/02-cm-vs-fm-same-adaptation.ts [DSC_8559 …]`; renders appear as PNG after
  the `python3 -I -c "from PIL import Image …"` conversion shown in Technical details.

### Technical details
- DNG 1.4 spec, chapter 6, "Mapping Camera Color Space to CIE XYZ Space": with ForwardMatrix,
  CameraToXYZ_D50 = FM · D · Inverse(AB · CC), where D = diag(1 / (Inverse(AB · CC) · CameraNeutral)); without it,
  CameraToXYZ = Inverse(AB · CC · CM), then CA (linear Bradford) from the white to D50.
- PPM → PNG: `cd various/shots && python3 -I -c "from PIL import Image; import glob,os
  [ (Image.open(f).save(f[:-4]+'.png'), os.remove(f)) for f in glob.glob('02-*.ppm') ]"`.

## Step 3: Adobe's own rendering through Photoshop's Camera Raw: blocked (Photoshop refuses scripting); the DNG SDK instead

To find which of the two colour paths Adobe's final colour corresponds to, I tried to have Adobe's engine render
the photos with every adjustment zeroed. The route was Photoshop 2025 on the Mac, opening each NEF through Camera
Raw with an XMP sidecar: Adobe Standard, as shot, sliders at 0, linear point curve, no sharpening, noise
reduction or lens corrections. Photoshop launched, but every scripting call failed with error 8800 ("This
functionality may not be available in this version of Photoshop"), even `app.version`. The user suspects an
expired licence, which fits: a Photoshop in limited mode refuses scripting.

The replacement is Adobe's DNG SDK 1.7.1, the open-source reference implementation of DNG rendering that Camera Raw
and Lightroom follow. It downloads freely and needs no licence or Mac. From its source I took the exact order and
math of the rendering stages; step 4 ports them.

### Prompt Context
**User prompt (verbatim):** "ok try again"; "closed the modal, try again?"; "i think it's maybe because the license has expired?" (see step 2 for the request this serves)
**Assistant interpretation:** Get Adobe's actual rendering of the same photos as the reference.
**Inferred user intent:** Know how chromobench's colour relates to what Lightroom/Camera Raw would show.
**Commit (code):** see the commit that adds this step (scripts/acr/)

### What I did
- `scripts/acr/zeroed.xmp`: a Camera Raw sidecar (crs: ProcessVersion 15.4, WhiteBalance "As Shot", CameraProfile
  "Adobe Standard", Exposure2012…Blacks2012, Texture, Clarity2012, Dehaze, Vibrance, Saturation, Parametric* all
  0, Sharpness 0, LuminanceSmoothing 0, ColorNoiseReduction 0, LensProfileEnable 0, AutoLateralCA 0, vignettes 0,
  ToneCurveName2012 "Linear" with linear PV2012 curves for RGB, R, G and B).
- On the Mac: copied DSC_8559, 8541, 8536 and 8655 `.NEF` from Dropbox to `~/chromobench-tools/acr/`, each with
  `zeroed.xmp` copied as `<name>.xmp`.
- `scripts/acr/render.jsx`: open each NEF, save a TIFF with an embedded profile, log size, depth and profile.
- Attempt 1:
  `osascript -e "with timeout of 840 seconds" -e "tell application \"Adobe Photoshop 2025\" to do javascript file (POSIX file \"…/render.jsx\")" -e "end timeout"`.
  Photoshop launched (pid 65235) and no TIFF appeared. Result after 14 min:
  `71:151: execution error: Adobe Photoshop 2025 got an error: AppleEvent timed out. (-1712)`. The user then
  closed a dialog on the Mac's screen.
- Attempt 2, the same call: `71:151: execution error: Adobe Photoshop 2025 got an error: General Photoshop error occurred. This functionality may not be available in this version of Photoshop. (8800)`.
- Attempt 3, without `CameraRAWOpenOptions` (plain `app.open`, in case the deprecated options were the problem):
  the same 8800.
- Probe: `osascript -e "tell application \"Adobe Photoshop 2025\" to do javascript \"app.version\""` →
  `43:70: execution error: … (8800)`, after the user had closed the modal ("closed the modal, try again?").
- Attempt 4: `open -a "Adobe Photoshop 2025" ~/chromobench-tools/acr/render.jsx`, with the script writing
  `render.log`. After 500 s of polling there was no `render.log` and no TIFF.
- DNG SDK: `curl -L https://download.adobe.com/pub/adobe/dng/dng_sdk_1_7_1.zip` (80,367,206 bytes; 1.7 and 1.6 are
  also served), unpacked in the session scratchpad. It contains `dng_sdk/source`, the XMP toolkit, libjpeg and
  libjxl, with Xcode and Visual Studio projects only.
- Read the render pipeline in `dng_sdk/source/dng_render.cpp`. `dng_render_task::ProcessArea` (line 1504) applies,
  in this order:
  1. `DoBaselineABCtoRGB(…, fCameraWhite, fCameraToRGB)`: camera RGB → linear ProPhoto, clipped at the camera white.
  2. `DoBaselineHueSatMap(…, fHueSatMap, encode, decode)`: the profile's HueSatMap, interpolated for the white.
  3. (`DoBaselineProfileGainTableMap`, when present.)
  4. `DoBaseline1DFunction(…, fExposureRamp)` on R, G and B.
  5. `DoBaselineHueSatMap(…, fLookTable, …)`.
  6. `DoBaselineRGBTone(…, fToneCurve)` (or `…Overrange` with a slope extension).
  7. `DoBaselineRGBtoRGB` to the output space, then `fEncodeGamma`.
- From `dng_render_task::Start` (line 845):
  - `fCameraToRGB = ProPhoto.MatrixFromPCS() * spec->CameraToPCS()`.
  - `fHueSatMap = profile.HueSatMapForWhite(spec->WhiteXY())`, plus a LookTable when present, each with an
    encoding table when its encoding is not linear.
  - `exposure = params.Exposure() + TotalBaselineExposure(profile)`, with
    `white = 1 / 2^max(0, exposure)` and `black = Shadows * ShadowScale * …`.
  - `fToneCurve = exposure tone ∘ params.ToneCurve()`, which defaults to `dng_tone_curve_acr3_default`, a
    1025-entry table at line 164.

### Why
- With Photoshop unavailable, the SDK is the most authoritative reference that can be run and read. It defines the
  colour model; Camera Raw adds process-version features (local adjustments and the like) that are zeroed here
  anyway.

### What worked
- The SDK source gives every stage's order and arithmetic with file and line references.

### What didn't work
- Photoshop scripting, all four attempts, with the exact errors above. Not retried; the cause is most likely the
  licence (the user's observation), not the script.

### What I learned
- In this SDK version the profile's HueSatMap runs **before** exposure and the LookTable **after** it, and the
  default tone curve is ACR3's. A comparison of "forward matrix only" (step 2) leaves out three stages that change
  saturation: the HueSatMap, the LookTable, and the RGB tone curve, which also raises saturation where it adds
  contrast.

### What was tricky to build
- Photoshop and Camera Raw scripting depend on the app's state (modal dialogs, licence), invisible over SSH. A
  script that only writes a log gives no signal when it never runs; a timeout must be the stopping rule.

### What warrants a second pair of eyes
- If the licence is renewed, a real Camera Raw render (`scripts/acr/`, attempt 4's command) should cross-check the
  ported pipeline of step 4.

### What should be done in the future
- Step 4: port ABCtoRGB (FM path), HueSatMap (with HueSatMapForWhite), exposure ramp, LookTable and RGBTone with
  the ACR3 table into a script, and measure each stage's chroma against our colour-matrix path.

### Code review instructions
- `scripts/acr/zeroed.xmp`, `scripts/acr/render.jsx`; the SDK at
  `https://download.adobe.com/pub/adobe/dng/dng_sdk_1_7_1.zip` (`dng_sdk/source/dng_render.cpp`,
  `dng_reference.cpp`, `dng_hue_sat_map.cpp`, `dng_color_spec.cpp`).

### Technical details
- `dng_reference.cpp`: `RefBaselineABCtoRGB` (line 1389), `RefBaselineHueSatMap` (1508), `RefBaselineRGBtoRGB`
  (1796), `RefBaselineRGBTone` (1868). `dng_render.cpp`: `dng_tone_curve_acr3_default::Evaluate` (161, table at
  164), `EvaluateInverse` (441), default tone curve in `dng_render` (2111).
