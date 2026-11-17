# Chapter 4 · A Slot in the Formula

*Keep the invariant skeleton fixed and let variation in at exactly one place.*

**★** A good form among several; the Variations section names the others.

## Intent

When a family of behaviours shares most of a computation, write the shared part once as a fixed skeleton with one
hole, and let each variant fill only the hole. Choose where the hole goes so that the properties every variant must
keep live in the skeleton, where no variant can reach them.

## Also known as

Template Method; Strategy; hook; plug-in point; higher-order function.

## Motivation

A layer in an image editor has a **blend mode**: normal, multiply, screen, overlay and a dozen more. The mode decides
what colour the layer gives where it lies over the **backdrop** (the picture already composited below it). Pixels also
carry **alpha**, the fraction of the pixel the layer covers, and editors store colour **premultiplied**: each channel
already multiplied by alpha, which makes compositing and blurring cheaper and correct at soft edges.

The naive design writes one compositor per mode. Each must handle alpha, the layer's opacity, its mask, premultiplied
storage, and the edge where the layer lies over nothing. Four things go wrong.

1. **Coverage drifts per mode.** A multiply compositor written as "backdrop × source" on whole pixels also multiplies
   where the backdrop is transparent, and changes alpha. Each compositor gets coverage right or wrong on its own.
2. **Variants see the wrong numbers.** Overlay chooses its branch by whether the backdrop is below 0.5. Given
   premultiplied colour, a half-transparent white pixel arrives as 0.5 and takes the dark branch.
3. **A fix must be made sixteen times.** When opacity 1 must give the blended colour exactly, not a rounded copy, the
   change goes into every compositor, and one is missed.
4. **New structure multiplies the copies.** Groups arrive (several layers treated as one), and a group's result is
   composited like a layer, in either of two ways. Every compositor is copied again.

Other domains share the shape. A sorting routine is the same for every ordering; only the comparison differs. A
numerical integrator steps the same way for every equation; only the right-hand side `f(t, y)` differs. A web
framework handles every request the same way, routing, sessions, errors, and differs only in the handler.

## Problem

**Where should the variable part of a computation go, so that each variant is small and none of them can break the
properties all of them must keep?**

## Forces

- **Small variants against expressive ones.** A narrow hole keeps each variant to one line; some variants need more
  (hue and saturation modes need all three channels at once).
- **Invariants in the skeleton against freedom in the variant.** Coverage must follow the same rule in every mode; a
  hole that sees alpha lets a mode break it.
- **One stated input against each variant's natural space.** The hole must receive values in one known form (straight
  colour, linear light); a variant may be most natural in another (luminosity is about lightness).
- **A call in the inner loop against specialised code.** A function per pixel per layer costs something; sixteen
  hand-specialised loops cost more to keep correct.
- **A fixed skeleton against later needs.** Masks and groups came after the first blend modes; a skeleton that cannot
  take them is rewritten.
- **Familiar results against the right arithmetic.** Users know multiply from programs that compute on the numbers as
  stored for the screen; multiply on numbers proportional to light is physically sounder and looks heavier.

## Solution

**Therefore: write the computation once as a fixed skeleton with exactly one hole: a small pure function with a stated
signature and a stated form for its inputs. Put the hole where the variation truly lives, and leave every property
that all variants must keep to the skeleton alone, where no variant can reach it (for compositing, the hole is the
blend function B(backdrop, source) of straight colours, used only for the part of a pixel where source and backdrop
overlap, while the over operator alone computes coverage, opacity and mask). Make the skeleton exact at its ends (for
compositing, strength 0 gives the backdrop and strength 1 gives the blend), so every variant inherits those laws. A
new variant is one new function; nothing else changes.**

## Applicability

Use it when:

- many variants share most of a computation and differ in one identifiable step;
- there are invariants every variant must keep (coverage, termination, stability, units);
- variants will be added over time, by other people.

Do not use it when:

- there are two variants and no third in sight; write both;
- the variants differ in structure, not in one step (a bubble sort and a merge sort share no useful skeleton);
- the hole would need so many inputs that it is the whole computation; then there are two programs, not one.

## Structure

| Participant | Responsibility |
| --- | --- |
| **Skeleton** | the over operator: coverage, opacity × mask, premultiplied storage, the three areas of a pixel |
| **Slot** | `B(backdrop, source) → colour`, pure, on straight colours in one stated space |
| **Variants** | the sixteen modes: twelve per-channel functions, four whole-colour functions |
| **Adapter** | puts values into the slot's form (divide out alpha; convert to the stated colour space) and back |
| **Amount** | `k = opacity × mask coverage`, computed by the skeleton, never seen by the slot |
| **Callers** | layers, and groups composited as one layer |

In a sort, the skeleton is the sorting algorithm, the slot is the comparator, and the invariants are termination and
stability. In an ODE solver, the skeleton is the stepper with its error control and the slot is `f(t, y)`.

## Collaborations

1. A layer arrives with its source, mode, opacity and mask.
2. The skeleton computes `k` from opacity and the mask's coverage ([Chapter 3](03-closed-algebra-of-small-parts.md)).
3. The adapter turns backdrop and source into straight colours in the slot's space.
4. The slot computes `B(backdrop, source)`.
5. The skeleton weights the three areas of the pixel, computes alpha by over, and stores the result premultiplied.

```mermaid
flowchart LR
  BK[backdrop] --> AD[divide out alpha]
  SR[source × k] --> AD
  AD --> B["slot: B(Cb, Cs)"]
  B --> W[weight the three areas]
  BK --> W
  SR --> W
  W --> C[colour out]
  SR --> A[alpha by over]
  BK --> A
```

Read it from left to right and notice what does not pass through the slot: alpha goes straight from the inputs to
"alpha by over", and the weights belong to the skeleton. A mode can only change the colour of the overlap.

## Sketch

```text
-- a Colour is (r, g, b), each in [0, 1], "straight" (not multiplied by α)
-- the slot: a pure function of two straight colours
type Blend = (backdrop: Colour, source: Colour) → Colour

-- variants: per-channel modes are one scalar function each, lifted to colours
perChannel(f) → Blend: (b, s) → (f(b.r, s.r), f(b.g, s.g), f(b.b, s.b))
modes ← {
  normal:     perChannel((b, s) → s),
  multiply:   perChannel((b, s) → b · s),
  screen:     perChannel((b, s) → b + s − b · s),
  overlay:    perChannel((b, s) → if b ≤ 0.5: 2·b·s else 1 − 2·(1 − b)·(1 − s)),
  difference: perChannel((b, s) → |b − s|),
  luminosity: (b, s) → withLightness(b, lightness(s)),   -- whole-colour: needs all three channels
  …                                                       -- sixteen in all
}
-- lightness(c): c's lightness in a lightness–chroma–hue colour space
-- withLightness(c, L): c converted to that space, its lightness replaced by L, converted back

-- the skeleton: over in premultiplied colour, the slot only in the overlap term
value Pixel: c (colour already multiplied by α), α (the fraction of the pixel covered)

composite(back: Pixel, src: Pixel, k, B: Blend) → Pixel:
  αs ← src.α · k                                -- opacity and mask enter here, never in B
  if αs = 0: return back
  Cs ← src.c / src.α
  Cb ← if back.α > 0: back.c / back.α else 0    -- the slot sees straight colour
  c ← αs·(1 − back.α)·Cs  +  αs·back.α·B(Cb, Cs)  +  (1 − αs)·back.c
  α ← αs + (1 − αs)·back.α                      -- coverage: the same for every mode
  return Pixel(c, α)

-- with an opaque backdrop the skeleton reduces to a mix, exact at both ends
mix(back, top, k, B) → Colour:
  if k = 0: return back
  if k = 1: return B(back, top)
  return back + k · (B(back, top) − back)

-- groups: where the backdrop enters is the only difference
-- children(x): the group's layers composited in order on x; transparent: every pixel with α = 0
-- (pass-through mixes whole pixels, treating α as a fourth channel)
passThrough(back, children, k)  = mix(back, children(back), k, modes.normal)
isolated(back, children, k, B)  = composite(back, children(transparent), k, B)

-- in use, at pixel p: below is the picture already composited under the layer,
-- mask is the layer's mask from Chapter 3, layer.pixel(p) is the layer's own pixel
out ← composite(below(p), layer.pixel(p), k: layer.opacity · mask(p, below), B: modes[layer.mode])
```

