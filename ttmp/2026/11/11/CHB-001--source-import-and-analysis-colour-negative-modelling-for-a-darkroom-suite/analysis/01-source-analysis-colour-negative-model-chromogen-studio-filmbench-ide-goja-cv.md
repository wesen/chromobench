---
Title: 'Source analysis: colour-negative model, Chromogen Studio, Filmbench IDE, goja-cv'
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
Summary: ""
LastUpdated: 2026-11-11T09:43:38.331078575-05:00
WhatFor: ""
WhenToUse: ""
---

# Source analysis: colour-negative model, Chromogen Studio, Filmbench IDE, goja-cv

This is the orchestrator's synthesis. The detailed per-source reports are in `various/`:

- `various/analysis-chromogen-studio.md` (+ `-summary.md`)
- `various/analysis-filmbench-ide.md`
- `various/analysis-goja-cv.md` (+ `-summary.md`)

The two textbooks were read directly: `sources/The Mathematics of the Colour Negative.md`, and chapter 1 of *Light, Film, Paper* (`various/extracted/light-film-paper/lfp-ch1-01-light.txt`).

## 1. What the sources are

| source | kind | direction | state |
|---|---|---|---|
| *The Mathematics of the Colour Negative* | executable textbook, 4 chapters, 16 sketches | both | complete; measures and corrects Chromogen, Chromogen Studio and spektrafilm |
| *Light, Film, Paper* | executable textbook about the Filmbench port of spektrafilm | forward | only ch. 1 (RGB → film exposure) written; ch. 2–4 are titles plus abstracts |
| Chromogen Studio 1.2 | single-file web app (React, WebGL2, WebGPU, workers) | **inverse**: negative scan → dyes → print | working; Gold 200 X-T5 RGB-LED triplet sample |
| Filmbench IDE | single-file web IDE with LLM agent | **forward**: scene RGB → film → print | working at preview resolution; no inversion |
| goja-cv (`go-go-golems/goja-cv`) | Go + goja image API for agents | n/a (infrastructure pattern) | mature; home domain is dust detection on film scans |

All three code bases descend from spektrafilm (Andrea Volpato, CC BY-SA 4.0 data). Chromogen is a JS spectral library; Chromogen Studio is its app; Filmbench is a separate JS port of spektrafilm's forward pipeline.

## 2. The model in one picture

Every stage is a typed map with units. Spectra live on 81 samples, 380–780 nm at 5 nm.

```text
 FORWARD (digital RAW / RGB scene; spektrafilm, Filmbench)
 scene RGB ─► XYZ (CAT16 to film illuminant) ─► (b, u, v) ─► film-exposure table ─► log H per layer
                                                                                       │ DIR coupling (before the curve)
                                                                                       │ halation/scatter (linear exposure, before the log)
                                                                                       ▼
 INVERSE (negative scan; Chromogen Studio)                                       characteristic curves
 scan counts ─► flat field (sensor coords) ─► T/T_rebate ─► scanner density             │
            ─► bounded LM dye solve (active set; 33³ table on a = K⁻¹D) ─► dye amounts c ◄─┘ (grain here)
                                                                             │
                                          ┌──────────── shared darkroom ─────┘
                                          ▼
 spectral density D(λ) = Σ c_j ε_j(λ) + base(λ)
   ─► enlarger: lamp × filters × 10^-D × paper sensitivity  ─► paper log H x  (+ printer lights ℓ: pure shifts)
   ─► paper curve ─► paper dyes ─► reflectance (single pass or Saunderson) ─► XYZ under viewing light
   ─► flare / glare ─► Bradford/CAT adaptation ─► gamut knee (last) ─► display / file
```

**The key architectural fact for chromobench:** the two directions meet at the negative's dye amounts (spektrafilm tap `cmy_film`, Filmbench tap `Density`). A digital RAW enters at the scene and is "shot" on a film. A negative scan enters at the negative via the dye solve. Both are printed by the same enlarger/paper/viewing chain, which is where the darkroom controls live.

