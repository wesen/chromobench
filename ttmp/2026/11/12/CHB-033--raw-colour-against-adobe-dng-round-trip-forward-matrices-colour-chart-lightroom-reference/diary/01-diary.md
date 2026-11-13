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

## Step 4: Adobe's render ported from the DNG SDK: the profile tables give the saturation back, and our colour lands within ΔE2000 ≈ 1–2 of Adobe Standard

I ported the DNG SDK's rendering stages into `scripts/03-adobe-render-port.ts` and ran them on the four DNGs.
After each stage I measured mean chroma; at the end I compared Adobe's full render with two references that skip
the profile tables but share Adobe's exposure and tone curve. Reference one is our colour (the colour-matrix path,
which equals our NEF path to ΔE < 1.3, step 1). Reference two is Adobe's forward matrix alone.

Step 2's hypothesis holds. Adobe's forward matrix gives about half the chroma, and the HueSatMap multiplies it by
about 1.8. The LookTable takes back about 10 %, and the RGB tone curve adds saturation where it adds contrast.
Adobe's final colour is close to ours: median ΔE2000 0.9 (daylight) to 2.1 (tungsten), p90 2.0–4.9. Our colour is
15–20 % more saturated than Adobe Standard. Adobe's forward matrix without the tables is much further away (median
2.3–6.3). So for **Lightroom's colour**, our NEF decode is close already. The remaining difference is a moderate
saturation surplus and local hue twists from Adobe's tables, not a decoding error.

### Prompt Context
**User prompt (verbatim):** see step 2.
**Assistant interpretation:** Find out what Adobe's final colour is, stage by stage, and how far ours is from it.
**Inferred user intent:** A followable account of where chromobench's colour stands relative to Lightroom's.
**Commit (code):** see the commit that adds this step

### What I did
- Read the stage code in `dng_sdk/source`:
  - `RefBaselineHueSatMap` (`dng_reference.cpp:1508`): HSV with h in [0,6), table index
    v·(H·S) + h·S + s, bilinear in hue and saturation (trilinear with value for 3-D tables); hue wraps.
    `h += hueShift·6/360`, `s = min(s·satScale, 1)`, `v = pin(v·valScale)`.
  - `RefBaselineRGBTone` (`:1868`): the curve applied to the largest and smallest channel, the middle one keeping
    its relative position, so hue is kept and contrast adds saturation.
  - `DNG_RGBtoHSV` / `DNG_HSVtoRGB` (`dng_utils.h:834`, `:904`).
  - `dng_function_exposure_ramp` and `dng_function_exposure_tone` (`dng_render.cpp`).
  - `dng_render` defaults (`:2104`): Exposure 0, Shadows 5, the ACR3 tone curve.
  - `dng_render_task::Start`: white = 1/2^max(0, exposure); black = Shadows · ShadowScale · Stage3Gain · 0.001,
    capped at 0.99·white.
  - `HueSatMapForWhite` (`dng_camera_profile.cpp`): weight (1/T − 1/T2)/(1/T1 − 1/T2).
  - ProPhoto MatrixToPCS (`dng_color_space.cpp:996`): (0.7977, 0.1352, 0.0313 / 0.2880, 0.7119, 0.0001 /
    0, 0, 0.8249).
  - ACR3 `Evaluate` (`dng_render.cpp:164`–`:431`): 1025 entries, linear interpolation over 1024 intervals.
- Extracted the ACR3 table from the source into `.playwright-mcp/dng/acr3-tone.json` (1025 values, 0 → 1.0). It is
  Adobe's data, so it stays out of the repository. Read the DNGs' tables with `exiftool -m -b`:
  ProfileHueSatMapData1/2 (8,100 values each = 90 hue × 30 sat × 1 value × 3) and ProfileLookTableData (13,824 =
  36 × 8 × 16 × 3). No ProfileHueSatMapEncoding or ProfileLookTableEncoding tag (linear), no
  BaselineExposureOffset, no DefaultBlackRender.
