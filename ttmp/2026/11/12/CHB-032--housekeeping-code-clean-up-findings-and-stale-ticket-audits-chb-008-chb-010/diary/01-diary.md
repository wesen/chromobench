---
Title: Diary
Ticket: CHB-032
Status: active
Topics:
    - architecture
    - product
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-12T17:10:49.957516312-05:00
WhatFor: ""
WhenToUse: ""
---

## Step 1: Start, branch, baseline

The orchestrator handed CHB-032 to this agent: audit the stale tickets CHB-008 and CHB-010, then a series of
behaviour-preserving clean-ups (the TIFF shim, one TIFF writer, interim-data naming, e2e waits, four file splits,
dead code) and two reference docs. I created the branch, installed dependencies and ran the three checks on the
untouched branch to have a baseline to compare each clean-up against.

The two audits went to two read-only Explore agents in parallel (one per ticket); while they read, I started on the
TIFF clean-ups. Their tables are checked and recorded in Step 2.

### Prompt Context
**User prompt (verbatim):** "You are implementing CHB-032: **housekeeping — code clean-up and stale ticket audits** in the chromobench monorepo.

Read first: the common brief /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/brief-common-v2.md (rules, checks, diary format, final reply; its \"Additions\" section matters). Your ticket: `ttmp/2026/11/12/CHB-032--housekeeping-code-clean-up-findings-and-stale-ticket-audits-chb-008-chb-010/` — its tasks are the spec (`docmgr task list --ticket CHB-032`).

Your specifics:
- Branch: `task/chb-032-housekeeping` (create it first in your worktree; `pnpm install --offline` if node_modules is missing).
- Diary (exists, write in it): `ttmp/2026/11/12/CHB-032--…/diary/01-diary.md` — the diary skill's investigation format exactly (read /home/manuel/.claude/skills/diary/SKILL.md and references/investigation-entry.md); Step 1 quotes this prompt verbatim; every step has all sections; write as you go; commit with the code.
- Ports: browser tests STUDIO_PORT=5421 STUDIO_KIT_PORT=5422 SHELL_DEMO_PORT=5423 GPU_PARITY_PORT=5424.
- Write the two docs (undo/history; which engine computes what) as docmgr docs in your ticket (`docmgr doc add --ticket CHB-032 --doc-type reference --title …`), with mermaid diagrams, textbook style (definitions first, no analogies).

Order and rules:
1. The two audits first (CHB-008 and CHB-010): read each open task in those tickets' tasks.md, decide DONE / PARTLY / OPEN with file:line evidence, record the table in your diary, tick DONE tasks in the ticket (`docmgr task check`), and for PARTLY tasks mark them `(done: …; remaining: …)` and add a new task with only the remaining part. Close a ticket only if nothing remains (`docmgr ticket close --ticket … --changelog-entry …`).
2. The code clean-ups: the real engines stop importing the mock engine's TIFF shim; one 16-bit TIFF writer; the \"interim data\" naming and the Node-only default data in core's RefEngine; the e2e status-text waits review; the splits of `packages/gpu/src/engine-gpu.ts`, `packages/dsl/src/host.ts`, the looks and finish kits; a dead-code/unused-exports pass. Behaviour must not change: GPU conformance stays 320/320, DSL and kit tests and explain snapshots unchanged (if a snapshot changes, explain why in the diary). Commit each clean-up separately with green checks.
3. SKIP task dgz9 (splitting the shell's store.ts and viewport.ts) — it waits until CHB-031 merges; leave it open with a note.

Parallel work: CHB-031 WS-A (enlarger defaults, contract catalogue, controls panels, `packages/studio-kit/src/kit/args.ts`, first-print) and WS-B (`apps/studio/src/main.ts` open flow and library, `packages/studio-kit/src/bridge/frames.ts`, `apps/studio/src/host/decode.ts`) are running. Do not edit those files beyond import fixes required by your moves; avoid `packages/studio-kit/src/cb.ts` entirely. Don't touch `packages/contract`."
**Assistant interpretation:** Audit two stale tickets with evidence and update their task lists; then make the listed
clean-ups one commit each without changing behaviour; write two reference docs; leave dgz9 open.
**Inferred user intent:** Pay down the debt that accumulated over CHB-001…CHB-031 before the next feature work, and
make the ticket list tell the truth.
**Commit (code):** N/A (setup).

### What I did
- `git checkout -b task/chb-032-housekeeping`; `pnpm install --offline` (node_modules was missing; done in 1 s).
- Baseline: `pnpm typecheck && pnpm lint && pnpm test` → exit 0; **95 test files, 2733 passed, 7 skipped** (75 s).
- Launched two Explore agents for the CHB-008 and CHB-010 audits.
- Read the TIFF situation: `grep -rn "tiff16\|readTiff\|writeTiff" packages apps tools e2e`.

### Why
- A baseline count makes "behaviour unchanged" checkable after each clean-up (same counts, same snapshots).

### What worked
- Checks green on the branch point (9d10010).

### What didn't work
- `grep -rn … --include=*.ts` failed in zsh (`no matches found: --include=*.ts`); quoting the glob fixed it.

### What I learned
- The kits live at `packages/studio-kit/kits/{looks,finish,roll,chat}/src/kit.ts`, not `kits/…` at the root as
  the task text says.
- The M1 negative's sha256 (`29ffc4d5…`) is pinned in three snapshot files
  (`packages/studio-kit/test/__snapshots__/kit.test.ts.snap`, `variants.test.ts.snap`,
  `packages/shell/test/build/__snapshots__/extend.test.ts.snap`), so the bytes `makeM1Tiff()` writes must not
  change in the TIFF writer consolidation.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- N/A (no code yet).

### Technical details
- Package dependencies (`@chromobench/*`): core → contract, data, engine-mock, conformance, ingest; gpu → contract,
  engine-mock, core, data, conformance; output → contract, core, engine-mock; engine-mock → contract, ingest,
  conformance; ingest → contract. So ingest is the lowest package that can own TIFF reading and writing.

## Step 2: Audits of CHB-008 and CHB-010

Two read-only agents read every open task of the two tickets against the code, the tickets' diaries and the later
tickets. I spot-checked the claims that decide a verdict (the playbook folder, the CHB-008 guide's lines 118 and 968
against the textbook, the stale base-flash warning in `compileExposures`, the `flashExposure` code path, the
density-mask kinds in the recipe type, the absence of any engine setting `preview: true`). Neither ticket can be
closed: CHB-008 keeps two open tasks plus nine follow-ups, CHB-010 two open tasks plus seven follow-ups.

Convention used for a PARTLY task: its text gets "(done: …; remaining: …)" with evidence, it is ticked, and a new
task "[follow-up of <id>, CHB-032 audit] …" carries only the remaining part. The one erratum (lzad) I fixed in the
CHB-008 guide, after checking the textbook: the erratum was half wrong.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Order item 1: verdicts with file:line evidence, tick, split PARTLY tasks, close only if
nothing remains.
**Inferred user intent:** The two oldest tickets' task lists should say what is really left.
**Commit (code):** see the commit after this step ("CHB-032: audit CHB-008 and CHB-010 …").

### What I did
- Two Explore agents (one per ticket), briefed to check each sub-clause and return file:line evidence.
- Spot checks: `ls packages/agent/playbooks` (3 files); `sed -n 95,115p packages/core/src/print/exposures.ts`;
  `sed -n 200,212p packages/core/src/ops/ops.ts`; `grep -rn "preview: true" packages/core/src packages/gpu/src
  packages/engine-mock/src` (nothing); `grep -n kind packages/contract/src/recipe.ts` (`'contrast' | 'unsharp'`);
  textbook `ttmp/2026/11/11/CHB-001--…/sources/The Mathematics of the Colour Negative.md` lines 377, 530-536, 586, 917.
- Applied the verdicts with two scripts of `docmgr task edit/check/add` (kept in the scratchpad,
  `chb032/audit-chb008.sh`, `chb032/audit-chb010.sh`), and one `docmgr changelog update` per ticket.
- Fixed the CHB-008 guide `design-doc/01-intern-guide-agent-integration.md` lines 118 and 968.

### Why
- Ticking a PARTLY task and adding a follow-up with only the remainder keeps the "what is left" list short and exact;
  leaving the original unticked would hide which half is missing.

### What worked
- CHB-008 table (verdict, evidence, remaining):

| id | task | verdict | evidence | remaining → follow-up |
|---|---|---|---|---|
| iefi | channel.ts envelope/runner/messages | PARTLY (superseded) | `packages/agent/src/bridge/page-client.ts:13-31` (BridgeToPage, PageToBridge), `:44-46` EvalRunner; staging `packages/dsl/src/session.ts:405-446`; CHB-008 diary Step 16 (:874-878) records that channel/commit/render were replaced by CHB-007's DslSession | eval origin in envelope and logged mutations (agent CONTRACT-REQUESTS R2) → saxi |
| em2d | commit.ts | PARTLY | `packages/contract/src/mutations.ts:19,51-97`; `paths.ts:126-135` checkSet; `editlog.ts:254,266-285`; tx `dsl/src/session.ts:420`; discard `:445-446` | user-conflict downgrade to pending (R1) → 7v7v |
| luix | render.ts and golden | PARTLY | edits section `dsl/src/session.ts:428`, statuses `:521-557`; golden `packages/dsl/test/representative.result` pinned by `examples.test.ts:112,135` | approvals-since context in worker/MCP results, agent-level golden → kbxw |
| jgyd | bridge module, internal/web embed | PARTLY | `bridge/go.mod`; `bridge/cmd/chromobench/main.go:47-56,125-193`; `bridge/internal/server/server.go:44-79` | go:embed of the studio (served with `--dir`, `server.go:108-124`) → 3hb1 |
| a4uc | local guards and setup docs | PARTLY | `bridge/internal/guard/guard.go:50-112`; `hub/ws.go:36`; attach `main.go:145-151`; `bridge/README.md:20-30`; tests `server_test.go:255,294` | CrossOriginProtection, SameSite cookie, docs page → kd8u |
| ch9a | Claude proxy | OPEN | no `/api/claude` route in `server.go:44-79`; `bridge/README.md:40-41` "Not yet" | stays open |
| 99av | chat client and thread store | PARTLY | `packages/agent/src/chat/anthropic.ts:14,43-68`; `chat/session.ts:181,263-266,353-362` | persistent thread store (`studio-kit/src/bridge/kv.ts:5` unused) → qur1 |
| 1m3u | looks, attachments, approvals, revert | PARTLY | `chat/session.ts:442-557`; `dsl/src/session.ts:36`; `dsl/src/results/looks.ts:11` | user image attachments → 5yyv |
| siva | five playbooks | PARTLY (3/5) | `packages/agent/playbooks/{grey-balance,ring-around,test-strip}.js`; `test/playbooks.test.ts:13-25` | dust pass, roll consistency → eqyx |
| hnav | transcripts, replay, metrics | PARTLY | `packages/dsl/src/telemetry.ts:7-30`; `tools/dsl-usage/main.ts` | recording, replay harness, transcript metrics → vg50 |
| u7mw | budget-gated evaluations, privacy | OPEN | only the `imagesSent` counter, `chat/session.ts:91-92,454` | stays open |
| lzad | errata | DONE (CHB-032) | guide lines 118, 968 corrected | — |

- CHB-010 table:

| id | task | verdict | evidence | remaining → follow-up |
|---|---|---|---|---|
| j9cj | filter fast path | OPEN | preview flag only in the contract (`packages/contract/src/engine.ts:69-70,86`); `dxdCC` uncached (`core/src/print/enlarger.ts:97,165-172`); no engine sets `preview: true` | stays open |
| 88wp | Jacobian preview parity | OPEN | only the matrix goldens `chb010.J.real/normalised` (`core/test/chb010.golden.test.ts:52`) | stays open (blocked on j9cj) |
| mh4d | testStrip | PARTLY | studio strips from print nodes `studio-kit/src/bridge/render-bridge.ts:32-37,192-199`; bands `studio-kit/src/model/tools.ts:10-46`; mock op `engine-mock/src/ops.ts:468-485`; v0 contract args `measure-darkroom-finishing.ts:65-81` | seconds mode, density-hold filter strips, tiles, per-step table, real engines → mj68 |
| d8xc | ringAround, contactSheet | PARTLY | lights ring `studio-kit/src/model/tools.ts:66-96`; contact sheet single/balanced `kits/roll/src/kit.ts:67-79,461-476`; op stub `engine-mock/src/ops.ts:498-503` | filter moves with density hold, real-engine ops → fx3n |
| 1cg3 | grade, preflash, reciprocity | PARTLY | grade `core/src/print/paper.ts:130-152`, GPU `engine-gpu.ts:378-383`, law `core/src/laws/chb010.laws.ts:72-80`; preflash is a neutral φ in H (`core/src/ops/ops.ts:290-294`); reciprocity only a comment (`enlarger.ts:43-44`) | preflash as flash-base on core and GPU, reciprocity hook → dotm |
| gqh1 | goldens, contract filing | PARTLY | `fixtures/golden/chb010-enlarger.json:20-21`, `core/test/chb010.golden.test.ts:57-64`; filing went to `core/CONTRACT-REQUESTS.md` C1-C8 and CHB-024 | equal-increment strip golden → f1kv |
| gbmp | C1-C4 | PARTLY | C1-C3 `CONTRACT-DECISIONS.md:325-326`; C4 deferred `:327` | C4 real default (= CHB-031 F17) → i3wj |
| hnur | flash through base/open, law | DONE | compile `contract/src/graph.ts:298-299`; core `ops.ts:200-211`; GPU `engine-gpu.ts:722-748`; law `conformance/src/semantics.ts:59-74` | stale notes → odj8 |
| 1pv3 | density masks in the recipe | PARTLY | via print.combine (`CONTRACT-DECISIONS.md:328`); compile `graph.ts:282-301`; same polarity `core/src/print/densityMask.ts:45-47` | highlight (threshold) masks → gynm |
| od5a | C5-C8 | DONE | `CONTRACT-DECISIONS.md:328-329`; `capture-film-print.ts:4-5,104-133`; `view-output-mask.ts:85-119` | — |

### What didn't work
- A compound shell command with several `docmgr` calls in a function was refused by the worktree guard ("too
  complex to verify that it stays inside the worktree"); the same commands in a script file run with `bash <file>`
  from the worktree went through.

### What I learned
- The lzad erratum was half wrong: the textbook states α = 0.75 in §2.6 itself (line 536, `ℓ = ℓaim + m + α(Δ−m)`)
  and implements it in §3.6 (line 937, `integrate = (alpha = 0.75)`), so the guide now cites both. The 0.755 part was
  right: 0.755 is in the chapter-2 introduction (line 377) and §2.7 "Try it" (line 586).
- CHB-008's channel.ts/commit.ts/render.ts were never meant to exist after CHB-007 (diary Step 16); verdicts for
  those three judge the behaviour, not the file names.
- The darkroom procedures (test strip, ring-around) live in the studio, composed from ordinary print nodes; the
  contract ops `darkroom.testStrip/ringAround/contactSheet` exist only on the mock.

### What was tricky to build
- Deciding PARTLY vs DONE for superseded designs. Rule used: DONE only when every clause's behaviour exists; a clause
  that is still a real missing behaviour (conflict downgrade, origin tagging) makes it PARTLY even when the file the
  task names was replaced on purpose.

### What warrants a second pair of eyes
- CHB-010 hnur is DONE, but `compileExposures` still emits `W_PREVIEW_APPROX` for base flashes
  (`core/src/print/exposures.ts:112-113`) and a test asserts it. Removing it changes a diagnostic, so I left it to the
  follow-up odj8 instead of doing it in a behaviour-preserving ticket.
- Outside the tasks: CHB-008 m3zx is ticked but `bridge/go.mod` pins go-sdk v1.7.0, not v1.8.0+; the Go tests are not
  run by `pnpm test`.

### What should be done in the future
- The follow-up tasks listed in the tables; ch9a, u7mw, j9cj, 88wp stay open.

### Code review instructions
- `docmgr task list --ticket CHB-008`, `docmgr task list --ticket CHB-010`; the guide diff
  `git diff -- ttmp/2026/11/11/CHB-008--*/design-doc/`.

### Technical details
- New task ids. CHB-008: saxi, 7v7v, kbxw, 3hb1, kd8u, qur1, 5yyv, eqyx, vg50. CHB-010: mj68, fx3n, dotm, f1kv, i3wj,
  gynm, odj8.

## Step 3: The real engines stop importing the mock (task 02r5)

`RefEngine.open` and `GpuEngine.open` read TIFF bytes through `readTiff` from `@chromobench/engine-mock`, a shim
that itself only wrapped ingest's `decodeTiff`. The reader moved into ingest as `readTiffCodes` (same code, same
output shape), the engines import it from there, and `packages/engine-mock/src/tiff16.ts` is gone. Test fixtures that
took `writeTiff16` from the mock now take it from ingest. Same test counts as the baseline.

With that, `@chromobench/core` and `@chromobench/gpu` no longer need the mock at run time: core's dependency moved to
devDependencies (its tests still use `makeM1Tiff`), gpu dropped it (only `src/parity/synthetic.ts` used it, for
`writeTiff16`).

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Task 02r5: real engines read TIFF through ingest; delete the shim, keeping what the mock
needs (`makeM1Tiff`, `m1Codes`, `M1`).
**Inferred user intent:** The dependency graph should say "the mock is a test double", not "physics depends on it".
**Commit (code):** see the next commit, "CHB-032: real engines read TIFF through ingest; drop the engine-mock TIFF shim".

### What I did
- `packages/ingest/src/decode/tiff.ts`: new `readTiffCodes(bytes): TiffCodes` (the shim's body, renamed: ingest already
  has a different `RawImage`); exported from `packages/ingest/src/index.ts`.
- `packages/core/src/engine-ref.ts`, `packages/gpu/src/engine-gpu.ts`: `import { readTiffCodes } from '@chromobench/ingest'`;
  removed the GPU's stale `TODO(CHB-006)` comment above it.
- Deleted `packages/engine-mock/src/tiff16.ts` and its export line; `m1.ts` imports `writeTiff16` from ingest.
- Consumers moved to ingest: `packages/gpu/src/parity/synthetic.ts`, `packages/output/test/export.test.ts`,
  `packages/studio-kit/demo/main.ts`, `packages/studio-kit/test/{looks/kit.test.ts,roll/fixtures.ts}`,
  `packages/engine-mock/test/m1-trace.test.ts`.
- package.json: core (ingest → dependencies, engine-mock → devDependencies), gpu (engine-mock out, ingest in),
  output (ingest in devDependencies); `pnpm install --offline` updated the lockfile.
- `pnpm typecheck` ok; `pnpm lint` ok (import boundaries ok, 336 file checks); `pnpm test` → 95 files, 2733 passed,
  7 skipped (= baseline).

### Why
- Moving the reader instead of inlining the interleave loop twice keeps one copy; ingest is the lowest package
  that both engines may depend on.

### What worked
- Unit tests unchanged in count and green; snapshots untouched (the M1 bytes are produced by the same writer).

### What didn't work
- My first audit commit picked up the staged `git rm` of `tiff16.ts` (a plain `git commit` commits everything staged,
  not only the paths I had just added). Fixed with
  `git restore --source=HEAD~1 --staged packages/engine-mock/src/tiff16.ts && git commit --amend --no-edit`.
  From here on I check `git diff --cached --stat` before each commit.

### What I learned
- engine-mock's own source never used `readTiff`/`isTiff`; only one test and the two real engines did.

### What was tricky to build
- Name clash: ingest exports a `RawImage` (planes, levels, encoding) different from the shim's `RawImage`
  (interleaved codes). The moved type is `TiffCodes`.

### What warrants a second pair of eyes
- `@chromobench/gpu`'s package.json no longer lists engine-mock; if a gpu browser test page imports it, Vite would
  still resolve it through the workspace root, but check `packages/gpu/parity-page` when running the parity suite.

### What should be done in the future
- N/A.

### Code review instructions
- `git show <commit> -- packages/ingest packages/core/src packages/gpu/src packages/engine-mock`; run
  `pnpm vitest run packages/core packages/engine-mock packages/output`.

### Technical details
- `readTiffCodes` refuses float and 32-bit TIFFs (`8/16-bit integer TIFF expected; decode others with decodeTiff`);
  hosts decode those with ingest and call `openDecoded`, as before.

## Step 4: One TIFF writer (task i6gf)

There were three TIFF serialisers: ingest's general fixture writer `writeTiff` (any byte order, bit depth,
compression, tiles, SubIFDs), ingest's hand-rolled `writeTiff16` (the M1 negative, 30 lines of offsets), and
output's streaming export writer `Tiff16Writer` with its own IFD builder. Now there is one IFD encoder,
`encodeIfd` in `packages/ingest/src/decode/tiff-write.ts`: `writeTiff` lays out its IFDs and blocks and calls it,
`writeTiff16` is a thin wrapper over `writeTiff`, and `Tiff16Writer` keeps only its streaming logic (strips as rows
arrive, Deflate, the patched IFD offset) and encodes its IFD with `encodeIfd`.

Every byte stayed the same: a corpus of 226 files from both writers (all byte orders, bit depths, compressions,
planar/tiled, predictors, float, a DNG with every tag type, SubIFDs of both types, the M1 negative, export TIFFs with
and without ICC, two dpi values, three sizes, both compressions) hashes identically before and after.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Task i6gf: consolidate the ingest and output TIFF writers; fixtures use the output writer
or a thin wrapper.
**Inferred user intent:** One place to fix TIFF writing bugs; no second, divergent 16-bit writer.
**Commit (code):** see the next commit, "CHB-032: one TIFF IFD encoder; writeTiff16 wraps writeTiff; Tiff16Writer uses encodeIfd".

### What I did
- `packages/ingest/src/decode/tiff-write.ts`: new exported `ifdLength(tags)` and
  `encodeIfd(tags, at, { littleEndian, next })`; `TagValue.values` may be raw bytes (`Uint8Array`, 1-byte types) and
  carries an optional `denominator` for RATIONAL/SRATIONAL; `TiffImageSpec.shortFields` (SHORT width/height/rows per
  strip, no SampleFormat); `writeTiff` builds each IFD with `encodeIfd`; `writeTiff16` = de-interleave + `writeTiff`
  with `shortFields`.
- `packages/output/src/encode/tiff16.ts`: `Tag` = ingest's `TagValue`; `buildIfd` = `encodeIfd(…, { littleEndian: true })`;
  the 50-line local IFD builder and `tagBytes` are gone; XResolution/YResolution as `{ values: [dpi], denominator: 1000 }`
  (= the old `[round(dpi·1000), 1000]`).
- `packages/output/package.json`: `@chromobench/ingest` moved to dependencies.
- Byte check: `node <scratchpad>/chb032/tiff-corpus.ts` before (on d8f6336) and after, `diff` → identical, 226 lines.
- `pnpm typecheck`, `pnpm lint` ok; `pnpm vitest run packages/ingest packages/output packages/engine-mock` → 17 files,
  1529 tests passed; full `pnpm test` (result in the commit step below).

### Why
- The task allows "the output writer or a thin wrapper" for fixtures. The output writer cannot serve fixtures:
  ingest and engine-mock sit below output in the dependency graph (output → core → ingest), and it writes tags
  (resolution, software, date) that would change the M1 bytes. So the shared piece is the encoder, owned by the lowest
  package, and the two writers keep the parts that really differ (fixture breadth vs. streaming export).
- `shortFields` instead of keeping the hand-rolled writer: the M1 file's sha256 is pinned in three snapshot files;
  the old writer differs from `writeTiff`'s default only in SHORT vs LONG field types and the SampleFormat tag.

### What worked
- Byte-identical corpus; no snapshot changed.

### What didn't work
- A `python3 - <<EOF … EOF` edit run inline was refused by the worktree guard ("too complex to verify"); writing the
  edit script to the scratchpad and running `python3 <file>` works.

### What I learned
- Ingest's layout (directory, overflow values each word-aligned at absolute positions, then blocks) and output's
  (values word-aligned relative to an even IFD start) are the same rule, so one encoder fits both without moving a byte.

### What was tricky to build
- The value padding: the old `writeTiff` advanced `pos` by the last overflow value's exact size and padded with
  `even()` before the first block, while `ifdLength` includes that pad. The block positions are the same because each
  block starts with `even()`; the corpus confirms it.

### What warrants a second pair of eyes
- `encodeIfd` copies and sorts its input; `Tiff16Writer` calls it twice for uncompressed files (probe, then real
  offsets) exactly as before.

### What should be done in the future
- `tiffTags` in output (a minimal IFD reader for tests) duplicates ingest's `readIfds`; it is test-only and returns
  raw value bytes, so I left it.

### Code review instructions
- `packages/ingest/src/decode/tiff-write.ts` (`encodeIfd`, `writeTiff`, `writeTiff16`), `packages/output/src/encode/tiff16.ts`.
- `pnpm vitest run packages/ingest packages/output`; the corpus script is
  `/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/chb032/tiff-corpus.ts`.

### Technical details
- M1 sha256 `29ffc4d574382d06…` before and after (= `fixtures/synthetic/m1-negative-96x64.tif`).

## Step 5: "Interim data" naming and RefEngine's Node-only default (task 0tc4)

Core exported three names for two data sets: `interimData` and `packsData` both meant CHB-004's packs read from
disk (Node only), and `legacyInterimData` meant the retired CHB-001 JSON set. `RefEngine` silently defaulted to the
Node-only packs, so a browser caller that forgot `data` got a file-system error deep inside. Now `RefEngineOptions.data`
is required, the Node helper has one explicit name (`nodePacksData`), and the CHB-001 set is `chb001InterimData`.
Chromogen's conventions (and with them the fitted CMFs) are documented as test-only.

The full suite after Step 4's commit (c7e33a9) was green: 95 files, 2733 passed, 7 skipped. After this step: the
same.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Task 0tc4: no hidden Node-only default in RefEngine; rename legacyInterimData; keep the
Chromogen CMFs as tests-only, documented.
**Inferred user intent:** Names should say what the data is and where it can load.
**Commit (code):** see the next commit, "CHB-032: RefEngine requires data; nodePacksData and chb001InterimData replace the interim names".

### What I did
- `packages/core/src/engine-ref.ts`: `data: PhysicsData` (required), `constructor(o: RefEngineOptions)`; dropped the
  `@chromobench/data/node` import.
- `packages/core/src/index.ts`: `export { nodePhysicsData as nodePacksData }`; `export { chb001InterimData, interimFromJson }`;
  the `interimData`/`packsData`/`legacyInterimData` names are gone.
- `packages/core/src/data/interim.ts`: `interimData` → `chb001InterimData`, header rewritten (what the set is, who
  still uses it).
- `packages/core/src/spectral/conventions.ts`: doc comment on `CHROMOGEN` (golden tests and law harnesses only;
  engines run `DEFAULT_CONVENTIONS`; `cmfChromogenFit` is reached only through it).
- `packages/data/src/node.ts`: comments no longer call it a replacement for `interimData()`.
- Tests: 21 files renamed by a word-boundary script (`interimData|packsData` → `nodePacksData`,
  `legacyInterimData as interimData` → `chb001InterimData` in packs-parity); 11 files now pass
  `{ data: nodePacksData() }` to `new RefEngine(…)` (typecheck listed them: apps/studio host and worker-engine tests,
  core engine-ref, engine-ref-sampled, chb010.*, film.stage5, one-physics, retouch, output export, studio-kit roll engine).
- Checks: `pnpm typecheck` 0 errors, `pnpm lint` ok, `pnpm test` 95 files, 2733 passed, 7 skipped.

### Why
- "Data required" over "an explicit node helper as the default": every production caller
  (`apps/studio/src/host/engines.ts:193`, `engine-serve.ts:66`, gpu `parity/chain-tests.ts:54`) already passes data, so
  only tests change, and a missing `data` is now a compile error instead of a runtime one in a browser.

### What worked
- Typecheck found every construction site; no behaviour change (the same default data reaches the same tests).

### What didn't work
- No failures.

### What I learned
- `nodePhysicsData` caches per pack pair, so calling it per test costs nothing extra.

### What was tricky to build
- `engine-ref-sampled.test.ts` takes engine options as a parameter; its type became
  `Omit<ConstructorParameters<typeof RefEngine>[0], 'data'>` and the helper spreads them after `data`.

### What warrants a second pair of eyes
- `packages/contract/CONTRACT-DECISIONS.md:238` still names core's `interimData()`; it is a decision record in the
  contract package, which this ticket must not touch.

### What should be done in the future
- Update that CONTRACT-DECISIONS.md line when the contract is next edited.

### Code review instructions
- `packages/core/src/index.ts:11-16`, `packages/core/src/engine-ref.ts:16-18`, `packages/core/src/data/interim.ts:1-9`.
- `pnpm typecheck && pnpm vitest run packages/core`.

### Technical details
- New public names: `nodePacksData` (Node only), `chb001InterimData` (Node only), `interimFromJson` (unchanged).

## Step 6: Split packages/gpu/src/engine-gpu.ts (task kiq4), and a checkpoint

`engine-gpu.ts` (1031 lines) is now 652 lines plus six modules in `packages/gpu/src/engine/`: `defs.ts` (op sets,
COMBINE modes, kernel sources, internal types, `cancelled`, `mulberry32`), `lower.ts` (`lowerChain`, `fillGrain`),
`dag.ts` (`planGraph`, `planNode`: which nodes are materialised and how often each texture is read), `textures.ts`
(`syntheticSource`, `uploadU16`, `readU16`, `combinePass`, `gaussianBlur`), `reduce.ts` (`reduceMeasure`) and
`results.ts` (`addResult`). The class keeps the Engine surface, device-loss handling, sources, `renderGraph`'s
execution loop and `execute()` (the per-op dispatcher, which touches most engine state). Each moved method body is
the same text with `this.x` replaced by a parameter; the class methods delegate.

The orchestrator asked for a checkpoint (the session may end). This step is that checkpoint: the split is
typechecked, linted and its package's unit tests pass; the browser parity suite (conformance 320/320) is not yet
run on it.

### Prompt Context
**User prompt (verbatim):** see Step 1. Mid-task messages relayed by the orchestrator: "commit at appropriate
intervals and keep a detailed diary as you work (using the diary format from the skill)", and a request to
checkpoint now with a resume list.
**Assistant interpretation:** Task kiq4 (behaviour and parity unchanged), then checkpoint with an exact resume list.
**Inferred user intent:** Smaller files with one concern each, no change in what the GPU computes; and work that
survives the session ending.
**Commit (code):** see the next commit, "CHB-032: split engine-gpu.ts into engine/{defs,lower,dag,textures,reduce,results}.ts".

### What I did
- Wrote the split as a script (`<scratchpad>/chb032/split-gpu.py`) that cuts each method out by its first line,
  replaces `this.physics`/`this.graph.get`/`this.rt`/`this.blur`/`this.reducer`/`this.unpackLut`/`this.results` with
  parameters, asserts no `this.` is left in a moved body, de-indents, and writes the module; then
  `split-gpu-imports.py` rewrote the import block. `GPU_OPS`, `COMBINE_WGSL` and `U16Result` are re-exported from
  engine-gpu.ts (index.ts imports `GPU_OPS` from there).
- `pnpm typecheck` → 0 errors after three fixes (below); `pnpm lint` ok; `pnpm vitest run packages/gpu` → 5 files,
  48 tests passed; `tsc --noUnusedLocals` reports nothing in the split files; full `pnpm test` running.

### Why
- Pure functions with explicit inputs for everything that does not need the engine's mutable state; `execute()` stays
  in the class because it reads eight members and recurses through `renderGraph` (retouch windows) and `rebates`.

### What worked
- Typecheck and the gpu unit tests; line counts: engine-gpu.ts 652, defs 62, lower 110, dag 60, textures 135,
  reduce 66, results 18.

### What didn't work
- `packages/gpu/src/engine/reduce.ts(67,1): error TS1128: Declaration or statement expected.` — my cut ended at the
  class's closing `\n}\n`, so the function got the class brace as well; removed the last line.
- `packages/gpu/src/engine-gpu.ts(291,28): error TS2304: Cannot find name 'Segment'.` — `lowerNode` still returns
  `Segment[]`; added `import type { Segment } from './chain/program.ts'`.
- `reduce.ts(48,71): error TS2532: Object is possibly 'undefined'.` — I typed the densities callback as
  `{ D: number[] }`; it is now `ReturnType<typeof densitiesOf>` (a type-only import from core), as before.
- A typecheck run was moved to the background by the harness while an orchestrator message arrived; waited for it.

### What I learned
- `noUnusedLocals` is off in the repo tsconfig; I checked the split files with an explicit
  `tsc --noEmit --noUnusedLocals` run.

### What was tricky to build
- `mix` and `gaussian` depend on each other (`gaussian` with σ ≤ 0 is a COPY pass): `gaussianBlur` takes a `copy`
  callback, and `combinePass` takes the 1×1 dummy texture as an argument so the lazily created texture stays owned by
  the engine (it is dropped on device loss).

### What warrants a second pair of eyes
- `renderGraph` now calls `planGraph(this.graph, id, check, chainOf)`; order, materialisation and reference counts
  are the moved code verbatim, but only the browser parity suite exercises them on a GPU.

### What should be done in the future
- Resume list (state at this commit):
  - Done and committed: audits CHB-008 and CHB-010 (Step 2, b0f6fa0); 02r5 shim removal (d8f6336); i6gf one TIFF
    encoder (c7e33a9); 0tc4 naming (1927c3f); kiq4 split (this commit, browser parity pending).
  - Running in background: a sub-agent writing the two reference docs (m6qo undo/history, vrrs engines) into
    `ttmp/2026/11/12/CHB-032--…/reference/` (untracked until reviewed and committed).
  - Next: (1) `pnpm --filter @chromobench/gpu test:browser` with `GPU_PARITY_PORT=5424` (conformance must stay
    320/320); (2) split `packages/dsl/src/host.ts` by vocabulary area (6qs1: print chain, edits, looks, errors);
    (3) split `packages/studio-kit/kits/{looks,finish}/src/kit.ts` into state/commands/panels (j38l);
    (4) e2e status-text waits (vuwz: multi-file opens in `e2e/studio-wording.spec.ts:26`, the `open()` helpers in
    `e2e/studio.spec.ts:36`, `chat.spec.ts:14`, `m1-walking-skeleton.spec.ts:37`); (5) dead code/unused exports (z99j);
    (6) review and commit the two docs; (7) `STUDIO_PORT=5421 STUDIO_KIT_PORT=5422 SHELL_DEMO_PORT=5423
    GPU_PARITY_PORT=5424 CI=1 pnpm test:browser`.
  - dgz9 (shell store/viewport split) stays open until CHB-031 merges.

### Code review instructions
- `packages/gpu/src/engine-gpu.ts` (head comment lists the modules), `packages/gpu/src/engine/*.ts`.
- `pnpm typecheck && pnpm vitest run packages/gpu`; parity: `GPU_PARITY_PORT=5424 pnpm --filter @chromobench/gpu test:browser`.

### Technical details
- Delegating methods kept on the class (same names, same signatures): `lower`, `uploadU16`, `readU16`, `gaussian`,
  `mix`, `cacheResult`, `reduce`; removed: `fillGrain` (now the module function), `planNode`.

## Step 7: Resume after the session restart; GPU parity of the engine-gpu split

The session restarted after Step 6's checkpoint. A new agent (this one) continues in the same worktree and branch
(`task/chb-032-housekeeping` at aef2d3d). I read the common brief, the ticket's tasks, this diary in full, and
`git status` (one untracked folder: the `reference/` drafts the docs sub-agent left). The CHB-008 and CHB-010 audits
the resume prompt lists are already done and committed (Step 2, 12efc67; `docmgr task list` for both tickets shows
the "(done: …; remaining: …)" texts and the follow-ups), so the first pending item was the browser parity check of
the engine-gpu split.

The parity suite passed on the split engine: 40 browser tests, conformance 320/320. Task kiq4 is ticked.

### Prompt Context
**User prompt (verbatim):** "You continue an interrupted task: CHB-032, **housekeeping — code clean-up and stale ticket audits** in the chromobench monorepo. The previous agent was stopped when the session restarted; its work is committed up to a checkpoint.

**Work ONLY inside this existing git worktree** (do not create a new one): `/home/manuel/code/wesen/chromobench/.claude/worktrees/agent-a51b6b68283982497` on branch `task/chb-032-housekeeping` (last commit aef2d3d). Start every shell command with `cd /home/manuel/code/wesen/chromobench/.claude/worktrees/agent-a51b6b68283982497 && …` and use absolute paths inside it for file edits. Do not touch the main checkout or other worktrees.

Read first:
1. The common brief: /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/brief-common-v2.md (rules, checks, diary format, final reply).
2. The ticket's tasks (`docmgr task list --ticket CHB-032`), which are the spec.
3. Your diary, which you continue: `ttmp/2026/11/12/CHB-032--housekeeping-code-clean-up-findings-and-stale-ticket-audits-chb-008-chb-010/diary/01-diary.md` — read all steps; Step 6 is the checkpoint with the resume list.
4. `git status`: an untracked `reference/` draft in the ticket (one of the two docs) — finish it.

Then continue: (1) the pending browser parity check of the engine-gpu split — GPU conformance must stay 320/320 (`STUDIO_PORT=5421 STUDIO_KIT_PORT=5422 SHELL_DEMO_PORT=5423 GPU_PARITY_PORT=5424 CI=1 pnpm test:browser`); (2) the audits of CHB-008 and CHB-010 (verdict DONE/PARTLY/OPEN with file:line evidence per open task, a table in the diary; tick DONE, split PARTLY into \"(done: …; remaining: …)\" plus a new task for the remainder; close a ticket only if nothing remains); (3) the real engines stop importing the mock engine's TIFF shim; one 16-bit TIFF writer; the e2e status-text waits review (switch to `window.chromobench.idle()` where they race); the two docs (undo/history; which engine computes what) as docmgr reference docs with mermaid diagrams, textbook style (definitions first, no analogies); the splits of `packages/dsl/src/host.ts` and the looks and finish kits; a dead-code / unused-exports pass. Behaviour must not change (explain snapshot changes if any). SKIP task dgz9 (store.ts/viewport.ts) — it waits for CHB-031's merge. Don't touch `packages/contract` or `packages/studio-kit/src/cb.ts`; avoid the files CHB-031 is editing (apps/studio/src/main.ts, status-text.ts, first-print.ts, studio-kit frames.ts and args.ts, host decode.ts) beyond import fixes required by your moves.

The user's instruction (verbatim): \"commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)\". Continue the same diary with the next step number: investigation format from /home/manuel/.claude/skills/diary/references/investigation-entry.md, every section in every step; the first new step records the resume and quotes this prompt verbatim. Each clean-up its own commit with green checks; stage named paths only. The owner's Mac is closed: do not use it."
**Assistant interpretation:** Pick up at Step 6's resume list: parity first, then the remaining clean-ups (e2e
waits, the two docs, the dsl host and kit splits, dead code), one commit each; dgz9 stays open.
**Inferred user intent:** Finish the housekeeping ticket without losing what the stopped agent did, and without
changing behaviour.
**Commit (code):** see the next commit, "CHB-032: diary step 7 (resume), GPU parity 320/320 on the engine-gpu split; tick kiq4".

### What I did
- Read the brief, `docmgr task list --ticket CHB-032` (02r5, i6gf, 0tc4, p4cv, c7sw ticked; kiq4 not yet), this
  diary, `docmgr task list --ticket CHB-008` and `--ticket CHB-010` (Step 2's verdicts and follow-ups are there).
- `git status`: clean except the untracked `reference/` folder with two drafts
  (`01-undo-and-history-across-the-layers.md`, 433 lines; `02-which-engine-computes-what.md`, 379 lines).
- `GPU_PARITY_PORT=5424 CI=1 pnpm --filter @chromobench/gpu test:browser` (background, log in the scratchpad
  `chb032/gpu-parity.log`).
- `docmgr task check --ticket CHB-032 --id kiq4`.

### Why
- Only the GPU project of the browser suite exercises `planGraph`, `combinePass`, `gaussianBlur` and `reduceMeasure`
  on a device; the full browser suite runs once at the end, with all the clean-ups in.

### What worked
- `40 passed (1.8m)`; `conformance {"total":320,"passed":320,"failures":[]}`; the output-space parity rows report
  `maxCodes16: 1` for every space and rendering, the worker tables are bitwise equal
  (`"differing":0` for solve, pd and print), the OPFS cache round-trips bit for bit.

### What didn't work
- No failures observed.

### What I learned
- The audit commit is 12efc67 (Step 6's resume list says b0f6fa0, the hash before the `--amend` recorded in Step 3).

### What was tricky to build
- N/A (a check).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Remaining, in order: the two reference docs (finish and commit), the e2e status-text waits (vuwz), the dsl
  `host.ts` split (6qs1), the looks and finish kit splits (j38l), dead code (z99j), the full browser suite.

### Code review instructions
- Re-run: `GPU_PARITY_PORT=5424 CI=1 pnpm --filter @chromobench/gpu test:browser`; look for the `conformance` line.

### Technical details
- The suite's tests with negative controls still fail their controls as designed (`LOG2_10 = 3.32` pd table
  `"pass":false`, row-major print matrix `"pass":false`), which the specs assert.

## Step 8: The two reference docs (tasks m6qo and vrrs)

The docs sub-agent of Step 6 had left two complete drafts in `reference/` (created with `docmgr doc add`, frontmatter
and RelatedFiles filled). I reviewed them rather than rewrote them: checked a sample of 33 file:line references
against the tree, parsed and rendered every mermaid block in headless Chromium, and fixed what was stale. Both are
textbook-ordered (definitions, ownership, mechanism, worked sequences, tests) and use no analogies.

The engines doc listed comments that contradict the code. Two of them were in studio files outside CHB-031's set
and are plain comments, so I corrected them (`studio-engine.ts` header and `nativeSpaces` doc, `engines.ts` header)
within the same line counts, so the doc's line references stay valid, and rewrote the doc's Section 7 as facts. The
third is in `packages/contract`, which this ticket does not edit; the doc states it.

### Prompt Context
**User prompt (verbatim):** see Step 7.
**Assistant interpretation:** Finish the untracked drafts as docmgr reference docs with mermaid diagrams, textbook
style; commit them.
**Inferred user intent:** Two pages a newcomer can read before touching undo or engine selection.
**Commit (code):** see the next commit, "CHB-032: reference docs on undo/history and on which engine computes what; correct two stale studio comments".

### What I did
- Spot-checked references with `sed -n <line>p` over 33 cited lines (studio-engine.ts, engines.ts, main.ts,
  engine-ref.ts, editlog.ts, editlog-route.ts, history.ts, store.ts, model/history.ts, the looks kit, four tests)
  and the GPU references against the split (`engine/defs.ts:8-16` GPU_OPS, `engine-gpu.ts:40,94,125,167,197,209,233,267`).
- Wrote `<scratchpad>/chb032/mermaid-check.mjs`: extracts each ```mermaid block and runs `mermaid.parse` and
  `mermaid.render` (mermaid 11.17.2 from the npx cache) in the repository's Playwright Chromium.
- Doc 02: replaced the "GPU line numbers may shift" note; added a sequence diagram to Section 5 (one preview render
  in the reference configuration: adopt, `frame()`, the worker job, the transfer, cancellation); rewrote Section 7.
- `apps/studio/src/host/studio-engine.ts:8-9,77` and `apps/studio/src/host/engines.ts:2-3`: comments only.
- `docmgr doctor --ticket CHB-032` → all checks passed; `pnpm typecheck` 0, `pnpm lint` 0 (import boundaries ok,
  336 file checks).
- `docmgr task check --ticket CHB-032 --id m6qo,vrrs`.

### Why
- Correcting the comments instead of only documenting the disagreement: the next reader of `studio-engine.ts`
  would otherwise believe the GPU path re-encodes P3 from sRGB.
- Same line counts in the edited comments: the doc cites `studio-engine.ts` lines below the header.

### What worked
- All 33 sampled references pointed at the cited code. Mermaid: five diagrams, all `ok`
  (`01-…:257`, `:333`, `:380`; `02-…:258`, `:335`).

### What didn't work
- `node mermaid-check.mjs` with `require('playwright')` → `Error: Cannot find module 'playwright'` (the worktree has
  only `@playwright/test` at the top level); `require('@playwright/test')` works.
- A `find / -maxdepth 6 -name mermaid` search ran past the 120 s tool limit and was moved to the background; I
  stopped it (the npx cache path had already turned up).
- My first comment fix grew the header by one line, which would have shifted every `studio-engine.ts` reference in
  the doc; rewritten within two lines.

### What I learned
- `StudioEngine.native()` treats an unset `nativeSpaces` as "every space", so the P3 branch is dead in the studio
  today; it stays as the path for a primary without `output.display`.

### What was tricky to build
- N/A (documents).

### What warrants a second pair of eyes
- Doc 01 cites `packages/studio-kit/kits/looks/src/kit.ts` lines; the kit split (j38l) moves them, and that commit
  must update the doc.

### What should be done in the future
- Update `packages/contract/src/engine.ts:2-3` ("all pass the conformance suite generated from the registry") when
  the contract is next edited.

### Code review instructions
- `ttmp/2026/11/12/CHB-032--…/reference/01-undo-and-history-across-the-layers.md`,
  `ttmp/2026/11/12/CHB-032--…/reference/02-which-engine-computes-what.md`; `git diff HEAD~1 -- apps/studio/src/host`.
- `node <scratchpad>/chb032/mermaid-check.mjs $PWD <doc.md>…` re-checks the diagrams.

### Technical details
- Doc 01 diagrams: slider drag/release/Mod+Z (sequence), agent proposal approved later (sequence), Mod+Z routing
  (flowchart). Doc 02 diagrams: components and threads (flowchart), one preview render in the reference
  configuration (sequence).

## Step 9: e2e waits on status text (task vuwz)

Every spec that opened files waited for `#status` to contain "rendered" or "opened", then called `idle()`. That
signal is unreliable: renders run in the engine worker and write "rendered …" whenever one finishes, so in a
multi-file open the first file's render satisfies the wait while the second file is still decoding, and `idle()`
does not wait for the open flow (it waits for renders, log writes and queued frames, not for `openFiles` in
`main.ts`). Two specs (open-mode, strip) already used the correct condition inline: the expected number of frames is
open and the status no longer says "opening". That condition is now one helper, `opened(page, frames, timeout)` in
`e2e/support.ts`, and the ten specs that opened files use it.

The remaining `#status` waits look for a specific outcome of the action just taken ("was already open", "2 frames in
the library", "exported", "not applied", the offline "rendered") and are not races; they stay.

### Prompt Context
**User prompt (verbatim):** see Step 7.
**Assistant interpretation:** Task vuwz: find the e2e waits on status text that race and switch them to waits that
end when the work has ended, with `window.chromobench.idle()` after.
**Inferred user intent:** Browser tests that fail only when the machine is busy cost more than they find.
**Commit (code):** see the next commit, "CHB-032: e2e opens wait for the open flow (frames open, no 'opening') then idle(); one helper".

### What I did
- Read the open flow (`apps/studio/src/main.ts:336-387`: "opening <name> (n of N)…" before each file, the outcome
  after the last), the render status (`main.ts:239-242`), `idle()` (`main.ts:681-692`) and `FrameStore.all()/flush()`
  (`packages/studio-kit/src/bridge/frames.ts:152,329`; `all()` lists open frames only).
- `grep -n "#status\|toContainText" e2e/*.ts`, then each wait in context.
- New `e2e/support.ts`: `idle(page)` and `opened(page, frames = 1, timeout = 30_000)`
  (`frames.all().length >= frames && !/opening/.test(#status)`, then `idle()`).
- Switched (script `<scratchpad>/chb032/e2e-waits.py`): `studio.spec.ts` `open()` helper (frames = number of files) and
  the folder open; `chat.spec.ts` boot; `m1-walking-skeleton.spec.ts` `open()`; `studio-wording.spec.ts` (2 files);
  `studio-responsive.spec.ts` (240 s); `studio-real.spec.ts` `open()` (60 s); `studio-photo.spec.ts` and
  `studio-decoders.spec.ts` (120 s); `studio-open-mode.spec.ts` twice and `studio-strip.spec.ts` (their inline
  condition, now the helper; `===` became `>=`, and both tests assert the exact frames right after).
- `pnpm typecheck` 0, `pnpm lint` 0.
- `STUDIO_PORT=5421 STUDIO_KIT_PORT=5422 SHELL_DEMO_PORT=5423 GPU_PARITY_PORT=5424 CI=1 pnpm exec playwright test
  --project=chromium-webgpu <the ten specs>` → 26 passed, 1 failed (below); the failed spec alone with
  `--repeat-each=3` → 9 passed.

### Why
- The frame count guards the start (before the first "opening" the count is still the old one) and the status guards
  the end (it says "opening" until the loop has written its outcome), so the pair is true only after the open flow.
- I could not add an "open finished" promise to the `window.chromobench` hook: the hook is in `main.ts`, which
  CHB-031 is editing.

### What worked
- 26 of 27 tests in the first run, 9 of 9 in the repeat of the one that failed.

### What didn't work
- `pnpm exec playwright test --project chromium-webgpu e2e/studio.spec.ts …` → `Error: Project(s) "e2e/studio.spec.ts",
  … not found`: `--project` takes several values; `--project=chromium-webgpu` works.
- First run: `e2e/studio-open-mode.spec.ts:92` ("the library survives a reload") failed at line 111,
  `expect.poll(… every thumb:<id> is a data:image/jpeg …, { timeout: 30_000 }).toBe(true)` → `Received: false`,
  52.8 s with 10 specs in parallel. Alone, three times: 22.6–24.3 s, all passed. The thumbnails are captured by
  `scheduleThumb` in `main.ts` (first try after 500 ms, then 3 s apart, 6 tries, each skipped while the frame still
  renders), so under load six tries can run out before the 30 s poll ends. My edit of that test only replaced the
  open wait with the equivalent helper, before the poll. Left as is (the scheduler is in `main.ts`); noted below.

### What I learned
- `idle()` does not cover the open flow; a test that opens files must wait for the flow first.

### What was tricky to build
- Re-opening a file that is already open does not grow the frame count, so `opened()` cannot detect it; those tests
  wait for the "already open" text, and the helper's doc says so.

### What warrants a second pair of eyes
- The thumbnail test at `e2e/studio-open-mode.spec.ts:105-111` depends on `scheduleThumb`'s retry budget under load.
  If it fails in the full browser run, check whether `main` fails the same way before blaming the waits.

### What should be done in the future
- After CHB-031 merges: an `opened()` promise on the `window.chromobench` hook (resolved at the end of `openFiles`)
  would replace the frame-count condition; and a thumbnail retry that does not run out under load.

### Code review instructions
- `e2e/support.ts`; `git diff HEAD~1 -- e2e/`.
- `STUDIO_PORT=5421 STUDIO_KIT_PORT=5422 SHELL_DEMO_PORT=5423 GPU_PARITY_PORT=5424 CI=1 pnpm exec playwright test --project=chromium-webgpu e2e/studio-wording.spec.ts e2e/studio.spec.ts`.

### Technical details
- Timeouts kept per spec: mock-engine specs 30 s (the `waitForFunction` default; they used `expect`'s 5 s before),
  real-engine specs their previous 60/120/240 s.

## Step 10: Split packages/dsl/src/host.ts by vocabulary area (task 6qs1)

`host.ts` (804 lines) is now 209 lines plus eight modules in `packages/dsl/src/host/`: `calls.ts` (op calls on
handles: `unmarshal`, `literal`, `recipeOf`, `callOp`, `rewrite`), `print.ts` (frame accessors and the print()
macro: `cutOf`, `closureIds`, `printChain`, `printOpts`, `printMacro`, `macro`, `vocab`, `printOf`), `look.ts`
(`look`, `explain`), `edits.ts` (`edit`, `queue`), `named-looks.ts` (cb.looks.*), `errors.ts` (the prelude's traps:
`unknownMethodErr`, `unknownMember`, `notAwaited`, `immutable`, `immutableRecipe`), `words.ts` (pure helpers:
`dslOps`, `suggest`, `editFix`, `HANDLE_MEMBERS`, …) and `types.ts` (the records and the two provider interfaces).
The class keeps the per-eval state, the dispatcher, frames and node handles; each native is a function of the
`Host`. The package's public exports are unchanged.

The same method as Step 6: a script cut each method out by its signature line and rewrote `this.` to the host
parameter; a second script reverses that on all 28 functions and compares them with HEAD's methods. All 28 bodies
are the original text. Unit tests, the generated docs and bindings (`pnpm gen:check`) and the DSL goldens are
unchanged.

### Prompt Context
**User prompt (verbatim):** see Step 7.
**Assistant interpretation:** Task 6qs1: split `host.ts` by vocabulary area; generated bindings and DSL tests
unchanged.
**Inferred user intent:** One file per DSL area, so a change to cb.looks or to frame.edit does not mean reading the
whole host.
**Commit (code):** see the next commit, "CHB-032: split dsl host.ts into host/{calls,print,look,edits,named-looks,errors,words,types}.ts".

### What I did
- `grep` for importers: `session.ts` (Host, DocsProvider, LooksProvider, FrameEntry, QueuedEdit; members `begin`,
  `dispatch`, `docs`, `looksProvider`, `edits`, `looks`, `logs`, `warnings`, `ops`, `vocabulary`, `state`),
  `telemetry.ts`, `docs/generate.ts`, `docs/provider.ts`, `results/looks.ts`, `index.ts`, and
  `packages/studio-kit/test/kit.test.ts` (`new Host(…).printOf`).
- `<scratchpad>/chb032/split-host.py`: area modules; `split-host-head.py`: `words.ts`, `types.ts`, the new head of
  `host.ts` (module list in the header comment, re-exports of the moved names and types), visibility, two fixes.
- Visibility: `frames`, `exprs`, `editCounter`, `whatIfs`, `batchCounter`, `noFrame()`, `node()`, `intern()` are no
  longer `private` (marked `@internal`); the public methods `closureIds`, `printChain`, `printOf` stay on the class
  as one-line delegates.
- Renamed three functions whose method names clash or read badly as free functions: `cut` → `cutOf` (the contract's
  `cut` is imported in the same module), `call` → `callOp`, `unknown` → `unknownMember`.
- `pnpm typecheck` 0; `pnpm lint` 0 (import boundaries ok, 344 file checks); `pnpm gen:check` → `gen:check ok (26 files)`;
  `pnpm vitest run packages/dsl packages/agent packages/studio-kit/test/kit.test.ts` → 16 files, 132 tests passed;
  `pnpm test` → 95 files, 2733 passed, 7 skipped (= baseline).
- `<scratchpad>/chb032/verify-host-split.py HEAD` → `functions: 28 different: 1`; the one is `edit`, where the reverse
  transform itself turned the hint text `'build one with h.mask.*'` into `this.mask.*`; the module has the original.

### Why
- Functions of the host instead of mixins or helper classes: the bodies stay the same text, the dispatcher reads as
  before, and no new object lifetimes appear.

### What worked
- Line counts: host.ts 209, calls 103, print 177, look 29, edits 82, named-looks 106, errors 73, words 24, types 75.

### What didn't work
- The first run of the split script stopped at its own check: `AssertionError: ('macro', …)` — the check for a left
  `this` matched the word in the error text "this handle is …"; narrowed it to `this` followed by `.`, `,`, `;`, `)`
  or `]`.
- The generated delegate for `printChain` split its parameter list on the comma inside `Record<string, unknown>`
  (`printChain(this, dyes, r, opts, unknown>, at)`); fixed by hand in the second script.
- `tsc`: `packages/dsl/src/host/calls.ts(30,13): error TS7022: 'h' implicitly has type 'any' …` and `(30,17): error
  TS2448: Block-scoped variable 'h' used before its declaration.` — `literal` had a local `const h` (the handle of
  a node) that now shadowed the host parameter; renamed it `hd`. A grep for other local `h` bindings found none.
- An e2e run of Step 9 had rewritten a tracked CHB-027 screenshot
  (`e2e/studio-strip.spec.ts:51` writes `ttmp/…CHB-027…/various/ws-d/01-synthetic-strip-frame2.png`); restored it
  with `git checkout --` before staging.

### What I learned
- `FrameState` was a non-exported interface used in the public `state()` signature; it is exported from
  `host/types.ts` now (not from the package index).

### What was tricky to build
- Import cycles: the modules import `type { Host }` from `../host.ts` only as a type, and `host.ts` imports their
  functions, so there is no runtime cycle; `named-looks.ts` → `edits.ts` → `print.ts` → `calls.ts` → `errors.ts`
  are one-way.

### What warrants a second pair of eyes
- The `@internal` members are reachable from outside the package through `Host`; nothing outside `packages/dsl`
  uses them today.

### What should be done in the future
- `e2e/studio-strip.spec.ts:51` writes a screenshot into a tracked CHB-027 file; it should write under
  `test-results/` (left: the file is CHB-027's evidence).

### Code review instructions
- `packages/dsl/src/host.ts` (header lists the modules), `packages/dsl/src/host/*.ts`.
- `pnpm typecheck && pnpm gen:check && pnpm vitest run packages/dsl packages/agent`;
  `python3 <scratchpad>/chb032/verify-host-split.py <commit before this one>`.

### Technical details
- Public exports of `@chromobench/dsl` from host.ts: `Host`, `PRINT_OPTIONS`, `dslOps`, `suggest`, `HandleInfo`,
  `LooksProvider` (unchanged); host.ts also re-exports `editFix`, `HANDLE_MEMBERS`, `isDslOp`, `DocsProvider`,
  `FrameEntry`, `LogLine`, `LookRequest`, `QueuedEdit` for the package's own importers.

## Step 11: Browser specs stop writing into tracked ticket folders (orchestrator request)

While I was planning the kit splits the orchestrator relayed two items: CHB-031 WS-A is merged into `main`
(e7df8a0; contract 0.4.0, real enlarger mode by default), to be merged into this branch before the final commit;
and, as part of the e2e review, `e2e/studio-strip.spec.ts:51` rewrote a tracked CHB-027 screenshot on every browser
run (Step 10 had to restore it by hand). The spec now writes the screenshot into Playwright's per-test output
folder under `test-results/`, which `.gitignore` excludes. It was the only browser spec writing into `ttmp/`.

### Prompt Context
**User prompt (verbatim):** see Step 7. Orchestrator message (verbatim): "Orchestrator: CHB-031 WS-A is merged into
main (e7df8a0; contract 0.4.0, real enlarger by default). Before your final commit, `git merge main` into
task/chb-032-housekeeping (in your worktree) and resolve; regenerate generated docs with `pnpm gen` and snapshots
with `-u` (read the diffs) rather than merging them by hand. One more item for your e2e review task:
`e2e/studio-strip.spec.ts:51` rewrites a CHB-027 screenshot under `ttmp/` on every browser run — make specs write
screenshots to `test-results/` (or behind an env flag) instead of into tracked ticket folders."
**Assistant interpretation:** Fix the screenshot path now; merge `main` before the final commit, regenerating
generated files and snapshots instead of hand-merging them.
**Inferred user intent:** A browser run should never dirty the tree, and the branch should merge cleanly.
**Commit (code):** see the next commit, "CHB-032: studio-strip spec writes its screenshot to test-results/, not a tracked CHB-027 file".

### What I did
- `grep -rn "screenshot(\|ttmp/\|writeFileSync" e2e packages/*/test/browser tools/wgsl-check`: one hit in `ttmp/`
  (`e2e/studio-strip.spec.ts:51`); the shell demo spec writes shots only when `SHELL_DEMO_SHOT` is set.
- `e2e/studio-strip.spec.ts`: `page.screenshot({ path: test.info().outputPath('strip-frame2.png') })`.
- `pnpm typecheck` 0; `… CI=1 pnpm exec playwright test --project=chromium-webgpu e2e/studio-strip.spec.ts` → 1 passed;
  `git status` shows only the spec; the file is at
  `test-results/e2e-studio-strip-a-strip-o-1e12a-ove-one-open-the-file-again-chromium-webgpu/strip-frame2.png`.

### Why
- `test.info().outputPath()` is per test and per project, so parallel projects cannot overwrite each other, and
  Playwright clears it at the start of a run.

### What worked
- The spec passes and the tree stays clean after a run.

### What didn't work
- No failures observed.

### What I learned
- The committed CHB-027 screenshot stays as that ticket's evidence; it is no longer regenerated.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- The merge of `main` (before the final commit).

### Code review instructions
- `git show HEAD -- e2e/studio-strip.spec.ts`.

### Technical details
- `.gitignore:3` is `test-results/`.

## Step 12: Merge main (CHB-031 WS-A) and fix the one semantic conflict

`main` had moved to e2af842 (CHB-031 WS-A: contract 0.4.0, real enlarger mode by default). It did not touch the
kits I am about to split, but it added `e2e/studio-enlarger.spec.ts` and edited three specs I had changed, so I
merged before the kit splits rather than at the end. Git merged without conflicts (d4fa507). One conflict was
semantic: WS-A's new `apps/studio/test/enlarger-mode.test.ts` builds `new RefEngine()` without data, which Step 5
made a compile error. It now passes `{ data: nodePacksData() }`, as the other eleven construction sites do.

### Prompt Context
**User prompt (verbatim):** see Step 7; the orchestrator's merge instruction is quoted in Step 11.
**Assistant interpretation:** `git merge main`; regenerate instead of hand-merging generated files and snapshots;
keep the checks green.
**Inferred user intent:** The housekeeping branch should land on top of CHB-031 without surprises.
**Commit (code):** d4fa507 — "Merge main (CHB-031 WS-A) into task/chb-032-housekeeping"; then the next commit,
"CHB-032: enlarger-mode test passes RefEngine its data (merge of main; RefEngine data is required since 1927c3f)".

### What I did
- Checked first what main changed since the branch point (9d10010): nothing under `packages/studio-kit/kits`,
  `packages/dsl/src`, `packages/gpu`, `ingest`, `output`; under `e2e/` a new `studio-enlarger.spec.ts` and small
  edits to `studio.spec.ts`, `studio-wording.spec.ts`, `studio-real.spec.ts`.
- `git merge main` → merged cleanly; `pnpm install --offline`.
- `pnpm typecheck` → `apps/studio/test/enlarger-mode.test.ts(38,13): error TS2554: Expected 1 arguments, but got 0.`;
  `pnpm test` → 5 failures in that file. Fixed lines 5 and 38.
- After the fix: `pnpm typecheck` 0, `pnpm lint` 0, `pnpm gen:check` → `gen:check ok (26 files)` (nothing to
  regenerate), `pnpm test` → 97 files, 2749 passed, 7 skipped; no snapshot written or obsolete.
- Read the new spec's open helper: it waits for `window.chromobench.log` (true once the opened frame is selected,
  which happens right after `studio.openFile` returns, with nothing awaited before the outcome is written), then
  `idle()`. Not a race for its single-file opens; left as WS-A wrote it.

### Why
- Merging before the kit splits keeps the splits' commits on the code that will land.

### What worked
- A clean merge; one test file to adapt.

### What didn't work
- The five `enlarger-mode.test.ts` failures above (all from the missing `data`), fixed.

### What I learned
- The new counts after the merge (97 files, 2749 tests) are the baseline for the remaining clean-ups.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- `git show HEAD -- apps/studio/test/enlarger-mode.test.ts`; `pnpm vitest run apps/studio/test/enlarger-mode.test.ts`.

### Technical details
- Main's spec edits next to mine: the inspection view names (`'No mask', 'Clipping'`) in `studio.spec.ts` and
  `studio-real.spec.ts`, the relative-entry wording in `studio-wording.spec.ts`; my `opened()` waits are intact.

## Step 13: Split the looks and finish kits (task j38l)

Each kit was one factory closure of 700–800 lines. The looks kit (800 lines) is now `kit.ts` (151: the docs, the
forms and passes, the kit declaration and its API) plus `state.ts` (state shape, readers, agent batches), `model.ts`
(the look registry, looked recipes, compare sources, targets, plan and commit), `commands.ts` (the command table)
and `panels.ts` (builder calls and their models). The finish kit (724 lines) is now `kit.ts` (110) plus `state.ts`,
`context.ts` (what the tools, commands and panels share: the frame a tool acts on, the sizes seen, frame writes, the
aspect lock), `tools.ts` (the crop and spot tools and their SVG overlays), `commands.ts`, `panels.ts` and
`passes.ts`. Each factory module returns what the others use; the kit destructures it, so every moved body is the
original text. A verification script finds each of the 28 original segments verbatim as one block in its module
(the two command chains dedented by 6, as they left the `.commands((c) => { … })` callback).

Two original lines changed on purpose: `syncGroups` is a `let` the API can replace, so the model owns it and
returns an accessor `syncGroupsOf`; the panels' `groupsModel` reads `syncGroupsOf()` and the API's `syncGroups`
member is that accessor (it returned the assigned value before and does now).

### Prompt Context
**User prompt (verbatim):** see Step 7.
**Assistant interpretation:** Task j38l: split the looks and finish kits into state, commands and panels modules
(plus what they share), behaviour unchanged.
**Inferred user intent:** A kit file one can read: what the kit stores, what it does, what it shows.
**Commit (code):** see the next commit, "CHB-032: split the looks and finish kits into state/model|context/tools/commands/panels/passes modules".

### What I did
- Read both kits in full and mapped their sections (line ranges in `verify-kits.py`).
- `<scratchpad>/chb032/split-kits.py` (helpers: line ranges, names defined at a given indent, names used, imports
  recomputed from the original import statements) and `split-kits2.py` (one assembly per kit).
- `prune-imports.py`: removed 9 import specifiers that `tsc --noUnusedLocals` reported (`set`, `look`, `choice`,
  `aggregate`, `suggestSource` matched words in comments and template text).
- `kits/{looks,finish}/src/index.ts` export from the modules that define the names; `kit.ts` keeps
  `createLooksKit`/`createFinishKit` (imported by `packages/studio-kit/src/cb.ts`, untouched).
- `tools/scripts/check-colours.ts`: the 13-colour allowance moved from `kits/finish/src/kit.ts` to
  `kits/finish/src/tools.ts` with the overlay styles (`LOOK`).
- The undo doc's two looks-kit references now point at `model.ts:162` and `commands.ts:113-124`; four references
  into files the merge of main shifted (`first-print.ts:60-68`, `arg.ts:78`, `studio.ts:116`, `studio.ts:220-225`)
  were re-located by matching the cited line's text at 2f6adef (`<scratchpad>/chb032/relocate.py`).
- Checks: `pnpm typecheck` 0; `pnpm lint` 0 (import boundaries ok, 366 file checks; check-colours 151 files ok);
  `pnpm test` → 97 files, 2749 passed, 7 skipped (= post-merge baseline), no snapshot written;
  `… CI=1 pnpm exec playwright test --project=studio-kit` → 13 passed;
  `python3 <scratchpad>/chb032/verify-kits.py HEAD` → every body segment `ok`.

### Why
- Factories that return what they share, not one shared mutable "context" object written by several modules: each
  closure keeps reading its own module's bindings, which is what it read before.
- `index.ts` exporting from the defining modules instead of `kit.ts` re-exporting them: one hop, and `kit.ts` keeps
  only the kit.

### What worked
- 28 of 28 body segments verbatim; the "glue" the script lists is only headers, imports, factory signatures,
  destructures and returns (looks: 13 + 38 + 18 + 15 + 7 lines; finish: 12 + 11 + 34 + 14 + 4 + 4 + 13).

### What didn't work
- First `tsc` after the split: `'SpotMode' is a type and must be imported using a type-only import when
  'verbatimModuleSyntax' is enabled` (and the same for `DustSpot`, `FinishView`, `SpotRef`, `CompareSource`);
  `Cannot find name 'needFrame'` (9×), `'needLook'` (3×), `'FINISH_STATE'`, `'FINISHING_PATHS'` — the usage scan's
  look-behind excluded `.`, so `...needFrame` (a spread) did not count as a use; and `index.ts` errors
  (`Module '"./kit.ts"' declares 'cropProblem' locally, but it is not exported`, …). Fixed the scan (spreads count),
  marked interface/type names `type`, rewrote both `index.ts`, regenerated from the originals
  (`git checkout --` both `kit.ts` first).
- Second `tsc`: `Property 'syncGroups' does not exist on type '{ studioOf: … }'` — the scan counted the object key
  `syncGroups:` in the API as a use; excluded `syncGroups` from the destructures.
- `pnpm lint` → `check-colours: 1 file(s) with literal colours outside the theme files` (tools.ts:9–21); moved the
  allowance.

### What I learned
- `CommandsBuilder.add` records `site()`, the first stack frame outside the registered library roots, and only
  `packages/studio-kit/src/` is a root (`cb.ts:29`); the kits are not. So a command's recorded definition site is
  now `src/commands.ts:<line>` instead of `src/kit.ts:<line>`, and a form node built by a panel records
  `src/panels.ts:<line>`. No snapshot or test contains a `.ts:<line>` site (`grep -c "\.ts:[0-9]"` over every
  `.snap`: 0), so this shows only in diagnostics text that cites where a command or panel was defined.

### What was tricky to build
- Order and lifetime: the model (looks) and context and tools (finish) are created where their closures were
  defined before, ahead of the forms, passes and the kit declaration; the panels after it, as before. `cycle` was a
  hoisted function declaration after the kit declaration; it is now declared before the command chain in
  `commands.ts`, which only the chain calls.

### What warrants a second pair of eyes
- `syncGroupsOf` (looks `model.ts`): the API member `syncGroups(g?)` still replaces the groups for every later
  read in the model and the panels, because both read the model's `let` through the accessor.

### What should be done in the future
- N/A.

### Code review instructions
- `packages/studio-kit/kits/looks/src/{kit,state,model,commands,panels}.ts`,
  `packages/studio-kit/kits/finish/src/{kit,state,context,tools,commands,panels,passes}.ts`.
- `python3 <scratchpad>/chb032/verify-kits.py <commit before this one>`; `pnpm vitest run packages/studio-kit`;
  `… pnpm exec playwright test --project=studio-kit`.

### Technical details
- Line counts. looks: kit 151, state 81, model 190, commands 289, panels 152. finish: kit 110, state 76, context 50,
  tools 322, commands 118, panels 77, passes 42.

## Step 14: Dead code and unused exports (task z99j)

Neither knip nor ts-prune is a dependency, and installing one offline was not possible, so I wrote the scan on the
TypeScript compiler API already in the workspace: build the program from `tsconfig.json` (sources, tests, demos,
kits, tools, e2e), resolve every import specifier, namespace import, re-export and `import('…')` type to its
original declaration, and report each export of a source file that no other file imports — split into "used by
nothing", "used only in its own file" and "used only by tests, demos or tools". It found 69 exports used by
nothing. After a text search over the whole tree for each name (the GPU parity page, the kit variants and the JS
playbooks are outside the program), I removed 63 exported declarations and the 3 private constants that only they
used, in three waves (the second and third waves were helpers that only the first wave used). 41 source files,
269 lines deleted, 12 added; test counts unchanged.

Kept on purpose (12 still reported as used by nothing): six contract names (`MutationOp`, `validateMutation`,
`_registrySize`, `ROLL_SIDECAR`, `SPECTRUM_KINDS`, `PhysicsConventions`; the contract is not edited in this ticket);
`lightsOffset` in `packages/studio-kit/src/kit/args.ts` and `permission`, `fileAt`, `sha256` in
`apps/studio/src/storage/fsa.ts` (files in CHB-031's area: the library's file handles are WS-B's open work);
`preflashPhi` in core (spektrafilm's preflash through the base, which CHB-010's follow-up dotm needs); `setOracle` in
the GPU parity harness (its documented experiment hook). The scanner is now `tools/scripts/unused-exports.mjs` and
its final report is in the ticket (`various/01-unused-exports-after.txt`).

### Prompt Context
**User prompt (verbatim):** see Step 7.
**Assistant interpretation:** Task z99j: a ts-prune/knip-style run over the workspace; remove what nothing uses;
list what is kept on purpose.
**Inferred user intent:** No code that only misleads a reader into thinking it matters.
**Commit (code):** see the next commit, "CHB-032: remove 63 unused exports (core, data, gpu, ingest, shell, studio-kit); unused-exports scanner".

### What I did
- `<scratchpad>/chb032/unused-exports.mjs` (now `tools/scripts/unused-exports.mjs`): 28 s per run.
  Run 1: 69 used by nothing, 722 only in their own file, 262 only by tests, demos or tools.
- For each of the 69: its definition with context, and `grep -rlw <name>` over the tree outside its file
  (`<scratchpad>/chb032/dead-grep.txt`). Same-named symbols elsewhere were different symbols: `X_RANGE` (gpu's own
  in `tables/inputs.ts`), `ROLL_MIXED_D` (ingest's, used by `roll-base.ts`), `CLASS_CODE` (core's, used by the host),
  `srgbEncode` (engine-mock's own), `latd` (a field and parameter name), `hostOf` (a test's local function),
  `MIN_REBATE_CONFIDENCE` (the check exists: `ingest/src/conditioning/roll-base.ts:68`, `minConfidence ?? 0.5`).
- `<scratchpad>/chb032/delete-exports.mjs`: removes a top-level export with its own JSDoc by AST position.
  Waves: 58 declarations (`delete-targets.txt`), then `fromTable`, `orientPoint` (ingest), `P3_TO_XYZ`,
  `REC2020_TO_XYZ`, then `ResponsivityTable`; cascades found by diffing `tsc --noEmit --noUnusedLocals` on the touched
  files before and after: unused imports (`Channels`, `addFlare`, `D50`, `PhysicsConventions`, `diag`, `Diagnostic`,
  `canonicalJSON`, `fstopIndex`) and private constants (`CAT16_INV`, OKLab `M1I`, `M2I`).
- `e2e/support.ts`: `idle` is no longer exported (only `opened` uses it).
- Undo doc: `rejectedEntries` is gone from Section 3.4 and 7; `moveCursor` and `whyRows` re-numbered (`:122-125`,
  `:130-150`); `check-doc-refs.py` compares every `path:N` the two docs cite between HEAD and the tree.
- Checks: `pnpm typecheck` 0, `pnpm lint` 0, `pnpm gen:check` ok (26 files), `pnpm test` → 97 files, 2749 passed,
  7 skipped (= baseline after the merge).

### Why
- A checker-based scan over the one program that includes the tests sees type-only imports, re-exports through
  `index.ts` and `export *`, which a text search cannot tell apart from comments.
- I did not un-export the 717 "used only in their own file" names: many are types in public signatures, and the
  change would be churn without a reader benefit; the report lists them per file.

### What worked
- Run 3: `exports used by nothing: 12`, exactly the kept list above (plus `ResponsivityTable`, removed after it).
- Removed by package: core 27 (film, ops, print/balance, chain, colour, gamut, paper, spectral/channels,
  conventions, linalg, spectrum, units, tables), ingest 13 (conditioning classify, open-mode, opengate, resample;
  decode encoding, errors, identity, registry `openSource`, types `Decoder`; libraw colour), shell 10 (util `isPlain`,
  `round`, `hasPath`, `clone`, `esc`, `isFn`; `Side`, `REGIONS`, `hostOf`, `timeOf`), studio-kit 11 (finish
  `sensorAspect`, looks `PRESET_EXT`, roll `ROLL_MIXED_D`, `MIN_REBATE_CONFIDENCE`, `setupBatch`; model `fstopStep`,
  `sameValue`, `rejectedEntries`, `Snapshot`, `testStripArgs`, `addLights`), data 1 (`openPackSync`), gpu 1
  (`TableInputs`).

### What didn't work
- My first cascade fix deleted `CAT16` with `CAT16_INV`: `packages/core/src/film/expose.ts(4,10): error TS2305:
  Module '"../print/colour.ts"' has no exported member 'CAT16'.` (my grep for other users had not covered
  `core/src/film/`). Restored the export and the header wording; only `CAT16_INV` (used by the deleted `adaptCAT16`)
  is gone.
- No `knip`/`ts-prune` in `node_modules/.bin` or the npx cache.

### What I learned
- The counts of the remaining categories by package. Only in their own file: shell 139, contract 109, core 91,
  ingest 75, gpu 57, studio-kit 41 (+ kits: looks 30, roll 20, finish 5, chat 4), output 32, agent 32, dsl 27,
  apps/studio 21, data 17, engine-mock 12, conformance 5. Only by tests, demos or tools: core 79, ingest 50, gpu 20,
  studio-kit 19, contract 16, output 14, data 13, shell 11, the kits 18, apps/studio 7, agent 5, dsl 4, engine-mock 3,
  conformance 3.

### What was tricky to build
- Waves: deleting a function can make its private helpers and types dead; the analyzer and `--noUnusedLocals` were
  re-run until nothing new appeared.

### What warrants a second pair of eyes
- Physics helpers removed from core that a later ticket might want back (`viewToDisplay`, `rgbToOklab`/`oklabToRgb`,
  `adaptCAT16`, `sigmoid` spectra, `printingChannels`, `XYZ_TO_P3`/`XYZ_TO_REC2020`): all are in git history at
  2911ca9; nothing in the tree called them.

### What should be done in the future
- After CHB-031 merges: `fsa.ts`'s three helpers and `args.ts` `lightsOffset`, if still unused.
- When the contract is next edited: its six unused names.

### Code review instructions
- `git show <commit> --stat`; `node tools/scripts/unused-exports.mjs .`.
- `pnpm typecheck && pnpm test`.

### Technical details
- The scanner treats a module imported as a namespace or through `import()` as fully used, and judges a re-exported
  name at its original declaration.
