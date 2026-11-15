---
Title: Integration report
Ticket: CHB-037
Status: active
Topics:
    - architecture
    - ui
    - webgpu
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://docs/HANDOFF.md
      Note: the handoff guide after CHB-037
    - Path: repo://e2e/walkthrough.spec.ts
      Note: the walkthroughs the report describes
ExternalSources: []
Summary: 'CHB-037 P9: the unified studio checked end to end — browser suite on SwiftShader and Metal, walkthroughs, persona session on the two arrangements, fixes, open items.'
LastUpdated: 2026-11-15T04:25:29.045217-05:00
WhatFor: ""
WhenToUse: ""
---


# CHB-037 integration report (phase P9)

Branch `task/chb-037-p9-integration` (from the integration branch at 834ed40). Diary:
`diary/17-phase-p9-integration.md`. Everything here was run on synthetic material only.

## 1. Results

| Check | Result |
|---|---|
| `pnpm typecheck` | 0 errors |
| `pnpm lint` | boundaries ok (480 file checks), colours ok (187 files) |
| `pnpm gen:check` | ok (26 files) |
| `pnpm test` (vitest) | 137 files, 3383 passed, 19 skipped |
| `node tools/goldens/render.ts --check` | 66/66 within max abs Δ 1e-5 |
| browser, SwiftShader (ports 5511–5514) | **145 passed, 2 skipped** (benches), 0 failed — 147 tests, 8.7 min (final run on the last code commit) |
| browser, Metal (`REAL_GPU=1`, M1 Max, `apple metal-3`) | **145 passed, 2 skipped**, 0 failed — 1.0 min (final run, GPU lock); earlier runs hit a Chromium launch hang 3 times (different tests, all green on rerun) |
| GPU conformance (both adapters) | 524/524 |

Start of the phase (834ed40): SwiftShader 138 passed, 2 skipped (7.9 min); Metal 136 passed, 2 failed, 2 skipped:
`theme.spec` (a fixed 600 ms wait shorter than the 700 ms autosave debounce — fixed in the test, and the same pattern
in five other specs) and `roll.spec` (`browserType.launch: Timeout 180000ms exceeded`, a Chromium launch hang; passed
on every rerun). The two skipped tests are benches (`BENCH=1`).

## 2. End-to-end walkthroughs (`e2e/walkthrough.spec.ts`, all pass on SwiftShader and Metal)

1. **A negative scan from import to export** (Classic): first print (printer lights integrated to grey); Time typed
   `12,5`; a sky burn through a linear gradient drawn on the print; a density (contrast) mask; View ▸ Layout → Looks,
   *Warm print* as a link, back to Classic with the frame kept; Edit: curve with a dragged point, HSL, colour
   grading, clarity through a radial mask, grade blended *soft light*, HSL + grade grouped; Finish: crop, heal spot;
   undo of all 14 steps returns the first print's exact compiled node, redo of all returns the finished node; a 16-bit
   TIFF export of the cropped print.
2. **The darkroom arrangement**: two frames in the vertical strip (selectable), Time, a dodge from the Enlarger,
   the digital palette opened, a Vibrance layer on the print stage, three steps undone.
3. **A roll of four**: New roll → first-printed, every scan linked to the roll; an override (frame 2's base, stored as
   `overrides.baseT`) and its own grade; Settings ▸ Sync Settings in Classic copies frame 1's Time to frames 3 and 4
   in one step; *More contrast* over the roll on one card (Looks layout), approved; one undo takes it off all four
   and keeps frame 2's grade.
4. **A camera file** (synthetic Bayer DNG): opens as a photo with `scene` and `film` stages; the Scene module's
   "+ Layer" Exposure 0.7 st changes the print.
