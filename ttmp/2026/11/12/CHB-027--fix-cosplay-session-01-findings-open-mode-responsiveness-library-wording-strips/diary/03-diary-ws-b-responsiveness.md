---
Title: Diary WS-B responsiveness
Ticket: CHB-027
Status: active
Topics:
    - ui
    - product
    - ingest
    - performance
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /home/manuel/code/wesen/chromobench/apps/studio/src/host/engine-serve.ts
      Note: The engine worker's job loop (decode, conditioning, RefEngine; cancel between stages)
    - Path: /home/manuel/code/wesen/chromobench/apps/studio/src/host/worker-engine.ts
      Note: WorkerClient and WorkerEngine, the main-thread proxy implementing the contract's Engine
    - Path: /home/manuel/code/wesen/chromobench/packages/core/src/engine-ref.ts
      Note: Sampled previews (GRID_OPS), staged evaluation with yield and abort, byte-bounded LRU
    - Path: /home/manuel/code/wesen/chromobench/ttmp/2026/11/12/CHB-027--fix-cosplay-session-01-findings-open-mode-responsiveness-library-wording-strips/scripts/01-measure-responsiveness.mjs
      Note: Headless before/after measurement on the real files (skips when absent)
ExternalSources: []
Summary: "WS-B (F4, F10): measure, move decode and the reference engine into a worker, sampled drafts, measure again."
LastUpdated: 2026-11-12T14:45:00-05:00
WhatFor: "How the studio stopped freezing during drags and opens, with the numbers."
WhenToUse: "Reviewing or merging task/chb-027-responsive; performance work on the studio host."
---

# Diary: WS-B responsiveness

## Step 1: The assignment and orientation

I was launched as the WS-B agent of CHB-027 in my own worktree, created `task/chb-027-responsive`, installed
dependencies offline and read the plan's WS-B section, findings F4 and F10 of CHB-026, the CHB-026 probes, and the
code on the render path: `apps/studio/src/host/engines.ts`, `studio-engine.ts`, `packages/core/src/engine-ref.ts`,
`packages/shell/src/app/render/queue.ts` and `packages/studio-kit/src/bridge/render-bridge.ts`.

The key reading result: `RefEngine.evaluate` always computed every stage at full working resolution and only then
sampled the result, so a draft (a smaller `scale`) cost exactly as much as a screen render; and the whole reference
engine, the DNG decode and conditioning ran on the main thread (`engines.ts`), which is why the window froze.

### Prompt Context
**User prompt (verbatim):** "You are implementing CHB-027 workstream **WS-B: responsiveness** (findings F4, F10).

First read the common brief: /tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/chb027-brief-common.md — it has the rules, checks, diary and final-reply format. Then the plan's \"WS-B\" section (path in the brief), and finding F4/F10 in the CHB-026 findings (measured: ~2 s main-thread stall per preview on the CPU reference engine; a 40 px slider drag took 12 s; opening the negative DNG froze the window 6.7 s).

