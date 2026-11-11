# Tasks

## TODO
- [ ] [stage 1] Create packages/ingest with the Decoder registry, local SourceRef/SourceInfo/DecodeOptions types (pending CHB-002) and SHA-256 source identity, including triplet identity <!-- t:pie9 -->
- [ ] [stage 1] Port Chromogen's decodeTIFF (strips, tiles, planar, LZW, Deflate, PackBits, predictor 2, SubIFDs) and fix the 32-bit integer maxv, half-float, predictor 3, signed/SRATIONAL/IFD tag types, the dropped fourth sample, in-place predictor writes and silent short strips <!-- t:smoq -->
- [ ] [stage 1] Read LinearRaw DNG levels and colour tags (BlackLevel, WhiteLevel, LinearizationTable, ActiveArea, DefaultCrop, ColorMatrix, AsShotNeutral) and route CFA or compressed DNGs to LibRaw <!-- t:xk1c -->
- [ ] [stage 1] Port the PNG decoder for 8 and 16 bits with chunk evidence; 16-bit with no colour evidence decodes as linear with W_ENCODING_ASSUMED; record the encoding in the recipe <!-- t:078s -->
- [ ] [stage 1] Implement CameraLinear with per-channel transfer LUTs over native integer planes, and the linear-first region() resampler; add the sRGB edge test (0.18 D) and its broken variant <!-- t:mycb -->
- [ ] [stage 1] Implement triplet merge with role detection from the dominant channel, own/all-photosites modes and a phase-correlation shift warning <!-- t:dlg1 -->
- [ ] [stage 1] Write the generated TIFF/DNG/PNG fixture set, Chromogen parity tests in Node, and the Gold 200 decode golden values <!-- t:3aen -->
- [ ] [stage 2] Spike @colorhythm/libraw-wasm against needed fields and setters; decide on fork or pinned LibRaw 0.22 build; write the RawDecoder adapter, worker and protocol <!-- t:5lol -->
- [ ] [stage 2] Implement scan mode: raw_image black and cblack-pattern subtraction, white normalisation, Bayer 2x2 and X-Trans 3x3/6x6 binning, clipping mask, no white balance or matrix <!-- t:3y7n -->
- [ ] [stage 2] Implement photo mode: dcraw_process with raw colour, unit multipliers and linear 16-bit output; camera-to-XYZ in TypeScript from DNG ColorMatrix interpolation or Adobe cam_xyz; deliver source.xyz for CHB-012 <!-- t:tgxg -->
- [ ] [stage 2] Handle pixel-shift sources (vendor-combined full-colour DNG, Sony ARQ four-component data) and refuse unmerged sequences with a named diagnostic <!-- t:mnvr -->
- [ ] [stage 3] Port flatGrid/flatAt in sensor coordinates with linear cell averages, the open-gate mean and W_FLAT_SHAPE; pass the flat-field law (0.0006 D) <!-- t:s25v -->
- [ ] [stage 3] Implement open-gate detection (sprocket holes, holder gaps, matched flat) and fitFlare/removeFlare; pass the textbook wedge golden (f = 0.00503) <!-- t:asug -->
- [ ] [stage 3] Implement the picked-box rebate, the region-search automatic rebate with confidence and percentile fallback warning, and the 0.02 D base check <!-- t:z7ig -->
- [ ] [stage 3] Port sigmaD (f64 summed-area tables, leave-one-out MAD) with per-scale caching and the shadow-floor diagnostic; pass the Gold 200 sigma and floor goldens <!-- t:pona -->
- [ ] [stage 3] Implement base classes from z = D/sigma with Z = 3, statistics with their image size, and the split with CHB-003's invert.classify <!-- t:6mlk -->
- [ ] [stage 3] Implement the sigma3 conditioning table and per-pixel gain map, and stock ranking from the absolute rebate density through an injected ScannerForward <!-- t:e0d8 -->
- [ ] [stage 4] Port DetectSpecks/SpeckBackground and Heal to scanner density with the neutrality score, planted-dust fixtures and goja-cv's heal laws; persist spots in scan.dust <!-- t:nha4 -->
- [ ] [stage 4] Write WGSL versions of the dense dust kernels (neutral plane, square min/max, box mean, residual threshold) and parity tests against the JS reference <!-- t:70zw -->
- [ ] [stage 4] Add infrared-channel dust detection for RGBI sources from dedicated film scanners <!-- t:ygqr -->
- [x] [errata] Apply writer's post-hoc corrections: averaging example 0.2094→0.2140, 0.679→0.670 vs 0.497, 0.18 D→0.17 D (guide lines ~120,123,1172,1215); §6 step 11 blue density +0.012→+0.013 (see diary) <!-- t:b6ny -->
