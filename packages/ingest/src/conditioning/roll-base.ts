// The roll's base and veil (CHB-020 guide §4.2): a roll is one piece of film through one process and one
// scanner setup, so its base and veil are measured once, over the frames. The base is the per-channel median
// of the frames' rebates with good confidence (in log T); the spread of the frames around it is the roll's
// consistency check: below ~0.01 D is one film, above 0.03 D is a mixed roll, an uneven development, a bad
// flat or a mis-picked box (W_ROLL_MIXED names the frames).
import type { Box, Diagnostic, Vec3 } from '@chromobench/contract';
import { filmLayout, subtractVeil, type FilmLayout, type FilmLayoutOptions } from './film-layout.ts';

export interface FrameBase {
  id: string;
  /** Veil-corrected rebate value (linear), or null when none was found. */
  T: Vec3 | null;
  confidence: number;
  /** The frame's veil (linear), when it could be read. */
  veil: Vec3 | null;
  /** The frame's open gate (linear, veil included), when in view. */
  openGate: Vec3 | null;
  from?: 'edge' | 'blank' | 'box';
}

export interface RollBase {
  /** Median rebate value (linear, veil-corrected). */
  T: Vec3 | null;
  /** Frames the median was taken over. */
  used: string[];
  /** Max |D_frame − D_roll| over the used frames. */
  spreadD: number;
  /** Per frame (every frame with a rebate): max over channels of |log10(T_frame / T_roll)|. */
  deviationD: Record<string, number>;
  /** Frames beyond the tolerance. */
  mixed: string[];
  /** Median veil over the frames that read one. */
  veil: Vec3 | null;
  veilFrames: number;
  /** Median open gate (linear, veil included). */
  openGate: Vec3 | null;
  /** −log10(T_roll / (T_open − veil)): the base's absolute density, when an open gate was in view. */
  absD: Vec3 | null;
  /** Flare as a fraction of the open gate, veil / (T_open − veil). */
  flare: Vec3 | null;
  notes: Diagnostic[];
}

export const ROLL_MIXED_D = 0.03;

const med = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[n >> 1]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
};
const medVec = (vs: Vec3[]): Vec3 => [0, 1, 2].map((k) => med(vs.map((v) => v[k]!))) as Vec3;
const medLogVec = (vs: Vec3[]): Vec3 => [0, 1, 2].map((k) => 10 ** med(vs.map((v) => Math.log10(Math.max(v[k]!, 1e-9))))) as Vec3;

/** A frame's base record from its film layout. */
export function frameBaseOf(id: string, l: FilmLayout): FrameBase {
  return {
    id,
    T: l.rebate?.T ?? null,
    confidence: l.rebate?.confidence ?? 0,
    veil: l.surround?.L ?? null,
    openGate: l.openGate?.T ?? null,
    ...(l.rebate ? { from: l.rebate.from } : {}),
  };
}

export function rollBase(frames: readonly FrameBase[], o: { tolD?: number; minConfidence?: number } = {}): RollBase {
  const tol = o.tolD ?? ROLL_MIXED_D;
  const minC = o.minConfidence ?? 0.5;
  const notes: Diagnostic[] = [];
  const withT = frames.filter((f): f is FrameBase & { T: Vec3 } => !!f.T);
  let used = withT.filter((f) => f.confidence >= minC);
  if (!used.length && withT.length) {
    used = withT;
    notes.push({ code: 'W_ROLL_BASE_WEAK', message: `No frame has a confident rebate (≥ ${minC}); the roll base is the median of ${withT.length} weak estimates (blank film inside the frames).`, hint: 'Pick a rebate box on one frame and apply it to the roll.' });
  }
  const T = used.length ? medLogVec(used.map((f) => f.T)) : null;
  const deviationD: Record<string, number> = {};
  if (T) for (const f of withT) deviationD[f.id] = Math.max(...[0, 1, 2].map((k) => Math.abs(Math.log10(f.T[k]! / T[k]!))));
  const spreadD = used.length ? Math.max(...used.map((f) => deviationD[f.id]!)) : 0;
  const mixed = withT.filter((f) => deviationD[f.id]! > tol).map((f) => f.id);
  if (mixed.length)
    notes.push({
      code: 'W_ROLL_MIXED',
      message: `${mixed.length === 1 ? 'Frame' : 'Frames'} ${mixed.join(', ')} ${mixed.length === 1 ? 'has a base' : 'have bases'} ${mixed.map((id) => deviationD[id]!.toFixed(3)).join(', ')} D from the roll's median (tolerance ${tol} D): a mixed roll, uneven development, a bad flat or a mis-picked rebate.`,
      hint: 'Check the rebate boxes of these frames, or set their base per frame.',
    });
  if (!T) notes.push({ code: 'W_NO_REBATE', message: 'No frame of the roll shows a rebate or blank film: the base is unknown.' });
  const veils = frames.map((f) => f.veil).filter((v): v is Vec3 => !!v);
  const veil = veils.length ? medVec(veils) : null;
  const gates = frames.map((f) => f.openGate).filter((v): v is Vec3 => !!v);
  const openGate = gates.length ? medVec(gates) : null;
  const v = veil ?? [0, 0, 0];
  const clear = openGate ? (openGate.map((g, k) => g - v[k]!) as Vec3) : null;
  const absD = T && clear ? (T.map((t, k) => -Math.log10(t / clear[k]!)) as Vec3) : null;
  const flare = veil && clear ? (veil.map((x, k) => x / clear[k]!) as Vec3) : null;
  return { T, used: used.map((f) => f.id), spreadD, deviationD, mixed, veil, veilFrames: veils.length, openGate, absD, flare, notes };
}

