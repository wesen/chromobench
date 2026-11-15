---
Title: Diary
Ticket: CHB-039
Status: active
Topics:
    - ui
    - webgpu
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T14:30:13.780357-05:00
WhatFor: ""
WhenToUse: ""
---


# Diary

## Goal

This diary records the implementation of CHB-039, the mask overlay: the selected entry's mask shown over the
picture as a coloured tint (Photoshop's quick mask, Lightroom's overlay) or as a greyscale mask-only view, computed
by the active engine from the compiled mask node, with view-state commands an agent reaches through `wb`.

## Step 1: Reading the code and choosing the design

I read the spec, the handoff guide, the CHB-037 working rules, the stack kit (kit, state, commands with the mask
tools and `outline(...)`, the masks panel and the mask chip in dom.ts), the render bridge, the frame handles, the
compiler's mask closure (`Compiler.mask`) and the stage laws' `maskProduct`, the shell viewport (render, paint,
presenters) and the three engines' `output.frame`. The design below follows from what is already there: the
overlay is one more renderable the viewer requests through the render queue, and the only new node is the document
geometry applied to the entry's coverage node.

### Prompt Context

**User prompt (verbatim):** "what's next? also, can we see masks like in photoshop like as a red overlay or so?"

**Assistant interpretation:** The main agent assigned me ticket CHB-039: build the mask overlay of the spec
(`design-doc/01-mask-overlay-spec.md`): a tint over the viewer where the selected entry's mask acts (red by default,
colour and opacity adjustable, inverted display), a mask-only greyscale view, shown on O, from the mask chip and the
masks panel, and automatically while a mask tool is active or a mask parameter is dragged; computed by the engine
from the compiled mask node; overlay state as view state with commands `mask.overlay.toggle/.mode/.colour/.opacity`.

**Inferred user intent:** The photographer wants to see where a dodge, a burn or a print layer acts while he draws
and adjusts its mask, the way he knows it from Photoshop and Lightroom, without guessing from outlines.

### What I did
- Read the files listed above; ran `pnpm install --frozen-lockfile --prefer-offline` (already up to date).
- Created this diary: `docmgr doc add --ticket CHB-039 --doc-type diary --title "Diary"`.

### Why
- The spec requires the overlay to be the mask "exactly as the engine applies it", so the design had to start from
  where the compiler makes mask nodes and where the viewer gets pixels.

### What worked
- Findings that shaped the design:
  - `Compiler.mask(id, stage)` (packages/contract/src/compile.ts) builds a mask's node per (mask, stage); the light
    law multiplies a layer's mask with its groups' masks (`maskProduct`, `mask.combine` intersect, amount 1); the
    composite law applies a group's mask at the group's mix and a layer's at its own. `Compiled` exposes neither.
  - Mask nodes are in document pixels (the source's geometry); the viewer shows the display cut, which ends in
    `output.frame` (crop, straighten, orientation). All three engines implement `output.frame` channel-generically
    (core `frameImage(…, c)`, the GPU's `renderGraph` renders any receiver on the mapped grid and runs `framePass`,
    the mock's `orient/crop`), but the catalogue restricts its input to `display-rgb`.
  - The viewer reads pixels back in every case (PresentImage carries data; the WebGPU presenter uploads them), so a
    one-channel mask render read back and tinted on a canvas costs one small extra render, not a new GPU path.

### What I learned
- `view.inspect` already has a `mask` mode, but it is a host op of `StudioEngine` (CPU, read back), and a host op
  cannot sit under `output.frame`: StudioEngine only intercepts host ops at the top of the graph.

### What was tricky to build
- Choosing where the geometry happens. Applying crop/straighten/orientation to the mask on the client would be a
  second drawing path (and straighten's bilinear sampling would have to be copied). Widening `output.frame` to take a
  mask keeps one geometry for picture and overlay.

### What warrants a second pair of eyes
- The design decisions, recorded here so they can be contested:
  1. **Contract (additive):** `output.frame` takes `display-rgb` or `mask` (domainOut `same`), and `Compiled` gets
     `coverage(entry)`: the entry's mask times its groups' masks, compiled for its stage with the same nodes the
     laws use (`mask.combine` intersect, amount 1, outer to inner, as `maskProduct`). Contract 1.4.0, CC-023.
  2. **Handle and bridge:** `frame.mask(entry)` names `output.frame(coverage(entry))` with the display's own
     geometry args; the render bridge lowers it like every other handle (one small `case`).
  3. **Shell viewport:** a generic `cover` prop (τ → `{ image, colour, opacity, mode } | null`): the viewport
     requests the cover with the same target as the picture (draft while previewing, screen, refine), and paints it
     on its own canvas above the presenter's under the same view transform; colour, opacity and mode changes repaint
     without rendering. Modes: `tint` (colour where the mask acts), `inverse` (colour where it does not), `mask`
     (the coverage as opaque grey, white = full effect).
  4. **Stack kit:** view state `stack.overlay = { on, mode, colour, opacity }`, commands `mask.overlay.toggle`
     (key O), `.mode`, `.colour`, `.opacity`; automatic display while a mask tool is the active tool or a gesture
     previews a path under the document's `masks`; buttons in the masks panel and an overlay toggle on the chip.

### What should be done in the future
- N/A

### Code review instructions
- Nothing to review yet (reading step).

### Technical details
- Files read: packages/contract/src/compile.ts (Compiler.mask, run), packages/contract/src/stage-laws.ts
  (flatten, maskProduct, mix), packages/studio-kit/src/bridge/render-bridge.ts (lower, render),
  packages/studio-kit/src/handles.ts, packages/shell/src/dom/viewport*.ts, packages/core/src/print/geometry.ts
  (frameImage), packages/gpu/src/engine-gpu.ts (renderGraph), packages/engine-mock/src/ops.ts (output.frame).
