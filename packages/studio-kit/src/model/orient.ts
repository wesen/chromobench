// The orientation of frames cut from a strip of film (CHB-031 F20). The recipe's view.frame.orientation is one of
// the eight orientations of a rectangle (contract 0.3, applied by output.frame after the crop); Frame ▸ Rotate Left /
// Right / Flip change it per frame (cb.ts, the finish kit's orientFrame).
import type { Box, Orientation } from '@chromobench/contract';

/**
 * The default orientation of the frames cut from a strip (F20). Frames wider than tall on a strip that runs top to
 * bottom are sideways: the camera put the picture's long side across the film (a 6×4.5 camera whose film runs
 * sideways). They get a quarter turn — and a mirror, because a strip scanned through its base reads mirrored, as
 * the photographer's flatbed scans arrive. Checked on his raw010.dng: all three frames read upright and unmirrored
 * with it (a "Shipping & Receiving" sign, an EXIT sign). A strip running left to right, and frames taller than wide
 * on a vertical strip, stay as scanned.
 */
export function stripOrientation(boxes: readonly Box[]): Orientation {
  if (boxes.length < 2) return 'none';
  const spread = (v: number[]): number => Math.max(...v) - Math.min(...v);
  const vertical = spread(boxes.map(b => b.y + b.h / 2)) > spread(boxes.map(b => b.x + b.w / 2));
  const wide = boxes.filter(b => b.w > b.h).length > boxes.length / 2;
  return vertical && wide ? 'transpose' : 'none';
}
