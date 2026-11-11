// Decoder registry and routing (guide §5.3): sniff magic bytes and extensions, hand TIFF/LinearRaw DNG
// to tiff.ts, PNG to png.ts, camera RAW (and CFA/JPEG DNG) to an injected RawDecoder (LibRaw, stage 2),
// and anything else to the browser's 8-bit decoder as a last resort.
import { ChromobenchError, type DecodeOptions, type SourceInfo } from '@chromobench/contract';
import { formatError, NeedsLibRaw } from './errors.ts';
import { sourceSha256 } from './identity.ts';
import { linearise, type CameraLinear } from './linear.ts';
import { decodePng, isPng } from './png.ts';
import { decodeTiff, isTiff } from './tiff.ts';
import { chooseEncoding } from './encoding.ts';
import type { RawImage } from './types.ts';

/** Implemented by the LibRaw adapter (src/libraw). Injected so the M1 path never loads WASM (DR-3). */
export interface RawDecoder {
  readonly name: string;
  decode(bytes: Uint8Array, o: Partial<DecodeOptions>): Promise<RawImage>;
}

export const RAW_EXTENSIONS = ['raf', 'nef', 'nrw', 'cr2', 'cr3', 'crw', 'arw', 'srf', 'sr2', 'orf', 'rw2', 'pef', 'srw', 'x3f', 'iiq', '3fr', 'erf', 'mef', 'mos', 'kdc', 'dcr', 'rwl', 'arq'];

export type Route = 'tiff' | 'png16' | 'libraw' | 'browser';

export function sniff(head: Uint8Array, fileName = ''): Route {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  if (RAW_EXTENSIONS.includes(ext)) return 'libraw';
  const ascii = String.fromCharCode(...head.subarray(0, 16));
  if (ascii.startsWith('FUJIFILMCCD-RAW')) return 'libraw';
  if (ascii.slice(4, 12) === 'ftypcrx ') return 'libraw';
  if (head[0] === 0x49 && head[1] === 0x49 && (head[2] === 0x52 || head[2] === 0x55)) return 'libraw'; // ORF "IIRO/IIRS", RW2 "IIU"
  if (isTiff(head)) return 'tiff';
  if (isPng(head)) return 'png16';
  return 'browser';
}

export interface DecodeRequest {
  fileName?: string;
  options?: Partial<DecodeOptions>;
  raw?: RawDecoder | null;
}

/** Synchronous decode of TIFF, LinearRaw DNG and PNG. RAW files throw NeedsLibRaw. */
export function decodeSync(bytes: Uint8Array, req: DecodeRequest = {}): RawImage {
  const route = sniff(bytes, req.fileName);
  const declaredEncoding = req.options?.encoding;
  const o = declaredEncoding ? { declaredEncoding } : {};
  if (route === 'tiff') return decodeTiff(bytes, o);
  if (route === 'png16') return decodePng(bytes, o);
  if (route === 'libraw') throw new NeedsLibRaw(`camera RAW file${req.fileName ? ` ${req.fileName}` : ''}`);
  return formatError('unrecognised file format (not TIFF, DNG or PNG)', 'Open 8-bit JPEG/WebP through decodeAsync in a browser.');
}

export async function decodeAsync(bytes: Uint8Array, req: DecodeRequest = {}): Promise<RawImage> {
  const route = sniff(bytes, req.fileName);
  try {
    if (route !== 'libraw' && route !== 'browser') return decodeSync(bytes, req);
    if (route === 'browser') return await decodeBrowser(bytes, req.options?.encoding);
    throw new NeedsLibRaw(`camera RAW file${req.fileName ? ` ${req.fileName}` : ''}`);
  } catch (e) {
    if (!(e instanceof NeedsLibRaw)) throw e;
    if (!req.raw) {
      throw new ChromobenchError({ ...e.diag, hint: 'No LibRaw decoder is configured. Export a linear 16-bit TIFF (dcraw -4 -T, dcraw_emu, RawTherapee with a neutral linear profile) or enable the LibRaw worker.' });
    }
    return req.raw.decode(bytes, req.options ?? {});
  }
}

/** 8-bit last resort through createImageBitmap (browsers only). Always 8-bit, sRGB unless declared. */
export async function decodeBrowser(bytes: Uint8Array, declared?: DecodeOptions['encoding']): Promise<RawImage> {
  const g = globalThis as { createImageBitmap?: (b: Blob, o?: object) => Promise<ImageBitmap>; OffscreenCanvas?: typeof OffscreenCanvas };
  if (!g.createImageBitmap || !g.OffscreenCanvas) formatError('unrecognised file format, and no browser image decoder is available here');
  const bmp = await g.createImageBitmap(new Blob([bytes as BlobPart]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new g.OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const id = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const n = bmp.width * bmp.height;
  const planes = [0, 1, 2].map((k) => {
    const p = new Uint8Array(n);
    for (let i = 0; i < n; i++) p[i] = id[4 * i + k]!;
    return p;
  });
  const enc = chooseEncoding({ format: 'image', bits: 8, sample: 'uint', evidence: {}, declared });
  return {
    width: bmp.width, height: bmp.height, channels: 3, planes, sample: 'uint', bits: 8,
    levels: { black: [0, 0, 0], white: [255, 255, 255], from: 'default' },
    encoding: { value: enc.value, evidence: enc.evidence }, meta: { format: 'image', cfa: 'none', notes: enc.notes },
  };
}

/** SourceInfo for a decoded image (the contract's view of it). */
export function sourceInfo(sha256: string, img: RawImage, lin: CameraLinear | null, o: Partial<DecodeOptions> = {}): SourceInfo {
  const levels = o.levels ? { ...o.levels, from: 'declared' as const } : img.levels;
  const notes = [...img.meta.notes];
  const clippedFraction = lin?.clippedFraction ?? 0;
  if (clippedFraction > 0) notes.push({ code: 'W_CLIPPED', message: `${(clippedFraction * 100).toFixed(3)} % of pixels reach the white level.` });
  const info: SourceInfo = {
    sha256, format: img.meta.format, width: img.width, height: img.height, channels: img.channels, bits: img.bits, sample: img.sample,
    encoding: o.encoding ? { value: o.encoding, evidence: 'declared' } : img.encoding,
    levels, clippedFraction, notes,
  };
  if (img.meta.cfa) info.cfa = img.meta.cfa;
  if (img.meta.orientationTag !== undefined) info.orientationTag = img.meta.orientationTag;
  if (img.meta.camera) info.camera = img.meta.camera;
  return info;
}

export interface OpenedSource {
  sha256: string;
  raw: RawImage;
  linear: CameraLinear;
  info: SourceInfo;
}

function finish(bytes: Uint8Array, raw: RawImage, o: Partial<DecodeOptions>): OpenedSource {
  const sha256 = sourceSha256(bytes);
  const linear = linearise(raw, { sha256, encoding: o.encoding ?? raw.encoding.value, levels: o.levels, ir: o.ir });
  return { sha256, raw, linear, info: sourceInfo(sha256, raw, linear, o) };
}

/** Hash, decode and linearise TIFF/DNG/PNG synchronously. */
export function openSourceSync(bytes: Uint8Array, req: DecodeRequest = {}): OpenedSource {
  return finish(bytes, decodeSync(bytes, req), req.options ?? {});
}

/** Hash, decode (any route) and linearise. */
export async function openSource(bytes: Uint8Array, req: DecodeRequest = {}): Promise<OpenedSource> {
  return finish(bytes, await decodeAsync(bytes, req), req.options ?? {});
}
