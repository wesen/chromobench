---
Title: Implementation plan and working rules
Ticket: CHB-037
Status: active
Topics:
    - architecture
    - ui
    - webgpu
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-14T20:56:49.82426-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation plan and working rules

## Executive Summary

<!-- Provide a high-level overview of the design proposal -->

## Problem Statement

<!-- Describe the problem this design addresses -->

## Proposed Solution

<!-- Describe the proposed solution in detail -->

## Design Decisions

<!-- Document key design decisions and rationale -->

## Alternatives Considered

<!-- List alternative approaches that were considered and why they were rejected -->

## Implementation Plan

<!-- Outline the steps to implement this design -->

## Open Questions

<!-- List any unresolved questions or concerns -->

## References

<!-- Link to related documents, RFCs, or external resources -->
# CHB-037 implementation plan and working rules

This ticket implements CHB-035 design 01 **v2** ("One editing model for chromobench"), the source of truth:
`ttmp/2026/11/14/CHB-035--digital-editing-tools-from-editor-lab-layers-groups-masks-workspaces-in-the-ui-dsl-and-editor-lab-s-performance-architecture/design/01-digital-editing-in-chromobench.md`
(sections cited below as "design §N"). Its companion `02-editor-lab-performance-architecture.md` covers engine
performance. Read the design's opening, then the sections your phase cites, before writing code.

The owner's goal, in short: a professional Lightroom for a photographer who works with film (scans and film
simulation); a UI language that allows many arrangements and stays cohesive and elegant; WebGPU performance; a full
layer system (Photoshop / Lightroom tools, from Editor lab); an agent with only `eval` covers all functionality and
introspection. **Hard cut-off**: no backwards compatibility, no migrations, no wrappers; delete what is replaced.

## 1. Working rules (every agent)

- **Diary.** Keep a diary in this ticket following `~/.codex/skills/diary/SKILL.md` exactly (step format, Prompt
  Context with the verbatim prompt, What I did / Why / What worked / What didn't work (exact errors and commands) /
  What I learned / What was tricky / Second pair of eyes / Future / Code review instructions / Technical details).
  The main agent writes `diary/01-diary.md`; a phase agent writes its own `diary/NN-phase-<id>-<slug>.md`, created
  with `docmgr doc add --ticket CHB-037 --doc-type diary --title "Diary — phase <id> <slug>"` (rename the file to
  that pattern if docmgr names it otherwise). Write a step when you finish a design decision, an implementation
  piece or a debugging episode, while you work, not at the end. Run docmgr from your worktree root.
- **Commits.** Commit at each green, coherent step on your phase branch, with a message that says what and why; end
  every message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, never merge
  into the integration branch or main: the main agent merges.
- **Checks.** Before each commit, the checks for what you touched must pass: `pnpm typecheck`, `pnpm lint`,
  `pnpm gen:check` (regenerate with `pnpm gen` when generated docs change), and `pnpm test` (vitest). Phases that
  deliberately break consumers say so in their spec; then the packages you own must be green and the diary lists
  what is broken elsewhere and why.
