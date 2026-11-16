---
Title: Diary
Ticket: CHB-049
Status: active
Topics:
    - masks
    - studio
    - webgpu
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://e2e/studio-masks-selections.spec.ts
      Note: e2e and timings
    - Path: repo://packages/contract/src/catalog/view-output-mask.ts
      Note: mask.rect, polygon, wand, grow
    - Path: repo://packages/contract/src/compile.ts
      Note: contract 1.6 compile order
    - Path: repo://packages/core/src/print/masks.ts
      Note: core rasterisers and laws
    - Path: repo://packages/gpu/src/engine-gpu.ts
      Note: the wand and grow on the GPU
    - Path: repo://packages/gpu/src/morph.ts
      Note: octagon passes
    - Path: repo://packages/studio-kit/kits/select/src/commands.ts
      Note: the select kit
    - Path: repo://packages/studio-kit/kits/stack/src/commands.ts
      Note: Edit Mask tool, live preview
    - Path: repo://packages/studio-kit/kits/stack/src/handles.ts
      Note: handle geometry
ExternalSources: []
Summary: 'CHB-049 implementation diary: contract 1.6 (selections as mask components, grow, density, a part''s invert, stroke flow), the mask controls and handles, the select kit, the live preview of mask gestures; Metal parity and timings.'
LastUpdated: 2026-11-15T20:00:28.163498-05:00
WhatFor: ""
WhenToUse: ""
---










# Diary

## Goal

What CHB-049 changed, why, what failed on the way (verbatim), the numbers, and how to review it. CHB-049 is Phase 2,
group 1 of the CHB-044 roadmap ("Masks, selections and local tools"): MASK-3 (mask controls and handles, CHB-040
t:srjo, plus Phase 1's leftover of the stack's coarse sliders), MASK-2 (selections as mask components, CHB-040 t:f4vl,
decision D3) and MASK-4 (the live preview of a mask gesture, CHB-039 diary Step 2). Worktree `<scratchpad>/chb049`,
branch `task/chb-049-mask-controls-selections` from main 697e036; test ports 5591–5599.

## Step 1: Reading, and the design decisions

I read the shared Phase 2 brief, HANDOFF, the CHB-044 roadmap and decisions (D3), CHB-040 in full, CHB-039 in full
(spec and diary) and CHB-046 (spec, tasks, diary Steps 1, 2 and 5), then the code each item touches: the contract's
masks (document.ts, the mask ops in catalog/view-output-mask.ts, validate.ts, Compiler.mask), core's masks.ts and op
adapters, the GPU's lowering, DAG, barrier ops and `mask.paint` upload, the mock's mask ops, the conformance generator
and semantics, the GPU parity law tests, the stack kit (commands and tools, model, state, the masks panel, the number
control, the overlay), the shell's tool contract (pointer.ts, ctx.preview, the store's gesture draft) and CHB-046's
relative drag (args.ts `feelOf`/`dragTo`, arg.ts `track`).

### Prompt Context

**User prompt (verbatim):** "You are implementing CHB-049 "Masks: mask controls and on-picture handles, selections as mask components, live preview of mask gestures" in chromobench.

Worktree: /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb049 (branch task/chb-049-mask-controls-selections, from main 697e036, dependencies installed). Work only there.

First read the shared brief: /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/phase2-brief.md — it has the reading list, rules, constraints, checks and report format. Your test ports: 5591–5599.

Items (backlog group 1, "Masks, selections and local tools"; read each row and its source tasks, and CHB-040 and CHB-039 in full):
1. MASK-3 (CHB-040 t:srjo): mask controls — mask-level density, per-component invert and on/off, on-picture handles to move/resize/rotate linear, radial and ellipse components (with snapping), brush size/hardness/flow in the tool options. Also the Phase 1 leftover: the darkroom stack's own amount and mask sliders still use the old coarse drag; move them to the relative drag with the Alt fine modifier that CHB-046 introduced (see its diary, item 4).
2. MASK-2 (CHB-040 t:f4vl; decision D3): selections as mask components (no separate selection state), in their own kit: marquee (rectangle, ellipse), lasso (freehand, polygonal), magic wand (tolerance, contiguous, which image it samples — decide and record), select all/none/invert, grow/contract, feather, and selection → mask on the selected layer. Each component kind defined once in the contract with core, GPU and mock evaluation and laws (e.g. invert twice is identity, grow then contract by the same radius bounds, feather is monotone), parity tests, commands, undo, e2e. Keep to the one mask algebra.
3. MASK-4 (CHB-039 diary Step 2): live preview of a mask tool's gesture before release (the new component as a draft; today only the outline shows), within the interactive frame budget — measure it.
MASK-5 (licensed subject/sky selection) is out of scope.

