# Chapter 4 · Wide Kernels at Constant Cost

*Running sums, separability and decimation make a filter's cost per pixel independent of its radius; each kernel
declares how far it reaches, so tiles stay exact.*

**★** A good form among several; the Variations section names the others.

## Intent

A blur of radius 200 pixels should cost about what a blur of radius 2 costs, and give the same result whole or in
tiles. Choose for each neighbourhood filter a formulation whose operations per output pixel are bounded
independently of its radius, and declare its reach so a tiler can grow each tile by exactly that much.

## Also known as

Constant-time filtering; cascaded box filters; integral images; recursive filtering; multiresolution blur; apron
or halo planning.

## Motivation

The running example's print chain has neighbourhood filters whose widths span two orders of magnitude: a sharpen
of a pixel or two, a density mask (the unsharp contrast mask printers make from a blurred copy of the negative) of
hundreds of micrometres, clarity (local contrast) of several millimetres on the print. Sizes are physical, so the
same setting is a few pixels on a thumbnail and 200 in an export. Four failures, from chromobench and Editor lab:

1. **Direct convolution grows with the radius.** Editor lab's textbook works the numbers for a Gaussian of
   σ = 100 px: 601 taps per pass, 1,202 reads per output pixel for the two passes of a separable blur. Its pyramid
   plan needs about 8.
2. **Repeated passes move the error to the edges.** chromobench's GPU blur takes at most 96 taps on each side
   (σ ≤ 32 px). An early version reached wider blurs by repeating passes of σ/√p, since variances add. For clarity
   of radius 3 mm on a 96 × 64 test image (σ = 94 px), the result was 28 % off the exact Gaussian near the edge:
   each pass repeats the edge pixel again, and several clamped Gaussians are not one clamped Gaussian. The cost
   grew with σ too. One blur on a copy reduced by ⌈σ/32⌉ was 0.75 % off on that extreme image.
3. **Tiles without halos are fast and wrong.** The darkroom export of a 4,000 × 2,674 print (a burn under a 2 mm
   soft mask, a dodge, a 300 µm contrast mask) took 781 ms in 12 tiles of 1,024 px and was wrong at every tile
   border. No test compared tiled with whole output. The exact version takes 1,650 ms.
4. **Halos for wide kernels do not fit.** A 10 mm clarity at 48 µm per pixel is σ ≈ 200 px and needs about 700 px
   of input around each tile: a 256-pixel tile would read 1,650 × 1,650 pixels, 41 times what it writes.

A database computing a 30-day moving average and maximum per row must not rescan the window for every row; a
convolution reverb applies an impulse response of hundreds of thousands of taps.

## Problem

**How can a neighbourhood filter whose radius ranges from one pixel to hundreds cost a bounded amount per pixel on
any device, and still give the same result in tiles as whole?**

## Forces

- **Exact shape against constant cost.** A Gaussian needs about 6σ + 1 taps per pass; three box filters approximate
  it in a dozen operations per pixel with a measurable shape error.
- **Serial running sums against parallel lanes.** A running sum is one addition and one subtraction per pixel but
  is serial along a row; a GPU wants tens of thousands of independent invocations.
- **Full resolution against decimation.** Reducing resolution by s cuts work by s² and adds its own blur and
  aliasing, which must be subtracted from the variance budget.
- **Accumulator width against bytes moved.** Long sums and prefix tables need wide accumulators; f32 halves the
  bytes and loses the small differences the filter needs.
- **Small halos against exact tiles.** A tile must read the full reach of every kernel on its path; large reaches
  multiply reads or exhaust memory.

## Solution

**Therefore: give every neighbourhood filter a formulation whose operations per output pixel do not grow with its
radius, and record its reach beside it. Split two-dimensional kernels into one-dimensional passes; compute box
passes, the Gaussians built from three of them, and minimum and maximum filters with running sums, prefix tables
or block-wise prefix and suffix scans; compute smooth kernels wider than a few dozen pixels at a resolution reduced
in proportion to their width, with the variances of prefilter, reduced kernel and upsampling adding up to the one
requested. Keep accumulators wide enough for the longest sum. Declare each kernel's reach as a function of its size
(in units of the medium), its formulation and a tolerance; add reaches along a path and take the maximum across
branches, so the tiler grows each tile by exactly that, or computes the kernel once for the whole image at reduced
resolution and lets tiles read it through image coordinates.**