5. **The agent with only `eval`**: `frame.explain()`, a densitometer reading, a what-if
   (`frame.with(sky).print()`) that differs, `frame.propose` → a card he approves; `wb.run('module.edit')`,
   `wb.screen()`; "a simpler screen": `wb.layouts.build({ id: 'simpler', … })` + `wb.layouts.use` → the dialog →
   "Use Simpler" → mounted; View ▸ Layout returns to Classic with the frame and its history (CHB-030's acceptance).
6. **A roll after View ▸ Layout from Darkroom first to Classic** (the persona's blocker P9-8, mock engine).
7. (`e2e/chat.spec.ts`) **The assistant's layout and look survive a reload**: a look defined with
   `cb.looks.define`, applied and approved; "Simpler" accepted; reload → the same layout, the file opened again → its
   edit with the link to the agent's look compiles and renders; View ▸ Layout lists "Simpler (assistant)".

## 3. Screenshots (synthetic scene; `various/p9-arrangements/`)

| File | What it shows |
|---|---|
| `01-classic-print-darkroom-stack.png` | Classic ▸ Print: Exposures as the darkroom stack (main exposure, printer lights, Burn 1 through Mask 1, contrast mask), the Layer panel, History |
| `02-looks-layout-warm-print.png` | the Looks layout with *Warm print* applied |
| `03-classic-edit-print-stack.png` | Classic ▸ Edit: Print layers (curve, a group with HSL and colour grading, clarity through Mask 2), the Layer and Mask panels |
| `04-classic-finish.png` | Classic ▸ Finish: crop and a heal spot |
| `05-darkroom-enlarger.png` | Darkroom first: strip, print, Enlarger (main exposure controls in its row, a dodge, printer lights), Paper, the closed digital palette |
| `06-darkroom-digital-palette.png` | the digital palette open with a Vibrance layer and its controls |
| `07-classic-roll.png` | Classic ▸ Roll after New roll |
| `08-classic-scene-camera-file.png` | Classic ▸ Scene: a camera file's scene stack with an Exposure layer |
| `09-agent-layout-dialog.png` | "Use the assistant's layout?" |
| `10-agent-simpler-screen.png` | the agent's "Simpler" layout mounted (the agent's burn row, approved) |

The persona session's own screenshots are in `sessions/p9-01-manfred-arrangements/shots/`.

## 4. What P9 fixed

| Fix | Where | Commit |
|---|---|---|
| The darkroom arrangement's film strip had no height (a collection in a side column: size containment in a block container) | `packages/shell/src/dom/shell.css` | 744e78f |
| Fixed waits shorter than the autosave debounce before reloads (failed on Metal) | `e2e/theme.spec.ts` and three other specs | 744e78f |
| The assistant's accepted layouts and its looks persist (KV `settings`), View ▸ Layout lists them, `?layout=` reloads them; documents linking an agent look compile after a reload (was E_LINK) | `apps/studio/src/main.ts`, `host/workbench.ts`, `kits/chat/src/workbench.ts` | f1007f5 |
| History and rows in catalogue words ("Added an HSL", "Curve: point added"; a layer the agent built shows "Burn", not "burn") | `studio-kit/src/model/history.ts`, `model/doc.ts`, `kits/stack/src/dom.ts` | f1007f5 |
| Settings ▸ Copy / Paste / Sync Settings (Mod+Shift+C/V/S) in Classic and Darkroom (sync existed only in the Looks layout) | `kits/looks/src/kit.ts`, `layouts/classic.js`, `layouts/darkroom.js` | c0d8a78 |
| Roll ▸ New roll failed after View ▸ Layout from a layout without the roll kit (`E_PATH`): the adopted log gains the new layout's own state (`Log.withFields`, not a step) | `packages/values/src/log.ts`, `packages/shell/src/core/store.ts` | d63a220 |
| The vertical strip's thumbnails were 2 px tall (24 px rows) | `packages/studio-kit/src/cb.ts` | d63a220 |
| The walkthrough read the crop handle's box before it was drawn (Metal) | `e2e/walkthrough.spec.ts` | 348eefd |
| `docs/HANDOFF.md` rewritten for the unified model; `apps/studio/DEMO.md`, shell README current | docs | 4e7853a |

## 5. Persona session (CHB-026 protocol, synthetic material)

Run by a sub-agent playing Manfred (`sessions/p9-01-manfred-arrangements/`: `01-diary.md`, `02-experience-report.md`,
63 screenshots), on a preview build of commit f1007f5 (before the Settings menu and the P9-8/P9-4 fixes), headless
Chromium with WebGPU on SwiftShader (all timings are software timings), synthetic files only
(`node e2e/make-scenes.ts`: a 3000 × 2000 negative, a roll of four 1800 × 1200 negatives, a camera DNG).
Scenarios: S1 a negative to a finished print in Darkroom first; S2 the same in Classic; S3 a roll (partly: New roll
failed); S4 a camera file in both; S5 the comparison.

Top findings (all are CHB-037 tasks; "fixed" = fixed in P9 after the session):

| ID | Severity | Finding | State |
|---|---|---|---|
| P9-8 | blocker | Roll ▸ New roll failed with `E_PATH: roll.rolls.roll-1: no "roll" in the root` after View ▸ Layout from Darkroom first | **fixed** (d63a220: `Store.adopt` adds the layout's own state via `Log.withFields`; e2e test) |
| P9-4 / K4 | major | Darkroom first's film strip: no height, then 2 px thumbnails — only names | **fixed** (744e78f, d63a220) |
| K1 | major | No Copy/Paste/Sync Settings outside the Looks layout | **fixed** (c0d8a78: Settings menu, Mod+Shift+C/V/S) |
| K2 | minor | History by op ids ("Added curve1p3", "Added a hsl") | **fixed** (f1007f5) |
| P9-9 | major | Frame ▸ Apply Print Settings copies from the last-clicked frame, silently overwriting the corrected one | open |
| P9-1 | major | A mask tool stays armed; a later canvas click masks another layer | open |
| P9-3 | major | Film edge found along the bottom instead of the left of the synthetic negative; first print blue | open (check ingest; may be the synthetic scene) |
| P9-5 | major | Darkroom first has no crop, straighten or spot removal | open |
| P9-12 | major | No white balance before the film; Darkroom first has no scene stage | open (owner question 2) |
| P9-11 | major | `E_GPU_OOM` after ~6 frames on SwiftShader; the failed frame shows the previous picture | open |
| P9-10 | major | Classic's Output module is a placeholder | open (CHB-011) |
| P9-6, 7, 13–16 | minor | coarse sliders; developer text in layer descriptions; no multi-select of layers; no JPEG/size in export; unexplained layout list; dense roll frames print nearly white | open |
| P9-2, 17, 18 | note | a first drag that did nothing (not reproduced); panel titles look like buttons; ring-around +Y names filtration but moves lights | open |

Reproduced as fixed since CHB-026: F1 (a DNG opens as a photo), F5 (the library survives a reload), F7/F8 (typed values:
`7,5`, `12s`, clamping with plain messages), F24 (a layout switch keeps the open photos). Worst main-thread stall:
483 ms (before/after toggle); renders 0.2–1 s for time, 2–6 s for filtration, curve and wheels, 8 s after a crop; a
16-bit TIFF export of 3000 × 2000 25.9 s (all SwiftShader).

## 6. The recommended default arrangement

**Classic, for now.** In Manfred's words: "I'd work in Darkroom first, because it feels like my enlarger. But I'd give a
new computer Classic: with it I can get from the negative to a cropped, spotted print, and a camera file has its
scene settings."

Reasons: a new install must carry a first-time user through the whole job, and today only Classic does — it has
crop, straighten and spots (Finish), the ring-around and test strip, the Scene stage for camera files, and now the
Settings menu for sync. Darkroom first is the better everyday screen for this photographer (one screen, the enlarger
beside the print, burns and dodges as rows, never lost), but lacks a Finish palette (P9-5), anything for camera files
before the film (P9-12) and the ring-around/test-strip panels, and its mask tools stay armed (P9-1). Recommended
changes before switching the default to Darkroom first: a Finish palette and a "before the film" palette in the
darkroom arrangement, the ring-around and test strip beside the Enlarger, P9-1. Also: Classic should open a file into
Print rather than Library. Classic is already `DEFAULT_LAYOUT`; nothing was changed.

## 7. Darkroom export speed (spec item 6): measured, not recovered

Metal, 4000 × 2674 (`BENCH=1 REAL_GPU=1`): plain print preview 21.4 ms, export 244.8 ms (12 tiles of 1024);
darkroom print preview 107.3 ms, **export 1650 ms** (48 tiles of 512 with a 64 px halo) — unchanged from P3b. The
planner assumes 20 live textures per pixel for haloed tiles (P3b's measured worst case) and halves the tile. The
recovery (tiles planned from the DAG's real live-texture peak, an export's fields built in one pass, halo renders
reused) is engine work with an out-of-memory risk that must be verified at 4000 px on Metal; not cheap, so recorded.
The export is exact and 1.65 s is acceptable for the persona ("patient for an export").

## 8. Open items

| Item | Owner |
|---|---|
| Default arrangement: the owner's decision (above); design §38's other questions (scene stage, selections, sync default, darkroom row order, medium presets) | owner |
| P9-9 Apply Print Settings source; P9-1 armed mask tools; P9-13 layer multi-select | studio-kit (stack kit, frame commands) |
| P9-5 Finish and scene palettes in Darkroom first; P9-15 layout descriptions; P9-17 | studio-kit layouts |
| P9-12 white balance on the scene stage | contract catalogue + studio-kit (after the owner's answer) |
| P9-3 film edge on the wrong side; P9-16 dense frames' first print | ingest; apps/studio first print |
| P9-11 GPU memory with many open frames, and the stale picture on failure | gpu engine + viewer |
| P9-10 Output module, P9-14 JPEG and size | CHB-011 |
| P9-7 developer text in catalogue docs | contract catalogue |
| Exact export speed (section 7) | gpu engine |
| Remove a kept assistant layout; File ▸ Import Look | apps/studio host |
| The Chromium launch hang under `REAL_GPU=1` (3 times in this phase, never the same test; reruns green) | test infrastructure (watch) |
| P8b's editor validation (a registered form, `covers` naming real arguments); an async command's writes after its first `await` attributed to the user (P6b) | studio-kit / shell |
