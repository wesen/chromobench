// The roll as data (guide §6.1–6.2). A roll record (the contract's Roll, contract 0.3) lives in the
// catalog-like document slice `roll`; recipes hold plain copies of the shared settings, and divergence is
// computed, never stored.
import { canonicalJSON, getPath, type Box, type Roll as ContractRoll, type Diagnostic, type FrameRecipe, type RollStatus, type Vec3 } from '@chromobench/contract';
import { SHARED_PATHS, type SharedPath } from './constants.ts';

export type FrameId = string;
export type RollFragment = Partial<Record<SharedPath, unknown>>;

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

/** The contract's roll record (contract 0.3, CHB-020 R6) with the kit's analysis and fragment types. */
export type { RollStatus };
export type Roll = ContractRoll<RollAnalysis, RollFragment>;

export const newRoll = (id: string, label: string, frames: FrameId[], fragment: RollFragment = {}): Roll => ({
  id, label, frames, fragment, analysis: null, reference: null, match: null, status: 'imported',
});

/** The shared fragment as one recipe has it (the roll's starting point when it is created). */
export function fragmentOf(r: FrameRecipe): RollFragment {
  const f: RollFragment = {};
  for (const p of SHARED_PATHS) {
    const v = getPath(r, p);
    if (v !== undefined) f[p] = JSON.parse(JSON.stringify(v));
  }
  return f;
}

/** Shared paths on which a frame's recipe differs from the roll's value (computed, not stored). */
export function diverging(roll: Pick<Roll, 'fragment'>, r: FrameRecipe): SharedPath[] {
  const out: SharedPath[] = [];
  for (const p of SHARED_PATHS) {
    if (!(p in roll.fragment)) continue;
    if (canonicalJSON(getPath(r, p) ?? null) !== canonicalJSON(roll.fragment[p] ?? null)) out.push(p);
  }
  return out;
}

/** For each shared path, the frames that diverge on it ("base overridden on 2 frames"). */
export function divergence(roll: Pick<Roll, 'fragment' | 'frames'>, recipeOf: (f: FrameId) => FrameRecipe | undefined): Partial<Record<SharedPath, FrameId[]>> {
  const out: Partial<Record<SharedPath, FrameId[]>> = {};
  for (const f of roll.frames) {
    const r = recipeOf(f);
    if (!r) continue;
    for (const p of diverging(roll, r)) (out[p] ??= []).push(f);
  }
  return out;
}

export const meanVec = (vs: readonly Vec3[]): Vec3 | null =>
  vs.length ? ([0, 1, 2].map((k) => vs.reduce((s, v) => s + v[k]!, 0) / vs.length) as Vec3) : null;
export const r6 = (x: number): number => Number(x.toFixed(6));
export const r6v = (v: readonly number[]): Vec3 => [r6(v[0]!), r6(v[1]!), r6(v[2]!)];
