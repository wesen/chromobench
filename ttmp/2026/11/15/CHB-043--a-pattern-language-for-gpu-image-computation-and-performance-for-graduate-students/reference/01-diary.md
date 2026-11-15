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
