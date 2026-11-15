// output.frame (contract 1.0: the document geometry, design §20), the f64 reference: the crop box in document pixels
// of the un-oriented frame, its content straightened about the box centre by the contract's reference sampling
// (straighten, frame.ts), then the orientation. Every engine implements it, so the display cut needs no host module.
import { straighten, type Box, type Orientation } from '@chromobench/contract';

/** True when an orientation swaps width and height. */
export const swapsAxes = (o: Orientation | string): boolean => o === 'cw90' || o === 'ccw90' || o === 'transpose' || o === 'transverse';

/** Reorients interleaved pixels (w × h, c channels) for display: output pixel (x′, y′) reads input (x, y). */
export function orientPixels(o: Orientation | string, src: ArrayLike<number>, w: number, h: number, c: number): { data: Float64Array; width: number; height: number } {
  const [W, H] = swapsAxes(o) ? [h, w] : [w, h];
  const out = new Float64Array(W * H * c);
  for (let y2 = 0; y2 < H; y2++) {
    for (let x2 = 0; x2 < W; x2++) {
      let x = x2, y = y2;
      switch (o) {
        case 'flipH': x = w - 1 - x2; break;
        case 'flipV': y = h - 1 - y2; break;
        case 'rot180': x = w - 1 - x2; y = h - 1 - y2; break;
        case 'cw90': x = y2; y = h - 1 - x2; break;
        case 'ccw90': x = w - 1 - y2; y = x2; break;
        case 'transpose': x = y2; y = x2; break;
        case 'transverse': x = w - 1 - y2; y = h - 1 - x2; break;
        default: break;
      }
      const i = (y * w + x) * c, j = (y2 * W + x2) * c;
      for (let k = 0; k < c; k++) out[j + k] = src[i + k]!;
    }
  }
  return { data: out, width: W, height: H };
}

/** The crop box of a w × h frame (whole frame when absent), copied without resampling. */
export function cropPixels(src: ArrayLike<number>, w: number, c: number, b: Box): Float64Array {
  const out = new Float64Array(b.w * b.h * c);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) for (let k = 0; k < c; k++) out[(y * b.w + x) * c + k] = src[((b.y + y) * w + b.x + x) * c + k]!;
  return out;
}

/** output.frame on a whole w × h image: crop (straightened when angle_deg ≠ 0), then orientation. */
export function frameImage(src: ArrayLike<number>, w: number, h: number, c: number, geo: { orientation: Orientation | string; angle_deg: number; crop?: Box | undefined }): { data: Float64Array; width: number; height: number } {
  const b = geo.crop ?? { x: 0, y: 0, w, h };
  const inner = geo.angle_deg !== 0
    ? straighten(src, w, h, c, { x: 0, y: 0 }, w, h, b, geo.angle_deg, geo.orientation)
    : cropPixels(src, w, c, b);
  return orientPixels(geo.orientation, inner, b.w, b.h, c);
}
