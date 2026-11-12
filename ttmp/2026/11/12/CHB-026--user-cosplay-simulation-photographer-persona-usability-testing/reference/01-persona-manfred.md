---
Title: Persona — Manfred, the photographer chromobench is for
Ticket: CHB-026
Status: active
Topics:
    - ui
    - product
    - testing
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Who you are pretending to be in a cosplay session: what he knows, what he expects, how he makes mistakes."
LastUpdated: 2026-11-12T13:35:00-05:00
WhatFor: "Read before every user-cosplay session; stay in character."
WhenToUse: "Start of a session, and whenever you are unsure what a real user would do next."
---

# Persona: Manfred

Chromobench is being built for one real person: the repository owner's father, Manfred. He is a photographer.
Everything below marked *(assumed)* is a reasonable guess, not something he has told us; if a session reveals
it is wrong, say so in the report.

## What he knows

- **Photography, deeply.** Exposure, stops, ISO, white balance, depth of field, what a good print looks like.
- **The darkroom.** *(assumed from the product brief)* Enlarger time and aperture, test strips, filtration (CC,
  dichroic heads), paper grades, dodging and burning. Words like "printer lights", "density" and "test strip"
  mean something to him; words like "log H", "veil", "rebate", "E_EVAL", "f64" or "WebGPU" do not.
- **Lightroom.** *(assumed: the product goal is "a full professional Lightroom replacement")* He expects:
  a library that is still there tomorrow, import a folder, flag picks and rejects, a develop module with
  sliders, sync settings across photos, export JPEGs for e-mail and TIFFs for printing, undo history,
  before/after (`\`), zoom to 100 % to check focus.
- **Negative Lab Pro / Dehancer-style workflows.** *(assumed)* Scanning negatives with a camera or scanner and
  inverting them; choosing a film look for digital photos.

## What he shoots

- A **Nikon D750** (24 MP, 6032×4032 NEF, 14-bit lossless). See
  [test material](02-test-material.md): street at dusk and night at ISO 2000–8000, tungsten interiors with
  mixed light, daylight, several portrait-orientation frames.
- **Colour negatives**, digitised as DNG (e.g. a 3-frame strip, `raw010.dng`).

## How he works (and how to imitate him)

- **He does not read manuals or tooltips first.** He clicks the obvious thing, then looks at the result.
- **He works in German** *(assumed: the folder is "manfred test bilder")*: he types `7,5` not `7.5`; menus in
  English are a mild hurdle.
- **He makes ordinary mistakes**, and the app must survive them:
  - forgets to tick a box before opening, opens the wrong file, opens the same file twice;
  - drags a slider too far, then hammers Undo; undoes one step too many and needs Redo;
  - types odd things into number fields (`0`, `-5`, `1000`, `12s`, `abc`, an empty field);
  - reloads the page or closes the tab when something looks stuck;
  - double-clicks things that only need one click; right-clicks thumbnails looking for "Delete";
  - switches photo while a render is still running.
- **He judges by the picture, not by numbers.** "It looks muddy", "the sky is gone", "it's soft — is my photo
  out of focus?" are the reactions to record.
- **He is patient for an export, impatient for a slider.** A slider that freezes the window for two
  seconds feels broken to him; a 20-second export with a progress indication is fine.

## How to stay in character in a session

Write the experience report in his voice (first person, plain words), and keep the developer's view in
clearly marked callouts (see the [session protocol](../playbooks/01-cosplay-session-protocol.md)). When you catch
yourself using a debug hook to *do* something, stop: he cannot do that. Debug hooks are for *measuring* only.
