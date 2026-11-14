---
Title: Diary
Ticket: CHB-034
Status: active
Topics:
    - gpu
    - testing
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - playwright.config.ts
    - packages/gpu/kernels/pointwise.wgsl
    - packages/gpu/src/chain/run.ts
    - packages/gpu/src/chain/program.ts
    - packages/studio-kit/src/dom/arg.ts
    - docs/HANDOFF.md
ExternalSources: []
Summary: "First run of chromobench on the real GPU (M1 Max, Metal) on the Mac itself: the browser suite had only ever used SwiftShader; the GPU engine works and is fast; preview tables differ from core by up to 0.86 of an 8-bit level because of hardware texture filtering."
LastUpdated: 2026-11-14T15:30:00-05:00
WhatFor: "What the GPU engine does on a real GPU, and what to decide."
WhenToUse: "Before changing GPU tolerances, the preview lookup, or the browser suite's launch flags."
---

## Step 1: Set up on the Mac, baseline checks, and the browser suite as configured

The handoff (`docs/HANDOFF.md` §8) puts a real-GPU check first: everything after CHB-027 had been tested on the
CPU engine only. This session ran on the owner's MacBook Pro (Apple M1 Max, macOS 15.7.7, Chrome 157) itself, so
no SSH tunnel or remote Playwright server was needed. The checkout had no `node_modules` and no private material.

The unit-level checks were green. The browser suite as configured failed 14 of 106 on the Mac: 13 because the specs
press `Control+z` / `Control+k` / `Control+Alt+0`, which on macOS are not the app's Mod chords (Mod is ⌘ there,
`packages/shell/src/core/keys.ts:120`); the suite had only been run on Linux. The 14th was a GPU parity tolerance
(below). One more test (`studio-wording`) failed consistently but for a different reason: a race (Step 2).

### Prompt Context
**User prompt (verbatim):** "ok, what would you do next?" then "do it, 1-5 . Photos are in ~/Dropbox/Photos/2026-11-11 - manfred test bilder
 and also ~/Dropbox/Photos/RAW/Scans for some epson film negatives."
**Assistant interpretation:** Steps proposed: 1 baseline, 2 browser suite on the real GPU, 3 smoke and timings,
4 the post-CHB-027 picture checks on the GPU engine with the private photos, 5 write it up.
**Inferred user intent:** Know whether the GPU engine, the one the photographer should use, actually works.
**Commit (code):** not committed yet (branch `task/chb-034-real-gpu-check`).

### What I did
- `pnpm install`; `pnpm typecheck`, `pnpm lint`, `pnpm gen:check`: ok. `pnpm test`: 104 files, 2791 passed,
  19 skipped, 23 s.
- Copied (git-ignored, `git check-ignore` first) into `.playwright-mcp/photos/`: the 33 NEFs from
  `~/Dropbox/Photos/2026-11-11 - manfred test bilder/`, and `raw010.dng` from
  `~/Dropbox/Photos/RAW/Scans/2025/05/2025-10-07/roll-49/` (the only one of 14 files named `raw010.dng` in the
  archive with CHB-026's 1672 × 3695; `roll-49 color/` holds an identical copy). Into `.playwright-mcp/scans/`:
  CHB-026's set (2025-08-09 raw000/004/007/013 and their NLP positives, plus raw010-positive; 2025-10-07 roll-102
  raw000/001; 2024-12-07 raw0001).
- `pnpm exec playwright install chromium`; `CI=1 pnpm test:browser`: 92 passed, 14 failed (4.1 min).
- Replaced `'Control+` by `'ControlOrMeta+` in the 7 specs that use it (Playwright maps it per platform); all
  14 chords are Mod chords in the app (`packages/shell/src/app/assemble.ts` binds `Mod+Alt+0`).

### Why
- A green baseline separates GPU problems from problems that were already there.

### What worked
- After the key change, the affected specs pass on the Mac (27 of 28; the one left is the race of Step 2).

### What didn't work
- `--include=*.ts` in zsh without quotes: `no matches found`. Quote globs in grep flags.

### What I learned
- The browser suite had never run on macOS before: every Mod chord in the specs was spelled for Linux.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- Run the browser suite on the Mac now and then (task: see Step 3).

### Code review instructions
- `git diff e2e packages/shell/test packages/studio-kit/test`: 14 one-word changes.

### Technical details
- Failing chords before the change: `'Control+z'` ×10, `'Control+Shift+z'`, `'Control+Shift+Z'`, `'Control+k'`,
  `'Control+Alt+0'`.

## Step 2: A race in typed relative entries

`e2e/studio-wording.spec.ts` failed three times out of three on the Mac with a different wrong toast each time, e.g.
"Time −5 s → 5.0 s" right after the time was clamped to 600 s (expected 595.0 s). With Playwright's `slowMo: 150`
it passed twice in a row; `e2e/studio.spec.ts` "controls" failed once in the full run at the `+1/3 st` step and
passed 3 of 3 alone. Both are a typed entry committed right after another commit.

### What I did
- Read `packages/studio-kit/src/dom/arg.ts` around line 147: Enter parses with `parseEntry(kk, text, now.v)`, so a
  relative entry is applied to the control's cached `now.v`, which is updated after the previous commit has
  propagated. A second Enter within that window computes from the old value.
- Ran the wording spec with a temporary config adding `slowMo: 150` (deleted afterwards).

### Why
- A consistent failure that disappears with slower input is timing, not platform.

### What worked
- The diagnosis; not fixed (out of scope for this check).

### What didn't work
- N/A

