---
Title: Diary
Ticket: CHB-045
Status: active
Topics:
    - gpu
    - correctness
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://packages/contract/src/pixel.ts
      Note: grid rule, MASK_T_FLOOR, blend channel formulas and the display encoding (b148f6f, 3add9fd, d2a45b3)
    - Path: repo://packages/contract/test/grid-rule.test.ts
      Note: the grid rule against BigInt; the f32 broken variant (554 widths)
    - Path: repo://packages/core/test/composite.test.ts
      Note: D7 laws
    - Path: repo://packages/gpu/kernels/combine.wgsl
      Note: mode 7 floored (3add9fd)
    - Path: repo://packages/gpu/kernels/grid.wgsl
      Note: the grid rule in u32 (b148f6f)
    - Path: repo://packages/gpu/kernels/working.wgsl
      Note: contrast modes in the display encoding, four new modes, named blend codes (d2a45b3)
    - Path: repo://packages/gpu/src/chain/wgsl-link.ts
      Note: generated contract-constants and blend-codes modules (3add9fd, d2a45b3)
    - Path: repo://packages/gpu/src/device.ts
      Note: busy/retire removed; render memory event carries pending (fd3e834)
    - Path: repo://packages/gpu/src/engine-gpu.ts
      Note: fieldOf leases, blurAt/extremesOf end them; density floor; memory pending (fd3e834, 3add9fd)
    - Path: repo://packages/gpu/src/film.ts
      Note: textures of ones leased by the grain pass (fd3e834)
    - Path: repo://packages/gpu/src/parity/law-tests.ts
      Note: law:field-race, law:grid, law:density-floor
    - Path: repo://packages/gpu/src/pool.ts
      Note: Leases, deferred release, discard with pending bytes, Budget.held (GPUC-1, GPUC-4; fd3e834)
    - Path: repo://packages/gpu/src/residency.ts
      Note: lease returns end and takes a pool lease; sampleSource uses gridAxis (fd3e834, b148f6f)
    - Path: repo://tools/goldens/README.md
      Note: stack-print-blends re-rendered (D7)
ExternalSources: []
Summary: 'Implementation diary of CHB-045: GPU correctness (GPUC-1..4) and the contrast blend modes in the display encoding (D7)'
LastUpdated: 2026-11-15T18:23:48.00539-05:00
WhatFor: ""
WhenToUse: ""
---


# Diary

## Goal

This diary records CHB-045, Phase 1's GPU correctness work and decision D7: an exact export's field textures handed to
another render mid-export (GPUC-1), the f32 grid rule picking other pixels than the reference at ties (GPUC-2), an
unfloored log in the density mask (GPUC-3), retired GPU memory that left the budget before it was destroyed (GPUC-4),
and overlay, soft light, hard light and the other contrast blend modes evaluated in the display encoding (LAY-3).

## Step 1: Reading, ticket and the shape of the work

I read the handoff guide, the CHB-037 working rules, the consolidated backlog's roadmap and group 8, decision D7, the
five source tasks (CHB-037 P10-10, P10-15, P10-26, P10-11, P10-23) and the two CHB-043 chapters the coordinator named
(`docs/patterns/gpu/03-one-grid-rule.md` and `08-retire-after-the-fence.md`, read from branch
`task/chb-043-gpu-patterns` with `git show`). Then the code: `packages/gpu/src/pool.ts`, `device.ts`, `residency.ts`,
`engine-gpu.ts` (fields, renders, recovery), `film.ts` (the textures of ones), the WGSL kernels, core's grid and blend
code and the mock's copies. I created the ticket, its six tasks and the spec (`design-doc/01-…-spec.md`).

The two memory items turned out to be one problem. Counting retired bytes in the budget (GPUC-4) while destruction
waits for a global quiet point would make every eviction during a render useless: the render that needs the room is
itself in flight, so the evicted bytes could never be reused by it and every eviction would end in E_GPU_OOM and a
retry. The fix for both is the chapter's per-object rule: a declared use (a lease) per object, release and destroy at
the last lease's end.

### Prompt Context

**User prompt (verbatim):**

