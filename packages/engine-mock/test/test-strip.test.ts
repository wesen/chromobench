// darkroom.testStrip in the mock: a filtration strip steps the signed shift around 0 (contract 0.2),
// so its middle band is the current print, as a time strip's is, and the bands match the studio labels.
import { describe, expect, it } from 'vitest';
import { Graph, sha256Hex } from '@chromobench/contract';
import { makeM1Tiff, MockEngine } from '@chromobench/engine-mock';

describe('mock darkroom.testStrip', () => {
  it('filtration bands are centred on shift 0: the middle band equals the time strip middle band', async () => {
    const e = new MockEngine();
    const g = new Graph();
    const bytes = makeM1Tiff();
    g.registerSource(await e.open({ kind: 'file', sha256: sha256Hex(bytes), bytes }));
    const pat = g.intern('source.pattern', [], { domain: 'film-dyes', width: 5, height: 2, seed: 3 }).node;
    const strip = async (vary: string) => {
      const n = g.intern('darkroom.testStrip', [pat.id], { vary, steps: 5, step: vary === 'time' ? 0.5 : 10, direction: 'vertical' }).node;
      e.adopt(g.closure(n.id));
      return Array.from(await (await e.evaluate(n, { scale: 'full', precision: 'preview' })).read());
    };
    const [t, y] = [await strip('time'), await strip('filtration.y')];
    const mid = (a: number[]) => [0, 1].map((row) => a.slice((row * 5 + 2) * 3, (row * 5 + 2) * 3 + 3)).flat();
    expect(mid(y)).toEqual(mid(t));
    expect(y.slice(0, 3)).not.toEqual(y.slice(12, 15));
  });
});
