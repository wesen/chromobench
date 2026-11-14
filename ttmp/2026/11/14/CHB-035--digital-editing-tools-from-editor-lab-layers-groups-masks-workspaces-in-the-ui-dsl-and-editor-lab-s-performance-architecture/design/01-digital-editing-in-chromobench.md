---
Title: Digital editing in chromobench — what to take from Editor lab, where it goes, and how it fits the UI DSL
Ticket: CHB-035
Status: active
Topics:
    - ui
    - architecture
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: packages/contract/src/catalog/view-output-mask.ts
      Note: mask ops; and/or/not are min/max/1-m
    - Path: packages/contract/src/graph.ts
      Note: 'compile(): the pipeline stages and the insertion points of the digital stages'
    - Path: packages/contract/src/recipe.ts
      Note: 'recipe model: masks library, exposures, retouch, finishing; where recipe.digital goes'
    - Path: packages/contract/src/vocab.ts
      Note: frame vocabulary and domains; frame.finished() would join it
    - Path: packages/studio-kit/kits/finish/src/kit.ts
      Note: 'the kit pattern: tools, commands, panels, state, docs'
    - Path: packages/studio-kit/kits/finish/src/passes.ts
      Note: CB-F101 keeps digital controls out of the Print module
    - Path: packages/studio-kit/variants/classic.js
      Note: layouts compose modules; printModule and libraryModule
    - Path: packages/studio-kit/variants/finish-module.js
      Note: 'the Finish module: the pattern for an Edit module'
ExternalSources:
    - ~/Downloads/editor-lab-work.zip (Editor lab, 12–14 Nov 2026)
Summary: 'An intern''s guide: the fundamentals of layer-based digital editing (alpha, adjustment layers, blend modes, groups, masks, neighbourhood operations), what Editor lab built and what of it to reuse, where digital edits belong in chromobench''s physical print pipeline, the recipe and graph changes, the edit kit in the UI DSL, and a phased plan.'
LastUpdated: 2026-11-14T19:30:00-05:00
WhatFor: Designing and building Lightroom/Photoshop-style precision editing in chromobench.
WhenToUse: Before touching the recipe's digital stage, the edit kit, or the layouts that host it.
---









# Digital editing in chromobench

This document explains how to give chromobench the standard tools of digital photo editing (adjustment layers,
blend modes, groups, parametric masks, selections, precise tone and colour controls) without turning the darkroom
into Photoshop. It is written for a developer who knows TypeScript and has not worked on chromobench, on image
compositing, or on photographic printing before. By the end you should be able to answer three questions with
reasons: what a digital edit is in chromobench's physical model, where in the pipeline each kind of edit belongs,
and how it reaches the photographer through the UI DSL.

The material comes from two places. The first is chromobench itself: its recipe, its compiled print graph, its
mask library, and the studio's UI DSL with its kits, modules and layouts. The second is **Editor lab**, a
separate effort (12–14 November 2026): a one-page browser photo editor with a layer stack, layer groups,
Lightroom-style mask components, ten stage tools, 32 presets, a scripting API that an agent drives, and a
nine-chapter textbook on building such an engine. Editor lab is a good teacher and a good source of algorithms.
It is not a design to copy: it works on 8-bit sRGB numbers, it has no notion of film or paper, and reading it
closely turned up defects that this document lists so you do not import them.

A companion document, `02-editor-lab-performance-architecture.md`, covers Editor lab's other half: tiles,
pyramids, content-keyed caches, scheduling, the GPU and WebAssembly, and what chromobench's engine should take
from them.

> **How to read this.** Part I builds the fundamentals in order; each section uses only what came before.
> Part II describes Editor lab. Part III is the design for chromobench, with decision records. Part IV is the
> plan. A glossary is at the end; terms in **bold** at first use are in it. File references are
> `path:line`; Editor lab paths are relative to the archive's `editor-lab/` folder.

---

## Part I — Fundamentals

### 1. Two kinds of editing

A darkroom print is made by physical steps. Light passes through a negative, through filters, onto paper for a
time; the paper is developed; the print is looked at under a lamp. Every control a darkroom printer has is a
parameter of one of those steps: exposure time, aperture, colour filtration, paper grade, a dodging card held
over part of the image for part of the time. Chromobench simulates those steps. Its controls mean what they mean
at an enlarger, and its look comes from the film's and paper's measured responses.

Digital editing works differently. A digital editor holds an image as numbers and applies functions to them:
raise these values, bend this curve, blend this layer in multiply mode, only where this mask is white. The
controls are mathematical, not physical, and their great advantage is precision: a curve can be bent at exactly
one tone, a colour range can be selected by hue, an adjustment can be confined to a feathered ellipse and faded
to 37 %.

The photographer's current workflow mixes both. Lightroom does the digital editing; Negative Lab Pro inverts
negatives; Dehancer adds a film look on top. Chromobench replaces the last two with physics. This document is
about bringing the first one in, so that he can keep the darkroom's character and add digital precision where he
wants it.

The design question is therefore not "which Photoshop features do we add" but "where, physically, does each
digital edit act". The answer decides what the edit means, which colour space it works in, and which workspace it
belongs to.

### 2. Chromobench's pipeline, one stage at a time

A frame in chromobench is a **recipe**, a JSON value (`packages/contract/src/recipe.ts`). The recipe is compiled
into a graph of operations (`compile()`, `packages/contract/src/graph.ts:252-316`); the engines evaluate the
graph. Here is the chain the compiler builds, with the **domain** of the image between steps (the domains are named
in `packages/contract/src/vocab.ts:13-19`):

```text
 negative scan                                  digital camera RAW
 ─────────────                                  ──────────────────
 source.open            camera-linear           source.open           camera-linear
 scan.flatField / flare                         source.xyz            scene XYZ (white balance)
 scan.density           scanner-density         capture.expose        exposure on the film
 scan.heal (dust)                               film.couple/halation/develop/grain
 invert.dyes            film-dyes  ◄── frame.negative() ──►           film-dyes
                 │                                     │
                 └──────────────────┬──────────────────┘
                                    ▼
 print.expose (+ print.densityMask, print.combine of dodge/burn/flash exposures, each with a mask)
 print.lights · print.preflash · print.develop          paper exposure (log H) → paper dyes
 view.reflect · view.flare · view.adapt                 print-xyz   ◄── frame.print()
 retouch.heal                                           heal and clone spots on the print
 finishing.clarity (and finishing.hue)                  digital "finishing tones"
 output.display                                         display-rgb (gamut knee, transfer curve)
 output.frame                                           crop, straighten ◄── frame.display()
```

Three facts about this chain matter for everything that follows.

- **It is one image, not a stack.** There is no alpha channel and no layer list. "Layers" exist only in the
  darkroom section, where `print.combine` adds several exposures of the same negative, each through its own mask
  (`graph.ts:276-301`). That is already a layer stack, in the exposure domain: a dodge is an exposure subtracted
  under a mask, a burn is one added.
- **Each domain has physical units.** Scanner density, film dyes, paper log exposure (log H), XYZ of the print
  under a viewing lamp. An operation is meaningful only in the domain whose units it understands. A "curves"
  adjustment on film dyes would bend dye amounts; on print-xyz it bends the light coming off the print.
