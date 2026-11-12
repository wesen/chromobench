# Tasks

## TODO
- [x] Audit CHB-008 open tasks against the code (verdict + file:line per task); tick done, move genuine leftovers to a follow-up list in CHB-008 or close it <!-- t:p4cv -->
- [x] Audit CHB-010 open tasks the same way (test strip golden numbers, Jacobian parity tolerances, contact sheet, contract requests C1–C8) <!-- t:c7sw -->
- [x] Real engines stop importing the mock engine: core/src/engine-ref.ts and gpu/src/engine-gpu.ts import readTiff from @chromobench/ingest; delete the engine-mock tiff16.ts shim (keep exports the mock needs) <!-- t:02r5 -->
- [x] One 16-bit TIFF writer: consolidate ingest/src/decode/tiff-write.ts and output/src/encode/tiff16.ts (fixtures use the output writer or a thin wrapper) <!-- t:i6gf -->
- [x] 'interim data' naming: core's RefEngine stops defaulting to the Node-only nodePhysicsData (data required, or an explicit node helper); rename legacyInterimData; keep Chromogen legacy CMFs as tests-only, documented <!-- t:0tc4 -->
- [x] Docs: undo/history across contract editlog, studio-kit editlog-route, shell history, studio-kit model/history — one page with a sequence diagram <!-- t:m6qo -->
- [x] Docs: which engine computes what — StudioEngine host ops (output.frame, view.inspect, invert.classes/classify, P3) vs the physics engines vs the engine worker; one page with a diagram <!-- t:vrrs -->
- [ ] Review e2e specs that wait on status text (grep toContainText) and switch them to idle()-based waits where they race <!-- t:vuwz -->
- [x] Code clean-up: split packages/gpu/src/engine-gpu.ts (1012 lines: pipelines, caches, DAG evaluation, readback) into modules; behaviour and parity unchanged (conformance 320/320) <!-- t:kiq4 -->
- [ ] Code clean-up: split packages/dsl/src/host.ts (804 lines) by vocabulary area; generated bindings and DSL tests unchanged <!-- t:6qs1 -->
- [ ] Code clean-up: split the looks and finish kits (kits/looks/src/kit.ts 800, kits/finish/src/kit.ts 724) into state/commands/panels modules <!-- t:j38l -->
- [ ] Code clean-up, after CHB-031 merges and before CHB-029: split packages/shell/src/core/store.ts (775) and packages/shell/src/dom/viewport.ts (723) <!-- t:dgz9 -->
- [ ] Code clean-up: dead code and unused exports (ts-prune or a knip run over the workspace); remove what nothing uses, list what is kept on purpose <!-- t:z99j -->