## Applicability

Use it when:

- kernel sizes vary widely, from user controls, physical sizes, or one setting rendered at many resolutions;
- wide kernels dominate the running time;
- results are tiled or streamed and must equal the whole-image result.

Do not use it when:

- the kernel is narrow and fixed (a 3 × 3 gradient): direct convolution is already constant and simpler;
- the kernel is neither separable, nor built from boxes, nor smooth enough to decimate (an edge-preserving
  bilateral filter, a learned kernel): use an FFT or an approximation with its own measured error;
- the exact Gaussian shape matters (scale-space measurements, derivative filters for features): three boxes bias
  the answer, so pay for the true kernel or a recursive one.

## Structure

| Participant | Responsibility |
| --- | --- |
| **Kernel declaration** | shape (box, Gaussian, min, max), size in units of the medium, border rule, may it be decimated |
| **Formulation** | direct separable, running sum, prefix table, block scans, recursive, decimated field |
| **Cost model** | operations and reads per output pixel as a function of size and device |
| **Reach function** | pixels read beyond each output pixel, for the formulation and a tolerance |
| **Planner** | picks a formulation per kernel and device, combines reaches over the graph, tiles or fields |
| **Field** | a wide kernel computed once at reduced resolution, read by every tile through image coordinates |
| **Accumulator** | the number type of running sums and prefix tables |

In a stream processor computing rolling statistics: the window specification, running sums or a monotonic queue,
the cost per event, the history a restarted partition must replay (its reach), and 64-bit integer accumulators.

## Collaborations

1. Each operation declares its kernels: shape, size in micrometres or millimetres, border rule, decimation allowed.
2. The planner converts sizes to pixels on the target grid ([Chapter 3](03-one-grid-rule.md)) and picks each
   formulation by the cost model for the device.
3. It computes reaches, adds them along paths, takes the maximum across branches, and plans whole-image or haloed
   tiles within the memory budget.
4. The executor builds fields first, then each tile from its haloed rectangle, reading fields by image coordinates.
5. Tests check tiled against whole, a constant image staying constant, and each approximation against its bound.

## Sketch

```text
value Kernel: shape, size, border, decimable    -- shape ∈ { box, gauss, min, max }; size: radius or σ, in µm
value Plan: formulation, reach, scale           -- reach in pixels; scale 1, or the decimation factor
-- w: image width; clampX(i) = clamp(i, 0, w − 1); device.directLimit: widest σ (px) one direct pass may take
-- gaussSeparable(img, σ): direct taps to ⌈3σ⌉, rows then columns; boxDecimate(img, s): means of s × s blocks;
-- bilinearUp(img, s): explicit four-tap read at full resolution; tileGrid(image, halo): cores plus halo, clipped

-- three odd box widths whose variances add up to σ² (box of width w: variance (w² − 1)/12)
boxWidths(σ) → [w1, w2, w3]:
  wl ← the largest odd integer ≤ sqrt(4σ² + 1)
  m  ← round((12σ² − 3wl² − 12wl − 9) / (−4wl − 4))      -- how many boxes of width wl; the rest wl + 2
  return [wl if i < m else wl + 2 for i in 0, 1, 2]

-- one box pass along rows, any radius r, clamp-to-edge: two operations per pixel
boxRows(src, r) → dst:
  for each row y:                                         -- rows are independent
    acc ← Σ for j in −r .. r of src[clampX(j), y]          -- acc is wide: f64 or a 64-bit integer
    for x in 0 .. w − 1:
      dst[x, y] ← acc / (2r + 1)
      acc ← acc + src[clampX(x + r + 1), y] − src[clampX(x − r), y]

-- maximum over 2r + 1 pixels in about three comparisons per pixel (van Herk; Gil and Werman)
maxRows(src, r) → dst:
  k ← 2r + 1
  for each row y:
    a ← r values −∞, then row y of src, then r values −∞, then −∞ up to a multiple of k   -- clipped window
    for each block of k entries of a:
      g[i] ← max of a from the block's start to i         -- prefix maxima
      h[i] ← max of a from i to the block's end           -- suffix maxima
    for x in 0 .. w − 1: dst[x, y] ← max(h[x], g[x + 2r])   -- window a[x .. x + 2r] spans at most two blocks

-- wide and smooth: decimate by s, blur what remains, upsample; variances add (requires σ > s/2)
gaussWide(src, σ, s) → dst:
  low  ← boxDecimate(src, s)                              -- s × s means: adds (s² − 1)/12 px² per axis
  σlow ← sqrt(σ² − (s² − 1)/12 − s²/6) / s                 -- bilinear upsampling adds s²/6 px²
  return bilinearUp(gaussSeparable(low, σlow), s)         -- pixel centres as in Chapter 3

plan(k, umPerPx, device) → Plan:
  px ← k.size / umPerPx                                   -- on this grid
  match k.shape:
    box, min, max                       → Plan(scans, reach: ceil(px), scale: 1)
    gauss if px ≤ device.directLimit     → Plan(directSeparable, reach: ceil(3 · px), scale: 1)
    gauss if k.decimable                 → Plan(field, reach: 0, scale: ceil(px / device.directLimit))
    gauss                                → Plan(threeBoxes, reach: Σ (wi − 1)/2 over boxWidths(px), scale: 1)

halo(node) → own reach of node + max over inputs i of halo(i)   -- add along a path, maximum across branches

-- in use: clarity of 10 mm and a sharpen of 0.1 mm on a print at 48 µm per pixel
plans ← [plan(clarity, 48, gpu), plan(sharpen, 48, gpu)]   -- a field at scale 7; a local kernel of reach 7
tiles ← tileGrid(image, halo: halo(output))                -- fields are built once, before the tiles
```