```text
You are implementing ticket CHB-045 in chromobench, a browser darkroom (PWA, TypeScript monorepo with pnpm, WebGPU engine in packages/gpu, f64 reference engine in packages/core, contract in packages/contract, studio kit in packages/studio-kit, app in apps/studio). It is Phase 1 of the roadmap in the consolidated backlog.

WORKTREE: /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb045 (branch task/chb-045-gpu-correctness, from the integration branch task/chb-037-unified-model at 9be785b). Work only there. Run `pnpm install` first if node_modules is missing.

READ FIRST
- docs/HANDOFF.md (how the repo works, checks, GPU parity, privacy).
- ttmp/2026/11/14/CHB-037*/design-doc/01-implementation-plan-and-working-rules.md (working rules).
- ttmp/2026/11/15/CHB-044*/reference/01-consolidated-backlog.md ("Roadmap", group 8 GPU engine correctness, LAY-3) and reference/03-decisions-d1-d13.md (D7).
- The source tasks in ttmp/2026/11/14/CHB-037*/tasks.md: P10-10, P10-15, P10-26, P10-11, P10-23.

SCOPE
1. GPUC-1 / P10-10 (correctness): `dropFields` releases an exact export's field textures into the pool when a preview starts (packages/gpu/src/engine-gpu.ts around 805-809, 894). An export tile that took one and has not submitted can read another render's writes. Reproduce with a test that forces the interleaving (a deterministic test, as CHB-038 did for the destroyed-texture race: e2e/diagnostics.spec.ts and its diary), then fix so a field texture returns to the pool only after the last reader's work is submitted/complete (the device/pool already have busy()/retire(); see the CHB-043 chapter docs/patterns/gpu/08-retire-after-the-fence.md on the main checkout /Users/manuel/code/wesen/chromobench on branch task/chb-043-gpu-patterns for the reasoning).
2. GPUC-2 / P10-15 (latent correctness): the nearest-sample grid rule fp = region.x + ⌊(p + ½)·region.w / w⌋ is computed with an f32 ratio on the GPU and can pick a different source pixel than the f64 reference at exact ties and near-ties (4000 px working width: 554 of 3901 output widths have a mismatching column; 106 px thumbnail column 26 reads 999 vs 1000). Compute it in integers: fp = region.x + ⌊((2p + 1)·region.w) / (2w)⌋ with a guard against u32 overflow, in packages/gpu kernels (pointwise.wgsl, retouch.wgsl, frame.wgsl — find every use) and residency.ts gridCoords, and make core/mock use the identical integer formula. Add a law test that sweeps output widths (e.g. every width 1…4000 for a 4000-px region, a few heights) comparing engines column by column, including even widths with ties. See docs/patterns/gpu/03-one-grid-rule.md on branch task/chb-043-gpu-patterns for the derivation.
3. GPUC-3 / P10-26: density-mask mode 7 (packages/gpu/kernels/combine.wgsl ~64) takes log2 of blurred transmittance without a floor; floor it like line ~57, mirror in core if relevant; add a test with a zero/subnormal input.
4. GPUC-4 / P10-11: retired bytes leave the ledger at once (pool.ts ~195, 211) but are destroyed only when no render is in flight (device.ts ~279-282). Count retired-but-not-destroyed bytes in the budget (a "pending" term) until destroyed, and have allocation consider it; journal high-water marks include it. Unit tests.
5. LAY-3 / P10-23 / decision D7: overlay, soft light, hard light and the other contrast modes (vivid light, linear light, pin light, hard mix) are evaluated in the display encoding so they switch at display mid-grey, as Photoshop users expect; the other modes stay in linear light. Implement in core and GPU (and mock if it has blends), update parity tests, the catalogue/blend docs (say which modes are encoded), and goldens that change (regenerate deliberately; record before/after in the diary).

CHECKS before you report: pnpm typecheck, pnpm lint, pnpm gen:check, pnpm test, goldens, the SwiftShader browser suite (headless; STUDIO_PORT/GPU_PARITY_PORT/STUDIO_KIT_PORT/SHELL_DEMO_PORT set to ports in 5571–5579 — never 4173, which is the owner's dev server), and gpu-parity on Metal (REAL_GPU=1) under the GPU lock: run it as `zsh /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb041-lock.sh <command>` (it takes the lock with mkdir, retries, writes an owner file and always removes the lock). Do not edit files while a browser suite is running against them.

RULES
- Browsers headless only (headed windows steal the owner's focus).
- Privacy: test material includes the photographer's private family photos (.playwright-mcp/photos, scans; git-ignored). You may use them locally to reproduce, never commit them or quote file names, people or content in commits, tickets or diaries ("a 24-megapixel raw file").
- No backwards-compatibility shims (hard cut-off policy). Keep code habitable: one formula in one place where possible.
- Ticket: create CHB-045 with docmgr in the worktree (`docmgr ticket create --ticket CHB-045 --title "GPU correctness: field textures reused mid-export, integer grid rule, floored logs, retired memory counted; contrast blend modes in the display encoding" --topics gpu,correctness`), tasks for the five items, a short spec under design-doc/.
- DIARY (required): keep a detailed diary in the ticket (`docmgr doc add --ticket CHB-045 --doc-type reference --title "Diary"` or a diary/ folder like CHB-041), following ~/.codex/skills/diary/SKILL.md exactly (read it first): one step per meaningful unit of work, with Prompt Context, What I did, Why, What worked, What didn't work (verbatim errors and commands), What I learned, What was tricky, What warrants a second pair of eyes, Future, Code review instructions, Technical details. Relate files, update the changelog.
- COMMIT at appropriate intervals (per item, then checks, then diary), messages starting "CHB-045:" and ending with the line
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Do not push. Do not merge into the integration branch (the coordinator merges).
- Another agent works in parallel in the sibling worktree chb046 (editing blockers: mask tool, Apply Print Settings, Real↔Normalised, sliders, stack order, sync label, first-print aim); avoid editing its areas (studio-kit stack/darkroom UI, roll first print) and coordinate through the coordinator if you must.

REPORT (concise): per item what changed and the evidence (tests, before/after numbers); checks with counts; goldens changed and why; commit hashes; anything left open.
```

