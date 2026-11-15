# chromobench: handoff guide

This guide is for a developer taking over chromobench. It explains what the project is, the one editing model the
studio is built on (CHB-037), how to build, run and test it, how the work is organised, how to reproduce the RAW
colour investigation on a Mac (CHB-033), how to find out why WebGPU might not work on an Apple Silicon Mac, and what
to do next. Every claim that refers to code names the file; every number comes from a ticket diary you can open.

Written 2026-11-15 at the end of CHB-037 (the unified editing model, phases P0–P9; branch
`task/chb-037-unified-model`). The previous version (2026-11-14, after CHB-031…033) described the studio before the
cut-off; it is in git history.

---

## 1. What chromobench is

A browser application (a PWA, "the studio") for a photographer who works with film:

- it imports **scans of colour negatives** (DNG/TIFF from a flatbed scanner) and **digital camera RAWs** (Nikon NEF,
  DNG, …) — the camera files are "shot on film" through a forward film simulation;
- it prints them through a **physical model of film and paper** (spectral dye densities, the orange mask, an
  enlarger with time, aperture and filtration, paper curves), using stock data from spektrafilm (Andrea Volpato,
  CC BY-SA 4.0; see CHB-004 for the data pipeline and licence questions);
- around the darkroom it has the **digital tools of Lightroom and Photoshop** (from the "Editor lab" prototype):
  curve, levels, HSL, colour grading, vibrance, channel mixer, clarity, sharpen, vignette, 16 blend modes, groups,
  masks (gradients, brush, luminance and colour ranges), heal and clone;
- a library, rolls (first print per roll, matching), looks and presets, export (16-bit TIFF, PNG, ICC).

The intended user is a photographer (the owner's father; in the tickets he appears as the persona "Manfred",
CHB-026 `reference/01-persona-manfred.md`). The goal is a professional replacement for his Lightroom + Negative Lab
Pro + Dehancer workflow. An **agent with only `eval`** (a JavaScript DSL in a QuickJS sandbox) can do and see
everything he can: edit any stage, run any command, read any state, build layouts; the photographer never sees the DSL.

Two engines compute prints: a **WebGPU engine** (`packages/gpu`, fast, works at up to 4000 px) and a **CPU
reference engine** (`packages/core`, f64, runs in a worker, previews through tables, exports exact). The GPU engine
is what the photographer should use; the CPU engine is the fallback ("Compatibility mode") and the oracle.

---

## 2. The editing model (CHB-037, CHB-035 design 01 v2)

The design is `ttmp/2026/11/14/CHB-035--…/design/01-digital-editing-in-chromobench.md`; the implementation plan and
every phase's diary are in `ttmp/2026/11/14/CHB-037--…/`. There was a **hard cut-off**: no backwards compatibility,
no migrations; edits saved by the earlier studio are cleared once at start (`resetStorage`, with a message).

**A frame is a document** (`packages/contract/src/document.ts`, format 3): `source`, `stages`, `masks`, `probes`,
`geometry` (orientation, straighten, crop), `output`. Collections are `Coll`s (ordered, id-keyed; ids are unique in
the whole document). A negative scan has the stages `scan`, `darkroom`, `print`; a camera file has `scene`, `film`,
`darkroom`, `print`.

**Each stage is a medium and a stack** of entries: layers (an op of the catalogue with its parameters), groups and
links. The stage's **law** (`packages/contract/src/stage-laws.ts`) says what amount, blend and order mean:
`light` (the darkroom: every entry adds or modulates light on the paper — main exposure, printer lights, burns,
dodges, flashes, preflash, filters, density "contrast" masks; amount scales time or density; the order does not
change the print), `composite` (the print and the scene stage: layers apply from the top down, amount is opacity,
16 W3C blend modes, in an encoding — `print-rgb`, `print-oklab`, … — the compiler inserts), `repair` (the scan:
heal and clone spots in order). Any entry can use a mask from the document's mask library (one algebra: add, subtract,
intersect; feather in mm on the print; range components read the stage input or a named cut).

**Cuts and one compiler.** `CutName` (`source`, `scan`, `scene.input`, `scene`, `film`, `negative`, `darkroom.main`,
`darkroom.H`, `print`, `finished`, `display`) names every point of the pipeline; the contract's compiler turns a
document into a node graph up to a cut, and both engines evaluate the same graph (`packages/conformance` checks them:
524/524 cases; `tools/goldens` holds 66 golden pictures of the reference engine that P2 used to prove the cut-off
reproduced the old darkroom).

