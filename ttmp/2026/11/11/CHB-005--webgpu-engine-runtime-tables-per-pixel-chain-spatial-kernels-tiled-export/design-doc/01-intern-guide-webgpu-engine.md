---
Title: 'Intern guide: WebGPU engine'
Ticket: CHB-005
Status: active
Topics:
    - webgpu
    - image-pipeline
    - testing
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/design-doc/01-chromobench-architecture-and-work-plan.md
      Note: Engine interface, domains, planned packages/gpu layout and the work plan this ticket sits on
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: 'Chapter 4 (§4.1–4.9) is the core reading: binding time, tables, blurs, GPU passes, WGSL kernels, parity checks'
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/chromogen-studio-1.2/samples/gold200.png
      Note: Gold 200 sample scan, the fixture for table, chain and tile parity tests
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-chromogen-studio.md
      Note: Map of the Studio's pipeline (§2), GPU/worker architecture (§4) and bugs to fix (§6)
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/04-st-worker.txt.js
      Note: Worker bundle whose job handler builds solve/pd/print node ranges; the model for the f64 table workers
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/05-inline.js
      Note: 'Chromogen source to port: model.js 1620–1901, shaders.js 1903–2085, params.js 2087–2193, render.js 2694–3228, gpu.js 3392–3604, accel.js 3606–3843'
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/book/11-perf.md
      Note: The Studio's own account of tiles, halos, workers and WebGPU compute
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/st-data/cg/stocks/kodak_gold_200.json
      Note: Interim stock data for the Gold 200 table configuration until CHB-004's packs exist
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:22.891161897-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: WebGPU engine

## 1. What this ticket builds

Chromobench prints a colour negative or a RAW photo through a physical model of the colour darkroom. Chapters 1 to 3 of the textbook (*The Mathematics of the Colour Negative*) state that model as equations: spectra, densities, a least-squares dye solve per pixel, paper curves, viewing. Evaluated literally, those equations are slow. One pixel of the Gold 200 sample needs a dye solve of about six passes over an 81-sample spectrum plus two more spectral integrals. Chromogen Studio's working image of that frame has 821,860 pixels, and solving each one in JavaScript takes about 5 s per redraw on one core (textbook §4, introduction: 6.1 µs per solve in node). A photographer dragging a printer-light slider needs a redraw in tens of milliseconds. An export of a 100-megapixel scan needs to finish in seconds to minutes, not hours.

CHB-005 builds `@chromobench/gpu` (`packages/gpu`), the **GPU engine**. It implements the shared `Engine` interface from `@chromobench/contract` with `id: 'gpu'` and evaluates the same functions as the f64 reference engine in `@chromobench/core`, only faster:

- **For the photographer:** interactive previews while sliders move, and full-resolution exports of large scans.
- **For the agent:** fast measurements (histograms, statistics, densitometer readings) and fast what-if renders such as test strips, which CHB-010 and CHB-008 build on.
- **For other tickets:** a tile planner and a tiled evaluation mode that CHB-011 uses for export, and GPU kernels for the spatial effects that CHB-012 defines (halation, DIR diffusion, grain).

The engine has six parts, which are also the ticket's stages:

1. a **runtime** that owns the WebGPU device, its limits and features, memory pools, compiled pipelines, timing and fallback detection;
2. a **tile planner** that cuts a large frame into tiles with halos and decides which wide kernels are computed once at reduced resolution;
3. **tables**: the 33³ lookup tables that replace the dye solve and the spectral integrals, built on the GPU in f32 or by f64 workers, and cached by content in the browser's Origin Private File System;
4. the **per-pixel chain**: the Studio's GLSL passes ported to WGSL compute shaders, with a preview path and an exact export path, plus GPU reductions;
5. **spatial kernels**: separable blurs, halation and DIR diffusion specified in micrometres, a counter-based grain random number generator, and summed-area tables used safely;
6. a **parity harness** that checks every fast path against the f64 reference in headless Chromium.

What CHB-005 does **not** do:

- It does not define physics. Every number the GPU engine computes is defined first by the f64 reference (CHB-003, and CHB-012 for the forward film model). If the reference and the GPU disagree beyond a stated tolerance, the GPU is wrong.
- It does not decode files (CHB-006), encode files or manage ICC profiles (CHB-011), or draw the user interface (CHB-009).
- It does not decide what a control means. Printer lights, flare, gamut compression and grain statistics come from the tickets that own those ops.

## 2. Background

This section teaches what you need before reading the Studio's code. Section 2.1 recaps the chain the engine evaluates. Sections 2.2 to 2.6 cover the techniques of textbook chapter 4 and the WebGPU platform.

### 2.1 The chain the engine evaluates

The shared map (CHB-001 design doc §2) defines the **domains**, the kinds of data an image can hold. For a negative scan the GPU engine runs this chain per pixel:

```text
camera-linear T (scanner counts / rebate)
  └─ D = −log₁₀(T / T_rebate)                         scanner-density
       └─ a = K⁻¹ D  (analytical estimate)
            └─ dye solve c = s(a), with residual        film-dyes       ← 33³ "solve" table
                 └─ PD = −log₁₀ Σλ W_k 10^−(base + Σ c_j ε_j)   printing-density ← 33³ "pd" table
                      └─ x = clear + lights − PD                   paper-logH
                           └─ c_p = paper curve(x)                 paper-dyes      ← 1-D curves
                                └─ XYZ = Σλ V R(c_p) x̄ ...         print-xyz       ← 33³ "print" table
                                     └─ flare, gain, matrix, knee, encode         display-rgb
```

Two symbols in the diagram need a word. K is the 3 × 3 matrix whose entry K_kj is the density that channel k reads from one unit of dye j alone (textbook §1.4); a = K⁻¹D is the linear guess at the dye amounts and also the solve's starting point. The **residual** is what remains of the misfit after the bounded solve, in density units; above 0.01 D the pixel is flagged **unreachable**, meaning no non-negative dye amounts of this stock reproduce it (textbook §3.5).

Concrete values help. A grey card photographed on Kodak Portra 400 develops to dye amounts c = (0.687, 0.704, 0.864). Printed on Portra Endura and viewed under a 5,000 K light, the grey card has XYZ = (0.1706, 0.1750, 0.1686), a visual density of about 0.755, and encodes in sRGB as (0.441, 0.457, 0.483), the colour `#70757b` (textbook §2.7). Those are golden numbers owned by CHB-003; the GPU engine must reproduce them within its tolerances.

Two terms recur. A **pointwise** stage computes each output pixel from the same input pixel only (the dye solve, the paper curve). A **spatial** stage reads neighbours (a blur, halation, grain reduction). The distinction decides where a GPU pass can be cut and how tiles must overlap.

### 2.2 Binding time and tables

Every quantity has a **binding time**, the moment its inputs become known (textbook §4.1): the film's dye spectra when the stock is chosen, the rebate when the scan is opened, a printer light when a slider moves, a pixel's transmittance when the pixel is processed. **Staging** runs each computation at the latest binding time of its inputs. The dye solve depends on the scanner's channels, the film's dyes and base, and one pixel's density. Fix the first three and the solve becomes a function of three numbers, c = s(a). That function can be evaluated once on a grid and interpolated afterwards: a **table**.

The Studio has three 3-D tables of N = 33 nodes per axis (`model.js`, 1628–1633, and textbook §4.2):

| Table | Keyed on | Domain per axis | Stored per node | Binds per |
|---|---|---|---|---|
| solve | a = K⁻¹D | `A_RANGE` = [−0.25, 2.55] | c₁, c₂, c₃, residual | scanner × film |
| printing density (pd) | dye amounts c | `C_RANGE` = [0, 2.6] | PD₁, PD₂, PD₃, 1 | film × paper (lamp fixed) |
| print | paper dyes c_p | `CP_RANGE` = [0, 2.7] | X, Y, Z adapted to D65, 1 | paper × fade (viewing light fixed) |

Each table is 33³ = 35,937 nodes × 4 floats × 4 bytes = 575 KB. Node q sits at indices i = q mod N, j = ⌊q/N⌋ mod N, k = ⌊q/N²⌋, x fastest, which is the order a 3-D texture expects (`nodeAt`, 1660–1663).

Three facts about tables matter to this ticket:

- **Half-texel mapping.** Texel i of an N-texel texture covers [i/N, (i+1)/N) with its value at the centre. To read a table spanning [ℓ, h] at value v, map u = (v − ℓ)/(h − ℓ) to u′ = (u(N − 1) + ½)/N. The Studio writes this as `(u * 32.0 + 0.5) / 33.0` in `lut3` (`shaders.js`, 1915). Without it the table is stretched by N/(N − 1).
- **Interpolation error.** Trilinear interpolation errs by at most (h²/8)·Σ|∂²c/∂aᵢ²| in smooth cells, where h = 2.8/32 = 0.0875 is the node spacing. On the Gold 200 set-up the rms error is 9.3×10⁻⁵ at N = 33, but cells that straddle the edge of the film's reachable set err by up to 0.017, because the bounded solve has a kink there. Tetrahedral interpolation (four corners instead of eight) is 1.9 times more accurate at every N (textbook §4.2, Figure 4.1).
- **Texture filtering is not exact arithmetic.** GPU texture units compute filter weights in fixed point. NVIDIA documents 8 fractional bits; rounding the fractions to 8 bits raises the solve table's rms error from 9.2×10⁻⁵ to 1.6×10⁻⁴ (textbook §4.2, "Careful", a model rather than a GPU measurement). An export that wants the table's full accuracy must interpolate in the shader from unfiltered reads.

Tables are only correct if their cache key changes whenever an input changes. The textbook records two failures (§4.1). The Studio keyed its working image on the scan's geometry, so two scans opened with identical settings shared a key and switching between them could show the wrong image; the fix added a per-scan id. spektrafilm validated its table cache with four probe dye triples but not with the table's *domain*, so after `density_min` moved from 0.03 to 0.10 an old 17³ table was reused and the result was off by up to 0.063 log H. **Cache keys must include the scan's identity whenever a table depends on the scan, and always the table's domain.**

### 2.3 WebGPU in one sitting

WebGPU is the browser's modern GPU API. You need these concepts:

- An **adapter** represents one GPU (or a software implementation). `navigator.gpu.requestAdapter()` returns one. Its `limits` and `features` say what it can do.
- A **device** is your connection to an adapter. You request it with the limits and features you need. Requesting a limit better than the adapter supports rejects with `OperationError`; requesting an unsupported feature rejects with `TypeError` (WebGPU spec §4.3). The device you get has the *default* limits unless you ask for more, even if the adapter could do more; Chrome's team notes this surprises people (Chrome blog, "New in WebGPU 133").
- **Buffers** hold bytes (uniforms, storage arrays, staging for read-back). **Textures** hold images in a format such as `rgba32float` or `rgba16float`, in 1, 2 or 3 dimensions.
- A **compute shader**, written in WGSL, runs once per **invocation**. Invocations come in **workgroups** of a size the shader declares; a **dispatch** launches a grid of workgroups. Invocations of one workgroup share fast **workgroup memory** and can synchronise with `workgroupBarrier()`.
- A **bind group** declares every resource a pass uses. Nothing carries over between passes, which removes the Studio's WebGL sampler-binding bugs (textbook §4.4).
- A **pipeline** is a compiled shader plus its resource layout. Compiling is slow (0.2 to 0.37 s per kernel on SwiftShader, textbook §4.5), so pipelines are cached.
- Work is recorded into a command encoder and **submitted** to the device's queue. `buffer.mapAsync()` resolves when a read-back buffer can be read; `queue.onSubmittedWorkDone()` resolves when submitted work has completed.