- **There is already a digital stage.** `retouch.heal` and `finishing.clarity` run after `view.adapt`, in
  print-xyz, and the studio keeps their controls out of the Print module on purpose (Section 12). Digital editing
  extends this stage; it does not invent a new idea.

### 3. Pixels, coverage and the over operator

To compose layers you need to know how much of a pixel a layer covers. A layer's pixel carries colour and
**coverage** (alpha, α, from 0 to 1). The **over** operator puts a source over a backdrop:

```text
C_out = α_s · C_s + (1 − α_s) · C_b            colour
α_out = α_s + (1 − α_s) · α_b                  coverage
```

Storing colour already multiplied by its alpha (**premultiplied** colour, `c = α · C`) makes over a single
multiply-add, and it makes averaging correct: a half-covered red pixel averaged with a transparent one gives a
quarter-covered red, not a darker red. Editor lab keeps every image between layers as premultiplied 32-bit floats
and unpremultiplies only inside an operation that needs straight colour (`src/engine.js:3`; book `01.md:44-50`).

Chromobench has no alpha today because its chain has one opaque image. Alpha appears the moment a digital layer
covers only part of the picture. You will see in Section 4 that for adjustment layers the coverage is not stored
in the image at all: it is computed from the layer's opacity and mask, and the image stays opaque.

### 4. Adjustment layers: one formula

An **adjustment layer** applies a function A (a curve, a hue shift, an exposure change) to the image below it, its
**backdrop**, and mixes the result back by a coverage k:

```text
k     = opacity × mask(x, y)                       0 … 1 per pixel
C'    = C_b + k · ( B(C_b, A(C_b)) − C_b )         B is the blend mode (normal: B(b, s) = s)
```

This is the whole idea of non-destructive editing. Nothing is painted into pixels; the recipe holds A's
parameters, the opacity and the mask, and the result is recomputed. Editor lab implements it in `applyLayer`
(`src/engine.js:607-648`): unpremultiply the backdrop, apply `fn`, clamp, blend, mix by k, multiply by the
backdrop's alpha; alpha itself never changes.

Key points:

- An adjustment layer reads only its backdrop. Its own "pixels" do not exist; that is why it can be reordered,
  hidden, or re-parameterised at any time.
- k folds opacity and mask into one number per pixel. A mask is just a spatially varying opacity.
- The blend mode decides how the adjusted colour combines with the original before the mix. Most adjustment layers
  use normal; a curve in luminosity mode changes tone without shifting colour (Section 5).

### 5. Blend modes

A **blend mode** B(b, s) combines a backdrop colour b with a source colour s. **Separable** modes act on each
channel alone; **non-separable** modes act on the colour as a whole, through luminance and saturation. Editor lab
implements the W3C Compositing and Blending set: 14 separable modes plus hue, saturation, color and luminosity
(`src/engine.js:139-184`). The ones a photographer uses most:

| Mode | B(b, s) | What it is for |
|---|---|---|
| multiply | b · s | darken through a "filter" layer, shadows |
| screen | b + s − b·s | lighten, glow |
| overlay | b ≤ ½ ? 2sb : 1 − 2(1−s)(1−b) | contrast from a mid-grey layer |
| soft light | W3C piecewise (dodge/burn-like) | gentle local contrast, toning |
| color | SetLum(s, Lum(b)) | tint without changing tone (toning, split toning) |
| luminosity | SetLum(b, Lum(s)) | change tone without changing colour (curves without hue shifts) |

Two warnings before you use any formula from this table in chromobench.

- **The formulas assume display-encoded numbers in 0…1.** Editor lab blends sRGB-encoded values; its exposure and
  temperature adjustments convert to linear light and back, nothing else does (`src/engine.js:7-15`). Multiply on
  linear light is a physical filter; multiply on sRGB numbers is not. Section 10 decides which encoding
  chromobench's digital stage uses.
- **Separable modes are not colour-neutral in every encoding.** Luminosity and color are defined through a
  luminance with fixed weights; Editor lab uses Rec. 709 weights (`src/engine.js:16`), the W3C spec uses
  0.3/0.59/0.11. Chromobench should define luminance once, in its working space.

### 6. Groups: pass through and isolation

A **group** collects layers so they can be shown, hidden, faded and masked together. Groups have two semantics,
and confusing them is the most common error in layer editors.

- **Pass through** (Photoshop's default): the children act on the real backdrop, as if the group were not there,
  and the group then fades their total effect: `out = back + k·(top − back)` with k = group opacity × group mask.
  An adjustment inside a pass-through group changes everything below it.
- **Isolated** (any other blend mode): the children are composited on a transparent backdrop, and the group's
  result is blended onto the real backdrop as if it were one layer. An adjustment inside an isolated group changes
  only the group's own pixels.

Editor lab's implementation is twelve lines (`src/engine.js:671-682`):

```js
function applyGroup(eng, g, L, R, back, top) {
  const n = R.w * R.h, out = new Float32Array(n * 4), op = g.opacity, cov = eng.coverage(g, L,
      R, back, 0);
  if (g.blend === 'pass') {
    for (let j = 0, i = 0; j < n; j++, i += 4) { const k = op * (cov ? cov[j] : 1);
      for (let c = 0; c < 4; c++) out[i + c] = back[i + c] + k * (top[i + c] - back[i + c]); }
    return out;
  }
  // isolated: unpremultiply the children's composite …
  const src = scratch(2, n * 4);
  for (let i = 0; i < n * 4; i += 4) { const a = top[i + 3];
    if (a > 0) { src[i] = top[i] / a; src[i + 1] = top[i + 1] / a; src[i + 2] = top[i + 2] / a; }
    else src[i] = src[i + 1] = src[i + 2] = 0; src[i + 3] = a; }
  return blendSource(src, back, n, op, cov, g.blend, out);   // … and blend it as one source layer
}
```

`top` is "what the children made"; for a pass-through group the children were evaluated on the real backdrop, for
an isolated group on transparent (the `floor` of the stack search, `src/engine.js:440-463`). A pass-through group
at opacity 1 without a mask is the identity; Editor lab gives it its top child's cache key so it costs nothing
(`src/engine.js:467`, `:484`).

For chromobench, the question "what is a group for" has a precise answer: **a pass-through group is the unit a
photographer fades and masks** ("all my sky corrections, at 60 %, only above the horizon"), and **a preset or look
arrives as a group** so it can be removed or faded in one step. Isolated groups matter only for source layers
(painted or filled pixels), which chromobench's digital stage starts without (Section 11).

### 7. Masks as coverage functions

A **mask** is a function from position to a value in 0…1. Lightroom made a particular representation popular:
a mask is an ordered list of **components**, each a simple parametric function, combined by add, subtract and
intersect. Editor lab follows it (`src/engine.js:356-397`):

| Component | Parameters | Value at a pixel |
|---|---|---|
| linear | start, end (fractions of the picture) | 1 before the start line, 0 past the end line, smoothstep between |
| radial | centre, half-axes, rotation, feather | 1 inside the inner ellipse, smooth fall to 0 at the edge |
| brush | a one-channel raster, edge feather | the painted value, Gaussian-feathered |
| luminance range | from, to, softness | how far the backdrop's luminance lies inside the range |
| colour range | colour, tolerance, softness | how close the backdrop's colour is to the sample |

Combination, in order, starting from the first enabled component (`src/engine.js:397`, `:556-570`):

```text
add:        v = max(v, c)
subtract:   v = v · (1 − c)
intersect:  v = v · c
then        v = invert ? 1 − v : v ;   coverage = 1 − density · (1 − v)
```

Why products for subtract and intersect, when fuzzy-set theory says min? Because two feathered edges multiplied
meet in a smooth falloff; min meets them in a crease, a visible kink where the two ramps cross (book `03.md:36-43`).
Chromobench's mask algebra today is the fuzzy-set one: `mask.and` is the minimum, `mask.or` the maximum, `mask.not`
is 1 − m (`packages/contract/src/catalog/view-output-mask.ts:122-133`). Section 11 adds the product forms rather than
changing these (a decision record explains why).

Two kinds of component behave differently with respect to the image:

- **Geometric** components (linear, radial, brush) depend only on position. They can be computed anywhere, at any
  resolution, and they are what chromobench's darkroom masks already are (`mask.gradient`, `mask.ellipse`,
  `mask.paint`, `mask.feather`).
