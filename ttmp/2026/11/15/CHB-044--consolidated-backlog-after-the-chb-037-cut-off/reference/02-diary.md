---
Title: Diary
Ticket: CHB-044
Status: active
Topics:
    - architecture
    - ui
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/15/CHB-044--consolidated-backlog-after-the-chb-037-cut-off/reference/01-consolidated-backlog.md
      Note: the backlog this diary produced
    - Path: repo://ttmp/2026/11/15/CHB-044--consolidated-backlog-after-the-chb-037-cut-off/various/01-triage-decisions.tsv
      Note: one line per open task with its status and the suffix written into its ticket
    - Path: repo://ttmp/2026/11/15/CHB-044--consolidated-backlog-after-the-chb-037-cut-off/scripts/01-apply-triage.py
      Note: applies the decisions through docmgr task edit/check and counts them
    - Path: repo://docs/HANDOFF.md
      Note: the summary of the current model the triage started from
ExternalSources: []
Summary: 'How the 200 open tasks were triaged against the code, per group of tickets, how the backlog was written and checked, and what stayed uncertain.'
LastUpdated: 2026-11-15T18:45:00-05:00
WhatFor: 'Reviewing the triage; redoing it later with the same method.'
WhenToUse: 'Before trusting a done/superseded mark in an older ticket, or when updating the backlog.'
---

# Diary

## Goal

This diary records the triage of every open task in the tickets written before and after the CHB-037 cut-off, checked
against the code of `task/chb-037-unified-model`, and the consolidated backlog that came out of it
(`reference/01-consolidated-backlog.md`). Documents and ticket files only; no code changed.

## Step 1: Survey of the tickets and of the current model

I started from the shape of the work: which tickets have open tasks, how many, and what the studio looks like now. 19
tickets had 200 open tasks; CHB-038, CHB-039 and CHB-041 had none. Before judging any task I read the handoff guide
(the current model in one place), the CHB-037 integration report (the P9 findings), CHB-035 design 02 Part IV (the
performance proposals P1–P8) and the CHB-041 diary's account of what it took from P1 and P2.

### Prompt Context

**User prompt (verbatim):**

