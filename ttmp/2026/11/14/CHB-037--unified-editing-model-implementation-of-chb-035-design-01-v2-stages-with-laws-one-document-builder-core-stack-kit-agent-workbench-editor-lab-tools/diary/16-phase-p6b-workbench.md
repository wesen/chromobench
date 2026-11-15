---
Title: Diary — phase P6b workbench
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
    - Path: repo://apps/studio/src/host/workbench.ts
      Note: 'The studio''s host adapter: layout dialog, agent looks (commit 5d74cc3)'
    - Path: repo://apps/studio/src/main.ts
      Note: switchLayout with a LayoutDef (commit 5d74cc3)
    - Path: repo://packages/agent/src/worker/client.ts
      Note: serveWb, the page's wb entries (commit 5d74cc3)
    - Path: repo://packages/agent/src/worker/server.ts
      Note: ProxyWorkbench (commit 5d74cc3)
    - Path: repo://packages/contract/src/eval.ts
      Note: Show, EvalResult.shows (commit 2c29a21)
    - Path: repo://packages/dsl/src/prelude/prelude.ts
      Note: wb and the layout recorder (commit 5d74cc3)
    - Path: repo://packages/dsl/src/session.ts
      Note: hostCall, wbAnswer, wb entries in EvalResult.transactions (commit 5d74cc3)
    - Path: repo://packages/dsl/src/workbench.ts
      Note: The workbench port and its data types (commit 5d74cc3)
    - Path: repo://packages/shell/src/app/introspect.ts
      Note: Command table, controls, reachable commands (commit 2c29a21)
    - Path: repo://packages/shell/src/core/store.ts
      Note: Store.acting (commit 2c29a21)
    - Path: repo://packages/studio-kit/kits/chat/src/workbench.ts
      Note: studioWorkbench, realizeLayout (commit 5d74cc3)
    - Path: repo://packages/studio-kit/test/chat/workbench.test.ts
      Note: The two completeness tests (commit 5d74cc3)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T02:53:16.085904-05:00
WhatFor: ""
WhenToUse: ""
---



# Diary

## Goal

The phase agent's record of phase P6b of CHB-037: the agent's workbench. An agent that has only `eval` reaches the
whole studio: the command table (`wb.commands`, `wb.run`), the state through typed selectors (`wb.state`), the
screen with live values (`wb.screen`), layouts written in the sandbox that cross as data (`wb.layouts.build/use`),
plus the renames and small items P6a, P7 and P5b-1 left for this phase.

## Step 1: Reading the spec and the code; the shape of the workbench

The main agent assigned me phase P6b. I read the working rules and the P6b spec (plan §1, §2, §9 and every
"Amendments after …" section), design §31 (binding times) and §34 (the eval-complete workbench), CHB-030's plan
(agent-written layouts), the diaries of P6a (10), P5a (04), P4 (08), P5b-2 (12), P7 (13) and the shell README, then
the code the workbench sits on: the DSL's host, prelude and session, the agent's worker protocol, server and client,
the studio's chat host and `main.ts`, the shell's runtime (`explain`, the command table, the store's
`commitWrites`), studio-kit's selectors and layouts. Before writing the workbench I listed every control of every
built layout with a throwaway script (`<scratchpad>/p6b-tmp/enum.ts`, `binds.ts`).

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all
together and add the editor lab functionality / consolidate it all." and "also agent manipulatable / an agent
having only eval can basically cover all the necessary functionality and introspection into the workbench"

**Assistant interpretation:** The main agent assigned me P6b: `wb` in the DSL (commands, run with agent provenance,
state through typed selectors, screen().explain() with live values, layout(), layouts.build(src)/use(layout) with
layouts crossing the sandbox as data, checked by the passes, use as a proposal), the two completeness tests, the eval
Look → show renames, `log.commit(x, { why })`, the chat approval card in words, `frame.get` through links,
`cb.looks.define(src)`; the sandbox rules hold (data and names cross, never functions into stored values).

**Inferred user intent:** The agent sees and drives everything the photographer sees and drives, through the same
commands, transactions and selectors, so no part of the studio is out of its reach and nothing drifts.

### What I did
- Read the documents and code above; enumerated controls of the eight built layouts: buttons run command ids (some
  with arguments, `['ring.apply', [..], 'label']`), `cb.arg` controls carry a document path, bound controls
  (`segmented`, `slider`, `select`, `checkbox`) write state paths of the view tier (`view.view`,
  `finish.spot.r`, `rollView.contact.mode`, `looksView.group`); no handler lambdas on built-in controls. Composite
  kit widgets (`stack.layers`, `cb.history`, `roll.*`, `looks.*`) draw their own rows; their actions are their
  kits' commands (P5b-2).

