---
Title: 'Intern guide: Contract and walking skeleton'
Ticket: CHB-002
Status: active
Topics:
    - architecture
    - js-api
    - dsl
    - testing
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cv/graph/args.go
      Note: canonical arguments, range checks, unknown options with redirects
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cv/graph/node.go
      Note: hash-consed nodes and the node hashing scheme
    - Path: abs:///home/manuel/code/wesen/go-go-golems/goja-cv/pkg/cv/graph/registry.go
      Note: OpDef/ArgSpec and Register validation to port
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/design-doc/01-chromobench-architecture-and-work-plan.md
      Note: the contract sketches (§5) and layout (§6) this ticket finalises
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/sources/The Mathematics of the Colour Negative.md
      Note: §1.1–1.2 unit and kind rules, §2.8 composition laws and the law harness
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/analysis-goja-cv.md
      Note: goja-cv design, evidence and what does not transfer
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/chromogen-studio/05-inline.js
      Note: units.js, spectrum.js, the SLIDERS schema and state.js recipe and history
    - Path: repo://ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/various/extracted/filmbench-ide/01-inline.js
      Note: parameter table, diagnostics and the edit-log model (apply, by tags, pending, tx, undo, state hash) at 1131–2503
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-11T10:38:21.967389596-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: Contract and walking skeleton

## 1. What this ticket is for

Chromobench is a browser darkroom for one photographer. It prints colour negatives and digital RAW files through a physical model of an enlarger, colour paper and a viewing light. The architecture document (CHB-001 `design-doc/01-chromobench-architecture-and-work-plan.md`, called "the architecture doc" below) splits the work into fourteen tickets. Most of them are meant to run at the same time: the f64 physics (CHB-003), the stock data (CHB-004), the WebGPU engine (CHB-005), ingest (CHB-006), the agent DSL (CHB-007), the agent transports (CHB-008) and the studio UI (CHB-009).

Parallel work only goes well if every ticket compiles against the same names and shapes from day one. CHB-002 builds those shared pieces and proves that they fit together. It delivers:

- the repository and toolchain that every other ticket works in;
- `@chromobench/contract`, a package containing:
  - the **domains** and **units** that every number in the system carries;
  - the **op registry** and a **v0 catalog** of every planned operation, written as stubs;
  - the **graph** of hash-identified nodes;
  - the **recipe** and its **edit log**;
  - the **Engine interface**;
  - the error and eval types;
- `engine-mock`, an engine that implements every catalog op with trivial, deterministic maths;
- `@chromobench/conformance`, a test suite generated from the registry that every engine must pass;
- the **M1 walking skeleton**: a 16-bit TIFF opens, goes through a mock inversion and a mock print to the screen, can be edited from the UI and from the DSL, and can be undone.

The photographer sees almost nothing of this ticket directly, but every later feature passes through it:

- a slider is an argument spec with UI hints;
- dragging that slider produces a mutation;
- undo moves a cursor over the edit log;
- an agent's proposal is a pending mutation that waits for approval;
- a GPU kernel is correct when it passes the conformance suite and matches the reference engine.

**What this ticket does not do.**

- No physics: CHB-003 and CHB-012 own the reference maths.
- No WebGPU kernels: CHB-005 owns them. This ticket only proves that headless Chromium can run WebGPU in CI.
- No real decoders: CHB-006 owns them. The mock engine carries a small, temporary reader for uncompressed 16-bit TIFF so that M1 can open a file.
- No QuickJS sandbox: CHB-007 owns it.
- No real studio UI: CHB-009 owns it. This ticket creates only the minimum page needed for the M1 end-to-end test.

**Status.** Everything below is a proposal. None of the planned paths (`packages/…`, `apps/…`, `tools/…`, `fixtures/…`) exists yet. The existing material lives under `ttmp/` and in `~/code/wesen/go-go-golems/goja-cv`. Below, "C1" means the CHB-001 ticket directory, `ttmp/2026/11/11/CHB-001--source-import-and-analysis-colour-negative-modelling-for-a-darkroom-suite/`.

### 1.1 Why the contract comes first

The usual way to build a system like this is to write the physics, wrap it in an API, and then build a UI and an agent interface on top. Done that way, the UI waits for the physics, the agent waits for the API, and each layer names things its own way. In Filmbench IDE, one of the two prototypes, the slider "Print exposure", the parameter path `enlarger.print_exposure` and the darkroom macro "print stops" all describe one quantity. They are kept consistent by hand.

Chromobench reverses that order. CHB-002 first fixes the vocabulary and the shapes, then provides an engine that honours them with fake maths. Every other ticket then has something real to build against:

| Ticket | What it builds against | Why it can start before the physics exists |
|---|---|---|
| CHB-003 reference physics | `Engine`, catalog op signatures, conformance suite | It replaces mock maths op by op; the conformance suite says when an op is done |
| CHB-004 stock data | `stockId` arguments, unit names, domain names | Data packs are typed by the contract, not by the physics code |
| CHB-005 WebGPU engine | `Engine`, conformance suite, parity tests against CHB-003 | It can render the mock chain on the GPU before the real maths lands |
| CHB-006 ingest | `source.*` and `scan.*` ops, `SourceInfo`, the `camera-linear` and `scanner-density` domains | Its output is checked against domain and shape rules, not against a finished print |
| CHB-007 DSL | the registry, from which it generates methods; `EvalRequest`/`EvalResult`; mutations | The mock engine answers `await` with real numbers |
| CHB-008 agent integration | the eval contract | It drives the DSL against the mock engine |
| CHB-009 studio UI | `ArgSpec.ui` hints, mutations, the edit log, `Engine.evaluate` | Controls are generated from the registry; images come from the mock engine |

Two facts make this work.

1. **One registry generates everything that names an operation.** goja-cv, the Go project whose design the DSL follows, keeps every op in one registry, `pkg/cv/graph/registry.go`. Its comment at line 313 calls it "the single source of truth for every op the agent can call". The JavaScript methods, the help text, the reference document and the did-you-mean errors are all generated from it. Chromobench extends the same idea to the GUI's controls and to the conformance tests. A rename then happens in one place, and every consumer either follows automatically or fails to compile.
2. **Engines are interchangeable behind one interface.** The mock engine, the reference engine and the GPU engine implement the same `Engine` and pass the same conformance suite. A ticket that consumes images does not need to know which engine produced them.

The cost of contract-first is that the contract becomes something other tickets depend on. Changing it after v0 needs a process; section 7 describes it.

## 2. Background you need

This section explains the concepts the contract encodes. Each one guards against a class of bug that the prototypes or the textbook actually measured.

### 2.1 The darkroom chain, briefly

A colour negative holds three dyes: cyan, magenta and yellow. In each pixel their amounts, the **dye amounts** `c = (c_C, c_M, c_Y)`, describe the negative completely, given the stock's unit dye spectra. To print, an enlarger shines a lamp through filters and through the negative onto colour paper. Each of the paper's three layers records a **log exposure** `x_k = log₁₀ H_k`. The paper develops into its own dye amounts, and the print is then seen under a viewing light. The architecture doc §2 draws the full forward chain (scene → film → print) and the inverse chain (scan → dye amounts). Both chains meet at the negative's dye amounts.

The photographer's controls act at particular points in this chain:

- **Printer lights** are offsets added to the paper's log exposure, one per layer. They are counted in **points** of 0.025 log H.
- **Filtration** is the colour head's dichroic filter setting, in CC units.
- **Exposure time**, the **f-stop** and the **paper grade** complete the print settings.

### 2.2 Domains: what kind of number is this?

Every image in the system holds numbers of one particular kind. The contract calls that kind a **domain**. `film-dyes` holds dye amounts, `paper-logH` holds paper log exposures, `scanner-density` holds what the scanner's channels read, and so on (the architecture doc §5.1 lists all twelve). Domains exist because the commonest mistakes in this field apply a correct operation to the wrong kind of number.

Here is a concrete example from textbook §2.8 ("Composition laws"). Suppose you want a print slightly less dense. The correct control is a printer light, a shift of the paper's log exposure. A tempting shortcut is to subtract a density offset from the result instead. The textbook measured both on Portra 400 printed onto Portra Endura:

- A printer light of 0.1 log H changes the paper's green dye by 0.021 near the paper white, by 0.219 at the grey card and by 0.092 in the shadows.
- A density offset tuned to have the same effect at the grey card adds 0.198 everywhere. Near the paper white, that is ten times what the light does.

The reason is that the paper's characteristic curve does not commute with a shift. Applying the shift before the curve is not the same as applying an offset after it. The contract therefore makes `print.lights` accept only `paper-logH` input, and the unit rules refuse to add a density to a log exposure. Chromogen Studio, the other prototype, does the same. Its error message names the source: "a density offset is not a log-exposure shift (Hunt 14.17)" (`C1/various/extracted/chromogen-studio/05-inline.js` line 166).

### 2.3 Units and the conversions that are allowed

A **unit** says how a number is scaled within its domain. These are the conversions the system relies on, with worked numbers:

- **Stop and log exposure.** One stop is a factor of 2 in exposure, so it is `log₁₀ 2 = 0.30103` log H.
- **Point and log exposure.** One printer point is 0.025 log H. One stop is therefore `0.30103 / 0.025 = 12.04` points.
- **Time and stops.** Going from 10 s to 12.6 s is `log₂(12.6/10) = 0.333` stop. That is `log₁₀(1.26) = 0.1004` log H, or 4.01 points.
- **f-number and stops.** Exposure goes as `1/N²`. Stopping down from f/8 to f/11.31 changes exposure by `2·log₂(8/11.31) = −1.000` stop. Lens markings round 11.31 to "11".
- **CC units and density.** A dichroic filter of `v` CC has transmittance `10^(−v/100)` inside its blocking band. So 1 CC is 0.01 D in the filter's band, and a 50 CC filter transmits 0.316 there (textbook §2.6, after spektrafilm's `apply_cc`).
- **Density and log exposure.** These never convert into each other. Only a characteristic curve maps one to the other.

Units also go into names wherever a number could be misread: `time_s`, `umPerPx`, `aperture_px`, `logH` (architecture doc §8.3).

### 2.4 Spectrum kinds

Light is stored as a spectrum of 81 samples, from 380 to 780 nm in 5 nm steps. Chromogen's `spectrum.js` (`05-inline.js` 218–383) attaches a **kind** to every spectrum: power, reflectance, transmittance, density or responsivity. Two rules follow from the kind:

- `mul` refuses a density: "densities add; multiply transmittances instead".
- `add` refuses a transmittance: "transmittances multiply; add densities instead".

Textbook §1.2 gives the worked example the tests will use. At 550 nm the grey card's parts are cyan −0.0264, magenta 0.888, yellow 0.0022 and base 0.6024. Their densities sum to 1.4662. Their transmittances, 1.0626 × 0.1294 × 0.9950 × 0.2498, multiply to 0.03418, which is `10^−1.4662`. Converting a transmittance of zero gives 8 D, because Chromogen clamps T at 10⁻⁸ before taking the logarithm.

The numeric spectral code belongs to CHB-003 (`packages/core/spectral/`). The contract owns only the grid constant, the kind names and the kind algebra, so that every ticket enforces the same rules.

### 2.5 Ops, nodes, handles and hash-consing

An **op** is a named operation in the registry, such as `print.expose`. Its definition says:

- which domain it takes and which it produces;
- its arguments, with their types, units and ranges;
- where its persistent parameter lives in the recipe.

A **node** is one application of an op to particular inputs and arguments. Nodes are immutable and form a graph. A **handle** is what JavaScript holds instead of pixels: a reference to a node.

Nodes are **hash-consed**. A node's id is the SHA-256 of three things: the op name, the canonical arguments and the input node ids. Two structurally identical calls therefore get the same id. A small example:

```text
#3f1a… = invert.dyes(#9c02…, {scanner:"xt5-rgb-led", stock:"kodak_portra_400"})
#77c0… = print.expose(#3f1a…, {fstop:8, lamp:"TH-KG3", paper:"kodak_portra_endura", time_s:10, …})
#a91f… = print.lights(#77c0…, {logH:[0,0,0]})
#b2e4… = print.lights(#77c0…, {logH:[0.1,0,0]})   ← a what-if: new node; #77c0… and everything above it are reused
```

