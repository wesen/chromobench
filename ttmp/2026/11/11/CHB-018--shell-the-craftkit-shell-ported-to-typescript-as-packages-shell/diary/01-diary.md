---
Title: Diary
Ticket: CHB-018
Status: active
Topics:
    - ui
    - js-api
    - architecture
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T15:10:21.626178027-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-018 Shell port

## Step 1: Intern guide written

This step writes the implementation guide for `packages/shell` (`ck`), the TypeScript port of CraftKit Shell v1 that
every UI ticket builds on. I read the shell sources in CHB-016 (`src/shell/**`, `docs/SHELL.md`, the three Node tests),
the UI design brief, CHB-016 diary Steps 2–4, CHB-009's presenter, RenderScheduler, storage and gesture modules, the
contract's EditLog, and the repo conventions, then wrote a file-by-file port plan plus the new mechanisms.

The guide keeps CraftKit's grammar and runtime nearly whole and adds: per-instance `createCk()` (no globals), headless
form specs separate from DOM renderers, store prefix tiers, named preview layers and routes (recipes routed to an
EditLog adapter, mirrored for reads), a render bridge plus a slot/lane render queue replacing CraftKit's compile-once
engine, fragments with late method resolution, kits, a pass manager over named IRs, `explain`, and typed Presenter,
RenderBridge, HistoryAdapter, PersistenceAdapter and theme token interfaces.

### Prompt Context

**User prompt (verbatim):** "before we move on, now that we have worked out what to do with craftkit, let's create the
tickets and design guides (remember, no need to be overly correct in the guides, they are \"guides for impementation\"
after all, and we'll sort out details as we work) for the proper UI. Allow the UI to be entirely expressed using the
JS API, so that we can create many different versions of it."
**Assistant interpretation:** Write CHB-018's implementation guide (port plan, typing, new mechanisms, stages,
testing), file tasks and related files, and record this step; no code.
**Inferred user intent:** A guide good enough to start implementing the shell, consistent with the shared brief and
the sibling UI guides.
**Commit (code):** none (the orchestrator commits all guides together).

### What I did
- Read `CK/src/shell/{index,shell}.js`, `core/{store,history,track,cells,commands,keys,diag,util,engine}.js`,
  `ui/{node,dom,habits,dock,viewport}.js`, heads of `chrome.js`, `icons.js`, `forms/*.js`, `shell.css`;
  `CK/test/{core,keys,engine}.test.mjs`; the Runtime Inspector in `CK/src/app/main.js`.
- Ran `node test/core.test.mjs && node test/keys.test.mjs && node test/engine.test.mjs` in the CHB-016 sources (Node
  v24.18.0): all passed.
- Read `apps/studio/src/present/presenter.ts`, `presenter-webgpu.ts` (head), `core/scheduler.ts`, `core/store.ts`,
  `core/gesture.ts`, `core/frame-session.ts`, `storage/db.ts`, `studio.css` tokens; CHB-009 guide §5.6;
  `packages/contract/src/{editlog,errors,engine}.ts`; `tsconfig.base.json`, `vitest.config.ts`,
  `playwright.config.ts`, `tools/scripts/check-boundaries.ts`, `packages/engine-mock/package.json`.
- Grepped CHB-020/021/022 guides for their `ck.fragment`/`ck.kit`/`ck.pass` usage and adopted their names.
- Wrote `design-doc/01-intern-guide.md`; 16 tasks with `docmgr task add`; 8 related files with `docmgr doc relate`.

### Why
- Services (bridge, presenter, adapters, persistence) are passed at start/mount rather than recorded, so one variant
  builds headless with fakes and runs in the browser with the real engine.
- Routes with mirrors keep the EditLog the single authority for recipes while tracking and bindings stay unchanged.

### What worked
- CraftKit's shell maps cleanly onto the brief; most files port as-is. The CHB-009 Presenter interface only needs
  shell-local copies of `Box`/`SampleData` to be generic.

### What didn't work
- The first draft was about 9,800 words by the checker; cut to 7,990 (including code blocks) in the second pass.

### What I learned
- CraftKit's headless blockers are few and specific: `instanceof Node` in `isProps`, `Chrome`/`Dock` built in the `App`
  constructor, `document.activeElement` in the scope chain, module-level registries and `isMac`.
- `basic.js` lets `reset` be a lambda although the slot is β (would trigger B140); the port makes it τ.
- `parseValue` uses `Function()`, which a strict CSP forbids.

### What was tricky to build
- Build-time checks of frame-dependent bindings (`s.recipes[s.ui.frame]…`) against an empty state: proposed a tracker
  probe mode plus route `checkPath` with a wildcard key segment, replacing CraftKit's `lazy: true`.
- Fragment methods called before `.use(kit)`: proposed recording pending calls on nodes and resolving them in the
  `normalize` pass.

### What warrants a second pair of eyes
- DR-5 (routed recipes, compound undo) and the interleaved-undo policy when an EditLog moves outside the global stack.
- Named preview layers for agent proposals versus CraftKit's single gesture layer.
- Whether CHB-009's presenters should move into the shell (DR-6 keeps them in chromobench).

### What should be done in the future
- Verify whether vitest rewrites `Error.stack` (call sites) in stage 1; decide happy-dom vs Playwright for DOM tests;
  settle `kit.state(...)` argument shape with CHB-020.

### Code review instructions
- Start at the guide sections 4.3 (file table), 5.4 (store extensions), 5.9 (interfaces) and 7 (stages).
- `python3 -I ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/scripts/08-check-guide-markdown.py <guide>`

### Technical details
- Guide: `ttmp/2026/11/11/CHB-018--shell-the-craftkit-shell-ported-to-typescript-as-packages-shell/design-doc/01-intern-guide.md`.
- CraftKit shell: 3,893 lines JS + 377 lines CSS; constants kept: coalesce 1.5 s, history limit 500, proxy 384 px,
  thumb cache 400, idle slice 12 ms, autosave debounce 700 ms, slow frame > 24 ms, ten-pass loop limit.
