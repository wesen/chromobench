// The roll as data (guide §6.1–6.2; CHB-037 P7: links). A roll record (the contract's Roll) lives in the main
// document's slice `roll` (its changes are steps of the log, with the batches that make them). It holds what the
// frames share — the scan medium's roll fields (`media.scan`) — and each frame's scan medium links to it
// (`{ link: { roll }, overrides }`): a roll change reaches every frame that has not overridden it, and divergence is
// the frames' overrides of roll fields, read directly (never computed by comparing copies).
import type { JsonObject, Mutation } from '@chromobench/values';
import { divergence as overridden, isLinked, linkMedium, type Box, type Roll as ContractRoll, type Diagnostic, type Document, type LinkContext, type RollStatus, type Vec3 } from '@chromobench/contract';
import { read } from '../../../../src/model/doc.ts';
import { ROLL_FIELDS, SHARED_PATHS, type RollField, type SharedPath } from './constants.ts';

export type FrameId = string;

// ── what the injected physics returns (structurally ingest's FilmLayout / RollBase, core's StockRank) ──
export interface LayoutLike {
  scale?: number;
  surround: { L: Vec3; fraction: number } | null;
  openGate: { T: Vec3; box: Box; fraction: number } | null;
  crop: Box | null;
  rebate: { T: Vec3; Traw: Vec3; box: Box; from: 'edge' | 'blank'; confidence: number; spreadD: number } | null;
  flare: Vec3 | null;
  veilOfBase: Vec3 | null;
  notes: Diagnostic[];
}
export interface FrameBaseLike {
  id: string;
  T: Vec3 | null;
  confidence: number;
  veil: Vec3 | null;
  openGate: Vec3 | null;
  from?: 'edge' | 'blank' | 'box';
}
export interface RollBaseLike {
  T: Vec3 | null;
  used: string[];
  spreadD: number;
  deviationD: Record<string, number>;
  mixed: string[];
  veil: Vec3 | null;
  veilFrames: number;
  openGate: Vec3 | null;
  absD: Vec3 | null;
  flare: Vec3 | null;
  notes: Diagnostic[];
}
export interface StockRankLike {
  stock: string;
  maxDiffD: number;
  rmsD: number;
  shapeDiffD: number;
  consistent: boolean;
}

/**
 * The physics the kit needs, injected by the host (studio-kit imports only the contract and the shell):
 * ingest's filmLayout / rollBase / noiseAtScale-like σ / classifyImage, core's integrateToGrey and stock ranking.
 */
export interface RollPhysics {
  layout(rgb: Float32Array, w: number, h: number): LayoutLike;
  rollBase(frames: FrameBaseLike[]): RollBaseLike;
  /** core's integrateToGrey: ℓ = ℓ_aim + m + α(Δ − m), Δ = LATD − LATD_aim. */
  integrateToGrey(latd: Vec3, aim: { latd: Vec3; lights: Vec3 }, alpha: number): Vec3;
  /** σ per channel of density over the rebate box (or thin film), at this image's size. */
  noise?(rgb: Float32Array, w: number, h: number, T: Vec3, box: Box | null): Vec3 | null;
  /** Base-class shares at this image's size. */
  classes?(rgb: Float32Array, w: number, h: number, T: Vec3, sigma: Vec3): { blank: number; below: number; above: number };
  /** Stock ranking from the roll base (absolute density when an open gate was seen, else shape only). */
  rank?(base: RollBaseLike, stocks?: string[]): StockRankLike[] | null;
  /** The host's record of conditioning it already did at decode (veil subtracted there), by source SHA-256. */
  conditioned?(sha256: string): { veil: Vec3 | null; from: 'frame' | 'roll' | null } | null;
}

// ── the analysis record (guide §6.2: data, keyed by source hash and the settings it was computed under) ──
export interface FrameAnalysis {
  id: FrameId;
  sha256: string;
  /** Analysis image size and its scale (analysis px per source px). */
  size: [number, number];
  scale: number;
  layout: {
    rebate: { T: Vec3; box: Box; from: 'edge' | 'blank'; confidence: number; spreadD: number } | null;
    veil: Vec3 | null;
    openGate: Vec3 | null;
    crop: Box | null;
    notes: string[];
  };
  /** σ per channel at `size`. */
  sigma: Vec3 | null;
  /** Class shares at `size`. */
  classes: { blank: number; below: number; above: number } | null;
  /** The frame's own departure from the aim in log H (LATD-like: + is denser, needs more light), measured. */
  latd: Vec3;
  /** Integrate-to-grey total exposure offset (lights + time) for this frame alone, log H. */
  auto: Vec3;
  /** 'under': blank share above UNDER_BLANK at the analysis size. */
  hint: 'under' | null;
  /** canonical hash input of the settings this was measured under (stock, scanner, rebate box) */
  under: string;
}