- The port, per pixel of `decodePhoto(DNG, { long: 384 })`:
  1. S1 = ProPhoto ← PCS · FM(g) · diag(1/neutral) · camera RGB, clipped at 0.
  2. S2 = HueSatMap(g·map1 + (1−g)·map2).
  3. S3 = exposure ramp, with BaselineExposure 0.1: white 0.933, black 0.005.
  4. S4 = LookTable.
  5. S5 = RGBTone(ACR3).
  6. Display: PCS → sRGB (D50-adapted) and the sRGB curve.

  The two references use Adobe's exposure ramp and RGBTone(ACR3) but no tables: our colour-matrix colour, as
  ProPhoto ← PCS · Bradford(white → D50) · inverse(CM(g)), and Adobe's FM colour (S1).
- Measured mean C*ab in Lab(D50) after each stage, and ΔE2000 between each reference and S5 over pixels with
  0.01 < Y(S5) < 0.95. Renders: `various/shots/03-<name>-adobe-ours-de.png` (Adobe's full render | our colour with
  Adobe's tone | ΔE map, 0 black and ≥ 10 white, excluded pixels dark blue).
- Moved `de2000` into `scripts/lib-colour.ts` and checked it against Sharma et al.'s test pair 1: (50, 2.6772,
  −79.7751) vs (50, 0, −82.7485) → 2.0425, as published.

### Why
- Porting from Adobe's reference source is the closest reproducible stand-in for Camera Raw without Photoshop. Every
  stage can be checked line by line against the SDK.

### What worked
- Mean C*ab after each stage, and ΔE2000 against Adobe's full render (median / p90 / p99):

  | Photo | S1 FM | S2 +HueSatMap | S4 +LookTable | S5 +tone (Adobe) | Ours + Adobe tone | FM + Adobe tone | ΔE ours vs Adobe | ΔE FM-only vs Adobe | n |
  |---|---|---|---|---|---|---|---|---|---|
  | DSC_8559 daylight | 5.04 | 8.95 | 7.99 | 11.22 | 13.00 | 7.11 | 0.93 / 1.99 / 5.05 | 2.32 / 5.32 / 10.20 | 91,445 |
  | DSC_8541 tungsten | 13.08 | 24.34 | 21.86 | 31.09 | 36.48 | 18.82 | 2.11 / 4.88 / 6.45 | 6.29 / 7.89 / 9.35 | 88,474 |
  | DSC_8536 evening | 10.95 | 20.39 | 18.13 | 24.24 | 28.42 | 14.84 | 2.01 / 4.21 / 8.59 | 4.34 / 7.69 / 12.16 | 36,177 |
  | DSC_8655 night | 11.38 | 19.08 | 17.22 | 22.57 | 27.02 | 15.08 | 1.71 / 3.01 / 11.59 | 4.40 / 6.14 / 10.31 | 51,206 |

  Chroma ratio, ours to Adobe: 1.16, 1.17, 1.17, 1.20.
- `03-DSC_8541-adobe-ours-de.png`: the two renders look nearly the same; ours makes the brick slightly more orange,
  and the ΔE map is mid-grey (about 2–5) on the brick and dark elsewhere.

