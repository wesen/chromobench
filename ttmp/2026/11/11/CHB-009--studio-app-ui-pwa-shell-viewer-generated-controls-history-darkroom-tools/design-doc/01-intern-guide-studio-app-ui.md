---
Title: 'Intern guide: Studio app UI'
Ticket: CHB-009
Status: active
Topics:
    - ui
    - product
    - darkroom
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/design-doc/01-chromobench-architecture-and-work-plan.md
      Note: shared contracts (registry/ArgSpec.ui, recipe, mutations, edit log, Engine), M1 walking skeleton
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: §2.6–2.8 printer points, CC coupling matrix, neutral pack, grey-card golden numbers
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/chromogen-studio-1.2/samples/gold200.png
      Note: sample scan for the M1 fixture and manual testing
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-chromogen-studio.md
      Note: §5 layout, keyboard, export and persistence of the Chromogen UI
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-filmbench-ide.md
      Note: §1 views and layouts, §2 control plane summary, §6 unfinished parts
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/05-inline.js
      Note: SLIDERS schema (1003–1597), React UI (4514–5199), render queue/undo/ring-around/probe (4056–4347)
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/01-inline.js
      Note: control plane with widgets, macros, why() (1796–2117), draft paint scheduler (3836–3857), history view with approvals (4399–4415)
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/vfs/controls.js
      Note: darkroom/engineer/colourist control schemes and the missing mask editor
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:24.380508133-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Studio app UI

This guide is for the engineer who builds CHB-009, `apps/studio`, the application the photographer uses. It assumes you have read the shared map, `design-doc/01-chromobench-architecture-and-work-plan.md` in the CHB-001 ticket ("the architecture doc"), at least §1, §3, §4, §5 and §8. Paths starting with `C1/` are relative to the CHB-001 ticket directory, `ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`. Everything under `packages/`, `apps/` and `bridge/` is planned and does not exist yet.

## 1. What this ticket builds

The studio is a darkroom in a browser tab. The photographer opens a folder of negative scans, picks a frame from the film strip, and prints it: they choose a paper, set an exposure time, dial filtration, look at the result, measure it with a densitometer, run a test strip, dodge a face and burn a sky. Every change is recorded and can be undone. An agent can help through a chat panel, and its changes appear in the same history, waiting for approval when the photographer wants that.

The studio does none of the physics. It edits a **recipe** through **mutations** and asks an **Engine** to render the compiled recipe (architecture doc §5). That separation is what lets this ticket be built now, against `engine-mock`, while the real physics (CHB-003) and the GPU engine (CHB-005) are written in parallel.

This ticket builds, in six stages:

1. **The shell:** an installable PWA that works offline; a library over a folder of scans through the File System Access API, with a fallback; OPFS for caches and working images; IndexedDB for recipes; projects, rolls and a film strip.
2. **The viewer:** a WebGPU canvas in the `display-p3` colour space; before/after; zoom and pan with progressive rendering; a densitometer probe; views of the print, the negative, the dyes, and the base and gamut classes.
3. **Controls generated from the op registry**, in darkroom units: printer points, CC, seconds, f-stops.
4. **History:** undo and redo from the edit log, agent approvals, provenance through `why(path)`, snapshots.
5. **Darkroom tool UIs:** test strip, ring-around, contact sheet, mask painting with gradients and ellipses, and an exposure list for main, dodge, burn, flash and split exposures. These are specified against mock ops; CHB-010 implements the engine side.
6. **Accessibility, keyboard shortcuts and the chat panel.**

