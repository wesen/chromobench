---
Title: 'Spec: output, export at the file''s own size, JPEG, colour management'
Ticket: CHB-047
Status: active
Topics:
    - studio
    - output
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Phase 2, group 7 of the CHB-044 roadmap: export at the file''s own size on both engines with a size choice and JPEG (OUT-2), a working Output module (OUT-1), cICP check (OUT-6), the RAW colour regression test (OUT-7), then the CAM16-UCS knee on the GPU (OUT-3), soft proofing (OUT-4), printer output (OUT-5).'
LastUpdated: 2026-11-15T19:58:57.059283-05:00
WhatFor: ""
WhenToUse: ""
---

# Spec: output, export at the file's own size, JPEG, colour management

Phase 2 of the CHB-044 roadmap, group 7 ("Colour and output"): OUT-1 … OUT-7 in the order the prompt gives (OUT-2
first, because the Output module stands on it). OUT-8 and OUT-9 are out of scope (decision D11).

## What a document pixel is, and why the export maps the document

The contract says every stored coordinate is a pixel of the full-resolution decoded source. The studio does not do
that: a frame's source is its **working image** (4000 px long side on the GPU engine, 640 px on the CPU engine,
`apps/studio/src/host/engines.ts`), and every coordinate the studio writes (crop, masks, heal spots, probes, the scan
medium's rebate, open gate and µm per pixel) is a pixel of that image. Physical sizes (grain µm, blur µm, clarity and
sharpen mm on the print, mask feather mm) are converted with the pitch, so they are the same at every size.

So an export at another size is **the print the studio would render had its working image been that size**:

1. decode the file again at the export's size (the same decode, area-averaged to that size; no conditioning, no
   analysis image, no dust search) and register it as its own source (`exportSourceSha`);
2. map the document onto it (`scaleDocument(doc, kx, ky)` in the contract, driven by the catalogue's `px` units: every
   box, point and px length of geometry, masks, layers and probes, the scan medium's boxes; the scan's µm per pixel
   divided by the scale; a camera file's pitch follows the source's size by itself);
3. evaluate the export node tile by tile at full scale (the GPU engine uploads each tile's sub-rectangle of the
   source; the CPU engine computes in its worker), encode, and let the export source go.

Previews stay at the working size; nothing changes for them. When the export's size is the working size (a small
file, `?long=0`), the working source is used as it is.

Left as it is (recorded as open): saved edits do not record the working size, so a frame edited on the GPU engine
(4000 px) and reopened on the CPU engine (640 px) reads its coordinates at the wrong scale. `scaleDocument` is the
piece a fix needs (record the working size in the save, map on resume).

## Items

| # | Behaviour after CHB-047 | Where | Evidence |
|---|---|---|---|
| OUT-2 | Export renders at the size he chooses: **Original size** (every pixel the file has, of the cropped frame), **Long edge** N px (never enlarged beyond the original), **Percentage** (1–100 % of the original). The file is decoded again at that size for the export only; previews stay at the working size. Formats: TIFF 16-bit, PNG 16-bit, PNG 8-bit and **JPEG** (8-bit, quality 1–100, 4:4:4, the colour space's ICC profile embedded, the document's hash in a comment). Both engines. | contract `ExportSettings.size`/`quality`, `scaleDocument`; output `encode/jpeg.ts`, `export/run.ts`; studio `host/export.ts`, `host/decode.ts`, `host/studio-engine.ts`, the worker protocol | vitest: scaleDocument laws, JPEG encoder (structure, ICC chunks, decoded values), runner; e2e: sizes and formats on synthetic files, both engines; Metal: a 24-megapixel camera file at original size (time, peak GPU memory from the budget journal, pixels against the working-size render) |
| OUT-1 | Classic's **Output** module is a real panel: Format, Colour space, Size (Original / Long edge / Percentage with its number), JPEG quality (when JPEG), File name (a pattern with `{name}`, `{n}`, `{date}`), and **Export** (this frame) / **Export N selected**; a progress line (frame i of n, tiles) with Cancel, and a result list (file, pixels, size). File ▸ Export… opens the same settings as a dialog in every layout. Settings are his preferences (kept across sessions, like Lightroom's export dialog), not an edit: no undo applies to them; the export writes files and changes no document. | `studio-kit/src/commands/output.ts`, `src/dom/output.ts`, `src/model/export.ts`, `src/cb.ts`, `apps/studio/src/main.ts` | vitest: command and settings model; e2e: the module end to end (settings, export of one and of selected frames, progress, result) |
| OUT-6 | cICP code points checked against ITU-T H.273 (primaries 1 BT.709 / 12 SMPTE EG 432-1, transfer 13 IEC 61966-2-1, matrix 0 identity, full range 1); the review note is replaced by the source; CHB-011's design note on paper white / Dmax is corrected. | `output/src/spaces.ts`, CHB-011 design doc | test pins the values; diary quotes the source |
| OUT-7 | A regression test of the RAW colour (CHB-033 script 01: our NEF colour against Adobe's DNG matrices, ΔE2000), skipping when the private files are absent. | `apps/studio/test/` or `packages/ingest/test/` | runs locally with the files, skips in CI |
| OUT-3 | The CAM16-UCS knee in WGSL with parity against core; the W_PREVIEW_APPROX fallback goes. | `gpu/src/engine/lower.ts`, WGSL | gpu-parity spec |
| OUT-4 | Soft proofing: a 33³ proof table with a gamut channel in the output kernel, tested against lcms. | output, gpu | parity against lcms |
| OUT-5 | Printer output: strip-wise lcms to the printer profile with intent and BPC, the profile embedded. | output, export | test against lcms |

OUT-3 … OUT-5 are done as far as time and quality allow, each finished and tested or left untouched and recorded.

## Decisions taken here

- **Export settings are preferences, not part of a photo's edit.** Lightroom's export settings belong to the export
  dialog, not to a photo; a photographer who sets JPEG at 2048 px expects the next photo to export the same way. They
  are kept in `prefs.export` (the view tier: persisted, never undone). At export they are written into the exported
  document's `output.export`, so the file's document hash records them. The document keeps its own knee, dpi,
  compression, colour signalling and sidecar choice.
- **Sizes are decoded, not resampled after rendering.** A long-edge or percentage export decodes the file at that
  size and renders it there, exactly as the preview at the working size is made: the grain, the sharpening and the
  masks are those of the print at that size, and no second resampling softens the result.
- **JPEG is written by our own streaming baseline encoder** (no canvas): it encodes as the tiles arrive, embeds the
  ICC profile (APP2, chunked), writes the dpi (JFIF density) and the document's hash (COM), and uses 4:4:4 chroma at
  every quality (prints; no colour bleeding at edges). 8-bit values come from the 16-bit codes with the same
  position-keyed dither as PNG 8-bit.
- **Long edge is exact.** The crop is adjusted by at most a pixel so the long edge is the number he typed.
