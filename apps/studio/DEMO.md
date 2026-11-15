# Chromobench studio — demo (CHB-023; the unified editing model since CHB-037)

A first working version of the studio on the real physics: it opens scans of colour negatives, prints
them through the spectral model (film dyes → enlarger → paper → viewing light), lets you adjust them as
at a colour enlarger, and exports the print. It is unfinished; the list below says what works.

## Build and run (no internet needed once built)

```sh
pnpm install
pnpm --filter @chromobench/studio build      # → apps/studio/dist (app, data packs, LibRaw)
pnpm --filter @chromobench/studio preview    # → http://localhost:4173
```

Open <http://localhost:4173> in **Chrome or Edge** (WebGPU). After the first visit the service worker
keeps the app and the data packs, so it also starts with the network off. `dist/` can be served by any
static web server at the site root (`npx serve dist`, `python3 -m http.server`); it does not work from
`file://`. For development: `pnpm --filter @chromobench/studio dev`.

URL options: `?layout=classic|darkroom|simple|lab|tiny|roll|finish|looks` (the studio's layout, default
**classic**: Library, Roll, Scene (camera files), Print (the darkroom), Edit (the print's digital layers), Finish
(crop, straighten, spots), Assistant and Output modules; **darkroom** is one screen: the film strip, the print, the
Enlarger and a collapsed "Digital (after the print)" palette; View ▸ Layout switches in place and also lists layouts
the assistant wrote and you accepted), `?engine=gpu|reference|mock` (default: GPU when WebGPU works, else the
reference engine), `?long=N` (long side of the working image on the GPU, default 4000; `0` = the file's own size),
`?canvas2d` (present without WebGPU), `?nosw` (no service worker), `?fresh` (keep nothing in the browser).

The layouts are programs written in studio-kit's JS API (`packages/studio-kit/layouts/*.js`); `lab` is classic
plus every parameter, the raw journal and the node list. Synthetic files to try: `node e2e/make-scenes.ts <dir>`.

## Open a folder of scans

- **File ▸ Open Folder…**: every scan in the folder (and one level of subfolders) opens; Chrome remembers
  the folder (**Reopen <folder>** after a restart). **File ▸ Open Files…** for single files. The first file opens
  in the Print module; the others appear in the film strip as they are decoded.
- TIFF and PNG (16-bit, linear or sRGB), DNG, and camera RAW (`.nef .cr2 .cr3 .arw .raf .orf .rw2 …`,
  decoded by LibRaw in a worker, in scan mode: linear camera RGB, no white balance).
- Scans are reduced to a working image (4000 px on the long side on the GPU, 640 px on the reference
  engine, each frame of a strip about as much) on open; the status line shows what was read and the film base it
  found.
- Each frame's document and history are saved in the browser by the file's hash: reopening the same
  file (even renamed or moved) brings its print back. After a reload the strip shows only the frames
  opened again in this session.

## What works

- **First print**: a fresh scan opens inverted to film dyes and printed on the default paper with the
  enlarger in *real* mode, integrated to grey: the frame's density goes into the enlarger time (on the
  1/6-stop grid), the colour remainder into the printer lights. The before/after compare shows this
  first print against the current one.
- **Enlarger controls** (Darkroom panel, right): time (seconds, stops readout), f-number, signed C/M/Y
  filtration (CC shift on the paper's neutral pack), printer lights (points, plus Lighter/Darker), paper,
  grade, preflash, film stock, scanner and viewing light (from the data packs). Drag, arrow keys (a burst
  is one undo step), double-click a label to reset. A typed number sets the value (`12`, `12 s`, `7,5`); a
  change needs a sign and a unit (`+1/3 st`, `-5 s`); a bare `-5` on Time is refused with both spellings.
- **Enlarger mode** (Exposure group): *Real enlarger* (time and aperture expose the paper; the default of
  classic, darkroom and lab) or *Normalised* (the grey card prints at the aim whatever the time; the
  default of simple and tiny). In normalised mode Time and Aperture are hidden and Lighter/Darker move
  the printer lights; in real mode Lighter/Darker change the time by 1/3 stop. A saved frame keeps the
  mode it was printed in.
- **Views**: Print, Negative (the scan), No mask (the negative without its orange mask; the dyes view),
  Clipping (blank film, below base, out of gamut; the base and gamut view) — keys 1–4. **Before /
  after** (Tools panel, or `\`) splits the print against the first print.
- **Densitometer** (Tools panel, or `i`): hover the print (visual density and R G B densities under the
  cursor, and in the Densitometer panel); `p` pins a probe into the document.
- **Layers on every stage** (CHB-037): the darkroom's stack (main exposure, printer lights, burns, dodges, flashes,
  preflash, filters, contrast masks) in the Exposures / Enlarger panel; the print's digital layers (curve, levels,
  HSL, colour grading, vibrance, channel mixer, clarity, sharpen, vignette) with 16 blend modes, groups and an amount;
  a camera file's scene stage (before the film). "+ Layer" adds from the catalogue; the Layer panel shows the selected
  layer's controls (editors for curve, levels, HSL, grading wheels, mixer); the Mask panel its mask (linear, radial,
  brush, luminance and colour ranges; the colour from the picture with Sample).
- **Looks and rolls**: looks (warm/cool print, contrast, edge burn, crisp print, …) apply as links you can fade or
  bake; a roll links its frames' scans (shared base and veil, a frame's own changes are its overrides); a look or a
  match over a roll is one card and one undo step. Copy/Paste/Sync Settings are in the Looks layout's Looks menu.
- **Finish**: crop and straighten, heal and clone spots (F, then R / Q).
- **History**: every change is one undo step (Ctrl+Z / Shift+Ctrl+Z) in words ("Time 4.45 → 12.5 s (+1½ stops)",
  "Added a curve"); click an entry to go back to it (it asks before it undoes later changes on other frames);
  snapshots and restore. Ratings are undoable too.
- **Test strip** (Tools panel, or `t`): five strips of the frame, each printed with its own time
  (1/3 stop apart) around the current value, labelled; click a band to use it.
- **Ring-around** (Tools panel, or `r`): the print with printer-light steps of 4 points in every
  direction plus lighter/darker; click the one that looks best.
- **Export** (File ▸ Export…): TIFF 16-bit, PNG 16-bit or PNG 8-bit in sRGB, Display P3, Adobe RGB or ProPhoto
  RGB with its ICC profile (packages/output), exact (tiles with halos equal the whole-frame result); Chrome asks
  where to save. **Save Document** downloads the frame's document (format 3) as JSON.
- **The assistant** (Assistant module): an agent with only `eval` that can read and edit any stage, run any
  command and write a layout; in "ask" mode its changes wait on a card for your approval.

## Not yet

- The test strip's step and count and the ring-around's step are fixed (1/3 stop, 5 bands; 4 points)
  until the tools get option controls.
- The rebate (film base) is read from the brightest 5 % of columns; a scan without film edge, or
  with sprocket holes, gets a wrong base until a rebate box can be picked.
- The scanner model is illustrative (CHB-013 measures the photographer's own camera and light).
- Without WebGPU the reference engine computes in a worker in f64: previews at 640 px through tables
  (about 0.7 s per slider step on the test negative), exports exact but slow.
- Selections (subject, sky) do not exist; masks are drawn or ranges.
