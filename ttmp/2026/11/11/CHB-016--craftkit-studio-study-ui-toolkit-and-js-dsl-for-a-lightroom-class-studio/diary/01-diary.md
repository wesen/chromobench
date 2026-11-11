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

## Step 4: Sketch the product: a Lightroom + Negative Lab Pro + Dehancer flow on chromobench

Manuel asked how I would build a Lightroom + Negative Lab Pro + Dehancer kind of app for his dad with everything now
available. This step is a product/architecture sketch, given in chat, no code: one physical pipeline with three
entry points (scanned negative, digital RAW through a virtual negative, optional plain digital develop), a darkroom
vocabulary for the controls, Lightroom's library/compare/sync/export patterns from CraftKit Studio, and milestones
ordered to put a Negative-Lab-Pro replacement in the photographer's hands first.

### Prompt Context

**User prompt (verbatim):** "how woud you build a lightroom + negative lab pro + dehancer kind of flow app for my
dad, given all these tools?"
**Assistant interpretation:** Propose the product flow, the mapping from those three products' features to
chromobench/CraftKit parts, and an order of work.
**Inferred user intent:** A shared picture of the target app before the real design doc.
**Commit (code):** see the commit adding this step — "CHB-016: diary step 4, product sketch"

### What I did

- No commands beyond this diary write; the sketch draws on Steps 2–3, the Phase-1 agent reports (CHB-003, -005, -006,
  -007, -009) and the ticket table in CHB-001's architecture doc.

### Why

- Ordering by "which product does he replace first": scanned negatives are what chromobench's physics is for and
  where Phase 1 is strongest (ingest, conditioning, inversion, print chain, GPU tables), so a Negative-Lab-Pro
  replacement is the shortest path to real use.

### What worked

- N/A (sketch).

### What didn't work

- N/A.

### What I learned

- Lightroom's global sliders split three ways in a physical model: exposure/contrast/white balance become enlarger
  time, paper grade and filtration (print chain); HSL and colour grading have no darkroom equivalent and belong in
  the contract's `finishing.*` ops on print-xyz; local adjustments become dodge/burn (exposure masks) plus finishing
  masks.

### What was tricky to build

- N/A.

### What warrants a second pair of eyes

- Assumptions about the photographer's workflow (current tools, scanner setup, machine, printing) — asked in chat.

### What should be done in the future

- Turn the sketch into the CHB-016 design doc once the toolkit and workflow questions are answered.

### Code review instructions

- N/A.

### Technical details

- Milestones proposed: M2 negative lab (scan → roll → contact sheet → print → export), M3 darkroom (dodge/burn, test
  strips, ring-around, looks, roll sync, compare), M4 film look for digital (CHB-012 forward sim, halation, grain),
  M5 Lightroom parity (finishing, heal, keywords/search, print with soft proof), M6 assistant (CHB-008 chat,
  playbooks).

## Step 5: Intern guide written

This step wrote the CHB-016 implementation guide, "API design: one grammar for the studio UI, looks and the agent". It is the spine that the CHB-018 to CHB-022 guides build on. It fixes the vocabulary and binding times, the registry with its two modes (build mode in the page, runtime mode in QuickJS), seven IRs and the pass API, fragments with deferred calls, kits, one diagnostics producer with computed fixes, `explain`, the recipes projection over per-frame EditLogs with a unified undo, the `defineVariant` contract and host lifecycle, a `ck`/`cb` reference sketch, fourteen examples and five decision records.

The guide follows the shared UI design brief and marks its refinements: a separate patch IR, a shared vocabulary module extracted from `packages/dsl/src/host.ts`, the variant `cb` as a superset of the agent's `cb` (with `compare` left agent-only), projected store keys in the shell, and a host propose hook in the DSL session.

### Prompt Context

**User prompt (verbatim):** "before we move on, now that we have worked out what to do with craftkit, let's create the tickets and design guides (remember, no need to be overly correct in the guides, they are \"guides for impementation\" after all, and we'll sort out details as we work) for the proper UI. Allow the UI to be entirely expressed using the JS API, so that we can create many different versions of it."
**Assistant interpretation:** Write CHB-016's guide, the API design shared by the five UI tickets, with examples from simple to complex, and file tasks, related files and this diary step.
**Inferred user intent:** One coherent API that the parallel UI tickets can implement against, so that whole studios can be written as JS variants.
**Commit (code):** none (the orchestrator commits all guides together).

### What I did

- Read the writer brief, the UI design brief, the earlier guide brief, the writing-style guide, CHB-016 diary Steps 1–4, CraftKit `docs/SHELL.md`, `src/shell/{index,shell}.js`, `ui/node.js`, `core/{diag,store,history,engine}.js`, `src/app/{main,develop,develop-model,develop-tools,engine-graphs}.js`.
- Read `packages/contract/src/{spec,registry,editlog,mutations,errors,graph,recipe,eval,engine}.ts` and the catalog, `packages/dsl/src/prelude/prelude.ts`, the `host.ts` method list, the docs topics (getting-started, darkroom-vocabulary, editing-and-approval, balancing-colour), CHB-007 guide §2.5 and §5.7–5.8, CHB-009 guide §5.1–5.4 and §5.7–5.9, and `apps/studio/src/core/{frame-session,gesture,controls}.ts` and `present/presenter.ts`.
- Wrote `design-doc/01-intern-guide.md`, then did one review pass and fixed the problems it found (listed under What was tricky).
- `08-check-guide-markdown.py`: 9985 words, 30 code blocks, no problems reported.
- `docmgr task add` ×12 (stages 1–5); `docmgr doc relate` with 8 files.

