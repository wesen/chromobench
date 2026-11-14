# Changelog

## 2026-11-14

- Initial workspace created


- Steps 1–5 (diary): baseline green; browser specs ControlOrMeta for macOS; REAL_GPU=1 switch in playwright.config.ts; suite on Metal 100/106 (6 GPU-parity tolerances, cause: hardware texture filtering of preview tables, and Metal transcendentals); smoke "GPU · apple metal-3 · 4000 px"; timings; first print and strips GPU vs CPU on the private photos; interface spec on the GPU engine 5/5; HANDOFF.md corrected
- Step 7: typed-entry race fixed (arg.ts reads the store's value); solve-table bound 3e-6 (measured on SwiftShader and Metal, the broken variant still fails by 4.6x); default browser suite 106/106 on the Mac
- Steps 8–9 (a60fa6c): preview tables through manual trilinear (+1.1 ms per 4000 × 2674 preview on Metal, 5.3 → 6.4 ms); lookup bench; caps and output.display tests adapter-aware; gpu-parity 40/40 on SwiftShader and on Metal; the display transform's Metal error located at G ≈ 1 (ill-conditioned knee bisection), not transcendentals
