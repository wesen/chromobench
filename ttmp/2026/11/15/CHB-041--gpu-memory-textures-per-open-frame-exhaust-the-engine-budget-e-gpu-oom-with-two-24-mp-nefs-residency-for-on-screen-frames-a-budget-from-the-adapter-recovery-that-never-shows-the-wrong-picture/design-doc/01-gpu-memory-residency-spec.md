---
Title: 'GPU memory residency: spec'
Ticket: CHB-041
Status: active
Topics:
    - webgpu
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T15:19:51.814579-05:00
WhatFor: ""
WhenToUse: ""
---

# GPU memory residency: spec

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
# GPU memory residency

Found by the CHB-038 journal (2026-11-15): with two of the photographer's 24 MP NEFs open at the default working size
(4000 px), renders fail with `E_GPU_OOM` ("film.camMatrix.0 … 525083680 of 536870912 live"), 6× in the main viewer and
once in Finish; each open camera file keeps a full-size texture (≈ 171 MB) inside the engine's 512 MB budget. The
persona session saw the same after ~6 frames on SwiftShader, and the failed frame showed the previous picture under the
new name (CHB-037 P9-11).

## What to build

1. **Residency per frame**: GPU textures (sources, cached intermediates, fields) of frames not on screen are evicted
   first (LRU across frames, the viewer's current frame and its visible thumbnails pinned); a frame's source texture is
   re-uploaded when it comes back. Thumbnails render at their size without keeping full-size textures resident.
2. **A budget from the adapter**: size the engine's budget from the device's limits and a safe fraction of what the
   platform allows (record the rule; keep a floor for SwiftShader), not a fixed 512 MB.
3. **Recovery**: on an out-of-memory error, evict everything not needed for the current render and retry once; if it
   still fails, show a clear message in the viewer for that frame — never the previous frame's picture under the new
   name — and journal it (CHB-038).
4. **Measure**: memory high-water marks per render in the journal; the owner's scenario (two 24 MP NEFs, edits, switch,
   thumbnails) and ten frames open.

## Acceptance

typecheck, lint, gen:check, vitest, goldens; gpu-parity on SwiftShader and Metal (GPU lock); browser specs headless:
ten synthetic large frames opened and switched without E_GPU_OOM; an injected OOM recovers or shows the message and
never the previous picture; the owner's scenario with his two NEFs run locally (console and journal text only, nothing
committed or quoted) without E_GPU_OOM.
