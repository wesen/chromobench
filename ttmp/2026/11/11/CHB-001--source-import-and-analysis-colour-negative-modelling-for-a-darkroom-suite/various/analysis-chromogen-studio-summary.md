---
Title: "analysis-chromogen-studio-summary"
Ticket: CHB-001
Status: active
Topics:
    - color-science
    - film-emulation
    - image-pipeline
    - js-api
    - product
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Subagent-authored analysis stored for CHB-001"
LastUpdated: 2026-11-11T11:32:25-05:00
WhatFor: ""
WhenToUse: ""
---

I couldn't save `various/analysis-chromogen-studio.md`: the harness refuses report files written by subagents, so the full document is at the end of this message for you to save. The analysis is done. It covers points 1–6; I left out the long list of line references and the reuse assessment, and can add them if you want.

Two files were written:
- `/home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/scripts/02-inventory-chromogen-st-data.py`. It parses `03-inline.js` as JSON without executing it.
- `/home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/`. The script unpacked it: `cg/` holds 11 stocks, the camera and the LED; `book/` holds 13 chapters bundled with the app.

Nothing was run in a browser. Tags: [code] read in code, [data] parsed by script 02, [docs] the app's own UI text or bundled book, [textbook] the textbook, [inferred] my reading.

Line numbers refer to `05-inline.js`. It is an unminified esbuild bundle that keeps its `// src/...` module comments, which makes it easy to navigate.

**Overview.** There are two layers [code]:
- **Spectral library (lines 142–932)** — `chromogen/src/*`: units, spectrum, stock, channels, linalg, solve, print, colour. It has no DOM dependency and runs on an in-memory `fs` with files under `/cg/data`.
- **Studio app (lines 934–5215)** — tables, WebGL2 shaders, WebGPU kernels, workers, React UI.

The worker (`04-st-worker.txt.js`) is a minified copy of the same engine plus a job handler on line 3. `03-inline.js` sets `window.ST_DATA = {cg, samples, book}`.

## 1. Input handling

**Formats** [code, 2195–2413]:
- **TIFF (own decoder):**
  - 8, 16 or 32-bit; 32-bit can be float.
  - Strips or tiles, chunky or planar.
  - Uncompressed, LZW, Deflate or PackBits; horizontal predictor.
  - Picks the largest SubIFD.
- **DNG:** only the demosaiced kind. A CFA mosaic is refused (2289). Black and white levels and the colour matrices are ignored.
- **16-bit PNG (own decoder):** not paletted, not interlaced.
- **8-bit PNG, JPEG, WebP:** decoded by the browser with `colorSpaceConversion:none`, so the ICC profile is ignored.
- **RAW (RAF, NEF, CR2, CR3, ARW, ORF, RW2, PEF):** refused with advice to make a linear 16-bit TIFF with dcraw or LibRaw (2410).
- **R/G/B triplet:** three exposures, one under each LED; channel k is taken from file k (2419).

**Encoding hint** [code]:
- 8-bit TIFF and all browser-decoded images default to sRGB.
- 16/32-bit TIFF defaults to linear.
- **16-bit PNG also defaults to sRGB (2387).** The bundled book says 16-bit files default to linear.
- The user can override with linear, sRGB or gamma 2.2. Only the transfer curve changes; no matrix or ICC conversion is ever applied.

**Bugs** [code]:
- A 32-bit integer TIFF divides by zero: `(1<<32)-1 === 0` (2296).
- sRGB values are averaged before they are linearised (2580).

**Colour assumption** [code + inferred]:
- Scan values are treated as linear per-channel transmittance through scanner channels P_k = LED_k(λ) × camera_k(λ). There is no white balance and no camera matrix.
- Scanner profiles (1645–1659):
  - `xt5-fitted`: Gaussian LEDs at 678/532/472 nm, FWHM 20.
  - `rgb-led-book`: 660/530/450 nm. This is the default.
  - Custom LED peaks.
  - White LED.
  - Status M.
- The camera curves and the white LED are labelled "Illustrative … Not measured" in their JSON [data].
- [inferred] A lab-scanner JPEG with its own colour processing would be misread.

**Base / rebate** [code, 2628–2645]:
- With a rebate box drawn: the box mean.
- Otherwise (the default): the **99.7th percentile of the frame ×1.02**. That is the frame's brightest pixels, not the rebate.
- Density is always D_k = −log10(T_k/Treb_k).

