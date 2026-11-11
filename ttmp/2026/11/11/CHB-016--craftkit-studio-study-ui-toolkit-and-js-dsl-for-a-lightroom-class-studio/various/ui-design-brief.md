---
Title: UI design brief
Ticket: CHB-016
Status: active
Topics:
    - ui
    - dsl
    - architecture
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Shared decisions for the UI guides (CHB-016, CHB-018..022): layers, grammar, kits, fragments, passes, EditLog bridge"
LastUpdated: 2026-11-11T14:30:00-05:00
WhatFor: ""
WhenToUse: ""
---

# UI design brief: the studio expressed entirely in the JS API

Shared brief for the guides of CHB-016, CHB-018, CHB-019, CHB-020, CHB-021 and CHB-022. It fixes names, layers
and boundaries so that six guides written in parallel fit together. It is a starting point, not a spec: guides may
refine it, and should say so where they do.

## 1. Goal

Chromobench is a Lightroom + Negative Lab Pro + Dehancer kind of app for one photographer (Manuel's dad): import
scanned negatives and digital RAWs, print them through a physical film/paper model, apply darkroom manipulations,
finish, compare and export. The **whole UI is expressed in a JS API**: layout, modules, panels, controls, tools,
overlays, commands, menus, keys, themes and flows are all builder calls in plain JS. A *variant* is one JS module
that builds a complete studio. We want many variants (a Lightroom-like one, a darkroom-first one, a three-step one
for the photographer, a lab one for us) and we want new ones to be cheap to write, by us and later by the agent.

The photographer never sees the API or the DSL. Variants are authored by us (and later by the agent, reviewed by
us); they run unsandboxed in the page. Only agent *eval* code (CHB-007) runs in the QuickJS sandbox.

## 2. API principles (Manuel's guidelines)

- **Fluent builder** around a core grammar of composable components. The builder knows its receiver, so feedback
  is computed, not static: did-you-mean, the fix in the program's own words, values and measurements in context.
- **Lambdas** customise components. Each slot declares when its lambda runs (binding times, below): at build, or at
  runtime as a traced cell, per item, or as a handler.
- **IR / DAG** for anything built (the UI tree, recipes, the op graph), so transformations and validations are
  *passes*, and there can be several IRs with lowering between them. **Mutations** for runtime interaction (the
  user's gestures, the agent's edits).
- **No parser or interpreter of our own.** Plain JS. Proxies are used for diagnostics.
- **JS defines parameters** (sliders and other controls) for looks, presets, tools and variants.
- **Fragments** extend individual components with methods, props and slots.

## 3. Layers and packages

```text
apps/studio            host: boots storage + engines, loads a variant, variant switcher, dev hot-reload
  variants/*.js        classic · darkroom · simple · lab  (each: one JS module, the whole UI)
packages/studio-kit    `cb`: chromobench vocabulary on the shell (CHB-019)
  kits/roll            `cb.roll.*`    roll workflow (CHB-020)
  kits/looks           `cb.looks.*`   looks, presets, comparison (CHB-021)
  kits/finish          `cb.finish.*`  finish and retouch (CHB-022)
packages/shell         `ck`: the CraftKit Shell ported to TypeScript, generic, no chromobench imports (CHB-018)
packages/contract · core · gpu · ingest · dsl   (Phase 1; unchanged by these tickets except via requests)
```

- **`packages/shell` (`ck`, CHB-018)**: the generic toolkit. Port of CraftKit Studio's `src/shell` (about 3,900
  lines, plain ES modules, no framework): builder and node IR, binding times, store with tiers, tracked cells and
  the frame scheduler, history, commands and menus, keys and springs, forms and habits, docks, viewport, render
  bridge, diagnostics, persistence. New in the port: fragments, kits, passes, `explain`, typed interfaces for the
  presenter, the render bridge, history and persistence, so chromobench can plug its own in. No React.
- **`packages/studio-kit` (`cb`, CHB-019)**: chromobench's components on the shell: controls generated from
  `ArgSpec` and bound to recipe paths (`cb.arg`), the frame viewer (`cb.viewer`), library/roll/frame views (grid,
  film strip, contact sheet), EditLog-backed history and approval cards, provenance (`why`), densitometer and
  probes, darkroom tools (test strip, ring-around, mask paint, exposure list), units and formatting.