## Implementation notes

1. **Separate first; it is linear, not constant.** A two-dimensional kernel of radius r reads (2r + 1)² pixels; two
   one-dimensional passes read 2(2r + 1): 1,089 against 66 at r = 16, as the Editor lab textbook counts. Linear in
   r is still too much at r = 300.
2. **Three boxes: know the error.** Editor lab blurs with three running-sum boxes whose widths come from σ
   (σ² = (w₁² + w₂² + w₃² − 3)/12). Integer widths quantise the variance in steps of (wl + 1)/3 px², so σ can be
   off by up to about 1/6 px; for integer σ the count m always lands on exactly 1.5 and the result is σ − 1/6
   (5.83 for 6, 2.8 % low). The shape (my computation) peaks 6 % below the Gaussian of the same variance at every
   σ above a few pixels, and its frequency response, a product of three sincs, has sidelobes near 1 % (−40 dB).
   That is invisible in a soft-focus blur and a bias in a measurement. The reach is exact and finite: the sum of
   the three radii, 16 px at σ = 6, 70 px at σ = 24.
3. **Running sums need wide accumulators.** Editor lab accumulates in double-precision JavaScript numbers. An f32
   running sum along a 6,000-pixel row drifted by at most 3 × 10⁻⁶ in a mean of values in [0, 1], a fifth of a
   16-bit level: acceptable. A summed-area table, where entry (x, y) holds the sum of everything above and to the
   left, is not: at 24 megapixels its entries reach 1.2 × 10⁷, whose f32 ulp is 1, and a 5 × 5 mean read near the
   far corner came out 0.520 instead of 0.478 (my measurement). chromobench's dust detector builds its table in f64
   for this reason. Without f64 on the device, sum 16-bit codes in 64-bit integers, or keep per-tile tables.
