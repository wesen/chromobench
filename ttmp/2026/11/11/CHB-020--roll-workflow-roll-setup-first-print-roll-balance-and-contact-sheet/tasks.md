# Tasks

## TODO
- [x] [stage 1] Roll model types (Roll, RollFragment, RollAnalysisRecord) and divergence detection in kits/roll/src/model.ts <!-- t:3cg2 -->
- [x] [stage 1] analyseRoll: per-frame rebate/sigma/classes/LATD at a fixed analysis size, roll base median, stock ranking, spread check <!-- t:5za7 -->
- [x] [stage 1] Synthetic planted roll fixtures from the Gold 200 sample (base offsets, noise, one mixed frame) and Gold 200 golden tests at 640 and 1090 px <!-- t:ovf4 -->
- [x] [stage 2] firstPrint lowering: shared fragment + per-frame rebate + auto lights (method roll, r default) as by:'auto' batch <!-- t:t7y5 -->
- [x] [stage 2] matchBatch via integrateToGrey with the reference frame as aim; skip hand-edited and rejected frames; expect/E_STALE <!-- t:pdf8 -->
- [x] [stage 2] Batch passes: staleness, coalescing, approval scope; grouped undo across frame EditLogs (needs batch id proposal) <!-- t:1r6r -->
- [x] [stage 3] rollKit declaration (ck.kit), state slice, commands table, key map, CB-R001..R003 build passes with computed fixes <!-- t:ez8u -->
- [x] [stage 3] Headless variant using .use(rollKit): zero error diagnostics and ck.explain snapshot <!-- t:g5ku -->
- [x] [stage 4] cb.roll.library, card, setup, row with evidence lines, overrides and 'overridden on N frames' note; import flow <!-- t:umlu -->
- [x] [stage 5] cb.roll.contactSheet and contactCell (theta on bg lane, node-id cache), balanced/single modes, cull hints <!-- t:85wk -->
- [ ] [stage 5] cb.roll.cullKeys, peek spring, roll.cull.sweep; flags/stars in catalog (undoable) <!-- t:mv3s -->
- [ ] [stage 6] cb.roll.balanceBar, pending-batch preview on the sheet, approval card with before/after thumbnails and skipped list <!-- t:5x10 -->
- [ ] [stage 7] Fragments: film-strip roll badge, cb.arg rollScope(), frame handle roll(); inspector form <!-- t:nzkv -->
- [x] [stage 7] Playwright smoke per variant: import, first print, flag, set reference, match, approve, undo <!-- t:21al -->
- [ ] [stage 8] Integrate CHB-010 auto print/filtration and CHB-013 scanner model (per-channel flare); contract additions request to CHB-002/017 <!-- t:wb5j -->
- [ ] [from CHB-005 erm0] GPU reductions for roll analysis: pairwise means and LATD, median of Y, gamut-class counts (histogram, stats, patches, densitometer already exist); f64 core computes them meanwhile <!-- t:qvyu -->
- [ ] [from CHB-006 3wlu] Time a 40-megapixel frame through the dust path on the GPU; reuse packages/gpu's Gaussian blur for the trend <!-- t:j972 -->
