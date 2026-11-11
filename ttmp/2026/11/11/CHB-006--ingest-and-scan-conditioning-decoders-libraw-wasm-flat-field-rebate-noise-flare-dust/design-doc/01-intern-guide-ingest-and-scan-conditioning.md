---
Title: 'Intern guide: Ingest and scan conditioning'
Ticket: CHB-006
Status: active
Topics:
    - ingest
    - image-pipeline
    - color-science
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cv/buffer/decode_tiff.go
      Note: Strict pure-Go TIFF/DNG decoder with DNG black and white levels, to compare against
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cv/kernels/heal.go
      Note: Patch and harmonic heal kernels to port to density
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cv/kernels/specks.go
      Note: Speck background and detection kernels to port to density
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: Sections 1.6, 1.7, 3.1, 3.2, 3.5 and 3.7 give the rebate, noise, flat, flare, class and conditioning maths and golden numbers
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/chromogen-studio-1.2/samples/gold200.png
      Note: The Gold 200 fixture used for the decode, sigma, rebate and class goldens
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-chromogen-studio.md
      Note: Section 1 lists input formats, encoding assumptions and the decode bugs
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-goja-cv.md
      Note: Dust domain, decoder formats, heal and gold tests, evidence on mis-declared encodings
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/05-inline.js
      Note: decode.js (2195-2413) and source.js (2415-2692) are the code this ticket ports and fixes
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:23.139561493-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Ingest and scan conditioning

This guide is for the engineer who builds `packages/ingest` (`@chromobench/ingest`). Read the architecture and work plan first (`ttmp/2026/11/11/CHB-001--…/design-doc/01-chromobench-architecture-and-work-plan.md`, called "the architecture" below). This guide uses its vocabulary: domains, ops, recipe, mutation, engine. Paths that begin `C1/` are relative to the CHB-001 ticket directory, `ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`. "The textbook" is `C1/sources/The Mathematics of the Colour Negative.md`. "Chromogen" is the prototype in `C1/various/extracted/chromogen-studio/05-inline.js`.

## 1. What this ticket is for

A photographer drops a file into chromobench. It might be:

- a 16-bit TIFF from a film scanner;
- a camera RAW file of a negative lit from behind;
- three RAW files, one per coloured LED;
- a 16-bit PNG;
- a RAW photograph that will be "shot" on a simulated film stock.

Every later stage of the system assumes the numbers it receives are trustworthy:

- the dye solve (CHB-003);
- the GPU chain (CHB-005);
- the darkroom tools (CHB-010);
- the agent (CHB-008).

Trustworthy means four things:

- they are proportional to light;
- they come from a known file;
- they are relative to a known zero;
- they come with an honest statement of their noise.

This ticket produces those numbers. It has two halves.

**Ingest** turns bytes into **camera-linear** values: linear sensor values in the sensor's own pixel grid. Its parts:

- the **source identity**, the SHA-256 of the file's bytes;
- decoders for TIFF, 16-bit PNG, LinearRaw DNG and LED triplets;
- LibRaw compiled to WebAssembly for camera RAW files;
- declared encodings and black and white levels;
- for RAW photos, the camera-to-XYZ matrices that the forward path (CHB-012) needs.

**Scan conditioning** prepares a negative scan for inversion:

- a flat field to remove uneven light;
- the open gate and flare;
- the rebate, which sets the zero of density;
- the density noise σ;
- the base classes "blank film" and "below base";
- a conditioning map that says where the dye solve amplifies noise;
- a ranking of candidate stocks from the rebate's colour;
- dust detection and healing.

Its output is **scanner density**, D_k = −log₁₀(T_k / T_reb,k) per channel, together with the diagnostics needed to interpret it.

This ticket does not do the following:

- the dye solve and the "out of gamut" class (CHB-003);
- the GPU per-pixel chain (CHB-005), which reads ingest's results as uniforms and textures; this ticket supplies only the WGSL dust kernels;
- the Source panel UI (CHB-009);
- ICC profiles and export (CHB-011);
- scene-to-film exposure (CHB-012);
- fitting a scanner model to a real setup (CHB-013), which builds on the functions defined here;
- black-and-white silver images (CHB-014).

## 2. Background, from first principles

### 2.1 Numbers in a file: counts, levels and encodings

A camera or scanner sensor counts photo-electrons. After the analogue-to-digital converter, a stored sample u is the count plus a constant offset, the **black level** b. It is capped at a **white level** w, where the sensor or converter saturates. The physically meaningful value is

```text
v = (u − b) / (w − b)        0 = no light, 1 = saturation
```

This is linear in light: twice the light gives twice v. Every physical formula in this project assumes this linear v (the architecture calls it `camera-linear`).

Files do not always store linear values. An 8-bit JPEG or PNG usually stores **sRGB-encoded** values. These are passed through a transfer curve so that 256 levels are spread evenly to the eye. Decoding sRGB means:

```text
v_lin = v / 12.92                      if v ≤ 0.04045
v_lin = ((v + 0.055) / 1.055)^2.4      otherwise
```

