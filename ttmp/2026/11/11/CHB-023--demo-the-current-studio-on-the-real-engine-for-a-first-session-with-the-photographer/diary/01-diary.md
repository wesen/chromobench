---
Title: Diary
Ticket: CHB-023
Status: active
Topics:
    - ui
    - product
    - ingest
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T16:20:38.230184994-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — CHB-023 demo

## Step 1: Orientation, the engine gap, and the plan

I read the common brief, the CHB-023 tasks, CHB-009 Steps 16–17, CHB-017 Steps 2–3, CHB-004 Steps 14–15,
CHB-006 Step 17 and CHB-019 §3/§7.1, then the studio core (`studio.ts`, `frame-session.ts`, `scheduler.ts`,
`probe.ts`, `tools.ts`), the contract's `Engine` and `compile()`, `RefEngine` and `GpuEngine`. The main
finding: neither real engine can show the studio's display chain on its own, and the reference engine is far
too slow for full-size scans, so the studio needs a thin host layer, not just a different `new Engine()`.

### Prompt Context
**User prompt (verbatim):** (via the orchestrator) "You implement ticket CHB-023 in the chromobench monorepo, in
your own git worktree: put the real engine behind the existing studio app (apps/studio, React, built in CHB-009)
so the user can show his father — a photographer — a first working version and iterate. Incomplete is fine; it
must open his real scans, print them through the physical model, let him adjust like at an enlarger, and save.
[…] Be pragmatic; the user asked not to overdo polish — a working demo beats a perfect one."
**Assistant interpretation:** Wire GpuEngine/RefEngine, ingest decoding, an automatic first print, the enlarger
controls, strip/ring-around, export and an offline build into the CHB-009 studio; keep every check green.
**Inferred user intent:** A session with the photographer on his own scans, soon, that is honest about gaps.

### What I did
- `git checkout -b task/chb-023-demo`; `pnpm install --frozen-lockfile --prefer-offline` (fresh worktree).
- Baseline: `pnpm test` → `Tests 1 failed | 1935 passed (1936)`; the failure is
  `packages/gpu/test/tiles.test.ts > planTiles: properties … Error: Test timed out in 5000ms` (load timeout,
  known from CHB-004 Step 14).
- Op coverage (throw-away script in `packages/core/scratch-bench/`, deleted): `REFERENCE_OPS` lack
  `output.frame`, `view.inspect`, `print.combine`, `mask.*`; `GPU_OPS` also lack `invert.classes/classify` and
  `print.preflash`; the GPU's `output.display` is sRGB only. `compile()` ends every display chain in
  `output.frame`, so neither engine could render the studio's print node.
- RefEngine speed (same script, M1 fixture upscaled, `compile(defaultRecipe)` up to `output.display`):

  | size, mode | first | time | filtration | lights | grade |
  |---|---|---|---|---|---|
  | 300×200 exact | 5170 ms | 3463 | 3091 | 2846 | 1717 |
  | 300×200 tabulated | 5010 | 3113 | 2609 | 2470 | 1866 |
  | 1024×683 tabulated | 14326 | 7236 | 9304 | 11106 | 7136 |

- Merged `task/chb-017-data-switch` (7ee3276) on the coordinator's request: packs served by
  `packages/data/vite-packs.ts`, `loadDefaultPhysicsData()` in gpu.

### Why
- Decisions: (1) one host file, `apps/studio/src/host/engines.ts`, is the only studio module that imports core,
  gpu and ingest (boundary exception); (2) a contract-only wrapper (`StudioEngine`) computes what the physics
  engine lacks as plain image work on its results; (3) scans are decoded by ingest and reduced to a *working
  image* (GPU 4000 px long side, reference 512 px) handed to the engines through a small `openDecoded` glue
  method — their `open()` only reads TIFF; (4) the test strip is built in the studio from ordinary print nodes,
  because `darkroom.testStrip` takes only the dyes and cannot know the enlarger settings.

### What worked
- The design keeps the UI on the contract: everything physical arrives through injection.

### What didn't work
- `cat > …/bench.ts <<'EOF' … node …` in one Bash call: refused by the worktree guard ("too complex to verify");
  wrote the file with the Write tool instead.

### What I learned
- The reference engine always computes every pixel at full size (previews are sampled from it), so its
  working image must be small; ~13 µs/px plus ~1.7 s fixed per change in tabulated mode.
- GpuEngine samples the source nearest per output pixel (no area filter), another reason for an
  area-averaged working image (ingest `region()`).

### What was tricky to build
- N/A (planning step).

