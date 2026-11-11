import { ChromobenchError, diag, type Diagnostic } from '@chromobench/contract';

/** An E_FORMAT error naming the unsupported or malformed feature (goja-cv's FormatError). */
export function formatError(message: string, hint?: string): never {
  throw new ChromobenchError({ code: 'E_FORMAT', message, ...(hint ? { hint } : {}) });
}

/** E_FORMAT for a file that LibRaw should decode; the registry catches it and reroutes. */
export class NeedsLibRaw extends ChromobenchError {
  readonly reason: string;
  constructor(reason: string) {
    super({ code: 'E_FORMAT', message: `${reason}: needs the LibRaw decoder`, hint: 'Camera RAW, CFA and JPEG-compressed DNG files are decoded by LibRaw (packages/ingest/src/libraw).' });
    this.reason = reason;
  }
}

export function note(code: 'W_ENCODING_ASSUMED' | 'W_ICC_IGNORED' | 'W_CLIPPED' | 'W_TRIPLET_SHIFT' | 'W_FLAT_SHAPE', message: string): Diagnostic {
  return diag(code, message);
}
