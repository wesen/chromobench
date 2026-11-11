// Compatibility shim: the mock's temporary TIFF reader and writer are replaced by CHB-006's decoders
// (@chromobench/ingest). readTiff keeps its old shape (interleaved codes) for existing callers.
import { decodeTiff, isTiff, writeTiff16 } from '@chromobench/ingest';

export { isTiff, writeTiff16 };

export interface RawImage {
  width: number;
  height: number;
  samples: 1 | 3;
  bits: 8 | 16;
  /** Interleaved samples, row-major. */
  data: Uint16Array;
}

/** Stored integer codes of an 8/16-bit grey or RGB TIFF, interleaved (decoded by @chromobench/ingest). */
export function readTiff(bytes: Uint8Array): RawImage {
  const img = decodeTiff(bytes);
  if (img.sample !== 'uint' || img.bits === 32) throw new Error('readTiff: 8/16-bit integer TIFF expected; use @chromobench/ingest for others');
  const samples = img.channels === 1 ? 1 : 3;
  const n = img.width * img.height;
  const data = new Uint16Array(n * samples);
  for (let i = 0; i < n; i++) for (let k = 0; k < samples; k++) data[i * samples + k] = img.planes[k]![i]!;
  return { width: img.width, height: img.height, samples, bits: img.bits as 8 | 16, data };
}