- **Feature kits (CHB-020/021/022)**: each is a *kit*: a bundle of forms, fragments, commands, tools, passes, a state
  slice and docs that a variant installs with `.use(kit)`.
- **`apps/studio` (CHB-019)**: the host. Picks a variant (URL `?variant=`, a menu, a file dropped in dev), builds it,
  mounts it, reports diagnostics. Hot-reloads variant files in dev.

## 4. The grammar (from CraftKit, kept)

An app is **recorded**, then **checked**, then **mounted**. Builder calls record plain nodes
`{ $: form, props, kids, at }` with the call site `at`; `.build()` runs check passes and reports diagnostics against
the program's own lines; `.mount(el)` starts Input → Route → Intent → Change → Propagate → Schedule → Draw.

| mark | binding time | when it runs | examples |
|---|---|---|---|
| β | build | once while building | `min`, `max`, `options`, a list of sections |
| τ | traced | as a cell, re-run when a read path changes | `label: s => …`, `disabled: s => …` |
| bind | binding | τ naming one path, two-way | `bind: s => s.recipes[id].print.enlarger.time_s` |
| θ | per item | with the real item when a row is drawn | `cell: (frame, i) => …` |
| ƒ | helper | pure function of the form's value, or a mount function | `format: v => v.toFixed(1)` |
| ρ | runtime | handlers, with `ctx` | `run: ctx => …`, `drag: (e, ctx, g) => …` |

A lambda in a β slot is a build error. Unknown options are warnings with suggestions.

Store: one immutable tree in tiers by top-level key: **document** (undoable, persisted), **view** (free, saved with
the workspace), and a **preview** layer during gestures (`ctx.preview` … `ctx.commit(label)` makes one
transaction, one undo step). Commands come from one table that drives menus, context menus, toolbars, the palette
(Mod+K) and the shortcut sheet; disabled items say why. Keys are scoped (text · dialog · tool · panel · canvas ·
module · global) and checked at build.

## 5. New mechanisms (beyond CraftKit)

- **Fragments**: `ck.fragment(target, spec)` extends a form, a node kind, the shell builder, or (via studio-kit) a
  frame handle with methods, props and slots. Example: every exposure-like `cb.arg` gains `.testStrip()`.
- **Kits**: `ck.kit(name, k => k.forms(...).fragments(...).commands(...).tools(...).passes(...).state(...))`;
  variants install them with `.use(kit)`. Kits declare dependencies and contribute docs to Help.
- **Passes and IRs**: `ck.pass(name, { on, after, before }, fn)`. IRs: **UI tree** (build passes: bindings, keys,
  docking, a11y labels, ArgSpec checks, unreachable panels), **recipe** (validate, migrate, units, preset Amount,
  diff), **op DAG** (domain check, explain/provenance, cost, gamut lint), **kernel program** and **tile plan**
  (CHB-005), **mutation batch** (staleness, approval scope, coalescing). Passes return diagnostics or new IR.
- **One diagnostics producer**: `diag(code, message, { at, facts, fix })`. CraftKit's code families (B, K, D, M, T,
  V) stay; studio-kit adds `CB-*`; contract `ERROR_CODES` are reused. Fixes are computed from the receiver.
- **Explain**: every node, kit and variant can render itself as text (`ck.explain(x)`), for snapshot tests, review
  and the agent ("what is on screen?").

## 6. State and the EditLog

- Document tier: `catalog` (projects, rolls, frames, flags, stars, labels, collections, keywords), `looks`,
  `presets`, `snapshots`.
