# Tasks

## TODO
- [x] [stage 1] Apply or decide the contract requests (packages/core 6, dsl 2, gpu 2, ingest 3, apps/studio 3); bump CONTRACT_VERSION to 0.2.0; regenerate docs and the DSL d.ts; record decisions in CONTRACT-DECISIONS.md <!-- t:5618 -->
- [x] [stage 1] Signed filtration: print.expose.filtration as a shift on the database neutral pack (CHB-003 R1); update ArgSpec ranges, mock and reference engines, studio controls <!-- t:tobr -->
- [x] [stage 2] Wire packages/core into packages/gpu: F64Oracle via setOracle()/TableManager({oracle})/table-worker, evalPixelF64 → reference engine output, stocks from PhysicsData; one conventions id <!-- t:ofpq -->
- [x] [stage 2] Replace packages/ingest forward-stub.ts with core's ScannerForward; re-run the Gold 200 ranking golden <!-- t:b253 -->
- [x] [stage 2] Finish CHB-003 open items needed by gpu: f64 tables in Studio node order, engine-ref tabulated mode <!-- t:7pka -->
- [x] [stage 2] Re-run GPU parity against core (reference/tabulated); adjust or explain tolerances that move <!-- t:n3u2 -->
- [x] [stage 3] Switch core to CHB-004 data packs when they land (keep the interim provider for tests) <!-- t:bghy -->
- [x] (merged; branch clean-up moved to CHB-027) [stage 3] Merge task/phase1-integration (and task/ui-guides) to main; delete merged agent worktrees and branches <!-- t:d98b -->
- [x] (moved to CHB-027) [stage 3] Smoke on a real GPU in a normal Chromium: WebGPU canvas presentation in apps/studio (SwiftShader loses the device on present) <!-- t:07g7 -->
