// The roll record (CHB-020 §6.2, contract 0.3): one per roll of film, persisted as `roll.json` beside the
// frames (CHB-013's fixture layout) and in the catalog. A frame names its roll in FrameRecipe.roll; the
// recipes hold plain copies of the shared settings, so divergence is computed, never stored.
import { diag, type Diagnostic } from './errors.ts';
import { fieldPattern } from './paths.ts';

/** File name of the roll sidecar beside the frames. */
export const ROLL_SIDECAR = 'roll.json';

/** Shared recipe settings of a roll: settable recipe path → value (roll setup writes them to every frame). */
export type RollFragment = Readonly<Record<string, unknown>>;

export type RollStatus = 'imported' | 'analysed' | 'set-up' | 'first-printed' | 'balanced';
export const ROLL_STATUSES: readonly RollStatus[] = ['imported', 'analysed', 'set-up', 'first-printed', 'balanced'];

/**
 * A roll. `A` is the analysis record (the roll kit's RollAnalysis: measured data keyed by source hash and the
 * settings it was computed under); the contract keeps it opaque. `match.batch` is the LoggedMutation.batch id
 * of the last "print the roll like this frame".
 */
export interface Roll<A = unknown, F extends RollFragment = RollFragment> {
  id: string;
  label: string;
  /** Frame ids (FrameRecipe.frame), in roll order. */
  frames: string[];
  fragment: F;
  analysis: A | null;
  /** The reference frame of the roll balance. */
  reference: string | null;
  match: { alpha: number; appliedAt: number; batch: string } | null;
  status: RollStatus;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates a roll record's shape and that every fragment key is a settable recipe path. Empty = valid. */
export function validateRoll(x: unknown): Diagnostic[] {
  if (!isObj(x)) return [diag('E_RECIPE', 'roll must be an object')];
  const out: Diagnostic[] = [];
  if (typeof x['id'] !== 'string' || !x['id']) out.push(diag('E_RECIPE', 'roll id must be a non-empty string', { path: 'id' }));
  if (typeof x['label'] !== 'string') out.push(diag('E_RECIPE', 'roll label must be a string', { path: 'label' }));
  if (!Array.isArray(x['frames']) || !x['frames'].every((f) => typeof f === 'string')) out.push(diag('E_RECIPE', 'roll frames must be frame ids', { path: 'frames' }));
  if (!isObj(x['fragment'])) out.push(diag('E_RECIPE', 'roll fragment must be an object of recipe paths', { path: 'fragment' }));
  else for (const p of Object.keys(x['fragment'])) if (!fieldPattern(p)) out.push(diag('E_PATH', `roll fragment: unknown recipe path ${p}`, { path: `fragment.${p}` }));
  if (x['reference'] !== null && typeof x['reference'] !== 'string') out.push(diag('E_RECIPE', 'roll reference must be a frame id or null', { path: 'reference' }));
  const m = x['match'];
  if (m !== null && !(isObj(m) && typeof m['alpha'] === 'number' && typeof m['appliedAt'] === 'number' && typeof m['batch'] === 'string')) {
    out.push(diag('E_RECIPE', 'roll match must be {alpha, appliedAt, batch} or null', { path: 'match' }));
  }
  if (!ROLL_STATUSES.includes(x['status'] as RollStatus)) out.push(diag('E_RECIPE', `roll status must be one of ${ROLL_STATUSES.join(', ')}`, { path: 'status', valid: [...ROLL_STATUSES] }));
  return out;
}
