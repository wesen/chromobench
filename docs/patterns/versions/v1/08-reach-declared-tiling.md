# Chapter 8 · Reach-Declared Tiling ★

*Every neighbourhood operation declares how far it reads, in physical units; a planner turns those reaches into tile
halos, and computes the widest smooth kernels once, at reduced resolution, as fields every tile reads.*

## Intent

Process images larger than memory, or larger than the GPU allows, in tiles, without seams and without hand-tuning
overlaps per operation. Operations state their reach (a blur's radius, a halation's spread) in units tied to the
physical image (micrometres on the film, or document pixels), the planner converts reaches to pixels at the current
resolution, sums them along chains of neighbourhood operations, and sizes the tiles' halos. Kernels too wide for a
halo, but smooth, are computed once on a downsampled image and sampled by every tile.

## Also known as

Tiling with overlap; apron or halo planning; region-of-interest propagation; demand-driven regions; global fields.

## Motivation

The running example (chromobench, a browser darkroom with a WebGPU engine) exports a 24-megapixel print. The GPU's
default limits are 8,192 px per texture side and 128 MiB per storage binding; one 6,000 × 4,000 image in four 32-bit
floats is 384 MB. The export must be tiled. Its film model contains neighbourhood operations of very different reach:
DIR coupling and grain over a few micrometres, a density mask's blur over tens, halation's spread over millimetres.
Four naive approaches fail.

1. **Tiles without halos** show seams wherever a blur crosses a tile edge.
2. **One fixed halo** is either too small for halation or so large that every tile mostly recomputes its neighbours:
   for a reach of 70 px, a 64 px tile reads ten times the pixels it writes.
3. **Reaches in pixels** break when resolution changes: a grain size right at 640 px is four times too large at
   2,560 px. The running example's digital clarity radius is still stored in pixels and has to be rescaled for
   full-resolution export; its physical kernels, stored in micrometres, do not.
4. **Huge halos for huge kernels** cannot fit: a Gaussian of σ = 100 px needs about 300 px of input around every tile.

Gigapixel image servers, raster GIS focal operations (slope, smoothing over a radius) and out-of-core inference on
large scans face the same problem.

## Problem

**How do you split an image into tiles for operations that read their neighbourhoods, so results are seamless, halos
are no larger than needed, and very wide kernels do not dominate the work?**

## Forces

- **Seamless against cheap.** A halo of the full reach guarantees identical results; the overlap costs ((T + 2m)/T)²
  reads per written pixel.
- **Small tiles against large tiles.** Small tiles suit local edits and tight memory; large tiles amortise halos and
  fixed costs. Editor lab (a browser photo editor with a tiled CPU engine) measured "no size wins all three" of its
  workloads.
- **Physical against pixel units.** Physical reaches are correct at any resolution; pixel reaches are what the GPU
  needs.
- **Exact wide kernels against fields.** Computing a wide blur per tile is exact and expensive; computing it once at
  reduced resolution is cheap and approximate.
- **Device limits against generality.** Texture size and memory budgets differ per device; the plan must adapt.

## Solution

**Therefore: let every neighbourhood operation declare its reach in a resolution-free unit (micrometres on the medium,
or document pixels), whether neighbourhood passes in it compound along a chain, and whether its result is smooth
enough to compute at reduced resolution. At plan time convert reaches to pixels at the target resolution. Kernels
within a halo budget, or not field-capable, are local: sum their reaches along each chain, take the maximum over
chains, round up, and use that as the halo. Kernels beyond the budget that are field-capable become global fields:
downsample by the largest power of two that keeps the kernel at least two pixels wide, blur there with the residual
width, and let every tile sample the field by frame coordinates. Choose the largest tile whose haloed footprint fits
the device's budget, and refuse with a diagnostic when a local kernel reads more than a fraction of a tile.**

## Applicability

Use it when:

- images exceed device or memory limits, or exports must run in bounded memory;
- the pipeline mixes neighbourhood operations of very different reach;
- resolution varies (previews, exports, devices) and operations must look the same at each.