### What I learned
- The M1 Max is fast enough to expose it where the Linux machine was not.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Whether a person can hit it: typing "-5 s" + Enter within the propagation window of the previous commit is
  unlikely by hand but possible with a pasted value or an agent.

### What should be done in the future
- Task `1j30`: read the base the way the range keydown does (`st.peek(pathOf(now.f)) ?? now.v`, a few lines above)
  or from the committed store.

### Code review instructions
- `packages/studio-kit/src/dom/arg.ts:147–165`.

### Technical details
- Toasts seen instead of the expected: "Time −5 s → 5.0 s"; "Time can't go below 0.1 s: set to 0.1 s" where
  "Time can be at most 600 s" was expected (the Enter on 1000 produced no new toast in time).

## Step 3: The browser suite on the real GPU; the preview tables and hardware filtering

`playwright.config.ts` launches both WebGPU projects with `--use-webgpu-adapter=swiftshader`, so, contrary to the
handoff, the browser suite had never touched a real GPU on any machine. A probe of four launch modes showed that
without those flags even headless Chromium gets the Metal adapter. With a new `REAL_GPU=1` switch the suite ran on
Metal: 100 passed, 6 GPU-parity tests failed. Exports still match core; the preview paths are off by up to 0.86 of an
8-bit level. A one-line experiment proved the cause: the preview's 3-D tables are read with the hardware's linear
filter, whose interpolation weights are low-precision on a real GPU; with the kernel's own manual trilinear lookup
all four chain tests pass.

### What I did
- Probe (`<scratchpad>/probe.mjs`): `requestAdapter({ powerPreference: 'high-performance' })` in four modes:

  | Launch | Adapter |
  |---|---|
  | bundled Chromium 158, headless, the suite's SwiftShader flags | google · swiftshader · fallback |
  | bundled Chromium 158, headless, no flags | apple · metal-3 |
  | Chrome 157, headless, no flags | apple · metal-3 |
  | Chrome 157, headed, no flags | apple · metal-3 |

- `playwright.config.ts`: `REAL_GPU=1` empties the WebGPU projects' launch args (default unchanged).
- `REAL_GPU=1 CI=1 pnpm test:browser`: 100 passed, 6 failed (1.1 min). Read
  `packages/gpu/kernels/pointwise.wgsl` `lut3`: mode 0 (`LOOKUP.hw`, the preview default in
  `packages/gpu/src/chain/run.ts:78`) is `textureSampleLevel` with a linear sampler on rgba32float; modes 1 and 2
  (`tetra`, `trilinear`) interpolate in f32 from `textureLoad`.
- Experiment: `LOOKUP.hw` → `LOOKUP.trilinear` in `run.ts:78`, `--project=gpu-parity` on Metal, then restored.
- Logged the `output.display` metrics instead of asserting (temporary edit, restored).

### Why
- The handoff's claim that the suite exercises the GPU on a Mac had to be checked before trusting a green run.

### What worked
- With manual trilinear: 38 of 40 GPU-parity tests pass on Metal, including conformance 320/320 and all four chain
  tests; the two left are below.

### What didn't work
- Failures on Metal with the hardware lookup (measured / bound):

  | Test | Measure | Metal | Bound |
  |---|---|---|---|
  | chain: preview display-rgb vs core tabulated | maxLevels | 0.861 | < 0.1 |
  | chain: darkroom real mode preview | maxLevels | 0.577 | < 0.1 |
  | chain: multi-exposure, paper log H (preview) | xPre.maxDiff | 3.7e-4 | ≤ 2e-4 |
  | chain: worker tables vs GPU tables | maxLevels | 0.116 | < 0.01 |
  | output.display: oklch knee and TRC | share of values > 2e-6 | 0.34 % | < 0.2 % |
  | tables stage 1: caps | adapter.fallback | false | true (asserts SwiftShader) |

  `max8bit ≤ 1` held in every chain test, and every export assertion passed.
- `output.display` on Metal: maxLin 3.0e-5 (bound 2e-5), maxCodes16 4 (bound 1): Metal's `pow`/`exp`/`log` are less
  exact than SwiftShader's. 4 codes of 65535 is 0.016 of an 8-bit level.
- On SwiftShader on this Mac one test fails that passes on Linux: tables stage 3, 2.62e-6 vs ≤ 2.5e-6.

### What I learned
- The GPU engine's previews on a real GPU are not what the parity suite measured: the suite measured SwiftShader,
  whose texture filtering is exact f32. The difference is below one 8-bit level, so not visible, but it is real
  and it was invisible to every test until now.

### What was tricky to build
- Keeping each experiment reversible: copies of `run.ts` and `output.spec.ts` in the scratchpad, restored and
  checked with `git diff --stat` after each run.

### What warrants a second pair of eyes
- Whether manual trilinear (8 `textureLoad`s per lookup instead of 1 filtered sample) costs measurable preview
  time at 4000 px. Not measured.

### What should be done in the future
- Task `vcma` (decision): keep the hardware lookup and set preview tolerances per adapter (fallback: today's;
  real GPU: max8bit ≤ 1, maxLevels < 1), or switch the preview to manual trilinear on non-fallback adapters and
  keep the tight bounds. Task `bubd`: make the caps test adapter-aware. Then run `REAL_GPU=1` in the Mac routine.

### Code review instructions
- `playwright.config.ts` (the `webgpuArgs` constant). Reproduce: `REAL_GPU=1 CI=1 pnpm exec playwright test --project=gpu-parity`.

### Technical details
- Full logs: `<scratchpad>/browser-swiftshader.log`, `<scratchpad>/browser-metal.log` (not kept).

## Step 4: Smoke test and timings in the installed Chrome

