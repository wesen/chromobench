// The roll's base and veil (CHB-020 guide §4.2): a roll is one piece of film through one process and one
// scanner setup, so its base and veil are measured once, over the frames. The base is the per-channel median
// of the frames' rebates with good confidence (in log T); the spread of the frames around it is the roll's
// consistency check: below ~0.01 D is one film, above 0.03 D is a mixed roll, an uneven development, a bad
// flat or a mis-picked box (W_ROLL_MIXED names the frames).
import type { Diagnostic, Vec3 } from '@chromobench/contract';
import type { FilmLayout } from './film-layout.ts';

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
