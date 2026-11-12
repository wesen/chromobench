---
Title: 'Intern guide: Stock and reference data pipeline from spektrafilm'
Ticket: CHB-004
Status: active
Topics:
    - data
    - color-science
    - film-emulation
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/scripts/03-check-chromogen-stock-data.py
      Note: existing cross-check of Chromogen stock JSON against upstream; basis of the CI cross-check
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/scripts/06-decode-filmbench-film-data.py
      Note: existing decoder for the Filmbench blob; starting point for the interim-filmbench converter
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: textbook definitions, golden numbers (grey card, NaN is opaque) and the laws the packs must satisfy
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-chromogen-studio.md
      Note: map of Chromogen's loader, scanner models and data layout to verify against
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-filmbench-ide.md
      Note: map of Filmbench's data paths, enlarger and neutral-filter lookup to verify against
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/cg/stocks/kodak_portra_400.json
      Note: a Chromogen stock file with the null (NaN) convention the loader must handle
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/00-film-data.bin.txt
      Note: the decoded Filmbench film-data blob that interim-filmbench is built from
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/film-data-summary.json
      Note: summary of Filmbench's embedded stock data (stocks, arrays, nanRows) to map onto interim-filmbench
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:22.613784137-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Stock and reference data pipeline from spektrafilm

## 1. What this ticket is for

Every number chromobench prints depends on data that nobody in this project measured. The spectral sensitivities of Kodak Portra 400, the dye spectra of its developed image, the orange of its base, the curves that turn exposure into dye, the same quantities for Portra Endura paper, the halogen lamp and dichroic filters of a colour enlarger, the CIE observer that turns a reflectance into a colour: all of it comes from one open-source simulator, **spektrafilm** (`github.com/andreavolpato/spektrafilm`), whose author processed manufacturers' datasheets into machine-readable profiles. CHB-004 brings that data into chromobench in a form the rest of the system can trust.

Concretely, the ticket delivers four things:

- **`tools/spektrafilm-export/`**, a Python program that reads a pinned commit of upstream spektrafilm and writes versioned **data packs**.
- **`packages/data`**, the TypeScript package that ships those packs and a **loader** that verifies them, applies the project's conventions (above all the missing-data convention of Section 6) and hands typed, unit-labelled arrays to the engines.
- A **camera and light pack** with measured camera sensitivities (and, clearly labelled, the illustrative camera and LEDs the prototypes used).
- **Synthetic frames with known truth** in `fixtures/synthetic/`, generated from an independent forward model, which CHB-003, CHB-005, CHB-006 and CHB-012 use as test inputs.

What the photographer sees of this work is a list of stocks and papers in a menu and prints whose colour is right. What the other tickets see is a single function call, `pack.stock('kodak_portra_400')`, that returns the same bytes every time, with a content hash they can put in a table key.

The ticket explicitly does **not** implement physics. It does not compute printing density, solve for dyes or build GPU tables; those are CHB-003, CHB-012 and CHB-005. It does not characterise the photographer's own scanner (CHB-013) and does not add black-and-white stocks (CHB-014 extends the pack format defined here). It does decide what the data *means* wherever the source data is ambiguous, and Section 6 shows that one such decision moves the red layer of a print by 0.18 log H.

Status: nothing under `packages/`, `tools/` or `fixtures/` exists yet. Every path there is planned. The paths under `ttmp/` exist and are read-only for this ticket.

