# Tasks

## TODO
- [x] Separate adaptation from matrix in the forward-matrix comparison (same CAT, XYZ D50, per hue) — done: diary Step 2 and scripts/02-cm-vs-fm-same-adaptation.ts (same white, Bradford adaptation and exposure; saturation factor 0.55) <!-- t:m6ak -->
- [ ] ColorChecker ground truth: D750 shots in daylight and tungsten from the photographer; patch Lab vs chart, our paths, Adobe FM, Lightroom <!-- t:jzl6 -->
- [ ] Use ForwardMatrix when a DNG has it; ship the D750's dual matrices and forward matrices for NEFs if the chart says Adobe is closer — now: only if the chart (t:jzl6) says Adobe is closer; the owner kept our colour on 2026-11-14 — decided D11: only if the chart says Adobe is closer <!-- t:s66f -->
- [x] Regression test from scripts/01 (skips when the private files are absent) — done in CHB-047 (c8e8875) <!-- t:y8dh -->
- [ ] Lightroom full rendering as a taste reference (with CHB-026 F30); optional since the owner kept our colour (2026-11-14) <!-- t:xvhd -->
