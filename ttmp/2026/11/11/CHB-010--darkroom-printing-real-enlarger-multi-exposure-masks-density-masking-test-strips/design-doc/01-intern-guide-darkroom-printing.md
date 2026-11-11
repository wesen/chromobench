---
Title: 'Intern guide: Darkroom printing'
Ticket: CHB-010
Status: active
Topics:
    - darkroom
    - film-emulation
    - color-science
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cv/ops/mask.go
      Note: argument shapes for mask.luminance, mask.ellipse, mask.gradient and feather
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: §2.6 enlarger equation, ∂x/∂v matrices and neutral pack; §2.8 composition laws; §3.6 balance in log exposure
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-chromogen-studio.md
      Note: §2.6–2.8 lights, tone operators and paper exposure; §6.3 bugs to fix while porting
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/05-inline.js
      Note: print.js 792–864, aim and warmth vector 1810–1840, FS_PRINT 1988–2025, params.js 2087–2193, grey pick 4236–4257, ring-around 4329–4347
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/00-film-data.bin.txt
      Note: spektrafilm lamp, dichroic filter curves and neutral packs behind the golden numbers (decode with scripts/06)
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/01-inline.js
      Note: enlargerIlluminant 137–147, mid-grey normalisation 352–381, masked enlarger and linear sum 1627–1652, graph builder 2141–2172
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/vfs/controls.js
      Note: darkroom macros (print stops, CC filtration, grade, warmth, tint) and the darkroom control scheme
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/vfs/examples/05-graph.js
      Note: sky burn as a masked second enlarger exposure summed in linear exposure
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:24.697380819-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Darkroom printing (CHB-010)

## 1. What this ticket is for

Chromobench prints a negative the way a colour darkroom does. CHB-003 builds the physics of that print in f64 (the negative's dye amounts, the enlarger's spectral sum, the paper's curves, the viewing light), and CHB-005 makes it fast on the GPU. CHB-010 adds the part of the darkroom where the photographer actually spends his time: setting the enlarger, balancing colour, dodging and burning, masking, and making test strips. When this ticket is done, the photographer can say "10 seconds at f/8 with 51 M and 52 Y, burn the sky in for another half stop through 10 more yellow, and show me a test strip in third stops", and get the print a real enlarger would have made. The agent can run the same test strip through the DSL and read the densities of each step.

The ticket has six internal stages, which this guide follows:

1. **Real-enlarger mode as the default.** Filters cost exposure, time is in seconds, the lens has f-stops, and the lamp and the dichroic filters are spectra.
2. **Printer lights and balance.** Points, integrate-to-grey, grey pick, warmth, tint, roll consistency, match frame: the balance tools of Chromogen Studio, ported.
3. **Multi-exposure printing.** Dodging, burning, flashing, split filtration and burning through a different filter, all as one sum of exposures in linear light.
4. **Density masking.** Contrast, unsharp and highlight masks as densities added to the negative before the enlarger.
5. **A fast path for filter changes.** Moving a filter dial changes a 33³ table; the preview must not wait for it.
6. **Darkroom procedures.** Test strips, ring-arounds, contact sheets, paper grade, preflash, and a note on paper reciprocity.

What the ticket does **not** do:

- It does not write the print chain itself: `print.expose`, `print.develop`, `view.*` and the tables exist from CHB-003 and CHB-005. CHB-010 extends them.
- It does not build the user interface. CHB-009 owns the panels; CHB-010 supplies the ops. An op is a named operation in the registry, such as `print.expose`; its `ArgSpec`s give each argument's type, unit, hard and usual ranges and a widget hint (architecture §5.2), and CHB-009 generates its controls from them.
- It does not produce stock, lamp or filter data. CHB-004 ships them; this guide says which data it needs.
- It does not own the digital finishing operators (clarity, vibrance, edge-aware tone controls). They are CHB-015. The physical density masks of stage 4 are here.
- Black-and-white paper grades and variable-contrast heads belong to CHB-014.

## 2. The colour darkroom from first principles

### 2.1 What happens in a real darkroom

A colour enlarger is a vertical lamp house over a lens. From top to bottom:

```text
   lamp (halogen, ~3,200–3,400 K, with a heat-absorbing glass)
     │
   dichroic filter head: three dials, cyan, magenta, yellow, in CC units
     │
   mixing box / diffuser  (makes the light even)
     │
   negative in the carrier  (orange-masked colour negative)
     │
   lens with an aperture  (f/5.6, f/8, f/11 …)
     │   the head height sets the magnification
     ▼
   easel with colour paper (RA-4), exposed for t seconds by a timer
```

The paper is a second colour negative material. It has three emulsion layers: a red-sensitive layer that forms cyan dye, a green-sensitive layer that forms magenta and a blue-sensitive layer that forms yellow. More light on a layer makes more dye in it, so **more exposure makes a darker print**, and more exposure in one layer moves the print towards that layer's dye colour. The paper is developed in a fixed process (RA-4) that the printer does not vary, so the only things the printer controls are the light reaching each layer and where on the sheet it lands.

A colour negative carries an orange mask (the residual colour of masking couplers), so it transmits much more red than blue. To bring the three layers into balance, printers dial in a **filter pack**, typically around 40–60 magenta and 50–60 yellow with no cyan. Kodak's datasheet for Ultra Endura paper starts the first test print at **40M + 50Y** (Kodak E-4020, 2008). spektrafilm's database gives **C 0, M 51.57, Y 52.53** for Portra 400 on Portra Endura (textbook §2.6). Both are the same kind of number.

The printer then works in a loop:

1. Make a **test strip**: one sheet exposed in bands for different times, to find the time at which the important tones print well.
2. Make a test print at that time and judge its **colour**. A print that is too magenta is corrected by *adding* magenta filtration (or removing cyan and yellow), because a magenta filter removes green light and so reduces the magenta dye. Kodak's table: a print that is too cyan needs less magenta and yellow, or more cyan; too magenta, less cyan and yellow or more magenta; too yellow, less magenta and cyan or more yellow; and so on.
3. **Compensate the time** for the filter change, because filters remove light. Kodak's rule of thumb for dichroic heads: change the time by about 1 % per unit of magenta (20M more → 20 % more time); yellow changes "do not usually affect the apparent print density".
4. Refine locally: **dodge** (hold back light from an area with a card on a wire for part of the time), **burn** (give an area extra time through a hole in a card), **flash** (a short uniform exposure without the image, to put a trace of tone into highlights).
5. For difficult negatives, **mask**: sandwich the negative with a weak, blurred positive copy of itself on black-and-white film, which reduces large-area contrast while keeping fine detail.

A **ring-around** is a set of prints of one negative, each a fixed filter step away in one colour direction, so a printer can match a test print to the tile that shows the same cast and read off the correction. A **contact sheet** is all frames of a roll printed at one setting, at 1:1, to see which frames are worth printing and how their exposures differ.

### 2.2 The units, in one table

All darkroom controls change the paper's **log exposure** x_k in layer k (k = red, green, blue layer). Log exposure is log₁₀ of the light energy a layer receives. In chromobench every image carries a **domain**, the kind of data it holds (architecture §5.1); paper log exposures live in the domain `paper-logH`. Every darkroom unit is a way of writing a change of x:

| Unit | What it is | Change of x | Example |
|---|---|---|---|
| second (`s`) | exposure time t | Δx = log₁₀(t₂/t₁), all layers | 10 s → 20 s: +0.301 |
| stop (`stop`) | factor 2 of light | 0.30103 per stop | +⅓ stop = +0.100 |
| f-stop (`fstop`) | lens aperture N; light ∝ 1/N² | Δx = −2·log₁₀(N₂/N₁) | f/8 → f/11: −0.277 (nominal numbers; exactly one stop is −0.301, since f/11 is really f/11.31) |
| magnification m | head height; light ∝ 1/(m+1)² | Δx = −2·log₁₀((m₂+1)/(m₁+1)) | 8×10 in → 16×20 in from 35 mm (m 7.06 → 14.1): ×3.51 time, +1.81 stops |
| printer point (`point`) | lab unit | 0.025 per point, per layer | 1 stop ≈ 12 points |
| CC (`CC`) | dichroic filter value; 0.01 D in the filter's blocking band | ideally −0.01 in one layer per CC (−0.4 points) | 10 M ≈ −3.4 points green (real filters, section 3.3) |
| mired (`mired`) | 10⁶/T of a light source | via the warmth vector (section 6.4) | 5,500 K → 3,200 K is +131 mired |

Two rules from Chromogen's `units.js` (`05-inline.js` 142–216, and the architecture document §5.1) govern all of this: a density and a log exposure never add, and a stop is 0.30103 log H. The recipe stores physical quantities (`time_s`, `fstop`, filtration in CC, lights in log H). Points and stops are display units converted at the edges.

### 2.3 The paper's response and the print window

The paper's characteristic curves turn x into paper dye amounts. With spektrafilm's Portra Endura and Portra 400, the grey card (the film exposed at log H = 0) prints with paper dye amounts (0.665, 0.548, 0.499), and the paper's slopes there are 2.36, 1.98 and 1.95 dye units per log H (textbook §2.6; reproduced in the computation of section 3.3 below). The paper is about four times as steep as the negative, which is why a flat-looking negative becomes a print with full contrast.

The **print window** is the range of x over which a layer forms useful density. Chromogen finds it from the first x where the dye exceeds Dmin + 0.04 to the first where it reaches 90 % of Dmax; for Portra Endura's red layer it is about 1.2 log H, or 47 points (Chromogen book ch. 3, `st-data/book/03-ch3.md`). Low x is a bright print area (highlights), high x a dark one (shadows), which is easy to get backwards.

### 2.4 Three facts that shape the whole design

**Printer lights factor out of the spectral sum.** The paper's log exposure is (textbook §2.6)

```text
x_k = log10 Σ_λ L(λ)·F(λ)·10^(−D(λ))·s_k(λ)·Δλ  +  ℓ_k
```

with L the lamp, F the filter pack's transmittance, D the negative's spectral density, s_k the paper layer's sensitivity and ℓ_k the **printer light** of layer k: a per-layer offset of log exposure, equivalent to multiplying the layer's sensitivity by 10^ℓ_k. Because ℓ_k sits outside the sum, x(D, ℓ) = x(D, 0) + ℓ exactly (error 2×10⁻¹⁶ in the check of textbook §2.8). So the expensive spectral part can be tabulated once and every light-like control (time, f-stop, lights, warmth, tint, exposure compensation) applied per pixel for free.

**Filters are not lights.** A CC filter multiplies the light by 10^(−v/100) only inside its blocking band, and the bands overlap the paper's sensitivities imperfectly. A filter change is a shift of x only approximately, and the approximation depends on the negative's density at that pixel. Section 3 measures how good the approximation is; stage 5 is built on it.

A third fact decides how balance is done: **a curve does not commute with a shift** (textbook §2.8). A colour error introduced before the paper's curve must be corrected before the curve, as a log-exposure shift, not by adding density afterwards. Section 6.4 gives the numbers.

## 3. The physics of the enlarger in numbers

### 3.1 The enlarger equation with time, aperture and filters

Real-enlarger mode evaluates

```text
x_k = log10 Σ_λ L(λ)·F_pack(λ)·10^(−D(λ))·s_k(λ)·Δλ
      + log10(t / t_ref) − 2·log10(N / N_ref) − 2·log10((m + 1)/(m_ref + 1))
      + κ + ℓ_k
```

where

- F_pack(λ) = Π_{j∈{C,M,Y}} [1 − (1 − P_j(λ))·(1 − 10^(−v_j/100))], with P_j(λ) the filter's pass fraction (1 outside its blocking band, 0 inside) and v_j its dial value in CC. This is spektrafilm's `DichroicFilters.apply_cc` and Filmbench's `enlargerIlluminant` (`01-inline.js` 137–147).
- t, N and m are the exposure time, f-number and magnification; t_ref, N_ref and m_ref are the calibration's reference values (10 s, f/8, m = 8 is a sensible choice: Kodak's tricolour example in E-4020 is an 8× enlargement of a Portra negative at f/8).
- κ is **one scalar** (the same for all three layers): the virtual lamp's brightness, fixed once so that at the reference time, aperture, magnification and the database's neutral pack, the stock's grey card prints at the aim density. It must not be per-layer: three free offsets would absorb whatever colour the filters produce, which is exactly what normalised mode does.
- ℓ_k are the printer lights (stage 2).