- **Recipes are not plain store state.** `recipes.<frameId>` is a projection of each frame's `EditLog`. A
  transaction that writes a recipe path is routed to the EditLog (user: apply; agent: propose). The frame id is the
  history *channel* (CraftKit's per-photo history), so the History panel shows that frame's EditLog.
- **Pending agent proposals render as a preview** (visible, not committed) with an approval card; approve commits,
  reject drops; `E_STALE` offers "apply anyway".
- Undo: one global undo that interleaves shell transactions and EditLog undo units, through a history adapter.
- Persistence adapters: CHB-009's IndexedDB/OPFS/File System Access storage; recipe sidecar files next to images.

## 7. Rendering

- `cb.viewer(s => frameOf(s).print(), { tools, overlays, compare })`: the lambda returns a frame *handle* (the same
  vocabulary as the agent DSL: `frame.source() / scan() / negative() / print() / display()`); the bridge compiles
  the recipe (`compile(recipe)`, content-addressed node ids) and evaluates through the `Engine` interface.
- Scheduling: CHB-009's RenderScheduler (latest wins, monotonic presentation, draft → screen → refine, abort) plus
  CraftKit's slots, epochs and live/bg lanes; proxy-size renders while a gesture previews.
- Presenter: CHB-009's WebGPU Display-P3 rgba16float presenter with the Canvas2D fallback.
- Thumbnails and contact sheets: θ per item on the bg lane, cached by node id (content addressing gives the key).

## 8. One vocabulary for UI and agent

Variant code and agent eval code use the same handle vocabulary and op names (registry-driven methods,
`frame.print({ time_s })`, `frame.edit({...}, { why })`). The DSL runs in QuickJS (CHB-007); studio-kit builds the
same handles host-side. Diagnostics share codes. The agent can read `ck.explain(currentVariant)`.

## 9. A variant, for flavour (sketch)

```js
import { defineVariant } from '@chromobench/studio-kit'
import { rollKit } from '@chromobench/studio-kit/kits/roll'

export default defineVariant({
  id: 'darkroom', label: 'Darkroom first',
  build: (ck, cb) => ck.shell('Chromobench')
    .use(rollKit)
    .theme('chromogen')
    .module('print', m => m.label('Print').key('D')
      .left(ck.dock.column({}, cb.panel.filmstrip(), cb.panel.history()))
      .center(cb.viewer(s => cb.frame(s).print(), { tools: ['dodge', 'burn', 'test-strip'], compare: true }))
      .right(ck.dock.column({},
        ck.panel('enlarger', { title: 'Enlarger' },
          cb.arg('print.enlarger.time_s').testStrip({ step: '1/3 st' }),
          cb.arg('print.lights.logH').pad(),
          cb.arg('print.grade')),
        cb.panel.approvals()))),
})
```

## 10. Reuse and migration

- From CraftKit Studio (`CHB-016/sources/craftkit-studio`): the shell (port), and the Studio modules as patterns:
  Library (grid, loupe, compare, survey, flags, collections), Cull, Develop (generated panels, presets with Amount,
  Sync, snapshots, reference + Match), Export queue, Prepress (soft proof, densitometer, gamut).
- From CHB-009 (`apps/studio`, React): keep the framework-free modules (`src/core`, `src/present`, `src/storage`,
  the RenderScheduler, darkroom-tool logic, units) and their tests; replace the React components. CHB-009's open UI
  tasks move to CHB-019.
- Not ported: the CraftKit Workbench engine as colour core (sRGB). Its retouch ops are a CHB-022 option, pending a
  licence/ownership answer.

## 11. Testing

- Every variant builds headless in Node (no DOM): zero error diagnostics, UI-tree `explain` snapshot.
- Kits: unit tests for passes and commands; Playwright smoke per variant (open fixture, change a control, undo,
  approve a proposal).
- CraftKit's own tests (`test/core.test.mjs`, `keys.test.mjs`, `engine.test.mjs`) port with the shell.

## 12. Ticket boundaries and order

| Ticket | Owns | Depends on |
|---|---|---|
| CHB-016 | the API design guide: concepts, reference sketch, examples simple → complex, decision records | — |
| CHB-018 | `packages/shell` | CHB-016 (design), CraftKit sources |
| CHB-019 | `packages/studio-kit` core, `apps/studio` host, four variants, CHB-009 migration | CHB-018 |
| CHB-020 | roll kit: roll setup, first print, roll balance, contact sheet | CHB-019; CHB-006, CHB-003, CHB-010 |
| CHB-021 | looks kit: parameterised looks, presets with Amount, survey, diff, apply to selection/roll/library | CHB-019; CHB-012 |
| CHB-022 | finish kit: crop and straighten, heal and clone, finishing tones | CHB-019; CHB-006, CHB-011 |
| CHB-017 | non-UI close-out: contract 0.2, one physics for all engines, merge to main | — |

All UI tickets can start against the mock engine and against the API sketches in CHB-016 before CHB-018 lands.
