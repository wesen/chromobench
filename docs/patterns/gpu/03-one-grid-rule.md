# Chapter 3 · One Grid Rule

*One sampling convention, in exact arithmetic, for every engine and every grid, so a region, a preview and a tile
are each an exact sampling of the full-resolution result.*

**★★** We believe any good solution to this problem has this shape.

## Intent

Fix once how an output pixel of any grid (a preview, a crop, a tile, a thumbnail) relates to the full-resolution
image: where its centre lies, which source pixel it reads, and where position-dependent quantities are evaluated.
Write it as one integer formula that every engine, stage and test uses, so results on different grids compare
value for value and a fast engine can be checked against a slow one exactly.

## Also known as

Pixel-centre convention; half-pixel offset; coordinate transformation mode; sample-consistent previews; pixel is
area versus pixel is point.

## Motivation

The running example renders one image on many grids: the whole 6,000 × 4,000 image of a 24-megapixel raw file
for export, any width the window allows for a preview, regions for zoom, 160-pixel thumbnails, tiles. Three
engines compute them: a reference in 64-bit floats (f64), a mock for tests, and a WebGPU engine in 32-bit floats
(f32). All three implement one rule: output pixel p of an n-pixel grid over a region reads image pixel
fp = region.x + ⌊(p + ½)·region.w / n⌋. Three failures show what the rule has to cover.

1. **A stage that did not know the rule.** The reference engine's 717 × 478 preview of a 1,024 × 683 test image
   took 4.2 s per slider step. Every print stage ran on the preview grid, but the last stage, which crops and turns
   the picture, could not map a grid onto its input, so it recomputed the whole chain at full resolution and
   sampled the result. Once it mapped the output grid to a grid of its input, the step took 1.37 s, and every
   stored reference image stayed bit-identical.
2. **Two origins.** A region rendered at half scale was compared with an engine that read the same region from a
   full-size copy of the source on the GPU. The first comparison differed in 32,302 of 32,886 samples, by up to
   0.64. The comparison engine had read the full-size copy as if its first texel were the region's corner; a
   full-size copy's first texel is the image's corner.
3. **The same formula in different arithmetic.** The reference computes ⌊(p + ½)·w / n⌋ in f64. The GPU kernel
   multiplies p + ½ by the ratio w / n rounded to f32. When an output pixel's centre falls exactly on the boundary
   between two source pixels (a *tie*), the f32 product can land just below the integer, and the floor picks the
   left pixel. Measured for this chapter: for a 6,000-pixel-wide image, 791 of the 5,901 output widths from 100 to
   6,000 have at least one such column. At 135 pixels wide, column 22 reads source pixel 999 on the GPU and 1,000
   in the reference. The parity tests' scales (0.5, 0.4, 0.375, 0.25) cannot show it: 0.375 makes 750 ties in a
   6,000-pixel row, and all pass only because f32(8/3) happens to round up.

Geographic rasters meet the same problem: a cell's coordinate names either its corner or its centre (GeoTIFF
records which), and two files of one terrain end up half a cell apart. So do neural networks: a model trained with
one framework's resize and deployed with another's sees its inputs shifted by a fraction of a pixel, which is why
the ONNX resize operator names five coordinate conventions.

## Problem

**How do grids of different sizes, offsets and engines agree on which part of the image each output pixel stands
for, exactly enough that their results can be compared value for value?**

## Forces

- **Exact samples against good-looking previews.** A nearest sample is a value of the full-resolution result, so it
  can be checked bit for bit; an area average hides aliasing but is no value of that result.
- **One formula against each device's natural arithmetic.** Integer arithmetic is exact on every device; a GPU
  kernel naturally computes coordinates in f32 from a precomputed ratio.
- **Pixel centres against pixel corners.** Centres make scaling symmetric and crops consistent; corners make index
  arithmetic shorter and are what many libraries chose first.
- **Pixel units against physical units.** Kernels index in pixels; a size in pixels means something different on
  every grid.