- **Range** components (luminance, colour) read the backdrop. They follow edits below them: brighten the sky and
  a luminance mask on the sky changes. In chromobench this raises a question Editor lab never faced: which domain do
  they read? A luminance range read on print-xyz selects by how bright the print is; read on the scene, by how
  bright the scene was. Section 10 answers it per stage.

### 8. Neighbourhood operations and reach

A **pointwise** operation computes each output pixel from the same input pixel: exposure, curves, hue and
saturation, every blend. A **neighbourhood** operation reads the pixels around it: blur, sharpen, clarity (a large
unsharp mask weighted to midtones), dehaze, noise reduction. How far it reads is its **reach**, in pixels. A
Gaussian of σ approximated by three box blurs has a reach of the three boxes' radii summed: 2 px at σ = 1.2,
16 px at σ = 6, 70 px at σ = 24 (Editor lab `src/engine.js:74-81`, book `04.md:39-67`).

Reach matters for three reasons in chromobench:

- **Tiling.** Exports are computed in tiles; a tile must read its reach around it (its **apron** or **halo**).
  Chromobench's tile planner already handles this, and computes very wide kernels once at reduced resolution as
  "global fields" (`packages/gpu/src/tiles.ts:1-30`).
- **Resolution.** A reach in pixels means different things at 640 px and at 6,000 px. Chromobench's physical
  kernels (grain, halation, DIR) are defined in micrometres on the film, so they scale with the picture. A
  digital clarity radius given in pixels does not (`finishing.values.clarity_radius_px`), which is why the export
  work in CHB-028 has to rescale it. New digital neighbourhood ops should state their radius as a fraction of the
  picture or in micrometres on the print, not in pixels.
- **Fusion.** Pointwise operations can be fused into one GPU pass (chromobench's pointwise kernel runs up to 12 ops
  per pass, `packages/gpu/src/chain/program.ts:14`); a neighbourhood operation ends a fused run.

---

## Part II — What Editor lab built

### 9. Editor lab in one page

Editor lab is one HTML page (`editor-lab/index.html`, built by `build.py` from `src/`). Its parts:

- **Document**: `{ code, title, w, h, sel, layers[] }`, a flat bottom-to-top list of mutable layer objects
  `{ id, kind, name, visible, opacity, blend, params, ox, oy, raster, mask, parent?, open?, meta? }`
  (`src/engine.js:345-353`). Groups are entries in the same list, their children directly below with
  `parent = group.id`.
- **21 layer kinds** (`src/engine.js:212-286`): four sources (image, paint, fill, gradient); tone (exposure, levels,
  curves); colour (hue/saturation, vibrance, temperature, black and white, invert, threshold, posterize); detail
  (blur, sharpen, clarity); effects (vignette, grain); `code` (a layer whose function is user JavaScript); `group`.
- **Masks** of components as in Section 7; **selections** as a separate one-channel raster made by marquee, lasso
  and magic wand, combined with max/min.
- **Ten stage tools** (Move, Hand, Select, Lasso, Wand, Brush, Erase, Linear, Radial, Pick). A drag is previewed
  "live" and committed as one history step (`src/views/stage.js:217-287`, `src/workspace.js:249-264`).
- **History** as a command stack of `{ label, undo(), redo() }` closures, capped at 200 entries
  (`src/workspace.js:35-44`); structural edits (group, ungroup, move into a group) are one `restructure` step
  (`src/workspace.js:133-142`).
- **Presets** (32, in five categories: tone and colour, local through masks, detail and blur, graphic, blend modes)
  stored as data, applied as new layers, wrapped in a pass-through group named after the preset when they have more
  than one layer (`src/views/presets.js:150-159`). "Edit as code" turns a preset into a program that renders
  pixel-identically.
- **Provenance**: `meta.source` on every layer says what made it: a preset, a program at a file and line, a script,
  or an agent's turn and step; the UI links both ways (`src/views/panels.js:26-75`).
- **The lab API** (`labScope`, `src/views/agent.js:9-114`): one surface that the agent, the Code view, the bench and
  the book's runnable blocks all call (`add`, `set`, `group`, `moveTo`, `mask.*`, `select.*`, `paint.*`,
  `presets.*`, `stats`, `history.*`). The report calls it "the one seam that matters" (REPORT p.8).
- **A dock** of tiles and splits with six preset layouts (Editing, Agent beside the stage, Benchmarking, …)
  (`src/dock.js:11-20`).

```text
 Stage · Layers · Params · Presets · History    Agent    Code view    Bench    Book
        │                                          │          │         │        │
        └───────────────────────┬──────────────────┴──────────┴─────────┴────────┘
                                ▼
                     lab API (labScope)  ── one seam: everything above calls it
                                ▼
                 Workspace (document, history, live/commit)
                                ▼
            Engine (tiles, content keys, pyramid, cache)  → canvas
```

### 10. What chromobench already has, and what Editor lab adds

Before adding anything, know what exists. The table compares the standard features (from Editor lab's own survey,
"Build your own Photoshop/Lightroom", 18 pages) with both systems. "Physical" means chromobench does it as a darkroom
step.

