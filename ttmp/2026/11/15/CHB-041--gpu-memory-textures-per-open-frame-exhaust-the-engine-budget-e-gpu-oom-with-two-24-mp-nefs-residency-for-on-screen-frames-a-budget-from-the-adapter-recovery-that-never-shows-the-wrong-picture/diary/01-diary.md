---
Title: Diary
Ticket: CHB-041
Status: active
Topics:
    - webgpu
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://apps/studio/src/host/capture.ts
      Note: memory rows in the journal
    - Path: repo://e2e/memory.spec.ts
      Note: ten large frames, injected OOM
    - Path: repo://packages/gpu/src/device.ts
      Note: budgetFor rule, memory events, reclaimers
    - Path: repo://packages/gpu/src/engine-gpu.ts
      Note: sourceTexture with proxies, resident(), memory(), recovery in render()
    - Path: repo://packages/gpu/src/pool.ts
      Note: one Budget across pools, peaks, makeRoom, inject, discard
    - Path: repo://packages/gpu/src/residency.ts
      Note: Residency per frame and the source sampled on a render grid
    - Path: repo://packages/gpu/test/browser/residency.spec.ts
      Note: proxies bit-exact, recovery
    - Path: repo://packages/shell/src/dom/viewport/render.ts
      Note: a failed render of another frame takes the picture down
    - Path: repo://packages/studio-kit/src/bridge/render-bridge.ts
      Note: pins the frames on screen, ident()
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T15:24:04.893655-05:00
WhatFor: ""
WhenToUse: ""
---



# Diary

## Goal

The implementation agent's record of CHB-041 (spec `design-doc/01-gpu-memory-residency-spec.md`): GPU textures kept per
frame with frames not on screen let go first, a budget sized from the adapter, a recovery after `E_GPU_OOM` that never
leaves the previous frame's picture up under the new name, and memory high-water marks in the diagnostics journal.

## Step 1: Reading the spec and the code; reproducing the owner's E_GPU_OOM and where the 512 MB went

I read the spec, the CHB-038 diary (the deferred-destroy fix `busy()/retire()`, the labels, how the journal found the
OOM), the CHB-037 P3 and P3b diaries (the budget, the pools, fields, tile plans), `docs/HANDOFF.md`, the CHB-037
working rules §1, and the code that allocates and keeps GPU memory. Then I reproduced the owner's scenario on Metal
with his two NEFs (local only; console and journal text read, nothing kept) and measured where the memory sits. The
journal's message blamed the source textures; the measurement showed a second culprit nobody had named: released
staging buffers that the texture pool could never trim.

### Prompt Context

**User prompt (verbatim):** "I get repeated webgpu errors, can we add some proper logging / debug / bug reporting to
the system, so my dad for example can give me proper debugging info (maybe even including the images, etc...) to
check."

**Assistant interpretation:** The main agent assigned me CHB-041 after the CHB-038 journal (built for that request)
found the `E_GPU_OOM` with the owner's two 24 MP NEFs: residency per frame, a budget from the adapter, recovery that
never shows the wrong picture, high-water marks in the journal; fix in the engine and the render bridge, no swallowed
errors; worktree `<scratchpad>/chb041`, branch `task/chb-041-gpu-memory`, ports 5541–5544, commits per green step, no
push or merge.

**Inferred user intent:** The photographer can open several camera files and switch between them without the
studio running out of graphics memory; when it does run out, he sees a clear message for that picture, and the owner
sees in the journal what happened.

**Commit (code):** none (reading and measuring)

