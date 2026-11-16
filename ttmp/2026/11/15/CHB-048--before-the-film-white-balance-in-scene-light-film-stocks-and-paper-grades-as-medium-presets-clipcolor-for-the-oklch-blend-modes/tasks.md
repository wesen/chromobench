# Tasks

## TODO

- [x] LAY-2 (CHB-037 P10-9): hue, saturation, colour and luminosity blends keep the result in gamut (W3C ClipColor in OkLCh: chroma reduced at constant lightness and hue); contract, core, GPU, mock; laws and parity; goldens <!-- t:86vw -->
- [x] LAY-1 (CHB-037 P9-12, D2): white balance in scene light before the film for camera files: temperature and tint in Lightroom's units, CAT16 to D65 defined once in the contract; as-shot default from the raw; core, GPU, mock; laws (identity at as shot, grey neutral through the film, composition) and parity; goldens unchanged at as shot, new goldens for a changed white balance <!-- t:6chc -->
- [x] LAY-1 UI: White balance panel in Classic's Print and Scene modules (presets, temperature, tint, eyedropper on a neutral; negatives say why there is none); a Before the film palette in Darkroom first; scene.whiteBalance command, undo, e2e <!-- t:zo4w -->
- [x] LOOK-6 (CHB-021 t:xw53, D6): film stocks and paper grades as medium presets from the data pack (pack names, push variants, grades); medium.preset command, picker, undo, e2e; golden for a stock preset; list the pack's stocks and papers in the diary <!-- t:q38b -->
- [x] Checks: typecheck, lint, gen:check, vitest, goldens, SwiftShader browser suite, gpu-parity on Metal under the lock <!-- t:hevq -->
- [x] Diary, changelog, source tasks marked done (CHB-037 P9-12, P10-9; CHB-021 t:xw53) <!-- t:mpam -->
- [ ] Open: double-click on Temperature/Tint resets to None (the ArgSpec default), not to As shot; a reset to the frame's as-shot white would need the arg control to know the catalog's asShot <!-- t:0xsf -->
- [ ] Open: the scan's film (a negative's stock, roll-linked) is still a plain select of ids with pack names, not a medium preset <!-- t:9xe9 -->
- [ ] Open (for the integrator/Output): output.display's knee had a discontinuity for deep blues near the sRGB edge (fixed in 43dc1d6 by the first-exit march); check on the photographer's pictures; a gamut gap narrower than a march step can still be skipped <!-- t:j41t -->
