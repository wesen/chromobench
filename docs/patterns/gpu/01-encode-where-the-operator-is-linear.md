# Chapter 1 · Encode Where the Operator Is Linear

*Run each operation in the representation where its mathematics is a sum or a scaling, and change representation
only at a few planned boundaries.*

**★★** We believe any good solution to this problem has this shape.

## Intent

Most image operations are linear in one encoding of the pixel values and nonlinear in every other. Run each
operation in the encoding where it is linear, or where the property it must keep is linear, and convert at declared
boundaries. The operation then becomes short, it commutes with the averaging that tiles, previews and filters do,
and its error is easy to bound.

## Also known as

Working space; linear workflow; scene-referred processing; homomorphic processing; log domain; premultiplied (or
associated) alpha; change of basis before you compute.

## Motivation

chromobench carries a picture through several kinds of number. Camera values and XYZ (the CIE tristimulus values,
a linear measure of colour) are proportional to light. Scanner density (minus the base-10 logarithm of the film's
transmittance) and the paper's log exposure are logarithms. Display values are encoded with a power curve so that
equal steps look roughly equal; Editor lab stores everything that way, as sRGB. The naive design runs every
operation on whatever numbers it is given, and fails in three ways.

1. **An average of encoded values is not an average of light.** Editor lab's pyramid (the image halved repeatedly,
   for fast previews) averages sRGB values. A fine black-and-white pattern averages to sRGB 0.5, which is 0.21 in
   linear light instead of 0.5. Its exposure adjustment works, correctly, in linear light. The two do not commute.
   On its textbook's test photograph, a quarter-size preview of +1 EV (one stop: twice the light) differs from the
   full-size render averaged down by up to 22 8-bit levels, on 0.5 % of the pixels, all at sharp edges.
2. **A correction in the wrong encoding damages what it corrects.** Heal copies a disc of pixels from a clean area
   onto a blemish, then corrects the copy so that its edge matches its new surroundings. Suppose the ring around the
   target measures 0.02 in linear light, the ring around the source 0.20, and the source has texture of ±0.05. An
   additive correction of −0.18 maps the texture to −0.03…0.07: negative light, and texture ten times too strong
   for its new surroundings. A gain of 0.1 maps it to 0.015…0.025 and keeps its contrast. The defect is a gain, so
   the correction belongs in the logarithm, where a gain is an offset.
3. **A conversion in the inner loop costs time and precision.** Editor lab converts sRGB to linear light and back
   for exposure with two 4,096-entry tables, because a power function per channel per pixel "costs more than the rest
   of the adjustment". chromobench runs its per-channel blend modes in linear RGB; when a layer's values are in OkLab
   (a perceptual space), each pixel is converted to RGB and back. Where the blended colour is nearly black, the
   cube root inside OkLab amplifies 32-bit rounding to 1.1 × 10⁻⁴ in OkLab units, against 10⁻⁵ elsewhere. The
   test bound for those cases had to be fifteen times looser.

Other fields meet the same problem. In probabilistic inference the likelihood of a long sequence is a product of
small probabilities; a thousand factors near 0.01 underflow 64-bit floats, while the sum of their logarithms does
not. But marginalising is a sum of probabilities, so in the log domain it becomes log-sum-exp. In audio, mixing adds
signals in linear amplitude while gains add in decibels.

## Problem

**An operation that is a sum or a scaling in one representation of the data is a nonlinear tangle in the others. In
which representation should each operation run, and where should the data change representation?**

## Forces

- **Simple operations against few conversions.** Each operation is simplest in its own encoding; every change of
  encoding costs time, precision and a place where engines can disagree.
- **Physical correctness against familiar results.** Multiply in linear light is a filter; users who learned
  multiply on display values find it heavier. Preset values tuned in one encoding do not transfer to another.
- **Commuting with resampling against perceptual uniformity.** Averages, blurs and resizes are only right in linear
  light; curves, chroma and hue controls behave evenly only in a perceptual space.
