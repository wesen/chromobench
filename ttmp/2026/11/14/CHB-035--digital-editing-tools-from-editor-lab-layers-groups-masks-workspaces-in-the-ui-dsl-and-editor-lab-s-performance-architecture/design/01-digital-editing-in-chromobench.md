---
Title: One editing model for chromobench (v2) — stages, layers, groups and masks as one concept, composable builders, an eval-complete workbench
Ticket: CHB-035
Status: active
Topics:
    - ui
    - architecture
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: packages/studio-kit/kits/finish/src/kit.ts
      Note: 'the kit pattern: tools, commands, panels, state, docs'
    - Path: packages/studio-kit/kits/finish/src/passes.ts
      Note: CB-F101 keeps digital controls out of the Print module
    - Path: packages/studio-kit/variants/classic.js
      Note: layouts compose modules; printModule and libraryModule
    - Path: packages/studio-kit/variants/finish-module.js
      Note: 'the Finish module: the pattern for an Edit module'
    - Path: repo://packages/contract/src/catalog/view-output-mask.ts
      Note: mask ops (min/max today); replaced by one product algebra
    - Path: repo://packages/contract/src/editlog.ts
      Note: EditLog; merged with the store's document tier into one history
    - Path: repo://packages/contract/src/graph.ts
      Note: compile(); becomes one compiler over stage laws with named cuts
    - Path: repo://packages/contract/src/mutations.ts
      Note: five special mutations; replaced by set/insert/remove/move
    - Path: repo://packages/contract/src/recipe.ts
      Note: the recipe v2 that the document format 3 replaces (six list shapes, finishing fields)
    - Path: repo://packages/contract/src/vocab.ts
      Note: frame accessors; become the named cuts
    - Path: repo://packages/core/src/print/exposures.ts
      Note: combinePixel, the darkroom law the light law must reproduce; compileExposures (deleted)
    - Path: repo://packages/dsl/src/host/print.ts
      Note: printChain, the drifted third copy of the exposure semantics (deleted)
    - Path: repo://packages/shell/src/build/shell-builder.ts
      Note: mutable ShellBuilder/ModuleBuilder; become immutable value builders
    - Path: repo://packages/shell/src/ir/slots.ts
      Note: binding-time glyphs; gain the compile time (kappa)
    - Path: repo://packages/studio-kit/kits/looks/src/engine/look.ts
      Note: CHB-021 looks; become look functions returning groups (links)
ExternalSources:
    - ~/Downloads/editor-lab-work.zip (Editor lab, 12–14 Nov 2026)
Summary: 'Version 2 (hard cut-off): one model of stages (medium, stack, law), layers, groups, masks and links from the scan to the finished print; one collection idiom, mutation set, history and compiler; a core of immutable fluent builders with modifiers and four binding times for lambdas; a workbench an agent drives with eval alone; the fundamentals of layer editing and what to take from Editor lab; a phased plan.'
LastUpdated: 2026-11-14T22:30:00-05:00
WhatFor: Building the unified editing model, the builder core and the agent workbench of chromobench.
WhenToUse: Before touching the document model, the compiler, the stack kit, the UI DSL builders or the agent surface.
---




# One editing model for chromobench (v2)

*Stages, layers, groups and masks as one concept from the scan to the finished print; a core of composable fluent
builders around a few components, customised by lambdas at defined times; a workbench an agent can drive with
`eval` alone. Version 2 of the CHB-035 design; it replaces version 1's additive plan.*

## The goal

Chromobench is becoming a professional Lightroom for one photographer, the owner's father, who works with film: he
scans negatives, and he wants film's look for his digital camera files. Four requirements shape everything in this
document.

1. **A darkroom and a digital editor in one model.** The physical print chain (scan, film, paper, enlarger) stays the
   heart of the look. Around it he gets the full digital toolset of Lightroom and Photoshop: adjustment layers,
   blend modes, groups, parametric masks, curves, colour grading, retouching, later selections.
2. **A UI language that reconfigures without falling apart.** The studio's interface is a program in a JavaScript
   UI DSL. It must allow many arrangements (one screen with a darkroom and a digital palette, separate modules,
   layouts for scans or camera files, layouts an agent writes) while every arrangement looks and behaves as one
   coherent, elegant application.
3. **High performance.** The engine is WebGPU (with an f64 reference engine for correctness). Every edit must keep
   the interactive path fast: unchanged work reused, pointwise work fused, wide work computed once.
4. **An agent with only `eval`.** An agent that can evaluate DSL code, and nothing else, must be able to do
   everything the photographer can do and see everything he can see: edit any stage, build and inspect layouts, run
   any command, read the state, explain any value.

The quality we aim for is a small, robust core: **a few components, each meaning one thing everywhere, composed by
one kind of builder.** Version 1 of this document added a digital layer stack next to the darkroom's exposures, the
finishing controls and the retouch spots. That would have given the photographer, the UI and the agent three ideas
of "layer". Version 2 unifies them, and since there is no backwards compatibility to keep (the owner's decision,
2026-11-14), it does so with a hard cut-off: no migrations, no wrappers, no second path.

## The design on one page

```text
 Document ─── geometry (orientation, crop)   output (display, proof, export)   links (roll, looks)
    │
    ├── Stage scan     medium: scanner, stock, base    law: repair, in order        (scans)
    ├── Stage scene    medium: camera, white balance   law: composite, scene-linear (camera files)
    ├── Stage film     medium: stock, process          law: none yet                (camera files)
    ├── Stage darkroom medium: paper, developer        law: light on the paper
    └── Stage print    medium: viewing lamp, flare     law: composite, print-referred
            │
            └── stack: Layer | Group   every entry: id, op, params, enabled, amount, mask,
                                    blend, source (provenance); groups hold entries
 Masks ──── one library, one algebra; any entry in any stage may use one
 Ops ────── one catalogue: args with units, class, encoding, the stages an op may live in
```

- **Five components** carry the whole editing model: **Op** (a catalogue entry), **Mask** (a coverage function),
  **Layer** (an op instance with amount, mask and blend), **Group** (layers that act as one), **Stage** (a medium and
  a stack, combined by the stage's **law**). A **Document** holds the stages of one frame.
- **A law per stage gives every entry the same fields with a physical meaning.** In the darkroom a layer is light on
  the paper and its amount scales the light; in the print stage a layer is an adjustment composited over the image
  and its amount is opacity. Dodge, burn, flash, a contrast mask, a colour filter, a curve, a heal spot and a colour
  grade are all layers.
- **One collection idiom, one mutation set, one history, one compiler.** Every list in the document is an ordered
  record; every change is `set`, `insert`, `remove` or `move`; one transaction log holds user, agent and automatic
  edits; one compiler serves the viewer, the export, the first print and the agent's what-if.
- **Rolls, looks and presets are linked groups**: shared definitions that appear in many frames' stacks.
- **Builders produce immutable values.** Layers, masks, looks, layouts, modules, panels and kits are all built with
  the same fluent, immutable style; a **modifier** is a function from a value to a value; `.with(m)` applies it.
- **Lambdas have four binding times**: build (once, while a value is built), compile (per frame, while the document
  is compiled: looks, bindings), interaction (per state change or gesture: selectors, handlers), and pixel (none:
  every per-pixel computation is a catalogue op with a GPU and a reference implementation).
- **The workbench is data.** Every action is a command or a transaction, every visible thing is a value with
  `explain()`; the agent's DSL reaches both, so `eval` is enough.

## What changed from version 1

| Version 1 (additive) | Version 2 (unified, hard cut-off) |
|---|---|
| a new `recipe.digital` stack beside exposures, density masks, finishing and retouch | every stage has one stack of layers and groups; all existing edits become layers |
| masks only on darkroom exposures and digital layers | any layer or group in any stage takes a mask |
| two mask intersections (`mask.and` min, `mask.intersect` product) | one algebra; `mask.and`/`mask.or` as min/max are gone |
| finishing controls and digital layers side by side | finishing becomes ordinary layers in the print stage |
| looks stay parameter edits; digital looks become groups | every look is a linked group of layers; one Amount |
| rolls keep copying a fragment into every recipe | a roll is a linked group shared by its frames |
| a recipe migration adds empty stacks | no migration: a new document format, version 3; old recipes are refused |
| the edit kit added beside the finish kit | one stack kit for every stage; darkroom and finish are its specialised views |
| UI DSL left as it is, CHB-029 later | the UI DSL becomes immutable throughout, CHB-029 folded in |
| agent API extended with `f.digital.print.group(...)` | the agent uses the same builders as the UI, and inspects the whole workbench |

> **How to read this.** Parts I and II are unchanged from version 1 except for corrections: the fundamentals of
> layer editing, then what Editor lab built. Part III is new: an honest inventory of what chromobench has today.
> Part IV is the unified model, Part V the builder core and the agent's workbench, Part VI the plan. Decision records
> sit where their decision is made. File references are `path:line` in this repository; Editor lab paths are
> relative to the archive's `editor-lab/` folder. The pattern language in `docs/patterns/` (branch
> `task/pattern-language`) names several of the shapes used here; chapters are cited by number.

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
  linear light is a physical filter; multiply on sRGB numbers is not. Section 22 decides which encoding
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
(painted or filled pixels), which chromobench's composite stages start without (Section 23).

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
is 1 − m (`packages/contract/src/catalog/view-output-mask.ts:122-133`). Version 2 replaces them
with one algebra of product forms (Section 25, Decision D4).