### What I did
- Read `packages/gpu/src/{device,pool,limits,engine-gpu,film}.ts`, `engine/textures.ts`, `chain/run.ts` (how a tail
  reads its source: `kernels/pointwise.wgsl` `fp = outMap.xy + floor((p + 0.5) * outMap.zw)`, nearest), `tiles.ts`
  (the budget sizes tiles), `packages/studio-kit/src/bridge/render-bridge.ts`, `frames.ts`,
  `packages/shell/src/app/render/queue.ts` (slots `vp:<id>:after|before|cover`, `thumb:<key>`),
  `packages/shell/src/dom/viewport/render.ts` (the viewer's error path), `apps/studio/src/host/{engines,studio-engine,capture}.ts`,
  the presenters, `e2e/scenes.ts`, `tools/scripts/console-capture.ts`.
- `docmgr doc add --ticket CHB-041 --doc-type diary --title "Diary"` (→ `diary/01-diary.md`).
- Extended `tools/scripts/console-capture.ts --sequence`: after each open and each edit it prints how long the open
  took until idle and the GPU engine's memory (budget live, peak, limit; textures and buffers live and free, through
  `window.chromobench.engine.primary.runtime`; on the old code the peak is tracked by wrapping `budget.live`), then
  switches frames six times with the same report.
- Dev server from the worktree: `pnpm --filter @chromobench/studio exec vite --port 5545 --strictPort`.
- Owner's scenario, Metal, GPU lock (`<scratchpad>/chb041-lock.sh`: `mkdir gpu.lock` retried, owner `CHB-041`, `rm -rf`
  in a trap): `node tools/scripts/console-capture.ts 'http://127.0.0.1:5545/?layout=classic&fresh&nosw' --sequence --files …/DSC_8535.NEF …/DSC_8538.NEF`.
- Adapter limits headless on both adapters (a throwaway script, not committed): SwiftShader `maxBufferSize` 1 GiB,
  `maxTextureDimension2D` 8192, fallback; Metal (M1 Max) `maxBufferSize` 4294967292, 16384; `navigator.deviceMemory`
  32 on this Mac in both.

### Why
- The budget's number in the error (525083680 of 536870912) did not add up to two source textures (2 × 164 MB): the
  rest had to be found before deciding what to evict.

### What worked
- Before (old code, Metal, the owner's two NEFs):
  - opened file 1: 6154 ms to idle; peak 444 MB, live 444 of 512 MB (textures 164 MB live + 120 MB free, **buffers 0 + 160 MB free**)
  - opened file 2: 5167 ms; peak 512 MB, live 507 of 512 MB (textures 328 MB live + 19 MB free, buffers 0 + 160 MB free)
  - switches: 16–75 ms each (cached results or failures), live 501 MB
  - journal: `E_GPU_OOM ×9 … render failed in main: E_GPU_OOM: film.camMatrix.0: 14192640 bytes do not fit the budget
    (525083680 of 536870912 live)`, and once in finish.

### What didn't work
- N/A (measurement)

### What I learned
- Three things held the 512 MB:
  1. each open camera file's full-size source texture (4000 × 2686 rgba32float = 164 MB), kept in `srcTex` for every
     frame ever rendered, also for thumbnails (a 160-px thumbnail's region is the whole frame, so it uploaded and kept
     the full-size texture);
  2. **the f32 upload's staging storage buffers** (`source.….f32`, 128 MB for a 4000-px RGB source) released into the
     *buffer* pool's free list: `TexturePool.acquire` trimmed only the texture pool's free lists, so 160 MB of free
     buffers stayed in the shared budget forever;
  3. the film grain's textures of ones (`film.grain.ones WxH`, one per size, the newest four) made with
     `device.createTexture`, outside the budget altogether (a 4000-px one is 171 MB the budget never saw).
- `kernels/pointwise.wgsl` reads the source once, at `fp`, nearest: a render smaller than its region needs only the
  source sampled on its grid, which is what a thumbnail or a screen-size preview is.

### What was tricky to build
- N/A (reading)

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- N/A

### Code review instructions
- `tools/scripts/console-capture.ts` (`memory`, `memLine`, the switch loop).

### Technical details
- Logs (scratchpad, not kept): `chb041-before-metal.log`.

## Step 2: Budget across pools, residency per frame with proxies, the budget rule, recovery, the viewer, the journal

One budget now trims both pools' free lists (oldest release first, on a shared clock), then asks reclaimers — the
engine's residency (source textures per frame: frames not on screen first, least recently used first, textures a
render holds never) and the grain's textures of ones (now inside the budget) — before it refuses. A render smaller than
its region reads a *proxy*: the source sampled on its grid on the CPU in the shader's f32 arithmetic, uploaded at the
render's size and kept per frame, so thumbnails and screen previews never make a full-size texture resident. The
budget comes from the adapter by a stated rule. A render that still hits `E_GPU_OOM` lets go of everything not needed
and retries once; a second failure is a plain `E_GPU_OOM` that says what was tried, and the viewer takes the previous
frame's picture down instead of leaving it under the new name. Every render's high-water mark, every eviction and
every recovery reach the journal.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Spec items 1–4 in the engine, the render bridge, the viewer and the host's capture.

