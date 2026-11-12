---
Title: Diary
Ticket: CHB-030
Status: active
Topics:
    - ui
    - agent
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-12T16:06:09.907081879-05:00
WhatFor: ""
WhenToUse: ""
---

## Step 1: Ticket created from the UI DSL review

The user asked whether the current UI is built with the UI DSL. It is, except for a hand-built host layer (status
line, dialogs, open flow) and some structural seams. Ten streamlining items came out of reviewing the layouts,
`createCb()` and the host wiring. After a complexity assessment the user chose to do all of them as planned:
items 1–9 in CHB-029, item 10 (agent-written layouts in the sandbox) in CHB-030.

### Prompt Context
**User prompt (verbatim):** "yes, we want to streamine the DSL. ANy other things that come to mind?", then "any of those adding much complexity?", then "it's fine, we can do them all as planned, no need to compomise. Create a new docmgr ticket for 1-9, and one for 10."
**Assistant interpretation:** Two tickets with plans and tasks; no scope reduction from the complexity notes.
**Inferred user intent:** A UI that is entirely expressed in the DSL, including what the assistant may write.
**Commit (code):** N/A (planning).

### What I did
- Read `packages/studio-kit/variants/classic.js` (menus, modules), `packages/studio-kit/src/cb.ts` (host commands
  with `hidden: s => !hostHas(...)`, `run: ctx => hostRun(...)`), the layouts' imports of `classic.js`, the
  host's hand-built DOM in `apps/studio/src/main.ts`.
- `docmgr ticket create`, `design-doc/01-plan.md`, tasks, this diary.
- CHB-028: the glossary task moved to CHB-029 item 9; "Load Variant" moved to CHB-030; hot reload kept in CHB-028.

### Why
- Item 10 depends on items 1, 4, 7 and 9 and needs a design study (selectors across the sandbox boundary), so it
  is a ticket of its own.

### What worked
- N/A.

### What didn't work
- N/A.

### What I learned
- Complexity notes kept in the plans: the jobs model must end jobs in `finally` and throttle progress writes;
  renders are derived from the render queue, not reported; dialogs stay imperative with DSL-built bodies.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- CHB-029 item 8 changes the contract's catalogue metadata (minor version bump).

### What should be done in the future
- Start CHB-029 after CHB-027 merges (B and D still touch `main.ts`, the queue and `cb.ts`).

### Code review instructions
- `design-doc/01-plan.md`.

### Technical details
- The progress indicator proposed as CHB-027 "WS-E" is CHB-029 items 5 and 6.
