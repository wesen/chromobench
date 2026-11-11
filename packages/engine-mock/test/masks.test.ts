// mask.paint in the mock (CHB-017 noted it returned an empty mask): strokes rasterise with the same
// round-brush rule as core's paintMask, so the studio's brush shows on the mock too.
import { describe, expect, it } from 'vitest';
import { Graph, sha256Hex } from '@chromobench/contract';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';

describe('mock mask.paint', () => {
  it('a stroke covers its path, an erase stroke removes coverage, an empty list is empty', async () => {
    const e = new MockEngine();
    const g = new Graph();
    const bytes = makeM1Tiff();
    const info = await e.open({ kind: 'file', sha256: sha256Hex(bytes), bytes });
    g.registerSource(info);
    const src = g.intern('source.open', [], { source: info.sha256, encoding: 'linear' }).node;
    const read = async (strokes: unknown[]) => {
      const n = g.intern('mask.paint', [src.id], { strokes: JSON.stringify(strokes) }).node;
      e.adopt(g.closure(n.id));
      return Array.from(await (await e.evaluate(n, { scale: 'full', precision: 'preview' })).read());
    };
    const add = { kind: 'stroke', points: [[10, 20, 0.5], [70, 20, 0.5]], radius: 6, hardness: 0.5, mode: 'add' };
    const m = await read([add]);
    const at = (x: number, y: number) => m[y * 96 + x]!;
    expect(at(40, 19)).toBe(1);
    expect(at(40, 40)).toBe(0);
    expect(at(40, 24)).toBeGreaterThan(0);
    expect(at(40, 24)).toBeLessThan(1);
    const er = await read([add, { kind: 'stroke', points: [[40, 0, 0.5], [40, 63, 0.5]], radius: 3, hardness: 1, mode: 'erase' }]);
    expect(er[19 * 96 + 39]).toBe(0);
    expect(er[19 * 96 + 60]).toBe(1);
    expect((await read([])).every((v) => v === 0)).toBe(true);
  });
});
