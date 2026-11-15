---
Title: Diary
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
LastUpdated: 2026-11-14T20:56:48.483448-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

The main agent's record of implementing CHB-035 design 01 v2 (the unified editing model) in chromobench: the plan,
each wave of phase agents, every merge into the integration branch, the checks, and the decisions made along the way.
Phase agents keep their own diaries in this ticket (`diary/NN-phase-*.md`).

## Step 1: Ticket, integration branch, plan, baseline

The owner asked to implement the whole v2 design with subagents, each keeping a diary, committing at intervals, and
to bring in Editor lab's functionality. The work is ~80 k lines across 12 packages and the app, so it runs as waves
of phase agents on their own branches, merged by the main agent into one integration branch.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all."

**Assistant interpretation:** Implement design 01 v2 phases 0–9 (goldens, builder core, contract 1.0 with stage
laws, GPU, one history, UI DSL and stack kit, agent workbench, links, Editor lab's op set, integration), with
subagents and diaries, committing as phases land.

**Inferred user intent:** The studio rebuilt on one coherent core, with the full layer toolset, ready for the
photographer.

**Commit (code):** (this step's commit) — ticket, plan, diary

### What I did
- Integration branch `task/chb-037-unified-model` from `origin/main` (aaea9af, PR #2 merged), CHB-035 merged in
  (b3445d3: the v2 design is on the branch); worktree `<scratchpad>/chb037`, so the pattern-experiment batch running
  from the main checkout is untouched.
- Baseline: `pnpm install --frozen-lockfile --prefer-offline`; typecheck, lint, gen:check rc=0; vitest 105 files,
  2797 passed, 19 skipped.
- Read the boundary rules (`tools/scripts/check-boundaries.ts`): the contract imports only `@noble/hashes`; the shell
  imports nothing. A shared builder core therefore needs one new leaf package, `packages/values`, that both may import.
- Ticket CHB-037; `design-doc/01-implementation-plan-and-working-rules.md`: working rules (diaries, commits, checks,
  headless browsers, ports per phase, the GPU lock, privacy, scope), branch protocol, phases P0–P9 with ownership
  and dependencies, and the wave 1 specs (P0 goldens, P1 builder core).

### Why
- Waves keep agents from editing the same files; one integration branch keeps one place green.

### What worked
- The CHB-035 merge was clean; baseline green.

### What didn't work
- N/A

### What I learned
- Package boundaries are enforced by a script; the design's "one builder core" needs a boundary change, recorded in
  the plan.

### What was tricky to build
- Ordering: the UI rules (P5a) need the value model (P1), and everything that consumes recipes breaks when the
  contract cuts over (P2) until P4–P6 land. The plan accepts a red integration branch between waves 2 and 4 and asks
  each phase to keep its own packages green.

### What warrants a second pair of eyes
- The phase table in the plan (§4): ownership boundaries between P2, P4 and P5b around the history.

### What should be done in the future
- Launch wave 1 (P0, P1); then P5a; then P2.

### Code review instructions
- `design-doc/01-implementation-plan-and-working-rules.md`.

### Technical details
- Worktrees: `<scratchpad>/chb037` (integration), `<scratchpad>/chb037-p<id>` (phases).

## Step 2: P0 merged — 58 golden pictures, bit-exact

The P0 agent rendered today's pipeline on the reference engine for 58 synthetic cases at the `print` and `display`
cuts; the check reproduces all of them exactly. Merged into the integration branch; the plan gained four amendments
from its report.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Merge the first finished phase and fold its findings into the plan.

**Inferred user intent:** Progress toward the unified studio with a safety net for the cut-off.

**Commit (code):** 115e9ba — "Merge P0 goldens (58 cases, bit-exact check) into the CHB-037 integration branch"

### What I did
- Merged `task/chb-037-p0-goldens` (last commit cc2117e) with `--no-ff`.
- On the integration branch: `node tools/goldens/render.ts --check` → "58/58 cases within max |Δ| ≤ 0.00001";
  `pnpm test` → 106 files, 2799 passed, 19 skipped (baseline + the goldens test).
- Plan amendments: `output.frame` into the reference engine; heal and clarity implemented for real; explicit µm per
  pixel; golden translation rules.

### Why
- The goldens are the oracle for P2's light law; their gaps (no engine implements `scan.heal` or
  `finishing.clarity`; the display cut needs an app module) are exactly the inconsistencies v2 removes.

### What worked
- Coverage beyond the spec (scan flare, base transmission, view settings, knee, capture settings); deterministic
  (seeded grain); 8.2 MB.

### What didn't work
- N/A on the merge. Two cases cannot render today (dust heal, finishing clarity): stored as recipes, reported by the
  check if they start rendering.

### What I learned
- Today's `display` cut exists only through the studio's engine wrapper; the reference engine has no `output.frame`.

### What was tricky to build
- N/A (merge only).

### What warrants a second pair of eyes
- P0's recipes are built the way the studio builds them (default recipe, first print, mutations, masks from the
  studio-kit editor): good for realism, but the translation in P2b must rebuild masks from node closures.

### What should be done in the future
- Merge P1 when it reports; launch P5a and P2a.

### Code review instructions
- `tools/goldens/README.md`; `node tools/goldens/render.ts --check`.

### Technical details
- P0 diary: `diary/02-phase-p0-goldens.md` (Steps 1–3).

## Step 3: P1 merged — the builder core; a pre-existing flake fixed

`packages/values` is on the integration branch: immutable values with modifiers and explain, collections, four
mutations with exact inverses, transactions, and `canonicalJSON` moved out of the contract with every node hash
unchanged. The merge hit a changelog conflict, and the first test run exposed a flaky roll test that predates CHB-037.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Merge P1, keep the integration branch green, prepare wave 2.

**Inferred user intent:** Progress on a sound base.

**Commit (code):** fde975c — "Merge P1 values (builder core …)"; e349b96 — "Roll kit: batch ids carry a counter beside
the clock …"

### What I did
- `git merge --no-ff task/chb-037-p1-values` → "Automatic merge failed" on the ticket's `changelog.md` (both branches
  appended entries); resolved by keeping both sides (a small script removing the markers), committed.
