# Chapter 10 · Two-Vocabulary Layout DSL ★

*Write each arrangement of the editor as a short program composing two vocabularies: a generic shell vocabulary
(docks, panels, rows, commands, keys) and a domain vocabulary (viewers, parameter controls, domain panels). Layouts
are values the user can switch between; controls come from the parameter catalogue.*

## Intent

Separate *what the editor can show* from *how a given workspace arranges it*. The shell knows nothing about
photographs; the domain vocabulary knows nothing about docking. A layout is a few dozen lines that combine them, so a
new workspace for a different user, task or device costs a file, not a fork. Controls are generated from the
parameter catalogue, so a layout names a parameter and gets the right widget, range, units and typed entry.

## Also known as

UI DSL; declarative workbench; perspectives; workspaces as code; layout-as-program.

## Motivation

The running example (chromobench, a browser darkroom for a photographer replacing his Lightroom workflow) needs very
different arrangements: a Lightroom-like screen with Library and Print modules, a single "darkroom first" screen with
the film strip, the print and the enlarger, a minimal layout for a small window, a lab layout with every inspector,
a roll-of-film workflow, and a finishing module. Hand-building each screen fails in four ways.

1. **Every screen re-implements controls.** The exposure-time slider is written five times with five ranges and
   three spellings of its units.
2. **Domain code leaks into the shell, and shell code into the domain.** A docking panel that knows about film, or a
   film panel that positions itself, cannot be reused.
3. **New workspaces are expensive.** Trying "printing in one tile, digital tools in another" with the photographer
   means a branch, not an afternoon.
4. **Behaviour diverges by screen.** Undo, keyboard shortcuts and the command palette work in one screen and not in
   another, because each screen wired them.

Integrated development environments (editors, debuggers, terminals in user-arranged workbenches), audio workstations
(mixer, arrangement and editor views) and scientific viewers (image, plot and inspector panels) have the same shape:
many arrangements of a stable set of domain parts.

## Problem

**How do you offer many arrangements of a complex editor, cheaply and consistently, without the shell knowing the
domain or the domain knowing the shell?**

## Forces

- **Generic against specific.** A shell that knows nothing of the domain is reusable; panels that know the domain
  are useful.
- **Declarative against expressive.** Data layouts (trees of tiles and splits) are easy to persist and edit by drag;
  programs can compute, condition and reuse.
- **Generated against hand-made controls.** Generated controls are consistent; a domain sometimes needs a bespoke
  control (a test strip, a ring-around).
- **Freedom against coherence.** Users and authors should rearrange freely; some arrangements break the product's
  rules (Chapter 11).
- **Few concepts against many layouts.** Every layout should be readable by someone who knows the two vocabularies,
  not by its author only.

## Solution

**Therefore: build the interface from two vocabularies. The shell vocabulary (`ck`) offers structure and behaviour
that every editor needs: an application frame, modules (screens) with regions, docks, panels, rows and columns,
conditional content, commands, menus and keys. The domain vocabulary (`cb`) offers the domain's parts: viewers bound
to named outputs, a control for any document path (generated from the parameter catalogue), standard panels, and
kits that bundle a domain area. A layout is a function of both vocabularies that returns an application value; a
registry maps layout names to lazily loaded layouts, and the user switches between them without losing open work.
Keep shared parts (a standard print module, a standard menu set) in a library both vocabularies can serve, so
layouts compose parts and never import one another.**

## Applicability

Use it when:

- the editor needs several arrangements for different users, tasks or screen sizes;
- most panels are views of one document and its parameters;
- people or agents may author new arrangements.

Do not use it when:

- there is one fixed screen; a hand-built interface is shorter;
- arrangements are purely user-dragged and never authored (a docking library with persistence is enough);
- the domain parts are few and each is bespoke (a game's HUD).

## Structure

| Participant | Responsibility |
|---|---|
| **Shell vocabulary** | frame, modules, regions (left, centre, right, bottom), docks, panels, layout primitives, conditional content, commands, menus, keys |
| **Domain vocabulary** | viewers over named outputs, `arg(path)` controls, domain panels, readouts, kits, domain key maps |
| **Catalogue** | parameter specs from which `arg(path)` builds widgets (Chapter 2) |
| **Layout** | `{ id, label, description, build: (shell, domain) → app }` |
| **Layout registry** | name → lazy import; the user's choice is a preference |
| **Shared parts library** | standard modules, menus and panels used by many layouts |
| **Intermediate representation** | the built tree of nodes, inspected by passes (Chapter 11) and by an explainer |

## Collaborations

1. At start-up the application reads the chosen layout's name and imports it from the registry.
2. The layout's `build` calls the domain vocabulary to create a studio, installs kits, and declares modules; each
   module fills its regions with shell structure around domain parts.
3. Each `arg(path)` asks the catalogue for the path's control model and becomes a slider, stepper, colour or select
   with the declared range, units and typed entry.
4. The shell turns the result into its intermediate representation, runs passes (Chapter 11), and mounts it.
5. Switching layouts rebuilds the representation; the document and the open frames are kept.

## Sketch

```text
-- a layout: two vocabularies in, an application out
layout "darkroom":
  label "Darkroom first", description "One screen: strip, print, enlarger"
  build(ck, cb) →
    cb.studio("Chromobench")
      .left(ck.dock.column(width: 200, cb.view.strip(vertical: true), cb.panel.history()))
      .center(cb.viewer(s → cb.frame(s).print(), tools: [probe, testStrip, maskBrush,
          maskGradient]))
      .right(ck.dock.column(width: 300,
          ck.panel("enlarger", title: "Enlarger",
            ck.when(s → hasFrame(s),
              ck.column(cb.arg("print.enlarger.time"), cb.arg("print.enlarger.fstop"),
                  cb.arg("print.enlarger.filtration")),
              ck.text("Select a photo to print it."))),
          cb.panel.exposures()))
      .keys(cb.keys.darkroom)

-- a modular layout: screens from a shared library
layout "classic":
  build(ck, cb) →
    s ← cb.studio("Chromobench").menus(cb.menus.standard())
    s.module("library", cb.modules.library())
    s.module("print", cb.modules.print())
    return s

registry ← { classic: lazy "classic", darkroom: lazy "darkroom", lab: lazy "lab", … }
app ← mount(registry[preferences.layout].build(ck, cb))
```

## Implementation notes

1. **The shell must not import the domain.** In the running example the shell package imports only itself; the
   studio kit imports the shell and the contract. A shell that depends on the domain cannot serve a second product.
2. **Controls are a path, not a widget.** `cb.arg("print.enlarger.time_s")` is the whole description; the catalogue
   supplies widget, range, step, label, units and typed entry ("+1/3 st", "12.6 s"). A layout author cannot get a
   range wrong.
3. **Layouts must not import each other.** This is a debt the running example carries: four layouts import the print
   and library modules from the classic layout's file. Move shared modules, menus and panels into a library the
   vocabulary exposes, so every layout is an equal composition of parts.
4. **One source for menus.** The running example declares a command's menu twice, on the command and in the layout's
   menu list. Keep the layout's lists (they vary per layout) and check in the build that every command appears in
   some menu or palette and every menu entry names a command.
5. **Host capabilities belong in the vocabulary, typed.** Opening files, exporting and saving depend on the host
   (browser, desktop, tests). The running example looks them up by string in shared state; a typed capability set,
   declared by commands that require it, lets the shell hide and refuse what the host cannot do.
6. **Status, dialogs and progress belong in the vocabulary too.** Whatever a layout cannot place (a status line built
   by hand in the host, dialogs built outside the DSL) cannot be rearranged or checked. The running example's next
   plan moves both into the DSL and adds a jobs model that layouts can show.
7. **Split the domain vocabulary by area.** A single 600-line function that defines every domain command is the
   running example's other debt; per-area modules (file, frame, print, library, roll, finish) each export a command
   table beside their panels.
8. **Conditional content is part of the vocabulary.** `ck.when(predicate, then, else)` let the running example show
   one empty-state sentence instead of a stack of empty panels; layouts state conditions instead of hiding DOM.
9. **Keep data layouts for what users drag.** Editor lab (a browser photo editor) stores its arrangement as a tree
   of tiles and splits with six presets, normalises it, persists it and collapses it to one tabbed tile on narrow
   screens. Programs suit authored workspaces; data suits user-dragged ones. Many systems want both: a program that
   produces the default tree, and a stored tree of the user's changes.
10. **Name things as users do.** The running example's code calls layouts "variants" while the interface says
    "Layout"; the mismatch costs every newcomer a moment. Rename early.

## Variations

- **Data-only layouts.** Trees of tiles and splits in JSON; trivially persisted and edited by drag, cannot compute
  (no conditions, no reuse) beyond what the format allows.
- **Immediate-mode interface code.** Panels drawn every frame by functions that read state (Dear ImGui, Blender's
  Python panels); very direct, harder to inspect as a whole before mounting.
- **Generated forms only.** The whole interface generated from the catalogue; consistent and cheap, no domain-specific
  arrangement.
- **Agent-authored layouts.** An agent writes layouts in the same DSL inside a sandbox; the vocabulary's smallness and
  the passes of Chapter 11 make that safe to try.

## Consequences

- \+ A new workspace for a person or a task is one short file.
- \+ Controls are consistent everywhere because they come from the catalogue.
- \+ The shell is reusable for other editors; the domain parts are reusable in other layouts.
- − Two vocabularies to learn, and an intermediate representation between the layout and the screen.
- − Bespoke controls need an escape hatch, which can grow into a second interface toolkit.
- − Layout files are code: they need review, tests and, for user-authored ones, a sandbox.

## Known uses

- **Blender** defines its panels in Python with a generic layout API (`layout.row()`, `layout.column()`) and draws
  property controls from the data definitions (`layout.prop(data, "name")`).
- **Eclipse** perspectives arrange views and editors per task and let the user switch between them.
- **Visual Studio Code** extensions contribute views, view containers, commands, menus and keybindings declaratively.
- **Dear ImGui** builds tool interfaces as code that runs every frame.
- **Editor lab** describes workspaces as trees of tiles and splits with preset arrangements.

## Related chapters

- [Chapter 2 · Unit-Tagged Parameter Catalogue](02-unit-tagged-parameter-catalogue.md) generates the controls.
- [Chapter 11 · Kits with Policy Passes](11-kits-with-policy-passes.md) bundles domain areas and checks layouts.
- [Chapter 12 · Shared Handle Vocabulary](12-shared-handle-vocabulary.md) names what viewers show.
- [Chapter 4 · Latest-Wins Render Slots](04-latest-wins-render-slots.md) renders for the viewers a layout places.
- GoF: **Builder** (a layout builds an application value), **Abstract Factory** (two vocabularies producing parts),
  **Composite** (regions, docks and panels as one tree).