/** A veil L read on the opaque holder (signal units) as scan.flare, percent per channel: f = 100·L/(1 − L), at most the catalog's 20. */
export function veilToFlare(L: ArrayLike<number>): Vec3 {
  return [0, 1, 2].map((k) => Number(Math.min(20, Math.max(0, (100 * L[k]!) / (1 - Math.min(L[k]!, 0.99)))).toFixed(4))) as Vec3;
}

export interface ConditionedScan {
  layout: FilmLayout;
  /** The veil subtracted from the pixels (linear), and where it came from. */
  veil: Vec3 | null;
  veilFrom: 'frame' | 'roll' | null;
  /** The rebate box for scan.rebate (input px) when the film edge was found, else null (scan.density's own rule). */
  rebate: Box | null;
  /** The veil-corrected rebate value, when found (edge or blank film): T − L, the pixels' own scale. */
  baseT: Vec3 | null;
  /** The veil as recipe settings (contract 0.3): scan.flare in percent, f = 100·L/(1 − L) per channel (the holder reads f/(1+f)). */
  flare: Vec3 | null;
  /** The base as scan.baseT: the flare-corrected value T′(1+f) − f = (T′ − L)/(1 − L), what scan.density divides by after scan.flare. */
  scanBaseT: Vec3 | null;
  /** This frame's record for rollBase. */
  frame: FrameBase;
  notes: Diagnostic[];
}

/**
 * The host's one call at decode (CHB-020; apps/studio host/engines.ts decodeScan): measure the film layout of the
 * working image, subtract the veil in place (unless `subtract: false`: then the host writes `flare` and `scanBaseT` into the recipe's scan.flare and scan.baseT and the engine does it) (this frame's, read on its holder; else the roll's, when given), and
 * return the rebate box to put in the new recipe's scan.rebate. A box of blank film inside the frame is not
 * returned as scan.rebate unless `blankBox` is set (it is a weak base; the roll's median is better, R3 scan.baseT).
 */
export function conditionScan(rgb: Float32Array | Float64Array, w: number, h: number, o: FilmLayoutOptions & { id?: string; rollVeil?: Vec3 | null; blankBox?: boolean; subtract?: boolean } = {}): ConditionedScan {
  const layout = filmLayout(rgb, w, h, o);
  const notes = [...layout.notes];
  let veil: Vec3 | null = null;
  let veilFrom: ConditionedScan['veilFrom'] = null;
  if (layout.surround && !layout.notes.some((n) => n.code === 'W_SURROUND_BRIGHT')) {
    veil = layout.surround.L;
    veilFrom = 'frame';
  } else if (o.rollVeil) {
    veil = o.rollVeil;
    veilFrom = 'roll';
    notes.push({ code: 'W_VEIL_FROM_ROLL', message: `No holder on this frame: the roll's veil (${o.rollVeil.map((v) => v.toExponential(2)).join(', ')}) was subtracted.` });
  }
  if (veil && o.subtract !== false) subtractVeil(rgb, veil, o.stride ?? 3);
  const reb = layout.rebate;
  // the layout measured the rebate before the roll's veil came off: correct its value here
  const baseT = reb ? (veilFrom === 'roll' ? (reb.Traw.map((t, k) => Math.max(1e-6, t - veil![k]!)) as Vec3) : reb.T) : null;
  const rebate = reb && (reb.from === 'edge' || o.blankBox) ? reb.box : null;
  return {
    layout, veil, veilFrom, rebate, baseT, notes, flare: veil ? veilToFlare(veil) : null, scanBaseT: baseT ? baseT.map((t, k) => t / (1 - Math.min(veil?.[k] ?? 0, 0.99))) as Vec3 : null,
    frame: { id: o.id ?? '', T: baseT, confidence: reb?.confidence ?? 0, veil: layout.surround?.L ?? null, openGate: layout.openGate?.T ?? null, ...(reb ? { from: reb.from } : {}) },
  };
}
