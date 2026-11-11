// Scan mode (guide §5.4, DR-5): linear camera channels straight from the CFA mosaic, with our own black
// (black + cblack[col] + cblack pattern), white normalisation and CFA binning; no white balance, no
// matrix, no demosaicing. Pure TypeScript, so it is tested without the WASM build.
import { formatError } from '../decode/errors.ts';
import type { RawImage } from '../decode/types.ts';
import type { RawInfo } from './protocol.ts';

/** LibRaw colour index (0 R, 1 G, 2 B, 3 second G) → channel. */
export const CHANNEL_OF = [0, 1, 2, 1] as const;

export interface Mosaic {
  data: Uint16Array;
  /** Row stride in samples (raw width). */
  stride: number;
  info: RawInfo;
}

/** Black level of photosite (r, c) of the visible area, native units. */
export function photositeBlack(info: RawInfo, col: number, r: number, c: number): number {
  const base = info.black[col] ?? info.black[0]!;
  const p = info.blackPattern;
  if (!p || !p.rows || !p.cols) return base;
  return base + p.values[(r % p.rows) * p.cols + (c % p.cols)]!;
}

/**
 * Bins the visible mosaic. 'cfa': one pixel per CFA period (Bayer 2×2 → R, mean G, B; X-Trans 6×6 →
 * means of 8 R, 20 G, 8 B). 'cfa-half': X-Trans 3×3 (2 R, 5 G, 2 B); Bayer as 'cfa'. 'none': one plane of
 * black-subtracted photosites plus the CFA map. Values are black-subtracted native units; levels are
 * black 0 and white (white − black) per channel, so linearise maps the white level to 1. A binned
 * pixel is clipped if any of its photosites reached the white level (or the per-channel linear max).
 */
export function scanMode(m: Mosaic, bin: 'none' | 'cfa' | 'cfa-half' = 'cfa'): RawImage {
  const { info } = m;
  const { x: vx, y: vy, w: vw, h: vh } = info.visible;
  const { period, map, kind } = info.cfa;
  if (kind === 'none') formatError('scan mode: the file has no CFA (use the full-colour path)');
  const colOf = (r: number, c: number): number => map[(r % period) * period + (c % period)]!;
  const clipAt = (col: number): number => {
    const lm = info.linearMax?.[col];
    return lm && lm > 0 ? Math.min(lm, info.white) : info.white;
  };
  const black3 = [0, 1, 2].map((ch) => {
    // mean black over the photosites of this channel in one period (for the reported levels)
    let s = 0, n = 0;
    for (let r = 0; r < period; r++) for (let c = 0; c < period; c++) {
      const col = colOf(r, c);
      if (CHANNEL_OF[col as 0] !== ch) continue;
      s += photositeBlack(info, col, r, c); n++;
    }
    return n ? s / n : info.black[0]!;
  });
  const notes = [{ code: 'W_DECODE_NOTE', message: `LibRaw scan mode: raw channels, black (${black3.map((b) => b.toFixed(1)).join(', ')}) and white ${info.white} applied per photosite; no white balance, no matrix.` }];
  if (bin === 'none') {
    const out = new Float32Array(vw * vh);
    const clipped = new Uint8Array(vw * vh);
    for (let r = 0; r < vh; r++) for (let c = 0; c < vw; c++) {
      const u = m.data[(r + vy) * m.stride + c + vx]!;
      const col = colOf(r, c);
      out[r * vw + c] = u - photositeBlack(info, col, r, c);
      if (u >= clipAt(col)) clipped[r * vw + c] = 1;
    }
    const span = info.white - (black3[0]! + black3[1]! + black3[2]!) / 3;
    return {
      width: vw, height: vh, channels: 1, planes: [out], sample: 'float', bits: 32,
      levels: { black: [0], white: [span], from: 'libraw' }, encoding: { value: 'linear', evidence: 'format' },
      meta: { format: 'raw', cfa: kind, clipped, cfaMap: { period, map: map.map((v) => CHANNEL_OF[v as 0]) }, notes },
    };
  }
  const b = kind === 'xtrans' && bin === 'cfa-half' ? 3 : period;
  const W = Math.floor(vw / b), H = Math.floor(vh / b);
  const planes = [0, 1, 2].map(() => new Float32Array(W * H));
  const clipped = new Uint8Array(W * H);
  const s = [0, 0, 0], n = [0, 0, 0];
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    s[0] = s[1] = s[2] = 0; n[0] = n[1] = n[2] = 0;
    let clip = 0;
    for (let dr = 0; dr < b; dr++) for (let dc = 0; dc < b; dc++) {
      const r = Y * b + dr, c = X * b + dc;
      const u = m.data[(r + vy) * m.stride + c + vx]!;
      const col = colOf(r, c);
      const ch = CHANNEL_OF[col as 0];
      s[ch]! += u - photositeBlack(info, col, r, c);
      n[ch]!++;
      if (u >= clipAt(col)) clip = 1;
    }
    for (let k = 0; k < 3; k++) {
      if (!n[k]) formatError(`scan mode: a ${b}×${b} block holds no photosite of channel ${k}`);
      planes[k]![Y * W + X] = s[k]! / n[k]!;
    }
    clipped[Y * W + X] = clip;
  }
  return {
    width: W, height: H, channels: 3, planes, sample: 'float', bits: 32,
    levels: { black: [0, 0, 0], white: black3.map((bl) => info.white - bl), from: 'libraw' },
    encoding: { value: 'linear', evidence: 'format' },
    meta: { format: 'raw', cfa: kind, clipped, notes },
  };
}
