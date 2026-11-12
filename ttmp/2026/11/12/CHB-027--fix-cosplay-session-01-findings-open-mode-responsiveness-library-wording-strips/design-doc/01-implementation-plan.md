---
Title: Implementation plan
Ticket: CHB-027
Status: active
Topics:
    - ui
    - product
    - ingest
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/various/02-findings.md
      Note: The findings F1–F16 this ticket fixes (repro, evidence, code pointers)
    - Path: /home/manuel/code/wesen/chromobench/packages/studio-kit/src/bridge/frames.ts
      Note: Frame identity, de-duplication and resumed edit logs (WS-A)
    - Path: /home/manuel/code/wesen/chromobench/apps/studio/src/host/engines.ts
      Note: Decode switch and engine construction (WS-A decode mode, WS-B worker)
    - Path: /home/manuel/code/wesen/chromobench/apps/studio/src/main.ts
      Note: Open flow, status line, top bar (WS-A, small WS-C edits)
    - Path: /home/manuel/code/wesen/chromobench/packages/studio-kit/src/dom/arg.ts
      Note: Typed value fields (WS-C)
ExternalSources: []
Summary: "Four workstreams fixing the CHB-026 session 01 findings: A open mode and library, B responsiveness, C wording and forms, D strip frames."
LastUpdated: 2026-11-12T14:30:00-05:00
WhatFor: "Spec for the CHB-027 implementation agents and the merge."
WhenToUse: "Before implementing or reviewing any CHB-027 branch."
---

# CHB-027 implementation plan

The first user-cosplay session (CHB-026) played Manfred, the photographer chromobench is for, on his own Nikon D750
NEFs and a real colour-negative strip. It found 16 problems:
[findings F1–F16](../../CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/various/02-findings.md)
(each with repro, screenshots, timings and code pointers; read the entries for your workstream before starting).
This ticket fixes all of them in four workstreams. A, B and C run in parallel in separate worktrees; D starts
after A is merged because it builds on A's frame identity.

The **acceptance test** for the whole ticket is a re-run of the session-01 steps (CHB-026's
[experience report](../../CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/various/01-experience-report-session-01.md)):
each finding must be gone or deliberately downgraded with a reason.

## WS-A: open mode, frame identity, library (F1, F2, F3, F5, F6, F15, F11 empty state)

Branch `task/chb-027-open-mode`. The three blockers.

1. **Decode mode per file, guessed (F1, F15).** Replace the global `photo` checkbox with an *Open as* choice:
   **Auto** (default), Photo, Negative, remembered in KV. Auto classifies each file:
   - a camera RAW (NEF, CR2, …) or a TIFF, PNG or JPEG with no orange mask and no film edge → **photo**;
   - a strong orange-mask cast, or a film edge, rebate or open gate found by `filmLayout` → **negative**;
   - unsure → ask once per open batch ("Are these photos from a camera, or scans of negatives?"), with the guess
     preselected.

   Evidence to calibrate on: raw010.dng (scan mode: base 0.12 / 0.41 / 0.71 D, rebate found at the edge) versus
   D750 NEFs (scan mode: no rebate, no gate, no surround). Private photos stay out of the repo: tests that use them
   must skip when the files are absent; CI tests use synthetic images. `HostServices.decode` gets an explicit mode
   argument instead of reading `settings.photo`.
2. **Re-interpret (F3, F6).** A per-frame command **"Re-open as photo / as negative"**, in the Frame menu, the
   thumbnail context menu and next to the frame's mode badge. It decodes again in the other mode and starts that
   mode's recipe.
3. **Saved logs match the mode (F3).** A resumed log must belong to the same decode mode: key logs by
   `(sha, mode)`, and accept an old plain-`sha` log only when its `kind` matches the decode. Never render a
   `digital-raw` recipe on a scan-mode decode or the reverse.
4. **Opening an open file (F2).** It selects the existing frame and toasts "already open" (or re-interprets it
   when the chosen mode differs, after a confirmation). The status line always ends: "opened <name>", or an
   error.
5. **Library survives a reload (F5).** Persist the catalog (frames: name, sha, mode, flags, thumbnail, file handle
   when the File System Access API gave one) in KV. After a reload the frames are listed with their thumbnails;
   opening one re-reads the file through its handle (a permission click) or asks him to locate the file. Use
   `showOpenFilePicker` where available, so files have handles.
6. **Frame management (F6).** Remove from library (Frame menu, Delete key, context menu). A real context menu on
   filmstrip and grid thumbnails (Remove, Re-open as…, Flag). File menu: Open Files…, Open Folder…, Export….
7. **Empty state (F11).** "No photos yet: Open files… or drop them here".

## WS-B: responsiveness (F4, F10)

Branch `task/chb-027-responsive`. The window must never freeze during a drag or an open.

1. **Measure first** with the CHB-026 probe (`scripts/01-install-probe.js`, `02-read-probe.js`) in a headless
   Playwright script on the real files (skip when absent), on **both** engines. The repository's browser tests
   already run WebGPU headless (GPU conformance), so reuse their launch flags. Record the before numbers in the
   diary: open time, stalls during open, stalls and time-to-result for a 20-move slider drag, typed-value commit.
