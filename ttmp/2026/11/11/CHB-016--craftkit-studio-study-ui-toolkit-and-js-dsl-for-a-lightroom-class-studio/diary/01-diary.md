---
Title: Diary
Ticket: CHB-016
Status: active
Topics:
    - ui
    - dsl
    - architecture
    - product
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T12:56:23.553762403-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-016 CraftKit Studio study

## Step 1: Import CraftKit Studio v1 into a new ticket

The photographer's app needs more than the darkroom: Manuel wants a full Lightroom replacement for his dad and a UI
toolkit plus JS DSL that make it cheap to try different versions of the UI. He pointed at `craftkit-studio`, which
no earlier ticket or analysis had looked at. This step creates ticket CHB-016 and imports the code; the study
itself starts in Step 2.

The zip was found in `~/Downloads` (two byte-identical copies). It is a plain-ES-module app: the CraftKit Shell v1
(`src/shell`), the Studio modules (`src/app`: Library, Cull, Develop, Export, Prepress, Print Shop), an engine bridge
to the CraftKit Workbench engine (`vendor/wb`, three wasm crates run in two workers), docs and Playwright scenarios.

### Prompt Context

**User prompt (verbatim):** "did we already look at craftkit-studio?", then "so ideally, I would like to have a UI
toolkit and JS DSL to also create different versions of the UI quickly for a full lprofessional lightroom
replacement for my dad, allowing us to experiment with different ways of working with the images, from the
development part, to more traditional retouching potentially (layers, standard lightroom tools, etc...), to export,
to comparing presets versions, applying to the liibrary, etc... Study the craftkit studio codebase and see how much
this would be portable over / what JS API design we could extract from it. Report here in the chat at first, so I
can crossvalidate your findings before doing a real design.", then "import the code into the sources folder of a new
ticket, btw.", then "commit at appropriate intervals and keep a detailed diary as you work (using the diary format
from the skill). If you spawn subagents, have them use the diary format too, but I think we can keep it to this
thread."

**Assistant interpretation:** Create a ticket, import the CraftKit Studio code as source material, study it for what
can be ported to chromobench and what JS API (UI toolkit and DSL) can be extracted, and report findings in chat
before any design document.

**Inferred user intent:** Decide, on evidence, whether chromobench's Studio (CHB-009) and DSL (CHB-007) should grow
from CraftKit's shell and builder grammar instead of the React-19 plan in the CHB-009 guide, and to what extent.

**Commit (code):** see the commit that adds this step — "CHB-016: ticket, CraftKit Studio v1 sources, diary step 1"

### What I did

- `grep -ril craftkit ttmp packages apps` in the repo: no hits. Searched the earlier transcript: the only hit was the
  question itself. `find ~/code ~/Downloads ~/Documents -maxdepth 4 -iname '*craftkit*'` found
  `~/Downloads/craftkit-studio-v1.zip` and `craftkit-studio-v1(1).zip`; `cmp` says identical.
- Extracted a working copy to the session scratchpad; read `docs/README.md`, `docs/SHELL.md`, `build.mjs`,
  `src/app/main.js`, `src/app/engine-graphs.js`, `src/shell/core/engine.js`, `engine/studio-worker.js`,
  `engine/assemble.mjs`.
- `git switch -c task/chb-016-craftkit-study` (from `task/chb-002-contract` at 1641d4b, which carries all tickets).
- `docmgr ticket create-ticket --ticket CHB-016 --title "CraftKit Studio study: UI toolkit and JS DSL for a
  Lightroom-class studio" --topics ui,dsl,architecture,product`; `docmgr doc add --ticket CHB-016 --doc-type diary
  --title "Diary"`.
- Unzipped into `sources/`, then removed `dist/` and `test/perf/www/` (duplicates) and the zip itself; wrote
  `sources/README.md` with the zip's sha256 and what was left out. 127 files, 11 MB.
- `docmgr doctor --ticket CHB-016`: all checks passed.

### Why

- A new branch off `task/chb-002-contract` because the main checkout was on that branch and it holds every ticket;
  the study does not touch code, so it merges trivially.
