// Synthetic scenes for the end-to-end walkthroughs and the persona session (CHB-037 P9). Nothing here comes from
// the photographer's material: a landscape drawn from formulas — a sky that brightens towards the horizon, a sun,
// hills, a house with a red door, grass texture — rendered as a colour negative scan (orange base, a film edge at
// the left) and as a camera RAW (an RGGB Bayer DNG that LibRaw decodes in its worker).
import { writeTiff } from '@chromobench/ingest';

type Planes = [Uint16Array, Uint16Array, Uint16Array];

/** Scene light in linear RGB at (u, v) ∈ [0, 1]² (v down). */
function light(u: number, v: number): [number, number, number] {
  const horizon = 0.55 + 0.06 * Math.sin(u * 7.0) + 0.03 * Math.sin(u * 23.0);
  if (v < horizon) {
    // sky: deep blue at the top, pale at the horizon; a sun upper right; two soft clouds
    const t = v / horizon;
    let c: [number, number, number] = [0.18 + 0.5 * t, 0.3 + 0.45 * t, 0.65 + 0.25 * t];
    const ds = Math.hypot(u - 0.78, v - 0.18);
    if (ds < 0.05) c = [1.6, 1.5, 1.2];
    else c = c.map((x) => x + 0.5 * Math.exp(-((ds - 0.05) ** 2) / 0.004)) as [number, number, number];
    const cloud = Math.exp(-(((u - 0.3) / 0.12) ** 2 + ((v - 0.22) / 0.04) ** 2)) + Math.exp(-(((u - 0.52) / 0.09) ** 2 + ((v - 0.3) / 0.03) ** 2));
    return c.map((x) => x + 0.55 * cloud) as [number, number, number];
  }
  // a house: white wall, a red door, a dark window
  if (u > 0.2 && u < 0.38 && v > horizon - 0.12 && v < horizon + 0.12) {
    if (u > 0.27 && u < 0.31 && v > horizon + 0.02) return [0.45, 0.05, 0.04];
    if (u > 0.22 && u < 0.26 && v > horizon - 0.08 && v < horizon - 0.02) return [0.03, 0.03, 0.04];
    return [0.62, 0.6, 0.55];
  }
  // ground: green grass with texture, darker towards the bottom (the foreground in shade)
  const g = 0.75 - 0.6 * ((v - horizon) / (1 - horizon));
  const tex = 0.85 + 0.15 * Math.sin(u * 310 + v * 170) * Math.sin(u * 97 - v * 233);
  return [0.08 * g * tex, 0.22 * g * tex, 0.05 * g * tex];
}

function scene(W: number, H: number): Planes {
  const planes = [0, 1, 2].map(() => new Uint16Array(W * H)) as Planes;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = light(x / W, y / H);
    for (let k = 0; k < 3; k++) planes[k]![y * W + x] = Math.round(65535 * Math.min(1, c[k]! / 1.6));
  }
  return planes;
}

/** The scene on colour negative film, scanned: densities from log exposure, an orange base, a film edge at x < edge. */
export function negativeScan(W: number, H: number, o: { exposure?: number } = {}): Buffer {
  const base = [0.75, 0.42, 0.22];
  const edge = Math.max(4, Math.round(W / 40));
  const ev = o.exposure ?? 0;
  const planes = [0, 1, 2].map(() => new Uint16Array(W * H));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = light(x / W, y / H);
    for (let k = 0; k < 3; k++) {
      const logE = Math.log10(Math.max(1e-4, c[k]! * 2 ** ev));
      const d = x < edge ? 0 : Math.max(0, 0.15 + 0.62 * (logE + 2.2));
      planes[k]![y * W + x] = Math.round(65535 * 0.9 * base[k]! * 10 ** -(d * [0.9, 1, 1.1][k]!));
    }
  }
  return Buffer.from(writeTiff({ images: [{ width: W, height: H, planes, bits: 16, photometric: 2 }] }));
}

/** The scene through a camera: an RGGB Bayer DNG at twice the size (LibRaw demosaics it in photo mode). */
export function cameraDng(W: number, H: number): Buffer {
  const [r, g, b] = scene(W, H);
  const w = 2 * W, h = 2 * H;
  const raw = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y >> 1) * W + (x >> 1);
    const c = (y & 1) * 2 + (x & 1); // RGGB
    raw[y * w + x] = 512 + Math.round(((c === 0 ? r[i]! : c === 3 ? b[i]! : g[i]!) / 65535) * 14000);
  }
  return Buffer.from(writeTiff({
    images: [{ width: w, height: h, planes: [raw], bits: 16, photometric: 32803, newSubfileType: 0, rowsPerStrip: 256, tags: [
      { tag: 33421, type: 3, values: [2, 2] }, { tag: 33422, type: 1, values: [0, 1, 1, 2] }, { tag: 50710, type: 1, values: [0, 1, 2] },
      { tag: 50714, type: 3, values: [512] }, { tag: 50717, type: 3, values: [15000] }] }],
    ifd0Tags: [{ tag: 50706, type: 1, values: [1, 4, 0, 0] }, { tag: 271, type: 2, values: 'Synth' }, { tag: 272, type: 2, values: 'Camera' }, { tag: 50708, type: 2, values: 'Synth Camera' },
      { tag: 50721, type: 10, values: [0.8, -0.2, -0.05, -0.4, 1.2, 0.2, -0.05, 0.15, 0.6] }, { tag: 50778, type: 3, values: [21] }],
  }));
}

export const tif = (name: string, buffer: Buffer) => ({ name, mimeType: 'image/tiff', buffer });
export const dng = (name: string, buffer: Buffer) => ({ name, mimeType: 'image/x-adobe-dng', buffer });
