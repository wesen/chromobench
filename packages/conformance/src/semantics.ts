// Semantic cases (CHB-010, contract 0.3): what print.combine, the mask.* ops, scan.flare and scan.density's
// baseT must compute, in any engine, on
// seeded synthetic inputs. Values are read back from the engine under test (masks included), so the
// cases hold for f64 and f32 engines alike; the tolerance is the f32 one.
import type { Node } from '@chromobench/contract';
import type { Case, Env } from './generate.ts';

const TOL = 2e-5;

class SemanticFailure extends Error {}
const check = (cond: boolean, msg: string): void => {
  if (!cond) throw new SemanticFailure(msg);
};

async function read(env: Env, n: Node): Promise<ArrayLike<number>> {
  return (await env.engine.evaluate(n, { scale: 'full', precision: 'export' })).read();
}

/** Max |a_i − f(i)| over the first three channels of a c-channel image. */
function worst(a: ArrayLike<number>, c: number, f: (pixel: number, k: number) => number): number {
  let w = 0;
  for (let i = 0; i < a.length / c; i++) for (let k = 0; k < Math.min(3, c); k++) w = Math.max(w, Math.abs(a[i * c + k]! - f(i, k)));
  return w;
}

interface SemanticCase { id: string; op: string; needs: string[]; run(env: Env): Promise<void> }

