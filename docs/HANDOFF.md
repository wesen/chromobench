# chromobench: handoff guide

This guide is for a developer taking over chromobench. It explains what the project is, how to build, run and
test it, how the work is organised, how to reproduce the RAW colour investigation on a Mac (CHB-033), how to find
out why WebGPU might not work on an Apple Silicon Mac, and what to do next. Every claim that refers to code names
the file; every number comes from a ticket diary you can open.

Written 2026-11-14, at commit `main` after CHB-031 round 2, CHB-032 and CHB-033 steps 1–5.

---

## 1. What chromobench is

A browser application (a PWA, "the studio") that lets a photographer work like in a colour darkroom:

- it imports **digital camera RAWs** (Nikon NEF, DNG, …) and **scans of colour negatives** (DNG/TIFF from a flatbed
  scanner);
- it prints them through a **physical model of film and paper** (spectral dye densities, the orange mask, an
  enlarger with time, aperture and filtration, paper curves), using stock data from spektrafilm (Andrea Volpato,
  CC BY-SA 4.0; see CHB-004 for the data pipeline and licence questions);
- it offers darkroom tools (test strips, ring-arounds, dodging, density masks) and Lightroom-like library and
  export functions.

The intended user is a photographer (the owner's father; in the tickets he appears as the persona "Manfred",
CHB-026 `reference/01-persona-manfred.md`). The goal is a professional replacement for his Lightroom + Negative Lab
Pro + Dehancer workflow. A JavaScript DSL lets an LLM agent drive the app (recipes, layouts, playbooks); the
photographer never sees the DSL.

Two engines compute prints: a **WebGPU engine** (`packages/gpu`, fast, works at up to 4000 px) and a **CPU
reference engine** (`packages/core`, f64, runs in a worker, previews at 640 px through tables, exports exact). The
GPU engine is what the photographer should use; the CPU engine is the fallback ("Compatibility mode").

---

## 2. Getting started

### Requirements

| Tool | Version used | Notes |
|---|---|---|
| Node.js | 24.18 | runs `.ts` files directly (type stripping); scripts use `node file.ts` |
| pnpm | 10.15.1 | workspace manager |
| Go | 1.25 | only for `bridge/` (the agent bridge server, `chromobench serve`) |
| Chrome | current stable | WebGPU; Playwright's Chromium for the test suites |
| Python 3 + numpy, tifffile, Pillow | any recent | only for CHB-033 and cosplay analysis scripts |

### Install, build, run

```bash
git clone <remote> chromobench && cd chromobench
pnpm install
pnpm exec playwright install chromium        # once, for the browser test suites

pnpm --filter @chromobench/studio dev        # dev server, http://localhost:4173/
pnpm --filter @chromobench/studio build      # production build into apps/studio/dist
pnpm --filter @chromobench/studio preview    # serve the build, http://localhost:4173/
```