- Dropping `dist/` and the perf copy keeps 7 MB of duplicated wasm and photos out of git; `build.mjs` regenerates
  `dist/`. The wasm crates in `vendor/wb/dist` stay, since the code cannot run without them.

### What worked

- The ticket and the import; doctor clean.

### What didn't work

- `cat a; echo =====; cat b` in zsh failed with `(eval):1: ===== not found` (zsh expands a word starting with `=`
  as a command path). Quoted the separator (`echo '-----'`) and re-ran.

### What I learned

- CraftKit Studio is Manuel's own work (docs name the CraftKit Shell design, LightCraft, PhotoCraft and the
  Workbench engine; design ids U-02…U-15, W-01…W-05, S-01…S-06). Its docs describe it as the shell's acceptance
  test: menus, keys, panels, undo, canvas and tools all come from one builder grammar.
- It is already a Lightroom-shaped app: Library (grid, loupe, compare, survey, flags, stars, collections, Quick
  Develop), Cull, Develop (LightCraft panels, presets with Amount, snapshots, per-photo history, crop, spot removal,
  brush/gradient masks, WB picker, before/after, reference view with Match), Export (batch queue), Prepress (soft
  proof, densitometer, preflight) and Print Shop.

### What was tricky to build

- N/A (import only).

### What warrants a second pair of eyes

- Whether the CraftKit Workbench engine (`vendor/wb`, wasm crates) may be vendored into chromobench beyond this
  reference copy; its licence is not stated in the zip.

### What should be done in the future

- Step 2: study the shell core (store, cells, history, commands, keys), forms, viewport, the Develop module and the
  engine bridge, and map them onto chromobench's contract, DSL and Studio plan.

### Code review instructions

- `sources/README.md`, then `sources/craftkit-studio/docs/README.md` and `docs/SHELL.md`.

### Technical details

- Zip sha256 `c7666aced5613a3ae03566a981945f06ced7e337e8466c2ad054fe1e83343a1e`; 275 entries, 32 116 431 bytes
  unpacked; 127 files kept.

## Step 2: Study the shell, the Studio modules and the engine bridge; map them onto chromobench

This step reads CraftKit Studio for two questions: how much of it can move into chromobench, and what JS API (UI
toolkit and DSL) can be extracted from it. The short answer recorded here: the shell (about 3 900 lines of plain ES
modules, no dependencies) is a good UI toolkit for a Lightroom-class app and ports almost whole; the Studio modules
port as patterns; the vendored CraftKit Workbench engine does not replace chromobench's colour core (8-bit-ish sRGB
working space) but its retouching ops are a candidate layer. The findings went to the user in chat for
cross-validation before any design doc.

### Prompt Context

**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Study, then report in chat; no design document yet.
**Inferred user intent:** Have evidence to decide the Studio's toolkit and the shape of the UI/DSL API.
**Commit (code):** see the commit that adds this step — "CHB-016: diary step 2, study findings"

### What I did

- Read `src/shell/index.js` (the whole `ck` namespace), `src/shell/core/store.js` (tiers, strip, PathIndex trie),
  `history.js`, `track.js`, `core/engine.js` (expression proxies, `compileGraph`, `Engine` bridge),
  `engine/studio-worker.js`, `engine/assemble.mjs` (four patches to the Workbench engine), `src/app/main.js`,
  `engine-graphs.js`, `develop.js` (panels), `develop-model.js` (control specs → paths, `effective`, `scalePreset`,
  `SYNC_GROUPS`), `develop-tools.js` (crop tool), the heads of `vendor/wb/*.js` and the slot table of
  `ui/forms/basic.js` (`slider`) and `ui/viewport.js`.
- Counted ops in `vendor/wb/ck-catalog.js`: 81 image, 18 mask, 8 field, plus path/shapes/text/pages/clip/audio/
  scene/sketch/table/json/list.