### Why
- The completeness tests and the agent surface must rest on what the built programs really contain.

### What worked
- Everything the workbench needs already exists in pieces: `Runtime.explain({ live })`, the command table with
  `status/label/hidden`, `KeyRouter` bindings with arguments, `menuIndex`, `bindingPath` (a bind lambda → its path),
  the DSL's deferred host calls (measurements), the worker's request/response protocol (the engine proxy).

### What didn't work
- `node ../p6b-tmp/enum.ts` first failed with `ERR_MODULE_NOT_FOUND: Cannot find package '@chromobench/shell'`: the
  worktree had no `node_modules`; `pnpm install --frozen-lockfile --prefer-offline` fixed it.

### What I learned
- The sandbox is in a worker and synchronous host calls are answered from worker-local data, so everything that
  reads the live studio (commands, state, screen) or acts on it (run, layouts) must be a deferred call answered by
  the page: in the agent's code it is awaited, like a measurement.

### What was tricky to build
- N/A (reading and design).

### What warrants a second pair of eyes
- The decisions below that the spec did not make.

### What should be done in the future
- N/A

### Code review instructions
- Read the decisions below against design §31 and §34.

### Technical details

Decisions (the spec did not make them):

1. **Every `wb` call is awaited.** `await wb.commands()`, `await wb.run(id, ...args)`, `await wb.state('frame')`,
   `await wb.screen()`: they are deferred host calls the page answers (a new `hostCall` beside `hostEval`), so they
   are the same in the worker and in-process, and an unawaited one gets the UNHANDLED warning measurements get.
   `wb.screen()` returns a promise that also has `.explain()` (`await wb.screen().explain()`).
2. **The page decides, as for edits.** A command the agent runs is the same command a key runs, by the agent
   (`Store.acting`): ask mode turns its document edits into proposals (cards in the chat, like an eval's edits),
   auto commits them with the agent as author and its reason, read-only refuses document edits (view-tier writes,
   like switching module, always land). Its effect shows in the next eval's reads (an eval reads the log as it was
   when it started), and at once in `wb.state` and `wb.screen`.
3. **A control maps to a document path, a state path or a command.** Bound controls of the view tier write state
   paths, so `wb.set(path, value)` writes a state path exactly as a bound control does (`store.set`: the view tier
   directly, a document-tier path as one transaction by the agent). The completeness test accepts those three.
   Composite kit widgets are views whose actions are their kits' commands; the first completeness test covers those.
4. **Agent layouts are recorded, not run, in the sandbox.** In `wb.layouts.build(def)` the layout's
   `build(ck, cb, env)` runs in the sandbox on recording proxies: every `ck.*`/`cb.*` call becomes data (a path of
   names and arguments). The page replays the recording on a fresh ck and cb, builds the app (the passes run) and
   answers with diagnostics, the explain and the controls. Interaction lambdas cannot cross: a function where an
   option goes is E_LAYOUT; selectors are written `cb.sel.frame.print()` (a selector, then calls on its result),
   state paths `cb.state.view.step`, handlers as command ids. Build-time lambdas (`.with(s => …)`) run in the
   sandbox on the recording. `wb.layouts.use(layout)` asks the photographer (a dialog); approved, the studio mounts
   it like View ▸ Layout.

## Step 2: Renames, log.commit with why, frame.get through links, the shell's introspection, Store.acting

The small items first, so the workbench builds on settled names: "look" now means only a named look (a link), an
image the eval returns is a show; an agent's commit in auto mode keeps its reason; `frame.get` of a linked medium
field answers what the compiler sees. The shell gained what introspection needs: the command table as data, the
controls of a program with what they write, every command a person can reach, one module's live explain, and a way
to run a command as the agent.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Do the renames, `log.commit(x, { why })`, `frame.get` through `readField`, and the
shell introspection the workbench and the completeness tests need.

**Inferred user intent:** One vocabulary and a shell that can describe itself to the agent as data.

**Commit (code):** 2c29a21 — "CHB-037 P6b: eval images are shows (Look → Show, EvalResult.shows, SHOWS; contract
1.3.0, CC-022 with E_WORKBENCH and E_LAYOUT); log.commit(x, { why }); frame.get reads linked media through the link;
the shell's introspection … and Store.acting (agent author, propose, refuse)"

