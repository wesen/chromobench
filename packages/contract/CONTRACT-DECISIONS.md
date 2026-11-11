# Contract v0 decisions

`@chromobench/contract` v0 (`CONTRACT_VERSION = '0.1.0'`). The following file records every "Proposed contract additions" item from the intern guides of CHB-002 to CHB-015. CHB-013 proposed none. Each item has one of three statuses:

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

## Change-note template

```text
CC-NNN  <op or path>: <one-line change> (<ticket>)
class:     additive (minor) | breaking (major)
changes:   <ArgSpec / recipe path / type changes>
consumers: DSL (generated), UI (generated control), engines (…; mock: …)
migration: none | migrations[n] …
tests:     conformance cases regenerate; laws added/changed
```