Do not use it when:

- images always fit in memory and on the device (screen-sized previews); whole-image evaluation is simpler;
- wide kernels are not smooth (a sharp edge-preserving filter); a field computed at low resolution would blur edges;
- the work is pointwise only; tiles need no halo and any split works.

## Structure

| Participant | Responsibility |
|---|---|
| **Spatial kernel declaration** | id, reach (σ or radius) in µm or document px, chain, field-capable, field group |
| **Frame** | width, height, physical size per pixel (µm per px) at this resolution |
| **Device caps** | maximum texture side, memory budget |
| **Planner** | local reaches → halo; wide kernels → fields; tile size; diagnostics |
| **Tile** | core rectangle (written) and read rectangle (core plus halo, clipped to the frame) |
| **Global field** | downsample factor, size, residual blur; computed once per evaluation |
| **Tile executor** | evaluates a tile's read rectangle, writes its core, samples fields by frame coordinates |

## Collaborations

1. The engine collects spatial kernels from the plan of the target (Chapter 7) with the frame's µm per pixel.
2. The planner converts each reach to pixels and splits kernels into local and wide.
3. Local reaches are summed per chain; the maximum over chains, plus one pixel for bilinear safety, rounded up to an
   alignment, is the halo.
4. Wide kernels are grouped into fields; each field gets a power-of-two downsample and a residual blur so the total
   variance equals the kernel's.
5. The planner picks the largest power-of-two tile whose haloed footprint fits half the memory budget and emits the
   tiles; the executor runs fields first, then tiles in any order.

## Sketch

```text
value Kernel: id, sigmaUm or radiusPx, chain = "main", fieldOk, field
value Tile: core, read

planTiles(frame, kernels, caps, haloBudget = 32 px) → (tile, halo, tiles, fields, diagnostics):
  local, wide ← [], []
  for k in kernels:
    r ← radiusPx(k, frame.umPerPx)                      -- 3σ in pixels at this resolution
    if r ≤ haloBudget or not k.fieldOk: local ← local ++ [(k, r)] else: wide ← wide ++ [k]
  reach ← max over chains c of (sum of r for (k, r) in local where k.chain = c)
  halo ← roundUp(1 + reach, 8)                          -- +1 for bilinear sampling, aligned

  fields ← for each group g of wide kernels (by k.field):
    σ ← min σpx over g;  s ← largest power of two with σ / s ≥ 2 (and frame / s within texture
        limits)
    residual ← sqrt(σ² − downsampleVariance(s) − upsampleVariance(s)) / s
    Field(g, downsample: s, residualSigma: residual)

  T ← largest power of two ≤ caps.maxTexture with (T + 2·halo)² × bytesPerPixel ≤ caps.budget / 2
  if any local non-field kernel has r > T / 4: diagnostics ++ refuse("halo-too-wide", k,
      fix: "larger budget or a field")
  tiles ← for each grid cell: Tile(core: cell, read: clip(cell grown by halo, frame))
  return (T, halo, tiles, fields, diagnostics)

-- in use: export
plan ← planTiles(frame(6000, 4000, umPerPx: 6), kernels(graph), caps(device))
for f in plan.fields: compute(f)
for t in plan.tiles: write(t.core, evaluate(region: t.read, fields: plan.fields))
```

## Implementation notes

1. **Declare reach in the medium's units.** The running example's film kernels state σ in micrometres on the film and
   convert with the frame's µm per pixel, so grain and halation look the same at 640 px and at 6,000 px. Its one
   digital kernel stated in pixels (clarity) does not, and full-resolution export has to rescale it.
2. **Chains add, branches take the maximum.** Two neighbourhood passes in sequence need the sum of their reaches (a pass
   reading 2 px of a pass that read 2 px needs 4); independent branches need only the larger. The `chain` label carries
   this without a dependency analysis.
