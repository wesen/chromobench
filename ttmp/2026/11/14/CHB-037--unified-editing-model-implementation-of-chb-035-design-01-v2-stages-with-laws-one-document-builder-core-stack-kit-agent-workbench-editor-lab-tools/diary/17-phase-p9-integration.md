---
Title: Diary — phase P9 integration
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
    - Path: repo://apps/studio/src/main.ts
      Note: agent layouts and looks kept in the KV
    - Path: repo://docs/HANDOFF.md
      Note: rewritten for the unified model
    - Path: repo://e2e/walkthrough.spec.ts
      Note: End-to-end walkthroughs (P9)
    - Path: repo://packages/shell/src/core/store.ts
      Note: adopt adds the layout's own state
    - Path: repo://packages/shell/src/dom/shell.css
      Note: collections in side columns get a height
    - Path: repo://packages/studio-kit/kits/looks/src/kit.ts
      Note: Settings menu and keys
    - Path: repo://packages/values/src/log.ts
      Note: Log.withFields for Store.adopt (P9-8)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T03:39:18.488208-05:00
WhatFor: ""
WhenToUse: ""
---



# Diary

## Goal

Phase P9 of CHB-037: prove that the unified studio (document format 3, stages and laws, the log, the stack kit,
links, the editors, the agent's workbench) works end to end; fix what integration finds; run the persona session on
the two arrangements; persist agent layouts and looks; rewrite the handoff; hand over with a report
(`reference/02-integration-report.md`).

## Step 1: The full browser suite on SwiftShader and on Metal

The first item of the spec: the whole Playwright suite headless, once on SwiftShader (ports 5511–5514) and once with
`REAL_GPU=1` on the M1 Max under the GPU lock. SwiftShader was green at the start (138 passed, 2 skipped benches);
Metal had two failures, neither in the engines: a test that raced the shell's autosave debounce, and a browser that
did not launch.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work, according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together and add the editor lab functionality / consolidate it all."

**Assistant interpretation:** The main agent assigned me phase P9 (integration) of CHB-037: run every check including
the browser suite on SwiftShader and on the real GPU, walk the studio end to end, run the persona session, persist
agent layouts and looks, rewrite the handoff, recover the export speed if cheap, and report.

**Inferred user intent:** A studio that is not only green phase by phase but works as one application for the
photographer and for the agent, handed over with an honest list of what remains.

### What I did
- `pnpm install --frozen-lockfile --prefer-offline` in the worktree (branch `task/chb-037-p9-integration` at 834ed40).
- `STUDIO_PORT=5511 STUDIO_KIT_PORT=5512 SHELL_DEMO_PORT=5513 GPU_PARITY_PORT=5514 CI=1 pnpm test:browser` →
  140 tests, **138 passed, 2 skipped** (the two 4000 px benches), 7.9 min.
- Under the GPU lock (`mkdir <scratchpad>/gpu.lock`, owner P9, removed afterwards), the same with `REAL_GPU=1`
  (adapter `apple metal-3`) → **136 passed, 2 failed, 2 skipped**, 3.8 min:
  1. `e2e/theme.spec.ts` "View ▸ Theme … saved across a reload": after the reload `prefs.theme` and `prefs.gray`
     were `undefined`.
  2. `studio-kit/test/browser/roll.spec.ts`: `TimeoutError: browserType.launch: Timeout 180000ms exceeded.` — the
     Chromium process started (`<launched> pid=14622`) and never answered on its pipe.
- Fixed (1) in the test: the view tier is saved 700 ms after a change (`packages/shell/src/app/persist.ts`) and the
  test waited a fixed 600 ms, so on a fast machine it reloaded before the save; it now flushes the pending autosave
  with `window.chromobench.rt.save()` (which saves only what the autosave marked dirty, so the dirty tracking is
  still tested). The five other `waitForTimeout(1500) // autosave` before a `page.reload()` in
  `studio-open-strips`, `studio-open-mode` and `studio-interface` got the same flush.

### Why
- A fixed wait shorter than the debounce it waits for can only pass on a slow machine; that is why SwiftShader hid it.

### What worked
- Every engine-side check passed on Metal: conformance 524/524, all `[gpu-parity]` law/tables/chain/film specs.

### What didn't work
- The two failures above (exact errors quoted).

### What I learned
- On Metal the suite is twice as fast (3.8 vs 7.9 min), which is exactly what exposes waits tuned to SwiftShader.

### What was tricky to build
- Telling a real bug from a race: the autosave also runs on `pagehide`, but an IndexedDB write started on pagehide
  need not finish (the shell's own comment says so), so a reload within the debounce can lose a view-tier change in
  real use too. For the photographer that is a theme or panel width changed less than a second before a reload;
  noted, not changed.

### What warrants a second pair of eyes
- Whether the view tier should also be flushed on `beforeunload` (synchronous localStorage fallback) — minor.

### What should be done in the future
- N/A for this step beyond the note above.

### Code review instructions
- `e2e/theme.spec.ts`, `e2e/studio-open-strips.spec.ts`, `e2e/studio-open-mode.spec.ts`, `e2e/studio-interface.spec.ts`.
- Rerun: the commands above; logs in `<scratchpad>/p9-browser-sw-1.log`, `p9-browser-metal-1.log`.

### Technical details
- Skipped by design: `[gpu-parity] bench.spec.ts:5` and `digital.spec.ts:61` (benches, run with `BENCH=1`).

## Step 2: End-to-end walkthroughs on a synthetic landscape; the darkroom's film strip had no height

The second item: whole jobs through the real studio on the WebGPU engine, as Playwright specs on synthetic material
only. A landscape drawn from formulas (sky, sun, clouds, hills, a house with a red door, grass) is rendered as a colour
negative scan and as a camera RAW (`e2e/scenes.ts`). Five tests in `e2e/walkthrough.spec.ts` cover the spec's list;
all pass. They found one real bug: in the darkroom arrangement the vertical film strip was never visible.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Prove the whole works: negative from import to export through every stage, a roll, a
camera file, the agent through `wb`, and screenshots of the arrangements for the owner.

**Inferred user intent:** Evidence that the unified model holds together as one application, not just per phase.

**Commit (code):** 744e78f — "CHB-037 P9: end-to-end walkthroughs on synthetic scenes; the darkroom's film strip gets
a height; autosave races in the browser specs"

### What I did
- `e2e/walkthrough.spec.ts` (GPU engine; SwiftShader in CI):
  1. negative scan 600×400 in Classic: first print (`lights.source.method` = integrate), Time typed `12,5`, a sky burn
     drawn with the linear mask tool, a density (contrast) mask from "+ Layer", View ▸ Layout → Looks, *Warm print*
     applied as a link, back to Classic (frame kept); Edit: curve (a point dragged), HSL, colour grading, clarity with
     a radial mask drawn on it, grade blended *soft light*, HSL+grade grouped; Finish: crop from a corner handle, a
     heal spot; **undo every step (14) back to the first print → the same print node; redo all → the finished
     node**; a 16-bit TIFF export.
  2. darkroom arrangement: two frames, the strip shows both and selects by click, Time, a dodge from the Enlarger's
     "+ Layer", the digital palette opened, Vibrance on the print stage, three steps undone.
  3. a roll of four negatives: Roll ▸ New roll → first-printed, every scan linked to the roll; an override (frame 2's
     base, stored under `overrides.baseT`) and its own grade; in the Looks layout: sync (copy) of frame 1's Time to
     frames 3 and 4 as one step; *More contrast* over the roll on one card, approved; **one undo takes it off all four**
     and leaves frame 2's grade.
  4. a camera RAW: `stages.scene` exists, the Scene module, "+ Layer" Exposure 0.7 st changes the print.
  5. the agent with only `eval`: `frame.explain()`, a densitometer reading, a what-if (`frame.with(sky).print()`) that
     differs, `frame.propose(...)` → a card, approved by a click; `wb.run('module.edit')`, `wb.screen()`;
     `wb.layouts.build({ id: 'simpler', … })` + `wb.layouts.use` → the dialog → "Use Simpler" → mounted; View ▸ Layout
     back to Classic with the frame and its one step.
- Screenshots (`P9_SHOTS=<ticket>/various/p9-arrangements`): 10 PNGs, listed in the report.
- Looked at every screenshot; the darkroom arrangement's left column showed History only. Probe: the `listview`
  `strip-v` existed with `offsetHeight` 0, inside `.ck-side-in.ck-column` (a block container, `overflow-y: auto`).
  `.ck-coll` has `flex: 1; contain: strict`: in a block container size containment leaves it no height. Fix in
  `packages/shell/src/dom/shell.css`: a left/right column that holds a collection directly lays out as a flex column,
  its other children `flex: none`, the collection `flex: 1 1 0; min-height: 160px`. The walkthrough asserts the strip
  is >150 px tall with two rows and that a click selects.
- `e2e/make-scenes.ts` writes the scenes as files (3000×2000 negative, a roll of four 1800×1200, a camera DNG) into
  the git-ignored `.playwright-mcp/p9-synthetic/` for the persona session.

### Why
- The bottom dock (Classic's strip) is already a flex column, so the bug only showed where a layout put a collection
  in a side column — exactly the arrangement the design wants to test first with the photographer.

### What worked
- Undo to the first print and redo to the end reproduce the exact compiled print nodes across darkroom, looks, print
  stack and finish: one log, one compiler.

### What didn't work
- First run: `locator.fill: Test timeout of 420000ms exceeded … waiting for locator('.ck-panel[data-panel="exposures"]
  …').locator('.cb-arg[data-path="main.params.time_s"] .cb-num')` — Time is in the Print module's controls panel, not
  in Exposures (my assumption).
- `Expected: ArrayContaining ["scan", "film", "darkroom", "print"] Received: ["scan", "darkroom", "print"]` — a
  negative scan has no film stage (the film is the scanned negative); a camera file has scene and film.
- Sync in Classic did nothing: `looks.sync` is a command of the looks kit, which only the Looks layout installs.
  Classic and Darkroom have no Copy/Paste/Sync Settings at all → a persona finding (K1), not fixed here.
- `components.order[0]].op` was undefined: a mask component's op is `kind`.

### What I learned
- The studio's hook `get/set` and `printNode()` make walkthroughs checkable without pixels: the compiled node id is
  the print's identity.

### What was tricky to build
- Telling "the test is wrong" from "the studio is wrong" for every failure: three of four first-run failures were my
  assumptions; the fourth (sync) was a real gap.

### What warrants a second pair of eyes
- The CSS rule uses `:has()`; Chromium supports it, Safari 15.4+ too.

### What should be done in the future
- Copy/Paste/Sync Settings in the everyday arrangements (task added from the persona triage).

### Code review instructions
- `e2e/walkthrough.spec.ts`, `e2e/scenes.ts`, `packages/shell/src/dom/shell.css` (the `:has(> .ck-coll)` rules).
- `STUDIO_PORT=5511 … CI=1 pnpm exec playwright test e2e/walkthrough.spec.ts --project chromium-webgpu`.

### Technical details
- Run time on SwiftShader: 5 tests, 2.0 min (the negative walkthrough 35 s).

## Step 3: The assistant's layouts and looks persist; History and rows in catalogue words

Item 4 of the spec (P6b's open item): a layout the agent wrote and the photographer accepted, and a look the agent
wrote, lasted only the page session; a reload fell back to the default layout and a document linking the agent's
look failed with E_LINK. Both are small records, so they go into the studio's KV `settings` store. On the way, the
walkthrough screenshots showed History rows "Added curve1p3", "Added a hsl" and an agent's layer row named "burn".

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Persist agent layouts and looks if small; fix the wording the walkthrough showed.

**Inferred user intent:** What the assistant makes for him stays, like everything else he makes.

**Commit (code):** f1007f5 — "CHB-037 P9: the assistant's layouts and looks are kept in the studio KV; History and
rows in catalogue words"

### What I did
- `packages/studio-kit/kits/chat/src/workbench.ts`: `WorkbenchHost.propose(def, { eval, why, layout })` — the layout
  as data (the recording), which is what can be stored (a `LayoutDef` holds a function).
- `apps/studio/src/host/workbench.ts`: `LayoutHost.keepLayout(l)`, `keepLook(name, src)`, `builtIn(id)`; the layout is
  kept after "Use …" mounted it; an agent layout with a built-in id is refused; a defined look is kept.
- `apps/studio/src/main.ts`: the KV opens first; `settings/agent-layouts` (id → layout data) and
  `settings/agent-looks` (name → source) are read; saved looks are registered (dynamic `import('@chromobench/agent')`,
  only when there are any) before the studio is created; `?layout=<id>` resolves a kept agent layout through
  `realizeLayout`; View ▸ Layout lists kept layouts as "<label> (assistant)"; switching to any layout sets
  `?layout=`; `studio.publishHost()` after keeping one so the menu sees it.
- `packages/studio-kit/src/model/doc.ts` `entryName(e)`: a layer whose name is only its op shows the catalogue's label.
  Used by the stack rows, the params head, the masks panel and History.
- `packages/studio-kit/src/model/history.ts`: inserted layers by their label ("Added a curve", "Added an HSL" — the
  article follows the acronym's sound), list items of a layer ("Curve: point added", "Curve: point removed", bands,
  strokes).
- `e2e/chat.spec.ts`: "the assistant's layout and look survive a reload" — defines a look, applies it (approved),
  builds and accepts "Simpler", reload → `data-layout=simpler`, the file opened again → its saved edit comes back
  with the link and renders; View ▸ Layout lists "Simpler (assistant)"; back to Classic.

### Why
- The design's promise is that an agent's layout is a value like any other; a value that disappears on reload is not.

### What worked
- `realizeLayout` (P6b) already turns the data back into a `LayoutDef`; nothing new was needed in the replay.

### What didn't work
- `tsc`: `TS2774: This condition will always return true since this function is always defined` for
  `LAYOUTS[id as LayoutId]` (typed as a total record); now `id in LAYOUTS ? … : undefined`.
- `TS2339: Property 'coll' does not exist on type '{ readonly op: "remove"; readonly id: string; }'` — a remove has
  no collection, so the owner of a removed point is found by scanning the layers' list arguments.

### What I learned
- After a reload a frame opened with `setInputFiles` is in the library but not open (the browser has no file handle);
  its edit returns by hash when the same file is opened again — the test does exactly that.

### What was tricky to build
- Order at boot: the looks must be registered before any saved document compiles, and the layout must be resolved
  from the KV, so the KV had to open before the layout is loaded (it used to open after the build).

### What warrants a second pair of eyes
- A kept look whose source no longer evaluates only logs a warning; a document linking it then fails as before.
- No UI yet to delete a kept agent layout (the KV key can be cleared; `?fresh` ignores it).

### What should be done in the future
- View ▸ Layout: remove an assistant's layout; File ▸ Import Look for `.cblook.js` files (P7's note).

### Code review instructions
- `apps/studio/src/main.ts` (`AGENT_LAYOUTS`, `AGENT_LOOKS`, `switchLayout`), `apps/studio/src/host/workbench.ts`.
- `pnpm exec vitest run packages/studio-kit/test/history-words.test.ts`; the chat spec.

### Technical details
- After the step: typecheck 0, lint, gen:check (26), vitest 137 files / 3382 passed / 19 skipped, goldens 66/66;
  browser (chromium-webgpu, studio-kit, shell-demo) 90 passed on SwiftShader.

## Step 4: Metal green; the handoff rewritten; the export speed measured, not recovered

With the fixes of Steps 1–3 the whole suite passes on the M1 Max (REAL_GPU=1, under the GPU lock): 144 passed, 2
skipped (the benches), 1.1 min. The handoff guide was rewritten for the unified model, the studio's DEMO.md and the
shell README brought up to date. Item 6 (the darkroom export speed) was measured on Metal and recorded: recovering it
needs the planner to count the DAG's live textures, which is engine work beyond "cheap".

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Items 1 (Metal), 5 (docs) and 6 (export speed, if cheap) of the spec.

**Inferred user intent:** A green suite on his own machine's GPU and a guide a new developer can start from.

**Commit (code):** 4e7853a — "CHB-037 P9: docs/HANDOFF.md for the unified model; DEMO.md and the shell README current"

### What I did
- Full suite on Metal after Steps 1–3: `REAL_GPU=1 … CI=1 pnpm test:browser` → **144 passed, 2 skipped**, 1.1 min
  (theme.spec and roll.spec pass; the roll failure of Step 1 did not recur).
- `docs/HANDOFF.md`: new section 2 "The editing model" (document format 3, stages and laws, cuts and one compiler, the
  log, links, the UI DSLs, the stack kit, the arrangements, the workbench, kept agent layouts and looks); checks with
  today's counts; the repository map (values, the kits, the DSL's instructions); synthetic material for sessions;
  headless Metal (the old text said Playwright needed a headed window for Metal); the status after CHB-037 and the
  owner's open questions (design §38). Sections renumbered (1–10) and cross-references fixed.
- `apps/studio/DEMO.md`: the layouts, layers on every stage, looks and rolls, finish, History in words, exact export,
  the assistant; "Not yet" without the items CHB-037 delivered. `packages/shell/README.md`: the mount example names
  `docs.<id>` (was `recipes`). The other packages have no README (HANDOFF's map describes them).
- Bench on Metal (`BENCH=1 REAL_GPU=1 … --project=gpu-parity -g "bench:"`): 4000 × 2674, plain print preview 21.4 ms,
  export 244.8 ms (12 tiles of 1024, no halo); darkroom print preview 107.3 ms, **export 1650 ms** (48 tiles of 512,
  halo 64) — the same as P3b measured. The second bench (six composite layers) did not start:
  `browser.newContext: Test ended` after the 180 s `beforeEach` timeout — the Chromium launch hang of Step 1 again.

### Why
- Export speed: the planner assumes 20 live textures per pixel for haloed tiles (P3b's measured worst case) and so
  halves the tile; using the DAG's real peak needs a liveness pass over `planGraph` and an OOM-safe fallback, verified
  on Metal at 4000 px. It is a correct-but-slower state (exact output), so it is recorded for an engine follow-up.

### What worked
- Every engine check on Metal, including conformance 524/524 and the tiled-equals-whole law.

### What didn't work
- `Error: Project(s) "packages/gpu/test/browser/bench.spec.ts", … not found` — `--project gpu-parity file …` reads the
  files as project names; `--project=gpu-parity` fixes it.
- The Chromium launch hang (twice in this phase on REAL_GPU runs: `browserType.launch: Timeout 180000ms exceeded`,
  `browser.newContext: Test ended`); both runs' other tests passed and the reruns were green.

### What I learned
- On this Mac the Chromium launch can hang under `REAL_GPU=1` independent of the test: Playwright's 180 s launch
  timeout is the only bound. A retry (`retries: 1` for the GPU projects when `REAL_GPU` is set) would hide it; I did
  not add one, to keep failures visible.

### What was tricky to build
- N/A (measurements and docs).

### What warrants a second pair of eyes
- HANDOFF section 2 is a summary of a large design; each claim names its file, but the design document stays the
  source of truth.

### What should be done in the future
- Exact export speed (P3b's future items: plan from the DAG's live-texture peak, fields in one pass, reuse halo
  renders).
- If the launch hang recurs, investigate Chrome for Testing's GPU process start under Metal (logs with `DEBUG=pw:browser`).

### Code review instructions
- `docs/HANDOFF.md` sections 2, 3, 9; `apps/studio/DEMO.md`.

### Technical details
- `bench:print {"w":4000,"h":2674,"rounds":8,"adapter":{"vendor":"apple","architecture":"metal-3"},"plain":{"previewMs":21.4,"exportMs":244.8,"plan":{"tile":1024,"halo":0,"tiles":12}},"darkroom":{"previewMs":107.3,"exportMs":1650,"plan":{"tile":512,"halo":64,"tiles":48}}}`

## Step 5: Settings ▸ Copy / Paste / Sync Settings in the everyday arrangements; the persona session interrupted

The walkthrough's roll test showed that Copy/Paste/Sync Settings — the Lightroom habit the persona brief names
("sync settings across photos") — existed only in the separate Looks layout. Classic and Darkroom now install the
looks kit for its commands and show Lightroom's **Settings** menu with its shortcuts. The persona session (run by a
sub-agent on a preview build made before this change) stopped when the account's usage limit was reached; it was
resumed after the reset with the instruction to write its diary and report first.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Fix what integration finds when it is cheap; keep the persona session going.

**Inferred user intent:** The everyday screens do the everyday jobs.

**Commit (code):** c0d8a78 — "CHB-037 P9: Settings ▸ Copy / Paste / Sync Settings in Classic and Darkroom; diary Step 4"

### What I did
- `packages/studio-kit/kits/looks/src/kit.ts`: kit keys `Mod+Shift+C/V/S` → `looks.copy/paste/sync`; a product menu
  `menus.settings()` = Copy Settings, Paste Settings, Sync Settings to Selection, Sync Mode.
- `layouts/classic.js`, `layouts/darkroom.js`: `.use(looks.kit)` and `looks.menus.settings()` after the standard menus.
- Layout explain snapshots updated with `-u` and read: classic, darkroom and looks gain the kit's commands and keys;
  0 errors, 0 warnings; the completeness tests (every command reachable from a menu/key is in `wb.commands()`) pass.
- `e2e/walkthrough.spec.ts` roll test: sync now in Classic — the film strip's cells clicked with Mod (source last, so
  it is the primary), Settings ▸ Sync Settings, frames 3 and 4 get frame 1's Time in one step.
- Persona sub-agent: brief in its session folder's diary (when written); it had taken 38 screenshots and written no
  documents when it stopped (`rate_limit`, HTTP 429). Resumed with "write diary and report first".

### Why
- Sync is one of the persona's listed expectations; having it only in a layout he would never pick is a gap, and the
  command already existed.

### What worked
- The kit installs into any layout: the looks kit only needs `cb.core`; the roll-dependent commands answer "Make a
  roll first" without the roll kit.

### What didn't work
- N/A

### What I learned
- Installing a kit brings all its commands into the palette; Classic's palette now lists look commands that need the
  Looks layout's library to pick a look (disabled with their reason).

### What was tricky to build
- Selecting with the source as primary: the last Mod-clicked cell becomes the primary, so the source is clicked last.

### What warrants a second pair of eyes
- Whether the look commands that need a picked look should be hidden from the palette where no library is shown.

### What should be done in the future
- A "Sync…" dialog choosing the groups (the Looks layout has a Sync groups panel; Classic syncs the default groups).

### Code review instructions
- `packages/studio-kit/kits/looks/src/kit.ts`, the two layouts, `packages/studio-kit/test/__snapshots__/layouts.test.ts.snap`.

### Technical details
- vitest after the step: 137 files, 3382 passed, 19 skipped.

## Step 6: The persona session; its blocker and the strip fixed; findings triaged; the default recommended

The persona sub-agent (resumed after the usage-limit stop) finished S1–S5 on synthetic material and recommends
**Classic as the default for now**: Darkroom first is the screen Manfred would rather work in, but only Classic takes a
newcomer from the negative to a cropped, spotted print and has the scene stage for camera files. Its blocker — Roll ▸
New roll always failing — reproduced only after a layout switch, which is why the walkthrough (always `?fresh` in
one layout) had missed it. It and the 2 px strip thumbnails are fixed; the other findings are CHB-037 tasks.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Item 3 of the spec: run the CHB-026 protocol on the two arrangements, triage findings
into tasks, recommend the default with reasons; fix what is cheap and critical.

**Inferred user intent:** Find what the photographer would trip over before he does, and settle design §38's first
open question with evidence.

**Commit (code):** d63a220 — "CHB-037 P9: New roll works after View > Layout from Darkroom first (P9-8); the darkroom
strip shows its prints (P9-4)"; e435bc5, de80de7 (the session, the tasks); 348eefd (a Metal race in the walkthrough)

### What I did
- Session (sub-agent): brief = the protocol, synthetic files only, headless SwiftShader, preview build on port 5516;
  output `sessions/p9-01-manfred-arrangements/` (`01-diary.md`, `02-experience-report.md`, 63 shots, step scripts);
  I added front matter and numbered names (docmgr doctor), and checked that no private path was used.
- P9-8 reproduced with a probe: Darkroom first (no roll kit) → View ▸ Layout ▸ Classic → `roll.fromFrames` returned
  nothing (in a fresh Classic: `roll-1`). Cause: `Store.adopt` replaced the new program's log with the old one, whose
  main document never had `roll`; the state still showed `roll` (projected from the new init) but the log refused the
  write. Fix: `Log.withFields(id, fields)` in `packages/values` (adds missing top-level fields to the initial state and
  the state now, not a step) and `Store.adopt` calls it with its own main document. Tests: values unit test (undo keeps
  the field, serialisation keeps it), e2e "a roll after switching from Darkroom first to Classic".
- P9-4: the vertical strip used the list's 24 px row, leaving the thumbnail 2 px under its caption; rows are 150 px;
  the darkroom walkthrough asserts two rendered thumbnails > 80 px tall. Explain snapshots (darkroom, tiny) updated.
- Metal rerun after Step 5: 142 passed, 2 failed: the walkthrough read `[data-handle="1,1"]`'s box before it was
  drawn (`TypeError: Cannot read properties of null (reading 'x')`) — now waits for it; `arrangements.spec`
  `browserContext.close: Test timeout of 60000ms exceeded` — the launch/teardown hang again. Three Metal reruns of both
  files: 9/9 each.
- 23 tasks added with `docmgr task add` (4 checked as fixed in P9), owners named; the integration report filled.

### Why
- A blocker found by the persona is exactly what P9 is for; its fix is small and general (any kit installed by one
  layout and not another).

### What worked
- The persona's diary named the cause precisely (`t.$set(['roll','rolls',id])` and no `roll` root), which made the
  probe a two-minute job.

### What didn't work
- The persona run stopped once on the account's usage limit (`rate_limit`, HTTP 429) with 38 screenshots and no
  documents; resumed with "write the documents first".

### What I learned
- Walkthroughs that always start fresh in one layout miss state that crosses layouts; the new e2e test crosses.

### What was tricky to build
- `withFields` must touch both the initial state and the current state: undo applies inverse transactions to the
  current value, and a later load replays from the initial state, so a field added only "now" would vanish on reload.

### What warrants a second pair of eyes
- `Store.adopt` adds only top-level fields the adopted main document lacks; a kit whose state shape changed between
  layouts (same root, different fields) is not reconciled.

### What should be done in the future
- The open tasks of the session (P9-1, P9-3, P9-5, P9-9 … P9-18) and the owner's decision on the default.

### Code review instructions
- `packages/values/src/log.ts` `withFields`; `packages/shell/src/core/store.ts` `adopt`; `packages/studio-kit/src/cb.ts`
  `strip`; `e2e/walkthrough.spec.ts` (last test); `sessions/p9-01-manfred-arrangements/02-experience-report.md`.

### Technical details
- Probe output before the fix: `darkroom-then-classic fromFrames undefined []`, `classic-fresh fromFrames "roll-1"`.

## Step 7: Final checks and hand-over

Every acceptance check is green on the last code commit: typecheck, lint, gen:check, vitest, goldens, and the whole
browser suite on SwiftShader and on Metal. The integration report (`reference/02-integration-report.md`) holds the
results, the walkthroughs, the screenshots, the persona findings, the recommended arrangement and the open items with
owners; the arrangement screenshots were regenerated by the final SwiftShader run (they now show the darkroom strip's
prints and the Settings menu).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Close the phase: all checks, the report, the final hand-back.

**Inferred user intent:** An integration branch the main agent can merge with confidence, and an honest list of
what remains.

**Commit (code):** (this step's docs commit; code last changed in d63a220)

### What I did
- `pnpm typecheck` 0 errors; `pnpm lint` ok; `pnpm gen:check` ok (26); `pnpm test` 137 files, 3383 passed, 19
  skipped; `node tools/goldens/render.ts --check` 66/66.
- `P9_SHOTS=<ticket>/various/p9-arrangements … CI=1 pnpm test:browser` (SwiftShader): **145 passed, 2 skipped**,
  8.7 min. Under the GPU lock, `REAL_GPU=1`: **145 passed, 2 skipped**, 1.0 min. Lock removed.
- The report filled; HANDOFF's browser count updated (147 tests).

### Why
- N/A

### What worked
- The final runs on both adapters were clean on the first try.

### What didn't work
- N/A

### What I learned
- N/A

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- The Chromium launch hang under `REAL_GPU=1` was seen three times in this phase; it did not occur in the last run.

### What should be done in the future
- The open CHB-037 tasks (report section 8).

### Code review instructions
- Start with `reference/02-integration-report.md`, then this diary's Steps 2, 3 and 6.

### Technical details
- Logs: `<scratchpad>/p9-browser-sw-4.log`, `p9-browser-metal-4.log`.
