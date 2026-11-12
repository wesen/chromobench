# Tasks

## TODO
- [ ] [stage 1] Write the setup questionnaire (capture method, raw output, stocks, meaning of RAW, black and white, print output, instruments, machine) and hold the call that picks the branch <!-- t:59ma -->
- [ ] [stage 1] Write the per-branch capture protocol and kit list (flat field, step wedge, lens-cap frame, rebate and open gate, optional IT8) as a playbook, plus the calibration wizard specification for CHB-009 <!-- t:4mux -->
- [ ] [stage 1] Define the private fixture manifest schema and the consent text; collect and decode the first calibration kit with no clipping in rebate or open gate <!-- t:blc5 -->
- [ ] [stage 2] Implement wedge step detection and the photometric fit (per-channel flare, shared density scale, black-level check) on top of CHB-006 fitFlare <!-- t:b5wo -->
- [ ] [stage 2] Implement flat-field verification on held-out lens-cap frames (shadow floor in 25-px bands, 64-px block means) with the no-flat control <!-- t:510r -->
- [ ] [stage 2] Implement the LED peak fit from cross-channel leakage with reported uncertainty, and the sensitivity of dye amounts to a 5 nm peak shift <!-- t:fg72 -->
- [ ] [stage 2] Package the Jiang et al. camera curves via CHB-004 and implement the two-component PCA prior with the MAP fit for white-light setups <!-- t:249h -->
- [ ] [stage 2] Implement the Rozzi-style Gaussian-channel plus tone-curve fit for dedicated scanners and flatbeds using a wedge and an IT8.7/1 <!-- t:vv47 -->
- [ ] [stage 2] Define the ScannerModel record, write the fitted model as a data pack and generate the calibration report with conditioning numbers <!-- t:ggj9 -->
- [ ] [stage 3] Plan and collect one sample roll per stock (lens-cap frame, grey card and chart, -3 to +3 EV bracket, scenes) and register them as gated fixtures <!-- t:51gg -->
- [ ] [stage 3] Turn reference prints into fixtures: patch Lab measurements, darkroom notes as a real-enlarger recipe, and the repeatability floor <!-- t:gizl -->
- [ ] [stage 4] Record success criteria C1-C8 with thresholds in the ticket before session B1 <!-- t:yjor -->
- [ ] [stage 4] Implement consent-gated session bundles and tools/beta-analysis usage, error and approval reports <!-- t:1rnt -->
- [ ] [stage 4] Run sessions B0-B5 with dry runs on the mock engine and keep observation notes per session <!-- t:m4we -->
- [ ] [stage 4] File the API pruning note to CHB-002 (deletions, redirects from typed names, hint and fix improvements) and the beta report <!-- t:5bpf -->
- [x] [errata] Line ~279: a 3% camera-curve error moves the fitted LED peak by ~1 nm, not 'several nanometres' (replacement text in diary Step 13) <!-- t:gc6o -->
- [ ] [from CHB-006 w3tp] Test LibRaw on real camera RAWs: the photographer's own camera files first, plus public samples (raw.pixls.us: Bayer, X-Trans, two-illuminant DNG; check licences), including non-zero sensor margins <!-- t:ehco -->
- [ ] [from CHB-001 0d32] Ask the photographer: capture setup (scanner or camera scanning, light source), B&W need, print output target, desktop vs browser. ('Digital RAWs' = his camera photos, answered 2026-11-12.) <!-- t:gb3u -->