Chromogen's `srgbDecode` (`05-inline.js` 2413) implements this. A file can also be gamma 2.2 (v_lin = v^2.2). The architecture's `ImageInfo.encoding` is `'linear' | 'srgb' | 'gamma22'`: the transfer that must be undone before the values mean light. The encoding is a property of the file. If it is declared wrongly, every number downstream is skewed with no error raised. goja-cv met exactly this: a supposed regression in its dust ranking turned out to be tiles exported with density as code values but read as sRGB (`C1/various/analysis-goja-cv.md` §3.6, deviation G4 #37).

**Order matters: linearise first, average second.** Reducing a scan to a smaller working size averages each output pixel's footprint of source pixels. The average must be taken of light, not of encoded values. Take two neighbouring pixels on an edge, encoded at 0.2 and 0.8:

- Averaging first gives 0.5, which decodes to 0.2094.
- Decoding first gives 0.0331 and 0.6038, whose mean is 0.3185.

As densities, that is 0.679 against 0.497: an error of 0.18 D on one edge pixel. In flat areas the error is second order (Jensen's inequality on the noise), but it is a bias, not noise. Chromogen averages first (§4.2 lists the bug).

### 2.2 The scanner is a forward model, so it needs raw channels

The textbook writes a scanner channel k as a **responsivity**, everything between the lamp and the number (§3.1, lines 714–722):

```text
P_k(λ) = S_k(λ) · F_k(λ) · Q_k(λ)       light × filter/optics × sensor
r_k    = Σ_λ P_k(λ) · T(λ)               the signal is linear in the film's transmittance T(λ)
```

Chromogen normalises each P_k to sum to 1 (`channels.js`, `05-inline.js` 486–493). The **scanner density** of channel k is then D_k = −log₁₀ Σ_λ P̂_k(λ) 10^(−D(λ)). D(λ) is the negative's spectral density: the stock's base plus the three dye amounts times their unit spectra (architecture §2). The dye solve (CHB-003) inverts exactly this equation. It is valid only if each stored channel value is r_k up to a per-channel scale. Three kinds of processing that a camera, raw converter or scanner driver applies by default behave differently:

- **White balance** multiplies each channel by a gain g_k. The gain cancels when the scan is divided by the rebate, T_k/T_reb,k, so it is harmless to the physics. It is not harmless in practice: LibRaw scales and then clips at 65,535, so a gain above 1 can clip the open gate and the rebate, the very pixels that set the zero.
- **A colour matrix** mixes channels: s′_k = Σ_c m_kc s_c. The result is still linear in light, but its responsivity Σ_c m_kc P_c(λ) has negative lobes. The channel density is then no longer a weighted soft minimum of D(λ) (textbook §1.3), the solve's forward model is wrong, and the channels' noise is mixed together.
- **A tone curve** g makes the value nonlinear. Then g(s)/g(s_reb) ≠ s/s_reb, and dividing by the rebate no longer gives a transmittance.

So scan mode delivers camera channels that are linear, black-subtracted, white-normalised, without white balance and without a matrix. That is what "raw channels" means in this ticket. A lab scan delivered as JPEG or sRGB TIFF can still be opened, but the scanner model will then be wrong (`C1/various/analysis-chromogen-studio.md` §1.2). The app must say so through a diagnostic rather than pretend otherwise.

### 2.3 Density relative to the rebate, the base and the open gate

A negative has a **base**: support, orange mask and fog, present everywhere. The **rebate** is the unexposed processed edge of the film, and it shows the base alone. Densities are measured relative to it:

```text
D_k = −log₁₀(T_k / T_reb,k)
```

Textbook §1.6 (lines 190–211) proves this is exact. Subtracting the rebate's channel density equals reading the dyes alone through a base-weighted channel. On the white-LED example the two sides agree to 3×10⁻¹⁶. CHB-003 then adds the stock's own base reading, D_base,k = `channels.read(stock.base)` (`05-inline.js` 653), to restore the absolute scale the forward model expects. That step **assumes the scan's rebate is the stock's base**.

The assumption can be checked only if we know how bright the light is with no film at all. That is the **open gate**, T = 1. With an open-gate reading, the rebate's absolute density is D_reb,k = −log₁₀(T_reb,k / T_open,k). It can then be compared with the model's D_base,k. The textbook's `program.js` warns when the two differ by more than 0.02 D in any channel: the stock or the flat field is wrong (§3.1, line 724).

Through Chromogen's illustrative X-T5 channels (Gaussian LEDs at 678/532/472 nm with 20 nm FWHM, times the generic camera), the bundled profiles' bases read as follows. These were computed for this guide from `st-data/cg` with `channels.js`'s formula.

| stock | D_base (R, G, B) | max difference from Gold 200 |
|---|---|---|
| Kodak Gold 200 | 0.282, 0.643, 0.840 | — |
| Fujifilm C200 | 0.274, 0.649, 0.819 | 0.020 |
| Kodak Portra 800 | 0.243, 0.610, 0.845 | 0.039 |
| Kodak UltraMax 400 | 0.259, 0.603, 0.827 | 0.040 |
| Kodak Portra 400 | 0.211, 0.659, 0.779 | 0.072 |
| Kodak Ektar 100 | 0.202, 0.634, 0.778 | 0.080 |
| Kodak Portra 160 | 0.199, 0.653, 0.796 | 0.083 |
| Fujifilm Pro 400H | 0.188, 0.744, 0.934 | 0.101 |

Two lessons follow:

- Ranking stocks by their rebate can narrow the candidates but never name the stock. Gold 200 and C200 are 0.02 D apart. The textbook's limit (§3.8, line 973) is that the scan cannot name its stock; the rebate's colour, the edge print or the user must.
- Ranking needs absolute densities, so it needs an open gate.

The Gold 200 sample has none. Its "T" is raw counts divided by 4,000, a scale rather than an open-gate measurement. Taken naively, its rebate would read (0.919, 0.168, 0.670), which bears no relation to any stock.

Where does an open-gate reading come from?

- **Best:** a part of the same capture where no film is in the light path, such as the sprocket holes of 135 film or the gap of a film holder. It has the same exposure and the same flare.
- **Second:** the flat field, if it was captured at the same exposure settings (or with a recorded exposure ratio).
- **Otherwise:** there is no open gate, and flare correction, the base check and stock ranking are disabled with a diagnostic.

### 2.4 Uneven light and the flat field

No lamp and lens light the gate evenly. The camera records L_k(x)·T_k(x), where L is the illumination at sensor position x. A **flat field** is a capture of L alone, with no film, taken with the same lens, aperture, focus and exposure as the scans (Chromogen book chapter 10, `C1/various/extracted/chromogen-studio/st-data/book/10-ch10.md` "Sources"). The correction is a division, and four choices make it work (textbook §3.1, lines 732–744; Chromogen `flatGrid`, `05-inline.js` 2453–2499):

1. **Average the flat over a coarse grid:**
   - 96 cells along the long side ("Smooth") keeps the light and lens fall-off.
   - 512 cells ("Fine") also keeps small marks.

   A 1,292×863 capture puts about 180 pixels in each of 96×64 cells, which averages the flat's own noise away.
2. **Smooth with [1 2 1]/4, along x then along y:** twice for grids of up to 200 cells, once above. Two passes make the five-tap binomial kernel (1, 4, 6, 4, 1)/16.
3. **Divide each channel by its mean and floor at 0.05.**
   - Dividing by the mean leaves the frame's exposure alone, because the rebate is divided by the same grid.
   - The floor stops the dark border of a film holder from becoming an enormous transmittance.
4. **Divide in sensor coordinates,** before flipping, rotating or cropping. The illumination belongs to the sensor, not to the film. `Source.region` maps each output pixel back to the source pixel under its centre and reads the grid there bilinearly (`flatAt`, 2500–2507).

The law that tests it (textbook §3.9, line 991) is: multiply the Gold 200 frame by a vignette that falls 0.26 D towards the corners, divide by a flat of the same vignette carrying ±1 % noise, and every density returns to within **0.0006 D** of the untouched frame.

What uneven light does without a flat shows on the sample itself (textbook §3.5, lines 911–913):

- Take the 1st percentile of each channel's density in 25-pixel bands across the frame (the **shadow floor**).
- Next to the rebate it is (−0.022, −0.017, −0.031) D. That is within 0.003 D of where noise alone puts it, −2.33σ_k.
- Towards the middle it falls to (−0.053, −0.060, −0.069) D: 0.03 to 0.04 D lower than noise explains.
- The rebate strip itself is 0.021 D denser at its top than its mean.

The light was stronger in the middle of the gate, and no flat was captured.

### 2.5 Flare

Light scattered inside the lens and holder adds a fraction f of the open-gate signal to every pixel. The camera records T + f where the film transmits T (textbook §3.1, lines 726–730). Above the rebate this reads

```text
D′_k = −log₁₀((T_k + f) / (T_reb,k + f))
```

The error grows with density and is largest where the rebate transmits least: blue, behind the orange mask. With f = 0.5 %, the textbook's white patch falls from 1.429 to 1.172 D above the rebate in the narrowband blue channel. After the solve and the inverse curves, its blue layer then reads 0.38 log H too little exposure, more than a stop.

Flare is measured with a **neutral step wedge**, a strip of steps whose spectral density is flat (§3.7, line 957). With f = 0.5 %, steps of 0, 0.5, …, 3 D read 0, 0.495, 0.981, 1.438, 1.826, 2.090 and 2.224. A least-squares fit of D′ = −log₁₀((10^(−d) + f)/(1 + f)) to those readings, with 0.005 D of noise, recovers f = 0.00503.

Two consequences shape the design:

- f is a fraction of the **open-gate** signal. The correction T = T′(1 + f) − f needs values normalised to the open gate (T′ = 1 at the open gate). Without an open gate there is no flare correction.
- Real veiling glare depends on how much of the field is lit. A constant f is a model of one setup, valid for a similar surround. CHB-013 measures it per setup.

Chromogen does not model flare at all, and the textbook notes the same of `program.js` (§3.1).

### 2.6 Noise in the density domain

If the measured transmittance has noise σ_T, the density noise is

```text
σ_D ≈ σ_T / (T ln 10) = 0.434 σ_T / T          (Dainty & Shaw; textbook §1.7, line 219)
```

One more unit of density means ten times the noise for fixed σ_T. The dense parts of a negative are the scene's highlights, so the highlights are the noisy part of a scan.

**The robust estimator.** Dust and hot pixels put a few samples far from the rest, and the standard deviation follows them. The **median absolute deviation** does not. For Gaussian data σ̂ = 1.4826 · median|x − median(x)| (§1.7, line 227). One sample at 50σ among 81 moves the standard deviation from 1.08 to 5.62 but the MAD estimate only from 1.10 to 1.12.

**The leave-one-out local mean.** Chromogen's `sigmaD` (`05-inline.js` 2508–2537) compares each pixel's density with the mean of the *other* pixels in its 9×9 window (radius R = 4). It takes 1.4826 × the median departure. Two choices in it need a reason (§1.7, lines 249–263):

- Leaving the pixel out makes the departure's variance σ²(1 + 1/80). The estimate is therefore high by √(81/80) = 1.0062 (measured 1.0063). A local mean also absorbs smooth gradients such as uneven light.
- Differences of neighbours would be the obvious alternative, but they assume neighbouring pixels are independent. Resampling makes them dependent. When the reduction factor is not an integer, neighbouring footprints share source columns. The textbook's simulation (estimate divided by truth):

| reduction | neighbour differences | 9×9 leave-one-out mean |
|---|---|---|
| 1.000 | 1.000 | 1.006 |
| 0.700 | 0.754 | 0.966 |
| 0.500 | 0.999 | 1.005 |
| 0.3125 (2048 → 640) | 0.876 | 0.994 |

Noise correlated over two pixels, as after demosaicing, reads 0.706 by neighbour differences and 0.983 by the local mean.

**σ depends on resolution.** Averaging pixels averages noise. On the Gold 200 rebate box σ is:

- (0.0090, 0.0069, 0.0122) D at the full 1,090×754 frame size;
- (0.0043, 0.0033, 0.0057) D at the 640-pixel size where Chromogen computes its statistics (§3.5, line 896).

A simple footprint-area rule does not predict the second from the first (it gives 0.0053 for red). σ must therefore be **measured at the scale it is used**, not derived.

Two implementation details:

- Chromogen's summed-area tables are `Float64Array` (2516). In f32, a running sum over 10⁷ pixels loses all digits below about 1, and the box sums become useless.
- If there is no rebate box, σ comes from "thin" frame pixels (D < 0.08 in every channel). If there are too few of those, it falls back to an assumed 0.01 (2614–2620).

### 2.7 Blank film, below base, out of gamut, and conditioning

The dye solve flags a pixel **unreachable** when its residual exceeds 0.01 D, meaning no dye amounts reproduce it. A residual says a pixel does not fit, not why (textbook §3.5, lines 874–916). `classify` (`05-inline.js` 2539–2543) puts each channel's density above the rebate in noise units, z_k = D_k/σ_k, with Z = 3:

- **below base:** min z < −3. A channel is lighter than unexposed film by more than noise explains. The cause is uneven light or a badly picked rebate.
- **blank film:** otherwise, min z ≤ 3. Some layer recorded nothing.
- **out of gamut:** otherwise, if the residual is above 0.01 D. Every layer formed dye and nothing fits, so the scanner profile or the stock is wrong.

The order matters: below beats blank, and both beat gamut. Percentages on Gold 200 depend on the size at which they are computed (§3.5, line 900):

| size | blank | below base | out of gamut | unreachable (table) | unreachable (exact) |
|---|---|---|---|---|---|
| 640×443 | 12.6 % | 9.7 % | 0.05 % | 19.3 % | 13.7 % |
| 1,090×754 | 21.5 % | 7.2 % | 0 | 21.8 % | 17.1 % |

A percentage reported without its image size is meaningless. The ingest API therefore always returns statistics with their scale.

**Conditioning.** How much the solve amplifies density noise into dye noise is set by the smallest singular value σ₃ of the forward model's Jacobian J (textbook §3.2, line 780). Near the solution δc ≈ J⁻¹ δd, so the gain is at most 1/σ₃:

- **Narrowband LEDs:** σ₃ stays between 1.087 and 1.143 over the whole dye cube [0, 2.4]³, so noise is not amplified.
- **White-LED camera:** σ₃ is 0.36 at the base and 0.305 at the grey card, and falls to **0.034** at dense yellow with no cyan or magenta. There a density error is amplified **29 times**.

`program.js` warns when σ₃ is below 0.05. Chromogen's Studio table skips the computation (`sigma: false`, `05-inline.js` 1672). A per-pixel **conditioning map** of 1/σ₃ shows the photographer and the agent where the inversion is noisy for physical reasons, not because of a bug.

### 2.8 Dust, in density

A dust particle on the negative is nearly opaque. If it covers a fraction a of a pixel's footprint, the measured transmittance is (1 − a)·T in **every** channel, so the scanner density rises by the same amount everywhere:

```text
Δ = −log₁₀(1 − a)        e.g. a = 0.5 → Δ = 0.301 D in R, G and B alike
```

In density, dust is an additive, **neutral** bump, whatever the colour of the film under it. Image detail is different: a change in dye amounts changes the three channels by different amounts, because the dye spectra differ, and grain clouds are independent per layer. So density is the natural domain for detecting dust:

- the residual against a smooth background is additive;
- neutrality separates dust from grain and from image detail;
- healing by adding or removing density is physically the right operation.

Dedicated film scanners often add an **infrared** channel. The dyes are transparent in infrared and dust is not, so the IR density is a dust map directly (Digital ICE). It fails for silver black-and-white film, which blocks infrared. Chromogen silently drops a fourth sample (`05-inline.js` 2321); ingest keeps it.

goja-cv, a Go image API built for agents (`~/code/wesen/go-go-golems/goja-cv`), was designed around film-scan dust. Its detector and its heal are the material to port (§4.4).

## 3. How it fits the system

### 3.1 The pipeline

```text
 file bytes ──► sha256 ──► SourceRef { sha256, path }
      │ sniff magic bytes
      ├──► decode/tiff (TIFF, LinearRaw DNG)   ├──► decode/png16
      ├──► libraw/ (worker, camera RAW, CFA or compressed DNG)
      └──► decode/browser (8-bit JPEG/PNG/WebP, last resort)
                    │  RawImage: native samples, levels, encoding + evidence, metadata
                    ▼  linearise (LUT per sample)
      camera-linear, sensor coordinates   [ + triplet merge ]       photo mode ──► source.xyz ──► scene-xyz (CHB-012)
                    │ scan.flatField   ÷ grid at the sensor position
                    │ open gate        ÷ T_open (sprocket holes or flat mean); no-op for density, needed for flare
                    │ scan.flare       T = T′(1 + f) − f
                    │ orient + crop + area resample, all on linear values
                    ▼
      camera-linear at evaluation scale s
                    │ scan.rebate → T_reb       scan.noise → σ(s)
                    │ scan.density: D_k = −log₁₀(T_k / T_reb,k)
                    ▼
      scanner-density ──► scan.specks / scan.heal ──► invert.dyes (CHB-003) ──► film-dyes
                    │                                        │ residual
                    └──► scan.baseClass (z = D/σ) ──► invert.classify (CHB-003)
                                                    scan.conditioning (1/σ₃ at the solved dyes)
```

Dividing by the open gate changes no scanner density, because the rebate is divided by the same number. It matters only for flare and for the absolute base comparison.

### 3.2 Domains, ops and recipe fields

The architecture's catalog (§5.2) gives the `source` and `scan` areas to this ticket:

| op | on → returns | domains | recipe path | binding time |
|---|---|---|---|---|
| `source.open` | — → Image | file → `camera-linear` | `source` | scan |
| `source.info` | Image → Value | — | — | scan |
| `scan.flatField` | Image → Image | `camera-linear` → `camera-linear` | `scan.flat` | scan |
| `scan.flare` | Image → Image | `camera-linear` → `camera-linear` | `scan.flare` | setting |
| `scan.rebate` | Image → Value | `camera-linear` | `scan.rebate` | scan |
| `scan.density` | Image → Image | `camera-linear` → `scanner-density` | — | pixel |
| `scan.noise` | Image → Value | `camera-linear` | — | scan (per scale) |

Section 5.12 proposes the missing ones: `source.xyz`, `scan.baseClass`, `scan.conditioning`, `scan.rankStocks`, `scan.specks`, `scan.heal` and `scan.checkDust`.

The recipe's `source: { path, sha256, decode: DecodeOptions }` and `scan: { scanner, stock, rebate, flat?, flare?, orientation, crop? }` (architecture §5.4) are where ingest's persistent choices live. Changing the encoding, the rebate box or the flat is a **mutation**: an edit in the edit log, which the user or the agent can see and undo.

### 3.3 Dependencies and parallel work

- **Depends on CHB-002** for the contract types. Until they exist, define local types with the names used here and swap them out later.
- **Is depended on by:**
  - CHB-003 (scanner density in, residual back for the classes);
  - CHB-005 (flat grid, T_reb, flare and σ as GPU inputs; the dust WGSL);
  - CHB-009 (the Source panel);
  - CHB-012 (photo mode);
  - CHB-013 (calibration builds on `flatGrid`, `sigmaD`, `fitFlare` and `rankStocks`).
- **Stubs that let it proceed in parallel:**
  - The decoders and the flat, rebate and σ code need nothing but bytes, so they can start on day one.
  - Stock ranking and the conditioning map need the spectral forward model of CHB-003. They take it through an injected `ScannerForward` interface (DR-9), which a 20-line stub using Chromogen's `channels.js` maths can implement until CHB-003 lands.
  - Synthetic negatives with planted dust can be generated locally until CHB-004's synthetic frames exist.

**Milestones.** M1 ("a 16-bit TIFF opens") needs the TIFF decoder of stage 1. M3 ("the Gold 200 sample end to end") needs stage 3. M5 (the beta with the photographer's RAWs) needs stage 2 (LibRaw). A sensible order is therefore stage 1, then stage 3, then stage 2, with stage 4 alongside.

## 4. What exists today and what to take from it

### 4.1 Chromogen `decode.js` (`05-inline.js` 2195–2413)

| lines | function | what it does | verdict |
|---|---|---|---|
| 2196–2200 | `inflate` | zlib via `DecompressionStream` | port |
| 2201–2243 | `lzw` | TIFF LZW with early change; dictionary entries are JS arrays | port the logic; rewrite with typed prefix/suffix tables for speed |
| 2244–2258 | `packbits` | PackBits | port |
| 2259–2335 | `decodeTIFF` | II/MM, IFD walk with SubIFDs (2277–2284); picks the largest full-resolution IFD (2285); strips or tiles; chunky or planar; 8/16/32-bit; LZW/Deflate/PackBits; predictor 2 for 8/16-bit (2308–2312); refuses CFA (2289) | port, fix (§4.2) |
| 2336–2388 | `decodePNG` | own decoder so all 16 bits survive; all five filters; refuses palette and interlace | port, fix the encoding hint |
| 2389–2402 | `decodeBrowser` | `createImageBitmap` with `colorSpaceConversion: 'none'`; 8-bit | keep as last resort |
| 2403–2412 | `decodeFile` | dispatch on magic bytes; refuses `.raf .nef .cr2 …` with export instructions (2410) | replace by a decoder registry with LibRaw for RAW |
| 2413 | `srgbDecode` | the sRGB transfer | port |

`mergeTriplet` (2419–2427) combines three exposures. Channel k comes from file k's own channel k ("own" mode). Files are sorted by name (`openFiles`, 3928), so DSCF4457/58/59 become R, G, B.

### 4.2 Known bugs to fix

The first three are in the analysis report (`C1/various/analysis-chromogen-studio.md` §1.1 and §6.3 item 6). The rest were found while reading the code for this guide.

1. **32-bit integer TIFF divides by zero.** `maxv = fmt === 3 ? 1 : (1 << bits) - 1` (2296). In JavaScript `1 << 32 === 1`, so `maxv` is 0. Use `2 ** bits - 1`.
2. **16-bit PNG defaults to sRGB.** `encodedHint: "srgb"` (2387) is set for every PNG. Chromogen's own book says linear is the default for 16-bit files. See DR-2 for the rule that replaces it.
3. **sRGB values are averaged before being linearised.**
   - `region()` sums encoded values over a footprint and applies the transfer `f` to the mean (2572–2582).
   - `flatGrid` does the same per cell (2467).

   Linearise per sample first (DR-1).
4. **Half-float TIFF.** With SampleFormat 3 and 16 bits, `maxv` is 1 and the sample is read with `getUint16`, so a value of 1.0 arrives as 15,360. Decode IEEE half or refuse.
5. **Predictor 3 (floating point) is ignored silently.** Predictor 2 on 32-bit integers is also never undone. Undo both or refuse with `E_FORMAT`.
6. **Signed and rational tag types.**
   - SSHORT and SLONG are read as unsigned.
   - SRATIONAL (type 10) falls through to a one-byte read. DNG colour matrices are SRATIONAL, so a port that reads them must fix this.
   - Type 13 (IFD) is missing from the size table `SZ`. With two or more SubIFDs of type 13, their offsets are read from the wrong place.
7. **DNG levels are ignored.** BlackLevel, WhiteLevel, LinearizationTable, ActiveArea and DefaultCrop are skipped, and values are divided by 2^bits − 1.
8. **The fourth sample is dropped** (`if (ch > 2 && spp > 1) continue`, 2321), which loses a scanner's infrared channel.
9. **Predictor 2 on uncompressed strips writes into the caller's file buffer** (`data` is a view on `buf`), so decoding the same buffer twice gives different values.
10. **Short strips are skipped silently** (`if (p + bps > data.length) continue`, 2323), leaving zeros.
11. **The Orientation tag is ignored.** For scans this is acceptable, because the user orients the negative. For photo mode it is not.

### 4.3 Chromogen `source.js` (`05-inline.js` 2415–2692)

| lines | function | verdict |
|---|---|---|
| 2416–2418 | `FORMATS`, `WORK` = 2048, `GLOBAL` = 640 | the scales become `EvalTarget.scale`; formats become `scan.format` (proposed) |
| 2428–2450 | `orient` | port; it maps oriented coordinates to sensor indices |
| 2453–2499 | `flatGrid` | port; linearise before the cell average; keep the open-gate mean it discards |
| 2500–2507 | `flatAt` | port as is |
| 2508–2537 | `sigmaD` | port as is (f64 summed-area tables, n ≥ 9, ≥ 60 departures, floor 1e-4) |
| 2538–2543 | `Z_NOISE`, `classify` | split: base classes here, gamut in CHB-003 (§5.12) |
| 2559–2593 | `region` | port with the linearise-first fix; the flat is applied at the footprint's centre |
| 2595–2605 | `flat()` | the aspect check returns `null` silently (2598); make it a diagnostic |
| 2608–2621 | `noise()` | port: rebate box first, then thin frame pixels, then assumed |
| 2628–2645 | `rebate()` | port the box mean (2630–2637); replace the automatic percentile (2638–2644, 99.7th percentile × 1.02 of a 256-px-wide frame) by region detection (§5.8) |
| 2652–2665 | `working()` | the idea of caching per geometry and scale survives as engine caching by node id |
| 2679–2692 | `loadSample` | becomes ordinary decoding with declared levels (§6) |

The state code shows two more things to leave behind:

- **Flats are session-only.** `openFlat` (4281–4306) stores the flat under a random id in a `FLATS` map, and the recipe stores its name but not its data.
- **Autosave is keyed by file name** (`addFrame`, 3955), so a different scan with the same name inherits the old crop and rebate.

Both are fixed by content hashes: a flat is a `SourceRef` with its own SHA-256, and frames are keyed by the source hash.

### 4.4 goja-cv: decoders and dust (`~/code/wesen/go-go-golems/goja-cv` at `5a93095`)

**Decoders** (`pkg/cv/buffer/`) are worth comparing for their discipline:

- `decode.go` 41–48 defines a `Decoder` interface with `Sniff`, `Probe` (header only) and `Decode`. Unsupported features are a typed `FormatError`, which surfaces as `E_FORMAT` naming the feature (69–86).
- `Linearize` (167–203) converts integer sRGB files through exact 8- and 16-bit tables **per sample at load**, before any pyramid averaging. That is the order Chromogen gets wrong.
- `decode_tiff.go` refuses tiles, planar data, BigTIFF, signed integers, non-32-bit floats, the predictor on floats and LinearizationTable, each with a message (352–467). It applies DNG BlackLevel/WhiteLevel per channel (489–502, 515–527, 623–642) and prefers the LinearRaw image among IFDs and SubIFDs (270–347).
- `decode_std.go` 27–104 reads the PNG chunks the Go standard library ignores (gAMA, sRGB, its own tEXt metadata). Its default is still sRGB.
- `pkg/cv/ops/realdata_test.go` 145–199 opens a 1024² window of a 7,256×7,326 VueScan LinearRaw DNG in under a second, and checks the window against a full decode.
- `internal/testimage` can write synthetic DNGs (`decoders_test.go` 231–240 uses `WriteDNG` with `CFA: true` to test the refusal).

Take goja-cv's strictness: refuse what cannot be decoded exactly, naming the feature. Take its level handling and its linearise-at-load order. Take Chromogen's broader coverage: tiles and planar data, which goja-cv refuses.

**Dust** (`pkg/cv/kernels/`, `pkg/cv/ops/`):

- `kernels/specks.go`:
  - `SpeckBackground` (96–125) estimates a speck-free background with a Gaussian prefilter, then twice: a trend Gaussian of 2r, odd-reflection padding, a square opening and closing of (2r+1)², and a box mean of r/2.
  - `DetectSpecks` (156–277) thresholds the residual with hysteresis: high = max(minContrast, k·σ) with k = 4, low = max(high/2, 2.5σ), where σ is the residual's MAD. It labels components and keeps those of area ≤ maxArea. It scores each by contrast over local ring noise and by sharpness (fill factor: about 0.3 for soft blobs, 0.5 and above for dust): score = smoothstep(k−1, k+4, snr) × smoothstep(0.33, 0.45, sharpness).
- `kernels/heal.go` 22–78 grows the targets by a margin, then per component either copies the best-matching nearby patch with a seam correction (membrane cloning, which keeps grain) or fills harmonically (pull-push start, SOR iterations).
- `kernels/peaks.go` 14–24 and `ops/peaks.go` 62–90 find spots as local maxima of a core/ring step at several radii.
- `ops/detect.go` 49–111 defines `detect.specks` (defaults maxArea 200 px², minContrast 0.03) and `check.dust` (verdicts clean / light / dusty, `DustScore` 0.5).
- `ops/composite.go` 107–129 defines `heal` with `radius` (margin) and `method` patch/diffuse.

The tests to port:

- `ops/heal_test.go` 61–119:
  - healed specks within 1.5σ of the background;
  - nothing changed outside the grown targets;
  - `check.dust` ≤ 1 after healing;
  - patch keeping more than twice the high-pass σ of diffuse.
- The real-data tests are environment-gated on human-labelled tiles (`peaks_gold_test.go` 15–26). They compare two methods on the same points in one run rather than asserting counts.

The DUST-002 tiles stored **density as code values** (`realdata_test.go` 58–63), so goja-cv's dust work already ran in density. What it lacked was a physical reason. §2.8 gives one: neutrality.

### 4.5 LibRaw compiled to WebAssembly

LibRaw is the standard C library for camera RAW files (the current release is 0.22.3, per libraw.org/download). It is dual-licensed LGPL 2.1 or CDDL 1.0. Existing browser builds:

| build | API | notes |
|---|---|---|
| `libraw-wasm` on npm (github.com/ybouane/libraw-wasm) | `new LibRaw()`; `open(bytes, settings)`; `metadata(full)`; `imageData()`; `rawImageData()` → `{raw_width, raw_height, width, height, top_margin, left_margin, data: Uint16Array}` | runs in its own Worker; settings mirror LibRaw's (`userMul`, `gamm`, `noAutoBright`, `outputBps`, `outputColor`, `adjustMaximumThr`, `userBlack`, `noInterpolation`, `halfSize` …); the README recommends the author's newer FlashRaw |
| `@colorhythm/libraw-wasm` (github.com/colorhythm/libraw-wasm) | `LibRaw.initialize()`; `open`; `unpack`; `getRawImage` / `getColor3Image` / `getColor4Image` (owned `Uint16Array`s); `getBlackLevel(i)`, `getLinearMax()`, `getColorMaximum()`; `getCamXyz()`, `getRgbCam()`, `getCamMul()`, `getPreMul()`; `getFilters()`, `color(r, c)`; `dcrawProcess()`, `dcrawMakeMemImage()`; `LibRaw.version()`; errors as `LibRawError` with LibRaw's numeric code | maintained TypeScript fork of TOMIKAWA Sotaro's libraw.wasm; MIT wrapper; advises a dedicated Worker and transferring the input buffer; only `setHalfSize`, `setUseCameraWb` and `setOutputColor` are documented as setters |
| `dcraw-wasm` (github.com/nhebling/dcraw-wasm) | dcraw command line | dcraw, not LibRaw; not maintained for new cameras |

The LibRaw fields that matter (LibRaw API docs, "Data structures"):

- `rawdata.raw_image`: one-component CFA data. `color3_image`/`color4_image` are used for full-colour layouts. Only one is non-null after `unpack()`.
- `color.black` and `color.cblack`: per-channel offsets in [0..3], a pattern size in [4] and [5], and pattern values from [6].
- `color.maximum`: the white level.
- `color.linear_max`: the per-channel linear maximum from file metadata.
- `color.cam_xyz`: XYZ to camera (Adobe's matrix for non-DNG files).
- `color.rgb_cam`, `color.cam_mul` (as shot), `color.pre_mul` (daylight).
- `color.dng_color` and `color.dng_levels`.
- `idata.filters` and `idata.xtrans[6][6]`.
- Output parameters: `output_color` (0 = raw camera colour, then sRGB, Adobe, Wide, ProPhoto, XYZ, …), `user_mul`, `gamm[0..1]`, `no_auto_bright`, `output_bps`, `adjust_maximum_thr` (below 0.00001 disables the maximum adjustment), `no_interpolation`, `user_qual` (0 linear, 1 VNG, 2 PPG, 3 AHD, 4 DCB, …) and `half_size`.

## 5. Design

### 5.1 Module layout

```text
packages/ingest/
  src/
    index.ts                 public API (openSource, conditioning functions, dust)
    decode/
      identity.ts            sha256 of bytes; triplet identity
      registry.ts            Decoder interface, sniffing, routing to LibRaw
      tiff.ts                TIFF + LinearRaw DNG (port of decodeTIFF with fixes)
      lzw.ts packbits.ts     codecs
      png16.ts               PNG 8/16 with chunk evidence
      browser.ts             createImageBitmap fallback (8-bit only)
      linear.ts              RawImage → CameraLinear (levels + transfer LUT)
      triplet.ts             LED-role detection, merge, registration check
      encoding.ts            transfer functions, encoding evidence rules
    libraw/
      build/                 Emscripten build script and C shim (if a custom build is chosen, DR-4)
      adapter.ts             RawDecoder over the chosen WASM build
      worker.ts              the Worker: probe, scan mode, photo mode
      protocol.ts            message types
      colour.ts              camera → XYZ (DNG ColorMatrix interpolation, Adobe matrix)
    conditioning/
      resample.ts            orient + area average on linear values (port of region)
      flat.ts                flatGrid, flatAt, falloff, open-gate mean
      opengate.ts            sprocket/gap detection, open gate from flat
      flare.ts               fitFlare, removeFlare
      rebate.ts              box mean, automatic region detection, base check
      sigma.ts               sigmaD (leave-one-out MAD, f64 summed-area tables), shadow floor
      classify.ts            base classes from z = D/σ
      conditioning-map.ts    σ₃ table over dye space, per-pixel noise gain
      rank.ts                stock ranking from the absolute rebate density
      dust/
        specks.ts heal.ts    JS reference ports of goja-cv's kernels, in density
        wgsl/*.wgsl          dense kernels for the GPU engine (DR-10)
  test/                      unit, law and golden tests (vitest)
```

CHB-013 adds `src/calibration/` beside `conditioning/` for scanner-model fitting.

### 5.2 Source identity and declared encodings

**Identity.** `sha256 = hex(await crypto.subtle.digest('SHA-256', bytes))` over the file's bytes, never over decoded pixels. Two copies of the same file share an identity, and a re-export does not. The path is only the last known location: if a file moves, the recipe relinks by hash.

A triplet's identity is the SHA-256 of `"triplet:v1\n" + h_R + "\n" + h_G + "\n" + h_B`, with the roles in order. A flat field is its own `SourceRef`. Hashing is done once, in the Worker that reads the file. SubtleCrypto has no incremental API, but the whole file must be in memory for decoding anyway.

**Encoding evidence.** Every decoder returns the encoding it assumes **and why**. The evidence is one of: `declared` (from the recipe), `metadata` (our own tEXt or ImageDescription key, like goja-cv's `MetadataKey`), `chunk` (PNG sRGB/gAMA), `bit-depth`, or `format`. The rules:

| file | evidence | encoding |
|---|---|---|
| any | recipe `decode.encoding` set | as declared |
| PNG or TIFF with chromobench metadata | `metadata` | as written |
| PNG with an sRGB chunk, or gAMA ≈ 45455 | `chunk` | `srgb` |
| PNG with gAMA = 100000 (gamma 1.0) | `chunk` | `linear` |
| PNG with iCCP | `chunk` | `srgb`, plus a `W_ICC_IGNORED` note until CHB-011's lcms2 can read the curve |
| 16-bit PNG or TIFF, or any float TIFF, with no colour evidence | `bit-depth` | `linear`, plus a `W_ENCODING_ASSUMED` note |
| 8-bit PNG/TIFF/JPEG with no evidence | `bit-depth` | `srgb` |
| LinearRaw DNG, camera RAW | `format` | `linear` |

The chosen encoding is written into `FrameRecipe.source.decode.encoding` when the frame is added. The decision is then explicit, visible in the Source panel, and changeable only by a mutation.

### 5.3 Decoder types and API

```ts
// packages/ingest/src/decode/registry.ts (sketch)
import type { Diagnostic } from '@chromobench/contract';

export type Encoding = 'linear' | 'srgb' | 'gamma22';
export type Vec3 = [number, number, number];

export interface Levels {                       // in native sample units
  black: number[];                              // per channel
  white: number[];                              // saturation per channel
  from: 'file' | 'libraw' | 'default' | 'declared';
}

export interface RawImage {                     // what a decoder returns: stored samples, nothing interpreted
  width: number; height: number;
  channels: 1 | 3 | 4;                          // 4 only for RGB + infrared
  planes: Array<Uint8Array | Uint16Array | Uint32Array | Float32Array>;  // planar, sensor orientation
  sample: 'uint' | 'float'; bits: 8 | 16 | 32;
  levels: Levels;
  encoding: { value: Encoding; evidence: 'declared' | 'metadata' | 'chunk' | 'bit-depth' | 'format' };
  meta: SourceMeta;
}

export interface SourceMeta {
  format: 'tiff' | 'dng' | 'png' | 'raw' | 'image';
  orientationTag?: number;                      // TIFF/EXIF 1..8: reported; applied only in photo mode
  camera?: { make: string; model: string; iso?: number; exposure_s?: number; fnumber?: number };
  colour?: CameraColour;                        // photo mode only (§5.4)
  cfa?: 'bayer' | 'xtrans' | 'none';
  notes: Diagnostic[];                          // W_ENCODING_ASSUMED, W_CLIPPED, …
}

export interface Decoder {
  readonly name: 'tiff' | 'png16' | 'libraw' | 'browser';
  sniff(head: Uint8Array, fileName?: string): boolean;
  probe(bytes: ArrayBuffer): Promise<SourceInfo>;             // header only
  decode(bytes: ArrayBuffer, o: DecodeOptions): Promise<RawImage>;
}
```

`SourceInfo` and `DecodeOptions` are contract types, proposed in §5.12.

**Routing.**

- TIFF magic (`II*\0` or `MM\0*`) goes to `tiff.ts`, unless the file is a DNG whose chosen image is CFA, or whose compression is not none, LZW, Deflate or PackBits. That includes lossless JPEG (7), lossy JPEG (34892) and JPEG XL. Those go to LibRaw.
- A PNG goes to `png16.ts` for both 8- and 16-bit, so that chunks are always read.
- RAW extensions and RAW magic go to LibRaw.
- Anything else goes to `browser.ts`, which only ever returns 8-bit sRGB.
- An unsupported feature is `E_FORMAT` with the feature named: tiles in a strip-only path, a 12-bit packed TIFF, an interlaced PNG and so on.

**The TIFF port.** Keep Chromogen's structure: IFD walk, SubIFDs, the largest full-resolution IFD, strips or tiles, chunky or planar. Apply the fixes of §4.2. Read DNG tags into `RawImage.levels` and `meta`:

- BlackLevel 50714, BlackLevelRepeatDim 50713, WhiteLevel 50717;
- ActiveArea 50829, DefaultCropOrigin and DefaultCropSize 50719–50720;
- LinearizationTable 50712: apply it through the LUT;
- ColorMatrix1/2 50721–50722, CameraCalibration1/2 50723–50724, AnalogBalance 50727, AsShotNeutral 50728, BaselineExposure 50730;
- CalibrationIlluminant1/2 50778–50779, ForwardMatrix1/2 50964–50965.

Keep a fourth sample as the infrared plane when ExtraSamples or the photometric interpretation allows it.

**Linearisation without a memory cost (DR-1).**

```ts
// packages/ingest/src/decode/linear.ts (sketch)
export interface CameraLinear {
  readonly width: number; readonly height: number; readonly channels: 3 | 4;
  readonly sha256: string;
  /** Linear values of channel c on sensor row y into out[0..width): 0 = black level, 1 = white level. */
  row(c: number, y: number, out: Float32Array): void;
  readonly clipped: Uint8Array | null;          // per pixel: 1 if any channel reached its white level
}
export function linearise(img: RawImage, o: DecodeOptions): CameraLinear;
```

For 8- and 16-bit samples, `linearise` builds one `Float32Array` LUT per channel (65,536 entries). Each entry is `transfer((u − black) / (white − black))`, with any DNG LinearizationTable folded in. The native integer planes stay as they are. A 100-megapixel RGB scan then costs 600 MB as `Uint16Array` instead of 1.2 GB as `Float32Array`, and every sample is linear before anything averages it. Float samples are transferred arithmetically.

**Triplets.** `triplet.ts` takes three `CameraLinear` images:

- It checks that their sizes agree.
- It assigns roles from the data, not from file names: an exposure's role is the channel with the largest share of the summed signal, and a disagreement with the name order is a warning.
- It merges in one of two modes:
  - `own`: channel k from exposure k's channel k, as Chromogen does.
  - `all-photosites`: a raw mosaic under narrowband light, where every photosite sees the same spectrum up to a gain (§5.4).
- It estimates the shift between exposures by phase correlation on a downsampled gradient image and warns (`W_TRIPLET_SHIFT`) above 0.5 px. Registering the exposures is listed as not built in Chromogen's book; here it stays a warning in v0.

### 5.4 LibRaw in a worker: scan mode and photo mode

LibRaw runs in a dedicated Worker so that a multi-second decode never blocks the UI. The caller transfers the file's `ArrayBuffer` (zero copy). The Worker hashes it, decodes it, and transfers the planes back.

```ts
// packages/ingest/src/libraw/protocol.ts (sketch)
export type RawJob =
  | { id: number; kind: 'probe'; bytes: ArrayBuffer }
  | { id: number; kind: 'decode'; bytes: ArrayBuffer; mode: 'scan'; bin: 'none' | 'cfa' | 'cfa-half' }
  | { id: number; kind: 'decode'; bytes: ArrayBuffer; mode: 'photo'; quality: 'fast' | 'ahd'; half: boolean };

export type RawReply =
  | { id: number; ok: true; sha256: string; info: RawInfo; planes: ArrayBuffer[] }
  | { id: number; ok: false; sha256?: string; error: Diagnostic };      // code 'E_FORMAT' or 'E_LIBRAW_<n>'

export interface RawInfo {
  libraw: string;                                         // LibRaw.version()
  rawSize: [number, number];
  visible: { x: number; y: number; w: number; h: number };
  cfa: { kind: 'bayer' | 'xtrans' | 'none'; period: 1 | 2 | 6; map: number[] };   // colour index per cell
  black: number[]; white: number; linearMax?: number[];
  camXyz?: number[][]; camMul?: number[]; preMul?: number[];
  dng?: DngColour;                                        // matrices, illuminants, AsShotNeutral, BaselineExposure
  flip: number;
  camera: { make: string; model: string; iso: number; exposure_s: number; fnumber: number };
}
```

**Scan mode** gives linear camera RGB with black and white levels, no white balance and no matrix. It bypasses `dcraw_process` (DR-5): LibRaw's processing path scales, white-balances, clips at 16 bits and demosaics, and none of that is wanted. Instead the worker calls `open` and `unpack` and reads `raw_image` (or `color3`/`color4` for full-colour layouts), then:

```text
scanMode(raw, info, bin):
  for each photosite (r, c) in the visible area:
      col = cfaColour(r, c)                                   // info.cfa.map, built with LibRaw's color(r, c)
      blk = black + cblack[col] + cblackPattern(r, c)         // cblack[6 + (r mod cblack[4])·cblack[5] + (c mod cblack[5])]
      v   = (raw[r][c] − blk) / (white − black − cblack[col]) // 1 = white level
      clipped(r, c) = raw[r][c] ≥ white   (or ≥ linearMax[col] when the file gives it)
  bin = 'cfa':       Bayer 2×2 → (R, (G1 + G2)/2, B);  X-Trans 6×6 → means of its 8 R, 20 G, 8 B
  bin = 'cfa-half':  X-Trans 3×3 → means of 2 R, 5 G, 2 B (each 3×3 sub-block holds all three colours)
  bin = 'none':      one full-resolution plane of photosites plus the CFA map (for all-photosite triplets)
  a binned pixel is clipped if any of its photosites is
```

Binning per CFA period gives true per-channel values without demosaicing, at a lower resolution. Chromogen's sample is exactly this: means over 6×6 X-Trans blocks of a Fujifilm X-T5, which is 7,728×5,152 photosites, giving about 1,288×860 pixels (book chapter 10).

Binning puts the colours' centroids at slightly different places within a block. That is irrelevant for the flat, the rebate and σ, and visible only at sharp edges. Demosaiced full resolution is available in photo mode, and through `all-photosites` for LED triplets.

**Why `all-photosites` works under narrowband light.** Under one LED, every photosite sees the same spectrum, scaled by its colour's sensitivity at that wavelength. The mosaic is then a monochrome image times a fixed gain per CFA colour.

- Summing the raw counts of all photosites in a block is near-optimal for photon noise and needs no demosaicing.
- At full resolution, divide each photosite by its colour's gain, measured on the flat field captured under the same LED, and weight by inverse variance. Photosites with almost no signal (blue under a red LED) then contribute little.
- The effective responsivity is the LED spectrum times a count-weighted mix of the camera curves. Because the LED is narrow, the camera curve is nearly constant across it and hardly affects the normalised P_k. CHB-013 relies on this.

**Photo mode** gives camera RGB converted to XYZ through the DNG or Adobe matrices, and feeds CHB-012:

```text
photoMode(file):
  LibRaw params: output_color = 0 (raw camera colour), user_mul = [1, 1, 1, 1], no_auto_bright = 1,
                 gamm = [1, 1], output_bps = 16, adjust_maximum_thr = 0, highlight = 0 (clip),
                 user_qual = 3 (AHD; X-Trans uses its own interpolation), half_size if requested
  dcraw_process → dcraw_make_mem_image → 16-bit linear camera RGB, black subtracted, 1 = white level
  M   = cameraToXyz(info)                 // f64, in TypeScript (colour.ts)
  XYZ = M · rgb                           // f32 planes; negative values kept
  return { scene-xyz planes, clipped mask, asShotNeutral, exposure metadata, orientation applied }

cameraToXyz(info):
  if DNG with two calibration illuminants:
      white  ← xy of AsShotNeutral, iterated about three times:
               CM(white) = interpolate(CM1, CM2) linearly in 1/CCT of white; xyz ∝ CM(white)⁻¹ · AsShotNeutral
      XYZtoCamera = AnalogBalance · CameraCalibration · CM(white)
      return inverse(XYZtoCamera)
  else:
      return inverse(cam_xyz)              // LibRaw's Adobe matrix, calibrated for D65
```

This follows the DNG specification's "Mapping Camera Color Space to CIE XYZ Space" (chapter 6). DNG 1.6 also allows a third calibration illuminant; handle two first and report a third with a note. The matrix is applied in TypeScript in float (DR-6), not with LibRaw's `output_color` = XYZ. That path applies `rgb_cam` and white balance and writes unsigned 16-bit, which clips the negative components that saturated colours legitimately have.

**White balance is not applied in photo mode.** A film records the scene's light as it is, and colour balance happens later, in printer lights (architecture §2, "Balance colour by shifting log exposure"). The as-shot neutral is delivered as metadata for CHB-012 to use or ignore. This is a proposal for CHB-012 to confirm.

**Bayer, X-Trans and pixel shift.**

- **Bayer:** `filters` is a 2×2 pattern, so bin 2×2. LibRaw demosaics in photo mode.
- **X-Trans:** `filters` is 9 and `xtrans[6][6]` gives the pattern. Bin 3×3 or 6×6 ourselves; LibRaw's `half_size` is defined for Bayer data.
- **Pixel shift** comes in three forms:
  1. **In-camera composites** (high-resolution modes that write one ordinary RAW): nothing special to do.
  2. **Vendor-merged files with full colour per pixel:**
     - Fujifilm's Pixel Shift Combiner writes a DNG RAW in which, per Fujifilm, "the demosaicing process is not necessary".
     - LibRaw's PixelShift2DNG makes such DNGs from Sony and Pentax files.
     - Sony's ARQ stores four values per pixel (R, G, B and a second G), as reported by LibRaw's developers.

     These arrive as `color3_image`/`color4_image` or as a LinearRaw DNG. Average the two greens and treat the result as unbinned full-colour data.
  3. **A sequence of separate RAW files** to be merged: not supported in v0. Refuse with a diagnostic that names the vendor tool.

  Whether a given combined DNG is tagged LinearRaw must be checked on a real file (§9).

**Choosing the build (DR-4).** Start with `@colorhythm/libraw-wasm` behind `adapter.ts`. It exposes the raw image, levels, `color(r, c)`, the matrices, typed errors and `LibRaw.version()`. Two things to verify in the first week of stage 2:

- whether it exposes the cblack pattern and the DNG colour block;
- whether it has setters for `user_mul`, `gamm`, `no_auto_bright`, `output_bps` and `adjust_maximum_thr`.

If not, fork it or build a pinned LibRaw 0.22 with a small C shim exporting exactly `RawInfo`. Either way the adapter interface stays the same, and LibRaw stays a separate `.wasm` file loaded at runtime, which keeps the LGPL relinking route open (§9).

### 5.5 Resampling on linear values

```ts
// packages/ingest/src/conditioning/resample.ts (sketch)
export interface Geometry { flipH: boolean; flipV: boolean; rotate: 0 | 90 | 180 | 270 }
export type Box = { x: number; y: number; w: number; h: number };

/** Area average of the oriented box to tw×th pixels, on linear values; the flat is applied at each
 *  output pixel's footprint centre, in sensor coordinates. Returns RGB(+IR) interleaved. */
export function region(src: CameraLinear, g: Geometry, box: Box, tw: number, th: number,
                       flat?: FlatField | null, flare?: { openGate: Vec3; f: Vec3 } | null): Float32Array;
```

This is Chromogen's `region` (2559–2593) with two changes:

- values come from `src.row`, already linear;
- after the flat, the optional open-gate normalisation and flare removal are applied: T′ = value / T_open, then T = T′(1 + f) − f, floored at 10⁻⁶.

Boxes and coordinates follow DR-7. Recipe boxes are stored in sensor coordinates and converted to oriented coordinates for display.

### 5.6 The flat field

```ts
// packages/ingest/src/conditioning/flat.ts (sketch)
export interface FlatField {
  sha256: string; detail: 'smooth' | 'fine';      // 96 or 512 cells on the long side
  gw: number; gh: number; grid: Float32Array;      // normalised illumination (mean 1, floor 0.05), RGB interleaved
  openGate: Vec3;                                  // mean linear value per channel before normalising
  falloffD: Vec3;                                  // log10(max / min) over cells above 0.2: the lit area's range in D
  sensor: { width: number; height: number };
  exposure?: { exposure_s?: number; iso?: number; fnumber?: number };   // from metadata, for open-gate use
}
export function flatGrid(flat: CameraLinear, detail: 'smooth' | 'fine'): FlatField;
export function flatAt(F: FlatField, u: number, v: number, out: Float64Array): void;   // u, v in [0, 1]
```

The port keeps Chromogen's grid, its passes (two for ≤ 200 cells, one above), the mean normalisation, the 0.05 floor and the falloff. It changes four things:

- it linearises before the cell average (§4.2, item 3);
- it keeps `openGate`, the pre-normalisation mean that Chromogen throws away;
- it records the flat's capture exposure;
- a shape mismatch is a diagnostic (`W_FLAT_SHAPE`) rather than a silent `null`.

The open gate from a flat is usable only if the flat's exposure matches the scan's, or the ratio is known from metadata. A triplet's flat is three captures merged the same way as the scan.

Dust on the camera's sensor appears at the same place in the flat and in the scan, so a Fine flat divides much of it out. Dust on the negative does not divide out; §5.11 handles it.

### 5.7 The open gate and flare

`opengate.ts` looks for open-gate pixels in the capture itself:

- the brightest 0.2 % of the scan, clustered;
- accepted only if their channel ratios match the flat's (light with no film has the light's colour, not the orange mask's);
- typically sprocket holes or a holder gap.

If none are found and the flat's exposure matches, it uses `FlatField.openGate`. If neither is available it emits `W_NO_OPEN_GATE`, and flare correction, the base check and stock ranking are off.

```ts
// packages/ingest/src/conditioning/flare.ts (sketch)
export interface WedgeReading { nominalD: number; Dmeas: Vec3 }    // per step, measured above the first step
export interface FlareFit { f: Vec3; q: number; rmsD: Vec3; steps: number }
/** Per-channel flare f_k and one shared density scale q (absorbs the wedge's calibration geometry),
 *  by Levenberg–Marquardt on D′ = −log10((10^(−q·d) + f) / (1 + f)), relative to the first step. */
export function fitFlare(readings: WedgeReading[]): FlareFit;
export function removeFlare(Tprime: number, f: number): number;  // T = T′(1 + f) − f, floored at 1e-6
```

A negative fitted f means the black level was over-subtracted. Report it rather than clamping silently. Flare lives in `scan.flare` as a number or a per-channel triple (proposed). CHB-013 fits it per setup.

### 5.8 The rebate, the base check and stock ranking

```ts
// packages/ingest/src/conditioning/rebate.ts (sketch)
export interface RebateEstimate {
  T: Vec3;                                  // mean linear transmittance of the rebate (after flat, open gate, flare)
  box: Box | null;                          // sensor coordinates
  from: 'box' | 'auto-region' | 'auto-percentile';
  confidence: number;                       // 0..1
  diagnostics: Diagnostic[];
}
export function rebateFromBox(src: CameraLinear, box: Box, cond: ConditioningInputs): RebateEstimate;
export function rebateAuto(src: CameraLinear, crop: Box | null, cond: ConditioningInputs): RebateEstimate;
export function baseCheck(rebate: RebateEstimate, openGate: Vec3, stock: string, fwd: ScannerForward):
  { measuredD: Vec3; modelD: Vec3; maxDiffD: number; warn: boolean };   // warn above 0.02 D
```

**The picked box** is ported as is: the mean of the box resampled to at most 64×64 (2630–2637). It is stored in sensor coordinates.

**The automatic rebate** is the current default and is the weakest part of Chromogen's chain. `rebate()` takes the 99.7th percentile × 1.02 of each channel of the frame resampled to 256 px wide (2638–2644). That is a bright percentile of the frame, not the rebate. On Gold 200 it gives T_reb = (0.1345, 0.7722, 0.2465), against the picked box's (0.1205, 0.6793, 0.2139). The zero sits 0.047, 0.056 and 0.062 D too light (computed for this guide with Chromogen's own `region` and `rebate` logic). Every density reads about 5σ too high at full size, so blank film is under-counted (book chapter 10 admits this) and below-base pixels vanish (§6).

The proposal is a region search. Its result is shown to the user as a box to confirm; the agent proposes it as a pending mutation in ask mode.

```text
rebateAuto(scan, crop):
  1. work on the oriented scan at ≤ 1024 px, in linear values (flat applied)
  2. candidates = pixels outside the crop box grown by 2 % (the frame's edge is blurred), excluding
     open-gate clusters (§5.7) and pixels within 0.05 D of the open gate
  3. texture filter: keep pixels whose local 5×5 density spread is ≤ 2 × the median spread
     (removes edge print, sprocket edges, holder edges)
  4. cluster the survivors by channel ratios (the orange mask has a stable colour); pick the largest
     cluster among those with the highest transmittance
  5. box = the largest axis-aligned rectangle inside the cluster; T = per-channel median of it
  6. confidence from: cluster area, uniformity (spread consistent with σ), and, when an open gate and a
     stock are known, agreement with the stock's base (≤ 0.05 D)
  7. no crop or confidence < 0.5 → fall back to the percentile, with W_REBATE_PERCENTILE explaining
     that blank film will be under-counted
```

**The base check and ranking** need the absolute rebate density D_reb,k = −log₁₀(T_reb,k / T_open,k). They also need each stock's base read through the scanner model, D_base,k(stock).

```ts
// packages/ingest/src/conditioning/rank.ts (sketch)
export interface ScannerForward {                 // injected; implemented by @chromobench/core (CHB-003), DR-9
  readonly scanner: string;
  readBase(stock: string): Vec3;                  // −log10 Σ P̂_k 10^(−base(λ))
  sigmaMin(stock: string, c: Vec3): number;       // smallest singular value of J at dye amounts c
}
export interface StockRank { stock: string; maxDiffD: number; rmsD: number; shapeDiffD: number; consistent: boolean }
export function rankStocks(rebateAbsD: Vec3, stocks: string[], fwd: ScannerForward): StockRank[];
```

`shapeDiffD` compares the channel differences after removing their mean. It helps when the open gate is known only up to a common factor, for example a flat at a different exposure without metadata. A stock is `consistent` at ≤ 0.02 D. The result is a sorted list shown as evidence. The app never chooses the stock, which the user names (architecture §2, rule "Three channels cannot recover…").

### 5.9 Noise σ

`sigma.ts` ports `sigmaD` as is: f64 summed-area tables, radius 4, leave-one-out mean, boxes with at least 9 neighbours, `null` below 60 departures, 1.4826 × the median departure, floor 10⁻⁴. The source order is also kept: the rebate box at the evaluation scale, then thin frame pixels (D < 0.08 in all channels), then assumed 0.01 × min(1, scale) with `W_SIGMA_ASSUMED`.

```ts
export interface NoiseEstimate { sigma: Vec3; from: 'rebate' | 'frame' | 'assumed'; scale: number; size: [number, number] }
export function sigmaD(rgb: Float32Array, w: number, h: number, Treb: Vec3,
                       keep?: (i: number) => boolean, R = 4): Vec3 | null;
export function shadowFloor(D: Float32Array[], w: number, h: number, bandPx = 25,
                            from: 'left' | 'right' | 'top' | 'bottom'): { band: number; p01: Vec3 }[];
```

σ is cached by (source hash, decode options, flat hash, rebate box, scale). For large frames, replace the full sort with a selection or histogram median. A test checks it against the sort to 10⁻⁷.

`shadowFloor` is the textbook's Figure 3.4 diagnostic: the 1st percentile of each channel in bands from the rebate edge. It is the cheapest test of whether a flat field is needed, and CHB-013's flat verification uses it.

### 5.10 Base classes and the conditioning map

```ts
// packages/ingest/src/conditioning/classify.ts (sketch)
export const Z_NOISE = 3;
export type BaseClass = 'below' | 'blank' | 'above';
export function baseClass(T: Vec3, Treb: Vec3, sigma: Vec3, Z = Z_NOISE):
  { cls: BaseClass; D: Vec3; z: Vec3; layers: number[] };    // layers: the channels below (or at) base
```

This is Chromogen's `classify` (2539–2543) without the residual. 'below' and 'blank' are decided by noise alone, and they take precedence over 'gamut' in Chromogen's rule. CHB-003's `invert.classify` therefore composes: `baseClass` first, then the residual test (> 0.01 D → gamut) for pixels classed 'above'. The class statistics always carry their image size.

**The conditioning map.** A 17³ table of σ₃ over the dye cube [0, 2.6]³ is built once per scanner × stock with `fwd.sigmaMin`. Binding time is per stock, so it is cheap. It is read trilinearly at each pixel's solved dye amounts and stored as a one-channel gain image 1/σ₃. A frame summary reports:

- the share of pixels with σ₃ below 0.05 (`W_ILL_CONDITIONED`, following `program.js`);
- the median gain.

Multiplying the gain by max_k σ_k gives an upper bound on dye noise per pixel, for the agent to quote.

### 5.11 Dust detection and healing in density

The port of goja-cv's detector works on full-resolution scanner density, after the flat and before the dye solve:

```text
detectDust(D_R, D_G, D_B, σ, opts {maxArea_px2 = 200, minContrastD = 0.03, k = 4}):
  1. neutral plane   N = Σ_k D_k/σ_k² / Σ_k 1/σ_k²        (minimum-variance estimate of a neutral bump)
  2. background      B = SpeckBackground(N, r), r = max(2, ⌈√(maxArea/π)⌉ + 2)   (goja-cv specks.go 96–154)
  3. residual        res = N − B; subtract its median; σ_res = 1.4826 · MAD(res)
  4. hysteresis      hi = max(minContrastD, k·σ_res); lo = max(hi/2, 2.5·σ_res); dust is DENSER (positive res)
  5. components      label lo-mask components (union-find); keep area ≤ maxArea and peak ≥ hi
  6. per speck       contrast = peak res; localNoise = MAD of res in a 3-px ring (excluding specks);
                     sharpness = Σ res / (peak · area);
                     neutrality = 1 − (max_k R_k − min_k R_k) / mean_k R_k, with R_k the speck's mean residual
                     in channel k against its own background;
                     score = smoothstep(k−1, k+4, contrast/localNoise) · smoothstep(0.33, 0.45, sharpness)
                             · smoothstep(0.5, 0.8, neutrality)
  7. IR source       when an infrared plane exists: replace 1–2 by D_IR (its own background), skip neutrality
```

Positions are stored in sensor coordinates, so cropping or rotating does not move a spot:

```ts
// packages/ingest/src/conditioning/dust/specks.ts (sketch)
export interface DustSpot {
  id: number; cx: number; cy: number; r: number;   // sensor px
  rle?: string;                                    // run-length pixel mask, sensor px (optional, for odd shapes)
  contrastD: number; localNoiseD: number; sharpness: number; neutrality: number; score: number;
  source: 'density' | 'ir';
}
export function detectSpecks(D: Float32Array[], w: number, h: number, sigma: Vec3, o: SpeckOptions): DustSpot[];

// packages/ingest/src/conditioning/dust/heal.ts (sketch)
export interface HealOptions { marginPx: number; method: 'patch' | 'diffuse' | 'neutral' }
export function heal(D: Float32Array[], w: number, h: number, spots: DustSpot[], o: HealOptions): Float32Array[];
```

`heal` ports goja-cv's `Heal` (`kernels/heal.go` 22–343): margin growth by a distance transform, components, patch search with seam correction, and harmonic fill. It runs on the three density planes together. The ring SSD uses all three channels, and seam correction adds a harmonic density offset, a multiplicative transmittance gain, which is physically meaningful.

`neutral` is new. For thin, semi-transparent dust with image detail visible through it, it subtracts the estimated neutral bump Δ(x), the per-pixel minimum of the channel residuals clipped at 0, and keeps the dye detail underneath. It is v1 work, gated on the planted-dust test.

Spots persist in the recipe as data (`scan.dust`, proposed), so a heal is reproducible and an agent's proposal can wait for approval. At preview scales the engine rasterises the spots at that scale and heals there, as goja-cv's heal test checks at scale 0.5.

**JS and WGSL (DR-10).**

- **The f64/f32 JavaScript implementation** in a Worker is the reference and the v0 product.
- **The dense kernels** have WGSL versions, run by CHB-005's runtime and parity-tested against JS:
  - neutral plane;
  - separable Gaussian, which reuses CHB-005's blur;
  - square min and max for the opening and closing;
  - box mean;
  - residual and threshold to a byte mask.
- **The sparse steps stay in JavaScript on read-back windows:** labelling, measures, MAD over rings, and healing small components.

goja-cv's Go peaks run at 0.1–0.2 s per megapixel (`ops/peaks.go` doc string), so a 40-megapixel scan in plain JS would take tens of seconds. That is the reason for the GPU path.

```wgsl
// packages/ingest/src/conditioning/dust/wgsl/minmax.wgsl (sketch): horizontal min over 2r+1 taps
struct P { w: u32, h: u32, r: u32, pad: u32 };
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<uniform> p: P;

fn at(x: i32, y: u32) -> f32 {
  // odd (point) reflection about the edge sample, as goja-cv's oddPad: v(−k) = 2 v(0) − v(k)
  let w = i32(p.w);
  if (x < 0) { return 2.0 * src[y * p.w] - src[y * p.w + u32(min(-x, w - 1))]; }
  if (x >= w) { return 2.0 * src[y * p.w + p.w - 1u] - src[y * p.w + u32(max(2 * (w - 1) - x, 0))]; }
  return src[y * p.w + u32(x)];
}

@compute @workgroup_size(64, 4)
fn minH(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.w || id.y >= p.h) { return; }
  var m = 3.4e38;
  for (var d = -i32(p.r); d <= i32(p.r); d++) { m = min(m, at(i32(id.x) + d, id.y)); }
  dst[id.y * p.w + id.x] = m;
}
```

The JS reference pads by odd reflection before the opening. The WGSL reads reflected values on the fly, which gives the same result. That equivalence is the first thing the parity test checks.

### 5.12 Decision records

**DR-1: Linearise per sample through a LUT; store native integers.**

- *Context:* Chromogen averages encoded values (§4.2, item 3) and stores everything as `Float32Array`.
- *Alternatives:*
  - decode to linear f32 at load, as goja-cv does: correct, but double the memory;
  - keep Chromogen's order: wrong.
- *Decision:* integer planes plus a 64K-entry LUT per channel.
- *Consequence:* `row()` is the only way to read samples, so kernels never see encoded values.

**DR-2: Encoding default from evidence; 16-bit without colour evidence is linear.**

- *Context:* Chromogen and goja-cv both default PNG to sRGB. Chromogen's book says 16-bit means linear, and scans for physics are linear.
- *Decision:* the table in §5.2, always written into the recipe with its evidence.
- *Consequence:* a mis-declared file is visible and fixable by one mutation.

**DR-3: Own TypeScript decoders for TIFF, PNG and LinearRaw DNG; LibRaw for camera RAW and compressed or CFA DNG.**

- *Alternatives:* LibRaw for everything (it reads TIFF poorly and adds a WASM dependency to the M1 path), or goja-cv's strict subset (no tiles or planar data).
- *Decision:* port Chromogen's coverage with goja-cv's strictness and level handling.
- *Consequence:* M1 needs no WASM.

**DR-4: Start from `@colorhythm/libraw-wasm` behind an adapter; fall back to a pinned custom build.**

- *Context:* the fork exposes most of what scan mode needs. Some setters and the cblack pattern are unverified.
- *Decision:* a spike in week one of stage 2 decides.
- *Consequence:* the `RawDecoder` adapter is the only code that knows the build.

**DR-5: Scan mode reads `raw_image` and does black, white and binning itself.**

- *Alternative:* `dcraw_process` with `no_auto_scale`, unit multipliers and `no_interpolation`. LibRaw's own documentation calls `no_auto_scale` a special-use setting, and the processing path clips.
- *Decision:* bypass it.
- *Consequence:* our code owns the black-level pattern, and it is tested against LibRaw's reported values.

**DR-6: Photo mode applies camera → XYZ in TypeScript, in float.**

- *Alternative:* LibRaw's XYZ output, which clips negatives at 16 bits.
- *Consequence:* matrices are data in `SourceInfo`, inspectable by the agent and by CHB-012.

**DR-7: Stored boxes and spots are in sensor coordinates.**

- *Context:* the flat already lives in sensor coordinates. Chromogen stores the rebate in oriented coordinates, so a rotation breaks it.
- *Decision:* the recipe stores rebate, crop and dust in sensor pixels; the UI converts for display.
- *Consequence:* orientation is a pure display and evaluation transform.

**DR-8: σ is measured at each evaluation scale, never derived.** §2.6 explains why. The consequence is one extra `sigmaD` per scale, cached.

**DR-9: The spectral forward model is injected (`ScannerForward`).**

- *Context:* the reference engine in `@chromobench/core` opens sources through ingest, while ranking and conditioning need core's maths. A package cycle would follow.
- *Decision:* define the interface in the contract and implement it in core.

**DR-10: Dust is detected and healed in scanner density; JS reference, WGSL for the dense kernels; spots persisted in the recipe.**

- *Alternative:* heal in display RGB, as most editors do. That loses the neutrality test and heals something the print model then reinterprets.
- *Consequence:* healing is a `scan.*` op before `invert.dyes`.

**DR-11: The automatic rebate is a region search with a confidence; the percentile is only a fallback with a warning.** §5.8 and §6 explain why.

### 5.13 Proposed contract additions (for CHB-002)

1. **Types** in `packages/contract/src/source.ts` (new):

   ```ts
   export interface SourceRef {
     kind: 'file' | 'triplet';
     sha256: string;                               // identity; for a triplet, sha256("triplet:v1\n" + R + "\n" + G + "\n" + B)
     path?: string;                                // last known path, for display and relinking only
     parts?: { role: 'R' | 'G' | 'B'; sha256: string; path?: string }[];
   }
   export interface DecodeOptions {
     mode: 'scan' | 'photo';                       // LibRaw mode; TIFF/PNG always behave as 'scan'
     encoding: 'linear' | 'srgb' | 'gamma22';
     levels?: { black: number[]; white: number[] };   // override, in native sample units
     bin?: 'none' | 'cfa' | 'cfa-half';
     tripletMode?: 'own' | 'all-photosites';
     ir?: boolean;                                 // keep a fourth (infrared) channel
   }
   export interface SourceInfo {
     sha256: string; format: 'tiff' | 'dng' | 'png' | 'raw' | 'image' | 'triplet';
     width: number; height: number; channels: 1 | 3 | 4; bits: number; sample: 'uint' | 'float';
     encoding: { value: 'linear' | 'srgb' | 'gamma22'; evidence: 'declared' | 'metadata' | 'chunk' | 'bit-depth' | 'format' };
     levels: { black: number[]; white: number[]; from: 'file' | 'libraw' | 'default' | 'declared' };
     cfa?: 'bayer' | 'xtrans' | 'none'; orientationTag?: number;
     camera?: { make: string; model: string; iso?: number; exposure_s?: number; fnumber?: number };
     colour?: { camToXyz: number[][]; asShotNeutral?: [number, number, number]; from: 'dng' | 'adobe' };
     clippedFraction: number; notes: Diagnostic[];
   }
   export interface ScannerForward { scanner: string; readBase(stock: string): [number, number, number];
                                     sigmaMin(stock: string, c: [number, number, number]): number }
   ```

2. **Recipe fields** under `FrameRecipe.scan`:
   - `format: '135' | '645' | '66' | '67' | '45'`, which sets `umPerPx.film`, as Chromogen's `FORMATS` does;
   - `openGate?: Box | 'flat' | null`;
   - `flare?: number | [number, number, number]` (widened);
   - `dust?: { spots: DustSpot[]; method: 'patch' | 'diffuse' | 'neutral'; marginPx: number }`;
   - the note that `rebate`, `crop` and dust positions are in **sensor coordinates**.
3. **Ops** (owner 006 unless noted):

   | op | on → returns | domains |
   |---|---|---|
   | `source.xyz` | Image → Image | `camera-linear` → `scene-xyz` (photo mode; consumed by 012) |
   | `scan.baseClass` (arg `class: 'below' \| 'blank'`) | Image → Mask | `scanner-density` → `mask` |
   | `scan.conditioning` | Image → Image | `film-dyes` → one-channel gain 1/σ₃ (domain to decide: `mask` does not fit values above 1) |
   | `scan.rankStocks` | Image → Value | — |
   | `scan.specks` | Image → Regions | `scanner-density` |
   | `scan.heal` | Image → Image | `scanner-density` → `scanner-density`, recipe path `scan.dust` |
   | `scan.checkDust` | Image → Value | — |

4. **The `classify` split:** ingest's `classify.ts` holds the noise-only classes; CHB-003's `core/scan/classify` adds `gamut` from the residual. Both layout entries in the architecture then have a defined job.
5. **Diagnostic codes:** `E_FORMAT`, `E_LIBRAW_<n>`, `W_ENCODING_ASSUMED`, `W_ICC_IGNORED`, `W_CLIPPED`, `W_FLAT_SHAPE`, `W_NO_OPEN_GATE`, `W_REBATE_PERCENTILE`, `W_BASE_MISMATCH`, `W_TRIPLET_SHIFT`, `W_SIGMA_ASSUMED`, `W_ILL_CONDITIONED`.
6. **A new value domain or Kind for numeric single-channel images** (noise gain, z maps), or a decision that `mask` may exceed 1.

## 6. One flow traced end to end: a Gold 200 pixel

The sample is `C1/sources/chromogen-studio-1.2/samples/gold200.png`. Its metadata is in `window.ST_DATA.samples.gold200`, inside `C1/various/extracted/chromogen-studio/03-inline.js`:

- film `kodak_gold_200`, scanner `xt5-fitted` (architecture id `xt5-rgb-led`), flipH;
- rebate box [98, 100, 20, 680] and crop [126, 60, 1090, 754], both in oriented coordinates;
- caveats: "no flat field" and "the scanning light's spectra are not known; FWHM 20 nm assumed".

1. **Bytes and identity.** 5,310,246 bytes; SHA-256 `54bd952c546a2bef53a8bd2a76fcb2bcdab69cc0809a6778e7d0a06d8793f78d`. The frame's `SourceRef` is `{ kind: 'file', sha256: '54bd…f78d', path: 'fixtures/scans/gold200.png' }`.
2. **Probe.** PNG, IHDR 1,292×863, depth 16, colour type 2. The file's only chunks are IHDR, IDAT and IEND: no sRGB, gAMA or iCCP. Rule `bit-depth` gives `linear` with `W_ENCODING_ASSUMED`. Chromogen's `decodePNG` would have hinted sRGB; `loadSample` bypassed that.
3. **Decode options.** Chromogen's `loadSample` (2690) computes T = max(0.05, u/16 − 2)/4000. That is T = (u − 32)/64000, so the fixture declares `levels: { black: [32, 32, 32], white: [64032, 64032, 64032] }`. The special loader becomes ordinary decoding, identical for every pixel above 0.05 counts.
4. **Orientation and coordinates.** The pixel at oriented (600, 540) is sensor pixel (1291 − 600, 540) = (691, 540). In sensor coordinates (DR-7) the rebate box is [1174, 100, 20, 680] and the crop is [76, 60, 1090, 754].
5. **Linear values.** The stored samples are u = (8264, 47049, 15362), so T = (0.12863, 0.73464, 0.23953).
6. **Flat, open gate, flare.** The fixture has no flat, so `scan.flatField` is the identity, with a note. No open gate exists in this capture, so `W_NO_OPEN_GATE` is raised: flare correction, the base check and stock ranking are off. On this sample the 4,000-count scale would put the "rebate" at (0.919, 0.168, 0.670) D, unrelated to Gold 200's modelled base (0.282, 0.643, 0.840).
7. **Rebate.** The picked box gives T_reb = (0.1205, 0.6793, 0.2139), as the textbook states (§1.7, line 263).
8. **Scanner density.** D = −log₁₀(T/T_reb) = (−0.028, −0.034, −0.049).
9. **Noise at this scale.** Full frame size, scale 1, rebate box: σ = (0.0090, 0.0069, 0.0122) D. A re-implementation of `sigmaD` gives (0.00899, 0.00686, 0.01220).
10. **Base class.** z = D/σ = (−3.14, −4.96, −4.03). min z < −3, so the class is **below base** in all three layers. It is decided before the solve, whatever residual CHB-003 returns. The pixel lies in the named region "deep shadow beside the stand" [592, 524, 60, 34]. There 54 % of pixels are below base and 29 % blank at full size; the region mean is D = (0.028, 0.031, −0.009).
11. **What the old default would have said.** With the automatic percentile rebate (0.1345, 0.7722, 0.2465), the same pixel reads D = (+0.019, +0.022, +0.012) and z = (2.1, 3.2, 1.0): **blank film**. The lighting problem that the textbook's shadow-floor analysis finds (0.03–0.04 D) disappears behind a zero that sits 0.05 D too light.
12. **Downstream.** CHB-003 adds D_base from the stock and solves for dyes. `scan.conditioning` reads σ₃ at the solved dyes. Through narrowband channels it is about 1.1 everywhere, so the gain is about 0.9. `scan.specks` finds nothing to heal on this frame unless dust is planted.

The same pixel at the 640-pixel statistics size would use σ = (0.0043, 0.0033, 0.0057). The class percentages then become 12.6 % blank and 9.7 % below, against 21.5 % and 7.2 % at full size (§2.7). This is why every statistic carries its size.

## 7. Implementation plan

**Stage 1: decoders (start immediately; the TIFF slice is on M1's path).**

- *Build:*
  - `decode/identity.ts`, `registry.ts`, `tiff.ts`, `lzw.ts`, `packbits.ts`, `png16.ts`, `browser.ts`, `encoding.ts`, `linear.ts`, `triplet.ts`;
  - `conditioning/resample.ts`, the linear-first `region`;
  - a fixture generator, `test/gen/tiffs.ts`, that writes every combination of byte order × bits (8/16/32u/32f) × compression × predictor × strips/tiles × chunky/planar × 1/3/4 samples, plus DNG LinearRaw with levels.
- *Done when:*
  - every generated file decodes to its known array;
  - the bugs of §4.2 each have a failing-then-passing test;
  - Gold 200 decodes to the values of §6;
  - 16-bit PNG encoding follows §5.2;
  - a 16-bit TIFF opens through the mock engine for M1.

**Stage 2: LibRaw WASM in a worker.**

- *Build:*
  - the build spike (DR-4);
  - `libraw/adapter.ts`, `worker.ts`, `protocol.ts`, `colour.ts`;
  - scan mode with CFA binning, photo mode, pixel-shift handling.
- *Fixtures:* a few RAW files from raw.pixls.us (check each file's licence; most are CC0): one Bayer camera, one X-Trans camera and one DNG with two calibration illuminants.
- *Done when:*
  - scan-mode black levels equal LibRaw's reported values;
  - binned means over a uniform patch equal the mean of the matching photosites;
  - clipping is flagged;
  - photo mode maps a DNG's AsShotNeutral to the white's chromaticity within 10⁻³ in xy;
  - a 40-megapixel RAW decodes in a Worker without blocking the UI. Time it and record the result.

**Stage 3: flat, rebate, σ, flare; classes, conditioning and ranking.**

- *Build:* `flat.ts`, `opengate.ts`, `flare.ts`, `rebate.ts`, `sigma.ts`, `classify.ts`, `conditioning-map.ts`, `rank.ts`. Also the `ScannerForward` stub using Chromogen's channel maths until CHB-003 lands.
- *Done when:* the laws and golden numbers of §8.2 pass, and the deliberately broken variants of §8.4 fail.

**Stage 4: dust.**

- *Build:* `dust/specks.ts` and `dust/heal.ts` as JS references; a planted-dust generator (§8.3); then `dust/wgsl/*.wgsl` with parity tests; IR-channel detection.
- *Done when:* the heal laws pass, WGSL matches JS within the stated tolerances, and a 40-megapixel frame is processed on the GPU path. Time it and record the result.

## 8. Testing and acceptance

### 8.1 Decoder tests

- **Round trip** on every generated TIFF/DNG/PNG: exact equality of decoded native samples, and of linear values through the LUT.
- **Bug regressions:**
  - a 32-bit unsigned TIFF of value 2³¹ reads 0.5;
  - a half-float TIFF of 1.0 reads 1.0 (or is refused with `E_FORMAT`, if half-floats are not implemented);
  - predictor 3 is undone or refused;
  - SRATIONAL matrices parse;
  - two type-13 SubIFDs are both found;
  - an RGBI TIFF keeps its fourth plane;
  - decoding the same buffer twice gives identical results.
- **Chromogen parity** on inputs Chromogen handles correctly (8/16-bit, LZW, Deflate, PackBits, tiles, planar, linear encoding): bitwise-equal f32. Run Chromogen's `decodeTIFF` and `decodePNG` from the extracted file in Node 24, which has `DecompressionStream`.
- **The averaging order:** a 2×1 sRGB image (0.2, 0.8) resampled to 1×1 gives linear 0.3185, not 0.2094. The broken variant fails by 0.18 D.

### 8.2 Laws and golden numbers

Store these as JSON in `fixtures/golden/ingest-gold200.json` and `fixtures/golden/ingest-laws.json`.

| check | value | source |
|---|---|---|
| Gold 200 SHA-256 | `54bd952c…8793f78d` | file |
| T_reb, picked box | (0.1205, 0.6793, 0.2139) ± 1e-4 | textbook §1.7 l.263 |
| σ at 1,090×754 | (0.0090, 0.0069, 0.0122) ± 1e-4 | §3.5 l.896 |
| σ at 640×443 | (0.0043, 0.0033, 0.0057) ± 1e-4 | §3.5 l.896 |
| shadow floor next to the rebate (25-px band) | (−0.022, −0.017, −0.031) ± 0.002 | §3.5 l.911 |
| shadow floor mid-frame | about (−0.053, −0.060, −0.069) | §3.5 l.911 |
| classes with CHB-003's residuals | 640: 12.6 / 9.7 / 0.05 %; full: 21.5 / 7.2 / 0 % | §3.5 l.900 |
| flat-field law | 0.26 D vignette, ±1 % noisy flat → every density within 0.0006 D | §3.1 l.744, §3.9 l.991 |
| flat wedge | a flat step of 1.234 D reads 1.234000 in every channel of every scanner | §3.7 l.957 |
| flare fit | f = 0.005, steps 0…3 D read 0, 0.495, 0.981, 1.438, 1.826, 2.090, 2.224; fit with 0.005 D noise → 0.00503 | §3.7 l.957 |
| leave-one-out bias | √(81/80) = 1.0062 on 2048² white noise (measured 1.0063) | §1.7 l.251 |
| footprint table | local-mean estimate within 4 % at reductions 1, 0.7, 0.5, 0.439, 0.3125 | §1.7 l.255–261 |
| base relativity | read(P, D + b) − read(P, b) = read(relativeTo(P, b), D) to 1e-12 | §1.9 l.317 |
| MAD robustness | one 50σ sample among 81: MAD estimate 1.10 → 1.12 | §1.7 l.229 |

### 8.3 Dust tests

- **Planted dust in density.** Take a synthetic negative (CHB-004's synthetic frames, or a local generator until then). Add grain-like independent per-channel noise. Plant specks by multiplying T by (1 − a(x)) with known a and footprint. Expected:
  - recall ≥ 0.95 and precision ≥ 0.9 for specks with contrast ≥ 5σ;
  - neutrality rejects single-channel blobs of the same contrast.
- **Heal laws**, ported from goja-cv's `heal_test.go` 61–119:
  - mean |D_healed − D_true| over healed specks ≤ 1.5σ_D;
  - no pixel outside the grown targets changes (exact);
  - `checkDust` count ≤ 1 after healing;
  - patch keeps more than twice the high-pass σ of diffuse inside healed specks.
- **Parity, WGSL vs JS:**
  - background planes within 1e-5 D;
  - threshold masks identical except at most 0.1 % of pixels within 1e-6 of a threshold;
  - identical spot lists on the planted fixture.
- **Real data** stays environment-gated (`CHROMOBENCH_PRIVATE_FIXTURES`), as goja-cv gates its labelled tiles. Compare two methods on the same points in one run.

### 8.4 How to tell a test can fail

Each test ships with a deliberately broken variant run in CI, which must fail:

- **Averaging before linearising** fails the sRGB edge test by 0.18 D.
- **The flat applied in oriented coordinates** fails the flat-field law on a frame rotated by 90°.
- **f32 summed-area tables** fail the σ golden on a 4096² frame.
- **Neighbour differences instead of the leave-one-out mean** fail the footprint test at 0.7 (0.754).
- **The percentile rebate** fails the Gold 200 pixel of §6: it reports blank instead of below base.
- **Dropping the neutrality factor** fails the single-channel-blob rejection.

## 9. Risks, open questions and decisions

**Blocking decisions:**

- **CHB-002 must accept or amend §5.13.** Until then, ingest defines local types with these names.
- **The photographer's setup (CHB-013, architecture §8.4) sets stage 2's priority:**
  - LED triplets need scan mode and triplet merging;
  - a dedicated scanner needs TIFF and DNG with an IR channel;
  - RAW photos need photo mode.
- **What "RAW" means** decides whether photo mode is needed for the first beta.

**Risks:**

- **Memory.** A 160-megapixel pixel-shift DNG is about 1 GB as 16-bit RGB. LibRaw's internal four-channel image adds more, and 32-bit WASM memory is capped at 4 GB. Measure early. Prefer scan mode, which keeps one 16-bit plane. Consider windowed decoding for previews (goja-cv decodes a 1024² window of a 53-megapixel DNG in under a second).
- **The LibRaw build and licence.**
  - The colorhythm fork may lack setters (DR-4).
  - LibRaw is LGPL 2.1 or CDDL 1.0. Shipping it as a separate, replaceable `.wasm` file with its source and build script is the conservative LGPL route.
  - Choosing CDDL needs a licence review. Record the choice in the package's `LICENSES`.
- **Pixel-shift DNGs.** Whether Fujifilm's combined DNG is LinearRaw, and how LibRaw presents Sony ARQ, must be checked on real files before promising support.
- **The automatic rebate** can fail on frames without visible rebate, such as cropped holder scans. The fallback warns, but the UI must make picking a box quick.
- **The flare model** is one constant per setup. Real veiling glare depends on frame content. CHB-013 should measure f with two different surrounds to bound the error.
- **The Gold 200 rebate is not uniform** (0.021 D denser at its top, textbook §3.5). Rebate-box σ is fine, but the rebate mean depends on where the box is.
- **The open gate is often unavailable.** Without it, ranking and the base check silently do nothing. The UI must show `W_NO_OPEN_GATE` prominently, and CHB-013's capture protocol asks for sprocket holes or a matched flat.

**Ordinary implementation choices,** not blocking:

- the LZW table layout;
- selection versus histogram medians;
- the Worker pool size for decoding;
- the exact clustering in `rebateAuto`.

## 10. References

**Project documents:**

- Architecture and work plan: `C1/design-doc/01-chromobench-architecture-and-work-plan.md` (§2, §4, §5.1–5.4, §6, §8).
- `C1/various/analysis-chromogen-studio.md`: §1.1 formats and bugs, §1.2 colour-space assumptions, §1.4 rebate/flat/σ, §1.5 classes, §3.4 sample, §6.3 bugs.
- `C1/various/analysis-goja-cv.md`: §1.3 backend and formats, §2.8 peaks and measure, §2.10 the dust task library, §3.6 evidence (G4 #37), §4.4 tests.

**Code:**

- Chromogen: `C1/various/extracted/chromogen-studio/05-inline.js`:
  - `channels.js` 477–567;
  - `solve.js` 647–790 (Dbase 653);
  - `makeScanner` 1645–1659;
  - `decode.js` 2195–2413;
  - `source.js` 2415–2692;
  - statistics 3041–3051;
  - `addSample`/`openFiles`/`defaultSrc`/`addFrame` 3911–3956;
  - `openFlat` 4281–4306.
- Chromogen data and book: `03-inline.js` (sample metadata); `st-data/cg/` (stocks, `cameras/generic-bayer.json`, `lights/white-led.json`); `st-data/book/10-ch10.md` (the base map, sources and flat fields).
- goja-cv (`~/code/wesen/go-go-golems/goja-cv` at `5a93095`):
  - `pkg/cv/buffer/decode.go`, `decode_tiff.go`, `decode_std.go`, `decoders_test.go`;
  - `pkg/cv/ops/realdata_test.go`, `peaks_gold_test.go`, `heal_test.go`, `detect.go`, `composite.go`, `peaks.go`;
  - `pkg/cv/kernels/specks.go`, `heal.go`, `peaks.go`;
  - `internal/testimage/planted.go`.

**Textbook:** §1.2 (Beer–Lambert, area averaging), §1.3, §1.6 (base relativity), §1.7 (noise, MAD, leave-one-out, footprints), §3.1 (scanner model, counts, flare, flat field), §3.2 (conditioning), §3.5 (classes, shadow floor), §3.7 (wedge, flare fit), §3.8 (stock identity), §3.9 (laws).

**External:**

- LibRaw API data structures and output parameters, libraw.org/docs; LibRaw 0.22.3 release, libraw.org/download.
- `libraw-wasm`, github.com/ybouane/libraw-wasm.
- `@colorhythm/libraw-wasm`, github.com/colorhythm/libraw-wasm.
- `dcraw-wasm`, github.com/nhebling/dcraw-wasm.
- Adobe, *Digital Negative (DNG) Specification*, version 1.6 or 1.7, chapter 6 "Mapping Camera Color Space to CIE XYZ Space".
- TIFF 6.0 Specification (Adobe, 1992): predictor 2, LZW, PackBits; Adobe TIFF Technical Note 3 (predictor 3 for floating point).
- PNG Specification (W3C, 2nd ed.): IHDR, gAMA, sRGB, iCCP, filters.
- IEC 61966-2-1 (sRGB transfer).
- Fujifilm Pixel Shift Combiner product and support pages.
- Reports on LibRaw's PixelShift2DNG and Sony ARQ (diglloyd.com, 2019 and 2022).
- Dainty and Shaw, *Image Science*, ch. 8.
