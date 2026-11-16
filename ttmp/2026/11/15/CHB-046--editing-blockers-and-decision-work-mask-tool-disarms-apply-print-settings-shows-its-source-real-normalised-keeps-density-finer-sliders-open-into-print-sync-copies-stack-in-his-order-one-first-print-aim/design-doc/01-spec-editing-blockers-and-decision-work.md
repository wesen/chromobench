---
Title: 'Spec: editing blockers and decision work'
Ticket: CHB-046
Status: active
Topics:
    - studio
    - ux
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://packages/studio-kit/src/model/aim.ts
      Note: D8 aim
ExternalSources: []
Summary: 'Phase 1 of the CHB-044 roadmap: the editing blockers of the P9 persona session (P9-1, P9-9, F44, P9-6) and the work decisions D1, D4, D5, D8 create.'
LastUpdated: 2026-11-15T18:55:05.017992-05:00
WhatFor: ""
WhenToUse: ""
---


# Spec: editing blockers and decision work

Phase 1 of the roadmap in CHB-044 (`reference/01-consolidated-backlog.md`, "Roadmap"): the editing blockers the CHB-037
P9 persona session found, and the work the owner's delegated decisions (CHB-044 `reference/03-decisions-d1-d13.md`)
create. The GPU correctness items of Phase 1 (GPUC-1…4, LAY-3/D7) are CHB-045, in a sibling worktree.

## Items, what each means here, and how it is checked