Keep CHB-046's rule: a mask tool makes one mask and disarms (the brush keeps painting its layer). Run gpu-parity on Metal under the GPU lock for the new component kinds.

Ticket: CHB-049, created with docmgr. Diary, commits per item, no push, no merge. Report as the brief says."

**Assistant interpretation:** Build the three mask items through every layer (contract, core, GPU, mock, laws,
parity, commands, controls, undo, e2e), keep one mask algebra and CHB-046's disarm rule, measure the gesture preview
on Metal, keep a docmgr ticket with spec, diary and tasks, commit per item, report.

**Inferred user intent:** The photographer gets Lightroom's and Photoshop's mask and selection habits on the
darkroom and the print without a second model of "selection", and sees what a gesture does while he makes it.

### What I did
- `docmgr ticket create --ticket CHB-049 …`, the spec and diary docs, five tasks.
- Wrote the spec (`design-doc/01-spec-mask-controls-selections-live-preview.md`): one table item → what he sees →
  agent command → where → evidence, and the decisions below.

### Why
- The items touch the same mask code from the contract up; deciding the model first kept one algebra.

### What worked
- What was already there: per-component on/off (`enabled`), the mask's invert and feather, the store's gesture draft
  (`ctx.preview`, Escape cancels), `mask.paint`'s "core rasterises, the GPU uploads" pattern, conformance cases
  generated from the registry for every new op.

### What didn't work
- My first edit command hung the shell: `cat > /tmp/claude-501/x.py 2>/dev/null; python3 - <<'EOF'` — the `cat`
  without input waited on stdin until the 120 s timeout and was killed; nothing was written. Afterwards every edit
  script went through a heredoc to python only.

### What I learned
- The document stores no source size; tools take it from the viewer (`vp.natural()`), commands from
  `studio.frames.get(f).info`.
- The mask tools, outlines and now the handles assume document px = the shown image's px (no crop, no turn of the
  frame); that is the existing convention of the stack kit's tools.

### What was tricky to build
- N/A (reading).

