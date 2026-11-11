---
Title: 'Intern guide: API design: one grammar for the studio UI, looks and the agent'
Ticket: CHB-016
Status: active
Topics:
    - ui
    - dsl
    - architecture
    - product
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://apps/studio/src/core/controls.ts
      Note: ArgSpec to ControlModel conversion reused by cb.arg
    - Path: repo://packages/contract/src/editlog.ts
      Note: EditLog that the recipes projection and approval cards bridge to
    - Path: repo://packages/contract/src/registry.ts
      Note: OpDef/ArgSpec registry that drives cb.arg, handles and passes
    - Path: repo://packages/dsl/src/host.ts
      Note: vocabulary expansion (frame.print) to share with studio-kit handles
    - Path: repo://packages/dsl/src/prelude/prelude.ts
      Note: runtime-mode handles and proxy diagnostics the UI builder must match
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/shell/index.js
      Note: the ck namespace that the shell port keeps and extends
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/shell/shell.js
      Note: builder, App.check build passes and the runtime ctx
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/shell/ui/node.js
      Note: node IR, binding times and checkSlots (B130/B140) that fragments build on
ExternalSources: []
Summary: 'The API spine for CHB-018…022: one registry and one builder grammar (ck, cb) shared by variants, kits, looks and the agent, with IRs and passes, fragments and kits, one diagnostics producer, the EditLog bridge and the variant contract.'
LastUpdated: 2026-11-11T15:10:20.450905737-05:00
WhatFor: Read before writing code in packages/shell, packages/studio-kit, the feature kits or a variant.
WhenToUse: When you need the names, the contracts between layers, or an example of how a feature should look as builder calls.
---

# Intern guide: API design: one grammar for the studio UI, looks and the agent

## 1. What this guide is for

Chromobench is a darkroom and photo studio for one photographer: scanned negatives and digital RAWs go in, are printed through a physical film and paper model, are finished and compared, and come out as files and prints. The studio's whole user interface is to be written in a JavaScript API, so that we can build several different studios ("variants") from the same parts and try different ways of working: a Lightroom-like one, a darkroom-first one, a three-step one for the photographer, a lab one for us.

Six tickets build that UI in parallel. CHB-018 ports the CraftKit Shell to `packages/shell` (the namespace `ck`). CHB-019 builds `packages/studio-kit` (the namespace `cb`), the host app and the first variants. CHB-020, CHB-021 and CHB-022 build the roll, looks and finish kits. This guide is the spine they share. It fixes the concepts and their names, the registry, the intermediate representations (IRs) and passes, fragments and kits, diagnostics, the state model and its bridge to the per-frame `EditLog`, and the variant contract. It closes with a reference sketch of `ck` and `cb`, fourteen examples from simple to complex, and decision records.

It is a guide for implementation, not a specification. Signatures are sketches; the implementers of CHB-018 and CHB-019 will change details, and should update this guide when they do. It follows the shared UI design brief (`CHB-016/various/ui-design-brief.md`) and refines it in a few places, each marked **Refinement**.

Out of scope: the shell's internals (CHB-018), the host and the components (CHB-019), the physics and the engines (Phase 1), and the agent's transport (CHB-008).

## 2. The idea: one grammar, three kinds of author

Three kinds of code talk about the same things:

- **Variants and kits** describe the UI: "put the enlarger time here, as a slider in stops, with a test-strip button".
- **Looks and presets** describe recipe changes with parameters: "warmth 3 points, punch half a grade".
- **The agent** (CHB-007, CHB-008) explores and proposes: "print this negative at 15.12 s and measure the grey card".

Today these are written in three dialects. CraftKit's shell grammar builds UIs. Chromobench's agent DSL builds handles over the op graph. Looks do not exist yet. "One grammar" means they share one vocabulary and one registry: the same op names, the same `ArgSpec`s, the same frame-handle methods (`frame.print({ time_s })`), the same recipe paths, the same diagnostic codes and the same `explain`. They differ only in *mode*: variants, kits and looks run in the page and are **built** (recorded, checked, mounted). The agent's code runs in the QuickJS sandbox and acts at **runtime**: it builds handles and proposes mutations.

A first taste. The viewer of a variant and an agent eval name the same node:

```js
// in a variant (build mode, runs in the page)
cb.viewer(s => cb.frame(s).print({ time_s: 15.12 }), { id: 'main' })

// in an agent eval (runtime mode, runs in QuickJS)
const p = frame.print({ time_s: 15.12 })
return (await p.measure.densitometer({ at: [48, 32] })).D
```

Both expand, through the same vocabulary code (§5), into the same content-addressed op DAG (`Graph.intern`, `compile(recipe)` in `packages/contract/src/graph.ts`). The same recipe and the same overrides give the same print node id; the viewer only appends `output.display` for the screen. The agent's measurement and the viewer's picture therefore share the engine's cache.

## 3. What exists today

Four bodies of code feed this design. Read them in this order.

**CraftKit Shell v1** (`CHB-016/sources/craftkit-studio/src/shell`, about 3,900 lines of plain ES modules). Start with `docs/SHELL.md`, then `src/shell/index.js` (the `ck` namespace), `ui/node.js` (nodes and binding times), `shell.js` (the builder, `App.check()`, the runtime `ctx`), `core/store.js` and `core/history.js`. The Studio modules in `src/app` (`main.js`, `develop.js`, `develop-model.js`, `engine-graphs.js`) show the grammar used at scale: generated sliders (`devSlider`), presets with Amount (`scalePreset`), Sync (`SYNC_GROUPS`), per-photo history channels. Its three Node test suites pass (CHB-016 diary, Step 2).

**The contract** (`packages/contract/src`). `registry.ts` holds `OpDef` and the op registry; `spec.ts` holds `ArgSpec`, `UiHints` and `checkArgValue`; `recipe.ts` holds `FrameRecipe` and `RECIPE_FIELDS` (every settable path); `paths.ts` has `settablePaths`, `checkSet`, `validateRecipe`, `migrateRecipe`; `graph.ts` has `Graph.intern` and `compile(recipe)`; `mutations.ts` has the closed `Mutation` set; `editlog.ts` has the per-frame `EditLog` (`apply`, `propose`, `approve`, `reject`, `undo`, `preview`, `why`); `errors.ts` has `Diagnostic` and `ERROR_CODES`.

**The agent DSL** (`packages/dsl/src`). `prelude/prelude.ts` builds handles as proxies whose methods come from the registry, with computed errors (`E_DOMAIN` naming the handle to use, `E_NOT_AWAITED` with the corrected code, did-you-mean on unknown members). `host.ts` expands the vocabulary (`frame.print(opts)`, `cut`, `printChain`) into registry ops. The doc topics in `docs/topics/*.md` are executed in CI; they are the reliable statement of today's agent API. Note that the agent's global is already called `cb`.