- **Exact conversions against cheap ones.** A power function or cube root per pixel is accurate and slow; a table is
  fast and has an error that someone must state. Either loses precision near zero, where the slope is unbounded.
- **One working space against several.** One encoding is easy to teach and document; a physical pipeline needs at
  least three, and a planner to move between them.

## Solution

**Therefore: run each operation in the representation where it is linear, where its effect is a sum, a scaling or a
weighted average, and change representation only at declared boundaries. (Light adds and scales in linear light;
gains become offsets in a log encoding such as density; coverage composes linearly in premultiplied colour; steps
defined by eye are near-uniform in a perceptual space.) Let each operation declare its representation, and let the
pipeline insert conversions only where neighbours disagree and cancel any that undo each other. Put the steps that
cannot be inverted (clipping, gamut compression, quantisation) after every operation that could move a value back
out of range. Charge each conversion its time and its error in the units of the output, and keep it out of inner
loops that do not need it.**

## Applicability

Use it when:

- operations have a physical or algebraic meaning (light, transmittance, probability, coverage);
- previews, tiles or filters average pixels, so operations must commute with averaging;
- several encodings are already in play, whether or not anyone named them.

Do not use it when:

- the program promises results identical to an editor that computes on display values;
- every operation is one lookup on display values, so nothing averages or adds;
- the data are stored in 8 bits and cannot be widened: linear light in 8 bits bands in the shadows, so the encoding
  for storage must stay perceptual (Chapter 2 decides the bits).

## Structure

| Participant | Responsibility |
| --- | --- |
| **Encoding** | a named representation with its meaning and range: linear, log (density), perceptual, premultiplied |
| **Operation declaration** | the encoding each operation runs in, and whether it is terminal (clip, knee, quantise) |
| **Converter** | one parametric conversion between two encodings, with a stated cost and error |
| **Boundary planner** | inserts conversions where neighbours disagree; cancels a conversion followed by its inverse |
| **Terminal steps** | the non-invertible steps, placed after everything that could undo them |
| **Error ledger** | per conversion: its time per pixel and its worst error at the output, where it is ill-conditioned |

In a probabilistic program the encodings are probability and log-probability; likelihood products run in log,
marginal sums run as log-sum-exp, and the terminal step is exponentiation for display.

## Collaborations

1. The source assigns the first encoding from what the file holds (sensor values, density, display values).
2. Each operation is lowered with a conversion into its encoding and one back out. The planner then merges adjacent
   conversions: a pair that undoes itself vanishes, and a chain becomes one conversion.
3. Each operation runs in its declared encoding. Pointwise conversions are ordinary pointwise steps, so they fuse
   into the same pass as their neighbours ([Chapter 5](05-fused-interpreted-passes.md)).
4. Terminal steps run last. The planner refuses an ordinary operation placed after one.
5. The error ledger is checked by the reference comparison: each conversion's worst case is measured where it is
   ill-conditioned, not only at typical values.

## Sketch

