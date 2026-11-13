// The orientation of frames cut from a strip of film (CHB-031 F20, F28). The recipe's view.frame.orientation is one
// of the eight orientations of a rectangle (contract 0.3, applied by output.frame after the crop); Frame ▸ Rotate
// Left / Right / Flip change it per frame (cb.ts, the finish kit's orientFrame).
import type { Box, Orientation } from '@chromobench/contract';

/**
 * The default orientation of the frames cut from a strip (F20, F28). The photographer scans his strips running top
 * to bottom, through the base (mirrored) and upside down, so wide frames on a vertical strip open `flipV`: a picture
 * taken with the camera held level reads upright and unmirrored. Checked on his Epson scans against Negative Lab
 * Pro's positives (2025-08-09 raw000 frame 2: flipV; raw013 frame 2, a portrait: transverse) and by eye on the
 * frames of five strips (CHB-031 diary 04): most are landscape. A picture taken with the camera turned (a portrait)
 * opens sideways either way round (raw010's frames: transpose, raw013's: transverse); nothing in the strip's
 * geometry says how the camera was held, so Frame ▸ Rotate turns that frame, and its library entry keeps it.
 * A strip running left to right, and frames taller than wide on a vertical strip, stay as scanned.
 */
export function stripOrientation(boxes: readonly Box[]): Orientation {
  if (boxes.length < 2) return 'none';
  const spread = (v: number[]): number => Math.max(...v) - Math.min(...v);
  const vertical = spread(boxes.map(b => b.y + b.h / 2)) > spread(boxes.map(b => b.x + b.w / 2));
  const wide = boxes.filter(b => b.w > b.h).length > boxes.length / 2;
  return vertical && wide ? 'flipV' : 'none';
}
