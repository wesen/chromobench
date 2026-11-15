---
Title: Diary
Ticket: CHB-037
Status: active
Topics:
    - architecture
    - ui
    - webgpu
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-14T20:56:48.483448-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

The main agent's record of implementing CHB-035 design 01 v2 (the unified editing model) in chromobench: the plan,
each wave of phase agents, every merge into the integration branch, the checks, and the decisions made along the way.
Phase agents keep their own diaries in this ticket (`diary/NN-phase-*.md`).

## Step 1: Ticket, integration branch, plan, baseline

The owner asked to implement the whole v2 design with subagents, each keeping a diary, committing at intervals, and
to bring in Editor lab's functionality. The work is ~80 k lines across 12 packages and the app, so it runs as waves
of phase agents on their own branches, merged by the main agent into one integration branch.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all."

**Assistant interpretation:** Implement design 01 v2 phases 0–9 (goldens, builder core, contract 1.0 with stage
laws, GPU, one history, UI DSL and stack kit, agent workbench, links, Editor lab's op set, integration), with
subagents and diaries, committing as phases land.

**Inferred user intent:** The studio rebuilt on one coherent core, with the full layer toolset, ready for the
photographer.

**Commit (code):** (this step's commit) — ticket, plan, diary

### What I did
- Integration branch `task/chb-037-unified-model` from `origin/main` (aaea9af, PR #2 merged), CHB-035 merged in
  (b3445d3: the v2 design is on the branch); worktree `<scratchpad>/chb037`, so the pattern-experiment batch running
  from the main checkout is untouched.
- Baseline: `pnpm install --frozen-lockfile --prefer-offline`; typecheck, lint, gen:check rc=0; vitest 105 files,
  2797 passed, 19 skipped.
- Read the boundary rules (`tools/scripts/check-boundaries.ts`): the contract imports only `@noble/hashes`; the shell
  imports nothing. A shared builder core therefore needs one new leaf package, `packages/values`, that both may import.
- Ticket CHB-037; `design-doc/01-implementation-plan-and-working-rules.md`: working rules (diaries, commits, checks,
  headless browsers, ports per phase, the GPU lock, privacy, scope), branch protocol, phases P0–P9 with ownership
  and dependencies, and the wave 1 specs (P0 goldens, P1 builder core).

### Why
- Waves keep agents from editing the same files; one integration branch keeps one place green.

### What worked
- The CHB-035 merge was clean; baseline green.

### What didn't work
- N/A

### What I learned
- Package boundaries are enforced by a script; the design's "one builder core" needs a boundary change, recorded in
  the plan.

### What was tricky to build
- Ordering: the UI rules (P5a) need the value model (P1), and everything that consumes recipes breaks when the
  contract cuts over (P2) until P4–P6 land. The plan accepts a red integration branch between waves 2 and 4 and asks
  each phase to keep its own packages green.

### What warrants a second pair of eyes
- The phase table in the plan (§4): ownership boundaries between P2, P4 and P5b around the history.

### What should be done in the future
- Launch wave 1 (P0, P1); then P5a; then P2.

### Code review instructions
- `design-doc/01-implementation-plan-and-working-rules.md`.

### Technical details
- Worktrees: `<scratchpad>/chb037` (integration), `<scratchpad>/chb037-p<id>` (phases).
