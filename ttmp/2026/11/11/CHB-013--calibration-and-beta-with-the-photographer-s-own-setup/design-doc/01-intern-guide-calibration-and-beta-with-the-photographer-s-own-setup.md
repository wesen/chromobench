---
Title: 'Intern guide: Calibration and beta with the photographer''s own setup'
Ticket: CHB-013
Status: active
Topics:
    - product
    - ingest
    - testing
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/design-doc/01-chromobench-architecture-and-work-plan.md
      Note: Section 8.4 lists the open decisions the photographer's answers settle
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: Sections 3.2 (conditioning) and 3.7 (wedge, PCA prior, X-T5 leakage fit) are the basis of the calibration
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-chromogen-studio.md
      Note: Section 1.2 lists the scanner profiles and the illustrative status of the bundled camera and light
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-goja-cv.md
      Note: Section 3.6 describes the evidence-driven API pruning practice the beta follows
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/05-inline.js
      Note: makeScanner (1645-1659) and channels.js scanner() (555-559) show how scanner channels are built today
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/book/10-ch10.md
      Note: Chromogen's flat-field capture instructions and the sample's missing-flat caveat
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/cg/cameras/generic-bayer.json
      Note: The illustrative camera used for leakage examples until a measured curve exists
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/cg/lights/white-led.json
      Note: The illustrative white light used in the white-light branch examples
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:25.73034224-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Calibration and beta with the photographer's own setup

This guide is for the engineer who calibrates chromobench against the photographer's real capture setup and then runs the beta with him. It assumes the architecture and work plan (`ttmp/2026/11/11/CHB-001--…/design-doc/01-chromobench-architecture-and-work-plan.md`, "the architecture") and the CHB-006 guide (ingest and scan conditioning), whose functions this ticket uses. Paths beginning `C1/` are relative to the CHB-001 ticket directory. "The textbook" is `C1/sources/The Mathematics of the Colour Negative.md`.

## 1. What this ticket is for

Chromobench inverts a scan by solving, at every pixel, for the three dye amounts that reproduce what the scanner read. The solve can only be as right as its description of the scanner: the three channel **responsivities** P_k(λ), meaning light × filter × sensor per channel, plus the photometric facts (black level, linearity, flare, uneven light).

Everything shipped today is illustrative:

- Chromogen's generic camera describes itself as "Illustrative … Not a measured camera".
- Its white LED is "Illustrative … Not a measured product".
- Its X-T5 profile was fitted from LED leakage with an assumed 20 nm bandwidth (`C1/various/analysis-chromogen-studio.md` §1.2 and §3.3).

The photographer's own setup is unknown. It may be a camera with narrowband RGB LEDs, a camera with a white light, a dedicated film scanner or a flatbed.

This ticket has two halves.

**Calibration** produces a scanner model for his setup:

- learn what the setup is;
- tell him exactly what to capture;
- fit the photometric and spectral parts of the scanner model;
- verify the result with the textbook's laws;
- record it as a versioned data record the whole app uses.

**The beta** puts the app and its agent in front of him:

- sessions with a plan;
- observations;
- with his consent, collection of agent transcripts and edit logs;
- an evidence-driven pruning of the API, following goja-cv's practice;
- success criteria fixed in advance;
- his sample rolls and reference prints turned into fixtures.

This ticket does not build:

- the decoders or conditioning functions (CHB-006);
- the dye solve (CHB-003);
- the darkroom tools (CHB-010);
- export and ICC (CHB-011);
- the UI shell (CHB-009);
- the agent transports (CHB-008).

It specifies a calibration wizard for CHB-009 and calibration playbooks for CHB-008, and it writes the fitting code in `packages/ingest/src/calibration/`.

## 2. Background

### 2.1 What a scanner model is

A scanner channel's signal is an inner product over wavelength. The textbook's §3.1 (lines 712–722) writes it as follows:

```text
r_k = Σ_λ P_k(λ) · T(λ),       P_k(λ) = S_k(λ) · F_k(λ) · Q_k(λ)      light × filter/optics × sensor
D_k = −log₁₀ Σ_λ P̂_k(λ) · 10^(−D(λ))                                  P̂_k normalised to sum 1
```

D(λ) is the negative's spectral density: the stock's base plus its three dye amounts times their unit spectra. A scanner model is the three normalised responsivities P̂_k, plus everything needed to make the measured numbers equal r_k:

- black level;
- linearity;
- flare f;
- the flat field;
- noise σ.

The textbook's rule for calibration is to do **the photometric part first**, because it affects every colour alike, and **then the spectral part** (§3.7, line 951).

The **neutral step wedge** separates the two. A strip of steps with spectrally flat density d transmits 10^(−d) at every wavelength, and because Σ P̂_k = 1:

```text
D_k = −log₁₀ Σ_λ P̂_k(λ) · 10^(−d) = d       in every channel of every scanner
```

A flat step of 1.234 D reads 1.234000 through all three channels of all four of the textbook's channel families (§3.7, line 957). Any departure is therefore photometric (flare, black level, nonlinearity), never spectral. The wedge fits the photometric part without knowing P_k at all.

### 2.2 The four setups and what each makes unknown

