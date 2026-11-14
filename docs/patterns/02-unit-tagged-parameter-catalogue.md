# Chapter 2 · Unit-Tagged Parameter Catalogue ★★

*Declare every operation's parameters once, with types, units, ranges and hints, and generate validation, controls,
documentation and scripting types from that one declaration.*

## Intent

Keep a single registry of operations in which every parameter states its type, physical unit, hard range, usual
range, default, documentation, interface hints and the document path it is stored at. Everything that needs to know
about parameters (the validator, the controls, the scripting language's types, the reference documentation, the
test generator, the geometry scaler) reads the registry instead of carrying its own copy.

## Also known as

Parameter schema; property metadata; operation descriptors; single source of truth for parameters.

## Motivation

The running example's enlarger has an exposure time. Its value matters in at least seven places: the recipe
validator must reject −3 s; the slider needs a range and a step; the text box must understand "+1/3 st" and
"12.6 s"; the agent's scripting language needs a type with a doc comment; the reference documentation lists it; the
conformance generator must produce plausible values; and a full-resolution export must know whether the value scales
with the picture (a time does not; a crop does). Written seven times, these drift:

1. **The documentation offers what the validator refuses.** Editor lab's agent reference documents
   `set(…, { mask: { feather } })`; its validator rejects `feather`, so agents fail on a documented call.
2. **A round trip loses fields.** Editor lab's code layers accept `[min, max, value, label, unit, step]` in one
   parser and drop `step` in another; every "Edit as code" round trip loses slider steps.
3. **Units are implicit.** A radius in pixels and a radius in micrometres on the film look the same to a slider.
   When the running example added full-resolution export, it had to find every pixel-unit argument by hand until it
   noticed the catalogue already tagged them.
4. **Controls disagree with the engine.** A slider whose range is wider than the validator's clamps silently.

Audio plugins (gain in dB, frequency in Hz), parametric CAD (lengths in mm, angles in degrees) and machine-learning
configuration (learning rates on a log scale) have the same problem.

## Problem

**How do you keep everything that depends on a parameter's meaning (validation, controls, scripting, docs, tests,
scaling) consistent as operations are added and changed?**

## Forces

- **One place against many readers.** Each consumer wants a different view: the validator wants bounds, the UI wants
  widgets, the scripting language wants types.
- **Semantics against presentation.** A hard range is a fact about the operation; a slider's usual range and step are
  a choice about the interface. Mixing them makes one change the other.
- **Declared units against convenient numbers.** Units in the declaration cost a field per parameter and pay off only
  when something converts, scales or parses.
- **Generation against hand-tuning.** Generated controls are consistent; some controls need a hand-made form.
- **Stability against evolution.** Changing a declared default changes every document that omitted the value.

## Solution

**Therefore: make the operation registry the only declaration of parameters. For each argument record its type, its
unit, its hard range and its usual range, its default, its documentation, its interface hints (widget, label, group,
step, scale) kept apart from its semantics, and the document path it is stored at. Validate documents, generate
controls, scripting types and reference pages, bound test generators and drive unit-aware transformations (typed
entry, scaling, conversion) from the registry. Check in CI that every generated artefact is current, and treat a
change of a declared default or range as a versioned change of the document format.**

## Applicability

Use it when:

- there are more than a handful of operations with parameters, and more than one consumer of their meaning;
- parameters have units, or must be scaled, converted or parsed from text;
- people and programs both set parameters.

Do not use it when:

- the system has a few fixed parameters with one consumer (a hand-written form is clearer);
- parameters are open-ended user data with no fixed meaning (a key-value bag); a catalogue would only describe "any".

## Structure

| Participant | Responsibility |
|---|---|
| **Operation declaration** | name, receiver kind, input and output domains, class (pointwise, spatial), documentation, examples |
| **Argument spec** | type, unit, hard range, usual range, default, optional, doc, document path, interface hints |
| **Registry** | holds declarations; answers `op(name)`, `allOps()`, `ownerOf(path)` |
| **Binder** | validates and canonicalises raw arguments against specs (Chapter 1 uses it) |
| **Generators** | scripting types, reference docs, controls, conformance values, all derived from the registry |
| **Unit services** | parse typed entry, format values, scale geometry, convert between units |
| **Freshness check** | fails the build when a generated artefact differs from what the registry would produce |

## Collaborations

1. An operation is added by writing one declaration.
2. The build regenerates scripting types and reference pages; the freshness check fails if someone forgot.
3. At runtime, the binder validates a document's values against the spec of the argument that owns each path.
4. The interface asks the registry for a control model per path; widgets, steps and labels come from the hints,
   bounds from the semantics.
5. A unit-aware service (typed entry, an export scaler) asks for every argument with a given unit.

## Sketch

