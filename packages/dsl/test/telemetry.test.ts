// §5.13: every eval leaves an EvalTrace; the usage report finds unused vocabulary and frequent errors.
import { describe, expect, it } from 'vitest';
import { formatUsage, usageReport } from '../src/telemetry.ts';
import { setup } from './helpers.ts';

describe('telemetry', () => {
  it('traces count ops, vocabulary, errors and looks; the report aggregates them', async () => {
    const s = await setup();
    await s.run('return await frame.print().measure.stats()');
    await s.run("frame.print({ time_s: 12 }).look('x')\nreturn 1");
    await s.run('return frame.negative().pirnt()');
    const t = s.session.traces;
    expect(t).toHaveLength(3);
    expect(t[0]!.ops['measure.stats']).toBe(1);
    expect(t[0]!.vocabulary['print']).toBe(1);
    expect(t[1]!.looks).toBe(1);
    expect(t[2]!.errors).toEqual(['E_UNKNOWN_METHOD']);
    const r = usageReport(t);
    expect(r.evals).toBe(3);
    expect(r.errors).toEqual([['E_UNKNOWN_METHOD', 1]]);
    expect(r.unusedVocabulary).toContain('cb.ringAround');
    expect(r.unusedVocabulary).not.toContain('frame.print');
    expect(formatUsage(r)).toMatch(/^evals: 3; cut: 0\.0%/);
    s.session.dispose();
  });
});