**Assistant interpretation:** Fix the four GPU correctness debts with deterministic tests, implement D7 in core, GPU
and mock with docs and regenerated goldens, keep a diary, commit per item, run every check including Metal.

**Inferred user intent:** Phase 1's exit needs the engine to be correct before the photographer tests; each fix must
be proven by a test that fails on the old code.

### What I did
- Read the documents above; `grep` for every grid-rule site (`(p + 0.5) *`, `outMap`), every release/discard/retire
  call (70 release sites in `packages/gpu/src`), every blend implementation (core `composite/blend.ts`, mock
  `ops.ts`, `kernels/working.wgsl`).
- `docmgr ticket create --ticket CHB-045 …`, six `docmgr task add`, `docmgr doc add` for the spec and this diary.

### Why
- The chapters give the reasoning (finish rule at submission in WebGPU; integer grid rule and its u32 bound).

### What worked
- Every pass in `packages/gpu` releases its inputs after its own `queue.submit` (chain/run.ts, spatial.ts, film.ts,
  retouch.ts, engine/textures.ts): the invariant that lets a free-list object be destroyed at once holds.

### What didn't work
- `B=ttmp/2026/11/15/CHB-044*/reference; grep … $B/01-consolidated-backlog.md` → `ugrep: warning: …CHB-044*/reference/01-consolidated-backlog.md: No such file or directory` (a glob in an assignment is not expanded); used the full path.
- `grep -rn … --include=*.ts` in zsh → `(eval):1: no matches found: --include=*.ts`; quoted the pattern.

### What I learned
- The contract has no vivid light, linear light, pin light or hard mix; D7 names them as contrast modes. They are added
  (Photoshop's definitions) so the rule covers the set D7 names.
- The blend codes in WGSL are hand-numbered indices into `BLEND_MODES`; adding modes shifts them, so they are now
  generated from the contract.

### What was tricky to build
- Seeing that GPUC-4's "count pending" and the global `busy()` quiet point cannot coexist (see the opening).

### What warrants a second pair of eyes
- The decision to add four blend modes (D7 names them; the contract did not have them).

### What should be done in the future
- N/A

### Code review instructions
- Start with the spec: `design-doc/01-gpu-correctness-and-contrast-blend-modes-spec.md`.

### Technical details
- Chapter 8's finish rule for WebGPU: a resource may be destroyed or reused once every pass that declared a use is
  submitted (queue order puts later writes after earlier reads; `destroy()` lets the user agent reclaim memory after
  submitted work completes).

## Step 2: GPUC-1 and GPUC-4 — leases per object, fields leased, pending bytes in the budget

The pools now know who still needs an object. `Pool.lease(obj)` declares a use by a pass not submitted yet and returns
the function that ends it. `release` of a leased object waits for the last lease; `discard` of one takes it out of the
live bytes at once, puts its bytes in `Budget.pending` and destroys it when the last lease ends. The engine's whole-frame
fields are leased by the tile that reads them, in the same synchronous step as the cache lookup, so a preview's
`dropFields` can no longer hand a field to another render mid-export. The residency's leases and the film grain's
textures of ones are pool leases too, which made the runtime's global `busy()`/`retire()` quiet point unnecessary:
it is deleted, and a free-list object (released after its last submit, never leased) is destroyed at once when trimmed.

The deterministic test (`law:field-race`) forces the interleaving the same way CHB-038 did for the ones texture: it
wraps the tile's `upsampleAt` so that, before the tile reads the field, a preview renders and an "intruder" takes a
texture with the field's descriptor from the pool and fills it with 0.25. With the leases turned off (the `broken`
option replaces `lease` by a no-op, i.e. the code before) the pool hands the field itself to the intruder and every
one of the tile's 12 288 codes differs from the whole-frame export; with them, the intruder gets another texture and
the tile is bit-identical.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Items 1 and 4 of the scope: release a field only after its reader submitted, with a
forced-interleaving test; count retired-but-not-destroyed bytes in the budget and in the high-water marks.

**Inferred user intent:** No wrong pixels from pool reuse during an export, and a budget that does not lie about memory.

