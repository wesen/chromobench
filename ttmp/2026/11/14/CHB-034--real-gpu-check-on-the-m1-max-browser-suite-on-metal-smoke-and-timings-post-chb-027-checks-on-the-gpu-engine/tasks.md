# Tasks

## TODO

- [x] Run the browser suite on the Metal GPU (REAL_GPU=1); triage the failures <!-- t:9u64 -->
- [x] Smoke and open/drag timings on the GPU engine in the installed Chrome (scripts 01, 02) <!-- t:7xm7 -->
- [x] First print and strip frames on the GPU engine vs the CPU engine on the private photos (script 03) <!-- t:cd4e -->
- [x] Interface checks (F24, F26, F32-F36, 8iv8) on the GPU engine <!-- t:fneb -->
- [x] Browser specs: Control+ to ControlOrMeta+ so the suite passes on macOS <!-- t:tii7 -->
- [x] DECIDE: preview LUT lookup on real GPUs: hardware trilinear (up to 0.86 of an 8-bit level from core on Metal) or manual trilinear (exact); then parity tolerances per adapter <!-- t:vcma -->
- [x] gpu-parity tables.spec stage 1 assumes SwiftShader (adapter.fallback true): make it adapter-aware <!-- t:bubd -->
- [x] Race: a typed relative entry (+1/3 st, -5 s) right after a commit uses a stale base (now.v) in studio-kit dom/arg.ts <!-- t:1j30 -->
- [x] GPU open: one 200 ms main-thread stall per open (CPU engine: none); find it <!-- t:5un4 -->
- [x] First print lands on either side of a 1/3-stop Time boundary depending on engine (DSC_8559: 5.612 s GPU, 6.3 s CPU; same luma) <!-- t:fusz -->
- [x] Correct HANDOFF.md: the browser suite runs SwiftShader, not the Mac's GPU; REAL_GPU=1 <!-- t:8uk4 -->
- [x] Solve-table bound 2.5e-6 -> 3e-6 (SwiftShader on the Mac measures 2.62e-6; the broken variant still fails at 1.38e-5) <!-- t:1tqv -->
- [ ] Intermittent: studio-kit roll kit.test 'the roll flow through commands' failed 2 of 6 full pnpm test runs (under parallel load); capture its error — (check: the roll kit was rewritten in CHB-037; whether the flake still occurs) <!-- t:4o9y -->
- [ ] Negative scans: the measured scan settings (rebate box, scan.baseT, scan.flare) are measured on the working image, so the GPU (4000 px) and CPU (640 px) engines render and first-print a negative differently (raw007: GPU rebate on a frame gap at y 1195, CPU on the film edge; baseT red 0.887 vs 0.898; first-print totals 0.001-0.003 log H apart, same Time) — now: with CHB-035 design 02 P2 (engine-independent analysis levels) <!-- t:szeo -->
- [ ] CPU engine at refLong=4000 and GPU engine at 4000 px meter DSC_8559 0.0026 log H apart (0.769966 vs 0.772571; same on SwiftShader and Metal, so not the filter): grain/DIR/halation at a sampled preview scale? Not explained <!-- t:3nod -->
- [ ] Roll kit (studio-kit kits/roll/src/engine/measure.ts) meters the working image like the first print did: roll analysis on the GPU engine is likely engine-dependent too; meter it on the analysis image (not checked) — now: kits/roll/src/engine/measure.ts readSource evaluates the source cut on the engine's working image; with CHB-035 design 02 P2 <!-- t:ayqx -->
- [ ] A photo's analysis image on the GPU engine comes from the demosaic, the CPU engine's working image from the binned read: 0.0001-0.0004 log H left (DSC_8559 0.778025 vs 0.778406), so a photo within 0.0004 of a 1/6-stop boundary can still differ — now: with CHB-035 design 02 P2 <!-- t:alwi -->
