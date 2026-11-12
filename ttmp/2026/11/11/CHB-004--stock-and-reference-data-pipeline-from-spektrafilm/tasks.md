# Tasks

## TODO
- [x] [stage 1] Create tools/spektrafilm-export pinned to spektrafilm 3bb2c2d (Python ~=3.13, lock file); keep the GPLv3 tool out of the app bundle <!-- t:0umg -->
- [x] [stage 1] Export all 28 upstream profiles (20 films, 8 papers) as F64 safetensors plus JSON sidecars with units in array names, NaN positions preserved and content hashes <!-- t:h1jr -->
- [x] [stage 1] Export enlarger and light data: neutral print filter table (TH-KG3), the four dichroic filter sets, lamps and illuminants, CIE 1931 2° CMFs and the hanatos irradiance table (F16) <!-- t:k5x0 -->
- [x] [stage 1] Export DIR (applied and schema-default), halation and grain presets and convert the five regression baselines; check bit-exact round trip and identical hashes on re-run <!-- t:tycx -->
- [x] [stage 2] Write the JSON Schema for manifests and sidecars and the safetensors reader in packages/data <!-- t:5wa6 -->
- [ ] [stage 2] Implement openPack, the typed accessors, hashing and E_DATA_HASH / E_DATA_GRID / E_DATA_SCHEMA / E_STOCK_UNKNOWN in node and in a browser test <!-- t:spah -->
- [x] [stage 2] Build interim-filmbench and interim-chromogen packs first and hand them to CHB-003 and CHB-005; run the Filmbench / Chromogen / upstream cross-check in CI <!-- t:7fie -->
- [x] [stage 2] Submit the contract additions of Section 16 to CHB-002 (FrameRecipe.data, ArgSpec.valuesFrom, TableKey contentHash, diagnostics codes) <!-- t:qqd3 -->
- [x] [stage 3] Implement the missing-data policies opaque | zero-density | extend-flat with validity masks and E_DATA_POLICY <!-- t:li8l -->
- [x] [stage 3] Add the grey-card law and the 128-pair law; show both fail under zero-density <!-- t:x1qh -->
- [ ] [stage 4] Fetch Jiang et al. (Zenodo 3245883) and Butcher's ssf-data, resample to the 81-sample grid, write the separately licensed cameras-measured pack and reproduce the PCA percentages to ±0.2 pp <!-- t:3n63 -->
- [x] [stage 4] Regenerate illustrative@1 (illustrative camera, xt5-fitted LEDs, white LED) and emit W_DATA_ILLUSTRATIVE for it <!-- t:so1j -->
- [ ] [stage 5] Implement the six synthetic frame sets with truth.json, class masks and stable ids; check the cited textbook numbers within pre-registered tolerances <!-- t:8egr -->
- [ ] [stage 5] Have CHB-006 decode the TIFF and PNG subset of the synthetic frames <!-- t:urgj -->
- [x] [stage 6] Add licence files, CHANGELOG, attribution strings and About-screen data; script-check that no artefact mixes BY-SA and BY-NC-SA sources <!-- t:wlvi -->
- [x] (answered 2026-11-12: not public in this version, licence questions deferred to a public release) [stage 6] Send the owner the decision list of Section 12.4 <!-- t:w6wv -->
- [x] Check the shipped irradiance_xy_tc.npy size at export: textbook/LFP say 192x192x81, spektrafilm code defaults to lut_size=128 <!-- t:o0m6 -->
- [ ] [from CHB-012 18c5] Export Portra 800 push 1 and push 2 profiles and verify the exposure-index convention against Kodak's Portra 800 datasheet <!-- t:6qfb -->
- [ ] Before any public release: decide the Section 12.4 list (commercial use and the NC packs, GPL reach of ported algorithms, hanatos tables, CIE/filter licences, name, illustrative pack) <!-- t:7w8x -->