- Checks on the merge: install, typecheck, lint, gen:check rc=0; vitest run 1: "1 failed | 2849 passed | 19 skipped",
  run 2: "2850 passed | 19 skipped".
- The failure: `packages/studio-kit/test/roll/kit.test.ts:80`, `expected 'roll:match-frame_c4f7e0f9-mwh7otym' not to be
  'roll:match-frame_c4f7e0f9-mwh7otym'`. Cause: `kits/roll/src/engine/lower.ts:161,180` build batch ids from
  `Date.now().toString(36)`; two `roll.alpha` re-plans in one millisecond get one id. Fixed with a counter
  (`batchStamp()`: clock, a dot, a sequence number); the roll tests passed 3 of 3 runs afterwards.
- Plan amendments for P2a, P5a and P4 from the P1 report.

### Why
- The P1 agent had seen one unexplained failure in four runs; it was this flake, not P1.

### What worked
- Node ids byte-identical after moving `canonicalJSON` (the P1 agent ran the suite with only that change: 105/2797).

### What didn't work
- The first merge attempt stopped on the changelog conflict (expected with parallel docmgr changelog updates; phase
  agents will keep hitting it, and keeping both sides is always right for the changelog).

### What I learned
- Time-based ids are a recurring trap here (also in looks: `look:<eval>-<n>` is sequence-based and fine).

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- P1 added `@chromobench/values` to `packages/shell/package.json` as well as the contract's and the root's, so P5a
  needs no lockfile change: outside P1's listed files, accepted.

### What should be done in the future
- Launch P5a and P2a in parallel.

### Code review instructions
- `packages/values/README.md`; `pnpm exec vitest run packages/values`.

### Technical details
- Vitest after the merge: 113 files, 2850 passed, 19 skipped. P1 diary: `diary/03-phase-p1-values.md`.

## Step 4: Wave 2 results — P2a merged (contract 1.0); the pattern experiment closed

The contract agent delivered contract 1.0: document format 3, the light/composite/repair laws, one compiler with
named cuts, one mask algebra, the four mutations, one error class. Merged; the repository is now red outside the
contract by design (850 type errors, 48 test files) until P2b–P6. In parallel, the pattern experiment (CHB-036) was
closed: blind reviews, results, revised chapters.