```text
value ArgSpec: type, unit, min, max, usual, default, optional, doc, path, ui
value OpDecl: name, receiver, domainIn, domainOut, class, args: map name → ArgSpec, doc, examples

declare op "print.expose":
  receiver image, domain film-dyes → paper-logH, class pointwise
  args:
    time:   ArgSpec(number, unit: seconds, min: 0.1, max: 600, usual: 2..60, default: 10,
                    path: "print.enlarger.time", ui: { widget: slider, step: 0.1, label: "Time" })
    filter: ArgSpec(cmy, unit: CC, min: -100, max: 200, default: (0, 0, 0),
        path: "print.enlarger.filtration")
    paper:  ArgSpec(stockId, valuesFrom: "papers", default: "endura", path: "print.paper")

bind(op, raw) → Args or refusal:
  for each (name, spec) in op.args:
    v ← raw[name] if present else spec.default
    if not typeOk(spec, v) or not inRange(spec, v): refuse("range", name, spec.min, spec.max,
        fix: clamp(v))
  return canonical(v for each name)

-- consumers, all from the same declarations
controlFor(path) → widget(spec(ownerOf(path)).ui, bounds: spec.min..spec.max)
parseEntry(path, "+1/3 st") → unitService(spec.unit).relative(current, "+1/3 st")
scaleGeometry(doc, k) → for each path whose spec.unit = pixels: doc[path] × k
generateTypes(), generateDocs()                 -- checked fresh in CI
```

## Implementation notes

1. **Separate hard range from usual range.** The running example declares `min: 0.1, max: 600, usual: [2, 60]` for
   exposure time. Validation uses the hard range; sliders open on the usual range; typed entry may go beyond it.
2. **Bind document paths to their owners and check the binding.** Each settable recipe path names the operation
   argument that owns it, and the registry verifies at load time that every owner exists and agrees. A path without
   an owner cannot be validated.
3. **Put presentation in a separate block.** Widget, label, group, step and display scale live under `ui`. Changing a
   label must never change a document's meaning.
4. **Units are worth it the first time something scales.** The running example tags `px`, `s`, `fstop`, `CC`,
   `logH`, `µm`. The export scaler (Chapter 9) found every pixel argument by asking for `unit: px`; nothing else had
   to be listed by hand.
5. **Say what the unit is relative to.** This is the bug the originating project shipped: `px` meant pixels of the
   *working image*, which differs between engines (4,000 px against 640 px), so a crop saved on one engine was wrong
   on the other. goja-cv's unit `DocPx` is defined as "length or coordinate in original-image pixels; scaled per
   evaluation", which makes the same declaration safe at any resolution.
6. **Typed entry belongs to the unit, not the widget.** The running example parses "15.12 s", "+1/3 st", "f/8",
   "62.5 CC" in the unit service, so a slider, a text box and the agent all accept the same spellings.
7. **Generate, and check freshness in CI.** Scripting types and reference pages are generated (`pnpm gen`) and a
   check fails the build when they are stale. Hand-maintained copies are where Editor lab's documentation and
   validator diverged.
8. **One parser for the spec shorthand.** If a short form exists (`[min, max, value, label, unit, step]`), exactly
   one function expands it. Editor lab had two; one ignored `step`.
9. **Defaults are part of the document format.** Changing a default changes every stored document that omitted it.
   The running example records such changes in its contract decisions and canonicalises defaults explicitly, so a
   saved document stores what it meant.
10. **Use the catalogue to bound test generators.** Domain ranges and argument ranges tell the conformance generator
    what inputs are plausible (Chapter 3); a generator that ignores them tests impossible values.
11. **Plan for "advanced".** Some parameters belong behind a disclosure. A metadata flag (`advanced: true`) in the
    hints lets every generated panel hide them consistently instead of each layout deciding.

## Variations

- **Schema documents.** JSON Schema or a similar external schema plays the registry's role; generic tooling exists,
  but units and recipe paths must be added as extensions.
- **Code-first properties.** Parameters are declared as annotated fields of the operation's class (property macros);
  the declaration sits next to the code, at the cost of reflection to read it.
- **Per-consumer descriptors.** Each consumer gets a thin descriptor derived once at build time; faster at runtime,
  one more generated artefact to keep fresh.

## Consequences

- \+ Validation, controls, scripting and documentation cannot disagree about a parameter.
- \+ Unit-aware features (typed entry, scaling, conversion) are written once and apply to every operation.
- \+ Adding an operation is one declaration; the interface and the scripting language follow.
- − The registry becomes a central dependency; every package that reads parameters imports it.
- − Generated artefacts need a build step and a freshness check, or they rot silently.
- − Hand-crafted controls still need an escape hatch, which can become a second source of truth if overused.

## Known uses

- **GEGL** declares operation properties with value ranges, interface ranges and metadata such as units.
- **Blender** declares data properties through its RNA system with types, subtypes and units; the Python-defined
  interface draws controls from those definitions.
- **VST3 and OpenFX** plugin interfaces publish parameter descriptors (names, ranges, defaults, units or hints) that
  hosts use to build generic controls and automation.
- **JSON Schema form generators** derive forms and validation from one schema.
- **goja-cv** tags numeric arguments with units (`DocPx`, `Fraction`, `DocPx2`, `Level`) and scales document-pixel
  arguments per evaluation.

## Related chapters

- [Chapter 1 · Interned Operation Graph](01-interned-operation-graph.md) uses the binder to canonicalise arguments.
- [Chapter 5 · Domain-Typed Image Pipeline](05-domain-typed-pipeline.md) extends the declaration with input and
  output domains.
- [Chapter 9 · Vector Edit Document](09-vector-edit-document.md) relies on units to rescale stored geometry.
- [Chapter 10 · Two-Vocabulary Layout DSL](10-two-vocabulary-layout-dsl.md) generates its controls from the catalogue.
- [Chapter 3 · Reference Oracle](03-reference-oracle.md) bounds its generators by the declared ranges.
- GoF: **Prototype** (defaults as a prototype document), **Abstract Factory** (one declaration, many products).
