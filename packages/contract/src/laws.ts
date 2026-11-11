// Law harness: property tests with a seeded generator and counterexample shrinking.
// Ports Chromogen's laws.js design (textbook §2.8): law() refuses to build without `justifies`,
// "because without it this is an example, not a law".

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number;
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    range: (lo, hi) => lo + next() * (hi - lo),
  };
}

export interface Law<T> {
  name: string;
  gen: (r: Rng) => T;
  /** true, or a message saying what failed. */
  prop: (x: T) => true | string;
  justifies: string;
  source: string;
  shrink?: (x: T) => Iterable<T>;
}

export function law<T>(name: string, gen: Law<T>['gen'], prop: Law<T>['prop'], meta: { justifies: string; source: string; shrink?: Law<T>['shrink'] }): Law<T> {
  if (!meta?.justifies) throw new Error(`law ${name}: missing justifies — without it this is an example, not a law`);
  return { name, gen, prop, justifies: meta.justifies, source: meta.source, ...(meta.shrink ? { shrink: meta.shrink } : {}) };
}

export interface LawReport {
  name: string;
  ok: boolean;
  runs: number;
  ms: number;
  counterexample?: unknown;
  shrunk?: unknown;
  message?: string;
}

/** Default shrinker: numbers towards 0 and two decimals, arrays and objects component-wise. */
export function* shrinkValue(x: unknown): Iterable<unknown> {
  if (typeof x === 'number') {
    if (x !== 0) yield 0;
    const r2 = Math.round(x * 100) / 100;
    if (r2 !== x) yield r2;
    const half = Math.trunc((x / 2) * 100) / 100;
    if (half !== x && half !== 0) yield half;
    return;
  }
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) for (const s of shrinkValue(x[i])) yield x.map((v, j) => (j === i ? s : v));
    return;
  }
  if (x && typeof x === 'object') {
    for (const k of Object.keys(x)) for (const s of shrinkValue((x as Record<string, unknown>)[k])) yield { ...(x as object), [k]: s };
  }
}

function holds<T>(l: Law<T>, x: T): true | string {
  try {
    return l.prop(x);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function shrink<T>(l: Law<T>, x: T): { value: T; message: string } {
  let cur = x;
  let msg = String(holds(l, x));
  for (let budget = 500; budget > 0; budget--) {
    let improved = false;
    for (const c of (l.shrink ?? (shrinkValue as (x: T) => Iterable<T>))(cur)) {
      const r = holds(l, c);
      if (r !== true) {
        cur = c;
        msg = r;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return { value: cur, message: msg };
}

export function check(laws: readonly Law<any>[], opts: { n: number; seed: number }): LawReport[] {
  return laws.map((l) => {
    const t0 = performance.now();
    const rng = mulberry32(opts.seed);
    for (let i = 0; i < opts.n; i++) {
      const x = l.gen(rng);
      const r = holds(l, x);
      if (r !== true) {
        const s = shrink(l, x);
        return { name: l.name, ok: false, runs: i + 1, ms: performance.now() - t0, counterexample: x, shrunk: s.value, message: s.message };
      }
    }
    return { name: l.name, ok: true, runs: opts.n, ms: performance.now() - t0 };
  });
}
