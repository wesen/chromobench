# Chapter 8 · Reach-Declared Tiling ★

*Every neighbourhood operation declares how far it reads, in physical units; a planner turns those reaches into the
cheapest exact way to compute the image in bounded memory, and approximates only the smooth kernels too wide for it.*

## Intent

Process images larger than memory or the device in pieces, without seams and without hand-tuning overlaps.
Operations state their reach in units of the physical image; the planner converts reaches to pixels at the current
resolution, combines them over the graph, and chooses a route: the whole frame, haloed tiles, or streaming through
small buffers. Smooth kernels too wide for any exact route are computed once at reduced resolution, as fields every
tile samples.

## Also known as

Tiling with overlap; apron or halo planning; region-of-interest propagation; demand-driven regions; global fields.

## Motivation

The running example (chromobench, a browser darkroom with a WebGPU engine) exports a 24-megapixel print. A
6,000 × 4,000 image in four 32-bit floats is 384 MB, against a default limit of 128 MiB per storage binding, so the
export must be split. Its film model reads neighbourhoods of very different reach: grain over a few micrometres, a
density mask's blur over tens, halation over millimetres. Four naive approaches fail.

1. **Tiles without halos** show seams wherever a blur crosses a tile edge.
2. **One fixed halo** is either too small for halation or so large that every tile mostly recomputes its neighbours:
   for a reach of 70 px, a 64 px tile reads ten times the pixels it writes.
3. **Reaches in pixels** break when resolution changes: grain right at 640 px is four times too large at 2,560 px.
4. **Huge halos for huge kernels** cannot fit: a Gaussian of σ = 100 px needs about 300 px of input around every
   tile.

Gigapixel image servers, raster GIS focal operations and out-of-core inference face the same problem.

## Problem

**How do you compute an image in bounded memory, for operations that read their neighbourhoods, so results are
seamless and exact where they can be, overlap is no larger than needed, and very wide kernels still complete?**

## Forces

- **Seamless against cheap.** A halo of the full reach guarantees identical results; the overlap costs ((T + 2m)/T)²
  reads per written pixel.
- **Small tiles against large tiles.** Small tiles suit local edits and tight memory; large tiles amortise halos.
- **Physical against pixel units.** Physical reaches are correct at any resolution; pixel reaches are what the
  executor needs.
- **Exact against bounded.** Exact routes exist for more cases than tiles cover; approximations are cheap but must
  state their error.
- **Device habits against portability.** Power-of-two tiles and aligned halos suit a GPU and add reads on a CPU.

## Solution

**Therefore: let every neighbourhood operation declare, in one place, its reach in a resolution-free unit
(micrometres on the medium, or document pixels) and whether its result is smooth enough to compute at reduced
resolution. At plan time convert reaches to pixels for the target frame and combine them over the graph: they add
along a path and take the maximum across branches. Take the first exact route that fits the budget: the whole frame
in one buffer; haloed tiles on the grid that minimises total reads; separable passes streamed through small row
buffers. Only when none fits, approximate the widest smooth kernels: split each into a local part the halo can carry
and a residual computed once as a field at reduced resolution, with pre-blur, decimation, reduced kernel and
upsampling variances adding up to the requested one, and borders treated as the exact kernel treats them. A field is
an extra input that tiles sample by frame coordinates, not a replacement for the image, so a consumer can read it
beside full-resolution values. Report the route and its error bound; refuse only when no route meets the contract.**

## Applicability

Use it when:

- images exceed device or memory limits, or exports must run in bounded memory;
- the pipeline mixes neighbourhood operations of very different reach;
- resolution varies (previews, exports, devices) and operations must look the same at each.

Do not use it when:

- images always fit in memory and on the device (screen-sized previews);
- wide kernels are not smooth (an edge-preserving filter); a field computed at low resolution would blur edges;
- operations change the pixel grid mid-pipeline (resampling, warps): reaches no longer add in one frame; map regions
  per operation instead (demand-driven regions, under Variations).

## Structure

| Participant | Responsibility |
|---|---|
| **Kernel declaration** | reach (σ or radius) in µm or document px, field-capable, field group, region evaluation |
| **Frame** | width, height, physical size per pixel (µm per px) at this resolution |
| **Budget** | the largest buffer allowed; device limits where they apply |
| **Planner** | reaches → halo; route; tile grid; local and field parts of wide kernels; error bound |
| **Tile** | core rectangle (written) and read rectangle (core plus halo, clipped to the frame) |
| **Field** | kernel part, scale, pre-blur, residual, border ring; computed once, sampled by frame coordinates |
| **Executor** | fields in dependency order, then tiles in any order, each core written once |

## Collaborations

