---
Title: Diary
Ticket: CHB-031
Status: active
Topics:
    - ui
    - product
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-12T17:06:19.617452823-05:00
WhatFor: ""
WhenToUse: ""
---

## Step 1: Ticket from cosplay session 02

Session 02 (a Sonnet tester re-running session 01 against main 3703d0a) confirmed 11 of the 16 session-01
findings fixed and found seven new ones (F17–F23, CHB-026 `various/02-findings.md`, session 02 section). The most
important: Time and Aperture are inert in the default enlarger mode `normalised`. The owner accepted the
recommendation: real mode by default for the darkroom-style layouts, normalised (with Time and Aperture hidden) as an
option and the default of the simple layouts, after verifying the test strip and the first print.

### Prompt Context
**User prompt (verbatim):** "1. what's the advantage of normalized and hiding?" (answered with a comparison), then "ok. \n\nwhat's next?"
**Assistant interpretation:** "ok" accepts the recommendation; next is the follow-up ticket and closing CHB-027.
**Inferred user intent:** The darkroom controls should do what they say.
**Commit (code):** N/A (planning).

### What I did
- `docmgr ticket create --ticket CHB-031`; 11 tasks (F17 split into verify / real default / normalised option;
  F18–F23; the partly fixed F8, F9, F12 and F10 on the CPU; a session-03 re-run).

### Why
- CHB-027's scope was the session-01 findings; the new ones get their own ticket and acceptance re-run.

### What worked
- N/A.

### What didn't work
- N/A.

### What I learned
- `packages/core/src/print/enlarger.ts`: "Real mode: the setting's optics … Normalised mode ignores them."
  `packages/contract/src/catalog/capture-film-print.ts`: `mode` default `normalised`.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Changing the default enlarger mode changes how saved recipes print (they store `mode` explicitly, so existing
  logs keep theirs; new recipes get the new default). Check `defaultRecipe` and the first print.

### What should be done in the future
- Coordinate with CHB-029 (both touch `cb.ts` and the controls panels).

### Code review instructions
- N/A.

### Technical details
- Owner decision recorded here: real mode default for classic/darkroom/lab; normalised default for simple/tiny.

## Step 2: Agents launched (CHB-031 A and B, CHB-032); resume notes for the orchestrator

I launched three agents in parallel, each in its own worktree with its own diary, and asked all three to
checkpoint (commit plus a "Checkpoint" diary step with an exact resume list) because the user may quit the session,
which stops background agents. This step records what a resumed orchestrator needs.

### Prompt Context
**User prompt (verbatim):** "❯ ok, make a ticket for the findings and adjustments, to get it over with. 031 then 029.", "and code cleanup", "all 3 should keep thei rown diaries: commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)", "if i quit and then resume later, will th esubagents be able to continue?", "yes."
**Assistant interpretation:** CHB-032 for clean-up and ticket audits; CHB-031 now (two workstreams), CHB-029 after;
own diaries per agent; checkpoint before a possible quit.
**Inferred user intent:** Make progress in parallel without losing work if the session ends.
**Commit (code):** 9d10010 (plans and diaries)

### What I did
- CHB-032 created with 13 tasks (audits of CHB-008 and CHB-010, mock-engine shim, one TIFF writer, interim data,
  docs, e2e waits, splits of engine-gpu.ts, dsl host.ts, looks/finish kits; store.ts/viewport.ts split deferred
  until after CHB-031; dead-code pass).
- CHB-031 plan (`design-doc/01-plan.md`) with WS-A (enlarger and controls) and WS-B (open, strips, library).
- Common brief v2 in the scratchpad (`brief-common-v2.md`: stage named paths, never commit browser profiles,
  `idle()` waits, the M1 access, the scans folder).
- Agents: WS-A `task/chb-031-enlarger` (preview 4711, tests 5221–5224, tasks x86v 0xav 5ywv 9i1n 3z8z l1ny);
  WS-B `task/chb-031-open-strips` (preview 4811, tests 5321–5324, tasks odem 6wti jb0i 9t2y); CHB-032
  `task/chb-032-housekeeping` (tests 5421–5424). Worktrees under `.claude/worktrees/agent-*`.

### Why
- The three touch mostly disjoint files (plan's ownership section); A and B share `cb.ts` with local edits.

### What worked
- N/A (launched).

### What didn't work
- N/A.

### What I learned
- Background agents, preview servers and tunnels end with the session; worktrees, branches, commits and the Mac's
  `nohup` Playwright server survive.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- WS-A changes the enlarger default (a contract catalogue default): saved recipes must keep their stored mode.

### What should be done in the future
- **Resume list for the orchestrator:**
  1. `git worktree list`; for each agent branch read the last diary step ("Checkpoint" or later) and the open tasks
     (`docmgr task list --ticket CHB-031`, `--ticket CHB-032`). If the agents cannot be resumed by message, launch
     fresh agents per branch with `brief-common-v2.md` and "continue from the last diary step".
  2. Restart services as needed: `pnpm --filter @chromobench/studio preview --port 4600 --strictPort` (pre-CHB-027
     build in `apps/studio/dist` — rebuild only if the baseline is no longer needed); the current-main preview
     `pnpm --filter @chromobench/studio exec vite build --outDir dist-current && … vite preview --outDir dist-current
     --port 4650 --strictPort`; tunnels `ssh -N -L 9333:127.0.0.1:9333 -R 4600:127.0.0.1:4600 -R 4711:127.0.0.1:4711
     -R 4811:127.0.0.1:4811 mimimi-2.local` and `ssh -N -R 4650:127.0.0.1:4650 mimimi-2.local`; check the Mac server
     with `ssh mimimi-2.local 'tail -1 /tmp/chromobench-pw/server.log'`.
  3. Merge order: CHB-031 WS-A, then WS-B, then CHB-032; full checks incl. `CI=1 pnpm test:browser` on main.
  4. Then: CHB-032 task dgz9 (store.ts/viewport.ts split), the session-03 cosplay re-run (CHB-031 task b50a, a
     Sonnet tester per the CHB-026 protocol, darkroom flow in real mode included), then CHB-029.

### Code review instructions
- `design-doc/01-plan.md`; CHB-032 `tasks.md`.

### Technical details
- Owner decision (Step 1): real enlarger mode by default for darkroom-style layouts; normalised default for simple
  and tiny, with Time/Aperture hidden.
