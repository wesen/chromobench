---
Title: 'Digital editing tools from Editor lab: layers, groups, masks, workspaces in the UI DSL, and Editor lab''s performance architecture'
Ticket: CHB-035
Status: active
Topics:
    - ui
    - webgpu
    - architecture
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-14T16:42:56.479834-05:00
WhatFor: ""
WhenToUse: ""
---

# Digital editing tools from Editor lab: layers, groups, masks, workspaces in the UI DSL, and Editor lab's performance architecture

## Overview

Analysis of Editor lab (`~/Downloads/editor-lab-work.zip`: a tiled, content-cached browser photo editor with layers,
groups, Lightroom-style masks, presets, a scripting API, and a nine-chapter textbook on engine performance) against
chromobench, in two intern-level design documents:

- `design/01-digital-editing-in-chromobench.md`: the fundamentals of layer-based editing; what Editor lab built and
  what to reuse (and its defects); where digital edits belong in the physical pipeline (scene, darkroom, finished
  print; primary home after the print); a digital layer stack in the recipe; ops, engines, parity; the edit kit in
  the UI DSL and workspace arrangements; phased plan.
- `design/02-editor-lab-performance-architecture.md`: tiles, pyramids, content keys, eviction, scheduling, GPU/WASM,
  open-loop measurement; Editor lab built vs designed; chromobench's engines as they are, with M1 Max measurements;
  ranked changes (open-loop bench, GPU residency, source pyramid, checkpoints, …).

The diary (`diary/01-diary.md`) records the research. Uploaded to reMarkable as one bundle.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- ui
- gpu
- design

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
