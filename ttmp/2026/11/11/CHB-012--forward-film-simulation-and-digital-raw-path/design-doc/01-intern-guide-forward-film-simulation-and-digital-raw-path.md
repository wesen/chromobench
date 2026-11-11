---
Title: 'Intern guide: Forward film simulation and digital RAW path'
Ticket: CHB-012
Status: active
Topics:
    - film-emulation
    - color-science
    - image-pipeline
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/design-doc/01-chromobench-architecture-and-work-plan.md
      Note: op catalog (capture.*, film.*), domains, FrameRecipe.capture and ImageInfo.umPerPx this ticket implements
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/scripts/06-decode-filmbench-film-data.py
      Note: decoder for the Filmbench data blob used to build interim fixtures
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: §1.8 and §2.1-2.5, §2.8 give upsampling, exposure, curves, DIR, halation, grain and composition laws with golden numbers
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/05-inline.js
      Note: stock.js (385-475) with Curve, parametric and the developed() push heuristic
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/cg/stocks/kodak_portra_400.json
      Note: Portra 400 curves and spectra for the DIR and parametric-fit checks
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/00-film-data.bin.txt
      Note: embedded data with film profiles, 64x64 film tables, Portra 800 push profiles and CAT16 matrices (interim data)
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/01-inline.js
      Note: 'Filmbench forward pipeline: rgbToRawFn (154-178), curves and DIR (181-235), auto-exposure (468-487), expose and develop stages (547-612)'
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/light-film-paper/00-book-data.json
      Note: Light, Film, Paper chapter 1 HTML (chapters[0].html), the stage 1 upsampling and exposure goldens
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:25.282971916-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Forward film simulation and digital RAW path

## 1. What this ticket builds

A colour negative scan enters chromobench at the film's dye amounts: the scanner reads the negative and CHB-003 solves for the three dyes per pixel. A digital camera RAW file has no negative. To print it in the simulated darkroom, chromobench must first **shoot it on film**: turn the scene's light into exposures of a chosen stock, develop those exposures into dyes, and hand the dyes to the same print chain a scanned negative uses. That forward path, scene → negative, is CHB-012.

```text
RAW file ─(CHB-006: LibRaw photo mode)─► camera-linear ─capture.sceneXYZ─► scene-xyz
   ─capture.expose─► film-logH ─film.halation─► film-logH ─film.couple─► film-logH (inhibited)
   ─film.develop─► film-dyes ─film.grain─► film-dyes ─(CHB-003 print chain)─► print ─► display
```

CHB-012 delivers two things:

1. **The f64 reference implementation** in `@chromobench/core`, under `packages/core/src/film/`, next to CHB-003's spectral core and print chain. Like the rest of `core`, it is the source of truth and the oracle for the GPU.
2. **Specifications for the GPU kernels** that CHB-005 implements: inputs, outputs, binding times, precision and tolerances against the reference. This guide writes those specifications; CHB-005 writes the WGSL.

The ticket has five internal stages:

| Stage | Contents | Main sources |
|---|---|---|
| 1. Spectral upsampling and exposure | RGB/XYZ → spectrum (hanatos2025 table), film exposure table, band-pass window, CAT16, auto-exposure, camera RGB → XYZ | *Light, Film, Paper* ch. 1; textbook §1.8, §2.1 |
| 2. Characteristic curves and DIR coupling | two-softplus curves, curve tables, pre-corrected curves f⁰, the effective gamma matrix, inhibitor diffusion | textbook §2.2–2.3 |
| 3. Halation, scatter and grain | convolution in linear exposure, in µm; Poisson–binomial sublayer grain, Selwyn's law, print-size rendering, counter-based random numbers | textbook §2.4–2.5 |
| 4. Development model | push/pull, time and temperature as curve parameters, grain and fog; fitted versus heuristic | textbook §2.2; spektrafilm push profiles |
| 5. RAW integration and composition laws | the end-to-end graph, recipe fields, the laws of §2.8 | textbook §2.8 |

**Out of scope.** Decoding RAW files (CHB-006, which provides a "photo mode" of its LibRaw build); the print chain from film dyes onward (CHB-003); writing WGSL (CHB-005); exporting spektrafilm's profiles and tables (CHB-004); slide (positive) film, camera diffusion filters and lens blur (later; spektrafilm has them).