**Flat field** (2453–2507): a capture of the light with no film, reduced to a 96- or 512-cell grid, divided by its mean and floored at 0.05. It is kept for the session only.

**Noise σ per channel** (2508–2537): robust MAD of each pixel's deviation from its 9×9 local mean, measured in the rebate box. Fallbacks are thin areas of the frame, then a fixed 0.01.

**Classification** (2539) with z = D/σ:
- **Below base:** min z < −3.
- **Blank film:** |z| ≤ 3.
- **Out of gamut:** otherwise, when the solve residual is > 0.01 D.

## 2. Pipeline

Tables are built per model and cached by content key (1860–1880) [code]:

| Table | Grid | Maps |
|---|---|---|
| solve | 33³ | a → (c, residual) |
| c→PD (film A, and film B for Re-shoot) | 33³ | dye amounts → printing density |
| c_p→XYZ | 33³ | paper dye amounts → XYZ |
| curves | 512×4 | film x↔c, paper x→c_p, re-shoot map |

The per-pixel chain is four WebGL2 passes: dyes → pd → print → out. A global pass at 640 px handles statistics and blurs.

1. **Analytic key** (FS_DYES 1918): a = K⁻¹D.
   - K_kj is the density of unit dye j in scanner channel k.
   - Channel density is −log10 Σ P̂_k 10^−D(λ), with P̂ normalised. This is the textbook's "soft minimum".
2. **Dye solve** (solve.js 652–787, `SOLVE_OPTS` at 1664). Each table node solves min ‖D(c) − (K·a + Dbase)‖²:
   - Forward model: D_k(c) = −log10 Σ_λ P̂_k 10^−(B + Σ c_j ε_j), over the 81-point 380–780 nm grid.
   - Bounds: 0 ≤ c ≤ 4.
   - Method: Levenberg–Marquardt with the closed-form Jacobian Σwε_j/Σw (w = P̂·T), Marquardt damping, 12 trial steps and at most 50 iterations, tolerance 1e-12.
   - **Active set** (727–753): a dye at a bound whose gradient points outward is held there, with projected-gradient tolerance gtol = 1e-9.
   - The start is the key a itself. The residual is stored as an "unreachable" flag.
   - The WGSL twin (3409–3492) runs the same algorithm in f32 with gtol raised to at least 1e-6.
3. **Dye-domain operations** (FS_DYES and FS_PD):
   - **Halation:** E = 10^(f⁻¹(c)); E_R += 0.30h·blur and E_G += 0.08h·blur, using two Gaussians of 0.4% and 1.8% of the long side; then back through the film curve.
   - **Saturation:** c ← n + s(c − n), where n is the neutral at the mean log exposure.
   - **Grain reduction:** 5×5 bilateral filter.
   - **Grain:** c += 0.035·g·√(c+0.05)·n(x). The noise texture is placed at 3 µm × size on the film and normalised to a 24 µm aperture through mip levels.
   - **Re-shoot:** c_B = f_B(f_A⁻¹(c)), then PD is blended between the two films.
4. **Printing density** (1717–1732): weighted by a **3200 K blackbody lamp** × paper sensitivity.
5. **Tone operators on PD** (FS_PRINT 1998–2012):
   - Base: a self-guided filter on Y = mean PD, at radius 4% (ε 0.05²) and 0.8% (ε 0.03²), computed at 640 px and applied as upsampled coefficients.
   - **Mask:** B' = B_ref + (1−0.6m)(B_L − B_ref), with B_ref the median of Y.
   - **Highlights / Shadows:** ±0.25·smoothstep around B_ref.
   - **Clarity:** 0.8·(Y − B_M).
   - **Texture:** coring on Y minus a 5×5 blur.
6. **Paper exposure:** x = clear + L − PD (2013). Printer lights are **pure log-H offsets per layer**, with 1 point = 0.025 log H. Subtractive filters and dichroic spectra are not modelled. L is the sum of:

   | Term | What it does |
   |---|---|
   | Auto colour (integrate to grey) | L = aim + m + α(Δ − m), where Δ = LATD − A and α defaults to 0.75 |
   | Roll consistency, match frame | pull towards the roll mean or a reference frame |
   | Exposure | −0.30103 per stop |
   | Warmth | 1.3 mired per unit × a PD-per-mired vector derived from the film's sensitivities to blackbodies around 5500 K (1818–1833) |
   | Tint | (−⅓, ⅔, −⅓) × 10 pt |

   The aim lights come from an LM fit that prints the film's grey (log H 0) at 18.4% (print.js 846). After the lights, per pixel in shader order:
   - **Edge and sky burns** add exposure through a radial and a top-down falloff.
   - **Shadow/highlight colour pads** are linear in x between g ± 0.4.
   - **Contrast:** x = g + γ(x − g).
   - **Pre-flash:** x = log10(10^x + φ).
