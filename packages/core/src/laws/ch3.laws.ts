// Chapter 3 laws (§3.5, §3.9, guide §8.2), each with the mutant it must catch.
import type { PhysicsData } from '../data/provider.ts';
import { classify, type ScanClass } from '../scan/classify.ts';
import { makeScanner } from '../scan/scanner.ts';
import { makeForward, solveDyes, type ForwardModel, type SolveOptions, type SolveResult } from '../scan/solve.ts';
import { CHROMOGEN, SPEKTRAFILM } from '../spectral/conventions.ts';
import { resolveStock } from '../spectral/stock.ts';
import { defineLaw, near, type CoreLaw } from './harness.ts';

/** A forward model whose Jacobian has columns 0 and 1 swapped (the "wrong Jacobian column" mutant). */
function swappedJ(f: ForwardModel): ForwardModel {
  return {
    ...f,
    DJ(c, d, r, J) {
      const F = f.DJ(c, d, r, J);
      if (J) for (let k = 0; k < 3; k++) { const t = J[3 * k]!; J[3 * k] = J[3 * k + 1]!; J[3 * k + 1] = t; }
      return F;
    },
  };
}

export function ch3Laws(data: PhysicsData): CoreLaw[] {
  const fwd: ForwardModel[] = [];
  for (const sid of ['xt5-fitted', 'white-led', 'status-m']) {
    for (const st of ['kodak_portra_400', 'kodak_gold_200']) {
      for (const conv of [CHROMOGEN, SPEKTRAFILM]) fwd.push(makeForward(makeScanner(data, sid), resolveStock(data.stock(st), conv)));
    }
  }
  const roundTrip = defineLaw('round trip', { justifies: 'for c in the box, solveDyes(D(c)) returns c with residual < 1e-6 D', section: '§3.9' },
    { solve: (f: ForwardModel, d: ArrayLike<number>): SolveResult => solveDyes(f, d) },
    (r) => ({ k: r.int(0, fwd.length - 1), c: [r.range(0.05, 2.4), r.range(0.05, 2.4), r.range(0.05, 2.4)] }),
    (im) => ({ k, c }) => {
      const f = fwd[k]!;
      const s = im.solve(f, f.D(c));
      if (!(s.residual_D < 1e-6)) return `residual ${s.residual_D} (stop ${s.stop})`;
      for (let j = 0; j < 3; j++) { const m = near(s.c[j]!, c[j]!, 1e-4, `dye ${j}`); if (m !== true) return m; }
      return true;
    },
    { name: 'wrong Jacobian column', patch: { solve: (f, d) => solveDyes(swappedJ(f), d) } });

  const opt = (as: boolean, extra: SolveOptions = {}): SolveOptions => ({ activeSet: as, gtol: as ? 1e-9 : 0, ...extra });
  const activeNeverWorse = defineLaw('active set never worse', { justifies: 'holding a dye whose bound pushes outward never leaves a larger residual (Bertsekas projected Newton)', section: '§3.4, §3.9' },
    { solveActive: (f: ForwardModel, d: ArrayLike<number>): SolveResult => solveDyes(f, d, opt(true)) },
    // Unreachable pixels near the bounds: little red with green/blue demand, as the §3.4 shadow pixel.
    (r) => ({ k: r.int(0, fwd.length - 1), a: [r.range(-0.1, 0.1), r.range(0.1, 1.2), r.range(0.1, 1.2)] }),
    (im) => ({ k, a }) => {
      const f = fwd[k]!;
      const d = a.map((v, j) => v + f.Dbase[j]!);
      const act = im.solveActive(f, d).residual_D;
      const plain = solveDyes(f, d, { ...opt(false), maxIterations: 400 }).residual_D;
      return act <= plain + 1e-6 ? true : `active ${act} > plain ${plain}`;
    },
    { name: 'held dye chosen by an inverted gradient sign', patch: { solveActive: (f, d) => solveDyes(f, d, opt(true, { heldRule: (x, g, lo, hi) => (x <= lo && g < 0) || (x >= hi && g > 0) || x <= lo + 1e-3 })) } });

  const order = defineLaw('classify order', { justifies: 'below base wins over blank, both over gamut', section: '§3.5' },
    { classify: (D: number[], s: number[], r: number): ScanClass => classify(D, s, r).cls },
    (r) => ({ D: [r.range(-0.1, 0.5), r.range(-0.1, 0.5), r.range(-0.1, 0.5)], s: [r.range(0.003, 0.02), r.range(0.003, 0.02), r.range(0.003, 0.02)], res: r.range(0, 0.05) }),
    (im) => ({ D, s, res }) => {
      const z = D.map((v, k) => v / s[k]!);
      const zmin = Math.min(...z);
      const want: ScanClass = zmin < -3 ? 'below' : zmin <= 3 ? 'blank' : res > 0.01 ? 'gamut' : 'ok';
      const got = im.classify(D, s, res);
      return got === want ? true : `got ${got}, want ${want}`;
    },
    { name: 'gamut tested before blank', patch: { classify: (D, s, r) => { const zmin = Math.min(...D.map((v, k) => v / s[k]!)); return zmin < -3 ? 'below' : r > 0.01 ? 'gamut' : zmin <= 3 ? 'blank' : 'ok'; } } });

  return [roundTrip, activeNeverWorse, order];
}
