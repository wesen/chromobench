# Filmbench

Everything on screen is made by scripts in this browser. The sliders, the looks, the tiles, the layouts and the agent's tools are all calls to the v2 API, and every script can be opened, edited and run. Start at [main.js](ide:file/main.js); it builds the studio from the other files.

## Where things are

| View | What it is for |
|---|---|
| Files | the virtual file system: built-in scripts, your files, snapshots. Changed built-ins are marked, and **Reset…** restores them. |
| Code | the editor. Run the file with Ctrl/Cmd+Enter, run main.js with Shift+Ctrl/Cmd+Enter. Problems appear under the text, with the code and a suggestion. |
| Console | output of runs, and a REPL on the live bench. `wb`, `ws`, `ctl` and `rig` are already in scope. |
| Workspace | the tiles: renders, mosaics, plots, parades, notes. Tiles have their own dock tree, set by `ws.layout`. |
| Controls | the sliders of the scheme you pick. Hairline sliders, dials, steppers, a colour-balance pad. |
| Layers | looks, adjustments, macros, and the layer stack from base up to pin. |
| Graph | the pipeline as a DAG with stage hashes; click a stage to see its parameters and cache state. |
| History | every mutation with who made it (you, a script, the agent). Undo and redo walk this list. |
| Agent | ask questions about the picture, have it take looks, make presets. Ask mode holds every change for you to approve. |

## Tiling

Every view is a tile in a dock. Drag a tab by its label onto the edge of another tile to split it, onto the middle to join its tabs, or onto the header strip to reorder. Drag a gutter to resize it, or focus it and use the arrow keys. The **+** at the end of a tab strip opens a picker for views that are not on screen. Layouts in the header menu switch the arrangement: Studio, Darkroom, Code, Agent, Inspect. **Save this layout as…** in the same menu keeps the current one under a name. Below 760 px wide the dock shows one tile at a time, with the tab strip as a switcher.

Alt+1 … Alt+9 focus a view in the order of the table above. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo outside text fields.

## Scripts

Files can import each other with relative paths. `import { macros } from './controls.js'` works; so does `export const`, `export function` and `export default`. Imports are resolved from the file system, not the network. Top-level `await` works in the file you run, not in files you import.

A run builds a **bench** (the state) and shows it. The first bench made by main.js becomes the one all views show. A scratch script can make its own bench and then call `use(wb)` to make every view show that one; running main.js again returns to the studio.

```js
const wb  = bench('scratch');
const rig = wb.pipe('default').scene('still').film('kodak_portra_400').enlarger().paper('kodak_portra_endura').scan();
wb.ctl.slider('exposure', { path: 'enlarger.print_exposure', min: 0.6, max: 1.6, step: 0.01 });
use(wb);
```

Globals in every script: `bench`, `use`, `log`, `warn`, `show`, `table`, `clear`, `sleep`, `FB` (the physics), `CV` (image operations), `PLOTS`, `Img`, `V2`, `sample` (ask Claude for a picture or a note), and `ide` (open files and views from code).

## The v2 API in one page

**Bench.** `bench(name)` is the state: a parameter table, layers, presets, a pipeline, a workspace, controls. `wb.apply({ op, … }, by)` is the one way to change anything; the fluent calls below all end in it. `wb.undo()`, `wb.redo()`, `wb.tx(name, fn)` for grouping, `wb.state.hash` for identity, `wb.script()` for the script that rebuilds it, `wb.save()` and `bench.load(saved, scope)` for data.

**Pipeline.** `wb.pipe(name).scene(id).film(id).enlarger().paper(id).scan()`. Each stage is content-addressed: a change reruns only the stages downstream of it. `.fork(name)` copies a pipeline for a what-if. `.stage(name, spec)` adds your own stage with a lambda. Taps read values between stages: `src`, `log_e_film`, `cmy_film`, `log_e_print`, `cmy_print`, `out`. The engine picks fused or staged evaluation by which taps are in use.

**Parameters.** `wb.params` is a store of layers: `base`, `look`, `macros`, `agent`, `pin`, in that order. Each op is `set`, `add`, `mul`, `stops` or `keep`. `wb.param('film.gamma')` reads the effective value. A wrong path is an error with a did-you-mean.

