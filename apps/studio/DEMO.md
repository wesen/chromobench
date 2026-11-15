# Chromobench studio — first demo (CHB-023, on the shell-based studio since CHB-019)

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

URL options: `?layout=classic|darkroom|simple|lab|tiny` (the studio's layout, default **classic**: Library,
Print and Output modules, history on the left, the enlarger on the right, the film strip at the bottom; also the
**Layout** menu top right), `?engine=gpu|reference|mock` (default: GPU when WebGPU works, else the reference
engine), `?long=N` (long side of the working image on the GPU, default 4000; `0` = the file's own size),
`?canvas2d` (present without WebGPU), `?nosw` (no service worker), `?fresh` (keep nothing in the browser).

The layouts are layouts written in studio-kit's JS API (`packages/studio-kit/layouts/*.js`); `lab` is classic
plus every parameter, the raw journal and the node list.

## Open a folder of scans

- **Open folder…** (top bar): every scan in the folder (and one level of subfolders) opens; Chrome remembers
  the folder (**Reopen <folder>** after a restart). **Open files…** for single files. The first file opens
  in the Print module; the others appear in the film strip as they are decoded.
- TIFF and PNG (16-bit, linear or sRGB), DNG, and camera RAW (`.nef .cr2 .cr3 .arw .raf .orf .rw2 …`,
  decoded by LibRaw in a worker, in scan mode: linear camera RGB, no white balance).
- Scans are reduced to a working image (4000 px on the long side on the GPU, 640 px on the reference
  engine, each frame of a strip about as much) on open; the status line shows what was read and the film base it
  found.
- Each frame's recipe and history are saved in the browser by the file's hash: reopening the same
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
  cursor, and in the Densitometer panel); `p` pins a probe into the recipe.
- **History**: every change is one undo step (Ctrl+Z / Shift+Ctrl+Z, Undo/Redo in the top bar); click
  an entry to go back to it; snapshots and restore.
- **Test strip** (Tools panel, or `t`): five strips of the frame, each printed with its own time
  (1/3 stop apart) around the current value, labelled; click a band to use it.
- **Ring-around** (Tools panel, or `r`): the print with printer-light steps of 4 points in every
  direction plus lighter/darker; click the one that looks best.
- **Export** (top bar): TIFF 16-bit, PNG 16-bit or PNG 8-bit in sRGB, Display P3, Adobe RGB or ProPhoto
  RGB with its ICC profile (packages/output), at the working size; Chrome asks where to save.
  **Save recipe** downloads the recipe and history as JSON.
- Flags and stars in the Library module; apply the current print settings to selected frames
  (Frame ▸ Apply Print Settings to Selection).

## Not yet

- Dodging, burning, masks and extra exposures: the tools are there but the real engines do not
  compute `print.combine` / `mask.*` yet (CHB-010 follow-up); they report "not implemented".
- Export is at the working size (`?long=0` on the GPU exports the file's own size).
- The test strip's step and count and the ring-around's step are fixed (1/3 stop, 5 bands; 4 points)
  until the tools get option controls; the class fractions of the Base view are not listed.
- Rotation and crop are not wired into the viewer (scans show as stored).
- The rebate (film base) is read from the brightest 5 % of columns; a scan without film edge, or
  with sprocket holes, gets a wrong base until a rebate box can be picked. Scanner flare is not
  corrected; dust healing is an opt-in checkbox (slow on big scans).
- The scanner model is illustrative (CHB-013 measures the photographer's own camera and light).
- Without WebGPU the reference engine computes every pixel in f64 on the main thread: expect a few
  seconds per change and a frozen UI meanwhile.
- WebGPU presentation on real GPUs is untested (headless tests use SwiftShader and Canvas2D).
