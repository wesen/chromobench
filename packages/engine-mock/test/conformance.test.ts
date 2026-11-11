import { describe, expect, it } from 'vitest';
import { allOps } from '@chromobench/contract';
import { MUTANTS, runCases, runConformance } from '@chromobench/conformance';
import { MockEngine } from '@chromobench/engine-mock';

runConformance('engine-mock', () => new MockEngine());

describe('conformance suite can fail', () => {
  it('ops missing from capabilities() raise E_NOT_IMPLEMENTED', async () => {
    const all = allOps({ includeInternal: true }).map((o) => o.name);
    const ops = all.filter((n) => n !== 'print.preflash' && n !== 'measure.histogram');
    const res = await runCases(() => new MockEngine({ ops }), { filter: (c) => c.kind === 'not-implemented' });
    expect(res.map((r) => r.op).sort()).toEqual(['measure.histogram', 'print.preflash']);
    for (const r of res) expect(r.ok, r.error).toBe(true);
  });

  for (const m of MUTANTS) {
    it(`mutant "${m.name}" fails its ${m.expectFail} case`, async () => {
      const filter = (c: { op: string; kind: string }): boolean => m.ops.includes(c.op) && c.kind === m.expectFail;
      const clean = await runCases(() => new MockEngine(), { filter });
      expect(clean.length).toBeGreaterThan(0);
      for (const r of clean) expect(r.ok, r.error).toBe(true);
      const res = await runCases(() => m.wrap(new MockEngine()), { filter, ...(m.env ?? {}) });
      expect(res.some((r) => !r.ok), `mutant passed: ${JSON.stringify(res)}`).toBe(true);
    });
  }
});
