# Changelog

## 2026-11-12

- Initial workspace created

## 2026-11-12

Housekeeping done except dgz9 (shell store/viewport split, waits for CHB-031): CHB-008 and CHB-010 audited (verdicts and follow-ups in their task lists); real engines read TIFF through ingest, one TIFF IFD encoder; RefEngine requires data (nodePacksData, chb001InterimData); engine-gpu.ts, dsl host.ts and the looks and finish kits split into modules (bodies verbatim, GPU conformance 320/320); e2e opens wait for the open flow (e2e/support.ts opened()); no spec writes into ttmp/; 63 unused exports removed (tools/scripts/unused-exports.mjs); reference docs on undo/history and on which engine computes what.

## 2026-11-12

dgz9 done (the last CHB-032 task): shell core/store.ts split into core/store/{types,routes,readonly,path-index,derived,layers,snapshot,draft}.ts (store.ts keeps the Store class and re-exports; route/readonly/layer/snapshot are delegates to attachRoute/readonlyView/namedLayer/snapshotOf) and dom/viewport.ts into dom/viewport/{state,colour,geometry,pointer,paint,render,thumb}.ts (mountViewport creates the parts in the original order of cells and listeners). Bodies verbatim (scripts/dgz9-verify-split.py: 47/47 segments); importers unchanged; unit tests 101 files 2770 passed; browser 101 passed, GPU conformance 320/320; no snapshot changed. The undo/history reference doc's store.ts line citations re-pointed.

## 2026-11-12

Ticket closed: all tasks done (audits of CHB-008/CHB-010 with follow-ups filed there; engines stop importing the mock; one TIFF writer; RefEngine data required; engine-gpu, dsl host, looks/finish kits, shell store/viewport split; e2e open waits; reference docs on undo/history and engines; 63 unused exports removed). Merged into main as 02fd314 and d56c653.