- `wc -l`: shell 3 893 lines (largest `shell.js` 486, `viewport.js` 370, `basic.js` 327, `store.js` 312,
  `chrome.js` 312); app 3 900 lines (`printshop.js` 928, `prepress.js` 784, `export.js` 617, `develop-tools.js` 392,
  `library.js` 375, `develop.js` 308).
- Ran the Node tests on the scratch copy (Node v24.18.0): `node test/core.test.mjs` → "core: … passed",
  `node test/keys.test.mjs` → "keys and fields: all passed", `node test/engine.test.mjs` → "engine graph: all
  passed". Did not run the Playwright e2e (needs `node build.mjs` and a browser).
- Listed chromobench contract exports (`packages/contract/src/*.ts`) for the mapping, and checked the CHB-009
  worktree: `apps/studio` depends on `react@19.3.1`; the agent has no commits of its own yet (branch head
  f6290c0 is the cherry-picked restyle).

### Why

- Read the shell core and one full module (Develop) rather than every module: the modules are applications of the
  same grammar, and the question is the grammar and its runtime.

### What worked

- The three Node test suites pass unmodified.

### What didn't work

- No failures in this step.

### What I learned

- **Two DSLs, not one.** (1) The *shell grammar*: `ck.shell(name).state().commands().menus().keys().tools()
  .module()`, `ck.panel/section/row/…`, `ck.ui.slider/curve/wheel/…`, `ck.view.grid/filmstrip/…`,
  `ck.viewport(expr, {tools, overlays})`. Calls record plain nodes `{ $, props, kids, at }` with their call site;
  `.build()` checks them (diagnostic families B1xx, K2xx, D3xx, M201, T4xx, V3xx); `.mount(el)` runs
  Input → Route → Intent → Change → Propagate → Schedule → Draw. Every slot has a binding time: β build,
  τ traced, bind (two-way τ on one path), θ per item, ƒ helper, ρ runtime. (2) The *engine program language*
  (`vendor/wb/ck-runtime.js`): fluent chains recorded into a typed DAG IR checked against an op catalog with
  Levenshtein suggestions, px lambdas traced to WGSL and fused.
- **State model**: one immutable tree, three tiers by top-level key — document (undoable, autosaved), view (free,
  saved with the workspace), preview (a transient layer during a gesture; `commit` makes one transaction). History
  entries have inverses, coalesce by key within 1.5 s, and can be filed per channel (a photo id), giving per-photo
  History panels while the global undo stack is unchanged.
- **Reactivity**: τ lambdas run against a tracking proxy; read sets go into a path trie; a write marks affected
  cells; the scheduler re-runs them once per frame in creation order against one state (glitch-free), in lanes
  feedback → chrome → render → idle.
- **Engine bridge**: `ck.image(s => fileOf(s)).develop(s => devOf(s))` records a chain whose lambda args are
  *holes*; all chains compile once into one program where each hole is an input; a render sends only hole values.
  Requests carry slot + epoch (worker drops superseded, page drops stale), two lanes (`live` worker, `bg` worker),
  proxy renders at 384–448 px while previewing, a 400-entry thumbnail cache.
- **Generated controls already exist**: `devSlider(id)` builds a slider from the crate's control spec
  (`lightcraft-meta.js`: id, label, min, max, step, decimals, default, section, track kind). That is chromobench's
  "controls from ArgSpec" (CHB-009 §5.7).
- **Lightroom features present**: presets with Amount (`scalePreset`: linear from defaults, some keys kept),
  Sync by groups (`SYNC_GROUPS`, `syncSettings`), snapshots, per-photo history, before/after modes (off, before,
  lr, tb, split), reference view with Match, survey view, cull with held-C compare, export queue, soft proof,
  densitometer, gamut warning, preflight.
- **Engine limits**: values are straight-alpha RGBA Float32 in sRGB 0–1; the viewport draws ImageBitmaps on a 2D
  canvas; CMYK uses GCR, not ICC; AI masks need weights that are not shipped; imported photos' pixels are not
  persisted. "FilmCraft" in the catalog is a video app (Lumetri grade, clips), not film emulation.
- The Workbench engine is patched at assembly time (`engine/assemble.mjs`, 4 patches, each must match once).

