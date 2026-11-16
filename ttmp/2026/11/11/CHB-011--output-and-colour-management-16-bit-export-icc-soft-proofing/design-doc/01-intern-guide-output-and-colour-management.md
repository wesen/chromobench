---
Title: 'Intern guide: Output and colour management'
Ticket: CHB-011
Status: active
Topics:
    - colour-management
    - image-pipeline
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/design-doc/01-chromobench-architecture-and-work-plan.md
      Note: Recipe view.output, output.display/output.encode in the catalog, packages/output layout, open decision on real prints (§8.4)
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: §2.7 viewing, flare, Saunderson, display and knees; §2.8 knee-last law; §4.1 CRC table; §4.7 tile test
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/chromogen-studio-1.2/samples/gold200.png
      Note: Gold 200 frame used for the tiled-versus-one-pass export test
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-chromogen-studio.md
      Note: Output transform (§2.9), export behaviour (§5.3) and the paper-white and 16-bit export bugs (§6.3)
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/05-inline.js
      Note: 'Code to port and fix: export.js 3230–3387 (PNG16, TIFF16, zip, CRC), FS_OUT 2027–2076, exportTiles 3180–3227, exportFrame 4465–4511 (bug at 4484)'
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/book/10-ch10.md
      Note: The Studio's own output order and encoding, and its not-built list (ICC soft proofing, output sharpening)
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/cg/stocks/kodak_portra_endura.json
      Note: 'The Portra Endura paper stock (listed, not parsed here). The paper white (Y 0.813) and Dmax (2.37) used in the two renderings come from the textbook §2.7 single-pass reflectance model, not from this file (CHB-047 OUT-6)'
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:25.023901516-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Output and colour management

## 1. What this ticket builds

Everything upstream of this ticket computes what a simulated colour print *is*: its dye amounts, its reflectance, and finally its CIE XYZ under a viewing light. CHB-011 turns that into something a person can look at or keep:

- **the screen**: a WebGPU canvas in the display's widest colour space, showing the print either as it would look in the room or as a normalised scan of it;
- **files**: 16-bit PNG and TIFF in sRGB, Display P3, Rec.2020, Adobe RGB (1998) or ProPhoto RGB, with an ICC profile embedded so other software reads the colours correctly;
- **real prints**: a conversion to an inkjet printer's ICC profile, and a **soft proof**, an on-screen simulation of how that inkjet print of the simulated print will look;
- **full-resolution export** of large scans, rendered tile by tile through CHB-005's tile planner, with progress and cancellation.

The package is `@chromobench/output` (`packages/output`). It also owns the output settings in the recipe (`view.output`) and the catalog ops `output.display` and `output.encode`.

What CHB-011 does **not** do:

- It does not compute the print. Paper exposure, development, reflectance, viewing flare and chromatic adaptation to the viewing light are CHB-003's (`print.*`, `view.*` ops). CHB-011 starts from the `print-xyz` domain.
- It does not run the per-pixel chain on the GPU. CHB-005 owns the WGSL kernels and the tile planner; CHB-011 supplies the output maths that the last kernel runs and drives tiled evaluation.
- It does not model the paper's internal reflections (Saunderson's correction as a physical reflectance model is CHB-015) or decode input files (CHB-006).
- It does not build the export dialog or the view toggle; CHB-009 builds UI against the API defined here.

## 2. Background

### 2.1 From XYZ to numbers in a file

CIE XYZ describes a colour as three numbers derived from the eye's colour-matching functions; Y is luminance. A **colour space** for files and screens is defined by three things:

1. **Primaries**: the chromaticities of its red, green and blue. They fix a 3 × 3 matrix from XYZ to linear RGB.
2. **A white point**: the XYZ that RGB = (1, 1, 1) represents. Most spaces use D65 (x, y = 0.3127, 0.3290); ProPhoto uses D50.
3. **A transfer function** (also called a tone response curve, TRC): the non-linear encoding from linear RGB to stored values, so that 8 or 16 bits are spent evenly in perceptual terms.

The five output spaces of this ticket:

| Space | Red, green, blue primaries (x, y) | White | Transfer function (encoding) |
|---|---|---|---|
| sRGB | (0.64, 0.33), (0.30, 0.60), (0.15, 0.06) | D65 | 12.92·v below 0.0031308, else 1.055·v^(1/2.4) − 0.055 |
| Display P3 | (0.680, 0.320), (0.265, 0.690), (0.150, 0.060) | D65 | sRGB curve |
| Rec.2020 | (0.708, 0.292), (0.170, 0.797), (0.131, 0.046) | D65 | BT.709/2020 OETF, or pure 2.4 (open decision, §9) |
| Adobe RGB (1998) | (0.64, 0.33), (0.21, 0.71), (0.15, 0.06) | D65 | v^(256/563), gamma 2.19921875 |
| ProPhoto (ROMM) RGB | (0.7347, 0.2653), (0.1596, 0.8404), (0.0366, 0.0001) | D50 | gamma 1.8 (ROMM adds a linear segment below 1/512) |

A concrete example ties these together. The textbook's grey card, printed on Portra Endura and viewed under a 5,000 K light, has XYZ = (0.1706, 0.1750, 0.1686). Adapted to D65 it becomes (0.1664, 0.1754, 0.2131) (textbook §2.7). In each space:

| Space | Linear RGB | Encoded | 16-bit codes | 8-bit |
|---|---|---|---|---|
| sRGB | 0.1634, 0.1766, 0.1988 | 0.4409, 0.4573, 0.4831 | 28,895, 29,969, 31,663 | 112, 117, 123 (`#70757b`) |
| Display P3 | 0.1657, 0.1762, 0.1966 | 0.4439, 0.4568, 0.4806 | 29,089, 29,934, 31,499 | 113, 116, 123 |
| Rec.2020 (BT.709 OETF) | 0.1693, 0.1760, 0.1962 | 0.3950, 0.4037, 0.4290 | 25,885, 26,455, 28,114 | 101, 103, 109 |
| Adobe RGB (1998) | 0.1671, 0.1766, 0.1979 | 0.4433, 0.4546, 0.4787 | 29,054, 29,792, 31,370 | 113, 116, 122 |
| ProPhoto (D50, Bradford from D65) | 0.1727, 0.1759, 0.1956 | 0.3770, 0.3809, 0.4039 | 24,704, 24,959, 26,469 | 96, 97, 103 |

The same colour is stored as quite different numbers. A file without a tag saying which space its numbers are in is ambiguous, and most software then assumes sRGB: a ProPhoto file read as sRGB looks dull and dark. That is why every file this ticket writes carries its colour space.

The sRGB row reproduces the textbook's `#70757b`; the other rows apply each space's matrix, derived from the primaries above, to the same XYZ.

### 2.2 Whites and chromatic adaptation

A print viewed under a 5,000 K lamp has a white that is warmer than a display's D65 white. The eye adapts to the light it is in; to show the print on a display, colours are converted as if the eye had adapted to D65. A **chromatic adaptation** does this. Chromogen's `colour.adapt` (`05-inline.js` 912–915) uses Bradford's method: a matrix takes XYZ to cone-like responses, each response is scaled by the ratio of the destination white's response to the source white's, and the inverse matrix takes the result back. The print table already applies this from the 5,000 K white to D65 (`printSetup`, 1763–1787).

One property makes the output path simple: two Bradford adaptations compose exactly into one. Adapting A → B and then B → C is M⁻¹·diag(c/b)·M·M⁻¹·diag(b/a)·M = M⁻¹·diag(c/a)·M, the adaptation A → C. So a ProPhoto export can adapt the already D65-adapted XYZ from D65 to D50 with no loss.

The same mechanism, applied to whites of different *luminance*, also scales: adapting from a white with Y = 0.813 to a white with Y = 1 brightens everything by about 1/0.813. Section 2.5 uses this.

### 2.3 ICC profiles

An **ICC profile** (ICC.1, version 4.4 is current; many readers also accept version 2) is a small binary file that describes a colour space or a device by mapping it to a **profile connection space** (PCS), which is CIE XYZ or CIELAB relative to a D50 white. Two kinds matter here:

- **Matrix/TRC profiles** describe RGB spaces like the five above: the white point (`wtpt`), the three colorants as D50-adapted XYZ (`rXYZ`, `gXYZ`, `bXYZ`), three transfer curves (`rTRC`, `gTRC`, `bTRC`, in version 4 usually a parametric curve), and in version 4 the chromatic adaptation used to get to D50 (`chad`). Such profiles are 400 to 800 bytes.
- **LUT-based profiles** describe real devices, for example an inkjet printer on one paper: multidimensional tables from device values to PCS (`A2B*`) and back (`B2A*`), one per **rendering intent**.

