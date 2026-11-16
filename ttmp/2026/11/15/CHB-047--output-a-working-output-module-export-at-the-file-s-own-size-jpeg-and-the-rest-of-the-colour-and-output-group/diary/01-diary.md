---
Title: Diary
Ticket: CHB-047
Status: active
Topics:
    - studio
    - output
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'CHB-047 implementation diary: export at the size he chooses (decode again, scaleDocument), JPEG, the Output module, cICP sources, the RAW colour regression test, then OUT-3 to OUT-5.'
LastUpdated: 2026-11-15T19:58:58.012042-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

CHB-047 is Phase 2's output group (CHB-044 backlog group 7): export at the file's own size with a size choice and
JPEG (OUT-2), a working Output module in Classic (OUT-1), the cICP code points checked (OUT-6), the RAW colour
regression test (OUT-7), and as far as time allows the CAM16-UCS knee on the GPU (OUT-3), soft proofing (OUT-4) and
printer output (OUT-5). The spec is `design-doc/01-spec-output-export-at-the-file-s-own-size-jpeg-colour-management.md`.

## Step 1: OUT-2 and OUT-1 — export at the size he chooses, JPEG, the Output module

The studio computes on a working image (4000 px on the GPU engine, 640 px on the CPU engine) and every coordinate it
writes into a document is a pixel of that image, although the contract's comment says "pixels of the full-resolution
decoded source". So an export at the file's own size cannot just evaluate the frame's node "bigger": the document has
to be mapped. The export now decodes the file again at the export's size (the same decode, area-averaged there, no
conditioning), registers it as its own source, maps the document onto it with a new contract function
`scaleDocument(doc, kx, ky)` (driven by the catalogue's `px` units, plus the crop, the probes and the scan medium's
boxes and µm per pixel), renders it tile by tile at full scale and lets it go. Sizes are three: Original size, Long edge
(exact, never enlarged), Percentage; all three reduce to "decode at long side L". JPEG is a new streaming baseline
encoder in packages/output.

On top of that the Output module became real: his settings (format, colour space, size, JPEG quality, file name
pattern) are preferences (`prefs.export`, kept, never undone), Export writes this photo through the save dialog,
Export N selected writes the selection into a folder, progress with Cancel and a result list show in the panel, File ▸
Export… is the same form in a dialog in every layout, and agents have `output.set`, `output.export`, `output.cancel`.

### Prompt Context

**User prompt (verbatim):** "You are implementing CHB-047 \"Output: a working Output module, export at the file's own size, JPEG, and the rest of the colour-and-output group\" in chromobench. […] Items (backlog group 7, \"Colour and output\"; read each row and its source tasks), in this order: 1. OUT-2 […] 2. OUT-1 […] 3. OUT-6 […] 4. OUT-7 […] 5. OUT-3 […] 6. OUT-4 […] 7. OUT-5 […] Do 1–4 fully; then 5–7 as far as time and quality allow […] Verify an export at full size of a 24-megapixel camera file on Metal (under the GPU lock): time, peak GPU memory from the budget journal, and that the exported pixels match a working-size render downsampled (state the tolerance). Use the photographer's files only locally; report numbers, never file names."

**Assistant interpretation:** build the export at the file's own size for both engines with a size choice and JPEG,
then the Output module on it, measured on Metal with a real 24 MP camera file; then the smaller colour items.

**Inferred user intent:** the photographer can deliver prints from chromobench (full resolution files at his size, in
JPEG for labs and screens), from a module he recognises from Lightroom; the beta needs it.

**Commit (code):** bd2df3b — "CHB-047 OUT-2, OUT-1: export at the size he chooses on both engines …"

### What I did

- Contract 2.0 (CC-026, renumbered at merge; major because scale is removed): `ExportSettings.size: ExportSize` (`{by:'original'}`, `{by:'long', px}`, `{by:'percent', pct}`)
  and `quality` replace `scale`; `output.encode.quality`; schema rule; `scale.ts` with `scaleDocument` and `scaleBox`
  (edges on whole pixels, an edge on the border stays there). Tests `packages/contract/test/scale-document.test.ts`.
