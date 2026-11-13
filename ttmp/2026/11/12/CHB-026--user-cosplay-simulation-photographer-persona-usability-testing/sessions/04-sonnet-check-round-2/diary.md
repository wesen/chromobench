---
Title: Session 04 diary: round-2 check
Ticket: CHB-026
DocType: diary
---

# Diary: session 04, Manfred checks round 2 (CPU engine, main aaefe45)

## Step 1: Brief, reading and set-up

I read the protocol, persona, test material, the session-03 findings and the round-2 plan, copied `lib.mjs` and `analyze.py` from session 03 (changing `SES`), and wrote `scripts/nlp.py` to view the Negative Lab Pro TIFFs colour-managed (embedded ProPhoto RGB profile to sRGB, PIL ImageCms). The app on :4650 answered 200.

No source was edited and nothing was committed. `uptime` at the start: load average 3.35.

### Prompt Context
**User prompt (verbatim):** "You are a usability tester. You play a photographer ("Manfred") using the chromobench studio app on his own photos, following a written protocol, and you write a diary and a first-person experience report. This session (session 04) is a SHORT check of the round-2 fixes made after session 03 (findings F24–F37), plus the first impression of his photos and scans: how each one looks when it first opens.

Repository: /home/manuel/code/wesen/chromobench (work here; do NOT edit any source code; do not commit — the orchestrator commits).

(Read-first list: protocol playbook, persona, test material, findings Session 03 and the session-03 report and scripts, and the round-2 plan.)

The app under test: built from main (commit aaefe45: CHB-031 round 2, WS-C and WS-D merged) and served at **http://localhost:4650/** (do not rebuild or restart it). Files are opened with `page.setInputFiles('#file', path)`; a dialog's file chooser with `page.waitForEvent('filechooser')`. The headless browser has no GPU: the CPU engine ("Compatibility mode") is expected. No Mac. Record `uptime` next to timings.

Profile: `profile/fresh/` under your session folder (git-ignored; never put a profile anywhere else). Start empty; delete it only where a step says "fresh".

