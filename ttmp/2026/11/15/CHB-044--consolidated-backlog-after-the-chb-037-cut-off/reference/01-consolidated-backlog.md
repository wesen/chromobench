---
Title: Consolidated backlog
Ticket: CHB-044
Status: active
Topics:
    - architecture
    - ui
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://docs/HANDOFF.md
      Note: the state of the studio after CHB-037, CHB-038, CHB-041 that this backlog was checked against
    - Path: repo://ttmp/2026/11/14/CHB-037--unified-editing-model-implementation-of-chb-035-design-01-v2-stages-with-laws-one-document-builder-core-stack-kit-agent-workbench-editor-lab-tools/reference/02-integration-report.md
      Note: the P9 findings and the recommended default arrangement
    - Path: repo://ttmp/2026/11/14/CHB-035--digital-editing-tools-from-editor-lab-layers-groups-masks-workspaces-in-the-ui-dsl-and-editor-lab-s-performance-architecture/design/02-editor-lab-performance-architecture.md
      Note: Part IV, P1-P8, whose state is in the performance section
ExternalSources: []
Summary: 'Every task still wanted after the CHB-037 cut-off, grouped by functionality with severity, sources and dependencies; the open owner decisions merged; a suggested order; ticket status after the triage.'
LastUpdated: 2026-11-15T18:30:00-05:00
WhatFor: 'Choosing the next work after CHB-037; the one list of open decisions for the owner.'
WhenToUse: 'Before opening a new ticket or picking a task from an older one.'
---

# Consolidated backlog after the CHB-037 cut-off

## Goal

One list of what is still wanted, in the terms of the current studio (documents of format 3, stages and laws, one
history, contract 1.x, the stack kit, layouts, `wb`, looks as links). It replaces reading 19 tickets written before and
after the cut-off. Every item names the tasks it comes from, so the tickets stay the record and this file the map.

## How it was made

On 2026-11-15 every open task (200) of CHB-004, 008, 010, 011, 013, 014, 015, 020, 021, 022, 026, 028, 029, 030, 033,
034, 035, 037 and 040 was checked against the code of `task/chb-037-unified-model` (at 00f0e5c) and marked in its
ticket: **done** (checked, " — done: evidence"), **superseded** or **obsolete** (checked, with what replaced it),
**duplicate** (checked, naming the task it duplicates) or **open** (unchecked; " — now: …" where the wording or the
state changed, "(check: …)" where unsure). The diary (`02-diary.md`) has the method and the doubts.

Result: 23 done, 8 superseded, 1 obsolete, 4 duplicates, **164 open**. Closed: CHB-026 (all resolved) and CHB-038,
CHB-039, CHB-041 (merged, no open tasks).

**Severity:** *correctness* — wrong pixels, wrong numbers or unbounded memory, possibly silent; *major* — blocks or
misleads the photographer in a normal session; *minor* — friction, debt, docs, tests; *later* — wanted but parked or
waiting on a decision or on the photographer.

