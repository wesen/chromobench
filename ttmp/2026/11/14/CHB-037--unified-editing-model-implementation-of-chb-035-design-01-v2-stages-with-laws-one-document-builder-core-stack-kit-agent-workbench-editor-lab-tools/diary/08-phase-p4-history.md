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
