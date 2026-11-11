# Tasks

## TODO
- [x] [stage 0] Scaffold packages/studio-kit (cb.core kit, ck stub until CHB-018 lands), apps/studio/variants/, boundary rules for studio-kit and shell; build the tiny variant headless <!-- t:wszu -->
- [x] [stage 1] Move CHB-009 model modules (units, controls, arrangement, history, tools, frame-session) into studio-kit/src/model with their unit tests <!-- t:66wd -->
- [x] [stage 1] Implement the EditLog route (recipes.<frameId> projection, drag preview/commit, 800 ms bursts from GestureController, ctx.recipe.apply) and the proposals projection <!-- t:61qo -->
- [x] [stage 1] Implement the history adapter (global stack of parts, skip-if-stale CB-H401, agent units and approvals as parts) and persistence adapters on KV <!-- t:c5dk -->
- [x] [stage 2] Implement cb.arg with native-range cb.slider, pad, nudge, darkroom unit parsing, cb.panel.controls(arrangement), arrangement audit pass and CB-A diagnostics <!-- t:kt5k -->
- [x] [stage 3] Implement cb.frame handles with a vocabulary parity test against the DSL host, cb.viewer and the render bridge (compile, cut, output.display lowering) <!-- t:cj5o -->
- [ ] [stage 3] Port RenderScheduler behind the bridge with live/bg lanes and the refine pass (CHB-009 ey84); move presenters; measure drag latency (CHB-009 ex7d) <!-- t:oizm -->
- [x] [stage 3] Views 1-4, before/after against initial/snapshot/proposal, densitometer probe tool, pins and readout <!-- t:im5s -->
- [ ] [stage 4] Catalog in the document tier; library views (grid, strip, loupe, compare, survey, frame cells) and catalog commands (flags, stars, labels, collections, keywords, search, apply to selection) <!-- t:rvl9 -->
- [x] [stage 5] History, approvals (Show, Approve all, E_STALE Apply anyway), why and snapshots panels <!-- t:zfyu -->
- [x] [stage 6] Darkroom tools as viewport tools plus panels: test strip with .testStrip() fragment, ring-around (identity and sign tests), masks, exposure list <!-- t:mabn -->
- [ ] [stage 7] Host: boot, services, engine choice, variant registry, ?variant=, menu, dev hot reload, Load Variant, Build Report, explain, window.chromobench hook <!-- t:xupn -->
- [x] [stage 7] lab variant; M1 spec green unchanged; rewrite e2e/studio.spec.ts against the new hook; delete the React UI <!-- t:lv2j -->
- [ ] [stage 8] classic, darkroom and simple variants with explain snapshots and a Playwright smoke per variant (with axe); shortcut sheet and live regions (CHB-009 grer) <!-- t:qv62 -->
- [ ] [stage 9] Reference and GPU engines in the host (boundary decision with CHB-017), chat slot contract with CHB-008, recipe sidecars, precache list <!-- t:7bs1 -->
- [ ] [from CHB-006 2c6h] Playwright test for ingest's browser 8-bit fallback (decodeBrowser) in the studio host <!-- t:tlko -->
- [ ] [from CHB-009 ey84] RenderScheduler refine pass (draft and screen passes exist) and the drag-latency measurement <!-- t:cebs -->
- [ ] [from CHB-009 kygr] Printer-lights colour pad with density readout and typed value entry <!-- t:g4p6 -->
- [ ] [from CHB-009 grer] Keyboard shortcut map, ARIA labels with aria-valuetext in darkroom units, live regions, axe-core checks; build-time precache list for the service worker <!-- t:ktgo -->
- [x] [from CHB-016] Variants receive ck/cb as build arguments and import nothing; kits may import ck/cb as pure modules (reconciles CHB-016 and CHB-019 guides) <!-- t:re11 -->
