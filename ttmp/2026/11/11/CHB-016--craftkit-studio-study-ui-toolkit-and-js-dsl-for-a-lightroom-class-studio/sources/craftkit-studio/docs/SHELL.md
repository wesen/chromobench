# CraftKit Shell v1 — reference

The v1 shell is the "solid subset" of the CraftKit Shell design: a runtime for professional desktop-class apps
in the browser, built around one store, one command table and opinionated components. This file describes what
is implemented, file by file. `src/app/` (CraftKit Studio) is the worked example; read `library.js` and
`develop.js` next to this.

## The model in one paragraph

An app is **recorded**, then **checked**, then **mounted**. `ck.shell(name)…` builder calls and `ck.panel(…)`,
`ck.ui.slider(…)`, `ck.view.grid(…)` calls only record plain nodes `{ $: form, props, kids, at }` with the call
site that made them (the deep embedding: structure as data). Props that are lambdas are kept as lambdas (the
shallow embedding: behaviour as closures). `.build()` walks everything and reports diagnostics in the program's own
words and lines. `app.mount(el)` starts the runtime loop: **Input → Route → Intent → Change → Propagate →
Schedule → Draw**.

## Binding times

Every slot of every form declares when its value is read.

| mark | name | when it runs | example |
|---|---|---|---|
| β | build | once, while the program builds | `min`, `max`, `step`, `options`, a list of sections |
| τ | traced | as a cell: re-runs when a path it read changes | `label: s => …`, `disabled: s => …`, `items: s => …` |
| bind | binding | τ naming one path; two-way | `bind: s => s.dev[id].light.exposure` |
| θ | per item | called with the real item when its row is drawn | `row: p => …`, `cell: (p, i) => …`, `key`, `children` |
| ƒ | helper | a pure function of the form's own value, or a mount function | `format: v => v.toFixed(1)`, `ck.html(m => el)` |
| ρ | runtime | handlers, called with their arguments then `ctx` | `run: ctx => …`, `activate: (item, ctx) => …` |

A lambda in a β slot is a build error (CK-B140). An unknown option is a warning with a suggestion (CK-B130).

## State: `core/store.js`, `core/history.js`

`.state(init, { view: ['ui', 'view', 'prefs', 'workspace'], version, persist, restore, transient })`

- One immutable tree. Writes copy only the objects along the path, so untouched subtrees keep their identity and
  reference equality is a complete change test. State never holds proxies (they are stripped on the way in).
- **Tiers** by top-level key: `document` (everything not listed in `view`) is undoable and autosaved;
  `view` keys are changed freely and saved with the workspace (`workspace`, `prefs`, `view.module` only).
- **Transactions**: `ctx.tx(label, t => { t.a.b = 1; t.list.push(x); t.$set(path, v); t.$update(path, f); t.$merge(path, o); t.$remove(path, pred) }, opts)`.
  One call is one undo step. Draft arrays support `find`, `filter`, `map` (elements come back as drafts, so
  `t.catalog.photos.find(p => p.id === id).flag = 'pick'` works) and the mutating methods. `t.x.$value` reads
  the plain value.
- **Preview**: `ctx.preview(path | s => s.path, value)` shows a value without changing the document;
  `ctx.commit(label, opts)` turns the whole preview into one transaction; `ctx.cancel()` drops it. Bindings do
  this for you: a slider drag is many previews and one commit.
