# Changelog

## 2026-11-14

- Initial workspace created


- Steps 1–5 (diary): baseline green; browser specs ControlOrMeta for macOS; REAL_GPU=1 switch in playwright.config.ts; suite on Metal 100/106 (6 GPU-parity tolerances, cause: hardware texture filtering of preview tables, and Metal transcendentals); smoke "GPU · apple metal-3 · 4000 px"; timings; first print and strips GPU vs CPU on the private photos; interface spec on the GPU engine 5/5; HANDOFF.md corrected
- Step 7: typed-entry race fixed (arg.ts reads the store's value); solve-table bound 3e-6 (measured on SwiftShader and Metal, the broken variant still fails by 4.6x); default browser suite 106/106 on the Mac

## 2026-11-14

fusz (diary 02): the first print's engine difference was the metered image's resolution (CPU 640 px vs GPU 4000 px: DSC_8559 0.0084 log H apart on one engine), not Metal's filter weights (GPU = CPU to 4e-6 at equal size). Every engine now meters a 640 px analysis image (the decode at 640 px, its own source); GPU DSC_8559 5.612 s -> 6.3 s (= CPU); photos within 0.0004 log H; CPU engine bit-identical; e2e parity test (commits 9c6739f, 7ec3684, 53e8c94). Follow-ups szeo, 3nod, ayqx, alwi

