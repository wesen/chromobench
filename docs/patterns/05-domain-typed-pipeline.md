# Chapter 5 · Domain-Typed Image Pipeline ★

*Every image between two operations carries a domain: what its numbers mean, in which unit, with how many channels.
Operations declare the domains they accept and produce, and the graph refuses a mismatch with a hint.*

## Intent

Make the meaning of pixel values a checked property of the pipeline instead of a convention in people's heads. An
image is not "an RGB float buffer"; it is scanner density, film dye amounts, paper log exposure, light reflected from
a print, or encoded display values, and an operation that is correct for one is wrong for the others. Declaring and
checking domains catches the class of bugs where a correct operation is applied to the wrong numbers.

## Also known as

Typed image pipeline; colour-space tagging; scene-referred / display-referred discipline; units of measure for
pixels; pixel formats with semantics.

## Motivation

The running example's chain passes through a dozen kinds of number: linear sensor values, scanner density
(−log₁₀ of transmittance relative to the film base), film log exposure, film dye amounts, printing density, paper log
exposure, paper dye amounts, XYZ of the print under a lamp, encoded display RGB, one-channel masks, integer class
codes. They are all arrays of floats. Without domains, four things go wrong.

1. **Correct code, wrong numbers.** A blur designed for light, applied to log exposure, averages logarithms; the
   result is darker than the physics. A curve designed for display values, applied to linear light, bends the wrong
   tones.
2. **Blending in the wrong encoding.** Editor lab does its arithmetic on sRGB-encoded numbers and converts to linear
   light only inside two adjustments. Its multiply and screen modes and its blurs are therefore not physical, and its
   pyramid, which averages sRGB values, disagrees with level-0 renders exactly where linear-light adjustments act.
3. **A missing step goes unnoticed.** Printing a negative requires inverting it first; a pipeline that accepts any
   float image lets a caller expose paper through the scan's raw density.
4. **Errors without directions.** When a mismatch is detected at run time, the message says "wrong values", not what
   to do.

Audio pipelines (time-domain samples against spectra, dB against linear gain), geospatial processing (geographic
against projected coordinates) and medical imaging (raw counts against calibrated units) all need the same discipline.

## Problem

**How do you prevent operations from being applied to numbers whose meaning they do not handle, when every
intermediate is just an array of floats?**

## Forces

- **Safety against flexibility.** Strict domains catch misuse; generic operations (a crop, a statistic) should accept
  anything.
- **Few domains against precise ones.** "Linear" and "encoded" are easy to teach; a physical pipeline needs a dozen.
- **Static against dynamic checking.** A type system catches errors at compile time but cannot see a domain chosen
  by an argument; a graph builder sees every edge when it is made.
- **Conversions against surprises.** Automatic conversion is convenient and hides costs and precision loss; explicit
  conversion is verbose and honest.
- **Domains against resolution.** A domain says what a value means, not at what sampling it was measured; some
  results depend on both.

## Solution

**Therefore: define a closed set of domains, each with its meaning, unit, channel count and plausible range. Make
every operation declare the domains it accepts (one, several, any, or "the same as its input") and the domain it
produces (fixed, same, or chosen by an argument). Infer each node's domain when the graph is built and refuse a
mismatch at that moment, with a hint computed from the registry: an operation that turns the given domain into the
needed one. Make conversions explicit operations. Name the important boundaries of the pipeline with accessors, so
people and programs can ask for "the negative" or "the print" and receive a node of a known domain.**

## Applicability

Use it when:

- the pipeline carries more than one kind of number in arrays of the same machine type;
- some operations are only meaningful in some of them (blending, blurring, curves, statistics);
- people or agents compose operations freely (a scripting language, a node editor).

Do not use it when:

- the pipeline has one domain end to end (an 8-bit display editor that never converts);
- the cost of declaring domains exceeds the cost of the bugs: a short fixed pipeline written by one person;
- the domain is genuinely unknown (an arbitrary file); then the first operation must assign one explicitly.

## Structure

| Participant | Responsibility |
|---|---|
| **Domain table** | each domain's meaning, unit, channels, plausible range, optional extra channel |
| **Operation declaration** | `domainIn` (one, several, any) and `domainOut` (fixed, same, from argument) (Chapter 2) |
| **Graph builder** | infers each node's domain and refuses mismatches at intern time (Chapter 1) |
| **Hint finder** | searches the registry for an operation from the given domain to the needed one |
| **Conversion operations** | the only places a domain changes without a physical step |
| **Accessors** | named boundaries (`negative`, `print`, `display`) returning nodes of known domains |

## Collaborations

1. A source operation assigns the first domain from the file's kind.
2. Each `intern` checks the receiver's domain against the operation's `domainIn`; the new node's domain follows from
   `domainOut`.
3. On a mismatch the builder asks the hint finder for an operation producing the needed domain from the given one
   and refuses with "call X first".
4. Mask-typed arguments are checked the same way: a mask argument must be a node of domain `mask`.
5. Accessors find the node at a named boundary; their domain is part of their contract.

## Sketch