1. The engine collects the neighbourhood operations of the target's plan (Chapter 7) and the frame's µm per pixel.
2. The planner converts reaches to pixels and combines them over the graph.
3. It keeps the first exact route that fits: whole frame, haloed tiles on a read-minimising grid, streaming.
4. Otherwise it moves the widest smooth kernels, in part or whole, into fields until the halo fits, and records the
   error bound.
5. The executor computes the fields, then the tiles; each tile reads its rectangle of the source and samples fields.

## Sketch

```text
value Kernel: id, sigma (µm or document px), fieldOk       -- part of the op's one declaration
value Tile: core, read
value Field: kernel, scale, preblur, residual, border      -- an input of tiles, never a new source

plan(graph, frame, budget) → Plan:
  for k in kernels(graph): k.r ← ceil(3 × sigmaPx(k, frame.umPerPx))   -- pixels at this frame
  halo ← max over paths p of (sum of k.r for k on p)        -- along a path add; across, maximum
  if frame.pixels ≤ budget: return Whole(graph)
  if tileFits(halo, budget): return Tiled(graph, minReads(frame, halo, budget), fields: [])
  if streamable(graph, frame, budget): return Streamed(graph)   -- exact: rows of 2r + 1, no halo
  fields ← []
  while not tileFits(halo, budget):                         -- approximate only what does not fit
    k ← widest field-capable kernel with k.r > 0, or refuse("no-route", fix: "a larger budget")
    σl ← the largest local σ the halo can carry; σf ← sqrt(k.σ² − σl²)   -- variances add
    s ← finest affordable integer scale, s ≤ σf / 2         -- chunked if the reduced image is large
    residual ← sqrt(σf² − var(preblur) − var(decimate, s) − var(upsample, s)) / s
    fields ← fields ++ [Field(k, s, preblur, residual, border: clamped ring)]
    k.σ ← σl; recompute k.r and halo                        -- k now blurs the sampled field
  return Tiled(graph, minReads(frame, halo, budget), fields, error: bound(fields))

minReads(frame, halo, budget) → tiles:                      -- not "the largest power of two"
  among grids (nx, ny) whose tiles with halo fit the budget, split evenly (no slivers),
  take the one with the least Σ readW × readH

run(plan, img):
  for f in plan.fields, inputs first:                    -- input evaluated piecewise at full size
    f.image ← blur(decimate(evaluate(input of f), f.scale), f.residual)
  for t in plan.tiles: write(t.core, evaluate(region: t.read, source: img, fields: plan.fields))

-- in use: a sharpen in a tile reads its centre and a field: v + a × (v − sample(field, x, y))
```

## Implementation notes

1. **Declare reach in the medium's units.** The running example's film kernels state σ in micrometres on the film,
   so grain and halation look the same at 640 px and at 6,000 px; its one kernel stated in pixels (clarity) has to
   be rescaled for full-resolution export.
2. **Keep an operation's neighbourhood in its declaration.** Reach, field capability and region evaluation belong
   to the operation (Chapter 2); when planner, streaming path and tile compiler each test "is this a blur?", a new
   neighbourhood operation is an edit in five places.
3. **Paths add, branches take the maximum.** Two neighbourhood passes in sequence need the sum of their reaches (a
   pass reading 2 px of a pass that read 2 px needs 4); independent branches need only the larger. Plan over the
   graph, not a list, so two-input operations (a sharpen, a blend) are planned correctly.
4. **Try the exact routes before approximating.** If the frame fits one buffer, use it, even when no tile could carry
   the halo. A separable blur streams exactly with no halo: horizontal pass row by row, vertical pass through a ring
   of 2r + 1 rows or in full-width strips. Each is exact where a field would be approximate.
5. **Choose the grid by minimising reads.** Compare candidate grids by Σ readW × readH and take the least, split
   evenly so no sliver tile pays a whole halo. Tile size also depends on the workload: Editor lab (a browser photo
   editor with a tiled CPU engine) found a brush stroke fastest at 64 px tiles and a blur sweep at 256 px, several
   times faster than at the other size, so let each use pass a target.
6. **A field is an input, not a replacement.** If the field replaces the image for all later stages, an operation
   that needs its neighbourhood and its own centre (sharpen: v + a(v − blur v)) cannot be expressed, because v is
   gone. Make the field an extra input that tiles sample beside the full-resolution values. Compute it from its input
   at full resolution, decimated as produced; decimating before a nonlinear step gives a different picture.
7. **Fields need variance bookkeeping.** Gaussian variances add, so a wide σ splits into a local part, exact in the
   halo, and a field: σ² = σlocal² + σfield². The field's anti-alias pre-blur, decimation and bilinear upsampling
   each add blur; its reduced kernel is what remains after subtracting their variances. Kernels sharing a field
   group share one scale, chosen so the narrowest stays at least two reduced pixels wide.
