---
Title: Editor lab's performance architecture, and what chromobench's engine should take from it
Ticket: CHB-035
Status: active
Topics:
    - webgpu
    - architecture
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: packages/gpu/src/chain/run.ts
      Note: 'chain runner: preview lookup, uniforms'
    - Path: packages/gpu/src/engine-gpu.ts
      Note: 'evaluate(): cache key, readback, RGBA->RGB repack; nearest sampling at reduced scale'
    - Path: packages/gpu/src/engine/dag.ts
      Note: fused pointwise tails, materialisation, intermediates released after last reader
    - Path: packages/gpu/src/engine/results.ts
      Note: 'result cache: whole images, LRU by count and bytes'
    - Path: packages/gpu/src/tiles.ts
      Note: tile planner with halos and reduced-resolution global fields
    - Path: packages/shell/src/app/render/queue.ts
      Note: 'render queue: slots, epochs, lanes; chooseTarget draft/screen/refine'
ExternalSources:
    - ~/Downloads/editor-lab-work.zip (Editor lab, book chapters 5–9, REPORT.pdf, perf-lab PDF)
Summary: 'An intern''s guide to interactive image-engine performance through Editor lab''s tiles, pyramids, content-keyed caches, scheduling, GPU/WASM probes and bench, set against chromobench''s engines as they are, with measured numbers from both and a ranked list of changes: GPU residency first (readback costs several times the chain on a Retina-size preview), then a source pyramid, checkpoints, open-loop measurement.'
LastUpdated: 2026-11-14T20:00:00-05:00
WhatFor: Deciding what to build next for interactive speed, with evidence.
WhenToUse: Before changing the GPU engine's caching, presentation, preview sampling or scheduling.
---







# Editor lab's performance architecture, and what chromobench should take from it

Editor lab's authors spent most of their effort on one question: how does a browser photo editor stay interactive
while a stack of layers is edited? They wrote a nine-chapter textbook about it, read the source of darktable, GEGL,
libvips, GIMP, Krita and Chromium's compositor, built a tiled, content-cached engine, and measured it with a bench of
scenarios and modelled devices. This document teaches the ideas in order, describes what Editor lab built and what it
only designed, sets each idea against chromobench's engines as they are, and ends with a ranked list of changes.

Read one caveat before any number from Editor lab: every one of its timings comes from a container with two CPU cores
and a **software** WebGPU adapter (SwiftShader), single runs unless stated (REPORT p.14, p.17). Its engine is
single-threaded JavaScript on the main thread; WebAssembly and WebGPU exist only as probes; workers, cache tiers and
rendering at the zoom's level are designed but not built (REPORT p.16). The ideas transfer; the absolute numbers do
not. Where this document gives chromobench numbers, they were measured on the owner's M1 Max with Metal.

> **How to read this.** Part I teaches the fundamentals in dependency order. Part II describes Editor lab's engine.
> Part III describes chromobench's. Part IV compares them and proposes changes, each with a decision record and a
> measurement that would prove it. A glossary is at the end. Editor lab paths are relative to `editor-lab/`; book
> chapters are `src/book/0N.md`.

---

## Part I — Fundamentals

### 1. Requirements as numbers

"Fast" is not a requirement. Editor lab's chapter 9 starts by writing requirements as limits on measured quantities
(`09.md:9-18`):

| Event | Measure | Limit |
|---|---|---|
| any input, during any work | overlay and cursor update | every frame (16.7 ms at 60 Hz) |
| slider or brush gesture | preview update, p95 | 16.7 ms |
| end of a gesture | settle to full resolution, p95 | 250 ms for the visible area |
| undo/redo of the last ten steps | update, p95 | 16.7 ms when the tiles are cached |
| opening a 24 MP document of ten layers | first preview / full view | 500 ms / 2 s |
| any GPU or WASM kernel | difference from the reference | 0.5 of an 8-bit step |

Three ideas in this table are worth internalising.

- **Percentiles, not means.** 57 updates of 5 ms and 3 of 200 ms have a mean of 14.8 ms and a p95 of 200 ms
  (`07.md:190`). The user remembers the 200 ms.
- **Preview and settle are different requirements.** During a gesture, something approximately right must appear
  every frame. After it, the exact answer must arrive soon. An engine is designed around both.
- **Every fast path has a stated error against a reference.** Chromobench already lives by this: the GPU engine is
  checked against the f64 CPU engine (CHB-034).