### Prompt Context

**User prompt (verbatim):** (see Step 1) — and, about the experiment: "what's going on with the node processes, / what
are the subagents testing? I think we can wrap the pattern stuff up, except for some egregious stuff? or what is
happening / going on?"

**Assistant interpretation:** Merge P2a and continue the waves; wrap up the pattern work; explain the running
processes.

**Inferred user intent:** Keep the implementation moving, stop side work that no longer pays.

**Commit (code):** 130e104 — "Merge P2a contract 1.0 (…)"

### What I did
- Merged `task/chb-037-p2a-contract` (66c2c17); on the integration branch: contract + values vitest 113 passed;
  `pnpm exec tsc -p packages/contract/tsconfig.json --noEmit` rc=0; lint rc=0.
- Plan amendments after P2a (contract reading list, per-package typecheck, golden translation rules) and the P3 spec.
- Process audit for the owner: P5a's browser suite (Vite on 5551–5554, headless Chromium) is legitimate; three
  orphaned test processes (two from my own tiling-hang probe, one from a v1 tiling run) had used ~100 % CPU for ~3
  hours. My `kill` of those PIDs was denied twice by the auto-mode permission classifier
  ("[Destructive or Unwanted Actions]"); I gave the owner the command instead.

### Why
- P2b and P3 need only the contract; P4 waits for P5a because both touch the shell store and the studio kit.

### What worked
- P2a's report maps every broken package to the phase that fixes it, with the reason (its diary).

### What didn't work
- `kill 22552 22549 77058 87605 85025 85026 85029` → "Permission for this action was denied by the Claude Code auto
  mode classifier". Left to the owner.

### What I learned
- My own probes need the same supervision as the agents': `per-test.py` killed with `pkill -f <dir>` only after its
  timeout, and the test runner's child survived.

### What was tricky to build
- N/A (merge).

### What warrants a second pair of eyes
- P2a decisions beyond the design: `print.grade` stays a medium setting (a gamma in `print.develop`); `split` folded
  into `burn`; heal spots apply sequentially (matches today unless a source overlaps an earlier target); the cut
  `darkroom.main`; pitch fields cannot be bound.

### What should be done in the future
- Launch P2b and P3; merge P5a when it reports; then P4.

### Code review instructions
- `packages/contract/CONTRACT-DECISIONS.md` (CC-019); `diary/05-phase-p2a-contract.md`.

### Technical details
- Breakage table (P2a report): core 68 tsc errors / 7 test files, engine-mock 21/3, goldens 21/1, gpu 35/browser,
  output 18/1, ingest 16/0, studio-kit 326/16, apps/studio 72/6, dsl 94/8, agent 45/6, tools/scripts 6/0.

## Step 5: P5a merged — one immutable UI DSL; P4 specified and launched

The UI DSL agent made `ck` and `cb` one immutable builder language on `@chromobench/values` and rewrote every call
site; all checks were green on its branch (vitest 2856, browser 108). Merged after the contract; the merged state is
as planned: contract, shell and values green, consumers red until their phases.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Merge P5a, start the history phase.

**Inferred user intent:** Steady progress through the waves.

**Commit (code):** a546ad5 — "Merge P5a UI DSL (…)"

### What I did
- Merged `task/chb-037-p5a-ui-dsl` (cf63e09); the ticket changelog conflicted again (both sides kept).
- On the integration branch: lint rc=0 ("import boundaries ok (452 file checks)"); contract tsc rc=0; vitest shell +
  values + contract: 223 passed; repository typecheck: 770 errors, all in planned consumers (studio-kit 328, dsl 93,
  apps/studio 72, core 68, agent 45, e2e 47, gpu 35, engine-mock 21, goldens 21, output 18, ingest 16, scripts 6).
- P4 spec: the generic document log lives in `packages/values` (the shell may import only values), the contract
  deletes `EditLog`, the shell's document tier becomes the values log, `Layer` → `Draft`.

### Why
- One history means one undo model for user, agent and automatic edits; placing it in values lets the shell use it
  without importing the contract.

