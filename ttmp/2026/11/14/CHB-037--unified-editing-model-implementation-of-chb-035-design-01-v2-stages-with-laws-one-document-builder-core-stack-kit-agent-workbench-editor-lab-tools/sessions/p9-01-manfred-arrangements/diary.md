# Diary

## Goal

Chronological record of cosplay session P9-01 (CHB-037 phase P9): Manfred uses the rebuilt studio on its two
candidate default arrangements, "Darkroom first" (`?layout=darkroom`) and "Classic" (`?layout=classic`), with
synthetic material only, headless Chromium on SwiftShader WebGPU. All timings below are **SwiftShader (software
GPU) timings**, much slower than his real GPU.

## Step 1: Setup — headless driver, server, empty Darkroom-first screen

I read the persona, the session protocol, the CHB-026 findings F1–F44 and the diary skill, created the session
folder, started the prepared build on port 5516 and wrote a small long-lived Playwright driver so that one browser
page survives across steps (open photos and History persist like his browser), instead of relaunching per step.

### Prompt Context

**User prompt (verbatim):** "You are a usability tester running one "cosplay" persona session on chromobench, a browser darkroom studio (PWA) for a photographer who works with film. You play Manfred, the photographer. This is part of ticket CHB-037 phase P9 (integration). Your job: use the studio the way he would on its two candidate arrangements, write down what happens, and recommend which arrangement should be the default. You do NOT fix the app (no source edits) and you do NOT commit.

