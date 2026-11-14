---
Title: Diary — the first print's Time on both engines (task fusz)
Ticket: CHB-034
Status: active
Topics:
    - gpu
    - testing
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - apps/studio/src/host/first-print.ts
    - apps/studio/src/host/decode.ts
    - apps/studio/src/host/engines.ts
    - apps/studio/src/host/studio-engine.ts
    - apps/studio/src/host/engine-serve.ts
    - apps/studio/src/main.ts
ExternalSources: []
Summary: "Why the first print proposed 5.612 s on the GPU engine and 6.3 s on the CPU engine for the same NEF (the metered image's resolution, not the GPU's precision), and the fix: both engines meter the same 640 px area-averaged analysis image."
LastUpdated: 2026-11-14T18:00:00-05:00
WhatFor: "What decides the first print's Time, and why it must be metered on a fixed analysis image."
WhenToUse: "Before changing the first print's metering, the working sizes of the engines, or the decode's working image."
---

# Diary

## Goal

Task `fusz` of CHB-034: the first print of a photo must propose the same enlarger Time on the GPU engine and on the
CPU reference engine. This diary records where the engines' metered exposure differs, the fix, and the before/after
numbers on the photographer's files. It was delegated by the orchestrator to a sub-agent working in its own worktree
(branch `task/chb-034-first-print-time`).

## Step 1: Where the 0.0058 log H comes from — the metered image's resolution, not the GPU

The first print meters the paper exposure that `print.lights` hands `print.develop`, averaged as log10(mean 10^x)
over the central 80 % of the frame (`measureExposure`, `apps/studio/src/host/first-print.ts`). On DSC_8559 the GPU
engine's total (log10 Time + mean lights) was 0.7726, the CPU engine's 0.7784, on either side of the 1/6-stop
rounding boundary at 0.7742. The suspect named in the brief was the GPU's preview precision (Metal's 8-bit filter
weights). It is not: with the same working image the engines agree to 4e-6 on Metal and on SwiftShader. What differs
is the image each engine meters. The CPU engine's working image is 640 px (area-averaged from the file), the GPU's is
4000 px; the analysis reads 200 000 nearest samples of whichever it has. The mean of a nonlinear chain over a picture
depends on how much detail (and grain) the picture holds, so the 640 px image meters 0.0084 log H higher than the
4000 px image of the same file on the same CPU engine.

The decomposition, all on DSC_8559, total = log10(Time) + mean(lights): CPU 640 px 0.7784 → CPU 4000 px 0.7700
(working size, −0.0084); CPU 4000 px → GPU 4000 px 0.7726 (+0.0026, the same on SwiftShader and on Metal, so not the
hardware filter); GPU 640 px 0.7784 (= CPU 640 px). The number of samples does not matter (200 000 or 2 000 000
samples of the 4000 px image: 0.76997 / 0.76999), and neither does the decode (the 640 px binned read 0.77841, the
4000 px demosaic area-averaged to 640 px 0.77825). Scene detail, film grain and the DIR coupling each carry part of
the resolution dependence (the gap 640 vs 4000 px: 0.0084 with all on, 0.0060 without grain, 0.0061 without DIR,
0.0038 with grain, DIR and halation off).

### Prompt Context

**User prompt (verbatim):** "go ahead. Commit at appropriate intervals, and write a frequent and detailed diary, see ~/.codex/skills. Subagents should write their own diary with the same format / skill."

**Assistant interpretation:** The orchestrator delegated task `fusz` (CHB-034) to this sub-agent: find where the
engines' first-print metering differs, fix it so both propose the same Time, keep the other first-print results,
commit on `task/chb-034-first-print-time`, keep this diary.

**Inferred user intent:** A photographer who switches engine (or whose machine has no WebGPU) gets the same first
print; the cause understood, not papered over with a tie-break.