**Inferred user intent:** Two (or ten) camera files open and switch; an out-of-memory is rare, recovers, or is said
plainly for the right picture.

**Commit (code):** 097f378 — "CHB-041: GPU memory residency per frame, a budget from the adapter, recovery that never
shows the wrong picture"

### What I did
- `packages/gpu/src/pool.ts`: `Budget` owns `live` as an accessor with `peak`, `resetPeak()`, `watch()` (a render's
  own high-water mark), a shared release clock, `makeRoom(bytes)` (free lists of every registered pool, oldest first;
  then `onShort(need)`; then the free lists again), `inject(n)` (tests: the next n acquisitions fail); `Pool.discard(obj)`
  (out of the budget now, retired: destroyed after the work in flight), `bytesOfLive`, `freeEntries`.
- `packages/gpu/src/residency.ts` (new): `Residency` (`get/put/lease/unlease/pin/evict/forget/clear/stats`;
  `PROXIES_KEPT` = 4 per frame, and a frame's proxies never hold more than its full-size texture would);
  `gridCoords`/`sampleSource` (the source sampled at `region.xy + ⌊fround((p + ½) · fround(span / n))⌋`, f32 and 16-bit).
- `packages/gpu/src/device.ts`: `BUDGET_RULE` and `budgetFor(adapter, deviceMemory)`; `GpuCaps.budgetRule`; the device
  event carries the budget and its rule; `GpuMemoryEvent` (`render`, `evict`, `recover`); `addReclaimer` (returns its
  removal), `reclaim(need, all)`, `relieve()`; `RuntimeOptions.deviceMemory`.
- `packages/gpu/src/engine-gpu.ts`: `srcTex` replaced by a `Residency` per runtime whose reclaimer reports `evict`;
  `sourceTexture(root, grid)` (a kept full-size texture for any region; else a proxy when the render is smaller than
  its region; else the full-size texture kept, or a sub-rectangle for this call); `resident({ pinned, dropped })`,
  `memory({ reset })`, option `proxies` (default true); `render()` watches the high-water mark and emits it, and on
  `E_GPU_OOM` drops fields, `relieve()`s and retries once, emitting `recover` ok/failed; `forgetSource` forgets only
  that frame's textures; `dispose` removes the reclaimer.
- `packages/gpu/src/film.ts`: the textures of ones from the texture pool (in the budget), discarded when let go, and a
  reclaimer (oldest sizes; all in a recovery).
- `packages/gpu/src/engine/textures.ts`: `STAGING_KEPT_BYTES` (16 MiB): larger staging buffers / u16 textures are
  discarded after the upload, not released into a free list.
- `packages/studio-kit/src/bridge/render-bridge.ts`: `ResidencyHint`; the frames of `vp:*` slots and of thumbnails while
  drawn are pinned (`engine.resident`), a closed frame's textures dropped (unless a strip sibling shares the file);
  `ident(h)` = the frame. `apps/studio/src/host/studio-engine.ts` forwards `resident` to the GPU engine.
- `packages/shell`: `RenderBridge.ident?`, `Presenter.clear?`; the viewport keeps the shown picture's ident and, when a
  render of another ident fails, blanks the picture (`blank()` in paint.ts), sets `data-error`, keeps the message;
  `apps/studio/src/present/*`: `clear()` (the stage colour only).
- `apps/studio/src/host/capture.ts`: memory rows — `GPU_MEMORY` (one row, count = renders, data = the latest render's
  peak/live/resident/limit and the page's highest), `GPU_MEMORY_HIGH` (a row each time the highest grows by 32 MB),
  `GPU_EVICT`, `GPU_OOM_RECOVERED` (warn), `GPU_OOM` (error); the budget and its rule in `GPU_DEVICE`.
  `engines.ts`/`main.ts`: `?gpuBudget=MB`. `kit/messages.ts`: E_GPU_OOM's own wording.
- Tests: `packages/gpu/test/residency.test.ts` (13: cross-pool trim, onShort, peaks, injection, discard, LRU across
  frames, pins, leases, proxy caps, f32 sampling against a Float32Array product, the budget rule);
  `packages/gpu/src/parity/residency-tests.ts` + `test/browser/residency.spec.ts` (proxies vs the full-size texture
  bit for bit on a camera file with grain and a 16-bit negative through the darkroom, at 0.04 … 0.731 and over a
  region; recovery); `e2e/memory.spec.ts` (ten 2400 × 1600 scans in a 512 MiB budget; injected OOM in the viewer).

### Why
- Evicting source textures alone would not have fixed the owner's case: the 160 MB of free staging buffers were the
  difference between fitting and not. Proxies remove the full-size texture from the common case (fit view,
  thumbnails) instead of evicting and re-uploading it.

### What worked
- `residency:proxy` on SwiftShader: 0 samples differ at every scale and region, camera and negative.
- The owner's scenario after (Metal, budget then 1024 MB, see "didn't work"): opened file 1 6143 ms, peak 199 MB;
  file 2 5063 ms, peak 215 MB (textures 47 MB live); switches 49–72 ms; journal: no warnings or errors.
- `e2e/memory.spec.ts` ten frames on SwiftShader in 512 MiB: open 2.6–3.3 s each, peak 109 MB, kept 69 MB in 10
  frames (7 MB of it the frame on screen), switches 30–395 ms, no OOM row.
- `pnpm typecheck` 0, `pnpm lint` ok (502 file checks), `pnpm gen:check` ok (26), `pnpm test` 142 files, 3425 passed,
  19 skipped; goldens 66/66 within 1e-5.

### What didn't work
- First parity run: `region@0.5` differed in 32302 of 32886 samples (max 0.64) — in the *comparison* engine: with
  `proxies: false` a region render used the kept full-size texture with origin `[rect.x, rect.y]`; a full-size texture's
  texel (0,0) is the frame's, so its origin is `[0, 0]`. Fixed; now every kept texture reads at origin 0 (a full-size
  one at the frame position, a proxy at the pixel), and a kept full-size texture serves regions too.
- The budget came out 1024 MB on Metal instead of 2048: `budgetFor` read the *device's* `maxBufferSize`, which
  `negotiate` caps at 1 GiB (WANT_LIMITS); it reads the adapter's now.
- `E_GPU_OOM` message doubled its code (`E_GPU_OOM: not enough … : E_GPU_OOM: source…`) and the test read `hint`
  from the error: a `ChromobenchError` keeps both in `diag`; the engine uses `diag.message`.
- `packages/studio-kit/test/finish/kit.test.ts:139`: `TypeError … slot.startsWith` — tests render without a slot; the
  bridge treats a missing slot as a temporary pin.
- `e2e/memory.spec.ts` recovery: `expected length 1, received 0` GPU_OOM_RECOVERED rows — `inject` failed only
  allocations that needed new memory, and the edit's render reused released textures; `inject` now fails any
  acquisition. Then the resize did not fail: 600-px scans are smaller than the viewer (the render is capped at the
  source and cached); the spec uses 2000 × 1333 scans.

### What I learned
- WGSL's f32 `*` is correctly rounded, and the product of two f32 values is exact in f64, so `Math.fround((p + 0.5) * z)`
  is the shader's product; SwiftShader agrees bit for bit (Metal: Step 3).

### What was tricky to build
- Leases vs. retire: a texture a render took may be evicted by another render's allocation between taking it and
  submitting (the same interleaving as CHB-038's grain). Normal eviction skips leased textures; the recovery evicts
  them too, which is safe because `discard` retires (destroyed after the work in flight) — the budget then counts
  them free a little early, which is the price of not failing the render.
- The bridge must not pin forever: a `vp:` slot holds its last frame; a closed frame's slots are cleared in
  `frames.onRemoved` before the engine is told to drop the frame's textures (unless a strip sibling shares the file).

### What warrants a second pair of eyes
- `Budget.live` is now an accessor (pools write `budget.live += …` as before); every write walks the open render
  windows (one per render in flight).
- The recovery retries any `E_GPU_OOM` once, including the planner's — a render that cannot fit fails twice as slowly.
- The viewer blanks only when the failed render's ident differs from the shown picture's; a failed edit of the same
  frame keeps that frame's last picture with the message (deliberate: it is still that picture).

### What should be done in the future
- N/A (Step 3 runs the GPU checks)

### Code review instructions
- Start at `packages/gpu/src/pool.ts` (`Budget`), `residency.ts`, `engine-gpu.ts` (`residencyOn`, `sourceTexture`,
  `render`), `device.ts` (`budgetFor`, reclaimers); then `render-bridge.ts` (residency section), `viewport/render.ts`
  (`shownIdent`, onError), `capture.ts` (`memoryRow`).
- `npx vitest run packages/gpu/test/residency.test.ts`; `STUDIO_PORT=5541 STUDIO_KIT_PORT=5542 SHELL_DEMO_PORT=5543
  GPU_PARITY_PORT=5544 CI=1 npx playwright test --project=gpu-parity residency.spec.ts`; `… --project=chromium-webgpu
  e2e/memory.spec.ts`.

### Technical details
- The budget rule: `min(deviceMemory GiB × 1/8, adapter maxBufferSize)` within `[512 MiB, 2 GiB]` (a software
  adapter: `[512 MiB, 1 GiB]`); deviceMemory not reported → 4 GiB assumed (→ 512 MiB). This Mac: Metal 2048 MiB,
  SwiftShader 1024 MiB.
- Logs (scratchpad, not kept): `chb041-after1-metal.log`.

## Step 3: How this relates to Editor lab's budgets, residency and eviction; half floats measured

The main agent passed on the owner's question how Editor lab's "WebGPU / caching guide" handles memory budgets, and
asked me to read its book (chapters 6, 8 and 9; third-party text, read as data) and chromobench's analysis of it
(CHB-035 design 02 §7, P1, P3 and its checkpoint eviction decision), then say what CHB-041 adopts and defers, consider
cost-aware eviction, consider rgba16float storage for full-size intermediates (measured against the parity
tolerances), and record a CPU tier as future work unless cheap. I measured the half floats and kept f32; the rest is
recorded below as decisions.

### Prompt Context

**User prompt (verbatim):** (see Step 1); relayed by the main agent: "please read, as background for CHB-041 …
Editor lab's book … 06.md (§6.3 the cache and its budget …), 08.md (residency …) and 09.md (memory as a measured
per-device requirement …), and chromobench's own analysis of it … Then, within CHB-041: (a) say in your diary how your
residency/budget/eviction design relates to these (what you adopt, what you defer, why); (b) consider cost-aware
eviction (GreedyDual-Size by measured compute cost) instead of plain LRU for cached intermediates if it fits; (c)
consider 16-bit storage (rgba16float) for full-size intermediates that do not need f32 … — only where parity with the
reference engine stays within its tolerances, measured; (d) record a CPU tier for evicted textures as future work
unless cheap. Report what you chose."

**Assistant interpretation:** Relate CHB-041 to the book and CHB-035's proposals; decide (b) and (c) with evidence;
record (d).

**Inferred user intent:** The owner wants to know that chromobench's memory handling stands on the same ground as the
engines the book surveys, and where it deliberately differs.

**Commit (code):** a34b761 — "CHB-041: measure half-float storage of a camera file's first full-size texture against
the parity tolerances (residency:f16)"

### What I did
- Read Editor lab `src/book/06.md` §6.3–6.5, 6.9; `08.md` §8.8–8.9 (formats table, residency, readback); `09.md` §9.7,
  §9.11; CHB-035 `design/02-editor-lab-performance-architecture.md` §7, P1, P2, P3 and "Decision: eviction policy for
  checkpoints".
- `packages/gpu/src/parity/residency-tests.ts` `residency:f16` + a measurement test in `residency.spec.ts`: a camera
  file's source rounded to half floats (the input of `film.camMatrix`, the texture in the owner's error), the scene cut
  and the display compared with the f32 render at preview and export.