CHB-027's `mac-01`/`mac-02` drive the Mac remotely through a Playwright server and a tunnel. On the Mac itself they
only need `chromium.launch({ channel: 'chrome', headless: false })`: `scripts/01-gpu-smoke.mjs` and
`scripts/02-open-and-drag.mjs` are those copies. Against a production build (`vite preview --port 4811`), the smoke
test reports `"GPU · apple metal-3 · 4000 px"`, which is what CHB-027 expected. Dragging Time on the GPU engine gives
the final result in about 0.2 s with 7–9 live renders and no main-thread stall; the CPU engine needs about 1.2 s
with 3 renders. Opening a NEF takes about 6.5 s on the GPU engine against 5.8 s on the CPU engine (the LibRaw
decode dominates; the GPU prints 4000 px), with one 200 ms main-thread stall during each GPU open.

### What I did
- `pnpm --filter @chromobench/studio build`; `pnpm --filter @chromobench/studio exec vite preview --port 4811 --strictPort`.
- `node scripts/01-gpu-smoke.mjs`; `node scripts/02-open-and-drag.mjs "http://localhost:4811/?engine=<gpu|reference>&fresh" <file>`
  for five files on both engines. JSON per run in `various/timings/`.

### Why
- The timings a photographer feels, on the engine he should use.

### What worked
- Results (ms; "stall" = worst rAF gap > 100 ms):

  | File | GPU open | GPU stall | GPU drag | renders | CPU open | CPU drag | renders |
  |---|---|---|---|---|---|---|---|
  | DSC_8559.NEF | 6570 | 200 | 203 | 8 | 5654 | 1214 | 3 |
  | DSC_8655.NEF | 6596 | 200 | 206 | 8 | 5864 | 1028 | 3 |
  | DSC_8541.NEF | 6489 | 200 | 206 | 8 | 5863 | 1223 | 3 |
  | raw010.dng (strip) | 1139 | 108 | 212 | 9 | 2841 | 1213 | 5 |
  | roll-102_raw000.dng | 2250 | 200 | 205 | 7 | 4442 | 1418 | 5 |

  The CPU engine had no stall in any run.

### What didn't work
- N/A

### What I learned
- On the real GPU the darkroom is interactive at 4000 px; the CPU engine at 640 px is five times slower to settle.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- The 200 ms stall per GPU open (task `5un4`): pipeline creation or a synchronous texture upload on the main
  thread are the first suspects.

### What should be done in the future
- Task `5un4`.

### Code review instructions
- Run the two scripts against a preview on 4811 (a Chrome window opens).

### Technical details
- `resultMs` is from the start of the action to the last change of the "rendered N" counter (2.5 s quiet).

## Step 5: First print, strips and interface on the GPU engine, with the private photos

`scripts/03-first-print-gpu-vs-cpu.ts` (from CHB-031 `wsc-02-app-check.ts`) opens ten private files in the
installed Chrome on each engine and records the first print and each strip frame. Both engines agree: same mode,
same kind, same orientation (`flipV` on every strip frame), same frame count and base note, Time equal on 9 of 10
files, lights within 0.007 log H on the scans, and the mean picture within about 1 level on the NEFs and 0.4–3.6
levels on the strips (sampled at 400 points of a 4000 px image vs a 640 px image). DSC_8559 is the exception in
numbers only: GPU Time 5.612 s with lights +0.024, CPU 6.3 s with lights −0.021, the same picture (luma 105.0 /
105.1). `CHB-031 Step 8` had 5.612 s on the CPU engine then; the auto exposure sits on a 1/3-stop boundary.
The interface spec (F24 layout switch, F26, F32–F36 History and undo, F34 Actual Pixels, 8iv8), run once with
`engine=gpu` on Metal, passes 5 of 5.

### What I did
- `node ttmp/2026/11/14/CHB-034--*/scripts/03-first-print-gpu-vs-cpu.ts --private <scratchpad>/chb034` (preview on
  4811). Files: DSC_8559, 8541, 8536, 8655, 8553 (90°), 8521 (270°), raw010.dng, 2025-08-09 raw000 and raw007,
  2025-10-07 roll-102 raw000. Screenshots only in the scratchpad.
- Temporarily changed `e2e/studio-interface.spec.ts:29` to `engine=gpu` (no `canvas2d`), ran it with `REAL_GPU=1`,
  restored it.

### Why
- The handoff's item 1: repeat the photo first print and strip checks on the GPU engine.

### What worked
- Per frame, GPU / CPU (Time s; lights log H; luma):

  | File · frame | Time | lights (GPU) | lights (CPU) | luma GPU / CPU |
  |---|---|---|---|---|
  | DSC_8559 | **5.612 / 6.3** | +0.0235 ×3 | −0.0209 ×3 | 105.0 / 105.1 |
  | DSC_8541 tungsten | 5.612 | 0.0084 | 0.0096 | 105.8 / 105.6 |
  | DSC_8536 evening | 4.454 | 0.0224 | 0.0236 | 57.2 / 58.1 |
  | DSC_8655 night | 5 | −0.0169 | −0.0178 | 60.9 / 61.1 |
  | DSC_8553 portrait 90° | 6.3 | −0.0217 | −0.0195 | 81.0 / 81.1 |
  | DSC_8521 portrait 270° | 5 | 0.0187 | 0.0203 | 85.5 / 86.4 |
  | raw010 1/3 | 2.227 | .077/−.002/−.155 | .080/.002/−.152 | 118.0 / 117.5 |
  | raw010 2/3 | 2.806 | .082/.021/−.098 | .084/.024/−.095 | 127.0 / 127.6 |
  | raw010 3/3 | 3.15 | .011/.040/.009 | .013/.043/.012 | 133.9 / 131.5 |
  | raw000 1/3 | 3.15 | −.034/−.008/.015 | −.032/−.007/.018 | 140.4 / 136.8 |
  | raw000 2/3 | 5 | −.030/.001/−.024 | −.029/.002/−.022 | 142.9 / 144.2 |
  | raw000 3/3 | 4.454 | −.021/.017/.012 | −.020/.017/.013 | 135.1 / 131.6 |
  | raw007 1/2 | 3.15 | −.005/−.004/−.033 | .000/.003/−.030 | 138.6 / 141.8 |
  | raw007 2/2 | 2.5 | .095/.029/−.148 | .099/.033/−.147 | 135.0 / 134.6 |
  | roll-102 raw000 | 11.225 | −0.0098 | −0.0096 | 156.1 / 155.5 |

  raw000 frame 2 on the CPU (Time 5 s, luma 144.2) equals CHB-031 Step 8 exactly.