**Commit (code):** fd3e834 — "CHB-045: GPUC-1 and GPUC-4 — per-object leases in the pools; fields leased by the tiles that read them; pending bytes counted in the budget"

### What I did
- `packages/gpu/src/pool.ts`: `Entry.leases`/`then`; `lease()`, deferred `release()`, `discard()` with pending bytes,
  `destroyPending`, `pendingCount`/`bytesPending`; `Budget.pending`, `held` (live + pending) used by `fits`,
  `trimFree`, `peak`, `watch`, `onShort`; free-list trims destroy at once; the `retire` hook removed.
- `packages/gpu/src/device.ts`: `busy`, `retire`, `retired`, `inFlight`, `retiring` removed; the render memory event
  carries `pending`. `engine-gpu.ts`: `gpu()` no longer wraps `busy`; `fieldOf` returns `{ tex, s, pad, done }`
  (leased on a hit and after a build), `blurAt` and `extremesOf` end the lease in `finally`; `dropFields` comment;
  `memory()` reports `pending`; the residency gets the pool's lease as its `hold`.
- `residency.ts`: `lease(key)` returns its end function and takes a pool lease; `unlease` removed; `put` of the same
  texture updates the item in place (a fresh item for a new texture starts with no leases).
- `film.ts`: `ones(like)` is synchronous and returns `{ tex, done }`; the grain's `− density_min` pass ends it.
- `apps/studio/src/host/capture.ts`: the journal's "GPU memory per render" row has `pendingMB`.
- Tests: `packages/gpu/test/residency.test.ts` (leases: release while leased, two leases, discard while leased is
  pending and blocks an allocation, peaks include pending, trims destroy at once, destroyAll); the residency lease test;
  `law:field-race` + spec (fixed and broken); `e2e/diagnostics.spec.ts` ones regression rewritten on leases (it checks
  1 pending object of 160·107·16 bytes while A holds it, 0 after).
- Runs: `npx vitest run packages/gpu apps/studio` (17 files, 140 passed, 1 skipped); `CI=1 STUDIO_PORT=5571 … npx
  playwright test packages/gpu/test/browser/law.spec.ts -g "field|tile by tile" --project gpu-parity` (3 passed, 2.4
  min); `… e2e/diagnostics.spec.ts packages/gpu/test/browser/residency.spec.ts` (10 passed).

### Why
- Counting pending bytes only makes sense if they are freed when their user is done, not when the whole engine is
  idle: a render evicting to make room for itself would otherwise never get the room.

### What worked
- `law:field-race {"same":false,"codes":0,"firstCodes":0,"pending":0}`; broken:
  `{"same":true,"codes":12288,"firstCodes":0,"pending":0}`.
- `law:tiles` still bit-exact for every spatial op (codes 0).

### What didn't work
- My first wait for the browser run: `sleep 60; cat …output` → `Blocked: sleep 60 followed by: cat …` (the harness
  forbids chained sleeps); ran the suites with `run_in_background` instead.

### What I learned
- Every pass in `packages/gpu` already released its inputs after `queue.submit` (70 sites); that convention is what
  makes "a free object has no pending reader" true, now written down in `pool.ts`.
- A lease must be taken in the same synchronous step as the lookup: `fieldOf` is async, and between its return and
  the caller's continuation other tasks run.

### What was tricky to build
- `extremesOf` reads the field over several boxes, with awaits between: the lease spans the whole loop
  (`try … finally F.done()`).
- Residency `put` used to carry an old item's lease count over to the new texture under the same key; with
  closure-based leases the count would never return to zero. A replaced texture now keeps its own count (its pool
  lease defers its destruction), the new one starts at zero.

### What warrants a second pair of eyes
- Removing `busy()`: any future cache that hands out a texture across an await must lease it, or the CHB-038 error
  ("Destroyed texture … used in a submit") returns. The rule is in `pool.ts`'s header and `device.ts`.
- Free-list trims destroy at once; this relies on "release after submit" at every call site.

### What should be done in the future
- `Pool.pin`/`unpinAll` (unused in `src`) overlap with leases; GPUC-9 (dead machinery) can delete them.

### Code review instructions
- `packages/gpu/src/pool.ts` (header, `lease`, `release`, `discard`, `Budget.held`), `engine-gpu.ts` `fieldOf`,
  `blurAt`, `extremesOf`, `residency.ts` `lease`, `film.ts` `ones`.
- `npx vitest run packages/gpu`; `CI=1 GPU_PARITY_PORT=5574 … npx playwright test packages/gpu/test/browser/law.spec.ts -g field --project gpu-parity`.

### Technical details
- Budget: `fits(b) = live + pending + b ≤ limit`; a discarded leased object of 64·64·16 B in a budget of three such
  objects leaves room for two more, not three (unit test).

