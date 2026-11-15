// Errors. A ValueError carries a diagnostic record with the same fields as the contract's Diagnostic (code,
// message, path, hint, valid), so a consumer can pass `e.diag` wherever a Diagnostic is expected.

/** The codes this package throws. They are the contract's codes of the same meaning, plus E_DOCUMENT. */
export const VALUE_ERROR_CODES = {
  E_PATH: 'A path does not resolve, or addresses something that cannot be set.',
  E_MUTATION: 'A structural mutation is invalid (duplicate or unknown id, a position out of range, a cycle).',
  E_DOCUMENT: 'The document is not well formed (a malformed collection, duplicate ids, an id that is a root key).',
  E_ARG_TYPE: 'A value is not JSON (a function, a class instance, undefined in an array, a typed array).',
  E_ARG_RANGE: 'A number is not finite.',
  E_INTERNAL: 'A value cannot be canonicalised (a typed array).',
} as const;

export type ValueErrorCode = keyof typeof VALUE_ERROR_CODES;

export interface ValueDiag {
  code: ValueErrorCode;
  message: string;
  path?: string;
  hint?: string;
  valid?: string[];
}

export class ValueError extends Error {
  readonly diag: ValueDiag;
  constructor(diag: ValueDiag) {
    super(`${diag.code}: ${diag.message}`);
    this.name = 'ValueError';
    this.diag = diag;
  }
  get code(): ValueErrorCode {
    return this.diag.code;
  }
}

export function fail(code: ValueErrorCode, message: string, extra: Omit<ValueDiag, 'code' | 'message'> = {}): never {
  throw new ValueError({ code, message, ...extra });
}