3. **Add one pixel and align.** The running example adds one pixel for bilinear sampling safety and rounds the halo
   up to a multiple of 8, so read rectangles stay aligned for the GPU.
4. **Fields need variance bookkeeping.** Downsampling by s with a box filter and upsampling bilinearly each add blur.
   The residual σ is what remains after subtracting their variances, so the composition equals the requested kernel.
5. **Pick the downsample from the narrowest kernel in a field group.** Kernels sharing a field (halation's three
   bounces in the running example) share one downsample, chosen so the narrowest stays at least two pixels wide.
6. **Some fields have a statistical size, not a σ.** A field used for statistics (a mean exposure, a histogram) is
   computed at a fixed long side; the running example also plans a separate 640 px statistics image during tiled
   export, so measurements match the interactive path (Chapter 6, note on pinned measurement).
7. **Refuse, do not degrade silently.** When a non-field kernel reads more than a quarter of a tile, or a haloed tile
   exceeds half the budget, the planner returns a diagnostic with a fix instead of producing a plan that thrashes.
8. **The pyramid shortens arithmetic, not the apron.** Editor lab's book shows a σ = 100 blur as six decimations plus
   an 11-tap kernel, from 1,202 reads per pixel to about 8; but in a tiled engine it still needs about 300 px of input
   around each tile. Fields avoid the apron by computing the wide kernel on the whole (small) image.
9. **Tile size is workload-dependent.** Editor lab measured a brush stroke fastest at 64 px tiles (21.2 ms against
   123 ms at 256 px) and a blur sweep fastest at 256 px (235 ms against 828 ms at 64 px). Export favours large tiles;
   interactive local edits favour small ones. Let the planner take a target size for each use.

## Variations

- **Demand-driven regions.** Each operation computes the input region it needs for a requested output region, and
  requests propagate backwards (libvips, GEGL); exact per operation, no global halo, more bookkeeping.
- **Aprons from cached tiles.** Store every layer's tiles and assemble a tile's apron from cached neighbours (Editor
  lab); the overlap costs reads, not recomputation, at the price of memory per layer.
- **Two tile grids.** Small tiles for local, painted content and 2 × 2 blocks of them above long-reach operations; adapts
  to the workload, complicates the cache.
- **Mipmap fields.** Compute wide kernels on a mipmap chain of the input; reuses one pyramid for many fields, coarser
  control of the residual.

## Consequences

- \+ Seamless tiled results with halos no larger than the actual chains need.
- \+ Wide smooth kernels cost one small pass instead of a huge halo per tile.
- \+ Operations look the same at every resolution because reaches are physical.
- − Every neighbourhood operation must declare its reach truthfully; an understated reach produces seams.
- − Fields are approximations; they need parity tests against the exact kernel (Chapter 3).
- − The plan depends on device limits, so the same export may tile differently on two machines.

## Known uses

- **darktable** tiles a module only when memory is short, from module-declared factors, overhead and overlap, and
  skips tiling when the overlap would dominate.
- **libvips** evaluates demand-driven regions: each operation asks its inputs for the region it needs.
- **GEGL** stores images as tiled buffers and asks operations for the region of interest they need.
- **Halide** computes overlapping tiles of producer stages inside consumer tiles ("tiles with overlap").
- **Game engines' bloom** (for example in Unreal Engine) blurs a chain of downsampled images instead of convolving at
  full resolution.

## Related chapters

- [Chapter 7 · Barrier-Cut Fusion](07-barrier-cut-fusion.md) supplies the spatial barriers whose reaches are planned.
- [Chapter 2 · Unit-Tagged Parameter Catalogue](02-unit-tagged-parameter-catalogue.md) records reach units.
- [Chapter 9 · Vector Edit Document](09-vector-edit-document.md) stores radii in units that survive resolution changes.
- [Chapter 6 · Tabulated Preview, Exact Export](06-tabulated-preview-exact-export.md) pins measurement resolution.
- GoF: **Strategy** (local halo or global field per kernel), **Builder** (the planner assembling a tile plan).