Two kinds of component behave differently with respect to the image:

- **Geometric** components (linear, radial, brush) depend only on position. They can be computed anywhere, at any
  resolution, and they are what chromobench's darkroom masks already are (`mask.gradient`, `mask.ellipse`,
  `mask.paint`, `mask.feather`).
- **Range** components (luminance, colour) read the backdrop. They follow edits below them: brighten the sky and
  a luminance mask on the sky changes. In chromobench this raises a question Editor lab never faced: which domain do
  they read? A luminance range read on print-xyz selects by how bright the print is; read on the scene, by how
  bright the scene was. Section 25 answers it: a mask reads its stage's input unless it names another cut.

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
| Clarity, hue tweaks | clarity, hue/sat | `finishing.clarity` (the `finishing.hue` op exists but is not compiled) |
| Grain | digital grain | physical film grain in µm |
| Curves with control points | parametric only (and buggy, Section 13) | none |
| HSL per hue band, vibrance | hue/sat (global), vibrance | none (`finishing.hue` is not wired in) |
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
print), a kit pattern, and a rule that keeps digital controls out of the darkroom view. Version 2 keeps the place
and the kit pattern, and replaces the string-prefix rule by a stage policy pass driven by the catalogue (Section 33).

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

## Part III — What chromobench has today

Unification starts with an honest count. Three read-only surveys of the code (14 November 2026) mapped the recipe,
the compiler, the UI DSL, the agent's DSL and the looks. This part lists what they found, because every duplicate
below is something version 2 removes.

### 14. The editing data

The recipe (`packages/contract/src/recipe.ts:169-197`, `RECIPE_VERSION = 2`) holds a frame's whole edit. Its edits
come in six shapes for one idea, "an ordered list of things, each maybe masked":

| Field | Shape | enabled | amount | mask | order |
|---|---|---|---|---|---|
| `print.exposures` (dodge, burn, flash, split) | array, addressed by element id (`paths.ts:36`) | yes | — | id into `masks` | array order |
| `print.densityMasks` | record by id; `set … null` deletes | yes | `amount` | — | sorted keys |
| `retouch.spots` (heal, clone) | record by id; null deletes | yes | `opacity` | — | insertion order |
| `scan.dust.spots` | plain array, set as a whole | — | — | — | array order |
| `MaskDoc.shapes` (studio mask editor) | list, or-folded into one mask (`studio-kit/src/model/tools.ts:203-218`) | — | — | — | — |
| `mask.paint` strokes | list inside a canonical JSON string arg | — | — | — | — |

Three ops take a list as a JSON string (`scan.heal`, `retouch.heal`, `mask.paint`). The masks library (`masks`)
stores node closures, is written by its own mutation (`mask.set`), and cannot be deleted. Masks reach only darkroom
exposures: retouch and finishing take none.

Finishing is mostly empty. `compile` reads `finishing.values.clarity` and its radius (`graph.ts:312-313`);
`finishing.look` and `finishing.hues` are stored but never compiled, and the `finishing.hue` op exists without being
wired in. Roll settings live as a `fragment` copied into every frame's recipe (`roll.ts:21-32`).

Mutations are a closed set (`mutations.ts:9-14`): `set`, `exposure.add`, `exposure.remove`, `mask.set`,
`frame.add`, so each collection has its own idiom for adding and deleting.

### 15. The compiler and its copies

`compile()` (`graph.ts:252-316`) builds the chain of Section 2, with hash-consed nodes (`g.intern`, `nodeId` is the
sha256 of op, canonical args and input ids). Its darkroom part is already a law: exposures add in linear exposure
H under their masks, a dodge subtracts from the main exposure, a flash adds light that did not pass the negative,
and density masks multiply the transmission (`combinePixel`, `packages/core/src/print/exposures.ts:32-47`):

```text
H = 10^(−Σ d_m) · ( max(10^x − Σ_dodge r·m·10^x_i, 0) + Σ_add r·m·10^x_i )
    + Σ_flash r·m·10^x_flash
```

The exposure semantics exist **three times**: in `compile` (`graph.ts:281-301`), in the agent DSL's what-if
`printChain` (`packages/dsl/src/host/print.ts:28-80`), and in `compileExposures` (`core/src/print/exposures.ts:84-121`)
for the studio's tools. The DSL copy says it "mirrors compile()" and has drifted: it knows no flash modes and no
density masks, so `frame.print({ time_s })` can show a picture that the same edit, committed, does not produce.

### 16. History, looks, rolls

- **Two histories.** The shell store records transactions as patches with inverses (`packages/shell/src/core/store.ts:216-305`);
  the contract's `EditLog` records logged mutations with author, transaction, batch and status
  (`packages/contract/src/editlog.ts`). A bridge turns one into the other (`studio-kit/src/bridge/editlog-route.ts`).
- **"Look" means three things**: a CHB-021 Look (`kits/looks/src/engine/look.ts:98-113`), the unused number
  `finishing.look`, and the DSL's `h.look()` that shows an image to the agent.
- **A look edits parameters.** Its body runs once per frame and returns `set`/`add`/`mul` per recipe path; Amount
  interpolates each path from its base by a rule chosen from the arg's unit (stops, mireds, linear, steps;
  `amount.ts:15-84`). A look cannot carry mask geometry.
- **Two batch builders**: the roll kit's `buildBatch` and the looks kit's `planApply`, with different author unions.
- **One edit, four spellings**: `frame.edit({ path: v })`, `cb.looks.apply(name)`, a look body returning
  `f.print({ … })`, and a roll fragment.

### 17. The UI DSL

The studio's interface is built with `ck` (CraftKit, `packages/shell`) and `cb` (the studio, `packages/studio-kit`).
Its intermediate representation is already good: immutable nodes, passes, explain with binding-time glyphs
(`shell/ir/slots.ts:1-40`: β build, τ tracked selector, bind, θ per item, ƒ format, ρ handler). Its builders are
not yet consistent:

- **Mutable builders over immutable nodes.** `ck.shell`, modules and `ck.kit` record into a mutable definition and
  return `this`; nodes are copy-on-write. Unknown methods on both are recorded by a Proxy and resolved later.
- **One thing, several registrations.** Menus come from the command `menu:` field and from `menus()`; passes from a
  kit's `.passes()` and from instance-global `ck.install()`; panels from `ck.panel(id, opts, …)` (which also
  registers, as a side effect), from a kit's `.panels()` and from the shell's; tools from the kit, the viewport's
  `tools:` and the module's `.tools(ids)`.
- **Signatures and polarity vary.** `keys()` defaults its scope three ways; `ck.hud(opts, value)` against
  `ck.statusline(value, opts)`; commands and tools say `enabled`, nodes say `disabled`; `ck.when` and `ck.pick`
  return a node or a value depending on their argument; four different kit "products" (a Kit, a helper object, a
  function returning modules, a curried module recipe).
- **CHB-029's nine streamlining items** (host capabilities, one menu source, command tables, `cb.modules`, status
  bar, jobs, typed state, catalogue order and "Advanced", the rename variant → layout) are all still open; CHB-030
  (agent-written layouts) waits on them.

