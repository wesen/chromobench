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
RelatedFiles: []
ExternalSources: []
Summary: "Implementation diary of CHB-045: GPU correctness (GPUC-1..4) and the contrast blend modes in the display encoding (D7)"
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
