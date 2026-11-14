# Tasks

## TODO

- [x] Run the browser suite on the Metal GPU (REAL_GPU=1); triage the failures <!-- t:9u64 -->
- [x] Smoke and open/drag timings on the GPU engine in the installed Chrome (scripts 01, 02) <!-- t:7xm7 -->
- [x] First print and strip frames on the GPU engine vs the CPU engine on the private photos (script 03) <!-- t:cd4e -->
- [x] Interface checks (F24, F26, F32-F36, 8iv8) on the GPU engine <!-- t:fneb -->
- [x] Browser specs: Control+ to ControlOrMeta+ so the suite passes on macOS <!-- t:tii7 -->
- [ ] DECIDE: preview LUT lookup on real GPUs: hardware trilinear (up to 0.86 of an 8-bit level from core on Metal) or manual trilinear (exact); then parity tolerances per adapter <!-- t:vcma -->
- [ ] gpu-parity tables.spec stage 1 assumes SwiftShader (adapter.fallback true): make it adapter-aware <!-- t:bubd -->
- [ ] Race: a typed relative entry (+1/3 st, -5 s) right after a commit uses a stale base (now.v) in studio-kit dom/arg.ts <!-- t:1j30 -->
- [ ] GPU open: one 200 ms main-thread stall per open (CPU engine: none); find it <!-- t:5un4 -->
- [ ] First print lands on either side of a 1/3-stop Time boundary depending on engine (DSC_8559: 5.612 s GPU, 6.3 s CPU; same luma) <!-- t:fusz -->
- [x] Correct HANDOFF.md: the browser suite runs SwiftShader, not the Mac's GPU; REAL_GPU=1 <!-- t:8uk4 -->
