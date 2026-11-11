// Law harness with mutants (guide §5.8). The contract supplies law(), check() and mulberry32; core adds
// the rule that every law ships a deliberately broken implementation it must catch (checkMutants).
// Laws are built from an implementation record, so a mutant is the same law over a patched record.
import { check, law, type Law, type LawReport, type Rng } from '@chromobench/contract';

export type { Rng };

export interface CoreLaw {
  name: string;
  section: string;
  law: Law<any>;
  mutant: { name: string; law: Law<any> };
}

export function defineLaw<T, I extends object>(
  name: string,
  meta: { justifies: string; section: string },
  impl: I,
  gen: (r: Rng) => T,
  prop: (impl: I) => (x: T) => true | string,
  mutant: { name: string; patch: Partial<I> },
): CoreLaw {
  const build = (im: I): Law<T> => law(name, gen, prop(im), { justifies: meta.justifies, source: meta.section });
  return { name, section: meta.section, law: build(impl), mutant: { name: mutant.name, law: build({ ...impl, ...mutant.patch }) } };
}

export function checkLaws(suite: readonly CoreLaw[], o: { n?: number; seed?: number } = {}): LawReport[] {
  return check(suite.map((l) => l.law), { n: o.n ?? 200, seed: o.seed ?? 1 });
}

export function checkMutants(suite: readonly CoreLaw[], o: { n?: number; seed?: number } = {}): { name: string; mutant: string; caught: boolean; message?: string }[] {
  return suite.map((l) => {
    const [r] = check([l.mutant.law], { n: o.n ?? 200, seed: o.seed ?? 1 });
    return { name: l.name, mutant: l.mutant.name, caught: !r!.ok, ...(r!.message ? { message: r!.message } : {}) };
  });
}

/** Relative/absolute closeness helper for law messages. */
export function near(a: number, b: number, tol: number, what: string): true | string {
  return Math.abs(a - b) <= tol ? true : `${what}: ${a} vs ${b} (|Δ| ${Math.abs(a - b).toExponential(2)} > ${tol})`;
}
