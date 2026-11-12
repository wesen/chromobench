---
Title: User-cosplay session protocol (for agents)
Ticket: CHB-026
Status: active
Topics:
    - ui
    - product
    - testing
DocType: playbook
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/scripts/01-install-probe.js
      Note: Records toasts, main-thread stalls and status changes in the page
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/scripts/02-read-probe.js
      Note: Reads back and resets the probe plus the shell UI log
ExternalSources: []
Summary: "How to run one user-cosplay session: set up, drive the app as Manfred, measure, keep the diary and the experience report, hand back."
LastUpdated: 2026-11-12T13:40:00-05:00
WhatFor: "The brief every cosplay tester (human or agent) follows."
WhenToUse: "Before and during a session."
---

# User-cosplay session protocol

A *cosplay session* is a usability test where you **are** the user: Manfred, a photographer
(read [the persona](../reference/01-persona-manfred.md) first). You use chromobench in a real browser with his
real photos, the way he would, including his mistakes, and you write down what happens. The goal is to find
friction, confusion, breakage and slowness, not to prove the app works.

Session 01 (the orchestrator's own) is the worked example: [diary](../diary/01-diary.md),
[experience report](../various/01-experience-report-session-01.md), [findings](../various/02-findings.md).

## 1. Ground rules

1. **Stay in character for actions.** Do what he would do: click visible controls, type into fields, use menus
   and keyboard shortcuts. Never use `window.chromobench`, the DSL, URL flags or code to *do* a task.
2. **Step out of character to measure.** Probes, the UI log, timings, reading source code to explain a bug: all
   fine, but label it as developer commentary.
3. **Make mistakes on purpose.** Each scenario lists some; add your own (see the persona's list).
4. **Do not fix the app.** No source edits. Your output is the diary, the report and the screenshots.
5. **Private photos stay local** ([test material](../reference/02-test-material.md)).
6. **Do not overdo it.** A finding needs a repro and evidence, not a proof. When you are stuck for more than a few
   attempts, write down what you tried and move on: being stuck *is* a finding.

## 2. Setup

```bash
cd /home/manuel/code/wesen/chromobench
pnpm --filter @chromobench/studio build            # once per code change
pnpm --filter @chromobench/studio preview --port <PORT> --strictPort   # run in the background
mkdir -p .playwright-mcp/photos && cp <files for your scenario> .playwright-mcp/photos/
```

- Use the port you were given (each tester gets its own: a different port is a different origin, so each
  tester has its **own browser storage** and cannot see another tester's saved recipes).
- Start the app at `http://localhost:<PORT>/` (persistent storage, what Manfred gets). Use `?fresh` only when the
  scenario says so.
- The test browser has **no WebGPU**, so the app runs on its slow CPU reference engine
  (status: `reference · CPU f64 (no WebGPU…) · 512 px`). Timings are therefore worst-case; record them anyway,
  and always say they were measured on the CPU engine.

### Driving the browser

Two options. Use the one you were told to.

**A. Playwright MCP tools** (`mcp__plugin_playwright_playwright__*`). One shared browser: only for a tester
working alone.
- Load the tools with ToolSearch first (`select:...browser_navigate,...browser_snapshot,...browser_click,
  ...browser_take_screenshot,...browser_file_upload,...browser_run_code_unsafe,...browser_evaluate,
  ...browser_press_key,...browser_wait_for`).
- Files can only come from the repository: use `.playwright-mcp/photos/…`.
- Opening files: click "Open files…" then `browser_file_upload`, **or** (needed for timing) run
  `async (page) => page.setInputFiles('#file', '/abs/path/to/photo')` with `browser_run_code_unsafe`.
  (The MCP tool intercepts the file chooser, so `page.waitForEvent('filechooser')` inside run_code does not work.)
- Screenshots: `browser_take_screenshot` with `filename` **under the repository** (the scratchpad is not allowed),
  e.g. `ttmp/…/CHB-026…/sessions/<your-session>/shots/NN-what.png`. Look at every screenshot you take (Read it).
- While the app is busy, screenshot calls can time out after 5 s. That is itself a measurement (main thread
  blocked), so note it and retry after a `browser_wait_for`.
- Right-clicking an image opens **Chrome's native context menu**, which screenshots do not show and which stays
  open in the visible window. Press Escape afterwards.

**B. Your own Playwright script** (parallel testers). Write a Node script in your session folder that uses the
repository's `playwright` package (`import { chromium } from 'playwright'`), launches its own Chromium
(`headless: true`), and performs **one step per run**, saving screenshots and printing measurements. Keep the
browser state between runs with `chromium.launchPersistentContext('<session>/profile', …)` so storage persists
like Manfred's browser. Run with `node <script>.mjs` from the repository root. The same rules apply: act through
visible controls (`page.getByRole`, `getByText`, `getByLabel`, mouse moves for slider drags).

### Measuring

- Install the probe once per page: run [`scripts/01-install-probe.js`](../scripts/01-install-probe.js) with
  `browser_run_code_unsafe` (`filename` parameter), or paste its function into your script. It survives reloads.
  It records **toasts** (they disappear after about 2.6 s, so you will miss them otherwise), **main-thread
  stalls** of more than 100 ms (the window is frozen for that long), and status-line changes.
- After each step, read and reset it with [`scripts/02-read-probe.js`](../scripts/02-read-probe.js). This also
  returns the shell's own UI log (`window.chromobench.rt.chrome.log`): every toast and dialog shown since load.
- For each action, record **time to visible result** (e.g. "rendered N" in the status bar changes) and the
  **worst stall**. Compare with what a user tolerates: under 100 ms feels instant, under 1 s is OK for a slider
  release, and anything that freezes the window during a drag is a defect.
- `window.chromobench` (dev hook) exposes `studio.frames.all()`, `studio.current`, recipes (`e.log.committed`),
  `engineLabel`. Use it to *explain* what you saw, never to act.

## 3. During the session: two documents, one folder

Make `sessions/NN-<tester>-<scenario-id>/` in this ticket with `shots/`, `diary.md` and `experience-report.md`.

### The diary (`diary.md`), rigid and chronological

Use the investigation format of the diary skill: numbered steps; each has 1–2 prose paragraphs, then
*Prompt Context*, *What I did*, *Why*, *What worked*, *What didn't work*, *What I learned*,
*What was tricky*, *What warrants a second pair of eyes*, *What should be done in the future*,
*Code review instructions*, *Technical details*. Quote your brief verbatim in Step 1. Record exact toasts,
timings and status text. Reference screenshots by relative path. Write a step after every few actions; do not
batch the whole session at the end.

### The experience report (`experience-report.md`), Manfred's voice

A first-person narrative of the session as he would tell it: what he wanted, what he tried, what he expected,
what happened, how it felt. Plain words, no jargon. Embed screenshots (`![…](shots/NN-….png)`).
Where you have a technical explanation, a code pointer or a measurement, add a callout:

```markdown
> **Developer commentary.** `frames.open()` dedupes by content hash
> (`packages/studio-kit/src/bridge/frames.ts:69`), so the second open returns the old frame; the status line is
> only cleared for multi-file opens (`apps/studio/src/main.ts:254`). Stall: 2.9 s on the main thread.
```

End the report with **"What I would tell the developer"**: the 3–7 things that mattered most to him, in order.

## 4. Findings

At the end, add a `## Findings` table to your experience report. Use the IDs of the shared
[findings list](../various/02-findings.md) when you hit a known finding (say "F3 reproduced"), and new ones as
`<session>-N`. Columns: ID, severity (blocker / major / minor / note), one-line summary, repro, evidence
(screenshot, toast text, timing). Do **not** edit the shared findings list; the orchestrator merges.

Severity guide: **blocker**, he cannot get a correct print or loses work; **major**, he can, but only with
outside help, or the app freezes or misleads him; **minor**, it's friction he can work around; **note**, an
observation or a question.

## 5. Hand back

Your final message to the orchestrator (keep it short; the documents carry the detail):

```text
Session: sessions/NN-…/   Scenario: S0x   Port: …   Engine: reference (CPU)
Done: <steps completed> / Not done: <and why>
Top findings (max 7, ID + one line):
New vs known: <new IDs> / <known IDs reproduced>
Worst stall: … ms during …
Files: diary.md, experience-report.md, shots/ (N)
```

No commits unless your brief says so (the orchestrator commits).
