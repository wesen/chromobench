// Lowering a roll analysis to mutation batches (guide §6.3): the first print, "print the roll like this frame"
// and its undoing. No colour maths of its own: integrate-to-grey (core's, injected) with the reference frame
// as the aim is "print like this frame" (guide §2.1, §6.3).
//
// Exposure bookkeeping. At a real enlarger the frame's exposure offset is its printer lights plus the time:
//   total(d) = lights.params.logH + log10(main time / 10 s)      (log H per paper layer)
// The analysis measures, per frame, the integrated paper exposure X̄ under some recipe; the frame's own
// departure from the aim (LATD-like, + is denser) is λ = −(X̄ − total). Its own auto total is
// integrateToGrey(λ, aim 0, α). A total goes back into a document as at an enlarger: its mean into the time
// (on the slider's 1/6-stop grid), the rest into the lights. The balance's record (method, α, the total) is the
// printer lights layer's provenance (`lights.source`, kind 'auto').
import type { LogEntry } from '@chromobench/values';
import { documentKind, type Document, type Vec3 } from '@chromobench/contract';
import { FILTRATION_PATH, FSTOP_PATH, GRADE_PATH, LIGHTS, layerOf, LIGHTS_PATH, lightsOf, mainExposure, MODE_PATH, read, TIME_PATH } from '../../../../src/model/doc.ts';
import { LIGHTS_PATHS, ROLL_CONSISTENCY, ROLL_TX, TIME_MAX_S, TIME_MIN_S, TIME_REF_S } from './constants.ts';
import { NEUTRALISE } from '../../../../src/model/aim.ts';
import { frameSets, type MutationBatch } from './batch.ts';
import { meanVec, r6, r6v, type FrameId, type Roll, type RollPhysics } from './model.ts';

/** A batch id suffix: the clock in base 36 plus a counter, so two batches made in one millisecond differ. */
let batchSeq = 0;
const batchStamp = (): string => `${Date.now().toString(36)}.${(batchSeq++).toString(36)}`;

/** Time on the time slider's grid: 10 s · 2^(k/6), clamped to 2…120 s. */
export function gridTime(t: number): number {
  const k = Math.min(Math.floor(6 * Math.log2(TIME_MAX_S / TIME_REF_S)), Math.max(Math.ceil(6 * Math.log2(TIME_MIN_S / TIME_REF_S)), Math.round(6 * Math.log2(t / TIME_REF_S))));
  return Number((TIME_REF_S * 2 ** (k / 6)).toFixed(3));
}

/** The printer lights' provenance: the balance's record (method roll / match, α, …) when the roll set it. */
export const autoOf = (d: Document): Record<string, unknown> => ({ ...((layerOf(d, LIGHTS)?.source ?? { kind: 'user' }) as Record<string, unknown>) });
export const LIGHTS_SOURCE = `${LIGHTS}.source`;

/** A document's exposure offset: lights + log10(t / 10 s). */
export function totalOf(d: Document): Vec3 {
  const l = lightsOf(d);
  const t = Math.log10(mainExposure(d).time_s / TIME_REF_S);
  return [l[0] + t, l[1] + t, l[2] + t];
}

/** A total as time (its mean, on the grid) plus lights (the rest). */
export function splitTotal(total: Vec3): { time_s: number; logH: Vec3 } {
  const m = (total[0] + total[1] + total[2]) / 3;
  const time_s = gridTime(TIME_REF_S * 10 ** m);
  const moved = Math.log10(time_s / TIME_REF_S);
  return { time_s, logH: r6v(total.map((v) => v - moved)) };
}

const colourOf = (v: Vec3): { m: number; c: Vec3 } => {
  const m = (v[0] + v[1] + v[2]) / 3;
  return { m, c: [v[0] - m, v[1] - m, v[2] - m] };
};

/**
 * Roll-consistent totals: each frame keeps its own density correction (the mean, in full) and moves its colour
 * a share r towards the roll's mean colour: ℓ = m_f + (1 − r)·c_f + r·mean(c). Rejected frames do not count in
 * the mean (they still get a print). Deliberate refinement of Chromogen's rollConsistency, which also blends
 * the density: a roll of differently exposed frames should not print half-corrected.
 */