```
Triage chromobench's open tickets against the current code and consolidate what is still wanted into one backlog grouped by functionality.

CONTEXT
chromobench is a browser darkroom (PWA) that its owner builds for his father, a photographer: raw camera files and colour-negative scans printed through a numerical film/paper model, with a WebGPU engine and an f64 reference engine. In CHB-037 the whole editing model was rebuilt with a hard cut-off (no backwards compatibility): stages scan/scene/film/darkroom/print, one document format 3 with layers/groups/links/masks, one history, contract 1.0+, a stack kit, the agent workbench `wb`, Editor lab ops (curves, levels, HSL, grading, mixer, vignette, sharpen, radial/colour masks, 16 blend modes), looks as link functions (film-stock looks deleted), presets/sync via links, exact tiled export, a renamed UI DSL ("variant" → "layout"). Since then: CHB-038 diagnostics/bug reports, CHB-039 mask overlay, CHB-041 GPU memory residency were merged. So many tasks in older tickets (written before CHB-037) are probably done, superseded or obsolete.

WHERE
Work in the integration worktree: /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037 (branch task/chb-037-unified-model). Tickets are under its ttmp/YYYY/MM/DD/CHB-NNN--*/ (index.md, tasks.md, design docs, diaries). A dev server runs from this worktree; do not stop it and do not touch node_modules. You may run read-only commands, `pnpm typecheck`/tests only if needed to confirm a claim (prefer reading code). Use `docmgr` for ticket bookkeeping (`docmgr task check|add`, `docmgr changelog update`, `docmgr doc add`, `docmgr ticket ...` — read `docmgr help` / `docmgr <cmd> --help` first; tasks.md lines carry `<!-- t:xxxx -->` ids).

ACTIVE TICKETS WITH OPEN TASKS (check all): CHB-004, 008, 010, 011, 013, 014, 015, 020, 021, 022, 026, 028, 029, 030, 033, 034, 035, 037 (P9-x, P10-1…27, decisions, other open lines), 040. Also look at CHB-038, 039, 041 (active with 0 open tasks: candidates to close).

WHAT TO DO
1. For every open task, decide one of:
   - DONE — the code already does it (cite file:line or test name);
   - SUPERSEDED — CHB-037's model or a later ticket replaced it (name what replaced it, e.g. "masks in contract 1.0, CHB-037 P2a/P8a"; "film-stock looks deleted in P7, CC-021");
   - OBSOLETE — no longer applies to the current design (say why);
   - OPEN — still wanted (possibly reworded for the current model);
   - DUPLICATE — the same work as another open task (name it).
   Verify against code, not only against diaries. When unsure, keep it OPEN with "(check: …)".
2. Mark the tickets: DONE → check the task and append " — done: <evidence>"; SUPERSEDED/OBSOLETE/DUPLICATE → check it and append " — superseded by …" / " — obsolete: …" / " — duplicate of …" (keep the original text; the checkbox plus the suffix is the mark). OPEN tasks stay unchecked; if the wording refers to removed concepts (recipe, printChain, variant, film looks), append " — now: <current wording>". Add a changelog entry per ticket. If every task of a ticket is resolved, set its status to complete (via docmgr if it supports it, else the index.md Status field) with a one-line reason; CHB-016-style archived tickets stay as they are.
3. Create ticket CHB-044 ("Consolidated backlog after the CHB-037 cut-off") with docmgr, and in it a reference doc `reference/01-consolidated-backlog.md`:
   - grouped by functionality, not by ticket: e.g. Masks, selections and local tools; Layers and adjustments; Darkroom printing tools (test strip, ring-around, preflash, density masks, filtration); Finish and retouch (crop, straighten, heal, rotation kernel); Scan conditioning and roll workflow; Looks, presets, snapshots, library; Colour and output (gamut knee, proofing, printer output, export formats and sizes); GPU engine correctness; GPU and CPU performance (CHB-035 design 02 P1–P8 state); Interface shell and UI DSL; Agent and assistant; Diagnostics and testing; Calibration with the photographer; Later (B&W, extensions, data licences);
   - each item: one line in current terms, severity (correctness / major / minor / later), source task ids (CHB-NNN t:xxxx or P9-x), and dependencies;
   - a section "Owner decisions" listing every open decision once (merge duplicates across CHB-035 §38, CHB-037, P10-23 etc.);
   - a section "Suggested order" (your recommendation: correctness first, then what blocks the photographer, then the rest), short;
   - a table "Ticket status after triage": ticket, open before → open after, closed or not.
   Also the CHB-040 parity items and CHB-035 design 02's P1–P8 (ttmp/2026/11/14/CHB-035*/design/02-editor-lab-performance-architecture.md, Part IV) must appear, with their current state (CHB-041 did half of P1 and P2; exact tiles P5 done).
4. Keep a diary in CHB-044 (`docmgr doc add --ticket CHB-044 --doc-type reference --title "Diary"`), following ~/.codex/skills/diary/SKILL.md (read it): steps for survey, per-group triage, backlog writing, verification. Record counts and anything you were unsure of.
5. Commit in the worktree at sensible intervals (e.g. per few tickets, then the backlog), messages starting "CHB-044:" and ending with the line
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Do not push. Do not change code (docs and ticket files only).

PRIVACY: test material is the photographer's private family photos. Do not quote photo file names, people or roll names in the backlog or diary (existing tickets may contain some; do not copy them into new text — say "a test frame").

REPORT (concise): counts per status (done / superseded / obsolete / duplicate / open) overall and per ticket; tickets closed; the backlog path and commit hashes; the owner decisions list; your suggested first three work items; anything you were unsure about.
```

**Assistant interpretation:** Check each of the 200 open tasks against the code, mark it in its ticket with evidence
or a new wording, close tickets that are fully resolved, and write one backlog by functionality with the open
decisions, an order and a status table, plus this diary.

**Inferred user intent:** After a rebuild that made much of the old task lists stale, the owner wants one trustworthy
list of what is left, so the next tickets can be chosen without rereading 19 tickets.

### What I did

- `docmgr help`, `docmgr task --help`, `docmgr ticket close --help`, `docmgr changelog update --help`; read
  `~/.codex/skills/diary/SKILL.md`.
- Counted open and closed tasks per ticket from `tasks.md` (`- [ ]` lines) and read every open line.
- Read `docs/HANDOFF.md` (§2 model, §9 decisions and next steps, §9b CHB-038, §9c CHB-041), the CHB-037 integration
  report, CHB-035 design 01 §38 (owner questions) and design 02 Part IV, the CHB-041 diary (P1/P2 relation), the
  "future" sections of the CHB-038, CHB-039 and CHB-041 diaries, and CHB-037 reference 03 (Editor lab parity).
