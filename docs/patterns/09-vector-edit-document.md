# Chapter 9 · Vector Edit Document ★★

*Store an edit as parameters and vectors in resolution-free units, never as pixels; change it only through journaled
mutations; compile it into a graph whenever pixels are needed.*

## Intent

Keep the user's work as a small, versioned document that describes what was done (settings, geometry, masks as
recipes, retouching as spots, strokes as point lists), in units that do not depend on the resolution it was edited
at. Every change is a mutation recorded with its author in an append-only journal, and pixels are always derived by
compiling the document. The same document then renders a thumbnail, a preview, a full-resolution export or a print
on another machine, and can be undone, reviewed, migrated and explained.

## Also known as

Non-destructive editing; parametric document; edit recipe; develop settings; sidecar; edit decision list.

## Motivation

The running example (chromobench, a browser darkroom) stores one recipe per frame: the source file's hash and decode
options, scan or capture settings, enlarger settings, dodge and burn exposures with masks, retouch spots, finishing
values, crop and orientation. Four naive choices fail.

1. **Storing pixels.** Saving the edited image, or painted mask pixels, fixes the result at one resolution; Editor
   lab (a browser photo editor) stores brush masks as rasters, which stay behind when their layer moves.
2. **Coordinates in working pixels.** This is the bug the running example shipped: crop, spots and masks were stored
   in pixels of the engine's working image (4,000 px on the GPU engine, 640 px on the CPU engine), so an edit made on
   one engine pointed at the wrong place on the other.
3. **Mutating in place without a journal.** Undo has nothing to step through, agents' proposals cannot be reviewed
   before they apply, and "why does it look like this?" has no answer.
4. **Unversioned documents.** Renaming a field or changing a meaning breaks every saved edit.

Raw developers, vector design tools, video editors and parametric CAD keep their work this way, for these reasons.

## Problem

**How do you store a user's edit so it can be rendered at any resolution, undone, reviewed, migrated and explained,
when the edit itself is made by gestures on pixels?**

## Forces

- **Fidelity against size.** Pixels reproduce exactly what was seen; parameters are tiny and need the engine.
- **Gesture coordinates against document units.** Gestures arrive in screen and working pixels; the document needs
  units that survive any resolution and any aspect of the rendering.
- **Simple mutation against reviewable history.** Writing fields directly is simple; a journal supports undo,
  approvals and explanation.
- **Strict edits against faithful loads.** A strict schema catches mistakes in new edits; a document saved under
  older rules must still open as it was saved.
- **Stability against evolution.** Stored documents outlive the code that wrote them.

## Solution

