---
Title: 'Intern guide: Scan-to-print physics reference in f64 JavaScript'
Ticket: CHB-003
Status: active
Topics:
    - color-science
    - film-emulation
    - image-pipeline
    - testing
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/design-doc/01-chromobench-architecture-and-work-plan.md
      Note: contracts, domains, op catalog and package paths this ticket implements
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: Chapters 1-3 and 4.2-4.7 give the physics, golden numbers and laws this ticket must reproduce
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/chromogen-studio-1.2/samples/gold200.png
      Note: real Gold 200 scan for the class-percentage acceptance tests
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-chromogen-studio.md
      Note: module map and known bugs of the Studio, to verify against the code
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/05-inline.js
      Note: Chromogen library to port (142-932), model.js tables (1620-1901), params.js lights (2087-2193), classify (2538-2543), grey pick (4222-4257)
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/cg/stocks/kodak_portra_400.json
      Note: interim stock data for the running example (sensitivities, unit dyes, base with nulls, curves)
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/00-film-data.bin.txt
      Note: embedded data blob with tabulated CIE 1931 CMFs, illuminants, dichroic filters, neutral filter database and 3-CDF paper models
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/01-inline.js
      Note: 'Filmbench engine FB: filtered lamp, 3-CDF paper curves and morph, mid-grey normalisation, scan and view stage order'
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:22.322243552-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Scan-to-print physics reference in f64 JavaScript

## 1. What this ticket builds, and why it comes first

Chromobench prints colour negatives and camera RAW files through a simulated colour darkroom. Every picture the photographer sees is the end of a chain of physical maps: light passes through dyes, a paper is exposed and develops, the print reflects a viewing light into the eye. CHB-003 writes that chain, from a scanned negative to the colour on the screen, as plain JavaScript in 64-bit floating point (f64), in the package `@chromobench/core` (`packages/core/`).

This package has three jobs, and each one explains a design choice in this guide:

1. **It is the source of truth.** When the GPU engine (CHB-005), the DSL (CHB-007) or the agent (CHB-008) disagree about a number, `core` decides. That is why it is written for clarity and precision, not speed, and why every textbook number it can reproduce becomes a test.
2. **It is the oracle for the GPU.** CHB-005 builds 33³ tables and WGSL kernels that must match `core` within stated tolerances. `core` therefore also exports f64 builders of exactly the tables the GPU uses, so the two can be compared node by node.
3. **It is a working engine.** The `reference` engine in `packages/core/src/engine-ref.ts` implements the shared `Engine` interface from `@chromobench/contract`. It renders slowly but correctly without a GPU, which is what tests, headless agent runs and the conformance suite need.

The ticket has three internal stages, and this guide follows them:

| Stage | What it adds | Textbook |
|---|---|---|
| 1. Spectral core and channels | wavelength grid, typed spectra, channel densities, the 3×3 matrix K, metameric blacks, the sigmoid spectrum | Chapter 1 |
| 2. Print chain | enlarger exposure, printer lights, paper curves, preflash, reflectance, viewing, flare, adaptation, gamut knee, encoding | Chapter 2, §2.6–2.9 |
| 3. Inversion | scanner model, closed-form Jacobian, bounded Levenberg–Marquardt with active set, reachability classes, integrate-to-grey, grey pick | Chapter 3 |

**Out of scope.** These belong to other tickets, and `core` only provides hooks or pure functions for them:

- the forward film path from a scene to a negative (DIR coupling, halation, grain, spectral upsampling): CHB-012, which lives in the same package under `packages/core/src/film/`;
- the real enlarger (exposure time, f-stop, dichroic head, multi-exposure masks): CHB-010. CHB-003 only defines the `'real'` mode hook;
- decoding files, flat fields, rebate picking, measuring noise σ and the frame-wide classification map: CHB-006;
- GPU tables and kernels: CHB-005;
- the stock data packs and the exporter from spektrafilm: CHB-004;
- 16-bit files and ICC profiles: CHB-011;
- Saunderson's physical paper reflectance: CHB-015;
- black-and-white materials: CHB-014.

The textbook used throughout is `sources/The Mathematics of the Colour Negative.md` in the CHB-001 ticket directory, `ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/` (called C1 below). Section numbers such as §1.4 refer to it. It runs two examples through every chapter: a computed Portra 400 frame whose grey card has dye amounts c = (0.687, 0.704, 0.864), and a real Kodak Gold 200 scan. This guide reuses both.

## 2. The physics, from first principles

This section teaches what you need before reading the design. Each idea comes with the textbook's own numbers, because those numbers become your tests.

### 2.1 A spectrum is a vector, and a measurement is an inner product

Light, a filter's transmittance and a sensor's sensitivity are all functions of wavelength λ. Chromobench stores every one of them as a vector of **81 samples from 380 to 780 nm in 5 nm steps** (§1.1). spektrafilm uses the same grid (`SPECTRAL_SHAPE = colour.SpectralShape(380, 780, 5)`), and so does Chromogen (`new Grid(380, 780, 5)`).

Every detector does the same thing to a spectrum: it multiplies by its sensitivity and adds up. If a light E(λ) passes through film of transmittance T(λ) onto a sensor channel k of sensitivity Q_k(λ), the signal is

```text
r_k = Σ_i E(λ_i) · T(λ_i) · Q_k(λ_i) · Δλ
```

Everything except the film, P_k(λ) = E(λ) Q_k(λ), is the channel's **responsivity**. Divide by the signal with no film in the gate (T = 1) and the step Δλ and the absolute power both cancel:

```text
r_k / r_k(open) = Σ_i w_ki · T_i,     w_ki = P_k(λ_i) / Σ_j P_k(λ_j)
```

The weights w_ki are non-negative and sum to one. A relative signal is therefore a weighted mean of transmittance. Chromogen's `Channels` constructor normalises each responsivity this way once (`05-inline.js` 484–494), so all later formulas ignore Δλ.

The grid is good enough: recomputing the running example on 1, 5 and 10 nm grids changes densities by a few thousandths at 5 nm (0.0011 to 0.0055) except for printing density, where the paper's steep blue sensitivity meets a steep dye edge (0.0188). The rule from §1.1 is that the grid must resolve the steepest factor in the product.

A spectrum also has a **kind**: power, reflectance, transmittance, density or responsivity. The kind prevents the two commonest errors. Transmittances multiply and densities add, so multiplying two densities or adding two transmittances is refused. Chromogen enforces this in `Spectrum.mul` and `Spectrum.add` (`05-inline.js` 252–263). `toDensity` clamps a transmittance at 10⁻⁸, so zero transmittance reads as 8 D instead of infinity.

Scalars get the same treatment through units. A density (unit `D`) and a log exposure (unit `logH`) are different quantities. One stop is log₁₀ 2 = 0.30103 log H, and one printer point is 0.025 log H. Adding a density to a log exposure is an error, because only a characteristic curve maps between them (`units.js`, `05-inline.js` 142–216). The contract (`Unit` in `packages/contract/src/domains.ts`) uses the same rules.

### 2.2 Density, Beer–Lambert, dye amounts and the base

At one wavelength, a thin slice of an absorber removes a fixed fraction of the light that reaches it. Integrating through the layer gives the **density** D = −log₁₀ T, proportional to the amount of absorber (§1.2). When several absorbers share the light path, transmittances multiply and densities add.

A colour negative holds three dyes, cyan, magenta and yellow. Its **spectral density** at each wavelength is

```text
D(λ) = c_C·ε_C(λ) + c_M·ε_M(λ) + c_Y·ε_Y(λ) + b(λ),     T(λ) = 10^(−D(λ))
```

The ε_j are the stock's **unit dye spectra** (the spectral density of one unit of dye j), the c_j are the **dye amounts** in those units, and b(λ) is the **base**: support, orange mask and fog, present everywhere. Three numbers per pixel plus fixed spectra per stock describe a developed negative completely.

A concrete check from §1.2: the grey card at c = (0.687, 0.704, 0.864) has, at 550 nm, cyan −0.0264, magenta 0.888, yellow 0.0022 and base 0.6024, which sum to 1.4662. The cyan term is negative because Portra 400's unit dye spectra dip slightly below zero. That is a property of the processed profile data, and every program uses the spectra as they are.