Out of scope: the physics and the darkroom ops (CHB-003, CHB-010), decoding and scan conditioning (CHB-006), the DSL (CHB-007), the agent loop and the bridge (CHB-008; this ticket renders what CHB-008's chat session emits), and export and soft proofing (CHB-011).

## 2. Background you need

### 2.1 The colour darkroom, for an engineer

A colour negative is printed with an **enlarger**: a lamp shines through a filter head and the negative, and a lens focuses the image onto colour paper. Paper is a second negative material: more light makes it darker. Three paper layers respond to red, green and blue light and form cyan, magenta and yellow dye. The photographer controls:

- **Exposure time** (seconds) and **aperture** (f-number N, where the light on the paper goes as 1/N²). Doubling the time or opening the lens by one stop doubles the exposure.
- **Filtration:** cyan, magenta and yellow dichroic filters in the head, in **CC** units (1 CC = 0.01 density in the filter's band). Filtration is subtractive: more yellow filtration removes blue light, the blue-sensitive layer forms less yellow dye, and the print turns bluer. More magenta makes it greener; more cyan makes it redder.
- **Printer lights:** the motion-picture laboratory equivalent of filtration, expressed directly as shifts of the paper's log exposure per layer, in **points** of 0.025 log H (architecture doc §4).
- **Local exposure:** **dodging** holds light back from part of the picture during the main exposure (that area prints lighter); **burning** adds light to an area afterwards (it prints darker); **flashing** gives the whole sheet a weak uniform exposure without the negative, which lifts the paper's toe and softens highlights; a **split** exposure uses two exposures with different filtration.
- **Test strips and ring-arounds:** a test strip exposes bands of one sheet at increasing exposures to find the right time; a ring-around prints the same picture with small filtration changes in each colour direction to find the right balance; a **contact sheet** prints a whole roll at once to compare frames.

Darkroom printers think in ratios, because equal ratios of light look like equal steps. The units the controls use, with the numbers you will test against:

| Quantity | Stored as | Shown as | Conversion | Example |
|---|---|---|---|---|
| Printer lights | log H per layer | points | 1 pt = 0.025 log H | +4 pt = +0.10 log H |
| Exposure change | log H | stops | 1 stop = 0.30103 log H ≈ 12.04 pt | +1/3 stop = +0.1003 log H ≈ +4.0 pt |
| Time | seconds | seconds, stepped in fractions of a stop | t·2^(k·step) | 12.0 s +1/3 stop = 15.12 s; +1/6 stop = 13.47 s |
| Aperture | f-number | f-number, third-stop series | 1 stop = factor √2 in N | f/8 → f/11 = 2·log₁₀(8/11) = −0.277 log H ≈ −0.92 stop (nominal f/11 is rounded from 11.31) |
| Filtration | CC | CC | identity | if a filter band covered exactly one paper layer, v CC would shift that layer by −v/100 log H, i.e. 0.4 pt per CC (textbook §2.6) |

The textbook (`C1/sources/The Mathematics of the Colour Negative.md` §2.6) gives the real coupling of filters to paper layers for Portra 400 printed on Portra Endura, per CC, rows the paper layers (red-, green-, blue-sensitive), columns the filters (C, M, Y):

```text
∂x/∂v = [ −0.0092  −0.0007   0.0000 ]      after mid-grey normalisation:   [ −0.0061   0.0024   0.0038 ]
        [  0.0000  −0.0087  −0.0016 ]                                      [  0.0031  −0.0056   0.0023 ]
        [  0.0000   0.0000  −0.0100 ]                                      [  0.0031   0.0031  −0.0061 ]
```

So +10 CC of yellow moves the paper log exposure by (0, −0.016, −0.100) log H, about (0, −0.6, −4.0) points, in a real enlarger, and by (+1.5, +0.9, −2.4) points when spektrafilm's mid-grey normalisation keeps density fixed. The neutral filter pack for that pair is C 0, M 51.57, Y 52.53. The textbook also says that +10 points of red alone turns the grey card cyan (a* = −20.7) and darkens it from 0.746 to 0.956 (§2.7, "Try it"), and that with the default settings the grey card prints at visual density 0.755. These numbers return in the tests (section 8).

### 2.2 Colour on the screen

The print is a reflective object: its brightest possible value is the paper white. So the viewer is a standard-dynamic-range display problem, but a wide-gamut one: colour paper dyes reach colours outside sRGB. Most current Macs and many PC monitors cover the **Display P3** gamut, and the browser can draw into a P3 canvas.

- A WebGPU canvas is configured with `context.configure({ device, format, colorSpace, alphaMode, toneMapping })`. `colorSpace` is `'srgb'` (default) or `'display-p3'`; `format` may be `'bgra8unorm'`, `'rgba8unorm'` or `'rgba16float'`; `toneMapping.mode` is `'standard'` (values clamped to the screen's SDR range) or `'extended'` (HDR headroom, Chrome 129+ on some platforms) (MDN, `GPUCanvasContext.configure()`; Chrome "What's new in WebGPU 129").
- The values written must already be **encoded** for Display P3 (P3 primaries with the sRGB transfer curve). Producing them is the engine's job: the viewer asks for an `output.display` node that targets the screen.
- A 16-bit float canvas avoids the banding that 8-bit storage of wide-gamut values can show in smooth gradients such as skies. Prints never exceed paper white, so `'standard'` tone mapping is correct.
- Colours that even P3 cannot show are compressed by the engine's gamut step, which is the last colour step (architecture doc §2). The viewer never clips silently; the "base and gamut" view shows where compression happened.

The screen surround matters to a printer: a bright, saturated UI around the picture changes how its colours and densities look. The studio uses a neutral, dim surround and neutral greys in its chrome.

### 2.3 The browser as a local-first platform

| Platform piece | What it gives | Limits that shape the design |
|---|---|---|
| **PWA** (manifest + service worker) | install as an app, start offline, cache the app shell | service workers need a secure context; `http://127.0.0.1` and `localhost` count as secure, so the bridge-served app (CHB-008) can use one |
| **File System Access API** | `showDirectoryPicker()` returns a directory handle; handles can be stored in IndexedDB and re-used next session after `requestPermission()` | the pickers exist in Chromium browsers only; Firefox's vendor position is negative and Safari's is "oppose" (caniuse; web-features explorer). Re-granting permission needs a user gesture |
| **OPFS** (origin private file system, `navigator.storage.getDirectory()`) | a private, fast file system per origin; `createSyncAccessHandle()` in workers gives synchronous reads and writes | Baseline in all major browsers since March 2023; sync handles only in workers; invisible to the user |
| **IndexedDB** | transactional structured storage | not for large binary blobs at high write rates |
| **Storage quota** | `navigator.storage.estimate()`, `navigator.storage.persist()` | without `persist()`, the browser may evict data under pressure |

The consequence: Chromium is the first-class browser for the beta. Other browsers work through an import fallback (section 5.5).

## 3. Where this sits in the system

```text
 ┌──────────────────────────────── apps/studio (this ticket) ────────────────────────────────────┐
 │  React components (thin)                                                                       │
 │   library · film strip · viewer · controls · history · tools · chat panel                     │
 │        │ subscribe (selectors)                     ▲ events                                    │
 │  core (framework-free TypeScript)                  │                                           │
 │   LibraryStore  FrameSession(edit log + draft)  ViewerStore  GestureController  RenderScheduler│
 │        │ append(Mutation)        │ compile(recipe)         │ evaluate/measure       │ present  │
 └────────┼─────────────────────────┼─────────────────────────┼────────────────────────┼──────────┘
          ▼                         ▼                         ▼                        ▼
   @chromobench/contract     @chromobench/contract      Engine: mock (002) →       Presenter:
   edit log, recipe (002)    compile, registry (002)    reference (003) → gpu (005)  WebGPU P3 canvas
          ▲                                                                            
          │ the same edit log
   packages/agent (CHB-008): EvalHost commits agent mutations · ChatSession for the chat panel
```

**Contracts consumed:** `FrameRecipe`, `Mutation`, `LoggedMutation`, the edit log (fold, undo/redo cursor, state hash, `why(path)`, ask mode), `OpDef`/`ArgSpec` (for generated controls), `compile(recipe, frameId)`, `NodeRef`, the `Engine` interface (`open`, `evaluate`, `measure`, `prepare`), `EvalTarget`, `Domain`, `Unit`. Gaps are proposed in section 9.

**Dependencies and dependants:**

| Ticket | Relation | What crosses |
|---|---|---|
| CHB-002 | depends on | contract types, edit log, `compile`, mock engine and mock catalog |
| CHB-006 | depends on (later) | decoding, hashing and thumbnails of real files; until then the mock engine opens fixtures |
| CHB-007/008 | used by and uses | agent mutations arrive in the same edit log; the chat panel renders CHB-008's `ChatSession` |
| CHB-005 | swaps in behind | the GPU engine; ideally shares the viewer's `GPUDevice` |
| CHB-010 | depends on this | needs the tool UIs, mask editor and exposure list built here; implements their ops |
| CHB-011 | adjacent | export dialogs and soft proofing use the viewer's presenter |

**What lets it proceed in parallel.** The mock engine implements every catalog op with deterministic trivial maths, and the mock catalog carries `ArgSpec.ui` metadata, so controls, rendering, history and tools all work end to end before any physics exists. Milestone M1 ("walking skeleton", architecture doc §8.2) is exactly this: a 16-bit TIFF opens, goes through mock inversion and a mock print to the screen, and is editable from the UI and the DSL with undo.

## 4. What exists today and what to take from it

### 4.1 Chromogen Studio's UI

Chromogen Studio 1.2 (`C1/various/extracted/chromogen-studio/05-inline.js`; report `C1/various/analysis-chromogen-studio.md` §5) is a working scan-to-print app with a React 18 UI written as `React.createElement` calls without a JSX build (lines 4514–5199). Its layout: a top bar with mode (Develop, Ring-around, Source), view (Print, Negative, Dyes, Base & gamut), before/after and grey pick; a left panel with a print-window histogram, printer lights, source summary, compute, snapshots and history; the canvas in the centre with a hover readout; slider sections on the right; a film strip at the bottom (analysis §5.1).

| Lines | What | Take, fix or leave |
|---|---|---|
| 995–1002, 1003–1597 | `SECTIONS` and `SLIDERS`: each control carries `id, label, section, kind (macro/operator/hybrid), domain, cost (free/rebuild/spatial), unit, min, max, step, def, fmt, aside, what, maths, chapter` | **take the idea** into `ArgSpec.ui`: `aside` (a second readout in another unit, e.g. stops shown with their points) and `what` (tooltip). `cost` corresponds to the registry's `binding` |
| 4518–4537 | `Slider`: `onChange` sets without committing, `onPointerUp`/`onKeyUp` commit; double-click on the label resets; "changed" styling when not default | **take** commit-on-release and reset-on-double-click; **fix** one commit per key-up (bursts of arrow keys become many undo steps) |
| 4538–4581 | `Pad` (2-D colour pad) and `Hues` | take the pad as the printer-lights colour widget |
| 4808–4823 | `PrintWindow`: histogram of paper log H per layer against the paper's toe and shoulder, with the percentage clipped | take as a panel; needs `measure.histogram` on `paper-logH` |
| 4824–4831 | `Lights`: points relative to the aim, per contribution | take into the printer-lights group |
| 4845–4865 | `Snapshots` (compare, restore, delete) and `History` (undo, redo, last labels) | take snapshots; history is rebuilt on the edit log |
| 4916–4982 | `CanvasView`: `ResizeObserver` sizes the canvas in device pixels; hover readout throttled to 60 ms; split drag; file drop | take; the readout fields (x, y; dyes; base class; printing density; paper log H; print L*a*b*) define our densitometer |
| 4983–4990 | `BaseLegend` and `BASE_TEXT`: blank film, below base, out of gamut, explained in words with numbers | take the wording |
| 4991–5017, 4330–4347 | `RingView` and `renderRing`: six colour moves on a 3×3 hexagonal grid plus density steps at ±1 and ±2; step 2, 4 or 8 points; click applies | take; the layout is section 5.9 |
| 5104–5148 | `Bar` and `Strip` | take the structure |
| 5161–5199 | `App`, keyboard: Ctrl/Cmd-Z undo, Shift redo, `\` before/after, `g` grey pick, `r` ring-around, `s` snapshot, `b` book, Esc | take the keys (section 5.10) |
| 4056–4104 | `queue()` coalesces renders into one `requestAnimationFrame`; if the renderer is busy it retries after 150 ms | **replace** with a scheduler that cancels superseded work (section 5.6) |
| 4136–4191 | `set()` keeps an `editStart` snapshot during a drag; undo and redo swap whole settings objects, 200 entries in memory | **replace** with the edit log |
| 4200–4206, 3955–3956 | autosave to `localStorage["cgstudio:<frame name>"]`, merged back when a file with the **same name** is opened | **leave**: key by content hash, store in IndexedDB |

### 4.2 Filmbench IDE's control plane and views

Filmbench (`C1/various/extracted/filmbench-ide/01-inline.js`; report `C1/various/analysis-filmbench-ide.md`) is an IDE, not a darkroom app, but its control plane is the most developed design for generated controls and provenance.

| Lines | What | Take, fix or leave |
|---|---|---|
| 1806–1818 | `applyOp`: layer operations `set`, `add`, `mul`, `stops`, `keep` with opacity | leave (see the decision record on layers in 5.7) |
| 1820–1878 | `ParamStore`: a base value plus ordered layers `look → macros → agent → pin`; `why(path)` prints how a value was resolved, step by step | **take** the `why` presentation; our provenance comes from the edit log |
| 1890–1968 | `Macro`: one gesture drives several parameters (`drives` with `gain`, `curve`, `map`, `stops`), with `calibrate()` to make a macro linear in a measurement | take the idea of compound gestures; calibration is a later refinement |
| 1971–2027 | `Control`: `.label .unit .range .step .detents .fmt .widget .requires .opens .disabledWhen`; ten widget kinds | **take** this vocabulary as the shape of a generated control |
| 2030–2047 | `Scheme.audit()`: checks every control's path exists and mapped values are in range | take as a test of hand-arranged control groups |
| 2085–2117 | `ctl.fromSpec()`: an "engineer" scheme generated from the parameter table | take: the "all parameters" arrangement is generated |
| `vfs/controls.js` 1–97 | three schemes over one state: engineer, darkroom (print stops dial, filters ±40 CC in 1 CC steps with a detent at 0, grade stepper, paper surface choice), colourist (warmth, tint, saturation, a colour-balance wheel); a "dodge and burn" button that opens a mask editor which does not exist (line 70) | take the darkroom arrangement; **build** the missing mask editor (section 5.9) |
| 2323–2337 | `wb.apply`: in ask mode agent mutations queue as pending; consecutive `param.set` on the same path by the same author within 900 ms coalesce into one undo step | take the coalescing window for keyboard bursts |
| 3836–3857 | paint scheduler: a dirty flag and a loop over visible views; while a slider, ruler, wheel or fader is held, views paint as drafts; pointer-up requests a full paint | take the draft-while-dragging idea; add cancellation |
| 4399–4415 | History view: a "waiting for your approval" section with Approve, Skip and Approve all; state hash and log hash; mutations newest first | take |
| 4915–4936 | ten views in a tiling dock with five preset layouts | leave the docking for v0: a fixed layout with collapsible panels |

### 4.3 What to leave behind

- Global objects for state (`window.studio`, Filmbench's `V2.by`). State lives in stores; agent writes go through CHB-008's host.
- Identity by file name. Frames are identified by the SHA-256 of their bytes (architecture doc §4, "Source").
- `localStorage` for anything but small preferences.
- The book reader and the `st:` command links of Chromogen (5104, 4370–4442); chromobench's guides are separate documents, though in-app links that focus a control (Filmbench's `ide:param/...` links in its agent prompt) are worth keeping for the chat.

## 5. Design

### 5.1 Decision record: the UI framework

- *Context.* The studio has two kinds of UI work. Most of it is ordinary application UI: panels, lists, forms, dialogs, accessible sliders. A small part is hot: the canvas, the probe readout and the control being dragged update at frame rate. Chromogen used React 18; Filmbench used hand-written DOM code (`el()` helpers and manual repainting across about 2000 lines of UI).
- *Alternatives.*

  | Option | For | Against |
  |---|---|---|
  | React 19 + TypeScript + Vite | Chromogen's components port directly; largest ecosystem: React Aria Components (accessible sliders, focus management, keyboard handling), Testing Library, Storybook; the team's existing patterns (Go + React SPA embedding, themable Storybook components); `useSyncExternalStore` connects framework-free stores | high-frequency values must be kept out of React state, or whole panels re-render |
  | Preact + signals | small, React-like API, fine-grained updates | smaller accessibility ecosystem; compatibility layer for React libraries |
  | SolidJS | fine-grained reactivity suits sliders | port is a rewrite; fewer accessible primitives |
  | Svelte 5 | compiled, small, reactive | port is a rewrite; different component and test tooling |
  | Lit / web components | standards-based | state management and accessibility primitives are hand-built |
  | Plain DOM (Filmbench) | no dependencies | everything hand-built; Filmbench shows the size of that |

- *Decision.* React 19 with TypeScript and Vite, React Aria Components for interactive widgets, and a **framework-free core** (`apps/studio/src/core/`) that holds all state, the render scheduler, the gesture controller and the presenter. React components only subscribe to the core through selectors and call its methods.
- *Consequences.* The core is testable in Vitest without a DOM. The canvas and the active control never go through a React render on each pointer move. A component that needs one value subscribes to that value only. If the framework choice is ever revisited, the core survives.
- *Status.* Proposed. Needs a short spike (stage 1) measuring a drag on the mock engine: pointer move to presented frame.

### 5.2 Module layout

```text
apps/studio/
  index.html, vite.config.ts (vite-plugin-pwa), tsconfig.json
  public/manifest.webmanifest, icons/
  src/
    main.tsx                    boot: open storage, create core, render <App/>
    core/                       framework-free; no React imports
      library.ts                LibraryStore: projects, rolls, frames, folder handles
      frame-session.ts          FrameSession: edit log, draft overlay, effective recipe, compiled node, snapshots
      gesture.ts                GestureController: draft → commit, tx ids
      viewer.ts                 ViewerStore: viewport, view mode, split, probes
      scheduler.ts              RenderScheduler: draft/screen/refine passes, latest request wins
      presenter-webgpu.ts       WebGPU P3 presenter; presenter-2d.ts fallback
      probe.ts                  densitometer requests (latest wins)
      units.ts                  storage ↔ display units, formatting, asides
      controls.ts               generateControls(registry) → ControlModel[]
      history.ts                grouping, labels, why() formatting
      keyboard.ts               shortcut map
    storage/
      db.ts                     IndexedDB schema and migrations (idb)
      opfs.ts                   cache layout, quota, eviction
      fsa.ts                    directory handles, permissions, fallback input
    ui/                         React components
      App.tsx, TopBar.tsx, FilmStrip.tsx, LibraryPanel.tsx
      viewer/ Viewer.tsx, ProbeReadout.tsx, ViewSwitch.tsx, SplitHandle.tsx
      controls/ ControlPanel.tsx, Slider.tsx, Stepper.tsx, LightsPad.tsx, darkroom-arrangement.ts
      history/ HistoryPanel.tsx, PendingCard.tsx, WhyPopover.tsx, Snapshots.tsx
      tools/ TestStrip.tsx, RingAround.tsx, ContactSheet.tsx, MaskEditor.tsx, ExposureList.tsx
      chat/ ChatPanel.tsx, StepCard.tsx, ApprovalCard.tsx
  test/ (vitest), e2e/ (playwright)
```

### 5.3 Layout

The default layout on a desktop screen (≥ 1280 CSS px wide):

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ Chromobench │ Summer '75 ▸ Roll 1975-07 ▸ 12 scan_12.tif │ Print Neg Dyes Base │ B/A │ ↶ ↷ │ Ask ▾ │
├────────────────┬───────────────────────────────────────────────────────────┬──────────────────┤
│ ▾ LIBRARY      │                                                           │ Controls Tools Chat│
│  Summer '75    │                                                           │ EXPOSURE          │
│   ▸ Roll 1975-07│                                                          │  Time  12.0 s  ◂▸ │
│ ▾ HISTORY      │                                                           │  Lens  f/8        │
│  ◆ Agent  time │                                                           │ FILTRATION        │
│    12.0→15.1 s │                 viewer (WebGPU, Display P3)               │  Y  52.5 CC ──●── │
│    [✓] [✗]     │                 neutral grey surround                     │  M  51.6 CC ──●── │
│  ● You  Y +10  │                                                           │  C   0.0 CC ●──── │
│  ● You  paper  │                                                           │ PRINTER LIGHTS    │
│ ▾ SNAPSHOTS    │                                                           │  pad ◎  R+0 G+4 B−2│
│  A · B         │                                                           │ PAPER             │
│                ├───────────────────────────────────────────────────────────┤  Endura ▾ grade 2 │
│                │ x 1820 y 1204 · dyes .69 .70 .86 · PD .. · logH −0.6 +0.1 −0.2 pt · L* 52 a* −0.4 b* 1.2 · D 0.76 │
├────────────────┴───────────────────────────────────────────────────────────┴──────────────────┤
│ ◀ [01][02][03][04][05]…[11][12▣][13][14] … [36] ▶        ● edited  ◆ pending  ▲ gamut 2.1 %   │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** breadcrumb (project, roll, frame), view switch, before/after, undo/redo, the agent mode (read-only, ask, auto), which only the photographer can change.
- **Left panel:** library tree, history with pending agent changes, snapshots. Collapsible.
- **Centre:** the viewer and, under it, the densitometer readout line.
- **Right panel:** three tabs. *Controls* (generated, darkroom arrangement by default), *Tools* (test strip, ring-around, contact sheet, masks, exposures), *Chat*.
- **Bottom:** the film strip of the current roll with badges.

Below 1280 px the side panels become drawers over the viewer; below 1024 px the studio shows a notice that it is designed for larger screens. The darkroom is a desktop tool; a phone layout is not a goal.

When a darkroom tool is active, it replaces the viewer's content and the right panel shows the tool's parameters:

```text
┌ viewer: test strip ──────────────────────────────────────┐ ┌ TEST STRIP ─────────────────┐
│ ┌────────┬────────┬────────┬────────┬────────┐           │ │ Vary   (●) time  ( ) Y      │
│ │ 7.56 s │ 9.52 s │ 12.0 s │ 15.12 s│ 19.05 s│           │ │        ( ) M     ( ) C      │
│ │        │        │  now   │        │        │           │ │ Step   1/6 [1/3] 1/2  1 st  │
│ │ D 0.52 │ D 0.63 │ D 0.69 │ D 0.75 │ D 0.84 │           │ │ Count  5  ◂▸                │
│ └────────┴────────┴────────┴────────┴────────┘           │ │ Probe  grey ▾               │
│ click a band to use its value       (densities illustrative)│ │ [ Use 15.12 s ]           │
└──────────────────────────────────────────────────────────┘ └─────────────────────────────┘
```

### 5.4 State and data flow

The **core** owns these stores:

- `LibraryStore`: projects, rolls, frames, folder handles. Backed by IndexedDB.
- `FrameSession`, one per open frame: the frame's edit log (CHB-002), a **draft overlay** (values being dragged, not yet logged), the effective recipe, the compiled node, snapshots and probes.
- `ViewerStore`: viewport, view mode, split position, probe positions, presenter status.
- `RenderScheduler` and `ProbeService`: talk to the Engine.
- `AgentStore`: the agent mode and CHB-008's chat sessions.

React components read them with a selector hook built on `useSyncExternalStore`, so a component re-renders only when its selected value changes.

The data flow from a control change to the canvas, with concrete values. The photographer drags the yellow filtration slider from the neutral pack's 52.5 CC to 62.5 CC. The frame is a 6000-pixel-wide scan fitted to a canvas 2800 device pixels wide, so the screen scale is 2800 / 6000 ≈ 0.47; a draft at scale 0.12 is about 720 × 480 pixels.

```text
pointerdown on "Yellow"
  GestureController.begin('print.enlarger.filtration.y')                 → gesture g-17
pointermove (many; the core handles at most one per animation frame)
  GestureController.preview(57.5) … preview(62.5)                        → FrameSession.draft = { 'print.enlarger.filtration.y': 62.5 }
  FrameSession.effective = fold(editLog) ⊕ draft                          (structural sharing; nothing logged)
  compile(effective, 'frame_0042') → NodeRef #c41e…                       (hash-consed: unchanged subgraphs keep their ids)
  RenderScheduler.request({ node: #c41e…, pass: 'draft' })               → Engine.evaluate(#c41e…, { scale: 0.12, region, precision: 'preview' })
  Presenter.present(result)                                              → WebGPU canvas, display-p3
  Slider readout: "62.5 CC"   aside: "≈ −4.0 pt B"
pointerup
  GestureController.commit()
    → editLog.append({ op: 'set', path: 'print.enlarger.filtration.y', value: 62.5 }, by: 'user', tx: 'g-17')
    → draft cleared; effective recipe = fold(editLog); state hash 3f9a… → 77c0…
  compile(…) → the same #c41e… as the last draft                          → cache hit for the draft; schedule the 'screen' pass
  RenderScheduler.request({ node: #c41e…, pass: 'screen' })              → Engine.evaluate(#c41e…, { scale: 0.47, region, precision: 'preview' })
  HistoryPanel shows "You · Yellow 52.5 → 62.5 CC"
```

What to notice:

- **The draft never enters the edit log.** A drag of 120 pointer events produces one mutation and one undo step. Pressing Esc during the drag clears the draft and logs nothing.
- **The recipe is the fold of the log plus the draft.** The engine never knows whether a value is a draft.
- **Hash-consing makes the commit cheap.** The node committed is the same node the last draft rendered, so the engine's cache (keyed by node, scale and region) already holds the draft-scale image.
- **Agent mutations arrive by the same route.** CHB-008's host appends to the same edit log; the core notices the head moved, recompiles and schedules a render. The UI does not care who wrote.

**Decision record: commit on release, with an unlogged draft overlay.**

- *Context.* A drag produces dozens of values per second. Chromogen kept an `editStart` snapshot and committed on pointer-up (4136–4160); Filmbench applied every value and coalesced `param.set` entries within 900 ms (2329–2337).
- *Alternatives.* (a) Log every value and coalesce; (b) log on release, preview through an overlay.
- *Decision.* (b), with one refinement: keyboard and wheel changes are logged per step but share a `tx` id while they arrive within 800 ms on the same control, so undo removes the whole burst.
- *Consequences.* The edit log stays readable and small; undo is one step per gesture; the agent never sees half a drag; the overlay must be part of every recipe read the UI makes (including the probe and the tools).
- *Status.* Proposed.

### 5.5 Stage 1: the shell

#### The PWA

`vite-plugin-pwa` (Workbox) generates the service worker:

- **Precache** the app shell: HTML, JavaScript and CSS bundles with content hashes, icons, and the WASM modules the studio needs to open files (LibRaw and lcms2 builds arrive from CHB-006 and CHB-011; precache them or cache them on first use).
- **Runtime-cache** data packs (CHB-004: stocks, CIE tables, lamps) with a cache-first strategy. Their URLs carry a content hash, so a cached pack never goes stale.
- **Updates:** when a new service worker is waiting, show "A new version is ready; reload when convenient". Never reload during an edit.
- **Offline:** everything except the chat and external agents works offline. The top bar shows an "offline ready" state once the precache is complete.

The manifest declares `display: standalone`, icons and a `start_url`. Chromium's `file_handlers` manifest member (with the `launchQueue` API) can later let the installed app open `.tif` files from the desktop; it is optional.

#### The library

A **project** groups rolls that share defaults (paper, lamp, scanner model). A **roll** is one strip of film: its frames share a stock, a scanner, often a flat field and a rebate position. A **frame** is one picture (architecture doc §4), identified by the SHA-256 of its source bytes.

Adding a folder in Chromium:

1. "Add folder…" calls `showDirectoryPicker({ id: 'scans', mode: 'read' })` and stores the handle in IndexedDB (`handles` store).
2. The library enumerates entries (`for await (const [name, h] of dir.entries())`), keeps supported extensions (TIFF, DNG, PNG, JPEG now; camera RAW extensions once CHB-006's LibRaw build lands), and creates frames with a **provisional key** (relative path, size, `lastModified`).
3. A worker (CHB-006) computes the SHA-256 incrementally and a mock-engine thumbnail; when the hash is known the frame's identity is final. If a recipe exists for that hash (the same file in another folder, or renamed), it is re-attached.
4. On the next launch, `handle.queryPermission({ mode: 'read' })` usually returns `'prompt'`; the library shows "Reconnect Summer '75" and calls `requestPermission()` on click.

The fallback for browsers without the pickers:

- `<input type="file" webkitdirectory multiple>` gives `File` objects for the current session.
- The photographer chooses per roll: "Use for this session" (frames show as disconnected after reload until picked again; identity by hash re-attaches recipes) or "Import into Chromobench" (files are copied into OPFS under `imports/`; the dialog states the size, because a roll of 36 scans at 100 MB each is 3.6 GB).
- A third route, the bridge serving a scan folder to the page, is an open question shared with CHB-008 (section 10).

**Decision record: library access.** *Context:* the photographer's scans are large and stay where they are. *Alternatives:* import everything into OPFS; File System Access only; File System Access with an import fallback; a bridge-served folder. *Decision:* File System Access in Chromium, with the session/import fallback elsewhere. *Consequences:* no copies for Chromium users; other browsers work at the cost of copying or re-picking; identity by hash makes both safe. *Status:* proposed; the bridge route is an open question.

#### OPFS layout

```text
/cache/thumbs/<sha256>.webp                 film strip thumbnails (256 px)
/cache/pyramid/<sha256>/L<n>.f16            decoded working images, area-averaged halvings (from CHB-006)
/cache/tables/<tableKey>.bin                engine tables keyed by content (CHB-005)
/imports/<sha256>.<ext>                     fallback copies of source files
/exports/tmp/                               scratch for exports (CHB-011)
```

Caches are evicted least-recently-used once they exceed a budget (default 25 % of the quota reported by `navigator.storage.estimate()`); imports are never evicted automatically. The studio calls `navigator.storage.persist()` when the first project is created and shows usage in Settings. Large reads and writes happen in workers with sync access handles.

#### IndexedDB schema

```ts
// apps/studio/src/storage/db.ts (sketch, using the idb library)
interface StudioDB extends DBSchema {
  projects:  { key: string; value: Project };
  rolls:     { key: string; value: Roll; indexes: { byProject: string } };
  frames:    { key: string; value: FrameRecord; indexes: { byRoll: string; bySha: string } };
  log:       { key: [string, number]; value: StoredMutation };            // [frameId, seq], append-only
  heads:     { key: string; value: { frame: string; seq: number; cursor: number; stateHash: string } };
  recipes:   { key: string; value: { frame: string; atSeq: number; recipe: FrameRecipe } };   // checkpoints
  snapshots: { key: string; value: Snapshot; indexes: { byFrame: string } };
  probes:    { key: string; value: { frame: string; probes: Record<string, Probe> } };
  handles:   { key: string; value: { id: string; name: string; handle: FileSystemDirectoryHandle } };
  threads:   { key: string; value: ChatThreadRecord };                    // record format defined by CHB-008
  settings:  { key: string; value: unknown };
}
interface FrameRecord {
  id: string; rollId: string;
  source: { relPath: string; size: number; lastModified: number; sha256?: string; handle?: string; imported?: boolean };
  thumb?: string; badges: { edited: boolean; pending: number; gamutPct?: number; belowBasePct?: number };
}
```

The recipe is stored as its **edit log** (the source of truth) plus periodic checkpoints of the folded recipe, so opening a frame with a long history does not replay thousands of entries. Appending a mutation is one transaction: put the log entry, update the head.

#### Projects, rolls and the film strip

The film strip shows the frames of the current roll as thumbnails with badges: edited, pending agent changes, and the share of out-of-gamut and below-base pixels (Chromogen's strip badges, 5143–5148). Arrow keys move between frames when the strip has focus; Shift-click selects several frames for the contact sheet's "apply to selected". Roll defaults (stock, scanner, paper) are copied into a frame's recipe when the frame is first opened; changing a default later offers "apply to frames that still use the old value", which produces one transaction per frame.

### 5.6 Stage 2: the viewer

#### The presenter

```ts
// apps/studio/src/core/presenter-webgpu.ts (sketch)
const context = canvas.getContext('webgpu')!;
const format: GPUTextureFormat = supportsCanvasFormat('rgba16float') ? 'rgba16float' : navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, colorSpace: 'display-p3', alphaMode: 'opaque', toneMapping: { mode: 'standard' } });
```

The presenter draws one full-screen triangle that samples the engine's result texture through the viewport transform: nearest sampling above 1:1 (so pixels are visible when zoomed in), linear below. Before/after binds two textures and a split position; the split line is drawn in the shader. A `ResizeObserver` keeps the canvas size in device pixels (Chromogen 4916–4928). If the device is lost, the presenter recreates it and requests a render.

If the GPU engine (CHB-005) shares the presenter's `GPUDevice`, a result can stay on the GPU as a texture; with the mock or reference engine, the result is a float array that the presenter uploads. Without WebGPU, a Canvas2D presenter uses `getContext('2d', { colorSpace: 'display-p3' })` and `ImageData` in Display P3 (8-bit), the same API Chromogen used for P3 export (3279–3280).

The values presented are encoded by the engine for the screen. The viewer compiles a **view node** from the recipe with the screen as output target; it never edits the recipe's own output settings, which belong to export (CHB-011).

#### Viewport and coordinates

All positions are in **document pixels**: the pixel grid of the source frame after the recipe's crop and orientation, so that probes, masks and the agent agree on coordinates (goja-cv's "doc px" convention, `C1/various/analysis-goja-cv.md` §5.5). The viewport is `{ cx, cy, zoom }`: the document point at the canvas centre and CSS pixels per document pixel. From it:

- `EvalTarget.scale = min(1, zoom × devicePixelRatio)`: engine output pixels per document pixel;
- `EvalTarget.region`: the visible document rectangle plus a 10 % margin for panning, snapped outward to a 256-pixel grid at that scale, so small pans reuse cached regions;
- zoom presets: Fit, 1:1, 2:1, 4:1; the mouse wheel zooms around the cursor; Space-drag or middle-drag pans.

#### The render scheduler: draft while dragging, latest request wins

The scheduler has one rule: **at most one evaluation in flight and one waiting slot, and the waiting slot holds only the newest request.** Intermediate requests are overwritten, never queued. Results are presented only in increasing request order, so the picture never steps backwards.

```ts
// apps/studio/src/core/scheduler.ts (sketch)
type Pass = 'draft' | 'screen' | 'refine';
interface RenderRequest { node: NodeRef; viewport: Viewport; pass: Pass; split?: NodeRef }

export class RenderScheduler {
  private gen = 0;                 // id of the newest request
  private shownGen = 0;            // id of the result on screen
  private waiting?: { gen: number; req: RenderRequest };
  private inflight?: { gen: number; ctl: AbortController; key: string };

  request(req: RenderRequest): void {
    const gen = ++this.gen;
    this.waiting = { gen, req };                                   // overwrite: latest wins
    if (this.inflight && this.inflight.key !== keyOf(req)) this.inflight.ctl.abort();   // superseded work
    queueMicrotask(() => this.pump());
  }

  private async pump(): Promise<void> {
    if (this.inflight || !this.waiting) return;
    const { gen, req } = this.waiting; this.waiting = undefined;
    const ctl = new AbortController();
    this.inflight = { gen, ctl, key: keyOf(req) };
    try {
      const target = targetFor(req);   // draft: scale chosen so the region is ≤ 0.5 MP; screen: exact; refine: 1:1 tiles
      const img = await this.engine.evaluate(req.node, target /*, { signal: ctl.signal } — proposed, section 9 */);
      if (gen > this.shownGen) { this.presenter.present(img, req.viewport); this.shownGen = gen; }
      if (req.pass === 'screen' && gen === this.gen && wantsRefine(req)) this.request({ ...req, pass: 'refine' });
    } catch (e) {
      if (!ctl.signal.aborted) this.reportError(e);
    } finally {
      this.inflight = undefined;
      if (this.waiting) void this.pump();
    }
  }
}
```

The **passes**:

| Pass | When | Target | Purpose |
|---|---|---|---|
| draft | a gesture is active (slider drag, pan, zoom animation) | scale reduced so the region has at most about 0.5 megapixels; adapted from the last draft's duration to stay near 30 ms | feedback while moving |
| screen | after release, or any change without a gesture | exactly the canvas resolution | the picture to judge |
| refine | zoom at or beyond 1:1, or a probe asks for it | full resolution tiles of the visible region, `precision: 'export'` where the probe sits | pixel-exact inspection |

Changes whose expensive part binds per stock or per scan (the registry's `OpDef.binding`, Chromogen's `cost: 'rebuild'`), such as changing the paper, call `engine.prepare(keys)` first; the viewer keeps showing the previous image with a "building tables" indicator until the new one arrives.

Until the Engine accepts an abort signal (a proposed contract addition), `abort()` cannot stop work already inside the engine. The monotonic `shownGen` rule still guarantees correctness: a late result is shown only if nothing newer is on screen.

#### Views

| View | What the viewer compiles | What the photographer uses it for |
|---|---|---|
| Print | the recipe's chain to `output.display` for the screen | judging the print |
| Negative | the source as transmitted light, no inversion | checking the scan, the rebate, the flat field |
| Dyes | the `invert.dyes` result shown as a picture of the three dye amounts | checking the dye solve |
| Base & gamut | `invert.classify` as a class map: in-range pixels greyed, blank film, below base and out of gamut in distinct colours and patterns, with percentages | finding pixels the print cannot reproduce faithfully |

Chromogen's legend wording (`BASE_TEXT`, 4983–4990) explains each class in a sentence with numbers ("below base: G 0.012 D lighter than the rebate, more than the noise explains"); reuse it. The mapping of intermediate domains to display colours needs an op the catalog does not have yet (section 9).

#### The densitometer probe

Hovering over the print shows a readout line under the viewer; clicking with `p` pins a named probe. The readout follows Chromogen's (4975): document position; dye amounts; reachability class and base deviation; printing density; paper log H relative to the aim, in points; print L*a*b*; and print visual density. The probe is a `measure.densitometer` request at `{x, y, r}` in document pixels (default radius 3, a 7 × 7 area). It uses the same latest-wins rule as rendering, at most one request per animation frame. Measurements read the effective recipe, draft included, so the readout follows a slider while it moves.

Pinned probes (for example "grey" on a grey card, "face") are stored per frame. Playbooks in CHB-008 refer to them by name, so they must be visible to the DSL; section 9 proposes where they live. With the canvas focused, the arrow keys move the probe by one document pixel (Shift: ten), which also makes the densitometer usable without a mouse.

### 5.7 Stage 3: controls generated from the op registry

#### From `ArgSpec` to a control

Every op in the registry that has a `recipePath` (architecture doc §5.2) contributes controls for its arguments that carry `ui` metadata. A generated control is a plain object:

```ts
// apps/studio/src/core/controls.ts (sketch)
export interface ControlModel {
  path: string;                    // recipe path, e.g. 'print.enlarger.filtration.y'
  op: string; arg: string;         // where it came from in the registry
  label: string; group: string; doc: string;
  widget: 'slider' | 'wheel' | 'stepper' | 'segmented' | 'toggle' | 'select';
  storageUnit: Unit;               // ArgSpec.unit: what the recipe stores
  displayUnit: Unit;               // ArgSpec.ui.display ?? unit: what the photographer reads (proposed field)
  scale: 'linear' | 'log2';        // log2: steps are ratios, e.g. time in fractions of a stop (proposed field)
  min?: number; max?: number;      // hard range, storage units
  usual?: [number, number];        // soft range: outside it the value turns amber, with ArgSpec.usualHint
  step: number; detents: number[]; defaultValue: unknown; values?: string[];
  toDisplay(v: number): number; fromDisplay(d: number): number;
  format(v: unknown): string;      // '62.5 CC', '15.12 s', '+4 pt'
  aside?(v: unknown): string;      // second readout: '≈ −4.0 pt B', '+1/3 st'
}

export function generateControls(registry: OpDef[]): ControlModel[] { /* one per (op, arg) with arg.ui */ }
```

The widgets and the units they use:

| Recipe value | Widget | Display | Steps and detents | Aside |
|---|---|---|---|---|
| `print.enlarger.time_s` | stepper + slider in stops | seconds | 1/6 or 1/3 stop (12.0 → 13.47 → 15.12 s); detents at whole stops from the last test-strip choice | "+1/3 st" relative to the base time |
| `print.enlarger.fstop` | segmented / stepper | f-number | third-stop series f/5.6, 6.3, 7.1, 8, 9, 10, 11; detents at whole stops | "−0.92 st" relative to the base |
| `print.enlarger.filtration.{c,m,y}` | slider | CC | 1 CC (Shift: 5 CC); detent at the neutral pack value | "≈ −4.0 pt B" per +10 Y, from the isolated-band rule (0.4 pt per CC) |
| `print.lights.logH` | colour pad + density slider + three fields | points | 1 pt; detent at 0 | "+0.10 logH" |
| `print.paper` | select | stock name | — | — |
| `print.grade` | stepper | grade | 0.5 | — |
| `print.preflash` | slider | per cent | from the registry | — |

The printer-lights pad follows Chromogen's `Pad` (4538–4575) and Filmbench's colour-balance wheel (`vfs/controls.js` 86–89): the pad moves the colour part of the three lights (their mean removed), the density slider moves all three together. All three widgets write the one `print.lights.logH` path, so they are just different hands on the same value.

**Darkroom units are a presentation, not storage.** The recipe stores log H, seconds and CC; the control converts at the edge. That keeps the physics unit rules of architecture doc §5.1 intact (a density and a log exposure never add) and lets the agent and the UI agree on numbers.

**Arrangements.** The *All parameters* arrangement is generated by area (Filmbench's `ctl.fromSpec`, 2085–2117). The *Darkroom* arrangement is a hand-written list of paths in groups (Exposure, Filtration, Printer lights, Paper, Local), in `ui/controls/darkroom-arrangement.ts`, checked by a test that every path exists in the registry (Filmbench's `Scheme.audit`, 2030–2047).

**Gestures.** The `GestureController` turns input into mutations:

- pointer drag: draft overlay, one `set` on release, Esc cancels;
- arrow keys and wheel: one `set` per step, sharing a `tx` id while steps on the same control arrive within 800 ms;
- typing a value: one `set` on Enter;
- double-click on the label (Chromogen 4523): reset to the default, one `set`.

**Decision record: no layer stack in v0.** *Context:* Filmbench resolves every parameter through layers (`look → macros → agent → pin`) with opacity (1806–1878); that gives presets and an agent layer the user can switch off. *Alternatives:* port the layers into the recipe; keep the recipe flat and get provenance from the edit log. *Decision:* flat recipe. The contract has no layers, the agent's changes are already distinguished by `by` and approvals, and `why(path)` on the log answers "where does this value come from". *Consequences:* presets become recipe fragments applied as one transaction; "switch the agent's changes off" is "revert the agent's transactions". *Status:* proposed.

### 5.8 Stage 4: history, approvals, provenance, snapshots

The **history panel** is a view of the frame's edit log:

- entries grouped by `tx` (a gesture, an agent eval, a ring-around click), labelled from the registry ("You · Yellow 52.5 → 62.5 CC", "Agent · Exposure time 12.0 → 15.12 s (+1/3 st)"), with the author (`by`: you, agent, auto) and time;
- a cursor line marking the current undo position; clicking a group moves the cursor there (several undos or redos at once);
- rejected agent mutations shown struck through, with their diagnostic on hover.

**Pending agent changes** appear at the top of the panel, as in Filmbench's history view (4405–4412): one card per agent transaction with Approve, Reject and, for several, Approve all. Approve and Reject call the edit log's ask-mode API (CHB-002). The cards are also shown inside the chat panel's step card when the change came from the in-app chat (CHB-008 waits for that decision). Undo and redo move only over applied entries; pending entries are not part of the fold until approved.

**Provenance.** Right-clicking a control, or pressing `i` while it has focus, opens "Why is Yellow 62.5 CC?", built from `why(path)`:

```text
Yellow filtration   print.enlarger.filtration.y
  default   52.5 CC   neutral pack for kodak_portra_400 on kodak_portra_endura
  14:02     You       52.5 → 62.5 CC     gesture g-17
  14:05     Agent     62.5 → 60.0 CC     eval toolu_01…   pending
  now       62.5 CC   (≈ −4.0 pt B from the neutral pack)
```

Filmbench's `ParamStore.why` (1860–1876) printed the same kind of table for its layers.

**Snapshots** (Chromogen 4845–4860, key `s`) are named copies of the folded recipe with its state hash. They serve before/after (the split compares the current print with a snapshot or with the defaults) and restore, which applies the differences as one transaction of `set` mutations so that it is undoable and appears in the history.

### 5.9 Stage 5: darkroom tool UIs, against mock ops

Each tool is a mode of the viewer plus a parameter panel. It compiles a tool node from the effective recipe, renders it with the same scheduler, and turns a click into one transaction. The op names are the catalog's (architecture doc §5.2, area `darkroom` and `mask`); their argument shapes are CHB-010's to finalise, so the UI keeps them in one adapter file per tool.

**Test strip** (`darkroom.testStrip`). Parameters: what varies (time, or one filter), the step (1/6, 1/3, 1/2 or 1 stop for time; 2, 5 or 10 CC for filters), the count (3–9), the layout (bands across the picture, or patches at a probe) and the probe for the readings. The strip shows each band's value and its reading from `measure.patches`. Clicking a band writes that value (one `set`). For a 12.0 s print at 1/3 stop and five steps, the values are 7.56, 9.52, 12.00, 15.12 and 19.05 s.

**Ring-around** (`darkroom.ringAround`). Chromogen's layout (5010): a 3 × 3 hexagonal grid with the current print in the centre and the six colour directions in colour-wheel order around it, plus a density row.

```text
            +Y (−B)     +R (−C)     +M (−G)
            +G (−M)     current     +B (−Y)
                        +C (−R)
   density:  −2 step   −1 step   current   +1 step   +2 step          step: 2 · [4] · 8 pt
```

Each tile is the current recipe with a printer-lights offset of the chosen step (4 pt = 0.10 log H) in one colour direction, or in density. A tile's label names the colour the print moves towards; its offset is in light, so the print turns greener when green light is *reduced* relative to red and blue (section 6 works the numbers; Chromogen's `renderRing`, 4330–4347, is the reference). Clicking a tile writes the new `print.lights.logH` (one `set`). Because the "current" tile is compiled from the same recipe as the main view, it is the same node and must render identically; that is a test.

**Contact sheet** (`darkroom.contactSheet`). The frames of a roll in a grid, each printed with its own recipe or all with the current one. Selecting frames and choosing "Apply these settings" writes, for each selected frame, the differences as one transaction; the transactions share a group id so the history can show "applied to 8 frames".

**Masks** (`mask.paint`, `mask.gradient`, `mask.ellipse`, `mask.feather`, `mask.and/or/not`). A mask is named ("sky", "face") and stored as a vector description in the recipe (`mask.set`), not as pixels:

```ts
// proposed MaskSpec shapes (section 9); coordinates in document pixels
type MaskShape =
  | { kind: 'stroke'; points: [number, number, number][]; radius: number; hardness: number; mode: 'add' | 'erase' } // x, y, pressure
  | { kind: 'gradient'; from: [number, number]; to: [number, number] }          // 1 at `from`, 0 at `to`
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; angle: number; feather: number };
interface MaskSpec { id: string; name: string; shapes: MaskShape[]; feather: number; invert: boolean }
```

The editor offers a brush (size and hardness; `[` and `]` change the size), a gradient tool (drag from the area to keep to the area to leave), an ellipse tool with handles, invert, feather, and an overlay (red at 50 %, toggled with `o`). While painting, the stroke is previewed on a 2-D overlay canvas without an engine round trip; on stroke end the spec is written (one `mask.set`) and the print re-renders. Strokes are simplified (Ramer–Douglas–Peucker at 0.5 document pixels) so a long painting session keeps the recipe small. **Decision:** vector masks in the recipe rather than raster masks in OPFS, because a recipe must stay a small, portable, diff-able document and the engine can render a vector mask at any scale; the cost is that pixel-exact hand painting is limited by the stroke model.

**Exposure list** (`print.exposures`, the `Exposure` records of architecture doc §5.4). A table, edited with `exposure.add`, `exposure.remove` and `set` on a field of one exposure:

```text
┌ EXPOSURES · frame 12 ─────────────────────────────────────────────────────────────────────┐
│ #  kind   mask    change      time        filtration C/M/Y       note                      │
│ 1  main   —       —           12.0 s      0 / 51.6 / 52.5                                   │
│ 2  dodge  face    −1/4 st     −1.91 s     (main's)               held back during main      │
│ 3  burn   sky     +1/2 st     +4.97 s     (main's)               after main                 │
│ 4  flash  —       —            2.0 s      0 / 51.6 / 52.5        no negative               │
│ Printing script: expose 12.0 s, hold back face for 1.91 s; burn sky 4.97 s; flash 2.0 s.   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

The arithmetic the table shows: a dodge of −1/4 stop during a 12.0 s main exposure withholds 12 × (1 − 2^(−1/4)) = 1.91 s; a burn of +1/2 stop adds 12 × (2^(1/2) − 1) = 4.97 s. Each row shows both the stop value (what the recipe stores in `stops`) and the seconds (what a printer would count). A *split* row has its own filtration. Whether an exposure can be switched off without deleting it needs a recipe field (section 9).

All five tools work on the mock engine in stage 5: the mock returns trivially different bands, tiles and masks, which is enough to test layout, labels, click-to-mutation mapping and undo. CHB-010 makes them physically right.

### 5.10 Stage 6: accessibility, keyboard and the chat panel

**Accessibility target:** WCAG 2.2 level AA for everything except judging the picture itself.

- Every control is operable from the keyboard. Sliders are React Aria sliders with `aria-valuetext` in darkroom words ("Yellow filtration 62.5 CC, about minus 4 points blue"). Home resets to the default.
- Focus is always visible; the tab order follows the layout; drawers trap focus while open.
- Status changes are announced through polite live regions: the probe readout (at most once a second), agent proposals ("Agent proposes 2 changes"), render errors. Errors use an assertive region.
- The base & gamut view uses patterns as well as colours, and its legend states the classes in words.
- Targets are at least 24 × 24 CSS px. Animated zoom is disabled when `prefers-reduced-motion` is set.
- The canvas has `role="img"` and a label naming the frame and view; the keyboard-driven probe gives non-mouse users the numbers the picture shows.

**Keyboard shortcuts** (ignored while typing in a text field; range inputs excepted, as in Chromogen 5164):

| Key | Action | Origin |
|---|---|---|
| Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z | undo, redo | Chromogen |
| `\` | before/after | Chromogen |
| `g` | grey pick: click a neutral to balance the lights | Chromogen |
| `r` | ring-around | Chromogen |
| `t` | test strip | new |
| `s` | snapshot | Chromogen |
| `1` `2` `3` `4` | views: print, negative, dyes, base & gamut | new |
| `f`, `z`, `+`, `−` | fit, toggle 1:1, zoom in, zoom out | new |
| Space + drag | pan | new |
| `p` | pin a probe at the cursor | new |
| `m`, then `b` / `[` / `]` / `o` | mask tool; brush; brush size; overlay | new |
| `/` | focus the chat input | new |
| Ctrl/Cmd+. | stop the agent | new |
| Esc | cancel the current drag, tool or pick | Chromogen |
| ← / → (film strip focused) | previous, next frame | new |
| `i` (a control focused) | why does this control have its value (provenance) | new |
| `?` | show all shortcuts | new |

There is deliberately no shortcut that approves agent changes.

**The chat panel** renders CHB-008's `ChatSession` events: streaming text (sanitised Markdown), reasoning summaries collapsed by default, one **step card** per eval (the code as it streams, then the result text in a monospace block, the looks as thumbnails that enlarge on click, the duration), **approval cards** (Approve, Reject, Decide later; Enter on the focused button), a Stop button, a mode selector and an effort selector, and a counter of pictures shared in the thread. Enter sends and Shift+Enter adds a line (Filmbench 4889). Links in the agent's replies of the form `chromobench:control/print.enlarger.filtration.y` focus that control. The chat needs the bridge's proxy; when it is missing, the panel says so and the rest of the studio is unaffected.

### 5.11 Working against the mock engine first

The M1 slice of this ticket, in order:

1. Open `fixtures/scans/` sample through the file input (or the library) → `engine.open(source)` on `engine-mock` → a frame record.
2. `compile(recipe)` on the mock catalog → `evaluate` → the presenter shows it (WebGPU, or Canvas2D where WebGPU is missing).
3. Generated controls for the mock catalog's enlarger time, filtration and printer lights.
4. A slider change → one mutation → re-render; undo and redo.
5. A DSL eval through CHB-008's development entry point (`window.chromobench.eval`) changes the same recipe; the history shows the change as the agent's, and undo removes it.

Nothing in this list depends on physics. When CHB-003's reference engine arrives, the same UI runs on it by swapping the engine instance.

## 6. One flow traced end to end

Section 5.4 traced a slider drag. This section traces a complete step of a printing session on the mock engine: from a click in the ring-around to the history panel and an undo.

1. **State before.** `frame_0042`, Portra 400 on Portra Endura, filtration C 0 / M 51.6 / Y 52.5 CC, time 12.0 s, printer lights (0, 0, 0) log H. Edit log head: seq 40, state hash `3f9a…`. The pinned probe "grey" sits on a grey card in the picture.
2. **Open the ring-around** (`r`). The tool compiles `darkroom.ringAround({ step_pt: 4 })` from the effective recipe; the scheduler requests a screen pass of the tool node. The mock returns nine tiles. The central tile's node id equals the main view's node id, because both are compiled from the same recipe.
3. **The photographer judges the print too magenta and clicks "+G (−M)".** The labels name the colour the **print** moves towards. The tile's change is in **light**, and more light of one colour makes more of the complementary dye: more green light makes more magenta dye. So to move the print towards green, the tile gives *less* green light relative to red and blue. Chromogen's table writes this move as the light vector (1, 0, 1) (`renderRing`, `05-inline.js` 4332); removing its mean (2/3) and scaling by 1.5 × the step (4 pt = 0.10 log H) gives (+1/3, −2/3, +1/3) × 0.15 = **(+0.05, −0.10, +0.05) log H = (+2, −4, +2) points**. The dominant component equals the step, which is why the factor 1.5 is there.
4. **Mutation.** One `set` on `print.lights.logH` with value `[0.05, -0.10, 0.05]`, `by: 'user'`, `tx: 'ring-0007'`, appended as seq 41. The state hash becomes `9b21…`.
5. **Render.** The viewer returns to the print view. Compiling the new recipe yields the node of the clicked tile (hash-consing again), so the screen pass starts from a cached tile-scale image and refines at screen scale.
6. **Readout.** The "grey" probe's a* moves towards green (on the reference engine; on the mock, a deterministic trivial change).
7. **History.** The panel shows "You · Printer lights (0, 0, 0) → (+2, −4, +2) pt · ring-around +G (−M)". Ctrl+Z appends nothing; it moves the cursor back to seq 40 and the state hash returns to `3f9a…`, which the test checks.

The failure case to design for is the photographer clicking a tile while a test-strip render is still in flight. The tile click is a new request; the scheduler aborts or outdates the strip render, and the strip result, if it arrives, is not shown, because its generation is older than the print render requested by the click.

The sign convention in step 3 is where an intern is most likely to go wrong. Write a test on the reference engine (M2) that the "+G (−M)" tile, measured at a neutral probe, has a lower a* (greener) than the current tile, and the "+M (−G)" tile a higher one.

## 7. Implementation plan

**Stage 1: shell.** Build the scaffold (Vite, React 19, TypeScript, `vite-plugin-pwa`), the framework-free core skeleton, IndexedDB schema and migrations, OPFS layout with quota and eviction, folder access with the fallback, projects, rolls and the film strip with mock thumbnails. *Done when* the app installs, starts offline, adds a folder in Chromium and a session/import set elsewhere, survives a reload with recipes re-attached by hash, and the framework spike shows a drag on the mock engine under the budget in section 8.

**Stage 2: viewer.** Presenters (WebGPU P3 and Canvas2D), viewport, the scheduler with draft, screen and refine passes, views, before/after, the densitometer with pinned probes. *Done when* the scheduler tests pass (latest wins, monotonic presentation, abort of superseded work, draft-to-screen sequence) and the M1 render path works end to end.

**Stage 3: controls.** `units.ts`, `controls.ts`, widgets, the darkroom arrangement and its audit test, the gesture controller. *Done when* every `ArgSpec` with `ui` in the mock catalog produces a control, the unit golden numbers pass, a drag logs exactly one mutation and Esc logs none, and a burst of arrow keys is one undo step.

**Stage 4: history.** The history panel, pending cards wired to the edit log's ask mode, the why popover, snapshots, before/after against snapshots. *Done when* an agent mutation committed by CHB-008's host (or a test stub) appears as pending, approving it applies it and undo reverts it, and why() shows the chain.

**Stage 5: darkroom tools.** Test strip, ring-around, contact sheet, mask editor, exposure list, each on mock ops. *Done when* each tool's click produces the specified single transaction, the ring-around's centre tile equals the main view, masks round-trip through `mask.set`, and the exposure arithmetic matches the numbers in 5.9.

**Stage 6: accessibility, keyboard, chat.** Shortcut map, ARIA, live regions, the chat panel on CHB-008's session. *Done when* axe reports no violations on the main layouts, the keyboard-only test passes, and the chat panel renders a recorded session including an approval.

## 8. Testing and acceptance

**Golden numbers** (unit tests on `units.ts` and the tools' arithmetic):

- 1 pt = 0.025 log H; 1 stop = 0.30103 log H = 12.04 pt; 4 pt = 0.10 log H.
- 12.0 s + 1/3 stop = 15.12 s; + 1/6 stop = 13.47 s; the five-step 1/3-stop strip around 12.0 s is 7.56, 9.52, 12.00, 15.12, 19.05 s.
- f/8 → f/11 = −0.277 log H = −0.92 stop; the third-stop labels from f/5.6 to f/11 are 5.6, 6.3, 7.1, 8, 9, 10, 11 (true values 5.66 … 11.31).
- +10 CC yellow: aside "≈ −4.0 pt B" (isolated-band rule, textbook §2.6).
- dodge −1/4 stop of 12.0 s = 1.91 s withheld; burn +1/2 stop = 4.97 s added.

**Physics checks once the reference engine exists (M2):** on the textbook's setup (Portra 400 on Portra Endura) the probe on the grey card reads visual density 0.755 with the default recipe (chapter 2 introduction); with the settings of the textbook's "Try it" (§2.7), a printer-lights change of +10 pt red, entered through the lights fields, takes the probe from density 0.746 to 0.956 and a* to −20.7. These test the whole UI → recipe → engine → probe path, not the physics.

**Scheduler tests** with a fake engine whose `evaluate` returns promises the test resolves by hand: (1) three requests while one is in flight → exactly two evaluations, the second for the newest request; (2) results resolved out of order → the presenter never shows an older generation after a newer one; (3) a superseded in-flight request receives `abort`; (4) a gesture produces draft passes and one screen pass after release.

**Gesture and history tests:** a 120-event drag yields one log entry; Esc during a drag yields none; arrow keys within 800 ms share a `tx`; undo of a tx restores the previous fold and state hash; pending entries are not folded until approved; restore of a snapshot is one transaction.

**Control generation tests:** a snapshot of the `ControlModel`s generated from the mock catalog; the darkroom arrangement audit (every path exists); every control's `format(fromDisplay(toDisplay(v)))` round-trips within one step.

**End-to-end (Playwright, Chromium):** the M1 flow; open the fixture through the fallback input (`setInputFiles`), because native pickers cannot be driven; offline reload with `context.setOffline(true)`; keyboard-only flow (open a frame, change yellow with arrow keys, undo); `@axe-core/playwright` on the main layout, the history panel and each tool. Canvas pixels are read back through a test-only `presenter.readPixels()` (texture copied to a buffer) and compared with the mock engine's expected output for the fixture, within ±1 code value.

**Performance budgets** (mock engine, 2048-pixel working image, Chromium on a mid-range laptop): pointer move to presented draft ≤ 50 ms at the 95th percentile; never more than one evaluation in flight; a committed change reaches the screen pass ≤ 150 ms. These are budgets for the UI machinery; the real engines set their own.

**How to tell the tests can fail:** remove the generation check in the scheduler and the out-of-order test must fail; log every pointer move and the one-mutation test must fail; drop `aria-valuetext` and the keyboard test's spoken-value assertion must fail. Run each broken variant once when writing the test.

**Fixtures:** the Gold 200 sample from CHB-001 (`sources/chromogen-studio-1.2/samples/gold200.png`) copied into `fixtures/scans/`; a small 16-bit TIFF for M1; synthetic frames from CHB-004 for the grey-card checks; a recorded chat session from CHB-008 for the chat panel.

## 9. Proposed contract additions (for CHB-002)

1. **Display metadata on `ArgSpec.ui`:** `display?: Unit` (the unit shown, e.g. `point` for a value stored in `logH`), `scale?: 'linear' | 'log2'` (steps as ratios, for time in stops and f-numbers), `aside?: Unit` (the unit of the second readout).
2. **`ArgSpec.path?: string`:** the recipe path an argument persists to, defaulting to `${OpDef.recipePath}.${argName}`. Generated controls need an unambiguous path per argument.
3. **Path syntax for records in arrays:** `print.exposures.<id>.time_s` (by id, never by index), for `set` on one exposure and for `why()`.
4. **`Exposure.enabled?: boolean`** (default true), so an exposure can be switched off and on while comparing.
5. **`MaskSpec`** vector shapes as in section 5.9 (to be agreed with CHB-010).
6. **`FrameRecipe.probes?: Record<string, { x: number; y: number; r: number }>`**, so named probes are shared by the photographer, the playbooks and the agent.
7. **A view op for the inspection views**, for example `view.inspect({ mode: 'negative' | 'dyes' | 'classes' })` → `display-rgb`, so that the negative, dye and class views are ordinary nodes the engines render and the conformance suite checks.
8. **Cancellable engine calls:** `signal?: AbortSignal` on `evaluate` and `measure` (also requested by CHB-008).
9. **`ImageResult` for display:** an optional `texture?: GPUTexture` when the engine shares the presenter's device, and the colour encoding of the data (for example `'display-p3'`).
10. **The `measure.densitometer` result:** `{ at, dyes: Vec3, cls, baseD: Vec3, printingDensity: Vec3, paperLogH: Vec3, lab: Vec3, visualDensity: number }`.
11. **`LoggedMutation.seq: number`** (also requested by CHB-008), so the history, approvals and undo cursor can reference entries.

## 10. Risks, open questions and decisions

**Blocking or near-blocking:**

- **Approval semantics in the edit log** (CHB-002): does approving flip a pending entry's status or append an applied copy? The history panel's rendering and the undo cursor depend on it. Needed before stage 4.
- **Ring-around sign convention.** The labels (print colour) and the offsets (light) have opposite-looking signs; the convention follows Chromogen and must be confirmed by the reference-engine test in section 6 before the beta.
- **Hosting** (architecture doc §8.4): the PWA works either way, but the chat panel and the bridge-served folder option need the bridge.

**Open questions (decide during implementation):**

- Whether the bridge should serve scan folders to browsers without the File System Access pickers (with CHB-008).
- The draft-pass budget once the GPU engine exists: the 0.5 MP draft size is a starting point, adapted from measured times.
- Whether the "All parameters" arrangement should be visible to the photographer by default or only in a developer setting.

**Risks:**

- **Browser coverage.** Firefox and Safari lack the pickers and some WebGPU features; they get the fallback presenter and import path. State this in the beta notes.
- **Large scans.** A 100-megapixel scan must never be rendered whole for the screen; the viewer only asks for the visible region at screen scale, and relies on the engines' pyramids (CHB-005, CHB-006).
- **React re-render cost.** Mitigated by the framework-free core and per-value subscriptions; measured by the stage 1 spike and the performance budget.
- **Storage eviction.** Without `navigator.storage.persist()` granted, the browser may evict caches and imports; the studio warns when persistence was refused and imports exist.

## 11. References

**Chromobench and CHB-001 material**

- Architecture doc: `C1/design-doc/01-chromobench-architecture-and-work-plan.md` §3–5 (architecture, vocabulary, contracts), §8 (work plan, milestones, open decisions).
- Chromogen Studio: `C1/various/extracted/chromogen-studio/05-inline.js` lines 948–949 (`PT`, `STOP`), 995–1597 (`SECTIONS`, `SLIDERS`), 3279–3280 (Display P3 canvas), 4056–4206 (render queue, `set`, undo, autosave), 4222–4347 (`lightsToSliders`, probes, `renderRing`), 4514–5199 (the React UI); report `C1/various/analysis-chromogen-studio.md` §5.
- Filmbench IDE: `C1/various/extracted/filmbench-ide/01-inline.js` lines 1796–2117 (control plane), 2323–2337 (`apply`, ask mode, coalescing), 3836–3857 (paint scheduler, drafts), 4399–4415 (History view), 4915–4936 (views and layouts); `C1/various/extracted/filmbench-ide/vfs/controls.js` (darkroom, engineer and colourist schemes); report `C1/various/analysis-filmbench-ide.md` §1, §2, §6.
- goja-cv conventions (document pixels, op classes): `C1/various/analysis-goja-cv.md` §5.
- Textbook: `C1/sources/The Mathematics of the Colour Negative.md` §2.6 (printer lights, CC, filter coupling, neutral pack), §2.7 ("Try it" numbers), §2.8 (lights factor out of the spectral sum).

**External**

- WebGPU canvas configuration: MDN `GPUCanvasContext.configure()`, https://developer.mozilla.org/docs/Web/API/GPUCanvasContext/configure; tone mapping modes: https://developer.chrome.com/blog/new-in-webgpu-129
- File System Access API: https://developer.chrome.com/articles/file-system-access/ ; browser support: https://caniuse.com/mdn-api_window_showdirectorypicker and https://web-platform-dx.github.io/web-features-explorer/features/file-system-access
- Origin private file system and `createSyncAccessHandle()`: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- React 19 (19.3, September 2026): https://react.dev/blog ; React Aria Components: https://react-spectrum.adobe.com/react-aria/
- `vite-plugin-pwa`: https://vite-pwa-org.netlify.app/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
