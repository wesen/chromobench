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
