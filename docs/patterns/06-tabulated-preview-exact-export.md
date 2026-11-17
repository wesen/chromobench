# Chapter 6 · Tabulated Preview, Exact Export ★

*Evaluate one graph at two precisions: interactive previews read precomputed tables at reduced resolution; exports
integrate exactly at full resolution. The precision is part of each request, not a property of the engine.*

## Intent

Let an expensive model run at interactive speed without forking it into a "fast version" and a "real version". The
same operations, with the same parameters, are evaluated through tabulated approximations and reduced sampling when
a person is looking, and exactly when a file is written. Each approximation has a stated error, a key that says what
it was built from, and a twin in the reference that makes the same approximation.

## Also known as

Preview and render modes; proxy editing; LUT acceleration; level-of-detail evaluation; draft quality.

## Motivation

The running example's print chain contains spectral integrals: the light through three dye layers, weighted by the
paper's three sensitivities, summed over 81 wavelengths, per pixel, for several stages. Exact evaluation of a
24-megapixel image takes far longer than a slider gesture allows. Four approaches fail.

1. **A separate fast model.** A hand-written approximation of the look drifts from the physics with every change to
   either; the photographer prints something other than what he saw.
2. **Exact everywhere.** Correct and unusable: a drag shows nothing until the hand stops.
3. **Tables everywhere.** Fast, but exports inherit the table's interpolation error, and nobody can say how large it
   is without an exact path to compare with.
4. **Approximations without names.** A table built from yesterday's film data is reused after the data changes; a
   preview at one resolution is compared with an export at another; the hardware's interpolation differs from the
   one the tests assumed.

Colour management (3-D lookup tables against analytic transforms), real-time rendering (precomputed lighting
integrals against path tracing) and video editing (proxy media against camera originals) face the same choice.

## Problem

**How do you make an exact but expensive image model interactive without maintaining a second model, and without
letting approximations leak into results that must be exact?**

## Forces

- **Speed against fidelity.** Tables and reduced sampling are fast; their errors must stay below what the eye sees in
  a preview and must not reach an export.
- **One model against two.** Approximating inside the model keeps one source of truth; approximating outside it is
  easier to write.
- **Table size against accuracy.** 33³ nodes fit in a texture and interpolate well where the function is smooth; the
  error grows where it bends.
- **Hardware interpolation against control.** The GPU's texture filter is one instruction; its precision is the
  hardware's choice, not yours.
- **Reduced sampling against measurement.** A preview at screen size is enough to look at; a measurement made on it
  may not equal one made at another size.

## Solution

**Therefore: make precision a field of every evaluation request (`preview` or `export`) and let each operation that
has an expensive core offer two implementations of the same mathematics: an exact one and a lookup into a table
computed from the exact one. Key each table by a hash of everything it was built from, including the data arrays it
consumed, its size, its domain and its builder, and resolve it from memory, then persistent storage, then a build.
Interpolate tables with an explicit, tested lookup (not whatever the hardware does). Choose preview resolution
separately from table use, and pin the resolution of any measurement that drives a decision. Exports always take the
exact path at full resolution.**

## Applicability

Use it when:

- an operation's exact evaluation is much more expensive than its interpolation, and smooth enough to tabulate;
- interaction and final output have different accuracy needs;
- a reference exists to measure both the tables' and the preview's error (Chapter 3).

Do not use it when:

- the function is not smooth over the table's domain (thresholds, discontinuities): tables smear the edge;
- the exact path is already fast enough for interaction; two paths double the testing for nothing;
- previews must be exact for legal or scientific reasons (measurement software); then make the exact path faster.

## Structure

| Participant | Responsibility |
|---|---|
| **Evaluation request** | node, scale or size, region, **precision** |
| **Exact kernel** | the operation's mathematics, per pixel |
| **Table** | the exact kernel sampled on an N³ grid over a stated input range |
| **Table key** | hash of builder inputs (arrays, size, domain, conventions, builder) |
| **Table resolver** | memory → persistent cache → build (in workers or on the GPU) |
| **Lookup** | explicit interpolation (trilinear or tetrahedral) with half-texel mapping |
| **Target chooser** | picks preview resolution from the view (Chapter 4) |
| **Analysis sampler** | a fixed-resolution image for measurements that drive decisions |

## Collaborations

1. The viewer requests a node at screen size with precision `preview`; an exporter requests full size with `export`.
2. The engine lowers each operation: preview → table lookup; export → exact kernel.
3. For a preview, the table resolver computes the key, finds the table in memory or persistent storage, or builds it
   off the main thread from the exact kernel.
4. The lookup interpolates explicitly; the reference engine can run the same lookup in high precision, so the
   oracle separates table error from engine error (Chapter 3).
5. Measurements that choose parameters (automatic exposure, colour balance) run on an image of fixed resolution,
   whatever the preview size.

## Sketch

```text
value EvalRequest: node, size, region, precision    -- precision ∈ { preview, export }

evaluate(engine, req):
  for op in plan(req.node):
    match (op.hasTable, req.precision):
      (true, preview) → t ← tables.resolve(keyOf(op)); emit lookup(t, mode: trilinear)
      _               → emit exactKernel(op)

keyOf(op) → hash(canonical({ kind: op.tableKind, n: 33, domain: op.domainIn,
                             data: hashArrays(arrays the builder reads), builder, conventions }))

tables.resolve(key):
  return memory[key] or persistent[key] or build(key)   -- build in workers from the exact kernel

lookup(t, v, mode):                                      -- explicit, tested interpolation
  u ← clamp((v − t.lo) / (t.hi − t.lo), 0, 1) × (t.n − 1)
  match mode:
    trilinear   → weighted sum of the 8 surrounding nodes, weights in full precision
    tetrahedral → weighted sum of 4 nodes of the enclosing tetrahedron

measure(recipe) → stats(evaluate(analysisImage(recipe, longSide: 640), precision: preview))

-- in use
viewer: evaluate(EvalRequest(print, screenSize, all, preview))
export: evaluate(EvalRequest(print, fullSize, tile, export))
```