export function rollTotals(roll: Pick<Roll, 'frames' | 'analysis'>, o: { consistency?: number; rejected?: ReadonlySet<FrameId> } = {}): Map<FrameId, Vec3> {
  const a = roll.analysis;
  const out = new Map<FrameId, Vec3>();
  if (!a) return out;
  const r = o.consistency ?? ROLL_CONSISTENCY;
  const counted = roll.frames.filter((f) => a.frames[f] && !o.rejected?.has(f)).map((f) => colourOf(a.frames[f]!.auto).c);
  const meanC = meanVec(counted) ?? [0, 0, 0];
  for (const f of roll.frames) {
    const fa = a.frames[f];
    if (!fa) continue;
    const { m, c } = colourOf(fa.auto);
    out.set(f, [0, 1, 2].map((k) => m + (1 - r) * c[k]! + r * meanC[k]!) as Vec3);
  }
  return out;
}

/** True when the frame's lights or time carry a hand edit (a user entry outside roll batches) — guide §8.7. */
export function handEdited(entries: readonly Pick<LogEntry, 'tx'>[]): boolean {
  return entries.some((e) => e.tx.by === 'user' && !e.tx.id.startsWith(ROLL_TX) && e.tx.mutations.some((m) => m.op === 'set' && LIGHTS_PATHS.includes(m.path)));
}

export interface FirstPrintOptions {
  alpha?: number;
  consistency?: number;
  rejected?: ReadonlySet<FrameId>;
  /** only frames without a first print (default: all frames) */
  only?: readonly FrameId[];
  id?: string;
}

/**
 * The first print as one batch (by 'auto'): the real enlarger, time and lights, the auto record, the frame's own
 * rebate box; a frame whose base the analysis calls mixed keeps its own (an override of the roll's base). What the
 * roll shares (stock, base, veil) reaches the frames through their link, not through this batch.
 */
export function firstPrintBatch(roll: Roll, recipeOf: (f: FrameId) => Document | undefined, o: FirstPrintOptions = {}): MutationBatch {
  const a = roll.analysis;
  if (!a) throw new Error('roll.firstPrint: analyse the roll first');
  const alpha = o.alpha ?? a.alpha ?? NEUTRALISE;
  const r = o.consistency ?? ROLL_CONSISTENCY;
  const totals = rollTotals(roll, { consistency: r, ...(o.rejected ? { rejected: o.rejected } : {}) });
  const id = o.id ?? `${ROLL_TX}first-print-${roll.id}-${a.at}`;
  const frames: MutationBatch['frames'] = [];
  const skipped: MutationBatch['skipped'] = [];
  for (const f of o.only ?? roll.frames) {
    const rec = recipeOf(f);
    const fa = a.frames[f];
    const total = totals.get(f);
    if (!rec || !fa || !total) {
      skipped.push({ frame: f, why: rec ? 'not analysed' : 'not open' });
      continue;
    }
    const { time_s, logH } = splitTotal(total);
    const scan = documentKind(rec) === 'negative-scan';
    // the mode first: the time and lights after it are read in the real enlarger's terms
    const values: Record<string, unknown> = { [MODE_PATH]: 'real', [TIME_PATH]: time_s, [LIGHTS_PATH]: logH };
    // a frame the analysis flags as mixed keeps its own base (measured on its rebate); the others follow the roll's
    if (scan && a.base.mixed.includes(f)) values['stages.scan.medium.baseT'] = null;
    // the frame's own rebate box (source px), unless the photographer picked one
    const box = fa.layout.rebate?.box;
    if (box && scan && !read(rec, 'stages.scan.medium.rebate')) values['stages.scan.medium.rebate'] = box;
    values[LIGHTS_SOURCE] = { ...autoOf(rec), kind: 'auto', by: 'roll', method: 'roll', alpha, analysisLongSide_px: a.long, rollConsistency: r, matchFrame: null, matchAmount: null, applied: true, logH: r6v(total) };
    // a mixed frame's own base is set even when nothing reads differently yet: on a linked scan it is the override
    // that keeps the roll's base away from this frame
    frames.push({ frame: f, ...frameSets(rec, values, 'stages.scan.medium.baseT' in values ? ['stages.scan.medium.baseT'] : []) });
  }
  const n = frames.length;
  return {
    id, kind: 'first-print', by: 'auto', frames, skipped,
    label: 'First print',
    why: `Roll first print of ${n} frame${n === 1 ? '' : 's'}: base (scan.baseT) from the frames' rebates (roll spread ${a.base.spreadD.toFixed(3)} D)${a.base.veil ? ', veil as scan.flare' : ''}, integrate to grey α = ${alpha}, roll consistency ${r}`,
    meta: { alpha, consistency: r },
  };
}