### What I did
- Contract: `Show`, `EvalResult.shows`, `EVAL_LIMITS.shows`, warning `SHOWS`; new codes `E_WORKBENCH`, `E_LAYOUT`;
  `CONTRACT_VERSION` 1.3.0; CC-022 in `CONTRACT-DECISIONS.md`. Consumers: dsl session/results, agent worker,
  chat session (`ShowView`), bridge page client (`ShowPayload`), chat kit (`ChatShow`, "image N:" captions), tests.
- values: `commit(x, { merge, why })` keeps `why` on the entries; the DSL's door passes the reason in auto mode;
  test that it survives `toJSON`/`load`; README.
- dsl: `Host.get` reads a linked medium field with `readField(doc, path, links())` (`storedPath(doc, path) !==
  path`); the roll test in `looks.test.ts` reads `stages.scan.medium.stock` and `.scanner` through the link.
- shell: `app/introspect.ts` (`commandTable`, `controlsOf`, `reachableCommands`, `paramNames`), `Runtime.
  commandTable()/controls({ module })/reachable()`, `explain({ live, module })` (one module, no command list),
  `Store.acting(actor, fn)` with `Actor { by, source, why, propose, refuse }`; `test/app/introspect.test.ts`.

### Why
- P6a's and P7's notes; the workbench is a thin adapter over the shell's own description of itself.

### What worked
- `pnpm typecheck` 0 errors; `pnpm exec vitest run packages/dsl packages/agent packages/values packages/contract
  packages/studio-kit/test/chat` → 35 files, 299 passed; `pnpm exec vitest run packages/shell` → 113 passed;
  `pnpm gen` then `pnpm gen:check` ok (26 files); `pnpm lint` ok.