## Where everything is
- Repository worktree (work only here): /private/tmp/claude-501/-Users-manuel-code-wesen-chromobench/bf16e1a6-fa3e-4569-93f9-63fc4d4d3d92/scratchpad/chb037-p9  (below: <wt>)
- Read first, and follow exactly:
  - <wt>/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/reference/01-persona-manfred.md (who you are)
  - <wt>/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/playbooks/01-cosplay-session-protocol.md (the protocol: ground rules, diary + experience report, findings table, hand-back format)
  - skim <wt>/ttmp/2026/11/12/CHB-026--user-cosplay-simulation-photographer-persona-usability-testing/various/02-findings.md (earlier findings F1–F44, so you can say "F<n> reproduced")
  - ~/.codex/skills/diary/SKILL.md (diary step format; the protocol's diary uses it)
- Your session folder (create it): <wt>/ttmp/2026/11/14/CHB-037--unified-editing-model-implementation-of-chb-035-design-01-v2-stages-with-laws-one-document-builder-core-stack-kit-agent-workbench-editor-lab-tools/sessions/p9-01-manfred-arrangements/ with shots/, diary.md, experience-report.md, and your Playwright scripts. The browser profile goes in its profile/ subfolder (git-ignored by the pattern ttmp/**/sessions/*/profile/).

## What changed since the CHB-026 sessions (so you know what you are looking at)
The studio was rebuilt on one editing model: every frame is a document with stages (scan or scene for camera files, darkroom, print); each stage is a stack of layers (the darkroom: main exposure, printer lights, burns/dodges/flashes, density "contrast" masks, filters; the print: Editor-lab-style digital layers — curve, levels, HSL, colour grading, vibrance, channel mixer, clarity, sharpen, vignette — with blend modes, groups and masks; retouch heal/clone). One History (undo) for everything. Two arrangements are candidates for the default:
1. "classic" (`?layout=classic`): Lightroom-like modules across the top — Library, Roll, Scene (camera files), Print (the darkroom: Exposures panel), Edit (the print's digital layers), Finish (crop, straighten, spot removal), Assistant, Output.
2. "darkroom" (`?layout=darkroom`, labelled "Darkroom first"): ONE screen — film strip on the left with History, the print in the centre, the Enlarger on the right (main exposure, printer lights, burns/dodges as rows), Paper, and a collapsed "Digital (after the print)" palette with the print's layers.
View ▸ Layout switches between layouts in place (the open photos stay).

## Rules specific to this session (they override the protocol where they differ)
- **Synthetic material only.** Do NOT use the photographer's photos or scans (nothing from ~/Downloads, ~/Dropbox, .playwright-mcp/photos or .playwright-mcp/scans). Use only these generated files: <wt>/.playwright-mcp/p9-synthetic/ — landscape-negative.tif (3000×2000 colour negative scan: sky, sun, clouds, hills, a house with a red door, a film edge on the left), roll-12-frame-1..4.tif (four 1800×1200 negatives of the same scene at different exposures, "a roll"), landscape-camera.dng (a camera RAW of the same scene). Screenshots of the app showing these are fine to keep in your session folder.
- **Headless only.** Never open a headed/visible browser window (it steals the owner's focus). Use protocol option B: your own Node Playwright scripts (`import { chromium } from 'playwright'`, run with `node <script>.mjs` from <wt>), `chromium.launchPersistentContext('<session>/profile', { headless: true, channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'], viewport: { width: 1440, height: 900 } })`. Those flags give the app the WebGPU engine on SwiftShader (software): it works but timings are much slower than on his real GPU — record timings anyway and say they are SwiftShader timings. Do not use the real GPU (another agent holds it).
- **Serve the prepared build** (already built into apps/studio/dist-current): run in the background from <wt>: `pnpm --filter @chromobench/studio exec vite preview --outDir dist-current --port 5516 --strictPort`. Use only port 5516 (other ports are in use by other agents). Stop the server when you are done.
- Start pages as `http://localhost:5516/?layout=darkroom` or `?layout=classic` (persistent storage, as he would get). Add `&nosw` to avoid the service worker caching across your runs. Use `?fresh` only if you must, and say so.
- Act only through visible controls (clicks, typing, keys, mouse drags on sliders and on the picture, menus, File ▸ Open via `page.setInputFiles('#file', path)` which is what the file dialog does). `window.chromobench` is for measuring and explaining only (e.g. `window.chromobench.idle()` to wait for renders, `.doc` to read the document, `.entries()`), never for doing.
- Look at every screenshot you take (Read the PNG). Keep it to roughly 20–35 screenshots.
- Do not edit any file outside your session folder. No git commands that change anything.

## The scenarios (do them in this order; make his usual mistakes along the way, see the persona)
- **S1 — Darkroom first, a negative to a finished print** (`?layout=darkroom`): open landscape-negative.tif; judge the first print; make it lighter/darker with Time and the Lighter/Darker buttons; fix colour with the printer lights; burn the sky (find out how — he knows burning from the darkroom); dodge the shadowed foreground; try the contrast (Paper grade, and whatever else he finds); then open the digital palette and try one digital thing he knows from Lightroom (a curve, vibrance, HSL); undo a step too many and redo; type odd values (`7,5`, `abc`, `0`, `1000`); before/after (`\`); export a TIFF for printing (File ▸ Export). Can he crop or remove a dust spot on this screen?
- **S2 — The same job in Classic** (View ▸ Layout ▸ Classic, the photo stays open; or open it fresh): Print module for the darkroom work, Edit module for the digital layers (try a curve with the curve editor, HSL, colour grading, a mask on one layer, a blend mode, putting two layers in a group), Finish for crop and a spot, Output/Export. How many module switches does the job take, and does he lose track of where things are?
- **S3 — A roll** (either arrangement; start with the one he prefers so far): open the four roll-12 frames together; make a first print for the roll; make one frame right and copy/sync its settings to the others the way he does in Lightroom (look for Copy/Paste Settings or Sync); one undo should take a roll-wide change back.
- **S4 — A camera file**: open landscape-camera.dng; it should open as a photo through a film simulation; find where to correct exposure/white balance "before the film" (the Scene module in Classic); does the darkroom arrangement offer it at all?
- **S5 — Comparison and recommendation**: in his words, which screen would he rather work in every day and why; which one should a new install open with. Be concrete: what each arrangement makes easy or hard for S1–S4.

## Output (in the session folder)
- diary.md (rigid, chronological, diary-skill steps; quote this brief verbatim in Step 1's Prompt Context as "User prompt (verbatim)" — it is your brief from the P9 phase agent),
- experience-report.md in Manfred's voice with developer-commentary callouts, ending with "What I would tell the developer" and a `## Findings` table (ID, severity blocker/major/minor/note, one-line summary, repro, evidence). New finding IDs: `P9-1`, `P9-2`, …; reuse F<n> when you reproduce an old one. Add a `## Recommended default arrangement` section (Manfred's choice + the developer's reasons).
- Known already (do not spend time on them, but note "known" if you hit them): (K1) the classic and darkroom layouts have no Copy/Paste/Sync Settings — those commands exist only in the separate "Looks" layout's Looks menu; (K2) History rows name some layers by internal names ("Added curve1p3", "Added a hsl"); (K3) a layer the assistant adds shows its lower-case op name ("burn"); (K4) the darkroom layout's film strip had no height (fixed in this build — check that it works).

## Hand back
When done, stop the preview server and reply with the protocol's §5 hand-back block (session folder, scenarios done/not done, top findings max 10 with ID + severity + one line, new vs known, worst stall, files), plus the recommended default arrangement in two or three sentences. Keep it short; the documents carry the detail."

**Assistant interpretation:** Run scenarios S1–S5 as Manfred, headless on SwiftShader, through visible controls only;
write a diary and an experience report with findings and a recommendation for the default arrangement.

**Inferred user intent:** Decide, from a realistic user's experience, which arrangement a new install should open
with, and collect the defects that stand between the rebuilt studio and daily use.

### What I did
- `pnpm --filter @chromobench/studio exec vite preview --outDir dist-current --port 5516 --strictPort` (background).
- Wrote `driver.mjs` (long-lived `launchPersistentContext(profile, headless, SwiftShader flags)`, the CHB-026 probe
  injected with `addInitScript`, a unix socket that runs one step file per request) and `step.mjs` (client).
  Step files live in `steps/`; `steps/common.mjs` has helpers (wait for "rendered N · done", drag a range thumb,
  type into a value field, sample mean screen RGB in boxes over the print — measurement only).
- Loaded `http://localhost:5516/?layout=darkroom&nosw`.

### Why
- One page across steps keeps the History and open photos, which matter for undo and for the layout switch.

### What worked
- Engine label: `GPU · google swiftshader (software) · 4000 px`; status pill "Graphics card emulated in software: slower".
- Empty state is clean: "No photos yet: File ▸ Open Files… (Ctrl+O), or drop them here" (shots/01-darkroom-empty.png).

### What didn't work
- First driver: `listen EINVAL` — the absolute socket path exceeds macOS's 104-byte limit. Fixed by `chdir` to the
  session folder and a relative socket name `.driver.sock`.
- `import ... from 'playwright'` is not resolvable in the worktree; `@playwright/test` is (it re-exports `chromium`).
- Step modules importing `./common.mjs` statically got the cached old module; switched to
  `await import('./common.mjs?' + Date.now())`.

### What I learned
- Page load to `window.chromobench` present: 17.7 s (SwiftShader start-up; the app shell is visible earlier).

### What was tricky to build
- N/A (no app code).

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- N/A

### Code review instructions
- `driver.mjs`, `step.mjs`, `steps/common.mjs` in this folder. Run: `node driver.mjs` (background), then
  `node step.mjs steps/NN-….mjs`.

### Technical details
- Probe = CHB-026 `scripts/01-install-probe.js` body (toasts, rAF stalls > 100 ms); read with the `02-read-probe.js` logic.

## Step 2: S1 — open the negative, judge the first print, Time, Lighter/Darker, odd values

I opened File (menu: Open Files…, Open Folder…, Open As ›, Export… (disabled), Save Document, Find a Command…) and
then opened `landscape-negative.tif` through `#file`. The first print appeared with a strong blue-violet cast: the
white house walls lilac, the sky purple-blue, the foreground hills nearly black; the orange film edge on the left
is printed as a black band.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** S1 first half: open, judge, exposure, typed values.

**Inferred user intent:** See whether a darkroom printer can get to a decent print on the one-screen layout.

### What I did
- Opened the negative; inspected the film strip geometry; clicked Lighter ×1, Darker ×2; dragged the Time slider
  60 px; typed `7,5`, `abc`, `0`, `1000`, `12s` into the Time value box.

### Why
- Persona: he judges by the picture, pokes Lighter/Darker, types German decimals and junk.

### What worked
- Lighter/Darker change **Time** (4.45 → 3.54 → 4.45 → 5.61 s): real-enlarger behaviour; render done in 0.19–0.95 s.
- Time drag: one History row ("Time 5.61 → 23.0 s (+2.0 stops)"), render first 0.92 s / done 1.72 s, no stall.
- Typed values: `7,5` → 7.5 s (0.97 s render); `abc` → red box + toast "Time: “abc” is not a value. Type a time:
  15, 12s or 7,5 sets it. To change it, add a unit: +1/3 st, −2 s" (shots/06-typed-abc.png); `0` → clamped, toast
  "Time can't go below 0.1 s: set to 0.1 s"; `1000` → "Time can be at most 600 s: set to 600 s"; `12s` → 12.0 s.
  **F7 and F8 fixed** (no raw error codes; out-of-range is clamped with a plain message).

### What didn't work
- **K4 not fixed:** the darkroom film strip row is 24 px tall and its thumbnail canvas `ck-thumb-c` is 183×**2** px;
  the strip shows only the file name (shots/03-first-print.png).
- The Time slider is coarse: 60 px of drag = 5.61 → 23.0 s (two stops).
- First print colour: screen RGB sky (47,62,178), wall (104,94,180) at 12 s: strongly blue.
- My open-time watcher matched the wrong status element ("Saved"), so the open time was **not measured**; the
  picture was complete by the time the 120 s loop ended. Probe: one 217 ms stall during the open.

### What I learned
- The document (`chromobench.doc`) says `rebate: {x:94, y:1864, w:2900, h:128}`: the film edge was found along the
  **bottom** of the frame (the bright foreground of the negative), not the real edge on the left; `geometry.crop`
  is `null`. So the film base was read in the wrong place and the real edge stays in the print (P9-3).

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Rebate detection on this synthetic negative (uniform bottom rows): is the wrong base reading the cause of the
  blue first print? It may be partly an artefact of the synthetic material.

### What should be done in the future
- Re-run the open timing with a correct watcher (done for the roll in a later step).

### Code review instructions
- `steps/02-open.mjs`, `03-inspect.mjs`, `04-time.mjs`, `05-drag-type.mjs`.

### Technical details
- Range inputs: Time is log-scaled (`min 1, max 5.906891, step 1/6` = 2–60 s); typed values reach 600 s.

## Step 3: S1 — colour with filtration and printer lights; undo one too many and redo

He prints with a dichroic head, so for a blue print he takes yellow out. Dragging the Y filtration 40 px gave
−43 CC and a brown, muddy print; adding blue printer points made it worse. He hammered Undo three times (one too
many), then Redo once. Typing values gave a near-neutral print.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** S1 colour + undo/redo.

**Inferred user intent:** Colour correction in darkroom terms; recover from overshoot.

### What I did
- Dragged Filtration Y −40 px, Printer lights B +15 px; ⌘Z ×3, ⌘⇧Z ×1; typed Time `7,5`, Y `-15`, B `4`, Y `-25`, M `5`.

### What worked
- Undo/redo: toasts "Undo Printer lights", "Undo Filtration", "Undo Time", "Redo Time"; renders 40–175 ms (cached).
  Edit menu names the step ("Undo Printer lights", "Redo Time").
- Typed filtration/points accepted (`−15 CC`, `+4 pt`, `−25 CC`, `+5 CC`); final wall (174,160,169), near neutral
  (shots/11-settled-print-2.png).

### What didn't work
- Filtration slider coarse: 40 px = −43 CC (shots/07, 08). Renders for filtration grew from 1–2 s to 4–5 s "done"
  (SwiftShader).
- Two colour controls (Filtration CMY and Printer lights RGB) both act on colour; which one to use is not explained.

### What I learned
- Undo after a new edit drops the redo branch (normal).

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Why filtration renders took 4–5 s to "done" while time changes took ~1 s.

### What should be done in the future
- N/A

### Code review instructions
- `steps/06-colour.mjs`, `07-undo.mjs`, `08-settle.mjs`, `09-settle2.mjs`.

### Technical details
- Value fields: `input.cb-num` with aria-labels "Time value", "Filtration Y value", …; the per-layer amount fields
  are labelled `" value"` (empty name).

## Step 4: S1 — burn the sky, dodge the foreground, grade, a curve

Layer ▸ Add to Darkroom offers Burn, Dodge, Flash, Preflash, Density mask, Filter; the Enlarger's own "+ Layer"
button offers the same. A new Burn acts on the whole print until a mask is drawn; the Mask panel (far down the
right column) offers Linear, Radial, Brush, Luminance, Colour. A Linear drag on the sky made a graduated burn.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** S1 local work, contrast, one digital tool.

**Inferred user intent:** Darkroom burning/dodging habits must map onto the app.

### What I did
- Enlarger "+ Layer" ▸ Burn; scrolled to Mask; Linear; dragged top of sky → horizon; typed Stops `1`.
- "+ Layer" ▸ Dodge; Linear (first drag did nothing; second worked) from bottom up; Stops `1`.
- Dragged Grade 2.0 → 2.5. Opened "Digital (after the print)"; "+ Layer" ▸ Curve; dragged two points into an S.

### What worked
- Burn gradient: sky top (101,118,176) → (59,75,128), wall unchanged (shots/18-burn-gradient.png). History: "Added a
  burn (+½ stop)", "Mask drawn; Burn through a mask", "Burn: Stops 0.5 → 1.0 st".
- Dodge gradient lightened the foreground (shots/21-dodge-masked.png). Classic's Exposures panel later summed it up
  in darkroom words: "Expose 7.5 s, hold back Mask 2 for 3.75 s; burn Mask 1 7.5 s."
- Curve editor with histogram (shots/24-s-curve.png); point drags render first ≈0.57 s, done ≈2.9 s.

### What didn't work
- The first Linear click right after adding the Dodge did not arm the tool / the drag did nothing (render counter
  unchanged for 15 s); the dodge acted on the whole print, wall jumped to (238,231,237) (shots/19). Second try
  worked. Not reproduced deliberately (P9-2).
- **K2 reproduced:** History "Added curve1p3", "Added curve1p4".
- Jargon: Dodge description "max(E_main − Σ E_dodge, 0)"; mask "Reads: the darkroom stage's input / the source cut
  / the scan cut / the negative cut / the darkroom.main cut".
- The Mask and Layer panels are below the fold of the right column; he has to scroll to find "Linear".
- No on-picture handles show where a gradient lies.

### What I learned
- Masks are document-wide (`masks.items.m1`, `m2`) referenced by layers.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- The Linear tool arming race after adding a layer.

### What should be done in the future
- N/A

### Code review instructions
- `steps/10-burn-find.mjs` … `17-curve-edit.mjs`.

### Technical details
- Grade drag 40 px = 2.0 → 2.5; render done 3.1 s.

## Step 5: S1 — before/after, an accidental mask, crop/spot search, export

`\` shows a split Before | After (Before = the first print). But my click on the grey area above the print (to take
focus off a field) had silently drawn a **gradient mask on the Curve layer**: the Linear tool was still armed from
the dodge, and the Curve was now the selected layer. Edit ▸ "Undo Mask Curve (linear gradient)" took it back;
Escape disarms the tool (cursor crosshair → default).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** S1 last part.

**Inferred user intent:** Check the finishing steps exist on the one-screen layout.

### What I did
- Clicked at (670,120) (grey canvas above the print), pressed `\` twice, read View/Frame/Window/Edit menus; ⌘Z;
  Escape; ⌘K "crop", "spot", "dust"; File ▸ Export… ▸ TIFF 16-bit ▸ Export.

### What worked
- Before/after split with a draggable handle (shots/25-before-backslash.png).
- Menus: View has Before / After `\`, Side by Side `Y`, Fit, Actual Pixels (1:1), Zoom, Layout…, Theme. Frame has
  Flag/Reject, Rotate, Flip, Re-open as Photo, Remove from Library, Snapshot, Pin Probe, "Apply Print Settings to
  Selection".
- Export dialog: TIFF 16-bit / PNG 16-bit / PNG 8-bit; sRGB / Display P3 / Adobe RGB / ProPhoto RGB (shots/28).

### What didn't work
- **P9-1:** the armed mask tool + a click anywhere on the canvas = a new mask on whatever layer is selected
  (History "Mask drawn; Curve through a mask"; shots/25 shows "◐ Mask 3" on the Curve row).
- ⌘K "crop" and "spot": no results; "dust": only "Heal Dust on Open" (shots/27). **No crop, straighten or spot
  removal on the Darkroom-first screen.**
- Export button: status "exporting…" then "export cancelled" after 289 ms: headless Chromium's
  `showSaveFilePicker` aborts (test-harness limit like F27; `apps/studio/src/main.ts:832` treats AbortError as
  cancel). Measured the same pipeline into memory with `chromobench.exportPng('srgb','tiff16')` (measurement only):
  **25.9 s** for 3000×2000 16-bit, status "exported landscape-negative-print.tif · 3000×2000 · 16-bit sRGB", worst
  stall 317 ms. The export is the full 3000×2000 — **the film edge is in the exported print** (no crop).
- No JPEG in the export formats; no size choice.

### What I learned
- Before = the first print, not the raw inversion.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Whether a tool should disarm after one gesture, and whether a click outside the print should ever draw.

### What should be done in the future
- N/A

### Code review instructions
- `steps/18-before-after.mjs`, `19-crop-search.mjs`, `20-export-open.mjs`, `21-export.mjs`, `22-export-measure.mjs`.

### Technical details
- `packages/output/src/encode/sinks.ts:203` `pickerSink` → `showSaveFilePicker`.

## Step 6: S2 — switch to Classic in place; Print module, ring-around; Edit module, HSL

View ▸ Layout… shows eight buttons (Classic, Darkroom first [label clipped to "arkroom firs"], Simple, Lab, Tiny,
Roll, Finish, Looks) with no explanation. Classic opened on the Library grid with the photo still open and all
edits intact (**F24 fixed**). Print module = the darkroom; it has a Tools panel (Densitometer, Test strip,
Ring-around, Before / after) that Darkroom first does not show. The ring-around made colour easy.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** S2 first half.

**Inferred user intent:** Compare the module-based arrangement on the same job.

### What I did
- View ▸ Layout… ▸ Classic (switch 2.5 s); module Print (switch #1); Ring-around; picked "+Y (−B)"; module Edit
  (switch #2); "+ Layer" ▸ HSL; Saturation tab; dragged Blue +50 px.

### What worked
- Ring-around: 7 variants (+Y, +R, +M, +G, +C, +B and "Keep this one") plus density variants below, rendered in
  ~2 s (shots/34-ring-around.png). Picking "+Y (−B)" = one History row "Printer lights R +1 → −1, G −1 → −3,
  B +4 → +8 pt"; the wall went cream (209,191,160) (shots/35).
- Edit module: Print layers on the left, the Layer panel with the curve editor on the right (shots/36). HSL with
  Hue/Saturation/Lightness tabs and colour-coded sliders (shots/37).

### What didn't work
- **K2 reproduced:** "Added a hsl", "Hsl1b6 saturation 0 → 0.86".
- HSL description: "Hue, saturation and lightness per hue band in OkLCh (Lightroom's HSL panel); replaces the
  never-compiled finishing.hue." (developer text).
- Blue saturation +0.86 changed nothing visible: after the ring-around pick the sky was grey (68,70,75).
- Metadata panel in Library: "Frame frame_b56598db", "SHA-256 b56598db38e4f2ee…".
- "Edit", "Roll", "Finish" are both menu-bar menus and module tabs.
- The Classic film strip thumbnail was blank white in the Library right after the switch (shots/32), filled in
  the Print module (shots/33).

### What I learned
- Ring-around's "+Y (−B)" is labelled in filtration words but moves the printer lights.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- N/A

### Code review instructions
- `steps/23-layout.mjs` … `30-hsl-sat.mjs`.

### Technical details
- Module bar buttons: `.ck-module` (Library, Roll, Scene, Print, Edit, Finish, Assistant, Output).

## Step 7: S2 — colour grading, blend mode, group; Finish crop and spot; Output

(Written after an interruption: the session was paused by a usage limit after Step 6; the P9 phase agent asked
for the diary and report to be written before any further browser work. The browser driver had kept the page
alive, so the session continued on the same page.)

In Edit I added Colour grading, dragged a wheel, set its blend to Soft Light (the print went very contrasty:
hills black), and tried to put HSL and Colour grading in one group. Shift-click does not multi-select layers, so
⌘G grouped only Colour grading ("1 entries"); dragging the HSL row onto the group then moved it in. Finish has
Crop & straighten and Spot removal; the crop took off the film edge. Output is a stub.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** S2 second half.

**Inferred user intent:** Count module switches; check the finishing tools exist.

### What I did
- "+ Layer" ▸ Colour grading; dragged a wheel; Blend ▸ Soft Light; clicked HSL, shift-clicked Colour grading, ⌘G;
  dragged the HSL row onto the group.
- Module Finish (switch #3): clicked "Crop & straighten" (collapsed the panel by mistake), then Finish ▸ Crop &
  Straighten; dragged the left handle in 28 px; Enter. "Spots (Q)"; clicked a spot in the sky.
- Module Output (switch #4).

### What worked
- Wheel: "Colour grading: Hue 60 → 96 °; Colour grading: Strength 0.000 → 0.040"; render done 6.0 s.
- Blend: "Colour grading blend normal → soft-light" (shots/41-group.png).
- Drag into group: "Moved the hsl into a group".
- Crop: handles on the print, aspect kept (3000×2000 → 2904×1936), "Crop set", render done 8.0 s
  (shots/45-crop-mode.png, 47-spot.png). Spot: "Heal 1 at 1586, 303 · r 12" inside a new "Retouch" group,
  render 3.3 s.

### What didn't work
- Shift/⌘-click does not select several layers; ⌘G made a group of one ("1 entries").
- Colour grading description: "… in OkLab … weights (1 − t)², 2t(1 − t), t² of the lightness, a, b +=
  L·Σ w·chroma·(cos hue, sin hue) …" (formula in the UI).
- History: "Added a grade", "Moved the hsl into a group", "Added a group "Retouch"" for a healed spot (K2 family).
- **Output module is a stub:** "No photos yet: File ▸ Open Files…" although a photo is open, "Export, colour
  management and soft proofing come with CHB-011.", one button "Save PNG" (shots/48-output-module.png).
- Clicking a panel title ("Crop & straighten") collapses the panel — I thought it was the Crop button.

### What I learned
- The S2 job took **4 module switches** (Print, Edit, Finish, Output) after the layout opened on Library, plus
  File ▸ Export because Output cannot export TIFF. The Layer panel keeps showing the layer selected in another
  module (the Curve while in Print, HSL while in Finish).

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Soft Light on an adjustment layer: is the result (very contrasty) what Photoshop/Editor lab would give?

### What should be done in the future
- N/A

### Code review instructions
- `steps/31-grading-group.mjs` … `38-spot-output.mjs`.

### Technical details
- Crop result: `geometry.crop = {x:95, y:32, w:2904, h:1936}`.

## Step 8: S3 — a roll of four frames (Classic)

I stayed in Classic (it has a Roll module). The four frames opened in 3.5 s ("opening … (1 of 4)…" → "opened 4
files"), each at the same 4.45 s, so frames 3 and 4 (the denser negatives) printed nearly white
(shots/49-roll-opened.png). The Roll module could not make a roll at all. Frame ▸ "Apply Print Settings to
Selection" is the only sync, and it copies from the *last-clicked* frame, which wiped the frame I had made right.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** S3 roll workflow, Lightroom-style sync, roll-wide undo.

**Inferred user intent:** One frame right, the rest follow, one undo.

### What I did
- Roll module ▸ "New roll from open frames"; Roll ▸ New Roll from Open Frames; "First print…"; "Analyse";
  removed landscape-negative.tif (Frame ▸ Remove from Library) and retried.
- Print module: frame 3, Darker ×4 (12.6 → 31.75 s); shift-click frame 4; Frame ▸ Apply Print Settings to
  Selection; ⌘Z. Then click 3, ⌘-click 1, 2, 4; Apply; ⌘Z; ⌘⇧Z; ⌘Z. Then click 1, ⌘-click 2, 4, 3; Apply.

### What worked
- Opening four files at once: 3.5 s to "opened 4 files" (SwiftShader).
- One ⌘Z took back an Apply over three frames ("Undo Apply Print Settings"), redo re-applied it: roll-wide undo
  works. The Edit menu names the frame for a single-frame apply: "Undo Apply Print Settings (on roll-12-frame-3.tif)".
- Remove from Library: toast "Removed landscape-negative.tif: open the file again to get it back, with its edits".

### What didn't work
- **New roll fails every time:** red toast "That setting does not exist for this picture", detail `E_PATH:
  roll.rolls.roll-1: no "roll" in the root` (shots/50-new-roll.png); "Analyse" → "Make a roll first, or wait for
  the running analysis"; "First print…" → "Analyse the roll first". Same with 4 frames only.
- **Apply Print Settings copies from the primary = the last frame clicked** (shift- or ⌘-click moves the primary):
  frame 4's 7.07 s and printer lights went onto frame 3 (31.75 s lost) and frames 1–2 (now purple)
  (shots/55, 57). No dialog says which frame is the source or what will be copied (it copies everything,
  including each frame's colour). On the third attempt the ⌘-clicks apparently toggled the selection off and the
  menu item was disabled: "Select the frames to copy the settings to (and the source as primary)" (shots/58).
- The film-strip selection is hard to see (slightly lighter frame backgrounds).
- K1 (no Copy/Paste/Sync Settings in Classic and Darkroom first): known, fixed after this build per the P9 agent.

### What I learned
- The roll kit writes `t.$set(['roll','rolls',id], …)` (`packages/studio-kit/kits/roll/src/kit.ts:146`); the
  store of this layout has no `roll` root, hence E_PATH.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Whether the roll kit's state root is registered for the Classic layout in this build.

### What should be done in the future
- Re-test S3 on a build with the new Settings menu.

### Code review instructions
- `steps/39-roll-open.mjs` … `47-sync3.mjs`.

### Technical details
- Times read with `studio.doc(id).stages.darkroom.stack.items.main.params.time_s` (measurement only).

## Step 9: S4 — the camera DNG; GPU budget full; reload; Scene module

Back in Darkroom first (View ▸ Layout…; the 4 film-strip rows still have 183×2 px thumbnails, K4), the DNG failed
to render: "The picture could not be computed (a problem with the graphics card)", detail `E_GPU_OOM: source.…:
170624000 bytes do not fit the budget (532662224 of 536870912 live)`, and the **previous frame's picture stayed on
screen under the new name** (shots/59, film edge visible on a camera file). He reloaded the page: the library kept
all five frames ("not open", F5 fixed); clicking the DNG asked "Where is landscape-camera.dng?"; File ▸ Open then
opened it in 3.65 s as a photo (not inverted, F1 fixed), pinkish-violet.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** S4 camera file in both arrangements.

**Inferred user intent:** Know where scene corrections (exposure, white balance "before the film") live.

### What I did
- Darkroom first: opened the DNG; read the error; reloaded; re-opened; Layer menu; ⌘K "white balance", "film".
- Classic ▸ Scene module; "+ Layer" ▸ Exposure; dragged Stops.

### What worked
- After reload: open 1.5 s, first render 3.65 s; status "Photo · Synth Camera photo, 11 MP"
  (shots/61-dng-opened.png). Stages: scene, film, darkroom, print.
- Classic Scene module: "Scene (before the film)" stack; "+ Layer" offers Exposure, Curve, Levels, HSL,
  Vibrance, Colour grading, Channel mixer, Vignette. Exposure +1.83 stops (I grabbed the middle of the track, the
  thumb jumped) lightened the print; render done 2.3 s (shots/64-scene-adjusted.png).

### What didn't work
- **Darkroom first offers nothing before the film:** Layer ▸ Add to Darkroom / Add to Print only; ⌘K "white
  balance" finds nothing; the film stock is not on that screen either.
- **No white-balance control anywhere I looked:** the document has `scene.medium.whiteBalance {daylight, 5500 K}`
  but the Scene module shows only the layer stack and no layer type is "White balance".
- Exposure layer text: "Exposure in linear light: rgb · 2^stops + offset (Editor lab `exposure`, without its sRGB
  round trip and gamma)."
- With +1.8 stops the hills turned olive-yellow and the door magenta.

### What I learned
- The 512 MiB GPU budget filled with 5–6 frames open at 4000 px working size on SwiftShader; whether a real GPU
  has the same budget I did not check.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- E_GPU_OOM leaving the old picture under the new label; budget eviction of frames not on screen.

### What should be done in the future
- N/A

### Code review instructions
- `steps/48-dng-darkroom.mjs` … `52-scene-layer.mjs`.

### Technical details
- UI log entry: `{kind:'toast', text:'The picture could not be computed (a problem with the graphics card)',
  detail:'E_GPU_OOM: source.83df6e52: 170624000 bytes do not fit the budget (532662224 of 536870912 live)'}`.

## Step 10: Wrap-up — server stopped, report written

I closed the driver's browser (`steps/99-quit.mjs`), stopped the preview server on 5516, deleted the empty
`exports/` folder and the socket, and wrote the experience report with findings and the recommendation (S5).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Finish and hand back.

**Inferred user intent:** A decision on the default arrangement plus actionable findings.

### What I did
- Wrote `experience-report.md` (final), this step.

### What worked
- All of S1–S5 done; S3 only partly (the roll module is broken; sync tested through Frame ▸ Apply).

### What didn't work
- I took 63 screenshots, more than the 20–35 asked; the report embeds the important ones.

### What I learned
- Worst main-thread stall in the whole session: 483 ms (around the before/after toggle); most actions had none.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- Re-run S3 and S4 on a build with the Settings menu and the roll fix, on the real GPU.

### Code review instructions
- Read `experience-report.md` § Findings and § Recommended default arrangement.

### Technical details
- Profile (32 MB) stays in `profile/` (git-ignored).