- **Sample consistency against statistical consistency for noise.** Noise keyed to full-resolution positions makes
  tiles exact; on a reduced grid it either aliases (sampled) or becomes a different pattern (drawn anew).

## Solution

**Therefore: give every grid one map from output pixels to the full-resolution image, defined in exact integer
arithmetic, and let every engine, stage and test use that map and no other. A grid is a region of the image and an
output size; output pixel p has its centre at region.x + (p + ½)·region.w / n, with pixel centres at half-integers,
and reads image pixel fp = region.x + ⌊(2p + 1)·region.w / 2n⌋. Evaluate anything that depends on position (a
gradient, a disc, a noise key) at that sample's own centre fp + ½, and convert physical sizes with the grid's own
scale. Then every value on every grid is a value of the full-resolution result at a known pixel; stages that
commute with sampling (pointwise operations, permutations of pixels) run on the grid exactly, and stages that read
neighbours either run at full resolution and are sampled or are declared approximate with a measured error.**

## Applicability

Use it when:

- several engines or code paths compute the same image on different grids, and one of them is the reference;
- previews, regions and tiles must be comparable with the full result, or stand in for it in a cache;
- geometry (masks, retouching, crops, noise keys) is defined in continuous coordinates.

Do not use it when:

- the output exists at one resolution only and no other grid is compared with it;
- the operation's point is its resampling filter (a high-quality downscale): fix the centres by this rule, but
  check the values against a filtered reference;
- values live at points, not over areas (table nodes): use a corner-aligned map (Variations), kept apart by type.

## Structure

| Participant | Responsibility |
| --- | --- |
| **Full-resolution image** | the lattice of W × H pixels; pixel i covers [i, i + 1) and has its centre at i + ½ |
| **Grid** | an integer region of the image and an output size n × m |
| **Grid map** | output pixel → image sample fp (an integer) and its centre fp + ½, in integer arithmetic |
| **Sampler** | reads at fp (nearest), or bilinearly at a continuous position with centres at i + ½ |
| **Position-dependent operation** | evaluates at fp + ½ in image units; sizes from physical units and grid scale |
| **Stage planner** | per stage: on the grid, at full resolution then sampled, or approximate on the grid |
| **Sample-consistency law** | out_G(p) = F(fp_G(p)) for every grid G and every output pixel p |

In a time-series database: the raw sample stream, a query's window and bucket count, the rule picking each bucket's
representative sample, and the law that a zoomed query's buckets are raw samples of the whole stream.

## Collaborations

1. A request names a grid: a region and an output size.
2. The planner walks the stages from the output back. Pointwise stages take the grid; a permutation of pixels
   maps it to a grid of its input; a stage that reads neighbours runs at full resolution over its region grown by
   its reach, then is sampled; a stage declared approximate runs on the grid with sizes scaled.
3. Every engine computes fp with the shared integer function and evaluates positions at fp + ½.
4. The tests evaluate each node on the full grid and on many others, and check the law.

## Sketch