8. **Borders dominate the error of wide fields.** The exact kernel clamps (or mirrors) at the frame edge, and a
   kernel of hundreds of pixels sees that edge from deep inside the image; a reduced image with its own clamping is
   wrong there first. Pad it with a ring of edge values as wide as its kernel, or add exact edge corrections (the
   clamped mass is a one-dimensional convolution along each border).
9. **Use integer scales and chunked fields on a CPU.** The finest affordable integer decimation has the least
   error; a reduced image larger than one buffer is stored in budget-sized chunks.
10. **Complete, report, and refuse only when nothing fits.** A planner that refuses whenever a kernel exceeds a
   fraction of a tile breaks a contract that must complete. Pick the cheapest route that meets it, by a cost model
   (an exact plan that reads far too much may lose to a field); record route and error bound, and refuse with a fix
   only when no route exists.
11. **Test against an independent reference, with laws.** Compare with a direct two-dimensional reference, not the
   engine's own whole-image path (Chapter 3). Laws: cores cover the frame exactly once, buffers stay within budget, a
   constant image stays constant on every route, exact routes match to rounding, approximate ones stay within their
   bounds on stripes, steps and noise, and a halo one pixel short produces seams.

## Variations

- **GPU tiling.** The running example on WebGPU: power-of-two tiles in half the budget (room to double-buffer), halos
  with one extra pixel for bilinear sampling rounded up to a multiple of 8, power-of-two decimation. Right for
  texture limits and alignment; on a CPU it only adds reads.
- **Demand-driven regions.** Each operation maps a requested output region to the input region it needs, backwards
  through the graph (libvips, GEGL). Exact per operation, handles grid changes; more bookkeeping.
- **One reduced image for the whole chain.** When anything is too wide, run the whole chain on one padded reduced
  image. The smallest design for loose tolerances; it approximates narrow kernels and pointwise steps too.
- **Aprons from cached tiles.** Assemble a tile's apron from cached neighbours (Editor lab); overlap costs reads,
  not recomputation, at the price of memory per layer.
- **Mipmap fields.** One pyramid serves many fields. A pyramid shortens arithmetic, not the apron: Editor lab's
  σ = 100 blur drops from 1,202 reads per pixel to about 8, but tiles still need 300 px around them.
- **Statistical fields.** A field for statistics (a mean exposure, a histogram) has a fixed long side, not a σ; the
  running example computes a 640 px statistics image during export to match the interactive path (Chapter 6).

## Consequences

- \+ Seamless results, exact wherever an exact route fits, with halos no larger than the paths need.
- \+ Wide smooth kernels cost one small pass instead of a huge halo per tile, with a stated error.
- \+ Operations look the same at every resolution because reaches are physical.
- − Every neighbourhood operation must declare its reach truthfully; an understated reach produces seams.
- − Fields are approximations; they need parity tests against the exact kernel (Chapter 3).
- − The plan depends on budget and device, so one export may be computed differently on two machines.

## Known uses

- **darktable** tiles a module only when memory is short, from module-declared factors and overlap.
- **libvips** evaluates demand-driven regions, streaming through small buffers.
- **GEGL** stores images as tiled buffers and asks operations for the region of interest they need.
- **Halide** computes producers in overlapping tiles inside consumer tiles, or as sliding windows.
- **Game engines' bloom** (Unreal Engine, for example) blurs a chain of downsampled images.

## Validation

Here the hidden tests separated the runs: all four agents with this chapter passed 9 of 9, both controls failed
the wide-blur tests, and the blind review ranked every chapter run above the controls. The review also found the
chapter refusing where it had to complete, carrying GPU habits into a CPU task, and missing exact streaming,
read-minimising grids and border handling, which several runs found; see `docs/patterns/experiments/RESULTS.md`.

## Related chapters

- [Chapter 7 · Barrier-Cut Fusion](07-barrier-cut-fusion.md) supplies the spatial barriers whose reaches are planned.
- [Chapter 2 · Unit-Tagged Parameter Catalogue](02-unit-tagged-parameter-catalogue.md) records reach units.
- [Chapter 3 · Reference Oracle with Negative Controls](03-reference-oracle.md) checks fields against exact kernels.
- [Chapter 9 · Vector Edit Document](09-vector-edit-document.md) stores radii in units that survive resolution changes.
- [Chapter 6 · Tabulated Preview, Exact Export](06-tabulated-preview-exact-export.md) pins measurement resolution.
- GoF: **Strategy** (whole, tiled, streamed or field per kernel), **Builder** (the planner assembling a plan).