### What didn't work
- The first version imported `de2000` from script 02, which also ran script 02's measurement loop as a side effect
  (its output appeared above script 03's). Fixed with `lib-colour.ts`; the re-run gives the same 12 lines of
  results, without the repeat.

### What I learned
- Adobe Standard splits colour between a low-saturation forward matrix and the HueSatMap/LookTable. Comparing
  matrices alone (steps 1–2) is misleading; the full chain is what Lightroom shows.
- Our colour-matrix colour is within about ΔE2000 1–2 (median) of Adobe Standard's final colour and 16–20 % more
  saturated.
- The night and evening frames have far fewer comparable pixels (36k and 51k of 98k), because the comparison skips
  very dark and very bright pixels.

### What was tricky to build
- Two details decided whether the port was right:
  - Adobe's table index order is value-major, then hue, then saturation, with three floats per entry. Hue wraps
    from the last division to 0.
  - The exposure ramp's soft knee: black is 0.005 (Shadows 5 · 0.001), and the knee's radius is min(0.5 · black,
    (1/16)/slope).

  Getting either wrong shifts every pixel's colour or the shadows. Both follow the source verbatim. The middle
  channel in RGBTone is (H − L)·(mid − lo)/(hi − lo) + L, using the curve values of the high and low channels.

### What warrants a second pair of eyes
- The port is unvalidated against Adobe's binary (no `dng_validate` built, no Camera Raw). The steps that could
  hide an error are the table lookup and the white's temperature: McCamy here, Robertson (`dng_temperature`) in
  the SDK. A Camera Raw render once the licence is renewed, or a `dng_validate` build, would close this. Neutral
  greys stay neutral through the port: the HueSatMap's s = 0 entries leave greys unchanged, and RGBTone keeps
  r = g = b.
- "Adobe Standard" is Camera Raw's colorimetric profile. Lightroom's default for new photos since 2018 is "Adobe
  Color", which has its own look table and tone curve. That profile is not in the DNG, so this comparison is to
  Adobe Standard.

### What should be done in the future
- Decide what to match: our scene colour is already close to Adobe Standard. Any remaining difference belongs to
  look (the film model's job), not to decoding.
- The ColorChecker test (ground truth for which colour is accurate) and, if wanted, Adobe Color's tables (from
  Lightroom's profile folder on the Mac) as a second reference.

### Code review instructions
- `node ttmp/2026/11/12/CHB-033--…/scripts/03-adobe-render-port.ts [names]` (needs the DNGs and `acr3-tone.json` in
  `.playwright-mcp/dng/`; regenerate the JSON with the parser in Technical details).
- Compare `hueSat`, `rgbTone`, `ramp`, `rgb2hsv` and `hsv2rgb` with the cited SDK functions.

### Technical details
- ACR3 table parser: Python over `dng_render.cpp` lines 164 to the closing `};` of `Evaluate`, taking all float
  literals (1025 values; first 0.0, 0.00078, 0.0016; last 0.99974, 0.99987, 1.0).
- The comparison mask is Y(S5) in (0.01, 0.95), in Adobe's rendered (tone-mapped) space, so it differs from step
  2's mask.

## Step 5: Adobe's reference renderer (dng_validate) built on the Mac; the port matches it to ΔE2000 ≤ 0.13

The port of step 4 needed checking against Adobe's own code. I built the DNG SDK's `dng_validate` on the Mac, after
the user repaired Xcode (`sudo xcodebuild -runFirstLaunch`) and with a one-line fix to the bundled zlib.
`dng_validate` wrote two images per DNG: Adobe's stage-3 image (its demosaiced, linear camera RGB, the input to
rendering) and its final render in ProPhoto RGB at 16 bits. I fed the stage-3 pixels into my port and compared its
output with Adobe's render on the same pixels. They agree to median ΔE2000 0.015–0.04 and at most 0.13 over
260,000–370,000 pixels per photo, so the port is Adobe's pipeline.

With Adobe's own full-resolution demosaic as the common input, our colour (the colour-matrix path chromobench uses)
stands at median ΔE2000 0.8–1.9 from Adobe Standard's final colour (p90 2.1–4.9). Adobe's forward matrix without the
profile tables is at 2.2–6.0. This confirms step 4's numbers, which used LibRaw's demosaic at 384 px.

### Prompt Context
**User prompt (verbatim):** "i can help if you want"; "done" (after running `sudo xcodebuild -runFirstLaunch` on the Mac). See step 2 for the request this serves.
**Assistant interpretation:** Validate the ported pipeline against Adobe's reference renderer.
**Inferred user intent:** Results the report can rest on, not a port that might be subtly wrong.
**Commit (code):** see the commit that adds this step

### What I did
- Copied the SDK zip to the Mac (`~/chromobench-tools/dngsdk/`). `xcodebuild -list` first failed: `xcodebuild failed to load a required plug-in. Ensure your system frameworks are up-to-date by running 'xcodebuild -runFirstLaunch'`
  (`Symbol not found: _$s12DVTDownloads19DownloadsGlobalInfoV…` in IDESimulatorFoundation). This needs an admin
  password, and the user ran it.
- `xcodebuild -project dng_validate.xcodeproj -scheme "dng_validate release" -configuration Release -derivedDataPath ~/chromobench-tools/dngsdk/dd build`.
  First build: `BUILD FAILED`, `_stdio.h:322:7: error: expected identifier or '('` in the XMP toolkit's bundled
  zlib. Its `zutil.h:133` has `#if defined(MACOS) || defined(TARGET_OS_MAC)` and defines `fdopen(fd,mode)` as
  `NULL`, which clashes with the macOS 26.2 SDK's `fdopen` declaration. I changed it to `#if defined(MACOS)` (the
  fix newer zlib releases made); the original is kept as `zutil.h.orig`. Second build: `** BUILD SUCCEEDED **`.
  Binary: `dng_sdk/targets/mac/release64/dng_validate`, Mach-O arm64, "dng_validate, version 1.7.1".
