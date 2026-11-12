---
Title: Plan
Ticket: CHB-029
Status: active
Topics:
    - ui
    - product
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /home/manuel/code/wesen/chromobench/packages/studio-kit/src/cb.ts
      Note: createCb() — commands, keys, panels and state for every domain in one function (items 1, 2, 3)
    - Path: /home/manuel/code/wesen/chromobench/packages/studio-kit/variants/classic.js
      Note: The base the other layouts import from (item 4); menus declared per layout (item 2)
    - Path: /home/manuel/code/wesen/chromobench/apps/studio/src/main.ts
      Note: Hand-built status line, dialogs, open flow (items 5, 6)
    - Path: /home/manuel/code/wesen/chromobench/packages/shell/src/app/render/queue.ts
      Note: Knows in-flight and waiting renders per slot (item 6)
    - Path: /home/manuel/code/wesen/chromobench/packages/contract/src/catalog/capture-film-print.ts
      Note: Parameter ui metadata that generates controls (item 8)
ExternalSources: []
Summary: "Nine changes that make the UI DSL (ck/cb) carry the whole interface: typed host capabilities, one menu source, split createCb, shared modules, status bar and dialogs and a jobs model with progress UI, typed state, an advanced flag in the catalogue, variant → layout."
LastUpdated: 2026-11-12T17:30:00-05:00
WhatFor: "Spec for streamlining the UI DSL after CHB-027."
WhenToUse: "Before changing cb.ts, the layouts, the host status line or the parameter catalogue."
---

# CHB-029 plan: UI DSL streamlining

## Context

The studio's interface is written in a JavaScript UI DSL. **Layouts** (`packages/studio-kit/variants/*.js`, 9
layouts in 349 lines) compose two vocabularies: `ck`, the shell's general one (panels, rows, docks, modules,
menus, keys, commands), and `cb`, the studio's (viewer, panels, views, readouts, key maps). Controls are generated
from the contract's parameter catalogue. Three things sit outside the DSL or work against it:

- the host (`apps/studio/src/main.ts`) builds the status line, dialogs and the open flow by hand;
- `createCb()` in `packages/studio-kit/src/cb.ts` is one 600-line function holding every domain's commands;
- the layouts import shared parts from `classic.js`.

CHB-027 folded the host's top bar into the menus. This ticket finishes moving the interface into the DSL. It
starts after CHB-027 has merged (workstreams B and D are still touching `main.ts`, the queue and `cb.ts`).

## The nine items

### 1. Host capabilities as a typed part of the DSL
Today each host action is a command with `hidden: s => !hostHas(s, 'openFiles')` and
`run: ctx => hostRun(ctx, 'openFiles')`: string lookups through `state.ui.host`, repeated per command (cb.ts,
"the host's actions"). Define a typed `HostCapabilities` interface (openFiles, openFolder, reopenFolder, export,
saveRecipe, dust, …) that the host passes at mount. A command declares `requires: 'host.openFiles'` and the shell
hides it, and refuses to run it, when the capability is absent. `hostHas` and `hostRun` go away.

### 2. One source of truth for menus
Commands carry `menu: 'File'` while layouts also declare `m.menu('File', [ids…])`. Keep the layouts' lists (the
part that varies per layout) and remove `menu:` from command definitions. The command palette keeps its own
grouping through a `group` field if needed. A build check reports commands in no menu and no palette, and menu
entries that name unknown commands.

### 3. Split `createCb()` by area
Move commands, keys, state slices and panels into per-area modules (`file`, `frame`, `view`, `print`, `library`,
`roll`, `finish`, `looks`, `host`), each exporting a declarative command table (`id`, `label`, `key`, `when`,
`checked`, `requires`, `run`) next to the panels that use it. `createCb()` assembles them. Pure reorganisation:
explain snapshots and tests must stay identical.

### 4. Shared modules as a library
`lab.js`, `finish.js`, `looks.js` and `roll.js` import `menus`, `printModule`, `libraryModule` from `classic.js`.
Move them to `cb.modules.print()`, `cb.modules.library()`, `cb.menus.standard()` (and the roll, finish and looks
menus) in studio-kit. Every layout, classic included, becomes an equal composition of library parts; layouts no
longer import each other.