**Normalised mode** is the same equation with κ replaced by a pack-dependent κ(F) chosen so that the grey card's mean x is the same for every pack:

```text
κ(F) = aim_mean − mean_k log10 Σ_λ L·F·10^(−D_grey)·s_k
```

That is spektrafilm's `printing._compute_exposure_factor_midgray`, which divides every paper exposure by the geometric mean of the three exposures the film's mid-grey receives. Filmbench does the same when `enlarger.normalize` is true (its default, `01-inline.js` 355–366). The consequence: in normalised mode a filter leaves the grey card's mean log exposure unchanged, so it acts as a colour control (section 3.3 shows that visual density still moves a little); in real mode filters cost light, as on a real enlarger. One code path covers both modes: `kappa = mode === 'real' ? kappaRef : kappaOf(pack)`.

### 3.2 What a filter does, measured

The textbook computes the derivative of x with respect to the dial values at the neutral pack (textbook §2.6). Without normalisation, per CC unit (rows: red, green, blue layer; columns: C, M, Y filter):

```text
         C        M        Y
R   −0.0092  −0.0007   0.0000
G    0.0000  −0.0087  −0.0016
B    0.0000   0.0000  −0.0100
```

With spektrafilm's normalisation, the columns sum to zero:

```text
         C        M        Y
R   −0.0061   0.0024   0.0038
G    0.0031  −0.0056   0.0023
B    0.0031   0.0031  −0.0061
```

