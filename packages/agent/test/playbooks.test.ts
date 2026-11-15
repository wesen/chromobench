// The playbooks on engine-mock through the worker session (guide §5.7, §8): each loads with one eval and lists its
// helpers with doc lines; the grey balance reproduces the CHB-007 §7 numbers (−4.5 / −0.5 / +5 pt, a pending
// proposal by the agent); the test strip has one cell per band and its time arithmetic follows equal ratios
// (12 s × 2^(1/3) = 15.12 s, +1/3 stop = +0.1003 log H ≈ 4.0 pt); the ring-around has nine cells.
import { describe, expect, it } from 'vitest';
import { PLAYBOOKS } from '../src/index.ts';
import { FRAME, page } from './helpers.ts';

const src = (name: string): string => PLAYBOOKS.find((p) => p.name === name)!.source;
const first = (yaml: string): string => yaml.split('\n')[0]!;

describe('playbooks', () => {
  it('every playbook has a doc and loads with its helpers listed', async () => {
    expect(PLAYBOOKS.map((p) => p.name)).toEqual(['grey-balance', 'ring-around', 'test-strip']);
    const p = await page();
    for (const pb of PLAYBOOKS) {
      expect(pb.doc.length).toBeGreaterThan(40);
      const r = await p.dsl.eval({ code: pb.source, frame: FRAME });
      expect(r.error, r.yaml).toBeUndefined();
      expect(first(r.yaml)).toContain(`${pb.name} ready`);
      expect(r.context.newFunctions.length).toBeGreaterThan(0);
      expect(r.context.newFunctions.every((f) => f.includes(': '))).toBe(true); // each helper has a doc line
    }
    p.dsl.dispose();
  });

  it('grey balance: the §7 golden points, proposed as one pending change by the agent', async () => {
    const p = await page({ mode: 'ask' });
    await p.dsl.eval({ code: src('grey-balance'), frame: FRAME });
    const r = await p.dsl.eval({ code: 'return await mem.greyBalance([48, 32])', frame: FRAME });
    expect(r.error, r.yaml).toBeUndefined();
    expect(/points: \[(.*)\]/.exec(r.yaml)![1]).toBe('-4.5, -0.5, 5');
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]).toMatchObject({ why: 'neutral at [48,32]: -4.5 / -0.5 / 5 pt', tx: { by: 'agent', status: 'pending' } });
    expect(r.transactions[0]!.tx.mutations).toEqual([{ op: 'set', path: 'lights.params.logH', value: [-0.1125, -0.0125, 0.125] }]);
    const dry = await p.dsl.eval({ code: 'return await mem.greyBalance([48, 32], { propose: false })', frame: FRAME });
    expect(dry.transactions).toHaveLength(0);
    expect(/after: \[(.*)\]/.exec(dry.yaml)![1]).toBe(/after: \[(.*)\]/.exec(r.yaml)![1]);
    p.dsl.dispose();
  });

  it('test strip: one cell per band; equal-ratio times; the band nearest the aim', async () => {
    const p = await page();
    await p.dsl.eval({ code: src('test-strip'), frame: FRAME });
    const r = await p.dsl.eval({ code: 'const cells = await mem.testStrip({ steps: 5 })\nreturn { count: cells.length, best: mem.bestStep(cells, 0.755).cell }', frame: FRAME });
    expect(r.error, r.yaml).toBeUndefined();
    expect(r.yaml).toMatch(/^count: 5\nbest: \d/);
    expect(r.looks).toHaveLength(1);
    const t = await p.dsl.eval({ code: 'return mem.stripTimes(12, 5, 1 / 3)', frame: FRAME });
    expect(first(t.yaml)).toBe('[7.56, 9.52, 12, 15.12, 19.05]');
    const t0 = await p.dsl.eval({ code: 'return mem.stripTimes()', frame: FRAME }); // around the main exposure's 10 s
    expect(first(t0.yaml)).toBe('[6.3, 7.94, 10, 12.6, 15.87]');
    // the units the playbook relies on: 1/3 stop = 0.1003 log H ≈ 4.0 points
    const u = await p.dsl.eval({ code: 'return units.toPt([Math.log10(2) / 3, 0, 0])[0]', frame: FRAME });
    expect(Number(first(u.yaml))).toBeCloseTo(4.01, 2);
    p.dsl.dispose();
  });

  it('ring-around: nine cells and the most neutral one', async () => {
    const p = await page();
    await p.dsl.eval({ code: src('ring-around'), frame: FRAME });
    const r = await p.dsl.eval({ code: 'const cells = await mem.ringAround({ step_pt: 4 })\nreturn { count: cells.length, neutral: mem.mostNeutral(cells).cell }', frame: FRAME });
    expect(r.error, r.yaml).toBeUndefined();
    expect(r.yaml).toMatch(/^count: 9\nneutral: /);
    p.dsl.dispose();
  });
});
