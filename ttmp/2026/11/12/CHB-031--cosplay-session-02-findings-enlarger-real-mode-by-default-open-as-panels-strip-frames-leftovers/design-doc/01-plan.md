---
Title: Plan
Ticket: CHB-031
Status: active
Topics:
    - ui
    - product
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/various/02-findings.md
      Note: Findings F17–F23 and the session-02 verdicts (section "Session 02")
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/sessions/02-sonnet-rerun-session-01/experience-report.md
      Note: Session 02 report with repro scripts and screenshots
    - Path: /home/manuel/code/wesen/chromobench/packages/core/src/print/enlarger.ts
      Note: Normalised mode ignores the optics (F17)
    - Path: /home/manuel/code/wesen/chromobench/packages/contract/src/catalog/capture-film-print.ts
      Note: print.enlarger.mode default 'normalised' (F17)
ExternalSources: []
Summary: "Fix the cosplay session 02 findings in two parallel workstreams: A enlarger and controls (F17 real mode by default, F19, F23, F8, F9, F12), B open, strips and library (F18, F20, F21, F22, F10)."
LastUpdated: 2026-11-12T19:00:00-05:00
WhatFor: "Spec for the CHB-031 agents."
WhenToUse: "Before implementing or reviewing CHB-031."
---

# CHB-031 plan

Session 02 (a re-run of session 01 by a Sonnet tester on main 3703d0a) confirmed most session-01 fixes and found
F17–F23. Read the findings section "Session 02" and the session-02 experience report first: each finding has a
repro, screenshots and a script under `sessions/02-sonnet-rerun-session-01/scripts/`.

## WS-A: enlarger and controls (branch `task/chb-031-enlarger`)

**F17 (major): Time and Aperture are inert in the default enlarger mode.** `print.enlarger.mode` defaults to
`normalised`, which normalises print exposure so the grey card prints at the aim and "ignores the optics"
(`packages/core/src/print/enlarger.ts`). Owner decision (2026-11-12, CHB-031 diary step 1):
1. **Verify first** and record in the diary: does the test strip in seconds show identical bands in normalised
   mode? What does the automatic first print (`apps/studio/src/host/first-print.ts`, CHB-023) set in real mode for
   a photo and for a negative?
2. **Real mode is the default for the darkroom-style layouts** (classic, darkroom, lab, and the others that show
   the darkroom controls). New recipes get `mode: 'real'`; the automatic first print sets the time so each frame
   still opens correctly exposed; Lighter and Darker change the time by ⅓ stop in real mode (printer points
   in normalised mode). Saved recipes keep the mode they store.
3. **Normalised mode stays as an option** and is the default of the simple and tiny layouts. While it is on, Time,
   Aperture and magnification are hidden (not disabled-but-visible), and no inert control can be changed or
   recorded in History.
4. Tests: a time change changes the print in real mode (a pixel-level check like session 02's
   `s10-does-time-matter.mjs`); the test strip in seconds varies; layout defaults; old recipes unchanged.

How a layout chooses the default mode is part of the work (a studio/layout option read when a new recipe is made);
keep it small, CHB-029 restructures layouts next.

