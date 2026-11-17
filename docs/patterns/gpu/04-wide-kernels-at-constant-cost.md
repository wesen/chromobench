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
same setting is a few pixels on a thumbnail and 200 in an export. Exports run in *tiles*, pieces of the image
computed one at a time to bound memory; a tile under a blur must read a *halo*, a margin of input as wide as the
blur's reach, so its border pixels see their neighbours. Four failures, from chromobench and Editor lab:

1. **Direct convolution grows with the radius.** Editor lab's textbook works the numbers for a Gaussian of
   σ = 100 px: 601 taps per pass, 1,202 reads per output pixel for the two passes of a separable blur. Its pyramid
   plan needs about 8.
2. **Repeated passes move the error to the edges.** chromobench's GPU blur takes at most 96 taps on each side
   (σ ≤ 32 px). An early version reached wider blurs by repeating passes of σ/√p, since variances add. For clarity
   of radius 3 mm on a 96 × 64 test image (σ = 94 px), the result was 28 % off the exact Gaussian near the edge:
   each pass repeats the edge pixel again, and several clamped Gaussians are not one clamped Gaussian. One blur on
   a copy reduced by ⌈σ/32⌉ was 0.75 % off on that extreme image.
3. **Tiles without halos are fast and wrong.** The darkroom export of a 4,000 × 2,674 print (a burn under a 2 mm
   soft mask, a dodge, a 300 µm contrast mask) took 781 ms in 12 tiles of 1,024 px and was wrong at every tile
   border. No test compared tiled with whole output. The exact version takes 1,650 ms.
4. **Halos for wide kernels do not fit.** A 10 mm clarity at 48 µm per pixel is σ ≈ 200 px and needs about 700 px
   of input around each tile: a 256-pixel tile would read 1,650 × 1,650 pixels, 41 times what it writes.

A database computing a 30-day moving average and maximum per row must not rescan the window for every row; a
convolution reverb applies an impulse response of hundreds of thousands of taps. Readers from other fields know the
idea already: dilated convolutions widen a network's receptive field at constant cost per layer, and the fast
multipole method sums far-away interactions on coarser levels, as decimation does here.

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
(in units of the medium), its formulation and a tolerance, so that a tiled result can equal the whole one.**

## Applicability

Use it when:

- kernel sizes vary widely, from user controls, physical sizes, or one setting rendered at many resolutions;
- wide kernels dominate the running time;
- results are tiled or streamed and must equal the whole-image result.

Do not use it when:

- the kernel is narrow and fixed (a 3 × 3 gradient): direct convolution is already constant and simpler;
- the kernel is neither separable, nor built from boxes, nor smooth enough to decimate (an edge-preserving
  bilateral filter, a learned kernel): use an FFT or an approximation with its own measured error;
- the exact Gaussian shape matters (scale-space measurements): three boxes bias the answer.

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

1. Each operation declares its kernels: shape, physical size, border rule, whether decimation is allowed.
2. The planner converts sizes to pixels on the target grid ([Chapter 3](03-one-grid-rule.md)), picks each
   formulation by the device's cost model, and sums reaches into a halo.
3. The executor builds fields first, then each tile from its haloed rectangle, reading fields by image coordinates.
4. Tests check tiled against whole, constant images staying constant, and each approximation against its bound.

## Sketch

