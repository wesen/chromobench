---
Title: 'Intern guide: Shell — the CraftKit Shell ported to TypeScript as packages/shell'
Ticket: CHB-018
Status: active
Topics:
    - ui
    - js-api
    - architecture
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://apps/studio/src/core/scheduler.ts
      Note: RenderScheduler rules merged into the shell's render queue
    - Path: repo://apps/studio/src/present/presenter.ts
      Note: CHB-009 Presenter interface the shell's must match structurally
    - Path: repo://packages/contract/src/editlog.ts
      Note: EditLog undo units the HistoryAdapter interleaves
    - Path: repo://tools/scripts/check-boundaries.ts
      Note: import-boundary lint; add the packages/shell rules
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/docs/SHELL.md
      Note: CraftKit Shell v1 reference, file by file; what the port keeps
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/shell/core/store.js
      Note: immutable store, tiers, drafts, preview, path trie; ported and extended with layers and routes
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/shell/shell.js
      Note: builder, App, build checks, ctx, autosave; split into build/app/dom
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/shell/ui/viewport.js
      Note: viewport to port behind Presenter and the render queue
ExternalSources: []
Summary: How to port CraftKit Shell v1 (src/shell, ~3,900 lines of plain JS) to a generic, headless-buildable TypeScript package `ck` with fragments, kits, passes, explain and pluggable presenter, render bridge, history, persistence and theme interfaces.
LastUpdated: 2026-11-11T15:10:20.646147175-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Shell — the CraftKit Shell ported to TypeScript as `packages/shell`

## 1. What this ticket builds

Chromobench's studio is meant to exist in many versions: a Lightroom-like one, a darkroom-first one, a three-step one
for the photographer, a lab one for us. Each version, a *variant*, is one JS module of builder calls that describes
the whole UI: modules, panels, controls, tools, overlays, commands, menus, keys and theme. For variants to be cheap,
the toolkit underneath must be small, checkable and generic. That toolkit is `packages/shell`, imported as `ck`.

`ck` is a TypeScript port of the CraftKit Shell v1, the UI runtime of CraftKit Studio that CHB-016 imported and
studied. The port keeps CraftKit's grammar and runtime nearly as they are and adds:

- **fragments, kits, passes and `explain`**, so features install into a variant as bundles, are checked by passes
  over the UI tree, and can be printed as text for tests, review and the agent;