**Commit (code):** none in this step (investigation; script 05 committed with Step 2's diary).

### What I did
- Branch `task/chb-034-first-print-time` from `main` (b4494e5); `pnpm install`; symlinked the private
  `.playwright-mcp/photos` and `scans` from the main checkout (`git check-ignore` first: `.gitignore:7`).
- Read `first-print.ts`, `engines.ts`, `decode.ts`, `studio-engine.ts`, `engine-serve.ts`, the GPU engine's
  `evaluate`/`render`/`sourceTexture` (`packages/gpu/src/engine-gpu.ts`), the pointwise kernel's source read
  (`packages/gpu/kernels/pointwise.wgsl:299`, nearest sample) and `chain/run.ts` (preview: `LOOKUP.hw`).
- New `scripts/05-first-print-metering.ts`: opens files under several page configurations and prints Time, lights
  and their total. Browser `metal` = installed Chrome headed (GPU lock taken), `sw` = bundled Chromium with the
  SwiftShader flags, `cpu` = bundled Chromium (reference engine).
- A temporary Vitest probe (`apps/studio/test/zz-fusz-probe.test.ts`, not committed, deleted) running core's
  RefEngine in Node on DSC_8559 decoded at 640 and 4000 px, with variants (sample count, decode, development).
- Build + `vite preview --port 5641`; GPU lock for the Metal runs (it was held by the orchestrator first; the
  script waited, ran, and released it).

### Why
- The brief: establish where the difference comes from before choosing a fix. Each run changes one thing.

### What worked
- In the app (script 05), DSC_8559:

  | Run | Working size | Time s | lights | total |
  |---|---|---|---|---|
  | CPU engine (tabulated previews) | 640 | 6.3 | −0.020935 | 0.778406 |
  | CPU engine, `refMode=exact` | 640 | 6.3 | −0.020851 | 0.778490 |
  | CPU engine, `refLong=4000` | 4000 | 5.612 | +0.020848 | 0.769966 |
  | GPU on SwiftShader, `long=640` | 640 | 6.3 | −0.020938 | 0.778403 |
  | GPU on SwiftShader | 4000 | 5.612 | +0.023453 | 0.772571 |
  | GPU on Metal, `long=640` | 640 | 6.3 | −0.020939 | 0.778402 |
  | GPU on Metal, `long=1024` | 1024 | 6.3 | −0.022992 | 0.776349 |
  | GPU on Metal (default) | 4000 | 5.612 | +0.023453 | 0.772571 |

- In Node on core's RefEngine (probe), DSC_8559, total:

  | Image | total |
  |---|---|
  | 640 px, binned read (the app's CPU working image) | 0.77841 |
  | 4000 px demosaic area-averaged to 640 px | 0.77825 |
  | 4000 px demosaic, 200 000 samples | 0.76997 |
  | 4000 px demosaic, 2 000 000 samples | 0.76999 |

  | Development | 640 px | 4000 px | gap |
  |---|---|---|---|
  | default (grain 1, DIR 1, halation 1) | 0.77841 | 0.76997 | 0.0084 |
  | no grain | 0.77629 | 0.77028 | 0.0060 |
  | no halation | 0.77836 | 0.76988 | 0.0085 |
  | no DIR | 0.78318 | 0.77711 | 0.0061 |
  | none of the three | 0.78106 | 0.77729 | 0.0038 |

### What didn't work
- First probe run: `ChromobenchError: E_FORMAT: TIFF holds an undemosaiced CFA mosaic` — I passed the file name
  without `.NEF`, so `decodeAsync` chose the TIFF reader. Fixed by passing `DSC_8559.NEF`.
- Second probe run: `console.log` from the passing test never reached the output (`grep '^{'` found nothing after
  373 s). Re-ran with the rows appended to a file (`FUSZ_LOG`).
- The SwiftShader runs are slow to start (36 s at 640 px, the first 4000 px open about 26 s), not a failure.

### What I learned
- The engines compute the same first print from the same pixels (GPU 640 px on Metal vs CPU 640 px: 4e-6 log H).
  Metal's 8-bit filter weights move the metered total by less than 1e-6 here (Metal and SwiftShader at 4000 px give
  the same 0.772571).
- The metered exposure is a property of the image's resolution: log10 of the mean of 10^x over a nonlinear chain
  (film curve, grain, DIR) is larger when area-averaging has removed detail first (Jensen). 640 → 1024 → 4000 px:
  0.7784 → 0.7763 → 0.7726. So the first print depends on the working size, and the two engines have different
  working sizes by design (CPU 640, GPU 4000).
- CHB-031 Step 8 (5.612 s, lights +0.0228 on the CPU engine) predates F22's binned read and the later picture
  changes; today the CPU engine gives 6.3 s for that file, the GPU engine 5.612 s.

### What was tricky to build
- Separating causes needed runs that change one variable each. The URL options (`long`, `refLong`, `refMode`)
  covered working size and table mode in the app; the hardware filter was isolated by running the same GPU engine
  on SwiftShader (exact f32 filter weights, CHB-034 Step 6) and Metal; the decode and the development effects only
  in Node, where the probe reproduced the app's CPU numbers to 1e-5 (0.77841 vs 0.778406; 0.76997 vs 0.769966).

### What warrants a second pair of eyes
- The residual CPU 4000 vs GPU 4000 (+0.0026) is not explained here. It is the same on SwiftShader and Metal, so it
  is not the filter; candidates are where the engines compute grain, DIR and halation for a sampled preview (the
  CPU engine's sampled stages vs the GPU's `umOut` per output pixel). It does not matter for the fix below (both
  engines will meter the same 640 px image), but it means the GPU and CPU engines do not render the same preview
  of a 4000 px image. Recorded as a follow-up.

### What should be done in the future
- Follow-up: the CPU engine at 4000 px and the GPU engine at 4000 px meter 0.0026 log H apart (grain/DIR/halation
  at a sampled preview scale?).

### Code review instructions
- `scripts/05-first-print-metering.ts`; run it against a preview with `--runs 'cpu:engine=reference' 'sw:engine=gpu&long=640'`.

### Technical details
- Analysis grids: CPU 640 × 428 working image, box 512 × 342 = 175 104 px < 200 000, so `scale: 'full'`; GPU
  4000 × 2674, box 3200 × 2139, scale 0.1709, 547 × 366 nearest samples of the 4000 px image.
- A photo's first print keeps half of the frame's density (`FIRST_PRINT_AIM['digital-raw'].density = 0.5`), so a
  metering difference of Δ in the frame's exposure moves the total by Δ / 2: x0 0.44319 (640 px) vs 0.46007
  (4000 px) → totals 0.77841 vs 0.76997.

## Step 2: The fix — every engine meters the image the CPU engine works on (640 px)

Step 1 left three ways to get one Time: meter both engines at 4000 px (the CPU engine took 445 s for that open),
change the statistic so it does not depend on resolution (that changes every first print, CPU numbers and unit tests
included), or have both engines meter the same picture at the CPU engine's size. I chose the third. The decode now
also makes the first print's analysis image, the working image that a decode at `ANALYSIS_LONG` = 640 px would make,
when the engine's working size is a different size. The image is registered with the engine as a source of its own,
`analysisSha(sha)`. The first print measures the recipe on it: the recipe's source is pointed at the analysis image,
and the boxes a first print has (a strip frame's crop, the rebate, an open-gate box) are converted to its pixels. The
recipe the first print returns still refers to the file's own source. At the CPU engine's default 640 px no analysis
image is made, so the CPU engine computes exactly what it did before.

The first version area-averaged the engine's *working image* down to 640 px. On SwiftShader at `long=1024` that
metered 0.779939 against the CPU's 0.778406 (0.0015). Area-averaging an image that is already area-averaged, at a
non-integer factor, blurs more, and blur raises the metered value (the effect behind Step 1). The analysis image is
now made from the linear file, the same way the decode at 640 px makes its working image. After that change the
1024 px GPU run metered 0.778403 (the CPU engine: 0.778406), and the 4000 px run 0.778025. What is left for photos is
the decode itself: at 640 px the CPU engine reads the camera RAW binned, while the GPU engine at 4000 px uses the
demosaic.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Implement an engine-independent metering basis chosen from Step 1's evidence.

**Inferred user intent:** Same first print on both engines, without changing what the CPU engine's users get.

**Commit (code):** 9c6739f — "CHB-034: fusz — the first print meters a 640 px analysis image on every engine"

### What I did
- `apps/studio/src/host/studio-engine.ts`: `ANALYSIS_LONG = 640`, `analysisSha()`, the `AnalysisImage` type,
  `Decoded.analysis` (info, pixels, a strip's frames). In `openAs` the analysis image is registered with the engine
  (when its pixels are on this thread) and with the wrapper's graph. `notes` keeps its info and frames without the
  pixels. `forget` drops the analysis image as well and registers the other files' analysis images again.
  `analysisOf(sha)` returns the info, the working → analysis scale, and the frames on both images when the counts
  match.
- `apps/studio/src/host/decode.ts`: `DecodeOptions.analysisLong`. `decodePhoto` area-averages the linear file to the
  analysis size, turned like the working image. `decodeScan` is split into decode + `scanWorking`. The analysis image
  of a strip is `scanWorking` again at 640 px on a copy of the roll, so a strip is sized for its frames and its frames
  are found at that size, as the CPU engine does. `withAnalysis` attaches the result when it is smaller than the
  working image.
- `engine-serve.ts`, `worker-protocol.ts`, `worker-engine.ts`: `analysisLong` on the decode job. The worker's
  `register` message registers the analysis image along with the source. A `return` decode transfers both buffers.
- `engines.ts`: every decode asks for `analysisLong: ANALYSIS_LONG`.
- `first-print.ts`: `FirstPrintOptions.analysis` and `onAnalysis(r, a)` (source, crop as the analysis decode's frame
  i when the crop is working frame i, otherwise scaled, rebate, open gate). `firstPrint` measures on a graph of its
  own that holds the analysis source. `main.ts` passes `se.analysisOf(r.source.sha256)`.
- New `apps/studio/test/first-print-analysis.test.ts` (6 tests): the analysis image equals the decode at that size,
  bit for bit, for a photo, a single scan and a strip, and none is made when the sizes agree or the file is smaller.
  With the analysis image the first print gives the same Time and lights as an engine working at that size; without
  it, the totals differ by more than 0.005 on a fine checker. Also `onAnalysis`, and the worker in both modes
  (`return`, and `register` with `forget`).

### Why
- The CPU engine at 640 px is the reference the photographer's earlier sessions were tuned on. Moving the GPU engine
  onto it keeps every CPU number and unit test as it was. Metering at 4000 px on the CPU engine is not affordable.
- An analysis image of its own, instead of a new engine option (for example area sampling in `EvalTarget`), needs no
  contract change. It also covers the spatial stages (grain, DIR, halation), which are computed on the analysis
  image's own µm per pixel, exactly as on the CPU engine's working image.

### What worked
- Typecheck, lint, gen:check; `pnpm test`: 105 files, 2797 passed, 19 skipped.
- DSC_8559 after the fix: CPU 6.3 s, total 0.778406 (unchanged); GPU on SwiftShader `long=1024` 0.778403; at 4000 px
  0.778025, so Time 6.3 s on both engines.

### What didn't work
- The first version (analysis image from the working image): 0.0015 log H left at `long=1024`, see above.
- `pnpm typecheck`: `decode.ts(256,11): error TS2339: Property 'w' does not exist on type 'SourceInfo'` (SourceInfo
  has `width`/`height`), and later `TS2379 … 'Pick<DecodeOptions, "raw" | "long" | "analysisLong">' is not assignable
  to parameter of type 'DecodeOptions'` (`withAnalysis` takes the narrower Pick now).
- The strip test first asserted the analysis size from the working image's boxes (an `analysisSize` helper, since
  removed). It was 6 px off the decode at 128 px (164 × 330 vs 170 × 341): the frames found at the small size are
  inset differently, so `stripScale` gives another size. Hence the second `scanWorking` at the analysis size.
- Vitest printed no `console.log`/`console.error` output from the probes in this setup. The probes wrote their rows to
  a scratch file instead.

### What I learned
- An analysis image is only "the same picture" when it is made the same way: same source (the linear file), same
  single area-average, and for a strip the same frame detection at the same size.

### What was tricky to build
- The engine worker keeps the reference engine's pixels (`keep: 'register'`). The analysis image has to be registered
  where its pixels are: in the worker together with the source on the `register` message, and on the main thread only
  when the pixels came back (`StudioEngine.openAs` registers it only when `analysis.data` is there).
- `StudioEngine.adopt` puts every adopted node into its own graph as well, and a `source.open` node needs its source
  registered there. So the analysis image is registered in the wrapper's graph too, and again after `forget` rebuilds
  the graph.
- A strip frame's crop: the frames found on the 4000 px image and on the 640 px image are not the same boxes scaled.
  `onAnalysis` matches the crop to working frame i and uses analysis frame i. It scales the crop only when it is not
  one of the frames, or when the counts differ.

### What warrants a second pair of eyes
- `decodeScan` for a strip now runs the conditioning twice (at the working size and at 640 px, on a copy of the roll).
  The roll map must not get a second entry: the test checks that it holds only the file's own.
- `analysisSha` must never collide with a file's sha. It is a SHA-256 of a prefixed string, so it cannot unless SHA-256
  collides.

### What should be done in the future
- See Step 3's follow-ups.

### Code review instructions
- Start at `first-print.ts` (`onAnalysis`, the measuring loop of `firstPrint`), then `decode.ts` (`withAnalysis`, the
  ends of `decodePhoto` and `decodeScan`), then `studio-engine.ts` (`openAs`, `forget`, `analysisOf`).
- `npx vitest run apps/studio/test/first-print-analysis.test.ts`.

### Technical details
- `onAnalysis` leaves alone what a first print never has (retouch spots, masks, probes): they are added later and are
  never measured by the first print.

## Step 3: Before and after on the private files; an e2e test with teeth; single scans without a second conditioning

I built the pre-fix sources (checked out from b4494e5 into `apps/studio/src`, `vite build --outDir
<scratch>/dist-before`, then restored), served them on 5642 next to the fixed build on 5641, and metered the ten
files of script 03 with script 05 on both engines, the GPU engine on Metal under the GPU lock. All six photos now get
a GPU total within 0.0004 log H of the CPU's, and DSC_8559 gets 6.3 s on both engines. The CPU engine is
bit-identical before and after on all fifteen frames. The strips move by up to 0.0017 but stay 0.001–0.003 apart. A
SwiftShader run of raw007 shows why: at 640 px the GPU engine equals the CPU engine exactly, and at 4000 px the two
recipes hold different measured base densities. The decode measures the film base on the working image, and at
4000 px it found the rebate on a frame gap instead of the film edge. That is a recipe value, not metering, and it is
recorded as a follow-up.

The existing e2e specs open synthetic files that are too smooth to show the effect. A new test in
`e2e/studio-photo.spec.ts` opens the spec's synthetic DNG with a fine checker on both engines. Without the fix it
failed (GPU 7.937 s, CPU 8.909 s); with it, it passes on SwiftShader and on Metal. One cost showed in the open times:
the scans opened about 0.3 s slower on the GPU engine, because the analysis decode ran the conditioning again. For a
single frame that is not needed (the pixels are just the file area-averaged), so only strips keep it now.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Show before/after on the photographer's files, keep the rest of the first print as it
was, and have a regression test.

**Inferred user intent:** Evidence that the fix does what it claims and nothing else.

**Commit (code):** 7ec3684 — "CHB-034: fusz — e2e: a photo's first print gives the same Time and lights on the GPU and
the CPU engine …"; 53e8c94 — "CHB-034: fusz — a single-frame scan's analysis image is the file area-averaged …"

### What I did
- Script 05 against 5642 (before) and 5641 (after): `cpu:engine=reference` without the lock, `metal:engine=gpu` with
  it (`mkdir …/gpu.lock`, owner `first-print-agent`, `rm -rf` afterwards). It now also prints the scan settings.
- raw007 on SwiftShader at 4000 and at 640 px, next to the CPU engine.
- New e2e test; checked that it fails with `analysis:` removed from `main.ts` (then restored from HEAD).
- Timed `decodeScan` of raw000 in Node (temporary test, deleted): 588–770 ms without the analysis image, 879–975 ms
  with the second conditioning. Single frames: the area-average only (`!d.frames && !o.dust`).
- Re-metered six files on Metal after the change: the same totals; roll-102 opens in 2757 ms (before the fix 2708).

### Why
- Before/after per file is what the task asked for, and the engines' numbers had to be compared on the same build.

### What worked
- Time s / lights log H / total; CPU = before and after (identical); GPU on Metal before → after:

  | File · frame | CPU | GPU before | GPU after | Δtotal before → after |
  |---|---|---|---|---|
  | DSC_8559 | 6.3 / −0.0209 / 0.7784 | **5.612** / +0.0235 / 0.7726 | 6.3 / −0.0213 / 0.7780 | −0.0058 → −0.0004 |
  | DSC_8541 | 5.612 / 0.0096 / 0.7587 | 5.612 / 0.0084 / 0.7575 | 5.612 / 0.0095 / 0.7586 | −0.0012 → −0.0001 |
  | DSC_8536 | 4.454 / 0.0236 / 0.6723 | 4.454 / 0.0224 / 0.6711 | 4.454 / 0.0234 / 0.6722 | −0.0012 → −0.0001 |
  | DSC_8655 | 5 / −0.0178 / 0.6812 | 5 / −0.0169 / 0.6821 | 5 / −0.0179 / 0.6810 | +0.0009 → −0.0001 |
  | DSC_8553 (90°) | 6.3 / −0.0195 / 0.7799 | 6.3 / −0.0217 / 0.7776 | 6.3 / −0.0198 / 0.7796 | −0.0022 → −0.0003 |
  | DSC_8521 (270°) | 5 / 0.0203 / 0.7192 | 5 / 0.0187 / 0.7177 | 5 / 0.0201 / 0.7191 | −0.0015 → −0.0001 |
  | raw010 1/3 | 2.227 / .080 .002 −.152 / 0.3244 | 2.227 / .077 −.002 −.155 / 0.3209 | 2.227 / .078 −.001 −.155 / 0.3218 | −0.0035 → −0.0026 |
  | raw010 2/3 | 2.806 / .084 .024 −.095 / 0.4524 | 2.806 / .082 .021 −.098 / 0.4499 | 2.806 / .082 .021 −.098 / 0.4497 | −0.0025 → −0.0027 |
  | raw010 3/3 | 3.15 / .013 .043 .012 / 0.5208 | 3.15 / .011 .040 .009 / 0.5183 | 3.15 / .011 .040 .009 / 0.5181 | −0.0025 → −0.0027 |
  | raw000 1/3 | 3.15 / −.032 −.006 .018 / 0.4915 | 3.15 / −.034 −.008 .015 / 0.4894 | 3.15 / −.033 −.007 .016 / 0.4903 | −0.0022 → −0.0013 |
  | raw000 2/3 | 5 / −.029 .002 −.022 / 0.6827 | 5 / −.030 .001 −.024 / 0.6812 | 5 / −.029 .001 −.024 / 0.6815 | −0.0016 → −0.0012 |
  | raw000 3/3 | 4.454 / −.020 .017 .013 / 0.6518 | 4.454 / −.021 .017 .012 / 0.6512 | 4.454 / −.021 .016 .011 / 0.6506 | −0.0006 → −0.0012 |
  | raw007 1/2 | 3.15 / .000 .003 −.030 / 0.4893 | 3.15 / −.005 −.004 −.033 / 0.4842 | 3.15 / −.004 −.002 −.031 / 0.4859 | −0.0051 → −0.0034 |
  | raw007 2/2 | 2.5 / .099 .033 −.147 / 0.3929 | 2.5 / .095 .029 −.148 / 0.3898 | 2.5 / .095 .028 −.148 / 0.3896 | −0.0032 → −0.0033 |
  | roll-102 raw000 | 11.225 / −0.0096 / 1.0406 | 11.225 / −0.0098 / 1.0404 | 11.225 / −0.0096 / 1.0406 | −0.0002 → 0.0000 |

- raw007 (SwiftShader): GPU at 640 px = CPU to the last digit (3.15 s, lights 0.000408 0.002788 −0.030303). At
  4000 px the recipe's base is `baseT` 0.887 0.460 0.238 with the rebate at (106, 1195) on a frame gap; the CPU
  engine's is 0.898 0.466 0.239 with the rebate at (48, 4) on the film edge.
- e2e: `studio-photo.spec.ts` 2/2 and `studio-real.spec.ts` 3/3 (SwiftShader); `studio-photo.spec.ts` 2/2 on Metal
  (`REAL_GPU=1`, under the lock).

### What didn't work
- The new e2e test with the spec's smooth ramp passed even without the fix (the engines agreed closely enough). A
  fine 2 × 2 checker (×1.8 / ×0.2) gives the difference: `Expected: 8.909 Received: 7.937` without the fix.
- Combining a git command with others in one shell line was refused by the worktree guard ("names git in a form too
  complex to verify"), so each git command ran on its own (and this diary step was written with the editor, since a
  heredoc mentioning git was refused too).

### What I learned
- The photo difference was a metering effect. For strips, the remaining difference comes from the conditioning: the
  film base measured at different working sizes, sometimes on a different place of the film.

### What was tricky to build
- A fair "before": the pre-fix build had to run against the same data packs and the same browser. Building it from
  the old sources into a scratch folder and serving both builds side by side kept the two runs one variable apart.

### What warrants a second pair of eyes
- Open time: about +0.3 s for a strip on the GPU engine (second conditioning at 640 px, in the worker, not on the main
  thread). None measurable for NEFs or single scans (within ±0.3 s run-to-run).

### What should be done in the future
- Tasks added to CHB-034: `szeo` (a negative's measured base differs by working size), `3nod` (CPU vs GPU at 4000 px,
  0.0026 unexplained), `ayqx` (the roll kit meters the working image too), `alwi` (binned vs demosaic: 0.0004 left
  for photos).

### Code review instructions
- `e2e/studio-photo.spec.ts`, the last test. Reproduce the table: build, serve, then
  `node ttmp/…/scripts/05-first-print-metering.ts --base http://localhost:<port> --files <list> --runs 'cpu:engine=reference' 'metal:engine=gpu'`
  (the `metal` runs need the GPU lock on this machine).

### Technical details
- Before/after rows: `<scratchpad>/cpu-before.jsonl`, `cpu-after.jsonl`, `gpu-before.jsonl`, `gpu-after.jsonl`,
  `gpu-after2.jsonl` (not kept; private file names and numbers only).
