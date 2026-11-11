# Tasks

## TODO
- [x] [stage 1] Implement filterTransmittance, EnlargerState, paperExposure and the scalar κ calibration (real and normalised modes) in packages/core/src/print/enlarger.ts <!-- t:ljn7 -->
- [x] [stage 1] Extend the PD table key with lamp and filter pack and compute clear per pack (packages/gpu/src/tables/pd.ts, with CHB-005) <!-- t:oldo -->
- [x] [stage 1] Add golden fixtures for ∂x/∂v in both modes and the 10 CC filter table at the grey card (fixtures/golden/chb010-enlarger.json) <!-- t:cr9o -->
- [x] [stage 2] Port Lights, aim (lamp as parameter, warmth vector), autoLights, colourOffset, roll consistency and match frame from Chromogen print.js/params.js <!-- t:do56 -->
- [x] [stage 2] Port grey pick (neutralise) and lightsToSliders; add lightsToFiltration and Bake as one edit-log transaction <!-- t:i6gs -->
- [x] [stage 2] Test the textbook §3.6 balance experiment (2.4 vs 14.6 ΔE00) and the E_UNIT refusal of density shifts <!-- t:33os -->
- [ ] [stage 3] Define Exposure semantics (stops, dodge, burn, split, flash through base) and implement compileExposures/sumExposures in f64 <!-- t:a4as -->
- [ ] [stage 3] Implement MaskSpec rasterisation at the evaluation scale and the mask ops jointly with CHB-009 <!-- t:nufr -->
- [ ] [stage 3] Write the WGSL multi-exposure kernel and the linearity and feather law tests (+0.17609 at mask 0.5) <!-- t:gmae -->
- [ ] [stage 4] Implement print.densityMask (contrast, unsharp, highlight) with the blur in linear light in the global pass; test neutral mask = light <!-- t:428q -->
- [ ] [stage 5] Build the filter fast path: Jacobian cache, preview light, debounced cancellable rebuild, swap, preview flag in results <!-- t:j9cj -->
- [ ] [stage 5] Parity-test the Jacobian preview (≤0.4 pt at 10 CC, ≤0.7 pt at 20+20 CC) with the diagonal and normalised-J variants failing <!-- t:88wp -->
- [ ] [stage 6] Implement darkroom.testStrip (seconds, stops, filter; bands and tiles) with a per-step densitometer table in the result <!-- t:mh4d -->
- [ ] [stage 6] Implement darkroom.ringAround (lights and filter moves with density hold) and darkroom.contactSheet (single and balanced) <!-- t:d8xc -->
- [ ] [stage 6] Implement grade as gamma about the aim, preflash as a flash exposure through the base, and the off-by-default reciprocity hook <!-- t:1cg3 -->
- [ ] [stage 6] Store the test-strip and grade golden numbers and file the contract additions in CHB-002's changelog <!-- t:gqh1 -->
- [x] [errata] Tint wording: ±100 raises green 6.7 pt and lowers red/blue 3.3 pt each (green +10 pt relative), not '±10 points of green' (diary Step 17) <!-- t:nxhz -->
- [x] [errata] Warmth vector is (−0.00107, 0.00001, +0.00106) log H per mired, not ±0.00124: the guide script used absolute Planck radiance (diary Step 18) <!-- t:hjan -->
- [ ] [contract] Apply CHB-010 requests C1–C4 (packages/core/CONTRACT-REQUESTS.md): lightsToFiltration args/fields, grade and magnification docs, real mode default (review) <!-- t:gbmp -->
