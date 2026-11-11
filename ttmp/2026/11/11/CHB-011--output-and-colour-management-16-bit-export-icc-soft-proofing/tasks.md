# Tasks

## TODO
- [x] [stage 1] Port the table-driven CRC-32, the PNG chunk writer and the deflate helper (export.js 3231–3256); add the CRC test vectors 0xCBF43926 and 0xAE426082 <!-- t:a7w7 -->
- [x] [stage 1] Implement a streaming Png16Writer: IDAT chunks from CompressionStream, big-endian byte swap, pHYs, iTXt, and the colour-chunk policy per space <!-- t:y54v -->
- [x] [stage 1] Implement Tiff16Writer: sorted tags including 282/283/296, strips, Deflate with horizontal predictor, IFD-at-end patching, explicit little-endian writes <!-- t:b2oc -->
- [ ] [stage 1] Implement ByteSinks (OPFS sync access handle, showSaveFilePicker) and fix the screen-size 16-bit bug (4484) with a regression test <!-- t:vejp -->
- [x] [stage 2] Bundle the CC0 Compact ICC v4 profiles; write the ICC parser (header, tag table, XYZ, para, chad, mluc) and derive OutputSpace matrices and curves, tested against the analytic matrices <!-- t:6ej1 -->
- [x] [stage 2] Embed profiles: PNG sRGB/iCCP/cICP policy and TIFF tag 34675; verify with independent readers and libtiff <!-- t:5r58 -->
- [x] [stage 2] Wrap lcms-wasm in a module worker behind the Lcms interface; add the lcms round-trip test and the printer-profile library in OPFS with class validation <!-- t:i07v -->
- [x] [stage 2] Contribute output-space conversion (Bradford to the space's white, matrices, parametric curves) to core print/colour.ts with CHB-003 <!-- t:smhb -->
- [ ] [stage 3] Implement configureCanvas (display-p3 or srgb, rgba16float, reconfigure on color-gamut change) <!-- t:m97c -->
- [x] [stage 3] Implement the two renderings (print-as-seen, scan-of-print) and propose the scan-of-print flare compile rule; add paper-white exactness tests in all five spaces <!-- t:4of5 -->
- [ ] [stage 3] Implement the CAM16-UCS knee (max-chroma table per space, f64 in core gamut.ts, WGSL in output.wgsl), keep the tanh shoulder, and add parity and knee-last tests <!-- t:s4tf -->
- [ ] [stage 4] Build the 33³ proof table (proofing transform plus round-trip ΔE gamut channel), wire it into the output kernel, and test it against direct lcms transforms <!-- t:069x -->
- [ ] [stage 4] Implement printer output: strip-wise lcms conversion from ProPhoto to the printer profile with intent and BPC, printer profile embedded in the TIFF <!-- t:joib -->
- [ ] [stage 5] Implement the tiled export runner (plan, pinned fields, row bands, encoder, finalise) with progress events <!-- t:7iba -->
- [ ] [stage 5] Implement cancellation and failure clean-up (AbortSignal, sink.abort, unpin) and consistency during edits; add the tiles-vs-one-pass test with and without halo <!-- t:l2dd -->
- [ ] [stage 5] Add OutputSettings to view.output and the OpDefs for output.display and output.encode, and file the contract proposals in CHB-002's changelog <!-- t:6luo -->
- [ ] [review] sRGB cICP code (1,13,0,1) is from memory of H.273, unsourced; RELATED note credits paper white Y 0.813 / Dmax 2.37 to the Endura JSON but they come from textbook §2.7 <!-- t:bk2k -->
- [ ] [from CHB-005 6bzj] Export precision path on the GPU: rgba16uint source upload, pack2x16unorm 16-bit output (exact solve, tetrahedral lookups, f32 intermediates already done in packages/gpu) <!-- t:dajd -->
- [ ] [from CHB-005] Tiled-export driver: run plan() tiles through the engine's spatial kernels (halo, global fields) and assemble the 16-bit output <!-- t:4x53 -->
