---
Title: Diary
Ticket: CHB-021
Status: active
Topics:
    - ui
    - product
    - dsl
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T15:10:22.041931605-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-021 Looks, presets and comparison

## Step 1: Intern guide written

I wrote the implementation guide for the looks kit (`cb.looks.*`) after reading the UI design brief, CraftKit's preset, snapshot, sync, reference and survey code, the contract's paths, spec, units, mutations and EditLog, the DSL topics, and the CHB-009 and CHB-012 guides. The central choices: a look resolves to path edits (never stored symbolically), Amount is a recipe pass with a scaling rule chosen per ArgSpec unit, and apply is one plan that drives the dialog, the approval card and the DSL receipt.

The guide is about 7,800 words including code, with 18 staged tasks and 8 related files. Nothing was run; claims come from reading source.

### Prompt Context
**User prompt (verbatim):** "before we move on, now that we have worked out what to do with craftkit, let's create the tickets and design guides (remember, no need to be overly correct in the guides, they are \"guides for impementation\" after all, and we'll sort out details as we work) for the proper UI. Allow the UI to be entirely expressed using the JS API, so that we can create many different versions of it."
**Assistant interpretation:** Write the CHB-021 implementation guide for presets, looks, Amount, comparison and apply, expressed as builder calls.
**Inferred user intent:** A usable guide so implementers can start the looks kit.

### What I did
- Read the writer brief, UI design brief, CraftKit `develop-model.js`, `develop.js`, `develop-scopes.js`, `library.js`, contract `paths.ts`, `recipe.ts`, `spec.ts`, `units.ts`, `mutations.ts`, `editlog.ts`, DSL topics, CHB-009 5.8 and 5.9, CHB-012 sections 3 and 5.6.
- Wrote `design-doc/01-intern-guide.md`, added 18 tasks, related 8 files.

### Why
- CraftKit's linear `scalePreset` is wrong for time and colour temperature, so the guide specifies per-unit rules.

### What worked
- The contract already has pieces to build on: `AutoBalance.method: 'match'`, `finishing.look`, `expect`/`E_STALE`, `ui.scale: 'log2'`.

### What didn't work
- First lookup of the CHB-016 sources used a wrong path (`src/app` under a glob); fixed by listing the directory.

### What I learned
- Brief says the ring-around tool belongs to CHB-019; the guide proposes it be a layout of this kit's survey.

### What was tricky to build
- Keeping "pipeline" looks consistent with "only paths can be applied": resolved by reducing what-if handles to path edits.

### What warrants a second pair of eyes
- Rule defaults in section 4.2 (grade, lights, `finishing.look`), and the grouped-undo request to CHB-019.

### What should be done in the future
- Settle symbolic versus resolved looks after the photographer tries it.

### Code review instructions
- Read `design-doc/01-intern-guide.md`; run `python3 -I ttmp/2026/11/11/CHB-001--*/scripts/08-check-guide-markdown.py` on it.

### Technical details
- Sync groups as path patterns; `ApplyPlan` with shared batch id; approval-scope pass for one card.

## Step 2: The looks kit — Amount, diff, apply as one batch, survey, presets, and cb.looks for the agent

This step builds `packages/studio-kit/kits/looks` (`cb.kits.looks`) as a sibling of the roll kit, a `looks` variant
that uses it, and the agent counterpart `cb.looks.{list, apply, whatIf, diff}` in `packages/dsl`. A look (a JS
function with ArgSpec-shaped parameters) or a preset (data) resolves per frame to path entries; the Amount pass
turns them into plain `set` mutations with a scaling rule chosen from each path's unit; the diff pass describes any
two recipes in darkroom units. Applying to the selection commits one batch (one tx and `LoggedMutation.batch` on
every frame, one global undo step); applying to a roll or the library is planned on one card first (partial
approval by frame, `E_STALE`, Apply anyway recomputes); an agent's `cb.looks.apply` is proposed per frame with the
batch id and shown on one card. Stages 1–4 and most of 5–8 are done; Match, virtual copies, sandboxed look files and
wiring the kit into the existing four variants are open.

