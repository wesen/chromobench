---
Title: Diary
Ticket: CHB-022
Status: active
Topics:
    - ui
    - image-pipeline
    - product
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T15:10:22.182485997-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-022 Finish and retouch

## Step 1: Intern guide written

I read the UI design brief, the CraftKit tools (`develop-tools.js`, `develop-model.js`, the Workbench retouch ops in `vendor/wb/ck-catalog.js`), the contract's output/finishing/mask catalog, `recipe.ts`, `mutations.ts`, the dust heal in `packages/ingest`, and the CHB-006 and CHB-011 guides, then wrote `design-doc/01-intern-guide.md` (about 7,400 words with code). The main findings: the contract has `scan.crop` (axis-aligned box) and `scan.orientation` but no angle and no place for them on digital-RAW frames; `retouch` has no home yet; `finishing.*` ops exist on `print-xyz`.

The guide proposes a `view.frame` contract change, a `retouch.heal` op with spots stored as a record in the recipe, a patch-pass plus pointwise-composite engine design so spots are tile-clean, and the kit as builder calls, fragments, passes and agent counterparts. The Workbench ops are an optional, licence-gated provider.

### Prompt Context
**User prompt (verbatim):** "before we move on, now that we have worked out what to do with craftkit, let's create the tickets and design guides (remember, no need to be overly correct in the guides, they are \"guides for impementation\" after all, and we'll sort out details as we work) for the proper UI. Allow the UI to be entirely expressed using the JS API, so that we can create many different versions of it."
**Assistant interpretation:** Write the CHB-022 implementation guide (finish kit) following the shared UI brief.
**Inferred user intent:** A usable plan for crop, straighten, heal, clone and finishing tones as part of a JS-expressed studio.
**Commit (code):** none (the orchestrator commits all guides together)

### What I did
- Read the writer brief, the UI design brief, `develop-tools.js` (crop 56-150, heal 153-217, masks 225-392), `constrainCrop`, `vendor/wb/ck-catalog.js` retouch lines, `view-output-mask.ts`, `measure-darkroom-finishing.ts`, `recipe.ts`, `mutations.ts`, `dust/heal.ts`, `dust/specks.ts`, `apps/studio/src/core/{gesture,tools}.ts`, `ui/tools/Masks.tsx`, CHB-006/CHB-011 guides (grep).
- Wrote the guide, 17 tasks (`docmgr task add`), 8 related files, ran the markdown checker.
- Computed the worked example with `node`: 1.3 degrees, 4:5 in 3000x2000 gives a 1568x1960 crop at (716, 20); two sample spots map to shown (494, 706) and (1485, 1386).

### Why
- Spots as a record (not an array like dust) so per-spot staleness works; source stored explicitly so the engine never searches; patch pass plus pointwise composite so tiling needs no irregular halo.

### What worked
- The checker passed (7,423 words, 22 code blocks). The contract already has the pieces (masks, finishing ops, EditLog, gesture preview/commit).

### What didn't work
- No failures observed. I did not run any test or the app; everything is read from source.

### What I learned
- `output.frame` has `recipePath: 'scan'`, so digital-RAW frames cannot be cropped today. There is no straighten angle in the contract. CHB-011 already requires finishing before the knee.

### What was tricky to build
- Deciding where heal sits (after `view.adapt`, before `finishing.*`) and which coordinate frame each stored thing uses (spots in un-oriented source px, crop in the rotated canvas).

### What warrants a second pair of eyes
- The `view.frame` contract proposal and its order (orient, rotate, crop); log-XYZ heal offset near black (TODO); whether `set ... null` delete fits `checkSet`.

### What should be done in the future
- Contract requests to CHB-017; CHB-005 review of the patch-pass design; licence answer for `vendor/wb`.

### Code review instructions
- Read `design-doc/01-intern-guide.md` sections 3, 6, 7, 10. Validate with `python3 -I ttmp/2026/11/11/CHB-001--*/scripts/08-check-guide-markdown.py <guide>`.

### Technical details
- Sign convention proposed: `angle_deg` positive is clockwise; rotation about the centre of the oriented source; crop box in canvas px.
