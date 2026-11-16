# Tasks

## TODO

- [x] OUT-2 (CHB-028 t:qfae, CHB-037 P9-14 t:baq3): export at the file's own size on both engines (decode again at the export's size, scaleDocument, tiled render); size choice (original, long edge, percentage); JPEG with quality; Metal measurement of a 24-megapixel camera file <!-- t:h6wn -->
- [x] OUT-1 (CHB-037 P9-10 t:936y): Classic's Output module: format, colour space, size, quality, file name, Export / Export N selected, progress, Cancel, results; File > Export… the same form; output.set / output.export / output.cancel for agents; e2e <!-- t:wh4v -->
- [x] OUT-6 (CHB-011 t:bk2k): cICP code points checked against ITU-T H.273; CHB-011 design note on paper white / Dmax corrected <!-- t:xpty -->
- [x] OUT-7 (CHB-033 t:y8dh): RAW colour regression test from CHB-033 script 01, skipping without the private files <!-- t:y3q0 -->
- [x] OUT-3 (CHB-011 t:s4tf): CAM16-UCS knee on the GPU with parity <!-- t:on7p -->
- [ ] OUT-4 (CHB-011 t:069x): soft proofing, 33^3 proof table with a gamut channel, tested against lcms <!-- t:du5g -->
- [x] OUT-5 (CHB-011 t:joib): printer output, strip-wise lcms to the printer profile, intent, BPC, embedded profile <!-- t:ke2i -->
- [x] Checks: typecheck, lint, gen:check, vitest, goldens, SwiftShader browser suite, gpu-parity on Metal <!-- t:nbzu -->
- [x] Diary, changelog, source tasks marked done <!-- t:wgcf -->
- [ ] OUT-4 left open (not started): soft proofing needs the 33^3 proof table (packages/output, from lcms's proofing transform with a round-trip dE channel), its lookup in output.display in core, the GPU and the mock with parity, a Soft proof toggle with a gamut warning in the Print and Output modules; tested against direct lcms (CHB-011 §8: dE2000 rms <= 0.5, max <= 2, a 9^3 table must fail) <!-- t:8m45 -->
- [ ] Open: documents are in working-image pixels, the contract says full-resolution pixels; saved edits do not record the working size, so a frame edited on the GPU engine (4000 px) and reopened on the CPU engine (640 px) reads its coordinates at the wrong scale (scaleDocument is the piece the fix needs) <!-- t:uw25 -->
- [ ] Open: the full-size export decodes the file again each time (4.6 s of 8.3 s for a 24 MP camera file on Metal); frames of one file share it within a batch only <!-- t:yai1 -->
- [ ] Open: the cam16-ucs knee has no control in his words (the document's output.display.knee / output.export.knee are reachable by agents only) <!-- t:jjwm -->
- [ ] Open: the CPU engine's export of a 24 MP file at its own size does not finish in 45 minutes (RefEngine computes every stage at full resolution in f64, 5-6 GB in the worker); needs a banded export in core <!-- t:8d6i -->