```text
value Grid: x, y, w, h, n, m          -- a region of the full-resolution image (integer pixels), output n × m
value Stage: kind, reach, inputGrid, error
  -- kind ∈ { pointwise, permutation, neighbourhood, approximate }
  -- inputGrid(g): for a permutation, the grid of its input that output grid g reads
  -- reach: pixels read beyond each output pixel; error: measured bound for approximate stages

floorDiv(a, b) → the integer quotient of a by b, rounded down        -- integers only

sampleX(g, p) → g.x + floorDiv((2p + 1) · g.w, 2 · g.n)
sampleY(g, q) → g.y + floorDiv((2q + 1) · g.h, 2 · g.m)
centre(g, p, q) → (sampleX(g, p) + 0.5, sampleY(g, q) + 0.5)          -- image coordinates
pitch(g, umPerPx) → umPerPx · g.w / g.n          -- micrometres per output pixel on this grid

lerp(a, b, t) → a + t · (b − a)
bilinear(img, x, y):                             -- centres at i + ½; the edge texel holds out to the border
  fx ← clamp(x, 0.5, img.w − 0.5) − 0.5 ; fy ← clamp(y, 0.5, img.h − 0.5) − 0.5
  x0 ← floor(fx) ; y0 ← floor(fy) ; tx ← fx − x0 ; ty ← fy − y0
  x1 ← min(x0 + 1, img.w − 1) ; y1 ← min(y0 + 1, img.h − 1)
  return lerp(lerp(img[x0, y0], img[x1, y0], tx), lerp(img[x0, y1], img[x1, y1], tx), ty)

grow(g, r) → the region of g enlarged by r pixels on each side, clipped to the image, at scale 1

place(stage, g) → match stage.kind:
  pointwise     → OnGrid(g)                          -- commutes with sampling, bit for bit
  permutation   → OnGrid(stage.inputGrid(g))         -- a grid maps to a grid
  neighbourhood → FullThenSample(region: grow(g, stage.reach), grid: g)   -- exact
  approximate   → OnGridScaled(g, bound: stage.error)            -- tested against FullThenSample

kernel gradientMask(g, a, b) over g:                 -- a position-dependent operation
  (X, Y) ← centre(g, p, q)                           -- (p, q): this invocation's output pixel
  out[p, q] ← clamp(1 − dot((X, Y) − a, b − a) / dot(b − a, b − a), 0, 1)

law sampleConsistency(engine, node, g):              -- for plans without approximate stages; W × H: full size
  full ← engine.evaluate(node, Grid(0, 0, W, H, W, H))
  part ← engine.evaluate(node, g)
  for p in 0 .. g.n − 1, q in 0 .. g.m − 1:
    assert part[p, q] = full[sampleX(g, p), sampleY(g, q)]          -- equality, not tolerance

-- in use: a thumbnail of a 6,000 × 4,000 image, checked against the export at every column, ties included
for engine in [reference, gpu]: sampleConsistency(engine, print, Grid(0, 0, 6000, 4000, 135, 90))
```

## Implementation notes

1. **Compute the map in integers.** In 32-bit unsigned integers, ⌊(2p + 1)·w / 2n⌋ is exact for any n·w below 2³¹.
   In floating point, the floor of a correctly rounded quotient is exact when 2n·w < 2ᵗ, with t = 24 significand
   bits in f32 and 53 in f64: a non-integer quotient lies at least 1/2n from an integer, and the rounding error is
   below half an ulp of a number smaller than w. The bound is sufficient, not necessary: for a 6,000-pixel image it
   fails from n = 1,399, and the first f32-divide mismatch appears at n = 4,109. Multiplying by a rounded
   reciprocal has no such bound: at a tie the exact answer is an integer, and any downward error flips the floor.
   This is chromobench's open debt: its GPU pointwise and retouch kernels multiply by an f32 ratio, its
   straightening kernel divides in f32, and the reference divides in f64.
2. **Copying the arithmetic is not sharing the rule.** chromobench keeps reduced copies of each source on the GPU
   (proxies). The host reproduces the shader's f32 product exactly (the product of two f32 values is exact in
   f64, so one rounding to f32 gives the device's result). Proxies match the full-size texture bit for bit on a
   software adapter and on Apple's Metal, and the textures kept after opening two 24-megapixel raw files fell from
   328 MB to 47 MB. But the proxy agrees with the GPU by sharing its rounding error; the reference still disagrees
   at ties. In integers, all three would agree.
3. **Pixel centres at half-integers, everywhere.** Pixel i covers [i, i + 1). A 2:1 reduction puts output centre 0.5
   on the boundary between pixels 0 and 1, and the floor breaks every such tie the same way. A bilinear read
   subtracts ½ before the floor and clamps the position to [½, W − ½]. Direct3D 9 put pixel centres at integers
   and texel centres at half-integers, and programs drew textures half a pixel off; chromobench keeps a table
   lookup without the half-texel offset as a test that must fail
   ([Tabulated Preview](../06-tabulated-preview-exact-export.md)).