2. **Off the main thread.** A worker that hosts decode, `linearise`, the working-image resample and scan
   conditioning (for both engines), and the reference `RefEngine` (CPU path): a `WorkerEngine` proxy implementing
   `Engine` on the main thread. Pixels move as transferables. `engines.ts` stays the only host file importing
   core, gpu and ingest; add the worker entry to `tools/scripts/check-boundaries.ts`'s exceptions.
3. **Latest wins inside the worker.** The shell queue already drops stale requests and aborts in-flight ones
   (`packages/shell/src/app/render/queue.ts`). Make the worker honour `AbortSignal` between stages and skip
   superseded jobs, so a drag costs one render at a time and the last value always gets rendered.
4. **Drafts during drags.** Check that the viewport's `draft` pass reaches the engine as a smaller `scale`, and
   that `RefEngine` computes fewer pixels for it. Then raise the reference working image from 512 px towards
   1024–1600 if drafts keep drags fluid (F10: the soft preview).
5. **Stage caching.** Confirm by profiling whether a print-only change (time, filtration, grade) recomputes the
   negative stages; if it does, cache them by node id (content addressing should already allow this).
6. **After numbers** in the diary on both engines. Target: no stall over 100 ms during a drag or an open on the
   GPU engine; on the CPU engine no stall over 100 ms, with the final render arriving later.
7. Note for the GPU engine (`GpuEngine` stays on the main thread): measure and report; don't move it.

## WS-C: wording, forms, messages (F7, F8, F9, F11 chrome, F12, F13, F14)

Branch `task/chb-027-wording`. The app talks to a photographer.

1. **Human error messages (F7).** Toasts for `E_*` errors from argument validation get photographer text:
   `E_ARG_RANGE` on `print.enlarger.time_s` reads "Time must be between 0.1 s and 600 s". A mapping from error code
   plus argument path to text in studio-kit, with the code kept in the toast's title or tooltip for agents and
   developers. Typed values out of range are **clamped**, with a toast saying so.
2. **Typed values (F8).** The fields explain themselves (a placeholder or tooltip: "15, 12s, 7,5 — or +1/3 st to
   change by"). A relative entry toasts its effect ("Time −5 s → 10 s"). A bad entry shows a short message and
   resets the box on blur or Escape; the red state never survives a frame switch.
3. **Jargon (F9).** The status line says "Fast (graphics card)" or "Compatibility mode: slower (no WebGPU)", with
   the technical label in the tooltip. Decode notes get a one-line human summary ("Nikon D750 photo, 24 MP",
   "Colour negative, 3 frames, film edge found") with the full notes behind it. Tooltips for filtration and
   printer lights in darkroom words. Stock and paper names are shown as names ("Kodak Portra Endura",
   "Fujifilm C200"), never as ids (the Paper row shows `kodak_portra_endura` above the select).
4. **Undo naming (F12).** Edit ▸ Undo/Redo name the frame when it isn't the current one.
5. **Round values (F13).** Drags land on values a printer would set (⅙-stop steps shown to 0.1 s; prefer ⅓ stops
   or whole seconds past 10 s). The Time slider's range covers the automatic first print (2.23 s sits at the
   2 s floor now).
6. **F14.** Find out why a "Commands" dialog appeared (likely a key typed into a field reaching a global shortcut)
   and fix it.
7. **Chrome duplication (F11).** Small, safe parts only: the name once and the empty-state text if WS-A hasn't done
   it. Folding the host top bar into the shell is an open user decision, so leave it.

## WS-D: strips into frames (F16), after WS-A merges

Branch `task/chb-027-strip-frames`. A scan holding several frames (raw010.dng: three on one strip) opens as
several frames.

1. Detect frame gaps along the strip's long axis in density (inter-frame gaps read near base; the rebate runs along
   the edges) in ingest, next to `filmLayout` (which finds one image area). Return frame boxes with confidence.
2. The studio opens one frame per box: same file and sha, identity `(sha, mode, index)`, each frame with its crop.
   A single frame per file stays the common case.
3. The roll base and veil come from the whole strip (shared by its frames).

## Ownership and merge

| File | A | B | C | D |
|---|---|---|---|---|
| `packages/studio-kit/src/bridge/frames.ts`, `studio.ts`, kv/persistence | ✎ | | | ✎ (after A) |
| `apps/studio/src/host/engines.ts` | decode mode (small) | ✎ worker | | ✎ |
| `apps/studio/src/host/studio-engine.ts` | small | ✎ | | |
| new `apps/studio/src/host/*worker*` | | ✎ | | |
| `apps/studio/src/main.ts` | ✎ open flow, menus, top bar | engine status only | status wording, empty state (small) | |
| `packages/studio-kit/src/dom/arg.ts`, `kit/args.ts`, messages | | | ✎ | |
| `packages/shell/src/app/runtime.ts` (toasts, undo labels) | | | ✎ | |
| `packages/ingest/src/conditioning/*` | classifier (new file) | | | ✎ strip frames |

Expect conflicts in `main.ts` and `engines.ts`; the orchestrator merges A, then C, then B, resolving by hand.
Each branch keeps `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `CI=1 pnpm test:browser` green.

## Done when

- All findings F1–F16 are fixed or downgraded with a reason, in a table in this ticket's diary.
- The session-01 re-run (a cosplay session following the CHB-026 protocol) shows it, with before/after timings.
