# @chromobench/shell — `ck`, the UI DSL

The studio's interface is a program written with `ck` (this package, the CraftKit shell ported to TypeScript) and
`cb` (the studio's vocabulary, `@chromobench/studio-kit`). This README states the rules the language follows
(CHB-035 design 01 v2, §30–§32; CHB-037 phase P5a). Headless code is `@chromobench/shell`; the DOM half is
`@chromobench/shell/dom`; test helpers `@chromobench/shell/testing`.

## One kind of thing: immutable values

Everything a ck instance builds is a frozen value on the builder core (`@chromobench/values`): nodes, modules, menus,
kits and the shell itself. A chain method never changes its receiver; it returns a new value.

- **Every chain method is a modifier.** A modifier is a named function from a value to a value of the same kind;
  `with` applies one. `n.tip('x')` is `n.with(ck.mod.tip('x'))`; `s.theme('craftkit')` is
  `s.with(shellMods.theme('craftkit'))`. `with` also takes a function of the value (`s => s.module(m)`) or a patch
  (on a node, a props patch: `n.with({ density: 'compact' })`).
- **Modifiers are values.** Build one, apply it to many: `const compact = ck.mod.props({ density: 'compact' })`.
  `m1.then(m2)` composes; `ck.mod.when(bool, m)` is a build-time choice (`m`, or nothing).
- **Every value explains itself.** `ck.explain(x)` prints a node, a kit, a pass or a built app as an outline;
  `explain(x)` from the builder core gives the JSON form (kind, call site, data, the modifiers applied).
- **Call sites.** A value records the program line that built it (`at`), so diagnostics point at the layout's line.
  A package that builds values for others registers its directory with `libraryRoot(import.meta.url)`.

```js
const s0 = ck.shell('Studio');
const s1 = s0.theme('craftkit');      // s0 is unchanged
s1.data.theme;                        // 'craftkit'; s1.trail lists the modifiers applied
```

## The forms

| Kind | Signature | Examples |
|---|---|---|
| containers | `(props?, ...children)` | `ck.row`, `ck.column`, `ck.bar`, `ck.scroll`, `ck.grid({ cols })`, `ck.cell`, `ck.section({ title })`, `ck.dock.column({ width })` |
| leaves | `(value, props?)` | `ck.text(v)`, `ck.icon(name)`, `ck.stat(v)`, `ck.kbd(chord)`, `ck.keys(chords)`, `ck.hud(v)`, `ck.statusline(v)`, `ck.tabs(tabs)`, `ck.toolbar(items)`, `ck.dock.tabs(ids)`, `ck.view.list(items)`, `ck.viewport(image)` |
| controls | one props object | `ck.ui.slider({ min, max, bind, step })`, `ck.ui.segmented({ options, bind })`, `ck.ui.select({ options })`, `ck.ui.checkbox({ label, bind, switch })`, `ck.ui.button({ label \| run, icon, quiet })`, `ck.ui.number`, `ck.ui.textField({ search })`, `ck.ui.stepper`, `ck.ui.color`, `ck.ui.curve`, `ck.ui.wheel`, `ck.view.thumb` |
| panels | `ck.panel.define(id, props?, ...children)` defines where it stands; `ck.panel(id)` references one defined elsewhere in the program | |
| choice (τ) | `ck.match(on, cases, { of })`, `ck.when(cond, a, b)` (`cond` a lambda of state), `ck.pick(key, map)` (a selector) | a boolean in `ck.when` is CK-L120: choose at build time with JavaScript or `ck.mod.when` |

One name per form: there are no aliases (`ck.ui.button({ run: 'id' })` is the command button; a switch is
`ck.ui.checkbox({ switch: true })`). Nodes say `enabled` and `why` (never `disabled`), like commands.

## Binding times

Every option of every form declares when it is read (`ir/slots.ts`): **β** once at build; **τ** a lambda of state,
re-run when what it read changes; **bind** a τ lambda naming one state path, two-way; **θ** per item (a row's cell);
**ƒ** a helper of the form's own value; **ρ** a handler (a command id or a lambda). A lambda in a β option is CK-B140.
No lambda is stored in a document; interaction lambdas read state through typed selectors (in the studio, `cb.sel.*`)
and write through commands or transactions.

## State: three tiers, one history

The store (`core/store.ts`) holds one immutable state tree in three tiers (CHB-035 design §26):

- **document**: what the user makes. It *is* the document log of `@chromobench/values` (`store.log`): the program's
  own document state is the log's `main` document; documents the host opens (`store.open(id, doc, { at, kind })`,
  a frame at `recipes.<id>`) show at their path, under their kind's rules (`app.start({ rules })`). A kit declares
  where documents go (`k.mount('recipes', { keyDepth: 1, kind: 'frame', checkPath })`): the build checks bindings
  under it, and initial state under a declared mount opens as one document per key. Every write to the document
  tier (`ctx.tx`, `ctx.set`, a draft's commit) becomes one step of the log: each document's net change is one
  edit, several documents' edits one batch. Undo and redo walk the log's steps (`store.undo()`, `rt.undo()`); a
  refusal by a document's rules aborts the whole transaction (`TxRefused`, toast CK-T430). The host changes the log
  directly with `store.change(log => log.approve(seq))` (proposals, batches from `plan`, loads); `ctx.log.why(doc,
  path)` says who set a value.
- **view**: how the user looks at it (`ui`, `view`, `prefs`, `workspace`, kit slices marked `view`), written
  directly, never undone.
- **preview**: `Draft`s shown over both and never logged: the gesture (`ctx.preview` / `ctx.commit` /
  `ctx.cancel`, one undo step for a whole drag) and named drafts (`ctx.draft('proposal:a1').set(path, v)`, then
  `.commit(label)` or `.drop()`). `ctx.tx`'s lambda gets a `Writer` (`t.dev.p0.light.exposure = 0.3`).

## Extending: fragments, registered first

A fragment adds methods, props and slots to a form (or to the shell or module builders). Its methods are modifier
factories: they return a modifier, a function of the receiver, or a props patch.

```js
const pad = ck.fragment('cb.arg', { when: n => n.props.path === 'print.lights.logH', methods: { pad: () => ({ widget: 'pad' }) } });
const kit = ck.kit('lights').fragments(pad);
ck.extend(kit);                       // this ck's nodes answer .pad() from now on
cb.arg('print.lights.logH').pad();
```

`ck.extend(fragment | kit)` registers the methods before nodes are made. An unknown method is a build error thrown
where it is called (CK-X120, with "did you mean"); a method whose `when` refuses the node is CK-X121. Nothing is
recorded for later. A kit's `.fragments(…)` also puts the fragment's props, defaults and checks into the builds that
install the kit.

## One registration per kind

Kits **declare**; layouts **place**.

```js
const app = ck
  .kit('app')
  .version('1')
  .state('ratings', { init: { stars: {} }, view: ['shown'] })
  .commands({ 'rate.set': { label: 'Set Rating', run: (ctx, n) => ctx.tx(`Rate ${n}`, t => void (t.ratings.stars[ctx.state.ui.photo] = n)) } })
  .tools({ probe: { label: 'Probe', key: 'I', on: { down: (e, ctx) => ctx.set({ ui: { probe: [e.x, e.y] } }) } } })
  .keys(ck.digits(0, 5, 'rate.set'))
  .passes(ck.pass('ratings.check', { on: 'ui', after: 'keys' }, (ir, p) => {}))
  .docs('## Ratings');

ck.shell('Studio')
  .state({ ui: { photo: 'a' } })
  .use(app)
  .menus(ck.menu('Edit', ['edit.undo', 'edit.redo', '-', 'rate.set']))
  .keys({ 'Mod+Shift+R': 'rate.set' })
  .module(ck.module('develop', { label: 'Develop', key: 'D' }).center(ck.viewport(s => s.image, { tools: ['probe'] })).keys({ R: ['rate.set', 5] }))
  .build();
```

| Kind | Declared by | Placed by |
|---|---|---|
| commands | a kit's `.commands({ id: spec })` (a declarative table; no `menu:` field) | menus, keys, toolbars, buttons, the palette |
| tools | a kit's `.tools({ id: spec })` | a viewport's `tools: [ids]` |
| menus | `ck.menu(label, items)` values (kits offer theirs) | the shell's `.menus(...menus)`; menus are the one source of where a command is |
| panels | a kit's product builders (`kit.panels.*`), or `ck.panel.define` where it stands | a module region; `ck.panel(id)` to place one defined elsewhere |
| passes | a kit's `.passes(…)` (there is no instance-global install) | — |
| state | a kit's `.state(key, { init })`; the program's own `.state(init, opts)` | — |
| modules | `ck.module(id, props)` values (kits offer theirs: `kit.modules.*`) | the shell's `.module(m)` |

A module may declare the editing stages it shows (`ck.module('edit', { label: 'Edit', stages: ['print'] })` or
`.stages('darkroom', 'print')`); the shell only records them (and `explain` prints them), a kit's pass checks them
(studio-kit's stage policy, CB-S101).

**What a kit offers a layout** is one shape, `ck.product(kit, parts)`: `{ kit, panels, views, modules, menus, keys,
sel, lib }` plus `tools` and `commands` (the ids it declares) and `docs`.

## Scopes follow the declaration site

| Declared on | Scope | Active |
|---|---|---|
| the shell | `global` | everywhere (no single letters: CK-K210) |
| a module | `module:<id>` | while that module is current |
| a kit | `kit:<name>` | in every module, under the module's own keys |

There is no scope argument.

## Host capabilities

A command declares what it needs as `requires: '<service>.<member>'`. The host passes its capabilities at mount as
`services.host` (and `rt.setHost(next)` when they change); without the capability the command is hidden and refuses
to run ("Not available in this window"). Handlers reach the host as `ctx.host`.

```js
ck.kit('files').commands({ 'file.open': { label: 'Open Files…', requires: 'host.openFiles', run: ctx => ctx.host.openFiles() } });
app.start({ host: { openFiles: () => picker.click() } });
```

## Diagnostics

The build reports in the program's words, at the program's line: CK-Bxxx bindings and options, CK-Dxxx docking,
CK-Kxxx keys, CK-Mxxx match, CK-Vxxx viewport and tools, CK-Xxxx kits, fragments and passes, CK-Lxxx lambdas, CK-Ixxx
information. `app.explain()` prints the whole program (modules, regions, commands with the menu that places them,
key scopes, passes, the diagnostics summary); `rt.explain({ live: true })` evaluates the τ options against the state.