Useful URL options (`apps/studio/DEMO.md`): `?engine=gpu|reference|mock`, `?long=N` (GPU working size, default
4000; `0` = the file's own size), `?refLong=N` (CPU working size, default 640), `?refMode=exact`, `?canvas2d`,
`?nosw` (no service worker), `?fresh` (keep nothing in the browser), `?layout=`.

### Checks (all must pass before merging)

```bash
pnpm typecheck        # tsc over the workspace
pnpm lint             # package-boundary and literal-colour checks
pnpm gen:check        # generated docs and references are up to date (regenerate with: pnpm gen)
pnpm test             # vitest: about 104 files, 2800 tests, about 70 s
CI=1 pnpm test:browser   # Playwright: about 106 tests incl. GPU conformance 320/320, about 3 min
```

When several people or agents run browser suites on one machine, give each run its own ports:
`STUDIO_PORT=5521 STUDIO_KIT_PORT=5522 SHELL_DEMO_PORT=5523 GPU_PARITY_PORT=5524 CI=1 pnpm test:browser`.
By default the `[chromium-webgpu]` and `[gpu-parity]` projects run WebGPU on **SwiftShader** (software), on any
machine. `REAL_GPU=1` drops those flags so they get the machine's own adapter (Metal on a Mac, headless works);
on the M1 Max the full suite passes there too (CHB-034).

---

## 3. Repository map

| Path | What it is |
|---|---|
| `apps/studio/` | the studio PWA: `src/main.ts` (host: boot, menus wiring, open flow, dialogs, status line), `src/host/` (engines, decode, first print, export, worker), `src/status-text.ts` (plain wording) |
| `packages/contract/` | the contract: types, op registry, parameter catalogue, recipes and edit log. Changes need a version bump and an entry in `CONTRACT-DECISIONS.md` |
| `packages/core/` | the physics: spectral film and paper model, enlarger, CPU reference engine (`engine-ref.ts`), tables |
| `packages/gpu/` | WebGPU engine (`engine-gpu.ts` + `engine/*`), parity tests against core |
| `packages/ingest/` | decoders: TIFF, DNG, LibRaw (WebAssembly) for camera RAWs, scan conditioning (rebate, flare, frames on strips) |
| `packages/output/` | export encoders (TIFF 16, PNG, ICC) |
| `packages/data/` | data packs (film and paper stocks, cameras, lights) as safetensors + manifests (committed) |
| `packages/shell/` | the UI shell ("CraftKit Shell" ported): store, history/undo, viewport, menus, panels, render queue |
| `packages/studio-kit/` | the studio's UI DSL (`cb`) on top of the shell's (`ck`); layouts in `layouts/*.js`; kits (roll, looks, finish) |
| `packages/dsl/` | the agent DSL run in a QuickJS sandbox |
| `packages/agent/` | agent integration (chat, bridge client) |
| `packages/engine-mock/`, `packages/conformance/` | the mock engine and the engine conformance suite |
| `bridge/` | Go server for external agents (MCP) |
| `e2e/` | Playwright specs for the studio |
| `tools/` | doc generation, lint checks, fixtures, scripts (`tools/scripts/unused-exports.mjs`) |
| `docs/reference/` | generated reference docs (ops, DSL) |
| `ttmp/YYYY/MM/DD/CHB-NNN--…/` | tickets (see section 4) |

---

## 4. How the work is organised

### Tickets and diaries (docmgr)

All work is tracked as tickets under `ttmp/`, managed with the `docmgr` CLI (`docmgr ticket list`,
`docmgr task list --ticket CHB-029`, `docmgr task check --ticket … --id …`, `docmgr doc add …`). A ticket folder
has `index.md`, `tasks.md`, `changelog.md`, `design-doc/` (plans), `diary/`, `reference/`, `playbook(s)/`,
`scripts/` (numbered, tracked) and `various/` (screenshots, measurements). If you don't have docmgr, the files
are plain Markdown with YAML front matter; edit them by hand and keep the `<!-- t:id -->` task markers.

Every substantial piece of work has a **diary in the "investigation" format**: numbered steps, each opening with
one or two paragraphs, then the sections *Prompt Context* (the request verbatim), *What I did*, *Why*, *What
worked*, *What didn't work* (exact commands and errors), *What I learned*, *What was tricky to build*, *What
warrants a second pair of eyes*, *What should be done in the future*, *Code review instructions*, *Technical
details*. Read the latest steps of a ticket's diary before touching its code.

### Branches and merging

Work happens on `task/chb-NNN-…` branches (often in git worktrees under `.claude/worktrees/`), merged into `main`
with `--no-ff` after `typecheck`, `lint`, `gen:check`, `test` and `test:browser` pass. Regenerate snapshots
(`npx vitest run <file> -u`) and generated docs (`pnpm gen`) instead of hand-merging them, and read their diffs.

### Privacy rules (important)

The test material is the photographer's **private family photographs and scans**. Rules followed so far:

- raw files (NEF, DNG, scans) are **never committed**; they live in the git-ignored `.playwright-mcp/` folder
  (`photos/`, `scans/`, `dng/`, `dngv/`);
- browser profiles of test sessions are git-ignored (`ttmp/**/sessions/*/profile/`);
- screenshots of the app showing these photos were committed **only inside ticket folders** (CHB-026 sessions,
  CHB-033 `various/shots/`) while the repository had no remote. Treat the repository itself as private;
- nothing from the photos goes into public places (vault notes, issues, public repos);
- committed test fixtures are synthetic.

---

## 5. Test material

| What | Where on the owner's machines | Put it into |
|---|---|---|
| 33 Nikon D750 NEFs (digital photos, 2026-11-09…11) | `~/Downloads/2026-11-11 - manfred test bilder/` (Linux), `~/Dropbox/Photos/2026-11-11 - manfred test bilder/` (Mac) | `.playwright-mcp/photos/` |
| a 3-frame colour-negative strip `raw010.dng` | `~/Downloads/raw010.dng` | `.playwright-mcp/photos/` |
| Epson V600 / VueScan "Linear Raw" DNG scans + Negative Lab Pro positives | Mac `~/Dropbox/Photos/RAW/Scans/` (2,500 DNGs) | `.playwright-mcp/scans/` |
| Adobe DNG Converter DNGs of 4 NEFs, Adobe's stage-3 and renders | Mac `~/chromobench-tools/dng-out/`, `~/chromobench-tools/dngv/` | `.playwright-mcp/dng/`, `.playwright-mcp/dngv/` |

Ask the owner for access. The catalogue of what each file exercises is CHB-026 `reference/02-test-material.md`.

---

## 6. WebGPU on an Apple Silicon Mac (M1 Pro): why it might not work

The studio picks the GPU engine when WebGPU works and otherwise falls back to the CPU engine. The bottom-left pill
shows "Fast (graphics card)" (GPU) or "Compatibility mode: slower (no WebGPU)" (`apps/studio/src/status-text.ts`); its tooltip has the technical reason after
"no WebGPU:". The reasons the app can report come from `packages/gpu/src/device.ts`:

| Reported reason | Meaning |
|---|---|
| `this browser has no WebGPU` | `navigator.gpu` is undefined |
| `no GPU adapter` | `navigator.gpu.requestAdapter()` returned null (also with `forceFallbackAdapter`) |
| `requestDevice failed: …` | an adapter exists but the device with the required limits/features could not be created |

Work through these in order:

1. **Secure context.** WebGPU (and the File System Access API and the service worker) exist only on `https://`
   or `http://localhost`. `http://192.168.x.x:4173` or `http://<machine>:4173` from another computer has **no
   WebGPU** ("this browser has no WebGPU"). Fixes: use `localhost` on the Mac itself; or an SSH tunnel
   (`ssh -L 4173:localhost:4173 host`, then open `http://localhost:4173/`); or HTTPS, e.g. `tailscale serve --bg
   4173` (then add the `*.ts.net` host to Vite's `preview.allowedHosts`, which otherwise answers
   "Blocked request. This host is not allowed" with a 403). Check in the DevTools console:
   `isSecureContext` must be `true`.
2. **Browser and version.** Chrome ≥ 113 has WebGPU on by default on macOS. Check `chrome://version`. Safari 26
   also has WebGPU; Firefox on macOS may not. Brave/Arc/other Chromium forks can disable it.
3. **Hardware acceleration.** `chrome://settings/system` → "Use graphics acceleration when available" must be on
   (relaunch after changing it).
4. **`chrome://gpu`.** Look at "Graphics Feature Status": "WebGPU: Hardware accelerated" is what you want. If it
   says "Disabled" or "Software only", read the "Problems Detected" section (blocklist entries, driver bugs). As
   a test only, `chrome://flags/#enable-unsafe-webgpu` and `#ignore-gpu-blocklist` force it on.
5. **Policies and profiles.** A managed (company) Chrome can disable WebGPU or hardware acceleration by policy:
   `chrome://policy`. Try a fresh profile or Guest window to rule out extensions.
6. **Console probe.** In DevTools on the studio page:
   ```js
   isSecureContext, !!navigator.gpu
   const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
   a && [a.info?.vendor, a.info?.architecture, [...a.features]]
   const d = a && await a.requestDevice(); d && 'device ok'
   ```
   A null adapter with a secure context and acceleration on points to the blocklist (step 4) or a remote/virtual
   display (Screen Sharing and some remote-desktop tools can leave Chrome without a usable GPU).
7. **The app itself.** Open `/?engine=gpu`: instead of falling back silently it fails with "WebGPU engine
   requested but unavailable: <reason>". `/?engine=reference` forces the CPU engine for comparison.
8. **Automated check.** CHB-027 has a smoke script that opens the studio in real Chrome and reports the engine:
   `ttmp/2026/11/12/CHB-027--…/scripts/mac-01-gpu-smoke.mjs` (and `mac-02-open-and-drag.mjs` for timings),
   described in `…/scripts/mac-README.md` and `…/playbook/01-real-gpu-browser-testing-on-the-m1-mac-over-ssh.md`.
   On your own Mac you can run them locally against `http://localhost:<port>/`; Playwright must use the installed
   Chrome (`channel: 'chrome'`) and **headed** mode (`headless: false`): headless and Playwright's bundled
   Chromium may not get the Metal-backed adapter.
9. **Low-level.** macOS version (WebGPU needs macOS 13+ in Chrome), low-power mode, and external display setups
   rarely matter on M1 Pro; if `chrome://gpu` shows "Metal" as the backend and WebGPU hardware accelerated but
   the app still says "requestDevice failed", report the message: it means a limit or feature the engine asks
   for (`packages/gpu/src/limits.ts`, `negotiate`) is not available.

On the owner's M1 Max the GPU engine works in Chrome over localhost (CHB-027 measurements). The failure seen during
handover was cause 1: the studio opened over plain http through Tailscale.

---

## 7. The RAW colour investigation (CHB-033): reproduce and continue on a Mac

Ticket: `ttmp/2026/11/12/CHB-033--raw-colour-against-adobe-dng-round-trip-forward-matrices-colour-chart-lightroom-reference/`.
Read its `design-doc/01-plan-and-first-measurements.md` and `diary/01-diary.md` (steps 1–5) first.

### The question and the answer so far

"Does our RAW import match Lightroom?" chromobench deliberately renders through film and paper, so the stage that
must match is the **scene colour before the film**: white balance, camera RGB → XYZ, exposure. Findings:

1. The **white balance** of a NEF (as-shot multipliers, fixed in CHB-031 `50c46a2`) is identical to Adobe's
   AsShotNeutral on all four test photos.
2. Our NEF colour (LibRaw's single Adobe colour matrix) vs Adobe's dual-illuminant colour matrices: ΔE2000 median
   0.13–0.51, p99 ≤ 1.3 (invisible).
3. Adobe's **forward matrix alone** gives ~0.55× our chroma; the **Adobe Standard** profile's HueSatMap (×1.8),
   LookTable (−10 %) and RGB tone curve bring it back.
4. Adobe's renderer was ported from the DNG SDK (`scripts/lib-adobe.ts`) and **validated against Adobe's own
   `dng_validate`**: ΔE2000 median 0.015–0.04, max 0.13.
5. Our colour vs Adobe Standard's final colour: ΔE2000 median 0.8–1.9 (p90 2.1–4.9); ours is 16–20 % more
   saturated. No decoding error; the remaining difference is look.

### Step-by-step reproduction on a Mac

1. **Adobe DNG Converter.** `brew install --cask adobe-dng-converter` (asks for your password), or Adobe's
   installer. Binary: `/Applications/Adobe DNG Converter.app/Contents/MacOS/Adobe DNG Converter`. Don't run it
   with `-h` over SSH: it hangs (opens its GUI).
2. **Convert the test NEFs** (DSC_8559 daylight, DSC_8541 tungsten, DSC_8536 evening, DSC_8655 night):
   ```bash
   C="/Applications/Adobe DNG Converter.app/Contents/MacOS/Adobe DNG Converter"
   "$C" -c -p0 -d ~/chromobench-tools/dng-out DSC_8559.NEF DSC_8541.NEF DSC_8536.NEF DSC_8655.NEF
   ```
   Copy the DNGs into the repository's `.playwright-mcp/dng/`.
3. **Build Adobe's reference renderer** (DNG SDK 1.7.1):
   ```bash
   curl -LO https://download.adobe.com/pub/adobe/dng/dng_sdk_1_7_1.zip && unzip -q dng_sdk_1_7_1.zip
   sudo xcodebuild -runFirstLaunch          # needed once if xcodebuild fails to load a plug-in
   # the bundled zlib breaks against the current macOS SDK ("_stdio.h:322:7: error: expected identifier"):
   sed -i.orig 's/#if defined(MACOS) || defined(TARGET_OS_MAC)/#if defined(MACOS)/' \
     dng_sdk_1_7_1/xmp/toolkit/third-party/zlib/zutil.h
   cd dng_sdk_1_7_1/dng_sdk/projects/mac
   xcodebuild -project dng_validate.xcodeproj -scheme "dng_validate release" -configuration Release \
     -derivedDataPath ../../../dd build
   # binary: dng_sdk_1_7_1/dng_sdk/targets/mac/release64/dng_validate
   ```
4. **Render with Adobe's code** (stage-3 linear camera RGB, and the final render in 16-bit ProPhoto):
   ```bash
   V=…/dng_sdk/targets/mac/release64/dng_validate
   for n in DSC_8559 DSC_8541 DSC_8536 DSC_8655; do
     "$V" -3 dngv/$n-stage3 -cs3 -16 -tif dngv/$n-adobe-prophoto16 dng-out/$n.dng; done
   ```
   Copy them to `.playwright-mcp/dngv/`.
5. **The ACR3 tone table** (Adobe's data, kept out of the repository): parse the 1025 float literals of
   `dng_tone_curve_acr3_default::Evaluate` (`dng_sdk/source/dng_render.cpp`, table starting at line 164) into
   `.playwright-mcp/dng/acr3-tone.json` (a JSON array). The diary's step 4, *Technical details*, shows the parser.
6. **Run the scripts** (`ttmp/…/CHB-033…/scripts/`; the NEFs are expected in
   `~/Downloads/2026-11-11 - manfred test bilder/` by scripts 01 and 03 — adjust the constant at the top if yours
   are elsewhere):
   ```bash
   node scripts/01-nef-vs-adobe-dng.ts            # NEF vs Adobe DNG colour matrices
   node scripts/02-cm-vs-fm-same-adaptation.ts    # colour matrix vs forward matrix; renders into various/shots
   node scripts/03-adobe-render-port.ts           # Adobe's stages, chroma per stage, our colour vs Adobe's
   python3 scripts/04a-sample-dng-validate.py .playwright-mcp/dngv DSC_8559 8   # per photo
   node scripts/04-validate-port.ts               # the port against dng_validate
   ```
   `exiftool` must be installed (`brew install exiftool`); scripts read the profile tables with it.
   Renders are PPM; convert with Pillow (`Image.open(f).save(f[:-4]+'.png')`).

### What's next in CHB-033

1. **Adobe Color** (Lightroom's default profile since 2018), the second reference. It ships with Camera Raw:
   `/Library/Application Support/Adobe/CameraRaw/Settings/Adobe/Profiles/Adobe Raw/Adobe Color.xmp`, an XMP
   profile with its own look table and tone curve. Either render it with Camera Raw (Photoshop/Lightroom, which
   needs a working licence: the owner's Photoshop refused all scripting with error 8800, probably an expired
   licence), or decode its `crs:` look table and add it to the port.
2. **A ColorChecker** shot by the photographer (D750, daylight and tungsten): the ground truth for which colour is
   accurate (ours, Adobe Standard, Adobe Color). Measure patch Lab against the chart's published values.
3. **Decide what to match** and then, if wanted: use ForwardMatrix/profile tables when a DNG has them, ship the
   D750's matrices for NEFs, apply BaselineExposure (read but unused today: `packages/ingest/src/decode/tiff.ts`).
4. **A regression test** from script 01/04 that skips when the private files are absent.
5. **The report**: the diary is detailed enough to write it from.

---

## 8. Where the project stands and what's next

### Recently done (2026-11-12…13)

- **CHB-026** cosplay usability testing: four sessions with a scripted photographer persona found F1–F44;
  findings and verdicts in `CHB-026 …/various/02-findings.md`, sessions in `…/sessions/`.
- **CHB-027** and **CHB-031** fixed those findings: real enlarger mode by default (Time and Aperture work), photo
  first print (automatic exposure, as-shot white balance), Open As, the library, strip frames (orientation, size,
  base from the gaps), the layout switch that keeps photos open, History in words, Actual Pixels, faster cold open
  (29 s → ~7 s on the CPU), CPU previews through tables at 640 px.
- **CHB-032** clean-up (closed): splits of large files, one TIFF writer, reference docs on undo and on which engine
  computes what (`CHB-032 …/reference/`), 63 unused exports removed.

### Decisions taken (2026-11-14)

- **First-print colour aim for scans** (CHB-026 F30): stays **neutral grey** (integrate to grey, `alpha: 1` in
  `FIRST_PRINT_AIM`, `apps/studio/src/host/first-print.ts`), not the warmer Negative Lab Pro look. Still open: the
  Roll module's `ALPHA = 0.75` (`packages/studio-kit/kits/roll/src/engine/constants.ts`) keeps a quarter of each
  frame's cast, so a roll's first prints are not the studio's (CHB-028 task).
- **RAW colour** (CHB-033): **ours stays** (the camera's colour matrix, 16–20 % more saturated than Adobe Standard's
  look); no Adobe look table is applied.

### Next, in order

1. **Real-GPU check on your Mac.** Run the browser suite (the `chromium-webgpu` and `gpu-parity` projects should
   run on the GPU) and the CHB-027 `mac-0*.mjs` scripts; repeat the cosplay check of the photo first print and the
   strips on the GPU engine. Everything after CHB-027 was tested on the CPU engine only.
2. **CHB-029: UI DSL streamlining** (the next big ticket; plan in `design-doc/01-plan.md`): typed host
   capabilities, one menu source, split `createCb()`, shared modules, status bar and dialogs in the DSL, a jobs
   model with visible progress on the CPU engine, typed state, an "Advanced" flag in the catalogue (contract bump),
   variant → layout naming. Order: items 1, 2, 4; then 5+6; then 8; then 3, 7, 9. Also its new tasks: the CPU 1:1
   refine pass and the honest 1:1 label (session 03 F34, session 04 F40).
3. **CHB-028 follow-ups**: exports at the file's own size on both engines (the CPU engine exports its 640 px
   working image today); "Where is …?" blocks the File menu (F41); History details (F43); Real → Normalised
   darkens a photo (F44); filtration first step too coarse (F37); portrait frames on a strip open sideways (F42).
4. **CHB-030: agent-written layouts** in the QuickJS sandbox (after CHB-029 items 1, 4, 7, 9).
5. **CHB-033** continuation (section 7).
6. Other open tickets, each with its own plan and tasks: CHB-004 (data pipeline, licence; not public in this
   version), CHB-008 (agent integration), CHB-010 (darkroom printing), CHB-011 (output and colour management),
   CHB-013 (calibration with the photographer's own setup), CHB-020 (roll workflow), CHB-021 (looks and presets),
   CHB-022 (finish and retouch). CHB-014 (B&W) and CHB-015 (extensions) are parked.

After each user-visible change, a **cosplay session** (CHB-026 `playbooks/01-cosplay-session-protocol.md`) with a
scripted persona on the private photos has been the way to find what a photographer would trip over.

---

## 9. Things that live outside the repository

| What | Where | How to recreate |
|---|---|---|
| Private photos and scans | owner's machines | ask the owner (section 5) |
| Adobe DNG Converter, `dng_validate`, `acr3-tone.json` | owner's Mac `~/chromobench-tools/`, `.playwright-mcp/dng/` | section 7 |
| Camera Raw test sidecar and script | `ttmp/…/CHB-033…/scripts/acr/` (in the repo) | needs a licensed Photoshop |
| Obsidian project note | the owner's vault | not needed to work |
| Preview builds for testers (`apps/studio/dist-current/`) | git-ignored | `pnpm --filter @chromobench/studio exec vite build --outDir dist-current` |