### What was tricky to build

- N/A (study). The subtle part to carry over is the binding-time discipline: a lambda in a β slot is a build error
  (CK-B140); without it a ported toolkit loses its build-time checks.

### What warrants a second pair of eyes

- **Two undo systems.** chromobench's `EditLog` (per-frame recipe log with provenance, agent `propose`/`approve`,
  `E_STALE`) and CraftKit's `History` (generic patches with inverses, channels) overlap. Proposed split: EditLog
  stays the authority for recipe paths; the store's document tier holds catalog/collections/etc.; a transaction on
  a recipe path routes to the EditLog; the per-photo channel *is* the frame's EditLog. Pending agent proposals map
  onto the preview tier (shown, not committed) — to be validated.
- **Holes vs content addressing.** CraftKit compiles once and sends values; chromobench interns a content-addressed
  node per recipe (`Graph.intern`, `compile(recipe)`, `Engine.adopt`). The bridge's scheduling (slots, epochs,
  lanes, proxy size, thumb cache) ports; its compile step would be replaced by `compile(recipe)`.
- Licence/ownership of `vendor/wb` and the wasm crates.

### What should be done in the future

- User decisions before a design doc: toolkit for CHB-009 (CraftKit shell ported to TS vs React 19, the CHB-009
  agent is mid-flight on React); whether LightCraft develop is a second "digital" path next to the film model;
  whether the Workbench retouching ops are wanted; whether UI variants are code modules or agent-generated.

### Code review instructions

- Start at `sources/craftkit-studio/docs/SHELL.md`, then `src/shell/index.js`, `src/shell/core/store.js`,
  `src/shell/core/engine.js`, `src/app/develop.js` and `src/app/develop-model.js`.
- Validate: `node test/core.test.mjs && node test/keys.test.mjs && node test/engine.test.mjs` in a copy of
  `sources/craftkit-studio`.

### Technical details

- Portability classes (as reported in chat):
  - port nearly as-is (convert to TS): `core/{store,history,track,cells,commands,keys,diag,util}.js`,
    `ui/{node,dom,habits,icons,dock,chrome}.js`, `ui/forms/*.js`, `shell.js`, `index.js`;
  - port with changes: `ui/viewport.js` (WebGPU display-p3 canvas instead of 2D), `core/engine.js` (recipes and
    the chromobench `Engine` instead of the Workbench worker), autosave (OPFS/IndexedDB instead of localStorage);
  - port as patterns: Library, Cull, Develop panels, presets with Amount, Sync, snapshots, compare/survey,
    reference + Match, Export queue, Prepress;
  - keep out of the colour core: `vendor/wb` (sRGB float); candidate for a retouch layer after the print.

## Step 3: Check the user's API guidelines against CraftKit and chromobench

Manuel shared the guidelines he uses for JS APIs and asked how they fit what exists. This step compares each
guideline with the CraftKit shell, the CraftKit engine language and chromobench (contract, CHB-007 DSL, CHB-009
Studio), by reading the DSL's prelude proxies and doc topics on `task/phase1-integration`. Result: the guidelines
describe CraftKit almost exactly; chromobench's agent DSL already follows the runtime half (handles → DAG, edits →
mutations, proxy diagnostics with fixes), and lacks the build half (a builder for UI and for parameterised
looks/presets), user-declared parameters, lambda holes and fragments. The answer went to chat with examples.

### Prompt Context

**User prompt (verbatim):** "here's the guidelines i usually use for apis: Create a JS API based on a fluent builder
pattern around a core grammar of composable components that can be customized with lambdas (that can be run at
build time, but also at runtime depending on the component / grammar), with an IR / DAG pattern, or a more direct
one (say, mutations) if used for runtime stuff like an agent interacting with the environment. You don't need to
build your own parser or interpreter, JS even if not sandboxed is fine. The JS can define parameters (sliders,
etc...). Implementation can use proxy objects to return better diagnostics when the API is used improperly. You
can use \"fragments\" to extend individual components methods / attributes. Output only examples, from simple to
complex, on how to manage this. --- How does that fit what you have." Then, mid-turn: "fluent builder because it
allows us to give back custom feedback that's not just static, but can be richer"
**Assistant interpretation:** Map the guidelines onto the existing code, name the gaps, and show (with examples,
simple to complex) what the API would look like if it followed them.
**Inferred user intent:** Converge on one API philosophy for the UI toolkit, the pipeline and the agent DSL before
the real design.
**Commit (code):** see the commit adding this step — "CHB-016: diary step 3, API guidelines fit"

