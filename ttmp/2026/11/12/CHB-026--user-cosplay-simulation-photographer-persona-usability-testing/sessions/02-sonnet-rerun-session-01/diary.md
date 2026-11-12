---
Title: Diary, cosplay session 02 (re-run of session 01, Sonnet)
Ticket: CHB-026
Status: active
DocType: diary
Summary: "Re-run of session 01 against main 3703d0a (port 4650, CPU engine): 16 findings checked one by one."
---

# Diary: session 02, re-run of session 01

App: `http://localhost:4650/` (main `3703d0a`), headless Chromium 1440x900 via Playwright (own scripts, `scripts/`), CPU engine ("Compatibility mode"), persistent profile (deleted at the end: it held thumbnails of the private photos). All timings are CPU-engine, headless.

## Step 1: Brief, setup, and the empty app

I read the protocol, persona, test material, session 01 report and findings, then built a small helper library (`scripts/lib.mjs`: persistent profile, the toast/stall probe injected with `addInitScript`, screenshot and polling helpers). The first run was a fresh profile on an empty page and the File menu. The top bar is gone; the empty state now says what to do.

### Prompt Context
**User prompt (verbatim):** "You are a usability tester. You play a photographer ("Manfred") using the chromobench studio app on his own photos, following a written protocol, and you write a diary and a first-person experience report. This session is a RE-RUN of an earlier session (session 01) to check, finding by finding, whether 16 problems found there are now fixed.

Repository: /home/manuel/code/wesen/chromobench (work here; do NOT edit any source code; do not commit — the orchestrator commits).

Read these first, in this order (all under `ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/`):
1. `playbooks/01-cosplay-session-protocol.md` — the protocol. Follow it. Use driving option **B** (your own Node Playwright scripts, headless Chromium, one step per run, persistent profile). Import from `@playwright/test` (NOT `playwright`). Do not use any MCP browser tools.
2. `reference/01-persona-manfred.md` — who you are.
3. `reference/02-test-material.md` — the files (private family photos: read-only, never copy into the repo, never send anywhere).
4. `various/01-experience-report-session-01.md` — what happened in session 01 (your script of steps to repeat).
5. `various/02-findings.md` — findings F1–F16 with their repro steps.
6. `scripts/01-install-probe.js` and `scripts/02-read-probe.js` — the probe (paste its function into your scripts via `page.addInitScript`); it records toasts (they vanish after 2.6 s), main-thread stalls (rAF gaps > 100 ms) and status changes. `window.chromobench.rt.chrome.log` holds every toast/dialog.

The app under test: already built from main (commit 3703d0a) and served at **http://localhost:4650/** (do not rebuild or restart it). Important changes since session 01 you will meet: there is no top bar any more — opening is File ▸ Open Files… (Ctrl+O) / Open As ▸ (Guess / Photos / Negatives), export is File ▸ Export…; files you open can also be set via the hidden input `#file` with `page.setInputFiles('#file', path)` (that is how you open files from a script — it is what "Open Files…" feeds); the status line has a Photo/Negative pill; a library survives reloads. Treat these as a first-time user would: find them through the menus and the screen.

Engines: your local headless browser has no GPU, so the app runs on its CPU engine (status says "Compatibility mode"). That is fine and is the main thing to measure. OPTIONAL, only at the end and only if time allows: one GPU run on the owner's Mac per `ttmp/2026/11/12/CHB-027--fix-cosplay-session-01-findings-open-mode-responsiveness-library-wording-strips/scripts/mac-README.md` (take the lock, release it after; use `http://localhost:4650/` there too).