"The textbook" is `sources/The Mathematics of the Colour Negative.md` in the CHB-001 ticket directory, `ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/` (called C1 below). *Light, Film, Paper* (LFP below) is a second book whose chapter 1 covers stage 1; its text is embedded in `C1/various/extracted/light-film-paper/00-book-data.json` (the `lfp-ch1-01-light.txt` file beside it is empty, so read the JSON's `chapters[0].html`).

## 2. The physics, from first principles

### 2.1 Light, detectors and the null space

Every light, filter and sensitivity is a vector of 81 samples from 380 to 780 nm in 5 nm steps, and every detector computes an inner product: response = Σ spectrum × sensitivity (textbook §1.1, LFP §1.1). A colour film has three light-sensitive layers. The red-sensitive layer forms cyan dye, the green-sensitive layer magenta, the blue-sensitive layer yellow. Each layer k has a sensitivity S_k(λ) (profiles store log₁₀ S_k), so the light reaching the film produces three **layer exposures**, E_k = Σ s(λ) S_k(λ), which spektrafilm calls the film's *raw* values.

The eye works the same way with the CIE colour-matching functions x̄, ȳ, z̄: X = k Σ s x̄ and so on, with k = 1/Σ ȳ = 1/21.371 = 0.046792 on this grid (LFP §1.2). The chromaticity (x, y) is the direction of XYZ and spektrafilm's brightness b = X + Y + Z its length.

Here is the problem the forward path must solve. A RAW photo, after colour conversion, gives three numbers per pixel (XYZ), but film needs a spectrum, because the film's layers do not see like the eye. Portra 400's red-sensitive layer peaks at 645 nm and is far narrower than x̄, which peaks at 600 nm (LFP §1.1). The map from 81 numbers to XYZ is a 3 × 81 matrix of rank 3, so its null space has dimension 78. Any vector n in that null space, a **metameric black**, can be added to a spectrum without changing its XYZ (textbook §1.8, LFP §1.3):

```text
n = v − Aᵀ(AAᵀ)⁻¹ A v        (A: the 3 × 81 CMF matrix)
```

LFP's example adds a metameric black built from a 600/640 nm bump to the spectrum of the ColorChecker patch "moderate red". The two spectra have the same XYZ to 1.8×10⁻¹⁵, yet Portra 400's layers see exposures that differ by −0.61, −0.35 and +0.01 stops. So "the spectrum of a colour" has no single answer, and the answer the simulator picks changes what the film records. The design must pick one spectrum per colour, smoothly and reproducibly.

### 2.2 Two published upsamplers, and spektrafilm's table

**Mallett and Yuksel (2019)** precompute three non-negative basis spectra for the sRGB primaries that sum to exactly 1 at every wavelength. A linear sRGB triple becomes ρ = R·B_r + G·B_g + B·B_b, always between 0 and 1. It is linear and cheap, but every spectrum is a mix of the same three curves (LFP §1.3).

**Jakob and Hanika (2019)** use a sigmoid of a quadratic, f(λ) = S(c₀λ² + c₁λ + c₂) with S(x) = ½ + x/(2√(1 + x²)). It is smooth, bounded in (0, 1), and three coefficients match three tristimulus values. Fitting is a small nonlinear solve: for moderate red under D65, Gauss–Newton from c = 0 converges quadratically to c = (18.46, −11.33, 0.19) in t = (λ − 380)/400, with residual norms 5.6×10⁻¹, 1.1×10⁻¹, 2.4×10⁻², 2.1×10⁻³, 2.1×10⁻⁵, 2.4×10⁻⁹, 3.7×10⁻¹⁶ (LFP §1.3).

The two disagree, and the film notices: over the 18 chromatic ColorChecker patches at equal luminance, Portra 400's layers differ on average by 0.16, 0.11 and 0.53 stops between them (LFP §1.3).

**spektrafilm's default, `hanatos2025`,** is a lookup table provided by Johannes Hanika, not a published method (textbook §1.8). It is indexed by **chromaticity**, not RGB. The reason is that it stores *irradiance* spectra: an irradiance spectrum has no upper bound, so brightness is just a scale factor, and only the direction (x, y) needs a table. Two files ship with spektrafilm:

| File | Shape | Entry |
|---|---|---|
| `hanatos_irradiance_xy_coeffs_250304.lut` | 512 × 512 × 4 float32 | sigmoid coefficients c₀, c₁, c₂ in raw nm and a divisor c₃: f = S(c₀λ² + c₁λ + c₂)/c₃ |
| `irradiance_xy_tc.npy` | 192 × 192 × 81 float16 | the spectra themselves, X + Y + Z ≈ 1 after k |

The shipped spectra were computed from the coefficients on a 1 nm grid from 360 to 800 nm, blurred with a 5 nm Gaussian and resampled; recomputing 400 nodes matches to 4.8×10⁻⁴ relative, within float16's step (textbook §1.8).

**Square coordinates.** Chromaticities fill the triangle x, y ≥ 0, x + y ≤ 1, but an array is a square. `_tri2quad` maps one to the other (LFP §1.4):

```text
u = (1 − x)²,  v = y / (1 − x);        x = 1 − √u,  y = v √u
```

The round trip is exact to 6×10⁻¹⁷ (textbook §1.8). Moderate red at (x, y) = (0.4913, 0.3207) lands at (u, v) = (0.2588, 0.6303): fractional position (49.43, 120.39) in the 192-entry table and (16.30, 39.71) in a 64-entry table. Not every cell is a real colour: (u, v) = (0.2, 0.3) stands for a chromaticity outside the spectral locus. spektrafilm handles out-of-locus inputs with an input gamut compression baked into the film table (`gamut_compression.remap_tc_lut_for_compression`, a Reinhard knee (0, 1, 6) pulling xy radially from the film's white toward the locus).

### 2.3 Folding the film into the table

The film never needs the spectrum, only three exposures, and exposure is linear in the spectrum. So the 81-term inner products can be done once per film, at every table node (LFP §1.5):

```text
raw_k(u, v) = Σ_i spectrum_i(u, v) · S_k(λ_i)          (per film, once)
E_k(pixel)  = b · raw_k(u(x, y), v(x, y))               (per pixel: one 2-D lookup and a multiply)
```

spektrafilm's `compute_hanatos2025_tc_lut` does this on the 192 × 192 grid and `rgb_to_raw_hanatos2025` interpolates it with a 2-D cubic (Mitchell–Netravali) per pixel. Filmbench stores a 64 × 64 table of log₂ raw as int16 × 1024 and interpolates bilinearly (`rgbToRawFn`, `01-inline.js` 154–178). Measured costs of these shortcuts over 2,000 random sRGB colours (LFP §1.5):

| Comparison, error in stops | Mean | 99th pct | Max |
|---|---|---|---|
| 64 × 64 table built from the 192 one vs the 192 one | 0.0012 | 0.0047 | 0.017 |
| int16 rounding of the 64 × 64 table | 0.00047 | | |
| Filmbench's shipped Portra table vs spektrafilm's `tc_lut` | 0.0010 | 0.0034 | 0.0077 |

**The band-pass window.** Before folding, spektrafilm multiplies each film's sensitivities by a window made of two error-function edges, stored per profile (`eval_erf4_spectral_bandpass`):

```text
W(λ) = ½[1 + erf((λ − c_uv)/(σ_uv√2))] · ½[1 − erf((λ − c_ir)/(σ_ir√2))]
```

For Portra 400, c_uv = 433.5, σ_uv = 31.6, c_ir = 593.1, σ_ir = 68.8 nm. The window is 0.144 at 400 nm, 0.632 at 445, 0.90 at 500, 0.735 at 550, 0.225 at 645 and 0.060 at 700 (LFP §1.5, textbook §1.8). Each windowed sensitivity is divided by n_k = Σ S_k W E_ref / Σ S_k E_ref, so the film's reference illuminant keeps exactly its exposures. The window is not small: without it the table differs from spektrafilm's by 0.33 stops on average and 1.23 at most. A second adaptation, a degree-4 polynomial surface over (u, v) applied as 2^surface, exists in the code and is off by default.

**Grey is not quite neutral.** The window keeps the reference illuminant's own spectrum neutral, but a grey pixel reaches the film as the table's smooth spectrum at that chromaticity. With the window, an sRGB 18.4 % grey gives raw = (1.012, 0.989, 0.918), so the blue layer gets 0.124 stops less than the D55 spectrum would (LFP §1.5). That offset is absorbed later by the print's normalisation and balance; it is not a bug.

### 2.4 Chromatic adaptation and the exposure scale

**CAT16.** spektrafilm converts input RGB to XYZ with `colour.RGB_to_XYZ(..., illuminant=film_ref_xy, chromatic_adaptation_transform='CAT16')`: the input's white is adapted to the film's reference illuminant (D55 for Portra 400). CAT16 (Li et al. 2017) is a von Kries transform in a cone-like space, like Bradford but with a different matrix. For sRGB input and D55 the combined matrix is (LFP §1.2):

```text
M_D55 = | 0.4197 0.3744 0.1628 |
        | 0.2131 0.7137 0.0732 |
        | 0.0150 0.0965 0.8099 |
```

Moderate red, linear sRGB (0.5606, 0.0807, 0.1143), becomes XYZ (0.2841, 0.1854, 0.1087), b = 0.5783, (x, y) = (0.4913, 0.3207). A check run for this guide, with the CAT16 matrix of Li et al. and the whites D65 = (0.95047, 1, 1.08883) and D55 = (0.9568, 1, 0.9214), reproduces M_D55 within 1×10⁻⁴.

**The exposure scale.** The film's characteristic curves are tabulated against log₁₀ exposure with a fixed zero: **log H = 0 is the exposure an 18.4 % grey card receives at the film's rated speed** (textbook §2.1). spektrafilm builds this into its sensitivities: the mid-grey's raw exposure is 1, and `filming.expose` ends with `log_raw = log10(max(raw, 0) + 1e-10)`. For a spectrally flat patch the exposure scales with reflectance, so a 90 % white sits at log₁₀(0.90/0.184) = 0.689 and a 3 % black at −0.788 in every layer (§2.1).

Anything that scales every wavelength by the same factor (aperture, shutter, exposure compensation, auto-exposure) adds a constant to every layer's log H: a **shift**. Shifts commute with each other and with every per-channel linear operation (§2.8).

**Auto-exposure.** `utils/autoexposure.measure_autoexposure_ev` computes that shift from the image's luminance Y. Its default, `center_weighted`, averages Y under a Gaussian of σ = 0.2 of the long edge (coordinates normalised so the long edge spans [−0.5, 0.5]) and returns −log₂(Ȳ/0.184) stops, so a frame whose weighted mean is 0.092 is pushed up one stop. Other methods: `average`, `median`, `partial` (a disc of radius 0.15), `matrix` (5 × 5 zones with raised-cosine weights), `multi_zone` (three rings weighted 50/30/20) and `highlight_weighted` (weights Y²). spektrafilm meters on a small preview. Auto-exposure is image-global: the same pixel value maps differently in different frames, so it can never be part of a per-pixel table.

### 2.5 The characteristic curve

A layer's **characteristic curve** f maps log exposure to the dye amount that layer forms. spektrafilm's profiles store it as 256 values over −3…4 log H, and `develop.develop` first subtracts each curve's minimum so the chain sees dye amount above unexposed film (textbook §2.2). `density_curves.interpolate_exposure_to_density` interpolates the table on the axis `log_exposure / gamma_factor`, which evaluates f(g·x): a **gamma factor** g > 1 steepens the curve about log H = 0 and keeps the grey card's density.

For analysis and fitting, `model/parametric.py` has a five-parameter curve, a difference of two base-10 softplus terms, which Chromogen ports with an offset d_min (`stock.js parametric`, `05-inline.js` 418–422):

```text
f(x) = d_min + γ t log₁₀(1 + 10^((x − x₀)/t)) − γ s log₁₀(1 + 10^((x − x₀ − D/γ)/s))
f'(x) = γ [ L((x − x₀)/t) − L((x − x₀ − D/γ)/s) ],     L(u) = 1/(1 + 10^(−u))
```

Read it as a broken line: zero, then a straight part of slope γ starting at the **toe corner** x₀, then flat at D from the **shoulder corner** x₀ + D/γ, with the corners rounded over widths t (toe) and s (shoulder). f' > 0 everywhere, so f is invertible; Newton's method from the straight line, guarded by bisection, inverts it to 10⁻¹². Fitted to Portra 400 over −2.5…3.5 log H (§2.2):

| Layer | γ | x₀ | D | toe t | shoulder s | rms | max |
|---|---|---|---|---|---|---|---|
| cyan (red layer) | 0.557 | −1.24 | 1.99 | 0.46 | 0.39 | 0.009 | 0.020 |
| magenta (green) | 0.501 | −1.41 | 1.79 | 0.34 | 0.45 | 0.005 | 0.014 |
| yellow (blue) | 0.586 | −1.49 | 2.16 | 0.36 | 0.41 | 0.007 | 0.016 |

The fit is good in value and poor in slope: the table's cyan slope at the grey card is 0.488, the fit's straight part 0.557, because the table is the sum of three **sublayer** curves (fast, medium and slow emulsions), each adding a bump. The local slope matters: the inverse of a curve multiplies noise by 1/f'. So the table is the truth for rendering, and the parametric form is for describing and transforming curves (stage 4).

### 2.6 DIR coupling: layers that inhibit each other

In a real negative, developing one layer releases **DIR** (development-inhibitor-releasing) compounds that slow development in the same layer and its neighbours. A red-only exposure therefore forms more cyan than the same red exposure inside a grey, and colours come out more saturated than three independent curves would make them (§2.3).

`model/couplers.py` treats inhibition as a loss of log exposure. With u the layers' log exposures, f the datasheet curves and M a 3 × 3 matrix whose entry M_kj is the log exposure that receiving layer j loses per unit dye formed in donor layer k:

1. develop once without inhibitor: d⁰ = f(u);
2. compute the inhibitor each layer receives: a = Mᵀ d⁰ (`compute_exposure_correction_dir_couplers`);
3. spread it spatially: a ← K ∗ a, with K = 0.94 · Gaussian(20 µm) + 0.06 · exponential(200 µm) (`DirCouplersParams`);
4. develop at the reduced exposure: d = f⁰(u − a).

For negatives, `runtime/params_builder._apply_film_specifics` sets

```text
M = | 0.336 0.353 0.302 |     donor rows R, G, B; receiver columns R, G, B
    | 0.154 0.319 0.353 |
    | 0.168 0.226 0.273 |
```

beside comments "0.42 alpha" and "just eyeballed, optimize!". The schema's defaults (`params_schema.DirCouplersParams`) are a neighbouring set, so a caller that skips `digest_params` gets slightly different values.

**Why f⁰.** The datasheet curve f was measured on a grey ramp and already contains the inhibition a grey suffers. The curves before coupling, f⁰, are defined so that every neutral exposure u = t·1 reproduces the datasheet:

```text
f⁰_j( t − Σ_k M_kj f_k(t) ) = f_j(t)
```

`compute_density_curves_before_dir_couplers` evaluates this as `np.interp(log_exposure, log_exposure − f @ M, f)`: the datasheet curve on a shifted axis. At the grey card the layers receive a = (0.485, 0.663, 0.692) log H of inhibition, 1.6 to 2.3 stops. The ported model reproduces a neutral ramp from −2.5 to +3.0 log H within 0.0012 (§2.3).

**The effective gamma matrix.** The Jacobian of the film stage u ↦ d is Hanson and Horton's 3 × 3 gamma matrix:

```text
J = diag(f⁰'(u − a)) · (I − Mᵀ diag(f'(u)))
J(0) = |  0.610 −0.056 −0.065 |     rows cyan, magenta, yellow dye; columns red, green, blue layer
       | −0.154  0.740 −0.107 |
       | −0.145 −0.171  0.874 |
```

The diagonal is 1.2 to 1.7 times the datasheet slope, the off-diagonals are negative, and each row sums to the neutral slope (0.489, 0.479, 0.558): a grey keeps the datasheet's contrast while colour differences are amplified. In the toe the off-diagonals vanish, because a donor in its toe releases little inhibitor and a receiver in its toe has no slope to lose.

**Before the curve, not after.** Many pipelines imitate this with a density matrix after the curve. That can match J(0) at one point, but with green and blue in the toe at −1.5 log H and red at +1, the coupled model leaves magenta at 0.004 while a matrix after the curve drives it to −0.333: negative dye. A curve does not commute with a linear map (§2.3, §2.8). Chromogen has no DIR model at all (`pipe.uncouple` is the identity).

**Edges.** Because the inhibitor diffuses, near the edge of a red object part of its self-inhibitor spills into the grey neighbour: cyan, 1.399 inside and 0.687 outside, overshoots to 1.484 and undershoots to 0.615 within a few micrometres. This adjacency effect is real film behaviour (§2.3).

All of these numbers can be reproduced from the data we have: a re-implementation written for this guide on Chromogen's copy of the Portra 400 profile reproduces a = (0.485, 0.663, 0.692), J(0) to three decimals with row sums (0.489, 0.479, 0.558), the neutral ramp within 0.0010 and the toe magenta 0.0039.

### 2.7 Scatter and halation: blur light, not logarithms

Silver halide crystals scatter light sideways over a few micrometres, and light that passes through every layer reflects from the back of the base and re-exposes the emulsion over a few tenths of a millimetre. That second effect is **halation**, a red glow around bright sources, red because the red-sensitive layer lies nearest the base (§2.4). Both redistribute light, so both are **convolutions** with a kernel K ≥ 0 of total weight 1; a uniform field is unchanged.

Photons add, and log exposures do not. The convolution must therefore act on exposure **before the logarithm**. `filming.expose` applies highlight boost, diffusion filter, lens blur and `diffusion.apply_halation_um` to the linear `raw` array before `np.log10`. `apply_halation_um` has two passes:

```text
E1 = (1 − w) G_σc ∗ E0 + w X_λt ∗ E0
E2 = ( E1 + a Σ_{k=1..3} w_k G_{σh√k} ∗ E1 ) / (1 + a)
```

G_σ is a Gaussian and X_λ the 2-D exponential e^(−r/λ)/(2πλ²), which `fast_exponential_filter` replaces by three Gaussians: amplitudes (0.1633, 0.6496, 0.1870) at σ = (0.536, 1.5236, 2.7684) λ. The red layer has σ_c = 2.2 µm, λ_t = 9.3 µm, w = 0.78 (green 2.0, 9.7, 0.65; blue 1.6, 9.1, 0.67; `HalationParams`). The bounce weights w_k are 4/7, 2/7, 1/7 (decay 0.5). σ_h = 65 µm for still film and 50 µm for cine, and the strength a comes from the profile's anti-halation tag (`params_builder._HALATION_PRESETS`): (0.015, 0.005, 0) for a strong anti-halation layer such as Portra 400's, (0.08, 0.02, 0) weak, (0.30, 0.10, 0.015) none. Dividing by 1 + a keeps total exposure.

Gaussians compose by adding variances, so the red kernel is a mixture of 16 Gaussians, 98.5 % scatter and 1.5 % halation. On an edge from log H +2.5 (a window, 8.3 stops above the grey card) to −1.0, the dark side's cyan rises from 0.157 to 0.895 at 50 µm, 0.573 at 100 µm and 0.244 at 200 µm; with the weak and absent presets, 0.898 and 1.173 at 100 µm (§2.4).

**Why the order matters.** The logarithm is concave, so Jensen's inequality gives log₁₀(K ∗ E) ≥ K ∗ log₁₀ E, with equality only where E is constant under the kernel. At 50 µm from that edge the two are +0.404 and −0.973 log H. Applied to the dye amounts instead, the same kernel adds only 0.013 at 50 µm: no visible halo. A blur in log or density space is a geometric mean dominated by the dark side; a physical blur is an arithmetic mean dominated by the bright side.

All kernel widths are in **micrometres on the film**. The pixel size on the film, µm per pixel = film format width ÷ image width in pixels, converts them to pixels (`ImageInfo.umPerPx.film` in the contract).

### 2.8 Grain: a Poisson–binomial density

A developed layer is not a continuous dye film but a collection of dye clouds, one per developed crystal, so the dye amount in a small area fluctuates (§2.5). The standard measure, **RMS granularity**, is 1000 × the standard deviation of density through a 48 µm circular aperture at mean density 1.0. **Selwyn's law** says that for a random arrangement of grains the product G = A σ_A² of aperture area and variance does not depend on the aperture once it holds many grains. G is what a model must get right; RMS at 48 µm = 1000 √(G / 1809.6 µm²).

spektrafilm's `grain.layer_particle_model` draws each pixel's dye amount from a two-stage count. With D the pixel's mean dye amount, D_max the layer's maximum, N the crystals per pixel (pixel area over crystal area) and uniformity u near 1:

```text
p = D / D_max,   s = 1 − u p,   n ~ Poisson(N / s),   k ~ Binomial(n, p),   D̂ = k · D_max · s / N
E[D̂] = D,       Var[D̂] = (D_max / N) · D · (1 − u D / D_max)
```

A Poisson count counts independent events (crystals) and has variance equal to its mean; a binomial count is how many of n trials succeed. Binomial thinning of a Poisson count is again Poisson, with mean p N/s. That gives the mean and variance above, reproduced to 0.1 % by a 400,000-pixel Monte Carlo. Because N = pixel area / crystal area, the variance times the pixel area,

```text
G(D) = σ² A_px = a · D_max · D · (1 − u D / D_max)
```

contains no pixel size: the model obeys Selwyn's law at the pixel by construction.

The default path splits each channel into the profile's three **sublayers** (fast, medium, slow) with maxima D_max,i, fractions f_i of the channel's maximum, and crystal areas a_i = 0.2 µm² × (1.6, 1.6, 3.2) per channel × (2, 1, 0.5) per sublayer (`GrainParams`): the fast sublayer has the largest crystals. Summing variances, G = Σ_i D_i D_max,i (a_i/f_i)(1 − u D_i/D_max,i). For Portra 400 this predicts RMS granularities of 9.1, 7.4 and 13.8 for cyan, magenta and yellow at D = 1.0, about 11, 10 and 17 near D = 0.3 (§2.5).

After the counts, spektrafilm blurs each sublayer by √(D_max,i/N_i) pixels, where N_i is the sublayer's crystals per pixel and D_max,i/N_i one crystal's dye amount (this works out to a fixed size in µm, whatever the pixel size), adds a lognormal micro-structure (inactive for pixels above 0.6 µm), subtracts `density_min`, and blurs the sum by `GrainParams.blur` = 0.65 **pixels**. That last blur is the one scale-dependent part: simulated at 1, 2 and 4 µm pixels, the green layer's pixel σ is 0.089, 0.066 and 0.035 while its RMS at 48 µm stays at 7.4, 7.2 and 6.9 (§2.5).

**What "rendered at print size" means.** The model draws one count per pixel, so the grain's apparent size follows the pixel grid it is drawn on, not the film. If the grain is drawn on a 1,100-pixel preview of a 36 mm frame (33 µm pixels) and the print is exported at 6,000 pixels (6 µm pixels), the two show different grain. Filmbench does exactly this: its grain is Gaussian noise at the preview pitch (`01-inline.js` 596–611). Chromobench instead defines grain on a fixed **print-size grid**: the film area divided into the pixels of the intended output. Every view of the frame, at any zoom or tile, samples that one field.

### 2.9 Development: what pushing does

Pushing means underexposing (rating the film at a higher exposure index) and developing longer or hotter to compensate. More development raises contrast (gamma), raises maximum density, adds fog and coarsens grain. There are two kinds of knowledge about this in the sources, and the design must keep them apart:

- **Fitted from data.** spektrafilm ships Portra 800 at normal, push 1 and push 2 as three separate profiles (`model/stocks.py`). For this guide the three were compared on Filmbench's decoded copies: their sensitivities, dye spectra and base are identical; only the curves (and their fitted 3-CDF models) differ. A fit of f_push(x) ≈ f_normal(g·x + s) over −2…2 log H gives:

  | Profile | gamma factor g (R, G, B) | shift s | rms of fit | D_max (R, G, B) | f(0) |
  |---|---|---|---|---|---|
  | normal | 1, 1, 1 | 0 | – | 1.90, 1.73, 2.03 | 0.749, 0.759, 0.752 |
  | push 1 | 1.25, 1.18, 1.24 | −0.02…0.00 | 0.019–0.034 | 2.30, 1.96, 2.26 | 0.751, 0.761, 0.747 |
  | push 2 | 1.38, 1.30, 1.36 | −0.02…0.00 | 0.030–0.061 | 2.52, 2.01, 2.52 | 0.749, 0.761, 0.745 |

  The grey card's dye amount f(0) is unchanged, which suggests the push profiles put log H = 0 at the *pushed* exposure index (5.5 discusses what follows). The rms of 0.02 to 0.06 says a gamma stretch alone does not capture the change; the shoulder rises too.

- **Heuristics.** Chromogen's `developed()` (`stock.js`, `05-inline.js` 466–472) scales gamma by 1 + 0.12·push and shifts the curve by push·log₁₀ 2; its own source calls this a stand-in, and the data above show it underestimates the gamma change (1.12 against about 1.22 at push 1). Filmbench exposes raw `gamma`, `gamma_rgb` and `speed_ev` sliders with no model behind them. Nothing in the sources maps development time or temperature to curves.

### 2.10 Composition laws

Two stages **commute** if either order gives the same result. The textbook checked each of these numerically (§2.8), and each licenses or forbids a shortcut:

| Law | Holds | What it allows or forbids |
|---|---|---|
| shifts in log H compose by addition | exactly | sum exposure compensation and auto-exposure first |
| a per-channel scale commutes with a normalised convolution | exactly | exposure before or after halation |
| a convolution commutes with the logarithm | no (+0.404 vs −0.973 log H at 50 µm) | blur in linear exposure only |
| coupling commutes with the curve | no (magenta 0.004 vs −0.333) | DIR acts before development |
| a curve commutes with a shift | no (+0.1 log H adds 0.021 dye in a highlight, 0.219 at the grey card) | balance in log H, never in density |

The per-channel-scale law has a limit: a 3 × 3 *mixing* of channels commutes with a kernel only if all three channels share the kernel, and halation's strengths differ per layer (0.015, 0.005, 0). Any channel mixing must therefore happen before the kernels, in the spectral exposure step, as spektrafilm's order does. And with diffusion off, the whole film stage is a pointwise map from three log exposures to three dye amounts, which is what makes it tabulable; spektrafilm's `debug.lut_mode` switches off exactly the stages that break this (spatial and random effects, auto-exposure, the highlight boost).

## 3. How CHB-012 fits the system

### 3.1 Domains, ops and recipe

| Op (catalog area `capture` / `film`) | Domain in → out | Class | Binding (contract term), and what it depends on |
|---|---|---|---|
| `capture.sceneXYZ` (proposed) | `camera-linear` → `scene-xyz` | pointwise | `scan`: the source's camera matrix |
| `capture.expose` | `scene-xyz` → `film-logH` | pointwise, plus a global auto-exposure measurement | `stock`: the film table |
| `film.halation` | `film-logH` → `film-logH`, convolved in linear exposure | spatial | `setting`: presets and amount |
| `film.couple` | `film-logH` → `film-logH` (inhibited) | pointwise plus spatial diffusion | `stock`: DIR matrix and curves |
| `film.develop` | `film-logH` → `film-dyes` | pointwise | `setting`: stock curves transformed by development |
| `film.grain` | `film-dyes` → `film-dyes` | spatial, stochastic | `pixel`: one random draw per print-grid pixel |

The recipe's `capture?: { stock: string; exposureEV: number; development: DevelopmentSettings }` (contract §5.4) is the persistent part. This ticket needs a few more fields; they are listed in section 10.

### 3.2 Dependencies

| Ticket | What CHB-012 needs from it | How to proceed before it lands |
|---|---|---|
| CHB-003 | `spectral/` (grid, spectrum, CMF handling, `Stock`, `Curve`, `PhysicsConventions`, `exposeSpectral` for spectra that already exist), CAT matrices in `print/colour.ts`, the laws harness, the print chain after `film-dyes`, the print normalisation that needs the capture path's mid-grey | CHB-003 stage 1 lands first; build on its interfaces |
| CHB-004 | `irradiance_xy_tc.npy` (192² × 81), per-film window and surface parameters, sensitivities, curves, sublayer curves (`density_curves_layers`) and 3-CDF models, push profiles, CMFs, illuminants, input gamut compression locus | interim: Filmbench's 64² Portra tables and profiles (decoded blob), Chromogen st-data curves; the 192² spectra table needs CHB-004 or a one-off export |
| CHB-005 | implements the kernels specified in section 5 | the f64 reference is its oracle |
| CHB-006 | LibRaw "photo mode": demosaiced, black-subtracted linear camera RGB plus colour metadata | test with synthetic camera-linear images made from XYZ and a known matrix |
| CHB-002 | op stubs, recipe fields, `ImageInfo.umPerPx` | write pure functions first; adapters last |

## 4. What exists today and what to take from it

### 4.1 Filmbench's engine `FB` (`C1/various/extracted/filmbench-ide/01-inline.js` 1–701)

Filmbench is a JavaScript port of spektrafilm's forward pipeline, and the nearest thing to CHB-012 that exists.

| Lines | Part | Port, fix or leave |
|---|---|---|
| 154–178 | `rgbToRawFn`: XYZ via `rgb2xyz_cat16[ref]`, (u, v), bilinear 64² log₂ table, × b × 2^speed | port the per-pixel path as the GPU kernel's model; the reference uses the 192² table |
| 181–226 | `filmCurveTables`: min-subtracted curves, gamma per channel, hard-coded DIR matrix, pre-DIR curves by resampling | port; the matrix matches `params_builder` |
| 228–235 | `curveEval`: clamped lookup at x·g | port (same convention as spektrafilm's axis/g) |
| 465 | `mulberry32` | leave for grain (sequential, not tile-safe); fine for the laws harness |
| 468–487 | `autoExposureEv`: five metering modes | port, and add spektrafilm's `matrix` and `multi_zone` |
| 553–576 | `stageExpose` with simplified halation: one Gaussian, blend (1 − s)E + s·(G ∗ E) | **fix**: replace with spektrafilm's scatter + three-bounce halation |
| 578–612 | `stageDevelop`: DIR with one Gaussian diffusion of `diffusion_um`; grain as Gaussian noise × 0.0045·48/pixel_µm × a density modulation | **fix**: add the 6 % exponential tail; replace grain with the Poisson–binomial sublayer model |
| 547–552 | `pixelUmOf`, `needsSpatial`: µm per pixel from `format_mm` | keep the idea; tie grain to the print-size grid |

### 4.2 spektrafilm (upstream, commit `3bb2c2d`, `src/spektrafilm/`)

| Module | Functions to port | Notes |
|---|---|---|
| `utils/spectral_upsampling.py` | `_tri2quad`, `_quad2tri`, `_rgb_to_tc_b`, `eval_erf4_spectral_bandpass`, `compute_hanatos2025_tc_lut`, `rgb_to_raw_hanatos2025`, `rgb_to_raw_mallett2019` | the surface (`eval_poly4_log_exposure_surface`, `hanika_sigmoid`) is off by default; port later |
| `utils/autoexposure.py` | `measure_autoexposure_ev` (seven methods) | |
| `runtime/stages/filming.py` | `FilmingStage.expose` order: rgb → raw, × 2^EV, boost, diffusion filter, lens blur, halation, log; `_compute_density_spectral_midgray_to_balance_print` | the mid-grey density feeds CHB-003's print normalisation |
| `model/density_curves.py` | `interpolate_exposure_to_density`, `interp_density_cmy_layers`, `apply_gamma_shift_correction` | |
| `model/parametric.py` | `parametric_density_curves_model` | used only by tests upstream |
| `model/couplers.py` | `compute_density_curves_before_dir_couplers`, `compute_dir_couplers_matrix`, `compute_exposure_correction_dir_couplers`, `apply_density_correction_dir_couplers` | includes a positive-film path and `high_exposure_couplers_shift` (default 0) |
| `model/develop.py` | `develop` (min-subtract → develop → couple → grain) | |
| `model/diffusion.py` | `apply_halation_um` | |
| `model/grain.py` | `layer_particle_model`, `apply_grain_to_density_layers`, `add_micro_structure` | uses seeded global numpy state; replaced by counter-based draws |
| `utils/fast_gaussian_filter.py` | `fast_exponential_filter` (three-Gaussian fit) | |
| `utils/raw_file_processor.py` | `load_and_process_raw_file`: rawpy postprocess to linear 16-bit ACES2065-1, `no_auto_bright`, gamma (1, 1); white balance as-shot, daylight, tungsten or custom | the model for CHB-006's photo mode and for `capture.sceneXYZ` |
| `runtime/params_schema.py`, `runtime/params_builder.py` | `GrainParams`, `HalationParams`, `DirCouplersParams`; `_HALATION_PRESETS`, `_apply_film_specifics`, `lut_mode` | constants and presets |

### 4.3 Chromogen and the books

- Chromogen's `stock.js` (`C1/various/extracted/chromogen-studio/05-inline.js` 385–475): `Curve` (monotone table, inverse, slope, shift, `scaleGamma`), `parametric`, `developed`. CHB-003 ports `Curve`; CHB-012 uses it.
- Chromogen's Studio halation (`params.js` `halAmt`, 0.30 and 0.08 at Halation 100) and grain (`K.GRAIN_SIGMA` = 0.035) are cheaper approximations; leave them.
- LFP chapter 1 and textbook §1.8, §2.1–2.5, §2.8 are the physics; their numbers are the golden fixtures in section 8.

## 5. Design

### 5.1 Module layout

```text
packages/core/src/film/
  upsample.ts     tri2quad, quad2tri, spectra table, filmTable, window, mallett (comparison)
  camera.ts       cameraToSceneXYZ, white-balance modes
  expose.ts       sceneToLogH, autoExposureEV, mid-grey for the print normalisation
  curves.ts       FilmCurves (table + gamma), parametric fit, push transform
  couple.ts       DIR matrix, f⁰, inhibitor, Jacobian
  halation.ts     kernels in µm, apply in linear exposure
  grain.ts        sublayer split, Poisson sampling, blur, print-size grid
  rng.ts          counter-based hash RNG, Poisson and binomial samplers
  develop.ts      DevelopmentSettings → curve transform (fitted / transfer / heuristic)
  laws/film.laws.ts
fixtures/golden/film/   lfp-ch1.json  ch2.json   (section-tagged)
fixtures/synthetic/     edge frames, ramps, ColorChecker scenes (generated by core)
```

### 5.2 Stage 1: upsampling and exposure

```ts
// packages/core/src/film/upsample.ts and expose.ts (sketch)
export function tri2quad(x: number, y: number): [number, number];   // u = (1−x)², v = y/(1−x), clamped to [0,1]
export function quad2tri(u: number, v: number): [number, number];

export interface SpectraTable { n: 192; data: Float64Array /* n·n·81, X+Y+Z ≈ 1 */ }
export interface FilmWindow { model: 'erf4'; params: [number, number, number, number] }   // c_uv, σ_uv, c_ir, σ_ir (nm)
export function erf4Window(p: FilmWindow['params']): Float64Array;                     // 81 samples

export interface FilmTable {                      // per film × window × gamut compression
  n: number;                                      // 192 in core
  raw: Float64Array;                              // n·n·3 linear raw (not log)
  key: string;
}
export function buildFilmTable(spectra: SpectraTable, stock: Stock, o: {
  window?: FilmWindow; refIlluminant: Spectrum; inputGamutKnee?: [number, number, number] }): FilmTable;
export function resampleFilmTable(t: FilmTable, n: 64 | 128 | 192, store: 'f32' | 'log2-int16'): Float32Array | Int16Array;

export type AdaptMode = 'to-film-reference' | 'none';
export interface ExposeOptions {
  adapt: AdaptMode; sourceWhite: Vec3;            // white of the scene-xyz data (D65 for sRGB or as-shot RAW)
  exposureEV: number; autoEV?: number;            // the shift; autoEV comes from autoExposureEV
  interp: 'cubic' | 'bilinear';
}
export function sceneToRaw(xyz: Vec3, table: FilmTable, refWhite: Vec3, o: ExposeOptions): Vec3;   // linear raw
export function autoExposureEV(Y: Float64Array, w: number, h: number,
  method: 'center_weighted' | 'average' | 'median' | 'partial' | 'matrix' | 'multi_zone' | 'highlight_weighted'): number;
export function midgrayFilmDensity(stock: Stock, table: FilmTable, o: ExposeOptions): Float64Array;  // for CHB-003
```

**Algorithm, per pixel (reference):**

1. If `adapt` is `'to-film-reference'`, apply CAT16 from `sourceWhite` to the film's reference white (profile `meta.refIlluminant`, through the CMFs). If `'none'`, use XYZ as is.
2. b = X + Y + Z; if b ≤ 0 the raw is 0. Otherwise (x, y) = (X/b, Y/b) → (u, v) = `tri2quad`.
3. Interpolate the film table at (u, v): cubic (Mitchell–Netravali, B = C = ⅓, as spektrafilm's `apply_lut_cubic_2d`) in the reference.
4. raw = table × b × 2^(exposureEV + autoEV).
5. Return linear raw. `film.halation` takes the log after its convolution (5.4); `capture.expose` emits log₁₀(raw + 10⁻¹⁰) to match the `film-logH` domain.

**Building the film table (once per film).** `buildFilmTable` contracts the 192² × 81 spectra with the windowed, renormalised sensitivities, multiplies by 2^surface when the surface is enabled, and bakes in the input gamut compression: for each node, decode (u, v) → (x, y), compress (x, y) toward the film's white with the knee (0, 1, 6), re-encode, and sample the uncompressed table there (`remap_tc_lut_for_compression`). In f64 this is 192² × 81 × 3 ≈ 9 million multiply-adds: milliseconds.

**Auto-exposure** is a `measure` node on the scene's luminance at a fixed analysis size (spektrafilm meters a small preview), whose result is an argument of `capture.expose`. The analysis size is part of the node's arguments, because the result depends slightly on it.

**The mid-grey for printing.** CHB-003's normalised enlarger divides by the geometric mean of the paper exposures the film's mid-grey would receive. For a scanned negative the mid-grey is the film developed at log H = 0. For a RAW photo spektrafilm computes it through the capture path: an RGB 0.184 grey through `_rgb_to_film_raw`, the un-normalised curves and the spectral density (`_compute_density_spectral_midgray_to_balance_print`). With the window that grey sits at log₁₀(1.012, 0.989, 0.918) = (0.005, −0.005, −0.037) log H, not zero. `midgrayFilmDensity` provides it, and CHB-003's `Enlarger` takes it as an input for `digital-raw` frames.

#### Decision record: adaptation before exposure

- **Context.** spektrafilm adapts the input's white to the film's reference illuminant (CAT16). That assumes the input is a white-balanced picture whose white should expose the film neutrally. A RAW photo developed with fixed daylight multipliers is closer to colorimetric scene light: a tungsten-lit white is warm in XYZ. Adapting such data treats a scene cast as if it were white balance; for a tungsten-balanced film (reference illuminant T) it would make a tungsten-lit white warmer instead of neutral.
- **Alternatives.** (a) always adapt (spektrafilm); (b) never adapt; (c) adapt only when the input is white balanced.
- **Decision.** (c): `adapt: 'to-film-reference'` for display-referred inputs and RAW photos with as-shot white balance; `'none'` for RAW photos with daylight white balance, so the film records the scene's light as a real camera loaded with that film would.
- **Consequences.** LFP's numbers (M_D55 and the moderate-red trace) are reproduced with `'to-film-reference'`. With `'none'`, casts reach the negative and the print's balance (integrate-to-grey, α = 0.75) removes three-quarters of them, as in a lab. Daylight multipliers map a daylight-lit white to D65, slightly bluer than Portra's D55 balance; the print's aim absorbs that. Status: proposed; the photographer's preference decides the default (section 9).

#### Decision record: table resolution in core and on the GPU

- **Context.** spektrafilm uses 192² with cubic interpolation; Filmbench 64² log₂ int16 bilinear, 0.0012 stops mean error relative to 192² and 0.0077 stops max against spektrafilm.
- **Decision.** The reference builds and interpolates 192² in f64 (cubic). The GPU may use 64² or 192², RGBA32F or RGBA16F, bilinear; the tolerance is stated per choice in the kernel table of 5.6.
- **Consequences.** GPU parity on stage 1 measures table error and is stated in stops. Status: proposed.

**Camera RGB to XYZ (`film/camera.ts`).** CHB-006's photo mode delivers demosaiced, black-subtracted linear camera RGB scaled to the white level, with no white balance applied, plus LibRaw's colour metadata: the camera-to-sRGB matrix (`rgb_cam`, 3 × 4 in LibRaw to allow four-colour sensors; the first three columns for RGB cameras), the as-shot multipliers (`cam_mul`) and the daylight multipliers (`pre_mul`).

```ts
export interface CameraColour { rgbCam: Mat3; asShot: Vec3; daylight: Vec3; make: string; model: string }
export type WhiteBalance = 'daylight' | 'as-shot' | { temperature_K: number; tint: number };
export function cameraToSceneXYZ(rgb: Vec3, cam: CameraColour, wb: WhiteBalance): Vec3;
// XYZ(D65-referred) = M_sRGB→XYZ · rgbCam · diag(wb multipliers normalised to green) · rgb
```

spektrafilm's `raw_file_processor` asks rawpy for linear 16-bit ACES2065-1 output with `no_auto_bright` and gamma (1, 1), and applies non-as-shot white balance afterwards with a von Kries adaptation from a daylight reference. Doing the matrix in `core` instead of inside LibRaw keeps it inspectable and lets the recipe choose the white balance without re-decoding. A camera matrix is itself a 3 × 3 approximation of the camera's spectral response (the Luther condition does not hold for real cameras), so camera RGB → XYZ → spectrum chains two metamer choices; that is a known limit, not a bug to fix here.

### 5.3 Stage 2: curves and DIR coupling

```ts
// packages/core/src/film/curves.ts and couple.ts (sketch)
export interface FilmCurves {                       // datasheet curves, min-subtracted (spektrafilm convention)
  logH: Float64Array;                               // 256 over −3…4
  f: [Float64Array, Float64Array, Float64Array];
  gamma: Vec3;                                      // evaluate at g·x
  at(k: 0 | 1 | 2, x: number): number; slope(k: 0 | 1 | 2, x: number): number; inverse(k: 0 | 1 | 2, d: number): number;
}
export interface Parametric { gamma: number; x0: number; D: number; toe: number; shoulder: number; dmin: number }
export function parametric(p: Parametric, x: number): number;
export function parametricSlope(p: Parametric, x: number): number;
export function parametricInverse(p: Parametric, y: number): number;      // Newton + bisection, 1e-12
export function fitParametric(curve: FilmCurves, k: 0 | 1 | 2, range: [number, number]): Parametric & { rms: number; max: number };

export interface Dir { M: Mat3; amount: number; diffusion: { sigma_um: number; tail_um: number; tailWeight: number }; positive: boolean }
export function dirForStock(stock: Stock): Dir;                           // params_builder values per film type
export function precorrectedCurves(c: FilmCurves, dir: Dir): FilmCurves;  // f⁰ via interp on the shifted axis
export function inhibitor(u: Vec3, c: FilmCurves, dir: Dir): Vec3;        // a = Mᵀ f(u)  (silver = dmax − d for positives)
export function effectiveGamma(u: Vec3, c: FilmCurves, c0: FilmCurves, dir: Dir): Mat3;  // closed-form J
```

**Splitting `film.couple` and `film.develop`.** The catalog has both ops. `film.couple` computes u − K ∗ (Mᵀ f(u)) and emits **inhibited log exposure** (domain `film-logH`), exactly the textbook's stage C (§2.1). `film.develop` applies a curve to log exposure. Which curve depends on whether coupling happened upstream: f⁰ after coupling, f without it. Applying f after coupling, or f⁰ without coupling, silently changes every neutral.

#### Decision record: the curve choice is an explicit argument

- **Context.** `film.develop` must know whether its input was coupled.
- **Alternatives.** (a) merge couple and develop into one op; (b) mark coupled images in `ImageInfo`; (c) give `film.develop` an argument `curves: 'datasheet' | 'precorrected'` that the recipe compiler sets.
- **Decision.** (c). The compiler always emits the pair together; the DSL and the agent get `film.develop` with `curves` defaulting to `'datasheet'`, and a law checks that couple-then-develop(precorrected) reproduces every neutral.
- **Consequences.** Nodes stay hash-consed and inspectable (the agent can look at inhibited exposure); a mismatched pair is a visible argument, not a hidden state. Status: proposed.

**Inhibitor diffusion** is a convolution of the correction field a (in log H units, linear in the dye formed), so it is not subject to the "blur before log" rule: the inhibitor is a concentration, and spektrafilm blurs it as such. Kernel: (1 − 0.06) · Gaussian(20 µm) + 0.06 · exponential(200 µm), the exponential as three Gaussians. At full resolution on 35 mm (about 6 µm pixels) the tail's widest Gaussian has σ ≈ 2.77 × 200/6 ≈ 92 pixels; the GPU should compute the tail at reduced resolution, as the Studio does for wide kernels (textbook §4.3).

### 5.4 Stage 3: halation, scatter and grain

```ts
// packages/core/src/film/halation.ts (sketch)
export interface HalationSpec {
  scatter: { core_um: Vec3; tail_um: Vec3; tailWeight: Vec3; amount: number; scale: number };
  halation: { strength: Vec3; sigma_um: Vec3; bounces: 3; decay: 0.5; amount: number; scale: number; renormalise: true };
}
export function halationForStock(stock: Stock): HalationSpec;          // _HALATION_PRESETS by (use, antihalation)
export function applyHalation(logH: Float64Array, w: number, h: number, umPerPx: number, s: HalationSpec): Float64Array;
// inside: E = 10^u − 1e-10 → scatter → halation → log10(max(E, 0) + 1e-10)
export function edgeResponse(s: HalationSpec, layer: 0 | 1 | 2, bright_logH: number, dark_logH: number, r_um: number): number;
// exact 1-D step response as a sum of normal CDFs (textbook halation.py); used by tests
```

`film.halation` reads and writes `film-logH`, so it exponentiates, convolves in linear exposure and takes the log again. The law of 2.7 (Jensen) checks that the convolution really happened in linear exposure.

#### Decision record: halation keeps the `film-logH` domain

- **Context.** The catalog has `capture.expose` emit `film-logH`, but halation must act on linear exposure.
- **Alternatives.** (a) a new domain `film-exposure` (linear); (b) convolve inside `film.halation` between an exponential and a logarithm.
- **Decision.** (b). The log is invertible, the cost is two transcendental functions per pixel, and the GPU fuses them away.
- **Consequences.** No contract change. The Jensen law with a mutant that convolves u directly guards the implementation. Status: proposed.

**Grain.**

```ts
// packages/core/src/film/grain.ts and rng.ts (sketch)
export interface GrainSpec {
  particleArea_um2: number;            // 0.2
  channelScale: Vec3;                  // (1.6, 1.6, 3.2)
  sublayerScale: Vec3;                 // (2, 1, 0.5): fast, medium, slow
  uniformity: Vec3;                    // (0.97, 0.99, 0.97)
  densityMin: Vec3;                    // (0.03, 0.03, 0.03)
  dyeCloudBlur: number;                // 1.0 → σ = √(D_max,i a_i / f_i) µm
  finalBlur_px: number;                // 0.65, in pixels of the print-size grid
  amount: number; seed: number;
}
export interface PrintGrid { long_px: number; umPerPx: number }            // the print-size grid
export function sublayerSplit(d: number, k: 0 | 1 | 2, stock: Stock): Vec3;   // interp through density_curves_layers
export function grainField(dyes: Float64Array, w: number, h: number, region: Box,
                           grid: PrintGrid, stock: Stock, s: GrainSpec): Float64Array;
export function rmsGranularity48(stock: Stock, s: GrainSpec, k: 0 | 1 | 2, D: number): number;   // closed form

export function hash4(x: number, y: number, z: number, w: number): [number, number, number, number]; // pcg4d, u32
export function uniform(key: Uint32Array, counter: number): number;       // [0, 1) from hash of (key, counter)
export function poisson(lambda: number, key: Uint32Array): number;        // exact; counter-based
```

**One Poisson draw instead of two.** Binomial thinning of a Poisson count is Poisson, so k ~ Poisson(p·N/s) has exactly the distribution of spektrafilm's two-stage draw. The reference and the GPU draw one Poisson variate per (pixel, channel, sublayer), and D̂ = k · D_max · s/N. This halves the random numbers and the branches on the GPU.

**Counter-based random numbers.** A sequential generator such as mulberry32 gives a different grain field whenever pixels are visited in a different order: per tile, per GPU workgroup or per preview region. A **counter-based** generator computes each random number as a hash of its coordinates instead. Use the pcg4d hash of Jarzynski and Olano (2020) on the key (print-grid x, print-grid y, channel·4 + sublayer, seed ⊕ draw counter). It uses only 32-bit integer multiply, add, xor and shift, so JavaScript (`Math.imul`, `>>> 0`) and WGSL produce bit-identical uniforms:

```ts
// film/rng.ts (sketch; check the constants against Jarzynski & Olano 2020, listing for pcg4d)
export function pcg4d(v: Uint32Array): void {          // v: length 4, updated in place
  for (let i = 0; i < 4; i++) v[i] = (Math.imul(v[i], 1664525) + 1013904223) >>> 0;
  v[0] = (v[0] + Math.imul(v[1], v[3])) >>> 0; v[1] = (v[1] + Math.imul(v[2], v[0])) >>> 0;
  v[2] = (v[2] + Math.imul(v[0], v[1])) >>> 0; v[3] = (v[3] + Math.imul(v[1], v[2])) >>> 0;
  for (let i = 0; i < 4; i++) v[i] = (v[i] ^ (v[i] >>> 16)) >>> 0;
  v[0] = (v[0] + Math.imul(v[1], v[3])) >>> 0; v[1] = (v[1] + Math.imul(v[2], v[0])) >>> 0;
  v[2] = (v[2] + Math.imul(v[0], v[1])) >>> 0; v[3] = (v[3] + Math.imul(v[1], v[2])) >>> 0;
}
```

**Poisson sampling.** For λ below about 30, inversion by sequential search of the cumulative distribution (bounded loop); above, Hörmann's transformed-rejection method PTRS (1993), which needs on average about 1.3 uniform pairs. Do not use spektrafilm's `fast_stats` shortcut of a rounded normal above λ = 30: its total-variation distance from Poisson(30) is 0.023 (textbook §4.6). Crystal counts per sublayer are small at print-size pitch (at 6 µm pixels the fast red sublayer's crystal area is 0.2 × 1.6 × 2 = 0.64 µm², so N_i is a few tens), so the inversion branch dominates.

**The print-size grid.** `PrintGrid` is the film area divided into the pixels of the intended output; the default is the source's native resolution, and section 10 proposes a recipe field to set it. Grain is defined on this grid, and its random key is the grid coordinate. Rendering then works like this:

1. **Export or 1:1 view.** Evaluate on the print grid directly: each pixel's grain comes from its own key, independent of tiling. A tile rendered alone equals the same region of a full render, bit for bit in the uniforms.
2. **Downscaled preview.** Rendering the full grid and averaging is exact but costs the full resolution. The cheaper path draws grain at the preview pitch with N scaled to the preview pixel's area (Selwyn's law makes the variance correct), using the preview grid's own keys. The preview then has the right statistics but not the same realisation; the UI should say "grain preview" below 1:1.

#### Decision record: grain realisation versus statistics

- **Context.** Photographers judge grain at 1:1 and expect the export to match. Rendering the full grid for every preview is too expensive on large frames.
- **Alternatives.** (a) grain at preview pitch only (Filmbench); (b) always the print grid, averaged down; (c) print grid at 1:1 and above, statistically matched grain below.
- **Decision.** (c), with (b) available for small frames and for tests.
- **Consequences.** Zoomed views and exports agree exactly; overviews agree statistically. A later refinement could split counts hierarchically (a coarse Poisson count divided among children by binomial draws) so that coarse previews are exact aggregates of the print grid; record that as a possible extension. Status: proposed.

The final 0.65-pixel blur is in pixels of the print-size grid, which fixes its physical size per recipe. The dye-cloud blur √(D_max,i a_i/f_i) is already in µm.

### 5.5 Stage 4: the development model

```ts
// packages/core/src/film/develop.ts (sketch)
export interface DevelopmentSettings {           // recipe capture.development (contract §5.4 names the type)
  push_stops: number;                            // −1 … +3; exposure index = box speed × 2^push
  time_factor?: number;                          // developer time relative to nominal; experimental
  temperature_C?: number;                        // relative to the process nominal; experimental
}
export interface CurveTransform { gamma: Vec3; shift_logH: Vec3; dmaxScale: Vec3; fog_D: Vec3; grainScale: number;
                                  basis: 'measured' | 'interpolated' | 'transferred' | 'heuristic' }
export function developmentTransform(stockId: string, s: DevelopmentSettings, data: PushData): CurveTransform;
export function applyTransform(c: FilmCurves, t: CurveTransform): FilmCurves;   // then recompute f⁰
```

The model maps settings to a curve transform and records **where the transform came from**, so the UI and the agent can say "measured" or "guess":

| Basis | When | What it does |
|---|---|---|
| `measured` | the stock has a profile for this exact push (Portra 800 push 1, push 2) | use that profile's curves |
| `interpolated` | fractional push between measured profiles | interpolate the 3-CDF parameters (centres, amplitudes, sigmas) of the two neighbouring profiles, re-evaluate the curves |
| `transferred` | other stocks | apply Portra 800's measured change per stop (gamma factors and D_max ratios from 2.9) to this stock's curves; marked as transferred |
| `heuristic` | pull, time, temperature | documented formulas with no data behind them (below) |

Three rules hold in every basis. First, the transform acts on the datasheet curves f, and f⁰ is **recomputed** from the transformed f, so the neutral-reproduction law keeps holding (spektrafilm's push profiles are datasheet curves measured with coupling). Second, `exposureEV` is measured from the exposure index the photographer rated: the push profiles keep the grey card at log H = 0, which means their log H axis is referred to the pushed index. A photographer who rates Portra 800 at 1600 and pushes one stop sets `push_stops` = 1 and `exposureEV` = 0; the extra contrast and the thinner shadows come from the curves, not from an exposure shift. (Chromogen's `developed()` expresses the same speed gain as a curve shift of push·log₁₀ 2 on the box-speed axis.) This reading of the profiles is inferred from f(0) being unchanged; check it against the push curves in Kodak's Portra 800 datasheet before relying on it. Third, the heuristic parts are visible: `time_factor` and `temperature_C` are mapped to an equivalent push only after someone anchors the mapping to Kodak's published push times for C-41; until then the controls are hidden or marked experimental. Pull processing, fog and grain under push have no data in the sources: the proposed defaults are no fog change, grain parameters unchanged (the Poisson model already raises relative noise in the thinner shadows of a pushed frame), and pull as the mirror of push's gamma change, labelled `heuristic`.

### 5.6 Stage 5: the RAW photo path end to end

The recipe compiler (CHB-002) turns a `digital-raw` frame into this graph:

```text
source.open (006, photo mode)                       camera-linear, + CameraColour metadata
  └─ capture.sceneXYZ { wb }                         scene-xyz
       └─ measure.stats { luminance, analysis size } ──► autoEV
       └─ capture.expose { stock, exposureEV, autoEV, adapt }   film-logH (umPerPx.film set from format)
            └─ film.halation { stock presets, amount }                 film-logH
                 └─ film.couple { M, diffusion }                       film-logH (inhibited)
                      └─ film.develop { curves: 'precorrected', development }   film-dyes
                           └─ film.grain { print grid, seed, amount }  film-dyes
                                └─ print.expose … (CHB-003, with midgrayFilmDensity for normalisation)
```

`capture.expose` must set `ImageInfo.umPerPx.film` from the frame format (the film's long edge in µm divided by the image's long side in pixels); every spatial op after it reads that value. The forward path's `film-dyes` image has three channels; the fourth-channel residual exists only on the inversion path (CHB-003).

**Pointwise collapse.** With halation, DIR diffusion and grain off, everything from `scene-xyz` to `film-dyes` is pointwise and depends only on settings bound per stock and per development. CHB-005 can then fuse it into one kernel, or tabulate it, exactly as spektrafilm's `lut_mode` does.

**GPU kernel specifications.** The reference functions above are the oracles; the GPU computes in f32.

| Kernel | Inputs | Output | Binding | Notes and tolerance against the reference |
|---|---|---|---|---|
| `filmTable` | built on the CPU by `buildFilmTable`, uploaded | RGBA32F n² (n = 64 or 192) | per film × window | upload only; no GPU build needed |
| `expose` | camera-linear or scene-xyz texture; uniforms: camera matrix · wb · (CAT16), EV | linear raw RGBA32F | per pixel | bilinear on the GPU vs cubic in core: ≤ 0.005 stops at the 99th percentile and ≤ 0.02 stops max for 64², stated per table size |
| `halation` | linear raw, µm/px | linear raw | spatial | separable Gaussians (scatter core, three exponential Gaussians, three bounces); with the same kernel truncation as core (state it in the spec), relative error ≤ 10⁻⁵ |
| `develop0` | log raw | d⁰, then a = Mᵀ d⁰ | pointwise | 1-D curve tables (512 entries over −3…4); ≤ 10⁻⁴ dye |
| `inhibitorBlur` | a | a | spatial | Gaussian 20 µm full resolution; 200 µm tail at reduced resolution; ≤ 10⁻⁴ log H interior, seams excluded by halo |
| `develop` | log raw, blurred a | dyes | pointwise | f⁰ table; ≤ 10⁻⁴ dye |
| `grain` | dyes, print-grid origin, seed | dyes | spatial, stochastic | uniforms bit-identical to core; Poisson counts identical except where f32 and f64 compare a CDF boundary differently (≤ 10⁻⁴ of draws); statistics: mean within 3σ/√n, variance within 2 %, G at 48 µm within 3 % |

## 6. One flow traced end to end: "moderate red" on Portra 400

The input is the ColorChecker patch "moderate red" as linear sRGB, as LFP follows it, on Portra 400, `adapt: 'to-film-reference'`, exposure 0 EV, no auto-exposure, uniform patch (so halation and inhibitor diffusion leave it unchanged).

1. **RGB to XYZ, adapted to D55.** (0.5606, 0.0807, 0.1143) through M_D55 → XYZ (0.2841, 0.1854, 0.1087) (LFP §1.2).
2. **Brightness and chromaticity.** b = 0.5783; (x, y) = (0.4913, 0.3207).
3. **Square coordinates.** (u, v) = ((1 − 0.4913)², 0.3207/0.5087) = (0.2588, 0.6303); table position (49.43, 120.39) at 192², (16.30, 39.71) at 64² (LFP §1.4).
4. **Table lookup.** Filmbench's windowed 64² entry: log₂ raw = (2.116, −0.131, 0.255) (LFP §1.5). For comparison, LFP reports raw = (2.933, 0.604, 1.145) for the same patch with the table spectrum and bare (unwindowed) sensitivities.
5. **Scale by brightness.** raw = 2^entry × 0.5783 = (2.506, 0.528, 0.690): in stops relative to grey, (+1.33, −0.92, −0.54). The red-sensitive layer gets 2.5 times the grey card's exposure.
6. **Log exposure.** u = log₁₀ raw = (0.3990, −0.2774, −0.1612).
7. **Halation.** A uniform patch is unchanged by a normalised kernel. (At the patch's edges it would not be.)
8. **First development and inhibitor** (computed for this guide on Chromogen's copy of Portra 400's curves, min-subtracted): d⁰ = f(u) = (0.8925, 0.5787, 0.7768); a = Mᵀ d⁰ = (0.5195, 0.6752, 0.6859).
9. **Final development.** d = f⁰(u − a) = (0.9867, 0.4557, 0.7116). Compared with no coupling, cyan rose by 0.094 and magenta and yellow fell by 0.123 and 0.065: the red is more saturated, which is what DIR coupling is for.
10. **Spectral density.** D(λ) = b + Σ d_j ε_j: 1.6226 at 450 nm, 1.1412 at 550 nm, 1.2505 at 650 nm.
11. **Grain.** Adds a zero-mean fluctuation on the print-size grid, with the variance formula of section 2.8 applied per sublayer.
12. **Hand-off.** The `film-dyes` image enters `print.expose` (CHB-003).

For a sanity check on the same path, an sRGB 18.4 % grey gives raw = (1.012, 0.989, 0.918) with the window (LFP §1.5), and with a uniform flat spectrum instead of a table spectrum it would give exactly 1 in every layer.

Steps 8–10 are derived values, not textbook numbers. Store them in fixtures with `"source": "derived"` and regenerate them from the first implementation that passes the textbook's DIR goldens.

## 7. Implementation plan

**Stage 1: spectral upsampling and exposure.**

- Files: `film/upsample.ts`, `film/expose.ts`, `film/camera.ts`, `fixtures/golden/film/lfp-ch1.json`, the CAT16 matrix in CHB-003's `print/colour.ts`.
- Build `tri2quad`/`quad2tri`, the erf4 window, `buildFilmTable` from the 192² spectra (from CHB-004, or a one-off conversion of `irradiance_xy_tc.npy`), cubic and bilinear lookup, `sceneToRaw`, all seven auto-exposure methods, `cameraToSceneXYZ`, `midgrayFilmDensity`, Mallett–Yuksel for comparison.
- Done when: M_D55, moderate red's XYZ, (u, v), table positions, raw and stops, the window values, the grey raw (1.012, 0.989, 0.918), the textbook's normalisers and centroid shifts, and the 64²-versus-192² error table reproduce; the four LFP laws pass.

**Stage 2: curves and DIR.**

- Files: `film/curves.ts`, `film/couple.ts`.
- Build `FilmCurves` with gamma as axis stretch, the parametric curve, its slope, Newton inverse and least-squares fit; `dirForStock`, `precorrectedCurves`, `inhibitor`, the closed-form `effectiveGamma`; the spatial inhibitor kernel; positive-film path behind a flag.
- Done when: the Portra 400 fit table (§2.2) reproduces within 0.005 in each parameter, a, J(0), row sums, neutral ramp ≤ 0.0012, toe magenta 0.004 versus −0.333 for the matrix-after-curve mutant, and the edge overshoot 1.484/undershoot 0.615 reproduce.

**Stage 3: halation and grain.**

- Files: `film/halation.ts`, `film/grain.ts`, `film/rng.ts`.
- Build kernels in µm, exact edge response, `applyHalation` with exp/log around it; pcg4d, uniforms, Poisson sampler; sublayer split; `grainField` on the print grid; `rmsGranularity48`.
- Done when: the edge numbers (0.895, 0.573, 0.244; presets 0.898, 1.173) reproduce; Jensen holds and its mutant fails; grain variance matches the closed form within 1 % on 400,000 pixels; RMS 9.1, 7.4, 13.8 at D = 1.0; tile-independence: a 256-pixel tile equals the same region of a full render exactly.

**Stage 4: development model.**

- Files: `film/develop.ts`, push data in CHB-004's pack.
- Build the four bases, recompute f⁰ after transforming, label the basis in the result.
- Done when: `measured` reproduces the push profiles exactly; `interpolated` at push 1 from push 0 and push 2 is within 0.03 rms of the push 1 profile; neutral reproduction holds after every transform.

**Stage 5: RAW integration and laws.**

- Files: op adapters for `capture.*` and `film.*` in `engine-ref.ts`, `film/laws/film.laws.ts`, `fixtures/synthetic/`.
- Done when: a synthetic RAW (XYZ chart × known camera matrix) renders end to end through the reference engine to a print; the composition laws pass with mutants caught; conformance passes for the new ops.

## 8. Testing and acceptance

### 8.1 Golden numbers

Fixtures follow CHB-003's format and tolerance rule (tol = 0.6 × 10⁻ᵏ for k printed decimals). Conventions: LFP numbers use Filmbench's data and `adapt: 'to-film-reference'`; textbook chapter 2 numbers use spektrafilm's Portra 400 profile.

**Stage 1 (LFP chapter 1, textbook §1.8, §2.1):**

| Quantity | Value | Source |
|---|---|---|
| k = 1/Σȳ | 0.046792 (Σȳ = 21.371) | LFP §1.2 |
| D65; D55 white | (0.9504, 1, 1.0888), xy (0.3127, 0.3290); (0.9568, 1, 0.9214), xy (0.3324, 0.3474) | LFP §1.2 |
| M_D55 | matrix in 2.4 | LFP §1.2 |
| moderate red XYZ, b, xy | (0.2841, 0.1854, 0.1087), 0.5783, (0.4913, 0.3207) | LFP §1.2 |
| metameric pair, moderate red | XYZ equal to 1.8×10⁻¹⁵; layers −0.61, −0.35, +0.01 stops (bare), −0.34, −0.52, +0.02 (window); max α 0.437 | LFP §1.3 |
| Jakob–Hanika fit, moderate red, D65 | target (0.2807, 0.1852, 0.1291); c = (18.46, −11.33, 0.19); residuals in 2.2 | LFP §1.3 |
| Mallett–Yuksel vs table spectra, 18 patches | mean 0.16, 0.11, 0.53 stops (bare); 0.084, 0.049, 0.073 (window) | LFP §1.3, §1.5 |
| (u, v) and table positions | (0.2588, 0.6303); (49.43, 120.39) at 192; (16.30, 39.71) at 64 | LFP §1.4 |
| table entry at (u, v) = (0.3, 0.5) | X + Y + Z 1.011; xy (0.4544, 0.2748) vs (0.4523, 0.2739) | LFP §1.4 |
| ColorChecker round trip through the 192 table | chromaticity ≤ 0.0034 (mean 0.0015); brightness ≤ 1.7 %; moderate red back (0.2884, 0.1878, 0.1090) | LFP §1.4 |
| tri2quad round trip | 6×10⁻¹⁷ | textbook §1.8 |
| window, Portra 400 | 0.144 @400, 0.632 @445, 0.90 @500, 0.735 @550, 0.225 @645, 0.060 @700 nm | LFP §1.5, textbook §1.8 |
| window normalisers under 5,500 K | (0.336, 0.739, 0.480); red centroid 624.2 → 612.5 nm, blue 430.8 → 447.2 nm | textbook §1.8 |
| window effect on patches (5,500 K) | neutrals unchanged; foliage (0.062, 0.011, 0.107); sky (0.015, −0.018, −0.056) | textbook §1.8 |
| window off vs on | 0.33 stops mean, 1.23 max | LFP §1.5 |
| 18.4 % grey raw (window) | (1.012, 0.989, 0.918); table spectrum vs D55: +0.018, −0.015, −0.124 stops | LFP §1.5 |
| moderate red raw | bare (2.933, 0.604, 1.145); log₂ entry (2.116, −0.131, 0.255); raw (2.506, 0.528, 0.690); stops (+1.33, −0.92, −0.54) | LFP §1.5 |
| table interpolation errors | table in 2.3 | LFP §1.5 |
| flat patches | 90 % white 0.689, 3 % black −0.788 log H | textbook §2.1 |
| auto-exposure | weighted mean 0.092 → +1 stop | textbook §2.1 |
| metameric black on skin | (0.017, 0.009, 0.040) log H | textbook §1.8 |

**Stage 2 (textbook §2.2–2.3):** the parametric fit table; derivative against central differences 8×10⁻¹¹, Newton inverse 10⁻¹²; table inverse within 6.4×10⁻⁴ log H; cyan slope at grey 0.488 vs γ 0.557; magenta parametric f(0) and f'(0) against the table's 0.704 and 0.494 (exercise 1); M; a = (0.485, 0.663, 0.692); s = (0.33, 0.45, 0.47) and uninhibited slopes 0.73, 0.87, 1.03; neutral ramp within 0.0012; J(0) and row sums (0.489, 0.479, 0.558); B (unit diagonal: −0.076, −0.076 / −0.245, −0.118 / −0.255, −0.244) matching J(0) to 0.011; toe magenta 0.004 vs −0.333; edge cyan 1.399/0.687 with overshoot 1.484 and undershoot 0.615.

**Stage 3 (textbook §2.4–2.5):** 16-Gaussian kernel, 98.5 % / 1.5 %; edge cyan 0.157 → 0.895 (50 µm), 0.573 (100 µm), 0.244 (200 µm), 0.05 above the dark level out to 224 µm; weak and absent presets 0.898 and 1.173 at 100 µm; density-domain excess 0.013 at 50 µm; Jensen pair +0.404 vs −0.973; grain variance formula (Monte Carlo within 0.1 %); Portra 400 RMS 9.1, 7.4, 13.8 at D = 1.0 and about 11, 10, 17 near 0.3; G from 0.017 µm²·D² at one pixel to 0.091 at 96 µm against 0.098; pixel σ 0.089, 0.066, 0.035 at 1, 2, 4 µm with RMS 7.4, 7.2, 6.9.

**Derived for this guide** (store as `"source": "derived"`): push fit table (2.9); moderate red DIR trace (section 6, steps 8–10).

### 8.2 Laws

| Law | Statement | Mutant |
|---|---|---|
| metamerism | `xyz(metamericBlack(v))` = 0 to rounding | project with the film sensitivities instead of the CMFs |
| square round trip | `quad2tri(tri2quad(x, y))` = (x, y) inside the triangle | drop the square root |
| linear in brightness | doubling XYZ doubles all three raw values | add an offset before the log |
| window keeps white | the reference illuminant's exposures are the same with and without the window | skip the renormalisation |
| shifts compose | expose(EV₁) then shift EV₂ = expose(EV₁ + EV₂) | apply EV after the curve |
| scale commutes with halation | exposure scale before or after `applyHalation` is identical | renormalisation removed |
| Jensen | log₁₀(K ∗ E) ≥ K ∗ log₁₀ E pointwise, equality on uniform areas; halation output satisfies it | convolve u directly |
| uniform invariance | halation, DIR diffusion and the grain mean leave a uniform field unchanged | kernel not normalised |
| neutral reproduction | couple(t·1) then develop(precorrected) = f(t) within the table error, for t in [−2.5, 3] | develop with `'datasheet'` after coupling |
| non-negative dyes | for any u, coupled development gives d ≥ 0 | density matrix after the curve |
| grain mean and variance | E[D̂] = D, Var as the formula, within Monte Carlo error | two independent draws per pixel (variance doubles) |
| Selwyn | G = σ²A constant between 48 and 96 µm apertures within 3 % | grain σ not scaled with pixel area |
| tile independence | rendering a region alone equals the same region of a full render | sequential RNG |
| push neutrality | after any development transform, neutral reproduction still holds | transform f⁰ instead of f |

### 8.3 Parity, fixtures and failure checks

- **Parity:** tolerances in the kernel table of 5.6 are stated before the GPU exists. CHB-005 compares against `core` on: random colours (stage 1), ramps and edge targets (stages 2–3), grain statistics on uniform fields at five densities.
- **Fixtures:** interim profiles (Filmbench decoded blob for Portra 400, 800 and the push profiles, with 64² tables and window parameters; Chromogen st-data curves); the 192² spectra table (CHB-004); the 24 ColorChecker linear sRGB values (Filmbench's `CC24`, `01-inline.js` 1104; moderate red is entry 9, (0.5606, 0.0807, 0.1143)); synthetic frames: an edge from +2.5 to −1.0 log H, a red object on grey, a grey ramp −2.5…3.0, uniform fields at D = 0.3, 1.0, 1.8.
- **Can the tests fail?** Every law has its mutant above, run in CI. For grain, the statistical tests use fixed seeds and pre-stated tolerances; run them once with the mutant (two draws per pixel) to confirm the variance test fails.

## 9. Risks, open questions and decisions

**Decisions the photographer settles:**

1. **What "digital RAWs" means** (architecture §8.4): camera photos, camera scans of negatives, or both. This decides whether CHB-012 comes before the beta.
2. **Default white balance for RAW photos:** `'daylight'` with `adapt: 'none'` (casts reach the film, as with a real film camera) or `'as-shot'` with adaptation (neutral input, as spektrafilm does). The design supports both; only the default is open.

**Blocking for stage 4:** the time and temperature mapping needs a published source (Kodak's C-41 push recommendations). Without it those controls stay experimental.

**Risks:**

- The 192² spectra table is 192 × 192 × 81 float16 (about 6 MB); CHB-004 must ship it, and its licence must be checked (it comes from hanatos via spektrafilm).
- `density_curves_layers` is a separate profile array in spektrafilm (`profiles/io.py`); it appears to be the per-sublayer terms of the fitted model, but verify that during export before relying on it.
- spektrafilm's DIR matrix is labelled "just eyeballed"; it is the best available, and stock-specific matrices would need calibration exposures (textbook §3.8: coupling cannot be read from one frame).
- The final 0.65-pixel grain blur ties grain to the print-size grid; a recipe that changes the output size changes the grain. That is physically right for a print of a different size, but the UI must make it visible.
- The Mitchell–Netravali interpolation of spektrafilm approximates rather than interpolates (it returns f + h²f''/9 at nodes, textbook §4.2); for exact parity with spektrafilm's `tc_lut` lookups, the reference must use the same kernel.
- Camera matrices from LibRaw are approximations, and camera RGB → XYZ → spectrum compounds metamer choices.

## 10. Proposed contract additions (for CHB-002)

1. **Op `capture.sceneXYZ`** (area `capture`, `camera-linear` → `scene-xyz`, pointwise, binding `scan`), with args `wb: enum('daylight', 'as-shot') | {temperature_K, tint}`.
2. **`SourceInfo.camera?: CameraColour`** filled by CHB-006's photo mode: `rgbCam`, `asShot`, `daylight`, make, model.
3. **Recipe `capture` fields:** `whiteBalance`, `adapt: 'to-film-reference' | 'none'`, `autoExposure: { method, analysisLongSide_px } | 'off'`, `format: { longEdge_mm: number }` (sets `umPerPx.film`), `film: { halation: number; dir: number; grain: { amount: number; seed: number }; printGrid?: { long_px: number } }`.
4. **`DevelopmentSettings`** as sketched in 5.5, and a read-only `basis` in the evaluation result so the UI can say "measured", "interpolated", "transferred" or "heuristic".
5. **`film.develop` argument `curves: 'datasheet' | 'precorrected'`**, set by the compiler whenever `film.couple` precedes it.
6. **Determinism of stochastic ops:** the conformance suite's determinism test should state that `film.grain` is a pure function of (inputs, seed, print grid, region), independent of tiling.

## 11. References

**Books in C1:** *The Mathematics of the Colour Negative* (`sources/`): §1.1, §1.8 (upsampling, window, conversions), §2.1 (exposure, auto-exposure), §2.2 (curves), §2.3 (DIR), §2.4 (halation), §2.5 (grain), §2.8 (composition laws), §3.8 (limits), §4.2–4.6 (tables, blurs, random variates). *Light, Film, Paper* chapter 1 (`various/extracted/light-film-paper/00-book-data.json`, chapter 1 HTML): §1.1–1.6.

**Code in C1:** `various/extracted/filmbench-ide/01-inline.js` 1–701 (notably 154–178, 181–235, 465–487, 547–612); `various/extracted/filmbench-ide/00-film-data.bin.txt` with `scripts/06-decode-filmbench-film-data.py`; `various/extracted/chromogen-studio/05-inline.js` 385–475 (`stock.js`); `various/extracted/chromogen-studio/st-data/cg/stocks/`; `various/analysis-filmbench-ide.md`; `design-doc/01-chromobench-architecture-and-work-plan.md`.

**spektrafilm** (`github.com/andreavolpato/spektrafilm`, commit `3bb2c2d`, `src/spektrafilm/`): `utils/spectral_upsampling.py`, `utils/autoexposure.py`, `utils/raw_file_processor.py`, `utils/fast_gaussian_filter.py`, `utils/fast_interp_lut.py`, `utils/gamut_compression.py`, `runtime/stages/filming.py`, `runtime/params_schema.py`, `runtime/params_builder.py`, `model/couplers.py`, `model/density_curves.py`, `model/parametric.py`, `model/develop.py`, `model/diffusion.py`, `model/grain.py`, `model/stocks.py`, `profiles/io.py`.

**Literature:** Jakob and Hanika, "A Low-Dimensional Function Space for Efficient Spectral Upsampling", CGF 2019; Mallett and Yuksel, "Spectral Primary Decomposition for Rendering with sRGB Reflectance", EGSR 2019; Li et al., "Comprehensive color solutions: CAM16, CAT16, and CAM16-UCS", Color Research & Application 2017; Hanson and Horton, "Subtractive color reproduction: interimage effects", JOSA 1952; Dainty and Shaw, *Image Science*, ch. 2 (Selwyn's law); Newson et al., "Realistic film grain rendering", IPOL 2017; Jarzynski and Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020; Hörmann, "The transformed rejection method for generating Poisson random variables", Insurance: Mathematics and Economics 12, 1993; Salmon et al., "Parallel random numbers: as easy as 1, 2, 3", SC 2011 (counter-based generators).