| Feature | Editor lab | Chromobench today |
|---|---|---|
| Exposure, contrast, colour balance | exposure, curves, levels, temperature (digital) | enlarger time, paper grade, filtration, printer lights (physical) |
| Dodge and burn | radial/linear masks on exposure layers | dodge/burn/flash exposures with masks (physical) |
| Contrast masking | none | `print.densityMask` (physical silver mask) |
| Crop, straighten, orientation | none | `output.frame` (finish kit) |
| Heal and clone | none | `retouch.heal` (finish kit), `scan.heal` for dust |
| Clarity, hue tweaks | clarity, hue/sat | `finishing.clarity`, `finishing.hue` |
| Grain | digital grain | physical film grain in µm |
| Curves with control points | parametric only (and buggy, Section 13) | none |
| HSL per hue band, vibrance | hue/sat (global), vibrance | `finishing.hue` (hue bands) |
| Colour grading, split toning | via colour-mode fills in luminance ranges | none |
| Parametric masks with components | linear, radial, brush, luminance, colour | gradient, ellipse, paint, luminance; and/or/not |
| Layer stack, blend modes, groups | yes (18 modes, pass-through and isolated) | exposures only, no blend modes |
| Selections (marquee, lasso, wand) | yes | none |
| Presets / looks | 32, as layer groups | looks kit (CHB-021) |
| Scripting for an agent | lab API | agent DSL (`packages/dsl`) and frame vocabulary |
| Provenance per edit | `meta.source` | edit log with `by` (auto, user, agent) |

Read the table as a map of overlaps. Chromobench already has the physical versions of most "basic" controls, and the
photographer should keep using those: they are the darkroom. What is missing is the digital precision layer:
point curves, per-band colour, colour grading, parametric masks combined freely, a layer stack with blend modes and
groups, and selections.

### 11. Reuse, adapt, leave

| From Editor lab | Verdict | Why |
|---|---|---|
| The adjustment-layer formula and `applyLayer`'s structure | **reuse** (as maths) | It is the standard; re-implement in core (f64) and WGSL |
| W3C blend modes incl. SetLum/SetSat | **reuse** (as maths) | Correct and complete; define luminance in our working space |
| Groups: pass-through vs isolated, identity shortcut | **reuse** | Exact semantics, tested (`test/groups.js`, 48 checks) |
| Mask components and their combination algebra | **adapt** | Add product subtract/intersect beside our min/max; components in our units |
| Masks as parameters, not pixels | **reuse** | Our recipe already stores masks as node definitions |
| Presets as data, applied as a named pass-through group | **reuse** | Removable and fadeable in one step; fits the looks kit |
| Provenance (`meta.source`) with two-way links | **adapt** | Our edit log knows who; add where-from (look, agent turn, script line) |
| Lab API as the single seam | **adapt** | Our seam is the recipe mutation and the DSL; keep it single |
| Immutable builders and content-hashed IR (earlier "editor grammar") | **adapt** | Our graph is already hash-consed; borrow `define()` macros with provenance |
| Ten stage tools | **adapt** | Masks tools exist; add selection tools later, in a separate kit |
| Mutable document + closure history | **leave** | Our store has transactions with patches and inverse patches |
| sRGB-number arithmetic | **leave** | We work in linear light with a defined perceptual space |
| 8-bit straight rasters | **leave** | Our images are f32 (GPU) and f64 (reference) |
| Curves implementation | **leave** | Negative contrast adds contrast (Section 13) |
| `code` layers (arbitrary user JS per pixel) | **leave** for now | Needs a sandbox and a GPU path; the QuickJS DSL is the place for programs |

### 12. How the studio keeps the physical and the digital apart today

The studio's interface is written in a JavaScript UI DSL. A **layout** (still called a variant in the code,
`packages/studio-kit/variants/*.js`) composes two vocabularies: `ck`, the CraftKit shell's (docks, panels, rows,
`when`, commands, keys) and `cb`, the studio's (`viewer`, `arg`, standard panels, `kits.*`). A layout registers
**modules**; each module fills regions:

```js
// packages/studio-kit/variants/finish-module.js (abridged)
export const finishModule = (ck, cb, o = {}) => m => {
  const fin = cb.kits.finish;
  return m
    .label('Finish').key('F')
    .txOpts(s => ({ channel: cb.current(s) }))
    .left(ck.dock.column({ width: 236 }, cb.panel.navigator({ id: 'navigator-finish' }),
        cb.panel.history({ id: 'history-finish' })))
    .center(fin.viewer({ hud: cb.hud.readout() }))
    .right(ck.dock.column({ width: 300 }, fin.cropPanel(), fin.retouchPanel(), fin.tonesPanel()))
    .bottom(ck.dock.column({ width: 124 }, cb.view.strip({ id: 'strip-finish' })))
    .keys(fin.keys);
};
```

A **kit** (`cb.kits.finish`, `packages/studio-kit/kits/finish/src/kit.ts`) bundles a domain: viewport tools with
gestures and overlays, commands, panels built from `ck.ui` and `cb.arg`, state, documentation, and **passes**:
checks that run over the layout's intermediate representation when it is built. One of them already enforces the
separation this document is about (`kits/finish/src/passes.ts`):

```js
// CB-F101: a finishing control in a module labelled Print or Darkroom
if (n.$ === 'cb.arg' && String(n.props['path'] ?? '').startsWith('finishing.'))
  p.warn('CB-F101', `cb.arg('${n.props['path']}') is a finishing control in the module
      '${m.label}'`, {
    facts: ['finishing tones are digital, after the print; the Print module is physical'],
    fix: 'move it to a Finish module (cb.kits.finish.tonesPanel()) or relabel the module' });
```

So the studio already has the three things a digital editing workspace needs: a place in the pipeline (after the
print), a kit pattern, and a rule that keeps digital controls out of the darkroom view. The design below extends all
three.

### 13. Defects found in Editor lab (do not import them)

The reading notes behind this document checked Editor lab's code against its book and report. These are real
defects; each would be easy to copy along with the algorithm.

| Defect | Evidence | Consequence |
|---|---|---|
| Negative curves contrast adds contrast | `src/engine.js:203`: for contrast < 0 the code computes `x − c·(x − S)·(−1.2)`, the same as positive; +0.3 and −0.3 both map 0.25 → 0.2162 | presets "Faded matte" (P-05) and "Flatter" (P-24) add contrast instead of removing it |
| Documented mask feather is refused | the agent's API reference offers `set(…, { mask: { feather } })` (`src/views/agent.js:118`); `checkPatch` rejects it (`src/workspace.js:209`) | agents fail on a documented call |
| Code-layer `step` dropped | `specFrom` destructures five elements; "Edit as code" writes six (`src/engine.js:309`, `src/views/code.js:77`) | slider steps lost in round trips |
| Brush masks ignore the layer offset | `src/workspace.js:410`; the wand's layer sample too (`:369`) | a moved layer's painted mask stays behind |
| Two algebras for one idea | selection subtract is `min(a, 255 − b)`, mask subtract `v·(1 − c)` (`src/workspace.js:345`, `src/engine.js:397`) | the same gesture gives different edges |
| Blending in sRGB numbers | `src/engine.js:7-16` | multiply/screen and blurs are not physical |

---

## Part III — The design for chromobench

### 14. Where digital edits live: three stages

The pipeline offers three physically distinct places for an edit. Each has a different meaning, and the
photographer's question "could I add layers on or around the negative?" has a different answer at each.

```text
 STAGE A  scene / negative            STAGE B  darkroom                 STAGE C  the finished
     print
 ───────────────────────────          ─────────────────                 ──────────────────────────
 before the film (RAW: scene XYZ;     print.expose … print.combine      after view.adapt
     (print-xyz),
 scans: scanner density)              exposures with masks              with retouch and finishing
 "what the camera/negative saw"       "how the paper is exposed"        "what is done to the
     print"
 digital, scene-referred              physical (time, filtration)        digital, print-referred
```

