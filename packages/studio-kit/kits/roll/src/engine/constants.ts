// The roll kit's numbers in one place (CHB-020 guide §4.3: "decision on the analysis size and thresholds: open").
// Each is a guess until the photographer's own rolls (CHB-013's beta) say otherwise.

/** Long side of the analysis image: base, veil, σ and class shares are measured (and reported) at this size. */
export const ANALYSIS_LONG = 512;
/** Pixels analysed for a frame's integrated exposure (the demo's first print uses 200 000). */
export const EXPOSURE_PIXELS = 200_000;
/** Colour correction share of integrate-to-grey (core's default). */
export const ALPHA = 0.75;
/** First print: how far each frame's colour moves to the roll's mean colour (guide §6.3, open question 8.5). */
export const ROLL_CONSISTENCY = 0.5;
/** Top two stocks closer than this: the scan cannot tell them apart (W_ROLL_STOCK_AMBIGUOUS). Gold 200 and C200
 *  are 0.020 D apart (CHB-006 §2.3) and must count as ambiguous with a few thousandths of measurement error. */
export const STOCK_AMBIGUOUS_D = 0.025;
/** Blank share (at the analysis size) above which a frame is a probable under-exposure: a cull hint. */
export const UNDER_BLANK = 0.4;
/** Enlarger time grid: 10 s · 2^(k/6), clamped (the time slider's 1/6-stop grid, CHB-023). */
export const TIME_REF_S = 10;
export const TIME_MIN_S = 2;
export const TIME_MAX_S = 120;
/** Transaction ids of roll batches start with this, so a later match can tell them from hand edits. */
export const ROLL_TX = 'roll:';

/**
 * What a roll shares (CHB-037 P7, design §27): the fields of the scan medium that every scan of one piece of film has
 * in common — scanner, stock, format, flat field, open gate, and the measured flare (veil) and base. The roll record
 * holds them (`media.scan`); each frame's scan medium links to the roll (`{ link: { roll }, overrides }`), so a roll
 * change reaches every frame that has not overridden it, and divergence is the overrides. Not shared: the pitch and the
 * rebate (one frame's pixels), the geometry, dust, and every printing choice (paper, grade, mode, time, lights, pack:
 * the first print and the match set them per frame; a sync copies them).
 */
export const ROLL_FIELDS = ['scanner', 'stock', 'format', 'flat', 'openGate', 'flare', 'baseT'] as const;
export type RollField = (typeof ROLL_FIELDS)[number];
/** The document paths of the roll's fields. */
export const SHARED_PATHS = ROLL_FIELDS.map((f) => `stages.scan.medium.${f}` as const);
export type SharedPath = (typeof SHARED_PATHS)[number];
/** The roll field of a shared path (`stages.scan.medium.stock` → `stock`), or null. */
export const rollField = (p: string): RollField | null => {
  const f = /^stages\.scan\.medium\.(\w+)$/.exec(p)?.[1];
  return f && (ROLL_FIELDS as readonly string[]).includes(f) ? (f as RollField) : null;
};

/** Paths a "hand edit" touches: a frame with such a user entry is skipped by a match (guide §8.7). */
export const LIGHTS_PATHS = ['lights.params.logH', 'main.params.time_s'];