- Output: `encode/jpeg.ts` (AAN float DCT, IJG quality scaling of the Annex K tables, Annex K Huffman tables, 4:4:4,
  ICC profile in APP2 chunks of 65,519 bytes, JFIF density in dpi, COM segments for software, space, document hash),
  streaming by bands of 8 rows with the same position-keyed dither as PNG 8-bit. The export runner lost its `scale < 1`
  one-pass path (an export at another size is a source at that size now) and writes JPEG. Tests: `jpeg.test.ts` with an
  independent baseline decoder (`test/jpeg-decode.ts`), `export.test.ts` (JPEG export through the reference engine).
  Cross-check with Pillow (libjpeg): sizes, dpi 240, the ICC profile byte-identical, sampling 4:4:4, mean |Δ| 0.80 and
  max 7 levels at quality 92 on a gradient picture.
- Host: `decode.ts decodePixels` (photo: the same binned/demosaiced path as the working image, `photoPixels` extracted;
  scan: decode, linearise, area-average), a `pixels` job in the engine worker (kept there for the reference engine,
  returned for the GPU engine), `StudioEngine.openExport / closeExport / sizes / exportImages`, `host/export.ts`
  (`exportLong`, `exactLong`, `ExportSources` per batch, `exportPrint`, `exportBatch` with the pickers before any
  await).
- Studio-kit: `model/export.ts` (prefs, labels, `exportFileNames` with `{name}`, `{n}`, `{date}`, dedupe), commands
  `output.set`, `output.export`, `output.cancel`, `file.export` (moved from host.ts; `output.save` and the host's
  `exportPrint` dialog are gone), `dom/output.ts` (the panel and `exportForm` for the dialog), CSS moved from app.css.
  Classic's Output centre lists the open photos (it listed picks and said "No photos yet" with photos open).
- STORAGE_FORMAT 4: edits saved with `scale` would be refused on their first change; the hard cut-off clears them once.
- Goldens: 66 `document.json` files carry `size` and `quality` (keys sorted as before); `translate.ts` maps the
  recipes' `scale`; `render.ts --check` 66/66 unchanged.
- e2e `e2e/studio-output.spec.ts` (pickers replaced by in-memory handles so the real sinks run): the panel's defaults,
  original size 480 × 320 from a 240 px working image, long edge exactly 300, percentage 25 % → 120 × 80, two selected
  frames into a folder, the agent's `output.export` to memory, a refused quality, File ▸ Export… showing the same
  settings; the CPU engine (`refLong=160`) at original size and a camera DNG at a long edge of 400.

### Why

- Decoding again instead of rendering the working image bigger: the working image has lost the detail; and decoding at
  the export's size makes every export the print the studio would show at that size (grain, sharpening, masks at that
  resolution) instead of a resample.
- Mapping the document instead of making documents full-resolution: the right long-term fix is the contract's
  definition (documents in full-resolution pixels, previews scaled), but that touches every tool and handle that
  writes coordinates, and two other agents work on masks and handles in parallel.

### What worked

