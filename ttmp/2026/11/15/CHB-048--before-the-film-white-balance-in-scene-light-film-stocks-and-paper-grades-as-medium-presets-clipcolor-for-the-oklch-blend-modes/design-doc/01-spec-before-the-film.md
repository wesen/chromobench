---
Title: 'Spec: before the film'
Ticket: CHB-048
Status: active
Topics:
    - studio
    - colour
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Phase 2, before the film: white balance in scene light (LAY-1, D2), film stocks and paper grades as medium presets (LOOK-6, D6), W3C ClipColor for the OkLCh blend modes (LAY-2): what changes, in his units, and how it is tested.'
LastUpdated: 2026-11-15T20:25:09.483751-05:00
WhatFor: ""
WhenToUse: ""
---

# Spec: before the film (CHB-048)

Phase 2 of the CHB-044 roadmap, the "before the film" group: LAY-1 (CHB-037 P9-12 t:ig9q, decision D2), LOOK-6
(CHB-021 t:xw53, decision D6) and LAY-2 (CHB-037 P10-9 t:dpba). Contract 3.0.

## Items, what each means for the photographer, and how it is tested

| # | Behaviour after CHB-048 | Where | Evidence |
|---|---|---|---|
| LAY-1 | A camera file has a **white balance before the film**: the light the scene was lit by, as **Temperature (K) and Tint in Lightroom's units** (the same numbers mean the same white: Robertson's isotemperature lines, Adobe's tint scale). It is corrected in scene light, between the camera's colour and the scene stage, so the film is exposed to a white-balanced scene. A file opens **as shot** (its raw's AsShotNeutral or the camera's multipliers). Presets: As shot, Lightroom's Daylight 5500 K +10, Cloudy, Shade, Tungsten 2850 K, Fluorescent 3800 K +21, Flash, and **None** (the light as it was: a daylight film sees it so). **Pick a neutral** (W): click something grey and its colour becomes neutral. Each change is one undo step. A negative has none and says why. | contract `white-balance.ts` (CC-027); core `ops/film.ts` sceneMatrixAt; GPU binds core's matrix; mock `source.xyz`; studio-kit `commands/scene.ts` (`scene.whiteBalance`, tool `white-balance`), `model/white-balance.ts`, `model/presets.ts`, `cb.preset` | contract `white-balance.test.ts`; core `white-balance.test.ts`; mock test; GPU `film.spec.ts`; goldens; e2e `studio-before-the-film.spec.ts` |
| LAY-1 UI | **Classic**: a "White balance (before the film)" panel at the top of Print's right column (after the tools) and of the Scene module; the eyedropper among the viewer's tools. **Darkroom first**: a "Before the film" palette under the Enlarger (white balance and the scene's layers). | `cb.panels.whiteBalance`, `cb.views.whiteBalance`, `layouts/darkroom.js`, stack kit scene module | layout snapshots; e2e |
| LOOK-6 | **Film stocks and papers are medium presets** from the data pack, named as the pack names them: choosing a film sets the film medium (the stock, and the push of a pushed profile: "Kodak Portra 800 (Push 1)" is Portra 800 pushed one stop); choosing a paper sets the paper; the grades 0–5 are named presets of the paper's contrast. Not looks: nothing is linked, one undo step. Agents: `medium.preset`. | contract `media-presets.ts`; host builds the list from the pack; studio-kit picker | contract tests; e2e; golden `cam-film-gold-200` |
| LAY-2 | Hue, saturation, colour and luminosity blends keep the result in the working RGB gamut: **W3C ClipColor in OkLCh** (the chroma is reduced at the result's lightness and hue until no channel is below 0 or above the brighter of white and the inputs). In-gamut results are unchanged. | contract `pixel.ts`; core `composite/blend.ts`; GPU `working.wgsl`; mock | contract law tests; GPU `law:blend`; golden `stack-print-blends` before/after |

## Decisions taken here

- **The white balance is a medium value, not a layer.** It is the light of the scene (one per frame, as in Lightroom),
  applied before the scene stage's layers; the scene stage's layers stay for local and creative edits. A layer would
  have needed an amount and blend meaning for an adaptation; the medium keeps one white per frame, one undo step per
  change, and the agent's path `stages.scene.medium.whiteBalance`.
- **Temperature and tint are the stored values; "As shot" and "None" are values too** (the `mode` field is gone,
  hard cut-off). The conversion between temperature/tint and the white is exact both ways (1e-13), so storing the raw's
  white as numbers loses nothing: every golden is reproduced bit for bit.
- **CAT16 in XYZ**, complete adaptation, to D65 (reasons in `white-balance.ts`: camera-independent, the same transform
  as the film's reference adaptation, so they compose exactly).
- **Where in Classic: Print**, first after the tools. Classic's Print is Lightroom's Develop (key D), and Lightroom's
  white balance is the first control of Develop's Basic panel; the Scene module shows it too.
- **The eyedropper reads `scene.input`** (the white-balanced scene before the scene's layers) and unadapts it with the
  current white, so a pick is exact and picking the same point again changes nothing.

## Out of scope

- Local white balance (a masked temperature/tint layer) is LAY-6's simple adjustments (Masks and layers agent).
- DARK-1's Finish palette, ring-around and test strip beside the Enlarger in Darkroom first.
