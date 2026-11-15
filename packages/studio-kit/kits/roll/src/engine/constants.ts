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
 * Settings shared by every frame of a roll (decision record 1: copied into each document, tracked by the roll; phase 7
 * turns them into a roll link on the media). The scan medium's flare and baseT are the roll's measured veil and
 * base; a frame whose base the analysis flags as mixed keeps its own baseT. Not shared: the rebate (a box in one
 * frame's pixels), the geometry, dust, the printer lights and the time (each frame's own exposure and colour),
 * darkroom layers and masks.
 */
export const SHARED_PATHS = [
  'stages.scan.medium.scanner',
  'stages.scan.medium.stock',
  'stages.scan.medium.format',
  'stages.scan.medium.flat',
  'stages.scan.medium.openGate',
  'stages.scan.medium.flare',
  'stages.scan.medium.baseT',
  'stages.darkroom.medium.paper',
  'stages.darkroom.medium.aim',
  'stages.darkroom.medium.mode',
  'stages.darkroom.medium.lamp',
  'main.params.filtration',
  'main.params.fstop',
  'stages.darkroom.medium.grade',
] as const;
export type SharedPath = (typeof SHARED_PATHS)[number];
/** The key of a shared path in a roll's fragment (a roll record is part of the main document, whose keys are never
 *  dotted paths): the path's last segment. */
export type SharedKey = 'scanner' | 'stock' | 'format' | 'flat' | 'openGate' | 'flare' | 'baseT' | 'paper' | 'aim' | 'mode' | 'lamp' | 'filtration' | 'fstop' | 'grade';
export const sharedKey = (p: SharedPath | string): SharedKey => p.split('.').pop() as SharedKey;

/** Paths a "hand edit" touches: a frame with such a user entry is skipped by a match (guide §8.7). */
export const LIGHTS_PATHS = ['lights.params.logH', 'main.params.time_s'];
