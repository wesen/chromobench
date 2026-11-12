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

## Step 3: WS-C merged

WS-C (wording, forms, messages) reported done and I merged `task/chb-027-wording` into main. Its report: F7, F8,
F9, F12 and F13 fixed, F11 partly (the host bar and the empty state are WS-A's), F14 not reproducible (only Ctrl+K
opens "Commands", and the typed-value boxes swallow every key; likely the session tooling). On the way it fixed a
real bug: shortcuts matched physical keys, so on a German QWERTZ layout Ctrl+Z arrived as Ctrl+Y.

### Prompt Context
**User prompt (verbatim):** see Step 1; and "how far are we?" (status question during the merge).
**Assistant interpretation:** Merge finished workstreams and report progress.
**Inferred user intent:** Know where the fixes stand.
**Commit (code):** 444f153 — "Merge task/chb-027-wording (CHB-027 WS-C: wording, forms, messages)"

### What I did
- `git log main..task/chb-027-wording`: `a3e1b25` (code), `4136c70` (diary); 40 files, +1313/−67.
- `git merge --no-ff task/chb-027-wording`; `pnpm typecheck` (ok), `pnpm lint` (boundaries 333 file checks;
  check-colours 135 files ok), `pnpm test` twice.

### Why
- C finished first; merging it now means A and B rebase onto (or merge with) the same `main.ts` status-line
  changes, instead of me resolving three-way at the end.

### What worked
- Second `pnpm test`: 89 files, 2661 passed, 7 skipped (the agent reported the same in its worktree; its browser
  suite on ports 4921–4924: 88 passed).

