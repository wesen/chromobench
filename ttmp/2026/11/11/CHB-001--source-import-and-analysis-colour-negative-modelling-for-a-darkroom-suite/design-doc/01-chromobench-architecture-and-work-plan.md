---
Title: Chromobench architecture and work plan
Ticket: CHB-001
Status: active
Topics:
    - color-science
    - film-emulation
    - image-pipeline
    - js-api
    - product
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:30.93541225-05:00
WhatFor: ""
WhenToUse: ""
---

# Chromobench architecture and work plan

## Executive Summary

<!-- Provide a high-level overview of the design proposal -->

## Problem Statement

<!-- Describe the problem this design addresses -->

## Proposed Solution

<!-- Describe the proposed solution in detail -->

## Design Decisions

<!-- Document key design decisions and rationale -->

## Alternatives Considered

<!-- List alternative approaches that were considered and why they were rejected -->

## Implementation Plan

<!-- Outline the steps to implement this design -->

## Open Questions

<!-- List any unresolved questions or concerns -->

## References

<!-- Link to related documents, RFCs, or external resources -->

# Chromobench architecture and work plan

This document is the shared map for every chromobench ticket (CHB-002 to CHB-015). It explains what the product is, how the system is divided, which names and contracts all tickets use, where the existing material lives, and how the work is split into parallel tickets. Each ticket has its own intern guide; those guides assume the vocabulary defined here and link back to it.

Status: **proposal**. Nothing in the planned repository layout exists yet. Every path under `packages/`, `apps/`, `bridge/`, `tools/` and `fixtures/` below is planned, not existing. Paths under `ttmp/` and `~/code/wesen/go-go-golems/goja-cv` exist today.

## 1. What chromobench is

Chromobench is a browser application for one photographer. It covers two kinds of picture:

- **Colour negatives:** scans made with a film scanner or a camera.
- **Digital camera RAW files:** these are "shot" on a simulated film stock.

Both are printed through a physically based model of the colour darkroom: an enlarger lamp and filters shine through the negative onto colour paper, the paper develops, and the print is viewed under a light. The photographer works with darkroom controls:

- paper choice;
- printer lights or colour-correction (CC) filtration;
- exposure time;
- grade;
- dodging, burning and flashing;
- test strips and ring-arounds.

The physics comes from three sources:

- *The Mathematics of the Colour Negative*, the textbook imported in CHB-001;
- the open-source simulator **spektrafilm**, whose stock data everything uses;
- two prototypes, **Chromogen Studio** (scan inversion) and **Filmbench IDE** (forward simulation with an agent).

A JavaScript **DSL** sits underneath the user interface. A DSL ("domain-specific language") here means a small JavaScript API whose objects are the darkroom's own concepts: frames, negatives, prints, exposures, masks, densitometer readings. The photographer never sees it. An **LLM agent** uses it to inspect pictures, run test strips, propose corrections and remove dust. Every agent change becomes an edit the photographer can see, approve or undo. The design of this DSL follows goja-cv (`~/code/wesen/go-go-golems/goja-cv`), a Go project that gives an agent a lazy, measurable image API.

Everything runs in the browser:

| Technology | Job |
|---|---|
| HTML and TypeScript | User interface and engine logic |
| WebGPU | Pixel work and table building |
| Plain JavaScript in 64-bit floating point (f64) | Reference implementation that every fast path is checked against |
| WebAssembly (WASM) | Existing C libraries: LibRaw for camera RAW files, lcms2 for ICC colour profiles, and QuickJS, the interpreter that runs agent code in a sandbox |

Go appears only in an optional bridge binary that serves the app and connects external agents (CHB-008).

## 2. The physical model in one page

Every quantity in the model has a **domain**, the kind of data it is, and a **unit**. Most bugs in this field come from applying a stage in the wrong domain or in the wrong order, so the system makes domains explicit in its types.

**Light and spectra.** Light is stored as a **spectrum**: 81 samples from 380 to 780 nm in 5 nm steps. Any detector does the same thing to a spectrum: it multiplies by its sensitivity and sums. That covers a film layer, a paper layer, a scanner channel and the eye (textbook §1.1).

**Density.** For a transmittance T, density is D = −log₁₀ T. Densities add at a single wavelength (Beer–Lambert, §1.2). A colour negative has three dyes, cyan, magenta and yellow, and the spectral density of a pixel is

```text
D(λ) = c_C·ε_C(λ) + c_M·ε_M(λ) + c_Y·ε_Y(λ) + base(λ)
```