### What warrants a second pair of eyes
- The working-image size changes pixel coordinates in recipes (probes, masks) between engines: a frame edited
  on the GPU (4000 px) and reopened without WebGPU (512 px) has its pinned probes in the wrong place.

### What should be done in the future
- A full-resolution path (tiled export, CHB-011) instead of the working image for export.

### Code review instructions
- Read `apps/studio/src/host/` top to bottom: `engines.ts`, `studio-engine.ts`, `first-print.ts`, `export.ts`.

### Technical details
- Ops computed by the wrapper: `output.frame`, `view.inspect`, `invert.classes`, `invert.classify`, and
  `output.display` in Display P3 for the GPU (its sRGB result re-encoded).

## Step 2: The studio on the real engines

The studio now boots on GpuEngine (or RefEngine without WebGPU), decodes scans through ingest, makes an
automatic first print, and runs the enlarger controls, views, densitometer, history, test strip, ring-around
and PNG export on real physics. The first runs found two real problems: the GPU's sRGB-only display encoder
and, more important, that the enlarger time had no effect at all — fixed by merging CHB-010.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Stages 1–4 of the task list.
**Inferred user intent:** see Step 1.
**Commit (code):** 194e17b — "CHB-023 WIP: host engine, studio on real engines (before CHB-010 merge)" (WIP,
taken before the merge, checks not run at that point); 901b576 — merge of `task/chb-010-printing`; 2938d79 —
"CHB-023: studio on the real engine — host file, ingest decode, first print, strip, export".

### What I did
- Glue in packages (recorded here as the brief asks; no physics changed):
  - `packages/core/src/engine-ref.ts`: `RefEngineOptions.cacheLimit` (LRU over `full` and `results`, default
    unbounded) and `openDecoded(info, data)`.
  - `packages/gpu/src/engine-gpu.ts`: `GpuEngineOptions.cacheLimit` (LRU over `results`), `openDecoded`, the
    rebate transmittance cached per `scan.density` node id (it re-read the whole frame on every slider step),
    and `measure.densitometer` at full scale evaluating only the aperture (it read back the whole frame).
- `tools/scripts/check-boundaries.ts`: `except: ['apps/studio/src/host/engines.ts']`.
- `apps/studio/package.json`: `@chromobench/core`, `gpu`, `ingest`, `@colorhythm/libraw-wasm@1.1.1`.
- `apps/studio/src/host/engines.ts`: `createHostEngine({ want, long })` — packs via `loadDefaultPhysicsData()`,
  `GpuEngine.create({ data, cacheLimit: 24 })`, else `RefEngine({ data, cacheLimit: 48 })`; decode with
  `decodeAsync` (LibRaw worker started lazily, `?url` wasm), `linearise`, `region()` to the working size; the
  film base from core's `rebateBox` rule (the same rule `scan.density` uses) reported as densities; optional dust
  healing (`detectSpecks`, `heal`); catalog lists (film/paper stocks, `SCANNER_IDS`, illuminants) from the packs.
- `host/studio-engine.ts` (contract-only), `host/first-print.ts`, `host/export.ts` (`encodePng8`, the CHB-011
  swap point), `src/env.d.ts` (`*?url`).
- Studio: `StudioHost` (label, firstPrint, notes, settings); `FrameSession.open({ initial: fn, sha256 })`;
  `setKnownValues`, `addScanExtensions`; `RenderRequest.bands` + `evaluateBands` (each band evaluated over its
  own box only); `Studio.stripBands()`, `exportPng()`, `recipeJson()`; engine pill and conditioning notes in the
  view bar; Export PNG / colour space / Save recipe in the top bar; dust checkbox in the library; `main.tsx`
  boots `?engine=auto|gpu|reference|mock`.
- `vite.config.ts`: `worker.format: 'es'`, `optimizeDeps.exclude` LibRaw, a `precache.json` writer for the
  service worker.
