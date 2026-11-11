# Tasks

## TODO
- [x] [stage 1] Set up the pnpm workspace, strict tsconfig.base.json, pinned dependencies and lint rules that enforce the contract-only import boundaries <!-- t:766j -->
- [x] [stage 1] Configure Vitest and the Playwright chromium-webgpu project; add tools/wgsl-check with a smoke compute shader that runs in headless CI <!-- t:0f75 -->
- [x] [stage 1] Write the CI workflow: typecheck, lint, generated-file drift check, contract:check, unit/law/conformance tests, e2e <!-- t:8gl0 -->
- [x] [stage 2] Implement domains.ts (Domain, ImageInfo, DOMAINS table) and units.ts (Quantity, allowed conversions, Hunt 14.17 refusal) <!-- t:4i5a -->
- [x] [stage 2] Implement spectrum.ts (GRID, SpectrumKind, productKind/sumKind) and errors.ts (Diagnostic, ChromobenchError, code list) <!-- t:9kcd -->
- [x] [stage 3] Implement registerOp validation, bindArgs (defaults, hard/soft ranges, redirects with converted fixes, did-you-mean) and closest() <!-- t:gmpo -->
- [x] [stage 3] Write the v0 catalog stubs for all twelve areas with arguments, units, ranges, defaults and recipe paths <!-- t:87ih -->
- [x] [stage 3] Build tools/gen-docs output: op-args.ts, per-area reference pages and catalog.snapshot.json <!-- t:l5at -->
- [x] [stage 4] Implement Graph.intern with synchronous SHA-256 node ids, domain checks, closure/adopt, and compile(recipe) <!-- t:3uvu -->
- [x] [stage 5] Implement the FrameRecipe validator, defaultRecipe, settablePaths and the migrations scaffold <!-- t:n0k6 -->
- [x] [stage 5] Implement EditLog: journal, undo units and cursor, preview overlay, modes, pending with expect/E_STALE, why(), state and log hashes <!-- t:y1b1 -->
- [x] [stage 6] Define Engine, EvalTarget (with signal), SourceInfo, ImageResult, Measurement, EngineCaps and the eval types <!-- t:8hli -->
- [x] [stage 7] Implement engine-mock for every catalog op, the temporary 16-bit TIFF reader and the M1 fixture generator; reproduce the §6 numbers <!-- t:jw3q -->
- [x] [stage 8] Build packages/conformance: generated cases, runConformance, mutants that must fail, and the law harness with the contract laws <!-- t:6q1m -->
- [x] [stage 9] Create the minimal apps/studio page and e2e/m1-walking-skeleton.spec.ts covering open, drag, undo and an approved agent proposal <!-- t:18rm -->
- [x] [stage 9] Record the §11 contract notes and the change-note template in the CHB-002 changelog as v0 changes <!-- t:hjnf -->
