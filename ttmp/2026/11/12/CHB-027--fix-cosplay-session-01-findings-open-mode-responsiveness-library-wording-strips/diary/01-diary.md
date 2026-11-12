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

## Step 2: Three workstream agents launched; top bar folded into the menus (scope added to WS-A)

I launched WS-A, WS-B and WS-C as background agents, each in its own git worktree, with a common brief
(`scratchpad/chb027-brief-common.md`: plan as spec, lanes per the ownership table, checks green per commit,
browser tests on per-agent ports, private photos read-only and skipped when absent, their own diary file, no MCP
browser). The user then asked why the host top bar is separate from the menus. There is no technical reason, so
folding it into the menus was added to WS-A's scope by message.

### Prompt Context
**User prompt (verbatim):** "should we address the issues before running the agents? or are you running implementation agents" and "also, couldn't we merge the top bar commands into the menus proper? why is it separate anyway?"
**Assistant interpretation:** Clarify that these are implementation agents (cosplay testers come after the merge);
fold the host bar into the shell's menus.
**Inferred user intent:** Test only after fixing; one place for commands, like a real desktop application.

### What I did
- Agents: WS-A (`task/chb-027-open-mode`, ports 4711/4721–4724), WS-B (`task/chb-027-responsive`, 4811/4821–4824),
  WS-C (`task/chb-027-wording`, 4911/4921–4924).
- Checked where the menus live: the variants' menus and commands are declared in `packages/studio-kit/src/cb.ts`
  (e.g. "Save the Print"); the host bar is plain DOM in `apps/studio/src/main.ts`.
- Message to WS-A: the host registers Open Files… (Ctrl+O), Open Folder…, Reopen, Open as ▸ Auto/Photo/Negative,
  Export… (Ctrl+E, format and space in an export dialog), Save Recipe and View ▸ Layout as runtime commands; the
  menus reference them (hidden in hosts without them); the Undo/Redo buttons go; "offline ready" moves to the
  status bar, "dust" becomes an option; the bar is removed.

### Why
- The bar exists because studio-kit may import only the contract and the shell (CHB-019 boundaries), so host
  actions (decoder, export writer, layouts) were wired as host DOM instead of contributed commands.
- WS-A already owns `main.ts`, the top bar and the File menu; a fourth agent there would conflict.

### What worked
- N/A (in progress).

### What didn't work
- N/A.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- e2e specs that click top-bar controls (`#file`, `#export`, `#variant`, `#photo`) must move with the bar.

### What should be done in the future
- Cosplay testers after the merge: a session-01 re-run, then S01, S05, S09.

### Code review instructions
- N/A.

### Technical details
- The CHB-027 tasks map: 9wcz, j9hg (WS-A), 6p1c (WS-B), ik6l (WS-C).
