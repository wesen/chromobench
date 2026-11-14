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