- Notes: "Colour negative (DNG), 6.2 MP, strip of 3 frames, film base read between the frames" (raw010); raw007
  "strip of 2 frames, film base read on the film edge"; NEFs "Nikon D750 photo, 24 MP".
- Portraits come out 2674 × 4000 (GPU) / 428 × 640 (CPU): EXIF rotation applied on both engines.

### What didn't work
- `2025-10-07_roll-102_raw000.dng` (Epson V600, VueScan 9.8.45) opens as "DNG photo, 10 MP", kind `digital-raw`,
  on both engines. Its mean colour is neutral (RGB 156/157/152): no orange mask, so `guessOpenMode`
  (`packages/ingest/src/conditioning/open-mode.ts`) says photo. It is probably a black-and-white negative or a
  slide (B&W is parked in CHB-014). Not a GPU matter; for the owner to say what roll-102 is.

### What I learned
- The GPU engine's first print and strip handling match the CPU engine on the photographer's files; nothing in
  CHB-027/031's picture work depends on the CPU engine.

### What was tricky to build
- The strip frames are selected by their list label `"<file> · i/n"`, as in wsc-02.

### What warrants a second pair of eyes
- DSC_8559's Time: a photographer who switches engine sees a different Time for the same picture (task `fusz`).
  A hysteresis or a tie-break towards the shorter time would make it stable.

### What should be done in the future
- Tasks `fusz`, and a session with the persona on the GPU engine (HANDOFF §8 item 1, the cosplay part) if wanted.

### Code review instructions
- `scripts/03-first-print-gpu-vs-cpu.ts`; run it with a preview on 4811 and `--private <dir outside the repo>`.

### Technical details
- Engine labels: `GPU · apple metal-3 · 4000 px`; `reference · CPU f64 (tabulated previews, exact export) (worker) · 640 px`.

## Step 6: The filter weights measured; the vault report

Step 3 showed that the preview tables differ from core only when read through the hardware filter, but not how
coarse the filter is. `scripts/04-filter-precision.mjs` measures it: a 2 × 1 texture holds 0 and 1, and a compute
shader samples it at 4096 coordinates whose exact weight for texel 1 is known; the returned value minus the wanted
weight is the hardware's weight error. On Metal every weight is a multiple of 1/256 (257 distinct values, maximum
error 1/512, the same for `rgba16float` and `rgba32float`); on SwiftShader all 4096 weights come back exact to
6e-8. The parity tolerances of the chain tests were therefore set on an adapter with f32 filter weights, and every
real GPU with 8-bit weights will miss them. The finding and Steps 1–5 went into a deep-dive report in the owner's
vault.

### Prompt Context
**User prompt (verbatim):** "create a detailed report for the obsidian vault in ~/code/wesen/go-go-golems/go-go-parc as a deep dive technical blogpost in a textbook authoring style (see skill). commit and publish the vault afterwards." then "commit, do it."
**Assistant interpretation:** Write the CHB-034 results up for the vault; measure the filter precision rather than
assert it; then add the probe and this step to the ticket and commit the branch.
**Inferred user intent:** A durable explanation of the real-GPU findings, and the evidence kept with the ticket.
**Commit (code):** the commit of this branch (Steps 1–6).

### What I did
- Wrote the probe (WGSL: `let u = (0.5 + w) / 2.0; o[id.x] = textureSampleLevel(t, s, vec2f(u, 0.5), 0.0).r - w;`),
  ran it in bundled Chromium with and without the SwiftShader flags.
- Vault: `Projects/2026/11/14/PROJECT REPORT - Chromobench - The First Run on a Real GPU - …` in go-go-parc,
  commit 9cf760d, pushed. The vault repository is public: no images, no subjects of the photos, file names only
  where the 2026-11-12 vault report already named them.

### Why
- "Hardware filtering is less precise" was a hypothesis supported by an experiment (Step 3); a direct measurement
  of the weight quantisation turns it into a number that can set the tolerance for real GPUs.

### What worked
- | Adapter | Distinct weights | Max weight error | Bits |
  |---|---|---|---|
  | Metal (M1 Max) | 257 | 0.00195 (1/512) | 8 |
  | SwiftShader | 4096 | 6.0e-8 | f32 |

### What didn't work
- N/A

### What I learned
- The quantisation is in the weights, not the texel format: `rgba32float` with `float32-filterable` gives the same
  257 levels as `rgba16float`.

### What was tricky to build
- The coordinate: with two texels, their centres are at 0.25 and 0.75, so weight w for texel 1 is at u = (0.5 + w) / 2.

### What warrants a second pair of eyes
- The mapping from weight error (≤ |Δ| / 512 per axis) to the measured 0.86 of an 8-bit level depends on the table's
  node spacing and on the display transform after it; not derived, only measured.

