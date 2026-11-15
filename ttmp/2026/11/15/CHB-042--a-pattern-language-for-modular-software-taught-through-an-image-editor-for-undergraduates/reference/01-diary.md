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

## Step 2: Ten chapters written, reviewed by a fresh reader, revised, published

Five writers (two chapters each) wrote the ten chapters against the overview, each verifying claims against the
chromobench integration worktree and the Editor lab source and keeping a diary (02–06 in this folder). A separate
agent, which had not seen the drafting, read chapters 3 and 8 as a second-year student. Its findings were sent to
those chapters' writers, and its general lessons to all five; every chapter was revised. The volume is published as
an artifact with a sidebar that lists each chapter's sections and jumps to them directly.

### Prompt Context

**User prompt (verbatim):** "publish them as artifact as well, when done, with direct scroll (not smooth) to sections when selected."

**Assistant interpretation:** One page for the volume; the sidebar navigates to sections; no smooth scrolling.

**Inferred user intent:** A shareable, readable version of the course that is quick to move around in.

### What I did
- Committed each pair of chapters as it came back; normalised the rating line across chapters; corrected two overview
  sketch lines (fallback for 7, budget comment for 8) and the release comment (review).
- Checked: 16 sections in order in every chapter, all relative links resolve, privacy grep empty, all ten mermaid
  diagrams render (mermaid-cli 11.4.2, headless).
- Fresh-eyes review of chapters 3 and 8; revisions of all ten (notes cut 16–26 %, jargon glossed, Solutions made
  general, non-image participants named, sketches completed, check-writing exercises).
- Added CHB-037 tasks P10-1…9 for the chromobench debts the writers found.
- Generalised docs/patterns/build-artifact.py: `--dir/--title/--sub/--accent`, review page only when present, section
  ids prefixed per chapter, a section list under the chapter in view, instant jumps (`scroll-behavior: auto`,
  `scrollIntoView({behavior: 'instant'})`). Built and published https://claude.ai/artifact/Bk6PoW4BrDaLyqTCHiXCfD.

### Why
- The review found errors no writer had seen (identity vs zero; a use-after-retire hole in chapter 8's sketch; "frame"
  with two meanings; MB vs MiB), and patterns of excess (project history, jargon) common to all chapters.

### What worked
- Sending one reviewer's general lessons to all writers: every writer found and fixed its own sketch holes (chapter 6's
  export loop rewrote earlier rows; chapter 9's cache could evict an entry being read; chapter 1's engine chooser fell
  off the end).

### What didn't work
- `comm` over `sort`ed id lists reported false dangling anchors (locale ordering); a set comparison in Python showed none.

### What I learned
- The writers' verification turned up nine real chromobench debts (P10-1…9), among them heal coefficients re-solved
  on every render, no time-to-picture gate, and engine abilities outside the Engine contract.

### What was tricky to build
- Unique section anchors on one page: pandoc makes ids per file (`intent` in every chapter); the build prefixes them
  with the chapter (`ch-03-intent`) and rewrites in-chapter links to match.

### What warrants a second pair of eyes
- Chapters 7 and 8 are ~3,200–3,500 words raw because their sketches grew; prose is under 2,800.
- Known uses were written from the writers' knowledge, not re-fetched; each writer's diary lists them.

### What should be done in the future
- Optionally rebuild the Image Engine Patterns artifact with the new section navigation.
- A construction experiment for one of these chapters, as done for the engine volume.

### Code review instructions
- docs/patterns/modular/*.md; docs/patterns/build-artifact.py; writer diaries 02–06.
- Rebuild: `python3 docs/patterns/build-artifact.py OUT --dir modular --title "A Small Pattern Language for Modular
  Software" --sub "Ten patterns for software people can live in, taught through an image editor" --accent
  "#1f5f8b,#7cb8e0,#e2edf5,#1b2a36"`.

### Technical details
- Commits on task/chb-042-modular-patterns: c6489d1 … b714cb2, plus this step.
