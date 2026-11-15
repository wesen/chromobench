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
RelatedFiles: []
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
