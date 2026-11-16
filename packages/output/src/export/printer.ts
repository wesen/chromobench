// Printer output (CHB-047 OUT-5; guide §5.8): the frame is rendered in a wide working space at 16 bits (ProPhoto, so
// nothing a print can show is clipped before the printer's own gamut mapping), then converted strip by strip by lcms
// from the working space's profile to the printer profile with the chosen intent and black point compensation, RGB_16
// in and out, and the printer profile is embedded in the file. Nothing follows the conversion but quantisation, so the
// knee-last rule holds (the working space's knee, then the profile's intent).
import type { OutputSpaceId } from '@chromobench/contract';
import { getSpace } from '../spaces.ts';
import type { Intent, Lcms } from '../icc/lcms/api.ts';
import { parseIcc } from '../icc/parse.ts';

/** What the export runner needs for a printer file (ExportRequest.printer). */
export interface PrinterOut {
  /** The printer profile, embedded in the file instead of the working space's. */
  icc: Uint8Array;
  sha256: string;
  description: string;
  /** Working-space 16-bit RGB of `pixels` pixels → the printer's 16-bit RGB. */
  convert(rgb16: Uint16Array, pixels: number): Promise<Uint16Array>;
}

export interface PrinterChoice {
  intent: Extract<Intent, 'perceptual' | 'relative'>;
  bpc: boolean;
  /** The working space rendered and converted from (default ProPhoto). */
  working?: OutputSpaceId;
}

/**
 * The conversion to a printer profile through `lcms` (a worker's or this thread's): `close()` lets the transform and
 * profiles go. The working space's profile is the bundled v4 profile the export would otherwise embed.
 */
export async function printerConversion(lcms: Lcms, printerIcc: Uint8Array, o: PrinterChoice): Promise<PrinterOut & { close(): Promise<void> }> {
  const p = parseIcc(printerIcc);
  const src = await lcms.open(getSpace(o.working ?? 'prophoto').icc);
  const dst = await lcms.open(printerIcc);
  const t = await lcms.transform(src, dst, { intent: o.intent, bpc: o.bpc, in: 'RGB_16', out: 'RGB_16' });
  return {
    icc: printerIcc, sha256: p.sha256, description: p.description || 'printer profile',
    async convert(rgb16, pixels) {
      return (await lcms.run(t, rgb16.slice(0, pixels * 3), pixels)) as Uint16Array;
    },
    async close() {
      await lcms.close(t);
      await lcms.close(src);
      await lcms.close(dst);
    },
  };
}
