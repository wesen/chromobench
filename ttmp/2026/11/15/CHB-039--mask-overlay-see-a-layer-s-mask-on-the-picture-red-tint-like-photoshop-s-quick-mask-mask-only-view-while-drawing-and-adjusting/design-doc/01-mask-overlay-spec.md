---
Title: 'Mask overlay: spec'
Ticket: CHB-039
Status: active
Topics:
    - ui
    - webgpu
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T14:25:12.037342-05:00
WhatFor: ""
WhenToUse: ""
---

# Mask overlay: spec

## Executive Summary

<!-- Provide a high-level overview of the design proposal -->

## Problem Statement

<!-- Describe the problem this design addresses -->

## Proposed Solution

<!-- Describe the proposed solution in detail -->

## Design Decisions

<!-- Document key design decisions and rationale -->

## Alternatives Considered

<!-- List alternative approaches that were considered and why they were rejected -->

## Implementation Plan

<!-- Outline the steps to implement this design -->

## Open Questions

<!-- List any unresolved questions or concerns -->

## References

<!-- Link to related documents, RFCs, or external resources -->
# Mask overlay

Owner's request (2026-11-15): "can we see masks like in photoshop like as a red overlay or so?"

Today the viewer draws only vector outlines of a mask component while its tool is active (stack kit
`commands.ts` `outline(...)`); there is no view of a mask's coverage.

## What to build

1. **Show the selected entry's mask on the picture**: a coverage overlay (red by default, like Photoshop's quick mask
   and Lightroom's mask overlay) composited over the viewer, opacity adjustable (≈ 50 %), colour choosable
   (red, green, white, black), inverted display optional ("show what is not affected").
2. **Mask-only view**: the mask alone as greyscale (white = full effect), like Alt-clicking a mask thumbnail.
3. **When it shows**: toggle with a key (O, as in Lightroom) and from the mask chip / masks panel; automatically
   while a mask tool is drawing and while a mask or component parameter is being dragged; per stage and entry
   (the darkroom's dodges and burns, the print's layers, the scene's layers).
4. **What it shows**: the mask exactly as the engine applies it — the compiled mask node (components, the one algebra,
   feather, invert, what it reads) evaluated by the active engine at the viewer's resolution, not a separate drawing
   path; for a group's mask or a masked group, the group's coverage. Fast enough to follow a drag on the GPU.
5. **Agent and commands**: the overlay state is view state with commands (`mask.overlay.toggle`, `.mode`,
   `.colour`, `.opacity`), reachable through `wb`.

## Acceptance

typecheck, lint, gen:check, vitest, goldens; browser specs headless (ports 5521–5524): toggling shows a tint where
the mask covers and none elsewhere (pixel checks on a synthetic scene), mask-only view greyscale values match the
engine's mask node, the overlay follows a parameter drag; one look and feel with the stack kit.
