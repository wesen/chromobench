---
Title: Findings (merged across cosplay sessions)
Ticket: CHB-026
Status: active
Topics:
    - ui
    - product
    - ingest
    - testing
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /home/manuel/code/wesen/chromobench/packages/studio-kit/src/bridge/frames.ts
      Note: open() dedupes by hash and resumes the saved log by hash (F2, F3)
    - Path: /home/manuel/code/wesen/chromobench/apps/studio/src/main.ts
      Note: openFiles status line (F2); photo checkbox (F1)
    - Path: /home/manuel/code/wesen/chromobench/apps/studio/src/host/engines.ts
      Note: decode switch on settings.photo (F1, F3); reference engine on the main thread (F4)
    - Path: /home/manuel/code/wesen/chromobench/packages/studio-kit/src/kit/args.ts
      Note: parseEntry typed-value grammar (F8)
ExternalSources: []
Summary: "Every finding from the cosplay sessions, with ID, severity, repro and evidence. The orchestrator merges session findings here."
LastUpdated: 2026-11-12T13:50:00-05:00
WhatFor: "Turning usability findings into tickets."
WhenToUse: "Triage; before fixing anything in ingest, the studio host or the forms."
---

# Findings

Severity: **blocker**, he cannot get a correct result or loses work; **major**, he needs outside help, or the
app freezes or misleads him; **minor**, friction with a workaround; **note**, observation or open question.
"S01" means session 01 ([report](01-experience-report-session-01.md), [diary](../diary/01-diary.md)).
All timings are on the CPU reference engine (no WebGPU in the test browser) unless stated.

