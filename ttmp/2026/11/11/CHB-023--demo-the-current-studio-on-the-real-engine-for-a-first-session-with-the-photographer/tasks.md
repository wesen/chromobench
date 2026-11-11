# Tasks

## TODO
- [x] [stage 1] Host wiring: one allowed host file in apps/studio that builds the engine (boundary exception in tools/scripts/check-boundaries.ts, as CHB-019's guide proposes); GpuEngine when WebGPU works, RefEngine (core, preview size) as fallback; engine choice shown in the status line <!-- t:gdas -->
- [x] [stage 1] Data: the engine uses CHB-004's data packs (packages/data) via PhysicsData; packs served as static files by the studio's Vite config <!-- t:53u2 -->
- [x] [stage 2] Open the photographer's files through packages/ingest: TIFF/PNG (16-bit), DNG and camera RAW via LibRaw in a worker (Vite: exclude @colorhythm/libraw-wasm from optimizeDeps or pass wasmUrl); scan conditioning (rebate/base, flare, dust) on open <!-- t:if75 -->
- [x] [stage 2] Automatic first print: inversion to film dyes, default paper and enlarger, auto balance to grey (core balance: greyPick/integrateToGrey) so a fresh scan opens as a sensible print <!-- t:osbf -->
- [x] [stage 3] Controls on the real engine: enlarger time (s/stops), signed Y/M/C filtration, grade, printer lights; before/after; Print/Negative/Dyes/Base views; densitometer probe; history and undo <!-- t:vjlj -->
- [x] [stage 3] Test strip and ring-around render with the real engine (not the mock's fixed 10 s) <!-- t:4tex -->
- [x] [stage 4] Export: 8-bit sRGB/P3 PNG now; switch to CHB-011's 16-bit TIFF/PNG encoder when it lands <!-- t:ar6l -->
- [x] [stage 4] Static build that runs offline: pnpm --filter @chromobench/studio build + a one-page 'how to run it' note (Chrome/Edge, open a folder of scans); smoke e2e on the real engine with the M1 fixture <!-- t:z86l -->
- [ ] [stage 5] Try on a real GPU in a normal Chromium (WebGPU presentation untested on hardware); record frame times for a 24 MP scan <!-- t:4h85 -->
