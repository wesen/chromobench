---
Title: 'Intern guide: Black-and-white negatives and papers'
Ticket: CHB-014
Status: active
Topics:
    - black-and-white
    - film-emulation
    - darkroom
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/design-doc/01-chromobench-architecture-and-work-plan.md
      Note: reserved silver-density domain, recipe and Exposure shapes, open decision on B&W in the first beta
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: §1.2 Callier coefficient, §2.2 parametric curve, §2.3 DIR as an adjacency model, §2.5 grain; the B&W model reuses all of them
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-filmbench-ide.md
      Note: §3–4 confirm B&W is not modelled in any imported source
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/05-inline.js
      Note: lines 440–465 stock loader and 1638–1659 scanner models, reused for scanning and inverting silver negatives
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/01-inline.js
      Note: lines 137–147 dichroic CC filtering of the lamp, 2141–2172 masked multi-exposure graph with sum (split-grade structure)
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/vfs/controls.js
      Note: line 9 colour grade as a curve stretch, the approach VC paper must not reuse
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/vfs/examples/05-graph.js
      Note: lines 8–14 burn by a second masked exposure, the pattern split-grade dodging and burning extends
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:26.144940498-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Black-and-white negatives and papers

## 1. What this ticket is for

Many photographers who print colour also shoot and print black and white. For them chromobench should do three things with a black-and-white (B&W) negative: open a scan of it and turn it into a positive; print it, as an enlarger would, onto **variable-contrast paper** with the contrast set by filtration, including split-grade printing and dodging and burning at different grades; and, for digital RAW photos, "shoot" them on a B&W film and develop it for a chosen time. It should also explain *why* a negative prints harder on one enlarger than on another, which is a real darkroom question with a physical answer.

None of the sources this project imported models black and white. Filmbench IDE's analysis lists "B&W stocks" under "Not modelled" (`C1/various/analysis-filmbench-ide.md` §3–4). Chromogen Studio has no B&W data. spektrafilm's profile code already accepts `channel_model: 'bw'` (`src/spektrafilm/profiles/io.py` line 21) but ships no B&W profile and no code path that uses it. So this ticket is research-led: it collects the physics and the data from the photographic literature and the manufacturers' datasheets, fits a model, and fits that model into the architecture that the colour tickets build. Sections marked **speculative** are proposals that need data or experiment before anyone should rely on them.

In scope:

- the silver image and why its density depends on how it is lit and measured (the Callier effect), with its consequences for condenser and diffuser enlargers and for scanning;
- a B&W film model: panchromatic sensitivity, one characteristic curve whose contrast and fog depend on development (time, temperature, agitation), grain and adjacency effects;
- inversion of a scanned B&W negative;
- variable-contrast paper: several emulsions with different blue and green sensitivity, contrast set by filters, split-grade printing, toning as an extension;
- integration: the reserved `silver-density` domain, new stock types in CHB-004's packs, new ops, CHB-010's multi-exposure printing, and a data-collection plan.