- Listed the packages, kits and layouts to know where to look (`packages/studio-kit/kits/*`, `layouts/*.js`).

### Why

- A task can only be judged against the current model; the handoff guide and the integration report are the shortest
  correct account of it, and the code is the arbiter.

### What worked

- The open counts: CHB-004 6, 008 11, 010 9, 011 6, 013 18, 014 17, 015 14, 020 4, 021 9, 022 5, 026 2, 028 18,
  029 12, 030 6, 033 5, 034 5, 035 3, 037 45, 040 5 = **200**.
- CHB-041's diary states exactly what it took from design 02: source residency (half of P1) and proxies as P2's
  memory half, LRU kept, GreedyDual-Size deferred to checkpoints.

### What didn't work

- `grep -rn … --include=*.ts` in the zsh run by the tool failed with `(eval):1: no matches found: --include=*.ts`
  (the glob is expanded by zsh); quoting it (`--include='*.ts'`) fixed it.

### What I learned

- Several CHB-029 items (host capabilities, per-area command tables, typed selectors, ui order/advanced, the rename)
  were done inside CHB-037 P5a/P5b but never ticked in CHB-029; the code comments name the CHB-029 item they do.

### What was tricky to build

- Nothing built; the sharp edge was the vocabulary shift: tasks speak of recipes, variants, printChain, film looks and
  CHB-002's changelog, which no longer exist. Each such task was judged by what it wanted, not by its words.

### What warrants a second pair of eyes

- N/A for this step.

### What should be done in the future

- N/A

### Code review instructions

- Start with `docs/HANDOFF.md` §2 and §9 and the integration report §5–§8; they are what the triage assumed.

### Technical details

- Count per ticket: `grep -c '^\s*- \[ \]' <ticket>/tasks.md`.

## Step 2: Triage of CHB-004, 008, 010, 011 (data, agent integration, darkroom, output)

Each task was checked by searching the code for the names it uses and reading the hits. Decisions went into a
tab-separated file (ticket, id, status, suffix), applied by a small script through `docmgr task edit` (to append the
suffix; it keeps the `<!-- t:id -->` marker, tried first on a scratch copy) and `docmgr task check`.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** First group of tickets, marked and committed.

**Inferred user intent:** (see Step 1)

**Commit:** 4227ad7 — "CHB-044: triage CHB-004, 008, 010, 011 against the code after the CHB-037 cut-off"

### What I did

- CHB-004: `openPack`, the hash/grid/schema/stock errors and their tests exist (`packages/data/src/pack.ts:190`,
  `manifest.ts:67`, `core/src/data/interim.ts:39`, `packages/data/test/loader.test.ts`) → done. One of six synthetic
  sets exists (`fixtures/synthetic/neutral-wedge`). The Portra 800 push profiles are exported and used; the
  exposure-index check against the datasheet is not done.
- CHB-008: R1 (stale reads proposed in auto mode) is in `packages/dsl/src/history.ts:42-49` → done; R2 (origin) settled
  as `source: { kind: 'agent', eval }` → superseded. The bridge's proxy, `go:embed`, cookie, threads store,
  attachments, playbooks, transcripts and task evals are absent (bridge/README "Not yet"; KV `threads` unused).
- CHB-010: real mode is the catalogue default (`capture-film-print.ts:69`) → done. The preflash is a light-law term
  (`stage-laws.ts:173`) — reworded the preflash/reciprocity task to the reciprocity hook alone. Strips (time and
  signed CC) and the lights ring-around exist in `studio-kit/src/model/tools.ts`; seconds mode, density hold, tiles,
  per-step tables and filter moves do not. Highlight density masks absent (polarity positive|same only).
  `compileExposures` is gone; one stale comment remains.
- CHB-011: export cancellation and tiles-equal-one-pass are in `output/src/export/run.ts` and its tests → done;
  `OutputSettings` is `document.output` with `output.display/encode` OpDefs → done. CAM16 knee exists in f64 only
  (GPU falls back to OkLCh with `W_PREVIEW_APPROX`, `gpu/src/engine/lower.ts:87`); proofing and printer settings
  are types without wiring.
- Changelog entry per ticket (`docmgr changelog update`).

