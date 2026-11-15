---
Title: Diary — phase P4 history
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
    - Path: repo://packages/contract/src/validate.ts
      Note: LOG_RULES; EditLog deleted (commit e4cde19)
    - Path: repo://packages/shell/src/core/store.ts
      Note: Document tier = the log; mounts; drafts (commit e236dba)
    - Path: repo://packages/shell/src/core/store/drafts.ts
      Note: Draft (was Layer) (commit e236dba)
    - Path: repo://packages/shell/src/core/store/project.ts
      Note: The log's documents in the state tree (commit e236dba)
    - Path: repo://packages/values/README.md
      Note: API and examples (gesture, proposal, look over a roll)
    - Path: repo://packages/values/src/diff.ts
      Note: The net change between two versions (commit 102a455)
    - Path: repo://packages/values/src/log.ts
      Note: The document log and Draft (commits 102a455, 98af7e8)
    - Path: repo://packages/values/src/plan.ts
      Note: The one batch builder (commit 102a455)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-14T22:44:31.680706-05:00
WhatFor: ""
WhenToUse: ""
---


# Diary

## Goal

The phase agent's record of phase P4 of CHB-037, "one history" (design §26): the document log in
`packages/values` (cursor undo/redo, proposals with staleness, batches across documents, authors and sources,
`why(path)`, drafts for gestures, serialisation) and one batch builder `plan(targets, doc => transaction)`; the
contract's `EditLog` deleted; the shell store's document tier becomes that log, its preview type `Layer` becomes
`Draft`. Spec: plan `design-doc/01-implementation-plan-and-working-rules.md` "P4 — one history" and the amendments
after P1, P2a and P5a; design: CHB-035 design 01 v2 §24, §26, §27, §34.

## Step 1: Reading the spec, the design and today's two histories; the API decided before code

The main agent assigned me phase P4. I read the working rules, the P4 spec and the amendments, design §16 (the
inventory of the two histories), §24, §26, §27 and §34, `packages/values` (README, `transactions.ts`,
`mutations.ts`, `doc.ts`, the property-test generator), the contract's `editlog.ts`, `validate.ts`
(`DOCUMENT_RULES`, `edit()`), `eval.ts` and the EditLog tests, and the shell store (`store.ts`, `store/*.ts`,
`history.ts`, `app/runtime.ts`, the store tests), plus the studio-kit bridge (`bridge/editlog-route.ts`) and the
looks kit's `planApply` to know what P5b will rewire onto my API.

Today the store keeps its own patch history (`History`: entries of patches plus "parts" from route adapters, with
skip rules for parts that no longer apply, coalescing, channels with snapshots) and routes `recipes.<frame>` to a
per-frame `EditLog` with its own cursor. Two cursors for one user and a bridge between them is exactly the
complexity §26 removes. The decided shape is one immutable `Log` value holding several documents and one cursor, so
an undo is always exact and nothing is ever "skipped".

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all." plus "unify all of it, we don't have backwards
compatibility needs or wrapping or so, we can do hard cutoff, now is the time to strive for elegance and consistency
and all that. nothing is not worth it if it creates a more robust and simple core"

**Assistant interpretation:** The main agent assigned me phase P4: replace the shell store's document-tier history
and the contract's EditLog by one document log in `packages/values`, with one batch builder, property tests and a
README; rewire the contract and the shell onto it with a hard cut-off; leave studio-kit and the apps to P5b.

**Inferred user intent:** One history that every client (the studio's gestures, the agent's proposals, a look over a
roll) uses the same way, so undo, approval and provenance have one meaning and one implementation.

### What I did
- Read the documents and code listed above.
- Baseline in the worktree: `pnpm install --frozen-lockfile --prefer-offline`;
  `pnpm exec tsc -p packages/contract/tsconfig.json --noEmit` green; added `packages/values/tsconfig.json` and
  `packages/shell/tsconfig.json` (like the contract's; the shell's includes `demo/**` because its browser spec reads
  the `window.demo` declaration there) — both green; `pnpm exec vitest run packages/values packages/contract
  packages/shell` → 24 files, 223 passed; `pnpm lint` green.
- Fixed the API (Technical details) before writing code.

### Why
- The log is used by three later phases (P5b studio, P6 agent, P7 links); deciding its shape first keeps them from
  inheriting a second rewrite.

### What worked
- Values already has everything the log needs underneath: atomic `tryTransaction`, exact inverses, normal forms,
  the `validate`/`validateTransaction` hooks the contract fills with `DOCUMENT_RULES`.

### What didn't work
- N/A (reading step).

