---
Title: Diary
Ticket: CHB-017
Status: active
Topics:
    - architecture
    - testing
    - color-science
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T15:10:21.46066051-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-017 Phase-1 close-out

## Step 1: Ticket created with tasks, no guide

CHB-017 collects the work that turns five parallel Phase-1 branches into one consistent system: the contract
requests, one physics implementation shared by the reference and GPU engines (and ingest's stock ranking), the
CHB-004 data packs, and the merge to main. It has no intern guide on purpose: its spec is the five
`CONTRACT-REQUESTS.md` files, the `TODO(CHB-0NN)` markers in packages/gpu and packages/ingest, and CHB-001 diary
Step 7.

### Prompt Context

**User prompt (verbatim):** "CHB-004: approve. before we move on, now that we have worked out what to do with
craftkit, let's create the tickets and design guides (remember, no need to be overly correct in the guides, they
are \"guides for impementation\" after all, and we'll sort out details as we work) for the proper UI. Allow the UI to
be entirely expressed using the JS API, so that we can create many different versions of it."
**Assistant interpretation:** Create the UI tickets with guides; CHB-017 (proposed in the same plan) is created
alongside as the non-UI close-out, with tasks only.
**Inferred user intent:** Have the whole next phase laid out as tickets before implementation resumes.
**Commit (code):** see the commit that files the UI guides — "CHB-016..022: UI implementation guides"

### What I did

- `docmgr ticket create-ticket --ticket CHB-017 …`, `docmgr doc add --doc-type diary`, nine `docmgr task add`.

### Why

- A guide would only restate the request files and TODO markers, which are already precise.

### What worked

- Tasks added.

### What didn't work

- No failures.

### What I learned

- N/A.

### What was tricky to build

- N/A.

### What warrants a second pair of eyes

- The order inside stage 1: signed filtration touches ArgSpec ranges that CHB-009's generated controls and the
  test-strip/ring-around goldens depend on.

### What should be done in the future

- Start after the UI guides are filed; CHB-004 (running) feeds stage 3.

### Code review instructions

- `docmgr task list --ticket CHB-017`; the request files under `packages/*/CONTRACT-REQUESTS.md` and
  `apps/studio/CONTRACT-REQUESTS.md`.

### Technical details

- Conventions ids to unify: `core-v1:opaque/cie1931-2deg/subtract/model-3cdf/midgray-geomean` (core) and
  `chromogen-interim-0` (gpu).