### Why

- Evidence in the ticket line lets the next reader trust a tick without redoing the search.

### What worked

- Counts: CHB-004 1 done, 5 open; CHB-008 1 done, 1 superseded, 9 open; CHB-010 1 done, 8 open; CHB-011 2 done,
  4 open.

### What didn't work

- N/A

### What I learned

- CHB-032's audit had already ticked the stage tasks with "remaining:" notes and opened follow-ups; those follow-ups
  are the real open items.

### What was tricky to build

- Partial completion: where most of a task exists, I kept it open with "now: … exists; remaining: …" rather than
  ticking it, so that nothing wanted disappears behind a tick.

### What warrants a second pair of eyes

- CHB-004 t:spah "in node and in a browser test": the browser side is covered by the studio loading packs in every
  e2e run and a `fetch()` source test in node, not by a dedicated browser test.
- CHB-010 t:j9cj (filtration fast path): kept open with a check — it may be unnecessary on the GPU engine.

### What should be done in the future

- N/A (the items are in the backlog).

### Code review instructions

- `git show 4227ad7 -- '*tasks.md'`; each suffix names its file:line.

### Technical details

- `python3 -I scripts/01-apply-triage.py <worktree> various/01-triage-decisions.tsv apply CHB-004,…` (dry run without
  `apply` prints counts and any open id without a decision).

## Step 3: Triage of CHB-013, 014, 015, 020, 021, 022, 026 (calibration, B&W, extensions, roll, looks, finish, persona)

The calibration, B&W and extension tickets are almost untouched by the code, so their tasks stay open; the work there
was deciding which old phrasings to update and which questions duplicate each other. Roll, looks and finish had the
most real progress inside CHB-037.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Second group, marked and committed; CHB-026 closed.

**Inferred user intent:** (see Step 1)

**Commit:** 7830b12 — "CHB-044: triage CHB-013, 014, 015, 020, 021, 022, 026; close CHB-026"

### What I did

- CHB-013: the three "ask the photographer" tasks (t:59ma, t:gb3u, t:5yc4) are one piece of work; 59ma kept, with
  what is already known (scanner, software, references) in its note, the other two marked duplicates. Recipe
  phrasing updated to documents; the beta's session bundle is now CHB-038's report zip.
- CHB-014: all 17 open (no B&W code); contract and integration wording updated for contract 1.x and the light law.
- CHB-015: "finishing domains and recipe shape" superseded by document format 3; "physical radii" superseded
  (clarity and sharpen in mm on the print, `contract/src/catalog/layers.ts:8,127`); the finishing operators reworded
  to the four not built (dye saturation, grain reduction, guided-filter tone ops, bloom).
- CHB-020: cull keys and `roll.cull.sweep` exist (`kits/roll/src/kit.ts:468,530`), no peek spring; the roll's flare
  from the holder's veil exists; scanner model waits for CHB-013.
- CHB-021: library form, preset files with needs-review, kit in the layouts → done; film looks and the DSL looks
  provider → superseded by P7; virtual copy and match are disabled stubs (`kits/looks/src/commands.ts:392-393`).
- CHB-022: Finish panel and passes, local tones, agent geometry → superseded by the stack kit, masks and `wb`; the
  Lanczos export resampler and the licence-gated provider stay open.
- CHB-026: d48l done (became CHB-027/031), jqqs obsolete → `docmgr ticket close`.

### Why

- Duplicates in the questions to the photographer would otherwise ask him the same thing three times.

### What worked

- Counts: CHB-013 2 duplicates, 16 open; CHB-014 17 open; CHB-015 2 superseded, 12 open; CHB-020 4 open; CHB-021
  3 done, 2 superseded, 4 open; CHB-022 3 superseded, 2 open; CHB-026 1 done, 1 obsolete (closed).

### What didn't work

- N/A

### What I learned

- `docmgr ticket close` rewrites the index front matter (quoting style of `Summary`) besides `Status`; harmless.

### What was tricky to build

- CHB-014 t:nkhw (ask about B&W films, papers, head) overlaps CHB-013 t:59ma; I kept it open because it asks for more
  than 59ma, and merged both in the backlog's CAL-1.

### What warrants a second pair of eyes

- CHB-022 t:5v8b superseded: CB-F110 crop-valid and CB-F102 exist; I did not find separate "spots-bounds" and
  "finishing-label" passes and judged them unnecessary under the stack kit.
