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

## Step 2: The overlay from contract to panel (headless green)

I built the whole path headless: the contract names an entry's coverage and lets the document geometry act on a
mask; a frame handle names that node; the render bridge lowers it; the shell viewport requests it with the
picture's target and paints it on its own canvas; the stack kit decides when it shows and gives the photographer
and the agent the controls. vitest, typecheck, lint, gen:check and the 66 goldens are green.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Implement the design of Step 1 with tests, keep shared files (render-bridge.ts,
apps/studio) to small focused changes because CHB-038 works on them in parallel.

**Inferred user intent:** See the mask on the picture while working, exactly as it acts.

**Commit (code):** 5a0f0cc — "CHB-039: the mask overlay (contract coverage, output.frame on a mask, mask handles, a
viewport cover, the stack kit's overlay state, commands, keys and controls)"

### What I did
- Contract 1.4.0 (CC-023 in CONTRACT-DECISIONS.md): `Compiled.coverage(entry)` in compile.ts (walks the stages'
  stacks with the masks of the groups around the entry, compiles each with `Compiler.mask(id, stage)` and folds
  them with `mask.combine` intersect amount 1, outermost first, as `maskProduct`; refuses a mask that reads a cut
  after its stage); `output.frame` domainIn `['display-rgb', 'mask']`, domainOut `same`. `pnpm gen` regenerated
  the catalogue snapshot, op-args, docs/reference/ops/output.md, the DSL reference and d.ts (a MaskHandle gains
  `output.frame`), the bridge's MCP reference.
- studio-kit: `FrameRef.mask(entry)` (handles.ts, `what: 'mask'`); render-bridge.ts: one `case 'mask'` in
  `lower()` (`output.frame(coverage)` with `c.display.args`) and mask renders kept out of the draft speed estimate.
- shell viewport: a `cover` prop (forms.ts slot; state.ts `Cover`, `V.cover/coverKey/coverStyle`, api `cover()`);
  viewport.ts adds the `ck-vp-cover` canvas between the presenter's canvas and the SVG overlays; geometry.ts sizes
  it; render.ts requests slot `vp:<id>:cover` with the picture's pass, size and region (no busy mark, no message;
  a failure hides it); paint.ts `coverRgba` and `paintCover` (prepared once per render and style, placed by its
  region with `docToScreen`).
- stack kit: overlay.ts (`coverageMasks`, `overlayReason`, `maskCover`, commands `mask.overlay.toggle/.mode/.colour/
  .opacity`), state.ts `stack.overlay` (on, mode, colour, opacity, live), kit.ts registers the commands and keys
  (O, Shift+O colour, Alt+O mode), docs; dom.ts: the overlay controls at the top of the masks panel (Show, Tint /
  Inverse / Mask, colour, opacity), `watchMaskGestures` (live while the store's gesture writes under
  `docs.<f>.masks`), the mask chip's Shift-click (overlay) and Alt-click (mask alone); stack.css.
- cb.ts: every `cb.viewer` gets the cover by default (`cover: false` turns it off), on the handle it shows.
- Tests: packages/contract/test/coverage.test.ts (5), packages/studio-kit/test/stack/overlay.test.ts (8); layout
  snapshots regenerated (`npx vitest run packages/studio-kit/test/layouts.test.ts -u`: +4 commands, +3 keys, the
  viewports' `cover τ`).

### Why
- `coverage` in the contract keeps "the mask as the engine applies it" true by construction: for the light law it
  returns the very node id the combine term uses (test: `c.coverage('b1').id === term.mask`).
- The cover on its own canvas leaves both presenters (WebGPU P3 and Canvas2D) untouched and lets colour, opacity and
  mode change without a render.

### What worked
- `pnpm typecheck`, `pnpm lint`, `pnpm gen:check` clean; `pnpm test`: 139 files, 3396 passed, 19 skipped;
  `node tools/goldens/render.ts --check`: 66/66 within max |Δ| ≤ 0.00001.
- The mock engine's `output.frame` on a mask: a crop plus `cw90` maps pixels exactly as on the picture.

### What didn't work
- First test run: `ChromobenchError: E_UNKNOWN_OPTION: exposure has no option "ev"` (my test; the op's argument is
  `stops`).
- A first cut put `OVERLAY_STATE` in overlay.ts and imported it into state.ts while overlay.ts imports `selectedIn`
  from state.ts: a module cycle with a `const` read at load time (TDZ). Moved the overlay's types and defaults into
  state.ts; overlay.ts re-exports them.
- `overlayControls` first created its root element after the cell that writes `el.dataset` (cells run once when
  created): would have thrown at mount. Reordered before any run.

### What I learned
- The render queue aborts an in-flight render when a newer request of the same slot has another key, and presents
  only the newest generation, so the cover needs no staleness check of its own beyond "still on".
- `store.gesture.writes()` gives the physical paths of a drag's preview; `docs.<f>.masks…` identifies a mask or
  component setting without touching the controls.

### What was tricky to build
- Composite groups apply their mask at the group's mix, a layer's at its own: the coverage of a layer inside a masked
  group is not one node of the compiled print there. I defined it as the product (the same algebra, its own node);
  for the light law it is the node the law uses.
- Disabled entries: `flatten` skips them, so their masks are never compiled by the law; `coverage` compiles them on
  demand (cuts all exist after `run`), and refuses a mask reading a cut after its stage, the check `mask()` would
  otherwise skip after the run.

### What warrants a second pair of eyes
- `Compiled` now carries a function (`coverage`); anything that serialises or deep-compares a `Compiled` would see
  it (I found nothing that does).
- The cover is requested on the picture's lane right after it; on a slow engine (CPU) it doubles the work of a
  drag frame only while the overlay shows.

### What should be done in the future
- The overlay does not show a gesture of a mask tool before release (the component is committed on pointer-up,
  the outline shows meanwhile). A live preview would need the tools to preview the new component as a draft.

### Code review instructions
- Start at packages/contract/src/compile.ts (`coverage`), packages/studio-kit/kits/stack/src/overlay.ts,
  packages/shell/src/dom/viewport/render.ts (the cover cell and `go('cover')`), paint.ts (`coverRgba`,
  `paintCover`), packages/studio-kit/src/bridge/render-bridge.ts (`case 'mask'`).
- Validate: `npx vitest run packages/contract/test/coverage.test.ts packages/studio-kit/test/stack/overlay.test.ts`.

### Technical details
- Shared files touched (for merging with CHB-038): packages/studio-kit/src/bridge/render-bridge.ts (+7 lines: the
  `case 'mask'` and `h.what !== 'mask'` in `render`); nothing in apps/studio.
