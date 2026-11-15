# Chapter 9 · Vector Edit Document ★★

*Store an edit as parameters and vectors in resolution-free units, never as pixels; change it only through logged
mutations; compile it into a graph whenever pixels are needed.*

## Intent

Keep the user's work as a small, versioned document that describes what was done (settings, geometry, masks as
recipes, retouching as spots, strokes as point lists), in units that do not depend on the resolution it was edited
at. Every change is a mutation recorded with its author in an append-only journal, and pixels are always derived by
compiling the document. The same document then renders a thumbnail, a preview, a full-resolution export or a print
on another machine, and can be undone, diffed, approved, migrated and explained.

## Also known as

Non-destructive editing; parametric document; edit recipe; develop settings; sidecar; edit decision list.

## Motivation

The running example (chromobench, a browser darkroom) stores one recipe per frame: the source file's hash and decode
options, scan or capture settings, enlarger settings, dodge and burn exposures with masks, retouch spots, finishing
values, crop and orientation. Four naive choices fail.

1. **Storing pixels.** Saving the edited image (or painted mask pixels) fixes the result at one resolution. Editor
   lab (a browser photo editor) stores brush mask components as document-aligned pixel rasters; its own source shows
   they stay in place when their layer is moved (`src/workspace.js:410` in its archive).
2. **Coordinates in working pixels.** This is the bug the running example shipped: its crop, spots and masks were
   stored in pixels of the engine's working image (4,000 px on the GPU engine, 640 px on the CPU engine), so an edit
   made on one engine pointed at the wrong place on the other, and a full-resolution export first had to rescale every
   pixel-unit field.
3. **Mutating in place without a journal.** Undo needs inverse operations for every edit, agents' proposals cannot be
   reviewed before they apply, and "why does it look like this?" has no answer.
4. **Unversioned documents.** Renaming a field or changing a meaning breaks every saved edit.

Raw developers (develop settings in sidecars), vector design tools, video editors (edit decision lists) and parametric
CAD (feature histories) keep their work the same way, for the same reasons.

## Problem

**How do you store a user's edit so it can be rendered at any resolution, undone, reviewed, migrated and explained,
when the edit itself is made by gestures on pixels?**

## Forces

- **Fidelity against size.** Pixels reproduce exactly what was seen; parameters are tiny and need the engine to
  reproduce it.
- **Gesture coordinates against document units.** Gestures arrive in screen and working pixels; the document needs
  units that survive any resolution.
- **Simple mutation against reviewable history.** Writing fields directly is simple; a journal of mutations supports
  undo, approvals and explanation.
- **Free-form against validated.** A JSON bag is easy to extend; a schema catches mistakes and makes migration
  possible.
- **Stability against evolution.** Stored documents outlive the code that wrote them.

## Solution

**Therefore: make the edit a versioned document of parameters and vectors: settings by name, geometry in units of the
source image (fractions of the frame for positions and crops, pixels of the original for lengths), masks as stored
recipes (the operation definitions that build them), strokes as simplified point lists, records keyed by stable ids.
Validate every settable path against a field schema, a table of path patterns whose rules come from the owning
operation's argument spec or a custom check, and refuse unknown paths. Change the document only by mutations
(`set path value`, with `null` deleting a record entry), applied in transactions that record their inverse (the
previous value, or a deletion where there was none). Journal every mutation with its author and status (applied,
pending, rejected) in an append-only log whose undo is a cursor over undo units. Convert gesture coordinates to
document units at each tool's boundary. Derive pixels by compiling the document into an operation graph (Chapter 1)
for the requested resolution and precision (preview or export, Chapter 6). Give the document a version and a chain
of migrations.**

## Applicability

Use it when:

- edits must be re-rendered at other resolutions, on other machines or by other engines;
- people need undo, history, approvals or explanations;
- agents or scripts make edits that a person should review.

Do not use it when:

- the edit is inherently pixel-level and unparameterisable (freehand painting of new content); store strokes if you
  can, pixels if you must, and say which;
