# Filmbench IDE — analysis (subagent report, CHB-001)

References: `JS:N` = line in `various/extracted/filmbench-ide/01-inline.js`; `vfs/...` = built-in file extracted by `scripts/05-extract-filmbench-vfs.py` to `various/extracted/filmbench-ide/vfs/`; `doc:N` = line in `~/Downloads/Filmbench API v2 — pipelines, control schemes, workspace.md` (context only, not imported). Verified in code unless marked **inferred**. Data blob decoded by `scripts/06-decode-filmbench-film-data.py`; summary in `various/extracted/filmbench-ide/film-data-summary.json`.

## 1. What the app is

A browser IDE around a JS port of the open-source **spektrafilm** spectral pipeline (scene → film exposure → development → enlarger → paper → scan; `JS:2-4`, `JS:4650`). Code is a stack of IIFEs: engine `FB` (`JS:1-701`), image kit `CV.Img` (`JS:703-1034`), SVG plots (`JS:1036-1102`), the v2 runtime `V2` in five parts (`JS:1107-2913`), the IDE UI parts 0–8 (`JS:2915-5121`), and a 61 KB line defining the built-in virtual file system (`JS:5123`). Engine and runtime are DOM-free (need only `performance.now`, `atob`/`Buffer`, `TextEncoder`) and export via `module.exports`.

**Layout.** Ten views — Files, Code, Console, Workspace, Controls, Layers, Graph, History, Reference, Agent (`JS:4915-4926`) — in a tiling dock (`JS:3390-3585`) with five preset layouts (`JS:4928-4936`). Header: scene/stock, Looks, Layout, state-hash pill, undo/redo, "Run main.js", Export (`JS:4996-5047`). Boot inflates the data blob and runs `main.js` (`JS:5102-5118`).

**Editor.** Plain JavaScript ES modules; the "DSL" is a fluent API in globals. Files in a localStorage VFS (`JS:3047-3072`); `import`/`export` rewritten to `__require` keeping line numbers (`JS:3074-3095`); each file runs as an `AsyncFunction` inside `with(scope)` (`JS:3264-3274`); syntax bisection (`JS:3107-3141`) and completion for taps/paths/stocks (`JS:3645-3670`). `vfs/main.js` builds the studio: one pipeline, probes, two fragments, presets, three control schemes (engineer/darkroom/colourist), tiles, layouts, `wb.agent({mode:'ask'})`. `vfs/examples/01..20` mirror the design doc's 20 examples.

**Agent.** An LLM chat via the claude.ai artifact capability `window.claude.use('sample')` (`JS:5085-5090`); each step `sample(turns, {modelTier, effort, images, onText, signal})` (`JS:4841-4844`).

- No native tool calling: the model replies with one fenced `eval` block, extracted by regex (`JS:4845`) and run as an async function body with `wb, ctl, ws, rig, lab, lens, op, p, units, Img, CV, FB, PLOTS` in scope, 25 s timeout (`JS:4731-4737`).
- Results return as YAML text capped at 9 KB (`JS:4721-4725`). `lab.look()` queues images with a burned-in id band, ≤6 per step (`JS:4537-4545`). ≤10 steps per turn; older steps compressed (`JS:4448`, `JS:4836`).
- Modes: in ask mode, mutations tagged `by:'agent'` queue in `wb.pending` (`JS:2325-2328`) for approve/skip after the step (`JS:4856-4859`); writes outside the log need up-front approval, detected by regex on the code (`JS:4449`, `JS:4853`); per-step Revert (`JS:4865`).
- System prompt (`JS:4648-4707`) is a complete tool manual. Users can attach reference photos (`JS:4466-4499`).

"Stage" means a pipeline stage (built-in kinds plus `wb.stage()` custom stages, `JS:1627-1656`, `JS:2175`; **inferred** from usage), not a panel. Visual surface = Workspace tiles: `render(tap)`, `hist`, `plot.curves`/`plot.line`, `scope.parade`, `table` over probes, `mosaic` over two axes, text, controls (`JS:2840-2891`, renderers `JS:3910-4026`); draft render while dragging (`JS:3833-3858`).