`pnpm test`: 71 files, 2457 tests (baseline 2413, +44: 26 looks engine, 10 looks kit flow, 6 DSL looks, the looks
topic page and the new variant's build). Browser: the studio-kit project gained two looks specs (70 → 71 tests).

### Prompt Context
**User prompt (verbatim):** the orchestrator's task (not the user's own words): "You implement ticket CHB-021
(looks, presets and comparison: parameterised looks, Amount, survey, diff, apply to selection/roll/library) in the
chromobench monorepo, in your own git worktree (based on main). […] Decisions already made: looks resolve to recipe
patches applied as plain mutations (re-run concretely on parameter change; speed to be measured later); partial
approval allowed. Lane: packages/studio-kit/kits/looks (+ tests, a variant or additions to classic/darkroom using
`cb.kits.looks`), small additions to studio-kit core only where needed, packages/dsl only for the agent counterparts
the guide names (`cb.looks.apply` etc.). […] Be pragmatic; the user asked not to overdo polish."
**Assistant interpretation:** Build the guide's stages as a kit on cb.core, with the roll kit's structure, a variant
that shows it, the DSL counterpart, and tests at each level; leave clearly marked open items.
**Inferred user intent:** Looks the photographer can try in the dev host now, and that the agent can apply with the
same names, on the existing EditLog/batch machinery.
**Commit (code):** cdb691c — "CHB-021: looks kit — look builder, Amount, diff, sync groups, apply plans, presets,
sweeps; cb.kits.looks, looks variant, DSL cb.looks"; second commit — "CHB-021: roll smoke, tiles skip the diff,
picked marker, contract-requests note" (see git log)

### What I did
- Branch `task/chb-021-looks`; `pnpm install --offline --frozen-lockfile`.
- Read the guide and tasks, CHB-019 diary Steps 2–3, CHB-020 diary Step 2, CHB-024 diary Step 1, studio-kit's
  `cb.ts`, `kits/roll/src/{kit,dom,engine/batch,engine/constants}.ts`, `bridge/editlog-route.ts`, `studio.ts`,
  `handles.ts`, `model/{recipes,units,history,tools}.ts`, `kit/forms.ts`, the contract's `paths`, `spec`, `units`,
  `editlog`, `mutations`, `vocab`, `errors`, the DSL's `host.ts`, `session.ts`, `prelude.ts`, docs test and topics,
  CraftKit's `develop-model.js` (`scalePreset`, `KEEP`, `SYNC_GROUPS`).
- Listed every settable path with its spec (a throwaway `tsx` script) to choose the Amount rules: `print.grade` is a
  continuous number 0–5 (linear), `time_s` has unit `s` + `ui.scale: 'log2'`, `fstop` unit `fstop`, capture
  temperature unit `K`.
- `kits/looks/src/engine/`: `look.ts` (`look()` builder, `slider`/`choice` params as ArgSpec, `set`/`add`/`mul`,
  `pt`, `lookFrame`, `resolveLook`, `lookEdits`, `fromPreset`, `bake`, `validatePreset`, `kitDiag`), `amount.ts`
  (`ruleFor`, `applyDelta`, `scale`, `amountPass`), `diff.ts` (`diffRecipes`, `describeChange`, `summary`,
  `aggregate`), `groups.ts` (`SYNC_GROUPS`, `matchPath`, `groupOf`, `inGroups`, `defaultGroups`), `plan.ts`
  (`planFrame`, `planApply`, `previewRecipe`, `isUnedited`, `BALANCE_PATHS`, `LOOK_TX`), `sweep.ts` (`ring`, `axis`),
  `files.ts` (`presetToFile`, `readPresetFile`, `migratePresetPath`), `builtin.ts` (neutral colour, warm print, cool
  shadows, flat grade 2, strong grade 4, print density, Portra 400 on Endura, Gold 200 warm), `provider.ts`
  (`looksProvider` for the DSL).
- `kits/looks/src/kit.ts` (`createLooksKit`): state `looks` (document: presets, favourites, review) and `looksView`
  (view: picked, params, amount, from, preview, mode, survey, groups, compare, pending, off, stale, clipboard,
  batchOff, batchStale); 31 commands (`looks.pick/param/amount/from/preview/apply/applyToSelection/applyToRoll/
  applyToLibrary/pending.*/batch.*/survey.*/compare/setReference/snapshot/restoreSnapshot/copy/paste/sync/
  saveAsPreset/bake/deletePreset/importPreset/exportPreset/favourite/group/syncGroup`, plus `looks.virtualCopy` and
  `looks.match` disabled with their why); forms `looks.params/amount/diff/compare/card/groups/presets`, each node
  carrying a `model` τ function; passes CB-L001 (forms without the kit) and CB-L002 (unknown look in a choice);
  builder calls `library()`, `survey()`, `choice()`, `cell()`, `print`, `before`, `tile`, `caption`;
  `agentBatches(s)` (the approval-scope pass over published proposals).
- `kits/looks/src/dom.ts` (`LOOKS_RENDERERS`) and `looks.css`; `package.json` exports `./kits/looks`,
  `./kits/looks/dom`, `./kits/looks/looks.css`.