**One history** (`packages/values`): the store's document log holds every frame's transactions with one cursor
(`Log`; four mutations: set, insert, remove, move; batches over a roll are one step). Drafts carry a drag or a
proposal; an agent's change in "ask" mode is a pending proposal approved on a card. The History panel shows a frame's
steps in his words (`packages/studio-kit/src/model/history.ts`). Ratings are document-tier (undoable).

**Links** (`packages/contract/src/links*.ts`): looks are versioned pure functions `(params, facts) → group` (built-in:
warm/cool print, softer/more contrast, edge burn, crisp print, …); a link entry expands at compile; "bake" turns it into
its plain group. A roll holds shared media; a frame's scan medium links to the roll and keeps its own changes as
overrides (its divergence). Presets are looks without parameters; sync copies values or inserts the same link.

**The UI is a program** in two immutable DSLs: `ck` (`packages/shell`, forms, modules, panels, state tiers, passes)
and `cb` (`packages/studio-kit`, the studio's builders and kits). **The stack kit** (`cb.kits.stack`,
`packages/studio-kit/kits/stack/`) gives every stage one layers panel, one params panel (with editors: curve, levels,
HSL, colour grading wheels, mixer; the colour-range eyedropper), one masks panel, the "+ Layer" menu from the
catalogue, mask tools and the `layer.*`/`mask.*`/`link.*` commands; the Enlarger, Exposures and Finish panels are
specialised stack views. A stage policy pass warns when a module shows a stage it does not declare. Layouts are in
`packages/studio-kit/layouts/*.js`: **classic** (Library, Roll, Scene, Print, Edit, Finish, Assistant, Output),
**darkroom** ("Darkroom first": strip, print, Enlarger, Paper and a collapsed "Digital (after the print)" palette),
simple, tiny, lab, roll, finish, looks. View ▸ Layout switches in place (open frames and the history stay).

**The workbench** (`wb` in `packages/dsl`, served by `packages/studio-kit/kits/chat/src/workbench.ts` and
`apps/studio/src/host/workbench.ts`): `wb.commands()`, `wb.run(id, …)` (the same command a key runs, under his
mode: ask proposes, auto commits, read-only refuses), `wb.state(selector)`, `wb.screen().explain()` (the mounted
layout with live values), `wb.layouts.build(src)` / `wb.layouts.use(layout)` (a layout written in the sandbox crosses
as data, is checked by the passes and proposed in a dialog), `cb.looks.define(src)`. Layouts he accepted and looks the
agent wrote are kept in the KV (`settings/agent-layouts`, `settings/agent-looks`). Two tests keep the surface
complete (`packages/studio-kit/test/chat/workbench.test.ts`).

---