### What I did

- Read `packages/dsl/src/prelude/prelude.ts` lines 80–175 (handle, namespace, frozen-view and guarded proxies) and
  the `js` blocks of `packages/dsl/src/docs/topics/{getting-started,darkroom-vocabulary,editing-and-approval}.md`.
- `grep -ril fragment` over CraftKit (`src`, `vendor/wb`) and `packages/*/src`: no fragment mechanism in either;
  the only hits are filter names in the Workbench catalog.

### Why

- The DSL's doc examples are executed in CI (49 blocks), so they are the reliable statement of today's API.

### What worked

- Clear mapping; see Technical details.

### What didn't work

- `grep -n Proxy -r packages/dsl/src --include=*.ts` failed in zsh with `no matches found: --include=*.ts` (unquoted
  glob); used `grep -rln "new Proxy" packages/dsl/src` instead. The first attempt also looked for the CHB-016
  sources on `task/phase1-integration`, where the ticket does not exist (`no matches found: ttmp/.../CHB-016--*`);
  used the scratchpad copy.

### What I learned

- The DSL's namespace proxy resolves `area.key` against the op registry (`T.ops[area + '.' + key]`), so adding an
  OpDef already adds a method to every handle of the right domain — registry-driven extension, not user fragments.
- Diagnostics in the DSL are computed from the receiver (`E_DOMAIN` names the fix by how the handle was made,
  `E_NOT_AWAITED`, `E_IMMUTABLE`, did-you-mean on unknown members) — the "richer feedback" the user wants from a
  fluent builder.

### What was tricky to build

- N/A.

### What warrants a second pair of eyes

- Whether parameters inside look/preset lambdas should be symbolic (traced once into a DAG with holes, as CraftKit's
  px lambdas are traced to WGSL) or concrete (re-run per change, cheap because chromobench nodes are
  content-addressed). The examples show the concrete form.

### What should be done in the future

- Design doc for the unified API: one registry (ops, ArgSpecs, components, fragments), two modes (build: DAG + β/τ
  lambdas; runtime: handles + mutations), one diagnostics producer.

### Code review instructions

- Compare `packages/dsl/src/prelude/prelude.ts` (handle/namespace proxies) with CraftKit `src/shell/core/engine.js`
  (`mkExpr`) and `src/shell/ui/node.js` (`defineForm`, slot binding times).

### Technical details

| Guideline | CraftKit shell (UI) | CraftKit engine language | chromobench today |
|---|---|---|---|
| fluent builder | `ck.shell().state().commands().module()` | `ck.image().develop().softProof()` | agent DSL yes; Studio no (React) |
| grammar of components | forms + places | op catalog by kind | 54 ops / 12 areas, domains as kinds |
| lambdas, build vs runtime | β/τ/bind/θ/ƒ/ρ, checked (CK-B140) | holes → inputs; px → WGSL | none; args are values |
| IR / DAG | recorded nodes with call site | typed DAG IR | `Graph.intern`, `compile(recipe)` |
| mutations for runtime | `ctx.tx`, preview/commit | — | `EditLog`, `frame.edit`, approvals |
| no own parser | plain JS | plain JS | plain JS in QuickJS (agent code) |
| JS-defined parameters | `ck.ui.slider(...)` | `ck.ui.input(name, v)` | no; ArgSpec only in contract |
| proxy diagnostics | expr + tracking proxies, build report | suggestions | handle/namespace proxies, fixes |
| fragments | `defineForm`, habits (new components only) | `*.` ops, SUGAR | registry-driven methods only |
