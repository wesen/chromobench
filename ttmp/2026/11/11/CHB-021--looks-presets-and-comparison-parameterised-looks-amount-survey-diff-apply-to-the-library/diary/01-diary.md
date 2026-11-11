---
Title: Diary
Ticket: CHB-021
Status: active
Topics:
    - ui
    - product
    - dsl
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T15:10:22.041931605-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-021 Looks, presets and comparison

## Step 1: Intern guide written

I wrote the implementation guide for the looks kit (`cb.looks.*`) after reading the UI design brief, CraftKit's preset, snapshot, sync, reference and survey code, the contract's paths, spec, units, mutations and EditLog, the DSL topics, and the CHB-009 and CHB-012 guides. The central choices: a look resolves to path edits (never stored symbolically), Amount is a recipe pass with a scaling rule chosen per ArgSpec unit, and apply is one plan that drives the dialog, the approval card and the DSL receipt.

The guide is about 7,800 words including code, with 18 staged tasks and 8 related files. Nothing was run; claims come from reading source.

### Prompt Context
**User prompt (verbatim):** "before we move on, now that we have worked out what to do with craftkit, let's create the tickets and design guides (remember, no need to be overly correct in the guides, they are \"guides for impementation\" after all, and we'll sort out details as we work) for the proper UI. Allow the UI to be entirely expressed using the JS API, so that we can create many different versions of it."
**Assistant interpretation:** Write the CHB-021 implementation guide for presets, looks, Amount, comparison and apply, expressed as builder calls.
**Inferred user intent:** A usable guide so implementers can start the looks kit.

### What I did
- Read the writer brief, UI design brief, CraftKit `develop-model.js`, `develop.js`, `develop-scopes.js`, `library.js`, contract `paths.ts`, `recipe.ts`, `spec.ts`, `units.ts`, `mutations.ts`, `editlog.ts`, DSL topics, CHB-009 5.8 and 5.9, CHB-012 sections 3 and 5.6.
- Wrote `design-doc/01-intern-guide.md`, added 18 tasks, related 8 files.

### Why
- CraftKit's linear `scalePreset` is wrong for time and colour temperature, so the guide specifies per-unit rules.

### What worked
- The contract already has pieces to build on: `AutoBalance.method: 'match'`, `finishing.look`, `expect`/`E_STALE`, `ui.scale: 'log2'`.

### What didn't work
- First lookup of the CHB-016 sources used a wrong path (`src/app` under a glob); fixed by listing the directory.

### What I learned
- Brief says the ring-around tool belongs to CHB-019; the guide proposes it be a layout of this kit's survey.

### What was tricky to build
- Keeping "pipeline" looks consistent with "only paths can be applied": resolved by reducing what-if handles to path edits.

### What warrants a second pair of eyes
- Rule defaults in section 4.2 (grade, lights, `finishing.look`), and the grouped-undo request to CHB-019.

### What should be done in the future
- Settle symbolic versus resolved looks after the photographer tries it.

### Code review instructions
- Read `design-doc/01-intern-guide.md`; run `python3 -I ttmp/2026/11/11/CHB-001--*/scripts/08-check-guide-markdown.py` on it.

### Technical details
- Sync groups as path patterns; `ApplyPlan` with shared batch id; approval-scope pass for one card.
