---
Title: Diary
Ticket: CHB-042
Status: active
Topics:
    - architecture
    - patterns
    - teaching
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T16:02:25.527019-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

The main diary of CHB-042: a second, general pattern language ("A Small Pattern Language for Modular Software") for
undergraduates, taught through the image editor (chromobench and the Editor lab), in docs/patterns/modular/. The
chapter writers keep their own diaries (02–06 in this folder).

## Step 1: Extraction map, the ten patterns, the overview

The owner asked for patterns about image-processing algorithms and frontend performance, drawn from the Editor lab
textbook, the Editor lab engine and chromobench's port. I surveyed the book (chapters 1–9, especially the "Toward a
reusable API" sections of 5–9), the Editor lab engine (engine.js, ~760 lines) and chromobench's gpu, core, ingest and
output packages, and presented an extraction map of twelve candidates (13–24, continuing the image-engine volume). The
owner redirected: more general, for undergraduates learning to build modular software, Gabriel and Alexander as the
lens, ten patterns. I chose ten general patterns, wrote the overview, started five writers, was asked to show the list
first, stopped the writers (none had written a chapter), showed the list, and the owner approved it unchanged.

### Prompt Context

**User prompt (verbatim):** "let's take a step back while things are being worked on, and extract patterns regarding CV algorithms processing and performance in the frontend, based on the textbook and the editor lab functionality and our porting to chromobench."

Then: "make them a bit more general, something for undergrad students to learn to build good modular software, think richard gabriel / christopher alexander as you design the pattern selection. Also, make 10"; "show me the 10 patterns you plan on writing before you start?"; "or did you already chose which patterns to do"; "perfect patterns, continue".

**Assistant interpretation:** A separate volume of ten general modular-design patterns, each with the image editor as
running example, written for students, in the GoF/Alexander template with exercises.

**Inferred user intent:** Teaching material that turns what was learned building chromobench into transferable design
lessons, judged by habitability and piecemeal growth rather than by image-processing cleverness.

### What I did
- Surveyed sizes and header comments: book chapter outlines, engine.js function list, packages/gpu (pool, tiles,
  timing, measure, limits, frame, layout, device, spatial, retouch, film, pipelines, tables/cache, chain, engine/lower),
  core (upsample, gamut, balance, masks, retouch, solve, engine-ref), ingest conditioning, output export.
- Checked which book mechanisms chromobench ported: no pyramid, no cost-aware cache, no frame-budget slicer; a WGSL
  linker (chain/wgsl-link.ts); device reductions (measure.ts, reduce.wgsl); residency (CHB-041).
- Created ticket CHB-042 and branch task/chb-042-modular-patterns (from task/pattern-language d4e30a2).
- Wrote docs/patterns/modular/00-overview.md: the ten names, three groups, conventions, map, sketch, other systems.
- Briefed five writers (chapters 1–2, 3–4, 5–6, 7–8, 9–10) with sources, template plus Exercises, privacy rule, diary.

### Why
- A separate volume: the audience (students) and the level (general modular design) differ from the image-engine
  volume, which stays for engine builders; the overview links up to it.
- The ten were chosen by Gabriel's test (does it make code habitable and allow piecemeal growth?) and portability
  (three other domains each). Separable running-sum kernels and the pyramid were dropped as image-specific.

### What worked
- The book's "Toward a reusable API" sections were the fastest map of candidates.

### What didn't work
- I started the writers before showing the revised list; the owner wanted to see it first. Stopped them within
  minutes; no chapter files had been written. Lesson: after a redirect that changes the selection, show the new list.

### What I learned
- The book's undo scenario: LRU recomputed 10,560 tiles, cost-aware eviction 2,662 (06.md line 172).

### What was tricky to build
- Choosing patterns general enough for students but still carried by real lessons from the code; each chapter's
  example must be a real decision or bug, not decoration.

### What warrants a second pair of eyes
- Overlap with the parent volume (chapter 1 here vs ../03-reference-oracle.md; 9 vs ../01; 6 vs ../04).

### What should be done in the future
- Fresh-eyes review of one chapter; mermaid check; consistency pass over all ten.

### Code review instructions
- Start at docs/patterns/modular/00-overview.md.

### Technical details
- Sources: chromobench integration worktree (scratchpad/chb037), Editor lab (scratchpad/editor-lab-src, untrusted,
  read-only).