### What I learned
- The shell's `History` channels (per-photo lists with snapshots, `stepTo`, seeds) have no UI in the shell; the
  studio uses `channel` only to say "Undo X (on frame Y)". With one document per frame, the step knows its documents,
  so channels are redundant.
- The name `Draft` is already taken in the shell: `store/draft.ts` is what `ctx.tx` hands to its lambda (and
  `runtime.ts` exports `type Draft<S>` for it). Renaming `Layer` → `Draft` means that one becomes `Writer`.
- Routes (adapters with mirror values and history parts) exist only to put EditLogs into the store. When the log
  holds the frame documents, a route is just "this document is shown at this path": a mount.

### What was tricky to build
- N/A (design step).

### What warrants a second pair of eyes
- The decisions marked "decision" below; the spec does not make them.

### What should be done in the future
- N/A

### Code review instructions
- Nothing to review yet; read Technical details against design §26.

### Technical details

The values API (all values immutable; every operation returns a new `Log`):

- `Log.create({ rules?, now? })`; `rules` maps a document kind to `TxOptions` (the contract passes
  `{ frame: DOCUMENT_RULES }`); `now` stamps entries.
- `log.open(id, doc, { kind?, by?, source? })` adds a document (its initial state; not undoable);
  `log.close(id)` removes it and its entries (steps that become empty go).
- `log.commit(edit | batch, { merge? })` applies as one step (atomic across documents); a commit after undo drops
  the redo tail from the journal. `merge: true` folds the change into the newest step as the net change (the
  shell's coalescing of nudges), and drops the step when the net change is empty.
- `log.propose(edit | batch, { why? })` checks the transaction(s) on the current documents and records them
  `pending` with the inverses computed then; `approve(sel, { by?, force? })` re-applies and refuses with E_STALE
  when the recomputed inverses differ (design §26, P1 amendment); `reject(sel)`. Selecting an entry of a batch
  selects the whole batch (decision: a batch is approved and rejected as one, never in part). Approved entries form
  one step.
- `log.undo()`, `log.redo()`: one step each, exact, without re-validation (the states were valid when current).
- `log.why(doc, path)` → the entry that last changed the value at `path` (decision: "changed" means the value read
  at that path differs before and after the entry, computed by folding; no heuristic about which mutation paths
  are related), `log.trail(doc, path)` → all of them, the opening first.
- `log.draft(id)` → a document draft: `set`, `apply`, `update(fn)`, `doc`, `mutations()` (the net change, by
  `diff`), `edit(meta)`.
- `log.toJSON()` / `Log.load(data, opts)`: the load replays every document and checks every stored inverse.
- `plan(targets, (doc, id) => transaction | mutations | null, { id, label, by, source })` → a `Batch` (every
  transaction carries the batch id, label and author); with rules on the targets (`log.targets(ids)`), a
  transaction the rules refuse is listed in `batch.skipped` instead.
- `diff(before, after)` → mutations (normal form) whose application to `before` gives `after`: the "net change" of
  a draft and of a store transaction (decision: the net change is computed, not accumulated).

The shell: the store's document tier is `store.log` (document `main` = the program's document state, plus mounted
documents at paths: `store.open(id, doc, { at, kind })`); routes, adapters, mirror values, history parts,
`History`, channels and snapshots are deleted; named preview layers and the gesture layer are both `Draft`s;
`ctx.layer` → `ctx.draft`; the tx draft → `Writer`.

## Step 2: The log, drafts, plan and diff in values

The log is `packages/values/src/log.ts` (`Log`, `Draft`), the batch builder `plan.ts`, and the net change
`diff.ts`. `Log` is an immutable value with a private state record; every operation builds the next one, so a
refused commit simply returns nothing and the caller's log is untouched (atomicity for free, as with
transactions). A step is "the entries of one commit or one approval"; the cursor counts steps, so a batch over
twelve frames is one undo.

`diff(before, after)` turned out to be the piece that makes drafts and the store simple: instead of accumulating
the gesture's mutations and compressing them, the net change is computed from the two versions. It walks only
where the versions differ by reference (copy-on-write versions share untouched subtrees), and it keeps item
identity: an item in both versions is moved, never removed and re-inserted.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Implement the values half of P4 with property tests.

**Inferred user intent:** A small robust core the studio, the agent and the links phases can all stand on.

**Commit (code):** 102a455 — "CHB-037 P4: the document log in values (Log, Draft, plan, diff)"

### What I did
- `src/diff.ts`: three passes over a working copy, each mutation applied as it is made (checked, with positions of
  the moment): (1) items whose place changed move into their new collection when it exists; (2) items that are gone
  are removed, outermost first; (3) top-down over `after`: new items are inserted *without* the items they hold
  that exist already (those then move in), reorders keep the longest increasing run and move the rest (each to just
  after its predecessor), object keys are set or unset, arrays of equal length are compared by index, anything else
  is set where it differs. Keys that are empty or hold a dot are refused (E_PATH): no path could address them.