- **typed interfaces** for what chromobench plugs in: a `Presenter` (CHB-009's WebGPU Display-P3 presenter), a
  `RenderBridge` (studio-kit's recipe compile plus `Engine.evaluate`), a `HistoryAdapter` (the per-frame `EditLog`), a
  `PersistenceAdapter` (IndexedDB/OPFS) and theme token sets (the Chromogen look, Lightroom greys);
- a **headless build**: any variant builds and is checked in Node, without a DOM, inside a vitest test.

The shell contains no chromobench vocabulary. `cb.arg`, `cb.viewer`, frame handles, the EditLog adapter, the WebGPU
presenter, the IndexedDB adapter and the variants belong to `packages/studio-kit` and `apps/studio` (CHB-019); the
roll, looks and finish kits to CHB-020/021/022. `packages/shell` imports nothing from `@chromobench/*`, has no runtime
dependencies, and does not use React.

## 2. Background: the CraftKit Shell in one sitting

### 2.1 Record, check, mount

Builder calls only **record**: `ck.panel(...)`, `ck.ui.slider(...)`, `ck.shell(name).module(...)` return plain nodes
`{ $: form, props, kids, at }`, where `at` is the call site in the app's own source. `.build()` **checks** the
recorded program and reports diagnostics in the program's own words and lines. `mount(el)` **runs** it:

```js
const app = ck.shell('Develop demo')
  .state({ dev: { light: { exposure: 0, contrast: 0 } }, ui: {} })
  .commands(c => c.add('dev.reset', {
    label: 'Reset', menu: 'Settings',
    enabled: s => s.dev.light.exposure !== 0, why: 'Nothing to reset',
    run: ctx => ctx.tx('Reset', t => { t.dev.light.exposure = 0 }),
  }))
  .keys('global', { 'Mod+Shift+R': 'dev.reset' })
  .right(ck.panel('basic', { title: 'Basic' },
    ck.ui.slider(-5, 5, { label: 'Exposure', bind: s => s.dev.light.exposur, step: 0.05, reset: 0 })))
  .center(ck.text(s => `EV ${s.dev.light.exposure}`))
  .build()
```

The typo in the binding is caught at build, against the initial state, at the variant's own line:

```text
CK-B110 error · Binding path not in state
  at demo.js:12:5
  s.dev.light.exposur does not exist.
  dev.light has: exposure, contrast
  fix: Did you mean s.dev.light.exposure?
```

### 2.2 Binding times

Every option (*slot*) of every form declares **when** its value is read. This lets the build check a program and the
runtime re-run only what changed:

| mark | name | when it runs | examples |
|---|---|---|---|
| β | build | once, while building | `min`, `max`, `options`, a list of sections |
| τ | traced | as a cell: re-runs when a path it read changes | `label: s => …`, `disabled: s => …` |
| bind | binding | a τ lambda naming one state path; two-way | `bind: s => s.dev.light.exposure` |
| θ | per item | with the real item when its row is drawn | `cell: (photo, i) => …` |
| ƒ | helper | pure function of the form's value, or a mount function | `format: v => v.toFixed(1)` |
| ρ | runtime | handlers, called with `ctx` last | `run: ctx => …`, `drag: (e, ctx, g) => …` |

A lambda in a β slot is a build error (CK-B140): it would run once and never again. An unknown option is a warning
with a suggestion (CK-B130).

### 2.3 The runtime loop

```text
Input ──▶ Route ──────────▶ Intent ─────────▶ Change ────────────▶ Propagate ─────────▶ Schedule ─────▶ Draw
pointer,   key scope chain,   command id or ρ   ctx.tx / preview /   store notifies the    once per frame:   DOM, presenter,
keys       focus, tool        handler + ctx     commit → new state,  path trie; matching   feedback→chrome→  overlays
                                                history entry        cells marked dirty    render→idle
```

Two properties carry everything below. **State is one immutable tree**: a write copies only the objects along the
written path, so reference equality is a complete change test. **Cells read state, never each other**: each dirty cell
re-runs once per frame against the same state, so no cell sees half a transaction (glitch-free).

## 3. How it fits

```text
apps/studio (host)            boots storage + engine, picks a variant, calls mount(app, el, services)
  variants/*.js               one JS module each: (ck, cb) => ck.shell(...)...
packages/studio-kit  `cb`     chromobench forms, fragments, kits; implements RenderBridge, HistoryAdapter,
                              PersistenceAdapter; supplies CHB-009's presenters                (CHB-019)
  kits/roll, looks, finish                                                                      (CHB-020/021/022)
packages/shell       `ck`     this ticket: grammar, IR, store, cells, history, commands, keys, forms, docks,
                              viewport, render queue, diagnostics, fragments, kits, passes, explain
```

Every UI ticket depends on the shell, but none waits for all of it: stage 1 (headless core) is enough for studio-kit
and the kits to write and test their build side; stage 2 adds the DOM; stage 3 the viewport and bridges. The shell's
own demo page renders through a procedural bridge (a gradient generator), so no chromobench engine is needed to
develop it. Two rules go into `tools/scripts/check-boundaries.ts` in stage 1: `packages/shell/src` imports only
relative files, and `packages/shell/src/{core,ir,build,app}` never import from `../dom/`.

## 4. What exists, and the port plan

### 4.1 The sources

The CraftKit sources are in CHB-016 at
`ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/`
(below: `CK/`). Read `CK/docs/SHELL.md` first; it is the shell's file-by-file reference. The shell, `CK/src/shell`, is
3,893 lines of plain ES modules plus 377 lines of CSS. Its Node tests (`test/core.test.mjs`, `keys.test.mjs`,
`engine.test.mjs`) pass unmodified on Node v24.18.0 (re-run while writing this guide). `CK/src/app`, CraftKit Studio's
modules, is the worked example of the grammar and is not ported here.

### 4.2 The key mechanisms

**Store** (`core/store.js`). `setIn` copies the objects along a path and returns the old object where nothing
changed, so untouched subtrees keep their identity. Tiers come from the top-level key: `document` (undoable,
autosaved) is everything not listed in `view` (default `ui`, `view`, `prefs`, `workspace`). `tx(label, t => …)` hands
the lambda a *draft* proxy: assignments, array methods and `$set/$update/$merge/$push/$remove` record patches
`{ path, before, after }`. `preview(path, value)` lays a transient layer over the committed state; `commit(label)`
turns the layer into one transaction, `cancel()` drops it, and a transaction overlapping an open preview cancels it.
`strip()` replaces proxies in written values by their targets, so state stays `structuredClone`-able. `derive(path,
fn)` adds computed paths. *Port:* as-is, plus prefix tiers, named layers and routes (5.4).

**Path trie** (`PathIndex`). Subscribers sit at trie nodes keyed by path segments. `affected(path)` collects
subscribers along the root-to-path walk and everything below it: a write to `dev.a.light.exposure` reaches readers of
`dev`, `dev.a`, the leaf and anything under it, and nobody reading `dev.b`. *Port:* as-is.

**Tracking proxies and read sets** (`core/track.js`). A τ lambda runs against a proxy that records every path read.
Pure navigation is dropped (reading `s.dev.light.exposure` does not subscribe to `s.dev`); objects used *whole*
(enumerated, or escaping in the result) are kept. An object reachable by two paths gets one proxy that remembers both,
so `===` holds and a write to either path re-runs the reader. `bindingPath(fn)` finds the path a binding names;
`missingKey` explains what is missing. *Port:* as-is, plus a probe mode for build checks (5.4).

**Cells and the scheduler** (`core/cells.js`). A `Cell` runs its lambda through the tracker, re-subscribes its read
set, and calls its effect when the value changed. `Scope`s own cells and dispose as a tree. One frame per animation
frame runs lanes **feedback** → **chrome** (dirty cells in creation order, outer before inner) → **render** (with the
frame's epoch) → **idle** (keyed jobs, 12 ms slices). Ten passes of effects writing state is reported as a loop.
*Port:* as-is, with an injectable `Clock`, per-runtime cell ids, and the loop reported as a diagnostic.

**History** (`core/history.js`). Each document transaction is one entry whose patches' `before` values are the
inverse. Entries with the same `coalesce` key within 1.5 s merge. An entry may carry a `channel` (a photo id) and
`snapPath`: the channel list is that photo's History panel, seeded with "Import", and `stepTo(channel, i)` restores a
snapshot as a new transaction. *Port:* reworked so the global stack holds entries from several sources (5.9).

**Commands** (`core/commands.js`). One table: τ label, `enabled` with `why`, `checked`, `hidden`, `module`, `run` (ρ or
an alias id), `palette`, `group`. Menus, context menus, toolbars, the palette (Mod+K) and the shortcut sheet are views
of it, and a disabled item says why. *Port:* as-is, typed.

**Keys and springs** (`core/keys.js`). Chords are canonical (`Mod+Shift+Z` → `mod+shift+z`; `Mod` is ⌘ on macOS,
Ctrl elsewhere). At a keydown the router walks `text · dialog · tool:<id> · panel:<id> · canvas · module:<id> ·
global` and runs the first match. A spring is a held key (Space = Hand while down; a tap under 250 ms may run a
command). Build checks: K201 unknown command with suggestions, K202 bad chord, K204 conflict in a scope (both sites),
K205 shadowed global key, K210 single letter in `global`/`text`, K215 browser-reserved chord, K220/K221 springs.
*Port:* as-is, with the platform as a parameter instead of a module-level `navigator` read.

**Diagnostics** (`core/diag.js`). `site()` parses `new Error().stack` and returns the first frame outside the library.
A diagnostic has a stable code, a title, `at`, lines stating the competing facts and one fix; repeated runtime
problems are reported once. *Port:* one `diag()` producer with several library roots (5.10).

**Forms, bindings, habits** (`ui/node.js`, `ui/forms/*.js`, `ui/habits.js`). `defineForm(name, { slots, mount })`
registers a form; `node()` checks props against slots (B130, B140, B141). A `MountCtx` turns τ props into cells and ρ
props into handlers. A `Binding` writes previews plus one commit during a drag, and pins its path for the gesture
(`s => s.dev[s.ui.selection.primary].light.exposure` follows the selection between gestures, not during one). Habits
(scrub, nudge, reset, rename, context, focus keys, `parseValue` with units and arithmetic) attach to forms. *Port:*
slot tables become headless specs, `mount` a DOM renderer (DR-3); `parseValue` drops `Function()` (forbidden by a
strict Content-Security-Policy) for a small arithmetic parser.

**Docks and workspaces** (`ui/dock.js`). Each module arranges left, right, bottom and top columns around a centre.
Sizes, hidden sides, open panels, solo mode and tab choices live in the view tier (`workspace.layout[module][side]`,
`workspace.panels[id].open`, …): saved per viewer, never undone. Tab, Shift+Tab and F5–F8 hide sides. *Port:* as-is.

**Viewport** (`ui/viewport.js`). Shows the value of a τ lambda, renders at shown size × `devicePixelRatio` (capped at
2 and by the source), at a 384 px proxy while previewing. View state is `view.vp[id] = { zoom: 'fit' | 'fill' |
number, cx, cy }`; wheel and pinch zoom at the pointer; middle-drag and Space pan; Z zooms; compare `off | before | lr |
tb | split`. Overlays are SVG `{ kind, read: τ, paint(g, vp, value, state) }`. Tools are gestures: `down` returns
gesture state, `drag` may replace it, `up` must commit or cancel (else T420). *Port:* painting goes behind
`Presenter`, requests behind the render queue; overlays, tools, springs and view state stay.

**Collections and thumbnails** (`collection.js`, `thumb.js`). Virtualised list, grid, filmstrip and tree; a row
re-mounts only when its item changes identity; selection `{ ids, primary, anchor }`; drag and drop. *Port:* as-is;
thumbnails go through the bridge's background lane.

**Engine bridge** (`core/engine.js`). Chains like `ck.image(s => fileOf(s)).develop(s => devOf(s))` are recorded with
lambda *holes*, compiled once into one program, and renders send only hole values to two workers, tagged with a slot
and an epoch. *Port:* compile and workers dropped (DR-4); slots, epochs, lanes, proxies and cache kept.

### 4.3 File by file

| CraftKit file | lines | port | what changes |
|---|---|---|---|
| `core/util.js` | 97 | as-is | `isMac`, `uid` become parameters/instances |
| `core/store.js` | 312 | as-is + extend | prefix tiers, preview layers, routes |
| `core/history.js` | 108 | rework | entries from sources, compound entries |
| `core/track.js` | 127 | as-is | probe mode |
| `core/cells.js` | 137 | as-is | `Clock`, per-runtime ids, loop diagnostic |
| `core/commands.js` | 64 | as-is | typed spec |
| `core/keys.js` | 185 | as-is | platform parameter, headless dispatch |
| `core/diag.js` | 78 | rework | `diag()`, library roots, contract-compatible shape |
| `core/engine.js` | 235 | drop | ideas move to `app/render/queue.ts` |
| `ui/node.js` | 163 | split | specs headless; `MountCtx`, `Binding` to `dom/` |
| `ui/dom.js`, `habits.js`, `icons.js` | 340 | as-is | no `Function()`; icons as data, unknown icon warns |
| `ui/dock.js`, `chrome.js` | 462 | as-is | a recording chrome for headless runs |
| `ui/viewport.js` | 370 | rework | `Presenter`, render queue, doc-pixel events |
| `ui/forms/basic.js` | 327 | as-is | `reset` becomes τ (CraftKit puts lambdas in this β slot) |
| `ui/forms/container.js`, `collection.js`, `plane.js` | 751 | as-is | θ typed from the items' type |
| `ui/forms/thumb.js` | 42 | rework | bridge `bg` lane |
| `shell.js` | 486 | split | builder, checks as passes, runtime, persistence, DOM mount |
| `index.js` | 145 | rework | `createCk()`, no module-level registries |
| `shell.css` | 377 | as-is | colours move to token sets |

Two kinds of global state must go, because tests build four variants in one process. Module-level registries
(`registry.panels`, `registry.tools`, `FORMS`, the engine's `ALL`, sequence counters) become fields of a `Ck` instance
or a runtime. DOM reads on the headless path (`isProps` uses `instanceof Node`; the `App` constructor creates `Chrome`
and `Dock` elements; `scopeChain` reads `document.activeElement`; `save()` calls a CraftKit host API) move to the DOM
half or behind parameters.

### 4.4 What to take from CHB-009

- `apps/studio/src/present/presenter.ts`: the `Presenter` interface. The shell's is structurally identical (5.9), so
  the WebGPU and Canvas2D presenters plug in once their type imports point at the shell.
- `apps/studio/src/core/scheduler.ts`: `RenderScheduler` (one evaluation in flight, one waiting slot with only the
  newest request, abort superseded work, present only increasing generations, `draftScale` ≈ 0.5 MP). The render
  queue generalises it to many slots and two lanes.
- `apps/studio/src/storage/db.ts` (`KV`), `core/gesture.ts` (bursts coalesced before the append-only EditLog), and
  `studio.css` (the Chromogen token values).

## 5. Design

### 5.1 Package layout

```text
packages/shell/
  package.json        "@chromobench/shell"; exports ".", "./dom", "./testing", "./shell.css"; no dependencies
  src/
    index.ts          createCk, ck (default instance), public types — headless-safe
    core/             util, path, store, track, cells, clock, history, commands, keys, diag, site
    ir/               node, slots, forms (all built-in form specs), walk
    build/            ck, shell-builder, module-builder, fragments, kits, passes, checks/*, explain
    app/              built-app, runtime (start, ctx), persist, theme, inspect, render/ (bridge, queue, present)
    themes/           lightroom.ts, chromogen.ts (token data)
    dom/              mount, h, icons, habits, chrome, dock, viewport, presenter-2d, forms/*, shell.css
    testing/          manualClock, recordingChrome, fakeBridge, memoryPersistence, fakePresenter
  test/               core/, build/, app/, dom/, fixtures/mini-studio.ts
  demo/               a Vite page mounting the mini studio (Playwright smoke and perf)
```

Nothing under `src/` touches `document`, `window` or `navigator` at module top level, so every file imports in Node
(a test checks this). Style follows the repo: `.ts` imports, `strict`, `exactOptionalPropertyTypes`,
`erasableSyntaxOnly` (no enums, parameter properties or namespaces); `exports` point at `src/` as in
`packages/engine-mock`.

### 5.2 The API, from simple to complex

**A counter**, built and run headless:

```js
import { createCk } from '@chromobench/shell'
import { manualClock } from '@chromobench/shell/testing'

const ck = createCk()
const app = ck.shell('Counter')
  .state({ count: 0, ui: {} })
  .commands(c => c.add('count.up', { label: 'Count Up', menu: 'Edit', run: ctx => ctx.tx('Count', t => { t.count++ }) }))
  .keys('global', { 'Mod+ArrowUp': 'count.up' })
  .center(ck.column({}, ck.text(s => `Count: ${s.count}`), ck.ui.command('count.up')))
  .build()

const rt = app.start({ clock: manualClock() })   // store, history, scheduler, commands, keys; no DOM
rt.run('count.up'); rt.flush()
rt.state.count                                    // 1
rt.history.undo(); rt.state.count                 // 0
// in the browser: import { mount } from '@chromobench/shell/dom'; mount(app, el)
```

**A module with docks and a per-photo history channel** (CraftKit's Develop, cut down):

```js
ck.shell('Studio')
  .state(init, { channelName: (id, s) => s.photos[id].name })   // Mod+Z says "Undo Contrast (on Old pier)"
  .module('develop', m => m.label('Develop').key('D')
    .txOpts(s => ({ channel: s.ui.photo, snapPath: ['dev', s.ui.photo] }))   // edits file into the photo's History
    .left(ck.dock.column({ width: 240 }, ck.panel('history')))
    .center(ck.viewport(s => s.picture, { tools: ['crop'], compare: true }))
    .right(ck.dock.column({ solo: true },
      ck.panel('basic', { title: 'Basic', reset: true },
        ck.ui.slider(-5, 5, { label: 'Exposure', bind: s => s.dev[s.ui.photo].light.exposure, step: 0.05, reset: 0 })),
      ck.dock.tabs(['detail', 'effects'])))
    .keys({ '\\': 'view.beforeAfter' }))       // module scope: only while Develop is current
```

**A viewport, a tool and an overlay.** The program names no engine; the host supplies services at mount:

```js
const app = ck.shell('Proof')
  .state({ picture: { hue: 30 }, ui: { probe: null }, view: { grid: false } })
  .tools(t => t.tool('probe', { label: 'Probe', key: 'I', cursor: 'crosshair',
    on: { down: (e, ctx) => { ctx.set({ ui: { probe: [e.x, e.y] } }); return false } } }))
  .center(ck.viewport(s => gradient(s.picture.hue), {          // τ returns a renderable the bridge accepts
    tools: ['probe'], overlays: [ck.overlay.grid({ when: s => s.view.grid })] }))
  .build()

mount(app, el, { bridges: [gradientBridge], presenter: canvas => new Canvas2DPresenter(canvas) })
```

**A kit with a fragment and a pass**, installed with `.use()`:

```js
const ratingsKit = ck.kit('ratings', k => k
  .state('ratings', { init: { stars: {} } })                     // document tier unless listed in view
  .commands(c => c.add('rate.set', { label: 'Set Rating',
    run: (ctx, n) => ctx.tx(`Rate ${n}`, t => { t.ratings.stars[ctx.state.ui.photo] = n }) }))
  .keys('module:*', ck.digits(0, 5, 'rate.set'))
  .fragments(ck.fragment('slider', { methods: { stepped(n) { return this.prop('step', n) } } }))
  .passes(ck.pass('ratings.reachable', { on: 'ui', after: 'keys' }, (ui, p) => {
    if (!ui.menus.some(m => m.items.includes('rate.set'))) p.diag('RT-001', 'rate.set is in no menu', { level: 'info' })
  }))
  .docs('## Ratings\nPress 0–5 to rate the current photo.'))

ck.shell('Studio').use(ratingsKit)
  .right(ck.panel('basic', {}, ck.ui.slider(0, 100, { bind: s => s.dev.a.vibrance }).stepped(5)))
```

**Explain.** Every node, kit and app renders as text; a variant's headless build plus this snapshot is its unit test
(`expect(app.diagnostics.errors).toEqual([]); expect(app.explain()).toMatchSnapshot()`):

```text
shell "Chromobench" · theme chromogen · kits: cb@0.1, cb.roll@0.1 (requires cb)
module print "Print" key D
  left   dock.column
           panel filmstrip "Film strip"
  center viewport main  τ cb.frame(s).print()  tools: dodge, burn, test-strip  compare
  right  dock.column
           panel enlarger "Enlarger"
             slider 1…120 s  bind recipes.*.print.enlarger.time_s  +testStrip(step 1/3 st)
commands 84 · keys 61 in 9 scopes · tools 6 · passes 23 · diagnostics ✓ 0 errors · 2 warnings
```

### 5.3 Typing the grammar

TS variants get errors in the editor; JS variants (and agent-written ones) still get the same checks at build. A slot
descriptor carries its binding time at runtime and its value type as a phantom type:

```ts
// ir/slots.ts (sketch)
export type Time = 'β' | 'τ' | 'bind' | 'θ' | 'ƒ' | 'ρ';
export interface Slot<T, B extends Time> { readonly time: B; readonly doc?: string; readonly list?: true; readonly _t?: T }
export const slot = {
  build: <T>(): Slot<T, 'β'> => ({ time: 'β' }),     traced: <T>(): Slot<T, 'τ'> => ({ time: 'τ' }),
  bind: <T>(): Slot<T, 'bind'> => ({ time: 'bind' }), item: <F>(): Slot<F, 'θ'> => ({ time: 'θ' }),
  helper: <F>(): Slot<F, 'ƒ'> => ({ time: 'ƒ' }),     handler: <A extends unknown[]>(): Slot<A, 'ρ'> => ({ time: 'ρ' }),
};

type NotFn<T> = T extends (...a: never[]) => unknown ? never : T;
export type Traced<S, T> = T | ((s: Readonly<S>) => T);
export type CommandRef = string | [string, ...unknown[]];        // 'photo.pick' or ['photo.rate', 3]
export type PropOf<D, S> =
  D extends Slot<infer T, 'β'>    ? NotFn<T> :                    // a lambda here is a type error (and B140)
  D extends Slot<infer T, 'τ'>    ? Traced<S, T> :
  D extends Slot<infer T, 'bind'> ? ((s: S) => T) | string :      // typed by the lambda's return type
  D extends Slot<infer F, 'θ' | 'ƒ'> ? F :
  D extends Slot<infer A extends unknown[], 'ρ'> ? CommandRef | ((...args: [...A, Ctx<S>]) => unknown) :
  never;
export type PropsOf<Slots, S> = { [K in keyof Slots]?: PropOf<Slots[K], S> };

export const sliderSlots = { ...commonSlots, bind: slot.bind<number>(), min: slot.build<number>(),
  max: slot.build<number>(), step: slot.build<number>(), label: slot.traced<string>(), reset: slot.traced<number>(),
  format: slot.helper<(v: number) => string>() } as const;
forms.define('slider', { slots: sliderSlots, kind: 'track', doc: 'Lightroom slider: drag, scrub, type, reset' });
// on Ck<S>:  slider(min: number, max: number, opts?: PropsOf<typeof sliderSlots, S>): FormNode<'slider', S>
```

**Typed `bind`.** With `Ck<StudioState>`, `bind: s => s.recipes[id]!.print.enlarger.time_s` must exist and return
`number` for a slider. String paths are accepted as `string`; a bounded `PathOf<S, 4>` template-literal type is
offered for shallow state (`ui`, `view`, `prefs`) but not for recipes, where it makes `tsc` slow. The runtime checks
(B110, B111) stay, because JS variants have no types.

**Nodes are chainable.** Each builder call returns a `FormNode`: the plain IR record plus chain methods returning a
*new* node (copy-on-write props, so nodes can be reused). Fragments add methods per form, visible to TypeScript
through module augmentation:

```ts
export interface NodeData<F extends string = string> {
  readonly $: F; readonly props: Readonly<Record<string, unknown>>; readonly kids: readonly NodeData[];
  readonly at: CallSite | null; readonly diags: readonly Diag[]; readonly calls: readonly PendingCall[];
}
export interface Chain<F extends string, S> {
  prop(key: string, value: unknown): FormNode<F, S>;           // one prop, slot-checked
  slot(key: string, ...items: unknown[]): FormNode<F, S>;      // append to a list slot (overlays, badges)
  with(props: Partial<PropsOfForm<F, S>>): FormNode<F, S>;
  tip(v: Traced<S, string>): FormNode<F, S>; disabled(v: Traced<S, boolean>, why?: Traced<S, string>): FormNode<F, S>;
}
export interface FormMethods<S> {}                              // kits augment this, keyed by form name
export type FormNode<F extends string, S> = NodeData<F> & Chain<F, S> & (F extends keyof FormMethods<S> ? FormMethods<S>[F] : unknown);

declare module '@chromobench/shell' {                           // in a kit
  interface FormMethods<S> { slider: { stepped(n: number): FormNode<'slider', S> } }
}
```

**The builder chain** carries the state type and widens it when a kit adds a slice:

```ts
export interface ShellBuilder<S extends object> {
  state<S2 extends object>(init: S2, opts?: StateOpts<S2>): ShellBuilder<S2>;
  use<K extends Kit>(kit: K, opts?: KitOptions<K>): ShellBuilder<S & KitState<K>>;
  commands(f: (c: CommandsBuilder<S>) => void): this;
  keys(scope: KeyScope, map: KeyMap<S>): this;
  module(id: string, f: (m: ModuleBuilder<S>) => void): this;
  build(opts?: BuildOptions): BuiltApp<S>;
}
export function createCk<S extends object = any>(opts?: CkOptions): Ck<S>;
```

Command, panel, tool and icon ids stay `string`; the build reports unknown ids with suggestions, which is cheaper
than accumulating literal unions through the chain. Handlers get `Ctx<S>` (`state: Readonly<S>`, `tx(label, (t:
Draft<S>) => void, opts)`, `preview`, `commit`, `cancel`, `set`, `run`, `toast`, `dialog`, `go`, `history`,
`viewport(id)`, and in tools `vp` and `tool`); `Draft<S>` is a mutable mapped type of `S` plus the `$` operations.

### 5.4 Store extensions

**Tiers by path prefix.** Kits need slices split across tiers (CHB-020's roll slice keeps `rolls` undoable and
`contact` in the view tier), so `view` takes prefixes (`'ui'`, `'roll.contact'`) and the longest match wins.

**Named preview layers.** Chromobench also shows pending agent proposals as previews that outlive gestures, so the
single layer becomes a stack: `current = doc ⊕ proposal layers ⊕ gesture`. `ctx.preview/commit/cancel` act on
`gesture` exactly as before; studio-kit uses `store.layer('proposal:tx42').set(path, v)`, `.drop()`, `.commit(label)`.
A transaction overlapping the gesture layer cancels it (CraftKit's rule); proposal layers are kept, and studio-kit
judges their staleness.

**Routes.** `recipes.<frameId>` is a projection of each frame's EditLog, not plain state. The program *declares* a
route, so the build can check bindings under it; the host *supplies* the adapter at start:

```ts
k.route('recipes', { keyDepth: 1, checkPath: rest => recipeFieldCheck(rest) })   // in a kit: recipes.<id>.<field>
app.start({ adapters: { recipes: editLogAdapter } })                             // studio-kit, at runtime
```

On commit, patches under the prefix go to `adapter.apply(patches, opts)` first. If it throws (validation, `E_STALE`),
the whole transaction is aborted and reported. Otherwise the store writes the plain patches and the adapter's
*mirror* values (the new recipes) in one `writeDoc`, so cells see one change. Reads stay plain: the mirror lives in
the tree, so tracking, derived paths, bindings and previews work unchanged.

**Probe mode.** At build, `s => s.recipes[s.ui.frame].print.time_s` reads a missing key. In probe mode the tracker
returns a recording proxy for missing values, so the full path is still recorded; paths under a route are checked by
its `checkPath`, with the key segment as a wildcard (`recipes.*.print.time_s`). This replaces CraftKit's `lazy: true`
for such bindings. (Sketch: which reads count as keys is an implementation detail.)

### 5.5 Fragments

```ts
interface FragmentSpec<S> {
  when?: (node: NodeData) => boolean;                  // only some nodes (e.g. exposure-like args)
  methods?: Record<string, (this: FormNode<string, S>, ...a: never[]) => FormNode<string, S>>;
  props?: Record<string, { default?: unknown; doc?: string }>;
  slots?: Record<string, Slot<unknown, Time> | unknown[]>;  // new slots; an array declares or extends a list slot
  render?: (next: Renderer) => Renderer;               // DOM half only: wrap the form's renderer
  check?: (node: NodeData, p: PassCtx) => void;
  explain?: (node: NodeData) => string | null;
}
ck.fragment(target: FormName | FormCtor | Extensible | 'shell' | 'module', spec: FragmentSpec<S>): Fragment
```

Targets are a form name, a form constructor (`ck.ui.slider`, or studio-kit's `cb.arg`), an *extensible kind* a
library declares for its own objects (`ck.extensible('frameHandle')`, used for studio-kit's frame handles), or the
shell and module builders. Fragments install into one `Ck` instance, usually through a kit, never onto global
prototypes: a variant without the kit sees none of them.

Method calls resolve late. At build time a node is wrapped in a Proxy; a method not installed *yet* is recorded as a
pending call `{ name, args, at }` and the node is returned, so nodes created before `.use(kit)` still work. The
`normalize` pass applies pending calls once all kits are in. A call no fragment provides is X120 with suggestions from
the receiver ("`.testStip()` on a slider: did you mean `.testStrip()` (kit cb.roll)?", or "`.testStrip()` exists for
`cb.arg` sliders, but this is a number field"). Two fragments adding the same method or slot to one target is X110,
naming both kits and both call sites.

### 5.6 Kits

```ts
ck.kit(name, k => k
  .requires('cb')                                               // dependencies by kit name
  .state('roll', { init, view: ['contact', 'selectedRoll'] })   // a slice; document tier unless listed in view
  .route('recipes', { keyDepth: 1, checkPath })
  .forms(...specs).fragments(...frags).commands(f).menus(f).keys(scope, map).tools(f).panels(...nodes)
  .passes(...passes).ir(name, spec).theme(tokens).icons(map).docs(markdown))
```

A kit is a recorded value: it can be explained and installed into several `Ck` instances. `.use(kit)` installs
dependencies first, each once; a missing one is X130, a cycle X131. The same command, panel, tool or state key from
two kits is a diagnostic naming both, not a silent override; a variant replaces a kit's command on purpose with
`c.add(id, { …, replace: true })`. Kit docs go into Help and `explain`. Parameterised kits are functions returning
kits (`rollKit.with(opts)`).

### 5.7 Passes and IRs

```ts
ck.ir('recipe', { explain: r => …, validate?: r => … })        // studio-kit registers recipe, op-dag, mutation-batch
ck.pass(name, { on: 'ui', after?: string | string[], before?: string | string[] },
        (ir, p: PassCtx) => void | IR)                           // return a new IR to rewrite or lower
// PassCtx: p.diag(code, message, extra) · p.options · p.explain(x)
```

Passes are ordered by a topological sort of `after`/`before` (a cycle is X140; ties keep installation order). The
shell runs `ui` passes at `.build()`; other IRs run on demand (`ck.run('recipe', ir)`), so studio-kit's recipe and
mutation-batch pipelines share the manager, diagnostics and `explain`. The `ui` IR is the recorded program: `{ name,
state, tiers, commands, menus, keys, springs, tools, modules, panels, kits }` with the node trees under `modules` and
`panels`. CraftKit's checks become the built-in passes:

| pass | checks | codes |
|---|---|---|
| `normalize` | install kits, resolve panel references, apply pending fragment calls, merge slices | X110–X131 |
| `slots` | unknown options, lambdas in β slots, bad bind values | B130, B140, B141 |
| `bindings` | bind paths against the initial state or a route (probe mode) | B110–B113 |
| `docking` | unknown or twice-placed panels, modules without a centre | D301–D303 |
| `menus`, `keys` | menu items naming missing commands; the K2xx checks | B150, K201–K221 |
| `match`, `tools` | `ck.match` exhaustiveness; unknown tools, tools without `on.down` | M201, V302, T401 |
| `icons`, `a11y`, `reach` (new) | unknown icons; unlabelled icon buttons and untitled panels; panels placed nowhere, commands reachable from nothing | B170, B180, I010 |
| `summary` | counts and totals | I001 |

### 5.8 `explain`

`ck.explain(x)` renders a node, kit, command table, key map, pass list or built app as an indented outline (5.2). It is
deterministic: stable order, call sites only with `{ at: true }`, lambdas shown by meaning (a bind by its path, a
command reference by its id, other τ lambdas as `τ` plus the function's name). `rt.explain({ live: true })` evaluates
τ props against the current state (`label "Undo Exposure time"`, `disabled — why: Nothing to reset`): the answer to the
agent's "what is on screen?". Forms, fragments and kits contribute through `explain` hooks; the form specs' `doc`
strings generate the shell reference page.

### 5.9 Pluggable interfaces

The program says *what* to show; services say *how*. Services are passed to `start` or `mount`, never recorded, so one
variant runs headless with fakes and in the browser with the real engine.

**Presenter.** Structurally identical to CHB-009's, with shell-local types:

```ts
export interface Rect { x: number; y: number; w: number; h: number }
export interface PresentImage {
  width: number; height: number; channels: number; data: Float32Array | Float64Array | Uint16Array;
  region: Rect; scale: number;                 // document region covered; engine px per document px
  bitmap?: ImageBitmap;                        // fast path for the Canvas2D default
}
export interface ViewTransform { docW: number; docH: number; cx: number; cy: number; zoom: number; dpr: number; split: number | null }
export interface Presenter {
  readonly kind: 'webgpu' | '2d'; readonly colorSpace: 'display-p3' | 'srgb';
  setImages(main: PresentImage, before: PresentImage | null): void;
  draw(view: ViewTransform, colours: { stage: [number, number, number]; frame: [number, number, number] }): void;
  readDocPixel(x: number, y: number): Promise<number[] | null>;
  dispose(): void;
}
```

The viewport keeps CraftKit's view state (fractions) and converts per draw (`cx = V.cx × nw`, `zoom = V.s`, `split`
from the compare mode). Tool events carry CraftKit's `u, v` (0–1) and document pixels `x, y`, so probes, masks and the
agent agree on coordinates. Overlays stay SVG above the canvas. The shell ships a Canvas2D default; studio-kit passes
CHB-009's WebGPU presenter. Stage and frame colours come from theme tokens.

**RenderBridge and the render queue.** The viewport's τ lambda returns a *renderable*: a frame handle
(`cb.frame(s).print()`) in chromobench, a gradient description in the demo. The bridge identifies and renders it:

```ts
export interface RenderTarget {
  slot: string; epoch: number; lane: 'live' | 'bg'; pass: 'draft' | 'screen' | 'refine';
  maxSide: number; region?: Rect; signal: AbortSignal;
}
export interface Rendered { image: PresentImage; srcW: number; srcH: number; ms: number }
export interface RenderBridge<R = unknown> {
  readonly id: string;
  isRenderable(x: unknown): x is R;
  key(r: R): string;                       // equal keys ⇒ same pixels (the content address in chromobench)
  render(r: R, t: RenderTarget): Promise<Rendered>;
  naturalSize?(r: R): [number, number] | null;
  release?(x: Rendered): void;             // close bitmaps, free textures on eviction
  explain?(r: R): string;
}
```

Studio-kit's bridge runs `compile(recipe)` and `Engine.evaluate(node, { scale, region, precision: 'preview', signal
})`. The queue keeps CraftKit's scheduling with CHB-009's rules, per slot (`vp:main:after`, `vp:main:before`,
`thumb:<key>`):

```text
request(slot, r, pass):
  gen = ++slot.gen; slot.waiting = { gen, r, pass }           # latest wins: older waiting requests are dropped
  if slot.inflight and slot.inflight.key ≠ key(r): abort it   # superseded work
  pump(slot)                                                  # live: now; bg: from the scheduler's idle lane
pump(slot):
  if slot.inflight or nothing waiting: return
  if lane = bg and a live slot is busy: retry on idle         # live preempts background
  render with an AbortSignal; on result: present only if gen > slot.shownGen, else release
pass (viewport): previewing and this view's key changed → draft (≈0.5 MP, adapted towards ≈30 ms)
                 otherwise screen (shown size × dpr, rounded up to 128, capped by the source); zoom ≥ 1:1 → refine region
thumbnails: LRU of 400 by key(r)|max; θ cells ask on the bg lane; hits draw at once
```

**HistoryAdapter.** The global undo stack holds entries from the store and from adapters:

```ts
export interface HistoryEntry { id: number; source: string; label: string; detail?: string; channel?: string | null; time: number; parts?: HistoryEntry[] }
export interface HistoryAdapter {
  readonly id: string;                                        // the route name: 'recipes'
  apply(patches: Patch[], opts: TxOpts): { entry: Omit<HistoryEntry, 'id'> | null; mirror: Mirror[] };
  undo(e: HistoryEntry): Mirror[]; redo(e: HistoryEntry): Mirror[];        // Mirror = { path, value }
  channel?(id: string): { list: { label: string; detail?: string; time: number }[]; pos: number } | null;
  stepTo?(channel: string, index: number): void;
}
history.push(entry)   // changes that did not come through a transaction (an approved proposal)
```

A transaction writing catalog and recipe paths becomes one *compound* entry with two parts; a roll balance writing 36
frames' recipes becomes one entry holding 36 EditLog units, undone by one Mod+Z. The channel is the frame id, so the
History panel lists that frame's EditLog through `channel()`. `opts.coalesce` is passed through; since the EditLog is
append-only, studio-kit buffers bursts as CHB-009's `GestureController` does.

**PersistenceAdapter.** CraftKit's autosave (debounced 700 ms on the idle lane and on page hide; document tier
filtered by `persist`, view less `transient`, `ui` only `keepUi`) moves behind an async interface:

```ts
export interface PersistenceAdapter {
  load(key: SaveKey): Promise<{ doc?: unknown; view?: unknown } | null>;   // SaveKey = { app, version }
  save(key: SaveKey, part: 'doc' | 'view', value: unknown): Promise<void>;
  clear(key: SaveKey): Promise<void>;
}
```

The shell ships local-storage and memory adapters; studio-kit supplies IndexedDB (CHB-009's `KV`). `mount` awaits
`load` before the first frame. Routed prefixes are never saved by the shell (studio-kit persists EditLogs). IndexedDB
writes on `pagehide` may not finish, so autosave also runs on `visibilitychange` to hidden.

**Theme tokens.** `shell.css` uses only custom properties, so a theme is data: `ck.theme({ name, light, dark?,
grays? })` with CraftKit's token names (`app`, `panel`, `line`, `text`, `text2`, `accent`, `sel`, `track`, `knob`,
`canvas`, `cell`, `menu`, `ok`, `warn`, `err`, …) plus new structural tokens (`font`, `fontSize`, `radius`, `rule`).
`.theme('lightroom')` selects one; `prefs.theme` and `prefs.gray` live in the view tier. Two sets ship in
`src/themes/`: `lightroom` (CraftKit's values and its four interface greys) and `chromogen` (CHB-009's `studio.css`
mapped onto these names: white ground, one ink, Arial, 1 px rules, radius 0, red only for selection, pending changes
and errors). Dark variants follow CraftKit's `prefers-color-scheme` pattern.

### 5.10 Diagnostics

One producer, used by the shell, kits and passes:

```ts
export interface Diag {
  code: string;                        // 'CK-B110', 'CB-R001', 'E_DOMAIN'
  level: 'error' | 'warning' | 'info';
  message: string;                     // CraftKit's title
  at?: CallSite | null;                // { url, file, line, col }: the program's own line
  facts?: string[];                    // CraftKit's lines: the competing facts, each with its location
  fix?: string;                        // one fix, computed from the receiver
  where?: { line: number; col?: number }; path?: string; valid?: string[]; hint?: string;   // the contract's fields
  runtime?: boolean; source?: string;  // 'shell', a kit or a pass
}
export function diag(code: string, message: string, extra?: Partial<Omit<Diag, 'code' | 'message'>>): Diag;
```

`Diag` is a structural superset of the contract's `Diagnostic`, so studio-kit can pass it wherever the contract
expects one, without the shell importing the contract. Families keep CraftKit's letters (I, B, K, D, L, M, T, V) and
add X (fragments, kits, passes) and P (performance; P510 is an effect loop, listing the cells' call sites).
Studio-kit adds `CB-*`; recipe passes reuse the contract's `ERROR_CODES`.

`site()` skips frames under registered library roots: the shell registers its own directory, and studio-kit and kits
call `ck.libraryRoot(import.meta.url)`, so `at` is the variant's line even for nodes made by `cb.arg(...)`. Node's
type stripping keeps line and column positions, so call sites are exact in Node; Vite's `?t=` query is stripped;
whether vitest rewrites `Error.stack` through source maps must be checked in stage 1 (TODO).

### 5.11 Headless build and runtime

`build()` is pure: it records, runs the `ui` passes and returns a `BuiltApp` with `diagnostics`, `explain()` and the
normalised IR. `app.start(services)` creates the runtime without a DOM: store (restored through the persistence
adapter), history, scheduler on the given `Clock`, commands, the key router, and a *recording chrome* that keeps
toasts and dialogs as data (so a test can assert that a disabled command reported its why):

```ts
const rt = app.start({ clock: manualClock(), persistence: memoryPersistence(), bridges: [fakeBridge()] })
rt.keys.dispatch('mod+z', ['canvas', 'module:print', 'global'])   // the chain the DOM would compute
rt.flush()                                                         // one frame: feedback, chrome cells, render lane
rt.inspect()          // { frames, cellsRun, subscribed, derived, previewing, undo, redo, renders, dropped, thumbs }
```

`mount(app, el, services)` from `@chromobench/shell/dom` calls `start`, then builds the menu bar, module picker, dock,
chrome layer, key listeners and focus tracking. Renderers are registered by the DOM module; a form with a spec but no
renderer is reported at mount.

### 5.12 Decision records

- **DR-1 Port CraftKit to TypeScript; no React.** CHB-016 found CraftKit's shell already does what a Lightroom-class UI
  needs, with build checks and a runtime that never re-renders a tree. Alternatives were React with a builder emitting
  components, or a rewrite. Port file by file, keeping names and behaviour, so CraftKit's tests and docs stay valid
  references; CHB-019 replaces CHB-009's React components.
- **DR-2 Instances, not globals.** Tests build four variants in one process and kits must not leak between them, so
  `createCk()` returns a fresh namespace (forms, fragments, kits, passes, panels, tools); `ck` is a default instance.
  Variants receive `ck` as a parameter, as the UI brief's sketch already does.
- **DR-3 Form specs separate from renderers.** Slots, docs and checks are headless data; `mount` is a renderer
  registered by `@chromobench/shell/dom`. This is what makes a fully checked headless build possible.
- **DR-4 A render bridge replaces compile-once holes.** Chromobench interns content-addressed nodes per recipe, so
  equal recipes share work and the node id is the render key. The viewport's τ returns a renderable; the bridge keys
  and renders it; the shell keeps the scheduling. Queue tests replace `engine.test.mjs`.
- **DR-5 Recipes are routed, not stored.** The EditLog stays the authority (provenance, proposals, `E_STALE`); the
  store mirrors recipes for reading and routes writes to an adapter. Copying recipes into the store and syncing back
  would create two authorities. Status: proposed, to be validated by CHB-019's adapter.
- **DR-6 Presenters stay in chromobench.** The shell defines `Presenter` and ships a Canvas2D default; studio-kit
  passes the WebGPU one. Both are generic and could move into the shell later (9.6).

## 6. One flow traced end to end: a slider drag in the darkroom variant

The photographer drags *Exposure time* on frame `f-07` from 12.0 s to 14.3 s. The viewer is 1200 × 800 CSS px at
`dpr` 2; the scan is 6000 × 4000.

1. **Build** (once). `cb.arg('print.enlarger.time_s')` made a slider with `bind: s =>
   s.recipes[s.ui.frame].print.enlarger.time_s`; the `bindings` pass, in probe mode, checked
   `recipes.*.print.enlarger.time_s` through the route's `checkPath`.
2. **Input, route.** `pointerdown` on the track, off the knob: the slider's handler jumps to 12.4 (snapped to step).
3. **Intent, change.** `Binding.preview(12.4)` pins `['recipes', 'f-07', 'print', 'enlarger', 'time_s']` (the
   selection may change mid-drag; the path does not) and sets it on the `gesture` layer. `current` is rebuilt by
   copying five objects; every other recipe and the catalog keep their identity.
4. **Propagate.** The trie marks the slider's bind cell, the panel readout, the viewport's render cell (it read
   `recipes.f-07` whole, through the frame handle) and the histogram's derived path. The 40 other sliders are not
   marked. A frame is requested.
5. **Schedule, draw.** The chrome lane re-checks the four cells in creation order; the knob and readout move. The
   viewport cell returns a new handle with a new key; the store is previewing, so it requests a **draft**: about
   0.5 MP of a 3:2 image, `maxSide` ≈ 866, slot `vp:main:after`, lane `live`, epoch 312.
6. **Render.** Further steps (13.1, 13.8, 14.3) replace the waiting request; the in-flight 12.4 render is aborted
   when 13.1 arrives with a different key. A result is presented only if its generation is newer than what is shown.
7. **Commit.** `pointerup` → `Binding.commit('Exposure time', { detail: '14.3 s' })`. The layer becomes one patch under
   `recipes`; `commitPatches` routes it to `editLogAdapter.apply`, which calls `EditLog.apply({ op: 'set', path:
   'print.enlarger.time_s', value: 14.3 })` (new undo unit `u12`) and returns the new recipe as mirror. The store writes
   the mirror and clears the layer in one `writeDoc`; history records `{ source: 'recipes', label: 'Exposure time',
   detail: '14.3 s', channel: 'f-07' }`.
8. **Refresh.** No longer previewing, the viewport requests a **screen** pass: the image fits the pane at about
   1176 × 784 CSS px, 2352 device px on the long side, rounded up to 2432, under the 6000 px source cap. The draft
   stays on screen until the screen pass arrives.
9. **Undo.** Mod+Z: the router walks `canvas · module:print · global` to `edit.undo`. `history.undo()` sees source
   `recipes`, calls `editLogAdapter.undo(entry)` (cursor back past `u12`), writes the mirror and toasts "Undo
   Exposure time". Steps 4–8 repeat.

Had `EditLog.apply` refused the value (out of the ArgSpec's range), step 7 would abort: the document stays at 12.0,
the preview is dropped, and the refusal shows as a toast and a runtime diagnostic with the contract's code.

## 7. Implementation plan

**Stage 1 — headless core.** `core/` (util, path, diag and site, store with prefix tiers, layers and routes, track
with probe mode, cells, clock, scheduler, history with sources, commands, keys with a platform parameter); `ir/`
(nodes, slots, every built-in form spec); `build/` (`createCk`, shell and module builders, the built-in `ui` passes
from CraftKit's `check()`); `app/runtime` (`start`, `ctx`, headless key dispatch, recording chrome); `testing/`. Port
`core.test.mjs` and `keys.test.mjs`; add the boundary rules. *Done means:* ported tests pass in vitest; the mini
studio fixture (a TS cut-down of CraftKit's Library and Develop) builds in Node with zero errors and runs commands and
undo headless; every file under `src/` imports in Node.

**Stage 2 — forms and places.** `dom/`: `h`, icons, habits with the arithmetic parser, chrome (menu bar, menus,
palette, shortcut sheet, dialogs, toasts, tooltips), dock and workspaces, renderers for basic, container, collection
and plane forms, `thumb` with `src` only, `mount`, `shell.css` on tokens, both theme sets, local-storage and memory
persistence, the `demo/` page. *Done means:* the demo mounts the mini studio; DOM tests show a slider drag is one undo
step, a disabled command reports why, a collapsed panel survives a reload, Tab and F5–F8 hide sides; a Playwright
smoke test on the demo passes.

**Stage 3 — viewport and bridges.** `RenderBridge`, the render queue, `Presenter` with the Canvas2D default, the
viewport (zoom, pan, springs, tools, overlays, compare), `thumb` through the bridge, `HistoryAdapter` with compound
entries, async restore. *Done means:* queue tests replace `engine.test.mjs`; the demo renders drafts while dragging
through a procedural bridge; a test or studio-kit spike drives CHB-009's WebGPU presenter and `MockEngine` through a
bridge of about 50 lines; a fake adapter shows interleaved undo.

**Stage 4 — fragments, kits, passes, explain.** Fragments with late resolution and conflicts; kits with dependencies
and conflicts; the pass manager with IR registration; `explain` (static and live); `FormMethods` augmentation. *Done
means:* a test kit adds a form, a slider fragment, a command and a pass to the mini studio; conflicting kits give X110
with both sites; a pass cycle gives X140; `explain` snapshots are stable; type tests show a lambda in a β slot and an
unknown fragment method fail `pnpm typecheck`.

**Stage 5 — hardening and performance.** `rt.inspect()` and a `ck.inspector()` panel form, benchmarks and the
targets of section 8, the `a11y` and `reach` passes, a wording review of diagnostics, a reference page generated from
form docs, version 0.1 for CHB-019. *Done means:* targets hold in the demo under Playwright; the reference covers
every form and slot; CHB-019 builds a variant on the published API.

## 8. Testing, acceptance and performance

**Ported tests.** `core.test.mjs` becomes `test/core/{store,track,cells,history}.test.ts`, case for case: read sets
drop navigation; binding paths and missing keys; cells re-run only on their reads; preview then commit is one undo
step; the view tier is not undoable; drafts with arrays and `find`; coalescing; derived paths; channels and stepping
back; shared objects; stripping; derived-list escapes. `keys.test.mjs` becomes `test/core/keys.test.ts` (run for both
platforms) and `test/dom/habits.test.ts` (`3p6` = 42 pt, `1in` = 25.4 mm, `*2`, `50%`, clamping, refusing `abc`).
`engine.test.mjs` tests the dropped compiler; `test/app/render-queue.test.ts` replaces it with a fake bridge: latest
wins, superseded work aborted, stale answers released not presented, live preempts bg, LRU eviction releases, draft
then screen.

**New tests.** Layers and routes (an adapter refusal aborts the whole transaction; mirror and plain patches land in
one notify); compound undo; fragments, kits, passes (stage 4); the mini studio's headless build with an `explain`
snapshot; type tests with `// @ts-expect-error` under `pnpm typecheck`; renderer tests with a per-file
`// @vitest-environment happy-dom` (a new dev dependency, open question 9.8); Playwright on the demo. To show tests can
fail, the queue tests include a mutant bridge that answers out of order, and the cell tests assert exact run counts.

**Performance targets** (proposed; to be measured, not assumed):

| target | how measured |
|---|---|
| a slider preview step re-checks ≤ 5 cells in the mini studio with 200 sliders | `inspect().cellsRun` delta, headless (exact) |
| no frame over 24 ms during a 2 s drag after warm-up; chrome lane ≤ 4 ms at p95 | `scheduler.stats` read by Playwright on the demo |
| one-photo transaction on a 10,000-photo catalog ≤ 0.2 ms | `vitest bench` on the store |
| headless build of the largest variant ≤ 50 ms; mount ≤ 100 ms | timers in a test and in the demo |
| a 10,000-item grid keeps ≤ visible + overscan rows mounted | DOM node count in a demo test |

CraftKit's Runtime Inspector (`CK/src/app/main.js`, `inspector()`) shows frames, last frame, slow frames, cells
re-checked, subscribed and derived paths, store version, previewing, undo/redo depth, renders, dropped answers, cache
size, commands and key bindings. The port makes these a data API first (`rt.inspect()`, assertable in tests) and a
panel form second.

## 9. Risks and open questions

1. **Interleaved undo policy.** When a frame's EditLog moves outside the global stack (stepping back in its History
   panel, a proposal approved later), what does Mod+Z undo next? The shell provides `history.push` and compound
   entries; CHB-019 decides. CraftKit made stepping back a new transaction; the EditLog's cursor suggests moving it.
2. **Coalescing against an append-only EditLog.** The store coalesces by amending the last entry; the EditLog cannot.
   Studio-kit buffers bursts before logging.
3. **Type cost.** Deep `PropsOf`, `Draft<S>` and path types can slow `tsc`; keep path types shallow and measure
   `pnpm typecheck` once studio-kit's state type exists.
4. **Large read sets.** A τ lambda filtering 10,000 photos subscribes to every element it returns. Use derived paths
   (CraftKit's answer); a P-family warning could flag cells with very large read sets.
5. **Call sites under bundlers.** Production bundles point `at` into the bundle; acceptable for a dev feature.
6. **Where presenters live**, and compare modes: CraftKit's `lr` and `tb` need two panes, which CHB-009's shader does
   not draw (it supports `split`). Extend the shader or use two canvases.
7. **API drift between parallel guides.** CHB-020/021/022 sketch `ck.fragment(target, { props, slots, methods })`
   with `this.prop()`/`this.slot()`, `ck.kit(...).state(...)` and `ck.pass(name, { on, after, before }, fn)`. This
   guide adopts those names; small shape differences (the `state` arguments) are settled in stage 4.
8. **DOM test tool.** happy-dom is fast but has no layout; Playwright is exact but slow. Proposal: happy-dom for
   behaviour, Playwright for layout and performance.
9. **Licence.** The shell is Manuel's own CraftKit work; CHB-016's open licence question concerns the vendored
   Workbench engine, which is not ported.

## 10. References

- UI design brief: `ttmp/2026/11/11/CHB-016--…/various/ui-design-brief.md`; CHB-016 diary Steps 2–4
  (`ttmp/2026/11/11/CHB-016--…/diary/01-diary.md`).
- CraftKit: `CK/docs/SHELL.md`, `CK/docs/README.md`, `CK/src/shell/**`, `CK/test/{core,keys,engine}.test.mjs`,
  `CK/src/app/main.js` (Runtime Inspector), `CK/src/app/develop.js` (channels through `txOpts`).
- CHB-009: guide §5.6 (`ttmp/2026/11/11/CHB-009--…/design-doc/01-intern-guide-studio-app-ui.md`);
  `apps/studio/src/present/{presenter,presenter-webgpu,presenter-2d}.ts`; `apps/studio/src/core/{scheduler,gesture}.ts`;
  `apps/studio/src/storage/db.ts`; `apps/studio/src/studio.css`.
- Contract: `packages/contract/src/editlog.ts` (`EditLog`, `UndoUnit`), `errors.ts` (`Diagnostic`, `ERROR_CODES`),
  `engine.ts` (`Engine`, `EvalTarget`).
- Repo conventions: `tsconfig.base.json`, `vitest.config.ts`, `playwright.config.ts` (the `gpu-parity` project is the
  pattern for a package demo page), `tools/scripts/check-boundaries.ts`, `packages/engine-mock/package.json`.
- Consumers: CHB-019, CHB-020, CHB-021, CHB-022 guides (`design-doc/01-intern-guide.md`).