Notice what the ids buy. Engines cache results by node id. When only the printer lights change, every node above `print.lights` keeps its id, and the engine reuses its cached results. Filmbench gets the same effect by hand: it hashes, for each stage, the slice of parameters that stage reads (`C1/various/extracted/filmbench-ide/01-inline.js` lines 1596–1613). Hash-consing gives the same reuse without anyone listing which parameters each stage depends on.

### 2.6 Recipes and the edit log as a fold

A **recipe** is the persisted description of what was done to one frame: the stock, the rebate box, the print settings, the exposures, the masks and the output settings. It is never edited in place. Every change is a **mutation**, for example `{op:'set', path:'print.enlarger.time_s', value:12.6}`, appended to an **edit log** together with who made it (`by`) and when. The recipe the UI shows is the **fold** of the log: start from the initial recipe and apply the mutations that are in effect, in order.

```text
initial recipe     time_s 10, lights [0,0,0]
#1 set time_s 12.6      by user
#2 set lights [0.1,0,0] by agent (approved)
fold(#1,#2)        time_s 12.6, lights [0.1,0,0]
undo               → fold(#1) = time_s 12.6, lights [0,0,0]
```

Because the state is a fold, several things come out of the same structure:

- **Undo** moves a cursor back.
- **Provenance**: `why(path)` lists the mutations that wrote a value.
- **Ask mode**: an agent's mutation can wait outside the fold until the photographer approves it.
- **State hash**: a SHA-256 of the folded recipe, so two people, or two runs of a test, can check that they reached the same state.

### 2.7 Laws and property tests

The textbook states its claims as **laws**: properties that must hold for all inputs, not just for one example. One is "printer lights factor out of the spectral sum: x(D, ℓ) = x(D, 0) + ℓ". A law becomes a **property test**:

1. A seeded random generator draws many inputs.
2. The test checks the property on each one.
3. On a failure, the test **shrinks** the counterexample: it tries simpler inputs that still fail, so the failing case it reports is small.

Chromogen's `laws.js` implements this (textbook §2.8, "The laws Chromogen checks"). `law(name, gen, prop, meta)` refuses to build a law without a `justifies` field, because "without it this is an example, not a law". The check function draws `n` inputs from a seeded `mulberry32` generator and shrinks failures towards zero and two decimals. Its eight laws pass at n = 30 in 116 ms. One of them, `channels.rebate.zero`, cannot fail: it reads the base through the same channels twice and subtracts. The lesson for this ticket is that every test needs a deliberately broken variant that it catches.

## 3. How this ticket fits the system

```text
                 ┌───────────── @chromobench/contract (CHB-002) ─────────────┐
                 │ domains · units · spectrum kinds · errors                 │
                 │ registry + v0 catalog (stubs) · graph (hash-consing)      │
                 │ recipe · mutations · edit log · Engine · eval types       │
                 └──┬──────────┬──────────┬───────────┬───────────┬─────────┘
       generated:   │          │          │           │           │
  .d.ts, docs,      │          │          │           │           │
  snapshot, tests   ▼          ▼          ▼           ▼           ▼
            apps/studio   packages/dsl  engine-mock  core (003)  gpu (005)
            (009: controls (007: methods (002: every  reference   WebGPU
             from ArgSpec)  from registry) op, f64)   engine      engine
                                              │           │           │
                                              └─────┬─────┴─────┬─────┘
                                                    ▼           ▼
                                     packages/conformance (002): one suite, every engine
```

The packages this ticket creates:

| Package or path | Contents | Planned files |
|---|---|---|
| `packages/contract` | All shared types and the pure functions that enforce them | `domains.ts units.ts spectrum.ts registry.ts catalog/*.ts graph.ts engine.ts recipe.ts mutations.ts editlog.ts eval.ts errors.ts laws.ts` |
| `packages/engine-mock` | `MockEngine` implementing every catalog op | `engine-mock.ts ops/*.ts tiff16.ts` |
| `packages/conformance` | Cases generated from the registry, engine runner, mutants | `generate.ts run.ts mutants.ts` |
| `tools/gen-docs` | registry → `.d.ts`, reference pages, catalog snapshot (shared with CHB-007) | `main.ts` |
| `tools/wgsl-check` | Headless WebGPU smoke test and WGSL compile check | `check.spec.ts` |
| `fixtures/synthetic` | The M1 negative | `m1-negative-96x64.tif` |
| `e2e/` | Playwright tests, starting with M1 | `m1-walking-skeleton.spec.ts` |

The contract reads and writes no domain itself. It defines all of them, and it enforces their rules wherever a node is built or a mutation is checked.

**What depends on what.**

- CHB-002 depends on nothing.
- Every other ticket depends on CHB-002's types.
- CHB-007 and CHB-009 also need `engine-mock` to make progress before CHB-003 and CHB-005 land.
- M1 needs the first slices of CHB-007 (eval) and CHB-009 (generated controls). CHB-002 owns the M1 end-to-end test and the integration.

## 4. What exists today and what to take from it

### 4.1 goja-cv (`~/code/wesen/go-go-golems/goja-cv` at `5a93095`)

goja-cv is a Go image engine driven by agents through JavaScript. The report `C1/various/analysis-goja-cv.md` §2–4 explains it. These are the files to read for this ticket:

| File and lines | What it shows | What to do |
|---|---|---|
| `pkg/cv/graph/registry.go` 149–182 | `ArgSpec`: type, unit, default, `Min`/`Max` (hard → `E_ARG_RANGE`), `Usual` + `UsualHint` (soft → `RANGE` warning), `Options`, `Redirects`, `Doc` | Port the semantics into the TypeScript `ArgSpec` |
| `registry.go` 235–299 | `OpDef`: on/returns kinds, space rule, class, `Identity`, `Global`, `AnalysisScale`, `Fields`, `Validate`, `Run`, `Doc`, `See` | Take the metadata. Leave `Run` out: here engines implement ops (DR-1) |
| `registry.go` 326–366 | `Register` validation: a name, exactly one of Run/Expand, no duplicate args, no required positional after an optional one, every arg typed | Port as `registerOp` checks, plus the chromobench checks in §5.4 |
| `pkg/cv/graph/node.go` 17–32, 197–217, 406–428 | `Node`, `internNode` (returns the existing node for the same hash), `hashNode` (length-prefixed op key, canonical args JSON, metadata, input hashes) | Port the hashing scheme in TypeScript |
| `pkg/cv/graph/args.go` 455–462, 466–500 | Canonical args: defaults filled, ints and floats normalised, `-0` folded | Port; note the pitfall that `channel(2)` and `channel("b")` hashed differently (report §3.5) |
| `args.go` 741–756, 1045–1080 | Range check (non-finite → `E_ARG_RANGE`; outside `Usual` → `RANGE` warning); unknown option → `E_UNKNOWN_OPTION` with valid list, redirect or did-you-mean | Port into the binder |
| `pkg/cv/graph/suggest.go` 25–71 | Case-insensitive Levenshtein with transpositions; edit budget `max(1, min(3, len/3))` | Port verbatim as `closest()` |
| `pkg/cv/graph/eval.go` 103–111, 237–264, 289–294 | Scale quantised to 1e-4 in cache keys; signature = node hash + scale + input signatures; `singleflight` deduplicates identical work | Specify as Engine cache rules; engines implement them |
| `pkg/cv/graph/cache.go` 12–119 | Byte-capped LRU; warnings stored with entries and replayed on a hit | Specify for engines: a cache hit must return the original warnings |
| `pkg/cv/graph/errors.go` 15–50 | Fixed codes; `Error{Code, Message, Path, Hint, Fix, Valid, Line}` | `Diagnostic` in the architecture doc §5.5 already mirrors it; port the code list |

**Leave behind:** goja-cv's live parameters. GCV-001 had `P.slider` params. GCV-004 deleted them after agents used them zero times in 751 evals (report §3.6, §5.1 item 3). Chromobench needs human controls, but it puts them in the recipe rather than in the graph (§5.8). Leave behind CPU-only full-frame evaluation too (report §5.2). That belongs to engines, not to the contract.

### 4.2 Filmbench IDE (`C1/various/extracted/filmbench-ide/01-inline.js`)

Filmbench's V2 runtime is the closest existing design for the edit log. The report is `C1/various/analysis-filmbench-ide.md`.

| Lines | What it shows | What to do |
|---|---|---|
| 1131–1176 | `lev`, `nearest` (did-you-mean), `diag(code, msg, {mean, list, fix})`, `warn`, and `guard`, a Proxy that turns an unknown member into `E_MEMBER` | Same idea as goja-cv; use goja-cv's `closest` for one algorithm |
| 1214–1316 | Parameter table: 44 rows in 8 groups, each with path, label, kind (num/bool/enum/id), min, max, step, unit, log flag; `ParamTable.check` throws `E_PATH` with siblings; `coerce` **clamps** out-of-range numbers and raises `W_CLAMP` | Take the row fields as `ArgSpec.ui` hints and the `E_PATH` diagnostic. Do not clamp silently (DR-2) |
| 1430 | `TAP_TYPE`: `src` Scene, `log_e_film` LogExposure, `cmy_film` Density, `log_e_print` LogExposure, `cmy_print` Density, `out` RGB | These are domains under other names; the architecture doc §5.1 maps them |
| 1538–1554 | `Net.insert` refuses a stage whose input type differs from the tap's type (`E_PORT_TYPE`) and lists legal taps | The domain check in `intern` |
| 1596–1613 | `keyOf`: a stage's cache key is a hash of its parameter slice and its input keys | Replaced by hash-consing |
| 1806–1816, 1862–1876 | Layer algebra (`set/add/mul/stops/keep` with opacity); `why(path)` prints each layer's contribution down to the effective value | Take the shape of the `why()` output. Leave layers for later: v0 has no look or macro layers |
| 2203–2213 | `Bench`: `log`, `undoStack` and `redoStack` of snapshots, `pending`, `agentCfg.mode` | Model for the edit log, with the fixes below |
| 2323–2338 | `apply(m, by)`: read-only mode refuses; ask mode queues `by:'agent'` into `pending`; drags are coalesced (`param.set` on the same path by the same author within 900 ms); entries get `id, by, t, tx` | Port the `by` tags, modes and pending queue. Replace timer coalescing with explicit gestures (DR-6) |
| 2339–2376 | `_exec`: the closed op set (`param.set`, `param.reset`, `macro.set`, `layer.*`, `pin.*`, `pipe.*`, `preset.*`, then the workspace ops); an unknown op is `E_OP` with did-you-mean | Port the idea of a closed, host-enforced set; the chromobench set is in the architecture doc §5.4 |
| 2380–2390 | `tx(name, fn)` = one undo step; `undo`/`redo` restore snapshots; `approve`/`skip`/`approveAll` | Port, with a cursor over units instead of snapshot stacks (DR-5) |
| 2394–2401, 2210 | State hash over the parameters, layers and nets; a separate log hash over `(op, by, path, value)` | Keep both hashes, but use SHA-256 over canonical JSON |

**Known problems to fix rather than port:**

- **Dead code in the op switch.** Line 2370 is a second `case 'pipe.scene'` that returns a description string. It is unreachable.
- **Structural edits bypass the log.** `rig.insert`, `drop`, `fork` and `engine()` call `_touch()` directly, so they are neither logged nor undoable (lines 1522–1563; report §2).
- **The author tag is a mutable global.** `V2.by` is set to `'agent'` while agent code runs (line 4735). The agent's own code could flip it back. In chromobench the host that receives the mutation sets `by`; sandboxed code never can.
- **The hash is not cryptographic.** `hash` is the 53-bit cyrb53 function over stable JSON (lines 1121–1129). Use SHA-256.
- **Undo and the log can disagree.** Undo snapshots are capped at 150 and the log at 600 entries (lines 2322, 2336). Here undo is derived from the log itself, so the two cannot disagree.