Throughout this guide, **C1** means the CHB-001 ticket directory, `/home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`. **Upstream** means spektrafilm at commit `3bb2c2d` (the commit inspected for this guide; `pyproject.toml` says version 0.3.4, and every profile's `metadata.version` says 0.3.2, created 2026-05-28).

## 2. Background: what a stock profile is

This section explains the data from first principles, using the textbook *The Mathematics of the Colour Negative* (`C1/sources/The Mathematics of the Colour Negative.md`, cited as "textbook §n.m") and its running example, Kodak Portra 400 printed on Kodak Portra Endura.

### 2.1 Spectra on one grid

Light, transmittance and sensitivity are functions of wavelength. Every program in this project stores them as vectors of **81 samples from 380 to 780 nm in 5 nm steps** (textbook §1.1). spektrafilm fixes the same grid in `config.py` (`SPECTRAL_SHAPE = colour.SpectralShape(380, 780, 5)`, line 6), and Chromogen's stock loader refuses any file that is not on it (`C1/various/extracted/chromogen-studio/05-inline.js` line 447). The loader in this ticket does the same. A detector of any kind, whether a film layer, a paper layer, a scanner channel or the eye, multiplies a spectrum by its sensitivity and sums over the 81 samples.

### 2.2 A film profile

A colour negative has three light-sensitive layers. Each forms one dye when developed: the red-sensitive layer forms cyan, the green-sensitive layer magenta and the blue-sensitive layer yellow. A spektrafilm film profile describes each layer with four arrays:

| Upstream field | Shape | Meaning | Unit |
|---|---|---|---|
| `log_sensitivity` | 81 × 3 | log₁₀ of each layer's spectral sensitivity | log₁₀ of a relative sensitivity |
| `channel_density` | 81 × 3 | the **unit dye spectrum** ε_j(λ): spectral density of one unit of dye j | D per dye unit |
| `base_density` | 81 | the **base** b(λ): support, orange mask and fog, present everywhere | D |
| `density_curves` | 256 × 3 | the **characteristic curve** of each layer: dye amount against log exposure | dye units, on a log H grid from −3 to 4 |

Together they give the negative's spectral density at a pixel whose three dye amounts are c = (c_C, c_M, c_Y):

```text
D(λ) = c_C·ε_C(λ) + c_M·ε_M(λ) + c_Y·ε_Y(λ) + b(λ)        transmittance T(λ) = 10^(−D(λ))
```

A concrete instance from textbook §1.2: the grey card of the running example develops to c = (0.687, 0.704, 0.864) on Portra 400. At 550 nm its parts are cyan −0.0264, magenta 0.888, yellow 0.0022 and base 0.6024, which sum to D = 1.4662. (The cyan term is negative because the profile's processed dye spectra dip slightly below zero; every program uses them as they are.) Those three dye amounts are simply Portra 400's three curves read at log H = 0, which is where an 18 % grey card exposes the film by construction; you can see them printed as `D(0)=[0.687, 0.704, 0.864]` when you run `C1/scripts/03-check-chromogen-stock-data.py`.

Upstream profiles carry more than the four arrays:

| Upstream field | Shape | Meaning |
|---|---|---|
| `density_curves_layers` | 256 × 3 × 3 | **sublayer curves**: each layer is coated as fast, medium and slow emulsions; these are their separate curves, indexed `[logH, sublayer, channel]` (`model/density_curves.py` line 40). They sum approximately to `density_curves`, and spektrafilm's grain model uses them (textbook §2.5) |
| `density_curves_model` | `centers`, `amplitudes`, `sigmas`, each 3 × 3, plus `model_type: 'cdfs'` | a fitted parametric curve: per channel, a sum of three normal cumulative distribution functions (Section 2.3) |
| `midscale_neutral_density` | 81 | the spectral density of the film's mid-scale neutral |
| `hanatos2025_adaptation_window_params` | 4 | the **erf4 window** used by spectral upsampling (Section 2.5) |
| `hanatos2025_adaptation_surface_params` | 3 × 15 | a degree-4 correction surface used with the window |

and an `info` block: `stock`, `name`, `type` (`negative` or `positive`), `support` (`film` or `paper`), `stage` (`filming` or `printing`), `use` (`still` or `cine`), `antihalation` (`strong`, `weak`, `no`), `target_print`, `channel_model` (`color`; the enum also allows `bw`, but no black-and-white profile ships), `densitometer` (`status_M` for negatives, `status_A` for papers and slides), `log_sensitivity_density_over_min` (0.2: the density above minimum at which the sensitivities were defined), `reference_illuminant` (D55, T for tungsten-balanced stocks, TH-KG3 for papers) and `viewing_illuminant` (D50, or K75P for cine print film). The `metadata` block carries `version`, `copyright`, `created`, `license`, `citation` and `datasource` strings. Upstream defines all of this as dataclasses in `src/spektrafilm/profiles/io.py` lines 54–164 and validates shapes in lines 300–339.

One field deserves a warning now: whether a stock is a print material is decided by `stage == 'printing'`, not by `support`. Kodak Vision 2383 and 2393 are cine print *films* (`support: film`) used as the print stage. Filmbench stores this as `role: 'print'`; the loader should expose it as `role` too.

### 2.3 A paper profile

Colour paper is a second negative material: three layers, three dyes, its own sensitivities and curves (textbook §2.6). The arrays have the same names. What differs is how spektrafilm evaluates the paper's curve: `develop.develop_print_morph` uses the fitted model, not the table. Per channel,

```text
c_p(x) = Σ_{i=1..3} A_i · Φ((x − μ_i) / σ_i)            Φ = standard normal CDF
```

where x is the paper's log exposure (`utils/morph_curves.py` lines 93–131). The model reproduces the table within 0.0034 (textbook §2.6). At the grey card Portra Endura forms paper dye (0.665, 0.548, 0.499) with slopes 2.36, 1.98 and 1.95, about four times the negative's. Because the print uses the model, the exporter must carry `centers`, `amplitudes` and `sigmas` exactly; they are the paper.

### 2.4 The enlarger: lamp, filters and the neutral pack

An enlarger shines a lamp through filters and the negative onto paper. The paper's log exposure in layer k is

```text
x_k = log₁₀ Σ_λ L(λ) · F(λ) · 10^(−D(λ)) · s_k(λ)  +  ℓ_k
```

with L the lamp, F the filter pack, s_k the paper sensitivity and ℓ_k the printer lights (textbook §2.6). Four pieces of data feed it:

- **The lamp, TH-KG3**: a 3,400 K blackbody through a Schott KG3 heat-absorbing filter (`model/illuminants.py` lines 27–29; the filter is `data/filters/heat_absorbing/schott/KG3.csv`).
- **Dichroic filters**: yellow, magenta and cyan filters whose transmittance in their blocking band is set in **CC units** (colour-correction units: v CC transmit 10^(−v/100) in the band). The default `custom` set is built from error functions with edges at 516 nm (yellow), 500 and 610 nm (magenta) and 607 nm (cyan) and transitions of 12, 8, 8 and 8 nm (`model/color_filters.py` lines 13–24, 58–63). Upstream also ships measured filter curves from Thorlabs, Edmund Optics and Durst (`data/filters/dichroics/*/filter_{c,m,y}.csv`), resampled with an Akima interpolator (`utils/io.py` lines 374–387). A filter wheel at v CC is applied as `1 − (1 − F)(1 − 10^(−v/100))` per filter, multiplied over the three (`color_filters.py` lines 47–56).
- **The neutral print filter table**: for each paper, lamp and film, the C, M, Y values that print the film's mid-grey neutral: `data/filters/neutral_print_filters.json`, indexed `[paper][lamp][film]`. Upstream has one lamp, TH-KG3, for all 8 papers × 20 films. For Portra 400 on Portra Endura it is C 0, M 51.57, Y 52.53 (textbook §2.6; `runtime/params_builder.py` lines 45–72 apply it).
- **Illuminants**: spektrafilm normalises every light to a mean of 1 over the 81 samples (`illuminants.py` lines 37–39). That is the unit the pack must record.

### 2.5 Capture data: spectral upsampling, the erf4 window, DIR and halation

CHB-012 exposes film to a digital RAW photo. It needs four more items from spektrafilm:

- **The hanatos irradiance table.** Going from an RGB pixel to an 81-sample spectrum is ill-posed; spektrafilm's `hanatos2025` method uses a table of smooth spectra indexed by chromaticity (textbook §1.8). The shipped table `data/luts/spectral_upsampling/irradiance_xy_tc.npy` is 192 × 192 × 81 float16 (5.97 MB); its source, `hanatos_irradiance_xy_coeffs_250304.lut`, is a 16-byte header (magic 1234, width 512, height 512), 512 × 512 × 4 float32 sigmoid coefficients and a 421-byte text trailer describing it. Loading code: `utils/spectral_upsampling.py` lines 22–40 and 105–109; the table is loaded at import (line 333).
- **The erf4 window.** Before the film's sensitivities are contracted with the table, each film multiplies them by a band-pass window of two error-function edges, `½(1 + erf((λ − c_uv)/(σ_uv√2))) · ½(1 − erf((λ − c_ir)/(σ_ir√2)))` (lines 263–274), renormalised so each layer's response to the reference illuminant is unchanged (lines 360–368). For Portra 400 the parameters are c_uv = 433.49, σ_uv = 31.56, c_ir = 593.13, σ_ir = 68.76 nm. Papers have no window.
- **DIR coupler matrices.** Development in one layer inhibits development in the others; spektrafilm models it with a 3 × 3 matrix M (donor rows R, G, B; receiver columns) applied to log exposure before the curve (textbook §2.3). The values are not in the profiles. They are code: `runtime/params_builder.py` lines 161–215 sets per-type values (for negatives the diagonal 0.336, 0.319, 0.273 and off-diagonals R→G 0.353, R→B 0.302, G→R 0.154, G→B 0.353, B→R 0.168, B→G 0.226, the "0.42 alpha" set), overrides Velvia 100 and Provia 100F, and the schema defaults in `runtime/params_schema.py` lines 130–141 are a different set ("0.5 alpha"), together with the inhibitor's spatial spread (Gaussian 20 µm plus 6 % of an exponential of 200 µm). `model/couplers.py` lines 41–66 assembles the matrix.
- **Halation presets.** Light reflected from the back of the base re-exposes the emulsion. `params_builder.py` lines 233–252 key the strength and width by `(use, antihalation)`: still film σ_h = 65 µm, cine 50 µm; strengths per R, G, B layer (0.015, 0.005, 0) for strong antihalation, (0.08, 0.02, 0) for weak, (0.30, 0.10, 0.015) for none. The in-emulsion scatter defaults live in `params_schema.py` lines 104–126.

### 2.6 The observer

To turn a print's reflectance into a colour, the engine needs the **CIE 1931 2° colour-matching functions** x̄, ȳ, z̄ tabulated on the grid. spektrafilm takes them from the `colour-science` package (`config.py` line 9) and the standard illuminants D50, D55, D65 from the same package, plus `T` (incandescent) and `K75P` (Kinoton 75P projector) from its light-source tables (`illuminants.py` lines 23–35). Chromogen, by contrast, used an analytic fit to the CMFs (`C1/various/analysis-chromogen-studio.md` §6.2); the architecture asks for the tabulated CIE functions.

## 3. Where CHB-004 sits in the system

```text
  github.com/andreavolpato/spektrafilm @3bb2c2d (Python, GPLv3 code, CC BY-SA 4.0 data)
        │  imported, never vendored into the app
        ▼
  tools/spektrafilm-export ──► packages/data/packs/spektrafilm@0.3.2+3bb2c2d/   (versioned, hashed)
        │      ▲                 packages/data/packs/cameras-measured@…/        (separate licence)
        │      │ interim          packages/data/packs/interim-{filmbench,chromogen}/
        │      └─ C1 extracted Filmbench and Chromogen data
        │
        ├──► fixtures/synthetic/…   (frames + truth.json, from spektrafilm + a numpy scanner model)
        └──► fixtures/golden/spektrafilm/…  (upstream regression baselines, converted)

  packages/data/src/loader.ts ──► StockData, Spectrum81, NeutralPack, CameraData …
        │ consumed by
        ├── @chromobench/core (CHB-003 print chain and inversion, CHB-012 film)
        ├── @chromobench/gpu (CHB-005 tables, keyed by content hashes)
        ├── @chromobench/ingest (CHB-006 stock ranking from the rebate)
        ├── @chromobench/contract registry (CHB-002: valid stockId values for ArgSpec)
        └── CHB-014 (black-and-white stock types extend the pack format)
```

**Domains.** Data packs are not images, so CHB-004 reads and writes no image domain. The synthetic frames are images, and each carries an `ImageInfo.domain` from the contract: `camera-linear` for simulated scanner counts, `scanner-density`, `film-logH`, `film-dyes`, `paper-logH`, `print-xyz` for the truths.

**Contracts consumed.** `Unit`, `Domain`, `ImageInfo` and `Diagnostic` from `@chromobench/contract` (CHB-002, architecture §5). Loader errors are `Diagnostic` records with `code`, `message`, `hint` and `valid` (for did-you-mean on stock names).

**Contracts provided.** The `Pack` and `StockData` types of Section 8, consumed by every engine. Stock ids are what the registry's `ArgSpec` of type `'stockId'` accepts; the conformance suite and the generated docs need the list, which the loader provides. Content hashes are what `Engine.prepare(keys: TableKey[])` uses to key tables "per stock" (architecture §2, last row of the rules table).

**Dependencies.** CHB-004 depends only on CHB-002's types. It is on no one's critical path *because of the interim packs* (Section 5.5): CHB-003 and CHB-005 can start against interim data converted from the Filmbench and Chromogen prototypes, and switch to the exporter's packs by changing a pack id. The architecture says the same ("interim data from Filmbench and Chromogen", work plan table, CHB-003 row).

## 4. Upstream spektrafilm as it actually is

Clone it next to your work, not into the repository:

```text
git clone https://github.com/andreavolpato/spektrafilm.git && git -C spektrafilm checkout 3bb2c2d
```

The facts below were checked at that commit.

| What to export | Where it lives upstream | Notes |
|---|---|---|
| 28 profiles (20 films, 8 papers) | `src/spektrafilm/data/profiles/*.json`; list in `model/stocks.py` | JSON `null` is NaN: `profiles/io.py` `_json_safe` (lines 286–297) writes NaN as `null`, and loading converts `None` to NaN through `np.asarray(…, dtype=float)` (line 145 onwards) |
| Profile schema | `profiles/io.py` lines 16–21 (enums), 54–164 (dataclasses), 300–339 (validation) | validation requires 3 columns even for `channel_model: 'bw'` |
| Neutral print filters | `data/filters/neutral_print_filters.json`, read by `utils/io.py` lines 354–368 | `[paper][lamp][film] → [C, M, Y]` in CC; only `TH-KG3` |
| Dichroic sets | `model/color_filters.py` lines 13–63; `data/filters/dichroics/{thorlabs,edmund_optics,durst_digital_light}` | `custom` is the default in `color_enlarger` (line 125) |
| Lamps and illuminants | `model/illuminants.py` lines 19–44; `data/filters/heat_absorbing/schott/KG{1,3,5}.csv` | mean-1 normalisation; `TH-KG3-L` adds a Canon lens transmission |
| CMFs | `config.py` line 9 (colour-science, CIE 1931 2°) | also Stockman–Sharpe cone fundamentals, line 13 |
| Spectral upsampling | `utils/spectral_upsampling.py`; `data/luts/spectral_upsampling/` | window lines 263–274; table load lines 105–109, 333 |
| DIR matrices | `runtime/params_builder.py` 161–215; `params_schema.py` 130–141; `model/couplers.py` 41–66 | values are code, not data |
| Halation | `runtime/params_builder.py` 233–252; `params_schema.py` 104–126 | keyed by `(use, antihalation)` |
| Regression baselines | `tests/baselines/*.npz` (5 cases) and `tests/regression_baselines.py` | grey ramps through Portra 400 on Endura and Pro 400H on Crystal Archive; a green patch |

Three upstream facts shape the design.

**Missing values are NaN and they matter.** Most negative films have `null` base density below 400 nm and above 700 nm (Portra 400: 380–395 and 705–780 nm, 20 rows; the Vision3 250D, 200T and 500T only below 400 nm) and `null` dye density at the ends (Portra 400: all three dyes at 380 nm, cyan from 750 nm, all three from 755 nm). The slide films and the print materials have no base gaps, but papers have `null` dye densities: Portra Endura at 380–400 nm and 700–780 nm. How spektrafilm reads them is spread over several functions: `utils/conversions.py` line 24 sets the transmitted light to zero wherever 10^(−D) is NaN, so a NaN density is **opaque**; `runtime/stages/printing.py` lines 76–77 and `filming.py` lines 96–97 apply `np.nan_to_num` to 10^log_sensitivity, so a NaN sensitivity is **zero sensitivity**. Section 6 builds on this.

**Some profiles share arrays.** Running a pairwise comparison over the 28 upstream profiles shows that Kodak Supra Endura's `log_sensitivity` is identical to Portra Endura's and its `base_density` identical to Fujifilm Crystal Archive Type II's, and that Portra 800 Push 1 and Push 2 share all spectra with Portra 800 (only their curves differ, as they should). Chromogen's analysis reported the Supra Endura duplication as an oddity of the prototype (`C1/various/analysis-chromogen-studio.md` §3.2); it is upstream's, and the exporter must reproduce it, not repair it. `model/stocks.py` also flags `kodak_ultra_endura` as "problematic" in a comment. These go into the pack's `knownIssues` list (Section 7.5).

**Licences differ between code and data.** `pyproject.toml` declares the code GPLv3, and the README says JSON profiles and LUTs are CC BY-SA 4.0, under the preamble in `SPEKTRAFILM_LICENSE.txt` (v1.1, 2026-05-28; a byte-identical copy is in `data/license/`). Section 12 works through the consequences.

## 5. What exists today and how to use it

Two prototypes embedded spektrafilm data. They are older snapshots, decoded by CHB-001's scripts, and they let the other tickets start before the exporter exists.

### 5.1 Filmbench IDE's decoded bundle

Filmbench embeds a base64, zlib-compressed JSON blob (`C1/various/extracted/filmbench-ide/00-film-data.bin.txt`). `C1/scripts/06-decode-filmbench-film-data.py` decodes it and writes the shape summary `film-data-summary.json`; `C1/scripts/05-extract-filmbench-vfs.py` extracts the IDE's built-in scripts, which you need only to see how the data was used. `C1/various/analysis-filmbench-ide.md` §4 describes the content. Its mapping to upstream:

| Filmbench | Upstream | How it differs |
|---|---|---|
| `wl[81]` | `wavelengths` | same grid |
| `profiles[id].logSens[81][3]` | `log_sensitivity` | rounded to 4 decimals |
| `.chan[81][3]` | `channel_density` | rows listed in `nanRows` are set to 0 |
| `.base[81]` | `base_density` | rows listed in `nanRows` are set to **99.0 D** |
| `.nanRows` | — | indices of rows where base **or** any dye was NaN (Portra 400: 0–3 and 65–80, i.e. 380–395 and 705–780 nm) |
| `.curves[256][3]` | `density_curves` | rounded to 4 decimals |
| `.model{centers, amps, sigmas}` | `density_curves_model` | `amps` is upstream's `amplitudes` |
| `.lut` (base64 deflate of 12,288 int16) | — | a 64 × 64 × 3 film exposure table, log₂ values × 1024, decoded by `FB.decodeLuts` (`01-inline.js` lines 96–106) |
| `neutral_filters[paper][film]` | `[paper]['TH-KG3'][film]` | the lamp level is flattened away |
| `dichroic[81][3]` | the `custom` erf set | — |
| `illuminant{D50, D55, D65, T, K75P, TH-KG3}` | `standard_illuminant(...)` | mean-1 normalised |
| `cmf[81][3]` | CIE 1931 2° | x̄, ȳ, z̄ at 555 nm = (0.51205, 1.0, 0.00575) |
| `rgb2xyz_cat16`, `xyz2rgb`, `illuminant_xyz` | computed with colour-science | derived matrices, not spektrafilm data |

Filmbench lacks the sublayer curves, `midscale_neutral_density`, the erf4 window and correction surface, the halation and DIR tables (it hard-codes its own simplified constants, `analysis-filmbench-ide.md` §3) and the hanatos table (its 64 × 64 film tables are a precomputed substitute).

Note the 99.0: Filmbench encodes "missing" as a density so large that the row is opaque, which is spektrafilm's convention expressed without NaN. It also means Filmbench threw away the real dye densities in those rows (for Portra 400, the 385–395 nm dye values that Chromogen still has). Under the opaque convention nothing is lost; under any other convention Filmbench data cannot be used.

### 5.2 Chromogen Studio's stocks

Chromogen embeds 13 data files in `window.ST_DATA`. `C1/scripts/02-inventory-chromogen-st-data.py` unpacked them to `C1/various/extracted/chromogen-studio/st-data/cg/`: 8 films and 3 papers in `stocks/`, an illustrative camera in `cameras/generic-bayer.json` and an illustrative white LED in `lights/white-led.json`. `C1/scripts/03-check-chromogen-stock-data.py` prints null ranges, peaks, duplicated arrays and neutral slopes; `C1/various/analysis-chromogen-studio.md` §3 summarises them.

A Chromogen stock file is `{info: {stock, name, type, densitometer, target_print}, metadata: {license}, data: {wavelengths, log_sensitivity, channel_density, base_density, log_exposure, density_curves}}` with JSON `null` kept where upstream has NaN. The values are upstream's rounded to 5 decimals. The loader (`05-inline.js` lines 440–465) is where Chromogen's convention lives: a null sensitivity becomes 0 (line 449, same as spektrafilm), but a null dye density becomes 0 (line 450) and a null base density becomes 0 (`v || 0`, line 459). That is the **zero-density** convention, the opposite of spektrafilm's for densities. Chromogen has no sublayers, no fitted model, no window, no DIR or halation data and no neutral filter table.

The camera file says of itself "Illustrative Bayer camera: Gaussian sensitivities peaking near 600, 535 and 460 nm (facts.py). Not a measured camera" (FWHM about 80, 90 and 70 nm), and the LED "Illustrative white LED: blue pump at 450 nm plus a phosphor (facts.py). Not a measured product." The Studio's `xt5-fitted` scanner is this camera behind Gaussian LEDs at 678, 532 and 472 nm with an assumed FWHM of 20 nm (`05-inline.js` lines 1645–1648).

### 5.3 How the three sources agree

These comparisons were made for this guide with small read-only Python scripts over the C1 files and an upstream checkout. The exporter's `crosscheck` command (Section 9.4) must reproduce them:

| Comparison | Arrays | Largest difference |
|---|---|---|
| Chromogen vs upstream, 11 shared stocks | sensitivities, dyes, base, curves | 5 × 10⁻⁶ (5-decimal rounding); identical null pattern |
| Filmbench vs Chromogen, 11 shared stocks | `logSens`, `curves` | 5 × 10⁻⁵ (4-decimal rounding) |
| Filmbench vs Chromogen | `chan`, `base` outside `nanRows` | 0 |
| Filmbench `model` vs upstream `density_curves_model`, 28 stocks | centres, amplitudes, sigmas | 5 × 10⁻⁷ |
| Filmbench `dichroic` vs upstream's `custom` erf formula | 81 × 3 | 4.8 × 10⁻⁷ |
| Filmbench `TH-KG3` vs 3,400 K blackbody × KG3 resampled *linearly* | 81 | 0.14 % relative (median 0.03 %); the residual is upstream's Akima interpolation |
| Filmbench `neutral_filters` vs upstream TH-KG3 table | 8 × 20 × 3 | identical (Portra 400 on Endura: 0, 51.568, 52.534) |

Two consequences. First, the prototypes are faithful copies of upstream at slightly lower precision, so they are good interim fixtures. Second, every tolerance in the exporter's cross-check can be stated in advance from this table: 5 × 10⁻⁶ against Chromogen, 5 × 10⁻⁵ against Filmbench, exact for dyes, base and the filter table, 2 × 10⁻³ for TH-KG3 if you do not reproduce Akima.

### 5.4 What each source lacks

| Item | Upstream | Filmbench | Chromogen |
|---|---|---|---|
| Film and paper spectra and curves | 20 + 8 | 20 + 8 | 8 + 3 |
| Sublayer curves, midscale neutral | yes | no | no |
| Paper 3-CDF model | yes | yes | no |
| erf4 window, correction surface | yes | no | no |
| DIR, halation presets | code | no (own constants) | no |
| Neutral filter table | yes | yes (TH-KG3 only) | no |
| Dichroics, TH-KG3, illuminants, CMFs | yes | yes | no (blackbodies, analytic CMFs in code) |
| Hanatos table | yes | 64 × 64 per-film substitute | no |
| Measured cameras | no | no | no (illustrative only) |

### 5.5 Interim packs

The interim packs are the same pack format as the exporter's, written by `tools/spektrafilm-export/interim.py` from the C1 files:

- **`interim-filmbench`** converts every `nanRows` row back to NaN in both base and dyes, maps fields per the table in 5.1, keeps the neutral table under lamp `TH-KG3`, and stores the 64 × 64 film tables as `film-exposure-lut64` tensors for CHB-012 to use until the hanatos table is wired. Its manifest lists `missing.supported: ['opaque']`, because the zero-density convention cannot be reproduced from it.
- **`interim-chromogen`** converts the 11 stocks, keeping nulls as NaN. It supports every missing-data policy but has no paper model; a paper from this pack uses its table (`density_curves`), and the loader reports `W_STOCK_NO_MODEL` when an engine asks for the model.

Both manifests carry `source.kind: 'interim'` and the SHA-256 of the C1 file they came from. When the exporter lands, the cross-check (Section 9.4) compares its pack against both interim packs with the tolerances of Section 5.3, and the engines switch by pack id. Nothing else changes.

## 6. Missing data: the convention

This is the most consequential decision in the ticket, so it gets its own section.

### 6.1 The finding

Textbook §2.6 ("A finding: NaN is opaque") reports that a first port of spektrafilm's printing stage printed the grey card cyan (a* = −19) with the database's neutral filters. The cause: Portra 400's base density is NaN from 705 nm up, spektrafilm reads NaN as opaque, Chromogen reads it as zero density, and Portra Endura's red layer is sensitive exactly there. Its red log sensitivity peaks at 705 nm (script 03 prints `logS peak (0.21915, 705.0)` for layer 0).

Recomputing the effect from the interim data for this guide shows its size. Take the grey card's dyes c = (0.687, 0.704, 0.864) on Portra 400 (the curves read at log H 0, which is how spektrafilm builds its mid-grey for this normalisation: `filming.py` lines 125–150, without DIR coupling); form D(λ); multiply 10^(−D) by the TH-KG3 lamp, the `custom` dichroics at the neutral pack (0, 51.57, 52.53) and Endura's sensitivities; sum; take log₁₀; subtract the mean of the three layers (which is what spektrafilm's mid-grey normalisation does, `printing.py` lines 102–124). The result, per paper layer R, G, B:

| Convention for NaN density | Normalised paper log H of the grey card | Spread (max − min) |
|---|---|---|
| opaque (spektrafilm) | (0.004, 0.005, −0.009) | 0.014 |
| zero density (Chromogen) | (0.111, −0.072, −0.038) | 0.183 |

The opaque row reproduces the textbook's (0.004, 0.005, −0.009) exactly. Read as zero density, the red layer gets 0.18 log H more exposure than the green, about seven printer points (one point is 0.025 log H), which is the "0.18 log H red error" of the textbook. The same computation without filters shows that 26.8 % of the lamp-weighted red sensitivity lies at 705 nm and above (the textbook's "27 %").

Over all 128 pairs of a negative film and a print material in Filmbench's data, the same normalised spread has a median of **0.032** log H with NaN as opaque and **0.52** with NaN as zero (worst cases 0.19 and 1.17, both on the cine print film 2393). The neutral filter table is a fit to the opaque convention. Used with any other convention it is wrong by tens of CC.

### 6.2 What each missing value means

Upstream does not state a convention; it is implied by how each array is used. The pack must state it per field:

| Field | Where NaN occurs | Meaning adopted | Upstream behaviour it matches |
|---|---|---|---|
| film `base_density` | below 400 nm, above 700 nm (most negatives) | **opaque**: transmittance 0 | `density_to_light` (`conversions.py` 24) |
| film `channel_density` | ends of the range | **opaque** | same: D(λ) is NaN for every dye amount |
| paper `channel_density` | Endura 380–400, 700–780 nm | **opaque** in reflectance: the print reflects nothing there | `scanning.cmy_to_log_xyz` (textbook §2.7) |
| `midscale_neutral_density` | same rows as base | opaque | — |
| `log_sensitivity` | none at this commit | **zero sensitivity** | `nan_to_num` in `printing.py` 77, `filming.py` 97 |
| camera responsivity (Section 10) | outside the measured range | zero, flagged | — (no upstream equivalent) |

### 6.3 The base gaps and the scanner side

The base is missing outside 400–700 nm (textbook §1.6, "A gap in the data"). That is not a physical property of film: real base and mask have some density at 720 nm. Neither zero nor opaque is true; they are bounds. The gap matters only where a channel has weight outside 400–700 nm:

- narrowband LEDs, the white-LED camera and Status M: almost none (Status M red puts 0.4 % of its weight there);
- the Academy's APD red channel: 16 %;
- the printing-density red channel (Endura × lamp): 37 %. Extending the base flat from its last measured value raises the rebate's red printing density from 0.143 to 0.242 (textbook §1.6).

For printing, the neutral table forces the opaque reading. For scanning, the base is measured from the rebate and subtracted (textbook §1.6, §3.1), so the convention matters only through the base-weighted channels and the Studio's narrowband LEDs barely reach 705 nm. Opaque is therefore safe as the single default.

### 6.4 Decision record: one convention, applied by the loader

- **Context.** Two prototypes disagree; the upstream table only works with one reading; missing values are a fact about measurements, not about film.
- **Alternatives.** (a) Pre-fill the pack with zeros (Chromogen). (b) Pre-fill with a large density (Filmbench's 99 D). (c) Keep NaN in the pack and let the loader apply a declared policy, defaulting to opaque, with `zero-density` and `extend-flat` available to tests and research tools.
- **Decision.** (c). Packs store NaN (binary tensors can; JSON cannot, which is one reason for the binary container of Section 7). The loader returns spectra with NaN replaced by 0 **and** a validity mask, so every consumer computes transmittance as `valid[i] ? 10^(−D[i]) : 0` (opaque) without ever doing arithmetic on infinities.
- **Consequences.** Every engine uses one convention; the neutral filter table is valid; the Chromogen behaviour stays reproducible for the parity tests of CHB-003 (`missing: 'zero-density'`); the policy is a loader option, not a recipe field, so photographers cannot change it by accident. A pack whose source already destroyed the information (interim-filmbench) refuses any policy but opaque with `E_DATA_POLICY`.
- **Status.** Proposed; it needs CHB-003's agreement because their print chain is the first consumer.

## 7. The pack format

### 7.1 Layout

```text
packages/data/
  package.json                      "@chromobench/data"
  src/  index.ts loader.ts manifest.ts tensors.ts missing.ts hash.ts errors.ts sources.ts
  test/ loader.test.ts missing.test.ts crosscheck.test.ts
  packs/
    spektrafilm@0.3.2+3bb2c2d/
      manifest.json
      SPEKTRAFILM_LICENSE.txt          verbatim copy, never edited
      CHANGELOG.txt                    what we changed (format, NaN encoding, resampling)
      stocks/kodak_portra_400.json     info, metadata, scalars, tensor index
      stocks/kodak_portra_400.safetensors
      …                                (28 stocks)
      enlarger/neutral-print-filters.json
      enlarger/dichroics.safetensors    custom, thorlabs, edmund_optics, durst_digital_light
      light/illuminants.safetensors     D50 D55 D65 T K75P TH-KG3 TH-KG3-L
      cie/cmf-1931-2deg.safetensors
      presets/dir-couplers.json  presets/halation.json  presets/grain.json
      upsampling/hanatos2025-irradiance-xy-tc.safetensors   (F16, 192 × 192 × 81)
    cameras-measured@2026.1/          separate licence (Section 12)
    illustrative@1/                    the Studio's camera and LEDs, regenerated from parameters
    interim-filmbench@1/  interim-chromogen@1/
tools/spektrafilm-export/              Python; LICENSE is GPL-3.0 (Section 12)
fixtures/golden/spektrafilm/           converted regression baselines
fixtures/synthetic/                    Section 11
```

### 7.2 JSON for structure, binary for numbers

Small structured items (stock info, metadata strings, presets, the neutral filter table, manifests) are JSON. Numeric arrays are **safetensors** files: an 8-byte little-endian header length, a JSON header mapping each tensor name to `{dtype, shape, data_offsets}` plus a string-to-string `__metadata__`, then the raw little-endian bytes (the format of `github.com/huggingface/safetensors`). The Python writer is the `safetensors` package; the TypeScript reader is about 60 lines in `tensors.ts`.

Decision record, container:

- **Context.** NaN must survive (JSON has no NaN), arrays must load into `Float64Array` and GPU buffers without parsing, and content hashes should be computed over bytes.
- **Alternatives.** Plain JSON arrays (NaN as `null`, slow to parse for the 6 MB table); `.npy` per array (needs a parser for each dtype and order, many small files); a custom header + blob (works, but undocumented); safetensors (documented, Python writer exists, supports F64, F32, F16).
- **Decision.** safetensors for tensors; JSON sidecars for meaning (units, missing policy, provenance) because safetensors metadata is only strings.
- **Consequences.** One small reader to maintain; the writer must pad the header so data starts 8-byte aligned (the reader copies if it does not, and the test checks alignment).

Decision record, precision: per-stock tensors are **F64** (they are small, about 30 KB per stock, and the reference engine is f64, so nothing downstream has to wonder about a rounding step); the hanatos table stays **F16** as upstream ships it; nothing is down-converted. Upstream data has 5–6 significant digits, so the choice is about having one less source of disagreement, not about accuracy.

### 7.3 Units in names

The architecture rule is "units are in names where a number could be misread" (§8.3). Tensor names in packs are snake_case with the unit last; TypeScript fields are camelCase with an underscore before the unit, as in the architecture's `time_s` and `umPerPx`:

| Pack tensor | TS field | Unit meaning |
|---|---|---|
| `log10_sensitivity` | `log10Sensitivity` | log₁₀ of relative spectral sensitivity, normalised as upstream |
| `unit_dye_density_D` | `unitDyes_D` | density per dye unit |
| `base_density_D` | `base_D` | density |
| `midscale_neutral_density_D` | `midscaleNeutral_D` | density |
| `log_exposure_logH` | `logExposure_logH` | log₁₀ exposure, grey card = 0 |
| `dye_amount_curves` | `dyeCurves` | dye units (curve minimum not yet subtracted; Section 8 says who subtracts) |
| `sublayer_dye_amount_curves` | `sublayerCurves` | dye units, `[logH][sublayer][channel]` |
| `spd_rel_mean1` | `spd_relMean1` | relative spectral power, mean 1 over the grid |
| `transmittance_fraction` | `transmittance` | 0…1 |
| `cmf_xyz_2deg` | `cmf` | CIE tristimulus weights |

Scalars in JSON follow the same rule: `sigma_h_um`, `diffusion_size_um`, `filter_neutral_cc`, `window_c_uv_nm`, `window_sigma_uv_nm`.

### 7.4 Versioning and hashes

- **Pack id**: `<source>@<source version>+<source commit>`, for example `spektrafilm@0.3.2+3bb2c2d`. A new upstream commit is a new directory; old packs are kept until no fixture refers to them.
- **`schemaVersion`**: an integer for the pack format itself, starting at 1. The loader refuses a higher schema version than it knows (`E_DATA_SCHEMA`).
- **File hashes**: the manifest lists every file with its SHA-256 and byte length. The loader verifies a file the first time it reads it (`E_DATA_HASH` on mismatch), with `crypto.subtle.digest` in the browser and `node:crypto` in tests.
- **Item hashes**: each stock, illuminant, filter set and table has a `contentHash`: SHA-256 over its canonical JSON (sorted keys, no whitespace, licence strings excluded) followed by its tensor bytes in name order. These are what `TableKey`s carry: a dye-solve table keyed by `scanner.contentHash + stock.contentHash` is reused across sessions and rebuilt only when the bytes change.
- **Pack hash**: SHA-256 of the canonical manifest. A frame's recipe should record it (proposed addition below) so that replaying an edit log against different data is detected.
- **Determinism**: the exporter writes no timestamps of its own (it copies upstream's `created`), sorts keys, and writes floats through numpy's exact binary representation, so re-running it on the same commit produces identical hashes. CI checks this.

### 7.5 The manifest

```json
{
  "schemaVersion": 1,
  "packId": "spektrafilm@0.3.2+3bb2c2d",
  "source": { "kind": "upstream", "repo": "https://github.com/andreavolpato/spektrafilm",
              "commit": "3bb2c2d2801ff68b92019cf1dbcbb133d60832bc", "profileVersion": "0.3.2",
              "exporter": "spektrafilm-export 0.1.0" },
  "grid": { "start_nm": 380, "step_nm": 5, "count": 81 },
  "logExposureGrid": { "start_logH": -3, "stop_logH": 4, "count": 256 },
  "missing": { "default": "opaque", "supported": ["opaque", "zero-density", "extend-flat"] },
  "license": { "spdx": "CC-BY-SA-4.0", "file": "SPEKTRAFILM_LICENSE.txt", "changelog": "CHANGELOG.txt",
               "attribution": "Derived from spektrafilm by Andrea Volpato, https://github.com/andreavolpato/spektrafilm, CC BY-SA 4.0. Converted by chromobench." },
  "items": [
    { "kind": "stock", "id": "kodak_portra_400", "role": "film", "files": ["stocks/kodak_portra_400.json", "stocks/kodak_portra_400.safetensors"],
      "contentHash": "sha256:…", "missingRows_nm": { "base": [380, 395, 705, 780], "dyes": [380, 380, 750, 780] } }
  ],
  "files": [ { "path": "stocks/kodak_portra_400.safetensors", "bytes": 31872, "sha256": "…" } ],
  "knownIssues": [
    { "id": "supra-endura-shared-arrays", "items": ["kodak_supra_endura"],
      "text": "log10_sensitivity identical to kodak_portra_endura; base identical to fujifilm_crystal_archive_typeii (upstream data)" },
    { "id": "ultra-endura-problematic", "items": ["kodak_ultra_endura"], "text": "flagged 'problematic' in upstream model/stocks.py" }
  ]
}
```

`missingRows_nm` is a run-length summary (pairs of first and last wavelength) so a reviewer can read the gaps without opening the binary.

## 8. The loader API

The loader is the only way engines see data. Sketch (planned file `packages/data/src/index.ts`; names are proposals for CHB-002 to accept):

```ts
// packages/data/src/types.ts (sketch)
import type { Diagnostic } from '@chromobench/contract';

export type MissingPolicy = 'opaque' | 'zero-density' | 'extend-flat';
export type Role = 'film' | 'print';                       // from info.stage: filming → film, printing → print

export interface Spectrum81 {                              // always on the 380–780 / 5 nm grid
  values: Float64Array;                                    // NaN replaced by 0
  valid: Uint8Array;                                       // 1 where the source had a number
  unit: 'D' | 'log10' | 'relMean1' | 'fraction' | 'cmf';
}

export interface StockData {
  id: string; name: string; role: Role;
  type: 'negative' | 'positive'; support: 'film' | 'paper';
  use: 'still' | 'cine'; antihalation: 'strong' | 'weak' | 'no';
  channelModel: 'color' | 'bw';                            // CHB-014 extends
  densitometer: 'status_M' | 'status_A';
  referenceIlluminant: string; viewingIlluminant: string; targetPrint?: string;
  sensitivityDensityOverMin_D: number;                     // 0.2 upstream
  log10Sensitivity: [Spectrum81, Spectrum81, Spectrum81];  // R, G, B layers
  unitDyes_D: [Spectrum81, Spectrum81, Spectrum81];        // C, M, Y
  base_D: Spectrum81;
  midscaleNeutral_D?: Spectrum81;
  logExposure_logH: Float64Array;                          // 256 samples, −3 … 4
  dyeCurves: [Float64Array, Float64Array, Float64Array];   // as stored; minima NOT subtracted
  sublayerCurves?: Float64Array;                           // 256 × 3 × 3, [logH][sublayer][channel]
  curveModel?: { kind: 'cdfs'; centers: number[][]; amplitudes: number[][]; sigmas: number[][] };
  hanatosWindow?: { c_uv_nm: number; sigma_uv_nm: number; c_ir_nm: number; sigma_ir_nm: number };
  hanatosSurface?: number[][];                             // 3 × 15
  missing: MissingPolicy;
  contentHash: string;
  knownIssues: string[];
  attribution: string;                                     // shown in the About screen and exported files
}

export interface Pack {
  readonly manifest: PackManifest;
  stockIds(filter?: { role?: Role; type?: 'negative' | 'positive' }): string[];
  stock(id: string, opts?: { missing?: MissingPolicy }): Promise<StockData>;
  illuminant(id: string): Promise<Spectrum81>;             // 'D50' | 'D55' | 'D65' | 'T' | 'K75P' | 'TH-KG3' | 'TH-KG3-L'
  cmf(id?: 'cie1931-2deg'): Promise<[Spectrum81, Spectrum81, Spectrum81]>;
  dichroics(set?: 'custom' | 'thorlabs' | 'edmund_optics' | 'durst_digital_light'): Promise<[Spectrum81, Spectrum81, Spectrum81]>;
  neutralFilters(q: { paper: string; lamp: string; film: string }): { c_cc: number; m_cc: number; y_cc: number } | undefined;
  dirPreset(film: string, which?: 'applied' | 'schema-default'): DirPreset;
  halationPreset(use: 'still' | 'cine', antihalation: 'strong' | 'weak' | 'no'): HalationPreset;
  upsamplingTable(id: 'hanatos2025-irradiance-xy-tc'): Promise<{ data: Uint16Array /* f16 bits */; shape: [192, 192, 81] }>;
}

export interface DirPreset { matrix: number[][]; /* donor rows R,G,B; receiver columns */
  diffusionSize_um: number; diffusionTail_um: number; diffusionTailWeight: number; source: string }
export interface HalationPreset { sigmaH_um: [number, number, number]; strength: [number, number, number];
  bounces: number; bounceDecay: number; scatterCore_um: [number, number, number];
  scatterTail_um: [number, number, number]; scatterTailWeight: [number, number, number] }

export interface PackManifest {                            // the JSON of Section 7.5, typed
  schemaVersion: number; packId: string;
  source: { kind: 'upstream' | 'interim' | 'measured' | 'illustrative'; repo?: string; commit?: string; sha256?: string };
  grid: { start_nm: number; step_nm: number; count: number };
  missing: { default: MissingPolicy; supported: MissingPolicy[] };
  license: { spdx: string; file: string; changelog?: string; attribution: string };
  items: { kind: string; id: string; role?: Role; files: string[]; contentHash: string }[];
  files: { path: string; bytes: number; sha256: string }[];
  knownIssues: { id: string; items: string[]; text: string }[];
}

export interface DataSource { read(path: string): Promise<ArrayBuffer> }   // fetch() in the app, fs in node
export declare function openPack(src: DataSource, packId: string): Promise<Pack>;
export declare function transmittance(D: Float64Array, valid: Uint8Array, out?: Float64Array): Float64Array;
```

How it is used. The Studio app serves `packages/data/packs/` as static files next to the PWA, and `DataSource` is a thin wrapper over `fetch` (the browser's HTTP cache and the service worker do the caching). Node tests and the conformance suite use a file-system `DataSource`. A pack is opened once per session; items load lazily, so the 6 MB hanatos table is fetched only when CHB-012 first exposes film to a RAW photo. Engines never read pack files themselves.

Behaviour that the sketch does not show:

- **Unknown names** return `{code: 'E_STOCK_UNKNOWN', message, valid: [closest ids]}` as a `Diagnostic` thrown inside an `Error`, the did-you-mean pattern of Filmbench's diagnostics and goja-cv's errors (architecture §5.5).
- **Known issues** produce a `W_STOCK_KNOWN_ISSUE` warning the first time the stock is loaded in a session, so the DSL can show it to the agent.
- **Curve minima.** spektrafilm's `develop` subtracts each curve's minimum before use (textbook §2.2). The loader returns the stored curves unchanged and documents that the *film develop op* owns the subtraction, so there is exactly one place where it happens.
- **`extend-flat`** fills missing base and dye rows with the nearest measured value (the textbook §1.6 assumption) and sets `valid` to 1; it exists for experiments only.
- **DIR presets** come in two flavours because upstream has two: `'applied'` is what `digest_params` applies for the stock (negative, positive, or a stock override); `'schema-default'` is what a caller who skips `digest_params` gets. CHB-012 should use `'applied'`.

## 9. The exporter

### 9.1 Layout

```text
tools/spektrafilm-export/
  pyproject.toml            Python ~=3.13; depends on spektrafilm @ git+…@3bb2c2d, safetensors, numpy
  LICENSE                   GPL-3.0 (this tool imports spektrafilm)
  spektrafilm_export/
    __main__.py             CLI: export | interim | cameras | synthetic | crosscheck
    profiles.py  enlarger.py  light.py  presets.py  upsampling.py  baselines.py
    packwriter.py           safetensors + sidecars + manifest + hashes
    interim.py  cameras.py  synthetic.py  crosscheck.py
  tests/
```

### 9.2 Principle: ask spektrafilm, do not re-derive

Wherever upstream computes a value, the exporter calls upstream's own function, so the pack contains what spektrafilm would use: `load_profile` for profiles, `standard_illuminant('TH-KG3')` for the lamp (reproducing the Akima resampling that a re-implementation misses by 0.14 %), `DichroicFilters(brand=…)` for filter sets, `read_neutral_print_filters` for the table, `compute_dir_couplers_matrix` after `digest_params(init_params(film, paper))` for the applied DIR matrices, the module-level `_HALATION_PRESETS` and dataclass defaults for presets, and the same `irradiance_xy_tc.npy` file that `_load_hanatos2025_spectra_lut` reads. The only computation the exporter does itself is format conversion and hashing.

```python
# spektrafilm_export/__main__.py, sketch of `export`
def export(out_dir, commit):
    assert spektrafilm_commit() == commit                 # refuse to export from an unpinned checkout
    w = PackWriter(out_dir, pack_id=f"spektrafilm@{profile_version()}+{commit[:7]}")
    for sid in list_profiles():                           # profiles/io.py
        p = load_profile(sid)
        w.stock(sid, info=asdict(p.info), metadata=asdict(p.metadata),
                tensors={"log10_sensitivity": p.data.log_sensitivity,         # NaN kept
                         "unit_dye_density_D": p.data.channel_density,
                         "base_density_D": p.data.base_density,
                         "midscale_neutral_density_D": p.data.midscale_neutral_density,
                         "log_exposure_logH": p.data.log_exposure,
                         "dye_amount_curves": p.data.density_curves,
                         "sublayer_dye_amount_curves": p.data.density_curves_layers},
                scalars={"curve_model": model_dict(p.data.density_curves_model),
                         "hanatos_window": window_dict(p.data.hanatos2025_adaptation_window_params),
                         "hanatos_surface": p.data.hanatos2025_adaptation_surface_params})
    w.json("enlarger/neutral-print-filters.json", read_neutral_print_filters())
    w.tensors("enlarger/dichroics.safetensors",
              {f"{b}_cmy_transmittance_fraction": DichroicFilters(brand=b).filters
               for b in ("custom", "thorlabs", "edmund_optics", "durst_digital_light")})
    w.tensors("light/illuminants.safetensors",
              {f"{i}_spd_rel_mean1": standard_illuminant(i) for i in ("D50", "D55", "D65", "T", "K75P", "TH-KG3", "TH-KG3-L")})
    w.tensors("cie/cmf-1931-2deg.safetensors", {"cmf_xyz_2deg": STANDARD_OBSERVER_CMFS[:]})
    w.json("presets/dir-couplers.json", dir_presets_for_every_film())   # applied + schema default
    w.json("presets/halation.json", halation_presets())
    w.json("presets/grain.json", asdict(GrainParams()))  # defaults, params_schema.py 88–100; used by CHB-012
    w.tensors("upsampling/hanatos2025-irradiance-xy-tc.safetensors",
              {"irradiance_xy_tc_f16": HANATOS2025_SPECTRA_LUT_RAW})       # float16 as shipped
    w.known_issues(find_shared_arrays() + UPSTREAM_COMMENTS)
    w.copy_verbatim("SPEKTRAFILM_LICENSE.txt"); w.changelog(CHANGES)
    w.finish()                                             # writes files, hashes, manifest
```

`HANATOS2025_SPECTRA_LUT` is converted to double on load (`spectral_upsampling.py` line 108), so read the `.npy` file directly with `numpy.load` to keep float16. The baselines go to `fixtures/golden/spektrafilm/` as JSON with the parameters of `tests/conftest.py::make_fast_test_params` recorded beside them, because the stored outputs depend on those fast settings.

### 9.3 Dependencies and environment

Upstream requires Python ~=3.13 and pins `numpy~=2.4`, `scipy~=1.17`, `colour-science~=0.4.6`, `numba~=0.64`, `OpenImageIO`, `pyfftw`, `rawpy`, `exiv2` and `lensfunpy` among others (`pyproject.toml` lines 15–31). Several are heavy native packages that the exporter never calls but `import spektrafilm` may pull in. Use `uv` with a lock file in `tools/spektrafilm-export/`, and if a native dependency fails to install, import only the submodules you need (`spektrafilm.profiles.io`, `spektrafilm.model.*`, `spektrafilm.utils.io`) and record the workaround in the diary.

### 9.4 The cross-check

`spektrafilm-export crosscheck --pack <new> --against interim-filmbench interim-chromogen` compares every shared item with the tolerances of Section 5.3 and fails on any excess. It also checks the null patterns (Filmbench's `nanRows` must equal the union of the new pack's missing base and dye rows), recomputes the grey-card numbers of Section 6.1 under both policies, and prints the shared-array report so a new upstream duplication shows up as a diff in review.

## 10. Measured camera and LED data

Textbook §3.7 says Chromogen "ships those measurements (`data/cameras/measured.json`, with four more cameras from G. Butcher)". That file belonged to the Chromogen library; it is **not** in the Studio bundle imported in C1, which contains only the illustrative camera and LED. So this stage fetches the measurements from their sources:

| Source | Content | Grid | Licence |
|---|---|---|---|
| Jiang, Liu, Gu and Süsstrunk, WACV 2013; Zenodo record 3245883 (`camspec_database.txt`) | 28 cameras (DSLRs, compacts, industrial, phone), R, G, B each normalised to peak 1 | 400–720 nm, 10 nm (33 bands) | CC BY-NC-SA 4.0 |
| Glenn Butcher, `github.com/butcherg/ssf-data` (spectroscope folders) | Nikon D50, D3500, D7000, Z 6 (single-image spectroscope, reduced with ssftool) | 400–715 nm, 5 nm | CC BY-NC-SA 4.0 |

Butcher's repository also re-hosts the camspec cameras (`*/camspec/`) and third-party sets (`*/openfilmtools/`); take only his four spectroscope measurements from it, so no camera appears twice and no third-party set slips in under the wrong licence.

**Data structure.** One safetensors file per pack with `<camera>_responsivity_native` (the measured samples on their native grid, plus a `<camera>_wavelengths_nm` tensor) and `<camera>_responsivity` resampled linearly to the 81-sample grid, with a validity mask that is 0 outside the measured range. The loader's policy for camera responsivity outside the range is zero (an IR-cut filter makes the far red small, but it is not measured), and `CameraData.measuredRange_nm` says so.

**What to verify.** The textbook recomputed the principal components of the 28 cameras at their 33 bands: one component explains 93.4, 98.1 and 97.5 % of the energy in R, G and B, two components 97.0, 99.0 and 98.5 %, and around the mean two components explain 71, 81 and 69 % of the between-camera variation (`m10_pca.py`, §3.7). Reproducing these from the pack is the stage's acceptance test: it proves the parser read the file correctly.

**The illustrative pack.** The photographer's Fujifilm X-T5 is in neither database, and no LED spectrum has been measured. The Studio's camera and LEDs therefore go into `illustrative@1` with `illustrative: true` on every item, and the loader emits `W_DATA_ILLUSTRATIVE` whenever an engine builds a scanner from them. Regenerate them from their stated parameters (Gaussian camera peaks 600, 535, 460 nm; LEDs at 678, 532 and 472 nm, FWHM 20 nm; the white LED's pump and phosphor) in `cameras.py` rather than copying Chromogen's files, so the pack does not depend on the licence of a prototype bundle that states none. No source in C1 or upstream has a measured LED spectrum. Until CHB-013 measures the photographer's LEDs with a spectrometer, the only alternatives are manufacturers' typical curves, which would go into this pack flagged `typical: true`, not into a measured pack. CHB-013 replaces all of these with measurements of the photographer's own setup.

## 11. Synthetic frames with known truth

### 11.1 Why

A test of the dye solve needs a negative scan whose true dye amounts are known; a test of the classifier needs pixels that are known to be blank or below base; a test of halation needs an edge whose exposure is known. Real scans never come with truth. Chromogen's `data.js` built "synthetic frames for every combination of factors, each carrying its truth (exposures, dye amounts, the true print) … with splits that hash a group so that adding rows never moves an old one" (textbook §3.7). This stage builds the same for chromobench.

The important design choice is **who computes the truth**. If CHB-003's own code generated the frames that test CHB-003, a shared mistake would pass. So the generator is `tools/spektrafilm-export/synthetic.py`, which uses **spektrafilm itself** for the film and print, and a numpy implementation of the scanner model of textbook §3.1 (D_k = −log₁₀ Σ P_k 10^(−D), then counts = T × exposure, plus flare, vignette and noise). Neither shares code with the TypeScript engines. spektrafilm names the boundaries between its stages **taps** (textbook §2.1; `runtime/topology.py`): `log_e_film`, `cmy_film`, `log_e_print`, `cmy_print`, `rgb_out`. Its `simulate` entry point can return any tap, and those taps are exactly the contract's domains `film-logH`, `film-dyes`, `paper-logH`, `paper-dyes` and `display-rgb` (architecture §5.1 records the correspondence), so each truth image is written with its domain.

### 11.2 Sets

| Set | What varies | Truth carried | Main consumer |
|---|---|---|---|
| `running-six-patch` | stock (Portra 400, Gold 200, Ektar 100), exposure (−1, 0, +1 EV), scanner (`xt5-fitted`, `white-led`) | per patch: film log H, dye amounts (grey card on Portra 400: (0.687, 0.704, 0.864)), print XYZ | CHB-003 inversion and print |
| `neutral-wedge` | flat densities 0 to 3 D in 0.5 D steps, flare 0 or 0.5 % | per step: true density; with 0.5 % flare the steps read 0, 0.495, 0.981, 1.438, 1.826, 2.090, 2.224 (textbook §3.7) | CHB-006 flare, CHB-013 calibration |
| `grey-ramps` | the five upstream regression cases | the stored outputs (`print_rgb`, `negative_density`, `film_raw`) and, regenerated with the same fast parameters, the intermediate taps | CHB-003, CHB-012 parity |
| `scan-conditions` | flare 0 or 0.5 %, a 0.26 D vignette (with and without its flat), noise σ = (0.0090, 0.0069, 0.0122) D (the Gold 200 rebate at full size, textbook §3.5), a below-base band of −0.03 D | one mask per class (`blank`, `below_base`, `gamut`; the rest is `ok`), the flat, σ | CHB-006 conditioning and classification |
| `stock-identity` | same scene on six stocks | the stock id | CHB-006 stock ranking (textbook §3.8: residuals below 10⁻⁶ D for all, so ranking must use the rebate) |
| `edges` | an edge from log H +2.5 to −1.0 on Portra 400 | linear exposure profile | CHB-012 halation (textbook §2.4: dark-side cyan 0.895 at 50 µm) |

The six patches of the running example are white (90 %), the grey card (18.4 %), black (3 %), skin, foliage and sky under a 5,500 K light. The greys are flat reflectances; the coloured patches are Jakob–Hanika sigmoid spectra R(λ) = ½ + x/(2√(1 + x²)), x = c₀u² + c₁u + c₂ with u = (λ − 380 nm)/400 nm (textbook §1.8), whose coefficients the textbook's sketch data records: skin (1.742, 0.029, −0.944), foliage (−17.641, 15.066, −4.062), sky (2.270, −3.410, 0.238) (`C1/various/extracted/colour-negative/00-hb-data.json`, sketch `01-spectra-and-density/sigmoid-upsampler`). The numbers in the table come from the textbook sections cited, so each set also checks that the generator agrees with the textbook before anyone uses it.

### 11.3 Format and identity

Each frame is a directory `fixtures/synthetic/<set>/<frameId>/` with images as safetensors (`camera_linear` F32 counts, and F64 truth images per domain) and a `truth.json`:

```json
{
  "id": "scan-conditions/portra400-xt5fitted-ev0-flare005-vig026-seed7",
  "group": "scan-conditions/portra400-xt5fitted",
  "splitBucket": 37,
  "generator": { "tool": "spektrafilm-export 0.1.0", "spektrafilm": "3bb2c2d", "pack": "spektrafilm@0.3.2+3bb2c2d",
                 "missing": "opaque", "seed": 7 },
  "factors": { "stock": "kodak_portra_400", "scanner": "xt5-fitted", "exposure_ev": 0, "flare_fraction": 0.005,
               "vignette_D": 0.26, "noise_sigma_D": [0.0090, 0.0069, 0.0122] },
  "images": { "camera_linear": { "file": "camera_linear.safetensors", "domain": "camera-linear", "umPerPx": { "film": 24 } },
              "film_dyes": { "file": "truth.safetensors#film_dyes", "domain": "film-dyes" },
              "blank": { "file": "truth.safetensors#blank", "domain": "mask" },
              "below_base": { "file": "truth.safetensors#below_base", "domain": "mask" } },
  "regions": [ { "name": "grey", "box": { "x": 96, "y": 64, "w": 32, "h": 32 },
                 "film_logH": [0, 0, 0], "film_dyes": [0.687, 0.704, 0.864], "class": "ok" } ]
}
```

`splitBucket` is `sha256(group) mod 100`, so splits are stable as frames are added (the `data.js` design). A small subset is also written as 16-bit TIFF and PNG files in the encodings CHB-006 must decode, with the encoding stated in `truth.json`.

## 12. Licensing

This is an engineering reading of the licences, written so that the owner can make decisions; it is not legal advice.

### 12.1 The facts

- **spektrafilm code** is GPLv3 (`pyproject.toml` line 11, `LICENSE`). The README adds that the author regards any tool "directly inspired by its methods" as derivative work.
- **spektrafilm profiles and LUTs** are CC BY-SA 4.0 under the preamble in `SPEKTRAFILM_LICENSE.txt`. The preamble applies the licence "to all direct derivatives of the profiles, such as copies in other projects, LUTs, or any other format that encodes the same content", requires on every copy the author's name, the canonical URL, the licence notice and a note of modifications, asks that the licence file be shipped unchanged with changes listed in a `CHANGELOG.txt`, and states that "the works you make are yours": no copyleft on finished photographs. It also asks (not as a legal condition) that the name not be used in product branding, that LUTs not be resold as a pack, and that commercial AI models not be trained on them.
- **The profiles' own `datasource`** says they were processed from Kodak and Fujifilm datasheets and that the original data are property of their holders.
- **Measured cameras** (Jiang et al. on Zenodo; Butcher's measurements) are CC BY-NC-SA 4.0: non-commercial.
- **CIE colour-matching functions and illuminants** are CIE data (the CMF dataset's DOI is 10.25039/CIE.DS.xvudnb9b) reaching the exporter through colour-science (BSD-3-Clause). The CIE's dataset pages, checked for this guide, state no licence.
- **The hanatos table** was provided to spektrafilm by Johannes Hanika (hanatos); the preamble's scope is "the profiles … and direct derivatives of the profiles", which the table is not, and it sits in a GPLv3 repository. Its licence is unclear.
- **Filter curves** (Thorlabs, Edmund Optics, Durst, Schott KG3) were digitised from manufacturers' pages (`info.txt` files give the URLs). Their licence is unclear.

### 12.2 What ShareAlike means here

CC BY-SA's ShareAlike condition applies to **Adapted Material**: anything derived from the licensed material in a way that needs permission. For chromobench that covers:

- **The packs.** A re-encoding of the profiles in safetensors is a "direct derivative" in the preamble's words. The packs must be licensed CC BY-SA 4.0 or a BY-SA-compatible licence (§3(b)(1)), include the licence text or link (§3(b)(2)), carry the attribution and a note of modifications (§3(a)), and must not be wrapped in terms or technical measures that stop recipients exercising the licence (§3(b)(3), §2(a)(5)(c)). The preamble adds the unchanged licence file and a changelog.
- **Derived tables that are shipped.** A precomputed dye-solve table, printing-density table, film exposure LUT or spectral-upsampling contraction encodes profile content. If chromobench ships one, it is CC BY-SA with the same attribution. Tables built at runtime in the photographer's browser and cached in IndexedDB are not distributed, so no obligation arises until someone shares them.
- **Exported LUTs.** If a future feature exports a `.cube` from a stock, the file is CC BY-SA and its header must carry the attribution (the preamble lists `.cube` headers explicitly).
- **Prints and images** the photographer makes are theirs; the preamble says so explicitly.
- **The application code** that reads the packs is not Adapted Material of the profiles; aggregating CC BY-SA data with differently licensed code is allowed. The *GPL* question is separate: porting spektrafilm's algorithms into TypeScript (CHB-003, CHB-012) may make those modules derivative works of GPLv3 code. That is the owner's decision, and it is outside this ticket except that the exporter, which imports spektrafilm, should itself be GPLv3 (`tools/spektrafilm-export/LICENSE`) and must never be bundled into the app.

### 12.3 Incompatibilities

CC BY-SA 4.0 and CC BY-NC-SA 4.0 cannot both be satisfied by one adapted work: each requires adaptations to carry its own licence. So:

- measured-camera data lives in its own pack with its own licence file, never inside a stock pack;
- no artefact may be derived from both, for example a scanner-and-stock dye-solve table built from a measured camera's responsivity and a spektrafilm stock, if it is *shipped*; at runtime it is fine;
- if chromobench is ever sold or used commercially, the NC packs must be removed or relicensed by their authors.

Keeping them in separate packs also matters for Section 4 of CC BY-SA ("Sui Generis Database Rights"): where database rights exist (in the EU), a database that includes a substantial portion of the profiles is itself Adapted Material, so a single combined "chromobench data" database would have to be BY-SA as a whole, which the NC data cannot be.

### 12.4 Decision record and the owner's list

> **Owner decision, 2026-11-12:** this version is **not public**: chromobench is for the owner's family (the
> photographer) only, so the licence questions below are **deferred until a public release is considered**.
> Development keeps the attribution strings and licence files as planned, so a later release starts from a
> clean state. The non-commercial packs may be used in this private version.

- **Decision (proposed).** Ship stock packs as CC BY-SA 4.0 with `SPEKTRAFILM_LICENSE.txt` verbatim, a `CHANGELOG.txt` and the attribution string in every manifest, every `StockData.attribution`, the About screen and any exported LUT. Ship measured cameras as a separate CC BY-NC-SA 4.0 pack. License the exporter GPLv3. Keep precomputed derived tables out of the shipped app unless they carry the CC BY-SA notice.
- **Owner decisions, blocking release but not development:** (1) is chromobench ever commercial (decides the NC packs); (2) the GPL question for ported algorithms; (3) asking hanatos about the table's licence and the CIE about its data; (4) whether to use the name "spektrafilm" anywhere beyond factual credit.

## 13. One flow, end to end: Portra 400 on Portra Endura

This traces the data for one print through the system, with the numbers you can check.

1. **Export.** `spektrafilm-export export --commit 3bb2c2d` loads `kodak_portra_400.json`. Its base has 20 NaN rows (380–395, 705–780 nm); its dyes have NaN at 380 nm and from 750 nm (cyan) and 755 nm (all). The writer stores them as NaN in `stocks/kodak_portra_400.safetensors` (F64) and lists `"base": [380, 395, 705, 780]` in the manifest. The neutral filter table gives `kodak_portra_endura → TH-KG3 → kodak_portra_400 = [0.0, 51.568, 52.534]`.
2. **Open.** CHB-003's print chain calls `openPack(src, 'spektrafilm@0.3.2+3bb2c2d')`, then `pack.stock('kodak_portra_400')` with the default policy. The loader verifies the file's SHA-256, returns `base_D.values` with zeros in the 20 rows and `base_D.valid` with zeros there, and the same for the dyes.
3. **Develop.** The film's grey card reads its curves at log H = 0: c = (0.687, 0.704, 0.864). (The develop op subtracts each curve's minimum, about −0.0007 for Portra 400, which moves these by less than 0.001.)
4. **Spectral density.** D(λ) = Σ c_j ε_j(λ) + b(λ); at 550 nm, 1.4662. At 705 nm the row is invalid.
5. **Enlarger.** The engine fetches `illuminant('TH-KG3')`, `dichroics('custom')` and `neutralFilters({paper: 'kodak_portra_endura', lamp: 'TH-KG3', film: 'kodak_portra_400'})`, builds F(λ) = Π_k [1 − (1 − F_k(λ))(1 − 10^(−v_k/100))], and computes T(λ) with `transmittance(D, valid)`: 0 at 705 nm and above.
6. **Paper exposure.** Summing L F T s_k over the grid and taking log₁₀ gives (0.0749, 0.0766, 0.0624) for R, G, B; removing the mean gives **(0.004, 0.005, −0.009)**: a neutral grey, as the textbook reports.
7. **The broken variant.** With `{missing: 'zero-density'}` the same steps give (0.2889, 0.1060, 0.1400), normalised (0.111, −0.072, −0.038): the red layer 0.18 log H above the green. The test of Section 15 asserts both, so it can fail.
8. **Tables.** CHB-005 keys its negative-to-paper table on `stock.contentHash`, the paper's `contentHash`, the lamp's and the filter set's, so the table built in step 6 is reused until any of those bytes change.

## 14. Implementation plan

**Stage 1: exporter.** Set up `tools/spektrafilm-export` with a lock file pinned to `3bb2c2d`; implement profiles, enlarger data (neutral table, four dichroic sets, lamps and illuminants), CMFs, the hanatos table, DIR and halation presets and the converted regression baselines. *Done when* `export` writes a pack for all 28 stocks, re-running it yields identical hashes, and every upstream array round-trips (pack → numpy) bit-exactly including NaN positions.

**Stage 2: pack format and loader.** Write the JSON Schema for manifests and sidecars, the safetensors reader, hashing, `openPack`, the typed accessors and the diagnostics. Build `interim-filmbench` and `interim-chromogen` *first*, so CHB-003 and CHB-005 can start in week one. *Done when* the loader loads every interim item in node and in a browser test, refuses a corrupted file with `E_DATA_HASH` and a wrong grid with `E_DATA_GRID`, and CHB-003 has run its print chain on interim data.

**Stage 3: missing-data convention.** Implement the three policies with validity masks; add the grey-card law and the 128-pair law (Section 15); write the convention into the pack schema documentation. *Done when* both laws pass on the exporter pack and on interim-chromogen, and fail with the `zero-density` policy.

**Stage 4: cameras and lights.** Fetch the Zenodo record and Butcher's four measurements, parse, resample, write `cameras-measured`; regenerate `illustrative@1`. *Done when* the PCA percentages of Section 10 reproduce to ±0.2 percentage points and `W_DATA_ILLUSTRATIVE` is emitted for the illustrative scanner.

**Stage 5: synthetic frames.** Implement the six sets of Section 11.2 with truth files and stable ids. *Done when* each set reproduces the textbook numbers it cites within tolerances written down before the run (grey card dyes to 0.001, the wedge readings to 0.001 D, the halation edge's dark-side cyan at 50 µm to 0.01), the class masks agree with the generator's own labels, and CHB-006 has decoded the TIFF and PNG subset.

**Stage 6: licensing.** Licence files, changelog, attribution strings, About-screen data, NC separation; send the owner the list of Section 12.4. *Done when* a script checks that every pack has a licence file, a changelog and an attribution string in every item, and that no shipped artefact mixes BY-SA and BY-NC-SA sources.

The cross-check (Section 9.4) runs in CI from Stage 2 onward.

## 15. Testing and acceptance

**Golden numbers** (store in `fixtures/golden/data/`):

| Check | Expected | Source |
|---|---|---|
| Portra 400 grey card dye amounts (curves at log H 0) | (0.687, 0.704, 0.864) | script 03; textbook §1.2 |
| Spectral density of the grey card at 550 nm | 1.4662 (parts −0.0264, 0.888, 0.0022, 0.6024) | textbook §1.2 |
| Neutral pack, Portra 400 on Portra Endura, TH-KG3 | C 0, M 51.568, Y 52.534 | upstream table |
| Grey card, normalised paper log H, opaque | (0.004, 0.005, −0.009) ± 0.001 | textbook §2.6; recomputed |
| Same, zero-density | (0.111, −0.072, −0.038) ± 0.002 | recomputed |
| Share of lamp × Endura red sensitivity at ≥ 705 nm | 0.268 | textbook §2.6 ("27 %") |
| CIE 1931 at 555 nm | (0.51205, 1.0, 0.00575) | CIE table |
| Portra 400 erf4 window | (433.49, 31.56, 593.13, 68.76) nm | upstream profile |
| Camera PCA, one component | 93.4, 98.1, 97.5 % | textbook §3.7 |

**Laws** (property tests with a seeded generator, Chromogen's `laws.js` design):

- *Round trip*: for every tensor, pack → loader → `Float64Array` equals upstream numpy bit for bit, NaN positions included (before the policy is applied).
- *Determinism*: two exports of the same commit have identical `packHash`.
- *Neutral pack balance*: for every negative film × print material pair with a table entry (128 pairs), the mid-grey's normalised paper log exposures have median spread ≤ 0.06 log H under `opaque`. Measured on Filmbench data: 0.032. The `zero-density` policy must *fail* it (measured median 0.52); the test runs both, which is how it shows it can fail.
- *Policy semantics*: under `opaque`, `transmittance(D, valid)` is 0 exactly where `valid` is 0, for any D; under `zero-density`, it equals 10^(−D) with D = 0 there; `extend-flat` leaves no invalid rows.
- *Grid refusal*: a pack whose `grid` differs from 380/5/81 is refused with `E_DATA_GRID`, as Chromogen refuses one (`05-inline.js` line 447).
- *Hash integrity*: flipping one byte of any file produces `E_DATA_HASH` on first read.
- *Cross-check*: tolerances of Section 5.3.

**How the tests can fail.** Every law above is run once with a deliberately broken variant: a pack with one NaN replaced by 0 (round trip fails), a loader with the `zero-density` default (balance law fails), a reordered tensor (hash fails). A law that passes for the broken variant is not testing anything.

**Fixtures needed:** the two interim packs (Stage 2), the converted spektrafilm baselines (Stage 1), the C1 files as cross-check inputs, and the synthetic sets (Stage 5).

## 16. Proposed contract additions (for CHB-002)

1. **Recipe:** `FrameRecipe.data?: { pack: string; packHash: string }`. Written when a frame is created; on load, a different hash yields a warning `W_DATA_PACK_CHANGED` with both ids, so replaying an edit log against new data is visible.
2. **Registry:** `ArgSpec.valuesFrom?: 'stocks:film' | 'stocks:print' | 'illuminants' | 'scanners'`, so generated controls, DSL docs and the conformance suite can list valid `stockId` values from the loaded pack instead of hard-coding them.
3. **Tables:** `TableKey` carries the `contentHash` of each data item it depends on, e.g. `{ kind: 'print-a', inputs: [{ kind: 'stock', id, contentHash }, …], grid: 17 }`.
4. **Diagnostics codes:** `E_STOCK_UNKNOWN` (with `valid`), `E_DATA_HASH`, `E_DATA_GRID`, `E_DATA_SCHEMA`, `E_DATA_POLICY`, `W_STOCK_KNOWN_ISSUE`, `W_STOCK_NO_MODEL`, `W_DATA_ILLUSTRATIVE`, `W_DATA_PACK_CHANGED`.

The missing-data policy is deliberately *not* a recipe field (Section 6.4).

## 17. Risks, open questions and decisions

- **Blocking CHB-003 (decide in week one):** adopt the opaque convention and the validity-mask representation (Section 6.4).
- **Blocking release, not development:** the owner's licensing list (Section 12.4).
- **Upstream drift.** spektrafilm is active; profile values, the neutral table and the DIR "eyeballed" matrices may change. Every upgrade is a new pack id, a cross-check diff and a review of `knownIssues`; old packs stay until no fixture uses them.
- **Upstream install weight.** The native dependencies may not install on every machine (Section 9.3). Fallback: import submodules only; last resort, read the JSON and CSV files directly and reproduce Akima resampling with `scipy.interpolate.Akima1DInterpolator`, verified against Filmbench's TH-KG3 (stored to 5 decimals) to 10⁻⁴.
- **Black and white.** Upstream's `channel_model` enum already includes `'bw'` but its validation requires three columns. CHB-014 will define B&W stock types; the pack schema reserves `channelModel` and keeps per-stock tensor lists open so new tensors do not need a schema version bump.
- **Interim divergence.** The interim packs are older snapshots; if the exporter's pack differs beyond the tolerances, the cross-check output is the evidence for the diary, and the exporter's pack wins.

## 18. References

**Project files (C1 = the CHB-001 ticket directory)**

- `C1/design-doc/01-chromobench-architecture-and-work-plan.md`: §2 rules, §5 contracts, §6 layout, §8 work plan.
- `C1/sources/The Mathematics of the Colour Negative.md`: §1.1 grid, §1.2 grey card, §1.6 base gap, §1.8 hanatos table and erf4 window, §2.2 curves, §2.3 DIR, §2.4 halation, §2.6 printing and "NaN is opaque", §2.7 viewing, §3.1 scanner, §3.5 classes and noise, §3.7 calibration and `data.js`, §3.8 stock identity.
- `C1/various/analysis-filmbench-ide.md` §3–4; `C1/various/extracted/filmbench-ide/00-film-data.bin.txt`, `film-data-summary.json`, `01-inline.js` lines 59–106 (profile access, LUT decoding), 137–147 (enlarger filters), 317 (neutral table lookup).
- `C1/various/analysis-chromogen-studio.md` §3, §6.2; `C1/various/extracted/chromogen-studio/05-inline.js` lines 440–465 (stock loader), 1638–1659 (camera and scanners); `st-data/cg/`.
- `C1/scripts/02-inventory-chromogen-st-data.py`, `03-check-chromogen-stock-data.py`, `05-extract-filmbench-vfs.py`, `06-decode-filmbench-film-data.py`.

**Upstream (spektrafilm @ 3bb2c2d)**

- `src/spektrafilm/profiles/io.py`, `data/profiles/`, `data/filters/`, `data/luts/spectral_upsampling/`, `data/license/SPEKTRAFILM_LICENSE.txt`.
- `config.py`, `model/{illuminants,color_filters,couplers,density_curves,develop,stocks}.py`, `utils/{io,conversions,spectral_upsampling,morph_curves}.py`, `runtime/{params_builder,params_schema}.py`, `runtime/stages/{filming,printing,scanning}.py`, `tests/regression_baselines.py`, `tests/baselines/`.

**External**

- CC BY-SA 4.0 legal code (in `SPEKTRAFILM_LICENSE.txt`); CC BY-NC-SA 4.0.
- Jiang, Liu, Gu and Süsstrunk, "What is the space of spectral sensitivity functions for digital color cameras?", WACV 2013; data: zenodo.org/records/3245883.
- Butcher, `github.com/butcherg/ssf-data` (spectroscope measurements; CC BY-NC-SA 4.0).
- CIE 2019, colour-matching functions of the CIE 1931 standard colorimetric observer, DOI 10.25039/CIE.DS.xvudnb9b.
- safetensors format: `github.com/huggingface/safetensors`.
- Jakob and Hanika, "A Low-Dimensional Function Space for Efficient Spectral Upsampling", CGF 2019 (background to the hanatos table).
