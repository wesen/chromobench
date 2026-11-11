---
Title: 'Intern guide: finish and retouch (crop, straighten, heal, clone, finishing tones)'
Ticket: CHB-022
Status: active
Topics:
    - ui
    - image-pipeline
    - product
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://apps/studio/src/core/gesture.ts
      Note: GestureController preview/commit pattern
    - Path: repo://apps/studio/src/core/tools.ts
      Note: maskSpec adapter for local masks
    - Path: repo://packages/contract/src/catalog/measure-darkroom-finishing.ts
      Note: finishing.* ops on print-xyz
    - Path: repo://packages/contract/src/catalog/view-output-mask.ts
      Note: output.frame (orientation, crop), output.display knee, mask ops
    - Path: repo://packages/contract/src/mutations.ts
      Note: closed mutation set the tools write through
    - Path: repo://packages/contract/src/recipe.ts
      Note: scan.crop, scan.dust, masks, finishing fields
    - Path: repo://packages/ingest/src/conditioning/dust/heal.ts
      Note: harmonic seam correction and patch search to reuse
    - Path: repo://ttmp/2026/11/11/CHB-016--craftkit-studio-study-ui-toolkit-and-js-dsl-for-a-lightroom-class-studio/sources/craftkit-studio/src/app/develop-tools.js
      Note: crop, heal and mask tool pattern
ExternalSources: []
Summary: 'Implementation guide for the finish kit (cb.finish.*): crop and straighten, spot heal and clone, finishing tones, as viewport tools writing vector specs into the recipe.'
LastUpdated: 2026-11-11T15:10:21.303565964-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: finish and retouch

## 1. Purpose and scope

The photographer has scanned a negative, printed it through the film and paper model, and burned and dodged it. The
picture is nearly done. What is left is what happens after the print: tilt the horizon level, cut the picture to a
shape, remove the white specks that no scan cleaning found, and nudge the tones a little. This ticket builds that
last part of the studio as the **finish kit**: a bundle of tools, panels, commands, overlays and recipe passes
installed with `.use(finishKit)` and reachable from the builder as `cb.finish.*`.

Three groups of features:

1. **Crop and straighten.** One viewport tool (key `R`, as in CraftKit) with aspect presets, a rule-of-thirds grid,
   and rotation by dragging outside the crop frame. Orientation (rotate 90, flip) is a button and a command.
2. **Spot removal: heal and clone.** One viewport tool (key `Q`) that places circular spots. A spot copies from a
   source circle elsewhere in the picture (clone) or copies and then matches the surroundings (heal).
3. **Finishing tones.** A short panel for the few tone and colour controls that are *not* darkroom controls
   (`finishing.*` ops in the contract): shadows, highlights, clarity, hue families, and an overall Look amount.
   They are labelled as finishing everywhere they appear, because a darkroom could not do them this way, and the
   studio's promise is that the Print module is physical.

What this ticket does not do. It does not own the physical print (CHB-010), dust detection on the scan (CHB-006),
output colour management and export (CHB-011), or looks and presets (CHB-021); it uses them. It does not build
layers. Section 13 sketches how a layer stack could fit later, without committing.

**The rule that shapes everything: the recipe stores vectors, never pixels.** A crop is a rectangle and an angle. A
spot is a position, a radius and a source position. A local tone mask is a `MaskSpec`. Everything is in sensor
pixels (DR-3, DR-7), so the same recipe renders at thumbnail size, on screen, and in a 100 MP export, and rotating
or cropping never moves a spot.

**The other rule: the whole UI is JS.** Every tool, panel and command in this guide is a builder call a variant can
use, rearrange or omit, and every edit the UI makes is also an edit the agent can propose (section 9).

### Who should read what

An implementer of the tools reads sections 4, 5, 6 and 11. Someone touching the engine reads 3, 7 and 8. Someone
writing a variant reads 9. Everyone reads the traced flow (section 10).

## 2. Background you need

### 2.1 The pipeline and its domains

The contract's op graph moves an image through *domains*: `film-dyes` → `printing-density` → `paper-dyes` →
`print-xyz` → `display-rgb`. Each op declares `domainIn` and `domainOut`; the registry checks them. The pieces that
matter here (all in `packages/contract/src/catalog/`):

```text
scan.heal        scanner-density -> scanner-density   dust heal on the scan (CHB-006)         source-scan-invert.ts
... film, print physics ...
view.reflect     paper-dyes -> print-xyz
view.flare       print-xyz  -> print-xyz
view.adapt       print-xyz  -> print-xyz
finishing.*      print-xyz  -> print-xyz   clarity, hue (CHB-015)                                measure-darkroom-finishing.ts
output.display   print-xyz  -> display-rgb  gamut knee, ALWAYS the last colour step            view-output-mask.ts
output.frame     display-rgb -> display-rgb orientation and crop, applied last (class geometric) view-output-mask.ts
output.encode    display-rgb -> file
```

CHB-011 fixed one rule that we keep: **no op consumes `display-rgb` except `output.encode` and measurements.**
Finishing ops therefore sit on `print-xyz`, before the knee. `output.frame` is the one geometric op after the knee;
it only moves pixels, so it cannot violate the rule in spirit, but today it declares `display-rgb` in and out and
sits last.

### 2.2 What the recipe already has

From `packages/contract/src/recipe.ts`:

| recipe field | meaning | state |
|---|---|---|
| `scan.orientation` | one of eight orientations | exists, op `output.frame` reads it |
| `scan.crop` | `Box` in sensor px, or null | exists, axis-aligned, no angle |
| `scan.dust.spots` | `[{id, x, y, r}]` in sensor px, plus `method`, `marginPx` | exists, healed in density |
| `masks` | `Record<id, MaskSpec>`, a MaskSpec is `{version: 1, nodes: NodeDef[]}` | exists (CHB-009, CHB-010) |
| `finishing.look`, `finishing.values`, `finishing.hues` | master amount, numbers by name, hue triples | exists (CHB-015) |

Two gaps matter. `crop` and `orientation` live under `scan`, which only negative-scan frames have, so a digital RAW
frame (CHB-012) has nowhere to be cropped. And there is no angle, so there is no straightening. Both are contract
requests (section 3.1).

### 2.3 What the mutations allow

