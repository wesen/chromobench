---
Title: 'Intern guide: Studio v2 — the whole studio UI in the JS API, as swappable variants'
Ticket: CHB-019
Status: active
Topics:
    - ui
    - product
    - js-api
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://apps/studio/src/core/controls.ts
      Note: ControlModel from ArgSpec.ui, the basis of cb.arg
    - Path: repo://apps/studio/src/core/gesture.ts
      Note: drag preview and 800 ms burst logic that moves into the EditLog route
    - Path: repo://apps/studio/src/core/studio.ts
      Note: CHB-009 core whose methods become cb.core commands and bridge code
    - Path: repo://e2e/m1-walking-skeleton.spec.ts
      Note: acceptance test that must pass unchanged after the migration
    - Path: repo://packages/contract/src/editlog.ts
      Note: EditLog API the route and history adapter wrap (preview, apply, propose, approve, why)
    - Path: repo://packages/dsl/src/host.ts
      Note: 'ACCESSORS, PRINT_OPTIONS and cut: the frame vocabulary cb.frame must match'
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/app/library.js
      Note: library module patterns (cells, command table, views) to port
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/various/ui-design-brief.md
      Note: shared UI design brief this guide refines
ExternalSources: []
Summary: How to build packages/studio-kit (cb), the apps/studio host and four variants (classic, darkroom, simple, lab) on the CHB-018 shell, with the EditLog bridge, history adapter and render bridge, and how CHB-009's React studio migrates.
LastUpdated: 2026-11-11T15:10:20.834359552-05:00
WhatFor: Implementation guide for CHB-019
WhenToUse: Before starting studio-kit, the studio host, a variant, or the CHB-009 migration
---

# Intern guide: Studio v2 — the whole studio UI in the JS API, as swappable variants

## 1. What this ticket builds