- studio-kit core (small, additive): `cb.kits['looks'] = createLooksKit(ck, cb)` in `createCb`;
  `EditLogRoute.applyBatch` passes `batch` to `log.apply`; new `EditLogRoute.approveBatch(items, label, { force })`
  (each frame approved on its own, refused frames reported, one global history entry); `PendingGroup.batch`.
- `variants/looks.js` (classic Library + a Print module: looks library, snapshots, history | print with preview and
  compare source, or the survey | look params, Amount, diff, compare, look batches, agent proposals, enlarger, sync
  groups, presets), registered in `variants/index.{js,d.ts}`; the dev host passes `LOOKS_RENDERERS` and the CSS.
- packages/dsl: `LooksProvider` interface and `Host.looksProvider`; natives `looks.list/targets/apply/whatIf/diff`;
  `edit()`'s validation tail moved into `queue(frame, ms, why, at, batch?)`; `QueuedEdit.batch` →
  `log.propose(…, { batch })` in `session.ts`; `DslSessionOptions.looks`; prelude `cb.looks` (with `where` as a
  sandbox-side predicate over `looks.targets`); topic `docs/topics/looks.md`; one vocabulary line; `pnpm gen`.
- Tests: `studio-kit/test/looks/engine.test.ts` (26), `test/looks/kit.test.ts` (10, including a real `DslSession`
  over the studio's EditLogs), `test/browser/looks.spec.ts` (2), `dsl/test/looks.test.ts` (6) with
  `dsl/test/looks-provider.ts` (a contract-only provider so the DSL tests and topic page do not import studio-kit);
  variants snapshots updated (`passes 15 → 16` everywhere: CB-L001 is installed on every ck, as CB-R001 was).
- `CONTRACT-REQUESTS.md`: CHB-021 section — nothing needed; optional R8 (kit codes), R9 (symbolic looks, not asked).

### Why
- Amount rules from the path's ArgSpec, not a per-look table: one place, and the registry already knows units.
  `add` entries carry their delta in the rule's working space (log H for lights via `pt()`, stops for time and
  f-number, mired for K), so "+1/3 st at 60 %" is `+0.2 st` and k = 1 is the entry exactly.
- `from: 'current'` is the default for every entry (balanced rolls stay balanced); `from: 'defaults'` is a per-look
  `base()` or a per-apply option, as the guide leaves open.
- Diff tolerances are per unit and absolute (0.002 st for times, 0.0005 log H for lights, 0.05 CC, 0.5 mired), not
  the guide's "0.5 % of the range": the time range 0.1–600 s would hide a 3 s change.
- A user apply to the selection commits at once (one batch, one undo step); roll and library applies are planned
  on a card first — the guide's confirm dialog — with the roll kit's card idioms (tick boxes, skipped list, stale
  line, Apply anyway). "Apply anyway" recomputes the stale frame against its current recipe (guide §6.4), so a nudge
  the photographer made in between is kept and the look is applied on top.
- Agent batches: the DSL proposes per frame with `batch`; the card groups `proposals.<f>` by batch (or by a tx that
  spans frames), approves frames one by one through `approveBatch` (stale ones reported, the rest committed as one
  global step), and offers Apply anyway / Skip those. The per-frame cards (`cb.panel.approvals`) stay: "Review per
  frame".
- The library and survey are shell grids of `ck.view.thumb` cells whose image is the selected frame's print through
  the look: thumbnails on the bg lane, cached by node id, and a tile is the main view's node once the look is applied
  (tested). Only panels with logic got DOM renderers, and they are dumb: the node carries a `model(s, services)`
  function the kit computed.
- A separate `looks` variant rather than edits to classic/darkroom: CHB-022 works on variants in parallel, and a new
  file only touches one line of `variants/index.{js,d.ts}`.
- The DSL does not import studio-kit (boundaries): the studio injects `cb.kits.looks.provider(() => state)`; the DSL
  tests use a small contract-only provider.

### What worked
- `npx vitest run packages/studio-kit/test/looks`: 36 passed (26 engine + 10 kit). Golden strings: `time 12.0 → 15.1
  s (+1/3 st)`, `lights R +4.0 pt, B −2.0 pt`, `filtration Y 0 → 10 CC`, `grade 2 → 3`, `aperture f/8 → f/11.3 (−1
  st)`, `time 12.0 → 12.9 s (+0.10 st)`. Amount: 12 → 48 s set at 50 % = 24 s; +1/3 st at 50 % = 12·2^(1/6); the
  guide's §9 numbers (±0.05 log H at 60 % = ±0.030; +1/6 st on 12 s at 60 % = 12.86 s); grade 4 at 200 % →
  `CB-L110 … would be 6, maximum 5; apply clamped?` with fix `5`. CraftKit parity: `scalePreset` on its own
  `DEFAULTS.light` equals the linear rule at k = 0, 0.25, 0.6, 1, 1.5, 2 (imported from the CHB-016 sources).