### 4.3 Chromogen Studio (`C1/various/extracted/chromogen-studio/05-inline.js`)

| Lines | What it shows | What to do |
|---|---|---|
| 142–216 `units.js` | `Quantity(value, unit)` over ten units (`D, logH, EV, nm, um, mm, c/mm, K, ratio, e`); `to()` converts only EV→logH (×0.30103) and mm↔um; `add` refuses D+logH with the Hunt 14.17 message; `quantity("0.3 D")` parses strings, `%` → ratio | Port the rules to the architecture doc's unit set (§5.2 below). Keep the error texts |
| 218–383 `spectrum.js` | Frozen `Grid(380, 780, 5)` with `key()`; `Spectrum` with a kind; `mul`/`add` kind rules; `toDensity` clamps at 1e-8 | Port the grid and the kind algebra into `spectrum.ts`; the numeric code goes to CHB-003 |
| 995–1002, 1003–1597 `SECTIONS`, `SLIDERS` | 35 controls, each with `id, label, section, kind (macro/operator/hybrid), domain, cost (free/spatial/rebuild), unit, min, max, step, def, fmt, aside, what, maths, chapter` | Merge into `OpDef`/`ArgSpec`: `cost` becomes `class` + `binding`; `what` becomes `doc`; `fmt`/`aside`/`step` become `ui` hints; `maths` and `chapter` become doc links |
| 4136–4160 `set(changes, {commit})` | During a drag, `commit:false` updates the state and remembers `editStart`; the release pushes one history entry | The gesture model of DR-6 |
| 4172–4191 | Undo/redo as stacks of whole-settings snapshots, 200 per frame | Replaced by the log cursor |
| 4370–4442 `st:` links | A URL command language (`st:set?exposure=0.5`) that **clamps** values to the slider range | Shows that commands can be generated from the schema; do not copy the clamping |
| 4453–4456 `recipe()` | `{chromogen_studio: "1.2", frame, source, settings, lights: {logH, points, auto}, model, written}`; no scan hash, no format version | `FrameRecipe` adds `version`, `source.sha256` and the edit log |

### 4.4 The textbook's law harness

Read textbook §2.8 ("Composition laws" and "The laws Chromogen checks") and §2.9 ("Toward a reusable API") in `C1/sources/The Mathematics of the Colour Negative.md`. The law table in §2.8 is the first acceptance list for the reference engine. This ticket ports the *harness* into `packages/contract/src/laws.ts` and writes the laws that concern the contract itself (§9).

## 5. Design

The order below follows the build order: toolchain, then the vocabulary, then the things built from it.

### 5.1 Repository and toolchain (stage 1)

**Workspace.** Use a pnpm workspace with `packages/*`, `apps/*`, `tools/*` and `e2e`. `tsconfig.base.json` enables, in addition to `"strict": true`:

- `"noUncheckedIndexedAccess": true` and `"exactOptionalPropertyTypes": true`;
- `"verbatimModuleSyntax": true` and `"isolatedModules": true`;
- `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"target": "ES2022"`.

`packages/gpu` adds `@webgpu/types`.

**Import boundaries.** These are enforced by lint (`no-restricted-imports`, or dependency-cruiser):

- `apps/studio` and `packages/dsl` may import `@chromobench/contract` but never `core`, `gpu` or `ingest`;
- `packages/contract` imports nothing from the workspace.

This is the architecture doc's rule that "the UI and the DSL never call physics code directly". It is cheap to enforce in CI and expensive to repair later.

**Tests.**

- **Vitest** runs the unit tests in Node for `contract`, `engine-mock`, `conformance` and `dsl`. The architecture doc names `vitest.workspace.ts`. Recent Vitest versions configure the same thing as `test.projects` in `vitest.config.ts`; use whichever the pinned version documents.
- **Playwright** runs the browser tests. WebGPU in headless Chromium needs explicit flags, because headless Chrome disables the GPU by default. Chromium's own web-test configuration uses `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`. Emscripten's CI adds `--enable-features=Vulkan`. On a Linux CI runner without a GPU, SwiftShader is the adapter you get. Run the full Chromium build in new headless mode (recent Playwright versions select it with `channel: 'chromium'`), not the stripped headless shell. Verify the flags against the pinned Playwright version.

```ts
// playwright.config.ts (sketch)
export default defineConfig({
  testDir: './e2e',
  projects: [{
    name: 'chromium-webgpu',
    use: {
      browserName: 'chromium',
      channel: 'chromium',
      launchOptions: {
        args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'],
      },
    },
  }],
  webServer: { command: 'pnpm --filter studio preview --port 4173', port: 4173 },
});
```

**WGSL validation.** Validate WGSL with the compiler the app will actually use. `tools/wgsl-check/check.spec.ts` opens a blank page in the Playwright project above and then:

1. requests an adapter and a device;
2. compiles every `*.wgsl` file under `packages/gpu/kernels/`;
3. fails if `GPUShaderModule.getCompilationInfo()` reports any message of type `error`;
4. runs a compute shader that adds 1 to a 4-element buffer and reads it back.

Step 4 proves that WebGPU really works in CI, not just that the API object exists. Until CHB-005 adds kernels, the tool checks one smoke shader of its own. A native validator such as naga can be added later for faster local checks; it is optional.

**CI.** `.github/workflows/ci.yml` runs the jobs below in order. Each job fails the build.

1. `pnpm install --frozen-lockfile`
2. `pnpm -r typecheck`
3. `pnpm lint` (includes the import boundaries)
4. `pnpm gen && git diff --exit-code`: generated files must be up to date
5. `pnpm contract:check`: the catalog snapshot against `main` (§7)
6. `pnpm test`: unit, laws, conformance against `engine-mock`, mutants expected to fail
7. `pnpm e2e`: Playwright, `wgsl-check` and M1

A good first command for the intern is `pnpm init` at the repo root, then `pnpm create vite apps/studio --template vanilla-ts`, then the workspace file. Pin every dependency to an exact version.

### 5.2 Domains, units and spectrum kinds (stage 2)

`domains.ts` keeps the `Domain` union and `ImageInfo` from the architecture doc §5.1 unchanged. It adds a table that later code reads instead of hard-coding facts about domains:

```ts
// packages/contract/src/domains.ts (sketch)
export interface DomainInfo {
  channels: 1 | 3 | 4;            // 4 for film-dyes when the solver residual rides along
  unit: Unit;                      // unit of the stored values
  range: [number, number];         // values a conformance input may contain
  tap?: string;                    // spektrafilm / Filmbench tap name
  doc: string;
}
export const DOMAINS: Readonly<Record<Domain, DomainInfo>> = {
  'camera-linear':    { channels: 3, unit: 'fraction', range: [0, 1],      doc: 'linear sensor signal; T = signal / flat' },
  'scene-xyz':        { channels: 3, unit: 'none',     range: [0, 4],      doc: 'scene XYZ, Y = 1 for diffuse white' },
  'scanner-density':  { channels: 3, unit: 'D',        range: [-0.2, 4],   doc: '−log10(T / T_rebate) per scanner channel' },
  'film-logH':        { channels: 3, unit: 'logH',     range: [-4, 3],     tap: 'log_e_film',  doc: 'grey card = 0' },
  'film-dyes':        { channels: 3, unit: 'none',     range: [0, 3],      tap: 'cmy_film',    doc: 'dye amounts in unit dye spectra' },
  'printing-density': { channels: 3, unit: 'D',        range: [0, 4],      doc: 'negative density as the paper sees it' },
  'paper-logH':       { channels: 3, unit: 'logH',     range: [-4, 3],     tap: 'log_e_print', doc: 'paper log exposure' },
  'paper-dyes':       { channels: 3, unit: 'none',     range: [0, 3],      tap: 'cmy_print',   doc: 'paper dye amounts' },
  'print-xyz':        { channels: 3, unit: 'none',     range: [0, 1.2],    doc: 'print under the viewing light' },
  'display-rgb':      { channels: 3, unit: 'none',     range: [0, 1],      tap: 'rgb_out',     doc: 'encoded output RGB' },
  'mask':             { channels: 1, unit: 'fraction', range: [0, 1],      doc: 'one channel, 0..1' },
  'silver-density':   { channels: 1, unit: 'D',        range: [0, 4],      doc: 'reserved for CHB-014' },
};
```

The ranges are provisional. Their job is to bound the conformance input generator, not to clamp real data.

`units.ts` ports `units.js` to the architecture doc's `Unit` set. The conversion graph is small, and every edge not listed below is refused:

| From → to | Rule |
|---|---|
| `stop` ↔ `logH` | × 0.30103 (`LOG10_2 = Math.log10(2)`) |
| `point` ↔ `logH` | × 0.025 |
| `stop` ↔ `point` | through logH (1 stop = 12.04 points) |
| `CC` ↔ `D` | × 0.01; a filter density inside its band |
| `percent` ↔ `fraction` | ÷ 100 |
| `K` ↔ `mired` | mired = 10⁶ / K; nonlinear but invertible |
| `um` ↔ `nm` | × 1000 |
| `px` ↔ `um` | never in `Quantity`; it needs `ImageInfo.umPerPx` |
| `s`, `fstop` → `stop` | not conversions: a ratio needs a reference. Use `stopsFromTime(t1_s, t2_s) = log₂(t2/t1)` and `stopsFromFstop(n1, n2) = 2·log₂(n1/n2)` |
| `D` ↔ `logH` | **never**: "a density offset is not a log-exposure shift (Hunt 14.17)" |

```ts
// packages/contract/src/units.ts (sketch)
export const LOG10_2 = Math.log10(2);         // 0.30102999566…
export const LOGH_PER_POINT = 0.025;
export const D_PER_CC = 0.01;

export class Quantity {
  private constructor(readonly value: number, readonly unit: Unit) {}
  static of(value: number, unit: Unit): Quantity;
  to(unit: Unit): Quantity;                   // throws E_UNIT on a refused edge
  add(q: Quantity): Quantity;                 // same family only; D + logH → E_UNIT (Hunt 14.17)
  scale(k: number): Quantity;
}
export function quantity(x: number | string | Quantity, expect?: Unit): Quantity; // "4 pt", "0.3 stop", "12.6 s", "50 CC"
export const toLogH = (v: number, from: 'logH' | 'stop' | 'point'): number => …;
export const fromLogH = (v: number, to: 'logH' | 'stop' | 'point'): number => …;
export const stopsFromTime = (t1_s: number, t2_s: number) => Math.log2(t2_s / t1_s);
export const stopsFromFstop = (n1: number, n2: number) => 2 * Math.log2(n1 / n2);
```

Chromogen's `EV` becomes `stop`; the architecture doc's set has no separate EV unit. `capture.exposureEV` keeps "EV" in its name because photographers say it, and its unit is `stop`.

`spectrum.ts` is a new contract file; it is listed in §11. It holds:

- `GRID`: a frozen 380–780/5 nm grid, `n = 81`, with `key() = "380:780:5"`;
- `SpectrumKind`: `'power' | 'reflectance' | 'transmittance' | 'density' | 'responsivity'`;
- `productKind(a, b)` and `sumKind(a, b)`: these return the result kind or throw `E_KIND` with Chromogen's messages.

CHB-003's numeric `Spectrum` class calls these functions, so the rules exist once.

### 5.3 Errors and diagnostics

`errors.ts` defines `Diagnostic` exactly as in the architecture doc §5.5, a `ChromobenchError extends Error { diag: Diagnostic }`, and the code list. Every code has one meaning and one owner:

| Code | Raised by | Meaning |
|---|---|---|
| `E_UNKNOWN_OP` | registry, mutations | No such op or mutation op (did-you-mean in `hint`, valid names in `valid`) |
| `E_UNKNOWN_OPTION` | binder | No such argument; `fix` holds the corrected call |
| `E_ARG_TYPE` | binder | Wrong type (a node passed as a number, a string for a vec3, …) |
| `E_ARG_RANGE` | binder, mutations | Outside the hard range, or not finite; `valid` holds the range |
| `E_DOMAIN` | graph | The input's domain is not in `op.domainIn`; `hint` names the op that produces the right domain |
| `E_WRONG_KIND` | graph | A Value where an Image is required, or the reverse |
| `E_UNIT`, `E_KIND` | units, spectrum | Refused conversion or kind algebra |
| `E_PATH` | mutations | Unknown or non-settable recipe path; siblings in `valid` |
| `E_READONLY` | edit log | Agent mutation while the agent is read-only |
| `E_STALE` | edit log | A pending mutation's `expect` no longer matches the recipe (DR-7) |
| `E_NOT_IMPLEMENTED` | engines | The op is in the catalog but not in this engine's `capabilities().ops` |
| `E_EVAL`, `E_INTERNAL`, `E_CANCELLED`, `E_TIMEOUT` | engines | Kernel failure, a bug, cancellation, deadline |
| `RANGE` (warning) | binder | Outside the soft `usual` range; `hint` holds `usualHint` |

CHB-007 adds the codes that only exist in the sandbox (`E_NOT_AWAITED`, `E_IMMUTABLE` and others) through its own proposal.

### 5.4 The op registry and the binder (stage 3)

`registry.ts` keeps the architecture doc's `OpDef` and `ArgSpec` and adds a few fields, each listed in §11.

**DR-1: an `OpDef` is metadata only; engines implement ops.**

- **Context.** goja-cv puts `Run` inside `OpDef`, because it has one engine. Chromobench has three engines (mock, reference, GPU), and the GPU engine fuses several ops into one kernel.
- **Alternatives.** (a) `run` in the OpDef, with GPU overrides; (b) metadata only, with each engine keeping a map from op name to implementation.
- **Decision.** Option (b). The registry is pure data plus pure validation functions. It can be imported by the UI, by the sandbox and by Node tools, and it never pulls in kernels.
- **Consequences.** An engine declares which ops it implements in `capabilities().ops`. The conformance suite runs only those ops and reports coverage. A catalog op that no engine implements still shows in the docs, marked "stub".

The binder turns a raw call into canonical arguments. The graph and the edit log call the same binder, so a value that is valid in the DSL is valid as a mutation, and the reverse holds too.

```ts
// packages/contract/src/registry.ts (sketch; OpDef and ArgSpec as in the architecture doc §5.2, plus §11)
export interface BindResult { args: Readonly<Record<string, unknown>>; warnings: Diagnostic[] }

export function registerOp(def: OpDef): void;              // throws on an invalid definition (rules below)
export function getOp(name: string): OpDef;                // E_UNKNOWN_OP with did-you-mean
export function opsByArea(area: Area): OpDef[];
export function opsAccepting(kind: Kind, domain?: Domain): OpDef[];  // what a handle of this domain can call
export function bindArgs(op: OpDef, raw: Record<string, unknown>): BindResult;
export function closest(name: string, candidates: string[]): string | undefined;  // goja-cv suggest.go
```

`registerOp` refuses a definition when any of the following holds:

- the name has no dot, or the part before the first dot is not the op's `area`;
- an argument is declared twice, or has no `type`;
- a `number` argument has no `unit`;
- `min > max`, or `usual` lies outside `[min, max]`;
- an enum argument has no `values`, or its default is not one of them;
- a `default` violates its own spec;
- an argument's recipe path (`recipePath + '.' + name`, or `ArgSpec.path`) is not a settable path of the recipe schema;
- the op's `domainIn`/`domainOut` contradicts the area table of the architecture doc §5.2;
- an entry in `examples` does not parse as JavaScript. Executing the examples is CHB-007's job.

`bindArgs` runs these steps, in order:

1. Normalise shapes: `[x, y, w, h]` becomes `{x, y, w, h}` for a `box`; `{c, m, y}` stays an object for a `cmy`.
2. Reject unknown keys with `E_UNKNOWN_OPTION`. A redirect (`ArgSpec.redirects`) gives the hint and a fix with the value already converted. Otherwise `closest()` gives a did-you-mean.
3. Fill defaults for absent keys.
4. Type-check, and reject `NaN` and `±Infinity` (`E_ARG_RANGE`).
5. Hard range → `E_ARG_RANGE`; soft range → a `RANGE` warning.
6. Run the op's `validate`, if it has one.
7. Return the arguments as a frozen object.

Arguments that have a recipe path are filled from the recipe by callers that have one: `compile()` does it, and so does the DSL on frame-derived handles. The `ArgSpec.default` is the neutral value for callers without a recipe.

**DR-2: hard ranges fail; nothing clamps silently.**

- **Context.** Filmbench `coerce` clamps and warns (`01-inline.js` 1303–1316). Chromogen `st:set` clamps without saying so (4438). goja-cv fails with `E_ARG_RANGE` and suggests the nearest valid value.
- **Decision.** The contract never clamps. A UI widget clamps its own gesture before it produces a mutation, because a slider cannot leave its track. The DSL and the mutation validator fail with `E_ARG_RANGE`, which carries `valid: ["[-1.5, 1.5]"]`.
- **Consequence.** An agent learns that it passed points where log H was expected (§5.5), instead of getting a silently clamped print.

### 5.5 The v0 catalog (stage 3)