A **colour management module** (CMM) such as Little CMS (lcms2) chains two profiles into a transform. The **rendering intent** says what to do with colours the destination cannot reproduce and with the media white:

| Intent | Media white | Out-of-gamut colours |
|---|---|---|
| perceptual | mapped to destination white | compressed smoothly by the profile's own tables |
| relative colorimetric | mapped to destination white | clipped; in-gamut colours exact relative to white |
| absolute colorimetric | kept as measured (paper tint and level shown) | clipped |
| saturation | mapped | vivid, not accurate |

**Black point compensation** (BPC) additionally maps the source's black to the destination's black, so shadows do not block up.

**Embedding.** PNG carries a profile in an `iCCP` chunk (W3C *PNG Specification, Third Edition*, a Recommendation of 24 June 2025, §11.3.2.3: profile name of 1–79 bytes, a null byte, compression method 0, then the zlib-compressed profile). The same edition adds `cICP` (§11.3.2.6), four bytes of ITU-T H.273 code points: colour primaries, transfer function, matrix coefficients (always 0 for RGB) and a full-range flag. Display P3 is `12, 13, 0, 1` (PNG-3 §11.3.2.6 Example 4: Display P3, full range, `0C 0D 00 01`); sRGB is `1, 13, 0, 1` (H.273 (07/2021) ColourPrimaries 1 = Rec. ITU-R BT.709-6, TransferCharacteristics 13 = IEC 61966-2-1 sRGB "with MatrixCoefficients equal to 0", MatrixCoefficients 0 = identity (RGB), VideoFullRangeFlag 1; checked in CHB-047 OUT-6). When several colour chunks are present, `cICP` takes precedence over `iCCP`, which takes precedence over `sRGB`, which takes precedence over `cHRM`/`gAMA`; `iCCP` and `sRGB` should not both be present (§4.3 Table 1 and §5.6 Table 7). TIFF carries a profile as tag 34675 (`InterColorProfile`, type UNDEFINED), the whole profile byte for byte, as defined in Annex B of the ICC specification.

### 2.4 Gamut, knees, and why compression comes last

A colour whose linear RGB in the output space has a component below 0 or above 1 is **out of gamut**: the space cannot represent it. A hard clip per channel changes its hue and leaves visible edges where smooth gradients cross the boundary. A **knee** compresses smoothly instead.

spektrafilm uses one primitive throughout, the Reinhard knee on a normalised distance d (textbook §2.7):

```text
d′ = t + s·n / (1 + nᵖ)^(1/p),    n = (d − t)/s,   s = ℓ − t
```

It is the identity below the threshold t and approaches the limit ℓ asymptotically. At the output, spektrafilm's `compress_rgb` (default `cam16ucs`) works in **CAM16-UCS**, a colour appearance space whose lightness J, chroma and hue h are close to how people judge colour (Li et al., "Comprehensive color solutions: CAM16, CAT16, and CAM16-UCS", *Color Res. Appl.* 42(6), 2017). For each pixel it divides the chroma by the largest in-gamut chroma at that lightness and hue (a table built by bisection), applies the knee with (t, ℓ, p) = (0, 1, 6) and converts back, after a one-sided knee (0.7, 1, 2.2) on lightness has pulled super-whites below white. With t = 0 the chroma knee is never exactly the identity but nearly is in the middle: d = 0.5, 0.8, 1 and 2 become 0.4987, 0.770, 0.891 and 0.997. Hue and lightness are untouched.

Chromogen does something cheaper (`FS_OUT`, 2073–2074): a per-channel tanh shoulder above s = 0.82 in linear RGB, v ↦ s + (1 − s)·tanh((v − s)/(1 − s)). Because each channel is compressed separately, a saturated highlight whose channels sit at different heights shifts in hue and desaturates.

**The knee must be the last colour operation.** A knee guarantees a gamut only if nothing amplifying or non-linear follows it. A gain of 1.25 after the knee sends d = 0.9 to 1.048, outside the cube the knee had just guaranteed; applied before it, to 0.935 (textbook §2.7–2.8). spektrafilm breaks this rule itself: `scanning.scan` applies an unsharp mask after compression, and a step from 0.05 to 0.9 overshoots to 1.028 and −0.078. In chromobench only the transfer function and quantisation may follow the knee.

### 2.5 Paper white, flare and the two views

A print is a reflection: its brightest possible tone is the paper's white, and it never emits more light than falls on it. Through the paper's single-pass reflectance model, Portra Endura's white reflects Y = 0.813 of a 5,000 K light, and its densest black has a reflection density of 2.37, close to Hunt's "2.4 or more" for glossy papers (textbook §2.7).

The viewer, unlike a densitometer, also sees light reflected by the print's surface and by the room. Two models from §2.7:

- **Viewing flare** (Giorgianni and Madden, App. E): add a fraction of the white's reflectance to every point, at the flare light's chromaticity. The Studio's default of 0.48 % of paper white lifts the black from density 2.37 to 2.09.
- **Surface reflection** from Saunderson's correction: under diffuse light a matte surface returns about k₁ = 4 % of the incident light whatever the dyes below, so the viewed reflectance is R′ + k₁ and the black rises to 1.35.

Flare compresses the shadows and leaves the highlights; papers carry more contrast than a neutral reproduction needs because the room takes some back.

How should a print appear on a screen whose white is brighter than any paper? This ticket offers two **renderings**, chosen per frame:

| | **Print as seen** | **Scan of the print** |
|---|---|---|
| What it simulates | the print held up in the room, next to a perfect white | the print scanned by a scanner calibrated on the paper |
| ICC analogue | absolute colorimetric | media-relative colorimetric |
| White mapping | a perfect white diffuser under the viewing light → display white | the paper white → display white |
| Paper white on screen | Y ≈ 0.81 with its own tint: L* ≈ 92, about 233 of 255 in sRGB if it were neutral | exactly (1, 1, 1): 255 or 65,535 |
| Flare and surface reflection | included (`view.flare`, up to k₁) | excluded: a scanner's 45/0 geometry does not see them |
| Black (paper Dmax 2.37) | density 2.09 at the Studio's default flare: 22 of 255 in sRGB | no flare; 2.28 above paper white (0.09): 16 of 255, or display black with black point mapping |

In code, both are one Bradford adaptation with different source whites (§2.2): print as seen adapts from the illuminant's white (Y = 1), scan of the print adapts from the paper white's measured XYZ (Y = 0.813), which brightens and neutralises in one step.

The Studio does neither cleanly. It divides by the paper's Y (`gain = 2^(Whites/100) / Y_paper`, `params.js` 2137), which normalises luminance but not the paper's tint, and then its tanh shoulder, which starts at 0.82, compresses paper white to 0.82 + 0.18·tanh(1) = 0.957 linear, which encodes to 250 of 255 (analysis report §6.3, bug 3). Paper white is therefore never display white, although the slider's documentation says so.

### 2.6 Soft proofing in a browser

