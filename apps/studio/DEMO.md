# Chromobench studio — first demo (CHB-023)

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

URL options: `?engine=gpu|reference|mock` (default: GPU when WebGPU works, else the reference engine),
`?long=N` (long side of the working image on the GPU, default 4000; `0` = the file's own size),
`?canvas2d` (present without WebGPU), `?nosw` (no service worker).

## Open a folder of scans

- **Add folder…** (Library, left): pick the folder; Chrome remembers it (Reconnect after a restart).
  **Open files…** (top bar) for single files.
- TIFF and PNG (16-bit, linear or sRGB), DNG, and camera RAW (`.nef .cr2 .cr3 .arw .raf .orf .rw2 …`,
  decoded by LibRaw in a worker, in scan mode: linear camera RGB, no white balance).
- Scans are reduced to a working image (4000 px on the long side on the GPU, 512 px on the reference
  engine) on open; the status line shows what was read and the film base it found.
- Each frame's recipe and history are saved in the browser by the file's hash: reopening the same
  file (even renamed or moved) brings its print back.

## What works

- **First print**: a fresh scan opens inverted to film dyes and printed on the default paper with the
  enlarger in *real* mode, integrated to grey: the frame's density goes into the enlarger time (on the
  1/6-stop grid), the colour remainder into the printer lights. The before/after compare shows this
  first print against the current one.
- **Enlarger controls** (Controls tab): time (seconds, stops readout), f-number, signed Y/M/C
  filtration (CC shift on the paper's neutral pack), grade 0–5, printer lights (points), paper, film
  stock and scanner (from the data packs), viewing light. Drag, arrow keys, Home to reset.
- **Views**: Print, Negative (the scan), Dyes (the negative without its mask), Base & gamut
  (blank film, below base, out of gamut) — keys 1–4. Before/after split with `\`.
- **Densitometer**: hover the print (visual D, Status densities, dye amounts); `p` pins a probe.
- **History**: every change is one undo step (Ctrl+Z / Shift+Ctrl+Z); snapshots and restore.
- **Test strip** (Tools, `t`): five or more strips of the frame, each printed with its own time
  (or Y/M/C filtration) around the current value; click a band to use it.
- **Ring-around** (Tools, `r`): the print in printer-light steps of 2, 4 or 8 points; click a tile.
- **Export PNG** (top bar): the print at the working size, 8-bit sRGB or Display P3.
  **Save recipe** downloads the recipe and history as JSON.
- Contact sheet of a roll; apply the current print settings to selected frames.

## Not yet

- Dodging, burning, masks and extra exposures: the tools are there but the real engines do not
  compute `print.combine` / `mask.*` yet (CHB-010 follow-up); they report "not implemented".
- Export is 8-bit and at the working size (16-bit TIFF/PNG and full resolution: CHB-011).
- Rotation and crop are not wired into the viewer (scans show as stored).
- The rebate (film base) is read from the brightest 5 % of columns; a scan without film edge, or
  with sprocket holes, gets a wrong base until a rebate box can be picked. Scanner flare is not
  corrected; dust healing is an opt-in checkbox (slow on big scans).
- The scanner model is illustrative (CHB-013 measures the photographer's own camera and light).
- Without WebGPU the reference engine computes every pixel in f64 on the main thread: expect a few
  seconds per change and a frozen UI meanwhile.
- WebGPU presentation on real GPUs is untested (headless tests use SwiftShader and Canvas2D).