```text
value Kernel: shape, size, border, decimable    -- shape ∈ { box, gauss, min, max }; size: radius or σ, in µm
value Plan: formulation, reach, scale           -- reach in pixels; scale 1, or the decimation factor
-- w, h: image size; clampX(i) = clamp(i, 0, w − 1); device.directLimit: widest σ (px) one direct pass may take
-- gaussSeparable(img, σ): direct taps to ⌈3σ⌉, normalised, rows then columns (σ = 0: a copy)
-- boxDecimate(img, s): means of s × s blocks of the clamp-extended image, ⌈w/s⌉ × ⌈h/s⌉
-- bilinearUp(img, s, w, h): explicit four-tap read at pixel centres (Chapter 3), w × h
-- release(img): give an intermediate image back to its pool

-- three odd box widths whose variances add up to σ² (box of width w: variance (w² − 1)/12)
boxWidths(σ) → [w1, w2, w3]:
  if σ ≤ 0: return [1, 1, 1]                              -- the identity
  wl ← the largest odd integer ≤ sqrt(4σ² + 1)
  m  ← round((12σ² − 3wl² − 12wl − 9) / (−4wl − 4))      -- how many boxes of width wl; the rest wl + 2
  return [wl if i < m else wl + 2 for i in 0, 1, 2]

-- one box pass along rows, any radius r ≥ 0, clamp-to-edge: one add, one subtract, one multiply per pixel
boxRows(src, r) → dst:                                    -- dst: a new w × h image, every pixel written below
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

-- wide and smooth: decimate by s, blur what remains, upsample; variances add
gaussWide(src, σ, s) → dst:
  if σ² ≤ (s² − 1)/12 + s²/6: refuse("too-narrow", fix: "a smaller s")   -- nothing would be left to blur
  low  ← boxDecimate(src, s)                              -- adds (s² − 1)/12 px² per axis
  σlow ← sqrt(σ² − (s² − 1)/12 − s²/6) / s                 -- bilinear upsampling adds s²/6 px²
  mid  ← gaussSeparable(low, σlow); release(low)
  dst  ← bilinearUp(mid, s, w, h); release(mid)
  return dst

plan(k, umPerPx, device) → Plan:
  px ← k.size / umPerPx                                   -- on this grid
  if px ≤ 0: return Plan(identity, reach: 0, scale: 1)
  match k.shape:
    box, min, max                       → Plan(scans, reach: ceil(px), scale: 1)
    gauss if px ≤ device.directLimit     → Plan(directSeparable, reach: ceil(3 · px), scale: 1)
    gauss if k.decimable                 → Plan(field, reach: 0, scale: ceil(px / device.directLimit))
    gauss                                → Plan(threeBoxes, reach: Σ (wi − 1)/2 over boxWidths(px), scale: 1)

-- in use: clarity of 10 mm and a sharpen of 0.1 mm on a print at 48 µm per pixel
plans ← [plan(clarity, 48, gpu), plan(sharpen, 48, gpu)]   -- a field at scale 7; a local kernel of reach 7
halo  ← Σ of plan.reach along the deepest path             -- the tiler grows each tile by this; fields first
```

## Implementation notes

1. **Separate first; it is linear, not constant.** A two-dimensional kernel of radius r reads (2r + 1)² pixels;
   two one-dimensional passes read 2(2r + 1): 1,089 against 66 at r = 16, as the Editor lab textbook counts. A
   running-sum box pass costs one addition, one subtraction and one multiplication per pixel per channel, whatever
   r is; three boxes on two axes are six such passes. Arithmetic alone favours the boxes from r ≈ 2.
2. **Three boxes: bound the error, then measure it.** Editor lab takes widths from σ² = (w₁² + w₂² + w₃² − 3)/12.
   Integer widths quantise the variance in steps of (wl + 1)/3 px², so σ can be off by up to about 1/6 px; for
   integer σ the count m always lands on exactly 1.5 and the result is σ − 1/6 (5.83 for 6, 2.8 % low). For the
   shape, an a-priori bound: if k is the box kernel and g the Gaussian, |k ∗ x − g ∗ x| ≤ ‖k − g‖₁ · max|x|. I
   computed ‖k − g‖₁ against the requested σ as 0.041 to 0.065 for σ from 2 to 100, and at most twice that in two
   dimensions (k⊗k − g⊗g = (k − g)⊗k + g⊗(k − g)). The measured maximum on a step edge is far smaller: 0.6 % of the
   step at σ = 6, 0.95 % at σ = 100, 1.6 % at σ = 2. Invisible in a soft blur; a bias in a measurement.
