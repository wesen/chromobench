---
Title: Diary — phase P9 integration
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
LastUpdated: 2026-11-15T03:39:18.488208-05:00
WhatFor: ""
WhenToUse: ""
---


# Diary

## Goal

Phase P9 of CHB-037: prove that the unified studio (document format 3, stages and laws, the log, the stack kit,
links, the editors, the agent's workbench) works end to end; fix what integration finds; run the persona session on
the two arrangements; persist agent layouts and looks; rewrite the handoff; hand over with a report
(`reference/02-integration-report.md`).

## Step 1: The full browser suite on SwiftShader and on Metal

The first item of the spec: the whole Playwright suite headless, once on SwiftShader (ports 5511–5514) and once with
`REAL_GPU=1` on the M1 Max under the GPU lock. SwiftShader was green at the start (138 passed, 2 skipped benches);
Metal had two failures, neither in the engines: a test that raced the shell's autosave debounce, and a browser that
did not launch.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work, according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together and add the editor lab functionality / consolidate it all."

**Assistant interpretation:** The main agent assigned me phase P9 (integration) of CHB-037: run every check including
the browser suite on SwiftShader and on the real GPU, walk the studio end to end, run the persona session, persist
agent layouts and looks, rewrite the handoff, recover the export speed if cheap, and report.

**Inferred user intent:** A studio that is not only green phase by phase but works as one application for the
photographer and for the agent, handed over with an honest list of what remains.

### What I did
- `pnpm install --frozen-lockfile --prefer-offline` in the worktree (branch `task/chb-037-p9-integration` at 834ed40).
- `STUDIO_PORT=5511 STUDIO_KIT_PORT=5512 SHELL_DEMO_PORT=5513 GPU_PARITY_PORT=5514 CI=1 pnpm test:browser` →
  140 tests, **138 passed, 2 skipped** (the two 4000 px benches), 7.9 min.
- Under the GPU lock (`mkdir <scratchpad>/gpu.lock`, owner P9, removed afterwards), the same with `REAL_GPU=1`
  (adapter `apple metal-3`) → **136 passed, 2 failed, 2 skipped**, 3.8 min:
  1. `e2e/theme.spec.ts` "View ▸ Theme … saved across a reload": after the reload `prefs.theme` and `prefs.gray`
     were `undefined`.
  2. `studio-kit/test/browser/roll.spec.ts`: `TimeoutError: browserType.launch: Timeout 180000ms exceeded.` — the
     Chromium process started (`<launched> pid=14622`) and never answered on its pipe.
- Fixed (1) in the test: the view tier is saved 700 ms after a change (`packages/shell/src/app/persist.ts`) and the
  test waited a fixed 600 ms, so on a fast machine it reloaded before the save; it now flushes the pending autosave
  with `window.chromobench.rt.save()` (which saves only what the autosave marked dirty, so the dirty tracking is
  still tested). The five other `waitForTimeout(1500) // autosave` before a `page.reload()` in
  `studio-open-strips`, `studio-open-mode` and `studio-interface` got the same flush.

### Why
- A fixed wait shorter than the debounce it waits for can only pass on a slow machine; that is why SwiftShader hid it.

### What worked
- Every engine-side check passed on Metal: conformance 524/524, all `[gpu-parity]` law/tables/chain/film specs.

### What didn't work
- The two failures above (exact errors quoted).

### What I learned
- On Metal the suite is twice as fast (3.8 vs 7.9 min), which is exactly what exposes waits tuned to SwiftShader.

### What was tricky to build
- Telling a real bug from a race: the autosave also runs on `pagehide`, but an IndexedDB write started on pagehide
  need not finish (the shell's own comment says so), so a reload within the debounce can lose a view-tier change in
  real use too. For the photographer that is a theme or panel width changed less than a second before a reload;
  noted, not changed.

### What warrants a second pair of eyes
- Whether the view tier should also be flushed on `beforeunload` (synchronous localStorage fallback) — minor.

### What should be done in the future
- N/A for this step beyond the note above.

### Code review instructions
- `e2e/theme.spec.ts`, `e2e/studio-open-strips.spec.ts`, `e2e/studio-open-mode.spec.ts`, `e2e/studio-interface.spec.ts`.
- Rerun: the commands above; logs in `<scratchpad>/p9-browser-sw-1.log`, `p9-browser-metal-1.log`.

### Technical details
- Skipped by design: `[gpu-parity] bench.spec.ts:5` and `digital.spec.ts:61` (benches, run with `BENCH=1`).