Steps (as Manfred; screenshot as you go; measure, don't just look):
1. **First impressions of his photos (F31).** Open `.playwright-mcp/photos/` DSC_8559 (daylight truck), DSC_8541 (tungsten interior), DSC_8536 (evening street), DSC_8655 (night, fire truck), DSC_8687 (night, very high ISO). For each: the automatic Time it opened with, the picture's mean luma and B/R, and Manfred's verdict. Is the colour the camera's?
2. **His scans (F28, F30).** Open `.playwright-mcp/scans/` 2025-08-09_raw000.dng, raw004, raw007, raw013 and `.playwright-mcp/photos/raw010.dng`. For each strip: frames found, how many frames open the right way up (compare with the `-positive.tif` NLP files, colour-managed), fix the wrong ones with Frame ▸ Rotate. Then for one frame per strip, side by side with its NLP positive: colour, contrast, crop.
3. **Layouts (F24, F25).** With two photos and a strip frame open, switch View ▸ Layout through every layout: do the frames stay open and rendered? Make an edit, switch layout, press Undo. In Simple: what are the rows called and do they move the picture?
4. **Dialogs and undo (F26, F36).** Reload so a library frame is not open, click it ("Where is …?" appears), then open the same file through File ▸ Open: does the dialog go away by itself? Edit frame A, select frame B, press Undo: what do you see?
5. **Words and zoom (F32, F33, F34, F35, 8iv8).** Make 30+ edits on one frame: is History readable, do rows overlap, does it scroll? Status line words while rendering. View ▸ Actual Pixels (1:1) and the zoom readout. The darkroom layout with no frame selected: one empty-state text?
6. **Regression check (F17).** In Classic on DSC_8559: test strip in seconds, then Time 6.3/10/20 s: does the picture still change?

Output: diary.md, experience-report.md, shots/, scripts/ (numbered s01-…). The experience report ends with "What I would tell the developer", a first-impressions table and a before/after table. (Abridged by the tester for the diary; the full prompt text is the orchestrator's brief.)"
**Assistant interpretation:** Play Manfred, check the round-2 fixes, measure.
**Inferred user intent:** Know which findings are fixed and what is new.
**Commit (code):** none (testing only)

### What I did
- Read the documents; set up `scripts/`.
- Ran `s01a-look.mjs`: empty app, status 'ready: open photos or negatives'.

### Why
- Option B (own Playwright scripts, one step per run, persistent profile `profile/fresh/`).

### What worked
- See the prose above and the report.

### What didn't work
- Empty state fine (`shots/00-empty.png`).

### What I learned
- A shell loop passed two arguments as one string: four runs ended with ENOENT. Fixed by splitting.

### What was tricky to build
- A persistent profile carries recipes between steps (DSC_8559 later had normalised mode and grade 3.0).

### What warrants a second pair of eyes
- Nothing.

### What should be done in the future
- N/A

### Code review instructions
- `scripts/lib.mjs`, `scripts/nlp.py`.

### Technical details
- Application: http://localhost:4650/, main aaefe45, CPU engine.

## Step 2: First impressions of the five NEFs (F31)

I opened DSC_8559, 8541, 8536, 8655, 8687 in one run (`s01b-photos.mjs`), waited 8 s each, took a screenshot and measured the picture area. I also extracted each NEF's embedded full-size JPEG with exiftool, measured it, made side-by-sides, and deleted the JPEGs.

Times 5.61, 5.61, 4.45, 5.0, 5.0 s; luma 104.3, 100.7, 61.4, 62.2, 63.7; B/R 0.635, 0.245, 0.509, 0.429, 0.461. Camera JPEG luma 112.9, 107.7, 55.7, 56.9, 64.8 and B/R 0.879, 0.471, 0.855, 0.549, 0.889. DSC_8687 (EXIF Rotate 90 CW) opens on its side.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Play Manfred, check the round-2 fixes, measure.
**Inferred user intent:** Know which findings are fixed and what is new.
**Commit (code):** none (testing only)

### What I did
- `s01b-photos.mjs` (uptime 2:38, load 3.0): open times 7.7, 5.1, 5.6, 17.4, 5.5 s; worst stall 250 ms.
- Statistics by small Python snippets; montage `shots/02-app-left-camera-jpg-right-*.png`.

### Why
- F31 asks for a first print for photos; the camera's JPEG is the reference for what the camera saw.

### What worked
- See the prose above and the report.

### What didn't work
- Brightness follows the picture; night stays night.

### What I learned
- No failures. DSC_8655 took 17.4 s once (not repeated).

### What was tricky to build
- The navigator and thumbnails are the same rendering, not a camera reference.

### What warrants a second pair of eyes
- Colour: 25 to 48 % warmer (B/R) than the camera JPEG on all five. Orientation ignored for DSC_8687.

### What should be done in the future
- How the as-shot white balance is derived; where orientation is read.

### Code review instructions
- S04-N1 and S04-N2 to the findings list.

### Technical details
- `apps/studio/src/main.ts` (`initial` hook), the raw decoder's orientation.

## Step 3: Scans: frames, orientation, Rotate, NLP comparison (F28, F30)

For raw000, raw004, raw007, raw013 and raw010 I opened the strip, counted frames, clicked each one and measured it (`s02a-strip.mjs`), then used Frame, Rotate Left on sideways frames (`s02b-rotate.mjs`) and compared one frame per strip with its colour-managed NLP positive (`s02c-compare.py`).

Frames 3, 3, 2, 3, 3. Upright on open: raw000 2/3, raw004 1/3, raw007 0/2, raw013 2/3; the sideways ones are the portrait frames. Rotate Left fixed all six I tried (History: 'You Rotated left'). raw000 Times 3.15/5.0/4.45 s.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Play Manfred, check the round-2 fixes, measure.
**Inferred user intent:** Know which findings are fixed and what is new.
**Commit (code):** none (testing only)

### What I did
- `s02a-strip.mjs` x5, `s02b-rotate.mjs` x4, `s02c-compare.py`.
- Decode notes: 'film base read between the frames' (raw000, raw004, raw010), 'on the film edge' (raw007, raw013). First picture 3.6, 6.4, 5.4, 4.5, 5.9 s.

### Why
- F28 and F30.

### What worked
- See the prose above and the report.

### What didn't work
- Frame finding, rotate, decode note.

### What I learned
- My first side-by-side used the wrong NLP frame for raw000 (it is frame 2, not 3). `raw010-positive.tif` matches none of the three frames of `photos/raw010.dng`.

### What was tricky to build
- Portrait frames on a vertical strip open sideways: 7 of 7 sideways frames fit this.

### What warrants a second pair of eyes
- Does the orientation rule key on frame shape?

### What should be done in the future
- S04-N5; F30 numbers (app B/R 1.03 to 1.21 against NLP 0.49 to 0.95).

### Code review instructions
- Strip orientation default (CHB-031 WS-C F28).

### Technical details
- `shots/21-*`, `34-*`, `51-*`.

## Step 4: Layouts, Undo, Simple rows (F24, F25)

Two NEFs and raw013 (5 frames) opened; the eight layouts of the dialog (Classic, Darkroom, Simple, Lab, Tiny, Roll, Finish, Looks) in turn (`s03a-layouts.mjs`). Time 14 in Classic, switch to Darkroom, Edit, Undo (`s03c`). Simple rows tested in real and normalised mode (`s03e`, `s03f`).

Frames stayed open in all layouts, no 'select one to open'; Simple status 'layout: Three steps · 5 frames open'. Undo took Time 14.0 back to 5.61 s ('Undo Time'). Rows: real 'Time (0 st)', Warmth, Tint, Grade; normalised 'Brightness', Warmth, Tint, Grade.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Play Manfred, check the round-2 fixes, measure.
**Inferred user intent:** Know which findings are fixed and what is new.
**Commit (code):** none (testing only)

### What I did
- `s03a`, `s03c`, `s03d`, `s03e`, `s03f`.
- Lighter luma 105.3 to 127.9 (real), 52.2 to 67.9 (normalised); Warmer B/R 0.597 to 0.539; More magenta green share 0.925 to 0.846; Harder luma 63.4 to 61.1.

### Why
- F24, F25.

### What worked
- See the prose above and the report.

### What didn't work
- Both fixed.

### What I learned
- Selectors: layout names also exist as panel buttons (scope to `getByRole('dialog')`); a run starts in the last persisted layout; `settle()` returns -1 in Simple although the picture changed.

### What was tricky to build
- The layout persists across reloads.

### What warrants a second pair of eyes
- Real to Normalised darkens a photo from luma 105 to 52 (S04-N7).

### What should be done in the future
- S04-N7.

### Code review instructions
- Layout switch in `apps/studio/src/main.ts`.

### Technical details
- `shots/42-layouts-sheet.png`, `48-simple-*.png`.

## Step 5: Dialogs and Undo on another frame (F26, F36)

After a reload I clicked DSC_8559: 'Where is DSC_8559.NEF? / The library keeps DSC_8559.NEF and its recipe, but the browser needs the file again to show it. / Remove from library / Not now / Locate DSC_8559.NEF…'. The File menu was not clickable behind the dialog and Ctrl+O gave no chooser, so I fed the `#file` input. The dialog closed by itself after 6.6 s. Then A edited (Time 14), B selected, Ctrl+Z.

Undo selected A, toast 'Undo Time (on DSC_8559.NEF)', Time back on A.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Play Manfred, check the round-2 fixes, measure.
**Inferred user intent:** Know which findings are fixed and what is new.
**Commit (code):** none (testing only)

### What I did
- `s04a-dialogs-undo.mjs`.
- Two earlier attempts timed out waiting for `filechooser`.

### Why
- F26, F36.

### What worked
- See the prose above and the report.

### What didn't work
- Both fixed.

### What I learned
- File menu and Ctrl+O unusable while the modal is open.

### What was tricky to build
- The dialog is modal over the whole window.

### What warrants a second pair of eyes
- A real file handle was not tested (F27).

### What should be done in the future
- S04-N4.

### Code review instructions
- Dialog layer in `apps/studio`.

### Technical details
- `shots/60-where-is.png`, `63-after-undo-other-frame.png`.

## Step 6: History, words, 1:1, darkroom empty state (F32 to F35, 8iv8)

36 edits on DSC_8541; status line sampled every 80 ms; History geometry measured; View menu; Actual Pixels with polling; darkroom layout with no frame.

History 14 rows, 0 overlaps, scrollable (311 px in 260 px). Status 'rendered N · quick preview' while rendering, 'done' after, 'done, full detail' after zoom. 'Actual Pixels (1:1) Ctrl+Alt+0'; 1:1 shows a 640 px stamp at '100 %'. Darkroom without frame: 'Select a photo to print it.' once.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Play Manfred, check the round-2 fixes, measure.
**Inferred user intent:** Know which findings are fixed and what is new.
**Commit (code):** none (testing only)

### What I did
- `s05a-history.mjs` (uptime 3:08), `s05b-zoom-darkroom.mjs` (3:12), `s05c-tooltip.mjs`.
- Rows such as 'You Time 5.61 → 2.23 s (−1⅓ stops)', 'You Rotated right', 'You Aperture f/8 → f/10 (−⅔ stop)', 'You Time 7.0 → 9.5 s (+0.4 stop)'.

### Why
- F32 to F35, 8iv8.

### What worked
- See the prose above and the report.

### What didn't work
- All fixed; runs of edits are merged (36 to 14 rows).

### What I learned
- Click selectors for Lighter and the aperture buttons needed `getByText`/`locator('button')`; my zoom regex missed '100 %'.

### What was tricky to build
- Merging means I could not test 30 distinct rows.

### What warrants a second pair of eyes
- Unit style still mixed; merged Time row sits after later rows.

### What should be done in the future
- S04-N3, S04-N6.

### Code review instructions
- History panel and Actual Pixels in `packages/studio-kit`.

### Technical details
- `shots/70-*`, `71-*`, `72-view-menu.png`, `73-actual-pixels.png`.

## Step 7: Regression F17

Real mode on DSC_8559: test strip labels 6.3, 7.94, 10.0, 12.6, 15.87 s (seconds), then Time 6.3, 10, 20 typed.

Luma 100.0, 55.6, 22.8 (B/R 0.480, 0.454, 0.751): the picture still changes. Strip band luma 81, 56.3, 43.5, 53.1, 36.4 (different columns, not compared with plain pictures).

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Play Manfred, check the round-2 fixes, measure.
**Inferred user intent:** Know which findings are fixed and what is new.
**Commit (code):** none (testing only)

### What I did
- `s06-f17.mjs` (uptime 3:14).

### Why
- F17 must stay fixed.

### What worked
- See the prose above and the report.

### What didn't work
- Still fixed.

### What I learned
- `settle()` -1 again; fixed waits used.

### What was tricky to build
- The recipe carried grade 3.0 and lights −3/+1/+1 from earlier tests.

### What warrants a second pair of eyes
- Band-vs-plain comparison not repeated.

### What should be done in the future
- N/A

### Code review instructions
- N/A

### Technical details
- `shots/80-test-strip.png`, `81-time-*.png`.

## Step 8: Write-up

Contact sheets, side-by-sides and tables built; temporary files and camera JPEGs removed from `shots/`; `experience-report.md` written.

Verdicts: fixed F24, F25, F26, F32, F33, F35, F36, F31 (brightness); partly F28, F34; F17 still fixed. New: S04-N1 to S04-N7.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Play Manfred, check the round-2 fixes, measure.
**Inferred user intent:** Know which findings are fixed and what is new.
**Commit (code):** none (testing only)

### What I did
- Wrote the report and this diary.

### Why
- Hand-back requirements.

### What worked
- See the prose above and the report.

### What didn't work
- All ten findings plus F17 covered.

### What I learned
- Nothing.

### What was tricky to build
- Headless and the 640 px working image limit the 1:1 and focus checks.

### What warrants a second pair of eyes
- Orchestrator: S04-N1 and S04-N2 first.

### What should be done in the future
- Owner: colour aim for photos and strips.

### Code review instructions
- Run the scripts in order from the repository root.

### Technical details
- See `experience-report.md`.

---

**Orchestrator note (2026-11-12):** Step 1 quotes the session brief in abridged form. The tester's prompt,
verbatim, is in [brief.md](brief.md) beside this diary.