### 18. The agent's surface

The agent evaluates JavaScript in a QuickJS sandbox (`packages/dsl/src/session.ts`). Its values are good:
immutable, lazy, hash-consed handles over the same graph; options must be literals; edits are proposals with the
agent's provenance, applied in one batch per evaluation. Its reach is narrow: it edits through `frame.edit` and named
looks, and it cannot see the studio: not the layout, not the active module, not the selection, not the commands.

### 19. What the inventory says

The pieces are better than their sum. Hash-consing, the op catalogue with units, the immutable node IR with binding
times, the edit log with provenance, the darkroom's exposure law and the agent's immutable handles are each the right
idea. What hurts is that each idea is implemented once per subsystem, slightly differently. Version 2 keeps the ideas
and removes the copies.

---

## Part IV — The unified model

### 20. Five components

Everything a frame's edit contains is built from five components and held in a document.

| Component | What it is | Holds | Today's counterparts it replaces |
|---|---|---|---|
| **Op** | an entry in the op catalogue: a named operation with typed, unit-tagged arguments | name, args (ArgSpec with units), class (pointwise, spatial, …), encoding, **stages** it may live in, implementations (reference, GPU) | the catalogue (`packages/contract/src/catalog/*.ts`), extended by `encoding` and `stages` |
| **Mask** | a coverage function in 0…1 over the image | an ordered collection of components (linear, radial, ellipse, paint, luminance, colour range), each with a combine op and an amount; feather; invert | `masks` node closures, `MaskDoc`, `mask.paint` JSON strokes |
| **Layer** | one op applied in a stage | `op`, `params`, `enabled`, `amount`, `mask`, `blend`, `name`, `source` | exposures, density masks, retouch spots, dust spots, finishing values, v1's digital layers |
| **Group** | entries that act as one | a stack of entries, `enabled`, `amount`, `mask`, `blend` (`pass` or a blend mode), `name`, `source` | v1's digital groups; looks applied as a unit |
| **Stage** | one physical place in the pipeline | a **medium** (the settings of the physical process), a **stack** of layers and groups, and a **law** that combines them | the recipe's `scan`, `capture`, `print`, `view`, `retouch`, `finishing` sections |

Two further pieces complete the model: a **Link** (an entry or a medium whose content comes from a shared
definition: a roll, a look, a preset; Section 27) and a **Binding** (a parameter whose value a registered function
computes at compile time; Section 28).

A **Document** is one frame's edit: its source, its stages in pipeline order, its mask library, its geometry
(orientation, straighten, crop) and its output settings (display, proof, export). It replaces the recipe; its format
is version 3, and nothing reads versions 1 and 2 (Decision D8).

```ts
// packages/contract/src/document.ts (proposed)
type Id = string;                                    // unique within a document
interface Coll<T> { order: Id[]; items: Record<Id, T> }        // the one collection idiom (§24)

interface EntryBase {
  name: string; enabled: boolean; amount: number;    // amount: the stage law's meaning (§22)
  mask: Id | null;                                   // into Document.masks
  blend: BlendMode | 'pass';                         // only where the stage law allows blending
  source: Provenance;                    // user | agent turn | look | roll | script line
}
interface Layer extends EntryBase { kind: 'layer'; op: OpName; params: Params }
interface Group extends EntryBase { kind: 'group'; stack: Coll<Entry> }
interface LinkEntry extends EntryBase { kind: 'link'; ref: LinkRef; params: Params;
                                        overrides: Record<string, unknown> }
type Entry = Layer | Group | LinkEntry;

interface Stage<M> { medium: M | Linked<M>; stack: Coll<Entry> }

interface Document {
  format: 3; source: SourceRef;
  stages: { scan?: Stage<ScanMedium>; scene?: Stage<SceneMedium>; film?: Stage<FilmMedium>;
            darkroom: Stage<DarkroomMedium>; print: Stage<ViewMedium> };
  masks: Coll<Mask>;
  geometry: Geometry;                                // orientation, angle, crop: document units
  output: OutputSettings;                            // display knee, proof, export
}
```

Every id is unique in the document, so an entry is addressed by its id wherever it sits: moving a layer into a group
does not change how the edit log, the UI or the agent name it (pattern chapter 12, Shared Handle Vocabulary).

#### Decision D1: one stack concept, with a law per stage

- **Context:** Today six list shapes, three exposure implementations and two finishing mechanisms express "ordered,
  maybe masked edits" (Part III). Version 1 would have added a seventh.
- **Options considered:** (1) v1's additive digital stack; (2) one global layer stack across the pipeline, as a
  display-referred editor has; (3) one stack concept per stage, with the stage's physics as its combining law.
- **Decision:** (3).
- **Rationale:** A layer must mean something physical: a burn is light on the paper, a curve is a change to the
  print's tones. One global stack (2) would let a curve sit between two exposures, which has no physical meaning.
  One concept per stage keeps the physics and gives the photographer, the UI and the agent a single idea of layer,
  group, amount and mask.
- **Consequences:** Laws must be specified exactly (Section 22); every existing edit is re-expressed as layers
  (Section 23); the compiler becomes generic over laws (Section 29).
- **Status:** proposed.

### 21. The stages

