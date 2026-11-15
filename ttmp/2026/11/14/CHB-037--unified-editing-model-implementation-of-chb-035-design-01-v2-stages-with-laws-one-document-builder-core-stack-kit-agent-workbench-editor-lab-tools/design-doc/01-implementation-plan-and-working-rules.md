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

### Amendments after P0 (main agent, from the P0 report)

- **`output.frame` moves into the reference engine (P2b).** Today it exists only as a host op in the studio's engine
  wrapper (`apps/studio/src/host/studio-engine.ts`), so the goldens' `display` cut depends on an app module. Geometry
  is document-level in v2 (design §20); every engine implements it. After P2b, `tools/goldens/engine.ts` uses the
  reference engine alone.
- **Heal and clarity get real implementations (P2b in core, P3 on the GPU).** No physics engine implements
  `scan.heal` or `finishing.clarity` today (only the mock); their goldens are stored as recipes only. In v2 they are
  the `heal`/`clone` and `clarity` layers and must render.
- **A scan's µm per pixel is explicit (P2a).** The scan medium (or the source facts) carries `umPerPx`; the goldens'
  fixtures have none and today's density masks fall back to `DEFAULT_FILM_UM_PER_PX = 6`. The golden translation
  sets 6 explicitly; nothing in v2 has a hidden default (design §25).
- **Golden translation** follows `tools/goldens/README.md` ("How P2 uses it"): translate each `recipe.json` to a
  format-3 document by the §23 mapping, replace only the compile-and-cut step, keep the stored pictures as the oracle.
  A difference above float rounding is a semantic change to explain, never a reason to widen the tolerance. Masks in
  the recipes are node closures (some embed the fixture hash and, once, the main exposure chain); the translation
  rebuilds them as mask values.

### Amendments after P1 (main agent, from the P1 report)

