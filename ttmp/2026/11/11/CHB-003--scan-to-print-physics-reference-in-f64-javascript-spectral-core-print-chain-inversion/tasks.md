# Tasks

## TODO
- [ ] [stage 1] Write tools/interim-data/ converter: Chromogen st-data stocks/camera/LED and the decoded Filmbench blob (CMFs, illuminants, dichroics, neutral filters, 3-CDF models) into the StockData shape, keeping CC BY-SA 4.0 attribution <!-- t:iv0r -->
- [ ] [stage 1] Implement spectral/grid, Spectrum kinds, units (stop, point, CC, refusing D + logH) and PhysicsConventions (SPEKTRAFILM, CHROMOGEN) with resolveStock building the NaN pass mask <!-- t:7k4h -->
- [ ] [stage 1] Implement Channels (read, transmittance, masked, centroids) and the four families: Status M, APD, printing and scanner channels <!-- t:olcg -->
- [ ] [stage 1] Implement jacobian, hessian, secant, baseWeightedK, relativeTo, solveLinear with minSingular, metamericBlack, sigmoid and exposeSpectral <!-- t:mq5z -->
- [ ] [stage 1] Build the law harness (mulberry32, generators with shrinking, mutants, checkMutants), the chapter 1 laws and fixtures/golden/core/ch1.json; all goldens pass and every mutant is caught <!-- t:hru7 -->
- [ ] [stage 2] Implement filteredLamp and the Enlarger in normalised mode (mid-grey geometric mean, four spektrafilm flag combinations, midgray input) with dxdCC, plus the 'real' mode RealExposureModel stub <!-- t:iwrt -->
- [ ] [stage 2] Implement Lights (points, logH, unit-checked shift), the aim ('grey-0.184' default and 'midgray-normalised'), the 3-CDF paper model with gamma morph and exhaustion, and preflash (spektrafilm phi and Chromogen slider) <!-- t:72za -->
- [ ] [stage 2] Implement reflectance and observe with tabulated CIE 1931 CMFs, addFlare before adaptation, Bradford and CAT16, the knee with OkLCh output compression, and sRGB encoding <!-- t:zvl0 -->
- [ ] [stage 2] Reproduce the chapter 2 goldens (mid-grey x, dx/dCC matrices, paper dyes and slopes, 0.755 and 1.33, white 0.813 and black 2.37, flare example, #70757b, knee values) and pass the chapter 2 laws with mutants <!-- t:zj3d -->
- [ ] [stage 3] Implement ScannerModel with flare, makeForward with the fused closed-form Jacobian (checked against central differences), withFlare, removeFlare and fitFlare <!-- t:of7v -->
- [ ] [stage 3] Port solve.js spectral() to solveDyes (damping, 12 tries, active set, stop reasons, pass counts) with the base-weighted start; reproduce the §3.3 LM trace with start 'secant' and the §3.4 shadow pixel <!-- t:u1h7 -->
- [ ] [stage 3] Implement classify, latd, latdFromPD, integrateToGrey, greyPatch, warmPerMired, colourOffset, lightsToSliders and greyPick; reproduce the §3.6 balance numbers <!-- t:d0xa -->
- [ ] [stage 3] Build the f64 tables (solve, printing density, print XYZ, enlarger) with Studio node order and look3 texel mapping; report the key range for the base-weighted key and hand tolerances to CHB-005 <!-- t:j90u -->
- [ ] [stage 3] Implement engine-ref.ts in exact and tabulated modes with op adapters for invert.*, print.*, view.*, output.display and measure.*; pass the CHB-002 conformance suite <!-- t:i839 -->
- [ ] [stage 3] Reproduce the Gold 200 class percentages at 640 x 443 and 1,090 x 754 using test ports of the sample loader and sigmaD <!-- t:7zy5 -->
- [ ] [stage 3] File the proposed contract additions (PhysicsConventions, residual channel, scan-classes, AutoBalance, aim, print-xyz white, scanner flare) with CHB-002 <!-- t:o8al -->
- [ ] [errata] §8.3 Gold 200 fixture: cite 05-inline.js addSample (line 3916, flipH: true) for the horizontal flip, not 03-inline.js metadata <!-- t:ccc7 -->
