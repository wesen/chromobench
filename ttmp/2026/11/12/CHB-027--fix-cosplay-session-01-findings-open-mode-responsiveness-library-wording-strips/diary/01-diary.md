---
Title: Diary
Ticket: CHB-027
Status: active
Topics:
    - ui
    - product
    - ingest
    - performance
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-12T13:37:03.038592631-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary (orchestrator)

The orchestrator's record for CHB-027. The workstream agents keep their own diaries next to this one
(`02-diary-ws-a-…`, `03-diary-ws-b-…`, `04-diary-ws-c-…`), so parallel branches never conflict on one file.

## Step 1: Ticket and plan from the CHB-026 findings

I turned the 16 findings of the first cosplay session into a ticket with four workstreams. Before writing the
plan I read the code each finding points at, so the workstreams split along file boundaries: WS-A (open mode,
frame identity, library), WS-B (responsiveness: worker, drafts, caching), WS-C (wording, forms, messages), WS-D
(strip → frames, after A). A, B and C run in parallel in worktrees.

### Prompt Context
**User prompt (verbatim):** "Ok, create a new docmgr ticket to address all these issues, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill). Then implement, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill). You can use a subagent."
**Assistant interpretation:** One ticket for all CHB-026 findings, a plan, then the implementation, with diaries and
commits; subagents allowed.
**Inferred user intent:** Make the app usable for his father, with the evidence trail kept.
**Commit (code):** see the commit after this step.

### What I did
- Read `packages/shell/src/app/render/queue.ts` (latest-wins, abort of superseded work, live/bg lanes),
  `apps/studio/src/host/engines.ts` (decode switch, `createHostEngine`: `RefEngine` at 512 px when there is no
  WebGPU), `packages/studio-kit/src/bridge/render-bridge.ts`, `packages/ingest/src/conditioning/film-layout.ts`
  (one `crop` per scan, so no frame splitting), `tools/scripts/check-boundaries.ts` (only `engines.ts` may import
  core/gpu/ingest).
- `docmgr ticket create --ticket CHB-027 …`; plan `design-doc/01-implementation-plan.md`; 7 tasks; four
  diary docs.

### Why
- The queue already drops stale work and aborts in-flight requests, but `RefEngine.evaluate` runs synchronously on
  the main thread, so neither the abort nor the draft pass can help. That makes moving it to a worker the core
  of WS-B, not tuning the queue.
- Splitting a strip is new detection work in ingest plus a change of frame identity (one sha → several
  frames), so it waits for WS-A's identity change.

### What worked
- The split along file ownership: main.ts and engines.ts are the only shared files (table in the plan).

### What didn't work
- N/A.

### What I learned
- The viewport already has draft / screen / refine passes (`packages/shell/src/dom/viewport.ts:293`), and the
  refine pass asks for the visible region past 1:1: the plumbing for a sharp 1:1 view exists; the 512 px working
  image is the limit on the CPU path.

### What was tricky to build
- N/A (planning).

### What warrants a second pair of eyes
- The Auto classifier (photo vs negative): a camera *scan* of a negative is also a NEF, so the decision must rest
  on content (orange mask, film edge), with an "ask" fallback.

### What should be done in the future
- Folding the host top bar into the shell stays an open user decision (not in this ticket).

### Code review instructions
- Start at `design-doc/01-implementation-plan.md`.

### Technical details
- Workstream branches: `task/chb-027-open-mode`, `task/chb-027-responsive`, `task/chb-027-wording`,
  `task/chb-027-strip-frames`.