**Missing data.** Profiles have holes. Portra 400 has no base density at 380–395 nm and from 705 nm up (20 wavelengths, stored as `null` in Chromogen's JSON), and the dye spectra have 7 or 8 missing samples. What a missing sample means is a modelling choice with large consequences (§2.6 of the textbook; section 5.2 below):

- spektrafilm reads a missing density as **opaque**: `utils/conversions.density_to_light` sets the transmitted light to zero where it is `NaN`.
- Chromogen reads it as **zero density**: `stock.js` maps `null` to 0 (`05-inline.js` 448–459).

For Portra 400 on Portra Endura paper, 27 % of the lamp-weighted red paper sensitivity lies at 705 nm and above. The two conventions therefore differ by 0.18 log H in the red printing layer, and spektrafilm's neutral filter database (C 0, M 51.57, Y 52.53 for this pair) is right for one convention and 20 CC wrong for the other.

### 2.3 A channel density is a soft minimum

A **channel density** is the density a channel reads, the negative log of its relative signal (§1.3):

```text
D_k = −log₁₀ Σ_i w_ki · 10^(−D_i)
```

This is Chromogen's `Channels.read` (`05-inline.js` 496–503), three lines of code. It is a weighted **soft minimum** of the spectral density over the channel's band. Two bounds follow from convexity: the channel density lies between the minimum of D over the band and the weighted mean of D. With two wavelengths of equal weight at densities 0 and 2, the channel reads 0.297, close to log₁₀ 2.

Four families of responsivity matter (§1.3):

| Family | Responsivity P_k | Source |
|---|---|---|
| **Status M** | Hunt Table 14.1, log₁₀ of the product at 10 nm steps, peak 5.000; interpolated in log and exponentiated | `statusM()`, `05-inline.js` 526–538 |
| **APD** (Academy printing density) | SMPTE ST 2065-2, tabulated 368–728 nm at 2 nm | `apd()`, 539–547 (its data file is missing from the Studio build) |
| **Printing density** | printer lamp × paper sensitivity (Giorgianni & Madden Eq. 8.1) | `printing()`, 548–554 |
| **Scanner density** | light × filter × sensor (G&M Eq. B.4); one light per channel for sequential LED capture | `scanner()`, 555–559 |

The running example has two illustrative scanners: narrowband LEDs at 660, 530 and 450 nm and a white LED, both behind Chromogen's generic Bayer camera (`st-data/cg/cameras/generic-bayer.json`, `st-data/cg/lights/white-led.json`). The grey card through the narrowband green channel has a weighted mean transmittance of 0.02895, a density of **1.538** (§1.1). Through the white-LED red channel it reads 0.876 against a weighted mean of 0.940, because the transmitted light comes mostly from the trough near 600 nm between the magenta and cyan peaks (§1.3).

**Derivatives.** Differentiating with respect to one dye amount gives

```text
∂D_k/∂c_j = Σ_i w̃_ki ε_j(λ_i),     w̃_ki = w_ki 10^(−D_i) / Σ_l w_kl 10^(−D_l)
```

The slope is the mean of the unit dye spectrum under the **transmitted-light weight** w̃: the light that actually gets through this piece of film into channel k. The second derivative is −ln 10 times a covariance of the dye spectra under w̃, so the Hessian is negative semidefinite and D_k is **concave** in the dye amounts. Doubling a dye less than doubles its channel density. For the white-LED red channel at the grey card the Hessian's eigenvalues are −0.364, −0.024 and −0.0001 (§1.3).

### 2.4 The matrix K is a Jacobian, and how it is built matters

Three channel densities and three dye amounts suggest a linear system D ≈ K c. The textbook's central point in Chapter 1 is that **K is a Jacobian**, the matrix of first derivatives at some reference point, and that the matrix Chromogen builds is a different thing (§1.4).

Chromogen's `Channels.analytical` (`05-inline.js` 508–511) follows Hunt's "analytical densities": it reads each unit dye spectrum alone through each channel. That is the slope of the chord from zero to one unit of dye, a **secant**. By concavity the chord lies below the tangent. Through a broadband channel the difference is large, because a unit of cyan alone leaves the band's green side open, while in a real grey the magenta closes it. For the white-LED camera (§1.4):

```text
K_secant  = | 0.253 0.330 0.013 |      K_tangent(0) = | 0.360 0.476 0.013 |
            | 0.036 0.749 0.032 |                     | 0.055 0.950 0.058 |
            | 0.007 0.118 0.592 |                     | 0.007 0.243 0.837 |
```

The base matters too. Subtracting the rebate's channel density is exactly the same as reading the dyes alone through a different channel, whose responsivity is the original multiplied by the base's transmittance and renormalised (§1.6). In the narrowband case this hardly matters; through the white-LED camera the base is darkest at 400–550 nm and reweights each broad channel toward its long-wavelength side. The repair is to take the Jacobian at zero dye **through the base-weighted responsivity**. This is simply the closed-form Jacobian of the full forward model (base included) evaluated at c = 0.

How well the four constructions solve the grey card linearly through the white-LED camera (§1.6):

| How K is built | Error in (c_C, c_M, c_Y) |
|---|---|
| each unit dye alone, no base (Chromogen, `facts.py`) | (0.407, 0.093, 0.459) |
| each unit dye on top of the base, rebate subtracted | (0.225, 0.198, 0.503) |
| Jacobian at zero dye, no base | (0.006, −0.083, 0.006) |
| **Jacobian at zero dye, base-weighted** | **(−0.003, −0.035, 0.000)** |

These numbers are reproducible from the data we already have. An independent re-implementation written for this guide, run on Chromogen's unpacked stock, camera and LED files (`C1/various/extracted/chromogen-studio/st-data/cg/`), gives the secant to four decimals as (0.2526 0.3298 0.0129 | 0.0361 0.7485 0.0323 | 0.0068 0.1178 0.5917), the four error rows above exactly, and the base-weighted K as (0.456 0.350 0.013 | 0.107 0.856 0.039 | 0.008 0.275 0.803). Note that 0.7485 is printed as 0.749 in §1.4 and 0.748 in §3.2: the textbook's three-decimal values are rounded once or twice, which sets the tolerance rule for golden fixtures in section 8.

How much a linear solve amplifies measurement errors is set by K's **singular values**. The narrowband secant has 1.226, 1.144 and 1.130 (condition number 1.09); the white-LED camera has 0.853, 0.571 and 0.213 (condition number 4.00). The smallest belongs almost entirely to cyan, so an error of 0.01 D in the matching direction becomes 0.047 of cyan (§1.4).

### 2.5 Metameric blacks and the sigmoid spectrum

Going from three numbers back to 81 is ill-posed. With A the 81×3 matrix of a light times the colour-matching functions, any p with Aᵀp = 0 can be added to a reflectance without changing its colour. Such a p is a **metameric black**, and projection gives one from any perturbation (§1.8):

```text
p_black = p − A (AᵀA)⁻¹ Aᵀ p
```

On the skin patch, a sine of amplitude 0.08 and period 200 nm, projected this way, leaves XYZ unchanged to four decimals but changes Portra 400's layer log exposures by (0.017, 0.009, 0.040). This is why the forward path (CHB-012) must choose spectra carefully. CHB-003 provides the projection and Jakob and Hanika's **sigmoid** spectrum family, R(λ) = S(c₀u² + c₁u + c₂) with S(x) = ½ + x / (2√(1 + x²)) and u = (λ − 380)/400. A flat reflectance r has c₀ = c₁ = 0 and c₂ = (2r − 1)/(2√(r(1 − r))), which is −0.816 for the 18.4 % grey card. Chromogen's `sigmoid()` is at `05-inline.js` 317–322.

### 2.6 Printing: the paper is a second film

An enlarger shines a lamp L(λ) through a filter pack F(λ) and the negative onto colour paper, whose three layers have sensitivities s_k^p(λ). The paper's log exposure in layer k is the inner product again (§2.6):

```text
x_k = log₁₀ Σ_λ L(λ) · F(λ) · 10^(−D(λ)) · s_k^p(λ) · Δλ  +  ℓ_k
```

The ℓ_k are the **printer lights**: one log-exposure offset per paper layer. Labs count them in **printer points** of 0.025 log H (US 6,985,253, col. 4), so +4 points of red is +0.1 log H in the red-sensitive layer.

Three facts about this formula shape the design:

1. **Lights factor out of the spectral sum.** A light multiplies the whole sum, so x(D, ℓ) = x(D, 0) + ℓ exactly (§2.8 measures an error of 2×10⁻¹⁶). The expensive part, negative to paper exposure, can be tabulated once, and every light-like control is free per pixel.
2. **Balance in log exposure, never in density.** Adding a constant density to the print is not the same as shifting the paper's exposure, because the paper's curve bends. On a 3,800 K cast, printer lights fitted on the grey card leave at most 2.4 CIEDE2000 units of error along a grey scale, while a density shift fitted on the same card leaves up to 14.6 and tints the paper white (§3.6). Chromogen's `Lights.shift` refuses a density with a message citing Hunt 14.17 (`05-inline.js` 809–819).
3. **Filters are almost, but not quite, lights.** spektrafilm models a dichroic filter of v CC units as transmittance 10^(−v/100) in its blocking band. If each band covered one paper layer, 1 CC would be −0.01 log H; real edges overlap, and the derivative at the neutral pack is diagonal only to within a fifth (§2.6).

spektrafilm also **normalises** the exposure: `printing._compute_exposure_factor_midgray` divides every paper exposure by the geometric mean of the three exposures the film's mid-grey would receive. The mid-grey's mean paper log H is then exactly 0 whatever the filters, so a filter change moves colour and not density. With that normalisation the columns of ∂x/∂v sum to zero (§2.6). Chromobench calls this the **normalised** mode of the enlarger. The alternative, **real** mode, keeps absolute exposure (lamp power, time, aperture) and is CHB-010's subject.

### 2.7 Paper curves, grade and preflash

The paper's characteristic curve maps paper log exposure x to paper dye amount. spektrafilm's `develop.develop_print_morph` evaluates a fitted model rather than the tabulated curve: per channel, three normal distribution functions,

```text
c_p(x) = Σ_{i=1..3} A_i · Φ((x − μ_i) / σ_i)
```

which stays within 0.0034 of the table (§2.6). The **gamma morph** (`utils/morph_curves.py`) divides each μ_i and σ_i by a gamma factor g, so c_p(x) becomes c_p(g·x), a stretch about x = 0 that keeps the mid-grey fixed. σ is floored at 0.05. The morph has separate factors for the fast and slow sublayers and per channel, and a "developer exhaustion" option that blends in a Gumbel distribution and re-centres by root finding. Filmbench ports all of it in `paperCurves` (`01-inline.js` 237–282).

At the grey card, Portra Endura forms paper dye (0.665, 0.548, 0.499) with slopes 2.36, 1.98 and 1.95, about four times the negative's. Chained through the film (slope near 0.5), the printing step and the paper, one stop of scene exposure moves the print's visual density by 1.33 × 0.301 = **0.40**: the print is a second film whose high gamma undoes the negative's low one (§2.6).

**Preflash** adds a uniform exposure through the film base before or after the main exposure: x ↦ log₁₀(10^x + φ). It lifts the toe and leaves the rest (§2.6). spektrafilm computes φ from the base alone and the (filtered) lamp (`printing._compute_raw_preflash`); Chromogen's `paperX` uses φ = 0.35 · p/100 · 10^(g − 0.6) for a Preflash slider p and the grey card's paper exposure g (`05-inline.js` 2119, 2165).

### 2.8 Viewing: reflectance, the eye, flare, adaptation, the knee

**Reflectance.** Both code bases turn the print's spectral density into reflectance as if it were transmission, R(λ) = 10^(−D_p(λ)). Paper data are Status A reflection densities, so this single-pass formula reproduces the measured neutrals: paper white reflects Y = 0.813 of a 5,000 K light and the densest black is 2.37 (§2.7). The physical double-pass model with Saunderson's surface correction is CHB-015.

**The eye.** The colour-matching functions x̄, ȳ, z̄ are three responsivities that define CIE XYZ. Under a viewing light E_v, X = k Σ E_v R x̄, with k = 1 / Σ E_v ȳ so that a perfect white has Y = 1. Chromogen uses a fitted multi-lobe Gaussian approximation of the CMFs (`spectrum.js`, `05-inline.js` 324–337); spektrafilm uses the CIE 1931 tables. Chromobench uses the tables (decision in 5.2).

**Flare.** Room light reflected from the print surface adds a little white everywhere. Giorgianni and Madden (App. E) add p_f/100 of the white's reflectance at the flare light's chromaticity. Their example: with white at density 0.12 and 1 % flare, density 2.0 becomes 1.7548 and 1.0 becomes 0.9682. Flare compresses the shadows and leaves the highlights: the Studio's default of 0.48 % of paper white moves the densest black from 2.37 to 2.09 and the slope at the grey card from 1.33 to 1.30 (§2.7).

**Adaptation.** A display shows D65 white, while the print was viewed under, say, 5,000 K. A **chromatic adaptation** maps one white onto the other. Bradford's method (Chromogen's `colour.adapt`, `05-inline.js` 912–915) transforms XYZ to cone-like responses, scales each by the ratio of the two whites' responses and transforms back. The grey card's print XYZ = (0.1706, 0.1750, 0.1686) under 5,000 K adapts to (0.1664, 0.1754, 0.2131), becomes linear sRGB (0.164, 0.177, 0.199) and encodes as (0.441, 0.457, 0.483), the colour **#70757b** (§2.7).

**The gamut knee.** Values outside the display's RGB cube must be brought in, and a hard clip changes hue. spektrafilm's primitive is the **Reinhard knee** on a normalised distance d (§2.7, `utils/gamut_compression.py`):

```text
d' = t + s · n / (1 + n^p)^(1/p),   n = (d − t)/s,   s = ℓ − t
```

the identity below a threshold t, asymptotic to the limit ℓ. With (t, ℓ, p) = (0, 1, 6), d = 0.5, 0.8, 1 and 2 become 0.4987, 0.770, 0.891 and 0.997. A knee does not commute with a gain: a gain of 1.25 after the knee sends 0.9 to 1.048, outside the cube the knee had just guaranteed. **The knee must be the last colour operation before encoding** (§2.7–2.8).

### 2.9 Inversion: from a scan back to dyes

A scanner reads film through three channels with responsivities P_k = light × filter × sensor (§3.1). Given absolute scanner densities d (the scan's density above the rebate plus the stock's own base reading), the **dye solve** looks for c with D(c) = d. Two facts make it a bounded least-squares problem instead of root-finding (§3.2): dye amounts are physical, so c lies in a box 0 ≤ c_j ≤ 4; and d can lie outside the set of densities the box can produce, because of noise, flare or a wrong profile. So the solver minimises F(c) = ‖D(c) − d‖² over the box, and √F, the **residual** in D, says how far the pixel is from anything the film can make.

The Jacobian has a closed form that shares all its work with the residual:

```text
J_kj = Σ_λ P_k T ε_j / Σ_λ P_k T,     T(λ) = 10^(−(b + Σ_j c_j ε_j))
```

One pass over the 81 wavelengths computes both (`solve.js evalF`, `05-inline.js` 682–717). At the grey card through the white-LED camera J = (0.447 0.320 0.014 | 0.160 0.724 0.033 | 0.013 0.336 0.728) (§3.2).

