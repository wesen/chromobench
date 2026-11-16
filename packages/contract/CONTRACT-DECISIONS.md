# Contract decisions

`@chromobench/contract` v0 (`CONTRACT_VERSION = '0.1.0'`); contract 0.2 (`'0.2.0'`, CHB-017), contract 0.3 (`'0.3.0'`, CHB-024), contract 0.4 (`'0.4.0'`, CHB-031) and contract 1.0 (`'1.0.0'`, CHB-037) are the last sections before the template. The following file records every "Proposed contract additions" item from the intern guides of CHB-002 to CHB-015. CHB-013 proposed none. Each item has one of three statuses:

- **accepted**: in v0 as proposed;
- **adapted**: in v0 in a different shape, with the reason given;
- **deferred**: not in v0. The owner adds it through the change process when they need it.

The change process works as follows:

1. Edit the catalog, the recipe schema or the types.
2. Run `pnpm gen`, which regenerates `catalog.snapshot.json`, `src/generated/op-args.ts` and `docs/reference/ops/`.
3. Run `pnpm contract:check` to classify the diff.
4. Add a note in the shape of the template at the end of this file, and in the CHB-002 changelog.

Until M1 sign-off everything may change, but every change still gets a note.

## Defaults for the open decisions (architecture doc §8.4)

| Question | v0 default | Where it shows |
|---|---|---|
| Kind of "digital RAW" | **Both**: camera photos and camera scans of negatives | `FrameRecipe.kind` is `'negative-scan' \| 'digital-raw'`; `DecodeOptions.mode` is `'scan' \| 'photo'`. `compile()` builds both chains: a scan → `scan.*` → `invert.dyes`, and a photo → `source.xyz` → `capture.expose` → `film.*` |
| Capture setup | **Unknown, so all setups are supported** | `ScanSettings.scanner` is a free id, with `valuesFrom: 'scanners'`. `SourceRef.kind` includes `'triplet'` (narrowband RGB shots); flat field, open gate and flare are all optional |
| Black and white | **Later** | The `silver-density` domain is reserved and listed in `DOMAINS`. No B&W ops are in v0 (CHB-014 adds them) |
| Output | **Files plus ICC first** | `view.output.export` (`ExportSettings`: tiff16/png16, ICC signalling, sidecar recipe) and `output.encode`. `PrinterSettings` and proof settings exist but stay nullable |
| Hosting | **A static PWA**; the Go bridge is optional | Nothing in the contract depends on a server. `EvalRequest`/`EvalResult` are transport-neutral |

## CHB-002 (own guide, §11)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `spectrum.ts`: GRID, SpectrumKind, productKind, sumKind | accepted | Adds `T_FLOOR`, `toDensity` and `toTransmittance` (scalar only) |
| 2 | `DOMAINS` table | accepted | Adds `channel4`, the meaning of a fourth channel |
| 3 | `OpDef.on: 'none'` | accepted | |
| 4 | `OpDef.internal`, `OpDef.dsl` | accepted | |
| 5 | `OpDef.class: 'geometric'` | accepted | |
| 6 | `OpDef.validate`, `OpDef.channels` | accepted | `validate` returns a message or null, and the binder raises `E_ARG_RANGE` with it |
| 7 | `ArgSpec.path` | accepted | `path: ''` means "not recipe-backed" even when the op has a `recipePath` |
| 8 | ArgTypes `cmy`, `string[]`, `Image[]`, `Mask[]` | accepted | Node-typed arguments hold node ids and are appended to `inputs` |
| 9 | Unit `deg` | accepted | |
| 10 | `redirects: Record<name, {hint, scale?}>` | accepted | When a value is out of range, the binder also tries each redirect's scale. `logH: [4,0,0]` therefore gets `fix: '[0.1, 0, 0]'` |
| 11 | `ui.displayUnit` | accepted | |
| 12 | `EvalTarget.signal` | accepted | `MeasureSpec.signal` too (CHB-008/009) |
| 13 | `EngineCaps.ops`, `ValueInfo`, `FieldSpec`, `SourceRef`, `SourceInfo`, `ImageResult`, `MeasureSpec`, `Measurement`, `TableKey` | adapted | Merged with the CHB-005/006 shapes below. `ImageResult.read()` is lazy, and `ValueInfo` carries `returns: 'Value' \| 'Regions' \| 'Table'` |
| 14 | `set.expect`, `LoggedMutation.seq/frame/why` | accepted | Also `approvedBy` |
| 15 | Lights mutation path `print.lights.logH`, values in log H | accepted | `set` on `print.lights` fails with `E_PATH`, which lists `print.lights.logH` and `print.lights.auto` |
| 16 | Catalog additions `source.pattern`, `print.combine`, `output.frame` | accepted | `print.combine` gains `modes: string[]` ('add' for burn, flash and split; 'subtract' for dodge) |
| 17 | `CONTRACT_VERSION`, `catalog.snapshot.json` | accepted | Also `pnpm contract:check` |
| 18 | Layout `tools/wgsl-check`, `tools/fixtures`, `e2e`, `fixtures/recipes/v<n>` | accepted | `fixtures/recipes/v1/` has no examples yet |
| — | **Engine.adopt(defs)** (new) | added | `evaluate(NodeRef)` alone cannot give an engine the node definitions. Callers send `graph.closure(id)`; an engine re-interns the definitions and checks the ids |
| — | **OpDef.owner**, **OpDef.domainFromArg** (new) | added | `owner` feeds the docs. `domainFromArg` is used by `source.pattern` |
| — | **Domains `scan-classes`, `scalar-field`** (new) | added | They resolve CHB-003 #3 and CHB-006 #6 |
| — | Decision 2 (§10): filtration storage | decided | Stored as the `{c, m, y}` object (ArgType `cmy`), never as an array |
| — | Decision 1 (§10): multi-frame transactions | deferred | Logs are per frame (DR-5); CHB-010 decides |

## CHB-003 (physics reference)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `PhysicsConventions` in every table key and node hash | adapted | The type is in `engine.ts`; `EngineCaps.conventions` and `TableKey.conventions` carry its version. It is **not** in node ids: ids name the computation, are engine-independent, and must match across realms. Mixed-convention comparisons are caught by comparing `capabilities().conventions` |
| 2 | Channel 4 of `film-dyes` = solve residual in D | accepted | `DOMAINS['film-dyes'].channel4`; `invert.dyes` has `channels: 4` |
| 3 | Class-map output | accepted | New domain `scan-classes` (codes 0 ok, 1 blank, 2 below, 3 gamut) and op `invert.classes`. `invert.classify` keeps returning fractions |
| 4 | `AutoBalance` shape | adapted | Merged with CHB-010 #2: `{method: 'none'\|'integrate'\|'grey-patch'\|'roll'\|'match'\|'learned', alpha, analysisLongSide_px, rollConsistency, matchFrame, matchAmount, applied, logH}`. Nullable rather than optional fields, so every recipe is complete |
| 5 | `print.aim` | accepted | `'grey-0.184' \| 'midgray-normalised'`, default `grey-0.184`. `print.lights.logH` is relative to it |
| 6 | `ImageInfo.whiteXYZ` | accepted | |
| 7 | Scanner flare as a fraction of open-gate signal | adapted | `scan.flare` stays in **percent** (catalog unit), documented as "percent of the open-gate signal" |

## CHB-004 (data packs)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `FrameRecipe.data: {pack, packHash}` | accepted | Nullable; `defaultRecipe` writes `null` until packs exist |
| 2 | `ArgSpec.valuesFrom` | accepted | Values `'stocks:film' \| 'stocks:print' \| 'illuminants' \| 'scanners' \| 'lamps'` (adds `lamps`) |
| 3 | `TableKey` with content hashes | accepted | Merged into the CHB-005 union: every `Hash` field is the content hash of consumed data |
| 4 | Diagnostic codes | accepted | `E_STOCK_UNKNOWN E_DATA_HASH E_DATA_GRID E_DATA_SCHEMA E_DATA_POLICY W_STOCK_KNOWN_ISSUE W_STOCK_NO_MODEL W_DATA_ILLUSTRATIVE W_DATA_PACK_CHANGED` |