export interface RollAnalysis {
  at: number;
  long: number;
  alpha: number;
  frames: Record<FrameId, FrameAnalysis>;
  base: RollBaseLike;
  ranking: StockRankLike[] | null;
  /** Mean of the frames' auto totals (non-rejected frames). */
  rollMean: Vec3 | null;
  diagnostics: Diagnostic[];
}

/** The contract's roll record (CHB-020 R6) with the kit's analysis. */
export type { RollStatus };
export type Roll = ContractRoll<RollAnalysis>;

/** A new roll sharing these scan fields (`media.scan`); no shared stacks. */
export const newRoll = (id: string, label: string, frames: FrameId[], scan: JsonObject = {}): Roll => ({
  id, label, frames, media: Object.keys(scan).length ? { scan } : {}, stacks: {}, analysis: null, reference: null, match: null, status: 'imported',
});

/** The roll fields of a frame's scan (the roll's starting point when it is created); {} for a camera file. */
export function sharedOf(d: Document, links?: LinkContext): JsonObject {
  const out: Record<string, unknown> = {};
  if (!d.stages.scan) return out as JsonObject;
  for (const f of ROLL_FIELDS) {
    const v = read(d, `stages.scan.medium.${f}`, links);
    if (v !== undefined) out[f] = JSON.parse(JSON.stringify(v));
  }
  return out as JsonObject;
}

/** The roll's value of a field (undefined: the roll does not share it). */
export const rollValue = (roll: Pick<Roll, 'media'>, f: RollField): unknown => (roll.media.scan as JsonObject | undefined)?.[f];
/** The roll with a shared field set. */
export const withRollValue = (roll: Roll, f: RollField, v: unknown): Roll => ({ ...roll, media: { ...roll.media, scan: { ...(roll.media.scan ?? {}), [f]: v as JsonObject[string] } } });

/** The mutation that links a frame's scan medium to the roll (its own fields and departures stay as overrides). */
export function linkFrame(roll: Pick<Roll, 'id' | 'media'>, d: Document, links?: LinkContext): Mutation | null {
  if (!d.stages.scan || !roll.media.scan) return null;
  const m = d.stages.scan.medium;
  if (isLinked(m) && 'roll' in m.link && m.link.roll === roll.id) return null;
  return linkMedium(d, 'scan', { roll: roll.id }, roll.media.scan, links);
}

/** The roll a frame's scan links to, or null. */
export function linkedRoll(d: Document | undefined): string | null {
  const m = d?.stages.scan?.medium;
  return isLinked(m) && 'roll' in m.link ? m.link.roll : null;
}

/** Shared paths a frame overrides (its divergence from the roll; read from its overrides, not computed). */
export function diverging(roll: Pick<Roll, 'id' | 'media'>, d: Document): SharedPath[] {
  if (linkedRoll(d) !== roll.id) return [];
  return overridden(d, 'scan', roll.media.scan ?? {}).map((f) => `stages.scan.medium.${f}` as SharedPath).filter((p) => SHARED_PATHS.includes(p));
}

/** For each shared path, the frames that override it ("base overridden on 2 frames"). */
export function divergence(roll: Pick<Roll, 'id' | 'media' | 'frames'>, docOf: (f: FrameId) => Document | undefined): Partial<Record<SharedPath, FrameId[]>> {
  const out: Partial<Record<SharedPath, FrameId[]>> = {};
  for (const f of roll.frames) {
    const d = docOf(f);
    if (!d) continue;
    for (const p of diverging(roll, d)) (out[p] ??= []).push(f);
  }
  return out;
}

export const meanVec = (vs: readonly Vec3[]): Vec3 | null =>
  vs.length ? ([0, 1, 2].map((k) => vs.reduce((s, v) => s + v[k]!, 0) / vs.length) as Vec3) : null;
export const r6 = (x: number): number => Number(x.toFixed(6));
export const r6v = (v: readonly number[]): Vec3 => [r6(v[0]!), r6(v[1]!), r6(v[2]!)];

// ── the measured base and veil as scan medium settings (flare per channel, baseT) ──
/** The holder reads f/(1+f) of the open gate: a veil L (signal units) is the scan flare f = 100·L/(1 − L) per channel, percent (catalog max 20). */
export function flareOfVeil(L: readonly number[]): Vec3 {
  return [0, 1, 2].map((k) => Number(Math.min(20, Math.max(0, (100 * L[k]!) / (1 - Math.min(L[k]!, 0.99)))).toFixed(4))) as Vec3;
}
/** The veil-corrected base T − L as scan.baseT, the value scan.density divides by after scan.flare: T′(1+f) − f = (T′ − L)/(1 − L). */
export function baseOfVeilFree(T: readonly number[], L: readonly number[] | null): Vec3 {
  return [0, 1, 2].map((k) => Number((T[k]! / (1 - Math.min(L?.[k] ?? 0, 0.99))).toPrecision(7))) as Vec3;
}