**Levenberg–Marquardt (LM).** Gauss–Newton linearises r(c + Δ) ≈ r + JΔ and solves the normal equations JᵀJ Δ = −Jᵀr. LM adds damping, (JᵀJ + μD) Δ = −Jᵀr: small μ gives the Gauss–Newton step, large μ a short steepest-descent step. Chromogen damps with μ(1 + A_ii), a mix of Levenberg's identity and Marquardt's diagonal, and steers μ by accept-or-reject: if F fell, accept and divide μ by 3; otherwise multiply μ by 4 and retry, up to 12 tries (§3.3).

**The active set.** If the best answer has a dye at zero, clipping each step into the box makes LM creep along the bound. The fix (Bertsekas's projected Newton step) holds a dye whose bound is pushing it outward, with gradient g_j > 0 at c_j = 0 or g_j < 0 at c_j = c_max, and solves for the free dyes alone (§3.4). It made Chromogen's 33³ table 5.4 to 6.8 times faster and is never worse beyond the tolerance except at one node.

**Reachability classes.** A residual says a pixel does not fit, not why. Chromogen's `classify` (`05-inline.js` 2538–2543) puts each channel's density above the rebate in units of that channel's noise, z_k = D_k/σ_k, and tests the smallest with Z = 3: below base if min z < −3, blank film if min z ≤ 3, out of gamut if the residual exceeds 0.01 D, otherwise ok (§3.5).

**Grey balance.** Printer lights should be chosen so that something prints neutral. Without a known grey, **integrate-to-grey** sets the lights from the frame's large-area transmission density (LATD) in the paper's bands, correcting the overall density in full and colour by a fraction α (default 0.75): ℓ = ℓ_aim + m + α(Δ − m), with Δ the frame's LATD minus the aim's and m its mean (§3.6, Hunt 16.7).

## 3. How CHB-003 fits the system

### 3.1 Where it sits

```text
                ┌──────────────── @chromobench/contract (CHB-002) ────────────────┐
                │ Domain, Unit, OpDef, ArgSpec, Engine, FrameRecipe, Mutation     │
                └───────────────┬─────────────────────────────────────────────────┘
                                │ implements Engine ('reference')
  ┌─────────────────────────────▼──────────────────────────────────────────────────┐
  │ @chromobench/core                                                              │
  │  spectral/  grid, spectrum, units, channels, linalg, cmf, illuminants   (st.1) │
  │  print/     enlarger, lights, paper, view, colour, gamut, balance       (st.2) │
  │  scan/      scanner, forward, solve, classify                           (st.3) │
  │  tables/    f64 builders of the GPU's tables (oracle for CHB-005)              │
  │  film/      upsample, couple, curves, halation, grain, develop       (CHB-012) │
  │  laws/      harness + suites                                                   │
  │  engine-ref.ts                                                                 │
  └──────▲───────────────────────────▲─────────────────────────────▲───────────────┘
         │ StockData, Spectra        │ σ, rebate T, flare f        │ tables + tolerances
  @chromobench/data (CHB-004)  @chromobench/ingest (CHB-006)  @chromobench/gpu (CHB-005)
```

The physics modules under `spectral/`, `print/` and `scan/` are **pure functions over typed arrays**. They do not import `@chromobench/contract`. Only `engine-ref.ts` and the op adapters import the contract. This lets you start before CHB-002 has frozen its types, and it keeps the physics testable in isolation.

### 3.2 Domains and ops

The textbook's chain, written with the contract's domain names:

```text
camera-linear ──(006: scan.flatField, scan.rebate, scan.density, scan.flare)──► scanner-density
scanner-density ──invert.dyes──► film-dyes (+ residual)          ── invert.classify ──► classes
film-dyes ──print.expose──► paper-logH ──print.lights──► paper-logH ──print.preflash──► paper-logH
paper-logH ──print.develop──► paper-dyes ──view.reflect──► print-xyz ──view.flare──► print-xyz
print-xyz ──view.adapt──► print-xyz (display white) ──output.display──► display-rgb
```

CHB-003 implements these catalog ops in the reference engine: `invert.dyes`, `invert.classify`, `print.expose`, `print.lights`, `print.preflash`, `print.develop`, `view.reflect`, `view.flare`, `view.adapt`, `output.display`, and the physics parts of `measure.densitometer` and `measure.stats`. `output.encode` (files) belongs to CHB-011, which calls `core`'s encoding functions.

### 3.3 Dependencies and mocks

| Ticket | Relationship | How to proceed in parallel |
|---|---|---|
| CHB-002 contract | CHB-003 implements its `Engine` and op stubs | write physics first; engine adapter last; propose additions (section 10) |
| CHB-004 data | supplies stocks, CMFs, illuminants, filters, APD, Status A | use **interim data** from CHB-001 (below) behind the same `StockData` interface |
| CHB-005 GPU | consumes `core` as oracle, tables and tolerances | export `tables/` early in stage 3 so CHB-005 can compare |
| CHB-006 ingest | supplies σ, rebate transmittance, flare fraction, Gold 200 decode | reimplement the 10-line Gold 200 loader in test utils until CHB-006 lands |
| CHB-010 darkroom | implements `'real'` enlarger mode and filter fast path | CHB-003 defines `RealExposureModel` with a stub |
| CHB-012 forward | shares `spectral/`, `Curve`, laws harness | publish stage 1 early; CHB-012 builds on it |

**Interim data.** Two decoded sources exist in C1 today. Chromogen's `st-data/cg/stocks/*.json` has 8 films and 3 papers (sensitivities, unit dye spectra, base, 256-point curves) plus the illustrative camera and white LED, all on the 81-point grid. Filmbench's embedded blob (`various/extracted/filmbench-ide/00-film-data.bin.txt`, decoded by `scripts/06-decode-filmbench-film-data.py`) has the tabulated CIE 1931 CMFs, illuminants D50/D55/D65/TH-KG3, the dichroic filter spectra, the neutral filter database and each profile's fitted 3-CDF `model`. Chromogen's paper files lack the 3-CDF model, so the paper curve model must come from the Filmbench blob until CHB-004 exports it. Write a small converter (`tools/interim-data/`) that turns both into the `StockData` shape CHB-004 will ship, so switching to real packs is a path change. All stock data is spektrafilm's, licensed CC BY-SA 4.0.

## 4. What exists today and what to take from it

All Chromogen line numbers are in `C1/various/extracted/chromogen-studio/05-inline.js`; Filmbench line numbers in `C1/various/extracted/filmbench-ide/01-inline.js`. The analysis report `C1/various/analysis-chromogen-studio.md` maps the whole Studio; treat it as a guide to verify, not as truth.

### 4.1 Chromogen's spectral library (`chromogen/src`, 142–932)

| Lines | Module | Port | Fix or leave |
|---|---|---|---|
| 142–216 | `units.js`: `Quantity`, stops→logH, refuses D + logH | port the rules into `spectral/units.ts`, aligned with the contract's `Unit` | add `point` (0.025 logH) and `CC`; Chromogen has neither |
| 218–383 | `spectrum.js`: `Grid`, `Spectrum` kinds, `interp`, `blackbody`, `gaussian`, `sigmoid`, `cmf`, `xyz`, `fromSpec` | port `Grid`, `Spectrum`, `interp`, `blackbody`, `gaussian`, `sigmoid` | **replace fitted `cmf()` (324–337) with tabulated CIE 1931**; `xyz()` must take the CMFs as data; drop the `fs` shim |
| 385–475 | `stock.js`: `Curve`, `parametric`, `Stock.spectral`, `load`, `developed` | port `Curve` (monotone table, `inverse`, `slope`, `shift`, `scaleGamma`) and `Stock.spectral` | **NaN handling** in `load` (448–459) becomes an explicit policy; `developed` push heuristic moves to CHB-012 |
| 477–567 | `channels.js`: `read`, `transmittance`, `analytical`, `centroids`, Status M table, `apd`, `printing`, `scanner` | port all | keep `analytical` only as `secant()` for comparisons; add `jacobian()` and `relativeTo()` |
| 569–645 | `linalg.js`: `inv3`, `solve3`, generic bounded `lm`, `minSingular` (Jacobi) | port | generic `lm` is still needed for `greyPatch` |
| 647–790 | `solve.js`: forward model, closed-form Jacobian, analytical start, bounded LM with active set, stall and gtol stops | port the allocation-free `evalF` and `spectral()` faithfully | **start from the base-weighted K instead of the secant** (653, 679); return the stop reason and pass count |
| 792–864 | `print.js`: `Lights`, `makePrinter` (`logE`, `clear`, `viewLogE`, `greyPatch`), `latd` | port `Lights`, `greyPatch`, `latd` | `makePrinter` has no filters, no normalisation, single viewing light; rebuild as `print/enlarger.ts` + `print/view.ts` |
| 866–932 | `colour.js`: Lab, CIEDE2000, Bradford, sRGB matrices and encoding | port | add CAT16 (for CHB-012), Display P3 matrix, knee and OKLab |

### 4.2 Studio modules that hold physics

| Lines | Module | What to take |
|---|---|---|
| 1620–1901 | `model.js` | table domains `A_RANGE` [−0.25, 2.55], `C_RANGE` [0, 2.6], `CP_RANGE` [0, 2.7], `X_RANGE` [−2.5, 2.5], N = 33 and 512 (1628–1634); `makeScanner` (1645–1659); `SOLVE_OPTS` (1664); table node order `nodeAt` (1660–1663); `solveNodes` (1669–1679), `pdOf` (1720–1732), `printSetup` (1763–1787); `aim` (1810–1840); `look3` texel math (1884–1897). These become `tables/` and the parity contract with CHB-005. |
| 2087–2193 | `params.js` | `colourOffset` (Warmth through `warmPerMired`, Tint along (−⅓, ⅔, −⅓)), `autoLights` = integrate-to-grey (2095–2099), `frameParams` lights sum (2100–2157), `paperX` pads, contrast, preflash (2158–2166), `frameStats` LATD (2167–2180). Port the light arithmetic; the pads and contrast are CHB-010's darkroom controls but live on `x`, so `core` provides the functions. |
| 2508–2543 | `source.js` `sigmaD`, `classify` | `classify` is ported into `scan/classify.ts`; `sigmaD` belongs to CHB-006. |
| 4222–4257 | `state.js` `lightsToSliders`, `printOf`, `neutralise` | grey pick by Newton on Warmth and Tint until a*, b* are below 0.05. |
| 3409–3492 | `gpu.js` `SOLVE` WGSL kernel | not ported here; it shows CHB-005 what must match `scan/solve.ts`. |

Chromogen's `laws.js`, `pipe.js` and `program.js` are described in the textbook (§2.8, §3.6) but are not in the Studio bundle. The laws design comes from the textbook text.

### 4.3 Filmbench's engine `FB` (1–701)

Filmbench is a JavaScript port of spektrafilm's forward pipeline. For CHB-003 its print and view half is the closest existing code to spektrafilm's conventions:

| Lines | Function | Use |
|---|---|---|
| 137–146 | `enlargerIlluminant`: lamp × Π_k [1 − (1 − F_k)(1 − 10^(−CC_k/100))] | port as `filteredLamp` |
| 237–282 | `layerCdf`, `channelDensity`, `paperCurves`: 3-CDF paper model, morph, exhaustion | port as `print/paper.ts` |
| 314–320 | `neutralFilters`: database pack, default [0, 65, 55] | port lookup |
| 345–381 | `midDensity`, `factorFor`: mid-grey geometric-mean normalisation and 25³ enlarger table | port normalisation; the table becomes `tables/enlarger.ts` |
| 383–410 | scan table: dyes → log XYZ under the viewing illuminant | reference for `view.reflect` |
| 415–431 | `gamutPixel` 'soft': desaturate negatives, p = 3 shoulder above 0.8 | leave: replaced by the knee (5.4) |
| 615–650 | `stageEnlarge`, `stagePaper`, `stageScan` (glare as % of illuminant XYZ) | reference for stage order |

Filmbench reads `NaN` the spektrafilm way and uses tabulated CMFs, so it is the right comparison for the `'opaque'` convention. It uses f32 tables, so compare it only within table tolerance.

### 4.4 spektrafilm (upstream)

The modules cited here were read at commit `3bb2c2d` of `github.com/andreavolpato/spektrafilm` (June 2026), under `src/spektrafilm/`:

- `runtime/stages/printing.py`: `_film_cmy_to_print_log_raw` (spectral density → `density_to_light` → contract with paper sensitivity → × mid-grey factor → + preflash), `_compute_exposure_factor_midgray` with its four combinations of `normalize_print_exposure` and `print_exposure_compensation`, `_compute_raw_preflash`.
- `runtime/stages/scanning.py`: `cmy_to_log_xyz` (reflectance × viewing illuminant × CMFs ÷ Σ illuminant·ȳ), glare, `XYZ_to_RGB` with the viewing white, `compress_rgb`.
- `utils/morph_curves.py`: `_evaluate_fitted_density`, `_morph_channel_params` (σ/g floored at 0.05, μ/g), `_developer_exhaustion_center_offset`.
- `utils/gamut_compression.py`: the Reinhard knee and `compress_rgb` (default `cam16ucs`).
- `utils/conversions.py`: `density_to_light` (NaN → zero light).
- `model/glare.py`: lognormal glare field, mean `percent` = 0.03 % of the illuminant XYZ.

## 5. Design

### 5.1 Module layout

```text
packages/core/
  src/
    spectral/   grid.ts  spectrum.ts  units.ts  cmf.ts  illuminants.ts  channels.ts
                linalg.ts  metamer.ts  sigmoid.ts  stock.ts  conventions.ts
    print/      enlarger.ts  lights.ts  paper.ts  preflash.ts  view.ts  colour.ts  gamut.ts
                encode.ts  balance.ts  aim.ts
    scan/       scanner.ts  forward.ts  solve.ts  classify.ts  greypick.ts
    tables/     solve-table.ts  pd-table.ts  print-table.ts  enlarger-table.ts  look.ts
    laws/       harness.ts  gens.ts  ch1.laws.ts  ch2.laws.ts  ch3.laws.ts  mutants.ts
    engine-ref.ts   ops/   (one adapter per catalog op)
    index.ts
  test/         golden.test.ts  laws.test.ts  parity-fixtures.test.ts  interim/ (loaders)
fixtures/golden/core/   ch1.json  ch2.json  ch3.json  (textbook numbers, section-tagged)
```

### 5.2 Conventions are explicit

The textbook's numbers were computed under two different conventions: Chromogen's (`facts.py`, `print.js`) and spektrafilm's. They differ in at least five places, and a golden number can only be reproduced under the conventions it was computed with. `core` therefore makes them one explicit, versioned object that every builder takes and every table key includes.

```ts
// packages/core/src/spectral/conventions.ts (sketch)
export interface PhysicsConventions {
  nan: 'opaque' | 'zero';               // missing spectral samples: no light (spektrafilm) or zero density (Chromogen)
  cmf: 'cie1931-2deg' | 'chromogen-fit';// tabulated CIE 1931 2°, or Chromogen's Gaussian fit (legacy, tests only)
  curveMin: 'subtract' | 'keep';        // spektrafilm develop() subtracts each curve's minimum
  paperCurve: 'model-3cdf' | 'table';   // fitted 3-CDF model or the 256-point table
  printNormalise: 'midgray-geomean' | 'none';
  version: 1;
}
export const SPEKTRAFILM: PhysicsConventions = { nan: 'opaque', cmf: 'cie1931-2deg', curveMin: 'subtract',
  paperCurve: 'model-3cdf', printNormalise: 'midgray-geomean', version: 1 };
export const CHROMOGEN: PhysicsConventions = { nan: 'zero', cmf: 'chromogen-fit', curveMin: 'keep',
  paperCurve: 'table', printNormalise: 'none', version: 1 };
export const DEFAULT_CONVENTIONS = SPEKTRAFILM;
```

**How NaN becomes a mask.** Opaque wavelengths transmit no light, whatever the dye amounts. Represent this as a 0/1 vector `pass(λ)` per stock, 0 wherever the base or any unit dye spectrum is missing, and the corresponding density values set to 0. Then fold it into every responsivity that reads that stock: P'_k(λ) = P_k(λ) · pass(λ). The channel weights are normalised **before** masking, so the masked light is lost, not redistributed. This makes the `'opaque'` and `'zero'` conventions differ only in the mask (all ones for `'zero'`), keeps every sum finite, and keeps the Jacobian formula unchanged. Do not encode opacity as density +∞: 0 · ∞ is NaN in IEEE arithmetic, so a dye at zero amount would poison the sum.

#### Decision record: NaN means opaque by default

- **Context.** spektrafilm treats missing data as opaque, Chromogen as transparent. For Portra 400 on Portra Endura this is 0.18 log H in the red printing layer (§2.6). spektrafilm's neutral filter database was computed under the opaque convention.
- **Alternatives.** (a) zero, as Chromogen; (b) opaque, as spektrafilm; (c) extend the last measured value, which §1.6 uses only as an experiment (raising the rebate's printing-density red from 0.143 to 0.242).
- **Decision.** Opaque by default, as part of `SPEKTRAFILM` conventions; zero remains available for reproducing Chromogen numbers.
- **Consequences.** Database filters print a grey neutral ((a*, b*) = (−0.5, −4.2) under 5,000 K, §2.6). Textbook numbers computed by Chromogen code need `CHROMOGEN` conventions in their fixtures. Status: proposed.

#### Decision record: tabulated colour-matching functions

- **Context.** Chromogen's `cmf()` is a fitted approximation. The tables are standard and available (Filmbench blob `cmf[81,3]`, Σȳ = 21.371; spektrafilm `STANDARD_OBSERVER_CMFS`).
- **Decision.** Use tabulated CIE 1931 2° data from CHB-004. Keep the fit only as `cmfChromogenFit()` for reproducing Chromogen fixtures.
- **Consequences.** Small, measured differences. For this guide, the 5,000 K blackbody white was computed both ways on the 81-point grid: X/Y = 0.9801 and Z/Y = 0.8618 with the fit, 0.9815 and 0.8624 with the tables. The textbook's grey card, adapted with either white, still encodes to #70757b; linear sRGB moves by at most 0.0007. Status: proposed.

### 5.3 Stage 1: the spectral core

```ts
// packages/core/src/spectral/*.ts (sketch)
export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];               // row-major: M[row][col]
export interface Quantity { value: number; unit: Unit }   // Unit from the contract; add() refuses D + logH

export interface Grid { readonly start_nm: 380; readonly stop_nm: 780; readonly step_nm: 5; readonly n: 81; readonly wl: Float64Array }
export const GRID: Grid;

export type SpectrumKind = 'power' | 'reflectance' | 'transmittance' | 'density' | 'responsivity';
export class Spectrum {
  constructor(values: ArrayLike<number>, kind: SpectrumKind, grid?: Grid);   // throws E_KIND on length mismatch
  readonly kind: SpectrumKind; readonly values: Float64Array;
  mul(s: Spectrum): Spectrum;    // refuses 'density'
  add(s: Spectrum): Spectrum;    // refuses 'transmittance'
  scale(k: number): Spectrum; toDensity(): Spectrum; toTransmittance(): Spectrum; sum(): number; at(nm: number): number;
}
export function tabulate(wl_nm: ArrayLike<number>, values: ArrayLike<number>, kind: SpectrumKind): Spectrum; // linear interp, 0 outside
export function blackbody(T_K: number): Spectrum;                 // normalised to 1 at 560 nm, as Chromogen
export function gaussian(centre_nm: number, fwhm_nm: number | [number, number]): Spectrum;
export function sigmoid(c: Vec3): Spectrum;                       // u = (λ − 380)/400, kind 'reflectance'

export interface StockData {                                       // the shape CHB-004 ships; core never parses files
  id: string; role: 'film' | 'paper'; type: 'negative' | 'positive';
  logSensitivity: Float64Array[];   // 3 × 81, NaN allowed
  dyes: Float64Array[];             // 3 × 81 unit dye spectra, NaN allowed
  base: Float64Array;               // 81, NaN allowed
  logExposure: Float64Array; curves: Float64Array[];               // 256 over −3…4; 3 curves
  curveModel?: { centres: Mat3; amps: Mat3; sigmas: Mat3 };        // 3-CDF per channel
  meta: { refIlluminant: string; viewIlluminant: string; antihalation?: string; use?: string };
}
export interface Stock {           // StockData resolved under a convention
  data: StockData; conv: PhysicsConventions;
  sens: Float64Array[]; dyes: Float64Array[]; base: Float64Array; pass: Float64Array;   // NaN → 0, pass mask
  curves: Curve[];
  spectral(c: Vec3, out?: Float64Array): Float64Array;              // b + Σ c_j ε_j (density, opaque samples 0)
}
export function resolveStock(d: StockData, conv: PhysicsConventions): Stock;
export class Curve {                // Chromogen stock.js 393–417: monotone table (running max + 1e-9)
  at(x: number): number; inverse(y: number): number; slope(x: number): number;
  shift(dx_logH: number): Curve; scaleGamma(g: number, about_logH?: number): Curve;
}

export class Channels {
  constructor(P: [Spectrum, Spectrum, Spectrum], name: string);     // each normalised to sum 1
  readonly name: string; readonly P: [Float64Array, Float64Array, Float64Array];
  read(D: ArrayLike<number>): Vec3;                                 // −log10 Σ w 10^−D
  transmittance(D: ArrayLike<number>): Vec3;
  masked(pass: Float64Array): Channels;                             // P·pass, NOT renormalised
  centroids_nm(): Vec3;
}
export function statusM(): Channels;   export function statusA(table: StatusTable): Channels;   // Status A data from CHB-004
export function apd(table: ApdData): Channels;
export function printingChannels(paper: Stock, lamp: Spectrum, filter?: Spectrum): Channels;
export function scannerChannels(light: Spectrum | [Spectrum, Spectrum, Spectrum], camera: [Spectrum, Spectrum, Spectrum]): Channels;

export function jacobian(ch: Channels, stock: Stock, c: Vec3): Mat3;  // Σ w̃ ε_j
export function hessian(ch: Channels, stock: Stock, c: Vec3, k: 0 | 1 | 2): Mat3;   // −ln10 · Cov_w̃
export function secant(ch: Channels, stock: Stock): Mat3;            // Hunt analytical (Chromogen); comparison only
export function baseWeightedK(ch: Channels, stock: Stock): Mat3;     // = jacobian(ch, stock, [0,0,0]) with base
export function relativeTo(ch: Channels, base: ArrayLike<number>): Channels;   // P·10^−b, renormalised
export function solveLinear(K: Mat3, d: Vec3): { c: Vec3; cond: number; sigmaMin: number };
export function metamericBlack(A: Float64Array[] /* 3 × 81 */, p: Float64Array): Float64Array;
export function exposeSpectral(stock: Stock, radiance: Float64Array, ref: { illuminant: Spectrum; grey: number }): Vec3;
// u_k = log10 Σ E ρ s_k + κ_k, with κ_k so that `grey` (0.184) under `illuminant` gives 0 (§2.1)
```

Three remarks for implementers:

- `jacobian` with c = 0 and the stock's base gives the base-weighted K directly. You do not need `relativeTo` to build it; `relativeTo` exists because the base-relativity law needs it and because CHB-006 reasons in rebate-relative density.
- `exposeSpectral` is the textbook's map X (§2.1) for spectra that already exist: the balance tests of stage 3 shoot grey scales under blackbody lights with it. The RGB-to-spectrum path built on top of it is CHB-012.
- Keep hot loops allocation-free over `Float64Array`, as `solve.js` does. The pure spectral functions are called millions of times by the reference engine.

The textbook's §1.9 API maps onto this as follows: `Grid` → `GRID`; `Spectrum(values, kind)` → `Spectrum`; `Channels(P)` → `Channels`; `read`, `transmittance` → methods; `jacobian(P, D, E)` → `jacobian`; `secant(P, E)` → `secant`; `relativeTo(P, b)` → `relativeTo`; `solveLinear(K, Dk)` → `solveLinear`; `sigmaD` → CHB-006 (`ingest/conditioning/sigma`); `metamericBlack` → `metamericBlack`; `sigmoid` → `sigmoid`.

### 5.4 Stage 2: the print chain

The print chain turns film dye amounts into display RGB. Its order is fixed by the rules of §2: lights after the spectral sum, paper curve after lights and flash, flare before adaptation, the knee last.

```text
c (film-dyes) ─► D(λ) = b + Σ c_j ε_j ─► raw_k = Σ L F pass 10^−D s_k ─► x_k = log10(raw_k·N) + offset
   ─► + ℓ (lights, aim-relative) ─► pads, contrast (CHB-010 controls, affine in x) ─► preflash log10(10^x + φ)
   ─► c_p = paper curve (3-CDF, morph) ─► R(λ) = 10^−(b_p + Σ c_p ε_p) ─► XYZ under E_v (Y_white = 1)
   ─► + flare (fraction of E_v white) ─► Bradford E_v white → D65 ─► RGB_display (linear)
   ─► knee (LAST) ─► OETF ─► display-rgb
```

```ts
// packages/core/src/print/*.ts (sketch)
export interface EnlargerSetup {
  film: Stock; paper: Stock; lamp: Spectrum;                  // e.g. TH-KG3, or blackbody(3200) for Chromogen fixtures
  dichroic: [Float64Array, Float64Array, Float64Array];       // filter band transmittance profiles F_k(λ) ∈ [0,1]
  filtration_CC: { c: number; m: number; y: number };         // database neutral pack + user shift
  mode: 'normalised' | 'real';
  real?: RealExposureModel;                                    // CHB-010
  midgray?: Float64Array;   // spectral density of the mid-grey; default: film at log H = 0; RAW frames: CHB-012
  conv: PhysicsConventions;
}
export interface RealExposureModel { offset_logH(enlarger: { time_s: number; fstop: number; lamp: string }): Vec3 }
export function filteredLamp(lamp: Spectrum, dichroic: Float64Array[], cc: { c: number; m: number; y: number }): Float64Array;
export function makeEnlarger(s: EnlargerSetup): Enlarger;
export interface Enlarger {
  exposure(c: Vec3): Vec3;          // paper log H without lights: the tabulable part
  clear(): Vec3;                    // log H through an empty gate (Chromogen print.js 834)
  midgrayFactor_logH: number;       // −mean_k log10 raw_k(mid-grey); 0 if printNormalise is 'none' or mode is 'real'
  dxdCC(): Mat3;                    // ∂x/∂v at the current pack, rows layers, cols filters (§2.6 golden)
}

export class Lights {                                          // log-exposure offsets per paper layer
  static fromLogH(v: Vec3): Lights; static fromPoints(p: Vec3): Lights;   // 1 point = 0.025 logH
  readonly logH: Vec3; points(): Vec3;
  shift(q: { R?: Quantity; G?: Quantity; B?: Quantity }): Lights;   // accepts logH, point, stop; throws E_UNIT on 'D'
  plus(o: Lights): Lights;
}

export interface PaperCurveModel { centres: Mat3; amps: Mat3; sigmas: Mat3 }      // [channel][sublayer]
export interface PaperMorph { gamma: number; fast: number; slow: number; rgb: Vec3; exhaustion: number }
export function morphPaper(m: PaperCurveModel, g: PaperMorph): PaperCurveModel & { gumbelMix: Mat3 };
export function paperDevelop(m: PaperCurveModel, x: Vec3): Vec3;                 // Σ A Φ((x − μ)/σ)
export function paperSlope(m: PaperCurveModel, x: Vec3): Vec3;

export function preflash(x: Vec3, phi: Vec3): Vec3;                               // log10(10^x + φ)
export function preflashPhi(enl: Enlarger, amount: number, shiftCC?: { m: number; y: number }): Vec3;
export function preflashFromSlider(p_percent: number, g: Vec3): Vec3;            // Chromogen: 0.35·p/100·10^(g−0.6)

export interface Viewing { illuminant: Spectrum; cmf: [Float64Array, Float64Array, Float64Array]; paper: Stock }
export function reflectance(v: Viewing, cp: Vec3, out?: Float64Array): Float64Array;    // single pass, 10^−D_p
export function observe(v: Viewing, R: Float64Array): Vec3;                           // Y(perfect white) = 1
export function whiteXYZ(v: Viewing): Vec3;
export function addFlare(X: Vec3, fraction: number, flareWhite: Vec3): Vec3;          // X + f · W
export function adaptBradford(X: Vec3, from: Vec3, to?: Vec3): Vec3;                  // to defaults to D65
export function adaptCAT16(X: Vec3, from: Vec3, to: Vec3): Vec3;                      // used by CHB-012
export function knee(d: number, t: number, l: number, p: number): number;
export function compressOutput(rgbLin: Vec3, spec: { algorithm: 'oklch' | 'cam16ucs'; chroma: [number, number, number];
                                                     lightness: [number, number, number] }): Vec3;
export function encodeSRGB(v: number): number;  export function decodeSRGB(v: number): number;
export function lab(X: Vec3, white: Vec3): Vec3;  export function deltaE2000(a: Vec3, b: Vec3): number;
```

**Normalised and real modes.** `Enlarger.exposure` computes raw_k = Σ L(λ) F(λ) pass(λ) 10^(−D(λ)) s_k(λ). In `'normalised'` mode it adds the mid-grey factor, −mean_k log₁₀ raw_k(mid-grey), where the mid-grey is the film developed at log H = 0 in every layer with the film's *un-normalised* curves, as spektrafilm and Filmbench do (`printing.py` `_compute_exposure_factor_midgray`; Filmbench 345–366). spektrafilm also has a print-exposure-compensation variant that uses the mid-grey shifted by the camera's exposure compensation; implement the four combinations of its two flags, because CHB-012 needs them. For a `digital-raw` frame the mid-grey is not the film at log H = 0 but an RGB 0.184 grey taken through CHB-012's capture path (`midgrayFilmDensity`), as spektrafilm does; `EnlargerSetup.midgray` carries it. In `'real'` mode no normalisation is applied, and `RealExposureModel.offset_logH` adds log₁₀ of the exposure (time, aperture, lamp calibration). CHB-003 ships a stub, `offset = log10(time_s / 10) − 2·log10(fstop / 8)`, documented as a placeholder for CHB-010.

**Printer lights are measured from the aim.** What does ℓ = 0 mean? In Chromogen, `aim()` (`05-inline.js` 1810–1840) runs `greyPatch` to find the lights that print the film's grey card as a neutral of reflectance 0.184, and stores everything relative to those. In spektrafilm, the database filters plus mid-grey normalisation make ℓ = 0 print the grey card nearly neutral. The recipe stores `print.lights.logH`; `core` defines it as relative to an **aim** computed at stock binding time.

#### Decision record: the aim

- **Context.** The recipe's lights need a zero that survives changes of paper, lamp and conventions.
- **Alternatives.** (a) ℓ = 0 is the raw normalised exposure (spektrafilm); (b) ℓ = 0 is the `greyPatch` solution that prints the grey card neutral at 18.4 % (Chromogen).
- **Decision.** Offer both as `aim: 'grey-0.184' | 'midgray-normalised'`, default `'grey-0.184'`, computed by `print/aim.ts` and cached by (film, paper, lamp, filters, view, conventions).
- **Consequences.** A paper change keeps the grey card neutral at the same density. The golden number 0.755 (§2.6) is reproduced with `'midgray-normalised'` and ℓ = 0. Status: proposed; CHB-009 and CHB-010 display points relative to this aim.

**Paper development.** `paperDevelop` evaluates the 3-CDF model from the stock's `curveModel` under `'model-3cdf'` conventions, or interpolates the table under `'table'`. Use the Filmbench `erf` (`01-inline.js` 14–28) or an equivalent with 1e-15 accuracy for Φ. The `grade` field of the recipe maps to `PaperMorph.gamma`; CHB-010 owns the user control.

**Viewing order and flare.** spektrafilm adds glare in XYZ under the viewing light, then converts to RGB with the viewing white; Chromogen adapts to D65 and then adds a D65-tinted flare scaled by the paper white's Y (`params.js` 2122, 2136; shader 2023). These agree: Bradford is linear and maps the viewing white exactly to D65, so adding f·W_v before adaptation equals adding f·D65·Y after it. `core` adds flare before adaptation, in the frame where it physically happens, and makes the equality a law. The flare fraction's reference is a recipe-level choice: Chromogen scales by the paper white (`Blacks` 12 → 0.48 % of paper white), Giorgianni and Madden by the white's reflectance. Both are `addFlare` with a different `flareWhite`. spektrafilm's random lognormal glare is a spatial, stochastic effect; the reference engine implements its mean only (a flat flare of `percent`/100 of the illuminant XYZ), and the random field is left to CHB-015 or later.

**The gamut knee.** `output.display` ends with the knee and the OETF. Nothing may follow the knee except encoding.

#### Decision record: output gamut compression algorithm

- **Context.** spektrafilm's default compresses CAM16-UCS chroma against a table of the largest in-gamut chroma per lightness and hue, with the knee (0, 1, 6), after a one-sided lightness knee (0.7, 1, 2.2) (§2.7). Filmbench uses an RGB 'soft' shoulder; Chromogen a per-channel tanh shoulder above 0.82, which shifts hue and maps paper white to 0.957 linear (analysis §6.3).
- **Alternatives.** CAM16-UCS (exact spektrafilm parity, heavy maths); OkLCh (spektrafilm's other supported algorithm, simple and invertible); RGB shoulders (hue shifts).
- **Decision.** Implement the knee primitive and the OkLCh algorithm in stage 2, with the same knee parameters; add `cam16ucs` later only if spektrafilm `rgb_out` parity requires it.
- **Consequences.** Output parity with spektrafilm is checked only on in-gamut colours until `cam16ucs` exists. Status: proposed.

The textbook's §2.9 API maps onto stage 2 as: `printExposure(D, lamp, filters, paperSens)` → `Enlarger.exposure`; `lights(x, l)` → `x + Lights.logH` with the type error for densities; `view(R, light, flare)` → `observe` + `addFlare`; `display(X, white, compress)` → `adaptBradford` + `compressOutput` + `encodeSRGB`. `spectral(c, eps, base)` is `Stock.spectral`. `expose`, `couple`, `convolve` and `grain` are CHB-012.

### 5.5 Stage 3: inversion

**The scanner model.** A scanner is a `Channels` object plus a flare fraction:

```ts
// packages/core/src/scan/*.ts (sketch)
export interface ScannerModel {
  id: string;                         // 'xt5-fitted', 'rgb-led-book', 'white-led', 'status-m', …
  channels: Channels;                 // light × camera, normalised (Chromogen makeScanner, 1645–1659)
  flare: number;                      // fraction of the open-gate signal added everywhere (§3.1)
  capture: 'sequential' | 'single';
}
export interface ForwardModel {       // allocation-free closure over one (scanner, stock, conventions)
  D(c: Vec3, out: Float64Array): void;                   // absolute scanner densities
  DJ(c: Vec3, d: Vec3, r: Float64Array, J: Float64Array): number;   // residual r = D(c) − d, J row-major; returns ‖r‖²
  Dbase: Vec3;                                            // channels read the stock's base
  K: Mat3; Kinv: Mat3;                                    // start matrix (base-weighted by default)
}
export function makeForward(s: ScannerModel, stock: Stock, opt?: { start?: 'base-weighted' | 'secant' | 'tangent0' }): ForwardModel;
export function withFlare(Dabove: Vec3, Treb: Vec3, f: number): Vec3;    // D' = −log10((T + f)/(T_reb + f))
export function removeFlare(Dmeasured_above: Vec3, Treb: Vec3, f: number): Vec3;
export function fitFlare(steps_D: number[], readings_D: number[]): { f: number; rms: number };  // neutral wedge, §3.7

export interface SolveOptions { lo?: 0; hi?: 4; activeSet?: true; gtol?: 1e-9; tolerance?: 1e-12;
                                maxIterations?: 50; stall?: 0; sigma?: boolean }
export type StopReason = 'tolerance' | 'gtol' | 'maxIterations' | 'noImprovement' | 'stall';
export interface SolveResult { c: Vec3; start: Vec3; residual_D: number; iterations: number; passes: number;
                               stop: StopReason; held: [boolean, boolean, boolean]; sigmaMin?: number }
export function solveDyes(f: ForwardModel, d: Vec3, o?: SolveOptions): SolveResult;
```

The input `d` is **absolute** scanner density: CHB-006 delivers density above the rebate, −log₁₀(T/T_reb); the solver adds the stock's own base reading `Dbase` before solving, as `model.js` does when it keys the table (`solveNodes`, 1672). This identifies the scan's rebate with the profile's base; `program.js` warned when the two differ by more than 0.02 D, and the same check belongs in CHB-006's rebate validation.

**Flare.** Chromogen's example scanner documents a flare value that `program.js` never reads, so it is silently ignored (§3.1). That matters: with f = 0.5 % the white patch falls from 1.429 to 1.172 D above the rebate in the narrowband blue channel, more than a stop of blue exposure after inversion. In chromobench the `ScannerModel` carries `flare`, CHB-006's `scan.flare` op subtracts it in linear transmittance (using `removeFlare`'s formula), and the synthetic-frame generator adds it with `withFlare`. `fitFlare` recovers f from a neutral wedge: a spectrally flat density d reads d in every channel of every scanner, so any departure is photometric (§3.7).

**The solve.** Port `spectral()` (`05-inline.js` 719–777) line by line into `solveDyes`, keeping its damping rule, its 12 tries, its active-set masking and its stopping rules, and keeping `evalF` fused. Two changes:

1. **Start from the base-weighted K.** Chromogen starts from clip(K_secant⁻¹(d − D_base)). With the base-weighted K the start is much closer: an independent port written for this guide, on Chromogen's st-data, solves the grey card through the white-LED camera in **2 iterations and 5 passes** from (0.6833, 0.6688, 0.8639), against the textbook's 3 iterations and 7 passes from (1.0936, 0.7974, 1.3228). On the shadow pixel of §3.4 both starts reach 0.10646 D in 4 iterations with the active set.
2. **Return the stop reason and pass count.** Tests and the conformance suite need them, and CHB-005 compares iteration counts between f64 and f32.

#### Decision record: the solver's start and the table key

- **Context.** The start matrix also defines the GPU table's key, a = K⁻¹(D − D_base) (`solveNodes`), and §4.2 found that keying on a lowers interpolation error, more so the closer K is to the local slope.
- **Decision.** Use the base-weighted K for both the start and the table key. Keep `secant` reachable through `makeForward(..., { start: 'secant' })` for reproducing the textbook's trace and Chromogen's tables.
- **Consequences.** CHB-005's table domain `A_RANGE` must be re-derived for the new key (the Studio's [−0.25, 2.55] was sized for keys made with the secant); `tables/solve-table.ts` reports the key range the data needs. Status: proposed.

**Classification.** `classify` is a pure port of `source.js` 2538–2543. The class order matters: below base wins over blank, both over gamut. σ comes from CHB-006 and depends on resolution (Gold 200: 0.0090, 0.0069, 0.0122 D at 1,090 × 754, and 0.0043, 0.0033, 0.0057 D at the Studio's 640-pixel statistics size, §3.5). A class percentage is meaningless without its size.

```ts
export type ScanClass = 'ok' | 'blank' | 'below' | 'gamut';
export function classify(Dabove: Vec3, sigma: Vec3, residual_D: number, Z?: number):   // Z defaults to 3
  { cls: ScanClass; z: Vec3; layers: number[] };
```

Chromogen's version takes T and T_reb and computes D = −log₁₀(max(T, 10⁻⁶)/T_reb) itself; `core` takes the density above the rebate directly, because that is what the `scanner-density` domain already holds.

**Balance.** `print/balance.ts` provides the lights arithmetic of §3.6 and `params.js`. `PrintChain` below is a small bundle of an `Enlarger`, its aim, the paper model and a `Viewing`, with a method from paper log H to XYZ and CIELAB:

```ts
export function latd(printing: Channels, Ds: Iterable<Float64Array>): Vec3;     // −log10 mean T per paper band
export function latdFromPD(pd: Float32Array | Float64Array, n: number): Vec3;   // −log10 mean 10^−PD (frameStats)
export function integrateToGrey(frameLatd: Vec3, aim: { latd: Vec3; lights: Lights }, alpha?: number): Lights;
export function greyPatch(chain: PrintChain, D: Float64Array, reflectance?: number): Lights;   // LM, 3 unknowns
export function warmPerMired(film: Stock, PCh: Channels, curves: Curve[]): Vec3; // Chromogen aim() 1818–1833
export function colourOffset(warm: number, tint: number, wpm: Vec3): Vec3;       // 1.3 mired/unit, ±10 pt green
export function lightsToSliders(dL: Vec3, wpm: Vec3): { exposure: number; warmth: number; tint: number };
export function greyPick(chain: PrintChain, pd: Vec3, start: Lights): Lights;   // see below
```

**Grey pick.** Chromogen's `neutralise` (`05-inline.js` 4236–4257) runs Newton on the Warmth and Tint sliders until the picked point's a* and b* are below 0.05. `core` solves the same problem directly in lights: two unknowns in the colour plane of the lights (mean removed, basis (1, −1, 0)/√2 and (1, 1, −2)/√6), two equations a* = b* = 0, Newton with a finite-difference Jacobian. Density is untouched, which is what a photographer means by "make this grey". The UI converts the result to Warmth and Tint with `lightsToSliders`.

The textbook's §3.9 API maps as: `Channels` → `Channels`; `Forward (c) → {D, J}` → `makeForward`; `solve(d, opts)` → `solveDyes`; `flatGrid` and `sigmaD` → CHB-006; `classify` → `classify`; `latd` → `latd`; `integrate(alpha)` → `integrateToGrey`.

### 5.6 Tables for the GPU

CHB-005 renders with three 33³ tables (dye solve, printing density, print XYZ) and 1-D curve tables, read with trilinear filtering at texel centres. `core/tables/` builds the same tables in f64, with the same node order (`nodeAt`: x fastest), domains and channel layout (four floats per node, the solve table's fourth channel the residual), and a `look3` that reproduces the texel-centre mapping u' = (u(N − 1) + ½)/N. CHB-005 compares its tables with these node by node. The textbook's measured agreement on the Studio's code is the starting tolerance (§4.5, §4.7): solve within 2.2×10⁻⁶ in dye amount on reachable nodes and zero flips across the 0.01 D threshold; printing density within 7.2×10⁻⁷; print XYZ within 4.2×10⁻⁷.

### 5.7 The reference engine

`engine-ref.ts` implements `Engine` with `id: 'reference'`. It evaluates a node by walking its inputs, applying one op adapter per catalog op to `Float64Array` images, and caching by (node id, scale, region). It has two internal modes, chosen at construction, not per call:

- `exact` (default): every pixel runs the solve and the spectral integrals. About 6 µs per solve in node (§4), so a 1,090 × 754 frame takes seconds. Fine for tests and agents.
- `tabulated`: builds the f64 tables of 5.6 and interpolates like the GPU.

#### Decision record: two reference modes

- **Context.** A GPU-versus-reference difference mixes two errors: table interpolation (up to 0.017 in dye amount at the edge of the reachable set, §4.2) and f32 arithmetic (about 2×10⁻⁶).
- **Decision.** The reference engine can render through its own f64 tables. Parity tests compare `gpu` with `reference/tabulated` for arithmetic error, and `reference/tabulated` with `reference/exact` for table error, each with its own tolerance.
- **Consequences.** Failures localise to one cause. Status: proposed.

| Op | Core function | Domain in → out | Class | Binding of the expensive part |
|---|---|---|---|---|
| `invert.dyes` | `solveDyes` per pixel | `scanner-density` → `film-dyes` (4 ch: c + residual D) | pointwise | scan (scanner × stock) |
| `invert.classify` | `classify` | `scanner-density` and the residual channel of `invert.dyes` → classes | pointwise | pixel |
| `print.expose` | `Enlarger.exposure` | `film-dyes` → `paper-logH` | pointwise | stock (film × paper × lamp × filters) |
| `print.lights` | x + aim + ℓ | `paper-logH` → `paper-logH` | pointwise | setting |
| `print.preflash` | `preflash` | `paper-logH` → `paper-logH` | pointwise | setting |
| `print.develop` | `paperDevelop` (+ morph) | `paper-logH` → `paper-dyes` | pointwise | stock × grade |
| `view.reflect` | `reflectance` + `observe` | `paper-dyes` → `print-xyz` | pointwise | stock (paper × viewing light) |
| `view.flare` | `addFlare` | `print-xyz` → `print-xyz` | pointwise | setting |
| `view.adapt` | `adaptBradford` | `print-xyz` → `print-xyz` (display white) | pointwise | setting |
| `output.display` | matrix, `compressOutput`, `encodeSRGB` | `print-xyz` → `display-rgb` | pointwise | setting |
| `measure.densitometer` | `statusM().read` / `statusA().read` of `Stock.spectral` | `film-dyes`, `paper-dyes` → Value | measure | pixel |
| `measure.stats` | means, LATD, percentiles | any → Value | measure | — |

Integrate-to-grey is image-global: the lights depend on the frame's LATD. The recipe compiler (CHB-002) turns `print.lights.auto` into a `measure.stats` node on the printing density at a fixed analysis scale (the Studio uses 640 pixels on the long side), and passes the result as an argument of `print.lights`. Because the scale changes LATD slightly, the analysis scale is part of the node's arguments.

The reference engine must also pass CHB-002's conformance suite: domains and units on every output, error codes for out-of-range arguments, and determinism (the same node renders bit-identically twice).

### 5.8 The law harness

A **law** is a property-based test stated by the textbook. Chromogen's `laws.js` (described in §2.8; the source is not in our extracts) makes a law a value: `law(name, gen, prop, meta)` refuses to build without a `justifies` field ("without it this is an example, not a law"), and `check(suite, { n, seed })` draws n inputs from a seeded mulberry32 generator and shrinks a failing input toward zero and two decimals. Filmbench has the same mulberry32 at `01-inline.js` 465.

```ts
// packages/core/src/laws/harness.ts (sketch)
export interface Rng { next(): number /* [0,1) */; int(n: number): number }
export function mulberry32(seed: number): Rng;
export interface Gen<T> { sample(r: Rng): T; shrink(x: T): Iterable<T> }   // shrink toward 0, then round to 2 decimals
export interface LawMeta { justifies: string; section: string; tol?: number; mutant?: Mutant }
export interface Mutant { name: string; apply(): () => void }               // patches a function, returns undo
export function law<T>(name: string, gen: Gen<T>, prop: (x: T) => true | string, meta: LawMeta): Law<T>;
export function check(suite: Law<unknown>[], o?: { n?: number; seed?: number }):
  { name: string; passed: boolean; ms: number; counterexample?: unknown; message?: string }[];
export function checkMutants(suite: Law<unknown>[], o?: { n?: number; seed?: number }):
  { name: string; mutant: string; caught: boolean }[];
```

**Every law has a mutant.** The textbook found that one of Chromogen's eight laws, `channels.rebate.zero`, cannot fail: it reads the base through the same channels twice and checks the difference is zero. To prevent such tests, each law in `core` declares a deliberately broken variant of the code it guards, and CI runs `checkMutants` and requires every mutant to be caught. Examples: the bounds law with `read` replaced by the weighted mean of D; the concavity law with a sign error in the covariance; the lights law with lights applied as a density offset after the paper curve; the active-set law with the held dye's row left unmasked; the knee law with a gain after the knee.

## 6. Two flows traced end to end

### 6.1 Printing the grey card

The input is the running example's grey card on Portra 400, the paper is Portra Endura, the lamp TH-KG3 with the database neutral pack, viewing 5,000 K, conventions `SPEKTRAFILM`, aim `'midgray-normalised'`, ℓ = 0, no flare.

1. **Dye amounts.** Developing the film at log H = 0 gives c = (0.687, 0.704, 0.864) (Chromogen's table, §1.2); with spektrafilm's minimum subtraction the values are (0.6872, 0.7051, 0.8642). Both are within the fixture tolerance of 0.001.
2. **Spectral density.** D(λ) = b + Σ c_j ε_j. At 550 nm: −0.0264 + 0.888 + 0.0022 + 0.6024 = 1.4662 (§1.2). From 705 nm up the base is missing, so `pass(λ)` = 0 there.
3. **Paper exposure.** The filtered lamp is TH-KG3 × the dichroic pack at C 0, M 51.57, Y 52.53. The mid-grey factor makes the geometric mean exposure of the film's mid-grey 1; this grey card is that mid-grey, so x ≈ (0.004, 0.005, −0.009) (§2.6).
4. **Lights and flash.** ℓ = 0, no preflash.
5. **Paper dyes.** The 3-CDF model at x ≈ 0 gives c_p ≈ (0.665, 0.548, 0.499), with slopes 2.36, 1.98, 1.95 (§2.6).
6. **Reflectance and XYZ.** R(λ) = 10^(−D_p(λ)), observed under 5,000 K with Y_white = 1. The textbook reports the grey card printing at visual density **0.755** with chain slope **1.33** (§2, introduction and §2.6), and a neutral within (a*, b*) = (−0.5, −4.2).
7. **Adaptation and encoding.** The textbook's colour check starts from the grey print's XYZ = (0.1706, 0.1750, 0.1686) under 5,000 K, adapts it with Bradford to (0.1664, 0.1754, 0.2131), converts to linear sRGB (0.164, 0.177, 0.199) and encodes (0.441, 0.457, 0.483) = **#70757b** (§2.7). For this guide the step was rerun from that XYZ: with the fitted-CMF white the numbers reproduce exactly; with the tabulated white, linear sRGB is (0.1628, 0.1768, 0.1986) and the hex code is unchanged.

The flow gives a chain of intermediate checks: if step 3 does not give (0.004, 0.005, −0.009), the error is in the lamp, filters or NaN mask, not in the paper or the viewing. Build the tests in that order.

### 6.2 Inverting the grey card

The scanner is the illustrative white-LED camera, the stock Portra 400, conventions `CHROMOGEN` (the textbook computed this with Chromogen's code).

1. **Forward reading.** The grey card reads d = (0.8763, 1.2337, 1.6649) D absolute; the rebate reads D_base = (0.3200, 0.5547, 0.7809), so the scan delivers (0.556, 0.679, 0.884) above the rebate (§1.6, §3.2 exercise).
2. **Start.** With the secant K: clip(K⁻¹(d − D_base)) = (1.0936, 0.7974, 1.3228), residual 0.424 D. With the base-weighted K: (0.6833, 0.6688, 0.8639), residual 0.0318 D.
3. **LM iterations from the secant start** (§3.3; reproduced exactly for this guide):

```text
it  c (cyan, magenta, yellow)   |r| (D)     mu        tries
0   1.0936  0.7974  1.3228      4.24e-1     1.0e-3    start
1   0.6734  0.7010  0.8136      3.94e-2     3.3e-4    1
2   0.6865  0.7044  0.8628      5.08e-4     1.1e-4    1
3   0.6865  0.7044  0.8635      3.09e-7     3.7e-5    1     stop: |r|² ≤ 1e-12
```

4. **Result.** c = (0.6865, 0.7044, 0.8635), the truth, after 7 passes over the spectrum. From the base-weighted start the same answer takes 2 iterations and 5 passes.
5. **Classification.** All three channels sit far above the rebate (z ≫ 3), and the residual is below 0.01 D, so the class is `ok`.
6. **Hand-off.** The 4-channel `film-dyes` pixel (0.6865, 0.7044, 0.8635, 3.1×10⁻⁷) enters `print.expose` as in 6.1.

A failure case for comparison, from §3.4: a shadow pixel at (0.02, 0.35, 0.45) D above the rebate has no exact solution, because there is too little red for the magenta and yellow its green and blue demand. Plain LM stops at the 50-iteration cap after 146 passes with residual 0.10661 D; the active-set solve holds cyan at zero and reaches the constrained minimum 0.10646 D in 4 iterations and 9 passes. The pixel is then classified by its z values (blank, below base, or out of gamut), and its residual is kept.

## 7. Implementation plan

**Stage 1: spectral core and channels.**

- Files: `spectral/*.ts`, `laws/harness.ts`, `laws/ch1.laws.ts`, `test/interim/`, `fixtures/golden/core/ch1.json`.
- Build the interim data converter first, then `Grid`, `Spectrum`, units, `resolveStock` with the NaN mask, `Channels` with the four families, `jacobian`, `hessian`, `secant`, `relativeTo`, `solveLinear` with `minSingular`, `metamericBlack`, `sigmoid`, `exposeSpectral`.
- Done when: the chapter 1 goldens pass (1.538; both K matrices; the four-row K table; singular values; channel bounds; −0.816), the four chapter 1 laws pass with n = 200, and each law's mutant is caught.

**Stage 2: print chain.**

- Files: `print/*.ts`, `tables/pd-table.ts`, `tables/print-table.ts`, `tables/enlarger-table.ts`, `laws/ch2.laws.ts`, `fixtures/golden/core/ch2.json`.
- Order: `filteredLamp` and `Enlarger` in both modes → `Lights` → paper model and morph → preflash → reflectance and `observe` with tabulated CMFs → flare → Bradford → knee and OkLCh compression → sRGB encoding → `aim`.
- Done when: the mid-grey paper exposure (0.004, 0.005, −0.009), ∂x/∂v at the neutral pack (both matrices), paper dyes and slopes at the grey card, 0.755 and slope 1.33, paper white Y = 0.813 and black 2.37, the flare example, #70757b and the knee values reproduce; the lights-factor-out law holds to 10⁻¹²; flare-before-adaptation equals flare-after; the knee-last law catches its mutant.

**Stage 3: inversion.**

- Files: `scan/*.ts`, `print/balance.ts`, `print/aim.ts`, `tables/solve-table.ts`, `laws/ch3.laws.ts`, `engine-ref.ts`, `ops/*.ts`, `fixtures/golden/core/ch3.json`.
- Order: `makeForward` with closed-form Jacobian (check against central differences) → `solveDyes` ported from `spectral()` → base-weighted start → `classify` → `latd`, `integrateToGrey`, `greyPatch`, `greyPick` → the solve table builder → the reference engine and op adapters.
- Done when: the LM trace of §3.3 reproduces to four decimals with `start: 'secant'`; the shadow pixel reproduces 0.10646 D in 4 iterations; the table timings show a speed-up of at least 5 times from the active set (machine-dependent, so test the iteration counts: mean 13.9 → 2.3 on X-T5/Gold 200); the Gold 200 class percentages at 640 × 443 reproduce within 0.2 points (this needs CHB-006's resampling and σ, or test ports of `Source.region` and `sigmaD` from `source.js`); the 3,800 K balance test gives at most 2.4 ΔE00 with lights and about 14.6 with a density shift; the reference engine passes the conformance suite.

## 8. Testing and acceptance

### 8.1 Golden numbers

Golden numbers live in `fixtures/golden/core/ch{1,2,3}.json`. Each entry records where the number comes from and the conventions it needs:

```json
{ "id": "ch1.greycard.narrowband.green", "section": "§1.1", "source": "textbook",
  "conventions": "CHROMOGEN", "inputs": { "stock": "kodak_portra_400", "c": [0.687, 0.704, 0.864],
  "scanner": "rgb-led-book", "channel": 1 }, "expect": 1.538, "tol": 6e-4 }
```

**Tolerance rule.** The textbook prints rounded values, sometimes rounded differently in two places (0.7485 appears as 0.749 and as 0.748). Use tol = 0.6 × 10⁻ᵏ for a value printed with k decimals, unless the text states a precision. Numbers marked "derived" below were computed for this guide by an independent re-implementation on Chromogen's st-data; store them with `"source": "derived"` and regenerate them from your own code before trusting them.

**Chapter 1 (stage 1), conventions CHROMOGEN unless noted:**

| Quantity | Value | Section |
|---|---|---|
| grey card, narrowband green channel density | 1.538 (mean T 0.02895) | §1.1 |
| grey card spectral density at 550 nm | 1.4662 (C −0.0264, M 0.888, Y 0.0022, base 0.6024) | §1.2 |
| two-wavelength soft minimum, densities 0 and 2 | 0.297 | §1.3 |
| grey card, red channel: narrowband / white LED | 0.977 vs mean 0.981 / 0.876 vs mean 0.940 | §1.3 |
| white-LED red Hessian eigenvalues at grey | −0.364, −0.024, −0.0001 | §1.3 |
| narrowband centroids | 656.5, 530.4, 450.8 nm | §1.4 |
| narrowband diagonals: tangent / secant | 1.142, 1.239, 1.149 / 1.131, 1.222, 1.146 | §1.4 |
| white-LED K secant and tangent at zero | matrices in 2.4 | §1.4 |
| linear-solve errors for four K constructions | table in 2.4 | §1.6 |
| singular values: narrowband secant; white LED | 1.226, 1.144, 1.130 (cond 1.09); 0.853, 0.571, 0.213 (cond 4.00) | §1.4 |
| white LED: grey minus rebate; dyes alone | (0.556, 0.679, 0.884); (0.576, 0.731, 0.890) | §1.6 |
| base relativity identity | agreement to 3×10⁻¹⁶ | §1.6 |
| sigmoid c₂ for flat 18.4 % | −0.816 | §1.8 |
| white-LED base-weighted K (derived) | (0.456 0.350 0.013 / 0.107 0.856 0.039 / 0.008 0.275 0.803) | this guide |

**Chapter 2 (stage 2), conventions SPEKTRAFILM unless noted:**

| Quantity | Value | Section |
|---|---|---|
| lights factor out | x(D, ℓ) − x(D, 0) − ℓ ≤ 2×10⁻¹⁶ | §2.8 |
| greyPatch lights, grey card, 3,200 K lamp (CHROMOGEN) | (−0.454, −0.503, −0.471) | §2.6 |
| ∂x/∂v per CC at neutral pack, unnormalised | diag (−0.0092, −0.0087, −0.0100); off-diag (−0.0007, −0.0016) | §2.6 |
| ∂x/∂v, normalised | rows (−0.0061, 0.0024, 0.0038), (0.0031, −0.0056, 0.0023), (0.0031, 0.0031, −0.0061); columns sum to 0 | §2.6 |
| neutral pack Portra 400 / Portra Endura | C 0, M 51.57, Y 52.53 | §2.6 |
| mid-grey paper log H, NaN opaque | (0.004, 0.005, −0.009) | §2.6 |
| grey print colour, 5,000 K | (a*, b*) = (−0.5, −4.2) | §2.6 |
| paper 3-CDF model vs table | ≤ 0.0034 | §2.6 |
| paper dyes at grey; slopes | (0.665, 0.548, 0.499); 2.36, 1.98, 1.95 | §2.6 |
| grey card visual density; chain slope; stop | 0.755; 1.33; 0.40 D per stop | §2, §2.6 |
| paper white Y under 5,000 K; densest black | 0.813; 2.37 | §2.7 |
| G&M flare: white D 0.12, 1 % | 2.0 → 1.7548; 1.0 → 0.9682 | §2.7 |
| Studio flare 0.48 %: black; slope | 2.37 → 2.09; 1.33 → 1.30 | §2.7 |
| grey XYZ → adapted → linear → encoded | (0.1706, 0.1750, 0.1686) → (0.1664, 0.1754, 0.2131) → (0.164, 0.177, 0.199) → (0.441, 0.457, 0.483), #70757b | §2.7 |
| knee (0, 1, 6) at d = 0.5, 0.8, 1, 2 | 0.4987, 0.770, 0.891, 0.997 | §2.7 |
| gain 1.25 after / before knee at 0.9 | 1.048 / 0.935 | §2.7 |
| +10 points red at grey | a* = −20.7; density 0.746 → 0.956 (with 0.48 % flare) | §2.7 |
| curve vs shift: +0.1 log H light | +0.021 paper dye near white, +0.219 at grey, +0.092 in shadows; density equivalent 0.198 | §2.8 |

**Chapter 3 (stage 3), conventions CHROMOGEN:**

| Quantity | Value | Section |
|---|---|---|
| J at grey, white LED | (0.447 0.320 0.014 / 0.160 0.724 0.033 / 0.013 0.336 0.728) | §3.2 |
| closed-form J vs central differences | ≤ 3.8×10⁻¹⁰ on 50 random triples | §3.2 |
| analytical start from secant | (1.094, 0.797, 1.323) vs true (0.687, 0.704, 0.864) | §3.2 |
| σ₃: narrowband over [0, 2.4]³; white LED at base, grey, dense yellow | 1.087–1.143; 0.36, 0.305, 0.034 | §3.2 |
| noise 0.005 D → dye scatter at grey: white LED; LEDs | (0.0145, 0.0089, 0.0080); (0.0044, 0.0040, 0.0044) | §3.2 |
| Gauss–Newton residuals, grey, white LED | 0.42, 0.042, 6.4×10⁻⁴, 1.5×10⁻⁷ D | §3.3 |
| LM trace | table in 6.2; first accepted step ρ = 0.991 | §3.3 |
| shadow pixel (0.02, 0.35, 0.45) | active set: 0.10646 D, 4 it, 9 passes; LM: 146 passes, 1.4×10⁻⁴ above at cap | §3.4 |
| table rebuild, mean iterations plain → active | X-T5/Gold 200 13.9 → 2.3; book LEDs 13.9 → 2.2; Status M 14.1 → 2.5; white LED 23.2 → 5.1 | §3.4 |
| nodes at the cap plain → active | 8,885 → 0; 8,906 → 0; 8,908 → 0; 15,040 → 15 | §3.4 |
| unreachable nodes | 24.9 % (narrowband families), 39.7 % (white LED) | §3.4 |
| speed-up | 5.4 to 6.8 times (timing: machine-dependent, assert iterations instead) | §3.4 |
| Gold 200, 640 × 443 | blank 12.6 %, below 9.7 %, gamut 0.05 %, unreachable table 19.3 %, exact 13.7 % | §3.5 |
| Gold 200, 1,090 × 754 | blank 21.5 %, below 7.2 %, gamut 0, unreachable table 21.8 %, exact 17.1 % | §3.5 |
| balance, 3,800 K cast on Portra 400 | layer shifts (+0.166, +0.021, −0.187); lights (+0.085, +0.002, −0.079); max ΔE00 2.4 (lights) vs 14.6 (density) | §3.6 |
| integrate-to-grey α | no cast: α = 0 gives chroma 0.25, full correction on foliage 19.4; 4,300 K cast: six-patch best near 0.75 (3.5 vs 10.5 at α = 0), foliage near 0.25 | §3.6 |
| neutral wedge 1.234 D | reads 1.234000 in every channel | §3.7 |
| wedge with f = 0.5 % | 0, 0.495, 0.981, 1.438, 1.826, 2.090, 2.224; fit with 0.005 D noise f = 0.00503 | §3.7 |
| white patch with f = 0.5 %, narrowband blue | 1.429 → 1.172 D | §3.1 |
| stock identity | five other stocks fit the running frame with residual < 10⁻⁶ D | §3.8 |
| base-weighted start, grey (derived) | 2 iterations, 5 passes | this guide |

### 8.2 Laws

| Law | Statement | Mutant it must catch | Section |
|---|---|---|---|
| bounds | min D over the support ≤ `read(P, D)` ≤ Σ w D | `read` returns the weighted mean | §1.9 |
| base relativity | `read(P, D + b) − read(P, b)` = `read(relativeTo(P, b), D)` to rounding | `relativeTo` forgets to renormalise | §1.9 |
| concavity | `hessian` has no positive eigenvalue and matches finite differences | sign flip in the covariance | §1.9 |
| metamerism | `metamericBlack` leaves XYZ unchanged; it changes film exposure unless the sensitivities lie in the CMF span | projection uses A instead of the CMFs | §1.9 |
| kinds and units | `mul` of a density, `add` of a transmittance, D + logH all throw | remove a guard | §1.1 |
| lights | `exposure(D) + ℓ` equals the exposure with `paperSens[k]·10^ℓ_k`; `Lights.shift` with a density is a type error | lights applied after the paper curve | §2.9 |
| normalisation | with `'midgray-geomean'`, Σ_k ∂x_k/∂v = 0 for the mid-grey | geometric mean replaced by arithmetic | §2.6 |
| flare and adaptation | flare before Bradford equals D65 flare after | adaptation not mapping white to white | this guide |
| knee last | output of `output.display` lies in [0, 1]³ for any input | gain applied after the knee | §2.7 |
| round trip | for c in the box, `solveDyes(D(c))` returns c within tolerance, residual < 10⁻⁶ D | wrong Jacobian column | §3.9 |
| flat wedge | flat d reads d in every channel of every `Channels` | channels not normalised | §3.9 |
| active set never worse | residual with active set ≤ without + 10⁻⁶ D | held dye not masked | §3.9 |
| classify order | below base wins over blank, both over gamut | swapped tests | §3.5 |

The flat-field law of §3.9 belongs to CHB-006.

### 8.3 Conformance, parity and fixtures

- **Conformance:** the reference engine runs CHB-002's generated suite.
- **Parity (for CHB-005):** `tables/` exports f64 tables; tolerances are stated in 5.6 before any run; flips are counted at random keys between nodes, not only at nodes, because node residuals have a gap from 7.6×10⁻⁴ to 0.047 that makes node flips uninformative (§4.7).
- **Fixtures needed:** interim stock data (8 films, 3 papers, camera, LED, CMFs, illuminants, dichroic, neutral filters, 3-CDF models); the Gold 200 sample (`sources/chromogen-studio-1.2/samples/gold200.png`, decoded as u/16 − 2, floored at 0.05, divided by 4,000; rebate box [98, 100, 20, 680], frame [126, 60, 1090, 754], scanner `xt5-fitted`, flipped horizontally, `03-inline.js` sample metadata); the six running-example patches (from `facts.py` via the textbook's book-data, or regenerated with `sigmoid`).

### 8.4 How to know a test can fail

Run every law's mutant in CI. For golden numbers, change one convention (NaN policy, CMFs, start matrix) and confirm the matching fixtures fail; a fixture that passes under both conventions does not distinguish them and should say so in its `note`.

## 9. Risks and open questions

**Blocking decisions (need an answer during stage 2):**

1. **Which conventions reproduce 0.755.** The textbook gives 0.755 with "spektrafilm's data", but does not list every convention. The reading in 6.1 (opaque NaN, database filters, mid-grey normalisation, 5,000 K blackbody, no flare) is an inference. Reproduce (0.004, 0.005, −0.009) first; if 0.755 still does not follow, test the CMF and viewing-light variants and record which one matches.
2. **The default viewing illuminant.** spektrafilm views under the profile's D50, the textbook's numbers use a 5,000 K blackbody. Recipes need one default; fixtures name theirs.

**Non-blocking risks:**

- The textbook's rounding makes some three-decimal goldens ambiguous; the tolerance rule handles it, but watch for values rounded twice.
- Chromogen's paper data lacks the 3-CDF model; until CHB-004 exports it, paper goldens depend on the Filmbench blob.
- APD and Status A tables are not in either interim source; their goldens wait for CHB-004.
- The reference engine is slow at full resolution. Tests should run at the Studio's working size or on crops.
- The base-weighted table key changes CHB-005's table domain; coordinate before CHB-005 hard-codes `A_RANGE`.
- Interim data is CC BY-SA 4.0; keep its attribution with the converted files.

## 10. Proposed contract additions (for CHB-002)

1. **`PhysicsConventions`** as a contract type, with its version included in every table key and node hash, so two engines cannot silently compare results computed under different conventions.
2. **Channel 4 of `film-dyes` from `invert.dyes`** is the solve residual in D. The contract should state per-domain meanings of a fourth channel.
3. **A class-map output for `invert.classify`.** The `mask` domain is one channel in 0..1 and cannot hold four categories. Proposal: a domain `'scan-classes'` (one channel, codes 0 ok, 1 blank, 2 below, 3 gamut), or `invert.classify` returning `Regions`.
4. **`AutoBalance`** shape for `print.lights.auto`: `{ method: 'integrate' | 'grey-patch' | 'none'; alpha: number; analysisLongSide_px: number }`.
5. **Aim selection:** `print.aim: 'grey-0.184' | 'midgray-normalised'`, and the statement that `print.lights.logH` is relative to the aim.
6. **White point of `print-xyz` images:** `ImageInfo.whiteXYZ?: [number, number, number]`, so `view.adapt` and later ops know whether XYZ is relative to the viewing light or to D65.
7. **Scanner `flare`** as a field of the scanner model (already in `FrameRecipe.scan.flare`), documented as a fraction of the open-gate signal.

## 11. References

**Textbook** (`C1/sources/The Mathematics of the Colour Negative.md`): §1.1–1.9 (spectra, Beer–Lambert, soft minimum, K as Jacobian, base, noise, upsampling, API); §2.6–2.9 (printing, viewing, composition laws, API); §3.1–3.9 (scanner, dye solve, LM, active set, classes, balance, calibration, limits, API); §4.2, §4.5, §4.7 (tables, f32 tolerances, fast/slow proofs).

**Code in C1:**

- `various/extracted/chromogen-studio/05-inline.js`: 142–932 (library), 1620–1901 (`model.js`), 2087–2193 (`params.js`), 2508–2543 (`sigmaD`, `classify`), 2679–2692 (`loadSample`), 3409–3492 (WGSL `SOLVE`), 4222–4257 (light arithmetic, grey pick).
- `various/extracted/chromogen-studio/st-data/cg/`: stocks, camera, white LED.
- `various/extracted/filmbench-ide/01-inline.js` 1–701 (engine `FB`), `00-film-data.bin.txt` and `scripts/06-decode-filmbench-film-data.py` (CMFs, illuminants, dichroics, neutral filters, 3-CDF models).
- `various/analysis-chromogen-studio.md`, `various/analysis-filmbench-ide.md`.
- `design-doc/01-chromobench-architecture-and-work-plan.md` (contracts and vocabulary).

**spektrafilm** (`github.com/andreavolpato/spektrafilm`, commit `3bb2c2d`, `src/spektrafilm/`): `runtime/stages/printing.py`, `runtime/stages/scanning.py`, `utils/morph_curves.py`, `utils/gamut_compression.py`, `utils/conversions.py`, `model/glare.py`, `runtime/params_builder.py`.

**Literature:** Hunt, *The Reproduction of Colour*, 6th ed., 13.9–13.10, 14.13–14.20, 16.7; Giorgianni and Madden, *Digital Color Management*, 2nd ed., Eq. 8.1, App. B, App. E; Jakob and Hanika 2019 (sigmoid spectra); Nocedal and Wright (LM as trust region); Bertsekas 1982 (projected Newton); US 6,633,408 (Rozzi); US 6,985,253 (printer points).
