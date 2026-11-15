---
Title: Diary — phase P8b editors
Ticket: CHB-037
Status: active
Topics:
    - architecture
    - ui
    - webgpu
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://apps/studio/src/host/engines.ts
      Note: buildEditorMath for the studio host
    - Path: repo://e2e/studio-editors.spec.ts
      Note: Editors on the GPU engine
    - Path: repo://packages/shell/src/dom/forms/plane.ts
      Note: curvePlane and wheelDisc widgets
    - Path: repo://packages/studio-kit/demo/editor-math.ts
      Note: editorMath from core for the dev host and tests
    - Path: repo://packages/studio-kit/kits/stack/src/commands.ts
      Note: The eyedropper behind the mask-colour tool
    - Path: repo://packages/studio-kit/kits/stack/src/controls/dom.ts
      Note: The one number control and shared DOM helpers
    - Path: repo://packages/studio-kit/kits/stack/src/dom.ts
      Note: Params panel mounts editors; colour range Sample
    - Path: repo://packages/studio-kit/kits/stack/src/editors.ts
      Note: Editors mechanism, EditorMath service, lists as Colls, histogram and eyedropper measurement
    - Path: repo://packages/studio-kit/kits/stack/src/editors/dom.ts
      Note: The curve, levels, HSL, grade and mixer editors (DOM)
    - Path: repo://packages/studio-kit/kits/stack/src/model.ts
      Note: New layers' lists as Colls named after the layer
    - Path: repo://packages/studio-kit/test/browser/editors.spec.ts
      Note: Browser spec per editor
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T02:44:06.041194-05:00
WhatFor: ""
WhenToUse: ""
---













# Diary

## Goal