- rendering from parameters is too expensive to repeat (then cache rendered results keyed by the document, but keep
  the document as the source);
- the document never outlives one session and needs no undo (a throwaway preview tool).

## Structure

| Participant | Responsibility |
|---|---|
| **Document** | versioned value: source reference, settings, records by id (exposures, spots, masks), geometry in document units |
| **Field schema** | every settable path pattern with its rule (owned by an operation argument, Chapter 2, or a custom check) |
| **Mutation** | `set(path, value)`; `null` deletes a record entry |
| **Transaction** | applies mutations and records their inverse; one undo unit |
| **Journal** | append-only entries (mutation, author, time, status: applied, pending, rejected); undo units and a cursor |
| **Tool boundary** | converts gesture coordinates to document units, and back for overlays |
| **Compiler** | document → graph (Chapter 1) for a resolution and a precision |
| **Migrations** | `migrations[n]` turns a version-n document into version n + 1 |

## Collaborations

1. A tool receives a gesture in screen pixels, converts it to document units, and proposes mutations.
2. A transaction applies them to the current document, recording the inverse; the journal appends an entry with the
   author. An agent's mutations may be appended as pending until a person approves them.
3. Undo moves the journal's cursor back one unit and applies its inverse; redo moves it forward.
4. Any view compiles the current document for its resolution and precision; nothing stores pixels.
5. On load, migrations bring an old document to the current version before validation.

## Sketch

```text
value Document: version, source, settings, exposures: map id → Exposure, masks: map id → MaskDef,
                spots: map id → Spot, frame: (crop in fractions, angle, orientation)
value Mutation: path, value                       -- value null deletes a record entry
value Entry: mutation, author, time, status ∈ { applied, pending, rejected }

apply(doc, mutations, author) → (doc', inverse):
  for m in mutations:
    rule ← fieldSchema.match(m.path) or refuse("unknown-path", m.path)
    rule.check(m.value) or refuse("invalid", m.path, rule.doc)
  return (doc ⊕ mutations, inverse mutations)

-- the tool boundary: gestures in, document units out
spotTool.onClick(screenPoint, view):
  -- original-image pixels, or fractions of the frame
  p ← view.toDocument(screenPoint)
  propose([set("spots." ++ newId(), Spot(x: p.x, y: p.y, r: view.toDocumentLength(20 px)))],
      author: user)

load(stored) → Document:
  d ← stored; while d.version < CURRENT: d ← migrations[d.version](d)
  return validate(d)

-- in use: the same document at three resolutions
thumbnail ← render(compile(doc), size: 256, precision: preview)
screen    ← render(compile(doc), size: 3000, precision: preview)
export    ← render(compile(doc), size: original, precision: export)
```

## Implementation notes

1. **Units of the source, not of the working image.** The running example's coordinates were in working-image pixels,
   which differ by engine; reopening an edit on another engine misplaced crops and spots, and a heuristic rescaled
   only strip frames. goja-cv (a Go image-analysis engine) declares its pixel unit, in its operation registry, as a
   length or coordinate "in original-image pixels; scaled per evaluation", which is the fix. Fractions of the frame
   (Lightroom stores crops this way) work too. A document may mix both, as long as every field is tagged.
2. **Tag every geometric field with its unit.** Once the catalogue tags pixel-unit arguments (Chapter 2), a scaler can
   move a whole document between resolutions by asking for `unit: px`; mask definitions are operation nodes, so their
   pixel arguments are found the same way.
3. **Masks are stored recipes, not pixels.** The running example stores each mask as the node definitions that build
   it (a gradient, an ellipse, a painted stroke list, combinations), shared by id between exposures. Strokes are point
   lists simplified at the tool boundary to within half a pixel of the source, so a painted mask is still a vector.
4. **Records keyed by id, deleted by `null`.** Spots, density masks and masks are maps from stable ids. A mutation can
   address one entry (`set spots.s7.r 12`), deletion is `set spots.s7 null`, and the journal can name what changed.
