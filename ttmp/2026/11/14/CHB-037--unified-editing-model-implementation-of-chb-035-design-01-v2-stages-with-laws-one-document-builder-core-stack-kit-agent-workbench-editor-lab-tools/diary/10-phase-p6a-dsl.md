---
Title: Diary — phase P6a DSL and agent
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
    - Path: repo://packages/agent/src/chat/session.ts
      Note: Approvals on the log (subscribe, approve/reject, E_STALE), revert as a user transaction (commit 879b5d7)
    - Path: repo://packages/agent/src/worker/client.ts
      Note: AgentDocs, memoryDocs, docs snapshots, replay through historyOf (commit 879b5d7)
    - Path: repo://packages/agent/src/worker/server.ts
      Note: 'MirrorLog deleted: a mirror history loaded from the page''s LogData (commit 879b5d7)'
    - Path: repo://packages/contract/src/compile.ts
      Note: 'compile, cutNode: what every DSL cut is (read only)'
    - Path: repo://packages/dsl/src/docs/generate.ts
      Note: Reference with cuts, paths, stages (law, medium, layers), masks; instructions; d.ts (commits 933bc7f, ef29fc2)
    - Path: repo://packages/dsl/src/history.ts
      Note: 'The agent''s one door into the log: Submission, agentSubmit (modes, stale), historyOf, memoryHistory (commit 933bc7f)'
    - Path: repo://packages/dsl/src/host/cuts.ts
      Note: Views, cuts as compile(doc) nodes, what-ifs as edit(doc, change), edit-error fixes (commit 933bc7f)
    - Path: repo://packages/dsl/src/host/edits.ts
      Note: Builders layer/group/mask/coll and set/insert/remove/move; frame.propose and the queue (commit 933bc7f)
    - Path: repo://packages/dsl/src/prelude/prelude.ts
      Note: Guest values as data proxies with host-run chain methods; frame and what-if views (commit 933bc7f)
    - Path: repo://packages/dsl/src/session.ts
      Note: One submission per eval (Edit or plan Batch), EvalResult.transactions, proposal status from the log (commit 933bc7f)
    - Path: repo://packages/values/src/log.ts
      Note: The Log API the DSL and agent use (read only)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T00:10:48.004418-05:00
WhatFor: ""
WhenToUse: ""
---



# Diary

## Goal

The phase agent's record of phase P6a of CHB-037: the agent's DSL (`packages/dsl`) and the agent
(`packages/agent`) on contract 1.0 — document format 3, the one compiler with named cuts, the values builders and
the document log — with the old recipe, `printChain`, `frame.edit`, the old EditLog and `MirrorLog` deleted.

## Step 1: Reading the spec and the code; the DSL surface decided

The main agent assigned me phase P6a. I read the working rules and the P6a spec (plan §1, §2, §7 and the amendments),
the design's opening, §18, §20–§31 and §34, the P2a and P4 diaries (what breaks in dsl/agent; the Log API and the
P6 notes), `packages/values/README.md` and CC-019, then all of `packages/dsl` and `packages/agent` and the contract
modules they must now use (`document.ts`, `compile.ts`, `builders.ts`, `validate.ts`, `eval.ts`). Before tests I
wrote the new core (history door, host natives, prelude, session) and drove it with a smoke script, so the
decisions below are checked against running code, not only against the design.

The DSL keeps its good parts unchanged (QuickJS pump, limits, lazy hash-consed handles, literal options, YAML
results, errors with a literal fix) and replaces the editing half: a frame is a view of a document; its cuts are the
nodes of `compile(doc)`; a what-if is `frame.with(change)` = `compile(edit(doc, change).doc)`; edits are values
built with the contract's builders and submitted to the log at the end of the eval.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all
together and add the editor lab functionality / consolidate it all." plus "also agent manipulatable / an agent
having only eval can basically cover all the necessary functionality and introspection into the workbench" and
"unify all of it, we don't have backwards compatibility needs or wrapping or so, we can do hard cutoff, now is the
time to strive for elegance and consistency and all that. nothing is not worth it if it creates a more robust and
simple core"

