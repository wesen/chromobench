# Contract decisions

`@chromobench/contract` v0 (`CONTRACT_VERSION = '0.1.0'`); contract 0.2 (`'0.2.0'`, CHB-017) is the last section before the template. The following file records every "Proposed contract additions" item from the intern guides of CHB-002 to CHB-015. CHB-013 proposed none. Each item has one of three statuses:

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

## Change-note template

```text
CC-NNN  <op or path>: <one-line change> (<ticket>)
class:     additive (minor) | breaking (major)
changes:   <ArgSpec / recipe path / type changes>
consumers: DSL (generated), UI (generated control), engines (…; mock: …)
migration: none | migrations[n] …
tests:     conformance cases regenerate; laws added/changed
```
