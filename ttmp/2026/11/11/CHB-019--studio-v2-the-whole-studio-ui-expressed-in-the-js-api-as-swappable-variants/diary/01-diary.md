---
Title: Diary
Ticket: CHB-019
Status: active
Topics:
    - ui
    - product
    - js-api
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T15:10:21.763462301-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-019 Studio v2 on the JS API

## Step 1: Intern guide written

I wrote the implementation guide for CHB-019: `packages/studio-kit` (the `cb` namespace and the `cb.core` kit), the
`apps/studio` host, four variants (`classic`, `darkroom`, `simple`, `lab`) and the migration of CHB-009's React
studio. The guide shows the API as builder calls from one control to whole variants, then the internals: the
EditLog route that serves `recipes.<frameId>` from each frame's EditLog, a global undo made of parts, proposals as
previews, the render bridge over CHB-009's RenderScheduler, and the host's variant loading.

The guide also files 15 staged tasks and relates 8 primary files. It came out at about 7,400 words, slightly
above the brief's range; I stopped trimming when the user asked not to overdo review.

### Prompt Context

**User prompt (verbatim):** "before we move on, now that we have worked out what to do with craftkit, let's create
the tickets and design guides (remember, no need to be overly correct in the guides, they are \"guides for
impementation\" after all, and we'll sort out details as we work) for the proper UI. Allow the UI to be entirely
expressed using the JS API, so that we can create many different versions of it."
**Assistant interpretation:** Write CHB-019's guide (studio-kit core, host, variants, CHB-009 migration) following
the shared UI design brief, with tasks, related files and this diary step; no commit.
**Inferred user intent:** An implementable plan in which every part of the studio is a builder call, so that
variants are cheap to write.
**Commit (code):** none (the orchestrator commits all guides together).

### What I did
- Read the writer brief, the UI design brief, CHB-016 diary Steps 2–4, CraftKit `docs/SHELL.md`, `docs/README.md`,
  `src/shell/index.js`, `core/store.js` and `history.js` (tx, preview, channels), and the app modules `main.js`,
  `catalog.js`, `library.js`, `cull.js`, `develop.js`, `develop-scopes.js`, `export.js` (structure and `install`).
- Read CHB-009's guide §5.1–5.11, diary Steps 14–17 and `tasks.md`, and `apps/studio/src` (`main.tsx`,
  `core/studio.ts`, `frame-session.ts`, `gesture.ts`, `store.ts`, `arrangement.ts`, the heads of `controls.ts`,
  `history.ts`, `tools.ts`, `scheduler.ts`, `keyboard.ts`, `library.ts`, `storage/db.ts`, `ui/App.tsx`), plus
  `e2e/m1-walking-skeleton.spec.ts` and `e2e/studio.spec.ts`.
- Read `packages/contract/src/editlog.ts` in full; `spec.ts` (ArgSpec, UiHints); the print ArgSpecs in
  `catalog/capture-film-print.ts`; the DSL frame handle in `prelude.ts` and `vocab`/`cut`/`ACCESSORS` in
  `packages/dsl/src/host.ts`; `RefEngine` and `GpuEngine` constructors; `tools/scripts/check-boundaries.ts`.
- Wrote `design-doc/01-intern-guide.md`; ran `08-check-guide-markdown.py` (first 8,249 words, then 7,380 words,
  22 code blocks, no problems reported); `docmgr task add` ×15; `docmgr doc relate` with 8 files.

### Why
- The EditLog/shell-history split is the central design question (flagged in CHB-016 Step 2), so the guide spends
  most of its design section on the route and the history adapter.

### What worked
- The checker reported no untagged fences, raw HTML or unbalanced fences. `docmgr doc relate` reported
  "added 8".

### What didn't work
- The first draft was 8,249 words against a 4,000–7,000 target; I removed duplication (CHB-009 module table, the
  classic ASCII layout) and condensed §5–§14 down to 7,380 words, then stopped as the user asked.

### What I learned
- `e2e/m1-walking-skeleton.spec.ts` drives sliders as native range inputs (`el.value`, synthetic `input`/`change`,
  the `min` attribute). CraftKit's slider is a `div role="slider"`, so a straight port would break the M1 spec.
- `check-boundaries.ts` forbids `apps/studio/src` from importing `@chromobench/core` and `gpu`, so the host cannot
  construct `RefEngine` or `GpuEngine` without an exception or another injection point.
- `EditLog.preview` holds one mutation, and its `apply` makes every call its own unit; CHB-009 already coalesces
  keyboard bursts before logging for that reason.
- CraftKit's `export.js` is already a kit in shape (`export const state` + `install(shell)`).

### What was tricky to build
- Global undo across shell patches and per-frame EditLog cursors. History-panel jumps move a log's cursor, and a
  later edit truncates its redo tail, so a jump cannot be a reversible global entry. The guide proposes a stack of
  parts whose EditLog parts check that their unit is still the frame's last unit in effect, and are skipped
  (CB-H401) otherwise.

### What warrants a second pair of eyes
- The skip-if-stale undo semantics (§6.3) and the native range slider decision (§5.1).
- The shell interfaces assumed from CHB-018 (store routes, history parts, services, tool `image`/`content` hooks,
  DOM-free build), which are listed in §3 of the guide.

### What should be done in the future
- Agree the route/history-part names with CHB-018; decide the engine-import boundary with CHB-017; move the DSL's
  frame vocabulary (`ACCESSORS`, `PRINT_OPTIONS`, `cut`) to a shared module; contract 0.2 request for
  `EditLog.preview(Mutation[])`.

### Code review instructions
- Read guide §4 (examples), §6 (bridge and adapter), §7 (host) and §9 (migration table) first.
- Check `python3 -I ttmp/2026/11/11/CHB-001--…/scripts/08-check-guide-markdown.py` on the guide.

### Technical details
- Variants export `{ id, label, build(ck, cb, env) }` and import nothing; kits are reached as `cb.kits.*` (a
  refinement of the design brief's sketch, which imported `rollKit`), so a file can be loaded from a Blob URL.
- `cb.studio(name)` is `ck.shell(name).use(cb.core)`; studio-kit diagnostics use the families CB-A1xx, F2xx,
  V3xx, H4xx, K5xx.