7. **Paper:** c_p = paper curve(x) × fade factors (0.4, 0.12, 0.25).
   - XYZ is a single-pass reflectance 10^−Dp under a **5000 K blackbody**.
   - **The colour-matching functions are an analytic Gaussian fit, not the CIE tables** (325–337).
   - Bradford adaptation to D65. Fade also yellows the paper base.
   - Flare: + Blacks×4% × paper white. Gain: 2^(w/100) / Y_paper.
8. **Output** (FS_OUT 2027–2076), in this order: Sharpness, Bloom, then the OKLab operators, then sRGB or P3 matrix, a per-channel tanh shoulder above 0.82, and the sRGB curve.
   - **Sharpness:** a 3×3 ratio unsharp mask.
   - **Bloom:** smoothstep(0.55–0.95) source, σ 3.5% of the long side.
   - **OKLab:**
     - **Vibrance:** spares skin at 55° and colours that are already saturated.
     - **Hue shifts:** six families (25/55/100/145/250/320°), ±30° and a saturation amount each.
     - **Saturation rolloff:** fades colour towards deep shadows and near-whites.
     - **Colour density:** L −= 0.35·C.
   - **Look strength (0–150%)** scales all finishing operators. Every operator's constants are in `K` (950–992).

## 3. Embedded data

There are 11 stocks [data]:
- **Films:** Gold 200, Portra 160/400/800, Ektar 100, UltraMax 400, Fuji C200, Pro 400H.
- **Papers:** Portra Endura (the default), Supra Endura, Crystal Archive II.

All are on the 81-point 380–780 nm / 5 nm grid; the loader refuses any other grid (447). Each stock stores:

| Field | Size |
|---|---|
| log_sensitivity | 81×3 |
| channel_density | 81×3, nulls set to 0 |
| base_density | 81 |
| density_curves | 256×3 over log H −3…4 |

They are kept as JSON strings in `ST_DATA.cg` and written into the in-memory fs at boot.

**Licence:** every stock says "Copyright (c) 2026 Andrea Volpato. CC BY-SA 4.0" (spektrafilm/agx-emulsion data), so **ShareAlike applies** if the new product ships it.

**Data oddities:** Supra Endura's sensitivity is identical to Portra Endura's, and its base density is identical to Crystal Archive II's. The paper dye spectra are null (→0) below 400 nm and above about 700 nm.

**Other data:**
- Illuminants are blackbodies only: lamp 3200 K, viewing 5000 K, warmth reference 5500 K. Daylight throws "not shipped" (365).
- Status M bands and the colour matrices are hard-coded.
- `apd.txt` is referenced but missing; the Studio never uses it.

**Sample:** a real Gold 200 R/G/B triplet shot on an X-T5, 1292×863. Raw counts are stored as u16 and decoded as (u/16 − 2)/4000. It comes with a fixed rebate box and crop, and states two caveats: no flat field, and LED spectra assumed at FWHM 20.

## 4. GPU / worker architecture

**Rendering** [code] uses only WebGL2 fragment shaders (2714). It requires `EXT_color_buffer_float` and falls back to half floats when float filtering is missing. The programs:
- `dyes`, `pd`, `print`, `out`, `view`: the per-pixel chain and display.
- `blur`: separable, two kernels packed in one pass.
- `gfprep`, `gfab`: the guided filter.
- `bloomsrc`: the bloom source.
- `copy`: compiled but never used.

The full-size export runs in 1024-px tiles with an 8-px overlap. Tiles read the shared global pass through a coordinate uniform, so the wide blurs cannot seam.

**Table building** (accel.js 3697) tries three backends, the same order under the default "Auto":
1. WebGPU compute with two WGSL kernels, `SOLVE` and `SPECTRAL`: one invocation per node, workgroups of 64, spectra copied into workgroup memory. Only on a hardware adapter.
2. A pool of min(8, cores) workers started from a `<script type=text/plain id=st-worker>` blob, with jobs cut into node ranges.
3. The main thread, time-sliced at 30 ms.