### What warrants a second pair of eyes
- The decisions (also in the spec):
  1. **A selection is the selected layer's mask** (D3: no selection state). Selection tools add parts to it; "selection
     → mask on the selected layer" is **Use Selection as Mask**: the mask the selection tools last drew (a view-state
     pointer `select.last`, never pixels) is copied, with fresh ids, onto the selected layer. Selection tools refuse
     (a toast) without a selected layer or on the main exposure, instead of making a darkroom burn as the mask tools do.
  2. **Deselect removes the layer's mask** (no selection = everything, as in Photoshop), not an empty mask hiding it.
  3. **Shift adds, Alt subtracts, Shift+Alt intersects** at the press; without modifiers the Mask panel's Draw choice
     (default Add). Photoshop's "new selection" is Deselect, then draw.
  4. **The magic wand samples the image the mask reads** (its Reads; by default the stage's input: on a print layer the
     print from the darkroom, on a darkroom layer the negative as the enlarger sees it). Distance: the largest channel
     difference over the domain's range (Photoshop's per-channel tolerance; 0.1 ≈ 26/255). The seed value is read by
     the engine, not stored. Contiguous = 4-connected through pixels the wand selects.
  5. **Grow/contract is an octagon** (four 1-D passes) — exact between engines and cheap; reach ≈ r.
  6. **Density is Photoshop's**: 1 − d·(1 − m) after the invert.
  7. **New fields are optional** with defaults (as a layer's params omit defaulted arguments): no golden moves, old
     node ids stay.
  8. **Flow** is the algebra's amount per stroke.

### What should be done in the future
- N/A

### Code review instructions
- Start with the spec.

### Technical details
- Files read: listed above.

## Step 2: Contract 1.6 and the engines (core, GPU, mock), laws and parity

The contract got three component kinds (`mask.rect`, `mask.polygon`, `mask.wand`), `mask.grow`, the mask's
`grow_mm` and `density`, a part's `invert` and a stroke's `flow`, each defined once and evaluated by core (f64), the
GPU and the mock. The compiler folds them into the one algebra: part (inverted) → combine → grow → feather → invert →
density (an add of a full mask at amount 1 − d, no new op).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Every new component kind defined once, with core, GPU and mock evaluation, laws and
parity.

**Inferred user intent:** No second drawing path; the engines agree.

**Commit (code):** 5a0c9c3 — "CHB-049: contract 1.6 — selections as mask components (rect, polygon, wand), mask.grow, mask density and grow_mm, a component's invert, a stroke's flow; core, GPU (op 31, morph.wgsl, the wand from read-back values), mock; laws, conformance semantics, GPU law:selections and law:tiles"

### What I did
- contract: document.ts (kinds, `RANGE_COMPONENTS` + wand, `MaskComponent.invert?`, `Stroke.flow?`,
  `Mask.grow_mm?`, `Mask.density?`), the four ops in catalog/view-output-mask.ts (`mask.paint` strokes' `flow`
  optional), validate.ts (the new fields and ranges), compile.ts, builders (`.grow(mm)`, `.density(d)`),
  `CONTRACT_VERSION` 1.6.0, CC-025 in CONTRACT-DECISIONS.md; `pnpm gen` (op-args, catalogue snapshot,
  docs/reference/ops/mask.md, DSL reference and d.ts, the bridge's MCP reference).
- core masks.ts: `rectAt`, `polygonMask` (rows filled between crossings, then the edge pixels of each segment within
  ½ px), `wandAt`/`wandFlood`/`wandMask`/`wandSeedPixel`, `growPlan`/`growPasses`/`growMask`; `paintMask` folds strokes
  with `maskCombine` at the stroke's flow. Op adapters in ops.ts.
- GPU: `mask.rect` as pointwise op 31 (kernels/pointwise.wgsl, chain/program.ts, engine/lower.ts); `mask.polygon`
  rasterised by core on the grid and uploaded (as `mask.paint`); `mask.grow` as a barrier with kernels/morph.wgsl
  (src/morph.ts: four passes, out-of-image taps left out) and its reach in `haloOf`; `mask.wand` as a barrier: the
  receiver read back and core's `wandMask` run on it; on a part of the frame the whole frame's coverage (one render at
  the part's scale for a preview, full resolution box by box with the seed's value first for an exact export) is
  computed and cut, cached per node and grid (`wands`, newest few within 256 MB).
- mock: its own rect, polygon, wand (BFS), grow, and flow.
- Tests: contract `mask-controls.test.ts` (5), core `selections.test.ts` (14), two conformance semantic cases
  (selection; grow laws, feather monotone, invert twice) that run on core, mock and the GPU; GPU `law:selections` and
  `grow`/`wand` in `law:tiles`.

### Why
- The wand needs the whole frame (connectivity), so it is `global` and has its own whole-frame path rather than a
  halo; rect is a cheap closed form and belongs in the pointwise kernel; the polygon's even-odd fill is a scanline job
  (the same function in core and, uploaded, on the GPU makes parity exact).

### What worked
- `npx vitest run packages/contract packages/core packages/engine-mock packages/conformance packages/gpu`: 47 files,
  1725 passed; later the full `vitest run`: 149 files, 3549 passed, 19 skipped. Goldens 66/66 within 1e-5 (unchanged:
  absent fields compile to the same nodes). `pnpm contract:check`: "1.5.0 (main) → 1.6.0 … 4 change(s), 0 breaking".
- SwiftShader parity (`npx playwright test --project=gpu-parity packages/gpu/test/browser/law.spec.ts -g "selections|tiles|mask algebra"`):
  `law:selections` rect 1.4e-6, poly 2.8e-8, wand (both) 8.3e-6, grow/contract/closing/opening 3.1e-6, flow 3.0e-8;
  laws closeOut 0, openOut 0, dual 3.0e-8, feather 0, wand ⊆ 0; a part of a half-scale wand = the whole cut (0); an
  exact part 6.8e-6. `law:tiles`: grow and wand 0 codes differing.

### What didn't work
- `registry-graph.test.ts` and `compile.test.ts` failed once I gave `flow` a default of 1:
  `AssertionError: expected [ { …(5) } ] to deeply equal [ { …(4) } ]` (`+ "flow": 1`): the binder filled the default,
  which would change every paint node's id. Made it `optional: true` (absent = 1).
- My validator test expected `m1.grow_mm` for `grow_mm: NaN`, got `masks.m1.grow_mm` (the values layer refuses a
  non-finite number before the contract's check); used an out-of-range 5000 instead.
- The polygon order test first compared bit for bit (`expected false to be true`): reversing the points rounds the
  crossings and the edge distances differently in the last ulp; compared within 1e-9.

### What I learned
- The conformance generator gives every new op build/shape/determinism (and region for pointwise) cases on every
  engine for free; semantic cases are where the laws go.

### What was tricky to build
- The wand on a part of the frame. A tile or a zoomed screen render does not contain the seed or the connection to
  it, so a part must be cut from the whole frame's coverage. For an exact export the whole frame at full resolution
  may not fit as one texture, so the seed's value is rendered first (a 1×1 region), each 512-px box is read back and
  turned into coverage, then the flood runs on the whole coverage. `law:tiles` (exact tiles = whole frame, 0 codes)
  and `law:selections` (part of the half-scale wand = the whole cut, 0) hold it.
- The octagon in WGSL: a clamped diagonal tap leaves the line, so out-of-image taps are skipped (in core too).

### What warrants a second pair of eyes
- The wand's readback costs one receiver read per new grid; cached per node and grid size. On the CPU engine the
  wand runs at full resolution before the preview grid samples it (not in `GRID_OPS`).
- `wands` keeps up to four coverages within 256 MB of CPU memory (a 24 MP exact export: 96 MB).

### What should be done in the future
- N/A

### Code review instructions
- packages/contract/src/{document,compile,validate}.ts and catalog/view-output-mask.ts; core print/masks.ts (end of
  file); gpu src/engine-gpu.ts `wand()`, src/morph.ts, kernels/morph.wgsl, pointwise.wgsl case 31.
- `npx vitest run packages/contract/test/mask-controls.test.ts packages/core/test/selections.test.ts packages/engine-mock`;
  `npx playwright test --project=gpu-parity packages/gpu/test/browser/law.spec.ts -g "selections|tile by tile"`.

### Technical details
- Compile order (contract 1.6): `c → (invert) → combine …; grow(grow_mm·1000/µm per px) → feather → invert →
  combine(add, constant 1, amount 1 − density)`.
- Octagon: s = round(r(√2 − 1)), a = round(r(1 − √2/2)); r = 10 → s 4, a 3, reach 10.

## Step 3: MASK-3 and MASK-4 in the stack kit

The Mask panel got Expand (mm), Density (%) next to Feather and Invert, a part's Invert and ✥ (handles), and the
brush's Size, Hardness and Flow while the brush is the tool. The new Edit Mask tool (V) draws the selected layer's
gradients and shapes with handles: drag the middle to move (snapping to the edges, thirds and centre lines, Alt off),
the ends of a gradient (Shift: 15° steps), the sides and corners of a shape (the opposite side stays; Shift on a corner:
a square), the knob above it to turn (Shift: 15°). Each drag is one step. The linear, radial and brush tools preview
their gesture as the store's gesture draft (MASK-4); the release drops the draft and commits the gesture's mutations
as one step. The kit's own sliders (layer Amount, the mask settings, the editors' numbers) now drag relative to where
they started, the usual range over 300 px, Alt ten times finer, as CHB-046's darkroom controls.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** MASK-3's controls and handles, the relative drag for the stack's sliders, MASK-4's
draft preview.

**Inferred user intent:** Adjust a mask on the picture, see a gesture while making it.

**Commit (code):** 85d86d9 — "CHB-049: MASK-3 mask controls (density, expand, a part's invert, handles on the picture to move/resize/turn with snapping, brush size/hardness/flow) and MASK-4 live preview of a mask gesture as the gesture's draft; the stack's own sliders on the relative drag with Alt fine"

### What I did
- `kits/stack/src/handles.ts` (pure geometry: handles, hit test, drag, snapping); commands.ts: `mask-edit` tool,
  `mask.brush`, `mask.edit`, `previewGesture`/`dropPreview`/`gestureOptions`, the tools' drags preview; controls/dom.ts
  `numberFeel` and the pointer-driven relative drag (CHB-046's `dragTo`, `FINE_DRAG`); dom.ts (Expand, Density, a
  part's Invert and ✥, a `bool` control for the wand's Contiguous, the brush options); state (brush hardness, flow, the
  edited part); stack.css; overlay shows for the edit and select tools too.
- `test/stack/handles.test.ts` (7).

### Why
- The handles' geometry is pure so it is tested without a browser; the tool only hit-tests in screen px and previews
  the part's params at its store path.
- The draft is the store's own gesture: Escape (the shell's cancel) drops it, the overlay's `live` watch already
  follows writes under `docs.<f>.masks`, and nothing reaches the log before the release.

### What worked
- Handle tests pass first time (move with and without snapping, sides, Shift-square corner, the knob, gradient ends).

### What didn't work
- N/A here (the e2e findings are in Step 4).

### What I learned
- A preview that adds a mask writes two roots (`masks`, and `stages` for the entry's mask): `previewGesture` previews
  each root of the document that changed.

### What was tricky to build
- Releasing a previewed gesture: the shell commits a preview a tool leaves open (with a CK-T420 warning), which would
  log the draft's whole `masks` Coll instead of the gesture's insert. `drawn()` cancels the draft and commits the
  mutations; a click that is no drag cancels it.
- The polygonal lasso is many separate clicks; a draft left open between clicks would ride along with the next step
  (a slider's commit takes the whole gesture draft), so it shows its outline only, no draft.

### What warrants a second pair of eyes
- Handles use the shown image's pixels as document pixels (as the mask tools always did): with a crop or a turned
  frame they would sit off the picture's content.

### What should be done in the future
- Handles and tools in the cropped/turned display geometry (map through output.frame's inverse).

### Code review instructions
- kits/stack/src/handles.ts, commands.ts (`editTool`, `previewGesture`, `liveDrag`), controls/dom.ts (`numberFeel`).
- `npx vitest run packages/studio-kit/test/stack/handles.test.ts`.

### Technical details
- Number feel: perPx = (max − min)/300, grid = step (step/10 with Alt), keys step / Shift 10·step / Alt step/10.

## Step 4: MASK-2, the select kit; the e2e; Metal

`cb.kits.select` (kits/select): tools Rectangular Marquee (Shift+M), Elliptical Marquee, Lasso (L), Polygonal Lasso
(Shift+L), Magic Wand (W); commands `select.all` (Mod+A), `select.none` (Mod+D), `select.invert` (Mod+Shift+I),
`select.grow`/`select.contract` (0.5 mm, or a value), `select.feather` (1 mm, or a value), `select.toLayer`, the
shapes as commands for an agent (`select.rect/ellipse/lasso/wand`) and `select.options`; a Select menu in
`cb.menus.standard()`; the Mask panel's Select row with the wand's Tolerance (of 255) and Contiguous. Each selection is
one step; a tool disarms after its selection.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The selection kit, commands, undo, e2e; Metal parity and timings.

**Inferred user intent:** Photoshop's selection habits on the masks he already has.

**Commit (code):** b025b42 — "CHB-049: MASK-2 the select kit — selections as the selected layer's mask (D3): …"; 82f6933 — "CHB-049: e2e logs the brush stroke's draft renders (MASK-4 timings)"

### What I did
- kits/select/src/{commands,kit,state,dom,index}.ts; the mask model's `selectable`, `selectAll`, `selectNone`,
  `selectInverse`, `growBy`, `featherTo`, `copyMaskOnto` (kits/stack/src/model.ts); wiring (small, local): cb.ts (the
  kit, `.use`, `menus.select`, the Print viewer's tools), src/dom/panels.ts (renderers), layouts/darkroom.js (viewer
  tools), the stack kit's Edit/Scene viewers. Layout snapshots regenerated (`npx vitest run packages/studio-kit/test/layouts.test.ts -u`:
  +20 commands, +18 keys, +6 tools, the kit cb.select).
- `test/stack/select.test.ts` (7) and `e2e/studio-masks-selections.spec.ts` (2).

### Why
- Its own kit (as the backlog asks), but no state of its own beyond the wand's options and a pointer to the last
  selection: the selection is the mask.

### What worked
- vitest 151 files, 3563 passed, 19 skipped; typecheck, lint, gen:check clean.
- e2e on SwiftShader: both tests pass (25.7 s, 25.4 s). The radial drag: while the hand is down the picture outside
  the radial is lighter (the layer no longer acts there), the centre stays, the overlay shows, the log has no new step;
  the release adds one and disarms.
- Metal (M1 Max, headless, `REAL_GPU=1 … chb041-lock.sh`): `--project=gpu-parity` 62 passed, 2 skipped (58.4 s),
  `law:selections` rect 1.0e-6, poly 2.8e-8, wand 8.2e-6, grow 3.1e-6, flow 3.0e-8, laws 0; `law:tiles` grow, wand 0.
- MASK-4 timings on Metal (render times of the drafts during the gesture, `rendered` events):
  - 3000 × 2000, radial drag (12 moves): picture drafts 11.5–33.1 ms (median ≈ 21), cover 6.7–36.4 ms; a second run
    2.6–22.4 ms and 10.9–20.5 ms;
  - 480 × 320: picture 13.5–28.6 ms, cover 2.8–23.5 ms;
  - 3000 × 2000, brush stroke (16 moves, the stroke re-rasterised on each): picture drafts 22.7–37.6 ms.
  Each draft render fits about one 30 fps frame (33 ms); the picture and the overlay share one queue, so with the
  overlay showing the pair takes about two. SwiftShader: picture drafts ≈ 200–420 ms, cover ≈ 71 ms.

### What didn't work
- The first e2e expected the exposure layer to brighten inside the mask: `Expected: > 1.05 Received: 1` — the
  synthetic print clipped at white. With −1 stop: `Expected: < 0.627… Received: 0.677…` — a layer without a mask acts
  everywhere, so a new mask makes the outside lighter, not the inside darker. Rewrote the checks the right way round.
- `cb.pixel` read another viewer than Edit's; read the Edit viewport's `shown().image` instead.
- `expected -90 to be close to 90`: the knob dragged to a quarter turn lands at −90 (the same shape); compared |angle|.
- The centre's draft value was read while the radial was still growing (`Received: 0.441…` difference); polled.
- `CK-B170 Unknown icon 'polygon'` in every layout's warnings snapshot: used the `lasso` icon.
- `TypeError: rt.commands.enabled is not a function` in my kit test: the registry has `status(id, state).ok`.

### What I learned
- Keys Mod+A, Mod+D, Mod+Shift+I and tool keys L, Shift+L, W, Shift+M, V were free (the explain snapshot lists no
  conflict); `[`/`]` belong to the spot tool, so the brush size has no key.

### What was tricky to build
- Use Selection as Mask with no selection state: `select.last` is only a pointer (frame, mask id) set by each
  selection step; the copy gets fresh ids for the mask, its parts and its strokes (`collIds`/`renameIds`).

### What warrants a second pair of eyes
- Deselect removes the mask (and Select All replaces the parts with one rectangle and clears invert) — Photoshop's
  meaning for a mask that *is* the selection; a photographer used to Lightroom may expect "Deselect" to keep the mask.
- Draw's default is Add (the mask tools' default), not Photoshop's "new selection".

### What should be done in the future
- A Feather…/Grow… dialog with a value (the menu uses 1 mm and 0.5 mm; the panel's sliders and the commands take any
  value).

### Code review instructions
- kits/select/src/commands.ts; kits/stack/src/model.ts (end); e2e/studio-masks-selections.spec.ts.
- `STUDIO_PORT=5591 STUDIO_KIT_PORT=5592 SHELL_DEMO_PORT=5593 GPU_PARITY_PORT=5594 CI=1 npx playwright test --project=chromium-webgpu e2e/studio-masks-selections.spec.ts`;
  timings: `MASK_W=3000 REAL_GPU=1 …` under the lock.

### Technical details
- Metal log lines: `GPU · apple metal-3 · 4000 px · 3000×2000: radial drag, picture renders 10 (ms 14.7 20.5 22.1 11.5 19.2 21.6 33.1 21.0 28.6 23.6), cover renders 8 (ms 36.2 16.9 15.5 20.0 28.8 6.7 30.8 36.4)`;
  `… 480×320: radial drag, picture renders 13 (ms 28.6 15.9 16.7 14.7 14.6 13.9 13.5 14.0 13.8 13.6 13.6 20.5 17.8), cover renders 9 (ms 23.5 17.4 18.6 17.8 17.1 3.2 16.0 3.1 2.8)`;
  `3000×2000: brush stroke (16 moves), picture renders 17 (ms 22.7 30.9 28.3 29.0 29.7 29.1 29.1 29.1 29.0 32.3 37.6 35.3 34.3 28.1 30.3 29.4 32.5), cover renders 3 (ms 14.3 117.9 17.6)`.

## Step 5: The checks, the browser suite under load, bookkeeping

Every check passed; the SwiftShader suite had four failures on a machine at load average ≈ 150 (several agents'
suites at once), all four green when rerun alone, one of them mine (a timing in the MASK-4 draft check, made robust).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The brief's checks, the source tasks marked, what stays open recorded.

**Inferred user intent:** A branch the integrator can merge.

**Commit (code):** 9af226c — "CHB-049: e2e — the radial draft's centre is polled after the hand rests (a loaded software adapter supersedes drafts)"

### What I did
- `pnpm typecheck`, `pnpm lint`, `pnpm gen:check` (26 files), `npx vitest run` (151 files, 3563 passed, 19 skipped),
  `node tools/goldens/render.ts --check` (66/66 within 1e-5), `pnpm contract:check` (4 minor, 0 breaking).
- `STUDIO_PORT=5591 STUDIO_KIT_PORT=5592 SHELL_DEMO_PORT=5593 GPU_PARITY_PORT=5594 CI=1 npx playwright test`
  (23.9 min): 165 passed, 2 skipped, 4 failed; rerun alone with `--workers=1`: 7 passed (the four and their files).
- Metal `--project=gpu-parity` under the lock: 62 passed, 2 skipped (Step 4).
- CHB-040 t:srjo and t:f4vl checked "— done in CHB-049 (…)"; CHB-039's changelog notes MASK-4; HANDOFF's stack kit
  paragraph names the mask controls and the select kit (six lines).

### What didn't work
- Suite failures, verbatim: `e2e/ingest-dust-wgsl.spec.ts:15` `TimeoutError: browserType.launch: Timeout 180000ms
  exceeded.`; `e2e/studio-open-mode.spec.ts:57` `Expected substring: "scan-007.tif was already open" Received string:
  "rendered 2 · done"`; `packages/gpu/test/browser/law.spec.ts:20` `Error: browser.newContext: Test ended.` (3.0 m);
  `e2e/studio-masks-selections.spec.ts:61` `Expected: < 0.02 Received: 0.44172295928001404` at the radial draft's
  centre (the picture still showed an early, small draft). `uptime`: load averages 150.59 117.97 97.46.
- `--repeat-each=4` of my test (4 workers) failed 3 of 4 the same way, then all four at `page.waitForFunction … ready`
  (60 s) as the load grew; `--repeat-each=2 --workers=1` passed both.

### What I learned
- Under load, a draft can be superseded and the next one not requested before the hand rests; a one-pixel move after
  the drag (or the release) brings the latest. On Metal every move's draft arrives (10–13 draft renders per drag).

### What was tricky to build
- Telling load from a defect: the failing value was always the same early draft, and every serial run passed.

### What warrants a second pair of eyes
- Whether the viewer should request the latest draft when a gesture rests without a new move (a viewport render
  question, not this ticket's code); the e2e nudges the pointer instead.

### What should be done in the future
- Left open (also in tasks.md): handles and mask tools in the cropped/turned display geometry; a value dialog for
  Feather…/Grow…; a brush-size key ([ and ] are the spot tool's); the polygonal lasso without a live draft between
  clicks; the owner's eye on Deselect = remove the mask and Draw = Add as the default.

### Code review instructions
- `git log --oneline 697e036..HEAD`; the diary Steps 2–4 name the files.

### Technical details
- Logs: `<scratchpad>/chb049-browser.log` (SwiftShader suite), `<scratchpad>/chb049-parity-metal.log` (Metal).
