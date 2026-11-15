// output.frame's straightening (contract 0.3, CHB-022): the reference sampling every engine and host uses, so
// a straightened crop is the same pixels everywhere. Order: the crop box (document px of the un-oriented frame)
// is cut out with its content rotated about the box centre, then the orientation is applied (by the caller).
import type { Orientation } from './document.ts';
import type { Box } from './spec.ts';

/** Mirrored orientations reverse the turn: angle_deg is clockwise as shown, after the orientation. */
export const sensorAngleSign = (o: Orientation | string): 1 | -1 => (o === 'flipH' || o === 'flipV' || o === 'transpose' || o === 'transverse' ? -1 : 1);

/** Source-pixel bounding box a straightened crop reads (bilinear, one pixel of margin), clamped to the frame. */
export function straightenFootprint(crop: Box, angle_deg: number, frameW: number, frameH: number): Box {
  const t = (Math.abs(angle_deg) * Math.PI) / 180;
  const hw = (crop.w * Math.cos(t) + crop.h * Math.sin(t)) / 2 + 1;
  const hh = (crop.w * Math.sin(t) + crop.h * Math.cos(t)) / 2 + 1;
  const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
  const x0 = Math.max(0, Math.floor(cx - hw)), y0 = Math.max(0, Math.floor(cy - hh));
  const x1 = Math.min(frameW, Math.ceil(cx + hw)), y1 = Math.min(frameH, Math.ceil(cy + hh));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * The crop box with its content turned by angle_deg (clockwise as shown for `orientation`), before orientation.
 * `src` is an interleaved c-channel image of size sw × sh whose pixel (0, 0) is frame pixel (origin.x, origin.y);
 * `frameW × frameH` is the whole frame. Output pixel (i, j) samples the frame bilinearly at
 * centre + R(θ)·(i + ½ − w/2, j + ½ − h/2), θ = −sign·angle; a sample outside the frame is 0 (empty corner).
 */
export function straighten(
  src: ArrayLike<number>, sw: number, sh: number, c: number, origin: { x: number; y: number },
  frameW: number, frameH: number, crop: Box, angle_deg: number, orientation: Orientation | string,
): Float64Array {
  const out = new Float64Array(crop.w * crop.h * c);
  const th = (-sensorAngleSign(orientation) * angle_deg * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
  const at = (x: number, y: number, k: number): number => {
    const lx = Math.min(sw - 1, Math.max(0, x - origin.x)), ly = Math.min(sh - 1, Math.max(0, y - origin.y));
    return src[(ly * sw + lx) * c + k]!;
  };
  for (let j = 0; j < crop.h; j++) {
    for (let i = 0; i < crop.w; i++) {
      const u = i + 0.5 - crop.w / 2, v = j + 0.5 - crop.h / 2;
      const px = cx + u * cos - v * sin, py = cy + u * sin + v * cos;
      const o = (j * crop.w + i) * c;
      if (px < 0 || py < 0 || px > frameW || py > frameH) continue;
      const fx = px - 0.5, fy = py - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const xa = Math.max(0, x0), xb = Math.min(frameW - 1, x0 + 1), ya = Math.max(0, y0), yb = Math.min(frameH - 1, y0 + 1);
      for (let k = 0; k < c; k++) {
        out[o + k] = (1 - ty) * ((1 - tx) * at(xa, ya, k) + tx * at(xb, ya, k)) + ty * ((1 - tx) * at(xa, yb, k) + tx * at(xb, yb, k));
      }
    }
  }
  return out;
}