- Rendered each DNG:
  `dng_validate -3 <out>/<name>-stage3 -cs3 -16 -tif <out>/<name>-adobe-prophoto16 <name>.dng`, about 2 s each.
  Stage 3 is 6032 × 4032 × 3 uint16 with no ICC profile. The final image is 6016 × 4016 × 3 uint16 with an ICC
  profile, cropped at DefaultCropOrigin (8, 8), DefaultCropSize 6016 × 4016. Copied the eight TIFFs (1.16 GB) with
  `scp` to the git-ignored `.playwright-mcp/dngv/`.
- `scripts/04a-sample-dng-validate.py` (numpy + tifffile, no colour math): every 8th pixel of the final image and
  the stage-3 pixel at the same place, shifted by the crop origin. That gives 377,504 samples per photo as float32
  records (stage-3 RGB, final RGB) in `<name>-samples.f32`.
- Moved the port's functions from script 03 into `scripts/lib-adobe.ts`, so scripts 03 and 04 run identical code.
  Script 03 gives the same numbers after the move (DSC_8559: 0.93 / 1.99 / 5.05).
- Read two more details in the SDK:
  - `RefBaselineABCtoRGB` (`dng_reference.cpp:1389`) caps each camera channel at the camera white before the
    matrix.
  - The camera white is `colorMatrix · XYZ(white)` scaled to a maximum entry of 1 (`dng_color_spec.cpp:548–550`).
    The forward-matrix path then divides by that white (`:591–595`).

  In the port, the cap is the neutral divided by its maximum.
- `scripts/04-validate-port.ts`:
  - Caps and renders each stage-3 sample through the port.
  - Compares with Adobe's value as 16-bit code differences (the port's output encoded as x^(1/1.8)) over all
    samples.
  - Computes ΔE2000 in Lab(D50) over samples where Adobe's encoded output is between 0.0193 and 0.999. That skips
    the SDK's spline toe, below 0.0193 encoded, and clipped values.
  - Puts our colour-matrix colour and Adobe's forward matrix without tables, both through Adobe's exposure and
    tone, against the same Adobe render.

### Why
- Feeding Adobe's stage 3 into the port removes every difference except the rendering itself: same demosaic,
  same pixels, same crop.

### What worked
- Port vs `dng_validate` (median / p90 / p99 / max):

  | Photo | Compared | ΔE2000 port vs Adobe | Samples > 3 | 16-bit code \|Δ\| (all samples) |
  |---|---|---|---|---|
  | DSC_8559 | 366,072 | 0.040 / 0.060 / 0.070 / 0.13 | 0 | 5.6 / 7.3 / 178.9 / 200.9 |
  | DSC_8541 | 369,216 | 0.023 / 0.032 / 0.039 / 0.09 | 0 | 4.3 / 7.5 / 84.9 / 201.1 |
  | DSC_8536 | 293,083 | 0.015 / 0.027 / 0.040 / 0.07 | 0 | 3.2 / 164.4 / 199.8 / 201.1 |
  | DSC_8655 | 259,738 | 0.016 / 0.031 / 0.048 / 0.11 | 0 | 3.5 / 173.9 / 199.8 / 201.3 |

  The large code differences sit only in the deepest shadows, where the port encodes with a pure power and the SDK
  with its spline toe (`dng_function_GammaEncode_1_8`, x ≤ 8.2·10⁻⁴). That is why the dark evening and night
  frames have p90 values above 160 while their ΔE over the compared range stays below 0.05.
