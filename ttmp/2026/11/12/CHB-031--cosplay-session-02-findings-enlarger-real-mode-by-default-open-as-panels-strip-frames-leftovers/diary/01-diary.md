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

## Step 3: Session restart; continuation agents in the existing worktrees

The user restarted the session. The three agents had stopped and the harness refuses to resume stopped agents
("Treat its work as cancelled; only launch a new agent if the user explicitly asks"). The user asked for new ones.
Each continuation agent works inside the stopped agent's existing worktree, so the edits made after the checkpoints
are kept, and continues the same diary from its checkpoint step. The Mac is closed, so no real-GPU work.

### Prompt Context
**User prompt (verbatim):** "ok, restarted", "i closed the mac for now", then "yes" (to starting new agents in the existing worktrees)
**Assistant interpretation:** Resume CHB-031 A/B and CHB-032 from their checkpoints without the Mac.
**Inferred user intent:** Carry on where the work stopped.
**Commit (code):** N/A

### What I did
- Checked state: `task/chb-031-enlarger` 548abf9 (+8 modified files, ~56 lines, after its checkpoint),
  `task/chb-031-open-strips` db1c5f7 (+untracked screenshots), `task/chb-032-housekeeping` aef2d3d (+an untracked
  reference doc draft). `ssh mimimi-2.local`: "Connection timed out" (the Mac is closed).
- `SendMessage` to the three stopped agents: refused ("was stopped and won't be resumed").
- Launched three agents without isolation, each told to work only in `/home/manuel/code/wesen/chromobench/.claude/
  worktrees/agent-<old id>` on its branch, read brief v2, the plan, its diary's checkpoint resume list, review the
  uncommitted edits, continue the same diary (next step quotes the new prompt), and skip the Mac.

### Why
- A new isolated worktree would start from main and lose the uncommitted edits; the old worktrees hold them.

### What worked
- The checkpoint steps (WS-A step 3, WS-B step 4, CHB-032 step 6) gave each continuation agent its resume list.

### What didn't work
- Resuming the stopped agents by message: `"Agent … was stopped and won't be resumed."`

### What I learned
- Stopped background agents cannot be resumed after a session restart in this harness; checkpoints in the diary
  plus committed work are what carries over.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Agents without isolation share the process's working directory; each prompt pins its commands to its worktree.

### What should be done in the future
- Same plan: merge WS-A, WS-B, CHB-032; session-03 re-run; CHB-032 dgz9; CHB-029. Real-GPU checks wait for the Mac.

### Code review instructions
- N/A.

### Technical details
- Preview servers 4600/4650 and the Mac tunnels were not restarted (the Mac is closed).

## Step 4: WS-A merged into main

WS-A (enlarger and controls) reported done after five diary steps, its browser suite at 98 passed. I reviewed its
diary and diff and merged `task/chb-031-enlarger` into main as `e7df8a0`. Real enlarger mode is now the default for
the darkroom-style layouts (contract 0.4.0, decision CC-017), and normalised mode is a layout option for simple and
tiny, with Time, Aperture and magnification hidden. On main the checks pass. WS-A left open edges, now CHB-031
tasks (`e2af842`). WS-B and CHB-032 were told to merge main before their final commits.

### Prompt Context
**User prompt (verbatim):** none new; this follows "we can do them all as planned, no need to compomise" and "031 then 029" (see step 1).
**Assistant interpretation:** Merge the workstreams as they finish, A then B, then CHB-032.
**Inferred user intent:** The darkroom controls do what their labels say, for the photographer.
**Commit (code):** e7df8a0 — "Merge task/chb-031-enlarger (CHB-031 WS-A: real enlarger by default, normalised option, controls and wording)"; e2af842 — "CHB-031: tasks for WS-A's open edges"

### What I did
- Read WS-A's diary (steps 1–5) for format and for its evidence. Steps 1–2 verify F17 first, as the plan asks:
  in normalised mode the seconds test strip printed identical bands. Step 3 is the checkpoint with app
  measurements, and step 5 records the browser suite.
- Reviewed the branch diff (4 commits, 67a4a57..8d8e71e). The contract bump has a 0.3.0 catalogue baseline;
  `print.enlarger.mode` defaults to `real`. There is a layout option (`enlargerMode` in `variant.ts`, read by
  `model/enlarger.ts` when a recipe is made), and the first print sets the time in real mode. Typed entries in
  `dom/arg.ts` treat a plain number as absolute; a change needs a sign and a unit. `status-text.ts` gains
  `engineTip`/`notesTip`, the view tabs are renamed "No mask" and "Clipping", and `e2e/studio-enlarger.spec.ts` is new.
- Merged with `--no-ff` and checked on main: `pnpm typecheck` OK; `pnpm lint` (boundaries 338 file checks,
  check-colours 141 files) OK; `pnpm test` 97 files, 2749 passed, 7 skipped.
- Added WS-A's open edges as CHB-031 tasks: in the edit log, the looks "density" look, agent proposals and the DSL
  time strip can still set or vary Time on a normalised recipe; the darkroom layout with no frame shows the empty
  text twice.
- Messaged WS-B: merge main first. Regenerate `variants.test.ts.snap` with `-u` and read the diff, regenerate docs
  with `pnpm gen`, and check the strip tests now that a first print sets Time per frame. Messaged CHB-032: merge
  main too, and make `e2e/studio-strip.spec.ts:51` stop rewriting a CHB-027 screenshot under `ttmp/`.

### Why
- A merges first because its contract bump and catalogue defaults change explain snapshots and generated docs that
  B and CHB-032 would otherwise rebase over twice.

### What worked
- The merge had no conflicts; main was unchanged since the branch point except for orchestrator diary commits.

### What didn't work
- N/A. I did not run the browser suite on main here; it waits until WS-B is merged (one run for both).

### What I learned
- Session 02's "Time does nothing" was a mode default, not a broken engine. The verification step in WS-A's
  diary shows it with identical bands, which makes the change easy to review.

### What was tricky to build
- N/A for the orchestrator. WS-A's tricky part was keeping inert controls out of view without removing them from
  saved recipes. Normalised recipes keep their mode, and only the layout default changes.

### What warrants a second pair of eyes
- Old recipes saved before 0.4.0 without an explicit mode: they keep `normalised` because the old default is now
  written into the migration. Check WS-A's `enlarger-mode.test.ts` "old recipes unchanged" case.
- Contract 0.4.0 is a minor bump with a catalogue baseline; the bridge reference docs were regenerated.

### What should be done in the future
- Merge WS-B (after it merges main), then CHB-032; then `CI=1 pnpm test:browser` on main; then task l1ny after F10;
  CHB-032 dgz9; session 03; close CHB-031; CHB-029.

### Code review instructions
- Start at `packages/studio-kit/src/model/enlarger.ts` and `apps/studio/src/host/first-print.ts`, then
  `packages/studio-kit/src/dom/arg.ts` (typed entries). Validate with `pnpm test` and
  `CI=1 pnpm exec playwright test e2e/studio-enlarger.spec.ts` on unique ports.

### Technical details
- Branch commits: 67a4a57 (real by default, layout option, F19, F23), 548abf9 (checkpoint, F8), b90d7ef (F9
  wording, darkroom mode select, e2e spec), 8d8e71e (tasks, diary step 5).