## Step 3: GPUC-2 — one integer grid rule

Every engine now samples by one function of the contract: output pixel p of an n-pixel grid over (x, w) reads image
pixel `x + ⌊(2p + 1)·w / 2n⌋`, in integers (`gridSample`, `gridAxis`, `gridCheck` in `packages/contract/src/pixel.ts`).
Core, the mock and the GPU's proxies call it; the GPU kernels include `kernels/grid.wgsl`, the same formula in u32,
and the host refuses a grid with n·w ≥ 2³¹ before packing a uniform, the bound below which (2p + 1)·w cannot wrap.

The law test runs the engines against each other column by column. Before the fix (the old kernels and `program.ts`
restored with `git stash push` over the new test), the GPU read another column than core in 561 of the 4000 output
widths (1447 columns) and 64 of the 2674 heights (132 rows), with proxies and without; after it, none. The sweep meets
34 000 tie columns among the widths and 4953 among the heights.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Item 2: integer grid rule in every GPU kernel and in `residency.ts`, the identical
formula in core and mock, and a law test sweeping widths and heights with ties.

**Inferred user intent:** A preview, a tile and a thumbnail must be exact samples of the export on every engine, so
parity can be checked bit for bit.

**Commit (code):** b148f6f — "CHB-045: GPUC-2 — one integer grid rule fp = x + floor((2p+1)·w / 2n) in the contract, core, mock and the GPU kernels"

### What I did
- Contract: `GRID_LIMIT`, `gridCheck`, `gridSample`, `gridAxis` (pixel.ts).
- Core: `engine-ref.ts gridOf` and `print/masks.ts gridCentres` use `gridAxis` (the `min(w − 1, …)` clamp is gone: the
  integer rule never leaves the region). Mock: `engine-mock.ts` evaluate uses `gridAxis`.
- GPU: `kernels/grid.wgsl` (`gridSample(p, region, n)` in u32), a kernel module of `chain/working.ts`; `pointwise.wgsl`
  (`outMap` is now `vec4<u32>`, the region; `program.ts` packs it and calls `gridCheck`), `retouch.wgsl` (its uniform's
  first vec4 is the u32 region; `retouch.ts` checks that the base texture is the grid and calls `gridCheck`),
  `frame.wgsl` straighten (`framePass` calls `gridCheck`); `retouch.ts` and `frame.ts` now link their kernels
  (`linkKernel`). `residency.ts`: `gridCoords` (an f32 imitation of the kernel) deleted; `sampleSource` uses `gridAxis`.
- Tests: `packages/contract/test/grid-rule.test.ts` (new), `packages/gpu/test/residency.test.ts` (the proxy test reads
  the tie of the 106-px thumbnail), `law:grid` and its spec.
- Before/after: `git stash push -m old-grid kernels/pointwise.wgsl kernels/retouch.wgsl kernels/frame.wgsl
  src/chain/program.ts src/retouch.ts src/frame.ts src/residency.ts src/chain/working.ts`, ran `law:grid`, `git stash pop`, ran it again.

### Why
- One formula in one place: the f32 imitation in `residency.ts` agreed with the kernel by sharing its rounding error,
  and both disagreed with core at ties (CHB-043 ch. 3, note 2).

### What worked
- Before: `law:grid {"widths.proxies":{"sizes":561,"columns":1447,"ties":34000,"first":"n = 15: 2"},"widths.kernel":{"sizes":561,"columns":1447,…},"heights.proxies":{"sizes":64,"columns":132,"ties":4953,"first":"n = 63: 2"},"heights.kernel":{"sizes":64,"columns":132,…}}`.
- After: every `sizes` and `columns` 0 (1.9 min on SwiftShader; ~20–40 s per sweep).
- The f32 rule's mismatches over widths 100…4000 reproduce CHB-043's numbers exactly: 554 widths, 1419 columns at ties,
  1425 in all (6 near ties).
- `npx vitest run`: 143 files, 3435 passed, 19 skipped.

### What didn't work
- The first "before" run piped through `tail -15`, which cut the `law:grid` result line; reran with the full log in a
  file (`../grid-before.log`).

### What I learned
- In f64, ⌊a/b⌋ of integers is exact for a < 2⁵³ (the quotient would have to be within a·2⁻⁵³ of the next integer,
  but it is at least 1/b away), so `Math.floor` is the integer rule in JavaScript.
- Widths below 100 add 7 mismatching widths to CHB-043's 554 (561 over 1…4000).

### What was tricky to build
- The retouch kernel took its grid ratio from the uniform but its grid size from the dispatch; with an integer rule the
  grid size is the base texture's (`textureDimensions(base)`), so `Retouch.pass` now refuses a base that is not the
  grid instead of silently using two sizes.
