---
Title: Diary
Ticket: CHB-026
Status: active
Topics:
    - ui
    - product
    - ingest
    - testing
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/various/01-experience-report-session-01.md
      Note: Narrative of session 01 in Manfred's voice with developer commentary
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/various/02-findings.md
      Note: Merged findings F1–F16
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/playbooks/01-cosplay-session-protocol.md
      Note: The brief for tester agents
ExternalSources: []
Summary: "Orchestrator diary of the user-cosplay usability work: session 01 and the material for tester agents."
LastUpdated: 2026-11-12T14:00:00-05:00
WhatFor: "Chronological record of what was tried, measured and found."
WhenToUse: "Resuming CHB-026; reviewing how findings were obtained."
---

# Diary

The orchestrator's record of the user-cosplay sessions. Each tester agent keeps its own diary under
`sessions/NN-…/diary.md`. The narrative of session 01 is the
[experience report](../various/01-experience-report-session-01.md); the findings are merged in
[02-findings.md](../various/02-findings.md).

## Step 1: Ticket, test photos, first look at the empty app

I set up the usability test the user asked for: playing the photographer (the user's father) on his own Nikon D750
photos. I built the studio, served it on port 4600 and opened it with Playwright at 1440×900. The first look
already produced friction notes (jargon in the status line, an empty state that says "open a negative", a
cryptic "photo" checkbox). I created the ticket first as "Photographer usability test with real Nikon D750 NEFs";
Step 4 recreates it under a broader title.

### Prompt Context
**User prompt (verbatim):** "So I want you to pretend to be a photographer/my dad (and once you feel ready, launch subagents that are less intelligent to do the same, keeping a detailed diary in the subagents as well and give yuo a report) to work out the UI and functionality, pinpointing friction points or just broken things, etc... so that we can really test our system. There are plenty of photographs from his nikon with varying conditions in @~/Downloads/2026-11-11 - manfred test bilder/ 

Look at it, and try a few things and then stop and give me feedback on what you did and found so far."
**Assistant interpretation:** Run a hands-on usability session in character as the photographer, using his real
photos, document friction and breakage, then stop and report; tester subagents come later.
**Inferred user intent:** Find what stops the real target user before investing further, and build a repeatable
way of testing like him.

### What I did
- Listed the 33 NEFs (D750, 6032×4032, 14-bit lossless), extracted the embedded JPEG previews and a contact
  sheet to the scratchpad (`manfred/prev/`, `manfred/contact.jpg`) to pick test frames.
- `pnpm --filter @chromobench/studio build` and `… preview --port 4600 --strictPort` (background).
- Playwright MCP: `browser_navigate http://localhost:4600/?fresh`, resize to 1440×900, screenshot
  `various/shots/01-start.png`.

### Why
- `?fresh` (in-memory store) for a clean first contact; later steps use `/` (persistent), which is what he gets.

### What worked
- Build and serve. The app loads; the status line shows the CPU reference engine.

### What didn't work
- No WebGPU in the Playwright browser: `Failed to create WebGPU Context Provider` (console warning ×3); the
  status line reads `reference · CPU f64 (no WebGPU: E_EVAL: no GPU adapter) · 512 px`. All timings in this
  session are therefore CPU worst cases.

### What I learned
- Screenshots must be saved under the repository (the MCP's allowed roots are the repo and `.playwright-mcp/`).

### What was tricky to build
- N/A (setup).

### What warrants a second pair of eyes
- Whether the test browser can be given WebGPU (flags such as `--enable-unsafe-webgpu`) so timings match his Chrome.

### What should be done in the future
- Re-measure F4 with WebGPU.

### Code review instructions
- N/A.

### Technical details
- First friction notes: three rows of chrome; "Chromobench" ×3; Undo/Redo as buttons and in Edit; empty state
  "No frames yet: open a negative"; `photo` checkbox (top bar) must be ticked *before* opening.

## Step 2: Opening a NEF the way he would, then trying to fix it

I opened `DSC_8559.NEF` (daylight) without ticking anything, as he would. It came out as an inverted
negative. Ticking "photo" afterwards and opening the file again did nothing, and the status line stayed on
"opening DSC_8559.NEF…" for good. Reading the code explained both: the decode mode is chosen at open time, and
`frames.open()` dedupes by content hash. Along the way the user pointed out that the Nikon files are digital
photos and that a real negative is at `~/Downloads/raw010.dng`.

### Prompt Context
**User prompt (verbatim):** "there's also a rea negative in ~/Downloads/raw010.dng .

Also, try to be mindful of processing speed and how responsive the UI is, in case we want to introduce tiling / caching / other optimizations here." and "the nikon are digital photos, so not negatives."
**Assistant interpretation:** Add the negative to the test set; measure speed and responsiveness as findings.
**Inferred user intent:** Gather evidence for performance work (tiling, caching), not just UX notes.

### What I did
- `browser_file_upload` from `~/Downloads/…` failed: `File access denied: … is outside allowed roots. Allowed
  roots: /home/manuel/code/wesen/chromobench/.playwright-mcp, /home/manuel/code/wesen/chromobench`.
  Copied 5 NEFs and `raw010.dng` to `.playwright-mcp/photos/` and added `.playwright-mcp/` to `.gitignore`.
- Opened DSC_8559 via "Open files…" plus `browser_file_upload` → `shots/02-open-nef-no-photo-flag.png`.
- Ticked "photo" (`page.getByLabel('photo')`) → `shots/03-photo-ticked-after.png` (unchanged).
- Re-opened the same file → `shots/04-reopened-as-photo.png`; polled the status line for 120 s.
- Read `apps/studio/src/main.ts:245-268` (`openFiles`), `packages/studio-kit/src/bridge/frames.ts:67-81`
  (`open`), `apps/studio/src/host/engines.ts:238` (decode switch).

### Why
- Act first, then explain with code: the report needs both the user's view and the cause.

### What worked
- The file chooser plus upload path works for MCP-driven opens.

### What didn't work
- A screenshot during the first open: `TimeoutError: browserBackend.callTool: Timeout 5000ms exceeded.
  … taking page screenshot`, so the main thread was blocked during the open.
- `page.waitForEvent('filechooser')` inside `browser_run_code_unsafe` doesn't work: the MCP takes the chooser
  (the call returned with "Modal state: [File chooser]" and no result). Later steps use
  `page.setInputFiles('#file', path)` instead.
- The re-open: status `opening DSC_8559.NEF…` unchanged after 120 s; console has no errors.

### What I learned
- `frames.open()`: `const existing = this.all().find(e => e.sha === sha); if (existing) return existing;`.
- `openFiles` only writes a final status for `files.length > 1`.
- The status line notes for a NEF in scan mode: `camera RAW (Nikon D750) via LibRaw, scan mode, CFA-binned to
  3016×2016 · working image 512×342 · no rebate found … W_NO_OPEN_GATE … W_NO_SURROUND … W_REBATE_BLANK …`.

### What was tricky to build
- Telling "frozen" from "stuck": the page answered evaluate calls within 2 ms while the status was stuck, so
  the UI was alive and the open had simply returned early without saying so.

### What warrants a second pair of eyes
- Whether de-duplication by hash should exist at all for a re-open with different decode settings.

### What should be done in the future
- F1, F2 in the findings.

### Code review instructions
- `packages/studio-kit/src/bridge/frames.ts` `open()`; `apps/studio/src/main.ts` `openFiles()`.

### Technical details
- Findings F1 (blocker), F2 (blocker), F9 (jargon).

## Step 3: Reload, photo mode, measuring the freeze

A real user restarts what looks stuck, so I reloaded `/` (persistent storage). The library was empty, and
"photo" was unticked again. With "photo" ticked first, the NEF opened as a positive in about 7 s. I then
measured what dragging the Time slider and typing values feel like, and found that the whole window freezes for
about 2 s per preview. Undo and redo work. Typed values have surprises (`-5` is relative) and errors arrive as raw
`E_ARG_RANGE` toasts.

### Prompt Context
**User prompt (verbatim):** "and make sure to do things a real life user would do, undo / redo, mistakes, try some values that look weird, etc..." and "commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill). The diary is really important, make a new ticket for this kind of user cosplay simulation work."
**Assistant interpretation:** Include realistic misuse; keep this diary in investigation format; give the cosplay
work its own ticket.
**Inferred user intent:** A repeatable, well-documented user-simulation practice, not a one-off.

### What I did
- A rAF stall monitor in the page (gaps > 100 ms between animation frames = the main thread was blocked), then
  `page.setInputFiles('#file', …/DSC_8559.NEF)` with "photo" checked.
- Slider drag: `page.mouse` down on the Time thumb, 20 moves of 2 px 30 ms apart, up; counted renders
  ("rendered N" in the status bar).
- Ctrl+Z, the Undo button, the Redo button, reading the History panel text after each.
- Typed into the "Time value" textbox (`getByRole('textbox', {name: 'Time value'})`): `15`, `0`, `-5`, `abc`,
  `1000`, `12s`, `7,5`, empty, each followed by Enter → `shots/07-after-weird-time-values.png`.
- Read `parseEntry` (`packages/studio-kit/src/kit/args.ts`) and the field handler (`packages/studio-kit/src/dom/arg.ts`).

### Why
- The rAF gap is what the user feels (a frozen window), independent of how the app counts its own work.

### What worked
- Photo-mode open: positive, filmic default (Fuji C200 → Kodak Portra Endura, 10 s, f/8, grade 2)
  → `shots/06-opened-as-photo.png`.
- One drag = one history entry: `You Time 10.0 → 20.16 s (+1.01 st)`. Ctrl+Z → 10 s; the second Undo → toast
  "Nothing to undo yet"; Redo → 20.16 s.
- `12s` → 12.0 s; `7,5` → 7.5 s (German decimal comma accepted).

### What didn't work
- My first status regex matched "offline ready" in the top bar instead of the status line (log useless; the
  stall monitor was fine). Fixed later by matching `rendered \d+` or reading the probe.
- Stalls, photo open: `[[21,458],[6138,783],[6930,2892]]` (start ms, duration ms).
- Drag: `dragMs: 12170, renders: 7, settleMs: 3065`; stalls 1675, 1650, 1683, 2433, 1750, 2100 ms (each logged
  twice because an earlier monitor was still running).
- Typed: `15` → 11 591 ms until Enter returned; `0` and `1000` refused (box shows the old value); `-5` → 10.0 s;
  `abc` and empty stay in the box.

### What I learned
- `parseEntry`: a leading `+`/`−` makes the entry relative (`'+1/3 st'`, `'−5 CC'`), so `-5` on 15 s = 10 s. Designed,
  but undiscoverable.
- The Time slider is log2 over 2–60 s with a ⅙-stop step; the contract allows 0.1–600 s.
- The reference engine runs on the main thread; only LibRaw has a worker (`engines.ts:66`).

### What was tricky to build
- Measuring a drag realistically: `fill()` on a range input would commit once; real pointer moves create
  previews, one per move, and that is what freezes.

### What warrants a second pair of eyes
- Preview scheduling: each pointer move appears to start a full 512 px render with no cancellation of
  superseded ones. The engine owners should confirm before tiling or caching work starts.

### What should be done in the future
- F4 (worker, coalescing, progressive resolution, stage caching), F8, F13.

### Code review instructions
- `packages/studio-kit/src/dom/arg.ts` track(): `input` → `st.preview`, `change` → `st.commit`.

### Technical details
- Findings F4, F5, F8, F10, F13.

## Step 4: Ticket recreated as the cosplay umbrella; toasts captured

Following the request for a dedicated ticket, I recreated CHB-026 (uncommitted until then) as
**"User cosplay simulation: photographer persona usability testing"** and moved the screenshots over. The user
also mentioned seeing error toasts go by; they vanish after 2.6 s, so I wrote a probe that records toasts,
stalls and status changes, and found the shell's own UI log, which still had the earlier toasts.

### Prompt Context
**User prompt (verbatim):** "and make a seto f different scenario documents and all that to give to future subagents.", "also take screenshots for your diary as you go, or maybe even make like, since the diary format is so rigid, a separate \"experience report\" for the things you are doing", "I hope you can see the error toasts (just saw some go by). \n\nWhile the report is written from the point of view of the user, feel free to add \"developer commentary\" callouts where things are already related to code or more technical details, for future reference"
**Assistant interpretation:** Build reusable material for tester agents (scenarios, protocol), add a narrative
experience report with developer callouts beside the diary, and make sure toasts are observed.
**Inferred user intent:** A test practice that cheaper agents can repeat with comparable output.

### What I did
- `rm -rf` of the uncommitted old CHB-026 dir (shots moved out first), then `docmgr ticket create --ticket
  CHB-026 --title "User cosplay simulation: photographer persona usability testing" --topics
  ui,product,ingest,testing`, shots moved into `various/shots/`.
- `scripts/01-install-probe.js` (MutationObserver on `.ck-toast`, rAF stalls, status changes;
  `page.addInitScript`, so it survives reloads) and `scripts/02-read-probe.js` (read and reset, plus
  `window.chromobench.rt.chrome.log`).
- Read the UI log via `window.chromobench.rt.chrome.log`.

### Why
- `docmgr ticket rename` changes only the ID, not the title; the old ticket held only my notes and shots.

### What worked
- UI log entries: `{kind:'toast', text:'Undo Time'}`, `'Nothing to undo yet'`, `'Redo Time'`,
  `'E_ARG_RANGE: print.enlarger.time_s = 0 is outside the allowed range [0.1, 600] (s).'`, the same for 1000,
  and a `{kind:'dialog', text:'Commands'}` I didn't open knowingly.

### What didn't work
- Toasts were not visible in my screenshots (taken seconds later), which is why the probe exists.

### What I learned
- `packages/shell/src/dom/chrome.ts` `toast()`: 2600 ms, at most 3 at once, logged to `chrome.log`.

### What was tricky to build
- The probe has to run both now (`page.evaluate`) and after each navigation (`addInitScript`); guarded by
  `if (window.__probe) return`.

### What warrants a second pair of eyes
- F14: the unexplained "Commands" dialog.

### What should be done in the future
- N/A.

### Code review instructions
- `scripts/01-install-probe.js`, `scripts/02-read-probe.js`.

### Technical details
- Findings F7, F14.

## Step 5: The real negative, the wrong way first and then the right way

I opened `raw010.dng` with "photo" still ticked, a typical mistake. It showed an orange strip, with no
warning. There was no way to remove the frame (right-click gives Chrome's image menu, which the user saw stay
open on their screen). Ctrl+Z there undid a change on the other photo, announced by a toast. After a reload,
with "photo" unticked, the DNG decoded as a negative but **still rendered orange**: the recipe saved under the
file's hash from the mistaken photo-mode open was resumed. A wrong first open poisons that file for good.

### Prompt Context
**User prompt (verbatim):** "real negative: ~/Downloads/raw010.dng", "there is still a right menu open btw[Image #6], nt sure if you can see it", "it's gone now btw."
**Assistant interpretation:** Test the negative path; the native context menu was visible on the user's screen
(not in screenshots).
**Inferred user intent:** Cover the negative workflow too; keep the shared browser tidy.

### What I did
- `page.setInputFiles('#file', …/raw010.dng)` with "photo" checked; probe: first render 3.5 s, stalls 1.0 s and
  2.5 s → `shots/08-negative-opened-as-photo-by-mistake.png`.
- Right-click on the filmstrip thumbnail → `shots/09-right-click-thumbnail.png` (native menu not captured).
- Opened the File, Frame, Edit and View menus and read their items.
- Ctrl+Z with raw010 selected; read `studio.frames.all()` time values via the dev hook.
- `page.goto('/')`, "photo" unchecked, `setInputFiles` raw010 → `shots/10-…`, `shots/11-negative-after-10s.png`;
  dumped the current frame's committed recipe via `window.chromobench.studio`.

### Why
- Making the mistake on purpose is the scenario the user asked for; the dev hook only *explained* the result.

### What worked
- The status notes for the negative decode are informative for a developer: `base 0.12 0.41 0.71 D (rebate 18×150
  at 196,22, edge) · scan.flare 0.13 0.06 0.04 % … W_NO_OPEN_GATE …`.
- The undo toast names the frame: `Undo Time (on DSC_8559.NEF)` (DSC_8559 went from 7.5 back to 12 s).

### What didn't work
- My attempt to press Escape to close the native menu was rejected by the user (the menu had gone already).
- Negative after reload: first render 7.8 s, stalls `[[1942,1041],[2983,6692]]`; Print tab shows the orange
  negative; no toast, no console error.
- Menus: File = "Save the Print | Find a Command… Ctrl+K"; Frame = flags, next/previous, snapshot, probe,
  exposure, "Apply Print Settings to Selection"; no Open, Remove or Export.

### What I learned
- Root cause of the orange print: committed recipe `{"kind":"digital-raw", "source":{…"decode":{"mode":"photo",
  "encoding":"linear"}}…}` for a frame whose decode ran in scan mode. `frames.open()` resumes
  `kv.get('logs', sha)` without checking it against the decode mode.

### What was tricky to build
- Seeing that the orange print was a recipe/decode mismatch and not a slow render: the status notes said scan
  mode while the recipe said photo, and waiting 10 s changed nothing ("rendered 1").

### What warrants a second pair of eyes
- How saved logs should interact with a different decode mode: invalidate, fork a new frame, or ask.

### What should be done in the future
- F3, F6, F15, F16.

### Code review instructions
- `packages/studio-kit/src/bridge/frames.ts` `open()` (the `saved` branch).

### Technical details
- Findings F3 (blocker), F6, F12, F15, F16.

## Step 6: Material for tester agents; stopping to report

I stopped testing here, as the first prompt asked ("try a few things and then stop"), and wrote the reusable
material for tester agents: the persona, the test-material catalogue, the session protocol (setup, the two ways
to drive a browser, probes, diary plus experience report, findings, hand-back), ten scenarios, the merged
findings list and the experience report of this session.

### Prompt Context
**User prompt (verbatim):** see Step 4.
**Assistant interpretation:** Scenarios and a protocol so cheaper agents can repeat the session.
**Inferred user intent:** Scale the testing out.

### What I did
- `reference/01-persona-manfred.md`, `reference/02-test-material.md` (EXIF table from `exiftool -T`),
  `playbooks/01-cosplay-session-protocol.md`, `playbooks/scenarios/S01…S10`, `various/01-experience-report-session-01.md`,
  `various/02-findings.md`.

### Why
- Parallel testers sharing one MCP browser would share one tab and one IndexedDB; the protocol gives each tester a
  port (separate origin, separate storage) and a standalone-Playwright option for parallel runs.

### What worked
- N/A (documents).

### What didn't work
- N/A.

### What I learned
- Local Playwright and Chromium are installed (`node_modules/.bin/playwright`, `~/.cache/ms-playwright/chromium-*`),
  so agents can drive their own browsers.

### What was tricky to build
- Keeping agents in character: the protocol forbids acting through `window.chromobench`/DSL/URL flags but allows
  measuring through them.

### What warrants a second pair of eyes
- Whether the persona assumptions (darkroom background, German, Lightroom habits) match the real Manfred.

### What should be done in the future
- Launch tester agents (cheaper model) on S01, S05, S09 first; merge their findings.

### Code review instructions
- Start at `playbooks/01-cosplay-session-protocol.md`.

### Technical details
- Session state left behind: the preview server on port 4600 (background) and the MCP browser on `/` with
  raw010 open (persistent storage now holds per-hash logs for DSC_8559 and raw010).

## Step 7: Does negative development work at all? Yes, on a clean slate

The user asked whether I managed both negative and positive development. Positive (digital RAW → film → print)
worked in Step 3. For the negative I had only seen orange strips, the second time because of F3, so I opened
`raw010.dng` once more with `?fresh` (in-memory store, no poisoned recipe). It printed correctly: a plausible
positive with an automatic first print. The negative path works; what breaks it is the mode bookkeeping around it.

### Prompt Context
**User prompt (verbatim):** "were you able to do both negative and positive development?"
**Assistant interpretation:** Confirm both pipelines produce a correct print, separating pipeline problems from
UX/bookkeeping problems.
**Inferred user intent:** Know whether the core physics works for his father's two kinds of material.

### What I did
- `page.goto('/?fresh')`, `setInputFiles('#file', …/raw010.dng)` with "photo" unchecked; probe read; dumped the
  committed recipe; screenshots `various/shots/12-negative-fresh-print.png`, `13-negative-fresh-negative-tab.png`.

### Why
- `?fresh` is out of character (he can't do it), but it isolates F3 from the negative pipeline itself.

### What worked
- `kind: "negative-scan"`, `decode: {mode: "scan", encoding: "linear"}`; auto first print `time_s 2.227`,
  `lights.logH [0.041, 0.006, -0.063]` (shown as R +2 pt, G 0, B −3 pt); first render 3.9 s.
- The print looks right: blue sky, yellow flowers, neutral greys; slightly flat.

### What didn't work
- One stall of 3825 ms during the open (DNG decode and conditioning on the main thread, F4).
- The strip of three frames is printed as one image, rebate and frame gaps included (F16).
- 2.23 s is at the bottom of the Time slider's 2–60 s range (the thumb sits at the left end).

### What I learned
- The negative→print path and the auto first print (CHB-023) work on real material; F3 is purely about
  resumed recipes.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The auto first print's time lands near the slider's minimum; a short time on a small working image may mean
  the slider range should follow the auto exposure.

### What should be done in the future
- F16: split strips into frames (CHB-013 `filmLayout`).

### Code review instructions
- N/A.

### Technical details
- Findings updated: F3 (the pipeline works on a clean slate), F16.