- CHB-015 t:aubb superseded: the radii are physical; I did not verify a separate "gamut after output.display" test.
- CHB-021 t:8neb and t:kzh2 kept open as "later"; they may simply be unwanted now.

### What should be done in the future

- N/A

### Code review instructions

- `git show 7830b12 -- '*tasks.md'`.

### Technical details

- N/A

## Step 4: Triage of CHB-028, 029, 030, 033, 034, 035, 037, 040 (shell and studio follow-ups, UI DSL, agent layouts, RAW colour, GPU checks, design, CHB-037, parity)

These are the newest tickets. CHB-029 and CHB-030 turned out mostly done by CHB-037 (P5a/P5b and P6b) without
being ticked. CHB-037's P9 items were spot-checked in code (apply print settings, mask tools, Output placeholder,
export formats), and P10 items sampled (`combine.wgsl` mode 7 still has no floor, `solve.ts` gtol 1e-9,
`Pool.acquireChecked` unused, `GpuTimer`); all still open.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Third group, marked and committed; the merged tickets with no tasks closed.

**Inferred user intent:** (see Step 1)

**Commit:** 29c0783 — "CHB-044: triage CHB-028, 029, 030, 033, 034, 035, 037, 040; close CHB-038, 039, 041"

### What I did

- CHB-028: all 18 still open; reworded the recipe sidecars to document sidecars (File ▸ Save Document exists, the
  export writes none), variant → layout; "(check: …)" on the two dialog/history findings that need the running app.
- CHB-029: items 1, 2, 3, 4, 7, 8, 9 done (`studio-kit/src/studio.ts:49-55`, `shell/src/core/commands.ts:25-29`,
  `shell/src/build/checks.ts:218-230,341`, `studio-kit/src/commands/`, `cb.ts:367,417`, `sel.ts`,
  `contract/src/registry.ts:39`, `kits/stack/src/dom.ts:416,504`); status bar and jobs slice open; the CPU 1:1 label
  task marked a duplicate of the CPU refine task.
- CHB-030: design study, agent docs, loading/lifecycle, agent tools, acceptance → done by P6b and P9; safety tests
  open.
- CHB-033: the same-adaptation comparison done (Step 2, script 02); chart, matrices, regression test, Lightroom open.
- CHB-034: the five engine-dependent measurement items kept open, linked to design 02 P2.
- CHB-035: the CHB-037 implementation ticket done; the owner questions and the performance ticket open.
- CHB-037: 44 open; t:qv4l (default arrangement) marked a duplicate of CHB-035 t:qyx4.
- CHB-040: 5 open.
- `docmgr ticket close` for CHB-038, CHB-039, CHB-041; their "future" notes became backlog items (MASK-4, DIAG-6,
  PERF-4).

### Why

- Unticked work done elsewhere is the most misleading kind of open task; CHB-029 alone had seven.

### What worked

- Counts: CHB-028 18 open; CHB-029 7 done, 1 duplicate, 4 open; CHB-030 5 done, 1 open; CHB-033 1 done, 4 open;
  CHB-034 5 open; CHB-035 1 done, 2 open; CHB-037 1 duplicate, 44 open; CHB-040 5 open.
- Overall: **23 done, 8 superseded, 1 obsolete, 4 duplicates, 164 open** (200).

### What didn't work

- N/A

### What I learned

- The agent's layout surface (CHB-030) was settled by recording `ck`/`cb` calls on proxies in the sandbox (P6b
  decision 4), which answers CHB-030's design study.

### What was tricky to build

- CHB-030 t:sd56 asks for a persona session where the photographer asks for a simpler interface; what exists is the
  e2e walkthrough 5 that the integration report calls CHB-030's acceptance. I marked it done on that evidence and
  said in the suffix that a live-model session was not run.

### What warrants a second pair of eyes

- CHB-030 t:3yd4: I accepted the agent's "Writing a layout" topic as the "make a simpler layout" playbook.
- CHB-037 qv4l as a duplicate of CHB-035 qyx4: the decision is the same; the conditions for switching to Darkroom
  first are carried in the backlog (D1, DARK-1).
- The P9 findings were not re-run in a browser; they were confirmed open by reading the code they name.

### What should be done in the future

- N/A

### Code review instructions

- `git show 29c0783 -- '*tasks.md'`; CHB-029's suffixes cite the files.