3. **Running sums need wide accumulators.** An f32 running sum along a 6,000-pixel row of random values in [0, 1]
   drifted by at most 3 × 10⁻⁶ in the mean, a fifth of a 16-bit level: its error is a walk of rounding errors of
   a bounded quantity. A summed-area table, where entry (x, y) holds the sum of everything above and to the left,
   differences large numbers: at 24 megapixels its entries reach 1.2 × 10⁷, whose f32 ulp is 1, and a 5 × 5 mean
   near the far corner came out 0.520 instead of 0.478 (my measurement, random input). chromobench's dust detector
   builds its table in f64. Without f64 on the device, sum 16-bit codes in 64-bit integers, or keep per-tile tables.
4. **On a GPU, parallelism and bandwidth choose the formulation.** A running sum is serial along its row: a
   4,000 × 2,674 image offers 2,674 rows, fewer independent *invocations* (one run of the kernel, the GPU's unit of
   parallel work) than a large GPU has lanes. Bandwidth matters too. If every pass streams an rgba32float image
   (four 32-bit floats, 16 bytes per pixel) in and out, six box passes move 192 bytes per pixel and a direct
   separable blur 64, while the direct blur does 16(2r + 1) floating-point operations per pixel. On a device with
   400 GB/s and 10 TFLOP/s, a linearised roofline estimate makes the direct blur faster up to r ≈ 150. chromobench
   convolves directly up to σ = 32 px (r = 96) and decimates beyond. Editor lab's staged blur loads a row segment of 256
   pixels plus 2r into *workgroup memory* (on-chip memory shared by a workgroup, a group of invocations that can
   synchronise): global reads per pixel fall from 2r + 1 to 1 + 2r/256. WebGPU guarantees 16 KiB of it and 256
   invocations per workgroup; Vulkan guarantees 16 KiB and 128, and CUDA offers 48 KiB per block by default.
   Parallel prefix scans make running sums and summed-area tables parallel: linear work, logarithmic depth.
5. **One wide blur, not several narrow ones.** Repeated passes are wrong at clamped edges (Motivation). They also
   inflate the declared reach: p passes of σ/√p, each truncated at 3σ/√p, reach 3σ√p, √p times one blur's reach.
   chromobench fixed this for clarity, soft masks and the density mask, but its film module still splits its own
   Gaussians into ⌈(σ/32)²⌉ passes, quadratic in σ; harmless for halation (the glow from light reflected in the
   film base, about 11 px at 6 µm per pixel). The diffusion of development
   inhibitors (chemicals from developing grains that hold back their neighbours) has a 554 µm tail; if enabled, it
   would run nine passes and declare a halo of 837 px where 3σ is 277.
6. **Decimation: subtract every blur you add, and bound the aliasing.** chromobench reduces by s with an s × s mean
   (variance (s² − 1)/12 per axis), blurs with σlow, and reads back bilinearly (s²/6):
   σlow = √(σ² − (s² − 1)/12 − s²/6)/s, with s = ⌈σ/32⌉ so σ/s lies in (16, 32]. What variance bookkeeping cannot
   remove is aliasing: a component just below frequency 1/s survives the box mean with gain about πδ/sin(π/s) and
   folds to frequency δ, where the blur keeps exp(−2π²σ²δ²). Maximising over δ gives an error of about
   e^(−1/2)/(2σ sin(π/s)) of the input's amplitude per axis, a linearised estimate: 0.6–1.0 % at σ/s = 16 and
   0.3–0.5 % at 32, the higher values at s = 2. A one-dimensional simulation of the whole path measured 0.28 % to
   0.90 %, never more than 2 % above the estimate. Read
   back with an explicit interpolation: Apple's hardware filter computes weights with 8 fractional bits
   ([Reference Oracle](../03-reference-oracle.md)).
7. **Declare reach by formulation and tolerance.** Three boxes reach the sum of their radii exactly. A Gaussian
   truncated at kσ drops 0.27 % of its mass at k = 3 and 0.006 % at k = 4. chromobench has three kernels called
   "Gaussian": the GPU's truncated at 3σ with clamped edges, the f64 film reference's at 4σ with mirrored edges,
   the dust detector's at 3σ mirrored without repeating the edge pixel. Put k and the border rule in the
   declaration, and compare engines only with the same pair. A recursive filter has infinite support; declare the
   radius where its impulse response falls below the tolerance.