**Assistant interpretation:** The main agent assigned me P6a: bring the DSL and the agent onto document format 3,
cuts and the values log — frame handles address cuts, every what-if goes through the one compiler, edits are built
with the values/contract builders and proposed through the log (batches with plan), `EvalResult.transactions`,
`h.look()` → `h.show()`, named looks stay batches until P7, `MirrorLog` deleted, docs regenerated, examples and
tests rewritten; hard cut-off, no aliases.

**Inferred user intent:** An agent with only `eval` edits a frame with the same components, builders and history
as the studio, so there is one model and no drifted copy of it in the agent's code.

### What I did
- Read the documents above and every file of `packages/dsl` (≈4.2k lines) and `packages/agent` (≈2.2k lines).
- Probed the contract's `edit()` errors with a throwaway script (unknown param → E_UNKNOWN_OPTION with did-you-mean
  in the hint, bad path → E_PATH with `valid`, range → E_ARG_RANGE with a literal `fix` value, id clash →
  E_MUTATION, op in the wrong stage → E_DOCUMENT, `remove('main')` → E_DOCUMENT): the DSL can lean on them and only
  add the pasteable call around them.
- Added `packages/dsl/tsconfig.json` and `packages/agent/tsconfig.json` (copies of the contract's) and the
  `@chromobench/values` dependency to both packages (`pnpm install --no-frozen-lockfile --prefer-offline`: the
  lockfile gains the two workspace links, no new package).
- Baseline: `pnpm exec tsc -p packages/dsl/tsconfig.json --noEmit` → 74 errors, agent → 276 (most of them in
  studio-kit and ingest, reached through `packages/agent/test/demo.test.ts`, which imports studio-kit's chat kit).
- Wrote `packages/dsl/src/history.ts`, `describe.ts`, `host.ts`, `host/{cuts,edits,show,calls,errors,named-looks,
  types,words}.ts`, the prelude, `session.ts`, `results/show.ts` (was `looks.ts`), `docs/{generate,vocabulary,
  provider}.ts`, `telemetry.ts`; deleted `host/print.ts` (printChain, the print macro) and `host/look.ts`.

### Why
- The spec's "every what-if is compile(edit(doc, tx).doc)" means the DSL must hold no pipeline of its own; `cuts.ts`
  compiles each document version once (a WeakMap per session) and names its cuts, so `frame.print()` is literally
  `compile(doc).cuts.print` in the session's graph.

### What worked
- Smoke script against engine-mock: `frame.explain()` lists stages, entries and their node ids; the grey patch reads
  D [0.94691, 0.80158, 0.58241] as before; `frame.with(set('main.params.time_s', 20)).print()` prints darker;
  a sky dodge (mask + layer, two inserts) previews lighter (0.66 → 0.47 D) and is proposed as one pending entry.

### What didn't work
- First session start: `E_INTERNAL: Cannot read properties of null (reading 'at')` — `H('tables')` sends `null`, and
  the new dispatcher read `a['at']` before the switch. Fixed with `(JSON.parse(json) ?? {})`.
- `insert('masks', 'sky', sky)` failed with `E_ARG_TYPE: insert: at is a position` — the builder's `at` (position)
  collided with the natives' `at` (the caller's line). The position travels as `pos` now.
- `frame.doc.….time_s = 12` gave `TypeError: proxy: inconsistent get` instead of E_IMMUTABLE: a Proxy may not return
  a different object for a non-configurable property, and I had deep-frozen the target. The document copy in the
  guest is no longer frozen; the proxy's traps are the guard.
- `insert(…).then(insert(…))` → `TypeError: not a function`: the value proxy returned `undefined` for `then`
  (deliberately: a value with `then` is a thenable). See the decision below.

### What I learned
- Diagnostic codes are a closed, typed list (`ErrorCode`): a new warning code `SHOWN` does not compile, so the
  "too many images" warning keeps the contract's `LOOKS` code.
- A transaction's inverses, recomputed on the current document, are a precise staleness test that also works for
  auto mode (see decision 5).

### What was tricky to build
- Values in the sandbox. A contract value (`LayerValue`) is a host object with methods; it cannot cross into QuickJS.
  In the guest a value is a Proxy over its plain data whose chain methods call the host (`H('value', { kind, data,
  method, args })`), which runs the contract's modifier and returns new data. Nothing the host keeps is referenced,
  so values cross into documents as data and survive between evals on `mem`; unknown methods get a did-you-mean.

### What warrants a second pair of eyes
- The decisions below that the spec did not make.

### What should be done in the future
- Contract (not mine): rename `Look`/`EvalResult.looks`/`EVAL_LIMITS.looks` and the `LOOKS` warning to `show`
  words, so "look" means only named looks everywhere (the DSL already says `h.show`, `shown:`, `[image N: …]`).
- values (not mine): `log.commit(x, { why })`, so an auto-mode commit keeps the agent's reason as a proposal does;
  today the reason also goes into the transaction's `source.why`.

### Code review instructions
- Start with `packages/dsl/src/history.ts` (the door), then `host/cuts.ts` (views, cuts, what-ifs), `host/edits.ts`
  (builders, propose), `session.ts` (`submit`, `proposalStatus`, `context`), the prelude (`mkValue`, `viewObj`).

### Technical details

Decisions the spec did not make:

1. **The DSL's host is a log, not frames with logs.** `DslSessionOptions.history: DslHistory = { log(), mode(),
   submit(s) }`; frames are registered with their decoded source only (`frames: { id: { source, name } }`), and a
   frame is visible when the log holds it. `historyOf({ log, mode, change })` adapts the studio store
   (`rt.store.log`, `rt.store.change`); `memoryHistory(log, mode)` holds a log for tests and transports.
2. **The mode is applied at the door.** `agentSubmit(log, sub, mode)`: read-only → E_READONLY, ask →
   `log.propose(x, { why })`, auto → `log.commit(x)`. `frame.propose` refuses read-only at the call, so the error
   points at the agent's line; the door checks again (the photographer may switch while the eval runs).
3. **One submission per eval** (DR-3 kept): per frame one transaction (the queued edits' normal-form mutations, in
   order); one frame → an `Edit` with tx id `<prefix>eval-N`; several frames or a named look → a `Batch` from
   `plan(log.targets(frames), …, { id: evalId, label, by: 'agent', source })`. So an eval is one undo step and one
   approval card, and approve/reject never split it.
4. **Provenance.** Transactions: `by: 'agent'`, `source: { kind: 'agent', eval, why?, looks? }`, label from
   `{ label }` or `agent <evalId>`. Layers and groups the agent builds carry `source: { kind: 'agent', eval }` (set by
   the host; the guest has no `.source` method), so "who made this layer" survives in the document itself.
5. **Stale in auto mode (CHB-008 R1, done in the new model).** A submission carries, per document, the inverses its
   transaction had on the document the eval read (`Submission.read`). If they differ when recomputed at the door, the
   photographer changed what the edit touches while the agent worked: even in auto mode the edit is proposed, and the
   session warns CONFLICT. `proposalStatus` uses the same test for "stale, not applied (the photographer changed …)".
6. **Changes are mutation values; several are an array.** `set`, `insert`, `remove`, `move` return change values;
   `frame.with([a, b])`, `frame.propose([a, b], { why })`. No `.then` on changes: a value with a `then` method is a
   thenable, so `return set(…)` from the async eval body (or `await` of anything holding one) would call it with the
   promise's resolver. Arrays are also plain JavaScript an agent writes without learning a method.
7. **Cuts take no options.** `frame.print({ time_s: 12 })` is E_ARG_TYPE whose fix is
   `frame.with(set('main.params.time_s', 12)).print()` (built from a table of where today's print options live in a
   new document; only an error, never an alias). `neg.print(…)` (the namespace called as a function) is
   E_UNKNOWN_METHOD with the same kind of fix.
8. **Handle ops read nothing from the document.** The old "recipe-backed defaults" are gone with the recipe; an op on a
   handle is the raw node with the op's defaults. The document's settings reach the pipeline only through compile.
9. **Views last one eval.** `frame.with(…)` and receipts' `preview` are views with per-eval keys (`~1`, `~2`); keep a
   change (data) on `mem`, not a view. Values (layer, mask, change) survive on `mem`.
10. **Globals**: `cb`, `frame`, `units`, `mem`, `console`, `layer`, `group`, `mask`, `coll`, `set`, `insert`,
    `remove`, `move` — the contract's builder names, so agent code reads like the studio's.
11. `group(name, { id: entry })` and `coll({ id: item })` take objects whose keys are the ids in order (digit-only
    ids are refused: JavaScript would reorder them).

## Step 2: The DSL green — tests, topics and generated docs on the new surface

With the core running, I rewrote every DSL test and topic page on the new words and regenerated the reference,
instructions and typings. The §7 grey-card balance — the representative trace the DSL was built around — gives the
same numbers as before through the new path (`frame.with(set('lights.params.logH', …))`, `frame.propose`), so the
one compiler reproduces what printChain computed; the golden text changed only where the vocabulary did.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Make packages/dsl typecheck and its vitest green on the new surface; rewrite the
examples; regenerate the docs.

**Inferred user intent:** The DSL's own tests and docs prove the surface, not only compile it.

**Commit (code):** 933bc7f — "CHB-037 P6a: the DSL on contract 1.0 - frames are views of documents, cuts are
compile(doc) nodes, what-ifs are frame.with(change), edits are values submitted to the log"; ef29fc2 (reference
without the unreachable receiver-less ops; functions refused in params, tests)

### What I did
- Tests: `helpers.ts` (the M1 negative as a format-3 document at 6 µm/px, a values `Log` with `LOG_RULES`,
  `memoryHistory`), `edits.test.ts` (was `mutations.test.ts`: ask/auto/read-only at the door, stale, the photographer
  changing the document mid-eval, a two-frame batch, cut cache identity with `compile` and `edit`), `errors.test.ts`
  (33 mistakes → code and literal fix), `looks.test.ts` (named looks as one plan batch), `examples.test.ts` (E1–E6,
  §7), `results.test.ts` (shown images, values in mem, values returned as data), `sandbox.test.ts`,
  `telemetry.test.ts`, `docs.test.ts` (every block of every topic runs as tagged; the tag is `shows=N` now).
- Topics: all eight pages rewritten (`getting-started`, `darkroom-vocabulary`, `editing-and-approval`,
  `balancing-colour`, `errors`, `looks`, `measuring`, `test-strips`).
- `UPDATE_GOLDEN=1 npx vitest run packages/dsl/test/examples.test.ts` and reviewed the diff of
  `representative.result`: paths (`print.lights.logH` → `lights.params.logH`), `looks:` → `shown:` /
  `[image 1: …]`, the error cases on `frame.propose(set(…))`, one node-id prefix (`#284f` → `#e1be`: the graph's args
  changed in P2a). Every number is identical (`after: [0.77816, 0.78283, 0.76991]`, the image's mean/p01/p99).
- `node tools/gen-docs/main.ts` (the full run works again: it also wrote the agent and bridge targets).

### Why
- The doc tests execute every snippet an agent reads, so the topics cannot drift from the surface.

### What worked
- `npx vitest run packages/dsl` → 9 files, 104 tests passed.
- `pnpm exec tsc -p packages/dsl/tsconfig.json --noEmit` → only 2 errors, both in `packages/ingest`
  (`DustSpot`), reached through `@chromobench/engine-mock` (the tests' engine) — P5b-1's package.
- The disabled-layer identity holds through the DSL: `frame.with(set('d1.enabled', false)).print().id` equals the
  print cut of the document without the dodge.

### What didn't work
- `Error: No test found in suite OpDef.examples`: contract 1.0 ships no `OpDef.examples`, so the per-example `it`s
  vanished. One test now runs every example (zero today) so an op that adds one is exercised.
- `layer(…).name('x')` → `TypeError: not a function`: `name` is in the prelude's generic PROBES list (function
  names), checked before the value's methods. Methods are matched first now; probes after.
- YAML renders short string arrays inline (`changes: [set main.params.time_s = 20 (was 10)]`); two expectations
  assumed block lists.
- Two fixes pointed at the wrong place: E_DOMAIN suggested `frame.cut('darkroom.main')` for a paper-logH op (the
  first cut of that domain; `darkroom.main` is a mask-reading cut, now skipped), and `set('main.params.time', 12)`
  had no fix (the contract's `closest` does not match `time` → `time_s`; the DSL's `suggest` with its prefix rule
  does).

### What I learned
- The contract's validation errors already carry `path`, `valid` and (for ranges) a literal value: the DSL only wraps
  them into a pasteable call (`frame.propose(set('lights.params.logH', [0.1, 0, 0]))`).

### What was tricky to build
- Compile warnings (RANGE) point at the agent's line only if compile happens at that line. `frame.with` compiles
  eagerly (once per document version, cached), so a soft-range value warns at the `with` and an unresolvable
  document fails there, not later at an unrelated cut.

### What warrants a second pair of eyes
- `host/cuts.ts` `editError`: the heuristics that turn the rules' diagnostics into fixes (which mutation caused it).

### What should be done in the future
- N/A

### Code review instructions
- `packages/dsl/test/edits.test.ts`, `errors.test.ts`; `packages/dsl/src/docs/topics/*.md`.
- `npx vitest run packages/dsl`; `node tools/gen-docs/main.ts --check`.

### Technical details
- The generated reference grew from 55.6 kB to ≈75 kB: new sections Cuts, Paths, Stages (law, medium fields, the layer
  ops each stage takes with their args) and Masks; the handle sections list node ops only (layer ops are made with
  `layer()`). Instructions: 2.5 kB (limit 4 kB).

## Step 3: The agent on the log — MirrorLog deleted

The worker used to receive EditLog snapshots, wrap them in `MirrorLog` (an EditLog subclass that recorded propose
calls) and send the calls back for the page to replay. Now the page sends the log's own serialisation (`LogData`)
with the mode and the frames; the worker loads it (`Log.load` replays and checks it) behind a mirror history; an
eval's submission goes back with its result and the page makes it on its own log through the same door
(`historyOf(docs).submit`). The chat waits for approvals on the log and decides through the host's `change`.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Delete MirrorLog; the agent's worker, client, chat, bridge client, prompt, demo and
playbooks on the document log.

**Inferred user intent:** One history; the page stays the arbiter of what the agent may change.

**Commit (code):** 879b5d7 — "CHB-037 P6a: the agent on contract 1.0 and the document log - MirrorLog deleted, the
worker copies the page's log and the page makes the eval's submission through the same door"

### What I did
- `worker/protocol.ts`: `DocsSnapshot { log: LogData; mode; frames }`, `{ t: 'docs' }` replaces `{ t: 'frames' }`,
  `result.submission` replaces `result.proposals`; `init` carries the session's `txPrefix` (ids are made in the
  worker now, not rewritten on replay).