- **Use the values API as built** (`packages/values/README.md`): `defineValue` for value kinds (chain methods are
  modifiers on the value's data), `Coll.*`, the path grammar (first segment an item id or a root key; `order`/`items`
  never appear in paths; ids may not equal root keys), `applyMutation`/`applyTransaction` with the `validate` and
  `validateTransaction` hooks (per mutation, and per transaction for rules that may break midway such as "exactly one
  main"), `unset` for deleting object keys, normal forms and inverses.
- **P2a**: one error class. Values throws `ValueError` (Diagnostic-shaped); the contract's `ChromobenchError` and
  `toDiagnostic` must treat it as the same thing (make one extend or alias the other; values cannot import the
  contract); add `E_DOCUMENT` to `ERROR_CODES`; `bindArgs` rejects non-finite numbers before they reach
  `canonicalJSON`. Call `libraryRoot(import.meta.url)` in the contract's builder modules so call sites point at the
  caller. The document's rules go into `validate`/`validateTransaction`.
- **P5a**: replace the shell's own `site`/`libraryRoot`/`CallSite` (`packages/shell/src/core/diag.ts`) with the values
  versions (one library-root set); implement node `with` through `toModifier(x, patch).run(node)`; open the
  studio-kit boundary rule to `@chromobench/values`.
- **P4**: a pending transaction is stale when its inverses, recomputed at apply time, differ from the stored ones.
- **Known flake fixed on the integration branch** (e349b96): roll batch ids were `Date.now()` in base 36, so two
  batches in one millisecond collided; ids now carry a counter.

### Amendments after P2a (main agent, from the P2a report)

- The contract is at 1.0 (CC-019; CC-018 belongs to the unmerged export branch). Read
  `packages/contract/CONTRACT-DECISIONS.md` (CC-019), `document.ts`, `stage-laws.ts`, `pixel.ts` (`lightH`,
  `mixPixel`, `maskCombine`: the per-pixel formulas every engine shares) and the P2a diary
  (`diary/05-phase-p2a-contract.md`) before changing an engine.
- Per-package typecheck: `pnpm exec tsc -p packages/<pkg>/tsconfig.json --noEmit` (add a tsconfig for your package
  like the contract's if missing). The full `pnpm typecheck` and `pnpm gen` stay red until P6; generated docs check
  with `node tools/gen-docs/main.ts --contract-only --check`.
- Golden translation rules (P2b): umPerPx 6 and magnification 8; main time, f-stop and filtration into
  `main.params`; lights into `lights.params.logH`, the AutoBalance record into `lights.source`; an exposure without
  time or stops gets the main time; feather mm = px × 48 / 1000 for scans, and for camera files from the paper pitch
  (film 36000 / long side × 8); "luminance of the scan" → `reads: 'source'`, "of the main exposure" →
  `reads: 'darkroom.main'`; or-ed shapes → `add` components. Legitimate golden changes: `neg-burn-and` (min → product,
  design D4) and pixels where H < 1e-8 (the floor moved after the lights). Any other difference is a bug.

### P3 — the GPU engine on contract 1.0 (design §29, §36 phase 3)

Owns `packages/gpu/`. Implement on WebGPU, with parity against the reference engine's formulas (`pixel.ts`; core is
being updated in parallel by P2b — test against the contract's formulas and the conformance cases, and coordinate
through the plan, not by editing core): the generalised `print.combine` (contributions with per-term amount and mask,
density masks, filters, preflash), `composite.mix` (normal blend; exact at amount 0 and 1), `mask.linear`,
`mask.constant`, `mask.combine` (add = max, subtract = a·(1−b), intersect = a·b), `mask.invert`, structured
`mask.paint`, coalesced `heal`/`clone` with structured spots (today no GPU op exists for heal), `clarity` with
`radius_mm` through `umPerPx.paper`, `source.open`'s `umPerPx`, `print.densityMask.gamma`; remove the GPU code of
deleted ops. Pointwise ops stay fused in the pointwise kernel; barriers as design §29 says. Acceptance: gpu unit
tests; the `[gpu-parity]` and `[chromium-webgpu]` browser projects green on SwiftShader (ports 5531–5534) and on the
real GPU with `REAL_GPU=1` (GPU lock); the diary lists what the studio-level browser specs cannot show yet (they need
P5b).

### Amendments after P5a (main agent)

- The UI DSL is now immutable throughout (P5a diary `diary/04-phase-p5a-ui-dsl.md`, `packages/shell/README.md`):
  kits declare commands and tools as tables, layouts place modules and menus, `ck.panel(id)` refers and
  `ck.panel.define` defines, every kit is a product `{ kit, panels, views, modules, menus, keys, sel, lib, tools,
  commands, docs }`, state is read through `cb.sel.*`, host capabilities through `requires` and `ctx.host`,
  `variant` is now `layout` (`?layout=` only). Module props are fixed; a stage declaration needs `ModuleProps`
  extended in the shell or a module fragment via `ck.extend`.
- Remaining CHB-029 items 5 (status bar, dialogs) and 6 (jobs) go to P5b if cheap there; `docs/HANDOFF.md` still says
  `?variant=` (P9 updates the handoff).

### P4 — one history (design §26)

The two histories (the shell store's document-tier patches and the contract's `EditLog`) become one. The shell may
import only `@chromobench/values`, so the generic log lives there.

- **`packages/values`**: a document log over values transactions: applied entries with a cursor (undo, redo; a new
  edit after undo drops what could be redone), proposals (`pending` → `applied` | `rejected`; stale when recomputed
  inverses differ), batches (one batch id across several documents: approve and reject as one; one undo step per
  batch for the user), authors and sources, `why(path)` (which entry last set a path, and from where), drafts for
  gestures (preview without logging, commit as one transaction of the net change), serialisation of the log. One
  batch builder `plan(targets, (doc) => transaction)` for looks, rolls, sync and agents. Property tests.
- **`packages/contract`**: delete `EditLog`; the document's log is the values log with `DOCUMENT_RULES` as its
  validator; keep `edit()`.
- **`packages/shell`**: the store's document tier is the values log (the shell's own patch history for the document
  tier goes); view and preview tiers stay; the preview type `Layer` is renamed `Draft`; gesture preview/commit maps
  onto drafts.
- Not in P4: the studio-kit bridge (`editlog-route.ts`) and every studio-kit/app consumer — P5b rewires them.
- Acceptance: values, contract and shell typecheck and vitest green; the diary describes the API P5b and P6 use.

### Amendments after P3 and P4 (main agent)

