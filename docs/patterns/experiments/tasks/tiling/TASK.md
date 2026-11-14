# Task: tiled rendering of a filter chain in bounded memory

You are building the export path of a film-simulation tool. A scan is processed by a chain of operations; some are
pointwise, some are Gaussian blurs whose size is given in micrometres on the film (so they look the same at every
scan resolution). On the target device, no image buffer except the input and the output may exceed a memory budget,
so the export must be computed in pieces, and the pieces must join without seams.

## Images and operations

A single-channel image is `{ width: number, height: number, data: Float32Array }` (row-major). A scan comes with its
resolution `umPerPx` (micrometres of film per pixel).

| Operation | Definition |
|---|---|
| `{ op: "gain", factor }` | v × factor |
| `{ op: "gamma", exponent }` | max(v, 0) ^ exponent |
| `{ op: "blur", sigmaUm }` | Gaussian blur with σ = sigmaUm / umPerPx pixels. If σ < 0.1 it is the identity. Otherwise the kernel radius is R = ceil(3σ), weights w(i) = exp(−i² / (2σ²)) for i = −R…R, normalised to sum 1; applied horizontally, then vertically; coordinates outside the image are clamped to the nearest edge pixel |

## API (`project/src/index.ts`, ES module, TypeScript runnable with Node 24 type stripping)

```ts
export interface Image { width: number; height: number; data: Float32Array }
export type Op = { op: 'gain'; factor: number } | { op: 'gamma'; exponent: number } | { op: 'blur'; sigmaUm: number };

export interface TileReport { x: number; y: number; w: number; h: number; readX: number; readY: number; readW: number; readH: number }
export interface TiledOptions {
  /** No buffer other than the input and the output may hold more than this many pixels. */
  maxTilePixels: number;
  /** Called once per output tile: the rectangle it writes (x, y, w, h) and the input rectangle it reads. */
  onTile?(t: TileReport): void;
  /** Called for every other image buffer you allocate (tiles, intermediates, reduced images): its size. */
  onBuffer?(width: number, height: number): void;
}

/** The whole image at once, exactly as defined above (no memory limit). */
export function renderWhole(img: Image, umPerPx: number, chain: Op[]): Image;
/** The same result, computed within the memory budget. */
export function renderTiled(img: Image, umPerPx: number, chain: Op[], opts: TiledOptions): Image;
```

## Requirements

1. **Exact where possible.** When the blurs can be computed within the budget, `renderTiled` must equal the exact
   definition to within 1e-5 per pixel, for any chain (several blurs in sequence, pointwise operations between them).
2. **Bounded memory.** Every buffer you allocate besides the input and the output has at most `maxTilePixels` pixels,
   and you report it through `onBuffer`. Tiles report their rectangles through `onTile`; the written rectangles cover
   the image exactly once.
3. **Wide blurs.** A blur may be too wide for any tile within the budget to contain its neighbourhood (for example σ of
   hundreds of pixels with a budget of 128 × 128). Such chains must still complete within the budget; an
   approximation is then acceptable if its error is at most 0.025 per pixel and 0.005 on average for images with
   values in [0, 1].
4. **Efficiency.** Overlap between tiles costs reads. When the total neighbourhood a chain needs is small compared with
   the budget, the input pixels read (the sum of `readW × readH` over tiles) must not exceed 3 × the image's pixels.
5. **Resolution.** The same chain on a scan of the same film at another resolution must give the same picture, scaled.

## Deliverables

The working rules in your instructions apply: the project lives in `project/`, the API module is
`project/src/index.ts`.