const CASES: SemanticCase[] = [
  {
    id: 'print.combine semantics: no exposures is the receiver', op: 'print.combine', needs: ['print.combine'],
    async run(env) {
      const x = env.input('paper-logH');
      const [a, b] = [await read(env, x), await read(env, env.build('print.combine', [x.id], {}))];
      check(worst(b, 3, (i, k) => a[3 * i + k]!) <= TOL, 'print.combine without exposures changed the image');
    },
  },
  {
    id: 'print.combine semantics: a burn adds in linear H (x + log10(1 + m) for the same exposure)', op: 'print.combine', needs: ['print.combine', 'mask.gradient'],
    async run(env) {
      const x = env.input('paper-logH');
      const m = env.build('mask.gradient', [x.id], { from: { x: 0, y: 0 }, to: { x: 12, y: 10 } });
      const out = env.build('print.combine', [x.id], { exposures: [x.id], masks: [m.id], modes: ['add'] });
      const [xa, ma, oa] = [await read(env, x), await read(env, m), await read(env, out)];
      check(worst(oa, 3, (i, k) => xa[3 * i + k]! + Math.log10(1 + ma[i]!)) <= TOL, 'burn is not log10(1 + m) above the main exposure (summed in log H?)');
      check(Math.abs(ma[0]! - (1 - (0.5 * 12 + 0.5 * 10) / 244)) <= 1e-6, `mask.gradient at the first pixel centre: ${ma[0]}`);
    },
  },
  {
    id: 'print.combine semantics: dodge and burn of one exposure and mask cancel', op: 'print.combine', needs: ['print.combine', 'print.lights', 'mask.ellipse'],
    async run(env) {
      const x = env.input('paper-logH');
      const e = env.build('print.lights', [x.id], { logH: [-0.3, -0.5, -0.2] });
      const m = env.build('mask.ellipse', [x.id], { box: { x: 2, y: 1, w: 8, h: 7 }, angle_deg: 30 });
      const out = env.build('print.combine', [x.id], { exposures: [e.id, e.id], masks: [m.id, m.id], modes: ['subtract', 'add'] });
      const [xa, oa] = [await read(env, x), await read(env, out)];
      check(worst(oa, 3, (i, k) => xa[3 * i + k]!) <= TOL, 'dodge and burn of the same exposure do not cancel');
    },
  },
  {
    id: 'print.combine semantics: an unmasked base flash adds the same H to every pixel (contract 0.3)', op: 'print.combine', needs: ['print.combine', 'print.expose', 'mask.luminance'],
    async run(env) {
      const dyes = env.input('film-dyes');
      const x = env.build('print.expose', [dyes.id], {});
      const f = env.build('print.expose', [dyes.id], { time_s: 1 });
      const all = env.build('mask.luminance', [x.id], { above: 0, below: 1, softness: 0 });
      for (const mode of ['flash-base', 'flash-open']) {
        const out = env.build('print.combine', [x.id], { exposures: [f.id], masks: [all.id], modes: [mode] });
        const [xa, oa] = [await read(env, x), await read(env, out)];
        const added = (i: number, k: number): number => 10 ** oa[3 * i + k]! - 10 ** xa[3 * i + k]!;
        let spread = 0;
        for (let i = 0; i < xa.length / 3; i++) for (let k = 0; k < 3; k++) spread = Math.max(spread, Math.abs(added(i, k) - added(0, k)) / Math.max(added(0, k), 1e-12));
        check(added(0, 0) > 0 && spread <= 1e-3, `${mode}: the flash is not a uniform H (relative spread ${spread})`);
      }
    },
  },
  {
    id: 'print.combine semantics: density masks hold back the exposures through the negative (x − Σd_m), flashes pass (contract 0.3)', op: 'print.combine', needs: ['print.combine', 'print.densityMask'],
    async run(env) {
      const x = env.input('paper-logH');
      const d1 = env.build('print.densityMask', [x.id], { amount: 0.5, radius_um: 30 });
      const d2 = env.build('print.densityMask', [x.id], { amount: 0.2, radius_um: 30, polarity: 'same' });
      const out = env.build('print.combine', [x.id], { densityMasks: [d1.id, d2.id] });
      const [xa, oa] = [await read(env, x), await read(env, out)];
      const [da, db] = [Array.from(await read(env, d1)), Array.from(await read(env, d2))];
      check(da.every((v) => v >= -1e-6) && db.every((v) => v >= -1e-6), 'a density mask is negative somewhere');
      check(Math.min(...da) <= 1e-6, 'a positive mask is not 0 at the densest area');
      check(worst(oa, 3, (i, k) => xa[3 * i + k]! - da[i]! - db[i]!) <= TOL, 'print.combine with density masks is not x − Σd_m');
    },
  },
  {
    id: 'scan.flare semantics: T = T′(1 + f) − f per channel, f a number or [r, g, b] (contract 0.3)', op: 'scan.flare', needs: ['scan.flare'],
    async run(env) {
      const r = env.input('camera-linear');
      const one = await read(env, env.build('scan.flare', [r.id], { flare: 2 }));
      const per = await read(env, env.build('scan.flare', [r.id], { flare: [1, 2, 4] }));
      const ra = await read(env, r);
      const f = [0.01, 0.02, 0.04];
      check(worst(one, 3, (i, k) => ra[3 * i + k]! * 1.02 - 0.02) <= TOL, 'scan.flare (number) is not T′(1 + f) − f');
      check(worst(per, 3, (i, k) => ra[3 * i + k]! * (1 + f[k]!) - f[k]!) <= TOL, 'scan.flare (per channel) is not T′(1 + f_k) − f_k');
    },
  },
  {
    id: 'scan.density semantics: baseT is the zero of density and wins over the rebate (contract 0.3)', op: 'scan.density', needs: ['scan.density'],
    async run(env) {
      const r = env.input('camera-linear');
      const baseT = [0.8, 0.6, 0.5];
      const d = await read(env, env.build('scan.density', [r.id], { baseT, rebate: { x: 0, y: 0, w: 2, h: 2 } }));
      const ra = await read(env, r);
      check(worst(d, 3, (i, k) => -Math.log10(Math.max(ra[3 * i + k]!, 1e-8) / baseT[k]!)) <= 1e-4, 'scan.density with baseT is not −log10(T / baseT)');
    },
  },
  {
    id: 'mask semantics: and/or/not are min/max/1 − m', op: 'mask.and', needs: ['mask.and', 'mask.or', 'mask.not', 'mask.gradient', 'mask.ellipse'],
    async run(env) {
      const r = env.input('camera-linear');
      const a = env.build('mask.gradient', [r.id], { from: { x: 0, y: 0 }, to: { x: 12, y: 0 } });
      const b = env.build('mask.ellipse', [r.id], { box: { x: 1, y: 1, w: 9, h: 8 } });
      const [ma, mb] = [await read(env, a), await read(env, b)];
      const [mand, mor, mnot] = [
        await read(env, env.build('mask.and', [a.id], { other: b.id })),
        await read(env, env.build('mask.or', [a.id], { other: b.id })),
        await read(env, env.build('mask.not', [a.id], {})),
      ];
      check(worst(mand, 1, (i) => Math.min(ma[i]!, mb[i]!)) <= 1e-6, 'mask.and is not the minimum');
      check(worst(mor, 1, (i) => Math.max(ma[i]!, mb[i]!)) <= 1e-6, 'mask.or is not the maximum');
      check(worst(mnot, 1, (i) => 1 - ma[i]!) <= 1e-6, 'mask.not is not 1 − m');
      check(mb[4 * 12 + 5]! === 1 && mb[0]! === 0, 'mask.ellipse: centre not 1 or corner not 0');
    },
  },
  {
    id: 'mask semantics: a painted stroke covers its path and nothing far from it', op: 'mask.paint', needs: ['mask.paint'],
    async run(env) {
      const r = env.input('camera-linear');
      const strokes = JSON.stringify([{ kind: 'stroke', points: [[1, 5, 0.5], [11, 5, 0.5]], radius: 2, hardness: 0.5, mode: 'add' }]);
      const m = await read(env, env.build('mask.paint', [r.id], { strokes }));
      check(m[4 * 12 + 6]! === 1, `mask.paint on the path: ${m[4 * 12 + 6]}`);
      check(m[0]! === 0 && m[9 * 12 + 6]! === 0, 'mask.paint covers pixels far from the stroke');
    },
  },
  {
    id: 'mask semantics: feather keeps a flat mask flat', op: 'mask.feather', needs: ['mask.feather', 'mask.luminance'],
    async run(env) {
      const r = env.input('camera-linear');
      const all = env.build('mask.luminance', [r.id], { above: 0, below: 1, softness: 0 });
      const f = await read(env, env.build('mask.feather', [all.id], { radius_px: 6 }));
      check(worst(f, 1, () => 1) <= 1e-6, 'mask.feather of the whole-frame mask is not 1 everywhere');
    },
  },
];

/** The semantic cases whose ops the engine implements. */
export function semanticCases(impl: ReadonlySet<string>): Case[] {
  return CASES.filter((c) => c.needs.every((o) => impl.has(o))).map((c) => ({ id: c.id, op: c.op, kind: 'semantics' as const, run: c.run }));
}