The phase agent's record of phase P8b of CHB-037: editors for Editor lab's tools in the stack kit's params panel —
an editors mechanism on `stack.panels.params` (per op), a curve editor (points as a Coll with per-layer id prefixes,
channel L/R/G/B, the drawn curve from core's own function), HSL bands, grade wheels, levels with a histogram of the
stage input, the mixer as a 3 × 3 grid with monochrome, and the colour-mask eyedropper (sample the cut the mask
reads, convert with core's `encodeTransform` through an injected service, write the component's colour); every
gesture one undo step through drafts. Spec: plan `design-doc/01-implementation-plan-and-working-rules.md` §9 "P8b"
with the amendments after P8a, P7 and P5b-2; design: CHB-035 design 01 v2 Part I §3–§7 and §33.

## Step 1: Reading the spec, the diaries and the code; the decisions before code

The main agent assigned me phase P8b. I read the working rules (§1–§2), the P8b spec and the amendments after P8a,
P7 and P5b-2, the diaries 11 (P8a: the ops, their ArgSpecs and `ui` fields, the curve as monotone cubic Hermite
segments, `DEFAULT_HSL_BANDS`, the colour mask in OkLab ΔE, `encodeTransform`), 12 (P5b-2: the stack kit's panels,
rows, commands and the `editors` suggestion), 08 (P4: drafts, the net change by `diff`, a gesture as one step) and
the parts of 04 (P5a) on forms; the shell's `ck.ui.curve` and `ck.ui.wheel` renderers (`dom/forms/plane.ts`), the
stack kit (`kits/stack/src/*`), studio-kit's `dom/arg.ts`, `kit/args.ts`, `model/doc.ts`, the render bridge and the
Studio, the contract's `catalog/adjust.ts`, `view-output-mask.ts`, `compile.ts` (masks, `colourInput`, `white`),
`schema.ts` (`paramsToArgs`, list checks), core's `composite/tone.ts` and `composite/working.ts`, MockEngine's
`evaluate`, the import-boundary and colour lints, and the apps/studio host wiring of injected services.

### Prompt Context

**User prompt (verbatim):** "Ok, implement, main agent and subagents should keep a detailed diary as they work,
according to the format in the diary skill in ~/.codex/skills. Commit at appropriate intervals. Bring it all together
and add the editor lab functionality / consolidate it all."

The owner's goal (verbatim): "the target goal is to a have a powerful professional lightroom for my dad, who often
works with film (either scanning, or as film simulation), but have a flexible UI language that allows for many
reconfigurations of the application while looking cohesive and elegant. We also combine high performance webgpu
functionality, and are adding a full layer system photoshop/traditional lightroom capabilities."

**Assistant interpretation:** The main agent assigned me P8b: give the stack kit's params panel real editors for
P8a's ops (curve, levels, HSL, grade, mixer) through a per-op editors mechanism, add the colour-mask eyedropper,
make every gesture one undo step, keep one look and feel, and prove each editor with headless browser specs
(studio-kit and chromium-webgpu projects on ports 5541–5544), then merge the integration branch and recheck.

**Inferred user intent:** The photographer edits a curve, the HSL bands, the colour wheels, levels and the channel
mixer the way Lightroom lets him, on the same layer rows as everything else, and picks a colour range by clicking
the picture; a new op later costs one editor registration, not a new panel.

### What I did
- Read the documents and code listed above; `pnpm install --frozen-lockfile --prefer-offline` (no package added).
- Created this diary (`docmgr doc add --ticket CHB-037 --doc-type diary --title "Diary — phase P8b editors"`),
  renamed docmgr's `14-diary-phase-p8b-editors.md` to `15-phase-p8b-editors.md`; `docmgr doctor` clean.

### Why
- The editors sit on four existing pieces (the catalogue's ArgSpecs, the store's drafts, the shell's planes, the
  engine behind the Studio) and two rules (studio-kit never imports core; only a `dom.ts` file of a kit imports the
  DOM half); the decisions below are what they leave open.

### What worked
- `storePath(f, doc, 'hsl1b3.saturation')` already resolves any id path in a document (`physical` via the id
  index), so a band's field or a curve's point Coll is addressed like an entry's argument.
- A store draft's commit is the net change (`diff`), so a gesture that previews a whole new points Coll commits as
  the inserts, removes and sets of the points it changed: one step.

### What didn't work
- N/A (reading).

### What I learned
- `newLayer` fills a list argument with `Coll.empty()`: "+ Layer → Curve" today stores a curve with no points, which
  the catalogue's `minItems: 2` refuses, and an HSL layer with no bands. The defaults must become Colls with ids.
- The shell's `monotone` (`core/math.ts`) is not core's curve: its tangents are the arithmetic mean with the
  Fritsch–Carlson α²+β² ≤ 9 limiter, core's are Fritsch–Butland's weighted harmonic mean with scipy's end tangents.
  Drawing with it would show a different curve from the one the engine applies.
- MockEngine implements none of P8a's ops (P3b's item 4): in the studio-kit dev host a curve layer makes the print
  fail to render, but the stage input (the `print` cut, before the print stack) still evaluates, so the eyedropper
  and the histogram work there.
- The colour lint counts `#hex`, `rgb()` and `hsl()` literals only; CSS `oklch()`/`oklab()` pass it.

### What was tricky to build
- N/A (decisions only).

### What warrants a second pair of eyes
- Decisions 2, 3 and 7 below (the injected service, the shell widgets, sampling).

### What should be done in the future
- N/A for this step.

### Code review instructions
- Nothing to review yet.

### Technical details

Decisions the spec leaves open (the code follows them):

1. **The editors mechanism**: an editor is `{ covers, node }` — the arguments it edits (the generic controls skip
   them) and a θ function `(target: { id, stage, op }) => node` called when the params panel shows that layer.
   `stack.panels.params({ editors })` takes a map op → editor; the default is `stack.editors` (curve, levels, hsl,
   grade, mixer); `editors: false` shows only the generic controls. A new op adds one with
   `stack.panels.params({ editors: { ...stack.editors, myOp: stack.editor('my.form', ['a', 'b']) } })` (any form
   with a renderer; `stack.editor` passes `entry` and `stage` props).