## Implementation notes

1. **The slot sees straight colour.** Editor lab, the teaching editor, keeps pixels premultiplied, divides the
   backdrop by its alpha before calling its blend function, and weights the result back. A mode given premultiplied
   numbers would take wrong branches at soft edges (exercise 3).
2. **Coverage never passes through the slot.** In the W3C formula (Compositing and Blending Level 1, the web's
   standard) the alpha result is the same for every mode; Editor lab computes it in one line after the colour.
3. **Opacity and mask enter outside the slot.** Both programs compute `k` as opacity times mask coverage in the
   skeleton. No mode knows what a mask is, so the mask algebra of [Chapter 3](03-closed-algebra-of-small-parts.md)
   grew without touching a mode.
4. **Make the skeleton exact at its ends, and test it.** chromobench's mix returns the backdrop itself at `k = 0`
   and the blend itself at `k = 1`, not `back + 1·(B − back)`, which rounds; its GPU version does the same, and a
   test checks both ends for all sixteen modes. A layer at full opacity, unmasked, in normal mode produces no mix at
   all.
5. **The slot's input form is part of its contract.** chromobench computes the per-channel modes on numbers
   proportional to light, and hue, saturation, colour and luminosity in a lightness–chroma–hue space; the engines
   refuse a blend other than normal on values in any other form. Users see the choice: in the project's test
   documents a stack of blend layers came out darkest (mean display value 0.25 against 0.58 for tone adjustments),
   because multiply on light acts like a filter.
6. **Give the slot the whole colour, and lift the simple cases.** A slot typed per channel cannot hold the four
   whole-colour modes; the slot takes colours, and a helper lifts a scalar function into one. chromobench's
   luminosity mode can produce colours the screen cannot show, and a later stage compresses them: a recorded debt.
7. **One skeleton, not three.** Editor lab has one blend function but writes its skeleton three times: the full
   formula for image layers and two shortened mixes for adjustment layers, so a fix to one misses the others.
   chromobench has one mix for layers and groups.
8. **The slot is written twice; keep the copies honest.** chromobench's modes exist once for its CPU reference
   engine and once in the GPU's shading language, branch for branch. Tests found the two within 1.1 × 10⁻⁴ on every
   mode (most within 5.3 × 10⁻⁶), far below one step of an 8-bit display (1/255 ≈ 0.004); see
   [Chapter 1](01-one-contract-several-engines.md).
9. **A pure slot lets the skeleton merge with other work.** Because `B` reads one pixel and keeps no state,
   chromobench blends an unmasked per-pixel layer in the same pass as the work before it, with no extra image.
10. **Groups: decide where the backdrop enters.** Editor lab's pass-through group mixes towards its children's
    result by `k`; its isolated group composites the children on transparent and blends the result as one layer.
    The two agree when every child is a normal image layer, because over is associative. chromobench has no layers
    of stored pixels, so its isolated group applies the children to the backdrop and blends their result
    with the group's mode; in normal mode it equals pass-through, and a test checks that.
11. **Keep the set of variants principled.** Editor lab offers the W3C sixteen plus add and subtract. chromobench
    took the sixteen, from one declared list that its validator, catalogue, GPU code and scripting layer read
    ([Chapter 2](02-one-declaration-many-readers.md)).
    A cheap slot is a reason to choose variants with care.

## Variations