### 5. Status bar and dialogs in the DSL
A `ck.statusbar(...)` slot in the app frame with studio parts: `cb.status.engine()` (Fast / Compatibility mode),
`cb.status.mode()` (the Photo/Negative switch), `cb.status.jobs()` (item 6), `cb.status.notes()` (the decode
summary with the technical text in its tooltip), `cb.status.message()` (the current status line), `cb.status.offline()`.
Layouts choose what they show. Dialogs keep the shell's imperative `rt.chrome.dialog()` (it returns the chosen
button), but their bodies are built from DSL pieces, and the host's dialogs ("Where is …?", the export dialog, the
reopen confirmation) move out of `main.ts` into studio-kit, calling host capabilities.

### 6. A jobs model, and progress you can see
A `jobs` slice in the store (transient tier, never persisted): `{ id, kind: 'open'|'decode'|'render'|'thumbnail'|'export', frame?, stage?, progress?, startedAt, cancel? }`.
- **Renders are derived, not reported:** the render queue already knows in-flight and waiting work per slot and
  its pass (draft / screen / refine); a selector reads it.
- **Opens, decodes and exports report** through one helper, `withJob(kind, frame, fn)`, which ends the job in a
  `finally`, so a failure never leaves a spinner running. Stage reports come from CHB-027's engine worker (staged
  evaluation) and from export progress.
- **Writes are throttled** (at most every 100 ms per job) so progress does not churn the store.
- **UI:** a busy badge on `cb.viewer` ("Preview…" while a draft is shown and the screen pass is pending,
  "Rendering 2 s" past ~300 ms, "Refining" past 1:1; nothing under 300 ms, so the GPU engine never flickers;
  `aria-busy`); `cb.status.jobs()` (a spinner and count; a click lists jobs with frame, kind, elapsed and Cancel for
  opens and exports); open progress with stages ("Opening DSC_8541.NEF (2 of 5): decoding… / analysing negative… /
  first print…"); a spinner on filmstrip and grid thumbnails while they render.
- The agent can read `jobs` like any other state.

This item replaces the progress indicator proposed as a fifth CHB-027 workstream.

### 7. Typed state for layout authors
Selectors are `(s: any) => …` throughout. Extend `CbState` to cover the slices layouts read (catalog, selection,
prefs, ui.host, jobs, recipes), and give the 20 or so common selectors typed helpers (`cb.sel.current`,
`cb.sel.frame`, `cb.sel.prefs`, …). The layouts' `index.d.ts` exposes them so `// @ts-check` layouts get errors.

### 8. Controls fully from the catalogue, with "Advanced"
Parameter `ui` metadata gains `order` and `advanced: true`. `cb.panel.controls(group)` shows advanced parameters
behind a per-panel "Advanced" disclosure (remembered in prefs). Candidates: scan flare, base density overrides,
display knee, viewing flare, lamp. This is a contract change (catalogue metadata): bump the contract minor version
and record it in `CONTRACT-DECISIONS.md`.

### 9. Naming: variant → layout
The UI says "Layout"; the code says "variant". Rename the API (`VariantDef` → `LayoutDef`, `VARIANTS` →
`LAYOUTS`, the `variants/` folder → `layouts/`), keep `?variant=` as an alias of `?layout=`, migrate the saved
preference, update tests, docs and explain snapshots. Fold in the glossary task of CHB-028 (variant/layout,
module, kit, fragment, pass, cell, lane, slot; `ck`/`cb`; the "studio" names).

## Order

1, 2 and 4 first (small, they remove code). Then 5 and 6 together (the visible change on the CPU path). Then 8.
3, 7 and 9 when no other branch touches `cb.ts` and the layouts (they are wide but mechanical).

## Done when

- Every host action is a capability-gated command; `hostHas`/`hostRun` and the `menu:` field are gone.
- No layout imports another layout; `main.ts` builds no status-line or dialog DOM.
- On the CPU engine a user sees what is running and how far along it is; on the GPU engine nothing flickers.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `CI=1 pnpm test:browser` green; explain snapshots updated
  deliberately, with the diffs explained.
- A cosplay session on the CPU engine (CHB-026 protocol) confirms the progress display reads naturally.
