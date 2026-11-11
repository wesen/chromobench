# CraftKit Studio — CraftKit Shell v1

CraftKit Studio is the first working version of the CraftKit Shell, and its acceptance test: a professional photo
and print studio whose menus, keys, panels, undo, canvas and tools all come from the shell's grammar, and whose
pixels come from the CraftKit engine (LightCraft's develop pipeline and PhotoCraft's filters, compiled to WebAssembly
and run in two workers).

## Modules

| module | key | what it is | design |
|---|---|---|---|
| Library | G | grid, loupe (E), compare (C), survey (N); flags, stars, colour labels, collections, keywords, metadata, Quick Develop, filter bar, user order by drag | U-14 |
| Cull | Alt+C | one photo at a time: P keeps, X drops, the next one comes up; hold C to see the last pick beside it | W-01 |
| Develop | D | LightCraft's settings as panels (Basic, Tone Curve, HSL / Color, Color Grading, Detail, Lens, Transform, Effects, Calibration), presets with Amount, snapshots, per-photo history, crop and straighten (R), spot removal (Q), brush and gradient masks (K, M, Shift+M), white balance picker (W), before/after (\, Y, Alt+Y, Shift+Y), clipping (J), a draggable histogram, a reference view with scopes and Match (Shift+R, Alt+M) | U-02, U-03, U-04, U-15, W-04 |
| Export | Mod+Shift+E | the batch line: a recipe synced to a set, presets, naming, a cancellable queue, one zip | W-02 |
| Prepress | Alt+P | an approval desk: soft proof, plates, ink-coverage heatmap, gamut warning, densitometer, preflight, notes | W-05 |
| Print Shop | Alt+S | zine imposition, the photocopier look, two-drum riso, screenprint separations | S-01, S-02, S-04, S-06 |

## What v1 is made of

| piece | where | notes |
|---|---|---|
| Store with document / view / preview tiers, transactions with inverses, coalescing, per-channel history | `src/shell/core/store.js`, `history.js` | one gesture = one undo step |
| Traced cells with read sets, a path trie, frame lanes (feedback, chrome, render, idle) | `core/track.js`, `core/cells.js` | glitch-free: cells read state, not each other |
| One command table → menus, context menus, toolbars, palette (Mod+K), shortcut sheet (Mod+/) | `core/commands.js`, `ui/chrome.js` | disabled items say why |
| Scoped key maps, springs (Space, Z, held C), build-time key checks | `core/keys.js` | K201–K221 |
| Forms and habits: text, glyph, field, track, choice, plane (curve, wheel, histogram), collection, canvas, container | `ui/forms/*.js`, `ui/habits.js` | scrub, nudge, reset, units and arithmetic, commit, select, reorder, context, why, focus keys |
| Fixed docks: resizable columns, collapsible and solo panels, tab groups, Tab / F5–F8, workspaces per module | `ui/dock.js`, `ui/forms/container.js` | saved per viewer |
| The viewport: zoom, pan, fit, 1:1, compare, overlays, tools as gestures, renders at shown size with stale answers dropped | `ui/viewport.js` | proxy renders while dragging |
| Engine bridge: chains recorded at build, compiled once, holes become inputs | `core/engine.js`, `engine/studio-worker.js` | two workers: live and background |
| Diagnostics in the program's own words and lines | `core/diag.js` | Help ▸ Build Report |
| Autosave of the document tier and the workspace | `shell.js` | per viewer, in this browser |

Help ▸ Shell Reference documents the API; Help ▸ Runtime Inspector shows the machine running (frames, cells,
subscriptions, transactions, renders).

## Left out of v1, on purpose

Floating and tear-off palettes; threaded text frames; the Pen tool and vector editing; smart guides with
equal-spacing; live collaboration; plugins with capability manifests; patches by id across themes, plugins and
user edits; reading runtime handlers' source; per-item θ tracing (v1 calls a row function with the real item);
statecharts for tools (v1 tools are gestures: down, drag, up). See the design's "Version 1" notes.

## Honest limits of this build

- The sample shoot is the Kodak Lossless True Color Image Suite (24 film scans, 768 × 512, released by Kodak for
  unrestricted use). Imported photos live for the session; their edits are autosaved, their pixels are not.
- Colour: the engine works in sRGB; CMYK separations use a grey-component-replacement model, not ICC profiles.
- AI masks (subject, sky, people) need model weights that do not ship here; brush, linear, radial masks do.
- Renders are made at the size they are shown; a drag previews at 384 px and refines when it ends.
- Spot removal uses LightCraft's automatic source when none is set; the overlay shows the spot, not the source it chose.
- Screens for more than two inks are split in the page, not by the engine (`separate(n)` fills two plates).
- Two engine fixes are applied as patches when the worker is assembled (`engine/assemble.mjs`): stack layer options
  in the cache signature, and settings at the top level (treatment, spots, masks, section switches) reaching
  LightCraft. Both belong upstream in the Workbench engine.

## Build and test

```
node build.mjs                       # dist/: index.html, shell/, app/, engine.js, wasm, photos
node test/core.test.mjs              # store, cells, history, proxies
node test/keys.test.mjs              # chords, key checks, field arithmetic
node test/engine.test.mjs            # the engine bridge: chains → one program
node test/e2e.cjs [scenario …]       # Playwright drives the built app: state, the DOM and the pixels
```
