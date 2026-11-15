# Tasks

## TODO
- [ ] [stage 1] Read and note textbook §1.2, §2.2–2.6, §3.5, §3.7, James ch. 17, Hunt §§14.13–14.20 and §18.4, Tuttle, Streiffert, Nelson and Cline; record notes in the diary <!-- t:z31q -->
- [ ] [stage 1] Collect B&W film and paper datasheets with editions and page numbers (Tri-X F-4017, T-MAX 400 F-4043, HP5 Plus, FP4 Plus, Delta, Multigrade IV RC and RC Deluxe, Contrast control) <!-- t:kwm4 -->
- [ ] [stage 1] Ask the photographer which films, developers, papers and enlarger head they use and whether B&W is in the first beta <!-- t:nkhw -->
- [ ] [stage 2] Digitise film spectral sensitivity (Ilford spectrograms divided by a 2,850 K blackbody), curve families and contrast-index curves with provenance and uncertainty <!-- t:ljur -->
- [ ] [stage 2] Digitise Multigrade spectral sensitivity at three densities, ISO R and P tables and the colour-head filtration tables <!-- t:pwkk -->
- [ ] [stage 2] With CHB-013, measure Q(d) of the photographer's film, silver tone, MG filter transmittances and paper image tone <!-- t:jd32 -->
- [ ] [stage 2] Write tools/bw-data producing BwFilmStock and VcPaperStock packs in CHB-004's format with provenance on every array <!-- t:okza -->
- [ ] [stage 3] Implement film.developSilver with the effective-time development model fitted per stock and developer, plus the time–temperature and monotonicity laws <!-- t:u7ag -->
- [ ] [stage 3] Implement the Callier model and print.expose for silver-density with the neutral-silver factorisation and the full spectral path <!-- t:yhkc -->
- [ ] [stage 3] Implement VC paper components, the shared curve, the fit to ISO ranges and measure.isoRange; reproduce the Section 6 trace as the first unit test <!-- t:hbus -->
- [ ] [stage 3] Implement invert.silver with the flat-wedge law and residual reporting <!-- t:pzmo -->
- [ ] [stage 3] Run one-channel grain, halation and adjacency (DIR reuse) through CHB-012's ops; check RMS granularity 17 at 48 µm <!-- t:t7vb -->
- [ ] [stage 4] Submit the Section 9 contract additions to CHB-002 (silver-density semantics, ops, BwDevelopment, EnlargerHead, degC, diagnostics) — now: as a CC entry in CONTRACT-DECISIONS.md (contract 1.x), not to CHB-002 <!-- t:dv3n -->
- [ ] [stage 4] Integrate with CHB-010 (per-component exposure sums, split-grade, grade test strip) and CHB-005 (one-channel GPU path, parity) — now: per-component terms of the darkroom light law (contract/src/stage-laws.ts) and a one-channel path in the GPU engine <!-- t:719o -->
- [ ] [stage 4] Add CHB-009 grade and head controls, CHB-006 IR-dust disable and rebate as base-plus-fog, and the CHB-008 "choose a grade" playbook — now: grade and head controls in the Enlarger stack view <!-- t:z23c -->
- [ ] [stage 4] Store laws and golden numbers in fixtures/golden/bw/ with a broken variant per law <!-- t:n6qt -->
- [ ] [stage 5] Extensions from measured data: toning, pyro stain, XP2 Super, colour negatives on B&W paper <!-- t:o8ev -->
