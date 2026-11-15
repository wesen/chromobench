// The roll record (CHB-020 §6.2; contract 1.0, design §27): one per roll of film, persisted as `roll.json` beside the
// frames and in the catalog. A roll holds partial media and stacks (the scanner and stock of all its scans, a shared
// base, a shared dust group); each frame's media and link entries name it (`{ link: { roll }, overrides }`), so a
// roll change reaches every frame that has not overridden it, and "divergence from the roll" is the overrides list
// (links.ts: linkMedium, divergence, followLink).
import { Coll, isPlainObject, type JsonObject } from '@chromobench/values';
import { STAGE_NAMES, type Entry, type StageName } from './document.ts';
import { diag, type Diagnostic } from './errors.ts';

/** File name of the roll sidecar beside the frames. */
export const ROLL_SIDECAR = 'roll.json';

export type RollStatus = 'imported' | 'analysed' | 'set-up' | 'first-printed' | 'balanced';
export const ROLL_STATUSES: readonly RollStatus[] = ['imported', 'analysed', 'set-up', 'first-printed', 'balanced'];

/**
 * A roll. `A` is the analysis record (the roll kit's RollAnalysis), opaque to the contract. `match.batch` is the
 * transaction batch id of the last "print the roll like this frame".
 */
export interface Roll<A = unknown> {
  id: string;
  label: string;
  /** Frame ids (Document.frame), in roll order. */
  frames: string[];
  /** Partial media per stage: the fields the roll's frames share. */
  media: Partial<Record<StageName, JsonObject>>;
  /** Shared stacks per stage (a dust group, a base exposure): link entries `{ roll }` expand to them. */
  stacks: Partial<Record<StageName, Coll<Entry>>>;
  analysis: A | null;
  /** The reference frame of the roll balance. */
  reference: string | null;
  match: { alpha: number; appliedAt: number; batch: string } | null;
  status: RollStatus;
}

/** Validates a roll record's shape (media are checked when a frame resolves them). Empty = valid. */
export function validateRoll(x: unknown): Diagnostic[] {
  if (!isPlainObject(x)) return [diag('E_DOCUMENT', 'roll must be an object')];
  const out: Diagnostic[] = [];
  if (typeof x['id'] !== 'string' || !x['id']) out.push(diag('E_DOCUMENT', 'roll id must be a non-empty string', { path: 'id' }));
  if (typeof x['label'] !== 'string') out.push(diag('E_DOCUMENT', 'roll label must be a string', { path: 'label' }));
  if (!Array.isArray(x['frames']) || !x['frames'].every((f) => typeof f === 'string')) out.push(diag('E_DOCUMENT', 'roll frames must be frame ids', { path: 'frames' }));
  for (const key of ['media', 'stacks'] as const) {
    const v = x[key];
    if (!isPlainObject(v)) {
      out.push(diag('E_DOCUMENT', `roll ${key} must be an object keyed by stage`, { path: key }));
      continue;
    }
    for (const [s, m] of Object.entries(v)) {
      if (!STAGE_NAMES.includes(s as StageName)) out.push(diag('E_DOCUMENT', `roll ${key}: unknown stage ${s}`, { path: `${key}.${s}`, valid: [...STAGE_NAMES] }));
      else if (key === 'media' && !isPlainObject(m)) out.push(diag('E_DOCUMENT', `roll media.${s} must be an object`, { path: `media.${s}` }));
      else if (key === 'stacks' && Coll.problem(m)) out.push(diag('E_DOCUMENT', `roll stacks.${s}: ${Coll.problem(m)}`, { path: `stacks.${s}` }));
    }
  }
  if (x['reference'] !== null && typeof x['reference'] !== 'string') out.push(diag('E_DOCUMENT', 'roll reference must be a frame id or null', { path: 'reference' }));
  const m = x['match'];
  if (m !== null && !(isPlainObject(m) && typeof m['alpha'] === 'number' && typeof m['appliedAt'] === 'number' && typeof m['batch'] === 'string')) {
    out.push(diag('E_DOCUMENT', 'roll match must be {alpha, appliedAt, batch} or null', { path: 'match' }));
  }
  if (!ROLL_STATUSES.includes(x['status'] as RollStatus)) out.push(diag('E_DOCUMENT', `roll status must be one of ${ROLL_STATUSES.join(', ')}`, { path: 'status', valid: [...ROLL_STATUSES] }));
  return out;
}