- Against Adobe's render, with Adobe's demosaic for all (ΔE2000 median / p90 / p99 / max):

  | Photo | Our colour + Adobe exposure/tone | Adobe FM without tables |
  |---|---|---|
  | DSC_8559 daylight | 0.785 / 2.106 / 5.164 / 15.95 | 2.227 / 5.590 / 10.386 / 16.52 |
  | DSC_8541 tungsten | 1.863 / 4.916 / 6.757 / 15.20 | 5.981 / 7.842 / 9.368 / 15.68 |
  | DSC_8536 evening | 1.484 / 3.046 / 5.789 / 13.81 | 4.101 / 6.272 / 10.817 / 14.84 |
  | DSC_8655 night | 1.599 / 2.640 / 11.083 / 19.75 | 4.502 / 6.021 / 9.642 / 20.73 |

### What didn't work
- `xcodebuild` before the user's `-runFirstLaunch` (above). The first build failed in zlib (above).
- `find … -perm +111` found the built binary in `dng_sdk/targets/mac/release64/`, not in the derived-data folder,
  and my first attempt to run it used an empty variable: `zsh:1: permission denied:`. The second `find` located it.
- The repository root's `python3` (pyenv shim) has no `tifffile` (`ModuleNotFoundError: No module named 'tifffile'`).
  The sampler runs with `~/.pyenv/versions/3.11.3/bin/python3` (`pyenv which python3` from the scratchpad), called
  from outside the repository.

### What I learned
- The port reproduces Adobe's renderer to ΔE2000 0.13 at worst, despite McCamy instead of Robertson for the white's
  temperature (g differs too little to show).
- Steps 4 and 5 agree on our distance from Adobe Standard (median 0.8–2.1 either way). So LibRaw's demosaic and
  the working-image size do not change the conclusion.

### What was tricky to build
- Aligning the two images: the final render is cropped (DefaultCropOrigin 8, 8), stage 3 is not. Without the
  offset, every sample compares neighbouring pixels and texture inflates every difference.
- The comparison range: values encoded below 0.0193 use the SDK's spline. Including them with a pure-power decode
  would blame the port for an encoding detail, so they are excluded from ΔE (but kept in the code-difference column).

### What warrants a second pair of eyes
- The zlib patch is applied only to the SDK copy on the Mac (not committed anywhere); it is needed to rebuild there.
- Adobe Standard is the profile in the DNG. Lightroom's default for new photos is Adobe Color (found on the Mac at
  `/Library/Application Support/Adobe/CameraRaw/Settings/Adobe/Profiles/Adobe Raw/Adobe Color.xmp`), not compared yet.

### What should be done in the future
- Adobe Color as a second reference: render with `dng_validate -profile` if the profile can be embedded, or port
  its look table from the XMP.
- A ColorChecker for ground truth (which of the colours is accurate).
- The report.

### Code review instructions
- `python3 04a-sample-dng-validate.py .playwright-mcp/dngv <name> 8` (with a python that has tifffile and numpy),
  then `node ttmp/2026/11/12/CHB-033--…/scripts/04-validate-port.ts`.
- On the Mac: `~/chromobench-tools/dngsdk/dng_sdk_1_7_1/dng_sdk/targets/mac/release64/dng_validate -3 <stage3> -cs3 -16 -tif <out> <file>.dng`.

### Technical details
- `dng_validate` options used: `-3 <file>` (stage-3 image to "<file>.tif"), `-cs3` (ProPhoto RGB), `-16`
  (16 bits per channel), `-tif <file>`.
- Encoded threshold 0.0193 = y1 of `dng_function_GammaEncode_1_8` (x1 = 8.2118790552e-4, y1 = 0.019310851).
