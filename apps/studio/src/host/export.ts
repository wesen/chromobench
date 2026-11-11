// Export (CHB-023 stage 4): the committed print at the working resolution, as an 8-bit PNG encoded by
// the browser's canvas. One function so CHB-011's 16-bit TIFF/PNG encoders (packages/output) can
// replace `encodePng8` without touching the callers.
import { compile, type Engine, type FrameRecipe, type Graph, type OutputSpaceId, type SampleData } from '@chromobench/contract';

export type ExportSpace = Extract<OutputSpaceId, 'srgb' | 'display-p3'>;

export interface ExportedImage {
  blob: Blob;
  width: number;
  height: number;
  space: ExportSpace;
  fileName: string;
}

/** Display-encoded RGB (0…1 floats) → 8-bit PNG in `space`. Swap point for CHB-011's encoders. */
export async function encodePng8(data: SampleData, width: number, height: number, channels: number, space: ExportSpace): Promise<Blob> {
  const c = new OffscreenCanvas(width, height);
  const ctx = c.getContext('2d', { colorSpace: space }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no 2D canvas for PNG encoding');
  const px = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let k = 0; k < 3; k++) px[i * 4 + k] = Math.round(Math.min(1, Math.max(0, data[i * channels + Math.min(k, channels - 1)]!)) * 255);
    px[i * 4 + 3] = 255;
  }
  ctx.putImageData(new ImageData(px, width, height, { colorSpace: space }), 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}

/** Renders recipe r in export precision at full working resolution and encodes it. */
export async function exportPrint(engine: Engine, g: Graph, r: FrameRecipe, name: string, space: ExportSpace = 'srgb'): Promise<ExportedImage> {
  const node = compile(r, g, { displaySpace: space });
  engine.adopt(g.closure(node.id));
  const res = await engine.evaluate(node, { scale: 'full', precision: 'export' });
  const blob = await encodePng8(await res.read(), res.width, res.height, res.info.channels, space);
  const base = name.replace(/\.[^.]+$/, '');
  return { blob, width: res.width, height: res.height, space, fileName: `${base}-print${space === 'display-p3' ? '-p3' : ''}.png` };
}

/** Hands a blob to the browser as a download. */
export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
