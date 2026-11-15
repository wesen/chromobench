// The golden pictures (CHB-037 P0) still come out of today's pipeline: every stored recipe re-renders to its stored
// pictures within the tolerance (render.ts --check, in-process; about 3 s on the reference engine).
import { describe, expect, it } from 'vitest';
import { checkAll, readIndex, TOLERANCE } from './golden.ts';

describe('golden pictures', () => {
  it('cover 30–60 cases and both source kinds', () => {
    const idx = readIndex();
    expect(idx.cases.length).toBeGreaterThanOrEqual(30);
    expect(idx.cases.length).toBeLessThanOrEqual(60);
    expect(new Set(idx.cases.map((c) => c.fixture))).toEqual(new Set(['negative', 'camera', 'm1']));
  });

  it(`re-render every stored recipe within max |Δ| ≤ ${TOLERANCE} at the cuts print and display`, async () => {
    const rep = await checkAll();
    const bad = rep.cases.filter((c) => !c.ok).map((c) => `${c.id}: ${c.cuts.map((x) => `${x.cut} ${x.maxAbs}${x.why ? ` (${x.why})` : ''}`).join(', ')}`);
    expect(bad).toEqual([]);
    // a skipped case that renders now must become a golden
    expect(rep.skipped.filter((s) => !s.stillMissing).map((s) => s.id)).toEqual([]);
  }, 60_000);
});