**Soft proofing** shows on screen how an image will look when printed on a particular printer and paper. A CMM builds a **proofing transform**: source → printer (with the chosen intent, which applies the printer's gamut mapping) → back to PCS through the printer profile → display. In lcms2 this is `cmsCreateProofingTransform` with the `cmsFLAGS_SOFTPROOFING` flag. The proofing intent decides whether the paper's own white is shown: absolute colorimetric "simulates paper colour", relative colorimetric does not. A **gamut warning** marks colours the printer cannot reach.

Two things differ from desktop soft proofing:

- **The display profile is the canvas's colour space.** A web page cannot read the monitor's ICC profile. It writes values in the canvas's colour space (`srgb` or `display-p3`) and the browser and operating system convert to the physical monitor. So the proof's last profile is the Display P3 (or sRGB) profile, not the monitor's.
- **The proof must be fast.** lcms runs on the CPU in WebAssembly. For an interactive view, the proofing transform is sampled once into a 33³ table and applied by the GPU per pixel, exactly the tabulation technique of textbook §4.2, keyed on encoded values so the function is nearly linear in the key. The exact lcms transform is used for files.

Here the photographer proofs an inkjet print *of the simulated print*: the simulated Portra Endura print is the original, and the inkjet print is its reproduction. "Simulate paper colour" then shows Endura's white and black as the inkjet paper can render them.

### 2.7 Sixteen bits

A 16-bit file stores 65,536 levels per channel. It matters for prints because smooth tones (skies, skin) and later edits band visibly at 8 bits. It also matters for the arithmetic upstream: the value written must have been computed with at least 16 bits of precision. A half float (`rgba16float`) has an 11-bit significand, so near 1.0 its values are 2⁻¹¹ apart, 32 times coarser than a 16-bit step; it cannot carry a 16-bit export. CHB-005 renders exports in f32 and writes 16-bit integers with WGSL's `pack2x16unorm`.

The Studio's "screen size" 16-bit export is really 8-bit: it renders into an 8-bit target and multiplies each byte by 257 (`exportFrame`, `05-inline.js` 4484, `Uint16Array.from(b, (v) => v * 257)`). Every value in such a file is a multiple of 257. Its full-size export is truly 16-bit (it reads an f32 target and scales by 65,535, 3203–3205 and 3212–3214), but it uploads the scan's tiles as half floats (3194).

## 3. How it fits the system

```text
 print-xyz (CHB-003 view.reflect → view.flare → view.adapt)
        │
        ▼
 output.display  ── f64 reference: @chromobench/core print/colour.ts, print/gamut.ts (CHB-003 owns; CHB-011 contributes)
        │           GPU: packages/gpu/src/kernels/output.wgsl (CHB-005 owns; CHB-011 contributes the maths)
        │           space · rendering · knee · transfer
        ├──────────────► display-rgb on the WebGPU canvas (srgb | display-p3)      viewer: CHB-009
        │                     └─ soft proof: 33³ proof table from lcms2 (CHB-011)
        ▼
 output.encode   ── @chromobench/output (CHB-011)
        │           tiled export runner ◄── TilePlan + evaluate(region, precision:'export') from CHB-005
        │           encoders: PNG16 / TIFF16 (+ ICC, cICP), zip; lcms2 for printer profiles
        ▼
 file in OPFS or on the user's disk (host action)
```

**Domains.** `output.display` maps `print-xyz` to `display-rgb`. `output.encode` maps a `display-rgb` image to a file, returned as a `Value`.

**Contracts consumed:** the `Engine` interface (`evaluate` with `region` and `precision: 'export'`, `measure`), CHB-005's tile plan, the recipe and its mutations, `Diagnostic`. **Contracts contributed:** `OutputSettings` (the `view.output` recipe field), the `OpDef`s of `output.display` and `output.encode`, an `EncodedFile` value. Section 10 lists them as proposals for CHB-002.

**Dependencies.**

| Ticket | What CHB-011 needs | How to proceed before it lands |
|---|---|---|
| CHB-002 | contract types, catalog stubs, mock engine | encoders and ICC need no engine; build them first |
| CHB-003 | f64 `print-xyz`, Bradford, paper white XYZ, golden numbers | use the grey card values of §2.1 and Chromogen's `colour.js` (866–932) |
| CHB-005 | `output.wgsl`, the tile planner, `evaluate(region)` with 16-bit output | a mock that returns analytic test images (gradients, colour ramps) tile by tile |
| CHB-009 | export dialog, view toggle, canvas element | a bare test page |
| CHB-013 | the photographer's real printer profiles | a synthetic narrow-gamut "printer" profile (§8) |

**Dependents.** CHB-013 (beta: real files and prints), CHB-009 (screen display), CHB-008 (the agent asks for exports), CHB-015 (Saunderson's model feeds `print-xyz`; finishing operators must respect the knee-last rule).

## 4. What exists today and what to take from it

Paths are in `ttmp/2026/11/11/CHB-001--…/various/extracted/chromogen-studio/05-inline.js` unless stated.

| Lines | What | Verdict |
|---|---|---|
| 3231–3244 | `CRC` table and `crc32`, `crcEnd` | port as is: one lookup per byte; 15 ms for 6.6 MB against 248 ms bit by bit (textbook §4.1) |
| 3245–3248 | `deflate` through `CompressionStream('deflate')` | port; the `deflate` format is zlib (RFC 1950), which is what PNG's IDAT and TIFF's Adobe Deflate expect |
| 3249–3256 | PNG `chunk` (length, type, data, CRC over type + data) | port as is |
| 3257–3274 | `png16`: 16-bit RGB, filter 0 on every row, always an `sRGB` chunk, one IDAT | port and extend: colour chunks by space, streaming IDAT, `pHYs`, metadata |
| 3275–3283 | `canvasBlob`: 8-bit PNG/JPEG via a 2D canvas, optionally `display-p3` | keep for quick 8-bit sharing |
| 3284–3309 | `tiff16`: little-endian baseline writer, one strip, 11 tags, no colour tag | port and fix: resolution tags, ICC tag 34675, strips, optional Deflate |
| 3310–3343 | `zip`: stored entries, no ZIP64 | keep for "TIFF plus recipe" bundles under 4 GiB |
| 3344–3387 | `download`, `downloads`, `save` through the claude.ai host | leave behind; chromobench saves through OPFS and the File System Access API |
| 3180–3227 | `exportTiles`: 1024-px tiles, 8-px halo, `g2` mapping, read-back, progress | the algorithm moves to CHB-005 (rendering) and here (orchestration) |
| 4465–4511 | `exportFrame`: format, size, recipe sidecar, TIFF inside a zip | redesign; fix 4484 |
| 5149–5160 | `ExportModal`: P3 only for 8-bit, TIFF in a zip | CHB-009 rebuilds the UI on the new settings |
| 2027–2076 | `FS_OUT`: sharpening, bloom, OKLab finishing, RGB matrix (3102), tanh shoulder (2073–2074), sRGB encoding with sign kept | CHB-005 ports the kernel; CHB-011 replaces the matrix, shoulder and encoding |
| 2121–2137 | `Yp`, `flare`, `flareXYZ`, `gain` in `frameParams` | flare moves to CHB-003's `view.flare`; gain becomes the rendering choice of §2.5 |
| 866–932 | `colour.js`: D65, Bradford, sRGB matrices, encode/decode, CIELAB, CIEDE2000 | the f64 basis for the reference (CHB-003); CIEDE2000 is useful for proof tests |

Bugs and limitations to fix (analysis report §5.3 and §6.3, checked against the code):

1. **Screen-size 16-bit export is 8-bit data** (4484). Fixed by always rendering exports through the engine at the requested scale with 16-bit output (§5.9).
2. **PNG16 is always tagged sRGB** (3272), **TIFF16 is untagged** (3284–3309), and **Display P3 is offered only for 8-bit** (5154). Every space is available at 16 bits, tagged correctly.
3. **Paper white is not display white** at Whites = 0 (§2.5). Fixed by the scan-of-print rendering.
4. **The TIFF writer omits XResolution, YResolution and ResolutionUnit** (tags 282, 283, 296), which TIFF 6.0 requires for baseline RGB images, and writes the whole image as one strip.
5. **The P3 matrix is a hard-coded constant** (3102) that differs from the one derived from the P3 primaries and D65 by up to 3×10⁻⁴ (2.4934969 against 2.4931808 for the first entry). Matrices and embedded profiles must come from one source (§5.3).
6. **TIFF delivered inside a zip.** That was a workaround for the hosting page; chromobench writes `.tif` directly.

## 5. Design

### 5.1 Module layout

```text
packages/output/
  src/
    spaces.ts            OutputSpace registry, derived from the bundled ICC profiles
    icc/
      profiles/          CC0 compact v4 profiles: sRGB, DisplayP3, Rec2020, AdobeCompat, ProPhoto
      parse.ts           header, tag table, XYZ, para, chad, mluc; profile class and colour space checks
      library.ts         user printer profiles stored in OPFS by SHA-256
      lcms/
        loader.ts        loads the lcms2 WASM module (in a worker)
        worker.ts        transforms, proofing transforms, round-trip gamut checks
        api.ts           typed wrapper: open, transform, proof, run, close
    display/
      canvas.ts          configure a WebGPU canvas for display-p3 or srgb
      rendering.ts       the two renderings: source white per mode
      knee-table.ts      max-chroma table per output space (CAM16-UCS), uploaded for the GPU
    proof/
      proof-lut.ts       sample a proofing transform into a 33³ table with a gamut-warning channel
    encode/
      crc32.ts  png16.ts  tiff16.ts  zip.ts  sinks.ts  metadata.ts
    export/
      run.ts             tiled export runner: plan → fields → tiles → encode → finalise
      progress.ts        progress events, cancellation
    ops.ts               OpDefs for output.display and output.encode (merged into CHB-002's catalog)
  test/
```

Two pieces of the output maths live outside this package, by design (decision D1): the f64 knee and space conversion in `@chromobench/core` (`print/colour.ts`, `print/gamut.ts`), and the WGSL versions in `packages/gpu/src/kernels/output.wgsl`. CHB-011 writes both and the owners (CHB-003, CHB-005) review them.

### 5.2 The `output.display` pipeline

Per pixel, in this order and no other:

```text
outputDisplay(XYZ_print, s: OutputSettings, space: OutputSpace):
  # 1. rendering: one Bradford adaptation; the source white decides the mode
  W_src = (s.rendering == 'print-as-seen') ? D65                     # the viewing light's white (Y = 1), as the
                                                                      # print table's adaptation already mapped it
                                           : XYZ_paperWhite           # Y ≈ 0.813, with its tint, also D65-adapted
  XYZ  = bradford(XYZ_print, from: W_src, to: space.white)
  # 2. to linear RGB in the output space
  rgb  = space.fromXYZ · XYZ                      # matrix derived from the bundled profile (§5.3)
  # 3. gamut: the knee is the last colour step
  rgb  = knee(rgb, s.knee, space)                 # cam16-ucs (default), tanh-shoulder, or clip
  # 4. encode and quantise; nothing else may follow the knee
  v    = space.encode(clamp(rgb, 0, 1))           # the profile's parametric curve
  return round(v · 65535)                         # 16-bit; 8-bit outputs dither from these
```

In print-as-seen, `print-xyz` already contains the viewing flare from `view.flare`. In scan-of-print, the recipe compiler builds `view.flare` with flare 0 (a scanner does not see room flare or the surface reflection), which is a compile rule proposed to CHB-002 (§10).

The print table bakes the adaptation from the viewing light to D65 into its values (`printSetup`, 1783–1785). For the four D65 spaces, step 1 is then the identity in print-as-seen; for ProPhoto it is the D65 → D50 Bradford, which composes exactly (§2.2). In scan-of-print the source white is the paper white's XYZ after the same D65 adaptation, which the reference computes from the print table at c_p = (0, 0, 0) (`printResult`'s `paperWhite`, 1799).

### 5.3 Output spaces from profiles

A file is correct only if its numbers and its embedded profile agree. The safest way to guarantee that is to derive the encoding maths *from* the profile that will be embedded, instead of writing matrices and curves twice.

```ts
// packages/output/src/spaces.ts (sketch)
export type OutputSpaceId = 'srgb' | 'display-p3' | 'rec2020' | 'adobe-rgb' | 'prophoto';
export interface OutputSpace {
  id: OutputSpaceId;
  label: string;                                  // 'Adobe RGB (1998) compatible', not 'Adobe RGB'
  icc: Uint8Array; iccSha256: string;             // the bytes that will be embedded
  white: [number, number, number];                // media white of the space (D65 or D50), from wtpt and chad
  toXYZ: Mat3; fromXYZ: Mat3;                     // linear RGB ↔ XYZ relative to `white`, from rXYZ/gXYZ/bXYZ and chad
  curve: ParametricCurve;                         // ICC parametricCurveType: type 0 (gamma), 3 or 4 (sRGB-like)
  encode(v: number): number; decode(v: number): number;
  cicp?: [number, number, number, number];        // only where H.273 has code points: sRGB, Display P3
  canvas?: 'srgb' | 'display-p3';                 // usable as a WebGPU canvas colour space
}
export type ParametricCurve = { type: 0 | 3 | 4; g: number; a?: number; b?: number; c?: number; d?: number; e?: number; f?: number };
export function loadSpaces(): Promise<Record<OutputSpaceId, OutputSpace>>;
```

The bundled profiles come from the **Compact ICC Profiles** project (github.com/saucecontrol/Compact-ICC-Profiles), released under CC0 1.0: sRGB, Display P3, Rec.2020, ProPhoto and "AdobeCompat" (Adobe RGB (1998) with gamma 2 + 51/256), each in a v4 form of about 480 bytes and v2 forms for older readers. Use v4 by default and keep the v2 variants for a compatibility option.

`parse.ts` reads the colorants (stored adapted to D50 as `s15Fixed16Number`, a resolution of 1.5×10⁻⁵), un-adapts them with the inverse of the `chad` matrix to the space's own white, and builds `toXYZ`. The encoder implements the ICC parametric curve the profile declares, and its inverse. The WGSL output kernel receives `fromXYZ` and the curve parameters as uniforms. A unit test compares the derived matrices with the analytic ones from the primaries of §2.1 within 10⁻⁴; a round trip through lcms with the same profile (§8) proves the agreement end to end.

### 5.4 The knee

Three methods, selected by `KneeSpec`:

- **`cam16-ucs`** (default): spektrafilm's method. Convert linear RGB → XYZ → CAM16-UCS (J′, a′, b′) → lightness, chroma, hue; normalise chroma by C_max(J, h) of the output space; apply the Reinhard knee with (t, ℓ, p) = (0, 1, 6); handle super-whites (below); convert back.
- **`tanh-shoulder`**: Chromogen's per-channel shoulder at s = 0.82, kept so that renders can be compared with the Studio.
- **`clip`**: per-channel clip, for diagnostics.

**The max-chroma table** is a function of the output space only, so it binds per space: a 2-D table over J ∈ [0, 100] (101 rows) and h ∈ [0°, 360°) (360 columns), where each entry is the largest chroma at that lightness and hue whose RGB lies inside [0, 1]³, found by bisection in f64 on the CPU. The GPU reads it with manual bilinear interpolation (four `textureLoad`s, wrapping in hue), which needs no `float32-filterable`. The CAM16 viewing conditions (adapting luminance, background, surround) define the coordinate system; take spektrafilm's values from upstream `utils/gamut_compression.py` so the two implementations agree, and store them with the table's key.

**Super-whites** are values brighter than the rendering's white: bloom can add light, and in print-as-seen nothing else can exceed the paper. The rule differs by rendering:

- print-as-seen: paper white sits at J of about 92; a one-sided lightness knee from the paper white's J to 100 compresses anything brighter into the remaining headroom;
- scan-of-print: paper white is exactly display white, so there is no headroom. Values above it are clipped in J at 100 with their chroma limited to C_max(100, h), which is close to zero: they become white. A spektrafilm-style lightness knee starting at 0.7 would pull paper white itself down to 0.919, recreating the Studio's bug.

The reference (CHB-003's `gamut.ts`) and the WGSL kernel implement the same function; the parity harness compares them (§8).

### 5.5 The display path

The viewer (CHB-009) draws `display-rgb` into a canvas that CHB-011 configures:

```ts
// packages/output/src/display/canvas.ts (sketch)
export function configureCanvas(canvas: HTMLCanvasElement, device: GPUDevice): { space: 'srgb' | 'display-p3'; format: GPUTextureFormat } {
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext;
  const wide = matchMedia('(color-gamut: p3)').matches;
  const space = wide ? 'display-p3' : 'srgb';
  ctx.configure({ device, format: 'rgba16float', colorSpace: space, alphaMode: 'opaque', toneMapping: { mode: 'standard' } });
  return { space, format: 'rgba16float' };
}
```

`GPUCanvasConfiguration.colorSpace` accepts `'srgb'` (the default) and `'display-p3'`; `toneMapping.mode: 'standard'` clamps to [0, 1], while `'extended'` would allow HDR output (MDN, `GPUCanvasContext.configure`; Chrome "New in WebGPU 129"). The values written are encoded with the sRGB transfer function in the canvas's primaries; both spaces use the same curve. `rgba16float` avoids 8-bit banding in smooth print tones at a small cost at screen size; if profiling shows the cost matters, fall back to `navigator.gpu.getPreferredCanvasFormat()` with a small ordered dither in the output kernel.

Listen for changes of `(color-gamut: p3)` (a window dragged to another monitor) and reconfigure. The viewer's output is computed for the canvas's space; an export uses its own space. A P3 display cannot show all of a ProPhoto file, so the screen shows the knee into P3, not the file.

### 5.6 Encoders

**PNG16.**

```ts
// packages/output/src/encode/png16.ts (sketch)
export interface PngOptions {
  width: number; height: number;
  space: OutputSpace; signal: 'icc' | 'icc+cicp' | 'none';
  dpi?: number;                                   // pHYs in pixels per metre: 300 dpi → 11,811
  text?: Record<string, string>;                  // iTXt: software, recipe hash, recipe JSON
}
export class Png16Writer {
  constructor(sink: ByteSink, o: PngOptions);
  writeRows(rgb16: Uint16Array, rows: number): Promise<void>;  // RGB, native-endian in, big-endian out
  finish(): Promise<void>;                                      // flush the compressor, IEND
}
```

The file is the 8-byte signature, then `IHDR` (bit depth 16, colour type 2), the colour chunks, `pHYs`, `iTXt` metadata, a sequence of `IDAT` chunks, and `IEND`. Colour chunks by space:

| Space | Chunks | Why |
|---|---|---|
| sRGB | `sRGB` (intent byte) | the standard way; no profile needed |
| Display P3 | `iCCP` + `cICP` (12, 13, 0, 1) | `cICP` is compact and wins where supported; `iCCP` serves older readers |
| Rec.2020, Adobe RGB, ProPhoto | `iCCP` | H.273 has no code points for Adobe RGB or ProPhoto; Rec.2020's transfer is an open decision |

Rows are written with filter type 0 like the Studio. Adaptive filtering (choosing Sub, Up or Paeth per row) usually compresses photographs better and is a later optimisation. Rows stream through `CompressionStream('deflate')`, and an `IDAT` chunk is emitted whenever about 1 MiB of compressed output has accumulated, so a 600 MB image never exists as one buffer. PNG stores 16-bit samples big-endian (PNG-3 §7.2); the engine's `pack2x16unorm` output is little-endian on all platforms the browser runs on, so the writer swaps bytes while it adds each row's filter byte.

**TIFF16.**

The writer keeps the Studio's little-endian (`II`) layout and adds what it lacks. Tags, in the ascending order TIFF requires:

| Tag | Name | Value |
|---|---|---|
| 256, 257 | ImageWidth, ImageLength | LONG |
| 258 | BitsPerSample | SHORT × 3: 16, 16, 16 |
| 259 | Compression | 1 (none) or 8 (Adobe Deflate) |
| 262 | PhotometricInterpretation | 2 (RGB) |
| 273 | StripOffsets | LONG × strips |
| 277 | SamplesPerPixel | 3 |
| 278 | RowsPerStrip | e.g. 64 rows |
| 279 | StripByteCounts | LONG × strips |
| 282, 283 | XResolution, YResolution | RATIONAL, e.g. 300/1 |
| 284 | PlanarConfiguration | 1 (chunky) |
| 296 | ResolutionUnit | 2 (inch) |
| 305, 306 | Software, DateTime | ASCII |
| 317 | Predictor | 2 (horizontal) when compressed |
| 339 | SampleFormat | 1 (unsigned integer) |
| 34675 | ICC profile | UNDEFINED × profile length |

Uncompressed strips have known sizes, so the IFD can be written first. Compressed strips do not; the writer then writes a placeholder header, the strips as they are compressed, the IFD with the offset and byte-count arrays at the end, and finally patches the IFD offset at bytes 4–7. That needs a sink with random-access writes (§5.9). A 100 MP 16-bit RGB image is 605 MB uncompressed, below classic TIFF's 4 GiB limit, so BigTIFF is not needed. The Studio fills pixels through a `Uint16Array` view, which is little-endian only because every current platform is; the port writes through `DataView` or asserts endianness.

**Zip.** Port `zip` unchanged for bundles of a TIFF and its recipe. It stores entries uncompressed and has no ZIP64, so a bundle must stay under 4 GiB.

**CRC.** Port the table-driven CRC-32 (polynomial `0xEDB88320`). Test vectors: CRC-32 of the ASCII string `123456789` is `0xCBF43926`; every PNG's `IEND` chunk ends in `AE 42 60 82`.

**8-bit outputs.** PNG8 and JPEG go through `OffscreenCanvas` with `colorSpace: 'display-p3'` or `'srgb'` and `convertToBlob`, as `canvasBlob` does. Whether the browser embeds a profile in those files must be checked by parsing them (§8). The 8 bits are derived from the 16-bit values with a small triangular dither.

### 5.7 ICC transforms with lcms2

**Builds available.**

| Build | Licence | What it exposes | Notes |
|---|---|---|---|
| `lcms-wasm` 1.0.5 (npm) | MIT (Little CMS is MIT) | 17 lcms functions (`lib/export.txt`): `cmsOpenProfileFromMem`, `cmsCreate_sRGBProfile`, `cmsCreateXYZProfile`, `cmsCreateLab4Profile`, `cmsCreateTransform`, `cmsCreateProofingTransform`, `cmsDoTransform`, `cmsDeleteTransform`, `cmsGetProfileInfoASCII`, `cmsGetColorSpace`, `cmsReadTag`, … | a WASM rebuild of yoya/lcms.js; `instantiate()`; `cmsDoTransform(t, input, n)` copies input and output through the WASM heap and supports 8- and 16-bit integer and 32-bit float formats; works in workers |
| `@kittl/little-cms` 1.0.3 (npm) | not stated on its package page | `initWasm`, sRGB profile, profiles from memory, transform, info | smaller documented surface; no proofing documented |
| own Emscripten build of Little-CMS | MIT | exactly what we export | pins the version; upstream released 2.18 in January 2026 and lists 2.19 |

`lcms-wasm` does not export `cmsSaveProfileToMem`, `cmsCreateRGBProfile` or `cmsSetAlarmCodes`. None is required by this design: profiles come from files (§5.3), and the gamut warning uses a round trip instead of alarm codes (below).

**API sketch.** All lcms work runs in a dedicated module worker so the page stays responsive:

```ts
// packages/output/src/icc/lcms/api.ts (sketch)
export type Intent = 'perceptual' | 'relative' | 'saturation' | 'absolute';   // lcms INTENT_* 0, 1, 2, 3
export type PixelFormat = 'RGB_16' | 'RGB_FLT';                              // lcms TYPE_RGB_16, TYPE_RGB_FLT
export interface Lcms {
  open(bytes: Uint8Array): Promise<ProfileHandle>;
  transform(src: ProfileHandle, dst: ProfileHandle, o: { intent: Intent; bpc: boolean; in: PixelFormat; out: PixelFormat }): Promise<TransformHandle>;
  proof(src: ProfileHandle, display: ProfileHandle, printer: ProfileHandle,
        o: { intent: Intent; proofIntent: 'absolute' | 'relative'; bpc: boolean }): Promise<TransformHandle>;
  run(t: TransformHandle, pixels: Uint16Array | Float32Array, n: number): Promise<Uint16Array | Float32Array>;
  close(h: ProfileHandle | TransformHandle): Promise<void>;
}
```

`proof` maps to `cmsCreateProofingTransform` with `cmsFLAGS_SOFTPROOFING`, adding `cmsFLAGS_BLACKPOINTCOMPENSATION` when `bpc` is set.

**Printer profiles** are user files. `library.ts` stores each in OPFS under its SHA-256 and records its description, class (must be `prtr`, an output profile) and colour space. Version 1 supports RGB printer profiles, which is what inkjet drivers use; CMYK output for RIPs is an open question. A profile is untrusted input parsed by C code; running lcms inside a worker's WebAssembly sandbox limits what a malformed file can do, and pinning a current lcms version matters (CVE-2026-41254, an integer overflow in the CLUT size computation of `cmslut.c`, is reported against versions up to 2.18).

### 5.8 Soft proofing and printer output

**Printer output.** The file sent to the printer is made in two steps:

1. Render the frame in a wide working space with 16 bits (ProPhoto by default, so nothing the print can show is clipped before the printer's own gamut mapping), using the rendering the photographer chose (normally scan-of-print).
2. Convert strip by strip in the lcms worker: working-space profile → printer profile, with the chosen intent (perceptual or relative colorimetric with BPC are the usual choices) and `RGB_16` in and out. Embed the printer profile in the TIFF.

The knee in step 1 targets ProPhoto, which a print's colours almost never exceed; the printer profile's intent then does the real gamut mapping. Nothing follows that conversion except quantisation, so the knee-last rule holds.

**Proof table.** For the screen, the proofing transform (working space → printer → display space) is sampled at 33³ encoded working-space values in `RGB_FLT`. A second transform per node does the round trip working space → printer → working space with relative colorimetric intent; its CIEDE2000 distance from the node's own colour goes into the table's fourth channel as the gamut-warning measure.

```text
proofTable(working, printer, display, opts):                    # binds per (working, printer, display, intents)
  for q in 0 .. 33³−1:
      v   = node q of [0, 1]³                                   # encoded working-space RGB, x fastest
      p   = lcms.run(proofXf, v)                                # display-space encoded RGB
      rt  = lcms.run(roundTripXf, v)
      dE  = CIEDE2000(Lab(v), Lab(rt))
      T[q] = (p.r, p.g, p.b, dE)
  key = sha256(working.iccSha256, printer.sha256, display.iccSha256, intent, proofIntent, bpc, N)
```

In proof mode the output kernel computes each pixel's working-space value exactly as for the export (knee into ProPhoto, then the ROMM curve), looks it up in the proof table with trilinear interpolation, and writes the display value; if the warning is on and dE > 2, it writes an overlay colour instead. The proof table replaces the display knee as the last colour step. The table is cached by its key like CHB-005's tables. Exports never use it; they call lcms directly.

### 5.9 Tiled full-resolution export

```ts
// packages/output/src/export/run.ts (sketch)
export interface ExportRequest {
  frame: string; node: NodeRef;                   // an immutable output.display node captured at the start
  settings: ExportSettings;                       // from view.output.export
  printer?: PrinterSettings;
  sink: ByteSink;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}
export interface ExportProgress {
  phase: 'plan' | 'fields' | 'tiles' | 'convert' | 'finalise';
  tilesDone: number; tilesTotal: number; bytesWritten: number; elapsedMs: number;
}
export interface EncodedFile {                    // the Value returned by output.encode
  name: string; mime: 'image/png' | 'image/tiff'; bytes: number;
  width: number; height: number; bits: 8 | 16; space: OutputSpaceId;
  iccSha256?: string; recipeSha256: string; location: { opfs: string } | { picked: true };
}
export async function exportFrame(engine: Engine, req: ExportRequest): Promise<EncodedFile>;
```

The runner's steps:

1. **Plan.** Ask CHB-005 for the tile plan of `node` at full scale. Tiles come in row-major order.
2. **Fields.** The engine computes the global fields and statistics once and pins them for this node.
3. **Tiles.** For each tile, `evaluate(node, {scale: 'full', region: tile.core, precision: 'export'})` returns 16-bit RGB. The runner keeps one band of tiles (all tiles of a row, 11,600 × 1,024 × 6 bytes = 71 MB for the 100 MP frame); when a band is complete, its rows go to the encoder (and, for printer output, through the lcms worker first).
4. **Finalise.** Flush the compressor, write `IEND` or the TIFF IFD, close the sink, record size and settings, unpin the engine's fields.

**Sinks.**

```ts
// packages/output/src/encode/sinks.ts (sketch)
export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>;
  writeAt?(offset: number, chunk: Uint8Array): Promise<void>;   // random access: TIFF IFD patching
  close(): Promise<void>;
  abort(): Promise<void>;                                       // delete what was written
}
export function opfsSink(path: string): Promise<ByteSink>;       // OPFS file via a worker's sync access handle
export function pickerSink(suggestedName: string): Promise<ByteSink>;   // showSaveFilePicker, where supported
```

`showSaveFilePicker` (File System Access API, Chromium) writes straight to the photographer's chosen file. Where it is missing, the runner writes to OPFS and the host offers a download of the finished file (`URL.createObjectURL(await handle.getFile())`), which reads from disk rather than holding 600 MB in memory.

**Consistency.** The runner evaluates one immutable `NodeRef` captured when the export starts. If the photographer keeps editing, the edits create new nodes; the export's node, and the fields pinned for it, do not change. The Studio needed a `busy` flag to stop its renderer redrawing the global pass mid-export (3172–3179); hash-consed nodes make that structural.

**Progress and cancellation.** Progress is reported per tile and per phase. Cancellation, failure and completion are distinct outcomes:

- **Cancelled**: the signal fired. The runner stops submitting tiles, waits for the tile in flight (a submitted GPU dispatch cannot be recalled), calls `sink.abort()` so no partial file remains, unpins the fields, and rejects with a `Diagnostic` of code `E_CANCELLED`.
- **Failed**: a tile, the encoder or the sink threw. Same clean-up; the `Diagnostic` names the phase and tile.
- **Completed**: the file is closed and verified (header re-read, size checked). Delivery to the user's disk is a separate host action and may still be declined.

### 5.10 Recipe settings and catalog ops

```ts
// packages/contract/src/recipe.ts, view.output (proposed by CHB-011)
export interface OutputSettings {
  rendering: 'print-as-seen' | 'scan-of-print';
  display: { knee: KneeSpec; proof?: { printer: string /* profile sha256 */; intent: Intent;
             proofIntent: 'absolute' | 'relative'; bpc: boolean; gamutWarning: boolean } };
  export: ExportSettings;
  printer?: PrinterSettings;
}
export interface ExportSettings {
  format: 'tiff16' | 'png16' | 'png8' | 'jpeg';
  space: OutputSpaceId; knee: KneeSpec;
  scale: 'full' | number;                         // 1 = full; 0.25 = quarter size; never via an 8-bit target
  dpi?: number; compression: 'none' | 'deflate';
  signal: 'icc' | 'icc+cicp' | 'none';
  recipe: 'sidecar' | 'embedded' | 'none';
}
export interface PrinterSettings { profile: string; intent: Intent; bpc: boolean; working: OutputSpaceId }
export type KneeSpec = { method: 'cam16-ucs'; p: number } | { method: 'tanh-shoulder'; s: number } | { method: 'clip' };
```

A small example, the defaults:

```json
{ "rendering": "scan-of-print",
  "display": { "knee": { "method": "cam16-ucs", "p": 6 } },
  "export": { "format": "tiff16", "space": "prophoto", "knee": { "method": "cam16-ucs", "p": 6 },
              "scale": "full", "dpi": 300, "compression": "deflate", "signal": "icc", "recipe": "sidecar" } }
```

The ops, in the registry's shape:

```ts
// packages/output/src/ops.ts (sketch, merged into CHB-002's catalog)
export const outputDisplay: OpDef = {
  name: 'output.display', area: 'output', on: 'Image', returns: 'Image',
  domainIn: 'print-xyz', domainOut: 'display-rgb', class: 'pointwise', binding: 'setting',
  recipePath: 'view.output',
  args: {
    space:     { type: 'enum', values: ['srgb', 'display-p3', 'rec2020', 'adobe-rgb', 'prophoto'], default: 'srgb',
                 doc: 'Output colour space; the file carries its profile.' },
    rendering: { type: 'enum', values: ['print-as-seen', 'scan-of-print'], default: 'scan-of-print',
                 redirects: ['view', 'mode'], doc: 'Paper white at its own level (as seen) or at display white (scan).' },
    knee:      { type: 'enum', values: ['cam16-ucs', 'tanh-shoulder', 'clip'], default: 'cam16-ucs',
                 doc: 'Gamut compression; always the last colour step.' },
  },
  doc: 'Turns the print\'s XYZ into encoded RGB in an output space.', see: ['output.encode', 'view.adapt'],
};
export const outputEncode: OpDef = {
  name: 'output.encode', area: 'output', on: 'Image', returns: 'Value',
  domainIn: 'display-rgb', class: 'global', binding: 'setting', recipePath: 'view.output.export',
  args: {
    format:      { type: 'enum', values: ['tiff16', 'png16', 'png8', 'jpeg'], default: 'tiff16', doc: 'File format.' },
    compression: { type: 'enum', values: ['none', 'deflate'], default: 'deflate', doc: 'Lossless compression.' },
    dpi:         { type: 'number', unit: 'none', min: 1, max: 4800, usual: [240, 360], default: 300, doc: 'Print resolution metadata.' },
  },
  doc: 'Encodes a display-rgb image as a file in OPFS and returns its EncodedFile description.',
};
```

`output.encode` returns a `Value` (an `EncodedFile`), not pixels. Copying the file to the user's disk is a host action, so an agent in ask mode can prepare an export but the photographer decides where it goes.

### 5.11 Decision records

**D1. Where the output maths lives.** *Context:* the planned layout puts `print/colour.ts` and `print/gamut.ts` in `@chromobench/core`, and the WGSL kernels in `@chromobench/gpu`. *Alternatives:* (a) keep everything for output in `@chromobench/output`, with core depending on it for the reference engine; (b) put f64 maths in core and WGSL in gpu, with `@chromobench/output` holding I/O, ICC, lcms, canvas, proofing and the export runner. *Decision:* (b). *Rationale:* core is the oracle and must not depend on a browser-facing package; the GPU kernels belong with the other kernels and their parity harness. *Consequences:* CHB-011 contributes code to two packages it does not own and must coordinate reviews with CHB-003 and CHB-005. *Status:* proposed.

**D2. Default knee.** *Alternatives:* Chromogen's tanh shoulder (cheap, per channel, shifts hue, compresses paper white to 0.957) or spektrafilm's CAM16-UCS chroma knee (hue- and lightness-preserving, needs a per-space table). *Decision:* CAM16-UCS by default, tanh kept for comparison. *Consequences:* a 2-D table per output space and a CAM16 implementation in f64 and WGSL. *Status:* proposed.

**D3. Profiles from files, maths from profiles.** *Alternatives:* (a) generate profiles in TypeScript from constants; (b) create them with lcms and save them; (c) bundle published profiles and derive the maths from them. *Decision:* (c), with the CC0 Compact ICC Profiles. *Rationale:* one source of truth; no ICC writer to maintain; small, widely tested files. *Consequences:* the parser must handle `para` curves and `chad`; the Adobe space is labelled "Adobe RGB (1998) compatible". *Status:* proposed.

**D4. lcms2 build.** *Decision:* start with `lcms-wasm` 1.0.5 behind the `Lcms` interface; switch to an own Emscripten build of a pinned Little-CMS release if a needed function is missing or the bundled version lags on security fixes. *Status:* proposed.

**D5. Default rendering.** *Decision:* scan-of-print, which matches the Studio's normalisation (without its bug) and is what photographers expect from a scan; print-as-seen one click away. *Status:* proposed; CHB-013's beta may change it.

**D6. Streaming to disk.** *Decision:* encoders write through `ByteSink`s in bands; no export holds the whole encoded file in memory. *Consequences:* TIFF with compression needs random-access writes; PNG and uncompressed TIFF do not. *Status:* proposed.

## 6. One flow traced end to end

**Export of the grey card frame as a 16-bit TIFF in ProPhoto, and the same frame on screen.**

1. **Input.** A grey-card pixel arrives from CHB-003's chain in `print-xyz`, already adapted to D65: (0.1664, 0.1754, 0.2131). The paper white's XYZ from the print table at c_p = 0 has Y = 0.813.
2. **Screen, scan-of-print, Display P3 canvas.** Bradford from the paper white to D65 brightens by about 1/0.813 and removes the paper's tint; paper white becomes P3 (1, 1, 1) and is written as 1.0 in every channel. If the paper were neutral, the grey card would land near linear sRGB (0.201, 0.217, 0.245), encoded (0.486, 0.503, 0.532), about (124, 128, 136) in 8 bits; the real tint shifts this slightly.
3. **Screen, print-as-seen.** Source white is the illuminant's, so for a D65 canvas step 1 is the identity: the grey card shows as P3 encoded (0.4439, 0.4568, 0.4806), and a neutral paper white would be 0.913 encoded (233 of 255), with Endura's own tint. The black, with the default flare, is at density 2.09 (22 of 255 in sRGB).
4. **Export.** The photographer chooses ProPhoto, 16-bit TIFF, Deflate, 300 dpi, scan-of-print. `exportFrame` captures the `output.display` node with `space: 'prophoto'`. CHB-005's plan for the 1090 × 754 frame is a single 1090 × 754 tile; for a 100 MP scan it would be 108 tiles of 1024 px.
5. **Per pixel.** Bradford from paper white to D50 (ProPhoto's white); linear ProPhoto; the CAM16-UCS knee changes nothing visible for the grey card (its chroma is far inside ProPhoto); the ROMM curve encodes; the engine writes 16-bit values with `pack2x16unorm`. Paper white becomes (65,535, 65,535, 65,535).
6. **Encoding.** Rows go to `Tiff16Writer` in strips of 64 rows, each compressed with horizontal predictor and Deflate. After the last strip the writer appends the IFD (eighteen tags, ending with 34675, which holds the 480-byte ProPhoto v4 profile) and patches the IFD offset at byte 4.
7. **Result.** `EncodedFile { name: 'frame_0042.tif', mime: 'image/tiff', width: 1090, height: 754, bits: 16, space: 'prophoto', iccSha256: …, recipeSha256: … }`. CHB-009 offers to save it; the photographer may decline without losing the file in OPFS.

**Cancellation of a large export.** For the 100 MP frame the photographer presses Cancel during tile 37 of 108. The runner lets tile 37 finish, does not submit 38, calls `sink.abort()` (the partial OPFS file is deleted), unpins the engine's fields and rejects with `E_CANCELLED`. Progress last reported 37/108; no `EncodedFile` exists.

## 7. Implementation plan

**Stage 1: encoders.** Files: `encode/crc32.ts`, `png16.ts`, `tiff16.ts`, `zip.ts`, `sinks.ts`, `metadata.ts`. Port 3231–3343, add streaming, strips, resolution tags, Deflate with predictor, byte-order handling. Done when: CRC vectors pass; a 16-bit gradient containing all 65,536 values round-trips bit-exactly through an independent PNG decoder and an independent TIFF reader; a 100 MP synthetic export streams with peak memory below 200 MB; the screen-size-is-8-bit regression test passes.

**Stage 2: colour management.** Files: `icc/profiles/*`, `icc/parse.ts`, `spaces.ts`, `icc/library.ts`, `icc/lcms/*`; contributions to core `print/colour.ts` and `print/gamut.ts`. Done when: the five spaces load from their profiles with matrices within 10⁻⁴ of the analytic ones; PNG chunks follow the policy table; TIFF tag 34675 holds the profile; an encoded test image round-trips through lcms with the embedded profile to its XYZ within 2×10⁻⁴; printer profiles import into OPFS and are validated.

**Stage 3: display path.** Files: `display/canvas.ts`, `display/rendering.ts`, `display/knee-table.ts`; contributions to `kernels/output.wgsl`. Done when: the canvas is configured for P3 on a wide-gamut display and sRGB otherwise and reconfigures on change; both renderings meet the paper-white tests; the CAM16-UCS knee reproduces spektrafilm's numbers and passes the GPU-vs-reference parity; nothing follows the knee.

**Stage 4: soft proofing.** Files: `proof/proof-lut.ts`, printer conversion in `export/run.ts`. Depends on the open decision whether real prints are in scope (§9). Done when: the proof table agrees with direct lcms transforms within the tolerances of §8; the gamut warning flags the synthetic printer profile's out-of-gamut patches; a printer-ready TIFF embeds the printer profile.

**Stage 5: tiled export.** Files: `export/run.ts`, `export/progress.ts`. Done when: tiled and one-pass exports agree (§8); cancellation leaves no file and releases the engine; progress is monotonic and ends at the tile count; a recipe edit during an export does not change its output.

Start here: port `crc32` and `png16` into `packages/output/src/encode/`, write the CRC test vectors, then write a 16-bit gradient and decode it in a Node test with an independent decoder.

## 8. Testing and acceptance

Tolerances are stated before any run, and each test has a broken variant it must catch.

**Encoders.**

- CRC-32 of `123456789` = `0xCBF43926`; the `IEND` chunk's CRC = `0xAE426082`.
- 16-bit round trip: a 256 × 256 image holding all 65,536 values per channel decodes bit-exactly with an independent decoder (for example `fast-png` in Node for PNG, and `utif` or libtiff's `tiffdump` for TIFF). Broken variant: little-endian samples in the PNG.
- Bug 4484 regression: a "screen size" export of a smooth gradient has more than 256 distinct values per channel, and not all values are multiples of 257.
- Structure: PNG has exactly one of `sRGB` or `iCCP`; `cICP` precedes `IDAT`; the decompressed `iCCP` bytes equal the space's profile. TIFF tags are sorted, 282/283/296 are present, the 34675 bytes equal the profile, and `tiffinfo` (libtiff) reads the file without warnings.
- 8-bit PNG/JPEG from `OffscreenCanvas` in P3: parse the output and record whether a P3 profile is embedded; if it is not, the 8-bit P3 option is disabled.

**Colour.**

- The grey card at XYZ (0.1664, 0.1754, 0.2131) encodes, in print-as-seen, to the 16-bit codes of the table in §2.1 within ±2 codes, and to `#70757b` in 8-bit sRGB (textbook §2.7). Broken variant: the Studio's constant P3 matrix shifts P3 codes by more than 2.
- Paper white in scan-of-print is exactly 65,535 in every channel in all five spaces. Broken variant: the Studio's Y-only gain plus tanh shoulder gives 0.957 linear (250 of 255).
- lcms round trip: encoded test colours, read back through lcms with the embedded profile to D50 PCS XYZ and adapted to D65, match the input within 2×10⁻⁴.
- Knee: spektrafilm's numbers (d = 0.5, 0.8, 1, 2 → 0.4987, 0.770, 0.891, 0.997); every output pixel lies in [0, 1]³ in linear RGB after the knee; CAM16 hue is unchanged within 0.1°; WGSL against f64 within 2×10⁻⁶ in linear RGB. Law (textbook §2.8): a gain of 1.25 after the knee leaves the cube (0.9 → 1.048) while before it stays inside (0.935); the graph compiler rejects any op between `output.display` and `output.encode`.
- Flare and renderings: in print-as-seen the paper black reads density 2.09 with the Studio's default flare and 1.35 with k₁ = 4 % (textbook §2.7); in scan-of-print no flare is added and the black sits 2.28 below paper white (luminance 0.0052 of display white). Broken variant: flare applied in scan-of-print.

**Soft proof.**

- Proof table against direct lcms transforms at 10,000 random in-gamut colours: CIEDE2000 rms ≤ 0.5 and max ≤ 2.0 (stated now; adjust only with a written reason). Broken variant: a 9³ table must fail.
- Gamut warning on a synthetic printer profile (a matrix/TRC profile with primaries pulled 20 % towards white, made once with lcms in a build script): patches outside it are flagged, patches inside are not.

**Tiled export.**

- Tiles against one pass on the Gold 200 frame with grain reduction, texture and sharpening on: ≤ 1 8-bit level (257 16-bit codes), the textbook's §4.7 tolerance; report the actual maximum, which should be far lower. Without the halo the test must fail (28 levels in the textbook).
- Cancellation: abort after tile 3 of a 20-tile synthetic export; the promise rejects with `E_CANCELLED` within one tile's time, no file remains in OPFS, the engine holds no pinned fields, and a following export succeeds.
- Consistency: change `print.lights` during an export; the file equals an export of the original recipe.

**Fixtures** (in `fixtures/output/`): the CC0 profiles; a 65,536-value gradient; grey-card and paper-white XYZ from CHB-003's golden set; the synthetic printer profile; the Gold 200 frame from `fixtures/scans/`.

## 9. Risks and open questions

- **Are real prints in scope?** The work plan's open decisions include "Output target: screen and files only, or real prints with ICC soft proofing?" (CHB-001 design doc §8.4). Stages 1–3 and 5 do not depend on it; stage 4 does. Until it is answered, build the `Lcms` wrapper and the proof table but not the printer UI flow.
- **Rec.2020 transfer function.** The BT.709/2020 camera curve and the BT.1886 display gamma 2.4 are both in use for Rec.2020 stills; the Compact ICC Profiles ship both. Pick one with the photographer; the profile and the encoding follow from the choice (§5.3). `cICP` for Rec.2020 waits for the same decision.
- **Finishing operators after the knee.** The catalog places `finishing.*` ops on `display-rgb` (CHB-015). That would violate the knee-last rule. Proposed: finishing ops act on `print-xyz` or a linear RGB domain before `output.display` (§10).
- **Canvas colour behaviour.** Browsers are adding linear canvas colour spaces and HDR modes. Test the P3 canvas on the beta machines (CHB-013) with a known patch and a colorimeter or the operating system's colour picker.
- **Platform gaps.** `showSaveFilePicker` is Chromium-only; Safari's and Firefox's OPFS support differs in detail. The OPFS-plus-download path must work everywhere the app runs.
- **lcms version and untrusted profiles** (§5.7). Keep the version visible in the app's diagnostics.
- **CAM16 viewing conditions** must be read from spektrafilm's source before the knee's parity with spektrafilm can be claimed.

## 10. Proposed contract additions (for CHB-002)

1. **`OutputSettings`**, `ExportSettings`, `PrinterSettings`, `KneeSpec`, `Intent`, `OutputSpaceId` as in §5.10, as the type of `FrameRecipe.view.output`.
2. **Ops** `output.display` and `output.encode` as in §5.10, with `output.encode` returning a `Value` of type `EncodedFile`.
3. **`ImageInfo` for `display-rgb`**: add `colour?: { space: OutputSpaceId | 'canvas-srgb' | 'canvas-p3'; transfer: 'encoded' | 'linear'; bits: 8 | 16 }`, so a `display-rgb` image says what its numbers mean.
4. **Compile rule:** when `view.output.rendering` is `'scan-of-print'`, `compile()` builds `view.flare` with flare 0.
5. **Graph rule:** no op may consume `display-rgb` except `output.encode` and measurements; `finishing.*` ops move before `output.display`.
6. **`EvalTarget.signal?: AbortSignal`** and an optional `Engine.plan(node, target)` (shared with CHB-005's proposals).
7. **`Diagnostic` codes:** `E_CANCELLED`, `E_SINK`, `E_ICC_INVALID`, `E_ICC_CLASS` (for example a display profile offered as a printer profile).

## 11. References

**Chromobench and Chromogen material** (relative to `ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`):

- `design-doc/01-chromobench-architecture-and-work-plan.md`: domains, recipe (`view.output`), catalog areas, open decisions §8.4.
- `sources/The Mathematics of the Colour Negative.md`: §2.7 (viewing, flare, Saunderson, display, knees), §2.8 (a knee does not commute with a gain), §4.1 (the CRC table), §4.7 (the tile test).
- `various/extracted/chromogen-studio/05-inline.js`: `colour.js` 866–932, `params.js` 2087–2193, `FS_OUT` 2027–2076, `render.js` `exportTiles` 3180–3227, `export.js` 3230–3387, `exportFrame` 4465–4511, `ExportModal` 5149–5160.
- `various/analysis-chromogen-studio.md`: §2.8–2.9 (print, viewing, output transform), §5.3 (export), §6.3 (bugs 3 and 7).
- `various/extracted/chromogen-studio/st-data/book/10-ch10.md`: the Studio's own account of its output order and encoding, and its list of what is not built (ICC soft proofing, output sharpening).

**Specifications:**

- W3C, *Portable Network Graphics (PNG) Specification (Third Edition)*, Recommendation, 24 June 2025, https://www.w3.org/TR/png-3/ : §4.3 colour chunk precedence, §5.6 chunk ordering, §7.2 byte order, §11.3.2.3 `iCCP`, §11.3.2.5 `sRGB`, §11.3.2.6 `cICP`.
- ITU-T H.273, coding-independent code points (the values used by `cICP`).
- International Color Consortium, ICC.1 (v4.4) specification, Annex B (embedding profiles in TIFF and other formats); ICC White Paper 36, "Embedding and referencing profiles".
- Adobe, TIFF Revision 6.0 (baseline fields, strips, Predictor) and Adobe's TIFF technical notes (Deflate as Compression 8); tag 34675 is the ICC-assigned `InterColorProfile` tag.
- W3C, *WebGPU*, `GPUCanvasConfiguration` (colour space, tone mapping); MDN, `GPUCanvasContext.configure`; Chrome for Developers, "New in WebGPU 129" (HDR canvas tone mapping).
- WHATWG, *Compression Streams* (`deflate` is the zlib format), *File System Standard* (OPFS); WICG, File System Access (`showSaveFilePicker`).

**Libraries and data:**

- Little CMS, https://www.littlecms.com/ and https://github.com/mm2/Little-CMS (MIT): API reference for `cmsCreateTransform`, `cmsCreateProofingTransform`, intents and flags.
- `lcms-wasm` 1.0.5, https://unpkg.com/lcms-wasm@1.0.5/ (`README.md`, `lib/api.js`, `lib/export.txt`); `@kittl/little-cms` 1.0.3.
- Compact ICC Profiles, https://github.com/saucecontrol/Compact-ICC-Profiles (CC0 1.0).
- spektrafilm, https://github.com/andreavolpato/spektrafilm : `utils/gamut_compression.py`, `model/glare.py`, `runtime/services/color_reference.py`, `runtime/stages/scanning.py`.

**Colour science:**

- Li, Li, Wang, Zu, Luo, Cui, Melgosa, Brill and Pointer, "Comprehensive color solutions: CAM16, CAT16, and CAM16-UCS", *Color Research and Application* 42(6), 2017.
- Giorgianni and Madden, *Digital Color Management*, 2nd ed., App. E (viewing flare).
- Hunt, *The Reproduction of Colour*, 6th ed., 13.9–13.10 (surface reflection, measured versus seen black).