4. **On a GPU, parallelism chooses the formulation.** A running sum is serial along its row: a 4,000 × 2,674 image
   offers 2,674 independent rows, fewer invocations (a GPU's unit of parallel work, one per output element) than a
   large GPU has lanes. chromobench's GPU therefore convolves directly, one invocation per pixel, up to σ = 32 px,
   and switches to a reduced field beyond that, which bounds the work at 2 × 193 taps per pixel. Editor lab's staged
   blur loads a row segment of 256 pixels plus 2r into workgroup memory (fast on-chip memory shared by a group of
   invocations, 16 KiB guaranteed by WebGPU), cutting global reads per pixel from 2r + 1 to 1 + 2r/256. Parallel
   prefix scans (Blelloch's) make running sums and summed-area tables parallel: linear work, logarithmic depth.
5. **One wide blur, not several narrow ones.** Repeated passes are wrong at clamped edges (Motivation). They also
   inflate the declared reach: p passes of σ/√p, each truncated at 3σ/√p, reach 3σ√p, √p times the reach of one
   blur. chromobench fixed this for clarity, soft masks and the density mask, but its film module still splits its
   own Gaussians into ⌈(σ/32)²⌉ passes, quadratic in σ. At usual settings that does not matter (halation, the glow
   from light reflected in the film base, is about 11 px at 6 µm per pixel). The diffusion of development
   inhibitors (chemicals from developing grains that hold back their neighbours) has a 554 µm tail; if enabled, it
   would run nine passes and declare a halo of 837 px where 3σ is 277.
6. **Decimation: subtract every blur you add.** chromobench reduces by s with an s × s mean (variance (s² − 1)/12
   per axis), blurs with σlow, and reads back bilinearly (s²/6): σlow = √(σ² − (s² − 1)/12 − s²/6)/s, with
   s = ⌈σ/32⌉ so σlow stays between about 16 and 32 reduced pixels. Editor lab's textbook plans with the binomial
   [1, 3, 3, 1]/8 (variance 0.75 per level, so n halvings add (4ⁿ − 1)/4): σ = 100 becomes six halvings and an
   11-tap kernel. Read back with an explicit four-tap interpolation; chromobench measured Apple's hardware filter
   computing weights with 8 fractional bits ([Reference Oracle](../03-reference-oracle.md)).
7. **Declare reach by formulation and tolerance.** Three boxes reach the sum of their radii exactly. A Gaussian
   truncated at kσ drops 0.27 % of its mass at k = 3 and 0.006 % at k = 4. chromobench has three kernels called
   "Gaussian": the GPU's truncated at 3σ with clamped edges, the f64 film reference's at 4σ with mirrored edges, the
   dust detector's at 3σ mirrored without repeating the edge pixel. Put k and the border rule in the declaration,
   and compare engines only with the same pair. A recursive filter has infinite support; declare the radius where
   its impulse response falls below the tolerance. A field adds no halo; its builder reads the whole image.
8. **Paths add, branches take the maximum, and fusion multiplies.** chromobench computes a node's halo as its own
   reach plus the largest of its inputs'. Fusing k neighbourhood passes into one tile pass needs the sum of their
   reaches as one apron: Editor lab's three fused σ = 6 px blurs on 128-pixel tiles read 3.06 times the pixels
   they write.
9. **Exactness has a price; know where it goes.** chromobench's exact export takes 1,650 ms instead of 781. Memory
   sets the tile: a haloed tile holds about 20 float textures per pixel, so 1,024 px plus two 64-pixel halos is
   405 MiB, over half of the 512 MiB budget, and the planner falls back to 512-pixel tiles. Their halos read
   1.52 times the core pixels (my computation), and the whole-image fields add a pass. The open task is to plan
   tiles from the graph's real peak of live textures and build fields in one pass.
10. **Minimum and maximum filters too.** chromobench's dust detector computes square minima and maxima separably
    but directly, 2r + 1 comparisons per pixel per pass; van Herk and Gil–Werman need about three at any r. Its
    radii are a dust speck's size, so the debt is small; with large structuring elements it decides the run time.

## Variations

- **Recursive (IIR) Gaussian.** A causal and an anticausal pass of a few taps each (Deriche; Young and van Vliet):
  constant cost and a closer shape than three boxes, but infinite support, care at the borders, and serial rows.
- **FFT convolution.** Any kernel, including non-separable ones (lens bokeh), at O(log N) per pixel; periodic
  borders need padding, and tiles need overlap-add.
- **Summed-area tables.** Four reads per pixel for a box of any size, chosen per pixel (variable blur, depth of
  field); one wide table per image.
- **Pyramids.** One pyramid serves many widths; summing weighted levels gives the heavy-tailed kernels of bloom.
  Cheapest when many σ are needed at once.

## Consequences

- \+ Cost per pixel is bounded on every device, whatever the radius.
- \+ Finite, declared reaches make tiles exact, and the tiled-equals-whole test can say so.
- \+ Wide smooth kernels become fields computed once and read by every tile.
- − Approximate shapes need their own error bound and a reference with the same approximation.
- − More formulations to maintain; the planner chooses by device, so two machines may compute differently.
- − Running sums and recursive filters are serial along rows; GPUs need scans or another formulation.
- − Exactness costs memory and time: chromobench's export went from 781 ms to 1,650 ms.

## Known uses

- **W. M. Wells**, "Efficient Synthesis of Gaussian Filters by Cascaded Uniform Filters", *IEEE PAMI* 8(2), 1986;
  **Peter Kovesi**, "Fast Almost-Gaussian Filtering", DICTA 2010, for the integer box widths used above.
- **Franklin C. Crow**, "Summed-Area Tables for Texture Mapping", SIGGRAPH 1984; Viola and Jones's integral images
  (CVPR 2001); Hensley et al. built them on GPUs (Eurographics 2005).
- **Marcel van Herk** (*Pattern Recognition Letters* 13(7), 1992) and **Joseph Gil and Michael Werman** (*IEEE PAMI*
  15(5), 1993): minimum and maximum filters at constant cost.
- **Rachid Deriche**, "Recursively Implementing the Gaussian and Its Derivatives" (INRIA report, 1993); **Ian T.
  Young and Lucas J. van Vliet**, "Recursive Implementation of the Gaussian Filter", *Signal Processing*, 1995.
- **Peter J. Burt and Edward H. Adelson**, "The Laplacian Pyramid as a Compact Image Code", *IEEE Transactions on
  Communications* 31(4), 1983.
- **Halide** (Ragan-Kelley et al., PLDI 2013) schedules a two-pass blur as tiles with overlap or sliding windows.
- **NVIDIA**'s separable convolution sample (Victor Podlozhnyuk, "Image Convolution with CUDA", 2007) stages tiles
  with aprons in shared memory.
- **Game renderers' bloom** blurs a chain of downsampled images and sums them back (Jorge Jimenez, SIGGRAPH 2014
  Advances in Real-Time Rendering course).

## Related chapters

- [Chapter 3 · One Grid Rule](03-one-grid-rule.md): fields are read through image coordinates by the grid rule.
- [Chapter 5 · Fused Interpreted Passes](05-fused-interpreted-passes.md): a pass breaks where a kernel reads
  neighbours.
- [Chapter 2 · Precision Ladder](02-precision-ladder.md) decides accumulator widths;
  [Chapter 7 · Budgeted Residency](07-budgeted-residency.md) sets the memory that sizes tiles;
  [Chapter 10](10-measure-completion-gate-percentiles.md) times them.
- Image engine volume: [Reach-Declared Tiling](../08-reach-declared-tiling.md) plans halos and fields;
  [Barrier-Cut Fusion](../07-barrier-cut-fusion.md); [Reference Oracle](../03-reference-oracle.md). Modular volume:
  [Work in Small Slices](../modular/06-work-in-small-slices.md).
- GoF: **Strategy** (formulations behind one kernel declaration), **Builder** (the planner assembling a plan).

## Exercises

1. *Implement and measure.* On a 4,000 × 3,000 single-channel image, implement a direct separable Gaussian, three
   running-sum boxes, and a decimated Gaussian. Time each for σ = 1, 4, 16, 64 and 256 (nanoseconds per pixel),
   and measure the largest error against an f64 direct Gaussian with the same border rule. Repeat with f32
   accumulators and with a summed-area table, and find the image size at which the f32 table's 5 × 5 mean error
   exceeds 1/255.
2. *Analyse.* (a) Show that integer box widths quantise σ² in steps of (wl + 1)/3 and bound the error in σ. (b) Write
   a cost model for a GPU: direct separable with workgroup staging against a field at s = ⌈σ/32⌉, counting global
   reads, shared reads and arithmetic per pixel; find the σ above which the field is cheaper. (c) Show that away from
   the border p passes of σ/√p have the variance of one pass of σ, and build a small image on which clamping once
   and clamping p times differ near the border.
3. *Another domain.* A time-series store computes a 30-day moving average and moving maximum over a billion rows in
   partitions. Design both with running sums and van Herk's blocks. What is each partition's reach, and what
   accumulator type keeps sums of prices in cents exact?
4. *Reading.* Compare Kovesi's (2010) box widths with `boxWidths` above, or compute the redundant work of the blur
   schedules in the Halide paper from this chapter's reach.
