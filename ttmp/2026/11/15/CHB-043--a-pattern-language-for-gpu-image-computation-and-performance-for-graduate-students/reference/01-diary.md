---
Title: Diary
Ticket: CHB-043
Status: active
Topics:
    - architecture
    - patterns
    - gpu
    - performance
    - teaching
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T16:49:27.691378-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

The main diary of CHB-043: a third pattern volume, "Fast and Checkable: GPU Image Computation Patterns", for graduate
students, in docs/patterns/gpu/, built the same way as CHB-042 (overview, five writers, fresh-eyes review, revisions,
artifact). The writers keep their own diaries (02–06 in this folder).

## Step 1: From 22 candidates to ten, the overview, the shared brief, five writers

After the modular volume, the owner asked for a list aimed at graduate students and generic to GPU compute, computer
vision, numerics, performance and caching. I proposed 22 candidates in five groups (numbers, kernels, memory,
caching, measurement), marking overlaps with the earlier volumes; asked how I would cut it to ten, I merged candidates
that share one tension (precision and binding time; budget and proxies; deferred destruction and aliasing; keys,
early cutoff and cost-aware eviction; completion timing and percentile gates) and left slicing and ordered local
edits as notes. The owner approved the ten as written and asked for the same process as the first volume.

### Prompt Context

**User prompt (verbatim):** "ok, we kind of want a more webgpu/performance say, grad student targeted list of patterns. Here we really have some general patterns that are kind of well known. Think and make a proposal list, from which I can pick 10. They should still be generic, but generic to the domain of CV / webgpu / performance / number crunching / caching / etc..."

Then: "if you were to group/select these down to 10, what would you do?" and "perfect, write these out, same as first one".

**Assistant interpretation:** A graduate-level volume of ten domain-generic patterns, written and reviewed like
CHB-042, published as an artifact.

**Inferred user intent:** Teaching material at the level where the real engineering decisions of chromobench
(precision, residency, lifetimes, fusion, measurement) become transferable.

### What I did
- Branch task/chb-043-gpu-patterns (from task/chb-042-modular-patterns, so the build script is shared); ticket CHB-043.
- Wrote docs/patterns/gpu/00-overview.md: audience, the fast-and-checkable quality, GPU pseudocode notation
  (kernel/dispatch/submit/fence/upload/readback), map, sketch, a table across inference, rendering, simulation and
  video, further reading.
- Wrote playbooks/01-writer-brief.md: the template and every general lesson from the CHB-042 review up front
  (glossed terms, one meaning per word, general Solutions, sketch holes, exercises that implement, analyse and
  transfer), so this round should need a lighter revision.
- Started five writers (1–2, 3–4, 5–6, 7–8, 9–10), each with scope, sources, sibling chapters to go beyond, and a diary.

### Why
- The review lessons cost a whole revision round in CHB-042; putting them in the brief moves that work forward.

### What worked
- The shared brief keeps each writer's prompt short and the volume consistent.

### What didn't work
- N/A

### What I learned
- Merging by shared tension (not by topic) is what made ten candidates out of 22 without dropping lessons.

### What was tricky to build
- Keeping chapters 7–10 distinct from the modular volume's 8–10: the briefs ask for graduate depth (budget
  derivation, device timelines, key width, measurement bias) and links rather than repetition.

### What warrants a second pair of eyes
- Overlap with the image engine volume's chapters 5–8 and the modular volume's 5, 8–10.

### What should be done in the future
- Fresh-eyes review of two chapters; revisions; artifact.

### Code review instructions
- docs/patterns/gpu/00-overview.md; playbooks/01-writer-brief.md.

### Technical details
- Overview commit ed1eb5c.

## Step 2: Ten chapters, a graduate-level review, revisions, publication

The five writers delivered the ten chapters; each verified its claims against chromobench and the Editor lab and
kept a diary (02–06). A fresh reviewer, reading as a first-year PhD student with numerics background, reviewed
chapters 2 and 6 and checked their floating-point figures in Python. It found real technical errors, and its general
lessons (recompute every number, bounds versus measured maxima, precise device semantics, MiB, no internal IDs) went
to all five writers. All ten chapters were revised and the volume published as an artifact.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Same process as CHB-042, including the artifact with direct section jumps.

**Inferred user intent:** A graduate-level companion volume, published and shareable.

### What I did
- Committed each pair as delivered; checked template order, links, ratings, privacy and leftover task IDs.
- Review of chapters 2 and 6 → specific findings to those writers, general lessons to all; coordinated the working
  image size across chapters (4000 × 2674, 163 MiB; the CHB-041 diary's 2686 was a slip).
- Added CHB-037 tasks P10-10…P10-27 for chromobench debts found while writing (pool reuse before the last reader
  submits, grid-rule ties, three different Gaussians, readback costs, stopping test below f32 noise, and others);
  updated P10-15 with the re-derived figures.
- Built with build-artifact.py (`--dir gpu --title "Fast and Checkable"`, green accent) and published
  https://claude.ai/artifact/VbvkgS8uwaRhrpDk3ZghFV.

### Why
- The review's errors were of the kind graduate readers would catch first (a degenerate constant input hiding
  summation error, ±∞ sentinels WGSL does not allow, buffers that cannot be mapped, 24 MP vs 10.7 MP textures).

### What worked
- Writers recomputing their own numbers found further errors on their own (grid mismatches that are not only ties;
  the test-suite explanation used inputs the tests do not have; a 6 % three-box figure measured against the wrong
  Gaussian; a 1.1e-4 error called "a third of an 8-bit level" in a chromobench comment).

### What didn't work
- mermaid-cli was refused by the permission classifier for three writers and for me; the five diagrams were not
  rendered locally. A script for the owner: scratchpad/render-gpu-mermaid.sh. The artifact renders them natively.

### What I learned
- Putting the CHB-042 review lessons in the brief did not remove the need for a review at this level: the graduate
  review found numerical and API-semantics errors, a different class.

### What was tricky to build
- Keeping one set of figures across ten chapters written in parallel (working size, MiB vs MB).

### What warrants a second pair of eyes
- WGSL/Vulkan accuracy and semantics stated from memory (f32 division to 2.5 ulp, subnormal flushing, no infinities,
  mapAsync guarantees), and several known uses, as each writer's diary lists.
- Raw word counts 3,450–4,060 (sketches); prose is ≤ ~3,000 in every chapter.

### What should be done in the future
- Render the diagrams locally once permitted; check the artifact's diagrams on the page.
- Fix the correctness debts P10-10 and P10-15 in chromobench.

### Code review instructions
- docs/patterns/gpu/*.md; writer diaries 02–06; CHB-037 tasks P10-10…27.

### Technical details
- Commits ed1eb5c … 26cadf7 on task/chb-043-gpu-patterns.
