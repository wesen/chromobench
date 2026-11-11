# Chromogen Studio 1.2: what it actually computes

Reverse-engineering notes for CHB-001. Purpose: decide which parts of Chromogen Studio to carry into a darkroom / print-simulation suite fed by RAWs and negative scans, with a goja JS API underneath.

## How to read this document

Nothing was executed in a browser. Everything below comes from reading the extracted sources, plus two Python scripts that only read the embedded data (scripts 02 and 03).

Evidence tags:

- **[code]**: verified by reading the code at the cited lines.
- **[data]**: verified by parsing the embedded data with `scripts/02-inventory-chromogen-st-data.py` or `scripts/03-check-chromogen-stock-data.py`.
- **[docs]**: stated in the app's own UI strings, slider metadata or bundled book chapters. Not independently checked against code.
- **[textbook]**: stated in `sources/The Mathematics of the Colour Negative.md`, which documents this exact code base and often quotes its file names.
- **[inferred]**: my reading of consequences. Not verified.

Line references are into `various/extracted/chromogen-studio/` unless another path is given:

| File | Content |
|---|---|
| `05-inline.js` (5,216 lines) | The app: an esbuild bundle that is **not minified** and keeps its `// src/...` module comments |
| `04-st-worker.txt.js` (3 lines, minified) | Web Worker bundle: the same engine plus a job handler |
| `03-inline.js` (1 line) | `window.ST_DATA = {cg, samples, book}`: data files, sample metadata and 13 bundled book chapters |
| `st-data/` (new) | `03-inline.js` unpacked by script 02: `cg/stocks/*.json`, `cg/cameras/`, `cg/lights/`, `book/NN-*.md` |

### Module map of `05-inline.js` [code]

| Lines | Module | Role |
|---|---|---|
| 40–140 | `src/shims/path.js`, `fs.js` | In-memory filesystem. Data lives under `/cg/data/...` |
| 142–216 | `chromogen/src/units.js` | Typed quantities (D, logH, EV, nm, …). Refuses to add D to logH ("Hunt 14.17") |
| 218–383 | `chromogen/src/spectrum.js` | 380–780 nm / 5 nm grid (81 samples), `Spectrum` kinds, blackbody, Gaussian, analytic CMFs |
| 385–475 | `chromogen/src/stock.js` | `Curve`, `Stock`, stock JSON loader, push/pull `developed()` (unused) |
| 477–567 | `chromogen/src/channels.js` | Channel sets: Status M, scanner (light × camera), printing (lamp × paper sensitivity) |
| 569–645 | `chromogen/src/linalg.js` | 3×3 algebra, generic bounded LM, smallest singular value (Jacobi) |
| 647–790 | `chromogen/src/solve.js` | The dye solve: analytic Jacobian, bounded LM with an active set |
| 792–864 | `chromogen/src/print.js` | Printer model, printer lights, the grey-patch aim |
| 866–932 | `chromogen/src/colour.js` | Lab, CIEDE2000, Bradford, sRGB |
| 934–1612 | `src/spec.js` | Constants `K`, the `SLIDERS` schema, scanners, films |
| 1620–1901 | `src/model.js` | Builds the tables (solve, c→PD, c_p→XYZ, 1-D curves), the aim, `buildModel` |
| 1903–2085 | `src/shaders.js` | All GLSL ES 3.00 fragment shaders |
| 2087–2193 | `src/params.js` | Slider values → shader uniforms (lights, pads, operators); frame statistics |
| 2195–2413 | `src/decode.js` | TIFF, PNG and browser decoders |
| 2415–2692 | `src/source.js` | Orientation, crop, flat field, rebate, noise σ, working images, sample loader |
| 2694–3228 | `src/render.js` | WebGL2 renderer: passes, global pass, frame, probe, ring variants, tiled export |
| 3230–3387 | `src/export.js` | PNG16, TIFF16 and zip writers; save through the host's `downloads` API |
| 3392–3604 | `src/gpu.js` | WebGPU WGSL compute kernels for building the tables |
| 3606–3843 | `src/accel.js` | Worker pool, backend selection, benchmark |
| 3845–4512 | `src/state.js` | `Studio` store: frames, history, snapshots, `st:` links, recipes, export |
| 4514–5199 | `src/ui/*.jsx`, `markdown.js` | React 18 UI with createElement calls (no JSX build); markdown and KaTeX book reader |
| 5201–5215 | `src/main.jsx` | Boot. Exposes `window.studio`, `window.__spec`, `window.__flats` |

The `chromogen/src/*` modules are a DOM-free spectral library (CommonJS, typed arrays, an `fs` shim). Everything under `src/*` is Studio-specific [code].

---

## 1. Input handling

### 1.1 Formats [code]

`decodeFile` (2403–2412) dispatches on magic bytes:

| Input | Decoder | What is supported | Default encoding hint |
|---|---|---|---|
| TIFF (`II` or `MM`) | own `decodeTIFF` 2259–2335 | 8, 16 or 32-bit samples (32-bit float with SampleFormat 3); strips or tiles; chunky or planar; compression none, LZW (own decoder 2201), Deflate/AdobeDeflate (`DecompressionStream`), PackBits; horizontal predictor 2 for 8 and 16-bit; picks the largest full-resolution IFD, SubIFDs included (2285); 1 or 3+ samples per pixel (grey replicated, alpha dropped) | `bits === 8 ? "srgb" : "linear"` (2334) |
| DNG | the same TIFF path; tagged `kind: "DNG"` if tag 50706 is present | **Only demosaiced (LinearRaw-like) DNG**. A CFA mosaic (photometric 32803) is refused with a message (2289). Black level, white level, linearisation table, colour matrices and AsShotNeutral are **ignored**: values are divided by 2^bits − 1 | linear |
| PNG, 16-bit only | own `decodePNG` 2336–2388 (only if IHDR byte 24 == 16, line 2408) | Grey, grey+alpha, RGB, RGBA. **Not** palette, **not** interlaced. All five filter types. gAMA, iCCP and cHRM are ignored | **"srgb" even for 16-bit** (2387) |
| PNG 8-bit, JPEG, WebP, anything else | `createImageBitmap(..., {colorSpaceConversion: "none"})` 2389–2402 | 8-bit only; the embedded ICC profile is ignored | srgb |
| `.raf .nef .cr2 .cr3 .arw .orf .rw2 .pef` | — | **Refused**: "camera raw files are not decoded yet. Export a linear 16-bit TIFF (dcraw -4 -T, LibRaw dcraw_emu, RawTherapee …)" (2410) | — |
| `.json` | `loadRecipe` | A recipe applied to the current frame (3936–3938) | — |
| Triplet (3 files) | `mergeTriplet` 2419–2427 | Three exposures under R, G and B light, sorted by file name (numeric). Channel k comes from file k's own channel k (mode `"own"`; the `"mean"` mode exists, but the UI never selects it) | that of the first file |

All decoders produce `Float32Array` RGB in [0, 1].

The encoding can be overridden per frame in the Source panel: `linear`, `srgb` or `gamma22` (`transfer`, 2552–2554; UI 5095). There is no matrix or ICC conversion; only a transfer curve is undone [code].

Small bugs and gotchas [code]:

- **32-bit integer TIFFs divide by zero.** `maxv = (1 << bits) - 1` (2296). In JS `1 << 32 === 1`, so `maxv` is 0 for 32-bit unsigned integer samples.
- **16-bit PNGs default to sRGB decoding.** Bundled book ch.10 says "linear (the default for 16-bit files)" [docs], but only 16-bit TIFF gets the linear hint. A linear 16-bit PNG scan must be switched to *linear* by hand.
- **sRGB-encoded input is averaged before it is linearised.** `region()` averages the encoded values of a footprint and only then applies `f` (2580). This is slightly wrong for downsampled sRGB input.
- **No orientation tag.** TIFF/EXIF orientation is ignored. Orientation is set manually in `orient` (flip H, flip V, rotate 90°; 2428–2450).

### 1.2 Colour-space assumptions of the scan [code + inferred]

The scan is assumed to be **linear per-channel transmittance as seen by the scanner's channels**: value_k ∝ Σ_λ P_k(λ) T(λ), with P_k = light_k × camera_k.

There is no camera matrix, no white balance and no RGB→XYZ step. Dividing by the rebate removes the overall scale of each channel.

The channels P_k come from the chosen *scanner profile* (`makeScanner`, model.js 1645–1659):

| Id | P_k(λ) |
|---|---|
| `xt5-fitted` | Gaussian LEDs at 678/532/472 nm, FWHM 20 nm, × `generic-bayer` camera |
| `rgb-led-book` (default for opened files) | Gaussian LEDs at 660/530/450 nm (FWHM 20/25/20), × generic camera |
| `custom-led` | user peaks (default 665/530/450), FWHM 20, × generic camera |
| `white-led` | tabulated white LED (blue pump plus phosphor) × generic camera |
| `status-m` | Status M densitometer bands from an embedded table (channels.js 526–538) |

The "generic Bayer" camera is Gaussian, peaking at 600, 535 and 460 nm. Its own JSON says "Illustrative … Not a measured camera" [data]. The white LED is likewise "Illustrative … Not a measured product" [data].

[inferred] A lab scanner's JPEG or TIFF, with its own colour matrix and tone curve, is read as raw channel transmittance once an sRGB or 2.2 transfer is undone. That is physically wrong unless the profile happens to match. The model expects camera-raw-like linear data captured under a narrow-band (RGB LED) or known-spectrum light.

### 1.3 Working resolutions [code]

| Image | Size | Use |
|---|---|---|
| global | long side ≤ 640 px (`GLOBAL`, 2418) | statistics, edge-aware bases, halation, bloom |
| working | long side ≤ 2048 px (`WORK`, 2417) | preview, snapshots, ring-around, "screen" export |
| full | native | tiled full export, 1024-px tiles with an 8-px halo (3180) |

Downsampling is an area average (`region`, 2559–2593). The flat field is applied per output pixel, at the centre of that pixel's footprint.

### 1.4 Base / rebate estimation [code]

`Source.rebate` (2628–2645) has two modes:

- **Picked box** (the Source view's Rebate tool, 5054–5077). Treb_k is the mean of the box after resampling it to at most 64×64.
- **Auto** (the default for opened files: `rebate: {auto: true}`, 3952). The cropped frame is resampled to 256 px wide, and Treb_k = **99.7th percentile × 1.02** of each channel. This is "a bright percentile of the frame", **not of the rebate**. [docs] Ch.10 admits it puts the zero at the frame's lightest pixels, so blank film is under-counted.

The sample uses a fixed rebate box `[98,100,20,680]` and crop `[126,60,1090,754]` [data].

Density is always taken relative to the rebate: D_k = −log10(T_k / Treb_k) (FS_DYES 1925; `sigmaD` 2513; `classify` 2540).

The stock's own base density (`Dbase = channels.read(stock.base)`, solve.js 653) is added back when the solve table is keyed (model.js 1672, d = K·a + Dbase). [inferred] The scan's rebate is thus identified with the profile's base density.

**Flat field** (2451–2507, UI 5095):

- A capture of the light with no film: one file, or three for a triplet.
- Reduced to a grid of 96 cells (Smooth) or 512 cells (Fine) over the long side.
- Smoothed with [1 2 1] passes, divided by its mean and floored at 0.05.
- Every pixel, the rebate included, is divided by it.
- Kept for the session only (`FLATS` map). A recipe stores its name but not its data.

**Noise σ per channel** (`Source.noise` 2608–2621, `sigmaD` 2508–2537):

- Each pixel's density is compared with the mean of the other pixels in its 9×9 window (summed-area tables). σ = 1.4826 × the median deviation.
- Measured from the rebate box if there is one. Otherwise from "thin" frame pixels (D < 0.08 in every channel). Otherwise σ = 0.01 is assumed.
- Measured separately at working and global scale.

### 1.5 Base & gamut classification [code]

The classification is in `classify` (2539–2543), shader view 3 (2044–2053) and the global statistics (3041–3051). With z_k = D_k / σ_k and Z = 3:

- **Below base**: min z < −3.
- **Blank film**: min z ≤ 3.
- **Out of gamut**: otherwise, when the solve residual > 0.01 D.
- **Unreachable**: residual > 0.01 D, whatever the class.

These are reported in the top bar, the film strip badges and the "Base & gamut" view.

---

## 2. The processing pipeline, in order

The pipeline has three parts [code]:

- A per-frame **model** of 3-D and 1-D tables (`buildModel`, 1860–1880).
- A **global pass** at 640 px (`Renderer.global`, 3022–3069).
- A per-pixel chain of four WebGL2 passes at working or tile resolution (`Renderer.frame`, 3123–3134): **dyes → pd → print → out**.

The quantities follow the bundled book's chain (ch.1 [docs]): T (0–1) → D (density) → c (dye amounts) → PD (printing density) → x (paper log H) → c_p, XYZ → OKLab, RGB.

### 2.1 Tables built per model [code]

Tables are memoised by content key, for example `solve:<scanner>:<peaks>:<film>` (model.js 1866–1878).

| Table | Size | Key domain | Stored | Built by |
|---|---|---|---|---|
| solve | 33³ RGBA32F | a ∈ [−0.25, 2.55]³ (`A_RANGE`) | c₁, c₂, c₃, residual | `solveNodes` 1669–1679 |
| pdA (and pdB for Re-shoot) | 33³ | c ∈ [0, 2.6]³ (`C_RANGE`) | PD₁, PD₂, PD₃, 1 | `pdOf` / `pdNodes` 1720–1746 |
| print | 33³ | c_p ∈ [0, 2.7]³ (`CP_RANGE`) | XYZ adapted to D65, 1 | `printSetup` / `printNodes` 1763–1803 |
| curves | 512 × 4 2-D texture | row 0: film x→c on [−2.5, 2.5]; row 1: film c→x on [0, 2.6]; row 2: paper x→c_p on [−2.5, 2.5]; row 3: Re-shoot map c→f_B(f_A⁻¹(c)) | — | `curveTable` 1747–1761; packed at 2891 |
| grain noise | 1024² RGBA16F, mip-mapped, repeat | — | 3 independent unit-σ Gaussian fields (seed 12345, 5-tap blur) | `makeNoise` 2833–2875 |

The 3-D tables are read with hardware trilinear filtering at texel centres (`lut3`, 1916). Without `OES_texture_float_linear`, every table is uploaded as half-float (2797–2798).

### 2.2 Scan → density → analytic key [code]

The dyes pass (FS_DYES, 1918–1945) does three things:

1. T = max(texel, 1e-6).
2. D = −log10(T / Treb).
3. **a = K⁻¹ D**.

K is the 3×3 matrix with K_kj = the channel-k density of unit dye j alone (`Channels.analytical`, 508–511). The channel density of a spectral density is −log10 Σ_λ P̂_k(λ) 10^−D(λ), with each P̂_k normalised to sum to 1 (read, 496–503). This is the textbook's "soft minimum" (§1.3) and its K "Jacobian" (§1.4) [textbook].

The table is keyed on **a**, the analytic estimate, rather than on D. [textbook §4.2] measures 1.24× to 1.45× lower interpolation error for this "tangent keying".

### 2.3 Dye solve [code]

The solver is `makeSolver` (solve.js 652–787), called with `SOLVE_OPTS = {activeSet: true, gtol: 1e-9}` (model.js 1664).

**Forward model.** D_k(c) = −log10 Σ_λ P̂_k(λ) · 10^−(B(λ) + Σ_j c_j ε_j(λ)).

- B is the film's spectral base density.
- ε_j is the unit dye density spectrum of dye j, with nulls set to 0.
- 81 wavelengths.

**Problem.** For each table node a, minimise ‖D(c) − d‖² with 0 ≤ c_j ≤ 4, where d = K·a + Dbase.

**Jacobian.** Closed form, from the same loop over the spectrum: ∂D_k/∂c_j = Σ w ε_j / Σ w, with w = P̂_k · T(λ) (evalF, 682–717).

**Algorithm.** Levenberg–Marquardt on JᵀJ:

- Marquardt damping μ(1 + A_ii); μ starts at 1e-3, ×4 on failure, ÷3 on success.
- Up to 12 trial steps per iteration, 50 iterations at most.
- Stop when F ≤ 1e-12 (F is the sum of squared residuals).
- Each step is clipped to the box.
- **Active set** (727–753): a dye at a bound whose gradient points out of the box gets its gradient zeroed and its row and column replaced by the identity, so it stays put. Stop when the projected gradient < gtol.
- Start point: a = K⁻¹(d − Dbase), clipped. This is the table key itself.

**Output.** c and the residual √F. The Studio skips the σ_min diagnostic (`sigma: false`, 1672).

[textbook §3.4] The active set made the table 5.4–6.8× faster; mean iterations fell from 13.9 to 2.3.

**WebGPU twin.** The SOLVE kernel (3409–3492) is the same algorithm in f32, with three differences:

- gtol is floored at 1e-6 (3592).
- The determinant threshold is 1e-30.
- Held dyes are handled by branchless masking with `select`.

**Worker twin.** The workers run identical CPU code (`br={activeSet:!0,gtol:1e-9}` in `04-st-worker.txt.js`, line 3).

### 2.4 Dye-domain operations [code]

These run in FS_DYES and then FS_PD, in this order.

1. **Halation** (spatial; slider `halation` 0–100).
   - The global pass runs the dyes shader with `emitE = 1` to output film exposure E = 10^(f⁻¹(c)) for R and G.
   - That exposure is blurred separably with two Gaussians, σ = 0.4 % and 1.8 % of the long side (`K.HAL_RADII`; 3028–3033).
   - Per pixel: x = f⁻¹(c); E_R += 0.30·h·blur and E_G += 0.08·h·blur; then the R and G dyes are recomputed through the forward curve (1930–1937).
   - The added energy is not renormalised.
   - **See the bug in §6.3**: the channel packing mixes red and green exposure.
2. **Saturation** (`dyeSat`, "operator", ±100), with s = 1 + 0.6·v/100.
   - Neutral reference: n_k = f_k(mean_j f_j⁻¹(c_j)), the dyes that equal log exposures would give.
   - c ← max(n + s(c − n), 0) (1938–1943).
3. **Grain reduction** (`grainReduction` 0–100): a 5×5 bilateral filter on c.
   - Spatial σ = 1.6 px at the render resolution.
   - Range σ per layer = 0.015 + 0.03·√(c + 0.05).
   - c ← mix(c, filtered, r) (1953–1963).
4. **Grain** (`grain` 0–100, `grainSize` 0.5–3×).
   - c ← max(c + σ₀·√(c + 0.05)·n(x), 0), with σ₀ = 0.035·g/100 (1964–1968).
   - n(x) samples the 1024² noise texture in physical film coordinates: one texel = 3 µm × grainSize. The film size comes from the chosen *Format* (135, 645, 6×6, 6×7, 4×5; 2416, 2647–2650).
   - `grainNorm` rescales so that σ = 1 on a 24 µm aperture, at mip level log2(24 / 3·size) (3016–3020).
   - Mip-mapped sampling averages the noise away when viewed small, which follows Selwyn's area law.
   - Grain is excluded from the global pass and its statistics (`grainAmt: 0`, 3035).
5. **Re-shoot on** (`reshoot`, select, "rebuild").
   - c_B = f_B(f_A⁻¹(c)) per layer, via curve row 3.
   - PD = mix(PD_A(c), PD_B(c_B), t), with t = `reshootAmount`/100 (1970).

### 2.5 Printing density [code]

PD = pdTable(c), where PD_k(c) = −log10 Σ_λ P̂^print_k(λ) · 10^−(B_film + Σ c_j ε_j).

The printing channels are P^print_k = lamp(λ) × paper sensitivity_k(λ):

- The lamp is a **3200 K blackbody** (`printingChannels`, 1717–1719).
- Paper sensitivity is 10^log_sensitivity of the paper stock.
- Each channel is normalised to sum to 1.

The shader also stores Y = mean(PD₁, PD₂, PD₃) in alpha (1971). The tone operators work on this luminance-like quantity.

### 2.6 Tone operators in printing density [code]

**Spatial bases** are built in the global pass (3054–3060) with a self-guided **guided filter** (He et al.) on Y:

- Box means of (I, I²) at two radii, rL = 4 % and rM = 0.8 % of the long side, at 640 px.
- a = var / (var + ε) and b = mean − a·mean, with ε = 0.05² for the large radius and 0.03² for the mid radius.
- The coefficients are box-blurred again and stored in the `base` texture.
- FS_PRINT reconstructs B_L = a_L·Y + b_L and B_M = a_M·Y + b_M at full resolution, from upsampled coefficients (as in a fast guided filter).

**Operators** (FS_PRINT 1998–2012):

- **Contrast mask**: B′ = B_ref + (1 − mask)(B_L − B_ref), with mask = 0.6·m/100. B_ref is the **median of Y** over the global image (`frameStats`, 2167–2180; fallback 1.3).
- **Highlights**: B′ −= hl·smoothstep(B_ref, B_ref + 0.6, B_L), with hl = 0.25·h/100.
- **Shadows**: B′ += sh·smoothstep(B_ref, B_ref − 0.6, B_L).
- **Clarity**: ΔPD = (B′ − B_L) + clarity·(Y − B_M), with clarity = 0.8·c/100.
- **Texture**: d = Y − G₅ₓ₅,σ=1px(Y); ΔPD += texture·d·d²/(d² + 0.012²), a coring term, with texture = 1.2·t/100. `K.FINE_RADIUS` is defined but never used.
- Finally PD += ΔPD, identically in all three channels.

### 2.7 Paper exposure and printer lights [code]

The lights are computed per frame on the CPU (`frameParams` 2100–2157, `paperX` 2158–2166) and applied in FS_PRINT (2013–2020).

**Base relation.** x_k = clear_k + L_k − PD_k.

- clear_k = log10 Σ lamp·s_k: the exposure through an empty gate (print.js 834).
- **Printer lights are pure log-exposure offsets per layer.** This is idealised additive printing. No dichroic or subtractive filter spectra are modelled.
- Points: 1 pt = 0.025 log H (`PT`, 948; `Lights.points`, 820–822).

**Aim** (`aim`, 1810–1840). The film's grey is the stock developed at log H = 0 in every layer.

- `printer.greyPatch` uses a generic LM to find lights that print the grey with XYZ/white = 0.184 in all three components (print.js 846–852). Lamp 3200 K, viewing 5000 K blackbody.
- A = PD of that grey.
- g_k = clear_k − A_k + aim_k: the grey's paper exposure. It anchors contrast, the colour pads and pre-flash.
- `window`: the paper's useful range per layer, from the first x where D > Dmin + 0.04 to the first x where D > 0.9·Dmax.

**The lights L** are the sum of these terms:

| Term | Formula | Lines |
|---|---|---|
| Auto colour (integrate to grey, Hunt 16.7) | Δ = LATD − A, where LATD_k = −log10 mean(10^−PD_k) over the 640-px frame; m = mean(Δ); L_k = aim_k + m + α(Δ_k − m), with α = autoColour/100 (default 0.75) | 2095–2099 |
| Roll consistency | L ← (1 − r)·auto + r·(mean of the roll's auto lights) | 2105–2108 |
| Match frame | ΔL = (x̄_ref − x̄_this)·m/100, with x̄ = clear − meanPD + L | 2110–2113 |
| Exposure (stops) | −0.30103·e on all layers | 2114 |
| Warmth | 1.3 mired per unit × `warmPerMired` | 2091 |
| Tint | (−⅓, ⅔, −⅓) × 0.025 × 10 × t/100: ±10 pt of green at ±100 | 2092 |

`warmPerMired` (1818–1833) is the finite-difference change of PD per mired, mean removed. It is found by exposing the film's sensitivities to a blackbody at 5500 K ± 20 mired, developing through the film curves and reading PD. "Warmth" therefore means the lights that a warmer or cooler scene illuminant would need.

**Per-pixel x modifiers**, in shader order:

1. **Edge burn**: x += burn_e·smoothstep(0.42, 1, r)^1.4, with r the aspect-corrected radius normalised to the corner.
2. **Sky burn**: x += burn_s·(1 − smoothstep(0, 0.55, y)), from the top of the frame. Both burns are sliders of 0–20 pt.
3. **Shadow / highlight colour pads**:
   - A warmth/tint offset at half the global scale (`K.SPLIT` 0.5) at each anchor: x_s = g + 0.4 (shadows) and x_h = g − 0.4 (highlights).
   - Linear in x between and beyond the anchors: x += U_s + (x − x_s)/(x_h − x_s)·(U_h − U_s).
   - Together they are a per-layer offset and slope, i.e. crossover correction.
4. **Contrast**: x = g + γ(x − g), with γ ∈ [0.6, 1.6].
5. **Pre-flash**: x = log10(10^x + 0.35·p/100·10^(g − 0.6)).

The CPU replica `paperX` is used by the histogram, the readout and grey pick.

### 2.8 Paper, print and viewing [code]

**Paper dyes**: c_p = paperCurve_k(x_k)·fadeK_k (2021).

- The paper curves are the stock's density curves, floored at 0.
- **Fade** scales them: fadeK = 1 − (0.40, 0.12, 0.25)·fade/100, so cyan fades most (2120).

**Print table** (`printSetup`, 1763–1787):

- Reflectance R(λ) = 10^−(B_p(λ) + Σ c_p,j ε_p,j(λ)). This is **single pass**: no Saunderson surface term, no double pass through the dye layer.
- Fade also yellows the base: B_p += 0.14·fade·(Gaussian at 410 nm, σ 38 + 0.35 × Gaussian at 470 nm, σ 30) (1762, 1765).
- XYZ = Σ R·V·CMF / Σ V·ȳ under a **5000 K blackbody** viewing light V. It is not D50: daylight would need the CIE S0/S1/S2 tables, "which the prototype does not ship" (365).
- **The CMFs are an analytic multi-lobe Gaussian fit** (spectrum.js 325–337, Wyman–Sloan–Shirley-style coefficients), not the tabulated CIE 1931 functions.
- XYZ is then Bradford-adapted from the 5000 K white to D65 (1783–1785).

**Flare and whites** (2023; params 2121–2137): XYZ = (XYZ + flare·Y_paper·D65)·2^(whites/100)/Y_paper.

- flare = blacks/100 × 4 %; the default Blacks of 12 gives 0.48 % of paper white.
- Whites = 0 normalises paper white to Y = 1. See §6.3: the output shoulder then compresses it to about 0.957 linear.

**CPU replica.** `printOf` (4230–4234) replicates x→XYZ through the same LUTs (`look1`/`look3`, 1884–1901). It feeds the hover readout (L*a*b* under D65) and grey pick.

**Grey pick** (`neutralise`, 4236–4257) runs Newton iterations on (Warmth, Tint) until the picked PD's a* and b* are within 0.05.

### 2.9 Output / display transform [code]

FS_OUT (2027–2076), in **code order**:

1. **Sharpness**. yb = a 3×3 binomial blur of Y at the render resolution. k = clamp(1 + sharp·(Y − yb)/max(Y, 0.004), 0.5, 2), and XYZ *= k. This ratio-based unsharp mask preserves chromaticity. sharp = 1.2·s/100.
2. **Bloom**. The source XYZ·smoothstep(0.55, 0.95, Y) is taken at 640 px and blurred at 320 px with σ = 3.5 % of the long side (3061–3066). XYZ += 0.6·b/100·blur.
3. **OKLab operators** (standard M1/M2, applied to D65 XYZ):
   - **Vibrance**: C *= 1 + vib·clamp(1 − C/0.32)·(1 − 0.7·skin(h)), with skin centred at 0.96 rad (55°) and vib = 0.8·v/100.
   - **Hue shifts**: six families with centres at 25, 55, 100, 145, 250 and 320°. Each has a Gaussian weight in hue (σ 0.38 rad), gated by clamp(C/0.04). h += Σw·dh, with dh = 30°·u/100; C *= 1 + Σw·ds.
   - **Saturation rolloff**: C *= 1 − roll·(smoothstep(0.82, 1, L) + smoothstep(0.32, 0.05, L)), with roll = 0.85·r/100.
   - **Colour density**: L −= cden·C, with cden = 0.35·d/100.
4. **To RGB** through the linear sRGB or Display-P3 matrix (3102).
5. **Soft shoulder** per channel above 0.82: s + (1 − s)·tanh((v − s)/(1 − s)) (2073–2074).
6. **sRGB OETF** with the sign kept (`enc`). The 8-bit target clamps; the 16-bit export clamps to [0, 65535] (3213).

The bundled book gives the output order as "Bloom; then OKLab …; then Sharpness" (ch.10, step 12) [docs]. **The code sharpens first.**

**Debug views** (FS_OUT 2042–2053):

- *Negative*: T/Treb × 0.9, encoded.
- *Dyes*: 10^(−0.85c) as RGB, "the negative without its mask".
- *Base & gamut*: the classification map of §1.5.

### 2.10 All controls ("macros" and "finishing operators")

The controls come from `SLIDERS` (spec.js 1003–1597) and are mapped to uniforms in `frameParams` [code]. Every slider carries machine-readable metadata: `id, label, section, kind (macro|operator|hybrid), domain, cost (free|rebuild|spatial), unit, min, max, step, def, what, maths (LaTeX), chapter`. The UI shows only `what` (as a tooltip), `fmt` and `aside`; `maths`, `domain`, `cost` and `chapter` are never rendered [code].

The finishing operators (sections Tone, Colour and Detail) are scaled by **Look strength** λ = look/100, from 0 to 150 % (`op()`, 2101–2102). The physical macros are not.

| Section | Id | Range (def) | Kind / cost | Acts on | Constant |
|---|---|---|---|---|---|
| Print | exposure | ±3 stops (0) | macro / free | x | STOP 0.30103 |
| | warmth | ±100 (0) | macro / free | x | WARM_MIRED 1.3 |
| | tint | ±100 (0) | macro / free | x | TINT_PT 10 |
| | autoColour | 0–100 % (75) | macro / free | x | α |
| | contrast | 0.6–1.6× (1) | macro / free | x about g | — |
| | preflash | 0–100 (0) | macro / free | x | PREFLASH 0.35 |
| | whites | ±100 (0) | hybrid / free | output gain | 2^(w/100) |
| | blacks | 0–100 (12) | macro / free | XYZ flare | FLARE_MAX 4 % |
| | shadowColour, highlightColour | pads ±100² ([0,0]) | macro / free | x | SPLIT 0.5, SPLIT_SPAN 0.4 |
| Paper and film | paper | Portra Endura / Supra Endura / Crystal Archive II | macro / rebuild | print tables | — |
| | reshoot | none + 8 films | macro / rebuild | c | — |
| | reshootAmount | 0–100 % (100) | hybrid / free | PD blend | — |
| | halation | 0–100 (0) | macro / spatial | film exposure | HAL_R 0.30, HAL_G 0.08, radii 0.4 % and 1.8 % |
| | grain | 0–100 (0) | hybrid / spatial | c | GRAIN_SIGMA 0.035 |
| | grainSize | 0.5–3× (1) | hybrid / spatial | c | 3 µm texel per 1× |
| | fade | 0–100 (0) | macro / rebuild | c_p and base | (0.4, 0.12, 0.25), stain 0.14 |
| | edgeBurn, skyBurn | 0–20 pt (0) | macro / free | x | PT |
| Roll | rollConsistency, matchAmount | 0–100 % (0) | macro / free | L | — |
| Tone | mask | ±100 | operator / spatial | PD | MASK 0.6, MASK_RADIUS 0.04 |
| | highlights, shadows | ±100 | operator / spatial | PD | ZONE 0.25 |
| | clarity | ±100 | operator / spatial | PD | CLARITY 0.8, MID_RADIUS 0.008 |
| | texture | ±100 | operator / spatial | PD | TEXTURE 1.2, core 0.012 |
| Colour | dyeSat ("Saturation") | ±100 | operator / free | c | DYESAT 0.6 |
| | vibrance | ±100 | operator / free | OKLab | VIBRANCE 0.8 |
| | colourDensity | ±100 | operator / free | OKLab | COLDENS 0.35 |
| | satRolloff | 0–100 | operator / free | OKLab | ROLLOFF 0.85 |
| | hues | 6 families × (hue ±100, sat ±100) | operator / free | OKLab | HUE_DEG 30 |
| Detail | sharpness | 0–100 | operator / spatial | output Y | SHARP 1.2 |
| | grainReduction | 0–100 | operator / spatial | c | GRAINRED 1 |
| | bloom | 0–100 | operator / spatial | output XYZ | BLOOM 0.6 |
| | look | 0–150 % (100) | scales operators | — | — |

The Source-panel settings are kept per frame in `src`, separately from the sliders: film, scanner, LED peaks, encoding, format, orientation, crop, rebate and flat field.

---

## 3. Embedded data

### 3.1 Storage [data + code]

`03-inline.js` assigns `window.ST_DATA` with three parts:

- **`cg`**: 13 data files as JSON strings, keyed by path. `loadData` writes them into the in-memory fs at `/cg/data/<path>` (engine.js 1616–1618). The worker receives the same map in its `init` message (3644).
- **`samples.gold200`**: metadata for the bundled scan.
- **`book`**: 13 markdown chapters (`id, title, order, body`).

All spectral data is on the **81-point 380–780 nm grid, 5 nm step**; the loader refuses any other grid (stock.js 447). A stock JSON has this shape:

`{info:{stock,name,type,densitometer,target_print}, metadata:{license}, data:{wavelengths[81], log_sensitivity[81][3], channel_density[81][3] (nulls→0), base_density[81], log_exposure[256] (−3…4), density_curves[256][3]}}`

### 3.2 Stocks [data]

| Stock | Role | Densitometer | Notes |
|---|---|---|---|
| kodak_gold_200 | film (the sample) | status_M | target print Portra Endura |
| kodak_portra_160 / 400 / 800 | film | status_M | Portra 400 is the default for opened files |
| kodak_ektar_100 | film | status_M | |
| kodak_ultramax_400 | film | status_M | |
| fujifilm_c200 | film | status_M | target Crystal Archive II |
| fujifilm_pro_400h | film | status_M | base density up to 1.447 at the blue end |
| kodak_portra_endura | paper (default) | status_A | dye nulls at 380–400 and 700/705–780 nm (set to 0) |
| kodak_supra_endura | paper | status_A | **`log_sensitivity` identical to Portra Endura's**; **`base_density` identical to Crystal Archive II's** |
| fujifilm_crystal_archive_typeii | paper | status_A | dye nulls at 725–780 nm |

**Neutral slopes** over −0.5…+0.5 log H: 0.46–0.70 for the films and 1.57–2.24 for the papers (script 03).

**Licence.** **Every stock carries "Copyright (c) 2026 Andrea Volpato. Licensed under CC BY-SA 4.0."** This is spektrafilm/agx-emulsion data. **ShareAlike applies to any product that redistributes these tables or derivatives of them.**

### 3.3 Other data [data]

**Data files**:

- `cameras/generic-bayer.json`: an illustrative Gaussian camera, peaks at 600/535/460 nm.
- `lights/white-led.json`: an illustrative white LED, peak 565 nm with a 450 nm pump.

**Built into the code, not the data**:

- the Status M table (channels.js 526–530)
- the analytic CMFs (325–337)
- the blackbody function (301–310)
- the D65 white and the Bradford, sRGB and P3 matrices (colour.js 870–874; render.js 3102)
- the fade stain spectrum (1762)

**Referenced but missing**: `channels/apd.txt` (`apd()`, 539–547) would throw, and CIE daylight S0/S1/S2 throws explicitly (365). Neither is used by the Studio.

**Illuminants actually used**:

- printer lamp: 3200 K blackbody
- viewing light: 5000 K blackbody
- warmth reference: 5500 K blackbody
- scanner light: Gaussian LEDs, or the illustrative white LED

### 3.4 Sample scan [data]

`samples/gold200.png` is a 1292×863 image, stored as a 16-bit PNG ([inferred] from `loadSample`, 2679–2692).

- **Encoding**: u16 with v = u/16 − 2. These are black-subtracted X-T5 raw counts, means over 6×6 X-Trans blocks. Transmittance = max(0.05, v)/4000.
- **Capture**: Kodak Gold 200, scanner profile `xt5-fitted`, flipH. Fujifilm X-T5 at ISO 125, 1/6 s per LED, source files DSCF4457–4459.RAF.
- **Named regions** are included for checking.
- **Stated caveats**: "no flat field: the rebate varies by about 0.02-0.03 D along the frame" and "the scanning light's spectra are not known; FWHM 20 nm assumed".

The sample loads automatically at boot when no frame is open (5212–5214).

---

## 4. GPU / worker architecture

### 4.1 Rendering: WebGL2 fragment shaders [code]

The renderer (2714–2738) requires WebGL2 and `EXT_color_buffer_float`. It uses `OES_texture_float_linear` when present and half-float otherwise.

- Every pass draws one oversized triangle into a named, reusable float render target (`target`, 2804–2832).
- Every sampler is bound on every draw: the named textures first, then a 1×1 placeholder for the rest (2939–2946). [textbook §4.4] describes the two bugs this fixed.
- Timing waits on a one-texel `readPixels` (`sync`, 2962–2968), because `gl.finish` does not block in Chromium.

The programs (compiled at 2731):

| Program | Computes |
|---|---|
| `dyes` (FS_DYES) | T → D → a → solve-LUT c and residual; halation; dye saturation; in `emitE` mode it outputs film exposure |
| `pd` (FS_PD) | grain reduction (bilateral), grain, c → PD (A/B blend), Y |
| `blur` (FS_BLUR) | separable 1-D blur, ≤ 97 taps; two kernels packed in `kw[i].xy`, applied as `.xxyy` |
| `gfprep`, `gfab` | guided-filter inputs (I, I²) and coefficients (a, b) at two radii |
| `print` (FS_PRINT) | tone operators on PD; x and all light-like controls; paper curves, fade, XYZ LUT, flare, gain |
| `bloomsrc` | thresholded XYZ for bloom |
| `out` (FS_OUT) | sharpen, bloom add, OKLab operators, RGB matrix, shoulder, OETF; the debug views |
| `view` (FS_VIEW) | fit to canvas; before/after split line |
| `copy` | compiled but **never used** |

**One frame** runs these passes:

- **Global pass at ≤ 640 px** (3022–3069):
  - halation: dyes in emitE mode, then two blurs
  - dyes, then pd
  - when the negative key changes: a CPU read-back for statistics and the gamut classes
  - guided filter: prep, two box blurs, ab, two box blurs
  - optionally print, bloomsrc and two blurs at half size
- **Working size**: dyes → pd → print → out (3127–3132), then `view`.
- **Full export**: the same four passes per 1024² tile with an 8-px halo (3180–3227). Tiles reuse the global pass through the `g2` uniform (tile → whole-frame coordinates), so the wide fields cannot seam.

### 4.2 Table building: three backends [code]

`Accel` (3697–3843) has three backends:

- **WebGPU compute** (`gpu.js`):
  - Two WGSL kernels, one invocation per node, workgroup size 64.
  - The seven 81-sample spectra are staged in workgroup memory (`MAXN` 128).
  - `SOLVE`: bounded LM with active set, in f32.
  - `SPECTRAL`: −log10 Σ W·10^−(B + Σcε) for PD, or M·Σ for XYZ.
  - Results are read back with `mapAsync`.
- **Worker pool** of min(8, cores) workers:
  - Started from the text of `<script type="text/plain" id="st-worker">` through a blob URL (3631–3644). It is a minified second bundle of the same engine.
  - Work is split into node ranges: 512 nodes for the solve, 2048 for pd and print.
  - pd and print jobs are "urgent" and go to the front of the queue.
  - Results come back as transferable `Float32Array`s.
- **Main thread**: `solveTable` is time-sliced at 30 ms (1681–1698); pd and print run synchronously.

**Backend order** (`order`, 3721–3727):

- Auto: a hardware WebGPU adapter (not a software fallback), then workers, then the main thread.
- The user can force gpu, workers or main. The choice persists in `localStorage["cgstudio:engine"]`.
- A backend that fails falls through to the next one.

### 4.3 Slow-path reference and equivalence checks [code + textbook]

- **The tables have a CPU reference: the main-thread f64 build.**
- `Accel.benchmark` (3796–3842) builds all three tables on every backend and reports:
  - timings
  - max |Δ| against the main thread; for the solve, only on nodes the reference reaches (residual < 0.01)
  - **flips**: nodes whose residual crosses 0.01
- The result is shown in the Compute panel (4840–4843) and can be triggered with `st:bench`.
- **There is no CPU reference renderer for the per-pixel shader chain.** `printOf` and `paperX` replicate the macro part from PD onward (no spatial operators, shoulder or OKLab), but only for the readout and grey pick; nothing compares them with the GPU.
- [textbook §4.7] reports results from external test scripts (`test/accel.cjs`, `test/export.cjs`, `studio-bench.cjs`) that are **not included in the HTML**:
  - workers are bitwise equal to the main thread
  - GPU solve within 2.2e-6 in c, with 0 flips
  - GPU PD within 7e-7
  - tiled export within 1 level with the 8-px halo, and up to 28 levels without it

---

## 5. UI, scripting, export, persistence

### 5.1 Layout [code]

This is `App` (5161–5199).

**Top bar**:

- brand and frame name
- mode: **Develop / Ring-around / Source**
- view: **Print / Negative / Dyes / Base & gamut**
- *Before/after* split (against a snapshot or the defaults) and *Grey pick*
- progress and status pills, out-of-gamut and below-base warnings
- *Open…*, *Triplet…*, *Recipe…*, *Export…*

**Left panel**, two tabs:

- **Print**:
  - **Print window**: a histogram of paper log H per layer against the paper's toe and shoulder, with the % clipped (4808–4823).
  - **Printer lights**: points vs aim per contribution, and the total in log H.
  - **Source** summary: film, scanner, rebate T, frame size in mm, flat field, noise σ, class percentages.
  - **Compute**: backend selector, GPU name, workers, last table timings, benchmark table.
  - **Snapshots**: A, B, … with compare, restore and delete.
  - **History**: undo/redo and the last 8 labels.
- **Book**: the 13 bundled chapters, rendered with KaTeX. Their links run `st:` commands.

**Centre**:

- **Develop**: the WebGL canvas, with a hover readout (x, y; dyes; base class; PD; paper log H; print L*a*b*). Files can be dropped onto it; Shift plus 3 files makes a triplet.
- **Ring-around**: a 3×3 hex of six colour moves plus the current print, and a density strip at ±1 and ±2 steps.
  - Steps are 2, 4 or 8 pt.
  - Moves are projected onto Exposure, Warmth and Tint by `lightsToSliders` (4222–4228); clicking a tile applies it.
- **Source**: the whole scan, with **Crop** and **Rebate** drag tools.

**Right panel**:

- In Develop mode: the slider sections, plus a "Finishing" header that carries Look strength. The colour pads are 2-D SVG pads.
- In Source mode: film, scanner, LED peaks, encoding, format, orientation, rebate (pick or auto), and flat field (open, Smooth/Fine, use for all, remove).

**Bottom**: a film strip with thumbnails, gamut and below-base badges, remove buttons and "load sample".

**Keyboard**:

- Ctrl/Cmd-Z undo, Shift+Ctrl/Cmd-Z redo
- `\` split
- `g` grey pick
- `r` ring-around
- `s` snapshot
- `b` book
- Esc

### 5.2 Scripting / API surface [code]

**`st:` command links** (`Studio.link`, 4370–4442) form a tiny URL-style command language used by the bundled book:

- `st:set?<id>=<v>&hues.<fam>=h,s`: values are clamped to the slider range; pads take `x,y`.
- `st:reset?only=all|finishing|print|<section>`
- `st:show?view=print|negative|dyes|base|unreachable|split|ring|window`
- `st:sample`, `st:chapter?id=`, `st:bench`, `st:backend?b=auto|gpu|workers|main`

**Globals**:

- `window.studio`: the whole `Studio` store.
- `window.__spec`: SLIDERS, K, FILMS, SCANNERS, defaults.
- `window.__flats`.

Everything is scriptable from a console through `studio`: `set()`, `setSrc()`, `exportFrame()`, `recipe()`, `neutralise()`, `benchmark()`, `analyseRoll()`. There is no formal API and no headless mode; the renderer needs a canvas and WebGL2.

### 5.3 Export [code]

The export path is `exportFrame` (4465–4511), `ExportModal` (5149–5160) and `export.js`.

**Formats**:

- PNG 16: own encoder, with an sRGB chunk.
- PNG 8 or JPEG at q 0.95: through canvas `toBlob`, optionally on a `display-p3` canvas.
- TIFF 16: an own minimal baseline writer with no colour tag, delivered **inside a zip**.

**Sizes and colour**:

- Full (tiled, native resolution) or screen (the working size).
- Display P3 is offered only for 8-bit PNG and JPEG.
- **"Screen" at 16 bits is really 8-bit data**: the byte target × 257 (4484).

**Saving** goes through `window.claude.use("downloads")` when the host provides it, and an `<a download>` click otherwise (3356–3387). The page was built to run as a claude.ai hosted artifact.

### 5.4 Presets / save format [code]

The **recipe** (`recipe()`, 4453–4456) is this JSON:

```json
{ "chromogen_studio": "1.2", "frame": "<name>",
  "source": {film, scanner, peaks, encoding, flipH, flipV, rotate, crop, rebate, format, flat},
  "settings": {<every slider id>: value, "hues": {reds:[h,s], …}},
  "lights": {"logH": [R,G,B], "points": [R,G,B], "auto": [R,G,B]},
  "model": {"film": …, "paper": …, "scanner": …}, "written": ISO-8601 }
```

`loadRecipe` (4457–4464) applies a recipe to the open frame: it merges `source` and replaces `settings`.

**Autosave**:

- `localStorage["cgstudio:<frame name>"] = {src, s, snaps}`, debounced 400 ms (4200–4206).
- Merged back when a file with the **same name** is opened (3955–3956).

**History**: undo holds 200 entries per frame, in memory. Snapshots are named copies of `s`. There are no named presets and no LUT libraries.

---

## 6. Approximations, limitations, unfinished parts

### 6.1 Stated as not built [docs: book ch.10 "What is not built yet"; ch.5, ch.8, ch.9]

- Raw decoding, registration of sequential exposures, bracket merging, capture deconvolution.
- A dust/IR clean mode.
- Local layers and masks beyond the two burns.
- The learned light estimator; roll consistency is a stand-in.
- Noise-spectrum-matched grain reduction, and re-grain at the export size.
- ICC soft proofing, and output sharpening from print size.
- Restoration of faded negatives, and the scene-referred (ADX) branch.

### 6.2 Physics approximations (verified in code)

**Colour science**:

- **Analytic CMFs** instead of the CIE tables.
- **Blackbody illuminants only**: lamp 3200 K, viewing 5000 K, warmth around 5500 K.
- Single-pass print reflectance. Flare is a flat veil tinted D65.

**Scanner and film**:

- The camera and the white LED are illustrative. The X-T5 profile is "fitted" with an assumed FWHM of 20 nm.
- **No DIR / interlayer coupling**: the three layer curves are independent, and Re-shoot maps layer by layer. [textbook §2.3]: "Chromogen has no DIR model: `pipe.uncouple` is the identity".
- **No spectral upsampling of the scene.** `sigmoid()` exists in the library but is unused. Re-shoot assumes "layer exposures carry over one to one" [docs ch.5].
- Printer lights are pure log-H shifts. There are no dichroic filter spectra and no enlarger optics.

**Grain**:

- Gaussian, with σ ∝ √(c + 0.05).
- The same statistics for every stock and layer: no sublayers and no Poisson–binomial model ([textbook §2.5] contrasts it with spektrafilm).
- The **1024² noise tile repeats every 3.07 mm on the film** at 1× (3 µm texels, wrap mode repeat). That is about 12 repeats across a 36 mm frame.
- The seed is fixed, so the grain is deterministic.

**Halation**:

- Radii are fractions of the frame's long side, not µm, so they do not scale with film format.
- The added energy is not normalised; spektrafilm divides by 1 + a.

**Spatial operators at render-pixel scale.** These make the ≤ 2048-px preview and the full export differ:

- **Texture**: a fixed 5×5 kernel at σ = 1 px; `FINE_RADIUS` is unused.
- **Sharpness**: 3×3.
- **Grain reduction**: 5×5.

The book admits this for the last two only.

**Range and statistics limits**:

- The solve allows c up to 4, but the PD table and the film-inverse LUT cover only c ∈ [0, 2.6], and the lookups clamp.
- Paper x is clamped to [−2.5, 2.5].
- The aim treats film log H = 0 as the grey card ([inferred] from the agx-emulsion data convention).
- The statistics (auto colour, B_ref, histogram) come from the 640-px pass, without grain.
- The auto rebate is a frame percentile, not the rebate.

### 6.3 Bugs and doc/code discrepancies found by reading (not executed)

1. **Halation channel mix-up** (1929, 1932–1934, 3029–3032).
   - `emitE` writes (E_R, E_G, E_R, E_G). The blur applies kernel σ₁ to .xy and σ₂ to .zw (`kw[i].xxyy`).
   - So h = (E_R⊛σ₁, E_G⊛σ₁, E_R⊛σ₂, E_G⊛σ₂).
   - The consumer assumes (E_R σ₁, E_R σ₂, E_G σ₁, E_G σ₂), as the uniform comment says, and adds ½(h.x + h.y) to red and ½(h.z + h.w) to green.
   - Effect: red gets the small-radius blur of the **average of red and green exposure**, and green gets the large-radius blur of the same average.
   - The guided-filter prep packs (I, I², I, I²) correctly; only halation is wrong.
2. **The Exposure "points" aside is off by a factor of 1/STOP** (1018). `aside: v => sign(-v / STOP * STOP / PT)` evaluates to −v/0.025, so it shows −40 pt per stop instead of −12.
3. **Paper white is not display white at Whites = 0.** The spec says "soft shoulder above 1" (1124), but the shoulder starts at 0.82 per RGB channel. Paper white (Y = 1) lands at 0.82 + 0.18·tanh(1) = 0.9571 linear, which is 0.9809 sRGB, or 250/255 (computed by script 03).
4. **Output order.** The docs say Bloom → OKLab → Sharpness; the code runs Sharpness → Bloom → OKLab (2055–2072).
5. **Sharpness.** The spec says Y + 1.2s(Y − G₀.₇*Y); the code uses a 3×3 binomial blur and multiplies XYZ by a clamped ratio.
6. **Input defaults.** 16-bit PNG defaults to sRGB decoding (2387), against the docs. 32-bit integer TIFFs divide by zero (2296).
7. **Export.** Screen-size 16-bit export is 8-bit data (4484). PNG16 is always tagged sRGB; TIFF16 is untagged.
8. **Autosave is keyed by file name.** A different scan with the same name inherits the old crop, rebate and settings (3955).
9. **Dead code**:
   - `FS_COPY`, `parametric`, `developed` (push/pull curves), `deltaE2000`, `latd`, `toSRGB`/`fromSRGB` and `apd` are shipped but unused.
   - The slider metadata `maths`, `domain`, `cost` and `chapter` is never rendered.
   - The `burn` uniform's 3rd and 4th components are "unused".

---

## 7. Carry-over assessment for the new product (opinion)

**Worth carrying, mostly as is**:

- **The `chromogen/src` library** (units, spectrum, stock, channels, linalg, solve, print, colour; about 790 lines, 142–932).
  - It is DOM-free, small and f64.
  - Its typed spectral kinds and unit errors encode the domain rules: "densities add, transmittances multiply"; "a density offset is not a log-exposure shift".
  - [inferred] It should load in goja with only the `fs`/`path` shims. That needs checking: ES2020 syntax (`??`, classes, arrow functions) and typed arrays.
- **The staging design.**
  - Physics lives in content-keyed tables: the 33³ solve keyed on a = K⁻¹D, c→PD and c_p→XYZ, plus 1-D curves.
  - Every printer-light-like control stays a per-pixel coordinate change in x, so it is "free".
  - This is the right architecture for interactive use, and for an agent API: rebuild only when a table's inputs change.
- **The bounded LM with active set and analytic Jacobian**, and the residual as an "unreachable" flag.
- **The blank / below-base / out-of-gamut classification**, with robust σ from the rebate. These are directly useful diagnostics for negative-scan QA.
- **The light model**: printer points, integrate-to-grey with α, the physically derived Warmth axis (mired → PD through the film's sensitivities), Tint, the crossover pads, the ring-around via `lightsToSliders`, grey pick by Newton on a*b*, roll consistency and match frame.
- **`SLIDERS` as a declarative parameter schema** (ids, ranges, units, kind, domain, cost class, LaTeX). It maps naturally onto a goja API surface and onto input validation.
- **The `st:` verb set and the recipe JSON** as a seed for agent-facing commands and a reproducible edit format. Add a version and a scan hash.

**Carry, with fixes**:

- Fix the halation packing bug.
- Make the halation and texture radii physical (µm).
- Replace the repeating grain tile.
- Decide the shoulder / white mapping.
- Align the documented output order with the code.
- Fix the PNG and TIFF decode bugs.
- Key autosave by a content hash, not the file name.

**Replace or extend**:

- **Colour science**: tabulated CIE 1931 (and 2006) CMFs; CIE D-series and real lamp spectra; dichroic filter spectra if subtractive printing matters; Saunderson / double-pass print reflectance; real ICC output, with tags in the PNG and TIFF files.
- **Film model**: DIR coupling (the textbook's §2.3 model is ready to port), and a stock-dependent grain model.
- **Inputs**: raw input through LibRaw-equivalent decoding into linear camera RGB, honouring black and white levels.
- **Calibration**: measured camera sensitivities and LED spectra, or a calibration step (textbook §3.7). The bundled ones are explicitly illustrative.
- **CPU reference for the whole per-pixel chain.** It is needed for goja/headless use and for regression tests against the GPU path.
- **Licensing**: the stock data is CC BY-SA 4.0 (spektrafilm), so ShareAlike obligations apply.

---

## Appendix A: textbook cross-references

| Studio element | Textbook |
|---|---|
| soft-minimum channel density, K as Jacobian, rebate | §1.3, §1.4, §1.6 (lines 100–214) |
| noise σ via `sigmaD` | §1.7 (line 233 ff.) |
| no DIR model in Chromogen | §2.3 (end of the section) |
| Studio halation as a cheap version of spektrafilm's | §2.4 |
| `GRAIN_SIGMA` in Selwyn's terms | §2.5 (end) |
| integrate-to-grey, pre-flash, flare constants | §2.6–2.7 (lines 536–574), §3.6 |
| scanner forward model, sample counts → T | §3.1 (lines 712–747) |
| active-set LM, table timing | §3.3–3.4 (lines 786–873) |
| reachability classes on Gold 200 (12.6 % blank, 9.7 % below base, 19.3 % unreachable) | §3.5 (lines 874–916) |
| X-T5 fitted profile from Appendix E | §3.7 (line 959) |
| tables, keying, trilinear vs tetrahedral | §4.1–4.2 (lines 1058–1143) |
| blur costs, the global pass | §4.3 |
| WebGL2 passes, sampler-binding bugs, timing | §4.4 |
| WGSL kernels, f32 tolerance, divergence | §4.5 |
| worker pool scheduling | §4.6 |
| fast-vs-slow checks (external tests) | §4.7 |

## Appendix B: artefacts produced for this analysis

- `scripts/02-inventory-chromogen-st-data.py`: parses `03-inline.js` as JSON without executing it and prints an inventory. Given an output directory, it also unpacks `cg/*` (as pretty-printed JSON) and `book/*.md`.
- `scripts/03-check-chromogen-stock-data.py`: checks the stock, camera and LED data and computes the paper-white value. It prints:
  - null dye ranges, dye peaks and sensitivity peaks
  - stocks with identical arrays
  - neutral slopes
  - camera and LED peaks
  - the paper-white value after the shoulder
- `various/extracted/chromogen-studio/st-data/`: the unpacked data (11 stocks, the camera, the LED, 13 book chapters).

Run from the ticket directory:

`python3 -I scripts/02-inventory-chromogen-st-data.py various/extracted/chromogen-studio/03-inline.js various/extracted/chromogen-studio/st-data`

`python3 -I scripts/03-check-chromogen-stock-data.py various/extracted/chromogen-studio/st-data/cg`
