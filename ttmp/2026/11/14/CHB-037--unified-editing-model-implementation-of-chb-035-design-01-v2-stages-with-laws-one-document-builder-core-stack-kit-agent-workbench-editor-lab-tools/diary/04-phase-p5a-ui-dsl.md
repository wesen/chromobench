---
Title: Diary — phase P5a UI DSL
Ticket: CHB-037
Status: active
Topics:
    - architecture
    - ui
    - webgpu
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://packages/shell/README.md
      Note: The UI DSL's rules (aec7c5f)
    - Path: repo://packages/shell/src/build/builder.ts
      Note: 'BuilderKind: shell, module, menu and kit values (3585c1f)'
    - Path: repo://packages/shell/src/build/ck.ts
      Note: Uniform signatures, when/pick, extend (03bdaa4)
    - Path: repo://packages/shell/src/build/kits.ts
      Note: Kit values, command and tool tables, ck.product (3585c1f, 2242c12)
    - Path: repo://packages/shell/src/build/shell.ts
      Note: Shell, Module, Menu values; scopes by declaration site (3585c1f)
    - Path: repo://packages/shell/src/core/commands.ts
      Note: requires and host capabilities (a5177d8)
    - Path: repo://packages/shell/src/ir/node.ts
      Note: Nodes as immutable values; ck.extend vocabulary; CK-X120 guard (4afeb8d)
    - Path: repo://packages/studio-kit/layouts/classic.js
      Note: Layouts compose kits only (2242c12, e317b43)
    - Path: repo://packages/studio-kit/src/cb.ts
      Note: cb.core kit, cb.panels/views/modules/menus (2242c12)
    - Path: repo://packages/studio-kit/src/commands/host.ts
      Note: Host command table on requires (a5177d8)
    - Path: repo://packages/studio-kit/src/sel.ts
      Note: CbState and the typed selectors (6ec19b0)
    - Path: repo://tools/scripts/check-boundaries.ts
      Note: studio-kit may import values; layouts import nothing (e317b43)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-14T21:36:49.65011-05:00
WhatFor: ""
WhenToUse: ""
---



# Diary

## Goal

The phase agent's record of phase P5a of CHB-037: the studio's UI DSL (`ck`, packages/shell; `cb`, packages/studio-kit;
the layouts and kits) made one consistent, immutable builder language on `@chromobench/values`, with every call site
rewritten and the studio behaving exactly as before. Spec: `design-doc/01-implementation-plan-and-working-rules.md`
§6 "P5a" and "Amendments after P1"; design: CHB-035 design 01 v2 §17, §30–§33; CHB-029 items 1, 2, 3, 4, 7, 9.

## Step 1: Reading, baseline, and the new public forms