## 2. Scripting API

`bench(name)` returns a proxy with typo diagnosis (`JS:2481`). All changes go through `wb.apply({op,…}, by)` (`JS:2323`).

- **Bench `wb`** (`JS:2203-2503`; real op set `JS:2341-2375`, `JS:2691-2716`): build — `pipe`, `graph`/`graph.of`, `stage`, `preset`, `axis(path, values|[from,to,step])`, `compare(variants)`, `use(fragments)`, `set`; edit — `apply`, `tx`, `undo`/`redo`, `pending`/`approve`/`skip`/`approveAll`, `agent`, `ask`; state — `state.hash`, `log`, `script()`, `save()`, `bench.load(saved, scope)`, `bench.run(script)`; scenes/stocks — `addScene`, `stock`, `stockIds`.
- **Pipeline `rig`/`Net`** (`JS:1458-1739`): `.scene(id).film(id).enlarger(opts).paper(id).scan()`. Typed taps: `src` Scene, `log_e_film` LogExposure, `cmy_film` Density, `log_e_print` LogExposure, `cmy_print` Density, `out` RGB (`JS:1430`). Engine slots `swap`/`engine`, `explain()`. Structure: `insert(stage, {after: tap})` with port-type check, `remove`/`drop`, `fork`, `set` (param overlay). Run: `eval(tap, {scope, w, h, max})` → `{img, at(tap), ms, notes}`. Inspect: `diff`, `keys`, `nodes`/`edges`, `hashIR`, `toDot`, `node(id).source`, `irDiff`.
  - Execution: one fused per-pixel loop when no middle tap is read (`JS:1670-1682`); otherwise recursive stage evaluation through a 360 MB LRU cache keyed by a hash of each stage's parameter slice plus input keys (`JS:1596-1626`), so forks and mosaics share work.
- **Graph** (`JS:2141-2172`): `g.scene`, `g.film(..).from()`, `g.enlarger(o).from().through(mask)`, `g.mask(name, px=>0..1)`, `g.sum(name, …logE)` (linear addition), `g.paper`, `g.scan`, `g.compile(out)`.
- **Custom stage**: `wb.stage(name, {from, to, params: {k: p.slider({path…})}, build(P), eval(px,P,B), run(ctx)})` (`JS:2175-2192`).
- **Parameters**: 44 rows in 8 groups with range, unit, log and enum info, plus coercion (`JS:1214-1316`).
- **Control plane** (`JS:1796-2117`): layer fold base→look→macros→agent→pin with ops `set`/`add`/`mul`/`stops`/`keep` and opacity (`JS:1806-1816`); `ctl.why(path)`; widgets `ctl.slider|toggle|select|segmented|stepper|choice|button|wheel` with `.label .unit .range .step .detents .fmt .widget .requires .opens .disabledWhen`; `ctl.macro(name,{range}).drives(path,{gain|curve|map|stops}).apply(fn,{phase}).read(fn).calibrate({measure})`; `ctl.scheme`/`use`/`fromSpec`/`audit`; `ctl.layer(n).use/off/opacity/bake`; `ctl.pin`.
- **Workspace** (`JS:2629-2913`): `ws.tile(id)` with `.scope({…})` what-ifs, `.lens()`, `.crop(probe)`, `.zoom(k,{at})`, `.match('midgray')`, `.on('pick')`; `ws.dock.set(...)`, `ws.layout(name, fn)` `.use/.json`, `ws.probe`, `ws.link`, `ws.attach` (ephemeral agent tiles), `keep`/`drop`, `audit`. Lenses: clip, zones, diff, split, falseDensity, custom (`JS:2543-2596`).
- **Helpers**: `p`, `op`, `units`, `interp`, `curve1D`, `zoneOf`, `fragment(name, {params, macros, controls, lenses, tiles, decorate, methods, agent})` (`JS:2424`). ~36 `E_…` diagnostic codes with did-you-mean (`JS:1131-1176`).
- **Agent `lab`** (`JS:4505-4631`): read — `state`, `img`, `crop`, `zoom`, `measure`, `pixel`, `look`, `shot`; what-ifs — `compare(patch)`, `sweep`, `patches` (ColorChecker ΔE00), `tone`, `curves`, `vs('A1')`; change — `set`, `film`, `print`, `reset`, `preset.save/create/apply`; files — `write`, `export`, `useAsScene`. Full `CV.Img` kit in scope (`JS:726-958`).