**F23:** negative-only controls (scanner, viewing light, film stock for a scan's base) shown for a digital photo:
hide them for `digital-raw` frames or explain them in one line where they do apply (film stock *does* apply to a
photo: it is the stock the scene is exposed onto).
**F19:** the Darkroom panel with no frame selected shows placeholder-like text and live sliders: show an empty
state ("Select a photo to print it").
**F8 leftover:** a bare "-5" is still relative. Decide with the persona in mind: a plain number is absolute; a
relative change needs a sign *and* a unit or stop (`-5 s`, `+1/3 st`); keep the hint.
**F9 leftovers:** the engine tooltip (`CPU f64 … E_EVAL`), the LibRaw/camera-matrix note, the "Dyes" and
"Base & gamut" view tabs: human wording first, technical text second.
**F12 leftover:** Edit ▸ Undo/Redo label names the frame when it is not the current one.

## WS-B: open, strips and library (branch `task/chb-031-open-strips`)

**F18:** File ▸ Open As persists across restarts and is applied silently when a library frame is relinked. A
relinked frame opens in its own recorded kind; a persistent non-Auto Open As is visible (status line or menu
check) and resets to Auto at start unless he chose "always".
**F21:** "Where is …?" opens by itself after Remove from Library (the selection moves to the next not-open frame).
Relink only on an explicit user selection of that frame.
**F20:** strip frames show sideways and blocky; frame 1 hazy and bluish; no rotate command.
- Orientation: a per-frame rotate (Frame ▸ Rotate Left/Right, `view.frame.orientation`), and a sensible default
  for frames cut from a vertical strip (landscape frames on a vertical strip read sideways).
- Blockiness: a crop of a working image is small; check the working size used for a strip frame (the GPU works at
  up to 4000 px, the CPU at 512 px for the whole strip: a 3-frame strip leaves ~170 px per frame on the CPU).
- Haze: compare frame 1's base/veil with frames 2–3 (shared strip base vs per-frame).
**F22:** cold first open ~29 s with only "opening…": profile the cold path (WASM instantiation, LibRaw, data packs,
GPU or CPU tables) and cut what can be cut; the visible progress display itself is CHB-029 item 6.
**F10 (CPU engine):** a sharper preview on the CPU path without losing responsiveness (WS-B of CHB-027 kept 512 px
by default; `?refLong=1024` is ~3× slower): consider a larger working image only for the shown region (refine pass)
or for strip frames.

## Shared files and merge

WS-A owns `packages/contract` catalogue defaults, `packages/core/src/print/*`, `apps/studio/src/host/first-print.ts`,
the controls panels and `packages/studio-kit/src/kit/args.ts`. WS-B owns the open flow and library code in
`apps/studio/src/main.ts`, `packages/studio-kit/src/bridge/frames.ts`, `apps/studio/src/host/decode.ts`. Both may
touch `packages/studio-kit/src/cb.ts` (commands): keep edits local; the orchestrator merges A then B.
CHB-032 (housekeeping) runs in parallel and touches core's `engine-ref.ts` imports, gpu, ingest/output TIFF writers
and docs only.

## Done when

F17–F23 and the leftovers fixed or deliberately downgraded with a reason; checks green; then a cosplay re-run
(session 03) of session 02's steps plus the darkroom flow (test strip in seconds, time, filtration) in real mode.

## Round 2: session 03 findings (2026-11-12)

Session 03 (CHB-026 `sessions/03-sonnet-rerun-session-02/`, findings F24–F37 in `various/02-findings.md`, section
"Session 03") confirmed F17–F23 fixed except F20 (partly). It found two major problems (F30, F31) and a set of
minor ones. Round 2 fixes them in two parallel workstreams. Progress display on the CPU engine (the "refine" waits
of F34) stays in CHB-029 item 6.

### WS-C: the picture (branch `task/chb-031-picture`, diary 04)

- **F31 (major):** a digital photo gets no automatic first print. `apps/studio/src/main.ts` sends `digital-raw`
  frames to `photoRecipe` (10 s f/8, as-shot white balance) instead of `firstPrint`. Give photos a first print
  in their enlarger mode. The density goes into the time in real mode (lights in normalised mode), and the colour
  keeps the camera's as-shot white balance (no integrate-to-grey colour on a photo). Pixel test: the daylight NEF
  class of picture opens near the aim grey, not at luma 57/255.
- **F30 (major, owner decision pending):** the first print of a negative integrates the whole frame to grey
  (alpha 1), cooler and flatter than Negative Lab Pro's. Do not change the default aim. Make the colour share
  (alpha) and any subject-failure rule one named setting in one place. Add a script that renders a frame the way
  the app does and compares it with a colour-managed reference (the NLP positives in `.playwright-mcp/scans/`,
  ProPhoto RGB → sRGB), printing B/R, saturation and luma statistics for a few alphas. Report the numbers in the
  diary for the owner's decision.
- **F28:** the Epson strip `2025-08-09_raw000.dng` opens with its frames sideways, while raw010's are upright. Find
  why CHB-031 WS-B's default (transpose landscape frames on a vertical strip) does not apply. Frames already in a
  library keep their stored orientation (no silent change).
- **F25:** in Simple (normalised) a read-only "Time 10.0 s" row stays visible and never moves; two rows are titled
  "Printer lights". Hide the time row while normalised and give the rows distinct titles.
- **Leftovers:** srvr (no inert control in the edit log: the looks kit's density look, agent proposals and the
  DSL time strip on a normalised recipe); the decode note "film edge found" when a strip's base comes from the
  gaps (say where the base was read).

### WS-D: the interface (branch `task/chb-031-interface`, diary 05)

- **F24:** View ▸ Layout switch closes the open frames. Switching layout keeps the open files and their frames
  open (the sources stay in the engine; only the interface is rebuilt).
- **F26:** "Where is …?" stays modal when the frame's file is opened another way (File ▸ Open). Close the dialog
  as answered when its frame becomes open.
- **F32, F35 (F9 leftovers):** History entries in words with consistent units ("+⅓ stop", "Rotated left",
  "Frame crop set"), no raw JSON; the tooltip typo; `E_EVAL` / `W_NO_*` codes only in the "Technical:" line;
  status words "refine"/"draft" in plain words.
- **F33:** History rows overlap after about 20 entries: fix the panel's layout (scrolls, rows keep their height).
- **F34 (part):** a View ▸ Actual Pixels (1:1) command and a zoom readout (the CPU progress display stays in CHB-029).
- **F36:** Undo of another frame selects (shows) the frame it changed.
- **8iv8:** darkroom layout with no frame: one empty-state text, no empty Exposures panel.

### Shared files

Both touch `apps/studio/src/main.ts` (C: the `initial` hook; D: dialogs and the layout switch) and
`packages/studio-kit/src/cb.ts`: keep edits local. The orchestrator merges C then D.
