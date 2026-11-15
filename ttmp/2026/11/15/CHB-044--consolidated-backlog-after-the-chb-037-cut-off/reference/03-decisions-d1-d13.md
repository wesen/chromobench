---
Title: Decisions D1-D13
Ticket: CHB-044
Status: active
Topics:
    - architecture
    - ui
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T18:14:27.634439-05:00
WhatFor: ""
WhenToUse: ""
---

# Decisions D1–D13

Taken on 2026-11-15. The owner delegated every open decision: "you chose the best for the decisions, i'm leaving it
up to you, it's an internal tool that will never be published." Each decision names the work it creates; the work
items are in the backlog (01-consolidated-backlog.md, "Roadmap").

| # | Decision | Why | Work it creates |
|---|---|---|---|
| D1 | **Classic is the default now**, opening a file into Print. Darkroom first becomes the default when it has a Finish palette (crop, straighten, spots), a "before the film" palette (scene, white balance), ring-around and test strip, and the mask tool disarms after one mask. | The persona session found Classic complete and Darkroom first missing tools; the photographer comes from Lightroom's module layout. | Phase A: open into Print. Phase C: the Darkroom first palettes (P9-5), then switch the default. |
| D2 | **Yes to the scene stage, with white balance before the film** (temperature and tint in scene light, before the film's exposure). | He shoots digital as film simulation; white balance before the film is what Dehancer-style film emulation needs, and after the film it changes the film's colour response instead of the scene's. | P9-12: a scene white-balance op (core, GPU, parity, stack kit), eyedropper on a neutral, as-shot default from the raw. |
| D3 | **Yes to selections, as mask components** (no separate selection state): marquee, lasso, magic wand, select all/none/invert, grow/contract, feather. | One mask algebra (CHB-042 ch 3); Photoshop habits map onto components; nothing new for history or the engines. | CHB-040 part 1, after the mask controls (part 3). |
| D4 | **Sync copies values by default**; "Link" is an explicit choice in the same dialog (and Auto Sync while held). | Lightroom's Sync copies; a link silently changes other frames later, which surprises unless chosen. | Label the dialog; no model change. |
| D5 | **The darkroom stack shows his order** (the order he made the exposures and layers), with each layer's kind as a badge; the Enlarger panel keeps its by-kind summary as a view. | The law makes order irrelevant to the print, so the list should follow intent; Photoshop and Lightroom users read stacks in their own order. | Stack kit: stop grouping the darkroom list by kind. |
| D6 | **Film stocks and paper grades return as medium presets** on the film and paper stages (choosing a stock sets the medium), not as looks. | He uses film simulation; looks became link functions and should stay for edits, while a stock is the medium itself. | Medium presets from the data pack, a stock picker on the film stage, tests. |
| D7 | **Overlay, soft light and hard light (and the other contrast modes: vivid, linear, pin light, hard mix) switch at display mid-grey**: they are evaluated in the display encoding; the other modes stay in linear light. | Photoshop evaluates them in an encoded space; in linear light they switch at display 0.735, which reads as wrong to a Photoshop user. | P10-23: change the GPU and core blend modes, parity, goldens; the blend docs say which modes are encoded. |
| D8 | **One first-print aim for roll and studio: neutralise 75 %** (keep a quarter of each frame's cast), shown as a "Neutralise" amount the photographer can change. | Keeping some of a sunset's warmth is the darkroom printer's habit; the same frame must print the same from the roll and from the studio. | CHB-028 t:5wjl: one aim function, the amount as a control, goldens. |
| D9 | **No licence work.** chromobench is internal and will never be published; NC data packs and GPL-derived code are acceptable. Revisit only if that changes. | Owner's statement. | Close CHB-004 t:7w8x. |
| D10 | **Black and white after the first beta**, unless the photographer asks for it in the setup questionnaire. | His archive and workflow are colour; B&W is a full ticket (CHB-014). | Ask in the CHB-013 questionnaire; CHB-014 stays parked. |
| D11 | **Keep our RAW colour**; switch to forward or dual matrices only if a ColorChecker chart says Adobe is closer. | The owner kept our colour on 2026-11-14; a chart is the only fair judge. | Ask the photographer for the chart shots (CHB-033 t:jzl6). |
| D12 | **Key in the browser** (as today); no Claude proxy in the bridge. | Internal tool on known machines; a proxy is a server to run and secure for no gain here. | Mark the proxy task obsolete (CHB-008 t:ch9a); keep the key in local storage with a clear "forget key". |
| D13 | **Merge the integration branch into main at the end of Phase A**, after the browser suite (SwiftShader and Metal) and the goldens pass on the merge. Push to the private repository then. | Phase A makes it daily-usable; main should be what he runs. | Phase A exit. |

## Technical decisions from CHB-035 design 02 (for the performance phase)

| # | Decision |
|---|---|
| T1 (P1) | Present from GPU textures on one shared device; 16/8-bit readback only as the fallback. |
| T2 (P2) | Source pyramids in both engines for draft and screen passes; refine and export read full resolution. |
| T3 (P3) | GreedyDual-Size for checkpoints (cost differs per byte), LRU for final images and sources (cost proportional to size, as CHB-041 found). |