- Tests: `e2e/studio-real.spec.ts` (gpu + reference), `apps/studio/test/host.test.ts` (10 tests); the CHB-009
  specs now load `?engine=mock` (their goldens are the mock's numbers).

### Why
- First print: `print.enlarger.mode = 'real'` set explicitly (contract request C4 about the default is open);
  the frame's paper exposure (the `print.lights` node, central 80 %, ≈ 0.2 MP) is integrated to grey with core's
  `integrateToGrey` (α = 1), the mean goes into the time on the slider's 1/6-stop grid, the colour remainder
  into the printer lights, two passes; the result is the frame's *initial* recipe, so before/after compares
  against the first print. `print.lights.auto` records it (`method: 'integrate'`).
- Strip readings: the visual density at each band's centre, from the band's own print-xyz node.

### What worked
- After the CHB-010 merge: `STUDIO_PORT=4471 CI=1 npx playwright test --project chromium-webgpu` → 17 passed;
  full suite 45 passed; `pnpm test` → `Test Files 47 passed`, `Tests 1999 passed (1999)`; lint
  `import boundaries ok (92 file checks)`; `gen:check ok (18 files)`; `contract:check` unchanged
  (`20 change(s), 4 breaking`, the 0.1→0.2 baseline).

### What didn't work
- GPU first run: `E_NOT_IMPLEMENTED: output.display space display-p3 is not implemented by the GPU engine (srgb
  only)` — the presenter (also Canvas2D) asks for P3. Fix: the wrapper treats a P3 `output.display` as not native
  on the GPU and re-encodes its sRGB twin node (linear sRGB → P3 matrix, same transfer curve).
- `expect(p1[1]).toBeLessThan(p0[1])` failed on the GPU with equal values. A probe page evaluating
  `print.expose` at one pixel for t = 5, 10, 20, 40 s in both modes gave `x = [0.2276, 0.1566, 0.0568]` every
  time, in both engines: core's `makePrintChain` fitted the grey-0.184 aim lights to each setting, cancelling
  time (and the filtration's density). With `aim: 'midgray-normalised'` the time worked (Δx = 0.301 per doubling).
  The coordinator then reported CHB-010 (bfe7258, 90f98a1) fixes exactly this (aim fitted once, at calibration);
  merged it, removed the midgray workaround; the default aim now responds to time in both engines.
- Reference strip: the band read back as `0.87172853946…` vs the print's `0.87172851947…` — the composite was
  Float32 over Float64 results. The composite (and the reorientation) now keep the engine's sample type.
- `M1: a stale proposal is refused with E_STALE`: `Received string: "rendered 7 · screen"` (4 of 4 with
  `--repeat-each 4`). A probe page showed the refusal happened (`refused: {… E_STALE …}`) but the next render's
  status overwrote it. The refusal now stays in the status line until the log changes (`Studio.sticky`).
- `M1: open, drag +4 pt red…` failed once in four: `AbortError: Failed to execute 'mapAsync' on 'GPUBuffer': A
  valid external Instance reference no longer exists.` — the SwiftShader WebGPU-presenter loss CHB-009 describes;
  passed on the other runs and in the full suite. My specs use `?canvas2d`.
- `vitest` swallowed `console.log` in a debug test (as CHB-017 noted); used a thrown error to read the numbers.

### What I learned
- The display chain needs only four small host ops to run on the GPU; everything else is native.
- Since CHB-010, real mode + the default aim behaves as an enlarger in both engines.

### What was tricky to build
- `output.frame` regions: the requested region is in the oriented, cropped frame; it is mapped back
  (`unorientBox`, continuous corners) plus the crop origin, evaluated, then reoriented pixel by pixel; tested
  against the mock's own `output.frame` for all eight orientations with a crop and a sub-region.
- The first print must not run again on reopen: its log is persisted right after creation.

### What warrants a second pair of eyes
- `firstPrint` α = 1 (full colour correction): sunsets will go grey; Chromogen used 0.75.
- The rebate rule (brightest 5 % columns) is wrong for scans with sprocket holes or without film edge; the
  note warns when the band sits at the white level.
- Glue in `engine-gpu.ts` `measure()`: the densitometer path duplicates the reduction call.

### What should be done in the future
- `print.combine` and `mask.*` in core and gpu (dodge/burn); rotation/crop in the viewer; a rebate-box tool.

### Code review instructions
- `git show 2938d79 -- apps/studio/src/host packages/core/src/engine-ref.ts packages/gpu/src/engine-gpu.ts`.
- `npx vitest run apps/studio`; `STUDIO_PORT=4471 CI=1 npx playwright test e2e/studio-real.spec.ts --project chromium-webgpu`.

### Technical details
- sRGB→P3: `[[0.8224621, 0.177538, 0], [0.0331941, 0.9668058, 0], [0.0170827, 0.0723974, 0.9105199]]`.
- Class colours in the Base view: ok grey, blank blue, below base yellow, out of gamut magenta.

## Step 3: Decoders, the offline build, timings, and what to try on a real GPU

The photographer's file types now have browser tests: a deflate-compressed 16-bit TIFF, a 16-bit PNG and a
Bayer DNG through LibRaw's worker, each a synthetic negative that the first print balances. The production
build runs the same specs and starts offline from the service worker. A `bench()` hook measures frame times.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Stage 4 (static offline build, how-to note, smoke e2e) and what can be prepared
for stage 5 (real GPU) without one.
**Inferred user intent:** see Step 1.
**Commit (code):** see the commit after this step ("CHB-023: decoder e2e, offline build check, bench hook, DEMO.md").

### What I did
- `e2e/studio-decoders.spec.ts`: 1200×800 TIFF (deflate, predictor 2), PNG (16-bit, linear), DNG 2400×1600
  RGGB (LibRaw scan mode, CFA-binned to 1200×800); checks notes, working size, `auto: 'integrate'`, and that the
  denser side of the ramp prints lighter.
- `e2e/studio-real.spec.ts`: ring-around (11 tiles, centre tile = main node, +Y raises blue light), `bench(4)`,
  and an offline start (online visit, reload under the service worker, offline reload, open a file).
- `window.chromobench.bench(steps)`: drag previews of the time (draft pass), one screen pass, one export.
- The note in the view bar for RAW: "camera RAW (make model) via LibRaw, scan mode, CFA-binned to W×H".
- `apps/studio/DEMO.md`.
- Production build served by `vite preview --port 4473`, specs run with `STUDIO_PORT=4473` (reusing it).

### Why
- Testing against the build catches what the dev server hides (worker format, wasm URL, emitted packs).

### What worked
- Dev server: decoders 3 passed (TIFF 13 s, PNG 13 s, DNG 12 s on SwiftShader); build: real + decoders
  5 passed, offline 1 passed; dev offline 1 passed.
- `bench(4)` on the 96×64 fixture: GPU (SwiftShader) draft median 46 ms, screen 11 ms, export 21 ms; reference
  draft 92 ms, screen 4 ms, export 6 ms.
- A 24 MP timing run (6000×4000 TIFF) was started on SwiftShader and stopped at the user's request; no numbers.

### What didn't work
- First DNG run: `Expected substring: "DNG" / Received string: "RAW 1200×800, 32-bit · base …"` — LibRaw images
  report `format: 'raw'`; the note text now names LibRaw and the test expects it.
- `page.setInputFiles` with a 24 MP TIFF buffer: `Error: Cannot set buffer larger than 50Mb` — the benchmark
  writes the file to the scratchpad and passes the path.
- A dev-server run once failed with `http://localhost:4185 is already used` (the GPU parity server of a run that
  had just ended); the retry passed.

### What I learned
- The service worker's runtime cache is enough for an offline start of the real engine (packs cache-first).

### What was tricky to build
- `precache.json` must leave out `/packs/`: the install step puts it in the shell cache, but the fetch handler
  looks for packs only in the packs cache.

### What warrants a second pair of eyes
- The offline test relies on the second (controlled) load fetching the packs through the worker.

### What should be done in the future
- **On a real GPU (task 4h85), try first:** (1) `pnpm --filter @chromobench/studio build && … preview`, open
  Chrome/Edge without `?canvas2d`: does the WebGPU P3 presenter hold its device (status must not say "device
  lost")? (2) open a real 24 MP scan (TIFF and his camera RAW), then in the console `await chromobench.bench()`
  and record draft/screen/export times; drag the time slider and watch for stutter. (3) `?long=0` (full size)
  vs the default 4000 px: memory in the task manager and bench numbers. (4) Export PNG in Display P3 and check
  the file opens with the P3 profile. (5) Compare a frame on `?engine=reference` for a sanity check of colours.

### Code review instructions
- `STUDIO_PORT=4471 CI=1 npx playwright test e2e/studio-decoders.spec.ts e2e/studio-real.spec.ts --project chromium-webgpu`.

### Technical details
- Working sizes: GPU 4000 px long side (`?long=`), reference 512 px. GPU result cache 24 entries, reference 48.

## Step 4: Final gate and hand-back (milestone)

Final checks before the last commit; the stage-5 task (real GPU) stays open, the timing run was dropped at the
user's request ("no need for timing run, wrap it up after the diary").

- `pnpm typecheck` clean; `pnpm lint` `import boundaries ok (92 file checks)`; `pnpm gen:check` `ok (18 files)`;
  `pnpm contract:check` `20 change(s), 4 breaking` (unchanged baseline); `pnpm test` `47 files, 1999 passed`.
- Browser: `STUDIO_PORT=4481 npx playwright test` → `48 passed, 1 failed`: `M1: open, drag +4 pt red…`, the
  SwiftShader presenter loss of Step 2; `--repeat-each 3` of that spec → `6 passed`. Port 4471 and 4185 were
  still held by the dev and parity servers of the stopped timing run, so this run used 4481 and reused 4185
  (same worktree's code) instead of `CI=1`.
- Tasks checked: gdas, 53u2, if75, osbf, vjlj, 4tex, ar6l, z86l. Open: 4h85 (real GPU; checklist in Step 3).
