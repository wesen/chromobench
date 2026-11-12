# Contract requests from CHB-006 (ingest)

> **Status (CHB-017, contract 0.2.0):** decided. Applied, adapted, deferred or noted item by item in
> `packages/contract/CONTRACT-DECISIONS.md`, section "Contract 0.2". Kept here as the record of the request.

Contract v0 covers everything ingest needed (`SourceRef`, `DecodeOptions`, `SourceInfo`, `CameraColour`, `ScannerForward`, the `E_FORMAT` and `W_*` codes, `scan-classes`, `scalar-field`). The requests below are small. Ingest works around each one locally until they are applied.

## 1. An informational decoder note code

**What:** a warning-class code for decoder facts that are not assumptions, such as "LibRaw scan mode: black and white applied per photosite", "alpha channel dropped" or "BlackLevelDeltaH ignored".

**Why:** ingest uses `W_ENCODING_ASSUMED` for these notes today, which misleads a reader of `SourceInfo.notes`. The list of codes is closed, so ingest cannot add one itself.

**Workaround now:** the notes carry `W_ENCODING_ASSUMED`, and their message says what happened.

```diff
--- a/packages/contract/src/errors.ts
+++ b/packages/contract/src/errors.ts
@@
   W_ENCODING_ASSUMED: 'Source encoding was assumed.',
+  W_DECODE_NOTE: 'A fact about how the source was decoded (mode, levels applied, channel dropped); informational.',
   W_ICC_IGNORED: 'An embedded ICC profile was ignored.',
```

## 2. (Reminder, already deferred) per-channel flare

**Contract 0.3 (CHB-024):** applied. `scan.flare` is `number | Vec3` (`ArgSpec.perChannel`), T = T′(1 + f) − f per channel in the mock, core and GPU engines.

`fitFlare` returns a per-channel `f` (`Vec3`), and `region()` accepts `number | Vec3`. The recipe keeps a single percent (`scan.flare`). CONTRACT-DECISIONS lists the widening as deferred. Decide it before CHB-013 calibrates flare. No change is requested now.

## 3. A note for compile/engines, not a type change

The footprint grid of the area resampler depends on the orientation at non-integer reduction factors (`RegionOptions.orientation` in `packages/ingest/src/conditioning/resample.ts`). The Gold 200 σ and class goldens at the 640-pixel size need the grid anchored the way Chromogen anchored it in the oriented image. An engine that uses ingest for statistics should pass `FrameRecipe.scan.orientation` there, even though boxes are stored in sensor coordinates.