**Limits.** The spec guarantees default limits that every implementation supports; real adapters usually offer more, but you only get more by asking (WebGPU spec §3.6.2). The values that shape this engine:

| Limit | Spec default | What adapters report (web3dsurvey.com) | Why it matters here |
|---|---|---|---|
| `maxTextureDimension2D` | 8,192 | ≥ 16,384 on 99 % of reports | a 100 MP frame is about 11,600 px wide |
| `maxTextureDimension3D` | 2,048 | — | tables are 33³ or 65³: no issue |
| `maxBufferSize` | 268,435,456 (256 MiB) | ≥ 2,147,483,647 on 77 % | one full-resolution float image is 1.5 GiB |
| `maxStorageBufferBindingSize` | 134,217,728 (128 MiB) | ≥ 2 GiB on only 16 % | a storage binding covers at most this much |
| `maxComputeWorkgroupStorageSize` | 16,384 bytes | — | the solve stages 7 × 128 f32 = 3,584 bytes |
| `maxComputeInvocationsPerWorkgroup` | 256 | — | we use 64 (8 × 8 for images) |
| `maxComputeWorkgroupsPerDimension` | 65,535 | — | a 2048-px tile in 8 × 8 groups needs 256 per axis |
| `maxUniformBufferBindingSize` | 65,536 bytes | — | blur weights fit in a uniform buffer |
| `minUniformBufferOffsetAlignment` | 256 bytes | — | dynamic uniform offsets |

**Features** are optional capabilities (spec §3.6.1.1; descriptions on MDN, `GPUSupportedFeatures`):

- `float32-filterable` allows linear filtering of `r32float`, `rg32float` and `rgba32float` textures. Without it, a 32-bit float table cannot be read with a hardware trilinear fetch. `rgba16float` is filterable in core WebGPU.
- `shader-f16` allows the `f16` type in WGSL (after `enable f16;`). It is not needed to *store* half floats in `rgba16float` textures; it is needed for half-precision arithmetic and `f16` storage buffers.
- `timestamp-query` allows GPU timestamps around passes. Chrome quantises them to 100 µs unless the "WebGPU Developer Features" flag is on (Chrome docs, "WebGPU developer features").

**Fallback adapters.** An adapter may be a *fallback adapter*: a software implementation with "significant performance caveats" (spec §3.5.1), reported by `GPUAdapterInfo.isFallbackAdapter` (spec §3.6.2.4). In headless Chromium this is SwiftShader. It is correct but slow; the Studio measured its WebGPU solve slower than two CPU workers and therefore used WebGPU under *Auto* only on hardware adapters (`accel.js` `order`, 3721–3727).

**Uniform control flow.** WGSL requires every invocation of a workgroup to reach a `workgroupBarrier()`. A kernel that returns early on an out-of-range index *before* its barrier is refused by Chromium's compiler with "'workgroupBarrier' must only be called from uniform control flow" (textbook §4.5). The Studio's kernels copy shared data, wait at the barrier, and only then range-check:

```wgsl
for (var i = li; i < 7u * U.n; i += WG) { sh[i] = spec[i]; }
workgroupBarrier();
let q = gid.x;
if (q >= U.total) { return; }
```

WGSL also reserves many identifiers: `let active = 1u;` fails because `active` is reserved, as are `filter` and `target` (textbook §4.5).

### 2.4 Thirty-two-bit arithmetic and tolerances

WGSL has no 64-bit floats. A 32-bit float carries 24 significant bits, a relative spacing of 6×10⁻⁸. The dye solve's residual is −log₁₀ of a sum of 81 terms, so in f32 it is known to about 10⁻⁷, and so is its gradient. The CPU solver stops when the projected gradient falls below `gtol` = 10⁻⁹, a test that almost never fires in f32; the solve then ends only when twelve damped trial steps all fail, each costing a pass over the spectrum. The Studio therefore raises `gtol` to at least 10⁻⁶ on the GPU (`gpuSolve`, 3592). A 32-bit JavaScript port of the kernel makes 6.49 passes per node at 10⁻⁶ and 8.55 at 10⁻⁹ (32 % more), and 5.70 at 10⁻⁵ but with errors 6.5 times larger (textbook §4.5).

The result is a tolerance derived from arithmetic, not from what happened to pass: the WGSL solve differs from the 64-bit table by at most 2.18×10⁻⁶ in dye amount on the 27,000 reachable nodes of the Gold 200 table, the printing-density kernel by 7.2×10⁻⁷ and the print kernel by 4.2×10⁻⁷ in XYZ (textbook §4.5, Figure 4.4).

Two more f32 habits from §4.5 and §4.8:

- Write 10ˣ as `exp2(3.3219281 * x)` and log₁₀ as `log2(x) * 0.30103`. `gpu.js` does; `shaders.js` still uses `pow(vec3(10.0), x)` and `log(…) / log(10.0)`.
- Branches that differ between invocations of a group cost both sides. Per-dye choices use `select`, which picks per component without branching.