Steps (repeat session 01, as Manfred, mistakes included):
1. Fresh profile, open `DSC_8559.NEF` (copy it to `.playwright-mcp/photos/` first, as the test-material doc says; the NEFs are in `~/Downloads/2026-11-11 - manfred test bilder/`). Does it open as a photo without you doing anything? (F1)
2. Open the same file again (F2). Then try to re-open it the other way (as a negative) and back (F3, F6, F15).
3. Reload the page: is the library still there? Click the thumbnail (F5). (A "Where is …?" dialog is expected in a headless browser without file handles — note it, don't count it as a failure.)
4. Drag the Time slider 20 small mouse moves; measure time to the final picture and stalls (F4). Type into the Time box: `15`, `0`, `-5`, `abc`, `1000`, `12s`, `7,5`, empty — read the toasts from the UI log (F7, F8, F13). Undo/redo (F12).
5. Open `~/Downloads/raw010.dng` (a real colour-negative strip of 3 frames): does it open as a negative, as three frames, each a sensible positive print? (F16, F1). Then make the session-01 mistake: open it with Open As ▸ Photos, and check it can be put right without reloading tricks (F3).
6. Look for jargon in the status line, tooltips and paper/film names (F9); check the preview sharpness question (F10, expected still 512 px on the CPU engine); the empty-state text and chrome (F11).

Output (follow the protocol's section 3): create `ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/sessions/02-sonnet-rerun-session-01/` with `diary.md` (the diary skill's investigation format — read /home/manuel/.claude/skills/diary/SKILL.md and /home/manuel/.claude/skills/diary/references/investigation-entry.md; numbered steps, each with 1–2 prose paragraphs then all sections; Step 1 quotes this prompt verbatim), `experience-report.md` (first person as Manfred, plain words, screenshots embedded, "Developer commentary" callouts with measurements and code pointers where you have them), `shots/` (screenshots of the app — these show private photos, so they stay in this ticket folder which is not published; never put them anywhere else), and your scripts in `scripts/`.

The experience report must end with: "What I would tell the developer" (3–7 items) and a **before/after table**: one row per finding F1–F16 with columns: finding, session 01 (before), now (after), verdict (fixed / partly / not fixed / new problem), evidence (screenshot, toast text, timing). Add any NEW findings as `S02-N` rows with severity. Be honest: if something is still broken or confusing, say so plainly — that is the point.

Final reply (short): session folder; verdict counts; the top new problems; worst stall; anything you could not test and why."
**Assistant interpretation:** Re-run session 01 as Manfred on the fixed build, verify F1-F16, find new problems.
**Inferred user intent:** An evidence-based before/after check of the CHB-027 fixes.
**Commit (code):** none (no commits by the tester).

### What I did
- Copied `DSC_8559.NEF` and `raw010.dng` into `.playwright-mcp/photos/` (git-ignored).
- `scripts/s01-empty.mjs`: fresh profile, screenshot, body text, File menu.

### Why
Baseline for F11 (clutter, empty state) and to learn how to open files (menus, hidden `#file` input).

### What worked
- One bar of menus plus one bar of tabs, "Chromobench" once. Empty text: "No photos yet: File ▸ Open Files… (Ctrl+O), or drop them here". Status: "ready: open photos or negatives (File ▸ Open Files…, Ctrl+O, or drop them here)".
- File menu: Open Files…, Open Folder…, Open As ▸, Export… (greyed until a frame exists), Save Recipe, Find a Command…. See `shots/01-empty.png`, `shots/02-file-menu.png`.

### What didn't work
- `page.waitForEvent('filechooser')` never fires after File ▸ Open Files… in headless Chromium (the app evidently uses the File System Access picker). I therefore open files with `setInputFiles('#file', …)` everywhere, as the brief allows. Three `No available adapters.` console warnings (WebGPU) on every load.

### What I learned
`Open As ▸` is a *mode* (checked item) that applies to the next open, not a command that opens.

### What was tricky to build
Scripts must not carry state in memory between runs: the persistent profile (library, Open As mode, recipes) changes what the next run sees. I hit this several times (see Steps 3 and 4).

### What warrants a second pair of eyes
Whether the "Open Files…" click really works in a real Chrome (cannot be tested headless).

### What should be done in the future
N/A

### Code review instructions
Read `scripts/lib.mjs`. Run any `scripts/sNN-*.mjs` from the repo root with `node`.

### Technical details
Probe = `01-install-probe.js` function, injected by `ctx.addInitScript`. Viewport 1440x900.

## Step 2: First open of the NEF (F1)

I opened `DSC_8559.NEF` with nothing ticked and no menu choices. It came out as a positive photo (red delivery truck, blue sky), status pill "Photo", "Nikon D750 photo, 24 MP". On the very first open in a fresh profile it took 17 s until "opened" and about 29 s until "rendered 1"; main-thread stalls were at most 200 ms.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Check F1 (RAW opens inverted).
**Inferred user intent:** Does Manfred get a correct print without knowing about modes.
**Commit (code):** none

### What I did
- `scripts/s02-open-nef.mjs`: fresh profile, `setInputFiles('#file', DSC_8559.NEF)`, poll status every second, screenshot `shots/03-nef-opened.png`.

### Why
F1 was a blocker; the first impression matters most.

### What worked
- Correct positive, no decisions needed. Status timeline: "opening DSC_8559.NEF…" 1.5 s; "opened DSC_8559.NEF" at 17.6 s; "rendered 1 · screen" at ~29 s.
- Stalls (rAF gaps): 150, 117, 133 and 200 ms. Session 01 had 0.46, 0.78 and 2.9 s. Decode is now off the main thread.

### What didn't work
- 29 s to the first picture on a cold profile, with no progress indication beyond "opening…" (later runs: 6-10 s to the picture; the first run also installs the offline cache, status "caching…").
- The picture is dark and soft ("muddy"): see F10.

### What I learned
The pill and the "Nikon D750 photo" text show what the app decided.

### What was tricky to build
Deciding when a render is "final": the status counter "rendered N · screen" (draft renders say "· draft").

### What warrants a second pair of eyes
Cold-start 29 s vs warm 6-10 s; whether the service-worker caching competes with the decode.

### What should be done in the future
A progress bar or percentage during RAW decode.

### Code review instructions
Compare `shots/03-nef-opened.png` with session 01 `various/shots/02-open-nef-no-photo-flag.png`.

### Technical details
Probe status entries: [2185,"opening…"], [18548,"opened…"], [30567,"rendered 1 · screen"].

## Step 3: Same file again, relaunch, library, thumbnail (F2, F5)

I relaunched the browser (a stricter version of a reload) and the library still held the truck: thumbnail marked "not open", status "ready: 1 frame in the library; select one to open its file again". Clicking the thumbnail gave a dialog "Where is DSC_8559.NEF? The library keeps DSC_8559.NEF and its recipe, but the browser needs the file again to show it." with Remove from library / Not now / Locate DSC_8559.NEF…. In headless, Locate opens no chooser (expected, noted). Opening the same file again while it is open toasts "DSC_8559.NEF is already open (as a photo)".

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Check F2 (re-open silent no-op), F5 (library lost on reload).
**Inferred user intent:** No dead ends; keep my pictures.
**Commit (code):** none

### What I did
- `s03-reopen.mjs`, `s04-locate-reopen.mjs`, later a real `page.reload()` in `s08`.
- Screenshots `04-relaunch-library`, `04b-click-thumb`, `05-relinked`, `06-reopen-same`, `12-after-reload`, `13-thumb-click-dialog`.

### Why
Both were blockers or majors in session 01.

### What worked
- F2: status "DSC_8559.NEF was already open" and toast "DSC_8559.NEF is already open (as a photo)" (UI log), no hang.
- F5: library survives both a relaunch and `page.reload()`. Recipe too: after relink the History still held my earlier Time edits.

### What didn't work
- My first script tried `waitForEvent('filechooser')` and timed out (see Step 1). The relinked picture needs the file again each session (Locate), by design without file handles.
- The right panel of an unselected, not-open frame shows odd strings (`15, 12s, +1`, `40, +5`, `+2, −1`) and live-looking sliders: see S02-N3.

### What I learned
The whole library is persistent now; only pixels need the file.

### What was tricky to build
Headless has no persisted file handles, so I cannot judge the "Locate…" path or whether real Chrome reopens silently.

### What warrants a second pair of eyes
`Locate` with a real handle (Mac run, not done).

### What should be done in the future
Disable or hide the odd placeholder strings when no frame is selected.

### Code review instructions
Check the dialog code path for "Where is …?" and the toast "is already open".

### Technical details
UI log: `{"kind":"dialog","text":"Where is DSC_8559.NEF?"}`; toast text above.

## Step 4: Open it as a negative, and back (F3, F6, F15)

With the NEF open as a photo I chose File ▸ Open As ▸ Open as Negatives, then opened the same file. A dialog "DSC_8559.NEF is open as a photo. Re-open it as a negative? What you did to it as a photo is kept: re-opening it as a photo brings it back." appeared (Keep it as a photo / Re-open as a negative). I accepted: inverted, cyan-and-white truck, status pill "Negative" and a new pill "Looks like a photo: re-open as photo?" with the note "Colour negative (Nikon D750 RAW), 6.1 MP, no film edge found, it may be a photo, not a negative". Clicking that pill toasted "Re-opening DSC_8559.NEF as a photo…" and then "DSC_8559.NEF is open as a photo now (its saved recipe as a photo)", about 6 s later. Frame ▸ Re-open as Photo / Re-open as Negative / Remove from Library also exist, and right-click on a thumbnail gives an app menu.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Check F3 (mode sticks to the hash), F6 (no way to fix/remove), F15 (no hint).
**Inferred user intent:** A wrong choice can always be put right.
**Commit (code):** none

### What I did
- `s05`, `s06`, `s06b`, `s06c`, `s07`, `s07b`, `s18`. Screenshots `08-reopen-as-negative` (dialog), `09-nef-as-negative`, `09b-open-as-menu-state`, `11-after-pill-click`, `24-frame-menu`, `31-right-click-thumb`, `32-after-remove-click`.

### Why
This was the worst trap of session 01 (orange negative that could not be repaired).

### What worked
- Round trip photo to negative to photo without reloads or clearing site data. Each way: dialog with a plain explanation, hint pill, Frame menu entries. Re-open as negative: 6.6 s; as photo via pill: ~6 s; stalls 0.
- Remove from Library toasts "Removed DSC_8559.NEF: open the file again to get it back, with its recipe".
- Picture recovered correctly each time (shots 03 and 09 differ as expected).

### What didn't work
- The Open As mode is **sticky across relaunches** and is applied silently when a "not open" frame is relinked: after one run left it on "Open as Negatives", the next run's plain re-open came out inverted until I used the pill (`shots/09a`, `09b`). The menu shows a check mark, but Manfred will not look. (S02-N2.)
- Several of my scripts failed because of this state (they expected a dialog that was not shown), which is itself the finding.
- The context menu for a not-open frame includes a disabled "Open a frame first" item (odd wording).

### What I learned
The hint pill is the best new thing: it works both ways (also "Looks like a negative: re-open as negative?" for the strip, Step 8).

### What was tricky to build
Detecting "done": the status line keeps the previous "rendered N" text while a re-open runs.

### What warrants a second pair of eyes
The sticky mode; whether a pill click without a file handle (non-Chromium) works.

### What should be done in the future
Reset Open As to Guess after each open, or show the active mode in the status line.

### Code review instructions
Search for the Open As setting persistence (settings store) and the relink path using it.

### Technical details
Toasts verbatim above; stalls: none in this step.

## Step 5: Slider drag, undo and redo (F4, F12, F13)

I put the pointer on the Time slider thumb and made 20 mouse moves of 2 px, 30 ms apart. The drag itself took 1.06 s. The status showed "rendered 2 · draft" after 340 ms and "rendered 3 · draft" at 697 ms, the final "rendered 4 · screen" at 3.95 s after the drag began (about 2.9 s after release). The probe recorded **no stalls above 100 ms**. The value is a round "20.0 s" (+1 st), one history entry. Undo/Redo via Ctrl+Z / Ctrl+Shift+Z are instant and the Edit menu says "Undo Time" / "Redo Time".

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Re-measure F4, F13, F12.
**Inferred user intent:** The window must not freeze while he drags.
**Commit (code):** none

### What I did
- `s08-reload-and-drag.mjs`, `s11-undo.mjs`, `s13-strip-frames.mjs` (undo on another frame). Screenshots `14-after-slider-drag`, `18-edit-menu-*`, `19-after-redo`, `23-undo-menu-other-frame`.

### Why
F4 was the largest usability problem (12 s for a drag in session 01).

### What worked
- Drag: draft first at 0.34 s, no freeze, final 2.9 s after release (CPU).
- F13: 20.0 s, not 20.16 s. F12: with the strip's frame 1 selected, Ctrl+Z toasts "Undo Time (on raw010.dng · 3/3)", naming the frame.

### What didn't work
- The Edit menu label is still just "Undo Time" (no frame name).
- Final picture after release still takes about 3 s on CPU.

### What I learned
Time on the slider is logarithmic (value is log2 seconds: 4.33 = 20 s).

### What was tricky to build
Slider pixel math: the slider spans 1-5.9 stops; I computed the thumb x from `min/max/value`.

### What warrants a second pair of eyes
The 3 s refine on CPU; fine on GPU? (not tested).

### What should be done in the future
Name the frame in the Edit menu label.

### Code review instructions
`scripts/s08-reload-and-drag.mjs` lines around the mouse loop.

### Technical details
Probe: status `[340,"rendered 2 · draft"],[697,"rendered 3 · draft"],[3947,"rendered 4 · screen"]`, stalls `[]`.

## Step 6: Typing into the Time box (F7, F8)

I typed 15, 0, -5, abc, 1000, 12s, 7,5 and an empty box, pressing Enter after each. The toasts are now plain: 0 gives "Time can't go below 0.1 s: set to 0.1 s"; 1000 gives "Time can be at most 600 s: set to 600 s"; `abc` gives "Time: “abc” is not a value. Type a time: 15, 12s or 7,5. A sign changes it: +1/3 st, −2 (seconds)"; empty gives "Time: the box is empty. Type a time: 15, 12s or 7,5. A sign changes it: +1/3 st, −2 (seconds)". 12s and 7,5 work; no toast for good values.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Re-test F7 (raw errors) and F8 (typed-value surprises).
**Inferred user intent:** Typos must not feel like errors of the program.
**Commit (code):** none

### What I did
- `s09-typed-values.mjs`; shots `15-typed-*.png`, `16-after-typing.png`.

### Why
Manfred types `7,5` and nonsense.

### What worked
- No `E_ARG_RANGE` anywhere. Out-of-range values are clamped and announced. After clicking away the bad box reverted to the last good value (7.5 s) and lost its red `is-bad` class.
- The tooltip on the box explains: "Type a time: 15, 12s or 7,5. A sign changes it: +1/3 st, −2 (seconds)".

### What didn't work
- `-5` is still relative: after `0` the value was 0.1, so `-5` gave "Time can't go below 0.1 s: set to 0.1 s". Documented now in the tooltip and the toast, but a surprise on first try.
- While the box has focus with `abc` it stays red with the bad text (reverts on blur). I did not re-test the old "red border leaks to the next frame" case with a frame switch while red.
- One stall of 517 ms when 1000 was entered (600 s render).

### What I learned
Typed values go through the same "A sign changes it" grammar for all number boxes.

### What was tricky to build
Toasts last 2.6 s; the probe catches them, reading the UI log by hand would miss some.

### What warrants a second pair of eyes
Why the picture does not change at all with these values: Step 7.

### What should be done in the future
Offer "−5" as a typed literal only with an explicit "−" glyph? Or ask.

### Code review instructions
`packages/studio-kit/src/kit/args.ts` `parseEntry` and its toast strings.

### Technical details
Raw measurements in `scripts/s09-typed-values.mjs` output (see the Step 6 paragraph and the report).

## Step 7: The Time control does nothing to a photo (new, S02-N1)

While typing I noticed the picture never changed. I measured the mean grey level of the picture area from screenshots: 56.68 at 10 s, 20 s, 0.1 s, 600 s and 30 s. Clicking "Lighter" three times raised it 56.68, 60.97, 65.52, 70.31. So printer lights work on a photo, Time does not. In session 01 I had written that the picture became "lighter" after the drag; that was probably imagined.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Not in the brief: a new problem found while checking F7/F8.
**Inferred user intent:** Honest report.
**Commit (code):** none

### What I did
- `s10-does-time-matter.mjs`: type 0.1, 600, 10 in Time; click Lighter x3; screenshot clip means via PIL.

### Why
A control that does not respond looks broken.

### What worked
Lighter/Darker.

### What didn't work
Time (history shows "Time 0.1 → 600.0 s (+12.55 st)", picture unchanged). Aperture and filtration were not tested.

### What I learned
For a digital photo the print is probably auto-normalised, so exposure time cancels out; the UI does not say so.

### What was tricky to build
Proving "no change": I used pixel means of the same crop, equal to two decimals.

### What warrants a second pair of eyes
Whether it is by design (scene-referred photo normalised at print) and if so the Darkroom panel should say "not used for photos" or map Time to an exposure offset.

### What should be done in the future
Make Time meaningful for photos or grey it out with a tooltip.

### Code review instructions
Look for how `print.enlarger.time_s` enters the photo ("digital-raw") pipeline.

### Technical details
Means: 56.68 / 56.68 / 56.68 / 56.68; after Lighter x3 60.97 / 65.52 / 70.31.

## Step 8: The 3-frame strip, and the session-01 mistake (F16, F1, F3, F15)

Opening `raw010.dng` in Guess mode took 2.6 s to the first picture, with no stall: the status says "Colour negative (DNG), 6.2 MP, film edge found", "opened raw010.dng (3 frames)", and the filmstrip shows `raw010.dng · 1/3`, `2/3`, `3/3`. Each is a positive print with its own auto time (2.23 s, 2.5 s, 2.81 s). I then did the mistake: Open As ▸ Open as Photos and opened the strip again: orange strip as a photo, pill "Looks like a negative: re-open as negative?", note "DNG photo, 6.2 MP". Clicking the pill fixed it in 1.6 s with toast "raw010.dng is open as a negative now (its saved recipe as a negative)", and the stray whole-strip frame was replaced by the 3 frames.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Check F16 and the negative open/repair path.
**Inferred user intent:** The strip must be usable without tricks.
**Commit (code):** none

### What I did
- `s12`, `s13`, `s14`, `s15`; shots `20-dng-opened`, `22-strip-frame-2/3`, `25-strip-opened-as-photos`, `27-after-fix-pill`.

### Why
This was the file where session 01 got stuck for good.

### What worked
- Three frames, negative inverted correctly, no stall, 2.6 s (session 01: 7.8 s with a 6.7 s stall).
- The repair path works.

### What didn't work
- The prints are small and blocky (big square pixels, see `shots/22-strip-frame-3.png`) and show **sideways** (the sign and the graffiti are rotated 90°); frame 1 is hazy and bluish. No rotate control in the Frame menu. (S02-N4.)
- After the repair a "Where is raw010.dng?" dialog opened by itself (nagging, headless-related but also after Remove, S02-N5).

### What I learned
A strip is one file with three library entries; "not open" applies to each of them.

### What was tricky to build
Selecting the right thumbnail text (`raw010.dng · 3/3` vs the whole-strip `raw010.dng`).

### What warrants a second pair of eyes
The haze/blue cast of frame 1 and whether sideways is expected for a vertical scan.

### What should be done in the future
Auto-rotate frames (or a rotate button), and render the print at a size where blocks are not visible.

### Code review instructions
Frame splitting in `decode.ts`, per-frame orientation.

### Technical details
Probe status `[110,"opening raw010.dng…"],[1933,"opened raw010.dng (3 frames)"],[2269,"rendered 1 · screen"]`, stalls `[]`.

## Step 9: Jargon, sharpness, clutter (F9, F10, F11)

I read every tooltip, the select options and the status. Papers and films are real names now (no `kodak_portra_endura`), tooltips are darkroom language ("Exposure time under the enlarger. Longer prints darker; ⅓ stop is about 26 % more time."). Remaining jargon: the engine tooltip "reference · CPU f64 (worker) (no WebGPU: E_EVAL: no GPU adapter) · 512 px", the decode tooltip "via LibRaw … camera matrix from adobe · working image 512×342", pill "Compatibility mode: slower (no WebGPU)", tab names "Dyes" and "Base & gamut", and Film stock / Scanner / Viewing light for a digital photo. Sharpness: the working image is 512×342 (tooltip); the canvas is 904×645, and Ctrl+= x3 gives big blocks (`shots/30-zoomed-in.png`); the status cycles "rendered N · refine" every 5 s.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Check F9, F10, F11, F14.
**Inferred user intent:** Words and pictures a photographer can trust.
**Commit (code):** none

### What I did
- `s16-jargon-sharp.mjs`, `s17-zoom.mjs`; shots `28-view-menu`, `29-after-dblclick-image`, `30-zoomed-in`.

### Why
Residual minor findings.

### What worked
- F9 mostly fixed (see above); F11: one menu bar, one tab bar, one "Chromobench", Undo/Redo only in Edit, honest empty state.
- F14: no unexplained "Commands" dialog in any run.

### What didn't work
- F10 unchanged: still 512 px and upscaled; no 1:1 view (View has Fit in Window, Zoom In/Out only).
- A tab bar (Library, Roll, Print, Finish, Assistant, Output) and a menu bar with Roll and Finish menus repeat names.

### What I learned
The zoom works but only magnifies the 512 px image.

### What was tricky to build
Collecting tooltips: they are `title` attributes, so I dumped them by script (a real user would hover one at a time).

### What warrants a second pair of eyes
Whether full-resolution tiles come with the GPU engine (not tested).

### What should be done in the future
Hide film-negative controls for photos; remove `E_EVAL` from any visible text.

### Code review instructions
Grep `E_EVAL` in the studio shell; tooltip strings for the engine pill.

### Technical details
Canvas elements: [240x160 navigator, 904x645 main at 1:1 CSS px]; "working image 512×342".

## Step 10: Wrap-up

Not done: the optional Mac GPU run (needs the owner's Mac and lock; not attempted); real File System Access "Locate…" (headless); switching photo during a render; export. The persistent profile was deleted at the end because IndexedDB held thumbnails of the private photos; screenshots stay in this folder.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Close out.
**Inferred user intent:** Hand back.
**Commit (code):** none

### What I did
Removed `profile/`, wrote `experience-report.md`.

### Why
Privacy and a clean folder.

### What worked
All numbered steps were run.

### What didn't work
Nothing further; note that a `profile/` folder was already staged/committed by something during the session (git showed its files as deleted when I removed it): see the hand-back message.

### What I learned
State carries over runs: always start scripts by looking at the page.

### What was tricky to build
N/A

### What warrants a second pair of eyes
The git history of `sessions/02-…/profile/` (private thumbnails in a cache).

### What should be done in the future
Add `sessions/*/profile/` to `.gitignore`.

### Code review instructions
Read `experience-report.md`, its table at the end.

### Technical details
Scripts: `scripts/lib.mjs`, `s01`…`s18`.