- **opts**: `coalesce: key` merges consecutive transactions with the same key within 1.5 s (arrow-key nudges);
  `channel: id` + `snapPath: path` also files the step in a per-channel list (a photo's History panel), seeded
  with an "Import" step; `detail` is the value shown next to the label.
- `ctx.set({ view: { mode: 'loupe' } })` merges into view state (document paths in the object become a tx).
- `store.derive(path, fn)` / `.derive('catalog.filtered', s => …)`: a computed path; readers depend on what it
  read.
- `history.undo() / redo() / stepTo(channel, index)`, `history.entries`, `history.channels`.
- Reading in handlers: `ctx.state` is read-only (a write throws CK-T410 and is reported).

## Cells and the frame: `core/track.js`, `core/cells.js`

A τ lambda runs against a tracking proxy; the paths it reads (navigation prefixes dropped, escaped objects kept
whole) are subscribed in a path trie. A write marks the cells whose read set touches the written path; the
scheduler re-checks them once per frame, in creation order, all against the same state (glitch-free). Lanes:
`feedback` (cursor, rubber bands) → `chrome` (cells → DOM) → `render` (engine requests) → `idle` (thumbnails,
histograms, autosave). `scheduler.idle(fn, key)` replaces a queued job with the same key.

## Commands and keys: `core/commands.js`, `core/keys.js`, `ui/chrome.js`

```js
.commands(c => c.add('photo.pick', {
  label: 'Flag as Pick' | s => …,        // τ
  menu: 'Photo', icon: 'pick',
  enabled: s => …, why: 'Select a photo first' | s => …,   // a disabled item says why
  checked: s => …,
  run: (ctx, ...args) => … | 'other.command',
  palette: true, hidden: s => …,
  module: 'library' | ['library', 'develop'],   // shown in menus and the palette only there
}))
.menus(m => m.menu('Photo', ['photo.pick', '-', { label: 'Sub', items: [...] }, { group: 'name' }]))
.keys('global' | 'canvas' | 'module:<id>' | 'panel:<id>' | 'tool:<id>' | 'text' | 'dialog', { 'Mod+Shift+Z': 'edit.redo', P: ctx => … })
.spring('Space', 'hand', { label, tap }) · .spring('C', { down: ctx => …, up: ctx => … }, { while: e => bool })
```

- Menus follow the module, as Lightroom's do: a command with `module` (or a tool, which takes the modules whose
  viewports list it) leaves menus and the palette elsewhere, and a menu with nothing left leaves the bar. Its keys
  are scoped separately (`module:<id>`), so hiding never changes what a key does.
- Scope chain at a keydown, innermost first: `text` (a field has focus; typing wins) · `dialog` (stops the
  chain) · `tool:<active>` · `panel:<focused>` · `canvas` · `module:<current>` · `global`. A module's
  `.keys({…})` goes to `module:<id>`; `module:*` means every module.
- Chords: `Mod` is ⌘ on macOS and Ctrl elsewhere; letters and digits are read from the physical key.
- Build checks: K201 unknown command (with suggestions) · K202 bad chord · K204 conflict in a scope (both
  locations) · K205 a scope shadows a global key · K210 single letter in `global`/`text` · K215 a chord the
  browser keeps · K220/K221 springs.
- Built in: `edit.undo/redo`, `app.palette` (Mod+K), `app.shortcuts` (Mod+/), `app.diagnostics`,
  `view.hideSides` (Tab), `view.hideAll` (Shift+Tab), F5–F8, zoom (Mod+= Mod+- Mod+0 Mod+Alt+0),
  `view.toggle-1:1`, `workspace.reset`, `app.theme` (interface gray), `app.escape` (Esc: cancel a preview, leave a
  tool, show the panels).
- The palette, menus, context menus, toolbars and the shortcut sheet are all generated from the table.

## Places: panels and docks: `ui/forms/container.js`, `ui/dock.js`

```js
ck.panel('basic', { title, switch: s => s.path | { value: s => …, toggle: ctx => … }, menu: [ids], reset: true, fixed, open: false, aside: node }, ...kids)
ck.panel('basic')                                  // a reference, placed in a module
ck.section(title, { reset: true, aside: node, collapsible }, ...kids)   // double-click the title resets its sliders
ck.dock.column({ width, solo, min, max }, ...panels)
shell.module('develop', m => m.label('Develop').key('D').icon('adj')
  .left(column).center(node).right(column).bottom(node).toolbar(node).top(node)
  .keys({...}).txOpts(s => ({ channel, snapPath })).onEnter(ctx => …))
```

Columns resize (drag the splitter, double-click resets), hide (Tab, F5–F8, edge triangles), panels collapse
(click the header), solo (Alt-click). Sizes and open states live in `workspace` per module. Narrow screens float
the columns over the centre. A small app may skip `.module` and call `.center()/.left()/…` on the shell.

Containers: `ck.row/column/stack/bar/scroll(props?, ...kids)`, `ck.grid({ cols }, ...)`, `ck.cell({ span })`,
`ck.spacer()`, `ck.divider()`, `ck.tabs({ Name: node })`, `ck.toolbar([ids | nodes | '-' | '~'])`,
`ck.match(s => key, { key: node, default: node }, { of: [keys] })` (CK-M201 when a case is missing),
`ck.when(s => bool, node, else?)`, `ck.each(list, f)` (β), `ck.hud({ at }, s => text)`, `ck.statusline(τ)`,
`ck.html(m => element)` (escape hatch: `m.cell`, `m.mount`, `m.store`, `m.app`).

## Forms and habits: `ui/forms/*.js`, `ui/habits.js`

