---
Title: 'Editor lab parity: what made it into chromobench'
Ticket: CHB-037
Status: active
Topics:
    - architecture
    - ui
    - webgpu
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T14:35:40.261568-05:00
WhatFor: ""
WhenToUse: ""
---

# Editor lab parity: what made it into chromobench

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->
# Editor lab parity: what made it into chromobench

Source: a read-only inventory of Editor lab (`~/Downloads/editor-lab-work.zip`, 14 Nov 2026; `src/` read line by line)
compared with the CHB-037 integration branch (c3271d7 plus CHB-038/039 in progress), 2026-11-15. "Better" marks
places where chromobench goes beyond Editor lab; "by design" marks deliberate omissions (design 01 v2).

## In chromobench

| Area | Editor lab | chromobench |
|---|---|---|
| Layer stack | adjustment layers, groups (pass/isolated), opacity, blend, mask, rename, reorder, duplicate, delete, group/ungroup | same, in every stage (scene, darkroom, print), one row component, provenance chips; better: physical darkroom layers (dodge, burn, flash, filters, density masks) with the light law |
| Blend modes | 18 (W3C + add, subtract), on sRGB numbers | 16 W3C modes in linear light / OkLCh (no add, subtract) |
| Adjustments | exposure, levels (all channels), parametric curves, hue/sat (global), vibrance, temperature/tint, B&W, sharpen, clarity, vignette | exposure, levels per channel with histogram, point curves per channel (L/R/G/B), HSL in eight bands, vibrance, colour grading wheels, channel mixer (with monochrome), sharpen and clarity in mm on the print, vignette |
| Masks | linear, radial, brush (size/hardness/flow), luminance, colour range; add/subtract/intersect; per-component amount/invert; mask density; on-stage handles; violet overlay | linear, radial, ellipse, paint (hardness), luminance, colour range with eyedropper; one product algebra; per-component amount; feather in mm; invert; what the mask reads (scene, darkroom, print); masks shared across stages; red overlay and mask-only view in progress (CHB-039) |
| Presets / looks | 32 presets as groups; user presets, JSON import/export, edit as code | ten looks as versioned look functions, presets, links with one Amount, bake, sync copy/link, apply to selection/roll/library, save frame or look as preset, import/export, agent-written `.cblook.js`; better: shared links, roll-wide one-step undo |
| History | closure stack (200), panel, jump; not saved | one log for user, agent, automatic edits; proposals; batches; provenance (`why`); saved across reloads; jump with confirmation |
| Agent | lab API (`eval`), modes auto/ask/read-only, step revert, snapshots to the model | DSL with cuts, builders, proposals through the log, what-ifs; workbench `wb` (every command, state, live screen, layouts built in the sandbox); same three modes |
| Workspaces | 6 dock layouts, drag tabs to split/join | layouts as programs (8 built in, agent-built ones persisted), modules, docks; no drag-to-redock |
| Performance | tiles with content keys, pyramid, LRU/GDS cache, adaptive preview, main thread only; GPU and WASM as probes | hash-consed graph, WebGPU render path at parity with an f64 reference engine in a worker, latest-wins render slots, tabulated preview, exact tiled export |
| Files | JPEG/PNG (8-bit, ≤ 2048 px), one document | camera RAWs (LibRaw), DNG and 16-bit TIFF scans, many documents (library, rolls), 16-bit export, ICC/soft proofing, document files |
| Geometry | layer offset only | crop, straighten, eight orientations; heal and clone spots |
| Compare | — | before/after, side by side, survey, ring-around, test strips, navigator |

## Not in chromobench, by design

- **Pixel layers** (image, paint, paste/drop as layer, brush and eraser on pixels), **fill and gradient fill layers**:
  chromobench edits parameters, never stores pixels in a document (design §16, §24); retouching is heal/clone layers.
- **Code layers** (per-pixel user JavaScript): no lambdas at pixel time (design §31, D6); a new effect is a catalogue op.
- **sRGB-number arithmetic** and Editor lab's defects (negative curve contrast, refused mask feather, brush masks
  ignoring layer offset, two subtract algebras).

## Not in chromobench, candidates

| Feature (Editor lab) | Note |
|---|---|
| Selections: marquee, lasso, magic wand, select all/invert, grow/contract, feather, selection → mask | open owner decision (design §38): as mask components in their own kit |
| Global Gaussian blur layer, grain as a digital layer, threshold, posterize, invert | grain exists physically (film grain in µm); the rest are not ops yet |
| Temperature/tint as a layer | white balance before the film is a known gap (P9-12) |
| Mask density (mask-level strength), per-component invert and on/off | component amount exists |
| On-stage mask handles (move, resize, rotate ellipse/radial) | tools draw; handle editing to check |
| A standalone histogram panel (Editor lab: luminance histogram with percentiles in the stage column) | chromobench shows histograms inside the levels and curve editors |
| Per-layer render time and "costliest layer"; a benchmark view; tile/cache settings | engine timings go to the diagnostics journal (CHB-038) |
| Drag-to-redock panels (split, join, reopen closed views) | layouts are programs; user rearrangement is via layouts, not drag |
| Tool hint line per tool, colour swatches/swap, pointer info (x, y, hex) | the probe/readout covers some |
| In-app code editor with examples, `lab:` links, the textbook | the DSL is the agent's; the photographer never sees it |