```text
-- encodings: what the numbers mean
--   linear        proportional to light
--   log           a logarithm of light (density = −log10 transmittance)
--   perceptual    a lightness–chroma–hue space (OkLab, OkLCh)
--   premultiplied colour times coverage α
value Op: name, encoding, terminal, apply                -- terminal: clip, gamut knee, quantise
value Conversion: from, to, pre: Mat3, f, post: Mat3    -- out = post · f(pre · v); f ∈ {id, cbrt, cube, log, exp}

conversion(a, b) → Conversion                            -- from a table of the encodings' pairs; a = b: identity

-- lowering: each op converts from the pipeline's home encoding into its own and back
lower(ops, home) → steps:
  steps ← []
  for op in ops: steps ← steps ++ [conversion(home, op.encoding), op, conversion(op.encoding, home)]
  return steps

-- the boundary planner: drop identities, merge a→b, b→c into a→c, and a→b, b→a vanishes
simplify(steps) → steps:
  out ← []
  for s in steps:
    if s is Conversion:
      if s.from = s.to: continue
      if out not empty and last(out) is Conversion c:
        remove last(out)
        if c.from ≠ s.to: append conversion(c.from, s.to) to out
        continue
    append s to out
  return out

-- terminal steps last: nothing after them may move a value back out of range
checkOrder(steps):
  closed ← false
  for s in steps where s is Op:
    if closed and not s.terminal: refuse("order", s.name ++ " after a terminal step", fix: "move it earlier")
    closed ← closed or s.terminal

-- operations in the encodings where they are linear
exposure(ev):      Op(linear)          v ← 2^ev · v
multiplyBlend(s):  Op(linear)          v ← v · s                    -- a filter in front of the light
densityOffset(d):  Op(log)             v ← v + d                    -- a transmittance gain of 10^−d
curve(c):          Op(perceptual)      L ← c(L)
hueShift(h):       Op(perceptual)      hue ← hue + h
over(src):         Op(premultiplied)   v ← src + (1 − src.α) · v    -- colour and α alike
gamutKnee:         Op(perceptual, terminal)

-- a seam correction: harmonic, so linear in its boundary values; additive in the log encoding
-- u(p): the smooth function on the disc whose boundary values are the log-ratio of the two rings
kernel heal(u, enc) over spot.box:
  out[p] ← match enc:
    log    → patch[p] + u(p)                      -- density: an offset
    linear → patch[p] · exp(u(p))                 -- light: the same correction as a gain

-- in use: six conversions lowered, four kept
steps ← simplify(lower([exposure(0.5), curve(c), hueShift(10°), multiplyBlend(layer), gamutKnee], home: linear))
checkOrder(steps)
-- → exposure, →perceptual, curve, hueShift, →linear, multiplyBlend, →perceptual, gamutKnee, →linear
```

## Implementation notes

1. **Average in linear light.** chromobench's flat-field correction (the map of uneven illumination in a film
   scanner) averages its cells on linear values, "the cell mean is of light, not of encoded values". Editor lab's
   pyramid averages sRGB values and pays with the 22-level disagreement above; a linear pyramid, its textbook says,
   "needs either more bits per channel or the decoding cost on every read" ([Chapter 2](02-precision-ladder.md)).