**Versus the API v2 design doc.** The doc calls itself an unimplemented sketch (`doc:5`); the IDE implements nearly all 20 examples. Differences: (1) `measured` paper engine only disables the morph and the `spectral` scan engine is a 65³ LUT (`JS:1586-1587`), against measured curves / per-pixel spectral scan in the doc (`doc:176-177`); (2) op names differ from the doc's closed table (`doc:790-795`), and `rig.insert/drop/fork/engine()` bypass `apply` (not logged, not undoable, `JS:1522-1563`); (3) `lab.set` writes the base layer, not the agent layer (`JS:4602`, `JS:2342`); no `lab.ws`/`lab.ctl`/`lab.pending`; (4) `wb.save()` is just `{v, name, hash, script}` (`JS:2401`), no `E_CLOSURE`, `wb.ask` returns nothing; (5) `toGraph`/`toPipe`, `.with()`, plot `.overlay()` missing; (6) `ws.link` and `ws.refresh.policy` stored but unread.

## 3. Simulation model (`JS:1-701`)

- **Grids**: 81 samples 380–780/5 nm; 256 log-exposure samples over [−3, 4]; baked LUTs film raw 64×64×3, enlarger 25³, scan 33³ (or 65³); `buildPlan` memoises each table by the parameters it depends on (`JS:325-412`).
- **Exposure**: RGB→XYZ via `rgb2xyz_cat16[ref]`; (u,v) = ((1−x)², y/(1−x)); bilinear 64² LUT; raw_c = 2^LUT · (X+Y+Z) · 2^speed_c (`JS:154-178`). Auto-exposure meters to 0.184 with 5 metering modes (`JS:468-487`).
- **Halation (simplified)**: linear exposure blended with a Gaussian blur of itself, σ 65 µm still / 50 µm cine, strengths by use and anti-halation type, e.g. R/G/B [.015, .005, 0] for strong AH (`JS:563-572`).
- **Development** (`JS:181-226`, `JS:578-612`): normalised measured curves; gamma scales the log-exposure axis; DIR 3×3 donor→receiver matrix (hard-coded); "pre-DIR" curves by resampling on a shifted axis; per pixel D = dc0(logE − Σ silver·M) with optional spatial blur `diffusion_um`. Grain: Gaussian noise blurred by grain size, scaled 0.0045·48/pixel_µm, modulated by √((d+.04)(1−d/dmax)) — not a particle model.
- **Enlarger**: light = lamp SPD × Π_k[1−(1−F_k)(1−10^(−CC_k/100))]; CC = neutral filtration from the `[paper][film]` table + user shifts; E_c = Σ 10^−(Σ chan·cmy + base) · L · S_paper,c, normalised to put mid-grey at a fixed point, with EV compensation (`JS:137-151`, `JS:352-381`).
- **Paper**: parametric sum of 3 cumulative normals per channel (`JS:237-281`, `JS:382`); optional "morph" for grade (rescale σ and centres); "exhaustion" blends a Gumbel CDF re-centred by bisection.
- **View/scan**: reflectance × view illuminant (D50, or K75P for cine print) → CIE 1931 XYZ; glare adds a % of illuminant XYZ (`JS:384-410`); `xyz2rgb[view]`; "soft" gamut map (desaturate negatives, p=3 shoulder above 0.8) then sRGB transfer (`JS:415-431`, `JS:632-649`).
- **Slides** scanned directly, skipping enlarger/paper (`JS:327`).
- **Not modelled**: scan inversion, B&W stocks, ICC.

## 4. Embedded data