**Divergence.** A workgroup runs as long as its slowest invocation. With the active-set step the GPU solve averages 2.04 iterations per node with a maximum of 9, and a **lockstep ratio** (Σ over groups of 64 × the group's largest count, divided by the total count) of 1.26: lockstep wastes a fifth of the work (textbook §4.5).

### 2.5 The cost of a neighbourhood

A blur of standard deviation σ needs a radius R ≈ 3σ. A direct 2-D kernel costs (2R + 1)² reads per pixel; a **separable** kernel (a product of a row kernel and a column kernel, true of Gaussians and boxes) costs 2(2R + 1), which is 106 instead of 2,809 at R = 26 (textbook §4.3). The Studio's rules, which carry over unchanged:

- Truncate a Gaussian at R = ⌈3σ⌉ and divide the weights by their sum so a flat field stays flat (`blurKernel`, 2970–2981).
- Compute the weights once per pass on the CPU and pass them in a uniform array; loop only to the kernel's own radius. The Studio's first blur looped to a constant 96 with `continue` and computed an `exp` per tap; replacing it made the blurs 3.3 times faster (textbook §4.3, "measured earlier").
- Run wide kernels at reduced resolution. At half resolution a kernel of the same physical width does an eighth of the work. The Studio runs every wide kernel in a **global pass** at 640 px on the long side; bloom is blurred at 320 px.

Two warnings:

- **A sum of Gaussians is not separable.** Each Gaussian is separable, but a mixture of Gaussians of different widths is a sum of rank-one kernels. Blur once per width (one channel per width) and sum afterwards.
- **Summed-area tables lose precision in f32.** A summed-area table (SAT) stores at each position the sum of everything above and to the left; any box sum then costs four reads. Entries grow to the sum of the whole image while a box sum is a small difference of large entries. The textbook's test (§4.3): estimating σ = 0.010 D on a flat field gives 0.0100 with 64-bit tables at every size, but with 32-bit tables 0.0102 at 1090 × 754, 0.0147 at 2048 × 1365 and 0.056 at 4096 × 2731. WGSL has no f64.

**Physical units.** Halation, scatter, DIR diffusion and grain are properties of the film, so their sizes are in micrometres on the film. The contract's `ImageInfo.umPerPx.film` gives the scale. The Studio specified halation radii as fractions of the frame's long side (`K.HAL_RADII` = [0.004, 0.018], 966), so a 35 mm frame and a 4 × 5 inch sheet got the same relative halo. That is a bug for a physical effect.

### 2.6 Why a 100-megapixel scan forces tiling

Take a 100 MP scan of 11,600 × 8,700 = 100.9 million pixels:

- **Dimensions.** 11,600 px exceeds the default `maxTextureDimension2D` of 8,192. Most adapters allow 16,384, but only if the device asks for it.
- **Memory per image.** One `rgba32float` image is 100.9 M × 16 B = 1.50 GiB; even `rgba16float` is 770 MiB. The default `maxBufferSize` is 256 MiB. The chain keeps four to six intermediates alive (dyes, printing density, print, output, halation and base fields), which would need 6 to 9 GiB of GPU memory. WebGPU has no API that reports free memory, and integrated GPUs share system RAM.
- **Read-back.** Mapping a 1.5 GiB buffer into JavaScript strains the page's address space and stalls everything else.

A 1024 × 1024 tile in `rgba32float` is 16 MiB per intermediate, about 100 MiB for the whole chain, which fits the default limits on every adapter. The frame then needs ⌈11,600/1,024⌉ × ⌈8,700/1,024⌉ = 12 × 9 = 108 tiles. The price is overlap: a tile must carry a border, the **halo**, at least as wide as the neighbourhoods its pixels read. With an 8-px halo a 1024-px tile computes ((1024 + 16)/1024)² − 1 = 3.2 % extra pixels; a 256-px tile computes 12.9 % extra.

Wide kernels cannot be handled by halos. In spektrafilm's model, halation has σ = 65 µm with bounces at σ√2 and σ√3 (textbook §2.4); at 6.0 µm per pixel (a 6 × 7 negative, 69.5 mm long, scanned to 11,600 px) that is σ ≈ 11 to 19 px and a radius up to 57 px. DIR diffusion has a 200 µm exponential tail (§2.3). The Studio's answer, which this ticket keeps, is to compute wide fields once for the whole frame at reduced resolution and let every tile read them through its position in the frame (the `g2` uniform, `shaders.js` 1910–1911). The textbook's tile test shows why both halves matter: 256-px tiles with an 8-px halo match a one-pass render within one 8-bit level (mean 0.0004); without a halo the error reaches 28 levels at the seams; and a σ = 16 kernel computed per tile with an 8-px halo errs by 20 levels, but read from the global pass errs by 0 (§4.7 and its "Try it").

## 3. How the engine fits the system

```text
                 apps/studio (CHB-009)        @chromobench/dsl (CHB-007)
                         │ compile(recipe) → NodeRef      │ what-if nodes
                         ▼                                ▼
               ┌──────────── @chromobench/contract (CHB-002) ────────────┐
               │ Engine interface · NodeRef · EvalTarget · conformance     │
               └───────┬───────────────────────┬──────────────────────────┘
                       │                       │
        ┌──────────────▼─────────┐   ┌─────────▼──────────────────────────────┐
        │ @chromobench/core       │   │ @chromobench/gpu (CHB-005)              │
        │ reference engine, f64   │◄──│ parity harness compares against it      │
        │ solver, spectral maths  │──►│ f64 table workers import core's maths   │
        └─────────────────────────┘   │ runtime · tiles · tables · chain ·      │
                                      │ spatial kernels                         │
                                      └───▲──────────────┬──────────────────────┘
          source tiles (CHB-006 ingest) ──┘              │ evaluate(node, {region, precision:'export'})
          stock data (CHB-004 data packs) ──┘            ▼
                                             @chromobench/output (CHB-011): tiled export, encoders
```

**Contracts implemented.** The GPU engine implements `Engine` (CHB-001 design doc §5.3):

- `capabilities()` reports limits, features, adapter name and whether it is a fallback;
- `open(source)` delegates decoding to ingest and uploads the source;
- `evaluate(node, target)` renders a node at a preview scale or at full resolution, optionally for a region, with `precision: 'preview' | 'export'`;
- `measure(node, spec)` runs reductions (statistics, histograms, densitometer patches);
- `prepare(keys)` builds or loads content-keyed tables;
- `dispose()` releases the device.

It must pass CHB-002's conformance suite (domains, units, shapes, error codes, determinism) like every engine, and in addition the parity tests of stage 6.

**Domains.** The engine reads `camera-linear` sources and can produce every domain along the chain: `scanner-density`, `film-dyes`, `printing-density`, `paper-logH`, `paper-dyes`, `print-xyz`, `display-rgb`, plus `mask` inputs for CHB-010. For the forward path (CHB-012) it also evaluates `film-logH`. Any intermediate domain must be available as a **tap**, because the DSL asks for them ("show me the printing density").

**Dependencies.**

| Ticket | What CHB-005 needs from it | How to proceed before it lands |
|---|---|---|
| CHB-002 | contract types, catalog, mock engine, conformance suite | start against the sketches in the design doc; propose additions (§10) |
| CHB-003 | f64 solver, spectral functions, print chain, golden numbers | port `solve.js`, `channels.js` and the table builders from Chromogen (lines 477–790, 1669–1803) into a private test helper and swap to core when it exists |
| CHB-004 | stock data packs | use the Chromogen stock JSON in `various/extracted/chromogen-studio/st-data/cg/` |
| CHB-006 | decoded sources and full-resolution tiles | use the Gold 200 sample (`sources/chromogen-studio-1.2/samples/gold200.png`) and synthetic frames |
| CHB-012 | the semantics of halation, DIR diffusion and grain | build the kernels as generic primitives (Gaussian mixtures in µm, counter-based normals) and test them against direct f64 convolution |

**Dependents.** CHB-010 (darkroom printing: masks, multi-exposure, test strips), CHB-011 (tiled export through the planner), CHB-012 (forward path on the GPU), CHB-009 (the viewer displays `evaluate` results), CHB-013 (beta on real hardware). The critical path in the work plan is 002 → 003 → **005 (tables and chain)** → 010 → 013.

## 4. What exists today and what to take from it

All Chromogen paths are in `ttmp/2026/11/11/CHB-001--…/various/extracted/chromogen-studio/` (call it `CS/`). Line numbers refer to `CS/05-inline.js` unless stated. The report `various/analysis-chromogen-studio.md` (§2, §4, §6) is a map; the line ranges below were checked against the code.

| Lines | Module | What it does | Verdict |
|---|---|---|---|
| 3392–3604 | `gpu.js` | WGSL `SOLVE` and `SPECTRAL` kernels; device, pipeline cache, dispatch and read-back | port the kernels nearly verbatim; rebuild the host code on the runtime |
| 3606–3843 | `accel.js` | worker `Pool` with a shared queue; `Accel` backend order and fallback; `benchmark` | port the pool and the benchmark logic into the table builder and the parity harness |
| 1620–1901 | `model.js` | table domains, `nodeAt`, `solveNodes`, `pdOf`, `printSetup`, curves, `memoAsync` keys, `buildModel`, `look3` | port the domains and node order exactly; replace string keys with content hashes |
| 1903–2085 | `shaders.js` | GLSL passes `FS_DYES`, `FS_PD`, `FS_BLUR`, guided filter, `FS_PRINT`, `FS_BLOOMSRC`, `FS_OUT`, `FS_VIEW` | port to WGSL compute, fixing the bugs below |
| 2087–2193 | `params.js` | slider values → uniforms; `paperX`; `frameStats`; `windowHistogram` | the values come from core (CHB-003); keep the uniform packing idea |
| 2694–3228 | `render.js` | WebGL2 renderer: targets, `pass`, `sync`, `blurKernel`, `makeNoise`, global pass, `frame`, `exportTiles` | port the pass graph, `blurKernel`, the global pass and the tiled export; drop `makeNoise` |
| `CS/04-st-worker.txt.js` | worker bundle | a minified copy of the engine plus a job handler (`solve`, `pd`, `print` by node range) | rebuild as a module worker that imports core |

### 4.1 The WGSL kernels (`gpu.js`, 3392–3604)

`COMMON` (3395–3407) declares the workgroup size (`WG` = 64), the constants `LOG2_10` and `LOG10_2`, the workgroup array `sh: array<f32, 7 * 128>` and `nodeAt`. `SOLVE` (3409–3492) runs the bounded Levenberg–Marquardt solve of `solve.js` in f32: residual and closed-form Jacobian from one loop over the spectrum (`evalF`), a symmetric 3 × 3 solve by adjugate (`solve3`), Marquardt damping μ(1 + A_ii) starting at 10⁻³ (×4 on failure, ÷3 on success), up to 12 trial steps per iteration, and the active set expressed with `select` masks. `SPECTRAL` (3493–3516) evaluates Σλ W_k 10^−(B + Σ c_j ε_j) and returns either −log₁₀ of it (printing density, `mode` 0) or a 3 × 3 matrix times it (XYZ, `mode` 1).

Port both kernels almost unchanged; they are the measured ones. Change only the host side:

- `run` (3550–3582) creates four buffers per call and destroys them afterwards. Use pooled buffers.
- `run` reads the result back through `mapAsync`. Keep the read-back for caching and parity, but also write the result straight into a 3-D texture (see §5.4).
- The uniform buffer is packed by hand (`gpuSolve`, 3584–3595: matrix at float 0, `Dbase` at 12, ranges at 16, counts at 20, tolerances at 24, `activeSet` at 26, 112 bytes). Generate packers from one struct description with WGSL's alignment rules (a `mat3x3<f32>` is three 16-byte columns) and test them against these offsets.
- `pipeline` (3538–3548) already turns `getCompilationInfo()` errors into messages with line numbers. Keep that, and turn them into `Diagnostic`s.

### 4.2 Backends, the pool and the benchmark (`accel.js`, 3606–3843)

The `Pool` (3620–3696) starts min(8, cores) workers, cuts a table into node ranges (512 for the solve, 2,048 for the others), keeps one shared queue, puts "urgent" short tables at its front, and receives each range as a transferred `Float32Array`. A shared queue matters because nodes are not equally hard: with the old clipped solver one range took 97.5 ms, and a static split at 8 workers would have been three times slower than the queue (textbook §4.6). The workers run the same f64 code as the main thread, so their tables are **bitwise equal** to the main thread's.

`Accel.order` (3721–3727) picks backends: under *Auto*, a hardware WebGPU adapter, then workers, then the main thread; a software adapter only if forced. A failing backend falls through to the next (`any`, 3769–3784). `benchmark` (3796–3842) builds all three tables on every backend, compares each node with the main thread's table, compares the solve only on nodes the reference reaches (residual < 0.01), and counts **flips**, nodes whose residual changes side of 0.01. Port the policy and the comparison into stages 3 and 6.

Leave behind the `blob:` worker trick (`Pool.start`, 3629–3654): it existed because the Studio was one HTML file. Chromobench is a Vite project and can use module workers.

### 4.3 Tables and keys (`model.js`, 1620–1901)

Port exactly: `N3` = 33, `N1` = 512, the four ranges (1628–1633), `nodeAt` (1660–1663), the table builders' arithmetic (`solveNodes` 1669–1679, `pdOf` 1720–1733, `printSetup` 1763–1787), and the solver options `{activeSet: true, gtol: 1e-9}` with `tolerance` 10⁻¹², 50 iterations and dye bounds [0, 4] (`solveInputs`, 1699–1716). In chromobench these builders belong to `@chromobench/core` (CHB-003); the GPU package imports them for the f64 worker build.

Replace the keys. `buildModel` (1860–1880) memoises with strings such as `solve:<scanner>:<peaks>:<film>`. Those name inputs instead of hashing them, and they omit the domain and the solver options. §5.4 defines content keys.

`look3` (1884–1897) is the JavaScript trilinear lookup. Keep it in the parity harness as the CPU model of the GPU lookup.

### 4.4 The GLSL passes (`shaders.js`, 1903–2085) and the renderer (`render.js`, 2694–3228)

The Studio's frame is a sequence of fragment-shader passes (`frame`, 3123–3134): `dyes` → `pd` → `print` → `out`, preceded by a global pass at ≤ 640 px (`global`, 3022–3069) that computes halation, frame statistics and the gamut classes, the guided filter's bases, and bloom. A tiled export (`exportTiles`, 3180–3227) runs the same four passes per 1024-px tile with an 8-px halo and reads the global fields through `g2 = [x0/fullW, y0/fullH, w/fullW, h/fullH]`.

| GLSL pass | Lines | Computes | Becomes |
|---|---|---|---|
| `HEAD` | 1907–1917 | `g2` mapping, `lut1`, `lut1c`, `lut3` with the half-texel mapping | `kernels/common.wgsl` |
| `FS_DYES` | 1918–1945 | T → D → a → solve lookup → c and residual; halation re-exposure; dye saturation; `emitE` mode for the halation source | `kernels/dyes.wgsl` |
| `FS_PD` | 1946–1972 | 5 × 5 bilateral grain reduction; grain from the noise tile; c → PD; re-shoot blend; Y in alpha | `kernels/pd.wgsl` |
| `FS_BLUR` | 1973–1982 | separable 1-D blur, ≤ 97 taps, two kernels packed as `kw[i].xxyy` | `kernels/blur.wgsl` |
| `FS_GF_PREP`, `FS_GF_AB` | 1983–1986 | guided-filter inputs and coefficients at two radii | `kernels/guided.wgsl` |
| `FS_PRINT` | 1988–2025 | tone operators on PD; x = clear + L − PD; burns; colour pads; contrast; pre-flash; paper curves; fade; print table; flare and gain | `kernels/print.wgsl` |
| `FS_BLOOMSRC` | 2026 | thresholded XYZ for bloom | part of `kernels/global.wgsl` |
| `FS_OUT` | 2027–2076 | sharpening, bloom, OKLab finishing operators, RGB matrix, tanh shoulder, sRGB encoding, debug views | `kernels/output.wgsl` (knee and spaces from CHB-011) |
| `FS_VIEW`, `FS_COPY` | 2077–2085, 1987 | fit to canvas; unused copy | viewer blit belongs to CHB-009; drop `FS_COPY` |

Keep from `render.js`: the pass graph, `blurKernel` (2970–2981), the global pass structure, the `g2` mapping, the read-back for timing (`sync`, 2962–2968, which exists because `gl.finish()` does not block in Chromium), and `toHalf` (2696–2713) for half-float uploads. Leave behind the WebGL state machinery (`pass` with placeholder samplers, 2920–2959), which bind groups make unnecessary, and `makeNoise` (2833–2875).

### 4.5 Bugs to fix while porting

1. **Halation channel packing** (1921, 1929, 1932–1934, 3027–3033). `emitE` writes (E_R, E_G, E_R, E_G). The blur applies kernel σ₁ to channels 0–1 and σ₂ to channels 2–3 (`kw[i].xxyy`), giving h = (E_R⊛σ₁, E_G⊛σ₁, E_R⊛σ₂, E_G⊛σ₂). The consumer assumes (E_R σ₁, E_R σ₂, E_G σ₁, E_G σ₂), as the uniform's comment says, and adds ½(h.x + h.y) to red and ½(h.z + h.w) to green. Red therefore receives the narrow blur of the *average of red and green*, and green the wide blur of the same average. The WGSL blur takes one weight per channel per tap (a `vec4`), and each channel is named, so this class of mismatch disappears; the halation model itself moves to spektrafilm's per-layer form in µm (§5.6).
2. **The repeating grain tile** (2833–2875, 1965). Grain comes from a 1024² noise texture with `repeat` wrapping and 3 µm texels, so it repeats every 3.07 mm on the film, about 12 times across a 36 mm frame, and the seed is fixed. Replace it with a counter-based generator keyed on frame coordinates (§5.6).
3. **Radii as frame fractions** (966, 3030; also `MASK_RADIUS`, `MID_RADIUS`, bloom's 3.5 %). Physical effects (halation, scatter, DIR diffusion, grain) take µm on the film. Look operators that are intentionally relative to the picture (the contrast-mask bases, bloom) may stay as fractions, documented as such.
4. **Neighbourhoods in render pixels.** Texture (5 × 5, σ = 1 px, `FS_PRINT` 2006–2010), grain reduction (5 × 5, `FS_PD` 1953–1963) and sharpening (3 × 3, `FS_OUT` 2055–2058) are defined in render pixels, so the 2048-px preview and the full-resolution export differ. Define them in µm and convert per target.
5. **`pow`/`log` for powers of ten** throughout `shaders.js`. Use `exp2`/`log2` with constants.
6. **f16 source tiles in export** (`exportTiles`, 3194, `float32: false`). The export uploads 16-bit scans as half floats. Upload the integers instead (§5.5).

## 5. Design

### 5.1 Module layout

```text
packages/gpu/
  src/
    device.ts            GpuRuntime: adapter, device, limits and features, loss handling, caps
    limits.ts            negotiation: wanted vs adapter limits, the result recorded in caps
    pool.ts              BufferPool, TexturePool, ReadbackRing; byte budget and OOM retry
    pipelines.ts         PipelineCache: WGSL hash → compute pipeline; compile diagnostics; prewarm
    layout.ts            uniform struct packing with WGSL alignment rules
    timing.ts            GpuTimer: timestamp queries when available, else submit → onSubmittedWorkDone
    tiles.ts             planTiles(): tiles, halos, global fields
    tables/
      keys.ts            TableKey → canonical JSON → SHA-256 id
      cache-opfs.ts      OPFS-backed table cache with an in-memory LRU in front
      build-gpu.ts       SOLVE and SPECTRAL dispatch
      build-workers.ts   worker pool (shared queue, urgent jobs, transfer)
      table-worker.ts    module worker importing @chromobench/core builders
      upload.ts          Float32Array → 3-D texture (rgba32float or rgba16float)
    kernels/
      common.wgsl  solve.wgsl  spectral.wgsl  dyes.wgsl  pd.wgsl  print.wgsl  output.wgsl
      blur.wgsl  guided.wgsl  global.wgsl  reduce.wgsl  rng.wgsl  interp.wgsl  sat.wgsl
    chain/
      lower.ts           NodeRef graph → ExecPlan (stage kernels, taps, global fields)
      uniforms.ts        recipe-derived values (from core) → packed uniform buffers
      run.ts             executes an ExecPlan for one tile or one preview target
    measure.ts           histogram, statistics, densitometer patches
    engine-gpu.ts        class GpuEngine implements Engine
  parity/
    harness.ts           compare(fast, slow, {tolerance, threshold}) → {maxDiff, flips}
    tests/*.parity.ts    table, chain, tile, kernel and RNG parity tests
    page/                Vite test page loaded by Playwright
```

### 5.2 Runtime

The runtime is the only owner of the device. Everything else receives a `GpuRuntime` and asks it for buffers, textures and pipelines.

```ts
// packages/gpu/src/device.ts (sketch)
export interface GpuCaps {
  available: boolean; why?: string;               // false: no WebGPU, no adapter, or requestDevice failed
  adapter: { vendor: string; architecture: string; description: string; fallback: boolean };
  limits: Pick<GPUSupportedLimits, 'maxTextureDimension2D' | 'maxTextureDimension3D' | 'maxBufferSize'
    | 'maxStorageBufferBindingSize' | 'maxComputeWorkgroupStorageSize' | 'maxComputeInvocationsPerWorkgroup'>;
  features: { f16: boolean; float32Filterable: boolean; timestamps: boolean };
  budgetBytes: number;                            // our own memory budget; WebGPU cannot report free memory
}

export class GpuRuntime {
  static async create(opts?: { forceFallback?: boolean; budgetBytes?: number }): Promise<GpuRuntime>;
  readonly device: GPUDevice;
  readonly caps: GpuCaps;
  readonly buffers: BufferPool; readonly textures: TexturePool; readonly pipelines: PipelineCache;
  readonly timer: GpuTimer;
  onLost(cb: (info: GPUDeviceLostInfo) => void): void;
  destroy(): void;
}
```

**Limits negotiation.** Request the adapter with `powerPreference: 'high-performance'`; if none, retry with `forceFallbackAdapter: true` (as `gpuDevice` does, 3521–3536). Then ask for what the engine benefits from, capped by what the adapter offers:

```ts
// packages/gpu/src/limits.ts (sketch)
const WANT = {
  maxTextureDimension2D: 16384,
  maxBufferSize: 1 << 30,                 // 1 GiB: enough for 2048² rgba32float tiles with room to spare
  maxStorageBufferBindingSize: 1 << 30,
  maxComputeWorkgroupStorageSize: 16384,
};
export function negotiate(adapter: GPUAdapter) {
  const requiredLimits: Record<string, number> = {};
  for (const [k, v] of Object.entries(WANT)) requiredLimits[k] = Math.min(v, (adapter.limits as any)[k]);
  const optional: GPUFeatureName[] = ['float32-filterable', 'shader-f16', 'timestamp-query'];
  const requiredFeatures = optional.filter((f) => adapter.features.has(f));
  return { requiredLimits, requiredFeatures };
}
```

Never request a limit the adapter did not report: that rejects the whole device. Record the granted values in `caps`; the tile planner reads them.

**Fallback detection.** Read `adapter.info.isFallbackAdapter`. Older Chromium versions exposed `adapter.isFallbackAdapter` or required `requestAdapterInfo()`; the Studio handles both (3528–3529). The policy follows `Accel.order`: on a hardware adapter the GPU builds tables and runs the chain; on a fallback adapter the f64 workers build tables, and the GPU still runs the per-pixel chain, which even a software renderer does faster than JavaScript (the Studio's WebGL chain redrew the Gold 200 frame in 0.65 s on SwiftShader, against about 5 s for solving every pixel in JavaScript, textbook §4 introduction). If WebGPU is unavailable, `caps.available` is false with a reason, and the host uses the reference engine.

**Device loss.** `device.lost` resolves when the GPU process crashes, the driver resets or memory runs out. On loss: reject in-flight `evaluate` promises with a `Diagnostic` of code `E_DEVICE_LOST`, drop pools, pipelines and uploaded tables (their bytes remain in the OPFS cache), and recreate the device on the next call. The host may retry once.

**Pools.** Allocation is slow and fragments memory; pooling also lets the engine enforce its own budget, because WebGPU cannot report free memory.

```ts
// packages/gpu/src/pool.ts (sketch)
export interface TexDesc { format: GPUTextureFormat; w: number; h: number; d?: number; usage: number }
export class TexturePool {
  acquire(desc: TexDesc, label: string): GPUTexture;   // reuse a released texture with the same desc, else create
  release(t: GPUTexture): void;                        // back to the free list, not destroyed
  pin(t: GPUTexture, owner: string): void;             // e.g. global fields held by a running export
  trim(targetBytes: number): void;                     // destroy least-recently released textures
  readonly bytesLive: number;
}
```

Wrap allocations in `device.pushErrorScope('out-of-memory')`. On a `GPUOutOfMemoryError`, trim the pools, halve the budget and retry once; on a second failure, return a `Diagnostic` that the planner can answer with smaller tiles.

**Pipeline cache.** Key pipelines by a hash of the WGSL text, entry point, override constants and bind group layout. Use explicit bind group layouts (not `layout: 'auto'`) for the chain kernels, so bind groups can be shared between pipelines with the same layout. Compile with `createComputePipelineAsync` and collect `getCompilationInfo()` messages. **Prewarm** every pipeline when the engine starts, as spektrafilm's `numba_warmup.py` warms its kernels (textbook §4.1), so the first slider move does not pay 0.2 to 0.4 s of compilation per kernel.

**Timing.** A dispatch returns as soon as it is queued. The Studio learned that `gl.finish()` does not wait in Chromium (a frame "took" 0.5 ms with it and 652 ms when timed by reading back one texel, textbook §4.4). In WebGPU:

- With `timestamp-query`, write timestamps around each pass and resolve them into a buffer. Expect 100 µs quantisation in Chrome.
- Without it, time from `queue.submit()` to `await queue.onSubmittedWorkDone()` or to the `mapAsync` of the result. Timing every pass this way stalls between passes and inflates the total (2,781 ms stalled against 1,410 ms timed once, textbook §4.4), so per-pass numbers measured by stalling show proportions only.

### 5.3 Tile planner

The planner answers four questions for a given frame, graph and device: how large a tile is, how wide its halo is, which kernels are too wide for a halo and must be computed once as **global fields**, and at what resolution each field is computed.

```ts
// packages/gpu/src/tiles.ts (sketch)
export interface Rect { x: number; y: number; w: number; h: number }
export interface SpatialKernel {
  id: string;                                // e.g. 'film.halation/bounce', 'pd.grainReduction'
  sigmaUm?: number; radiusUm?: number;       // Gaussian σ or box/bilateral radius on the film, in µm
  chainDepth: number;                        // how many neighbourhood passes precede it in the same tile
  fieldOk: boolean;                          // may it be computed at reduced resolution? (smooth result)
}
export interface GlobalField { kernel: string; downsample: number; w: number; h: number; sigmaPx: number }
export interface TilePlan {
  frame: { w: number; h: number; umPerPx: number };
  tile: number; halo: number;
  tiles: { index: number; core: Rect; read: Rect }[];   // row-major; read = core grown by the halo, clamped
  fields: GlobalField[];
  stats: { w: number; h: number };                        // size of the statistics pass, reported with results
  bytesPerTile: number;
}
export function planTiles(frame: { w: number; h: number; umPerPx: number },
                          kernels: SpatialKernel[], caps: GpuCaps,
                          opts?: { maxHaloPx?: number; minTile?: number }): TilePlan;
```

The algorithm, in pseudocode:

```text
planTiles(frame, kernels, caps):
  haloBudget = opts.maxHaloPx ?? 32
  for k in kernels:
      rPx = ceil(3·k.sigmaUm / frame.umPerPx)  or  ceil(k.radiusUm / frame.umPerPx)
      if rPx ≤ haloBudget or not k.fieldOk: local += (k, rPx)
      else:                                 wide  += (k, rPx)
  # neighbourhood passes chained in one tile compound: a pass reading 2 px of a pass that read 2 px needs 4
  halo = 1 + max over chains of Σ rPx of the local kernels in that chain     # +1 for bilinear safety
  for k in wide:
      σPx = k.sigmaUm / frame.umPerPx
      s   = largest power of two with σPx / s ≥ 2  and  ceil(frame.w / s) ≤ caps.maxTextureDimension2D
      fields += { kernel: k.id, downsample: s, w: ceil(frame.w / s), h: ceil(frame.h / s), sigmaPx: σPx / s }
  bytesPerPixel = Σ over live intermediates of their format sizes
  T = largest power of two with (T + 2·halo)² · bytesPerPixel ≤ caps.budgetBytes / 2
      and T + 2·halo ≤ caps.limits.maxTextureDimension2D;   T ≥ opts.minTile ?? 256
  tiles = row-major grid of T × T cores; read rect = core grown by halo, clamped to the frame
  return plan
```

Notes on the choices:

- **Why σ/s ≥ 2 px.** Computing a field at downsample s area-averages s × s pixels first, which adds the variance (s² − 1)/12 of a box filter per axis (textbook §4.3). With s ≤ σ/2 the added width is under about 1.5 % of σ. The same rule reproduces the Studio's choices: bloom at σ = 3.5 % of the long side is blurred at half the global size.
- **Kernels that are not smooth fields** (grain reduction, texture, sharpening) must stay local even if wide; the planner then grows the halo or reports a `Diagnostic` if the halo exceeds a quarter of the tile.
- **Frame edges.** The read rectangle is clamped at the frame edge, and kernels sample with clamp-to-edge in both the tiled and the one-pass render, so the edge pixels agree.
- **Position-dependent stages** (global-field reads, edge burn, grain) must use frame coordinates, not tile coordinates. Every chain kernel receives `tileOrigin` and `frameSize` and computes `frameUV(p) = (tileOrigin + p + 0.5) / frameSize`, the WGSL form of the Studio's `G()`.
- **Statistics** (auto colour, the median of Y, gamut-class percentages) are computed from a reduced image whose size is fixed and reported (the Studio uses 640 px). The textbook shows the same frame is 19.3 % unreachable at 640 px and 21.8 % at full size (§3.5), so a percentage without its size means nothing.
- **Previews** use the same planner: a 2048-px working image is usually one tile.

A worked plan for a 100 MP negative scan: a 6 × 7 frame (69.5 mm long) scanned to 11,600 × 8,700 px, so 6.0 µm per pixel, with a budget of 512 MiB and a granted `maxTextureDimension2D` of 16,384. The photographer has switched on halation (in spektrafilm's form, §5.6), the contrast mask, grain reduction, texture and sharpening:

| Kernel | Size | Radius at full resolution | Placement |
|---|---|---|---|
| halation bounces σ_h√k, k = 1, 2, 3 | 65, 92, 113 µm | 33, 46, 57 px | global field at downsample 4 (σ 2.7 to 4.7 px), 2,900 × 2,175 |
| contrast-mask and clarity bases (guided filter) | 4 % and 0.8 % of the long side | 464 and 93 px | global field at the statistics size, as in the Studio |
| grain reduction (bilateral 5 × 5) | 2 px today; in µm after fix 4 | 2 px | local, reads `film-dyes` |
| texture (5 × 5) | 2 px | 2 px | local, reads `printing-density` |
| sharpening (3 × 3) | 1 px | 1 px | local, reads `print-xyz` |

The three local kernels are chained (each reads the output of a stage that already read neighbours), so the halo is 1 + 2 + 2 + 1 = 6 px, rounded up to 8 for alignment, which is the Studio's value. With five `rgba32float` intermediates (80 bytes per pixel) and half the budget for one tile, T = 1024: (1024 + 16)² × 80 B = 87 MB fits, while 2048 would need 341 MB. The frame has 12 × 9 = 108 tiles, and the halo costs 3.2 % extra pixels.

The forward path (CHB-012) adds wider local kernels. For a RAW photo simulated on the same 6 × 7 frame, spektrafilm's exponential scatter (Gaussians up to 2.77 × 9.3 = 25.8 µm) has a 13-px radius and the DIR inhibitor's 20 µm Gaussian a 10-px radius, so that chain needs a halo of about 1 + 13 + 10 = 24 px, while the DIR's 200 µm exponential tail becomes another global field.

### 5.4 Tables

**Keys.** A `TableKey` names everything the table's values depend on. The id is the SHA-256 of its canonical JSON (keys sorted, numbers in JavaScript's shortest round-trip form, typed arrays as hex of their bytes):

```ts
// packages/gpu/src/tables/keys.ts (sketch; proposed for the contract in §10)
export type TableKey =
  | { kind: 'solve'; schema: 1;
      channels: Hash;                 // SHA-256 of the scanner's normalised responsivities P̂_k (81 × 3 f64)
      film: Hash;                     // SHA-256 of the film's unit dye spectra and base (as consumed)
      domain: { lo: number; hi: number; N: number };
      solver: { lo: number; hi: number; tol: number; gtol: number; maxIt: number; activeSet: boolean };
      scan?: string;                  // source sha256, present whenever an input is per-scan (calibrated scanner)
      builder: 'f64' | 'gpu-f32'; kernel?: Hash }
  | { kind: 'pd'; schema: 1; film: Hash; printing: Hash /* lamp × filters × paper sensitivity */;
      domain: { lo: number; hi: number; N: number }; builder: 'f64' | 'gpu-f32'; kernel?: Hash }
  | { kind: 'print'; schema: 1; paper: Hash /* dyes and base, fade stain included */; viewing: Hash; adaptTo: [number, number, number];
      domain: { lo: number; hi: number; N: number }; builder: 'f64' | 'gpu-f32'; kernel?: Hash }
  | { kind: 'curve'; schema: 1; stock: Hash; which: 'film-fwd' | 'film-inv' | 'paper';
      domain: { lo: number; hi: number; N: number } };
export type Hash = string;
export async function tableId(key: TableKey): Promise<string>;
```

Hashing the arrays the builder actually consumes, instead of naming the stock, means a data pack update (CHB-004) changes the key without anyone remembering to bump a version. The domain and N are always in the key, which is the spektrafilm lesson. The scan's identity is in the key whenever an input is per scan; the same rule applies to the engine's source-texture cache, which is keyed on the source's SHA-256, its decode options, geometry and flat field, the lesson of the Studio's `Source.uid` fix (textbook §4.1; `source.js` `working`, 2652–2665).

**Build backends.** `prepare(keys)` resolves each key in order: in-memory map → OPFS cache → build. Builds use one of three backends, in `Accel.order`'s order:

- **GPU (f32)**: `solve.wgsl` and `spectral.wgsl`, one invocation per node, 64 per workgroup, ⌈35,937/64⌉ = 562 workgroups.
- **Workers (f64)**: a pool of min(8, cores) module workers running core's builders over node ranges of 512 (solve) or 2,048 (pd, print) from one shared queue, short tables marked urgent. This is the **reference build**: bitwise equal to the same code on the main thread.
- **Main thread (f64)**: time-sliced at 30 ms like `solveTable` (1681–1697), only as a last resort.

Record the builder in the key. A preview may use whichever table arrives first. A golden-image test or an export names the builder it wants, so a reproduced render never silently mixes builders.

**The kernels.** Port `SOLVE` and `SPECTRAL` with these rules, all from textbook §4.5:

- Stage the seven spectra (three channel weights, three dyes, base) into `var<workgroup>` memory, every invocation copying every 64th value, then `workgroupBarrier()`, then the range check. Never return before the barrier.
- Express held dyes with `select` masks, as the Studio does (`let m = select(vec3<f32>(1.0), vec3<f32>(0.0), act)`).
- Raise `gtol` to at least 10⁻⁶. Keep `tol` = 10⁻¹² for F (the sum of squared residuals), 50 iterations, 12 trial steps.
- Do not name a variable `active`, `filter` or `target`.

**Writing the result.** Each kernel writes its node to a storage buffer (for read-back, caching and parity) and to a `texture_storage_3d<rgba32float, write>` (for the chain). Writing the texture directly avoids a trap: `copyBufferToTexture` requires `bytesPerRow` to be a multiple of 256, and a 33-texel row of `rgba32float` is 528 bytes. Uploading a table that comes from the workers or OPFS uses `queue.writeTexture`, which has no such alignment requirement.

**Storage format.** With `float32-filterable`, store tables as `rgba32float`. Without it, store preview copies as `rgba16float` (filterable in core, ±0.001 in dye amount near 2.0, ten times below the 0.01 residual flag, textbook §4.2) and keep an `rgba32float` copy for the export path, which never uses hardware filtering.

**OPFS cache.** The Origin Private File System (WHATWG File System Standard) is a private, origin-scoped file system: `navigator.storage.getDirectory()` returns its root, and in a dedicated worker `createSyncAccessHandle()` gives fast synchronous reads and writes.

```text
opfs:/chromobench/tables/v1/
  <tableId>.tbl      header: magic "CBTB", version, JSON length, canonical key JSON,
                     { N, channels: 4, format: 'f32', created, payloadSha256 }, padding to 16 bytes,
                     then N³ × 4 float32 values, x fastest
  index.json         { tableId: { bytes, lastUsed } } for LRU eviction
```

Write to `<id>.tmp`, verify the payload hash, then rename. On read, check the magic, the version, that the stored key equals the requested key (a hash collision is improbable, a format bug is not) and the payload hash. Default budget: 200 MB, evicting least recently used entries. Call `navigator.storage.persist()` once; without it, the browser may evict the whole origin's storage under pressure, which costs only a rebuild.

### 5.5 Per-pixel chain

**From nodes to kernels.** The engine receives a `NodeRef` whose graph runs from a source to the requested domain. `lower()` walks the graph backwards and maps nodes onto four **stage kernels** that mirror the Studio's passes, with uniform switches for optional steps. Branching on a uniform is free (all invocations take the same branch).

| Stage kernel | Catalog ops it evaluates | Output domain (tap) |
|---|---|---|
| `dyes.wgsl` | `scan.density`, `invert.dyes` (and the re-exposure of `film.halation` for scans) | `scanner-density` or `film-dyes` (+ residual) |
| `pd.wgsl` | `film.grain` (scan path), the grain-reduction finishing op, `print.expose` | `printing-density` |
| `print.wgsl` | `print.lights`, exposures and masks (CHB-010), `print.preflash`, `print.develop`, `view.reflect`, `view.flare` | `paper-logH`, `paper-dyes` or `print-xyz` |
| `output.wgsl` | `view.adapt`, `output.display` | `display-rgb` |

Passes are cut only where the next step reads neighbours (textbook §4.8). If no neighbourhood operator is active between `dyes` and `pd`, `lower()` fuses them into one dispatch. Each stage kernel can stop early and write its intermediate domain, which is how taps work.

The engine caches results by `(node id, scale, region)`, as the contract specifies. Because nodes are hash-consed, a printer-light change creates a new `print.lights` node but leaves the `printing-density` node unchanged, so its texture is reused and only `print.wgsl` and `output.wgsl` run. The Studio re-ran all four passes on every redraw.

**Compute rather than fragment.** Image kernels are compute shaders with 8 × 8 workgroups, reading inputs with `textureLoad` and writing `texture_storage_2d` outputs. Sixty-four invocations per group matches the Studio's table kernels. The trade-offs are in decision record D1.

**Uniforms.** The values that drive the chain (the lights vector, `clear + L`, pads, gamma, flash, fade factors, flare, gain) are computed by core (CHB-003) on the CPU, as `frameParams` (2100–2157) and `paperX` (2158–2166) do in the Studio. `chain/uniforms.ts` only packs them. A uniform array of weights must use a 16-byte stride in WGSL's uniform address space, so blur weights are `array<vec4<f32>, 97>`: one weight per channel per tap.

**Preview path** (`precision: 'preview'`). The source is the working image (long side ≤ 2048 px, area-averaged by ingest) uploaded as `rgba16float`; f16 quantises density by at most 0.434 × 2⁻¹¹ ≈ 2×10⁻⁴ D, forty times below Gold 200's noise of 0.007 to 0.012 D (textbook §3.5). Tables are read with one hardware-filtered `textureSampleLevel` each (trilinear), with the half-texel mapping. Intermediates are `rgba16float`.

**Export path** (`precision: 'export'`). Three changes, each closing a measured gap:

1. **Exact source.** Upload 16-bit scans as `rgba16uint` and convert in the shader (T = u / 65535). This is exact and costs the same 8 bytes per pixel as `rgba16float`.
2. **Exact per-pixel solve.** Run the `SOLVE` algorithm per pixel instead of reading the table. On Gold 200 the table overstates unreachable pixels by about five points (19.3 % against 13.7 % exact at 640 px, 21.8 % against 17.1 % at full size), because cells that straddle the reachable set's edge interpolate the residual (textbook §3.5). The per-pixel kernel starts from clamp(a) like the table build and the CPU solver, so at a node position it reproduces the table's value, which is a unit test. Cost: about 6.5 passes over 81 samples per pixel. Extrapolating the textbook's SwiftShader timing (35,937 nodes in 0.30 to 0.39 s, §4.5) gives about 8 s for the 0.8 MP Gold 200 frame in CI; hardware timings for 100 MP must be measured in stage 4.
3. **Manual tetrahedral lookup** for the pd and print tables, from four `textureLoad`s in f32, which removes the 8-bit filter weights and is 1.9 times more accurate than trilinear (textbook §4.2).

```wgsl
// kernels/interp.wgsl (sketch): tetrahedral lookup in an N³ rgba32float table over [lo, hi]³
fn tetra(T: texture_3d<f32>, v: vec3<f32>, lo: f32, hi: f32, N: u32) -> vec4<f32> {
  let u = clamp((v - vec3<f32>(lo)) / (hi - lo), vec3<f32>(0.0), vec3<f32>(1.0)) * f32(N - 1u);
  let i = min(vec3<u32>(floor(u)), vec3<u32>(N - 2u));
  let t = u - vec3<f32>(i);
  // order the fractions: t1 ≥ t2 ≥ t3 picks one of six tetrahedra sharing the main diagonal
  var e1: vec3<u32>; var e2: vec3<u32>; var f: vec3<f32>;
  if (t.x >= t.y && t.y >= t.z)      { e1 = vec3(1u,0u,0u); e2 = vec3(1u,1u,0u); f = t.xyz; }
  else if (t.x >= t.z && t.z >= t.y) { e1 = vec3(1u,0u,0u); e2 = vec3(1u,0u,1u); f = t.xzy; }
  else if (t.z >= t.x && t.x >= t.y) { e1 = vec3(0u,0u,1u); e2 = vec3(1u,0u,1u); f = t.zxy; }
  else if (t.y >= t.x && t.x >= t.z) { e1 = vec3(0u,1u,0u); e2 = vec3(1u,1u,0u); f = t.yxz; }
  else if (t.y >= t.z && t.z >= t.x) { e1 = vec3(0u,1u,0u); e2 = vec3(0u,1u,1u); f = t.yzx; }
  else                               { e1 = vec3(0u,0u,1u); e2 = vec3(0u,1u,1u); f = t.zyx; }
  let v000 = textureLoad(T, i, 0);
  let v1   = textureLoad(T, i + e1, 0);
  let v2   = textureLoad(T, i + e2, 0);
  let v111 = textureLoad(T, i + vec3(1u), 0);
  return (1.0 - f.x) * v000 + (f.x - f.y) * v1 + (f.y - f.z) * v2 + f.z * v111;
}
```

The `if` chain diverges per pixel; write it with `select` once it is correct, and compare both forms in the parity harness.

Export intermediates are `rgba32float`. The final 16-bit output is written with `pack2x16unorm`, two channels per `u32`, which rounds to 16-bit unsigned integers on the GPU and halves the read-back. `rgba16float` must never carry a 16-bit export: its 11-bit significand spaces values near 1.0 by 2⁻¹¹, 32 times coarser than a 16-bit step.

**Reductions.** The Studio reads the 640-px printing density back and computes statistics on the CPU (`frameStats`, 2167–2180). The GPU engine computes them on the GPU so that `measure` and the agent's queries do not need read-backs of whole images:

- **Histogram:** each workgroup accumulates into `var<workgroup> bins: array<atomic<u32>, 256>` with `atomicAdd`, then adds its bins to a global storage buffer. A barrier separates the two phases, reached by every invocation.
- **Means and LATD** (large-area transmission density, −log₁₀ of the mean of 10^−PD per channel, used by auto colour): per-workgroup partial sums, then a second dispatch that sums the partials pairwise. Pairwise summation keeps the f32 error near log₂(n) roundings instead of n.
- **Median of Y** (the contrast-mask reference `Bref`): a 4,096-bin histogram over a fixed density range, then a second pass that refines the bin containing the median.
- **Gamut classes** (blank film, below base, out of gamut): count with atomics; the definitions and the noise σ come from CHB-006 and CHB-003.
- **Densitometer readings and patches** (`measure.densitometer`, `measure.patches`): the mean of a domain over a box or a list of boxes, one workgroup per box, summed pairwise. CHB-010's test strips read their patch densities this way, so the agent gets numbers without reading back the image.

### 5.6 Spatial kernels

**Separable blur.** One kernel, two dispatches (horizontal, vertical), weights from a uniform array with one weight per channel per tap, looping to the largest radius among the four channels:

```wgsl
// kernels/blur.wgsl (sketch)
struct Blur { dir: vec2<i32>, R: u32, pad: u32, w: array<vec4<f32>, 97> };   // w[i]: weight of tap ±i per channel
@group(0) @binding(0) var<uniform> B: Blur;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba32float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let size = vec2<i32>(textureDimensions(src));
  let p = vec2<i32>(g.xy);
  if (any(p >= size)) { return; }                       // no barrier in this kernel, so an early return is fine
  var acc = textureLoad(src, p, 0) * B.w[0];
  for (var i = 1u; i <= B.R; i++) {
    let d = B.dir * i32(i);
    let a = textureLoad(src, clamp(p + d, vec2<i32>(0), size - 1), 0);
    let b = textureLoad(src, clamp(p - d, vec2<i32>(0), size - 1), 0);
    acc += (a + b) * B.w[i];
  }
  textureStore(dst, p, acc);
}
```

The host computes the weights exactly as `blurKernel` does: Gaussian taps truncated at R = ⌈3σ⌉ (at most 96), normalised so the centre plus twice each side sums to one. Bilinear tap merging (one fetch at i + t for two taps, textbook §4.3) is a later optimisation; it needs the same offsets in all four channels.

**Halation in µm.** The halation model of spektrafilm (textbook §2.4) acts on linear exposure E before the logarithm, per layer:

```text
E₁ = (1 − w)·G(σ_c) ∗ E₀ + w·X(λ_t) ∗ E₀            X ≈ three Gaussians of 0.54, 1.52, 2.77 × λ_t
E₂ = (E₁ + a·Σ_{k=1..3} w_k·G(σ_h√k) ∗ E₁) / (1 + a)    w_k = 4/7, 2/7, 1/7
red layer: σ_c = 2.2 µm, λ_t = 9.3 µm, w = 0.78; σ_h = 65 µm (still) or 50 µm (cine);
a per layer from the antihalation preset: strong (0.015, 0.005, 0), weak (0.08, 0.02, 0), none (0.30, 0.10, 0.015)
```

On the GPU: the four first-stage Gaussians of one layer are four channels of one blur pass (local, inside the halo); the three halation bounces are three channels of one blur pass on a global field (§5.3). Dividing by 1 + a keeps the total exposure, which the Studio's version does not. CHB-012 owns the parameters and the op `film.halation`; CHB-005 provides the Gaussian-mixture primitive and the placement. For scans, the Studio re-exposes halation onto the solved dyes (dyes → exposure through the inverse film curve → add the halo → forward curve, `FS_DYES` 1930–1937); keep that as an option of `dyes.wgsl` with the packing fixed.

**DIR diffusion.** The inhibitor a = Mᵀd⁰ spreads by a Gaussian of 20 µm plus 6 % of a two-dimensional exponential of decay length 200 µm before the final development (textbook §2.3). The Gaussian is local; the exponential tail, approximated by Gaussians as for halation, is a global field. The order of the stages (inhibitor computed per pixel, blurred, then applied before the curve) is CHB-012's; the kernels are the same blur.

**The grain generator.** The replacement for the noise tile is a stateless **counter-based** generator: a hash of integer coordinates that returns uniform random bits, so any pixel's noise can be computed independently, in any tile, in any order. Two candidates:

- **PCG-family hashes** (`pcg3d`/`pcg4d`) from Jarzynski and Olano, "Hash Functions for GPU Rendering", *JCGT* 9(3), 2020: only 32-bit multiplies and xor-shifts, which WGSL has.
- **Philox4x32-10** from Salmon et al., "Parallel random numbers: as easy as 1, 2, 3", SC 2011: the standard in CUDA and NumPy, but it needs the high half of a 32 × 32-bit product, which WGSL lacks, so it must be emulated with 16-bit pieces.

Use `pcg4d` keyed on `(x, y, k, seed)` with k the film layer, where (x, y) are integer coordinates of the pixel in the **full-resolution frame**, not the tile, and `seed` comes from the recipe. Gaussian values come from Box–Muller on two uniforms. Because the key is the frame position, a tiled export and a one-pass render produce bit-identical grain, and nothing repeats. A preview at a reduced scale draws its own realisation with the variance scaled by area (Selwyn's law, σ²·A constant, textbook §2.5); its statistics match the export, its exact pattern does not. Decision record D5 discusses consistent multi-scale noise. The grain *model* (Gaussian with σ ∝ √(c + 0.05) in the Studio, Poisson–binomial per sublayer in spektrafilm) is CHB-012's; avoid per-pixel loops of variable length (Knuth's Poisson sampler draws about λ + 1 uniforms) because a workgroup waits for its slowest pixel.

```wgsl
// kernels/rng.wgsl (sketch): pcg4d after Jarzynski & Olano (2020)
fn pcg4d(v0: vec4<u32>) -> vec4<u32> {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v = v ^ (v >> vec4<u32>(16u));
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
fn normals2(px: vec2<u32>, k: u32, seed: u32) -> vec2<f32> {   // k: film layer
  let r = pcg4d(vec4<u32>(px, k, seed));
  let u1 = (f32(r.x >> 8u) + 0.5) / 16777216.0;            // 24-bit uniform in (0, 1)
  let u2 = f32(r.y >> 8u) / 16777216.0;
  let m = sqrt(-2.0 * log(u1));
  return vec2<f32>(m * cos(6.2831853 * u2), m * sin(6.2831853 * u2));
}
```

**Summed-area tables.** Avoid f32 SATs. Where a box filter is needed, use the separable blur (O(R) per pixel, cheap at reduced resolution), which is what the Studio does. If an O(1) box is needed on the GPU, build the SAT over values quantised to fixed point in `u32` and let the arithmetic wrap: a box sum computed modulo 2³² is exact as long as the true box sum fits in 32 bits, however large the table's entries grow. (WGSL integer arithmetic on runtime values wraps on overflow; verify this with a probe kernel in the parity harness, as the textbook verified the barrier rule.) The prefix sum itself takes log₂(width) passes on a GPU (textbook §4.3).

### 5.7 Decision records

**D1. Compute shaders for the chain, not fragment shaders.** *Context:* WebGPU offers both; the Studio's chain is fragment shaders. *Alternatives:* (a) port to WebGPU render pipelines with fragment shaders, keeping the full-screen-triangle structure; (b) compute shaders writing storage textures. *Decision:* (b). *Rationale:* reductions (histogram, statistics) and the exact per-pixel solve need workgroup memory and atomics, which fragment shaders do not have; one kind of kernel and one resource model for the chain, the tables and the reductions; tiles are dispatch grids. *Consequences:* outputs must be storage-capable formats (`rgba32float`, `rgba16float` and `rgba16uint` are, `bgra8unorm` needs a feature), so the final blit to the canvas is a tiny render pass owned by the viewer. *Status:* proposed.

**D2. Four fused stage kernels with uniform switches, not generated kernels per graph.** *Context:* the graph can contain any subset of ops. *Alternatives:* (a) generate WGSL per graph by concatenating op snippets; (b) four hand-written stage kernels mirroring the Studio's passes, with uniform flags. *Decision:* (b) for v1. *Rationale:* the Studio's passes are measured and correct; uniform branches cost nothing; a fixed set of pipelines can be prewarmed; generated code multiplies compile time and test surface. *Consequences:* a new op either fits a stage kernel's switch or adds a kernel. Revisit if the catalog grows past what the switches express. *Status:* proposed.

**D3. A separate export precision path.** *Context:* hardware trilinear filtering uses 8-bit weights; the solve table misclassifies pixels near the reachable set's edge; f16 sources and intermediates lose bits. *Decision:* `precision: 'export'` uses integer source upload, an exact per-pixel solve, manual tetrahedral lookups and f32 intermediates; `'preview'` keeps the fast path. *Consequences:* export is slower (to be measured); preview and export differ by at most the table error, which the parity harness bounds. *Status:* proposed.

**D4. Wide kernels as global fields at reduced resolution.** *Context:* halation and DIR tails reach 57 px and beyond at full resolution. *Alternatives:* (a) halos as wide as the widest kernel (57 px on a 1024 tile is 24 % overhead, and DIR's 200 µm tail is far wider); (b) global fields at a planner-chosen downsample, read through frame coordinates. *Decision:* (b), with the σ/s ≥ 2 px rule. *Consequences:* fields are pinned for the duration of an export; the parity harness must include a field-versus-full-resolution comparison. *Status:* proposed.

**D5. Grain keyed on full-resolution frame coordinates.** *Context:* the Studio's tile repeats every 3.07 mm. *Alternatives:* (a) counter-based noise per full-resolution pixel, area-scaled variance at preview scales; (b) consistent multi-scale noise, where each level's values are generated from their parent's sum plus zero-sum noise keyed on (level, x, y), so a preview shows exactly the export's grain averaged; (c) Newson et al.'s continuous Boolean model (textbook §2.5), resolution-free but expensive. *Decision:* (a) for v1, (b) as a follow-up if photographers compare preview grain with the export. *Status:* proposed.

**D6. Table builder policy.** *Context:* GPU builds differ from f64 builds by up to 2.2×10⁻⁶; the f64 workers are bitwise reproducible. *Decision:* the builder is part of the table key; previews accept either; golden tests and exports name `'f64'`; a GPU-built table may be upgraded to the f64 build in the background. *Status:* proposed.

**D7. f16 only for storage in the preview path.** *Decision:* use `rgba16float` textures (core, no feature needed) for preview intermediates and as the table fallback without `float32-filterable`; do not use `f16` arithmetic in the solve, spectral or output kernels. `shader-f16` is detected and reported but not required. *Status:* proposed.

## 6. One flow traced end to end

**A printer-light change at preview size.** The photographer has a frame open that contains a grey card: a CHB-004 synthetic frame of Portra 400, 1090 × 754 px, printed on Portra Endura under the default flare of 0.48 % of paper white. They drag the red printer light by +10 points.

1. **The recipe changes.** CHB-009 sends `{op: 'set', path: 'print.lights.logH', value: [0.25, 0, 0]}`, logged with `by: 'user'`. Ten points are 10 × 0.025 = 0.25 log H in the red layer.
2. **The graph is recompiled.** `compile(recipe, frameId)` produces a new `print.lights` node; its inputs, the `print.expose` node and everything upstream, have unchanged ids.
3. **The engine looks up its cache** by `(node id, scale, region)`: the `printing-density` texture of the frame at the working scale is still valid. The global pass's statistics are keyed on the negative's nodes and are also valid. Tables are untouched: a printer light is a uniform, because lights factor out of the spectral sum, x(D, ℓ) = x(D, 0) + ℓ, to 2×10⁻¹⁶ (textbook §2.8).
4. **Uniforms.** Core recomputes the lights vector; `clearL = clear + L` changes by +0.25 in red. `chain/uniforms.ts` writes the 16-byte-aligned uniform buffer.
5. **Dispatches.** `print.wgsl` runs over 1090 × 754 pixels in 8 × 8 groups (137 × 95 workgroups), then `output.wgsl`. Per pixel, `print.wgsl` computes x = clearL − PD, applies the pads, gamma and flash, reads the paper curves and the print table, adds flare and gain.
6. **Values at the grey card.** The grey card's negative holds dye amounts (0.687, 0.704, 0.864); the pd and dyes textures that hold them are reused, not recomputed. Before the change the grey card printed neutral at visual density 0.746 (0.755 without flare). With +10 red points the paper's red-sensitive layer receives 0.25 log H more exposure and forms more cyan dye, so the grey card prints cyan (a* = −20.7) and darker (0.956). These values come from the textbook's §2.7 sketch, which ran the spektrafilm-port chain with these stocks; CHB-003 turns them into golden numbers, and the GPU chain must match the reference engine's values for the same inputs within the chain tolerances of §8.
7. **Display.** CHB-009's viewer blits the `display-rgb` texture to the canvas. The time from submit to `onSubmittedWorkDone` is recorded with the label `preview.print+output`.

**One tile of a full-resolution export.** CHB-011 exports the 100 MP frame of §5.3 as a 16-bit TIFF.

1. CHB-011 asks the engine for the plan (`GpuEngine.plan(node, {scale: 'full'})`, a proposed addition) and receives 108 tiles of 1024 px, an 8-px halo and two global fields: halation at downsample 4 and the guided-filter bases at the statistics size.
2. The engine computes the global fields and the statistics once, and pins the fields for the export's node id, so edits the photographer makes during the export (which create new nodes) cannot change them.
3. For tile 14 (row 1, column 2: core x 2048–3071, y 1024–2047; read rect x 2040–3079, y 1016–2055), CHB-011 calls `evaluate(node, {scale: 'full', region: core, precision: 'export'})`.
4. The engine requests the read rect from ingest as 16-bit integers and uploads 1040 × 1040 `rgba16uint`. It runs `dyes.wgsl` with the exact per-pixel solve and the halation re-exposure (sampling the halation field at frame coordinates), `pd.wgsl` with grain reduction and grain keyed on frame coordinates (x 2040–3079), `print.wgsl` with tetrahedral lookups and texture, and `output.wgsl` with sharpening, and writes the core's 1024 × 1024 pixels with `pack2x16unorm`.
5. The engine reads back 1024 × 1024 × 2 `u32` (8 MiB, `bytesPerRow` 8,192, a multiple of 256) and returns them. CHB-011 writes them into the TIFF's strips and reports progress 15/108.

## 7. Implementation plan

**Stage 1: runtime.** Files: `device.ts`, `limits.ts`, `pool.ts`, `pipelines.ts`, `layout.ts`, `timing.ts`, `engine-gpu.ts` (skeleton returning `capabilities()`). Port `gpuDevice` and `pipeline` (3521–3548). Done when: the engine reports caps on SwiftShader in headless Chromium and on one hardware adapter; requested limits never exceed the adapter's; a deliberately broken WGSL kernel produces a `Diagnostic` with a line number; the uniform packer reproduces the Studio's 112-byte `SOLVE` layout (tolerance at byte 96, `activeSet` at byte 104); device loss (forced with `device.destroy()`) rejects in-flight work with `E_DEVICE_LOST` and the next call recreates the device.

**Stage 2: tile planner.** File: `tiles.ts`. Done when: the plan for the 100 MP example matches §5.3 by hand; every pixel belongs to exactly one tile core (property test over random frame sizes); read rects never leave the frame; halos sum along chains; a kernel marked `fieldOk: false` that exceeds a quarter tile yields a `Diagnostic`.

**Stage 3: tables.** Files: `tables/*`, `kernels/solve.wgsl`, `kernels/spectral.wgsl`. Port `SOLVE`, `SPECTRAL`, the pool and `benchmark`. Done when: the three tables build on GPU and workers; worker tables are bitwise equal to the main thread's; the GPU tables pass the §8 tolerances; the OPFS cache round-trips a table bit for bit, rebuilds after the domain or any hashed input changes, and survives a page reload.

**Stage 4: per-pixel chain.** Files: `kernels/{common,dyes,pd,print,output,interp,reduce}.wgsl`, `chain/*`, `measure.ts`. Port `FS_DYES`, `FS_PD`, `FS_PRINT`, `FS_OUT` with the fixes of §4.5; preview and export paths; reductions. Done when: every domain can be tapped; the Gold 200 frame rendered from worker or GPU tables is identical in every 8-bit value; preview against reference and export against reference meet §8; histogram and statistics match a CPU computation on the same read-back; the per-pixel solve at node positions equals the table value.

**Stage 5: spatial kernels.** Files: `kernels/{blur,guided,global,rng,sat}.wgsl`. Done when: the blur matches a direct f64 convolution within one 8-bit level and keeps a flat field flat; halation and DIR fields in µm match the f64 reference; the grain has no detectable period and is tile-invariant; the SAT probe demonstrates the f32 failure and the wrapping-integer success.

**Stage 6: parity harness.** Files: `parity/*`, `playwright.config.ts` entries. Done when: all tests of §8 run in headless Chromium on SwiftShader in CI, each with a broken variant that the test catches.

Start here: create `packages/gpu` with `device.ts` and a Playwright test that opens a blank Vite page, calls `GpuRuntime.create()` and prints `caps`. Launch Chromium with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --enable-features=Vulkan` (the flags Emscripten's WebGPU tests use; Chrome's "Supercharge Web AI model testing" post covers headless GPU set-ups).

## 8. Testing and acceptance

Tolerances are stated here, before any run. Every test must also be shown to fail on a deliberately broken variant; a test that cannot fail proves nothing (textbook §4.7).

**Table parity** (Gold 200 set-up: scanner `xt5-fitted`, Kodak Gold 200, Portra Endura, N = 33, against the f64 worker build):

| Check | Acceptance on SwiftShader | Broken variant that must fail |
|---|---|---|
| GPU solve, max abs(Δc) on nodes the reference reaches (residual < 0.01) | ≤ 2.2×10⁻⁶ | `gtol` = 10⁻⁵ (errors 6.5× larger) |
| GPU solve, flips across 0.01 | 0 | — (see below) |
| GPU printing density, max abs(ΔPD) | ≤ 7.2×10⁻⁷ | `LOG2_10` rounded to 3.32 |
| GPU print, max abs(ΔXYZ) | ≤ 4.2×10⁻⁷ | the 3 × 3 matrix packed row-major instead of column-major |
| workers against main thread | bitwise equal | — |

On hardware adapters, `exp2` and `log2` may be less accurate than SwiftShader's; report hardware results against a looser bound of 10⁻⁵, still ten times below the table's own interpolation error of about 10⁻⁴.

The flip count is zero on every backend, but the textbook warns that this proves little: the table's node residuals have a gap from 7.6×10⁻⁴ to 0.047, so nothing plausible moves a node across 0.01 (§4.7, Figure 4.4). The informative tests are between nodes and on real frames:

- **Lookup between nodes.** At 20,000 random keys in smooth cells, compared with exact f64 solves: the hardware-filtered lookup's rms error must be ≤ 1.6×10⁻⁴ (the 8-bit-weight model; about 9.2×10⁻⁵ if the hardware filters exactly); the manual trilinear lookup from `textureLoad` must match `look3` on the same table to 10⁻⁶; the manual tetrahedral lookup's rms must be about 1.9 times below trilinear. The residual channel puts about 0.9 % of keys (186 of 20,000) on the wrong side of 0.01, all near the reachable edge. A lookup without the half-texel mapping must fail.
- **Interpolation law** (§4.9): `lookup(buildTable(f), x)` equals f(x) at every node, and for a smooth f the mid-cell error falls by four when N − 1 doubles.

**Chain parity.**

- The Gold 200 print rendered from worker tables and from GPU tables is identical in every 8-bit value (textbook §4.7).
- Preview chain against the reference engine on Gold 200 and on synthetic frames from CHB-004: within one 8-bit level in `display-rgb`; in `film-dyes`, rms ≤ 1.6×10⁻⁴ over pixels in smooth cells, with cells at the reachable edge reported separately (up to 0.017, the table's own error).
- Export chain against the reference engine's exact per-pixel path: `film-dyes` within 5×10⁻⁶ on reachable pixels; unreachable classification identical except at pixels whose exact residual lies within 10⁻⁵ of 0.01.
- Golden numbers through the GPU chain: the grey card on Portra 400 → Portra Endura prints at visual density 0.755 and `#70757b` in sRGB (CHB-003's fixtures).

**Tile parity** (the §4.7 test, with grain reduction, texture and sharpening switched on so the halo matters):

- 256-px tiles with an 8-px halo against one pass: mean ≤ 0.001 levels, max ≤ 1 level in 8 bits. The textbook measured mean 0.0004 and max 1.
- The same without a halo must fail: the textbook measured mean 0.017 and max 28 levels.
- A wide kernel computed per tile must fail (20 levels in the textbook's sketch); read from the global field it must pass.
- Grain in tiles and in one pass: bitwise equal.

**Spatial kernels.**

- Separable blur against direct 2-D f64 convolution: ≤ 1 level; a flat field stays flat to 10⁻⁶; truncation at k = 1.5σ instead of 3σ must fail (20 levels at σ = 6 in the textbook's sketch).
- Halation law (§2.9): for any unit-weight kernel K and exposure E > 0, log₁₀(K ∗ E) ≥ K ∗ log₁₀ E pointwise, with equality on uniform areas. A variant that blurs log exposure must fail.
- Halation exposure conservation: the mean of E₂ equals the mean of E₀ to 10⁻⁶ relative (the 1 + a normalisation). The Studio's version fails.
- Grain: mean 0 and unit variance of the normals to 0.5 %; autocorrelation at lag 1,024 px below 0.01 (the Studio's tile gives 1.0); Selwyn's law: σ²·A constant within 5 % across preview scales.
- SAT probe: estimating σ = 0.010 D on a 4096 × 2731 flat field, the f32 SAT must fail as the textbook's CPU experiment did (0.056), and the wrapping-integer SAT must give 0.0100.

**Conformance.** CHB-002's generated suite runs against `GpuEngine` like every engine: domains, units, shapes, error codes, determinism (the same node twice gives bitwise-equal output on the same adapter).

**Fixtures.** `fixtures/scans/gold200` (from `sources/chromogen-studio-1.2/samples/gold200.png`, rebate box [98, 100, 20, 680], crop [126, 60, 1090, 754]); `fixtures/synthetic/` frames with known dye amounts (CHB-004); `fixtures/golden/` from CHB-003; a stored f64 table set for the Gold 200 configuration so that CI does not rebuild it every run.

**How to run.** Playwright Test with a `webServer` serving the Vite test page, Chromium in headless mode with the WebGPU flags above. Each test calls `page.evaluate(() => window.parity.run('<name>'))` and asserts on the returned JSON (`{maxDiff, meanDiff, flips, n, tolerance}`), so failures print numbers, not screenshots. Headless screenshots of WebGPU canvases can come out black on Linux, so compare numbers read back from textures.

## 9. Risks and open questions

- **Exact per-pixel solve cost on real hardware** is unmeasured. If a 100 MP export takes minutes on integrated GPUs, offer `export.solve: 'exact' | 'table-tetrahedral'` and report which was used in the export's metadata. Blocks nothing; measure in stage 4.
- **Precision differences between GPUs.** `exp2`/`log2` accuracy varies; the hardware tolerance of 10⁻⁵ is a guess to be confirmed on the beta machines (CHB-013).
- **Memory budget without a memory API.** The 512 MiB default and the OOM retry are heuristics; integrated GPUs share RAM with a page that may already hold a 600 MB decoded scan.
- **Where the halation re-exposure for scans lives.** The Studio adds halation to a *scanned* negative as a look; the physical forward model (CHB-012) adds it before development. Whether scans keep the look, and under which op name, is for CHB-002 and CHB-012 to settle; the kernel is the same.
- **Statistics size.** Keeping statistics at 640 px matches the Studio but makes percentages size-dependent (textbook §3.5). The size must be reported with every statistic; whether to change it is CHB-003's call.
- **Browser support.** WebGPU on Linux Chromium depends on the GPU; Safari and Firefox support differ. The reference engine is the fallback; the beta platform list (CHB-013) settles what must be tested.

## 10. Proposed contract additions (for CHB-002)

1. **`EngineCaps`** (named but not defined in the design doc): `{ available, why?, adapter: {name, fallback}, maxTextureDimension2D, maxBufferSize, f16, float32Filterable, timestamps, budgetBytes }`. The reference and mock engines report their own values (`fallback: false`, no limits).
2. **`TableKey`**: the discriminated union of §5.4, with the rule that keys hash consumed data, include the domain and N, include the scan's SHA-256 when an input is per scan, and include the builder.
3. **`ImageResult`**: `{ info: ImageInfo; region: Rect; format: 'f32' | 'u16'; read(): Promise<Float32Array | Uint16Array>; gpu?: { texture: GPUTexture } }`. The optional `gpu` handle lets the viewer display a result without a read-back; other engines omit it.
4. **`EvalTarget`** additions: `signal?: AbortSignal` (CHB-011's cancellation); `taps?: Domain[]` to request intermediate domains of the same evaluation.
5. **`Engine.plan(node, target)`** (optional, GPU engine only): returns the `TilePlan`, so CHB-011 can drive a tiled export and show progress in tiles.
6. **`Diagnostic` codes**: `E_DEVICE_LOST`, `E_GPU_OOM`, `E_KERNEL_COMPILE`, `E_HALO_TOO_WIDE`.
7. **Units of spatial arguments**: halation, scatter, DIR diffusion and grain sizes are `ArgSpec` values with `unit: 'um'`; look operators that are relative to the picture use `unit: 'fraction'`.

## 11. References

**Chromobench and Chromogen material** (paths relative to `ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`):

- `design-doc/01-chromobench-architecture-and-work-plan.md`: domains, contracts, layout, work plan.
- `sources/The Mathematics of the Colour Negative.md`: §4.1–4.9 (core reading), §2.3 (DIR diffusion), §2.4 (halation), §2.5 (grain), §2.8 (composition laws), §3.5 (reachability and size dependence).
- `various/extracted/chromogen-studio/05-inline.js`: `model.js` 1620–1901, `shaders.js` 1903–2085, `params.js` 2087–2193, `render.js` 2694–3228, `gpu.js` 3392–3604, `accel.js` 3606–3843.
- `various/extracted/chromogen-studio/04-st-worker.txt.js`: the worker's job handler.
- `various/extracted/chromogen-studio/st-data/book/11-perf.md`: the Studio's own account of tiles, halos and WebGPU.
- `various/analysis-chromogen-studio.md`: §2 (pipeline), §4 (GPU and workers), §6 (limitations and bugs).

**Specifications and platform documentation:**

- W3C, *WebGPU*, https://www.w3.org/TR/webgpu/ : §3.5.1 fallback adapters, §3.6.1.1 features, §3.6.2 limits (default values quoted in §2.3), §3.6.2.4 `GPUAdapterInfo`, §4.3 `requestDevice` errors, §5.2 buffer mapping.
- W3C, *WGSL*, https://www.w3.org/TR/WGSL/ : uniform control flow, reserved words, §15.7.4.1 floating-point accuracy.
- MDN, `GPUSupportedFeatures` and `GPUSupportedLimits`: feature descriptions.
- web3dsurvey.com, WebGPU limits pages for `maxTextureDimension2D`, `maxBufferSize`, `maxStorageBufferBindingSize`: reported adapter values.
- Chrome for Developers, "New in WebGPU 133" (requesting higher limits), "WebGPU developer features" (timestamp quantisation), "Supercharge Web AI model testing" (headless GPU flags).
- WHATWG, *File System Standard*, https://fs.spec.whatwg.org/ (OPFS, sync access handles); *Storage Standard*, https://storage.spec.whatwg.org/ (`persist()`).

**Papers:**

- Jarzynski and Olano, "Hash Functions for GPU Rendering", *JCGT* 9(3), 2020.
- Salmon, Moraes, Dror and Shaw, "Parallel random numbers: as easy as 1, 2, 3", SC 2011.
- Kasson, Nin, Plouffe and Hafner, tetrahedral interpolation, *J. Electronic Imaging* 4(3), 1995 (cited in textbook §4.2).
- Crow, summed-area tables, SIGGRAPH 1984 (cited in textbook §4.3).
- spektrafilm, https://github.com/andreavolpato/spektrafilm : `model/diffusion.py`, `model/couplers.py`, `model/grain.py`, `utils/fast_gaussian_filter.py`, `runtime/services/spectral_lut_compute.py`.