**Slow-path reference:** the main-thread f64 tables are the reference. `Accel.benchmark` (3796) compares each backend against them: max |Δ| per table, and "flips" across the 0.01 residual threshold.
- **There is no CPU reference for the per-pixel shader chain.**
- `printOf` / `paperX` copy only the part from printing density onwards, for the readout and grey pick.
- The textbook's §4.7 numbers come from external test scripts that are not in the HTML.

## 5. UI, scripting, export, save format

**Layout** [code]:
- **Top bar:** modes Develop / Ring-around / Source; views Print / Negative / Dyes / Base & gamut; before/after split; grey pick; Open, Triplet, Recipe, Export.
- **Left:**
  - "Print" tab: print-window histogram, printer-lights table in points, source summary, compute and benchmark, snapshots, history.
  - "Book" tab: 13 chapters rendered with KaTeX.
- **Right:** the slider sections, from the declarative `SLIDERS` schema (1003–1597). Each slider has id, range, unit, macro/operator/hybrid kind, domain, cost and LaTeX; the UI shows only part of it.
- **Bottom:** film strip.
- **Keys:** \ split, g grey pick, r ring-around, s snapshot, b book, Ctrl/Cmd+Z undo/redo.

**Scripting:** a small `st:` command language (4370):
- `set?id=v`
- `reset?only=`
- `show?view=`
- `sample`, `chapter`, `bench`, `backend?b=`

Globals `window.studio`, `window.__spec` and `window.__flats` give console access. There is no formal or headless API.

**Export:**
- PNG16 (own encoder, sRGB chunk), PNG8 or JPEG through canvas (optionally Display P3), TIFF16 (untagged, inside a zip).
- Full size or screen size. **Screen-size 16-bit is really 8-bit data** (4484).
- Saving goes through `window.claude.use("downloads")` when present: the page was built as a claude.ai hosted artifact.

**Recipe JSON** (4453):
`{chromogen_studio:"1.2", frame, source, settings, lights:{logH, points, auto}, model, written}`

**Persistence:** autosaved to `localStorage["cgstudio:<file name>"]`. Because the key is the file name, a different scan with the same name inherits the old crop, rebate and settings.

## 6. Approximations, limitations, bugs

**Not built yet** [docs, bundled book ch.10]:
- Raw decode, registration, bracket merging.
- Dust removal.
- Local masks.
- The learned light estimator.
- Grain matched to the noise spectrum.
- ICC soft proofing.
- Restoration of faded negatives; the ADX output branch.

**Physics approximations** [code]:
- **Colour science:** analytic CMFs; blackbody-only light sources; single-pass print reflectance.
- **Film model:** **no DIR/interlayer coupling**, which the textbook's §2.3 also states. No spectral reconstruction of the scene: Re-shoot assumes each layer's exposure carries over.
- **Grain:**
  - Gaussian, the same for every stock.
  - **The 1024² noise tile repeats every 3.07 mm of film**, about 12 times across a 35 mm frame.
- **Halation:** the radii are fractions of the frame, not micrometres, and the added light is not renormalised.
- **Resolution-dependent operators:** Texture (`FINE_RADIUS` is unused), Sharpness and Grain reduction work at render-pixel scale, so the preview and the full export differ.
- **Clamped ranges:** dye amounts can reach 4, but the printing-density table only covers up to 2.6.

**Bugs found by reading** (not executed):
1. **Halation mixes channels.** The exposure is emitted as (E_R, E_G, E_R, E_G), but the blur applies its kernels as `.xxyy`. Red therefore gets the small blur of the average of red and green, and green gets the large blur of the same average. The shader comment expects (R σ1, R σ2, G σ1, G σ2). Lines 1929, 1932–1934, 3029–3032.
2. **The Exposure label is wrong.** It shows −40 pt per stop instead of about −12 (1018).
3. **Paper white is not display white at Whites 0.** The shoulder starts at 0.82, not above 1 as the slider spec says, so paper white lands at about 0.957 linear, about 250/255.
4. **The bundled book's output order differs from the code:** it says Bloom, OKLab, Sharpness; the code sharpens first.
5. **Smaller items:** Sharpness is implemented differently from its spec; the two decoder issues and the screen-size 16-bit export above.

---