## Implementation notes

1. **Do not trust the hardware filter.** This is the running example's sharpest lesson. Its previews read tables with
   the GPU's linear texture filter. On a software rasteriser the weights are exact; on Apple hardware they have 8
   fractional bits (measured: 257 distinct weights, maximum error 1/512), which put previews up to 0.86 of an 8-bit
   level away from the reference. An explicit trilinear lookup costs 1.1 ms more per 4,000 × 2,674 preview
   (5.3 → 6.4 ms) and is exact.
2. **Map to texel centres.** With N samples, value u ∈ [0, 1] maps to texture coordinate (u·(N − 1) + 0.5)/N. Without
   the half-texel offset every lookup is shifted; the running example keeps that broken variant as a negative control
   that must fail.
3. **Tetrahedral is more accurate; match the reference first.** Tetrahedral interpolation uses four nodes and was
   both cheaper (5.9 ms) and closer to the exact function than trilinear; the running example uses trilinear for
   previews because its reference's tabulated mode is trilinear, and parity demands they match.
4. **Hash the data, not a version number.** Table keys include a hash of the arrays the builder consumes, so a
   data-pack update "changes the key without anyone bumping a version"; the domain and N are always in the key, a
   lesson carried over from the physical model the project ported.
5. **Name the builder in the key.** Previews may use tables built by the GPU in 32-bit floats or by workers in 64-bit;
   exports name the 64-bit builder. A test checks the two builders agree to a hundredth of an 8-bit level.
6. **Resolve memory → persistent → build.** Tables persist in the browser's origin-private file system; a second
   session skips the build. A miss builds off the main thread, so a first open does not freeze the window.
7. **Reduced sampling is a second approximation.** The running example's GPU engine samples the full-resolution
   source with nearest sampling at reduced scale, which keeps parity exact but lets grain alias in previews. Editor
   lab measured how far each operation's preview departs from its full render (exposure: 0.5 % of pixels off by more
   than 4 steps; grain: 56.9 %). Measure this per operation and mark previews of non-invariant operations approximate.
8. **Pin measurement resolution.** The running example's automatic first print metered a 640 px image on the CPU
   engine and a 4,000 px image on the GPU engine. The metered quantity (a log of a mean through a nonlinear film
   chain) depends on resolution, and one photo received 5.6 s on one engine and 6.3 s on the other. The fix: both
   engines meter a 640 px analysis image built the same way.
9. **Exports never take a table.** The precision field makes this a rule of the lowering, not a convention callers
   must remember. The running example's exports compute the spectral integrals per pixel and match the reference to
   a tenth of an 8-bit level.

## Variations

- **Proxy media.** Previews read a separately stored low-resolution copy of the source; simple and very fast, but the
  proxy must be regenerated when the source changes and can disagree at edges.
- **Progressive precision.** The same request is answered first from tables, then refined to exact in the background
  for the visible region; best quality at rest, more scheduling.
- **Analytic approximation.** A fitted closed form instead of a table; no memory, but the error is harder to bound
  and the fit must be redone when the model changes.
- **Pyramid previews.** Previews read pre-averaged levels of the source (an image pyramid) instead of nearest samples;
  fixes aliasing, costs a third more memory per source.

## Consequences

- \+ One model serves interaction and output; previews cannot drift from exports by construction.
- \+ Every approximation is named and keyed, so stale tables and mismatched builders cannot be reused silently.
- \+ Errors are bounded separately: table error against the exact path, engine error against the tabulated reference.
- − Two implementations per expensive operation, and a table builder, must be maintained and tested.
- − Table memory and build time are real costs (a 33³ RGBA table in 32-bit floats is about 575 KB, several per film).
- − Resolution-dependent results need their own discipline; precision alone does not cover them.

## Known uses

- **Lightroom Smart Previews** let editing proceed on smaller proxies of the originals.
- **darktable** evaluates a downscaled preview pipe for the navigation view beside the full pipe.
- **OpenColorIO** processes colour transforms exactly on the CPU and offers GPU shader paths, historically including
  3-D lookup-table approximations.
- **Real-time physically based rendering** uses a precomputed BRDF integration table (the split-sum approximation)
  where offline renderers integrate.
- **Video editors** (DaVinci Resolve, Premiere Pro) edit on proxy media and render from the originals.

## Related chapters

- [Chapter 3 · Reference Oracle](03-reference-oracle.md) bounds both approximations.
- [Chapter 4 · Latest-Wins Render Slots](04-latest-wins-render-slots.md) chooses the preview's resolution.
- [Chapter 7 · Barrier-Cut Fusion](07-barrier-cut-fusion.md) fuses lookups into one pass.
- [Chapter 1 · Interned Operation Graph](01-interned-operation-graph.md) keys tables and results by content.
- GoF: **Strategy** (lookup modes), **Proxy** (a table standing in for the exact kernel), **Flyweight** (shared tables).
