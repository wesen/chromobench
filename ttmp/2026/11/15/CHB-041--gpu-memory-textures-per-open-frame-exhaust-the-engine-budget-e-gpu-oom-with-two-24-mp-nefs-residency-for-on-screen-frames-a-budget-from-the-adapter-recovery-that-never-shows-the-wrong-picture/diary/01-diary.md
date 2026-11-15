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