2. **Find the encoding where the defect is additive.** chromobench's heal computes its seam correction as a harmonic
   function (a solution of Laplace's equation, fixed by its values on the boundary and linear in them) of the log
   ratio of the two rings. In print XYZ it applies the result as a gain, `exp(u)`; in scanner density, which is
   already a logarithm, as an offset. One GPU kernel serves both with a flag. The ingest stage's dust heal does the
   same in density: in its words, "a harmonic density offset (a multiplicative transmittance gain)".
3. **One formula may use two encodings.** The darkroom's light law sums the main exposure, burns, dodges and
   flashes in linear exposure H, because light adds. Density masks and filters multiply the transmission, so their
   densities are summed in the exponent: `T = 10^(−Σ w·d)`. Enlarger time is an exact offset of the log exposure.
   Each `10^x` is a conversion paid per term per pixel. The result is stored as log10 of `max(H, 10⁻⁸)` on both
   engines: WGSL lets implementations assume no infinities or NaNs occur, so `log(0)` has no portable value.
4. **Linearity removes a table dimension.** How film responds to a colour is a sum over 81 wavelengths. That
   response is linear in the light's brightness, so chromobench folds it into a per-film table over chromaticity
   alone, two dimensions instead of three: `raw = b · table(u, v)`, with `b = X + Y + Z`. Homogeneity in one variable
   is worth looking for before tabulating any function of colour.
5. **Perceptual operations in a perceptual space, and the gamut knee last.** chromobench runs curves, grading, the
   luminance that masks read and four blend modes (hue, saturation, colour, luminosity) in OkLab or OkLCh, its polar
   form (lightness, chroma or colourfulness, hue). The output knee compresses chroma toward the largest the display
   can show at that lightness and hue, keeping colours inside its gamut, the RGB cube of displayable values. The code
   states the rule: "The knee is the LAST colour operation before encoding: a gain after it leaves the cube again".
   A recorded debt sits upstream: the OkLCh blend modes skip the W3C's `ClipColor`, so luminosity can leave the
   gamut and relies on the knee much later.
6. **Measure conversions where they are ill-conditioned.** OkLab passes through a cube root: an absolute error δ in
   the argument `x` becomes about `δ / (3x^(2/3))` in `∛x`, without bound as `x → 0`. An early round-trip test drew
   random OkLab values far outside any gamut and failed; it now starts from colours a print can have. A bound set
   from such tests is a measured maximum with a margin, not a guarantee; write down the cases and the margin. Where
   an output is not smooth, measure it in its own terms: a thresholded mask by the share of pixels that flip.
7. **Compute constants, do not copy them.** Ottosson's published OkLab matrix maps white to (1, 0, 0) only within
   4 × 10⁻⁸, and his published inverse is rounded to ten digits, so round trips drift by 2 × 10⁻⁷. chromobench
   normalises the rows of the first matrix so white gives equal cone responses (LMS), tests white to 5 × 10⁻⁸, and
   computes every inverse in 64 bits instead of copying it.
8. **Let the compiler place conversions.** Each chromobench operation declares its encoding; the compiler inserts
   `composite.encode` where neighbours disagree, and "a conversion of a conversion converts the original node
   instead". Every conversion has one form, `post · f(pre · v)` with `f` the identity, a cube root or a cube, and the
   GPU runs it as one opcode of its fused pointwise pass (each output pixel from the same pixel of its inputs). The
   per-channel curves act on the cube root of each linear RGB channel, so they stay linear and fuse with exposure.
9. **A table for a conversion is a precision decision.** Editor lab's sRGB tables hold 4,097 entries in 32-bit
   floats and are read at the nearest entry. Encoding near black, where the curve's slope is 12.92, the worst error is
   half a step times the slope: 12.92 / 8,192 ≈ 0.0016, 0.4 of an 8-bit level. Its GPU path calls the power function
   instead, so its two engines differ by construction. State the table's error and make the reference use the same
   table, or keep the exact function in both ([Chapter 2](02-precision-ladder.md)).
10. **Say what the right encoding does to the look.** chromobench chose linear light for multiply and screen, so a
    multiply layer acts as a filter. In its test documents the stack of blend layers came out darkest, with a mean
    display value of 0.25 against 0.58 for a stack of tone adjustments. Thresholds move too: overlay switches branch
    at 0.5, which in linear light is display value 0.735, not mid-grey. Presets tuned on sRGB numbers "do not
    transfer and are re-tuned", says its design. Tell the users, not only the code.

## Variations

- **One linear working space, display-encoded storage.** Decode on read, compute everything in linear light, encode
  on write; GPUs can decode sRGB textures in hardware when sampling. Simplest, and right for light; curves and hue
  controls feel uneven and need their own conversions.
- **A log working space.** Exposure and printer lights become offsets, as in film scanning and log grading spaces.
  Blurs, resizes and blends are wrong unless they convert to linear first.
- **A perceptual working space.** Edit in CIELAB or OkLab throughout: chroma and hue operations are simple, but
  averages darken edges and blends no longer model light.
- **Per-operation encodings, planned.** The form of the Solution: each operation in its own encoding, conversions
  inserted and cancelled by a planner. The best fit, at the price of a planner and an error ledger per conversion.

## Consequences

- \+ Each operation is a few lines of its own mathematics: a scaling, an offset, a weighted sum.
- \+ Operations commute with the averaging done by previews, tiles and filters, so a preview can be compared with
  the full result.
- \+ Errors are bounded per conversion, at known ill-conditioned points, instead of spread through every operation.
- − Conversions cost time and precision and must be measured, including at the edges of their range.
- − Results differ from programs that compute on display values; users and presets must be told.
- − A planner, declared encodings and the order of terminal steps become part of the design to maintain.
- − Storing linear light needs more bits than storing display values, which moves cost to memory.

## Known uses

- **Porter and Duff**, "Compositing Digital Images", SIGGRAPH 1984: premultiplied colour, in which `over` and its
  siblings are linear in colour and coverage alike. Jim Blinn, "Compositing, Part 1: Theory", *IEEE Computer
  Graphics and Applications*, 1994, makes the case for filtering too.
- **Homomorphic filtering**: Alan Oppenheim, Ronald Schafer and Thomas Stockham, "Nonlinear Filtering of Multiplied
  and Convolved Signals", *Proceedings of the IEEE* 56(8), 1968. The logarithm turns illumination times reflectance
  into a sum that linear filters can separate.
- **Log-sum-exp** in hidden Markov models and softmax layers: products of probabilities as sums of logarithms, sums
  of probabilities as `m + log Σ exp(xᵢ − m)` with `m` the largest term.
- **OkLab**, Björn Ottosson, "A perceptual color space for image processing", a blog post (2020), not a peer-reviewed
  paper; CSS Color Level 4 adopted it as `oklab()` and `oklch()`.
- **Linear workflows in renderers**: shading in linear light, with sRGB texture and framebuffer formats that decode
  on sampling and encode on writing (OpenGL's `EXT_texture_sRGB`, WebGPU's `rgba8unorm-srgb`).
- **ACES and OpenColorIO**: a linear scene-referred working space (ACEScg) beside log encodings for grading
  (ACEScc, ACEScct), with explicit transforms between them.
- **Film scanning**: Kodak's Cineon format stores printing density (the density print film sees), 0.002 per
  10-bit code value, so printer-light changes are offsets.
- **chromobench** (light, density, OkLab, the knee, the light law) and **Editor lab** (premultiplied colour, sRGB
  tables, linear exposure).

## Related chapters

- [Chapter 2 · Precision Ladder](02-precision-ladder.md): how many bits each encoding needs, and where.
- [Chapter 5 · Fused Interpreted Passes](05-fused-interpreted-passes.md): pointwise conversions fuse with their
  neighbours.
- [Chapter 3 · One Grid Rule](03-one-grid-rule.md): averaging on a common grid, which this chapter makes meaningful.
- Image engine volume: [Domain-Typed Image Pipeline](../05-domain-typed-pipeline.md) names and checks the encodings
  this chapter chooses; [Tabulated Preview, Exact Export](../06-tabulated-preview-exact-export.md) treats tables of
  conversions.
- Modular volume: [A Slot in the Formula](../modular/04-a-slot-in-the-formula.md), where the slot's input form is
  straight colour inside premultiplied `over`.
- GoF: **Adapter** (a conversion), **Strategy** (the encoding an operation declares).

## Exercises

1. **Pyramid and exposure (implement and measure).** Build a 1,024 × 1,024 test image with sharp black-and-white
   edges and a smooth gradient, in 8-bit sRGB. Make a quarter-size image by averaging 4 × 4 blocks, once on sRGB
   values and once in linear light. Apply +1 EV in linear light to each and compare with the full-size result
   averaged down: the largest difference, and the share of pixels off by more than 4 levels. Then use 4,096-entry
   nearest-entry tables for the sRGB curve: how much of the difference is table error?
2. **Conditioning of OkLab (analyse).** OkLab is `M2 · ∛(M1 · rgb)`. A blend computed in RGB on an OkLab layer
   converts its result back through `∛`. If a blended cone response `x` carries an absolute error of 2⁻²⁴ (from
   cancellation in exclusion, `b + s − 2bs`), what is the error of `∛x` as a function of `x`? Below which `x` does it
   exceed 10⁻⁴, and which pair of colours produces such an `x`? Why does a plain round trip not show the problem?
3. **Over is linear (prove).** Show that `over` on premultiplied colour is associative and is an affine map of the
   backdrop, and that on straight colour the result is a rational function of the backdrop's colour and alpha. Then
   show that a box filter applied to premultiplied pixels before `over` gives the same result as after it.
4. **Hidden Markov model (another domain).** Implement the forward algorithm for a two-state model over 2,000
   observations, in probabilities and in log-probabilities with log-sum-exp. At which step does the first underflow
   to 0 in 64 bits? Which of the algorithm's operations is linear in which representation, and where does your
   implementation convert?
