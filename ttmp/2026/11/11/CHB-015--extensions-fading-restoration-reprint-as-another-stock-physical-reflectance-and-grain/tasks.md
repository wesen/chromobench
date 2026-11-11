# Tasks

## TODO
- [ ] [stage 1 E5] Propose the finishing domains and recipe shape to CHB-002 so that every operator runs before output.display <!-- t:1h6y -->
- [ ] [stage 1 E5] Port Chromogen's finishing operators (dyeSat, grain reduction, guided-filter tone ops, sharpen, bloom, OKLab colour ops) to f64 and WGSL with Look strength <!-- t:e4p0 -->
- [ ] [stage 1 E5] Replace pixel-scale kernels with physical radii and test identity at 0, neutral preservation, gamut after output.display and scale agreement <!-- t:aubb -->
- [ ] [stage 2 E1] Implement invert.unfade and the picked-patch fade estimator (LM in log dye space) with E_UNDERDETERMINED <!-- t:jwpu -->
- [ ] [stage 2 E1] Add roll-level k, PD-table domain widening and diagnostics; test synthetic recovery and the section 3.2 golden fixture <!-- t:33j6 -->
- [ ] [stage 2 E1] Restore one real faded roll with the photographer (with CHB-013) and record the residuals <!-- t:w7wg -->
- [ ] [stage 3 E3] Write the Saunderson refit of the paper dyes and curves in tools/spektrafilm-export and add the view.reflect model switch with its tests <!-- t:hamr -->
- [ ] [stage 4 E2] Implement the DIR-aware inverse F_A⁻¹ (damped Newton from the layer-wise guess), tabulate it and compose the c_A → PD_B table <!-- t:uv0e -->
- [ ] [stage 4 E2] Run the synthetic-truth error budget (layer-wise vs DIR-aware; identity vs matrix crossing; edges) and choose the default crossing <!-- t:8fki -->
- [ ] [stage 5 E4] Prototype Boolean or shot-noise grain in f64 with a per-cell hash generator; test mean, Selwyn's G and resolution independence <!-- t:k5rh -->
- [ ] [stage 5 E4] Write a WGSL pixel-wise grain kernel, measure its cost and decide between export-only and preview use <!-- t:wyd3 -->
- [ ] [stage 6 E6] Build features, a ridge model with the integrate-to-grey prior and synthetic pretraining for the learned light estimator <!-- t:pe3o -->
- [ ] [stage 6 E6] Build the roll-split evaluation harness with baselines; ship the estimator only if it beats them <!-- t:m1yn -->
- [ ] [from CHB-006 mnvr, lcz0] Pixel-shift sources: vendor-combined full-colour DNG and Sony ARQ; refuse unmerged sequences with a named diagnostic; verify on real files <!-- t:xgx0 -->