Here `c` are the three **dye amounts**, `ε` the stock's unit dye spectra, and `base` the orange mask, support and fog present everywhere. Three numbers per pixel, plus fixed spectra per stock, describe a developed negative completely.

**Channel density.** A **channel density** is what a channel reads through a band of wavelengths: D_k = −log₁₀ Σ_λ w_k(λ)·10^(−D(λ)), with w_k the channel's normalised responsivity. It behaves like a soft minimum of D over the band, which is why "a 3×3 density matrix" is only a local slope (§1.3–1.4).

**The forward direction (scene → negative → print):**

```text
scene RGB/XYZ ─► spectral upsampling ─► film log exposure per layer (logH, grey card = 0)
   ─► DIR coupling (layers inhibit each other, acts before the curve)
   ─► halation / scatter (convolution in LINEAR exposure, before the log)
   ─► characteristic curves ─► film dye amounts c ─► (+ grain)
   ─► spectral density D(λ) = Σ c_j ε_j(λ) + base(λ)
   ─► enlarger: lamp × filters × 10^(−D) × paper sensitivity ─► paper log exposure x (+ printer lights ℓ)
   ─► paper curves ─► paper dye amounts ─► reflectance ─► XYZ under the viewing light
   ─► viewing flare ─► chromatic adaptation ─► gamut compression (LAST) ─► display / file
```

**The inverse direction (negative scan → negative):**

```text
scanner counts ─► flat-field division (sensor coordinates) ─► T / T_rebate ─► scanner density per channel
   ─► bounded least-squares dye solve per pixel (Levenberg–Marquardt with active set) ─► film dye amounts c
```

**Where the directions meet.** Both directions arrive at the negative's dye amounts. Everything after that point is the shared darkroom. A RAW photo enters at the scene and is exposed onto a stock. A negative scan enters at the negative through the dye solve. Printing a scanned negative never requires undoing the film's curves or DIR coupling, because the enlarger only needs the dye amounts.

The rules that shape the design, with textbook sections:

| Rule | Consequence | Source |
|---|---|---|
| Balance colour by shifting log exposure (printer lights), never by adding density | Lights and filtration act on paper log H; the API refuses a density offset as a balance | §3.6, Hunt 14.17 |
| Printer lights factor out of the spectral sum: x(D, ℓ) = x(D, 0) + ℓ | Negative→paper exposure is tabulated once; light, exposure and warmth sliders are free per pixel | §2.8 |
| Convolve only in linear exposure | Halation, scatter and diffusion run before taking the log | §2.4 |
| DIR coupling acts before the characteristic curve | No "matrix after the curve" shortcuts | §2.3 |
| Gamut compression is the last colour step | No sharpening or gain after the knee | §2.7 |
| Three channels cannot recover the scene spectrum, the DIR coupling from one frame, or the stock's identity | The user names the stock; the app can only rank candidates from the rebate | §3.8 |
| Unreachable pixels are diagnostics (blank film, below base, out of gamut) | The solver residual is kept and classified, not discarded | §3.5 |
| Place work at its binding time (per stock, per scan, per setting, per pixel) | Tables keyed by content; the per-pixel chain is short | §4.1 |

## 3. System architecture

```text
 ┌──────────────────────────── apps/studio (UI, CHB-009) ─────────────────────────────┐
 │ library · viewer · generated controls · history/approvals · darkroom tools · chat   │
 └───────────────┬────────────────────────────────────────────────────┬───────────────┘
                 │ edits (mutations)                                   │ eval(code)
                 ▼                                                     ▼
 ┌──────── @chromobench/contract (CHB-002) ────────┐   ┌──── @chromobench/dsl (CHB-007) ────┐
 │ domains, units, op registry + catalog,           │◄──│ QuickJS sandbox, generated prelude,│
 │ recipe + edit log, engine interface, errors,     │   │ handles, results, errors, docs     │
 │ eval contract                                    │   └──────────────▲────────────────────┘
 └───────┬───────────────────────┬──────────────────┘                  │ transports (CHB-008)
         │ Engine interface      │                                      │ in-app chat · MCP bridge (Go)
         ▼                       ▼                                      │
 ┌ engine-mock (002) ┐ ┌ @chromobench/core (003, 012) ┐ ┌ @chromobench/gpu (005) ┐
 │ trivial maths     │ │ f64 reference physics        │ │ WebGPU tables, chain,   │
 └───────────────────┘ │ = oracle for the GPU          │ │ spatial kernels, tiles  │
                       └──────────────┬────────────────┘ └───────────┬─────────────┘
                                      │ data packs                    │
                       ┌──────────────▼──────────────┐  ┌────────────▼───────────────┐
                       │ @chromobench/data (004)      │  │ @chromobench/ingest (006)  │
                       │ stocks, CMFs, lamps, filters │  │ decoders, LibRaw WASM,     │
                       └──────────────────────────────┘  │ flat, rebate, σ, flare,    │
                                                         │ dust                       │
                       @chromobench/output (011): encoders, ICC (lcms2 WASM), soft proof
```