base64 → zlib → 893 KB JSON: `wl[81]`, `cmf[81,3]`; illuminants D50, D55, D65, T, K75P, TH-KG3; `dichroic[81,3]`; `rgb2xyz_cat16`, `xyz2rgb`, `illuminant_xyz`; `neutral_filters` for 8 prints × 20 films ([C,M,Y] CC); 28 profiles, each with `logSens[81,3]`, `chan[81,3]`, `base[81]`, `curves[256,3]`, 3×3 `model` (centres/amps/sigmas), `nanRows`, metadata (type, support, use, anti-halation, ref/view illuminant, target_print, role). Films also have `lut` (12,288 int16 = 64×64×3 log2/1024).

- Films (20): Portra 160/400/800/800 Push 1/Push 2, Ektar 100, Gold 200, UltraMax 400; Fuji Pro 400H, C200, X-Tra 400; Vision3 50D/250D/200T/500T, Verita 200D; slides Ektachrome 100, Kodachrome 64, Velvia 100, Provia 100F.
- Prints (8): Portra/Ultra/Supra Endura, Endura Premier, Ektacolor Edge, Crystal Archive Type II, Vision 2383, Premier 2393.
- No B&W data. ColorChecker values (`JS:1104`) and two procedural scenes (chart, HDR still life, `JS:1321-1367`) are in the JS.

## 5. Image I/O

- Input: `IDE.usePicture` (`JS:4382-4392`) — browser-decodable JPEG/PNG/WebP, downscaled to ≤1100 px, 8-bit, sRGB→linear, used as the scene. No RAW, no 16-bit/TIFF/EXR, no camera colour, no negative inversion. Agent attachments ≤1280 px.
- Output: `IDE.exportImage` — 8-bit PNG/JPEG/WebP via `canvas.toBlob`, 256–3200 px, any tap (`JS:4635-4642`, `JS:5032-5037`); larger exports upsample the working scene and recompute grain at the new pitch. A 16-bit PNG encoder exists (`JS:1021`) but is unused. Scripts export as JS/JSON; everything persists in localStorage.

## 6. Prototype status and reuse

**Unfinished**: stand-in engines; simplified grain/halation/gamut; hard-coded DIR/halation/grain constants; preview resolution only with spatial effects tied to pixel pitch; single-threaded; "dodge and burn" opens a non-existent "mask editor" tile (`vfs/controls.js:70`); link kinds, fragment tile templates and `extends` inert; ephemeral agent tiles never auto-dropped; mutation-log gaps and agent-writes-base-layer (above); agent safety is cooperative only (agent code is arbitrary page JS and could flip `V2.by`); `docs/reference.md` describes non-existent APIs (`wb.param`, `ctl.dial`, `ws.shot`, an options form of `ctl.slider`); bugs — paper completion uses role `'paper'` but the role is `'print'` (`JS:3666`), duplicate dead `case 'pipe.scene'` (`JS:2370`).

**Reusable for the goja product (agent's opinion)**: closed mutation-op set with `by` tags, ask/auto/read-only modes, pending queue, transactions, undo, state hash vs log hash — enforced in Go so the op set is the security boundary; typed taps with checked insert points (a negative-scan source enters at `Density`, a RAW source at `Scene`); parameter table with did-you-mean diagnostics; layer/op algebra with `why()` provenance; darkroom macros in `vfs/controls.js` (print stops, CC filtration, grade, push/pull, warmth, tint) and calibration; masked enlarger exposure + `sum` for burn/dodge, flashing, split-grade; mosaic over an axis for test strips/contact sheets; what-if `scope` and the `lab` vocabulary (`compare`, `sweep`, `patches`, `tone`, `vs`); system prompt as tool manual; parameter-slice cache keys; custom stages and fragments with build/eval/run phase guards. Port per-pixel math to Go (goja is an interpreter; **inferred**).

**To build new**: RAW decode and camera colour, negative-scan inversion, full-resolution tiled rendering with grain defined at print size, float/16-bit and ICC output, a real measured-paper/spectral engine, B&W stocks, local mask authoring.