4. **Evaluate positions at the sample's centre.** chromobench evaluates gradient and elliptical masks at fp + ½, and
   heals and clones circular spots at full-resolution centres, reading the source disc bilinearly. A masked preview
   is then the full result sampled, bit for bit. Editor lab, whose previews come from an averaged pyramid,
   evaluates at the centre of the coarse pixel's block, (x + ½)·2ᴸ. Each matches its sampler; mixed, they
   disagree by half a full-resolution pixel.
5. **Know which stages commute with sampling.** A pointwise f satisfies S(f(x)) = f(S(x)) exactly for a sampling S,
   if its arithmetic does not depend on the grid. A crop and the eight orientations (flips, quarter turns,
   transposes) are permutations in which each output axis reads one input axis, so they map a grid to a grid (the
   4.2 s fix). An arbitrary rotation is not; chromobench renders its input at full resolution and reads it
   bilinearly at the grid's samples. Stages that read neighbours do not commute: the reference computes them at
   full resolution and samples; the GPU's previews run them on the reduced grid, an approximation its tile test
   shows to differ in every case but healing.
6. **Regions are crops only at scale 1.** At scale s, a region's grid is part of the whole image's grid only when
   the steps match and the offset is a multiple of the step. What holds at every scale is the law. Test that.
7. **One coordinate system per stored image.** Every texture records the region of the image it holds; a reader
   converts image to texel coordinates by subtracting that origin, and in no other way. The two-origins failure
   was a full-size texture read as if it held the region.
8. **Physical sizes and noise follow the grid.** chromobench states blur sizes in micrometres on the film (the
   density mask, a contrast mask made from an unsharp copy of the negative; halation, the glow around highlights
   from light reflected in the film base) and in millimetres on the print (clarity), converted with each grid's
   pitch: micrometres per image pixel times w / n. Film grain hashes the full-resolution position, so tiles and
   regions at scale 1 reproduce it exactly; previews draw grain anew on their own grid, variance scaled by pixel
   area. That is statistical, not sample, consistency: sampled full-resolution grain would look far coarser than
   the print.
9. **Know what reduction loses.** Nearest previews alias fine patterns. Averaged pyramids do not, but break the law
   for nonlinear stages. Editor lab measured level-2 renders against full renders averaged down: a Gaussian blur
   of σ = 6 px was off by at most 8 of 255 steps, a threshold by up to 223 steps on 6.4 % of pixels. Average
   premultiplied values (colour weighted by coverage), or transparent colours leak into edges. chromobench chose
   nearest proxies to keep parity bit-exact, and recorded averaged levels as a proposal that would change pixels.
10. **Test with ties and awkward sizes.** Scales whose ratio is a power of two, or rounds up in f32, cannot reveal a
    broken map. Sweep every output width of a small image, add widths whose f32 ratio rounds down, compare each
    engine's fp with the integer rule, and keep a map without the ½ as a negative control.

## Variations

- **Area-consistent grids.** An output pixel averages its footprint, as in mipmaps and pyramids. Previews look
  right; the law becomes "equals the full result averaged down", exact only for linear stages.
- **Corner-aligned maps.** First and last centres map to first and last centres: x = p·(w − 1)/(n − 1). Right for
  values that live at points (table nodes, heights); crops are no longer consistent. PyTorch calls it
  `align_corners=True`; chromobench's lookup tables use it.
- **Filtered resampling at centres.** Bilinear or Lanczos at x = (p + ½)·w / n − ½: the same centres, filtered
  values, checked against a reference with the same filter.
- **Power-of-two scales only.** At scales 2⁻ᴸ, fp = p·2ᴸ + 2ᴸ⁻¹ for L ≥ 1: no ties, exact in any arithmetic. The
  display scales the last step, so previews rarely match the window.

## Consequences

- \+ Every value on every grid is a value of the full-resolution result at a computable pixel, so previews, regions
  and tiles compare exactly with the export.
