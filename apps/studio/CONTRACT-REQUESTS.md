# Contract requests from CHB-009 (studio)

The studio works against contract v0 as it stands; these are the changes it would like. Each is
worked around locally until the orchestrator applies or declines it.

## 1. `mask.paint.strokes` holds the strokes themselves (canonical JSON)

**What.** Document that `mask.paint`'s `strokes` argument is the canonical JSON of the stroke list,
`[{kind: 'stroke', points: [[x, y, pressure], …], radius, hardness, mode: 'add' | 'erase'}]` in
sensor px, the same pattern `scan.heal` uses for `spots`.

**Why.** The v0 doc says "Id of a stroke set stored with mask.set", but there is nowhere to store a
stroke set: `MaskSpec` is `{version: 1, nodes: NodeDef[]}`. Putting the strokes in the argument keeps
the mask a small vector document inside the recipe, and the node id changes when the strokes change,
so caching stays correct. The studio already writes this (`apps/studio/src/core/tools.ts`,
`maskSpec()`/`parseMask()`); the mock returns an empty mask for `mask.paint` (CHB-010 renders it).

**Diff** (`packages/contract/src/catalog/view-output-mask.ts`):

```diff
-    args: { strokes: { type: 'string', default: 'none', doc: 'Id of a stroke set stored with mask.set.' } },
-    doc: 'Painted mask.',
+    args: { strokes: { type: 'string', default: '[]', doc: 'Canonical JSON of the strokes: [{kind: "stroke", points: [[x, y, pressure]…], radius, hardness, mode: "add"|"erase"}], sensor px, simplified (RDP 0.5 px).' } },
+    doc: 'Painted mask: brush strokes rasterised with soft round dabs (erase strokes subtract).',
```

Class: additive in shape (the type stays `string`), but the default changes from `'none'` to `'[]'`,
so recipes with the old default would need `'none'` read as `'[]'`; none exist yet.

## 2. `mask.ellipse` rotation and per-shape feather

**What.** Add `angle_deg` (unit `deg`, −90…90, default 0) to `mask.ellipse`.

**Why.** Guide §5.9 specifies ellipses with handles and an angle (a tilted face). Today the studio
drops the angle; feather is applied once to the whole mask through `mask.feather`.

```diff
-    args: { box: { type: 'box', unit: 'px', default: { x: 0, y: 0, w: 16, h: 16 }, doc: 'Bounding box in source px.' } },
+    args: {
+      box: { type: 'box', unit: 'px', default: { x: 0, y: 0, w: 16, h: 16 }, doc: 'Bounding box in source px (before rotation).' },
+      angle_deg: { type: 'number', unit: 'deg', min: -90, max: 90, default: 0, doc: 'Rotation about the box centre.' },
+    },
```

## 3. Ring-around step in printer points (for CHB-010)

**What.** `darkroom.ringAround` takes `step_cc`; guide §5.9 and §6 define the ring-around in printer
lights (2, 4 or 8 points, offsets `(v − mean v)·1.5·step`).

**Workaround.** The studio does not use `darkroom.ringAround`: each tile is an ordinary display node
compiled from the effective recipe with a lights offset, so the centre tile is the main view's node
(tested) and a click writes exactly the tile's `print.lights.logH`. If CHB-010 keeps a single-image
op, a `step_pt` argument (or `unit: 'point'` alternative) would let it match the UI.

## Not requests, notes for the merge

- `ui.widget: 'stepper'` on a number argument (e.g. `capture.development.push`) renders as a slider
  with the given step; the studio only special-cases `fstop` as a stepper over the third-stop series.
- The mock's `darkroom.testStrip` prints around its own reference (`DEFAULT_PRINT`, 10 s), not the
  receiver's recipe; the studio labels bands from the recipe and says "densities illustrative".