| Stage | For | Input domain | Medium (settings of the process) | Law | Layers it accepts |
|---|---|---|---|---|---|
| **scan** | negative scans | camera-linear → scanner density | scanner, stock, format, rebate or base, flat field, flare | **repair**: entries replace pixels in order | heal and clone spots on the negative (dust) |
| **scene** | camera files | scene XYZ | camera profile, white balance | **composite**, scene-linear | digital adjustments before the film (v1's stage A) |
| **film** | camera files | exposure on the film → film dyes | stock, push, development, halation, grain | none yet | — |
| **darkroom** | all | film dyes → paper exposure H | paper, developer, enlarger lamp | **light**: contributions add in H, modulators multiply transmission | expose, burn, dodge, flash, density mask, filter |
| **print** | all | print-xyz (the print under the viewing lamp) | viewing illuminant, flare | **composite**, print-referred | retouch, clarity, curves, levels, HSL, grade, mixer, vignette, … |

Output (display transform, proof, export) and geometry (orientation, crop) are not stages: they do not change what
the print looks like, only how it is shown or cut. The medium of each stage holds what used to be fixed recipe
fields (`scan.*`, `capture.*`, `print.paper`, `view.*`).

Negative scans have no scene stage (an edit on scanner density acts through the film's inversion and the paper's curve, so it lands
unpredictably on the print);
camera files have no scan stage. The darkroom and the print stage exist for every frame.

### 22. The laws

A **law** says how a stage's entries combine, what `amount` and `blend` mean there, and which group kinds exist. The
same entry fields therefore mean the same *kind* of thing everywhere, expressed in each stage's physics.

**Light (darkroom).** Every entry is either a **contribution** (light that reaches the paper) or a **modulator** (a
filter in the light path). Contributions: `expose` (the main exposure through the negative; exactly one, id `main`),
`burn` (more light through the negative under a mask), `dodge` (light held back from the main exposure under a
mask), `flash` (light that does not pass the negative, `through: base | open`), and `preflash` (uniform flash
before the main exposure). Modulators: `densityMask` (an unsharp or contrast silver mask sandwiched with the
negative) and `filter` (colour or neutral filtration in the head; the printer lights and the multigrade grade are
filters). With transmissions T and contributions E, each already multiplied by its amount and mask:

```text
H(x) = T_all(x) · ( T_neg(x) · ( max(E_main − Σ E_dodge, 0) + Σ E_burn ) + Σ E_flash )
T_neg = Π 10^(−d_m) over density masks          T_all = Π 10^(−f) over filters (per channel)
```

This is today's `combinePixel` with filters added; for today's entry kinds it is the same formula, so the darkroom's
pictures do not change. **Amount** scales a contribution's time (0.5 = half the burn) and a modulator's density
(0.5 = half the filter): both are what a printer does with a card or a filter. **Groups** multiply their children's
amounts and masks (a card held over several exposures). The sum is order-free, so the darkroom's stack order only
arranges the panel; there are no blend modes and no isolated groups.

**Composite (scene, print).** Entries apply in order, bottom to top. A layer with op A, blend mode B, amount a and
coverage m maps the backdrop v to

```text
v ← v + a·m·( B(v, A(v)) − v )          computed in the op's declared encoding (linear or OkLab)
```

**Amount** is opacity. Groups are `pass` (children act on the backdrop; the group fades their total effect) or
isolated with a blend mode (children composite from transparent; the result blends as one layer), as in Part I.

**Encodings.** The composite stages need two working encodings, as version 1 found: **linear RGB** (a wide-gamut
linear space such as linear Rec. 2020 under D65) for operations that model light (exposure, multiply and screen,
blurs, clarity's low-pass, mixing by coverage), and **OkLab/OkLCh** (already used by `output.display`'s knee) for
operations defined by eye (curves, hue and saturation per band, vibrance, grading, the luminance that masks and the
luminosity and colour blend modes use). Each op declares its encoding in the catalogue; the compiler inserts the
conversions, and adjacent ops in one encoding fuse without converting back and forth. Editor lab's arithmetic on
sRGB numbers is not imported, so its preset values do not transfer and are re-tuned.

**Repair (scan).** Entries apply in order; each replaces pixels within its geometry (a heal or clone spot). Amount is
opacity, as in composite; there are no blend modes.

A law is registered like an op, with its compile function and its properties (Section 29):

```ts
defineLaw('light',     { blend: false, groups: ['pass'], amount: 'scale',   order: 'free' });
defineLaw('composite', { blend: true,  groups: ['pass', 'isolated'],
                         amount: 'opacity', order: 'stack' });
defineLaw('repair',    { blend: false, groups: ['pass'], amount: 'opacity', order: 'stack' });
```

#### Decision D2: amount means the stage's own fade

- **Context:** Today "amount" is a density-mask strength, a retouch opacity, and a look's parameter interpolation
  by unit rules (stops, mireds); v1 added layer opacity.
- **Options considered:** (1) opacity everywhere (image-space mixing); (2) parameter interpolation everywhere;
  (3) the stage law decides: light scales time and density, composite and repair mix.
- **Decision:** (3).
- **Rationale:** Mixing two darkroom prints is not something an enlarger can do; scaling a burn's time is. Mixing is
  exactly what a digital layer's opacity is. With modulators (filters), every darkroom look is an addition whose
  amount scales physically, so looks no longer need per-unit interpolation rules.
- **Consequences:** `amount.ts`'s unit rules leave the looks kit (they survive as a helper for sweeps, if wanted);
  darkroom amount 0 removes the entry's light; the UI shows "Amount" with the law's unit hint (time, density,
  opacity).
- **Status:** proposed.

### 23. Everything is a layer

The cut-off maps every edit of today onto the model. Nothing is kept beside it.

| Today | Becomes |
|---|---|
| `print.enlarger` (time, f-stop) | darkroom layer `expose`, id `main` |
| `print.lights`, `print.grade` | darkroom `filter` layers (printer lights; multigrade filtration) |
| `print.exposures[]` dodge / burn / flash / split | darkroom layers `dodge`, `burn`, `flash`; `split` is two `expose`-like contributions with filters |
| `print.preflash` | darkroom layer `preflash` (to verify: if `print.preflash` models more than added light, it stays a medium setting) |
| `print.densityMasks.*` | darkroom layers `densityMask` |
| `print.paper`, developer, `print.aim` | darkroom medium |
| `scan.dust.spots[]` | scan-stage `heal` layers (in a group "Dust") |
| `retouch.spots.*` heal / clone | print-stage `heal` / `clone` layers (in a group "Retouch") |
| `finishing.values.clarity` | print-stage layer `clarity` |
| `finishing.hues`, `finishing.look` | removed (never compiled); `hsl` and looks replace them |
| v1's `recipe.digital.print` / `.scene` | print-stage and scene-stage stacks |
| `masks` (node closures), `MaskDoc` | `masks: Coll<Mask>` (Section 25) |
| `view.frame` (orientation, angle, crop) | document `geometry` |
| `view.output.*` | document `output` |
| `scan.*`, `capture.*`, `view.reflect/flare/adapt` settings | the media of scan, film and print |
| roll `fragment` | a roll link on media and stacks (Section 27) |
| CHB-021 looks | links to registered looks (Section 27) |

A heal spot as a layer sounds expensive: forty spots would be forty spatial nodes. The composite and repair laws
therefore **coalesce runs** of adjacent entries with the same coalescible op into one node (`retouch.heal` with forty
spots), the way fusion cuts at barriers without changing the result (pattern chapter 7). The panel shows them in a
collapsible group; the engine sees one op.

**The new ops for the composite stages** (phase 8) carry no `digital.` prefix: the stage an op may live in is a
catalogue field (`stages`), not part of its name. Each needs a reference (f64) and a GPU implementation, a
conformance case and a parity test, like every op today.

| Op | Stages | Encoding | Class | Parameters (proposed) | Source of the algorithm |
|---|---|---|---|---|---|
| `curve` | scene, print | OkLab L (or per channel) | pointwise (LUT) | control points, channel | monotone cubic; **not** Editor lab's parametric curve |
| `levels` | scene, print | linear or OkLab | pointwise | black, white, gamma, output range, per channel | Editor lab `levels`, per channel |
| `exposure` | scene, print | linear | pointwise | EV, offset | Editor lab `exposure` (already linear) |
| `hsl` | scene, print | OkLCh | pointwise | per band hue, saturation, lightness; band widths | replaces the unwired `finishing.hue` |
| `vibrance` | scene, print | OkLCh | pointwise | amount | Editor lab `vibrance`, in chroma |
| `grade` | scene, print | OkLab | pointwise | shadow, midtone, highlight wheels; balance | colour grading; Editor lab P-07 approximates it |
| `mixer` | scene, print | linear | pointwise | 3 × 3 matrix, monochrome | Editor lab `bw`, generalised |
| `clarity`, `sharpen` | print | linear low-pass, OkLab L detail | spatial, radius in mm on the print | amount, radius | Editor lab `clarity`/`sharpen`; replaces `finishing.clarity` |
| `vignette` | scene, print | linear | positional | amount, size, feather | Editor lab `vignette` |
| `heal`, `clone` | scan, print | the stage's | spatial, coalescible | mode, source offset; geometry from the mask | today's `scan.heal`, `retouch.heal` |
| mask `colour` component | any | OkLab ΔE | reads an image | colour, tolerance, softness | Editor lab `color`, in ΔE instead of RGB distance |

Blending and mixing are not ops a user adds: they are what the composite law compiles each entry into.

### 24. One collection idiom, one mutation set

Every list in the document, at every depth, is a `Coll<T> = { order, items }`: stacks, groups' stacks, the mask
library, a mask's components, a paint component's strokes, probes. JSON-string list arguments disappear: an op that
takes a list takes a structured value, and canonical JSON still feeds the node hash.

Four mutations replace today's five special ones:

| Mutation | Meaning | Inverse |
|---|---|---|
| `set(path, value)` | set a field (`<id>.amount`, `darkroom.medium.paper`, `<id>.params.ev`) | `set` with the old value |
| `insert(coll, id, item, at?)` | add an item to a collection (a stack, a group, the mask library, strokes) | `remove` |
| `remove(id)` | delete an item, wherever it is | `insert` at its old place |
| `move(id, { into, at })` | reorder, or move into another collection (into a group, out of it) | `move` back |

Paths start at an id when they address an entry (`a7f3.params.points`), so they survive moves. Validation is the
op's ArgSpecs for params, the law's rules for entries (no blend in the darkroom, one `main`), and the stage's
accepted ops (catalogue `stages`).

#### Decision D3: one collection idiom

- **Context:** Arrays addressed by id, records with null deletes, plain arrays set whole, JSON strings, and a library
  that cannot delete; five special mutations.
- **Options considered:** (1) arrays with ids; (2) records with an order field per item; (3) `{ order, items }`.
- **Decision:** (3).
- **Rationale:** Stable ids for the log, the UI and the agent; cheap reordering (one `move`); one validation path;
  structurally equal documents hash equally.
- **Consequences:** Four mutations, one implementation; the UI's list views and the agent's iteration use one shape.
- **Status:** proposed.

### 25. Masks

A mask is a value in the library, referenced by id from any entry or group, in any stage.

```ts
interface Mask { name: string; components: Coll<Component>; feather: Length; invert: boolean;
                 reads: 'stage-input' | CutName }       // what image range components measure
interface Component { kind: 'linear' | 'radial' | 'ellipse' | 'paint' | 'luminance' | 'colour';
                      params: Params; combine: 'add' | 'subtract' | 'intersect'; amount: number }
```

- **One algebra.** `add` is max, `subtract` is a·(1 − b), `intersect` is a·b, `invert` is 1 − m. The product forms
  avoid creases between feathered edges (Part I, Section 7). Today's min/max `mask.and`/`mask.or` and Editor lab's
  second subtract are gone (Decision D4).
- **Geometry in document units.** Positions and sizes of geometric components are in document pixels (pixels of
  the full-resolution source); physical sizes (feather on the print, density-mask radius) are in µm on the film or
  mm on the print, as the catalogue's units say. Nothing is stored in preview pixels, so export at any size needs no
  rescaling pass (pattern chapter 9, Vector Edit Document; this removes the need for CC-018's `rescaleRecipe` and
  the fixed default µm-per-pixel of `densityMask.ts:21`).
- **What range components read.** Luminance and colour components read the input of the stage that uses the mask,
  unless `reads` names another cut; a "sky" mask built on the scene can drive a burn in the darkroom and a hue shift
  on the print, and the mask panel says which image it measures.

#### Decision D4: one mask algebra

- **Context:** min/max today, product forms needed for components, v1 kept both.
- **Decision:** max / product / product / complement, everywhere; no min/max ops.
- **Rationale:** One algebra means one gesture gives one edge; the hard cut-off removes the only reason (stored
  pictures) to keep the old forms.
- **Status:** proposed.

### 26. One history

The document log replaces both the shell store's document tier history and the contract's `EditLog`.

- A **transaction** is a list of mutations with their inverses, a label, an author (`user`, `agent`, `auto`), a
  source (look, roll, agent turn and step, script line, gesture), an optional batch id (one look over a roll), and a
  status (`applied`, `pending`, `rejected`).
- **Undo and redo** walk applied transactions; agents **propose** (pending until approved, or applied directly in
  auto mode); batches approve and reject as one.
- **Gestures** preview without logging (the store's preview tier) and commit one transaction on release. The store
  keeps its view and preview tiers; its document tier *is* the log. The store's preview type, today called `Layer`,
  is renamed `Draft` so that "layer" has one meaning.
- **One batch builder**: `plan(targets, (doc) => transaction)` serves looks, rolls, sync and the agent.

`why(path)` (today `EditLog.why`) answers "who set this, and from where" for any field, which is what the
provenance chips in the UI show.

### 27. Links: rolls, looks, presets, sync

A **link** puts shared content into a document: a roll's settings, a look, a preset, a synced edit. It is one
mechanism with one resolution step.

```ts
type LinkRef = { roll: Id } | { look: string; version: number } | { preset: Id };
type Linked<T> = { link: LinkRef; overrides: Record<string, unknown> };   // a linked medium
```

- **Rolls.** A roll holds partial media and stacks (the scanner and stock of all its scans, a shared base exposure,
  a shared dust group). Each frame's media link to the roll; per-frame changes are overrides, so "divergence from the
  roll" is the list of overrides, read directly instead of computed (today `roll.ts:1-3`).
- **Looks.** A look is a registered **look function**: `(params, facts) → Group`, versioned, pure (Section 28). A
  link entry `{ look: 'warm-print', version: 2 }` with params and an amount expands at compile time into the group it
  returns. Changing the look's params re-expands; the photographer can fade, mask or disable it like any group.
  "Bake" turns a link into the plain group it expands to, with its source recorded.
- **Presets** are looks without parameters: stored groups (and masks) that a link names.
- **Sync** across frames is a batch transaction that either copies values (independent afterwards) or inserts the
  same link (they stay together): the photographer chooses, and the UI says which.
- A look may contain entries for several stages (a darkroom filter and a print curve): its link appears once per
  stage it touches, sharing one id prefix and one Amount control.

Today's four spellings of one edit (Section 16) become two: a direct transaction, or a link.

### 28. Bindings: computed parameters

A parameter may be bound to a registered function instead of holding a value: `{ bind: 'grain.fromIso', args: {} }`.
The compiler calls the function with the frame's facts (EXIF, the source's analysis statistics, the roll) and,
optionally, a measurement of a **cut strictly upstream of the entry's stage**, so a binding can never depend on its
own output. Binding functions are registered by name and version, pure, and cached by their inputs' hashes.

Bindings cover the automatic values that today are special code: auto colour balance (`print.lights.auto`), grain
size from ISO, a scan's base density from the rebate. The **first print** stays a command (it searches exposure time
and lights against the darkroom's own output, which a binding may not read); its result is an ordinary transaction by
`auto`, as today.

### 29. One compiler

```text
compile(doc):
  1. resolve links (rolls, looks, presets) → plain media and stacks, with sources
  2. resolve bindings, stage by stage (upstream cuts are compiled and measured first)
  3. for each stage in pipeline order:
       medium ops (today's fixed chain: scan.density, film.develop, view.adapt, …)
       law.compile(stack, input)             → node ids (hash-consed, as today)
  4. output: display, frame geometry
```

- **One copy of every law.** The darkroom law compiles to one generalised `print.combine` node (contributions,
  modulators, masks), as today's single barrier; the studio's tools call the same law to show exposure seconds; the
  agent's what-if is `compile(doc ⊕ draft)` (Section 34). `printChain` and `compileExposures` are deleted.
- **Structural identities.** A disabled entry, an amount of 0 (composite) and a pass group at amount 1 without a mask
  produce no node, so toggling returns exactly to the cached graph of the stack without them. Unchanged prefixes of a
  stack are the same nodes after every edit (pattern chapter 1).
- **Cuts** are named outputs a reader can address: `scan`, `negative`, `scene`, `film`, `darkroom.H`, `print` (after
  `view.adapt`), `finished` (after the print stack), `display`. The frame vocabulary (`vocab.ts`) maps these names;
  `frame.print()` and v1's `frame.finished()` are two of them.
- **Performance** is kept by construction: composite layers whose ops are pointwise fuse into the existing pointwise
  kernel (split at `MAXOPS = 12`, `packages/gpu/src/chain/program.ts:14`); masks and spatial ops are barriers;
  coalesced runs (Section 23) are one barrier; the preview's tabulated path (pattern chapter 6) and the render slots
  (chapter 4) are untouched. Design 02's caching and residency work applies unchanged, with cuts as checkpoint
  candidates.

#### Decision D5: links for rolls, looks, presets and sync

- **Context:** Roll fragments copied into recipes; looks that resolve to parameter edits; presets as files of edits;
  two batch builders.
- **Decision:** one link mechanism, resolved first in compile; looks become look functions returning groups.
- **Rationale:** Shared content stays shared (a roll change reaches every frame that has not overridden it); a look
  stays one removable, fadeable, maskable unit; divergence is explicit.
- **Consequences:** Look functions are compile-time lambdas (Section 31); the looks kit's `amount.ts` rules and its
  parameter edits go; `bake` is the explicit way to detach.
- **Status:** proposed.

---

## Part V — The builder core and the workbench

### 30. The goal: composable fluent builders around a few components

The second half of the unification is the API. The photographer never sees it, but everything he sees is built with
it: the layouts that arrange his studio, the panels that show his layers, the looks he applies, the scripts and the
agent that edit for him. If the API has one shape, the application can be rearranged freely and still behave as one
thing. The goal, in one sentence: **a core of composable fluent builder APIs, modular around a small set of core
components, each customisable by lambdas at build time or at runtime.**

The core components of the API are the editing components of Part IV plus the UI's own:

| Area | Components |
|---|---|
| editing | Op, Mask, Layer, Group, Link, Stage, Document, Transaction |
| reading | Cut (a named point in the compiled graph), Handle (a lazy image or value at a cut) |
| interface | Node (panel, row, control, viewer…), Module, Layout, Kit, Command, Tool, Pass |

Every component is built the same way:

1. **A builder returns an immutable value.** `layer.curve({ … })` is a Layer value; `.amount(0.8)` returns a new
   Layer; nothing is mutated, ever (today's `ShellBuilder` and `KitBuilder` record into mutable definitions; they
   become value builders like `ck` nodes already are).
2. **Every chain method is a modifier.** A **modifier** is a function from a value to a value of the same kind.
   `x.amount(0.8)` is shorthand for `x.with(amount(0.8))`. Modifiers are values too: they compose (`m1.then(m2)`),
   can be named, passed around, and applied to many components.
3. **Every value explains itself.** `explain()` gives its structure, where it was built (`file:line`, as `ck` nodes
   record today), its binding times, and, for editing values, the node ids it compiles to.
4. **Every value is data where it must be stored.** Editing values serialise into the document (Part IV); they never
   contain functions (Section 31). Interface values are code (a layout is a program) but name their stored or
   cross-boundary lambdas.

```js
// modifiers are values: build once, apply anywhere
const soft   = amount(0.6).then(maskWith('sky'));
const warmUp = (k) => group('Warm', layer.filter({ y: 0.04 * k })).with(soft);

doc.stage('darkroom').push(warmUp(1));                 // a transaction value
doc.stage('print').push(layer.grade({ shadows: [210, 0.08] }).with(soft));

// the same style builds the interface
const compact = (p) => p.with({ density: 'compact' });
const right   = ck.dock.column({ width: 300 }, stack.params().with(compact), stack.masks());
```

The patterns behind this are in the pattern language: values hash-consed into a graph (chapter 1), unit-tagged
arguments from one catalogue (chapter 2), a document of vectors in document units (chapter 9), two vocabularies for
layouts (chapter 10), kits with policy passes (chapter 11) and one handle vocabulary (chapter 12).

### 31. Binding times: when a lambda may run

Lambdas make builders powerful; they also make values opaque, unserialisable and slow if they run in the wrong place.
The core therefore fixes **four binding times**, extends the glyphs the UI IR already shows (`shell/ir/slots.ts`),
and says for each what a lambda may read and whether it can be stored.

| Time | Glyph | Runs | Examples | May read | Stored in the document? |
|---|---|---|---|---|---|
| **build** | β | once, while a value is built (a layout, a kit, a look's group, a script) | `ck.each`, `.with(fn)`, a modifier, `when` with a boolean, a layout's `build(ck, cb)` | build options, the catalogue | no: the value it produces is |
| **compile** | κ | per frame, while the document compiles | look functions, binding functions, law compile functions | the document, frame facts, upstream cuts | by name, version and arguments only |
| **interaction** | τ θ ƒ ρ, bind | on state change, per item, on a gesture or a command | selectors, per-row renderers, formatters, handlers, tool gestures | state (through typed selectors), the gesture | never (they live in layouts and kits) |
| **pixel** | — | per pixel, in the engines | — none — | — | — |

Four rules follow.

1. **No lambda enters the document.** A document is JSON, portable between machines and engines (pattern chapter 9).
   Where a stored value needs computation, it names a registered function (a look, a binding) with a version.
2. **Compile-time functions are registered, pure and deterministic.** They are keyed by name and version, cached by
   the hash of their inputs, and run in the host (built-in looks and bindings) or in the QuickJS sandbox (looks
   written as `*.cblook.js` by the photographer or the agent). Their output is ordinary entries with their source.
3. **Interaction lambdas read state through typed selectors and write through commands or transactions.** CHB-029's
   typed state and `cb.sel.*` become the only way to read; a handler that changes the document builds a transaction.
4. **There are no per-pixel lambdas.** Every per-pixel computation is a catalogue op with a reference (f64) and a GPU
   implementation, checked for parity. Editor lab's `code` layers stay out; a new effect is a new op.

The split also decides what an agent-written layout (CHB-030) can contain: build-time code runs in the sandbox,
interaction lambdas must be registered selectors and command ids (or path expressions), so the layout that comes out
is a portable value the host can mount.

#### Decision D6: four binding times, no stored code

- **Context:** Lambdas appear today at build (kits, layouts), resolve (look bodies), interaction (selectors,
  handlers) and are refused as DSL options; Editor lab stored per-pixel code.
- **Decision:** build, compile, interaction; none at pixel time; stored lambdas only by registered name and version.
- **Rationale:** Values stay data where they are stored and code where they are run; caches stay correct; both
  engines stay in parity; the agent's sandbox boundary is crossed only by data and names.
- **Status:** proposed.

### 32. The UI DSL, made consistent

The studio's UI DSL keeps its two vocabularies (`ck` for the shell, `cb` for the studio) and its immutable node IR.
The builders around them change to the rules of Section 30, and CHB-029's open items are folded in:

| Rule | Replaces (Part III, Section 17) |
|---|---|
| Shell, module, kit, panel and command-table builders return immutable values | mutable `ShellBuilder`, `ModuleBuilder`, `KitBuilder` |
| Unknown chain methods are build errors with "did you mean"; fragments are registered explicitly (`ck.extend`) | Proxy-recorded pending calls |
| One registration per kind: kits declare panels, tools, commands, menus and passes; layouts place them by id | menus in two places, passes via `ck.install`, panels three ways, tools three ways |
| `panel(id)` is always a reference; `ck.panel.define(…)` defines | `ck.panel` as ref or define by arity |
| Containers take `(props?, ...children)`, leaves `(value, props?)`, controls take one props object | `hud(opts, value)` vs `statusline(value, opts)`, positional `slider(min, max, opts)` |
| `enabled` and `why` everywhere | `enabled` on commands, `disabled` on nodes |
| `ck.when(cond, a, b)` is always an interaction node; build-time choice is plain JavaScript or `.with(when(bool, m))` | `when`/`pick` changing kind by argument type |
| Scopes follow where a thing is declared (shell → global, module → module, kit → kit) | three defaults for `keys()` |
| Typed state per kit, read through `cb.sel.*` | `(s: any)` selectors, duplicated `current` |
| Every kit exposes the same product: `kit.panels.*`, `kit.modules.*`, `kit.tools`, `kit.commands`, `kit.docs` | four product shapes |
| Host capabilities typed at mount; commands declare `requires` | `hostHas`/`hostRun` |
| "variant" is called "layout" everywhere | the rename (CHB-029 item 9) |

### 33. One stack kit for every stage

The edit kit of version 1 and the finish kit's panels become one **stack kit**, generic over stages, built from
the stage's law and the catalogue:

```js
const stack = cb.kits.stack;                 // panels, tools, commands for any stage
stack.layers('print')                        // the stack: rows, groups, drag into groups,
                                             // amount, blend (if the law allows), mask chip
stack.params()                               // the selected entry's controls, from the catalogue
stack.masks()                         // the selected entry's mask: components, algebra, reads
stack.add('print', { ops: ['curve', 'levels', 'hsl', 'grade'] })   // the "+ Layer" menu
```

Specialised views are the same kit with lambdas at the right times:

```js
// the darkroom's Enlarger panel: the main exposure and the filters as rows (θ per item)
const enlarger = stack.layers('darkroom', {
  title: 'Enlarger',
  row: (entry) => entry.op === 'expose' ? enlargerRow(entry) : stack.row(entry),   // θ
  order: 'kind',                         // the light law is order-free: group rows by kind
});

// the finish view: retouch tools produce heal layers in the print stage
const finish = stack.layers('print', { filter: sel.ops(['heal', 'clone', 'clarity']) });
```

One **stage policy pass** replaces CB-F101 and v1's CB-E101: a module declares the stages it shows
(`m.stages('darkroom')`), every control knows its op's stages from the catalogue, and the pass warns when a module
shows a stage it does not declare. No string prefixes, no per-kit copies; a layout that mixes stages on purpose
declares both, which documents the choice (arrangement 2 below declares
`m.stages('darkroom', 'print')` and labels the zones).

Workspaces stay programs, and each arrangement is a few lines with these pieces:

```js
// 1. Classic plus an Edit module: Library, Darkroom, Edit, Finish as separate screens
const edit = ck.module('edit', { label: 'Edit', key: 'E', stages: ['print'] })
  .left(ck.dock.column({ width: 260 }, stack.layers('print'), cb.panel('history')))
  .center(cb.viewer({ cut: 'finished', tools: stack.maskTools }))
  .right(ck.dock.column({ width: 300 }, stack.params(), stack.masks()));

// 2. The darkroom with a digital palette: one screen, two labelled zones
const darkroom = ck.module('darkroom',
    { label: 'Darkroom', key: 'D', stages: ['darkroom', 'print'] })
  .center(cb.viewer({ cut: 'finished', tools: [...enlarger.tools, ...stack.maskTools] }))
  .right(ck.dock.column({ width: 300 },
    enlarger,
    ck.panel.define('digital', { title: 'Digital (after the print)', collapsed: true },
      stack.layers('print', { density: 'compact' }))));

// 3. Camera files: scene edits before the film, in their own module
const scene = ck.module('scene', { label: 'Scene', key: 'Mod+Alt+S', stages: ['scene'] })
  .center(cb.viewer({ cut: 'scene' }))
  .right(ck.dock.column({ width: 300 }, stack.layers('scene'), stack.params()));
```

Arrangement 2 is the one to test first with the photographer persona: one screen, which he liked in the darkroom
layout, with the digital zone labelled as acting after the print. Any arrangement he or the agent invents is built
the same way. Cohesion comes from the components, not from a fixed layout: every arrangement shows the same stack
rows, the same amount control, the same mask chip and the same provenance.

### 34. The workbench for an agent with only `eval`

The agent evaluates JavaScript in the QuickJS sandbox. With version 2 it reaches the whole workbench through two
principles:

- **Anything a person can do is a command or a transaction.** Menus, keys, buttons and tool gestures end in a
  command (with typed arguments) or a document transaction; the agent runs the same commands and builds the same
  transactions with the same builders.
- **Anything a person can see is a value or a handle.** Documents, stacks, masks, cuts, the layout, the mounted
  screen with its live values, the selection, the history: each is a value with `explain()`, or an image handle the
  agent can measure or show.

```js
// in the agent's sandbox
const d = doc('frame-0412');                       // the document: stages, masks, geometry
d.stage('darkroom').explain();                     // entries, law, amounts, compiled node ids

const sky = mask.linear({ from: [2000, 0], to: [2000, 1700] })     // document pixels
  .intersect(mask.luminance({ above: 0.5, softness: 0.1 })).named('sky');
const tx = d.masks.insert(sky)
  .then(d.stage('darkroom').push(layer.burn({ stops: 0.5 }).mask('sky')))
  .then(d.stage('print').push(group('Sky', layer.hsl({ blue: { sat: -0.15 } })).mask('sky')));

await d.with(tx).cut('finished').stats();          // what-if: the one compiler, on a draft
tx.propose({ why: 'the sky prints 0.4 D denser than the foreground' });

wb.commands();                                     // every command: id, args, keys, enabled/why
wb.screen().explain();                             // the mounted layout with live values
wb.run('module.open', { id: 'print' });           // the same command a key press runs
```

The workbench surface (`wb`) is thin because the UI is a client of the same core: `wb.commands()` lists the command
table, `wb.run` runs a command, `wb.state(sel)` reads through a typed selector, `wb.screen()` is the runtime's
explain with live values (`Runtime.explain({ live })` exists today), `wb.layouts.build(src)` builds a layout value in
the sandbox and checks it with the passes (CHB-030), and `wb.layouts.use(layout)` proposes it. Two tests keep the
surface complete: every command reachable from a key, a menu or a button is in `wb.commands()`; every control in
every built layout maps to a document path or a command.

The vocabulary is cleaned on the way: the DSL's image display `h.look()` becomes `h.show()`, so "look" means one
thing; `frame.edit` becomes the transaction builders above; named looks become links.

#### Decision D7: immutable builders and an eval-complete workbench

- **Context:** Mutable builders beside immutable nodes; an agent that can edit a frame but cannot see or drive the
  studio.
- **Decision:** every builder returns an immutable value with `with`, `then` and `explain`; every user action is a
  command or a transaction; every visible thing is a value or a handle reachable from the sandbox.
- **Rationale:** One shape makes layouts recombinable and the agent's scripts look like the studio's own code; the
  agent needs no tool besides `eval`.
- **Consequences:** CHB-029's items become part of phase 4; CHB-030 becomes straightforward (layouts are values);
  tests check that the command table and the agent surface agree.
- **Status:** proposed.

---

## Part VI — Plan

### 35. The hard cut-off

#### Decision D8: a new format and no compatibility path

- **Context:** The owner decided (2026-11-14) that there are no backwards-compatibility needs: "we can do hard
  cutoff, now is the time to strive for elegance and consistency".
- **Options considered:** (1) migrations from recipe v2 to document v3; (2) a reader that wraps old recipes; (3) a
  new format, old files refused with a clear message.
- **Decision:** (3). Contract 1.0; document format 3; the recipe types, the five special mutations, `printChain`,
  `compileExposures`, the `finishing` fields, the roll fragment, the CHB-021 look body and its Amount rules are
  deleted, not deprecated.
- **Rationale:** Every compatibility path is a second implementation to keep in parity; this design exists to remove
  second implementations.
- **Consequences:** Test fixtures are rewritten as documents; stored studio state (the library's recipes) is cleared
  once, with the photographer's frames re-opened from their sources; one change note (CC-NNN, class breaking)
  records the cut. The correctness of the darkroom is protected by golden pictures made before anything is deleted
  (phase 0).
- **Status:** proposed.

### 36. Phases

| Phase | Content | Done when |
|---|---|---|
| 0 | **Golden pictures.** Render the synthetic fixture set and the conformance cases through today's compiler on the reference engine at the cuts `print` and `display`; store them with their recipes. (The photographer's own frames stay local and are never committed.) | goldens committed; a script re-renders them |
| 1 | **Builder core.** Immutable values, modifiers (`with`, `then`), `explain`, provenance; `Coll` and the four mutations with inverses; transactions | property tests (Section 37) |
| 2 | **Contract 1.0.** Document format 3; Op catalogue with `stages` and `encoding`; Mask, Layer, Group, Link, Stage; the laws light, composite and repair; mask algebra; link and binding resolution; one compiler with cuts; delete the recipe path | reference engine reproduces the goldens for documents equivalent to the old recipes |
| 3 | **GPU.** Generalised `print.combine` with modulators; composite mix and blend in the pointwise kernel; coalesced heal; encodings (linear ↔ OkLab) | parity on SwiftShader and on Metal (`REAL_GPU=1`) |
| 4 | **One history.** The document log replaces `EditLog` and the store's document tier; `Draft` rename; one batch builder | undo, redo, proposals, batches tested; studio specs green |
| 5 | **UI DSL.** Immutable builders and the rules of Section 32 (CHB-029 folded in); the stack kit; the stage policy pass; layouts rewritten (classic, darkroom, finish, lab) | explain snapshots per layout; browser specs |
| 6 | **Agent workbench.** Transaction builders and `wb` in the DSL; `h.show`; generated reference regenerated | surface tests (every command, every control); agent examples rewritten |
| 7 | **Links.** Look functions (built-ins rewritten as groups), `*.cblook.js` in the sandbox, roll links and overrides, sync as copy or link, bake | looks and roll specs; one-step undo of a look over a roll |
| 8 | **The digital op set.** curve, levels, exposure, hsl, vibrance, grade, mixer, vignette, clarity and sharpen in µm, colour-range masks; the scene stage for camera files | parity per op; golden stacks |
| 9 | **Persona sessions** (CHB-026 protocol) on the arrangements of Section 33 | the default arrangement chosen with the owner |
| 10 | **Selections** (marquee, lasso, wand) as mask components, in their own kit | only if the photographer asks |

Phases 1 and 5 can start in parallel (the builder core is shared, the UI rules need no new contract). Phase 2 is the
long pole; phase 3 follows it; 6 and 7 need 2 and 4. Phases 0–7 deliver the unified studio with today's features; 8
brings the new digital tools on top.

### 37. Testing

- **Golden pictures** (phase 0) are the oracle for the cut-off: the light law must reproduce today's darkroom.
- **Law properties:** for random stacks of today's darkroom kinds, the light law equals `combinePixel`; in composite,
  amount 0 and disabled entries produce no node; a pass group at amount 1 without a mask produces no node; isolated
  and pass agree when every child is a normal-blend layer; coalescing a run of heals does not change a pixel.
- **Mask algebra:** `add` is idempotent; intersecting with full coverage is the identity; `subtract` is a·(1 − b);
  `invert` is an involution; a mask in document pixels evaluated at scale s equals the full-scale mask resampled.
- **Collections and history:** for random mutation sequences, applying a transaction and then its inverse restores
  the document exactly; ids survive `move`.
- **Links and bindings:** resolving a baked link equals resolving the link; a binding that reads its own stage or a
  later one is a compile error; binding results are deterministic.
- **One compiler:** the agent's what-if (`doc.with(tx)`) yields the same node ids as committing `tx` and compiling.
- **Builders:** no builder method mutates its receiver (a frozen-value property test); `then` is associative;
  `explain` snapshots per layout.
- **Workbench:** every command reachable from a key, menu or button is in `wb.commands()`; every control maps to a
  document path or a command; the stage policy pass fires on the cases it should.
- **Engines:** a conformance case and a parity test per op, as today.

### 38. Risks and open questions

- **Size.** The cut-off touches the contract, both engines, the studio kit, the shell, the DSL and the looks. The
  goldens, the phase order and the property tests are the safety net; the work happens on one branch and lands when
  phases 0–7 are green.
- **The darkroom must still feel like an enlarger.** The stack is the model, not the view: the Enlarger panel stays
  an enlarger (time, f-stop, filtration, test strips), built as a specialised stack view (Section 33).
- **Preflash and split exposures** must be checked against today's ops in phase 2 (Section 23); if `print.preflash`
  models more than added light, it stays a medium setting.
- **Compile-time cost.** Link resolution and binding functions run on every compile; they are cached by input hash,
  and look functions in QuickJS are measured in phase 7.
- **Open, for the owner:**
  1. the default arrangement (one screen with a digital palette, or separate modules), to be settled in a persona
     session;
  2. whether the scene stage for camera files is wanted;
  3. whether selections are wanted;
  4. whether "sync" defaults to copying values or to linking;
  5. whether the darkroom's stack shows the photographer's order or groups by kind (the law does not care).

---

## Glossary

| Term | Meaning here |
|---|---|
| **adjustment layer** | a layer that applies a function to its backdrop and mixes the result by its coverage; holds parameters, not pixels |
| **alpha / coverage** | how much of a pixel a layer covers, 0…1 |
| **amount** | an entry's fade, with the meaning its stage's law gives it: time or density in the darkroom, opacity elsewhere |
| **apron / halo** | the extra pixels around a tile that a neighbourhood op must read |
| **backdrop** | the image a layer is applied to: the composite of everything below it |
| **binding** | a parameter whose value a registered function computes at compile time |
| **binding time** | when a lambda runs: build (β), compile (κ), interaction (τ θ ƒ ρ), never per pixel |
| **blend mode** | a function B(backdrop, source) that combines colours before mixing by coverage |
| **collection** | `{ order, items }`, the one list shape of the document |
| **component (mask)** | one simple coverage function (linear, radial, ellipse, paint, luminance, colour) in a mask |
| **contribution** | a darkroom entry that adds (or, for a dodge, withholds) light on the paper |
| **cut** | a named point in the compiled graph (`negative`, `darkroom.H`, `print`, `finished`, `display`) |
| **document** | one frame's edit: source, stages, masks, geometry, output; replaces the recipe (format 3) |
| **domain** | the physical meaning and units of an image between two ops (scanner density, film dyes, print-xyz, …) |
| **draft** | an uncommitted state for a gesture's preview (the shell store's former `Layer`) |
| **entry** | a layer, a group or a link in a stack |
| **group, pass-through** | a group whose children act on the real backdrop; the group fades their total effect |
| **group, isolated** | a group whose children are composited on transparent and blended as one layer |
| **hash-consing** | building graph nodes so that equal (op, inputs, arguments) give the same node and id |
| **kit** | a bundle of panels, tools, commands, menus, passes, state and docs for one domain |
| **law** | how a stage combines its entries: light, composite or repair |
| **layout** | a program in the UI DSL that arranges modules and panels into the studio's screens (formerly "variant") |
| **link** | shared content in a document (a roll, a look, a preset), resolved at compile time, with per-frame overrides |
| **look function** | a registered, versioned, pure function from parameters and frame facts to a group |
| **mask** | a coverage function in 0…1 that confines an entry; a value in the document's mask library |
| **medium** | a stage's process settings (paper and developer, film stock, scanner, viewing lamp) |
| **modifier** | a function from a value to a value of the same kind; every chain method is one |
| **modulator** | a darkroom entry that filters the light (density mask, colour or neutral filter) |
| **module** | one screen of a layout, with regions, and the stages it declares |
| **neighbourhood op** | an op that reads pixels around each output pixel (blur, clarity); has a reach |
| **OkLab / OkLCh** | a perceptual colour space (lightness, a, b) and its polar form (lightness, chroma, hue) |
| **over** | the operator that puts a source over a backdrop by its coverage |
| **pass (layout pass)** | a check that runs over a built layout and warns or errors (the stage policy pass) |
| **pointwise op** | an op whose output pixel depends only on the same input pixel |
| **print-xyz** | the domain after `view.adapt`: light reflected from the print under the viewing lamp, CIE XYZ |
| **provenance** | what made an entry or a change: the user, an agent turn, a look, a roll, a script line |
| **stage** | one physical place in the pipeline (scan, scene, film, darkroom, print): a medium, a stack and a law |
| **stack** | a stage's ordered collection of entries |
| **transaction** | a list of mutations with inverses, author, source, batch and status: one undo step |
| **workbench** | the studio as the agent sees it: commands, state, layouts, documents, all reachable from `eval` |

## References

- Chromobench today: `packages/contract/src/graph.ts:252-316` (compile); `packages/contract/src/recipe.ts:169-197`
  (recipe), `:243-335` (`RECIPE_FIELDS`); `packages/contract/src/mutations.ts:9-14`; `packages/contract/src/editlog.ts`;
  `packages/contract/src/vocab.ts` (cuts and the frame vocabulary); `packages/core/src/print/exposures.ts:32-47`
  (`combinePixel`), `:84-121`; `packages/dsl/src/host/print.ts:28-80` (`printChain`); `packages/dsl/src/session.ts`;
  `packages/shell/src/build/{ck,shell-builder,kits,recorders}.ts`; `packages/shell/src/ir/{node,slots}.ts`;
  `packages/shell/src/core/store.ts`; `packages/studio-kit/src/cb.ts`; `packages/studio-kit/kits/{finish,looks,roll}/`;
  `packages/gpu/src/engine/defs.ts:8-21`; `packages/gpu/src/chain/program.ts` (`MAXOPS`).
- Plans: `ttmp/2026/11/12/CHB-029--…/design-doc/01-plan.md` (UI DSL streamlining), CHB-030 (agent-written layouts),
  companion `02-editor-lab-performance-architecture.md`.
- Pattern language (`docs/patterns/`, branch `task/pattern-language`): chapters 1 (Interned Operation Graph),
  2 (Unit-Tagged Parameter Catalogue), 4 (Latest-Wins Render Slots), 6 (Tabulated Preview, Exact Export),
  7 (Barrier-Cut Fusion), 9 (Vector Edit Document), 10 (Two-Vocabulary Layout DSL), 11 (Kits with Policy Passes),
  12 (Shared Handle Vocabulary).
- Editor lab (`editor-lab/`): `src/engine.js` (layers 345–353, blend 139–184, masks 356–397 and 556–603, stack
  440–467, applyLayer 607–648, applyGroup 671–682); `src/workspace.js` (history 35–44, restructure 133–142, masks
  266–333, selections 336–394); `src/views/{stage,panels,presets,agent,code}.js`; book chapters 01–04 and 09.4;
  `REPORT.pdf`; `earlier-work/editor-grammar-examples/editor-grammar-examples.mjs`.
- Prior art for one uniform entry concept: darktable (every processing module offers the same blending, opacity,
  drawn and parametric masks, and multiple instances in a reorderable pipeline); Nuke (every node has a mask input
  and a mix control); Photoshop (adjustment layers, pass-through groups, smart filters with their own mask and
  blending); Lightroom Classic and Capture One (local adjustments as masked sets of the global controls).
- Prior art for builders and binding times: Jetpack Compose (`Modifier` chains as composable values; state read in a
  `graphicsLayer { }` lambda is deferred to the draw phase, a binding-time choice); SwiftUI view modifiers; Halide
  (the algorithm separated from its schedule); Kotlin type-safe builders.