### What should be done in the future
- Use the 1/512 weight error to derive per-adapter bounds for task `vcma` (option A), or measure the cost of manual
  trilinear (option B).

### Code review instructions
- `node scripts/04-filter-precision.mjs` with any dev server on localhost:4173.

### Technical details
- The probe requests `float32-filterable` when the adapter has it, to test `rgba32float` as well.

## Step 7: The two remaining failures fixed; the default suite green on the Mac

The project merges only when every check passes. After Steps 1–6 the default browser suite still failed 2 of 106 on
the Mac, both present on `main` as well: the typed-entry race of Step 2, and the stage-3 solve table at 2.62e-6
against a bound of 2.5e-6 under SwiftShader. Both are fixed; the default suite passes 106 of 106 on the Mac, and with
`REAL_GPU=1` exactly the six failures of Step 3 remain (task `vcma`, a decision).

### Prompt Context
**User prompt (verbatim):** "PR? what's needed to get this into main?" then "that's fine." (to: fix both, then push and open a PR)
**Assistant interpretation:** Make the branch pass the merge rule, then open a pull request.
**Inferred user intent:** Get CHB-034 into `main` cleanly.
**Commit (code):** the second commit of this branch.

### What I did
- `packages/studio-kit/src/dom/arg.ts`: the field's Enter handler parses against `st.peek(pathOf(now.f)) ?? now.v`,
  the store's current value, as the range keys and the stepper already do, instead of the cell's `now.v`.
- Measured the solve table's `maxDiff` with the assertions replaced by logs (restored afterwards), two runs each:
  SwiftShader on the Mac 2.62e-6 (correct) and 1.45e-5 (broken variant, gtol 1e-5); Metal 2.38e-6 and 1.38e-5.
- `packages/gpu/src/parity/page.ts`: one constant `SOLVE_TOL = 3e-6` for both solve checks, with the measurements in
  its comment; `tables.spec.ts` bounds and title follow.
- typecheck, lint, gen:check, `pnpm test` (2791 passed, 19 skipped), `CI=1 pnpm test:browser` 106/106 (4.0 min),
  `REAL_GPU=1 CI=1 pnpm test:browser` 100/106 (the six of Step 3).

### Why
- The race is a real defect (a pasted value or an agent can hit it); the tolerance was set on one machine's
  SwiftShader and is f32 noise on another's.

### What worked
- The two race-affected specs: 16 of 16 passes after the fix (were 3 of 3 failures for the wording spec).

### What didn't work
- One run of ten timed out at 60 s right after the source edit; not reproduced in 16 later runs. Most likely the dev
  server's first compile after the change landing in the first test.

### What I learned
- The solve table's error is deterministic per adapter (identical in repeated runs), so the margin to the broken
  variant (4.6×) is a fixed quantity, not a statistical one.

### What was tricky to build
- Loosening a bound that a negative control also uses: the broken variant must stay above the new bound, so both
  had to be measured before choosing 3e-6.

### What warrants a second pair of eyes
- The typed-entry fix relies on `st.peek` returning the committed value synchronously after `tx` for routed recipe
  paths; the passing specs show it does, but the store's routing is not documented on this point.

### What should be done in the future
- No dedicated unit test for the race: studio-kit's unit tests have no DOM. `e2e/studio-wording.spec.ts` types two
  entries back to back and is the regression test.

### Code review instructions
- `git show HEAD -- packages/studio-kit/src/dom/arg.ts packages/gpu/src/parity/page.ts packages/gpu/test/browser/tables.spec.ts`.

### Technical details
- N/A

## Step 8: What exact interpolation costs, and the preview switched to it

The open decision of Step 3 (task `vcma`) was whether the preview should keep reading its 3-D tables through the
hardware filter, with looser parity bounds on real GPUs, or switch to the kernel's manual trilinear lookup and keep
the tight bounds. The rule agreed with the owner: measure the cost first; if it is noise, take the exact lookup. A
new parity-page scenario, `chain:lookup-bench`, times the preview display chain at the GPU engine's working size for
the three lookup modes. At 4000 × 2674 on the M1 Max the hardware lookup takes 5.3 ms, manual trilinear 6.4 ms,
manual tetrahedral 5.9 ms (medians of 15 interleaved rounds). The 1.1 ms difference is under 1 % of the ~200 ms a
Time drag takes to settle (Step 4), so the preview now uses manual trilinear on every adapter; on SwiftShader, whose
filter weights are already exact, nothing changes.

### Prompt Context
**User prompt (verbatim):** "merged, what's next?" then "go ahead. Commit at appropriate intervals, and write a frequent and detailed diary, see ~/.codex/skills. Subagents should write their own diary with the same format / skill."
**Assistant interpretation:** Finish CHB-034: measure the lookup cost and decide by the agreed rule, make the
real-GPU suite pass, then the GPU-open stall; delegate the first-print Time stability (task `fusz`) to a subagent
with its own diary (`diary/02-diary-first-print-time.md`); commit and write the diary as I go.
**Inferred user intent:** Close the GPU follow-ups with evidence, in reviewable commits.
**Commit (code):** a60fa6c — "CHB-034: preview tables through manual trilinear (exact weights; Metal's filter quantises to 1/256), +1.1 ms per 4000 px preview; lookup bench scenario and script; caps and output.display tests adapter-aware (Metal bounds 1.5x measured)"

### What I did
- Branch `task/chb-034-gpu-followups` from `main` at b4494e5.
- Delegated task `fusz` to a subagent in its own worktree (branch `task/chb-034-first-print-time`, own diary).
  Agreed a GPU lock for anything that uses the real GPU, so timings do not overlap:
  `mkdir <scratchpad>/gpu.lock` (retry every 30–60 s), owner name inside, `rm -rf` after the run.