| call | form | notes |
|---|---|---|
| `ck.text(τ, { dim, strong, mono, wrap, size })`, `ck.icon(name)`, `ck.stat(τ, { label })`, `ck.kbd('Mod+K')` | text, glyph | |
| `ck.ui.button(label, { run, icon, primary, quiet, small, checked })`, `ck.ui.command(id, opts)`, `ck.ui.iconButton(icon, opts)` | button | a command id brings its label, tip with key, and disabled-with-why |
| `ck.ui.number({ bind, unit, step, min, max, decimals, reset, label, format })` | field | units and arithmetic (`3p6`, `12mm+3pt`, `*2`, `50%`), scrub the label, arrows nudge, reset |
| `ck.ui.textField({ bind, placeholder, multiline, commit: 'live', set: (value, at, ctx) => … })`, `ck.ui.search(opts)` | field | commits to the path it was opened on; `set` gets `at = { state, path }` as they were when typing began (a click elsewhere that moves the selection blurs the field afterwards) |
| `ck.ui.slider(min, max, { bind, label, step, decimals, reset, bipolar, track: 'temp'\|'tint'\|{ from, to }, scale: 'log', unit, format, altPreview, compact })` | track | Lightroom's: drag, click to jump, scrub or type the value, double-click to reset, arrows/Home/End, Shift fine |
| `ck.ui.segmented(options, { bind, small, icons })`, `ck.ui.select(options τ, { bind, compact })`, `ck.ui.checkbox(label, { bind })`, `ck.ui.toggle(...)`, `ck.ui.stepper({ bind, min, max })`, `ck.ui.color({ bind })` | choice | options: values or `{ value, label, icon }` |
| `ck.ui.curve({ bind, channels: { RGB: 'master', Red: 'red' }, parametric: node, backdrop: τ })` | plane | points `{x,y}`; click adds, drag off removes, double-click resets |
| `ck.ui.wheel({ bind, label, lum: true, size })` | plane | `{ hue, sat, lum }`; Shift = sat only, Mod = hue only, Alt = fine |
| `ck.view.histogram(τ {r,g,b,l}, { clip: bind, regions: [{ name, from, to, bind, min, max, step }] })` | plane | drag inside to move the region's slider |

Habits (attach to your own elements): `ck.habit.scrub/nudge/reset/rename/context/focusKeys`, `parseValue`.

## Collections: `ui/forms/collection.js`, `ui/forms/thumb.js`

```js
ck.view.grid(s => s.catalog.filtered, {
  cell: (item, i) => node,                // θ, re-mounted only when the item changes identity
  size: s => s.view.thumbSize, aspect, caption,
  select: { bind: s => s.ui.selection, mode: 'multi' | 'single' | 'none' },   // { ids, primary, anchor }
  keys: { P: 'photo.pick', ...ck.digits(0, 5, 'photo.rate') },              // while the grid has focus
  activate: (item, ctx) => …,             // double-click, Enter
  context: [ids] | (s, item) => [...],
  dnd: { source: 'photo' | item => ({ kind, … }), accepts: 'photo', drop: (dragged, item, ctx) => … },
  empty: τ,
})
ck.view.list / ck.view.filmstrip / ck.view.tree (children: item => [...])
ck.view.thumb({ src: τ url, image: engineExpr, arg: τ item, engine: τ bool, max })
```

Only visible rows exist. Click, Shift-click (range), Mod-click (toggle), arrows, Mod+A, Home/End, Enter.

## The canvas: `ui/viewport.js`

```js
ck.viewport(expr | s => expr, {
  id: 'main', before: expr, arg: τ, dims: s => [w, h],     // the source's size, for 1:1 and proxies
  tools: ['crop', …], overlays: [ck.overlay.custom(kind, read τ, paint(g, vp, value, state))],
  click: 'toggle-1:1', label: τ, hud: node, compare: false, drop: (files, ctx) => …, onRender: (r, vp, ctx) => …,
})
```

- Renders at the size it is shown (× devicePixelRatio, capped by `dims`); while the store is previewing, at a
  proxy size (448 px), then at full size when the gesture commits. Requests carry a slot and an epoch; stale
  answers are dropped.
- View state in `view.vp[id] = { zoom: 'fit' | 'fill' | number, cx, cy }`; `view.compare`: `off | before | lr |
  tb | split`; `view.split`. Wheel scrolls, Alt/Ctrl+wheel zooms at the pointer, middle-drag pans, Space spring =
  hand, Z spring = zoom (click in, Alt-click out, drag scrubs).