### What didn't work
- `sed -i '' -E 's/\b(r|…)\.looks\b/…/'` changed nothing: BSD sed has no `\b`; `perl -pi -e` did it. One
  over-eager replacement (`r.looks` of the bridge's wire message in `bridge-page.test.ts`) put back by hand.
- The command table's first test expected `Mod+1`; the keymap stores chords normalised (`mod+1`).
- `ValueError({ code: 'E_READONLY' })` does not compile in the shell (values' codes are closed): the refusal is an
  `Error` with `code: 'E_READONLY'`, which the runtime's refusal toast reads the same way.

### What I learned
- The Go hub (`bridge/internal/hub`) names the eval's images `looks` on the wire; renaming it is Go work outside my
  scope, so the TypeScript side keeps the wire name with a comment.

### What was tricky to build
- `Store.acting` in ask mode: a command's transaction becomes `log.propose` of the same edit or batch, while its
  view-tier writes (a selection, a module) land in the same notify, so the screen follows and the document waits.

### What warrants a second pair of eyes
- `paramNames` reads a handler's parameter names from its source text (after `ctx`); a command may declare `args`
  instead. Minified production builds would rename parameters (the studio is not minified today).

### What should be done in the future
- Rename the hub's wire field `looks` → `shows` in `bridge/internal/hub` and the page client together.

### Code review instructions
- `packages/shell/src/app/introspect.ts`, `packages/shell/src/core/store.ts` (`acting`, `commitWrites`),
  `packages/contract/src/eval.ts`, `packages/values/src/log.ts` (`commit`).
- `pnpm exec vitest run packages/shell/test/app/introspect.test.ts packages/values/test/log.test.ts packages/dsl`.

### Technical details
- `CommandRow { id, label, group?, source?, doc?, menu?, keys: { chord, scope, args? }[], args, enabled, why?,
  hidden, checked?, builtin, requires? }`; `ControlRow { module, panel, form, label?, bind?, path?, command?, args?,
  lambda?, value? }`; `Reach { id, args?, from: key|menu|button|toolbar|control, where }`.

## Step 3: The workbench — wb in the sandbox, across the worker, over the studio; the completeness tests

`wb` is one more prelude global whose every call is a deferred host call (`hostCall`, beside the measurements'
`hostEval`), answered by a `Workbench` the session is given (`DslSessionOptions.workbench`). Across the worker it is
one more request/response pair (`wb` / `wb.reply`), like the engine's. In the studio the workbench is studio-kit's
`studioWorkbench` (in the chat kit, the agent's kit), which reads the shell's own introspection, runs commands under
`Store.acting`, and builds layouts by replaying the sandbox's recording on a fresh ck and cb. The two completeness
tests passed the first time they ran over the eight built layouts.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Build `wb` (commands, run, set, selectors, state, screen, layout, layouts.build/use),
`cb.looks.define`, the chat card in words, and the two completeness tests.

**Inferred user intent:** The agent can do and see everything the photographer can, through the same table.

**Commit (code):** 5d74cc3 — "CHB-037 P6b: the workbench - wb in the DSL (…), the wb protocol across the worker,
studio-kit's studioWorkbench (…), the studio's host adapter (…), cb.looks.define, approval cards in the History's
words; the two completeness tests"

### What I did
- dsl: `src/workbench.ts` (the port and its data types: `WbCommand`, `WbRun`, `WbScreen`, `WbControl`,
  `WbLayoutData`, `WbBuild`, `WbUse`, `WB_METHODS`); the prelude's `wb` and the layout recorder (`rec`, `recData`,
  `recordLayout`); the session's `hostCall`/`deferred`/`wbAnswer` (filter for `wb.commands(filter)`, read-only
  refusal of `use`, the entries of `wb.run`/`wb.set` appended to `EvalResult.transactions`); `cb.looks.define`
  (`looks.define` native: `defineLookWith(QJS, src)` registers here; then `wb.defineLook` registers at the host);
  `test/workbench.test.ts` (6 tests on a fake workbench).
- agent: protocol `wb`/`wb.reply`, `init.workbench`; `ProxyWorkbench` in the server; `DslWorkerClient` option
  `workbench`, `serveWb`, the running eval's wb entries kept on the page's seqs; `ChatHost.describe` and
  `changesOf(entries, words, log)`; re-exports `defineLookSource` and `Workbench` for the studio host; tests.
- studio-kit chat kit: `src/workbench.ts` — `studioWorkbench(host)`, `realize`/`realizeLayout`, `selectorTable`,
  `toData`; `test/chat/workbench.test.ts` (4 behaviour tests and the two completeness tests).
- studio: `host/workbench.ts` (`createWorkbench`: the layout proposal as a dialog "Use the assistant's layout?",
  looks via `defineLookSource(src, { existing: 'keep' })`); `host/chat.ts` (workbench for every DSL session: chat,
  bridge, dev; `describe` from studio-kit's History words); `host/lazy-chat.ts` passes `layouts`; `main.ts`: the
  `layouts` host for the chat and `switchLayout(v: string | LayoutDef)` (an agent layout mounts in place, no
  `?layout=` for it, `agentLayout` flag) — the one change outside my files, needed to mount a layout.

### Why
- Design §34's two principles; the recording keeps §31 rule 3 (interaction lambdas are the host's own: selectors and
  path lambdas built by the realizer from names) and rule 1 (nothing but data and names crosses).

### What worked
- Completeness: over classic, darkroom, simple, lab, tiny, roll, finish, looks — every command a key, a menu, a
  toolbar or a button reaches is in `wb.commands()`; every control (> 100) maps to a document path, a state path or
  a command.
- The recorder handles `...cb.menus.standard()` (iterator → `{ $spread }`), `{ ...cb.keys.darkroom }` (one own key
  `$spreadN` per recording), `.with(fn)` at build time, `cb.sel.frame.print()`, `cb.state.view.step`.
- An agent layout with `cb.kits.stack.panels.layers('print')` in a darkroom-only module gets CB-S101 from the stage
  policy pass, as a built-in layout would.

### What didn't work
- First prelude load: `SyntaxError: expecting ','` at `prelude.js:359:146`: my Python edit turned `\'` into `'`
  inside a single-quoted guest string; the hint now uses double quotes.
- `expected 'shell "Chromobench" · theme craftkit …' to match /^module main/`: the module explain still starts with
  the shell's header line; the test reads the second line.
- The worker test expected `dsl-eval-1`; the test page's session prefix is `chat1` (`chat1-eval-1`).

### What I learned
- The shell's `bindingPath` (probe mode) resolves the realizer's selector lambdas to state paths exactly as it does
  hand-written ones, so explain, the binding checks and the completeness test see no difference.

### What was tricky to build
- **Proxy invariants for the recorder.** A recording must be callable (`ck.module(…)`) and spreadable both ways. The
  target is an arrow function (no non-configurable `prototype`, so `ownKeys` may report only the spread key), the
  `get` trap answers `Symbol.iterator` with a generator yielding `{ $spread: expr }`, and `ownKeys` /
  `getOwnPropertyDescriptor` expose one enumerable key `$spreadN` whose value is the expression, so `{ ...a, ...b }`
  keeps both.
- **The mode for a command.** `Store.acting` is synchronous: an async command's writes after its first `await` are
  by the user (as before). The studio's document commands write synchronously (ctx.tx).

### What warrants a second pair of eyes
- `realizeExpr` walks names on the real ck/cb objects: it refuses `__proto__`, `constructor`, `prototype`,
  `call/apply/bind` and names starting with `_`, and calls only what it finds. A layout can still call any public
  builder of ck and cb (that is the point), including `ck.ui.button({ run: 'file.export' })`.
- Build-time queries (`stack.has('scene')`) answer a recording (truthy) in the sandbox.

### What should be done in the future
- Persist agent layouts (KV, View ▸ Layout lists them) and agent looks (re-registered at start); today both last the
  page's session (a reload falls back to `?layout=` and a document linking an agent look fails with E_LINK).
- A lighter worker snapshot than `Log.load` per change (P6a's note) was not needed by the workbench; not done.

### Code review instructions
- `packages/dsl/src/prelude/prelude.ts` (recorder, `wb`), `packages/dsl/src/session.ts` (`wbAnswer`),
  `packages/studio-kit/kits/chat/src/workbench.ts`, `apps/studio/src/host/workbench.ts`, `apps/studio/src/main.ts`
  (`switchLayout`).
- `pnpm exec vitest run packages/dsl/test/workbench.test.ts packages/studio-kit/test/chat packages/agent`.

### Technical details

```js
await wb.commands('frame.')                 // [{ id, label, args, keys: [{ chord, args }], menu, enabled, why, hidden }]
await wb.run('module.print')                // the D key; { ok, how: 'none', module: 'print' }
await wb.run('frame.rate', 4)               // ask: { how: 'proposed', entries: [pending by agent] }; auto: 'committed'
await wb.set('view.view', 'loupe')          // a state path, as the View control writes it
await wb.state('frame')                     // { $: 'cb.frame', frame, expr }; wb.selectors() lists them
await wb.screen().explain()                 // the module on screen, live; (await wb.screen()).controls
const b = await wb.layouts.build({ id: 'just-print', label: 'Just the print', build: (ck, cb) => cb.studio('Chromobench')
  .menus(...cb.menus.standard())
  .module(ck.module('main', { label: 'Print', stages: ['darkroom'] })
    .center(cb.viewer(cb.sel.frame.print(), { tools: ['probe'] }))
    .right(ck.dock.column({ width: 300 }, cb.panels.controls('darkroom'), cb.panels.history().hidden(cb.sel.doc.not())))) })
// b: { ok, errors, warnings, explain, controls, layout }; mem.l = b.layout
await wb.layouts.use(b, { why: 'fewer panels' })   // { status: 'proposed' }: a dialog asks; approved, it is mounted
await cb.looks.define(src)                         // a .cblook.js source, registered here and in the studio
```

## Step 4: Docs, the agent's prompt, and the browser spec

The reference gains a Workbench section, the instructions one bullet (still under 4000 characters), the topics a page
"The workbench" (fragments for the calls that need the studio, a runnable E_LAYOUT block and a runnable
`cb.looks.define` block), and the chat's prompt and eval tool say that the studio is `wb`. The browser spec drives the
whole surface from `window.chromobench.eval` in the real studio: commands, a module switch, the live screen, a rating
proposed in ask mode, and a layout the agent writes, proposed in a dialog, accepted and mounted.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Document the surface where the agent reads it, and prove it in the browser.

**Inferred user intent:** The agent finds `wb` without being told, and the studio really answers it.

**Commit (code):** 9b2f369 — "CHB-037 P6b: the workbench documented (…), approval cards in the History's words
(test), the browser spec for the workbench (…)"; d6db290 (prompt and eval tool)

### What I did
- `packages/dsl/src/docs/generate.ts` (`WORKBENCH_REFERENCE`, the instructions bullet), `topics/workbench.md`;
  `pnpm gen` (reference, instructions, the bridge's copies, topics module, eval tool text).
- `e2e/chat.spec.ts`: the demo's approval card now says "Printer lights" (the History's words, was the path
  `lights.params.logH`); new test "the workbench: …".
- `packages/agent/test/chat.test.ts`: the card uses the host's words when it has them.

### Why
- The agent reads the instructions, the reference and the topics; the docs test runs every runnable block.

### What worked
- `STUDIO_PORT=5551 STUDIO_KIT_PORT=5552 SHELL_DEMO_PORT=5553 GPU_PARITY_PORT=5554 CI=1 pnpm test:browser --grep
  "chat|agent|bridge|workbench"` → 9 passed (40.5 s), the new workbench test among them.
- `pnpm typecheck` 0 errors, `pnpm lint` ok, `pnpm gen:check` ok (26 files), `pnpm test` → 136 files, 3207 passed,
  19 skipped.

### What didn't work
- `pnpm gen` failed with `SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Expected a semicolon` in `prompt.ts`: the
  outline is a template literal and my new line used backticks; escaped.

### What I learned
- The studio's hook (`window.chromobench`) is re-made for every mounted layout, so after the agent's layout is
  mounted the next `eval` already sees it (`wb.layout()` → `{ id: 'just-print', agent: true }`).

### What was tricky to build
- N/A (docs and tests).

### What warrants a second pair of eyes
- The topic's `wb` blocks are fragments (the docs test has no studio); the same calls run in
  `packages/studio-kit/test/chat/workbench.test.ts` and the browser spec.

### What should be done in the future
- N/A

### Code review instructions
- `packages/dsl/src/docs/topics/workbench.md`, `packages/dsl/generated/reference.md` (## Workbench), `e2e/chat.spec.ts`.

### Technical details
- Instructions length after the bullet: under the 4000-character test limit (`docs.test.ts`).

## Step 5: Merging the integration branch (P8b's editors); the checks again; what P9 must check

The integration branch had P8b's editors (curve, levels, HSL bands, grade wheels, mixer, the colour-mask eyedropper,
the shell's curve and wheel widgets). It merged without a conflict (not even the changelog), and every check passed
again, the completeness tests included: the editors are inside the stack kit's params panel, whose actions are the
stack kit's commands and drafts.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Main agent: "Before you finish, merge the integration branch (`git merge
task/chb-037-unified-model`; the ticket changelog conflicts — keep both sides) and rerun your checks."

**Inferred user intent:** P6b lands on what the other wave-5 phases built.

**Commit (code):** c2da333 — "Merge task/chb-037-unified-model into P6b"

### What I did
- `git merge task/chb-037-unified-model` (528b537, P8b); `pnpm install --frozen-lockfile --prefer-offline`.
- `pnpm typecheck` 0 errors; `pnpm lint` ok (187 files colours); `pnpm gen:check` ok (26 files); `pnpm test` →
  137 files, 3215 passed, 19 skipped.
- Browser, headless on SwiftShader, ports 5551–5554: `--grep "chat|agent|bridge|workbench"` → 9 passed (14.4 s);
  `--grep "layout|Layout|interface|arrangement"` (main.ts's switchLayout changed) → 18 passed.
- Changelog entry, related files, `docmgr doctor --ticket CHB-037` → all checks passed.

### Why
- The working rules; P8b's editors are new controls on screen, which the completeness test must still accept.

### What worked
- Everything above.

### What didn't work
- N/A

### What I learned
- N/A

### What was tricky to build
- N/A (merge and checks).

### What warrants a second pair of eyes
- See Steps 1 and 3 (decisions; the realizer's name walk).

### What should be done in the future
- **P9**: run the persona session with the assistant asking for "a simpler screen" (CHB-030's acceptance): the agent
  should find `wb.layouts.build` from the instructions; check that the dialog reads well and that View ▸ Layout
  returns to a built-in layout; `REAL_GPU=1` runs of the chat spec (the workbench test mounts a layout on the GPU
  engine).
- **Main agent / later**: persist agent layouts and agent looks (Step 3); rename the Go hub's wire field `looks`
  (Step 2); P3b's `apps/studio/src/host/studio-engine.ts` was not touched here.
- An async command's writes after its first `await` are not covered by `Store.acting` (Step 3).

### Code review instructions
- `git log --oneline task/chb-037-unified-model..task/chb-037-p6b-workbench`; the commands above.

### Technical details
- Files outside the listed scope: `apps/studio/src/main.ts` (`switchLayout(v: string | LayoutDef)`, the
  `layouts` host for the chat), `apps/studio/src/host/lazy-chat.ts` (passes it on), `e2e/chat.spec.ts` (the
  card's words, the workbench test), `packages/shell/src/core/store.ts` + `store/types.ts` (`Store.acting`, for
  agent provenance), `packages/shell/src/build/explain.ts` (`module` option), `packages/contract/src/errors.ts`
  (SHOWS, E_WORKBENCH, E_LAYOUT), `packages/contract/src/index.ts` (1.3.0), `CONTRACT-DECISIONS.md` (CC-022).