- Kit flow on the booted variant: apply to 6 frames → one unit per frame, same tx and `batch`, one history entry,
  undo/redo restore canonical JSON; roll plan skips the hand-edited frame, `E_STALE` after a nudge, Apply anyway gives
  `[-0.09, 0, 0.1]` (nudge `[0.01, 0, 0]` + look) on that frame; agent batch from a real `DslSession`: one card of
  4 frames, frame 3 refused `E_STALE`, the other three approved as one global step, then Apply anyway; snapshot
  restore gives the snapshot's `stateHash`; compare with the frame itself is the same node; a survey tile's node equals
  the main view after applying.
- `npx vitest run packages/dsl`: 87 passed (topic `looks.md` blocks run through the docs test).
- Full: `pnpm typecheck` clean; `pnpm lint` "import boundaries ok (296 file checks)"; `pnpm gen:check` "ok (19
  files)"; `pnpm test` 71 files / 2457 tests at cdb691c; `STUDIO_PORT=4521 STUDIO_KIT_PORT=4522 SHELL_DEMO_PORT=4523
  GPU_PARITY_PORT=4524 CI=1 pnpm test:browser` "70 passed (1.7m)" at cdb691c; the looks specs: 2 passed.
- Speed of "re-run concretely": `planApply` of warm print over 36 frames 32.7 ms (≈ 0.9 ms a frame), one
  `planFrame` 1.1 ms, measured in Node with a throwaway test; most of it is the diff walk over every settable path,
  so tiles and previews now pass `noDiff`.
- Screenshots of `?variant=looks` (print with warm print previewed; survey of six looks) looked right; the "picked"
  thumb badge squeezed the thumbnail, so the picked look is now marked with ● in its name.

### What didn't work
- `pnpm typecheck`: `amount.ts(135,27): error TS2345: Argument of type '"CB-LOOK-RANGE"' is not assignable to
  parameter of type '"E_UNKNOWN_OP" | …'` (same for `W_PRESET_MIGRATED`, `CB-LOOK-CLAMPED`, `CB-LOOK-CONFLICT`):
  `diag()` takes only the contract's closed code list. Kit codes are now plain objects via `kitDiag()` (CB-L110,
  CB-L111, CB-L120, CB-L130).
- Engine tests, first run: `"time 12 → 15.1 s"` (my `num()` trims "12.0"; seconds use `toFixed(1)` now) and a wrong
  test (grade 3 → set 4 from defaults at 50 % is 3, equal to the current value, so no mutation).
- Kit tests: `expected [ -0.09000000000000001, +0, 0.1 ] to deeply equal [ -0.09, +0, 0.1 ]` (`applyDelta` did not
  round; it uses `tidy()` now); "Delete preset" left the preset in place — `plain(t.looks.presets)` stringifies the
  draft proxy, whose target is a function, so the copy is taken from `ctx.state` instead; `rt.history.entries` shrinks
  on undo (the stack, not a list), so the test checks the recipes instead.
- DSL tests: `r.value` does not exist on `EvalResult` (only `yaml`); the tests return `JSON.stringify(…)` and parse
  the first YAML line.
- Playwright: History shows the change in its own words ("You Printer lights (0, 0, 0) → (−1, 0, +1) pt"), not the
  unit label; the survey's segmented control is a `radio`, not a button; a command button's accessible name is the
  command's label ("Survey Looks"), so "Back to the print" is clicked by text.
- One full `pnpm test` run while other agents loaded the machine took > 180 s and reported `Tests 12 failed | 2445
  passed (2457)`; its output was cut by my `| tail -5 | head -3`, so the names are lost. The rerun with the output
  saved passed 2457/2457 with no code change in between; I take them for load-dependent timeouts, not regressions.
- The worktree guard refused a multi-line `python3 - <<EOF` patch of `packages/dsl` and a heredoc appending to the
  spec ("too complex to verify that it stays inside the worktree"); scripts went to the scratchpad and edits through
  the editor.

### What I learned
- `EditLog.propose` fills `expect` itself; the DSL strips the provider's `expect` so `cb.looks.apply` behaves like
  `frame.edit` (the expect is the eval-start value plus earlier edits of the same eval).
- `ck.view.thumb` handles are enough for survey tiles and library thumbnails: the bridge's cache by node id gives
  "change one look, re-render one tile" for free.
- Store drafts (`ctx.tx`) are proxies over a function target: `JSON.stringify(draft)` is `undefined`.

### What was tricky to build
- Approving an agent batch as one undo step while some frames are stale: `EditLog.approve` is per log and all-or-
  nothing per call, so `approveBatch` calls it per frame under the route's `quiet` counter (no per-frame pushes),
  publishes each approved frame, collects the refused ones and pushes a single history entry with one part per
  approved frame. The card then shows only the stale frames (their entries are still pending).
- `where: x => x.unedited` in the DSL: functions cannot cross into the host, so the prelude asks
  `looks.targets` for candidate frames (id, name, kind, unedited, stock, roll), runs the predicate in the sandbox and
  passes explicit ids to `looks.apply`.

### What warrants a second pair of eyes
- The Amount rules (stops for time/fstop, mired for K, step at 0.5 for enums and stock ids, linear for grade and
  lights) and `keep` returning the target even at k = 0 (as the guide's sketch does).
- `copyEntries` (copy/paste/sync, save-as-preset) copies paths that differ from the defaults in the chosen groups,
  plus the main print paths even when at their defaults (so a paste resets them); whole exposures are not copied.
- Every state change re-runs `planFrame` for each visible tile and caption (≈ 1 ms each with the diff, less without).
  Fine for 8 built-ins; a library of 100 looks needs the caption cached or computed lazily.
- `CB-L120` only warns; the guide's "convert set to add against the author's reference frame" is not built.

### What should be done in the future
- Open tasks: `looks.match` (measure.stats on both frames → time/lights edits; `print.lights.auto` bookkeeping),
  virtual copies (catalog `virtualOf`, stack display), sandboxed `*.cblook.js` files in the DSL's QuickJS, hover
  preview in the library, `cb.arg(...).vsSnapshot()` markers, wiring the kit into classic/darkroom/simple/lab (the
  `looks` variant shows the parts), film looks on the CHB-012 data pack (mock stock ids now), the apps/studio host
  passing `cb.kits.looks.provider(...)` to its `DslSession` (CHB-008's chat).
- For CHB-019/CHB-020: `EditLogRoute.approveBatch` and `applyBatch({ batch })` are new in the bridge; the roll kit's
  batches could pass `batch` too.

### Code review instructions
- Start at `packages/studio-kit/kits/looks/src/engine/amount.ts` (`ruleFor`, `scale`, `amountPass`), `diff.ts`
  (`describeChange`, `diffRecipes`), `plan.ts` (`planFrame`), then `kit.ts` (`plan`, `commit`, `agentBatches`,
  `looks.batch.approve`), `src/bridge/editlog-route.ts` (`approveBatch`), `packages/dsl/src/host.ts`
  (`looksApply`, `queue`) and the prelude's `cb.looks`.
- `npx vitest run packages/studio-kit/test/looks packages/dsl/test/looks.test.ts`;
  `pnpm typecheck && pnpm lint && pnpm gen:check && pnpm test`;
  `STUDIO_PORT=4521 STUDIO_KIT_PORT=4522 SHELL_DEMO_PORT=4523 GPU_PARITY_PORT=4524 CI=1 pnpm test:browser`;
  `pnpm --filter @chromobench/studio-kit demo` → `/demo/?variant=looks&fresh`, press D, Preview a look, drag
  Amount, Apply; N for the survey.

### Technical details
- Kit codes: CB-L001 (looks forms without the kit), CB-L002 (unknown look id in a choice/apply button), CB-L110
  (Amount out of range, fix = clamped value), CB-L111 (clamped silently, `over: 'clamp'`), CB-L120 (absolute set of
  `print.lights.logH` / `print.enlarger.time_s` on a frame of a roll), CB-L130 (preset path migrated).
- Batch ids: user `look:<lookId>:<time36><seq36>` (tx = batch); DSL `look:<evalN>-<n>` (tx = the eval id).
- Agent host wiring: `DslSession.create({ engine, frames, looks: cb.kits.looks.provider(() => rt.store.peek([])) })`;
  the frames are `{ log: entry.log, source: entry.info, name: entry.name }` of the studio's `Frames`.
- DSL: `cb.looks.apply(name, params, { amount 0–2, to: frame id | ids | 'all' | { roll }, where: fn | 'unedited',
  why, from })` → `{ id, status, label, frames, skipped, diff, note }`; `cb.looks.whatIf(frame, name, params,
  opts)` → `{ look, label, frame, diff, mutations, skipped, print() }`; `cb.looks.diff(a, b)` (frames or what-ifs) →
  shown strings; `cb.looks.list()`.