**Stage C, the finished print, is the primary home for digital layers.** It is where Lightroom-style precision
belongs once the print exists: a point curve on the print's tones, a colour grade on its shadows, a vignette, a
masked hue shift. Its input is light reflected from the print in XYZ, which is linear and well defined, so blend
modes and curves have a clear meaning (Section 15 chooses the working encoding). It is also where chromobench
already puts digital work (retouch, clarity), so the physical-digital boundary does not move.

**Stage A, the scene, is the right home for camera files that the photographer edits before the "film".** His
current order is Lightroom first, then Dehancer's film look. Edits in stage A reproduce that order: a local
exposure on the scene goes through the film's curve and grain afterwards, so it looks like the film would have
recorded a different scene. The cost is that stage A edits change what the first print meters (Section 18), and that
the film's nonlinearity makes their effect on the print less direct than in stage C.

**Stage B, the darkroom, already has layers**, and they should stay physical: dodge, burn and flash exposures with
masks, density masks. What stage B gains from this work is the mask library: parametric components (Section 16)
can drive a dodge as precisely as a digital adjustment.

**On the negative itself**, generic digital layers do not make sense. A negative scan is inverted and orange; an
adjustment on scanner density acts through the film's inversion and the paper's curve, so a "+0.2 brightness" on
the negative lands as an unpredictable change on the print. The useful operations around the negative are the
physical ones, and they exist: dust healing on the scan (`scan.heal`), the density mask sandwiched with the
negative (`print.densityMask`), and dodging and burning through the enlarger. If the photographer wants "layers
around the negative", the honest offer is stage B with better masks.

#### Decision: the primary home of digital layers

- **Context:** Digital edits can act on the scene, on the paper exposure, or on the finished print; each choice
  changes their meaning, colour space and UI placement.
- **Options considered:** (1) one digital stage after the print; (2) one before the film; (3) both, as two stages
  with the same layer model; (4) layers inside the darkroom exposure stack.
- **Decision:** (3), built in order: stage C first, stage A second, with one layer model and one UI kit. Stage B
  keeps its physical exposures and gains the mask components.
- **Rationale:** Stage C matches where precision is wanted and where chromobench already does digital work; stage A
  reproduces the photographer's Lightroom-then-film order for camera files; one model keeps the code and the UI
  single. Option (4) would mix physical and digital controls in the darkroom, which the studio deliberately avoids
  (CB-F101).
- **Consequences:** Two compile insertion points; range mask components must say which stage's image they read;
  stage A edits interact with first-print metering (Section 18).
- **Status:** proposed.

### 15. The working space of the digital stages

