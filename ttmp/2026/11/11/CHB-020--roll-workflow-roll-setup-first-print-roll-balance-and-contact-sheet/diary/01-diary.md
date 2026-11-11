---
Title: Diary
Ticket: CHB-020
Status: active
Topics:
    - ui
    - darkroom
    - ingest
    - product
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T15:10:21.908139315-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-020 Roll workflow

## Step 1: Intern guide written

I wrote the implementation guide for the roll kit (`cb.roll.*`): roll setup, automatic first print, contact sheet and cull, and "print the roll like this frame" as one mutation batch. The guide reads the Phase-1 conditioning and balance code and maps roll analysis onto it as a pass producing a shared roll fragment plus per-frame deltas. The central finding is that roll balance needs no new colour maths: `integrateToGrey` with the reference frame as the aim is "print like this frame".

I also added 15 staged tasks and related 8 files. The guide is about 7,600 words including code. Nothing was run beyond the markdown checker; all numbers are copied from the CHB-006/003 guides or marked illustrative.

### Prompt Context
**User prompt (verbatim):** "before we move on, now that we have worked out what to do with craftkit, let's create the tickets and design guides (remember, no need to be overly correct in the guides, they are \"guides for impementation\" after all, and we'll sort out details as we work) for the proper UI. Allow the UI to be entirely expressed using the JS API, so that we can create many different versions of it."
**Assistant interpretation:** Write the CHB-020 implementation guide following the UI brief and the writer brief.
**Inferred user intent:** A usable starting point for building the roll workflow as a swappable kit.
**Commit (code):** none (the orchestrator commits all guides).

### What I did
- Read the UI design brief, the writer brief, `packages/ingest/src/conditioning/*`, `packages/core/src/print/balance.ts`, `packages/contract/src/{recipe,paths,mutations,editlog}.ts`, the source-scan-invert and darkroom catalogs, and CraftKit `cull.js`, `library.js`, `develop-model.js`.
- Skimmed CHB-006, CHB-003, CHB-010 and CHB-013 guides for Gold 200 numbers, balance and the sample-roll layout.
- Wrote `design-doc/01-intern-guide.md`, added tasks, related files, ran `08-check-guide-markdown.py` (clean).

### Why
- Copy shared settings into each frame (decision record 1) instead of inheritance, to keep recipes self-contained for sidecars, content addressing and the closed mutation set.

### What worked
- `AutoBalance` already has `roll` and `match` methods, so the contract needs few additions.

### What didn't work
- The CHB-016 guide is still a template, so kit/fragment/pass API shapes follow the brief's section 5 and may need adjusting to it.

### What I learned
- `scan.rebate` is a frame-local box, so a roll-wide base has no home in the recipe (proposed `scan.baseT`).
- Flare is one number in the recipe, but ingest fits it per channel.

### What was tricky to build
- Deciding how a cross-frame batch relates to independent per-frame EditLogs: proposed a `batch` id on `LoggedMutation`.

### What warrants a second pair of eyes
- The mapping from "roll consistency" to alpha and its default (0.5 first print) are guesses.
- The illustrative frame numbers in the traced flow.

### What should be done in the future
- Confirm the proposed contract additions with CHB-002/017 and reconcile API names with the final CHB-016 guide.

### Code review instructions
- Read `design-doc/01-intern-guide.md` sections 4, 6 and 7 first. Check with `python3 -I ttmp/2026/11/11/CHB-001--*/scripts/08-check-guide-markdown.py <guide>`.

### Technical details
- Balance reuse: `integrateToGrey(latd_f, {latd: latd_ref, lights: lights_ref}, alpha)` in `packages/core/src/print/balance.ts`.
