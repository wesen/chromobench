# Tasks

## TODO
- [x] [stage 1] Look builder: cb.look, ArgSpec-shaped params (cb.slider), cb.set/cb.add, resolve, lookEdits(handle), Preset types and validation, bake <!-- t:v31z -->
- [x] [stage 2] Amount pass: ruleFor per ArgSpec unit, scale (linear/stops/mired/step/keep), from current|defaults, range diagnostics with clamp fix <!-- t:aw07 -->
- [x] [stage 2] CraftKit parity test: linear rules reproduce scalePreset fixtures <!-- t:zxmv -->
- [x] [stage 3] Diff pass: diffRecipes with per-unit formatters (s to stops, logH to points, CC) and tolerances; golden strings <!-- t:8est -->
- [x] [stage 4] Sync groups as path-pattern table; wildcard matching; per-variant override <!-- t:v183 -->
- [x] [stage 4] ApplyPlan builder and target selectors (selection, roll, collection, library, where predicate, unedited) <!-- t:fu6a -->
- [x] [stage 4] User apply as one batch with shared tx; request CHB-019 history adapter for grouped undo across frames <!-- t:pq9g -->
- [x] [stage 4] Agent apply: propose per frame with expect, approval-scope pass coalescing to one card, E_STALE apply-anyway/skip <!-- t:dwd5 -->
- [ ] [stage 5] Snapshots (record, restore as set batch) and virtual copy command (frame.add + virtualOf) — now: snapshots exist (studio-kit/src/commands/print.ts:20-40); remaining: virtual copies (looks.virtualCopy is a disabled stub, kits/looks/src/commands.ts:392) <!-- t:7hew -->
- [x] [stage 5] viewer.compareWith fragment: before, defaults, snapshot, frame, look sources; modes; same-recipe-same-pixels test <!-- t:v7ct -->
- [ ] [stage 5] Reference frame and looks.match (measure.stats to time/lights edits); decide print.lights.auto bookkeeping — now: looks.setReference exists; looks.match is a disabled stub (kits/looks/src/commands.ts:393); Roll ▸ Print the Roll Like the Reference covers rolls <!-- t:ji7o -->
- [x] [stage 6] Survey and tile forms as theta cells on bg lane, cache by node id; sweep.ring and sweep.axis <!-- t:8c6f -->
- [x] [stage 6] Settle ring-around ownership with CHB-019 (tool layout vs survey tile pipeline) <!-- t:nuxk -->
- [x] [stage 7] Library form: groups, thumbnails, favourites, hover preview, save-as-preset; params and amount forms — done: kits/looks/src/panels.ts:105-132 (groups, thumbnails, favourites, Preview), looks.saveAsPreset, looks.param, looks.amount (kits/looks/src/commands.ts) <!-- t:fco9 -->
- [x] [stage 7] Preset files (.cbpreset.json) read/write, migrate pass, needs-review state; sandboxed evaluation of imported looks — done: .cbpreset.json export and import with a needs-review state (kits/looks/src/dom.ts:227, commands.ts:353-372); .cblook.js evaluated in the sandbox (CHB-037 P7); no migrate pass after the cut-off <!-- t:44cg -->
- [x] [stage 8] Film looks over CHB-012 data pack with requires digital-raw; discrete stock rules — superseded by CHB-037 P7 (CC-021): film-stock looks were deleted, looks are link functions; medium presets are an open owner decision (docs/HANDOFF.md §9) — decided D6; medium presets done in CHB-048 (0588159) <!-- t:xw53 -->
- [x] [stage 8] DSL: frame.look, cb.looks.apply/diff, topic looks.md with runnable examples <!-- t:lm77 -->
- [x] [stage 8] Wire kit into the four variants; Playwright smoke and the section 9 flow as acceptance — done: the looks kit is in the layouts ("variant" is now layout: layouts/looks.js, Settings menu in classic.js and darkroom.js), studio-kit/test/browser/looks.spec.ts, e2e/walkthrough.spec.ts walkthroughs 1 and 3 <!-- t:eoll -->
- [x] [host] apps/studio: pass cb.kits.looks.provider(() => state) to the agent's DslSession (with CHB-008's chat) — superseded by CHB-037 P7 and P6b: looks are registered in the contract's link registry, the agent reaches them through links and cb.looks.define (apps/studio/src/host/chat.ts:59, host/workbench.ts:57) <!-- t:v253 -->
- [ ] [perf] cache survey/library captions per (look, params, recipe hash) before the library grows past ~20 looks (planFrame ≈ 1 ms with diff) — now: keyed per (look, params, document hash) <!-- t:kzh2 -->
- [ ] [stage 5] cb.arg(...).vsSnapshot() marker fragment (diff against the compare source) — (check: still wanted? the looks panel already shows a diff against the compare source) <!-- t:8neb -->
