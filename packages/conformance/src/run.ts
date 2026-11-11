// Runs generated cases against an engine. runCases is framework-free (mutant tests use it);
// runConformance wraps it in Vitest describe/it for an engine package's own test file.
import { describe, it } from 'vitest';
import type { Engine } from '@chromobench/contract';
import { generateCases, makeEnv, type Case, type CaseKind, type EnvOptions } from './generate.ts';

export interface CaseResult { id: string; op: string; kind: CaseKind; ok: boolean; error?: string }

export async function runCase(c: Case, makeEngine: () => Engine | Promise<Engine>, opts: EnvOptions = {}): Promise<CaseResult> {
  const env = await makeEnv(makeEngine, opts);
  try {
    await c.run(env);
    return { id: c.id, op: c.op, kind: c.kind, ok: true };
  } catch (e) {
    return { id: c.id, op: c.op, kind: c.kind, ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    env.engine.dispose();
  }
}

export async function casesFor(makeEngine: () => Engine | Promise<Engine>): Promise<Case[]> {
  const e = await makeEngine();
  const ops = e.capabilities().ops;
  e.dispose();
  return generateCases(ops);
}

export async function runCases(makeEngine: () => Engine | Promise<Engine>, opts: EnvOptions & { filter?: (c: Case) => boolean } = {}): Promise<CaseResult[]> {
  const cases = (await casesFor(makeEngine)).filter(opts.filter ?? (() => true));
  const out: CaseResult[] = [];
  for (const c of cases) out.push(await runCase(c, makeEngine, opts));
  return out;
}

/** Registers one Vitest test per generated case. `implemented` must equal the engine's capabilities().ops. */
export function runConformance(name: string, makeEngine: () => Engine, opts: EnvOptions = {}): void {
  const probe = makeEngine();
  const cases = generateCases(probe.capabilities().ops);
  probe.dispose();
  describe(`conformance: ${name}`, () => {
    for (const c of cases) {
      it(c.id, async () => {
        const r = await runCase(c, makeEngine, opts);
        if (!r.ok) throw new Error(r.error);
      });
    }
  });
}