Your specifics:
- Branch: `task/chb-027-responsive` (create it in your worktree first; run `pnpm install --offline` if node_modules is missing).
- Diary file: `ttmp/2026/11/12/CHB-027--fix-cosplay-session-01-findings-open-mode-responsiveness-library-wording-strips/diary/03-diary-ws-b-responsiveness.md`
- Screenshots/measurements folder: `…/CHB-027--…/various/ws-b/` (commit your measurement script(s) there too, or under the ticket's `scripts/`).
- Ports: preview 4811; browser tests STUDIO_PORT=4821 STUDIO_KIT_PORT=4822 SHELL_DEMO_PORT=4823 GPU_PARITY_PORT=4824.
- Plan task id: 6p1c.

Order of work: (1) a reproducible headless measurement script (Node + Playwright, real files from ~/Downloads, skipping when absent) that reports open time, main-thread stalls (rAF gaps > 100 ms; see CHB-026's `scripts/01-install-probe.js`), drag time-to-result and stalls (real mouse moves on the Time slider: `input[aria-label=\"Time\"]`), on BOTH the reference engine (`?engine=reference`) and the GPU engine (`?engine=gpu`; find the Chromium flags the repo's browser tests use for headless WebGPU, e.g. in the playwright config) — record the BEFORE numbers in your diary; (2) move decode + linearise + resample + scan conditioning, and the reference RefEngine, into a module worker with a main-thread `WorkerEngine` proxy implementing the contract's `Engine` (pixels as transferables; latest-wins and AbortSignal honoured between stages); (3) drafts during drags actually computing fewer pixels; raise the reference working image size if drafts keep drags fluid (F10); (4) check whether print-only changes recompute the negative stages and cache if so; (5) AFTER numbers on both engines in the diary.

Note the shared files: WS-A is changing `HostServices.decode` to take an explicit mode argument (photo vs scan) instead of reading `settings.photo`, and adding a photo/negative classifier in ingest. Design your worker protocol so `decode(bytes, sha, name, mode)` with an explicit mode is natural (accept a mode parameter now; the orchestrator will reconcile at merge). Keep `engines.ts` the only host file importing core/gpu/ingest except your worker entry, which you add to the exceptions in `tools/scripts/check-boundaries.ts`. Don't move GpuEngine off the main thread; measure and report it."

**Assistant interpretation:** Measure first on both engines, then take decode and the CPU engine off the main
thread behind an `Engine` proxy, make drafts cheap, check stage caching, and measure again.
**Inferred user intent:** The photographer must never see a frozen window while dragging a slider or opening a file.

### What I did
- `git checkout -b task/chb-027-responsive`; `pnpm install --offline` (node_modules was missing).
- Read the brief, plan, F4/F10, `scripts/01-install-probe.js` and `02-read-probe.js`, and the files above.
- Found the headless WebGPU flags in `playwright.config.ts`: channel `chromium`,
  `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --enable-features=Vulkan`.

### Why
- The render path decides what a "draft" costs; reading it first showed the draft pass had no effect on the CPU engine.

### What worked
- Orientation; nothing run yet.

### What didn't work
- My first command chained `cd … && git checkout -b … && ls …`; the worktree guard refused it ("names git in a form
  too complex to verify"). Running `git checkout -b task/chb-027-responsive` alone worked. Later a shell command
  containing the word "digital" was refused the same way; I split such commands.

### What I learned
- `chooseTarget` asks for ≈0.5 MP drafts; with a 512 px working image (512×342 = 0.175 MP) a draft is the whole
  image anyway, so on the reference engine drafts never saved anything.

### What was tricky to build
- N/A (reading only).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- N/A.

### Technical details
- Render path: viewport `chooseTarget` → `RenderQueue.request` (latest wins, aborts superseded in-flight work) →
  `FrameRenderBridge.render` (scale = maxSide / side) → `StudioEngine.evaluate` → `RefEngine.evaluate`.

## Step 2: The measurement script and the BEFORE numbers

I wrote `scripts/01-measure-responsiveness.mjs`: headless Chromium with the repository's WebGPU flags, one fresh
page per engine (`?nosw&fresh&canvas2d&engine=<e>`), a probe installed with `addInitScript` (rAF gaps > 100 ms as
stalls, every `rendered` event of the runtime, pointer and key times, all on the page clock), then the session-01
steps with the real files read in place: open DSC_8559.NEF as a photo, drag the Time slider 40 px (20 real mouse
moves 30 ms apart, from the thumb's position), type `15` + Enter in "Time value", open raw010.dng as a negative,
drag and type again. It exits 0 with "skipped" when the files are absent, races every step against a timeout and
writes JSON. `?canvas2d` because the WebGPU presenter's device is lost in headless SwiftShader after the first
open ("WebGPU device lost (A valid external Instance reference no longer exists.); presenting with Canvas2D") and
the status never said "rendered" — an environment artefact, not the studio's.

The reference engine reproduces F4 almost exactly. The GPU engine on SwiftShader (the only WebGPU there is headless)
opened the NEF but never finished a drag, at any working size I tried; the numbers are a software adapter's and
say little about Manfred's Chrome.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Step (1) of the order of work: a reproducible measurement, before any change.
**Inferred user intent:** Decisions on evidence, and a before/after table for the ticket.
**Commit (code):** 04993aa — "CHB-027 WS-B: engine worker (decode, conditioning, RefEngine off the main thread), sampled staged previews, adaptive drafts" (the script and the BEFORE JSON are in it)

### What I did
- `pnpm --filter @chromobench/studio build && pnpm --filter @chromobench/studio preview --port 4811 --strictPort` (background), on the unchanged branch.
- `node ttmp/2026/11/12/CHB-027--…/scripts/01-measure-responsiveness.mjs --engines reference --out …/various/ws-b/before-reference.json`
- `… --engines gpu --out …/various/ws-b/before-gpu.json` (default 4000 px working image): still in the first drag after
  20 minutes with the renderer at 100 % CPU; I stopped it (the JSON only has the error).
- Added per-step timeouts, then `… --engines gpu --query long=1024 --step-timeout 240000 --out …/before-gpu-long1024.json`
  and `… --query long=512 --step-timeout 300000 --out …/before-gpu-long512.json`.

### Why
- The plan asks for the numbers on both engines before the design; the GPU runs at a smaller `?long` because
  SwiftShader at 4000 px does not finish.

### What worked
BEFORE, reference engine (`reference · CPU f64 · 512 px`, main thread), times on the page clock:

| step | time to result | worst stall | stalls (total) | drag wall time | renders (drafts) |
|---|---|---|---|---|---|
| open NEF as photo | 9842 ms | 3533 ms | 2 (4000 ms) | – | 2 (0) |
| drag Time 40 px (photo) | 15870 ms | 3183 ms | 6 (14883 ms) | 15881 ms | 7 (6) |
| type 15 + Enter (photo) | 2432 ms | 2417 ms | 1 (2417 ms) | – | 1 (0) |
| open DNG as negative | 5108 ms | 5067 ms | 1 (5067 ms) | – | 1 (0) |
| drag Time 40 px (negative) | 11849 ms | 2200 ms | 6 (10868 ms) | 11855 ms | 7 (6) |
| type 15 + Enter (negative) | 1806 ms | 1800 ms | 1 (1800 ms) | – | 1 (0) |

The drag itself (20 mouse moves that take 0.6 s by hand) took 15.9 s of wall time: Playwright's mouse events wait
for the renderer, exactly what Manfred felt. Drafts and screen renders were both 512×342 (photo) and 232×512 (DNG).

BEFORE, GPU engine (`GPU · google swiftshader (software)`, main thread):

| working size | boot | open NEF as photo | worst stall | stalls (total) | drag |
|---|---|---|---|---|---|
| 4000 (default) | – | not recorded | – | – | > 20 min, stopped |
| 1024 (`?long=1024`) | 5599 ms | 15109 ms | 1567 ms | 4 (2917 ms) | no result in 240 s |
| 512 (`?long=512`) | 8147 ms | 34319 ms | 1933 ms | 6 (5583 ms) | no result in 300 s |

### What didn't work
- The default-size GPU run: `timeout 1200 node …01-measure-responsiveness.mjs --engines gpu` ran > 20 min in the
  drag; killed. The GPU drags at 1024 and 512 px did not finish either (step timeouts). See Step 5: a later probe
  shows the "never finishes" is at least partly a render-queue hang after the drag that also hits my worker, not
  only SwiftShader slowness.

### What I learned
- Even the open on SwiftShader stalls the main thread 1.6–1.9 s (decode and conditioning ran on the main thread for
  the GPU engine too); moving decode into the worker helps both engines.

### What was tricky to build
- Finding the thumb: the Time slider is log2-scaled (min 1, max 5.9, value 3.33 for 10 s); the script places the
  mouse at `x + 8 + (v − min)/(max − min)·(width − 16)`.
- The probe must be installed before the page script runs (`addInitScript`), and the runtime's `rendered` hook
  after `ready` (`window.__wsb.hook()`).

### What warrants a second pair of eyes
- GPU numbers on SwiftShader are not Manfred's; a run on a real GPU (headed Chrome) is still needed.

### What should be done in the future
- Re-measure the GPU engine on a machine with a GPU.

### Code review instructions
- `ttmp/…/scripts/01-measure-responsiveness.mjs`; run it against a preview server on 4811.

### Technical details
- Output JSON per engine: `steps[]` with `resultMs` (last non-draft render of the main viewer after the step
  started), `firstRenderMs`, `renders`, `drafts`, `worstStallMs`, `stallTotalMs`, `dragWallMs`, `upToResultMs`.
- Files: `various/ws-b/before-reference.json`, `before-gpu.json` (stopped run), `before-gpu-long1024.json`,
  `before-gpu-long512.json`.

## Step 3: Where a preview spends its time, and stage caching (task 4)

To decide the draft design and the working size I profiled the reference engine stage by stage in Node on a
synthetic frame (`scripts/02-profile-ref-stages.ts`), first render and then two print-only changes. Print-only
changes do **not** recompute the negative's stages: `invert.dyes` (the expensive per-pixel solve) and everything
upstream come from the cache by node id. So task 4 needed no new cache; what costs is the print side, which every
time or filtration change must recompute because its node ids are new.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Task (4): check by profiling whether print-only changes recompute the negative stages.
**Inferred user intent:** Don't pay for the negative on every slider step.

### What I did
- `node ttmp/…/scripts/02-profile-ref-stages.ts 512 negative-scan exact` and `… tabulated`.

### Why
- The per-pixel cost decides how small a draft must be and whether the working image can grow.

### What worked
`exact` mode, negative, 512×341 (Node, one core):

| stage | first render | time ×1.12 | filtration M +5 |
|---|---|---|---|
| scan.density | 34 ms | 0 | 0 |
| invert.dyes | 1075 ms | 0 | 0 |
| print.expose | 911 ms | 913 ms | 926 ms |
| print.develop | 174 ms | 154 ms | 156 ms |
| view.reflect | 397 ms | 347 ms | 368 ms |
| output.display | 1035 ms | 985 ms | 1081 ms |
| total | 3692 ms (21 µs/px) | 2451 ms (14 µs/px) | 2579 ms |

`tabulated` mode: first 1863 ms, print-only 1478 ms; `output.display` alone is 905–963 ms there.

### What didn't work
- The first runs could not resolve `@chromobench/core` from the ticket folder
  (`ERR_MODULE_NOT_FOUND: Cannot find package '@chromobench/core'`) and then failed on
  `E_NOT_IMPLEMENTED: output.frame is not implemented by the reference engine` (a StudioEngine host op); the script
  now imports `packages/*/src/index.ts` relatively and skips `output.frame`.

### What I learned
- ≈ 14 µs per pixel for a print-only change: a 0.5 MP draft (the viewport's default) would cost ≈ 7 s on the CPU,
  so drafts must be much smaller there (≈ 30–50 k px), and a 1024 px working image's screen render (≈ 0.5 MP shown)
  costs ≈ 7 s — acceptable only off the main thread, with drafts during the drag.
- `output.display` (the OkLCh knee) is ≈ 40 % of a print-only change; a candidate for later core optimisation.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Switching the studio's CPU engine to `tabulated` previews would halve the cost but changes the reference's
  physics fidelity; I did not do it.

### What should be done in the future
- Profile and speed up `output.display` and `print.expose` in core (both per pixel, both dominate).

### Code review instructions
- `node ttmp/…/scripts/02-profile-ref-stages.ts [long] [negative-scan|digital-raw] [exact|tabulated]`.

### Technical details
- The script evaluates each node of the closure at full resolution in order, so each stage's time is its own.

## Step 4: The engine worker, sampled previews, adaptive drafts

Design: (a) `RefEngine` (core) learns *sampled previews*: a preview at scale < 1 (or of a region) computes the print
stages only at the pixels the result samples. Nearest sampling commutes with pointwise ops, so the result is
bit-identical to the old path; the negative's stages still run once at full resolution and stay cached, so every
grid (draft, screen, thumbnail) samples them. Evaluation is *staged*: stage by stage, inputs first, with a `yield`
hook and an abort check between stages; caches are an LRU bounded by bytes. (b) An engine worker
(`engine-serve.ts` + `engine-worker.ts`) decodes, linearises, resamples and conditions for both engines and hosts
the RefEngine without WebGPU; `WorkerEngine` on the main thread implements `Engine` by posting jobs, pixels
transferred, an aborted signal sending `cancel` (dropped when queued, aborted at the next stage when running).
(c) Drafts sized by time: the studio-kit bridge measures pixels/ms and sizes draft passes to ≈ 150 ms (≥ 30 k px,
half-octave steps so successive drafts share a grid). (d) The shell queue gets `progressMs`: a slot that has shown
nothing for 250 ms lets its in-flight render finish instead of aborting it for every mouse move (otherwise a slow
engine would show nothing until the hand stops). The reference working image goes from 512 to 1024 px (F10).

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Tasks (2) and (3).
**Inferred user intent:** No frozen window; drafts while dragging; a sharper CPU preview.
**Commit (code):** 04993aa — "CHB-027 WS-B: engine worker (decode, conditioning, RefEngine off the main thread), sampled staged previews, adaptive drafts"

### What I did
- `packages/core/src/engine-ref.ts`: `RefEngineOptions.sampled`, `.yield`, `.cacheBytes`; `GRID_OPS`; `Lru`,
  `gridOf`, `sampleImg`, `computeAt`, `order`, `staged`; `computed` counters.
- `apps/studio/src/host/decode.ts`: `decodePhoto`, `decodeScan`, `healDust` moved out of `engines.ts` unchanged,
  plus `decodeFile(bytes, sha, name, mode, {long, dust, roll, raw})` with an explicit mode.
- `apps/studio/src/host/worker-protocol.ts` (jobs: init, decode with `mode` and `keep: 'register'|'return'`,
  evaluate, measure, prepare, adopt, cancel, dispose), `engine-serve.ts` (`serveEngine(scope)`), `engine-worker.ts`
  (entry), `worker-engine.ts` (`WorkerClient`, `WorkerEngine`).
- `engines.ts`: starts the worker; GPU → worker decodes only (`keep: 'return'`, pixels transferred back,
  `GpuEngine.openDecoded` on the main thread); no GPU → `WorkerEngine` (`keep: 'register'`); `?worker=0` keeps the
  old main-thread path; `HostOptions.worker`, `refLong` default 1024, `REF_CACHE` 48 entries / 768 MB.
- `studio-engine.ts`: `Decoded.data` optional; `HostServices.decode(bytes, sha, name, mode?)`; `open()` registers
  only when pixels came back; `notes` keeps no pixels.
- `render-bridge.ts`: `draftTargetMs`, `draftMinPixels`, `pxPerMs`, `draftScale`, `measured`.
- `queue.ts`: `progressMs`, `now`, `Slot.shownAt`.
- `main.ts` (small): `?refLong=`, `?worker=0`; on a real engine `studio.bridge.draftTargetMs = 150` and
  `rt.renders.progressMs = 250`.
- `tools/scripts/check-boundaries.ts`: exceptions for `decode.ts` and `engine-serve.ts`.
- Tests: `packages/core/test/engine-ref-sampled.test.ts` (5), `apps/studio/test/worker-engine.test.ts` (3, the
  job loop over a Node `MessageChannel`), a queue test, an adaptive-draft test in `studio-kit/test/bridge.test.ts`.

### Why
- A worker alone would stop the freeze but keep 2–7 s per draft; sampled previews make drafts cheap and exact.
- Negative stages at full resolution: per grid they would be recomputed for every new grid (draft vs screen vs
  thumbnail), and they are the most expensive stage.

### What worked
- `npx vitest run packages/core/test/engine-ref-sampled.test.ts`: 5 passed (bit-identity on negative and photo
  chains at scale 0.37, a region at 0.5 and a region at 1; a time change recomputes only the new print nodes, at
  30×20 px; cancel after the 3rd stage rejects `E_CANCELLED` and the next call completes; `cacheBytes` evicts and
  recomputes the same pixels).
- `apps/studio/test/worker-engine.test.ts`: 3 passed. Queue and bridge tests pass. `pnpm typecheck`, `pnpm lint` green.
- `pnpm test`: 2651 passed, 1 failed: `host.test.ts › measures the base on the film edge` timed out at 60 s under
  load (other agents' test runs, my GPU measurement; load average ≈ 14). Alone it passes in 9–16 s; the same test
  with main's `engine-ref.ts` swapped in took 7.5 s vs 9.2 s with mine at load ≈ 9, i.e. noise-level.

### What didn't work
- First version of the print-only test asserted `< n1.defs.length − 3` stages (`expected 7 to be less than 7`); I
  replaced it by the exact set of new node ids.
- Tests first evaluated the top of `compile()`, which is `output.frame` (a host op): `E_NOT_IMPLEMENTED`.
- In the worker test I measured a node I had not adopted: `E_NO_NODE: unknown node 9984b3813988…`.
- `python3 - <<'EOF'` heredoc edits were refused by the worktree guard; I used the Edit tool instead.

### What I learned
- `Graph.closure` returns defs without ids; the staged walk does its own post-order DFS over node inputs.

### What was tricky to build
- Starvation: the queue aborts the in-flight render on every newer request; with the abort now effective (between
  stages in the worker) a 0.5 s draft would be aborted by the next mouse move 30 ms later, forever. `progressMs`
  keeps an in-flight render once the slot has shown nothing for 250 ms (measured from the last present, not from
  the start of the in-flight job, else it never qualifies).
- Grid stability: adaptive drafts change the scale every render; snapping to half-octaves keeps one grid per drag.

### What warrants a second pair of eyes
- `GRID_OPS` must contain only ops whose pixel depends on the same pixel of their inputs (print.combine reads its
  masks and exposures at the same index on the same grid; coordinate masks are not in the set and are sampled).
- `WorkerEngine.read()` hands the transferred array to the first reader and copies after.

### What should be done in the future
- A lane/priority for worker jobs (thumbnails queue behind nothing, but a running thumbnail job delays a draft).

### Code review instructions
- Start at `RefEngine.evaluate` / `staged` / `computeAt`, then `engine-serve.ts`, `worker-engine.ts`, `engines.ts`.
- `npx vitest run packages/core/test/engine-ref-sampled.test.ts apps/studio/test/worker-engine.test.ts packages/shell/test/app/render-queue.test.ts packages/studio-kit/test/bridge.test.ts`

### Technical details
- Grid key `${W}x${H}|region|${width}x${height}`; cache keys `F:<id>` (full) and `S:<id>@<grid>`.
- The worker yields with a `MessageChannel` macrotask (no 4 ms timer clamp) so `cancel` and `adopt` land between stages.

## Step 5: Merge of main (WS-C), first AFTER run, and a hang after the drag

The orchestrator merged WS-C into main; `git merge main` was clean (580f766). WS-C's `status-text.ts` reads the
engine label with `/^reference/` and `/no WebGPU/`; my label `reference · CPU f64 (worker) …` still matches, and
the decode note strings are unchanged. `pnpm typecheck` and `pnpm lint` are green after the merge.

The first AFTER run on the reference engine opened the NEF with one 450 ms stall instead of 3.5 s, but the photo
drag never reached a result (step timeout 180 s) — the same symptom as the GPU engine before. Probing the page
after the drag shows the page is responsive (evaluate answers in 1–15 ms) but the main viewer's slot is stuck:
an in-flight draft whose worker job finished and replied, and a waiting screen render that never starts. I am
investigating this now (worker and client logs with wall-clock times).

### Prompt Context
**User prompt (verbatim):** see Step 1 (and the orchestrator's message: merge main before the final commit; keep
status-text.ts working)
**Assistant interpretation:** Merge WS-C and keep its parsing intact; measure after.
**Inferred user intent:** A mergeable branch with honest after-numbers.

### What I did
- `git merge main --no-edit` → 580f766; `npx tsc -p tsconfig.json --noEmit`; `pnpm lint`.
- Rebuilt, `node …/01-measure-responsiveness.mjs --engines reference` → open NEF 20647 ms to result (1024 px
  working image, screen render 896×599), worst stall 450 ms, 1 stall; drag: no result in 180000 ms.
- `scripts/debug-tmp.mjs` (temporary): drag on raw010.dng without waiting for idle first: drafts at +801 ms and
  +1223 ms (116 px wide), screen at +3113 ms, queue idle after. Same on the NEF without the idle: draft at +5370 ms,
  screen 896 px at +12951 ms, queue idle at ≈ 22 s.
- With an idle wait between open and drag, the NEF drag hangs: queue stats frozen at renders 7, presented 5; slot
  `vp:main:after` in flight with a `draft|865` key, waiting `screen|896`. Worker log: job 9 (draft at scale
  0.1768) done in 4.3–6.2 s and "replied"; the main-thread client never logs a reply for 9.

### Why
- The drag result is the number that matters for F4; a hang must be explained, not timed out around.

### What worked
- Open: 1 stall of 450 ms (before: 3533 + 467 ms) — decode and conditioning are off the main thread.

### What didn't work
- See above: the post-drag hang (under investigation).

### What I learned
- The GPU engine's "no result" BEFORE has the same shape, so the cause is likely in the queue/viewport/bridge path
  with an asynchronous engine, or in my worker client, not in SwiftShader alone.

### What was tricky to build
- Worker console messages reach Playwright late; I log `Date.now()` on both sides to order events.

### What warrants a second pair of eyes
- Pending.

### What should be done in the future
- Pending the diagnosis.

### Code review instructions
- N/A yet.

### Technical details
- Debug probe: `[...rt.renders.slots.values()].filter(s => s.inflight || s.waiting)` → id, lane, keys, gen, shownGen.

## Step 6: The hang after the drag was settle() looping forever in idle tasks

Wall-clock logs on both sides of the worker settled it: the worker computed draft job 9 in 4.3–6.3 s, logged
`DBG post 9 true 1 1803933` and `DBG replied 9`, but the main thread never logged the reply, and no `messageerror`
fired. The page had answered 14 quick probes (all within 31 ms, before the reply), then the next `page.evaluate`
(the hook's `idle()`) never returned: the main thread was stuck in a synchronous loop, so the worker's reply could
not be delivered. The loop is in the shell: `rt.settle()` calls `scheduler.runIdle({ timeRemaining: () => 50,
didTimeout: true })`, and `runIdle` runs `while (idleQ.length && (… || deadline.didTimeout))`. A background
thumbnail render that waits for live work re-queues itself (`RenderQueue.pump`: bg lane and `liveBusy()` →
`opts.idle(() => this.pump(s))`), so with live work in flight on an asynchronous engine the queue never empties and
the loop never ends. That is also why the GPU engine's drag "never finished" in the BEFORE runs: the measurement's
`idle()` hung, not SwiftShader.

The fix (`packages/shell/src/core/cells.ts`): `runIdle` runs only the tasks queued before it started; a task that
queues itself again runs in the next idle period. Real browsers give `runIdle` a real deadline (12 ms cap without
`didTimeout`), so users did not hit the endless loop, but the hook (`window.chromobench.idle()`, used by e2e tests)
did as soon as the engine became asynchronous.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Explain the post-drag hang before measuring further.
**Inferred user intent:** Honest numbers and no hidden hang.
**Commit (code):** 430bfa1 — "CHB-027 WS-B: idle tasks that requeue themselves run once per idle run (settle() looped forever with an async engine); measurement waits for the change's render"

### What I did
- Temporary `DBG` logs in `engine-serve.ts` (job start/done/post/replied, a 3 s heartbeat) and `worker-engine.ts`
  (reply received, `messageerror`), all with `Date.now() % 1e6`; a temporary `scripts/debug-tmp.mjs` driving open →
  idle → drag → probes. Removed both afterwards (`git checkout 04993aa -- apps/studio/src/host/engine-serve.ts`;
  `sed -i '/DBG/d' …/worker-engine.ts`; `rm …/debug-tmp.mjs`).
- `cells.ts`: `let n = this.idleQ.length; while (n-- > 0 && …)`; test in `packages/shell/test/core/core.test.ts`
  ("a task that queues itself again runs once per idle run, even with a timed-out deadline").
- Measurement script: `idle()` now first waits until `rt.renders.busy()` is false; drag and typed steps wait for a
  non-draft render of the main viewer after the action (`settled`); opening waits until the new file is the
  selected frame and no "opening" status, then for a main-viewer render.

### Why
- With the fix, `settle()` returns after its 50 rounds even when a render is still running in the worker, so the
  script must wait for the change's own render instead of trusting `idle()`.

### What worked
- `npx vitest run packages/shell/test`: 104 passed.
- The next AFTER run finished every step (Step 8).

### What didn't work
- Run 2 of the AFTER measurement (before the script fix) reported 0 renders for "type 15 + Enter" and a 37 s
  negative drag: the open step's `waitForFunction` matched the previous step's "rendered 3 · screen" status (with an
  asynchronous engine the page is no longer blocked when Playwright polls), so the next steps raced the DNG's open;
  the drag even started on the NEF's slider ("Time 15.0 seconds → Time 2.23 seconds").
- An attempt to strip the DBG lines with `sed '/const t0 = …$/{N;}'` mangled `engine-serve.ts`; restored from 04993aa.

### What I learned
- Any `didTimeout` deadline loop must not run tasks that the loop itself re-queues.
- Worker console messages reach Playwright late; wall-clock stamps are needed to order events.

### What was tricky to build
- The symptom (a reply that never arrives) pointed at the worker protocol; the cause was a blocked receiver.

### What warrants a second pair of eyes
- `cells.ts` is the shell's scheduler core (no workstream owns it); the change only bounds one idle run.

### What should be done in the future
- Background renders poll by re-queuing an idle task while live work runs; a wake-up when live work finishes
  (`RenderQueue.after` already pumps bg slots) would make the idle task unnecessary.

### Code review instructions
- `packages/shell/src/core/cells.ts` `runIdle`; `packages/shell/src/app/runtime.ts:585` `settle`;
  `packages/shell/src/app/render/queue.ts` `pump`.

### Technical details
- Stuck state: `vp:main:after` in flight with key `…|draft|865|`, waiting `…|screen|896|`; bg thumbnail slots
  waiting; `renders 7, presented 5` frozen.

## Step 7: Sampled stages got their own cache

The first complete AFTER run (Step 8, run 3) showed the photo drag's first draft only after 8.4 s although a
draft is ≈ 22 k pixels. The cause: sampled ('S:') and full-resolution ('F:') images shared one LRU of 48 entries;
every evaluation adds ≈ 7 sampled entries, and a sampled hit returns without touching the full image, so the
film stages of the photo (couple, halation, grain at full resolution, seconds each) aged out and were recomputed
on the next new grid. Sampled stages now live in their own LRU (8× the entries, a quarter of the bytes).

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Make drafts as cheap as designed.
**Inferred user intent:** Fluid drags.
**Commit (code):** c94a3d4 — "CHB-027 WS-B: sampled stages in their own LRU, so draft and screen grids never evict the full-resolution negative and film stages"

### What I did
- `RefEngine`: `full` (F:) and `grid` (S:) LRUs; test "previews on many grids never push the full-resolution
  stages out of the cache" (`cacheLimit: 8`, ten grids, `computed.full` unchanged).

### Why
- With one shared LRU the test fails (full stages recomputed); with two it passes.

### What worked
- `npx vitest run packages/core/test/engine-ref-sampled.test.ts packages/core/test/engine-ref.test.ts apps/studio/test/worker-engine.test.ts`: 369 passed (incl. conformance).

### What didn't work
- N/A.

### What I learned
- A cache hit at one level must keep the level below it alive, or the levels need separate budgets.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Budgets: full 48 entries / 768 MB, grid 384 entries / 192 MB, results 48 / 192 MB (`REF_CACHE` in engines.ts).

### What should be done in the future
- N/A.

### Code review instructions
- `packages/core/src/engine-ref.ts` constructor, `computeAt`, `staged`, `warningsOf`.

### Technical details
- N/A.

## Step 8: Final-render times — where the extra time went, and what I changed

The orchestrator pointed out that the AFTER run of Step 7 (`after-reference.json`, 1024 px working image) was free
of stalls but slower to the *final* render than before: open NEF 15.4 → 24.7 s, typed 15 + Enter 2.0 → 7.9 s
(photo) and 2.1 → 3.2 s (negative), open DNG 5.7 → 10.6 s; target ≤ ≈ 1.2× before with stalls < 100 ms. I
separated the causes by measurement, then fixed them.

1. **The working image (≈ 3× of the slowdown).** At 1024 px the screen render shows 896×599 = 537 k pixels instead
   of 512×342 = 175 k, and the photo's spatial film stages (couple, halation, grain) run at 4× the pixels on open.
   At ≈ 14 µs per pixel for a print-only change (Step 3) that is 7–8 s per final render. A run with the worker and
   `?refLong=512` (`after-reference-ref512.json`) was back near the old times (typed photo 4.2 s, negative 2.8 s,
   opens 10.0 and 5.4 s). **Decision: the reference engine's default working image is 512 px again;**
   `?refLong=1024` remains for a sharper CPU preview (F10 on the CPU engine stays open: sharpness costs 3× time
   there; on the GPU engine F10 does not apply, its working image is 4000 px).
2. **Thumbnails ahead of the main viewer (≈ 1–1.5 s per change on the photo).** A probe of three typed commits
   showed per commit: 3 requests (main viewer, navigator, filmstrip), 5 renders, 2 aborted, and the main render
   taking 3.0–4.0 s in the worker against 2.0–2.8 s for the same stages in Node. The background thumbnails were
   requested in the same frame, *before* the main viewer, started at once (the live lane was still idle), and the
   worker runs one job at a time, so the main render queued behind them. Fixes in the shell queue: with
   `preemptBackground` (set by the studio) a background render never starts at once but in an idle moment, so a live
   request of the same frame reaches the engine first; and a live request aborts background renders in flight
   (they wait and run again after).
3. **A kept draft delaying the final pass.** `progressMs` now keeps an in-flight render only when the newer request
   is another draft; a screen or refine pass (the hand stopped, a typed value) aborts it at once.
4. **Open stall: hashing.** The file's SHA-256 (the frame identity, studio-kit `frames.ts`) ran synchronously on the
   main thread: a 25 MB NEF cost ≈ 0.5 s of stall. It now uses WebCrypto (`crypto.subtle.digest`, native and
   asynchronous) for files ≥ 1 MB, same hex.
5. **Not causes (checked):** transfers are zero-copy and small (a 512×342×3 f64 result is 4 MB); the per-stage
   macrotask yield costs ≈ 10 stages × < 1 ms; worker start-up (LibRaw init, data packs loaded a second time in the
   worker) shows in boot (507 → 676–946 ms), not in renders; the copies of `bytes.slice()` (frames,
   openAs, the worker transfer) are ≈ 10 ms each for 25 MB.

### Prompt Context
**User prompt (verbatim):** see Step 1 (plus the orchestrator's request: explain the slower final render in the
diary and reduce it to ≤ ≈ 1.2× before, stalls < 100 ms)
**Assistant interpretation:** Find where the extra time goes; fix what is ours; trade sharpness for time on the CPU.
**Inferred user intent:** No freeze *and* no slower photographer workflow.
**Commit (code):** 5fd261b — "…live renders preempt background ones…; a screen pass aborts a kept draft; reference working image back to 512 (?refLong=1024 opt-in)"; 054cd8e — "…background renders start in an idle moment…; files hashed with WebCrypto on open; Mac BEFORE numbers"

### What I did
- `packages/shell/src/app/render/queue.ts`: `preemptBackground`, `preempt()`, `pump(s, later)`, in-flight keeps its
  `job`; `progressMs` only for draft-after-draft. Tests in `render-queue.test.ts`.
- `apps/studio/src/host/engines.ts`: `DEFAULT_REF_LONG = 512`. `apps/studio/src/main.ts`:
  `rt.renders.preemptBackground = true` with the other two settings.
- `packages/studio-kit/src/bridge/frames.ts`: `hashBytes` (WebCrypto ≥ 1 MB, else `sha256Hex`); test in
  `studio-kit/test/bridge.test.ts`.
- A temporary probe script (three typed commits, queue stats and render events), deleted after.
- Measured: `node …/01-measure-responsiveness.mjs --engines reference` after each change (runs after5–after8;
  after5's open "hang" was the script: its open wait required a render *after* the frame was selected, but the
  status leaves "opening…" only with that render; fixed by waiting for "selected and not opening").
- Re-measured BEFORE with the fixed script on a build of the branch base a10ae32 (`git archive a10ae32`, built in
  the scratchpad, served on 4811) → `before-reference-run2.json`.

### Why
- The final render must not be slower for the photographer; with one worker, order of jobs is everything.

### What worked
Reference engine, this machine (load 2–4), BEFORE (two runs) → AFTER (`after-reference-final.json`):

| step | before: result / worst stall | after: result / worst stall | ratio |
|---|---|---|---|
| open NEF as photo | 9842 / 3533; 15408 / 5783 ms | 13969 / **0** ms | 0.9–1.4× (concurrent Mac upload) |
| drag Time 40 px (photo), total | 15870 / 3183; 17986 / 3800 ms | 3874 / **0** ms (drag wall 1021 ms, draft at 419 ms) | 0.22× |
| type 15 + Enter (photo) | 2432 / 2417; 2012 / 2000 ms | 2600 / **0** ms | 1.07–1.29× |
| open DNG as negative | 5108 / 5067; 5691 / 5633 ms | 4667 / 250 ms | 0.82–0.91× |
| drag Time 40 px (negative), total | 11849 / 2200; 12719 / 2517 ms | 3370 / **0** ms (wall 1069 ms, draft at 434 ms) | 0.27× |
| type 15 + Enter (negative) | 1806 / 1800; 2108 / 2100 ms | 1668 / **0** ms | 0.79–0.92× |

The drag's wall time (20 mouse moves) went from 15.9–18.0 s to ≈ 1.0 s: the window answers every move.

### What didn't work
- `after5` (preemption build, first try of the new open wait): "open NEF as photo: no result in 180000 ms" — the
  script bug above, not the studio (a probe showed the open done in 10 s).
- A first version of the preemption test resolved the wrong pending render (`b.resolve(b.calls.findIndex(…))`
  indexes calls, not pending renders) and looped forever in its idle loop; fixed with `b.resolve()` and a bounded
  loop. The SwiftShader GPU BEFORE re-run on the base build twice failed to boot within 240 s
  ("page.waitForFunction: Timeout 240000ms exceeded") under load; superseded by the real-GPU numbers (Step 9).

### What I learned
- One worker serialises everything: the order in which work reaches it matters more than its raw speed.
- Typed 15 + Enter on the photo is still 1.07–1.29× before: the remaining cost is the navigator and filmstrip
  thumbnails that now really render (before, the main thread blocked so they piggy-backed on cached full images);
  they run after the main render and no longer delay it, but they share the CPU on a loaded machine.

### What was tricky to build
- Re-queuing a preempted background job: the in-flight record now keeps its `Waiting`, so an abort can put it back
  as waiting (unless a newer request already is), and its present callback (the thumbnail cache) still runs.

### What warrants a second pair of eyes
- `preemptBackground` changes when thumbnails start (an idle moment instead of at once) — only when the host sets it.
- The 250 ms stall left on the DNG open (CPU engine) is main-thread work I have not attributed yet (candidates: the
  roll kit's film layout on the main thread, the first presentation).

### What should be done in the future
- F10 on the CPU engine: sharper previews need cheaper pixels (core: `output.display` and `print.expose` are
  ≈ 70 % of a print change) or tiles at 1:1 on zoom; `?refLong=1024` is there to try.
- Attribute the remaining open stalls (Step 9 for the GPU engine).

### Code review instructions
- `packages/shell/src/app/render/queue.ts` (`request`, `preempt`, `pump`); `render-queue.test.ts`.
- `packages/studio-kit/src/bridge/frames.ts` `hashBytes`.

### Technical details
- JSON: `various/ws-b/before-reference.json`, `before-reference-run2.json`, `after-reference.json` (1024 px),
  `after-reference-ref512.json`, `after-reference-merged.json`, `after-reference-final.json`.

## Step 9: Merge of WS-A (open mode) into the worker design

WS-A changed `HostServices.decode` to take an explicit mode, added the photo/negative guess (`guessOpenMode`) to
the decode, `prior` and `forget` hooks, `StudioEngine.openAs` (Auto may decode twice), and `forgetSource` on both
engines. `git merge main` conflicted in `engines.ts` and `studio-engine.ts`. I kept WS-A's `openAs` flow as it is
and fitted the worker under it: the guess runs in the worker (in `decode.ts`, the same `guessOf` code); a decode
with `keep: 'register'` no longer registers itself in the worker but waits there until `HostServices.register`
posts a `register` message, so `openAs` can decode twice and call `forget` (a `forget` message →
`RefEngine.forgetSource`) *before* the new decode becomes the engine's source — the order WS-A relies on.
`WorkerEngine` forwards `forgetSource`; `RefEngine.forgetSource` also clears the sampled-stage LRU. The caller's
bytes are never transferred: `WorkerClient.decode` posts a copy (WS-A's `again` copy stays valid).

### Prompt Context
**User prompt (verbatim):** see Step 1 (and the orchestrator's merge request: `HostServices.decode(bytes, sha, name,
mode)`, `prior`, `forget`, `openAs`, `guessOpenMode` in the worker, `forgetSource` forwarded, copies not transfers)
**Assistant interpretation:** Merge main and make WS-A's open flow work through the worker.
**Inferred user intent:** One branch with both workstreams working.
**Commit (code):** d590a5f — "Merge main (WS-A open mode) into task/chb-027-responsive"

### What I did
- Resolved `studio-engine.ts` (WS-A's interface; `register(engine, info, data | undefined)`; notes keep no pixels).
- Rebuilt `engines.ts` from my side plus WS-A's: no `settings.photo`; `prior: openPrior`, `forget` →
  `forgetSource`, `register` → `WorkerEngine.register(sha)` for the worker, `openDecoded` otherwise.
- `decode.ts`: `guessOf`, the roll rule (a confident photo lends no base; photo mode drops the roll entry).
- `worker-protocol.ts` / `engine-serve.ts` / `worker-engine.ts`: `register` and `forget` messages.
- Test: "re-open as a photo (WS-A openAs): the worker forgets the negative decode and registers the photo one".
- Measurement script: the `#photo` checkbox is optional (main opens Auto: the NEF as a photo, the DNG as a negative).

### Why
- Registering at decode time would have let `openAs`'s `forget` (called after the decode) delete the new source.

### What worked
- `pnpm test`: 93 files, 2692 passed, 7 skipped. `pnpm typecheck`, `pnpm lint` green.

### What didn't work
- N/A beyond the conflicts.

### What I learned
- Splitting "decode" from "make it the engine's" keeps the host's ordering decisions on the main thread.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- `engine-serve.ts` keeps one pending decode per source until `register`; an Auto open that decodes twice
  overwrites it (intended).

### What should be done in the future
- N/A.

### Code review instructions
- `apps/studio/src/host/engines.ts` (`host.decode`, `register`, `forget`), `engine-serve.ts` (`register`, `forget`).

### Technical details
- N/A.

## Step 10: Real GPU (the owner's M1 Max): BEFORE and AFTER

The orchestrator made the owner's MacBook Pro (Apple M1 Max, Chrome, Metal WebGPU) drivable through a Playwright
1.65 server and an SSH tunnel (`scripts/mac-README.md` on main). I added `--mac` to the measurement script
(`chromium.connect('ws://127.0.0.1:9333/', …channel 'chrome', headless false…)`, WebGPU presenter instead of
Canvas2D), took the lock, measured BEFORE on the Mac's port 4600 (a build of main at 0b381c6, before CHB-027) and
AFTER on 4811 (this branch, twice: before and after the WebCrypto hash), both engines, and released the lock.

On a real GPU the drags were already fluid before (renders of 30–80 ms, no stalls); what froze the window there
was **opening** (decode, conditioning and hashing on the main thread). After: the DNG open has no stall, the NEF
open one of 200 ms; drags and typed values unchanged. The reference engine on the M1 Max shows the CPU story of
Step 8 cleanly (an otherwise idle machine): every stall gone, final renders equal to before.

### Prompt Context
**User prompt (verbatim):** see Step 1 (and the orchestrator's message: record BEFORE (port 4600) and AFTER numbers
on the real GPU, note what differs from SwiftShader)
**Assistant interpretation:** Real-GPU numbers for the diary next to the CPU ones.
**Inferred user intent:** Decide on evidence from Manfred's kind of machine, not a software adapter.
**Commit (code):** 20c6e02 — "CHB-027 WS-B: measurement --mac (the M1 Max over the Playwright tunnel); after/before JSON"

### What I did
- `ssh mimimi-2.local 'mkdir /tmp/chromobench-pw/lock && echo WS-B > /tmp/chromobench-pw/lock/owner'` (held by
  "orchestrator" at first; a Monitor retried every 60 s), then:
  `node …/01-measure-responsiveness.mjs --mac --base http://localhost:4600 --engines gpu,reference --step-timeout 300000 --out …/mac-before.json`
  and the same with `--base http://localhost:4811` → `mac-after-run1.json`, `mac-after.json` (final build).
- `ssh mimimi-2.local 'rm -rf /tmp/chromobench-pw/lock'` at the end.

### Why
- SwiftShader's GPU numbers (Step 2) were a software adapter's, and its "never finishing" drags were the settle()
  hang of Step 6.

### What worked
GPU engine (`GPU · apple metal-3 · 4000 px`):

| step | BEFORE result / worst stall (stalls) | AFTER result / worst stall (stalls) |
|---|---|---|
| open NEF as photo | 46786 / 1000 ms (3, 1767 ms) | 51475 / 200 ms (2, 308 ms) |
| drag Time 40 px (photo) | 1602 / 0 (drag wall 1543, renders 45–65 ms) | 1665 / 0 (wall 1615, renders 29–63 ms) |
| type 15 + Enter (photo) | 94 / 0 | 72 / 0 |
| open DNG as negative | 28920 / 1158 ms | 26178 / **0** |
| drag Time 40 px (negative) | 1718 / 0 | 1909 / 0 |
| type 15 + Enter (negative) | 118 / 0 | 71 / 0 |

Reference engine on the M1 Max (CPU, 512 px):

| step | BEFORE result / worst stall (stalls, total) | AFTER result / worst stall |
|---|---|---|
| open NEF as photo | 47815 / 2525 ms (2, 3083) | 44450 / **0** |
| drag Time 40 px (photo) | 9255 / 1292 ms (6, 7693); drag wall 9269 ms | 2824 / **0**; wall 1582, first draft 339 ms, final 1246 ms after release |
| type 15 + Enter (photo) | 1283 / 1276 ms | 1268 / **0** |
| open DNG as negative | 29605 / 2700 ms | 25911 / **0** |
| drag Time 40 px (negative) | 7658 / 883 ms (7, 6117); wall 7587 ms | 2394 / **0**; wall 1549, first draft 267 ms, final 849 ms after release |
| type 15 + Enter (negative) | 914 / 883 ms | 872 / **0** |

### What didn't work
- My first Mac BEFORE run used the script version with the broken open wait (Step 8); after its photo steps it
  waited out the DNG open; I stopped it and ran again (`mac-before-run1.log` kept in the scratchpad only).

### What I learned
- Different from SwiftShader: on Metal the GPU engine renders a 896×599 screen in ≈ 50 ms, drafts are not even
  needed; the GPU drags never stalled. SwiftShader drafts took seconds and made the GPU look like the CPU.
- Open times on the Mac (26–51 s) are dominated by streaming the file through the tunnel (`setInputFiles` uploads
  25 MB / 12 MB to the remote browser); compare stalls there, not open durations.
- The remaining 200 ms on the GPU's NEF open is GpuEngine's own main-thread work (it packs the 4000 px working image
  into an upload buffer, `engine-gpu.ts` texture upload) — out of scope (GpuEngine stays on the main thread).

### What was tricky to build
- One user at a time on the Mac: the lock and a 60 s retry loop; my local runs went on meanwhile.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- GpuEngine: upload the working image tile by tile across frames (or from the worker as an ImageBitmap/buffer) to
  remove the last open stall.

### Code review instructions
- `scripts/01-measure-responsiveness.mjs --mac` (needs the tunnel and the lock).

### Technical details
- JSON: `various/ws-b/mac-before.json`, `mac-after-run1.json` (before the WebCrypto hash), `mac-after.json`.
