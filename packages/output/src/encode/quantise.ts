// Quantisation: encoded [0, 1] values to 16-bit codes, and 16-bit codes to 8 bits with a small
// triangular dither keyed on the pixel position (deterministic, so tiled and one-pass exports agree).

/** round(clamp(v, 0, 1) · 65535): what WGSL's pack2x16unorm computes. */
export function toU16(src: ArrayLike<number>, channelsIn: number, w: number, h: number, out = new Uint16Array(w * h * 3)): Uint16Array {
  for (let i = 0; i < w * h; i++) {
    for (let k = 0; k < 3; k++) {
      const v = src[i * channelsIn + Math.min(k, channelsIn - 1)]!;
      out[i * 3 + k] = v >= 1 ? 65535 : v > 0 ? Math.round(v * 65535) : 0;
    }
  }
  return out;
}

function hash3(x: number, y: number, c: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(c + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 16-bit code → 8-bit code with TPDF dither of ±1 LSB, at frame position (x, y), channel c. */
export function ditherTo8(v16: number, x: number, y: number, c: number): number {
  const r = hash3(x, y, c);
  const t = ((r & 0xffff) + (r >>> 16)) / 65536 - 1; // triangular on (−1, 1)
  const v = Math.round(v16 / 257 + 0.5 * t);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