- `packages/gpu/src/parity/chain-tests.ts`: `lookupBench` / scenario `chain:lookup-bench` (options `w`, `h`,
  `rounds`, `warmup`). It tiles the 96 × 64 synthetic Gold 200 scan to the requested size (building it per pixel at
  10 MP would take long on the CPU), uploads it once, and runs `ChainRunner.run` on `scanChain(…, 'display')` with
  `precision: 'preview'` and each `lookup`, round-robin, 3 warm-up rounds, each sample from
  `queue.onSubmittedWorkDone()` before to `onSubmittedWorkDone()` after.
- `scripts/05-lookup-bench.mjs`: opens the parity page (served by
  `pnpm --filter @chromobench/gpu exec vite --config parity-page/vite.config.ts --port 4185 --strictPort`) in
  bundled Chromium without SwiftShader flags (or with `--swiftshader`) and prints one JSON line per size.
- `packages/gpu/src/chain/run.ts:78`: preview default `LOOKUP.hw` → `LOOKUP.trilinear` (comment with the numbers);
  `program.ts` doc comment of `LOOKUP` updated. `LOOKUP.hw` stays for the `lookup:hw` parity test.

### Why
- A decision between tolerance and exactness should rest on what exactness costs, measured where it runs.
- Trilinear, not tetrahedral: core's tabulated reference (`look3`) is trilinear, so manual trilinear reproduces it
  to 1e-6 (`lookup:trilinear` test); tetrahedral is more accurate against the exact solve but would not equal core's
  preview reference.

### What worked
- `node scripts/05-lookup-bench.mjs --rounds 15` (Metal):

  | Size | hw | trilinear | tetra |
  |---|---|---|---|
  | 4000 × 2674 | 5.3 ms (p10 5.2, p90 5.6) | 6.4 ms (6.1, 6.6) | 5.9 ms (5.7, 6.3) |
  | 2000 × 1337 | 2.3 ms (2.2, 2.4) | 2.5 ms (2.4, 2.8) | 2.5 ms (2.3, 2.7) |

- After the switch, `REAL_GPU=1 CI=1 pnpm exec playwright test --project=gpu-parity`: 40/40 (with Step 9's test
  changes); the four chain tests of Step 3 pass on Metal.
- `e2e/studio-photo.spec.ts`, `studio-real.spec.ts`, `studio-decoders.spec.ts` (the GPU-engine studio specs): 8/8 on
  SwiftShader and 8/8 on Metal.

### What didn't work
- N/A

### What I learned
- The hardware filter's advantage is real but small: one filtered sample against eight `textureLoad`s costs ~20 % of
  this kernel and ~1 ms per 10-MP frame.
- Tetrahedral (four loads) is cheaper than manual trilinear (eight) and more accurate against the exact solve; it is
  the better lookup in absolute terms, only not the one core's preview reference uses.

### What was tricky to build
- Chrome's `performance.now()` is coarsened to 0.1 ms in a page without cross-origin isolation, so per-run times
  are quantised; medians over 15 rounds and the interleaving make the 1.1 ms difference unambiguous (the p10–p90
  ranges do not overlap at 4000 px).
- `ChainRunner.run` returns once the work is queued; the sample must wait for `onSubmittedWorkDone()`, and wait for
  it also before starting, so earlier queued work is not counted.

### What warrants a second pair of eyes
- The bench measures one segment (the scan display chain). The darkroom's multi-exposure chains do more lookups per
  pixel; their cost scales with the number of lookups, still in milliseconds, but not measured.

### What should be done in the future
- If core's tabulated reference ever moves to tetrahedral interpolation, switch the GPU preview to `LOOKUP.tetra`
  (cheaper and more accurate).

### Code review instructions
- `packages/gpu/src/chain/run.ts:78`, `packages/gpu/src/parity/chain-tests.ts` (`lookupBench`).
- Validate: serve the parity page on 4185, `node ttmp/…/CHB-034…/scripts/05-lookup-bench.mjs`; then
  `REAL_GPU=1 CI=1 pnpm exec playwright test --project=gpu-parity`.

### Technical details
- Adapter in the bench output: `{"vendor":"apple","architecture":"metal-3","fallback":false}`.

## Step 9: The adapter-aware tests, and the display transform's error located