**Controls.** `ctl.slider`, `dial`, `stepper`, `toggle`, `select`, `segmented`, `wheel`, `button`, `choice` make a control bound to a path or to a macro. `ctl.scheme(name, build)` groups controls; `ctl.use(name)` makes one active; the Controls view lists the schemes. `ctl.fromSpec(json)` builds controls from data, which is how the agent adds some.

**Macros.** One gesture driving several parameters: `ctl.macro('warmth', { range: [-1, 1] }).drives('enlarger.y_shift', { gain: -24 })`; call `.drives` again for each further parameter. It takes `gain`, `map` (a function or a table), `curve` and `stops`. `apply(fn, { phase })` is the lambda form. `read` and `calibrate` run the other way.

**Presets and looks.** `wb.preset(name, { kind, desc, ops })` defines one; `wb.preset(name)` reads it. A `look` swaps the stocks; an `adjustment` stacks on top of it. Whatever the sliders show can be saved as a preset with **Save current look…** in the Layers view.

**Workspace.** `ws.tile(id).render(tap)`, `.mosaic(…)`, `.parade()`, `.plot.curves(of)`, `.hist(tap, opts)`, `.text(words)`, `.controls(scheme)`. `.scope({ print: 'kodak_ultra_endura' })` renders a tile as a what-if without touching the bench. `.lens(lens.split(…))` and `lens.diff(…)` change what a tile shows. `ws.dock.set(row(…, col(…)))` arranges tiles; tiles not placed go to the shelf and cost nothing. `ws.layout(name, fn)` stores an arrangement. `ws.probe(name, rect)` names a rectangle; `ws.link([tileA, tileB], 'probe')` shares the probe between tiles.

**Fragments.** `wb.use(fragment)` adds macros, lenses, tiles and notes from a reusable function. Two live in `lib/`.

**Agent.** `wb.agent({ mode: 'auto' | 'ask' | 'read-only', brief })`. In ask mode the agent's changes wait in `wb.pending` until approved or skipped. Everything it does is in History with its name.

**Diagnostics.** Mistakes come back as `E_…` codes with the place, a short reason and, when there is one, a suggestion. The Problems list under the editor reads the same messages.

## The agent

The Agent view sends your question together with pictures from the workbench. Attach or paste a picture into the box to show it something; it sees a reduced copy and can ask for crops and zooms at full detail. It works through a small set of lab calls and then answers:

| Call | Does |
|---|---|
| `lab.state()` | film, paper, scene, layers, what differs from stock |
| `lab.img(tap)`, `lab.crop(region, tap)`, `lab.zoom(region, k)` | pictures from any tap |
| `lab.measure(region)`, `lab.pixel(u, v)` | numbers: Lab means, clipping, luma percentiles |
| `lab.compare(patch)`, `lab.sweep(path, values, measure)` | what-ifs without changing the bench |
| `lab.patches()`, `lab.tone()`, `lab.curves()` | chart readings and curve data |
| `lab.set(path, value)`, `lab.film(id)`, `lab.print(id)`, `lab.reset()` | change the bench (held in ask mode) |
| `lab.preset.create`, `.save`, `.apply`, `.stack`, `.remove` | make and use presets |
| `lab.attachments()`, `lab.attachment(id)`, `lab.useAsScene(id)` | pictures you sent |
| `lab.tiles()`, `lab.keep(id)`, `lab.drop(id)` | the workspace |

Its lab calls appear in the thread, with a Revert on each batch of changes.

To use a picture as the scene: paste it anywhere in the page (not in a text field), drop it on the Workspace, or use **Open a picture…** in the menu at the left of the header, which also lists the built-in scenes. It is reduced to the working size and kept in this browser only.

## Known limits

- The `spectral` scan engine here is a coarse 65³ lookup stand-in for the full spectral path, so differences below a few ΔE are not meaningful.
- Saved scripts that use your own lambdas need the names they close over passed to `bench.load(saved, { … })`.
- The dial is a tick ruler, not a round knob.
- Pixel snapshots (`ws.shot`) cover renders, mosaics and the parade; plots are rasterised through SVG.
- Push/pull gain is a hand-fitted figure (0.12 per stop), not measured from process data.
- Files and looks live in this browser's storage. Clear the site data and they go; use **Export… → Download all scripts** in the header for a copy.