export interface MatchOptions {
  alpha?: number;
  rejected?: ReadonlySet<FrameId>;
  /** frames whose lights or time were set by hand (skipped unless included) */
  handEdited?: (f: FrameId) => boolean;
  include?: readonly FrameId[];
  id?: string;
}

/**
 * "Print the roll like this frame": every other frame gets integrateToGrey(λ_f, {latd: λ_ref, lights: total_ref}, α):
 * the exposure difference from the reference corrected in full, the colour departure by α (α = 0: the
 * reference's pack, density-corrected; α = 1: each frame to the reference's grey).
 */
export function matchBatch(roll: Roll, ref: FrameId, recipeOf: (f: FrameId) => Document | undefined, physics: Pick<RollPhysics, 'integrateToGrey'>, o: MatchOptions = {}): MutationBatch {
  const a = roll.analysis;
  if (!a) throw new Error('roll.matchToReference: analyse the roll first');
  const refRec = recipeOf(ref);
  const refA = a.frames[ref];
  if (!refRec || !refA) throw new Error(`roll.matchToReference: the reference ${ref} is not analysed`);
  const alpha = o.alpha ?? 0.45;
  const aim = { latd: refA.latd, lights: totalOf(refRec) };
  const frames: MutationBatch['frames'] = [];
  const skipped: MutationBatch['skipped'] = [];
  for (const f of roll.frames) {
    if (f === ref) continue;
    const rec = recipeOf(f);
    const fa = a.frames[f];
    if (!rec || !fa) { skipped.push({ frame: f, why: 'not analysed' }); continue; }
    if (o.rejected?.has(f)) { skipped.push({ frame: f, why: 'rejected' }); continue; }
    if (o.handEdited?.(f) && !o.include?.includes(f)) { skipped.push({ frame: f, why: 'lights set by hand' }); continue; }
    const total = physics.integrateToGrey(fa.latd, aim, alpha);
    const { time_s, logH } = splitTotal(total);
    // the reference's enlarger settings become the roll's (mode, pack, f-stop, grade); the mode first
    const values: Record<string, unknown> = {};
    for (const p of [MODE_PATH, FILTRATION_PATH, FSTOP_PATH, GRADE_PATH]) values[p] = read(refRec, p);
    // time and lights always, so a frame whose exposure changed after planning is stale at approval
    values[TIME_PATH] = time_s;
    values[LIGHTS_PATH] = logH;
    values[LIGHTS_SOURCE] = { ...autoOf(rec), kind: 'auto', by: 'roll', method: 'match', alpha, matchFrame: ref, matchAmount: 1, applied: true, logH: r6v(total) };
    frames.push({ frame: f, ...frameSets(rec, values, [TIME_PATH, LIGHTS_PATH]) });
  }
  const label = `Print the roll like ${ref}`;
  return {
    id: o.id ?? `${ROLL_TX}match-${ref}-${batchStamp()}`, kind: 'match', by: 'user', frames, skipped, label,
    why: `${frames.length} frame${frames.length === 1 ? '' : 's'} printed like ${ref}: its lights and time as the aim, exposure corrected in full, colour by α = ${r6(alpha)}`,
    meta: { reference: ref, alpha },
  };
}

/** Back to each frame's own (roll-consistent) first-print totals. */
export function clearMatchBatch(roll: Roll, recipeOf: (f: FrameId) => Document | undefined, o: { consistency?: number; rejected?: ReadonlySet<FrameId>; id?: string } = {}): MutationBatch {
  const totals = rollTotals(roll, o);
  const frames: MutationBatch['frames'] = [];
  for (const f of roll.frames) {
    const rec = recipeOf(f);
    const total = totals.get(f);
    if (!rec || !total || autoOf(rec)['method'] !== 'match') continue;
    const { time_s, logH } = splitTotal(total);
    frames.push({ frame: f, ...frameSets(rec, { [TIME_PATH]: time_s, [LIGHTS_PATH]: logH, [LIGHTS_SOURCE]: { ...autoOf(rec), method: 'roll', matchFrame: null, matchAmount: null, rollConsistency: o.consistency ?? ROLL_CONSISTENCY, logH: r6v(total) } }) });
  }
  return { id: o.id ?? `${ROLL_TX}clear-${batchStamp()}`, kind: 'clear-match', by: 'user', frames, skipped: [], label: 'Clear roll match', why: 'Frames back to their own roll-consistent first print' };
}

