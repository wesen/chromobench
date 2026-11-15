// Diagnostics and error codes. Every code has one meaning and one owner.
// Shape follows goja-cv pkg/cv/graph/errors.go and the architecture doc §5.5.
// One error class (contract 1.0): ChromobenchError extends @chromobench/values' ValueError, so an error thrown by
// the builder core (paths, mutations, documents) and one thrown by the contract are the same thing to a caller.
import { ValueError } from '@chromobench/values';

export interface Diagnostic {
  code: string;
  message: string;
  /** `file`: the module the line is in (a studio variant's file; contract 0.3, CHB-016). */
  where?: { line: number; col?: number; file?: string };
  path?: string;
  hint?: string;
  /** Literal code or value the caller can paste. */
  fix?: string;
  valid?: string[];
}

/**
 * The closed list of codes. Owners in comments. Codes starting with `W_` and the bare
 * upper-case words (RANGE, SHOWS, …) are warnings; `E_` codes and the JavaScript error names
 * (SyntaxError, ReferenceError, TypeError, RangeError, Error; CHB-007, contract 0.2) are errors.
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
  E_PATH: 'A path does not resolve or addresses nothing settable; siblings in valid.',
  E_READONLY: 'Agent mutation while the agent is read-only.',
  E_STALE: 'A pending transaction no longer applies as proposed (its inverses changed).',
  E_DOCUMENT: 'The document does not validate (format 3: stages, media, entries, masks, references).',
  E_MUTATION: 'A structural mutation is invalid (duplicate id, unknown id, position, cycle).',
  E_LINK: 'A link cannot be resolved (unknown roll, look or preset, or no resolver for its kind).',
  // the agent's workbench (CHB-037 P6b)
  E_WORKBENCH: 'The workbench refused: no workbench in this session, an unknown command or selector, or a command that failed.',
  E_LAYOUT: 'An agent-written layout cannot be built (a lambda where a selector, path or command id belongs; an unknown builder; a build error).',
  E_BINDING: 'A binding is unknown, reads a cut that is not upstream of its stage, or lacks its measurement.',
  E_CUT: 'No such cut, or the document has none of that name (a scan cut of a camera file).',
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
  // JavaScript exceptions from agent code keep their names (CHB-007 R1, contract 0.2)
  SyntaxError: 'The agent code does not parse; where.line points at it.',
  ReferenceError: 'An undefined name; the hint says whether mem or a missing timer is the cause.',
  TypeError: 'A JavaScript type error in agent code.',
  RangeError: 'A JavaScript range error in agent code.',
  Error: 'The agent code threw a plain Error (or a non-Error value).',
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
  W_DECODE_NOTE: 'A fact about how the source was decoded (mode, levels applied, channel dropped); informational (CHB-006 #1, contract 0.2).',
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
  // roll workflow (CHB-020) and ingest's film layout (CHB-006), contract 0.3
  W_ROLL_MIXED: "A frame's base is beyond 0.03 D of the roll's: probably another film on the roll.",
  W_ROLL_STOCK_AMBIGUOUS: 'The top two stocks of the ranking are within 0.025 D.',
  W_ROLL_BASE_WEAK: 'No confident rebate on the roll; the roll base is uncertain.',
  W_FRAME_DIVERGES: "A frame differs from the roll's value on a shared path.",
  W_NO_SURROUND: 'No opaque holder in view: the scanner veil (flare) is not measured on this frame.',
  W_SURROUND_BRIGHT: 'The holder is bright: probably not opaque, or very high flare.',
  W_REBATE_BLANK: 'No film edge beside the frame: the base was read on blank film inside it (low confidence).',
  W_NO_REBATE: 'No rebate (film edge or blank film) was found.',
  W_NO_FILM: 'No film was found in the image.',
  W_VEIL_FROM_ROLL: "No holder on this frame: the roll's veil was subtracted instead.",
  SHOWS: 'Too many images shown; extra images dropped.',
  CUT: 'Output truncated.',
  UNHANDLED: 'Unhandled promise rejection in the eval.',
  EDITS_DROPPED: 'Edits were dropped.',
  CONFLICT: 'A conflicting edit happened meanwhile.',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * values' ValueError typed with the contract's wider Diagnostic (any code of ERROR_CODES, `where`, `fix`). The
 * runtime class is ValueError itself: `e instanceof ValueError` holds for every contract error.
 */
const DiagnosticError = ValueError as unknown as new (diag: Diagnostic) => Error & { readonly diag: Diagnostic; readonly code: string };

export class ChromobenchError extends DiagnosticError {
  constructor(diag: Diagnostic) {
    super(diag);
    this.name = 'ChromobenchError';
  }
}

export function diag(code: ErrorCode, message: string, extra: Omit<Diagnostic, 'code' | 'message'> = {}): Diagnostic {
  return { code, message, ...extra };
}

export function fail(code: ErrorCode, message: string, extra: Omit<Diagnostic, 'code' | 'message'> = {}): never {
  throw new ChromobenchError(diag(code, message, extra));
}

/** Whether e is a contract or builder-core error (one class: both carry a Diagnostic in `diag`). */
export function isChromobenchError(e: unknown): e is ChromobenchError {
  return e instanceof ValueError;
}

/** Turns any thrown value into a Diagnostic (E_INTERNAL for foreign errors). */
export function toDiagnostic(e: unknown): Diagnostic {
  if (isChromobenchError(e)) return e.diag;
  if (e instanceof Error && e.name === 'AbortError') return diag('E_CANCELLED', e.message || 'cancelled');
  return diag('E_INTERNAL', e instanceof Error ? e.message : String(e));
}