`packages/contract/src/mutations.ts` has a closed set: `set` (with an `expect` value for staleness), `exposure.add`,
`exposure.remove`, `mask.set`, `frame.add`. Everything a tool does is one or more of these, applied through the
frame's EditLog. The GestureController in `apps/studio/src/core/gesture.ts` already implements the shape CraftKit's
tools need: `drag` previews a `set` without logging, release applies it as one undo unit, `Esc` cancels. The shell
port (CHB-018) wraps this as `ctx.preview(path, value)` and `ctx.commit(label)`.

### 2.4 What CraftKit shows us

`CHB-016/sources/craftkit-studio/src/app/develop-tools.js` (392 lines) is the pattern to port, tool by tool:

- **Crop** (lines 56 to 150). A tool with `enter`, `hover`, `down`, `drag`, `up`, `escape` and an `overlay`. `down`
  hit-tests the frame to choose a *mode*: `move`, one of eight resize handles, or `rotate` (outside the frame).
  `drag` computes a new geometry; with aspect lock it calls `fitAspect`. `up` calls `ctx.commit('Straighten')` or
  `ctx.commit('Crop Rectangle')`. A straightened crop must stay inside the picture: `constrainCrop` (in
  `develop-model.js`, lines 68 to 79) bisects a scale factor until `cropFits` holds, and a move that would leave
  the picture stops at the edge. The options panel has an aspect select, a lock button, an angle slider, and
  swap, reset and done commands.
- **Spot removal** (153 to 217). Modes heal, clone, remove, fill. A click makes a spot `{mode, points, size,
  feather, opacity, source_offset}`; hover draws the brush circle. Delete and Clear All are commands that are
  disabled with a reason ("Click a spot to select it").
- **Masks** (225 to 392). Brush, linear and radial gradient tools write a `masks` array; a Masks panel lists them
  with per-mask adjustment sliders (exposure, shadows, clarity, and so on); the red overlay is drawn from the shape
  vectors, not from pixels.

CraftKit normalises coordinates to 0 to 1 and puts the angle in `dev.crop.geometry`. We keep the behaviour and
change the units: sensor pixels in the recipe, a conversion helper at the tool boundary.

## 3. Where each thing lives in the pipeline

### 3.1 Crop, straighten, orientation: the frame stage

`output.frame` already says "Orientation and crop, applied last". We extend it. Proposed contract 0.2 change
(requested through CHB-017; this guide does not edit the contract):

```ts
// view.frame replaces scan.orientation / scan.crop, and exists for both frame kinds
interface FrameSettings {
  orientation: Orientation;      // as today
  angle_deg: number;             // -45..45, positive = clockwise; 0 = none
  crop: Box | null;              // sensor px, in the oriented, rotated canvas; null = whole canvas
}
```

The order is fixed and written into the op's doc: **orient, then rotate by `angle_deg` about the centre of the
oriented picture, then crop.** The canvas after rotation has the same size as the oriented source; its corners are
empty. `crop` is a box on that canvas, in pixels. Pixel units keep DR-3 ("all coordinates are source pixels"):
the box is in source pixels of the canvas, not in output pixels, and the export size is chosen separately.

A crop is *valid* only if every corner of the box lies inside the rotated picture. That is not a style preference:
outside it there is nothing to show. The contract's `E_ARG_*` validation gets a custom check (the same geometry as
CraftKit's `cropFits`), and the studio's tool applies it while dragging (section 5.3). A recipe with an invalid crop
fails `assertRecipe` with a message that includes the largest valid box, computed from the receiver.

Why orientation, rotation and crop are one op and not three: the engine resamples once. Rotating then cropping as
separate ops would sample twice and soften the picture. `output.frame` is class `geometric`, which already tells
CHB-005's tile planner that output pixels map to source pixels through a transform; rotation adds a bilinear or
Lanczos-3 kernel with a halo of two to three pixels, which the planner's apron handles like any spatial op.

Open question for CHB-017: should `view.frame` sit before or after `output.display`? Today it is after (on
`display-rgb`). Putting it on `print-xyz` before the knee would let a straightened picture's empty corners never
pass through the knee. Recommendation: keep it last, resample in the output space, since the corners are cropped
away anyway (valid crops never contain them).

### 3.2 Heal and clone: the retouch stage, in print space

Two different jobs get called "dust removal", and the studio keeps them apart.

| | Dust heal on the scan (CHB-006) | Retouch heal and clone (this ticket) |
|---|---|---|
| Domain | `scanner-density` | `print-xyz` (the print as seen) |
| What it fixes | dust and scratches *on the negative* | anything visible in the print: a leftover speck, a scratch, a lamp post |
| Why that domain | dust is an additive, neutral density bump in all three channels (`-log10(1 - a)`), so it can be detected and removed *without disturbing dye colour*, and the correction flows through the whole film and print model | the photographer decides by eye, on the picture he sees |
| Detection | automatic (`detectSpecks`), reviewed by hand | manual, by clicking |
| Spots stored in | `scan.dust.spots` (array, sensor px) | `retouch.spots.<id>` (record, sensor px) |
| Source of fill | harmonic or patch inside the density image | patch from elsewhere in the print |
| Op | `scan.heal` | new `retouch.heal`, owner CHB-022 |

Practical rule for the UI: **a spot click on a negative frame defaults to Dust mode** (writes `scan.dust.spots`,
healed in density), because a speck on film is far better removed before inversion. The user can switch the tool's
mode to Heal or Clone to work in print space; digital RAW frames have only the print-space modes. One tool, one
overlay, two storage targets. The mode toggle's label says which: "On the film" and "On the print".

`retouch.heal` goes after `view.adapt` and before every `finishing.*` op, so that finishing tones apply to the
healed picture and a clone copies *un-finished* pixels (a clone made after a clarity boost would copy the halo):

```text
... view.reflect -> view.flare -> view.adapt -> retouch.heal -> finishing.* -> output.display -> output.frame
```

Spots are in sensor pixels of the **un-oriented, un-rotated source**, exactly like `scan.dust.spots`. Because
`retouch.heal` runs before `output.frame`, a crop or straighten never moves a spot and never needs to rewrite one.
The tool does the arithmetic for the user's eyes (section 5.4).

### 3.3 Finishing tones

`finishing.clarity` and `finishing.hue` exist (CHB-015). The kit adds a small, deliberately short set, all on
`print-xyz`, all before `output.display`, all with `ui.group: 'Finishing'`:

| op (proposed) | recipe path | what it does |
|---|---|---|
| `finishing.tone` | `finishing.values.shadows`, `.highlights`, `.contrast` | shadow lift, highlight pull, an S-curve, applied to print lightness with chroma held |
| `finishing.clarity` | `finishing.values.clarity` (+ radius) | exists |
| `finishing.hue` | `finishing.hues.<family>` | exists |
| `finishing.saturation` | `finishing.values.saturation` | chroma scale in a perceptual space, below the knee |

Not on the list, on purpose: white balance, temperature, tint, exposure. In the darkroom those are filtration and
time; exposing a second set of controls that do the same thing would make the Print module's physics optional and
confuse both the photographer and the agent. If a variant wants them as finishing, it can (the op table is
extensible by CHB-015), but the kit does not.

Honest labelling is built in: the panel header is "Finishing (digital, after the print)", every slider's `why`
provenance reads "finishing, not darkroom", and a build pass (section 9.5) warns if a variant puts `finishing.*`
controls in a module whose label is Print or Darkroom. `finishing.look` (0 to 1) is the master amount: the whole
finishing set scaled, which is how CHB-021's looks reach this panel.

## 4. Module layout

```text
packages/studio-kit/kits/finish/
  index.ts                 export const finishKit = ck.kit('finish', ...)
  geometry.ts              PURE: rotate, fitsInside, fitCrop, largestCrop, toSource, toShown (no DOM)
  tools/crop.ts            the crop tool: hit test, modes, gesture state, overlay
  tools/spot.ts            the spot tool: modes, source pin, overlay
  tools/mask-shapes.ts     local-tone masks (stage 6): brush, linear, radial, written as mask.set
  panels.ts                cb.finish.panel.{crop, retouch, tones, masks}
  commands.ts              crop.reset, crop.swap, crop.aspect.*, orient.*, spot.delete, spot.clear, ...
  fragments.ts             frame-handle methods, viewer slots, grid badges
  passes.ts                finish/crop-valid, finish/spots-bounds, finish/finishing-label, finish/order
  retouch/                 engine side: spot patch evaluation, suggestSource (CPU reference)
  docs/                    help pages contributed to Help
packages/contract/src/catalog/retouch.ts     retouch.heal (proposed), finishing.tone (proposed)
packages/gpu/..                              heal kernels (stage 7)
```

`geometry.ts` is the part that is shared with the agent's DSL. It has no imports from the shell or the DOM, so
CHB-007 can bind it into the QuickJS prelude as `geom.*`. That is how `frame.crop({aspect: '4:5'})` in agent code
and the crop tool's aspect snap compute the same box.

## 5. Tools as viewport gestures

### 5.1 The tool grammar

A tool is registered on the viewport in the shell grammar (CHB-016 section on tools; CraftKit's
`docs/SHELL.md` "Tools"). Each handler returns a *gesture state* `g`; the shell passes the same `g` to the next
`drag` and to `up`:

```js
t.tool('crop', {
  label: 'Crop & Straighten', icon: 'crop', key: 'R',
  enabled: s => !!cb.frameId(s), why: 'Select a photo first',
  on: {
    enter: ctx => ctx.set({ ui: { cropStart: cb.recipe(ctx).view.frame } }),
    hover: (e, ctx) => { /* set cursor from hit-test */ },
    down:  (e, ctx) => ({ mode: hit(ctx, e), start: cb.recipe(ctx).view.frame, e0: e }),
    drag:  (e, ctx, g) => { ctx.preview('view.frame', next(g, e, ctx)); return g },
    up:    (e, ctx, g) => ctx.commit(g.mode === 'rotate' ? 'Straighten' : 'Crop'),
    escape: ctx => ctx.cancel(),
  },
  overlay: (g, vp, s) => drawCrop(g, vp, s),
})
```

`ctx.preview(path, value)` writes a *preview* value that is drawn (the viewer reads the preview layer through the
render bridge, so the proxy-size image re-renders), but is not in the EditLog. `ctx.commit(label)` turns the
preview into one `set` mutation, one undo unit, with `by: 'user'`. `Esc` drops the preview. Leaving a preview open
when the tool ends is diagnostic T420; a pass checks every tool handler pair at build.

### 5.2 Crop modes

`down` hit-tests in screen pixels (so handles are the same size at every zoom): the eight handles, the inside of the
frame (move), and everything else (rotate). The rotation gesture is the angle between the pointer and the crop's
centre, relative to the angle at `down`, so the picture turns under the pointer. Hold `Shift` to snap to 0.5 degree
steps. A short double-click on the frame commits and leaves the tool, as `crop.done`.

Aspect: the options panel offers `original`, `free`, `1:1`, `4:5`, `5:7`, `2:3`, `3:2`, `16:9`, and the paper sizes
the Export module knows. Choosing one reshapes the crop at once around its centre, as large as fits (CraftKit's
`setAspect`). `X` swaps portrait and landscape, `A` toggles the lock. The aspect and lock are *tool options*
(`ui.toolOptions.crop`, view tier, saved with the workspace), not recipe state: the recipe holds the resulting box.

### 5.3 Keeping the crop inside the picture

This is the constraint that makes straightening feel right, so port it exactly. During `drag`:

```ts
// geometry.ts (sketch)
export function fitsInside(box: Box, angleDeg: number, canvas: Size): boolean   // four corners in the rotated rect
export function constrain(frame: FrameSettings, canvas: Size): FrameSettings {
  if (fitsInside(frame.crop, frame.angle_deg, canvas)) return frame
  // keep the centre (or recentre if the centre left the picture), shrink about it by bisection
  let lo = 0, hi = 1
  for (let i = 0; i < 24; i++) {
    const k = (lo + hi) / 2
    fitsInside(scaleAbout(frame.crop, centreOf(frame.crop), k), frame.angle_deg, canvas) ? (lo = k) : (hi = k)
  }
  return { ...frame, crop: scaleAbout(frame.crop, centreOf(frame.crop), lo) }
}
```

For `rotate` mode, rotating *shrinks* the crop so the result stays valid (the picture appears to zoom in as you
tilt), which is what the user expects. For `move` mode a move that would leave the picture is refused: the frame
sticks at the edge (CraftKit returns the previous `g` unchanged). With an aspect lock, resize runs `fitAspect`
after `constrain`, so the ratio is never off by the shrink. All of it works in canvas pixels; the overlay converts
to screen with `ctx.vp.toScreen`.