- The api (`app.viewport(id)`, and `ctx.vp` in tools): `toScreen(u, v)`, `toImage(sx, sy)`, `scale()`,
  `natural()`, `bitmap()`, `setZoom(z, at)`, `zoomBy(dir, at)`, `fit()`, `redraw()`, `setCursor(css)`, `view`.

Tools: `.tools(t => t.tool(id, { label, icon, key, cursor, enabled, why, on: { enter, exit, escape, hover,
leave, down, drag, up, cancel }, overlay(g, vp, state, gestureState) }))`. `down(e, ctx)` returns the
gesture's state `g` (or `false` to ignore); `drag(e, ctx, g)` may return a new `g`; `up` must end with
`ctx.commit(label)` or `ctx.cancel()` (else CK-T420). `e` has `u, v` (0–1 across the shown image), `ix, iy`,
`sx, sy`, `shift, alt, mod`, `pressure, pen`, `inside`. Every tool gets a `tool.<id>` command (menus, palette,
toolbars). It belongs to the modules whose viewports list it (or `module: 'id'`): its key is bound in those
modules only, and its menu item shows only there; `scope` overrides the key's scope. `ui.tool` holds the active tool;
`ui.toolOptions[id]` its options.

## The engine bridge: `core/engine.js`, `engine/studio-worker.js`

```js
const photo  = ck.image(s => fileOf(s))            // a hole: the input's value is computed per render
const render = photo.develop(s => devOf(s))        // any engine op chains: .softProof(), .separate(2, {…}).at(0)
const thumb  = ck.image(a => a.file).develop(a => a.dev)   // per item: arg is the item
ck.source('stack', ck.solid('#f4efe6', [w, h])).layer(x, { blend: 'multiply' })
```

Every expression recorded anywhere is compiled once, at mount, into one CraftKit program; each lambda hole
becomes an input. `app.engine`:
`values(expr, arg)` · `render(expr, values, { max, lane: 'live' | 'bg', slot, epoch })` → `{ bmp, w, h }` ·
`thumb(expr, values, max)` (cached) · `pixels(expr, values, { max, encode: 'image/jpeg', quality })` →
`{ w, h, data }` or `{ blob }` · `wasm(module, op, args)` · `auto(expr, values)` (LightCraft auto) ·
`declareAsset(name, url | Blob)` (sent to the workers on first use) · `cancel(tag)`.
The ops are the CraftKit engine's (`../REFERENCE.md`): LightCraft develop, PhotoCraft filters, softProof,
separate, halftone, threshold, blackWhite, levels, noise, grain, stacks with blend modes, and more.

## Diagnostics: `core/diag.js`

`app.diagnostics` (Help ▸ Build Report): code, level, title, the call site, the facts, one fix. Families:
I0xx info · B1xx bindings and options (B110 path not in state, B111 parent missing, B112 binding threw, B130
unknown option, B140 lambda in a β slot, B150 menu names a missing command) · K2xx keys · D3xx docking (D301
panel placed twice, D302 unknown panel, D303 module without centre) · L330 a τ lambda threw (runtime) · M201
match not exhaustive · T4xx tools and transactions (T401, T410 write outside a tx, T420 gesture left a preview
open) · V3xx viewport and engine (V302 unknown tool, V310 engine graph did not compile).

## Persistence

`.state(init, { version, persist: doc => smallerDoc, restore: st => fullState, transient: ['compare'] })`. The
document tier, the workspace, prefs and `view` (less its `transient` keys) autosave to this browser's storage
(debounced, on the idle lane, and on pagehide); of `ui` only the keys in `keepUi` (say `['selection']`) are kept.
A version bump starts fresh. `ck.clearSaved(name, version)`.

Undo names where it happened when that is not on screen: `channelName: (channel, state) => name` and
`currentChannel: state => channel` make Mod+Z say "Undo Contrast (on Old pier)".

`ck.keyLabel('Mod+Shift+C')` writes a chord as the platform does (⇧⌘C, Ctrl+Shift+C) for messages and hints.

## Theme

Four interface grays (`prefs.gray`: auto, 1–4; View ▸ Interface Gray), tokens in `shell.css`. Apps style their
own pieces with the same tokens (`--panel`, `--text2`, `--accent`, `--canvas`, `--cell`…).

## Testing

`node test/core.test.mjs` (store, cells, history in Node) · `node build.mjs && node test/e2e.cjs [scenario]`
(Playwright drives the built app; scenarios in `test/scenarios.cjs`).
