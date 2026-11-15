---
Title: Diary — diagnostics implementation
Ticket: CHB-038
Status: active
Topics:
    - ui
    - webgpu
    - architecture
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Implementation of CHB-038: the diagnostics journal, capture layers, the report kit, reopening reports, wb.diagnostics()"
LastUpdated: 2026-11-15T14:15:33.185582-05:00
WhatFor: ""
WhenToUse: ""
---


# Diary — diagnostics implementation

## Goal

The implementation agent's record of CHB-038 (spec `design-doc/01-diagnostics-and-bug-reports-spec.md`): one
diagnostics journal in the shell, one capture layer per source, the problem report as a kit with commands and a
panel, reports that reopen for the owner, and `wb.diagnostics()` for the agent.

## Step 1: Reading the spec and the code; where each piece goes

I read the spec, the main diary (Step 1: no headless reproduction of the owner's WebGPU errors), `docs/HANDOFF.md`, the
shell and values READMEs, the CHB-037 working rules §1 and the code where errors happen today, and decided where each
piece lives so that the package boundaries (`tools/scripts/check-boundaries.ts`) hold and nothing is logged twice.

### Prompt Context

**User prompt (verbatim):** "I get repeated webgpu errors, can we add some proper logging / debug / bug reporting to
the system, so my dad for example can give me proper debugging info (maybe even including the images, etc...) to
check."

**Assistant interpretation:** The main agent assigned me (a phase agent, worktree `<scratchpad>/chb038`, branch
`task/chb-038-diagnostics`) the implementation of the CHB-038 spec: journal, capture, report kit, reopening,
`wb.diagnostics()`, browser specs on SwiftShader (ports 5531–5534), commits per green step, no push or merge.

**Inferred user intent:** The owner wants evidence from his father's machine (and his own Chrome) instead of
descriptions: one file with what went wrong, what the GPU said, and the edits and pictures to reproduce it.

**Commit (code):** none (reading and design)

### What I did
- Read `apps/studio/src/main.ts` (boot, status line, open flow, service worker, the hook), `apps/studio/src/host/*`
  (engines, worker client and serve loop, presenter), `packages/gpu/src/device.ts`, `pipelines.ts`, `engine-gpu.ts`,
  `packages/shell/src/app/runtime.ts`, `chrome.ts`, `core/diag.ts`, `packages/studio-kit/src/cb.ts`, `studio.ts`,
  `bridge/frames.ts`, `bridge/saved.ts`, the chat kit and its workbench, `packages/dsl/src/workbench.ts`, `session.ts`,
  the prelude's `wb`.
- Created this diary: `docmgr doc add --ticket CHB-038 --doc-type diary --title "Diary — diagnostics implementation"`
  (docmgr named it `02-diary-diagnostics-implementation.md`; renamed to `02-diagnostics-implementation.md`).

### Why
- Two GPU devices exist on the main thread: the engine's (`GpuRuntime`, recreated after a loss by `GpuEngine.ensure`)
  and the presenter's (`presentDevice()` in `host-presenter.ts`). Both must report uncaptured errors and loss.

### What worked
- Decisions (where things go):
  - `Journal` in `packages/shell/src/core/journal.ts` (headless, imports only `@chromobench/values` types); capture of
    the console and uncaught errors in `core/journal-capture.ts` taking the objects as arguments (no globals in the
    headless half); the runtime's capture in `app/journal-runtime.ts`, started by `services.journal`.
  - The GPU package gets an events hook (`RuntimeOptions.events`, `debug`), not a dependency on the shell; the host's
    `host/capture.ts` maps the events to rows with a structural type (the UI side may not import `@chromobench/gpu`).
  - The engine worker has no journal: it posts `{ id: 0, log }` messages; `WorkerClient.onLog` writes them.
  - The report is a kit (`packages/studio-kit/kits/diagnostics`): commands that `require` members of the service
    `diagnostics` (like the chat kit's service), a `cb.diagnostics` panel form, headless report files and reader, the
    journal's KV persistence, and a DOM half (journal view, report form, report view). `cb.studio()` installs it, so
    every layout has Help ▸ Report a Problem… without editing the layouts.
  - Zipping stays in the host with `@chromobench/output`'s existing store-only `zip` (CRC32 already there); an `unzip`
    reader is added beside it. studio-kit may not import output.

### What didn't work
- N/A

### What I learned
- The shell already has a "Journal" panel (`cb.journal`: the log's entries per frame) and a Help ▸ Build Report
  (`app.diagnostics`). Both keep their names; the new panel is "Diagnostics" (`cb.diagnostics`).

### What was tricky to build
- N/A (design step)

### What warrants a second pair of eyes
- Privacy: reports only on explicit action, originals opt-in, nothing uploaded; tests on `e2e/scenes.ts`-style
  synthetic files only.

### What should be done in the future
- N/A

### Code review instructions
- Start with this step's decisions; the following steps name the files.

### Technical details
- Boundaries: shell imports only itself and values; studio-kit only contract, values, shell; `apps/studio` imports
  core/gpu/ingest only in `host/engines.ts`, `host/decode.ts`, `host/engine-serve.ts`.

## Step 2: The journal, its capture layers, GPU events, the worker's log

The journal records structured events with dedupe and counts in a ring; the capture layers write into it. This step
built the shell's part (journal, console and error capture, the runtime's capture), the GPU runtime's events and debug
scopes, the worker's log messages and the host's capture module.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Spec items 1 and 2: one journal, capture everywhere errors happen today.

**Inferred user intent:** Repeated WebGPU errors become one row with ×N, with the kernel or texture named.

**Commit (code):** see Step 3 (committed together with the host wiring, when typecheck is green again)

### What I did
- `packages/shell/src/core/journal.ts`: `Journal` (`add`, `debug/info/warn/error`, `rows(filter)`, `totals`,
  `unseenErrors`/`markSeen` for the badge, `subscribe`, `clear`, `tail(n)` → `JournalSnapshot`, `restore`, `text`,
  `explain`), `journalData` (JSON-safe, capped), `errorText`, `rowText`. Dedupe key: session, level, source, code,
  frame, message; a repeat moves the row to the end, so the ring lets go of what stopped happening.
- `core/journal-capture.ts`: `captureConsole` (wraps error/warn; sets `journal.mirror` to the original methods so the
  DevTools console still shows journal rows, at counts 1, 10, 100, …, without an echo), `captureErrors` (`error`,
  `unhandledrejection`), `guessSource`.
- `app/journal-runtime.ts` + `Runtime`: `services.journal` starts the capture; `runCommand` emits `command`; log entries
  (labels, authors, proposals, approvals; a restore is one row), undo/redo, refusals, runtime diagnostics, renders
  (debug) and render errors.
- `packages/gpu/src/device.ts`: `GpuEvent` (`device` with adapter, features, limits and what was requested; `error`
  with type, message and `during`; `lost`; `recreate`), `RuntimeOptions.events` and `debug` (every `queue.submit` in
  validation and out-of-memory scopes), `gpuErrorType`, `GpuRuntime.activity` set by `GpuEngine.render` to the node's
  op, id and size; `ensure()` reports `recreate`.
- Engine worker: `FromWorker` gains `{ id: 0, log: WorkerLog }`; `engine-serve.ts` posts its warnings, uncaught errors
  and rejections; `WorkerClient.onLog`. `console.warn` calls in `engine-serve.ts` and `engines.ts` replaced.
- `apps/studio/src/host/capture.ts`: `gpuEvents`, `watchDevice` (presenter), `workerLog`, `watchWorker` (LibRaw),
  `watchServiceWorker` + `swVersion` (`public/sw.js` now answers `{ type: 'version' }` with its cache name).
- `packages/shell/test/core/journal.test.ts`: 9 tests.

### Why
- One capture layer per source, one journal; DevTools keeps showing errors through the mirror, so no second path.

### What worked
- `npx vitest run packages/shell/test/core/journal.test.ts` → 9 passed on the first run.

### What didn't work
- `npx tsc -p tsconfig.json --noEmit`: `packages/gpu/src/engine-gpu.ts(156,54): error TS2531: Object is possibly
  'null'.` (`this.rt.lost` inside the recreate closure) — fixed with `?.`.
- `packages/studio-kit/kits/diagnostics/src/report.ts(246,5): error TS2322 … Types of property 'document' are
  incompatible. Type 'Json' is not assignable to type 'string'.` — the read-back frame reused the manifest's field
  names for bytes; now `ReportFrameRead` omits the path fields.

### What I learned
- WebGPU errors captured by an error scope never reach `uncapturederror`: the debug scopes must report themselves.

### What was tricky to build
- Dedupe vs. detail: `during` (the node) differs per render, so it is data, not part of the message; otherwise one
  repeated validation error would become a row per node.
- Restored rows keep their session and get negative ids so they never merge with this session's rows.

### What warrants a second pair of eyes
- `scopeSubmits` assigns `queue.submit` on the instance (a WebIDL method shadowed by an own property); only with
  `?debug`.
- `activity` is the last render started; with renders in flight it is a hint.

### What should be done in the future
- N/A

### Code review instructions
- `packages/shell/src/core/journal.ts`, `journal-capture.ts`, `app/journal-runtime.ts`; `packages/gpu/src/device.ts`
  (`GpuEvent`, `scopeSubmits`); `apps/studio/src/host/capture.ts`.
- `npx vitest run packages/shell/test/core/journal.test.ts`.

### Technical details
- Row: `{ id, level, source, message, code?, data?, frame?, count, first, last, session }`; snapshot
  `{ format: 'chromobench-journal', version: 1, session, saved, rows }`.

## Step 3: The diagnostics kit, the host's service, the badge, the wiring in main.ts

The report became a kit every studio installs (`cb.kits.diagnostics`): four commands that require members of the
service `diagnostics`, the Diagnostics panel form, the headless report (files in, files out), the journal's KV
persistence, and a DOM half. The host (`apps/studio/src/host/diagnostics.ts`) implements the service: environment,
pictures, originals, zip, download, and reopening a report's photos with their edits.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Spec items 3–5 and 7: the report dialog, the badge and panel, reopening, privacy.

**Inferred user intent:** The photographer presses one menu item and gets one file; the owner opens it.

**Commit (code):** (this step's commit) — "CHB-038: diagnostics journal, capture layers, GPU events, the diagnostics kit and the host's report service"

### What I did
- `packages/studio-kit/kits/diagnostics/src/`: `kit.ts` (`diagnostics.report` "Report a Problem…", `diagnostics.show`
  "Diagnostics…", `diagnostics.openReport` "Open Report…", `diagnostics.copySummary`; `requires: 'diagnostics.<member>'`;
  panel `cb.diagnostics`), `report.ts` (`reportFiles`, `readReport`, `readmeText`, `summaryText`, `reportName`,
  `CHOICES`), `persist.ts` (`keepJournal`: restore the earlier tail from KV `settings/diagnostics-journal`, save a
  second after changes and on flush), `dom.ts` (`journalView`, `reportForm`, `reportView`, `DIAGNOSTICS_RENDERERS`),
  `diagnostics.css` (tokens only).
- `cb.ts`: `cb.kits.diagnostics`; `cb.studio()` uses its kit; File gets Open Report…, Help gets Report a Problem…,
  Diagnostics…, Copy Problem Summary (Build Report stays last).
- `Frames.sourceSize(id)`, `Frames.sourceBytes(id)` (the originals for the report, read through the reader the open
  kept).
- `@chromobench/output`: `unzip` (stored entries, CRC checked) beside the existing `zip`; test in `encode.test.ts`.
- `apps/studio/src/host/diagnostics.ts`: `startJournal` (console + uncaught errors captured before anything else),
  `createDiagnostics` (environment, `build`, `report` dialog, `show`, `openReport`, `reopen`), `diagnosticsBadge`.
- `main.ts`: journal first; engine, presenter device, worker, service worker, open errors, layout switches, the
  assistant's errors into the journal; every `console.*` call of main.ts replaced; `services.journal` and
  `services.diagnostics` passed at mount; the badge in the status line; a dropped `.zip` opens as a report;
  `window.chromobench.diagnostics` (+ `devices()` for tests).
- `vite.config.ts`: `__CHROMOBENCH_VERSION__`, `__CHROMOBENCH_COMMIT__` (`git rev-parse --short HEAD`, `+dirty`).
- `packages/studio-kit/test/diagnostics.test.ts` (4 tests); layout explain snapshots regenerated
  (`npx vitest run packages/studio-kit/test/layouts.test.ts -u`: the kit's line and its 4 commands, 187 → 191).

### Why
- A kit with commands keeps the palette, menus, keys and the agent's `wb.run` on one path; the service is the host's
  part (GPU, files, zip), as with the chat.

### What worked
- `pnpm typecheck` 0 errors; `pnpm lint` ok (500 file checks); `pnpm gen:check` ok (26 files); `pnpm test` 139 files,
  3397 passed, 19 skipped.

### What didn't work
- `apps/studio/src/host/diagnostics.ts(34,26): error TS2345: Argument of type 'Window & typeof globalThis' is not
  assignable to parameter of type 'Listenable'` — `captureErrors` now takes `Pick<EventTarget, …>`.
- `apps/studio/src/main.ts(797,15): error TS18048: 'kept' is possibly 'undefined'` — `switchLayout` has its own
  `kept` (an agent layout); the journal's handle is `keptJournal`.
- The unzip test first flipped byte 40 (inside the local header's name, which the reader does not compare): no CRC
  error; it flips byte 44 (data) now.

### What I learned
- `DialogButton.run` returning `false` keeps the dialog open: "Copy summary" copies without closing.

### What was tricky to build
- Reopening a report reuses the reload path instead of a second restore: each frame's saved edit is written to the KV
  under `logKey(sha, kind, index)` and the original opens as the mode it was; the studio restores document and history
  as after a reload. A file already open in the owner's studio stays as it is.

### What warrants a second pair of eyes
- Reopening writes the report's saved edits into the owner's KV for those files (it replaces his own saved edit of
  the same file, if he had one).
- Pictures are estimated in the dialog ("about 2.5 MB" per photo); rendered at Save.

### What should be done in the future
- N/A

### Code review instructions
- `packages/studio-kit/kits/diagnostics/src/*`, `apps/studio/src/host/diagnostics.ts`, `apps/studio/src/main.ts`
  (search `journal`, `diagnostics`).
- `npx vitest run packages/studio-kit/test/diagnostics.test.ts packages/shell/test/core/journal.test.ts packages/output/test/encode.test.ts`.

### Technical details
- Zip layout: see the header of `kits/diagnostics/src/report.ts`.