Two GPU-parity tests could not pass on a real GPU whatever the lookup: the capability test asserted SwiftShader, and
the display-transform test had bounds measured on SwiftShader. Before setting a bound for Metal I looked at where the
Metal error is. Steps 3 and the vault report attributed it to Metal's `pow`/`exp`/`log`; that was an inference, not
a measurement, and it was wrong as stated: on both adapters the worst pixel of every output space and rendering sits
at G ≈ 1, the top of the RGB cube, where the spec's own comment already locates SwiftShader's outliers (the f32
bisection for the OkLCh knee's C_max is ill-conditioned there). Metal's f32 arithmetic enlarges the same weak spot.

### Prompt Context
**User prompt (verbatim):** (see Step 8)
**Assistant interpretation:** Make `REAL_GPU=1` pass with bounds that say something.
**Inferred user intent:** A real-GPU run that is a routine check, not a list of known failures.
**Commit (code):** a60fa6c (with Step 8)

### What I did
- `<scratchpad>/outdisp.mjs`: ran `output:display` (knee oklch) on Metal and on SwiftShader and printed each
  space/rendering's `maxLin`, `maxCodes16`, `worstRef`, `worstGpu`.
- `packages/gpu/test/browser/output.spec.ts`: the oklch test asks `caps` for `adapter.fallback`; SwiftShader keeps
  0.2 % / 2e-5 / 1 code; a real GPU gets 0.5 % / 4.5e-5 / 6 codes (1.5× the Metal measurement), with the reason in a
  comment.
- `packages/gpu/test/browser/tables.spec.ts`: stage 1 expects `fallback === true` without `REAL_GPU`, `false` with it.

### Why
- A bound is a statement about an adapter; writing which adapter it is about keeps both runs meaningful.

### What worked
- Worst pixels (reference display RGB), Metal vs SwiftShader, e.g. sRGB scan-of-print both at
  (0.9815, 1.0000, 0.5786); the largest Metal error ProPhoto scan-of-print at (0.9335, 0.9999, 0.1911), 2.98e-5,
  4 codes. Totals: Metal 0.340 % > 2e-6, max 2.98e-5, 4 codes; SwiftShader 0.127 %, 8.2e-6, 1 code.
- `CI=1 pnpm exec playwright test --project=gpu-parity`: 40/40 on SwiftShader (3.1 min) and with `REAL_GPU=1` on
  Metal (14 s).

### What didn't work
- My earlier explanation (Metal transcendentals) in Step 3 and in the vault report: not supported by the data.
  Corrected here; the vault report is corrected in its own commit.

### What I learned
- Check where an error is before naming its cause. Here the location (G ≈ 1, every space) was enough to tie it to
  the known ill-conditioned spot.

### What was tricky to build
- The output spec had no access to the adapter; it now runs the `caps` scenario first on the same page.

### What warrants a second pair of eyes
- The real-GPU bounds come from one GPU (M1 Max). Another vendor's f32 could land elsewhere; the comment says where
  the numbers come from.

### What should be done in the future
- A better-conditioned C_max search near G = 1 would shrink the error on every adapter (not needed for display:
  4 codes of 65535).

### Code review instructions
- `packages/gpu/test/browser/output.spec.ts` (oklch test), `packages/gpu/test/browser/tables.spec.ts` (stage 1).

### Technical details
- Real-GPU bounds: `over2e6 / values < 0.005`, `maxLin < 4.5e-5`, `maxCodes16 ≤ 6`.

## Step 10: The stall in every GPU open, profiled and removed

Step 4 measured one main-thread stall of 100–200 ms in each GPU open and none on the CPU engine (task `5un4`). A
sampling CPU profile, aligned with a rAF probe, named two causes. The first film of a session fitted core's fallback
RGB → spectrum table on the main thread (112 ms in `sigmoidSpectraTable`'s Gauss–Newton `fit`/`eval3`); the CPU engine
does the same work in its worker, which is why it never stalled. The second was the source upload: a JavaScript loop
expanding 10.7 M RGB floats into a 171 MB RGBA array before `writeTexture` (95 ms in `ChainRunner.upload`). The fit
now runs in a one-shot module worker when the GPU engine is created, and its result seeds core's cache; f32 sources
go to the GPU as they are and a compute pass (`unpackF32`) writes the RGBA texture. In the production build, every
open on the GPU engine is now free of stalls over 100 ms and 4–19 % faster.

### Prompt Context
**User prompt (verbatim):** (see Step 8)
**Assistant interpretation:** Task `5un4`: find and remove the stall.
**Inferred user intent:** A GPU engine that never freezes the window.
**Commit (code):** 523ad8a — "CHB-034: no main-thread stall on a GPU open — f32 sources uploaded as they are and expanded on the GPU (pack16.wgsl unpackF32; was a 95 ms JS loop), core's fallback spectra fitted in a worker at engine creation (was 112 ms at the first film); upload parity test; profiling script; GPU opens 4–19 % faster"

### What I did
- `scripts/06-open-stall-profile.mjs`: opens a file in the studio (dev server, unminified) in bundled Chromium on the
  machine's adapter, records a CDP sampling profile (`Profiler.setSamplingInterval` 200 µs) and a rAF probe (gaps
  > 100 ms), and for each gap aggregates the samples inside it by leaf function and by stack. Profile timestamps are
  anchored to page time by a `performance.now()` taken right after `Profiler.start`.
- Before (DSC_8559.NEF, GPU engine): a 217 ms gap with 126.7 ms busy, 111.8 ms self in `eval3`
  (`packages/core/src/film/upsample.ts`) under `renderGraph > execute > run > exposerAt > film > cached > … >
  fallbackSpectra > sigmoidSpectraTable > fit > eval3`; then a 183 ms gap with 142.5 ms busy, 94.6 ms in `upload`
  (`execute > sourceTexture > upload`) and 11 ms in the first print's `integratedExposure`/`keptPixels`.
- Node microbenchmark of the RGB → RGBA loop (10.7 M pixels): existing 129–140 ms; a loop specialised for three
  channels 45–48 ms, most of it the allocation and fill of the 171 MB array.
- `packages/gpu/kernels/pack16.wgsl`: entry point `unpackF32` (bindings 7–9: uniform size (w, h, c), the source as
  `array<f32>`, an rgba32float storage texture), the CPU loop's channel rules.
- `packages/gpu/src/engine/textures.ts`: `uploadF32(rt, data, w, h, c, label, cpu)`: `writeBuffer` of the source's
  bytes, one dispatch; falls back to `cpu()` when the data exceeds `maxStorageBufferBindingSize` or `maxBufferSize`.
  `engine-gpu.ts`: `sourceTexture` and the two measure uploads (`uploadMeasured`) use it.
- `packages/gpu/src/chain/run.ts`: `ChainRunner.upload` (still the fallback and used by parity tests) has the
  three-channel loop without branches.
- `packages/core/src/film/forward.ts`: `seedFallbackSpectra(data, table)` (kept only when nothing is cached and the
  table is the 64² sigmoid fit). `packages/gpu/src/tables/spectra-worker.ts`: runs `sigmoidSpectraTable(cmf, 64)` and
  transfers the data. `GpuEngine.create` calls `prefitSpectra(data)` (not awaited; skipped without `Worker`).
- `packages/gpu/src/parity/chain-tests.ts` scenario `upload:f32` and a test in `chain.spec.ts`: `uploadF32` and the
  CPU loop give bitwise equal textures for 1, 3 and 4 channels (37 × 23).

### Why
- A stall over 100 ms is visible as a frozen window; the GPU engine exists to stay responsive.
- Worker plus cache seeding instead of making `exposerAt` asynchronous: the film model is reached synchronously deep in
  the chain lowering; the table depends only on the CMFs, so it can be ready before the first open.

### What worked
- After (dev server, profile script): DSC_8559.NEF and raw010.dng, no gap over 100 ms.
- Production build, `scripts/02-open-and-drag.mjs` on the GPU engine (Step 4 → now; JSON in `various/timings-after/`):

  | File | open ms | worst open stall | drag ms | worst drag stall |
  |---|---|---|---|---|
  | DSC_8559.NEF | 6570 → 6309 | 200 → 0 | 203 → 204 | 0 → 0 |
  | DSC_8655.NEF | 6596 → 6298 | 200 → 0 | 206 → 206 | 0 → 0 |
  | DSC_8541.NEF | 6489 → 6298 | 200 → 0 | 206 → 206 | 0 → 0 |
  | raw010.dng | 1139 → 1045 | 108 → 0 | 212 → 204 | 108 → 0 |
  | roll-102 raw000.dng | 2250 → 1830 | 200 → 0 | 205 → 207 | 0 → 0 |

  The drag times include Step 8's manual trilinear lookup: no change at this resolution of measurement.
- `--project=gpu-parity`: 41/41 on SwiftShader and on Metal (with the new upload test). GPU studio specs
  (`studio-photo`, `studio-real`, `studio-decoders`): 8/8 on Metal; on SwiftShader 7/8 once (below), then 6/6 for the
  failing spec alone.

### What didn't work
- First wiring of the prefit was `if ((opts.workers ?? 0) > 0)`: the studio creates the engine as
  `GpuEngine.create({ data, cacheLimit: 24 })` (`apps/studio/src/host/engines.ts:175`), without workers, so the
  prefit would never have run there. Now unconditional (when `Worker` exists).
- The first edit script for `engine-gpu.ts` asserted two identical measure-upload lines; they differ in indentation
  (`AssertionError` at the count check); applied separately.
- `e2e/studio-decoders.spec.ts` "tiff" failed once on SwiftShader after 5 ms, in a run that took 3.7 min instead of
  1.7 min while the subagent was also working; alone it passed 6/6. Not reproduced.
- `pnpm test`: `packages/studio-kit/test/roll/kit.test.ts` "the roll flow through commands" failed in 2 of 6 full runs
  and passed alone and in the 4 others; its code path (core in Node, the mock engine) does not include anything
  changed here. Its error text was not captured (the runs that kept the log passed). Recorded as a task.

### What I learned
- The CPU engine had been hiding the spectra fit in its worker all along; only the GPU engine, running core's film
  model on the main thread, exposed it.
- Allocation of a 171 MB typed array is itself tens of milliseconds; the fix had to avoid the array, not only
  speed up the loop.

### What was tricky to build
- Aligning the profile with the probe: CDP's `startTime` is in µs of a monotonic clock that is not
  `performance.now()`; anchoring both at the moment the profile starts was enough to attribute each gap.
- `writeBuffer` with a typed array view: passing `data.buffer, data.byteOffset, bytes` uploads only the view, which
  matters for a sub-rectangle copied into a new array and for decoders that return views.

### What warrants a second pair of eyes
- `seedFallbackSpectra` trusts that the worker ran the same `sigmoidSpectraTable` on the same CMFs; it checks size and
  source label only. The worker imports the same core module, so it is the same code.
- `uploadF32`'s fallback condition uses the negotiated limits; an adapter with a small `maxStorageBufferBindingSize`
  (128 MiB default) takes the CPU path for sources above 11 MP at 3 channels.

### What should be done in the future
- `uploadU16` (16-bit scans) still expands to RGBA on the CPU (a smaller loop; no stall over 100 ms measured).
- The measure path reads a result back and uploads it again for the reduction; it could reduce the texture directly.
- Capture the roll test's error when it next fails (task).

### Code review instructions
- `packages/gpu/kernels/pack16.wgsl` (`unpackF32`), `packages/gpu/src/engine/textures.ts` (`uploadF32`),
  `packages/gpu/src/engine-gpu.ts` (`sourceTexture`, `uploadMeasured`, `prefitSpectra`), `packages/core/src/film/forward.ts`
  (`seedFallbackSpectra`), `packages/gpu/src/tables/spectra-worker.ts`.
- Validate: `REAL_GPU=1 CI=1 pnpm exec playwright test --project=gpu-parity`; profile with
  `node ttmp/…/scripts/06-open-stall-profile.mjs .playwright-mcp/photos/<file>` against the dev server on 4173.

### Technical details
- Stacks before (ms of samples): 106.6 `renderGraph > execute > run > exposerAt > film > cached > (anonymous) >
  spectra > fallbackSpectra > sigmoidSpectraTable > fit > eval3`; 94.6 `execute > sourceTexture > upload`.