2. **Core's functions through an injected service** `editorMath` (`EditorMath`: `curve(points)` = core's
   `toneCurve` + `evalCurve`, `levels(l)` = `evalLevels`, `encode(from, to, white)` = `encodeTransform` +
   `applyEncode`). Hosts build it from core: the studio-kit dev host and tests (`demo/editor-math.ts`), the studio's
   host file (`host/engines.ts`, beside `rollPhysics`). Without it (the studio's mock engine) the curve is drawn
   through its points with straight segments and the eyedropper is disabled with a reason.
3. **The shell's planes become widgets**: `curvePlane` and `wheelDisc` in `packages/shell/src/dom/forms/plane.ts`
   (exported from `@chromobench/shell/dom`) hold the drawing and the gestures; the `curve` and `wheel` renderers
   are thin store-binding adapters over them, and the stack kit's editors are document adapters over the same
   widgets (one look and one interaction). The curve widget takes the interpolant as `fn` (default the shell's
   `monotone`), the wheel a value `{ hue, r }` with r in 0–1.
4. **Points and bands are Colls with per-layer ids**: a new curve's points are `<id>p1`, `<id>p2`; a new HSL layer's
   bands `<id>b1`…`<id>b8`; a new point takes the smallest free `<id>p<n>` in the document; duplicate renames ids
   that start with the old layer id to the new one.
5. **Curve channel**: the segmented L/R/G/B writes the layer's `channel` (one step); the curve keeps its points (a
   curve layer acts on one channel, P8a's model). The end points move in x too (inside their neighbours), the
   curve continues along its end tangents as core defines it.
6. **Histogram of the stage input**: the cut `STAGES[stage].input` evaluated at ≤ 256 px on its long side, each
   pixel converted with `editorMath.encode` to the channel's lightness (L: OkLab L; R/G/B: the cube root of that
   linear channel), 128 bins on 0–1; cached per cut node id and channel. Shown under the levels handles and behind
   the curve.
7. **Eyedropper**: the `mask-colour` tool samples a 5 × 5 px box at the click on the cut the mask reads (the target
   mask's `reads`, `stage-input` → `STAGES[stage].input`), averages it in the cut's encoding (stage XYZ), converts
   with `encode('stage', 'oklab', white)` (white: `output.white` for the print, D65 for the scene, as the compiler),
   and commits one step: the armed component's colour (the masks panel's "Sample" button arms one), else a new
   colour component with the sampled colour. Swatches use CSS `oklab()`/`oklch()` (data colours).
8. **Levels**: the editor covers `channel` and draws the histogram with black, gamma and white handles (gamma's
   handle where the output is ½: x = black + (white − black)·0.5^γ); the catalogue's sliders for black, white and
   gamma stay under it for typed values, output black/white under More.
9. **HSL**: Hue / Saturation / Lightness segmented, one row per band (swatch, name, slider with a track of what it
   does), band widths under More. **Grade**: three wheels (hue around, strength out to the ArgSpec's usual maximum)
   with a lightness slider each; balance stays the generic control under More. **Mixer**: a 3 × 3 grid of cells
   (type, arrows, drag to scrub), a row sum, Monochrome switching the grid to the Grey row.

## Step 2: The editors, the shell's widgets, the eyedropper, the hosts' editorMath

I wrote the editors in one pass because they share one plumbing: a gesture object over the store's draft (preview
any document path by id, commit one step, a coalesced transaction for keys), the kit's one number control, and the
shell's curve and wheel widgets. The shell's `curve` and `wheel` renderers became thin store adapters over two new
widgets (`curvePlane`, `wheelDisc`), and the stack kit's editors are document adapters over the same widgets. The
first browser run found three real bugs — a click swallowed by a redraw, a double-click retargeted by pointer
capture, a second arrow press repeating the first — all fixed in the shared pieces, so the old controls gained too.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The spec's deliverables: the editors mechanism, the five editors, the eyedropper, one
undo step per gesture, one look and feel; unit tests and a browser spec per editor.

**Inferred user intent:** Lightroom's tone, colour and mask tools on the stack's layers, drawn and measured with the
engine's own numbers.

**Commit (code):** 580d454 — "CHB-037 P8b: editors for Editor lab's tools in the stack kit's params panel"; 5b5bd71 —
"CHB-037 P8b: colour range readout compact …; shell README on curvePlane and wheelDisc"

