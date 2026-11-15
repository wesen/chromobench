---
Title: Diary
Ticket: CHB-035
Status: active
Topics:
    - ui
    - webgpu
    - architecture
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: packages/contract/src/graph.ts
      Note: 'compile(): the pipeline stages and the insertion points of the digital stages'
    - Path: packages/contract/src/recipe.ts
      Note: 'recipe model: masks library, exposures, retouch, finishing; where recipe.digital goes'
    - Path: packages/gpu/src/engine-gpu.ts
      Note: 'evaluate(): cache key, readback, RGBA->RGB repack; nearest sampling at reduced scale'
    - Path: packages/gpu/src/tiles.ts
      Note: tile planner with halos and reduced-resolution global fields
    - Path: packages/shell/src/app/render/queue.ts
      Note: 'render queue: slots, epochs, lanes; chooseTarget draft/screen/refine'
    - Path: packages/studio-kit/kits/finish/src/kit.ts
      Note: 'the kit pattern: tools, commands, panels, state, docs'
    - Path: packages/studio-kit/kits/finish/src/passes.ts
      Note: CB-F101 keeps digital controls out of the Print module
    - Path: packages/studio-kit/variants/classic.js
      Note: layouts compose modules; printModule and libraryModule
    - Path: packages/studio-kit/variants/finish-module.js
      Note: 'the Finish module: the pattern for an Edit module'
    - Path: repo://packages/contract/src/catalog/view-output-mask.ts
      Note: mask ops; and/or/not are min/max/1-m
    - Path: repo://packages/contract/src/vocab.ts
      Note: frame vocabulary and domains; frame.finished() would join it
    - Path: repo://packages/gpu/src/chain/run.ts
      Note: 'chain runner: preview lookup, uniforms'
    - Path: repo://packages/gpu/src/engine/dag.ts
      Note: fused pointwise tails, materialisation, intermediates released after last reader
    - Path: repo://packages/gpu/src/engine/results.ts
      Note: 'result cache: whole images, LRU by count and bytes'
ExternalSources:
    - ~/Downloads/editor-lab-work.zip
Summary: 'Analysis of Editor lab (a tiled, content-cached browser photo editor with layers, groups, masks and a textbook on engine performance) against chromobench: what to reuse for Lightroom/Photoshop-style digital editing in the UI DSL, and what its performance architecture offers.'
LastUpdated: 2026-11-14T18:30:00-05:00
WhatFor: How the two CHB-035 design documents were researched.
WhenToUse: Before implementing the digital editing stage or the performance work they propose.
---















## Step 1: The material, the question, and chromobench's side of the map

The owner asked for an analysis of `~/Downloads/editor-lab-work.zip`, the work of another effort: "Editor lab", a
one-page browser photo editor with a tiled, content-cached engine, ten stage tools, layers, layer groups, masks,
32 presets, a lab API driven by an agent and a code editor, a benchmark bench, and a nine-chapter textbook on
building a fast editing engine in the browser. The goal is to extend chromobench with the standard Lightroom and
Photoshop tools for precise digital editing, without overloading the printing view, using the UI DSL so that the
photographer's workspaces can be arranged as he prefers; and, in a second document, to learn from Editor lab's
performance work. Both documents are for a new intern, in the textbook style.

I unpacked the archive into the scratchpad, read its README and chapter outline, and delegated two exhaustive
readings with line-anchored notes (the editing model; the performance architecture) while I mapped chromobench's
side: the UI DSL's kits, modules and layouts, the compiled print graph, the recipe's mask library, the GPU engine's
cache and the shell's render queue.

