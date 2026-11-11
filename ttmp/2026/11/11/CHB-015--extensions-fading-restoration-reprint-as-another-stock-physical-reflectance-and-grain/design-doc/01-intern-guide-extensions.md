---
Title: 'Intern guide: Extensions'
Ticket: CHB-015
Status: active
Topics:
    - film-emulation
    - color-science
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/design-doc/01-chromobench-architecture-and-work-plan.md
      Note: catalog row that puts finishing on display-rgb, which this guide proposes to move before the knee
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: §2.3 DIR model and Jacobian (E2), §2.5 grain (E4), §2.7 Saunderson and the gamut knee (E3, E5), §3.8 limits of three channels
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-chromogen-studio.md
      Note: §2.4–2.10 operator formulas and constants; §6.1 not-built list (restoration, learned estimator); §6.2–6.3 approximations and bugs
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/05-inline.js
      Note: reshootMap 1761, fade 1762–1787, FS_DYES/FS_PD/FS_PRINT/FS_OUT 1918–2076 (finishing operators), global pass 3022–3069
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/book/05-ch5.md
      Note: Re-shoot on and Fade with their stated approximations
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/book/06-ch6.md
      Note: the guided-filter base and the tone operators explained
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/00-film-data.bin.txt
      Note: spektrafilm stock data behind the fading example and the DIR slope bounds (decode with scripts/06)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:26.448128836-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Extensions (CHB-015)

## 1. What this ticket is for

The core tickets give chromobench a correct colour darkroom: a negative scan is inverted to dye amounts (CHB-003), printed through a real enlarger (CHB-010) and written out with colour management (CHB-011); a RAW photo can be "shot" on a stock (CHB-012). CHB-015 collects six extensions that go beyond that core. Each is a small research-and-build project of its own, and none is on the critical path; together they make milestone M7 with black and white (CHB-014).

| | Extension | What the photographer gets |
|---|---|---|
| E1 | Faded-negative restoration in dye space | old negatives whose dyes have faded print with their original colour and contrast |
| E2 | Reprinting as another stock | "what would this frame look like on Ektar 100?", with the film's interlayer effects inverted properly |
| E3 | Saunderson double-pass reflectance | a physical paper mode in which thin dye layers and paper surfaces behave like real prints |
| E4 | Newson Boolean-model grain | grain defined on the film, identical at every output size, for large prints |
| E5 | Digital finishing operators | Chromogen's clarity, texture, vibrance, hue shifts and friends, placed where they do no harm |
| E6 | A learned light estimator | a first balance that learns from the photographer's own corrections |

For each, this guide explains the physics or the method from first principles, says where it sits in the pipeline, and assesses feasibility, data and a plan. Parts that are speculative (no data to check them, or an untested modelling choice) are marked **Speculative**. A recommended order is in section 9.

What the ticket does not do: it does not change the core contracts on its own (proposals go to CHB-002, section 12), it does not ship stock data (CHB-004 does; this guide says what each extension needs), and it does not own the forward film model (CHB-012) that E2 and E4 reuse.

## 2. Background shared by all six

### 2.1 Where each extension sits

The architecture's forward and inverse chains meet at the negative's dye amounts. The extensions attach at different points:

```text
 scan ─► invert.dyes (CHB-003) ─► film-dyes c
                                   │
                                   ├─ E1 invert.unfade: c ← c / k  (per-dye scale)            [film-dyes → film-dyes]
                                   ├─ E2 invert.exposures (stock A, with DIR) ─► film-logH u
                                   │      └─► film.couple + film.develop (stock B, CHB-012) ─► film-dyes c_B
                                   ├─ E5 finishing.dyeSat, finishing.grainReduction           [film-dyes]
                                   ├─ E4 film.grain (Boolean model; forward path and re-grain) [film-dyes]
                                   ▼
                       printing-density PD ─ E5 finishing.tone (guided-filter base: mask, highlights,
                                   │                             shadows, clarity, texture)
                                   ▼
                       print (CHB-010): exposures, lights ◄─ E6 lights.auto 'learned'
                                   ▼
                       paper-dyes ─► view.reflect ◄─ E3 'saunderson' (rebuilds the c_p → XYZ table)
                                   ▼
                       print-xyz ─ E5 finishing.sharpen, finishing.bloom, finishing.colour (OKLab)
                                   ▼
                       output.display: adaptation, gamut knee (LAST), encoding (CHB-003, CHB-011)
```

### 2.2 Three rules that decide the designs

