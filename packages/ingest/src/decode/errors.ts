import { ChromobenchError } from '@chromobench/contract';

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