8. **Halos cost ((t + 2m)/t)², and fusion multiplies them.** A t-pixel tile with halo m reads (t + 2m)² pixels to
   write t². Paths add their reaches (chromobench's halo is a node's own reach plus the largest of its inputs'), so
   fusing k passes of reach m needs an apron of km: Editor lab's three fused σ = 6 px blurs on 128-pixel tiles
   read 3.06 times the pixels they write.
9. **Exactness has a price; know where it goes.** chromobench's exact export takes 1,650 ms instead of 781. Memory
   sets the tile: a haloed tile keeps about 20 rgba32float textures (images on the GPU) alive, 320 bytes per
   pixel, so 1,024 px plus two 64-pixel halos is 405 MiB, over half of the 512 MiB budget, and the planner falls
   back to 512-pixel tiles. Their halos read
   1.52 times the core pixels (((512 + 128)/512)² = 1.56 inside, less at clipped image edges; my computation), and
   the whole-image fields add a pass. The remedy still open is to plan tiles from the graph's real peak of live
   textures and build fields in one pass.
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
- \+ Finite, declared reaches make tiles exact, and a tiled-equals-whole test can say so.
- \+ Wide smooth kernels become fields computed once and read by every tile.
- − Approximate shapes need their own error bound and a reference with the same approximation.
- − More formulations to maintain; the planner chooses by device, so two machines may compute differently.
- − Exactness costs memory and time: chromobench's export went from 781 ms to 1,650 ms.

## Known uses

- **W. M. Wells**, *IEEE PAMI* 8(2), 1986 (cascaded uniform filters); **Peter Kovesi**, "Fast Almost-Gaussian
  Filtering", DICTA 2010 (the integer box widths above).
- **Franklin C. Crow**, "Summed-Area Tables for Texture Mapping", SIGGRAPH 1984; Viola and Jones's integral images
  (CVPR 2001); Hensley et al. on GPUs (Eurographics 2005).
- **Marcel van Herk** (*Pattern Recognition Letters* 13(7), 1992); **Joseph Gil and Michael Werman** (*IEEE PAMI*
  15(5), 1993).
- **Rachid Deriche** (INRIA research report, 1993) and **Ian T. Young and Lucas J. van Vliet** (*Signal
  Processing*, 1995): recursive Gaussians.
- **Burt and Adelson**, "The Laplacian Pyramid as a Compact Image Code", *IEEE Trans. Communications*, 1983.
- **Halide** (Ragan-Kelley et al., PLDI 2013) schedules a two-pass blur as overlapping tiles or sliding windows.
- **NVIDIA**'s separable convolution sample (Podlozhnyuk, "Image Convolution with CUDA", 2007) stages tiles with
  aprons in shared memory.
- **Game renderers' bloom** blurs and sums a chain of downsampled images (Jimenez, SIGGRAPH 2014 course).

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
   and measure the largest error against an f64 direct Gaussian with the same border rule, on a step edge and on
   random input. Then build a summed-area table in f32 and in f64 and find the image size at which the f32 table's
   5 × 5 mean error exceeds 1/255.
2. *Analyse.* (a) Show that integer box widths quantise σ² in steps of (wl + 1)/3 and bound the error in σ.
   (b) Cost model: a GPU with 400 GB/s of memory bandwidth and 10 TFLOP/s in f32, an rgba32float image of
   4,000 × 2,674, workgroups of 256 invocations with 16 KiB of workgroup memory. Count bytes and operations per
   pixel for a staged direct separable blur and for a field at s = ⌈σ/32⌉ (decimate, blur, upsample), and find the
   σ above which the field is faster. Say which terms of your model are linearised. (c) Show that away from the
   border p passes of σ/√p have the variance of one pass of σ, and build a small image on which clamping once and
   clamping p times differ near the border.
3. *Another domain.* A time-series store computes a 30-day moving average and moving maximum over a billion rows in
   partitions. Design both with running sums and van Herk's blocks. What is each partition's reach, and what
   accumulator type keeps sums of prices in cents exact?
4. *Reading.* Compare Kovesi's (2010) box widths with `boxWidths` above, or compute the redundant work of the blur
   schedules in the Halide paper from this chapter's halo factor.
