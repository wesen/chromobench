# Changelog

## 2026-11-14

- Initial workspace created


## 2026-11-14

P0 goldens: 58 cases + 2 skipped in packages/conformance/goldens, tools/goldens/render.ts --check exact (commit 03b517d)

### Related Files

- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037-p0/tools/goldens/render.ts — goldens CLI

||||||| c0ab708

## 2026-11-14

P1 Step 2: packages/values (builder core), canonicalJSON moved from the contract, boundaries, 50 tests (commit 22a53d6)

### Related Files

- /Users/manuel/code/wesen/chromobench/packages/values/src/index.ts — The builder core's public API


## 2026-11-14

P1 Step 3: transactions deep-frozen; README immutability wording (commit 2c680b9)

### Related Files

- /Users/manuel/code/wesen/chromobench/packages/values/src/transactions.ts — transaction() deep-freezes


## 2026-11-14

P2a Step 2: contract 1.0 — document format 3, stage laws, one light-law node, mask algebra, one compiler with cuts; recipe model deleted (commit 1dade2e)

### Related Files

- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037-p2a/packages/contract/src/compile.ts — The one compiler


## 2026-11-14

P2a Step 3: laws read params with defaults; final checks (commit b7a973f)

### Related Files

- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037-p2a/packages/contract/src/compile.ts — LawContext.args binds params

||||||| 4f22a4a

## 2026-11-14

P5a: the UI DSL made consistent on @chromobench/values (commits 4afeb8d..aec7c5f on task/chb-037-p5a-ui-dsl)

||||||| 4036ce6

## 2026-11-14

P2b: reference engine, mock and conformance on contract 1.0; goldens as format-3 documents, 60/60 (commits 97d1cb6, bde2495)

### Related Files

- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037-p2b/tools/goldens/translate.ts — The golden translation

||||||| cc246ef

## 2026-11-14

P4 one history: values Log/Draft/plan/diff (102a455, 98af7e8), contract EditLog deleted + LOG_RULES (e4cde19), shell store document tier = the log, Layer -> Draft, routes -> mounts (e236dba); diary 08-phase-p4-history.md

||||||| 1c8eafe

## 2026-11-14

P3 (GPU on contract 1.0): light law fused or as passes, composite.mix, mask algebra, sequential coalesced heal/clone, clarity after core, blurs as one Gaussian; gpu-parity 47 passed on SwiftShader and Metal (commits 384dcb3, 639d6d9)

### Related Files

- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037-p3/packages/gpu/src/engine/light.ts — the light law on the GPU


## 2026-11-15

P6a: the DSL and the agent on contract 1.0 and the values log — frames are views of documents, cuts are compile(doc) nodes, what-ifs frame.with(change), edits values submitted through one door (ask proposes, auto commits, stale → proposal), batches via plan; h.show; MirrorLog deleted (commits 933bc7f, 879b5d7, ef29fc2)

### Related Files

- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037-p6a/packages/agent/src/worker/client.ts — AgentDocs, docs snapshots, replay
- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037-p6a/packages/dsl/src/history.ts — The agent's door into the log


## 2026-11-15

P8a: Editor lab's tools in the engine — composite op set (curve, levels, exposure, hsl, vibrance, grade, mixer, vignette, sharpen), mask components radial and colour, 16 W3C blend modes (separable in linear RGB, non-separable in OkLCh), working encodings as domains with composite.encode inserted by the compiler and fused on the GPU, a fused composite.mix, scene.input; contract 1.1 (CC-020); six golden stacks; parity SwiftShader and Metal 51/51, conformance 516/516 (commits 007a30e, 3c09973, 4299a90, 1d18948)

### Related Files

- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037-p8a/ttmp/2026/11/14/CHB-037--unified-editing-model-implementation-of-chb-035-design-01-v2-stages-with-laws-one-document-builder-core-stack-kit-agent-workbench-editor-lab-tools/diary/11-phase-p8a-ops.md — Phase P8a diary

||||||| b5e8619

## 2026-11-15

P7 links: look functions, presets, bake, rolls on linked media, looks kit on links, sync copy/link, DSL named looks as links, *.cblook.js (commits 33c73c0, 660f5a6, 9c951df, c8f9c4a, 8d7d9c9)

### Related Files

- /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037-p7/packages/contract/src/links.ts — The link mechanism

