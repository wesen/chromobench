# Tasks

## TODO
- [ ] [stage 1] Implement tri2quad/quad2tri, the erf4 band-pass window with reference-illuminant renormalisation, and buildFilmTable from the 192x192 spectra with baked-in input gamut compression (knee 0, 1, 6) <!-- t:2rs7 -->
- [ ] [stage 1] Implement sceneToRaw with CAT16 adaptation modes ('to-film-reference', 'none'), cubic (Mitchell-Netravali) and bilinear lookup, and all seven auto-exposure methods <!-- t:lqkt -->
- [ ] [stage 1] Implement cameraToSceneXYZ with daylight, as-shot and temperature/tint white balance from CHB-006 photo-mode metadata <!-- t:z60h -->
- [ ] [stage 1] Implement midgrayFilmDensity for CHB-003's normalised enlarger and reproduce the LFP chapter 1 goldens (M_D55, moderate red trace, window values, grey raw, table error table) <!-- t:sxpm -->
- [ ] [stage 2] Implement FilmCurves with gamma as axis stretch, the two-softplus parametric curve with slope, Newton inverse and least-squares fit; reproduce the Portra 400 fit table of §2.2 <!-- t:lvwe -->
- [ ] [stage 2] Implement DIR coupling: dirForStock matrix, precorrected curves f0, inhibitor a = M^T f(u), inhibitor diffusion (20 um Gaussian + 6 % 200 um exponential) and closed-form effective gamma; reproduce the §2.3 numbers <!-- t:ldyb -->
- [ ] [stage 3] Implement scatter and three-bounce halation in micrometres on linear exposure inside film.halation, with exact edge response; reproduce the §2.4 edge values and pass the Jensen law with its mutant <!-- t:qbun -->
- [ ] [stage 3] Implement the pcg4d counter-based RNG and an exact Poisson sampler (inversion below 30, PTRS above) bit-identical between JS and WGSL <!-- t:ktl7 -->
- [ ] [stage 3] Implement sublayer Poisson grain on the print-size grid with dye-cloud and final blurs; verify the variance formula, RMS 9.1/7.4/13.8 at D = 1.0 and tile independence <!-- t:txro -->
- [ ] [stage 4] Implement the development model with measured, interpolated, transferred and heuristic bases, recomputing f0 after each curve transform and labelling the basis <!-- t:1dq0 -->
- [ ] [stage 4] Get Portra 800 push 1 and push 2 profiles exported via CHB-004 and verify the exposure-index convention against Kodak's Portra 800 datasheet <!-- t:18c5 -->
- [ ] [stage 5] Write reference-engine op adapters for capture.sceneXYZ, capture.expose, film.halation, film.couple, film.develop (curves argument) and film.grain <!-- t:mi6k -->
- [ ] [stage 5] Implement the composition laws with mutants and the synthetic fixtures (edge, red on grey, grey ramp, uniform fields, synthetic RAW chart); render a synthetic RAW end to end to a print <!-- t:sdfs -->
- [ ] [stage 5] Hand the GPU kernel specifications and tolerances to CHB-005 and file the proposed contract additions with CHB-002 <!-- t:9ses -->
- [ ] [from CHB-005] Engine ops for halation and DIR on top of packages/gpu Blur.halation and the global fields (primitives tested in CHB-005) <!-- t:6alf -->