## 3. Mathematical results that shape the design

From *The Mathematics of the Colour Negative*, in my own words:

1. **Density is linear per wavelength, not per channel.** A channel density is −log₁₀ of a weighted mean transmittance: a soft minimum of D(λ) over the band. It is concave in the dye amounts, bounded by min D and the weighted mean.
2. **The 3×3 matrix K is a Jacobian.** Hunt's "each dye alone" construction (used by Chromogen) is a secant and badly wrong for broadband cameras (0.46 dye units on the grey card through a white LED). The base-weighted Jacobian at zero dye is much better (0.035).
3. **Capture hardware dominates conditioning.** Narrowband RGB LEDs keep σ₃(J) ≈ 1.1 everywhere; a white-LED camera falls to 0.034 at dense yellow, amplifying density noise up to 29×. Dense negative areas (scene highlights) are the noisy part: σ_D ≈ 0.434 σ_T/T.
4. **Inversion = bounded nonlinear least squares per pixel.**
   - LM with closed-form Jacobian, started from K⁻¹(D − D_base), dyes boxed to [0, 4].
   - An active set (hold dyes at a bound when the gradient points out) gives a 5–7× speed-up and never worse results beyond tolerance.
   - The residual is the distance to the film's reachable set.
5. **Unreachable pixels are diagnostics.** With z = D/σ against rebate noise, they split into blank film, below base, and out of gamut. On the Gold 200 frame almost all are blank or below base, caused by uneven light (no flat field). Practically none are out of gamut. Flat-field capture matters more than solver cleverness.
6. **Balance in log exposure, never in density** (Hunt 14.17). Printer lights fitted on a grey card leave ≤ 2.4 ΔE00 on a cast grey scale; the same correction as a density offset leaves 14.6 and tints paper white. Integrate-to-grey corrects density fully and colour by α = 0.75.
7. **Composition laws decide what can be cached.**
   - Printer lights factor out of the spectral sum, so negative → paper exposure is tabulated once and lights are free per pixel.
   - Blur only in linear exposure (Jensen).
   - DIR acts before the curve.
   - Gamut compression must be the last colour step.
8. **Three channels cannot recover** the scene spectrum, interimage (DIR) coupling from one frame, or the stock's identity: every stock's dyes fit the frame exactly. The user must name the stock.
9. **Performance by staging.** Place work at its binding time: per scanner × film, per film × paper, per scan, per slider, per pixel.
   - Three 33³ tables plus 1-D curve tables.
   - Trilinear error is O(h²) in smooth cells but O(h) across the reachable-set kink.
   - Cache keys must include every input, including scan identity and table domain.
   - Workers and WebGPU build the tables; every fast path is checked against a slow reference with a test that can fail.

From *Light, Film, Paper* ch. 1:

- RGB → spectrum is ill-posed (78-dimensional metamer family); the choice changes film exposures by up to ~1 stop.
- spektrafilm uses hanatos's sigmoid irradiance spectra indexed by chromaticity in square coordinates (u, v) = ((1−x)², y/(1−x)), with the film sensitivities folded in. Filmbench's 64×64 log₂ int16 table matches spektrafilm to 0.001 stop mean.
- The per-film erf4 bandpass window changes exposures by up to 1.2 stops. It leaves an sRGB grey 0.12 stop short in blue, which the per-film/paper neutral filtration absorbs.

## 4. What each app contributes, and what is missing

**Chromogen Studio (inverse):**

- **Carry:**
  - the DOM-free `chromogen/src` library (units, spectrum, stock, channels, linalg, solve, print, colour);
  - the staging/table design;
  - the active-set LM solver;
  - rebate/flat-field/noise/classification;
  - the printer-light model (points, integrate-to-grey, warmth in mired, tint, ring-around, grey pick, roll consistency);
  - the declarative `SLIDERS` schema;
  - recipe JSON.
