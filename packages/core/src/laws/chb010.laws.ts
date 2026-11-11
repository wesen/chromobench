// CHB-010 laws (guide §9.1), each with the mutant it must catch: the calibration, the scalar κ, the
// optics and the grade pivot.
import type { PhysicsData } from '../data/provider.ts';
import { makePrintChain, type PrintChain, type PrintChainOptions } from '../print/chain.ts';
import { opticsLogH, type EnlargerOptics } from '../print/enlarger.ts';
import { gradeX } from '../print/paper.ts';
import { SPEKTRAFILM } from '../spectral/conventions.ts';
import type { Vec3 } from '../spectral/linalg.ts';
import { defineLaw, near, type CoreLaw } from './harness.ts';

type Cmy = { c: number; m: number; y: number };

export function chb010Laws(data: PhysicsData): CoreLaw[] {
  const O: PrintChainOptions = { data, film: 'kodak_portra_400', paper: 'kodak_portra_endura', conv: SPEKTRAFILM, view: 'D50' };
  const neutral = data.neutralFilter('kodak_portra_endura', 'kodak_portra_400')!;
  const ref = makePrintChain({ ...O, mode: 'real' });
  const Dgrey = ref.film.spectral(ref.grey);
  const shiftGen = (r: { range(a: number, b: number): number }): Cmy => ({ c: r.range(0, 30), m: r.range(-30, 30), y: r.range(-30, 30) });

  const calibration = defineLaw('filters cost light', {
    justifies: 'the aim is fitted once at the calibration: in real mode a filter change moves the grey card by exactly the change of the raw spectral sum',
    section: 'CHB-010 §3.1, §6.3',
  },
  { chainAt: (sh: Cmy): PrintChain => makePrintChain({ ...O, mode: 'real', filtrationShift: sh }) },
  (r) => shiftGen(r),
  (im) => (sh) => {
    const ch = im.chainAt(sh);
    const got = ch.xOfDyes(ch.grey);
    const x0 = ref.xOfDyes(ref.grey);
    const r1 = ch.enlarger.rawLog(Dgrey);
    const r0 = ref.enlarger.rawLog(Dgrey);
    for (let k = 0; k < 3; k++) { const m = near(got[k]! - x0[k]!, r1[k]! - r0[k]!, 1e-12, `Δx[${k}]`); if (m !== true) return m; }
    return true;
  },
  { name: 'aim lights refitted at every pack (the pre-CHB-010 chain)', patch: { chainAt: (sh) => makePrintChain({ ...O, mode: 'real', filtrationShift: sh, referencePack: { c: neutral.c + sh.c, m: neutral.m + sh.m, y: neutral.y + sh.y } }) } });

  const scalarKappa = defineLaw('real vs normalised', {
    justifies: 'the two modes differ by one scalar per setting (κ), never per layer: a per-layer κ would absorb every filter',
    section: 'CHB-010 §3.1, §9.1',
  },
  { realOffset: (ch: PrintChain): Vec3 => { const o = ch.enlarger.offset_logH; return [o, o, o]; } },
  (r) => ({ sh: shiftGen(r), c: [r.range(0, 2.5), r.range(0, 2.5), r.range(0, 2.5)] }),
  (im) => ({ sh, c }) => {
    const rch = makePrintChain({ ...O, mode: 'real', filtrationShift: sh, optics: { time_s: 14 } });
    const nch = makePrintChain({ ...O, mode: 'normalised', filtrationShift: sh });
    const D = rch.film.spectral(c);
    const raw = rch.enlarger.rawLog(D);
    const off = im.realOffset(rch);
    const xr = raw.map((v, k) => v + off[k]!);
    const xn = nch.enlarger.exposureOfDensity(D);
    const d0 = xr[0]! - xn[0]!;
    for (let k = 1; k < 3; k++) { const m = near(xr[k]! - xn[k]!, d0, 1e-12, `real − normalised in layer ${k}`); if (m !== true) return m; }
    return true;
  },
  { name: 'per-layer κ in real mode (each layer normalised at the calibration pack)', patch: { realOffset: (ch) => ch.reference.enlarger.rawLog(ch.enlarger.midgray).map((v) => -v + ch.enlarger.optics_logH) as Vec3 } });

  const optics = defineLaw('optics', {
    justifies: 'light on the paper ∝ t / (N²·(m + 1)²): time, aperture and head height are exact log-exposure offsets',
    section: 'CHB-010 §2.2',
  },
  { optics: (o: Partial<EnlargerOptics>): number => opticsLogH(o) },
  (r) => ({ time_s: 10 * 2 ** r.range(-3, 3), fstop: 8 * 2 ** r.range(-1, 2), magnification: r.range(0.5, 20) }),
  (im) => (o) => {
    const H = 10 ** im.optics(o) * o.fstop ** 2 * (o.magnification + 1) ** 2 / o.time_s;
    return near(H, 8 ** 2 * 9 ** 2 / 10, 1e-9, 'H·N²(m+1)²/t');
  },
  { name: 'magnification as 1/m² instead of 1/(m + 1)²', patch: { optics: (o) => Math.log10(o.time_s! / 10) - 2 * Math.log10(o.fstop! / 8) - 2 * Math.log10(o.magnification! / 8) } });

  const gradePivot = defineLaw('grade pivot', {
    justifies: 'the grade is a gamma about the aim grey: changing it leaves the grey card print unchanged',
    section: 'CHB-010 §6.8',
  },
  { pivot: (ch: PrintChain): Vec3 => ch.aimX },
  (r) => ({ g: r.range(0.7, 1.8) }),
  (im) => ({ g }) => {
    const want = ref.develop(ref.xOfDyes(ref.grey));
    const got = ref.develop(gradeX(ref.xOfDyes(ref.grey), g, im.pivot(ref)));
    for (let k = 0; k < 3; k++) { const m = near(got[k]!, want[k]!, 1e-12, `grey paper dye ${k}`); if (m !== true) return m; }
    return true;
  },
  { name: "spektrafilm's morph centre x = 0 as the pivot", patch: { pivot: () => [0, 0, 0] } });

  return [calibration, scalarKappa, optics, gradePivot];
}