- \+ Pointwise stages and permutations run at the grid's cost: 4.2 s became 1.37 s with identical output.
- \+ Reduced copies and cached grid results are legitimate stand-ins for the full image (Chapter 7).
- − Nearest previews alias fine detail and noise, and look worse than filtered ones.
- − Every engine must implement the same integer arithmetic, including GPU kernels that would naturally use floats.
- − Neighbourhood stages on reduced grids stay approximations; the rule makes them visible, not exact.

## Known uses

- **Direct3D 10** moved pixel centres to half-integers, removing Direct3D 9's half-pixel offset between pixels and
  texels.
- **OpenGL and Vulkan** rasterise at fragment centres (x + ½, y + ½); GLSL's `pixel_center_integer` qualifier serves
  code written for the other convention. Nearest texture filtering selects texel ⌊u·N⌋, this chapter's rule when
  u = (p + ½)/n.
- **Halide** (Ragan-Kelley et al., PLDI 2013) defines functions over an unbounded integer domain, so a realised
  region equals the crop of a larger realisation by construction.
- **PyTorch**'s `F.interpolate` made half-pixel centres (`align_corners=False`) the default for linear modes in
  0.4.0; its `nearest` mode omits the offset, and `nearest-exact` was added to match PIL and scikit-image.
- **OpenCV**'s linear resize uses half-pixel centres; `INTER_NEAREST` does not, and `INTER_NEAREST_EXACT` was added.
- **ONNX** Resize names the conventions (`half_pixel`, `pytorch_half_pixel`, `align_corners`, `asymmetric`,
  `tf_crop_and_resize`).
- **GeoTIFF** records `RasterPixelIsArea` or `RasterPixelIsPoint`; **ITK** places the origin at the first pixel's
  centre.

## Related chapters

- [Chapter 4 · Wide Kernels at Constant Cost](04-wide-kernels-at-constant-cost.md) reads reduced-resolution fields
  through image coordinates by this rule.
- [Chapter 2 · Precision Ladder](02-precision-ladder.md): for the grid map, the measured answer is "integers".
- [Chapter 7 · Budgeted Residency](07-budgeted-residency.md) keeps grid-sized proxies instead of full textures.
- [Chapter 9 · Content-Keyed, Cost-Aware Cache](09-content-keyed-cost-aware-cache.md) keys results by grid.
- Image engine volume: [Tabulated Preview, Exact Export](../06-tabulated-preview-exact-export.md),
  [Reach-Declared Tiling](../08-reach-declared-tiling.md), [Reference Oracle](../03-reference-oracle.md); modular
  volume: [Work in Small Slices](../modular/06-work-in-small-slices.md).
- GoF: **Strategy** (nearest, bilinear and area samplers behind one map); outside GoF, a grid is a **Value Object**
  (Evans), compared by value and usable as a cache key.

## Exercises

1. *Implement and measure.* Write the grid map four ways: integer, f64 multiply then divide, f32 multiply by a
   rounded reciprocal, f32 divide (round after every operation). For every w from 100 to 8,192 and n ≤ w, count
   columns where each float version differs from the integer one, and find the smallest n·w with an f32-divide
   mismatch. Then write the sample-consistency law for a toy pipeline (exposure, a gradient mask, a box blur) whose
   fast path runs pointwise stages on the grid; show that the law fails when the mask moves to the output pixel's
   own centre.
2. *Analyse.* (a) Prove ⌊fl(a / b)⌋ = ⌊a / b⌋ for a = (2p + 1)·w, b = 2n and 2n·w < 2ᵗ (t significand bits); give
   a w, n, p where (p + ½)·fl(w / n) in f32 floors below the true quotient. (b) Prove that a crop followed by any
   of the eight orientations maps a sample grid to a sample grid, and that a 10° rotation does not.
3. *Another domain.* A segmentation network trained with `align_corners=True` upsampling is deployed with
   half-pixel centres. For 4× upsampling from 64 to 256 pixels, find the largest disagreement in source coordinate,
   and state a grid rule and a test for the model's export.
4. *Reading.* From the ONNX Resize specification, write each coordinate mode as a grid map in this chapter's
   notation, and say for which a resized crop equals the crop of the resized image.