- WGSL: `vec4<u32>(U.reg)` converts the straighten region (f32 holding integers < 2²⁴, exact).

### What warrants a second pair of eyes
- `outMap` changed type in the Prog struct (vec4f → vec4u); the WGSL struct and `PROG` in `program.ts` are still
  written twice (GPUC-7 will generate them).

### What should be done in the future
- GPUC-7: generate the WGSL structs from `layout.ts`.

### Code review instructions
- `packages/contract/src/pixel.ts` (grid section), `packages/gpu/kernels/grid.wgsl`, the three kernels' `gridSample`
  calls, `program.ts packProgram`.
- `npx vitest run packages/contract/test/grid-rule.test.ts`; `CI=1 GPU_PARITY_PORT=5574 … npx playwright test
  packages/gpu/test/browser/law.spec.ts -g "grid rule" --project gpu-parity`.

### Technical details
- u32 bound: (2p + 1)·w ≤ (2n − 1)·w < 2n·w ≤ 2³² ⇔ n·w ≤ 2³¹; the largest 2-D texture we target (16384²) is 2²⁸.

## Step 4: GPUC-3 — the density mask's log floored

The density pass of the GPU's combine kernel (mode 7) took the log of the blurred transmittance without a floor. A
transmittance of 0, or a subnormal the GPU flushes, has no log: WGSL may assume no infinities, and SwiftShader in fact
returned −15.1 for log2(0), a density error of 15. Core had the same gap in f64 (10^−PD underflows below 10⁻³²⁴, the
reference extreme becomes −∞ and every density NaN). Both now take log10 max(T, MASK_T_FLOOR) with
`MASK_T_FLOOR = 1e-8` (density 8) from the contract, and the engine floors the reference extreme it passes as a uniform.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Item 3: floor mode 7's log like mode 2, mirror in core, test with zero and subnormal input.

**Inferred user intent:** No −∞ or NaN reaching a print from a very dense negative or a flushed subnormal.

**Commit (code):** 3add9fd — "CHB-045: GPUC-3 — the density mask floors the blurred transmittance before its log (GPU mode 7, core, the reference extreme)"

### What I did
- Contract `pixel.ts`: `MASK_T_FLOOR`. `chain/wgsl-link.ts`: a generated module `contract-constants` (`H_FLOOR`,
  `MASK_T_FLOOR`) included by `combine.wgsl`; mode 2 uses `H_FLOOR` instead of the literal 1e-8, mode 7 floors.
- `engine-gpu.ts`: the density pass's `w.y` = log10 max(extreme, MASK_T_FLOOR). Core `densityMask.ts`: `logT`.
- Tests: `law:density-floor` (combinePass on T = 0, 1e-40, 1e-45, 1e-30, 1e-12, 1e-8, 1e-6, 0.01, 0.5, 1),
  `packages/core/test/density-mask-floor.test.ts`.
- Before/after: `git stash push -q packages/gpu/kernels/combine.wgsl`, ran the spec, `git stash pop -q`, ran again.

### Why
- The light law already floors H (mode 2); one constant per floor, from the contract, in both engines.