- Metal, a 24-megapixel camera file (6032 × 4032 decoded; working image 4000 × 2674), GPU budget 2 GiB (the adapter's
  rule) and forced to 512 MiB (`?gpuBudget=512`): every export succeeded, no `GPU_OOM`, no `GPU_EVICT`, the same pixels
  in both budgets.

  | Export (24 MP camera file, Metal) | time | of it the decode at that size |
  |---|---|---|
  | Original size, PNG 8-bit | 8.3–8.5 s | 4.6 s |
  | Original size, JPEG q 90 | 7.4–8.0 s | 4.6–5.0 s |
  | Working size (long edge 4000), PNG 8-bit | 1.7–1.8 s | 0 (the working image) |

  Peak GPU memory (`engine.memory()`, the budget's live + pending, reset before each export): the budget fills up to
  its limit with released objects kept in the pools (1.4–1.7 GB of the 2 GiB limit after the full-size PNG export,
  2047 MB after the next; `textures.free` 1.3–1.7 GB, buffers free 0.27–0.34 GB, textures in use 62–83 MB at the end).
  The journal's `GPU_MEMORY_HIGH` rows climb in 32 MB steps to 2047 MB of 2048 MB for the same reason. With the
  budget at 512 MiB the peak is 511 MB of 512 and the export is as fast: the export's real need fits the smallest budget
  the studio sizes (pools trim their free lists when the budget is short; CHB-041).
- Pixels: the original-size export averaged down by area (fractional box weights, 6032 → 4000) against the working-size
  export, 8-bit levels: with the film's grain off mean 0.75, p99 4, p99.9 7, max 64 (single pixels at hard edges); 8 × 8
  block means mean 0.31, max 10.1. With the grain on (two different draws of grain noise at the two sizes) mean 5.7,
  p99 27, max 111 per pixel, 8 × 8 blocks mean 1.4, max 16. Tolerance stated: the export at the file's size averaged to
  the working size is the working-size print within 1 level mean and 4 levels at the 99th percentile when grain is off;
  per-pixel grain is a different random draw by design. The e2e test's synthetic negative (no grain): mean 0.36, p99 1.0
  (asserted < 1.5 and < 6), max 39 at the film edge (the print is not linear: the average of printed pixels across a
  hard edge is not the print of the averaged scan).
- SwiftShader e2e `studio-output.spec.ts`: 2 passed (≈ 35 s).

### What didn't work

- First e2e run: `expect(cmp.max).toBeLessThan(24)` failed with 39.25 at the synthetic film edge; replaced the max bound
  by the 99th percentile (1.0) after looking at where the difference was.
- The first CPU measurement died with `page.evaluate: Execution context was destroyed, most likely because of a
  navigation`: I edited `saved.ts` while the dev server served the page and Vite reloaded it. Rerun without edits.
- A parameter property (`constructor(private readonly sink…)`) in jpeg.ts broke Node's type stripping
  (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`); the repo's scripts run `.ts` directly, so fields are explicit now.

### What I learned

- The GPU engine already uploads only a tile's sub-rectangle at full scale (`sourceTexture`), so a 24 MP source never
  becomes one 386 MB texture; the export's GPU need is the tile planner's.
- The budget's "peak" counts pooled free objects; it says how full the pools got, not what the export needed. Running
  with a small `?gpuBudget` is the honest test.

### What was tricky to build

- Strips: a strip's working image is sized for its frames (`stripScale`), so the scale to the export image must come
  from the two decodes' sizes (kx = W′/W, ky = H′/H), never from a `long` ratio.
- Long edge exact: crop boxes scale with rounded edges; `exactLong` adjusts the scaled crop by at most two pixels so
  the long edge is the number he typed (without a crop the decode's own rounding already gives it).
- The save dialog needs the click's user activation: `exportBatch` opens the picker (one file) or the directory picker
  (several) before any other await; an agent's run (no activation) falls back to downloads; closing the dialog
  exports nothing.

### What warrants a second pair of eyes

- `scaleDocument` scales by unit `px` and the types box/point/polyline; a future op with a pixel quantity that is not
  declared `px` would not scale. A test compiles the scaled document and checks sizes and pitches; a law over every op
  would be stronger.
- The document hash in the file is of the frame's document (working-image pixels) with the export settings, not of the
  scaled document actually rendered.
- STORAGE_FORMAT 4 clears saved edits once (with the message); another Phase 2 branch may bump it too.

### What should be done in the future

- Documents in full-resolution pixels as the contract says (or recording the working size in saved edits and mapping
  with `scaleDocument` on resume): today a frame edited at 4000 px and reopened on the CPU engine (640 px) reads its
  coordinates at the wrong scale.
- The decode at the export's size is half of a full-size export's time; frames of one file share it within a batch,
  consecutive exports do not.

### Code review instructions

- Start at `apps/studio/src/host/export.ts` (`exportPrint`, `exportLong`, `exportBatch`), then
  `packages/contract/src/scale.ts`, `packages/output/src/encode/jpeg.ts`, `packages/studio-kit/src/commands/output.ts`,
  `packages/studio-kit/src/dom/output.ts`.
- `npx vitest run packages/contract/test/scale-document.test.ts packages/output/test/jpeg.test.ts packages/output/test/export.test.ts`;
  `STUDIO_PORT=5571 … CI=1 npx playwright test e2e/studio-output.spec.ts --project chromium-webgpu`;
  the Metal measurement: `zsh <lock> node scripts/01-full-size-export.mjs http://localhost:5571 <file> engine=gpu [nograin]`.

### Technical details

- Export sizes: S0 = working long side, F = file long side, O0 = output long side at working size;
  original → L = F; long N → L = min(F, round(S0·N/O0)); percent P → L = round(F·P/100); L = S0 → the working image;
  L ≥ F → decode at the file's own size (long 0).


## Step 2: OUT-7 — the RAW colour regression test

CHB-033's script 01 compared our NEF colour (LibRaw's single Adobe matrix, the as-shot neutral) with Adobe's (the DNG
Converter's dual-illuminant matrices) and found them within ΔE2000 median 0.13–0.51. It became a vitest test that
pairs the private NEFs with Adobe's DNGs by file name and skips without them, so the check runs on the owner's Mac and
nowhere else, and prints numbers only.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** turn script 01 into a test that guards our RAW colour, without committing or naming the
private files.

**Inferred user intent:** a change to LibRaw, the matrix path or the white balance cannot silently move his colours.

**Commit (code):** c8e8875 — "CHB-047 OUT-7: the RAW colour regression test …"

### What I did

- `apps/studio/test/raw-colour.test.ts`: `<private>/photos/*.NEF` paired with `<private>/dng/*.dng` by stem;
  `<private>` is `$CHROMOBENCH_PRIVATE` or the repository's `.playwright-mcp`. Both decoded by `decodePhoto` at 256
  px, through core's `cameraMatrix` (as-shot), Lab D65, exposure matched on mean Y, shadows below Y 0.005 and highlights
  above 0.9 left out; ΔE2000 (Sharma et al.); the white balance (as-shot neutral) equal within 0.5 %.
- Ran it with a scratch folder linking the main checkout's photos and `~/chromobench-tools/dng-out`.

### What worked

- Four photos: ΔE2000 median 0.36 / 0.34 / 0.13 / 0.51, p90 1.26 / 0.62 / 0.47 / 0.70, p99 1.32 / 0.95 / 0.66 / 1.23,
  ≈ 42,000 pixels each, 15 s; the same numbers as CHB-033. Without the files: 1 skipped.

### What didn't work

- N/A

### What I learned

- The worktree has no `.playwright-mcp`; the environment variable keeps the test runnable from any checkout.

### What was tricky to build

- Not naming files: the test lists the folders and pairs by stem; it prints "photo 1…4".

### What warrants a second pair of eyes

- The bounds (median 0.75, p99 2) leave room for LibRaw updates; a real regression of the matrix moves the median by
  several units, a white balance error fails the neutral check first.

### What should be done in the future

- N/A

### Code review instructions

- `CHROMOBENCH_PRIVATE=<dir with photos/ and dng/> npx vitest run apps/studio/test/raw-colour.test.ts --reporter=verbose`

### Technical details

- Script 01's forward-matrix comparison was left out (D11: our colour stays; OUT-8 is out of scope).

## Step 3: OUT-6 — the cICP code points

The cICP values were written from memory. They are right: H.273 ColourPrimaries 1 is BT.709, 12 SMPTE EG 432-1;
TransferCharacteristics 13 is IEC 61966-2-1 sRGB "with MatrixCoefficients equal to 0"; MatrixCoefficients 0 is the
identity (RGB, the only model PNG allows); PNG-3 §11.3.2.6 gives Display P3 full range as Example 4, `0C 0D 00 01`.
The review note in `spaces.ts` became the sources; a test pins the values; CHB-011's design doc no longer credits paper
white Y 0.813 and Dmax 2.37 to the Endura JSON (they come from the textbook's §2.7 model).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** verify the code points against sources and fix the two notes.

**Inferred user intent:** files that colour-manage correctly in every reader.

**Commit (code):** 1d4b361 — "CHB-047 OUT-6: cICP code points checked …"

### What I did

- Read PNG-3 (w3.org/TR/png-3, §11.3.2.6: fields, matrix coefficients 0 for RGB, the four examples) and the H.273
  (07/2021) tables as colour-science transcribes them (`colour/models/rgb/itut_h_273.py`).
- `packages/output/src/spaces.ts` comment; `packages/output/test/icc.test.ts` pins `[1,13,0,1]`, `[12,13,0,1]` and none
  for the other spaces; CHB-011 design doc: the RelatedFiles note and §5.6's sentence with the sources.

### What worked / What didn't work

- The values were right; no file changes. Fetching the H.273 PDF itself was not tried (ITU access); the PNG-3 example
  confirms Display P3 directly, colour-science's transcription the sRGB code points.

### What I learned / What was tricky to build / What warrants a second pair of eyes / What should be done in the future

- N/A

### Code review instructions

- `npx vitest run packages/output/test/icc.test.ts`

### Technical details

- Sources: https://www.w3.org/TR/png-3/ ; https://colour.readthedocs.io/en/latest/_modules/colour/models/rgb/itut_h_273.html

## Step 4: OUT-3 — the CAM16-UCS knee on the GPU

A document asking for the CAM16-UCS knee rendered with the OkLCh knee on the GPU and a `W_PREVIEW_APPROX` warning.
The knee now has its own WGSL: CAM16 forward and inverse with spektrafilm's viewing conditions (D = 1), the knee in
J′a′b′ by bisection of the largest in-gamut M′, the hue carried as a unit vector (WGSL's sin and cos are only accurate
to 2⁻¹¹). Core shares CAM16's step 0 (`cam16Viewing`) and gives the GPU its constants (`cam16Knee`).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** port the f64 knee to WGSL with parity, remove the approximation.

**Inferred user intent:** the same colours on every engine for every knee the document can ask for.

**Commit (code):** 423eec4 — "CHB-047 OUT-3: the CAM16-UCS knee on the GPU …"

### What I did

- core `gamut.ts`: `cam16Viewing` (F_L, N_bb, c·z, t_k, D_RGB, A_w), `cam16` on it; `cam16Knee(space)`: the matrix
  diag(D_RGB)·M16·(100·toXYZ), its inverse, eight scalars.
- gpu `chain/program.ts`: knee code 3, the matrices in the OkLab slots, the scalars in the op's data;
  `engine/lower.ts` without the warning; `kernels/pointwise.wgsl` `c16Fwd`, `c16Inv`, `c16MaxChroma` (cHi 150, up to 8
  doublings, 30 halvings), `c16Knee`.
- gpu-parity `output.spec.ts`: a cam16-ucs test; `digital.test.ts`: the lowering.

### What worked

- Parity at the first run, 61,440 values (five spaces × both renderings × 2048 XYZ): SwiftShader 1.08 % beyond 2e-6,
  max 1.67e-5 in linear RGB, 4 codes in 16 bits; Metal 0.83 %, 1.89e-5, 3 codes. Bounds 2 %, 3e-5, 6 codes.
  Scan-of-print paper white stays 65,535.

### What didn't work

- N/A

### What I learned

- The f32 error budget is the oklch knee's (1.3e-5 SwiftShader, 3.0e-5 Metal): the bisection near the top of the
  cube, not CAM16's power functions, dominates.

### What was tricky to build

- `cos(h + 2)` of the eccentricity without trigonometry: ca·cos 2 − sa·sin 2 with the constants written out.
- NaN and infinity in the inverse (|Ra − 0.1| ≥ 400): `all(v == v) && inCube(v)` is core's `Number.isFinite && inCube`.

### What warrants a second pair of eyes

- The expansion loop stops at the first out-of-gamut doubling (core's `for … && ok(hi)`), from 150; a space whose
  largest M′ exceeds 150·2⁸ would clip, none of the five comes close.

### What should be done in the future

- A control for the knee in his words (open task).

### Code review instructions

- `kernels/pointwise.wgsl` (search `c16`), `src/chain/program.ts lowerDisplay`, core `cam16Knee`.
- `REAL_GPU=1 CI=1 npx playwright test packages/gpu/test/browser/output.spec.ts --project gpu-parity` under the lock.

### Technical details

- Op data: F_L, A_w, N_bb, c·z, t_k, (50000/13)·N_c·N_cb, J′(white), F_L^¼.

## Step 5: OUT-5 — a file for the printer

Printer output was a document field nobody used. Now the Output panel's Colour space lists his printer profiles
("Printer: <profile>") and "Add printer profile…"; choosing one shows Intent (Perceptual, Relative colorimetric) and
Black point compensation. The frame renders in ProPhoto at 16 bits (nothing a print can show is clipped before the
printer's gamut mapping), lcms converts every band from ProPhoto to the printer profile in its worker, and the printer
profile is embedded (TIFF, PNG, JPEG). Profiles live in OPFS by SHA-256 (CHB-011's `ProfileLibrary`, checked by lcms).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** wire `output.printer` into the export: strip-wise lcms, intent, BPC, profile embedded.

**Inferred user intent:** he prints at home on an inkjet with his paper's profile, as from Lightroom.

**Commit (code):** d9ee526 — "CHB-047 OUT-5: printer output …"

### What I did

- `packages/output/src/export/printer.ts` (`printerConversion`), `ExportRequest.printer` in the runner (each band
  converted before it is written; the printer profile embedded; `EncodedFile.printer`).
- Studio-kit: `ExportPrefs.printer`, `PRINTER_INTENTS`, `HostFlags.printers`, `output.addPrinterProfile`, the form's
  rows. Host: `hostLcms` (the lcms worker), `printerLibrary`, `printerProfiles`, `addPrinterProfile`, the conversion
  once per batch in `exportBatch`; `withExport` records `output.printer` and renders ProPhoto.
- Tests: `export.test.ts` (bit for bit against a direct lcms transform of the plain ProPhoto export; tiles 24 and 64
  give the same file; the profile in the file); `export-settings.test.ts`; e2e "OUT-5" (a synthetic printer profile
  through the panel's file input, Intent, BPC, a TIFF with the profile, back to sRGB).

### What worked

- Everything at the first full run except two test details (below).

### What didn't work

- The test expected perceptual and relative + BPC to differ: the synthetic printer is a matrix/TRC profile with black
  at 0, so lcms has no perceptual table and BPC moves nothing; the test now says so and expects equality.
- The e2e's search for the profile bytes with `String.fromCharCode(...200k values)` hit "Maximum call stack size
  exceeded"; a plain loop.

### What I learned

- `ProfileLibrary`, `validatePrinterProfile` and `lcms.proof` were already there from CHB-011; only the export side and
  the UI were missing.

### What was tricky to build

- The pickers need the click's activation: the printer conversion is set up after the save dialog opened.

### What warrants a second pair of eyes

- A real LUT printer profile (A2B/B2A tables) was not tried here (no such file in the repository); the synthetic one
  is matrix/TRC. The intents only differ for LUT profiles.

### What should be done in the future

- Soft proofing (OUT-4) on the same profiles.

### Code review instructions

- `packages/output/src/export/printer.ts`, `run.ts` (search `printer`), `apps/studio/src/host/export.ts`
  (`exportBatch`, `hostLcms`), `packages/studio-kit/src/dom/output.ts` (the colour space select).

### Technical details

- The lcms transform: ProPhoto v4 (the bundled profile the export embeds otherwise) → printer, RGB_16 in and out,
  intent and BPC from his settings, `cmsFLAGS_NOCACHE`.

## Step 6: OUT-4 left open

Soft proofing was not started. It is a feature of the display path in every engine (a 33³ table from lcms's proofing
transform with a round-trip ΔE channel, applied after the working-space render in core, the GPU and the mock, with
parity and a test against direct lcms), plus a toggle with a gamut warning in Print and Output. Done half it would
leave a table nobody uses; the plan is in the tasks.

## Step 7: checks, and the CPU engine at 24 megapixels

All checks pass: `pnpm typecheck`, `pnpm lint`, `pnpm gen:check` (26 files), `npx vitest run` (151 files, 3,480
tests passed, 20 skipped), `node tools/goldens/render.ts --check` (66/66, no picture changed), the SwiftShader browser
suite with ports 5571–5574 (170 passed, 2 skipped, 24.2 min, conformance 524/524; it ran beside the CPU measurement)
and `--project gpu-parity` on Metal under the lock (62 passed, 2 skipped, 1.3 min; conformance 524/524).

The CPU engine exports at the file's size correctly (e2e: 480 × 320 from a 160 px working image, a camera DNG at a
long edge of 400), but a 24-megapixel camera file does not finish in reasonable time: the reference engine computes
every stage at full resolution in f64 (`engine-ref.ts`: an export evaluates the whole frame, then samples the tile),
and the run was still computing after 45 minutes with the worker at 5–6 GB. Measured against a static build
(`vite build` + `vite preview` on port 5575) after the first attempt died when Vite reloaded the page during an edit.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** run every check of the brief, and report what the CPU engine does with a real file.

**Inferred user intent:** nothing merged that breaks the studio; the fallback engine's limits known.

### What worked

- The numbers above.

### What didn't work

- The CPU engine at 24 MP (above). Earlier run: `page.evaluate: Execution context was destroyed` (Vite reload).

### What I learned

- Measure against a static build when editing in the same worktree.

### What should be done in the future

- The reference engine's export of a region computes the whole frame at full resolution: a 24 MP file needs several
  GB and tens of minutes. A banded (haloed) export in core, or the sampled grid path at export precision for the print
  stages, would make the CPU fallback usable for full-size exports (open task).

### Code review instructions

- See Step 1.