### 5.4 Coordinates: shown picture to source

The viewport shows the cropped, rotated, oriented picture. The recipe stores crop in the canvas, spots in the
source. `geometry.ts` exports the two conversions (CraftKit's `toSource` and `toShown`, with orientation added):

```ts
toSource(frame, srcSize, u, v): {x, y}   // shown-picture px -> source sensor px
toShown(frame, srcSize, x, y):  {u, v}   // the inverse, for drawing a spot's circle on screen
```

Both are pure and tested as a round trip over the eight orientations, angles from -45 to 45, and random crops.
Every tool uses them; no tool does its own trigonometry.

When the crop tool is active the viewport shows the *uncropped* rotated canvas, with the crop frame drawn over it
and the outside shaded (CraftKit's even-odd `dv-crop-shade` path); when another tool is active it shows the
cropped picture. A fragment on `cb.viewer` (section 9.3) switches between the two, so a variant that omits the crop
tool still shows the cropped print.

### 5.5 The spot tool

Modes: **Dust** (on the film; frames with a scan only), **Heal**, **Clone**. Options: size (a radius, shown in
source px and as a fraction of the long edge), feather, opacity, and for Heal and Clone, source selection.

Gesture, as a state machine:

```text
hover       -> draw brush circle at the pointer (size)
down        -> g = { mode, target: toSource(e), src: null, phase: 'place' }
drag        -> before 'moved': size by distance from the target (drag out to size the spot)
               after: src follows the pointer ('source pin'), the preview shows the result live
up          -> if no drag: src = suggestSource(target, size) ; commit one spot
click on an existing spot -> select it; its target and source circles show pins; drag a pin to edit
Alt+click   -> (Clone) set the source first, then click targets (Photoshop-style)
Delete      -> spot.delete ; Esc -> cancel preview
```

`suggestSource` is the only "intelligence". It is a pure function over a proxy-resolution image: search a ring of
candidate positions at distance 2r to 12r, score each by the sum of squared differences on the ring around the
target (CHB-006's `heal.ts` patch search does exactly this on density), pick the best, and then **write the
chosen source into the spot**. The engine never searches at render time. This keeps renders deterministic and
cheap, lets the photographer see and move the source, and gives the agent an explicit spot to propose.

Commit writes one record (section 6.2). Dust mode instead appends to `scan.dust.spots`:

```js
ctx.commit('Remove Spot')        // one undo step, whichever target it wrote
```

Delete, Clear All, Show Spots (a toggle that draws every spot as a circle with its source line), and Cycle
(`[` and `]` step through spots) are commands in `commands.ts`; each declares `enabled` and a `why`.

## 6. Storage: vectors in the recipe

### 6.1 Frame

Section 3.1: `view.frame = { orientation, angle_deg, crop }`. Written by `set` mutations to the three leaves, or to
`view.frame` as a whole object when the gesture changes several at once (the tool's `up` writes the whole object:
one mutation, so one undo step and one `expect` check).

### 6.2 Retouch spots

```ts
// recipe: retouch.spots is a record keyed by spot id, applied in insertion order
interface RetouchSpot {
  mode: 'heal' | 'clone';
  x: number; y: number;            // target centre, sensor px (un-oriented source)
  r: number;                       // radius, px
  src: { x: number; y: number };   // source centre, sensor px (always explicit)
  feather: number;                 // 0..1 of r
  opacity: number;                 // 0..1
  enabled: boolean;                // so Show/Hide before-after works without deleting
}
```

Decision record.

- *Context.* Spots are added and removed one at a time by the user, and sometimes by the agent. The contract's
  `scan.dust.spots` is a whole array replaced by one `set`.
- *Alternatives.* (a) Array, like dust. Concurrent edits (user adds a spot while an agent proposal waits) conflict
  on the whole array at `E_STALE`. (b) New mutations `spot.add` and `spot.remove`. Cleaner, but each new mutation op
  widens the closed set. (c) A record keyed by id with wildcard paths (`retouch.spots.*`), like `finishing.hues.*`.
- *Decision.* (c). `set retouch.spots.s7 {…}` adds or replaces one spot; `set retouch.spots.s7 null` deletes it
  (needs `checkSet` to accept null at that pattern, a one-line contract request). Staleness is per spot.
- *Consequence.* Auto-detected dust stays an array (it is bulk, replaced by re-detection). Ids are generated by
  the tool (`s` plus a counter).

Order does not matter, by decision: **every spot's source is read from the image before retouching**, not from the
result of other spots. Overlapping targets blend by taking the later spot over the earlier. This makes the op
parallel (section 7) and the result independent of the order in which the user placed spots, at the cost of one
case: cloning *from* a place that was itself healed gives the original there. Acceptable; say so in Help.

### 6.3 Finishing and local masks

Global tones are plain numbers at `finishing.values.*` (exists). Local tones, if built (stage 6), are:

```ts
// recipe: finishing.local is a record keyed by id; masks are the existing `masks` record
interface LocalFinish { mask: string; opacity: number; enabled: boolean; values: Record<string, number> }
```

with `mask` naming an entry of `masks` (a `MaskSpec`). The brush, linear and radial tools write `mask.set` with
`mask.paint`, `mask.gradient` and `mask.ellipse` nodes (CHB-009's `maskSpec(graph, receiver, doc)` in
`apps/studio/src/core/tools.ts`, with Ramer-Douglas-Peucker stroke simplification). CHB-010 already owns masks for
dodge and burn; local finishing exists for what dodging cannot do (clarity, hue, saturation in one place). A
variant that does not want it omits `cb.finish.panel.masks()`.

### 6.4 Resolution independence

Everything above is pixels of the source. At 1/8 preview scale a 14 px spot is under two pixels; at export it is
14. The engine scales `r` and positions with the frame scale; below a minimum rendered radius (one pixel) a spot is
skipped in drafts and drawn in the refine pass. The overlay is drawn from the vectors in screen space, so it is
crisp at any zoom.

## 7. The engine side

### 7.1 `retouch.heal`

Proposed op (owner CHB-022, `packages/contract/src/catalog/retouch.ts`):

```ts
defineOp({
  name: 'retouch.heal', area: 'retouch', owner: 'CHB-022', on: 'Image', returns: 'Image',
  domainIn: 'print-xyz', domainOut: 'print-xyz',
  class: 'spatial', binding: 'setting', recipePath: 'retouch',
  args: { spots: { type: 'string', path: '', default: '[]', doc: 'Canonical JSON of the spots (filled by compile from retouch.spots).' } },
  doc: 'Heals and clones circular spots on the print.',
})
```

The same trick as `scan.heal`: the `spots` argument carries the canonical JSON so the node id changes when and
only when the spots change (content addressing). `compile()` fills it from `retouch.spots` and omits the node when
there are none, so an unretouched frame's graph is exactly as before. This needs an array-of-objects arg or the
string-carrier; the string-carrier needs no registry change.

### 7.2 How a spot is computed: patches, then a pointwise blend

A spot's footprint is data-dependent: its target is local, but its source can be several radii away. That would
break a tile planner that expects a small halo. So the engine does not heal inside the tile loop:

1. **Patch pass.** For each enabled spot, evaluate the upstream image over its *window* (target disc plus a
   margin, and the source disc plus a margin) at the requested scale through the usual `evaluate(node, {region})`.
   Copy the source patch (clone) or copy it and correct the seam (heal), producing a small RGB patch plus an alpha
   (disc with feather times opacity). Cache the patch keyed by `node.id + spot id + scale`.
2. **Composite.** `retouch.heal`'s kernel is then pointwise: each pixel in a tile is `mix(upstream, patch, alpha)`
   for the spots that cover it. Tiles only need the patches of the spots they intersect.

The result is tile-independent (a test compares a tiled export to a one-pass render, as CHB-011 does for the
whole export), and CHB-005 sees a pointwise op plus a small "patch provider" side input.

Heal's seam correction is the harmonic offset already in `packages/ingest/src/conditioning/dust/heal.ts`
(`harmonic`, a pull-push start then SOR with Neumann borders): solve Laplace for the *difference* between the
source patch and the target surroundings on the ring, and add it inside the disc. In density that offset was a
multiplicative transmittance gain; in `print-xyz` do it in log XYZ (a gain per channel), which preserves the
surface texture of the source while matching brightness and colour. TODO: check that log-XYZ offsets behave near
paper black; fall back to additive Y offset with chroma ratio held if not.

### 7.3 Starting point and the GPU

CPU reference first, in `kits/finish/retouch/`, copying structure from `dust/heal.ts` and `dust/kernels.ts`
(components, ring, harmonic). The CPU path is enough for patches (small windows, a few hundred pixels across).
The harmonic solve of a 100 px window takes tens of milliseconds on the CPU; CHB-005 may later port it as a WGSL
kernel alongside the dust ones (`dust/wgsl/`). The composite is a trivial pointwise addition to the chain. So: CPU
patches, GPU composite, and no new heavy kernel for v1.

### 7.4 Workbench retouch ops as an option

CraftKit's Workbench (`vendor/wb`, wasm) has `image.heal`, `image.contentAwareFill` and `image.inpaint` (PatchMatch),
31 blend modes, and `image.select.subject` and `image.select.sky` (`vendor/wb/ck-catalog.js`, lines 57 to 66, and
the select block near 211). It is attractive and it is not free:

| question | answer |
|---|---|
| Domain | Workbench is sRGB. To use it on a print we convert `print-xyz` to linear sRGB (out-of-gamut values are negative or above one), run the op, convert back. That is a sandwich around the op and loses fidelity at the edges of the gamut; or we apply it after `output.display`, which breaks CHB-011's rule. |
| Tiles | `contentAwareFill` and `inpaint` are marked `roi: 'global'`: they need the whole image. Fine for a preview, a problem for 100 MP export. |
| Determinism | PatchMatch is randomised; a recipe must render identically each time, so a seed in the spot is needed. |
| Licence | The zip states none; ownership of `vendor/wb` and the wasm crates is an open question (CHB-016 diary). **Blocks shipping, not designing.** |
| Value | Content-aware fill and subject/sky selection are things we do not have and a photographer will ask for. |

Recommendation: implement `heal` and `clone` in our own engine (this guide), because they are simple, they must be
tile-clean and domain-correct, and we already have the kernel. Treat Workbench as an *optional provider* behind the
same spot record: a third mode `fill` whose patch pass calls `image.inpaint` through a small adapter (preview and CPU
only, `seed` stored in the spot), and `select.subject` / `select.sky` as buttons in the masks panel that call
`mask.set` with a pre-rendered mask stored as a `mask.paint` stroke set. Both gated on the licence answer; the
adapter has one file, so removing it is cheap. Blend modes are only relevant with layers (section 13).

## 8. Edge cases in the engine and tools

- **Spots near the border.** The window is clamped; a source disc partly outside the picture is rejected by the
  tool (the source pin refuses to leave the picture) and by a pass for recipes written elsewhere.
- **Spots outside the crop.** Kept in the recipe, not rendered; the Show Spots overlay greys them. Cropping again
  brings them back.
- **Crop and oriented frames.** `crop` is in the oriented, rotated canvas. Changing `orientation` after a crop
  would put the box in the wrong place; the orient commands transform the box with the same arithmetic (rotate 90
  swaps width and height around the canvas) in the same transaction, and the pass `finish/crop-valid` catches
  recipes where it did not.
- **A hand crop at a different aspect than export.** Export size is a separate setting (CHB-011); crop only decides
  the framed region.
- **Dust mode after Heal.** If a spot was healed on the print and then the same speck is detected on the scan, both
  apply: dust heal is upstream, so the print spot would copy already-clean pixels. Harmless.

## 9. How it appears as builder calls

### 9.1 Simple to complex

The smallest use: install the kit and use its default tools and panels.

```js
import { defineVariant } from '@chromobench/studio-kit'
import { finishKit } from '@chromobench/studio-kit/kits/finish'

export default defineVariant({
  id: 'simple', label: 'Three steps',
  build: (ck, cb) => ck.shell('Chromobench')
    .use(finishKit)
    .module('finish', m => m.label('Finish').key('F')
      .center(cb.viewer(s => cb.frame(s).print(), { tools: ['crop', 'spot'] }))
      .right(cb.finish.panel.crop(), cb.finish.panel.retouch(), cb.finish.panel.tones())),
})
```

Rearranged: tools in a Lightroom-style toolbar, crop options only while the crop tool is active, a before/after
toggle, and a custom aspect list.

```js
.module('develop', m => m
  .top(ck.toolbar(['tool.crop', 'tool.spot', '-', 'tool.mask-brush', '~', 'compare.toggle']))
  .center(cb.viewer(s => cb.frame(s).print(), {
    tools: ['crop', 'spot', 'mask-brush', 'mask-linear', 'mask-radial'],
    overlays: [cb.finish.overlays.spots(), cb.finish.overlays.thirds()],
    compare: true,
  }))
  .right(ck.dock.column({},
    ck.when(s => s.ui.tool === 'crop', cb.finish.panel.crop({ aspects: ['original', '1:1', '4:5', '3:2', '16:9', 'A-series'] })),
    ck.when(s => s.ui.tool === 'spot', cb.finish.panel.retouch({ modes: ['dust', 'heal', 'clone'] })),
    cb.finish.panel.tones({ only: ['shadows', 'highlights', 'clarity'] }),
    cb.finish.panel.masks())))
```

Omitted: a variant that leaves out the kit has no tools, no overlays and no panels; the viewer still shows the
cropped, rotated print because that is the `view.frame` render path, not a kit feature.

Building a panel by hand with the generic argument binder (the kit's panels are just these calls):

```js
ck.panel('finishing', { title: 'Finishing (after the print)' },
  cb.arg('finishing.values.shadows').slider({ label: 'Shadows', bipolar: true, why: 'finishing, not darkroom' }),
  cb.arg('finishing.values.highlights').slider({ label: 'Highlights', bipolar: true }),
  cb.arg('finishing.values.clarity'),
  cb.arg('finishing.look').slider({ label: 'Look amount' }))
```

`cb.arg(path)` takes its range, unit, step and label from the registry's `ArgSpec` (`min`, `max`, `ui`), so the
panel cannot drift from the op. A tool defined in the variant itself (a custom "straighten by two points" tool that
sets `view.frame.angle_deg` from a line the user draws on a horizon) is plain `t.tool(...)` with the same
`ctx.preview` and `ctx.commit` and `cb.finish.geometry` helpers:

```js
t.tool('level', { label: 'Level', key: 'L', on: {
  down: (e, ctx) => ({ a: ctx.vp.toImage(e.sx, e.sy) }),
  drag: (e, ctx, g) => { const b = ctx.vp.toImage(e.sx, e.sy); ctx.preview('view.frame.angle_deg', cb.finish.geometry.angleOf(g.a, b)); return g },
  up:   (e, ctx) => ctx.commit('Level the horizon'),
}})
```

### 9.2 The kit

```js
export const finishKit = ck.kit('finish', k => k
  .requires('cb')
  .forms({ cropPanel, retouchPanel, tonesPanel, masksPanel })     // cb.finish.panel.*
  .tools(t => { cropTool(t); spotTool(t); maskTools(t) })
  .commands(c => { cropCommands(c); orientCommands(c); spotCommands(c); finishCommands(c) })
  .fragments(frameFragments, viewerFragments, gridFragments)
  .passes(cropValid, spotsBounds, finishingLabel, finishingOrder)
  .state({ ui: { toolOptions: { crop: { aspect: 'original', locked: true }, spot: { mode: 'dust', size: 0.012, feather: 0.5, opacity: 1 } } } })
  .docs('./docs'))
```

Commands, all in the one table so menus, palette, shortcuts and toolbars come free: `crop.reset`, `crop.swap`,
`crop.lock`, `crop.done`, `orient.cw`, `orient.ccw`, `orient.flip-h`, `orient.flip-v`, `spot.delete`, `spot.clear`,
`spot.show`, `spot.next`, `spot.prev`, `finish.reset-tones`, `finish.toggle` (before/after of the whole finishing
set, which is `finishing.look` held at 0 in a preview, never committed).

### 9.3 Fragments

A fragment extends a component without editing it:

```js
ck.fragment(cb.viewer, {
  props: { frameMode: { default: 'cropped' } },                     // 'cropped' | 'canvas'
  slots: { finishOverlays: [] },
  methods: { finishOverlays(...xs) { return this.slot('overlays', xs) } },
})
ck.fragment(cb.frameHandle, {
  methods: {
    crop({ aspect, anchor = 'centre' } = {}) { /* geometry.fitCrop, then edit */ },
    straighten(deg) { return this.edit({ 'view.frame.angle_deg': deg }) },
    spot({ at, r, mode = 'heal', from }) { /* geometry + one edit retouch.spots.<id> */ },
  },
})
ck.fragment(cb.grid.cell, { badges: [s => hasCrop(s) && 'crop', s => spotCount(s) > 0 && `${spotCount(s)} spots`] })
```

A variant that installs the kit gets `frame.crop(...)` on handles, a viewer that knows `frameMode`, and a "crop"
badge on grid cells. A variant that does not install it sees none of these; the fragments are inert without
`.use(finishKit)`.

### 9.4 Agent DSL counterparts

The agent runs in the QuickJS sandbox (CHB-007). It sees the same handle vocabulary and the same op names. The
registry-driven methods exist once `retouch.heal` and the `view.frame` paths are in the registry; the kit adds the
sugar in `geom.*`, the pure module of section 4.

```js
// agent eval code (QuickJS); shapes follow CHB-007's frame handle
const f = frame('F-0014')
f.edit({ 'view.frame': geom.fitCrop(f.size(), { angle_deg: 1.3, aspect: [4, 5] }) },
       { why: 'Level the horizon, portrait crop' })
f.edit({ 'retouch.spots.s1': { mode: 'heal', x: 1204, y: 733, r: 14, src: geom.suggestSource(f, { x: 1204, y: 733, r: 14 }),
                               feather: 0.5, opacity: 1, enabled: true } },
       { why: 'Remove the speck by the window' })
f.edit({ 'finishing.values.shadows': 0.15 }, { why: 'Lift the shadows slightly' })
```

Each `edit` is a `set` mutation; run by the agent it becomes `pending` with an approval card, and the preview
shows the crop, the healed spot and the lifted shadows before the photographer approves. `geom.suggestSource`
calls the same ring-search as the tool, on a proxy render the host provides, so agent spots are as good as
hand-placed ones. One DSL addition is needed in CHB-007: pure `geom.*` bindings (no DOM, no I/O).

### 9.5 Passes

| pass | IR | does |
|---|---|---|
| `finish/crop-valid` | recipe | the crop's four corners lie inside the rotated picture; fix: the largest valid box with the same aspect |
| `finish/spots-bounds` | recipe | target and source discs inside the picture, source not overlapping target; warns on spots outside the crop |
| `finish/finishing-label` | UI tree | a `finishing.*` control in a module labelled Print or Darkroom gets `CB-F101` with the fix "move it to a Finish module or relabel" |
| `finish/order` | op DAG | `retouch.heal` is after `view.adapt` and before every `finishing.*`; nothing consumes `display-rgb` before `output.frame` except `output.encode` (reuses CHB-011's rule) |

All report through `diag(code, message, { at, facts, fix })` with the `CB-F*` family.

## 10. One flow traced end to end

A 3000 x 2000 negative-scan frame, printed and dodged. The photographer wants the horizon level (it is 1.3 degrees
off), a portrait 4:5 crop, two specks removed, and the shadows lifted a little. The UI is the `simple` variant.

**1. Open Finish.** The `finish` module mounts. `cb.viewer` draws `frame.print()`, the recipe has no
`view.frame` change, no spots.

**2. Crop and straighten.** The photographer presses `R`. The tool's `enter` stores the starting frame. The
viewport switches to canvas mode (the full 3000 x 2000 canvas with the crop frame). He picks `4:5` in the options
panel: `setAspect` reshapes the crop around its centre to the largest 4:5 that fits: 1600 x 2000 at angle 0. He
drags outside the frame clockwise by 1.3 degrees; each `drag` calls `ctx.preview('view.frame', ...)` with a
re-constrained geometry, the picture turns, the crop shrinks. At `up`, `ctx.commit('Straighten')` applies one
mutation:

```text
set view.frame = { orientation: 'none', angle_deg: 1.3, crop: { x: 716, y: 20, w: 1568, h: 1960 } }
```

(The numbers: the 4:5 box of half-height s must satisfy 0.8 s sin 1.3 + s cos 1.3 <= 1000, so s <= 982.4; the box is
1568 x 1960 centred on the canvas. The shrink from 1600 x 2000 is the keep-inside constraint at work.) One undo
step, `by: 'user'`. The EditLog applies it; `view.frame` validates: corners inside, ratio 0.8.

**3. Remove two spots.** `Q`. The frame shows the cropped picture. He clicks a speck at shown position (494, 706):
`toSource` inverts the crop offset, the rotation and the orientation and returns source (1204, 733). The tool is in
Dust mode (the frame has a scan), `up` appends to `scan.dust.spots` as `{id: 'd7', x: 1204, y: 733, r: 14}` through
one `set` of the array (healed in density by `scan.heal` with the frame's configured method, before inversion).
A second speck is on a face and larger; it is not a dust bump, so he switches the mode to Clone, drags out to size
the spot, then drags the source pin to a clean patch nearby, and releases:

```text
set retouch.spots.s2 = { mode: 'clone', x: 2210, y: 1390, r: 22, src: { x: 2278, y: 1356 },
                         feather: 0.5, opacity: 1, enabled: true }
```

Both are source-pixel positions; shown (1485, 1386) for the second was converted by `toSource`. Rotating or
re-cropping later moves neither.

**4. Lift the shadows.** In the Finishing panel (`cb.finish.panel.tones()`) he drags Shadows to +0.15.
`cb.arg('finishing.values.shadows')` previews on each move (proxy-size renders, latest wins) and commits one
`set finishing.values.shadows 0.15` at release. The panel header said "Finishing (digital, after the print)".

**5. What the engine does.** `compile(recipe)` builds the chain; the new nodes are appended only where the recipe
asks:

```text
... film/print physics ... -> view.reflect -> view.flare -> view.adapt
-> retouch.heal { spots: [s2] } -> finishing.tone { shadows: 0.15 } -> output.display -> output.frame { angle: 1.3, crop }
```

The dust spot is upstream in `scan.heal`. At screen scale the scheduler draws a draft with the spot patch computed
at 1/4 scale, then refines. At export the planner tiles the 1568 x 1960 output; the clone's patch is computed once
at full resolution from the window around (2210, 1390) and (2278, 1356), cached under `node.id + 's2' + 'full'`,
and composited tile by tile.

**6. Undo.** `Mod+Z` three times undoes the shadow lift, the clone, then the crop; the global undo interleaves
shell and EditLog units through the history adapter, so the History panel shows `Lift Shadows`, `Remove Spot`,
`Straighten`, in the frame's channel.

**7. If the agent had done it.** The same four edits arrive as four `pending` mutations with `why` strings and one
approval card; the viewer previews them together; approving applies them as one transaction; a stale `view.frame`
`expect` would offer "apply anyway".

## 11. Implementation plan

Stages, each with a "done means". All can start against the mock engine.

**Stage 1. Geometry module.** `geometry.ts` with `rotate`, `fitsInside`, `constrain`, `fitCrop`, `largestCrop`,
`toSource`, `toShown`, aspect parsing. *Done means:* round-trip tests over orientations and angles pass; the
worked example (1.3 degrees, 4:5) gives 1568 x 1960; no DOM imports (checked by a lint rule or a test that loads
the file in plain Node).

**Stage 2. Contract requests.** With CHB-017: `view.frame` (orientation, angle_deg, crop) for both kinds;
`output.frame` args; `retouch.spots.*` paths with null delete; `retouch.heal` and `finishing.tone` op
definitions; `finish/crop-valid` as a recipe check. *Done means:* registry check and `assertRecipe` tests pass;
contract version bumped.

**Stage 3. Mock-engine rendering of frame and spots.** The mock engine applies rotation, crop, and a naive clone.
*Done means:* the studio shows the geometry changes against the mock.

**Stage 4. Crop tool and panel.** `tools/crop.ts`, `cb.finish.panel.crop()`, commands, overlay. *Done means:*
straighten by dragging outside, aspect lock, keep-inside, `Esc`, one undo step per gesture; Node test of the tool
handlers driven by synthetic events (no DOM), snapshot of the overlay as `ck.explain`.

**Stage 5. Spot tool (dust and clone) and panel.** Dust mode writes `scan.dust.spots`; clone writes
`retouch.spots`; source pin; `suggestSource`. *Done means:* place, edit, delete, undo; spots survive crop and
rotation unchanged.

**Stage 6. Finishing panel and passes.** `finishing.tone` UI, labelling, `finish/*` passes. *Done means:* the
panel renders from `ArgSpec`; CB-F101 fires on a mislabelled variant; before/after toggle works.

**Stage 7. Real `retouch.heal` and `output.frame` in the engine.** CPU patch pass (heal harmonic offset), GPU
composite and rotation kernel with CHB-005. *Done means:* heal passes a planted-spot test on synthetic frames; a
tiled export equals a one-pass render within one 8-bit level; rotation of a grid test card keeps edges within a
pixel.

**Stage 8. Local tones (masks).** Brush, linear and radial tools over CHB-009's `maskSpec`, `finishing.local`.
*Done means:* a graduated sky adjustment, undone and redone, previewed live.

**Stage 9. Agent counterparts.** `geom.*` bindings in CHB-007's prelude; fragments on the frame handle. *Done
means:* the agent snippet in 9.4 produces the same recipe as the hand flow of section 10.

**Stage 10 (optional, gated). Workbench provider.** `fill` mode and `select.subject` through an adapter. *Done
means:* only after the licence answer; one file, with a switch to remove it.

## 12. Testing and acceptance

- **Geometry:** round-trip, constraint and aspect property tests (random boxes, angles, orientations); golden
  values for the worked example.
- **Tools without a DOM:** a test harness drives `down`, `drag`, `up` with synthetic events and a fake `ctx`; it
  asserts the previews, the commit label, the single mutation and the cancel path.
- **Recipe:** invalid crops and bad spots are rejected with diagnostics that carry the fix; `set ... null` removes
  a spot.
- **Engine:** a planted-spot synthetic frame, healed and cloned, compared with the original picture; tiled
  against one-pass; scale independence (a spot at 1/2 scale matches the full render downsampled within tolerance,
  as CHB-006's heal test does for dust).
- **Variants:** each variant that installs the kit builds headless with zero error diagnostics; `ck.explain`
  snapshot of the finish module; Playwright smoke: open a fixture, straighten, place a spot, lift shadows, undo
  three times.
- **Acceptance:** the flow of section 10 works in the `simple` and `classic` variants unchanged, with no
  variant-specific code in the kit.

## 13. Layers: a sketch, not a commitment

The user mentioned layers as a possible later want. The kit's shapes already point toward them. A *layer* is a
record `{ id, kind, mask, opacity, blend, enabled, content }`. Retouch spots, local finishing adjustments and
(later) an image placed over the print are all layer-shaped: spot has `enabled` and `opacity` already; a local
finish has `mask`, `opacity` and `enabled`.

As an IR: `finishing.layers: Layer[]` in the recipe, lowered by a pass `layers.lower` into op nodes on the
`print-xyz` chain: each layer becomes its content op(s) followed by a blend (`image.blend`-like, with the mask and
opacity), in stack order. The retouch and local-finish records are what the lowering would produce for two layer
kinds; adopting layers then becomes a *lowering* change, not a recipe migration, if we keep those record shapes.
The UI would add a layer list panel (`ck.view.list`, like CraftKit's Masks panel) and `cb.finish.panel.layers()`
without changing any tool.

What stays unresolved: blend modes. CraftKit's 31 modes are defined on sRGB; on `print-xyz` they must be defined
on lightness or on a log-linear encoding, and "multiply" in linear light is not what Photoshop users expect. Do not
build any of this until a concrete need appears.

## 14. Risks and open questions

| item | note | blocks? |
|---|---|---|
| `view.frame` contract change | affects CHB-011, CHB-012 (digital RAW), the registry and `output.frame` | yes, stage 2 |
| Where `output.frame` runs (print-xyz vs display-rgb) | recommendation: keep last | no |
| Straightening resample cost and quality | bilinear in drafts, Lanczos-3 in export; edge of the empty corners | no |
| Heal in print-xyz: log offset near black | TODO test; fallback additive | no |
| Planner halo for spots | solved by patch pass plus pointwise composite; check with CHB-005 | stage 7 |
| Auto source choice quality | `suggestSource` on a proxy; the pin is movable | no |
| Workbench licence | blocks stage 10 only | stage 10 |
| `set ... null` to delete a record entry | one-line contract request | stage 2 |
| Finishing set size | the list in 3.3 is a first guess; CHB-015 owns the physics of each op | no |
| Crop stored in canvas px: units for non-square resampling | none, canvas px are source px | no |
| `retouch` vs `finishing` area for `retouch.heal` | naming; a registry detail | no |

Open questions for Manuel: should Dust mode be the default for negative frames (this guide says yes)? Should the
finishing panel show a before/after toggle for the whole set (yes here)? Is a free-hand healing stroke (many
points) wanted in v1, or are circles enough (circles here; strokes would add a `path` field to a spot)?

## 15. References

- UI design brief: `ttmp/2026/11/11/CHB-016--*/various/ui-design-brief.md`; CHB-016 diary Steps 2 to 4.
- CraftKit: `CHB-016/sources/craftkit-studio/src/app/develop-tools.js` (crop 56 to 150, heal 153 to 217, masks
  225 to 392), `develop-model.js` (`constrainCrop`, `cropFits`), `vendor/wb/ck-catalog.js` (retouch ops, lines 57 to
  66), `docs/SHELL.md` (tools).
- Contract: `packages/contract/src/catalog/view-output-mask.ts` (`output.frame`, `output.display`, mask ops),
  `measure-darkroom-finishing.ts` (`finishing.*`), `source-scan-invert.ts` (`scan.heal`), `recipe.ts`,
  `mutations.ts`.
- Dust: `packages/ingest/src/conditioning/dust/{heal,specks,kernels}.ts`; CHB-006 guide section 5.11 and DR-7,
  DR-10.
- Output: CHB-011 guide (finishing before the knee, graph rule 5).
- Masks and gestures: `apps/studio/src/ui/tools/Masks.tsx`, `apps/studio/src/core/{tools,gesture}.ts`.
- Darkroom masks: CHB-010 guide.
