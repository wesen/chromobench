// Diagnostics and error codes. Every code has one meaning and one owner.
// Shape follows goja-cv pkg/cv/graph/errors.go and the architecture doc §5.5.

export interface Diagnostic {
  code: string;
  message: string;
  where?: { line: number; col?: number };
  path?: string;
  hint?: string;
  /** Literal code or value the caller can paste. */
  fix?: string;
  valid?: string[];
}

/**
 * The closed list of codes. Owners in comments. Codes starting with `W_` and the bare
 * upper-case words (RANGE, LOOKS, …) are warnings; `E_` codes are errors.
 * A ticket adds codes through CHB-002's change process (CONTRACT-DECISIONS.md).
 */
export const ERROR_CODES = {
  // contract (CHB-002)
  E_UNKNOWN_OP: 'No such op or mutation op (did-you-mean in hint, names in valid).',
  E_UNKNOWN_OPTION: 'No such argument; fix holds the corrected call.',
  E_ARG_TYPE: 'Wrong argument type.',
  E_ARG_RANGE: 'Outside the hard range, or not finite; valid holds the range.',
  E_DOMAIN: 'Input domain not accepted by the op; hint names the op producing the right domain.',
  E_WRONG_KIND: 'A Value where an Image is required, or the reverse.',
  E_UNIT: 'Refused unit conversion or unit algebra (D + logH: Hunt 14.17).',
  E_KIND: 'Refused spectrum-kind algebra.',
  E_PATH: 'Unknown or non-settable recipe path; siblings in valid.',
  E_READONLY: 'Agent mutation while the agent is read-only.',
  E_STALE: "A pending mutation's expect no longer matches the recipe.",
  E_RECIPE: 'The recipe document does not validate.',
  E_MUTATION: 'A structural mutation is invalid (duplicate id, missing mask, …).',
  E_NO_SOURCE: 'source.open references a source the graph or engine has not opened.',
  E_NO_NODE: 'The engine does not know the node; adopt its closure first.',
  E_INVALID_OP_DEF: 'registerOp refused an op definition.',
  // engines (CHB-002 mock, CHB-003 reference, CHB-005 gpu)
  E_NOT_IMPLEMENTED: "The op is in the catalog but not in this engine's capabilities().ops.",
  E_EVAL: 'Kernel or evaluation failure.',
  E_INTERNAL: 'A bug.',
  E_CANCELLED: 'Cancelled through an AbortSignal or by the host.',
  E_TIMEOUT: 'Deadline exceeded.',
  E_FORMAT: 'Unsupported or malformed file format (CHB-006).',
  // CHB-004 data packs
  E_STOCK_UNKNOWN: 'Unknown stock id; valid lists known ids.',
  E_DATA_HASH: 'Data pack content hash mismatch.',
  E_DATA_GRID: 'Data on an unexpected spectral grid.',
  E_DATA_SCHEMA: 'Data pack does not match its schema.',
  E_DATA_POLICY: 'Missing-data policy refused the request.',
  // CHB-005 gpu
  E_DEVICE_LOST: 'GPU device lost.',
  E_GPU_OOM: 'GPU out of memory.',
  E_KERNEL_COMPILE: 'WGSL compilation failed.',
  E_HALO_TOO_WIDE: 'A spatial kernel halo exceeds the tile budget.',
  // CHB-007 DSL sandbox
  E_NOT_AWAITED: 'A promise-returning call was not awaited.',
  E_IMMUTABLE: 'Attempt to modify an immutable handle or value.',
  E_UNKNOWN_METHOD: 'No such method on a handle.',
  E_NO_FRAME: 'The eval needs a frame and none is selected.',
  E_SANDBOX: 'Sandbox failure.',
  E_STALLED: 'The eval made no progress.',
  E_MEMORY: 'Sandbox memory limit exceeded.',
  // CHB-008 transports
  E_BUSY: 'Another eval is running.',
  E_SESSION: 'Session error.',
  E_SESSION_RESET: 'The session was reset.',
  E_NO_PAGE: 'No studio page is connected.',
  E_TOOL_INPUT: 'Malformed tool input.',
  // CHB-010 darkroom
  E_TOO_MANY_PACKS: 'Too many filter packs for one exposure.',
  // CHB-011 output
  E_SINK: 'Output sink failure.',
  E_ICC_INVALID: 'Invalid ICC profile.',
  E_ICC_CLASS: 'ICC profile of the wrong class for this use.',
  // warnings
  RANGE: 'Outside the soft usual range; hint holds usualHint.',
  W_DATA_PACK_CHANGED: 'The data pack differs from the one the frame was created with.',
  W_STOCK_KNOWN_ISSUE: 'The stock has a known data issue.',
  W_STOCK_NO_MODEL: 'The stock has no model for this quantity.',
  W_DATA_ILLUSTRATIVE: 'Illustrative (not measured) data in use.',
  W_ENCODING_ASSUMED: 'Source encoding was assumed.',
  W_ICC_IGNORED: 'An embedded ICC profile was ignored.',
  W_CLIPPED: 'Clipped samples in the source.',
  W_FLAT_SHAPE: 'Flat field has an unexpected shape.',
  W_NO_OPEN_GATE: 'No open-gate reference available.',
  W_REBATE_PERCENTILE: 'Rebate estimated from a percentile, not a picked box.',
  W_BASE_MISMATCH: 'Measured base differs from the stock model.',
  W_TRIPLET_SHIFT: 'Triplet parts are shifted against each other.',
  W_SIGMA_ASSUMED: 'Noise sigma was assumed.',
  W_ILL_CONDITIONED: 'Ill-conditioned solve.',
  W_DODGE_EXCEEDS_MAIN: 'A dodge exceeds the main exposure.',
  W_PREVIEW_APPROX: 'Result is an approximate preview.',
  LOOKS: 'Too many looks; extra looks dropped.',
  CUT: 'Output truncated.',
  UNHANDLED: 'Unhandled promise rejection in the eval.',
  EDITS_DROPPED: 'Edits were dropped.',
  CONFLICT: 'A conflicting edit happened meanwhile.',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ChromobenchError extends Error {
  readonly diag: Diagnostic;
  constructor(diag: Diagnostic) {
    super(`${diag.code}: ${diag.message}`);
    this.name = 'ChromobenchError';
    this.diag = diag;
  }
  get code(): string {
    return this.diag.code;
  }
}

export function diag(code: ErrorCode, message: string, extra: Omit<Diagnostic, 'code' | 'message'> = {}): Diagnostic {
  return { code, message, ...extra };
}

export function fail(code: ErrorCode, message: string, extra: Omit<Diagnostic, 'code' | 'message'> = {}): never {
  throw new ChromobenchError(diag(code, message, extra));
}

export function isChromobenchError(e: unknown): e is ChromobenchError {
  return e instanceof ChromobenchError;
}

/** Turns any thrown value into a Diagnostic (E_INTERNAL for foreign errors). */
export function toDiagnostic(e: unknown): Diagnostic {
  if (isChromobenchError(e)) return e.diag;
  if (e instanceof Error && e.name === 'AbortError') return diag('E_CANCELLED', e.message || 'cancelled');
  return diag('E_INTERNAL', e instanceof Error ? e.message : String(e));
}
