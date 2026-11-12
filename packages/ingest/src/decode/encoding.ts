// Transfer functions and the encoding-evidence rules (guide §2.1, §5.2, DR-2).
import type { Diagnostic } from '@chromobench/contract';
import type { Encoding, EncodingEvidence } from './types.ts';

export const srgbDecode = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const gamma22Decode = (v: number): number => Math.max(v, 0) ** 2.2;

/** The transfer that turns an encoded value in [0, 1] into linear light. */
export function transferOf(enc: Encoding): (v: number) => number {
  return enc === 'srgb' ? srgbDecode : enc === 'gamma22' ? gamma22Decode : (v) => v;
}

/** Colour evidence a decoder found in the file (PNG chunks, chromobench metadata). */
export interface ColourEvidence {
  /** chromobench's own metadata key (PNG tEXt or TIFF ImageDescription). */
  metadata?: Encoding;
  srgbChunk?: boolean;
  /** PNG gAMA value (×100000). */
  gama?: number;
  iccp?: boolean;
}

/**
 * The §5.2 table. `declared` (from the recipe) always wins. 16-bit and float files with no colour
 * evidence are linear (with W_ENCODING_ASSUMED); 8-bit files with none are sRGB; LinearRaw DNG and
 * camera RAW are linear by format.
 */
export function chooseEncoding(o: {
  format: 'tiff' | 'dng' | 'png' | 'raw' | 'image';
  bits: number;
  sample: 'uint' | 'float';
  evidence: ColourEvidence;
  declared?: Encoding | undefined;
}): { value: Encoding; evidence: EncodingEvidence; notes: Diagnostic[] } {
  const notes: Diagnostic[] = [];
  if (o.declared) return { value: o.declared, evidence: 'declared', notes };
  const e = o.evidence;
  if (e.metadata) return { value: e.metadata, evidence: 'metadata', notes };
  if (o.format === 'dng' || o.format === 'raw') return { value: 'linear', evidence: 'format', notes };
  if (e.srgbChunk) return { value: 'srgb', evidence: 'chunk', notes };
  if (e.gama !== undefined) {
    if (Math.abs(e.gama - 100000) < 500) return { value: 'linear', evidence: 'chunk', notes };
    if (Math.abs(e.gama - 45455) < 500) return { value: 'srgb', evidence: 'chunk', notes };
  }
  if (e.iccp) {
    notes.push({ code: 'W_ICC_IGNORED', message: 'The file embeds an ICC profile; its tone curve is approximated by sRGB until CHB-011 can read it.' });
    return { value: 'srgb', evidence: 'chunk', notes };
  }
  if (o.bits >= 16 || o.sample === 'float') {
    notes.push({
      code: 'W_ENCODING_ASSUMED',
      message: `${o.bits}-bit ${o.format.toUpperCase()} without colour metadata: assumed linear.`,
      hint: 'If the file is sRGB-encoded, set source.decode.encoding to "srgb".',
      fix: 'source.decode.encoding = "srgb"',
    });
    return { value: 'linear', evidence: 'bit-depth', notes };
  }
  return { value: 'srgb', evidence: 'bit-depth', notes };
}

/** Parses chromobench metadata (`chromobench:encoding=linear` or JSON `{"chromobench":{"encoding":…}}`). */
export function parseChromobenchMeta(text: string): Encoding | undefined {
  const m = /chromobench[:.]encoding\s*=\s*(linear|srgb|gamma22)/.exec(text);
  if (m) return m[1] as Encoding;
  try {
    const j = JSON.parse(text) as { chromobench?: { encoding?: string } };
    const v = j.chromobench?.encoding;
    if (v === 'linear' || v === 'srgb' || v === 'gamma22') return v;
  } catch {
    // not JSON
  }
  return undefined;
}