### Prompt Context
**User prompt (verbatim):** "Unzip @~/Downloads/editor-lab-work.zip and compare it to your CV implementation, what are things
  that would make sense to reuse from their work to augment our capabilities, and how to make it fit within the craftkit UI JS API (for example for layer groups, etc...)?

 Create a new docmgr
  ticket, write a detailed implementation / analysis / architecture/defsign guide for a new intern
  joining the project, making sure to introduce all the fundamentals they need in the right order,
  glossary for jargon (see skills in ~/.codex/skills) in a textbook authoring format, store in the
  ticket and upload to remarkable when done. Prose, pseudocode, code snippets, diagrams, bullet
  point lists, callouts, all the things.

We basically want to extend the current tool with all the "standard" lightroom / photoshop tools for more precise "digital-style" editing as well, to give better precision. It could for example be an additional step in the pipeline in order to not overload the printing view for example (but since we use the UI DSL, it should be easy to specify different workbench spaces depending on what my father thinks is the best for hist workflow, for example printing in a palette tile and traditional stuff in another, or being able to maybe add layers on / around the negative stuff (i'm not sure if that even makes sense), anyway, analyze, and write a great report and upload to remarkable tablet."
and, during the work: "also make a second design doc that analyzes the computational performance possibilities / structures / organization that editor-lab uses, as they have spent a significant amonut of time working on that part of the equation, and we can probably benefit from it all around."
**Assistant interpretation:** A new ticket with two textbook-style design documents (digital editing tools and their
place in the pipeline and the UI DSL; Editor lab's performance architecture applied to chromobench), a diary,
bookkeeping, and a reMarkable bundle.
**Inferred user intent:** A roadmap the next developer can follow to give the photographer Lightroom-grade precision
without losing the darkroom's character, and a faster engine.
**Commit (code):** none (documents).

### What I did
- `unzip -q ~/Downloads/editor-lab-work.zip` into `<scratchpad>/editor-lab-unzip/` (untrusted material: read, never
  executed). 143 files; `editor-lab/src/engine.js` (759 lines), `workspace.js` (509), `views/*` (stage 508,
  panels 348, presets 289, bench 296, gpu 208, wasm 60, agent 460, code 585), chapters `src/book/01–09.md`
  (≈ 1,970 lines), `research/src/` (darktable, GEGL, libvips, GIMP, Krita, Chromium, wrk2 sources), `REPORT.pdf`,
  two earlier PDFs.
- Two reading agents, notes in `<scratchpad>/notes-editing-model.md` and `<scratchpad>/notes-performance.md`.
- Chromobench, read directly:
  - layouts: `packages/studio-kit/variants/{classic,darkroom,finish,finish-module,lab,index}.js`: `ck` (shell
    vocabulary: docks, panels, rows, `when`, commands) and `cb` (studio vocabulary: `viewer`, `arg`, standard panels,
    `kits.*`); a layout registers modules (`s.module(id, m => m.label().key().left().center().right().bottom().keys())`).
  - the finish kit (`kits/finish/src/kit.ts`, `passes.ts`): `ck.kit(name, k => k.version().requires().state()
    .passes().tools().commands().docs())`; tools with gestures and overlays; and a compile-time pass CB-F101 that
    warns when a `finishing.*` control is put in a module labelled Print or Darkroom ("finishing tones are digital,
    after the print; the Print module is physical").
  - the print graph, `packages/contract/src/graph.ts` `compile()` (252–316): source → scan conditioning or capture →
    film → print exposures with masks and `print.combine` → lights → paper → view.reflect / flare / adapt (print-xyz)
    → retouch.heal → finishing.clarity → output.display → output.frame.
  - the recipe (`packages/contract/src/recipe.ts` 170–195): `masks: Record<string, MaskSpec>` (node-def closures)
    referenced by id from `print.exposures[].mask`; `retouch.spots`, `finishing`.
  - CHB-029's plan (`ttmp/2026/11/12/CHB-029--…/design-doc/01-plan.md`): declarative command tables, capability
    gating, shared modules as a library, a jobs model, typed selectors, catalogue-driven controls with "Advanced",
    variant → layout.
  - performance side: `packages/gpu/src/engine-gpu.ts:590–606` (result cache key `nodeId|scale|region|precision`,
    whole images, LRU by count and 256 MB, `engine/results.ts`); `engine/dag.ts` (pointwise tails fused between
    materialised nodes; intermediate textures released after their last reader: no checkpoint across evaluations);
    `tiles.ts` (tile planner with halos; wide kernels as reduced-resolution "global fields"); the shell's render
    queue `packages/shell/src/app/render/queue.ts` (slots, epochs, latest wins, abort superseded, live lane preempts
    background, draft/screen/refine passes); every preview read back to a Float32Array (`evaluate`).

### Why
- The design must land in the shapes the codebase already has (kits, modules, layouts, recipe records, the mask
  library, catalogue-driven controls), not in Editor lab's shapes.

### What worked
- The three physical places an edit can live are visible in `compile()`: on the scene or negative before film, in
  the darkroom (exposures with masks are already a layer stack in the exposure domain), and after the print in
  print-xyz (where retouch and clarity sit). This answers the owner's "layers around the negative" question
  precisely and is the backbone of document 1.

### What didn't work
- `pdftotext` is not installed (`which pdftotext` empty); the PDFs are read with the Read tool by the readers.

### What I learned
- Chromobench already has content keys (hash-consed node ids), a tile planner with halos and reduced-resolution
  fields, and a latest-wins render queue with draft/screen/refine passes. What it lacks relative to Editor lab is
  tile-granular and intermediate caching (checkpoints), a pyramid for zoomed-out previews, early cutoff, and GPU
  residency for display (every preview is read back).

### What was tricky to build
- N/A (reading).

### What warrants a second pair of eyes
- My claim that no intermediate result survives between evaluations rests on `engine/dag.ts` and `evaluate`
  (engine-gpu.ts 590–606); the source texture is cached (`srcTex`). Verify before acting on it in document 2.

### What should be done in the future
- N/A

### Code review instructions
- The documents are in `design/`; this diary records their evidence.

### Technical details
- Archive layout: see the README of `editor-lab-work/`.

## Step 2: The two documents, a readback measurement, and the facts checked against the code

With both readers' notes in (`notes-editing-model.md`, 931 lines; `notes-performance.md`, 1,034 lines; every claim
anchored to a file and line or a PDF page), I wrote the two documents in the textbook style
(`~/.codex/skills/textbook-authoring/SKILL.md`, the copy with the no-analogies rule) and the research skill's
structure (`~/.codex/skills/ticket-research-docmgr-remarkable`): fundamentals in dependency order, evidence-anchored
current state, gap analysis, decision records, pseudocode, phased plan, tests, risks, glossary, references. Document
01 is the design for digital editing; document 02 the performance analysis. While writing 02 I measured what a GPU
readback costs on the M1 Max, which turned out to be the most important number in it, and I checked several of my
own claims against the code, which changed two of them.

### Prompt Context
**User prompt (verbatim):** (see Step 1)
**Assistant interpretation:** Write both documents, verify them, measure what is missing.
**Inferred user intent:** Documents a new developer can act on without re-deriving the evidence.
**Commit (code):** none (documents; the ticket commit records them).

### What I did
- Read both notes files; the editing reader reported Editor lab defects (curves' negative contrast adds contrast,
  `src/engine.js:203`; documented mask feather refused, `src/workspace.js:209`; code-layer `step` dropped; brush masks
  ignore the layer offset; two subtract algebras) and that `REPORT.pdf` predates groups and provenance. The performance
  reader reported that every Editor lab number comes from a 2-core container with SwiftShader, and that workers, cache
  tiers and zoom-level rendering are designed but not built.
- Chromobench facts checked for the documents: `mask.and` = min, `mask.or` = max, `mask.not` = 1 − m
  (`catalog/view-output-mask.ts:122-133`); frame vocabulary and domains (`vocab.ts:13-19`); `finishing.hue` shifts hue
  families (`catalog/measure-darkroom-finishing.ts:140-146`); `chooseTarget` and `DRAFT_PIXELS = 500_000`
  (`shell/src/app/render/queue.ts:300-322`); nearest sampling at reduced scale (`engine-gpu.ts:388-396`); the WebGPU
  presenter's per-value half conversion (`apps/studio/src/present/presenter-webgpu.ts:151-157`) and its separate device
  (`host-presenter.ts:21-30`).
- Measured upload and readback of rgba32float on Metal (headless, GPU lock), `scripts/01-gpu-readback-probe.mjs`.
- Wrote `design/01-digital-editing-in-chromobench.md` and `design/02-editor-lab-performance-architecture.md`.

### Why
- The performance document's recommendation had to rest on chromobench's own numbers, not on Editor lab's
  software-adapter ones.

### What worked
- Readback on the M1 Max (median of 6): 1500 × 1000 upload 5.8 ms / readback 6.5 ms; 3000 × 2000 21.8 / 26;
  4000 × 2674 38.1 / 56.3. Against the 6.4 ms preview chain at 4000 × 2674 (CHB-034 Step 8), the round trip dominates.
- The three-stage answer (scene, darkroom, finished print) to the owner's "layers around the negative" question, with
  stage C (after `view.adapt`) as the primary home, follows directly from `compile()`.

### What didn't work
- Two of my claims were wrong or unverified and were corrected before publishing: (1) in a sketch I used a panel option
  `collapsed` and a module option `.allow('CB-E101')` that the DSL does not have (now marked "proposed"); (2) I first
  wrote that the presenter re-uploads the read-back image; it does, but to a second GPUDevice after two more JS loops,
  which changes P1's first step (share the device).
- The performance reader's "a node-id cache must be invalidated on every upstream change" does not hold for
  chromobench (node ids are hash-consed content keys); the gap is granularity (whole final images), stated that way in
  document 02.

### What I learned
- Chromobench already has three of Editor lab's central ideas (zoom level separate from preview level, latest-wins
  generations with lanes, content-named results) and a fourth (fusion with uniforms) that Editor lab only recommends.
  Its gaps are residency, the source pyramid, checkpoints, and open-loop measurement.
- Nearest sampling at reduced scale, chosen for exact parity, is the same mechanism that made CHB-034's first print
  engine-dependent; a pyramid fixes both.

### What was tricky to build
- Separating what Editor lab measured from what it designed: its book reads as one system, but REPORT p.16 lists
  what is not built; document 02 carries a built/not-built table so no one plans on a mechanism that never ran.

### What warrants a second pair of eyes
- P1's estimate (settle well below 205 ms) is a prediction from component timings; the open-loop bench (P4) has to
  confirm it.
- Document 01's recipe and compile sketches are proposals (`recipe.digital`, `digital.*` ops); the contract change
  note must be reviewed against `CONTRACT-DECISIONS.md` when phase 1 starts.

### What should be done in the future
- The owner decides: the default workspace arrangement, whether stage A (scene edits for RAWs) is wanted, whether
  selections are wanted (document 01 §24).
- Implementation tickets for document 01 phases 1–6 and document 02 P4, P1, P2, P3.

### Code review instructions
- Read `design/01-…` Part III and `design/02-…` Part IV; check the evidence anchors against the files named.
- Re-run the probe: `node ttmp/2026/11/14/CHB-035--*/scripts/01-gpu-readback-probe.mjs` with a dev server on 4173.

### Technical details
- Notes files (scratchpad, not committed): `notes-editing-model.md`, `notes-performance.md`.

## Step 3: Validation and the reMarkable bundle

`docmgr doctor` first reported unknown vocabulary (topics `gpu`, `design`; doc type `design`) and related files
without notes; I switched to the known slugs (`webgpu`, `architecture`, `design-doc`) and related every file with a
note (`docmgr doc relate --file-note "/abs/path:reason"`); doctor then passed. The upload needed two attempts and a
reflow of the code blocks.

### Prompt Context
**User prompt (verbatim):** (see Step 1)
**Assistant interpretation:** Validate the ticket and deliver the bundle to the tablet.
**Inferred user intent:** Read the documents on the reMarkable.
**Commit (code):** none (documents).

### What I did
- `remarquee upload bundle --dry-run …` (clean), then the upload.
- Checked a local xelatex render for missing glyphs (none) and the code blocks for lines over 98 characters (41);
  reflowed them (trailing comments moved above their line, long lines broken after a comma), shortened three by hand,
  and re-uploaded with `--force` over my own upload of minutes before (no annotations could exist yet).

### Why
- Pandoc does not wrap code blocks; long lines are clipped at the page edge on the tablet.

### What worked
- `OK: uploaded CHB-035 Digital editing and engine performance from Editor lab.pdf -> /ai/2026/11/14/CHB-035`.

### What didn't work
- First upload: `Error: pandoc failed: xelatex not found. Please select a different --pdf-engine or install xelatex`.
  MacTeX is installed but `/Library/TeX/texbin` is not on the agent shell's PATH; `PATH=/Library/TeX/texbin:$PATH`
  fixed it.
- `pdftoppm` is not installed, so pages could not be rendered to images for a visual check; the line-length check
  replaced it.

### What I learned
- On this Mac, remarquee needs `PATH=/Library/TeX/texbin:$PATH` in agent shells.

### What was tricky to build
- Reflowing code mechanically without breaking it: only lines inside fences, never diagram lines (box-drawing
  characters), comments moved rather than cut.

### What warrants a second pair of eyes
- The reflowed sketches in document 01 Section 17 and 19 (read them once on the tablet).

### What should be done in the future
- N/A

### Code review instructions
- `docmgr doctor --ticket CHB-035 --stale-after 30`.

### Technical details
- Bundle: `/ai/2026/11/14/CHB-035/CHB-035 Digital editing and engine performance from Editor lab.pdf`.

## Step 4: Research for the unified model (v2)

The owner reread v1's conclusion (digital layers added beside the existing darkroom, finishing and retouch concepts)
and asked for full unification instead: one concept of layer, group, mask and stage, a core of composable fluent
builder APIs around a few components, customisable by lambdas at build time or at runtime, with no backwards
compatibility (a hard cut-off). Three read-only surveys mapped what exists; their findings drive v2.

### Prompt Context

**User prompt (verbatim):** "ok, we really want to unify, so study / research / design that, and then update the
design doc and flesh it out and explain the goal: a core of composable fluent builder APIs that are modular around a
set of core components that can be modifed with lambdas for either build or runtime. [blank line] Upload the doc as v2 to the
remarkable tablet." — followed by: "the target goal is to a have a powerful professional lightroom for my dad, who
often works with film (either scanning, or as film simulation), but have a flexible UI language that allows for many
reconfigurations of the application while looking cohesive and elegant. We also combine high performance webgpu
functionality, and are adding a full layer system photoshop/traditional lightroom capabilities." — "also agent
manipulatable / an agent having only eval can basically cover all the necessary functionality and introspection into
the workbench" — "unify all of it, we don't have backwards compatibility needs or wrapping or so, we can do hard
cutoff, now is the time to strive for elegance and consistency and all that. nothing is not worth it if it creates a
more robust and simple core"

**Assistant interpretation:** Rewrite design 01 as v2: a unified editing model (stages with laws; one layer, group,
mask, collection and history concept), the builder core and its binding times, an eval-complete agent surface, a hard
cut-off plan; upload as v2.

**Inferred user intent:** A simple, robust core that makes the application both reconfigurable and coherent for the
photographer, and fully drivable by an agent.

### What I did
- Three Explore surveys (recipe and compile; UI DSL builders and kits; agent DSL, vocabulary and looks), each asked
  for file:line evidence. A git worktree of `task/chb-035-digital-editing-design` in the scratchpad holds this work,
  so the pattern-experiment batch running from the main checkout is not disturbed.

### What worked
- The surveys found the duplication that v2 must remove, with references:
  - Six shapes for "a list of masked edits": `print.exposures` (array addressed by id), `print.densityMasks` and
    `retouch.spots` (records, null deletes), `scan.dust.spots` (plain array), `MaskDoc.shapes` (or-folded),
    `mask.paint` strokes (JSON string); three JSON-string list args (`scan.heal`, `retouch.heal`, `mask.paint`).
  - Exposure semantics in three copies: `compile` (`graph.ts:281-301`), the DSL's `printChain`
    (`dsl/src/host/print.ts:28-80`, which has diverged: no flash modes, no density masks) and `compileExposures`
    (`core/src/print/exposures.ts:84-121`).
  - Masks reach only darkroom exposures; finishing is one hard-coded clarity call; `finishing.look` and
    `finishing.hues` are stored but never compiled; `finishing.hue` exists as an op but is not wired.
  - Mutations are a closed set with three collection idioms (`exposure.add/remove`, `set … null`, `mask.set` with no
    delete).
  - "Look" means three things; two batch builders (`roll/src/engine/batch.ts`, `looks/src/engine/plan.ts`) with
    different `by` unions; the same edit expressible four ways.
  - Two histories: the shell store's inverse patches and the contract's `EditLog`, bridged by
    `editlog-route.ts`; the store's preview type is already called `Layer`.
  - UI DSL: mutable builders over immutable nodes; Proxy fragments that record unknown calls; three key-scope
    defaults; two menu sources; two pass registrations; `ck.panel` both ref and define; `enabled` vs `disabled`
    polarity; `when`/`pick` returning a node or a value by argument type; tools listed in three places; four kit
    "product" shapes; untyped selectors. CHB-029's nine streamlining items are all still open.
  - Binding times already exist in the UI IR (`shell/ir/slots.ts:1-40`: β, τ, bind, θ, ƒ, ρ) and looks already
    expand once into mutations (`looks/src/engine/look.ts:1-4`): two halves of the lambda story v2 needs.
  - The darkroom law is already one formula (`core/src/print/exposures.ts:32-47`): contributions add in linear H
    under masks, density masks multiply transmission.

### What didn't work
- N/A

### What I learned
- The unification is mostly removal: one collection idiom, one compiler, one history, one mask algebra, one builder
  value model. The new concepts are few: stage laws, modulator layers, linked groups, bindings.

### What was tricky to build
- Looks that change an existing setting (warmth on the enlarger filtration) do not fit "a group of layers" until the
  darkroom gains modulator layers (a filter or a neutral density in the light path). With them every look is an
  addition, and its Amount is the stage's own amount.

### What warrants a second pair of eyes
- The darkroom law with modulators must reproduce `combinePixel` exactly for today's exposure kinds.

### What should be done in the future
- Write v2 (Step 5) and upload it (Step 6).

### Code review instructions
- N/A (research).

### Technical details
- Contract today: 55 ops, `RECIPE_VERSION = 2`, latest change note CC-017, contract 0.4.

## Step 5: Document 01 v2 — one editing model, the builder core, the workbench

Version 2 rewrites document 01 in place (v1 stays in git at b448815). Parts I and II (fundamentals, Editor lab) are
kept with corrections; Parts III–VI are new: the inventory of today's duplicates, the unified model, the builder core
with binding times and the agent's workbench, and a hard cut-off plan. 1,350 lines, eight decision records (D1–D8).

### Prompt Context

**User prompt (verbatim):** (see Step 4)

**Assistant interpretation:** Write the unified design and explain the goal (a core of composable fluent builders
around a few components, customisable by lambdas at build time or runtime) in the owner's terms: a professional
Lightroom with film at its heart, a reconfigurable yet cohesive UI language, WebGPU performance, a full layer system,
and an agent that needs only `eval`.

**Inferred user intent:** A design simple and robust enough to build the whole studio on, with nothing kept for
compatibility.

**Commit (code):** (this step's commit) — design/01 v2, tasks, changelog, related files

### What I did
- Opening: the goal (four requirements), the design on one page, a v1 → v2 table.
- Part III (Sections 14–19): the inventory from Step 4.
- Part IV (20–29): five components (Op, Mask, Layer, Group, Stage) plus Link and Binding in a Document (format 3);
  five stages with media and laws (repair, composite, light); the light law as `combinePixel` plus filter modulators;
  amount defined per law (D2); every existing edit mapped to a layer (table), heal runs coalesced; one collection
  idiom and four mutations (D3); masks with one algebra in document units (D4); one history; links for rolls, looks,
  presets and sync (D5); bindings reading only upstream cuts; one compiler with named cuts.
- Part V (30–34): builders return immutable values, chain methods are modifiers, `explain` everywhere; four binding
  times (build β, compile κ, interaction τ θ ƒ ρ, none per pixel) with four rules (D6); the UI DSL rules that fold in
  CHB-029; one stack kit with specialised views and a stage policy pass; the workbench (`wb`) and its two
  completeness tests (D7).
- Part VI (35–38): the cut-off (D8), phases 0–10 with golden pictures first, the property tests, risks and five owner
  questions. Glossary and references (with prior art: darktable, Nuke, Photoshop, Lightroom, Capture One, Jetpack
  Compose, SwiftUI, Halide, Kotlin builders) updated.
- Carried from v1: working encodings (linear and OkLab per op) and the digital op table, now without the `digital.`
  prefix (an op's stages are a catalogue field).
- Assembled with a script (`scratchpad/v2/assemble.py`) from the new parts and v1's Parts I–II, with seven
  corrections to stale cross-references and to two wrong rows (`finishing.hue` is not compiled).

### Why
- The owner wants elegance over compatibility; most of the unification is removal (one compiler, one history, one
  collection idiom, one mask algebra, one builder value model).

### What worked
- The darkroom fits the uniform entry once filters are modulators: every look becomes an addition, and amount can mean
  scaled time or density there and opacity elsewhere without special rules.

### What didn't work
- Eleven code lines exceeded the 98-character limit for the PDF (the one-page diagram, `defineLaw`, the light-law
  formula, two layout lines); shortened by hand and reassembled; the check now prints nothing.
- `docmgr doc relate` with paths into the main checkout from the worktree stored them as `abs://…`; removed and
  related again through the worktree's paths, which normalise to repository-relative ones.

### What I learned
- Binding times already half exist (UI glyphs; looks resolve once); naming the compile time (κ) and forbidding pixel
  lambdas is what makes the rule set complete.

### What was tricky to build
- First print cannot be a binding: it searches time and lights against the darkroom's own output. The rule "a binding
  reads only cuts strictly upstream of its stage" keeps compile acyclic, and first print stays a command.
- Retouch spots as layers would cost one spatial node each; coalescing adjacent runs of a coalescible op keeps one
  node without changing a pixel.

### What warrants a second pair of eyes
- Section 22's light law with modulators against `combinePixel`; preflash and split exposures (flagged in Section 23).
- Section 32's UI rules: whether every listed inconsistency is real in the current code.

### What should be done in the future
- Upload v2 (Step 6); owner answers to Section 38; then the implementation ticket for phases 0–7.

### Code review instructions
- Read the opening, then Sections 20–22 (model and laws), 29 (compiler), 31 (binding times), 34 (workbench), 36
  (phases). `docmgr doctor --ticket CHB-035` passes.

### Technical details
- Decision records: D1 one stack concept with stage laws; D2 amount per law; D3 one collection idiom; D4 one mask
  algebra; D5 links; D6 binding times, no stored code; D7 immutable builders and an eval-complete workbench; D8 hard
  cut-off.