The catalog is one file per area, `packages/contract/src/catalog/<area>.ts`. Every op is a stub: metadata now, and a mock implementation in `engine-mock`. The owning ticket replaces the mock maths in the real engines. The ranges and defaults below are provisional. They come from the prototypes where those had them (Filmbench's parameter table, Chromogen's `SLIDERS`, the textbook's running example). The owners settle them through the change process.

How to read the arguments column:

- `name: type unit [hard] ~[usual] = default → recipe path`;
- an asterisk (*) marks arguments that are filled from the recipe when one is available;
- "class" and "binding" are the architecture doc's `class` and `binding` fields.

**source** (owner CHB-006)

| Op | In → out | Class, binding | Arguments |
|---|---|---|---|
| `source.open` | none → `camera-linear` | global, scan | `source*: string` (SHA-256 of the file) → `source.sha256`; `encoding*: enum linear/srgb/gamma22 = linear` → `source.decode.encoding` |
| `source.info` | Image → Value | measure, scan | none; returns `{width, height, bits, encoding, sha256}` |
| `source.pattern` (internal) | none → any | global, pixel | `domain: enum`, `width: number px`, `height: number px`, `seed: number none`; for the conformance suite only, never in the DSL or the docs |

**scan** (owner CHB-006). All inputs are `camera-linear` unless stated.

| Op | In → out | Class, binding | Arguments |
|---|---|---|---|
| `scan.flatField` | → `camera-linear` | pointwise, scan | `flat*: string` (SHA-256 of the flat frame) → `scan.flat` |
| `scan.flare` | → `camera-linear` | pointwise, scan | `flare*: number percent [0, 20] ~[0, 3] = 0` → `scan.flare` |
| `scan.rebate` | → Value | measure, scan | `box*: box px` (optional; absent means automatic detection) → `scan.rebate`; returns `{T: vec3, box}` |
| `scan.density` | → `scanner-density` | pointwise, scan | `rebate*: box px` (optional) → `scan.rebate` |
| `scan.noise` | `camera-linear`, `scanner-density` → Value | measure, scan | `box: box px` (optional); returns σ per channel in D |

**invert** (owner CHB-003)

| Op | In → out | Class, binding | Arguments |
|---|---|---|---|
| `invert.dyes` | `scanner-density` → `film-dyes` (4 channels: c, m, y, residual) | pointwise, stock | `stock*: stockId(film)` → `scan.stock`; `scanner*: string` → `scan.scanner` |
| `invert.classify` | `film-dyes` → Value | measure, stock | none; returns the fractions `{reachable, blank, belowBase, unreachable}` |

**capture** (owner CHB-012)

| Op | In → out | Class, binding | Arguments |
|---|---|---|---|
| `capture.expose` | `scene-xyz` → `film-logH` | pointwise, stock | `stock*: stockId(film)` → `capture.stock`; `exposureEV*: number stop [-10, 10] ~[-3, 3] = 0` → `capture.exposureEV` |

**film** (owner CHB-012). Ranges from Filmbench's parameter table, lines 1230–1251.

| Op | In → out | Class, binding | Arguments |
|---|---|---|---|
| `film.couple` | `film-logH` → `film-logH` | spatial, stock | `amount*: number fraction [0, 2.5] = 1`; `diffusion_um*: number um [0, 150] = 0` → `capture.development.dir` |
| `film.halation` | `film-logH` → `film-logH` | spatial, stock | `strength*: number fraction [0, 4] = 1` → `capture.development.halation` |
| `film.develop` | `film-logH` → `film-dyes` | pointwise, stock | `push*: number stop [-2, 3] = 0` → `capture.development.push` |
| `film.grain` | `film-dyes` → `film-dyes` | spatial, pixel | `amount*: number fraction [0, 4] = 1`; `size_um*: number um [3, 45] = 12`; `seed*: number none = 1` → `capture.development.grain` |

**print** (owners CHB-003, CHB-010)

| Op | In → out | Class, binding | Arguments |
|---|---|---|---|
| `print.expose` | `film-dyes` → `paper-logH` | pointwise, stock | `paper*: stockId(paper)` → `print.paper`; `mode*: enum real/normalised = normalised` → `print.enlarger.mode`; `lamp*: string = TH-KG3` → `print.enlarger.lamp`; `filtration*: cmy CC [0, 200] = {c:0,m:0,y:0}` → `print.enlarger.filtration`; `time_s*: number s [0.1, 600] ~[2, 60] = 10` → `print.enlarger.time_s`; `fstop*: number fstop [2.8, 45] = 8` → `print.enlarger.fstop` |
| `print.lights` | `paper-logH` → `paper-logH` | pointwise, setting | `logH*: vec3 logH [-1.5, 1.5] ~[-0.5, 0.5] = [0,0,0]` (shown in points, step 1 pt; redirect `points` ×0.025) → `print.lights.logH` |
| `print.preflash` | `paper-logH` → `paper-logH` | pointwise, setting | `amount*: number fraction [0, 0.2] ~[0, 0.05] = 0` → `print.preflash` |
| `print.combine` | `paper-logH` (several) → `paper-logH` | pointwise, setting | `exposures: Image[]`, `masks: Mask[]`; sums the exposures in linear H (reserved for CHB-010's dodge, burn and split exposures) |
| `print.develop` | `paper-logH` → `paper-dyes` | pointwise, stock | `paper*: stockId(paper)` → `print.paper`; `grade*: number none [0, 5] ~[1, 4] = 2` → `print.grade` |

`print.expose` binds per stock because its expensive part is the table from negative to paper log exposure without lights. Textbook §2.8 shows that the lights factor out of that table. `print.lights` is therefore a separate, per-setting op: a lights change never invalidates the table.

**view** (owner CHB-003)

| Op | In → out | Class, binding | Arguments |
|---|---|---|---|
| `view.reflect` | `paper-dyes` → `print-xyz` | pointwise, stock | `illuminant*: string = D50` → `view.illuminant` |
| `view.flare` | `print-xyz` → `print-xyz` | pointwise, setting | `flare*: number percent [0, 10] ~[0, 2] = 0.48` → `view.flare` (0.48 % is the textbook's running value, §2.7) |
| `view.adapt` | `print-xyz` → `print-xyz` | pointwise, setting | `to*: enum D50/D65 = D65` → `view.output.white` |

**output** (owners CHB-003, CHB-011)

| Op | In → out | Class, binding | Arguments |
|---|---|---|---|
| `output.display` | `print-xyz` → `display-rgb` | pointwise, setting | `space*: enum srgb/display-p3 = srgb` → `view.output.space`; `gamut*: enum clip/soft = soft` → `view.output.gamut` |
| `output.frame` | `display-rgb` → `display-rgb` | geometric, setting | `orientation*: enum` → `scan.orientation`; `crop*: box px` (optional) → `scan.crop` |
| `output.encode` | `display-rgb` → Value | global, setting | `format*: enum png16/tiff16/jpeg = png16`, `icc*: bool = true` → `view.output`; not exposed to the DSL in v0 |

**DR-3: coordinates are source pixels.**

- **Decision.** Every coordinate in the recipe, in op arguments and in the DSL is in the pixel grid of the decoded source file. This covers the rebate box, mask geometry, densitometer points and crops. Orientation and crop are applied last, by `output.frame`.
- **Precedent.** goja-cv made the same choice: coordinates are absolute in the source file's grid (report §3.7).
- **Consequence.** A mask drawn before a crop change still covers the same part of the negative, and measuring never depends on how the frame is displayed.

**mask** (owners CHB-009, CHB-010)

| Op | In → out | Class, binding | Arguments |
|---|---|---|---|
| `mask.luminance` | any Image → `mask` | pointwise, setting | `above: number fraction [0, 1]`, `below: number fraction [0, 1]`, `softness: number fraction [0, 0.5] = 0.05` |
| `mask.gradient` | any Image → `mask` | pointwise, setting | `from: point px`, `to: point px` |
| `mask.ellipse` | any Image → `mask` | pointwise, setting | `box: box px` |
| `mask.paint` | any Image → `mask` | pointwise, setting | `strokes: string` (id of a stroke set stored with `mask.set`) |
| `mask.feather` | `mask` → `mask` | spatial, setting | `radius_px: number px [0, 500] ~[2, 100] = 10` |
| `mask.and`, `mask.or` | `mask` → `mask` | pointwise, setting | `other: Mask` |
| `mask.not` | `mask` → `mask` | pointwise, setting | none |

**measure** (owners CHB-003, CHB-005). All are class `measure` and return Values.

| Op | Accepts | Arguments | Returns |
|---|---|---|---|
| `measure.stats` | any Image | `box: box px` (optional), `mask: Mask` (optional) | `{mean: vec3, p01: vec3, p99: vec3, clipLow: fraction, clipHigh: fraction}` in the domain's unit |
| `measure.histogram` | any Image | `channel: enum r/g/b/L = L`, `bins: number none [8, 1024] = 64` | `{edges, counts}` |
| `measure.densitometer` | `scanner-density`, `film-dyes`, `printing-density`, `paper-dyes`, `print-xyz` | `at: point px`, `aperture_px: number px [1, 200] = 9`, `response: enum status-a/status-m/visual` (default chosen by domain) | `{D: vec3, visual?: number}` |
| `measure.patches` | any Image | `box: box px` (optional), `cols: number none [1, 24]`, `rows: number none [1, 24]` (on a `darkroom.*` picture the cells are known and these may be omitted) | table of `{cell, D: vec3, visual}` |

**darkroom** (owner CHB-010). Each of these builds a picture from several prints of one negative.

| Op | In → out | Class, binding | Arguments |
|---|---|---|---|
| `darkroom.testStrip` | `film-dyes` → `print-xyz` | decoration, setting | `vary: enum time/lights.r/lights.g/lights.b/filtration.c/filtration.m/filtration.y/grade = time`; `steps: number none [2, 12] = 7`; `step: number` (in the varied quantity's display unit: stops for time, points for lights, CC for filtration; checked by `validate`); `direction: enum horizontal/vertical = vertical` |
| `darkroom.ringAround` | `film-dyes` → `print-xyz` | decoration, setting | `step_cc: number CC [2, 40] = 10`; `rings: number none [1, 2] = 1` |
| `darkroom.contactSheet` | none → `print-xyz` | decoration, setting | `frames: string[]`; `cell_px: number px [64, 1024] = 256` |

The darkroom ops return `print-xyz` rather than `display-rgb` so that `measure.patches` reads print densities. A look or the viewer adds `output.display`.

**finishing** (owner CHB-015, optional)

| Op | In → out | Class, binding | Arguments |
|---|---|---|---|
| `finishing.clarity` | `display-rgb` → `display-rgb` | spatial, setting | `amount*: number fraction [-1, 1] = 0`; `radius_px*: number px [5, 200] = 40` → `finishing.clarity*` |
| `finishing.hue` | `display-rgb` → `display-rgb` | pointwise, setting | `family*: enum reds/oranges/yellows/greens/aquas/blues/purples/magentas`; `shift_deg*: number deg [-30, 30] = 0` → `finishing.hue.<family>` |

Here is one op written out in full, to show how the metadata, the UI hints and the documentation sit together:

```ts
// packages/contract/src/catalog/print.ts (sketch)
export const printLights = defineOp({
  name: 'print.lights', area: 'print',
  on: 'Image', returns: 'Image', domainIn: 'paper-logH', domainOut: 'same',
  class: 'pointwise', binding: 'setting',
  recipePath: 'print.lights',
  args: {
    logH: {
      type: 'vec3', unit: 'logH', min: -1.5, max: 1.5, usual: [-0.5, 0.5],
      usualHint: 'More than 20 points on one layer usually means the wrong paper or filtration.',
      default: [0, 0, 0],
      redirects: { points: { hint: 'Printer lights are stored in log H: 1 point = 0.025 log H.', scale: 0.025 } },
      ui: { widget: 'slider', step: 0.025, detents: [0], displayUnit: 'point', label: 'Printer lights', group: 'Print' },
      doc: 'Offsets of paper log exposure per layer (R, G, B light), applied after the negative→paper table.',
    },
  },
  doc: 'Balance colour and density by shifting the paper\'s log exposure. Never a density offset (Hunt 14.17).',
  see: ['print.expose', 'measure.densitometer'],
  examples: ['frame.negative().print({ lights: units.pt([4, 0, 0]) }).look("+4 pt red")'],
});
```

### 5.6 Generated artifacts (stage 3)

`tools/gen-docs` reads the registry and writes three products. All are checked in, and CI fails if they are out of date.

1. **`packages/contract/src/generated/op-args.ts`.** One TypeScript interface per op, for example `interface PrintExposeArgs { paper?: StockId; time_s?: number; … }`, plus an `OpArgs` map from op name to its interface. CHB-009 and CHB-010 use these to type their calls. CHB-007 extends the same tool to emit the DSL's `.d.ts` and the agent reference.
2. **`docs/reference/ops/<area>.md`.** One section per op, generated from `doc`, `args` (type, unit, ranges, default, recipe path), `see` and `examples`, with a "stub / mock / reference / gpu" implementation column read from the engines' `capabilities().ops`.
3. **`packages/contract/catalog.snapshot.json`.** A sorted, canonical JSON dump of everything a consumer could depend on: op names, argument names, types, units, ranges, defaults, recipe paths, the mutation ops, the recipe schema and the error codes. Section 7 uses it to detect breaking changes.

### 5.7 Graph, hash-consing and `compile` (stage 4)

```ts
// packages/contract/src/graph.ts (sketch)
export interface NodeDef { op: string; inputs: string[]; args: Readonly<Record<string, unknown>> }
export interface Node extends NodeDef { id: string; info: ImageInfo | ValueInfo }   // NodeRef = { id, info }

export class Graph {
  intern(op: string, inputs: string[], raw: Record<string, unknown>): { node: Node; warnings: Diagnostic[] };
  get(id: string): Node | undefined;
  closure(id: string): NodeDef[];          // the node and its ancestors, topologically sorted
  adopt(defs: NodeDef[]): Node[];          // re-intern definitions from elsewhere; ids must match
}
export function nodeId(def: NodeDef): string;
export function compile(recipe: FrameRecipe, g: Graph): Node;     // the recipe's display node
```

`intern` performs these steps:

1. Look up the op.
2. Check each input's kind (`E_WRONG_KIND`) and domain (`E_DOMAIN`). When the input's domain is wrong, `hint` names the op that produces the right one: "print.lights takes paper-logH; this input is film-dyes; call print.expose first".
3. Bind the arguments (§5.4).
4. Infer `info`: `domainOut` (`'same'` copies the input's domain), the channel count from `DOMAINS`, size and `umPerPx` from the input.
5. Compute the id.
6. Return the existing node if the id is already known.

The id is computed as follows:

```text
nodeId(def) = hex(sha256(
    u32le(len(op)) ‖ op
  ‖ u32le(len(J)) ‖ J              where J = canonicalJSON(args)
  ‖ input ids, as raw 32-byte hashes, in order))
canonicalJSON: object keys sorted; arrays in order; numbers through JSON.stringify
               (ECMAScript's shortest round-trip form; −0 prints as 0); NaN/±Infinity rejected by bindArgs
```

The length prefixes come from goja-cv `hashNode` (`node.go` 406–428). They prevent two different `(op, args)` pairs from producing the same byte string.

**DR-4: synchronous SHA-256.** WebCrypto's `crypto.subtle.digest` returns a Promise. A DSL call such as `frame.negative()` must return a handle synchronously, so interning cannot wait on a Promise. Use a small synchronous SHA-256 from an audited library (`@noble/hashes`, pinned to an exact version). Hashing a few hundred bytes per node is negligible.

**Nodes cross thread boundaries as data.** Ids are content hashes, so another realm can re-intern a node from its `NodeDef` and get the same id. The DSL worker (CHB-007), the GPU engine and the main thread therefore never share a graph object. They send `closure(id)` and the receiver calls `adopt`. The `adopt` test asserts that the recomputed id equals the sent id.

**`compile`** builds the display node of a recipe. It takes every recipe-backed argument from the recipe:

```text
compile(r):                                    -- r.kind = 'negative-scan'
  n = intern('source.open', [], {source: r.source.sha256, encoding: r.source.decode.encoding})
  if r.scan.flat:   n = intern('scan.flatField', [n], {flat: r.scan.flat.sha256})
  if r.scan.flare:  n = intern('scan.flare', [n], {flare: r.scan.flare})
  n = intern('scan.density', [n], {rebate: r.scan.rebate})
  n = intern('invert.dyes',  [n], {stock: r.scan.stock, scanner: r.scan.scanner})
  x = intern('print.expose', [n], {paper, mode, lamp, filtration, time_s, fstop from r.print})
  x = combineExposures(x, r.print.exposures)   -- CHB-010; identity while exposures = [main]
  x = intern('print.lights', [x], {logH: r.print.lights.logH})
  if r.print.preflash > 0: x = intern('print.preflash', [x], {amount: r.print.preflash})
  p = intern('print.develop', [x], {paper: r.print.paper, grade: r.print.grade})
  v = intern('view.reflect', [p], {illuminant: r.view.illuminant})
  v = intern('view.flare',   [v], {flare: r.view.flare})
  v = intern('view.adapt',   [v], {to: r.view.output.white})
  d = intern('output.display', [v], {space, gamut from r.view.output})
  return intern('output.frame', [d], {orientation: r.scan.orientation, crop: r.scan.crop})
  -- r.kind = 'digital-raw' replaces the first five lines with capture.expose → film.* (CHB-012)
```

Ops with neutral arguments, such as zero lights, still produce nodes. An engine may short-circuit them. A stable chain shape keeps ids predictable, and that makes the tests simpler.

### 5.8 Recipe, mutations and the edit log (stage 5)

`recipe.ts` keeps `FrameRecipe` and `Exposure` from the architecture doc §5.4. It defines the types the architecture doc leaves open: `Box`, `Orientation`, `DecodeOptions`, `AutoBalance`, `OutputSettings`, `DevelopmentSettings`, `MaskRef` and `MaskSpec`. It also provides:

- a runtime validator, which is required (the schema library is an implementation choice);
- `defaultRecipe(kind, source)`;
- `settablePaths()`, generated from the arguments' recipe paths;
- `migrations`: an array of functions, `migrations[n]` turning version n into n+1.

`MaskSpec` is the `closure()` of a mask node (§5.7). A mask built in the DSL or in the UI is stored as the node definitions that build it, so it can be rebuilt exactly.

`mutations.ts` keeps the closed `Mutation` union and adds two optional fields, both in §11:

- `set.expect?: unknown`: the value the proposer saw (DR-7);
- `LoggedMutation.why?: string`: the agent's one-line reason, shown on the approval card.

The architecture doc's vocabulary row writes the lights mutation as `{op:'set', path:'print.lights', value:[0,4,-2]}`. Under the recipe shape, that path holds an object `{logH, auto}`, and the values look like points. The settable path is `print.lights.logH`, and values are in log H. "+4 pt red" is therefore `{op:'set', path:'print.lights.logH', value:[0.1, 0, 0]}`. §11 records the correction.

**Validating a mutation.** The edit log checks every mutation against the recipe before accepting it. The rules depend on the mutation op:

- **`set`.** The path must be in `settablePaths()` (`E_PATH` otherwise, with did-you-mean and siblings, as Filmbench `ParamTable.check` does at line 1298). The value must pass the binder's per-argument check for the `ArgSpec` that owns the path. One validator thus covers the DSL, the UI and loaded recipes.
- **`exposure.add`.** The id must be unique, and the mask reference must exist.
- **`exposure.remove`.** The id must exist.
- **`mask.set`.** `MaskSpec` must adopt into a mask-domain node.
- **`frame.add`.** The whole recipe must validate.

**The log structure.** The decisions behind it are DR-5, DR-6 and DR-7, recorded after the sketch:

```ts
// packages/contract/src/editlog.ts (sketch)
export interface UndoUnit { tx: string; seqs: number[]; label: string }
export interface EditLogData {
  version: 1;
  initial: FrameRecipe;            // the recipe frame.add created
  entries: LoggedMutation[];       // append-only journal: applied, pending and rejected entries
  units: UndoUnit[];               // applied units, in order
  cursor: number;                  // units[0..cursor) are in effect
}
export type AgentMode = 'read-only' | 'ask' | 'auto';

export class EditLog {
  constructor(data: EditLogData, opts: { mode: AgentMode; now: () => number });
  get state(): FrameRecipe;                         // fold(initial, units[0..cursor))
  get stateHash(): string;                          // sha256(canonicalJSON(state))
  get logHash(): string;                            // sha256(canonicalJSON(in-effect mutations, without ts))
  apply(ms: Mutation[], by: 'user' | 'auto', label: string): UndoUnit;   // one unit
  propose(ms: Mutation[], meta: { tx: string; why?: string }): LoggedMutation[];   // by 'agent'; mode decides
  approve(seqs: number[]): UndoUnit | Diagnostic[]; // re-validates; E_STALE if expect ≠ current
  reject(seqs: number[]): void;
  undo(): boolean; redo(): boolean;
  preview(m: Mutation | null): void;                // transient overlay for drags; not logged
  why(path: string): Provenance[];
  pending(): LoggedMutation[];
  on(fn: (e: LogEvent) => void): () => void;
}
export interface Provenance { seq: number; by: 'user' | 'agent' | 'auto'; tx?: string; ts: number;
                              op: Mutation['op']; value: unknown; approvedBy?: 'user' }
```

The `by` tag is set by whoever calls the log: the UI passes `'user'`, and ingest's automatic rebate detection passes `'auto'`. Agent mutations enter only through `propose`, which always records `by: 'agent'`. No sandboxed code has a reference to the `EditLog`.

**DR-5: one log per frame; undo is a cursor over units.**

- **Context.** Filmbench keeps one global log with snapshot stacks. Chromogen keeps a 200-entry snapshot history per frame. Photographers expect per-photo history, as in Lightroom or darktable, and the architecture doc defines the recipe per frame.
- **Decision.**
  - Each frame has its own `EditLog`. A small library log holds `frame.add` and frame removal.
  - Each log keeps an append-only journal of entries and a list of **undo units**. A unit is one transaction, one gesture, one agent eval or one single mutation.
  - `undo` decrements the cursor and `redo` increments it.
  - Applying a new unit while `cursor < units.length` drops the redo tail from `units`, and its entries stay in the journal.
- **Consequences.**
  - `state` is a pure fold, and the tests can recompute it from scratch.
  - `why()` sees exactly the mutations in effect.
  - Nothing is ever deleted from the journal.
  - A transaction that spans several frames, such as "apply these lights to the whole roll", is not supported in v0. It is an open question for CHB-010 (§10).

**DR-6: drags are gestures, not timed coalescing.**

- **Context.** Filmbench coalesces `param.set` entries on the same path by the same author within 900 ms (line 2330). Chromogen uses `commit:false` while dragging and commits on release (4136–4160).
- **Decision.** While a drag is in progress, the UI calls `log.preview(m)`. That sets a transient overlay, which the fold applies last and which never enters the journal. On release, the UI calls `apply([m], 'user', label)` once.
- **Consequences.** There are no timers, the tests are deterministic, and one drag is one undo step. The viewer still renders every intermediate value, because `state` includes the overlay.

**DR-7: agent proposals carry the value they expected.**

- **Context.** In ask mode a proposal can wait for minutes, and the photographer may move the same slider in the meantime. Approving the stale proposal would silently undo the photographer's change.
- **Decision.** `propose` fills `expect` on each `set` with the current value at proposal time. `approve` re-validates every entry and compares `expect` with the current value. On a mismatch it returns `E_STALE` and applies nothing. The UI (CHB-009) then offers "apply anyway" or "reject".
- **Consequence.** One rule at the arbiter replaces a class of race conditions. The arbiter is the frame's `EditLog`, which runs on the main thread.

**Modes.**

- `read-only`: `propose` throws `E_READONLY`.
- `ask`: entries become `pending`, and the UI shows one approval card per `tx`.
- `auto`: entries are applied at once, as one unit labelled with the eval.

The mode lives in the host and only the photographer can change it.

**`why(path)`** returns the in-effect entries that wrote `path`, an ancestor of it (such as `frame.add`), or a descendant. They come oldest first, with the initial value as the first line:

```text
why('print.lights.logH')
  initial            [0, 0, 0]              (frame.add by auto, library log)
  set                [0, 0.05, 0]           by user   tx g7          seq 4
  set                [-0.1125,-0.0125,0.125] by agent tx eval-12  approved   seq 9
  effective          [-0.1125, -0.0125, 0.125] logH  (= [-4.5, -0.5, +5] pt)
```

### 5.9 The Engine interface and the eval types (stage 6)

`engine.ts` keeps the architecture doc's `Engine` and `EvalTarget`, and defines the types the doc leaves open:

```ts
// packages/contract/src/engine.ts (sketch)
export interface SourceRef  { sha256: string; name?: string; bytes?: ArrayBuffer; url?: string }
export interface SourceInfo { sha256: string; width: number; height: number; bits: 8 | 16 | 32;
                              channels: 1 | 3 | 4; encoding: 'linear' | 'srgb' | 'gamma22'; format: string }
export interface FieldSpec  { name: string; type: 'number' | 'vec3' | 'string' | 'box' | 'point' | 'table';
                              unit?: Unit; doc: string }
export interface ValueInfo  { kind: 'Value'; fields: FieldSpec[] }
export interface EngineCaps { ops: string[]; maxSize: number; f16: boolean; timestamps: boolean;
                              precision: Array<'preview' | 'export'> }
export interface ImageResult { node: string; info: ImageInfo; scale: number; region: Box;
                               data: Float32Array | Float64Array;   // interleaved, info.channels per pixel
                               warnings: Diagnostic[] }
export interface MeasureSpec { scale?: number | 'full'; precision?: 'preview' | 'export' }   // default: full, export
export interface Measurement { node: string; value: unknown; warnings: Diagnostic[] }      // value matches ValueInfo.fields
export interface TableKey    { kind: string; key: string }                                  // content-keyed (CHB-005)
```

The interface fixes several semantic rules, which the conformance suite checks:

- **Image and Value nodes.** `evaluate` accepts Image nodes only; `measure` accepts Value nodes only. Passing the other kind throws `E_WRONG_KIND`.
- **Measurement scale.** Measurements default to full resolution and export precision, so a number never depends on the preview size. goja-cv makes the same choice: `await` evaluates at scale 1.
- **Cache keys.** Results are cached by `(node id, scale rounded to 1e-4, region, precision)`, following goja-cv `QuantizeScale`. A cache hit returns the warnings the original computation raised.
- **Determinism.** Two evaluations of the same node with the same target return bit-identical data in the same engine. Seeds come from arguments (`film.grain.seed`), never from the clock.
- **Cancellation.** `EvalTarget` gets an optional `signal?: AbortSignal`, an addition listed in §11. The viewer can then implement "last request wins", which goja-cv lacks (report §5.2 item 6). A cancelled evaluation rejects with `E_CANCELLED` and must not leave a partial result in the cache.
- **Missing ops.** An op that is not in `capabilities().ops` throws `E_NOT_IMPLEMENTED`.

`eval.ts` holds `EvalRequest`, `EvalResult` and `Diagnostic`, exactly as in the architecture doc §5.5. CHB-007 proposes the `Look` and `ContextBlock` fields.

### 5.10 The mock engine (stage 7)

The mock engine has three jobs:

1. make the UI, the DSL and the agent buildable now;
2. make every conformance test runnable;
3. give tests numbers simple enough to check by hand.

It is f64, single-threaded and deterministic. Its formulas are deliberately simple, but each one goes in the same direction as the physics. Adding red light makes the print more cyan, and a longer time makes it darker. A developer who knows the darkroom is therefore not misled while working against it.

| Op | Mock formula, per pixel unless stated (k = R, G, B) |
|---|---|
| `source.open` | decode an uncompressed 16-bit RGB TIFF (`tiff16.ts`, temporary until CHB-006); value = code / 65535 |
| `scan.flatField` | `T_k / flat_k` |
| `scan.flare` | `max(0, T_k − flare/100 · mean(T))` |
| `scan.rebate` | mean of `T` inside the box; automatic: the brightest 5 % column band |
| `scan.density` | `d_k = −log₁₀(max(T_k, 1e-8) / T_rebate,k)` |
| `invert.dyes` | `c_k = d_k` (identity matrix); residual = 0 |
| `print.expose` | `x_k = −c_k + log₁₀(time_s / 10) − 2·log₁₀(fstop / 8) − f_k/100`, with `f = (c, m, y)` filtration in CC |
| `print.lights` | `x_k + ℓ_k` |
| `print.preflash` | `log₁₀(10^x_k + amount)` |
| `print.develop` | `a_k = clamp(0.8 + γ·(x_k + 0.7), 0, 2.5)`, `γ = 1.5 · (0.6 + 0.2·grade)` (γ = 1.5 at grade 2) |
| `view.reflect` | `R_k = 10^(−a_k)`; `XYZ = M_sRGB→XYZ · R` |
| `view.flare` | `XYZ + flare/100 · XYZ_white` |
| `view.adapt` | identity (records `to`) |
| `output.display` | `sRGB_encode(clamp(M⁻¹ · XYZ, 0, 1))` |
| `measure.densitometer` | on `print-xyz`: `D_k = −log₁₀(R_k)` with `R = M⁻¹·XYZ`, `visual = −log₁₀ Y`; on dye and density domains: the mean value inside the aperture |
| `measure.stats`, `histogram`, `patches` | exact statistics over the region |
| `darkroom.*` | tile the receiver's print, each band or cell printed with its own setting |
| others | identity on values with the right output domain, channels and size |

The fixture `fixtures/synthetic/m1-negative-96x64.tif` is written by `tools/fixtures/make-m1.ts`. It is an "orange mask" negative with three regions:

- **A rebate strip** at `{x: 0, y: 0, w: 8, h: 64}` with T = (0.80, 0.50, 0.35), stored as codes (52428, 32768, 22937).
- **A grey patch** at `{x: 40, y: 24, w: 16, h: 16}` with T = (0.20, 0.10, 0.05), stored as codes (13107, 6554, 3277).
- **A horizontal density ramp** in the remaining area.

### 5.11 The conformance suite and the law harness (stage 8)

`packages/conformance/src/generate.ts` walks the registry. For each op it generates cases from the op's own metadata, so a new op is tested the moment it is registered:

| Case | Source in the metadata | Expectation |
|---|---|---|
| default call builds | `args` defaults, `domainIn` | `intern` succeeds; `info.domain` = `domainOut`; channels from `OpDef.channels`, else from `DOMAINS` |
| wrong domain | a `source.pattern` input of a domain not in `domainIn` | `E_DOMAIN` with a `hint` |
| each hard bound | `min − ε`, `max + ε` | `E_ARG_RANGE` with `valid` |
| soft bound | outside `usual` | `RANGE` warning, node built |
| unknown option | a one-letter typo of the first argument | `E_UNKNOWN_OPTION`, `hint` with the right name |
| redirect | each `redirects` key | `E_UNKNOWN_OPTION` with a converted `fix` |
| canonical id | key order shuffled; explicit default vs omitted | same id |
| evaluation shape | `evaluate` at scale 1 and 0.5 on a seeded `source.pattern` input | `ImageResult.info` matches the node; data length = w·h·channels |
| region | pointwise ops: region result vs crop of the full result | bit-identical |
| determinism | evaluate twice; evaluate on two engine instances | bit-identical |
| measure fields | measure ops | every `FieldSpec` field is present and finite |
| not implemented | an op absent from `capabilities().ops` | `E_NOT_IMPLEMENTED` |

`run.ts` exports `runConformance(name, makeEngine)`. Each engine package calls it from its own test file. The reference and GPU engines run the same cases, and CHB-005's parity tests come on top.

**Proving the suite can fail.** `mutants.ts` wraps the mock engine in deliberately broken engines. CI runs the suite against each mutant and expects the listed case to fail:

| Mutant | Expected to fail |
|---|---|
| ignores `region` | region |
| tags the output with the input's domain | evaluation shape |
| adds `1e-12 · Math.random()` | determinism |
| canonicalises without sorting keys | canonical id |
| returns no `clipHigh` from `measure.stats` | measure fields |

**The law harness** ports Chromogen's design (textbook §2.8):

```ts
// packages/contract/src/laws.ts (sketch)
export interface Rng { next(): number /* [0,1) */; int(lo: number, hi: number): number }
export function mulberry32(seed: number): Rng;
export interface Law<T> { name: string; gen: (r: Rng) => T; prop: (x: T) => true | string;
                          justifies: string; source: string; shrink?: (x: T) => Iterable<T> }
export function law<T>(name: string, gen: Law<T>['gen'], prop: Law<T>['prop'],
                       meta: { justifies: string; source: string; shrink?: Law<T>['shrink'] }): Law<T>;  // throws without justifies
export function check(laws: Law<any>[], opts: { n: number; seed: number }): LawReport[];   // shrinks numbers towards 0 and 2 decimals
```

### 5.12 The M1 walking skeleton (stage 9)

M1 shows that the contract holds together across tickets. The scenario of the architecture doc §8.2 becomes one Playwright test, `e2e/m1-walking-skeleton.spec.ts`, which runs these steps:

1. Open `apps/studio`. Load the fixture TIFF through the file input. This performs `frame.add` with `defaultRecipe('negative-scan', source)` and `by: 'auto'`.
2. The viewer calls `compile(state)` and `engine.evaluate(node, {scale: 'full', precision: 'preview'})` on `engine-mock`, then draws the result. The test reads the grey patch's centre pixel from the canvas.
3. The generated "Printer lights" control, a red slider built from `ArgSpec.ui`, is dragged by +4 points. The test checks `preview` during the drag and a single `apply` on release. The red channel of the patch drops from 0.370 to 0.313 (the numbers are traced in §6). The state hash changes.
4. The test presses Undo. The pixel and the state hash return exactly to their step 2 values.
5. A DSL eval runs `frame.edit({ 'print.lights.logH': [0.1, 0, 0] })`. This is CHB-007's first slice; until it lands, the test calls `log.propose` directly. In ask mode the edit is pending and the pixel is unchanged. After approval the pixel matches step 3 and `why('print.lights.logH')` lists `by: agent, approved`.

CHB-002 creates the minimal `apps/studio` page with a canvas, one generated control, Undo, and an approve button for pending changes. CHB-009 replaces it with the real shell.

## 6. One flow traced end to end: "+4 points red", then undo

This trace uses the mock engine and the M1 fixture. The numbers were computed from the mock formulas in §5.10. The node ids are shortened and illustrative.

**Starting state.**

- The recipe has `print.enlarger = {mode: 'normalised', lamp: 'TH-KG3', filtration: {c: 0, m: 0, y: 0}, time_s: 10, fstop: 8}`, `print.lights.logH = [0, 0, 0]` and `print.grade = 2`. The mock frame uses zero filtration so that the arithmetic stays visible.
- The M1 default recipe sets `view.flare = 0` for the same reason; `view.adapt` and `output.frame` are identities in the mock.
- The state hash is `sha256(canonicalJSON(state))`; call it `S0`.

**Step 1: the gesture.**

1. The photographer drags the red printer-light slider. Its `ArgSpec.ui` says `displayUnit: 'point'` and `step: 0.025`, so the widget moves in whole points.
2. During the drag the UI calls `log.preview({op: 'set', path: 'print.lights.logH', value: [0.025·n, 0, 0]})` for each detent n. The viewer re-renders from `state`, which includes the overlay.
3. On release at +4 points, the UI calls `log.apply([{op: 'set', path: 'print.lights.logH', value: [0.1, 0, 0]}], 'user', 'Printer lights')`.

**Step 2: validation.**

1. `print.lights.logH` is a settable path. It belongs to the `logH` argument of `print.lights` (type `vec3`, unit `logH`, hard range [−1.5, 1.5]).
2. `[0.1, 0, 0]` passes the binder's check for that argument.
3. The log appends entry `seq 5` with `by: 'user'` and `tx: 'g3'`. It pushes unit `{tx: 'g3', seqs: [5]}` and advances the cursor by one. The new state hash is `S1 ≠ S0`.

**Step 3: compile.** `compile(state)` interns the chain. The nodes from `source.open` down to `print.expose` keep their ids, because their arguments did not change. `print.lights` gets a new id, because its `logH` argument changed. So do `print.develop`, `view.*`, `output.display` and `output.frame`, because their inputs changed.

```text
#9c02… source.open → #41d7… scan.density → #3f1a… invert.dyes → #77c0… print.expose     (cached, unchanged)
#b2e4… print.lights {logH:[0.1,0,0]} → #e05c… print.develop → … → #5aa1… output.frame   (new)
```

**Step 4: evaluation of the grey patch pixel.** The pixel's transmittance is T = (0.20, 0.10, 0.05), and the rebate's is (0.80, 0.50, 0.35).

| Stage | Before (lights 0) | After (+4 pt red) |
|---|---|---|
| `scan.density` d = −log₁₀(T/T_reb) | (0.6021, 0.6990, 0.8451) | unchanged (cached) |
| `invert.dyes` c = d | (0.6021, 0.6990, 0.8451) | unchanged (cached) |
| `print.expose` x = −c (10 s, f/8, no filtration) | (−0.6021, −0.6990, −0.8451) | unchanged (cached) |
| `print.lights` x + ℓ | (−0.6021, −0.6990, −0.8451) | (−0.5021, −0.6990, −0.8451) |
| `print.develop` a = 0.8 + 1.5(x + 0.7) | (0.9469, 0.8015, 0.5824) | (1.0969, 0.8015, 0.5824) |
| `view.reflect` R = 10^(−a) | (0.1130, 0.1579, 0.2616) | (0.0800, 0.1579, 0.2616) |
| `output.display` sRGB-encoded | (0.3703, 0.4340, 0.5484) | (0.3133, 0.4340, 0.5484) |

More red light on the paper produces more cyan dye in the red-sensitive layer. Red reflectance falls, and the print turns more cyan, as it does in a real darkroom. Only the stages from `print.lights` down were computed, and the engine's run counter for the upper nodes stays unchanged. The test asserts that.

**Step 5: undo.**

1. `log.undo()` moves the cursor back by one.
2. `state` now folds the units before `g3`, so `print.lights.logH` is `[0, 0, 0]` again and the state hash is exactly `S0`.
3. `compile` returns the old node ids, and the engine serves them from its cache, so the pixel is exactly (0.3703, 0.4340, 0.5484).
4. Entry `seq 5` is still in the journal, and `redo()` would restore it.

**A failing variant.** Suppose the DSL had sent the value in points: `[4, 0, 0]`. Then `bindArgs` fails with:

```yaml
code: E_ARG_RANGE
message: 'print.lights.logH = [4, 0, 0] is outside the allowed range [-1.5, 1.5] (logH).'
hint: 'Printer lights are stored in log H: 1 point = 0.025 log H.'
fix: '[0.1, 0, 0]'
valid: ['[-1.5, 1.5]']
```

Nothing is appended, and the state hash stays `S0`.

## 7. Changing the contract after v0

The contract is v0 until M1 is signed off. During v0 anything may change, but every change still gets a changelog note, because other tickets are already building against it. From M1 on, `@chromobench/contract` follows semantic versioning, and the constant `CONTRACT_VERSION` in `packages/contract/src/index.ts` carries the version.

**How a change is proposed.** The architecture doc §8.3 says contract changes are edits to CHB-002's catalog, introduced by a short note in CHB-002's changelog. The note has a fixed shape:

```text
CC-014  print.lights: add optional `auto` argument (CHB-010)
class:     additive (minor)
changes:   ArgSpec print.lights.auto: bool = false → print.lights.auto
consumers: DSL (generated), UI (generated control), engines (ignore until implemented; mock: identity)
migration: none (default preserves behaviour)
tests:     conformance cases regenerate; law "auto=false is identity" added
```

**How a change is classified.** The same pull request that changes the registry runs `pnpm gen`. The CI job `pnpm contract:check` diffs `catalog.snapshot.json` against `main` and classifies every difference:

| Change | Class | What else is required |
|---|---|---|
| new op, new error code, new domain value in `domainIn`, wider range | additive → minor | mock implementation + conformance pass in the same PR |
| new optional argument whose default preserves behaviour | additive → minor | as above |
| new recipe field with a default | additive → minor | `defaultRecipe` updated; old recipes still validate |
| new enum value | minor, but compile-visible | exhaustive `switch` statements in consumers fail to compile; that is intended |
| rename, removal, changed type, changed unit or meaning, narrower range | breaking → major | recipe migration (if persisted) + DSL redirect for one major version |
| changed default of a recipe-backed argument | breaking → major | migration that writes the old default explicitly into old recipes |
| changed default of a non-recipe argument (e.g. `aperture_px`) | minor | docs and playbooks re-run in CI |

Why do defaults matter so much? `frame.add` writes complete recipes, so existing frames do not depend on recipe-backed defaults. But a default that changes how a *new* frame prints, or how a playbook measures, changes behaviour without any edit appearing in the log. Treating such a change as breaking forces someone to look at it.

**Migrations and redirects.**

- **Recipes.** `FrameRecipe.version` increments only on a breaking recipe change. `migrations[n]` turns version n into n+1. `fixtures/recipes/v<n>/` keeps example recipes of every past version, and a test migrates them all to the current version.
- **The DSL.** A renamed argument or op keeps a redirect for one major version. The old name throws `E_UNKNOWN_OPTION` or `E_UNKNOWN_OP` with a literal fix. goja-cv's rule was "removed names throw with a literal fix rather than aliasing" (report §3.7). Agents learn the new name from the error instead of silently relying on the old one.

**Who decides.** The CHB-002 owner acts as contract steward and reviews every note. The consumers named in the note's `consumers` line review the PR. For generated consumers (UI and DSL), that review is the generated diff.

**Stubs first.** A new op lands as metadata, a mock implementation and generated conformance cases, all in one PR. The owning ticket then implements it in the reference and GPU engines. This keeps the catalog ahead of the implementations, which is what lets the tracks run in parallel.

## 8. Implementation plan

| Stage | Build | Files | Done when |
|---|---|---|---|
| 1. Repo and toolchain | pnpm workspace, strict tsconfig, lint with import boundaries, Vitest, Playwright Chromium-WebGPU project, `wgsl-check`, CI | root configs, `.github/workflows/ci.yml`, `tools/wgsl-check/` | CI is green on an empty package; the WebGPU smoke compute shader returns `[1,2,3,4]` from `[0,1,2,3]` in headless CI |
| 2. Domains and units | `DOMAINS`, `Quantity`, conversions, `spectrum.ts` kind algebra, error codes | `domains.ts units.ts spectrum.ts errors.ts` | unit and kind laws pass (§9); D + logH throws the Hunt 14.17 message |
| 3. Registry and v0 catalog | `registerOp`, `bindArgs`, `closest`, all catalog areas as stubs, `gen-docs` (op-args, reference, snapshot) | `registry.ts catalog/*.ts tools/gen-docs/` | every op of §5.5 registers; generated files are checked in; CI diff is clean |
| 4. Graph | `Graph.intern`, `nodeId`, `closure`/`adopt`, `compile` | `graph.ts` | graph laws pass; `adopt(closure(id))` reproduces `id` |
| 5. Recipe and edit log | `FrameRecipe` validator, `settablePaths`, mutations, `EditLog` (modes, pending, `expect`, preview, undo units, `why`, both hashes) | `recipe.ts mutations.ts editlog.ts` | edit-log laws pass; the §6 trace runs as a unit test |
| 6. Engine interface | engine and eval types; `EvalTarget.signal` | `engine.ts eval.ts` | types compile in all consumer stubs |
| 7. Mock engine | every op of §5.10, `tiff16.ts`, fixture generator | `packages/engine-mock/`, `tools/fixtures/make-m1.ts` | §6 numbers reproduced to 1e-4 |
| 8. Conformance | `generate.ts`, `run.ts`, `mutants.ts`, law runner | `packages/conformance/` | mock passes 100 %; every mutant fails its case |
| 9. M1 | minimal `apps/studio` page, `e2e/m1-walking-skeleton.spec.ts` | `apps/studio/`, `e2e/` | the five M1 steps pass in CI headless Chromium |

Stages 2 to 5 can be split between two people once stage 1 is done. Stage 7 needs stages 3 and 4. Stage 8 needs stage 7.

## 9. Testing and acceptance

**Laws this ticket owns.** Each law runs with `check(…, {n: 200, seed: 1})` in CI and with a fresh seed nightly.

| Law | Property | Numbers | Source |
|---|---|---|---|
| `units.dimension` | `D + logH` throws `E_UNIT`; `logH + stop` is defined | message contains "Hunt 14.17" | textbook §1.1, §2.8 |
| `units.stop` | `toLogH(s, 'stop') = 0.30103·s` | 1 stop = 0.30103 log H = 12.04 pt | §1.1 |
| `units.point` | `toLogH(p, 'point') = 0.025·p` | +4 pt = 0.1 log H | §2.6, §3.6 |
| `units.time` | `stopsFromTime(10, 12.6)` | 0.3334 stop = 0.1004 log H = 4.01 pt | derived |
| `units.fstop` | `stopsFromFstop(8, 11.3137)` | −1.000 stop | derived |
| `units.cc` | 50 CC → D 0.5 → T 0.3162 | | §2.6 |
| `spectrum.beerLambert` | density of a product of transmittances = sum of densities (kind algebra + numbers) | 1.0626·0.1294·0.9950·0.2498 = 0.03418 = 10^−1.4662 | §1.2 |
| `spectrum.zero` | `toDensity(0) = 8` | | §1.1 |
| `lights.compose` | lights add: `lights(lights(x, a), b) = lights(x, a + b)` (mock, exact) | | §2.8 row 1 |
| `graph.hashcons` | same op, args (any key order, defaults explicit or omitted) and inputs → same id; any change → different id | | goja-cv §3.5 |
| `graph.adopt` | `adopt(closure(n))[last].id = n.id` | | §5.7 |
| `log.undo` | `stateHash(undo(apply(s, u))) = stateHash(s)` | | DR-5 |
| `log.redo` | `redo(undo(s))` restores the hash | | DR-5 |
| `log.approve` | `approve(propose(m))` and `auto`-mode `propose(m)` give the same state hash as `apply(m)` | | DR-7 |
| `log.stale` | change a path after `propose`; `approve` returns `E_STALE` and leaves the hash unchanged | | DR-7 |
| `log.ts` | timestamps do not affect the state hash or the log hash | | §5.8 |
| `log.preview` | preview never changes the journal or the hash of the committed state | | DR-6 |

**Golden numbers.** `fixtures/golden/contract.json` holds the unit numbers above and the §6 table: the scanner density, the paper dyes, R and display values before and after +4 pt. The mock engine must reproduce them to 1e-4. The physics golden numbers, for example "the grey card prints at visual density 0.755" (textbook §2.7), belong to CHB-003's fixtures and run against the reference engine once it exists.

**Conformance.** `engine-mock` must pass 100 % of the generated cases. The reference and GPU engines pass the cases for the ops in their `capabilities().ops`, and CI prints the coverage table.

**How to tell a test can fail.**

- Every conformance case has a mutant (§5.11).
- Every law has a deliberately wrong implementation in `laws.test.ts`, for example a `toLogH` with 0.3 instead of `log₁₀ 2`, and the test asserts that `check` reports it with a shrunk counterexample.
- The M1 test is run once against an `EditLog` whose `undo` does nothing, and must fail at step 4.

## 10. Risks, open questions and decisions

**Decisions that block work.** Each one needs an answer before the stage named.

1. **Multi-frame transactions (before CHB-010 roll features).** DR-5 makes logs per frame. "Apply these lights to the whole roll" needs either a cross-frame transaction with undo in each frame, or a roll-level recipe layer. Chromogen has a "Roll" section with lights shared across frames (`SECTIONS`, line 998). Proposal: defer to CHB-010; v0 has no roll-level settings.
2. **Recipe storage of filtration (before stage 3).** The architecture doc uses `{c, m, y}` objects in the recipe and `vec3` in `ArgSpec` types. This guide proposes an ArgSpec type `cmy` (§11). The alternative is to store arrays. Decide once, because migrations are expensive later.
3. **Ownership of the M1 page.** This guide assigns the minimal page to CHB-002 and the real shell to CHB-009. Both tickets need to agree before stage 9.

**Risks.**

- **Floating-point drift in ids.** Arguments computed by code, for example `0.1 + 0.2`, hash differently from typed literals such as `0.3`. That only affects caching, never correctness, because two different ids are simply two cache entries. Do not round inside `canonicalJSON`: rounding would merge genuinely different arguments.
- **Catalog churn.** The v0 catalog is wider than M1 needs. Expect owners to rename arguments in their first weeks. The change process is light during v0 for exactly this reason.
- **Headless WebGPU in CI.** The flag sets differ between Chromium versions, and SwiftShader is slow. Keep the CI WebGPU work to smoke tests; real GPU performance tests run on a machine with a GPU (CHB-005).
- **Validator library.** A schema library that cannot express the recipe's union types forces hand-written validators. Prototype `FrameRecipe` in the chosen library during stage 5, before committing to it.

**Ordinary implementation choices** (no decision record needed): the ESLint or Biome configuration, the schema library, the internal layout of the mock engine, and the fixture ramp's exact shape.

## 11. Proposed contract additions (for CHB-002)

These change or extend the architecture doc's §5 sketches. CHB-002 ratifies them in its changelog as v0 notes.

1. **`spectrum.ts`** in `packages/contract/src/`: `GRID`, `SpectrumKind`, `productKind`, `sumKind` (§5.2).
2. **`DOMAINS` table** with channels, unit, range, tap and doc per domain (§5.2).
3. **`OpDef.on`** accepts `'none'` for receiver-less ops (`source.open`, `darkroom.contactSheet`).
4. **`OpDef.internal?: boolean`** keeps an op out of the DSL, the UI and the docs (`source.pattern`). **`OpDef.dsl?: boolean`** (default true) keeps an op out of the DSL only (`output.encode`).
5. **`OpDef.class`** adds `'geometric'` (`output.frame`), after goja-cv's GeometricOp.
6. **`OpDef.validate?(args)`** is a cross-argument check (`darkroom.testStrip.step` per `vary`); **`OpDef.channels?: 1 | 3 | 4`** overrides the domain's channel count (`invert.dyes` returns 4: c, m, y, residual).
7. **`ArgSpec.path?: string`** is an absolute recipe path for an argument that does not live at `recipePath + '.' + name`.
8. **`ArgSpec.type`** adds `'cmy'` (CC filtration object), `'string[]'` and `'Image[]'`/`'Mask[]'` for `print.combine` and `contactSheet`.
9. **`Unit`** adds `'deg'` (`finishing.hue.shift_deg`).
10. **`ArgSpec.redirects`** becomes `Record<string, { hint: string; scale?: number }>`. The binder renders a literal fix with the value converted by `scale`. This replaces `string[]`, because a bare name map would silently treat points as log H.
11. **`ArgSpec.ui.displayUnit?: Unit`** lets a control show a value in another unit than it is stored in (lights shown in points).
12. **`EvalTarget.signal?: AbortSignal`** allows cancellation (§5.9).
13. **`EngineCaps.ops: string[]`**; and `ValueInfo`, `FieldSpec`, `SourceRef`, `SourceInfo`, `ImageResult`, `MeasureSpec`, `Measurement` and `TableKey` as sketched in §5.9.
14. **`Mutation` `set`** adds `expect?: unknown`; **`LoggedMutation`** adds `seq: number`, `frame: string` and `why?: string` (§5.8).
15. **Correction of the vocabulary example.** The lights mutation is `{op:'set', path:'print.lights.logH', value:[0.1, 0, 0]}`, in log H.
16. **Catalog additions** beyond the representative list: `source.pattern` (internal), `print.combine`, `output.frame`.
17. **`CONTRACT_VERSION`** and `catalog.snapshot.json` as the basis of the change process (§7).
18. **Layout additions:** `tools/wgsl-check/`, `tools/fixtures/`, `e2e/` and `fixtures/recipes/v<n>/` beside the paths of the architecture doc §6.

## 12. References

**Project documents.**

- Architecture doc: `C1/design-doc/01-chromobench-architecture-and-work-plan.md`, §2 (physical model), §4 (vocabulary), §5 (contracts), §6 (layout), §8 (plan and rules).
- goja-cv report: `C1/various/analysis-goja-cv.md`, §2 (API surface, registry, hashing), §3 (errors, determinism, evidence-driven design), §4 (tests), §5 (what does not transfer).
- Filmbench report: `C1/various/analysis-filmbench-ide.md`.
- Chromogen report: `C1/various/analysis-chromogen-studio.md`, §5.4 (recipe and history).

**Code.**

- goja-cv at `5a93095`: `pkg/cv/graph/registry.go`, `node.go`, `args.go`, `suggest.go`, `eval.go`, `cache.go`, `errors.go`.
- Filmbench: `C1/various/extracted/filmbench-ide/01-inline.js`, lines 1121–1176, 1214–1316, 1430, 1458–1739, 1796–2117 and 2203–2503; `vfs/examples/16-mutations.js` and `19-diagnostics.js`.
- Chromogen: `C1/various/extracted/chromogen-studio/05-inline.js`, lines 142–216, 218–383, 995–1597 and 3845–4512.

**Textbook** (`C1/sources/The Mathematics of the Colour Negative.md`).

- §1.1: grid, spectrum kinds, units.
- §1.2: Beer–Lambert and the grey card numbers.
- §2.6: printer lights, points, CC.
- §2.8: composition laws and the law harness.
- §2.9: reusable API and the three suggested unit tests.
- §3.6: printer points, after US 6,985,253.

**External.**

- Chromium web-test WebGPU flags: `third_party/blink/web_tests/FlagSpecificConfig` (`--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`).
- Emscripten WebGPU CI flags (adds `--enable-features=Vulkan`).
- "Supercharge Web AI model testing: WebGPU, WebGL, and Headless Chrome", developer.chrome.com, which notes that headless Chrome disables the GPU by default.
- ECMAScript `Number::toString`: the shortest round-trip digits, the basis of canonical JSON numbers.
- `@noble/hashes`: synchronous SHA-256.