### Why

- Examples carry the explanation. They use one frame (`f12`, 12.0 s) so the numbers line up: Amount 50 % gives 13.47 s, and the traced flow goes to 15.12 s.
- The guide runs over the 7,000-word target because it has to cover fourteen examples, the reference sketch and five decision records; about 2,900 of its words are code.

### What worked

- The contract already provides most of what the bridge needs: `EditLog.state` caches its fold, so identity works as a change test; `propose` fills `expect`; `approve` returns `E_STALE`; `probes.*` is a settable path.
- The `ArgSpec` (`ui.scale: 'log2'`) can decide how preset Amount interpolates, which replaces CraftKit's hand-written `KEEP` list.

### What didn't work

- No command failures. The first draft had an Example 1 that gave the shell slider an `aside` slot it does not have (the build would report `B130` for it); it was rewritten so that `cb.arg` owns the extra slots.

### What I learned

- The agent DSL's global is already named `cb` (`prelude.ts`), so "one grammar" covers names as well as concepts; the guide makes the variant `cb` a superset.
- `EditLog.preview` takes a single mutation, but looks and proposals need batch previews.
- The DSL `Host` (`host.ts`: `cut`, `printChain`, `vocab`) is the only implementation of `frame.print()` expansion. Studio-kit handles must share it, or node ids will diverge.

### What was tricky to build

- Fragment methods from kits must work no matter when the kit is installed, and a typo must still give a computed diagnostic. Solution: elements and builders are proxies that record unknown calls (`{ name, args, at }`), and the first UI pass (`ck.fragments`) resolves them after all kits are installed (`CK-X120`/`X121`).
- Module-level `ck`/`cb` imports versus `build(ck, cb)`: the namespaces are pure (records and definitions), registries live on the builder and the App, and τ/ρ helpers reach services through the running app.

### What warrants a second pair of eyes

- `UnifiedHistory` interleaving a global stack with per-frame EditLog cursors (§9.3). Stepping a frame back in its History panel can leave stale references on the global stack.
- Proposal preview through the `recipes` projection (§9.4), and the rule that a user gesture hides it.
- Partial approval of one card across many frames' logs (Example 10).

### What should be done in the future

- The 12 tasks in `tasks.md`. The DR-2 measurement and the bridge prototype come first.

### Code review instructions

- Read guide §5 (registry, two modes), §7.1 (deferred fragment calls), §9 (EditLog bridge) and §10 (variant contract), then Examples 9–13.
- Run `python3 -I ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/scripts/08-check-guide-markdown.py ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/design-doc/01-intern-guide.md`.

### Technical details

- IR kinds: `ui`, `recipe`, `patch`, `dag`, `kernel`, `tiles`, `mutations`. Code prefixes: `CK-` (I B K D L M T S V P X), `CB-` (A H L R V), and contract codes unchanged.
- Contract requests: `EditLog.preview(ms: Mutation[] | null)`; `Diagnostic.where.file`. DSL requests: a shared vocabulary module; a host `propose(batch)` hook.

## Step 6: Two open questions answered by the user

The guide's two open design questions were put to the user: partial approval of a card that spans many frames, and
whether re-running look parameters on every change (DR-2) is fast enough. Partial approval is now decided and
written into the guide; speed stays open until there is something to measure.

### Prompt Context

**User prompt (verbatim):** "yes, partly approved. speed? i dunno, especially since we haven't started on webgpu. no
worries we can always address that"
**Assistant interpretation:** Allow partial approval; keep DR-2 (concrete re-run) and measure later.
**Inferred user intent:** Do not block implementation on performance speculation.
**Commit (code):** see the commit adding this step — "CHB-016: partial approval decided"

### What I did

- Edited `design-doc/01-intern-guide.md`: the Example 10 note and the §17 risk bullet now say partial approval is
  allowed (fresh frames apply, stale ones stay on the card with "Apply anyway").

### Why

- Decisions belong where implementers read them; the diary records when and why.

### What worked

- Both sentences replaced exactly once.

### What didn't work

- No failures.

### What I learned

- The GPU engine exists (CHB-005) but is not wired into any UI yet; DR-2's cost is mostly recipe compile plus
  render scheduling, measurable once CHB-019 runs a look on the real engine.

### What was tricky to build

- N/A.

### What warrants a second pair of eyes

- N/A.

### What should be done in the future

- Measure DR-2 (look parameter drag → draft render latency) in CHB-019/CHB-021 once a look runs on GpuEngine.

### Code review instructions

- `grep -n "partial approval" design-doc/01-intern-guide.md`.

### Technical details

- N/A.
