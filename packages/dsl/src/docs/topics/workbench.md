# The workbench

## The studio is `wb`

Everything the photographer can do in the studio is a command or a change to a document, and everything they can see is a value: `wb` gives you the same commands, the same state and the same screen. The studio answers every `wb` call, so `await` each one, like a measurement. Without the studio (a bare DSL session) `wb` calls are E_WORKBENCH; frames, cuts, edits and looks work as always.

```js fragment
const cmds = await wb.commands('layer.')            // { id, label, args, keys, menu, enabled, why }
const screen = await wb.screen()                    // { layout, module, modules, frame, tool, text, controls }
return { cmds: cmds.map((c) => c.id + (c.enabled ? '' : ' (' + c.why + ')')), module: screen.module, controls: screen.controls.length }
```

## Running commands

`wb.run(id, ...args)` runs the command a key, a menu or a button runs, with the arguments they pass (`wb.commands()` lists them under `keys`). It runs as you, under the photographer's mode: in ask mode a change it makes to a document waits for approval (a card in the chat), in auto mode it applies and stays undoable, in read-only it is refused. Commands that only change the view (a module, the selection, a tool) always run. A command's effect shows in your next eval's `frame` and at once in `wb.state` and `wb.screen`.

```js fragment
await wb.run('module.print')                         // the Print module, as the D key does
const r = await wb.run('frame.rate', 4)              // { ok, how: 'proposed' | 'committed' | 'refused' | 'none', entries }
await wb.set('view.view', 'loupe')                   // a state path, written as the View control writes it
return { how: r.how, current: await wb.state('current'), rating: await wb.state('rating') }
```

## The screen

`wb.screen()` is the mounted layout with live values: `text` is its explain, and each control says what it writes — a document `path` of `frame` (change it with `frame.propose(set(path, v))`), a `state` path (`wb.set`), or a `command` with its `args` (`wb.run`). `await wb.screen().explain()` gives the text alone; `{ module }` asks about another module.

```js fragment
const s = await wb.screen({ module: 'print' })
return s.controls.filter((c) => c.path).map((c) => c.label + ': ' + c.path + ' = ' + JSON.stringify(c.value))
```

## Diagnostics

`wb.diagnostics()` reads the studio's diagnostics journal: what went wrong and how often (a repeated event is one row with its `count`, `first` and `last` time), the commands and edits around it, and the machine it happened on (`environment`: browser, screen, the GPU devices with their adapter, limits, features and losses, the engine, the layout, the service worker). Rows are `{ level, source, code, message, data, frame, count, first, last, session }`; sources are `gpu`, `engine`, `worker`, `decode`, `ui`, `command`, `store`, `agent`, `sw`, `app`. Filter with `{ level: 'warn' }` (warnings and errors), `{ source: 'gpu' }`, `{ text: 'texture' }`, `{ limit: 20 }`; `await wb.diagnostics().explain()` is the summary as text. Rows of an earlier session (kept across a reload) have another `session`.

```js fragment
const d = await wb.diagnostics({ level: 'warn' })
return { errors: d.totals.error, gpu: d.environment && d.environment.gpu, last: d.rows.slice(-5).map((r) => r.code + ' ×' + r.count + ' ' + r.message) }
```

## Writing a layout

A layout is written with the same `ck` and `cb` as the studio's own layouts, and its build runs here, in the sandbox, on recording proxies: every call becomes data that the studio replays on its builders. So the layout can be kept on `mem`, revised and built again. `wb.layouts.build` answers with the studio's verdict (its passes: missing panels, stages a module shows without declaring them, unknown names) and the built layout's explain and controls.

Functions do not cross. Where the studio's layouts use a lambda of the state, write a selector — `cb.sel.frame.print()` is `s => cb.sel.frame(s)?.print()`, `cb.sel.doc.not()` is "no document"; `.eq(v)`, `.or(v)` and `.where({ flag: 'pick' })` combine — or a state path, `cb.state.view.step`. A handler is a command id, `'frame.pick'` or `['frame.rate', 3]`. Build-time choices are plain JavaScript (`map`, `?:`, `.with(s => …)`).

```js fragment
const b = await wb.layouts.build({
  id: 'just-print', label: 'Just the print',
  build: (ck, cb) => cb.studio('Chromobench').menus(...cb.menus.standard())
    .module(ck.module('main', { label: 'Print', stages: ['darkroom'] })
      .center(cb.viewer(cb.sel.frame.print(), { tools: ['probe'] }))
      .right(ck.dock.column({ width: 300 }, cb.panels.controls('darkroom'), cb.panels.history().hidden(cb.sel.doc.not())))),
})
mem.layout = b.layout
return { ok: b.ok, errors: b.errors, warnings: b.warnings.map((w) => w.code) }
```

A lambda where an option goes is refused at once, with the selector form as the fix:

```js error=E_LAYOUT
return await wb.layouts.build({ id: 'x', label: 'X', build: (ck, cb) => cb.studio('X').module(ck.module('m', { label: 'M' }).center(cb.viewer((s) => cb.sel.frame(s)))) })
```

`wb.layouts.use(layout, { why })` asks the photographer to switch to it; their frames and history stay, and View ▸ Layout switches back. `wb.layout()` says which layout is on screen.

```js fragment
return await wb.layouts.use(mem.layout, { why: 'only the print and the enlarger, as you asked' })
```

## Writing a look

`cb.looks.define(src)` registers a look written as a `.cblook.js` source — `defineLook({ name, version, label, group, doc, params, stages, fn })`, where `fn(params, input)` returns the layers per stage — here and in the studio. It runs in a sandbox of its own (no clock, no randomness), and a document stores only its name and version. A changed look is a new version.

```js
const d = await cb.looks.define("defineLook({ name: 'doc-warm', version: 1, label: 'Doc warm', group: 'Mine', doc: '', params: {}, stages: ['darkroom'], fn: () => ({ stacks: { darkroom: { order: ['f'], items: { f: { kind: 'layer', op: 'filter', params: { logH: [-0.04, 0, 0.04] }, name: 'Warm', enabled: true, amount: 1, mask: null, blend: 'normal', source: { kind: 'look' } } } } } }) })")
const v = cb.looks.whatIf(frame, 'doc-warm')
return { look: d.name, layers: v.diff }
```