- `worker/server.ts`: `MirrorHistory` (load, mode, submit = agentSubmit on the copy, keeps the submission).
- `worker/client.ts`: `AgentDocs = { log(), mode(), change(f), subscribe(fn), ids(), get(id) }` (the studio store
  fits it), `memoryDocs`, `syncDocs` (by log identity, mode and frame set), `replay` through `historyOf`.
- `chat/session.ts`: `ChatHost = { evaluate, currentFrame, docs, setMode }`; approval cards from the eval's pending
  `LogEntry`s (`changesOf`); `waitDecision` on `docs.subscribe`; `decide` → `docs.change(l => l.approve(…))`
  (E_STALE goes to the card's `problems`), unticked → `reject`; `revertStep` → one user transaction of the inverses
  (a plan batch for several frames); `describeChange(m, inverse)` (values mutations; printer lights also in
  points); `inverseOf` deleted.
- `bridge/page-client.ts` on `docs`; `prompt.ts` (tool description: `h.show`, `frame.with`, `frame.propose`); demo
  model and the three playbooks rewritten; `CONTRACT-REQUESTS.md` status note (R1 and R2 settled).
- Tests: `helpers.ts`, `worker.test.ts` (+ a page that goes read-only mid-eval, + auto-mode stale on the page),
  `chat.test.ts` (one card per eval; stale approval shown; approvals panel resumes the step; revert is undoable),
  `playbooks.test.ts`, `demo.test.ts`, `bridge-page.test.ts`, `anthropic.test.ts`.
- `node tools/gen-docs/main.ts` (playbooks module and the bridge's embedded texts).

### Why
- Sending the log's own serialisation keeps one format and lets the worker answer `why`, `pending` and staleness
  exactly as the page would; `Log.load` checks every stored mutation, so a corrupt copy fails loudly.

### What worked
- `npx vitest run packages/agent` → 6 files, 36 tests passed; `pnpm exec tsc -p packages/agent/tsconfig.json
  --noEmit` → only the same 2 `packages/ingest` errors.

### What didn't work
- Playbook tests failed with `E_UNKNOWN_METHOD` / `E_ARG_TYPE` until `pnpm gen` rewrote
  `src/playbooks.generated.ts` (the tests run the generated copy, not the `.js` files).
- `demo.test.ts` imported `ChatSessionLike` from `../../studio-kit/kits/chat/src/kit.ts`, which pulls the whole
  (currently broken) studio-kit into the agent's typecheck: 276 errors at the start. The import is gone; the chat kit
  should assert the contract in its own tests.

### What I learned
- One eval is one log entry per frame, so the old "partial approval" (approve one of two changes of an eval) no
  longer exists: the log never splits a transaction or a batch. A card is approved or rejected as a whole.

### What was tricky to build
- Who reports a stale submission: the worker's copy is current at the start of the eval, so only the page can see a
  change made while the eval ran. `replay` warns and adds a `host:` note when the page proposed what the worker
  committed.

### What warrants a second pair of eyes
- `Log.load` on every eval after a change: cost grows with the session's journal (every entry is replayed).

### What should be done in the future
- If long sessions make `Log.load` slow, send the worker only the documents and the entries it reads (pending, in
  effect) or keep the worker's copy and send deltas.

### Code review instructions
- `packages/agent/src/worker/{protocol,server,client}.ts`, then `chat/session.ts` (`runStep`, `decide`, `revertStep`).
- `npx vitest run packages/agent`.

### Technical details
- Consumers outside my packages that must follow (P5b-1 and later), all compile errors today:
  `apps/studio/src/host/chat.ts` (`FrameSource` → `AgentDocs`; `DslWorkerClient.create({ docs })`; `ChatHost.docs`
  replaces `frames` + `mode`; `BridgePageClient({ docs })` without `mode`); `packages/studio-kit/kits/looks/src/engine/
  provider.ts` (`LooksProvider.resolve(id, { id, doc }, …)` returns values mutations; `diff(a: Document, b:
  Document)`); `packages/studio-kit/test/kit.test.ts` (imports `PRINT_OPTIONS` from the DSL: gone) and
  `test/looks/kit.test.ts` (`DslSession.create({ history, frames: { id: { source } } })`).

## Step 4: Final checks, what is broken elsewhere, and what P6b, P7 and P8 need

All acceptance checks of my packages pass, with one exception I cannot fix from here: the per-package typecheck of
dsl and agent follows the tests' engine (`@chromobench/engine-mock`) into `packages/ingest`, which still imports the
removed `DustSpot` until P5b-1 lands. My own files have no type errors (also none with `--noUnusedLocals
--noUnusedParameters`).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Run the acceptance checks, record the breakage outside my packages and hand over.

**Inferred user intent:** The main agent can merge P6a and plan P6b, P7 and P8 from this record.

**Commit (code):** ef29fc2 (last code commit); this step's diary commit follows.

### What I did
- `pnpm exec tsc -p packages/dsl/tsconfig.json --noEmit` and the agent's: 2 errors each, both
  `packages/ingest/src/conditioning/dust/{heal,specks}.ts: Module '"@chromobench/contract"' has no exported member
  'DustSpot'`; 0 in dsl or agent. `pnpm exec tsc -p packages/dsl/tsconfig.generated.json --noEmit` (the generated
  `.d.ts`) clean.
- `npx vitest run packages/dsl packages/agent packages/values packages/contract` → 31 files, 270 tests passed (dsl
  104, agent 36).
- `pnpm gen:check` → `gen:check ok (26 files)` (the full run, no `--contract-only`); `pnpm lint` → boundaries ok
  (452 file checks), colours ok; `docmgr doctor --ticket CHB-037` → all checks passed.
- Whole suite: 24 failed files / 22 failed tests, all in `apps/studio`, `packages/studio-kit` and `packages/output`
  (P5b-1's packages, broken since contract 1.0); 98 files / 2679 tests pass.

### Why
- The spec's acceptance is per package; the whole-suite run makes sure nothing outside P5b-1's scope fails.

### What worked
- Every check above.

### What didn't work
- N/A

### What I learned
- N/A

### What was tricky to build
- N/A (checks and records).

### What warrants a second pair of eyes
- The decisions in Step 1 (Technical details), in particular arrays instead of `.then` for changes and the
  stale-in-auto rule.

### What should be done in the future
- **P5b-1 / studio**: adopt the agent API (Step 3, Technical details): `AgentDocs` over the store
  (`{ log: () => rt.store.log, change: (f) => rt.store.change(f), mode, subscribe, ids, get }`), `ChatHost.docs`,
  `DslWorkerClient.create({ docs })`, `BridgePageClient({ docs })`; the looks provider on documents; the chat kit's own
  type test that `ChatSession` satisfies `ChatSessionLike` (its `decide` signature is unchanged; one card is one
  eval, approved or rejected whole).
- **P6b (workbench)**: `wb` can sit beside `cb` as one more prelude global with natives in `host/`; reading state is
  `frame.doc` / `frame.get` today. `frame.explain()` already lists entries with their compiled node ids; the
  `values` explain of a builder value is the guest-side `value.explain()` (its trail is the agent's lines).
  A layout built in the sandbox must cross as data, like values do here (the prelude's `mkValue` pattern).
- **P7 (links)**: the DSL compiles with no `LinkContext` (`compile(doc, graph)`), so a document with roll or look
  links fails with E_LINK in a DSL cut; pass the link registries to `DslSessionOptions` (and to the worker's
  snapshot). Bindings that measure need `compileMeasured` (async): DSL cuts are synchronous host calls today, so a
  measuring binding fails with E_BINDING; either pre-measure at eval start or make cut handles lazy over
  `compileMeasured`. Named looks then become `insert(stack, id, { kind: 'link', ref: { look, version }, … })` and
  `cb.looks.apply` a batch of link inserts; `LooksProvider` can go.
- **P8 (Editor lab ops)**: new layer ops appear in the DSL by themselves (`layer(op, …)`, the reference's Stages
  section, the `.d.ts`); a new mask component kind needs its name in `MASK_COMPONENT_KINDS` (contract). Blend modes
  are validated against `BLEND_MODES`.
- **Contract**: rename `Look` / `EvalResult.looks` / `EVAL_LIMITS.looks` and the `LOOKS` warning code to `show`
  words. **values**: `log.commit(x, { why })` (the agent's reason in auto mode is kept in `tx.source.why` meanwhile).

### Code review instructions
- Run the checks above from the worktree root.

### Technical details

The DSL surface (P6a):

```js
frame.print() · frame.cut('darkroom.H') · frame.finished() · frame.display() · scan() scene() film() negative() source()
frame.doc · frame.get('main.params.time_s') · frame.explain() · frame.why(path) · frame.pending()
frame.with(set('main.params.time_s', 14)).print()                       // what-if = compile(edit(doc, change).doc)
layer('dodge', { stops: 0.5 }).mask('sky').amount(0.8) · group('Edges', { b1: layer('burn', { stops: 0.3 }) })
mask('Sky').add('g', 'linear', { from: [48, 0], to: [48, 40] }).feather(0.4) · coll({ s1: spot })
set(path, v) · insert(coll, id, item, at?) · remove(id) · move(id, { into, at }) · [a, b]
frame.propose([insert('masks', 'sky', sky), insert('stages.darkroom.stack', 'd1', dodge)], { why })
h.show(label) · cb.compare([a, b]) · cb.testStrip(frame, …) · cb.ringAround(frame, …) · cb.looks.* · units.*
```