| setup | light | sensor | exposures per frame | what defines P_k | main unknowns |
|---|---|---|---|---|---|
| camera + narrowband RGB LEDs | one LED per exposure | camera CFA | 3 (R, G, B) | essentially the LED spectrum, since the camera curve is nearly constant across a narrow band | LED peaks and widths; registration between exposures |
| camera + white light | one white source | camera CFA | 1 | light spectrum × camera curve: both broad | the light's spectrum and the camera's curves |
| dedicated film scanner | LEDs or a lamp, model-dependent (Nikon's Coolscan 5000 uses R, G, B and infrared LEDs) | linear CCD | 1 pass, sometimes multi-sample | per model | channel spectra; the driver's processing; IR channel |
| flatbed | white lamp | trilinear CCD with RGB filters | 1 | lamp × filter × CCD | channel spectra, flare from the large lit area, focus, glass |

For the LED case it helps to see why the camera hardly matters. Under one narrowband LED, every photosite sees the same narrow spectrum. Normalising L_k(λ)·Q(λ) over a band of 20 nm leaves almost the LED shape, because Q changes little across it. The camera curve matters for one thing only: how strongly each LED leaks into the camera's *other* channels. That leakage is the evidence used to find the LED peaks (§6.2).

### 2.3 Why capture choices matter: conditioning

The dye solve turns density errors into dye errors through the inverse of the forward model's Jacobian J. Near the solution δc ≈ J⁻¹ δd. The worst-case gain is 1/σ₃, where σ₃ is J's smallest singular value (textbook §3.2, line 780). The textbook computes it for Portra 400:

| channels | σ₃ | worst-case noise gain | dye scatter at the grey card for 0.005 D noise per channel |
|---|---|---|---|
| narrowband LEDs (20 nm) | 1.087 to 1.143 over the whole dye cube [0, 2.4]³ | about 0.9 | (0.0044, 0.0040, 0.0044) |
| white-LED camera | 0.36 at the base, 0.305 at the grey card, **0.034** at dense yellow | up to **29** | (0.0145, 0.0089, 0.0080) |

Two more effects make a broad channel worse beyond noise:

- **Linearity** (§1.5, line 178): a 20 nm channel keeps magenta linear to 0.3 % at one unit, a 40 nm channel costs 4 %, and an 80 nm channel, close to a white-light camera's, costs 22 %.
- **The base reweights broad channels** (§1.6, line 200): "grey minus rebate" differs from "dyes alone" by 0.004 through narrowband LEDs and by 0.052 through the white-LED camera.

The spectral solve handles both exactly; only a 3×3 linear shortcut suffers. On synthetic frames the analytic 3×3 prints with a median CIEDE2000 error of 1.50 through LEDs and 23.8 through the white-LED camera, while the spectral solve's error is below 0.0001 (§3.7, line 963). Noise amplification, however, is physics and no solver removes it. In the textbook's interactive sketch, widening the LEDs from 20 to 100 nm lowers σ₃ on its slice from 1.09 to 0.25 and raises the noise gain from 0.9 to 4.1 (§3.2, line 784).

The consequence for advice is in §7.

### 2.4 The laws used as checks

These come from the textbook. Each becomes a verification step with a number.

- **Flat wedge** (§3.7, §3.9): after the photometric fit, every step reads the same density in all three channels.
- **Flat field** (§3.1, §3.9):
  - dividing a frame by a flat of its own illumination returns its densities to within the flat's noise. The synthetic test gives 0.0006 D for a 0.26 D vignette and a ±1 % flat.
  - On real captures the **shadow floor** is the practical test: the 1st percentile of density in 25-pixel bands across the frame.
  - On the Gold 200 sample, which has no flat, the floor sits at (−0.022, −0.017, −0.031) D next to the rebate, within 0.003 D of the noise-only value −2.33σ. In the middle it is (−0.053, −0.060, −0.069) D: 0.03–0.04 D of uneven light (§3.5, line 911).
  - The textbook's own exercise (§3.7, line 1019) is this ticket in miniature: "capture a flat field and a neutral wedge with your own scanner, fit the flare f from the wedge, and measure how the Gold-200-style shadow floor of Figure 3.4 changes on one of your frames after dividing by the flat."
- **Base relativity** (§1.6): the rebate, read relative to the open gate, should match the named stock's base through the fitted channels within about 0.02 D (the `program.js` warning threshold, §3.1, line 724).
- **Round trip** (§3.9): solving the forward model's own output returns the dye amounts to within the tolerance. It checks the solver, not the scanner model, but it must hold for the fitted channels too.

## 3. How it fits the system

```text
            photographer's captures (flat, wedge, lens-cap frame, rolls, prints)
                                  │  CHB-006: decode, flat, open gate, σ, rebate, fitFlare
                                  ▼
   calibration/ (this ticket) ──► ScannerModel record ──► packages/data/packs/scanners/  (CHB-004 format)
          │                                │
          │ verification report            └──► recipe.scan.scanner = model id ──► CHB-003 solve, CHB-005 tables
          ▼
   fixtures/scans/<setup>/…  (private)  ──► golden tests in 003/006/010/011
                                  │
   beta sessions ──► session bundles (edit logs, eval logs, chat; consented) ──► tools/beta-analysis ──► CHB-002 catalog changes
```

**Depends on:**

- CHB-006 for decoding, `flatGrid`, open gate, `fitFlare`, `sigmaD`, `shadowFloor`, `rankStocks` and the conditioning table;
- CHB-010 for printing in a real-enlarger mode, test strips and ring-arounds;
- CHB-011 for 16-bit and ICC output and soft proofing;
- CHB-004 for the data-pack format and the camera-sensitivity data;
- CHB-008 for the evaluation harness and the transcript channel;
- CHB-009 for the wizard UI.

**Proceeds in parallel by:**

- writing the capture protocol and questionnaire now, since they need no code;
- developing the fitting code on synthetic captures, made by pushing known LED or camera spectra through the forward model with noise and flare added;
- using Chromogen's Gold 200 sample as a stand-in LED-triplet capture;
- running the beta's session plan against the mock engine (CHB-002) for dry runs.

## 4. What exists today

- **Chromogen's scanner profiles** (`C1/various/extracted/chromogen-studio/05-inline.js`, `SCANNERS` 1600–1606, `makeScanner` 1645–1659):
  - `xt5-fitted` (Gaussian LEDs at 678/532/472 nm, FWHM 20, times `generic-bayer`);
  - `rgb-led-book` (660/530/450 with FWHM 20/25/20);
  - `custom-led`;
  - `white-led`;
  - `status-m`.

  Channels are built by `channels.js` `scanner()` (555–559) as light × camera, normalised (486–493).
- **The X-T5 fit.** The textbook says the profile was made by finding the LED peaks "from how each LED leaks into the camera's other channels" (§3.7, line 959, citing the long book's Appendix E, which is not among our sources). The sample's own caveats are "no flat field: the rebate varies by about 0.02–0.03 D along the frame" and "the scanning light's spectra are not known; FWHM 20 nm assumed" (sample metadata in `03-inline.js`).
- **Illustrative spectra:** `C1/various/extracted/chromogen-studio/st-data/cg/cameras/generic-bayer.json` (Gaussian peaks 600/535/460 nm) and `lights/white-led.json` (a 450 nm pump plus phosphor).
- **Capture guidance in Chromogen's book** (`st-data/book/10-ch10.md`, "Sources"): the flat field "must be taken with the same lens, aperture, focus and exposure as the scans, and have the same shape as captured"; a triplet needs three flats, one per LED.
- **Camera-sensitivity statistics** (textbook §3.7, line 959): Jiang, Liu, Gu and Süsstrunk measured 28 cameras (WACV 2013). Per channel, the first principal component explains 93.4, 98.1 and 97.5 % of the energy in R, G and B; two components explain 97.0, 99.0 and 98.5 %.
  - Around the mean, two components explain only 71, 81 and 69 % of the variation between cameras.
  - The mean plus two components reconstructs a camera's curve to a median RMS error of 0.03 of its peak, 0.11 at worst.
  - The textbook's verdict: "a good prior for fitting a camera to a chart, not a substitute for measuring one."
- **The wedge fit** (§3.7, line 957): with f = 0.5 % the steps 0, 0.5, …, 3 D read 0, 0.495, 0.981, 1.438, 1.826, 2.090 and 2.224, and the fit recovers f = 0.00503 with 0.005 D of noise.
- **Rozzi's scanner model** (US 6,633,408, cols. 8–11, summarised in §3.1 line 746 and §3.7): three Gaussian filters (mean, width, amplitude) and a gain–offset–gamma tone curve per channel, fitted from a neutral wedge and a 512-patch target. The offset is where flare lives. This is the natural model for a closed-box scanner.
- **goja-cv's evidence-driven practice** (`C1/various/analysis-goja-cv.md` §3.6):
  - GCV-004 analysed 18 agent runs (751 eval calls):
    - parameters and sliders were used 0 times;
    - only 14 of 246 synonym keys were ever typed.
  - Both were deleted, for a net change of −2,950/+900 lines. Median calls fell from 51 to 39 on one benchmark, and recall did not change: "the agent's ranking was the limit, not the API".
  - GCV-005 analysed 39 annotator agents (374 evals). That produced `cv.load`, signatures in the context block, compact tables and `peaks`.
  - Redirects were added only for names agents actually typed.

## 5. Step 0: learn the setup

Before any capture, send a short questionnaire and hold a call. The answers choose the branch and settle the architecture's open decisions (§8.4 there).

1. **How are negatives digitised?** Camera (which body, lens, raw format) or scanner (which model, which software). If a camera, what light: RGB LEDs fired in turn, a white panel (which product), or something else? Is a datasheet available, or a spectrometer?
2. **What leaves the capture step?** Camera RAW files, scanner "raw" files (VueScan or SilverFast raw TIFF/DNG), or processed TIFF/JPEG? With or without an infrared channel?
3. **Which stocks,** and who processes them (lab or home C-41)?
4. **What does "RAW" mean to him?**
   - RAW files *of negatives*: scan mode, CHB-006.
   - RAW *photographs* to be "shot" on simulated film: photo mode and CHB-012.
   - Both.
5. **Black and white:** is it part of his work now? This decides whether CHB-014 joins the first beta.
6. **Output:** screen and files, lab prints, inkjet, or his own RA-4 darkroom? Are there **reference prints** with notes (paper, enlarger, filtration, time)?
7. **Instruments:** a colour densitometer (for example one reading Status M), a spectrophotometer, a step wedge, an IT8 target?
8. **Machine and browser,** to check WebGPU availability through the engine's capabilities.

## 6. What to capture, and how to fit the model

### 6.1 The common kit (every branch)

| item | why | how |
|---|---|---|
| **Flat field** | divides out uneven light; supplies the open-gate level if exposed like the scans | Light with no film, holder in place if it masks the light. Same lens, aperture, focus and exposure as the scans. One capture per LED for triplets. Repeat at the start and end of a session to see drift. |
| **Neutral step wedge** (for example a Stouffer T2115: 21 steps of 0.15 D from a nominal 0.05 to 3.05) | fits flare, checks black level and linearity, tests the flat-wedge law | Captured in the same holder and surround as negatives. With the calibrated version, keep its measured densities. A silver wedge is near-neutral; its densities are diffuse-mode values, so the fit carries a shared scale q (CHB-006 `fitFlare`). |
| **Lens-cap frame** | a full frame of base + fog: the best rebate sample and the best flat-field check | Shoot one frame with the lens cap on at the start of each roll, so it develops as base + fog over 24×36 mm. |
| **Rebate and open gate in every scan** | the rebate sets the density zero; sprocket holes or a holder gap give the open gate for flare, the base check and stock ranking | Frame the capture to include the rebate strip and, for 135, some sprocket holes. Never clip them. |
| **IT8.7/1 transparency target** (optional) | constrains the channel spectra for the white-light, scanner and flatbed branches | Scan it directly. It is useful in proportion to its reference data: spectral transmittances constrain P_k far better than Lab values. |
| **A reflective chart shot on each stock** (optional; ColorChecker or IT8.7/2) | an end-to-end check of inversion and printing, not a scanner fit: the film's curves and coupling sit in between | Daylight, box speed, grey card in frame. |

**Exposure rules for every branch:**

- Set exposure from **raw values, not the camera's JPEG histogram.** The open gate should sit near 75–80 % of the white level in its strongest channel, and nothing in the rebate or open gate may clip. CHB-006 flags clipping per pixel.
- Use base ISO, lossless raw, and no in-camera noise reduction or lens correction.
- Lock focus, aperture and exposure across a roll.
- Let LED panels warm up, and check the open gate at the start and end. A drift above about 0.5 % is reported.

### 6.2 Branch A: camera + narrowband RGB LEDs

**Capture.** For each frame, three exposures: one per LED, camera on a stand, tethered if possible, so nothing moves.

- Exposure can differ per LED. Set each so that the **rebate** sits at a healthy level in its channel (for example 40–60 % of the white level). This equalises signal-to-noise across channels despite the orange mask, which a single white exposure cannot do.
- Capture a flat triplet and a wedge triplet with the same per-LED exposures.

**Photometric fit:**

1. Check the black level. A fitted negative flare means it is over-subtracted.
2. Fit per-channel flare with `fitFlare` on the wedge triplet.
3. Build the flat with `flatGrid`.
4. Verify on the lens-cap frame (§6.6).

**Spectral fit: LED peaks from cross-channel leakage.** In the flat triplet, under LED k, take the black-subtracted means s_ck of each CFA colour c over the central open area. Their ratios to the matching channel do not depend on LED power or exposure time:

```text
ρ_ck = s_ck / s_kk = Σ_λ L(λ; μ_k, w_k) Q_c(λ) / Σ_λ L(λ; μ_k, w_k) Q_k(λ)
```

L is the LED's spectrum: Gaussian with peak μ_k and full width w_k, or a measured shape. Q_c are the camera's curves. With Q known and w from the datasheet, each LED gives two ratios for one unknown μ_k. The fit is a one-dimensional least-squares problem per LED, with one spare equation as a check.

Concrete numbers, computed for this guide through Chromogen's illustrative camera with LEDs at 678/532/472 nm and 20 nm FWHM:

| LED | leak into R | leak into G | leak into B |
|---|---|---|---|
| 678 nm | 1 | 0.0152 | 0.0000 |
| 532 nm | 0.1513 | 1 | 0.0656 |
| 472 nm | 0.0014 | 0.2999 | 1 |

The ratios change by −0.00044 per nm (red LED, green leak), +0.0083 and −0.0049 per nm (green LED) and +0.0166 per nm (blue LED, green leak). With 1 % noise on the ratios and the *exact* camera curves, the fit returns 677.7, 531.9 and 472.0 nm.

Measurement noise is therefore not the limit; **the camera model is**. A 3 % error in the camera's green tail near 678 nm moves the red LED's fitted peak by about 1 nm (the ratio changes by 2.9 % per nm); tail errors of tens of per cent, common where a curve is near zero, move it by several nanometres. Hence the order of preference for Q:

1. A measured curve for his camera body, if it is among the 28 cameras of Jiang et al. or in other published sets that CHB-004 can package.
2. The mean plus two principal components (the PCA prior of §6.3), with coefficients fitted jointly with the LED peaks and regularised by the PCA variances. Add the base readings of a known stock's rebate relative to the open gate (three more numbers) as extra constraints.
3. The generic camera, as Chromogen did, reporting the peaks with an honest uncertainty.

If he owns or can borrow a spectrometer, measuring the three LEDs directly beats all of this. LED peaks shift by a few nanometres with temperature and drive current, so measure warm.

**Resolution.** `bin: 'cfa'` gives Chromogen's block means. `tripletMode: 'all-photosites'` gives full resolution without demosaicing (CHB-006 §5.4). The per-colour gains it needs are exactly the leakage ratios above, measured on the flat.

### 6.3 Branch B: camera + white light

**Capture.** One exposure per frame, set so that the open gate's strongest raw channel is about 75–80 % of white. Blue is the starved channel behind the orange mask. A blue colour-compensating filter in the light path can balance channel exposures. If used, it must be part of S(λ) in the model, and its spectrum measured or taken from a datasheet. Averaging N identical exposures lowers σ by √N, which matters here because of the noise gain. Pixel shift, if available, gives full colour per pixel without demosaicing crosstalk.

**Spectral fit.** P_k = S(λ)·Q_k(λ), with both factors broad.

- **S:** from a spectrometer measurement or the panel's datasheet.
- **Q:** from the **two-component PCA prior** (Jiang et al., textbook §3.7):

  ```text
  Q_c(λ) = m_c(λ) + a_c1 · v_c1(λ) + a_c2 · v_c2(λ)        c ∈ {R, G, B}; 6 unknown coefficients
  prior:  a_ci ~ N(0, s_ci²)                                 s_ci² = the PCA variance of component i
  ```

- **Fitting:** the 28 measured curves are given at 33 bands from 400 to 720 nm. Resample to the 81-point grid and set zero outside 400–720 nm, where the camera's IR-cut and UV filters block light. With S fixed, every reading of a target patch of known spectral transmittance T_i(λ) is **linear** in the coefficients:

  ```text
  r_ik = g_k · Σ_λ S(λ) · (m_k + a_k1 v_k1 + a_k2 v_k2)(λ) · T_i(λ)
  ```

  So the maximum-a-posteriori fit is a regularised linear least-squares problem per channel. The unknown gain g_k is removed by taking ratios to the open gate.
- **Data, by usefulness:**
  1. an IT8.7/1 transparency with spectral reference data;
  2. an IT8.7/1 with Lab data only (weaker);
  3. the rebates of known stocks (three numbers each, relative to the open gate);
  4. the wedge, which says nothing spectral.
- **Report** σ₃ over the dye cube for the fitted model (§6.5). For this branch it will be the headline number.

### 6.4 Branches C and D: dedicated scanner and flatbed

**Capture.** Use the scanner software's raw linear output, for example VueScan's raw files or SilverFast's HDR raw (48-bit RGB or 64-bit with infrared).

- Lock the scanner's exposure and analogue gain for the whole calibration set and roll. Automatic exposure per frame breaks the shared open gate.
- Keep the infrared channel when present: CHB-006 uses it as a dust map.
- The scanner calibrates its own sensor flat. Still capture a lens-cap frame to verify uniformity, but a separate flat may not be needed.
- **Flatbeds:**
  - mask the glass around the film, because flare grows with the lit area;
  - set the holder height for focus;
  - watch for Newton rings.

**Fit.** These are closed boxes, so use Rozzi's model:

- per channel, a Gaussian filter (mean, width, amplitude) times a nominal lamp and sensor;
- a gain–offset–gamma tone curve fitted on the wedge (the offset absorbs flare).

The IT8.7/1 target then fits the Gaussian parameters. If the driver's "raw" output turns out not to be linear (the wedge shows it: γ ≠ 1), record the fitted tone curve in the model and apply its inverse during decoding (a CHB-006 levels override with a curve).

### 6.5 Products: the ScannerModel record and the report

The fitted model is data, stored as a pack in CHB-004's format and referenced by `recipe.scan.scanner`. This is a proposed contract addition (§12).

```ts
// packages/contract/src/scanner.ts (proposed, sketch)
export interface ScannerModel {
  id: string;                                       // e.g. 'beta-led-triplet-2026-12'
  kind: 'led-triplet' | 'white-camera' | 'scanner' | 'flatbed';
  grid: [380, 780, 5];
  P: [number[], number[], number[]];                // 81 values per channel, each summing to 1
  parts: {
    leds?: { peak_nm: number; fwhm_nm: number; from: 'spectrometer' | 'datasheet' | 'leakage-fit'; sd_nm?: number }[];
    light?: { from: 'spectrometer' | 'datasheet' | 'parametric' };
    camera?: { model: string; curves: 'measured' | 'pca2' | 'generic'; coeffs?: number[] };
    gaussians?: { mean_nm: number; fwhm_nm: number; amp: number }[];    // Rozzi-style scanners
  };
  photometric: { flare: [number, number, number]; densityScale: number; toneGamma?: [number, number, number];
                 blackCheck: 'ok' | 'over-subtracted' | 'under-subtracted' };
  flat?: { sha256: string; detail: 'smooth' | 'fine'; falloffD: [number, number, number] };
  noise?: { sigmaD_rebate: [number, number, number]; stock: string; size: [number, number] };
  conditioning: { sigma3_min: number; sigma3_grey: number; frac_below_0_05: number };   // over the dye cube, per reference stock
  checks: { wedgeSpreadD: number; floorDriftD: number; baseCheckD?: [number, number, number] };
  provenance: { captures: string[]; fitted: string; tool: string };   // capture sha256s, ISO date, code version
}
```

The **calibration report** is a page the photographer and the team both read. It is generated by `calibration/report.ts`:

- each check with its number and threshold;
- the fitted parts with their uncertainty;
- σ₃ and noise gain over the dye cube, with the textbook's LED and white-light figures beside them;
- the shadow floor before and after the flat;
- a recommendation (§7).

### 6.6 Verification

After the fit, run these on captures that were **not** used for fitting: a second wedge capture and a different roll's lens-cap frame.

1. **Flat wedge.** After flare correction, every step with D ≤ 2.0 reads the same density in all three channels, within max(0.01 D, 3σ of the step). Above 2.0 D, report only, because density noise grows tenfold per unit of density (textbook §1.7).
2. **Flat field divides out.** On the lens-cap frame after flat division:
   - the band 1st percentiles (`shadowFloor`) stay within 0.005 D of −2.33σ across the frame;
   - block means of 64 px vary by at most 0.005 D.

   The same analysis without the flat is the control. On the Gold 200 sample it shows 0.03–0.04 D, so the test can fail.
3. **Base relativity.** The rebate relative to the open gate matches the named stock's base, read through the fitted P_k, within 0.02 D per channel. Record the spread across his rolls: processing and age move fog by a few hundredths, and the threshold may need widening based on that evidence.
4. **Round trip and classes.** Synthetic dye triples pushed through the fitted model solve back to within tolerance. On a box-speed frame, the share of below-base pixels at full size is at most 1 %. Below base is systematic (uneven light or a wrong rebate), so a calibrated setup should nearly eliminate it.

`calibrate.wedge`, `calibrate.leds` and `calibrate.verifyFlat` are proposed as ops (§12), so the agent can run the same checks through the DSL during sessions.

## 7. Advice to the photographer, from the numbers

The conditioning numbers turn into four recommendations, to be given after his setup is known and in this order:

1. **If he already uses narrowband RGB LEDs, keep them.** Spend effort on knowing the LED spectra to a few nanometres (a spectrometer reading is worth more than any fit) and on a flat field. The sample frame shows what a missing flat costs: 0.03–0.04 D of false "below base" in the middle of the frame.
2. **If he uses white light, the largest single improvement is the light.** The solve amplifies density noise up to 29 times in dense yellows (σ₃ = 0.034) and about 3.3 times in cyan at the grey card (0.0145 against 0.0044). A narrowband RGB LED source with three exposures removes that amplification (σ₃ ≈ 1.1 everywhere). If he keeps white light:
   - expose to the right in raw terms;
   - average several exposures;
   - consider a compensating filter for blue;
   - use pixel shift if available.
3. **Dedicated scanners:** use raw linear output, lock exposure, keep infrared. Calibrate with a wedge and an IT8.7/1. Find out whether the scanner is LED-lit (the Coolscan 5000 is), because that decides which conditioning row applies.
4. **Flatbeds** are the last choice for physical accuracy because of broad filters, flare from a large lit area and limited sharpness. Masking the bed and fitting flare recover part of it.

In every branch: capture a lens-cap frame per roll, include sprocket holes or a gap for the open gate, and never let the rebate clip.

## 8. Sample rolls and reference prints as fixtures

**Sample rolls per stock.** For each stock he uses, ideally one roll containing:

- a lens-cap frame;
- a grey card and a reflective chart in daylight at box speed;
- an exposure bracket of the same scene from −3 to +3 EV in 1-EV steps. The underexposed frames exercise blank film; the textbook's Gold 200 frame is about two stops under.
- a few ordinary scenes with sky, foliage and skin.

Record the processing (lab or chemistry, date) and the scan settings. These rolls feed:

- CHB-003's laws (grey balance, classes);
- CHB-010's test strips;
- the stock-ranking check of CHB-006.

**Fixture layout.**

```text
fixtures/scans/<setup-id>/
  manifest.json            setup facts, ScannerModel id, consent scope, licence
  calibration/             flat*, wedge*, lens-cap*, optional it8*   (raw files, sha256 in the manifest)
  <stock>/<roll-id>/       frames (raw files), roll.json (stock, processing, capture settings, per-frame roles)
  prints/<print-id>/       print.json (frame sha256, paper, enlarger, filtration CC, time_s, fstop, developer,
                           dodge/burn notes, measurement method), patches.json (Lab D50, positions)
```

`manifest.json` lists every file by SHA-256, with the role and the decode options CHB-006 should use. These are his photographs:

- The fixtures live outside the public repository, in a private store or private LFS.
- Tests that use them are gated on an environment variable (`CHROMOBENCH_PRIVATE_FIXTURES`), exactly as goja-cv gates its labelled tiles (`GOJACV_TILES`).
- Golden numbers derived from them, such as σ, base densities and class shares, may be public only if he agrees.

**Reference prints become fixtures** in five steps:

1. **Choose patches** on the print: uniform areas, neutral and coloured, about 10–20 per print.
2. **Measure them.** Use a spectrophotometer (Lab, D50, 2°) if available. Otherwise make a reflective scan profiled with an IT8.7/2 through CHB-011's lcms2 path, and record which was used.
3. **Write his darkroom notes as a recipe:** `print.enlarger.mode = 'real'`, lamp, filtration in CC, `time_s`, `fstop`, paper, and exposures for dodging and burning. This uses CHB-010's real-enlarger mode.
4. **Render and compare.** Allow a fitted correction of three printer-light numbers and one exposure, which absorbs paper batch and chemistry drift. What remains is the model's error.
5. **Fix the threshold from his own repeatability.** If he has two prints of the same negative made with the same settings, their ΔE00 is the floor no simulation can beat. Without such a pair, ask him to make one.

## 9. The beta plan

### 9.1 Sessions

| session | timing | goal | he does | we record | exit condition |
|---|---|---|---|---|---|
| B0 setup and capture | week 0 | learn the setup, capture the kit | questionnaire, call, captures per §6 | setup facts, capture problems, machine capabilities | kit complete and decodable |
| B1 calibration review | week 1 | show the fitted model and its checks | reads the report; looks at the base map of his frames | which diagnostics he understands; questions | model accepted, or a re-capture planned |
| B2 known frames | week 2 | print frames that have reference prints | prints with his recorded settings, then adjusts | ΔE00 at patches; which controls he reaches for | criterion C6 evaluated |
| B3 darkroom with the agent | weeks 2–3 | test strips, ring-arounds, dodging and burning through the agent | asks in his own words; approves or rejects | proposals, approvals, rejections with reasons, undo after approval, errors | — |
| B4 a roll | week 3 | the whole workflow | imports a roll, prints selects, exports | time per frame, roll consistency, export problems | roll finished |
| B5 debrief | week 4 | findings and pruning | interview on the report | — | beta report and pruning note |

Sessions are about 90 minutes, remote with screen sharing or in person. One engineer runs the session and one takes notes. Dry-run every session against the mock engine first.

### 9.2 What to observe

- **Vocabulary mismatches.** Words he uses that the app or agent does not, and the reverse: "points" versus CC, "density" versus "tone". Each is a candidate `redirects` entry or a documentation fix.
- **Where he expects a darkroom behaviour and gets a digital one,** for example a balance that tints paper white, which the architecture forbids.
- **Agent proposals:**
  - accepted;
  - rejected for physics reasons ("that's not how a test strip works");
  - rejected for taste reasons.

  Physics rejections are bugs. Taste rejections are playbook material for CHB-008.
- **Diagnostics he ignores, misreads or asks about:** blank film, below base, out of gamut, `W_NO_OPEN_GATE`, conditioning.
- **Performance on his machine:** WebGPU present or not, preview latency, export time.

### 9.3 Collecting transcripts and edit logs, with consent

**What exists to collect:**

- **The edit log.** Every recipe change is a `LoggedMutation` with `by: 'user' | 'agent' | 'auto'`, a timestamp and a status (`applied`, `pending`, `rejected`) (architecture §5.4).
- **The eval log.** Each agent call is an `EvalRequest` and an `EvalResult` with warnings and errors (architecture §5.5).
- **The chat transcript,** in CHB-008's in-app chat.
- **Looks,** the images returned to the agent.

**How:**

- The app writes these locally into a **session bundle**: a JSON file per session plus optional look images.
- Paths are replaced by source hashes.
- Nothing leaves his machine automatically. At the end of a session he reviews the bundle in the app (a list of what it contains, with looks excluded by default) and sends it if he chooses.
- If he hosts with the Go bridge (CHB-008), bridge-side logging of MCP calls follows the same rules.

**Consent** is written, specific and revocable, and covers:

- what is collected (edit log, eval log, chat, optionally looks and frames);
- where it is stored and who sees it (the team only);
- what is published (aggregate counts only, unless he agrees otherwise);
- how long it is kept;
- how to withdraw and delete.

Consent is per session, defaults to off, and covers his images separately from his edit data.

### 9.4 Pruning the API from evidence

`tools/beta-analysis/` (new, under the planned `tools/`) reads the bundles and reports:

- uses per op, per argument and per unit, by agent and by user;
- error codes by frequency, with the code that triggered them;
- names the agent typed that do not exist (unknown op or argument errors);
- median evals per task;
- approval rate of agent mutations, time to approve, and undo-after-approve.

The rules follow goja-cv's practice:

- An op or argument with zero uses across the beta that no law, playbook or golden test needs is proposed for deletion. goja-cv deleted parameters with 0 uses and lost nothing.
- A name the agent typed at least twice that does not exist becomes an `ArgSpec.redirects` entry. There are no synonym tables: goja-cv's 246 synonyms saw 14 used.
- A repeated error code gets a better `hint` or a literal `fix`.
- A UI control he never touched moves to an advanced group, with no deletion without a second beta.

The output is a note in CHB-002's changelog proposing catalog changes, in line with the rule that contract changes go through CHB-002 (architecture §8.3).

### 9.5 Success criteria, fixed before the run

These are proposals. They must be agreed with the team and recorded in this ticket before session B1, following the architecture's rule that tolerances are stated before a run.

| id | criterion | threshold |
|---|---|---|
| C1 | flat wedge after flare fit, steps up to 2.0 D | channel spread ≤ max(0.01 D, 3σ_step) |
| C2 | flat field on a held-out lens-cap frame | shadow-floor bands within 0.005 D of −2.33σ; 64-px block means within 0.005 D |
| C3 | noise σ on the rebate, per stock, at full size | measured and recorded (no threshold) |
| C4 | base check against the named stock | ≤ 0.02 D per channel, or the measured spread across rolls if larger |
| C5 | below-base share on box-speed frames at full size | ≤ 1 % |
| C6 | prints against reference prints, after a 3-light + exposure fit | median ΔE00 ≤ his repeatability floor + 2, worst patch ≤ floor + 6 |
| C7 | workflow | one roll from import to export within a session, without engineer help |
| C8 | agent | no physics-rejected proposal left unexplained in the report |

## 10. One flow traced: calibrating an LED-triplet setup

The numbers here use Chromogen's illustrative spectra wherever the photographer's are not known yet. They show the mechanics, not his results.

1. **Questionnaire.** He scans with a Fujifilm camera and three LEDs fired in turn, 135 film, Gold 200 and Portra 400, lab-processed. This is branch A.
2. **Capture (B0):**
   - a flat triplet at 1/6 s per LED (as in the Gold 200 capture's metadata), ISO 125;
   - a Stouffer T2115 wedge triplet in the film holder;
   - a lens-cap frame from a Gold 200 roll;
   - ten frames including the rebate and sprocket holes.

   CHB-006 decodes each RAW in scan mode with `bin: 'cfa'`, giving 6×6 X-Trans block means.
3. **Leakage.** Under each LED, the flat's central CFA means give the ratio matrix. With the illustrative camera and true peaks at 678/532/472 nm it would read (rows = LEDs) (1, 0.0152, 0.0000), (0.1513, 1, 0.0656), (0.0014, 0.2999, 1). The one-dimensional fits return 677.7, 531.9 and 472.0 nm with 1 % ratio noise. Against his camera's measured or PCA-fitted curves, the same procedure yields his peaks with an uncertainty that is reported as `sd_nm`.
4. **Flare.** `fitFlare` on the wedge returns, say, f = (0.004, 0.005, 0.006) and q = 1.00. If his setup behaved like the textbook's example (f = 0.005), the dense steps would read 1.438, 1.826, 2.090, 2.224 at nominal 1.5 to 3.0 D, and the fit would return f within 0.0001 of the truth with 0.005 D noise.
5. **Flat and verification.**
   - `flatGrid('smooth')` reports the fall-off in D.
   - On the held-out lens-cap frame, the shadow floor is flat within 0.005 D (C2).
   - The rebate relative to the sprocket holes is compared with Gold 200's base through the fitted channels. Through the illustrative X-T5 channels that base reads (0.282, 0.643, 0.840) D, and C200's reads (0.274, 0.649, 0.819). A 0.02 D check cannot tell these two apart, which is why the stock is always named by the user.
6. **Noise and conditioning.**
   - σ on the rebate at full size is recorded. The Gold 200 sample's is (0.0090, 0.0069, 0.0122) D.
   - σ₃ over the dye cube is about 1.1 for narrowband channels.
   - The report recommends no change of light.
7. **Record.** A `ScannerModel` with `kind: 'led-triplet'`, the three LED entries (`from: 'leakage-fit'`), the flare, the flat's hash, σ, conditioning and checks is written to `packages/data/packs/scanners/`. His recipes reference it by id.

## 11. Implementation plan

**Stage 1: capture of the setup.**

- *Build:*
  - the questionnaire;
  - the per-branch capture protocol as a playbook document;
  - a capture checklist in the wizard specification for CHB-009;
  - the fixture manifest schema (`fixtures/scans/<setup>/manifest.json`);
  - the consent text.
- *Done when:* B0 is held and the kit decodes in CHB-006 with no clipping in the rebate or open gate.

**Stage 2: scanner characterisation.**

- *Build:* `packages/ingest/src/calibration/`:
  - `wedge.ts`: step detection along a strip, then CHB-006's `fitFlare`;
  - `flatcheck.ts`: `shadowFloor` and block means;
  - `leakage.ts`: LED peak fit with uncertainty;
  - `camera-prior.ts`: PCA prior from the Jiang et al. curves packaged by CHB-004; the MAP fit;
  - `rozzi.ts`: Gaussian channels plus tone curve;
  - `scanner-model.ts`;
  - `report.ts`.
- *Developed and tested on synthetic captures first.*
- *Done when:* synthetic truths are recovered (§12), his model passes C1–C2 on held-out captures, and the report exists.

**Stage 3: sample rolls.**

- *Build:* roll plans per stock; fixtures registered with manifests; golden values derived (σ, base, classes); reference prints measured and written as recipes.
- *Done when:* every stock he uses has a roll fixture, and every reference print has `print.json` and `patches.json` plus a repeatability floor.

**Stage 4: beta sessions.**

- *Build:* the success criteria recorded in advance; session bundles; `tools/beta-analysis/`; sessions B0–B5 with notes; the pruning note to CHB-002; the beta report.
- *Done when:* the report states each criterion's result, and the pruning note is filed.

## 12. Testing and acceptance

**Synthetic recovery,** before any real data:

- LED triplets: generate flats from known LED peaks (for example 660/530/450 and 678/532/472) through a known camera, with photon noise. The fit recovers peaks within 0.5 nm when the camera is known. With the camera replaced by the PCA mean plus a held-out camera's true curve, report the error rather than assert it; it is the honest uncertainty.
- Wedge: f ∈ {0, 0.002, 0.005, 0.01} with 0.005 D noise. Recovered within 0.0005, and f = 0.005 gives 0.00503 ± 0.0002 on the textbook's steps.
- White light: generate IT8-like patches with known spectra through S·Q. The MAP fit's channel errors are reported against the 0.03-of-peak median RMS that the PCA reconstruction alone achieves.

**Laws** (§2.4) as automated checks on the fitted model. Each has a broken-variant test:

- leaving flare at 0 must fail C1 on a synthetic f = 0.005 wedge;
- skipping the flat must fail C2 on a synthetic 0.26 D vignette.

**Real data**, environment-gated, on held-out captures: C1–C5.

**The beta:** C6–C8, recorded in the report with the numbers.

## 13. Risks, open questions and decisions

**Open questions that block work:**

- **What "RAW" means to him** (questionnaire item 4). If he means photographs, CHB-012 and CHB-006's photo mode join the beta. If he means negatives, they wait.
- **Black and white in the first beta.** If yes, CHB-014 is on the critical path, and some advice changes: no orange mask; silver blocks infrared, so IR dust maps fail; silver's specular/diffuse ratio (Callier) reaches about 2 against at most about 1.1 for dyes (textbook §1.2).
- **Print output:** screen and files, lab, inkjet or his own RA-4. This decides CHB-011's priority and whether reference prints exist.
- **The capture setup itself,** which decides the branch and CHB-006's stage-2 priority.

**Other open questions:**

- **The licence of the camera-sensitivity data** (Jiang et al. and others): CHB-004 must confirm it can be redistributed in a pack. If not, it is fetched at build time and kept out of the repository.
- **The IT8.7/1 reference data:** spectral or Lab only? Which vendor supplies spectral files must be checked before buying.
- **Consent scope for publishing derived numbers** from his rolls.

**Risks:**

- **His camera is not in any measured set**, and he has no spectrometer. LED-peak uncertainty then stays at several nanometres. Mitigate by borrowing or buying an inexpensive spectrometer, and report the sensitivity of dye amounts to a ±5 nm peak shift so the effect is known.
- **Process drift** makes reference-print comparisons noisy. The repeatability floor (C6) protects against false failures.
- **The flare model is a constant.** Measure the wedge in two surrounds (masked and unmasked) once, to bound how much flare depends on content.
- **Sessions slip.** The criteria and the dry runs on the mock engine keep each session useful even if a component is late.

**Proposed contract additions (for CHB-002 and CHB-004):**

- the `ScannerModel` record (§6.5) as a data-pack type;
- an op area `calibrate` with `calibrate.wedge` (Value: f, q, residuals), `calibrate.leds` (Value: peaks with sd) and `calibrate.verifyFlat` (Value: floor and block statistics);
- a session-bundle schema in `packages/contract/src/eval.ts`, beside `EvalResult`, so that the app, the bridge and `tools/beta-analysis/` agree on it.

## 14. References

**Project documents:**

- Architecture and work plan: `C1/design-doc/01-chromobench-architecture-and-work-plan.md` (§2, §5.4–5.5, §6, §8.3–8.4).
- CHB-006 intern guide (ingest and scan conditioning): `fitFlare`, `flatGrid`, `sigmaD`, `shadowFloor`, `rankStocks`, the conditioning table, `ScannerForward`.
- `C1/various/analysis-chromogen-studio.md` §1.2 (colour-space assumptions, scanner profiles) and §3.3–3.4 (illustrative data, the sample).
- `C1/various/analysis-goja-cv.md` §3.6 (evidence-driven design) and §4.4 (gated real-data tests).

**Chromogen code and data:**

- `C1/various/extracted/chromogen-studio/05-inline.js`: `channels.js` 477–567, `SCANNERS` 1600–1606, `makeScanner` 1645–1659.
- `C1/various/extracted/chromogen-studio/03-inline.js` (sample metadata).
- `st-data/cg/cameras/generic-bayer.json`, `st-data/cg/lights/white-led.json`, `st-data/book/10-ch10.md`.

**Textbook:** §1.2 (Callier), §1.5 (linearity against bandwidth), §1.6 (base reweighting), §1.7 (noise), §3.1 (scanner model, flat, flare, Rozzi), §3.2 (conditioning, σ₃, noise gain), §3.5 (classes, shadow floor), §3.7 (calibration: wedge, PCA, X-T5 fit, evaluation), §3.8 (stock identity), §3.9 (laws), exercise at line 1019.

**External:**

- Jiang, Liu, Gu and Süsstrunk, "What is the space of spectral sensitivity functions for digital color cameras?", WACV 2013, Sec. 3.
- Rozzi, US 6,633,408 (2003), cols. 8–11; DeCaro and Shafer, US 5,982,957 (1999), cols. 3–6.
- Stouffer transmission step wedges (the T2115: 21 steps, 0.15 D increments).
- Nikon Super Coolscan 5000 ED user's manual, specifications: RGB and IR LED light source.
- ISO 12641 / IT8.7/1 (transparency target) and IT8.7/2 (reflective target).
- Fujifilm Pixel Shift Combiner product and support pages.
- go-go-golems goja-cv repository, `pkg/cv/ops/peaks_gold_test.go` 15–26 (gated, two-method comparisons).