### Why
- (c) had to be measured, not argued: the camera path is nonlinear (film develop, the print) and the parity specs hold
  the GPU to 3e-5 on the scene cut and 2e-4 on the display against the reference engine.

### What worked
- SwiftShader, `residency:f16`: source relative error 4.8e-4 (half float's 2⁻¹¹); scene cut max |Δ| 1.6e-4 (mean
  3.2e-5) at preview and export; display max |Δ| 0.0134 (3.4 8-bit levels; mean 1.5e-4). Tolerances: 3e-5 and 2e-4.

### What didn't work
- The first full SwiftShader run of the browser suite (`CI=1 pnpm test:browser`, ports 5541–5544, 9.3 min) had 7
  failures, all `Execution context was destroyed, most likely because of a navigation` or a page without its hook
  (`TypeError: Cannot read properties of undefined (reading 'idle')`): I edited files the suite's Vite servers serve
  (a viewport change I then reverted, the new parity test) while it ran, and HMR reloaded the pages. The 7 specs again,
  untouched tree: 38 passed (5.7 min) — walkthrough, chain, law, spatial, residency. Lesson: no edits under a running
  suite.

### What I learned
- How CHB-041 relates to the book and CHB-035 (decision record):
  - **Budget from the machine (06 §6.3, 09 §9.11) — adopted, the browser's way.** GEGL sizes from total/available
    memory with a 512 MB floor; a tab only has `navigator.deviceMemory` (rounded; absent in some browsers), and the
    book says to set a budget and measure against it. `budgetFor` takes an eighth of the reported device memory, at
    most the adapter's maxBufferSize, within 512 MiB (GEGL's floor, and SwiftShader's proven budget) and 2 GiB (1 GiB
    for a software adapter); unknown memory assumes 4 GiB. The rule is in the journal, `?gpuBudget` overrides it.
  - **Residency (08 §8.9; CHB-035 P1) — adopted for sources, not for presentation.** Sources upload once per frame and
    stay on the GPU between renders; what goes is decided by the budget. P1's other half (present from GPU textures,
    one device for engine and presenter, no readback) is out of CHB-041's scope and stays proposed.
  - **Levels (09 §9.11; CHB-035 P2) — a cousin adopted.** The book renders at the zoom's level; P2 proposes an
    area-averaged pyramid. A proxy is the nearest-sampled level a render already reads, kept at the render's size: it
    gives P2's memory win (a screen-size texture instead of the full frame) without P2's change of pixels, so parity
    stays bit-exact. P2 (area-averaged levels in both engines) remains proposed; when it lands, the proxy becomes the
    pyramid level.
  - **Eviction policy (06 §6.4; CHB-035 P3's decision) — LRU across frames, cost-aware deferred (b).** GreedyDual-Size
    pays where entries differ in cost per byte: the book's Sharpen tiles, CHB-035's checkpoints. What CHB-041 keeps
    are sources and proxies whose cost to remake is an upload (and a CPU gather) roughly proportional to their bytes,
    so H = clock + cost/size is clock + a constant — GreedyDual-Size degenerates to LRU. The engine caches no GPU
    intermediates yet (results are CPU read-backs; P3 checkpoints are not built), so there is nothing for a cost-aware
    policy to protect. When P3 lands, its checkpoints should go into `Residency` with a measured cost and a
    GreedyDual-Size order (CHB-035's decision); `evict()`'s ordering is the one place to change.
  - **Checkpoints (06 §6.5) — deferred** with P3.
  - **Half floats (06 §6.9, 08's formats table) — measured, rejected for engine intermediates (c).** The book's
    argument holds for intermediates shown in 8 bits; chromobench's camera path amplifies a half float's rounding to
    3.4 8-bit levels on the display, and the scene cut misses its parity tolerance 5×. Full-size intermediates stay
    rgba32float. Where 16 bits do fit: the presenter already draws from rgba16float (display values), and P1's
    presentation path would keep that.
  - **Tiers (06 §6.9, 09 §9.7) — the CPU tier exists for sources, recorded as future work for intermediates (d).** An
    evicted source or proxy is rebuilt from the decoded pixels the engine keeps on the CPU (`sources`), which is the
    book's CPU tier for the only GPU data CHB-041 evicts. A CPU tier for evicted *intermediates* (read back on
    eviction, uploaded on return) only makes sense with P3's checkpoints, and the readback costs the book measures
    (and CHB-035 §12's 26 ms at 3000 × 2000) say to measure it against recomputation first. A disk tier (OPFS) is not
    considered.
- A measured requirement per device (09) is what the journal now records: every render's high-water mark against the
  budget, so a report from the photographer's machine says how close it ran.

### What was tricky to build
- Rounding to half floats in JavaScript: `Math.f16round` where the browser has it, else round-to-nearest-even by hand
  (subnormals below 2⁻¹⁴ included).

### What warrants a second pair of eyes
- The f16 measurement rounds the *source*, a stand-in for storing `film.camMatrix`'s output in 16 bits (a 3 × 3 matrix
  of the same values); the kernels were not changed to write rgba16float.

### What should be done in the future
- With CHB-035 P3 (checkpoints): checkpoints into `Residency` with measured costs and GreedyDual-Size eviction; a CPU
  tier for evicted checkpoints if a measurement shows readback beats recomputation.
- CHB-035 P1 and P2 as proposed; a proxy then becomes the pyramid level.

### Code review instructions
- `packages/gpu/src/parity/residency-tests.ts` (`residency:f16`); `npx playwright test --project=gpu-parity
  residency.spec.ts -g half-float` (ports as above).

### Technical details
- `residency:f16` (SwiftShader): `{"sourceRelError":4.84e-4,"scene.preview":{"maxAbs":1.60e-4,"mean":3.19e-5},
  "scene.export":{"maxAbs":1.60e-4,"mean":3.19e-5},"display.preview":{"maxAbs":0.01343,"mean":1.47e-4},
  "display.export":{"maxAbs":0.01340,"mean":1.47e-4}}`.

## Step 4: The checks — SwiftShader suite, gpu-parity on Metal, the owner's scenario before and after

Everything green on the branch: the full browser suite on SwiftShader (after the HMR-induced failures of Step 3, the
affected specs again on an untouched tree), gpu-parity on Metal under the GPU lock — the proxies are bit-exact there
too — and the owner's two NEFs on Metal without E_GPU_OOM, both at the adapter's budget and at the old 512 MB.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The acceptance list of the assignment.

**Inferred user intent:** The fix holds on the photographer's kind of machine and on the CI's software adapter.

**Commit (code):** a34b761 (last code commit); this step's docs commit follows.

### What I did
- `node tools/goldens/render.ts --check`: 66/66 within max |Δ| ≤ 1e-5.
- `STUDIO_PORT=5541 STUDIO_KIT_PORT=5542 SHELL_DEMO_PORT=5543 GPU_PARITY_PORT=5544 CI=1 pnpm test:browser` (SwiftShader):
  150 passed, 2 skipped, 7 failed (9.3 min) — the 7 were pages reloaded under the run by my edits (Step 3); those spec
  files again (`e2e/walkthrough.spec.ts`, `chain`, `law`, `spatial`, `residency` specs): 38 passed (5.7 min). The tree:
  158 runnable passed (with the new half-float measurement), 2 skipped.
- `REAL_GPU=1 … CI=1 npx playwright test --project=gpu-parity` under the GPU lock (removed afterwards): 57 passed,
  2 skipped (29.5 s). `residency:proxy` on Metal: 0 samples differ at every scale and region (camera, negative);
  `residency:recover` budget line "2048 MiB"; `residency:f16` display max |Δ| 0.0116 (Metal).
- The owner's scenario on Metal (GPU lock; local files; console and journal text only):
  `node tools/scripts/console-capture.ts 'http://127.0.0.1:5545/?layout=classic&fresh&nosw' --sequence --files …/DSC_8535.NEF …/DSC_8538.NEF`,
  and once more with `&gpuBudget=512`.

### Why
- The 512 MB run shows the fix is the residency and the cross-pool trim, not the larger budget.

### What worked
- Before → after (Metal, the owner's two NEFs, 1600 × 1000 page, dpr 1):

  | | before (512 MB) | after (2048 MB, adapter rule) | after (?gpuBudget=512) |
  |---|---|---|---|
  | open file 1 → idle | 6154 ms, peak 444 MB | 6301 ms, peak 199 MB | 6183 ms, peak 199 MB |
  | open file 2 → idle | 5167 ms, peak 512 MB | 5260 ms, peak 215 MB | 5152 ms, peak 215 MB |
  | textures live after file 2 | 328 MB (two full-size sources) | 47 MB | 47 MB |
  | free buffers held | 160 MB | 48 MB | 48 MB |
  | frame switches → idle | 16–75 ms (renders failing) | 52–77 ms | 49–68 ms |
  | journal warnings/errors | E_GPU_OOM ×9 in main, ×1 in finish | none | none |

- Ten 2400 × 1600 frames in 512 MiB on SwiftShader (`e2e/memory.spec.ts`): peak 109 MB, 69 MB kept over 10 frames.

### What didn't work
- N/A (Step 3 has the reloaded pages)

### What I learned
- Open times are decode-bound (LibRaw, ~5–6 s per 24 MP NEF) and did not change; the proxy gather costs less than the
  full-size upload it replaces.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- On a 2× display the viewer renders at about 0.9 of the frame, so its proxy is ~140 MB per frame on screen; still far
  inside 2 GiB, and frames not on screen give theirs back first.
- A `vp:` slot of a viewport that is no longer shown keeps its last frame pinned until it renders again (a few MB of
  proxies; the recovery evicts pinned frames too).

### What should be done in the future
- See Step 3 (checkpoints with GreedyDual-Size, a CPU tier for checkpoints, P1, P2). The CHB-037 task P9-11 can be
  closed by the main agent when this branch merges.

### Code review instructions
- `git diff f96c135..HEAD --stat`; the commands above.

### Technical details
- Logs (scratchpad, not kept): `chb041-browser-sw.log`, `chb041-rerun-sw.log`, `chb041-parity-metal.log`,
  `chb041-after-metal.log`, `chb041-after-metal-512.log`, `chb041-goldens.log`.