These come from the textbook (*The Mathematics of the Colour Negative*, in the CHB-001 ticket's `sources/`); section numbers below prefixed "textbook" refer to it.

- **A curve does not commute with a shift or a scale** (textbook §2.8). Anything that happened before a characteristic curve must be undone before it. This is why E1 corrects fading in dye space and not with printer lights, and why E2 must invert the coupling before the curve.
- **Gamut compression is the last colour step** (textbook §2.7). A gain of 1.25 after the knee sends a compressed value of 0.9 to 1.048, outside the cube the knee had just guaranteed. Every finishing operator of E5 must therefore run before `output.display`.
- **Three channels cannot recover everything** (textbook §3.8): the scene's spectrum, the interlayer (DIR) coupling from a single frame, and the stock's identity. E2 inherits all three limits; E1 inherits the third.

### 2.3 Macros and operators

Chromogen Studio separates two families of controls (its book, chapter 1, `various/extracted/chromogen-studio/st-data/book/01-ch1.md`). A **macro** is a setting of something the physical model contains (a paper, a light, an exposure). An **operator** is outside the model: an image-processing step with no darkroom counterpart. E1–E4 are macros, physical by construction. E5 is a set of operators. E6 is a method for choosing a macro's value. The distinction matters for defaults (operators are off by default and scaled together by a "look strength") and for honesty in the UI.

## 3. E1: Faded-negative restoration in dye space

### 3.1 What fading is

The image of a colour negative consists of three organic dyes formed during development. They are not permanent. In dark storage they decompose by thermal reactions accelerated by heat and humidity, and each dye has its own rate; in light they fade photochemically. Unused couplers left in the film can also turn yellow (stain). The conservation literature measures stability by the **limiting dye**, the least stable of the three: the Canadian Conservation Institute defines a material's longevity, for experimental purposes, as the time until the limiting dye has lost 10 % of its density (CCI Notes 16/5, *Care of Colour Photographic Materials*, rev. 2007), and recommends cold, dry storage because it slows these reactions.

Rates differ widely between products and generations. Arrhenius tests on Kodak Ektacolor 37 RC paper predicted that **cyan** was the least stable dye, with a 10 % loss after about 8.5 years at 24 °C and 40 % RH, while the other dyes needed decades; for Ektacolor Plus paper the predictions showed a rapid loss of magenta followed by a levelling off (Anderson and Ellison, "Natural aging of photographs", *JAIC* 31(2), 1992, 213–223). Henry Wilhelm's *The Permanence and Care of Color Photographs* (Wilhelm and Brower, 1993) is the standard survey of dark fading, light fading and stain for prints, slides, negatives and motion-picture films of the 1970s–1990s. Accelerated dark-stability tests by the Arrhenius method are standardised in ANSI IT9.9-1996 and its successor ISO 18909. Two consequences for the design:

- No fixed table of rates can be trusted for a given roll. The rates must be **estimated from the frame or the roll**.
- Fading is only approximately proportional to the dye amount. A per-dye scale is a first-order model, and its residual must be measured.

Digital restoration of faded colour materials by a per-dye model goes back to Gschwind and Frey ("Electronic imaging, a tool for the reconstruction of faded color photographs", *J. Imaging Sci. Technol.* 38, 1994, 520–525), who modelled bleaching per dye from accelerated fading experiments. Chatterjee, Trumpy and Ruedel ("Digital unfading of chromogenic film informed by its spectral densities", *Heritage* 6(4), 2023, 3418–3428) estimate fading from **neutral areas** of a frame and reconstruct the original dye concentrations from the film's known spectral densities, which is the approach proposed here. Chromogen Studio runs a related model *forwards* on the print's dyes (its Fade control: c_p ← F·c_p with F = 1 − (0.40, 0.12, 0.25)·fade/100 and a yellow stain added to the paper base, `05-inline.js` 1762–1765 and 2120), and says that "restoring a faded *negative*, needs the same model in the other direction and is not built yet" (book chapter 5).

### 3.2 The model, and why printer lights cannot fix it

Let c be the dye amounts the negative had when new and c′ what the scan shows now. The first-order model is a per-dye scale and an additive stain in the base:

```text
c′_j = k_j · c_j            k_j ∈ (0, 1], one factor per dye (cyan, magenta, yellow)
base′(λ) = base(λ) + s(λ)   stain: the rebate has it too
```

Two facts make this model convenient. The dye solve (CHB-003) already returns c′ in units of the stock's unit dye spectra, so the scale acts on exactly the numbers the pipeline holds; and the solve works on densities **relative to the rebate**, so a stain that is uniform over the film cancels, as long as the rebate stained like the image area.

A scale in dye space is not a shift in log exposure. On the straight part of a layer's curve, c = γ(u − u₀), so k·c = (kγ)(u − u₀): fading lowers the layer's **contrast**, and by a different amount in each layer. Printer lights shift log exposure, so they can balance one density and leave the others coloured. That is crossover, the defect a printer cannot remove.

A worked example, computed for this guide (spektrafilm's Portra 400 and Portra Endura from the data embedded in Filmbench, printed in CHB-010's real mode at the database's neutral pack, D50 viewing, no flare). Fade the negative with k = (0.70, 0.90, 0.85), cyan fastest. The grey card's dyes go from (0.687, 0.704, 0.864) to (0.481, 0.634, 0.734). Printed as it is, the grey comes out dark and cyan-green (L* 32.6, a* −14.3). A printer would rebalance with lights at the grey card, here by (−9.0, −3.4, −5.3) points; the grey is then exact, but the scale's other tones are not:

| Scene patch | New negative, print L*, a*, b* | Faded, rebalanced at grey | ΔE*ab | Visual density, new → faded and rebalanced |
|---|---|---|---|---|
| black (3 %) | 9.0, −1.7, −1.8 | 12.6, +2.3, −0.9 | 5.4 | 2.00 → 1.83 |
| shadow (u = −0.4) | 24.0, −1.0, −3.5 | 27.8, +2.8, −2.8 | 5.4 | 1.39 → 1.27 |
| grey card | 48.8, −0.3, −4.4 | 48.8, −0.3, −4.4 | 0.0 | 0.76 → 0.76 |
| light (u = +0.4) | 73.4, −1.2, −4.6 | 69.9, −4.5, −5.5 | 4.8 | 0.34 → 0.39 |
| white (90 %) | 85.0, −0.6, −2.0 | 81.2, −4.6, −3.6 | 5.7 | 0.18 → 0.23 |

The shadows go red, the highlights green-blue, and the print loses contrast at both ends. Dividing c′ by k before printing restores every patch exactly, because the model is exactly invertible.

### 3.3 Estimating the factors: what can and cannot be identified

The stock's **neutral curve** is the set of dye triples a grey forms at each exposure: N(t) = (f_C(t), f_M(t), f_Y(t)) for t in log H, with f_j the stock's characteristic curves (with DIR coupling, these are the datasheet curves, which already contain the inhibition a grey suffers; textbook §2.3). A pixel that was neutral in the scene has c = N(t) for some t, so after fading c′ = k ⊙ N(t). Count unknowns:

- One neutral patch gives three equations (one per dye) and four unknowns (k_C, k_M, k_Y and its exposure t). **Not enough**: a fade and an exposure change trade against each other.
- Two neutral patches at different densities give six equations and five unknowns. Enough, if the scene light was the film's balance.
- If the scene light had a colour cast, each layer's exposure is shifted by a_j (a shift in log H, two colour degrees of freedom once the common part is absorbed in t). Then the unknowns are k (3), a (2) and one t per patch: P patches give 3P equations for 5 + P unknowns, so **three neutral patches at well-separated densities** are needed.

This separation works because a cast is a shift in log H (removed by lights, no crossover) and a fade is a scale in dye space (crossover). It needs a range of densities: three patches all near the grey card cannot tell the two apart.

**Estimation methods**, in order of reliability:

1. **Picked neutrals.** The photographer picks three or more patches he knows were neutral (a white wall, a grey road, a black coat). Solve the small least-squares problem below.
2. **The roll.** A roll stored together faded together, so k is a property of the roll, while casts and exposures are properties of frames. Picked neutrals from several frames constrain one k with per-frame (a, t) unknowns, which is much better conditioned.
3. **Automatic (Speculative).** Over many pixels of a roll, the dye triples of real scenes cluster around the neutral curve (an assumption, like integrate-to-grey's). Find k that minimises a robust (trimmed) distance between k⁻¹ ⊙ c′ and N(t), with per-frame casts. This needs a validation set of faded negatives with known originals, which does not exist; build it last and only offer it as a starting point for method 1.

```text
// sketch: fade estimation from picked neutral patches (planned: packages/core/src/restore/fade.ts)
unknowns θ = (log k_C, log k_M, log k_Y, a_R, a_G [a_B = −a_R − a_G], t_1 … t_P)
residual for patch p, dye j:  r_pj = log c′_pj − log k_j − log f_j(t_p + a_j)
minimise Σ r² with Levenberg–Marquardt (CHB-003's lm), bounds k_j ∈ [0.2, 1.05]
report: k, a, the residual per patch (in D), and the condition number of JᵀJ;
refuse (E_UNDERDETERMINED) when fewer than 3 patches (2 with the option assumeNoCast, which fixes a = 0),
  or when their densities span < 0.6 log H
```

Working with log c makes the scale additive. Patches near the toe (c → 0) must be down-weighted: the log amplifies their noise. The stain needs no estimate if the rebate is measured: rebate-relative densities remove it. If the rebate is cut off or stained differently (for example, the edges were exposed to more light in an album), offer a manual stain spectrum as a fallback.

### 3.4 Where it goes in the pipeline

`invert.unfade` is a pointwise op from `film-dyes` to `film-dyes`, right after `invert.dyes`: three divisions per pixel. Its binding time is per roll (k is estimated once). Two consequences for existing tables:

- **Table domain.** Restored amounts c = c′/k can exceed the printing-density table's domain (Chromogen's `C_RANGE` is [0, 2.6]). With k_C = 0.7, a cyan of 2.0 becomes 2.86. The PD table's domain must be widened for restored frames (it is keyed by content, so a different domain is a different table), or the restore must report clamping as a diagnostic.
- **Noise.** Restoration multiplies the dye noise by 1/k. Faded cyan in thin areas is also nearly blank film; CHB-006's classification map (blank, below base) must be computed on c′, before restoring, so it does not mistake restored noise for image.

### 3.5 Limits and speculative parts

- The per-dye scale is first order. Anderson and Ellison's magenta behaviour (fast, then levelling) is not proportional. With six or more neutral patches spanning the scale, a monotone per-dye curve g_j(c) (a 1-D table) can replace the scale; **Speculative**, since no measured example exists in the project.
- Dyes can change hue as they fade. The dye solve then cannot fit the measured densities exactly, and its residual rises; `invert.classify`'s out-of-gamut fraction is the diagnostic.
- The orange mask is formed by coloured couplers that can fade too, changing the base in the image area differently from the rebate. Not modelled; **Speculative**.
- Restoration recovers the dyes the negative had when processed, not the scene (textbook §3.8).

### 3.6 Feasibility, data and tests

- **Feasibility:** high. The math is small, the solver exists (CHB-003), and the UI is a picker (CHB-009).
- **Data:** none beyond the stock profiles. A faded test set would make it much better: the photographer's own old negatives (CHB-013), ideally with a reference print from when they were new.
- **Tests:**
  - Law: `unfade(fade(c, k), k) = c` exactly, over the dye box.
  - Synthetic recovery: fade the six-patch frame and the Gold 200 sample with known k (and a known cast) and recover k to ±0.01 from three picked neutrals; recover the print within 1 ΔE₀₀ of the unfaded print.
  - Identifiability: with one or two patches, or three at nearly the same density, the estimator must refuse with `E_UNDERDETERMINED`.
  - The worked example of section 3.2 as a golden fixture: printer lights alone leave ≥ 4.5 ΔE*ab at white and black; restoration leaves < 0.1.

## 4. E2: Reprinting as another stock

### 4.1 What exists and what is wrong with it

Chromogen's **Re-shoot on** prints a frame as if it had been shot on a different film B. Per layer, it maps the dye amount through film A's inverse curve and film B's forward curve:

```text
c^B_k = f^B_k( f^A_k⁻¹(c_k) )        (05-inline.js 1761 reshootMap; FS_PD 1970; book chapter 5)
```

then prints c^B through B's dye spectra (a second PD table, `pdB`). Its own documentation names the two approximations: layer exposures carry over one to one between films, and noise in the toe is amplified by 1/γ. A third approximation is not named there: it **ignores interlayer coupling**. Chromogen has no DIR model at all (`pipe.uncouple` is the identity, textbook §2.3; report `various/analysis-chromogen-studio.md` §2.4 item 5 and §6.2).

### 4.2 The physics of DIR coupling, briefly

In a real negative, development in one layer releases inhibitors that slow development in the others, so colours come out more saturated than three independent curves predict. spektrafilm models it as a loss of log exposure (textbook §2.3): with u the layers' log exposures, f the datasheet curves and M a 3×3 matrix (donor rows, receiver columns),

```text
d⁰ = f(u)                    a first development without inhibitor
a  = Mᵀ d⁰                   the inhibitor each layer receives (then spread spatially by a kernel K)
d  = f⁰(u − a)               the final development, with curves f⁰ built so that neutrals reproduce f
```

For negatives spektrafilm uses

```text
M = | 0.336  0.353  0.302 |
    | 0.154  0.319  0.353 |
    | 0.168  0.226  0.273 |
```

(`runtime/params_builder._apply_film_specifics`, the "0.42 alpha" result of an optimisation, beside a comment that still reads "just eyeballed, optimize!"). At the grey card the layers lose (0.485, 0.663, 0.692) log H to inhibition, and the effective gamma matrix (the Jacobian ∂d/∂u) is

```text
J(0) = |  0.610  −0.056  −0.065 |
       | −0.154   0.740  −0.107 |
       | −0.145  −0.171   0.874 |
```

Its rows sum to the neutral slopes, so a grey keeps the datasheet's contrast while colour differences are amplified (textbook §2.3).

### 4.3 Inverting the coupled film, pixel by pixel

For a uniform area (no spatial spread of the inhibitor), the film stage is a map from three log exposures to three dye amounts, F_A(u) = f⁰_A(u − Mᵀ f_A(u)). Reprinting needs its inverse u = F_A⁻¹(c): the layer exposures that produced the dyes.

**It is a well-posed 3×3 solve.** The Jacobian is J = diag(f⁰′(u − a)) · (I − Mᵀ diag(f′(u))). The second factor has positive diagonal entries and non-positive off-diagonal ones; its column j is strictly diagonally dominant when f′_j · Σ_i M_ji < 1. The row sums of M are 0.991, 0.826 and 0.667, and Portra 400's steepest datasheet slopes are 0.659, 0.590 and 0.689 (computed for this guide from the Filmbench data), so the products are at most 0.65, 0.49 and 0.46. The factor is then a nonsingular M-matrix, hence a P-matrix (all principal minors positive), and multiplying by a positive diagonal keeps that. By the Gale–Nikaidô theorem, a differentiable map on a rectangle whose Jacobian is a P-matrix everywhere is injective (Gale and Nikaidô, *Math. Annalen* 159, 1965). So each reachable c has exactly one u, and a damped Newton iteration from a good start can find it. The condition degrades only where f⁰′ → 0, in the toe and the shoulder, where every inverse amplifies noise.

**A good start is Chromogen's own guess.** On neutrals, f_A is the datasheet curve that already contains the grey's inhibition, so u₀ = f_A⁻¹(c) per layer is **exact** for greys. Chromogen's re-shoot is therefore right on the neutral axis and wrong for colours, by an amount that grows with saturation. Starting Newton there should need only a few steps on moderately saturated colours; record the iteration counts when building the table.

```text
// sketch: per-node solve (planned: packages/core/src/film/invertCoupled.ts, built by CHB-015 on CHB-012's film model)
u ← f_A⁻¹(c) per layer                                    // exact on neutrals
repeat ≤ 20:
  r ← F_A(u) − c;  if ‖r‖∞ < 1e-9: stop
  J ← diag(f⁰′(u − Mᵀf(u))) · (I − Mᵀ diag(f′(u)))
  u ← u − damped solve(J, r)                              // LM damping near the toe and shoulder
if not converged or c outside F_A's range: clamp to the nearest reachable c, flag residual
```

**Tabulate it.** The inverse depends only on stock A, so it binds per stock and can be stored as a 33³ table over the dye box, like CHB-003's solve table, with a residual channel for unreachable triples. Composing it with stock B's forward film stage (CHB-012's `film.couple` + `film.develop`) and B's printing densities gives one table, c_A → PD_B, keyed by (A, B, paper, lamp, pack). The per-pixel cost of reprinting is then one table read, the same as printing.

### 4.4 Crossing from A's layers to B's layers (Speculative)

B's layers see the scene through different spectral sensitivities, so A's layer exposures are not B's. Without the scene's spectrum (textbook §3.8) the mapping can only be approximated:

- **Identity** (Chromogen's choice): B's layer k receives A's layer k exposure. Exact for a neutral that both films see as neutral.
- **A 3×3 matrix in linear exposure**, fitted by least squares over a set of reflectance spectra under the film's reference illuminant: E_B ≈ T·E_A, with E = 10^u. The training spectra could be the 24 ColorChecker patches or a larger reflectance set from CHB-004. The error of this map can be measured with CHB-012's forward model, because both films' sensitivities are known.

Neither is validated. The matrix is the better-founded choice; measure both before choosing (section 4.6).

### 4.5 Limits

- **The stock must be named** (textbook §3.8): the solve leaves a residual below 10⁻⁶ D for any reasonable dye set, so the scan cannot say which stock it is. A wrong stock A gives a wrong inverse with no warning from the residual.
- **The coupling cannot be read from one frame** (textbook §3.8): a coupling matrix composed with adjusted curves reproduces the same dyes. The inverse is correct only under spektrafilm's model and its M, which is the same matrix for every negative stock. The result is "the frame reprinted under the model", and the UI should say so.
- **Adjacency effects stay.** The inhibitor spreads over about 20 µm plus a 200 µm exponential tail (textbook §2.3), which produces edge overshoots in A. A per-pixel inverse treats every pixel as a uniform area, so A's edge effects remain in the reprint, and B's are not added unless the forward stage for B runs spatially (CHB-012 can do that; then the table shortcut does not apply).
- **Grain and noise of A stay**, amplified by 1/f′ where A's curve is flat.

### 4.6 Feasibility, data and tests

- **Feasibility:** medium. The solve is small and the table machinery exists; the dependency is CHB-012's DIR implementation (the textbook's port reproduces spektrafilm's `cmy_film` regression tap to five decimals).
- **Data:** spektrafilm profiles for A and B (CHB-004), M, and for section 4.4 a reflectance set.
- **Tests:**
  - Round trip: F_A(F_A⁻¹(c)) = c to 10⁻⁹ for reachable c; F_A⁻¹(F_A(u)) = u for u in the straight part.
  - Neutral agreement: for neutral c, the DIR-aware inverse equals f_A⁻¹(c) per layer within table interpolation error.
  - Identity: reprinting A as A returns the original print (to the table's error).
  - Synthetic truth: with CHB-012, expose a scene (a chart and saturated patches) on A and on B; reprint A's negative as B; compare with B's direct negative. Report the error budget separately for (1) Chromogen's layer-wise map, (2) the DIR-aware inverse with the identity crossing, (3) with the matrix crossing, (4) at edges. The DIR-aware version must beat the layer-wise one on saturated patches; if it does not, stop and investigate before shipping.

## 5. E3: Saunderson double-pass reflectance

### 5.1 The physics

Both spektrafilm and Chromogen compute a print's reflectance as if the paper were a transparency: R(λ) = 10^(−D_p(λ)), with D_p the paper dyes' spectral density plus the base (textbook §2.7). That reproduces a densitometer's readings of the measured neutrals, because the profiles were built from such readings, but it is not what happens in the paper. Light crosses the dye layer, is scattered back by the white base, crosses the dye layer again, and at the gelatin–air surface most of it is reflected back inside for another round trip: only 38.6 % escapes at the first attempt (Hunt, *The Reproduction of Colour*, 13.9). US patent 6,633,408 (Rozzi, 2003, cols. 15–16) models this with a double pass through the dyes and **Saunderson's correction** for the surface:

```text
R′(λ) = (1 − k₁)(1 − k₂)·R_p(λ) / (1 − k₂·R_p(λ)),     R_p(λ) = R_g(λ)·10^(−2·d(λ))
```

with k₁ ≈ 0.04 the fraction of incident light the surface reflects, k₂ ≈ 0.6 the fraction of internal light reflected back at the surface, R_g the base's reflectance and d(λ) the dyes' **single-pass internal** density (the patent writes the exponential in natural-log absorptivities; base 10 is used here). Differentiating the measured density D′ = −log₁₀ R′ with respect to d gives

```text
dD′/dd = 2 / (1 − k₂·R_p)
```

which is 5 for a thin layer (R_p → 1), 2.9 at d = 0.15 and 2.0 at d = 1 (textbook §2.7, Figure 2.5): Hunt's low densities magnified "by factors as large as five or more". Measured reflection density is therefore not proportional to dye amount, and small unwanted absorptions grow fastest.

### 5.2 Why the paper dyes must be refitted

Switching the model on with the existing data is wrong. spektrafilm's paper dye spectra are measured reflection densities per unit dye; reading them as internal single-pass densities counts the double pass twice. The textbook's sketch does exactly that and the grey card darkens from 0.755 to 1.12 and paper white from 0.09 to 0.21 (textbook §2.7, "Try it"). The data must first be converted into internal quantities that reproduce the same measured neutrals:

1. For each step of the paper's neutral ramp (dye amounts along equal paper exposures, from the profile's curves), compute the measured reflectance R′(λ) = 10^(−D_p(λ)) from the existing linear model, which is exact on neutrals.
2. Invert Saunderson per wavelength: R_p = R′ / ((1 − k₁)(1 − k₂) + k₂·R′).
3. Take R_g from paper white (step 0), assuming the base itself carries no dye: then d(λ) = −log₁₀(R_p/R_g)/2 for every step.
4. Fit internal unit dye spectra κ_j(λ) and per-step internal amounts c′_j by non-negative least squares over the ramp (the profile's single-dye spectra, converted the same way, give the starting point and constrain the factorisation).
5. Refit the paper curves so that c′_j(x) reproduces the internal amounts at each exposure x.
6. Check: the new model reproduces every neutral step's visual density within 0.005 and the grey card at the old aim (0.755 with the Studio's flare).

After the refit, neutrals print as before and the difference appears in colours: thin dye layers and unwanted absorptions count more, so saturated colours and pale tints shift. How large that shift is in practice is a prediction: there are no measured print spectra in the project to check it against. **Speculative** in its effect size, though the model itself is the physical one.

Identifiability caveat: step 3 cannot separate a base stain from the base's reflectance, and step 4 is a factorisation whose solution is not unique (the patent fits absorptivities by factor analysis of measured spectra). Constrain the internal spectra to stay close to the converted single-dye spectra.

### 5.3 What the viewer sees

The densitometer excludes the surface reflection; a viewer under diffuse room light does not: a matte print returns about k₁ of the light whatever the dyes below, so the viewed reflectance is R′ + k₁. That is viewing flare, which CHB-003's `view.flare` already models (Chromogen's maximum flare of 4 % is exactly k₁). In Saunderson mode, link the surface type (gloss, lustre, matte) to the flare default instead of adding a second surface term. The textbook's numbers show how much this matters: the densest black reads 2.37 on a densitometer, is seen as 2.09 with the Studio's default flare and as 1.35 with k₁ fully reaching the eye.

### 5.4 Pipeline, feasibility, plan

- **Where:** `view.reflect` gains `model: 'single-pass' | 'saunderson'`. The c_p → XYZ table (CHB-003, 33³) is rebuilt per paper and model; nothing changes per pixel.
- **Data:** the refitted paper parameters (k₁, k₂, R_g, κ_j, refitted curves) belong in the data pack, produced by the exporter in `tools/spektrafilm-export` (CHB-004), versioned with the paper.
- **Feasibility:** medium. The refit is a few hundred lines of Python with clear acceptance criteria.
- **Tests:** the derivative law dD′/dd = 2/(1 − k₂R_p) at d = 0.01, 0.15 and 1 (5.0, 2.9, 2.0 within 0.05); the neutral ramp within 0.005 D after refit; a deliberately un-refitted model must fail the grey-card check (1.12 against 0.755).

## 6. E4: Newson Boolean-model grain

### 6.1 What grain models exist in the sources

- **spektrafilm's Poisson–binomial model** (`model/grain.py`, textbook §2.5): each pixel's dye amount is a scaled Poisson count, with mean D and variance (D_max/N)·D·(1 − u·D/D_max), N the crystals per pixel. Its Selwyn granularity G = σ²·A_px does not depend on pixel size, so it obeys Selwyn's law at the pixel by construction. Its noise is white at the pixel scale: the grain's apparent size follows the scan, not the film. It costs one random draw per pixel per sublayer.
- **Chromogen's Gaussian texture**: c ← c + σ₀·√(c + 0.05)·n(x), with n a 1024² noise tile in film coordinates (3 µm per texel at 1×), sampled through a mip-map so that the variance follows the area law. The tile repeats every 3.07 mm on the film, about 12 times across a 35 mm frame (report §6.2).

For negative scans the film's own grain is already in the scan, so synthetic grain matters for the forward RAW path (CHB-012) and for "re-grain at export size" after grain reduction, which Chromogen lists as not built.

### 6.2 The Boolean model

Newson, Faraj, Delon and Galerne ("Realistic film grain rendering", *Image Processing On Line* 7, 2017, 165–183) model a black-and-white emulsion as a union of discs (grains) with centres from an inhomogeneous Poisson process. The probability that a point is covered by at least one disc is 1 − exp(−λ·E[πr²]), so to reproduce a grey level ũ ∈ [0, 1) the local intensity is

```text
λ(y) = (1 / E[πr²]) · log( 1 / (1 − ũ(y)) )
```

with radii constant or log-normal (mean µ_r, standard deviation σ_r, in input pixels). The image is the coverage filtered by a Gaussian of standard deviation σ (0.8 output pixels by default), evaluated by Monte Carlo: v(y) = (1/N) Σ_k 1_Z((y − ξ_k)/s), with N Gaussian offsets ξ_k shared by all pixels and s the zoom. Because grains live in continuous coordinates, the same grain field can be rendered at any resolution.

Two implementations are given: **grain-wise** (draw each grain, splat it into N binary images; cost C₀ = m·n·N·4 log 2 / (π(µ_r² + σ_r²))) and **pixel-wise** (for each output pixel and offset, regenerate the grains of nearby cells from a seeded generator; cost C₁ = m·n·N·(2⌊p/µ_r⌋ + 1)²·µ_r² log 2 / (π(µ_r² + σ_r²)), p a high quantile of the radius). The authors choose between them empirically and report that a 512 × 512 constant image takes 40 s (grain-wise) and 2.4 s (pixel-wise) on a parallel CPU implementation, "far from being real-time". A later paper derives the filtered Boolean model's statistics analytically and renders in real time as long as individual grains are not visible (Zhang, Wang, Tian and Pappas, "Film grain rendering and parameter estimation", *ACM TOG* 42(4), 2023).

For colour, Newson et al. apply the model independently in each channel.

### 6.3 Adapting it to dye clouds (Speculative)

A colour negative is not a black-and-white emulsion: developed crystals leave dye clouds, which are transparent and add density where they overlap, while the Boolean model's coverage is binary. Two adaptations, neither validated:

- **Coverage per sublayer.** spektrafilm's p = D/D_max is the fraction of developed crystals; set the Boolean coverage to p, so λ = −log(1 − p)/(π E[r²]), and the dye amount to D_max times the filtered coverage. Simple; overlapping clouds count once.
- **Shot noise.** Each Poisson-placed crystal contributes a disc-shaped bump of dye density, summed (not unioned). This matches spektrafilm's counting statistics and makes the variance comparable with its closed form, which gives a direct test.

Use spektrafilm's crystal areas (0.2 µm² × (1.6, 1.6, 3.2) per channel × (2, 1, 0.5) per sublayer, textbook §2.5): equivalent disc diameters from about 0.45 to 1.3 µm.

### 6.4 When it matters, and what it costs

A pixel of the output covers an area of film. A 50 cm print from a 36 mm frame is a 13.9× enlargement; at 300 pixels per inch a print pixel is 84.7 µm, which is 6.1 µm of film. That is several crystal diameters, and Selwyn's law makes the per-pixel model statistically right at that scale. The Boolean model differs from it visibly only when an output pixel covers a few micrometres of film or less: very large prints, strong crops, and zoomed views of exports. Its other benefit holds at any size: a grain field defined on the film, with a deterministic generator per film cell, is **the same at every resolution**, so the 640-pixel preview and the full export show the same grain, which neither spektrafilm's per-pixel draws nor Chromogen's repeating tile can promise.

The cost is the obstacle. Extrapolating the IPOL timing (9 µs per pixel on their CPU, a constant mid-grey image) to a 24-megapixel export with three layers gives about 11 minutes on a CPU, against milliseconds for the Poisson–binomial model on a GPU. The pixel-wise algorithm is a gather per output pixel and maps to a WebGPU compute shader; one to two orders of magnitude are plausible but **unmeasured**. Recommendation: export-only, tiled, with the per-pixel model for previews; or implement Zhang et al.'s analytical rendering for previews if it can be matched to the same parameters.

### 6.5 Plan and tests

- Prototype in f64 on small crops (`packages/core/src/film/grainBoolean.ts`), with a counter-based hash generator per film cell (so tiles and resolutions agree).
- Tests: mean preservation (the filtered coverage averages to ũ within Monte Carlo error for N = 64, 256, 1024); Selwyn's G at a 48 µm aperture against spektrafilm's closed form when parameterised to the same crystal areas (shot-noise variant); resolution independence (rendering at 2× and box-downsampling matches rendering at 1× within Monte Carlo error); tile seams invisible (a tile boundary has the same statistics as the interior).
- Then a WGSL pixel-wise kernel, timed on real hardware before deciding where it is offered.

## 7. E5: The digital finishing operators

### 7.1 What exists

Chromogen Studio's "Tone", "Colour" and "Detail" sections are operators: they change the image without a darkroom counterpart. All are scaled by **Look strength** λ (0–150 %, default 100 %, `05-inline.js` 1581–1597; `op()` in `frameParams` 2101–2102), while the physical macros are not. Their parameters come from the constants `K` (`05-inline.js` 950–992) and the `SLIDERS` table.

| Operator | Domain and code | Formula (v is the slider in ±100 or 0–100) | Constants |
|---|---|---|---|
| Saturation (`dyeSat`) | film dyes, `FS_DYES` 1938–1943 | n = dyes of a neutral at the mean log exposure; c ← max(n + s(c − n), 0), s = 1 + 0.6·v/100 | DYESAT 0.6 |
| Grain reduction | film dyes, `FS_PD` 1953–1963 | 5×5 bilateral on c: spatial σ 1.6 px, range σ 0.015 + 0.03·√(c + 0.05); c ← mix(c, filtered, r) | GRAINRED 1 |
| Contrast mask | printing density, `FS_PRINT` 2001–2002 | B′ = B_ref + (1 − 0.6·v/100)(B_L − B_ref); ΔPD = B′ − B_L in all channels | MASK 0.6, MASK_RADIUS 4 % |
| Highlights, Shadows | printing density, 2003–2004 | B′ ∓ 0.25·v/100·smoothstep(B_ref, B_ref ± 0.6, B_L) | ZONE 0.25 |
| Clarity | printing density, 2005 | ΔPD += 0.8·v/100·(Y − B_M) | CLARITY 0.8, MID_RADIUS 0.8 % |
| Texture | printing density, 2006–2011 | d = Y − G₅ₓ₅(Y) (σ 1 px); ΔPD += 1.2·v/100·d·d²/(d² + 0.012²) | TEXTURE 1.2; FINE_RADIUS 0.09 % defined but unused |
| Sharpness | output XYZ, `FS_OUT` 2055–2059 | k = clamp(1 + s·(Y − Y_3×3)/max(Y, 0.004), 0.5, 2); XYZ ← k·XYZ (keeps chromaticity) | SHARP 1.2 |
| Bloom | output XYZ, 2060 | XYZ += 0.6·v/100 · blur(XYZ·smoothstep(0.55, 0.95, Y)), σ 3.5 % of the long side, at 320 px | BLOOM 0.6 |
| Vibrance | OKLab, 2063 | C ← C·(1 + vib·clamp(1 − C/0.32)·(1 − 0.7·skin(h))), skin centred at 0.96 rad, vib = 0.8·v/100 | VIBRANCE 0.8 |
| Hue shifts | OKLab, 2064–2068 | six families centred at 25, 55, 100, 145, 250, 320°, Gaussian weights in hue (σ 0.38 rad) gated by clamp(C/0.04); h += Σw·30°·u/100, C ← C·(1 + Σw·s/100) | HUE_DEG 30 |
| Saturation rolloff | OKLab, 2069 | C ← C·(1 − r·(smoothstep(0.82, 1, L) + smoothstep(0.32, 0.05, L))), r = 0.85·v/100 | ROLLOFF 0.85 |
| Colour density | OKLab, 2070 | L ← L − 0.35·v/100·C | COLDENS 0.35 |

The **guided filter** behind the tone operators (He, Sun and Tang, ECCV 2010) is built in the 640-px global pass (`05-inline.js` 3054–3060): box means of (Y, Y²) at two radii (4 % and 0.8 % of the long side), a = σ²/(σ² + ε) with ε = 0.05² and 0.03², b = (1 − a)µ, box-blurred again and upsampled; `FS_PRINT` reconstructs B_L = a_L·Y + b_L and B_M = a_M·Y + b_M per pixel. B_ref is the median of Y over the frame. In a flat window a ≈ 0 and the base is the local mean; across an edge a ≈ 1 and the base follows the edge, so changing the base leaves no halo. OKLab is Björn Ottosson's colour space (2020); the shader's matrices are the published M1 and M2.

### 7.2 Where they must go

The rule from section 2.2: nothing amplifying or nonlinear after the gamut knee. In Chromogen, the per-channel tanh shoulder above 0.82 (`FS_OUT` 2073–2074) comes after the OKLab operators, so the Studio respects it. In chromobench the knee is part of `output.display`, after chromatic adaptation (owned by CHB-003 and CHB-011; spektrafilm's version, which they follow, compresses CAM16-UCS chroma with a Reinhard knee after a one-sided knee on lightness, textbook §2.7), so **every finishing operator must run before `output.display`**. The architecture's catalog lists `finishing` on `display-rgb`, which is after the knee; section 12 proposes to change that. The placement, by domain:

| Group | Domain | Before or after | Why there |
|---|---|---|---|
| `finishing.dyeSat`, `finishing.grainReduction` | `film-dyes` | before printing | they act on the negative, as Chromogen's do |
| `finishing.tone` (mask, highlights, shadows, clarity, texture) | `printing-density` | before the paper's curve | equal ΔPD in all three channels is a neutral exposure change; the paper then renders it with its own contrast, like CHB-010's physical density masks |
| `finishing.sharpen`, `finishing.bloom` | `print-xyz` (linear) | before the knee | bloom is light added in linear light; the sharpening ratio keeps chromaticity |
| `finishing.colour` (vibrance, hues, rolloff, colour density) | `print-xyz` → OKLab → `print-xyz` | before the knee | they can increase chroma; the knee must clean up afterwards |

Order inside the output group: Chromogen's code sharpens, then adds bloom, then applies the OKLab operators (`FS_OUT` 2055–2072), while its book says bloom, OKLab, then sharpness (report §6.3 item 4). Keep the code's order, which existing looks were tuned on, and correct the documentation.

### 7.3 What to fix while porting

- **Pixel-scale kernels.** Texture (5×5 at σ = 1 px), sharpness (3×3) and grain reduction (5×5) act at the render resolution, so a ≤ 2048-px preview and a full-size export look different (report §6.2). Define their radii physically: in µm on the film for grain reduction and texture (FINE_RADIUS was meant for that), and from print size and viewing distance for output sharpening. Run them at the evaluation scale with radii converted per scale; where a radius falls below a pixel in the preview, the preview must say so (the effect is not visible at that scale) rather than silently differ.
- **The display shoulder** (0.82 tanh) is replaced by `output.display`'s knee; do not port it.
- **Look strength** stays: one scalar that scales all operators, with 0 meaning "the physical print".

### 7.4 Plan and tests

- Port in f64 (`packages/core/src/finishing/`), then WGSL (`packages/gpu/src/kernels/finishing_*.wgsl`), reusing CHB-005's separable blurs and global pass.
- Laws:
  - every operator is the identity at 0, and Look strength 0 disables all of them;
  - neutral preservation: vibrance, hue shifts and rolloff leave C = 0 pixels unchanged (the hue weights are gated by C/0.04), and tone operators shift neutrals along the neutral axis only;
  - gamut: after any finishing settings, `output.display` returns values inside the output gamut (property test with random settings and saturated inputs);
  - scale agreement: with physical radii, a preview at 1/4 scale and the export downsampled to the same size agree within a stated tolerance.
- Parity: GPU against the f64 port; Chromogen's GLSL as a third reference for the formulas (not for the radii).

## 8. E6: A learned light estimator

### 8.1 The problem

Integrate-to-grey (CHB-010) chooses printer lights from the frame's average printing density, with a partial correction α = 0.75. It fails predictably: a frame dominated by foliage prints magenta at full correction (chroma 19.4 for the textbook's foliage frame without a cast; textbook §3.6), and α trades that against correcting real casts. Chromogen's book says its design document's **learned estimator** "predicted lights with less than half the error of integrate-to-grey in simulation and was to learn from the frames you balance", and that it is not built; roll consistency is its stand-in (book chapter 9; `st-data/book/09-ch9.md`). The design document itself is not in the project, so that claim is unverified.

### 8.2 A formulation (Speculative)

Learn the correction the photographer makes on top of integrate-to-grey.

- **Target:** the final lights minus the auto lights, in the three coordinates the balance tools already use: density (stops) and colour (warmth, tint), from `lightsToSliders` (CHB-010).
- **Labels:** every frame the photographer finishes is a label. The edit log (CHB-002) records which mutations were made `by: 'user'`, so the labels come for free and stay local.
- **Features:** statistics in printing density, before any balance: the LATD deviations Δ, mean PD, per-channel percentiles (5, 25, 50, 75, 95), the chroma of the PD histogram's mass in the paper's colour plane, the blank and out-of-gamut fractions (CHB-006), the roll's mean auto lights, the stock and the paper.
- **Model:** start with ridge regression (a few dozen weights; interpretable; trains in milliseconds in the browser), with integrate-to-grey as the prior (the model predicts a correction that shrinks to zero with little data). A small gradient-boosted model can follow if the data justify it.
- **Pretraining:** synthetic frames with known true lights from the forward model (CHB-004's synthetic set): scenes under varied illuminants, including foliage-dominated and sunset frames. This teaches the colour-failure pattern before any user data exists.

### 8.3 Evaluation

- Split by roll, never by frame: frames of one roll share light and processing, and a frame-level split would leak. Chromogen's `data.js` hashes a group for its splits and `evaluate.js` resamples whole clusters for a paired bootstrap (textbook §3.7); reuse that design.
- Metrics: the grey card's chroma after balancing (on synthetic data, where the grey card is known) and the distance in points between predicted and final lights (on user data).
- Baselines: integrate-to-grey at α = 0.75, roll consistency, and α tuned per user.
- Ship only if it beats the best baseline on held-out rolls with a confidence interval that excludes zero.

### 8.4 Feasibility, data, risks

Feasible in code (small, local), limited by data: a photographer balances perhaps hundreds of frames a year, and the model is only as good as the consistency of his choices. Risks: overfitting to a few rolls; drift as taste changes (weight recent labels more); and a feedback loop where the photographer accepts the estimator's suggestions and they become labels (record whether a label was accepted unchanged). The estimator writes `print.lights.auto` with `method: 'learned'`; it never writes the photographer's own lights.

## 9. Recommended order and implementation plan

The extensions are independent; this order puts value and certainty first.

1. **E5 Finishing operators.** Ported code, needed by anyone used to Chromogen; mainly a placement and scaling exercise.
   - Build: f64 port, WGSL kernels, physical radii, Look strength, catalog entries with corrected domains.
   - Done when: the laws of section 7.4 pass and Chromogen's formulas are reproduced on the Gold 200 sample at the Studio's working size.
2. **E1 Faded-negative restoration.** High value for the photographer's older negatives; small math.
   - Build: `invert.unfade`, the patch-based estimator, roll-level k, PD-table domain handling, diagnostics; automatic estimation last.
   - Done when: the synthetic recovery and identifiability tests of section 3.6 pass; one real faded roll (CHB-013) is restored and reviewed with the photographer.
3. **E3 Saunderson reflectance.** A data refit plus a table rebuild.
   - Build: the refit in `tools/spektrafilm-export`, the `view.reflect` model switch, surface-type flare defaults.
   - Done when: the tests of section 5.4 pass for the three papers in CHB-004's pack.
4. **E2 Reprint as another stock.** After CHB-012's DIR stage exists.
   - Build: the coupled inverse, its table, the composed c_A → PD_B table, the identity crossing; then the matrix crossing.
   - Done when: the round-trip, neutral and synthetic-truth tests of section 4.6 pass and the error budget is written into the diary.
5. **E4 Boolean grain.** After a decision that large prints need it.
   - Build: f64 prototype, then a WGSL kernel; time it.
   - Done when: the statistical tests of section 6.5 pass and a measured cost is on record.
6. **E6 Learned estimator.** After the beta has produced labels.
   - Build: features, ridge model, pretraining on synthetic frames, evaluation harness.
   - Done when: the evaluation of section 8.3 is run; ship only if it wins.

## 10. Testing summary

| Extension | Laws | Golden numbers | Fixtures |
|---|---|---|---|
| E1 | unfade∘fade = identity; underdetermined cases refused | the section 3.2 table (k = (0.70, 0.90, 0.85): rebalance lights (−9.0, −3.4, −5.3) points, ΔE*ab 5.4 black, 5.7 white) | synthetic faded six-patch frame and Gold 200; a real faded roll |
| E2 | F_A∘F_A⁻¹ = identity; neutral agreement with the layer-wise map; A→A identity | J(0), M, inhibition (0.485, 0.663, 0.692) at the grey card (textbook §2.3) | synthetic scenes on two stocks (CHB-012) |
| E3 | dD′/dd = 2/(1 − k₂R_p); neutrals unchanged after refit | 5.0, 2.9, 2.0; grey 0.755; un-refitted grey 1.12 | the three paper profiles |
| E4 | mean preservation; Selwyn's G; resolution independence | spektrafilm's closed-form G for Portra 400 (RMS 9.1, 7.4, 13.8 at D = 1, textbook §2.5) | flat fields at several densities |
| E5 | identity at 0; neutral preservation; gamut after `output.display`; scale agreement | Chromogen's constants (section 7.1) | Gold 200 sample |
| E6 | roll-level splits; baseline comparison | — | synthetic illuminant set; beta labels |

The numbers of section 3.2 and the slope bounds of section 4.3 were computed for this guide from the Filmbench data with small scripts; the f64 reference must reproduce them before they become fixtures.

## 11. Risks, open questions and decisions

| Item | Effect | Blocks? |
|---|---|---|
| Does the photographer have faded negatives and reference prints? | decides E1's priority and its validation | blocks E1's acceptance on real data, not its build |
| No measured print spectra | E3's improvement cannot be verified, only its consistency | no; ship as an option labelled physical-model |
| spektrafilm's single DIR matrix for all negative stocks | E2's inverse is "under the model" | no; say so in the UI |
| Cross-stock sensitivity mapping unvalidated | E2's colours depend on it | blocks E2's default choice; measure first |
| Boolean grain cost unmeasured on WebGPU | E4 may be export-only | blocks E4's placement |
| Too few labels for E6 | the estimator may never beat the baseline | no; it ships only if it wins |
| Finishing operators placed on `display-rgb` in the current catalog | operators after the knee would break the gamut guarantee | blocks E5; needs the contract change below |

## 12. Proposed contract additions (for CHB-002)

1. **Finishing domains.** Replace the catalog's single `finishing` row on `display-rgb` by: `finishing.dyeSat`, `finishing.grainReduction` on `film-dyes`; `finishing.tone` on `printing-density`; `finishing.sharpen`, `finishing.bloom`, `finishing.colour` on `print-xyz`. All are `class: 'pointwise'` or `'spatial'` and must precede `output.display`. Add a conformance check that, apart from `output.encode` and the `measure.*` ops, no op consumes `display-rgb`.
2. **Finishing recipe shape.** `finishing?: Record<string, number>` cannot hold the six hue families; use `finishing?: { look: number; values: Record<string, number>; hues?: Record<'reds'|'skin'|'yellows'|'greens'|'blues'|'purples', [number, number]> }`.
3. **E1.** Op `invert.unfade` (`film-dyes` → `film-dyes`, pointwise, binding `scan`); op `measure.fade` (Value: k, cast, residuals, condition number); recipe `scan.fade?: { k: [number, number, number]; source: 'manual' | 'patches' | 'roll' | 'auto'; patches?: Point[]; stain?: string }`; error code `E_UNDERDETERMINED`.
4. **E2.** Op `invert.exposures` (`film-dyes` → `film-logH`, needs the stock's coupling model; binding `stock`); recipe `scan.reprint?: { stock: string; amount: number; crossing: 'identity' | 'matrix' }`. The amount blends prints in printing density, as Chromogen's Re-shoot amount does, and is labelled a hybrid (physical only at 0 and 1).
5. **E3.** `view.reflect` argument `model: 'single-pass' | 'saunderson'`; recipe `view.reflectance?: 'single-pass' | 'saunderson'`; data-pack fields for the refitted paper (`saunderson: { k1, k2, Rg, kappa, curves, version }`).
6. **E4.** `film.grain` argument `model: 'poisson-binomial' | 'boolean'` with `radius_um`, `radiusSigma`, `mcSamples`; the CHB-012 owner decides defaults.
7. **E6.** Reserve `print.lights.auto.method: 'learned'` (CHB-010 proposes the `AutoBalance` shape) and a local model store keyed by user and version.

## 13. References

**Project files** (relative to the CHB-001 ticket directory, `ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`):

- `design-doc/01-chromobench-architecture-and-work-plan.md`: domains, catalog, recipe, ticket map.
- `sources/The Mathematics of the Colour Negative.md`: §2.3 DIR coupling (lines 439–482), §2.5 grain (504–528), §2.7 viewing and Saunderson (556–586), §2.8 laws (588–604), §3.6 balance (917–947), §3.7 evaluation (949–963), §3.8 limits (965–973).
- `various/extracted/chromogen-studio/05-inline.js`: K constants 950–992; SLIDERS 1003–1597 (tone 1361–1446, colour 1447–1529, detail 1530–1597); reshootMap 1761; fade and print table 1762–1787; `buildModel` re-shoot 1870–1878; `FS_DYES` 1918–1945; `FS_PD` 1946–1972; `FS_PRINT` 1988–2025; `FS_OUT` 2027–2076; `frameParams` 2100–2157; global pass 3022–3069.
- `various/extracted/chromogen-studio/st-data/book/01-ch1.md`, `05-ch5.md`, `06-ch6.md`, `07-ch7.md`, `08-ch8.md`, `09-ch9.md`, `10-ch10.md` ("What is not built yet").
- `various/analysis-chromogen-studio.md` §2.4–2.10, §6.1–6.3.
- `various/extracted/filmbench-ide/00-film-data.bin.txt` and `scripts/06-decode-filmbench-film-data.py`: the spektrafilm data used for this guide's computations.

**External:**

- H. Wilhelm and C. Brower, *The Permanence and Care of Color Photographs*, Preservation Publishing, 1993.
- S. Anderson and R. Ellison, "Natural aging of photographs", *JAIC* 31(2), 1992, 213–223.
- Canadian Conservation Institute, *Care of Colour Photographic Materials*, CCI Notes 16/5 (1986, rev. 2007).
- ISO 18909, *Photography — Processed photographic colour films and paper prints — Methods for measuring image stability* (successor of ANSI IT9.9-1996).
- R. Gschwind and F. Frey, "Electronic imaging, a tool for the reconstruction of faded color photographs", *J. Imaging Sci. Technol.* 38, 1994, 520–525.
- S. Chatterjee, G. Trumpy and U. Ruedel, "Digital unfading of chromogenic film informed by its spectral densities", *Heritage* 6(4), 2023, 3418–3428, doi:10.3390/heritage6040181.
- D. Gale and H. Nikaidô, "The Jacobian matrix and global univalence of mappings", *Mathematische Annalen* 159, 1965, 81–93.
- US 6,633,408 (Rozzi, 2003), cols. 15–16: double pass and Saunderson's correction.
- R. W. G. Hunt, *The Reproduction of Colour*, 6th ed., 13.9–13.10 and 16.7.
- A. Newson, N. Faraj, J. Delon and B. Galerne, "Realistic film grain rendering", *Image Processing On Line* 7, 2017, 165–183, doi:10.5201/ipol.2017.192.
- K. Zhang, J. Wang, D. Tian and T. N. Pappas, "Film grain rendering and parameter estimation", *ACM Transactions on Graphics* 42(4), 2023, article 63, doi:10.1145/3592127.
- K. He, J. Sun and X. Tang, "Guided image filtering", ECCV 2010.
- B. Ottosson, "A perceptual color space for image processing" (OKLab), 2020.
- spektrafilm (`github.com/andreavolpato/spektrafilm`): `model/couplers.py`, `model/grain.py`, `runtime/params_builder.py`, `runtime/stages/scanning.py`, `utils/gamut_compression.py`.