The studio is the app in which the photographer (Manuel's dad) turns scanned negatives into prints. He picks
frames from a roll, prints them through chromobench's film and paper model, dodges and burns, compares and saves.
CHB-009 built a first studio: React components on top of a framework-free core. CHB-019 rebuilds the user
interface so that **all of it is written as builder calls in plain JS**, using the CraftKit shell (`ck`, ported to
TypeScript by CHB-018) and chromobench's own vocabulary (`cb`, this ticket). One JS module that builds a complete
studio is a **variant**. Because a variant is only an arrangement of shared pieces, a new one is cheap to write:
for us, and later for the agent.

CHB-019 owns four things:

1. **`packages/studio-kit`**, the `cb` namespace: controls generated from the op registry (`cb.arg`), the frame
   viewer (`cb.viewer`), library views, history, approval cards, provenance, snapshots, darkroom tools and units.
   It also holds the runtime pieces that connect the shell to chromobench: the **EditLog bridge**, the **history
   adapter**, the **render bridge** and the **persistence adapters**.
2. **`apps/studio`**, the host: it boots storage and engines, picks and builds a variant, mounts it, shows
   diagnostics and the "explain" view, and hot-reloads variants in development.
3. **Four variants**: `classic` (Lightroom-like modules), `darkroom` (one enlarger-first screen), `simple` (three
   steps for the photographer) and `lab` (everything plus inspectors, for us).
4. **The migration** of CHB-009's React app. The framework-free core and the tests stay; the React components go.

Out of scope: the shell itself (CHB-018); the roll, looks and finish kits (CHB-020, CHB-021, CHB-022); the chat
(CHB-008, which gets a slot here); export and colour management (CHB-011); physics.

Here is a complete, if spare, studio. It is the shape every variant has:

```js
// apps/studio/variants/tiny.js
export default {
  id: 'tiny', label: 'Tiny',
  build: (ck, cb) => cb.studio('Chromobench')
    .left(cb.view.strip({ vertical: true }))
    .center(cb.viewer(s => cb.frame(s).print()))
    .right(ck.dock.column({ width: 300 }, cb.panel.controls('darkroom'), cb.panel.history())),
}
```

`cb.studio(name)` is `ck.shell(name).use(cb.core)`: a shell with chromobench's core kit installed. The left column
shows the roll's frames, the centre shows the selected frame printed, and the right column shows the darkroom
controls and the frame's history. The variant imports nothing; it receives `ck` and `cb` from the host. That makes
a variant file self-contained, so the host can also load one from disk (section 7).

## 2. Background

### 2.1 The shell grammar, in brief

CHB-016's study and the shared UI design brief explain CraftKit in full; here is the minimum. An app is
**recorded**, then **checked**, then **mounted**. `ck.panel('basic', {...}, kids)` only records a plain node
`{ $: 'panel', props, kids, at }` with its call site `at`; `.build()` runs check passes and reports diagnostics
against the program's own lines; `.mount(el)` starts the runtime.

Every option ("slot") of a component declares when its value is read, its **binding time**: β at build (a minimum,
a list of options), τ traced (a lambda `s => …` re-run when a path it read changes), *bind* (a τ lambda naming one
path, two-way), θ per item (a row of a list), ƒ helper (a formatter), ρ runtime (a handler with `ctx`). A lambda in
a β slot is a build error.

State is one immutable tree split into tiers by top-level key. The **document** tier is undoable and persisted. The
**view** tier is free and saved with the workspace. A **preview** layer holds values during a gesture:
`ctx.preview(path, v)` many times, then `ctx.commit(label)` makes one transaction and one undo step. Commands live
in one table that drives menus, the palette (Mod+K), toolbars and the shortcut sheet. CHB-018 adds **fragments**
(extend a component with methods and props), **kits** (bundles a variant installs with `.use(kit)`), **passes**
(transformations and checks over an IR) and **`ck.explain(x)`** (any node, kit or app as text).

### 2.2 Recipes and the EditLog

A frame's settings are a **recipe** (`FrameRecipe`, `packages/contract/src/recipe.ts`): paper, enlarger time and
filtration, printer lights, masks, exposures, probes. Recipes are never edited in place. Each frame has an
**EditLog** (`packages/contract/src/editlog.ts`), an append-only journal of **mutations** grouped into undo units;
the recipe is the fold of the units in effect. Its API matters to every section below:

| call | what it does |
|---|---|
| `log.preview(m)` | a transient overlay for a drag: `log.state` includes it, nothing is logged |
| `log.apply(ms, 'user', label)` | one undo unit; validates first, clears the preview |
| `log.propose(ms, { tx, why })` | agent changes: refused in read-only mode, pending in ask mode, applied in auto mode |
| `log.approve(seqs, { force })` | pending → applied as one unit; returns `E_STALE` diagnostics if a value changed meanwhile |
| `log.reject(seqs)` | pending → rejected |
| `log.undo()`, `log.redo()` | move the cursor over the units |
| `log.why(path)` | provenance: who set this path, when, in which transaction |
| `log.on(fn)` | events `apply`, `undo`, `redo`, `propose`, `approve`, `reject`, `preview`, `mode` |

For example: a drag of the time slider from 10 s to 12.6 s is many `preview` calls and one `apply`, leaving entry
`{ seq: 1, by: 'user', tx: 'g1-1', status: 'applied' }`. An agent proposal of `print.lights.logH = [0.1, 0, 0]`
(+4 points red) in ask mode is entry 2, `pending`, with `expect: [0, 0, 0]`; if the lights change before approval,
`approve([2])` returns `E_STALE`.

### 2.3 Frames, handles and content-addressed nodes

`compile(recipe, graph)` turns a recipe into a chain of nodes (source.open → scan → invert.dyes → print.expose →
… → output). Nodes are **content-addressed**: the id hashes op, arguments and inputs, so the same recipe yields the
same ids, a print change leaves the scan and inversion nodes alone, and the engine's cache (by node id) recomputes
only the print part.

The agent's DSL (CHB-007, `packages/dsl/src/prelude/prelude.ts`) gives frames **handles**: `frame.source()`,
`scan()`, `negative()`, `print()`, `display()`, each a lazy reference to a node. Studio-kit builds the **same
handles host-side**: `cb.frame(s).print()` in a viewer is `frame.print()` in an eval.

### 2.4 What CHB-009 built

CHB-009 (`apps/studio`, commits `7185e57` and `aa0c754`, diary Steps 16–17) runs on the mock engine. It has a
library and film strip with persistence by SHA-256, a WebGPU Display-P3 viewer with a Canvas2D fallback, controls
generated from `ArgSpec`, gestures that become one mutation each, history and approvals with `E_STALE`, and five
darkroom tool UIs. Everything except the React components lives in framework-free modules under `src/core`,
`src/present` and `src/storage`, with 34 unit tests and two Playwright specs. Section 9 lists each file and what
becomes of it.

## 3. Where it sits

```text
apps/studio (host)          boot storage + engines, pick/build/mount a variant, Build Report, explain, test hook
  variants/*.js             classic · darkroom · simple · lab: arrangements of the pieces below
packages/studio-kit (cb)    cb.core kit: components, commands, tools, passes, state slice
  model/  render/  present/ moved from CHB-009 (controls, units, history, tools, sessions, scheduler, presenters)
  bridge/                   EditLog route, history adapter, render bridge, persistence
  kits/roll·looks·finish    CHB-020 · CHB-021 · CHB-022 (built on cb.core)
packages/shell (ck)         CHB-018: builder, store, history, commands, keys, docks, viewport, diagnostics
packages/contract · engine-mock · core (RefEngine) · gpu (GpuEngine) · dsl   Phase 1
```

Studio-kit depends on the shell and the contract. It does not import `@chromobench/core`, `gpu` or `ingest`; engines
arrive by injection as `Engine` objects, as CHB-009's boundary rule already requires (`tools/scripts/
check-boundaries.ts`). Add the same rule for `packages/studio-kit/src`, and a stricter one for `packages/shell/src`
(no `@chromobench/*` at all).

**Before CHB-018 lands**, write studio-kit against the design brief's sketches and a small recording stub of `ck`
(`packages/studio-kit/test/ck-stub.ts`: nodes, `.build()` with diagnostics, `explain`). Render against `MockEngine`
first. Studio-kit needs these from the shell beyond CraftKit v1 (requests to CHB-018; names are proposals):

| need | why | proposed shape |
|---|---|---|
| store routes | `recipes.<frameId>` must be served and written by the EditLog, not the store | `kit.route(prefix, adapter)` (section 6.2) |
| history parts | one global undo across shell patches and EditLog units | entries made of `HistoryPart`s with `undo()`/`redo()` |
| services | the engine, storage and presenter come from the host | `app.mount(el, { services })`, read as `ctx.services` |
| render bridge interface | the viewer's images come from `compile(recipe)` and an `Engine` | `RenderBridge` with slots, epochs, `live`/`bg` lanes |
| DOM-free build | variants must build and explain in Node | `.build()` touches no DOM; only `.mount()` does |
| tools that change the image | a test strip replaces what the viewer shows | a tool option `image: (handle, s) => handle` or `content: node` |

## 4. The API by example, simple to complex

### 4.1 One control

```js
cb.arg('print.enlarger.time_s')
```

This records a node `{ $: 'cb.arg', props: { path: 'print.enlarger.time_s' } }`. At build, a pass looks the path up
in the registry (`pathOwners`, `fieldSpec`) and makes CHB-009's `ControlModel`: a slider in seconds on a log2
scale, steps of 1/6 stop, an aside in stops, hard range 0.1–600 s, usual range 2–60 s. When mounted, it binds to
`recipes.<current frame>.print.enlarger.time_s` and reads "12.6 s · +1/3 st". Options and fragment methods refine
it:

```js
cb.arg('print.enlarger.time_s', { label: 'Exposure', step: '1/3 st' }).testStrip({ count: 5 })
cb.arg('print.enlarger.filtration')                 // three CC sliders C, M, Y
cb.arg('print.enlarger.filtration.y')               // one component
cb.arg('print.lights.logH').pad()                   // colour pad + density slider, in points
cb.arg('print.paper')                               // a select; values from the stock list
cb.arg('print.enlarger.time_s', { frame: s => s.ui.compareWith })   // bound to another frame
```

A mistake is reported with a computed fix:

```text
CB-A101 error  variants/darkroom.js:14:7
  cb.arg('print.enlarger.time'): no recipe path print.enlarger.time
  did you mean print.enlarger.time_s?   fix: cb.arg('print.enlarger.time_s')
```

### 4.2 A panel, by hand or from data

```js
ck.panel('enlarger', { title: 'Enlarger', reset: true },
  cb.arg('print.enlarger.time_s').testStrip(),
  cb.arg('print.enlarger.fstop'),
  cb.arg('print.enlarger.filtration'),
  cb.arg('print.lights.logH').pad())

cb.panel.controls('darkroom')   // the same thing, generated from the DARKROOM arrangement (data)
cb.panel.controls('all')        // every recipe-backed ArgSpec, grouped by ui.group
```

CHB-009's `DARKROOM` arrangement (`src/core/arrangement.ts`) becomes data that `cb.panel.controls` turns into
sections of `cb.arg`. Its audit (every path exists) becomes a build pass, so a bad arrangement is a diagnostic
with a line, not a failed unit test.

### 4.3 The viewer

```js
cb.viewer(s => cb.frame(s).print(), {
  id: 'main',
  views: ['print', 'negative', 'dyes', 'classes'],               // keys 1–4, a segmented switch
  compare: { before: s => cb.frame(s).initial().print() },       // \ toggles, Y side by side, split
  tools: ['probe', 'test-strip', 'ring-around', 'mask-brush', 'mask-gradient', 'mask-ellipse'],
  overlays: [cb.overlay.probes(), cb.overlay.proposal()],
  hud: cb.hud.readout(),                                         // the densitometer line
})
```

The first argument is a τ lambda that returns a **handle**. It re-runs when the selection or the frame's recipe
changes; a different handle means a different node id, and a different node id means a render. Section 5.2
explains the lowering from handle to pixels.

### 4.4 A module

```js
shell.module('print', m => m.label('Print').key('D')
  .txOpts(s => ({ channel: cb.current(s) }))           // undo says "Undo Time (on frame 12)"
  .left(ck.dock.column({ width: 236 }, cb.panel.snapshots(), cb.panel.history()))
  .center(cb.viewer(s => cb.frame(s).print(), { tools: ['probe', 'test-strip', 'ring-around'] }))
  .right(ck.dock.column({ width: 300 },
    cb.panel.densitometer(), cb.panel.controls('darkroom'), cb.panel.exposures(), cb.panel.approvals()))
  .bottom(cb.view.strip())
  .keys({ ...cb.keys.cull, T: 'tool.test-strip', R: 'tool.ring-around', '\\': 'view.beforeAfter' }))
```

### 4.5 Library views

```js
ck.match(s => s.view.mode, {
  grid:    cb.view.grid({ cell: cb.cell.frame({ print: true, badges: true }) }),
  loupe:   cb.view.loupe(),                           // a cb.viewer with library defaults
  compare: cb.view.compare(),                         // select and candidate, side by side
  survey:  cb.view.survey(),                          // the selection, fitted, no scrolling
}, { of: ['grid', 'loupe', 'compare', 'survey'] })
```

`cb.cell.frame` is a θ (per item) cell: a thumbnail of `cb.frame(s, item.id).print()` rendered on the background
lane and cached by node id, plus flag, stars, label and badges (edited, pending agent change, gamut warning).

### 4.6 History, approvals, provenance, snapshots

```js
ck.dock.column({},
  cb.panel.approvals(),     // one card per pending agent tx: Show · Approve · Reject; Approve all; Apply anyway
  cb.panel.history(),       // the frame's EditLog: groups by tx, author, cursor; click jumps
  cb.panel.why(),           // why the focused control has its value (i on a control)
  cb.panel.snapshots())     // named recipes; restore is one transaction
```

### 4.7 Extending: a fragment, a pass, a kit

Fragments add methods to components. Here is how studio-kit defines `.testStrip()` on exposure-like arguments:

```js
ck.fragment('cb.arg', {
  when: n => STRIPPABLE.has(n.props.path),                 // time_s, filtration and its components
  methods: {
    testStrip: (n, opts = {}) => n.with({ aside: ck.ui.command('tool.test-strip', {
      args: [n.props.path, opts], small: true, text: 'Strip', tip: 'Test strip around this value (T)' }) }),
  },
})
```

Calling `.testStrip()` on `print.paper` is a build warning with the list of paths that take it. A pass checks the
UI tree after bindings are resolved:

```js
ck.pass('cb.tools-reachable', { on: 'ui', after: 'bindings' }, (tree, d) => {
  for (const vp of tree.find('cb.viewer'))
    for (const id of vp.props.tools ?? [])
      if (!tree.commands.has('tool.' + id))
        d.error('CB-V301', `viewer '${vp.props.id}' lists tool '${id}', which no installed kit defines`,
          { at: vp.at, fix: ck.suggest(id, tree.tools()) })
})
```

A kit bundles everything a feature needs. `cb.core` itself is a kit:

```js
export const core = ck.kit('cb.core', k => k
  .state(CORE_STATE)                                   // section 6.1
  .route('recipes', editLogRoute)                      // recipes.<frameId> ⇄ the frame's EditLog
  .route('proposals', proposalProjection, { readonly: true })
  .forms(argForm, viewerForm, frameCellForm, readoutForm)
  .fragments(testStripFragment, padFragment)
  .commands(catalogCommands, historyCommands, approvalCommands, snapshotCommands, viewCommands, toolCommands)
  .tools(probeTool, testStripTool, ringAroundTool, maskTools)
  .passes(argsExist, arrangementAudit, handleLambdas, toolsReachable)
  .docs(CORE_DOCS))
```

The feature kits (`cb.kits.roll`, `cb.kits.looks`, `cb.kits.finish`) follow the same shape and declare `cb.core` as
a dependency. Kits are reached through `cb.kits.*` rather than imported, so a variant file stays self-contained.
This refines the design brief's sketch, which imported `rollKit`.

## 5. The studio-kit components

### 5.1 `cb.arg(path, opts)`: controls from ArgSpec

`cb.arg` is a form with slots `path` (β), `label`, `step`, `widget` (β), `frame` (τ, default `cb.current`) and
`disabled` (τ). The build pass resolves `path` to a `ControlModel` with CHB-009's `generateControls` and
`modelFor` (`src/core/controls.ts`): storage unit, display unit, scale, step, detents, default, `format`, `aside`
and `valueText`. The widget follows `ArgSpec.ui.widget` unless `widget` overrides it: slider, stepper (f-numbers
over the third-stop series), segmented, select, toggle, or `pad` for the printer lights. `step` accepts darkroom
units as strings (`'1/3 st'`, `'5 CC'`, `'2 pt'`); a step whose unit does not fit the path is CB-A110.

The number field accepts darkroom units on top of CraftKit's arithmetic (`*2`, `50%`): `15.12 s`, `+1/3 st`,
`+4 pt`, `62.5 CC`, `f/8`. That closes CHB-009's typed-entry item (task `kygr`).

**Decision: the slider's thumb is a native `<input type="range">`.** CraftKit's slider is a `div` with
`role="slider"`. CHB-009 used native range inputs on purpose, and `e2e/m1-walking-skeleton.spec.ts` depends on it:
it sets `el.value`, dispatches synthetic events and checks the `min` attribute. So `cb.slider` keeps a native range
input as the accessible element, styled as CraftKit's track, with CraftKit's habits (scrub, double-click reset,
arrow nudges, Shift for fine). The M1 spec stays unchanged. Alternative: rewrite the spec to drive a ck slider by
keyboard. Status: proposed.

Writes go through the store like any binding: `ctx.preview(path, v)` per drag move, `ctx.commit(label)` on release,
`ctx.tx(label, …, { coalesce: path })` per key step. The EditLog route (section 6.2) turns these into
`log.preview` and `log.apply`; `cb.arg` knows nothing about EditLogs.

### 5.2 `cb.frame(s)` and `cb.viewer(fn, opts)`

`cb.frame(s)` returns a handle for the primary selected frame, or `cb.frame(s, id)` for a given one. It reads
`s.ui.selection.primary` and `s.recipes[id]`, so a τ lambda that calls it depends on both. A handle is a plain
frozen object `{ frame, recipe, accessor, opts }`; it compiles nothing.

| call | node it stands for | same as in the DSL |
|---|---|---|
| `.source()`, `.scan()`, `.negative()` | `source.open`, the scan, `invert.dyes` | `frame.source()` … |
| `.print()`, `.print({ time_s: 15.12 })` | `view.adapt` (print-xyz); options are a what-if, not logged | `frame.print(opts)` |
| `.display()` | the compiled chain's top | `frame.display()` |
| `.view('dyes')` | CHB-009's inspection views (`view.inspect`) | — |
| `.initial()`, `.snapshot(id)`, `.proposal(tx)` | the same frame with another recipe | — |
| `.testStrip(opts)`, `.ringTile(dir, step)` | darkroom tool nodes | `cb.testStrip(frame, opts)` |

The accessor table and "cut the compiled chain at op X" live today in the DSL host (`ACCESSORS`,
`PRINT_OPTIONS`, `Host.cut` in `packages/dsl/src/host.ts`). Studio-kit must cut where the DSL cuts, or viewer and
agent show different nodes for the same words. Until they move to a shared module (section 14), studio-kit keeps a
copy that a test compares with the DSL's.

`cb.viewer` lowers to `ck.viewport` with a chromobench **render source**. On each render the bridge (1) compiles
`handle.recipe` in the frame's `FrameSession` graph and cuts at the accessor's op; (2) lets an active tool's
`image` hook replace the node (the test strip interns `darkroom.testStrip`, as `Studio.mainNode` does now);
(3) appends `output.display` for the presenter's colour space unless the node is display-referred
(`FrameSession.displayOf`); (4) adopts the closure into the engine and queues `{ node, before, region, scale,
pass }` on the viewport's scheduler; (5) presents through the injected presenter (WebGPU Display-P3 rgba16float, or
Canvas2D).

Scheduling merges both designs. CHB-009's `RenderScheduler` (one request in flight, one waiting slot, aborts,
monotonic presentation) runs once per viewport id on the live lane; CraftKit's slots, epochs and `bg` lane serve
thumbnails. While the store previews, the pass is `draft` (`draftScale`, at most 500 000 pixels); on commit,
`screen`; when idle, `refine` (CHB-009 task `ey84`, still open).

Views, compare and the probe come from CHB-009 as options: `views` adds the switch and keys 1–4; `compare` adds
before/after against `initial()`, a snapshot or a proposal; the `probe` tool reads `measure.densitometer` through
`LatestWins` (hover, arrow keys, `P` pins a probe as `set probes.<id>`). `cb.hud.readout()` is the densitometer
line; `cb.panel.densitometer()` lists pins.

### 5.3 Library, roll and frame views

The catalog is document state (section 6.1). The views and commands follow CraftKit's `library.js`, with frames
instead of photos:

- views `cb.view.grid`, `strip`, `loupe`, `compare`, `survey`, and `cb.cell.frame`;
- panels `cb.panel.library()` (projects ▸ rolls, collections, target collection), `keywords()`, `metadata()`, and
  `cb.bar.filter()` (search over names, keywords and captions; flag, rating, label, edited);
- commands `frame.pick/reject/unflag/rate/label/next/previous`, `collection.new/rename/delete/addToTarget`,
  `library.find`, `library.open` (folder picker, or file input with import to OPFS), `print.applyToSelection`
  (CHB-009's `applyToFrames`: one transaction per frame, a shared tx id);
- keys `cb.keys.cull` (P, X, U, 0–5, 6–9, B), as CraftKit's `CULL_KEYS`.

The roll contact sheet (layout, roll balance, export as an image) belongs to CHB-020; CHB-019 provides the grid,
print thumbnails and "apply these settings".

### 5.4 History, approvals, provenance, snapshots

`cb.panel.history()` reads the primary frame's EditLog directly through CHB-009's `historyGroups`: groups by tx in
darkroom words ("You · Time 10 → 12.6 s (+1/3 st)"), author, a cursor line, rejected entries struck through.
Clicking a group runs `history.jump(frame, index)`, which moves that log's cursor (`moveCursor`).

`cb.panel.approvals()` renders `pendingGroups(log)` as cards with **Show** (section 6.4), **Approve**, **Reject**
and **Approve all**. When `approve` returns `E_STALE`, the card keeps the diagnostic and offers **Apply anyway**
(`approve(seqs, { force: true })`). No key approves an agent change.

`cb.panel.why()` prints `whyRows` for the focused control (`ui.focusPath`; `I` opens it as a popover).
`cb.panel.snapshots()` lists `snapshots.<frameId>`: `snapshot.new` (S) stores the committed recipe and state hash;
`snapshot.restore` applies `diffRecipes(committed, snap.recipe)` as one undoable EditLog unit.

### 5.5 Darkroom tools

Each darkroom tool is a shell **tool** (a gesture on the viewport, with a key and a `tool.<id>` command) plus a
parameter panel. The arithmetic stays in `model/tools.ts`:

| tool | key | what the viewer shows | click / gesture writes | panel |
|---|---|---|---|---|
| `test-strip` | T | `image` hook: `darkroom.testStrip` bands (vary time or one filter, 1/6–1 st or 2–10 CC, 3–9 bands) | `set` of the band's value | `cb.panel.testStrip()` |
| `ring-around` | R | `content`: a 3 × 3 grid of tiles, each the current recipe with a lights offset (2/4/8 pt) | `set print.lights.logH` | `cb.panel.ringAround()` |
| `mask-brush`, `mask-gradient`, `mask-ellipse` | M, then B / G / E | the print plus a 2-D overlay of the shapes (red at 50 %, O toggles) | one `mask.set` per stroke end | `cb.panel.masks()` |
| `probe` | — | the readout; P pins | `set probes.<id>` | `cb.panel.densitometer()` |

The exposure list (`cb.panel.exposures()`) lists `recipes.<f>.print.exposures` with fields as
`cb.arg('print.exposures.<id>.stops')`, the printing script below, and `exposure.add`/`remove` commands. Writes that
are not a plain `set` go through a ctx fragment, `ctx.recipe.apply(frame, mutations, label)`.

Ring-around tiles stay ordinary display nodes with a lights offset (CHB-009's decision), so the centre tile is the
main view's node by hash-consing. Keep that identity test and the sign assertions from `aa0c754` (+Y raises blue
light, +B lowers it, +R lowers red, +C raises red).

### 5.6 The chat slot, units, diagnostics

`cb.panel.chat()` renders a named slot, `ck.slot('chat')`, which CHB-008's chat kit fills with
`k.fill('chat', node)`; until then it points to `window.chromobench.propose()`. `cb.units` exposes
`model/units.ts` (`format`, `parse`, `stops`, `pt`, `cc`, `fstop`). Diagnostics use the shell's one producer,
`diag(code, message, { at, facts, fix })`, with a `CB-` prefix; contract `ERROR_CODES` go in `facts`:

| family | examples |
|---|---|
| CB-A1xx arguments | A101 unknown recipe path (did-you-mean); A102 path has no `ui` hints; A110 step unit does not fit; A120 widget does not fit the type |
| CB-F2xx handles | F201 unknown accessor (did-you-mean, the DSL's list); F210 a viewer lambda returned something that is not a handle |
| CB-V3xx viewer | V301 tool not defined by any kit; V310 the recipe did not compile (contract code in facts); V320 the engine lacks an op the view needs |
| CB-H4xx history | H401 an undo step was skipped because the frame's History already undid it; H410 an approval was refused (E_STALE in facts) |
| CB-K5xx kits and variants | K501 a variant does not install `cb.core` (fix: `.use(cb.core)`); K510 a kit's dependency is missing; K520 a loaded file's default export is not a variant |

## 6. State, the EditLog bridge and the history adapter

This is the core of the ticket. The shell knows only one immutable store and one history. Chromobench's recipes
live in EditLogs with their own undo cursor, provenance and agent approvals. The bridge makes the two agree without
giving up either.

### 6.1 The state tree

```js
{
  // document tier: undoable, persisted
  catalog:   { projects, rolls, frames: { [frameId]: { sha256, rollId, name, flag, stars, label, keywords } },
               collections, target },
  snapshots: { [frameId]: [{ id, name, ts, stateHash, recipe }] },
  looks: {}, presets: {},                                  // CHB-021
  // routed: written only by the EditLog route
  recipes:   { [frameId]: FrameRecipe },                   // log.state, preview included
  proposals: { [frameId]: [{ tx, why, seqs, changes, recipe }] },
  // view tier
  view:      { module, mode, view: 'print', compare: 'off', split: 0.5, filter, sort, thumbSize, vp: {} },
  ui:        { selection: { ids, primary, anchor }, tool, toolOptions, focusPath, probe, showProposal },
  workspace: {}, prefs: { agentMode: 'ask', gray: 'auto', variant: 'classic' },
}
```

The frame id is the recipe's (and the EditLog's) `frame` id; storage keys logs by source SHA-256, as CHB-009 does,
so a moved file re-attaches its recipe. `recipes` holds the frames whose log is loaded: opening a roll loads all
its logs (small JSON records).

### 6.2 The route: recipes as an EditLog projection

A **store route** gives a top-level key to an adapter. The store reads the projection the adapter publishes, and
hands writes under that key to the adapter instead of writing them itself:

```ts
// packages/studio-kit/src/bridge/editlog-route.ts (sketch; interface proposed to CHB-018)
interface StoreRoute {
  read(key: string): unknown;                                   // recipes.<frameId> → log.state
  preview(key: string, sub: string[], value: unknown): void;    // log.preview(set)
  cancel(): void;                                               // log.preview(null)
  commit(writes: RouteWrite[], label: string, opts: TxOpts): HistoryPart[];   // log.apply per frame
  on(fn: (keys: string[]) => void): () => void;                 // projection changed (agent, undo, load)
}
interface HistoryPart { label: string; undo(): boolean; redo(): boolean }    // false: no longer applicable
```

What each shell operation becomes:

| shell operation on `recipes.f.print.enlarger.time_s` | EditLog call |
|---|---|
| `ctx.preview(path, 12.6)` (a drag move) | `log.preview({ op: 'set', path: 'print.enlarger.time_s', value: 12.6 })` |
| `ctx.cancel()` (Esc) | `log.preview(null)` |
| `ctx.commit('Time')` (release) | `log.apply([set], 'user', 'Time')` → a part `{ frame: f, tx }` |
| `ctx.tx('Time', t => …, { coalesce })` (arrow keys) | preview now, one `apply` after 800 ms without a step (CHB-009's burst rule) |
| `ctx.tx` writing two frames | one `apply` per frame, a shared tx id, one global step |
| `ctx.recipe.apply(f, [mask.set], label)` | `log.apply(ms, 'user', label)` |
| a `log` event not caused by the route (agent, approval, load) | republish `recipes.f`; agent units and approvals push a part |

`GestureController` (`src/core/gesture.ts`) moves into the route. Its burst timer and "commit when another
control is touched" rule are exactly what the route needs, and its tests carry over. The EditLog holds a single
preview mutation. A gesture that previews two paths of the same frame at once needs `preview(Mutation[])`, a small
contract request (section 14).

### 6.3 One global undo

The photographer expects Mod+Z to undo the last thing he did, whether it was a flag or a filtration change. The
shell's history therefore holds **entries made of parts**. A part is either the shell's own patches or a
reference to an EditLog unit. Undo walks the parts of the top entry in reverse:

```text
global stack (newest last)                         parts
  1  Flag as Pick                                  patches catalog.frames.f12.flag
  2  Time 10 → 12.6 s (frame 12)                   editlog f12 tx g1-1
  3  Add Keyword "beach"                           patches catalog.frames.f12.keywords
  4  approved eval-k2 (frame 12)                   editlog f12 tx eval-k2

Mod+Z  → part 4.undo(): log(f12).units[cursor−1].tx === 'eval-k2' → log.undo() → true
Mod+Z  → part 3.undo(): restore keyword patches
```

The History panel can move a frame's cursor without touching the global stack. An EditLog part's `undo()`
therefore checks that its unit is still the frame's last unit in effect. If not, it returns false: the adapter
skips it, reports CB-H401 as an info diagnostic, and tries the next entry.

**Decision record: the global stack is an index over the logs; the logs are the authority.** *Context:* two undo
systems, the shell's patches (catalog, snapshots) and per-frame EditLogs (recipes, provenance, approvals).
*Alternatives:* (a) mirror recipes into the store under the shell's history, losing provenance, authorship and
`E_STALE`; (b) make panel jumps global entries, whose inverse becomes impossible once a later edit truncates the
log's redo tail; (c) an index of parts with skip-if-stale. *Decision:* (c); auto-mode agent units and approvals
enter the stack when they happen. *Consequences:* Mod+Z may skip steps after a panel jump; the undo label names the
frame through `channelName`; a new step clears redo. *Status:* proposed; try it with the photographer.

### 6.4 Agent proposals as previews

Pending entries are not part of `log.state`. The route publishes `proposals.<f>`: CHB-009's `pendingGroups`, each
with `recipe = committed ⊕ that tx's mutations` (folded with `applyMutation`). `cb.frame(s).proposal(tx)` is a
handle on that recipe. When a card's **Show** is on (`ui.showProposal = tx`; the newest proposal is shown when it
arrives), the viewer renders the proposed recipe. `cb.overlay.proposal()` draws a ribbon ("Agent proposal, not
applied: +4 pt red") and the compare toggle shows current and proposed side by side. The proposal never touches
the EditLog's single preview slot, so a drag during a shown proposal still works. Approving pushes an EditLog part;
rejecting only republishes `proposals`.

### 6.5 Persistence

Two adapters sit behind the shell's persistence interface. The document tier (`catalog`, `snapshots`, `looks`,
`presets`) and the workspace go to IndexedDB through CHB-009's `KV` (`src/storage/db.ts`), debounced on the idle
lane and flushed on `pagehide`. EditLogs are saved by SHA-256 on every non-preview event, as `Studio.persist` does
now. Recipe sidecar files next to images come later (open question 8).

## 7. The host: `apps/studio`

### 7.1 Boot

```text
main.ts
  1  theme from localStorage (as now)
  2  storage: openIdb() or memoryKV(); Opfs.open(kv); LibraryService (FSA handles, OPFS imports, bytes by SHA-256)
  3  engine: ?engine=mock (default) | reference | gpu → an Engine; MockEngine until Phase 1 merges
  4  variant: ?variant= ▸ prefs.variant ▸ 'classic'; lazy import from variants/index.js
  5  app = variant.build(ck, cb, env).use(hostKit).build()
     errors → do not mount; show the Build Report full page (code, message, file:line, facts, fix)
  6  app.mount(#root, { services: { engine, kv, opfs, library, presenter: createPresenter } })
  7  service worker (unless ?nosw); window.chromobench hook
```

`hostKit` makes the host's own chrome builder calls too: View ▸ Studio Variant ▸ …, Help ▸ Build Report, Help ▸
Explain This Studio, Help ▸ Runtime Inspector (CraftKit's, plus engine and EditLog counters), the status line
(`#status`), and in development File ▸ Load Variant….

**Engines and the import boundary.** `RefEngine` (`packages/core/src/engine-ref.ts`) and `GpuEngine`
(`packages/gpu/src/engine-gpu.ts`) exist, but `check-boundaries.ts` forbids `apps/studio/src` from importing
`core` or `gpu` (the UI never calls physics directly). Proposal: one allowed file, `src/host/engines.ts`, that
constructs engines and returns them as `Engine`. CHB-017 decides (open question 5).

### 7.2 Loading variants

- **Registry.** `apps/studio/variants/index.js` maps ids to lazy imports; production builds contain only these.
- **URL and menu.** `?variant=darkroom`; the menu writes `prefs.variant` and reloads. Storage persists, so a reload
  is the simple, correct switch.
- **Dev hot reload.** `import.meta.hot.accept('./variants/darkroom.js', m => host.swap(m.default))`. `swap` builds
  the new variant first; with errors the old app stays and the Build Report opens; otherwise it remounts with the
  same store state and services, so EditLogs, renders and selection survive a layout edit.
- **Load a variant file** (development or `?dev`): read a `.js` file, `import()` it from a Blob URL, check the
  default export (CB-K520), build, swap. Bare imports do not resolve from a Blob URL, which is why variants receive
  `ck` and `cb` and import nothing.

Variant code runs unsandboxed; only agent *eval* code runs in QuickJS. An agent-written variant is reviewed and
committed like any file, never loaded from chat (open question 6).

### 7.3 Diagnostics, explain, the test hook

The Build Report is the shell's `app.diagnostics` dialog, plus a status-line chip ("2 warnings") and a full page
when the build failed. **Explain** prints `ck.explain(app)`: modules, docks, panels, components with resolved
props, keys by scope, kits, diagnostics. Studio-kit adds explainers for its forms:

```text
variant darkroom "Darkroom first"   kits cb.core@1 roll@1
  center viewer#main  frame(primary).print()  views print negative dyes classes  tools probe test-strip ring-around
  right  column w=300
    panel enlarger "Enlarger"
      arg print.enlarger.time_s     slider  s  log2  step 1/6 st  aside st  +testStrip(1/3 st)
      arg print.lights.logH         pad     pt  step 1 pt
      arg print.grade               stepper
    panel approvals
  keys module:* T tool.test-strip · R tool.ring-around · \ view.beforeAfter
  diagnostics 0 errors · 0 warnings
```

The same text is a Vitest snapshot per variant, a panel in `lab`, and `window.chromobench.explain()` for the agent
("what is on screen?"). The test hook keeps CHB-009's surface (`log`, `idle`, `pixel`, `canvasPixel`, `chainRuns`,
`propose`) and adds `app`, `variant`, `explain` and `run(commandId, ...args)`. It drops `studio`: the Studio class
dissolves (section 9).

## 8. Four variants

All four install `cb.core` and build from the same components. They differ only in arrangement and flow:

| | classic | darkroom | simple | lab |
|---|---|---|---|---|
| structure | modules Library (G), Print (D), Output | one screen | three steps: Pick, Print, Save | Library, Print, Lab |
| menus and palette | full | full | none; big buttons | full, plus Debug |
| controls | `controls('darkroom')` in sections | enlarger panel, `.testStrip()`, lights pad | four nudges and the ring-around | `controls('all')` |
| viewer tools | all | all | ring-around only | all, plus views 1–4 |
| library | grid, loupe, compare, survey | film strip | grid with P and X | all |
| history and approvals | panels | panels | approvals inline under the print | panels, plus raw journal |
| extras | — | exposure list | — | explain, inspector, node DAG, engine switch |

### 8.1 classic

Lightroom's layout: modules across the top, panels left and right, the film strip at the bottom.

```js
build: (ck, cb) => {
  const s = cb.studio('Chromobench').theme('chromogen').use(cb.kits.roll)
  s.module('library', m => m.label('Library').key('G')
    .left(ck.dock.column({ width: 236 }, cb.panel.library()))
    .center(ck.column({ grow: 1 }, cb.bar.filter(), cb.views.library()))     // the match from §4.5
    .right(ck.dock.column({ width: 260 }, cb.panel.keywords(), cb.panel.metadata()))
    .bottom(cb.view.strip()).keys({ ...cb.keys.cull, ...cb.keys.libraryModes }))
  s.module('print', printModule)                                            // §4.4
  s.module('output', m => m.label('Output').key('Mod+Shift+E')
    .center(cb.view.grid({ source: s => cb.sel.picks(s) })).right(cb.panel.output()))   // CHB-011 replaces
  return s
}
```

### 8.2 darkroom

An enlarger-first screen. The film strip runs down the left, the print fills the centre, and the enlarger panel is
on the right. There is no library module: the roll's frames are the only choice that matters while printing.

```js
build: (ck, cb) => cb.studio('Chromobench').theme('chromogen').use(cb.kits.roll)
  .left(ck.dock.column({ width: 180 }, cb.view.strip({ vertical: true }), cb.panel.history()))
  .center(cb.viewer(s => cb.frame(s).print(), { tools: ['probe', 'test-strip', 'ring-around',
    'mask-brush', 'mask-gradient'], compare: { before: s => cb.frame(s).initial().print() } }))
  .right(ck.dock.column({ width: 300 },
    ck.panel('enlarger', { title: 'Enlarger' },
      cb.arg('print.enlarger.time_s').testStrip({ step: '1/3 st' }), cb.arg('print.enlarger.fstop'),
      cb.arg('print.enlarger.filtration'), cb.arg('print.lights.logH').pad()),
    ck.panel('paper', { title: 'Paper' }, cb.arg('print.paper'), cb.arg('print.grade')),
    cb.panel.exposures(), cb.panel.approvals()))
  .keys('global', { ...cb.keys.darkroom })
```

### 8.3 simple

Three steps, one at a time, big targets, no menus. The ring-around fits the photographer's question best: "which
one is better?" Click the best tile.

```text
 ① Pick ── ② Print ── ③ Save
 Print:  ┌───────────────────────────────┐   Lighter ◀ ▶ Darker
         │           the print           │   Warmer  ◀ ▶ Cooler
         │                               │   [ Which looks best? ]  (ring-around)
         └───────────────────────────────┘   Agent suggests +4 pt red  [Show] [Use it] [No]
```

```js
build: (ck, cb) => cb.studio('Chromobench', { menus: false, palette: false }).theme('large')
  .top(cb.bar.steps(['pick', 'print', 'save']))                    // view.step; Next/Back
  .center(ck.match(s => s.view.step, {
    pick:  cb.view.grid({ cell: cb.cell.frame({ size: 'large' }), keys: { P: 'frame.pick', X: 'frame.reject' } }),
    print: ck.row({ grow: 1 },
      cb.viewer(s => cb.frame(s).print(), { tools: ['ring-around'] }),
      ck.column({ width: 320 },
        cb.nudge('print.enlarger.time_s', { labels: ['Lighter', 'Darker'], step: '1/3 st' }),
        cb.nudge('print.lights.logH', { labels: ['Warmer', 'Cooler'], axis: 'yellow-blue', step: '2 pt' }),
        ck.ui.command('tool.ring-around', { text: 'Which looks best?', primary: true }),
        cb.panel.approvals({ compact: true }))),
    save:  cb.panel.output({ simple: true }),
  }, { of: ['pick', 'print', 'save'] }))
```

`cb.nudge` is `cb.arg` with a two-button widget (the first label decreases). It writes through the same route, so
"Darker" appears in the history as "Time 12.6 → 15.87 s (+1/3 st)".

### 8.4 lab

`classic` plus a Lab module for us: `cb.panel.controls('all')`, views 1–4, densitometer pins, `cb.panel.why()`,
`cb.panel.journal()` (raw EditLog entries with seq, status, `expect`), `cb.panel.nodes()` (the display closure with
ids and run counts, CHB-009's `chainRuns`), `cb.panel.explain()`, the inspector and an engine switch. The Playwright
specs run against `lab`, so it contains every element they address.

## 9. Migration from CHB-009

Migrate in place, behind the old UI. The React app keeps running until `lab` passes the M1 spec and the rewritten
studio spec; one commit then deletes `src/ui/`, `main.tsx` and the React dependencies.

| CHB-009 file | fate |
|---|---|
| `src/core/units.ts`, `controls.ts`, `arrangement.ts`, `history.ts`, `tools.ts`, `frame-session.ts` | move to `packages/studio-kit/src/model/`, unchanged except imports |
| `src/core/gesture.ts` | becomes the route's burst and drag logic (`bridge/editlog-route.ts`); tests move with it |
| `src/core/scheduler.ts`, `probe.ts` | move to `studio-kit/src/render/`; add the `refine` pass (`ey84`) |
| `src/present/*` | move to `studio-kit/src/present/`; the presenter e2e test imports the new path |
| `src/storage/*` | stay in `apps/studio/src/host/storage/` as services |
| `src/core/library.ts` | splits: projects, rolls and frames become `catalog` (document tier); bytes, handles and OPFS become `LibraryService` |
| `src/core/studio.ts` | dissolves: its methods become commands (`frame.open`, `edit.undo`, `proposal.approve`, `snapshot.restore`, `print.applyToSelection`) and bridge code |
| `src/core/store.ts`, `keyboard.ts` | deleted: the shell's store; keys per variant from the command table |
| `src/ui/*.tsx`, `hooks.ts`, `main.tsx` | replaced: TopBar → toolbar and host status; Controls → `cb.arg`; History → the four panels; Library → library views; Viewer → `cb.viewer`, `cb.hud.readout`; Tools and Masks → tools and panels |
| `studio.css`, `studio-app.css` | tokens into the `chromogen` theme; component CSS into studio-kit |
| `test/*.test.ts` | move with their modules and keep passing |
| `e2e/m1-walking-skeleton.spec.ts` | unchanged acceptance test (default variant and `lab`) |
| `e2e/studio.spec.ts` | rewritten against the new hook (`chromobench.app`, `run`), same seven flows |

The M1 spec addresses `#file`, `#status`, `#undo`, `#pending li .approve`, `#why`, and sliders by their accessible
names ("Printer lights R"). Studio-kit components emit these ids themselves (`cb.panel.approvals` renders
`#pending`, the host renders `#status`), so any variant that contains the pieces passes.

CHB-009's open tasks move here:

| CHB-009 task | where it goes in CHB-019 |
|---|---|
| `ex7d` drag-latency spike | stage 3: measure pointer move → presented draft, on mock and GPU |
| `ey84` refine pass | stage 3 |
| `kygr` lights pad, typed entry | stage 2 (`.pad()`, unit parsing) |
| `grer` shortcuts, ARIA, live regions, axe | stage 8 (shortcut sheet from the command table; axe in each smoke test) |
| `rrhv` chat panel | the slot here; CHB-008 fills it |
| `o944` M1 with DSL eval | stage 7: `window.chromobench.eval` once CHB-007's `DslSession` is wired; `propose` stands in |
| precache list | stage 9 |

## 10. Patterns to take from CraftKit Studio's modules

All in CHB-016 `sources/craftkit-studio/src/app/`:

| file | take |
|---|---|
| `main.js` | state options `persist`, `restore`, `transient`, `keepUi`; `currentChannel`/`channelName` for "Undo Contrast (on Old pier)"; app events (`.on('photo.flagged', advance)`); drop-to-import; inspector. The host and `cb.core` follow this shape |
| `catalog.js` | queries as derived paths (`catalog.filtered`); selection `{ ids, primary, anchor }`; `primaryOf`, `selectedIds` (→ `cb.sel`) |
| `library.js` | θ cells with small per-badge cells; one command table with `enabled`/`why`; `step()` inside survey and compare; panels as functions; the compare candidate as a second image; a module as a function of the shell |
| `cull.js` | a 34-line module from shared parts; a held-key spring; `onEnter` narrowing the selection: the model for `simple`'s Pick step |
| `develop.js` | `devSlider(id)`, ancestor of `cb.arg`; `simplePanel(groups)`, arrangement-driven panels; `txOpts` with a channel; before/after commands; `,` `.` `=` `-` slider keys. Its history reads shell channels; ours reads the EditLog |
| `develop-scopes.js` | a reference viewport beside the active one; small measurements on the bg lane before one "Match" transaction (reused by CHB-020/021 with `measure.*` ops) |
| `export.js` | a kit in all but name (`export const state` + `install(shell)`); a cancellable bg-lane queue; statuses in the document, blobs never; one undo step per run. Output and CHB-011 follow it |

## 11. One flow, end to end

The `darkroom` variant, frame 12 of a roll (frame id `f12`, mock engine), default time 10 s.

1. **Drag.** Each pointer move on the Time slider calls `ctx.preview(['recipes', 'f12', 'print', 'enlarger',
   'time_s'], v)`. The store hands it to the route: `log.preview({ op: 'set', path: 'print.enlarger.time_s',
   value: 12.599 })` (10 · 2^(2/6) on the 1/6-stop grid).
2. **Projection.** The log emits `preview`; the route republishes `recipes.f12 = log.state`. The path trie marks
   the cells that read it: the viewer's lambda, the slider readout, the exposure list.
3. **Render.** The viewer's lambda re-runs and returns a handle whose recipe has `time_s` 12.599. The bridge
   compiles it: scan and `invert.dyes` keep their ids, `print.expose` and everything after are new. The store is
   previewing, so the pass is `draft`; the scheduler aborts the previous draft and presents the new one.
4. **Release.** `ctx.commit('Time')` → `log.apply([set time_s 12.599], 'user', 'Time')`: unit `g1-1`, preview
   cleared. The route returns a part; the shell pushes "Time 10 → 12.6 s (frame 12)"; the log is saved by
   SHA-256. The `screen` pass renders the same node as the last draft, so upstream work comes from cache. History
   shows "You · Time 10 → 12.6 s (+1/3 st)".
5. **Agent.** In ask mode CHB-008's host calls `log.propose([{ op: 'set', path: 'print.lights.logH', value:
   [0.1, 0, 0] }], { tx: 'eval-k2', why: 'warmer' })`. The route publishes `proposals.f12`; the newest card is
   shown, so the viewer renders `cb.frame(s).proposal('eval-k2').print()` with the ribbon "Agent proposal, not
   applied: +4 pt red".
6. **Stale.** The photographer nudges Lights G (one unit after 800 ms), then clicks Approve: `log.approve([2])`
   returns `E_STALE` (expected `[0,0,0]`, now `[0,0.05,0]`). **Apply anyway** calls `approve([2], { force: true })`,
   which writes `[0.1, 0, 0]`, discarding the G nudge, and pushes the part "approved eval-k2".
7. **Undo.** Mod+Z three times undoes the approval, the G nudge and the time change. The picture returns to the
   10 s print with the same node ids as at the start, straight from cache.

## 12. Implementation plan

| stage | build | done means |
|---|---|---|
| 0 | `packages/studio-kit` skeleton, `cb.core` kit shell, `apps/studio/variants/`, boundary rules, `ck` stub if CHB-018 is not ready | `pnpm vitest run packages/studio-kit` builds the `tiny` variant headless and prints its explain text |
| 1 | move CHB-009's model modules; EditLog route, proposal projection, history adapter, persistence | CHB-009's 34 unit tests pass from their new home; new Node tests: a drag is one unit, a burst is one unit, the interleaved undo in §6.3, CB-H401 after a panel jump, persistence round trip with `memoryKV` |
| 2 | `cb.arg`, `cb.slider` (native range), pad, nudge, unit parsing, `cb.panel.controls`, arrangement audit pass, CB-A diagnostics | explain snapshot of `controls('darkroom')`; CB-A101 suggests `time_s`; typed `+1/3 st` sets 12.599 s |
| 3 | `cb.frame` handles, shared vocabulary check, `cb.viewer`, render bridge, scheduler lanes and refine, presenters, views, compare, probe and pins | headless bridge tests (node ids stable, draft → screen → refine order, aborts); the fixture renders in a browser; drag latency measured (`ex7d`) |
| 4 | catalog in the document tier, library views and cells, catalog commands, filter and search, `print.applyToSelection` | flags, stars, labels, collections and keywords survive a reload; explain snapshots for grid/loupe/compare/survey |
| 5 | history, approvals (Show, Approve all, Apply anyway), why, snapshots | the stale flow of §11 in a Node test and in Playwright |
| 6 | darkroom tools and panels, `.testStrip()` fragment, ring-around identity and sign tests, exposures | CHB-009's tools e2e flow passes on `lab` |
| 7 | host: boot, services, engine choice, registry, URL, menu, hot reload, Load Variant, Build Report, explain, hook; `lab`; delete React | M1 spec unchanged and green on `/` and `?variant=lab`; rewritten `studio.spec.ts` green; no React in the bundle |
| 8 | `classic`, `darkroom`, `simple`; shortcut sheet; ARIA and live regions | each variant: zero build errors, explain snapshot, Playwright smoke with axe |
| 9 | reference and GPU engines in the host, chat slot contract with CHB-008, sidecar files, precache list | `?engine=gpu` renders the fixture; the chat kit can fill the slot |

## 13. Testing and acceptance

- **Headless variant builds.** Each variant builds in Node without a DOM with zero errors, and `ck.explain(app)`
  matches a stored snapshot (`apps/studio/variants/__snapshots__/`), so layout changes are reviewed as text.
- **Bridge and adapter.** Node tests with `MockEngine` and `memoryKV`. Make the undo test able to fail: after a
  panel jump, a spy must show *no* `log.undo()` call for the stale part, and the recipe hash must be the expected
  one.
- **Vocabulary parity.** On the M1 fixture, `cb.frame(s).print()` resolves to the same node id as the DSL's
  `frame.print()` in a `DslSession` over the same log.
- **Playwright** (with `STUDIO_PORT`): the M1 spec unchanged; the rewritten studio spec on `lab`; a smoke per
  variant (open the fixture, change a control by keyboard, undo, propose through the hook, approve); and
  `?variant=bogus` shows the Build Report with a did-you-mean. Assert no `pageerror` in `afterEach`.
- **Kept assertions.** Ring-around signs, centre-tile identity, the presenter's exact P3 pixels (`[94, 111, 140]`),
  M1's pixel and state-hash checks.

## 14. Risks, open questions, requests

1. **CHB-018's API.** Routes, history parts, services, tool `image`/`content` hooks, fragments, kits and a DOM-free
   build are assumed (§3). Mitigation: the `ck` stub; agree the names early.
2. **Native range slider** vs CraftKit's (§5.1). Proposed: native.
3. **EditLog preview holds one mutation.** Contract 0.2 request (CHB-017): `preview(Mutation | Mutation[] | null)`.
4. **Undo after History-panel jumps** (§6.3) needs a hands-on check with the photographer.
5. **Engine imports in the host** (§7.1): one allowed file or another injection point; CHB-017 decides.
6. **Unsandboxed variant files.** Load Variant is development-only; reviewing agent-written variants is CHB-008's.
7. **Scale.** Projecting every recipe and thumbnail of a large library may need loading by visibility. Measure with
   a 300-frame fixture roll.
8. **Sidecars.** EditLogData or the folded recipe; when to write; edits made elsewhere.
9. **Shared frame vocabulary** (§5.2): move `ACCESSORS`, `PRINT_OPTIONS` and `cut` out of the DSL host (CHB-017,
   CHB-007).
10. **How kits extend `cb`.** Add to `cb.panel.*` (`cb.panel.roll()`) or keep their own namespace
    (`cb.kits.roll.panel.setup()`)? Decide with CHB-020; this guide assumes the latter.

## 15. References

- UI design brief: `ttmp/2026/11/11/CHB-016--…/various/ui-design-brief.md`; CHB-016 diary Steps 2–4.
- CraftKit: CHB-016 `sources/craftkit-studio/docs/SHELL.md`, `src/shell/index.js`, `src/shell/core/store.js`,
  `history.js`, `engine.js`; app modules `src/app/{main,catalog,library,cull,develop,develop-scopes,export}.js`.
- CHB-009: guide `design-doc/01-intern-guide-studio-app-ui.md` (§5.3–5.10), diary Steps 16–17, `apps/studio/src/`,
  `apps/studio/CONTRACT-REQUESTS.md`, `e2e/m1-walking-skeleton.spec.ts`, `e2e/studio.spec.ts`.
- Contract: `packages/contract/src/editlog.ts`, `paths.ts`, `spec.ts`, `registry.ts`, `catalog/*`.
- Engines: `packages/engine-mock/src/engine-mock.ts`, `packages/core/src/engine-ref.ts`,
  `packages/gpu/src/engine-gpu.ts`.
- DSL vocabulary: `packages/dsl/src/prelude/prelude.ts` (frame handle), `packages/dsl/src/host.ts` (`ACCESSORS`,
  `PRINT_OPTIONS`, `vocab`, `cut`).
- Boundaries: `tools/scripts/check-boundaries.ts`; Playwright config `playwright.config.ts`.