### What I did
- Shell (`dom/forms/plane.ts`): `curvePlane(scope, o)` (the drawing, click-adds-on-the-curve, drag, drag-off and
  double-click delete, double-click-empty reset, arrow nudges; `fn` the interpolant, `fixedEnds`, `maxPoints`,
  `newId` for the caller's ids) and `wheelDisc(scope, o)` (`{ hue, r }`, Shift/Mod/Alt constraints, `puck` fill);
  the `curve` and `wheel` renderers rewritten on them; exported from `@chromobench/shell/dom`; `.ck-curve-pt` gets
  `pointer-events: none`. README: the widgets.
- Stack kit, headless `kits/stack/src/editors.ts`: `EditorMath` and `mathOf(services)`; `Editor`, `Editors`,
  `EDITOR_FORMS`, `editorOf`, `defaultEditors`; lists as Colls (`listDefault`, `itemPrefix`, `pointsOf`,
  `pointsColl`, `freeItemId`); `bandWord`; `gammaAt`/`gammaOf`; measuring (`MeasureHost`, `whiteOf`, `cutRead`,
  `cutOfDoc`, `histogramOf`, `lightnessOf`, `stageHistogram` cached per cut node, `sampleCut`, `sampleOklab`);
  `oklabCss`/`oklchCss` for swatches.
- `model.ts`: `newLayer(op, { id })` makes list defaults Colls named after the layer; `addLayer` passes the id;
  `duplicateEntry` renames items that start with the old layer id after the copy (`curve2p1`).
- DOM: `controls/dom.ts` (moved out of `dom.ts`: `numberControl` with `lead` and `track`, `frameOf`, `btn`, `run`,
  `peekDoc`, `readPath` now on values' `getPath`, `words`, `numAt`); `editors/dom.ts` (`stack.curve`,
  `stack.levels`, `stack.hsl`, `stack.grade`, `stack.mixer`); `dom.ts`: the params panel mounts `editors[op]` and
  skips what it covers; a colour component shows its swatch, OkLab numbers and Sample.
- `commands.ts`: `eyedropper(ctx, x, y)` behind the `mask-colour` tool: samples, converts, writes the armed
  component's colour or adds a colour range; Sample is one shot (back to no tool); errors are toasts.
- `kit.ts`: forms `stack.curve|levels|hsl|grade|mixer`, `stack.params` slot `editors` (β),
  `stack.panels.params({ editors })`, product `editors` and `editor(form, covers)`; docs. `state.ts`:
  `mask.sample`, `hsl`. `stack.css`: the editors on shell tokens.
- Hosts: `packages/studio-kit/demo/editor-math.ts` (demo and tests), `apps/studio/src/host/engines.ts`
  `buildEditorMath()` → `HostEngine.editorMath`, passed by `main.ts` like `rollPhysics`.
- Tests: `test/stack/editors.test.ts` (8), `test/browser/editors.spec.ts` (6, studio-kit), `e2e/studio-editors.spec.ts`
  (1, chromium-webgpu); the layouts' explain snapshots now print `stack.params  editors {curve, levels, hsl, grade,
  mixer}` (reviewed: the props say it, so the form has no explain function of its own).

### Why
- One widget per kind of control keeps one look; the document adapters only translate (a Coll of points, two
  arguments of a wheel) and route writes through the draft, so the undo rule holds by construction.

### What worked
- `pnpm typecheck` 0 errors; `pnpm lint` (473 boundary checks, 184 colour files); `pnpm gen:check` ok (26 files);
  `pnpm exec vitest run` → 134 files, 3194 passed, 19 skipped (8 new).
- `editors.spec.ts` 6/6 and `e2e/studio-editors.spec.ts` 1/1 headless on SwiftShader (ports 5541–5544); on the GPU
  the histogram is measured, a dragged curve point and a sampled colour range each change the shown node, and four
  undos give the first node back.
- The eyedropper's colour equals `applyEncode(encodeTransform('stage', 'oklab', output.white), mean of the 5 × 5
  print cut)` exactly (unit test), and the blue patch of the synthetic print samples with OkLab b < 0.

### What didn't work
- `TS2345: Argument of type 'readonly CurvePt[]' is not assignable to parameter of type '{ x: number; y: number; }[]'`
  (the shell's `monotone` takes a mutable array) → `monotone(pts.slice())`.
- `validateDocument(d).filter((x) => x.level === 'error')` passed vacuously: a `Diagnostic` has no `level`; errors
  are the `E_*` codes. The test now also proves the old `+ Layer → Curve` document (empty points) fails with
  "needs at least 2 item(s)".
- Browser run 1: curve `expect(... '.ck-curve-pt').toHaveCount(2)` received 3: after a press on a point no `click`
  and no `dblclick` reached the plane (`EV pointerdown 0 / EV pointerup 0`, no `EV click`): the press target was a
  point `rect` that the redraw replaced. Fix: points are drawn with `pointer-events: none`.
- Grade: `expect(shadowsChroma).toBe(0)` received 0.05: the double-click on the puck landed on the disc (pointer
  capture during the press). Fix: the disc listens and resets when the double-click is within 10 px of the puck.
- Eyedropper: the second click found the tool off: `tool.<id>` toggles, and Sample had activated it already. Fix:
  Sample turns the tool on only when it is off; an armed sample turns it off afterwards (one shot).
- HSL: two ArrowRight presses gave 0.01, not 0.02: the second press read the cell's value before the cell saw the
  first. Fix in the shared number control (the store's value, as `cb.arg` does since CHB-034); the levels handles
  and mixer cells read the document likewise.

### What I learned
- With MockEngine the studio-kit host still renders the print while layers are at identity (they compile to
  nothing), and the stage input (`print` cut) evaluates, so histogram and eyedropper are testable there; a changed
  curve makes the mock print fail until P3b's pass-throughs land.
- `rt.ctx()` is a command context: `eyedropper(rt.ctx(), x, y)` runs headless with the same services.

### What was tricky to build
- Ids of new points in a drag: every preview rebuilds the Coll, and the previewed document already contains the new
  point, so allocating its id against the current document would give it a new id on each move. The widget asks
  `newId` once when it adds the point (against the committed document and the points in hand) and keeps the id on
  the point object; `pointsColl` keeps ids and only fills missing ones.
- The double-click on the empty plane: the first click already added a point (a step), the second press lands on
  it. The widget remembers the point the last click added (until a later move commits) and treats a double-click on
  it as "empty": reset (two steps: add, reset). A double-click on any other interior point deletes it.
- The histogram must not recompile on every preview of a drag: the cell keys on frame, channel and the published log
  version, so it runs once per commit; the cut node id (content address) is the cache key, so an edit downstream of
  the input costs one compile and no evaluation.

### What warrants a second pair of eyes
- `numberControl`'s key handler now reads the store (`st.peek`) — every amount and mask control uses it.
- The colour lint does not count `oklch()`/`oklab()`: the band swatches, the HSL tracks, the channel inks and the
  grading disc are data colours written that way (they are the colours the controls set, in every theme).
- The curve's end points move in x (inside their neighbours); core continues the curve along the end tangents, so a
  moved end point does not clip.

### What should be done in the future
- P3b: MockEngine pass-throughs for P8a's ops (until then a changed curve, HSL, … fails to render in the studio-kit
  dev host; the editors and their tests do not depend on it).
- `tools/scripts/check-colours.ts` could count `oklch(`/`oklab(` and allow-list data colours per file.

### Code review instructions
- Start at `packages/studio-kit/kits/stack/src/editors.ts`, then `editors/dom.ts`, `dom.ts` (params, colourSample),
  `commands.ts` (`eyedropper`), `packages/shell/src/dom/forms/plane.ts` (`curvePlane`, `wheelDisc`).
- `pnpm exec vitest run packages/studio-kit/test/stack`; `STUDIO_PORT=5541 STUDIO_KIT_PORT=5542 SHELL_DEMO_PORT=5543
  GPU_PARITY_PORT=5544 CI=1 pnpm exec playwright test --project=studio-kit editors.spec` and
  `--project=chromium-webgpu studio-editors`.

### Technical details
- How a new op adds an editor (a layout or a kit):
  `stack.panels.params({ editors: { ...stack.editors, myOp: stack.editor('my.form', ['a', 'b']) } })` — `my.form`
  is any form with a renderer; its node gets `entry` (the layer id) and `stage`; `a` and `b` leave the generic
  controls. `editors: false` shows only the generic controls.
- Steps per gesture: a curve click (add) or drag (move) or drag-off/double-click (delete), a channel click, a
  levels handle drag, a run of arrow keys on one control, a typed value, a wheel drag, a puck double-click, a mixer
  cell drag or typed value, the monochrome switch, Reset, an eyedropper click — one step each.