### What didn't work
- First `pnpm test` after the merge: `Test Files 2 failed | 87 passed (89)`, `Tests 2 failed | 2659 passed`. A
  re-run passed with no failures, so these were timing flakes under load (WS-A and WS-B run test suites on the same
  machine). The failing test names were not captured (the second run's grep found nothing to show).

### What I learned
- New shell hook `Runtime.explainError` (studio-kit fills it in `Studio.attach`); new `ToastOpts.detail`;
  `apps/studio/src/status-text.ts` builds the human summaries from the existing note strings.

### What was tricky to build
- N/A (merge).

### What warrants a second pair of eyes
- The layout-following shortcut change affects every shell app (`packages/shell/src/core/keys.ts`).

### What should be done in the future
- Re-run `CI=1 pnpm test:browser` on main after all merges, when the agents' load is gone.
- WS-A: route open-file errors through `explainError`; name the frame in the Undo/Redo tooltips (if the buttons
  survive the top-bar fold).

### Code review instructions
- `packages/studio-kit/src/messages.ts` (or the agent's equivalent), `apps/studio/src/status-text.ts`,
  `packages/shell/src/core/keys.ts`; diary `04-diary-ws-c-wording-and-forms.md`.

### Technical details
- e2e specs now read `#engine[data-engine]` and `#notes[title]` for technical text.

## Step 4: Real GPU over SSH (M1 Max), first measurement, playbook, vault report

Both running agents were stuck on GPU behaviour: WS-B's GPU-engine drags under SwiftShader never finished, and
WS-A had an intermittent GPU-test hang it could not attribute. The user offered the MacBook Pro (M1 Max) over SSH.
Raw CDP to its Chrome failed; a Playwright server of our exact version on the Mac, with tunnels both ways, works.
The first real-GPU measurement shows that the pre-CHB-027 build already drags without stalls on Metal, so F4's
drag freeze belongs to the CPU path and SwiftShader. The remaining GPU-path cost is the open (1 s stall). I wrote a
playbook and a technical project report for the Obsidian vault (committed and pushed).

### Prompt Context
**User prompt (verbatim):** "would they benefit from running on my macbook pro m1? for gpu stuff ?", "if i gave yu ssh, would that be enough for the agents to continue from here?", "it's mimimi-2.local you should have access", "once it works, write a playbook and  write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill).      \n Commit and push the bsidian vault when done (go-go-parc vault)."
**Assistant interpretation:** Make the Mac's real WebGPU usable from the Linux box for the agents; once working,
document it as a playbook and write a deep-dive project report (vault conventions, textbook style), push the vault.
**Inferred user intent:** Real GPU numbers instead of software-renderer artefacts, and durable documentation.
**Commit (code):** 494d3e6 (mac-README, smoke script), 93bd031 (measurement), 16fbf52 (playbook); vault fbd0c36.

### What I did
- `ssh mimimi-2.local` (BatchMode): manuel, macOS 15.7.7, Apple M1 Max, Chrome installed, console session active.
- Tried Chrome with `--remote-debugging-port=9222 --user-data-dir=/tmp/chromobench-chrome` + `connectOverCDP`.
- Started `npx -y playwright@1.65.0 run-server --port 9333 --host 127.0.0.1` on the Mac (Node 26.5 in
  /opt/homebrew/bin); tunnel `ssh -N -L 9333:… -R 4600:… -R 4711:… -R 4811:… mimimi-2.local` (background task).
- `scripts/mac-01-gpu-smoke.mjs` (adapter + engine label), `scripts/mac-02-open-and-drag.mjs` (open + 20-move drag
  with the stall probe; `--local` for SwiftShader), `scripts/mac-README.md` (agents' short version, lock protocol).
- Messages to WS-B (BEFORE on :4600, AFTER on its branch at :4811, on Metal) and WS-A (hang repro on Metal).
- One measured run under the lock: pre-CHB-027 main build (:4600, 0b381c6), DSC_8559.NEF as photo.
- Playbook `playbook/01-real-gpu-browser-testing-on-the-m1-mac-over-ssh.md`.
- Vault: `Projects/2026/11/12/PROJ - Chromobench Usability Cosplay and Real-GPU Measurement - Technical Project
  Report.md` (obsidian-vault-writing + textbook-authoring style rules: definitions first, one traced example, no
  analogies); no screenshots (they show private photos; the vault is pushed to GitHub); the father is not named.

### Why
- WebGPU needs a secure context, so the Mac must load our preview servers as `localhost` (reverse tunnel).
- A per-connection Playwright server launches the installed Chrome (`channel: 'chrome'`, headed for the real GPU
  process) with the client's options, which avoids CDP's context-management calls.
- A lock directory (`mkdir` is atomic) keeps timing runs exclusive across agents.

### What worked
- Smoke: `{"gpu":{"vendor":"apple","architecture":"metal-3"},"engine":"GPU · apple metal-3 · 4000 px"}`, secure
  context true.
- Measurement (various/mac/01-before-gpu-m1-dsc8559.json): open — result 9.6 s after upload, stalls 567, 1008,
  308, 208 ms; drag (20 moves) — wall 1985 ms, result 283 ms after release, 8 renders, **no stall**.
- Vault push after `git pull --rebase` (the remote had a newer commit): main…origin/main in sync.

### What didn't work
- `node scripts/mac-01-gpu-smoke.mjs` first: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright'` —
  the repo has `@playwright/test` only.
- `connectOverCDP('http://127.0.0.1:9222')`: `Protocol error (Browser.setDownloadBehavior): Browser context
  management is not supported.` (Playwright 1.65 vs Chrome 157).
- First vault `git push`: rejected (non-fast-forward); fixed by `git pull --rebase`.

### What I learned
- `setInputFiles` to a remote browser streams through the protocol and tunnel at ≈ 0.7 MB/s (30 MB NEF ≈ 44 s);
  measurements must start after it returns.
- On Metal the old build's drag is already fluid; WS-B's worker matters for the open on both engines and for
  everything on the CPU path.

### What was tricky to build
- Telling apart the three ways a remote GPU page silently degrades: a non-secure origin (CPU fallback), a missing
  `-R` for the port (connection refused in the page), and a version-mismatched server.

### What warrants a second pair of eyes
- The Mac is the owner's personal machine: the lock and `browser.close()` in `finally` keep runs from piling up
  Chrome windows; the private photos are streamed, never stored there.

### What should be done in the future
- WS-B's AFTER numbers on Metal; WS-A's hang check on Metal; optionally a Playwright project that targets the Mac.

### Code review instructions
- `scripts/mac-02-open-and-drag.mjs`; the playbook's troubleshooting table.

### Technical details
- Mac setup state: server log `/tmp/chromobench-pw/server.log`; lock `/tmp/chromobench-pw/lock` (absent = free).

## Step 5: WS-A merged; WS-D launched

WS-A (open mode, library, menus) reported done, and I merged `task/chb-027-open-mode` into main without
conflicts; typecheck, lint and the unit suite are green on main. WS-A fixed F1, F2, F3, F5, F6, F11 (empty state)
and F15, folded the top bar into the menus, and found the cause of its GPU-test hang on SwiftShader (a catalog
write during a GPU render). With frame identity now `(sha, mode)`, WS-D (strips into frames) could start.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Merge finished workstreams, start the dependent one.
**Inferred user intent:** Finish CHB-027.
**Commit (code):** 365ce53 — "Merge task/chb-027-open-mode (CHB-027 WS-A: open mode, library, menus)"

### What I did
- `git merge --no-ff task/chb-027-open-mode`; `pnpm typecheck`, `pnpm lint`, `pnpm test` on main.
- Message to WS-B: merge main; the new `HostServices.decode(bytes, sha, name, mode)`, `prior`/`forget` hooks,
  `openAs`, `guessOpenMode`; the WorkerEngine must forward `forgetSource`; transfer a copy of the bytes (Auto may
  decode a DNG twice); `#photo` is gone.
- Created `diary/05-diary-ws-d-strip-frames.md`; launched WS-D (`task/chb-027-strip-frames`, ports 5011/5021–5024).

### Why
- WS-D builds on WS-A's identity; WS-B is still reducing its final-render times, so A went in first.

### What worked
- Merge without conflicts (WS-A had merged main itself, including WS-C).
- `pnpm test`: 91 files, 2678 passed, 7 skipped. Lint: boundaries 333 file checks ok, check-colours ok.
- WS-A's reported browser suite on its branch: 91/91 after the theme spec fix (`#bar` → `#statusbar`).

### What didn't work
- N/A in this step. (WS-A's hang root cause stays unknown: a document-tier store write during a SwiftShader GPU
  render keeps the renderer's main thread busy; on the M1 Max 10/10 runs passed. Workaround: thumbnails go to KV
  during the session.)

### What I learned
- Contract request R10 (studio-kit): `source.open` should carry the decode mode, so node ids differ by decode
  and `forgetSource` becomes unnecessary. To apply when the contract is next revised.

### What was tricky to build
- N/A (merge).

### What warrants a second pair of eyes
- Store writes during GPU renders under SwiftShader (shell/GPU owners).
- Auto decoding a DNG twice (scan then photo) costs a second decode; the copy of the bytes is required.

### What should be done in the future
- Manual check in a real Chrome: reload, then click a "not open" library thumbnail (file-handle re-read) — not
  testable headless.
- `CI=1 pnpm test:browser` on main after B and D merge.

### Code review instructions
- WS-A diary `02-diary-ws-a-open-mode-and-library.md` step 7 (findings table);
  `packages/ingest/src/conditioning/open-mode.ts`; `packages/studio-kit/src/bridge/frames.ts`.

### Technical details
- Findings now fixed on main: F1, F2, F3, F5, F6, F7, F8, F9, F11 (partly), F12, F13, F15; F14 not reproducible.
  Open: F4/F10 (WS-B), F16 (WS-D).

## Step 6: WS-B merged

WS-B (responsiveness) reported done and I merged `task/chb-027-responsive` into main without conflicts; typecheck,
lint and the unit suite are green. Neither engine stalls during drags or typing any more; the final render on the
CPU is back to 0.8–1.3× of before after the fixes I asked for (live renders preempt background ones, a screen pass
aborts a kept draft, the CPU working image back to 512 px with `?refLong=1024` opt-in). The real cause of the
earlier hangs (after drags, and SwiftShader GPU drags that never finished) was `runIdle` in `cells.ts` looping.

### Prompt Context
**User prompt (verbatim):** see Step 1; status question "how far are our current agents? what's left for them?"
**Assistant interpretation:** Merge finished workstreams; keep the last one unblocked.
**Inferred user intent:** Finish CHB-027.
**Commit (code):** 9a6d87c — "Merge task/chb-027-responsive (CHB-027 WS-B: engine worker, staged/sampled previews, drafts)"

### What I did
- `git merge --no-ff task/chb-027-responsive`; `pnpm typecheck`, `pnpm lint`, `pnpm test` on main.
- Message to WS-D: merge main; strip detection must run in the engine worker where conditioning now runs.

### Why
- WS-D touches the same host files; it resolves the conflicts with knowledge of its own changes.

### What worked
- `pnpm test`: 93 files, 2693 passed, 7 skipped; lint: boundaries 336 file checks, check-colours 140 files ok.
- WS-B's branch: `CI=1 pnpm test:browser` 92 passed (conformance 320/320); two WS-A spec races fixed
  (status matched "rendered" while the second file was still opening; `waitForFunction(async …)` returned at once,
  because a promise is truthy — now `expect.poll`), spec passed 9/9 with `--repeat-each 3`.

### What didn't work
- N/A in this step.

### What I learned
- Final numbers (diary 03 steps 8 and 10): CPU drag photo 15.9–18 s with 3.2–3.8 s stalls → 3.9 s total, no
  stall, first draft at 0.42 s; CPU opens stall 3.5–5.8 s → 0 (NEF), 0.25 s (DNG); M1 Max: all stalls → 0 except a
  0.2 s GpuEngine upload pack on NEF open.

### What was tricky to build
- N/A (merge).

### What warrants a second pair of eyes
- `packages/shell/src/core/cells.ts` (`runIdle`), `packages/shell/src/app/render/queue.ts` (`progressMs`,
  `preemptBackground`): shared by every shell app.

### What should be done in the future
- WS-B follow-ups: faster `output.display` and `print.expose` in core; GpuEngine upload off the main thread; worker
  job priorities; thumbnail saving on draw instead of polling. F10 on the CPU engine stays partly open (512 px).

### Code review instructions
- `apps/studio/src/host/{decode,worker-protocol,engine-serve,engine-worker,worker-engine}.ts`,
  `packages/core/src/engine-ref.ts` (staged and sampled evaluation); diary `03-diary-ws-b-responsiveness.md`.

### Technical details
- `?worker=0` keeps everything on the main thread (for comparison and debugging).

## Step 7: WS-D merged; the full browser suite on main; an e2e race; the re-run tester launched

WS-D (strips into frames) reported done and I merged `task/chb-027-strip-frames`; all four workstreams are now on
main. The first full browser suite on merged main had one failure, a test race created by two correct changes
meeting (WS-A's final "opened N files" status, WS-B's renders in a worker). I fixed the wait in three specs. Then I
launched a cheaper-model tester (Sonnet) to re-run session 01 against main, per the CHB-026 protocol.

### Prompt Context
**User prompt (verbatim):** see Step 1; and from CHB-026 Step 1 the original request to "launch subagents that are less intelligent to do the same, keeping a detailed diary in the subagents as well and give yuo a report".
**Assistant interpretation:** Merge, verify on main, then the acceptance re-run (task m5pv) by a cheaper tester.
**Inferred user intent:** Proof that the photographer's session now works, from an independent tester.
**Commit (code):** 3703d0a — merge WS-D; 1ffec8c — "e2e: wait for 'rendered' or 'opened …' after an open"

### What I did
- `git merge --no-ff task/chb-027-strip-frames`; `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- `STUDIO_PORT=5121 … CI=1 pnpm test:browser` on main (log in the scratchpad, `browser-main-3703d0a.log`).
- Fixed `e2e/studio.spec.ts`, `e2e/chat.spec.ts`, `e2e/m1-walking-skeleton.spec.ts`: after `setInputFiles`, wait
  for `toHaveText(/rendered|opened/)` instead of `toContainText('rendered')`, then `idle()`.
- `playwright test` of the three specs with `--repeat-each 3`.
- Rebuilt the 4650 preview (`vite build --outDir dist-current`) from 3703d0a; reachable on the Mac.
- Launched the tester (model sonnet): CHB-026 protocol option B (own headless Playwright), app at :4650, output
  in `CHB-026…/sessions/02-sonnet-rerun-session-01/` (diary, experience report with a before/after table F1–F16,
  shots, scripts); optional one run on the M1.
- Tasks checked: oimx (merges), 37lv (real-GPU check: WS-B's M1 numbers), akjc (drag latency in a test: WS-B's
  `e2e/studio-responsive.spec.ts` and the measurement script).

### Why
- The suite had never run on a main containing all four workstreams; each branch had passed alone.

### What worked
- Unit: 95 files, 2733 passed, 7 skipped; lint ok (336 / 140 files).
- Browser: 92 passed, 1 failed; GPU conformance 320/320. After the fix: the three specs 39/39 over 3 repeats.

### What didn't work
- `[chromium-webgpu] › e2e/studio.spec.ts:167:1 › tools: test strip band, ring-around tile, masks and exposures,
  apply to selection`: `expect(locator('#status')).toContainText('rendered')` — `Received string: "opened 3 files"`
  (12 polls), timeout 5000 ms. The open's last render finished before the final "opened 3 files" status was
  written, so "rendered" never reappeared.

### What I learned
- Status text is a poor synchronisation point once work is asynchronous; `window.chromobench.idle()` (which waits
  for worker renders since WS-B) is the right one, with the status only as "the open has finished".

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Other specs that wait on status text could hit the same race under load; `grep -n "toContainText(" e2e/` lists them.

### What should be done in the future
- After the re-run: delete the merged task branches and agent worktrees (task 5dta); close CHB-027 if the table
  shows the findings fixed.

### Code review instructions
- `git show 1ffec8c`.

### Technical details
- Open CHB-027 tasks: m5pv (re-run, running), 5dta (branch clean-up).

## Step 8: The re-run (session 02): 11 fixed, 3 partly, 1 open, 1 not reproduced, 7 new; a privacy slip in my commit

The Sonnet tester re-ran session 01 against main (3703d0a) on the CPU engine and wrote a full diary and an
experience report with a before/after table (CHB-026 `sessions/02-sonnet-rerun-session-01/`). Its most important
new finding (F17): Time and Aperture do nothing in the default enlarger mode `normalised`, while the controls are
shown and recorded. It also reported that my step-7 commit had swept its browser profile (IndexedDB and cache with
thumbnails of the private photos) into git. I removed it from history (the commit was the unpushed tip) and made
browser profiles ignored.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Acceptance check for CHB-027; keep private data out of the repository.
**Inferred user intent:** Know what is really fixed, from an independent tester.
**Commit (code):** 7130bbd (amended step-7 commit, replaces e4088c0), 3d05fc1 (session 02 and F17–F23)

### What I did
- `git log -- …/sessions`: only e4088c0 (HEAD) contained the session folder: 300 files under `profile/`
  (11 382 582 bytes), plus 7 scripts and 11 early screenshots.
- `git rm -r --cached` the session folder, `.gitignore` += `ttmp/**/sessions/*/profile/` and `**/chromium-profile/`,
  `git commit --amend --no-edit` → 7130bbd; verified `git ls-tree -r HEAD | grep -c /profile/` = 0.
- Read `packages/core/src/print/enlarger.ts` ("Real mode: the setting's optics … Normalised mode ignores them") and
  the catalogue default (`mode: 'normalised'`).
- Committed the finished session folder (diary 10 steps, report, 49 shots, scripts; no profile) and F17–F23 in
  CHB-026's findings, with a correction note for session 01's unverified "the picture is lighter".

### Why
- Amending was safe: local repository, no remote, the commit was the tip. The browser-profile files are derived
  private data and bulky cache; screenshots of the app stay in the ticket by the existing convention.

### What worked
- Verdicts: fixed F1–F7, F11, F13, F15, F16; partly F8, F9, F12; not fixed F10 (CPU 512 px, expected); not
  reproduced F14. Worst stall 517 ms (typing 1000); drags 0 stalls; strip open 2.6 s with no stall.

### What didn't work
- My `git add ttmp` in Step 7 added a directory another agent was writing to. Cause: committing a whole tree while a
  tester was active in it.

### What I learned
- The tester's pixel measurement (mean grey of the picture area at several times) caught what my session 01
  narrative missed: a control that records but does not act.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The amended-away objects stay in `.git` (reflog) until `git reflog expire --expire=now --all && git gc --prune=now`;
  nothing was pushed.

### What should be done in the future
- Never `git add` a ticket tree while a tester writes in it; stage named paths.
- F17 needs the owner's decision on the enlarger default (open question C4: real mode by default), or the Time and
  Aperture controls must be hidden or remapped in normalised mode.
- F18–F23 and the partly-fixed F8, F9, F12 and F10 (CPU) go to a follow-up ticket; then close CHB-027 and delete
  the merged branches and agent worktrees (task 5dta).

### Code review instructions
- `git show 7130bbd --stat`; `.gitignore`; CHB-026 `various/02-findings.md` (session 02 section).

### Technical details
- Tester scripts: CHB-026 `sessions/02-sonnet-rerun-session-01/scripts/` (`lib.mjs`, `s01`–`s18`;
  `s10-does-time-matter.mjs` measures the picture's mean grey).