### 2. Service time is not response time

A benchmark that applies an update, waits for the render, then applies the next measures **service time**. A user's
pointer produces events every 16.7 ms whether or not the engine is ready; what the user sees is **response time**,
measured from each event's intended time. Waiting for each update before issuing the next hides the queueing delay;
this is called **coordinated omission**. Editor lab's worked example (`07.md:252-254`): pointer every 16.7 ms, engine
45 ms per update, newest event wins; a closed-loop bench reports 45 ms, but the screen shows a position 45–102 ms old,
74 ms on average. The fix is an **open-loop** driver that issues events on a clock and measures from their scheduled
times (wrk2's method, `research/src/wrk2/README.md`). Editor lab's own bench is closed-loop; the book says so.

Chromobench's CHB-027/034 timing scripts drag a slider with twenty mouse moves 30 ms apart and measure until the
render counter settles. That is closer to open loop, but it reports settle time, not per-event response time.

### 3. Bandwidth and arithmetic

An image operation reads pixels, computes, and writes pixels. Exposure on f32 RGBA reads 16 bytes, writes 16 bytes and
does about 12 arithmetic operations: under half an operation per byte, so it is limited by memory bandwidth, not by
arithmetic (`08.md:7-11`). Three things help a bandwidth-bound engine: fewer passes over the image (**fusion**: run
several pointwise ops in one pass), fewer bytes per pixel (16-bit floats instead of 32), and staying in the fastest
memory (**residency**: keep images on the GPU). The third has a corollary: moving an image between CPU and GPU is
itself a pass over the image, often the most expensive one.

### 4. Tiles and reach

A **tile** is a square of T × T pixels. Tiling makes the picture's size irrelevant to memory and latency: a tile is the
unit of work, of caching and of cancellation. A neighbourhood operation of reach m must read (T + 2m)² pixels to write
T², a factor of ((T + 2m)/T)² (`05.md:15-27`):

| T | σ 1.2 (m = 2) | σ 6 (m = 16) | σ 24 (m = 70) |
|---|---|---|---|
| 64 | 1.13× | 2.25× | 10.16× |
| 128 | 1.06× | 1.56× | 4.38× |
| 256 | 1.03× | 1.27× | 2.39× |

A local edit (a brush of diameter d) recomputes about (d + T)² pixels per layer, so small tiles favour local edits and
large tiles favour wide kernels. Editor lab measured exactly that (D-01, 960 × 640, previews off): a stroke under the
adjustments took 21.2 ms at 64 px and 123 ms at 256 px; a blur sweep with reach up to 118 px took 828 ms at 64 px and
235 ms at 256 px. "No size wins all three" (`05.md:83`).

### 5. Pyramids and levels

A **pyramid** stores an image at successively halved sizes: level L has 2⁻ᴸ of the width. A screen showing a 6,000 px
picture in a 1,500 px window needs level 2, which has 1/16 of the pixels. Two rules from chapter 5:

- **Choose the level from the zoom:** L = ⌊log₂(1/(z·r))⌋ for zoom z and device pixel ratio r (`05.md:204-210`). Keep
  this separate from the **preview level**, which is chosen for latency during a gesture.
- **Downsample by area, not by picking pixels.** A 2 × 2 average (premultiplied, to avoid dark fringes) is the cheapest
  usable filter; [1,3,3,1]/8 aliases less (`05.md:216-275`).

Rendering a stack at level L is exact only for operations that commute with downsampling, `down(f(x)) = f(down(x))`
(**level invariance**). Editor lab measured it per layer kind (`05.md:281-292`, 8-bit steps, level 2 vs level 0
averaged down): tone and colour layers are close (exposure +1 EV: mean 0.40, 0.5 % of pixels off by more than 4
steps); step functions are not (threshold: 6.4 %); **grain is not at all (56.9 %)**, because noise drawn per output
pixel at level 2 is four times coarser. The rule: tone/colour previews are safe; noise and steps are not, so mark such
previews approximate or render those layers at level 0.

Pyramids also make large blurs cheap: a Gaussian of σ = 100 becomes six 2× decimations with a [1,3,3,1]/8 filter plus
an 11-tap kernel, from 1,202 reads per pixel to about 8 (Table 5.4, `05.md:300-324`; Vello's method). The apron of a
tile does not shrink: a σ = 100 blur still needs about 300 px of input around each tile.

### 6. Naming results by content

A cache needs a rule for when an entry is still valid. Two families exist.

- **Invalidation**: when something changes, mark the affected results dirty (Chromium, Krita, GIMP).
- **Naming**: give each result a key computed from everything it depends on; a changed input gives a new key, an old
  key stays valid forever (darktable, libvips, Editor lab).

Editor lab's key for a tile of layer i is a **Merkle chain**: a hash of the layer's settings, the pixel revisions it
reads, and the keys of the tiles below that its apron touches (`src/engine.js:478-504`, abridged):

```js
key(i, L, tx, ty) {
  i = this.resolve(i); if (i < 0) return 0;                          // a hidden layer passes its backdrop's key through
  const l = this.doc.layers[i];
  if (this.identity(l)) return this.key(this.top(i), L, tx, ty);    // pass-through group at full opacity: free
  const parts = [this.lh(l), L, tx * 4099 + ty, this.TS], b0 = this.below(i);
  if (l.raster) parts.push(l.raster.contentKey(/* 64 px block revisions under the tile */));
  const m = this.reach(l, L);
  if (m) for (/* every tile of the layer below that the apron touches */) below(this.key(b0, L, x, y));
  else below(this.key(b0, L, tx, ty));
  let a = 0x811c9dc5, b = 0x2545f491;                               // two 32-bit lanes …
  for (const v of parts) { a = hmix(a, v); b = hmix(b, v ^ 0x5bd1e995); }
  return a * 1048576 + (b >>> 12) || 1;                              // … combined into a 52-bit key (an exact JS number)
}
```

Consequences worth knowing:

- **Undo is free when the tiles are cached.** Restoring old settings restores old keys (`06.md:201-205`).
- **Keys are computable before any work.** The scheduler can ask "is this tile cached?" without computing anything.
  In build-system terms this is a **deep constructive trace** (`06.md:207-218`).
- **No early cutoff.** If a layer's change leaves a tile bit-identical (a masked edit far from the tile), every key
  above still changes. Editor lab measured the waste: a masked exposure change on "Darker sky" left 16 of 40 output
  tiles identical, so 33 % of the work above it was avoidable; "Sun glow" 52 % (Table 6.2, `06.md:224-231`).
- **Key width.** 52 bits fit a JS number; 10⁵ keys give a collision probability of 1.1 × 10⁻⁶. "An engine in
  WebAssembly or on the GPU has 64-bit integers and should use them" (`06.md:63-73`).

### 7. Budgets and eviction

A cache needs a byte budget and an eviction policy. Editor lab's default is 96 MB; its bench applies 64, 32 and 16 MB
for modelled laptop, tablet and phone. Two policies (`src/engine.js:400-426`): **LRU**, and **GreedyDual-Size**
(cost-aware: priority H = clock + cost/size, evict the lowest, where cost is the measured compute time). Measured on
the tablet budget (Fig. 6.3): for ten edits, ten undos, ten redos, LRU recomputed 10,560 tiles and cost-aware 2,662,
because cost-aware keeps the expensive shared tiles (Sharpen's) alive; for a brush stroke, LRU 925 against cost-aware
1,236. "Measure on the workloads, keep the policy a setting" (`06.md:176`).

**Granularity** is the other dial. Editor lab caches every layer at every tile, the simplest correct design and the
most memory-hungry. Chapter 6 proposes **checkpoints**: keep outputs only before and after expensive layers (in D-01,
the one neighbourhood layer cost 87 of 260 ms) and recompute the cheap pointwise layers between them, fused, "which on
a GPU is often cheaper than reading their cached outputs back" (`06.md:178-199`).

### 8. Scheduling under a frame budget

Editor lab's scheduler (`src/app.js:57-116`):

```text
on edit:   if the estimated full cost (EMA) > 10 ms during a gesture (40 ms otherwise):
             render the whole stack at the coarse level (1–3) at once, show it upscaled
             adapt the level: preview took > 12 ms → one level coarser; < 2.5 ms → one finer
           220 ms after the last change: queue level-0 tiles, visible first, nearest the centre first
each frame: run queued tiles for at most 8 ms, check the clock between tiles
new edit:  drop the queue (cancel by generation, between tiles, never inside one)
```

Measured (D-01, 128 px, scrubbing the lowest adjustment): previews off p95 287 ms; on p95 28 ms (17 ms in a repeat
run); settle 282–287 ms, missing the 250 ms target (`07.md:33`, `:322`). Chapter 7 adds what the lab does not do:
priorities (input > gesture preview > visible tiles > neighbours > background > persistence), `scheduler.postTask` and
`scheduler.yield()`, keeping finished results when a job is cancelled (content keys make them valid cache entries), and
GIMP's adaptive chunk sizing (aim for the area that would have filled the last interval; median of three).

### 9. The GPU and WebAssembly, as measured

Editor lab built probes, not executors, and measured them on the software adapter:

- **WebAssembly** (box pass, 960 × 640 f32 RGBA, r = 8): JS 14.6 ms, WASM scalar 3.2 ms, WASM SIMD 2.4 ms; but copying the
  result out took 6.5 ms, more than the kernel. Lesson: keep tiles inside WASM linear memory (`08.md:67-81`).
- **WebGPU fused pass** (three pointwise layers in one shader): upload 3.6 ms, readback 12 ms ("more than three times as
  long as upload"); every parameter change regenerated and recompiled the shader (79 ms), because parameters were baked
  as constants. Lesson: put parameters in uniforms, compile once per combination of kinds (`08.md:121`, `:199-213`).
- **Residency** (`08.md:192-215`): upload sources once, compute and cache on the GPU, draw the composite to a WebGPU
  canvas; read back only for export and statistics, reduced on the GPU first (a 256-bin histogram is 4 KiB, not 9.8 MB).
- **Device loss and fallback** (Figma's experience, `08.md:223-232`): fall back during a session, not only at load;
  keep the document, sources and keys where the fallback can use them; let the GPU cache start empty.
- **The hybrid split** (Table 8.3): document, keys, history and scheduling on the main thread; pointwise (fused), blurs,
  masks, blending, pyramid and display on the GPU; data-dependent serial work (flood fill, marching squares) in a worker;
  JavaScript as the reference for every kernel.

### 10. Chapter 9's engine, in one picture

```text
 UI and input (main thread, every frame)
        │ edits
        ▼
 Document: immutable versions sharing unchanged layers and 64 px blocks; history = list of versions
        │ version, view
        ▼
 Graph compiler: keys, reach, fusion of pointwise runs, checkpoints, zoom and preview levels → tile jobs
        │ jobs (a job whose key is cached is not a job)
        ▼
 Scheduler: priorities, generations, coalescing, slices; duplicate requests share one job
        │
        ▼
 Executors: GPU (WGSL)  ·  workers (WASM SIMD)  ·  reference (JS, tests and last fallback)
        │ tiles
        ▼
 Cache tiers by content key: GPU textures  ·  CPU (16-bit)  ·  disk (source pyramids, last composite)
        │
        ▼
 Screen (never a mixture of two versions that looks like an edit)          Bench and parity tests beside it all
```

Its worked budget for opening a 24 MP, ten-layer document (Table 9.4, an estimate from 57.6 ms per layer-megapixel in
JS): level 0, everything, 13.8 s; the view at level 2 on a 1× display, 0.86 s; first preview at level 3, 0.22 s.
"Rendering at the zoom's level is what makes the target reachable at all" (`09.md:168`).

---

## Part II — What Editor lab built, and what it only designed

| Mechanism | Built | Evidence |
|---|---|---|
| Per-layer tile cache, 52-bit Merkle keys | yes | `src/engine.js:478-505` |
| LRU and GreedyDual-Size under a byte budget | yes | `src/engine.js:400-426` |
| Aprons assembled from cached tiles below | yes | `src/engine.js:519-552` |
| Coarse whole-stack preview at level 1–3, adaptive | yes | `src/app.js:57-116` |
| 8 ms slices of level-0 tiles, centre first, 220 ms after the gesture | yes | `src/app.js:65`, `:84-92`, `:107-115` |
| Source pyramids (2 × 2, alpha-weighted, 8-bit) | yes | `src/engine.js:44-60` |
| Rendering at the zoom's level | **no** (level 0 at every zoom) | REPORT p.16, `05.md:210` |
| Early cutoff | **no** (priced only) | `06.md:252-259` |
| Checkpoints | **no** (proposed) | `06.md:197` |
| Workers, OffscreenCanvas, shared memory | **no** | REPORT p.16 |
| WASM and WebGPU executors | **probes only** | `src/views/wasm.js`, `src/views/gpu.js` |
| Cache tiers, 16-bit storage | **no** | `06.md:261-273` |
| Open-loop measurement | **no** (described) | `07.md:254` |
| Bench: 9 scenarios × 4 device profiles × tile size × preview × eviction | yes (closed loop; profiles scale time, apply real budgets) | `src/views/bench.js:8-144` |
| Discrete-event simulator of workloads and devices | **no** (designed in the earlier perf-lab PDF) | PERFLAB pp. 1–26 |

The earlier perf-lab design is worth a separate mention because it is the most ambitious idea in the archive: a
simulator in which real data structures and policies run against modelled executors (a roofline cost model
`t = t_setup + N_px · s(θ) · max(f_px / F_dev, b_px / B_dev) · ε`), with sessions generated from a Markov model of
gestures and undo bursts, so that policies can be compared on devices one does not own. It was not built; the in-page
bench is its small descendant.

---

## Part III — Chromobench's engines as they are

### 11. The execution path of a preview

```text
 slider drag ─► store transaction ─► recipe ─► compile() ─► graph (hash-consed node ids)
                                                                  │
 shell render queue (slots, epochs, live/bg lanes) ◄──────────────┘
   chooseTarget(): draft 500,000 px while previewing · screen = shown size × dpr (↑128) · refine at zoom ≥ 1
                                                                  │
 GpuEngine.evaluate(node, { scale, region, precision })          ▼
   cache lookup: `${nodeId}|${scale}|${region}|${precision}`  (whole images, LRU by count and 256 MB)
   miss: planGraph → pointwise tails fused between materialised nodes → WGSL passes
         source texture cached per source; intermediates released after their last reader
   readback: texture → Float32Array (RGBA → RGB repack in JS)
                                                                  │
 presenter (WebGPU Display-P3, on its OWN GPUDevice, or Canvas 2D) ◄┘
   WebGPU: RGB → RGBA (toRgba, JS) → f32 → f16 per value (toHalf, JS) → writeTexture rgba16float
```

Evidence: `packages/shell/src/app/render/queue.ts:1-12` (scheduling rules), `:300-322` (`DRAFT_PIXELS = 500_000`,
`chooseTarget`); `packages/gpu/src/engine-gpu.ts:590-606` (cache key, readback, repack);
`packages/gpu/src/engine/dag.ts` (fused tails, materialisation, release); `engine/results.ts` (eviction);
`apps/studio/src/present/host-presenter.ts:21-30` (`presentDevice()` requests a separate device);
`apps/studio/src/present/presenter-webgpu.ts:151-157` (the per-value half conversion and upload).

Already in place, measured against Part I:

- **Zoom level and preview level are separate.** The draft, screen and refine passes are exactly that distinction,
  at arbitrary scale rather than powers of two.
- **Latest wins, superseded work is aborted, live work preempts background work.** The render queue's slots and
  epochs implement chapter 7's generations and coalescing.
- **Results are named by content.** Graph nodes are hash-consed, so the same recipe state yields the same node id
  and an undo hits the cache for an identical request.
- **Fusion with uniforms.** The pointwise kernel takes its parameters from a uniform buffer and its tables as
  textures; a slider drag changes no pipeline (`packages/gpu/src/chain/program.ts`, `run.ts`). Editor lab's 79 ms
  recompile does not occur.
- **Tiles with halos for export, and wide kernels at reduced resolution** ("global fields",
  `packages/gpu/src/tiles.ts`): chapter 5's large-blur idea in another form.
- **Device loss is handled** (the engine drops GPU state and recreates it; `engine-gpu.ts:132-145`).

### 12. Measured on the M1 Max

| What | Number | Source |
|---|---|---|
| preview display chain, 4000 × 2674, one pass set | 5.3 ms (hardware filter) / 6.4 ms (manual trilinear, now the default) | CHB-034 Step 8, `chain:lookup-bench` |
| Time drag, GPU engine | settles in ≈ 205 ms, 7–9 renders, no main-thread stall | CHB-034 Steps 4, 10 |
| open a 24 MP NEF, GPU engine | ≈ 6.3 s (LibRaw decode dominates) | CHB-034 Step 10 |
| upload of an rgba32float image | 1500 × 1000: 5.8 ms; 3000 × 2000: 21.8 ms; 4000 × 2674: 38.1 ms | this ticket, `scripts/01-gpu-readback-probe.mjs` |
| readback of the same | 1500 × 1000: 6.5 ms; 3000 × 2000: 26 ms; 4000 × 2674: 56.3 ms | same |

The last two rows are the most important numbers in this document. A screen pass on a 2× display of a full-screen
viewer is about 3,000 × 2,000 pixels. Computing it costs a few milliseconds (the 4000 px chain takes 6.4 ms). Reading
it back costs 26 ms; then three JavaScript loops walk the six million pixels (the engine's repack to RGB, the
presenter's expansion back to RGBA, and its conversion of every value to half float); then the presenter uploads it to
a second GPU device (about 22 ms for f32; half floats halve the bytes). The round trip, not the physics, sets the
speed of the settle.

### 13. Two more properties of chromobench's previews

**Previews sample the source with nearest sampling.** At reduced scale the GPU engine reads the full-resolution
source at the output pixel (`engine-gpu.ts:388-396`: "pointwise steps commute with nearest sampling, so they equal the
reference engine's sampled full-resolution result"). This keeps parity exact, but a draft or screen pass sees aliased
grain and fine detail, never an area average. CHB-034's first-print investigation found the consequence in numbers:
metering a nearest-sampled 4,000 px image and an area-averaged 640 px image of the same photo differed by 0.0058 log H,
enough to change the proposed time (CHB-034 diary 02). Editor lab's level-invariance table predicts which ops suffer:
grain most.

**The cache holds whole final images.** Its key includes scale and region, so a draft at 500,000 px and a screen pass
are different entries, and nothing upstream of the requested node is kept: dragging the paper grade re-runs the scan
conditioning, film and print chain from the cached source texture every time. The pointwise fusion makes that cheap
today (one chain is about 6 ms at 4,000 px), but it will not stay cheap once digital layer stacks (document 01) and
neighbourhood ops are added above the print.

---

## Part IV — Changes, ranked

Each proposal names the idea from Part I, the evidence, the change, and the measurement that would prove it.

### P1. Keep previews on the GPU (residency)

- **Evidence:** readback 26 ms + re-upload 22 ms at 3,000 × 2,000 against a few ms of computation (Section 12); Editor
  lab's residency rule (`08.md:192-215`).
- **Change:** first, the presenter and the GPU engine share one `GPUDevice` (today `presentDevice()` requests its
  own, `host-presenter.ts:21-30`, and textures cannot cross devices). Then the GPU engine gains a presentation path
  that hands the presenter a GPU texture instead of a `Float32Array`; the WebGPU presenter samples it directly (it
  already draws from an rgba16float texture). `evaluate` keeps its readback for statistics, the
  densitometer, histograms (reduced on the GPU first) and export. The Canvas 2D presenter and the CPU engine keep
  today's path.
- **Measure:** settle time and per-render time of the Time drag at screen size on a 2× display, before and after;
  expect the settle to fall well below 205 ms.

#### Decision: presentation from GPU textures

- **Context:** every preview crosses GPU → CPU → GPU; on the M1 Max the crossing costs several times the computation.
- **Options considered:** (1) keep readback, optimise the repack; (2) read back 16-bit or 8-bit instead of f32
  (halves or quarters the bytes); (3) present GPU textures directly when engine and presenter share a device.
- **Decision:** (3), with (2) as the fallback where the presenter cannot share the device.
- **Rationale:** (3) removes the crossing; (2) only shrinks it. Chromobench already owns both ends (CHB-009's WebGPU
  presenter, the GPU engine).
- **Consequences:** one device for engine and presenter (device loss now takes both down together, which the
  engine's recreation path must cover); the render queue's `Rendered` type gains a texture variant; parity tests
  still read back. A first, smaller step with most of the gain on the CPU side: move the half-float conversion into a
  GPU pass or upload f32 directly (`rgba32float` is filterable on this adapter).
- **Status:** proposed.

### P2. A source pyramid for draft and screen passes

- **Evidence:** nearest sampling aliases grain and detail at reduced scale; it made metering resolution-dependent
  (CHB-034); Editor lab's level-invariance method (Table 5.3) and downsampling filters (`05.md:216-298`).
- **Change:** keep an area-averaged pyramid of each source texture (GPU mipmaps of the conditioned source, built once
  per source), and read the level nearest the target scale instead of nearest-sampling level 0. Ops that are not level
  invariant (grain, halation's fine structure) are rendered at a level fine enough, or marked approximate in drafts.
- **Measure:** an invariance table for chromobench's ops in Editor lab's format (mean, max, % > 4 steps at each level);
  draft and screen pass times; the first-print engine difference (it should vanish without the 640 px analysis image of
  CHB-034's fix).

#### Decision: what previews read

- **Context:** exact parity with a sampled reference versus a faithful downsample.
- **Options considered:** (1) keep nearest sampling (exact parity, aliasing); (2) a pyramid on the GPU only (fast,
  parity against a reference that downsamples the same way); (3) pyramids in both engines.
- **Decision:** (3) for draft and screen passes; refine and export stay at full resolution.
- **Rationale:** previews should look like the print scaled down; the reference engine must downsample identically so
  parity remains testable.
- **Consequences:** the CPU engine's 640 px working image is already an area-averaged level; the pyramid unifies the
  two engines' previews and may make CHB-034's separate analysis image unnecessary.
- **Status:** proposed.

### P3. Checkpoints keyed by content

- **Evidence:** the cache holds only final images (Section 13); Editor lab's checkpoint proposal (`06.md:178-199`);
  darktable keeps a per-module cache keyed by the hash of the pipe up to that module (`pixelpipe_cache.c:99-173`).
- **Change:** materialise and cache, under the node id plus the target grid, the outputs of chosen nodes: the film
  dyes (`invert.dyes` / `film.grain`), the paper exposure before `print.develop`, and the print before the digital stage.
  A drag on a print control then starts from the cached dyes; a drag on a digital layer starts from the cached print.
  GPU textures are the cache's first tier, with a byte budget and hit/miss counters.
- **Measure:** per-render time of a grade drag and of a digital curve drag with and without checkpoints; GPU memory.

#### Decision: eviction policy for checkpoints

- **Context:** Editor lab's measurements show LRU losing badly on undo/redo and cost-aware losing on strokes.
- **Options considered:** LRU; GreedyDual-Size; a setting with both.
- **Decision:** start with GreedyDual-Size for checkpoints (they are few, large and costly) and LRU for final images;
  expose both as settings for the bench.
- **Rationale:** checkpoints are exactly the "expensive shared tiles" that cost-aware eviction protects.
- **Consequences:** costs must be measured per node (GPU timestamp queries or submit-to-done timing).
- **Status:** proposed.

### P4. Measure response time, open loop, with requirements as numbers

- **Evidence:** Sections 1–2; chromobench's scripts measure settle, not response.
- **Change:** a chromobench requirements table (the photographer's events: Time drag, filtration, grade, a digital
  curve, open, undo, export), and an open-loop driver in the CHB-034 script family: events on a 16.7 ms clock,
  response measured from each event's intended time, p50/p95/p99 per scenario, records exported with the environment.
- **Measure:** this is the measurement; every later proposal reports against it.

This proposal is cheap and should come first in time, even though P1 is first in value: without it, P1–P3 cannot be
shown to work.

### P5. Tiles for refine and export only

- **Evidence:** Editor lab tiles everything because it renders at level 0 on the CPU; chromobench's previews are whole
  images at screen size (≈ 3 MP at most) computed in a few ms on the GPU.
- **Change:** none for draft and screen passes. For refine (zoom ≥ 1) on large files, render only the visible tiles,
  cached by node id and tile, centre first; export keeps its tile planner.
- **Measure:** time to a sharp 1:1 view of a 24 MP file after a change.

### P6. Early cutoff for masked digital layers

- **Evidence:** Table 6.2 (33–52 % avoidable work above masked edits).
- **Change:** when digital layers with geometric masks exist (document 01), a layer whose mask is zero over a tile is
  the identity there; compile it to "pass the backdrop through" for that tile (static identity tiles, keys stay
  precomputable). Only relevant once refine tiles (P5) and digital stacks exist.
- **Measure:** Editor lab's `cutoff.js` protocol on a chromobench digital stack.

### P7. Scheduling refinements

- **Change:** adapt `DRAFT_PIXELS` to the measured draft cost (Editor lab's level adaptation: coarser above a threshold,
  finer below); keep finished results when a request is superseded (they are valid under their keys); cancel long
  evaluations between fused segments, not only between requests.
- **Measure:** response p95 during a drag (P4).

### P8. The CPU engine: WebAssembly where it pays

- **Evidence:** WASM scalar 4.5×, SIMD 6× over JS on a box pass, but copy-out exceeded the kernel (`08.md:67-81`).
- **Change:** only after measuring where the CPU engine spends its time; candidates are the table lookups and the
  spectral integrals of exact export. Keep buffers in linear memory to avoid copies. The CPU engine is the
  compatibility path and the reference; correctness comes first.
- **Measure:** the CPU engine's preview and export times on a 24 MP file.

### 14. Summary: value and effort

| # | Change | Expected value | Effort | Depends on |
|---|---|---|---|---|
| P4 | open-loop requirements and bench | makes every other change measurable | small | — |
| P1 | present from GPU textures | largest settle-time gain on Retina screens | medium | P4 to prove |
| P2 | source pyramid for previews | faithful previews; engine-independent metering | medium | — |
| P3 | content-keyed checkpoints | deep stacks and digital layers stay interactive | medium | document 01 stage C |
| P7 | adaptive drafts, keep finished results | smoother drags | small | P4 |
| P5 | visible tiles at 1:1 | fast sharp zoom on large files | medium | P3 |
| P6 | early cutoff on masked layers | less work above local edits | small–medium | P5, document 01 |
| P8 | WASM in the CPU engine | faster Compatibility mode | large | profiling |

Not proposed: Editor lab's 52-bit JavaScript keys (chromobench's node ids are already content hashes), its per-layer
tile cache at every layer (memory-hungry; checkpoints are the refinement), and its generated-constant shaders (a dead
end its own book warns against).

---

## Glossary

| Term | Meaning here |
|---|---|
| **apron / halo** | pixels around a tile that a neighbourhood op reads |
| **checkpoint** | a node whose output is kept in a cache so later edits can start from it |
| **closed / open loop** | a benchmark that waits for each result before the next event / one that issues events on a clock |
| **coordinated omission** | the error of a closed-loop benchmark: queueing delay disappears from its numbers |
| **content key** | a cache key computed from everything a result depends on; equal keys mean equal results |
| **deep constructive trace** | a key built from input keys, computable before work; cannot support early cutoff |
| **early cutoff** | stopping recomputation above a step whose output did not change |
| **fusion** | running several pointwise ops in one pass over the image |
| **GreedyDual-Size** | a cost-aware eviction policy: priority = clock + cost / size |
| **level (pyramid)** | an image at 2⁻ᴸ of full width |
| **level invariance** | an op commutes with downsampling: down(f(x)) = f(down(x)) |
| **nearest sampling** | reading the one source pixel under an output pixel, without averaging |
| **p95** | the value below which 95 % of measurements fall |
| **readback** | copying an image from GPU memory to CPU memory |
| **residency** | keeping images in the memory of the processor that uses them |
| **response time / service time** | delay from an event's intended time to its result / time to process one request |
| **roofline** | a cost model: time = max(arithmetic / peak arithmetic, bytes / peak bandwidth) |
| **tile** | a square region of an image; unit of work, caching and cancellation |

## References

- Editor lab: `src/book/05.md`–`09.md` (tiles, pyramids, caching, scheduling, GPU/WASM, design), each with its
  "Toward a reusable API" section; `src/engine.js` (key 478–505, cache 400–426, tiles 509–552, pyramid 44–60);
  `src/app.js:57-116` (scheduler); `src/views/{bench,gpu,wasm}.js`; `tools/kernels.wat`; `test/{cutoff,evict,levels,probes}.js`;
  `research/notes.md` and `research/src/` (darktable, GEGL, libvips, GIMP, Krita, Chromium cc, wrk2); `REPORT.pdf`;
  `earlier-work/docs/Editor perf lab - simulating workloads and devices.pdf`.
- Chromobench: `packages/gpu/src/engine-gpu.ts` (388–396 sampling, 590–606 cache and readback); `engine/dag.ts`;
  `engine/results.ts`; `tiles.ts`; `chain/program.ts`, `chain/run.ts`; `packages/shell/src/app/render/queue.ts`;
  CHB-034 diaries 01 (Steps 4, 8, 10) and 02 (first-print metering).
- Measurements in this ticket: `scripts/01-gpu-readback-probe.mjs`.
- Companion: `01-digital-editing-in-chromobench.md`.
