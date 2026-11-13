---
Title: Diary WS-C picture (session 03)
Ticket: CHB-031
Status: active
Topics:
    - ui
    - product
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://apps/studio/src/host/first-print.ts
      Note: FIRST_PRINT_AIM, photo first print, subject-failure rule (F31, F30)
    - Path: repo://apps/studio/src/status-text.ts
      Note: where the film base was read (ko8e)
    - Path: repo://packages/studio-kit/src/dom/arg.ts
      Note: Brightness, Warmth, Tint nudge titles (F25)
    - Path: repo://packages/studio-kit/src/model/enlarger.ts
      Note: withoutInert and StudioLog (srvr)
    - Path: repo://packages/studio-kit/src/model/orient.ts
      Note: strip frames flipV by default (F28)
    - Path: repo://ttmp/2026/11/12/CHB-031--cosplay-session-02-findings-enlarger-real-mode-by-default-open-as-panels-strip-frames-leftovers/scripts/wsc-01-compare-nlp.ts
      Note: first print vs colour-managed NLP positive (F30 numbers)
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-12T19:33:33.691724465-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary: CHB-031 round 2, WS-C — the picture (session 03 findings F31, F30, F28, F25, srvr, ko8e)

## Step 1: The assignment, orientation and a plan of attack

The orchestrator handed me workstream WS-C of CHB-031's second round: the picture. Two major findings from cosplay
session 03 (F31: a digital photo gets no automatic first print and opens dark; F30: a negative's first print is
cooler and flatter than Negative Lab Pro's, an owner decision), one minor (F28: the Epson strip's frames open
sideways), F25 (Simple shows an inert Time row and two rows titled "Printer lights") and two leftovers (srvr: no inert
control in the edit log; ko8e: the decode note "film edge found" when a strip's base came from the gaps).

I read the common brief, the plan's "Round 2" section, the session 03 findings and experience report, the first
print (`apps/studio/src/host/first-print.ts`), `main.ts`'s `initial` hook, studio-kit's `initialInMode`
(`model/enlarger.ts`), the strip frame build (`bridge/frames.ts`, `model/orient.ts`), `decodeScan` and WS-B's diary
step 3 (strip orientation `transpose`) and step 7 (base from the gaps). F31 is confirmed in code: `main.ts`'s
`initial` sends `digital-raw` frames to `photoRecipe` (a fresh `defaultRecipe`, 10 s f/8, as-shot white balance)
and never to `firstPrint`; `photoRecipe` also drops the layout's enlarger mode that `initialInMode` put on the
defaults (harmless today because `initialInMode` re-applies the mode afterwards, but it would matter as soon as the
photo's density is measured in that mode).

### Prompt Context
**User prompt (verbatim):**

> You are implementing CHB-031 round 2, workstream **WS-C: the picture** (session 03 findings F31 and F30, both major, plus F28, F25 and two leftovers).
>
> Read first: the common brief /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/brief-common-v2.md (rules, checks, diary format, final reply; its "Additions" section matters; read "CHB-027" there as CHB-031). Your spec: `ttmp/2026/11/12/CHB-031--cosplay-session-02-findings-enlarger-real-mode-by-default-open-as-panels-strip-frames-leftovers/design-doc/01-plan.md`, section "Round 2", WS-C. The findings with repro: CHB-026 `various/02-findings.md` (section "Session 03", F24–F37, including the orchestrator's checks of F30 and F31) and `sessions/03-sonnet-rerun-session-02/` (experience report, diary, scripts, screenshots; `shots/62b-…colour-managed…png` is the F30 comparison). Background: the first print `apps/studio/src/host/first-print.ts` and its tests; the CHB-031 WS-A diary `diary/02-diary-ws-a-enlarger-and-controls.md` (real enlarger mode, layouts' enlarger option) and WS-B diary `diary/03-…` (strip orientation default, gap base).
>
> Your specifics:
> - You are in a fresh git worktree made from main. First: `git checkout -b task/chb-031-picture`; `pnpm install --offline` if node_modules is missing.
> - Diary (exists, write in it): `ttmp/2026/11/12/CHB-031--…/diary/04-diary-ws-c-picture-session-03.md` — the diary skill's investigation format exactly (read /home/manuel/.claude/skills/diary/SKILL.md and references/investigation-entry.md); Step 1 quotes this prompt verbatim; every step has all sections; write as you go and commit with the code.
> - Screenshots: `…/CHB-031--…/various/ws-c/` (synthetic fixtures only; screenshots or numbers from the private photos/scans stay in the scratchpad or are reported as numbers only).
> - Ports: preview 4711; browser tests STUDIO_PORT=5221 STUDIO_KIT_PORT=5222 SHELL_DEMO_PORT=5223 GPU_PARITY_PORT=5224.
> - Tasks to check off when done (`docmgr task check --ticket CHB-031 --id …`): nj2u (F31), bey6 (F30), s7hd (F28), 88jx (F25), srvr, ko8e.
>
> Priorities:
> 1. **F31:** a digital photo opens through an automatic first print in its enlarger mode (real: density into the time; normalised: into the lights) while keeping the camera's as-shot white balance for colour (no integrate-to-grey colour on a photo). Unit test with a synthetic photo, and a local check (skipped when the file is absent) that a daylight NEF from `~/Downloads/2026-11-11 - manfred test bilder/` (e.g. DSC_8559.NEF) no longer opens dark: report its luma and time before/after in the diary.
> 2. **F30 (owner decision pending, do NOT change the default):** make the first print's colour share (alpha) and any subject-failure rule one named setting in one place; write `ttmp/2026/11/12/CHB-031--…/scripts/wsc-01-compare-nlp.mjs` (or similar) that renders a scan frame the way the app's first print does and compares it with the colour-managed NLP positive (`.playwright-mcp/scans/2025-08-09_raw0NN-positive.tif`, ProPhoto RGB → sRGB; the orchestrator's conversion is described in the findings' "Orchestrator checks"), printing B/R, saturation, luma mean/std for alphas 1, 0.75, 0.5, 0.25 and, if you implement it, a subject-failure variant (e.g. excluding saturated or extreme pixels from the integration, as lab printers do). Put the table in the diary for the owner.
> 3. **F28:** why the Epson strip `.playwright-mcp/scans/2025-08-09_raw000.dng` opens sideways while raw010 opens upright; fix the default; library frames keep their stored orientation.
> 4. **F25**, then **srvr** and **ko8e** (see the plan).
>
> Since CHB-032 merged: `RefEngine` requires `data` (`nodePacksData()` in Node tests); e2e specs that open files use `opened()` from `e2e/support.ts`; specs write screenshots to `test-results/`, never into `ttmp/`.
>
> Parallel work: WS-D (interface) edits `apps/studio/src/main.ts` (dialogs, layout switch), studio-kit history/messages, view commands, `packages/studio-kit/src/cb.ts`. Your `main.ts` edit is the `initial` hook: keep it small and local; keep `cb.ts` edits local. The orchestrator merges you first.

**Assistant interpretation:** Fix the photo's first print (F31) properly and measurably; make the negative first
print's colour aim a single named, overridable setting and give the owner numbers against Negative Lab Pro without
changing the default (F30); find and fix the Epson strip's orientation (F28); then the Simple layout's Time row and
row titles (F25), the remaining inert-control paths in the edit log (srvr) and the decode note wording (ko8e).
**Inferred user intent:** The photographer's first impression of a picture (brightness and colour) should be right
out of the box, and the owner gets the evidence to choose the negative's colour aim.
**Commit (code):** N/A (orientation).

### What I did
- Created the branch `task/chb-031-picture` (node_modules present; no install needed).
- Read the brief, the plan (Round 2, WS-C), CHB-026 findings "Session 03", the session 03 experience report;
  `first-print.ts`, `main.ts` (`photoRecipe`, `startEngine`'s `initial`), `studio-kit/src/model/enlarger.ts`
  (`initialInMode`), `bridge/frames.ts` (`build`, `stripFrameRecipe`), `model/orient.ts` (`stripOrientation`),
  `host/decode.ts` (`decodeScan`, `gapBase`), `status-text.ts` (the "film edge found" rule), `core/print/balance.ts`
  (`integrateToGrey`: ℓ = ℓ_aim + m + α(Δ − m)).
- Checked the private material is present: `~/Downloads/2026-11-11 - manfred test bilder/DSC_8559.NEF`,
  `.playwright-mcp/scans/2025-08-09_raw000.dng` and its `-positive.tif`; Python 3 has Pillow 12.1.1 with ImageCms and
  NumPy 2.4.2 (for the ProPhoto → sRGB conversion).

### Why
- F31 and F30 are the two major findings and both sit in `first-print.ts`; doing F31 first gives the setting F30
  needs (a per-kind colour share) a natural home.

### What worked
- The code paths are short and the findings' pointers are right (`main.ts` `initial`, `photoRecipe`).

### What didn't work
- No failures in this step.

### What I learned
- `integrateToGrey` with α = 0 corrects the density only (every light moves by the mean m): exactly "density from
  the frame, colour from the camera" for a photo. With α = 1 the frame averages to grey.
- `firstPrint` already handles both enlarger modes (real: the mean into the time on a 1/6-stop grid; normalised: all
  into the lights).
- Strip frames get their orientation in `frames.ts` `build` from `stripOrientation(boxes)`: `transpose` only when the
  strip runs top to bottom *and* most boxes are wider than tall.

### What was tricky to build
- Nothing built yet.

### What warrants a second pair of eyes
- `photoRecipe` rebuilds the recipe from `defaultRecipe` and so drops the enlarger mode `initialInMode` set: a photo
  first print must measure in the layout's mode or a normalised layout would get its density in the (inert) time.

### What should be done in the future
- N/A

### Code review instructions
- Start with `apps/studio/src/host/first-print.ts` and `apps/studio/src/main.ts` `startEngine`.

### Technical details
- Session 03's numbers to beat: DSC_8559.NEF at 10.0 s f/8, luma 57/255 (F31); Epson frame 2 B/R 1.21 vs NLP 0.62
  colour-managed, saturation 0.21 vs 0.46 (F30).

## Step 2: F31 — a photo's first print: density from the frame (half way from the camera's), colour from the camera

A photo now goes through `firstPrint` like a negative, with its own aim: colour share α = 0 (the camera's as-shot
white balance stays the colour) and a density share of 0.5 (half way from the camera's exposure to the frame's
integrated grey). The density goes into the time in real mode and into the three printer lights together in
normalised mode, as for a negative. The first version used the full density share (1), the same integrate-to-grey a
negative gets. On the daylight truck (DSC_8559.NEF) that took the time from 10 s to 3.5 s and the luma from 57.6 to
161: correct by the rule, but washed out to the eye. Six more of his NEFs showed the same in every scene with large
shadows, and both night scenes printed as dusk. That is a lab printer's "density failure", and a camera has already
metered the scene, so a photo keeps half its exposure.

With 0.5 the truck opens at 5.6 s, luma 105 (the tester asked for "two-thirds of a stop more light": 6.3 s, luma
98), and the colour is unchanged (B/R 0.635 → 0.640). Making the shares mean what they say also needed a fix in the
pass loop. Pass 2 re-applied α to the colour left over by pass 1, so α = 0.75 really corrected 1 − 0.25² ≈ 94 %.
Each pass now re-aims from the frame's departure at the start.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Photos get an automatic first print in their enlarger mode, with the camera's colour,
and open near the aim instead of dark.
**Inferred user intent:** The first impression of a digital photo is a good print, not a fixed 10 s.
**Commit (code):** in the commit of Steps 2–4 ("CHB-031 WS-C: F31 photo first print, F30 first-print aim setting
and NLP comparison, F28 strip frames flipV"; hash in Step 5).

### What I did
- `apps/studio/src/host/first-print.ts`: `FirstPrintAim` {density, alpha, subjectFailure}; `FIRST_PRINT_AIM` per
  kind (negative {1, 1, null}, photo {0.5, 0, null}); `firstPrintAim(kind, param)` with the page overrides
  `?alpha`, `?subjectFailure` (negatives) and `?photoDensity` (photos); `photoRecipe` moved here from `main.ts`, now
  keeping the enlarger mode of `d` (the layout's); `firstPrint` takes `aim`, each pass computes the departure at the
  start `D0 = delta − off` (off = lights − lights0 + log10 t/t0) and sets the exposure offset to
  `integrate(−D0, α) + (1 − density)·mean(D0)`.
- `apps/studio/src/main.ts` (`initial` hook only, plus removing the unused `defaultRecipe` import and the moved
  `photoRecipe`): photos go to `firstPrint(photoRecipe(d, asShot))`, both kinds get `aim: firstPrintAim(r.kind, q)`.
- Tests: `apps/studio/test/first-print-aim.test.ts` (new, 9 tests): the setting and its overrides; α is the colour
  share for 2 and 3 passes; a synthetic warm photo in real mode (time moves, three lights equal, mean exposure half
  way to the aim, colour within 0.005 of the unprinted frame's; density 1 lands at the aim with the colour kept) and
  in normalised mode (time 10 s, lights equal, half the density); `photoRecipe` keeps the mode and as-shot; the local
  NEF check (skipped without the file). `enlarger-mode.test.ts`: its "both print the frame at grey" now expects each
  kind's aim. `e2e/studio-enlarger.spec.ts`: a photo opened in classic has `auto` {integrate, α 0} and three equal
  lights.
- Looked at the prints privately: `scratchpad/wsc/nef-look.ts` renders a NEF at 10 s, 6.3 s and the first print
  (RefEngine tabulated, 640 px, as the CPU engine), `nef-stats.ts` prints exposure statistics; grids of 7 NEFs in
  `scratchpad/wsc/priv/` (never committed).

### Why
- α = 0 is "no integrate-to-grey colour on a photo" exactly: core's integrateToGrey moves every light by the mean.
- Density share 0.5 instead of 1: evidence below; an alternative "trust the camera plus an ISO-12232 offset" (middle
  grey at 12.8 % of clipping, a fixed 7.1 s) failed the high-key DSC_8688 (10 s looked right, 6.3 s too light),
  which the half share keeps at 10 s.

### What worked
- `npx vitest run apps/studio/test/first-print-aim.test.ts -t DSC_8559 --reporter=verbose`:
  `DSC_8559.NEF 640×428: before 10 s, luma 57.6 (RGB 69.2/54.3/44.0, B/R 0.635); after 5.612 s, lights 0.022799
  0.022799 0.022799, luma 105.1 (RGB 124.1/100.4/79.5, B/R 0.640)`. Session 03's screenshot had luma 57.
- `pnpm typecheck`, `pnpm lint` and `pnpm test` green (102 files, 2780 passed, 7 skipped).

### What didn't work
- The full density share (my first version): `DSC_8559.NEF … after 3.536 s … luma 161.2`, washed out by eye. Per
  photo, full share vs half share vs the old 10 s (luma): 8559 3.54 s 161 / 5.61 s 105 / 58; 8541 (tungsten room)
  3.15 s 155 / 5.61 s 102 / 62; 8536 (evening) 2.23 s 135 / 4.45 s 61 / 31; 8655 (night, fire truck) 2.23 s 132 /
  5.0 s 62 / 29; 8688 (late daylight) 8.91 s 164 / 10 s 161 / 153; 8583 3.15 s 144 / 5.61 s 84 / 49; 8515 (dusk)
  3.54 s 141 / 5.61 s 90 / 52.
- The statistic is not the cause: for 8559 the exposure needed by the linear mean (today's), the log mean and the
  median were 3.54, 4.01 and 3.92 s. It is the aim: integrating to grey lifts large shade to mid-grey.
- The enlarger-mode test failed as expected once photos kept their colour: `expected 0.021532327849728933 to be less
  than 0.01` (the photo's colour departure); updated to each kind's aim.

### What I learned
- The paper-side integrated exposure is dominated by the scene's shadows (thin negative, much light), so an
  integrating printer prints dark scenes light; for a negative there is no better reference, for a photo the camera's
  metering is one.
- `firstPrint`'s second pass compounded α (pass 2 measured the remainder and corrected α of it again). Harmless at
  α = 1 (all previous use) but wrong for any other share.

### What was tricky to build
- Re-aiming per pass: the state's exposure offset relative to the start is lights − lights0 plus the time's log
  ratio; the frame's own departure is then `delta − off` (exact for a log-linear chain, refined by the next pass
  otherwise). With density and α both 1 this reduces to the old update, so negatives are unchanged (host.test.ts and
  the CHB-010 bake test unchanged and green).

### What warrants a second pair of eyes
- The density share 0.5 is a judgement from 7 of his photos at 640 px on the CPU engine; the owner may prefer
  another (`?photoDensity=` tries one without a rebuild). The GPU engine's first print uses the same code.
- `photoRecipe` now keeps the layout's enlarger mode; before, `initialInMode` re-applied it after the fact.

### What should be done in the future
- A night or high-key scene may still want a manual correction; the History shows the first print as an auto step.

### Code review instructions
- `apps/studio/src/host/first-print.ts` (`FIRST_PRINT_AIM`, `firstPrintAim`, `photoRecipe`, the pass loop),
  `apps/studio/src/main.ts` `startEngine` `initial`.
- `npx vitest run apps/studio/test/first-print-aim.test.ts apps/studio/test/enlarger-mode.test.ts apps/studio/test/host.test.ts`

### Technical details
- Per pass: `off_k = lights_k − lights_0 + log10(t_k/t_0)`; `D0 = delta_k − off_k`;
  `target = −m(D0)·density − α·(D0 − m(D0))`; real mode: `t = gridTime(t0·10^mean(target))`, `lights = lights0 +
  target − log10(t/t0)`; normalised: `t = t0`, `lights = lights0 + target`.

## Step 3: F30 — the first print's colour aim as one setting, and Negative Lab Pro side by side

The negative's aim (colour share α and an optional subject-failure rule) is now `FIRST_PRINT_AIM['negative-scan']`
in `first-print.ts`. The default is unchanged ({density 1, α 1, no rule}). The page overrides `?alpha=0.75` and
`?subjectFailure=1` (or `chroma:0.1,trim:0.02`) let the owner try another aim in the app. `LAB_SUBJECT_FAILURE`
leaves out pixels of a strong colour (max |x_k − mean| > 0.1 log H, judged on the print of each pass) and the darkest
and brightest 2 %; it keeps every pixel when it would keep fewer than 5 %.

`scripts/wsc-01-compare-nlp.ts` renders a frame of a scan the way the CPU engine's first print does and compares it
with NLP's positive, colour-managed. It runs on the four frames that have a positive. **For the owner, the result:
α is not the lever on his Epson scans.** On raw000 frame 2 (session 03's frame) every α from 1 to 0 gives B/R
1.16–1.19 against NLP's 0.57. The frame averages near grey already at lights 0, so integrate-to-grey changes little.
On the indoor blanket (raw007 f2) α 0 matches NLP; on the blue-sky highway (raw013 f2) a lower α makes it bluer. A
warm aim of 0.05–0.10 log H (red light −, blue light +) brings all four frames into NLP's range. NLP also has more
contrast (luma std 51–67 vs 33–49), which no colour aim changes.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** One named setting for the first print's colour share and subject-failure rule (default
unchanged), and a script with the numbers against the colour-managed NLP positives.
**Inferred user intent:** The owner decides the first print's colour aim from evidence.
**Commit (code):** in the commit of Steps 2–4 (hash in Step 5).

### What I did
- `first-print.ts`: `SubjectFailure` {chroma?, trim?}, `LAB_SUBJECT_FAILURE`, `keptPixels`, `integratedExposure(x,
  n, stride, sf)`, `measureExposure(…, sf)`; three passes with a rule (it picks its pixels on the corrected print).
- `ttmp/…/scripts/wsc-01-compare-nlp.ts`: decodeScan at 640 px (no dust), RefEngine tabulated and sampled,
  `stripFrameRecipe` with `stripOrientation`, `withMeasured`, real mode, `firstPrint` per variant; reads the display
  node below `output.frame` over the crop and orients it (`orientPixels`); NLP's 16-bit TIFF via ingest's
  `decodeAsync`, ROMM decode (v < 16/512 → v/16, else v^1.8), ProPhoto → XYZ D50, Bradford D50 → D65, XYZ → sRGB,
  clip, encode; statistics over the central 80 % of each. Variants: α 1, 0.75, 0.5, 0.25, 0; α 1 and 0.75 with
  `LAB_SUBJECT_FAILURE`; and, not a setting, α 1 with the aim warmed by 0.05/0.10/0.15 log H.
- Ran it on raw000 f2, raw004 f3, raw007 f2, raw013 f2 (the frames NLP converted; raw010's positive is not a frame of
  `~/Downloads/raw010.dng`). Pictures (PPM) only in `scratchpad/wsc/priv/`.
- Tests in `first-print-aim.test.ts`: the rule leaves out strong colours and trims extremes, falls back with too few
  pixels; on a frame half grey, half strong green, α 1 turns the grey half off-grey (spread > 0.1 log H) and α 1 with
  the rule keeps it grey (< 0.01).

### Why
- A single record per kind in one file: main.ts, the tests and the script read it; the URL overrides let the owner
  look at another aim in the real app without a build.
- The warm-aim rows answer the question the α rows raise ("then what would it take?").

### What worked
- The script's NLP numbers agree with the orchestrator's colour-managed check (raw000: B/R 0.569, saturation 0.498,
  luma 153 ± 54 over the central 80 %; his 0.62, 0.46, 153 ± 52 over the whole picture).
- Runtime about 17 s per frame.

### What didn't work
- `LAB_SUBJECT_FAILURE` does not move these frames towards NLP: raw000 1.169 (α 1: 1.156), raw004 1.109 (1.102),
  raw007 1.024 (1.024: the blanket's colour is under 0.1 log H), raw013 1.323 (1.143: bluer).
- α 0.75 with the rule changed the density on raw007 (2.227 s, luma 162.5): with α < 1 the remaining colour exceeds
  0.1 log H and the rule drops a different set of pixels. A rule for the colour should not pick the density's pixels;
  noted for the owner, not changed.

### What I learned
- NLP's warmth is not one offset: B/R 0.49 (blanket), 0.57 (sunny brick), 0.77 (overpass), 0.92 (blue-sky highway).

### What was tricky to build
- Matching the app's frame: the strip working size (`stripScale`), the base from the gaps and the frame's crop all
  come from `decodeScan`; the script uses the same functions, so it follows the app when those change.

### What warrants a second pair of eyes
- The saturation definition (HSV (max − min)/max, pixels with max ≥ 8) is mine; the tester's is not recorded.
  Relative comparisons hold.

### What should be done in the future
- Owner decision (F30, with F37): keep the neutral aim, or a warm aim of about 0.05–0.10 log H; contrast (paper grade
  or tone) is a separate question. Then set `FIRST_PRINT_AIM` (one line) and check off with the numbers here.

### Code review instructions
- `node ttmp/2026/11/12/CHB-031--*/scripts/wsc-01-compare-nlp.ts [--scan … --frame N --shots <scratchpad dir>]`
  (skips without the files).
- `first-print.ts` `keptPixels`, `integratedExposure`.

### Technical details
B/R of the mean sRGB (saturation; luma mean ± std) over the central 80 %, CPU engine at 640 px, real mode:

| Frame (NLP's) | α 1 (default) | α 0.75 | α 0.5 | α 0.25 | α 0 | α 1 + rule | warm 0.05 | warm 0.10 | warm 0.15 | NLP |
|---|---|---|---|---|---|---|---|---|---|---|
| raw000 f2, sunny brick and concrete | 1.156 (0.19; 140 ± 43) | 1.165 | 1.173 | 1.182 | 1.192 (0.21) | 1.169 | 0.938 | 0.769 (0.30) | 0.634 (0.41) | 0.569 (0.50; 153 ± 54) |
| raw004 f3, overpass | 1.102 (0.14; 137 ± 49) | 1.071 | 1.041 | 1.012 | 0.985 (0.15) | 1.109 | 0.896 | 0.737 (0.32) | 0.610 (0.43) | 0.769 (0.32; 151 ± 67) |
| raw007 f2, camera on a blanket (indoors) | 1.024 (0.15; 138 ± 42) | 0.888 | 0.769 | 0.662 | 0.569 (0.43) | 1.024 | 0.813 | 0.648 (0.35) | 0.517 (0.48) | 0.491 (0.51; 141 ± 60) |
| raw013 f2, highway under blue sky | 1.143 (0.23; 134 ± 33) | 1.225 | 1.316 | 1.419 | 1.536 (0.32) | 1.323 | 0.911 | 0.735 (0.29) | 0.597 (0.42) | 0.921 (0.35; 134 ± 51) |

Mean B/R over the four: α 1 1.106, α 0 1.071, warm 0.05 0.890, warm 0.10 0.722, NLP 0.688. Times: raw000 5 s,
raw004 2.5 s, raw007 2.5 s, raw013 3.97 s (unchanged by α).

## Step 4: F28 — the Epson strip's frames: his strips are scanned upside down, so landscape frames want flipV

The plan suspected WS-B's default did not apply to raw000. It does apply: raw000's boxes are wide (639 × 442) on a
vertical strip, so `stripOrientation` returns `transpose`, the same as for raw010. The default itself is wrong for
raw000. Its frames are landscape pictures, and NLP's positive of frame 2 matches `flipV`: mirrored, as scanned
through the base, and upside down. raw010's are portraits (camera turned), which is why `transpose` suited raw010
alone. The camera's hold varies per frame (NLP positives: 3 landscape, 2 portrait). Nothing in a strip's geometry
says how the camera was held, and the content rules I measured (the brightest or the bluest edge goes up) were right
on 4 and 6 of 9 frames, not good enough for a default.

So the default is now his most common case: wide frames on a vertical strip open `flipV`. On the five strips I could
judge, it was right for 5 of 9 frames against 1 of 9 for `transpose`; the portraits open sideways and one Rotate
fixes each. Frames already in a library keep their stored orientation, because a saved log never takes the default;
a new test pins that.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Find why raw000 opens sideways while raw010 is upright; fix the default without
changing frames already in a library.
**Inferred user intent:** His strips open readable without a rotate per frame.
**Commit (code):** in the commit of Steps 2–4 (hash in Step 5).

### What I did
- `scratchpad/wsc/strip-orient.ts`: decodes a strip as the app does and writes each frame in any orientation (PPM,
  private); contact sheets of all frames of raw000, raw004, raw007, raw013 and `~/Downloads/raw010.dng` as scanned,
  with the NLP positives; frame 2 of raw000 in all eight orientations; raw013 f2 in `transverse` and `ccw90`.
- `edges.py` (scratchpad): luma and blueness of each 15 % edge band, to test "the sky edge goes up".
- `packages/studio-kit/src/model/orient.ts`: `stripOrientation` returns `flipV` for wide frames on a vertical strip;
  the comment records the evidence.
- `packages/studio-kit/test/open-strips-library.test.ts`: `flipV` default; Rotate Right → `transpose`, Rotate Left
  ×2 → `transverse`, Flip → `rot180`, undo; new: a library frame saved with `transpose` (and one with `cw90`)
  resumes with it while the third gets `flipV`. `studioWith` takes a `kv`.
- `e2e/studio-open-strips.spec.ts`: `flipV`, Rotate Right → `transpose`, Rotate Left → `flipV`.

### Why
- The landscape hold is his normal one; a portrait opening sideways is what he gets in NLP and Lightroom too.

### What worked
- Mirror confirmed twice against NLP: raw000 f2 = `flipV`, raw013 f2 = `transverse` (the cones in the left lanes;
  `ccw90` puts them right). raw010 f3 = `transpose` (WS-B, sign text).
- `npx vitest run packages/studio-kit/test/open-strips-library.test.ts`: 10 passed.

### What didn't work
- Edge rules on the 9 frames whose up I could judge: the brightest edge was right on 4 (sunlit road at the top of
  raw000 f2, sky beside the subject on raw000 f3 and raw013 f2), the bluest edge on 6 (wrong indoors and where sky is
  beside the subject). Not used.

### What I learned
- By eye, as scanned: raw000 f1, f2, raw004 f3, raw013 f1, f3 have the bottom edge up (`flipV`); raw000 f3, raw007
  f2, raw013 f2 the right edge (`transverse`); raw010 f3 the left edge (`transpose`); the rest unclear (dark, or a
  top-down view).

### What was tricky to build
- Orientation algebra: the commands compose as new = R·current (y down). Rotate Right on `flipV` is
  [0,−1;1,0]·[1,0;0,−1] = [0,1;1,0] = `transpose`; the tests confirm it.

### What warrants a second pair of eyes
- raw010's frames now open sideways on a fresh open (they were the one strip `transpose` suited); its library frames
  keep `transpose`. The session 04 check should look at both strips.

### What should be done in the future
- A per-frame "which way is up" guess from the content (faces, text, sky) would remove the remaining rotates; not a
  heuristic of a few lines.

### Code review instructions
- `packages/studio-kit/src/model/orient.ts`; `frames.ts` `build` (a saved log never takes `defaults`).
- `npx vitest run packages/studio-kit/test/open-strips-library.test.ts`

### Technical details
- Boxes at 640 px (working strip): raw000 639×440/442/440, raw004 639×441/438/441, raw007 638×434 ×2, raw013 640×446
  ×3, raw010 639×432/437/437; all three frames along y. NLP positives: raw000 1466×1041, raw004 1477×1071, raw007
  1061×1488, raw010 1483×1073, raw013 1058×1476.

## Step 5: F25 — Simple's time row says "Brightness" in normalised mode; the lights rows are "Warmth" and "Tint"

Steps 2–4 were committed as `625ba21` with typecheck, lint and the unit suite green. In Simple, the Lighter/Darker
nudge is a `cb.nudge('print.enlarger.time_s')`. WS-A kept it visible in normalised mode because its buttons move
the three lights there, but its head still read "Time 10.0 s, 0 st", a value that never moves. The two colour nudges
took the ArgSpec label "Printer lights". Now, in normalised mode, the time nudge's title is "Brightness" with no
seconds and no stops, and its tooltip says why. In real mode (a frame printed in Classic) it stays "Time" with its
value. A lights nudge along an axis takes its title from the axis: "Warmth" (yellow–blue) and "Tint"
(magenta–green). The fix is generic in `dom/arg.ts`, so `simple.js` and the variant snapshots are untouched.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Hide the inert time row in Simple's normalised mode; distinct titles for the two rows.
**Inferred user intent:** No control on screen that looks alive and never moves; rows that say what they do.
**Commit (code):** in the commit of Steps 5–8 (hash in Step 9).

### What I did
- `packages/studio-kit/src/dom/arg.ts`: `AXIS_LABEL` ({yellow-blue: Warmth, magenta-green: Tint}) as the default
  label of an axis nudge; `NORMALISED_TIME` (title "Brightness" and a tooltip); in the `m.cell` effect a time nudge
  shows that title and clears its readout and aside while the recipe is normalised.
- `e2e/studio-enlarger.spec.ts` (simple test): the time row's title is "Brightness", its readout empty, no " s" in
  the row; the lights rows read ["Warmth", "Tint"]; a screenshot to `test-results/`.

### Why
- Hiding the whole nudge would also hide Lighter/Darker, the one exposure control in Simple; the row's head is what
  was wrong.

### What worked
- In the built app (Step 8, B): titles `["Brightness","Warmth","Tint","Grade"]`, the row's text "Brightness◀ Lighter
  Darker ▶"; Lighter moved the three lights by 0.100 log H (−0.118 → −0.219), time 10 s.

### What didn't work
- My first label expression `p['label'] ?? (cond && AXIS_LABEL[…]) ?? model.label` would have given `false` for
  every control that is not a nudge (`??` keeps `false`); caught on reading it back, before any run.

### What I learned
- Only `simple.js` uses `cb.nudge`; no other variant changes.

### What was tricky to build
- The title must follow the frame: a real-mode frame opened in Simple keeps "Time" and its seconds, so the label is
  set in the cell effect on every recipe change, not at mount.

### What warrants a second pair of eyes
- WS-D works on wording; "Brightness", "Warmth" and "Tint" are new visible words.

### What should be done in the future
- N/A

### Code review instructions
- `packages/studio-kit/src/dom/arg.ts` (`AXIS_LABEL`, `NORMALISED_TIME`, the end of `renderArg`).
- `e2e/studio-enlarger.spec.ts` test "simple: normalised by default…".

### Technical details
- Screenshot: `various/ws-c/wsc-02-simple-print-brightness-warmth-tint.png` (synthetic negative).

## Step 6: srvr — no inert control enters the edit log, whoever writes

WS-A hid the inert controls (time, aperture, magnification in normalised mode) and made `cb.arg` refuse to write
them. Other writers could still record them: the looks kit's "print density" and "warm print" looks set
`print.enlarger.time_s`, agent proposals can set any path, and so can a script. Each frame's log is now a
`StudioLog`, a subclass of the contract's EditLog in `model/enlarger.ts`. Its `apply`, `propose` and `preview`
pass the mutations through `withoutInert`: on a normalised recipe a write to time, f-stop or magnification becomes
the same exposure on the three printer lights (core's optics law, as Lighter/Darker do), and the optics keep their
value. The looks kit's `planFrame` runs the same function, so its tiles, its confirm card and the batch it applies
agree. The DSL's time test strip already moved the lights in normalised mode (`stripRecipe`, WS-A), so it needed
nothing.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Enforce "no inert control in the edit log" beyond the controls: looks, agent proposals,
the DSL's time strip.
**Inferred user intent:** The History never shows a Time change that did nothing; a look or a proposal that means
"darker" still makes the print darker in normalised mode.
**Commit (code):** in the commit of Steps 5–8 (hash in Step 9).

### What I did
- `packages/studio-kit/src/model/enlarger.ts`: `opticsShift(r, path, value)` (log t − 2 log N − 2 log (m + 1)
  against the recipe's own; a null magnification is the reference 8×), `withoutInert(r, ms)` (in order, with a
  running recipe, so a mode change earlier in the list counts; an `expect` on the time becomes one on the lights;
  a zero shift or a non-number writes nothing), `StudioLog` (`make` = EditLog.create's record as a StudioLog;
  overrides `apply`, `propose`, `preview`).
- `packages/studio-kit/src/bridge/frames.ts` (`build`): `new StudioLog(saved, opts)` / `StudioLog.make(…)`.
- `packages/studio-kit/kits/looks/src/engine/plan.ts` (`planFrame`): `withoutInert(recipe, res.mutations)` before the
  preview recipe and the diff.
- `packages/studio-kit/test/enlarger-mode.test.ts`: three tests (withoutInert cases; StudioLog apply/propose/preview
  on normalised and real; a studio frame's log is a StudioLog and "print density" on a normalised frame plans and
  applies lights, the time stays 10 s).

### Why
- One funnel instead of four call sites (route.apply, applyMutations, applyBatch, studio.propose, the agent's replay
  in `packages/agent/src/worker/client.ts` all end in the frame's log). The contract's EditLog stays untouched; the
  agent's worker already subclasses it the same way.
- Translating rather than refusing: "a stop darker" from a look or the agent keeps its meaning.

### What worked
- `npx vitest run packages/studio-kit/test/enlarger-mode.test.ts packages/studio-kit/test/looks`: 47 passed.

### What didn't work
- `pnpm typecheck`: `packages/studio-kit/src/model/enlarger.ts(68,86): error TS18047: 'e.magnification' is possibly
  'null'` (the contract's magnification is `number | null`, null = the calibration's reference); fixed with the
  reference 8×.
- My test expected the preview's lights at 2 log 2; they were 3 log 2 (`expected 0.90309 to be close to 0.602…`):
  the preview adds two stops on top of the stop already applied. The test was wrong, not the code.

### What I learned
- `EditLog.create` constructs `new EditLog` (not `new this`), hence `StudioLog.make`.

### What was tricky to build
- Order matters inside one list: `[mode → real, time 20]` must keep the time; `[time 20, mode → real]` moves the
  time's exposure onto the lights, which prints the same in real mode afterwards (time unchanged, lights shifted).

### What warrants a second pair of eyes
- Approving an agent proposal made before this change (pending entries in a saved log) applies it as logged.
- The warm-print look's density parameter now shows as a lights change on normalised frames (its caption comes from
  the diff, which follows).

### What should be done in the future
- N/A

### Code review instructions
- `packages/studio-kit/src/model/enlarger.ts` (`opticsShift`, `withoutInert`, `StudioLog`); `frames.ts` `build`;
  `kits/looks/src/engine/plan.ts` `planFrame`.

### Technical details
- Normalised, time 10 → 20 s then f/8 → f/11: lights + log 2 − 2 log(11/8) = +0.025 log H each.

## Step 7: ko8e — the decode note says where the film base was read

The status line's decode summary said "film edge found" whenever a `base … D (rebate …)` note was present. That
includes a strip whose base WS-B now reads on the film between the frames, because the edge found lay on a frame
(raw000 and raw010 both). The summary now names the strip and where the base came from: "strip of 3 frames, film
base read between the frames", or "film base read on the film edge", or "no film edge found". The technical notes
in the tooltip are unchanged.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Fix the summary wording for a strip's gap base (status-text.ts).
**Inferred user intent:** The words match what the program did.
**Commit (code):** in the commit of Steps 5–8 (hash in Step 9).

### What I did
- `apps/studio/src/status-text.ts` `notesSummary`: "strip of N frames" from the `strip of N frames along …` note;
  "film base read between the frames" from `base … D from the gaps between frames`, else "film base read on the film
  edge" from `base … D (rebate …)`, else "no film edge found"; the "it may be a photo" hint not with a gap base.
- `apps/studio/test/status-text.test.ts`: the edge case's new wording; a new test with raw000's actual notes (as
  printed by decodeScan in Step 4) and a strip with no edge found.
- `e2e/studio-open-strips.spec.ts`: `#notes` contains "strip of 3 frames, film base read between the frames".

### Why
- "found" said nothing about where the base was read, which is what the photographer needs when a frame's colour
  looks off.

### What worked
- In the app (Step 8): "Colour negative (DNG), 5.8 MP, strip of 3 frames, film base read between the frames" for
  raw000; the synthetic negative "…, film base read on the film edge".

### What didn't work
- My test expected "5.9 MP" for 1608×3638; the summary gives 5.8 (5.85 rounds down in toFixed). Test corrected.

### What I learned
- N/A

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- WS-D's F9/F35 wording work may touch the same status line; this change is inside `notesSummary` only.

### What should be done in the future
- N/A

### Code review instructions
- `apps/studio/src/status-text.ts` `notesSummary`; `npx vitest run apps/studio/test/status-text.test.ts`.

### Technical details
- N/A

## Step 8: The built app, driven like a user

`scripts/wsc-02-app-check.ts` drives the built app (preview on 4711, headless Chromium, CPU engine, a fresh library)
through `#file` and the visible controls. It covers three synthetic cases (screenshots in `various/ws-c/`) and,
with `--private`, his NEF and Epson strip (numbers only, screenshots into the scratchpad). Everything matched the
unit-level numbers: the truck opens at 5.612 s, luma 105.7 (Node: 105.1), and raw000's frames open `flipV` with the
new note. Frame 2 reads upright and matches NLP; frame 1 is upright too; frame 3, a portrait, opens sideways.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Run the app and check the changes the way the photographer meets them.
**Inferred user intent:** Working behaviour in the app, not only in tests.
**Commit (code):** in the commit of Steps 5–8 (hash in Step 9).

### What I did
- `pnpm --filter @chromobench/studio build`; `pnpm --filter @chromobench/studio preview --port 4711 --strictPort`
  (background, stopped afterwards).
- `node ttmp/…/scripts/wsc-02-app-check.ts --private <scratchpad>/wsc/priv`.
- Looked at `various/ws-c/wsc-02-…png`, `wsc-03-…png` and, privately, `app-raw000-f2.png`.

### Why
- The first print runs in the engine worker in the app; the Node tests call it directly.

### What worked
- A (classic, synthetic camera RAW): `{"openMs":14374,"kind":"digital-raw","mode":"real","time_s":8.909,
  "lights":[0.001949,0.001949,0.001949],"auto":{"method":"integrate","alpha":0},"luma":123.1}`.
- B (simple, synthetic negative): titles Brightness, Warmth, Tint, Grade; Lighter: lights −0.118 → −0.219, time 10.
- C (classic, synthetic strip): three frames `flipV`; note "Colour negative (TIFF), 0.6 MP, strip of 3 frames, film
  base read between the frames".
- D (private): DSC_8559.NEF `time_s 5.612, lights 0.022799 ×3, auto integrate α 0, luma 105.7`, open 7.0 s;
  2025-08-09_raw000.dng frames `["flipV","flipV","flipV"]`, frame 2 time 5 s, lights −0.029/0.002/−0.022, luma 144.2,
  open 10.0 s.

### What didn't work
- No failures.

### What I learned
- The app's numbers equal the Node renders (Steps 2, 3) to within the pixel sampling.

### What was tricky to build
- The script is TypeScript run by Node's type stripping (like wsc-01), importing ingest's TIFF writers for the
  synthetic files.

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- Session 04 (task 92iq): the photo first print on several of his photos, the Epson strips' orientation, Simple.

### Code review instructions
- `node ttmp/2026/11/12/CHB-031--*/scripts/wsc-02-app-check.ts [--base …] [--private <scratchpad dir>]`.

### Technical details
- Screenshots (synthetic): `various/ws-c/wsc-01-classic-synthetic-photo-first-print.png`,
  `wsc-02-simple-print-brightness-warmth-tint.png`, `wsc-03-classic-synthetic-strip-flipV-note.png`.

## Step 9: The browser suite, the commit of Steps 5–8, the tasks

The first full browser run on my ports gave 98 passed and 3 failed. One failure was my new F25 assertion:
Playwright trims the expected substring, so `not.toContainText(' s')` became "not s", and "Brightness" contains
an "s". The other two (a PNG decode on the GPU project, and the library surviving a reload) failed with a destroyed
execution context and `window.chromobench` undefined after a reload. Rerun alone, all 11 tests of those three files
passed, so those two were flakes under load (two workstreams' suites ran at once), not regressions. A second full
run covers the final code (result below).

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The brief's checks before the final commit; check off the tasks.
**Inferred user intent:** A mergeable branch with green checks.
**Commit (code):** "CHB-031 WS-C: F25 Simple's Brightness/Warmth/Tint rows, srvr StudioLog (no inert control in the
edit log), ko8e decode note, app check" (hash in the final reply).

### What I did
- `STUDIO_PORT=5221 STUDIO_KIT_PORT=5222 SHELL_DEMO_PORT=5223 GPU_PARITY_PORT=5224 CI=1 pnpm test:browser`
  (twice), and `npx playwright test e2e/studio-decoders.spec.ts e2e/studio-open-mode.spec.ts
  e2e/studio-enlarger.spec.ts` with the same ports.
- `e2e/studio-enlarger.spec.ts`: `not.toContainText(/\d\s*s\b|\bst\b/)` (no seconds, no stops in the row).
- `pnpm typecheck`, `pnpm lint`, `pnpm test`: green (102 files, 2784 passed, 7 skipped).
- `docmgr task check --ticket CHB-031 --id nj2u,bey6,s7hd,88jx,srvr,ko8e`.

### Why
- The brief asks for the browser suite before the final commit.

### What worked
- Rerun of the three files: `11 passed (50.6s)`.
- Second full run on the final code: `101 passed (2.6m)`.

### What didn't work
- First full run: `3 failed … 98 passed (4.5m)`:
  `e2e/studio-enlarger.spec.ts:185` `Expected substring: not " s" Received string: "Brightness◀ LighterDarker ▶"`;
  `e2e/studio-decoders.spec.ts:64` `page.evaluate: Execution context was destroyed, most likely because of a
  navigation.`; `e2e/studio-open-mode.spec.ts:92` `page.evaluate: TypeError: Cannot read properties of undefined
  (reading 'studio')`.

### What I learned
- Playwright normalises the whitespace of a `toContainText` string, trimming it; use a regex for a substring with a
  leading space.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- The two load flakes (decoders PNG on the GPU project, open-mode reload) if they recur on main.

### What should be done in the future
- **Owner decisions:** F30's colour aim (Step 3's table; one line in `FIRST_PRINT_AIM`), and the photo density share
  0.5 (Step 2). The Roll module's own roll first print uses `ALPHA = 0.75`
  (`packages/studio-kit/kits/roll/src/engine/constants.ts`) while the studio's first print uses α 1. I left both
  defaults as they are; once the owner decides, both should read the same value.
- Session 04 (92iq): photo first print on more of his photos; Epson strips (`flipV`; portraits need one Rotate);
  Simple's rows; the "print density" look in Simple.

### Code review instructions
- `git log --oneline main..task/chb-031-picture`; the two commits in order.

### Technical details
- Ports: preview 4711; browser 5221–5224.
