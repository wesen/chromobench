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
RelatedFiles: []
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