### Technical details

- N/A

## Step 5: Writing the backlog

The backlog groups the 164 open tasks (and the duplicates' targets) into 14 groups of the brief, adds items that
have no task but are named as open in a diary or report (the mask gesture preview, the editor validation, the async
command attribution, the launch hang, Classic opening into Print, the HANDOFF overlay note), the state table for
design 02's P1–P8, the merged owner decisions D1–D13, a suggested order and the status table.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** One file a reader can choose work from, in current terms.

**Inferred user intent:** (see Step 1)

**Commit:** 07169ca — "CHB-044: ticket and consolidated backlog (…)"

### What I did

- `docmgr ticket create --ticket CHB-044 …`, `docmgr doc add` for the backlog and this diary; wrote the backlog;
  filled the index overview; CHB-044 tasks; one-line close reasons in the closed tickets' index bodies.
- Several tasks merged into one item where they are one piece of work (e.g. DARK-5 = P9-6 + CHB-028 czh4; OUT-2 =
  CHB-028 qfae + P9-14; GPUC-8, GPUC-9 group P10 debts; LATER-1 = CHB-014).

### Why

- By functionality, because the next tickets will be cut that way, not by the ticket that first mentioned a gap.

### What worked

- Design 02 state: P1 half (residency), P2 half (proxies), P5 export done, P7 partly (adaptive drafts in
  `render-bridge.ts:90-115`), P3, P4, P6, P8 open.

### What didn't work

- N/A

### What I learned

- The owner questions are asked in at least five places (design §38, HANDOFF §9, the integration report, CHB-037
  qv4l, CHB-040 f4vl); D1–D13 now name all of them.

### What was tricky to build

- Severity: "correctness" was kept for silent wrong results (the GPU export field reuse, grid ties, −∞, uncounted
  memory, ClipColor, the three Gaussians, the solver's stopping test, engine-dependent metering) and for two first-print
  findings that may be correctness (SCAN-1, DARK-4, both still to check).

### What warrants a second pair of eyes

- The suggested order; in particular whether the photographer's blockers should go before GPUC-4/5.

### What should be done in the future

- The owner's answers to D1–D13 (CHB-044 t:m4c8).

### Code review instructions

- Read `reference/01-consolidated-backlog.md` top to bottom; check any item against the task ids it names.

### Technical details

- N/A

## Step 6: Verification

I checked that the backlog and the tickets agree and that the new text keeps the privacy rule.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Make sure nothing was lost or leaked.

**Inferred user intent:** (see Step 1)

**Commit:** this step's commit (diary, script and decisions file).

### What I did

- Dry run of the script over all tickets: no open id without a decision, no decision for a non-open id; totals 23 /
  8 / 1 / 4 / 164 = 200.
- Every open and duplicate id from the decisions file appears as `t:<id>` in the backlog (a loop of `grep -q`; no
  misses).
- Privacy: no file names of photos, no person or roll names in the backlog, this diary or the suffixes I added
  (grep of the added lines; the matches were pre-existing task text and a front-matter line `docmgr` re-quoted).
- `git status` clean after each commit; only `ttmp/` files changed.

### Why

- A backlog that misses an open task, or a tick without evidence, would defeat the point.

### What worked

- All checks above.

### What didn't work

- The first draft named the wrong CHB-037 diary step for the "merge to main" question (15, not 16); fixed.

### What I learned

- N/A

### What was tricky to build

- N/A

### What warrants a second pair of eyes

- Items marked "(check: …)" in the tickets and the backlog: CHB-008 ch9a and u7mw, CHB-010 j9cj, CHB-011 bk2k,
  CHB-021 8neb, CHB-028 nbof, 5vfk, 6lah, CHB-029 5tv9, 7fk7, CHB-034 4o9y, CHB-037 P9-1, P9-3, P9-10, P9-14, P9-16.
- No tests or typecheck were run; the triage reads code only.

### What should be done in the future

- Re-run this triage (the decisions file and the script) after the next large merge.

### Code review instructions

- `python3 -I scripts/01-apply-triage.py <worktree> various/01-triage-decisions.tsv` (dry run) lists, per ticket,
  open tasks without a decision and decided tasks that are no longer open (after the apply: every checked one), and
  counts the open ones: 164 after this triage, matching `grep -c '- \[ \]'` over the 19 tasks files.

### Technical details

- N/A