- **Browser and GPU.** Browser suites run headless (`CI=1 pnpm test:browser`, Playwright headless; never a headed
  window: it takes the owner's focus). Give each run its own ports: `STUDIO_PORT=55N1 STUDIO_KIT_PORT=55N2
  SHELL_DEMO_PORT=55N3 GPU_PARITY_PORT=55N4` with N your phase number. For runs on the real GPU (`REAL_GPU=1`) take
  the GPU lock: `mkdir <scratchpad>/gpu.lock` (retry until it succeeds), write your phase id into
  `<scratchpad>/gpu.lock/owner`, and always `rm -rf <scratchpad>/gpu.lock` afterwards.
- **Privacy.** The photographer's photos and scans (`.playwright-mcp/photos|scans/`) are never committed, never
  quoted in docs, never sent anywhere. Test material is synthetic.
- **Scope.** Change only the packages your phase owns (listed below) plus the files named in your spec. If you need a
  change elsewhere, write it in your diary under "What should be done in the future" and tell the main agent in your
  final report.
- **Final report** to the main agent: branch and last commit, what is done, what is not, test results (counts),
  known breakage, decisions you made that the design did not, and open questions. Short and factual.

## 2. Branches and worktrees

- Integration branch: `task/chb-037-unified-model`, worktree `<scratchpad>/chb037` (main agent only).
- Phase branch: `task/chb-037-p<id>-<slug>`, created by the main agent from the integration branch, worktree
  `<scratchpad>/chb037-p<id>`. Work only there. Run `pnpm install --frozen-lockfile --prefer-offline` first (add
  `--no-frozen-lockfile` only if your phase adds a package, and say so in the diary).
- `<scratchpad>` = `/private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad`.

## 3. Baseline (integration branch at b3445d3)

typecheck, lint, gen:check green; vitest 105 files, 2797 passed, 19 skipped. Browser suite: ~106 tests, green at
CHB-034 (not rerun here).

## 4. Phases

| Phase | Content (design §) | Owns | Depends on | Wave |
|---|---|---|---|---|
| P0 | Golden pictures of today's pipeline (§36 phase 0, §37) | `tools/goldens/`, `packages/conformance/goldens/` | — | 1 |
| P1 | Builder core: `packages/values` (§30, §24, §26 data layer) | `packages/values/`, `tools/scripts/check-boundaries.ts`, root `package.json`/lockfile for the new package | — | 1 |
| P5a | UI DSL made consistent (§32, CHB-029) | `packages/shell/`, `packages/studio-kit/` (builders, layouts, kits' build code), `apps/studio/src` call sites | P1 | 1b |
| P2 | Contract 1.0: document format 3, stages, laws, masks, links, bindings, one compiler, four mutations (§20–29, §35) + reference engine + mock + conformance | `packages/contract/`, `packages/core/`, `packages/engine-mock/`, `packages/conformance/` | P0, P1 | 2 |
| P3 | GPU: generalised combine with modulators, composite mix and blend, coalesced heal, encodings (§29, §36 phase 3) | `packages/gpu/` | P2 | 3 |
| P4 | One history: document log replaces EditLog and the store's document tier; `Draft` rename; one batch builder (§26) | `packages/contract/src/history*`, `packages/shell/src/core/store*`, studio-kit bridge | P2 | 3 |
| P5b | Stack kit, stage policy pass, layouts and studio on the document (§33) | `packages/studio-kit/`, `apps/studio/` | P2, P4, P5a | 3 |
| P6 | Agent workbench: transaction builders, `wb`, cuts, `h.show` (§34) | `packages/dsl/`, `packages/agent/` | P2, P4, P5b | 4 |
| P7 | Links: look functions, rolls, presets, sync, bake (§27, §28) | contract link resolution (with P2's hooks), `kits/looks`, `kits/roll` | P2, P4 | 4 |
| P8 | Editor lab tools: the composite op set, blend modes, colour-range masks, scene stage, clarity/sharpen in mm (§22 encodings, §23 op table) in core + GPU + stack kit | per op: catalogue, core, gpu, kit panels | P3, P5b | 5 |
| P9 | Integration: full checks incl. browser and `REAL_GPU=1`, persona session (CHB-026) on the arrangements | — | all | 6 |

The main agent details each phase's spec when it launches (below), merges each phase into the integration branch,
runs the checks, and records the merge in the main diary.

## 5. Wave 1 specifications

### P0 — golden pictures

Purpose: an oracle for the cut-off. Before anything is deleted, render today's pipeline on the reference engine
(`packages/core`, f64) for a fixed set of synthetic frames and recipes, at the cuts `print` (after `view.adapt`) and
`display` (after `output.frame`), and store the results so phase P2 can prove its light law reproduces the
darkroom.

- Fixtures: synthetic only (see `tools/fixtures/`, `packages/conformance`), small (e.g. 96 × 64), both source kinds
  (a negative scan and a camera file). Recipes cover: plain print; enlarger time and filtration variations; each
  exposure kind (dodge, burn, flash through base and open, split) with masks of each mask op (gradient, ellipse,
  paint, luminance, and/or/not, feather); density masks (contrast, unsharp); preflash; grade; lights incl. auto;
  retouch heal and clone; dust heal; finishing clarity; crop and orientation. Aim for 30–60 cases; name each by what
  it exercises.
- Store each case as: the recipe JSON, the source fixture reference, and the image at each cut as f32 little-endian
  binary plus a small JSON header (size, domain, channels, stats). Keep the total under ~10 MB.
- Write `tools/goldens/render.ts` (re-render all; `--check` compares against the stored files with a stated
  tolerance and prints per-case max/mean error) and `tools/goldens/README.md` (what is stored, how P2 uses it: P2
  will translate each recipe into a format-3 document by hand or by a one-off script in its own phase, then compare).
- Acceptance: `node tools/goldens/render.ts --check` passes on the integration branch; vitest unaffected.

### P1 — the builder core (`packages/values`)

A dependency-free leaf package, importable by the contract and by the shell (update `check-boundaries.ts`: the
contract may import `@noble/hashes` and `@chromobench/values`; the shell may import `@chromobench/values` and its own
files; `packages/values/src` imports nothing). It provides the value model of design §30 and the data layer of §24
and §26, generic (no image or UI knowledge):

1. **Immutable values.** Deep freeze helpers; structural equality; `canonicalJSON` (stable key order, used for
   hashing by the contract; move or share the contract's existing implementation so there is one).
2. **Modifiers.** `Modifier<T>` = a named, explainable function `T → T`; `modifier(name, fn)`, `m.then(n)`
   (associative), `apply(v, ...ms)`; a mixin or helper that gives a value class `with(m | patch)` returning a new value,
   and lets chain methods be defined as modifiers (so `x.amount(0.8)` ≡ `x.with(amount(0.8))`).
3. **Explain and provenance.** An `explain` protocol (a symbol-keyed method returning a plain, printable structure)
   and call-site capture (`file:line` of the builder call, as `packages/shell/src/ir/node.ts` records `at` today;
   reuse its technique).
4. **Collections.** `Coll<T> = { order: Id[]; items: Record<Id, T> }` with pure helpers (create, get, insert at,
   remove, move, map, iterate in order, ids), nested collections allowed.
5. **Mutations over a JSON document with id-addressed paths.** Four mutations `set(path, value)`,
   `insert(collPath, id, item, at?)`, `remove(id)`, `move(id, { into, at })`; each `apply` returns the new document
   and the exact inverse mutation; ids are unique in a document and found through an index (build once per document
   version); paths may start at an id (`"<id>.params.ev"`) or at the root. Validation is pluggable (a hook the
   contract supplies).
6. **Transactions.** `{ id, label, by: 'user' | 'agent' | 'auto', source, batch?, status: 'applied' | 'pending' |
   'rejected', mutations, inverses }`; apply a transaction atomically (all or nothing), invert it.
- Tests (vitest, `packages/values/test/`): property tests (random documents and mutation sequences: apply then
  inverse restores the document exactly; ids survive `move`; `then` is associative; no method mutates its receiver,
  checked on frozen inputs), plus focused unit tests. Document the API in `packages/values/README.md` with examples.
- Do not change other packages except the boundary script, the root config needed to include the package, and moving
  `canonicalJSON` if you do so (then the contract imports it from values; keep `nodeId` hashes byte-identical:
  conformance and vitest must stay green).

## 6. Wave 2 specifications

P2 is split in two sequential parts so each agent's scope fits: **P2a** (the contract) then **P2b** (the reference
engine, mock, conformance and golden parity). P5a runs in parallel with P2a once P1 is merged.

### P5a — the UI DSL made consistent (design §32, §17; CHB-029)

Owns `packages/shell/`, `packages/studio-kit/` (builders, layouts, kits' build-time code, `cb`), `apps/studio/src`
call sites, `e2e/` specs that name layouts. Behaviour of the studio does not change; its code does.

1. **Immutable builders on `@chromobench/values`**: `ck.shell`, modules, `ck.kit`, the command/menu/tool recorders
   return values; every chain method is a modifier (`with`, `then`, `explain`). No mutable `def` records.
2. **No Proxy recording of unknown methods**: an unknown chain method is a build error with "did you mean"; builder
   fragments and node fragments are registered explicitly (`ck.extend(...)`).
3. **One registration per kind**: kits declare panels, tools, commands, menus and passes; layouts place them by id.
   Remove the command `menu:` field (menus only from `menus`), instance-global `ck.install` (passes only through kits:
   move finish/looks/roll's installs into their kits), `ck.panel` define-by-arity (`ck.panel(id)` is a reference,
   `ck.panel.define(id, props, ...kids)` defines), tools in three places (kits declare; modules and viewports pick
   by id).
4. **Uniform signatures**: containers `(props?, ...children)`, leaves `(value, props?)`, controls one props object
   (`ui.slider({ min, max, … })`); `enabled` + `why` everywhere (no `disabled`); `ck.when(cond, a, b)` always an
   interaction node (build-time choice is plain JS or `.with(when(bool, m))`); `pick` always a selector; remove
   aliases (`stack`, `label`) or keep exactly one name per form.
5. **Scopes by declaration site**: shell keys global, module keys module, kit keys kit; no scope argument.
6. **Typed state and selectors**: per-kit state declared with types; reads through `cb.sel.*`; one `current`.
7. **One kit product shape**: `kit.panels.*`, `kit.modules.*`, `kit.tools`, `kit.commands`, `kit.docs`; layouts
   compose kits only; no layout imports another layout (CHB-029 item 4: `cb.modules.*`, `cb.menus.*`).
8. **Host capabilities** typed at mount; commands declare `requires` (CHB-029 item 1); declarative command tables
   per area (item 3).
9. **Rename variant → layout** everywhere (item 9), including `packages/studio-kit/variants/` → `layouts/` and the
   boundary script.
- Not in P5a: the catalogue's `ui.order`/`advanced` (contract, later), status bar and jobs (CHB-029 items 5, 6:
  only if trivial after the above; otherwise list them as remaining).
- Acceptance: typecheck, lint, gen:check, vitest green; `CI=1 pnpm test:browser` green on SwiftShader (ports 5551–5554);
  explain snapshots updated deliberately (the diary explains each kind of snapshot change); `packages/shell/README`
  or docs describe the rules.

### P2a — contract 1.0 (design §20–29, §35)

Owns `packages/contract/` only. Builds the new model; deletes the old one. Consumers outside the contract break
until their phases; the contract's own tests, typecheck of the contract package and its generated docs must be
green, and the diary lists the consumer breakage.

1. **Document format 3** (`document.ts`): components exactly as design §20 (Op, Mask, Layer, Group, LinkEntry,
   Stage with medium and stack, Document with stages, masks, geometry, output, source), on `Coll` from values. Media
   carry today's fixed settings (§21, §23 table).
2. **Catalogue**: `OpDef` gains `stages` (where an op may live) and `encoding`; ops are renamed/restructured as §23
   requires: darkroom entry ops (`expose`, `burn`, `dodge`, `flash`, `preflash` (verify against today's
   `print.preflash`; keep as medium if it is not added light, and record the finding), `densityMask`, `filter`); a
   generalised combine node for the light law (contributions, modulators, masks; structured args, no JSON strings);
   `heal`/`clone` with structured spot lists (scan and print); `clarity` (radius in mm on the print) replacing
   `finishing.clarity`; mask components and the one algebra (§25: add = max, subtract = a·(1−b), intersect = a·b,
   invert = 1−m), geometry in document pixels, physical sizes in µm/mm; remove `finishing.hue`, `finishing.look`,
   `mask.and/or` (min/max), `scan.heal`/`retouch.heal` JSON forms. The P8 op set (curve, levels, …) is NOT in P2a.
3. **Laws** (§22): `defineLaw` registry; `light`, `composite`, `repair` with their amount, blend, group and order
   rules; coalescing of adjacent coalescible entries (§23); composite needs the mix/blend semantics of Part I §4–6
   as a node (normal blend at least; the full blend-mode set comes in P8).
4. **Compiler** (§29): `compile(doc)` → graph with named cuts (`scan`, `negative`, `scene`, `film`, `darkroom.H`,
   `print`, `finished`, `display`); stage media compile to today's fixed chain; link and binding resolution steps
   with registries and the upstream-only rule enforced (look functions themselves come in P7; P2a provides the hook
   and roll links if simple); structural identities (disabled / amount 0 / identity groups produce no node).
5. **Mutations and validation**: the four mutations from values with the contract's validation hook (ArgSpecs for
   params, law rules, stage acceptance); `vocab.ts` becomes the cut vocabulary; delete `recipe.ts`, `paths.ts`
   (except what moves), the five old mutations, `RECIPE_FIELDS`, `MOVED_PATHS`, migrations. Adapt `editlog.ts`
   minimally to transactions of the four mutations so the contract stays coherent (P4 replaces it).
6. **CONTRACT-DECISIONS.md**: one change note, CC-018 or the next free number, class breaking, contract 1.0; docs
   regenerated (`pnpm gen`).
- Tests: law properties (design §37: light law equals today's `combinePixel` formula for random entries — compute the
  expected value with a small independent implementation in the test; composite identities; coalescing), mask
  algebra laws, validation errors, compile identities, cut addressing.

### P2b — reference engine, mock, conformance, golden parity

Owns `packages/core/`, `packages/engine-mock/`, `packages/conformance/`, `tools/goldens/` (from P0). After P2a:
implement every new or changed op in the f64 reference engine (`packages/core/src/ops/ops.ts` and the print, mask
and retouch modules), the mock engine's pass-throughs, the conformance generator for the new catalogue; translate
P0's golden recipes into format-3 documents (a one-off script in `tools/goldens/`) and make the reference engine
reproduce every golden within P0's tolerance. Acceptance: contract + core + mock + conformance tests green; goldens
check green; the diary lists any golden that legitimately changes (with the physics reason) and every remaining
consumer breakage.