**The CHB-009 React studio** (`apps/studio/src`). Its framework-free parts stay: `core/frame-session.ts` (a frame's `EditLog`, graph and snapshots), `core/gesture.ts` (drag → one `set`; bursts coalesced before logging), `core/scheduler.ts` (latest request wins, draft → screen → refine), `core/controls.ts` (`ArgSpec` → `ControlModel` with units and asides), `core/history.ts` (EditLog units → history rows, `whyRows`), `core/units.ts`, `present/*` (WebGPU Display-P3 presenter, Canvas2D fallback) and `storage/*` (IndexedDB, OPFS, File System Access). The React components in `src/ui` are replaced (decision record DR-1).

## 4. Concepts and vocabulary

### 4.1 Nouns and verbs

CraftKit's `index.js` opens with a list of nouns and verbs. We keep it and add chromobench's.

| Noun | What it is | Example |
|---|---|---|
| State | One immutable tree, in tiers (§9) | `s.ui.selection.primary` |
| Recipe | A frame's settings; a projection of its `EditLog` | `s.recipes.f12.print.enlarger.time_s` |
| Patch | A sparse recipe: path → value | `{ 'print.grade': 3 }` |
| Handle | A lazy reference to an op-DAG node | `cb.frame(s).print()` |
| Element | A recorded UI node `{ $, props, kids, at }` | `ck.panel('enlarger', …)` |
| Form | The definition of an element kind: slots and a mount function | `slider`, `panel`, `viewport` |
| Command | A named action with label, enabled-with-why, key | `edit.undo`, `darkroom.testStrip` |
| Tool | A canvas gesture with an overlay | `time-scrub`, `probe` |
| Place | Where elements go: module, region, dock column, panel | `.module('print', m => m.right(…))` |
| Fragment | An extension of a form, builder or handle kind | `.testStrip()` on time controls |
| Kit | A bundle of forms, fragments, commands, tools, passes, state and docs | `rollKit` |
| Pass | A function over one IR that reports diagnostics or returns new IR | `preset.amount` |
| Mutation | One recipe change in the closed contract set | `{ op: 'set', path, value }` |
| Variant | One JS module that builds a whole studio | `variants/darkroom.js` |
| Diagnostic | Code, message, call site, facts, one fix | `CK-B140`, `E_PATH` |

The verbs: **bind** (a control to a path), **derive** (a computed path), **show**, **arrange** (place elements), **choose** (`ck.match`, `ck.when`), **act** (commands), **handle** (tool gestures), **change** (transactions and mutations), **propose** (agent changes, waiting for approval), **extend** (forms, fragments, kits, passes) and **explain**.

### 4.2 Binding times

Every slot of every form declares *when* its value is read. This is the most important discipline the shell carries, because it is what lets the build check a program before it runs.

| Mark | Binding time | When it runs | Chromobench example |
|---|---|---|---|
| β | build | once, while building | `min`, `max`, a list of sections, `cb.arg`'s path |
| τ | traced | as a cell; re-runs when a path it read changes | `label: s => cb.frameName(s)`, `disabled: s => !cb.current(s)` |
| bind | binding | τ naming one path; two-way | `bind: s => cb.recipe(s).print.grade` |
| θ | per item | with the real item when a row is drawn | `cell: (frame, i) => cb.view.thumb(frame)` |
| ƒ | helper | a pure function of the form's own value | `format: v => units.formatSeconds(v)` |
| ρ | runtime | handlers, called with `ctx` | `run: ctx => …`, `drag: (e, ctx, g) => …` |

A τ lambda runs against a tracking proxy. The paths it reads are recorded in a path trie (`PathIndex`, `core/store.js`); a write marks every cell whose read set touches the written path, and the scheduler re-runs those cells once per frame, all against the same state. Passing a lambda to a β slot is a build error (`CK-B140`): it would run once and never again.

### 4.3 The node IR, and build → check → mount

A builder call does not touch the DOM. `ck.ui.slider(0, 5, { bind, label })` returns a plain record:

```js
{ $: 'slider', props: { min: 0, max: 5, bind: s => …, label: 'Grade' }, kids: [], at: { file: 'variants/darkroom.js', line: 21, col: 9 } }
```

`at` is the call site, taken from a stack trace by `site()` (`core/diag.js`), skipping library frames. Every diagnostic about this element points at the variant's own line.

A program goes through three phases:

1. **Record.** Builder calls produce the UI tree and the shell definition (state, commands, menus, keys, tools, modules, kits used).
2. **Check (build).** `.build()` resolves kits and fragments, runs the UI-tree passes and returns an `App` with its diagnostics. Nothing is mounted, so this runs headless in Node. Every variant is tested this way.
3. **Mount.** `app.mount(el)` turns τ props into cells and ρ props into handlers and starts the loop Input → Route → Intent → Change → Propagate → Schedule → Draw.

### 4.4 Why a fluent builder: computed feedback

Manuel's reason for a fluent builder is feedback that is computed, not static. A builder knows its receiver: which form, which recipe path, which `ArgSpec`, which kits are installed, what the initial state holds. A diagnostic can therefore state the competing facts and a fix in the program's own words. A JSON schema or a type checker can say "string expected"; the builder can say this:

```text
E_PATH error · No recipe path 'print.enlarger.time'
  at variants/darkroom.js:14:11
  print.enlarger has: mode, lamp, filtration, time_s, fstop, magnification
  fix: cb.arg('print.enlarger.time_s')

CK-X120 error · testStrip() is not offered on cb.arg('print.lights.logH')
  at variants/darkroom.js:17:30
  testStrip() needs an argument measured in s (from fragment darkroom.testStrip, kit darkroom)
  this argument is in logH; it offers: pad(), ringAround(), label(), aside()
  fix: cb.arg('print.lights.logH').ringAround()
```

The agent DSL already works this way (`E_DOMAIN` names the handle to use, `E_ARG_RANGE` converts points to log H in its fix). The UI builder must reach the same standard.

## 5. One registry, two modes

The registry is everything the grammar can name. It has several kinds of entry, each registered by one owner:

| Entry | Registered by | Build mode (page) | Runtime mode (QuickJS) |
|---|---|---|---|
| Ops and `ArgSpec`s | contract catalog (CHB-002/017) | `cb.arg`, handles, passes | handle methods, `frame.edit` checks |
| Recipe fields | `RECIPE_FIELDS` | `cb.arg`, patch validation | `frame.edit` paths |
| Handle vocabulary | shared vocabulary module | `cb.frame(s).print()` | `frame.print()` |
| Forms | shell, studio-kit, kits | elements | — |
| Fragments | kits | methods on elements, builders, handles | — (later, reviewed) |
| Commands, keys, tools | shell, kits, variants | menus, palette, keys, toolbars | — |
| Passes | shell, studio-kit, kits | run on IRs | host runs mutation passes on proposals |
| Docs topics | DSL, kits | Help, `explain` | `cb.docs`, `cb.help` |

**Build mode** is plain JS in the page. Variants, kits and looks are our code. They record IR (the UI tree, look definitions), are checked at build and mounted. They can read any state through τ lambdas and change state through `ctx`.

**Runtime mode** is the agent's eval in QuickJS (CHB-007). The sandbox sees a projection of the registry (the `tables` host call: ops, areas, units). It has no forms, kits or commands. It builds handles over the op DAG and proposes mutations with `frame.edit`; the main thread calls `EditLog.propose`, which tags them `by: 'agent'`. Nothing in the VM can choose its author.

The two modes meet at three points:

1. **The vocabulary.** `packages/dsl/src/host.ts` expands `frame.print(opts)` into `print.expose → print.lights → … → view.adapt` with recipe values overridden by `opts`. Studio-kit's host-side handles must produce the same node ids. **Refinement:** extract the vocabulary expansion (`cut`, `printChain`, `vocab`, `printOf`) into a module both use, for example `packages/dsl/src/vocab.ts`, and test that `cb.frame(s).print(o)` and the sandbox's `frame.print(o)` give the same id for the same recipe.
2. **The name `cb`.** The agent's global `cb` (`frame`, `explain`, `compare`, `testStrip`, `ringAround`, `docs`, `help`, `mode`) and the variant's `cb` are the same name. **Refinement:** the variant's `cb` is a superset. The shared subset (`frame`, `explain`, `testStrip`, `ringAround`, `docs`, `help`) takes the same names and options in both and is declared once in a shared `.d.ts`. `cb.compare` stays agent-only: there it returns a look, in a variant a side-by-side view is an element (`cb.viewer(…, { compare })`).
3. **Mutations and diagnostics.** A slider drag and an agent edit both become `Mutation`s on the same `EditLog`, checked by the same `checkSet`. Both report contract codes (`E_PATH`, `E_ARG_RANGE`, `E_STALE`) unchanged.

```text
                       ┌─────────────── registry ───────────────┐
                       │ ops+ArgSpecs · recipe fields · vocab    │
                       │ forms · fragments · commands · passes   │
                       └───────┬─────────────────────┬───────────┘
          build mode (page)    │                     │   runtime mode (QuickJS, CHB-007)
  variant ─ kits ─ looks       │                     │   agent eval
     record → check → mount    │                     │   handles → what-ifs → frame.edit
            │                  │                     │          │
     ctx.tx / ctx.edit ──► EditLog bridge ◄──── propose (main thread, by: 'agent')
            │                  │
     recipes.<frame> ──► compile(recipe) ──► op DAG (content-addressed) ◄── handles
                                     │
                                  Engine ──► scheduler ──► presenter
```

## 6. IRs and passes

### 6.1 The IRs

An IR is a data structure that a program is lowered into, so that checks and transformations can be written as passes over data rather than hidden in builders. Chromobench has seven.

| IR | Shape | Produced by | Lowered to |
|---|---|---|---|
| UI tree | elements `{ $, props, kids, at }` plus the shell definition | builder calls | cells and DOM at mount |
| recipe | `FrameRecipe` | `EditLog.state` | op DAG by `compile` |
| patch | `{ 'print.grade': 3, … }` | looks, presets, Sync, `frame.edit` | mutation batch, against a base recipe |
| op DAG | interned `Node`s with content ids | `Graph.intern`, handles | kernel program (engine) |
| kernel program | fused WGSL passes and tables | GPU engine (CHB-005) | GPU work |
| tile plan | `TilePlan` | `Engine.plan` | tiled export (CHB-011) |
| mutation batch | `{ tx, by, label, why?, items: [{ frame, mutations }] }` | bridge, sessions | `EditLog.apply` / `propose` |

**Refinement:** the brief lists six IRs. The patch is split out from the recipe because looks, presets, Sync and agent edits all produce the same sparse shape, and passes like Amount work on it.

### 6.2 Passes that exist today

Many passes already exist, scattered:

- **UI tree:** CraftKit's `checkSlots` (`ui/node.js`: `B130` unknown option, `B140` lambda in a β slot, `B141` bad bind) and `App.check()` (`shell.js`: `B110`–`B113` binding paths against the initial state, `D301`–`D303` docking, `M201` non-exhaustive match, `V302` unknown tool, `B150` menu names a missing command, `T401`, `K221`), plus `Keymap.check` (`K2xx`). CHB-009's `auditArrangement` (`core/arrangement.ts`) is a coverage pass.
- **Recipe:** `validateRecipe`, `migrateRecipe`, `checkSet` (`paths.ts`); CHB-009's `diffRecipes` (`core/frame-session.ts`), which lowers two recipes into a mutation list. CraftKit's `effective()` (`develop-model.js`) is a lowering pass: switched-off sections back to defaults before the engine sees them.
- **Patch:** CraftKit's `scalePreset` (Amount) and `syncSettings` (copy chosen groups).
- **Op DAG:** `Graph.intern` (domain and kind checks, `bindArgs`), `compile(recipe)` (the recipe → DAG lowering), the DSL's `explain`.
- **Mutation batch:** `validateMutation`, the `EditLog` check, `E_STALE` on approve (each agent `set` carries `expect`), gesture coalescing (`core/gesture.ts`; CraftKit's `coalesce` key).

### 6.3 The pass API

The shell owns a generic pass manager; each IR kind is registered by the package that owns it (shell: `ui`; studio-kit: `recipe`, `patch`, `dag`, `mutations`; the GPU engine may register `kernel` and `tiles` and run them internally).

```ts
// sketch
interface PassDef<I> {
  kind: 'pass'; name: string; on: IRKind;
  after?: string[]; before?: string[];
  run(ir: I, p: PassCtx): I | void;        // void: check only; I: the rewritten IR
}
interface PassCtx {
  diag(code: string, message: string, extra?: Partial<Diag>): void;
  args: Readonly<Record<string, unknown>>;  // run arguments: { base, amount, roll, … }
  facts: Map<string, unknown>;              // shared between passes of one run
  state?: unknown;                          // ui passes: the initial state
  explain(x: unknown): string;
}
ck.pass(name, { on, after, before }, run): PassDef   // a definition; installed with .passes() or a kit
ck.passes.run(on, ir, args): { ir, diags }           // used by the build, the bridge, the looks kit
shell.passes(def, args?)                             // install, with fixed arguments: .passes(coverage, { strict: true })
```

The rules:

- `ck.pass` returns a definition. It takes effect when a variant or kit installs it (§7.2), so there are no global registries and two variants can be built in the same process.
- Passes on one IR run in topological order of `after`/`before`, then in install order. A cycle or an unknown name is `CK-X130`/`CK-X131`.
- Passes are pure: no store writes, no engine calls, deterministic. A rewriting pass keeps `at` on what it copies, so later diagnostics still point at the author's line.
- Who runs what: `ui` passes run in `.build()`. `recipe` passes run when a recipe is loaded (migrate, validate). `patch` passes run when a look, preset or Sync is applied. `mutations` passes run in the bridge before every `EditLog.apply`, and in the host's propose hook before `EditLog.propose` (§9.4). `dag` passes run in dev builds after compile and in `explain`.

## 7. Fragments and kits

### 7.1 Fragments

A fragment extends something that already exists with methods, props and slots. Targets are a form (`'slider'`, `'panel'`), the controls `cb.arg` makes (filtered by their `ArgSpec`), the shell or module builder, or a handle kind (`'print'` handles, studio-kit only).

```ts
// sketch
ck.fragment(target: string | Function, spec: {
  name: string;
  when?(n: Node): boolean;                                 // β predicate: which nodes it applies to
  methods?: Record<string, (n: Node, ...args: any[]) => Node>;
  props?: Record<string, BindingTime>;                     // new options, checked like the form's own
  slots?: string[];                                        // named child places the mount renders
  mount?(next: MountFn): MountFn;                          // wrap the form's mount
  check?(n: Node, p: PassCtx): void;                       // extra build checks
  doc?: string;
}): Fragment
```

The key mechanism is **deferred calls**. Elements and builders are returned through a proxy. Any method that is not a data field (`$`, `props`, `kids`, `at`) and not a probe (`then`, `toJSON`, symbols) is *recorded* as `{ name, args, at }` on a copy of the element. The `ck.fragments` pass, the first UI pass of every build, resolves each recorded call against the fragments that apply to that node, after all kits are installed. So `cb.arg(…).testStrip()` works whether the kit that defines `testStrip` was installed before or after this line ran. An unknown name becomes a diagnostic with the methods this node does offer (`CK-X121`). A known name whose `when` refuses this node becomes `CK-X120`, as in §4.4. Fragment methods must be fluent (they return the same kind of receiver), and they return copies, so an element can be reused. Every element also answers its own slots as setters: `.label('Exposure')` is `.with({ label: 'Exposure' })`, checked by binding time like an option.

Handle fragments are different, because handles live at runtime inside τ lambdas, not in the UI tree. Their methods run when called, and an unknown method throws `E_UNKNOWN_METHOD` with a did-you-mean, as in the sandbox. Handle fragments are not exposed to the agent in v1: the agent's surface stays generated from the registry and measured (CHB-007 §5.13).

The three kinds of target side by side (a form's fragment is Example 6):

```js
// a handle kind: print handles gain a shortcut used by readouts and overlays (runs inside τ lambdas)
ck.fragment('handle:print-xyz', { name: 'grey', methods: {
  greyAt: (h, at) => h.measure.densitometer({ at, aperture_px: 15 }),
} })

// the shell builder: a kit offers a whole module as one call; recorded, applied at build
ck.fragment('ShellBuilder', { name: 'darkroom.module', methods: {
  darkroomModule: (b, { strip = true } = {}) => b.module('print', m => m.label('Print').key('D')
    .center(cb.viewer(s => cb.frame(s).print(), { id: 'main' }))
    .right(ck.dock.column({ width: 300 }, ck.panel('enlarger'), ck.panel('lights')))
    .bottom(strip ? cb.view.filmstrip(s => cb.roll(s).frames) : null)),
} })
ck.shell('Chromobench').use(darkroomKit).darkroomModule({ strip: false })
```

### 7.2 Kits

A kit is a bundle that a variant installs with `.use(kit)`. Each feature ticket ships one (roll, looks, finish), studio-kit ships `studioKit`, and variants can define small ones.

```ts
// sketch
ck.kit(name, (k: KitBuilder, opts?: unknown) => void): Kit
interface KitBuilder {
  requires(...kits: string[]): this;
  state(slice: { doc?: object; view?: object; ui?: object }): this;  // merged under s.<name>, s.view.<name>, s.ui.<name>
  forms(defs: Record<string, FormDef>): this;
  fragments(...f: Fragment[]): this;
  commands(f: (c: CommandsBuilder) => void): this;
  keys(scope: string, map: KeyMap): this;
  tools(f: (t: ToolsBuilder) => void): this;
  panels(...p: Node[]): this;                       // defined, not placed: the variant places them
  overlays(o: Record<string, Overlay>): this;      // listed by id in a viewer's overlays
  passes(...p: PassDef<unknown>[]): this;
  docs(markdown: string): this;                     // a Help topic, also offered to the agent
}
```

At `.build()` the shell installs kits in dependency order. A missing dependency is `CK-X110` with the fix `.use(<kit>)`. Two kits defining the same command id is `CK-X101`, naming both. A kit's panels are available to place but appear only where the variant puts them; its commands are in the palette whether or not a panel is placed. A variant can pass options (`.use(rollKit, { contactSheet: false })`) and can omit commands (`{ omit: ['roll.balance'] }`).

## 8. Diagnostics and explain

### 8.1 One producer

CraftKit and the contract have two diagnostic shapes. CraftKit's `Diagnostic` has `code, level, title, at, lines, fix, runtime`; the contract's has `code, message, where, path, hint, fix, valid`. The shell's port defines one superset and one constructor:

```ts
// sketch: packages/shell/src/core/diag.ts
interface Diag {
  code: string;                       // 'CK-B140' | 'CB-A300' | 'E_PATH'
  level: 'error' | 'warning' | 'info';
  message: string;                    // CraftKit's title
  at?: Site | null;                   // call site { file, line, col }
  facts?: string[];                   // CraftKit's lines: the competing facts
  fix?: string;                       // literal code to paste
  path?: string; valid?: string[]; hint?: string;   // contract fields
  runtime?: boolean;
}
function diag(code: string, message: string, extra?: Partial<Diag>): Diag
function fromContract(d: Diagnostic, at?: Site): Diag     // level from the code: E_ → error, W_ and bare words → warning
function toContract(d: Diag): Diagnostic                  // for the agent and for logs
```

Code families:

| Prefix | Owner | Families |
|---|---|---|
| `CK-` | shell | I info, B bindings and options, K keys, D docking, L lambdas, M matching, T tools and transactions, S statecharts, V viewport, P performance, X fragments, kits and passes (CraftKit's "plugins") |
| `CB-` | studio-kit and kits | A args and controls, H history and the EditLog bridge, L looks and params, R viewer, handles and rendering, V variants and the host |
| `E_…`, `W_…`, bare words | contract | reused unchanged: `E_PATH`, `E_ARG_RANGE`, `E_DOMAIN`, `E_STALE`, `RANGE`, … |

A fix is computed from the receiver: the closest settable path (contract `closest()`), the methods this node offers, the τ slots of this form, the kit that defines a missing command. "Check the reference" is not a fix.

### 8.2 explain

`ck.explain(x)` renders anything the grammar makes as indented text: an element, a panel, a module, a kit, a whole app, a handle (the DSL's op-chain explain), a patch, a mutation batch, a diagnostic list. Output is stable, so it is used for snapshot tests, for code review and for the agent ("what is on screen?"). With `{ state: true }` it includes current τ values.

```text
variant darkroom "Darkroom first" · kits studio, roll, probes · 0 errors, 1 warning
module print "Print" key D
  left   column 240
           panel history ← studio
  center viewer main  τ cb.frame(s).print()  tools time-scrub, probe  overlays probes  compare
  right  column 300
           panel enlarger "Enlarger"
             arg print.enlarger.time_s  slider log2 s  aside stop  .testStrip(step 1/3 st)
             arg print.enlarger.fstop   stepper log2 fstop
           panel approvals ← studio
```

Each IR kind registers an explainer (`ck.ir(kind, { explain })`); kits can add explainers for their forms.

## 9. State: tiers and the EditLog bridge

### 9.1 Tiers

The store is one immutable tree. Its top-level keys decide the tier:

| Key | Tier | Holds |
|---|---|---|
| `catalog` | document | projects, rolls, frames (flag, stars, label, keywords), collections |
| `looks`, `presets`, `snapshots` | document | saved look instances, presets as patches, named recipe copies |
| `<kit>` | document | a kit's own document slice |
| `recipes` | **projected** | `recipes.<frameId>` = that frame's `EditLog.state` |
| `ui`, `view`, `prefs`, `workspace` | view | selection, tool, readings; module, compare; interface gray; panel sizes per variant |

Document-tier writes are transactions with an inverse, one undo step each. View-tier writes are free. The **preview layer** sits over both during a gesture: `ctx.preview(path, v)` shows a value without changing the document, `ctx.commit(label)` turns the whole preview into one transaction, `ctx.cancel()` drops it.

### 9.2 Recipes are a projection of the EditLogs

A frame's recipe already has an authority with a richer history than the shell's: the `EditLog` keeps authors, approvals, `why(path)` and a cursor over undo units. The bridge makes `recipes` a projected key: reads come from the logs, writes are routed to them. **Refinement (CHB-018):** the store gains projected keys, a generic hook that knows nothing about recipes.

```ts
// sketch: the shell's hook, filled by packages/studio-kit/src/bridge.ts
store.project('recipes', {
  read: () => logs.snapshot(),                         // { [frameId]: state }; identity stable until a log changes
  write(patches, label, opts) { … },                   // ['f12','print','grade'] = 3 → log('f12').apply([set], 'user', label)
  preview(path, value) { … },                          // overlay on that frame, never logged
  commit(label, opts) { … }, cancel() { … },           // apply the overlay as one unit / drop it
});
```

- **Reads.** `s.recipes.f12` is `logs.get('f12').state`. `EditLog` caches its fold, so the object identity changes only when the log does, and reference equality remains a complete change test for cells.
- **Transactions.** `ctx.tx('Grade', t => { t.recipes.f12.print.grade = 3 })` becomes `log.apply([{ op: 'set', path: 'print.grade', value: 3 }], 'user', 'Grade')`. A write that is not a settable leaf (pushing to `print.exposures`) is `CB-H210` with the fix `ctx.edit(frame, [{ op: 'exposure.add', … }])`.
- **`ctx.edit(frame, patchOrMutations, { label })`** is the canonical recipe write, with the same shape as the agent's `frame.edit`. A patch is lowered to `set` mutations; structural mutations pass through.
- **Previews.** `ctx.preview(s => cb.recipe(s).print.enlarger.time_s, 13.47)` sets an overlay. `EditLog.preview` takes a single mutation; a look's parameter drag previews several paths, so the bridge keeps its own overlay (the fold of the patch over `log.committed`) until the contract accepts a batch preview (§17).
- **Coalescing.** Each `EditLog.apply` is one undo unit, so keyboard and wheel bursts are coalesced before logging, as `core/gesture.ts` does now (800 ms on the same control).
- **Mixed transactions.** A command that writes a recipe and the catalog ("apply preset and mark edited") gets one EditLog unit and one shell history entry, linked by a group id; the undo adapter treats the group as one step.

### 9.3 History channels and global undo

CraftKit files a transaction under a channel (a photo id), so a History panel can list one photo's steps while the global undo stack is unchanged. In chromobench the channel of a recipe write is its frame id, and the frame's History panel *is* that frame's `EditLog` (rows from CHB-009's `historyGroups`, clicking a row calls `moveCursor`).

Mod+Z is global. The shell's `edit.undo` talks to a `HistoryPort` interface (a CHB-018 refinement); studio-kit provides a `UnifiedHistory` that interleaves shell entries and EditLog units:

```ts
// sketch
type Step = { kind: 'shell'; entry: HistoryEntry }
          | { kind: 'log'; frame: string; tx: string }
          | { kind: 'group'; steps: Step[] };
interface HistoryPort { canUndo: boolean; canRedo: boolean; last: string | null; next: string | null; undo(): Step | null; redo(): Step | null }
```

A `log` step undoes through `logs.get(frame).undo()`. The log's cursor is the truth: if the photographer stepped that frame back in its own History panel, the global stack skips stale references instead of undoing twice. Approved agent units are pushed on the global stack when the log emits `approve`.

### 9.4 Agent proposals: preview and approval card

In ask mode an agent eval ends with `EditLog.propose(ms, { tx, why })` per touched frame; the entries are `pending`. The studio shows them in two ways:

1. **An approval card** (`cb.panel.approvals()`, also inside CHB-008's chat step card): who, why, each change in display units ("Time 12.0 → 13.47 s, +1/6 st"), Approve and Reject. Approve calls `log.approve(seqs)`. If it returns `E_STALE` diagnostics, the card says what changed and offers "Apply anyway" (`approve(seqs, { force: true })`). Reject calls `log.reject(seqs)`.
2. **A preview.** While a card is selected (or by default for the frame on screen), the bridge computes `proposed = fold(log.committed, pending mutations of tx)` and the `recipes.<frame>` projection returns it. Controls show proposed values with a "proposed" style, and the viewer renders the proposed print. Nothing is committed. A user gesture on that frame hides the proposal preview (the card stays), so the user's own preview never mixes with the agent's.

The DSL session (CHB-007) calls `propose` itself. **Refinement:** the session takes a `propose(batch)` callback from the host, so the host can run the `mutations` passes (grouping, approval scope) before the batch reaches the logs.

### 9.5 Persistence

Persistence is an interface the host fills (a CHB-018 refinement): CHB-009's IndexedDB store (`storage/db.ts`: `projects`, `rolls`, `frames`, `logs`, `snapshots`, `settings`) for the document tier and `EditLogData` per frame; OPFS for caches; File System Access for folders and recipe sidecar files next to the images. The workspace (view tier) is saved per variant id.

## 10. Variants and the host

### 10.1 The contract

```ts
// sketch: @chromobench/studio-kit
interface VariantDef {
  id: string;                              // 'darkroom'
  label: string;                           // 'Darkroom first'
  description?: string;
  params?: Record<string, ParamSpec>;      // variant settings shown in the host's preferences
  build(ck: CK, cb: CB, env: VariantEnv): ShellBuilder;
}
interface VariantEnv { params: Record<string, unknown>; dev: boolean; hostVersion: string }
function defineVariant(def: VariantDef): VariantDef      // identity, plus a CB-V001 check of the shape
```

`ck` and `cb` are importable namespaces whose functions are pure: they create element records and definitions (kits, passes, fragments). Registries (panels, fragments, passes, commands) live on the builder and the `App`, never in the namespace, so two variants can be built side by side in one test process. Helpers used inside τ and ρ lambdas, such as `cb.frame(s)` and `cb.recipe(s)`, reach the host's services through the app that is running the lambda (the scheduler and `ctx` set it), so a module never holds a service. `build(ck, cb, env)` receives the namespaces anyway, so a test harness can pass instrumented ones.

**A variant may:** install kits, define and arrange panels, modules and docks, add commands, menus, keys, tools, overlays, fragments and passes, define looks and params, declare view-tier state, pick a theme.

**A variant may not:** declare document-tier state (`CB-V010`: document data belongs to kits, so switching variants loses nothing); write recipes except through `ctx` (the bridge); import engines, storage or the DSL session (they are host services reached through `cb`); define ops (ops come from the contract); change the agent mode except through the host's `agent.mode` command run from a user gesture. Variants are unsandboxed, so most of this is enforced by the API surface, by build checks where possible, and by review (DR-3).

### 10.2 Loading, switching, hot reload

1. **Boot services** once: storage, engines (mock or GPU), the library, the log registry (one `EditLog` per open frame), the render scheduler, the presenter, the agent bridge.
2. **Pick a variant**: `?variant=` in the URL, else the saved preference, else `classic`.
3. **Build headless** first: `def.build(ck, cb, env).build(services)`. With errors, show the Build Report and keep the current app (or a minimal error shell on first load).
4. **Mount** and restore that variant's workspace.
5. **Switch**: `app.unmount()` disposes cell scopes, cancels a preview and removes listeners. Services, logs and the document tier survive. Then build and mount the next variant.
6. **Hot reload** (dev): the variant module's Vite HMR accept handler re-imports, rebuilds and swaps only if the build has no errors.

## 11. Examples, simple to complex

The examples use one frame, `f12`, printed at 12.0 s. They are sketches against the API of §12.

**Example 1: a control bound to a recipe argument.** `cb.arg` looks up the `ArgSpec` that owns the path (`pathOwners`), builds a `ControlModel` (CHB-009's `modelFor`) and records a `cb.arg` element. At mount it renders the widget the `ArgSpec` asks for (slider, stepper, pad, select), bound to the current frame's recipe.

```js
cb.arg('print.enlarger.time_s')
cb.arg('print.enlarger.time_s', { label: 'Exposure' })   // override what the ArgSpec says

// written by hand with the shell alone, the slider part would be:
ck.ui.slider(0.1, 600, {
  bind: s => cb.recipe(s).print.enlarger.time_s,              // bind: one path, two-way, current frame
  label: 'Time', scale: 'log', step: 0.1,                      // β, from ArgSpec.ui
  format: v => cb.units.formatSeconds(v),                      // ƒ
  disabled: s => !cb.current(s), why: 'Select a frame first',  // τ
})
```

On top of that, `cb.arg` adds the stops readout ("+1/3 st" against the base time), the amber warning outside `ArgSpec.usual`, provenance on right-click (`why(path)`) and the "proposed" style of §9.4.

**Example 2: a panel.** Sections with a reset (double-click the section title) and a τ line of text.

```js
const enlarger = ck.panel('enlarger', { title: 'Enlarger' },
  ck.text(s => `${cb.frameName(s)} · ${cb.recipe(s)?.print.paper ?? ''}`, { dim: true }),
  ck.section('Exposure', { reset: true },
    cb.arg('print.enlarger.time_s'),
    cb.arg('print.enlarger.fstop')),
  ck.section('Filtration', { reset: true },
    cb.arg('print.enlarger.filtration')))        // cmy: three sliders, one path, one undo step per drag
```

**Example 3: a module.** A place with regions, its own keys, and a viewer.

```js
shell.module('print', m => m.label('Print').key('D').icon('enlarger')
  .left(ck.dock.column({ width: 240 }, cb.panel.history(), cb.panel.snapshots()))
  .center(cb.viewer(s => cb.frame(s).print(), { id: 'main', compare: true, tools: ['time-scrub'] }))
  .right(ck.dock.column({ width: 300 }, ck.panel('enlarger'), cb.panel.approvals()))
  .bottom(cb.view.filmstrip(s => cb.roll(s).frames))
  .keys({ T: 'darkroom.testStrip' }))
```

**Example 4: a tool gesture.** Drag across the print to change the exposure time in sixth-stops. `down` returns the gesture state, `drag` previews, `up` commits one EditLog unit, Esc cancels.

```js
shell.tools(t => t.tool('time-scrub', {
  label: 'Scrub Exposure Time', icon: 'clock', key: 'E', cursor: 'ew-resize',
  enabled: s => !!cb.current(s), why: 'Select a frame first',
  on: {
    down: (e, ctx) => ({ x0: e.sx, t0: cb.recipe(ctx.state).print.enlarger.time_s }),
    drag: (e, ctx, g) => {
      const stops = Math.round(((e.sx - g.x0) / 40) * 6) / 6            // 40 px per stop
      ctx.preview(s => cb.recipe(s).print.enlarger.time_s, +(g.t0 * 2 ** stops).toFixed(2))
    },
    up: (e, ctx) => ctx.commit('Exposure time'),
    cancel: (e, ctx) => ctx.cancel(),
  },
}))
```

Forgetting the commit in `up` is `CK-T420` at runtime, with the fix spelled out.

**Example 5: an overlay.** Densitometer probes drawn over the print, with their readings. `read` is τ; `paint` is called when its value or the view changes. The probes are recipe data (`recipe.probes`); the readings are view state that studio-kit's probe service (CHB-009's `core/probe.ts`) writes after each render.

```js
const probes = ck.overlay.custom('probes',
  s => ({ probes: cb.recipe(s)?.probes ?? {}, readings: cb.readings(s) }),
  (g, vp, v) => {
    const [w, h] = vp.natural()
    for (const [id, p] of Object.entries(v.probes)) {
      const [x, y] = vp.toScreen(p.x / w, p.y / h)
      g.append(ck.svg('circle', { cx: x, cy: y, r: p.r * vp.scale(), class: 'cb-probe' }))
      const D = v.readings[id]
      if (D) g.append(ck.svg('text', { x: x + 8, y: y - 8, text: D.map(d => d.toFixed(2)).join(' ') }))
    }
  })
```

**Example 6: a fragment.** Every time-like control gains `.testStrip()`. The predicate reads the `ArgSpec` unit, so the fix in §4.4 can be computed.

```js
export const testStripFragment = ck.fragment('cb.arg', {
  name: 'darkroom.testStrip',
  when: n => n.props.spec.unit === 's',
  methods: {
    testStrip: (n, { step = '1/3 st', count = 5 } = {}) => n.with({
      aside: ck.ui.command('darkroom.testStrip', { small: true, icon: 'strip', args: [n.props.path, { step, count }] }),
    }),
  },
  doc: 'A test-strip button next to a time control.',
})
// in a panel:
cb.arg('print.enlarger.time_s').testStrip({ step: '1/6 st' })
```

**Example 7: a kit.** Probes as a bundle: state, a tool, a command, the overlay of Example 5, a panel and docs. `probes.*` is a settable recipe path (`RECIPE_FIELDS`, in sensor pixels), so placing a probe is one `ctx.edit`.

```js
export const probesKit = ck.kit('probes', k => k
  .requires('studio')
  .state({ view: { show: true } })                              // → s.view.probes.show
  .tools(t => t.tool('probe', {
    label: 'Densitometer Probe', icon: 'probe', key: 'I',
    on: { down: (e, ctx) => {
      const f = cb.current(ctx.state), n = Object.keys(cb.recipe(ctx.state).probes).length + 1
      ctx.edit(f, { [`probes.p${n}`]: { x: e.ix, y: e.iy, r: 12 } }, { label: 'Add probe' })
      return false                                               // no drag: one click, one step
    } },
  }))
  .commands(c => c.add('probes.toggle', { label: 'Show Probes', menu: 'View', checked: s => s.view.probes.show,
    run: ctx => ctx.set({ view: { probes: { show: !ctx.state.view.probes.show } } }) }))
  .overlays({ probes })
  .panels(ck.panel('probes', { title: 'Probes' }, cb.view.readings()))
  .docs('# Probes\nPress I and click the print to place a densitometer probe. Readings are densities per channel.'))
```

**Example 8: a build pass.** Coverage: which controllable recipe paths does this variant not place? It is an info diagnostic in most variants and a warning in the lab variant, which installs it with `.passes(coverage, { strict: true })`.

```js
export const coverage = ck.pass('cb.coverage', { on: 'ui', after: ['ck.fragments'] }, (tree, p) => {
  const placed = new Set()
  tree.walk(n => { if (n.$ === 'cb.arg') placed.add(n.props.path) })
  const missing = cb.registry.controlPaths().filter(x => !placed.has(x))   // paths whose ArgSpec has ui hints
  if (missing.length) p.diag('CB-A300', `${missing.length} recipe controls are not placed`, {
    level: p.args.strict ? 'warning' : 'info', at: tree.at, facts: missing.slice(0, 8),
    fix: `ck.panel('more', { title: 'More' }, ${missing.slice(0, 2).map(x => `cb.arg('${x}')`).join(', ')}, …)`,
  })
})
```

**Example 9: a patch pass, preset Amount.** CraftKit scales a preset linearly from the defaults and keeps a hand-written list of keys (`KEEP` in `develop-model.js`). Here the `ArgSpec` decides: values with `ui.scale: 'log2'` interpolate in stops, numbers and vectors linearly, and enums, stocks and strings take the preset's value. Interpolation starts from the frame's current value rather than the defaults; which base is right is CHB-021's call.

```js
export const amount = ck.pass('preset.amount', { on: 'patch', before: ['patch.validate'] }, (patch, p) => {
  const k = p.args.amount / 100                                   // 0 … 200 %
  const out = {}
  for (const [path, to] of Object.entries(patch)) {
    const spec = cb.registry.specAt(path), from = cb.registry.valueAt(p.args.base, path)
    out[path] = cb.interpolate(spec, from, to, k)
  }
  return out
})
// cb.interpolate: log2 → from · (to / from)^k; number, vec3, cmy → from + (to − from)·k; others → to
```

With a base of 12.0 s and a preset of 15.12 s (+1/3 stop), Amount 50 % gives 12 × 1.26^0.5 = 13.47 s (+1/6 stop), not the linear 13.56 s. A preset of +4 points of red light at 50 % gives +2 points (0.05 log H).

**Example 10: a mutation-batch pass.** "Apply to roll" from the agent becomes one approval card for 36 frames. Every frame's `propose` uses the same `tx`, so the approvals panel groups by `tx`; this pass adds the card's title and scope.

```js
export const rollCard = ck.pass('roll.oneCard', { on: 'mutations', after: ['mutations.validate'] }, (batch, p) => {
  if (batch.by !== 'agent' || batch.items.length < 2) return
  return { ...batch, card: {
    title: `${batch.label} · ${batch.items.length} frames of ${p.args.roll.name}`,
    scope: { roll: p.args.roll.id, frames: batch.items.map(i => i.frame) },
    summary: p.explain(batch),                                 // "Time +1/6 st on 36 frames; Grade 2 → 2.5 on 12"
  } }
})
```

Approving the card approves each log. If some frames are stale, the card lists them with "Apply anyway" for those; the others are applied. Whether a partial approval is acceptable is an open question (§17).

**Example 11: a parameterised look.** Parameters are declared with `ArgSpec`s, so they get the same controls, units and checks as recipe arguments. The patch function is concrete JS, re-run on every change (DR-2). More blue light makes the print's yellow dye denser, so `warmth` adds blue light.

```js
export const warmPrint = cb.look('warm-print', l => l
  .label('Warm print')
  .param('warmth', { type: 'number', unit: 'point', min: -10, max: 10, default: 3, doc: 'Blue light in printer points.', ui: { label: 'Warmth', step: 1 } })
  .param('punch', { type: 'number', unit: 'none', min: 0, max: 2, default: 0.5, doc: 'Grades above the frame.', ui: { label: 'Punch', step: 0.5 } })
  .patch((p, r) => {
    const [R, G, B] = r.print.lights.logH
    return { 'print.lights.logH': [R, G, B + cb.units.pt(p.warmth)], 'print.grade': Math.min(5, r.print.grade + p.punch) }
  }))

// a panel for it: the viewer previews the look as a what-if; Apply writes one undo step per frame, grouped
ck.panel('look', { title: 'Warm print' },
  ...warmPrint.controls(),                                        // one cb.param control per param, bound to ui.looks
  ck.ui.button('Apply to Selection', { run: ctx => cb.looks.apply(ctx, warmPrint, cb.selection(ctx.state)) }))
cb.viewer(s => cb.frame(s).with(warmPrint.patchFor(s)).print(), { id: 'look-preview' })
```

The parameter values being tried live in view state (`s.ui.looks['warm-print']`); `controls()` binds one `cb.param` control to each, and `patchFor(s)` runs the patch with them against the current frame's recipe. `cb.frame(s).with(patch)` is a host-side what-if: `compile(recipe ⊕ patch)`. Only the changed print nodes get new ids; the scan and negative nodes are cache hits. Saved instances (a look id plus parameter values) go to the document tier's `looks`; CHB-021 owns the details.

**Examples 12 and 13: two variants that differ only in arrangement.** The parts are shared; each variant decides where they go and what to leave out.

```js
// variants/parts.js
// @ts-check
export const parts = (ck, cb) => ({
  panels: [
    ck.panel('enlarger', { title: 'Enlarger' },
      cb.arg('print.enlarger.time_s').testStrip(), cb.arg('print.enlarger.fstop'), cb.arg('print.enlarger.filtration')),
    ck.panel('lights', { title: 'Printer Lights' }, cb.arg('print.lights.logH').pad(), cb.arg('print.grade')),
  ],
  viewer: () => cb.viewer(s => cb.frame(s).print(), { id: 'main', compare: true, tools: ['time-scrub', 'probe'], overlays: ['probes'] }),
  grid: () => cb.view.grid(s => cb.roll(s).frames),
  strip: () => cb.view.filmstrip(s => cb.roll(s).frames),
})
```

```js
// variants/classic.js: Lightroom-like, everything visible
// @ts-check
import { defineVariant } from '@chromobench/studio-kit'
import { studioKit, probesKit, darkroomKit } from '@chromobench/studio-kit/kits'
import { parts } from './parts.js'

export default defineVariant({
  id: 'classic', label: 'Classic',
  build: (ck, cb) => {
    const p = parts(ck, cb)
    return ck.shell('Chromobench').use(studioKit).use(darkroomKit).use(probesKit).panels(...p.panels)
      .module('library', m => m.label('Library').key('G').center(p.grid()).right(cb.panel.history()))
      .module('print', m => m.label('Print').key('D')
        .left(ck.dock.column({ width: 240 }, cb.panel.history()))
        .center(p.viewer())
        .right(ck.dock.column({ width: 300 }, ck.panel('enlarger'), ck.panel('lights'), cb.panel.approvals()))
        .bottom(p.strip()))
  },
})
```

```js
// variants/simple.js: three steps for the photographer, one thing at a time
// @ts-check
import { defineVariant } from '@chromobench/studio-kit'
import { studioKit, probesKit, darkroomKit } from '@chromobench/studio-kit/kits'
import { parts } from './parts.js'

export default defineVariant({
  id: 'simple', label: 'Three steps',
  build: (ck, cb) => {
    const p = parts(ck, cb)
    return ck.shell('Chromobench').use(studioKit).use(darkroomKit).use(probesKit).panels(...p.panels)
      .module('pick', m => m.label('1 · Pick').key('Mod+1').center(p.grid()))
      .module('print', m => m.label('2 · Print').key('Mod+2')
        .center(p.viewer())
        .right(ck.dock.column({ width: 320 }, ck.dock.tabs(['enlarger', 'lights']), cb.panel.approvals())))
      .module('check', m => m.label('3 · Check').key('Mod+3')
        .center(p.viewer()).left(cb.panel.history()))
  },
})
```

The two `explain` outputs list the same kits, commands and panels and different modules and docks. The filmstrip is left out of `simple`, and the coverage pass reports the same placed paths for both.

**Example 14 (runtime mode, for contrast): the agent proposes the same change.** No UI, same paths, same checks; the result lands on the approval card of §9.4.

```js
const e = frame.edit({ 'print.enlarger.time_s': 13.47 }, { why: 'the grey card prints 0.05 D too dense' })
return { status: e.status, D: (await e.preview.measure.densitometer({ at: [48, 32] })).D }
```

## 12. Reference sketch: `ck` and `cb`

This is a sketch of the authoring surface (the `.d.ts` a variant sees). Names in CraftKit's `index.js` are kept unless noted.

```ts
// @chromobench/shell: ck (sketch)
type BindingTime = 'β' | 'τ' | 'bind' | 'θ' | 'ƒ' | 'ρ';
type Tau<T> = T | ((s: State) => T);
interface Site { file: string; line: number; col: number }
interface Node<P = Record<string, unknown>> {
  readonly $: string; readonly props: P; readonly kids: readonly Node[]; readonly at: Site | null;
  readonly calls: readonly { name: string; args: unknown[]; at: Site | null }[];  // deferred fragment calls
  with(props: Partial<P>): Node<P>;
  [fragmentMethod: string]: unknown;
}
interface CK {
  shell(name: string, opts?: { plate?: string; statusbar?: boolean }): ShellBuilder;
  // place
  panel(id: string, opts?: PanelOpts, ...kids: Child[]): Node;    // define; ck.panel(id) references
  section(title: string, opts?: SectionOpts, ...kids: Child[]): Node;
  row(...a: Child[]): Node; column(...a: Child[]): Node; bar(...a: Child[]): Node; scroll(...a: Child[]): Node;
  grid(opts: { cols: number }, ...kids: Child[]): Node; tabs(t: Record<string, Node>, o?: object): Node;
  toolbar(items: (string | Node)[], o?: object): Node; hud(o: { at: string }, v: Tau<string>): Node;
  dock: { column(o: { width?: number; solo?: boolean }, ...panels: Node[]): Node; tabs(ids: string[], o?: object): Node };
  // show and choose
  text(v: Tau<string>, o?: object): Node; icon(name: string): Node; stat(v: Tau<string>, o?: object): Node;
  html(make: (m: MountCtx) => Element): Node;                     // escape hatch, flagged by explain
  match(on: (s: State) => string, cases: Record<string, Node>, o?: { of?: string[] }): Node;
  when(cond: (s: State) => boolean, a: Node, b?: Node): Node;
  ui: Record<'slider' | 'number' | 'segmented' | 'select' | 'checkbox' | 'stepper' | 'button' | 'command' | 'curve' | 'wheel', (...a: any[]) => Node>;
  view: Record<'list' | 'grid' | 'filmstrip' | 'tree' | 'histogram', (items: Tau<unknown>, o?: object) => Node>;   // as CraftKit's index.js
  viewport(image: Tau<unknown>, o: ViewportOpts): Node;           // generic: images go through a RenderBridge
  overlay: { custom(kind: string, read: (s: State) => unknown, paint: (g: SVGGElement, vp: ViewportApi, v: any, s: State) => void): Overlay };
  svg(tag: string, attrs: Record<string, unknown>): SVGElement;
  // extend
  form(name: string, def: FormDef): FormDef;                      // CraftKit's ck.define
  fragment(target: string | Function, spec: FragmentSpec): Fragment;
  kit(name: string, f: (k: KitBuilder, opts?: any) => void): Kit;
  pass<I>(name: string, o: { on: IRKind; after?: string[]; before?: string[] }, run: (ir: I, p: PassCtx) => I | void): PassDef<I>;
  passes: { run<I>(on: IRKind, ir: I, args?: object, installed?: PassDef<any>[]): { ir: I; diags: Diag[] } };
  ir(kind: string, def: { explain(ir: unknown): string }): void;
  // inspect
  explain(x: unknown, o?: { state?: boolean; short?: boolean }): string;
  diag(code: string, message: string, extra?: Partial<Diag>): Diag;
  keyLabel(chord: string): string;
}
interface ShellBuilder {
  use(kit: Kit, opts?: unknown): this;
  state(init: object, o?: StateOpts): this;                       // variants: view-tier keys only
  derive(path: string, fn: (s: State) => unknown): this;
  commands(f: (c: CommandsBuilder) => void): this; menus(f: (m: MenusBuilder) => void): this;
  keys(scope: string | KeyMap, map?: KeyMap): this; spring(chord: string, tool: string | object, o?: object): this;
  tools(f: (t: ToolsBuilder) => void): this; panels(...p: Node[]): this;
  fragments(...f: Fragment[]): this; passes(...p: PassDef<any>[]): this; theme(name: string): this;
  module(id: string, f: (m: ModuleBuilder) => ModuleBuilder): this;
  build(services?: HostServices): App;
}
interface Ctx {                                                    // what every ρ lambda receives
  readonly state: Readonly<State>;
  tx(label: string, f: (t: Draft) => void, o?: TxOpts): void;
  set(view: object): void;                                         // view tier
  preview(target: string | ((s: State) => unknown), value: unknown): void;
  commit(label: string, o?: TxOpts): void; cancel(): void;
  edit(frame: string, change: RecipePatch | Mutation[], o?: { label?: string }): void;   // added by studio-kit
  run(command: string, ...args: unknown[]): unknown;
  toast(text: string, o?: object): void; dialog(spec: object): Promise<unknown>;
  vp?: ViewportApi; options: Record<string, unknown>;
}
interface App { diagnostics: Diag[]; explain(o?: object): string; mount(el: HTMLElement): this; unmount(): void; history: HistoryPort }
```

```ts
// @chromobench/studio-kit: cb (sketch)
type RecipePath = 'print.enlarger.time_s' | 'print.lights.logH' | 'print.grade' /* … generated from RECIPE_FIELDS */;
type RecipePatch = Partial<Record<RecipePath | `probes.${string}`, unknown>>;
interface CB {
  // reading state (τ helpers)
  current(s: State): string | null;                    // the frame being edited (selection primary)
  recipe(s: State, frame?: string): FrameRecipe | undefined;
  selection(s: State): string[]; roll(s: State): RollView; frameName(s: State, frame?: string): string;
  readings(s: State): Record<string, number[]>;
  // handles: the agent's vocabulary, host side
  frame(s: State | string, frame?: string): FrameHandle;
  // elements
  arg(path: RecipePath, o?: ArgOpts): Node;            // fragments add .testStrip(), .pad(), .ringAround(), …
  args(group: string): Node[];                         // every ui-bearing arg of an ArgSpec group, registry order
  param(name: string, spec: ArgSpec, o?: { bind: (s: State) => unknown }): Node;
  viewer(image: (s: State) => ImageHandle | null, o?: ViewerOpts): Node;
  view: { grid(items: Tau<FrameRef[]>, o?: object): Node; filmstrip(items: Tau<FrameRef[]>, o?: object): Node;
          contactSheet(o?: object): Node; thumb(f: FrameRef): Node; readings(): Node };
  panel: { library(): Node; history(): Node; approvals(): Node; snapshots(): Node; allParameters(): Node; why(): Node };
  // looks and patches
  look(id: string, f: (l: LookBuilder) => LookBuilder): LookDef;
  looks: { apply(ctx: Ctx, look: LookDef, frames: string[], params?: object): void };
  interpolate(spec: ArgSpec, from: unknown, to: unknown, k: number): unknown;
  // registry
  registry: { op(name: string): OpDef; specAt(path: string): ArgSpec | undefined; controlPaths(): string[]; valueAt(r: FrameRecipe, path: string): unknown };
  units: typeof import('@chromobench/contract').units & { formatSeconds(v: number): string; stopsFrom(s: State, path: string): string };
  // shared with the agent's cb (same names and options)
  explain(x: unknown, o?: object): string;
  testStrip(f: FrameHandle, o: object): ImageHandle; ringAround(f: FrameHandle, o: object): ImageHandle;
  docs: { list(): string[]; search(text: string): object[]; read(id: string): string }; help(name?: string): string;
}
interface FrameHandle {
  readonly id: string;
  source(): ImageHandle; scan(): ImageHandle; negative(): ImageHandle; display(): ImageHandle;
  print(o?: { paper?: string; time_s?: number; fstop?: number; filtration?: Cmy; lights?: Vec3; grade?: number; preflash?: number }): ImageHandle;
  with(patch: RecipePatch): FrameHandle;               // what-if on the recipe, host side only
}
interface LookBuilder { label(t: string): this; param(name: string, spec: ArgSpec): this; patch(f: (p: any, r: FrameRecipe) => RecipePatch): this }
interface MutationBatch { tx: string; by: 'user' | 'agent' | 'auto'; label: string; why?: string; items: { frame: string; mutations: Mutation[] }[]; card?: ApprovalCard }
declare function defineVariant(def: VariantDef): VariantDef;
```

## 13. One flow traced end to end

The photographer is in `classic`, module Print, on frame `f12` at 12.0 s, and drags Time one third of a stop longer.

1. **pointerdown** on the slider that `cb.arg('print.enlarger.time_s')` recorded. The binding resolves its path through the tracking proxy, `['recipes', 'f12', 'print', 'enlarger', 'time_s']`, and pins it for the gesture, so a selection change during the drag cannot move it.
2. **pointermove** to the sixth-stop detent: `binding.preview(13.47)` → `store.preview(path, 13.47)`. The store sees the projected key `recipes` and calls `bridge.preview('f12', [{ op: 'set', path: 'print.enlarger.time_s', value: 13.47 }])`. The bridge's overlay changes `recipes.f12`; the store notifies `recipes.f12.print.enlarger.time_s`. The path index marks the slider's readout cell and the viewer's cell, which read `recipes.f12` whole.
3. **Next animation frame:** the viewer's τ runs `cb.frame(s).print()`. The shared vocabulary compiles the recipe; `output.display` is appended for the presenter's space; the result is node `#a1…`. The store is previewing, so the scheduler requests a draft pass. The scan and negative nodes kept their ids, so an engine that caches intermediate results evaluates only the print chain, at draft scale. The presenter draws.
4. **pointerup** at 15.12 s: `binding.commit('Time')` → `bridge.commit('f12', 'Time')` → `log.apply([{ op: 'set', path: 'print.enlarger.time_s', value: 15.12 }], 'user', 'Time')`. The bridge clears its overlay; `UnifiedHistory` pushes `{ kind: 'log', frame: 'f12', tx }`.
5. **Next frame:** the viewer computes the same node id as the last draft, so the draft stays on screen while the scheduler requests the screen pass. The History panel shows "You · Time 12.0 → 15.12 s (+1/3 st)" (CHB-009's `describe`).
6. **Mod+Z:** `edit.undo` → `UnifiedHistory.undo()` → `logs.get('f12').undo()`. The 12.0 s node id comes back and is a cache hit.
7. **The agent** (ask mode) runs Example 14. At the end of the eval the session calls the host's propose hook; the mutation passes run; `log.propose(…)` records one pending `set` with `expect: 12`. The approvals panel shows a card; the viewer previews 13.47 s. The photographer clicks Approve: `log.approve(seqs)` applies one unit, and `UnifiedHistory` pushes it. Had the photographer changed the time first, approve would have returned `E_STALE`, and the card would offer "Apply anyway".

## 14. Decision records

**DR-1: The studio UI is the CraftKit Shell, ported to TypeScript, not React.**
*Context.* The CHB-009 guide chose React 19 with a framework-free core, and CHB-009 built that core (`apps/studio/src/core`, `present`, `storage`, about 2,700 lines) plus React components. The new requirement is that the whole UI is expressible as builder calls so variants are cheap. The CraftKit Shell already implements the grammar: record → check → mount, binding times, one command table for menus, palette and keys, docks, history with channels, a viewport with tools.
*Alternatives.* (a) React plus a JSON layout schema; (b) a builder that emits React elements; (c) port the shell.
*Decision.* (c), as recorded in the UI design brief.
*Consequences.* Builder diagnostics and `explain` come with the shell. Carried over from CHB-009: `core/frame-session.ts`, `gesture.ts` semantics (inside the bridge), `scheduler.ts`, `probe.ts`, `controls.ts`, `history.ts`, `units.ts`, `arrangement.ts` (as the coverage pass), `present/*`, `storage/*` and their tests. Replaced: `src/ui/*.tsx`, `hooks.ts`, `main.tsx`. React Aria is gone, so accessibility is ours (CraftKit's forms carry roles and keys; an a11y pass checks labels). The React app stays runnable until the `classic` variant reaches parity.
*Status.* Accepted.

**DR-2: Look parameters are re-run concretely, not traced symbolically.**
*Context.* CraftKit traces lambda holes into a program compiled once, and a render sends only the holes' values. Chromobench content-addresses nodes: `compile(recipe)` interns nodes by the hash of op and arguments.
*Alternatives.* Symbolic: run the patch once with proxy parameters and record a DAG with holes. Concrete: re-run `patch(p, recipe)` on every change.
*Decision.* Concrete. The patch is any JS (conditionals, `Math.min`, lookups) with no tracing restrictions; recompiling is cheap because unchanged subgraphs keep their ids and the engine's cache hits.
*Consequences.* Each change costs one patch call, one `compile` and some hashing. Measure it (stage 3); the target is under 2 ms per frame. If a parameter ever needs to live on the GPU during a drag, a symbolic path can be added for that case behind the same look API.
*Status.* Proposed, pending the measurement.

**DR-3: The sandbox is only for agent eval.**
*Context.* Variants, kits and looks are written by us; agent code is generated and untrusted.
*Decision.* Variants, kits and looks run unsandboxed in the page with the full API. Agent eval runs in QuickJS (CHB-007): deterministic, resource-limited, no DOM, no store, edits only as proposals.
*Consequences.* A broken variant can break the page, so the host builds headless first and keeps the previous app on errors. There is no capability system for variants; the API surface and review are the guard.
*Status.* Accepted.

**DR-4: Agent-authored variants come later, and are reviewed as code.**
*Context.* A variant is one JS module, so the agent could write one, but it would run unsandboxed.
*Decision.* Not in v1. When it comes, the agent drafts a variant through a CHB-008 tool that builds it headless (in a worker) and returns `explain` and diagnostics; a person reviews and commits it. A variant is never loaded from a chat message.
*Consequences.* Headless build, `explain` and computed diagnostics are needed anyway; they are the groundwork.
*Status.* Accepted (deferred work).

**DR-5: TypeScript for packages, plain JS for variants, typed by `.d.ts`.**
*Context.* Packages need strict types; variants should be quick to write, hot-reload without a compile step, and later be written by the agent.
*Decision.* `packages/shell`, `packages/studio-kit` and the kits are TypeScript. Variants are ES modules with `// @ts-check`, typed by the packages' declarations, checked in CI with `tsc --checkJs`. `RecipePath` is a union generated from `RECIPE_FIELDS`, so a typo in `cb.arg('…')` is caught in the editor as well as at build.
*Consequences.* Types and runtime diagnostics overlap on purpose: types catch shape errors early; diagnostics catch what types cannot (binding times, unknown panels, state paths, units).
*Status.* Accepted.

## 15. Implementation plan

CHB-016 owns the design, not the packages. Its stages keep the design honest while CHB-018 and CHB-019 build.

1. **Freeze the vocabulary.** Agree the names of §4, §6 and §8 with the CHB-018 and CHB-019 implementers. *Done means:* this guide and the brief agree, and both tickets cite them.
2. **Types and examples.** Write the `ck` and `cb` declarations of §12 as `.d.ts` files in this ticket's `reference/`, and the fourteen examples as `.js` files checked with `tsc --checkJs`. *Done means:* `tsc` passes; CHB-018 and CHB-019 copy the declarations as their starting point.
3. **Prototypes in Node** (`scripts/`): the EditLog bridge (projection, preview, commit, unified undo) against `@chromobench/contract`; deferred fragment calls and the pass manager; the DR-2 measurement (patch + compile for one frame and a 36-frame roll). *Done means:* each prototype has a test; numbers are recorded in the diary.
4. **Contract and DSL requests** to CHB-017 and CHB-007 (§17). *Done means:* accepted or answered.
5. **Reviews.** Check the CHB-018 shell and the CHB-019 studio-kit against this guide; both example variants build headless with zero errors. *Done means:* deviations are either fixed or written back into this guide.
6. **Authoring docs.** A Help topic "Writing a variant", generated from the declarations and the examples; `ck.explain(app)` offered to CHB-008 as a read-only agent tool (groundwork for DR-4).

## 16. Testing and acceptance

- **Every variant builds headless in Node** with zero error diagnostics, and its `explain` output matches a snapshot.
- **Diagnostics are golden-tested:** each `CK-`/`CB-` code has a test that triggers it and asserts the code, the call site's line and the fix text. The two cases of §4.4 are the first tests.
- **Fragments:** a call before the kit's `.use()` resolves; an unknown method gives `CK-X121` with the offered methods; a refused `when` gives `CK-X120`.
- **Passes:** ordering by `after`/`before`; a cycle gives `CK-X130`; a rewrite keeps `at`. The Amount pass: 12.0 s → 15.12 s at 50 % gives 13.47 s; +4 points at 50 % gives +2 points.
- **Bridge:** a drag of 120 pointer moves gives one `EditLog` unit; Esc gives none; Mod+Z undoes across a shell entry and a log unit in the right order; stepping a frame back in its History panel and then pressing Mod+Z does not undo twice.
- **One vocabulary:** for the same recipe and options, `cb.frame(s).print(o)` and the sandbox's `frame.print(o)` give the same node id. This test fails if either side builds its chain on its own.
- **Proposals:** a pending proposal previews without changing `stateHash`; approve applies one unit; a stale approve returns `E_STALE`; force applies.
- **Playwright smoke per variant** (CHB-019): open a fixture, change a control, undo, approve a proposal.

## 17. Risks and open questions

- **Batch preview (contract).** `EditLog.preview` takes one mutation. Looks, presets and proposals preview several. The bridge works around it with its own overlay; proposed for contract 0.2 (CHB-017): `preview(ms: Mutation[] | null)`.
- **Call sites in contract diagnostics.** The contract's `Diagnostic.where` has `line` and `col` but no file. Proposed: an optional `file`, so contract errors raised for a variant point at its file.
- **The shared vocabulary module.** `packages/dsl/src/host.ts` owns the expansion today. Extracting it is a change in CHB-007's package; it blocks the one-vocabulary test, not the rest.
- **The propose hook.** The DSL session should take a host `propose(batch)` callback so mutation passes run on agent batches (CHB-007/CHB-019).
- **Cross-frame approval.** One card over 36 logs is not atomic: some frames can be stale. Open question for CHB-020/CHB-021: allow partial approval (current proposal), or refuse the whole card when any frame is stale.
- **Unified undo consistency** between a global stack and per-frame cursors (§9.3) is the trickiest piece of the bridge. Prototype it first.
- **Call-site capture** relies on `Error().stack`, whose format differs between engines and is changed by bundling. Fine in dev; production builds need source maps or can drop sites.
- **Proxied elements** cost something at build only; nothing proxied survives into state (CraftKit's `strip` already enforces that for the store).
- **Accessibility** without React Aria (DR-1): CraftKit's forms need an audit; an a11y pass should check labels and roles.
- **Retouch ops from the CraftKit Workbench** (`vendor/wb`) wait on a licence answer (CHB-022).

## 18. References

- UI design brief: `ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/various/ui-design-brief.md`.
- CHB-016 diary, Steps 2–4 (the study, the API guidelines fit, the product sketch): `…/CHB-016--…/diary/01-diary.md`.
- CraftKit Shell: `…/CHB-016--…/sources/craftkit-studio/docs/SHELL.md`; `src/shell/index.js`, `shell.js`, `ui/node.js`, `core/{store,history,diag,engine}.js`, `ui/viewport.js`; Studio: `src/app/{main,develop,develop-model,develop-tools,engine-graphs}.js`.
- Contract: `packages/contract/src/{registry,spec,recipe,paths,graph,mutations,editlog,errors,eval}.ts`, `catalog/*.ts`.
- Agent DSL: `packages/dsl/src/prelude/prelude.ts`, `packages/dsl/src/host.ts`, `packages/dsl/src/docs/topics/*.md`.
- CHB-007 guide (DSL runtime): `ttmp/2026/11/11/CHB-007--…/design-doc/01-intern-guide-dsl-runtime.md`, §2.5 (parameters), §5.7–5.9 (object model, edits, errors).
- CHB-009 guide (studio): `ttmp/2026/11/11/CHB-009--…/design-doc/01-intern-guide-studio-app-ui.md`, §5.1, §5.4, §5.7, §5.8.
- CHB-009 code: `apps/studio/src/core/{frame-session,gesture,scheduler,controls,history,units,arrangement}.ts`, `present/*.ts`, `storage/*.ts`.
- Sibling guides: CHB-018 (shell), CHB-019 (studio-kit, host, variants), CHB-020 (roll kit), CHB-021 (looks kit), CHB-022 (finish kit).