The UI and the DSL never call physics code directly. They talk to two things defined in `@chromobench/contract`:

- **The recipe and its edit log.** The persistent description of what the photographer did to a frame, changed only through a closed set of **mutations**.
- **The Engine interface.** "Evaluate this graph node at this scale and region", "measure this", "prepare these tables".

Three engines implement the Engine interface:

| Engine | Purpose | Precision |
|---|---|---|
| `engine-mock` | Trivial, deterministic maths so the UI, DSL and agent can be built before the physics exists | f64 |
| `reference` in `@chromobench/core` | The f64 implementation of the physics: the source of truth, also usable without a GPU | f64 |
| `gpu` in `@chromobench/gpu` | WebGPU implementation for interactive previews and exports | f32 (some f16 storage) |

All three must pass one **conformance suite** generated from the op registry: domains, units, shapes, error codes, determinism. The GPU engine must also match the reference within stated tolerances. That is a **parity test**: a fast path compared against the slow path on inputs where they could disagree, with the tolerance written down before the run and a deliberately broken variant that the test catches.

## 4. Vocabulary used by all tickets

The table defines terms in the order a newcomer needs them. Guides use them with exactly these meanings.

| Term | Meaning | Example |
|---|---|---|
| **Frame** | One picture in the library: a negative scan or a RAW photo | `frame_0042` from `roll-1975-07/scan_12.tif` |
| **Source** | The decoded file of a frame, identified by the SHA-256 of its bytes | `{path, sha256, bits: 16, encoding: 'linear'}` |
| **Stock** | A film or paper profile: sensitivities, unit dye spectra, base, curves | `kodak_portra_400`, `kodak_portra_endura` |
| **Scanner model** | The scanner's channel responsivities (light × filter × sensor) | `xt5-rgb-led` (three LEDs at 678/532/472 nm) |
| **Rebate** | Unexposed processed film at the frame's edge; it shows the base alone | box `{x:98,y:100,w:20,h:680}` |
| **Dye amounts** | Three numbers per pixel in units of the stock's unit dye spectra | grey card on Portra 400: `(0.687, 0.704, 0.864)` |
| **Printing density (PD)** | Channel density of the negative as the paper sees it (lamp × paper sensitivity) | three numbers per pixel |
| **Printer lights** | Per-layer offsets of paper log exposure, shown in **points** (1 point = 0.025 log H) | `+4 pt red` |
| **CC filtration** | Dichroic filter values in colour-correction units (1 CC = 0.01 D in the filter's band) | `M 51.6, Y 52.5` |
| **Domain** | The kind of data an image holds (§5.1) | `film-dyes` |
| **Op** | A named operation in the registry, with typed arguments | `print.expose` |
| **Node** | An immutable, hash-identified application of an op to inputs; nodes form a graph | `#a91f…: print.develop(#77c0…)` |
| **Handle** | What JavaScript (DSL or UI) holds instead of pixels: a reference to a node | `neg` in `const neg = frame.negative()` |
| **Recipe** | The persisted settings of a frame (stock, rebate, print settings, exposures, masks, output) | JSON document per frame |
| **Mutation** | One edit to a recipe, tagged with who made it | `{op:'set', path:'print.lights', value:[0,4,-2], by:'agent'}` |
| **Edit log** | The append-only list of mutations; the recipe state is its fold | — |
| **Ask mode** | Agent mutations wait in a pending queue until the user approves them | — |
| **Table** | A function of three numbers evaluated on an N³ grid and interpolated (e.g. the dye solve) | 33³ × RGBA32F |
| **Binding time** | When a quantity's inputs become known: per stock, per scan, per setting or per pixel | the solve table binds per scanner × film |
| **Law** | A property-based test stated by the textbook | "lights factor out of the spectral sum" |
| **Golden number** | A numeric result from the textbook used as an acceptance value | grey card prints at visual density 0.755 |
| **Look** | An image returned to the agent, always paired with the numbers it shows | test strip + densities per patch |

## 5. Contracts (owned by CHB-002, used by all)

The sketches below are TypeScript. They fix names and shapes; CHB-002 finalises them. Other guides may extend the catalog with new ops and new recipe fields through CHB-002's change process. They must not redefine these types.

### 5.1 Domains and units

```ts
// packages/contract/src/domains.ts (planned)
export type Domain =
  | 'camera-linear'     // linear sensor values: a negative scan, or a RAW photo before colour conversion
  | 'scene-xyz'         // scene-referred CIE XYZ (forward path input)
  | 'scanner-density'   // −log10(T/T_rebate) per scanner channel
  | 'film-logH'         // log10 exposure per film layer; grey card = 0      (spektrafilm tap log_e_film)
  | 'film-dyes'         // dye amounts c per layer                           (tap cmy_film)
  | 'printing-density'  // density of the negative as the paper sees it
  | 'paper-logH'        // log10 exposure per paper layer                    (tap log_e_print)
  | 'paper-dyes'        // paper dye amounts                                 (tap cmy_print)
  | 'print-xyz'         // XYZ of the print under the viewing light
  | 'display-rgb'       // encoded output RGB                                (tap rgb_out)
  | 'mask'              // one channel, 0..1
  | 'silver-density';   // reserved for black-and-white (CHB-014)

export interface ImageInfo {
  domain: Domain;
  width: number; height: number; channels: 1 | 3 | 4;
  umPerPx: { film?: number; paper?: number };    // physical scale; spatial physics is specified in µm
  encoding?: 'linear' | 'srgb' | 'gamma22';      // only for camera-linear sources before decoding
}

export type Unit =
  | 'D' | 'logH' | 'stop' | 'point' | 'CC' | 'mired' | 'K'
  | 'um' | 'nm' | 'px' | 's' | 'fstop' | 'fraction' | 'percent' | 'none';
```

Unit rules come from Chromogen's `units.js` (`05-inline.js` 142–216):

- a density and a log exposure never add;
- a stop converts to log H by 0.30103;
- a point is 0.025 log H.

### 5.2 Op registry

The registry is one schema. Several products are generated from it:

- the DSL's JavaScript methods and their documentation;
- the GUI's controls;
- the conformance tests;
- the agent's reference text.

It merges goja-cv's `OpDef`/`ArgSpec` (`pkg/cv/graph/registry.go`) with Chromogen Studio's declarative `SLIDERS` schema (`05-inline.js` 1003–1597).

```ts
// packages/contract/src/registry.ts (planned)
export type Kind = 'Image' | 'Mask' | 'Value' | 'Regions' | 'Table';
export type Area = 'source' | 'scan' | 'invert' | 'capture' | 'film' | 'print'
                 | 'view' | 'output' | 'mask' | 'measure' | 'darkroom' | 'finishing';

export interface OpDef {
  name: string;                       // dotted: 'print.expose'; the DSL exposes it as a method
  area: Area;
  on: Kind; returns: Kind;
  domainIn?: Domain | Domain[]; domainOut?: Domain | 'same';
  class: 'pointwise' | 'spatial' | 'global' | 'decoration' | 'measure';
  binding: 'stock' | 'scan' | 'setting' | 'pixel';   // binding time of its expensive part
  args: Record<string, ArgSpec>;
  recipePath?: string;                // where the persistent parameter lives, e.g. 'print.lights'
  doc: string; see?: string[]; examples?: string[];   // examples are executed in CI
}

export interface ArgSpec {
  type: 'number' | 'vec3' | 'enum' | 'bool' | 'string' | 'stockId' | 'box' | 'point'
      | 'Image' | 'Mask' | 'curve';
  unit?: Unit;
  min?: number; max?: number;               // hard range → E_ARG_RANGE
  usual?: [number, number]; usualHint?: string;   // soft range → warning
  values?: string[];                        // for enums
  default?: unknown;
  redirects?: string[];                     // names agents actually type, mapped to this one
  ui?: { widget?: 'slider' | 'wheel' | 'stepper' | 'segmented' | 'toggle' | 'select';
         step?: number; detents?: number[]; label?: string; group?: string };
  doc: string;
}
```

**The v0 catalog areas and representative ops.** CHB-002 writes all of them as stubs; the owning tickets implement them.

| Area | Representative ops | Domains | Owner |
|---|---|---|---|
| `source` | `source.open`, `source.info` | file → `camera-linear` | 006 |
| `scan` | `scan.flatField`, `scan.rebate`, `scan.density`, `scan.noise`, `scan.flare` | `camera-linear` → `scanner-density` | 006 |
| `invert` | `invert.dyes` (dyes plus residual), `invert.classify` | `scanner-density` → `film-dyes` | 003 |
| `capture` | `capture.expose` | `scene-xyz` → `film-logH` | 012 |
| `film` | `film.couple`, `film.halation`, `film.develop`, `film.grain` | `film-logH` → `film-dyes` | 012 |
| `print` | `print.expose`, `print.lights`, `print.develop`, `print.preflash` | `film-dyes` → `paper-logH` → `paper-dyes` | 003, 010 |
| `view` | `view.reflect`, `view.flare`, `view.adapt` | `paper-dyes` → `print-xyz` | 003 |
| `output` | `output.display`, `output.encode` | `print-xyz` → `display-rgb` | 003, 011 |
| `mask` | `mask.luminance`, `mask.gradient`, `mask.ellipse`, `mask.paint`, `mask.feather`, `mask.and/or/not` | any → `mask` | 009, 010 |
| `measure` | `measure.stats`, `measure.histogram`, `measure.densitometer`, `measure.patches` | any → Value | 003, 005 |
| `darkroom` | `darkroom.testStrip`, `darkroom.ringAround`, `darkroom.contactSheet` | Image → Image | 010 |
| `finishing` | `finishing.clarity`, `finishing.hue` (optional) | `display-rgb` | 015 |

### 5.3 Graph and engine interface

```ts
// packages/contract/src/graph.ts and engine.ts (planned)
export interface NodeRef { id: string /* sha256(op, canonical args, input ids) */; info: ImageInfo | ValueInfo }

export interface Engine {
  readonly id: 'mock' | 'reference' | 'gpu';
  capabilities(): EngineCaps;                              // max size, f16, timestamps…
  open(source: SourceRef): Promise<SourceInfo>;            // decode + hash (delegates to ingest)
  evaluate(node: NodeRef, target: EvalTarget): Promise<ImageResult>;
  measure(node: NodeRef, spec: MeasureSpec): Promise<Measurement>;
  prepare(keys: TableKey[]): Promise<void>;                // build or load content-keyed tables
  dispose(): void;
}
export interface EvalTarget {
  scale: number | 'full';                 // preview scale or full resolution
  region?: { x: number; y: number; w: number; h: number };
  precision: 'preview' | 'export';        // export: exact solve, tetrahedral lookup, tiled
}
```

**Compiling a recipe to a graph.** A recipe compiles to a graph with `compile(recipe, frameId) → NodeRef`. The UI renders that node. The DSL builds additional nodes from it for what-if questions ("print this with +4 red"); building a node never changes the recipe.

Nodes are hash-consed: the same op with the same canonical arguments and inputs always gets the same id. Engines cache results by `(node id, scale, region)`.

### 5.4 Recipe and edit log

```ts
// packages/contract/src/recipe.ts (planned, abridged)
export interface FrameRecipe {
  version: 1;
  frame: string;                                     // frame id
  source: { path: string; sha256: string; decode: DecodeOptions };
  kind: 'negative-scan' | 'digital-raw';
  scan?: { scanner: string; stock: string; rebate: Box | 'auto'; flat?: SourceRef;
           flare?: number; orientation: Orientation; crop?: Box };
  capture?: { stock: string; exposureEV: number; development: DevelopmentSettings };  // CHB-012
  print: {
    paper: string;
    enlarger: { mode: 'real' | 'normalised'; lamp: string; filtration: { c: number; m: number; y: number };
                time_s: number; fstop: number };
    lights: { logH: [number, number, number]; auto: AutoBalance };   // printer lights
    exposures: Exposure[];                                           // dodge, burn, flash, split (CHB-010)
    grade: number; preflash: number;
  };
  view: { illuminant: string; flare: number; output: OutputSettings };   // CHB-011
  finishing?: Record<string, number>;                                    // CHB-015
}
export interface Exposure {
  id: string; kind: 'main' | 'dodge' | 'burn' | 'flash' | 'split';
  mask?: MaskRef; time_s?: number; stops?: number; filtration?: { c: number; m: number; y: number };
}

// packages/contract/src/mutations.ts (planned)
export type Mutation =
  | { op: 'set'; path: string; value: unknown }
  | { op: 'exposure.add'; exposure: Exposure } | { op: 'exposure.remove'; id: string }
  | { op: 'mask.set'; id: string; mask: MaskSpec } | { op: 'frame.add'; recipe: FrameRecipe };
export interface LoggedMutation { m: Mutation; by: 'user' | 'agent' | 'auto'; tx?: string; ts: number; status: 'applied' | 'pending' | 'rejected' }
```

The edit log follows Filmbench IDE's `wb.apply` design (`01-inline.js` 2323–2375). Its rules:

- The state is the fold of applied mutations.
- Undo and redo move a cursor over the log.
- The state hash is SHA-256 of the canonical state.
- `why(path)` returns the mutations that produced a value.
- In ask mode, mutations tagged `by: 'agent'` wait as `pending` until the user approves them.

The set of mutation ops is closed and enforced by the engine host, not by the agent's good behaviour.

### 5.5 Eval contract and errors

```ts
// packages/contract/src/eval.ts (planned)
export interface EvalRequest { code: string; frame?: string; timeoutMs?: number }
export interface EvalResult {
  yaml: string;                 // returned value, ≤ 9000 chars, compact tables for record arrays
  looks: Look[];                // ≤ 4 images, each with caption and the numbers it shows
  warnings: Diagnostic[];       // with line numbers
  context: ContextBlock;         // frames, mem keys, new/changed functions with their doc lines
  mutations: LoggedMutation[];  // what the eval asked to change (applied or pending)
  error?: Diagnostic;
}
export interface Diagnostic { code: string; message: string; where?: { line: number; col?: number };
                              path?: string; hint?: string; fix?: string; valid?: string[] }
```

These shapes follow goja-cv's `cvsession` result processor (`pkg/cvsession/processor.go`) and its error type (`pkg/cv/graph/errors.go`). The `fix` field is literal code the agent can paste.

## 6. Planned repository layout

```text
chromobench/
  package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.workspace.ts, playwright.config.ts
  packages/
    contract/        CHB-002  domains.ts units.ts registry.ts catalog/*.ts graph.ts engine.ts recipe.ts
                              mutations.ts editlog.ts eval.ts errors.ts
    engine-mock/     CHB-002  trivial deterministic implementation of every catalog op
    conformance/     CHB-002  suite generated from the registry; run against every engine
    core/            CHB-003  spectral/ (grid, spectrum, channels, linalg)  scan/ (scanner, solve, classify)
                              print/ (enlarger, lights, paper, view, colour, gamut)  engine-ref.ts  laws/
                     CHB-012  film/ (upsample, couple, curves, halation, grain, develop)
    data/            CHB-004  loader.ts, packs/ (versioned JSON + binary tables), LICENSES
    gpu/             CHB-005  device.ts pool.ts tiles.ts tables/ kernels/*.wgsl engine-gpu.ts parity/
    ingest/          CHB-006  decode/ (tiff, png16, dng, triplet) libraw/ (wasm build + worker)
                              conditioning/ (flat, rebate, sigma, flare, classify, dust)
    dsl/             CHB-007  sandbox/ (QuickJS) prelude/ (generated) handles.ts results/ docs/
    agent/           CHB-008  channel.ts chat/ playbooks/*.js harness/
    output/          CHB-011  encode/ (png16, tiff16) icc/ (lcms2 wasm) proof/
  apps/
    studio/          CHB-009  the PWA: library, viewer, controls, history, darkroom tools, chat panel
  bridge/            CHB-008  Go module: cmd/chromobench (go:embed app, HTTP, WebSocket, MCP server)
  tools/
    spektrafilm-export/  CHB-004  Python exporter producing packages/data/packs
    gen-docs/            CHB-002/007  registry → .d.ts, reference pages, agent reference
  fixtures/
    golden/          textbook numbers as JSON (owned by the ticket whose laws use them)
    scans/           Gold 200 sample (from Chromogen Studio), the photographer's samples (CHB-013)
    synthetic/       frames with known truth generated from the forward model
```

## 7. Where the existing material is

All paths are relative to `ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`.

**Textbook:** `sources/The Mathematics of the Colour Negative.md`

| Chapter | Sections | Topics |
|---|---|---|
| 1 | §1.1–1.9 | spectra, Beer–Lambert, soft minimum, Jacobian K, base and rebate, density noise, spectral upsampling, chapter API |
| 2 | §2.1–2.9 | nine typed maps, characteristic curve, DIR coupling, halation, grain, printing, viewing, composition laws, chapter API |
| 3 | §3.1–3.9 | scanner model, flat field, dye solve, LM, active set, reachability classes, grey balance, calibration, limits, chapter API |
| 4 | §4.1–4.9 | binding time, tables, blurs, GPU passes, WebGPU compute, workers, fast/slow proofs, rules, chapter API |

Each chapter ends with a "Toward a reusable API" section and a list of laws. These are the seeds of the tests.

**Other theory sources:**

- *Light, Film, Paper* chapter 1: `various/extracted/light-film-paper/lfp-ch1-01-light.txt`. RGB → spectrum, metamers, the hanatos chromaticity table, the 64×64 film table and the bandpass window.

**Chromogen Studio 1.2:**

- Code: `various/extracted/chromogen-studio/05-inline.js`. The module map is in `various/analysis-chromogen-studio.md`. Main ranges:

  | Lines | Module |
  |---|---|
  | 142–216 | `units.js` |
  | 218–383 | `spectrum.js` |
  | 385–475 | `stock.js` |
  | 477–567 | `channels.js` |
  | 569–645 | `linalg.js` |
  | 647–790 | `solve.js` |
  | 792–864 | `print.js` |
  | 866–932 | `colour.js` |
  | 934–1612 | `spec.js` (constants `K`, `SLIDERS`) |
  | 1620–1901 | `model.js` (tables) |
  | 1903–2085 | `shaders.js` (GLSL) |
  | 2087–2193 | `params.js` |
  | 2195–2413 | `decode.js` |
  | 2415–2692 | `source.js` (flat, rebate, σ, classify) |
  | 2694–3228 | `render.js` |
  | 3230–3387 | `export.js` |
  | 3392–3604 | `gpu.js` (WGSL) |
  | 3606–3843 | `accel.js` (workers, benchmark) |
  | 3845–4512 | `state.js` (store, recipes, `st:` commands) |

- Worker bundle: `various/extracted/chromogen-studio/04-st-worker.txt.js`.
- Embedded data, unpacked: `various/extracted/chromogen-studio/st-data/` (8 films, 3 papers, the camera and LED, 13 book chapters).
- Sample scan: `sources/chromogen-studio-1.2/samples/gold200.png`.

**Filmbench IDE:**

- Code: `various/extracted/filmbench-ide/01-inline.js`. Report: `various/analysis-filmbench-ide.md`.

  | Lines | Part |
  |---|---|
  | 1–701 | engine `FB` |
  | 703–1034 | image kit `CV.Img` |
  | 1107–2913 | V2 runtime; within it, parameters 1214–1316, net/pipeline 1458–1739, control plane 1796–2117, bench 2203–2503, workspace 2629–2913 |
  | 4505–4631 | agent `lab` |
  | 4648–4707 | agent system prompt |

- Built-in scripts: `various/extracted/filmbench-ide/vfs/`.
- Decoded data summary: `various/extracted/filmbench-ide/film-data-summary.json` (20 films, 8 papers, neutral filters, dichroics, CAT16 matrices).

**goja-cv:** `~/code/wesen/go-go-golems/goja-cv` at `5a93095`. Report: `various/analysis-goja-cv.md`.

| File | What it shows |
|---|---|
| `pkg/cv/graph/registry.go` | `OpDef`, `ArgSpec` |
| `pkg/cv/graph/node.go`, `eval.go`, `cache.go` | Hash-consing, evaluation, cache |
| `pkg/cv/graph/errors.go` | Structured errors |
| `pkg/gojamod/cv/prelude.js`, `binding.go` | Handles and proxies |
| `pkg/cvsession/processor.go`, `tables.go`, `reference.go`, `mcp.go` | Results, tables, agent reference, MCP |
| `pkg/cv/ops/peaks.go`, `pkg/cv/ops/composite.go` | Dust peaks; `within` for masks |
| `pkg/cv/look/golden_test.go`, `pkg/cvsession/docs_test.go` | Golden images; tests that run the docs |

**spektrafilm (upstream, public):** `github.com/andreavolpato/spektrafilm`. The textbook cites these modules:

| Module | Contents |
|---|---|
| `model/couplers.py` | DIR coupling |
| `model/diffusion.py` | Halation and scatter kernels |
| `model/grain.py` | Grain |
| `model/color_filters.py` | Dichroic filters |
| `runtime/stages/{filming,printing,scanning}.py` | The pipeline stages |
| `runtime/params_builder.py` | DIR matrices, halation presets, neutral filters |
| `utils/spectral_upsampling.py` | Spectral upsampling |
| `utils/gamut_compression.py` | Gamut compression |
| `utils/fast_interp_lut.py` | LUT interpolation |

Its stock data is licensed CC BY-SA 4.0.

## 8. The work plan

### 8.1 Tickets

| Ticket | Scope (internal stages) | Depends on | Builds against |
|---|---|---|---|
| **CHB-002** Contract and walking skeleton | repo and toolchain → domains and units → registry and v0 catalog stubs → recipe and edit log → engine interface → mock engine → conformance suite | — | — |
| **CHB-003** Scan-to-print physics (f64) | spectral core and channels → print chain → inversion | 002 | interim data from Filmbench and Chromogen; textbook golden numbers |
| **CHB-004** Stock and reference data | spektrafilm exporter → data packs and loader → CIE tables, lamps, filters, cameras → synthetic frames | 002 (types) | — |
| **CHB-005** WebGPU engine | runtime and tiles → tables → per-pixel chain → spatial kernels | 002; 003 as oracle | mock data until 004 |
| **CHB-006** Ingest and scan conditioning | decoders → LibRaw WASM → flat, rebate, σ, flare → classification map, stock ranking, dust | 002 | — |
| **CHB-007** DSL runtime | QuickJS sandbox → generated prelude and handles → results, errors, context block → docs | 002 | mock engine |
| **CHB-008** Agent integration | eval channel → Go MCP bridge → in-app chat → playbooks and evaluation harness | 002, 007 | mock engine |
| **CHB-009** Studio app UI | PWA shell and library → viewer and generated controls → history and approvals → darkroom tool UIs | 002 | mock engine |
| **CHB-010** Darkroom printing | real-enlarger mode → multi-exposure masks → density masking → filter fast path → test strips and ring-arounds | 003, 005, 009 | — |
| **CHB-011** Output and colour management | 16-bit encoders → ICC embedding and lcms2 → soft proofing → tiled export | 003, 005 | — |
| **CHB-012** Forward film and digital RAW | upsampling and exposure → DIR and curves → halation and grain → development model → RAW photo path | 004, 005, 006 | — |
| **CHB-013** Calibration and beta | capture of the photographer's setup → scanner characterisation → sample rolls → beta sessions | 006, 010, 011 | — |
| **CHB-014** Black and white | silver density model, B&W stocks, variable-contrast papers, enlarger heads | 003, 010 | — |
| **CHB-015** Extensions | fading restoration, reprint as another stock, Saunderson reflectance, Newson grain, finishing operators | 003, 012 | — |

### 8.2 Milestones and critical path

| Milestone | Made of | Shows |
|---|---|---|
| **M1 Walking skeleton** | 002 plus first slices of 007 and 009 | A 16-bit TIFF opens, goes through mock inversion and a mock print to the screen; editable from the UI and the DSL, with undo |
| **M2 Correct print** | 003 stages 1–2, 005 per-pixel print | Printing a dye image matches the golden numbers |
| **M3 Real inversion** | 003 stage 3, 005 tables, 006 | The Gold 200 sample end to end |
| **M4 Darkroom** | 010, 009 tools, 008 playbooks | Real enlarger, test strips, dodge/burn/split; the agent runs a test strip |
| **M5 Beta** | 006 LibRaw, 011, 013 | The photographer's own RAWs and scans, 16-bit and ICC output |
| **M6 Forward path** | 012 | RAW photos "shot" on stocks |
| **M7 Extensions** | 014, 015 | Black and white, fading restoration, physical reflectance |

The critical path is 002 → 003 → 005 (tables and chain) → 010 → 013. Tickets 004, 006, 007, 008 and 009 run in parallel beside it. They plug in behind the Engine interface without changing the UI or the DSL.

### 8.3 Rules every ticket follows

- **Tests are acceptance criteria:**
  - the textbook's laws, as property tests with a seeded random generator and counterexample shrinking (Chromogen's `laws.js` design, textbook §2.8);
  - golden numbers in `fixtures/golden/`;
  - the conformance suite for every engine the ticket touches;
  - parity tests with tolerances stated in advance.
- **Units are in names** where a number could be misread: `time_s`, `umPerPx`, `logH`.
- **Precision:** the reference engine is f64. The GPU engine is f32 with explicit tolerances (textbook §4.5).
- **Contract changes are edits to CHB-002's catalog,** made through a short note in CHB-002's changelog. That keeps the parallel tickets independent.
- **Every ticket keeps a diary** (diary skill, investigation format) and relates its primary files with `docmgr doc relate`.

### 8.4 Open decisions

These are decisions the photographer's answers will settle:

- Does "digital RAWs" mean camera photos, camera scans of negatives, or both? This decides whether CHB-012 comes before the beta.
- What capture setup does the photographer use (narrowband RGB LEDs, white light with a camera, or a film scanner)? It sets CHB-006 and CHB-013 priorities.
- Black and white: in or out of the first beta (CHB-014)?
- Output target: screen and files only, or real prints with ICC soft proofing (CHB-011)?
- Hosting: a static PWA, or the Go bridge binary that serves it (CHB-008)?