The main agent assigned me phase P5a. I read the working rules, the P5a spec and its amendment, the design's opening
and §17, §30–§33, `packages/values/README.md` and its sources, CHB-029's plan and tasks, the diary skill, and the code
in scope: the shell's builders (`build/ck.ts`, `shell-builder.ts`, `kits.ts`, `fragments.ts`, `recorders.ts`,
`types.ts`, `checks.ts`, `explain.ts`), its node IR (`ir/node.ts`, `slots.ts`, `forms.ts`), `core/diag.ts`, the build
(`app/built-app.ts`, `assemble.ts`), studio-kit's `cb.ts`, `variant.ts`, `studio.ts`, the four kits and the nine
layouts, and the tests that pin behaviour (the layouts' explain snapshots above all).

The result is the list of new public forms below, fixed before writing code so every step rewrites call sites once.
The explain snapshots of the layouts are the oracle for "behaves exactly as before": a snapshot may change only where a
rule changes what is recorded (a key scope, a removed alias), and each kind of change is listed in the step that makes it.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all."

**Assistant interpretation:** The main agent assigned me phase P5a: make the UI DSL consistent (design §32, CHB-029
items 1–4, 7, 9) on the builder core, with a hard cut-off (no aliases, no wrappers, no old call forms), rewrite every
call site (shell, studio-kit layouts and kits, apps/studio, tests, demos, e2e), keep the studio's behaviour, keep this
diary and commit each green step on `task/chb-037-p5a-ui-dsl`.

**Inferred user intent:** One small, elegant builder language for every arrangement of the studio, so later phases
(the stack kit in P5b, agent-written layouts) build on one shape of immutable values instead of four.

### What I did
- Read the documents and code listed above.
- Ran the baseline in the worktree: `pnpm install --frozen-lockfile --prefer-offline`; `pnpm typecheck && pnpm lint &&
  pnpm gen:check && pnpm test` → green, vitest 113 files, 2850 passed, 19 skipped;
  `STUDIO_PORT=5551 STUDIO_KIT_PORT=5552 SHELL_DEMO_PORT=5553 GPU_PARITY_PORT=5554 CI=1 pnpm test:browser` → 108 passed
  (4.4 min, headless SwiftShader).
- Wrote down the new forms (Technical details).

### Why
- The rules of §32 touch every builder at once; deciding the forms first keeps the rewrite to one pass per call site.

### What worked
- The node IR is already copy-on-write; the DOM half reads only `$`, `props`, `kids`, `at`, so nodes can change
  representation without touching renderers.
- apps/studio uses the DSL only through `buildVariant`, `VARIANTS` and the Studio services: few call sites there.

### What didn't work
- `f=ttmp/2026/11/14/CHB-035*/design/...; wc -l $f` failed in zsh (`no such file`): assignments do not glob in zsh;
  `f=$(echo …)` works.

### What I learned
- `menu:` on commands is not only a duplicate: darkroom, simple and tiny declare no menus, so their menu bars are
  *generated* from the commands' `menu` fields. Removing the field means those layouts must place menus explicitly.
- `module:*` is the scope "every module" (single letters allowed, a module's own key wins); `global` refuses single
  letters (CK-K210). darkroom puts its single-letter keys on the shell with `module:*`.
- No kit uses `k.panels()` or `k.menus()`; panels reach layouts only through product builders (`cb.panel.history()`).
- `ck.install` is used three times, all for "kit X is used but not installed" passes (CB-R001, CB-F102, CB-L001), which
  cannot live in the kit they check for.

### What was tricky to build
- N/A (design step).

### What warrants a second pair of eyes
- The decisions in Technical details that the design does not make (marked "decision").

### What should be done in the future
- N/A

### Code review instructions
- Nothing to review yet; read Technical details against design §32.

### Technical details

New public forms (before → after):

| Before | After |
|---|---|
| `ck.shell(n)` mutable `ShellBuilder`, Proxy for unknown methods | `ck.shell(n)` an immutable Shell value; chain methods are modifiers; `.with(m)`; unknown method → `BuildError` CK-X120 with "did you mean" |
| `s.module(id, m => m.label(…).left(…))` | `s.module(ck.module(id, { label, key, … }).left(…))`: modules are values |
| `s.commands(c => c.add(id, spec))`, `s.tools(t => …)`, `s.panels(…)`, `s.passes(…)`, `s.fragments(…)` on the shell | gone: kits declare commands, tools, passes (decision: a program with its own commands wraps them in a kit) |
| `ck.kit(name, k => k.x().y())` recorded into a mutable `KitDef` | `ck.kit(name).version(…).requires(…).state(…).commands({ id: spec }).tools({ id: spec })…`: an immutable Kit value |
| `c.add(id, { menu: 'File', … })` | no `menu:`; menus are values `ck.menu(label, items)` placed with `s.menus(...menus)` |
| `ck.install(pass | fragment | theme)` | gone: passes through kits; fragments through `ck.extend` |
| fragment calls recorded on nodes, resolved by `normalize` | `ck.extend(...fragments | kits)` registers methods before nodes are made; fragment methods are modifier factories (they return a modifier, a function or a props patch) |
| `ck.panel(id, opts?, ...kids)` (defines and registers globally) / `ck.panel(id)` | `ck.panel.define(id, props?, ...kids)` defines; `ck.panel(id)` references; no instance-global panel registry |
| `ck.section(title, opts?, ...kids)`, `ck.grid(cols, ...)` | containers `(props?, ...children)`: `ck.section({ title }, …)`, `ck.grid({ cols }, …)` |
| `ck.hud(opts, value)` vs `ck.statusline(value, opts)` | leaves `(value, props?)` |
| `ck.ui.slider(min, max, opts)`, `ck.ui.segmented(options, opts)`, `ck.ui.select(options, opts)`, `ck.ui.button(label, opts)`, `ck.ui.checkbox(label, opts)` | one props object: `ck.ui.slider({ min, max, … })`, `ck.ui.segmented({ options, … })` |
| aliases `ck.stack`, `ck.label`, `ck.ui.toggle`, `ck.ui.search`, `ck.ui.command`, `ck.ui.iconButton`, `cb.nudge` | gone: one name per form (`ck.column`, `ck.text`, `ck.ui.checkbox({ switch: true })`, `ck.ui.textField({ search: true })`, `ck.ui.button({ run: id })`, `cb.arg(path, { widget: 'nudge' })`) |
| nodes `disabled` | `enabled` + `why` (slot, chain method, menu item objects) |
| `ck.when(bool, a, b)` returns a value | `ck.when(cond, a, b)` always an interaction node (a boolean is a build error); build-time choice: plain JS or `.with(ck.mod.when(bool, m))` |
| `ck.pick(v, map)` value or selector | always a selector |
| `keys(scope?, map)` with three defaults | `.keys(map)`: shell → `global`, module → `module:<id>`, kit → `kit:<name>` (every module, like `module:*`) |
| `(s: any)` selectors, `current` defined twice | `cb.sel.*` typed over `CbState`; one `current` |
| four kit products | every `cb.kits.*` is a Kit value (installable with `.use(kit)`) carrying `panels.*`, `modules.*`, `menus.*`, `tools`, `commands`, `docs` |
| layouts import `classic.js` parts | `cb.modules.*`, `cb.menus.*`; no layout imports another |
| `hidden: s => !hostHas(s, 'x')`, `run: ctx => hostRun(ctx, 'x')` | `requires: 'host.x'`; the host passes typed capabilities at mount (`services.host`) |
| `variant`, `VARIANTS`, `variants/`, `?variant=` | `layout`, `LAYOUTS`, `layouts/`, `?layout=` (one name, no alias) |

## Step 2: Nodes are immutable values; fragments through ck.extend; enabled + why

The first code step replaces the node Proxy. A node is now a frozen object whose prototype (one per form, per ck
instance) carries the common chain methods (`with`, `prop`, `slot`, `tip`, `enabled`, `hidden`), one setter per slot of
its form and the fragment methods registered with `ck.extend`. Every chain method is a modifier applied with `with`
(the modifiers are `ck.mod.*`, built with the builder core's `modifier`), so `n.tip('x')` ≡ `n.with(ck.mod.tip('x'))`
and `n.with({ density: 'compact' })` merges into the props. Unknown methods are no longer recorded: the last link of
every node's prototype chain is a guard Proxy whose `get` answers an unknown method name with a function that throws
`BuildError` CK-X120 with "did you mean" where it is called; a fragment whose `when` refuses the node throws CK-X121.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Implement rule 2 of §32 (no Proxy recording, explicit registration) and the node half of
rule 1 (immutable values, chain methods as modifiers) on the builder core; switch the shell's call-site capture to the
builder core's (amendment after P1).

**Inferred user intent:** One kind of immutable value from the node up, with errors at the line that made them.

**Commit (code):** 4afeb8d — "CHB-037 P5a step 1: nodes are immutable values on @chromobench/values"

### What I did
- `packages/shell/src/ir/node.ts` rewritten: `NodeVocab` (per ck instance: forms + fragments → per-form prototypes),
  `nodeMods` (`prop`, `props`, `slot`, `tip`, `enabled`, `hidden`, `when`), `withNode` through
  `toModifier(x, patchProps).run(node)` (the P1 amendment), the guard Proxy, `[EXPLAIN]` on nodes, `makeNode(form, …)`
  for nodes outside an instance (the DOM half's own buttons and panel references).
- `ck.extend(...fragments | kits)`: a fragment gives this instance's nodes its methods and joins every build; a kit
  gives its fragments' methods and its forms' setters (the kit still puts its props, defaults and checks into the
  builds that use it). Fragment methods are modifier factories returning a modifier, a function or a props patch
  (`pad: () => ({ widget: 'pad' })`).
- `normalize` only applies fragment prop defaults now (`applyDefaults`); explain lost the `+call(…)` words.
- `core/diag.ts` re-exports `site`, `libraryRoot`, `where`, `CallSite` from `@chromobench/values` (one root set).
- Polarity: the common slot `disabled` became `enabled` (+ `why`); the DOM half reads `enabled`; menu item objects too.
- `tools/scripts/check-boundaries.ts`: studio-kit (src and kits) may import `@chromobench/values`.
- Tests: extend.test (X120/X121 thrown, suggestions, the method applies at once), types.test, kit.test (testStrip).

### Why
- A Proxy per node that records any method made typos silent until the build and meant a kit's method worked
  whether or not it was ever installed; registration before use makes the vocabulary explicit and the error local.

### What worked
- The DOM half needed nothing beyond the `enabled` polarity and `makeNode`'s signature: renderers read `$`, `props`,
  `kids`, `at` only.
- vitest 113 files green after updating three tests; the layouts' explain snapshots did not change.
- Browser (side worktree at 4afeb8d, ports 5551–5554): 107 passed, 1 failed:
  `[gpu-parity] film.spec.ts:18 pcg4d uniforms … Test timeout of 180000ms exceeded while running "beforeEach" hook`
  (the parity page's first load in a fresh worktree; the page does not use the shell or studio-kit).

### What didn't work
- First typecheck: `node.ts(65,12): error TS2698: Spread types may only be created from object types` (narrowing a
  generic N to `never` after `isNode`); fixed by spreading through a `NodeData` cast.

### What I learned
- A Proxy as the *last prototype* of plain frozen objects gives "did you mean" for unknown methods without a Proxy per
  node; generic code that probes nodes (`then`, `toJSON`, `asymmetricMatch`, `nodeType`, `kind`…) gets `undefined`.

### What was tricky to build
- The guard must not throw on property reads (code probes `n.foo`); it returns a thrower function for method-like
  names only, like the old Proxy returned a recorder, and `undefined` for probes and non-method names.
- `when`-split fragments: several fragments may add the same method to one form for different nodes; the method
  picks the first whose `when` accepts the node at call time and throws CK-X121 if none does.

### What warrants a second pair of eyes
- `PROBES` in node.ts: a slot or fragment method named like a probe (`kind`, `form`, `spec`) gets no setter.
- Nodes made before a `ck.extend` keep their old prototype (by design: register before building).

### What should be done in the future
- N/A

### Code review instructions
- Start at `packages/shell/src/ir/node.ts` (`NodeVocab.protoOf`, `GUARD`, `withNode`), then `build/ck.ts` (`extend`).
- `pnpm test -- packages/shell/test/build/extend.test.ts packages/studio-kit/test/kit.test.ts`.

### Technical details
- Fragment before/after: `methods: { testStrip(this, o) { return this.prop('strip', …) } }` →
  `methods: { testStrip: (o = {}) => ({ strip: { step: '1/3 st', ...o } }) }`; `createCb` calls
  `ck.extend(core, roll.kit, finish.kit, looks.kit)` so layouts' nodes answer `.pad()`, `.testStrip()`, `.rollScope()`.

## Step 3: Shell, modules, menus and kits as values; one registration per kind; scopes by declaration site

The builders become values like nodes. `ck.shell(name)`, `ck.module(id, props)`, `ck.menu(label, items)` and
`ck.kit(name)` return frozen values (`build/builder.ts`: a `BuilderKind` per kind, per ck instance) whose chain
methods are modifiers on their data (`shellMods`, `moduleMods`, `kitMods`), with `with`, a trail of applied modifiers
and `explain`. Kits declare commands and tools as tables, layouts place modules and menus, and keys take their scope
from where they are declared. This step rewrote every call site of the builders: the nine layouts, cb.core and the
four kits, the shell's mini studio and tests, studio-kit's tests.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Rules 1 (builders), 3 (one registration per kind) and 5 (scopes) of §32, with the
command tables of CHB-029 item 3 and the menus of item 2 (no `menu:` field; menus only from `menus`).

**Inferred user intent:** A layout is a short composition of things kits declare; nothing is registered twice.

**Commit (code):** 3585c1f — "CHB-037 P5a step 2: shell, modules, menus and kits are immutable values; one registration per kind"

### What I did
- New `build/builder.ts` (`BuilderKind`: frozen values, chain methods from modifier factories, builder fragments from
  `ck.extend`, the CK-X120 guard, `with(modifier | fn of the value | data patch)`), `build/shell.ts` (Shell, Module,
  Menu), `build/kits.ts` (Kit values, `CommandTable`, `ToolTable`, `product()`); deleted `shell-builder.ts`,
  `recorders.ts`. `buildApp(def, ck)` builds a shell's data; no pending builder calls.
- Removed: command `menu:` (explain and the palette read the placed menus through `menuIndex`; built-in, module and
  tool commands use `group` for the palette), the menu bar generated from commands, `ck.install`, `ck.form`, the
  instance panel registry, shell regions/commands/tools/panels/passes/fragments, kit `.panels()`/`.menus()`,
  `ToolSpec.scope`, tool groups, `ModuleDef.tools` (unused).
- `ck.panel(id)` references; `ck.panel.define(id, props?, ...kids)` defines where it stands.
- Keys: shell `.keys(map)` → `global`; module → `module:<id>`; kit → `kit:<name>`, which binds in every module like the
  built-in `module:*` (`everyModule()` in keys.ts; the shortcut sheet shows both as "Every module").
- studio-kit: cb.core is `ck.kit('cb.core')…commands(coreCommands).tools(coreTools)`; finish and looks export
  `finishCommands(F, T)` / `looksCommands(cb, M)` tables; roll's table inline. The three "kit used but not installed"
  passes that were `ck.install`ed (CB-R001, CB-F102, CB-L001) are now each kit's `missing` check, run by one cb.core
  pass `cb.kits`. Menus: `cb.menus.file/edit/frame/view/window/help/standard()`, `cb.kits.roll.menus.roll()`,
  `…finish.menus.finish()`, `…looks.menus.looks()`. darkroom, simple and tiny place `cb.menus.standard()` (their menu
  bar was generated from `menu:` fields before) in an explicit `ck.module('main', { label: 'Chromobench' })`.
- The chains were converted with two scratch scripts (balanced-paren `c.add(…).add(…)` → `{ id: spec }`, then a
  re-indent); comments between calls were kept.

### Why
- §32 rows 1, 3 and 5; CHB-029 item 2. Commands generating menus was the second source of menus.

### What worked
- `pnpm typecheck && pnpm lint && pnpm gen:check && pnpm test` green: 113 files, 2851 passed, 19 skipped.
- The theme test caught the point of the step: `b.theme(o.theme)` with the result discarded no longer changes `b`.

### What didn't work
- `error TS2320: Interface 'KitValue<St>' cannot simultaneously extend types 'Kit<St>' and 'Built<KitDef>'`, then
  `Types of property 'version' are incompatible` — `version` was both a chain method and a data field; the field went
  (read `kit.def.version`).
- `Argument of type '(s: MiniState) => boolean' is not assignable to type 'Traced<any, boolean>'`: with an untyped
  state, `Readonly<any>` is a mapped type, not `any`; `Traced` now takes `(s: any) => T` when S is `any`, and kit
  tables can be typed `.commands<MiniState>({ … })`.
- My first re-indent script mangled the roll table (it special-cased closing braces); I restored the file from git and
  re-ran the conversion with the plain rule "continuation line = entry indent + (its indent − the entry's minimum)".

### What I learned
- The palette grouped commands by their `menu:` field; with menus as the one source it groups by the first placed
  menu that lists the command, else by `group`.

### What was tricky to build
- Kits' own passes run only where the kit is installed, so "used but not installed" checks cannot live in the kit;
  cb.core (which every studio installs) runs each kit's `missing(ir, p)` at build, reading `cb.kits` lazily.
- Freezing: a value's data and the lists/records directly under it are frozen (except `init`, the program's state,
  which the store copies); what the program puts in (specs, nodes) stays the program's, as in the builder core's `Coll`.
  The normalize pass used to assign `t.content` on a tool spec; it now replaces the map entry.

### What warrants a second pair of eyes
- Kit keys moved from `global` to `kit:<name>` for cb.core's Mod+O / Mod+E: they now bind in every module instead of
  globally. Every keyboard path still goes through a module scope, so behaviour is the same; the shortcut sheet lists
  them under "Every module" instead of "Everywhere".
- darkroom, simple and tiny show the standard menus instead of menus generated from every command's `menu:` field
  (e.g. their old Tools menu, which listed every tool, is gone; tools stay in the palette and on their keys).

### What should be done in the future
- N/A

### Code review instructions
- Start at `packages/shell/src/build/builder.ts`, `shell.ts`, `kits.ts`; then `packages/studio-kit/src/cb.ts` (core,
  `kitsPass`, `cb.menus`) and `packages/studio-kit/variants/classic.js`.
- `pnpm test`; the snapshots in `packages/studio-kit/test/__snapshots__/variants.test.ts.snap`.

### Technical details
- Explain snapshot changes (layouts): commands show the menu that places them, not their old `menu:` field (e.g.
  `frame.rate "Set Stars" (Frame)` → `frame.rate "Set Stars"`, and the looks layout's roll commands lose `(Roll)`
  because it does not place the Roll menu); the summary line has one more key scope (`kit:cb.core`) and two passes
  fewer (three installed passes became `cb.kits`). The mini studio: its commands come from the kit `mini`
  (`← mini`, `kits: mini`, one more scope). `controls("darkroom")`: `ck.explain(node)` now knows the forms of kits
  registered with `ck.extend`, so each `cb.arg` shows its control's words.

## Step 4: Uniform signatures; one name per form; when and pick are interaction forms

Rule 4 of §32 is mostly about call forms, so this step is a rewrite of call sites with a small change in `ck.ts`:
containers take `(props?, ...children)`, leaves `(value, props?)`, controls one props object. The aliases went (one
constructor per form), and `ck.when` / `ck.pick` stopped changing kind by argument type. The browser run of the
previous commit (3585c1f) had two failures that both passed when rerun alone (below), so they are load flakes.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** §32 rows "containers / leaves / controls", "enabled and why everywhere" (done in Step
2), "`ck.when` always an interaction node … `.with(when(bool, m))`", and "remove aliases".

**Inferred user intent:** One way to write each thing, so arrangements read alike.

**Commit (code):** 03bdaa4 — "CHB-037 P5a step 3: uniform signatures, one name per form, when and pick are interaction forms"

### What I did
- `ck.ts`: `box` for every container (section, row, column, bar, scroll, grid, cell, dock.column), `leaf(form, key)`
  for leaves (text, icon, stat, kbd, keys, html, statusline, hud, tabs, toolbar, dock.tabs), `control(form)` for the
  `ck.ui.*` controls and `ck.view.thumb`. Removed `ck.stack`, `ck.label`, `ck.ui.toggle`, `ck.ui.search`,
  `ck.ui.command`, `ck.ui.iconButton`; `cb.nudge` (→ `cb.arg(path, { widget: 'nudge', … })`).
- `ck.when(cond, a, b)`: a non-function `cond` throws `CK-L120`; `ck.pick(key, map)` with a non-function throws
  `CK-L121`; `ck.mod.when(bool, m)` is the build-time choice (identity when false).
- `cb.bar.steps(steps, { labels })`; `cb.ifFrame(props?, ...kids)`.
- A scratch converter (`sigs.py`, balanced-paren) rewrote the positional calls; I re-formatted the mini studio's
  sections by hand afterwards (the converter joined their lines).
- Reran the two specs that failed at 3585c1f, alone, on the same commit: `e2e/studio-real.spec.ts` and
  `packages/studio-kit/test/browser/looks.spec.ts` → 6 passed.

### Why
- §32 row 3 lists `hud(opts, value)` against `statusline(value, opts)` and positional `slider(min, max, opts)`.

### What worked
- 113 files, 2852 passed; snapshots unchanged (props are printed sorted, so moving `min`/`max` into the object is
  invisible to explain).

### What didn't work
- Browser run at 3585c1f: 106 passed, 2 failed — `[studio-kit] looks.spec.ts:17 … TimeoutError: browserType.launch:
  Timeout 180000ms exceeded` and `[chromium-webgpu] studio-real.spec.ts:156 offline: … expect(locator('#engine'))
  … element(s) not found` (60 s). Rerun alone on the same commit: both pass. The machine runs several phase agents.

### What I learned
- N/A

### What was tricky to build
- The converter must keep `{ … } as any` casts on option objects: it merges the positional fields into the literal
  and re-appends the cast.

### What warrants a second pair of eyes
- `ck.ui.button({ run })` replaces `ck.ui.command(id, o)` everywhere; the button reads the command's label, key and
  enabled state when `run` is a string, as before.

### What should be done in the future
- N/A

### Code review instructions
- `packages/shell/src/build/ck.ts` (`box`, `leaf`, `control`, `when`, `pick`); `packages/shell/test/build/build.test.ts`
  ("uniform signatures").

### Technical details
- Before → after: `ck.section('Light', { reset: true }, …)` → `ck.section({ title: 'Light', reset: true }, …)`;
  `ck.ui.slider(0, 5, { … })` → `ck.ui.slider({ min: 0, max: 5, … })`; `ck.ui.segmented(opts, { bind })` →
  `ck.ui.segmented({ options: opts, bind })`; `ck.ui.toggle('Lock', o)` → `ck.ui.checkbox({ label: 'Lock', switch: true, … })`;
  `ck.hud(opts, v)` → `ck.hud(v, opts)`.

## Step 5: Typed state and one set of selectors (cb.sel)

Rule 6: the studio's state is declared with types in one module and read through typed selectors. Before, `current`
existed in cb.ts, in the finish kit's state.ts, as `cur` in two DOM files and inline in the roll kit; `cb.current`,
`cb.frame`, `cb.recipe`, `cb.visible`, `cb.library` sat next to the vocabulary. Now `packages/studio-kit/src/sel.ts`
holds `CbState` and `sel`, and `cb.sel` is that object.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** §32 "Typed state per kit, read through `cb.sel.*`; one `current`" and §31 rule 3
(interaction lambdas read state through typed selectors); CHB-029 item 7.

**Inferred user intent:** A layout or an agent can read every piece of state the same way, typed.

**Commit (code):** 6ec19b0 — "CHB-037 P5a step 4: typed state and one set of selectors (cb.sel)"

### What I did
- `src/sel.ts`: `CatalogFrame`, `Selection`, `Snapshot`, `CbView`, `CbUi`, `CbPrefs`, `CbState` and
  `sel = { current, selection, targets, frame, recipe, entry, name, library, visible, isOffline, kind, proposals,
  snapshots, prefs, view, module, tool, host }`, total on partial states.
- cb.ts, the kits, the DOM half and the layouts read through `sel` / `cb.sel`; the duplicates are deleted; the index
  exports `sel` and the state types instead of `current`, `visibleFrames`, `libraryFrames`, `isOffline`.
- `CORE_STATE` is typed `Pick<CbState, …>`; cb.core's command and tool tables are `CommandTable<CbState>` /
  `ToolTable<CbState>`, so `ctx.state` is typed in every core handler.
- `test/sel.test.ts`.

### Why
- One reader per fact; typed reads give the editor (and later the agent's d.ts) the state's shape.

### What worked
- 114 files, 2855 passed after one test fix (below).

### What didn't work
- `expected { version: 2, …(12) } to be { version: 2, …(12) } // Object.is equality`: the store hands out read-only
  proxies, so `sel.recipe(s)` is equal to, not identical with, `s.recipes[f]` read through another proxy; `toEqual`.
- My first `perl -pi` over `$FILES` did nothing in zsh (`Can't open packages/studio-kit/CONTRACT-REQUESTS.md …`):
  zsh does not word-split an unquoted variable; `grep -l … | xargs perl -pi …` works.

### What I learned
- Kit selectors belong in the kit's product (`cb.kits.roll.sel.roll`, `cb.kits.looks.sel.print`, Step 6).

### What was tricky to build
- `sel.ts` must not import cb.ts (cb imports it, and so do the kits and the DOM half); the handle helper
  (`frameRef`) comes from `handles.ts` directly.

### What warrants a second pair of eyes
- `sel.targets` (selection, else current) replaced cb.ts's private `targets(ctx)`; it reads `ctx.state`.

### What should be done in the future
- Type the layouts: JS layouts are outside tsconfig; adding `allowJs` + `// @ts-check` with `LayoutDef` typed by
  `Ck<CbState>` and `Cb` would give layout authors errors (CHB-029 item 7's last clause).

### Code review instructions
- `packages/studio-kit/src/sel.ts`; `grep -rn "selection?.primary" packages/studio-kit` finds only sel.ts.

### Technical details
- Before → after: `cb.current(s)` → `cb.sel.current(s)`; `cb.frame(s)?.print()` → `cb.sel.frame(s)?.print()`;
  `cb.recipe(s)` → `cb.sel.recipe(s)`; `cb.visible(s)` → `cb.sel.visible(s)`; `isOffline(s, id)` → `sel.isOffline(s, id)`.

## Step 6: One kit product shape; cb.modules; no layout imports another

Rule 7 and CHB-029 item 4. Every `cb.kits.*` is now the same shape, made by `ck.product(kit, parts)`: `{ kit, panels,
views, modules, menus, keys, sel, lib, whenAbsent }` plus the kit's `tools` and `commands` (ids) and `docs`. The
modules that layouts imported from `classic.js` and `finish-module.js` moved to their owners (`cb.modules.library`,
`cb.modules.print`, `roll.modules.roll`, `finish.modules.finish`, `looks.modules.print`, `chat.modules.assistant`),
so every layout is an equal composition of kit parts and imports nothing.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** §32 "Every kit exposes the same product: kit.panels.*, kit.modules.*, kit.tools,
kit.commands, kit.docs" and "layouts compose kits only"; CHB-029 item 4 (`cb.modules.*`, `cb.menus.*`).

**Inferred user intent:** Any arrangement (including one an agent writes) is built from the same parts.

**Commit (code):** 2242c12 — "CHB-037 P5a step 5: one kit product shape; cb.modules, cb.panels, cb.views; no layout imports another"

### What I did
- Shell: `ck.product(kit, parts)` / `KitProduct` (kits.ts) — frozen, with `tools`/`commands` ids and `docs` from the kit.
- roll: `panels { library, setup, balanceBar, inspector }`, `views { contactSheet, contactCell }`, `modules { roll }`,
  `menus { roll }`, `keys { cull }`, `sel { roll, frames, badge, tag, contact }`, `lib { state, batch, applyBatch,
  exposure }`. finish: `panels { crop, retouch, tones }`, `views { viewer }`, `modules { finish }`, `keys { finish }`,
  `sel { shown }`, `lib { state, edits, spots, cropProblem, largestCrop }`. looks: `panels { library, params, amount,
  diff, card, groups, presets, compare }`, `views { survey, cell, choice }`, `modules { print }`, `keys { looks }`,
  `sel { print, before, looks, byId, view, diffOf, syncGroups, batches }`, `lib { … authoring, provider, errors }`.
- chat became a kit: `ck.kit('cb.chat')` declares the `cb.chat` form (moved out of CB_FORMS); `panels { chat }`,
  `modules { assistant }`, `lib { MODES, EFFORT_LABELS }`; classic and lab `.use(cb.kits.chat.kit)`.
- cb (cb.core's product): `cb.panels.*` (was `cb.panel.*`, plus `tools`, which was classic.js's), `cb.views.*`
  (`cb.view` and `cb.views` merged), `cb.modules.{ library, print }`, `cb.menus`, `cb.keys`, `cb.sel`.
- `whenAbsent` replaces each kit's `missing` (the check cb.core's `cb.kits` pass runs where the kit is absent).
- Layouts rewritten; `variants/finish-module.js` deleted; `check-boundaries.ts`: a layout imports nothing, the
  registry (`index.js`) only its sibling layouts.

### Why
- Four product shapes (a Kit, a helper object, a function returning modules, a curried module recipe) made every
  layout learn each kit separately.

### What worked
- 114 files, 2855 passed; boundary check ok (426 file checks).

### What didn't work
- `TypeError: Cannot read properties of null (reading 'frames')` in looks/kit.test: the looks model reached
  `cb.kits['roll'].of(s)`, now `cb.kits['roll'].sel.roll(s)`.
- `git rm -q finish-module.js && cat > classic.js …` stopped at `git rm` ("the following file has local
  modifications"), so classic.js kept its old body while the other heredocs ran; `git rm -qf` and rewrote it.

### What I learned
- A product cannot be the Kit value itself: §32 wants `kit.tools`/`kit.commands` (id lists) and `kit.docs`, which
  collide with the kit's chain methods `.tools(table)`, `.commands(table)`, `.docs(md)`. The product holds the kit.

### What was tricky to build
- Product typing: `cb.kits` stays `Record<string, any>` because each kit's type depends on `Cb` and `Cb` on the kits
  (a cycle TypeScript reports as an implicit any); the products themselves are precisely typed (`ck.product` returns
  `KitProduct<K> & P`).

### What warrants a second pair of eyes
- classic and lab now install the chat kit (the `cb.chat` form is the chat kit's); a layout that places
  `chat.panels.chat()` without `.use(chat.kit)` gets CK-B160 "No form 'cb.chat'".

### What should be done in the future
- Type `cb.kits` without the cycle (an interface per product written by hand) for layout authors.

### Code review instructions
- `packages/shell/src/build/kits.ts` (`product`), each `kits/*/src/kit.ts` (the `ck.product(…)` at the end), `cb.ts`
  (`panels`, `views`, `modules`), the layouts.

### Technical details
- Explain snapshot change: classic and lab list `cb.chat@1 (requires cb.core)` among their kits (only that line).
- Layout before → after (roll): `import { menus, printModule, rollMenu, rollModule } from './classic.js'` …
  `s.module('roll', m => rollModule(ck, cb)(m).key('G'))` → no import; `.module(roll.modules.roll().key('G'))`.

## Step 7: Host capabilities typed at mount; one command table per area

Rule 8 and CHB-029 items 1 and 3. The host's actions were string lookups through state (`hidden: s =>
!hostHas(s, 'openFiles')`, `run: ctx => hostRun(ctx, 'openFiles')`) with the list of action names published into
`ui.host.actions`. Now a command declares `requires: 'host.openFiles'`; the runtime answers from its services, and
without the capability the command is hidden and refuses to run. In the same step cb.core's one 300-line command
table became one declarative table per area under `packages/studio-kit/src/commands/`.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** §32 "Host capabilities typed at mount; commands declare `requires`" and CHB-029 item 3
("split createCb() by area … each exporting a declarative command table").

**Inferred user intent:** A host offers what it can, typed; the DSL decides what shows, in one place.

**Commit (code):** a5177d8 — "CHB-037 P5a step 6: host capabilities typed at mount; one command table per area"

### What I did
- Shell: `CommandSpec.requires?: string | string[]` ('<service>.<member>'); `Commands.capable` (the runtime's
  `capable(req)`: a function at `services[service][member]`, `host` read from the runtime's current host);
  `hidden()` and `status()` fail without it ("Not available in this window", the old `hostRun` toast);
  `Services.host`, `rt.setHost(host)`, `ctx.host`.
- studio-kit: `StudioHost` documented as the typed capability set; `Studio.services()` passes `host`; `attach` and
  `setHost` hand it to the runtime; `HostFlags` lost `actions` (ui.host keeps folder, layouts, layout: what labels
  and menus read). `hostHas`/`hostRun` deleted.
- `src/commands/{env,frame,host,view,print,agent,tools}.ts`: the shared helpers and six tables; cb.core is
  `.commands(frameCommands()).commands(hostCommands())…tools(coreTools())`. The split was done by a script that cut
  the table by command id (and checked that every id landed in exactly one area); `host.ts` was then rewritten by
  hand to `requires`.
- Test: "host capabilities" in build.test (hidden, refused with the toast, runs with a host, hidden after
  `setHost(null)`).

### Why
- Capabilities are not state: they were mirrored into the store only so `hidden` lambdas could read them.

### What worked
- 114 files, 2856 passed; browser at 2242c12 (steps 3–5): 108 passed (4.3 min).

### What didn't work
- First typecheck after the split: `Cannot find name 'needFrame'` in frame/print/view — my import scan used
  `(?<![\w.])needFrame`, which misses `...needFrame`; added the imports.

### What I learned
- Only menus and the palette ask `commands.hidden` (when they open), so capabilities need no reactivity in the store.

### What was tricky to build
- `file.export` does not require `host.exportPrint` (it falls back to `output.save`); it asks `ctx.rt.capable(…)`.

### What warrants a second pair of eyes
- The first mount of apps/studio still calls `studio.setHost(hostActions)` just after `mountStudio` (its actions
  close over the runtime); later mounts (layout switch) receive the host in their services at mount.

### What should be done in the future
- Build apps/studio's host actions before the first mount so every mount gets `services.host` up front.

### Code review instructions
- `packages/shell/src/core/commands.ts` (`supplied`), `app/runtime.ts` (`capable`, `setHost`, `ctx.host`);
  `packages/studio-kit/src/commands/host.ts`, `src/studio.ts` (`services`, `attach`, `setHost`).

### Technical details
- Explain snapshot change: the commands section lists cb.core's commands by area (frame, file/host, view, print,
  agent) instead of the old interleaved order; no command, label, menu or key changed.
- Before → after: `'file.open': { label: 'Open Files…', menu: 'File', hidden: s => !hostHas(s, 'openFiles'), run:
  ctx => hostRun(ctx, 'openFiles') }` → `'file.open': { label: 'Open Files…', requires: 'host.openFiles', run: ctx =>
  host(ctx).openFiles!() }`.

## Step 8: variant → layout

Rule 9 and CHB-029 item 9: the UI said "Layout", the code said "variant". Hard cut-off: one name, no alias.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Rename the API, the folder, the boundary script, tests, demos, e2e and the URL option
(`?layout=` is the one name; the task says to keep it working as the one name).

**Inferred user intent:** The code speaks the photographer's word.

**Commit (code):** e317b43 — "CHB-037 P5a step 7: variant is called layout everywhere"

### What I did
- `git mv packages/studio-kit/variants packages/studio-kit/layouts`, `src/variant.ts → src/layout.ts`,
  `test/variants.test.ts → layouts.test.ts` (and its snapshot file).
- perl over every file in scope that mentions it: `VariantDef/Env/Id`, `BuiltVariant`, `defineVariant`,
  `buildVariant`, `VARIANTS`, `DEFAULT_VARIANT`, and the words (not `font-variant`, not first-print.ts's "the
  comparison script's variant"). The package export is `./layouts`; `?layout=`, `body[data-layout]`,
  `window.chromobench.layout`. `apps/studio/DEMO.md` follows the URL option.
- One identifier was renamed wrongly and restored: e2e/studio.spec.ts's `variant(n)` makes a variant of a file.

### Why
- §32 last row.

### What worked
- `git show HEAD:…/variants.test.ts.snap | sed 's/variants build headless/layouts build headless/' | diff - …/layouts.test.ts.snap`
  → identical: the rename changed no explain output.
- 114 files, 2856 passed.

### What didn't work
- N/A

### What I learned
- There was no saved layout preference to migrate (the layout is a URL option), so the cut-off costs nothing.

### What was tricky to build
- Blanket word renames catch other senses of the word; I read the e2e and app diffs line by line.

### What warrants a second pair of eyes
- Bookmarks with `?variant=` now open the default layout (no alias, by the owner's rule).
- `docs/HANDOFF.md` (outside my scope) still mentions `?variant=`.

### What should be done in the future
- Update `docs/HANDOFF.md` (`?variant=` → `?layout=`).

### Code review instructions
- `git show e317b43 --stat`; `grep -rni variant packages/shell packages/studio-kit apps/studio e2e` finds only
  `font-variant` and first-print.ts.

### Technical details
- Before → after: `import { DEFAULT_VARIANT, VARIANTS, type VariantId } from '@chromobench/studio-kit/variants'` →
  `import { DEFAULT_LAYOUT, LAYOUTS, type LayoutId } from '@chromobench/studio-kit/layouts'`.

## Step 9: The rules written down; final checks

The last step documents the language in `packages/shell/README.md` (the rules a layout or kit author follows: values
and modifiers, the forms, binding times, `ck.extend`, kits declare and layouts place, the product shape, scopes,
host capabilities, diagnostics) and runs every check once more. The README's examples were run headless in a scratch
vitest file (outside the repo) before committing.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Acceptance: "Document the rules in the shell's README or docs"; all checks and the
browser suite green.

**Inferred user intent:** The next agent (P5b, the stack kit) can write kits and layouts from the README alone.

**Commit (code):** aec7c5f — "CHB-037 P5a: packages/shell/README.md states the UI DSL's rules"

### What I did
- Wrote `packages/shell/README.md`; ran its kit/shell/host example in a scratch test (1 passed).
- Final: `pnpm typecheck && pnpm lint && pnpm gen:check && pnpm test` → green, 114 files, 2856 passed, 19 skipped
  (baseline 113 / 2850; new: sel.test.ts and tests for builder values, signatures and host capabilities).
- Browser at e317b43, side worktree, `STUDIO_PORT=5551 STUDIO_KIT_PORT=5552 SHELL_DEMO_PORT=5553 GPU_PARITY_PORT=5554
  CI=1 pnpm test:browser` → 108 passed (4.1 min).

### Why
- §6 P5a acceptance.

### What worked
- Every browser run on a committed step was green or had only load flakes that passed when rerun (Steps 2, 4).

### What didn't work
- N/A

### What I learned
- Running the browser suite in a detached side worktree (`git worktree add --detach`) let me keep editing while it ran.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Decisions the design did not make (also in the final report): shell-level regions removed (a single-screen
  layout declares `ck.module('main', …)`); shell `.commands/.tools/.panels/.passes/.fragments` removed (a program's own
  commands live in a kit); kit keys bind in `kit:<name>` = every module; a kit product holds its Kit (`roll.kit`)
  because `kit.tools`/`kit.commands`/`kit.docs` collide with the kit's chain methods; chat became a kit that owns the
  `cb.chat` form; `cb.panel`/`cb.view` became `cb.panels`/`cb.views`; darkroom, simple and tiny place the standard
  menus (their menu bars were generated from `menu:` fields); `ck.ir`/`ck.run` (standalone IR passes) kept.

### What should be done in the future
- CHB-029 items 5 (status bar and dialogs in the DSL) and 6 (jobs) are not done; item 8 belongs to the contract.
- Layout type checking (`allowJs` + `// @ts-check` on `layouts/*.js`), a hand-written type for `cb.kits`.
- `docs/HANDOFF.md`: `?variant=` → `?layout=`.

### Code review instructions
- Read `packages/shell/README.md`, then the commits in order: 4afeb8d, 3585c1f, 03bdaa4, 6ec19b0, 2242c12, a5177d8,
  e317b43, aec7c5f.

### Technical details
- Kinds of explain snapshot change over the phase (layouts): commands show the menu that places them; one more key
  scope (`kit:cb.core`); two passes fewer (`cb.kits`); classic and lab install `cb.chat`; commands listed by area.
  Elsewhere: the mini studio's commands come from the kit `mini`; `controls("darkroom")` shows each control's words.