- **Missing or wrong:**
  - no RAW (refused);
  - no camera matrix or ICC;
  - no DIR;
  - analytic CMFs;
  - blackbody-only lights;
  - single-pass reflectance;
  - Gaussian grain on a repeating tile;
  - halation channel-packing bug and frame-relative radii;
  - no CPU reference for the per-pixel shader chain;
  - autosave keyed by file name.

**Filmbench IDE (forward + agent):**

- **Carry:**
  - typed taps;
  - the closed mutation-op log with `by` tags;
  - ask/auto modes with pending approvals and undo;
  - the layer/macro control plane with `why()` provenance;
  - the parameter table with did-you-mean errors;
  - the graph with masked enlarger exposures summed in linear light (dodge/burn, flashing, split grade);
  - axes/mosaics (test strips, contact sheets);
  - the agent's `lab` vocabulary (compare, sweep, patches ΔE00, tone, vs);
  - data for 20 films + 8 papers.
- **Missing:**
  - inversion;
  - RAW/16-bit input;
  - 16-bit/ICC output;
  - full-resolution tiled rendering;
  - B&W stocks;
  - a mask editor.
- **Weak spots:** agent safety is cooperative (arbitrary page JS), and some ops bypass the log.

**goja-cv (pattern):**

- **Carry:**
  - one op registry/schema that generates the JS API, docs and (for chromobench) GUI controls;
  - pixels never cross into JS: JS holds lazy, hash-consed node handles and Go evaluates;
  - colour space carried on the image with builder-inserted conversions;
  - masks as images plus `within(mask, fn)`;
  - structured errors with literal `fix`;
  - compact YAML results;
  - "looks" always paired with the numbers they show;
  - sandboxed workspace;
  - task libraries/prelude;
  - golden, planted-fault and docs-run tests;
  - the evidence-driven habit of deleting API that agents don't use;
  - dust/speck detection and healing, directly useful for negative scans.
- **Does not transfer:**
  - single VM per session, evals serialized;
  - no live params, persisted recipe or undo;
  - CPU only, full frame;
  - looks are files, not a display pipeline.

## 5. Implications for chromobench

1. **One Go core, three faces.** The spectral engine, solver, tables and kernels live in Go. A GPU preview path re-implements the per-pixel chain, checked against the Go CPU reference. The GUI calls Go directly. The agent drives the same core through a goja API generated from the op/param registry (the goja-cv pattern).
2. **The edit recipe is the shared state.** It is persisted, versioned, keyed by scan hash, and edited through a closed mutation-op set with provenance and undo (the Filmbench pattern). Agent edits are recipe mutations the user sees and can approve or revert.
3. **Two ingest paths into one darkroom.**
   - Digital RAW: demosaic + camera matrix → scene-linear → spectral upsampling → film stage.
   - Negative scan (scanner TIFF, or a camera RAW of a negative): linear counts → flat field → rebate → dye solve.
   - Both arrive at dye amounts, then the shared print stage. A RAW decoder is needed in both cases; no source has one (goja-cv reads LinearRaw DNG only).
4. **Darkroom controls act on paper log exposure:** printer lights / CC filtration, exposure, grade (paper gamma or morph), flashing, dodge/burn/split-grade through masks, test strips and ring-arounds. Chromogen's "finishing" operators (clarity, texture, OKLab hue/vibrance) are digital extras and should be secondary.
5. **Licensing.** The stock data is CC BY-SA 4.0. Shipping it or derived tables carries ShareAlike obligations.

## 6. Open questions for the user

- "Digital RAWs": camera photos to be simulated through film, camera scans of negatives, or both?
- Which capture setup does the dad use (narrowband RGB LED, white light + camera, flatbed/film scanner)? It decides conditioning and calibration work.
- B&W negatives? No source has B&W stocks or a B&W model.
- Output target: screen and files only, or real prints (inkjet with ICC soft-proofing)?
- Desktop app (Go + webview) or local server + browser?