- `src/log.ts`: `Log.create/load`, `open/close`, `doc/initial/kind/ids/has`, `targets`, `draft`, `entries/entry/
  last/steps/cursor/inEffect/pending/canUndo/canRedo/undoStep/redoStep/docsOf`, `commit(x, { merge })`,
  `propose(x, { why })`, `approve(sel, { by, force })`, `reject(sel)`, `undo/redo`, `trail/why`, `toJSON`;
  `Draft.of/apply/set/update/reset/mutations/changed/edit`.
- `src/plan.ts`: `plan(targets, build, { id, label, by, source })`.
- `E_STALE` added to `VALUE_ERROR_CODES` (the contract's code of the same meaning).
- Tests: the random document generator moved from `properties.test.ts` to `test/gen.ts` (shared); `diff.test.ts`
  (300 seeds: apply(diff(a, b)) = b, also against a JSON copy sharing nothing, diff(b, b) = [], survivors never
  removed, and backwards; focused cases for drags, reorders, moves into old and new groups); `log.test.ts` (unit
  tests per operation and two properties: 40 seeds × 60 random operations on three documents checking the fold
  after every operation, save → load, undo-all = initial, redo-all, and that every E_STALE refusal is a real change
  of the recomputed inverses; 60 seeds of deliberately staled proposals).
- `pnpm exec vitest run packages/values` → 8 files, 68 passed; `pnpm exec tsc -p packages/values/tsconfig.json
  --noEmit` green; `pnpm lint` green.

### Why
- An immutable log keeps the same discipline as documents and transactions (no listener plumbing in values; the
  store, the host and the agent each hold the current log and replace it).
- Undo applies stored inverses without re-running the rules: the state it returns to was valid when it was current,
  and an undo that can fail is the "skip" machinery the shell had to have.

### What worked
- The random-sequence property passed on its first run once the test's own expectations were right; the fold check
  after every operation is the invariant that catches every bookkeeping slip (cursor, redo tail, merge).

### What didn't work
- First version of diff removed an item and inserted it again when it moved into a *new* group; the property
  "survivors are never removed" failed:
  `AssertionError: expected true to be false` at `diff.test.ts:39`. A seeded debug test printed the case (seed 41:
  `n2 a: stages.two.stack b: n3.stack`, where `n3` was inserted in the same walk). Fixed by inserting new items
  without the items that already exist (`without`) and moving those in when pass 3 reaches the new collection.
- While restructuring pass 3 with a Python replace I cut out the `sync` function:
  `packages/values/src/diff.ts(171,32): error TS2304: Cannot find name 'sync'`; restored it.
- `console.log` in a vitest test printed nothing with the default reporter (piped through `grep`); `--reporter=verbose`
  shows stdout.
- Two unit tests compared an undone document to the initial one with `toBe`; undo returns an *equal* document, not
  the same object (`Received: serializes to the same string`). Changed to `toEqual`; identity is not part of the
  contract.
- `plan(log.targets(), (d: Frame) => …)`: TS does not infer the target type from the callback's annotation
  (`Target<object>[]` not assignable to `Iterable<Target<{ main: … }>>`); `targets<D>()` is generic now and the
  tests pass the type.

### What I learned
- Under `exactOptionalPropertyTypes`, contravariant rule types work out: the contract's
  `TxOptions<Diagnostic, Document>` is assignable to `TxOptions<unknown, never>`, which is what `Rules` holds.

### What was tricky to build
- Positions in a reorder: `Coll.move`'s `at` is the position in the order *without* the item, and an item that is
  leaving the collection (it moves to a collection synced later) may still sit there. Placing each moved or inserted
  item directly after its predecessor in the target order is correct whatever else is in between; the longest
  increasing run of what is already there stays put, so moving one item to the end is one move, not three.
- `merge` (nudges): the merged transaction is `diff(state before the newest step, state after the new edit)`,
  re-applied under the rules to get its inverses; if the net change is empty the step leaves the journal.
- Approving a batch must re-apply its entries in sequence order on a working copy (two entries may edit the same
  document), and the staleness test must be the same order; the property test recomputes it independently.

### What warrants a second pair of eyes
- `diff` pass 1/2 ordering arguments (comments in the file): an inserted item never contains an id still in the
  working copy; a removal never takes an item that survives at the same place.
- `Log.load` trusts entries outside the steps (pending, rejected) without replaying them; they are re-checked when
  approved.

### What should be done in the future
- N/A

### Code review instructions
- Start at `packages/values/src/log.ts` (`commit`, `#merge`, `approve`, `undo`, `trail`, `load`), then `diff.ts`
  and `plan.ts`; tests in `packages/values/test/log.test.ts` and `diff.test.ts`.
- `pnpm exec vitest run packages/values && pnpm exec tsc -p packages/values/tsconfig.json --noEmit`.

### Technical details
- Step label: a batch's label, else the transaction's; plan gives every transaction the batch's id, label and author
  (a builder returning a transaction by another author is refused, E_MUTATION).
- `why(doc, path)` = last of `trail(doc, path)`; an entry is in the trail when the value read at `path` (id-anchored,
  so it survives moves) differs before and after it.

## Step 3: The contract — EditLog deleted, LOG_RULES

The contract keeps no history of its own any more. `editlog.ts` is deleted; a frame's history is an entry of the
values log, opened with kind `'frame'`, and the contract exports what the log needs to check it:
`LOG_RULES = { frame: DOCUMENT_RULES }`. `edit()` (one transaction under the rules, no log) stays for code that
edits a document directly.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Delete EditLog; the document's log is the values log with DOCUMENT_RULES; keep edit().

**Inferred user intent:** One history implementation, not a contract one and a shell one.

**Commit (code):** e4cde19 — "CHB-037 P4: contract - EditLog deleted; a frame's history is the values document log with LOG_RULES"

### What I did
- `git rm packages/contract/src/editlog.ts`; `index.ts` no longer exports it.
- `AgentMode` moves to `eval.ts` (it is the eval contract's word); `EvalResult.transactions` is `LogEntry[]` from
  values.
- `validate.ts`: `LOG_RULES: Rules = { frame: DOCUMENT_RULES }`.
- `test/editlog-builders.test.ts` → `test/history-builders.test.ts`: the EditLog cases rewritten on `Log` (rules
  refuse, undo exact, draft what-if compiles to the committed ids, proposal stale/forced/why, a roll batch with a
  skipped frame, save/load, version refused); the builder tests unchanged.
- `CONTRACT-DECISIONS.md` CC-019: a row "design §26, plan P4 — One history" and `editlog.ts` in the changes line.
- `pnpm exec tsc -p packages/contract/tsconfig.json --noEmit` green; `pnpm exec vitest run packages/contract` → 7
  files, 62 passed; `node tools/gen-docs/main.ts --contract-only --check` → `gen:check ok (15 files)`.

### Why
- Mode (read-only / ask / auto) is the host's policy about who may commit; it does not belong in a data structure.
  The log lets anyone commit or propose; the host (P6) routes the agent's transactions to `propose` unless the
  photographer chose auto.

### What worked
- Every EditLog behaviour the old tests pinned has a direct log equivalent; the test file shrank.

### What didn't work
- `plan(log.targets<Document>(), (d) => d.kind === …)`: `TS2339: Property 'kind' does not exist on type
  'Document'` — the frame kind is `documentKind(d)`.

### What I learned
- `DOCUMENT_RULES`' `validateTransaction` validates the whole document; drafts therefore apply only the per-mutation
  `validate` (cheap, per touched unit) while a gesture moves, and the commit runs both.

### What was tricky to build
- N/A beyond the above.

### What warrants a second pair of eyes
- `tools/scripts/m1-headless.ts` still imports `EditLog` and `defaultRecipe` (broken since P2a; not mine to change).

### What should be done in the future
- P6: map `AgentMode` onto commit vs propose in the host; `EvalResult.transactions` from `log.entries` of the eval.

### Code review instructions
- `packages/contract/src/validate.ts` (end), `src/eval.ts`, `test/history-builders.test.ts`.

### Technical details
- `Log.create({ rules: LOG_RULES })`, `log.open(doc.frame, doc, { kind: 'frame', by: 'auto', source: { kind: 'ingest' } })`.

## Step 4: The shell store — the document tier is the log; Draft; mounts

The store keeps its three tiers, but the document tier is now `store.log`. The program's own document state is the
log's `main` document; frames and other documents are *mounted*: they show at a path in the state tree and edits
under that path go to them. Routes, adapters, mirror values and history parts existed only to connect EditLogs to
the store; with the documents in the log they are deleted, and so is `History` with its skip rules and channels.

A transaction's writes are routed by document, each document's draft (`log.draft(id).update(setIn …)`) gives its
net change by `diff`, and the edits commit as one step (a batch when several documents changed). The preview tier
is made of `Draft`s (the renamed `Layer`): the gesture is the store's own draft, named drafts sit under it.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Make the store's document tier the values log; keep view and preview tiers; rename
`Layer` → `Draft`; map gestures onto drafts.

**Inferred user intent:** The studio, the agent and the UI all see and undo one history.

**Commit (code):** e236dba — "CHB-037 P4: the shell store's document tier is the values document log; Layer -> Draft"

### What I did
- `core/store.ts` rewritten: `committed` (was `doc`), `current`, `log`, `gesture`, `drafts`, `mounts`;
  `open(id, doc, { at, kind, by, source })`, `close(id)`, `change(log => log…)`, `adopt(store)`, `undo()`,
  `redo()`, `tx`, `set`, `setMany`, `writeView` (view tier only; a document path throws), `commitWrites`,
  `preview/commit/cancel`, `draft(name)`. `TxRefused(label, docs, cause)`.
- `core/store/project.ts` (new): `MAIN`, `changedPaths(a, b)` (by reference, as deep as both are objects),
  `project(tree, base, paths, doc, keep)` (writes a document's changed paths into the tree and puts back the view
  prefixes and mounted documents that sit below them).
- `store/layers.ts` → `store/drafts.ts` (class `Draft`); `store/draft.ts` → `store/writer.ts` (class `Writer`,
  `writes()` instead of `patches()`); `store/types.ts`: `Write`, `TxOpts` (`coalesce`, `detail`, `by`, `source`,
  `keepPreview`), `WriteInfo` (`draft` instead of `layer`), `MountDecl`; `store/routes.ts` and `core/history.ts`
  deleted; `snapshot.ts`: the document tier is every document where it shows.
- Kits: `k.route` → `k.mount(prefix, { keyDepth, kind, checkPath })`, `ir.routes` → `ir.mounts`; initial state
  under a declared mount opens one document per key; a write under a declared prefix where no document is open is
  refused.
- Runtime: `services.adapters` → `services.rules`; `rt.history` gone (`rt.store.log`, `rt.undo()`/`rt.redo()`
  return the `Step`); `ctx.layer` → `ctx.draft`, `ctx.history` → `ctx.log`; `type Draft<S>` → `WriterOf<S>`;
  `stateOpts.channelName/currentChannel` → `docName/currentDoc`; `inspect().layers` → `drafts`; a refusal's toast
  uses the diagnostic's message (no code prefix). Builtins' Undo/Redo labels read `store.log.undoStep/redoStep`.
- `core/util.ts`: `overProxy(real, handler)`; the tracker and the read-only view use it.
- Tests rewritten: `core.test.ts` (history cases on the log; adopt; why; a non-JSON value refused),
  `store-ext.test.ts` (tiers, drafts, mounted documents: one notify and one step across main and a frame, a rules
  refusal aborting everything, a gesture under a mount, a roll batch, coalescing, `change` with propose/approve/
  plan, close, open's refusals), runtime/build/extend/mount/demo specs; the mini studio mounts `dev` (one document
  per photo), so "Undo Exposure (on Photo 1)" comes from the step's document.
- Shell README: "State: three tiers, one history".
- `pnpm exec tsc -p packages/shell/tsconfig.json --noEmit` green; `pnpm exec vitest run packages/shell` → 10 files,
  108 passed; `STUDIO_PORT=5541 STUDIO_KIT_PORT=5542 SHELL_DEMO_PORT=5543 GPU_PARITY_PORT=5544 CI=1 pnpm exec
  playwright test --project shell-demo` → 3 passed (the web-server noise is the studio and studio-kit apps, broken
  until P5b).

### Why
- With one log there is nothing to skip: undo applies the step's inverses to the documents they were made on.
- `diff` as the net change makes `ctx.tx`, a draft's commit and a slider drag the same code path: write a new
  version, take the difference, commit it.

### What worked
- The store-ext tests passed on the first run; the CraftKit core cases needed only API renames.

### What didn't work
- First full run: `TypeError: 'get' on proxy: property 'photos' is a read-only and non-configurable data property
  on the proxy target but the proxy did not return its actual value` — the log deep-freezes documents, and a Proxy
  over a frozen object must return its properties unchanged, so the tracker and the read-only view could not wrap
  children. Fixed with `overProxy`: the proxy's own target is an empty stand-in (an array for arrays, so
  `Array.isArray` holds); traps read the real object; descriptors are reported configurable (and `length` kept in
  sync on the stand-in, whose own `length` is non-configurable).
- The runtime test expected the toast `t must be at most 9` and got `E_ARG_RANGE: t must be at most 9` (a
  ValueError's message carries the code); the toast now uses `cause.diag.message`.
- `pnpm exec tsc …`: `Argument of type 'TxOpts | undefined' is not assignable to parameter of type '(WriteInfo &
  TxOpts) | undefined'` once `TxOpts` lost its index signature; `set`/`setMany` take `TxOpts & { label? }`.
- A Python replace script aborted on its last (already applied) pair and wrote nothing; I moved the edits into a
  reusable all-or-nothing helper (`<scratchpad>/scripts/sub.py`).

### What I learned
- The mini studio's photos are a natural case for mounts: each photo's develop settings is a document, so the
  undo toast's "(on Photo 1)" falls out of the step's documents instead of a channel tag.

### What was tricky to build
- A main-document write that *contains* other tiers (`t.roll = {...}` with `roll.contact` in the view tier, or a
  write of `recipes` holding mounted frames): `route` splits it — the main document gets the value without those
  parts, the view tier and each mounted document get theirs; a document root under a declared mount that nobody
  opened is refused. The projection puts back what other tiers hold below a changed main path.
- Coalescing: the store remembers the step its last coalescing transaction made; the next one with the same key,
  inside the window, while that step is still the newest, commits with `merge: true` (the log replaces the step by
  the net change).

### What warrants a second pair of eyes
- `Store.replace` assumes every document of the new log is the main one or mounted (throws otherwise); `adopt`
  takes the other store's mounts and log as they are.
- The document tier is deep-frozen now: code that mutated state objects in place (always a bug) now throws in
  strict mode. studio-kit and the apps may have such code.

### What should be done in the future
- P5b: rewire studio-kit's bridge (`editlog-route.ts`) onto mounts — see Step 6.

### Code review instructions
- `packages/shell/src/core/store.ts` (`route`, `commitWrites`, `replace`, constructor), `store/project.ts`,
  `store/drafts.ts`, `util.ts` `overProxy`; tests `test/core/store-ext.test.ts`, `test/core/core.test.ts`.
- `pnpm exec vitest run packages/shell && pnpm exec tsc -p packages/shell/tsconfig.json --noEmit`.

### Technical details
- Sources the store writes: `ctx.tx` → `{ kind: 'tx', …opts.source }`, a gesture → `{ kind: 'gesture' }`, a named
  draft → `{ kind: 'draft', draft: name }`; `detail` is added as `source.detail`. Edit ids `s<n>:<doc>`, batch id
  `s<n>` when several documents change.

## Step 5: README, final checks, consumer breakage, and the API P5b and P6 use

The values README documents `diff`, the log and `plan` with the three examples the spec asks for (a gesture in the
studio, an agent's proposal, a look over a roll); the shell README has a section on the three tiers. A last change
makes a transaction without mutations no edit (commit and propose skip it), so an empty gesture never becomes an
empty undo step.

I compared the whole vitest run against the phase's base commit (a temporary worktree at `cc246ef`, removed after):
the same 49 test files fail on both (the consumers P2a broke); per file, the only changes are mine and three
consumer files that now fail to load because they extend `EditLog` (listed below).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Finish P4: document the API, run the acceptance checks, hand P5b and P6 the API.

**Inferred user intent:** The next phases build on a stable, written-down history API.

**Commit (code):** 98af7e8 — "CHB-037 P4: a transaction without mutations is no edit (commit and propose skip it)"
(README: the commit before it)

### What I did
- `packages/values/README.md`: sections "The net change: diff" and "The document log: one history" with the
  examples; module table and error codes updated.
- Checks: `pnpm exec tsc -p packages/{values,contract,shell}/tsconfig.json --noEmit` green; `pnpm exec vitest run
  packages/values packages/contract packages/shell` → 26 files, 238 passed (values 68, contract 62, shell 108);
  `pnpm lint` green; `node tools/gen-docs/main.ts --contract-only --check` → ok; shell-demo browser project 3 passed.
- Whole-suite comparison: base `cc246ef` 49 failed files / 2320 passed tests; P4 49 failed files (the same set) /
  2319 passed; per-file differences (passed tests, base → P4): contract `editlog-builders` 5 → (renamed)
  `history-builders` 5; shell `store-ext` 9 → 7 (rewritten); values `diff` + 5, `log` + 12; agent `anthropic` 2 → 0,
  studio-kit `looks/engine` 4 → 0, `model-units-tools` 10 → 0 (all three: `TypeError: Class extends value undefined
  is not a constructor or null` — `class MirrorLog extends EditLog` in `packages/agent/src/worker/server.ts:16`,
  `class StudioLog extends EditLog` in `packages/studio-kit/src/model/enlarger.ts:105`).

### Why
- The spec's acceptance is per package; the comparison makes sure nothing outside P5b's and P6's scope broke.

### What worked
- No file outside studio-kit, apps/studio and agent changed status.

### What didn't work
- `grep -rn … --include=*.ts` under zsh: `no matches found: --include=*.ts` (the glob is expanded by zsh); quoting or
  plain `grep -rn` works.

### What I learned
- Consumers that still name the removed API (for P5b, P6 and P2b): studio-kit 29 files (`bridge/editlog-route.ts`,
  `model/enlarger.ts` `StudioLog`, `model/history.ts`, looks `plan.ts`, roll `buildBatch`, …), apps/studio 3
  (`main.ts` `rt.history.adopt`, …), agent 7 (`worker/server.ts` `MirrorLog`), dsl 4, core 1 test
  (`chb010.balance.test.ts` uses `EditLog.create`), engine-mock 1 test (`m1-trace.test.ts`), tools/scripts
  `m1-headless.ts`; all also use the recipe API P2a removed.

### What was tricky to build
- N/A (documentation and checks).

### What warrants a second pair of eyes
- The decisions the spec did not make (Technical details).

### What should be done in the future
- P5b: rewire studio-kit onto mounts and the log (below); delete `bridge/editlog-route.ts`, `StudioLog`, the
  roll kit's `buildBatch` and the looks kit's `planApply` batching in favour of `plan`.
- P6: the agent host holds no log of its own; it proposes into the store's log (below); `MirrorLog` goes.
- P2b: `chb010.balance.test.ts` and `m1-trace.test.ts` can use `edit()` or `Log` + `LOG_RULES`.
- Later: the journal grows without bound (the old History kept 500 entries); if long sessions need it, a log could
  fold its oldest steps into the initial documents (`compact(n)`), which keeps every invariant.

### Code review instructions
- Read `packages/values/README.md` (the last two sections) against `src/log.ts`, `src/plan.ts`, `src/diff.ts`.

### Technical details

**The API P5b (studio) uses**

- Store options and services: `app.start({ rules: LOG_RULES, … })` (contract `LOG_RULES = { frame: DOCUMENT_RULES }`);
  a kit declares `k.mount('recipes', { keyDepth: 1, kind: 'frame', checkPath })` (replaces `k.route`).
- Frames: `rt.store.open(frameId, doc, { at: ['recipes', frameId], kind: 'frame', by: 'auto', source: { kind:
  'ingest' } })`, `rt.store.close(frameId)`. Initial or restored state under a declared mount opens by itself (one
  document per key). Reads: `s.recipes[f]` is the frame's current document (frozen); `rt.store.log.doc<Document>(f)`.
- Edits: unchanged call sites — `ctx.tx(label, t => { t.recipes.f.stages… = … })`, `ctx.set`, `ctx.preview(path, v)` /
  `ctx.commit(label, { detail, coalesce, source })` / `ctx.cancel()`; each frame's net change is one edit, several
  frames one batch. Paths into a frame are physical in the state (`recipes.f1.stages.darkroom.stack.items.L1.amount`);
  the log records id-anchored paths (`L1.amount`).
- A direct log operation (approve, reject, a planned batch, a load): `rt.store.change(log => log.commit(batch))`,
  `rt.store.change(log => log.approve(seq))`; undo/redo `rt.undo()` / `rt.redo()` (return the `Step`), labels from
  `rt.store.log.undoStep/redoStep`; "(on Frame 12)" from `stateOpts.docName(doc, s)` / `currentDoc(s)`.
- Named drafts (a proposal shown before approval): `ctx.draft('proposal:<seq>').set(path, v)` … `.drop()`; or
  compute the what-if as a values draft: `rt.store.log.draft<Document>(f).apply(...entry.tx.mutations).value`.
- Batches: `plan(rt.store.log.targets<Document>(frameIds), (doc, id) => mutations | transaction | null, { id, label,
  by, source })` → `{ edits, skipped }`; commit with `store.change(l => l.commit(b))` (user) or propose (agent).
- Provenance chips: `rt.store.log.why(frameId, 'L1.params.ev')` → `{ by, source, label, tx, at, approvedBy, value }`.
- Per-frame history panel: `log.inEffect(frameId)` (entries in effect), `log.entries` (journal with pending and
  rejected), `log.steps`/`log.cursor`.
- Persistence: `store.snapshot('document')` is main ⊕ mounted documents; drop `recipes` in `stateOpts.persist` if the
  studio saves frames itself; the log itself serialises with `log.toJSON()` / `Log.load(data, { rules: LOG_RULES })`.
- Adopting across a layout switch: `newRt.store.adopt(oldRt.store)` (replaces `rt.history.adopt`).

**The API P6 (agent) uses**

- Read: `log.doc<Document>(f)`, `log.pending(f?)`, `log.inEffect(f?)`, `log.why(f, path)`, `log.trail(f, path)`.
- What-if: `log.draft<Document>(f).apply(...mutations).value` (compile it with the one compiler).
- Write: build `transaction({ id, label, by: 'agent', source: { kind: 'agent', turn, step }, mutations })`;
  ask mode → `log.propose({ doc: f, tx }, { why })`; auto mode → `log.commit({ doc: f, tx })`; read-only → refuse
  (E_READONLY, the host's policy). Across frames: `plan(log.targets(ids), build, { id, label, by: 'agent', source })`
  then `propose(batch, { why })`. Approval: `approve(seq | seqs | { batch }, { by: 'user', force? })` (E_STALE when
  stale), `reject(sel)`. `EvalResult.transactions` holds the `LogEntry`s an eval made; `AgentMode` is in
  `contract/eval.ts`.

**Signatures (values)**

```ts
class Log {
  static create(o?: { rules?: Rules; now?: () => number }): Log;
  static load(data: LogData, o?: LogOptions): Log;
  open(id: string, doc: object, o?: { kind?: string; by?: Author; source?: JsonObject }): Log;
  close(id: string): Log;
  ids(): string[]; has(id: string): boolean; doc<D>(id): D; initial<D>(id): D; kind(id): string;
  targets<D>(ids?: readonly string[]): Target<D>[];
  draft<D>(id: string): Draft<D>;
  readonly entries: readonly LogEntry[]; entry(seq): LogEntry | undefined; readonly last: LogEntry | undefined;
  readonly steps: readonly Step[]; readonly cursor: number; inEffect(doc?): LogEntry[]; pending(doc?): LogEntry[];
  readonly canUndo: boolean; readonly canRedo: boolean; readonly undoStep: Step | null; readonly redoStep: Step | null;
  docsOf(step: Step): string[];
  commit(x: Edit | Batch, o?: { merge?: boolean }): Log;
  propose(x: Edit | Batch, o?: { why?: string }): Log;
  approve(sel: Selector, o?: { by?: Author; force?: boolean }): Log;   // E_STALE
  reject(sel: Selector): Log;
  undo(): Log; redo(): Log;
  trail(doc: string, path: string): Why[]; why(doc: string, path: string): Why;
  toJSON(): LogData;
}
class Draft<D> { readonly doc: string; readonly base: D; readonly value: D;
  static of(doc, base, validate?): Draft<D>; apply(...ms): Draft<D>; set(path, v): Draft<D>; update(f): Draft<D>;
  reset(): Draft<D>; mutations(): readonly Mutation[]; readonly changed: boolean; edit(meta): Edit }
function plan<D>(targets: Iterable<Target<D>>, build: (value: D, doc: string) => Transaction | readonly Mutation[] | null | undefined,
  meta: { id: string; label: string; by: Author; source?: JsonObject }): Batch;
function diff(before: object, after: object): Mutation[];
type Edit = { doc: string; tx: Transaction };
type Batch = { id; label; by; source; edits: readonly Edit[]; skipped: readonly { doc: string; error: unknown }[] };
type LogEntry = { seq; doc; tx; at; why?; approvedBy? };  type Step = { seqs: readonly number[]; label; batch? };
type Selector = number | readonly number[] | { batch: string };
type Target<D> = { doc: string; value: D; rules?: TxOptions };
```

**Decisions the spec did not make**

1. The log is an immutable value holding all documents of a session with **one cursor** (not one log per document):
   a batch is one step, and nothing is ever skipped.
2. A step is "the entries of one commit or one approval"; a commit after undo removes the redo tail from the journal
   (pending and rejected entries are never dropped).
3. Selecting one entry of a batch selects the whole batch (approve/reject never split a batch).
4. Undo/redo do not re-run the rules (the states they restore were valid); approve and merge do.
5. `why(doc, path)` is by value change (folding the entries in effect), not by matching mutation paths.
6. The net change is computed (`diff`), not accumulated; drafts apply only the per-mutation rule while they move.
7. The agent mode (read-only/ask/auto) is host policy; the log accepts commits by any author.
8. `merge` (coalescing) lives in the log as "replace the newest step by the net change"; the store decides when
   (same key, inside 1.5 s on its clock, the step still newest).
9. Shell: routes become **mounts**; documents under a kit's declared mount open from initial state; a write under a
   declared prefix where no document is open is refused; the document snapshot includes mounted documents;
   channels are gone (a step's documents say where it happened: `docName`/`currentDoc`).
10. `store.doc` is renamed `store.committed` (the committed tree of all tiers, beside `log.doc(id)`), the tx
    lambda's draft is `Writer` (`WriterOf<S>`), and `writeDoc` is `writeView` (document paths refused).