- **Strategy object.** The slot is an object with several methods (blend, a name, a cost). More room per variant;
  more ways to reach the invariants.
- **Several hooks** (Template Method with "before" and "after" steps). Flexible; each extra hook is one more place a
  variant can break the skeleton.
- **Vary the areas, not the colour.** Porter and Duff's twelve operators (over, in, out, atop, xor, …) put the hole in
  the weights of the areas of a pixel. The W3C specification keeps both holes: a compositing operator and a blend mode.
- **Specialise at build time.** Generate one loop per mode from the same skeleton. Fastest, with a compile per
  variant; the skeleton is still written once.

## Consequences

- \+ Each variant is a few lines with no knowledge of alpha, masks, groups or storage.
- \+ Invariants (coverage, exact ends, the input form) are written and tested once, and hold for every variant.
- \+ New structure (masks, groups) is added to the skeleton once and reaches every mode. That is what makes the code
  habitable: a newcomer adds a mode by reading one table, without first understanding compositing.
- − The slot's signature is a commitment; a variant that needs more input forces a change to every caller.
- − The input form is a hidden choice with visible results (heavy multiply).
- − A function call in the inner loop costs time unless the skeleton is merged or specialised.
- − A cheap slot invites variants nobody needs.

## Known uses

- **W3C Compositing and Blending Level 1**: the separable blend function `B(Cb, Cs)` inside the general compositing
  formula; CSS `mix-blend-mode` and SVG use it.
- **Porter and Duff**, "Compositing Digital Images" (SIGGRAPH 1984): over and its eleven siblings on premultiplied
  colour.
- **Cairo, Skia and Core Graphics** (2D drawing libraries): blend modes (multiply, screen, …) offered beside the
  Porter–Duff operators in one compositing path.
- **Photoshop and GIMP** layer modes; Photoshop's pass-through groups.
- **Comparator arguments to sort** (C's `qsort`, Java's `Comparator`).
- **ODE solvers** that take the right-hand side `f(t, y)` as an argument (MATLAB's `ode45`, SciPy's `solve_ivp`).
- **`fold` and `reduce`** with a combining function.

## Related chapters

- [Chapter 3 · Closed Algebra of Small Parts](03-closed-algebra-of-small-parts.md) supplies the mask whose coverage
  becomes `k`.
- [Chapter 1 · One Contract, Several Engines](01-one-contract-several-engines.md): the slot in two engines, kept in
  agreement.
- [Chapter 2 · One Declaration, Many Readers](02-one-declaration-many-readers.md): the list of modes declared once.
- [Chapter 5 · Solve Once, Apply Many](05-solve-once-apply-many.md): keep work that does not change per pixel out of
  the slot.
- Parent volume: [Barrier-Cut Fusion](../07-barrier-cut-fusion.md), for merging a pure slot into one pass.
- GoF: **Template Method** (the skeleton), **Strategy** (the variant); this chapter is about where the hole goes.

## Exercises

1. **Sorting.** A team has one sort function per ordering (by name, by date, by size). Rewrite it as one sort with a
   comparator slot. Sort `[("b", 2), ("a", 2), ("c", 1)]` by the number: which property keeps `b` before `a`, and is
   it the skeleton's or the comparator's job? What does your sort do with a comparator that says `x < y` and `y < x`?
2. **Prices.** A shop computes base price, then discount, then 20 % tax, then rounding to cents. Discounts vary
   (10 % off; 3.00 off). For a base of 19.99, compute the price with the discount slot before tax and with it after
   rounding. Which placement can make the same discount give different taxes, and which keeps tax and rounding right
   for every discount?
3. **Overlay by hand.** Take a backdrop of white at alpha 0.5 and a grey source at 0.3, alpha 1. Compute overlay once
   on premultiplied numbers and once through the sketch's `composite`. Which branch does each take?
4. **Your own code.** Find a function that switches on a "mode" flag in more than one place. Which forces from this
   chapter does it show? Where would the one slot go?