```text
value Domain: name, meaning, unit, channels, range
domains ← { camera-linear, scanner-density, film-dyes, paper-logH, print-xyz, display-rgb, mask,
    … }

declare op "invert.dyes":  in scanner-density → out film-dyes
declare op "print.expose": in film-dyes      → out paper-logH
declare op "mask.feather": in mask           → out same
declare op "measure.stats": in any           → returns a value

intern(graph, op, inputs, args) → node:
  given ← domainOf(inputs.receiver)
  if not accepts(op.domainIn, given):
    via ← first o in registry where accepts(o.domainIn, given) and produces(o, op.domainIn)
    refuse("domain", op.name ++ " takes " ++ op.domainIn ++ "; this input is " ++ given,
           hint: via ? "call " ++ via.name ++ " first" : "ops producing " ++ op.domainIn ++ ": …")
  out ← match op.domainOut: same → given; fromArg(a) → args[a]; d → d
  return node with domain out

accessor "negative" → the node of op "invert.dyes"      -- domain film-dyes
accessor "print"    → the node of op "view.adapt"       -- domain print-xyz

-- in use
frame.scan().expose(paper)    → refusal: "print.expose takes film-dyes; this input is
    scanner-density
                                          (call invert.dyes first)"
frame.negative().expose(paper) → node in paper-logH
```

## Implementation notes

1. **Refuse when the edge is made, not when pixels flow.** The running example checks domains inside `intern`, so an
   ill-typed graph cannot exist; an engine never sees one, and an agent's mistake is reported at the call that made
   it.
2. **Compute the hint from the registry.** "Call `invert.dyes` first" is found by searching for an operation that
   accepts the given domain and produces the needed one. A hint table maintained by hand rots as operations are added.
3. **Give each domain a plausible range and say what it bounds.** The running example's range "bounds the generator;
   never clamps real data": it tells the conformance generator (Chapter 3) what inputs make sense without silently
   altering a real image that falls outside.
4. **Keep "same" and "from argument" as first-class outputs.** Generic operations (crop, feather, orientation) are
   `same`; a few choose their output by argument. Without these forms, every generic operation needs a copy per
   domain.
5. **Tie domains to the reference model's names.** The running example records, per domain, the name of the
   corresponding tap in the physical model it was ported from, so a numerical comparison with that model compares the
   same quantity.
6. **Encoding is a domain too.** Editor lab's lesson: values that are sRGB-encoded and values that are linear light
   are different domains even with identical channel layouts. goja-cv makes the same distinction explicit: every
   image carries an encoding and a space, images open "in file units", and `img.as("linear")` converts; "every op
   works in its receiver's space".
7. **Luminance is defined per domain.** Editor lab uses Rec. 709 weights; the W3C blending specification uses
   0.3/0.59/0.11. A pipeline with domains defines luminance once per domain instead of once per operation.
8. **Domains do not capture sampling.** The running example's first print metered a 640 px image on one engine and a
   4,000 px image on the other; both were the same domain, and the results differed enough to change a decision.
   When a measurement drives a decision, pin its resolution as well (Chapter 6).
9. **Conversions should be visible operations.** An implicit conversion hides cost and precision loss; a graph node
   named for it shows up in profiles, documentation and the agent's explanations.

## Variations

- **Type-level domains.** Encode domains in the host language's types (phantom types, units of measure). Catches
  errors before running; cannot express domains chosen by an argument or loaded from data.
- **Format negotiation.** Operations declare acceptable pixel formats and a conversion layer inserts conversions
  automatically (GEGL with babl). Convenient for generic operations; conversions become invisible.
- **Two-domain discipline.** Only "scene-referred" and "display-referred". Easy to teach and enough for many editors;
  too coarse for physical simulation.
- **Tagged buffers at run time.** Each buffer carries its domain and operations assert on entry; simple to add to an
  existing engine, but errors appear only when pixels flow.

## Consequences

- \+ A whole class of "correct operation, wrong numbers" bugs becomes impossible to construct.
- \+ Refusals teach: a person or agent learns the pipeline from its hints.
- \+ Accessors give stable names to meaningful places in the pipeline.
- − Every operation must declare domains, and generic ones need `any` or `same`.
- − The domain set is a design decision that is costly to change once documents depend on it.
- − Domains do not capture resolution, sampling or calibration state; those need their own discipline.

## Known uses

- **ACES** separates scene-referred working spaces from display-referred output through defined transforms.
- **OpenColorIO** configurations name colour spaces, mark data spaces that must not be colour-managed, and convert
  explicitly between them.
- **GEGL and babl** name pixel formats with their encoding and premultiplication (for example linear `RGBA float`
  against perceptual `R'G'B'A float`) and convert between them.
- **F# units of measure** check physical units at compile time.
- **PROJ** describes coordinate reference systems and transforms between them explicitly.
- **goja-cv** tracks an encoding and a space on every image node and converts with `as(...)`.

## Related chapters

- [Chapter 2 · Unit-Tagged Parameter Catalogue](02-unit-tagged-parameter-catalogue.md) holds the domain declarations.
- [Chapter 1 · Interned Operation Graph](01-interned-operation-graph.md) checks them at intern time.
- [Chapter 12 · Shared Handle Vocabulary](12-shared-handle-vocabulary.md) builds on the accessors.
- [Chapter 6 · Tabulated Preview, Exact Export](06-tabulated-preview-exact-export.md) handles the sampling that domains
  do not.
- GoF: **Adapter** (conversion operations), **Template Method** (the builder's fixed check, the operations' declared parts).