- **History (P4)**: `Log` in `@chromobench/values` (diary `08-phase-p4-history.md` Step 5 has every signature);
  `LOG_RULES` in the contract; the shell store's document tier is `store.log` (`store.open/close`, `store.change`,
  `k.mount(prefix, { keyDepth, kind })`, `ctx.draft`, `ctx.log`; `Layer` → `Draft`; state is deep-frozen). Batches:
  `plan(targets, fn, meta)`; agents propose, users commit; `why`/`trail` for provenance.
- **GPU (P3)**: on contract 1.0, parity 47/47 on SwiftShader and Metal. Known gaps: `output.frame` has no GPU
  implementation (the studio's host wrapper or P8 covers the `display` cut on the GPU); **tiled export with spatial
  ops is wrong at tile borders** (`planFor` declares no kernels: density masks, feathers, clarity computed per tile) —
  a correctness bug for P8; `composite.mix` is normal-only and a barrier.

## 7. Wave 3 specifications

### P5b-1 — the studio on the document and the log

Owns `packages/studio-kit/`, `apps/studio/`, `packages/output/`, `packages/ingest/`, `e2e/`. Bring every consumer of
the old recipe and the two old histories onto document format 3 and the values log, with today's features: the
store's `k.mount('recipes', { keyDepth: 1, kind: 'frame' })` (rename to `docs` if cleaner) and `store.open` per frame;
`LOG_RULES` at `app.start`; delete `editlog-route.ts`, `StudioLog`, the roll `buildBatch` and the looks `planApply`
batching in favour of `plan`; the first print (`apps/studio/src/host/first-print.ts`) on cuts (`darkroom.H`) and
`bakeLights(doc)`; `StudioEngine` (keep the host `output.frame` for the GPU's `display` cut until P8); controls from
the catalogue on document paths (`argPath` is gone: controls address `<entryId>.params.<arg>` and media paths);
ingest's dust detection produces heal layers with an explicit `src`; output's export on documents
(`documentSha256`). Hard cut-off: stored studio state of the old format is cleared once with a clear message.
Acceptance: typecheck of these packages, vitest, lint, `pnpm gen:check` for the studio-kit docs, and the browser
suite green headless on SwiftShader (ports 5561–5564; the `[chromium-webgpu]` studio specs exercise the new GPU ops
end to end) — the diary lists any spec that changed and why. The stack kit is NOT in P5b-1.

### P6a — the agent's DSL and the agent on contract 1.0 and the log

Owns `packages/dsl/`, `packages/agent/`. Bring the DSL and the agent onto the document, cuts and the log: frame
handles address cuts (`frame.cut('print')`, `frame.print()` as the `print` cut, `frame.finished()`, `frame.display()`);
`printChain` is deleted and every what-if is `compile(edit(doc, tx).doc)` or `log.draft(f).apply(...).value`;
edits are built with the values/contract builders (layers, groups, masks as values; `insert`, `set`, `remove`, `move`)
and proposed (`log.propose`, batches via `plan`); `EvalResult.transactions`; `h.look()` → `h.show()` (one meaning of
"look"); named looks stay as they are until P7 makes them links; delete `MirrorLog`. Regenerate the DSL reference
(`pnpm gen`; the full run works once dsl and agent compile). Acceptance: dsl and agent typecheck and vitest green;
`pnpm gen:check` green; the agent examples rewritten. The workbench surface `wb` (commands, state, layouts, screen) is
P6b, after P5b.

### Amendments after P6a (main agent)

- The DSL (diary `10-phase-p6a-dsl.md`): cuts as handles (`frame.print()`, `frame.cut(name)`, …), what-ifs
  `frame.with(change).print()`, builders `layer/group/mask/coll`, changes `set/insert/remove/move` (several = an
  array), `frame.propose(changes, { why })` → one log submission per eval (ask proposes, auto commits, read-only
  refused; an auto edit whose document changed during the eval becomes a proposal with a CONFLICT warning),
  `h.show()`. The session's host is a log (`DslSessionOptions.history`).
- **For P6b**: rename the contract's eval `Look`, `EvalResult.looks`, `EVAL_LIMITS.looks` and the `LOOKS` warning to
  "show" words (contract + dsl + agent + chat consumers); add `log.commit(x, { why })` in values (today `source.why`);
  consider a lighter worker snapshot than `Log.load` per change for long sessions; `wb` as one more prelude global
  with natives in `host/`, layouts crossing the sandbox as data (`mkValue` pattern).
- **For P7**: the DSL compiles without a LinkContext (roll/look links fail with E_LINK there); measuring bindings need
  the async `compileMeasured` while DSL cuts are synchronous; named looks should become link inserts and
  `LooksProvider` go.

### P8a — Editor lab's tools in the engine: the composite op set, blend modes, encodings, colour masks

Owns `packages/contract/src/catalog/` and the composite law's blend handling, `packages/core/`, `packages/gpu/`,
`tools/goldens/` (new golden stacks). Not the UI (the stack kit's panels come in P5b-2/P8b). Design §22
(encodings), §23 (the op table), Part I §4–§7 (adjustment layers, blend modes, groups, masks), v1/v2 Editor lab
analysis (Part II §9–§13: what to reuse and its defects — do not import them: the curve that adds contrast for
negative values, sRGB arithmetic).

- **Ops** (stages scene and print unless noted; each with ArgSpecs and units, `encoding`, `identity`, class):
  `curve` (monotone cubic through control points, OkLab L or per channel; LUT on the GPU), `levels` (black, white,
  gamma, output range, per channel), `exposure` (EV, offset; linear), `hsl` (per band hue/sat/lightness with band
  widths; OkLCh), `vibrance` (chroma-weighted; OkLCh), `grade` (shadow/midtone/highlight wheels and balance; OkLab),
  `mixer` (3×3, monochrome; linear), `vignette` (amount, size, feather; positional, linear), `sharpen` (amount,
  radius in mm on the print; spatial) beside the existing `clarity`; mask component `colour` (OkLab ΔE, tolerance,
  softness) and `radial` if not present.
- **Blend modes**: the W3C compositing set (normal, multiply, screen, overlay, darken, lighten, colour dodge, colour
  burn, hard light, soft light, difference, exclusion, hue, saturation, colour, luminosity) in the composite law;
  separable modes in linear light, the non-separable ones with luminance defined in the working space (design §22);
  isolated groups with a blend.
- **Encodings**: linear ↔ OkLab conversions inserted by the compiler where adjacent ops differ; adjacent ops in one
  encoding fuse without converting back (GPU: in the pointwise kernel; `composite.mix` and pointwise layers fuse
  where possible rather than each being a barrier).
- **The scene stage** compiles for camera files (layers before `capture.expose`), with masks reading the scene.
- **Parity**: each op a conformance case, a reference implementation in core (f64) and a GPU implementation with
  parity (SwiftShader and Metal under the GPU lock); laws: identity at amount 0 and at identity params; blend-mode
  identities (normal at opacity 1 = source; multiply by white = backdrop; screen by black = backdrop); curve
  monotonicity; golden stacks for a few combined documents.
- Acceptance: contract, core, gpu typecheck and vitest; conformance; goldens (old 60 unchanged plus the new stacks);
  `[gpu-parity]` green on SwiftShader and Metal; lint; generated docs (`pnpm gen:check`).

### Amendments after P5b-1 (main agent)

- The studio runs on documents and the log (diary `09-phase-p5b1-studio.md`): frames mounted at `docs.<frame>`
  (`k.mount('docs', { keyDepth: 1, kind: 'frame' })`), `model/doc.ts` (`entriesOf`, `storePath`, `newDarkroomLayer`,
  `withoutInert`, `exposureStep`), `maskedLayer`, the Exposures panel is the darkroom stack, retouch and dust are
  groups (`retouch`, `dust`), frame handles name cuts, `ui.log` publishes proposals, `Studio.propose/approve/
  approveBatch/reject/jump`. Gotcha: `edit()` on a document read through the store's read-only proxy throws; `strip`
  it first.
- Integration branch at this point: typecheck 0 errors, lint, gen:check (26), vitest 124 files / 2935 passed,
  goldens 60/60; browser (on the P5b-1 branch) 113 passed, 1 skipped (bench), 1 load-dependent gpu-parity timeout.
- Queued for a GPU/performance phase after P8a (core and gpu are P8a's now): the reference engine renders the
  1024×683 test negative's screen view in ~4.2 s in the worker (find whether the tabulated preview path was lost);
  GPU `output.frame`; GPU tiled export wrong at tile borders for spatial ops; the load-dependent `film.spec.ts`
  parity timeout.

## 8. Wave 4 specifications

### P5b-2 — the stack kit, the stage policy pass, the arrangements (design §33)

Owns `packages/studio-kit/` (except `kits/looks/` and `kits/roll/`, which are P7's), `apps/studio/`, `e2e/`, and in
`packages/shell` only what a module's stage declaration needs (`ModuleProps.stages`, or a module fragment).

- **`cb.kits.stack`**, a kit product generic over stages: `panels.layers(stage, { row, order, filter, density,
  title })` (rows, groups, drag into and out of groups, enable, amount with the law's unit hint, blend when the law
  allows, mask chip, provenance chip from `log.why`), `panels.params()` (the selected entry's controls from the
  catalogue, an "Advanced" disclosure if the catalogue marks args advanced), `panels.masks()` (components, the one
  algebra, what the mask reads), the "+ Layer" menu from the catalogue (`opsForStage`), mask tools (linear, radial,
  paint, luminance, colour), commands as a table (add, duplicate, delete, rename, group, ungroup, move, toggle,
  amount, blend, attach/detach mask), all as transactions through the log.
- **Specialised views** (design §33): the darkroom's Enlarger panel = the main exposure's controls plus filters as
  rows (θ per item; order by kind — the light law is order-free); the finish view = retouch and clarity on the print
  stack; the Exposures panel becomes the darkroom stack view. One look and feel everywhere.
- **The stage policy pass** replaces CB-F101 (and v1's CB-E101): modules declare their stages, controls know their
  op's stages from the catalogue, the pass warns when a module shows a stage it does not declare.
- **Arrangements** (design §33): the classic layout gains an Edit module (print stack); the darkroom arrangement with
  a collapsible digital palette (darkroom + print stages, labelled zones); a Scene module for camera files (scene
  stage) — enabled once P8a's scene-stage ops exist (merge the integration branch when P8a lands, or build it so it
  appears when the catalogue has scene ops).
- **The two behaviour fixes P5b-1 decided** (diary 09, last report): (1) library membership stays view tier, the
  photographer's ratings (flag, stars, colour label, keywords) move to a document-tier record keyed by frame id so a
  mis-rating is one undo step (`sel.library`/`sel.entry` merge both); (2) the History panel's jump asks before
  crossing other frames' later steps ("This also undoes N later changes on <frames>"), marks this frame's steps that
  sit under other frames' later steps.
- If cheap: CHB-029 items 5 (status bar, dialogs from DSL pieces) and 6 (jobs).
- Acceptance: typecheck, lint, gen:check, vitest, the browser suite headless on SwiftShader (ports 5571–5574) incl.
  new specs for the stack panel (add a curve-free layer kind available now, e.g. a darkroom burn or a print clarity;
  group, fade, mask, undo) and the arrangements; explain snapshots per layout updated deliberately.

### P7 — links: looks, rolls, presets, sync (design §27–§28)

Owns the contract's link resolution (`packages/contract/src/links*` and its registry; P8a is in the catalogue and the
composite law — coordinate through merges), `packages/studio-kit/kits/looks/`, `packages/studio-kit/kits/roll/`, and
the looks/roll parts of `packages/dsl` (the `LooksProvider`, named looks).

- **Look functions**: registered, versioned, pure `(params, facts) → Group` (per stage; a look may touch several
  stages); built-in looks rewritten as look functions returning groups (darkroom looks as filter/burn layers, print
  looks as print layers); `*.cblook.js` evaluated in the QuickJS sandbox if cheap (else record as remaining).
- **Link entries** expand at compile (the contract's resolvers): `{ look, version }` with params and an amount (the
  stage law's amount); "bake" turns a link into its plain group with the source recorded.
- **Rolls**: the roll record holds partial media and stacks; frames' media link to the roll; per-frame changes are
  overrides; divergence = the overrides; the roll kit on links (first print per roll, match, alpha) — replace the
  roll `fragment` copies.
- **Presets** = looks without parameters; **sync** = copy values or insert the same link (the user chooses; the UI
  says which); one batch per apply through `plan`.
- **DSL**: named looks become link inserts; `LooksProvider` goes; the DSL compiles with a LinkContext.
- Acceptance: contract, studio-kit (looks, roll), dsl typecheck and vitest; looks and roll browser specs; one-step
  undo of a look over a roll; lint; gen:check.