Out of scope: colour (everything here reuses the colour engine's structures instead of duplicating them), graded (fixed-contrast) papers beyond noting that they are the one-emulsion special case, lith printing, and anything that needs chemistry simulation beyond the empirical models below.

Whether B&W is in the first beta is an open decision for the photographer (architecture §8.4). This guide is written so the research and data stages can start regardless.

Throughout, **C1** means the CHB-001 ticket directory `/home/manuel/code/wesen/chromobench/ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`, and "textbook §n.m" means `C1/sources/The Mathematics of the Colour Negative.md`.

## 2. Silver images versus dye images

### 2.1 Density depends on geometry for silver

A colour negative's image is dye: molecules dissolved in gelatin that absorb light and scatter almost none. Beer–Lambert's law holds for it (textbook §1.2), so its density is a property of the film alone. A B&W negative's image is **developed silver**: opaque, irregular filaments of metallic silver, a micrometre or so across, that block light and also scatter it sideways. Textbook §1.2 states the consequence: "silver grains scatter strongly, so a silver image's density depends on the geometry of the instrument, while dye images scatter little, and the ratio of specular to diffuse density (the Callier coefficient) reaches about 2 for silver but is usually no more than 1.1 for colour dye images (Hunt 18.4; James ch. 17)."

Two measuring geometries bracket the possibilities:

- **Diffuse density** D_d. The film is lit from all directions (or all transmitted light is collected, which is optically equivalent), so light scattered by the silver still counts as transmitted. This is the geometry of standard densitometry (the ISO 5 series), and it is the density in every datasheet: Kodak's Tri-X curves are labelled "Densitometry: Diffuse visual" (Kodak F-4017, pp. 10–12).
- **Specular density** D_s. The film is lit by a narrow beam and only the light that continues in the beam's direction is counted. Light scattered out of the beam is lost, so the film reads denser.

Their ratio is the **Callier coefficient**, Q = D_s / D_d ≥ 1 (Callier 1909; Tuttle 1926). Q is about 1 for dyes; for silver it depends on the grain (coarse, fast emulsions scatter more than fine-grained ones) and it varies with density (Tuttle 1926; Streiffert 1947 measured motion-picture emulsions; James, 4th ed., ch. 17, whose Fig. 17.12 plots Q against density). A concrete instance with an illustrative Q of 1.3: a negative step that a densitometer reads as D_d = 1.00 transmits 10 % of diffuse light, but only 10^(−1.30) = 5 % of a collimated beam.

### 2.2 Condenser and diffuser enlargers

An enlarger's lamp house lights the negative, and the enlarging lens collects a narrow cone of the light that leaves it.

- A **diffuser** (or "diffusion", or colour-head) enlarger lights the negative from many directions through a mixing box. Scattered light is replaced by light scattered *into* the lens from other directions, so the paper sees close to the diffuse density.
- A **condenser** enlarger focuses the lamp through lenses into a converging beam aimed at the enlarging lens. Light the silver scatters out of that beam misses the lens. The paper sees something between diffuse and specular density, and dense areas lose proportionally more light than thin ones. The print's contrast rises.

How much? Ilford's contrast-control sheet says: "In practical terms with most negatives, condenser enlargers give about an extra grade of contrast compared with a diffuser enlarger. This contrast difference, though, depends on the amount of silver left in the negative. Thus there is little change of contrast between the enlarger types for very pale, flat negatives and also for the dye image of ILFORD XP2 SUPER negatives" (Ilford, *Contrast control for ILFORD MULTIGRADE variable contrast papers*, April 2010, p. 4). Kodak develops for diffusion printing and asks condenser users to shorten development: Tri-X's "starting-point recommendations are intended to produce negatives with a contrast appropriate for printing with a diffusion enlarger. To print negatives with a condenser enlarger, you may need to adjust the contrast by reducing your development time" (Kodak F-4017, 2002, p. 4).

"An extra grade" can be turned into a number. Ilford rates paper contrast by **ISO range** R: 100 times the range of log exposure the paper turns into its full tonal scale. Multigrade IV RC has R = 180, 160, 130, 110, 90, 60 and 40 under filters 00, 0, 1, 2, 3, 4 and 5 (Ilford, *Multigrade IV RC technical information*, June 2010, p. 2). Ilford's own example: a negative whose effective density range is 1.32 needs R ≈ 130, which is filter 1. Around the middle grades one grade is about 20 R units, 0.2 in density range. A negative with a diffuse range of 1.00 that prints a grade harder on a condenser therefore has an effective range of about 1.20 there: an effective Q of about 1.2. Darkroom forum discussions (Photrio threads on condenser against diffusion enlargers; weak evidence) estimate a condenser enlarger's coefficient at 1.2 and quote contrast-index targets of about 0.56–0.58 for diffusion and 0.43–0.45 for condenser printing, a ratio of about 1.3; both agree in size. This is the calibration anchor for the model in Section 5.4.

### 2.3 Scanning

A scanner is the same problem with a sensor instead of paper. A camera copying a negative on a diffusing light panel sees close to diffuse density. A dedicated film scanner with a collimated LED source sees more specular density and so shows more contrast and more apparent grain from a silver negative than from a dye negative of the same diffuse density (photographers report this widely; it should be measured, Section 7.2). Infrared dust removal, which some scanners and CHB-006's dust detection may use, relies on the image being transparent in the infrared; silver is not, and scanner documentation for infrared cleaning (Digital ICE) states that it cannot be used with conventional, non-chromogenic B&W film.

The consequence for chromobench: a B&W negative's density is only meaningful together with the geometry that measured it. That is why the architecture reserves a separate domain for it (Section 4.2).

## 3. Background: the B&W film and paper models

### 3.1 Panchromatic sensitivity and how datasheets state it

A B&W negative film has one image-forming layer (often two or more emulsions coated together, but they form one silver image). Modern camera films are **panchromatic**: sensitive from the near ultraviolet to about 650–670 nm. Its sensitivity is one spectrum, so exposure is one number per pixel:

```text
u = log₁₀ Σ_λ E(λ)·ρ(λ)·s(λ)·Δλ + κ          (one channel; κ puts the grey card at 0)
```

This is the colour film's first map (textbook §2.1) with one layer instead of three.

The datasheets publish s(λ) in two incompatible forms, and the data stage must convert both:

- **Kodak** plots "log sensitivity", where sensitivity is "the reciprocal of exposure (erg/cm²) required to produce specified density", for densities 0.3 and 1.0 above gross fog, at an effective exposure time of 0.5 s and diffuse visual densitometry (F-4017, p. 10). Under the single-sensitivity model the two curves must be parallel, separated by the log exposure that the characteristic curve needs to climb from 0.3 to 1.0 above fog: about (1.0 − 0.3)/0.56 ≈ 1.25 at Kodak's target contrast. The 2002 sheet's two curves are about 1.1 to 1.3 apart, which fits, but its legend labels the *upper* curve D = 1.0, which is physically backwards (a higher density needs more exposure, so less sensitivity). Check another edition before digitising.
- **Ilford** prints a **wedge spectrogram** "to tungsten light (2850K)" on a linear relative scale (HP5 Plus technical information, June 2010, p. 1). That is the film's response *including the lamp's spectrum*. A 2,850 K lamp emits 5.0 times more power per nanometre at 650 nm than at 450 nm (0.70 in log₁₀, Planck's law), so a spectrogram that looks flat across 450–650 nm belongs to a film about five times more sensitive per unit energy at 450 nm than at 650 nm. Dividing by the lamp is the first step of digitising it.

spektrafilm's colour profiles record the same choice as `info.log_sensitivity_density_over_min` (0.2); B&W stocks must record theirs (Section 5.2).

### 3.2 One characteristic curve, many developments

A colour negative is developed in one standard process (C-41), so its curves are fixed data. A B&W negative's curve is set by the photographer's development, and that is a creative control: Ansel Adams's N+ and N− development, push processing, compensating developers. The datasheets therefore publish curve **families**:

- Kodak shows Tri-X 400 in D-76 (large tank, agitation every minute, 20 °C) for 6, 8, 10 and 12 minutes, with base-plus-fog near 0.3 for 35 mm and near 0.2 for 120 (both on grey acetate base, 5 mil and 3.9 mil thick), and **contrast index** (CI) against development time for each developer (F-4017, pp. 11–12). Contrast index is Kodak's measure of the useful slope of the curve: the slope of a chord across the part of the curve a normal negative uses (Niederpruem, Nelson and Yule, 1966, define the construction; look it up before coding it). Kodak's image-structure data was developed "to a contrast index of 0.56" (p. 10).
- Ilford publishes one curve (HP5 Plus in Ilfotec HC 1+31, 6½ min, 20 °C) and development *times* for each developer and exposure index: ID-11 stock 7½, 10½ and 14 min for EI 400, 800 and 1600 (HP5 Plus, p. 3).

Three variables set the development:

- **Time.** Contrast rises with time and flattens off; fog rises slowly. The classical description is a saturating curve, γ(t) = γ∞(1 − e^(−t/τ)) (James, 4th ed., development kinetics; check the exact form there before relying on it).
- **Temperature.** Kodak's table for Tri-X 400 in D-76 (small tank) gives 8, 6¾, 6¼, 5½ and 4¾ minutes at 18, 20, 21, 22 and 24 °C (F-4017, p. 4). That is t(T) = t₂₀·e^(−k(T−20)) with k = ln(8/4.75)/6 = 0.087 per °C, which predicts 6.19 min at 21 °C and 5.67 at 22 °C against the table's 6¼ and 5½: within a quarter-minute, the table's own resolution. Ilford's chart example (4 min at 20 °C becomes 3 at 23 °C and 6 at 16 °C, HP5 Plus p. 5) gives k = 0.096 and 0.101. Both say: about 9–10 % shorter per degree warmer.
- **Agitation.** Ilford: with continuous agitation, "reduce these times by up to 15 %" (HP5 Plus, p. 3); Kodak publishes separate tables for small tanks (agitation every 30 s) and large tanks (every 60 s), and they differ by about a minute at 20 °C (6¾ against 7¾ min in D-76).

The model in Section 5.3 turns these into one effective development time that parameterises the curve.

### 3.3 Grain

B&W grain is clumps of developed silver, and the colour model's statistics apply unchanged: the **RMS granularity** is the standard deviation of density through a 48 µm aperture at a density of 1.0, times 1000, and Selwyn's law says the product of aperture area and variance, G = Aσ², does not depend on the aperture (textbook §2.5). Kodak gives "diffuse rms granularity" 17 for (older) Tri-X Pan, read at a net diffuse density of 1.0 with a 48 µm aperture, developed in HC-110 B to CI 0.56 (F-4017, p. 10). So G = (17/1000)² × π × 24² µm² = 0.523 µm²·D².

spektrafilm's Poisson–binomial grain model (textbook §2.5) works for one layer as well as three: G(D) = a·D_max·D·(1 − uD/D_max). With D_max = 2.7 (the top of Kodak's 12-minute D-76 curve, an illustrative choice) and u = 0.97 (spektrafilm's default), D = 1 gives a = 0.523/(2.7 × 1 × 0.641) ≈ 0.30 µm². Because grain is measured in diffuse density, a condenser enlarger and a collimated scanner also amplify grain by roughly Q (speculative, to first order).

### 3.4 Adjacency effects

Development is a chemical reaction in a thin layer of developer. Where much silver develops, the developer is exhausted locally and releases bromide, which slows development; both diffuse sideways over tens to hundreds of micrometres (the distance depends on agitation and dilution). At the boundary between a dense and a thin area, fresh developer diffuses from the thin side into the dense side's edge and exhaustion products diffuse the other way: the dense side's edge develops denser (border effect), the thin side's edge thinner (fringe effect), and fine dark lines on a light ground come out denser than large areas (the Eberhard effect). The visible result is edge sharpening, stronger with dilute developers and little agitation (stand development is the extreme). C. N. Nelson modelled it with a chemical spread function acting on developed density (*Photographic Science and Engineering*, 1971); Cline's RIT thesis (1982) combined optical and chemical spread functions and predicted the bar profiles of a test target to within 0.02 D.

The colour model already contains this structure. spektrafilm's DIR coupling computes an inhibitor from the developed dye, spreads it with a kernel (a 20 µm Gaussian plus 6 % of a 200 µm exponential) and subtracts it from log exposure before the final development (textbook §2.3). With one layer instead of three, the 3 × 3 matrix becomes a single number, and the textbook already shows the result at an edge: cyan 1.399 inside a red object and 0.687 outside overshoots to 1.484 and undershoots to 0.615 near the edge. That *is* an adjacency effect. Reusing that op for B&W is the proposal of Section 5.6 (speculative: the kernel's size and strength must be calibrated, not borrowed).

### 3.5 Variable-contrast paper

B&W paper is a silver emulsion on a white base, sensitive only to blue and green light (which is why it can be handled under a red or amber safelight). **Graded** paper has one emulsion and a fixed contrast. **Variable-contrast** (VC) paper, such as Ilford Multigrade, has several, and Ilford's contrast-control sheet explains the mechanism in a passage worth quoting nearly in full:

> "MULTIGRADE papers are coated with an emulsion which is a mixture of three separate emulsions. Each emulsion is a basic blue sensitive emulsion to which is added different amounts of green sensitising dye. […] All parts of the emulsion have the same contrast. They also all have the same speed to blue light, but naturally, the part of the emulsion with only a small amount of green sensitising dye has a low speed […] to green light. When the paper is exposed to blue light, all parts of the emulsion react and contribute equally to the final image. This image is of high contrast […]. When the paper is exposed to green light, only the parts of the emulsion with the larger amounts of green sensitising dye react initially. […] The resultant curve has a very much wider exposure range and is thus of low contrast." (Ilford, *Contrast control*, April 2010, p. 1)

In other words: under blue light the three emulsions' curves lie on top of each other and add into one steep curve; under green light they are spread along the exposure axis, and their sum is a long, shallow curve. A magenta filter (which absorbs green) makes the light bluer and the print harder; a yellow filter (which absorbs blue) makes it greener and softer. Ilford's **Multigrade filters** come in twelve steps, 00, 0, ½, 1 … 5, and the exposure "for filters 00–3½ is the same; that for filters 4–5 is double" (MG IV RC, p. 2): ISO speed P 200 for 00–3½ and 100 for 4–5, P 500 unfiltered. The paper's measured spectral sensitivity (unfiltered, equal energy, 400–560 nm, at densities 0.5, 1.0 and 1.5) has a blue plateau and a green hump near 520 nm that falls steeply above 540 nm, and the three curves are *not* parallel: the green hump is relatively higher at density 0.5 than at 1.5, which is what a mixture of emulsions with different green speeds predicts.

A colour enlarger can set the grade with its yellow and magenta dials. Ilford tabulates settings for three families of colour heads (p. 3). For heads calibrated in Kodak CC units, the single-filter settings are 199Y (00), 90Y (0), 70Y (½), 50Y (1), 30Y (1½), none (2), 5M (2½), 25M (3), 50M (3½), 80M (4), 140M (4½) and 199M (5); Durst heads use their own scale (for example 150Y for 00 and 170M for 5 on a head whose magenta goes to 170). Ilford warns that "the maximum contrast will be slightly lower as the filters used in colour heads are optimised for use with colour paper". spektrafilm's dichroic filter model is in Kodak CC units (`model/color_filters.py`, `apply_cc`), so the Kodak column can drive it directly; the Durst column cannot.

### 3.6 Split-grade printing

**Split-grade** printing gives the paper two exposures with different filters, typically a soft one (filter 00, pure yellow) and a hard one (filter 5, pure magenta), and sets the contrast by the ratio of the two times. Darkroom workers like it because the two exposures can be dodged and burned separately: highlights adjusted with the soft exposure, shadows with the hard one.

Physics says something precise about it. Exposure is linear in light: each emulsion component k receives H_k = Σ_exposures t_i Σ_λ L(λ) F_i(λ) T(λ) s_k(λ). Two exposures through filters F₁ and F₂ for t₁ and t₂ are therefore *exactly* one exposure to the light t₁·L·F₁ + t₂·L·F₂, a mixture of the two spectra. For a uniform exposure (no masks), split-grade printing is equivalent to a single exposure with some mixed light, and the paper, which only sees three numbers H₁, H₂, H₃, cannot tell the difference. It differs from a single *filter setting* only if no yellow-and-magenta combination produces the same three component exposures (dichroic filters multiply transmittances, they do not mix spectra), and from a single *exposure* only through reciprocity and intermittency effects (a paper may respond differently to two short exposures than to one long one; James discusses intermittency). The real value of split-grade printing is local: different masks for the two exposures give different contrast in different parts of the print. The engine computes that per pixel with the same linear sum, and CHB-010's multi-exposure printing already has the structure for it (Section 5.7).

### 3.7 Toning

Toners convert the silver image chemically: selenium toner to silver selenide (a cooler, purple-brown image with a slightly higher maximum density, acting first on the densest parts), sulphide ("sepia") toner to silver sulphide (brown). For the model, toning changes the print's spectral reflectance as a function of local density and toning time. It is an extension (Section 7.5), and its data must be measured.

## 4. How this fits the system

### 4.1 The chain

```text
 digital RAW ──► scene-xyz ──capture.expose (B&W stock, 1 channel)──► film-logH [1 ch]
                                    │ film.halation, film.couple (adjacency), film.grain   (CHB-012 ops, 1 ch)
                                    ▼
                             film.developSilver (time, temp, agitation) ──► silver-density [1 ch]
 negative scan ──► camera-linear ──scan.* (CHB-006)──► scanner-density [3 ch] ──invert.silver──┘
                                                                                                │
             print.expose (enlarger: lamp × filters × 10^(−Q_eff·d·ε_Ag − base) × s_k, per exposure,
                           summed in linear H per paper component; head geometry sets Q_eff)   │
                                                                                                ▼
                                                                         paper-logH [K = 3 components]
                                                     print.develop (Σ_k w_k f(x_k)) ──► paper-dyes [1 ch: silver]
                                                     view.reflect (paper image tone) ──► print-xyz ──► output.*
```

Everything after `print-xyz` is shared with colour. Everything before it reuses a colour op with one channel where the physics is the same (exposure, halation, grain, coupling) and adds an op only where it differs (development of silver, inversion of a silver scan).

### 4.2 Domains

The architecture reserves `silver-density` for this ticket (architecture §5.1). This guide proposes what it means.

**Decision record: what `silver-density` holds and where it is used**

- **Context.** A silver image's density depends on the optical geometry (Section 2). Any consumer that transmits light through the negative (an enlarger, a scanner) must apply its own geometry; a consumer that forgets will be wrong by up to a paper grade without any error.
- **Alternatives.** (a) Treat silver as a one-dye negative in `film-dyes` with one channel. Simple, but `print.expose` would silently treat it like dye (Q = 1). (b) Use `silver-density` for the negative and represent the print's silver as `paper-dyes` with one channel. (c) Use `silver-density` for negatives and prints alike.
- **Decision.** (b). `silver-density` is a one-channel image of the **net diffuse visual transmission density of the developed silver above base-plus-fog**: what a standard densitometer reads above the film's unexposed edge, which is also what a scan reads relative to the rebate. The print's silver is only ever *viewed*, in one fixed geometry, so it plays exactly the role colour paper dye plays in `view.reflect`: one "colorant" amount in units of the paper's unit silver spectrum, where 1 unit is 1.0 visual reflection density.
- **Consequences.** `print.expose` accepts two input domains and must apply Q for `silver-density`. `paper-dyes` allows one channel. Base-plus-fog becomes stock data, applied in printing with Q ≈ 1 (fog is silver, but at 0.05–0.1 D the error is small). Proposed to CHB-002 in Section 9.

Channel counts: `film-logH` has 1 channel for a B&W film; `paper-logH` has one channel per paper emulsion component (3 for Multigrade; a one-emulsion graded paper has 1); `paper-dyes` has 1.

### 4.3 Dependencies

| Ticket | What CHB-014 needs from it | What CHB-014 gives back |
|---|---|---|
| CHB-002 | domains, op registry, recipe fields | the contract additions of Section 9 |
| CHB-003 | spectral core (`read`, grids, channels), print chain, `view.reflect`, laws harness | one-channel paths through them |
| CHB-004 | pack format, loader, missing-data policy, lamps, dichroics | B&W stock types (Section 5.2) |
| CHB-010 | real-enlarger mode, multi-exposure with masks and per-exposure filtration | the requirement that exposures sum per paper component (Section 5.7) |
| CHB-012 | `capture.expose`, `film.couple`, `film.halation`, `film.grain` | one-channel use of them |
| CHB-006 | scan conditioning, rebate | a note that IR dust removal fails on silver |
| CHB-005 | GPU chain | one-channel and K-component variants |
| CHB-009 | controls | grade, head type, split-grade UI |
| CHB-013 | measurement sessions | Q(D), silver image tone, MG filter spectra |

The architecture lists CHB-014 as depending on 003 and 010 (work plan §8.1). The research and data stages (Section 7) depend on nothing and can run in parallel with everything; the model stage can run against `engine-mock` and CHB-003's f64 core as soon as the core's spectral functions exist.

## 5. Design

### 5.1 What exists and what to reuse

There is no B&W code to port. These pieces carry over:

| Piece | Where | Use for B&W |
|---|---|---|
| Spectral grid, channel density, flat-wedge law | textbook §1.1, §1.3, §3.7 ("a flat density d reads d in every channel of every scanner") | silver is nearly flat, so this law becomes the B&W inversion's main test |
| Parametric characteristic curve (two softplus terms, γ, toe, shoulder) | textbook §2.2; spektrafilm `model/parametric.py`; Chromogen `stock.js` `parametric` | the development model's curve family |
| Sum-of-normal-CDFs curve, evaluated per component | spektrafilm `utils/morph_curves.py` lines 93–131 (`_evaluate_channel_density`) | each paper emulsion component's curve |
| DIR coupling with spatial spread | spektrafilm `model/couplers.py`; textbook §2.3 | adjacency effects, 1 × 1 |
| Poisson–binomial grain | spektrafilm `model/grain.py`; textbook §2.5 | one layer, calibrated to RMS granularity |
| Halation kernel and presets | textbook §2.4; spektrafilm `params_builder.py` 233–252 | one channel, strength recalibrated |
| Dichroic CC filters, TH-KG3 lamp | CHB-004 packs (spektrafilm `color_filters.py`, `illuminants.py`) | VC paper filtration |
| Masked exposures summed in linear exposure | Filmbench `g.enlarger(...).through(mask)` and `g.sum` (`C1/various/extracted/filmbench-ide/01-inline.js` lines 2141–2172; `vfs/examples/05-graph.js` lines 8–14) | split-grade, dodging and burning per grade |
| Pre-flash, x ↦ log₁₀(10^x + φ) | textbook §2.6 | flashing B&W paper, same formula per component |
| Noise-aware classes (blank, below base) | textbook §3.5; Chromogen `source.js` `classify` | the same classes for a silver scan |

What to leave behind: Filmbench's "grade" control, which maps grade 0–5 to a stretch of the colour paper's curves (`vfs/controls.js` line 9: `GRADE = [[0, 0.7], [1, 0.82], [2, 1], [3, 1.2], [4, 1.45], [5, 1.8]]`). It is a reasonable stand-in for colour paper but the opposite of how VC paper works: B&W contrast comes from the light's spectrum, not from a curve stretch.

### 5.2 B&W stocks in CHB-004's packs

CHB-004 defines the pack format (one JSON sidecar and one safetensors file per stock, units in names, NaN preserved, a content hash per item). B&W adds two stock types. Sketch of the loader-side types, extending CHB-004's `StockData`:

```ts
// packages/data/src/types-bw.ts (sketch; extends CHB-004's StockData)
export interface Provenance {
  source: string;            // 'Kodak F-4017 (2002) p. 10' | 'measured: CHB-013 session 3'
  method: 'digitised' | 'measured' | 'fitted' | 'assumed';
  uncertainty?: string;      // '±0.05 log sensitivity' …
}

export interface BwFilmStock {
  id: string; name: string; channelModel: 'bw'; role: 'film';
  sensitivity: { log10Sensitivity: Spectrum81;            // equal-energy, 1 channel
                 criterion: { densityAboveFog_D: number; exposure_s: number };   // Kodak: 1.0 (or 0.3), 0.5 s
                 provenance: Provenance };
  baseFog_D: number;                                       // net-density zero: 0.30 (Tri-X 135), 0.20 (120)
  base_D?: Spectrum81;                                     // spectral shape of base+fog if measured; else flat
  silverSpectrum: { unit_D: Spectrum81; provenance: Provenance };   // diffuse visual density 1 ↔ unit 1; flat until measured
  callier: { density_D: number[]; q: number[]; provenance: Provenance };   // Q(D) ≥ 1, diffuse density axis
  development: DevelopmentModel;                           // Section 5.3
  granularity?: { rms: number; aperture_um: 48; density_D: 1.0; provenance: Provenance };   // Tri-X: 17
  antihalation: 'strong' | 'weak' | 'no';
  curveFamilies: CurveFamily[];                            // the digitised datasheet curves the model was fitted to
}

export interface CurveFamily {                             // one datasheet figure
  developer: string; dilution?: string; temp_C: number; agitation: Agitation;
  curves: { time_s: number; log10Exposure_luxs: number[]; grossDensity_D: number[] }[];
  provenance: Provenance;
}

export type Agitation = 'intermittent-30s' | 'intermittent-60s' | 'continuous' | 'stand';

export interface DevelopmentModel {                        // Section 5.3; one fit per developer
  byDeveloper: Record<string, DevelopmentFit>;             // key: 'D-76', 'ID-11', 'HC-110 B' …
}

export interface DevelopmentFit {
  kDev_perC: number;                                       // temperature coefficient: 0.087 for Tri-X in D-76
  agitationFactor: Partial<Record<Agitation, number>>;     // a_agit; the datasheet's reference agitation is 1
  gammaInf: number; tauGamma_s: number;                    // γ(t_eff) = γ∞ · (1 − e^(−t_eff/τ_γ))
  fog0_D: number; fog1_D_per_s: number;                    // bf(t_eff) = f₀ + f₁ · t_eff
  x0Inf_log10H: number; dx0_log10H: number; tauX_s: number;          // x₀(t_eff) = x₀∞ + Δx · e^(−t_eff/τ_x)
  range_D: number; toeWidth_log10H: number; shoulderWidth_log10H: number;   // D_r, w_toe, w_sh (textbook §2.2)
  validTime_s: [number, number]; validTemp_C: [number, number];      // span of the fitted family
  provenance: Provenance;
}

export interface VcPaperStock {
  id: string; name: string; channelModel: 'bw-vc'; role: 'print';
  components: { log10Sensitivity: Spectrum81; weight_D: number }[];   // K = 1 (graded) … 3 (Multigrade)
  curve: { kind: 'cdfs'; centers: number[]; amplitudes: number[]; sigmas: number[] }; // shared by all components
  imageTone: { unit_D: Spectrum81; provenance: Provenance };          // reflection; neutral until measured
  paperBase_D: Spectrum81;
  isoRangeByFilter?: Record<string, number>;               // '00': 180 … '5': 40 (fit target, not model input)
  isoSpeedByFilter?: Record<string, number>;
  filtrationTables?: Record<string, Record<string, { y: number; m: number }>>;  // 'kodak-cc-single' → '00' → {y:199, m:0}
  spectralSensitivityAtDensity?: { density_D: number; log10Relative: Spectrum81 }[];  // MG IV RC at 0.5, 1.0, 1.5
}
```

Two rules matter. **Datasheet curves are stored next to the fitted model** (`curveFamilies`, `isoRangeByFilter`, `spectralSensitivityAtDensity`), so a test can always compare the model against the data it came from. And **every array carries provenance**, because most of this data is digitised from plotted figures with a few per cent of uncertainty and some of it will be replaced by measurements.

spektrafilm's `channel_model` enum already contains `'bw'`, but its validation requires three-column arrays (`profiles/io.py` lines 315–339). If upstream ever ships B&W profiles, CHB-004's exporter should map them onto `BwFilmStock`; until then, B&W stocks come from `tools/bw-data/` (Section 7.2), not from the spektrafilm exporter.

### 5.3 The film: exposure and development

Exposure is `capture.expose` with a one-channel sensitivity (CHB-012). Development is a new op:

```ts
// catalog entry, sketch (packages/contract/src/catalog/film.ts)
const filmDevelopSilver: OpDef = {
  name: 'film.developSilver', area: 'film', on: 'Image', returns: 'Image',
  domainIn: 'film-logH', domainOut: 'silver-density',
  class: 'pointwise', binding: 'setting',
  recipePath: 'capture.development',
  args: {
    developer:  { type: 'enum', values: ['D-76', 'ID-11', 'HC-110 B', 'XTOL', 'Ilfotec HC 1+31'], doc: 'developer and dilution' },
    time_s:     { type: 'number', unit: 's', min: 60, max: 3600, usual: [300, 900], doc: 'development time' },
    temp_C:     { type: 'number', min: 14, max: 30, usual: [18, 24], doc: 'developer temperature in °C' },
    agitation:  { type: 'enum', values: ['intermittent-30s', 'intermittent-60s', 'continuous', 'stand'],
                  doc: 'agitation regime; scales the effective development time' },
  },
  doc: 'Develop a B&W film exposure to net diffuse silver density.',
};
```

(`Unit` has no temperature unit; `temp_C` keeps it in the name, and Section 9 proposes adding `'degC'`.)

**Proposed development model (speculative in form, fitted to datasheets).** Fold time, temperature and agitation into one **effective development time**, then make each curve parameter a function of it:

```text
t_eff      = t · e^(k_dev · (T − 20 °C)) · a_agit     k_dev ≈ 0.087–0.10 per °C (Section 3.2), fitted per developer
                                                     a_agit = 1 for the datasheet's reference agitation,
                                                     up to 1/0.85 ≈ 1.18 for continuous (Ilford), fitted otherwise
γ(t_eff)   = γ∞ · (1 − e^(−t_eff/τ_γ))                slope of the straight part
bf(t_eff)  = f₀ + f₁ · t_eff                          base-plus-fog: the rebate's diffuse density
x₀(t_eff)  = x₀∞ + Δx · e^(−t_eff/τ_x)                toe corner, Δx > 0: effective speed rises a little with development
D(x)       = bf + γ·w_toe·log₁₀(1 + 10^((x − x₀)/w_toe)) − γ·w_sh·log₁₀(1 + 10^((x − x₀ − D_r/γ)/w_sh))
d(x)       = D(x) − bf(t_eff)                         the silver-density value: net diffuse density above base-plus-fog
```

Here x is log₁₀ exposure in lux·s, D(x) is the gross diffuse density a densitometer reads (the datasheet curves plot it), and d(x) is what the op writes. The curve is the textbook's two-softplus parametric curve (§2.2) with d_min replaced by base-plus-fog, the toe width t renamed w_toe and the shoulder width s renamed w_sh so that t stays development time, and the density span D renamed D_r. Its parameters read off directly: slope γ, toe corner x₀, a straight part D_r high, corners rounded over w_toe and w_sh. Base-plus-fog sets the rebate density, which `invert.silver` measures and subtracts (Section 5.8), so the unexposed film always maps to d = 0 whatever the development.

Per stock and developer, the parameters γ∞, τ_γ, f₀, f₁, x₀∞, Δx, τ_x, D_r, w_toe and w_sh are fitted by least squares to the digitised curve family (Kodak D-76: 6, 8, 10, 12 min) and checked against the contrast-index-against-time curves of the same sheet. A developer with only one published curve (Ilford's sheets) cannot constrain τ_γ that way. An approximate substitute is the published push times: development for EI 800 and 1600 aims at a printable highlight density despite one or two stops less exposure, so γ at the push time must be roughly γ at the normal time scaled by the highlight's log-exposure ratio. That target is a printing convention, not a measured density, so a τ_γ obtained this way is a guess: record it with `method: 'assumed'` and replace it when a second curve is digitised or measured.

This is a phenomenological model, not chemistry. Its claim is only that it interpolates the published curves smoothly in time, temperature and agitation and extrapolates sensibly for a few minutes either side. Outside `validTime_s` and `validTemp_C` the op still runs but emits `W_DEV_EXTRAPOLATED` (Section 9).

**Laws for the film:**

- *Time–temperature equivalence.* Developing for t₂₀ at 20 °C and for t₂₀·e^(−k_dev·ΔT) at 20 + ΔT gives the same curve (exactly, by construction), and with k_dev = 0.087 per °C the Kodak D-76 table is reproduced within ±0.25 min: predicted 8.03, 6.19, 5.67 and 4.77 min at 18, 21, 22 and 24 °C against 8, 6¼, 5½ and 4¾ (the worst point, 22 °C, is 0.17 min off).
- *Monotonicity.* For t₂ > t₁ the curve's contrast index is higher and its fog not lower.
- *Neutral reproduction of the datasheet.* At each published development time, the model is within the digitisation uncertainty of the digitised curve (target: 0.03 D rms).

### 5.4 The Callier model

The enlarger and the scanner each need the density their geometry sees. **Proposal (speculative):**

```text
D_eff(d) = d · (1 + s · (Q(d) − 1))       d: net diffuse silver density (the silver-density value)
                                           Q(d): the stock's Callier curve, ≥ 1 (from callier.q)
                                           s: specularity of the optics, 0 (diffuse) … 1 (fully specular)
```

with `s` a property of the enlarger head or scanner: 0 for a diffusion head or a camera on a diffusing panel, a fitted value for a condenser head, close to 1 for a point-source enlarger. Until Q(d) is measured, use a constant Q chosen so that a condenser head with s = 1 reproduces Ilford's "about an extra grade" on a negative of diffuse range 1.0, which Section 2.2 put at Q_eff ≈ 1.2. The textbook's "about 2" is the upper end for coarse silver read fully specularly.

Two things must hold whatever the final form: **s = 0 gives exactly the diffuse density** (the diffusion head and the datasheet agree), and **dye images are unaffected** (chromogenic films carry Q = 1). Both are laws in Section 8.

The spectral form of the enlarger exposure for a silver negative, per paper component k and per exposure i, is then

```text
H_k,i = t_i · Σ_λ L(λ) · F_i(λ) · 10^(−D_eff(d) · ε_Ag(λ) − b(λ)) · s_k(λ)
```

with ε_Ag the silver's unit spectrum (diffuse visual density 1), b the base, F_i the exposure's filtration. And this is where B&W becomes cheap. **If the silver is spectrally neutral** (ε_Ag(λ) = 1 everywhere), the silver factor leaves the sum:

```text
H_k,i = t_i · 10^(−D_eff(d)) · C_k(F_i),        C_k(F) = Σ_λ L(λ) F(λ) 10^(−b(λ)) s_k(λ)
x_k   = log₁₀ Σ_i H_k,i = log₁₀ Σ_i t_i C_k(F_i) − D_eff(d)
```

Filtration and times change only K constants; per pixel the cost is one lookup of D_eff and K additions. This **neutral-silver factorisation** is the B&W analogue of the colour law "printer lights factor out of the spectral sum" (textbook §2.8). It fails, and the full spectral sum is needed, exactly when something in the negative has a colour: a warm-toned silver image, a staining developer, residual sensitising dye, or a colour negative printed on B&W paper. Those are the cases where the engine's spectral machinery earns its keep.

### 5.5 The VC paper

The paper develops each component's exposure through the shared curve and adds the silver:

```text
c_paper = Σ_{k=1..K} w_k · f(x_k)            f: the shared curve (sum-of-CDFs, normalised to 1 at maximum)
                                             w_k: each component's share of maximum density (Σ w_k = D_max)
```

Ilford's description fixes the structure: equal blue speed and equal contrast for all components, different green sensitisation. So the component sensitivities have the form

```text
s_k(λ) = s_blue(λ) + g_k · s_green(λ)        g₁ < g₂ < g₃: the green-sensitising amounts
```

and the unknowns per paper are two spectral shapes (s_blue, s_green), three gains g_k, the three weights w_k and the shared curve's parameters. **Fitting** (speculative until done) uses, all from Ilford's sheets:

1. the unfiltered spectral sensitivity at densities 0.5, 1.0 and 1.5, which constrains s_blue, s_green and how the g_k spread (the non-parallelism of Section 3.5);
2. the characteristic curves under each Multigrade filter and the ISO range by filter (180 … 40), which constrain f and the g_k;
3. the ISO speed by filter, which constrains overall sensitivity;
4. as a *check*, not a fit target, the colour-head filtration table: the Kodak-column settings run through CHB-004's dichroic model must give ISO ranges in the right order and roughly the right values (Ilford warns colour heads reach slightly less contrast at grade 5).

The Multigrade filters themselves are acetate filters whose transmittances Ilford does not publish; they must be measured (CHB-013 has a spectrometer session) or approximated by dichroic settings.

**ISO range** is computed from a simulated step wedge: R = 100 × (log H at which density reaches 90 % of (D_max − D_min) above D_min − log H at which it reaches D_min + 0.04). That is the construction commonly quoted for ISO 6846; verify against the standard before treating the computed values as comparable with Ilford's to better than 10 R units. An op `measure.isoRange` returns R and P for the current paper, lamp and filtration, which is what the agent needs to answer "which grade does this negative want?".

### 5.6 Grain, halation and adjacency on one channel

`film.grain`, `film.halation` and `film.couple` are CHB-012's ops. For B&W they run on one channel with stock parameters:

- **Grain**: the single-layer Poisson–binomial model with the crystal area fitted to the stock's RMS granularity (Section 3.3: about 0.30 µm² for Tri-X with illustrative D_max and u). Sublayers are optional; most B&W datasheets give no data for them.
- **Halation**: spektrafilm's kernel with the stock's antihalation tag, but one strength instead of three. Colour presets give the red layer most of the halo because it sits next to the base; a panchromatic emulsion is one layer, so its strength must be calibrated (speculative; start from the red value and check visually against a real negative of a light source).
- **Adjacency**: `film.couple` with a 1 × 1 matrix M = [m] and the spatial kernel. `m` and the kernel widths depend on developer, dilution and agitation (more for dilute developers and stand development) and must be calibrated from an edge target developed under known conditions. The stock carries a table of `(developer, agitation) → {m, sigma_um, tail_um, tailWeight}`; the default is m = 0 (no adjacency) until measured.

### 5.7 Printing: one print.expose, many exposures

CHB-010 builds the real enlarger mode and multi-exposure printing: a recipe holds `print.exposures: Exposure[]`, each with a kind (`main`, `dodge`, `burn`, `flash`, `split`), a mask, a time and an optional filtration (architecture §5.4). For B&W the requirement on CHB-010 is precise:

> Exposures add in linear exposure **per paper component**, after each exposure's own filtration has been applied in its spectral sum. Never add log exposures, and never apply a filtration as a shift after summing.

The colour print already sums per paper layer, so the rule is the same with K components instead of three layers. With the neutral-silver factorisation (Section 5.4), each exposure contributes `t_i · mask_i(p) · C_k(F_i)` per pixel p; precompute C_k(F_i) once per exposure. Pseudocode for one pixel:

```ts
// print.expose for silver-density input, K paper components (sketch)
function paperLogH(d: number, p: Pixel, exposures: ResolvedExposure[], head: Head, stock: BwFilmStock): number[] {
  const Deff = d * (1 + head.specularity * (callierQ(stock, d) - 1));
  const T = Math.pow(10, -Deff);                       // neutral silver: one number for all λ
  const H = new Array(K).fill(0);
  for (const e of exposures) {                         // main, split soft, split hard, burns, dodges, flash
    const m = e.mask ? e.mask.at(p) : 1;               // 0..1
    const t = e.kind === 'flash' ? 1 : T;              // a flash reaches the paper through the base only (textbook §2.6)
    for (let k = 0; k < K; k++) H[k] += e.time_s * m * e.C[k] * t;   // e.C[k] = Σ L F_e 10^-b s_k, per exposure
  }
  return H.map((h) => Math.log10(Math.max(h, 1e-10)));   // sum first, log last: exposures add, log exposures do not
}
```

A non-neutral negative replaces the scalar `T` by the spectral sum per exposure and component (CHB-005 then needs a small table over d, keyed by the negative's tone spectrum and the filtration).

**Split-grade** is two `Exposure`s of kind `split` with filtrations for filter 00 and filter 5 (or any pair), each with its own mask. The equivalence of Section 3.6 gives a law: for uniform masks, the two exposures produce exactly the component exposures of one exposure with the mixed light, to rounding. A **grade test strip** is CHB-010's test strip over the filtration axis instead of time.

### 5.8 Inverting a scanned B&W negative

CHB-006 conditions the scan as for colour: flat field, rebate (which is now base-plus-fog), noise σ per channel, scanner density per channel above the rebate. A new op turns that into silver density:

```ts
const invertSilver: OpDef = {
  name: 'invert.silver', area: 'invert', on: 'Image', returns: 'Image',
  domainIn: 'scanner-density', domainOut: 'silver-density',
  class: 'pointwise', binding: 'scan',
  args: { geometry: { type: 'enum', values: ['diffuse', 'collimated'], default: 'diffuse', doc: 'scanner optics' } },
  doc: 'Net diffuse silver density from a scan of a B&W negative, with a residual for non-neutral pixels.',
};
```

For neutral silver every channel reads the same density above the rebate (the flat-wedge law of textbook §3.7: "a flat density d reads d in every channel of every scanner"), times the scanner's Q_eff. So the solve has one unknown:

```text
D̂ = Σ_k (D_k / σ_k²) / Σ_k (1 / σ_k²)          inverse-variance weighted mean of the channels
d  = solve D_eff(d) = D̂ for d                   identity for a diffuse scanner; a 1-D Newton step otherwise
r_k = D_k − D̂                                   residual per channel
```

The residual is the diagnostic, as it is for colour (textbook §3.5): a consistent channel spread means the image is not neutral (a warm silver tone, a staining developer, a chromogenic film opened as silver, a toned negative). Report it as a warning with the spread in density; if ε_Ag has been measured for the stock, solve with it instead of assuming flat. Blank and below-base classes work exactly as Chromogen's `classify` does, on D̂ and its noise.

To make a *positive* without printing (the digital path), invert the film's curve, d → u, using the development the user states (or, if unknown, a development fitted so the frame's density range maps to a chosen scene range: this cannot be recovered from one frame, for the same reason the stock cannot be recovered in colour, textbook §3.8). Printing does not need this inverse: the enlarger needs only `d`.

### 5.9 Viewing the print and toning

`view.reflect` turns the paper's silver amount into reflectance with the paper's image-tone spectrum and base: R(λ) = 10^(−(c·ε_tone(λ) + b_paper(λ))), then XYZ under the viewing light, flare and output exactly as for colour (textbook §2.7). ε_tone is flat ("cool-to-neutral" Multigrade IV RC, MG IV RC p. 1) until measured; warm-tone papers will need their own measured spectra.

**Toning (extension, speculative).** An op `print.tone` (`paper-dyes` → `paper-dyes`, one channel) mixes the silver spectrum with a toned spectrum per pixel, with a toned fraction that grows with density and toning time, and an optional D_max gain for selenium. Every number in it must come from measured reflectance spectra of toned step wedges.

### 5.10 Data structures for the head

```ts
// recipe additions, sketch (see Section 9)
interface EnlargerHead { kind: 'condenser' | 'diffusion' | 'cold-light' | 'point-source'; specularity?: number; lamp?: string }
interface BwDevelopment { kind: 'bw'; developer: string; dilution?: string; time_s: number; temp_C: number;
                          agitation: 'intermittent-30s' | 'intermittent-60s' | 'continuous' | 'stand' }
```

`cold-light` heads have their own lamp spectrum (a mercury-phosphor tube), which changes the paper's grade response; Ilford reports that some cold-light heads not designed for VC paper "may give a reduced contrast range" and publishes exposure factors for an Aristo W45 lamp with 40Y (Contrast control, p. 4). Without a measured spectrum, cold-light heads are listed but unsupported.

## 6. One flow, traced end to end

This trace follows one negative from scene to print. Datasheet values are real; **the paper's component parameters are illustrative**, chosen only to show the mechanism with Ilford's ISO range values at the two ends.

**1. The negative.** Tri-X 400 exposed at EI 400 and developed in D-76 for 6¾ min at 20 °C in a small tank: Kodak's starting point, intended to give a contrast suitable for a diffusion enlarger, which this trace takes as CI 0.56 (Kodak's image-structure target). Three scene patches at relative log exposure −0.85, 0 and +0.85 (shadow, grey card, highlight: a 5.6-stop range) develop to net diffuse densities d = 0.15, 0.62 and 1.10 above base-plus-fog (0.62 ± 0.56 × 0.85, with the shadow just in the toe). The negative's diffuse density range is 0.95.

**2. The scan.** A camera on a diffusing light panel reads each patch 0.15, 0.62 and 1.10 above the rebate in all three channels (flat silver, diffuse geometry, Q_eff = 1). `invert.silver` returns the same three numbers with zero residual. Had the silver been warm-toned, the blue channel would read higher than the red and the residual would report it.

**3. The paper (illustrative parameters).** A three-component VC paper: each component has maximum density 0.7 (D_max 2.1, close to Multigrade IV RC glossy), a normal-CDF curve 0.119 log H wide, equal blue speed, and green speeds lower by 0, 0.7 and 1.4 log H. Computed ISO ranges: pure blue light gives R = 40 (Ilford's filter 5) and pure green R = 165 (Ilford's filter 00 is 180). Mixing blue and green light, R falls monotonically: R = 130 at a blue share of 0.051, R = 110 at 0.106, R = 90 at 0.194, R = 60 at 0.458. (Blue share is the fraction of the exposure that comes from blue light, measured in blue-equivalent exposure.)

**4. Print on a diffusion head at R = 110 (filter 2).** Exposure is set so the grey patch prints at reflection density 0.74 (18 % reflectance). The shadow patch prints at 1.70, the highlight at 0.11: tone in both ends.

**5. The same negative on a condenser head** (Q_eff = 1.25 for this trace, s = 1). The paper now sees densities 0.19, 0.78 and 1.38: range 1.19. At the same filter 2 the shadow prints at 1.96, near paper black, and the highlight at 0.015, essentially paper white: the print is a grade too hard, as Ilford says. One grade softer (R = 130, filter 1) gives 1.68 and 0.054, close to the diffusion print at filter 2.

**6. Split-grade.** One second of pure green light (filter 00) plus 0.25 s of pure blue (filter 5) gives every component the same exposure as a single exposure with blue share 0.25/1.25 = 0.2, so the paper behaves as R = 89, about filter 3. A real darkroom worker would add a sky mask to the blue exposure only; the engine computes that per pixel with the same formula.

**7. Viewing.** The three print densities become reflectances under the paper's flat image tone and go through CHB-003's view and output ops unchanged.

The numbers in steps 3–6 come from a 40-line script of the model in Section 5.5 with the illustrative parameters; reproducing them is the first unit test of `print.develop` for VC paper, before any real paper is fitted.

## 7. Staged plan

Each stage has a "done" criterion. **Speculative** marks work whose model form may change after the data arrives.

### 7.1 Stage 1: research (no dependencies)

- Read and note: textbook §1.2, §2.2–2.6, §3.5, §3.7; James, *The Theory of the Photographic Process* (4th ed.), ch. 17 (densitometry and Callier's Q, Fig. 17.12) and its chapters on development kinetics and image structure (adjacency effects); Hunt, *The Reproduction of Colour* (6th ed.), §§14.13–14.20 (densitometers, specular and diffuse density) and §18.4 (Callier coefficient); Tuttle (1926), Streiffert (1947); Nelson (1971) and Cline (1982) on adjacency.
- Collect datasheets with edition dates: Kodak Tri-X 400 (F-4017), T-MAX 400 (F-4043), T-MAX 100; Ilford HP5 Plus, FP4 Plus, Delta 100/400; Ilford Multigrade IV RC and its successor Multigrade RC Deluxe (Ilford's 2020 comparison sheet lists ISO ranges 160, 130, 110, 90, 70, 60, 50 for filters 00–5 and P 240/220; verify on the sheet itself), Multigrade FB; Ilford *Contrast control*; a Kodak or Foma VC paper for a second opinion.
- Ask the photographer: which films, developers, papers and enlarger head they use; whether B&W is in the first beta.

*Done when* the diary has a source list with editions and page numbers, and the photographer's materials are known.

### 7.2 Stage 2: data

- **Digitise** (with WebPlotDigitizer or similar, recording figure, page, axis calibration and an uncertainty): film spectral sensitivity (convert Ilford's tungsten spectrograms to equal energy by dividing by a 2,850 K blackbody; convert Kodak's erg/cm² curves to relative log sensitivity); curve families and contrast-index curves; paper spectral sensitivities at three densities, curves per filter, ISO R and P tables, the colour-head filtration tables.
- **Measure** (with CHB-013, using the photographer's equipment): Q(d) of the photographer's film by reading a silver step tablet with diffuse light (a camera on a light panel) and with the photographer's condenser enlarger and a baseboard meter, or with a collimated beam; the silver's spectral tone with narrowband LEDs; the photographer's MG filter transmittances with a spectrometer, if they use filters; paper image tone with a spectrophotometer, if available.
- **Write** the B&W stock packs in CHB-004's format through a small tool, `tools/bw-data/`, with provenance on every array.

*Done when* at least one film (the photographer's) and one VC paper (Multigrade IV RC or its successor) exist as packs, each array has provenance, and the digitised curves re-plot over the datasheet figures.

Licensing note for this stage: datasheet figures are the manufacturers' copyright. Digitised measurements are facts about the product and are commonly treated as reusable, but the PDFs themselves must not be redistributed; record the source and let the owner decide how the B&W packs are licensed (they are not derived from spektrafilm, so CC BY-SA does not apply to them).

### 7.3 Stage 3: model (f64, in `@chromobench/core`)

- `film.developSilver` with the development model of Section 5.3, fitted per stock and developer (**speculative form**).
- The Callier model and `print.expose` for `silver-density` with the neutral-silver factorisation and the full spectral path (**speculative Q(d) form until measured**).
- VC paper: component sensitivities, shared curve, fitting procedure, `measure.isoRange` (**speculative until fitted**).
- `invert.silver`.
- One-channel grain, halation, adjacency through CHB-012's ops (**adjacency and halation strengths speculative**).

*Done when* the laws of Section 8 pass, the fitted film reproduces its datasheet family within 0.03 D rms, the fitted paper reproduces Ilford's ISO ranges within 10 R units per filter, and the trace of Section 6 reproduces with the illustrative parameters.

### 7.4 Stage 4: integration

- Contract additions through CHB-002 (Section 9).
- CHB-010: per-component exposure sums, split-grade exposures, a grade test strip.
- CHB-005: one-channel film chain, K-component paper chain, the factorised enlarger path.
- CHB-009: grade control (Multigrade numbering, or Y/M dials for a colour head), head type, split-grade tool.
- CHB-006: disable IR dust detection for silver stocks; rebate as base-plus-fog.
- CHB-008: a playbook "choose a grade": measure the negative's effective density range, call `measure.isoRange` across filtrations, propose a grade or a split.

*Done when* a scanned B&W negative opens, prints on a VC paper on both head types, and the split-grade law holds in the GPU engine within its parity tolerance.

### 7.5 Stage 5: extensions (optional, speculative)

- Toning (`print.tone`) from measured toned wedges.
- Staining developers (pyro): a stain whose blue density grows with silver density acts as a density-dependent yellow filter on VC paper, softening the highlights' contrast. The spectral enlarger path already handles it once the stain spectrum and its growth with density are measured (Gordon Hutchings, *The Book of Pyro*, describes the practice).
- Chromogenic B&W films (Ilford XP2 Super): a dye image with Q ≈ 1, modelled with the colour machinery and one dye.
- Colour negatives printed on B&W paper (the orange mask and the paper's blue-green sensitivity), and panchromatic B&W papers.

## 8. Testing and acceptance

**Laws** (property tests with a seeded generator, as in Chromogen's `laws.js`, textbook §2.8):

- *Flat wedge for silver.* For a neutral silver step of net diffuse density d and a diffuse scanner, every channel reads d above the rebate, for every scanner model; `invert.silver` returns d with zero residual. With a deliberately warm ε_Ag the residual is non-zero, which shows the test can fail.
- *Diffuse limit.* With specularity 0, `print.expose` on `silver-density` equals `print.expose` on the same density treated as a neutral dye, to rounding.
- *Callier monotonicity.* For s₂ > s₁ and Q > 1, every effective density is higher, and the print's ISO-range demand (effective density range) is higher.
- *Dye images are unaffected.* A chromogenic stock (Q = 1) prints identically on all head types.
- *Neutral-silver factorisation.* With flat ε_Ag, the full spectral sum equals the factored form to 10⁻¹²; with a non-flat ε_Ag it does not (the difference is reported, not asserted).
- *Split-grade equivalence.* For uniform masks, exposures (t₁, F₁) + (t₂, F₂) give component exposures equal to one exposure with light t₁·L·F₁ + t₂·L·F₂, to 10⁻¹²; summing log exposures instead (a deliberately broken variant) fails it.
- *Grade order.* ISO range decreases monotonically along Ilford's Kodak-column filtration table from 00 to 5.
- *Time–temperature equivalence* and *development monotonicity* (Section 5.3).
- *Grain mean.* The grain op preserves mean density, and its RMS at 48 µm and D = 1 matches the stock's stated granularity within 5 %.

**Golden numbers** (from the sources; store in `fixtures/golden/bw/`):

| Quantity | Value | Source |
|---|---|---|
| Multigrade IV RC ISO range, filters 00, 0, 1, 2, 3, 4, 5 | 180, 160, 130, 110, 90, 60, 40 | Ilford MG IV RC (2010) p. 2 |
| Multigrade IV RC ISO speed | P 200 (00–3½), 100 (4–5), 500 unfiltered | same |
| Kodak-CC single-filter settings for Multigrade | 199Y, 90Y, 70Y, 50Y, 30Y, 0, 5M, 25M, 50M, 80M, 140M, 199M (00 … 5) | Ilford *Contrast control* (2010) p. 3 |
| Tri-X 400, D-76 small tank, time against temperature | 8, 6¾, 6¼, 5½, 4¾ min at 18, 20, 21, 22, 24 °C | Kodak F-4017 (2002) p. 4 |
| HP5 Plus temperature example | 4 min at 20 °C = 3 at 23 °C = 6 at 16 °C | Ilford HP5 Plus (2010) p. 5 |
| Tri-X diffuse RMS granularity | 17 at D 1.0, 48 µm | Kodak F-4017 p. 10 |
| Condenser vs diffuser | about one grade harder on typical negatives (≈ 20 R units, this guide's reading of the ISO range table); none for XP2 Super | Ilford *Contrast control* p. 4 |
| Callier coefficient | silver up to ≈ 2, dyes ≤ 1.1 | textbook §1.2 |
| Illustrative trace (Section 6) | R 40 (blue), 165 (green); R 110 at blue share 0.106; split 1 s + 0.25 s → R 89; diffusion print (1.70, 0.74, 0.11); condenser same filter (1.96, 0.74, 0.015) | this guide's model |

**Fixtures.** Digitised datasheet curves (with provenance) as fit targets; the synthetic `neutral-wedge` set from CHB-004 extended with a silver variant; edge targets for adjacency once developed and scanned; the photographer's own B&W scans (CHB-013).

**How the tests can fail.** Every law has a broken variant run alongside: log-exposure summing for split-grade, Q applied to dyes, a warm ε_Ag for the flat-wedge law, a development model with the temperature sign flipped. Golden-number tolerances are written down before the first run: ISO range ±10 R units per filter, time–temperature ±0.25 min, grain ±5 %.

## 9. Proposed contract additions (for CHB-002)

1. **Domain semantics.** `silver-density`: one channel, net diffuse visual transmission density of developed silver above base-plus-fog. `film-logH` may have 1 channel. `paper-logH` has one channel per paper component (K ∈ {1, 3}; a two-component paper pads the third with zero weight). `paper-dyes` may have 1 channel (paper silver in units of the paper's unit silver spectrum).
2. **Ops.** `film.developSilver` (`film-logH` → `silver-density`); `invert.silver` (`scanner-density` → `silver-density`); `print.expose` with `domainIn: ['film-dyes', 'silver-density']`; `measure.isoRange` (Value: ISO range and speed for the current paper, lamp and filtration); `print.tone` (extension). `film.couple`, `film.grain`, `film.halation`, `print.develop` and `view.reflect` accept one-channel inputs for B&W stocks.
3. **Recipe.** `capture.development` gains the `BwDevelopment` variant (Section 5.10); `print.enlarger.head?: EnlargerHead`; `scan.geometry?: 'diffuse' | 'collimated'`. For VC papers, `print.grade` is the Multigrade filter number on a numeric scale (00 = −0.5, 0 = 0, ½ = 0.5 … 5 = 5) and maps to filtration through a named table (`print.enlarger.vcTable: 'ilford-kodak-cc-single' | 'ilford-kodak-cc-dual' | 'direct'`); with `'direct'` the filtration is authoritative and grade is derived for display. `Exposure` gains `grade?: number` as a shorthand for its filtration.
4. **Units.** Add `'degC'` to `Unit` for development temperature.
5. **Diagnostics.** `W_SILVER_NOT_NEUTRAL` (with the channel spread), `W_CALLIER_ASSUMED` (stock has no measured Q), `E_DOMAIN_SILVER_AS_DYE` (a silver image fed to an op that only accepts dyes), `W_IR_DUST_SILVER` (IR dust removal requested on a silver negative), `W_DEV_EXTRAPOLATED` (development time or temperature outside the span the stock's development model was fitted on).

## 10. Risks, open questions and decisions

- **Scope (blocks prioritisation, not research):** is B&W in the first beta? Which films, papers and enlarger does the photographer use?
- **Data availability (blocks the model stage):** Multigrade filter transmittances, Q(d) for real films, silver and paper image tone are not published; they need measurement sessions. Without them the model runs on assumptions marked `W_CALLIER_ASSUMED` and flat tones.
- **Model form (speculative):** the development model, the Callier specularity form, the three-component paper fit and the adjacency calibration may all change once data arrives. The laws in Section 8 are written to survive those changes; the golden values for the fitted models are not.
- **ISO 6846 construction.** The ISO-range computation must match the standard's definition to compare with Ilford's values; get the standard text.
- **Datasheet editions.** Films change: the 2002 Tri-X sheet announces new emulsions with slightly different processing times while its image-structure data is for the older film, and T-MAX 400's data sheet changed from F-4016 to F-4043 in 2007 with new processing times. Record editions and prefer current sheets.
- **Licensing of digitised data.** An owner decision (Section 7.2).
- **Reciprocity and intermittency.** The model assumes reciprocity for the paper; split-grade and long exposures may violate it measurably. Film reciprocity failure is published (Kodak: 1 s needs +1 stop and 10 % less development, 10 s +2 stops and 20 % less, 100 s +3 stops and 30 % less; F-4017 p. 2) and belongs to `capture.expose` in CHB-012 if long exposures matter to the photographer.

## 11. References

**Project files**

- `C1/design-doc/01-chromobench-architecture-and-work-plan.md`: §5.1 domains (`silver-density` reserved), §5.4 recipe and `Exposure`, §8 work plan and open decisions.
- `C1/sources/The Mathematics of the Colour Negative.md`: §1.2 (Beer–Lambert, scatter, Callier), §1.3 (channel density), §2.2 (parametric curve), §2.3 (DIR coupling and the edge overshoot), §2.4 (halation), §2.5 (grain, Selwyn, RMS granularity), §2.6 (printing, pre-flash), §2.7 (viewing), §2.8 (composition laws), §3.5 (classes), §3.7 (flat-wedge law), §3.8 (what three channels cannot recover).
- `C1/various/analysis-filmbench-ide.md` §3–4 (no B&W); `C1/various/extracted/filmbench-ide/01-inline.js` lines 137–147 (dichroic CC filtering of the lamp), 2141–2172 (graph with masked exposures and `sum`); `vfs/examples/05-graph.js` lines 8–14 (burn by a second masked exposure); `vfs/controls.js` line 9 (colour "grade" as a curve stretch, not to be reused).
- spektrafilm @ 3bb2c2d: `profiles/io.py` lines 21, 114, 222–227 (`'bw'` channel model, unused), `utils/morph_curves.py` lines 93–131, `model/couplers.py`, `model/grain.py`, `model/color_filters.py`, `model/illuminants.py`, `runtime/params_builder.py` lines 233–252.

**Literature**

- Hunt, R. W. G., *The Reproduction of Colour*, 6th ed., Wiley 2004: §§14.13–14.20 (densitometry, specular and diffuse density), §18.4 (Callier coefficient).
- James, T. H. (ed.), *The Theory of the Photographic Process*, 4th ed., Macmillan 1977: ch. 17 (transmission density, geometric conditions, Callier's Q, Fig. 17.12); the chapters on development kinetics and on image structure, including adjacency effects.
- Callier, A., "Absorption and scatter of light by photographic negatives", *Photographic Journal* 33 (1909).
- Tuttle, C., "The relationship between diffuse and specular density", *JOSA* 12(6), 559–565 (1926).
- Streiffert, J. G., "Callier Q of various motion picture emulsions", *J. SMPE* 49(6), 506–522 (1947).
- Chavel, P. and Lowenthal, S., "Noise and coherence in optical image processing. I. The Callier effect and its influence on image contrast", *JOSA* 68(5), 559–568 (1978).
- Nelson, C. N., "Prediction of densities in fine detail in photographic images", *Photographic Science and Engineering* 15 (1971) (as cited in the adjacency literature; check volume and pages).
- Cline, RIT thesis (1982), repository.rit.edu/theses/6469: small-area densities predicted from optical and chemical spread functions, after Nelson; within 0.02 D on a bar target.
- Niederpruem, C. J., Nelson, C. N. and Yule, J. A. C., "Contrast index", *Photographic Science and Engineering* 10 (1966) (check pages; the construction of the index is defined there).
- Dainty, J. C. and Shaw, R., *Image Science*, Academic Press 1974, ch. 2 (Selwyn's law).
- ISO 6846:1992, black-and-white continuous-tone papers: ISO speed and ISO range; ISO 5 series (density geometry).
- Hutchings, G., *The Book of Pyro* (staining developers).

**Datasheets**

- Kodak, *KODAK PROFESSIONAL TRI-X 320 and 400 Films*, F-4017, September 2002: development tables p. 4, reciprocity p. 2, image structure and spectral sensitivity p. 10, characteristic and contrast-index curves pp. 11–12.
- Ilford/Harman, *HP5 Plus* technical information, June 2010: wedge spectrogram p. 1, development times p. 3, temperature chart and characteristic curve p. 5.
- Ilford/Harman, *Multigrade IV RC* technical information, June 2010: spectral sensitivity p. 1, ISO range and speed, characteristic curves by filter p. 2.
- Ilford/Harman, *Contrast control for ILFORD MULTIGRADE variable contrast papers*, April 2010: the three-emulsion mechanism p. 1, colour-head tables p. 3, diffuser against condenser p. 4.
