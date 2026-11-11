---
Title: Diary
Ticket: CHB-016
Status: active
Topics:
    - ui
    - dsl
    - architecture
    - product
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T12:56:23.553762403-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-016 CraftKit Studio study

## Step 1: Import CraftKit Studio v1 into a new ticket

The photographer's app needs more than the darkroom: Manuel wants a full Lightroom replacement for his dad and a UI
toolkit plus JS DSL that make it cheap to try different versions of the UI. He pointed at `craftkit-studio`, which
no earlier ticket or analysis had looked at. This step creates ticket CHB-016 and imports the code; the study
itself starts in Step 2.

The zip was found in `~/Downloads` (two byte-identical copies). It is a plain-ES-module app: the CraftKit Shell v1
(`src/shell`), the Studio modules (`src/app`: Library, Cull, Develop, Export, Prepress, Print Shop), an engine bridge
to the CraftKit Workbench engine (`vendor/wb`, three wasm crates run in two workers), docs and Playwright scenarios.

### Prompt Context

**User prompt (verbatim):** "did we already look at craftkit-studio?", then "so ideally, I would like to have a UI
toolkit and JS DSL to also create different versions of the UI quickly for a full lprofessional lightroom
replacement for my dad, allowing us to experiment with different ways of working with the images, from the
development part, to more traditional retouching potentially (layers, standard lightroom tools, etc...), to export,
to comparing presets versions, applying to the liibrary, etc... Study the craftkit studio codebase and see how much
this would be portable over / what JS API design we could extract from it. Report here in the chat at first, so I
can crossvalidate your findings before doing a real design.", then "import the code into the sources folder of a new
ticket, btw.", then "commit at appropriate intervals and keep a detailed diary as you work (using the diary format
from the skill). If you spawn subagents, have them use the diary format too, but I think we can keep it to this
thread."

**Assistant interpretation:** Create a ticket, import the CraftKit Studio code as source material, study it for what
can be ported to chromobench and what JS API (UI toolkit and DSL) can be extracted, and report findings in chat
before any design document.

**Inferred user intent:** Decide, on evidence, whether chromobench's Studio (CHB-009) and DSL (CHB-007) should grow
from CraftKit's shell and builder grammar instead of the React-19 plan in the CHB-009 guide, and to what extent.

**Commit (code):** see the commit that adds this step — "CHB-016: ticket, CraftKit Studio v1 sources, diary step 1"

### What I did

- `grep -ril craftkit ttmp packages apps` in the repo: no hits. Searched the earlier transcript: the only hit was the
  question itself. `find ~/code ~/Downloads ~/Documents -maxdepth 4 -iname '*craftkit*'` found
  `~/Downloads/craftkit-studio-v1.zip` and `craftkit-studio-v1(1).zip`; `cmp` says identical.
- Extracted a working copy to the session scratchpad; read `docs/README.md`, `docs/SHELL.md`, `build.mjs`,
  `src/app/main.js`, `src/app/engine-graphs.js`, `src/shell/core/engine.js`, `engine/studio-worker.js`,
  `engine/assemble.mjs`.
- `git switch -c task/chb-016-craftkit-study` (from `task/chb-002-contract` at 1641d4b, which carries all tickets).
- `docmgr ticket create-ticket --ticket CHB-016 --title "CraftKit Studio study: UI toolkit and JS DSL for a
  Lightroom-class studio" --topics ui,dsl,architecture,product`; `docmgr doc add --ticket CHB-016 --doc-type diary
  --title "Diary"`.
- Unzipped into `sources/`, then removed `dist/` and `test/perf/www/` (duplicates) and the zip itself; wrote
  `sources/README.md` with the zip's sha256 and what was left out. 127 files, 11 MB.
- `docmgr doctor --ticket CHB-016`: all checks passed.

### Why

- A new branch off `task/chb-002-contract` because the main checkout was on that branch and it holds every ticket;
  the study does not touch code, so it merges trivially.
- Dropping `dist/` and the perf copy keeps 7 MB of duplicated wasm and photos out of git; `build.mjs` regenerates
  `dist/`. The wasm crates in `vendor/wb/dist` stay, since the code cannot run without them.

### What worked

- The ticket and the import; doctor clean.

### What didn't work

- `cat a; echo =====; cat b` in zsh failed with `(eval):1: ===== not found` (zsh expands a word starting with `=`
  as a command path). Quoted the separator (`echo '-----'`) and re-ran.

### What I learned

- CraftKit Studio is Manuel's own work (docs name the CraftKit Shell design, LightCraft, PhotoCraft and the
  Workbench engine; design ids U-02…U-15, W-01…W-05, S-01…S-06). Its docs describe it as the shell's acceptance
  test: menus, keys, panels, undo, canvas and tools all come from one builder grammar.
- It is already a Lightroom-shaped app: Library (grid, loupe, compare, survey, flags, stars, collections, Quick
  Develop), Cull, Develop (LightCraft panels, presets with Amount, snapshots, per-photo history, crop, spot removal,
  brush/gradient masks, WB picker, before/after, reference view with Match), Export (batch queue), Prepress (soft
  proof, densitometer, preflight) and Print Shop.

### What was tricky to build

- N/A (import only).

### What warrants a second pair of eyes

- Whether the CraftKit Workbench engine (`vendor/wb`, wasm crates) may be vendored into chromobench beyond this
  reference copy; its licence is not stated in the zip.

### What should be done in the future

- Step 2: study the shell core (store, cells, history, commands, keys), forms, viewport, the Develop module and the
  engine bridge, and map them onto chromobench's contract, DSL and Studio plan.

### Code review instructions

- `sources/README.md`, then `sources/craftkit-studio/docs/README.md` and `docs/SHELL.md`.

### Technical details

- Zip sha256 `c7666aced5613a3ae03566a981945f06ced7e337e8466c2ad054fe1e83343a1e`; 275 entries, 32 116 431 bytes
  unpacked; 127 files kept.