| ID | Sev | Summary | Seen in |
|---|---|---|---|
| F1 | blocker | A digital RAW opens as a **negative** by default: the photo comes out inverted | S01 |
| F2 | blocker | Opening a file that is already open does nothing, and the status says "opening …" forever | S01 |
| F3 | blocker | A file's first open mode sticks to its hash for good: re-opened the other way, it is decoded one way and rendered the other (orange negative on the Print tab) | S01 |
| F4 | major | Rendering freezes the whole window: 1.7–2.4 s per preview on the CPU engine; opening freezes it for up to 6.7 s | S01 |
| F5 | major | The library is empty after a reload; only per-file recipes survive (invisibly) | S01 |
| F6 | major | No way to remove a frame or re-open it differently; right-click gives Chrome's image menu | S01 |
| F7 | major | Raw developer errors in toasts (`E_ARG_RANGE: print.enlarger.time_s = 0 …`) | S01 |
| F8 | minor | Typed values: a sign means "relative" with no hint; bad entries stay in the box, and the red border leaks to the next frame; out-of-range is refused, not clamped | S01 |
| F9 | minor | Jargon everywhere: status line, decode notes, tooltips, raw paper ids | S01 |
| F10 | minor | The preview is 512 px wide, upscaled, so it looks out of focus; no 1:1 check | S01 |
| F11 | minor | Chrome clutter: three bars, "Chromobench" ×3, Undo/Redo ×2, "open a negative" empty state | S01 |
| F12 | note | Undo is global across frames (announced by a toast; the menu label doesn't name the frame) | S01 |
| F13 | note | Slider drags make one history entry (good); values land on ⅙-stop steps like 20.16 s | S01 |
| F14 | note | A "Commands" dialog appeared in the UI log without being asked for | S01 |
| F15 | note | A negative opened as a photo gets no "this looks like a negative" hint (and vice versa) | S01 |
| F16 | note | The 3-frame strip shows as one frame; frame finding on a strip untested | S01 |

## Details

### F1 — digital RAW opens as a negative (blocker)
**Repro:** fresh app, "Open files…", pick `DSC_8559.NEF` (daylight). **Result:** inverted, cyan-and-white image
([shot](shots/02-open-nef-no-photo-flag.png)). The fix is a checkbox labelled "photo" in the top bar,
**unticked by default, not remembered across reloads**, and only effective for files opened *after* ticking it
([shot](shots/03-photo-ticked-after.png)).
**Dev:** `apps/studio/src/host/engines.ts:238` picks `decodePhoto` or `decodeScan` by `settings.photo`. Ideas:
classify on open (camera RAW with no orange mask, so a photo; orange-masked or rebate found, so a negative; a
camera *scan* of a negative is also a NEF, so ask when unsure), make the choice per frame, and allow
"Re-interpret as photo/negative" afterwards.

### F2 — re-open is a silent no-op with a stuck status (blocker)
**Repro:** after F1, tick "photo", open the same NEF again. **Result:** nothing changes; the status line shows
"opening DSC_8559.NEF…" for more than 2 minutes ([shot](shots/04-reopened-as-photo.png)); no error in the console.
**Dev:** `packages/studio-kit/src/bridge/frames.ts:69`: `open()` returns the existing frame when the hash
matches. `apps/studio/src/main.ts:254`: the status is only replaced for multi-file opens ("opened N files")
or on error.

### F3 — the open mode is stuck to the file hash (blocker)
**Repro:** open `raw010.dng` with "photo" ticked (by mistake) → orange strip, as expected for a negative shown as a
photo ([shot](shots/08-negative-opened-as-photo-by-mistake.png)). Reload (the only way out, see F6), leave
"photo" unticked, open `raw010.dng` again. **Result:** the status line reports scan conditioning (base 0.12 0.41
0.71 D, rebate found, flare), but the Print tab, navigator and filmstrip still show the **orange negative**
([shot](shots/11-negative-after-10s.png)).
**Dev:** the recipe saved in IndexedDB `logs` under the file's hash is resumed (`frames.ts`, `kv.get('logs', sha)`),
and it says `kind: "digital-raw"`, `source.decode.mode: "photo"`, while this decode ran in scan mode. Decode
mode and recipe kind are never reconciled. The same trap exists the other way round (photo first opened as a
negative). A real user cannot clear it (only `?fresh` or clearing site data). **The negative pipeline itself works:** opened
with `?fresh` the same strip prints correctly (auto first print 2.23 s, lights R +2 / B −3 pt; first render 3.9 s)
([shot](shots/12-negative-fresh-print.png)).

### F4 — the UI freezes while rendering (major, performance)
Measured with the rAF stall probe ([scripts/01-install-probe.js](../scripts/01-install-probe.js)):

| Action | Time to result | Main-thread stalls |
|---|---|---|
| Open NEF as negative (CFA-binned 3016×2016 → 512 px) | ~15 s | screenshots timed out (> 5 s) during the open |
| Open NEF as photo (full 6032×4032 decode → 512 px) | ~7 s | 0.46 s, 0.78 s, 2.9 s |
| Open DNG negative 1672×3695 → 232×512 | 7.8 s | 1.0 s, **6.7 s** |
| Drag Time slider 40 px (20 moves, 30 ms apart) | 12.2 s for the drag itself | six stalls of 1.65–2.43 s (one per preview) |
| Type `15` + Enter in Time | 11.6 s until the page answered | |
| Undo / Redo | each ≲ 4 s | |

**Dev:** LibRaw runs in a worker (`engines.ts:66`), but the reference engine (f64, every pixel) evaluates on the
main thread, as do the DNG decode and scan conditioning. Previews are not cancelled or coalesced while a render
runs (each pointer move of a drag queues work). Directions: move the reference engine and conditioning into a
worker; render the drag at a lower resolution, then refine; drop superseded previews; tile and cache the
negative→print stages so a time or filtration change re-runs only the print stage. Must be re-measured on the
WebGPU engine (Manfred's Chrome) before deciding, but the CPU fallback must not freeze the window either.

### F5 — the library does not survive a reload (major)
**Repro:** open a file, reload `/`. **Result:** "No frames yet", Library counts 0 ([shot](shots/05-after-reload.png)).
Recipes are kept by hash and come back only if he opens the same file again (and then F3 applies).
"photo" and "dust" reset too.

### F6 — no remove / re-open / context menu (major)
Right-click on a filmstrip thumbnail opens **Chrome's** image menu ("Save image as… / Copy image / Inspect"),
which also stays open in the window. The File menu has "Save the Print" and "Find a Command…" only: no Open,
no Remove, no Export (Export is in the top bar). Combined with F2/F3, a wrongly opened frame cannot be fixed.

### F7 — developer errors in toasts (major)
`E_ARG_RANGE: print.enlarger.time_s = 0 is outside the allowed range [0.1, 600] (s).` for typing `0` or `1000`
into Time. The slider itself spans 2–60 s; the contract allows 0.1–600 s. Wanted: "Time must be between
0.1 s and 600 s", and probably clamp-and-say.

### F8 — typed-value surprises (minor)
On Time (15 s): `-5` → 10 s (a leading sign is relative: `parseEntry` in `packages/studio-kit/src/kit/args.ts`,
by design, undocumented in the UI); `abc` and empty stay in the box with only an `is-bad` red border, which is
still there after switching to another frame ([shot](shots/09-right-click-thumbnail.png), Time box); `12s` → 12 s
and `7,5` → 7.5 s work (good, the German comma works).

### F9 — jargon (minor)
Status line: `reference · CPU f64 (no WebGPU: E_EVAL: no GPU adapter) · 512 px`; decode notes for a photo
opened as a negative: `W_NO_OPEN_GATE … W_NO_SURROUND … W_REBATE_BLANK …`; tooltips: "Dichroic filtration as a
shift on the database neutral pack for (paper, film)", "Offsets of paper log exposure per layer … applied
after the negative→paper table"; Paper shows the id `kodak_portra_endura` beside the lowercase label
"kodak portra endura"; film "fujifilm c200".

### F10 — soft preview (minor, performance trade-off)
The working image is 512 px on the long side (512×342 for the NEF), shown at about 890 px wide, so it looks
out of focus. A photographer checks focus first. Needs zoom-to-1:1 with tiles at full resolution
(ties into F4: tiling and caching).

### F11 — chrome clutter (minor)
Three rows above the image (top bar, menu bar, module bar), the name three times, Undo/Redo both as buttons and
in Edit. The empty grid says "No frames yet: open a negative" although he has digital photos.

### F12–F16 (notes)
- **F12** Ctrl+Z with raw010 selected undid the Time change on DSC_8559; toast "Undo Time (on DSC_8559.NEF)".
  Lightroom also has one undo stack; but the Edit menu says just "Undo Time".
- **F13** One drag, one history entry "Time 10.0 → 20.16 s (+1.01 st)": good. Darkroom printers think in ⅓
  stops or round seconds.
- **F14** `{kind: 'dialog', text: 'Commands'}` appears first in the UI log of session 01; I did not open it
  knowingly. Possibly a key typed into a field reached the global shortcut handler. Needs a repro.
- **F15** No hint when the content contradicts the chosen mode (orange mask in "photo" mode; no mask or rebate
  in "negative" mode, where the W_ notes show it, but only as jargon).
- **F16** `raw010.dng` holds three frames; the app shows and prints the strip as one image, rebate and gaps
  included ([shot](shots/12-negative-fresh-print.png)). The auto time (2.23 s) sits at the slider's 2 s floor.