**Therefore: make the edit a versioned document of parameters and vectors: settings by name, positions and crops as
fractions of the source frame, lengths in one stated unit with a stated rule for renderings whose axes scale
differently, masks as stored recipes (the operation definitions that build them), strokes as simplified point lists,
records keyed by ids that are never reused. Keep the source reference beside the document, not among its mutable
fields. Validate every mutation strictly against a field schema (path patterns whose rules come from the owning
operation's argument spec or a custom check) and refuse unknown paths; read stored documents leniently, so what an
earlier editor accepted still loads. Change the document only by mutations (`set path value`, with `null` deleting a
record), applied all or nothing as one undo unit and journaled with author and status (applied, pending, rejected)
in an append-only log; undo moves a cursor over the applied units, and the state is rebuilt by replay or restored
from snapshots unless the document is too large for that. Convert gesture coordinates at each tool's boundary.
Derive pixels by compiling the document into an operation graph (Chapter 1). Give the document a version and a
chain of migrations, one per version step.**

## Applicability

Use it when:

- edits must be re-rendered at other resolutions, on other machines or by other engines;
- people need undo, history, approvals or explanations;
- agents or scripts make edits that a person should review.

Do not use it when:

- the edit is inherently pixel-level (freehand painting of new content); store strokes if you can, pixels if you
  must, and say which;
- rendering from parameters is too expensive to repeat (then cache rendered results keyed by the document, but keep
  the document as the source);
- the document never outlives one session and needs no undo (a throwaway preview tool).

## Structure

| Participant | Responsibility |
|---|---|
| **Document** | versioned value: settings, records by id (exposures, spots, masks), geometry in document units |
| **Source reference** | the original's identity and size; immutable, held beside the document |
| **Field schema** | the one list of settable path patterns, each with its rule, reader, default and unit |
| **Mutation** | `set(path, value)`; `null` deletes a record entry |
| **Journal** | append-only entries (mutations, author, status); the undo order of applied entries and a cursor |
| **Tool boundary** | converts gesture coordinates to document units, and back for overlays |
| **Compiler** | document → graph (Chapter 1) for a resolution and a precision |
| **Migrations** | `migrations[n]` turns a version-n document into version n + 1 |

## Collaborations

1. A tool receives a gesture in screen pixels, converts it to document units, and edits or proposes mutations.
2. An edit is validated against the current state and journaled as applied; a proposal is validated and journaled
   as pending, and validated again when it is approved.
3. Undo and redo move the cursor over the applied units; the state is the base with those units applied.
4. Any view compiles the current state for its resolution and precision. Compiling is cheap (tens of nodes) and
   results are cached by node content (Chapter 1), so an edit to one record reuses everything else.
5. On load, migrations bring an old document to the current version one step at a time, and a lenient reader turns
   it into the base state.

## Sketch

```text
value Document: version, settings, exposures: map id → Exposure, masks: map id → MaskDef,
                spots: map id → Spot, frame: (crop in fractions, angle, orientation)
value Entry: id, mutations, author, status ∈ { applied, pending, rejected }
value Session: source, base, journal = [], units = [], cursor = 0, preview = none

apply(doc, mutations) → doc':                       -- strict and all or nothing: works on a copy
  for m in mutations:
    rule ← fieldSchema.match(m.path) or refuse("unknown-path", m.path)
    rule.check(m.value) or refuse("invalid", m.path, rule.doc)   -- ids like __proto__ refused
  return doc ⊕ mutations                            -- null deletes a record entry

state(s) → doc: from s.base, apply the mutations of s.units[0 … s.cursor) in order   -- replay

edit(s, mutations, author) → id:
  apply(state(s), mutations)                        -- refuse before anything is recorded
  e ← Entry(newId(), mutations, author, applied)
  s.journal ← s.journal ++ [e]; push(s, e); return e.id
propose(s, mutations, author) → id:
  apply(state(s), mutations)                        -- impossible proposals never enter the journal
  e ← Entry(newId(), mutations, author, pending); s.journal ← s.journal ++ [e]; return e.id
approve(s, id): e ← pending entry id; apply(state(s), e.mutations); e.status ← applied; push(s, e)
reject(s, id): s.journal[id].status ← rejected
push(s, e): s.units ← s.units[0 … s.cursor) ++ [e.id]; s.cursor ← s.cursor + 1   -- redo discarded
undo(s): s.cursor ← max(0, s.cursor − 1);  redo(s): s.cursor ← min(len(s.units), s.cursor + 1)

-- a drag: previews are not journaled; the commit records the net change
preview(s, mutations): apply(state(s), mutations); s.preview ← mutations
commitPreview(s, author):
  edit(s, diff(state(s), apply(state(s), s.preview)), author); s.preview ← none

-- the tool boundary: gestures in, document units out
spotTool.onClick(s, screenPoint, view):
  p ← view.toFrameFraction(screenPoint); r ← view.toDocumentLength(20 px)   -- the stated rule
  edit(s, [set("spots." ++ freshRecordId(s), Spot(x: p.x, y: p.y, r: r))], author: user)
freshRecordId(s): an id not named by any journal entry or the base   -- history stays unambiguous

load(stored) → Session:
  d ← stored; while d.version < CURRENT: d ← migrations[d.version](d)   -- one step per version
  return Session(source: d.source, base: readLeniently(d))   -- keeps what was once accepted

-- in use: the same document at two resolutions
thumbnail ← render(compile(state(s)), size: 256, precision: preview)
export    ← render(compile(state(s)), size: original, precision: export)
```

## Implementation notes

1. **Units of the source, not of the working image.** The running example's working-image pixels differ by engine,
   so reopening an edit on another engine misplaced crops and spots. goja-cv (a Go image-analysis engine) declares
   "original-image pixels; scaled per evaluation", which is the fix; fractions of the frame work too.
2. **Lengths need a rule, not only a unit.** Positions scale x and y separately; a radius has one value, so a
   rendering whose scales differ needs a stated rule: a fraction of the shorter side, or original pixels scaled by
   √(sx·sy) to preserve area. Where a catalogue tags pixel-unit arguments (Chapter 2), a scaler can move a document
   between resolutions by asking for `unit: px`; without one, a unit tag is decoration.
3. **Masks are stored recipes, not pixels.** The running example stores each mask as the node definitions that
   build it (a gradient, an ellipse, a stroke list), shared by id between exposures.
4. **Records keyed by ids that are never reused.** Spots and masks are maps from stable ids; deletion is
   `set spots.s7 null`. Address records whole until a tool edits one field alone; per-field paths add bookkeeping a
   small document does not need. Allocate ids no journal entry has named, or "spot s7 was deleted" may later point
   at another spot, and refuse ids that collide with object machinery (`__proto__`).
5. **Strict edits, lenient reads.** Validating a loaded document with the edit schema refuses documents the editor
   once accepted (a spot partly outside the frame). Read stored values keeping what was saved, refusing only what
   cannot be read; validate every new mutation strictly.
6. **Version and migrate from the first save, as a chain.** The running example's `migrations[1]` renamed fields
   when the crop moved into a frame section. Migrations are pure functions from one version to the next, run in
   sequence; a hard-coded "version 1 → current" must be rewritten for version 3. An omitted value means its
   version's default, so a migration writes old defaults explicitly when a default changes.
7. **The journal is append-only; proposals are checked twice.** Applied, pending and rejected entries all stay.
   Validate a proposal when made, so impossible ones never enter the journal, and again when approved, because the
   document may have moved on (its spot may be gone). A new edit after an undo discards the redo units, not their
   entries; a pending proposal is shown separately as a what-if.
8. **Undo by replay or snapshots; record inverses when that pays.** For a document of a few kilobytes, replaying
   the applied units from a base (cached by cursor), or a snapshot per unit, is simple and correct. Inverse
   mutations pay when the document is large, the history long, or undo must apply to a state others have since
   changed; they cost a "missing" sentinel and an inverse per path. Test history as laws: undoing everything gives
   the initial state, redoing everything the final one, and the journal only grows.
9. **Live gestures are drafts; commit the net change.** During a drag the running example previews without
   journaling and commits once when the hand stops. Commit the difference between the committed and previewed
   states, not the last preview's mutation list, so the journal records what actually changed.
10. **Keep what cannot change outside the document; record what it cannot contain.** Held outside the mutable
   state, the source reference is immutable by construction, not by a schema rule. The running example names the
   source by content hash and records its data pack, so a re-render with different film data is detectable.
11. **Let the schema be the one list of fields.** Copying, diffing, readers, defaults and geometry each tend to spell
   out every field again, so a new record kind touches eight places. Give each schema entry its reader, default and
   unit as well as its rule, and drive the rest from it.

## Variations

- **Document pixels with per-evaluation scaling.** Geometry in pixels of the original; natural for measurements and
  tools, requires every evaluation to scale (goja-cv).
- **Inverse-recording transactions.** Each transaction stores its inverse and undo applies it (GoF Command); the
  choice for large documents and collaborative editing, more machinery for small ones.
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
- − Schema, readers, migrations and journal are permanent maintenance.

## Known uses

- **Adobe Camera Raw and Lightroom** store develop settings as parameters (in XMP sidecars or a catalogue), with
  crops as fractions of the image.
- **darktable** keeps each image's edit history as a stack of module parameters and writes it to XMP sidecars.
- **OpenTimelineIO** and edit decision lists describe video edits as references to media and time ranges.
- **Parametric CAD** (SolidWorks, Onshape) stores a feature tree of operations and parameters.
- **SVG and vector design tools** store shapes as geometry and render at any size.

## Validation

All six runs, four with this chapter and two without, passed the hidden tests; the blind review recognised every
chapter run but ranked them mixed. The best design followed the chapter's migration chain, the only one where a
version 3 composed; inverse transactions, per-field paths and strict reads of stored documents cost code or refused
old documents, while replay and snapshot designs were simpler. See `docs/patterns/experiments/RESULTS.md`.

## Related chapters

- [Chapter 1 · Interned Operation Graph](01-interned-operation-graph.md) is what the document compiles into.
- [Chapter 2 · Unit-Tagged Parameter Catalogue](02-unit-tagged-parameter-catalogue.md) owns the field rules and units.
- [Chapter 12 · Shared Handle Vocabulary](12-shared-handle-vocabulary.md) lets agents propose mutations by name.
- [Chapter 8 · Reach-Declared Tiling](08-reach-declared-tiling.md) renders the document in tiles at full size.
- GoF: **Command** (mutations), **Memento** (snapshots), **Interpreter** (the compiler).
