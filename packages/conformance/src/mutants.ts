// Deliberately broken engines and graphs. Each must fail the listed case kind; otherwise the suite
// cannot catch that class of bug.
import type { Engine, ImageResult } from '@chromobench/contract';
import type { CaseKind, EnvOptions } from './generate.ts';

export interface Mutant {
  name: string;
  expectFail: CaseKind;
  /** Restrict to these ops to keep the run short (the case kind is generated for them). */
  ops: string[];
  wrap: (e: Engine) => Engine;
  env?: EnvOptions;
}

function delegate(e: Engine, over: Partial<Engine>): Engine {
  return {
    id: e.id,
    capabilities: () => e.capabilities(),
    open: (s) => e.open(s),
    adopt: (d) => e.adopt(d),
    evaluate: (n, t) => e.evaluate(n, t),
    measure: (n, s) => e.measure(n, s),
    prepare: (k) => e.prepare(k),
    dispose: () => e.dispose(),
    ...over,
  };
}

/** canonicalJSON without sorting object keys. */
function unsortedJSON(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(typeof v === 'number' && Object.is(v, -0) ? 0 : v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(unsortedJSON).join(',')}]`;
  return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${unsortedJSON(x)}`).join(',')}}`;
}

export const MUTANTS: Mutant[] = [
  {
    name: 'ignores region', expectFail: 'region', ops: ['view.flare'],
    wrap: (e) => delegate(e, { evaluate: (n, t) => { const { region: _r, ...rest } = t; return e.evaluate(n, rest); } }),
  },
  {
    name: "tags the output with the input's domain", expectFail: 'shape', ops: ['print.develop'],
    wrap: (e) => {
      return delegate(e, {
        evaluate: async (n, t): Promise<ImageResult> => {
          const r = await e.evaluate(n, t);
          return { ...r, info: { ...r.info, domain: 'paper-logH' } };
        },
      });
    },
  },
  {
    name: 'adds 1e-12 · Math.random()', expectFail: 'determinism', ops: ['view.flare'],
    wrap: (e) => delegate(e, {
      evaluate: async (n, t) => {
        const r = await e.evaluate(n, t);
        return { ...r, read: async () => { const d = Float64Array.from(await r.read()); for (let i = 0; i < d.length; i++) d[i]! += 1e-12 * Math.random(); return d; } };
      },
    }),
  },
  {
    name: 'canonicalises without sorting keys', expectFail: 'canonical-id', ops: ['print.expose'],
    wrap: (e) => e, env: { canonicalJSON: unsortedJSON },
  },
  {
    name: 'returns no clipHigh from measure.stats', expectFail: 'measure-fields', ops: ['measure.stats'],
    wrap: (e) => delegate(e, {
      measure: async (n, s) => {
        const m = await e.measure(n, s);
        const { clipHigh: _c, ...rest } = m.value;
        return { ...m, value: rest };
      },
    }),
  },
];
