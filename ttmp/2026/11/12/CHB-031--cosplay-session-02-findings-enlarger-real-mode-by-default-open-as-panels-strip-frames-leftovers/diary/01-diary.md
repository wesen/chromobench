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
- Saved recipes: no migration is needed because every recipe and EditLog stores `print.enlarger.mode` explicitly
  (CONTRACT-DECISIONS.md, CC-017), so a recipe saved before 0.4.0 reopens `normalised` in a real-mode layout.
  The case is in `packages/studio-kit/test/enlarger-mode.test.ts` ("a recipe saved in normalised mode … opens
  normalised in a real-mode layout, and vice versa").
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

## Step 5: CHB-032 merged before WS-B; session-03 setup

CHB-032 (housekeeping) finished before WS-B, with every check green on a branch that already contained current
main. I merged it as `02fd314`, ahead of WS-B and against the plan's A-then-B-then-CHB-032 order. A cross-check of
WS-B's diff showed it builds `new RefEngine(...)` without data, which CHB-032 made a compile error. WS-B's agent
knows its F10 tabulated-preview code and is still running, so it is better placed to fix that than I am after
the fact. While waiting I also prepared session 03: an "old library" browser profile made with the build from
before CHB-031, and the tester's brief.

### Prompt Context
**User prompt (verbatim):** none new (see step 4).
**Assistant interpretation:** Merge finished work as it arrives and keep the remaining branch on top of main.
**Inferred user intent:** CHB-031 and CHB-032 land cleanly; then the session-03 re-run.
**Commit (code):** 02fd314 — "Merge task/chb-032-housekeeping (CHB-032: audits of CHB-008/010, one TIFF writer, RefEngine data required, engine-gpu/dsl host/looks/finish splits, e2e open waits, reference docs, 63 unused exports removed)"

### What I did
- Read CHB-032's final report and checked its diary: steps 1–15, each with all eleven investigation sections;
  step 7 quotes the resume prompt verbatim.
- Cross-checked WS-B's added lines (`git diff 9d10010` in its worktree) against the 64 export names removed by
  9eca10d and against the RefEngine data requirement. Five `new RefEngine(...)` calls had no data (the
  TabulatedPreviews class and tests). `CLASS_CODE` matched, but WS-B imports core's, and CHB-032 removed only
  ingest's. The other matches are not imports of the removed exports: `latd` is a local parameter name, WS-B's specs define
  their own local `idle`, and no WS-B import names `note` (ingest), `round` (shell) or `stops` (core).
- Merged with `--no-ff`; `git diff --quiet 51bfa5a HEAD` → identical trees. The agent's checks at 51bfa5a therefore
  stand for main: `pnpm test` 97 files, 2749 passed, 7 skipped; typecheck, lint, `gen:check` OK; browser suite
  98 passed, GPU conformance 320/320.
- Messaged WS-B to merge main again, with four items: RefEngine data, the removed exports list, `opened()` in
  e2e specs, and the split files.
- Removed the merged worktrees and branches of CHB-032 and WS-A (`git worktree remove`, `git branch -d`), after
  `git status` showed no leftovers.
- Session 03 setup: served the pre-CHB-031 build (`apps/studio/dist-current`, built 16:28 from main before WS-A,
  contract 0.3.0) at :4650. Ran `sessions/03-sonnet-rerun-session-02/scripts/s00-seed-old-library.mjs` (CHB-026)
  to make a library with DSC_8541.NEF and raw010.dng frames 1–3 in a git-ignored profile
  (`profile/old-library`). Wrote the tester brief (scratchpad `session-03-brief.md`).

### Why
- Merging the finished branch first moves the conflict resolution to the agent that wrote the conflicting code.
- An old-build profile tests what the photographer meets after an update: frames saved in normalised mode, opened
  by a build whose darkroom layouts default to real mode. That is more realistic than making normalised frames in
  the Simple layout.

### What worked
- Identical trees after the merge, so no re-run was needed.
- The seed script opened both files in the old build: the NEF as a photo, and the strip as three negative frames.

### What didn't work
- A second seed step (`s00b`, deleted) tried to record a Lighter edit on DSC_8541. In a headless browser a library
  frame has no file handle, so selecting it opens "Where is …?", and the edit never reached the frame. The old
  frames carry only "Auto Frame added". The tester's brief tells them to answer the dialog.
- The first seed script's `getByRole('button', { name: /Lighter/ })` timed out after 30 s; the button is found by
  its text, not by role.

### What I learned
- The studio's service worker is network-first for the app shell (`sw.js`), so an old profile picks up a new build
  on its first load; only the data packs are cache-first.

### What was tricky to build
- Seeding has to use the same origin (port 4650) as the session, because IndexedDB and the service worker are per
  origin. The old build is therefore served first, then replaced by the new build on the same port.

### What warrants a second pair of eyes
- The order change (CHB-032 before WS-B) puts a second merge of main on WS-B, which has already merged WS-A.

### What should be done in the future
- On WS-B's report: review, merge, then run `CI=1 pnpm test:browser` on main. Rebuild `dist-current` from main and
  restart :4650 (sirv lists files at start), then launch the session-03 tester. CHB-032 dgz9 (store.ts/viewport.ts
  split) can start after WS-B is merged.

### Code review instructions
- `git show 02fd314 --stat`; the CHB-032 diary (steps 7–15) explains each commit.

### Technical details
- Removed export names: scratchpad `removed-exports.txt` (from `git show 9eca10d`); CHB-032's full scanner report
  is `ttmp/2026/11/12/CHB-032--…/various/01-unused-exports-after.txt`.

## Step 6: WS-B merged; all CHB-031 code on main; dgz9 and session 03 started

WS-B (open, strips and library) finished with main merged in twice and every check green (unit 2770 passed; browser
101 passed on its ports). I reviewed the riskier changes, merged it as `7e96726`, and removed its worktree and
branch. All CHB-031 code and all of CHB-032 except dgz9 are now on main. Since WS-B touches neither `store.ts` nor
`viewport.ts`, I started dgz9 (the shell split) in its own worktree right away instead of after the cosplay
re-run. I then rebuilt the :4650 preview from main and launched the session-03 tester (Sonnet).

### Prompt Context
**User prompt (verbatim):** none new (see step 4).
**Assistant interpretation:** Merge B, verify, start the remaining work in parallel.
**Inferred user intent:** CHB-031 done and checked by a cosplay re-run; CHB-032 finished; then CHB-029.
**Commit (code):** 7e96726 — "Merge task/chb-031-open-strips (CHB-031 WS-B: F21 selection, F18 Open As reset and pill, F20 strip orientation/working size/gap base, F22 render-queue spin and binned RAW decode, F10 tabulated CPU previews at 640 px)"; b2bec93 (CHB-028 task); 15bd6df (CHB-031 tasks)

### What I did
- Checked WS-B's diary: steps 1–11, each with all eleven sections.
- Reviewed `packages/shell/src/app/render/queue.ts`. A waiting background render no longer re-queues itself from an
  idle callback while live work runs; `after()` and `cancel()` release it (`releaseBackground`). That loop was the
  "core spinning against the engine worker" behind part of F22.
- Reviewed `apps/studio/src/host/decode.ts`. Binned RAW decode applies only when `0 < long ≤ 1024` (the CPU
  engine's working size). The GPU's 4000 px and `long = 0` still read the full demosaic. Strips are sized by
  `stripScale` so each frame gets about `long` px, and `gapBase` reads a strip's base from the gaps between frames.
- Followed the export path while checking that binned decode never reaches an export. An export has the working
  image's size (`apps/studio/src/host/export.ts:4-5`), so on the CPU engine it is 640 px; that predates WS-B
  (512 px before). Added CHB-028 task "Exports at the file's own size on both engines".
- Merged with `--no-ff`. `git diff --quiet bf98546 HEAD -- . ':!ttmp'` showed main's code identical to WS-B's head,
  where the agent ran the full checks, so I did not re-run them.
- Stopped the WS-B agent (it reported waiting on background work), checked its worktree was clean, removed the
  worktree and deleted the branch. One more `vite preview --host` process on :4173 is the user's own (parent: a
  kitty terminal's zsh, started 17:37), not an agent's; left running.
- CHB-031 tasks: checked l1ny (F8/F9/F12 in WS-A, F10 in WS-B). Added two from WS-B: the decode note still says
  "film edge found" when a strip's base comes from the gaps, and there is no 1:1 focus check on the CPU engine.
- Launched an agent for CHB-032 dgz9 in a new worktree (branch `task/chb-032-store-viewport`, ports 5421–5424,
  continuing the CHB-032 diary at step 16) and told it to merge main (WS-B) before finishing.
- Stopped the old-build preview, rebuilt `apps/studio/dist-current` from 15bd6df, served it at :4650, and confirmed
  the bundle has "No mask" (WS-A) and "tabulated previews" (WS-B). Launched the session-03 tester with the brief
  from step 5, adding a note about timing while another agent runs test suites (medians, `uptime`).

### Why
- dgz9 is mechanical and does not overlap anything in flight, so running it during the cosplay session saves a
  serial step before CHB-029.

### What worked
- Three branches merged with identical-tree checks. The only conflicts were semantic ones (RefEngine data), and the
  agents fixed them on their own branches.

### What didn't work
- N/A.

### What I learned
- On the CPU engine the export size equals the preview's working size. The dad's Mac has WebGPU (4000 px), but a
  fallback user would export 640 px files without being told.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- WS-B's tabulated CPU previews differ from exact by up to 4.2 8-bit levels on negatives (its diary step 6). Exports
  stay exact, so preview and export can differ slightly on the CPU engine, as they already do on the GPU.

### What should be done in the future
- On the tester's report: commit session 03 (named paths; not the profiles), fold its verdicts into CHB-026
  findings, decide what follows. On dgz9's report: review and merge, then close CHB-032 if only follow-ups remain.
  Then close CHB-031 and start CHB-029.

### Code review instructions
- `git show 7e96726 --stat`; WS-B diary steps 5–11.

### Technical details
- Remaining CHB-031 tasks: b50a (session 03), srvr and 8iv8 (WS-A edges), two WS-B leftovers.

## Step 7: dgz9 merged; CHB-032 closed

The dgz9 agent split the shell's `store.ts` (775 → 325 lines plus `core/store/`) and `viewport.ts` (723 → 108 lines
plus `dom/viewport/`). It moved every body verbatim, merged main twice, and passed every check (unit 2770 passed,
no snapshot changed; browser 101 passed; GPU conformance 320/320). I verified it and merged it as `d56c653`. All
CHB-032 tasks are done, so I closed CHB-032. The only open work now is session 03 and the CHB-031 leftovers.

### Prompt Context
**User prompt (verbatim):** none new (see step 4).
**Assistant interpretation:** Finish CHB-032 before CHB-029.
**Inferred user intent:** "and code cleanup" done before the UI DSL work.
**Commit (code):** d56c653 — "Merge task/chb-032-store-viewport (CHB-032 dgz9: shell store.ts and viewport.ts split into core/store/ and dom/viewport/ modules)"; 918b3e5 — "Close CHB-032 (housekeeping): all tasks done, merged as 02fd314 and d56c653"

### What I did
- Diary steps 16–19 of CHB-032 each have all eleven sections.
- Ran the agent's check `python3 -I …/CHB-032--…/scripts/dgz9-verify-split.py 6a42b9b` in its worktree:
  "failures: 0" (47 of 47 segments verbatim, per its report).
- Read the two hand-changed lines: `setZoom: (z, at) => setZoom(z, at)` and `zoomBy: (dir, at) => zoomBy(dir, at)`
  in `packages/shell/src/dom/viewport.ts:77-78`. The functions take `(z: Zoom, at?)` and `(dir: number, at?)`
  (`dom/viewport/geometry.ts:45,57`), so the arrows pass every argument through.
- Merged with `--no-ff`; `git diff --quiet b1b8b9c HEAD -- . ':!ttmp'` → main's code identical to the tested head.
- Removed the worktree and deleted `task/chb-032-store-viewport`, then the harness's `worktree-agent-*` branches
  (four, each an ancestor of main: `git merge-base --is-ancestor`). Only `main` is left.
- `docmgr ticket close --ticket CHB-032` (status complete, changelog entry) and committed.

### Why
- Closing CHB-032 now leaves CHB-029 a clean base: the shell's package exports did not change, and `cb.ts` is
  untouched by the clean-up.

### What worked
- Verbatim-move scripts made the splits reviewable without rereading 1,500 lines.

### What didn't work
- My first run of the verify script used a path relative to the main checkout after `cd` into the worktree:
  `can't open file '…/agent-a22f39a108e54cbd7/.claude/worktrees/agent-a22f39a108e54cbd7/ttmp/…'`. It ran with an
  absolute path. That `cd` also moved the session's working directory into the worktree; `cd` back to the main
  checkout restored it before the removal.

### What I learned
- `cd` into an agent worktree makes the harness treat it as the session's working directory. Use `git -C` and
  absolute paths instead.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The viewport entry builds its parts in the original order, because cells take ids in creation order. A future
  edit that reorders the `view*()` calls in `viewport.ts` would change cell ids. The order is commented there.

### What should be done in the future
- Session 03 report → findings → one fix round (with srvr, 8iv8 and WS-B's two leftovers) → close CHB-031 → CHB-029.

### Code review instructions
- `git show d56c653 --stat`; CHB-032 diary steps 16–19.

### Technical details
- Lint file checks rose from 368 to 406 with the 15 new modules.