## CHB-005 (WebGPU engine)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `EngineCaps` fields | accepted | `available, why?, adapter?, maxTextureDimension2D?, maxBufferSize?, f16, float32Filterable?, timestamps, budgetBytes?`, plus the guide's `ops, maxSize, precision` |
| 2 | `TableKey` discriminated union | accepted | Adds `conventions` (CHB-003 #1) |
| 3 | `ImageResult` with lazy `read()` and optional `gpu` | accepted | `format: 'f32' \| 'f64' \| 'u16'`, `width`, `height`; `gpu?: {texture: unknown}` (the contract does not depend on `@webgpu/types`; narrow it in `gpu`) |
| 4 | `EvalTarget.signal` | accepted | |
| 4b | `EvalTarget.taps` | deferred | Ask for intermediate nodes instead; hash-consing reuses the shared prefix. Revisit if one GPU pass per tap proves too slow |
| 5 | `Engine.plan(node, target)` (optional) | accepted | `TilePlan` keeps `frame, tile, halo, tiles[{index, core, read}], bytesPerTile`. The GPU-internal `fields` and `stats` stay in `packages/gpu` |
| 6 | Codes `E_DEVICE_LOST E_GPU_OOM E_KERNEL_COMPILE E_HALO_TOO_WIDE` | accepted | |
| 7 | Spatial arguments in `um`; look operators in `fraction` | accepted | `film.couple.diffusion_um`, `film.grain.size_um`, `print.densityMask.radius_um` |

## CHB-006 (ingest)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `SourceRef`, `DecodeOptions`, `SourceInfo`, `ScannerForward` in `source.ts` | accepted | `SourceRef` also has `name?` and a transient `bytes?`, which is never persisted (the validator refuses it). `SourceInfo.camera` merges CHB-012 #2 (`CameraColour`). The guide's "ScannerModel" is `ScannerForward` (DR-9) |
| 2 | Recipe `scan.format`, `openGate`, `dust` | accepted | |
| 2 | Recipe `scan.flare` widened to number or vec3 | deferred | v0 keeps a single number, the owning arg `scan.flare.flare`. Widening it later is a breaking type change, so decide it before CHB-013 calibrates flare |
| 2 | Boxes in **sensor coordinates** | accepted | This is DR-3 (source pixels). `rebate`, `crop`, `openGate`, dust spots and probes are all sensor pixels; orientation is applied last by `output.frame` |
| 3 | Ops `source.xyz`, `scan.baseClass`, `scan.conditioning`, `scan.rankStocks`, `scan.specks`, `scan.heal`, `scan.checkDust` | accepted | `scan.conditioning` outputs the new `scalar-field` domain. `scan.heal` takes the spots as canonical JSON (`spots: string`, filled by `compile` from `scan.dust.spots`), so the node id changes when the spots change |
| 4 | classify split (ingest noise classes; core adds gamut) | accepted | This is a note: both write `scan-classes` codes |
| 5 | Codes `E_FORMAT`, `W_*` | adapted | `E_FORMAT` and all twelve `W_` codes are in. `E_LIBRAW_<n>` is collapsed to `E_FORMAT`, with the LibRaw code in the message; dynamic codes would break the closed list |
| 6 | A numeric single-channel domain | accepted | `scalar-field`. `mask` stays in 0..1 |

## CHB-007 (DSL runtime)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `Look` | adapted | Merged with CHB-008 #3: `{n, caption, node?, domain?, region?, scale?, numbers, image: {mime, width, height, bytes}}` |
| 2 | `ContextBlock` | accepted | |
| 3 | Codes `E_NOT_AWAITED E_IMMUTABLE E_UNKNOWN_METHOD E_NO_FRAME E_SANDBOX E_STALLED E_MEMORY` and warnings `LOOKS CUT UNHANDLED EDITS_DROPPED` | accepted | |
| 4 | `OpDef.dsl` | accepted | `output.encode` and `source.pattern` set `dsl: false` |
| 5 | `EvalResult.mutations` = `LoggedMutation`s from `propose` | accepted | |
| 6 | `EvalRequest` unchanged | accepted | |
| — | Sync QuickJS build with host promises (DR-2) | noted | No effect on the contract: every `Engine` method already returns a Promise, and `Graph.intern` is synchronous (DR-4) |

## CHB-008 (agent integration)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `LoggedMutation.seq` | accepted | Per frame, monotonic from 1 |
| 2 | `LoggedMutation.frame` | accepted | |
| 3 | `Look` | adapted | See CHB-007 #1 |
| 4 | Codes `E_TIMEOUT E_CANCELLED E_BUSY E_SESSION E_SESSION_RESET E_NO_PAGE E_READONLY E_PATH E_TOOL_INPUT CONFLICT` | accepted | |
| 5 | `signal` on evaluate and measure | accepted | Through `EvalTarget.signal` and `MeasureSpec.signal`, not a third argument |
| 6 | `EvalResult.trace` | accepted | |
| 7 | Recipe field for retouched dust spots | adapted | Merged into CHB-006's `scan.dust.spots` (`{id, x, y, r}` in sensor px), changed with `set` |

## CHB-009 (studio UI)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `ui.display`, `ui.scale`, `ui.aside` | adapted | `display` is `ui.displayUnit` (CHB-002 #11). `scale: 'linear' \| 'log2'` and `aside` are accepted, and `components` (vec3/cmy labels) is added |
| 2 | `ArgSpec.path` | accepted | |
| 3 | Paths by id: `print.exposures.<id>.time_s` | accepted | Patterns use `*`; a missing id gives `E_PATH` with the valid ids |
| 4 | `Exposure.enabled` | accepted | |
| 5 | `MaskSpec` vector shapes | adapted | `MaskSpec = {version: 1, nodes: NodeDef[]}`, the closure of a mask node (CHB-002 §5.8). The vector shapes are the `mask.*` ops (ellipse, gradient, luminance, paint, and/or/not, feather). Geometry is in sensor px (DR-3), not fractions of the long side |
| 6 | `FrameRecipe.probes` | accepted | `Record<id, {x, y, r}>` |
| 7 | `view.inspect` | accepted | Takes any domain and outputs `display-rgb`; modes negative/density/dyes/classes/mask |
| 8 | signal on evaluate and measure | accepted | |
| 9 | `ImageResult` texture and colour encoding | accepted | `ImageResult.gpu` and `ImageInfo.colour` |
| 10 | Rich `measure.densitometer` result | deferred | v0 returns `{D, visual?}`. CHB-003 widens it once the reference engine can fill `printingDensity`, `paperLogH` and `lab` (an additive change) |
| 11 | `LoggedMutation.seq` | accepted | |
| — | M1 page ownership (§10 decision 3) | decided | CHB-002 ships the minimal `apps/studio` page (`src/session.ts`, `viewer.ts`, `controls.ts`, `main.ts`); CHB-009 replaces it |

## CHB-010 (darkroom printing)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `print.enlarger.magnification` | accepted | Optional and nullable; `null` means the calibration reference. The versioned calibration reference belongs in CHB-004's pack and is deferred |
| 2 | `AutoBalance` | adapted | See CHB-003 #4 |
| 3 | `print.lights.warmth`, `tint` | deferred | A second source of truth beside `logH`. If they come, they should be UI macros that write `logH`, not recipe state |
| 3 | `print.crossover` | deferred | |
| 4 | `Exposure` semantics | accepted | `kind: 'main'` is reserved and refused by `exposure.add`; `stops` is relative to the main time (`compile` implements burn and dodge times); dodge cannot carry filtration; `through` is added for flash |
| 5 | `FrameRecipe.masks` | accepted | `Record<string, MaskSpec>`, the target of `mask.set` |
| 6 | `print.densityMask` op | accepted | `printing-density` → `printing-density`, spatial, scan |
| 6 | `print.densityMasks` recipe | deferred | It will come with CHB-010's compile rule |
| 7 | `darkroom.lightsToFiltration` | accepted | Returns a Value: `{filtration, residual}` |
| 7 | `darkroom.bake` | deferred | It produces mutations, so it is a host action, not a graph op |
| 7 | testStrip arguments of CHB-010 §6.8 | deferred | v0 keeps the guide's `vary/steps/step/direction` |
| 8 | `preview` flag on `ImageResult`/`Measurement` | accepted | |
| 9 | Codes `W_DODGE_EXCEEDS_MAIN W_PREVIEW_APPROX E_TOO_MANY_PACKS` | accepted | |
| 10 | Vocabulary note: `[0, 4, −2]` is in points | accepted | The same correction as CHB-002 #15 |

## CHB-011 (output and colour management)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `OutputSettings`, `ExportSettings`, `PrinterSettings`, `KneeSpec`, `Intent`, `OutputSpaceId` | adapted | `KneeSpec` is `{method, strength}`, one strength parameter (p for cam16-ucs, s for tanh-shoulder) instead of a union, so its fields are settable paths. `OutputSettings.white` holds `view.adapt`'s target |
| 2 | `output.display`, `output.encode` | accepted | `output.display.space` is **not** recipe-backed: it is the viewer's display space, passed through `compile(r, g, {displaySpace})`. Export uses `view.output.export.space`. `output.encode` returns a Value (`EncodedFile` fields) and has `dsl: false` |
| 3 | `ImageInfo.colour` | accepted | |
| 4 | Compile rule: `scan-of-print` builds `view.flare` with flare 0 | accepted | It is the default rendering, so the M1 trace has no flare |
| 5 | Nothing but `output.encode` and measurements consumes `display-rgb`; `finishing.*` comes before `output.display` | accepted | `registerOp` enforces it. Two more exceptions: `output.frame` (geometric only, after the knee) and `mask.*`. `finishing.clarity` and `finishing.hue` now take `print-xyz` |
| 6 | `EvalTarget.signal`, `Engine.plan` | accepted | |
| 7 | Codes `E_CANCELLED E_SINK E_ICC_INVALID E_ICC_CLASS` | accepted | |

## CHB-012 (forward film and digital RAW)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `capture.sceneXYZ` | adapted | Merged with CHB-006's `source.xyz`, which keeps the name; CHB-006 owns the decode and the matrices. Arguments `mode: daylight/as-shot/custom`, `temperature_K`, `tint` → `capture.whiteBalance.*` |
| 2 | `SourceInfo.camera` | accepted | `CameraColour` |
| 3 | Recipe `capture.whiteBalance`, `adapt`, `autoExposure`, `format.longEdge_mm` | accepted | `autoExposure` is `{method: 'off'\|'mean'\|'grey', analysisLongSide_px}`, never the string `'off'`, so paths stay typed |
| 3 | `capture.film` block | adapted | v0 uses `capture.development.{dir, halation, grain}` (the CHB-002 catalog paths). `printGrid` is deferred |
| 4 | `DevelopmentSettings` | adapted | `{push, dir: {amount, diffusion_um}, halation: {strength}, grain: {amount, size_um, seed}}`. The read-only `basis` will go into measurement results later |
| 5 | `film.develop.curves` | accepted | Not recipe-backed; `compile` sets `precorrected` when `film.couple` precedes the op |
| 6 | Grain determinism | accepted | Documented on `film.grain`. The conformance determinism and region cases cover it; the mock hashes absolute pixel coordinates |

## CHB-014 (black and white)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Domain semantics | adapted | `silver-density` is reserved (1 channel, D). One-channel `film-logH`/`paper-dyes` are deferred |
| 2 | Ops `film.developSilver`, `invert.silver`, `measure.isoRange`, `print.tone`, `print.expose` accepting `silver-density` | deferred | B&W comes later (§8.4 default). Widening `print.expose.domainIn` is a minor change |
| 3 | Recipe `BwDevelopment`, `enlarger.head`, `scan.geometry`, VC grade mapping | deferred | |
| 4 | Unit `degC` | accepted | Cheap now, a compile-visible change later |
| 5 | Codes `W_SILVER_NOT_NEUTRAL` … | deferred | They come with the B&W ops |

## CHB-015 (extensions)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Finishing before `output.display`, plus a check that nothing consumes `display-rgb` | adapted | `finishing.clarity` and `finishing.hue` moved to `print-xyz`, and `registerOp` enforces the rule. The extra ops (`dyeSat`, `grainReduction`, `tone`, `sharpen`, `bloom`, `colour`) are deferred until CHB-015 starts |
| 2 | `finishing: {look, values, hues}` | accepted | `hues: Record<family, [shift_deg, saturation, luminance]>` |
| 3–6 | E1–E4 (`invert.unfade`, `measure.fade`, `invert.exposures`, `view.reflect.model`, `film.grain.model` …) | deferred | CHB-015 is optional and comes after M6 |
| 7 | Reserve `print.lights.auto.method: 'learned'` | accepted | |

## Contract 0.2 (CHB-017: the Phase-1 contract requests)

`CONTRACT_VERSION = '0.2.0'`. The 0.1.0 catalog is kept as `baselines/catalog-0.1.0.json`; `pnpm contract:check` compares
against it while `main` has no snapshot of its own (20 changes, 4 breaking: allowed under 0.x, each with a note below).
Decisions marked **(review)** were taken with sensible defaults and should be looked at by the user.

| Request | Item | Status | Notes |
|---|---|---|---|
| core R1 | `print.expose.filtration` is a shift on the database neutral pack **(review)** | accepted | `min: −100`, `detents: [0]`, doc says "0 = neutral; neutral + shift must stay ≥ 0". The reference engine already read it this way; the mock has no stock database, so its neutral is 0/0/0 and nothing changes numerically. `print.exposures.*.filtration` gets the same meaning and range (compile passes it to `print.expose.filtration`). The studio shows the shift signed (`+10 CC`) and its test strip may step below 0 (to −100) |
| core R2 | `print.aim` reaches the engine | accepted | `print.expose.aim` (enum, `path: 'print.aim'`); `print.aim` becomes op-owned in `RECIPE_FIELDS` (same values). `RefEngineOptions.aim` is removed |
| core R3 | The aim's viewing light **(review)** | accepted | `print.expose.aimView` (`path: 'view.illuminant'`, same spec as `view.reflect.illuminant`), so the grey-0.184 aim is neutral under the recipe's viewing light. Changing the viewing light now changes `print.expose`'s node id, which is correct: its output depends on it |
| core R4 | Noise σ for `invert.classes` / `invert.classify` | accepted | `sigma` (vec3, D, 0…0.2, default the Gold 200 640-px values). Not recipe-backed: compile does not build these ops; the host fills it from a `scan.noise` measurement. `RefEngineOptions.sigmaD` is removed |
| core R5 | `output.display.knee: 'cam16-ucs'` **(review)** | adapted | Renamed to what it is: `'oklch'` (default). CAM16-UCS proper is CHB-011's to add as a new value. `migrateRecipe` and the `EditLog` constructor rewrite `'cam16-ucs'` in pre-0.2 recipes and logged sets (`renameLegacyValues`); the binder refuses `'cam16-ucs'` in new calls with the valid values |
| core R6 | Engine conventions string | accepted | One id for all engines: core's `conventionsKey(conv)`, e.g. `core-v1:opaque/cie1931-2deg/subtract/model-3cdf/midgray-geomean`. `packages/gpu` reports it in `capabilities()` and in every `TableKey` (see "One physics" below) |
| dsl R1 | JavaScript error names as codes | accepted | `SyntaxError ReferenceError TypeError RangeError Error` are in `ERROR_CODES`; they are errors (the header comment says so) |
| dsl R2 | `ContextBlock.changed` | decided | The contract meaning stands: the paths this eval's edits touched. The doc comment now says so; "differs from the default, by author" would be a separate field if someone needs it |
| gpu #1 | `@chromobench/conformance/generate` | accepted | Subpath export of `src/generate.ts` (no Vitest import); the GPU parity page imports it instead of a relative path |
| gpu #2 | "Within one 8-bit level" / "identical in every 8-bit value" | noted | Readings confirmed: the 8-bit encodings differ by ≤ 1; "identical" is bounded as < 0.01 level continuous difference plus ≤ 1e-3 of values flipping at a rounding boundary |
| ingest #1 | `W_DECODE_NOTE` | accepted | Ingest's decoder facts (LibRaw scan/photo mode, full-colour raw, singular camera matrix, DNG black-level tags) use it; `W_ENCODING_ASSUMED` is left for real encoding assumptions |
| ingest #2 | Per-channel flare | deferred | `scan.flare` stays one percent; deferred to CHB-013, which calibrates flare and decides the widening (a breaking type change) |
| ingest #3 | Engines pass `scan.orientation` to the area resampler | noted | No type change: an engine that uses ingest for statistics passes `FrameRecipe.scan.orientation` as `RegionOptions.orientation` |
| studio #1 | `mask.paint.strokes` holds the strokes (canonical JSON) | accepted | Default `'[]'` (was `'none'`); the studio already writes it; the mock still returns an empty mask (CHB-010 rasterises) |
| studio #2 | `mask.ellipse.angle_deg` | accepted | deg, −90…90, default 0, rotation about the box centre. Mock implements it; the studio's `MaskShape` carries `angle` and round-trips it. Per-shape feather stays `mask.feather` |
| studio #3 | Ring-around step unit **(review)** | adapted | `darkroom.ringAround.step_cc` → `step_pt` (unit point, 1…16, usual 2…8, default 4) with a `step_cc` redirect whose hint explains the change. Mock: cells +Y +R +M / +G current +B / −1 step +C +1 step, offsets (v − mean v)·1.5·step as in the studio. DSL docs and examples use `{ step_pt: 4 }` |

### One physics for all engines (CHB-017 stage 2)

No contract type changed; these are the rules every engine now follows.

| Item | Decision |
|---|---|
| Conventions id | One id: core's `conventionsKey(conv)` (`core-v1:opaque/cie1931-2deg/subtract/model-3cdf/midgray-geomean` by default) in `RefEngine` and `GpuEngine` capabilities and in every GPU `TableKey`. `chromogen-interim-0` is gone |
| Stock and reference data | `PhysicsData` (core `data/provider.ts`) is the only way in. Interim provider: core's `interimFromJson` (browser-safe) and `interimData()` (Node; reaches `node:fs` through `process.getBuiltinModule`, so core's index also loads in a page). **Switch point for CHB-004:** `packages/gpu/src/physics/data.ts` `defaultPhysicsData()` / `GpuEngineOptions.data`, `RefEngineOptions.data` |
| GPU f64 oracle | core's `solveNode` / `spectralNode` over the table arrays (`@chromobench/core/tables`); worker, main-thread and parity tables are core's tables (solve table bit-identical to `buildSolveTable` in Studio node order, pd/print to f32 rounding). The Chromogen port in `packages/gpu/src/physics/` is deleted, and with it `fixtures/chromogen/` |
| GPU lowering | Parameters from core for the same nodes: filtration shift on the neutral pack, `aim`/`aimView`, normalised mode ignoring time and f-stop (as core), core's paper developer (grade → gamma morph) as the 1-D curve row, flare white, `view.adapt` (new GPU op, Bradford gains), display matrix `XYZ_TO_SRGB · Bradford(white → D65) · gain`, core's tanh shoulder, densitometer/patch densities (`densitiesOf`) |
| GPU `print-xyz` | XYZ under the viewing light with Y(perfect white) = 1, as the domain says and core does (it was D65-adapted in the interim chain) |
| GPU export path **(review)** | Printing density and print XYZ are integrated per pixel on export (exact bits in the pointwise kernel), not looked up tetrahedrally as CHB-005's guide planned. Reason: against core exact, the 33³ tables cost up to 1.8 levels; exact integrals bring export to 0.05 level. Preview still renders through tables |
| Reference engine | `RefEngine({mode: 'tabulated'})` renders `invert.dyes`, `print.expose` and `view.reflect` through core's f64 tables with the GPU's texel-centre trilinear lookup; `scan.density` is implemented (box mean or the brightest 5 % column band, as the mock; the GPU now uses the same rule when no box is given) |
| Ingest | `forward-stub.ts` is deleted; hosts pass core's `scannerForward(data, scanner, conv)`. The Gold 200 ranking golden (`fixtures/golden/ingest-laws.json`) reproduces under CHROMOGEN conventions (missing samples = zero density), as it was computed **(review)**: under core's default (missing = opaque) Ektar 100 reads 0.304 instead of 0.202 D in red, because its base data stops at 700 nm inside the 678 nm LED's tail; Gold 200 still ranks first and C200 second. Which convention ingest's ranking should use in the studio is CHB-006/CHB-013's call |
| Per-channel flare | Deferred to CHB-013 (ingest #2 above) |

GPU parity against core (SwiftShader, synthetic Gold 200 frame 96 × 64, `packages/gpu/test/browser`):

| Check | Interim (Chromogen) | Core (CHB-017) | Tolerance |
|---|---|---|---|
| Solve table vs f64 | ≤ 2.2e-6 | 2.15e-6, 0 flips | 2.2e-6 (unchanged) |
| pd table / print table | ≤ 7.2e-7 / 4.2e-7 | 7.15e-7 / 2.98e-7 | unchanged; print with a Bradford M 6e-7 (new check, 1e-6) |
| Export film-dyes vs exact | ≤ 5e-6 | 5.3e-7 | 5e-6 (unchanged) |
| Export display vs exact | 1.10 levels | 0.05 levels (0.06 scan-of-print + tanh) | ≤ 1 in 8 bits, < 0.1 continuous (tightened) |
| Preview display vs core tabulated | — | 0.046 levels | < 0.1 continuous (new) |
| Preview display vs core exact | ≤ 1 in 8 bits | 1.59 levels, 2 in 8 bits | ≤ 2 in 8 bits, mean < 0.25 (moved: the 33³ tables' own error, 1.61 levels in core's tabulated mode) |

### Change notes (contract 0.2)

```text
CC-001  print.expose.filtration: signed shift on the database neutral pack (CHB-003 R1)
class:     additive (range widened; the meaning was already the reference engine's)
changes:   min 0 → −100, doc, ui.detents [0]; recipe print.exposures.*.filtration min −100
consumers: UI (generated control: signed CC, strip below 0), engines (ref: unchanged; mock: unchanged)
migration: none
tests:     recipe −10 Y validates, −101 does not; ref engine: shift 0 = neutral pack

CC-002  print.expose.aim, print.expose.aimView: the aim and its viewing light are op arguments (CHB-003 R2, R3)
class:     additive (defaults grey-0.184, D50); every print.expose node id changes
changes:   recipe print.aim becomes op-owned; compile passes print.aim and view.illuminant
consumers: DSL (generated), engines (ref reads them; gpu: grey-0.184 aim from core)
migration: none
tests:     compile passes both; ref engine follows aim and aimView

CC-003  invert.classes.sigma, invert.classify.sigma (CHB-003 R4)
class:     additive; not recipe-backed
changes:   vec3 D, 0…0.2, default [0.0043, 0.0033, 0.0057]
consumers: DSL (generated), ref engine
migration: none
tests:     larger σ classifies more pixels blank

CC-004  output.display.knee: 'cam16-ucs' renamed 'oklch' (CHB-003 R5)
class:     breaking (enum value removed, recipe-backed default changed)
changes:   values ['oklch', 'tanh-shoulder', 'clip'], default 'oklch'; KneeMethod; recipe view.output.export.knee.method
consumers: DSL (generated), engines (ref: same algorithm; gpu: warning text)
migration: renameLegacyValues (migrateRecipe, EditLog constructor) rewrites 'cam16-ucs' → 'oklch' in version-1 recipes
tests:     migrateRecipe and EditLog load pre-0.2 documents

CC-005  darkroom.ringAround.step_cc → step_pt (studio request #3)
class:     breaking (argument renamed; redirect step_cc with a hint)
changes:   unit point, 1…16, default 4
consumers: DSL docs/examples, mock engine
migration: none (no persisted ring-around nodes)
tests:     step_cc gives E_UNKNOWN_OPTION with the hint

CC-006  mask.ellipse.angle_deg; mask.paint.strokes canonical JSON (studio requests #1, #2)
class:     additive (strokes default 'none' → '[]', not recipe-backed)
consumers: mock engine (rotation), studio (round trip)
tests:     studio maskSpec/parseMask round trip; a tilted ellipse covers its rotated axis

CC-007  error codes W_DECODE_NOTE, SyntaxError, ReferenceError, TypeError, RangeError, Error (CHB-006 #1, CHB-007 R1)
class:     additive
```

## Contract 0.3 (CHB-024: roll records, batches, flare, flash, density masks, framing, retouch, shared vocabulary)

`CONTRACT_VERSION = '0.3.0'`, `RECIPE_VERSION = 2`, `EditLogData.version = 2`. The 0.2.0 catalog is kept as
`baselines/catalog-0.2.0.json`; `pnpm contract:check` compares against `main` (0.2.0) or that file: 50 changes,
7 breaking (allowed under 0.x, each with a note below). `contract:check` now also reports `perChannel` and
Value-field changes. Decisions marked **(review)** were taken with sensible defaults and should be looked at by the user.

Sources: `packages/{core,dsl,gpu,ingest,output,studio-kit}/CONTRACT-REQUESTS.md`, `apps/studio/CONTRACT-REQUESTS.md`,
CHB-020 guide §7, CHB-022 guide §3.1/§6/§7.1, CHB-016 guide (Diagnostic.where), CHB-001 diary Step 8.

| Request | Item | Status | Notes |
|---|---|---|---|
| studio-kit R1, CHB-016/019 | `EditLog.preview` takes several mutations | accepted | `preview(m \| m[] \| null)`; `state` folds them in order; `[]` clears. The event is `{type: 'preview', mutation: first or null, mutations}` (0.2 listeners keep working) |
| studio-kit R2, CHB-016/019 | Shared frame vocabulary | adapted | In the contract (`src/vocab.ts`), not a new package: both users already depend on it. `FRAME_ACCESSORS` (name, domain, op), `ACCESSORS`, `PRINT_OPTIONS`, `PRINT_OPTION_PATHS`, `cut(r, g, op, opts)`, `accessorNode`. `packages/dsl` Host and `packages/studio-kit` handles and render bridge import it; studio-kit's copy is gone; the parity test now asserts that both re-exports are the contract's objects (`toBe`). The node-id parity test (viewer vs DSL `frame.print()`) stays |
| studio-kit R3, CHB-020 #1 | `scan.baseT: Vec3 \| null` | accepted | `scan.density.baseT` (vec3, fraction, 1e-6…100, optional) wins over `rebate`; compile passes only `baseT` when set, so the node does not depend on the box. Mock, core and GPU implement it (conformance semantic case). The roll kit still writes per-frame rebate boxes; switching roll setup to `baseT` is CHB-020's |
| studio-kit R4, CHB-020 #2, ingest #2 | `scan.flare: number \| Vec3`, in every engine **(review)** | accepted | New `ArgSpec.perChannel` (a number argument that also takes `[r, g, b]`, range per component; DSL type `number \| Vec3`). Formula everywhere: T = T′(1 + f) − f per channel (ingest `removeFlareValue`), T′ the signal relative to the open gate. **Review:** engines assume the signal is already open-gate-normalised (after `scan.flatField` with an open-gate flat); `scan.openGate` has no op yet. The mock's old rule (subtract f × the frame mean) is replaced. Core: new op; GPU: `OP.AFFINE` (16) in the pointwise kernel. CHB-013 still calibrates the numbers |
| studio-kit R5, CHB-020 #3 | `LoggedMutation.batch`, batch approval | accepted | `apply(…, {tx, batch})`, `propose(…, {tx, batch})`; `approve` / `reject` take `seqs` or `{batch}` (every pending entry of that batch in this log; an empty batch gives `E_MUTATION`) |
| studio-kit R6, CHB-020 #4–5 | `FrameRecipe.roll` and the `Roll` record **(review)** | adapted | `roll: {id} \| null` is a required recipe field and a settable path (custom rule), not an optional `roll?`, so validation and migrations treat it like every other field. `Roll<A, F>` (`src/roll.ts`) keeps the analysis opaque; `ROLL_SIDECAR = 'roll.json'`, `ROLL_STATUSES`, `validateRoll` (fragment keys must be settable paths). The roll kit's `Roll` is now `Roll<RollAnalysis, RollFragment>` from the contract |
| studio-kit R7, CHB-020 #7 | Roll and film-layout codes | accepted | `W_ROLL_MIXED W_ROLL_STOCK_AMBIGUOUS W_ROLL_BASE_WEAK W_FRAME_DIVERGES W_NO_SURROUND W_SURROUND_BRIGHT W_REBATE_BLANK W_NO_REBATE W_NO_FILM`, plus `W_VEIL_FROM_ROLL` (ingest already emitted it) |
| CHB-020 #6 | `AutoBalance` for roll / match | noted | Doc only: for `'roll'` and `'match'`, `logH` is the applied result and `method` the provenance |
| core C1 | `darkroom.lightsToFiltration` sees the print settings | accepted | Arguments with recipe paths (`logH`, `paper`, `mode`, `lamp`, `filtration`, `time_s`, `fstop`, `aim`, `aimView`) and the fields `filtration time_s stops lights residual`. `mode` defaults to `'normalised'` like `print.expose` (the request said `'real'`; a recipe-backed call takes the recipe's anyway). `logH`'s new path is "breaking" in `contract:check`: a DSL call without `logH` now uses the recipe's lights. Mock returns the new fields |
| core C2, C3 | Grade and magnification docs | accepted | Doc only (grade as a gamma about the aim grey; magnification ∝ 1/(m+1)², reference 8×). Versioning the calibration in the data pack stays CHB-004's |
| core C4 | Real enlarger mode as the default **(review)** | deferred (open); **decided in contract 0.4** (below) | The photographer has not decided. Default stays `'normalised'` in the catalog and `defaultRecipe`; the change is a one-line default plus `defaultRecipe` when decided (old recipes keep their mode: it is written into every frame) |
| core C5 | Density masks reach the print **(review)** | adapted | Not as an `Image` input of `print.expose` (a second image input to a pointwise op, which the GPU chain cannot take without a barrier). Instead `print.densityMask` takes the **main `print.expose`'s paper log H** (`paper-logH` → `scalar-field` d_m), recovers PD = x_clear − x (x_clear: that exposure's clear-film x; 0 without one), and `print.combine.densityMasks: Image[]` multiplies every exposure through the negative by 10^−Σd_m (flashes not). Recipe `print.densityMasks: Record<id, DensityMask>` (`set print.densityMasks.<id> null` deletes; the same pattern as retouch spots, so no new mutation op). New arg `polarity: 'positive' \| 'same'`; `kind: 'contrast' \| 'unsharp'` is stored for the UI but not passed (same maths, the radius differs); highlight masks with a threshold are deferred to CHB-010. Core, GPU (combine.wgsl modes 6, 9, 10) and mock implement it; two conformance semantic cases |
| core C6 | A flash goes through the film base | accepted | `print.combine.modes` gains `'flash-base'` and `'flash-open'`; compile maps a flash with `through: 'open'` to `'flash-open'`, otherwise `'flash-base'`. Engines evaluate the flash's `print.expose` uniformly: core's `flashExposure` (dye amounts 0, or the clear-film x); the GPU uses the same f64 values. Conformance law: an unmasked base flash adds the same H to every pixel. Existing recipes with flashes now print the flash uniformly (they printed it through the image, which was wrong) |
| core C7, C8 | `print.combine` normalised weighting; mask argument docs | accepted | Doc only |
| output R1 | CAM16-UCS knee **(review)** | accepted (option a) | Recipe version 2: `migrations[1]` does the 0.2 rename `'cam16-ucs'` → `'oklch'` for version-1 documents only (`renameLegacyValues` left the version-less path); `KneeMethod` gains `'cam16-ucs'` = CAM16-UCS proper (`KNEE_METHODS`). Core already implements it (`displaySetupAt`). **GPU keeps the OkLCh kernel with `W_PREVIEW_APPROX`**: a WGSL CAM16 (forward and inverse with the viewing-condition constants, plus the knee in J′a′b′) is a port of roughly 150 lines with its own parity work, not done here. D = 1 (output's review note) stands |
| output R2 | `output.encode` fields | accepted | `mime width height bits space iccSha256 recipeSha256`; the mock returns them |
| output R3 | Knee strength, Rec.2020 transfer | noted | No change |
| CHB-016 | `Diagnostic.where.file` | accepted | `where?: {line, col?, file?}` |
| CHB-022 §3.1, §6.1 | `view.frame {orientation, angle_deg, crop}` for both frame kinds **(review)** | adapted | Replaces `scan.orientation` / `scan.crop` (`output.frame.recipePath = 'view.frame'`). **The crop stays in sensor pixels of the un-oriented frame** (as `scan.crop` was, as dust spots and the rebate are), not a box on the oriented, rotated canvas as the guide proposed: one coordinate system for every stored box (DR-3), old crops keep their meaning, the roll kit's picked crop keeps working. The box's content is turned about its centre by `angle_deg` (−45…45, clockwise as shown, so mirrored orientations turn the other way in sensor space), then oriented; the output has the box size. Reference sampling: `straighten()` in `src/frame.ts` (bilinear, empty corners 0), used by the mock and the studio host (the engines that implement `output.frame`). Crop validity (corners inside the picture) needs the source size, so the contract does not check it: CHB-022's tool does. No group `set view.frame`: a gesture writes the three leaves in one `apply` (one undo unit). Old paths give `E_PATH` with `fix` naming the new one (`MOVED_PATHS`); `migrations[1]` and version-1 logs move them |
| CHB-022 §6.2, §7.1 | `retouch.spots.<id>`, null deletes; `retouch.heal` | accepted | `RetouchSpot {mode, x, y, r, src, feather, opacity, enabled}`; `FieldRule` custom `deletes: true` lets `set <entry> null` remove the key (missing key: no-op). Op `retouch.heal` (area `retouch`, owner CHB-022, `spots` = canonical JSON of the enabled spots, no recipe path); compile puts it after `view.adapt`, before `finishing.*`, and omits it without enabled spots. **Stub:** core and GPU pass the print through with `W_PREVIEW_APPROX`, the mock silently; CHB-022 implements the heal |
| CHB-019 | Studio host may import core/gpu | noted | Already in `tools/scripts/check-boundaries.ts` (`apps/studio/src/host/engines.ts` exception) |

What the next tickets can rely on:

- **CHB-020 (roll):** `scan.baseT` in every engine; `scan.flare` per channel in every engine (so the veil need not be
  subtracted at decode); `LoggedMutation.batch` with `approve/reject({batch})`; `FrameRecipe.roll`; the `Roll` type,
  `validateRoll`, `ROLL_SIDECAR`; the roll codes. `view.frame.crop` replaces `scan.crop` (the kit already reads it).
- **CHB-021 (looks):** `EditLog.preview([...])` for several paths at once; the shared vocabulary (`cut`, `accessorNode`).
- **CHB-022 (finish):** `view.frame` with `angle_deg` for both frame kinds and the reference `straighten()`;
  `retouch.spots.<id>` with null-delete; the `retouch.heal` node in compile (implement it in the engines; it is a
  pass-through now). Note that `frame.print()` (the `view.adapt` node) is before retouch and finishing.
- **CHB-010 / CHB-012:** flashes through the base or an empty gate; density masks from the recipe
  (`print.densityMasks`) applied by `print.combine`; `lightsToFiltration` with the recipe's print settings.
- **CHB-011:** `'cam16-ucs'` selectable; `output.encode` fields.

### Change notes (contract 0.3)

```text
CC-008  scan.density.baseT; recipe scan.baseT (CHB-020 R3)
class:     additive (optional arg; recipe field with a migration)
changes:   vec3 fraction [1e-6, 100], optional; wins over rebate in compile and engines
consumers: engines (mock, ref, gpu), roll kit (later)
migration: migrations[1] adds scan.baseT null
tests:     contract compile; conformance "scan.density semantics: baseT"

CC-009  scan.flare: number | Vec3 (CHB-020 R4, CHB-006 #2)
class:     additive (ArgSpec.perChannel), engine-visible formula change in the mock
changes:   T = T′(1 + f) − f per channel; core and gpu implement scan.flare (gpu OP.AFFINE)
consumers: DSL (number | Vec3), studio-kit controls (per-channel value shows its mean), engines
migration: none
tests:     contract set/compile; conformance "scan.flare semantics"

CC-010  EditLog.preview(Mutation[]); LoggedMutation.batch; approve/reject({batch}) (CHB-019 R1, CHB-020 R5)
class:     additive (the preview event gains `mutations`)
tests:     contract preview and batch tests

CC-011  view.frame {orientation, angle_deg, crop}; output.frame.angle_deg (CHB-022)
class:     breaking (recipe paths scan.orientation / scan.crop moved; output.frame arg paths changed)
changes:   output.frame.recipePath 'view.frame'; angle_deg deg [−45, 45] default 0; contract straighten()
consumers: mock, studio host (output.frame), roll kit (view.frame.crop), DSL/UI (generated)
migration: migrations[1]; EditLog version 1 → 2 moves logged set paths; E_PATH fix names the new path
tests:     contract migration, moved-path hint, both kinds; studio host vs mock with an angle

CC-012  retouch.spots.* (null deletes); op retouch.heal (CHB-022)
class:     additive (new area 'retouch')
consumers: engines (stub pass-through), CHB-022
migration: migrations[1] adds retouch {spots: {}}
tests:     contract null-delete, compile order

CC-013  print.combine modes flash-base / flash-open; print.combine.densityMasks;
        print.densityMask paper-logH → scalar-field + polarity; recipe print.densityMasks.* (CHB-010 C5, C6)
class:     breaking (print.densityMask domains)
consumers: engines (mock, ref, gpu: combine.wgsl modes 6 8 9 10), compile
migration: migrations[1] adds print.densityMasks {}
tests:     contract compile; conformance flash and density-mask semantic cases; core chb010 test

CC-014  darkroom.lightsToFiltration: recipe-backed print settings, five fields (CHB-010 C1)
class:     breaking in contract:check (logH gains a path), additive otherwise

CC-015  output.display.knee / view.output.export.knee.method 'cam16-ucs' (CHB-011 R1); output.encode fields (R2)
class:     additive; recipe version 2 (migrations[1] renames version-1 'cam16-ucs' to 'oklch')
consumers: core (CAM16-UCS), gpu (W_PREVIEW_APPROX, oklch kernel), mock (ignores the knee)

CC-016  RECIPE_VERSION 2; EditLogData.version 2; roll; Roll record; vocab; Diagnostic.where.file; ten W_ codes
class:     additive (version bump with migrations)
```

## Contract 0.4 (CHB-031: the real enlarger by default)

`CONTRACT_VERSION = '0.4.0'`; recipe and EditLog versions unchanged. The 0.3.0 catalog is kept as
`baselines/catalog-0.3.0.json`. `pnpm contract:check`: 2 changes, both "breaking" by its rule (a recipe-backed
default), allowed under 0.x; no migration is needed (see the note).

| Request | Item | Status | Notes |
|---|---|---|---|
| core C4, CHB-031 F17 | Real enlarger mode as the default | accepted | Owner decision 2026-11-12 (CHB-031 diary step 1), after the cosplay session 02 found Time and Aperture inert in the default `'normalised'` mode. `print.expose.mode`, `darkroom.lightsToFiltration.mode` and `defaultRecipe`'s `print.enlarger.mode` default to `'real'`. Normalised stays an option: a studio layout (simple, tiny) makes its new recipes normalised (`VariantDef.enlarger`, studio-kit), and there the UI hides time, aperture and magnification. At the calibration (neutral pack, 10 s, f/8, 8×) both modes print the same, so a default recipe prints exactly as before |

```text
CC-017  print.expose.mode, darkroom.lightsToFiltration.mode, defaultRecipe print.enlarger.mode: 'normalised' → 'real' (CHB-031)
class:     breaking in contract:check (a recipe-backed default); no stored recipe changes
changes:   ArgSpec default only; docs of print.expose.mode say what normalised ignores
consumers: defaultRecipe users (studio new frames, DSL/agent fixtures, roll kit), DSL op defaults (generated), studio-kit
           (layout option VariantDef.enlarger, normalised-mode UI)
migration: none: every recipe and EditLog stores print.enlarger.mode explicitly, so saved work keeps its mode; a
           default recipe prints identically in both modes (10 s, f/8, magnification null = the calibration optics)
tests:     contract hashcons law (explicit default), core engine-ref 0.2 filtration case (explicit 'normalised'),
           DSL representative trace (node id), apps/studio enlarger-mode, studio-kit enlarger-mode
```

## Contract 1.0 (CHB-037: one editing model, document format 3)

`CONTRACT_VERSION = '1.0.0'`. The design is CHB-035 design 01 v2 ("One editing model", Part IV); the owner's decision
of 2026-11-14 is a hard cut-off: no backwards compatibility, no migration, no wrapper. The 0.4.0 catalogue is kept as
`baselines/catalog-0.4.0.json`. `pnpm contract:check`: 105 changes, 75 breaking (allowed: a major bump).

| Request | Item | Status | Notes |
|---|---|---|---|
| design §20, D1 | Document format 3 (`document.ts`): stages (scan, scene, film, darkroom, print) of a medium and a stack of layers, groups and link entries; masks, probes, geometry, output | accepted | Every list is a values `Coll`; ids are unique in the document, so an entry is addressed by its id wherever it sits. The recipe (version 2), `RECIPE_FIELDS`, `MOVED_PATHS`, the migrations, `defaultRecipe` are deleted; `validateDocument` refuses a recipe with a clear message |
| design §21, §23 | Media hold today's fixed settings; every edit is a layer | accepted | Never-compiled fields are gone (`capture.adapt`, `capture.autoExposure`, `finishing.*`, `scan.dust.method/marginPx`, `roll`). `print.grade` stays in the darkroom medium: it is a gamma in `print.develop`, not light |
| design §22, D2 | Stage laws (`defineLaw`): light, composite, repair | accepted | Amount: light scales [0, 16], composite and repair are opacity [0, 1]. Composite: normal blend only (the W3C set is phase 8); an isolated group blends its children's result, so isolated normal equals pass |
| design §22, §29 | One light-law node: `print.combine` with structured terms, densities, filters, preflash, each with amount and mask | accepted | `print.lights` and `print.preflash` are removed: the printer lights are a `filter` layer, preflash a `preflash` layer. `lightH` (`pixel.ts`) is the per-pixel formula engines share |
| design §23, plan P2a | `print.preflash` checked against "added light" | adapted | It is added light (x' = log10(10^x + φ), uniform), so it is a layer, but it is added after the printer lights (φ is a fraction of the grey card's exposure), so the law has a term outside T_all |
| design §23 | Darkroom layer ops `expose`, `burn`, `dodge`, `flash`, `preflash`, `densityMask`, `filter` (returns `Term`) | accepted | `split` is a burn with its own filtration (they compiled identically). A burn, dodge or flash gives exactly one of `time_s` and `stops` |
| design §23 | `heal`, `clone` with structured spot lists, coalescing | accepted | Layer and node ops in scan and print; spots apply in order, each reading the image as the spots before it left it (today's `retouch.heal` read every source before retouching: the same pixels unless a source overlaps an earlier target); `scan.heal`, `retouch.heal` deleted |
| design §8, §23 | `clarity` in mm on the print | accepted | `radius_mm`, converted with `ImageInfo.umPerPx.paper`; `finishing.clarity` and `finishing.hue` deleted |
| design §25, D4 | One mask algebra; geometry in document pixels; feather in mm | accepted | Components linear, ellipse, paint, luminance (`mask.gradient` → `mask.linear`; `mask.not` → `mask.invert`; new `mask.constant`, `mask.combine`); `mask.and`/`mask.or` (min/max) deleted. `mask.paint` takes structured strokes |
| P0 amendment | Explicit pitches | accepted | `source.open` takes `umPerPx` (the scan medium's, or a camera file's film long edge over its long side) and sets `ImageInfo.umPerPx.film`; `print.expose` sets `umPerPx.paper = film × magnification`; `magnification` is always a number (8 = the calibration) |
| design §27, §28 | Link and binding registries; the upstream-only rule | accepted | Roll links (media and stacks, with overrides) resolve in compile; look and preset resolvers register in phase 7. Bindings read only cuts computed before their value is used; the pitch fields cannot be bound |
| design §29 | `compile(doc)` with named cuts | accepted | `source`, `scan`, `scene`, `film`, `negative`, `darkroom.main`, `darkroom.H`, `print`, `finished`, `display`; `vocab.ts` (accessors, `PRINT_OPTIONS`) deleted |
| design §24, P1 amendment | The four mutations of values with the contract's hooks | accepted | `DOCUMENT_RULES` (per mutation: what it touched; per transaction: the whole document, exactly one main, mask references); the five special mutations deleted |
| design §26, plan P4 | One history | accepted | `EditLog` (`editlog.ts`) deleted: a frame's history is an entry of the values document log (`Log`, `@chromobench/values`), opened with kind `'frame'` under `LOG_RULES = { frame: DOCUMENT_RULES }`; undo, proposals with staleness (E_STALE), batches, `why`, drafts and serialisation are the log's. `AgentMode` moves to `eval.ts`; `EvalResult.transactions` holds log entries; `edit()` stays |
| P1 amendment | One error class | accepted | `ChromobenchError` extends values' `ValueError`; `E_RECIPE` → `E_DOCUMENT`; new `E_LINK`, `E_BINDING`, `E_CUT`; `bindArgs` refuses non-JSON (non-finite) values |

```text
CC-019  contract 1.0: document format 3, stage laws, one light-law node, one mask algebra, one compiler with cuts (CHB-037)
class:     breaking (major): CONTRACT_VERSION 1.0.0; recipes and edit logs of versions 1 and 2 are refused
changes:   recipe.ts, paths.ts, mutations.ts, vocab.ts, editlog.ts (P4: the values document log) deleted; LOG_RULES added; document.ts, stage-laws.ts, compile.ts, validate.ts,
           schema.ts, links.ts, bindings.ts, builders.ts, pixel.ts added. Ops removed: print.lights, print.preflash,
           scan.heal, retouch.heal, finishing.clarity, finishing.hue, mask.gradient, mask.and, mask.or, mask.not. Ops added:
           expose, burn, dodge, flash, preflash, densityMask, filter (darkroom terms), heal, clone, clarity, composite.mix,
           mask.linear, mask.constant, mask.combine, mask.invert. Changed: print.combine (structured terms, densities,
           filters, preflash), print.densityMask (amount → gamma), print.expose (magnification always given; no recipe
           paths), source.open (umPerPx), mask.paint (structured strokes), mask.feather (range), output.encode field
           recipeSha256 → documentSha256. ArgSpec: `path` removed, `list` (with `of`) and `polyline` added, Image[]/Mask[]
           and curve removed. OpDef: `recipePath` removed, `stages`, `encoding`, `term`, `coalesce`, `identity` added.
           Units: mm. Areas: finishing removed, composite added. Error codes: E_RECIPE removed; E_DOCUMENT, E_LINK,
           E_BINDING, E_CUT added
consumers: core (every new or changed op, golden parity: P2b), engine-mock (pass-throughs: P2b), conformance (P2b),
           gpu (print.combine with modulators, composite.mix, heal/clone, mask.combine: P3), shell/studio-kit/studio
           (document, stack kit: P4, P5b), dsl and agent (transaction builders, cuts: P6), looks and roll kits (links: P7)
migration: none (Decision D8): stored studio state is cleared once; frames reopen from their sources
tests:     packages/contract/test: light law = combinePixel (property, n = 300), order-free, composite identities,
           coalescing, mask algebra laws, validation errors, compile identities, cuts, links (bake), bindings (upstream)

CC-021  links: look functions, presets, linked media helpers, bake of a whole link (CHB-037 P7; contract 1.2.0;
        numbered CC-020 on its branch, renumbered at the merge because P8a's CC-020 landed first)
class:     additive (minor), except bakeLink's signature (breaking for its one caller, the contract's tests)
changes:   links.ts: defineLook / getLook / allLooks / lookParams / lookSkip (registered, versioned, pure look functions
           (params, { kind, facts, doc, size }) → { stacks per stage, masks }); the look and preset resolvers; Preset
           (format chromobench.preset version 3: stacks and masks), validatePreset, makePreset, lookAsPreset;
           LinkContext gains presets and size (compile passes the source size from the graph: linkContext());
           a link entry's expansion brings the look's masks with ids `<linkId>--<maskId>`; insertLink (one entry per
           stage, ids `<key>-<stage>`, source.link = key), linksOf, linkSiblings, keyOf, setLinkAmount (clamped per law),
           setLinkParams, removeLink; bakeLink(doc, key, ctx) → Mutation[] (every stage of the key, masks inserted;
           was (doc, id, stage) → Mutation); linked media: storedPath / storedMutations (a set of a medium field on a
           linked medium is an override), readField (reads through the link), linkMedium, unlinkMedium, divergence,
           followLink; resolveMedium(doc, stage, ctx) (was (stage, medium, ctx)). links-looks.ts: the built-in looks
           (balance, neutral, warm-print, cool-print, print-density, soft-contrast, more-contrast, edge-burn,
           crisp-print, crisp-warm), registered on import.
consumers: studio-kit looks and roll kits, the studio's reads and writes of linked media (model/doc.ts), the render
           bridge and every compile site that may see a roll or preset link (LinkContext), dsl (named looks)
migration: none
tests:     packages/contract/test/links-looks.test.ts (expansion at the law's amount, amount 0 = no look, params,
           two stages one key, a look reading the document, masks and size, kinds, bake = same graph, presets,
           look as preset = same graph, linked media: overrides, divergence, follow, reads and writes, unlink)
```

```text
CC-022  the eval surface says "show" for an image; the workbench's codes (CHB-037 P6b; contract 1.3.0)
class:     breaking for the eval's consumers (dsl, agent, the chat kit: all changed together; hard cut-off), additive otherwise
changes:   eval.ts: Look → Show, EvalResult.looks → EvalResult.shows, EVAL_LIMITS.looks → EVAL_LIMITS.shows ("look" now
           means only a named look, a link); warning LOOKS → SHOWS; new codes E_WORKBENCH (no workbench in the session,
           an unknown command or selector, a command that failed) and E_LAYOUT (an agent-written layout that cannot be
           built: a lambda where a selector, a path or a command id belongs, an unknown builder, a build error)
consumers: dsl (session, results), agent (worker, chat session, bridge page client: the Go hub's wire field stays
           `looks`), studio-kit chat kit (ChatShow)
migration: none
tests:     packages/dsl/test/results.test.ts (SHOWS), packages/dsl/test/workbench.test.ts (E_WORKBENCH, E_LAYOUT)
```

## Contract 1.1 (CHB-037 P8a: Editor lab's tools in the engine)

`CONTRACT_VERSION = '1.1.0'`. Design: CHB-035 design 01 v2 Part I §3–§8, §22 (encodings), §23 (the op table); plan
"P8a". Editor lab's digital tools are re-defined in linear light and OkLab (its sRGB arithmetic and its parametric
curve are not imported, design §13).

| Request | Item | Status | Notes |
|---|---|---|---|
| design §23 | The composite op set: `exposure`, `curve`, `levels`, `hsl`, `vibrance`, `grade`, `mixer`, `vignette` (scene and print), `sharpen` (print) | accepted | Each with ArgSpecs in the catalogue's units, an `encoding`, an `identity`; core (`composite/*.ts`) is the f64 definition, the GPU mirrors it; a conformance case each (identity at identity params, closed forms) |
| design §22 | Encodings | accepted | The working encodings are domains: `scene-rgb`/`print-rgb` (linear Rec. 2020, D65, white = 1) and `scene-oklab`/`print-oklab` (OkLab over it); one node op `composite.encode { to, white }` converts within a stage. The compiler converts each layer's input to its op's encoding, folds a conversion of a conversion into one from the original, and returns the stack to the stage's XYZ. An op's encoding may follow an argument (`EncodingSpec`): `curve` and `levels` act on L in OkLab, or on the cube root of an RGB channel in linear RGB. `clarity` is `stage` (it computes on XYZ) |
| design §4–§6, §22 | The W3C blend modes, isolated groups | accepted | 16 modes (kebab case, British spelling: `colour-dodge`, `colour-burn`, `colour`). An entry mixes in its result's encoding; separable modes act per channel in linear RGB, hue/saturation/colour/luminosity in OkLCh (luminance defined once, no ClipColor). A blend on a stage-encoded result mixes in linear RGB. Isolated groups keep contract 1.0's meaning (children on the backdrop, the result blended as one layer) |
| design §7, §25 | Mask components `radial` and `colour` | accepted | `mask.radial` (an ellipse with its own soft edge, pointwise); `mask.colour` (OkLab ΔE, tolerance, softness) on the cut it reads encoded to OkLab: a cut without colour (the negative, H) is E_CUT at compile |
| design §21 | The scene stage for camera files | accepted | It compiled already; its masks now read the new cut `scene.input` (the white-balanced scene, before the stack); cut orders renumbered (0–9) |
| design §33 (P5b-2) | UI fields | accepted | `OpDef.ui = { label, menu, order }` on every layer op and mask component op (`LAYER_MENUS`: light, retouch, tone, colour, detail, effect, mask); `UiHints.advanced` marks secondary controls |

```text
CC-020  the composite op set, blend modes, working encodings, colour and radial masks, scene.input (CHB-037 P8a)
class:     additive (minor), with one changed meaning: a scene-stage mask with reads 'stage-input' measures scene.input
           (the white-balanced scene XYZ) instead of source (camera-linear)
changes:   domains scene-rgb, scene-oklab, print-rgb, print-oklab; encodings.ts; ops exposure, curve, levels, hsl,
           vibrance, grade, mixer, vignette, sharpen, composite.encode, mask.radial, mask.colour; composite.mix takes the
           working domains and BLEND_MODES (16); MASK_COMPONENT_KINDS + radial, colour; cut scene.input; OpDef.encoding
           may be { arg, values }, OpDef.ui; UiHints.advanced; clarity's encoding stage; LawContext.encode/encodingOf
consumers: DSL (generated: the new layer ops), UI (P5b-2: ui fields, the "+ Layer" menu), engines (core and gpu: every
           new op; engine-mock: none, reported as not implemented)
migration: none
tests:     contract composite-law.test.ts; core composite.test.ts (laws: identities, blend identities, curve
           monotonicity, encode round trips); conformance semantics for every new op; six golden stacks; GPU parity
           (packages/gpu/test/browser/digital.spec.ts)
```

## Contract 1.4 (CHB-039: the mask overlay)

`CONTRACT_VERSION = '1.4.0'`. The studio shows the selected entry's mask over the picture (a tint, or the mask
alone). The overlay must be the mask as the engine applies it, in the picture's geometry, so the contract names the
coverage an entry acts through and lets the document geometry act on a mask.

| Request | Item | Status | Notes |
|---|---|---|---|
| CHB-039 spec §4 | `Compiled.coverage(entry)` | accepted | The entry's mask times its groups' masks (outermost first, `mask.combine` intersect, amount 1: the light law's `maskProduct`, so the same nodes); a group's own mask times its parents'; null without a mask; a disabled entry's mask compiles too. Composite stages apply a group's mask at the group's mix: the product is the effective coverage there, a node of its own |
| CHB-039 spec §4 | `output.frame` on a mask | accepted | domainIn `display-rgb` or `mask`, domainOut `same`: crop, straighten and orientation on one channel. All three engines' implementations were channel-generic already |

```text
CC-023  Compiled.coverage; output.frame takes a mask (CHB-039; contract 1.4.0)
class:     additive (minor). contract:check reports output.frame.domainOut "display-rgb" → "same" as breaking: for
           its only former input (display-rgb) the output is unchanged
changes:   Compiled.coverage(entry: Id): Node | null; output.frame domainIn ['display-rgb', 'mask'], domainOut 'same'
consumers: studio-kit (frame.mask(entry) handles, the render bridge, the stack kit's overlay); DSL (generated: a
           MaskHandle gains output.frame)
migration: none
tests:     packages/contract/test/coverage.test.ts; studio-kit test/overlay.test.ts; e2e/mask-overlay.spec.ts (GPU)
```

## Contract 1.5 (CHB-045: the grid rule, the floors, the contrast blend modes)

`CONTRACT_VERSION = '1.5.0'`. Phase 1's GPU correctness work put three formulas the engines share into the contract
(`pixel.ts`), and decision D7 changed what the contrast blend modes mean.

| Request | Item | Status | Notes |
|---|---|---|---|
| CHB-045 GPUC-2, CHB-043 ch. 3 | The grid rule `gridSample`, `gridAxis`, `gridCheck`, `GRID_LIMIT` | accepted | Output pixel p of an n-pixel grid over (x, w) reads image pixel x + ⌊(2p + 1)·w / 2n⌋ in integers; every engine calls it (the GPU in u32, `kernels/grid.wgsl`); grids with n·w ≥ 2³¹ are refused (E_ARG_RANGE) |
| CHB-045 GPUC-3 | `MASK_T_FLOOR` (1e-8) | accepted | print.densityMask takes log10 max(H_m, MASK_T_FLOOR): an underflowed exposure has no log. Unchanged above the floor |
| D7 (CHB-044), CHB-037 P10-23 | Contrast blend modes in the display encoding; four new modes | accepted | `CONTRAST_BLENDS` = overlay, hard-light, soft-light, vivid-light, linear-light, pin-light, hard-mix: B is evaluated on the channels encoded by the sRGB curve (`displayEncode`, odd below 0) and decoded (`blendSeparable`), so they switch at display mid-grey (linear 0.214) as in Photoshop; the other separable modes stay in linear light; the amount still mixes in the entry's encoding. `BLEND_MODES` gains vivid-light, linear-light, pin-light, hard-mix (after soft-light: 20 modes). `blendChannel` (the channel formulas) moved from core to the contract so core and the mock share it |

```text
CC-024  grid rule, MASK_T_FLOOR, contrast blend modes in the display encoding, four blend modes (CHB-045; contract 1.5.0)
class:     additive (minor), with one changed meaning: overlay, hard-light and soft-light are evaluated in the display
           encoding (D7); documents using them render differently (by decision; goldens regenerated deliberately)
changes:   pixel.ts gridSample, gridAxis, gridCheck, GRID_LIMIT, MASK_T_FLOOR, displayEncode, displayDecode,
           blendChannel, blendSeparable, isContrastBlend; document.ts CONTRAST_BLENDS; BLEND_MODES + vivid-light,
           linear-light, pin-light, hard-mix (indices of difference … luminosity shift by 4)
consumers: engines (core: grid, floors, blendPixel; gpu: kernels/grid.wgsl, combine.wgsl, working.wgsl with generated
           blend codes; mock: grid, blends); UI (the blend menu lists the new modes from the contract); DSL (generated)
migration: none (hard cut-off)
tests:     contract grid-rule.test.ts, composite-law.test.ts; core composite.test.ts (D7 laws: a source at display
           mid-grey leaves the backdrop unchanged in every contrast mode but hard mix), density-mask-floor.test.ts;
           GPU law:grid, law:density-floor, law:blend (20 modes)
```

## Contract 1.6 (CHB-048: before the film)

`CONTRACT_VERSION = '1.6.0'`. Phase 2's "before the film" work: the white balance of a camera file defined once in the
contract (decision D2), the OkLCh blend modes kept in the gamut (LAY-2), and film stocks, papers and grades as medium
presets (D6).

| Request | Item | Status | Notes |
|---|---|---|---|
| D2 (CHB-044), CHB-037 P9-12 | White balance before the film (`white-balance.ts`) | accepted | The scene medium's `whiteBalance` is the white of the light the scene was lit by: `{ temperature_K, tint }` in Lightroom's units (Robertson's isotemperature lines in CIE 1960 uv, the tint the offset along the line × −3000, as Adobe's DNG SDK; `temperatureToWhite` and its closed-form inverse `whiteToTemperature`, exact to 1e-13). `source.xyz` applies, after the camera matrix, the CAT16 adaptation (complete, in XYZ) from that white to D65; capture.expose then adapts D65 to the film's reference white with the same CAT16 (`cat16`, moved from core), so the two compose. A camera file opens with its raw's as-shot white (`asShotWhiteBalance`); `NO_CORRECTION` is D65 itself (the light as it was, as a daylight film sees it). `mode` (daylight / as-shot / custom) is gone: as-shot and none are values now, and every stored golden is reproduced bit for bit (max \|Δ\| = 0) with the translated values. `pickedWhiteBalance` is the eyedropper's rule; `WHITE_BALANCE_PRESETS` are Lightroom's presets for raw files |
| CHB-037 P10-9 (LAY-2) | W3C ClipColor for the OkLCh blend modes | accepted | `blendOkLch` (the four modes' formulas, moved from core) and `clipColour`: a result whose linear RGB leaves [0, `gamutTop`] (the brighter of white and the inputs' brightest channel: W3C's cube for inputs in [0, 1], room for a scene-linear highlight) keeps its OkLab L and hue and takes the chroma factor of the first exit from grey (`CLIP_MARCH` = 32 steps out, then `CLIP_STEPS` = 24 halvings; the GPU runs the same): along a ray of constant L and hue the gamut need not be one interval (deep blues). A channel within `CLIP_EPS` (1e-6 of the top) of the gamut counts as inside, so f32 noise on an edge colour cannot send it through the search in one engine only. A result in the gamut is unchanged bit for bit. The display knee's chroma search (core `maxChromaOf`, the GPU's `okMaxChroma`) had the same flaw and now also returns the first exit (`CHROMA_MARCH` = 64): it jumped between two exits for print colours 1e-5 apart (0.037 in blue); no golden changed |
| D6 (CHB-044), CHB-021 t:xw53 (LOOK-6) | Medium presets (`media-presets.ts`) | accepted | Film stocks, papers and paper grades are presets of the film and darkroom media, built from the data pack's stocks (`StockFacts`: id, name, role, type, use, print stock): `filmPresets` (negative films; a pushed profile `<stock>_push<n>` is `{ stock: base, push: n }`; slide films are not offered), `paperPresets` (papers, then cinema print films), `GRADE_PRESETS` (grades 0 … 5 in halves). A preset is a set of medium fields (`presetSets`), recognised by `presetOf`; not a link, not a look |

```text
CC-025  stages.scene.medium.whiteBalance, source.xyz: the white of the light as temperature and tint, CAT16 to D65 (CHB-048; contract 1.6.0)
class:     breaking (major for documents: whiteBalance.mode is removed; hard cut-off, no migration)
changes:   white-balance.ts (D65_XYZ, CAT16_M, SRGB_TO_XYZ_M, cat16, xyToXYZ, xyOf, temperatureToWhite, whiteToTemperature,
           whiteBalanceOf, NO_CORRECTION, whiteOf, cameraToXyz, asShotWhite, asShotWhiteBalance, whiteBalanceMatrix,
           sceneMatrix, pickedWhiteBalance, WHITE_BALANCE_PRESETS, sameWhiteBalance, TEMPERATURE_RANGE 2000…50000 K,
           TINT_RANGE ±150); SceneMedium.whiteBalance: WhiteBalance; NewDocumentOptions.whiteBalance; source.xyz args
           temperature_K, tint (defaults NO_CORRECTION; mode removed)
consumers: engines (core sceneMatrixAt calls sceneMatrix, core's camera.ts and cat16Matrix deleted; gpu binds core's
           matrix; mock applies whiteBalanceMatrix after its sRGB camera); studio (defaultDocument takes the raw's as-shot
           white; the white balance panel); DSL (generated)
migration: none (hard cut-off); the golden documents were re-translated (tools/goldens/translate.ts), pictures unchanged
tests:     contract white-balance.test.ts (round trip, Lightroom anchors, identity at as shot and none, composition,
           eyedropper); core white-balance.test.ts (a white-balanced tungsten grey is the daylight grey through the film);
           mock white-balance.test.ts; GPU film.spec.ts (a changed white balance against core); golden cam-wb-tungsten
```

```text
CC-026  composite.mix hue, saturation, colour, luminosity: ClipColor in OkLCh (CHB-048 LAY-2; contract 1.6.0)
class:     changed meaning (minor): out-of-gamut results of the four modes are brought into the gamut
changes:   pixel.ts blendOkLch, clipColour, gamutTop, CLIP_MARCH, CLIP_STEPS, CLIP_EPS; core blendOklab deleted (blendPixel calls
           the contract); core maxChromaOf and the GPU's okMaxChroma return the first exit (CHROMA_MARCH)
consumers: engines (core blendPixel; gpu working.wgsl wkClipColour, CLIP_STEPS generated into blend-codes; mock blend)
migration: none
tests:     contract clip-colour.test.ts (in-gamut unchanged, in gamut after, L and hue kept, maximal chroma, idempotent);
           core composite.test.ts; conformance semantics (luminosity, colour: chroma never raised, hue kept); GPU
           law:blend, law:digital-doc; core knee-first-exit.test.ts; golden stack-print-blends re-rendered
```

```text
CC-027  medium presets: film stocks, papers, grades from the data pack (CHB-048 LOOK-6, D6; contract 1.6.0)
class:     additive (minor)
changes:   media-presets.ts StockFacts, PresetKind, PRESET_KINDS, PRESET_STAGE, MediumPreset, filmPresets, paperPresets,
           GRADE_PRESETS, mediumPresets, presetSets, presetOf
consumers: studio (the host registers the pack's stocks; the stock selects of cb.arg and cb.preset are pickers;
           medium.preset, medium.presets commands); tools/goldens stacks.ts
migration: none
tests:     core media-presets.test.ts (the pack's lists, names, push mapping); golden cam-film-portra-800-push1; e2e
```

## Change-note template

```text
CC-NNN  <op or path>: <one-line change> (<ticket>)
class:     additive (minor) | breaking (major)
changes:   <ArgSpec / recipe path / type changes>
consumers: DSL (generated), UI (generated control), engines (…; mock: …)
migration: none | migrations[n] …
tests:     conformance cases regenerate; laws added/changed
```