**Sources** are `CHB-NNN t:xxxx` (the task id in that ticket's `tasks.md`), CHB-037 tasks also by their P-number.
Items without a task come from a diary or report, named as such.

---

## Roadmap (2026-11-15)

The owner delegated the open decisions (D1–D13, in `03-decisions-d1-d13.md`) and will test with the photographer
once all features are built, so feature work comes before the beta. Phases run in this order; 3 runs beside 2.

**Phase 1 — Correctness and editing blockers (now).** GPUC-1 (field textures reused mid-export), GPUC-2 (grid-rule
ties), GPUC-3 (unfloored log in density-mask mode 7), GPUC-4 (uncounted retired memory); MASK-1 (mask tool stays
armed), DARK-2 (Apply Print Settings source), DARK-3 (Real ↔ Normalised darkens), DARK-5 (coarse sliders); the work
the decisions create: D1 open a file into Print (NEW-1), D4 label sync as copy with Link as a choice (NEW-2), D5 the
darkroom stack in his order with kind badges (NEW-3), D7 contrast blend modes in the display encoding (LAY-3), D8 one
first-print aim, neutralise 75 % as an amount (SCAN-5). Exit: browser suite (SwiftShader and Metal) and goldens pass;
merge `task/chb-037-unified-model` into main and push (D13).

*Phase 1 result (2026-11-15):* all thirteen items done in CHB-045 and CHB-046 (rows marked below). Left open, for
Phase 2: the Darkroom-first layout has no "First print" panel yet (with DARK-1); the stack's own amount and mask
sliders still use the old coarse drag (with DARK-5's follow-up); setting the enlarger mode directly through the DSL
does not carry the density (the `print.enlargerMode` command does); with a flash on its own filtration the mode
switch uses the main exposure's shift, and a preflash's share is not carried; `Pool.pin`/`unpinAll` are unused and
overlap the new leases (GPUC-9); the WGSL program struct is still written twice (GPUC-7); the stack kit's blend menu
lists the 20 modes in contract order instead of Photoshop's groups. The print-stack document bound at the
"finished" cut was raised from 3e-4 to 8e-4 (measured 4.3e-4): the sRGB curve is steep in the darks and magnifies
the stack's existing error; the 8-bit display difference stays at most one level, so the bound is accepted.

**Phase 2 — Feature completion before the beta.** Output: OUT-1 (a working Output module), OUT-2 (export at the
file's size, size choice, JPEG) and the rest of group 7. Before the film: LAY-1 (white balance in scene light, D2),
LOOK-6 (stocks and grades as medium presets, D6). Masks and layers: MASK-3 (mask controls and handles), MASK-2
(selections as components, D3), MASK-4, LAY-2 (simple adjustment layers), LAY-4 (multi-select), LAY-5 (wording) and
the rest of group 2. Darkroom: DARK-1 (Finish and before-the-film palettes in Darkroom first), the rest of group 3.
Finish (group 4), looks and library (group 6), roll workflow and scan conditioning (group 5; SCAN-1 and DARK-4
checked on real scans first), interface (group 10). Then switch the default arrangement per D1.

*Phase 2, first round (2026-11-15/16):* CHB-047 (Output: OUT-1, 2, 3, 5, 6, 7), CHB-048 (before the film: LAY-1,
LOOK-6, LAY-2) and CHB-049 (masks: MASK-2, 3, 4) done and merged (rows marked below). Contract 3.0.0, STORAGE_FORMAT 5
(saved edits are cleared once). Left open from this round: OUT-4 soft proofing (not started); the CPU engine cannot
export a 24 MP file (needs a banded export in core); the full-size export decodes the file again each time (4.6 s of
8.3 s); saved edits do not record the working size, so a frame edited on one engine reads at the wrong scale on the
other (`scaleDocument` is the piece the fix needs); the cam16-ucs knee has no control in his words; printer intents
untested on a real LUT profile; handles and selection tools assume document pixels (wrong under a crop or a turned
frame); menu Grow/Contract/Feather use fixed amounts; no brush-size key; a superseded mask draft can stay on screen
under load; double-click on Temperature resets to None, not As shot; a negative's scan stock is a plain select, not a
preset; the display-knee first-exit fix wants a check on real deep-blue pictures. Key decision at merge: W is the
white-balance picker (Lightroom's Develop key), the magic wand is Shift+W. For the photographer to judge: export
defaults (JPEG, sRGB, original, q90) and export settings as preferences; Deselect removes the mask; Draw defaults to
Add; the wand samples the image the mask reads (the negative for a darkroom layer); Lightroom's white-balance numbers
and presets; the grade as a half-step picker.

**Phase 3 — Performance (beside phase 2).** PERF-1 (open-loop bench with requirements as numbers, a gate) first, then
PERF-2 (present from GPU textures, T1), the pyramid (T2), checkpoints (T3), early cutoff, and the GPU debts of
group 9.

**Phase 4 — Beta with the photographer.** Calibration and setup (group 13: CAL-1 questionnaire, CAL-8 ColorChecker
shots for D11), his bug reports through Report a Problem, fixes from his sessions.

**Phase 5 — Assistant (group 11)**, with the key in the browser (D12). **Later (group 14):** black and white after the
beta (D10), extensions; no licence work (D9).

New items created by the decisions (not in the triage):

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| NEW-1 | Opening a file goes to Print in Classic (not Library) — done in CHB-046 (5a9350c) | major | D1 | — |
| NEW-2 | The sync dialog says it copies values; "Link" is an explicit option (and Auto Sync while held) — done in CHB-046 (5a9350c) | minor | D4 | — |
| NEW-3 | The darkroom stack lists layers in his order with kind badges; the Enlarger keeps a by-kind summary — done in CHB-046 (5a9350c) | major | D5 | — |

## 1. Masks, selections and local tools

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| MASK-1 | A mask tool disarms after one mask (or needs a drag): today a later click on the picture adds a gradient mask to whatever layer is selected — done in CHB-046 (5a9350c) | major | CHB-037 P9-1 t:hqwh | — |
| MASK-2 | Selections as mask components in their own kit: marquee (rect, ellipse), lasso (freehand, polygonal), magic wand (tolerance, contiguous, sample cut), all/none/invert, grow/contract, feather, selection → mask — done in CHB-049 (5a0c9c3, b025b42) | later | CHB-040 t:f4vl | D3 |
| MASK-3 | Mask controls: mask-level density, per-component invert and on/off, on-picture handles to move/resize/rotate linear, radial and ellipse components (snapping), brush size/hardness/flow in the tool options — done in CHB-049 (5a0c9c3, 85d86d9) | minor | CHB-040 t:srjo | — |
| MASK-4 | Live preview of a mask tool's gesture before release (the new component as a draft; today only the outline shows) — done in CHB-049 (85d86d9) | minor | CHB-039 diary Step 2 (future) | — |
| MASK-5 | Subject/sky selection and fill through a licence-gated provider adapter | later | CHB-022 t:5krk | MASK-2, D3 |

## 2. Layers and adjustments

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| LAY-1 | White balance before the film for camera files: a scene-stage white-balance layer/control; a "before the film" palette in Darkroom first — done in CHB-048 (16fae66, b225e76) | major | CHB-037 P9-12 t:ig9q | D2 |
| LAY-2 | OkLCh hue/saturation/colour/luminosity blend modes apply W3C ClipColor (luminosity can leave the gamut today) — done in CHB-048 (43dc1d6) | correctness | CHB-037 P10-9 t:dpba | — |
| LAY-3 | Overlay, hard light and soft light switch at linear 0.5 (display 0.735), not at mid-grey: document it or encode the switch point — done in CHB-045 (d2a45b3) | minor | CHB-037 P10-23 t:fd6s | D7 |
| LAY-4 | Layer multi-select; grouping (Mod+G) of one layer refused or meaningful ("1 entries" today) | minor | CHB-037 P9-13 t:tkue | — |
| LAY-5 | Layer descriptions in the photographer's words (no formulas, op ids, "Editor lab", cut names or SHA-256 in catalogue `ui` docs) | minor | CHB-037 P9-7 t:6cgv | — |
| LAY-6 | Simple adjustments as catalogue ops (core, GPU, parity, stack kit): Gaussian blur, digital grain beside film grain, threshold, posterize, invert, temperature/tint on the print or scene stage | minor | CHB-040 t:x79l | LAY-1 for white balance |
| LAY-7 | Editor validation: a registered editor form must exist and its `covers` must name real arguments | minor | CHB-037 integration report §8 (P8b) | — |
| LAY-8 | More finishing ops: dye saturation, grain reduction, guided-filter tone ops, bloom (sharpen, clarity, HSL, vibrance and grading exist) | later | CHB-015 t:e4p0 | — |

## 3. Darkroom printing tools

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| DARK-1 | Darkroom first is complete: a Finish palette (crop, straighten, spots, reachable from Find a Command), a "before the film" palette, the ring-around and test strip beside the Enlarger | major | CHB-037 P9-5 t:btm4 | LAY-1, MASK-1; gates D1 |
| DARK-2 | Apply Print Settings to Selection shows its source and what it copies (or asks); the primary frame is visible in the strip — done in CHB-046 (5a9350c) | major | CHB-037 P9-9 t:crj2 | — |
| DARK-3 | Switching Real ↔ Normalised keeps the print's density (carry the time's density into the lights and back; today the print darkens) — done in CHB-046 (5a9350c) | major | CHB-028 t:8nfh | — |
| DARK-4 | First prints of a roll's dense frames come out nearly white (12.6 s where 31.75 s was needed): check the first-print metering on dense negatives | correctness | CHB-037 P9-16 t:n1nz | — |
| DARK-5 | Finer control: drag ranges or a fine-drag modifier (60 px of Time = 2 stops, 40 px of Y = −43 CC), smaller first filtration steps (5/10 CC) — done in CHB-046 (5a9350c) | major | CHB-037 P9-6 t:eo25, CHB-028 t:czh4 | — |
| DARK-6 | Test strip: seconds mode (4/8/12/16/20 s) with its golden, filtration strips with density hold, a tiles layout, a per-step densitometer table | major | CHB-010 t:mj68, t:f1kv | — |
| DARK-7 | Ring-around: filter moves with density hold, labelled in his words ("add 10 M, 11.2 s"); "+Y (−B)" today names filtration but moves the printer lights | major | CHB-010 t:fx3n, CHB-037 P9-18 t:b91y | — |
| DARK-8 | Highlight (threshold) density masks (positive and same polarity exist) | minor | CHB-010 t:gynm | — |
| DARK-9 | A 2D printer-lights colour pad with a density readout (today three sliders plus Lighter/Darker) | minor | CHB-028 t:nbof | — |
| DARK-10 | `darkroom.contactSheet`: a real op on core and GPU or removed (the roll kit renders sheets through documents; the op is a mock stub) | minor | CHB-010 t:fx3n | — |
| DARK-11 | Filtration fast path (Jacobian preview) and its parity test, only if a filtration drag on the GPU engine is measured slow | minor | CHB-010 t:j9cj, t:88wp | PERF-1 |
| DARK-12 | Reciprocity (Schwarzschild) hook, off by default (the preflash is a light-law term already) | later | CHB-010 t:dotm | — |
| DARK-13 | A stale comment: `core/src/print/densityMask.ts:12-13` says same-polarity masks need arguments the contract lacks | minor | CHB-010 t:odj8 | — |

## 4. Finish and retouch

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| FIN-1 | A Lanczos-3 (or better) resampler for straightened exports, with parity (GPU `output.frame` is bilinear today) | minor | CHB-022 t:z8nq | — |
| FIN-2 | Portrait frames on a strip: a per-roll orientation or "rotate all portrait frames" | minor | CHB-028 t:itds | — |
| FIN-3 | Heal seam coefficients cached per edit, not per GPU call (every render and export tile re-solves) | minor | CHB-037 P10-1 t:iwwa | — |

(Crop, straighten and spots in Darkroom first: DARK-1.)

## 5. Scan conditioning and roll workflow

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| SCAN-1 | Film edge found along the wrong side of the synthetic negative (base read there, first print blue): check rebate detection with a left edge | correctness | CHB-037 P9-3 t:h0zb | — |
| SCAN-2 | Engine-independent measurements: the scan settings (rebate box, base, flare) and the roll analysis are measured on the working image, so GPU (4000 px) and CPU (640 px) differ; meter on one analysis level; explain the remaining 0.0026 and 0.0004 log H differences | correctness | CHB-034 t:szeo, t:ayqx, t:alwi, t:3nod | PERF-3 |
| SCAN-3 | The inversion solver's stopping test scaled (‖g‖ ≤ τ‖J‖‖r‖); gtol 1e-9 is below the f32 noise of Jᵀr on the GPU path | correctness | CHB-037 P10-25 t:yxmy | — |
| SCAN-4 | One estimator of the film base (rebatePercentile lives only in a test; production uses blank-rebate then brightest columns) | minor | CHB-037 P10-6 t:zj23 | — |
| SCAN-5 | Roll first print: the roll's alpha 0.75 vs the studio's 1: align or document why — done in CHB-046 (5a9350c) | minor | CHB-028 t:5wjl | D8 |
| SCAN-6 | Cull: a peek spring (cull keys, sweep and undoable ratings exist) | minor | CHB-020 t:mv3s | — |
| SCAN-7 | GPU reductions for roll analysis (pairwise means, LATD, median of Y, gamut-class counts) | minor | CHB-020 t:qvyu | PERF-10 |
| SCAN-8 | Time a 40 MP frame through the dust path; the GPU blur for the trend | later | CHB-020 t:j972 | — |
| SCAN-9 | The roll with a fitted scanner model (per-channel flare from calibration) and lights → filtration; contract additions as CC entries | later | CHB-020 t:wb5j | CAL-4 |

## 6. Looks, presets, snapshots, library

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| LOOK-1 | Document sidecars: `<name>.chromobench.json` beside an export, read on open (File ▸ Save Document exists) | minor | CHB-028 t:hcts | — |
| LOOK-2 | Virtual copies (snapshots exist; `looks.virtualCopy` is a disabled stub) | minor | CHB-021 t:7hew | — |
| LOOK-3 | Match to reference for single frames (`looks.match` is a disabled stub; the roll has it); the auto-lights bookkeeping | minor | CHB-021 t:ji7o | — |
| LOOK-4 | Library: collections and a keyword-editing UI (`frame.keywords` exists) | minor | CHB-028 t:39pe | — |
| LOOK-5 | File ▸ Import Look (`.cblook.js`); remove a kept assistant layout from View ▸ Layout | minor | CHB-037 t:1qlj | — |
| LOOK-6 | Medium presets (film/paper and grade looks were deleted with the cut-off) — done in CHB-048 (0588159) | later | CHB-021 t:xw53 (superseded), HANDOFF §9 | D6 |
| LOOK-7 | Cache look captions per (look, params, document hash) before the library passes ~20 looks | later | CHB-021 t:kzh2 | — |
| LOOK-8 | `cb.arg(…).vsSnapshot()` marker fragment (check whether still wanted) | later | CHB-021 t:8neb | — |

## 7. Colour and output

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| OUT-1 | Classic's Output module: export with format, space and size (today a placeholder that says "come with CHB-011") — done in CHB-047 (bd2df3b) | major | CHB-037 P9-10 t:936y | OUT-2 |
| OUT-2 | Export at the file's own size on both engines (decode full size, tiled; previews stay at working size), an output size choice, JPEG — done in CHB-047 (bd2df3b) | major | CHB-028 t:qfae, CHB-037 P9-14 t:baq3 | — |
| OUT-3 | The CAM16-UCS knee on the GPU (WGSL) with parity; a document asking for it renders with the OkLCh knee on the GPU today (W_PREVIEW_APPROX) — done in CHB-047 (423eec4) | minor | CHB-011 t:s4tf | — |
| OUT-4 | Soft proofing: the 33³ proof table with a gamut channel in the output kernel, tested against lcms (the lcms transform and `output.display.proof` exist) | minor | CHB-011 t:069x | — |
| OUT-5 | Printer output: strip-wise lcms to the printer profile (intent, BPC), profile embedded (`output.printer` exists, unused) — done in CHB-047 (d9ee526) | minor | CHB-011 t:joib | OUT-2 |
| OUT-6 | Check the sRGB/P3 cICP code points against H.273; fix the design doc's note crediting paper white and Dmax to the Endura data — done in CHB-047 (1d4b361) | minor | CHB-011 t:bk2k | — |
| OUT-7 | RAW colour regression test from CHB-033 script 01 (skips without the private files) — done in CHB-047 (c8e8875) | minor | CHB-033 t:y8dh | — |
| OUT-8 | Forward matrices / the camera's dual matrices, only if a colour chart says Adobe's colour is closer | later | CHB-033 t:s66f | CAL-8, D11 |
| OUT-9 | Lightroom / Adobe Color rendering as a taste reference (optional) | later | CHB-033 t:xvhd | D11 |

## 8. GPU engine correctness

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| GPUC-1 | `dropFields` releases an exact export's field textures into the pool when a preview starts; a tile that took one before submitting can read another render's writes (wrong pixels, no error) — done in CHB-045 (fd3e834) | correctness | CHB-037 P10-10 t:nin8 | — |
| GPUC-2 | Grid-rule ties: ⌊(p+½)·w/n⌋ with an f32 ratio picks the left pixel on exact boundaries (554 of 3901 widths at 4000 px); integers in pointwise, retouch, frame WGSL and `residency.ts`; a law test sweeping widths — done in CHB-045 (b148f6f) | correctness | CHB-037 P10-15 t:fzfg | — |
| GPUC-3 | Density-mask mode 7 (`combine.wgsl:64`) takes log2 without a floor; a flushed subnormal gives −∞ — done in CHB-045 (3add9fd) | correctness | CHB-037 P10-26 t:cdo6 | — |
| GPUC-4 | Retired bytes leave the ledger before they are destroyed; with overlapping renders the uncounted memory is unbounded — done in CHB-045 (fd3e834) | correctness | CHB-037 P10-11 t:o20c | — |
| GPUC-5 | Three Gaussians (GPU 3σ clamp, f64 film 4σ mirror, dust 3σ mirror): unify and state the tolerance the parity tests use | correctness | CHB-037 P10-17 t:3g6k | — |
| GPUC-6 | Wide blurs run ⌈(σ/32)²⌉ passes and overstate their reach by √p (a DIR tail declares 837 px for 3σ = 277) | minor | CHB-037 P10-16 t:irmc | — |
| GPUC-7 | An unknown op code is the identity in `pointwise.wgsl`; generate WGSL structs, op codes and MAXOPS from `layout.ts` | minor | CHB-037 P10-19 t:9cri, P10-8 t:1dv4 | — |
| GPUC-8 | Budget leaks: film table buffers outside the budget, a 164 MiB texture of ones for a constant; a failed `TableCache.put` leaks textures, `TableManager.live` never drops, `GpuTimer.log` grows; preview cache keys do not name the table builder | minor | CHB-037 P10-13 t:qad6, P10-22 t:5g4o | — |
| GPUC-9 | Dead or unmeasured machinery: `Pool.acquireChecked` (wire in or delete, and the `pool.ts` header), `GpuTimer.wall`, `PipelineCache.compileMs`, a pipeline-layout key chosen by the caller | minor | CHB-037 P10-5 t:t3aq, P10-14 t:g1a0, P10-4 t:4abm, P10-20 t:olsy | — |
| GPUC-10 | Engine abilities outside the `Engine` contract (`evaluateU16`, `openDecoded`, `forgetSource` by casts) as declared optional capabilities | minor | CHB-037 P10-7 t:bqhj | — |
| GPUC-11 | A test comment: the OkLab blend error is 0.03 of an 8-bit level, not a third | minor | CHB-037 P10-27 t:ivj6 | — |

## 9. GPU and CPU performance

### CHB-035 design 02, Part IV: state after CHB-037 and CHB-041

| P | Proposal | State | Remaining item |
|---|---|---|---|
| P1 | Keep previews on the GPU | **half**: sources stay resident per frame within one budget, proxies at render size (CHB-041); presentation still crosses GPU → CPU → GPU on two devices | PERF-2 |
| P2 | Source pyramid for draft and screen passes | **half**: proxies give the memory win with bit-exact parity (CHB-041); no area-averaged levels, sampling is still nearest | PERF-3 |
| P3 | Content-keyed checkpoints | open (CHB-041 kept LRU and deferred GreedyDual-Size to checkpoints) | PERF-4 |
| P4 | Open-loop bench with requirements as numbers | open (benches run only with `BENCH=1` and gate nothing) | PERF-1 |
| P5 | Tiles for refine and export only | **export done** (exact tiles with halos, CHB-037 P3b); refine renders the visible region but has no per-tile cache | PERF-5 |
| P6 | Early cutoff for masked digital layers | open | PERF-6 |
| P7 | Scheduling refinements | **partly**: adaptive drafts sized by measured speed (`render-bridge.ts:90-115`); finished results of superseded requests and cancel between fused segments open | PERF-7 |
| P8 | WebAssembly in the CPU engine | open, after profiling | PERF-8 |

### Items

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| PERF-1 | (P4) Requirements table and an open-loop driver (events on a 16.7 ms clock, p50/p95/p99 per scenario); a time-to-picture gate measured from the input event | major | CHB-035 t:2xtd, CHB-037 P10-3 t:xshr | — |
| PERF-2 | (P1) Present from GPU textures: engine and presenter on one device (readback of 4000×2674 is 56.3 ms vs 6.4 ms for the chain on M1 Max) | major | CHB-037 P10-24 t:j0jt, CHB-035 t:2xtd | PERF-1 |
| PERF-3 | (P2) Area-averaged pyramid in both engines; the proxy becomes the level; one analysis level for metering | major | CHB-035 t:2xtd | — ; fixes SCAN-2 |
| PERF-4 | (P3) Checkpoints (film dyes, paper exposure, print before the digital stage) in `Residency` with measured costs and GreedyDual-Size | major | CHB-035 t:2xtd, CHB-041 diary Step 3 | PERF-1 |
| PERF-5 | (P5) Visible tiles at 1:1, cached by node and tile, centre first | minor | CHB-035 t:2xtd | PERF-4 |
| PERF-6 | (P6) Early cutoff of masked digital layers per tile | later | CHB-035 t:2xtd | PERF-5 |
| PERF-7 | (P7) Keep finished results of superseded requests, cancel between fused segments; fix the draft comments (`queue.ts:299`, `main.ts:338`) | minor | CHB-037 P10-2 t:7uba | PERF-1 |
| PERF-8 | (P8) WebAssembly in the CPU engine where profiling says it pays | later | CHB-035 t:2xtd | profiling |
| PERF-9 | CPU engine at 1:1: a refine pass at the file's resolution for the visible region, with progress (or label 1:1 honestly; today 640 px shown as "100 %") | major | CHB-029 t:kzxz (t:rir6 duplicate) | UI-2 |
| PERF-10 | `measure()` reads back f32 and uploads again, seven awaited dispatches, 2.6 MiB of moments at 24 MP: reduce on the device to a few bytes | minor | CHB-037 P10-18 t:inb4 | — |
| PERF-11 | Exact darkroom export (1650 ms at 4000 px on Metal): tiles planned from the DAG's live-texture peak, fields built in one pass | minor | CHB-037 t:mr9z | — |
| PERF-12 | Readback: two full-size device copies per `readTexture`; the 16-bit export reads back a constant alpha | minor | CHB-037 P10-21 t:xsqv | — |
| PERF-13 | Remove the per-pass completion waits in `film.ts:138` and `spatial.ts:104` (queue order makes return-after-submit safe) and measure | minor | CHB-037 P10-12 t:pen5 | — |
| PERF-14 | Shell benches: cells re-checked per step, frame budget, a store transaction on a 10k catalogue, build/mount time | later | CHB-028 t:sy6a | PERF-1 |

## 10. Interface shell and UI DSL

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| UI-1 | Jobs slice: renders from the queue, `withJob()` for opens, decodes and exports; a status jobs list with cancel, staged open progress, thumbnail spinners; then a session on the CPU engine to confirm | major | CHB-029 t:7fk7, t:vde3 | — |
| UI-2 | The status bar in the DSL (`ck.statusbar`, `cb.status.*`); host dialogs from DSL pieces (today host DOM in `main.ts`) | minor | CHB-029 t:5tv9 | — |
| UI-3 | View ▸ Layout: a description per layout, no clipped labels | minor | CHB-037 P9-15 t:vktj | — |
| UI-4 | Classic opens a file into Print, not Library | minor | CHB-037 integration report §6 | D1 |
| UI-5 | Design pass: panel titles that look like buttons, Classic's Layer panel showing another module's layer, Edit/Roll/Finish both menus and modules | minor | CHB-037 P9-17 t:3606 | — |
| UI-6 | The "Where is …?" dialog and File ▸ Open / Ctrl+O while it is up (check: the dialog already closes when the file opens another way) | minor | CHB-028 t:5vfk | — |
| UI-7 | History details: units (stops vs ⅓), "You" on every row, row order after merges, truncated rows (check against the CHB-037 History panel) | minor | CHB-028 t:6lah | — |
| UI-8 | A standalone histogram panel (RGB and luminance, percentiles, clipping warnings) on the viewer's cut, placeable in any layout | minor | CHB-040 t:oyhm | — |
| UI-9 | An async command's writes after its first `await` are attributed to the photographer, not the agent | minor | CHB-037 integration report §8 (P6b) | — |
| UI-10 | axe-core checks in the per-layout Playwright smokes | minor | CHB-028 t:bxp0 | — |
| UI-11 | Developer docs: a reference generated from form docs, a table of every CK-/CB- code (family, title, owner, fix), a "Writing a layout" topic, a wording review, a test for the I010/I011 reach checks | minor | CHB-028 t:r414, t:d552, t:v4fu | — |
| UI-12 | Workspace conveniences: drag-to-redock within the layout model, a per-tool hint line, colour swatches, pointer info, per-layer render time from the journal | later | CHB-040 t:k2zs | — |
| UI-13 | `ck.inspector()` panel over `rt.inspect()` | later | CHB-028 t:fj9p | — |
| UI-14 | Hot reload of layouts in development (`import.meta.hot`) | later | CHB-028 t:0x4k | — |

## 11. Agent and assistant

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| AGT-1 | Safety tests for agent layouts: throws at build or run time, runaway selectors, memory (functions refused with E_LAYOUT are tested) | minor | CHB-030 t:t7ql | — |
| AGT-2 | Chat threads kept and restored on reload (the KV `threads` store is unused) | minor | CHB-008 t:qur1 | — |
| AGT-3 | Image attachments from the photographer in the chat, ≤ 1568 px at ingestion | minor | CHB-008 t:5yyv | — |
| AGT-4 | "Approvals since your last eval" in worker and MCP results (the chat has it); an agent-level golden result | minor | CHB-008 t:kbxw | — |
| AGT-5 | Playbooks: dust pass and roll consistency | minor | CHB-008 t:eqyx | — |
| AGT-6 | Opt-in transcripts, a replay harness on engine-mock, transcript metrics | later | CHB-008 t:vg50 | — |
| AGT-7 | Task evaluations on the reference engine (budget-gated); image-privacy settings | later | CHB-008 t:u7mw | — |
| AGT-8 | Bridge: `go:embed` of the built studio; CrossOriginProtection, a SameSite page cookie, a setup page; the Claude API proxy (check whether still wanted) | later | CHB-008 t:3hb1, t:kd8u, t:ch9a | D12 for the proxy |

## 12. Diagnostics and testing

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| DIAG-1 | The roll flow test failed 2 of 6 full runs under load before CHB-037; check whether it still flakes | minor | CHB-034 t:4o9y | — |
| DIAG-2 | Playwright test for the 8-bit browser decode fallback (JPEG/WebP) | minor | CHB-028 t:pb6c | — |
| DIAG-3 | The Chromium launch hang under `REAL_GPU=1` (3 times in P9, never the same test) | minor | CHB-037 integration report §8 | — |
| DIAG-4 | A first Linear drag after adding a Dodge did nothing (not reproduced): watch | minor | CHB-037 P9-2 t:siez | — |
| DIAG-5 | Synthetic frame sets: five of six remain (truth, class masks, stable ids), and the decoders' TIFF/PNG subset | later | CHB-004 t:8egr, t:urgj | — |
| DIAG-6 | HANDOFF names the mask overlay (O, Shift+O, Alt+O, `stack.overlay`) in its stack kit paragraph | minor | CHB-039 diary Step 4 | — |

## 13. Calibration with the photographer

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| CAL-1 | The setup questions and the call that picks the branch: light source settings, stocks, B&W (films, developers, papers, head), print target, desktop vs browser (known: flatbed + VueScan linear DNG, NLP positives as references) | major | CHB-013 t:59ma (t:gb3u, t:5yc4 duplicates), CHB-014 t:nkhw | — |
| CAL-2 | Capture protocol and kit list per branch (flat field, step wedge, lens-cap frame, rebate and open gate, optional IT8) as a playbook; a calibration wizard spec | later | CHB-013 t:4mux | CAL-1 |
| CAL-3 | Private fixture manifest and consent text; the first kit collected and decoded without clipping (a CHB-038 report can carry originals) | later | CHB-013 t:blc5 | CAL-2 |
| CAL-4 | Fits: wedge steps and photometric fit, flat-field verification, LED peak fit, camera-curve PCA prior with MAP, Rozzi scanner fit, the ScannerModel record and report | later | CHB-013 t:b5wo, t:510r, t:fg72, t:249h, t:vv47, t:ggj9 | CAL-3; t:249h after LATER-9 |
| CAL-5 | Sample rolls per stock (bracket, chart, scenes) and reference prints as fixtures (patch Lab, darkroom notes as a real-enlarger document) | later | CHB-013 t:51gg, t:gizl | CAL-3 |
| CAL-6 | Beta: success criteria C1–C8, analysis over CHB-038 reports, sessions B0–B5, the API pruning note (CONTRACT-DECISIONS and DSL docs) | later | CHB-013 t:yjor, t:1rnt, t:m4we, t:5bpf | CAL-1 |
| CAL-7 | LibRaw on public samples: X-Trans, two-illuminant DNG, non-zero sensor margins (his own camera files open) | minor | CHB-013 t:ehco | — |
| CAL-8 | A colour chart shot in daylight and tungsten as the RAW-colour ground truth | later | CHB-033 t:jzl6 | — |

## 14. Later: black and white, extensions, data and licences

| # | Item | Severity | Sources | Depends on |
|---|---|---|---|---|
| LATER-1 | Black-and-white negatives and papers: reading and datasheets; digitised film and Multigrade data; measurements with the photographer; `tools/bw-data` packs; silver development, Callier and VC paper models, `invert.silver`; one-channel grain/halation/adjacency; contract entries; darkroom integration (per-component light, split grade); controls, IR-dust and playbook; goldens; toning, stain, XP2, colour negatives on B&W paper | later | CHB-014 t:z31q, t:kwm4, t:ljur, t:pwkk, t:jd32, t:okza, t:u7ag, t:yhkc, t:hbus, t:pzmo, t:t7vb, t:dv3n, t:719o, t:z23c, t:n6qt, t:o8ev | D10, CAL-1 |
| LATER-2 | Fading restoration: `invert.unfade` with the picked-patch estimator, roll-level k and table domain widening, one real faded roll with the photographer | later | CHB-015 t:jwpu, t:33j6, t:w7wg | CAL-1 |
| LATER-3 | Physical reflectance: the Saunderson refit of the paper, a `view.reflect` switch | later | CHB-015 t:hamr | — |
| LATER-4 | Reprint as another stock: the DIR-aware inverse and its error budget | later | CHB-015 t:uv0e, t:8fki | — |
| LATER-5 | Boolean / shot-noise grain in f64 and a WGSL kernel; decide export-only or preview | later | CHB-015 t:k5rh, t:wyd3 | — |
| LATER-6 | A learned light estimator, shipped only if it beats the baselines on a roll-split harness | later | CHB-015 t:pe3o, t:m1yn | — |
| LATER-7 | Pixel-shift sources (vendor-combined DNG, Sony ARQ; refuse unmerged sequences) | later | CHB-015 t:xgx0 | — |
| LATER-8 | Measured camera curves (Jiang et al., Butcher) as a separately licensed pack | later | CHB-004 t:3n63 | D9 |
| LATER-9 | Check the exposure-index convention of the Portra 800 push profiles against Kodak's datasheet (the profiles are exported and used) | later | CHB-004 t:6qfb | — |

---

## Owner decisions

All decided on 2026-11-15: see `03-decisions-d1-d13.md`. The table below is the state before.

Every open decision once; where several tickets ask the same question, all are named.

| # | Decision | Today | Asked in |
|---|---|---|---|
| D1 | The default arrangement | Classic is `DEFAULT_LAYOUT`; the persona session recommends Classic now (opening into Print) and Darkroom first once it has Finish, "before the film", ring-around/test-strip palettes and MASK-1 | CHB-035 §38 q1 and t:qyx4, CHB-037 t:qv4l (duplicate), integration report §6, HANDOFF §9 |
| D2 | Is the scene stage for camera files wanted, and white balance before the film? | the Scene module exists in Classic; no white-balance layer | CHB-035 §38 q2, CHB-037 P9-12 t:ig9q, HANDOFF §9 |
| D3 | Are selections wanted? | none; masks only | CHB-035 §38 q3, CHB-040 t:f4vl, CHB-037 reference 03 |
| D4 | Does sync copy values or insert a link by default? | copy | CHB-035 §38 q4, HANDOFF §9 |
| D5 | Does the darkroom stack show his order or group by kind? | the Enlarger groups by kind | CHB-035 §38 q5, HANDOFF §9 |
| D6 | Medium presets for the deleted film-stock and grade looks | deleted in P7 (CC-021) | CHB-037 diary (P7 merge), HANDOFF §9, CHB-021 t:xw53 |
| D7 | Blend modes: keep the switch at linear 0.5 (display 0.735) and say so, or switch at display mid-grey | linear 0.5, undocumented | CHB-037 P10-23 t:fd6s |
| D8 | Roll first-print colour aim: align the roll's alpha 0.75 with the studio's 1, or keep it and say why | different | CHB-028 t:5wjl, HANDOFF §9 |
| D9 | Licences before any public release: commercial use and NC packs, GPL reach of ported code, the hanatos tables, CIE/filter licences, the name, the illustrative pack | deferred (not public) | CHB-004 t:7w8x |
| D10 | Black and white: in scope, in the first beta? | parked | CHB-014 t:nkhw, CHB-013 t:59ma |
| D11 | RAW colour: forward matrices or the camera's dual matrices if a chart says Adobe is closer; Lightroom as a taste reference | ours kept (2026-11-14) | CHB-033 t:s66f, t:jzl6, t:xvhd |
| D12 | The Claude API proxy in the bridge vs the key typed in the browser | direct calls with his key | CHB-008 t:ch9a |
| D13 | When to merge `task/chb-037-unified-model` into main | not merged | CHB-037 main diary Step 16 |

Technical decisions proposed in CHB-035 design 02 and not yet taken (for whoever opens the performance ticket):
presentation from GPU textures on one device with 16/8-bit readback as the fallback (P1); pyramids in both engines,
refine and export at full resolution (P2); GreedyDual-Size for checkpoints, LRU for final images (P3).

## Suggested order

1. **Correctness, now:** GPUC-1, GPUC-2, GPUC-3 (silent wrong pixels in the GPU engine), then GPUC-4, GPUC-5, LAY-2,
   SCAN-3; check SCAN-1 and DARK-4 (both may be wrong first prints).
2. **What blocks the photographer:** MASK-1, DARK-2, DARK-3, DARK-5; OUT-2 then OUT-1 (export at the file's size with
   a size choice and JPEG, in an Output module); UI-1 (progress for opens and exports). Ask the owner D1–D5 and the
   photographer CAL-1 meanwhile; then DARK-1 and LAY-1 according to the answers.
3. **Performance with a measure:** PERF-1 first, then PERF-2, PERF-3 (also removes SCAN-2), PERF-4; PERF-9 for the
   CPU engine.
4. **The rest** by group: darkroom tools (DARK-6, DARK-7), looks and library, colour management (OUT-3…OUT-5), the
   agent's items, docs and tests. B&W and the extensions wait for D10 and the calibration.

## Ticket status after triage

| Ticket | Open before → after | Done | Superseded | Obsolete | Duplicate | Closed |
|---|---|---|---|---|---|---|
| CHB-004 | 6 → 5 | 1 | 0 | 0 | 0 | no |
| CHB-008 | 11 → 9 | 1 | 1 | 0 | 0 | no |
| CHB-010 | 9 → 8 | 1 | 0 | 0 | 0 | no |
| CHB-011 | 6 → 4 | 2 | 0 | 0 | 0 | no |
| CHB-013 | 18 → 16 | 0 | 0 | 0 | 2 | no |
| CHB-014 | 17 → 17 | 0 | 0 | 0 | 0 | no (parked) |
| CHB-015 | 14 → 12 | 0 | 2 | 0 | 0 | no (parked) |
| CHB-020 | 4 → 4 | 0 | 0 | 0 | 0 | no |
| CHB-021 | 9 → 4 | 3 | 2 | 0 | 0 | no |
| CHB-022 | 5 → 2 | 0 | 3 | 0 | 0 | no |
| CHB-026 | 2 → 0 | 1 | 0 | 1 | 0 | **yes** |
| CHB-028 | 18 → 18 | 0 | 0 | 0 | 0 | no |
| CHB-029 | 12 → 4 | 7 | 0 | 0 | 1 | no |
| CHB-030 | 6 → 1 | 5 | 0 | 0 | 0 | no |
| CHB-033 | 5 → 4 | 1 | 0 | 0 | 0 | no |
| CHB-034 | 5 → 5 | 0 | 0 | 0 | 0 | no |
| CHB-035 | 3 → 2 | 1 | 0 | 0 | 0 | no |
| CHB-037 | 45 → 44 | 0 | 0 | 0 | 1 | no |
| CHB-040 | 5 → 5 | 0 | 0 | 0 | 0 | no |
| CHB-038 | 0 → 0 | — | — | — | — | **yes** (merged) |
| CHB-039 | 0 → 0 | — | — | — | — | **yes** (merged) |
| CHB-041 | 0 → 0 | — | — | — | — | **yes** (merged) |
| **Total** | **200 → 164** | **23** | **8** | **1** | **4** | 4 closed |
