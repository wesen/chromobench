// The light law of print.combine on the GPU (contract 1.0, design §22; the arithmetic is the contract's lightH,
// packages/contract/src/pixel.ts). Pure planning, no device: which form a node takes (one fused pointwise op, or a
// sequence of kernels/combine.wgsl passes in linear H), and the weights of every term. GpuEngine runs the plan;
// test/light.test.ts replays it in f64 against lightH.
//
//   H = T_all · ( T_neg · ( max(E_main − Σ E_dodge, 0) + Σ E_burn ) + Σ E_flash ) + Σ E_pre ;  x = log10 max(H, 1e-8)
//   E = a·m·r·10^x per term, T_neg = 10^−Σ a·m·d, T_all = 10^Σ a·m·logH, E_pre = a·m·φ,
//   r = t_i / t_main in normalised mode (core combineRatio; the receiver is the main print.expose), else 1.
import { H_FLOOR } from '@chromobench/contract';

/** print.combine's arguments as the graph binds them (contract catalogue capture-film-print.ts). */
export interface CombineArgs {
  mainAmount: number;
  mainMask?: string;
  terms: readonly { role: 'burn' | 'dodge' | 'flash-base' | 'flash-open'; image: string; amount: number; mask?: string }[];
  densities: readonly { image: string; amount: number; mask?: string }[];
  filters: readonly { logH: readonly number[]; amount: number; mask?: string }[];
  preflash: readonly { fraction: number; amount: number; mask?: string }[];
}

export const combineArgs = (a: Readonly<Record<string, unknown>>): CombineArgs => ({
  mainAmount: (a['mainAmount'] as number | undefined) ?? 1,
  ...(typeof a['mainMask'] === 'string' ? { mainMask: a['mainMask'] } : {}),
  terms: (a['terms'] as CombineArgs['terms'] | undefined) ?? [],
  densities: (a['densities'] as CombineArgs['densities'] | undefined) ?? [],
  filters: (a['filters'] as CombineArgs['filters'] | undefined) ?? [],
  preflash: (a['preflash'] as CombineArgs['preflash'] | undefined) ?? [],
});

const isFlash = (role: string): boolean => role === 'flash-base' || role === 'flash-open';

/**
 * True when no term reads a texture and nothing is masked: only the main exposure's light, uniform flashes,
 * filters and preflash, so the node is a pointwise function of x (the printer lights on a plain print).
 */
export function combineIsPointwise(c: CombineArgs): boolean {
  if (c.mainMask !== undefined || c.densities.length) return false;
  if (c.terms.some((t) => !isFlash(t.role) || t.mask !== undefined)) return false;
  return !c.filters.some((f) => f.mask !== undefined) && !c.preflash.some((p) => p.mask !== undefined);
}

/** What the plan needs from the graph and the physics: a term's seconds ratio and a flash's uniform x. */
export interface LightContext {
  ratio(image: string): number;
  /** The uniform paper log exposure of a flash term (core flashExposure). */
  flashX(image: string, role: 'flash-base' | 'flash-open'): readonly number[];
}

/**
 * The fused form: x' = log10 max(g·10^x + o, H_FLOOR) per channel, g = w_main·T_all, o = T_all·Σ E_flash + Σ E_pre.
 * `additive`: o = 0 and g > 0, so x' = max(x + log10 g, log10 H_FLOOR) exactly (no 10^x and back).
 */
export interface LightPointwise { gain: number[]; offset: number[]; additive: boolean; logGain: number[] }

export function lightPointwise(c: CombineArgs, lc: LightContext): LightPointwise {
  const L = [0, 0, 0];
  for (const f of c.filters) for (let k = 0; k < 3; k++) L[k]! += f.amount * f.logH[k]!;
  const flash = [0, 0, 0];
  for (const t of c.terms) {
    const x = lc.flashX(t.image, t.role as 'flash-base' | 'flash-open');
    const w = t.amount * lc.ratio(t.image);
    for (let k = 0; k < 3; k++) flash[k]! += w * 10 ** x[k]!;
  }
  let pre = 0;
  for (const p of c.preflash) pre += p.amount * p.fraction;
  const T = L.map((l) => 10 ** l);
  const gain = T.map((t) => c.mainAmount * t);
  const offset = T.map((t, k) => t * flash[k]! + pre);
  const additive = offset.every((o) => o === 0) && c.mainAmount > 0;
  return { gain, offset, additive, logGain: additive ? L.map((l) => l + Math.log10(c.mainAmount)) : [0, 0, 0] };
}

