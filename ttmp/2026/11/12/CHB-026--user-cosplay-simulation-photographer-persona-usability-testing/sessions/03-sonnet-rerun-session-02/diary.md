---
Title: Diary, cosplay session 03 (re-run of session 02 plus the darkroom printing flow, Sonnet)
Ticket: CHB-026
Status: active
DocType: diary
Summary: "Session 03 against main 15bd6df (CHB-031 + CHB-032 merged, port 4650, CPU engine): F8-F23 re-checked, darkroom flow (test strip, time, aperture, filtration), last week's library, strips, an Epson scan against Negative Lab Pro."
---

# Diary: session 03, session 02 again after CHB-031, plus the darkroom flow

App: `http://localhost:4650/` (main `15bd6df`), headless Chromium 1440x900 through my own Playwright scripts (`scripts/`, helpers in `scripts/lib.mjs`), CPU engine ("Compatibility mode"). Profiles: `profile/fresh/` (deleted and recreated where a step says fresh) and `profile/old-library/` (the orchestrator's; I backed it up to the scratchpad before touching it and only used it in step 5). Timings are CPU-engine, headless; `uptime` load average is noted next to the timings that matter. Private photos stay in `.playwright-mcp/`; the screenshots in `shots/` show them and stay in this folder.

## Step 1: Brief, setup, the empty app and the cold first open

I read the protocol, persona, test material, findings F1-F23, session 02's report and the CHB-031 plan, copied session 02's `lib.mjs` (parameterised the profile name, added `openFile`, `settle`, `meanRGB`, `panelVals`) and started with an empty profile. The empty Darkroom panel now says "Select a photo to print it." (F19 fixed). The cold open of `DSC_8559.NEF` took 5.9-11.4 s to the first picture (session 02: 29 s), with a grey frame, a small spinner and a placeholder thumbnail while waiting, and the status "opening DSC_8559.NEF…".

### Prompt Context
**User prompt (verbatim):** "You are a usability tester. You play a photographer ("Manfred") using the chromobench studio app on his own photos, following a written protocol, and you write a diary and a first-person experience report. This session (session 03) re-runs session 02 after the CHB-031 fixes, and adds the darkroom printing flow: Manfred prints the way he did in a real darkroom (test strip in seconds, exposure time, aperture, filtration).

Repository: /home/manuel/code/wesen/chromobench (work here; do NOT edit any source code; do not commit — the orchestrator commits).

Read these first, in this order (all under `ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/` unless stated):
1. `playbooks/01-cosplay-session-protocol.md` — the protocol. Follow it. Use driving option **B** (your own Node Playwright scripts, headless Chromium, one step per run, persistent profile). Import from `@playwright/test` (NOT `playwright`). Do not use any MCP browser tools.
2. `reference/01-persona-manfred.md` — who you are. `reference/02-test-material.md` — the files (private family photos and scans: read-only, never copy into the repo outside `.playwright-mcp/`, never send anywhere).
3. `various/02-findings.md` — findings F1–F23, especially the section "Session 02" (F17–F23).
4. `sessions/02-sonnet-rerun-session-01/experience-report.md` and its `scripts/` — the previous session. Reuse `scripts/lib.mjs` (copy it into your own `scripts/` and change `SES` to your session folder; it holds the probe, waits, menu helpers) and `scripts/s10-does-time-matter.mjs` (the pixel check of whether Time changes the picture).
5. The fix plan: `ttmp/2026/11/12/CHB-031--cosplay-session-02-findings-enlarger-real-mode-by-default-open-as-panels-strip-frames-leftovers/design-doc/01-plan.md`. Read it to know what was meant to change — then test as Manfred, who has not read it.

The app under test: built from main (commit 15bd6df: CHB-031 WS-A and WS-B and CHB-032 merged) and served at **http://localhost:4650/** (do not rebuild or restart it). Files are opened from a script with `page.setInputFiles('#file', path)` (what File ▸ Open Files… feeds); a file chooser from a dialog (e.g. "Where is …?") with `page.waitForEvent('filechooser')`. The headless browser has no GPU, so the app runs on its CPU engine ("Compatibility mode"); that is expected. The owner's Mac is not available: no GPU run.

Timing: another agent may be running test suites on this machine. Time the cold open and other waits at least 3 times where practical, report medians, and record `uptime` (load average) next to each timing in the diary.

Two browser profiles, both under your session folder's `profile/` (git-ignored; never put a profile anywhere else):
- `profile/fresh/` — create it empty; delete it only where a step says "fresh".
- `profile/old-library/` — **already prepared by the orchestrator, do not delete it**: last week's library, made with the build from before the fixes (`scripts/s00-seed-old-library.mjs` and `shots/s00-seeded-old-library.png` show how). It holds DSC_8541.NEF and raw010.dng frames 1–3, all printed in the old default mode. This is Manfred coming back to his work after the app updated.

Steps (as Manfred, mistakes included; measure with the probe; screenshot as you go):
1. **Empty app (fresh profile).** Before opening anything: what does the Darkroom panel show (F19)? Then open `.playwright-mcp/photos/DSC_8559.NEF`: time to the first picture on the cold profile and what you see while waiting (F22). Which controls are shown for this digital photo — any film-scanner or viewing-light controls (F23)? Are the explanations clear?
2. **The darkroom flow (F17, the main point).** On DSC_8559, as a darkroom printer: make a test strip in seconds (Tools ▸ Test strip). Do the bands differ? Measure (mean RGB of each band region, not just looking). Pick the band you like and set that time. Then drag Time, type a time, change Aperture by a stop, press Lighter and Darker: does the picture change each time, and by how much (pixel check as in s10)? What does Lighter change — the time? Filtration: add yellow, then magenta, as you would to correct a cast: does the colour move the way a darkroom printer expects (more Y → less yellow in the print, more M → less magenta)? Undo and redo through all of it; does Edit ▸ Undo say what it will undo, and which frame (F12)?
3. **Typed values (F8).** In Time type: `15`, `0`, `-5`, `-5 s`, `+1/3 st`, `abc`, `1000`, `12s`, `7,5`, empty. Read each toast and the hint from the UI log. Is it clear which entries are absolute and which are changes?
4. **Layouts.** View ▸ Layout ▸ Simple: what happened to Time and Aperture? Make a print lighter there. Switch back to the darkroom-style layout you used: how does the frame you touched in Simple look, and what do its controls say? If there is a mode switch, try it and note whether the picture jumps.
5. **Last week's library (profile `old-library`).** Start the app with that profile. First note which version you got (the view tabs above the picture read "Dyes" and "Base & gamut" in the old build, other names in the new one; record if a reload was needed). The library should show 4 frames. Select DSC_8541.NEF: a "Where is …?" dialog is expected in a headless browser (no stored file handles) — answer it with the file chooser (`.playwright-mcp/photos/DSC_8541.NEF`). Does the frame look as it did last week (compare with `shots/s00-seeded-old-library.png` and the thumbnails)? Now try to print it darker by changing the time, as in step 2: what does the app show and say for this old frame? Do the same for one raw010 frame.
6. **Open As (F18).** In the fresh profile: File ▸ Open As ▸ Negatives. Close the browser and start it again (new context, same profile). What is Open As now, and can you see it without opening the menu? Select a NEF in the library and relink it: does it open as a photo?
7. **Remove (F21).** Remove a frame from the library (Frame menu or right-click). Does a "Where is …?" dialog open by itself afterwards?
8. **The strip (F16, F20).** Fresh profile: open `.playwright-mcp/photos/raw010.dng` (a 3-frame colour-negative strip). Three frames? Are they upright? Try Frame ▸ Rotate. Is each frame sharp enough to judge (zoom to 1:1)? Is frame 1 hazier or bluer than frames 2 and 3 (measure: mean RGB and the darkest 1% of each frame)? Compare with session 02's shots.
9. **A second real strip, and the tool he uses today.** Open `.playwright-mcp/scans/2025-08-09_raw000.dng` (an Epson scan of a strip, VueScan "Linear Raw" DNG). How many frames does the app find? `.playwright-mcp/scans/2025-08-09_raw000-positive.tif` is one frame of that strip converted by Negative Lab Pro, the tool Manfred uses today. Find the matching frame and put the two side by side (screenshot both at the same size). Describe honestly how chromobench's print compares (colour, contrast, crop, grain), as Manfred would.
10. **Wording and sharpness (F9, F10).** Status line, engine tooltip, decode notes, view tab names, paper and film names: what would Manfred not understand? Is the preview sharp at fit and at 1:1 on the CPU engine (F10)?

Output (follow the protocol's section 3) in `ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/sessions/03-sonnet-rerun-session-02/` (it exists; keep the orchestrator's `scripts/s00-seed-old-library.mjs` and `shots/s00-seeded-old-library.png`): `diary.md` (the diary skill's investigation format — read /home/manuel/.claude/skills/diary/SKILL.md and /home/manuel/.claude/skills/diary/references/investigation-entry.md; numbered steps, each with 1–2 prose paragraphs then all sections; Step 1 quotes this prompt verbatim), `experience-report.md` (first person as Manfred, plain words, screenshots embedded, "Developer commentary" callouts with measurements and code pointers where you have them), `shots/` (screenshots show private photos: they stay in this folder only), and your scripts in `scripts/` (numbered `s01-…`).

The experience report must end with "What I would tell the developer" (3–7 items) and a **before/after table**: one row per finding F8, F9, F10, F12, F17, F18, F19, F20, F21, F22, F23 with columns: finding, session 02 (before), now (after), verdict (fixed / partly / not fixed / new problem), evidence (screenshot, toast text, timing, pixel numbers); then one short row each for F1–F7, F11, F13, F15, F16 ("still fixed?"). Add NEW findings as `S03-N` rows with severity (blocker / major / minor / note, as defined in the findings file). Be honest: if something is still broken or confusing, say so plainly — that is the point.

Final reply (short): session folder; verdict counts; the top new problems; worst stall; anything you could not test and why."
**Assistant interpretation:** Re-run session 02 on the CHB-031 build, add the darkroom flow, and report a before/after table plus new findings.
**Inferred user intent:** Evidence for which CHB-031 fixes hold, and whether the app can be used like an enlarger.
**Commit (code):** none (no commits by the tester).

### What I did
- Copied the NEFs and scans already in `.playwright-mcp/` (nothing new to copy). `scripts/lib.mjs`: probe (toasts, stalls, status), `openFile`, `settle` (wait for a new final render), `meanRGB`, `panelVals`.
- `scripts/s01-empty-and-cold-open.mjs` (fresh profile, empty body text, shots, cold open), `scripts/s01b-cold-open-x3.mjs` (three more cold runs).

### Why
Baseline for F19, F22, F23 and the timing protocol (3 cold runs, with the load average).

### What worked
- Empty app: one menu bar, one tab bar, "No photos yet: File ▸ Open Files… (Ctrl+O), or drop them here"; Darkroom panel with no frame: "Select a photo to print it." `shots/01-empty.png`; for the old library `shots/22-old-library-first-load.png`.
- Cold open of DSC_8559.NEF, time from `setInputFiles` to "rendered 1": run A 11.4 s (load 6.7), run B 7.7 s (load 6.7 to 6.0), then three runs 5.9 / 9.4 / 6.2 s (load 4.7, 4.2, 3.7): median of the three 6.2 s, median of all five 7.7 s. "opened …" came at 2.5-6.1 s. Session 02: 17.6 s to opened, 29 s to the picture.
- Waiting display: the picture area is a grey frame with the file name chip, a small spinner at the bottom right, a blank thumbnail in the strip (`shots/02-cold-open-waiting-5s.png`); text is still only "opening DSC_8559.NEF…".
- Controls for the photo: Enlarger mode, Time, Aperture, Filtration C/M/Y, Printer lights, Paper, Grade, Preflash, Film stock, Viewing light. No Scanner row. A line under the film stock says "A photo prints as if the scene had been shot on this film. The viewing light is the light the print is seen under." (F23).

### What didn't work
- First picture looks dark and brown at the automatic 10.0 s f/8 (mean RGB 68.6/53.5/43.2 over the image, luma 57 of 255, daylight scene) (`shots/03-nef-opened.png`). Both NEFs I opened got exactly 10.0 s f/8, which looks like a default, not an exposure estimate (S03-N8).
- The same warm-profile NEF open varied from 5.5 s to 20 s in later runs (see steps 4 and 10), with the load average around 1-3.

### What I learned
F22 is fixed in time; the visual feedback while waiting is the spinner and the placeholder only.

### What was tricky to build
Matching the end of a render: status text "rendered N · screen|draft|refine"; `settle()` waits for a new `screen` number.

### What warrants a second pair of eyes
Why the same open takes 5 s one run and 20 s another on a warm profile (service worker? decode worker spin-up? other agent's load?).

### What should be done in the future
Show a determinate or at least step-named progress while a RAW is read ("reading the RAW…", "making the print…").

### Code review instructions
`scripts/s01-empty-and-cold-open.mjs`, `scripts/s01b-cold-open-x3.mjs`. Probe stalls on the first open: 167, 217, 133 ms (second run) and a worst of 367 ms (step 2 first open).

### Technical details
Probe status times, run B: opening 1950, opened 5000, rendered 9419 ms (page time, `opening` is about 1.9 s after load).

## Step 2: The darkroom flow, test strip, time, aperture, Lighter and Darker, filtration, undo

I made the test strip in seconds, measured it, and then drove every darkroom control with a pixel check after each action (settle, then mean RGB of the picture area). Everything now moves the picture: this is the F17 fix. The directions are what a darkroom printer expects.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Do the printing flow as a darkroom printer and measure.
**Inferred user intent:** Verify that the controls are real now.
**Commit (code):** none.

### What I did
- `scripts/s02a-test-strip-look.mjs`, `s02b-strip-measure.mjs`, `s02c-darkroom-flow.mjs`, `s02d-lighter-filtration-undo.mjs`, `s02e-strip-vs-plain.mjs`.
- Tools ▸ Test strip: five labelled bands 6.3 / 7.94 / 10.0 / 12.6 / 15.87 s (⅓ stop apart, centred on the current 10.0 s) across the one picture (`shots/04-test-strip-click.png`, `05-test-strip-settled.png`). Clicking band 4 set Time to 12.6 s ("Expose 12.6 s.", `shots/06-after-band-click.png`).
- Typed Time values 6.3, 10, 12.6, 15.87, 30; slider drag; Aperture ± steps; Lighter ×2, Darker ×3; typed filtration Y/M/C 20 and Y 40; undo ×6.

### Why
F17 was "Time does nothing"; the only honest test is the pixel mean after each action.

### What worked
- Bands differ: band luma means (strip view) 6.3 s 60.4, 7.94 s 42.8, 10.0 s 33.8, 12.6 s 40.5, 15.87 s 29.3 (different picture content in each band, so the means do not fall in order). The decisive check: each band equals the plain print at that time over the same columns, to the decimal (`s02e`): 74.7/56.6/42.7, 51.5/40.4/32.3, 40.8/31.5/27.1, 50.6/37.3/30.2, 30.8/28.7/28.4 in both.
- Time typed (whole picture, f/8): 6.3 s luma 97.6; 10 s 56.8; 12.6 s 42.2; 15.87 s 31.9; 30 s 18.3 (session 02: 56.68 identical everywhere). Every ⅓ stop is about 25-30 % luminance. Slider drag of 20 moves (30 ms apart): Time 7.1 s, luma 85.8, no stall above 100 ms; statuses `rendered N · draft` then `screen`; final picture about 2.1 s after release.
- Aperture (f/8 start, 10 s): one step "up" to f/9 luma 75.9, f/10 96.0; down again 75.9, 56.8, then f/7.1 41.9: a stop-down lets less light through so the print is lighter (correct). Steps are ⅓ stop (f/8, f/9, f/10, f/7.1…).
- Lighter and Darker (f/7.1, 10 s, luma 41.9): Lighter → Time 7.94 s, luma 56.3; Lighter → 6.3 s, luma 74.8; Darker back to 7.94 s, 10.0 s, then 12.6 s luma 31.6. So Lighter and Darker change the time by ⅓ stop, printer lights stay at 0 pt (History: "Time 10.0 → 7.94 s (−1/3 st)").
- Filtration (typed, 10 s, base B/R 0.673, G/avg(R,B) 0.948): Y +20 CC → B/R 1.094 (print turns blue: less yellow, as a printer expects), Y +40 → 1.826 (`shots/09-yellow-40.png`); M +20 → G/avg 1.324 (greener: less magenta); C +20 → R 83.5 vs 49.8 (redder: less cyan). 20 CC is 0.20 D: ×1.58 on a channel, which is what the numbers show; it is a strong step for a person used to 5-10 CC corrections. The tooltip says "More yellow makes the print bluer, more magenta makes it greener."
- Undo: Edit menu "Undo Aperture Ctrl+Z", "Redo Aperture"; six undos all worked, toasts "Undo Aperture". With one frame no frame name is shown; with two frames see Step 10b.

### What didn't work
- History formats a typed step as "Time 12.6 → 15.87 s (+0.33 st)" but a button step as "(+1/3 st)"; typed 6.3 from 12.6 reads "−1 st". Cosmetic (S03-N9).
- After about 20 entries the History panel rows overlap and clip (`shots/09-yellow-40.png`, left panel). Reproduced in `shots/14-layout-dialog.png` too (S03-N10).

### What I learned
The time is real, not normalised, in the default Classic layout; Lighter in real mode is ⅓ stop of time.

### What was tricky to build
The State persists between my scripts (time 12.6 s and f/7.1 stayed in the recipe), so each script re-typed the starting time. Aperture direction needed the History to be sure (up = bigger f-number = lighter).

### What warrants a second pair of eyes
The auto first print gives every photo 10.0 s f/8 (also the tungsten interior). If the plan said the time is set so each frame opens correctly exposed, it is not obvious here.

### What should be done in the future
Finer filtration steps for a first slider move (5 CC); an exposure estimate for the first time.

### Code review instructions
`scripts/s02c-darkroom-flow.mjs` (typed times), `s02d` (Lighter/Darker, filtration, undo). Compare with session 02's `s10-does-time-matter.mjs`.

### Technical details
Settle times per change on the CPU engine: 1.6-3.9 s. Probe worst stall in these runs: 0 ms.

## Step 3: Typed values in Time

I typed the ten entries into Time and read the toasts from the UI log. The grammar is now: a plain number sets the time; a change needs a sign and a unit (`-5 s`, `+1/3 st`). A bare `-5` is refused with an explanation that names both options.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Exercise the box with Manfred's odd entries.
**Inferred user intent:** Check F7/F8.
**Commit (code):** none.

### What I did
`scripts/s03-typed-values.mjs`, and `s04a` for `15` then `-5 s`.

### Why
F8 leftover: "a bare -5 is still relative".

### What worked
- `15` → 15.0 s. `0` → "Time can't go below 0.1 s: set to 0.1 s". `-5` → stays in the box (red), toast "Time: “-5” — to change the time, add a unit (−5 s or −1/3 st); to set it, type 5". `-5 s` from 15 s → 10.0 s (from 0.1 s: the same "can't go below" message). `+1/3 st` from 0.1 s → "Time +1/3 st → 0.13 s". `abc` → "Time: “abc” is not a value. Type a time: 15, 12s or 7,5 sets it. To change it, add a unit: +1/3 st, −2 s", stays red. `1000` → "Time can be at most 600 s: set to 600 s". `12s` → 12.0 s. `7,5` → 7.5 s. Empty → "Time: the box is empty. Type a time: 15, 12s or 7,5 sets it. To change it, add a unit: +1/3 st, −2 s" (box red). Click elsewhere: the box goes back to the last good value (7.5 s). No stall at all (0 ms). The box tooltip and placeholder: "Type a time: 15, 12s or 7,5 sets it. To change it, add a unit: +1/3 st, −2 s", placeholder "15, 12s, +1/3 st".
- Filtration and printer lights have the same pattern in their tooltips ("Type filtration in CC: 40, −10 or 62,5 sets it. To change it, add CC: +5 CC, −10 CC").

### What didn't work
My own order test made `-5 s` look like "refused" at 0.1 s; run from 15 s it gives 10 s. No problem in the app.

### What I learned
"-5" now teaches itself; I could not find an entry that behaves surprisingly. A user typing `-5` still gets a refusal, not a guess, which is the right call.

### What was tricky to build
Reading toasts: they vanish after 2.6 s, so the probe and `chrome.log` are the evidence.

### What warrants a second pair of eyes
The red border across frames (F8's leak) was not re-checked with two frames.

### What should be done in the future
N/A.

### Code review instructions
`scripts/s03-typed-values.mjs`; `packages/studio-kit/src/kit/args.ts` for the grammar.

### Technical details
Screenshots `shots/12-typed-abc.png`, `12b-typed-minus5.png`, `12c-typed-empty.png`, `12d-typed-1000.png`.

## Step 4: Layouts, Simple and back, the mode switch

View ▸ Layout… opens a dialog with seven buttons (Classic, Darkroom, Simple, Lab, Tiny, Roll, Finish, Looks). Simple turned the studio into a three-step wizard (① Pick ② Print ③ Save). Switching layout also closed the open frames ("not open"), so I had to open the file again. In Simple, Lighter and Darker work and change the picture, and Time stays as a small label.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Try the layouts and the enlarger mode switch.
**Inferred user intent:** Check that the layout default mode (normalised in Simple) behaves and does not surprise.
**Commit (code):** none.

### What I did
`scripts/s04a-view-menu.mjs`, `s04b-layout-dialog.mjs`, `s04c`…`s04j`. (`s04c`/`s04f` hung on my own wait text: in Simple the status never says "rendered" until step ②. Recorded; not the app.)

### Why
Layout defaults are the F17 design decision.

### What worked
- A photo made in Classic (real mode) and opened in Simple keeps its mode: the print step shows "Time 10.0 s 0 st", Lighter / Darker, Warmer / Cooler, Greener / More magenta, Softer / Harder, "Which looks best?". Lighter ×3 changed Time 10 → 5.0 s (−1 st) and the picture lighter: luma 50.6 → 63.4 → 79.8 → 99.1 (`shots/16-simple-lighter-x3.png`).
- A new photo opened in Simple (DSC_8541) gets the normalised mode: Lighter ×2 lightens the picture (luma 68.6 → 81.9 → 97.2), nothing in History says time. Back in Classic it reads "Normalised (grey card at the aim)", with "Normalised enlarger: the grey card prints at the aim whatever the time, so Time and Aperture are hidden. Make the print lighter or darker with the printer lights." and printer lights R/G/B −8 pt, History "Printer lights (0, 0, 0) → (−4, −4, −4) pt", then (−8, −8, −8) (`shots/20-classic-after-simple.png`).
- Mode switch (Enlarger mode select): normalised → real shows Time 10.0 s, picture identical (RGB 142.2/74.9/33.8 before and after, no jump), and back. The tooltip explains the two modes in plain words.

### What didn't work
- Switching layout drops the open file: after View ▸ Layout ▸ Simple all frames read "not open" and the status says "ready: 2 frames in the library; select one to open its file again" (S03-N1). In a real browser with stored file handles this might relink silently; headless cannot show it.
- In Simple, a normalised frame shows a read-only "Time 10.0 s / 0 st" that never moves while Lighter works, and the two rows are both titled "Printer lights" (S03-N2).
- "Locate DSC_….NEF…" in the "Where is" dialog did not trigger a file chooser in headless (15 s wait, no `filechooser` event). I used `#file` instead (S03-N4).

### What I learned
A frame keeps the mode it was created with; the layout only picks the default for new frames. Good and consistent with the plan, but a "Time" label on a normalised frame is an inert control that reads like a live one.

### What was tricky to build
The dialog (Where is …?) stays on top when the file is opened through the other door (S03-N3), so scripts must dismiss it.

### What warrants a second pair of eyes
Whether layout switching should reload/close frames.

### What should be done in the future
Hide the Time label on normalised frames in Simple, as in Classic.

### Code review instructions
`scripts/s04g-simple-print.mjs`, `s04h-simple-new-frame.mjs`, `s04j-mode-switch.mjs`.

### Technical details
Shots `shots/15d-simple-print-step.png`, `19b-simple-new-frame-lighter.png`, `20-classic-after-simple.png`, `14-layout-dialog.png`.

## Step 5: Last week's library (old-library profile)

The app started with last week's profile straight into the new build: tabs read "Print / Negative / No mask / Clipping", no reload needed (service worker active, `http://localhost:4650/sw.js activated`). The library showed 4 frames, all "not open". The old frames come back in their old modes with an explanation, not a puzzle.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Be Manfred coming back after the update.
**Inferred user intent:** Check that old recipes survive and the new default does not strand them.
**Commit (code):** none.

### What I did
Backed up `profile/old-library` to the scratchpad. `scripts/s05a-old-library-start.mjs`, `s05b-old-nef.mjs`, `s05c-old-raw010.mjs`.

### Why
Saved recipes keep their stored mode (plan), which has to be visible and fixable by a user.

### What worked
- Darkroom panel with no frame: "Select a photo to print it." (`shots/22-old-library-first-load.png`).
- DSC_8541.NEF: click → "Where is DSC_8541.NEF? The library keeps DSC_8541.NEF and its recipe, but the browser needs the file again to show it." with "Remove from library / Not now / Locate DSC_8541.NEF…" (`shots/24-old-where-is.png`). After opening the file (via `#file`, 16.4 s load 1.0) it looks like the thumbnail and last week's screenshot (red brick, warm; `shots/25-old-nef-relinked.png`). Its mode is Normalised; the panel hides Time and Aperture and says why. Switching the select to Real enlarger shows Time 10.0 s f/8 with the same picture (mean luma 59.5 before and after); Time 15 s → luma 39.8, 20 s → 29.8: it prints darker as in step 2.
- raw010 frame 2 click → "Where is raw010.dng · 2/3?". Opened the file: 3.1 s; all three frames relink and frame 1 is selected (not the one I clicked). The old frame is in Real mode with Time 2.23 s (the old auto time), frame 1 is still sideways (landscape, on its side) as saved last week, but visibly smoother than the blocky seed shot, and History shows a new "Auto view.frame.crop {"h":143,"w"…" line (`shots/28b-old-raw010-dialog-dismissed.png`). Time 2.23 → 4 → 8 s: luma 120.8 → 55.7 → 24.0, so Time works on the old strip frame too.

### What didn't work
- After opening the file through `#file`, the "Where is …?" dialog stayed on screen over everything until I clicked "Not now" (my first run timed out on the modal; `shots/28-old-raw010-relinked.png`) (S03-N3).
- The old raw010 frame keeps last week's orientation; the new auto-orientation does not apply to old recipes, and I got a raw History line "Auto view.frame.crop {…}" (jargon).
- The seeded "one Lighter step" of DSC_8541 is not in the history (it shows only "Auto Frame added", printer lights 0 pt): the seed's Lighter click did not record, so I could not compare an edited state. Not an app finding.

### What I learned
Recipes survive the update and give the user a way to understand them (the explanation text and the select). Old strip frames do not get the new orientation.

### What was tricky to build
`Locate…` cannot be driven headless (S03-N4).

### What warrants a second pair of eyes
An old frame is silently re-cropped on open ("Auto view.frame.crop"): is that a recipe change the user did not make?

### What should be done in the future
Offer "Rotate to upright" on old strip frames or apply the new default once.

### Code review instructions
`scripts/s05b-old-nef.mjs`, `s05c-old-raw010.mjs`.

### Technical details
Shots `shots/23`, `24`, `25`, `26`, `27`, `28`, `28b`, `29`.

## Step 6: Open As, restart, relink

File ▸ Open As ▸ Open as Negatives sets a blue pill in the status bar ("Opening as negatives"). After a restart without the "Keep This Choice After Restart" tick, the menu is back on Guess and the pill is gone. With the tick, the pill is still there after the restart, and relinking a NEF through the open door makes it a negative, with a toast that says so and how to undo.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Repeat the S02-N2 trap.
**Inferred user intent:** Check F18.
**Commit (code):** none.

### What I did
`scripts/s06a-open-as.mjs`, `s06b-open-as-keep.mjs`, `s06c-reset-open-as.mjs`.

### Why
F18: Open As persisted silently.

### What worked
- Menu: "Photo or Negative: Guess ✓ / Open as Photos / Open as Negatives / Keep This Choice After Restart / Heal Dust on Open" (`shots/30-open-as-menu.png`). After picking Negatives the status bar shows "Opening as negatives" (a pill; its tooltip: "File ▸ Open As: files you open now open as negatives, not guessed. Click to let the studio guess again."). After a restart: no pill, Guess, and relinking DSC_8541.NEF gave "Photo / Nikon D750 photo, 24 MP" (`shots/33-relinked-nef-after-open-as.png`).
- With "Keep This Choice After Restart": the pill is visible after the restart (`shots/35-restart-kept-negatives.png`) and the NEF opens as a negative with the toast "DSC_8541.NEF opened as a negative (File ▸ Open As); your library had it as a photo: Frame ▸ Re-open as Photo brings that back" (`shots/36-relink-with-kept-negatives.png`).

### What didn't work
- With Keep on, an open of a library photo makes it a negative (by the user's choice, with a toast). Plan said "a relinked frame opens in its own recorded kind"; I could only test the open-door path, not Locate. The "Where is" dialog stayed open over the picture again (S03-N3).
- "Keep This Choice After Restart" has no visible tick in the menu screenshot (`shots/34`).

### What I learned
F18 fixed for the default path; the visible pill is what makes the Keep case safe.

### What was tricky to build
Resetting the profile to Guess after the Keep test (`s06c`), otherwise the following steps would be skewed.

### What warrants a second pair of eyes
Check Locate (real file handle) relink with a non-Auto Open As.

### What should be done in the future
Show a tick on the Keep item.

### Code review instructions
`scripts/s06b-open-as-keep.mjs`.

### Technical details
Toast text above is verbatim from the UI log.

## Step 7: Remove from the library

Frame ▸ Remove from Library (and the right-click menu) removes the frame, shows a toast, and no "Where is …?" dialog opens afterwards.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Remove a frame, watch for an automatic relink dialog.
**Inferred user intent:** Check F21.
**Commit (code):** none.

### What I did
`scripts/s07-remove.mjs` on the library with three frames (one open and selected, one not open).

### Why
S02-N5.

### What worked
- Frame menu: Flag as Pick / Reject / Unflag / Rotate Left / Rotate Right / Flip Left to Right / Re-open as Negative / Remove from Library / Next Frame / Previous Frame / New Snapshot / Pin Probe / Add Exposure / Apply Print Settings to Selection.
- Remove the selected, open DSC_8559: toast "Removed DSC_8559.NEF: open the file again to get it back, with its recipe"; UI log has no `dialog` entry.
- Right-click the not-open DSC_8536 thumbnail: the app's own menu (Re-open as Negative, Rotate Left/Right, Flag as Pick, Reject, Unflag, Remove from Library); no dialog from the right-click; Remove → the same toast; no dialog (`shots/41-after-remove.png`, `42-right-click-thumb.png`, `43-after-remove-2.png`).

### What didn't work
No failures.

### What I learned
Selection no longer jumps to a not-open frame after Remove.

### What was tricky to build
N/A.

### What warrants a second pair of eyes
N/A.

### What should be done in the future
N/A.

### Code review instructions
`scripts/s07-remove.mjs`.

### Technical details
UI log after each removal: only the toast.

## Step 8: The strip raw010.dng

Three frames, upright (portrait), each with its own time (2.23 / 2.81 / 3.15 s). Frame 3 can be turned with Frame ▸ Rotate Right and undone. The frames are smoother than last time but soft; zoom is a bare magnifier. Frame 1 is flat and hazy as before but not bluer in the numbers.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Open the strip, check frames, orientation, rotate, sharpness, haze.
**Inferred user intent:** Check F16/F20.
**Commit (code):** none.

### What I did
`scripts/s08a-strip-open-x3.mjs` (three cold opens), `s08b-strip-frames.mjs`, `s08c-rotate-zoom.mjs`, helper `scripts/analyze.py` (bounding box, mean, darkest 1 % per channel, gradient and Laplacian variance of the picture area).

### Why
S02-N4 (sideways, blocky, hazy, no rotate).

### What worked
- Open: 2.4 / 4.9 / 2.7 s to "opened" and 3.6 / 6.3 / 4.1 s to the first picture (median 4.1 s; load 0.6; session 02 2.6 s opened).
- Frames (picture area, working size 290×640 per frame, strip 705×1557 ≈ 639 px a frame): frame 1 mean RGB 130.2/133.1/137.8, darkest 1 % (64, 77, 105), p1 luma 76.3, gradient 0.66, Laplacian variance 16.3; frame 2 mean 134.6/137.4/141.3, darkest 1 % (74, 72, 79), p1 luma 73.3, gradient 4.8, lap var 228; frame 3 mean 134.4/139.4/145.2, darkest 1 % (76, 65, 57), p1 luma 67.5, gradient 2.66, lap var 85. B/R: 1.058, 1.050, 1.081. So frame 1 is not bluer or lifted in the shadows by more than the others, but it is much flatter (gradient 0.66 vs 2.7-4.8): it is the hazy frame, in contrast, not in colour (`shots/50-strip-frame-1.png`, `50-strip-frame-3.png`).
- Upright: yes (sign readable, window upright). Rotate Right turned frame 3 sideways in 0.86 s; History "Orientation transpose → flipH" (jargon); Edit menu "Undo Rotate Right"; Ctrl+Z restored it in 0.86 s.
- Zoom (Ctrl+= ×3 in the Print tab, each step taking about 10 s on the CPU to finish a "refine" pass): the picture is magnified and smooth, not blocky; no new detail (`shots/54-zoom-4.png` is the Negative tab by my mistake; Print-tab zoom for the NEF is `shots/76-nef-print-zoom-3.png`).

### What didn't work
- No "100 %" / 1:1 command or readout in View (only Fit, Zoom In, Zoom Out); after a few steps there is no way to know the ratio (S03-N11).
- A dark line along the bottom edge of frame 3 and at the left of the rotated frame: a film-edge remnant in the crop (`shots/51-rotated-right.png`).

### What I learned
F20 is mostly fixed for this strip. Haze in frame 1 is flatness (probably the flare around the ceiling lamp), not a colour cast.

### What was tricky to build
My zoom run first landed on the Negative view tab: the tab "Print" and the top nav "Print" share a label, so `getByText('Print')` picks the nav. Fixed by clicking the sibling of "Negative".

### What warrants a second pair of eyes
Why a Zoom In step needs about 10 s on CPU for the refine pass.

### What should be done in the future
A 1:1 command; progress text for the refine pass.

### Code review instructions
`scripts/s08b-strip-frames.mjs`, `s08c-rotate-zoom.mjs`, `scripts/analyze.py`.

### Technical details
Probe: worst stall 150 ms (rotate), none on frame changes.

## Step 9: The Epson scan and Negative Lab Pro

`2025-08-09_raw000.dng` opens in 4.1 s to "opened" and 5.6 s to the picture (load 0.45) as "Colour negative (DNG), 5.8 MP, film edge found", 3 frames. Frame 2 is the one in the NLP file. The frames come out sideways here (landscape on a vertical strip), so the orientation default that worked for raw010 does not work for this strip; Rotate Left fixes it.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Compare chromobench's print with the tool Manfred uses today.
**Inferred user intent:** Honest quality check on a real scan.
**Commit (code):** none.

### What I did
`scripts/s09a-scan-strip.mjs`, `s09b-rotate-compare.mjs`; a Python script (inline, not kept) cropped the app picture from `shots/61-scan-frame-2-rotated-left.png`, resized both to 560 px high and put them side by side (`shots/62-side-by-side-chromobench-left-NLP-right.png`). The NLP TIFF is 1466×1041, 16-bit ProPhoto; I converted it with Pillow without colour management for the picture.

### Why
The tool he uses today is the yardstick.

### What worked
- Frames found: 3 (`…raw000.dng · 1/3, 2/3, 3/3`); working image 283×640, strip 678×1534; base 0.08 0.37 0.69 D; notes: W_NO_OPEN_GATE (in the Technical tooltip).
- Frame 2 (brick building, red door) matches the NLP positive. After Frame ▸ Rotate Left: upright (`shots/61`).
- Numbers over the same-size pictures: chromobench mean RGB 126.2/141.3/153.3 (B/R 1.214), luma mean 138.2, luma std 41.2, darkest 1 % luma 29.4, brightest 1 % 214.7, saturation 0.205; NLP 148.0/138.9/103.4 (B/R 0.698), luma 137.5, std 51.9, darkest 1 % 13.3, brightest 1 % 241.3, saturation 0.373. Grain (std of a 3×3 high-pass over the road): chromobench 1.77, NLP 5.46.

### What didn't work
- Orientation: frames 1-3 of this strip show sideways by default (`shots/60-scan-frame-2.png`); frame 2 needed Rotate Left (S03-N5).
- Colour: chromobench is cool and blue-grey (blue sky, bluish concrete, brick dull pinkish-grey); NLP is warm, golden and strongly saturated (brick orange-brown, sky pale). I do not know which is closer to the street; the brick and the concrete are warm things, and chromobench's concrete is bluish. Contrast: NLP deeper blacks and brighter whites (std 52 vs 41), chromobench flatter. Crop: chromobench shows the whole frame with a thin dark rebate sliver at the right edge, NLP is cropped tighter; the pictures are the same scene and not the same crop. Grain: NLP is grainy at 1466 px; chromobench is smooth because the CPU preview is 640 px (not comparable until the GPU preview or an export is looked at).

### What I learned
Frame finding works on a second, different strip (3 frames, confidence 1.00).

### What was tricky to build
Matching the right frame by eye; viewing a 16-bit TIFF outside a colour-managed viewer.

### What warrants a second pair of eyes
The blue cast on this scan (B/R 1.21) is the biggest quality question of the session: does the default "film" and "scanner" assumption match the owner's Epson/VueScan DNG? Filtration would cure it, but the first print should be close.

### What should be done in the future
A "match the NLP positive" reference test: same frame, same crop, ΔE.

### Code review instructions
`scripts/s09a-scan-strip.mjs`, `s09b-rotate-compare.mjs`; compare `shots/62-…png`.

### Technical details
Printer lights for frame 2: R −1, G 0, B −1 pt; Time 5.0 s.

## Step 10: Words, sharpness, Undo naming, leftovers

Hover texts are now darkroom language first and technical second. The engine tooltip reads "The prints are computed on the processor, which is slower: this browser offers no graphics card to compute on. Pictures are previewed smaller." with a second "Technical:" line that still contains `E_EVAL`. Undo now names the other frame.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Read the words, check sharpness at fit and zoom, check Undo naming (F12), re-check the old fixes.
**Inferred user intent:** Close out F9, F10, F12 and spot regressions.
**Commit (code):** none.

### What I did
`scripts/s10a-words-sharpness.mjs`, `s10b-sharpness-print-tab.mjs`, `s11-undo-frame-label.mjs`, `s12-regression-f2-f3-f15.mjs`, `s12b-reopen-pill.mjs`.

### Why
F9, F10, F12 leftovers and the "still fixed?" rows.

### What worked
- Words: tooltips for Enlarger mode, Time ("Exposure time under the enlarger. Longer prints darker; ⅓ stop is about 26 % more time."), Aperture ("One stop down halves the light."), Filtration ("More yellow makes the print bluer, more magenta makes it greener."), Printer lights ("12 points = 1 stop … more blue light makes the print yellower"), Paper, Grade, Preflash, Film stock, Viewing light. Paper and film names are plain ("Kodak Portra Endura", "Kodak Portra 400", "Fujifilm C200"). View tabs: Print / Negative / No mask / Clipping (the old "Dyes" and "Base & gamut" are gone). Photo pill tooltip: "Nikon D750 photo, 24 MP. Developed from the camera RAW with its own colour." then "Technical: photo: camera RAW (Nikon D750) via LibRaw, photo mode, 6032×4032, read binned 3016×2016 … camera matrix from adobe · working image 640×428".
- F12: with 8559 edited and 8541 selected: Edit ▸ "Undo Time (on DSC_8559.NEF) Ctrl+Z"; Ctrl+Z toast "Undo Time (on DSC_8559.NEF)"; afterwards "Redo Time (on DSC_8559.NEF)" and toast "Redo Time (on DSC_8559.NEF)" (`shots/80-edit-menu-other-frame.png`).
- Working image 640 px (session 02: 512); engine tooltip says "· 640 px".
- Regression: opening the same file again → toast "DSC_8559.NEF is already open (as a photo)", status "DSC_8559.NEF was already open". Frame ▸ Re-open as Negative: toasts "Re-opening DSC_8559.NEF as a negative…", "DSC_8559.NEF is open as a negative now"; pill "Looks like a photo: re-open as photo?"; clicking it: "DSC_8559.NEF is open as a photo now (its saved recipe as a photo)" (`shots/86-as-negative-pill.png`).

### What didn't work
- Sharpness (CPU): fit view gradient 4.04 / lap var 164 (Print tab, first run on a polluted state) and 2.17 / 26 (clean run); zoom steps 1-3: gradient 1.86, 1.62, 1.10: magnified but soft; each "refine" pass takes about 10 s on the CPU, and stays soft (`shots/76-nef-print-zoom-3.png`). No 1:1 command (S03-N11).
- Words left: the "Technical:" lines still show `E_EVAL: no GPU adapter`, `W_NO_OPEN_GATE`, `W_NO_SURROUND`, `W_REBATE_BLANK`, `CFA-binned`, `scan.flare`; status `rendered 7 · refine` (draft/screen/refine mean nothing to him); History "Orientation transpose → flipV", "Auto view.frame.crop {"h":143,…}"; a typo in the pill tooltip "The picture no orange mask and no film edge." (missing "has") (S03-N12).
- Undo works on a frame that is not on screen: after Ctrl+Z on 8541 the picture shown was still 8541, so the change is invisible (the toast and the menu say which frame).

### What I learned
F12 is fixed in the label; F9 is mostly fixed by hiding jargon one tooltip deeper.

### What was tricky to build
Watching the refine pass: status text only; time between steps 10 s.

### What warrants a second pair of eyes
Whether Undo should switch to the frame it undoes.

### What should be done in the future
Select the frame an undo touches; a "100 %" command; fewer raw codes in the Technical text (or a "Details…" panel).

### Code review instructions
`scripts/s10a-words-sharpness.mjs` prints every title attribute and select option.

### Technical details
Worst stall in the whole session: 367 ms (first open, step 2); drags and renders: 0 ms above 100 ms.
