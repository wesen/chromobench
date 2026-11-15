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
RelatedFiles: []
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