Editor lab does arithmetic on sRGB-encoded numbers. Chromobench must not: its images are linear light with
physical meaning, and its display transform already works in OkLCh (`output.display`'s knee). The digital stages
need two encodings:

- **Linear RGB** (a wide-gamut linear space such as linear Rec. 2020 under D65, converted from print-xyz) for
  operations that model light: exposure, multiply and screen, blurs, clarity's low-pass, mixing by coverage.
- **A perceptual encoding** (OkLab/OkLCh, already used by `output.display`) for operations defined by eye: curves,
  hue/saturation per band, vibrance, colour grading, luminance used by masks and by the luminosity and color modes.

Each digital op declares which encoding it works in; the compiler inserts the conversions, and adjacent ops in the
same encoding fuse without converting back and forth.

#### Decision: working encodings of digital ops

- **Context:** Blend modes and adjustments have different results in different encodings; Editor lab's sRGB-number
  arithmetic is not physical.
- **Options considered:** (1) sRGB numbers, as Editor lab and as display-referred editors do; (2) linear only;
  (3) linear for light-like ops, OkLab/OkLCh for perceptual ones, declared per op.
- **Decision:** (3).
- **Rationale:** Light-like operations must be linear to agree with the physics; tone and colour controls must be
  perceptual so a slider's travel feels even. OkLCh is already in the codebase.
- **Consequences:** Every digital op's catalogue entry gains an `encoding` field; parity tests must use the same
  conversions in core and WGSL; preset values from Editor lab do not transfer numerically and must be re-tuned.
- **Status:** proposed.

### 16. The recipe: a digital layer stack

The recipe gains one field per stage, in the existing record-keyed style (`print.densityMasks`, `retouch.spots`):

```ts
// packages/contract/src/recipe.ts (proposed)
export type DigitalKind =
  | 'curve' | 'levels' | 'exposure' | 'hsl' | 'vibrance' | 'grade' | 'mixer' | 'temperature'
  | 'clarity' | 'sharpen' | 'vignette' | 'group';

export interface DigitalLayer {
  kind: DigitalKind;
  name: string;
  enabled: boolean;
  opacity: number;                 // 0..1
  blend: BlendMode | 'pass';       // 'pass' only on groups
  params: Record<string, unknown>; // validated by the op's ArgSpecs
  mask: string | null;             // id into recipe.masks (shared with darkroom exposures)
  // a group's id; children are listed after their group in `order`
  parent: string | null;
  source?: Provenance;             // what made it (look, agent turn, script line, user)
}

export interface DigitalStage { order: string[]; layers: Record<string, DigitalLayer> }

export interface FrameRecipe {
  // …
  digital: { scene: DigitalStage; print: DigitalStage };   // stage A and stage C
}
```

Design notes:

- **`order` plus records** gives cheap reordering (one `set digital.print.order` mutation) and stable ids for the
  edit log, controls and provenance; Editor lab's single array conflates both.
- **Masks are shared.** `mask` is an id into `recipe.masks`, the library that darkroom exposures already reference
  (`graph.ts:293-296`). One "sky" mask can drive a burn in the darkroom and a hue shift on the print.
- **Pixels never enter the recipe.** Like Editor lab's presets ("presets hold settings, not pixels",
  `src/views/presets.js:125-139`), and like the finish kit ("the recipe stores vectors, never pixels"). Brush masks
  are stored as strokes (`mask.paint`'s canonical JSON).
- **The edit log is the history.** Every change is a recipe mutation, recorded with its inverse by the studio's store
  (`packages/shell/src/core/store.ts:215-221`); grouping several layers is one transaction, the counterpart of
  Editor lab's `restructure`.

The contract change follows `packages/contract/CONTRACT-DECISIONS.md`'s template:

```text
CC-NNN  digital.scene,
    digital.print: digital layer stacks before the film and after the print (CHB-035)
class:     additive (minor); new recipe paths, new ops in area 'digital'
changes:   FrameRecipe.digital; DigitalLayer/DigitalStage types; ops digital.* ;
    mask.subtract/intersect (product forms)
consumers: DSL (generated), UI (generated controls; edit kit), engines (core reference,
    GPU WGSL; mock: pass-through)
migration: migrations[n] adds empty stages to stored recipes (no picture change)
tests:     conformance cases per op; laws (identity at k = 0; pass-through group at opacity 1 is
    the identity)
```

### 17. Compiling the stack

Each layer becomes graph nodes; hash-consing (`g.intern`) gives every node a content id, so an unchanged prefix of
the stack is the same nodes after every edit, and the engines' caches see that.

```ts
// packages/contract/src/graph.ts (proposed, after finishing.clarity)
function compileDigital(stage: DigitalStage, back: Node, g: Graph, r: FrameRecipe): Node {
  const roots = stage.order.filter(id => stage.layers[id]?.parent == null);
  return foldLayers(roots, back);

  function foldLayers(ids: string[], below: Node): Node {
    let v = below;
    for (const id of ids) {                     // bottom to top
      const L = stage.layers[id]!;
      if (!L.enabled || L.opacity <= 0) continue;
      v = L.kind === 'group' ? group(id, L, v) : layer(L, v);
    }
    return v;
  }
  function layer(L: DigitalLayer, back: Node): Node {
    const adjusted = I(`digital.${L.kind}`, [back], L.params);                 // A(C_b)
    // opacity × mask, or null
    const k = coverage(L, back);
    return I('digital.mix', [back, adjusted, ...(k ? [k.id] : [])], { blend: L.blend,
        opacity: L.opacity });
  }
  function group(id: string, G: DigitalLayer, back: Node): Node {
    const kids = stage.order.filter(k => stage.layers[k]?.parent === id);
    if (G.blend === 'pass') {
      // children act on the backdrop
      const top = foldLayers(kids, back);
      // identity: no node at all
      if (G.opacity >= 1 && !G.mask) return top;
      return I('digital.mix', [back, top, ...maskOf(G, back)], { blend: 'normal',
          opacity: G.opacity });
    }
    // isolated: from transparent
    const top = foldLayers(kids, I('digital.transparent', [back], {}));
    return I('digital.composite', [back, top, ...maskOf(G, back)], { blend: G.blend,
        opacity: G.opacity });
  }
}
```

Two properties are worth checking in review. A pass-through group at full opacity without a mask produces **no
node** (Editor lab's identity rule, made structural). And a disabled layer produces no node, so toggling a layer off
returns to exactly the graph, and the cached results, of the stack without it.

The insertion points:

```text
stage A (scene):   … capture.expose's input: source.xyz → compileDigital(scene) → capture.expose
    …   (camera RAW)
stage C (print):   … finishing.clarity → compileDigital(print) → output.display …
```

For negative scans stage A is not compiled (Section 14). `frame.print()` keeps naming `view.adapt`; a new accessor
`frame.finished()` names the output of stage C, so the agent and the viewer can address both.

### 18. Operations, engines and parity

Every new op needs three implementations: core (f64, the reference; `packages/core/src/ops/ops.ts`), the GPU
engine (WGSL; pointwise ops as opcodes of the fused kernel `packages/gpu/kernels/pointwise.wgsl`, neighbourhood ops
as spatial passes), and the mock engine (pass-through). Each gets a conformance case and a parity test against core,
like every existing op.

| Op (area `digital`) | Encoding | Class | Parameters (proposed) | Source of the algorithm |
|---|---|---|---|---|
| `digital.curve` | OkLab L (or per channel) | pointwise (LUT) | control points, channel | standard monotone cubic; **not** Editor lab's parametric curve |
| `digital.levels` | linear or OkLab | pointwise | black, white, gamma, output range, per channel | Editor lab `levels` + per channel |
| `digital.exposure` | linear | pointwise | EV, offset | Editor lab `exposure` (already linear) |
| `digital.hsl` | OkLCh | pointwise | per band hue/sat/lum, band widths | extends `finishing.hue` |
| `digital.vibrance` | OkLCh | pointwise | amount | Editor lab `vibrance`, in chroma |
| `digital.grade` | OkLab | pointwise | shadows/midtones/highlights colour wheels, balance | colour grading; Editor lab P-07 approximates it |
| `digital.mixer` | linear | pointwise | 3 × 3 matrix, monochrome flag | Editor lab `bw` generalised |
| `digital.clarity` / `digital.sharpen` | linear (low-pass), OkLab L (detail) | neighbourhood, radius in µm on the print | amount, radius | Editor lab `clarity`/`sharpen` (unsharp, midtone weight) |
| `digital.vignette` | linear | positional | amount, size, feather | Editor lab `vignette` |
| `digital.mix` / `digital.composite` | linear | pointwise | blend, opacity | Sections 4–6 |
| `mask.subtract`, `mask.intersect` | — | pointwise | other | product forms of Section 7 |
| `mask.colourRange` | OkLab ΔE | pointwise, reads an image | colour, tolerance, softness | Editor lab `color` component, in ΔE instead of RGB distance |

The parity tolerance for display-path ops is chromobench's usual one (within one 8-bit level; most ops far less).
Pointwise digital ops fuse into the existing pointwise kernel; its `MAXOPS = 12` limit (`program.ts:14`) splits long
stacks into several passes, which is correct and needs no special handling.

#### Decision: mask combination algebra

- **Context:** Chromobench's masks combine by min/max (`mask.and`, `mask.or`); Lightroom-style components combine by
  max for add and products for subtract and intersect, which avoids creases between feathered edges.
- **Options considered:** (1) keep min/max only; (2) switch `mask.and` to a product; (3) add `mask.subtract` and
  `mask.intersect` as products and keep `mask.and`/`mask.or`.
- **Decision:** (3).
- **Rationale:** Changing `mask.and` would change stored darkroom masks' pictures (a breaking change); the product
  forms are what the component UI needs.
- **Consequences:** Two intersections exist; the mask panel uses the product forms, the catalogue documents both.
- **Status:** proposed.

**Stage A and the first print.** The first print meters the image that reaches the paper (`firstPrint`,
`apps/studio/src/host/first-print.ts`). A stage A edit changes that image, so it changes the proposed exposure. That
is the darkroom's behaviour (a brighter scene prints with a shorter time), and it is what the photographer expects
if he thinks of stage A as "the scene". The UI should say so when a stage A edit moves the first print, and the
first print should not re-run automatically on every stage A edit (today it is made when a frame is opened).

### 19. The edit kit in the UI DSL

The digital stages reach the photographer through a new kit, `cb.kits.edit`, built like the finish kit and in the
shape CHB-029 sets for all kits (declarative command tables, capability-gated host actions, typed selectors,
catalogue-driven controls with an "Advanced" disclosure).

```ts
// packages/studio-kit/kits/edit/src/kit.ts (sketch)
export function createEditKit(ck: Ck, cb: Cb) {
  const kit = ck.kit('cb.edit', k => k
    .version('1').requires('cb.core')
    .state('edit', { init: { stage: 'print', active: null, selection: [] }, view: true })
    .passes(physicalModulePass)                 // CB-E101 below
    .tools(t => t
      .tool('mask-linear',  { label: 'Linear gradient', key: 'G', on: linearGestures })
      .tool('mask-radial',  { label: 'Radial gradient', key: 'U', on: radialGestures })
      .tool('mask-brush',   { label: 'Mask brush',      key: 'B', on: brushGestures }))
    // add layer, group, ungroup, move, duplicate, delete, fold …
    .commands(c => c.table(EDIT_COMMANDS))
    .docs(EDIT_DOCS));
  return {
    kit,
    viewer: (o?) => cb.viewer(s => cb.frame(s)?.finished() ?? null, { tools: ['mask-linear',
        'mask-radial', 'mask-brush'], ...o }),
    // the stack with groups, fold, drag into a group, opacity, blend, mask thumbnail
    layersPanel: (o?) => …,
    // the active layer's controls, from the catalogue (cb.arg on …layers.<id>.params.*)
    paramsPanel: (o?) => …,
    // components: + linear/radial/brush/luminance/colour, op (+ − ∩), invert, amount
    masksPanel:  (o?) => …,
    stagePicker: () => …,        // Scene | Print, for camera files
    keys: { 'Mod+G': 'edit.group', 'Mod+Shift+G': 'edit.ungroup', Delete: 'edit.delete',
        '[': ['brush.size', -1], ']': ['brush.size', 1] },
  };
}
```

Panels are built only from `ck.ui` and `cb.arg`, as the finish kit's are, so every host renders them without extra
renderers. The Layers panel's operations map to recipe transactions:

| Gesture in the Layers panel | Recipe transaction (one undo step) |
|---|---|
| + Layer ▸ Curve | `set digital.print.layers.<id>` (new), `set digital.print.order` |
| Group (selection) | new group record; `parent` of each selected; `order` |
| Drag into a group | `parent`, `order` |
| Opacity drag | live preview while dragging, one `set …opacity` on release (the shell's draft/commit) |
| Mask ▸ + Radial | `set masks.<mid>` (component nodes), `set …layers.<id>.mask = <mid>` |

A pass keeps the darkroom physical, like CB-F101:

```js
// CB-E101: a digital layer control or the edit viewer in a module labelled Print or Darkroom
p.warn('CB-E101', `the edit kit's ${what} is in the module '${m.label}'`, {
  facts: ['digital layers act on the scene or on the finished print; the Print module is the
      darkroom'],
  fix: 'put it in an Edit module, or relabel the module' });
```

#### Workspaces: how layouts arrange it

Because layouts are programs, each arrangement the photographer might prefer is a few lines. Three examples (the
`edit.*` parts are the proposed kit; `ck` and `cb` calls are today's API unless marked):

```js
// 1. Classic plus an Edit module: Library, Print, Edit, Finish as separate screens
s.module('edit', m => m.label('Edit').key('E')
  .left(ck.dock.column({ width: 260 }, edit.layersPanel(),
      cb.panel.history({ id: 'history-edit' })))
  .center(edit.viewer({ hud: cb.hud.readout() }))
  .right(ck.dock.column({ width: 300 }, edit.paramsPanel(), edit.masksPanel()))
  .bottom(ck.dock.column({ width: 124 }, cb.view.strip({ id: 'strip-edit' })))
  .keys(edit.keys));

// 2. Darkroom with a digital palette: the print fills the centre, the enlarger right,
//    the digital stack in a collapsible tile under it (one screen, two clearly labelled zones)
.right(ck.dock.column({ width: 300 },
  ck.panel('enlarger', { title: 'Enlarger' }, …),
  ck.panel('digital', { title: 'Digital (after the print)', collapsed: true /* proposed */ },
      edit.layersPanel({ compact: true }))))

// 3. Camera files: Scene edits before the film in their own module,
    opened from the photo's first print
s.module('scene', m => m.label('Scene').key('Mod+Alt+S')
  .center(edit.viewer({ stage: 'scene' })).right(ck.dock.column({ width: 300 },
      edit.layersPanel({ stage: 'scene' }), edit.paramsPanel())));
```

Arrangement 2 is the one to test first with the photographer persona: it keeps one screen, which he liked in the
darkroom layout, and the panel title states that the digital stack acts after the print. CB-E101 would warn on it
because the module is labelled Darkroom; a layout that does this on purpose should acknowledge the warning with a
module option (proposed: `.allow('CB-E101')`; the DSL has no such option yet), which documents the choice in the layout.

### 20. Looks, presets and provenance

Chromobench's looks kit (CHB-021) is where presets live. A look that contains digital layers arrives as a
pass-through group named after the look, as in Editor lab, so it can be faded with one slider, masked as a whole,
and removed in one step. Each layer carries `source: { kind: 'look', id, name, index }`; the agent stamps
`{ kind: 'agent', thread, turn, step }`; a DSL script stamps `{ kind: 'script', file, line }`. The Layers panel shows
a chip; clicking it opens the look, the agent's step or the script line; the look's panel lists "on this frame: these
layers". This is Editor lab's provenance design (`src/views/panels.js:26-75`), and the edit log already records who
made each change, so the addition is only where-from.

For DSL authors, the earlier "editor grammar" sketch in the archive suggests macros that expand at build time and
keep provenance (`earlier-work/editor-grammar-examples/editor-grammar-examples.mjs:252-274`):

```js
const sunGlow = define('adjust.sunGlow', {
  params: { center: param.point({ default: [0.6, 0.35] }), strength: param.slider({ min: 0,
      max: 1, default: 0.5 }) },
  expand: ({ center, strength }) => adjust.temperature(strength.map(s => s * 40))
    .mask(mask.radial({ center, radius: [0.2, 0.14], feather: 0.6 })),
});
```

In chromobench the same idea is a look that expands into digital layers and mask records, with each expanded layer
carrying the macro's name in its provenance.

### 21. The agent's surface

Editor lab's agent and scripts call one API; chromobench's agent uses the DSL in a QuickJS sandbox
(`packages/dsl`) and the frame vocabulary (`packages/contract/src/vocab.ts`). The digital stages extend both:

```js
// in the agent DSL (sketch)
const f = frame('DSC_8559');
const sky = f.masks.add('sky', mask.gradient({ from: [0.5, 0], to: [0.5,
    0.55] }).intersect(mask.luminance({ above: 0.5, softness: 0.1 })));
const g = f.digital.print.group('Sky', { opacity: 0.8, mask: sky });
g.add('curve', { points: [[0, 0], [0.5, 0.44], [1, 1]] });
g.add('hsl', { blue: { sat: -0.15 } });
f.finished().stats();          // the agent checks its result on the finished print
```

Each call is one recipe transaction with the agent's provenance; reads (`stats`, `sample`) evaluate
`frame.finished()`. Keep the API single, as Editor lab's report insists: the UI, the agent and scripts should all
reach the stack through the same recipe mutations.

---

## Part IV — Plan

### 22. Phases

| Phase | Content | Files | Done when |
|---|---|---|---|
| 1 | Contract: `DigitalLayer`, `DigitalStage`, `recipe.digital`, migration; ops `digital.mix`, `digital.composite`, `digital.curve`, `digital.levels`, `digital.exposure`, `digital.hsl`; `mask.subtract`, `mask.intersect`; compile stage C | `packages/contract/src/{recipe,graph,paths}.ts`, `catalog/digital.ts`, `CONTRACT-DECISIONS.md` | contract tests, laws (k = 0 identity; pass-through identity), conformance cases |
| 2 | Core reference implementations, parity cases | `packages/core/src/ops/` | conformance on the reference engine |
| 3 | GPU: pointwise opcodes, mix/composite, encodings (linear ↔ OkLab) | `packages/gpu/kernels/pointwise.wgsl`, `src/chain/program.ts` | gpu-parity on SwiftShader and `REAL_GPU=1` |
| 4 | Edit kit: layers, params, masks panels; mask tools; commands; CB-E101 | `packages/studio-kit/kits/edit/` | kit unit tests; studio-kit browser spec |
| 5 | Layouts: Edit module in classic; darkroom-with-palette arrangement | `packages/studio-kit/variants/` (layouts after CHB-029) | browser specs; explain snapshots |
| 6 | Cosplay session with the photographer persona on both arrangements | CHB-026 protocol | findings triaged; the default arrangement chosen with the owner |
| 7 | Neighbourhood ops (`clarity`/`sharpen` in µm), `grade`, `vibrance`, `mixer`, `vignette`; colour-range masks | as above | parity; export tiling with halos |
| 8 | Stage A for camera files; first-print interaction; `frame.finished()` and DSL words | `graph.ts`, `vocab.ts`, `packages/dsl` | DSL tests; persona session on a RAW |
| 9 | Looks as groups; provenance chips and links | looks kit, edit kit | looks tests |
| 10 | Selections (marquee, lasso, wand) as mask sources, in a separate kit | `kits/select/` | only if the photographer asks for them |

Phases 1–6 give a usable stage C with curves, levels, HSL, groups and parametric masks, and answer the open UI
question with the photographer before the larger op set is built.

### 23. Testing

- **Laws** (contract): an adjustment at k = 0 is the identity; a pass-through group at opacity 1 without a mask
  compiles to no node; isolated and pass-through agree when every child is a normal source layer; toggling a layer
  off yields the same node ids as the stack without it.
- **Conformance and parity**: each op against core in both engines, on SwiftShader and on Metal (`REAL_GPU=1`).
- **Golden pictures**: a stack of each op through a mask, compared to stored references, small and synthetic.
- **Geometry**: masks and digital layers survive the full-resolution export (CHB-028's scaler must include
  `digital.*` mask references).
- **UI**: the Layers panel's gestures each produce exactly one undo step; CB-E101 fires where it should.
- **Persona sessions**: the arrangement question is a usability question; it is answered by watching, not by
  arguing.

### 24. Risks and open questions

- **Scope creep toward Photoshop.** The photographer asked for precision, not for pixel painting. Start without
  source layers (fills, paint, images); add them only on request.
- **Two places for similar controls.** Exposure exists as enlarger time (physical) and as `digital.exposure`. The
  layouts must make the difference visible (stage labels, CB-E101), and the darkroom should remain the first place
  he reaches for exposure and colour.
- **Range masks and stage A.** A luminance mask in stage A reads the scene, in stage C the print; the mask panel
  must say which.
- **Performance of deep stacks.** Each digital layer adds nodes; long stacks at 4,000 px need the caching and
  checkpoint work of the companion document.
- **Open, for the owner:** which arrangement is the default (Section 19); whether stage A is wanted at all; whether
  selections are wanted.

---

## Glossary

| Term | Meaning here |
|---|---|
| **adjustment layer** | a layer that applies a function to its backdrop and mixes the result by its coverage; holds parameters, not pixels |
| **alpha / coverage** | how much of a pixel a layer covers, 0…1 |
| **apron / halo** | the extra pixels around a tile that a neighbourhood op must read |
| **backdrop** | the image a layer is applied to: the composite of everything below it |
| **blend mode** | a function B(backdrop, source) that combines colours before mixing by coverage |
| **component (mask)** | one simple mask function (linear, radial, brush, luminance range, colour range) in a mask's ordered list |
| **domain** | the physical meaning and units of an image between two ops (scanner density, film dyes, print-xyz, …) |
| **edit log** | chromobench's per-frame history of recipe mutations, with who made each |
| **group, pass-through** | a group whose children act on the real backdrop; the group fades their total effect |
| **group, isolated** | a group whose children are composited on transparent and blended as one layer |
| **hash-consing** | building graph nodes so that equal (op, inputs, arguments) give the same node and id |
| **kit** | a studio-kit bundle of tools, commands, panels, state and passes for one domain (finish, roll, looks, edit) |
| **layout (variant)** | a program in the UI DSL that arranges modules and panels into the studio's screens |
| **mask** | a coverage function in 0…1 that confines an edit; in chromobench, node definitions in `recipe.masks` |
| **module** | one screen of a layout (Library, Print, Finish, Edit), with left/centre/right/bottom regions |
| **neighbourhood op** | an op that reads pixels around each output pixel (blur, clarity); has a reach |
| **OkLab / OkLCh** | a perceptual colour space (lightness, a, b) and its polar form (lightness, chroma, hue) |
| **over** | the operator that puts a source over a backdrop by its coverage |
| **pass (layout pass)** | a check that runs over a built layout and warns or errors (CB-F101, CB-E101) |
| **pointwise op** | an op whose output pixel depends only on the same input pixel |
| **premultiplied colour** | colour stored multiplied by its alpha |
| **print-xyz** | the domain after `view.adapt`: light reflected from the print under the viewing lamp, CIE XYZ |
| **provenance** | the record of what made a layer: a look, an agent step, a script line, the user |
| **reach** | how far, in pixels, a neighbourhood op reads |
| **recipe** | the JSON value that describes a frame's whole edit; compiled to a graph |
| **separable (blend)** | acting on each colour channel independently |
| **stage A / B / C** | scene or negative before the film / darkroom exposure / the finished print |

## References

- Chromobench: `packages/contract/src/graph.ts:252-316` (compile); `packages/contract/src/recipe.ts:28-195`
  (recipe); `packages/contract/src/vocab.ts` (frame vocabulary, domains); `packages/contract/src/catalog/view-output-mask.ts`
  (mask ops); `packages/studio-kit/variants/{classic,darkroom,finish,finish-module,lab}.js` (layouts);
  `packages/studio-kit/kits/finish/src/{kit,passes}.ts` (kit pattern, CB-F101); `packages/gpu/src/chain/program.ts`
  (pointwise kernel, `MAXOPS`); `ttmp/2026/11/12/CHB-029--…/design-doc/01-plan.md` (UI DSL plan).
- Editor lab (`editor-lab/`): `src/engine.js` (layers 345–353, blend 139–184, masks 356–397 and 556–603, stack
  440–467, applyLayer 607–648, applyGroup 671–682); `src/workspace.js` (history 35–44, restructure 133–142, masks
  266–333, selections 336–394); `src/views/{stage,panels,presets,agent,code}.js`; `src/dock.js`; book chapters 01–04
  and 09.4; `REPORT.pdf`; `earlier-work/docs/Build your own Photoshop-Lightroom - features and algorithms.pdf`;
  `earlier-work/editor-grammar-examples/editor-grammar-examples.mjs`.
- Companion: `02-editor-lab-performance-architecture.md`.