5. **The journal is append-only.** The running example never deletes journal entries; applied, pending and rejected
   mutations all stay, with undo units and a cursor over them. An agent's proposal is a pending entry the photographer
   approves or rejects, and "why does it look like this?" is answered by reading the journal. Decide two rules
   explicitly: a new mutation after an undo discards the redo units (the entries remain in the journal), and only
   applied entries are rendered, with a pending proposal shown separately as a what-if.
6. **Record the inputs the document cannot contain.** The running example's recipe names the source by content hash
   and records the data pack it was made with; a re-render with different film data is detectable rather than
   silent.
7. **Version and migrate from the first save.** The running example's recipe is at version 2; `migrations[1]`
   renamed fields when the crop moved into a frame section and a knee method was renamed. Migrations are pure
   functions from one version to the next, so any old document can be brought forward step by step.
8. **Defaults belong to the version.** A document that omitted a value means the default of its version. Storing
   values explicitly when a default changes (the running example did when the enlarger's default mode changed)
   keeps old edits looking as they did.
9. **Recompile instead of caching by document version.** Compiling a document into an interned graph is cheap (tens
   of nodes); results are cached by node content (Chapter 1), so an edit that touches one record reuses everything
   else without a document-level cache.
10. **Live gestures are drafts.** During a slider drag the running example previews without journaling and commits one
   transaction when the hand stops; a keyboard burst coalesces into one unit. Otherwise a drag fills the journal with
   hundreds of entries.

## Variations

- **Normalised coordinates.** Geometry as fractions of the frame; resolution-free and simple, awkward for operations
  defined in pixel distances (a 2 px feather) and for non-uniform aspect changes.
- **Document pixels with per-evaluation scaling.** Geometry in pixels of the original; natural for measurements and
  tools, requires every evaluation to scale (goja-cv).
- **Snapshot history.** Store whole document versions instead of mutations; undo is a pointer move and versions can be
  shared structurally, but approvals and "who changed what" need diffing.
- **Hybrid document with content-addressed assets.** Parameters stay the source of truth, but what cannot be
  re-derived reliably (a generated inpainting result, a scanned retouch patch) is stored as an asset named by its
  content hash, together with what made it (model, weights hash, seed, prompt). Necessary for generative editing,
  where re-running a model on other hardware is not byte-reproducible.
- **Event-sourced document.** The journal is the only storage and the document is a fold over it; maximal history,
  slower loads, and migrations must apply to events.

## Consequences

- \+ One edit renders at every size, on every engine, now and after migrations.
- \+ Undo, approvals, provenance and explanations come from one journal.
- \+ Documents are small enough to sync, diff and store beside the source as sidecars.
- − Every tool must convert coordinates at its boundary; one tool that stores working pixels breaks portability.
- − Rendering always requires the engine; a viewer without it cannot show the edit.
- − Schema, migrations and journal are permanent maintenance.

## Known uses

- **Adobe Camera Raw and Lightroom** store develop settings as parameters (in XMP sidecars or a catalogue), with
  crops as fractions of the image.
- **darktable** keeps each image's edit history as a stack of module parameters in its library database and writes
  it to XMP sidecar files.
- **OpenTimelineIO** and edit decision lists describe video edits as references to media and time ranges, not as
  rendered frames.
- **Parametric CAD** (SolidWorks, Onshape) stores a feature tree of operations and parameters and regenerates geometry.
- **SVG and vector design tools** store shapes as geometry and render at any size.

## Related chapters

- [Chapter 1 · Interned Operation Graph](01-interned-operation-graph.md) is what the document compiles into.
- [Chapter 2 · Unit-Tagged Parameter Catalogue](02-unit-tagged-parameter-catalogue.md) owns the field rules and units.
- [Chapter 12 · Shared Handle Vocabulary](12-shared-handle-vocabulary.md) lets agents propose mutations by name.
- [Chapter 8 · Reach-Declared Tiling](08-reach-declared-tiling.md) renders the document in tiles at full size.
- GoF: **Command** (mutations with inverses), **Memento** (journal entries), **Interpreter** (the compiler).