/** kernels/combine.wgsl modes. */
export const MODE = Object.freeze({
  MAIN: 0, TERM: 1, LOG: 2, HOLD: 3, UNIFORM: 4, FILTER: 5, TRANSMITTANCE: 6, DENSITY: 7, COPY: 8, MIX: 9, MASK: 10, CLARITY: 11,
});
/** Pass flags: clamp the running H at 0 before the step (after the dodges); the pass has a mask texture. */
export const FLAG = Object.freeze({ CLAMP: 1, MASK: 2 });

/** One combine.wgsl pass of the light law: `b` an image node (term or density), `m` a mask node, `w` the uniform weights. */
export interface LightPass { mode: number; flags: number; b?: string; m?: string; w: number[] }

/**
 * The barrier form: passes in the order lightH sums (main, dodges, clamp, burns, densities, flashes, filters,
 * preflash, log). The running H after the main pass is non-negative except while dodges subtract, so every pass
 * after the dodges clamps first (a no-op when nothing went below 0).
 */
export function lightPasses(c: CombineArgs, lc: LightContext): LightPass[] {
  const out: LightPass[] = [];
  const masked = (m: string | undefined, flags: number): { flags: number; m?: string } => (m === undefined ? { flags } : { flags: flags | FLAG.MASK, m });
  out.push({ mode: MODE.MAIN, ...masked(c.mainMask, 0), w: [c.mainAmount] });
  for (const t of c.terms) if (t.role === 'dodge') out.push({ mode: MODE.TERM, ...masked(t.mask, 0), b: t.image, w: [-t.amount * lc.ratio(t.image)] });
  const C = FLAG.CLAMP;
  for (const t of c.terms) if (t.role === 'burn') out.push({ mode: MODE.TERM, ...masked(t.mask, C), b: t.image, w: [t.amount * lc.ratio(t.image)] });
  for (const d of c.densities) out.push({ mode: MODE.HOLD, ...masked(d.mask, C), b: d.image, w: [d.amount] });
  for (const t of c.terms) {
    if (!isFlash(t.role)) continue;
    const x = lc.flashX(t.image, t.role as 'flash-base' | 'flash-open');
    const w = t.amount * lc.ratio(t.image);
    out.push({ mode: MODE.UNIFORM, ...masked(t.mask, C), w: [0, 1, 2].map((k) => w * 10 ** x[k]!) });
  }
  for (const f of c.filters) out.push({ mode: MODE.FILTER, ...masked(f.mask, C), w: [0, 1, 2].map((k) => f.amount * f.logH[k]!) });
  for (const p of c.preflash) out.push({ mode: MODE.UNIFORM, ...masked(p.mask, C), w: [p.amount * p.fraction, p.amount * p.fraction, p.amount * p.fraction] });
  out.push({ mode: MODE.LOG, flags: C, w: [] });
  return out;
}

/**
 * The passes replayed per pixel in f64 (test/light.test.ts compares it with lightH; the WGSL does the same in f32).
 * `img(id)` and `mask(id)` give a term's x (3 values) and a mask's coverage at the pixel.
 */
export function replayPasses(passes: readonly LightPass[], xMain: ArrayLike<number>, img: (id: string) => ArrayLike<number>, mask: (id: string) => number, out: number[] | Float64Array): void {
  const H = [0, 0, 0];
  for (const p of passes) {
    const m = p.m === undefined ? 1 : mask(p.m);
    if (p.flags & FLAG.CLAMP) for (let k = 0; k < 3; k++) H[k] = Math.max(H[k]!, 0);
    for (let k = 0; k < 3; k++) {
      switch (p.mode) {
        case MODE.MAIN: H[k] = p.w[0]! * m * 10 ** xMain[k]!; break;
        case MODE.TERM: H[k]! += p.w[0]! * m * 10 ** img(p.b!)[k]!; break;
        case MODE.HOLD: H[k]! *= 10 ** (-p.w[0]! * m * img(p.b!)[0]!); break;
        case MODE.UNIFORM: H[k]! += m * p.w[k]!; break;
        case MODE.FILTER: H[k]! *= 10 ** (m * p.w[k]!); break;
        case MODE.LOG: out[k] = Math.log10(Math.max(H[k]!, H_FLOOR)); break;
        default: throw new Error(`replayPasses: mode ${p.mode}`);
      }
    }
  }
}