### What worked
- Before: `law:density-floor {"d":[-15.115406036376953,-15.113565444946289,-15.115406036376953,-11.000000953674316,-2,0,1,3,3.849484920501709,4],"finite":true,"maxAbs":15.115406036376953}`.
- After: `{"d":[0,0,0,0,0,0,1,3,3.849484920501709,4],"finite":true,"maxAbs":8.166630038886069e-8}`.
- Goldens unchanged (no golden's mask exposure is below 1e-8).

### What didn't work
- `expect(10 ** -330).toBeGreaterThan(0)` → `AssertionError: expected 0 to be greater than 0`: 1e-330 is below the
  smallest f64 subnormal (4.9e-324); the test uses PD 310 (1e-310, subnormal).
- `make(label, data: Float32Array)` → `TS2345: Argument of type 'Float32Array<ArrayBufferLike>' is not assignable to
  parameter of type 'GPUAllowSharedBufferSource'`; typed it `Float32Array<ArrayBuffer>`.

### What I learned
- SwiftShader's log2(0) is a finite −15.1 here, not −∞: the "before" failure is a wrong number, not a NaN — worse,
  because nothing downstream notices.

### What was tricky to build
- Nothing beyond keeping the floor in three places consistent (kernel, host extreme, core); the constant is generated
  into WGSL so it cannot drift.

### What warrants a second pair of eyes
- The floor value (density 8) is far below any negative; above it nothing changes (checked by the goldens).

### What should be done in the future
- N/A

### Code review instructions
- `packages/gpu/kernels/combine.wgsl` mode 7, `chain/wgsl-link.ts` `contract-constants`, `core/src/print/densityMask.ts`.
- `npx vitest run packages/core/test/density-mask-floor.test.ts`; `… playwright test packages/gpu/test/browser/law.spec.ts -g "density-mask density" --project gpu-parity`.

### Technical details
- d = γ·(log10 max(T, 1e-8) − log10 max(T_ref, 1e-8)); with T_ref = 0 the reference is −8, and every T ≤ 1e-8 has d = 0.

## Step 5: LAY-3 (D7) — contrast blend modes in the display encoding

Overlay, hard light, soft light and Photoshop's vivid light, linear light, pin light and hard mix are now evaluated on
display-encoded channels: `B(b, s) = dec(B_W3C(enc(b), enc(s)))` with the sRGB curve (odd below 0), so they switch at
display mid-grey (linear 0.214) instead of linear ½ (display 0.735). The other separable modes stay in linear light,
and the amount still mixes in the entry's encoding. The four Photoshop modes did not exist; D7 names them as contrast
modes, so they were added (after soft-light: 20 modes).

The channel formulas moved into the contract (`pixel.ts`: `blendChannel`, `displayEncode`, `displayDecode`,
`blendSeparable`, `CONTRAST_BLENDS` in `document.ts`), so core and the mock share one definition; the WGSL mirrors them
with blend codes generated from `BLEND_MODES` (adding modes shifted every code after soft-light, which the hand-numbered
`case 12u:` … would have silently broken). One golden changed, by decision: `stack-print-blends` (its soft-light layer).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Item 5: implement D7 in core, GPU and mock; parity, catalogue/blend docs saying which
modes are encoded; regenerate the goldens that change and record before/after.

**Inferred user intent:** A Photoshop user's overlay and soft light must behave as he expects (neutral at mid-grey).

**Commit (code):** d2a45b3 — "CHB-045: LAY-3 (D7) — overlay and the other contrast blend modes in the display encoding; vivid, linear and pin light and hard mix"

### What I did
- Contract: `BLEND_MODES` (+ vivid-light, linear-light, pin-light, hard-mix), `CONTRAST_BLENDS`, `pixel.ts` blend
  section; catalogue doc of `blend` (layers.ts); `CONTRACT_VERSION` 1.5.0; `CONTRACT-DECISIONS.md` "Contract 1.5" and
  CC-024 (grid rule, MASK_T_FLOOR, D7); `pnpm gen` (op-args, catalog snapshot, `docs/reference/ops/composite.md`).
- Core `composite/blend.ts`: `blendChannel` deleted (contract's), `blendPixel` calls `blendSeparable`. Mock `ops.ts`:
  its copy deleted, calls `blendSeparable`.
- GPU: `working.wgsl` (`wkDodge`, `wkBurn`, the four modes, `wkEnc`/`wkDec`, `blContrast` around the channel blend;
  named cases); `wgsl-link.ts` generates `blend-codes`.
- Tests: core `composite.test.ts` (new formulas; D7 laws), contract `composite-law.test.ts` (20 modes), GPU
  `digital.spec.ts` (title, the separable set, GPUC-11's comment fixed: 1.1e-4 is 0.03 of an 8-bit level),
  `law:digital-doc` blends document + overlay and linear-light layers.
- Goldens: `node tools/goldens/render.ts --check` → 65/66, failing `stack-print-blends` (display max 1.22e-1, mean
  5.05e-2); `node tools/goldens/render.ts --only stack-print-blends`; `--check` → 66/66. Recorded in
  `tools/goldens/README.md`. Docs: HANDOFF and DEMO say 20 modes.

### Why
- D7 (CHB-044 `reference/03-decisions-d1-d13.md`): in linear light these modes switch at display 0.735, which reads
  as wrong to a Photoshop user.

### What worked
- `law:blend`: every mode within 2.4e-6 of core in RGB (vivid light 2.4e-6, pin light 1.2e-6), OkLab within the
  existing 3e-4 bound (pin light 9.7e-5, exclusion 1.1e-4).
- Golden before → after (display mean RGB): 0.249 0.261 0.267 → 0.299 0.314 0.316; min 6.6e-5 1.3e-3 1.5e-3 →
  3.4e-4 4.4e-3 5.1e-3. The soft-light layer's top (a curve 0.1…0.9) is above display mid-grey more often than
  above linear ½, so it lightens more.

### What didn't work
- `law:digital-doc` with an overlay curve and a vivid-light exposure: `Error: blends … Expected: <= 0.0003 Received:
  0.000634616623750639` (finished cut). With linear light instead of vivid light: 3.7e-4; with overlay on an exposure:
  4.3e-4; without the two new layers: 9.8e-5 (display 1.2e-4). The kernels agree with core to 2e-6, so the extra
  error is the stack's upstream f32 error amplified by the sRGB curve's slope in the darks (up to 12.92). Bound for
  that document raised to 8e-4 with the reason in the spec; 8-bit display still ≤ 1 level.

### What I learned
- WGSL `switch` takes module-scope `const` identifiers as case selectors (Tint and SwiftShader accept the generated
  `case BL_OVERLAY:`), so the codes can follow the contract.

### What was tricky to build
- Inserting modes in the middle of `BLEND_MODES` shifts the codes of difference … luminosity; every consumer reads
  codes through `blendCode` (index) or the generated constants, nothing else is numbered by hand any more.
- Linear light's b + 2s − 1 leaves [0, 1] on [0, 1] inputs: clamped (as Photoshop), like dodge and burn's min(1, …).

### What warrants a second pair of eyes
- Adding four modes (D7 names them, the contract did not have them); the choice of the sRGB curve as "the display
  encoding" independent of the viewer's display space.
- The raised bound for the blends document (8e-4 at the finished cut).

### What should be done in the future
- The stack kit's blend menu lists 20 modes in contract order; grouping them as Photoshop does (darken, lighten,
  contrast, comparative, component) is UI work for the stack kit's owner.

### Code review instructions
- `packages/contract/src/pixel.ts` (blend section), `document.ts` `BLEND_MODES`/`CONTRAST_BLENDS`,
  `packages/gpu/kernels/working.wgsl`, `chain/wgsl-link.ts`, core `composite/blend.ts`.
- `npx vitest run packages/core/test/composite.test.ts packages/contract`; `node tools/goldens/render.ts --check`;
  `… playwright test packages/gpu/test/browser/digital.spec.ts --project gpu-parity`.

### Technical details
- Display mid-grey: dec(0.5) = ((0.5 + 0.055)/1.055)^2.4 = 0.21404. A source at that value is neutral in overlay's
  kin: overlay/hard light 2·b·½ = b; soft light b − 0·… = b; vivid light burn(b, 1) = b; linear light b + 1 − 1 = b;
  pin light min(b, 1) = b (b ≤ 1).

## Step 6: Checks on SwiftShader and Metal

Every check passes on the branch at d2a45b3: typecheck, lint, gen:check, vitest (143 files, 3440 passed, 19 skipped),
the 66 goldens (one re-rendered deliberately in Step 5), the full browser suite on SwiftShader (162 passed, 2 skipped
benches, GPU conformance 524/524) and gpu-parity on the M1 Max's Metal adapter under the GPU lock (61 passed, 2
skipped, conformance 524/524). The new tests behave the same on Metal as on SwiftShader.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Run every check the coordinator listed before reporting.

**Inferred user intent:** The branch is ready to merge into the integration branch.

### What I did
- `pnpm typecheck`, `pnpm lint` (import boundaries ok, 502 file checks; check-colours ok), `pnpm gen:check` (26 files),
  `npx vitest run`, `node tools/goldens/render.ts --check` (66/66 within 1e-5).
- `CI=1 STUDIO_PORT=5571 STUDIO_KIT_PORT=5572 SHELL_DEMO_PORT=5573 GPU_PARITY_PORT=5574 npx playwright test` →
  162 passed, 2 skipped (14.0 min).
- `zsh …/scratchpad/chb041-lock.sh env CI=1 REAL_GPU=1 STUDIO_PORT=5575 STUDIO_KIT_PORT=5576 SHELL_DEMO_PORT=5577
  GPU_PARITY_PORT=5578 npx playwright test --project gpu-parity` → adapter `apple metal-3`, 61 passed, 2 skipped (51.6 s).
- Checked the source tasks in CHB-037 (P10-10, P10-11, P10-15, P10-23, P10-26, P10-27) and CHB-045's tasks.

### Why
- Phase 1's exit asks for the browser suite on SwiftShader and Metal and the goldens.

### What worked
- Metal: `law:field-race` same false / codes 0 (broken: same true / 12288); `law:grid` 0 columns in all four sweeps
  (5.3 s for 4000 widths); `law:density-floor` maxAbs 1.05e-7; `law:digital-doc` blends finished 4.3e-4, display
  8-bit ≤ 1 (the same as SwiftShader).
- An earlier gpu-parity run after Step 3 (before GPUC-3 and D7): 60 passed, 2 skipped, conformance 524/524.

### What didn't work
- `sleep 170; grep …` → `Blocked: sleep 170 followed by: grep …` (the harness forbids it); waited with Monitor.

### What I learned
- Metal runs the grid sweep (21 000 renders) in ~17 s, SwiftShader in ~110 s.

### What was tricky to build
- N/A (checks only).

### What warrants a second pair of eyes
- N/A beyond the earlier steps.

### What should be done in the future
- N/A

### Code review instructions
- Re-run the commands above; the logs of these runs were in the scratchpad (`browser-full.log`, `metal.log`).

### Technical details
- Ports 5571–5574 (SwiftShader) and 5575–5578 (Metal); never 4173.