### What worked
- The merge needed no code conflict resolution: P5a and P2a touched disjoint packages.

### What didn't work
- N/A

### What I learned
- P5a's browser runs saw two load flakes (a launch timeout, the offline service-worker test) that passed alone; to
  watch in P9.

### What was tricky to build
- N/A (merge).

### What warrants a second pair of eyes
- P5a decisions: no shell-level regions (a single screen is `ck.module('main')`); layouts declare no commands; kit
  keys bind in every module; the product holds the kit; `?variant=` removed (no aliases).

### What should be done in the future
- Merge P2b and P3 when they report; launch P4 now and P5b after it.

### Code review instructions
- `packages/shell/README.md`; `diary/04-phase-p5a-ui-dsl.md`.

### Technical details
- Running: P2b (reference engine), P3 (gpu), P4 (history).

## Step 6: P2b merged — the reference engine on contract 1.0, goldens 60/60

The reference engine, the mock and conformance now run the unified model; the golden check passes 60/60 with the
reference engine alone (no app module), including the first dust heal and finishing clarity any physics engine has
rendered. Two goldens changed deliberately; I decided the one the plan had not foreseen.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Merge P2b, rule on its open question, fix the contract export clash it reported.

**Inferred user intent:** Correct physics on the new core.

**Commit (code):** 7680d20 — "Merge P2b reference engine on contract 1.0 (…)"; (this step's commit) — `OpEncoding`
rename

### What I did
- Merged `task/chb-037-p2b-reference` (afb48cd); changelog conflict resolved (both sides).
- **Decision on `cam-dm-unsharp`**: keep the regenerated golden (max |Δ| print 3.75e-1, display 2.65e-1). P0 blurred a
  camera file's density mask at core's hidden 6 µm/px while the film ops used 375 µm/px; v2 removes hidden defaults
  (design §25). Translating the radius to 1875 µm would reproduce the old picture by encoding the old bug.
- Renamed the contract's op encoding type `Encoding` → `OpEncoding` (`registry.ts`, `index.ts`): it clashed with
  `source.ts`'s transfer `Encoding` in the index re-export and broke `packages/ingest`'s typecheck.
- Checks on the integration branch: contract and conformance tsc 0 errors; core and engine-mock 2 each, both
  `packages/ingest/src/conditioning/dust/{heal,specks}.ts: Module '"@chromobench/contract"' has no exported member
  'DustSpot'` (P5b); vitest contract + values + core + mock + conformance + shell + goldens: 50 files, 1329 passed, 7
  skipped; goldens "60/60 cases within max |Δ| ≤ 0.00001"; lint rc=0; contract gen check ok (15 files).

### Why
- The goldens protect the darkroom's physics, not its old mistakes; each regenerated case has a stated reason.

### What worked
- 56 of 58 old cases bit-exact through a hand-specified translation (`tools/goldens/translate.ts`).

### What didn't work
- N/A

### What I learned
- The hidden µm-per-pixel default had silently changed a camera-file density mask by a factor of 62.5 in radius.

### What was tricky to build
- N/A (merge).

### What warrants a second pair of eyes
- P2b decisions: heal seam additive on scanner density, multiplicative on the print; clarity low-passes luminance only
  with L = (Y/Y_w)^⅓ and midtone weight 1 − (2L − 1)²; film ops, density masks and clarity refuse images without a
  pitch (`E_EVAL`); retouch and dust spots became groups of one-spot layers.

### What should be done in the future
- P5b: `first-print.ts` and `StudioEngine` onto documents; ingest's `DustSpot` needs an explicit heal `src`.
- Optional (P8 or later): `umPerPx` on `source.pattern` so conformance can seed ops with physical sizes.

### Code review instructions
- `tools/goldens/translate.ts`, `packages/core/src/print/{clarity,geometry}.ts`; `node tools/goldens/render.ts --check`.

### Technical details
- P2b diary: `diary/06-phase-p2b-reference.md`.

## Step 7: P3 and P4 merged; the last EditLog users moved; wave 3 specified

The GPU engine (P3) runs on contract 1.0 with parity 47/47 on SwiftShader and on Metal and a 15 % faster darkroom
export; the history (P4) is one immutable log in `@chromobench/values`. Both merged; three leftover users of the
deleted `EditLog` (two tests, one demo script) were moved onto the log by me.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Merge, repair what fell between phases, plan the studio and agent waves.

**Inferred user intent:** Keep the core green while the consumers come over.

**Commit (code):** d57ca0f — "Merge P4 one history (…)"; 1a24fe7 — "Merge P3 GPU engine on contract 1.0 (…)";
(this step's commit) — tests and demo on the log, wave 3 specs

### What I did
- `merge-phase.sh` (scratchpad): merges a phase branch and resolves the ticket changelog conflict (keep both sides),
  stops on any other conflict. Both merges were clean apart from the changelog.
- Checks: tsc values/contract/shell/conformance 0 errors; core and engine-mock 1 own error each before the fix;
  vitest values + contract + shell + core + mock + conformance + gpu + goldens: "2 failed | 56 passed (58)", the two
  being `core/test/chb010.balance.test.ts` and `engine-mock/test/m1-trace.test.ts` (they used `EditLog`); goldens
  60/60; lint rc=0.
- Rewrote both tests and `tools/scripts/m1-headless.ts` on `Log.create({ rules: LOG_RULES }).open(…)`, `commit`,
  `propose`/`approve`, `undo`, `why`/`trail`; the tests pass (20), and the demo prints the same flow (S0 → +4 pt red →
  undo returns S0's hash → proposal pending leaves the patch → approval → provenance agent, approved by user).
- Plan: amendments after P3 and P4, wave 3 specs P5b-1 (studio on the document and the log) and P6a (DSL and agent).

### Why
- The tests and the demo were outside every phase's scope; leaving them broken would hide regressions.

### What worked
- `Log` reads naturally in tests: immutable, one value per step.

### What didn't work
- First vitest run after the merges: "Tests 3 failed | 1397 passed" (the `EditLog` users).

### What I learned
- Phase scopes need an owner for repo-level scripts and cross-package tests; I keep them.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- P3's two known gaps: no GPU `output.frame`; tiled export wrong at tile borders for spatial ops (density masks,
  feathers, clarity) — a correctness bug assigned to P8.

### What should be done in the future
- Launch P5b-1 and P6a in parallel; then P5b-2 (stack kit), P6b (workbench), P7 (links), P8 (Editor lab tools).

### Code review instructions
- `tools/scripts/m1-headless.ts`; `pnpm demo:m1`.

### Technical details
- P3 diary `07-phase-p3-gpu.md`, P4 diary `08-phase-p4-history.md`.

## Step 8: P6a merged — the agent's DSL on the unified model

The DSL and the agent now speak documents, cuts and the log: cuts are handles, what-ifs go through the one compiler
(`printChain`, the drifted third copy of the exposure semantics, is deleted), edits are built with the contract's
builders and proposed through the log as one submission per eval, and `h.look()` is `h.show()`. The full generated
docs check passes again.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Merge P6a, route its follow-ups, keep P5b-1 informed.

**Inferred user intent:** An agent with only `eval` on the same core as the studio.

**Commit (code):** b661c48 — "Merge P6a DSL and agent on contract 1.0 (…)"

### What I did
- Merged with `merge-phase.sh` (changelog only); `pnpm install --frozen-lockfile --prefer-offline` rc=0 (P6a added
  the values dependency to dsl and agent).
- Sent P5b-1 the API changes it must absorb (chat host `AgentDocs`, worker `{ docs }`, looks provider, two tests).
- Routed P6a's requests outside its packages (the "look" → "show" renames in the contract, `log.commit` with `why`)
  to P6b instead of doing them now: the renames reach the chat kit that P5b-1 is rewriting.

### Why
- Avoid editing files a running phase agent owns.

### What worked
- P6a's §7 grey-card trace gives identical numbers through the new path.

### What didn't work
- N/A

### What I learned
- A value with a `then` method is a thenable inside an async eval body; P6a made "several changes" an array.

### What was tricky to build
- N/A (merge).

### What warrants a second pair of eyes
- One log submission per eval removes partial approval of one eval's changes (a behaviour change, by design).

### What should be done in the future
- Merge P5b-1 when it reports; then P5b-2, P6b, P7, P8.

### Code review instructions
- `diary/10-phase-p6a-dsl.md`; `packages/dsl/src/prelude/`, `packages/dsl/src/host/`.

### Technical details
- Checks after the merge are in this step's commit message.

## Step 9: P5b-1 merged — the whole repository green on the unified model

The studio, output, ingest and the e2e specs now run on documents and the log. With P5b-1 merged, the integration
branch is green end to end for the first time since the contract cut: typecheck 0 errors, lint, gen:check (26 files),
vitest 124 files / 2935 passed / 19 skipped, goldens 60/60.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Finish the studio phase, merge, plan wave 4.

**Inferred user intent:** A working studio on the new core.

**Commit (code):** 85ec9d1 — "Merge P5b-1 studio on the document and the log (…)"

### What I did
- The P5b-1 agent ended twice before finishing (its context ran out while its e2e fork worked). I asked it to finish
  and to reconsider two behaviour changes; it decided both (ratings back to undoable via a document-tier record;
  a confirming History jump) but could not implement them. I messaged the still-running fork to commit its work and
  report to me; it did (9864cc7 fixes, 438029a e2e, b8c739f/4e92c5a diary).
- Merged with `merge-phase.sh`; full checks as above on the integration branch.
- Wave 4 specs: P5b-2 (stack kit, stage policy pass, arrangements, the two behaviour fixes) and P7 (links), in
  disjoint files; a GPU/performance phase queued after P8a.

### Why
- The browser suite found real studio bugs the unit tests missed (history wording for component writes, a lost save
  after coalesced key presses, thumbnails re-rendering drafts on the worker).

### What worked
- Browser on the P5b-1 branch: chromium-webgpu 48/48, shell-demo 3/3, studio-kit 9/9, gpu-parity 46/48 (one
  load-dependent timeout in `film.spec.ts`, one bench skipped).

### What didn't work
- A sub-agent whose context runs out mid-task hands back early; its forks keep running and must be addressed
  directly (SendMessage to the fork) to commit and report.

### What I learned
- The reference engine needs ~4.2 s for a 1024×683 screen render in the worker: likely a lost tabulated preview path;
  queued.

### What was tricky to build
- N/A (coordination).

### What warrants a second pair of eyes
- P5b-1 behaviour changes kept: key/wheel runs coalesce into one step at once; preflash is a darkroom layer; Heal Dust
  adds layers instead of altering pixels; saved edits return as real undo steps after reload; Save Document saves no
  history.

### What should be done in the future
- Launch P5b-2 and P7; merge P8a when it reports; then the GPU/performance phase, P6b, P8b (UI for P8a's ops), P9.

### Code review instructions
- `diary/09-phase-p5b1-studio.md`; `CI=1 pnpm test:browser` headless.

### Technical details
- Running: P8a (Editor lab ops in the engines).

## Step 10: P8a merged — Editor lab's tools in both engines

The composite op set (curve, levels, exposure, HSL, vibrance, grade, mixer, vignette, sharpen), radial and colour
masks, all 16 W3C blend modes with isolated groups, linear/OkLab encodings inserted by the compiler, and the scene
stage now exist in the contract, the reference engine and the GPU engine, at parity on SwiftShader and Metal.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Merge the Editor lab ops; queue the engine gaps.

**Inferred user intent:** The full layer toolset on the physical core.

**Commit (code):** eb89d96 — "Merge P8a Editor lab tools in the engines (…)"

### What I did
- Merged with `merge-phase.sh`; full checks: typecheck 0 errors, lint, gen:check (26), goldens "66/66 cases within
  max |Δ| ≤ 0.00001"; vitest "2 failed | 125 passed (127)" — `ch3.golden.test.ts` and `output/test/export.test.ts`,
  both passing alone (22/22); load from P5b-2's and P7's parallel suites.
- P3b spec (engine fixes and performance) from the queued gaps plus P8a's notes; launched next.

### Why
- Core and gpu were P8a's; with P8a merged, P3b can own them.

### What worked
- Six unmasked composite layers cost ~1 ms in preview at 4000 px (fused); goldens: the 60 old cases bit-identical.

### What didn't work
- First full vitest after the merge had the two load-sensitive failures above.

### What I learned
- Timing- or iteration-count tests are sensitive to other agents' suites on the same machine; P3b hardens them.

### What was tricky to build
- N/A (merge).

### What warrants a second pair of eyes
- P8a's decisions: entries mix in their result's encoding (a masked curve's edge blends in OkLab); separable blend
  modes in linear light (multiply/overlay stronger than on sRGB numbers); non-separable modes in OkLCh without W3C's
  ClipColor; levels extend with slope 1 beyond black/white; HSL hue shifts limited to ±60°; colour masks in the
  darkroom only for camera files.

### What should be done in the future
- P3b now; P8b (UI for these ops) after P5b-2; P6b; P9.

### Code review instructions
- `packages/core/src/composite/`, `packages/contract/CONTRACT-DECISIONS.md` (CC-020), `tools/goldens/stacks.ts`.

### Technical details
- Timings (P8a, M1 Max, 4000 × 2674): one exposure layer 22–23 ms preview / 256–263 ms export; six fused layers 23–24
  / 274–276 ms; plus one masked curve 49–52 / 369–391 ms.

## Step 11: P7 merged — rolls, looks, presets and sync as one link mechanism

Looks are now registered, versioned look functions that return groups; a link entry expands at compile with the
stage law's amount; bake turns a link into its plain group; presets are parameterless looks; a roll links the scan
medium with per-frame overrides; sync copies values or inserts one link; the DSL's named looks are link inserts and
`.cblook.js` files run in their own sandbox. With P8a and P7 merged, every check is green.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Merge P7, keep the contract's record straight, flag feature changes for the owner.

**Inferred user intent:** Shared content stays shared, and nothing the photographer used silently disappears.

**Commit (code):** f9d599a — "Merge P7 links (…)"; (this step's commit) — CC-021 renumbering, contract 1.2.0, docs

### What I did
- Merged with `merge-phase.sh`. Git merged `CONTRACT-DECISIONS.md` without a conflict but with two notes numbered
  CC-020 (P8a's composite op set at line 509, P7's links at 471): P8a landed first and keeps CC-020; P7's became
  CC-021 (contract 1.2.0, additive); `CONTRACT_VERSION` 1.1.0 → 1.2.0; `pnpm gen` regenerated `op-args.ts` and the
  catalogue snapshot.
- Checks: typecheck 0 errors; lint; gen:check (26); vitest 129 files, 3161 passed, 19 skipped; goldens 66/66;
  `contract:check`: 118 changes, 75 breaking (against the 0.4 baseline, as expected for the cut-off).

### Why
- Parallel phases that each add a change note will collide on numbers; the merge is where numbering is settled.

### What worked
- P7's whole-repo checks were green on its branch, and P5b-2's parallel work did not get in its way.

### What didn't work
- A silent duplicate: git cannot see two independent "next number" choices as a conflict.

### What I learned
- Check `CONTRACT-DECISIONS.md` numbering after every merge that touches the contract.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- **Feature removed by P7, to raise with the owner**: the film looks ("Portra on Endura", "Gold 200") and the grade
  looks were parameter edits of media (stock, paper, grade), which have no group form, so they were deleted; contrast
  looks became darkroom light (density masks, preflash). The design allows linked media (`Linked<M>`, §27); a
  "medium preset" (a link on a stage's medium, with overrides) would bring them back within the one mechanism.
- A roll links only the scan medium; printing choices stay per frame (`roll.setShared` copies them).

### What should be done in the future
- Ask the owner about medium presets for film/paper looks.
- P5b-2 must merge P7's studio-kit edits (`model/doc.ts`, `render-bridge.ts`, `studio.ts`, `dom/arg.ts`,
  `bridge/frames.ts`, `model/history.ts`, `apps/studio` `main.ts` and `host/chat.ts`); show a link as one row (name,
  Amount, Bake, Remove) and roll fields with a follow/override badge; read roll fields through
  `read(…, linksOf(state))`.

### Code review instructions
- `packages/contract/src/links.ts`, `links-looks.ts`; `diary/13-phase-p7-links.md`.

### Technical details
- Running: P5b-2 (stack kit), P3b (engines).