Both matrices were reproduced for this guide from the spektrafilm data embedded in Filmbench (Portra 400, Portra Endura, the TH-KG3 lamp, Filmbench's `dichroic` filter curves, missing spectral data read as opaque): every entry agrees to the fourth decimal, except G/Y, which comes out −0.0015 against the textbook's −0.0016. Treat these as golden numbers for stage 1.

The ideal "0.4 points per CC" is the diagonal of the first matrix rounded (−0.0100 = −0.4 points). The real cyan and magenta filters reach only 92 % and 87 % of it, and magenta leaks a little into red, yellow into green.

### 3.3 What a darkroom worker would see

To connect these numbers to what a printer sees, the whole chain was run at the grey card for this guide (Portra 400 on Portra Endura, D50 viewing light, no viewing flare, κ fixed at the neutral pack). The grey card prints with paper dye amounts (0.665, 0.548, 0.499) and visual density 0.758 (CIELAB under D50: L* 48.8, a* −0.3, b* −4.4); the textbook's 0.755 includes the Studio's 0.48 % flare and a 5,000 K light. Paper white reflects Y = 0.813 (density 0.09). Then, changing one dial by 10 CC:

| Change | Δx at grey (points: R, G, B) | Real mode: ΔD_vis, colour | Normalised mode: ΔD_vis | Time to restore D_vis (real) |
|---|---|---|---|---|
| +10 Y | (−0.02, −0.56, −4.00) | −0.038, b* −17.0 | +0.053 | ×1.039 (+0.06 stop) |
| +10 M | (−0.26, −3.43, −0.00) | −0.111, a* −10.2 | −0.042 | ×1.119 (+0.16 stop) |
| +10 C | (−3.64, 0.00, 0.00) | −0.076, a* +8.9 | −0.007 | ×1.080 (+0.11 stop) |

Three things are worth noticing.

- **The real-mode filter factors match darkroom practice.** Adding 10 M needs about 12 % more time, close to Kodak's "one percent per unit of magenta" for dichroic heads; adding 10 Y needs about 4 %, which a printer would not notice, as Kodak says. Magenta matters most because the green-sensitive layer forms the magenta dye, which dominates the print's visual density. Kodak's factors for acetate CP filters (10Y 1.1, 10M 1.3, 10C 1.2) are larger because they include the filter surfaces.
- **Normalised mode does not hold visual density.** It keeps the *mean of the three log exposures* at the grey, which is not what the eye sees: +10 Y darkens the normalised print by 0.053 because the mean is held by giving the green layer more light. This is one reason the photographer should not live in normalised mode.
- **A single printer light changes density as well as colour.** +10 red points (0.25 log H in one layer) takes the grey from 0.758 to 0.972 and a* to −22.0 (the textbook gives 0.746 → 0.956 and a* −20.7 with flare, textbook §2.7).

These were computed by small Python scripts for this guide; the stage 1 tests must reproduce them with the f64 reference and store them in `fixtures/golden/chb010-enlarger.json`.

## 4. How this ticket fits the system

### 4.1 Where it sits in the pipeline

```text
 film-dyes c (from invert.dyes, CHB-003; or film.develop, CHB-012)
     │
     ▼  per pack p: table c → printing density PD_p   (33³, keyed film × paper × lamp × pack)   [CHB-005, key extended here]
 printing-density
     │  + density masks ΔPD_mask (neutral; stage 4)                         ── print.densityMask
     ▼
     │  per exposure i: H_i = time_i · mask_i(x,y) · 10^(clear_p − PD_p − ΔPD_mask)
     │  + flashes (no negative, through the film base)                       ── print.expose (multi-exposure)
     ▼  H = Σ_i H_i   (linear exposure; one log at the end)
 paper-logH  x = log10 H + κ + aperture + magnification + ℓ (lights)        ── print.lights
     │  crossover pads, grade (gamma about the aim grey)
     ▼
 print.develop (paper curves) → paper-dyes → view.* (CHB-003) → output.* (CHB-011)
```

The negative-side controls (film dyes) are unchanged by this ticket. Everything CHB-010 adds lives between the printing-density tables and the paper curve, which is exactly where the physics puts the enlarger.

### 4.2 Domains, ops and recipe fields

- **Reads:** `film-dyes` (through the PD tables), `printing-density`, masks (`mask` domain), stock data (paper sensitivities and curves), lamp and dichroic filter spectra, the neutral-pack database.
- **Writes:** `printing-density` (density masks), `paper-logH` (exposures, lights, grade, flash), `Value` results (densitometer readings, test-strip tables, balance suggestions) and composite `Image` results for test strips, ring-arounds and contact sheets.
- **Ops it implements** (from the v0 catalog, architecture §5.2): `print.expose`, `print.lights`, `print.preflash`; `mask.*` jointly with CHB-009; `darkroom.testStrip`, `darkroom.ringAround`, `darkroom.contactSheet`. It proposes a few more in section 11.
- **Recipe fields it gives meaning to:** `print.enlarger` (`mode`, `lamp`, `filtration`, `time_s`, `fstop`), `print.lights` (`logH`, `auto`), `print.exposures`, `print.grade`, `print.preflash`.

### 4.3 Dependencies and parallel work

| Ticket | What CHB-010 needs from it | How to proceed before it lands |
|---|---|---|
| CHB-002 | contract types, the catalog stubs, the edit log, the conformance suite | nothing can start before the walking skeleton (M1) |
| CHB-003 | f64 `printExposure`, paper curves, `view`, the `Lights` port's home in `core/print/` | stage 1 can write `enlarger.ts` against CHB-003's spectral core as soon as `spectral/` exists; use the Filmbench data (decoded) for fixtures |
| CHB-004 | lamp spectra (TH-KG3, blackbodies), the three dichroic pass curves, the neutral-pack table, paper sensitivities | interim: decode Filmbench's blob (`scripts/06-decode-filmbench-film-data.py`), which has `illuminant['TH-KG3']`, `dichroic[81,3]` and `neutral_filters[paper][film]` |
| CHB-005 | PD tables, the per-pixel print shader, separable blurs at reduced resolution | stages 1–4 are specified and tested in f64 first; GPU parity follows |
| CHB-009 | tool panels (dials, timer, mask brushes, test-strip and ring-around views) | expose complete `ArgSpec` metadata; the mock engine lets CHB-009 build panels in parallel |
| CHB-008 | playbooks that call `darkroom.testStrip` | the op's result shape (section 6.8) is the interface |
| CHB-013, CHB-014 | consume real mode and the test strip | — |

CHB-010 is on the critical path (002 → 003 → 005 → 010 → 013) and delivers milestone M4, "Darkroom": real enlarger, test strips, dodge, burn and split, and an agent that runs a test strip.

## 5. What exists today and what to take from it

All paths are relative to the CHB-001 ticket directory (`ttmp/2026/11/11/CHB-001--…/`).

### 5.1 Chromogen Studio (`various/extracted/chromogen-studio/05-inline.js`)

| Lines | What | Take |
|---|---|---|
| 799–825 | `Lights`: values in log H, `shift` that throws on a density with a message citing Hunt 14.17, `points()` | port as is to `core/print/lights.ts`, with the contract's `Unit` instead of the local `Quantity` |
| 827–854 | `makePrinter`: `logE`, `clear`, `fromPD`, `view`, `greyPatch` (LM to print a patch at reflectance 0.184) | `logE` and `clear` become the reference's per-pack evaluation; `greyPatch` becomes `aimLights` |
| 855–862 | `latd`: large-area transmission density | port (it is dead code in the Studio; `frameStats` recomputes it) |
| 1810–1840 | `aim`: grey card PD, aim lights, `g` (grey's paper exposure), **warmth vector** (1818–1833: blackbody at 5,500 K ± 20 mired through the film's sensitivities, developed, read as PD, divided by 40, mean removed), the print window | port; make the lamp a parameter (the Studio fixes 3,200 K) |
| 2090–2099 | `colourOffset` (warmth × 1.3 mired per unit, tint along (−⅓, ⅔, −⅓) at 10 points per 100), `autoLights` (integrate-to-grey with α) | port |
| 2100–2157 | `frameParams`: sums auto, roll consistency, match frame, exposure, warmth, tint into `lights.total`; pads, grade, flash | port the lights part; the rest is split between this ticket (pads, grade, flash) and CHB-015 (finishing operators) |
| 2158–2166 | `paperX`: the CPU replica of the per-pixel x chain | becomes the reference's `paperLogH` |
| 2167–2180 | `frameStats`: LATD, mean PD, median Y | port |
| 2013–2021 (in `FS_PRINT`, 1988–2025) | per-pixel x: `clearL − PD`, edge and sky burns (2015–2016), crossover pads (2017–2018), grade (2019), flash (2020) | the burns are replaced by masked exposures (see the list below and section 6.5); the rest is ported to WGSL by CHB-005 with this ticket's semantics |
| 4222–4228 | `lightsToSliders`: a change of lights as exposure, warmth and tint by least squares | port |
| 4236–4257 | `neutralise` (grey pick): Newton on (warmth, tint) until a*, b* of the picked PD are within 0.05, at most 12 iterations | port |
| 4047–4054 | `rollInfo`: roll mean of auto lights; match reference | port the arithmetic; frame selection is CHB-009's library |
| 4329–4347 | `renderRing`: six one-step moves and a ±1, ±2 step density strip; step in points (default 4) | port as `darkroom.ringAround` |

The Studio's book (`st-data/book/02-ch2.md`, `03-ch3.md`, `05-ch5.md`, `09-ch9.md`) explains each control and is good reading before stage 2.

Known problems to fix while porting (from `various/analysis-chromogen-studio.md` §6.3 and this guide's reading):

- The Exposure control's "points" aside (`05-inline.js` 1018) shows −40 points per stop instead of about −12.
- Burns are log-domain: `x += b·m(r)` adds points scaled by the mask value. A real burn adds *light*. At a feathered edge (mask 0.5) a one-stop burn should raise x by log₁₀(1.5) = 0.176, not 0.5 × 0.301 = 0.151; at the grey card the difference is visual density 1.247 against 1.170. Masked exposures (stage 3) fix this.
- The Studio has no filters at all: "Printer lights are pure log-H shifts. There are no dichroic or subtractive filter spectra and no enlarger optics" (report §6.2). Stage 1 adds them.
- The flash is applied after the grade (2019 then 2020). Physically the flash adds light before the paper's curve. Stage 6 moves it into the exposure sum.

### 5.2 Filmbench IDE (`various/extracted/filmbench-ide/01-inline.js` and `vfs/`)

| Where | What | Take |
|---|---|---|
| 137–147 | `enlargerIlluminant`: lamp × Π_j[1 − (1 − F_j)(1 − 10^(−CC_j/100))] | port as `filterTransmittance` |
| 314–320 | `neutralFilters`: the `[paper][film]` database with user shifts on top | port; the database moves to CHB-004 |
| 352–381 | the enlarger table (`lut1`, 25³) and its mid-grey normalisation (`fM`, `comp`, `normalize`; defaults at 118–122) | the normalisation is this guide's normalised mode |
| 2141–2172 | `GraphBuilder`: `enlarger(o).from(neg).through(mask)`, `mask(name, fn)`, `sum(name, …refs)` that type-checks `LogExposure` inputs | the design model for stage 3 |
| 1633–1652 | `_run`: an enlarger node multiplies its linear exposure by the mask; `sum` adds 10^x and takes one log | the arithmetic to port (linear sum, one log) |
| 2756–2763 | `matchScope`: secant iteration on `print_exposure` until the mid-grey patch is at L* 50 | the "hold density" helper for filter changes and ring-arounds |
| `vfs/examples/05-graph.js` | burning the sky: a second enlarger node at `print_exposure` 0.35 through a luminance mask, summed | the representative stage 3 example |
| `vfs/controls.js` 14–46 | macros: print stops (one unit = one stop of light), warmth (−24 Y, +8 C eased), tint (−16 M), paper grade (grade → morph gamma 0.7 … 1.8, +¼ stop per grade above 2 when not normalised) | port the gestures, with real filter factors instead of `op.keep` |
| `vfs/controls.js` 54–72 | the "darkroom" control scheme: print exposure dial, Y/M/C sliders ±40 CC, grade stepper, a dodge-and-burn button that opens a mask editor that does not exist | the UI layout CHB-009 can reproduce |
| `vfs/lib/pushpull.js` | push/pull as a film-side macro (camera EV −n, film gamma +0.12 per stop, "an eyeball figure") | not this ticket (CHB-012); mention only |
| `vfs/examples/13-mosaic.js` | a mosaic over an axis, cells sharing every stage the axis does not touch, `.match('midgray')` | the design model for test strips and contact sheets |

Two Filmbench shortcuts must not be copied. Its masks are functions of *scene* pixels (`case 'mask'` reads the scene), which a negative scan does not have; chromobench masks are defined on the frame (section 6.5). And with `normalize: true` each enlarger node is normalised separately, so a burn through a different filter costs no light: exactly the behaviour real mode exists to remove.

### 5.3 goja-cv (`~/code/wesen/go-go-golems/goja-cv` at `5a93095`)

- `pkg/cv/ops/composite.go` 14–36 (`within`) blends an edit through a mask "in the image's space (img.as("linear") for linear light)". That remark is the multi-exposure rule in general form: masks blend light, not logarithms.
- `pkg/cv/ops/mask.go` 138–260: `mask.luminance` (above/below with a soft ramp), `mask.box`, `mask.ellipse`, `mask.gradient`, and the feather ops. Use their argument shapes for the chromobench `mask.*` ops so that agents see familiar names.
- `pkg/cv/ops/sheet.go` (from line 270): a labelled grid of views. The layout model for contact sheets and test-strip tiles.

### 5.4 spektrafilm (public, `github.com/andreavolpato/spektrafilm`)

`model/color_filters.py` (dichroic filters, `apply_cc`), `model/illuminants.py` (TH-KG3), `runtime/stages/printing.py` (enlarger exposure, mid-grey normalisation, `_compute_raw_preflash`), `runtime/services/filter_enlarger_source.py` (neutral pack plus user shifts), `utils/morph_curves.py` (paper gamma morph about x = 0) and `data/filters/neutral_print_filters.json`. The textbook's §2.6 summarises each. One trap documented there: spektrafilm reads missing spectral data (`NaN`) as **opaque**, Chromogen as transparent; mixing the two conventions costs 0.18 log H in red for Portra 400. Real mode must use spektrafilm's convention, because its neutral packs were computed with it.

## 6. Design

### 6.1 Module layout

```text
packages/core/src/print/            (CHB-003 owns the directory; CHB-010 adds or extends)
  enlarger.ts        filterTransmittance, EnlargerState, paperExposure (real | normalised), kappa calibration
  lights.ts          Lights (port of print.js), points/stops conversions
  balance.ts         aim, autoLights (integrate-to-grey), warmthVector, tint, rollConsistency, matchFrame,
                     greyPick, lightsToSliders, lightsToFiltration
  exposures.ts       Exposure semantics, compileExposures, sumExposures (f64 reference)
  densityMask.ts     contrast / unsharp / highlight masks (f64 reference)
  paperx.ts          crossover pads, grade, preflash, reciprocity hook (the x chain after the sum)
packages/core/src/darkroom/
  testStrip.ts  ringAround.ts  contactSheet.ts   graph builders + numeric readouts
packages/contract/src/catalog/print.ts, darkroom.ts, mask.ts   (op definitions, through CHB-002's change process)
packages/gpu/src/tables/pd.ts            PD table keyed by film × paper × lamp × pack (extends CHB-005)
packages/gpu/src/kernels/print_exposures.wgsl   per-pixel multi-exposure sum and x chain
packages/gpu/src/kernels/density_mask.wgsl      mask exposure, blur hooks, curve
packages/gpu/src/fastpath/filters.ts     Jacobian preview and background rebuild
fixtures/golden/chb010-*.json            golden numbers of this guide
```

### 6.2 The recipe, concretely

A frame printed with a burned sky, a dodged face and a contrast mask (sketch; field names from the contract, additions marked in section 11):

```json
{
  "print": {
    "paper": "kodak_portra_endura",
    "enlarger": { "mode": "real", "lamp": "TH-KG3",
                  "filtration": { "c": 0, "m": 51.6, "y": 52.5 },
                  "time_s": 10, "fstop": 8, "magnification": 8 },
    "lights": { "logH": [0.0, 0.0, 0.0],
                "auto": { "method": "integrate", "alpha": 0.75, "applied": true, "logH": [0.012, -0.008, 0.021] } },
    "exposures": [
      { "id": "sky",  "kind": "burn",  "mask": "m-sky",  "stops": 0.5, "filtration": { "c": 0, "m": 51.6, "y": 62.5 } },
      { "id": "face", "kind": "dodge", "mask": "m-face", "time_s": 2 }
    ],
    "densityMasks": [ { "id": "cm1", "kind": "contrast", "polarity": "positive", "strength": 0.3, "blur_um": 150 } ],
    "grade": 1.0,
    "preflash": 0
  },
  "masks": {
    "m-sky":  { "kind": "gradient", "from": "top", "to": 0.45, "feather": 0.05 },
    "m-face": { "kind": "ellipse", "center": [0.52, 0.38], "radii": [0.08, 0.11], "feather": 0.03 }
  }
}
```

Reading it as a printer would: a 10 s main exposure at f/8 with the neutral pack; the sky gets another half stop (10 × (2^0.5 − 1) = 4.14 s) through 10 more yellow; the face is held back for 2 of the 10 seconds; a 30 % contrast mask is sandwiched with the negative.

### 6.3 Stage 1: the real-mode enlarger

**Data needed per evaluation.** The lamp L(λ), the three pass curves P_C, P_M, P_Y (81 samples each), the pack, the paper sensitivities, the stock's grey card spectral density, and the calibration reference.

**Calibration.** κ is computed once per (film, paper, lamp) from the reference conditions: at t_ref, N_ref, m_ref and the database's neutral pack, the grey card's mean x equals the aim mean x̄_aim (the mean of the grey's paper exposure under CHB-003's aim). The residual colour of the grey at the neutral pack is small: in the computation of section 3.3 the three layers differ from their mean by less than half a point. The aim lights (`greyPatch` in Chromogen) absorb that residual.

```ts
// packages/core/src/print/enlarger.ts (planned, sketch)
import type { Spectrum, Vec3 } from '../spectral';

export interface Filtration { c: number; m: number; y: number }            // CC units
export interface EnlargerOptics { time_s: number; fstop: number; magnification: number }
export interface EnlargerCalibration {
  reference: EnlargerOptics & { pack: Filtration };                       // e.g. 10 s, f/8, m 8, database pack
  kappaRef: number;                                                        // scalar log H offset
}
export interface EnlargerState {                                           // bound per setting
  mode: 'real' | 'normalised';
  pack: Filtration;
  W: [Float64Array, Float64Array, Float64Array];   // L·F_pack·s_k, the printing channels (not normalised)
  clear: Vec3;                                     // log10 Σ W_k: exposure through an empty gate
  kappa: number;                                   // kappaRef (real) or kappaOf(pack) (normalised)
  optics: number;                                  // log10(t/t_ref) − 2 log10(N/N_ref) − 2 log10((m+1)/(m_ref+1))
}

export function filterTransmittance(pass: [Spectrum, Spectrum, Spectrum], f: Filtration): Spectrum;
export function enlargerState(setup: EnlargerSetup, pack: Filtration, optics: EnlargerOptics,
                              mode: 'real' | 'normalised', cal: EnlargerCalibration): EnlargerState;
/** Paper log exposure of one spectral density D through one enlarger state, before lights. */
export function paperExposure(D: Spectrum, e: EnlargerState): Vec3;      // [log10 Σ W_k 10^−D] + kappa + optics
/** ∂x/∂v at a density: 3×3, rows layers, columns C, M, Y (per CC). Central differences of ±0.5 CC. */
export function filterJacobian(D: Spectrum, setup: EnlargerSetup, e: EnlargerState): Mat3;
```

On the GPU nothing new is needed per pixel for a single pack: the PD table (c → PD_k = −log₁₀(Σ W_k 10^(−D) / Σ W_k)) already exists in CHB-005, and x_k = clear_k − PD_k + κ + optics + ℓ_k. What changes is the table's **key**: it must include the lamp and the pack (quantised, for example to 0.1 CC), and `clear` must be computed with the pack.

**Decision record 1: real mode is the default.**

- *Context.* spektrafilm and Filmbench default to normalised printing, Chromogen has no filters. The photographer is a darkroom printer.
- *Alternatives.* (a) Normalised by default, real as an option. (b) Real by default, normalised as "auto" option. (c) Only real.
- *Decision.* (b). Real mode is the darkroom's behaviour; normalised mode stays for comparison and for users who want filters as pure colour controls.
- *Consequences.* Filter moves change density, so every colour tool must offer "hold density" (time compensation, section 6.4). The calibration κ must be stable across releases, or saved recipes would print at a different density; its value is stored in the data pack with a version.
- *Status.* Proposed; confirm with the photographer.

### 6.4 Stage 2: printer lights and balance

**Lights.** A `Lights` value is three log-exposure offsets, shown in points. `shift` accepts `logH`, `point` and `stop` quantities and **refuses a density** with `E_UNIT` and the hint "a density offset is not a log-exposure shift (Hunt 14.17)". All the controls below produce lights; they add in log H (the first law of textbook §2.8), so the engine sums them into one vector before use, as Chromogen's `lights.total` does.

**Why balance belongs in log exposure.** Textbook §3.6 measures it: a grey scale shot under 3,800 K on Portra 400 is corrected at the grey card, once by printer lights (+0.085, +0.002, −0.079 log H) and once by a constant paper-dye density. Against the same scale shot under 5,500 K, the lights leave at most **2.4** CIEDE2000 units anywhere on the scale; the density shift leaves up to **14.6**, and about 14 from one log H above the grey card up to paper white, because it tints the white. A density shift acts on the wrong side of the paper's curve: at the grey card a 0.1 log H light moves the green dye by 0.219, near paper white by 0.021, while a density offset with the same effect at the grey card adds 0.198 everywhere (textbook §2.8).

**The aim.** Every balance tool measures against the **aim**: the stock's own grey card (the film exposed at log H = 0 in every layer), its printing density A, and the aim lights that print it as a neutral of reflectance 0.184 (Chromogen's `greyPatch`, an LM fit). Chromogen's `aim` (`05-inline.js` 1810–1840) computes all of it once per film, paper and pack, together with g, the grey's paper exposure, which anchors the grade and the preflash.

**Integrate-to-grey (auto colour).** Measure the frame's large-area transmission density in the paper's bands, LATD_k = −log₁₀ ⟨10^(−PD_k)⟩ over the frame, compare it with the aim A_k (the PD of the stock's grey card), and set

```text
Δ_k = LATD_k − A_k,   m = mean(Δ),   ℓ_auto,k = ℓ_aim,k + m + α·(Δ_k − m),   α = 0.75 by default
```

The mean m is an exposure error and is corrected fully; the departures are colour and corrected by α. α = 0.75 is a heuristic (Hunt 16.7, after Evans): with no cast, α = 0 is right and full correction gives a foliage frame a chroma of 19.4; with a 4,300 K cast, α ≈ 0.75 suits the six-patch frame and α ≈ 0.25 the foliage frame (textbook §3.6, Figure 3.5). In real mode the PD used for LATD and A is read through the *current* pack's printing channels.

**Warmth.** Chromogen derives the warmth direction from the film: expose the film's grey card to a blackbody at 5,500 K ± 20 mired, develop it, read its PD, take the difference per mired and remove the mean (`05-inline.js` 1818–1833). Warmth w then adds `−(∂PD/∂M)·1.3·w`, so ±100 is ±130 mired. For Portra 400 through the TH-KG3 lamp and the neutral pack, this guide's computation gives a vector of (−0.00124, 0.00000, +0.00124) log H per mired: Warmth +100 is (−6.4, 0.0, +6.5) points, less red light and more blue, so less cyan and more yellow in the print, with green almost untouched. The Studio's book quotes "about 5 points" for its 3,200 K lamp (`st-data/book/02-ch2.md`). Make the lamp a parameter; keep the blackbody locus (a daylight-locus variant can come later with CHB-004's illuminant tables). Filmbench's warmth macro is a filter gesture instead (−24 Y with +8 C eased in, `vfs/controls.js` 19–21): convenient, but its direction is a guess. Keep the physical vector, and show its dial equivalent through `lightsToFiltration`.

**Tint** adds green light against red and blue: Δx = 0.025 × 10 × t/100 × (−⅓, ⅔, −⅓), so ±100 is ±10 points of green, two and a half CC10 steps.

**Grey pick.** The user clicks a pixel that should be neutral. Chromogen's `neutralise` runs Newton on (warmth, tint) with finite differences of 2 units until the picked PD prints with |a*, b*| < 0.05 (CIELAB, D65 after adaptation). Port it; express the result also as lights. In real mode, offer the equivalent filtration (below).

**Roll consistency** blends the frame's auto lights with the roll's mean auto lights: ℓ = (1 − r)·ℓ_auto + r·mean_roll(ℓ_auto). **Match frame** moves the lights by m·(x̄_ref − x̄_this), with x̄ the frame's mean paper exposure (clear − mean PD + ℓ). Both are Chromogen's (`05-inline.js` 2104–2113); the book's chapter 9 explains when match frame fails (two different scenes).

**From lights to the dials.** A printer reads balance as filtration and time. `lightsToFiltration` converts a colour-and-density change of lights into dial changes using the filter Jacobian J (3×3) and the fact that time shifts all layers equally:

```text
solve  Δℓ = J[:, M]·ΔM + J[:, Y]·ΔY + (1,1,1)·Δlog t        (cyan held at its value)
if ΔM or ΔY would make a dial negative, hold that dial at 0 and free cyan instead
```

This follows Kodak's rule that a pack should not contain all three colours (they add neutral density and cost time). The result is exact only to first order; after applying it, re-evaluate and report the residual in points. **Bake** applies it: one edit-log transaction that moves the lights into `print.enlarger` and zeroes them, so a single undo restores the old state. It rebuilds the table, which stage 5 hides.

```ts
// packages/core/src/print/balance.ts (planned, sketch)
export interface Aim { A: Vec3; lights: Vec3; clear: Vec3; g: Vec3; warmPerMired: Vec3; window: [number, number][] }
export function aim(film: Stock, paper: Stock, e: EnlargerState, view: ViewSetup): Aim;
export function autoLights(latd: Vec3, aim: Aim, alpha: number): Vec3;
export function colourOffset(aim: Aim, warmth: number, tint: number): Vec3;          // log H
export function greyPick(pd: Vec3, ctx: BalanceContext): { warmth: number; tint: number; lights: Vec3 };
export function lightsToSliders(dL: Vec3, aim: Aim): { stops: number; warmth: number; tint: number };
export function lightsToFiltration(dL: Vec3, J: Mat3, pack: Filtration, time_s: number):
  { pack: Filtration; time_s: number; residual_pt: Vec3 };
```

**Decision record 2: sign of exposure.** Chromogen's Exposure slider is "+1 = one stop brighter" (less light); Filmbench's print stops are "+1 = one stop of light" (darker). The recipe and the DSL use the darkroom sign: time, stops and lights are amounts of light, so positive means darker. CHB-009 may add a "brightness" control that writes the negated value; it must not be stored separately.

### 6.5 Stage 3: multi-exposure printing

**The physics.** Light from several exposures adds on the paper before the paper responds. If exposure i lasts time_i through pack p_i and reaches pixel (x, y) with weight mask_i(x, y) ∈ [0, 1], the paper layer k receives

```text
H_k(x,y) = Σ_i time_i · mask_i(x,y) · E_k(D(x,y), p_i)          E_k(D, p) = Σ_λ L·F_p·10^(−D)·s_k
x_k(x,y) = log10 H_k(x,y) + κ + optics + ℓ_k
```

The sum is in linear exposure, and the logarithm is taken once, after it. This is the same rule as halation's "convolve only in linear exposure" (textbook §2.4): photons add, logarithms do not.

The darkroom procedures are special cases:

| Procedure | Terms | Note |
|---|---|---|
| main exposure | t_main through the main pack, mask 1 | from `print.enlarger` |
| dodge | subtracts t_d · m_d from the main exposure's time | dodging withholds main light; it cannot change the filter |
| burn | adds t_b · m_b through the main pack | "+½ stop" means t_b = t_main·(2^0.5 − 1) |
| burn through another filter | adds t_b · m_b through pack p_b | a second table (pack p_b) |
| split filtration | two or more full-frame exposures with different packs | see the finding below |
| flash | adds t_f · m_f through the film **base**, no image | uniform, or masked for local flashing |

For `stops` on a burn or dodge, the meaning is the f-stop printer's (total exposure at mask 1 changes by that many stops): a burn of s stops is t_main·(2^s − 1) extra seconds; a dodge of s stops holds back t_main·(1 − 2^(−s)).

**Three findings that the intern should know before implementing.**

1. *Feathered edges differ from log-domain burns.* At mask 0.5, a one-stop burn adds log₁₀(1 + 0.5) = 0.176 log H, not 0.151. Over a feather the difference reaches one point, and at the grey card it is visual density 1.247 against 1.170. The linear sum is the physical one.
2. *Global split filtration on colour paper is almost a single filtration.* If every filter were a pure shift, two full-frame exposures through two packs would be exactly one exposure with per-layer lights log₁₀(Σ_i t_i·10^(s_i)). With real dichroics the difference is small: half the time through the neutral pack and half through 30 M more equals one exposure with lights (−0.32, −4.26, −0.01) points at the grey card, and deviates from it by at most 0.48 points over negatives from −1.5 to +2.0 log H (computed for this guide). Split filtration matters on colour paper as a *local* tool (burning one area through a different pack), and on black-and-white variable-contrast paper, where it changes grade (CHB-014). The UI should say so instead of suggesting a crossover effect that the physics does not give.
3. *A flash must go through the film base.* Through an empty gate with the neutral pack, the paper's three layers receive (−8.6, +1.5, +7.0) points of colour relative to light through the base, because the pack is balanced for the orange mask: an open-gate flash fogs the print orange-red. spektrafilm's `_compute_raw_preflash` flashes through the base; do the same (`through: 'base'`, with `'open'` available and documented).

**Masks.** A mask is a one-channel image in the frame's coordinates (after crop and orientation), with values in [0, 1]. It is a `MaskSpec` in the recipe (`mask.set` mutation), rasterised on demand at the evaluation scale, so preview and export agree. Geometry and feather are fractions of the frame's long side (Chromogen's convention), so the mask does not depend on pixel size. Luminance-based masks select on the negative's **printing density** before any exposure, never on the print, so that a mask cannot depend on itself. A physical dodging tool casts a blurred shadow; the feather stands for that blur. Mask algebra (`and`, `or`, `not`, `feather`) follows goja-cv's mask ops.

**Compiling exposures.** Exposures that share a pack differ only by a scalar weight per pixel, so they collapse into one term:

```text
H_k = E_k(D, p_main) · w_main(x,y)  +  Σ_{p ≠ p_main} E_k(D, p) · w_p(x,y)  +  Σ_f t_f · m_f(x,y) · E_k(D_base, p_f)
w_main = t_main − Σ_dodge t_d·m_d + Σ_{burn through p_main} t_b·m_b
w_p    = Σ_{burn or split through p} t_i·m_i
```

```ts
// packages/core/src/print/exposures.ts (planned, sketch)
export interface CompiledExposures {
  groups: { pack: Filtration; tableKey: TableKey; weight: WeightExpr }[];   // group 0 is the main pack
  flashes: { pack: Filtration; through: 'base' | 'open'; weight: WeightExpr }[];
  diagnostics: Diagnostic[];                    // e.g. W_DODGE_EXCEEDS_MAIN where Σ t_d·m_d > t_main
}
export type WeightExpr = { constant_s: number; terms: { mask: string; seconds: number }[] };  // Σ seconds·mask
export function compileExposures(print: FrameRecipe['print'], masks: Record<string, MaskSpec>): CompiledExposures;
export function sumExposures(D: Spectrum, Dbase: Spectrum, maskValues: Record<string, number>,
                             c: CompiledExposures, setup: EnlargerSetup): Vec3;   // f64 reference: H_k
```

Printer lights multiply the paper's sensitivity (the textbook §2.9 form of the first law), so they apply to the whole sum, flash included. A density mask (stage 4) is sandwiched with the negative, so it applies to every exposure through the negative and not to a flash through the base.

The validation rules: at most four distinct packs per frame (each needs a 575 KB table on the GPU); a dodge cannot carry a filtration (`E_ARG`); where dodges hold back more than the main exposure, the weight is clamped at zero and `W_DODGE_EXCEEDS_MAIN` is returned with the mask names.

**The GPU kernel.** Per pixel, after the dye lookup:

```wgsl
// packages/gpu/src/kernels/print_exposures.wgsl (planned, sketch)
var H = vec3<f32>(0.0);
for (var g = 0u; g < u.groupCount; g++) {
  let pd = lut3(pdTables[g], c);                                 // printing density through pack g
  let E  = exp10(u.clear[g] - pd - dMask);                       // linear exposure per second, with the density mask
  H += E * weight(g, uv);                                        // weight = constant_s + Σ seconds·mask(uv)
}
for (var f = 0u; f < u.flashCount; f++) { H += u.flashE[f] * flashWeight(f, uv); }   // uniform per pack
var x = log10(max(H, vec3(1e-12))) + u.kappa + u.optics + u.lights;
x = crossover(x); x = u.g + u.grade * (x - u.g);                 // pads and grade, as Chromogen's 2017–2019
```

Masks are read from a mask texture array at the evaluation scale. The cost per pixel is one table read per pack group, a few exponentials and one log; with one pack it equals Chromogen's chain.

### 6.6 Stage 4: density masks

A darkroom contrast mask is a weak, unsharp positive made by contact-printing the negative onto black-and-white film through a diffusing spacer, then sandwiched with the negative in register. Silver is close to spectrally neutral, so the mask adds a flat density d_m(x, y) at every wavelength. A flat density factors out of the spectral sum exactly like a light:

```text
PD_k(D + d_m) = PD_k(D) + d_m     for every layer k, exactly, when d_m does not depend on λ
```

So a neutral mask is a per-pixel printer light of −d_m in all three layers, and it lives in the `printing-density` domain. It reduces large-area contrast; fine detail, narrower than the mask's blur, keeps its contrast.

**Making the mask, as the darkroom does.** The mask film is exposed by light through the negative and through the spacer, so its exposure is a blur of the negative's **transmittance** (linear light), not of its density:

```text
T_m(x,y)  = Σ_k w_k · 10^(−PD_k(x,y))                 panchromatic weighting of the three printing densities
H_m       = G_σ * T_m                                 blur in linear light; σ in µm on the film (spacer thickness, diffuser)
d_m       = clamp(γ_m · (log10 H_m − log10 H_ref), 0, d_max)       positive mask: dense where the negative is thin
```

A **contrast mask** has low γ_m (in Chromogen's terms "strength", 0.6 at 100 %: large-area contrast falls to 40 %) and a wide blur. An **unsharp mask** for sharpness has a small blur (a thin spacer) and low γ; its edge overshoot is the point, and the print is then made on a slightly harder grade to restore overall contrast. A **highlight mask** is a high-γ mask with a threshold, so that it records only the negative's densest areas (the print's highlights). Printers use it to keep a contrast mask from flattening the highlights, or to add contrast there; Ctein's *Post Exposure* describes the procedures for colour, and its recipes should be checked before choosing defaults. The op covers all three with `kind`, `strength` (γ_m), `threshold`, `blur_um` and `polarity` (`'positive'` reduces contrast; `'same'` needs a two-step mask in the darkroom and increases it).

**Compared with Chromogen's "Mask".** The Studio's Contrast mask (`FS_PRINT` 1999–2012, report §2.6) works on Y = mean PD with an **edge-aware** base from a self-guided filter (He et al., box means at radii of 4 % and 0.8 % of the long side, ε = 0.05² and 0.03², computed at 640 px) and applies B′ = B_ref + (1 − 0.6·m/100)(B − B_ref). An edge-aware base has no halo; a darkroom mask has one, and printers used it. Both are neutral ΔPD and share the pipeline position. Decision: CHB-010 implements the physical mask (Gaussian blur in linear light, µm on film); the guided-filter version is a finishing operator in CHB-015. Both reuse CHB-005's separable blur at reduced resolution.

```ts
// packages/core/src/print/densityMask.ts (planned, sketch)
export interface DensityMask {
  id: string; kind: 'contrast' | 'unsharp' | 'highlight';
  polarity: 'positive' | 'same';
  strength: number;            // γ_m, fraction (0..1 typical)
  threshold?: number;          // log H of the mask film where density starts (highlight masks)
  dmax: number;                // the mask film's maximum density
  blur_um: number;             // Gaussian σ on the film
  enabled: boolean;
}
export function maskDensity(pd: ImageF64 /* printing-density */, m: DensityMask, umPerPx: number): ImageF64;
```

Binding time: the mask depends on the negative and its own settings, not on the print settings, so it is computed in the low-resolution global pass (like Chromogen's bases) and upsampled; changing time, filters or lights does not recompute it.

### 6.7 Stage 5: the fast path for filter changes

**The problem.** A dial move changes F_pack(λ), which changes the PD table (33³ nodes × 81 wavelengths × 3 layers). On a discrete GPU the rebuild is one dispatch and may take only milliseconds; on the CPU fallback, in the f64 reference, or with several packs in use, it does not fit between two input events. The preview must respond at once.

**The idea.** Near the current pack, a filter change is almost a light: Δx ≈ J·Δv, with J the 3×3 filter Jacobian of section 3.2. So the preview applies J·Δv as an extra uniform light on the *old* table, and the exact table for the new pack is rebuilt in the background. When it is ready, the renderer swaps tables and drops the equivalent light, in the same frame.

How good is the preview? For this guide, the exact x was compared with the old pack plus J·Δv over 56 negatives (eight points on the neutral axis from −1.5 to +2.0 log H, each also with one layer at a time offset by ±0.4 log H), Portra 400 on Portra Endura; the table gives the largest error:

| Dial change | J at the grey card | diagonal "0.4 points per CC" | normalised J used in real mode (a bug) |
|---|---|---|---|
| +10 M | 0.37 points | 0.87 points | 1.63 points |
| +10 Y | 0.24 points | 0.84 points | 1.77 points |
| +20 M +20 Y | 0.62 points | 1.24 points | 6.23 points |

A point is at the edge of visibility on a grey card, so the preview with J is good for drags up to about 20 CC. Larger moves rebuild before they finish. The other two rows are the variants the parity test must reject.

```text
user drags M from 51.6 to 61.6
  │
  ├─ every input event: Δv = (0, 10, 0); ℓ_preview = J(pack0)·Δv   → uniform update, frame rendered on table(pack0)
  ├─ debounce 120 ms after the last event (or immediately on release):
  │     key1 = tableKey(film, paper, lamp, quantise(pack1))
  │     engine.prepare([key1])  (worker or GPU; cancellable; stale results dropped by key)
  └─ when key1 is ready and pack1 is still current:
        swap table(pack0) → table(pack1); pack0 := pack1; ℓ_preview := 0   (same frame)
```

Rules: J is cached per (film, paper, lamp, pack) and computed at the aim grey with central differences of ±0.5 CC; in normalised mode use the normalised J; the preview light never enters the recipe (it is engine state); exports always wait for exact tables (`precision: 'export'`); and the engine reports `preview: true` in its result while a swap is pending, so the agent's numbers are labelled as approximate.

**Decision record 3: preview through equivalent lights.** Alternatives were (a) block until the rebuild, (b) a lower-resolution table during the drag, (c) per-pixel spectral evaluation at reduced scale, (d) the Jacobian preview. (a) stutters on the CPU path; (b) and (c) cost more than the per-pixel uniform and still lag. (d) costs nothing per pixel and its error is measured above. Decided (d), with the background rebuild; status proposed.

### 6.8 Stage 6: darkroom procedures

**Test strips.** `darkroom.testStrip` builds a graph of N variants of the current print and composes them:

```ts
// packages/contract/src/catalog/darkroom.ts (planned, sketch of the ArgSpec)
'darkroom.testStrip': {
  over:   { type: 'enum', values: ['seconds', 'stops', 'filter'], default: 'stops' },
  base:   { type: 'number', doc: 'seconds (over=seconds|stops) or CC (over=filter)' },
  step:   { type: 'number', doc: 'seconds, stops (e.g. 1/3) or CC per band' },
  count:  { type: 'number', min: 2, max: 12, default: 7 },
  filter: { type: 'enum', values: ['c', 'm', 'y'], doc: 'over=filter only' },
  holdDensity: { type: 'bool', default: true, doc: 'over=filter: compensate time to keep the aim grey' },
  layout: { type: 'enum', values: ['bands', 'tiles'], default: 'bands' },
  region: { type: 'box', doc: 'tiles: the same crop in every tile' },
  read:   { type: 'point', doc: 'densitometer points reported for each step' },
}
// returns { image (Look), table: [{ step, time_s, stops, filtration, Dvis[], lab[], x[] }] }
```

`bands` is the darkroom strip: one sheet, the frame cut into vertical bands, each band printed at its own time and labelled. `tiles` shows the same crop at every step, which a darkroom cannot do but which is easier to judge. Every step is a node that differs from the current print only in a uniform (time or lights), so the steps share all tables; a filter strip needs one table per step, or Jacobian previews (stage 5) with exact tables built while the user looks.

Numbers a printer would recognise (computed for this guide, real mode, Portra 400 on Portra Endura, base 10 s at f/8; visual densities of the 90 % white, the 18 % grey card and the 3 % black of the scene):

| Time | Stops | White | Grey | Black |
|---|---|---|---|---|
| 5.0 s | −1 | 0.10 | 0.27 | 1.22 |
| 6.3 s | −⅔ | 0.11 | 0.38 | 1.52 |
| 7.9 s | −⅓ | 0.13 | 0.55 | 1.79 |
| 10.0 s | 0 | 0.18 | 0.76 | 2.00 |
| 12.6 s | +⅓ | 0.26 | 1.02 | 2.15 |
| 15.9 s | +⅔ | 0.37 | 1.32 | 2.26 |
| 20.0 s | +1 | 0.53 | 1.62 | 2.34 |

A third of a stop moves the grey card by 0.2–0.3 D: an obvious step on the strip, which is why printers fine-tune in sixths. An equal-increment strip of 4, 8, 12, 16 and 20 s (the classic "5-second strip" pattern) gives steps of −1.58, −0.58, 0, +0.42 and +0.74 stops from 12 s, and grey densities 0.15, 0.42, 0.76, 1.09 and 1.39: large steps at the light end and small ones at the dark end, the well-known weakness that f-stop timing fixes. Store both tables as golden numbers.

**Ring-arounds.** `darkroom.ringAround({ step_pt | step_cc, hold: 'density' })` renders the current print and six moves (towards R, G, B, C, M, Y) plus a density strip (±1, ±2 steps). In lights, Chromogen's move for "+R (−C)" is (−1, ½, ½)·step in log H, the vector (0, 1, 1) with its mean removed and scaled by 1.5 (`05-inline.js` 4329–4347); its steps of 2, 4 and 8 points correspond to CC05, CC10 and CC20. In real mode, offer filter moves instead: each tile is the current pack ±step in one filter (two filters for the secondaries), with the time compensated to hold the aim grey's visual density (Filmbench's `matchScope` secant, `01-inline.js` 2756–2763), labelled in darkroom words ("add 10 M, 11.2 s"). Choosing a tile writes the corresponding mutation.

**Contact sheets.** `darkroom.contactSheet({ frames, setting: 'single' | 'balanced' })` prints every frame of a roll at 1:1 with **one** time and pack (`single`), so exposure differences between frames show, as on a real contact sheet. `balanced` applies each frame's own auto lights. Layout follows goja-cv's `sheet`.

**Paper grade.** Colour papers come in fixed contrasts, not grades, so `print.grade` is a plausible-but-not-real control, as Chromogen's book says of its Contrast slider. Define it as a gamma factor g about the aim grey's paper exposure: x′ = x_aim + g·(x − x_aim), applied per pixel after the exposure sum. This equals spektrafilm's `apply_print_curves_morph` (c_p(x) → c_p(g·x) about x = 0) whenever its σ ≥ 0.05 floor does not bind, and Chromogen's `x = g + γ(x − g)`. Range 0.6–1.6, default 1. At g = 0.7 the computed white/grey/black are 0.28/0.76/1.69; at g = 1.45 they are 0.11/0.76/2.27. Filmbench's macro also adds a quarter stop per grade above 2 in real mode ("harder paper needs a little more light"); here grade pivots about the aim, so no compensation is needed. Real multigrade grades are CHB-014.

**Preflash.** `print.preflash` keeps Chromogen's scale (a flash of 0.35·p/100 of the exposure 0.6 log H below the aim grey, `05-inline.js` 2119) but is compiled into a flash exposure through the base, added to H **before** the grade. The flash lifts the paper's toe and leaves midtones and shadows almost unchanged.

**Paper reciprocity.** Kodak describes Ultra Endura as having an exposure range of 50 ns to 10 min with "unique high-intensity reciprocity characteristics" (E-4020), and spektrafilm does not model reciprocity. Default: none (x depends on time only through log₁₀ t). Provide a hook for a per-layer Schwarzschild exponent p_k (H ∝ I·t^p_k, so Δx_k = p_k·log₁₀(t₂/t₁)), off unless a paper's data pack supplies it. With p ≠ 1, exposures no longer add linearly and the stage 3 law is broken, so the engine must refuse to combine a reciprocity model with masked exposures until someone models intermittency. This is speculative and low priority; record it, do not build it first.

## 7. One flow traced end to end

The photographer opens a Portra 400 frame, printed on Portra Endura in real mode. The values below are from this guide's computations at the grey card; the intern's tests reproduce them.

1. **Initial state.** Pack C 0, M 51.57, Y 52.53 (database), 10 s, f/8, m 8. The f64 reference computes x at the grey card with κ = κ_ref: the three layers sit within ±0.35 points of the aim mean. The aim lights absorb the residual; the grey prints at visual density 0.758, a* −0.3, b* −4.4 (no flare).
2. **Auto balance.** The frame's LATD gives Δ; with α = 0.75 the engine writes `print.lights.auto.logH` (the colour part at 75 %, the density part in full). The UI shows, beside the lights, their darkroom equivalent from `lightsToFiltration`.
3. **The photographer finds the print too magenta** and adds 10 M on the dial. Mutation: `{ op: 'set', path: 'print.enlarger.filtration.m', value: 61.57, by: 'user' }`.
   - *Preview, same frame:* Δv = (0, 10, 0); ℓ_preview = J·Δv = (−0.0070, −0.0870, −0.0000) log H from the textbook's J (the exact change is (−0.0066, −0.0858, −0.0001)). Error at the grey 0.05 points; worst over the test negatives 0.37 points.
   - *Background:* `engine.prepare([pdKey(…, m: 61.6)])`, a new 33³ table; on arrival the renderer swaps and drops ℓ_preview.
   - *Result:* the grey's visual density falls from 0.758 to 0.647 and a* moves by −10.2 (greener). The print is lighter, as on a real enlarger.
4. **Hold density.** The UI offers "compensate time": the reference's secant search finds ×1.119, so 10 s becomes 11.2 s (Kodak's rule of thumb: ×1.10). Mutation: `set print.enlarger.time_s 11.19`. The grey is back at 0.758 with the new colour.
5. **Burn the sky** half a stop through 10 more yellow: `exposure.add { id: 'sky', kind: 'burn', mask: 'm-sky', stops: 0.5, filtration: { c: 0, m: 61.57, y: 62.53 } }`. The compiler makes a second pack group with weight 11.19·(2^0.5 − 1)·m_sky = 4.64·m_sky seconds. At a sky pixel with mask 1, H_k = 11.19·E_k(D, p_main) + 4.64·E_k(D, p_sky): the extra light carries less blue than the main exposure, so the blue-sensitive layer forms less extra yellow dye and the burned sky comes out darker and bluer than a plain burn would make it. At the gradient's midpoint (mask 0.5), the extra light is half, added in linear exposure.
6. **Read the result.** The agent calls `measure.densitometer` at the sky and the grey card; the result carries visual density, CIELAB and x per layer, with `preview: false` once all tables are exact.

## 8. Implementation plan

Each stage ends with its tests passing in the reference engine; GPU parity follows in the same stage when CHB-005's kernels exist.

1. **Real-mode enlarger.**
   - Build `enlarger.ts`: `filterTransmittance`, `EnlargerState`, `paperExposure`, κ calibration, normalised mode, `filterJacobian`.
   - Extend the PD table key with lamp and pack in `packages/gpu/src/tables/pd.ts`; compute `clear` per pack.
   - Op metadata for `print.expose` arguments `mode`, `lamp`, `filtration`, `time_s`, `fstop`, `magnification`.
   - Done when: the two ∂x/∂v matrices and the filter table of section 3.3 reproduce within 0.0002 log H and 0.003 D; real and normalised modes differ only in κ; switching mode changes no stored value.
2. **Lights and balance.**
   - Port `Lights`, `aim` (with the lamp as a parameter), `autoLights`, `colourOffset`, roll consistency, match frame, `lightsToSliders`, `neutralise`; add `lightsToFiltration` and Bake.
   - Done when: the textbook's §3.6 balance experiment reproduces (≤ 2.4 ΔE₀₀ with lights, up to 14.6 with a density shift; the grey scale exposed through the film's sensitivities to blackbodies at 3,800 and 5,500 K, without DIR, as `m09_balance.js` did, so it does not wait for CHB-012); `Lights.shift` with a density fails with `E_UNIT`; grey pick converges to |a*, b*| < 0.05 on the grey card in ≤ 12 iterations; Bake leaves a residual under 0.5 points at the grey.
3. **Multi-exposure.**
   - Define `Exposure` semantics, `compileExposures`, `sumExposures` (f64), the WGSL kernel, mask rasterisation at the evaluation scale, diagnostics.
   - Replace Chromogen's edge and sky burns by presets that create masked burns.
   - Done when: the linearity laws of section 9.1 pass; the Filmbench `05-graph.js` sky burn is reproducible as a recipe; dodge-exceeds-main is diagnosed.
4. **Density masks.**
   - `densityMask.ts` and `density_mask.wgsl`; global-pass scheduling; mask kinds and parameters.
   - Done when: a uniform frame is unchanged by any mask (up to the constant set by H_ref); a neutral mask equals the same ΔPD applied as lights to 10⁻¹² in the reference; the blur is in linear light (Jensen check, section 9.1).
5. **Filter fast path.**
   - `fastpath/filters.ts`: J cache, preview light, debounced cancellable rebuild, swap protocol, `preview` flag in results.
   - Done when: the parity table of section 6.7 holds (≤ 0.4 points for 10 CC, ≤ 0.7 points for 20+20 CC) and the two broken variants fail; no frame shows a jump larger than the preview error at swap.
6. **Darkroom procedures.**
   - `darkroom.testStrip`, `darkroom.ringAround`, `darkroom.contactSheet`, `print.grade`, `print.preflash` (as a flash exposure), the reciprocity hook (off).
   - Done when: the test-strip tables of section 6.8 reproduce; ring-around tiles hold the aim grey's density within 0.01 D; the agent can run a test strip through the DSL and get the table in its YAML result.

## 9. Testing and acceptance

### 9.1 Laws (property tests, seeded, with shrinking)

| Law | Statement | Tolerance | How it can fail |
|---|---|---|---|
| lights factor out | for any D and ℓ: x(D, ℓ) = x(D, 0) + ℓ; equal to scaling each paper sensitivity by 10^ℓ_k | 10⁻¹² (f64) | applying lights inside the sum with a filter, or after the paper curve |
| lights refuse densities | `Lights.shift` with a `D` quantity throws `E_UNIT` | exact | a refactor that accepts plain numbers without units |
| a curve does not commute with a shift | the green paper dye change for +0.1 log H near paper white is less than a fifth of the change at the grey card (0.021 against 0.219 in the textbook) | the ratio | a linearised paper model, or lights applied as density |
| same-pack exposures merge | exposures through one pack equal one exposure of the summed seconds per pixel | 10⁻¹² | summing logs instead of exposures |
| linear sum | H(Σ) = Σ H_i, one log at the end; two equal exposures raise x by exactly 0.30103 | 10⁻¹² | log-domain burns (a mask of 0.5 with a one-stop burn must give +0.17609, not +0.15051) |
| dodge and burn cancel | dodging a region by t and burning it by t through the same pack returns the original print | 10⁻¹² | a dodge that changes the filter, or clamping applied before summing |
| flash through base | an unmasked flash adds the same H to every pixel, with the colour of light through the base, not the open gate | 10⁻¹² | flashing with D = 0 |
| neutral mask is a light | a flat density d added to D(λ) equals −d added to every x_k | 10⁻¹² | a mask applied to one layer, or to transmittance after the log |
| mask blur in linear light | for the mask's exposure, log₁₀(G*T) ≥ G*log₁₀T pointwise | exact inequality | blurring density |
| real vs normalised | the two modes differ by a scalar per pack (κ); columns of the normalised J sum to zero | 10⁻¹² | per-layer κ (which would make filters irrelevant) |

### 9.2 Golden numbers (`fixtures/golden/chb010-*.json`)

- ∂x/∂v without and with normalisation (section 3.2), 4 decimals.
- Filter changes at the grey card: Δx in points, ΔD_vis and colour in both modes, time factors ×1.039, ×1.119, ×1.080 (section 3.3).
- The neutral pack C 0, M 51.57, Y 52.53 for Portra 400 on Portra Endura (from CHB-004's data, with its version).
- Grey card: paper dyes (0.665, 0.548, 0.499), slopes (2.36, 1.98, 1.95), visual density 0.758 without flare (0.755 in the textbook with the Studio's flare and a 5,000 K light).
- +10 red points: visual density 0.972, a* −22.0 without flare.
- Warmth vector (−0.00124, 0.00000, +0.00124) log H per mired with TH-KG3 and the neutral pack.
- Test strips (section 6.8), grade table, the feathered-burn shift 0.17609.
- Split filtration: equivalent lights (−0.32, −4.26, −0.01) points, deviation ≤ 0.48 points.
- Balance experiment of textbook §3.6: 2.4 and 14.6 ΔE₀₀.

The golden numbers of section 3 and section 6 were computed for this guide by independent Python scripts on the Filmbench data. If the f64 reference disagrees by more than the stated tolerance, find out which side is wrong before changing the fixture; record the finding in the diary.

### 9.3 Parity tests (GPU against reference)

- Single pack: GPU x within 2×10⁻⁴ log H of the reference over the PD table's domain (f32 and trilinear interpolation; CHB-005 sets the final bound).
- Multi-exposure with two packs and three masks on a synthetic frame: per-pixel x within the same bound; feathered edges included.
- Fast path: the table in section 6.7, with the diagonal model and the normalised-J-in-real-mode model as broken variants that must fail a 1-point bound for 20+20 CC.

### 9.4 Fixtures

- The decoded spektrafilm data (via CHB-004, or Filmbench's blob until then).
- Synthetic frames from `fixtures/synthetic/`: a grey ramp (−2.5 … +3.0 log H), a frame with a bright sky gradient and a dark foreground (for burns and masks), the six-patch running frame.
- The Gold 200 sample (`sources/chromogen-studio-1.2/samples/gold200.png`) for an end-to-end real-mode print.

## 10. Risks, open questions and decisions

| Item | Why it matters | Blocks? |
|---|---|---|
| Calibration reference (10 s, f/8, m 8) | sets the times the photographer sees; changing it later changes old recipes | blocks stage 1 release; decide with the photographer |
| Does the photographer's enlarger use CC units? Durst and some heads use their own dial scales | real mode should speak his dial's language | no; a dial-scale mapping can be added later |
| Auto balance in real mode: lights, or written into the dials? | darkroom purists expect the dials to carry the balance | no; this guide proposes lights plus Bake |
| Dichroic pass curves are spektrafilm's idealised error-function edges (`custom`), not a measured head | filter factors could differ from his enlarger by a few percent | no; CHB-013 can measure a head with a test strip in each filter |
| Grade has no physical counterpart on colour paper | users may expect B&W grades | no; label it as contrast (gamma) |
| Reciprocity data does not exist | the hook stays off | no |
| Masks as spectrally flat silver | real silver masks are slightly non-neutral | no |
| Four-pack limit | GPU memory and per-pixel cost | no; raise it if a real workflow needs more |

## 11. Proposed contract additions (for CHB-002)

1. `print.enlarger.magnification: number` (default = the calibration's m_ref), and a versioned `calibration` reference in the data pack (`{ time_s, fstop, magnification, pack, kappa }`).
2. `print.lights.auto: AutoBalance` defined as `{ method: 'none' | 'integrate' | 'roll' | 'match' | 'learned'; alpha?: number; rollConsistency?: number; matchFrame?: string; matchAmount?: number; applied: boolean; logH: [number, number, number] }`. `learned` is reserved for CHB-015.
3. `print.lights.warmth: number`, `print.lights.tint: number` (the slider values, so that the lights stay explainable through `why(path)`), and `print.crossover?: { shadow: [number, number]; highlight: [number, number] }` (Chromogen's pads).
4. `Exposure` semantics: the main exposure comes from `print.enlarger` and is **not** stored in `exposures` (`kind: 'main'` is reserved); `stops` is relative to the main time (burn: t_main(2^s − 1), dodge: t_main(1 − 2^−s)); `filtration` is an absolute pack, forbidden on `dodge`; add `through?: 'base' | 'open'` for `flash`.
5. `FrameRecipe.masks: Record<string, MaskSpec>` at the top level (the target of the existing `mask.set` mutation), with `MaskSpec` a union of `ellipse`, `gradient`, `box`, `luminance` (on the negative's printing density), `paint` (strokes in frame coordinates) and the algebra `and`/`or`/`not`/`feather`; geometry and feather as fractions of the long side.
6. `print.densityMasks: DensityMask[]` and the op `print.densityMask` (`printing-density` → `printing-density`, class `spatial`, binding `scan`).
7. Ops `darkroom.lightsToFiltration` (Value), `darkroom.bake` (mutations), and the `darkroom.testStrip` arguments of section 6.8.
8. A `preview: boolean` field on `ImageResult` and `Measurement`, true while an engine shows an approximate (Jacobian) state.
9. Diagnostic codes `W_DODGE_EXCEEDS_MAIN`, `W_PREVIEW_APPROX`, `E_TOO_MANY_PACKS`.
10. A note for the vocabulary table: its example mutation `print.lights` with `[0, 4, −2]` is in points, while the recipe stores log H; the DSL converts with `units` (`'point'`).

## 12. References

**Project files** (paths relative to the CHB-001 ticket directory):

- `design-doc/01-chromobench-architecture-and-work-plan.md`: contracts, vocabulary, ticket map.
- `sources/The Mathematics of the Colour Negative.md`: §2.6 printing (lines 530–554), §2.7 viewing, §2.8 composition laws (588–604), §3.6 grey balance (917–947), §4.1–4.2 binding time and tables.
- `various/extracted/chromogen-studio/05-inline.js`: `print.js` 792–864, `aim` 1810–1840, `FS_PRINT` 1988–2025, `params.js` 2087–2193, ring-around 4329–4347, grey pick 4236–4257.
- `various/extracted/chromogen-studio/st-data/book/02-ch2.md`, `03-ch3.md`, `05-ch5.md`, `09-ch9.md`.
- `various/analysis-chromogen-studio.md` §2.6–2.8, §6.
- `various/extracted/filmbench-ide/01-inline.js` 118–122, 137–147, 314–320, 352–381, 1627–1652, 2141–2172, 2756–2763; `vfs/controls.js`; `vfs/examples/05-graph.js`, `13-mosaic.js`.
- `various/analysis-filmbench-ide.md`; `various/extracted/filmbench-ide/film-data-summary.json`; `scripts/06-decode-filmbench-film-data.py`.
- goja-cv `pkg/cv/ops/composite.go`, `mask.go`, `sheet.go`.

**External:**

- Kodak, *KODAK PROFESSIONAL ULTRA ENDURA Paper*, Technical data E-4020, September 2008: starting pack 40M + 50Y, filter factors for CP filters, the dichroic rule of thumb, colour-correction table, exposure range 50 ns to 10 min.
- R. W. G. Hunt, *The Reproduction of Colour*, 6th ed.: 14.17 (balance in log exposure), 16.7 (integrating to grey).
- spektrafilm: `model/color_filters.py`, `model/illuminants.py`, `runtime/stages/printing.py`, `runtime/services/filter_enlarger_source.py`, `utils/morph_curves.py`, `data/filters/neutral_print_filters.json`.
- Ctein, *Post Exposure: Advanced Techniques for the Photographic Printer* (2nd ed.): contrast, unsharp and highlight masks in colour printing.
- K. He, J. Sun, X. Tang, "Guided image filtering", ECCV 2010 (Chromogen's edge-aware base, for comparison).
