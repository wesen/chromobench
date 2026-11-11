# Contract requests from CHB-011 (`@chromobench/output`)

Against contract 0.2.0. Nothing here blocks merging: each item has a local workaround, named below.

## R1. The CAM16-UCS knee as a new `KneeMethod` value (asked for by CHB-017, core R5)

**Need.** Core now implements CAM16-UCS (Li et al. 2017) with spektrafilm's viewing conditions
(`packages/core/src/print/gamut.ts`: `cam16`, `perceptual('cam16-ucs', space)`, `compressOutput` with
`algorithm: 'cam16-ucs'`), checked against colour-science 0.4.6 to 1e-9. The catalog cannot select it:
`output.display.knee` and `view.output.export.knee.method` allow `'oklch' | 'tanh-shoulder' | 'clip'`.

**The name collides with the 0.2 migration.** `renameLegacyValues` (paths.ts) and the `EditLog`
constructor rewrite every `'cam16-ucs'` to `'oklch'`, without looking at a version: a new recipe or
log that selects CAM16-UCS under its own name would silently become OkLCh. Two ways out:

- **(a, recommended)** Recipe version 2. `migrations[1]` does the rename for version-1 recipes (and
  `EditLogData.version: 2`, with the entry rewrite only for version-1 logs); `renameLegacyValues` is
  removed from the version-less path. Then add `'cam16-ucs'`.
- **(b, cheap)** Add the value under spektrafilm's own spelling, `'cam16ucs'`, and leave the
  migration alone. Two names that differ by a hyphen is the price.

**Proposed diff for (b)** (for (a), the same value lists with `'cam16-ucs'`, plus the migration):

```diff
--- packages/contract/src/recipe.ts
-export type KneeMethod = 'oklch' | 'tanh-shoulder' | 'clip';
+export type KneeMethod = 'oklch' | 'cam16ucs' | 'tanh-shoulder' | 'clip';
-  'view.output.export.knee.method': spec({ type: 'enum', values: ['oklch', 'tanh-shoulder', 'clip'], doc: 'export knee' }),
+  'view.output.export.knee.method': spec({ type: 'enum', values: ['oklch', 'cam16ucs', 'tanh-shoulder', 'clip'], doc: 'export knee' }),
--- packages/contract/src/catalog/view-output-mask.ts (output.display)
-      knee: { type: 'enum', values: ['oklch', 'tanh-shoulder', 'clip'], default: 'oklch', ...
+      knee: { type: 'enum', values: ['oklch', 'cam16ucs', 'tanh-shoulder', 'clip'], default: 'oklch', ...
+        doc: "Gamut compression; always the last colour step. 'oklch': OkLCh chroma knee (spektrafilm's parameters); 'cam16ucs': the same in CAM16-UCS (L_A 64, Y_b 20, average surround, D = 1); 'tanh-shoulder': Chromogen's per-channel shoulder (kept for comparison; it cannot keep paper white at display white); 'clip': per channel." },
```

**Workaround.** Core's `displaySetupAt` maps `'cam16-ucs'` and `'cam16ucs'` to the CAM16-UCS knee; the
binder refuses both until the change, so only direct calls (`displaySetup({knee: 'cam16-ucs'})`) reach
it. The GPU engine lowers it to the OkLCh kernel with `W_PREVIEW_APPROX` (no CAM16 WGSL yet).

**One deliberate difference from spektrafilm** (review): D = 1 (illuminant discounted). With
spektrafilm's D(L_A = 64) = 0.912 the output white sits at a′, b′ = (−1.33, −0.76) off the neutral axis,
the chroma knee (never the identity at t = 0) then tints whites and greys, and scan-of-print cannot keep
paper white at display white.

## R2. `output.encode` value fields: the guide's `EncodedFile`

**Need.** The export runner returns more than the four fields the catalog declares
(`format, name, bytes, sha256`): CHB-019's export UI and the agent need the pixel size, bit depth, space
and the hashes that tie the file to its profile and recipe.

```diff
--- packages/contract/src/catalog/view-output-mask.ts (output.encode)
     fields: [
       { name: 'format', type: 'string', doc: 'file format' },
       { name: 'name', type: 'string', doc: 'file name in OPFS' },
       { name: 'bytes', type: 'number', unit: 'none', doc: 'file size' },
       { name: 'sha256', type: 'string', doc: 'content hash' },
+      { name: 'mime', type: 'string', doc: 'image/png or image/tiff' },
+      { name: 'width', type: 'number', unit: 'px', doc: 'pixel width' },
+      { name: 'height', type: 'number', unit: 'px', doc: 'pixel height' },
+      { name: 'bits', type: 'number', unit: 'none', doc: '8 or 16' },
+      { name: 'space', type: 'string', doc: 'output space id' },
+      { name: 'iccSha256', type: 'string', doc: 'sha256 of the embedded profile (empty when none)' },
+      { name: 'recipeSha256', type: 'string', doc: 'sha256 of the canonical recipe (empty when not given)' },
     ],
```

**Workaround.** `exportFrame` (`packages/output/src/export/run.ts`) returns an `EncodedFile` with all
of these; nothing evaluates `output.encode` as a graph op yet.

## R3. Notes, no change requested

- `KneeSpec.strength` (`view.output.*.knee.strength`) does not reach `output.display`: `compile()`
  passes only the method. The knee strength stays at spektrafilm's p = 6 (chroma) and the shoulder at
  s = 0.82 until someone needs it.
- Rec.2020's transfer is BT.709/2020 (the bundled `Rec2020-v4.icc`); `cICP` for Rec.2020 waits for the
  open decision (guide §9). No contract change either way.