## 3. Getting started

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
node e2e/make-scenes.ts .playwright-mcp/synthetic   # synthetic test files (a negative, a roll, a camera RAW)
```

Useful URL options (`apps/studio/DEMO.md`): `?engine=gpu|reference|mock`, `?long=N` (GPU working size, default
4000; `0` = the file's own size), `?refLong=N` (CPU working size, default 640), `?refMode=exact`, `?canvas2d`,
`?nosw` (no service worker), `?fresh` (keep nothing in the browser), `?layout=` (a built-in id or a kept assistant
layout). In the page, `window.chromobench` is the test and agent hook (`apps/studio/src/main.ts`, `makeHook`);
`window.chromobench.eval(code)` runs agent DSL code.

### Checks (all must pass before merging)

```bash
pnpm typecheck        # tsc over the workspace
pnpm lint             # package-boundary and literal-colour checks
pnpm gen:check        # generated docs and references are up to date (regenerate with: pnpm gen)
pnpm test             # vitest: 137 files, ~3380 tests, ~30 s
node tools/goldens/render.ts --check    # 66 golden pictures of the reference engine
CI=1 pnpm test:browser   # Playwright: 147 tests incl. GPU conformance 524/524, ~8 min on SwiftShader
```

When several people or agents run browser suites on one machine, give each run its own ports:
`STUDIO_PORT=5521 STUDIO_KIT_PORT=5522 SHELL_DEMO_PORT=5523 GPU_PARITY_PORT=5524 CI=1 pnpm test:browser`.
By default the `[chromium-webgpu]` and `[gpu-parity]` projects run WebGPU on **SwiftShader** (software), on any
machine. `REAL_GPU=1` drops those flags so they get the machine's own adapter (Metal on a Mac; **headless works**, so
never open a headed window on someone's desktop); on the M1 Max the full suite passes there in ~4 min. Benches are
skipped unless `BENCH=1`. Several agents on one machine take a lock directory before a `REAL_GPU=1` run.
`e2e/walkthrough.spec.ts` is the end-to-end tour (negative to export, darkroom arrangement, roll, camera file, the
agent); `P9_SHOTS=<dir>` writes its screenshots there.

---

## 4. Repository map

| Path | What it is |
|---|---|
| `apps/studio/` | the studio PWA: `src/main.ts` (host: boot, layouts, open flow, dialogs, status line, the hook), `src/host/` (engines, decode, first print, export, worker, the assistant and its workbench), `src/status-text.ts` (plain wording) |
| `packages/values/` | the builder core: immutable values, `Coll`, paths, the four mutations, `diff`, the document log (README) |
| `packages/contract/` | document format 3, stages and laws, cuts, the compiler, the op catalogue (with `ui` labels and menus), masks, links and looks, bindings. Changes bump `CONTRACT_VERSION` (1.3.0) and add a CC entry to `CONTRACT-DECISIONS.md` |
| `packages/core/` | the physics and the f64 reference engine (`engine-ref.ts`), tables, the composite ops |
| `packages/gpu/` | WebGPU engine (`engine-gpu.ts`, `chain/`, WGSL with includes linked by `chain/wgsl-link.ts`), parity tests against core |
| `packages/engine-mock/`, `packages/conformance/` | the mock engine and the engine conformance suite (+ goldens) |
| `packages/ingest/` | decoders: TIFF, DNG, LibRaw (WebAssembly) for camera RAWs, scan conditioning (rebate, flare, frames on strips) |
| `packages/output/` | export encoders (TIFF 16, PNG, ICC), exact tiled export |
| `packages/data/` | data packs (film and paper stocks, cameras, lights) as safetensors + manifests (committed) |
| `packages/shell/` | `ck`, the UI DSL: forms, modules, panels, dock, store (three tiers, one history), passes, DOM renderers (README) |
| `packages/studio-kit/` | `cb`, the studio's DSL on `ck`; layouts in `layouts/*.js`; kits: `stack`, `roll`, `looks`, `finish`, `chat`, `diagnostics` |
| `packages/dsl/` | the agent DSL run in a QuickJS sandbox (`frame`, transactions, `cb.looks`, `wb`); `generated/instructions.md` is what the agent reads |
| `packages/agent/` | agent integration (chat transports, the worker client, the bridge client) |
| `bridge/` | Go server for external agents (MCP) |
| `e2e/` | Playwright specs for the studio; `scenes.ts` synthetic scenes |
| `tools/` | doc generation, lint checks, goldens, fixtures, `wgsl-check`, scripts |
| `docs/reference/` | generated reference docs (ops) |
| `ttmp/YYYY/MM/DD/CHB-NNN--…/` | tickets (section 5) |

---

## 5. How the work is organised

### Tickets and diaries (docmgr)

All work is tracked as tickets under `ttmp/`, managed with the `docmgr` CLI (`docmgr ticket list`,
`docmgr task list --ticket CHB-037`, `docmgr task check --ticket … --id …`, `docmgr doc add …`). A ticket folder
has `index.md`, `tasks.md`, `changelog.md`, `design-doc/` (plans), `diary/`, `reference/`, `playbook(s)/`,
`scripts/` (numbered, tracked), `sessions/` (persona sessions) and `various/` (screenshots, measurements). If you
don't have docmgr, the files are plain Markdown with YAML front matter; edit them by hand and keep the
`<!-- t:id -->` task markers.

Every substantial piece of work has a **diary in the "investigation" format**: numbered steps, each opening with
one or two paragraphs, then the sections *Prompt Context* (the request verbatim), *What I did*, *Why*, *What
worked*, *What didn't work* (exact commands and errors), *What I learned*, *What was tricky to build*, *What
warrants a second pair of eyes*, *What should be done in the future*, *Code review instructions*, *Technical
details*. Read the latest steps of a ticket's diary before touching its code. CHB-037 has a main diary and one per
phase (`diary/01…17`).

### Branches and merging

Work happens on `task/chb-NNN-…` branches (often in git worktrees), merged with `--no-ff` after `typecheck`, `lint`,
`gen:check`, `test`, the goldens and `test:browser` pass. Regenerate snapshots (`npx vitest run <file> -u`) and
generated docs (`pnpm gen`) instead of hand-merging them, and read their diffs.

### Privacy rules (important)

The photographer's material is **private family photographs and scans**. Rules:

- raw files (NEF, DNG, scans) are **never committed**; they live in the git-ignored `.playwright-mcp/` folder
  (`photos/`, `scans/`, `dng/`, `dngv/`);
- browser profiles of test sessions are git-ignored (`ttmp/**/sessions/*/profile/`);
- screenshots of the app showing these photos were committed **only inside ticket folders** (CHB-026 sessions,
  CHB-033 `various/shots/`) while the repository had no remote. Since CHB-037 sessions and walkthroughs use
  **synthetic material only** (`e2e/scenes.ts`). Treat the repository itself as private;
- nothing from the photos goes into public places (vault notes, issues, public repos);
- committed test fixtures are synthetic.

---

## 6. Test material

| What | Where on the owner's machines | Put it into |
|---|---|---|
| 33 Nikon D750 NEFs (digital photos, 2026-11-09…11) | `~/Downloads/2026-11-11 - manfred test bilder/` (Linux), `~/Dropbox/Photos/2026-11-11 - manfred test bilder/` (Mac) | `.playwright-mcp/photos/` |
| a 3-frame colour-negative strip `raw010.dng` | `~/Downloads/raw010.dng` | `.playwright-mcp/photos/` |
| Epson V600 / VueScan "Linear Raw" DNG scans + Negative Lab Pro positives | Mac `~/Dropbox/Photos/RAW/Scans/` (2,500 DNGs) | `.playwright-mcp/scans/` |
| Adobe DNG Converter DNGs of 4 NEFs, Adobe's stage-3 and renders | Mac `~/chromobench-tools/dng-out/`, `~/chromobench-tools/dngv/` | `.playwright-mcp/dng/`, `.playwright-mcp/dngv/` |

Ask the owner for access. The catalogue of what each file exercises is CHB-026 `reference/02-test-material.md`.
For tests and persona sessions, prefer the synthetic files of `node e2e/make-scenes.ts <dir>`.

---

## 7. WebGPU on an Apple Silicon Mac (M1 Pro): why it might not work

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
   On your own Mac you can run them locally against `http://localhost:<port>/`. Since CHB-034, Playwright's
   Chromium in **headless** mode gets the Metal adapter (`REAL_GPU=1 CI=1 pnpm test:browser` reports
   `apple metal-3`); a headed window is not needed.
9. **Low-level.** macOS version (WebGPU needs macOS 13+ in Chrome), low-power mode, and external display setups
   rarely matter on M1 Pro; if `chrome://gpu` shows "Metal" as the backend and WebGPU hardware accelerated but
   the app still says "requestDevice failed", report the message: it means a limit or feature the engine asks
   for (`packages/gpu/src/limits.ts`, `negotiate`) is not available.

On the owner's M1 Max the GPU engine works in Chrome over localhost (CHB-027 measurements). The failure seen during
handover was cause 1: the studio opened over plain http through Tailscale.

---

## 8. The RAW colour investigation (CHB-033): reproduce and continue on a Mac

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

## 9. Where the project stands and what's next

### Done (2026-11-14…15): CHB-037, the unified editing model

Phases P0 (goldens), P1 (`packages/values`), P5a (one immutable UI DSL), P2 (contract 1.0, reference engine,
conformance), P3/P3b (GPU on the contract: composite ops, blend modes, coalesced heal, GPU `output.frame`, exact
tiled export with halos), P4 (one history), P5b (the stack kit, the stage policy pass, the arrangements), P6 (the
agent's DSL and workbench), P7 (links: looks, rolls, presets, sync), P8 (Editor lab's tools in both engines and their
editors), P9 (integration: the browser suite on SwiftShader and Metal, end-to-end walkthroughs, the persona session
on the two arrangements, agent layouts and looks persisted, this guide). The integration report is
`ttmp/2026/11/14/CHB-037--…/reference/02-integration-report.md`.

### Decisions taken

- **First-print colour aim for scans** (CHB-026 F30): neutral grey (`FIRST_PRINT_AIM` alpha 1,
  `apps/studio/src/host/first-print.ts`). The Roll module's `ALPHA = 0.75` keeps a quarter of each frame's cast.
- **RAW colour** (CHB-033): ours stays (the camera's colour matrix); no Adobe look table.
- **No backwards compatibility** for saved edits across the CHB-037 cut-off (2026-11-14).

### Open, for the owner (design §38 and the integration report)

1. The default arrangement — the persona session's recommendation is in the integration report.
2. Whether the scene stage for camera files is wanted (it exists: the Scene module in Classic).
3. Whether selections are wanted.
4. Whether "sync" defaults to copying values or to linking (today: copy).
5. Whether the darkroom stack shows his order or groups by kind (today: the Enlarger groups by kind).
6. Medium presets: the film-stock and grade looks were deleted with the cut-off (media have no group form).

### Next, in order

1. The CHB-037 tasks added by P9 (`docmgr task list --ticket CHB-037`): the persona session's findings.
2. Exact export speed on the GPU: the 4000 px darkroom export doubled with exact tiling (~1650 ms); plan haloed tiles
   from the DAG's real peak of live textures and build an export's fields in one pass (P3b diary, "future").
3. CHB-033 continuation (section 8); CHB-013 calibration with the photographer's own setup.
4. Other open tickets, each with its own plan and tasks: CHB-004 (data pipeline, licence), CHB-008 (agent
   integration), CHB-010, CHB-011 (output and colour management), CHB-020/021/022 leftovers. CHB-014 (B&W) and
   CHB-015 (extensions) are parked.

After each user-visible change, a **persona session** (CHB-026 `playbooks/01-cosplay-session-protocol.md`) has been
the way to find what a photographer would trip over.

---

## 9b. Diagnostics and problem reports (CHB-038)

Ticket `ttmp/2026/11/15/CHB-038--…/` (spec `design-doc/01-…`, implementation diary `diary/02-diagnostics-implementation.md`).

- **The journal.** One per page (`packages/shell/src/core/journal.ts`): every source writes structured rows with dedupe
  and counts — the console and uncaught errors (shell capture layers), the runtime (commands, log entries, renders,
  refusals), the GPU devices (`GpuRuntime` events: the device with adapter, features and limits, every uncaptured
  validation/out-of-memory/internal error with the node the engine ran last, losses, recreations; the presenter's
  device likewise), the engine worker (`{ id: 0, log }` messages), LibRaw's worker, the service worker (its version:
  `public/sw.js` answers `{ type: 'version' }`; no answer means an older build). Its tail is kept in the KV
  (`settings/diagnostics-journal`), so a report after a reload or a crash has the earlier session. `?debug` keeps every
  render and wraps every GPU queue submit in error scopes.
- **The photographer** sees a quiet red pill in the status line ("2 problems") when errors happened; it opens Help ▸
  Diagnostics… (the rows, newest first, ×N, filter by level and source, Copy, Clear, Report a Problem…). Help ▸
  Report a Problem… is one dialog: "What happened?", what is always in it (the journal, this computer's browser and
  graphics card, the settings), and three choices with their sizes — his edits (on), small pictures (on), the original
  files (off). Save the report… downloads one `chromobench-report-<date>-<time>-<session>.zip`; Copy summary puts a few
  lines on the clipboard. Nothing is sent by the studio.
- **The owner** opens a report with File ▸ Open Report… or by dropping the zip on the studio: the environment, his
  description, the journal's errors and warnings, each frame with its picture and steps; "Open the photos with their
  edits" (when the originals are in it) opens them with their documents and history in the log (the saved edit goes to
  the KV under the file's key and the file opens as it was). The zip's `README.txt`, `journal.txt` and
  `environment.json` are readable without the studio.
- **The agent** reads it: `await wb.diagnostics({ level: 'warn', source: 'gpu' })`, `.explain()`.
- **The owner's WebGPU error** ("Destroyed texture [Texture (unlabeled 160x107 px, RGBA32Float)] used in a submit") was a
  use-after-destroy in the film grain (a thumbnail and the viewer rendering a camera file's grain in lockstep); fixed
  by `GpuRuntime.busy/retire` (destruction deferred while engine work is in flight) and a texture of ones per size;
  regression tests in `e2e/diagnostics.spec.ts`. Every GPU object is labelled now, so the next such error names its
  owner. Open: E_GPU_OOM with two 24 MP camera files at 4000 px (the source textures fill the 512 MB budget).
- **Capturing an error in your own Chrome:** reproduce it, then Help ▸ Report a Problem… (tick the originals if the
  files may matter) and send the zip, or `node tools/scripts/console-capture.ts <url> --sequence --files a.NEF b.NEF`
  headless.

## 10. Things that live outside the repository

| What | Where | How to recreate |
|---|---|---|
| Private photos and scans | owner's machines | ask the owner (section 6) |
| Adobe DNG Converter, `dng_validate`, `acr3-tone.json` | owner's Mac `~/chromobench-tools/`, `.playwright-mcp/dng/` | section 8 |
| Camera Raw test sidecar and script | `ttmp/…/CHB-033…/scripts/acr/` (in the repo) | needs a licensed Photoshop |
| Obsidian project note | the owner's vault | not needed to work |
| Preview builds for testers (`apps/studio/dist-current/`) | git-ignored | `pnpm --filter @chromobench/studio exec vite build --outDir dist-current` |
