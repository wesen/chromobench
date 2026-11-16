---
Title: 'Spec: mask controls, selections, live preview'
Ticket: CHB-049
Status: active
Topics:
    - masks
    - studio
    - webgpu
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Phase 2, Masks and selections (CHB-044 group 1): MASK-3 mask controls and handles, MASK-2 selections as mask components (D3), MASK-4 live preview of a mask gesture."
LastUpdated: 2026-11-15T20:00:27.163558-05:00
WhatFor: ""
WhenToUse: ""
---

# Spec: mask controls, selections, live preview

Phase 2 of the CHB-044 roadmap, group 1 ("Masks, selections and local tools"): MASK-3 (CHB-040 t:srjo), MASK-2
(CHB-040 t:f4vl, decision D3) and MASK-4 (CHB-039 diary Step 2). MASK-5 (licensed subject/sky selection) is out of
scope. Rule kept from CHB-046: a mask tool makes one mask and goes back to no tool; the brush keeps painting its layer.

## What changes, in his words

| # | What he sees | Agent / command | Where | Evidence |
|---|---|---|---|---|
| MASK-3 | In the Mask panel: **Density** (Photoshop's: how much the mask holds the layer back; 100 % full, 0 % the layer acts everywhere), **Expand / Contract** (mm on the print), **Feather** (mm), **Invert**; per part of the mask: on/off, **Invert**, how it combines, its amount. Linear, radial, ellipse and rectangle parts have **handles on the picture** (tool "Edit Mask on Picture", V; or click a part's ✥): drag the middle to move, the ends of a gradient, the sides and corners of a shape to resize, the round knob to turn; snapping to the picture's centre lines, thirds and edges, Shift for 15° steps (and a square/circle). The brush has **Size**, **Hardness** and **Flow** under its tool. The panel's own sliders (layer amount, mask settings) now move relative to where the drag started, Alt ten times finer (CHB-046's rule). | `mask.set` (`m1.density`, `m1.grow_mm`, `m1c2.invert`), `mask.brush` (size, hardness, flow), `tool.mask-edit` | contract 1.6 (density, grow_mm, component invert, stroke flow); stack kit `dom.ts`, `controls/dom.ts`, `handles.ts`, `commands.ts` | contract/core/GPU tests; vitest on the handle geometry and snapping; e2e |
| MASK-2 | A **Select** menu and tools: **Rectangle** and **Ellipse** marquee, **Lasso** (freehand) and **Polygonal lasso** (click the corners, double-click or click the start to close), **Magic wand** (Tolerance, Contiguous; it samples what the layer's mask reads — by default the image the layer works on). Shift adds, Alt subtracts, Shift+Alt intersects (Photoshop), else the Draw choice of the Mask panel. **Select All** (Mod+A), **Deselect** (Mod+D: the layer acts everywhere again), **Inverse** (Mod+Shift+I), **Grow**/**Contract** (by 0.5 mm, or a value), **Feather…**, **Use Selection as Mask** (puts the selection last drawn onto the selected layer, as its own copy). A selection *is* the selected layer's mask: there is no other selection. One undo step each. | `select.all/none/invert/grow/contract/feather/toLayer`, `select.rect/ellipse/lasso/wand` (agent-reachable shapes), tools `select-rect`, `select-ellipse`, `select-lasso`, `select-polygon`, `select-wand` | contract 1.6 (`mask.rect`, `mask.polygon`, `mask.wand`, `mask.grow`); core, GPU, mock; `kits/select` | laws (core, conformance on every engine, GPU), parity on Metal, kit tests, e2e |
| MASK-4 | While he drags a linear, radial, marquee, lasso or brush gesture, the picture already shows the new mask acting (and the overlay shows it), not only an outline; on release it is one step; Escape drops it. | (view only) | the tools preview the gesture's document as the store's gesture draft | e2e; Metal timings in the diary |

## Decisions taken here

- **What a selection is (D3, "no separate selection state"):** the selected layer's mask. Selection tools add components to
  it like the mask tools. "Selection → mask on the selected layer" (Editor lab's convert) becomes **Use Selection as
  Mask**: the mask the selection tools last drew (kept as a pointer in view state, not as pixels) is copied onto the
  selected layer; no layer selected → the selection tools say so instead of creating a burn.
- **Deselect** removes the layer's mask (Photoshop: no selection means everything), it does not leave an empty mask
  that would hide the layer.
- **The magic wand samples the image the mask reads** (the mask's Reads, by default the stage's input: the print from
  the darkroom for a print layer, the negative as the enlarger sees it for a darkroom layer), and compares the largest
  channel difference over the domain's range (Photoshop's per-channel tolerance; 0.1 ≈ 26 of 255). The seed's value is
  read by the engine from that image, never stored. Contiguous = 4-connected.
- **Grow/contract** is an octagon (four one-dimensional passes, cheap on both engines and exact between them) rather
  than a true disc; its reach along an axis is round(r(√2−1)) + 2·round(r(1−√2/2)) ≈ r.
- **Density** is Photoshop's (after invert, 1 − d(1 − m)); the layer's own Amount stays the strength.
- **Optional new fields** (density, grow_mm, a component's invert, a stroke's flow): absent means the default, as a
  layer's params omit defaulted arguments; old masks compile to the same nodes (no golden moved).
- **Flow** is the one algebra's amount per stroke (at 1: the maximum, as before).

## How it is tested

contract `mask-controls.test.ts`; core `selections.test.ts` (laws); conformance semantics (selection, grow) on core,
mock and the GPU; GPU `law:selections` and `law:tiles` (grow and wand in exact tiled exports), on SwiftShader and on
Metal under the lock; studio-kit tests for the select kit and the handles; e2e `studio-masks-selections.spec.ts`
(controls, handles, every selection tool, undo, live preview with timings).