| # | Source | Behaviour after CHB-046 | Where | Evidence |
|---|---|---|---|---|
| MASK-1 | CHB-037 P9-1 (t:hqwh) | A mask tool makes **one** mask and goes back to no tool. The linear and radial tools need a drag of at least 4 screen px (`MIN_DRAG_PX`): a click does nothing and the tool stays for the drag. The luminance tool and a new colour range disarm after their one click. The brush paints the layer it was armed for (`stack.mask.armedFor`); a stroke after another layer or frame was selected disarms it and paints nothing. | `kits/stack/src/commands.ts` (`maskTools`, `disarm`, `isDrag`), `kits/stack/src/state.ts` | e2e `studio-editing-blockers.spec.ts` "D1 and P9-1" |
| DARK-2 | CHB-037 P9-9 (t:crj2) | Frame ▸ **Apply Print Settings to Selection…** asks in the page (`rt.chrome.dialog`, not a browser dialog): the frame it copies from (the selection's primary, "the frame shown, outlined in the film strip"), each setting it copies with the source's value in his units and which frames it changes (`settingsPlan`), Cancel / "Apply to N frames". One undo step. `{ ask: false }` copies at once (an agent, a script). The primary cell in the strip and grid has an accent outline. | `src/commands/print.ts`, `src/model/settings.ts`, `src/dom/studio-kit.css` | vitest `editing-blockers.test.ts`, e2e "P9-9" |
| DARK-3 | CHB-028 F44 (t:8nfh) | Switching Real ↔ Normalised (the mode select, or `print.enlargerMode`) keeps the print: the mode's shift `offset(real) − offset(normalised) = κ(calibration pack) − κ(current pack) + optics` goes into the printer lights (real → normalised) and comes back out (normalised → real); there and back is no change. The host injects core's `modeShiftLogH` as `services.darkroomMath`; without it (mock engine, dev host) the optics alone carry it (exact at the neutral pack). Lights stop at ±1.5 log H: on the way to real mode the rest goes into the time; on the way to normalised the loss is said in a toast. | `core/src/print/enlarger-mode.ts`, `src/model/enlarger-mode.ts`, `src/commands/print.ts`, `src/dom/arg.ts`, `apps/studio/src/host/engines.ts` | vitest `apps/studio/test/enlarger-mode.test.ts` (RefEngine, pixels), e2e "F44" (GPU, 9×9 grid) |
| DARK-5 | CHB-037 P9-6 (t:eo25), CHB-028 F37 (t:czh4) | A drag on a darkroom track moves the value **relative to where it started** by a feel per control kind (`feelOf`): Time 1/120 stop per px (60 px = ½ stop; it was 2), filtration 0.25 CC per px (40 px = 10 CC; it was 43), printer lights 0.1 pt per px, anything else its usual range over 300 px. **Alt** makes a drag ten times finer (the shell's convention: Shift ×10, Alt ×0.1). A click without a drag still puts the thumb where it was clicked. Arrow keys: Time ⅓ stop (Shift 1, Alt ⅙), filtration 5 CC (Shift 20, Alt 1), lights 1 pt (Shift 4, Alt ½). | `src/kit/args.ts` (`feelOf`, `dragTo`, `keyStepOf`), `src/dom/arg.ts` | vitest `control-feel.test.ts`, e2e "P9-6" |
| NEW-1 | D1 | Classic stays the default (`DEFAULT_LAYOUT`). An opened file is shown in Print; a layout switch with frames open goes to Print when the layout would start on its first module (Classic's Library). | `apps/studio/src/main.ts` (`intoPrint`) | e2e "D1 and P9-1" |
| NEW-2 | D4 | Settings ▸ **Sync Settings to Selection…** (Mod+Shift+S) asks in the page: "Sync copies the values of … onto …", what is copied, and a choice **Copy values** (default, always) / **Link** (one shared preset; a later change reaches all frames). No model change. The Settings menu's "Sync Mode" toggle is gone; the Looks layout's panel keeps its explicit radio and runs sync with it. Auto Sync does not exist in chromobench, so there is nothing to label. | `kits/looks/src/commands.ts` (`askSync`, `syncBody`), `kits/looks/src/dom.ts`, `kits/looks/src/kit.ts` | vitest `looks/kit.test.ts` "D4", walkthrough e2e |
| NEW-3 | D5 | The Enlarger lists the darkroom **in his order** (the stack's order: the order he made the layers in, or dragged them to), each darkroom row with a kind badge (Burn, Dodge, Flash, Density mask, …; hidden when the name already says it), a one-line summary by kind ("Main exposure · Burn ×2 · Dodge · Printer lights · Density mask") and a **By kind** view (`stack.byKind`, view state `stack.darkroomOrder`). The print does not depend on the order. | `kits/stack/src/{model,dom,kit,commands,state}.ts`, `stack.css` | core vitest `darkroom-order.test.ts` (reversed, rotated, by kind, moved, grouped: ≤ 1e-12), vitest `editing-blockers.test.ts`, e2e "D5" (GPU pixels) |
| SCAN-5 | D8, CHB-028 t:5wjl | One first-print aim for the Roll module and the studio: **neutralise 75 %** (`NEUTRALISE`), one function both call (`firstPrintLights`), the amount in his preferences (`prefs.neutralise`, percent) as a **Neutralise** slider in a "First print" panel (Classic's Print module, the Roll module). The studio's automatic first print of a negative reads it; **First Print Again** (`print.firstPrint`, host capability) prints the current negative anew with it; the Roll module's first print re-derives each frame's lights from its LATD with the amount now (`withNeutralise`, no new measurement). A photo keeps the camera's colour (alpha 0). The roll's `ALPHA` constant is gone. | `src/model/aim.ts`, `kits/roll/src/{kit.ts,engine/analyse.ts,engine/lower.ts}`, `apps/studio/src/host/first-print.ts`, `apps/studio/src/main.ts`, `src/cb.ts` | vitest host/first-print-aim/roll engine tests; numbers in the diary |

## Decisions taken here (not in the decisions document)

- **The brush is not disarmed after every stroke.** "Disarm after one mask" read literally would make a brush mask
  one dab long. The brush keeps painting the layer it was armed for and disarms when another layer is selected, which
  removes the session's hazard (a later click going to whichever layer is selected) without breaking painting.
- **The fine-drag modifier is Alt**, because the shell's scrub and nudge already use Shift ×10 and Alt ×0.1.
- **A kind badge is hidden when the row's name is the kind** ("Burn" with a "Burn" badge reads twice); a renamed
  layer ("Sky") shows its badge.
- **Mode switch round trip is exact**: the lights carry the shift both ways; the time is touched only when the lights
  hit their ±1.5 log H limit on the way back to real mode.
- **A flash with its own filtration** is a term whose κ differs between the modes in another way than the main
  exposure's; the shift is computed for the main exposure (the dominant term) and is exact for every term when the
  terms share the main pack.

## Out of scope / open

- Auto Sync (Lightroom's held toggle) does not exist; D4 only asks to label it if it existed.
- The Darkroom-first layout has no "First print" panel yet (its palettes are DARK-1, Phase 2).
- The stack kit's own number tracks (`.cb-stack-num`, amounts and mask settings) keep the native absolute track.
